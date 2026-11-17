-- Reprogramación operativa revisada. Conserva noches, cargos, pagos y aplicaciones.
alter table public.servicios add column reprogramacion_revision_v1 jsonb;
create table private.haiku_reprogramaciones_v1(
 operacion_id uuid primary key,usuario_id uuid not null,reserva_id uuid not null,estadia_id uuid not null,
 solicitud_hash text not null,origen jsonb not null,destino jsonb not null,resultado jsonb,
 creado_en timestamptz not null default now(),completado_en timestamptz
);
alter table private.haiku_reprogramaciones_v1 enable row level security;
revoke all on private.haiku_reprogramaciones_v1 from public,anon,authenticated;

create function private.haiku_reprogramacion_contexto_v1(p_estadia uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public,private as $$
 select exists(select 1 from private.haiku_reprogramaciones_v1 o where o.estadia_id=p_estadia
  and o.operacion_id::text=nullif(current_setting('app.haiku_reprogramacion_v1',true),'')
  and o.usuario_id=auth.uid() and o.resultado is null);
$$;
revoke all on function private.haiku_reprogramacion_contexto_v1(uuid) from public,anon,authenticated;
grant execute on function private.haiku_reprogramacion_contexto_v1(uuid) to authenticated;

create function private.haiku_reprogramacion_finanzas_v1(p_reserva uuid) returns text
language sql stable security definer set search_path=pg_catalog,public,private as $$
 select md5(jsonb_build_array(
  (select jsonb_agg(to_jsonb(c) order by c.id) from public.cargos c where c.reserva_id=p_reserva),
  (select jsonb_agg(to_jsonb(p) order by p.id) from public.pagos p where p.reserva_id=p_reserva),
  (select jsonb_agg(to_jsonb(a) order by a.id) from public.pago_aplicaciones a join public.cargos c on c.id=a.cargo_id where c.reserva_id=p_reserva),
  (select jsonb_agg(to_jsonb(a) order by a.id) from public.cargo_ajustes a where a.reserva_id=p_reserva)
 )::text);
$$;
revoke all on function private.haiku_reprogramacion_finanzas_v1(uuid) from public,anon,authenticated;

create function private.haiku_reprogramacion_preparar_v1(p_reserva uuid,p_estadia uuid,p_destino jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare
 e public.reserva_estadias%rowtype; r public.reservas%rowtype; cab public.cabanas%rowtype;
 ingreso date:=(p_destino->>'fecha_ingreso')::date; salida date:=(p_destino->>'fecha_salida')::date;
 origen jsonb; destino jsonb; snapshot jsonb; items jsonb:='[]'; bloqueos jsonb:='[]';
 x record; propuesta date; estado text; motivo text; opciones jsonb; inicial text; recurso uuid; conflictos jsonb;
 valido boolean; es_fijo boolean; recursos jsonb;
begin
 if auth.uid() is null or private.haiku_usuario_activo() is distinct from true
  or private.haiku_tiene_permiso('reservas.ver') is distinct from true
  or private.haiku_tiene_permiso('reservas.editar') is distinct from true
  or private.haiku_tiene_permiso('servicios.ver') is distinct from true then
  raise exception 'Se requieren sesión activa y permisos para revisar reserva y servicios' using errcode='42501';
 end if;
 select * into e from public.reserva_estadias where id=p_estadia and reserva_id=p_reserva;
 select * into r from public.reservas where id=p_reserva;
 select * into cab from public.cabanas where numero=(p_destino->>'cabana_numero')::integer and activa;
 if e.id is null or r.id is null or cab.id is null or ingreso is null or salida is null then raise exception 'Identifica la estadía y su destino'; end if;
 if e.estado_estadia in('cancelada','no_show','hospedada','checked_out') or r.estado_reserva in('cancelada','no_show')
  or e.checkin_realizado_en is not null or e.checkout_realizado_en is not null then
  bloqueos:=bloqueos||jsonb_build_array('La estadía tiene estado operativo o ingreso/salida registrados. Revisa su historial antes de reprogramar.');
 end if;
 if salida-ingreso<>e.fecha_salida-e.fecha_ingreso or salida<ingreso then
  bloqueos:=bloqueos||jsonb_build_array('Cambió la duración. Revisa primero las noches y su tarifa; este traslado conserva los cargos y las aplicaciones.');
 end if;
 if exists(select 1 from public.reserva_estadias otra where otra.id<>e.id and otra.cabana_id=cab.id
  and otra.estado_estadia not in('cancelada','no_show') and otra.fecha_ingreso<case when e.tipo_estadia='fullday' then salida+1 else salida end
  and case when otra.tipo_estadia='fullday' then otra.fecha_salida+1 else otra.fecha_salida end>ingreso) then
  bloqueos:=bloqueos||jsonb_build_array('La cabaña destino está ocupada en esas fechas.');
 end if;
 if exists(select 1 from public.bloqueos_cabana b where b.cabana_id=cab.id and b.estado='activo'
  and b.desde::date<case when e.tipo_estadia='fullday' then salida+1 else salida end and b.hasta::date>ingreso) then
  bloqueos:=bloqueos||jsonb_build_array('La cabaña destino tiene un bloqueo; revisa su disponibilidad.');
 end if;
 if exists(select 1 from public.notas where reserva_id=p_reserva) and private.haiku_tiene_permiso('notas.gestionar') is distinct from true then
  raise exception 'Se requiere permiso para revisar las notas de esta reserva' using errcode='42501';
 end if;
 if exists(select 1 from public.servicios where estadia_id=e.id and estado_servicio='programado')
  and private.haiku_tiene_permiso('servicios.editar') is distinct from true then
  bloqueos:=bloqueos||jsonb_build_array('Hay servicios programados; se requiere permiso para editar servicios antes de reprogramar.');
 end if;
 origen:=jsonb_build_object('cabana_numero',(select numero from public.cabanas where id=e.cabana_id),
  'cabana_id',e.cabana_id,'fecha_ingreso',e.fecha_ingreso,'fecha_salida',e.fecha_salida);
 destino:=jsonb_build_object('cabana_numero',cab.numero,'cabana_id',cab.id,'fecha_ingreso',ingreso,'fecha_salida',salida);
 select coalesce(jsonb_agg(to_jsonb(rs) order by rs.id),'[]') into recursos from public.recursos_servicio rs;
 snapshot:=jsonb_build_object('reserva',to_jsonb(r),'estadia',to_jsonb(e),'destino_catalogo',to_jsonb(cab),
  'noches',coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from public.estadia_noches n where n.estadia_id=e.id),'[]'),
  'servicios',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.servicios s where s.reserva_id=p_reserva),'[]'),
  'notas',coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from public.notas n where n.reserva_id=p_reserva),'[]'),
  'recursos',recursos,'finanzas',private.haiku_reprogramacion_finanzas_v1(p_reserva));
 for x in select s.*,c.codigo,c.nombre,c.categoria,c.activo catalogo_activo from public.servicios s
  join public.catalogo_servicios c on c.id=s.catalogo_servicio_id where s.reserva_id=p_reserva order by s.fecha_servicio,s.id loop
  propuesta:=null;estado:='revision';inicial:=null;recurso:=x.recurso_id;conflictos:='[]';
  opciones:='["revision","conservar"]';es_fijo:=x.codigo in('lateCheckout','earlyCheckin');motivo:=null;
  valido:=x.hora_inicio is not null and x.hora_fin is not null and x.hora_fin>x.hora_inicio and x.catalogo_activo is true;
  if x.estadia_id is distinct from e.id then
   estado:=case when x.estadia_id is null then 'revision' else 'otra_estadia' end;
   motivo:=case when x.estadia_id is null then 'Falta una estadía inequívoca; no se trasladará por compartir reserva.' else 'Servicio de otra estadía. Conserva su fecha, estado y asociación.' end;
   if x.estadia_id is not null then opciones:='["conservar"]';inicial:='conservar'; end if;
  elsif x.estado_servicio<>'programado' then
   estado:='historico';motivo:='Estado '||x.estado_servicio||'. Se conserva en el historial; no se traslada.';opciones:='["conservar"]';inicial:='conservar';
  elsif x.fecha_servicio<e.fecha_ingreso or x.fecha_servicio>e.fecha_salida then
   motivo:='El servicio está fuera de las fechas originales. No acredita un servicio confirmado para la nueva estadía.';
  else
   propuesta:=case x.codigo when 'lateCheckout' then salida when 'earlyCheckin' then ingreso else ingreso+(x.fecha_servicio-e.fecha_ingreso) end;
   if (x.codigo='lateCheckout' and x.fecha_servicio<>e.fecha_salida) or (x.codigo='earlyCheckin' and x.fecha_servicio<>e.fecha_ingreso) then
    valido:=false;motivo:='La fecha actual no corresponde al ingreso/salida original; requiere revisión.';
   elsif not valido then motivo:='Falta un horario válido o el catálogo está inactivo.';
   elsif propuesta>salida then valido:=false;motivo:='El horario propuesto queda fuera de la nueva estadía.';
   else motivo:=case x.codigo when 'lateCheckout' then 'Se propone para la nueva salida, con la misma hora.' when 'earlyCheckin' then 'Se propone para el nuevo ingreso, con la misma hora.' else 'Se conserva el día relativo y el horario; disponibilidad comprobada.' end; end if;
   if valido and not es_fijo and recurso is null and x.codigo in('tinajaTonel','tinajaJacuzzi') then
    select case when count(*)=1 then min(rs.id::text)::uuid else null end into recurso from public.recursos_servicio rs where rs.activo
      and rs.nombre=case x.codigo when 'tinajaTonel' then 'Tinaja Tonel de Madera' else 'Tinaja Jacuzzi' end;
   end if;
   if valido and not es_fijo and recurso is null then valido:=false;motivo:='No hay un recurso inequívoco para comprobar disponibilidad. Revisa la agenda.';end if;
   if valido and recurso is not null and not exists(select 1 from public.recursos_servicio rs where rs.id=recurso and rs.activo) then valido:=false;motivo:='El recurso ya no está activo.';end if;
   if valido and x.codigo in('tinajaTonel','tinajaJacuzzi') and (x.hora_inicio<time '08:00' or x.hora_fin>time '23:15'
     or e.tipo_estadia='fullday' and (x.hora_inicio<time '09:30' or x.hora_fin>time '21:30')) then valido:=false;motivo:='La hora acordada queda fuera del horario operativo.';end if;
   if valido and recurso is not null then
    select coalesce(jsonb_agg(jsonb_build_object('servicio_id',s.id,'fecha',s.fecha_servicio,'inicio',s.hora_inicio,'fin',s.hora_fin) order by s.id),'[]') into conflictos
    from public.servicios s where s.id<>x.id and s.fecha_servicio=propuesta and s.estado_servicio not in('cancelado','no_show')
     and (s.recurso_id=recurso or s.recurso_id is null and s.catalogo_servicio_id=x.catalogo_servicio_id)
     and s.hora_inicio<x.hora_fin and s.hora_fin>x.hora_inicio;
    if jsonb_array_length(conflictos)>0 then valido:=false;motivo:='El recurso está ocupado en el horario propuesto. Elige dejarlo para revisión; no se confirma el traslado.';end if;
   end if;
   if valido then estado:='trasladable';opciones:='["mover","revision","conservar"]';inicial:='mover';end if;
  end if;
  items:=items||jsonb_build_array(jsonb_build_object('id','servicio:'||x.id,'tipo','servicio','registro_id',x.id,'nombre',x.nombre,
   'estado_original',x.estado_servicio,'estado',estado,'motivo',motivo,'fecha_anterior',x.fecha_servicio,'fecha_propuesta',propuesta,
   'hora_inicio',x.hora_inicio,'hora_fin',x.hora_fin,'recurso_id',recurso,'conflictos',conflictos,'opciones',opciones,'inicial',inicial));
 end loop;
 for x in select * from public.notas where reserva_id=p_reserva order by creado_en,id loop
  propuesta:=null;inicial:='conservar';estado:='historico';opciones:='["conservar"]';motivo:='Comentario general o de otra estadía. Se conserva íntegro.';
  if x.tipo='operativa_resumen' and x.estadia_id=e.id then
   if x.fecha_operacion=e.fecha_ingreso then
    propuesta:=ingreso;inicial:='mover';estado:='trasladable';opciones:='["mover","conservar"]';motivo:='Nota operativa de llegada: nuevo ingreso y cabaña destino; texto intacto.';
   elsif x.fecha_operacion between e.fecha_ingreso and e.fecha_salida then
    propuesta:=ingreso+(x.fecha_operacion-e.fecha_ingreso);inicial:=null;estado:='revision';opciones:='["mover","conservar"]';motivo:='Nota de otra fecha operativa. Decide expresamente si debe seguir el desplazamiento.';
   else inicial:=null;estado:='revision';motivo:='Nota fuera de las fechas originales. Se requiere conservarla expresamente; no se traslada.';end if;
  elsif x.tipo='operativa_resumen' and x.estadia_id is null then inicial:=null;estado:='revision';motivo:='La nota no identifica estadía. Revisa su origen antes de asociarla o trasladarla.';end if;
  items:=items||jsonb_build_array(jsonb_build_object('id','nota:'||x.id,'tipo','nota','registro_id',x.id,'nombre',x.texto,'estado',estado,
   'motivo',motivo,'fecha_anterior',x.fecha_operacion,'fecha_propuesta',propuesta,'opciones',opciones,'inicial',inicial));
 end loop;
 return jsonb_build_object('version',1,'reserva_id',r.id,'estadia_id',e.id,'origen',origen,'destino',destino,
  'snapshot',snapshot,'firma',md5(snapshot::text),'items',items,'bloqueos',bloqueos,
  'politica_financiera','Se conservan tarifas acordadas, IDs de noches, cargos, pagos y aplicaciones. No se recalcula el catálogo.');
