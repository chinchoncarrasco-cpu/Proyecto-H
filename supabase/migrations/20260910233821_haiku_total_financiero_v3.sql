-- Candidata V3, NO desplegada. Aplicar sólo como nueva migración con historial.
-- Requiere V2. Mantiene sus funciones privadas y migraciones históricas intactas.
begin;
create or replace function private.haiku_plan_total_iva_v3(p_id uuid,p_objetivo bigint)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare
 r public.reservas%rowtype; e public.reserva_estadias%rowtype;
 v_fila record; base bigint; final_actual bigint; nueva_base bigint; ajuste bigint;
 cantidad integer; orden integer:=0; acumulado bigint:=0; monto_base bigint; monto_iva bigint;
 filas jsonb:='[]'; firma text; ajustes_snapshot jsonb;
begin
 if auth.uid() is null or private.haiku_tiene_permiso('reservas.editar') is not true or private.haiku_tiene_permiso('pagos.ver') is not true or private.haiku_tiene_permiso('pagos.registrar') is not true then raise exception 'Se requieren reservas.editar, pagos.ver y pagos.registrar para conservar IVA'; end if;
 if p_objetivo is null or p_objetivo<=0 or p_objetivo>7000000000000000 then raise exception 'Total objetivo fuera de rango'; end if;
 select * into strict r from public.reservas where id=p_id;
 if r.grupo_reserva_id is not null or r.estado_reserva in ('cancelada','no_show') then raise exception 'Reserva no compatible con tratamiento IVA automático'; end if;
 if (select count(*) from public.reserva_estadias where reserva_id=p_id)<>1 then raise exception 'Varias estadías: requiere revisión'; end if;
 select * into strict e from public.reserva_estadias where reserva_id=p_id;
 if e.estado_estadia in ('cancelada','no_show') or e.tipo_estadia<>'alojamiento' or e.fecha_salida<=e.fecha_ingreso then raise exception 'Se requiere alojamiento con noches'; end if;
 cantidad:=e.fecha_salida-e.fecha_ingreso;
 if (select count(*) from public.estadia_noches where estadia_id=e.id)<>cantidad or
    (select count(distinct tarifa) from public.estadia_noches where estadia_id=e.id)<>1 or
    exists(select 1 from public.estadia_noches where estadia_id=e.id and (fecha<e.fecha_ingreso or fecha>=e.fecha_salida or tarifa<=0)) then raise exception 'Se requieren tarifas uniformes y noches completas'; end if;
 if (select count(distinct operacion_id) from public.cargo_ajustes where reserva_id=p_id and estado='activo')<>1 or
    exists(select 1 from public.cargo_ajustes where reserva_id=p_id and estado='activo' and (tipo_ajuste is distinct from 'iva_exento' or signo is distinct from -1 or porcentaje is distinct from 19 or operacion_id is null)) then raise exception 'Sólo se admite una operación iva_exento activa; otros ajustes requieren revisión'; end if;
 if (select count(*) from public.cargos where reserva_id=p_id and tipo_cargo='alojamiento' and estado='activo')<>cantidad or
    (select count(*) from public.cargo_ajustes where reserva_id=p_id and estado='activo')<>cantidad then raise exception 'Cargos o ajustes incompletos'; end if;
 if exists(select 1 from public.estadia_noches n where n.estadia_id=e.id and
   (select count(*) from public.cargos c join public.cargo_ajustes a on a.cargo_id=c.id where c.estadia_noche_id=n.id and c.reserva_id=p_id and c.estadia_id=e.id and c.tipo_cargo='alojamiento' and c.estado='activo' and a.reserva_id=p_id and a.estado='activo' and a.base_calculo=c.monto and c.monto=n.tarifa and a.monto>0)<>1) then raise exception 'La exención no corresponde inequívocamente a las noches y cargos activos'; end if;
 select sum(monto) into base from public.cargos where reserva_id=p_id and tipo_cargo='alojamiento' and estado='activo';
 select total_alojamiento into final_actual from public.vista_saldos_alojamiento_reserva where reserva_id=p_id;
 if (select sum(monto) from public.cargo_ajustes where reserva_id=p_id and estado='activo') is distinct from private.haiku_iva_incluido(base) or
    final_actual is distinct from base-private.haiku_iva_incluido(base) then raise exception 'La exención existente no cumple la regla autoritativa'; end if;
 nueva_base:=case when p_objetivo=final_actual then base else round(p_objetivo::numeric*1.19)::bigint end;
 ajuste:=private.haiku_iva_incluido(nueva_base);
 if nueva_base-ajuste<>p_objetivo then raise exception 'No se obtiene el total final exacto'; end if;
 -- Tarifas: cociente y pesos residuales por fecha/ID de noche ascendente.
 -- IVA: orden de cargos creado_en/id y residuo final, como aplicar_ajuste_reserva.
 for v_fila in
  select n.id noche_id,n.fecha,c.id cargo_id,c.monto,c.creado_en,a.id ajuste_id,a.monto ajuste_actual,
    a.base_calculo,a.operacion_id,a.creado_por,a.creado_en ajuste_creado_en,
    row_number() over(order by n.fecha,n.id) posicion,ec.aplicado_neto
  from public.estadia_noches n join public.cargos c on c.estadia_noche_id=n.id
  join public.cargo_ajustes a on a.cargo_id=c.id join public.vista_estado_cargos ec on ec.cargo_id=c.id
  where n.estadia_id=e.id and c.tipo_cargo='alojamiento' and c.estado='activo' and a.estado='activo'
  order by c.creado_en,c.id
 loop
  orden:=orden+1;
  monto_base:=nueva_base/cantidad+case when v_fila.posicion<=nueva_base%cantidad then 1 else 0 end;
  monto_iva:=case when p_objetivo=final_actual then v_fila.ajuste_actual when orden<cantidad then private.haiku_iva_incluido(monto_base) else ajuste-acumulado end;
  acumulado:=acumulado+monto_iva;
  if monto_base<=0 or monto_iva<=0 then raise exception 'El nuevo importe de una noche no admite sus pagos aplicados; requiere revisión'; end if;
  filas:=filas||jsonb_build_array(jsonb_build_object('noche_id',v_fila.noche_id,'cargo_id',v_fila.cargo_id,'ajuste_id',v_fila.ajuste_id,'fecha',v_fila.fecha,'base_actual',v_fila.monto,'iva_actual',v_fila.ajuste_actual,'base_nueva',monto_base,'iva_nuevo',monto_iva));
 end loop;
 select jsonb_agg(to_jsonb(a) order by a.id) into ajustes_snapshot from public.cargo_ajustes a where reserva_id=p_id and estado='activo';
 firma:=md5(jsonb_build_object('ajustes',ajustes_snapshot,'filas',filas,'total_actual',final_actual)::text);
 return jsonb_build_object('reserva_id',p_id,'total_actual',final_actual,'total_objetivo',p_objetivo,'base_actual',base,'iva_actual',base-final_actual,'base_nueva',nueva_base,'iva_nuevo',ajuste,'total_final_esperado',nueva_base-ajuste,'filas',filas,'firma',firma);
