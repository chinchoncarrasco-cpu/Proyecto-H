-- LOCAL: diagnóstico únicamente. No desplegar ni relajar la comparación.
-- Devuelve rutas, nunca valores personales/financieros del snapshot.
create or replace function private.haiku_total_diff_paths(a jsonb,b jsonb,ruta text default '')
returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare k text; i integer; n integer; resultado jsonb:='[]';
begin
 if a is not distinct from b then return resultado; end if;
 if jsonb_typeof(a)='object' and jsonb_typeof(b)='object' then
  for k in select key from jsonb_object_keys(a||b) key order by key loop
   resultado:=resultado||private.haiku_total_diff_paths(a->k,b->k,case when ruta='' then k else ruta||'.'||k end);
  end loop;
 elsif jsonb_typeof(a)='array' and jsonb_typeof(b)='array' then
  n:=greatest(jsonb_array_length(a),jsonb_array_length(b));
  if n>0 then for i in 0..n-1 loop
   resultado:=resultado||private.haiku_total_diff_paths(a->i,b->i,ruta||'['||i||']');
  end loop; end if;
 else resultado:=jsonb_build_array(ruta);
 end if;
 return resultado;
end;
$$;
revoke all on function private.haiku_total_diff_paths(jsonb,jsonb,text) from public,anon,authenticated;

