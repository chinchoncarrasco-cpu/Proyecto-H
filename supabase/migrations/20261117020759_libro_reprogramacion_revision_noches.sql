-- Extiende la revisión de 20261117005357; no modifica reservas al instalarse.
create function private.haiku_reprogramacion_finanzas_detalle_v1(p_reserva uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public,private as $$
 select jsonb_build_object(
 'cargos',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.cargos c where c.reserva_id=p_reserva),'[]'),
 'pagos',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.pagos p where p.reserva_id=p_reserva),'[]'),
 'aplicaciones',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.pago_aplicaciones a join public.cargos c on c.id=a.cargo_id where c.reserva_id=p_reserva),'[]'),
 'ajustes',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.cargo_ajustes a where a.reserva_id=p_reserva),'[]'));
$$;
revoke all on function private.haiku_reprogramacion_finanzas_detalle_v1(uuid) from public,anon,authenticated;

create function private.haiku_reprogramacion_noches_preparar_v1(p_estadia uuid,p_destino jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare e public.reserva_estadias%rowtype; n record; c public.cargos%rowtype; d date; dias integer; viejos integer;
 ingreso date:=(p_destino->>'fecha_ingreso')::date; salida date:=(p_destino->>'fecha_salida')::date;
 tarifa bigint; items jsonb:='[]'; bloqueos jsonb:='[]'; op text; motivo text; propuesta date; inicial text; opciones jsonb;
begin
 select * into e from public.reserva_estadias where id=p_estadia;
 dias:=salida-ingreso;viejos:=e.fecha_salida-e.fecha_ingreso;
 if dias=viejos then return jsonb_build_object('items',items,'bloqueos',bloqueos);end if;
 if e.tipo_estadia<>'alojamiento' or dias<1 or dias>366 or viejos<1 or e.fecha_ingreso<=(now() at time zone 'America/Santiago')::date then
  return jsonb_build_object('items',items,'bloqueos',jsonb_build_array('El cambio de duración requiere una estadía futura de alojamiento, entre 1 y 366 noches. Revisa la ficha e historial.'));end if;
 select precio_base into tarifa from public.cabanas where numero=(p_destino->>'cabana_numero')::integer and activa;
 for d in select generate_series(e.fecha_ingreso::timestamp,(e.fecha_salida-1)::timestamp,interval '1 day')::date loop
  select x.* into n from public.estadia_noches x where x.estadia_id=e.id and x.fecha=d;
  select x.* into c from public.cargos x where x.estadia_noche_id=n.id and x.estado='activo' and x.tipo_cargo='alojamiento';
  if n.id is null or c.id is null or c.monto<>n.tarifa or
    (select count(*) from public.cargos x where x.estadia_noche_id=n.id and x.estado='activo')<>1 then
   bloqueos:=bloqueos||jsonb_build_array('No se pudo acreditar una noche y un cargo únicos para '||d||'. Revisa la ficha.');continue;end if;
  propuesta:=ingreso+(d-e.fecha_ingreso);op:='conservar';inicial:='conservar';opciones:='["conservar"]';
  motivo:='Conserva ID, tarifa acordada, cargo y aplicaciones de esta noche.';
  if propuesta>=salida then
   op:='retirar';inicial:=null;opciones:='["aprobar"]';propuesta:=null;
   motivo:='Retirar esta noche y anular sólo su cargo, conservando ambos en el historial. No se eliminan pagos ni aplicaciones.';
   if exists(select 1 from public.pago_aplicaciones a where a.cargo_id=c.id) or
      exists(select 1 from public.cargo_ajustes a where a.cargo_id=c.id and a.estado='activo') then
    bloqueos:=bloqueos||jsonb_build_array('La noche '||d||' tiene aplicaciones o ajustes activos. Revisa Pagos y cargos en la ficha antes de retirarla.');end if;
  end if;
  items:=items||jsonb_build_array(jsonb_build_object('id','noche:'||n.id,'registro_id',n.id,'tipo','noche','operacion',op,'cargo_id',c.id,
   'nombre','Noche '||to_char(d,'DD/MM/YYYY'),'fecha_anterior',d,'fecha_propuesta',propuesta,'tarifa',n.tarifa,
   'monto_antes',n.tarifa,'monto_despues',case when op='retirar' then 0 else n.tarifa end,'motivo',motivo,'opciones',opciones,'inicial',inicial));
 end loop;
 if dias>viejos then
  if tarifa is null or tarifa<=0 then bloqueos:=bloqueos||jsonb_build_array('Falta una tarifa de catálogo válida para las noches adicionales. Revisa tarifas en la ficha.');end if;
  for d in select generate_series((ingreso+viejos)::timestamp,(salida-1)::timestamp,interval '1 day')::date loop
   items:=items||jsonb_build_array(jsonb_build_object('id','noche:nueva:'||d,'tipo','noche','operacion','agregar',
    'nombre','Noche adicional '||to_char(d,'DD/MM/YYYY'),'fecha_propuesta',d,'tarifa',tarifa,'monto_antes',0,'monto_despues',tarifa,
    'motivo','Añadir una noche y su cargo a tarifa de catálogo explícitamente aprobada; conservar las tarifas de las noches existentes.',
    'opciones',jsonb_build_array('aprobar'),'inicial',null));
  end loop;
 end if;
 return jsonb_build_object('items',items,'bloqueos',bloqueos);
end;$$;
revoke all on function private.haiku_reprogramacion_noches_preparar_v1(uuid,jsonb) from public,anon,authenticated;

create function private.haiku_reprogramacion_noches_verificar_v1(p_reserva uuid,p_estadia uuid,p_items jsonb,p_antes jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare despues jsonb:=private.haiku_reprogramacion_finanzas_detalle_v1(p_reserva); c jsonb; d jsonb; k text; retirados jsonb;
begin
 for k in select unnest(array['pagos','aplicaciones','ajustes']) loop
  if p_antes->k is distinct from despues->k then raise exception 'Cambió el registro de %; se revierte toda la operación',k;end if;
 end loop;
 select coalesce(jsonb_agg(i->>'cargo_id'),'[]') into retirados from jsonb_array_elements(p_items) i where i->>'tipo'='noche' and i->>'operacion'='retirar';
 for c in select value from jsonb_array_elements(p_antes->'cargos') loop
  select value into d from jsonb_array_elements(despues->'cargos') where value->>'id'=c->>'id';
  if retirados?(c->>'id') then
   if d->>'estado' is distinct from 'anulado' or d-array['estado','actualizado_en'] is distinct from c-array['estado','actualizado_en'] then
    raise exception 'Cambió un cargo retirado fuera de lo aprobado';end if;
  elsif d is distinct from c then raise exception 'Se alteró un cargo que debía conservarse';end if;
 end loop;
 if jsonb_array_length(despues->'cargos')<>jsonb_array_length(p_antes->'cargos')+
  (select count(*) from jsonb_array_elements(p_items) i where i->>'tipo'='noche' and i->>'operacion'='agregar') then raise exception 'Cantidad inesperada de cargos nuevos';end if;
 for c in select q.v from jsonb_array_elements(despues->'cargos') q(v) where not exists(select 1 from jsonb_array_elements(p_antes->'cargos') x(v) where x.v->>'id'=q.v->>'id') loop
  if not exists(select 1 from jsonb_array_elements(p_items) i join public.estadia_noches n on n.estadia_id=p_estadia and n.fecha=(i->>'fecha_propuesta')::date
   where i->>'tipo'='noche' and i->>'operacion'='agregar' and n.id::text=c->>'estadia_noche_id' and (c->>'monto')::bigint=(i->>'tarifa')::bigint
   and c->>'estado'='activo' and c->>'tipo_cargo'='alojamiento' and c->>'estadia_id'=p_estadia::text and c->>'reserva_id'=p_reserva::text) then
   raise exception 'Cargo adicional ajeno a las noches aprobadas';end if;
 end loop;
end;$$;
revoke all on function private.haiku_reprogramacion_noches_verificar_v1(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;

create or replace function private.haiku_reprogramacion_preparar_v1(p_reserva uuid,p_estadia uuid,p_destino jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare
 e public.reserva_estadias%rowtype; r public.reservas%rowtype; cab public.cabanas%rowtype;
 ingreso date:=(p_destino->>'fecha_ingreso')::date; salida date:=(p_destino->>'fecha_salida')::date;
 origen jsonb; destino jsonb; snapshot jsonb; items jsonb:='[]'; bloqueos jsonb:='[]';
 revision_noches jsonb; x record; propuesta date; estado text; motivo text; opciones jsonb; inicial text; recurso uuid; conflictos jsonb;
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
 revision_noches:=private.haiku_reprogramacion_noches_preparar_v1(e.id,p_destino);
 items:=revision_noches->'items';bloqueos:=bloqueos||(revision_noches->'bloqueos');
 if salida<ingreso then bloqueos:=bloqueos||jsonb_build_array('La salida debe ser posterior al ingreso.');end if;
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
    if propuesta>salida then propuesta:=null;opciones:='["conservar"]';motivo:='La nota queda fuera de la nueva estadía. Conserva su fecha para revisión en el Resumen; no se traslada automáticamente.';end if;
   else inicial:=null;estado:='revision';motivo:='Nota fuera de las fechas originales. Se requiere conservarla expresamente; no se traslada.';end if;
  elsif x.tipo='operativa_resumen' and x.estadia_id is null then inicial:=null;estado:='revision';motivo:='La nota no identifica estadía. Revisa su origen antes de asociarla o trasladarla.';end if;
  items:=items||jsonb_build_array(jsonb_build_object('id','nota:'||x.id,'tipo','nota','registro_id',x.id,'nombre',x.texto,'estado',estado,
   'motivo',motivo,'fecha_anterior',x.fecha_operacion,'fecha_propuesta',propuesta,'opciones',opciones,'inicial',inicial));
 end loop;
 return jsonb_build_object('version',1,'reserva_id',r.id,'estadia_id',e.id,'origen',origen,'destino',destino,
  'snapshot',snapshot,'firma',md5(snapshot::text),'items',items,'bloqueos',bloqueos,
  'politica_financiera',case when salida-ingreso<>e.fecha_salida-e.fecha_ingreso then
  'Revisa y aprueba cada noche adicional o retirada. Se mantienen las tarifas, IDs y cargos de las noches conservadas. Las retiradas sin aplicaciones se anulan con historial. Pagos y aplicaciones intactos.'
  else 'Se conservan tarifas acordadas, IDs de noches, cargos, pagos y aplicaciones. No se recalcula el catálogo.' end);
end;$$;

create or replace function private.haiku_reprogramacion_aplicar_v1(p_operacion_id uuid,p_propuesta jsonb,p_decisiones jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare
 u uuid:=auth.uid(); r uuid:=(p_propuesta->>'reserva_id')::uuid; e uuid:=(p_propuesta->>'estadia_id')::uuid;
 h text:=md5(jsonb_build_array(p_propuesta,p_decisiones)::text);op private.haiku_reprogramaciones_v1%rowtype;
 actual jsonb; item jsonb; previo jsonb; accion text; cambios jsonb:='[]'; revisiones jsonb:='[]';
 s public.servicios%rowtype; n record; delta integer; ingreso date; salida date; cab uuid; v_resultado jsonb;
 fin_antes jsonb; noche_id uuid; cambio_duracion boolean;
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
 perform 1 from public.cargos where reserva_id=r order by id for update;
 perform 1 from public.pagos where reserva_id=r order by id for update;
 perform 1 from public.pago_aplicaciones a join public.cargos c on c.id=a.cargo_id where c.reserva_id=r order by a.id for update of a;
 perform 1 from public.cargo_ajustes where reserva_id=r order by id for update;
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
  if item->>'tipo'='noche' then
   select value into previo from jsonb_array_elements(p_propuesta->'items') where value->>'id'=item->>'id';
   if item is distinct from previo then raise exception 'Cambió la revisión de noches o tarifa. Vuelve a preparar.' using errcode='HLC01';end if;
  end if;
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
 fin_antes:=private.haiku_reprogramacion_finanzas_detalle_v1(r);
 cambio_duracion:=(salida-ingreso)<>((actual->'origen'->>'fecha_salida')::date-(actual->'origen'->>'fecha_ingreso')::date);
 perform set_config('app.haiku_reprogramacion_v1',p_operacion_id::text,true);
 -- Sólo se anulan cargos retirados sin aplicaciones/ajustes, aprobados en la vista previa fresca.
 for item in select value from jsonb_array_elements(actual->'items') where value->>'tipo'='noche' and value->>'operacion'='retirar' loop
  update public.cargos set estado='anulado',actualizado_en=now() where id=(item->>'cargo_id')::uuid and estado='activo';
  cambios:=cambios||jsonb_build_array(jsonb_build_object('tipo','noche','operacion','retirar','id',item->>'registro_id','cargo_id',item->>'cargo_id','antes',item->>'fecha_anterior'));
 end loop;
 update public.reserva_estadias set fecha_ingreso=ingreso,fecha_salida=salida,cabana_id=cab where id=e and reserva_id=r;
 -- Orden evita colisiones de UNIQUE(estadia_id,fecha) en desplazamientos solapados.
 for n in select x.id,x.fecha from public.estadia_noches x where x.estadia_id=e
  and exists(select 1 from public.cargos c where c.estadia_noche_id=x.id and c.estado='activo')
  order by case when delta>0 then fecha end desc,case when delta<=0 then fecha end asc loop
  if delta<>0 then update public.estadia_noches set fecha=n.fecha+delta where id=n.id;end if;
 end loop;
 for item in select value from jsonb_array_elements(actual->'items') where value->>'tipo'='noche' and value->>'operacion'='agregar' loop
  -- Una reampliación puede reutilizar la fila de noche histórica. Su cargo anterior sigue anulado.
  insert into public.estadia_noches(estadia_id,fecha,tarifa,origen_tarifa)
   values(e,(item->>'fecha_propuesta')::date,(item->>'tarifa')::bigint,'catalogo')
   on conflict(estadia_id,fecha) do update set tarifa=excluded.tarifa,origen_tarifa=excluded.origen_tarifa returning id into noche_id;
  if not exists(select 1 from public.cargos c where c.estadia_noche_id=noche_id and c.estado='activo') then
   insert into public.cargos(reserva_id,estadia_id,estadia_noche_id,tipo_cargo,concepto,monto,moneda,estado,creado_por)
    values(r,e,noche_id,'alojamiento','Alojamiento · '||to_char((item->>'fecha_propuesta')::date,'DD-MM-YYYY'),(item->>'tarifa')::bigint,'CLP','activo',u);
  end if;
  cambios:=cambios||jsonb_build_array(jsonb_build_object('tipo','noche','operacion','agregar','id',noche_id,'despues',item->>'fecha_propuesta','tarifa',item->'tarifa'));
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
 if exists(select 1 from public.estadia_noches x where x.estadia_id=e and (x.fecha<ingreso or x.fecha>=salida)
  and exists(select 1 from public.cargos c where c.estadia_noche_id=x.id and c.estado='activo')) then raise exception 'No se confirmó el rango final de noches activas; se revierte todo';end if;
 if cambio_duracion then perform private.haiku_reprogramacion_noches_verificar_v1(r,e,actual->'items',fin_antes);
 elsif private.haiku_reprogramacion_finanzas_v1(r) is distinct from actual->'snapshot'->>'finanzas' then raise exception 'Se alteraron vínculos financieros; se revierte la reprogramación';end if;
 perform set_config('app.haiku_reprogramacion_v1',coalesce(contextoAnterior,''),true);
 -- Vuelve a ejecutar las guardias normales con el rango final coherente.
 update public.reserva_estadias set fecha_ingreso=ingreso where id=e;
 v_resultado:=jsonb_build_object('ok',true,'reserva_id',r,'estadia_id',e,'operacion_id',p_operacion_id,
  'origen',actual->'origen','destino',actual->'destino','cambios',cambios,'servicios_revision',revisiones,'finanzas_conservadas',not cambio_duracion,'vinculos_financieros_conservados',true);
 update private.haiku_reprogramaciones_v1 set resultado=v_resultado,completado_en=now() where operacion_id=p_operacion_id;
 return v_resultado;
end;$$;

create or replace function private.haiku_libro_actualizar_v1(p_item jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare d jsonb; antes jsonb; resultado jsonb; traslado jsonb; fin_traslado text; item jsonb:=p_item; k text;
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
  fin_traslado:=private.haiku_reprogramacion_finanzas_v1((p_item->>'reserva_id')::uuid);
  antes:=coalesce(p_item->'estadia'->'antes','{}');
  for k in select unnest(array['fecha_ingreso','fecha_salida','cabana_numero']) loop
   if antes?k then antes:=jsonb_set(antes,array[k],d->'propuesta'->'destino'->k);end if;
  end loop;
  item:=jsonb_set(item,'{estadia,antes}',antes);
  resultado:=private.haiku_libro_actualizar_sin_reprogramacion_v1(item);
  if private.haiku_reprogramacion_finanzas_v1((p_item->>'reserva_id')::uuid) is distinct from fin_traslado
   then raise exception 'El resto del cambio alteró vínculos financieros. No se guardó el lote' using errcode='HLC01';end if;
  return resultado||jsonb_build_object('reprogramacion_v1',traslado);
 end if;
 return private.haiku_libro_actualizar_sin_reprogramacion_v1(item);
end;$$;
