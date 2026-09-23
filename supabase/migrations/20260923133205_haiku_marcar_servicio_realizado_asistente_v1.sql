-- Realizado es un estado operativo: la deuda y sus pagos permanecen intactos.
create table private.haiku_marcar_servicio_realizado_asistente_operaciones_v1 (
  operacion_id uuid primary key,
  usuario_id uuid not null,
  servicio_id uuid not null,
  solicitud_hash text not null,
  resultado jsonb,
  creado_en timestamptz not null default now(),
  completado_en timestamptz
);

revoke all on table private.haiku_marcar_servicio_realizado_asistente_operaciones_v1
  from public, anon, authenticated;

create function public.haiku_marcar_servicio_realizado_asistente_v1(
  p_operacion_id uuid,
  p_servicio_id uuid,
  p_estado_esperado jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_usuario uuid := auth.uid();
  v_hash text;
  v_operacion private.haiku_marcar_servicio_realizado_asistente_operaciones_v1%rowtype;
  v_reserva_id_previa uuid;
  v_reserva public.reservas%rowtype;
  v_estadia public.reserva_estadias%rowtype;
  v_servicio public.servicios%rowtype;
  v_despues public.servicios%rowtype;
  v_catalogo public.catalogo_servicios%rowtype;
  v_cargo public.cargos%rowtype;
  v_checkout timestamptz;
  v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_hora time := (now() at time zone 'America/Santiago')::time;
  v_cargos_antes jsonb;
  v_cargos_despues jsonb;
  v_finanzas_antes jsonb;
  v_finanzas_despues jsonb;
  v_aplicaciones_antes jsonb;
  v_aplicaciones_despues jsonb;
  v_pagos_antes jsonb;
  v_pagos_despues jsonb;
  v_ajustes_antes jsonb;
  v_ajustes_despues jsonb;
  v_estado_actual jsonb;
  v_activos bigint;
  v_incoherencias bigint;
  v_aplicado bigint;
  v_saldo bigint;
  v_monto_ajustado bigint;
  v_identidad_antes jsonb;
  v_resultado jsonb;
begin
  if v_usuario is null then
    raise exception 'Debe iniciar sesión para marcar servicios realizados' using errcode = '42501';
  end if;
  if not private.haiku_usuario_activo() then
    raise exception 'Usuario no activo' using errcode = '42501';
  end if;
  if not private.haiku_tiene_permiso('servicios.editar') then
    raise exception 'Tu usuario no tiene permiso para editar servicios' using errcode = '42501';
  end if;
  if p_operacion_id is null or p_servicio_id is null
     or p_estado_esperado is null or jsonb_typeof(p_estado_esperado) is distinct from 'object' then
    raise exception 'Operación, servicio o estado esperado inválido';
  end if;

  v_hash := md5(jsonb_build_object(
    'servicio_id', p_servicio_id, 'estado_esperado', p_estado_esperado
  )::text);
  insert into private.haiku_marcar_servicio_realizado_asistente_operaciones_v1
    (operacion_id, usuario_id, servicio_id, solicitud_hash)
  values (p_operacion_id, v_usuario, p_servicio_id, v_hash)
  on conflict (operacion_id) do nothing;
  select * into v_operacion
  from private.haiku_marcar_servicio_realizado_asistente_operaciones_v1
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

  select reserva_id into v_reserva_id_previa from public.servicios where id = p_servicio_id;
  if not found then raise exception 'No se encontró el servicio'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_reserva_id_previa::text, 0));
  perform pg_advisory_xact_lock(
    private.haiku_libro_lock_key_v1('reserva_finanzas', v_reserva_id_previa::text)
  );
  select * into v_reserva from public.reservas
    where id = v_reserva_id_previa for update;
  if not found then raise exception 'No se encontró la reserva'; end if;
  select * into v_servicio from public.servicios
    where id = p_servicio_id for update;
  if not found then raise exception 'No se encontró el servicio'; end if;
  if v_servicio.reserva_id is distinct from v_reserva_id_previa then
    raise exception 'La propuesta quedó obsoleta; cambió la reserva del servicio'
      using errcode = '40001';
  end if;
  select * into v_estadia from public.reserva_estadias
    where id = v_servicio.estadia_id for update;
  select * into v_catalogo from public.catalogo_servicios
    where id = v_servicio.catalogo_servicio_id;
  -- FOR UPDATE sobre cargos impide insertar aplicaciones con FK mientras se revalida.
  perform 1 from public.cargos c where c.servicio_id = p_servicio_id
    order by c.id for update;
  perform 1 from public.pago_aplicaciones pa
    join public.cargos c on c.id = pa.cargo_id
    where c.servicio_id = p_servicio_id order by pa.id for update of pa;
  perform 1 from public.cargo_ajustes ca
    join public.cargos c on c.id = ca.cargo_id
    where c.servicio_id = p_servicio_id order by ca.id for update of ca;
  perform 1 from public.pagos p where p.reserva_id = v_servicio.reserva_id
    order by p.id for update;

  select max(re.checkout_realizado_en) into v_checkout
    from public.reserva_estadias re where re.reserva_id = v_servicio.reserva_id;
  select count(*) filter (where c.estado = 'activo'),
         coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
    into v_activos, v_cargos_antes
    from public.cargos c where c.servicio_id = p_servicio_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'cargo_id', ec.cargo_id, 'estado', ec.estado, 'monto', ec.monto,
      'monto_ajustado', ec.monto_ajustado, 'aplicado_neto', ec.aplicado_neto,
      'saldo_cargo', ec.saldo_cargo,
      'estado_pago', to_jsonb(ec) -> 'estado_pago',
      'ajuste_neto', to_jsonb(ec) -> 'ajuste_neto'
    ) order by ec.cargo_id), '[]'::jsonb)
    into v_finanzas_antes from public.vista_estado_cargos ec
    where ec.servicio_id = p_servicio_id;
  select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id), '[]'::jsonb)
    into v_aplicaciones_antes from public.pago_aplicaciones pa
    join public.cargos c on c.id = pa.cargo_id where c.servicio_id = p_servicio_id;
  select coalesce(jsonb_agg(to_jsonb(ca) order by ca.id), '[]'::jsonb)
    into v_ajustes_antes from public.cargo_ajustes ca
    join public.cargos c on c.id = ca.cargo_id where c.servicio_id = p_servicio_id;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
    into v_pagos_antes from public.pagos p where p.reserva_id = v_servicio.reserva_id;
  v_estado_actual := jsonb_build_object(
    'version', 1,
    'servicio', to_jsonb(v_servicio),
    'reserva', to_jsonb(v_reserva),
    'estadia', to_jsonb(v_estadia),
    'catalogo', to_jsonb(v_catalogo),
    'checkout_realizado_en', v_checkout,
    'cargos', v_cargos_antes,
    'finanzas', v_finanzas_antes,
    'aplicaciones', v_aplicaciones_antes,
    'pagos', v_pagos_antes,
    'ajustes', v_ajustes_antes
  );
  if p_estado_esperado is distinct from v_estado_actual then
    raise exception 'La propuesta quedó obsoleta; el servicio o sus finanzas cambiaron'
      using errcode = '40001';
  end if;
  if v_servicio.estado_servicio = 'realizado' then
    v_resultado := jsonb_build_object(
      'ok', true, 'operacion_id', p_operacion_id, 'reintento', false,
      'estado', 'already_realized', 'sin_cambios', true,
      'servicio_id', p_servicio_id
    );
    update private.haiku_marcar_servicio_realizado_asistente_operaciones_v1
      set resultado = v_resultado, completado_en = now() where operacion_id = p_operacion_id;
    return v_resultado;
  end if;
  if v_servicio.estado_servicio not in ('programado', 'en_proceso') then
    raise exception 'El estado operativo del servicio requiere revisión humana';
  end if;
  if v_reserva.estado_reserva not in ('pendiente', 'confirmada', 'hospedada')
     or v_checkout is not null then
    raise exception 'La reserva cerró o hizo check-out; requiere revisión humana';
  end if;
  if v_reserva.bove_checkout is not null or v_reserva.bove_cierre is not null then
    raise exception 'La reserva tiene BOVE de checkout o cierre; requiere revisión humana';
  end if;
  if v_estadia.id is null or v_estadia.reserva_id is distinct from v_reserva.id
     or v_estadia.estado_estadia not in ('pendiente', 'confirmada', 'hospedada')
     or v_estadia.checkout_realizado_en is not null then
    raise exception 'La estadía requiere revisión humana';
  end if;
  if v_catalogo.id is null or v_catalogo.activo is distinct from true then
    raise exception 'El catálogo del servicio requiere revisión humana';
  end if;
  if v_servicio.fecha_servicio > v_hoy then
    raise exception 'El servicio tiene fecha futura; requiere revisión humana';
  end if;
  if v_servicio.hora_inicio is not null and v_servicio.hora_fin is not null
     and v_servicio.hora_fin <= v_servicio.hora_inicio then
    raise exception 'El horario del servicio requiere revisión humana';
  end if;
  if v_servicio.fecha_servicio = v_hoy
     and (v_servicio.hora_fin is null or v_servicio.hora_fin > v_hora) then
    raise exception 'El horario del servicio aún no termina; requiere revisión humana';
  end if;
  if v_servicio.estado_servicio = 'en_proceso'
     and (v_servicio.hora_fin is null or v_servicio.fecha_servicio = v_hoy
          and v_servicio.hora_fin > v_hora) then
    raise exception 'El servicio en proceso aún no termina; requiere revisión humana';
  end if;
  if jsonb_array_length(v_ajustes_antes) <> 0 then
    raise exception 'El servicio tiene ajustes históricos; requiere revisión humana';
  end if;
  select count(*) into v_incoherencias from public.cargos c
    where c.servicio_id = p_servicio_id and (
      c.reserva_id is distinct from v_servicio.reserva_id
      or c.estadia_id is distinct from v_servicio.estadia_id
      or c.tipo_cargo is distinct from 'servicio'
      or c.estadia_noche_id is not null
      or c.estado not in ('activo', 'anulado'));
  if v_incoherencias <> 0 then
    raise exception 'El historial de cargos requiere revisión humana';
  end if;
  if v_servicio.tipo_cobro = 'normal' then
    if v_servicio.total is null or v_servicio.total <= 0 or v_activos <> 1 then
      raise exception 'El cargo normal requiere revisión humana';
    end if;
    select * into v_cargo from public.cargos c
      where c.servicio_id = p_servicio_id and c.estado = 'activo';
    if v_cargo.monto is distinct from v_servicio.total
       or v_cargo.concepto is distinct from v_catalogo.nombre
       or v_cargo.moneda is distinct from 'CLP'
       or exists (select 1 from public.pago_aplicaciones pa
         join public.cargos c on c.id = pa.cargo_id
         where c.servicio_id = p_servicio_id and c.id <> v_cargo.id) then
      raise exception 'El cargo o sus aplicaciones requieren revisión humana';
    end if;
    if exists (select 1 from public.pago_aplicaciones pa
      join public.pagos p on p.id = pa.pago_id
      where pa.cargo_id = v_cargo.id and (
        p.reserva_id is distinct from v_servicio.reserva_id
        or p.estado is distinct from 'confirmado'
        or p.tipo_movimiento not in ('pago', 'devolucion')
        or pa.monto_aplicado <= 0)) then
      raise exception 'Los pagos del servicio requieren revisión humana';
    end if;
    select ec.aplicado_neto, ec.saldo_cargo, ec.monto_ajustado
      into v_aplicado, v_saldo, v_monto_ajustado
      from public.vista_estado_cargos ec where ec.cargo_id = v_cargo.id;
    if v_aplicado is null or v_aplicado < 0 or v_aplicado > v_cargo.monto
       or v_monto_ajustado is distinct from v_cargo.monto
       or v_saldo is distinct from v_cargo.monto - v_aplicado then
      raise exception 'El saldo del servicio requiere revisión humana';
    end if;
  elsif v_servicio.tipo_cobro = 'cortesia' then
    if v_servicio.total is distinct from 0
       or nullif(btrim(coalesce(v_servicio.motivo_cortesia, '')), '') is null
       or v_activos <> 0 or jsonb_array_length(v_aplicaciones_antes) <> 0 then
      raise exception 'La cortesía o sus finanzas requieren revisión humana';
    end if;
  else
    raise exception 'El tipo de cobro requiere revisión humana';
  end if;

  v_identidad_antes := to_jsonb(v_servicio) - 'estado_servicio' - 'actualizado_en';
  perform set_config('app.haiku_origen', 'haku', true);
  perform set_config('app.haiku_operacion_id', p_operacion_id::text, true);
  update public.servicios set estado_servicio = 'realizado', actualizado_en = now()
    where id = p_servicio_id;
  select * into v_despues from public.servicios where id = p_servicio_id;
  if v_despues.estado_servicio is distinct from 'realizado'
     or (to_jsonb(v_despues) - 'estado_servicio' - 'actualizado_en')
        is distinct from v_identidad_antes then
    raise exception 'Falló la postcondición del servicio; no se guardó el cambio';
  end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
    into v_cargos_despues from public.cargos c where c.servicio_id = p_servicio_id;
  if (select coalesce(jsonb_agg(
        case when x ->> 'estado' = 'activo' then x - 'actualizado_en' else x end
        order by posicion), '[]'::jsonb)
      from jsonb_array_elements(v_cargos_despues) with ordinality as t(x, posicion))
     is distinct from
     (select coalesce(jsonb_agg(
        case when x ->> 'estado' = 'activo' then x - 'actualizado_en' else x end
        order by posicion), '[]'::jsonb)
      from jsonb_array_elements(v_cargos_antes) with ordinality as t(x, posicion)) then
    raise exception 'Falló la postcondición de cargos; no se guardó el cambio';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'cargo_id', ec.cargo_id, 'estado', ec.estado, 'monto', ec.monto,
      'monto_ajustado', ec.monto_ajustado, 'aplicado_neto', ec.aplicado_neto,
      'saldo_cargo', ec.saldo_cargo,
      'estado_pago', to_jsonb(ec) -> 'estado_pago',
      'ajuste_neto', to_jsonb(ec) -> 'ajuste_neto'
    ) order by ec.cargo_id), '[]'::jsonb)
    into v_finanzas_despues from public.vista_estado_cargos ec
    where ec.servicio_id = p_servicio_id;
  if v_finanzas_despues is distinct from v_finanzas_antes then
    raise exception 'Falló la postcondición financiera; no se guardó el cambio';
  end if;
  select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id), '[]'::jsonb)
    into v_aplicaciones_despues from public.pago_aplicaciones pa
    join public.cargos c on c.id = pa.cargo_id where c.servicio_id = p_servicio_id;
  select coalesce(jsonb_agg(to_jsonb(ca) order by ca.id), '[]'::jsonb)
    into v_ajustes_despues from public.cargo_ajustes ca
    join public.cargos c on c.id = ca.cargo_id where c.servicio_id = p_servicio_id;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
    into v_pagos_despues from public.pagos p where p.reserva_id = v_servicio.reserva_id;
  if v_aplicaciones_despues is distinct from v_aplicaciones_antes
     or v_ajustes_despues is distinct from v_ajustes_antes
     or v_pagos_despues is distinct from v_pagos_antes then
    raise exception 'Falló la postcondición de pagos; no se guardó el cambio';
  end if;
  if (select to_jsonb(r) from public.reservas r where r.id = v_reserva.id)
       is distinct from to_jsonb(v_reserva)
     or (select max(re.checkout_realizado_en) from public.reserva_estadias re
         where re.reserva_id = v_reserva.id) is distinct from v_checkout then
    raise exception 'Falló la postcondición de reserva/BOVE; no se guardó el cambio';
  end if;
  if (select count(*) from public.eventos_auditoria ea
      where ea.entidad_tipo = 'servicios' and ea.entidad_id = p_servicio_id
        and ea.reserva_id = v_servicio.reserva_id and ea.usuario_id = v_usuario
        and ea.origen = 'haku'
        and ea.datos_contexto ->> 'operacion_id' = p_operacion_id::text
        and exists (select 1 from jsonb_array_elements(ea.cambios) cambio
          where cambio ->> 'campo' = 'estado_servicio'
            and cambio ->> 'anterior' = v_servicio.estado_servicio
            and cambio ->> 'nuevo' = 'realizado')) <> 1 then
    raise exception 'No se pudo acreditar la auditoría; no se guardó el cambio';
  end if;
  v_resultado := jsonb_build_object(
    'ok', true, 'operacion_id', p_operacion_id, 'reintento', false,
    'estado', 'realized', 'sin_cambios', false,
    'servicio_id', p_servicio_id, 'reserva_id', v_servicio.reserva_id,
    'estado_anterior', v_servicio.estado_servicio, 'estado_servicio', 'realizado',
    'tipo_cobro', v_servicio.tipo_cobro, 'total', v_servicio.total,
    'cargo_activo_id', case when v_servicio.tipo_cobro = 'normal' then v_cargo.id else null end,
    'saldo_cargo', case when v_servicio.tipo_cobro = 'normal' then v_saldo else null end
  );
  update private.haiku_marcar_servicio_realizado_asistente_operaciones_v1
    set resultado = v_resultado, completado_en = now() where operacion_id = p_operacion_id;
  return v_resultado;
end;
$function$;

comment on function public.haiku_marcar_servicio_realizado_asistente_v1(uuid,uuid,jsonb) is
'Marca un servicio terminado como realizado con estado esperado, auditoría, idempotencia y postcondiciones financieras; no liquida deuda.';

revoke all on function public.haiku_marcar_servicio_realizado_asistente_v1(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.haiku_marcar_servicio_realizado_asistente_v1(uuid,uuid,jsonb)
  to authenticated;
