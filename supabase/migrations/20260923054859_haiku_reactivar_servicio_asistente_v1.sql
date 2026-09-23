-- Reactivación asistida: conserva la cancelación en auditoría y limpia su estado actual.
-- El RPC manual haiku_reactivar_servicio(uuid) permanece intacto.
-- Los cargos sólo los escribe servicios_sincronizar_cargo.
create table private.haiku_reactivar_servicio_asistente_operaciones_v1 (
  operacion_id uuid primary key,
  usuario_id uuid not null,
  servicio_id uuid not null,
  solicitud_hash text not null,
  resultado jsonb,
  creado_en timestamptz not null default now(),
  completado_en timestamptz
);

revoke all on table private.haiku_reactivar_servicio_asistente_operaciones_v1
  from public, anon, authenticated;

create function public.haiku_reactivar_servicio_asistente_v1(
  p_operacion_id uuid,
  p_servicio_id uuid,
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
  v_operacion private.haiku_reactivar_servicio_asistente_operaciones_v1%rowtype;
  v_reserva_id_previa uuid;
  v_reserva public.reservas%rowtype;
  v_servicio public.servicios%rowtype;
  v_despues public.servicios%rowtype;
  v_estadia public.reserva_estadias%rowtype;
  v_catalogo public.catalogo_servicios%rowtype;
  v_recurso public.recursos_servicio%rowtype;
  v_checkout timestamptz;
  v_cargos_antes jsonb;
  v_cargos_despues jsonb;
  v_aplicaciones_antes jsonb;
  v_ajustes_antes jsonb;
  v_pagos_antes jsonb;
  v_pagos_despues jsonb;
  v_conflictos jsonb;
  v_estado_actual jsonb;
  v_identidad_antes jsonb;
  v_identidad_despues jsonb;
  v_activos bigint;
  v_incoherencias bigint;
  v_nuevo_cargo public.cargos%rowtype;
  v_resultado jsonb;
begin
  if v_usuario is null then
    raise exception 'Debe iniciar sesión para reactivar servicios' using errcode = '42501';
  end if;
  if not private.haiku_usuario_activo() then
    raise exception 'Usuario no activo' using errcode = '42501';
  end if;
  if not private.haiku_tiene_permiso('servicios.editar') then
    raise exception 'Tu usuario no tiene permiso para reactivar servicios'
      using errcode = '42501';
  end if;
  if p_operacion_id is null or p_servicio_id is null then
    raise exception 'Operación o servicio inválido';
  end if;
  if p_estado_esperado is null or jsonb_typeof(p_estado_esperado) is distinct from 'object' then
    raise exception 'El estado esperado del servicio no es válido';
  end if;

  v_hash := md5(jsonb_build_object(
    'servicio_id', p_servicio_id, 'estado_esperado', p_estado_esperado
  )::text);
  insert into private.haiku_reactivar_servicio_asistente_operaciones_v1
    (operacion_id, usuario_id, servicio_id, solicitud_hash)
  values (p_operacion_id, v_usuario, p_servicio_id, v_hash)
  on conflict (operacion_id) do nothing;
  select * into v_operacion
  from private.haiku_reactivar_servicio_asistente_operaciones_v1
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
  -- Mismo orden de locks que los otros RPC asistidos de servicios.
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

  select * into v_estadia from public.reserva_estadias
  where id = v_servicio.estadia_id for update;
  select * into v_catalogo from public.catalogo_servicios
  where id = v_servicio.catalogo_servicio_id;
  if v_servicio.recurso_id is not null then
    select * into v_recurso from public.recursos_servicio
    where id = v_servicio.recurso_id;
    perform pg_advisory_xact_lock(hashtextextended(
      'servicio_recurso:' || v_servicio.recurso_id::text || ':' || v_servicio.fecha_servicio::text, 0
    ));
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
  select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id), '[]'::jsonb)
    into v_aplicaciones_antes from public.pago_aplicaciones pa
    join public.cargos c on c.id = pa.cargo_id where c.servicio_id = p_servicio_id;
  select coalesce(jsonb_agg(to_jsonb(ca) order by ca.id), '[]'::jsonb)
    into v_ajustes_antes from public.cargo_ajustes ca
    join public.cargos c on c.id = ca.cargo_id where c.servicio_id = p_servicio_id;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
    into v_pagos_antes from public.pagos p where p.reserva_id = v_servicio.reserva_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'estado_servicio', s.estado_servicio,
    'actualizado_en', s.actualizado_en) order by s.id), '[]'::jsonb)
    into v_conflictos from public.servicios s
    where s.id <> p_servicio_id
      and s.recurso_id = v_servicio.recurso_id
      and s.fecha_servicio = v_servicio.fecha_servicio
      and s.estado_servicio not in ('cancelado', 'no_show')
      and s.hora_inicio < v_servicio.hora_fin
      and s.hora_fin > v_servicio.hora_inicio;

  v_estado_actual := jsonb_build_object(
    'version', 1,
    'servicio_id', v_servicio.id,
    'servicio_actualizado_en', v_servicio.actualizado_en,
    'estado_servicio', v_servicio.estado_servicio,
    'cancelado_en', v_servicio.cancelado_en,
    'cancelado_por', v_servicio.cancelado_por,
    'motivo_cancelacion', v_servicio.motivo_cancelacion,
    'reserva_id', v_servicio.reserva_id,
    'estadia_id', v_servicio.estadia_id,
    'catalogo_servicio_id', v_servicio.catalogo_servicio_id,
    'catalogo_activo', v_catalogo.activo,
    'estadia_estado', v_estadia.estado_estadia,
    'recurso_id', v_servicio.recurso_id,
    'recurso_activo', v_recurso.activo,
    'fecha_servicio', v_servicio.fecha_servicio,
    'hora_inicio', v_servicio.hora_inicio,
    'hora_fin', v_servicio.hora_fin,
    'tipo_cobro', v_servicio.tipo_cobro,
    'total', v_servicio.total,
    'estado_reserva', v_reserva.estado_reserva,
    'reserva_actualizado_en', v_reserva.actualizado_en,
    'checkout_realizado_en', v_checkout,
    'bove_checkout', v_reserva.bove_checkout,
    'bove_cierre', v_reserva.bove_cierre,
    'cargos', v_cargos_antes,
    'cantidad_cargos_activos', v_activos,
    'aplicaciones', v_aplicaciones_antes,
    'ajustes', v_ajustes_antes,
    'conflictos', v_conflictos
  );
  if jsonb_array_length(v_conflictos) <> 0 then
    v_resultado := jsonb_build_object(
      'ok', false, 'operacion_id', p_operacion_id, 'reintento', false,
      'estado', 'HORARIO_OCUPADO', 'sin_cambios', true,
      'servicio_id', p_servicio_id, 'conflictos', v_conflictos
    );
    update private.haiku_reactivar_servicio_asistente_operaciones_v1
      set resultado = v_resultado, completado_en = now()
      where operacion_id = p_operacion_id;
    return v_resultado;
  end if;
  if p_estado_esperado is distinct from v_estado_actual then
    raise exception 'La propuesta quedó obsoleta; el servicio o sus finanzas cambiaron'
      using errcode = '40001';
  end if;

  if v_servicio.estado_servicio = 'programado' then
    v_resultado := jsonb_build_object(
      'ok', true, 'operacion_id', p_operacion_id, 'reintento', false,
      'estado', 'already_active', 'sin_cambios', true,
      'servicio_id', p_servicio_id
    );
    update private.haiku_reactivar_servicio_asistente_operaciones_v1
      set resultado = v_resultado, completado_en = now()
      where operacion_id = p_operacion_id;
    return v_resultado;
  end if;
  if v_servicio.estado_servicio is distinct from 'cancelado' then
    raise exception 'El estado operativo del servicio requiere revisión humana';
  end if;
  if v_servicio.cancelado_en is null or v_servicio.cancelado_por is null
     or nullif(btrim(coalesce(v_servicio.motivo_cancelacion, '')), '') is null then
    raise exception 'La cancelación no tiene metadatos completos; requiere revisión humana';
  end if;
  if not exists (
    select 1 from public.eventos_auditoria ea
    where ea.entidad_tipo = 'servicios' and ea.entidad_id = p_servicio_id
      and ea.reserva_id = v_servicio.reserva_id
      and exists (select 1 from jsonb_array_elements(ea.cambios) cambio
        where cambio ->> 'campo' = 'estado_servicio'
          and cambio ->> 'nuevo' = 'cancelado')
      and exists (select 1 from jsonb_array_elements(ea.cambios) cambio
        where cambio ->> 'campo' = 'motivo_cancelacion'
          and cambio ->> 'nuevo' = v_servicio.motivo_cancelacion)
      and exists (select 1 from jsonb_array_elements(ea.cambios) cambio
        where cambio ->> 'campo' = 'cancelado_en'
          and (cambio ->> 'nuevo')::timestamptz = v_servicio.cancelado_en)
      and exists (select 1 from jsonb_array_elements(ea.cambios) cambio
        where cambio ->> 'campo' = 'cancelado_por'
          and cambio ->> 'nuevo' = v_servicio.cancelado_por::text)
  ) then
    raise exception 'No existe auditoría de la cancelación anterior; requiere revisión humana';
  end if;
  if v_reserva.estado_reserva not in ('pendiente', 'confirmada', 'hospedada')
     or v_checkout is not null then
    raise exception 'La reserva ya cerró o hizo check-out; requiere revisión humana';
  end if;
  if v_reserva.bove_checkout is not null or v_reserva.bove_cierre is not null then
    raise exception 'La reserva tiene BOVE de checkout o cierre; requiere revisión humana';
  end if;
  if v_estadia.id is null or v_estadia.reserva_id is distinct from v_reserva.id
     or v_estadia.estado_estadia not in ('pendiente', 'confirmada', 'hospedada')
     or v_estadia.checkout_realizado_en is not null then
    raise exception 'La estadía requiere revisión humana';
  end if;
  if v_servicio.fecha_servicio < (now() at time zone 'America/Santiago')::date then
    raise exception 'La fecha del servicio ya pasó; requiere revisión humana';
  end if;
  if v_catalogo.id is null or v_catalogo.activo is distinct from true then
    raise exception 'El catálogo del servicio requiere revisión humana';
  end if;
  if v_servicio.recurso_id is not null and v_recurso.activo is distinct from true then
    raise exception 'El recurso del servicio requiere revisión humana';
  end if;
  if v_catalogo.requiere_horario is true
     and (v_servicio.recurso_id is null or v_servicio.hora_inicio is null
          or v_servicio.hora_fin is null
          or v_servicio.hora_fin <= v_servicio.hora_inicio) then
    raise exception 'El servicio requiere recurso y horario válidos';
  end if;
  if v_activos <> 0 then
    raise exception 'El servicio tiene un cargo activo inesperado; requiere revisión humana';
  end if;
  select count(*) into v_incoherencias from public.cargos c
  where c.servicio_id = p_servicio_id and (
    c.reserva_id is distinct from v_servicio.reserva_id
    or c.estadia_id is distinct from v_servicio.estadia_id
    or c.tipo_cargo is distinct from 'servicio'
    or c.estadia_noche_id is not null
    or c.estado is distinct from 'anulado'
  );
  if v_incoherencias <> 0 then
    raise exception 'El historial de cargos requiere revisión humana';
  end if;
  if jsonb_array_length(v_aplicaciones_antes) <> 0 then
    raise exception 'El servicio tiene aplicaciones de pago históricas; requiere revisión humana';
  end if;
  if jsonb_array_length(v_ajustes_antes) <> 0 then
    raise exception 'El servicio tiene ajustes históricos; requiere revisión humana';
  end if;
  if v_servicio.tipo_cobro = 'normal' then
    if v_servicio.total is null or v_servicio.total <= 0 then
      raise exception 'El total normal requiere revisión humana';
    end if;
  elsif v_servicio.tipo_cobro = 'cortesia' then
    if v_servicio.total is distinct from 0
       or nullif(btrim(coalesce(v_servicio.motivo_cortesia, '')), '') is null then
      raise exception 'La cortesía requiere revisión humana';
    end if;
  else
    raise exception 'El tipo de cobro requiere revisión humana';
  end if;

  v_identidad_antes := to_jsonb(v_servicio)
    - 'estado_servicio' - 'cancelado_en' - 'cancelado_por'
    - 'motivo_cancelacion' - 'actualizado_en';
  perform set_config('app.haiku_origen', 'haku', true);
  perform set_config('app.haiku_operacion_id', p_operacion_id::text, true);
  update public.servicios set
    estado_servicio = 'programado',
    cancelado_en = null,
    cancelado_por = null,
    motivo_cancelacion = null,
    actualizado_en = now()
  where id = p_servicio_id;
  select * into v_despues from public.servicios where id = p_servicio_id;
  v_identidad_despues := to_jsonb(v_despues)
    - 'estado_servicio' - 'cancelado_en' - 'cancelado_por'
    - 'motivo_cancelacion' - 'actualizado_en';
  if v_identidad_despues is distinct from v_identidad_antes
     or v_despues.estado_servicio is distinct from 'programado'
     or v_despues.cancelado_en is not null
     or v_despues.cancelado_por is not null
     or v_despues.motivo_cancelacion is not null then
    raise exception 'Falló la postcondición del servicio; no se guardó la reactivación';
  end if;

  select count(*) filter (where c.estado = 'activo'),
         coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
    into v_activos, v_cargos_despues
  from public.cargos c where c.servicio_id = p_servicio_id;
  select * into v_nuevo_cargo from public.cargos c
  where c.servicio_id = p_servicio_id and c.estado = 'activo';
  if v_servicio.tipo_cobro = 'normal' then
    if v_activos <> 1 or v_nuevo_cargo.id is null
       or v_nuevo_cargo.reserva_id is distinct from v_servicio.reserva_id
       or v_nuevo_cargo.estadia_id is distinct from v_servicio.estadia_id
       or v_nuevo_cargo.tipo_cargo is distinct from 'servicio'
       or v_nuevo_cargo.monto is distinct from v_servicio.total
       or jsonb_array_length(v_cargos_despues) <> jsonb_array_length(v_cargos_antes) + 1
       or exists (select 1 from jsonb_array_elements(v_cargos_antes) x
         where x ->> 'id' = v_nuevo_cargo.id::text) then
      raise exception 'Falló la postcondición del cargo nuevo; no se guardó la reactivación';
    end if;
  elsif v_activos <> 0 or v_cargos_despues is distinct from v_cargos_antes then
    raise exception 'Falló la postcondición de la cortesía; no se guardó la reactivación';
  end if;
  if exists (select 1 from jsonb_array_elements(v_cargos_antes) x
      where not exists (select 1 from public.cargos c
        where c.id = (x ->> 'id')::uuid and to_jsonb(c) = x
          and c.estado = 'anulado')) then
    raise exception 'Se alteró un cargo histórico; no se guardó la reactivación';
  end if;
  if (select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id), '[]'::jsonb)
      from public.pago_aplicaciones pa join public.cargos c on c.id = pa.cargo_id
      where c.servicio_id = p_servicio_id) is distinct from v_aplicaciones_antes
     or (select coalesce(jsonb_agg(to_jsonb(ca) order by ca.id), '[]'::jsonb)
      from public.cargo_ajustes ca join public.cargos c on c.id = ca.cargo_id
      where c.servicio_id = p_servicio_id) is distinct from v_ajustes_antes then
    raise exception 'Las aplicaciones o ajustes cambiaron; no se guardó la reactivación';
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
    into v_pagos_despues from public.pagos p where p.reserva_id = v_servicio.reserva_id;
  if v_pagos_despues is distinct from v_pagos_antes then
    raise exception 'Los pagos cambiaron; no se guardó la reactivación';
  end if;
  if (select count(*) from public.servicios s
      where s.id <> p_servicio_id
        and s.recurso_id = v_servicio.recurso_id
        and s.fecha_servicio = v_servicio.fecha_servicio
        and s.estado_servicio not in ('cancelado', 'no_show')
        and s.hora_inicio < v_servicio.hora_fin
        and s.hora_fin > v_servicio.hora_inicio) <> 0 then
    raise exception 'El horario dejó de estar disponible; no se guardó la reactivación';
  end if;
  if (select count(*) from public.eventos_auditoria ea
      where ea.entidad_tipo = 'servicios' and ea.entidad_id = p_servicio_id
        and ea.reserva_id = v_servicio.reserva_id and ea.usuario_id = v_usuario
        and ea.origen = 'haku'
        and ea.datos_contexto ->> 'operacion_id' = p_operacion_id::text
        and exists (select 1 from jsonb_array_elements(ea.cambios) cambio
          where cambio ->> 'campo' = 'estado_servicio'
            and cambio ->> 'anterior' = 'cancelado'
            and cambio ->> 'nuevo' = 'programado')) <> 1 then
    raise exception 'No se pudo acreditar la auditoría; no se guardó la reactivación';
  end if;

  v_resultado := jsonb_build_object(
    'ok', true, 'operacion_id', p_operacion_id, 'reintento', false,
    'estado', 'reactivated', 'sin_cambios', false,
    'servicio_id', p_servicio_id, 'reserva_id', v_servicio.reserva_id,
    'estadia_id', v_servicio.estadia_id, 'tipo_cobro', v_servicio.tipo_cobro,
    'total', v_servicio.total,
    'cargo_nuevo_id', case when v_servicio.tipo_cobro = 'normal' then v_nuevo_cargo.id else null end,
    'cargos_historicos', jsonb_array_length(v_cargos_antes)
  );
  update private.haiku_reactivar_servicio_asistente_operaciones_v1
  set resultado = v_resultado, completado_en = now()
  where operacion_id = p_operacion_id;
  return v_resultado;
end;
$function$;

comment on function public.haiku_reactivar_servicio_asistente_v1(uuid,uuid,jsonb) is
'Reactiva un servicio cancelado con estado esperado, finanzas limpias e idempotencia; conserva la cancelación en auditoría y usa el trigger oficial para el cargo.';

revoke all on function public.haiku_reactivar_servicio_asistente_v1(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.haiku_reactivar_servicio_asistente_v1(uuid,uuid,jsonb)
  to authenticated;