end;
$$;
revoke all on function private.haiku_plan_total_iva_v3(uuid,bigint) from public,anon,authenticated;

-- Plan privado, sin escrituras. Sólo el writer ejecuta el plan tras adquirir locks.
create or replace function private.haiku_plan_aplicaciones_total_v3(p_id uuid,p_plan jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare apps jsonb; original jsonb; f record; a record; pago_fila record; destino record;
 exceso bigint; usado bigint; cantidad bigint; capacidad bigint; confirmado bigint; inicial bigint;
 clave text; existente text; fila jsonb;
begin
 if private.haiku_tiene_permiso('pagos.registrar') is not true then raise exception 'Sin permiso para reconciliar aplicaciones'; end if;
 -- Sin inferir destino a partir de nombres, glosas ni montos. Ante mezcla, bloquear.
 if exists(select 1 from public.cargos where reserva_id=p_id and (tipo_cargo is distinct from 'alojamiento' or estado is distinct from 'activo'))
 or exists(select 1 from public.servicios where reserva_id=p_id)
 then raise exception 'Servicios u otros cargos: destino del dinero requiere revisión'; end if;
 if exists(select 1 from public.pagos p where p.reserva_id=p_id and
  (p.estado is distinct from 'confirmado' or p.tipo_movimiento is distinct from 'pago' or p.pago_origen_id is not null
   or p.pago_grupo_id is not null or p.etapa_operativa not in('abono','saldo') or p.etapa_operativa is null or p.monto<=0
   or not exists(select 1 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where pa.pago_id=p.id and c.reserva_id=p_id and c.tipo_cargo='alojamiento' and c.estado='activo')
   or jsonb_typeof(coalesce(p.datos_origen,'{}'))<>'object'
   or exists(select 1 from jsonb_object_keys(coalesce(p.datos_origen,'{}')) k where k not in('verificacion_migrada','verificacion_migrada_en','bovtar','item_id','contexto','fecha_bloque','operacion_id','origen_libro','concepto_libro','aprobado_manualmente','ultima_actualizacion_libro'))
   or (p.datos_origen ? 'contexto' and p.datos_origen->>'contexto' is distinct from 'haku_libro_incorporacion')
   or (p.datos_origen ? 'concepto_libro' and coalesce(p.datos_origen->>'concepto_libro','') !~* '^cab\s*[0-9]+\s*/\s*[0-9]+\s*noches?$')))
 then raise exception 'Pago no elegible o destino ambiguo: requiere revisión'; end if;
 if exists(select 1 from public.pagos where pago_origen_id in(select id from public.pagos where reserva_id=p_id)) then raise exception 'Pago con devolución vinculada: requiere revisión'; end if;
 if exists(select 1 from public.pago_aplicaciones pa join public.pagos p on p.id=pa.pago_id join public.cargos c on c.id=pa.cargo_id
  where (p.reserva_id=p_id or c.reserva_id=p_id) and (p.reserva_id is distinct from p_id or c.reserva_id is distinct from p_id or pa.monto_aplicado<=0))
 then raise exception 'Aplicaciones ajenas o incompatibles'; end if;
 if exists(select 1 from public.pagos p where p.reserva_id=p_id and p.monto<(select coalesce(sum(pa.monto_aplicado),0) from public.pago_aplicaciones pa where pa.pago_id=p.id)) then raise exception 'Aplicaciones superiores al pago'; end if;
 select coalesce(sum(monto),0) into confirmado from public.pagos where reserva_id=p_id;
 if confirmado>(p_plan->>'total_objetivo')::bigint then raise exception 'Sobrepago: confirmado % supera objetivo %',confirmado,p_plan->>'total_objetivo'; end if;
 select coalesce(jsonb_object_agg(pa.id::text,to_jsonb(pa)),'{}'),coalesce(sum(pa.monto_aplicado),0) into apps,inicial
 from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where c.reserva_id=p_id;
 original:=apps;
 -- Liberar sólo excesos físicos, con desempate por pago/id estable.
 for f in select value v from jsonb_array_elements(p_plan->'filas') order by value->>'fecha',value->>'cargo_id' loop
  capacidad:=(f.v->>'base_nueva')::bigint-(f.v->>'iva_nuevo')::bigint;
  select greatest(coalesce(sum((value->>'monto_aplicado')::bigint),0)-capacidad,0) into exceso from jsonb_each(apps) where value->>'cargo_id'=f.v->>'cargo_id';
  for a in select key,value from jsonb_each(apps) where value->>'cargo_id'=f.v->>'cargo_id' order by value->>'pago_id',key loop
   exit when exceso=0; cantidad:=least(exceso,(a.value->>'monto_aplicado')::bigint);
   apps:=jsonb_set(apps,array[a.key,'monto_aplicado'],to_jsonb((a.value->>'monto_aplicado')::bigint-cantidad)); exceso:=exceso-cantidad;
  end loop;
 end loop;
 -- Primero dinero liberado, después remanente previamente sin aplicar.
 for destino in select 1 fase union all select 2 order by fase loop
  for pago_fila in select q.*,coalesce((select sum((v->>'monto_aplicado')::bigint) from jsonb_each(original) o(k,v) where v->>'pago_id'=q.id::text),0) original_aplicado from public.pagos q where q.reserva_id=p_id order by q.id loop
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
   if exceso>0 then raise exception 'Redistribución imposible: capacidad insuficiente'; end if;
  end loop;
 end loop;
 select coalesce(jsonb_object_agg(key,value),'{}') into apps from jsonb_each(apps) where (value->>'monto_aplicado')::bigint>0;
 return jsonb_build_object('antes',original,'despues',apps,'aplicado_anterior',inicial,'aplicado_final',confirmado,'incremento',confirmado-inicial,'sin_aplicar_final',0);
end;
$$;
revoke all on function private.haiku_plan_aplicaciones_total_v3(uuid,jsonb) from public,anon,authenticated;

create or replace function private.haiku_ejecutar_aplicaciones_total_v3(p_plan jsonb,p_fase text)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare a record; nuevo jsonb;
begin
 if p_fase='liberar' then
  for a in select key,value from jsonb_each(p_plan->'antes') order by key loop
   nuevo:=p_plan->'despues'->a.key;
   if nuevo is null then delete from public.pago_aplicaciones where id=a.key::uuid;
   elsif (nuevo->>'monto_aplicado')::bigint<(a.value->>'monto_aplicado')::bigint then
    update public.pago_aplicaciones set monto_aplicado=(nuevo->>'monto_aplicado')::bigint where id=a.key::uuid;
   end if;
  end loop;
 elsif p_fase='aplicar' then
  for a in select key,value from jsonb_each(p_plan->'despues') order by key loop
   nuevo:=p_plan->'antes'->a.key;
   if nuevo is null then
    insert into public.pago_aplicaciones(id,pago_id,cargo_id,monto_aplicado,creado_en) values(a.key::uuid,(a.value->>'pago_id')::uuid,(a.value->>'cargo_id')::uuid,(a.value->>'monto_aplicado')::bigint,(a.value->>'creado_en')::timestamptz);
   elsif (a.value->>'monto_aplicado')::bigint>(nuevo->>'monto_aplicado')::bigint then
    update public.pago_aplicaciones set monto_aplicado=(a.value->>'monto_aplicado')::bigint where id=a.key::uuid;
   end if;
  end loop;
 else raise exception 'Fase inválida'; end if;
end;
$$;
revoke all on function private.haiku_ejecutar_aplicaciones_total_v3(jsonb,text) from public,anon,authenticated;

create or replace function private.haiku_plan_total_financiero_v3(p_id uuid,p_objetivo bigint)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare r public.reservas%rowtype; e public.reserva_estadias%rowtype;
 n integer; x record; nuevo bigint; actual bigint; filas jsonb:='[]'; plan jsonb;
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
 if exists(select 1 from public.cargo_ajustes where reserva_id=p_id and estado='activo') then
  -- Misma autoridad usada por la preview ya validada, sin duplicar fórmula IVA.
  plan:=private.haiku_plan_total_iva_v3(p_id,p_objetivo);
 else
  if e.tipo_estadia='alojamiento' then
   n:=e.fecha_salida-e.fecha_ingreso;
   if n is null or n<=0 or (select count(*) from public.estadia_noches where estadia_id=e.id)<>n
    or (select count(distinct tarifa) from public.estadia_noches where estadia_id=e.id)<>1
    or exists(select 1 from public.estadia_noches where estadia_id=e.id and (fecha<e.fecha_ingreso or fecha>=e.fecha_salida or tarifa<=0))
    or (select sum(tarifa) from public.estadia_noches where estadia_id=e.id) is distinct from actual
    then raise exception 'Tarifas variables o noches incompletas: requiere revisión'; end if;
   if (select count(*) from public.cargos where reserva_id=p_id and tipo_cargo='alojamiento' and estado='activo')<>n then raise exception 'Cargos de alojamiento no inequívocos'; end if;
   for x in select en.*,row_number() over(order by en.fecha,en.id) posicion from public.estadia_noches en where estadia_id=e.id order by fecha,id loop
    if (select count(*) from public.cargos where estadia_noche_id=x.id and estado='activo')<>1 then raise exception 'La noche no tiene un único cargo activo'; end if;
    nuevo:=p_objetivo/n+case when x.posicion<=p_objetivo%n then 1 else 0 end;
    filas:=filas||jsonb_build_array((select jsonb_build_object('noche_id',x.id,'fecha',x.fecha,'cargo_id',c.id,'base_actual',x.tarifa,'base_nueva',nuevo,'iva_actual',0,'iva_nuevo',0)
     from public.cargos c where c.estadia_noche_id=x.id and c.estado='activo' and c.tipo_cargo='alojamiento' and c.reserva_id=p_id and c.estadia_id=e.id and c.monto=x.tarifa));
   end loop;
  elsif e.tipo_estadia='fullday' then
   if e.fecha_ingreso is null or e.fecha_salida is distinct from e.fecha_ingreso or exists(select 1 from public.estadia_noches where estadia_id=e.id)
    or (select count(*) from public.cargos where reserva_id=p_id and tipo_cargo='alojamiento' and estado='activo')<>1 then raise exception 'Full Day no inequívoco'; end if;
   filas:=jsonb_build_array((select jsonb_build_object('noche_id',null,'fecha',e.fecha_ingreso,'cargo_id',c.id,'base_actual',c.monto,'base_nueva',p_objetivo,'iva_actual',0,'iva_nuevo',0)
    from public.cargos c where c.reserva_id=p_id and c.estadia_id=e.id and c.estadia_noche_id is null and c.tipo_cargo='alojamiento' and c.estado='activo' and c.monto=actual));
  else raise exception 'Tipo no compatible'; end if;
  plan:=jsonb_build_object('reserva_id',p_id,'total_actual',actual,'total_objetivo',p_objetivo,'filas',filas);
 end if;
 -- Verificar también la selección exacta que hace el trigger oficial de noches.
 for x in select value f from jsonb_array_elements(plan->'filas') loop
  if x.f is null or jsonb_typeof(x.f)<>'object' or x.f->>'cargo_id' is null or (x.f->>'base_nueva')::bigint<=0 then raise exception 'Plan financiero no inequívoco'; end if;
  if x.f->>'noche_id' is not null and (select count(*) from public.cargos where estadia_noche_id=(x.f->>'noche_id')::uuid and estado='activo')<>1 then raise exception 'La noche no tiene un único cargo activo'; end if;
 end loop;
 plan:=plan||jsonb_build_object('reconciliacion',private.haiku_plan_aplicaciones_total_v3(p_id,plan));
 return plan;
end;
$$;
revoke all on function private.haiku_plan_total_financiero_v3(uuid,bigint) from public,anon,authenticated;

-- Lista de cambios permitidos POR FILA. El resto se compara literalmente,
-- incluidos documentos, origen_tarifa y timestamps de las entidades no financieras.
create or replace function private.haiku_snapshot_total_financiero_v3(p_id uuid,p_plan jsonb)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 with e as (select * from public.reserva_estadias where reserva_id=p_id),
 h as (select titular_huesped_id id from public.reservas where id=p_id union select huesped_id from public.reserva_huespedes where reserva_id=p_id union select eh.huesped_id from public.estadia_huespedes eh where estadia_id in(select id from e)),
 f as (select value v from jsonb_array_elements(p_plan->'filas'))
 select jsonb_build_object(
 'reserva',(select to_jsonb(r) from public.reservas r where id=p_id),
 'estadias',(select jsonb_agg(to_jsonb(e) order by id) from e),
 'huespedes',(select jsonb_agg(to_jsonb(x) order by id) from public.huespedes x where id in(select id from h)),
 'vinculos',(select jsonb_agg(to_jsonb(x) order by huesped_id) from public.reserva_huespedes x where reserva_id=p_id),
 'ocupantes',(select jsonb_agg(to_jsonb(x) order by estadia_id,huesped_id) from public.estadia_huespedes x where estadia_id in(select id from e)),
 'pagos',(select jsonb_agg(to_jsonb(x) order by id) from public.pagos x where reserva_id=p_id or id in(select pa.pago_id from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where c.reserva_id=p_id)),
 'servicios',(select jsonb_agg(to_jsonb(x) order by id) from public.servicios x where reserva_id=p_id),
 'solicitudes',(select jsonb_agg(to_jsonb(x) order by id) from public.solicitudes x where reserva_id=p_id or estadia_id in(select id from e) or huesped_id in(select id from h)),
 'notas',(select jsonb_agg(to_jsonb(x) order by id) from public.notas x where reserva_id=p_id or estadia_id in(select id from e) or huesped_id in(select id from h)),
 'noches',(select jsonb_agg(case when exists(select 1 from f where (v->>'noche_id')::uuid=x.id and v->'base_actual' is distinct from v->'base_nueva') then to_jsonb(x)-'tarifa'-'actualizado_en' else to_jsonb(x) end order by x.id) from public.estadia_noches x where estadia_id in(select id from e)),
 'cargos',(select jsonb_agg(case when exists(select 1 from f where (v->>'cargo_id')::uuid=x.id and v->'base_actual' is distinct from v->'base_nueva') then to_jsonb(x)-'monto'-'actualizado_en' else to_jsonb(x) end order by x.id) from public.cargos x where reserva_id=p_id),
 'ajustes',(select jsonb_agg(case when exists(select 1 from f where (v->>'ajuste_id')::uuid=x.id and (v->'base_actual' is distinct from v->'base_nueva' or v->'iva_actual' is distinct from v->'iva_nuevo')) then to_jsonb(x)-'base_calculo'-'monto' else to_jsonb(x) end order by x.id) from public.cargo_ajustes x where reserva_id=p_id)
 );
$$;
revoke all on function private.haiku_snapshot_total_financiero_v3(uuid,jsonb) from public,anon,authenticated;

create or replace function public.haiku_cambiar_totales_lote_v1(p_cambios jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare item jsonb; rid uuid; plan jsonb; fila jsonb; planes jsonb:='{}'; antes jsonb:='{}'; despues jsonb;
 esperado bigint; objetivo bigint; actual bigint; resultados jsonb:='[]'; auditoria jsonb; campo text;
begin
 if auth.uid() is null or private.haiku_tiene_permiso('reservas.editar') is not true or private.haiku_tiene_permiso('pagos.ver') is not true then raise exception 'Sin permisos para cambiar totales' using errcode='42501'; end if;
 if jsonb_typeof(p_cambios) is distinct from 'array' then raise exception 'Se requiere un lote'; end if;
 if jsonb_array_length(p_cambios) not between 1 and 20 then raise exception 'El lote admite entre 1 y 20 reservas'; end if;
 for item in select value from jsonb_array_elements(p_cambios) loop
  if coalesce(item->>'reserva_id','')='' or coalesce(item->>'total_actual','')!~'^[0-9]+$' or coalesce(item->>'total_objetivo','')!~'^[0-9]+$' then raise exception 'Entrada inválida'; end if;
  rid:=(item->>'reserva_id')::uuid; objetivo:=(item->>'total_objetivo')::bigint; esperado:=(item->>'total_actual')::bigint;
  if objetivo<=0 or objetivo>7000000000000000 or esperado>9007199254740991 then raise exception 'Total fuera de rango'; end if;
 end loop;
 if (select count(distinct (value->>'reserva_id')::uuid) from jsonb_array_elements(p_cambios))<>jsonb_array_length(p_cambios) then raise exception 'Reserva repetida'; end if;
 for rid in select (value->>'reserva_id')::uuid from jsonb_array_elements(p_cambios) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended(rid::text,0));
  perform 1 from public.reservas where id=rid for update;
  if not found then raise exception 'Reserva inexistente'; end if;
  perform 1 from public.reserva_estadias where reserva_id=rid order by id for update;
  perform 1 from public.cargos where reserva_id=rid order by id for update;
  perform 1 from public.pagos where reserva_id=rid order by id for update;
  perform 1 from public.pago_aplicaciones where cargo_id in(select id from public.cargos where reserva_id=rid) or pago_id in(select id from public.pagos where reserva_id=rid) order by id for update;
  perform 1 from public.servicios where reserva_id=rid order by id for update;
  perform 1 from public.cargo_ajustes where reserva_id=rid order by id for update;
  perform 1 from public.estadia_noches where estadia_id in(select id from public.reserva_estadias where reserva_id=rid) order by id for update;
 end loop;
 -- Todos los expected totals y planes se validan ANTES de modificar una sola fila.
 for item in select value from jsonb_array_elements(p_cambios) order by (value->>'reserva_id')::uuid loop
  rid:=(item->>'reserva_id')::uuid; esperado:=(item->>'total_actual')::bigint; objetivo:=(item->>'total_objetivo')::bigint;
  select total_alojamiento into actual from public.vista_saldos_alojamiento_reserva where reserva_id=rid;
  if actual is distinct from esperado then raise exception 'El total cambió desde la preview; lote revertido'; end if;
  plan:=private.haiku_plan_total_financiero_v3(rid,objetivo);
  if plan ? 'firma' and coalesce(item->>'firma_iva','') is distinct from plan->>'firma' then raise exception 'El plan IVA cambió desde la preview'; end if;
  if not(plan ? 'firma') and item ? 'firma_iva' then raise exception 'La operación IVA ya no está disponible'; end if;
  planes:=planes||jsonb_build_object(rid::text,plan);
  antes:=antes||jsonb_build_object(rid::text,private.haiku_snapshot_total_financiero_v3(rid,plan));
 end loop;
 select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') into auditoria from public.eventos_auditoria a where reserva_id in(select (value->>'reserva_id')::uuid from jsonb_array_elements(p_cambios));
 for item in select value from jsonb_array_elements(p_cambios) order by (value->>'reserva_id')::uuid loop
  rid:=(item->>'reserva_id')::uuid; plan:=planes->rid::text;
  if (item->>'total_actual')::bigint<>(item->>'total_objetivo')::bigint then
   perform private.haiku_ejecutar_aplicaciones_total_v3(plan->'reconciliacion','liberar');
   for fila in select value from jsonb_array_elements(plan->'filas') loop
    if fila->'base_actual' is distinct from fila->'base_nueva' then
     if fila->>'noche_id' is not null then
      update public.estadia_noches set tarifa=(fila->>'base_nueva')::bigint where id=(fila->>'noche_id')::uuid;
     else
      update public.cargos set monto=(fila->>'base_nueva')::bigint where id=(fila->>'cargo_id')::uuid;
     end if;
    end if;
    if fila->>'ajuste_id' is not null and (fila->'base_actual' is distinct from fila->'base_nueva' or fila->'iva_actual' is distinct from fila->'iva_nuevo') then
     update public.cargo_ajustes set base_calculo=(fila->>'base_nueva')::bigint,monto=(fila->>'iva_nuevo')::bigint where id=(fila->>'ajuste_id')::uuid;
    end if;
   end loop;
   perform private.haiku_ejecutar_aplicaciones_total_v3(plan->'reconciliacion','aplicar');
   insert into public.eventos_auditoria(usuario_id,accion,tipo_evento,entidad_tipo,entidad_id,reserva_id,descripcion,cambios,datos_contexto,origen)
   values(auth.uid(),'Total alojamiento actualizado','actualizacion','reservas',rid,rid,'Haku · Cambio exclusivamente financiero de alojamiento',
    jsonb_build_array(jsonb_build_object('campo','total_alojamiento','anterior',plan->'total_actual','nuevo',plan->'total_objetivo')),
    jsonb_build_object('version','total1_financiero_v3','filas_financieras',plan->'filas','reconciliacion_aplicaciones',plan->'reconciliacion','pagos_originales_sin_cambios',true),'haku');
  end if;
  resultados:=resultados||jsonb_build_array(jsonb_build_object('reserva_id',rid,'total_anterior',(item->>'total_actual')::bigint,'total_nuevo',(item->>'total_objetivo')::bigint,'sin_cambios',(item->>'total_actual')::bigint=(item->>'total_objetivo')::bigint));
 end loop;
 for item in select value from jsonb_array_elements(p_cambios) loop
  rid:=(item->>'reserva_id')::uuid; plan:=planes->rid::text;
  if (select coalesce(jsonb_object_agg(pa.id::text,to_jsonb(pa)),'{}') from public.pago_aplicaciones pa where cargo_id in(select id from public.cargos where reserva_id=rid) or pago_id in(select id from public.pagos where reserva_id=rid))
     is distinct from (plan->'reconciliacion'->case when (item->>'total_actual')::bigint=(item->>'total_objetivo')::bigint then 'antes' else 'despues' end)
  then raise exception 'Invariante de aplicaciones incumplida; lote revertido'; end if;
  if exists(select 1 from public.pagos p where p.reserva_id=rid and p.monto<(select coalesce(sum(monto_aplicado),0) from public.pago_aplicaciones where pago_id=p.id)) then raise exception 'Sobreaplicación por pago; lote revertido'; end if;
  if exists(select 1 from public.cargos c where c.reserva_id=rid and c.estado='activo' and c.tipo_cargo='alojamiento' and
    (select coalesce(sum(monto_aplicado),0) from public.pago_aplicaciones where cargo_id=c.id) > c.monto+coalesce((select sum(signo*monto) from public.cargo_ajustes where cargo_id=c.id and estado='activo'),0))
  then raise exception 'Sobreaplicación física por cargo; lote revertido'; end if;
  despues:=private.haiku_snapshot_total_financiero_v3(rid,plan);
  if despues#>'{reserva,titular_numero_documento}' is distinct from (antes->rid::text)#>'{reserva,titular_numero_documento}' then
   raise exception 'La edición afectaría datos ajenos al total; lote revertido' using detail='Invariante fallida: reservas.titular_numero_documento';
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(nullif(antes->rid::text->'huespedes','null'::jsonb),'[]')) b
     left join jsonb_array_elements(coalesce(nullif(despues->'huespedes','null'::jsonb),'[]')) a on a.value->>'id'=b.value->>'id'
     where a.value->'numero_documento' is distinct from b.value->'numero_documento') then
   raise exception 'La edición afectaría datos ajenos al total; lote revertido' using detail='Invariante fallida: huespedes.numero_documento';
  end if;
  if despues is distinct from antes->rid::text then
   select key into campo from jsonb_object_keys(despues||(antes->rid::text)) key where despues->key is distinct from antes->rid::text->key order by key limit 1;
   raise exception 'La edición afectaría datos ajenos al total; lote revertido' using detail='Invariante fallida: '||campo;
  end if;
  for fila in select value from jsonb_array_elements(plan->'filas') loop
   if not exists(select 1 from public.vista_estado_cargos c where c.cargo_id=(fila->>'cargo_id')::uuid and c.estado='activo' and c.monto=(fila->>'base_nueva')::bigint and c.monto_ajustado=(fila->>'base_nueva')::bigint-(fila->>'iva_nuevo')::bigint and c.aplicado_neto<=c.monto_ajustado)
    or (fila->>'noche_id' is not null and not exists(select 1 from public.estadia_noches where id=(fila->>'noche_id')::uuid and tarifa=(fila->>'base_nueva')::bigint))
    or (fila->>'ajuste_id' is not null and not exists(select 1 from public.cargo_ajustes where id=(fila->>'ajuste_id')::uuid and base_calculo=(fila->>'base_nueva')::bigint and monto=(fila->>'iva_nuevo')::bigint))
    then raise exception 'Invariante financiera por cargo incumplida; lote revertido'; end if;
  end loop;
  select total_alojamiento into actual from public.vista_saldos_alojamiento_reserva where reserva_id=rid;
  if actual is distinct from (item->>'total_objetivo')::bigint then raise exception 'Total final no exacto; lote revertido'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(auditoria) a left join public.eventos_auditoria e on e.id=(a.value->>'id')::uuid where to_jsonb(e) is distinct from a.value) then raise exception 'Auditoría original alterada; lote revertido'; end if;
 return jsonb_build_object('ok',true,'resultados',resultados);
