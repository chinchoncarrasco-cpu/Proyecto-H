-- Reprograma la única tinaja de cortesía de un Full Day, previa confirmación.
-- El registro privado acredita reintentos y el trigger existente registra las horas.
create table private.haiku_libro_tinaja_horario_operaciones_v1 (
  operacion_id uuid primary key,
  usuario_id uuid not null,
  solicitud_hash text not null,
  resultado jsonb,
  creado_en timestamptz not null default now()
);
alter table private.haiku_libro_tinaja_horario_operaciones_v1 enable row level security;
revoke all on table private.haiku_libro_tinaja_horario_operaciones_v1 from public, anon, authenticated;

create function public.haiku_libro_reprogramar_tinaja_fullday_v1(
  p_operacion_id uuid, p_servicio_id uuid, p_estado_esperado jsonb,
  p_hora_inicio time, p_hora_fin time
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_usuario uuid := auth.uid();
  v_hash text;
  v_operacion private.haiku_libro_tinaja_horario_operaciones_v1%rowtype;
  v_reserva_id uuid;
  v_reserva public.reservas%rowtype;
  v_estadia public.reserva_estadias%rowtype;
  v_servicio public.servicios%rowtype;
  v_esperado public.servicios%rowtype;
  v_despues public.servicios%rowtype;
  v_codigo text;
  v_resultado jsonb;
begin
  if v_usuario is null or not private.haiku_usuario_activo()
     or not private.haiku_tiene_permiso('servicios.editar') then
    raise exception 'Debe iniciar sesión con permiso para editar servicios' using errcode='42501';
  end if;
  if p_operacion_id is null or p_servicio_id is null or
     jsonb_typeof(p_estado_esperado) is distinct from 'object' or
     not p_estado_esperado ?& array['id','reserva_id','estadia_id','catalogo_servicio_id',
       'fecha_servicio','hora_inicio','hora_fin','cantidad','personas','tipo_cobro','total',
       'estado_servicio','actualizado_en'] or
     p_hora_inicio is null or p_hora_fin is null or
     p_hora_inicio < time '09:30' or p_hora_fin > time '21:30' or
     p_hora_fin - p_hora_inicio <> interval '1 hour' then
    raise exception 'Se requiere el estado completo y una hora dentro del Full Day';
  end if;
  v_hash := md5(jsonb_build_object('servicio',p_servicio_id,'esperado',p_estado_esperado,
    'inicio',p_hora_inicio,'fin',p_hora_fin)::text);
  insert into private.haiku_libro_tinaja_horario_operaciones_v1(operacion_id,usuario_id,solicitud_hash)
    values(p_operacion_id,v_usuario,v_hash) on conflict(operacion_id) do nothing;
  select * into v_operacion from private.haiku_libro_tinaja_horario_operaciones_v1
    where operacion_id=p_operacion_id for update;
  if v_operacion.usuario_id is distinct from v_usuario or
     v_operacion.solicitud_hash is distinct from v_hash then
    raise exception 'La operación pertenece a otro usuario o solicitud' using errcode='42501';
  end if;
  if v_operacion.resultado is not null then
    return v_operacion.resultado || jsonb_build_object('reintento',true);
  end if;

  select reserva_id into v_reserva_id from public.servicios where id=p_servicio_id;
  if not found then raise exception 'No se encontró la tinaja'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_reserva_id::text,0));
  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',v_reserva_id::text));
  select * into v_reserva from public.reservas where id=v_reserva_id for update;
  select * into v_servicio from public.servicios where id=p_servicio_id for update;
  select * into v_estadia from public.reserva_estadias where id=v_servicio.estadia_id for update;
  select codigo into v_codigo from public.catalogo_servicios
    where id=v_servicio.catalogo_servicio_id and activo and permite_cortesia;
  v_esperado := jsonb_populate_record(null::public.servicios,p_estado_esperado);
  if row(v_servicio.id,v_servicio.reserva_id,v_servicio.estadia_id,v_servicio.catalogo_servicio_id,
       v_servicio.fecha_servicio,v_servicio.hora_inicio,v_servicio.hora_fin,v_servicio.cantidad,
       v_servicio.personas,v_servicio.tipo_cobro,v_servicio.total,v_servicio.estado_servicio,v_servicio.actualizado_en)
     is distinct from
     row(v_esperado.id,v_esperado.reserva_id,v_esperado.estadia_id,v_esperado.catalogo_servicio_id,
       v_esperado.fecha_servicio,v_esperado.hora_inicio,v_esperado.hora_fin,v_esperado.cantidad,
       v_esperado.personas,v_esperado.tipo_cobro,v_esperado.total,v_esperado.estado_servicio,v_esperado.actualizado_en) then
    raise exception 'La tinaja cambió desde la revisión; vuelve a consultar' using errcode='40001';
  end if;
  if v_reserva.id is null or v_servicio.reserva_id is distinct from v_reserva_id or
     v_reserva.estado_reserva not in ('pendiente','confirmada','hospedada','checked_out') or
     v_estadia.reserva_id is distinct from v_reserva_id or
     v_estadia.tipo_estadia is distinct from 'fullday' or
     v_estadia.fecha_ingreso is distinct from v_estadia.fecha_salida or
     v_servicio.fecha_servicio is distinct from v_estadia.fecha_ingreso or
     v_estadia.estado_estadia not in ('pendiente','confirmada','hospedada','checked_out') or
     v_codigo is null or v_codigo not in ('tinajaTonel','tinajaJacuzzi') or
     v_servicio.estado_servicio is distinct from 'programado' or
     v_servicio.tipo_cobro is distinct from 'cortesia' or v_servicio.total is distinct from 0::bigint or
     v_servicio.cantidad is distinct from 1 or v_servicio.personas not between 1 and 3 or
     v_servicio.hora_inicio is null or v_servicio.hora_fin is null or
     v_servicio.hora_fin-v_servicio.hora_inicio <> interval '1 hour' or
     v_servicio.hora_inicio < time '09:30' or v_servicio.hora_fin > time '21:30' then
    raise exception 'La tinaja requiere revisión; sólo se reprograma una hora de cortesía de Full Day';
  end if;
  if (select count(*) from public.servicios s join public.catalogo_servicios c on c.id=s.catalogo_servicio_id
      where s.reserva_id=v_reserva_id and (s.estadia_id=v_estadia.id or s.estadia_id is null)
        and c.codigo in ('tinajaTonel','tinajaJacuzzi') and s.estado_servicio not in ('cancelado','no_show')) <> 1 then
    raise exception 'Hay más de una tinaja; confirma primero cuál corresponde al cambio de horario';
  end if;
  if exists(select 1 from public.cargos where servicio_id=p_servicio_id) then
    raise exception 'La tinaja tiene historial de cargos; requiere revisión';
  end if;
  if p_hora_inicio=v_servicio.hora_inicio and p_hora_fin=v_servicio.hora_fin then
    raise exception 'La tinaja ya tiene ese horario; vuelve a consultar';
  end if;
  -- Coordina los cambios asistidos del mismo recurso y comprueba superposición.
  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('tinaja_horario',
    coalesce(v_servicio.recurso_id,v_servicio.catalogo_servicio_id)::text || ':' || v_servicio.fecha_servicio::text));
  if exists(select 1 from public.servicios s where s.id<>p_servicio_id
      and s.fecha_servicio=v_servicio.fecha_servicio and s.estado_servicio not in ('cancelado','no_show')
      and (s.recurso_id=v_servicio.recurso_id or
        (s.recurso_id is null or v_servicio.recurso_id is null) and s.catalogo_servicio_id=v_servicio.catalogo_servicio_id)
      and s.hora_inicio<p_hora_fin and s.hora_fin>p_hora_inicio) then
    raise exception 'El horario del Libro se superpone con otra tinaja registrada';
  end if;
  perform set_config('app.haiku_origen','haku',true);
  perform set_config('app.haiku_operacion_id',p_operacion_id::text,true);
  update public.servicios set hora_inicio=p_hora_inicio,hora_fin=p_hora_fin,actualizado_en=now()
    where id=p_servicio_id returning * into v_despues;
  if (to_jsonb(v_despues)-array['hora_inicio','hora_fin','actualizado_en']) is distinct from
     (to_jsonb(v_servicio)-array['hora_inicio','hora_fin','actualizado_en']) or
     v_despues.hora_inicio is distinct from p_hora_inicio or v_despues.hora_fin is distinct from p_hora_fin then
    raise exception 'No se pudo conservar el servicio original; no se guardó el cambio';
  end if;
  if (select count(*) from public.eventos_auditoria ea where ea.entidad_tipo='servicios'
      and ea.entidad_id=p_servicio_id and ea.usuario_id=v_usuario and ea.origen='haku'
      and ea.datos_contexto->>'operacion_id'=p_operacion_id::text
      and exists(select 1 from jsonb_array_elements(ea.cambios) c where c->>'campo'='hora_inicio')
      and exists(select 1 from jsonb_array_elements(ea.cambios) c where c->>'campo'='hora_fin')) <> 1 then
    raise exception 'No se pudo acreditar el cambio de horario en el historial';
  end if;
  v_resultado := jsonb_build_object('ok',true,'operacion_id',p_operacion_id,'servicio_id',p_servicio_id,
    'reserva_id',v_reserva_id,'hora_inicio',p_hora_inicio,'hora_fin',p_hora_fin,'tipo_cobro','cortesia','total',0);
  update private.haiku_libro_tinaja_horario_operaciones_v1 set resultado=v_resultado where operacion_id=p_operacion_id;
  return v_resultado;
end;
$function$;
revoke all on function public.haiku_libro_reprogramar_tinaja_fullday_v1(uuid,uuid,jsonb,time,time) from public,anon,authenticated;
grant execute on function public.haiku_libro_reprogramar_tinaja_fullday_v1(uuid,uuid,jsonb,time,time) to authenticated;
comment on function public.haiku_libro_reprogramar_tinaja_fullday_v1(uuid,uuid,jsonb,time,time) is
'Confirma un cambio de horario de la única tinaja de cortesía Full Day; conserva identidad, precio y finanzas, con estado esperado, idempotencia e historial.';
