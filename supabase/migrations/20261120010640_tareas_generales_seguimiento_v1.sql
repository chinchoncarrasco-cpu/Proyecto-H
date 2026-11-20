-- Tareas de áreas comunes: autoridad compartida, revisión y movimientos inmutables.
create table public.tareas_generales (
 id uuid primary key default gen_random_uuid(),
 fecha_operativa date not null,
 tipo text not null check (tipo in ('lavanderia','cocina','recepcion','jardines_terraza','banos')),
 encargado text not null default '' check (length(encargado)<=120),
 revisor text not null default '' check (length(revisor)<=120),
 estado text not null default 'pendiente' check (estado in ('pendiente','en_curso','realizada','verificada','con_detalles')),
 nota text not null default '' check (length(nota)<=2000),
 iniciada_en timestamptz,
 realizada_en timestamptz,
 verificada_en timestamptz,
 verificada_por uuid,
 verificada_por_nombre text not null default '',
 revision bigint not null default 0 check (revision>=0),
 creado_por uuid not null,
 actualizado_por uuid not null,
 actualizado_en timestamptz not null default clock_timestamp(),
 unique(fecha_operativa,tipo),
 check (estado not in ('realizada','verificada') or realizada_en is not null),
 check (estado<>'en_curso' or iniciada_en is not null),
 check ((estado='verificada') = (verificada_en is not null and verificada_por is not null and verificada_por_nombre<>''))
);
create index tareas_generales_pendientes_idx on public.tareas_generales(fecha_operativa,tipo) where estado<>'verificada';
create table public.tareas_generales_movimientos (
 id uuid primary key default gen_random_uuid(),
 tarea_id uuid not null references public.tareas_generales(id),
 operacion_id uuid not null unique,
 accion text not null,
 datos jsonb not null,
 anterior jsonb not null,
 resultado jsonb not null,
 actor_id uuid not null,
 actor_nombre text not null,
 creado_en timestamptz not null default clock_timestamp()
);
create index tareas_generales_movimientos_tarea_idx on public.tareas_generales_movimientos(tarea_id,creado_en desc);
alter table public.tareas_generales enable row level security;
alter table public.tareas_generales_movimientos enable row level security;
revoke all on public.tareas_generales,public.tareas_generales_movimientos from public,anon,authenticated;
grant select on public.tareas_generales,public.tareas_generales_movimientos to authenticated;
create policy tareas_generales_lectura on public.tareas_generales for select to authenticated
 using (private.haiku_usuario_activo() and (private.haiku_tiene_permiso('aseos.ver_todos') or private.haiku_tiene_permiso('revisiones.ver')));
create policy tareas_generales_movimientos_lectura on public.tareas_generales_movimientos for select to authenticated
 using (private.haiku_usuario_activo() and (private.haiku_tiene_permiso('aseos.ver_todos') or private.haiku_tiene_permiso('revisiones.ver')));

create function private.haiku_catalogo_tareas_generales_v1()
returns table(tipo text,titulo text,descripcion text,orden integer)
language sql immutable security invoker set search_path='' as $$
 values ('lavanderia','Lavandería','Lavar, colgar y doblar; planchar y tender.',1),
 ('cocina','Limpiar cocina','Cocina de uso común.',2),
 ('recepcion','Limpiar recepción','Limpieza de recepción.',3),
 ('jardines_terraza','Limpiar jardines y terraza','Jardines y terraza Sra. Naifi.',4),
 ('banos','Limpiar baños','Baños de áreas comunes.',5)
$$;
revoke all on function private.haiku_catalogo_tareas_generales_v1() from public,anon;
grant execute on function private.haiku_catalogo_tareas_generales_v1() to authenticated;

create function public.haiku_tareas_generales_dia_v1(p_fecha date) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or not private.haiku_usuario_activo() or not (private.haiku_tiene_permiso('aseos.ver_todos') or private.haiku_tiene_permiso('revisiones.ver')) then
  raise exception 'Tu usuario no tiene permiso para consultar las tareas generales.' using errcode='42501';
 end if;
 if p_fecha is null then raise exception 'Selecciona una fecha operativa.' using errcode='22023'; end if;
 return jsonb_build_object('fecha',p_fecha,
  'puede_editar',private.haiku_tiene_permiso('aseos.gestionar_todos') or private.haiku_tiene_permiso('revisiones.gestionar'),
  'puede_verificar',private.haiku_tiene_permiso('revisiones.gestionar'),
  'tareas',(select jsonb_agg(
    jsonb_build_object('fecha_operativa',p_fecha,'tipo',c.tipo,'estado','pendiente','encargado','','revisor','','nota','','revision',0)
    || coalesce(to_jsonb(t),'{}'::jsonb)
    || jsonb_build_object('titulo',c.titulo,'descripcion',c.descripcion)
    order by c.orden)
   from private.haiku_catalogo_tareas_generales_v1() c left join public.tareas_generales t on t.tipo=c.tipo and t.fecha_operativa=p_fecha),
  'anteriores',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('titulo',c.titulo,'descripcion',c.descripcion) order by t.fecha_operativa,c.orden)
   from public.tareas_generales t join private.haiku_catalogo_tareas_generales_v1() c using(tipo)
   where t.fecha_operativa<p_fecha and t.estado<>'verificada'),'[]'::jsonb));
