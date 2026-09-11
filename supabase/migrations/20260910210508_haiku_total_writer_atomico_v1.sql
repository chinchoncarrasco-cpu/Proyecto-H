-- TOTAL 1: writer atómico. DDL únicamente; no ejecuta cambios en reservas.
begin;
create or replace function private.haiku_total_snapshot(p_id uuid)
returns jsonb language sql security invoker
set search_path = pg_catalog, public, private as $$
select jsonb_build_object(
 'reserva',(select to_jsonb(r)-'actualizado_en' from public.reservas r where id=p_id),
 'estadias',(select coalesce(jsonb_agg(to_jsonb(e)-'actualizado_en' order by e.id),'[]') from public.reserva_estadias e where reserva_id=p_id),
 'huespedes',(select coalesce(jsonb_agg(to_jsonb(h)-'actualizado_en' order by h.id),'[]') from public.huespedes h where h.id in
   (select rh.huesped_id from public.reserva_huespedes rh where rh.reserva_id=p_id union select r.titular_huesped_id from public.reservas r where r.id=p_id)),
 'vinculos',(select coalesce(jsonb_agg(to_jsonb(rh) order by rh.huesped_id),'[]') from public.reserva_huespedes rh where rh.reserva_id=p_id),
 'ocupantes',(select coalesce(jsonb_agg(to_jsonb(eh) order by eh.estadia_id,eh.huesped_id),'[]') from public.estadia_huespedes eh join public.reserva_estadias e on e.id=eh.estadia_id where e.reserva_id=p_id),
 'pagos',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.pagos p where p.reserva_id=p_id),
 'servicios',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.servicios s where s.reserva_id=p_id),
 'cargos_servicios',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.cargos c where c.reserva_id=p_id and c.tipo_cargo<>'alojamiento'),
 'aplicaciones_servicios',(select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id),'[]') from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where c.reserva_id=p_id and c.tipo_cargo<>'alojamiento')
);
$$;
revoke all on function private.haiku_total_snapshot(uuid) from public, anon, authenticated;

