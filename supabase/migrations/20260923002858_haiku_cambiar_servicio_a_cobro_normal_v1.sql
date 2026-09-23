-- Haku: cortesía -> cobro normal sobre el mismo servicio.
-- El único escritor de cargos sigue siendo servicios_sincronizar_cargo.
create table if not exists private.haiku_servicio_cobro_normal_operaciones_v1 (
  operacion_id uuid primary key,
  usuario_id uuid not null,
  servicio_id uuid not null,
  solicitud_hash text not null,
  resultado jsonb,
  creado_en timestamptz not null default now(),
  completado_en timestamptz
);

revoke all on table private.haiku_servicio_cobro_normal_operaciones_v1
  from public, anon, authenticated;

comment on table private.haiku_servicio_cobro_normal_operaciones_v1 is
'Idempotencia privada de la conversión cortesía a cobro normal por operación, usuario y solicitud exacta.';

create or replace function public.haiku_cambiar_servicio_a_cobro_normal_v1(
  p_operacion_id uuid,
  p_servicio_id uuid,
  p_personas smallint,
  p_estado_esperado jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_usuario uuid := auth.uid();
  v_hash text;
  v_operacion private.haiku_servicio_cobro_normal_operaciones_v1%rowtype;
  v_reserva_id_previa uuid;
  v_reserva public.reservas%rowtype;
  v_servicio public.servicios%rowtype;
  v_despues public.servicios%rowtype;
  v_catalogo public.catalogo_servicios%rowtype;
  v_precio_hora bigint;
  v_adicional bigint;
  v_total bigint;
  v_cargos_antes jsonb;
  v_cargos_historicos_despues jsonb;
  v_cantidad_cargos bigint;
  v_activos bigint;
  v_aplicaciones bigint;
  v_ajustes bigint;
  v_incoherencias bigint;
  v_cargo_activo public.cargos%rowtype;
  v_nuevo_cargo public.cargos%rowtype;
  v_estado_actual jsonb;
  v_identidad_antes jsonb;
  v_identidad_despues jsonb;
  v_bove_antes text;
  v_bove_despues text;
  v_resultado jsonb;
begin
  if v_usuario is null then
    raise exception 'Debe iniciar sesión para cambiar un servicio a cobro normal'
      using errcode = '42501';
  end if;
  if not private.haiku_usuario_activo() then
    raise exception 'Usuario no activo' using errcode = '42501';
  end if;
  if not private.haiku_tiene_permiso('servicios.editar') then
    raise exception 'Tu usuario no tiene permiso para editar servicios'
      using errcode = '42501';
  end if;
  if p_operacion_id is null or p_servicio_id is null then
    raise exception 'Operación o servicio inválido';
  end if;
  if p_personas is null or p_personas < 1 then
    raise exception 'Debe indicar una cantidad válida de personas';
  end if;
  if p_estado_esperado is null or jsonb_typeof(p_estado_esperado) is distinct from 'object' then
    raise exception 'El estado esperado del servicio no es válido';
  end if;

  v_hash := md5(jsonb_build_object(
    'servicio_id', p_servicio_id,
    'personas', p_personas,
    'estado_esperado', p_estado_esperado
  )::text);
  insert into private.haiku_servicio_cobro_normal_operaciones_v1 (
    operacion_id, usuario_id, servicio_id, solicitud_hash
  ) values (p_operacion_id, v_usuario, p_servicio_id, v_hash)
  on conflict (operacion_id) do nothing;
  select * into v_operacion
  from private.haiku_servicio_cobro_normal_operaciones_v1
  where operacion_id = p_operacion_id for update;
  if v_operacion.usuario_id is distinct from v_usuario then
    raise exception 'La operación pertenece a otro usuario' using errcode = '42501';
  end if;
  if v_operacion.servicio_id is distinct from p_servicio_id
     or v_operacion.solicitud_hash is distinct from v_hash then
    raise exception 'La operación ya fue usada con otra solicitud';
  end if;
  if v_operacion.resultado is not null then
    return v_operacion.resultado || jsonb_build_object('reintento', true);
  end if;

  select reserva_id into v_reserva_id_previa
  from public.servicios where id = p_servicio_id;
  if not found then raise exception 'No se encontró el servicio'; end if;

  -- Mismo orden que el RPC normal -> cortesía y los escritores financieros.
  perform pg_advisory_xact_lock(hashtextextended(v_reserva_id_previa::text, 0));
  perform pg_advisory_xact_lock(
    private.haiku_libro_lock_key_v1('reserva_finanzas', v_reserva_id_previa::text)
  );
  select * into v_reserva from public.reservas
  where id = v_reserva_id_previa for update;
  if not found then raise exception 'No se encontró la reserva del servicio'; end if;
  select * into v_servicio from public.servicios
  where id = p_servicio_id for update;
  if not found then raise exception 'No se encontró el servicio'; end if;
  if v_servicio.reserva_id is distinct from v_reserva_id_previa then
    raise exception 'El servicio cambió de reserva; prepara una propuesta nueva'
      using errcode = '40001';
  end if;
  select * into v_catalogo from public.catalogo_servicios
  where id = v_servicio.catalogo_servicio_id for share;
  if not found or not coalesce(v_catalogo.activo, false) then
    raise exception 'El catálogo del servicio no existe o está inactivo';
  end if;

  perform 1 from public.cargos c where c.servicio_id = p_servicio_id
  order by c.id for update;
  perform 1 from public.pago_aplicaciones pa
  join public.cargos c on c.id = pa.cargo_id
  where c.servicio_id = p_servicio_id order by pa.id for update of pa;
  perform 1 from public.cargo_ajustes ca
  join public.cargos c on c.id = ca.cargo_id
  where c.servicio_id = p_servicio_id order by ca.id for update of ca;

  select count(*), count(*) filter (where estado = 'activo'),
         coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
    into v_cantidad_cargos, v_activos, v_cargos_antes
  from public.cargos c where c.servicio_id = p_servicio_id;
  select * into v_cargo_activo from public.cargos
  where servicio_id = p_servicio_id and estado = 'activo'
  order by id limit 1;
  select count(*) into v_aplicaciones from public.pago_aplicaciones pa
  join public.cargos c on c.id = pa.cargo_id
  where c.servicio_id = p_servicio_id;
  select count(*) into v_ajustes from public.cargo_ajustes ca
  join public.cargos c on c.id = ca.cargo_id
  where c.servicio_id = p_servicio_id;

  v_estado_actual := jsonb_build_object(
    'version', 1,
    'servicio_id', v_servicio.id,
    'servicio_actualizado_en', v_servicio.actualizado_en,
    'catalogo_servicio_id', v_catalogo.id,
    'catalogo_codigo', v_catalogo.codigo,
    'catalogo_activo', v_catalogo.activo,
    'catalogo_permite_cortesia', v_catalogo.permite_cortesia,
    'catalogo_unidad', v_catalogo.unidad,
    'precio_base', v_catalogo.precio_base,
    'capacidad_incluida', v_catalogo.capacidad_incluida,
    'capacidad_maxima', v_catalogo.capacidad_maxima,
    'precio_persona_adicional', v_catalogo.precio_persona_adicional,
    'cantidad', v_servicio.cantidad,
    'personas', v_servicio.personas,
    'tipo_cobro', v_servicio.tipo_cobro,
    'total', v_servicio.total,
    'estado_servicio', v_servicio.estado_servicio,
    'estado_reserva', v_reserva.estado_reserva,
    'bove_checkout', v_reserva.bove_checkout,
    'cargos', v_cargos_antes,
    'cantidad_cargos_activos', v_activos,
    'cantidad_aplicaciones', v_aplicaciones,
    'cantidad_ajustes', v_ajustes
  );
  if p_estado_esperado is distinct from v_estado_actual then
    raise exception 'La propuesta quedó obsoleta; el servicio, catálogo o finanzas cambiaron'
      using errcode = '40001';
  end if;

  if v_catalogo.codigo not in ('tinajaTonel', 'tinajaJacuzzi')
     or v_catalogo.unidad is distinct from 'hora'
     or not coalesce(v_catalogo.permite_cortesia, false)
     or v_catalogo.precio_base is null or v_catalogo.precio_base <= 0
     or v_catalogo.capacidad_incluida is null
     or v_catalogo.capacidad_maxima is null
     or v_catalogo.capacidad_incluida < 1
     or v_catalogo.capacidad_maxima < v_catalogo.capacidad_incluida
     or coalesce(v_catalogo.precio_persona_adicional, 0) < 0 then
    raise exception 'La configuración del catálogo requiere revisión humana';
  end if;
  -- El catálogo actual define exactamente estos límites para ambas tinajas.
  if (v_catalogo.codigo = 'tinajaTonel' and
      (v_catalogo.capacidad_incluida <> 3 or v_catalogo.capacidad_maxima <> 3
       or v_catalogo.precio_base <> 30000
       or coalesce(v_catalogo.precio_persona_adicional, 0) <> 0))
     or (v_catalogo.codigo = 'tinajaJacuzzi' and
      (v_catalogo.capacidad_incluida <> 3 or v_catalogo.capacidad_maxima <> 5
       or v_catalogo.precio_base <> 30000
       or v_catalogo.precio_persona_adicional is distinct from 10000)) then
    raise exception 'La configuración de personas del catálogo requiere revisión humana';
  end if;
  if p_personas > v_catalogo.capacidad_maxima then
    raise exception 'El servicio admite máximo % personas', v_catalogo.capacidad_maxima;
  end if;
  if v_servicio.cantidad is null or v_servicio.cantidad <= 0 then
    raise exception 'La cantidad del servicio requiere revisión humana';
  end if;
  if coalesce(v_servicio.estado_servicio, '') not in
     ('programado', 'en_proceso', 'realizado') then
    raise exception 'El estado operativo del servicio requiere revisión humana';
  end if;
  v_adicional := v_servicio.cantidad::bigint
    * greatest(0, p_personas - v_catalogo.capacidad_incluida)
    * coalesce(v_catalogo.precio_persona_adicional, 0);
  v_precio_hora := v_catalogo.precio_base
    + greatest(0, p_personas - v_catalogo.capacidad_incluida)
    * coalesce(v_catalogo.precio_persona_adicional, 0);
  v_total := v_servicio.cantidad::bigint * v_precio_hora;

  select count(*) into v_incoherencias from public.cargos c
  where c.servicio_id = p_servicio_id and (
    c.reserva_id is distinct from v_servicio.reserva_id
    or c.estadia_id is distinct from v_servicio.estadia_id
    or c.tipo_cargo is distinct from 'servicio'
    or c.estadia_noche_id is not null
    or c.estado is null or c.estado not in ('activo', 'anulado')
  );
  if v_incoherencias <> 0 then
    raise exception 'El historial de cargos requiere revisión humana';
  end if;
  if v_aplicaciones <> 0 then
    raise exception 'El servicio tiene aplicaciones de pago históricas; requiere revisión humana';
  end if;
  if v_ajustes <> 0 then
    raise exception 'El servicio tiene ajustes históricos; requiere revisión humana';
  end if;

  if v_servicio.tipo_cobro = 'normal' then
    if v_servicio.personas is distinct from p_personas
       or v_servicio.total is distinct from v_total
       or v_servicio.precio_unitario_aplicado is distinct from v_catalogo.precio_base
       or v_servicio.monto_adicional is distinct from v_adicional
       or v_servicio.motivo_cortesia is not null
       or v_activos <> 1 or v_cargo_activo.id is null
       or v_cargo_activo.monto is distinct from v_total
       or exists (select 1 from public.cargos c
                  where c.servicio_id = p_servicio_id
                    and c.id <> v_cargo_activo.id and c.estado <> 'anulado') then
      raise exception 'El servicio ya es normal pero requiere revisión financiera humana';
    end if;
    v_resultado := jsonb_build_object(
      'ok', true, 'operacion_id', p_operacion_id, 'reintento', false,
      'estado', 'already_normal', 'sin_cambios', true,
      'servicio_id', p_servicio_id, 'reserva_id', v_servicio.reserva_id,
      'estadia_id', v_servicio.estadia_id, 'personas', p_personas,
      'total', v_total, 'cargo_id', v_cargo_activo.id,
      'bove_checkout_anterior', v_reserva.bove_checkout,
      'bove_checkout_invalidado', false
    );
    update private.haiku_servicio_cobro_normal_operaciones_v1
      set resultado = v_resultado, completado_en = now()
      where operacion_id = p_operacion_id;
    return v_resultado;
  end if;

  if v_servicio.tipo_cobro is distinct from 'cortesia'
     or v_servicio.total is distinct from 0
     or nullif(btrim(coalesce(v_servicio.motivo_cortesia, '')), '') is null
     or v_activos <> 0
     or exists (select 1 from public.cargos c
                where c.servicio_id = p_servicio_id and c.estado <> 'anulado') then
    raise exception 'La cortesía o sus finanzas requieren revisión humana';
  end if;

  v_identidad_antes := jsonb_build_object(
    'reserva_id', v_servicio.reserva_id, 'estadia_id', v_servicio.estadia_id,
    'catalogo_servicio_id', v_servicio.catalogo_servicio_id,
    'recurso_id', v_servicio.recurso_id,
    'fecha_servicio', v_servicio.fecha_servicio,
    'hora_inicio', v_servicio.hora_inicio, 'hora_fin', v_servicio.hora_fin,
    'cantidad', v_servicio.cantidad, 'estado_servicio', v_servicio.estado_servicio,
    'observaciones', v_servicio.observaciones
  );
  v_bove_antes := v_reserva.bove_checkout;
  perform set_config('app.haiku_origen', 'haku', true);
  perform set_config('app.haiku_operacion_id', p_operacion_id::text, true);

  update public.servicios set
    tipo_cobro = 'normal', personas = p_personas,
    precio_unitario_aplicado = v_catalogo.precio_base,
    monto_adicional = v_adicional, total = v_total,
    motivo_cortesia = null, motivo_ajuste_precio = null
  where id = p_servicio_id;
  select * into v_despues from public.servicios where id = p_servicio_id;
  v_identidad_despues := jsonb_build_object(
    'reserva_id', v_despues.reserva_id, 'estadia_id', v_despues.estadia_id,
    'catalogo_servicio_id', v_despues.catalogo_servicio_id,
    'recurso_id', v_despues.recurso_id,
    'fecha_servicio', v_despues.fecha_servicio,
    'hora_inicio', v_despues.hora_inicio, 'hora_fin', v_despues.hora_fin,
    'cantidad', v_despues.cantidad, 'estado_servicio', v_despues.estado_servicio,
    'observaciones', v_despues.observaciones
  );
  select * into v_nuevo_cargo from public.cargos c
  where c.servicio_id = p_servicio_id and c.estado = 'activo';
  select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
    into v_cargos_historicos_despues
  from public.cargos c where c.servicio_id = p_servicio_id
    and c.id in (select (x->>'id')::uuid from jsonb_array_elements(v_cargos_antes) x);
  select bove_checkout into v_bove_despues from public.reservas
  where id = v_servicio.reserva_id;

  if v_identidad_despues is distinct from v_identidad_antes
     or v_despues.tipo_cobro is distinct from 'normal'
     or v_despues.personas is distinct from p_personas
     or v_despues.precio_unitario_aplicado is distinct from v_catalogo.precio_base
     or v_despues.monto_adicional is distinct from v_adicional
     or v_despues.total is distinct from v_total
     or v_despues.motivo_cortesia is not null
     or v_despues.motivo_ajuste_precio is not null then
    raise exception 'Falló la postcondición del servicio; no se guardó el cambio';
  end if;
  if (select count(*) from public.cargos c
      where c.servicio_id = p_servicio_id and c.estado = 'activo') <> 1
     or v_nuevo_cargo.id is null
     or v_nuevo_cargo.monto is distinct from v_total
     or v_nuevo_cargo.reserva_id is distinct from v_servicio.reserva_id
     or v_nuevo_cargo.estadia_id is distinct from v_servicio.estadia_id
     or v_nuevo_cargo.tipo_cargo is distinct from 'servicio'
     or v_nuevo_cargo.estadia_noche_id is not null
     or exists (select 1 from jsonb_array_elements(v_cargos_antes) x
                where x->>'id' = v_nuevo_cargo.id::text)
     or v_cargos_historicos_despues is distinct from v_cargos_antes
     or (select count(*) from public.cargos c
         where c.servicio_id = p_servicio_id) <> v_cantidad_cargos + 1 then
    raise exception 'Falló la postcondición del cargo; no se guardó el cambio';
  end if;
  if (select count(*) from public.pago_aplicaciones pa
      join public.cargos c on c.id = pa.cargo_id
      where c.servicio_id = p_servicio_id) <> 0
     or (select count(*) from public.cargo_ajustes ca
      join public.cargos c on c.id = ca.cargo_id
      where c.servicio_id = p_servicio_id) <> 0 then
    raise exception 'El historial financiero cambió; no se guardó el cambio';
  end if;
  if v_bove_antes is not null and v_bove_despues is not null then
    raise exception 'El BOVE no fue invalidado; no se guardó el cambio';
  end if;
  if not exists (
    select 1 from public.eventos_auditoria ea
    where ea.entidad_tipo = 'servicios' and ea.entidad_id = p_servicio_id
      and ea.reserva_id = v_servicio.reserva_id and ea.usuario_id = v_usuario
      and ea.origen = 'haku'
      and ea.datos_contexto ->> 'operacion_id' = p_operacion_id::text
      and exists (select 1 from jsonb_array_elements(ea.cambios) cambio
                  where cambio ->> 'campo' = 'tipo_cobro'
                    and cambio ->> 'anterior' = 'cortesia'
                    and cambio ->> 'nuevo' = 'normal')
      and exists (select 1 from jsonb_array_elements(ea.cambios) cambio
                  where cambio ->> 'campo' = 'total'
                    and cambio ->> 'nuevo' = v_total::text)
      and exists (select 1 from jsonb_array_elements(ea.cambios) cambio
                  where cambio ->> 'campo' = 'motivo_cortesia'
                    and cambio ->> 'anterior' = v_servicio.motivo_cortesia
                    and cambio -> 'nuevo' = 'null'::jsonb)
  ) then
    raise exception 'No se pudo acreditar la auditoría; no se guardó la operación';
  end if;

  v_resultado := jsonb_build_object(
    'ok', true, 'operacion_id', p_operacion_id, 'reintento', false,
    'estado', 'changed_to_normal', 'sin_cambios', false,
    'servicio_id', p_servicio_id, 'reserva_id', v_servicio.reserva_id,
    'estadia_id', v_servicio.estadia_id, 'estado_reserva', v_reserva.estado_reserva,
    'tipo_cobro_anterior', v_servicio.tipo_cobro, 'tipo_cobro', 'normal',
    'personas', p_personas, 'cantidad', v_servicio.cantidad,
    'precio_hora', v_precio_hora, 'precio_unitario_aplicado', v_catalogo.precio_base,
    'monto_adicional', v_adicional, 'total_anterior', v_servicio.total,
    'total', v_total, 'cargo_id', v_nuevo_cargo.id,
    'cargo_estado', v_nuevo_cargo.estado,
    'cargos_historicos_conservados', v_cantidad_cargos,
    'bove_checkout_anterior', v_bove_antes,
    'bove_checkout_invalidado', v_bove_antes is not null and v_bove_despues is null
  );
  update private.haiku_servicio_cobro_normal_operaciones_v1
    set resultado = v_resultado, completado_en = now()
    where operacion_id = p_operacion_id;
  return v_resultado;
end;
$function$;

comment on function public.haiku_cambiar_servicio_a_cobro_normal_v1(uuid,uuid,smallint,jsonb) is
'Convierte atómica e idempotentemente una cortesía sin historial financiero a cobro normal, calculando precio por hora desde catálogo; sólo actualiza servicios.';

revoke all on function public.haiku_cambiar_servicio_a_cobro_normal_v1(uuid,uuid,smallint,jsonb)
  from public, anon, authenticated;
grant execute on function public.haiku_cambiar_servicio_a_cobro_normal_v1(uuid,uuid,smallint,jsonb)
  to authenticated;
