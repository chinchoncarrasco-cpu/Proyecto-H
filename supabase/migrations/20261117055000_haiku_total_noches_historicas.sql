-- Edita sólo noches vigentes y conserva el historial anulado y los abonos sin aplicar.
create or replace function private.haiku_plan_aplicaciones_total_v32(p_id uuid,p_plan jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare apps jsonb; original jsonb; f record; app_fila record; pago_fila record; destino record;
 exceso bigint; usado bigint; cantidad bigint; capacidad bigint; confirmado bigint; inicial bigint; sin_aplicar bigint;
 clave text; existente text; fila jsonb; pagos_alojamiento jsonb; pagos_servicio jsonb;
begin
 if private.haiku_tiene_permiso('pagos.registrar') is not true then raise exception 'Sin permiso para reconciliar aplicaciones'; end if;

 -- Separación física: alojamiento nunca pertenece a servicio; todo cargo no alojamiento
 -- debe pertenecer a un servicio de la misma reserva y conservar un total verificable.
 if exists(
  select 1 from public.cargos c left join public.servicios s on s.id=c.servicio_id
  where c.reserva_id=p_id and (
   (c.estado is distinct from 'activo' and not (
    c.estado='anulado' and c.tipo_cargo='alojamiento' and c.servicio_id is null
    and exists(select 1 from public.estadia_noches n join public.reserva_estadias e on e.id=n.estadia_id
     where n.id=c.estadia_noche_id and e.id=c.estadia_id and e.reserva_id=p_id)
   ))
   or (c.tipo_cargo='alojamiento' and c.servicio_id is not null)
   or (c.tipo_cargo is distinct from 'alojamiento' and (c.servicio_id is null or s.reserva_id is distinct from p_id))
  )
 ) or exists(
  select 1 from public.servicios s
  where s.reserva_id=p_id and (
   s.total is null or s.total<0 or s.total is distinct from coalesce((
    select sum(ec.monto_ajustado) from public.vista_estado_cargos ec
    where ec.reserva_id=p_id and ec.servicio_id=s.id and ec.tipo_cargo is distinct from 'alojamiento' and ec.estado='activo'
   ),0)
  )
 ) or exists(
  select 1 from public.servicios s join public.cargos c on c.servicio_id=s.id
  where s.reserva_id=p_id and c.reserva_id is distinct from p_id
 ) or exists(
  select 1 from public.cargo_ajustes a left join public.cargos c on c.id=a.cargo_id
  where a.reserva_id=p_id and a.estado='activo' and (c.id is null or c.reserva_id is distinct from p_id)
 )
 then raise exception 'Servicios o cargos no separados inequívocamente: requiere revisión'; end if;

 -- Los movimientos deben seguir siendo pagos confirmados. Sólo se redistribuyen
 -- pagos con destino explícito. Los metadatos nunca se usan para inferirlo.
 if exists(select 1 from public.pagos p where p.reserva_id=p_id and
  (p.estado is distinct from 'confirmado' or p.tipo_movimiento is distinct from 'pago' or p.pago_origen_id is not null
   or p.pago_grupo_id is not null or p.etapa_operativa not in('abono','saldo') or p.etapa_operativa is null or p.monto<=0
   or (
    not exists(select 1 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where pa.pago_id=p.id and c.reserva_id=p_id and c.estado='activo' and pa.monto_aplicado>0)
    -- Un aumento de alojamiento sin IVA puede preservar íntegro un abono sin aplicaciones.
    and not ((p_plan->>'total_objetivo')::bigint>(p_plan->>'total_actual')::bigint
     and not (p_plan ? 'firma')
     and p.etapa_operativa='abono'
     and not exists(select 1 from public.pago_aplicaciones pa where pa.pago_id=p.id))
   )
   or jsonb_typeof(coalesce(p.datos_origen,'{}'))<>'object'
   or exists(select 1 from jsonb_object_keys(coalesce(p.datos_origen,'{}')) k where k not in('verificacion_migrada','verificacion_migrada_en','bovtar','item_id','contexto','fecha_bloque','operacion_id','origen_libro','concepto_libro','aprobado_manualmente','ultima_actualizacion_libro'))
   or (p.datos_origen ? 'contexto' and p.datos_origen->>'contexto' is distinct from 'haku_libro_incorporacion')
   or (p.datos_origen ? 'concepto_libro'
       and exists(select 1 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where pa.pago_id=p.id and c.reserva_id=p_id and c.tipo_cargo='alojamiento' and c.servicio_id is null)
       and coalesce(p.datos_origen->>'concepto_libro','') !~* '^cab\s*[0-9]+\s*/\s*[0-9]+\s*noches?$')))
 then raise exception 'Pago no elegible o destino ambiguo: requiere revisión'; end if;
 if exists(select 1 from public.pagos where pago_origen_id in(select id from public.pagos where reserva_id=p_id)) then raise exception 'Pago con devolución vinculada: requiere revisión'; end if;
 if exists(select 1 from public.pago_aplicaciones pa join public.pagos p on p.id=pa.pago_id join public.cargos c on c.id=pa.cargo_id
  where (p.reserva_id=p_id or c.reserva_id=p_id) and (p.reserva_id is distinct from p_id or c.reserva_id is distinct from p_id or c.estado is distinct from 'activo' or pa.monto_aplicado<=0))
 then raise exception 'Aplicaciones ajenas o incompatibles'; end if;
 if exists(select 1 from public.pagos p where p.reserva_id=p_id and p.monto<(select coalesce(sum(pa.monto_aplicado),0) from public.pago_aplicaciones pa where pa.pago_id=p.id)) then raise exception 'Aplicaciones superiores al pago'; end if;

 -- Un pago no puede financiar simultáneamente alojamiento y servicios. Un pago
 -- exclusivo de servicio debe quedar totalmente aplicado para no dejar remanentes ambiguos.
 if exists(
  select 1 from public.pagos p where p.reserva_id=p_id
  and exists(select 1 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where pa.pago_id=p.id and c.reserva_id=p_id and c.tipo_cargo='alojamiento' and c.servicio_id is null)
  and exists(select 1 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where pa.pago_id=p.id and c.reserva_id=p_id and (c.tipo_cargo is distinct from 'alojamiento' or c.servicio_id is not null))
 ) then raise exception 'Pago mezclado entre alojamiento y servicios: requiere revisión'; end if;
 if exists(
  select 1 from public.pagos p where p.reserva_id=p_id
  and exists(select 1 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where pa.pago_id=p.id and c.reserva_id=p_id and (c.tipo_cargo is distinct from 'alojamiento' or c.servicio_id is not null))
  and p.monto is distinct from (select coalesce(sum(pa.monto_aplicado),0) from public.pago_aplicaciones pa where pa.pago_id=p.id)
 ) then raise exception 'Pago de servicio con remanente ambiguo: requiere revisión'; end if;

 select coalesce(sum(p.monto),0) into confirmado from public.pagos p where p.reserva_id=p_id
 and exists(select 1 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where pa.pago_id=p.id and c.reserva_id=p_id and c.tipo_cargo='alojamiento' and c.servicio_id is null and c.estado='activo');
 if confirmado>(p_plan->>'total_objetivo')::bigint then raise exception 'Sobrepago de alojamiento: confirmado % supera objetivo %',confirmado,p_plan->>'total_objetivo'; end if;

 select coalesce(jsonb_object_agg(pa.id::text,to_jsonb(pa)),'{}'),coalesce(sum(pa.monto_aplicado),0) into apps,inicial
 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id
 where c.reserva_id=p_id and c.tipo_cargo='alojamiento' and c.servicio_id is null and c.estado='activo';
 original:=apps;
 for f in select value v from jsonb_array_elements(p_plan->'filas') order by value->>'fecha',value->>'cargo_id' loop
  capacidad:=(f.v->>'base_nueva')::bigint-(f.v->>'iva_nuevo')::bigint;
  select greatest(coalesce(sum((value->>'monto_aplicado')::bigint),0)-capacidad,0) into exceso from jsonb_each(apps) where value->>'cargo_id'=f.v->>'cargo_id';
  for app_fila in select key,value from jsonb_each(apps) where value->>'cargo_id'=f.v->>'cargo_id' order by value->>'pago_id',key loop
   exit when exceso=0; cantidad:=least(exceso,(app_fila.value->>'monto_aplicado')::bigint);
   apps:=jsonb_set(apps,array[app_fila.key,'monto_aplicado'],to_jsonb((app_fila.value->>'monto_aplicado')::bigint-cantidad)); exceso:=exceso-cantidad;
  end loop;
 end loop;
 for destino in select 1 fase union all select 2 order by fase loop
  for pago_fila in select q.*,coalesce((select sum((v->>'monto_aplicado')::bigint) from jsonb_each(original) o(k,v) where v->>'pago_id'=q.id::text),0) original_aplicado
   from public.pagos q where q.reserva_id=p_id
   and exists(select 1 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where pa.pago_id=q.id and c.reserva_id=p_id and c.tipo_cargo='alojamiento' and c.servicio_id is null and c.estado='activo')
   order by q.id
  loop
   select coalesce(sum((value->>'monto_aplicado')::bigint),0) into usado from jsonb_each(apps) where value->>'pago_id'=pago_fila.id::text;
   exceso:=(case when destino.fase=1 then pago_fila.original_aplicado else pago_fila.monto end)-usado;
   for f in select value v from jsonb_array_elements(p_plan->'filas') order by value->>'fecha',value->>'cargo_id' loop
    exit when exceso<=0;
    select (f.v->>'base_nueva')::bigint-(f.v->>'iva_nuevo')::bigint-coalesce(sum((value->>'monto_aplicado')::bigint),0) into capacidad from jsonb_each(apps) where value->>'cargo_id'=f.v->>'cargo_id';
    cantidad:=least(exceso,capacidad); if cantidad<=0 then continue; end if;
    select key into existente from jsonb_each(apps) where value->>'pago_id'=pago_fila.id::text and value->>'cargo_id'=f.v->>'cargo_id';
    if existente is null then
     clave:=gen_random_uuid()::text;
     fila:=jsonb_build_object('id',clave,'pago_id',pago_fila.id,'cargo_id',f.v->>'cargo_id','monto_aplicado',cantidad,'creado_en',now());
     apps:=apps||jsonb_build_object(clave,fila);
    else apps:=jsonb_set(apps,array[existente,'monto_aplicado'],to_jsonb((apps->existente->>'monto_aplicado')::bigint+cantidad)); end if;
    exceso:=exceso-cantidad;
   end loop;
   if exceso>0 then raise exception 'Redistribución de alojamiento imposible: capacidad insuficiente'; end if;
  end loop;
 end loop;
 select coalesce(jsonb_object_agg(key,value),'{}') into apps from jsonb_each(apps) where (value->>'monto_aplicado')::bigint>0;
 select coalesce(jsonb_agg(p.id order by p.id),'[]') into pagos_alojamiento from public.pagos p where p.reserva_id=p_id and exists(select 1 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where pa.pago_id=p.id and c.reserva_id=p_id and c.tipo_cargo='alojamiento' and c.servicio_id is null);
 select coalesce(jsonb_agg(p.id order by p.id),'[]') into pagos_servicio from public.pagos p where p.reserva_id=p_id and exists(select 1 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where pa.pago_id=p.id and c.reserva_id=p_id and (c.tipo_cargo is distinct from 'alojamiento' or c.servicio_id is not null));
 select coalesce(sum(p.monto),0) into sin_aplicar from public.pagos p where p.reserva_id=p_id
  and not exists(select 1 from public.pago_aplicaciones pa where pa.pago_id=p.id);
 return jsonb_build_object('antes',original,'despues',apps,'aplicado_anterior',inicial,'aplicado_final',confirmado,'incremento',confirmado-inicial,'sin_aplicar_final',sin_aplicar,'pagos_alojamiento',pagos_alojamiento,'pagos_servicio_preservados',pagos_servicio);
end;
$$;
revoke all on function private.haiku_plan_aplicaciones_total_v32(uuid,jsonb) from public,anon,authenticated;

create or replace function private.haiku_plan_total_financiero_v32(p_id uuid,p_objetivo bigint)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare r public.reservas%rowtype; e public.reserva_estadias%rowtype;
 n integer; noches_vigentes uuid[]; x record; nuevo bigint; actual bigint; filas jsonb:='[]'::jsonb; plan jsonb;
 servicios_total bigint; servicios_pendientes bigint;
begin
 if auth.uid() is null or private.haiku_tiene_permiso('reservas.editar') is not true or private.haiku_tiene_permiso('pagos.ver') is not true then raise exception 'Sin permisos para cambiar totales'; end if;
 if p_objetivo is null or p_objetivo<=0 or p_objetivo>7000000000000000 then raise exception 'Total fuera de rango'; end if;
 select * into strict r from public.reservas where id=p_id;
 if r.grupo_reserva_id is not null or r.estado_reserva in('cancelada','no_show') then raise exception 'Reserva no compatible'; end if;
 if (select count(*) from public.reserva_estadias where reserva_id=p_id)<>1 then raise exception 'Varias estadías: requiere revisión'; end if;
 select * into strict e from public.reserva_estadias where reserva_id=p_id;
 if e.estado_estadia in('cancelada','no_show') then raise exception 'Estadía no editable'; end if;
 select total_alojamiento into actual from public.vista_saldos_alojamiento_reserva where reserva_id=p_id;
 if actual is null then raise exception 'Total financiero no disponible'; end if;
 if exists(select 1 from public.cargo_ajustes a join public.cargos c on c.id=a.cargo_id where a.reserva_id=p_id and a.estado='activo' and c.reserva_id=p_id and c.tipo_cargo='alojamiento' and c.servicio_id is null and c.estado='activo') then
  plan:=private.haiku_plan_total_iva_v32(p_id,p_objetivo);
 else
  if e.tipo_estadia='alojamiento' then
   n:=e.fecha_salida-e.fecha_ingreso;
   select array_agg(id order by fecha,id) into noches_vigentes
   from public.estadia_noches where estadia_id=e.id and fecha>=e.fecha_ingreso and fecha<e.fecha_salida;
   if exists(select 1 from public.estadia_noches en where en.estadia_id=e.id
    and (en.fecha<e.fecha_ingreso or en.fecha>=e.fecha_salida)
    and (not exists(select 1 from public.cargos c where c.estadia_noche_id=en.id
          and c.reserva_id=p_id and c.estadia_id=e.id and c.tipo_cargo='alojamiento' and c.servicio_id is null and c.estado='anulado')
         or exists(select 1 from public.cargos c where c.estadia_noche_id=en.id and c.estado is distinct from 'anulado')))
   then raise exception 'Hay noches fuera del rango sin un historial de cargos anulados verificable'; end if;
   if n is null or n<=0 or cardinality(noches_vigentes) is distinct from n
    or (select count(distinct fecha) from public.estadia_noches where id=any(noches_vigentes))<>n
    or (select count(distinct tarifa) from public.estadia_noches where id=any(noches_vigentes))<>1
    or exists(select 1 from public.estadia_noches where id=any(noches_vigentes) and tarifa<=0)
    or (select sum(tarifa) from public.estadia_noches where id=any(noches_vigentes)) is distinct from actual
    then raise exception 'Tarifas variables o noches incompletas: requiere revisión'; end if;
   if (select count(*) from public.cargos where reserva_id=p_id and tipo_cargo='alojamiento' and servicio_id is null and estado='activo')<>n then raise exception 'Cargos de alojamiento no inequívocos'; end if;
   for x in select en.*,row_number() over(order by en.fecha,en.id) posicion from public.estadia_noches en where en.id=any(noches_vigentes) order by fecha,id loop
    if (select count(*) from public.cargos where estadia_noche_id=x.id and estado='activo' and tipo_cargo='alojamiento' and servicio_id is null)<>1 then raise exception 'La noche no tiene un único cargo activo de alojamiento'; end if;
    nuevo:=p_objetivo/n+case when x.posicion<=p_objetivo%n then 1 else 0 end;
    filas:=filas||jsonb_build_array((select jsonb_build_object('noche_id',x.id,'fecha',x.fecha,'cargo_id',c.id,'base_actual',x.tarifa,'base_nueva',nuevo,'iva_actual',0,'iva_nuevo',0)
     from public.cargos c where c.estadia_noche_id=x.id and c.estado='activo' and c.tipo_cargo='alojamiento' and c.servicio_id is null and c.reserva_id=p_id and c.estadia_id=e.id and c.monto=x.tarifa));
   end loop;
  elsif e.tipo_estadia='fullday' then
   if e.fecha_ingreso is null or e.fecha_salida is distinct from e.fecha_ingreso or exists(select 1 from public.estadia_noches where estadia_id=e.id)
    or (select count(*) from public.cargos where reserva_id=p_id and tipo_cargo='alojamiento' and servicio_id is null and estado='activo')<>1 then raise exception 'Full Day no inequívoco'; end if;
   filas:=jsonb_build_array((select jsonb_build_object('noche_id',null,'fecha',e.fecha_ingreso,'cargo_id',c.id,'base_actual',c.monto,'base_nueva',p_objetivo,'iva_actual',0,'iva_nuevo',0)
    from public.cargos c where c.reserva_id=p_id and c.estadia_id=e.id and c.estadia_noche_id is null and c.tipo_cargo='alojamiento' and c.servicio_id is null and c.estado='activo' and c.monto=actual));
  else raise exception 'Tipo no compatible'; end if;
  plan:=jsonb_build_object('reserva_id',p_id,'total_actual',actual,'total_objetivo',p_objetivo,'filas',filas);
 end if;
 for x in select value f from jsonb_array_elements(plan->'filas') loop
  if x.f is null or jsonb_typeof(x.f)<>'object' or x.f->>'cargo_id' is null or (x.f->>'base_nueva')::bigint<=0 then raise exception 'Plan financiero no inequívoco'; end if;
  if x.f->>'noche_id' is not null and (select count(*) from public.cargos where estadia_noche_id=(x.f->>'noche_id')::uuid and estado='activo' and tipo_cargo='alojamiento' and servicio_id is null)<>1 then raise exception 'La noche no tiene un único cargo activo de alojamiento'; end if;
 end loop;
 plan:=plan||jsonb_build_object('reconciliacion',private.haiku_plan_aplicaciones_total_v32(p_id,plan));
 select coalesce(sum(ec.monto_ajustado),0),coalesce(sum(ec.saldo_cargo),0) into servicios_total,servicios_pendientes
 from public.vista_estado_cargos ec where ec.reserva_id=p_id and ec.estado='activo' and ec.tipo_cargo is distinct from 'alojamiento' and ec.servicio_id is not null;
 return plan||jsonb_build_object('separacion_servicios',jsonb_build_object(
  'segura',true,
  'servicios_sin_cambios',servicios_total,
  'servicios_pendientes',servicios_pendientes,
  'total_reserva_actual',actual+servicios_total,
  'total_reserva_esperado',p_objetivo+servicios_total
 ));
end;
$$;
revoke all on function private.haiku_plan_total_financiero_v32(uuid,bigint) from public,anon,authenticated;