create or replace function private.haiku_total_iva_snapshot(p_id uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object(
  'ajustes',(select jsonb_agg(to_jsonb(a)-'base_calculo'-'monto' order by a.id) from public.cargo_ajustes a where a.reserva_id=p_id),
  'cargos',(select jsonb_agg(to_jsonb(c)-'monto'-'actualizado_en' order by c.id) from public.cargos c where c.reserva_id=p_id),
  'noches',(select jsonb_agg(to_jsonb(n)-'tarifa'-'origen_tarifa' order by n.id) from public.estadia_noches n where n.estadia_id in(select id from public.reserva_estadias where reserva_id=p_id)),
  'aplicaciones',(select jsonb_agg(to_jsonb(pa) order by pa.id) from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where c.reserva_id=p_id)
 );
$$;
revoke all on function private.haiku_total_iva_snapshot(uuid) from public,anon,authenticated;

-- Fórmula extraída literalmente de las dos autoridades existentes.
create or replace function private.haiku_iva_incluido(p_base bigint)
returns bigint language sql immutable strict security invoker
set search_path=pg_catalog as $$
 select p_base - round(p_base::numeric / 1.19)::bigint;
$$;
revoke all on function private.haiku_iva_incluido(bigint) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.haiku_aplicar_ajuste_reserva(p_reserva_id uuid, p_tipo_ajuste text, p_observaciones text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
    v_tipo text := lower(btrim(coalesce(p_tipo_ajuste, '')));
    v_operacion_id uuid := gen_random_uuid();
    v_total_original bigint := 0;
    v_total_actual bigint := 0;
    v_pagado bigint := 0;
    v_total_ajuste bigint := 0;
    v_nuevo_total bigint := 0;
    v_signo smallint;
    v_porcentaje numeric(5,2);
    v_concepto text;
    v_cantidad integer := 0;
    v_indice integer := 0;
    v_acumulado bigint := 0;
    v_monto_fila bigint := 0;
    v_cargo record;
begin
    if auth.uid() is null then
        raise exception 'Debe iniciar sesión para ajustar cargos';
    end if;

    if not private.haiku_tiene_permiso('pagos.registrar'::text) then
        raise exception 'No tiene permiso para ajustar cargos';
    end if;

    if v_tipo not in ('iva_exento','cargo_cancelacion','cargo_modificacion') then
        raise exception 'Tipo de ajuste inválido';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_reserva_id::text, 0));

    if exists (
        select 1
        from public.cargo_ajustes ca
        where ca.reserva_id = p_reserva_id
          and ca.tipo_ajuste = v_tipo
          and ca.estado = 'activo'
    ) then
        raise exception 'Esta reserva ya tiene ese ajuste activo';
    end if;

    select
        coalesce(sum(c.monto), 0)::bigint,
        count(*)::integer
    into v_total_original, v_cantidad
    from public.cargos c
    where c.reserva_id = p_reserva_id
      and c.estado = 'activo'
      and c.tipo_cargo = 'alojamiento';

    if v_total_original <= 0 or v_cantidad <= 0 then
        raise exception 'La reserva no tiene cargos de alojamiento activos';
    end if;

    select
        coalesce(v.total_alojamiento, 0),
        coalesce(v.pagado_alojamiento, 0)
    into v_total_actual, v_pagado
    from public.vista_saldos_alojamiento_reserva v
    where v.reserva_id = p_reserva_id;

    if v_tipo = 'iva_exento' then
        v_signo := -1;
        v_porcentaje := 19.00;
        v_concepto := 'Exención IVA extranjero';
        v_total_ajuste := private.haiku_iva_incluido(v_total_original);
        v_nuevo_total := v_total_actual - v_total_ajuste;

        if v_total_ajuste <= 0 then
            raise exception 'No fue posible calcular el IVA incluido';
        end if;

        if v_pagado > v_nuevo_total then
            raise exception 'No se puede aplicar la exención: los pagos de alojamiento registrados superarían el nuevo total';
        end if;
    else
        v_signo := 1;
        v_porcentaje := 10.00;
        v_total_ajuste := round(v_total_original::numeric * 0.10)::bigint;
        v_nuevo_total := v_total_actual + v_total_ajuste;

        if v_tipo = 'cargo_cancelacion' then
            v_concepto := 'Cargo 10% · Cancelación';
        else
            v_concepto := 'Cargo 10% · Modificación';
        end if;
    end if;

    for v_cargo in
        select c.id, c.monto
        from public.cargos c
        where c.reserva_id = p_reserva_id
          and c.estado = 'activo'
          and c.tipo_cargo = 'alojamiento'
        order by c.creado_en, c.id
        for update
    loop
        v_indice := v_indice + 1;

        if v_indice < v_cantidad then
            if v_tipo = 'iva_exento' then
                v_monto_fila := private.haiku_iva_incluido(v_cargo.monto);
            else
                v_monto_fila := round(v_cargo.monto::numeric * 0.10)::bigint;
            end if;
            v_acumulado := v_acumulado + v_monto_fila;
        else
            v_monto_fila := v_total_ajuste - v_acumulado;
        end if;

        if v_monto_fila <= 0 then
            raise exception 'Monto de ajuste inválido';
        end if;

        insert into public.cargo_ajustes (
            operacion_id,
            reserva_id,
            cargo_id,
            tipo_ajuste,
            signo,
            porcentaje,
            base_calculo,
            monto,
            concepto,
            observaciones,
            creado_por
        ) values (
            v_operacion_id,
            p_reserva_id,
            v_cargo.id,
            v_tipo,
            v_signo,
            v_porcentaje,
            v_cargo.monto,
            v_monto_fila,
            v_concepto,
            nullif(btrim(coalesce(p_observaciones, '')), ''),
            auth.uid()
        );
    end loop;

    return jsonb_build_object(
        'operacion_id', v_operacion_id,
        'tipo_ajuste', v_tipo,
        'monto_ajuste', v_total_ajuste,
        'signo', v_signo,
        'nuevo_total', v_nuevo_total,
        'resumen', public.haiku_resumen_ajustes(p_reserva_id)
    );