end;$$;
revoke all on function private.haiku_reprogramacion_preparar_v1(uuid,uuid,jsonb) from public,anon;
grant execute on function private.haiku_reprogramacion_preparar_v1(uuid,uuid,jsonb) to authenticated;
create function public.haiku_reprogramacion_preparar_v1(p_reserva_id uuid,p_estadia_id uuid,p_destino jsonb) returns jsonb
language sql security invoker set search_path=pg_catalog,public,private as $$select private.haiku_reprogramacion_preparar_v1(p_reserva_id,p_estadia_id,p_destino);$$;
revoke all on function public.haiku_reprogramacion_preparar_v1(uuid,uuid,jsonb) from public,anon;
grant execute on function public.haiku_reprogramacion_preparar_v1(uuid,uuid,jsonb) to authenticated;

create function private.haiku_reprogramacion_guard_revision_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private as $$begin
 if (case when tg_op='INSERT' then new.reprogramacion_revision_v1 is not null
     else new.reprogramacion_revision_v1 is distinct from old.reprogramacion_revision_v1 end)
  and not private.haiku_reprogramacion_contexto_v1(new.estadia_id) then
  raise exception 'La revisión de un servicio requiere la confirmación transaccional de la reprogramación' using errcode='42501';
 end if;return new;end;$$;
