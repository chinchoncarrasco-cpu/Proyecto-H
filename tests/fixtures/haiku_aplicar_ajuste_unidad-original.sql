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
        v_total_ajuste := v_total_original - round(v_total_original::numeric / 1.19)::bigint;
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
