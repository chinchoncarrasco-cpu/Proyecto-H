-- Haku · conversión atómica y estrecha de un servicio normal a cortesía.
-- El cargo se sincroniza exclusivamente mediante servicios_sincronizar_cargo.

create table if not exists private.haiku_servicio_cortesia_operaciones_v1 (
  operacion_id uuid primary key,
  usuario_id uuid not null,
  servicio_id uuid not null,
  solicitud_hash text not null,
  resultado jsonb,
  creado_en timestamptz not null default now(),
  completado_en timestamptz
);

revoke all on table private.haiku_servicio_cortesia_operaciones_v1
  from public, anon, authenticated;

comment on table private.haiku_servicio_cortesia_operaciones_v1 is
'Idempotencia privada de haiku_cambiar_servicio_a_cortesia_v1 por operación, usuario y solicitud exacta.';

create or replace function public.haiku_cambiar_servicio_a_cortesia_v1(
  p_operacion_id uuid,
  p_servicio_id uuid,
  p_motivo text,
  p_estado_esperado jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_usuario uuid := auth.uid();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_hash text;
  v_operacion private.haiku_servicio_cortesia_operaciones_v1%rowtype;
  v_reserva_id_previa uuid;
  v_servicio public.servicios%rowtype;
  v_servicio_despues public.servicios%rowtype;
  v_reserva public.reservas%rowtype;
  v_catalogo public.catalogo_servicios%rowtype;
  v_cargo_id uuid;
  v_cargo_estado text;
  v_cargo_monto bigint;
  v_cargo_actualizado_en timestamptz;
  v_aplicado_neto bigint;
  v_saldo_cargo bigint;
  v_monto_ajustado bigint;
  v_cantidad_cargos bigint := 0;
  v_cantidad_activos bigint := 0;
  v_cantidad_aplicaciones bigint := 0;
  v_cantidad_ajustes bigint := 0;
  v_incoherencias bigint := 0;
  v_activos_despues bigint := 0;
  v_aplicaciones_despues bigint := 0;
  v_ajustes_despues bigint := 0;
  v_bove_anterior text;
  v_bove_despues text;
  v_estado_actual jsonb;
  v_identidad_anterior jsonb;
  v_identidad_despues jsonb;
  v_resultado jsonb;
begin
  if v_usuario is null then
    raise exception 'Debe iniciar sesión para cambiar un servicio a cortesía'
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
  if v_motivo is null then
    raise exception 'La cortesía requiere un motivo';
  end if;
  if p_estado_esperado is null
     or jsonb_typeof(p_estado_esperado) is distinct from 'object' then
    raise exception 'El estado esperado del servicio no es válido';
  end if;

  v_hash := md5(jsonb_build_object(
    'servicio_id', p_servicio_id,
    'motivo', v_motivo,
    'estado_esperado', p_estado_esperado
  )::text);

  insert into private.haiku_servicio_cortesia_operaciones_v1 (
    operacion_id, usuario_id, servicio_id, solicitud_hash
  ) values (
    p_operacion_id, v_usuario, p_servicio_id, v_hash
  ) on conflict (operacion_id) do nothing;

  select * into v_operacion
  from private.haiku_servicio_cortesia_operaciones_v1
  where operacion_id = p_operacion_id
  for update;

  if v_operacion.usuario_id is distinct from v_usuario then
    raise exception 'La operación pertenece a otro usuario'
      using errcode = '42501';
  end if;
  if v_operacion.servicio_id is distinct from p_servicio_id
     or v_operacion.solicitud_hash is distinct from v_hash then
    raise exception 'La operación ya fue usada con otra solicitud';
  end if;
  if v_operacion.resultado is not null then
    return v_operacion.resultado || jsonb_build_object('reintento', true);
  end if;

  select reserva_id into v_reserva_id_previa
  from public.servicios
  where id = p_servicio_id;
  if not found then
    raise exception 'No se encontró el servicio';
  end if;

  -- Ajustes antiguos usan hashtextextended(reserva); pagos y escritores nuevos
  -- usan reserva_finanzas. El orden evita invertir locks entre ambos flujos.
  perform pg_advisory_xact_lock(hashtextextended(v_reserva_id_previa::text, 0));
  perform pg_advisory_xact_lock(
    private.haiku_libro_lock_key_v1('reserva_finanzas', v_reserva_id_previa::text)
  );

  select * into v_reserva
  from public.reservas
  where id = v_reserva_id_previa
  for update;
  if not found then
    raise exception 'No se encontró la reserva del servicio';
  end if;

  select * into v_servicio
  from public.servicios
  where id = p_servicio_id
  for update;
  if not found then
    raise exception 'No se encontró el servicio';
  end if;
  if v_servicio.reserva_id is distinct from v_reserva_id_previa then
    raise exception 'El servicio cambió de reserva; prepara una propuesta nueva'
      using errcode = '40001';
  end if;

  select * into v_catalogo
  from public.catalogo_servicios
  where id = v_servicio.catalogo_servicio_id
  for share;
  if not found or not coalesce(v_catalogo.activo, false) then
    raise exception 'El catálogo del servicio no existe o está inactivo';
  end if;

  perform 1
  from public.cargos c
  where c.servicio_id = p_servicio_id
  order by c.id
  for update;

  perform 1
  from public.pago_aplicaciones pa
  join public.cargos c on c.id = pa.cargo_id
  where c.servicio_id = p_servicio_id
  order by pa.id
  for update of pa;

  perform 1
  from public.cargo_ajustes ca
  join public.cargos c on c.id = ca.cargo_id
  where c.servicio_id = p_servicio_id
  order by ca.id
  for update of ca;

  select count(*), count(*) filter (where c.estado = 'activo')
    into v_cantidad_cargos, v_cantidad_activos
  from public.cargos c
  where c.servicio_id = p_servicio_id;

  select c.id, c.estado, c.monto, c.actualizado_en,
         ec.aplicado_neto, ec.saldo_cargo, ec.monto_ajustado
    into v_cargo_id, v_cargo_estado, v_cargo_monto, v_cargo_actualizado_en,
         v_aplicado_neto, v_saldo_cargo, v_monto_ajustado
  from public.cargos c
  left join public.vista_estado_cargos ec on ec.cargo_id = c.id
  where c.servicio_id = p_servicio_id
    and c.estado = 'activo'
  order by c.id
  limit 1;

  select count(*) into v_cantidad_aplicaciones
  from public.pago_aplicaciones pa
  join public.cargos c on c.id = pa.cargo_id
  where c.servicio_id = p_servicio_id;

  select count(*) into v_cantidad_ajustes
  from public.cargo_ajustes ca
  join public.cargos c on c.id = ca.cargo_id
  where c.servicio_id = p_servicio_id;

  v_estado_actual := jsonb_build_object(
    'version', 1,
    'servicio_id', v_servicio.id,
    'servicio_actualizado_en', v_servicio.actualizado_en,
    'tipo_cobro', v_servicio.tipo_cobro,
    'total', v_servicio.total,
    'estado_servicio', v_servicio.estado_servicio,
    'estado_reserva', v_reserva.estado_reserva,
    'bove_checkout', v_reserva.bove_checkout,
    'cargo_id', case when v_cantidad_activos = 1 then v_cargo_id else null end,
    'cargo_estado', case when v_cantidad_activos = 1 then v_cargo_estado else null end,
    'cargo_monto', case when v_cantidad_activos = 1 then v_cargo_monto else null end,
    'cargo_actualizado_en', case when v_cantidad_activos = 1 then v_cargo_actualizado_en else null end,
    'aplicado_neto', case when v_cantidad_activos = 1 then v_aplicado_neto else null end,
    'saldo_cargo', case when v_cantidad_activos = 1 then v_saldo_cargo else null end,
    'cantidad_cargos', v_cantidad_cargos,
    'cantidad_cargos_activos', v_cantidad_activos,
    'cantidad_aplicaciones', v_cantidad_aplicaciones,
    'cantidad_ajustes', v_cantidad_ajustes
  );

  if p_estado_esperado is distinct from v_estado_actual then
    raise exception 'La propuesta quedó obsoleta; el servicio o sus finanzas cambiaron'
      using errcode = '40001';
  end if;

  if not coalesce(v_catalogo.permite_cortesia, false) then
    raise exception 'El catálogo de este servicio no permite cortesía';
  end if;
  if coalesce(v_servicio.estado_servicio, '') not in ('programado', 'en_proceso', 'realizado') then
    raise exception 'El estado operativo del servicio requiere revisión humana';
  end if;

  select count(*) into v_incoherencias
  from public.cargos c
  where c.servicio_id = p_servicio_id
    and (
      c.reserva_id is distinct from v_servicio.reserva_id
      or c.estadia_id is distinct from v_servicio.estadia_id
      or c.tipo_cargo is distinct from 'servicio'
      or c.estadia_noche_id is not null
      or c.estado is null
      or c.estado not in ('activo', 'anulado')
    );

  if v_servicio.tipo_cobro = 'cortesia' then
    if v_servicio.total is distinct from 0
       or v_servicio.motivo_cortesia is null
       or btrim(v_servicio.motivo_cortesia) = ''
       or v_cantidad_activos <> 0
       or v_cantidad_aplicaciones <> 0
       or v_cantidad_ajustes <> 0
       or v_incoherencias <> 0
       or exists (
         select 1 from public.cargos c
         where c.servicio_id = p_servicio_id and c.estado <> 'anulado'
       ) then
      raise exception 'El servicio figura como cortesía, pero sus finanzas requieren revisión humana';
    end if;

    v_resultado := jsonb_build_object(
      'ok', true,
      'operacion_id', p_operacion_id,
      'reintento', false,
      'estado', 'already_courtesy',
      'sin_cambios', true,
      'servicio_id', v_servicio.id,
      'reserva_id', v_servicio.reserva_id,
      'estadia_id', v_servicio.estadia_id,
      'estado_reserva', v_reserva.estado_reserva,
      'bove_checkout_anterior', v_reserva.bove_checkout,
      'bove_checkout_invalidado', false
    );
    update private.haiku_servicio_cortesia_operaciones_v1
       set resultado = v_resultado, completado_en = now()
     where operacion_id = p_operacion_id;
    return v_resultado;
  end if;

  if v_servicio.tipo_cobro is distinct from 'normal'
     or coalesce(v_servicio.total, 0) <= 0 then
    raise exception 'El servicio no es un cobro normal positivo elegible';
  end if;
  if v_cantidad_activos <> 1 or v_cargo_id is null then
    raise exception 'El servicio debe tener exactamente un cargo activo coherente';
  end if;
  if v_cantidad_aplicaciones <> 0 then
    raise exception 'El servicio tiene aplicaciones de pago históricas; requiere revisión humana';
  end if;
  if v_cantidad_ajustes <> 0 then
    raise exception 'El servicio tiene ajustes históricos; requiere revisión humana';
  end if;
  if v_incoherencias <> 0
     or v_cargo_estado <> 'activo'
     or v_cargo_monto is distinct from v_servicio.total
     or v_monto_ajustado is distinct from v_servicio.total
     or coalesce(v_aplicado_neto, 0) <> 0
     or v_saldo_cargo is distinct from v_servicio.total then
    raise exception 'El cargo activo no coincide con el servicio; requiere revisión humana';
  end if;

  v_identidad_anterior := jsonb_build_object(
    'reserva_id', v_servicio.reserva_id,
    'estadia_id', v_servicio.estadia_id,
    'catalogo_servicio_id', v_servicio.catalogo_servicio_id,
    'recurso_id', v_servicio.recurso_id,
    'fecha_servicio', v_servicio.fecha_servicio,
    'hora_inicio', v_servicio.hora_inicio,
    'hora_fin', v_servicio.hora_fin,
    'cantidad', v_servicio.cantidad,
    'personas', v_servicio.personas,
    'precio_unitario_aplicado', v_servicio.precio_unitario_aplicado,
    'estado_servicio', v_servicio.estado_servicio
  );
  v_bove_anterior := v_reserva.bove_checkout;

  perform set_config('app.haiku_origen', 'haku', true);
  perform set_config('app.haiku_operacion_id', p_operacion_id::text, true);

  update public.servicios
     set tipo_cobro = 'cortesia',
         total = 0,
         monto_adicional = 0,
         motivo_cortesia = v_motivo
   where id = p_servicio_id;

  select * into v_servicio_despues
  from public.servicios
  where id = p_servicio_id;

  v_identidad_despues := jsonb_build_object(
    'reserva_id', v_servicio_despues.reserva_id,
    'estadia_id', v_servicio_despues.estadia_id,
    'catalogo_servicio_id', v_servicio_despues.catalogo_servicio_id,
    'recurso_id', v_servicio_despues.recurso_id,
    'fecha_servicio', v_servicio_despues.fecha_servicio,
    'hora_inicio', v_servicio_despues.hora_inicio,
    'hora_fin', v_servicio_despues.hora_fin,
    'cantidad', v_servicio_despues.cantidad,
    'personas', v_servicio_despues.personas,
    'precio_unitario_aplicado', v_servicio_despues.precio_unitario_aplicado,
    'estado_servicio', v_servicio_despues.estado_servicio
  );

  select count(*) into v_activos_despues
  from public.cargos c
  where c.servicio_id = p_servicio_id and c.estado = 'activo';

  select count(*) into v_aplicaciones_despues
  from public.pago_aplicaciones pa
  join public.cargos c on c.id = pa.cargo_id
  where c.servicio_id = p_servicio_id;

  select count(*) into v_ajustes_despues
  from public.cargo_ajustes ca
  join public.cargos c on c.id = ca.cargo_id
  where c.servicio_id = p_servicio_id;

  select bove_checkout into v_bove_despues
  from public.reservas
  where id = v_servicio.reserva_id;

  if v_servicio_despues.tipo_cobro is distinct from 'cortesia'
     or v_servicio_despues.total is distinct from 0
     or v_servicio_despues.monto_adicional is distinct from 0
     or v_servicio_despues.motivo_cortesia is distinct from v_motivo
     or v_identidad_despues is distinct from v_identidad_anterior then
    raise exception 'Falló la postcondición del servicio; no se guardó el cambio';
  end if;
  if v_activos_despues <> 0
     or not exists (
       select 1 from public.cargos c
       where c.id = v_cargo_id
         and c.servicio_id = p_servicio_id
         and c.estado = 'anulado'
         and c.monto = v_cargo_monto
     ) then
    raise exception 'Falló la postcondición del cargo; no se guardó el cambio';
  end if;
  if v_aplicaciones_despues <> v_cantidad_aplicaciones
     or v_ajustes_despues <> v_cantidad_ajustes then
    raise exception 'El historial financiero cambió durante la operación; no se guardó el cambio';
  end if;
  if v_bove_anterior is not null and v_bove_despues is not null then
    raise exception 'El BOVE de servicios no fue invalidado; no se guardó el cambio';
  end if;
  if not exists (
    select 1
    from public.eventos_auditoria ea
    where ea.entidad_tipo = 'servicios'
      and ea.entidad_id = p_servicio_id
      and ea.reserva_id = v_servicio.reserva_id
      and ea.usuario_id = v_usuario
      and ea.origen = 'haku'
      and ea.datos_contexto ->> 'operacion_id' = p_operacion_id::text
      and exists (
        select 1 from jsonb_array_elements(ea.cambios) cambio
        where cambio ->> 'campo' = 'tipo_cobro'
          and cambio ->> 'anterior' = 'normal'
          and cambio ->> 'nuevo' = 'cortesia'
      )
      and exists (
        select 1 from jsonb_array_elements(ea.cambios) cambio
        where cambio ->> 'campo' = 'total'
          and cambio ->> 'nuevo' = '0'
      )
      and exists (
        select 1 from jsonb_array_elements(ea.cambios) cambio
        where cambio ->> 'campo' = 'motivo_cortesia'
          and cambio ->> 'nuevo' = v_motivo
      )
  ) then
    raise exception 'No se pudo acreditar la auditoría del cambio; no se guardó la operación';
  end if;

  v_resultado := jsonb_build_object(
    'ok', true,
    'operacion_id', p_operacion_id,
    'reintento', false,
    'estado', 'changed_to_courtesy',
    'sin_cambios', false,
    'servicio_id', v_servicio.id,
    'reserva_id', v_servicio.reserva_id,
    'estadia_id', v_servicio.estadia_id,
    'estado_reserva', v_reserva.estado_reserva,
    'tipo_cobro_anterior', v_servicio.tipo_cobro,
    'tipo_cobro', v_servicio_despues.tipo_cobro,
    'total_anterior', v_servicio.total,
    'total', v_servicio_despues.total,
    'cargo_id', v_cargo_id,
    'cargo_estado_anterior', v_cargo_estado,
    'cargo_estado', 'anulado',
    'cargo_monto_historico', v_cargo_monto,
    'bove_checkout_anterior', v_bove_anterior,
    'bove_checkout_invalidado', v_bove_anterior is not null and v_bove_despues is null
  );

  update private.haiku_servicio_cortesia_operaciones_v1
     set resultado = v_resultado, completado_en = now()
   where operacion_id = p_operacion_id;

  return v_resultado;
end;
$function$;

comment on function public.haiku_cambiar_servicio_a_cortesia_v1(uuid, uuid, text, jsonb) is
'Convierte atómica e idempotentemente un servicio normal sin historial financiero a cortesía. Revalida un snapshot cerrado y deja la sincronización del cargo al trigger oficial.';

revoke all on function public.haiku_cambiar_servicio_a_cortesia_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.haiku_cambiar_servicio_a_cortesia_v1(uuid, uuid, text, jsonb)
  to authenticated;