revoke all on function private.haiku_reprogramacion_guard_revision_v1() from public,anon,authenticated;
create trigger haiku_reprogramacion_guard_revision_v1 before insert or update of reprogramacion_revision_v1 on public.servicios
for each row execute function private.haiku_reprogramacion_guard_revision_v1();

-- Las cuatro guardias existentes se conservan. Sólo se permite el estado intermedio
-- dentro de la operación privada autorizada, que comprueba rango y ledger al finalizar.
do $guards$
declare firma text; src text; guardia text;
begin
 for firma in select unnest(array['public.haiku_validar_cambio_rango_estadia()',
  'private.haiku_sincronizar_tarifas_catalogo_por_cambio_cabana()','public.haiku_sincronizar_cargo_noche()','public.haiku_sincronizar_cargo_servicio()']) loop
  src:=pg_get_functiondef(firma::regprocedure);
  if position('haiku_reprogramacion_contexto_v1' in src)>0 then raise exception 'Guardia ya modificada; revisar migración';end if;
  guardia:=case when firma like '%cargo_servicio%' then
   E'begin\n  if tg_op=''UPDATE'' and private.haiku_reprogramacion_contexto_v1(new.estadia_id) and\n   to_jsonb(new)-array[''fecha_servicio'',''hora_inicio'',''hora_fin'',''recurso_id'',''reprogramacion_revision_v1'',''actualizado_en''] =\n   to_jsonb(old)-array[''fecha_servicio'',''hora_inicio'',''hora_fin'',''recurso_id'',''reprogramacion_revision_v1'',''actualizado_en''] then return null; end if;'
   when firma like '%cargo_noche%' then
   E'begin\n  if tg_op=''UPDATE'' and new.tarifa=old.tarifa and new.estadia_id=old.estadia_id and private.haiku_reprogramacion_contexto_v1(new.estadia_id) then return new; end if;'
   else E'begin\n  if private.haiku_reprogramacion_contexto_v1(new.id) then return new; end if;' end;
  if src !~* E'\nbegin\n' then raise exception 'Guardia incompatible: %',firma;end if;
  execute regexp_replace(src,E'\nbegin\n',E'\n'||guardia||E'\n','i');
 end loop;