end $$;
revoke all on function public.haiku_tareas_generales_dia_v1(date) from public,anon;
grant execute on function public.haiku_tareas_generales_dia_v1(date) to authenticated;

-- Sólo esta función puede escribir: evita alterar auditoría o marcar revisiones por REST.
create function private.haiku_guardar_tarea_general_v1(p_fecha date,p_tipo text,p_revision bigint,p_accion text,p_datos jsonb,p_operacion uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.tareas_generales; m public.tareas_generales_movimientos; v_antes jsonb; v_actor text;
 v_encargado text; v_revisor text; v_nota text; v_ahora timestamptz:=clock_timestamp();
begin
 if auth.uid() is null or not private.haiku_usuario_activo() or not (private.haiku_tiene_permiso('aseos.gestionar_todos') or private.haiku_tiene_permiso('revisiones.gestionar')) then
  raise exception 'Tu usuario no tiene permiso para modificar las tareas generales.' using errcode='42501';
 end if;
 if p_fecha is null or p_tipo is null or not exists(select 1 from private.haiku_catalogo_tareas_generales_v1() c where c.tipo=p_tipo)
  or p_revision is null or p_revision<0 or p_operacion is null or jsonb_typeof(p_datos) is distinct from 'object'
  or p_accion is null or p_accion not in ('asignar','iniciar','realizar','verificar','corregir','nota') then
  raise exception 'La tarea o el cambio solicitado no es válido.' using errcode='22023';
 end if;
 if p_accion in ('verificar','corregir') and not private.haiku_tiene_permiso('revisiones.gestionar') then
  raise exception 'Tu usuario no tiene permiso para verificar las tareas generales.' using errcode='42501';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operacion::text,0));
 select * into m from public.tareas_generales_movimientos where operacion_id=p_operacion;
 if found then
  if m.actor_id<>auth.uid() or m.accion<>p_accion or m.datos<>jsonb_build_object('fecha',p_fecha,'tipo',p_tipo,'datos',p_datos,'revision',p_revision) then
   raise exception 'Este intento corresponde a otro cambio. Actualiza la tarea.' using errcode='22023';
  end if;
  select * into r from public.tareas_generales where id=m.tarea_id;
  return jsonb_build_object('tarea',to_jsonb(r),'repetida',true);
 end if;
 if p_accion in ('iniciar','realizar','verificar') and p_fecha>(clock_timestamp() at time zone 'America/Santiago')::date then
  raise exception 'No se puede completar una tarea de una fecha futura.' using errcode='22023';
 end if;
 select btrim(concat_ws(' ',nullif(nombre,''),nullif(apellido,''))) into v_actor from public.usuarios where id=auth.uid();
 v_actor:=coalesce(nullif(v_actor,''),'Usuario');
 insert into public.tareas_generales(fecha_operativa,tipo,creado_por,actualizado_por)
  values(p_fecha,p_tipo,auth.uid(),auth.uid()) on conflict(fecha_operativa,tipo) do nothing;
 select * into r from public.tareas_generales where fecha_operativa=p_fecha and tipo=p_tipo for update;
 if r.revision<>p_revision then
  raise exception 'La tarea cambió en otro dispositivo. Actualiza y revisa el cambio antes de guardar.' using errcode='40001';
 end if;
 v_antes:=to_jsonb(r);
 if p_accion='asignar' then
  if r.estado in ('realizada','verificada') then raise exception 'Solicita una corrección antes de cambiar una tarea realizada.' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_datos) k where k not in ('encargado','revisor')) then raise exception 'Campo de asignación no válido.' using errcode='22023'; end if;
  if (p_datos ? 'encargado' and jsonb_typeof(p_datos->'encargado')<>'string') or (p_datos ? 'revisor' and jsonb_typeof(p_datos->'revisor')<>'string') then raise exception 'Escribe un nombre válido.' using errcode='22023'; end if;
  v_encargado:=btrim(coalesce(p_datos->>'encargado',r.encargado)); v_revisor:=btrim(coalesce(p_datos->>'revisor',r.revisor));
  if length(v_encargado)>120 or length(v_revisor)>120 or (v_encargado='' and (r.estado='en_curso' or (r.revision=0 and v_revisor=''))) then
   raise exception 'Indica un responsable o revisor válido.' using errcode='22023';
  end if;
  r.encargado:=v_encargado; r.revisor:=v_revisor;
 elsif p_accion in ('iniciar','realizar') then
  if r.encargado='' then raise exception 'Asigna un responsable antes de iniciar o completar la tarea.' using errcode='22023'; end if;
  if (p_accion='iniciar' and r.estado not in ('pendiente','con_detalles')) or (p_accion='realizar' and r.estado not in ('pendiente','con_detalles','en_curso')) then
   raise exception 'El estado actual no permite este cambio. Actualiza la tarea.' using errcode='22023';
  end if;
  if p_accion='iniciar' then r.estado:='en_curso'; r.iniciada_en:=v_ahora;
  else r.estado:='realizada'; r.realizada_en:=v_ahora; end if;
 elsif p_accion='verificar' then
  if r.estado<>'realizada' then raise exception 'Primero marca la tarea como realizada para verificarla.' using errcode='22023'; end if;
  r.estado:='verificada'; r.verificada_en:=v_ahora; r.verificada_por:=auth.uid(); r.verificada_por_nombre:=v_actor;
 elsif p_accion in ('corregir','nota') then
  if jsonb_typeof(p_datos->'nota') is distinct from 'string' then raise exception 'Escribe una nota para registrar este cambio.' using errcode='22023'; end if;
  v_nota:=btrim(p_datos->>'nota');
  if v_nota='' or length(v_nota)>2000 then raise exception 'Escribe una nota de hasta 2.000 caracteres.' using errcode='22023'; end if;
  r.nota:=v_nota;
  if p_accion='corregir' then
   if r.estado not in ('realizada','verificada') then raise exception 'Sólo se puede pedir corrección de una tarea realizada o verificada.' using errcode='22023'; end if;
   r.estado:='con_detalles'; r.iniciada_en:=null; r.realizada_en:=null; r.verificada_en:=null; r.verificada_por:=null; r.verificada_por_nombre:='';
  end if;
 end if;
 r.revision:=r.revision+1; r.actualizado_por:=auth.uid(); r.actualizado_en:=v_ahora;
 update public.tareas_generales set encargado=r.encargado,revisor=r.revisor,estado=r.estado,nota=r.nota,
  iniciada_en=r.iniciada_en,realizada_en=r.realizada_en,verificada_en=r.verificada_en,verificada_por=r.verificada_por,
  verificada_por_nombre=r.verificada_por_nombre,revision=r.revision,actualizado_por=r.actualizado_por,actualizado_en=r.actualizado_en
  where id=r.id;
 insert into public.tareas_generales_movimientos(tarea_id,operacion_id,accion,datos,anterior,resultado,actor_id,actor_nombre,creado_en)
  values(r.id,p_operacion,p_accion,jsonb_build_object('fecha',p_fecha,'tipo',p_tipo,'datos',p_datos,'revision',p_revision),v_antes,to_jsonb(r),auth.uid(),v_actor,v_ahora);
 return jsonb_build_object('tarea',to_jsonb(r),'repetida',false);