create or replace function public.haiku_cambiar_totales_lote_v1(p_cambios jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare
 item jsonb; rid uuid; r public.reservas%rowtype; e public.reserva_estadias%rowtype;
 total bigint; objetivo bigint; esperado bigint; cantidad integer; noches integer;
 cab smallint; tarifas jsonb; acompanantes jsonb; antes jsonb := '{}';
 resultados jsonb := '[]'; n record; respuesta jsonb; planes jsonb := '{}'; plan_iva jsonb; antes_iva jsonb := '{}';
begin
 if auth.uid() is null or private.haiku_tiene_permiso('reservas.editar') is not true or private.haiku_tiene_permiso('pagos.ver') is not true then
  raise exception 'Se requieren sesión, reservas.editar y pagos.ver' using errcode='42501';
 end if;
 if jsonb_typeof(p_cambios) is distinct from 'array' then raise exception 'Se requiere un lote'; end if;
 if jsonb_array_length(p_cambios) not between 1 and 20 then raise exception 'El lote admite entre 1 y 20 reservas'; end if;
 for item in select value from jsonb_array_elements(p_cambios) loop
  if coalesce(item->>'reserva_id','')='' or coalesce(item->>'total_actual','')!~'^[0-9]+$' or coalesce(item->>'total_objetivo','')!~'^[0-9]+$' then raise exception 'Entrada inválida en el lote'; end if;
  rid:=(item->>'reserva_id')::uuid; objetivo:=(item->>'total_objetivo')::bigint;
  if objetivo<=0 or objetivo>9007199254740991 or (item->>'total_actual')::bigint>9007199254740991 then raise exception 'Total fuera de rango'; end if;
 end loop;
 if (select count(distinct (value->>'reserva_id')::uuid) from jsonb_array_elements(p_cambios))<>jsonb_array_length(p_cambios) then raise exception 'Reserva repetida en el lote'; end if;

 -- Mismo advisory lock que el editor oficial, orden estable entre lotes.
 for rid in select (value->>'reserva_id')::uuid from jsonb_array_elements(p_cambios) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended(rid::text,0));
  perform 1 from public.reservas where id=rid for update;
  if not found then raise exception 'La reserva % ya no existe',rid; end if;
  perform 1 from public.reserva_estadias where reserva_id=rid order by id for update;
  perform 1 from public.cargos where reserva_id=rid order by id for update;
  perform 1 from public.pagos where reserva_id=rid order by id for update;
  perform 1 from public.pago_aplicaciones where cargo_id in(select id from public.cargos where reserva_id=rid) order by id for update;
  perform 1 from public.cargo_ajustes where reserva_id=rid order by id for update;
  perform 1 from public.estadia_noches where estadia_id in(select id from public.reserva_estadias where reserva_id=rid) order by id for update;
 end loop;

 -- Validar TODO antes del primer cambio. El motor vuelve a validar al ejecutarse.
 for item in select value from jsonb_array_elements(p_cambios) order by (value->>'reserva_id')::uuid loop
  rid:=(item->>'reserva_id')::uuid; objetivo:=(item->>'total_objetivo')::bigint; esperado:=(item->>'total_actual')::bigint;
  select * into strict r from public.reservas where id=rid;
  if r.estado_reserva in ('cancelada','no_show') or r.grupo_reserva_id is not null then raise exception 'Reserva % cancelada, no-show o vinculada: requiere revisión',rid; end if;
  select count(*) into cantidad from public.reserva_estadias where reserva_id=rid;
  if cantidad<>1 then raise exception 'Reserva % con varias estadías: requiere revisión',rid; end if;
  select * into strict e from public.reserva_estadias where reserva_id=rid;
  if e.estado_estadia in ('cancelada','no_show') then raise exception 'Estadía no editable'; end if;
  select total_alojamiento into total from public.vista_saldos_alojamiento_reserva where reserva_id=rid;
  if total is null or total<>esperado then raise exception 'El total de % cambió desde la vista previa',rid; end if;
  if exists(select 1 from public.cargo_ajustes where reserva_id=rid and estado='activo') then
   plan_iva:=private.haiku_plan_total_iva(rid,objetivo);
   if coalesce(item->>'firma_iva','') is distinct from plan_iva->>'firma' then raise exception 'El plan IVA cambió desde la vista previa'; end if;
   planes:=planes||jsonb_build_object(rid::text,plan_iva);
   antes_iva:=antes_iva||jsonb_build_object(rid::text,private.haiku_total_iva_snapshot(rid));
  else
  if e.tipo_estadia='alojamiento' then
   noches:=e.fecha_salida-e.fecha_ingreso;
   if noches is null or noches<=0 or objetivo % noches<>0 then raise exception 'El total debe dividirse exactamente entre las noches'; end if;
   select count(*) into cantidad from public.estadia_noches where estadia_id=e.id;
   if cantidad<>noches or exists(select 1 from public.estadia_noches where estadia_id=e.id and (fecha<e.fecha_ingreso or fecha>=e.fecha_salida or tarifa<=0))
      or (select count(distinct tarifa) from public.estadia_noches where estadia_id=e.id)<>1
      or (select sum(tarifa) from public.estadia_noches where estadia_id=e.id) is distinct from total then
    raise exception 'Tarifas variables o noches incompletas: requiere revisión';
   end if;
  elsif e.tipo_estadia='fullday' then
   if e.fecha_ingreso is null or e.fecha_salida is distinct from e.fecha_ingreso then raise exception 'Full Day inconsistente'; end if;
  else raise exception 'Tipo de estadía no admitido'; end if;
  end if;
  if objetivo < (select coalesce(sum(pa.monto_aplicado),0) from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id join public.pagos p on p.id=pa.pago_id where c.reserva_id=rid and c.tipo_cargo='alojamiento' and c.estado='activo' and p.estado='confirmado' and p.tipo_movimiento='pago') then
   raise exception 'Nuevo total inferior al dinero ya aplicado';
  end if;
  antes:=antes||jsonb_build_object(rid::text,private.haiku_total_snapshot(rid));
 end loop;

 for item in select value from jsonb_array_elements(p_cambios) order by (value->>'reserva_id')::uuid loop
  rid:=(item->>'reserva_id')::uuid; objetivo:=(item->>'total_objetivo')::bigint; esperado:=(item->>'total_actual')::bigint;
  if objetivo<>esperado then
   if planes ? rid::text then
    perform private.haiku_guardar_plan_iva(planes->rid::text);
   else
   select * into strict r from public.reservas where id=rid;
   select * into strict e from public.reserva_estadias where reserva_id=rid;
   select numero into strict cab from public.cabanas where id=e.cabana_id;
   tarifas:='{}';
   if e.tipo_estadia='alojamiento' then
    for n in select fecha from public.estadia_noches where estadia_id=e.id order by fecha loop
     tarifas:=tarifas||jsonb_build_object(n.fecha::text,objetivo/(e.fecha_salida-e.fecha_ingreso));
    end loop;
   end if;
   select coalesce(jsonb_agg(h.nombre order by h.creado_en,h.id),'[]') into acompanantes from public.reserva_huespedes rh join public.huespedes h on h.id=rh.huesped_id where rh.reserva_id=rid and rh.huesped_id is distinct from r.titular_huesped_id;
   respuesta:=public.haiku_modificar_reserva_completa(
    p_reserva_id=>rid,p_titular_nombre=>r.titular_nombre,p_cabana_numero=>cab,
    p_fecha_ingreso=>e.fecha_ingreso,p_fecha_salida=>e.fecha_salida,p_tipo_estadia=>e.tipo_estadia,
    p_adultos=>e.adultos,p_ninos=>e.ninos,p_mascotas=>e.mascotas,
    p_correo_contacto=>r.correo_contacto,p_telefono_contacto=>r.telefono_contacto,
    p_rut=>r.titular_numero_documento,p_observaciones=>r.observaciones,
    p_tarifas=>tarifas,p_tarifa_fullday=>case when e.tipo_estadia='fullday' then objetivo else null end,
    p_acompanantes=>acompanantes);
   end if;
  end if;
  resultados:=resultados||jsonb_build_array(jsonb_build_object('reserva_id',rid,'total_anterior',esperado,'total_nuevo',objetivo,'sin_cambios',objetivo=esperado));
 end loop;
 -- Fallar, no restaurar: también revierte cambios previos del lote y auditoría.
 for item in select value from jsonb_array_elements(p_cambios) loop
  rid:=(item->>'reserva_id')::uuid;
  if antes_iva ? rid::text and private.haiku_total_iva_snapshot(rid) is distinct from antes_iva->rid::text then raise exception 'Cambió identidad de cargos, ajustes o aplicaciones IVA. Lote revertido'; end if;
  if private.haiku_total_snapshot(rid) is distinct from antes->rid::text then raise exception 'La edición afectaría datos ajenos al total. Lote revertido; requiere revisión' using detail=jsonb_build_object('invariantes',private.haiku_total_diff_paths(antes->rid::text,private.haiku_total_snapshot(rid)))::text; end if;
  select total_alojamiento into total from public.vista_saldos_alojamiento_reserva where reserva_id=rid;
  if total is distinct from (item->>'total_objetivo')::bigint then raise exception 'El motor no produjo el total solicitado. Lote revertido'; end if;
 end loop;
 return jsonb_build_object('ok',true,'resultados',resultados);
end;
$$;