end;$guards$;

create function private.haiku_reprogramacion_aplicar_v1(p_operacion_id uuid,p_propuesta jsonb,p_decisiones jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare
 u uuid:=auth.uid(); r uuid:=(p_propuesta->>'reserva_id')::uuid; e uuid:=(p_propuesta->>'estadia_id')::uuid;
 h text:=md5(jsonb_build_array(p_propuesta,p_decisiones)::text);op private.haiku_reprogramaciones_v1%rowtype;
 actual jsonb; item jsonb; previo jsonb; accion text; cambios jsonb:='[]'; revisiones jsonb:='[]';
 s public.servicios%rowtype; n record; delta integer; ingreso date; salida date; cab uuid; v_resultado jsonb;
 campos jsonb:='[]'; contextoAnterior text:=current_setting('app.haiku_reprogramacion_v1',true);
begin
 if u is null or private.haiku_usuario_activo() is distinct from true
  or private.haiku_tiene_permiso('reservas.editar') is distinct from true then raise exception 'Sin permiso para reprogramar' using errcode='42501';end if;
 if p_operacion_id is null or r is null or e is null or jsonb_typeof(p_decisiones) is distinct from 'object'
  or p_propuesta->>'version' is distinct from '1' or nullif(p_propuesta->>'firma','') is null then raise exception 'Revisa la propuesta completa antes de confirmar';end if;
 insert into private.haiku_reprogramaciones_v1(operacion_id,usuario_id,reserva_id,estadia_id,solicitud_hash,origen,destino)
 values(p_operacion_id,u,r,e,h,p_propuesta->'origen',p_propuesta->'destino') on conflict do nothing;
 select * into op from private.haiku_reprogramaciones_v1 where operacion_id=p_operacion_id for update;
 if op.usuario_id is distinct from u or op.solicitud_hash is distinct from h then raise exception 'La operación pertenece a otra propuesta o usuario';end if;
 if op.resultado is not null then return op.resultado||jsonb_build_object('reintento',true);end if;
 perform pg_advisory_xact_lock(hashtextextended(r::text,0));
 perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',r::text));
 perform 1 from public.reservas where id=r for update;
 perform 1 from public.reserva_estadias where reserva_id=r order by id for update;
 perform 1 from public.cabanas where id in((p_propuesta->'origen'->>'cabana_id')::uuid,(p_propuesta->'destino'->>'cabana_id')::uuid) order by id for update;
 perform 1 from public.estadia_noches where estadia_id=e order by id for update;
 perform 1 from public.servicios where reserva_id=r order by id for update;
 perform 1 from public.notas where reserva_id=r order by id for update;
 -- Las exclusiones de ocupación y recurso existentes siguen arbitrando operaciones concurrentes.
 for item in select value from jsonb_array_elements(p_propuesta->'items') where value->>'tipo'='servicio' and value->>'recurso_id' is not null order by value->>'recurso_id' loop
  perform 1 from public.recursos_servicio where id=(item->>'recurso_id')::uuid for update;
  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('tinaja_horario',(item->>'recurso_id')||':'||(item->>'fecha_propuesta')));
 end loop;
 actual:=private.haiku_reprogramacion_preparar_v1(r,e,p_propuesta->'destino');
 if actual->'origen' is distinct from p_propuesta->'origen' or actual->'destino' is distinct from p_propuesta->'destino' then
  raise exception 'Cambió el origen o destino; vuelve a revisar la reprogramación' using errcode='HLC01';end if;
 if actual->'snapshot' is distinct from p_propuesta->'snapshot' or actual->>'firma' is distinct from p_propuesta->>'firma' then
  for accion in select unnest(array['reserva','estadia','servicios','notas','noches','destino_catalogo','recursos','finanzas']) loop
   if actual->'snapshot'->accion is distinct from p_propuesta->'snapshot'->accion then campos:=campos||jsonb_build_array(accion);end if;
  end loop;
  raise exception 'Cambió % desde la vista previa. Vuelve a preparar la reprogramación.',campos using errcode='HLC01',detail=jsonb_build_object('campos',campos)::text;
 end if;
 if jsonb_array_length(actual->'bloqueos')>0 then raise exception '%',actual->'bloqueos' using errcode='HLC01';end if;
 if exists(select 1 from jsonb_object_keys(p_decisiones) k where not exists(select 1 from jsonb_array_elements(actual->'items') i where i->>'id'=k)) then raise exception 'Hay decisiones ajenas a esta estadía';end if;
 for item in select value from jsonb_array_elements(actual->'items') loop
  accion:=p_decisiones->> (item->>'id');
  if accion='mover' and item->>'tipo'='servicio' and item->>'estado'<>'trasladable' then
   raise exception 'Cambió la disponibilidad de %: %. Vuelve a preparar.',item->>'nombre',item->>'motivo' using errcode='HLC01';
  end if;
  if accion is null or not ((item->'opciones')?accion) then raise exception 'Decide qué hacer con % antes de confirmar.',item->>'nombre';end if;
  if accion='mover' then
   select value into previo from jsonb_array_elements(p_propuesta->'items') where value->>'id'=item->>'id';
   if item->'fecha_propuesta' is distinct from previo->'fecha_propuesta' or item->'conflictos' is distinct from previo->'conflictos'
    or item->>'tipo'='servicio' and item->>'estado'<>'trasladable' then
    raise exception 'Cambió la disponibilidad de %: %. Vuelve a preparar.',item->>'nombre',item->>'motivo' using errcode='HLC01';end if;
  end if;
  if item->>'tipo'='servicio' and (accion='mover' or accion='revision' and item->>'estado'<>'otra_estadia')
   and private.haiku_tiene_permiso('servicios.editar') is distinct from true then raise exception 'Se requiere permiso para editar servicios' using errcode='42501';end if;
  if item->>'tipo'='nota' and accion='mover' and private.haiku_tiene_permiso('notas.gestionar') is distinct from true then raise exception 'Se requiere permiso para mover notas' using errcode='42501';end if;
 end loop;
 ingreso:=(actual->'destino'->>'fecha_ingreso')::date;salida:=(actual->'destino'->>'fecha_salida')::date;cab:=(actual->'destino'->>'cabana_id')::uuid;
 delta:=ingreso-(actual->'origen'->>'fecha_ingreso')::date;
 perform set_config('app.haiku_reprogramacion_v1',p_operacion_id::text,true);
 update public.reserva_estadias set fecha_ingreso=ingreso,fecha_salida=salida,cabana_id=cab where id=e and reserva_id=r;
 -- Orden evita colisiones de UNIQUE(estadia_id,fecha) en desplazamientos solapados.
 for n in select id,fecha from public.estadia_noches where estadia_id=e
  order by case when delta>0 then fecha end desc,case when delta<=0 then fecha end asc loop
  if delta<>0 then update public.estadia_noches set fecha=n.fecha+delta where id=n.id;end if;
 end loop;
 for item in select value from jsonb_array_elements(actual->'items') loop
  accion:=p_decisiones->>(item->>'id');
  if item->>'tipo'='servicio' then
   select * into s from public.servicios where id=(item->>'registro_id')::uuid;
   if accion='mover' then
    update public.servicios set fecha_servicio=(item->>'fecha_propuesta')::date,recurso_id=(item->>'recurso_id')::uuid,reprogramacion_revision_v1=null where id=s.id;
    cambios:=cambios||jsonb_build_array(jsonb_build_object('tipo','servicio','id',s.id,'antes',s.fecha_servicio,'despues',item->>'fecha_propuesta'));
   elsif s.estadia_id=e and s.estado_servicio='programado' and (accion='revision' or s.fecha_servicio<ingreso or s.fecha_servicio>salida) then
    update public.servicios set reprogramacion_revision_v1=jsonb_build_object('version',1,'operacion_id',p_operacion_id,'usuario',u,
     'motivo',item->>'motivo','decision',accion,'fecha',s.fecha_servicio,'inicio',s.hora_inicio,'fin',s.hora_fin,'destino',actual->'destino') where id=s.id;
    revisiones:=revisiones||jsonb_build_array(s.id);
   end if;
  elsif accion='mover' then
   update public.notas set fecha_operacion=(item->>'fecha_propuesta')::date,cabana_id=cab
    where id=(item->>'registro_id')::uuid and estadia_id=e and tipo='operativa_resumen';
   cambios:=cambios||jsonb_build_array(jsonb_build_object('tipo','nota','id',item->>'registro_id','antes',item->>'fecha_anterior','despues',item->>'fecha_propuesta'));
  end if;
 end loop;
 if exists(select 1 from public.estadia_noches where estadia_id=e and (fecha<ingreso or fecha>=salida)) then raise exception 'No se confirmó el rango final de noches; se revierte todo';end if;
 if private.haiku_reprogramacion_finanzas_v1(r) is distinct from actual->'snapshot'->>'finanzas' then raise exception 'Se alteraron vínculos financieros; se revierte la reprogramación';end if;
 perform set_config('app.haiku_reprogramacion_v1',coalesce(contextoAnterior,''),true);
 -- Vuelve a ejecutar las guardias normales con el rango final coherente.
 update public.reserva_estadias set fecha_ingreso=ingreso where id=e;
 v_resultado:=jsonb_build_object('ok',true,'reserva_id',r,'estadia_id',e,'operacion_id',p_operacion_id,
  'origen',actual->'origen','destino',actual->'destino','cambios',cambios,'servicios_revision',revisiones,'finanzas_conservadas',true);
 update private.haiku_reprogramaciones_v1 set resultado=v_resultado,completado_en=now() where operacion_id=p_operacion_id;
 return v_resultado;
