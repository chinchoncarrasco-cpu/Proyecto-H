-- Migración exclusiva de preview IVA. No instala ningún writer.
create or replace function public.haiku_previsualizar_total_iva_v1(p_reserva_id uuid,p_total_objetivo bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare
 r public.reservas%rowtype; e public.reserva_estadias%rowtype;
 v_fila record; base bigint; final_actual bigint; nueva_base bigint; ajuste bigint;
 cantidad integer; orden integer:=0; acumulado bigint:=0; monto_base bigint; monto_iva bigint;
 filas jsonb:='[]'; firma text; ajustes_snapshot jsonb;
begin
 if auth.uid() is null or private.haiku_tiene_permiso('reservas.editar') is not true or private.haiku_tiene_permiso('pagos.ver') is not true or private.haiku_tiene_permiso('pagos.registrar') is not true then raise exception 'Se requieren reservas.editar, pagos.ver y pagos.registrar para conservar IVA'; end if;
 if p_total_objetivo is null or p_total_objetivo<=0 or p_total_objetivo>7000000000000000 then raise exception 'Total objetivo fuera de rango'; end if;
 select * into strict r from public.reservas where id=p_reserva_id;
 if r.grupo_reserva_id is not null or r.estado_reserva in ('cancelada','no_show') then raise exception 'Reserva no compatible con tratamiento IVA automático'; end if;
 if (select count(*) from public.reserva_estadias where reserva_id=p_reserva_id)<>1 then raise exception 'Varias estadías: requiere revisión'; end if;
 select * into strict e from public.reserva_estadias where reserva_id=p_reserva_id;
 if e.estado_estadia in ('cancelada','no_show') or e.tipo_estadia<>'alojamiento' or e.fecha_salida<=e.fecha_ingreso then raise exception 'Se requiere alojamiento con noches'; end if;
 cantidad:=e.fecha_salida-e.fecha_ingreso;
 if (select count(*) from public.estadia_noches where estadia_id=e.id)<>cantidad or
    (select count(distinct tarifa) from public.estadia_noches where estadia_id=e.id)<>1 or
    exists(select 1 from public.estadia_noches where estadia_id=e.id and (fecha<e.fecha_ingreso or fecha>=e.fecha_salida or tarifa<=0)) then raise exception 'Se requieren tarifas uniformes y noches completas'; end if;
 if (select count(distinct operacion_id) from public.cargo_ajustes where reserva_id=p_reserva_id and estado='activo')<>1 or
    exists(select 1 from public.cargo_ajustes where reserva_id=p_reserva_id and estado='activo' and (tipo_ajuste is distinct from 'iva_exento' or signo is distinct from -1 or porcentaje is distinct from 19 or operacion_id is null)) then raise exception 'Sólo se admite una operación iva_exento activa; otros ajustes requieren revisión'; end if;
 if (select count(*) from public.cargos where reserva_id=p_reserva_id and tipo_cargo='alojamiento' and estado='activo')<>cantidad or
    (select count(*) from public.cargo_ajustes where reserva_id=p_reserva_id and estado='activo')<>cantidad then raise exception 'Cargos o ajustes incompletos'; end if;
 if exists(select 1 from public.estadia_noches n where n.estadia_id=e.id and
   (select count(*) from public.cargos c join public.cargo_ajustes a on a.cargo_id=c.id where c.estadia_noche_id=n.id and c.reserva_id=p_reserva_id and c.estadia_id=e.id and c.tipo_cargo='alojamiento' and c.estado='activo' and a.reserva_id=p_reserva_id and a.estado='activo' and a.base_calculo=c.monto and c.monto=n.tarifa and a.monto>0)<>1) then raise exception 'La exención no corresponde inequívocamente a las noches y cargos activos'; end if;
 select sum(monto) into base from public.cargos where reserva_id=p_reserva_id and tipo_cargo='alojamiento' and estado='activo';
 select total_alojamiento into final_actual from public.vista_saldos_alojamiento_reserva where reserva_id=p_reserva_id;
 if (select sum(monto) from public.cargo_ajustes where reserva_id=p_reserva_id and estado='activo') is distinct from (base - round(base::numeric / 1.19)::bigint) or
    final_actual is distinct from base-(base - round(base::numeric / 1.19)::bigint) then raise exception 'La exención existente no cumple la regla autoritativa'; end if;
 nueva_base:=case when p_total_objetivo=final_actual then base else round(p_total_objetivo::numeric*1.19)::bigint end;
 ajuste:=(nueva_base - round(nueva_base::numeric / 1.19)::bigint);
 if nueva_base-ajuste<>p_total_objetivo then raise exception 'No se obtiene el total final exacto'; end if;
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
  monto_iva:=case when p_total_objetivo=final_actual then v_fila.ajuste_actual when orden<cantidad then (monto_base - round(monto_base::numeric / 1.19)::bigint) else ajuste-acumulado end;
  acumulado:=acumulado+monto_iva;
  if monto_base<=0 or monto_iva<=0 or monto_base-monto_iva<coalesce(v_fila.aplicado_neto,0) then raise exception 'El nuevo importe de una noche no admite sus pagos aplicados; requiere revisión'; end if;
  filas:=filas||jsonb_build_array(jsonb_build_object('noche_id',v_fila.noche_id,'cargo_id',v_fila.cargo_id,'ajuste_id',v_fila.ajuste_id,'fecha',v_fila.fecha,'base_actual',v_fila.monto,'iva_actual',v_fila.ajuste_actual,'base_nueva',monto_base,'iva_nuevo',monto_iva));
 end loop;
 select jsonb_agg(to_jsonb(a) order by a.id) into ajustes_snapshot from public.cargo_ajustes a where reserva_id=p_reserva_id and estado='activo';
 firma:=md5(jsonb_build_object('ajustes',ajustes_snapshot,'filas',filas,'total_actual',final_actual)::text);
 return jsonb_build_object('solo_lectura',true,'reserva_id',p_reserva_id,'total_actual',final_actual,'total_objetivo',p_total_objetivo,'base_actual',base,'iva_actual',base-final_actual,'base_nueva',nueva_base,'iva_nuevo',ajuste,'total_final_esperado',nueva_base-ajuste,'filas',filas,'firma',firma);
end;
$$;

revoke all on function public.haiku_previsualizar_total_iva_v1(uuid,bigint) from public,anon;
grant execute on function public.haiku_previsualizar_total_iva_v1(uuid,bigint) to authenticated;
comment on function public.haiku_previsualizar_total_iva_v1(uuid,bigint) is 'TOTAL 1: previsualización sólo lectura. No autoriza guardar. Fórmula IVA idéntica a haiku_aplicar_ajuste_reserva.';