end;
$function$;
CREATE OR REPLACE FUNCTION public.haiku_aplicar_ajuste_unidad(p_reserva_id uuid, p_tipo_ajuste text, p_observaciones text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
    v_grupo_id uuid;
    v_tipo text := lower(btrim(coalesce(p_tipo_ajuste, '')));
    v_operacion_id uuid := gen_random_uuid();
    v_total_original bigint := 0;
    v_total_actual bigint := 0;
    v_pagado bigint := 0;
    v_total_ajuste bigint := 0;
    v_nuevo_total bigint := 0;
    v_signo smallint;
    v_porcentaje numeric(5,2);
    v_concepto text;
    v_cantidad integer := 0;
    v_indice integer := 0;
    v_acumulado bigint := 0;
    v_monto_fila bigint := 0;
    v_cargo record;
begin
    if auth.uid() is null then
        raise exception 'Debe iniciar sesión para ajustar cargos';
    end if;

    if not private.haiku_tiene_permiso('pagos.registrar'::text) then
        raise exception 'No tiene permiso para ajustar cargos';
    end if;

    if v_tipo not in ('iva_exento','cargo_cancelacion','cargo_modificacion') then
        raise exception 'Tipo de ajuste inválido';
    end if;

    select r.grupo_reserva_id
      into v_grupo_id
      from public.reservas r
     where r.id = p_reserva_id;

    if not found then
        raise exception 'Reserva no encontrada';
    end if;

    perform pg_advisory_xact_lock(
        hashtextextended(coalesce(v_grupo_id::text, p_reserva_id::text), 0)
    );

    if exists (
        select 1
          from public.cargo_ajustes ca
          join public.reservas r on r.id = ca.reserva_id
         where ca.tipo_ajuste = v_tipo
           and ca.estado = 'activo'
           and (
                (v_grupo_id is null and r.id = p_reserva_id)
                or
                (v_grupo_id is not null and r.grupo_reserva_id = v_grupo_id)
           )
    ) then
        raise exception 'Esta reserva o grupo ya tiene ese ajuste activo';
    end if;

    select
        coalesce(sum(c.monto), 0)::bigint,
        count(*)::integer
      into v_total_original, v_cantidad
      from public.cargos c
      join public.reservas r on r.id = c.reserva_id
     where c.estado = 'activo'
       and c.tipo_cargo = 'alojamiento'
       and (
            (v_grupo_id is null and r.id = p_reserva_id)
            or
            (v_grupo_id is not null and r.grupo_reserva_id = v_grupo_id)
       );

    if v_total_original <= 0 or v_cantidad <= 0 then
        raise exception 'La reserva no tiene cargos de alojamiento activos';
    end if;

    select
        coalesce(sum(ec.monto_ajustado), 0)::bigint,
        coalesce(sum(ec.aplicado_neto), 0)::bigint
      into v_total_actual, v_pagado
      from public.vista_estado_cargos ec
      join public.reservas r on r.id = ec.reserva_id
     where ec.estado = 'activo'
       and ec.tipo_cargo = 'alojamiento'
       and (
            (v_grupo_id is null and r.id = p_reserva_id)
            or
            (v_grupo_id is not null and r.grupo_reserva_id = v_grupo_id)
       );

    if v_tipo = 'iva_exento' then
        v_signo := -1;
        v_porcentaje := 19.00;
        v_concepto := 'Exención IVA extranjero';
        v_total_ajuste := private.haiku_iva_incluido(v_total_original);
        v_nuevo_total := v_total_actual - v_total_ajuste;

        if v_total_ajuste <= 0 then
            raise exception 'No fue posible calcular el IVA incluido';
        end if;

        if v_pagado > v_nuevo_total then
            raise exception 'No se puede aplicar la exención: los pagos registrados superarían el nuevo total del alojamiento';
        end if;
    else
        v_signo := 1;
        v_porcentaje := 10.00;
        v_total_ajuste := round(v_total_original::numeric * 0.10)::bigint;
        v_nuevo_total := v_total_actual + v_total_ajuste;

        if v_tipo = 'cargo_cancelacion' then
            v_concepto := 'Cargo 10% · Cancelación';
        else
            v_concepto := 'Cargo 10% · Modificación';
        end if;
    end if;

    for v_cargo in
        select c.id, c.reserva_id, c.monto
          from public.cargos c
          join public.reservas r on r.id = c.reserva_id
         where c.estado = 'activo'
           and c.tipo_cargo = 'alojamiento'
           and (
                (v_grupo_id is null and r.id = p_reserva_id)
                or
                (v_grupo_id is not null and r.grupo_reserva_id = v_grupo_id)
           )
         order by c.reserva_id, c.creado_en, c.id
         for update of c
    loop
        v_indice := v_indice + 1;

        if v_indice = v_cantidad then
            v_monto_fila := v_total_ajuste - v_acumulado;
        else
            v_monto_fila := floor(
                (v_total_ajuste::numeric * v_cargo.monto::numeric)
                / v_total_original::numeric
            )::bigint;
            v_acumulado := v_acumulado + v_monto_fila;
        end if;

        if v_monto_fila <= 0 then
            continue;
        end if;

        insert into public.cargo_ajustes (
            operacion_id,
            reserva_id,
            cargo_id,
            tipo_ajuste,
            signo,
            porcentaje,
            base_calculo,
            monto,
            concepto,
            observaciones,
            creado_por
        ) values (
            v_operacion_id,
            v_cargo.reserva_id,
            v_cargo.id,
            v_tipo,
            v_signo,
            v_porcentaje,
            v_cargo.monto,
            v_monto_fila,
            v_concepto,
            nullif(btrim(coalesce(p_observaciones, '')), ''),
            auth.uid()
        );
    end loop;

    return jsonb_build_object(
        'operacion_id', v_operacion_id,
        'grupo_reserva_id', v_grupo_id,
        'es_grupo', v_grupo_id is not null,
        'tipo_ajuste', v_tipo,
        'monto_ajuste', v_total_ajuste,
        'signo', v_signo,
        'nuevo_total', v_nuevo_total,
        'resumen', public.haiku_resumen_ajustes_unidad(p_reserva_id)
    );
end;
$function$;

-- Plan de sólo lectura, sin fórmula IVA alternativa al helper autoritativo.
create or replace function private.haiku_plan_total_iva(p_id uuid,p_objetivo bigint)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public,private as $$
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
  if monto_base<=0 or monto_iva<=0 or monto_base-monto_iva<coalesce(v_fila.aplicado_neto,0) then raise exception 'El nuevo importe de una noche no admite sus pagos aplicados; requiere revisión'; end if;
  filas:=filas||jsonb_build_array(jsonb_build_object('noche_id',v_fila.noche_id,'cargo_id',v_fila.cargo_id,'ajuste_id',v_fila.ajuste_id,'fecha',v_fila.fecha,'base_actual',v_fila.monto,'iva_actual',v_fila.ajuste_actual,'base_nueva',monto_base,'iva_nuevo',monto_iva));
 end loop;
 select jsonb_agg(to_jsonb(a) order by a.id) into ajustes_snapshot from public.cargo_ajustes a where reserva_id=p_id and estado='activo';
 firma:=md5(jsonb_build_object('ajustes',ajustes_snapshot,'filas',filas,'total_actual',final_actual)::text);
 return jsonb_build_object('reserva_id',p_id,'total_actual',final_actual,'total_objetivo',p_objetivo,'base_actual',base,'iva_actual',base-final_actual,'base_nueva',nueva_base,'iva_nuevo',ajuste,'total_final_esperado',nueva_base-ajuste,'filas',filas,'firma',firma);
end;
$$;
revoke all on function private.haiku_plan_total_iva(uuid,bigint) from public,anon,authenticated;
create or replace function public.haiku_previsualizar_total_iva_v1(p_reserva_id uuid,p_total_objetivo bigint)
returns jsonb language sql stable security definer set search_path=pg_catalog,public,private as $$
 select private.haiku_plan_total_iva(p_reserva_id,p_total_objetivo)||jsonb_build_object('solo_lectura',false);
$$;
revoke all on function public.haiku_previsualizar_total_iva_v1(uuid,bigint) from public,anon;
grant execute on function public.haiku_previsualizar_total_iva_v1(uuid,bigint) to authenticated;

-- Sólo invocado con un plan recién calculado, bajo locks del lote.
create or replace function private.haiku_guardar_plan_iva(p_plan jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare f jsonb; a public.cargo_ajustes%rowtype;
begin
 for f in select value from jsonb_array_elements(p_plan->'filas') loop
  select * into strict a from public.cargo_ajustes where id=(f->>'ajuste_id')::uuid for update;
  update public.estadia_noches set tarifa=(f->>'base_nueva')::bigint,origen_tarifa='manual' where id=(f->>'noche_id')::uuid;
  if not found then raise exception 'La noche ya no existe'; end if;
  -- El trigger financiero oficial actualiza el MISMO cargo activo.
  if not exists(select 1 from public.cargos where id=(f->>'cargo_id')::uuid and estado='activo' and monto=(f->>'base_nueva')::bigint) then raise exception 'No se conservó el cargo original'; end if;
  update public.cargo_ajustes set base_calculo=(f->>'base_nueva')::bigint,monto=(f->>'iva_nuevo')::bigint where id=a.id;
  insert into public.eventos_auditoria(usuario_id,accion,tipo_evento,entidad_tipo,entidad_id,reserva_id,descripcion,cambios,datos_contexto,origen)
  values(auth.uid(),'Registro actualizado','actualizacion','cargo_ajustes',a.id,a.reserva_id,'Haku · Revisión de base e IVA al fijar total final',
   jsonb_build_array(jsonb_build_object('campo','base_calculo','anterior',a.base_calculo,'nuevo',(f->>'base_nueva')::bigint),jsonb_build_object('campo','monto','anterior',a.monto,'nuevo',(f->>'iva_nuevo')::bigint)),
   jsonb_build_object('operacion_ajuste_id',a.operacion_id,'total_final_objetivo',p_plan->'total_objetivo'),'haku');
 end loop;
end;
$$;
revoke all on function private.haiku_guardar_plan_iva(jsonb) from public,anon,authenticated;

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
  if private.haiku_total_snapshot(rid) is distinct from antes->rid::text then raise exception 'La edición afectaría datos ajenos al total. Lote revertido; requiere revisión'; end if;
  select total_alojamiento into total from public.vista_saldos_alojamiento_reserva where reserva_id=rid;
  if total is distinct from (item->>'total_objetivo')::bigint then raise exception 'El motor no produjo el total solicitado. Lote revertido'; end if;
 end loop;
 return jsonb_build_object('ok',true,'resultados',resultados);
end;
$$;
revoke all on function public.haiku_cambiar_totales_lote_v1(jsonb) from public, anon;
grant execute on function public.haiku_cambiar_totales_lote_v1(jsonb) to authenticated;

-- Se incorpora al final de la migración del writer, en la misma transacción.
comment on function public.haiku_cambiar_totales_lote_v1(jsonb) is 'total1_atomico_v1';
create or replace function public.haiku_capacidad_totales_v1()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('version','total1_atomico_v1','writer_disponible',
   auth.uid() is not null
   and private.haiku_tiene_permiso('reservas.editar') is true
   and private.haiku_tiene_permiso('pagos.ver') is true
   and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.haiku_cambiar_totales_lote_v1(jsonb)')
      and obj_description(p.oid,'pg_proc')='total1_atomico_v1'
      and has_function_privilege('authenticated',p.oid,'EXECUTE'))
   and to_regprocedure('private.haiku_guardar_plan_iva(jsonb)') is not null
   and to_regprocedure('private.haiku_plan_total_iva(uuid,bigint)') is not null);
$$;
revoke all on function public.haiku_capacidad_totales_v1() from public,anon;
grant execute on function public.haiku_capacidad_totales_v1() to authenticated;
comment on function public.haiku_capacidad_totales_v1() is 'Consulta de capacidad: comprueba versión instalada, RPC, soporte IVA y permisos. No escribe.';

comment on function public.haiku_previsualizar_total_iva_v1(uuid,bigint) is 'Preview de sólo lectura del plan IVA del writer TOTAL 1. Disponibilidad de confirmar consultada por haiku_capacidad_totales_v1.';
commit;