end $$;
revoke all on function private.haiku_guardar_tarea_general_v1(date,text,bigint,text,jsonb,uuid) from public,anon;
grant execute on function private.haiku_guardar_tarea_general_v1(date,text,bigint,text,jsonb,uuid) to authenticated;
create function public.haiku_guardar_tarea_general_v1(p_fecha date,p_tipo text,p_revision bigint,p_accion text,p_datos jsonb,p_operacion uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.haiku_guardar_tarea_general_v1(p_fecha,p_tipo,p_revision,p_accion,p_datos,p_operacion)
$$;
revoke all on function public.haiku_guardar_tarea_general_v1(date,text,bigint,text,jsonb,uuid) from public,anon;
grant execute on function public.haiku_guardar_tarea_general_v1(date,text,bigint,text,jsonb,uuid) to authenticated;

create function public.haiku_tareas_generales_historial_v1(p_fecha date,p_tipo text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or not private.haiku_usuario_activo() or not (private.haiku_tiene_permiso('aseos.ver_todos') or private.haiku_tiene_permiso('revisiones.ver')) then
  raise exception 'Tu usuario no tiene permiso para consultar el historial de tareas.' using errcode='42501';
 end if;
 if p_fecha is null then raise exception 'Selecciona una fecha operativa.' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.creado_en desc,x.id desc) from (
  select m.id,t.fecha_operativa,c.titulo,m.accion,m.datos->'datos' as detalle,m.resultado->>'estado' as estado,m.actor_nombre,m.creado_en
  from public.tareas_generales_movimientos m join public.tareas_generales t on t.id=m.tarea_id
  join private.haiku_catalogo_tareas_generales_v1() c using(tipo)
  where (p_tipo is not null and t.tipo=p_tipo and t.fecha_operativa=p_fecha)
   or (p_tipo is null and (t.fecha_operativa=p_fecha or (m.creado_en at time zone 'America/Santiago')::date=p_fecha))
  order by m.creado_en desc,m.id desc limit 100
 ) x),'[]'::jsonb);
end $$;
revoke all on function public.haiku_tareas_generales_historial_v1(date,text) from public,anon;
grant execute on function public.haiku_tareas_generales_historial_v1(date,text) to authenticated;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.tareas_generales;
 end if;
end $$;
