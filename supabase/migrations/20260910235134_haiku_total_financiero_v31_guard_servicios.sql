-- Candidata V3.1: NO desplegada. Nueva migración con historial al autorizar.
-- Único cambio funcional: permitir servicios de total cero sin cargos asociados.
-- NULL/importe no cero y cualquier cargo vinculado mantienen el bloqueo.
begin;
create or replace function private.haiku_plan_aplicaciones_total_v3(p_id uuid,p_plan jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare apps jsonb; original jsonb; f record; a record; pago_fila record; destino record;
 exceso bigint; usado bigint; cantidad bigint; capacidad bigint; confirmado bigint; inicial bigint;
 clave text; existente text; fila jsonb;
begin
 if private.haiku_tiene_permiso('pagos.registrar') is not true then raise exception 'Sin permiso para reconciliar aplicaciones'; end if;
 -- Sin inferir destino a partir de nombres, glosas ni montos. Ante mezcla, bloquear.
 if exists(select 1 from public.cargos where reserva_id=p_id and (tipo_cargo is distinct from 'alojamiento' or estado is distinct from 'activo'))
 or exists(
  select 1 from public.servicios s
  where s.reserva_id=p_id and (
   s.total is distinct from 0
   or exists(select 1 from public.cargos c where c.servicio_id=s.id)
  )
 )
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
    jsonb_build_object('version','total1_financiero_v31','filas_financieras',plan->'filas','reconciliacion_aplicaciones',plan->'reconciliacion','pagos_originales_sin_cambios',true),'haku');
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
comment on function public.haiku_cambiar_totales_lote_v1(jsonb) is 'total1_financiero_v31';
create or replace function public.haiku_capacidad_totales_v1()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('version','total1_financiero_v31','writer_disponible',
 auth.uid() is not null and private.haiku_tiene_permiso('reservas.editar') is true and private.haiku_tiene_permiso('pagos.ver') is true
 and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.haiku_cambiar_totales_lote_v1(jsonb)') and obj_description(p.oid,'pg_proc')='total1_financiero_v31' and has_function_privilege('authenticated',p.oid,'EXECUTE'))
 and private.haiku_tiene_permiso('pagos.registrar') is true
 and to_regprocedure('private.haiku_plan_total_financiero_v3(uuid,bigint)') is not null and to_regprocedure('private.haiku_snapshot_total_financiero_v3(uuid,jsonb)') is not null
 and to_regprocedure('private.haiku_plan_aplicaciones_total_v3(uuid,jsonb)') is not null
 and to_regprocedure('private.haiku_ejecutar_aplicaciones_total_v3(jsonb,text)') is not null
 and to_regprocedure('private.haiku_plan_total_iva_v3(uuid,bigint)') is not null);
$$;
revoke all on function public.haiku_capacidad_totales_v1() from public,anon;
grant execute on function public.haiku_capacidad_totales_v1() to authenticated;
commit;