end;
$$;
revoke all on function public.haiku_cambiar_totales_lote_v1(jsonb) from public,anon;
grant execute on function public.haiku_cambiar_totales_lote_v1(jsonb) to authenticated;
comment on function public.haiku_cambiar_totales_lote_v1(jsonb) is 'total1_financiero_v3';
create or replace function public.haiku_capacidad_totales_v1()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('version','total1_financiero_v3','writer_disponible',
 auth.uid() is not null and private.haiku_tiene_permiso('reservas.editar') is true and private.haiku_tiene_permiso('pagos.ver') is true
 and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.haiku_cambiar_totales_lote_v1(jsonb)') and obj_description(p.oid,'pg_proc')='total1_financiero_v3' and has_function_privilege('authenticated',p.oid,'EXECUTE'))
 and private.haiku_tiene_permiso('pagos.registrar') is true
 and to_regprocedure('private.haiku_plan_total_financiero_v3(uuid,bigint)') is not null and to_regprocedure('private.haiku_snapshot_total_financiero_v3(uuid,jsonb)') is not null
 and to_regprocedure('private.haiku_plan_aplicaciones_total_v3(uuid,jsonb)') is not null
 and to_regprocedure('private.haiku_ejecutar_aplicaciones_total_v3(jsonb,text)') is not null
 and to_regprocedure('private.haiku_plan_total_iva_v3(uuid,bigint)') is not null);
$$;
revoke all on function public.haiku_capacidad_totales_v1() from public,anon;
grant execute on function public.haiku_capacidad_totales_v1() to authenticated;
commit;