end;$$;
revoke all on function private.haiku_reprogramacion_aplicar_v1(uuid,jsonb,jsonb) from public,anon;
grant execute on function private.haiku_reprogramacion_aplicar_v1(uuid,jsonb,jsonb) to authenticated;
create function public.haiku_reprogramar_estadia_v1(p_operacion_id uuid,p_propuesta jsonb,p_decisiones jsonb) returns jsonb
language sql security invoker set search_path=pg_catalog,public,private as $$select private.haiku_reprogramacion_aplicar_v1(p_operacion_id,p_propuesta,p_decisiones);$$;
revoke all on function public.haiku_reprogramar_estadia_v1(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.haiku_reprogramar_estadia_v1(uuid,jsonb,jsonb) to authenticated;

-- Conserva las implementaciones actuales, incluidos sus controles de identidad.
do $bases$
declare src text;
begin
 src:=pg_get_functiondef('private.haiku_libro_actualizar_v1(jsonb)'::regprocedure);
 execute replace(src,'private.haiku_libro_actualizar_v1(','private.haiku_libro_actualizar_sin_reprogramacion_v1(');
 src:=pg_get_functiondef('private.haiku_editar_reserva_asistente_impl_v1(uuid,uuid,jsonb,jsonb,bigint)'::regprocedure);
 execute replace(src,'private.haiku_editar_reserva_asistente_impl_v1(','private.haiku_editar_reserva_sin_reprogramacion_v1(');
end;$bases$;
revoke all on function private.haiku_libro_actualizar_sin_reprogramacion_v1(jsonb) from public,anon,authenticated;
revoke all on function private.haiku_editar_reserva_sin_reprogramacion_v1(uuid,uuid,jsonb,jsonb,bigint) from public,anon,authenticated;

create or replace function private.haiku_libro_actualizar_v1(p_item jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare d jsonb; antes jsonb; resultado jsonb; traslado jsonb; item jsonb:=p_item; k text;
begin
 if p_item->>'tipo'='reserva_actualizar' and exists(select 1 from jsonb_object_keys(coalesce(p_item->'estadia'->'despues','{}')) x
  where x in('fecha_ingreso','fecha_salida','cabana_numero') and p_item->'estadia'->'despues'->x is distinct from p_item->'estadia'->'antes'->x) then
  d:=p_item->'reprogramacion_v1';
  if d is null then raise exception 'Revisa conjuntamente servicios y notas antes de reprogramar desde el Libro' using errcode='HLC01';end if;
  if d->'propuesta'->>'reserva_id' is distinct from p_item->>'reserva_id' or d->'propuesta'->>'estadia_id' is distinct from p_item->>'estadia_id'
   or nullif(d->>'version_libro','') is null then raise exception 'La propuesta no pertenece al origen del Libro' using errcode='HLC01';end if;
  for k in select unnest(array['fecha_ingreso','fecha_salida','cabana_numero']) loop
   if (p_item->'estadia'->'antes')?k and p_item->'estadia'->'antes'->k is distinct from d->'propuesta'->'origen'->k then
    raise exception 'El origen del Libro cambió: %',k using errcode='HLC01';end if;
   if (p_item->'estadia'->'despues')?k and p_item->'estadia'->'despues'->k is distinct from d->'propuesta'->'destino'->k then
    raise exception 'El destino del Libro cambió: %',k using errcode='HLC01';end if;
  end loop;
  if (p_item->'estadia'->'despues')?'tipo_estadia' and p_item->'estadia'->'despues'->'tipo_estadia'
   is distinct from d->'propuesta'->'snapshot'->'estadia'->'tipo_estadia' then raise exception 'Revisa el cambio de tipo y sus tarifas por separado' using errcode='HLC01';end if;
  traslado:=private.haiku_reprogramacion_aplicar_v1((d->>'operacion_id')::uuid,d->'propuesta',d->'decisiones');
  antes:=coalesce(p_item->'estadia'->'antes','{}');
  for k in select unnest(array['fecha_ingreso','fecha_salida','cabana_numero']) loop
   if antes?k then antes:=jsonb_set(antes,array[k],d->'propuesta'->'destino'->k);end if;
  end loop;
  item:=jsonb_set(item,'{estadia,antes}',antes);
  resultado:=private.haiku_libro_actualizar_sin_reprogramacion_v1(item);
  if private.haiku_reprogramacion_finanzas_v1((p_item->>'reserva_id')::uuid) is distinct from d->'propuesta'->'snapshot'->>'finanzas'
   then raise exception 'El resto del cambio alteró vínculos financieros. No se guardó el lote' using errcode='HLC01';end if;
  return resultado||jsonb_build_object('reprogramacion_v1',traslado);
 end if;
 return private.haiku_libro_actualizar_sin_reprogramacion_v1(item);
end;$$;

create or replace function private.haiku_editar_reserva_asistente_impl_v1(p_reserva_id uuid,p_estadia_id uuid,p_esperado jsonb,p_datos jsonb,p_tarifa_base bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare e public.reserva_estadias%rowtype; d jsonb:=p_datos->'reprogramacion_v1';
begin
 if p_datos->>'campo' is null then
  select * into e from public.reserva_estadias where id=p_estadia_id and reserva_id=p_reserva_id;
  if (p_datos->>'fecha_ingreso')::date is distinct from e.fecha_ingreso or (p_datos->>'fecha_salida')::date is distinct from e.fecha_salida
   or (p_datos->>'cabana_numero')::integer is distinct from (select numero from public.cabanas where id=e.cabana_id) then
   if d is null then raise exception 'Revisa conjuntamente servicios y notas antes de reprogramar desde Haku' using errcode='HLC01';end if;
   if d->'propuesta'->>'reserva_id' is distinct from p_reserva_id::text or d->'propuesta'->>'estadia_id' is distinct from p_estadia_id::text then raise exception 'La propuesta corresponde a otra estadía';end if;
   if d->'propuesta'->'destino'->>'fecha_ingreso' is distinct from p_datos->>'fecha_ingreso'
    or d->'propuesta'->'destino'->>'fecha_salida' is distinct from p_datos->>'fecha_salida'
    or (d->'propuesta'->'destino'->>'cabana_numero')::integer is distinct from (p_datos->>'cabana_numero')::integer then
    raise exception 'El destino de Haku no coincide con la vista previa' using errcode='HLC01';end if;
   return private.haiku_reprogramacion_aplicar_v1((d->>'operacion_id')::uuid,d->'propuesta',d->'decisiones');
  end if;
 end if;
 return private.haiku_editar_reserva_sin_reprogramacion_v1(p_reserva_id,p_estadia_id,p_esperado,p_datos,p_tarifa_base);
end;$$;
