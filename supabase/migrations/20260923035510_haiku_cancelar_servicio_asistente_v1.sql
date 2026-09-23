-- Haku: cancelación lógica segura de un servicio persistido.
-- El RPC manual recorta p_motivo; esta ruta conserva el texto humano exacto.
-- El cargo sigue siendo responsabilidad exclusiva del trigger oficial.
create table if not exists private.haiku_cancelar_servicio_asistente_operaciones_v1 (
  operacion_id uuid primary key,
  usuario_id uuid not null,
  servicio_id uuid not null,
  solicitud_hash text not null,
  resultado jsonb,
  creado_en timestamptz not null default now(),
  completado_en timestamptz
);

revoke all on table private.haiku_cancelar_servicio_asistente_operaciones_v1
  from public, anon, authenticated;

create or replace function public.haiku_cancelar_servicio_asistente_v1(
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
  v_hash text;
  v_operacion private.haiku_cancelar_servicio_asistente_operaciones_v1%rowtype;
  v_reserva_id_previa uuid;
  v_reserva public.reservas%rowtype;
  v_servicio public.servicios%rowtype;
  v_despues public.servicios%rowtype;
  v_checkout timestamptz;
  v_cargos_antes jsonb;
  v_cargos_despues jsonb;
  v_cargo public.cargos%rowtype;
  v_estado_cargo public.vista_estado_cargos%rowtype;
  v_activos bigint;
  v_aplicaciones bigint;
  v_ajustes bigint;
  v_incoherencias bigint;
  v_estado_actual jsonb;
  v_identidad_antes jsonb;
  v_identidad_despues jsonb;
  v_resultado jsonb;
begin
  if v_usuario is null then
    raise exception 'Debe iniciar sesión para cancelar servicios' using errcode = '42501';
  end if;
  if not private.haiku_usuario_activo() then
    raise exception 'Usuario no activo' using errcode = '42501';
  end if;
  if not private.haiku_tiene_permiso('servicios.cancelar') then
    raise exception 'Tu usuario no tiene permiso para cancelar servicios'
      using errcode = '42501';
  end if;
  if p_operacion_id is null or p_servicio_id is null then
    raise exception 'Operación o servicio inválido';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'La cancelación requiere un motivo';
  end if;
  if p_estado_esperado is null or jsonb_typeof(p_estado_esperado) is distinct from 'object' then
    raise exception 'El estado esperado del servicio no es válido';
  end if;

  v_hash := md5(jsonb_build_object(
    'servicio_id', p_servicio_id, 'motivo', p_motivo,
    'estado_esperado', p_estado_esperado
  )::text);
  insert into private.haiku_cancelar_servicio_asistente_operaciones_v1
    (operacion_id, usuario_id, servicio_id, solicitud_hash)
  values (p_operacion_id, v_usuario, p_servicio_id, v_hash)
  on conflict (operacion_id) do nothing;
  select * into v_operacion
  from private.haiku_cancelar_servicio_asistente_operaciones_v1
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
  -- Mantener el orden de locks de los RPC asistidos y escritores financieros.
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

  perform 1 from public.cargos c where c.servicio_id = p_servicio_id
  order by c.id for update;
  perform 1 from public.pago_aplicaciones pa
  join public.cargos c on c.id = pa.cargo_id
  where c.servicio_id = p_servicio_id order by pa.id for update of pa;
  perform 1 from public.cargo_ajustes ca
  join public.cargos c on c.id = ca.cargo_id
  where c.servicio_id = p_servicio_id order by ca.id for update of ca;

  select max(re.checkout_realizado_en) into v_checkout
  from public.reserva_estadias re where re.reserva_id = v_servicio.reserva_id;
  select count(*) filter (where c.estado = 'activo'),
         coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
    into v_activos, v_cargos_antes
  from public.cargos c where c.servicio_id = p_servicio_id;
  select * into v_cargo from public.cargos c
  where c.servicio_id = p_servicio_id and c.estado = 'activo'
  order by c.id limit 1;
  if v_cargo.id is not null then
    select * into v_estado_cargo from public.vista_estado_cargos
    where cargo_id = v_cargo.id;
  end if;
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
    'estado_servicio', v_servicio.estado_servicio,
    'tipo_cobro', v_servicio.tipo_cobro,
    'total', v_servicio.total,
    'fecha_servicio', v_servicio.fecha_servicio,
    'hora_inicio', v_servicio.hora_inicio,
    'hora_fin', v_servicio.hora_fin,
    'reserva_id', v_servicio.reserva_id,
    'estadia_id', v_servicio.estadia_id,
    'estado_reserva', v_reserva.estado_reserva,
    'reserva_actualizado_en', v_reserva.actualizado_en,
    'checkout_realizado_en', v_checkout,
    'bove_checkout', v_reserva.bove_checkout,
    'cargos', v_cargos_antes,
    'cargo_activo_id', case when v_activos = 1 then v_cargo.id else null end,
    'cargo_monto', case when v_activos = 1 then v_cargo.monto else null end,
    'cargo_aplicado_neto', case when v_activos = 1 then v_estado_cargo.aplicado_neto else null end,
    'cargo_saldo', case when v_activos = 1 then v_estado_cargo.saldo_cargo else null end,
    'cantidad_cargos_activos', v_activos,
    'cantidad_aplicaciones', v_aplicaciones,
    'cantidad_ajustes', v_ajustes
  );
  if p_estado_esperado is distinct from v_estado_actual then
    raise exception 'La propuesta quedó obsoleta; el servicio o sus finanzas cambiaron'
      using errcode = '40001';
  end if;

  if v_servicio.estado_servicio = 'cancelado' then
    v_resultado := jsonb_build_object(
      'ok', true, 'operacion_id', p_operacion_id, 'reintento', false,
      'estado', 'already_cancelled', 'sin_cambios', true,
      'servicio_id', p_servicio_id
    );
    update private.haiku_cancelar_servicio_asistente_operaciones_v1
    set resultado = v_resultado, completado_en = now()
    where operacion_id = p_operacion_id;
    return v_resultado;
  end if;
  if v_servicio.estado_servicio is distinct from 'programado' then
    raise exception 'El estado operativo del servicio requiere revisión humana';
  end if;
  if v_servicio.cancelado_en is not null or v_servicio.cancelado_por is not null
     or v_servicio.motivo_cancelacion is not null then
    raise exception 'El servicio conserva una cancelación previa; requiere revisión humana';
  end if;
  if v_reserva.estado_reserva not in ('pendiente', 'confirmada', 'hospedada')
     or v_checkout is not null then
    raise exception 'La reserva ya cerró o hizo check-out; requiere revisión humana';
  end if;
  if v_reserva.bove_checkout is not null then
    raise exception 'La reserva tiene BOVE de checkout; requiere revisión humana';
  end if;
  select count(*) into v_incoherencias from public.cargos c
  where c.servicio_id = p_servicio_id and (
    c.reserva_id is distinct from v_servicio.reserva_id
    or c.estadia_id is distinct from v_servicio.estadia_id
    or c.tipo_cargo is distinct from 'servicio'
    or c.estadia_noche_id is not null
    or c.estado not in ('activo', 'anulado')
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
  if v_servicio.tipo_cobro = 'cortesia' then
    if v_servicio.total is distinct from 0
       or nullif(btrim(coalesce(v_servicio.motivo_cortesia, '')), '') is null
       or v_activos <> 0 then
      raise exception 'La cortesía o sus finanzas requieren revisión humana';
    end if;
  elsif v_servicio.tipo_cobro = 'normal' then
    if v_servicio.total is null or v_servicio.total <= 0
       or v_activos <> 1 or v_cargo.id is null
       or v_cargo.monto is distinct from v_servicio.total
       or v_estado_cargo.cargo_id is null
       or v_estado_cargo.monto_ajustado is distinct from v_servicio.total
       or v_estado_cargo.aplicado_neto is distinct from 0
       or v_estado_cargo.saldo_cargo is distinct from v_servicio.total then
      raise exception 'El cargo activo no coincide con el total pendiente; requiere revisión humana';
    end if;
  else
    raise exception 'El tipo de cobro requiere revisión humana';
  end if;

  v_identidad_antes := to_jsonb(v_servicio)
    - 'estado_servicio' - 'cancelado_en' - 'cancelado_por'
    - 'motivo_cancelacion' - 'actualizado_en';
  perform set_config('app.haiku_origen', 'haku', true);
  perform set_config('app.haiku_operacion_id', p_operacion_id::text, true);
  -- Misma actualización lógica que el RPC manual, sin recortar el motivo.
  -- El trigger servicios_sincronizar_cargo sigue siendo el único writer del cargo.
  update public.servicios set
    estado_servicio = 'cancelado',
    cancelado_en = now(),
    cancelado_por = v_usuario,
    motivo_cancelacion = p_motivo,
    actualizado_en = now()
  where id = p_servicio_id;
  select * into v_despues from public.servicios where id = p_servicio_id;
  v_identidad_despues := to_jsonb(v_despues)
    - 'estado_servicio' - 'cancelado_en' - 'cancelado_por'
    - 'motivo_cancelacion' - 'actualizado_en';
  if v_identidad_despues is distinct from v_identidad_antes
     or v_despues.estado_servicio is distinct from 'cancelado'
     or v_despues.cancelado_en is null
     or v_despues.cancelado_por is distinct from v_usuario
     or v_despues.motivo_cancelacion is distinct from p_motivo then
    raise exception 'Falló la postcondición del servicio; no se guardó la cancelación';
  end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
    into v_cargos_despues
  from public.cargos c where c.servicio_id = p_servicio_id;
  if (select count(*) from public.cargos c
      where c.servicio_id = p_servicio_id and c.estado = 'activo') <> 0
     or jsonb_array_length(v_cargos_despues) <> jsonb_array_length(v_cargos_antes)
     or (v_servicio.tipo_cobro = 'normal' and not exists (
       select 1 from public.cargos c where c.id = v_cargo.id
         and c.servicio_id = p_servicio_id and c.estado = 'anulado'
         and c.monto = v_cargo.monto
     ))
     or exists (
       select 1 from jsonb_array_elements(v_cargos_antes) x
       where not exists (
         select 1 from public.cargos c where c.id = (x->>'id')::uuid
           and c.monto = (x->>'monto')::bigint
           and c.estado = case when c.id = v_cargo.id then 'anulado'
                              else x->>'estado' end
       )
     ) then
    raise exception 'Falló la postcondición del cargo; no se guardó la cancelación';
  end if;
  if (select count(*) from public.pago_aplicaciones pa
      join public.cargos c on c.id = pa.cargo_id
      where c.servicio_id = p_servicio_id) <> 0
     or (select count(*) from public.cargo_ajustes ca
      join public.cargos c on c.id = ca.cargo_id
      where c.servicio_id = p_servicio_id) <> 0
     or (select bove_checkout from public.reservas
         where id = v_servicio.reserva_id) is not null then
    raise exception 'El historial financiero o BOVE cambió; no se guardó la cancelación';
  end if;
  if not exists (
    select 1 from public.eventos_auditoria ea
    where ea.entidad_tipo = 'servicios' and ea.entidad_id = p_servicio_id
      and ea.reserva_id = v_servicio.reserva_id and ea.usuario_id = v_usuario
      and ea.origen = 'haku'
      and ea.datos_contexto ->> 'operacion_id' = p_operacion_id::text
      and exists (select 1 from jsonb_array_elements(ea.cambios) cambio
        where cambio ->> 'campo' = 'estado_servicio'
          and cambio ->> 'anterior' = 'programado'
          and cambio ->> 'nuevo' = 'cancelado')
      and exists (select 1 from jsonb_array_elements(ea.cambios) cambio
        where cambio ->> 'campo' = 'motivo_cancelacion'
          and cambio ->> 'nuevo' = p_motivo)
  ) then
    raise exception 'No se pudo acreditar la auditoría; no se guardó la cancelación';
  end if;

  v_resultado := jsonb_build_object(
    'ok', true, 'operacion_id', p_operacion_id, 'reintento', false,
    'estado', 'cancelled', 'sin_cambios', false,
    'servicio_id', p_servicio_id, 'reserva_id', v_servicio.reserva_id,
    'estadia_id', v_servicio.estadia_id, 'tipo_cobro', v_servicio.tipo_cobro,
    'total_original', v_servicio.total, 'motivo', p_motivo,
    'cargo_anulado_id', case when v_servicio.tipo_cobro = 'normal' then v_cargo.id else null end,
    'cargos_historicos', jsonb_array_length(v_cargos_despues)
  );
  update private.haiku_cancelar_servicio_asistente_operaciones_v1
  set resultado = v_resultado, completado_en = now()
  where operacion_id = p_operacion_id;
  return v_resultado;
end;
$function$;

comment on function public.haiku_cancelar_servicio_asistente_v1(uuid,uuid,text,jsonb) is
'Cancela un servicio programado tras validar estado, finanzas e idempotencia; conserva el motivo exacto y usa el trigger financiero oficial.';

revoke all on function public.haiku_cancelar_servicio_asistente_v1(uuid,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.haiku_cancelar_servicio_asistente_v1(uuid,uuid,text,jsonb)
  to authenticated;
