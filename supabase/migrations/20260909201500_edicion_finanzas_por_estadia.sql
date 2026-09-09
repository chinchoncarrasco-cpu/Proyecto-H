-- HAIKU · EDICIÓN SEGURA DE TARIFAS POR ESTADÍA
-- Corrige la reconstrucción financiera de una estadía sin tocar otras estadías
-- pertenecientes a la misma reserva (por ejemplo: alojamiento + Full Day).
--
-- Estrategia deliberadamente mínima:
-- - conserva intacta la implementación vigente de haiku_modificar_reserva_completa_core;
-- - modifica sólo los predicados financieros que antes estaban a nivel reserva_id;
-- - limita snapshot, validación, anulación y reaplicación al v_estadia.id seleccionado;
-- - deja intactos Haku, pagos del Libro, servicios, Early Check-In y el wrapper operativo.

do $migration$
declare
    v_def text;
    v_prev text;
begin
    select pg_get_functiondef(
        'public.haiku_modificar_reserva_completa_core(uuid,text,smallint,date,date,text,smallint,smallint,smallint,text,text,text,text,jsonb,bigint,jsonb)'::regprocedure
    ) into v_def;

    -- 1) Total actual: sólo la estadía que se está editando.
    v_prev := v_def;
    v_def := replace(
        v_def,
$old$
    where c.reserva_id = p_reserva_id
      and c.tipo_cargo = 'alojamiento'
      and c.estado = 'activo';
$old$,
$new$
    where c.estadia_id = v_estadia.id
      and c.tipo_cargo = 'alojamiento'
      and c.estado = 'activo';
$new$
    );
    if v_def = v_prev then
        raise exception 'Migración detenida: no se encontró el bloque de total actual esperado';
    end if;

    -- 2) Snapshot de aplicaciones: sólo pagos/devoluciones aplicados a esta estadía.
    v_prev := v_def;
    v_def := replace(
        v_def,
$old$
        where c.reserva_id=p_reserva_id
          and c.tipo_cargo='alojamiento'
          and c.estado='activo'
        group by p.id,p.tipo_movimiento,p.pago_origen_id,p.fecha_pago;
$old$,
$new$
        where c.estadia_id=v_estadia.id
          and c.tipo_cargo='alojamiento'
          and c.estado='activo'
        group by p.id,p.tipo_movimiento,p.pago_origen_id,p.fecha_pago;
$new$
    );
    if v_def = v_prev then
        raise exception 'Migración detenida: no se encontró el snapshot financiero esperado';
    end if;

    -- 3) Desaplicar sólo cargos de alojamiento pertenecientes a esta estadía.
    v_prev := v_def;
    v_def := replace(
        v_def,
$old$
        where pa.cargo_id=c.id
          and c.reserva_id=p_reserva_id
          and c.tipo_cargo='alojamiento'
          and c.estado='activo';
$old$,
$new$
        where pa.cargo_id=c.id
          and c.estadia_id=v_estadia.id
          and c.tipo_cargo='alojamiento'
          and c.estado='activo';
$new$
    );
    if v_def = v_prev then
        raise exception 'Migración detenida: no se encontró el bloque de desaplicación esperado';
    end if;

    -- 4) Anular únicamente los cargos de alojamiento de esta estadía.
    v_prev := v_def;
    v_def := replace(
        v_def,
$old$
        update public.cargos
        set estado='anulado', actualizado_en=now()
        where reserva_id=p_reserva_id
          and tipo_cargo='alojamiento'
          and estado='activo';
$old$,
$new$
        update public.cargos
        set estado='anulado', actualizado_en=now()
        where estadia_id=v_estadia.id
          and tipo_cargo='alojamiento'
          and estado='activo';
$new$
    );
    if v_def = v_prev then
        raise exception 'Migración detenida: no se encontró el bloque de anulación esperado';
    end if;

    -- 5) Reaplicar los pagos snapshot sólo a los nuevos cargos de esta estadía.
    v_prev := v_def;
    v_def := replace(
        v_def,
$old$
                where ec.reserva_id=p_reserva_id
                  and ec.tipo_cargo='alojamiento'
                  and ec.estado='activo'
                  and ec.saldo_cargo>0
$old$,
$new$
                where c.estadia_id=v_estadia.id
                  and ec.tipo_cargo='alojamiento'
                  and ec.estado='activo'
                  and ec.saldo_cargo>0
$new$
    );
    if v_def = v_prev then
        raise exception 'Migración detenida: no se encontró el bloque de reaplicación esperado';
    end if;

    -- 6) Si existe una devolución en el snapshot, limitar su origen a esta estadía.
    -- Evita cruzar aplicaciones de un mismo comprobante entre estadías hermanas.
    v_prev := v_def;
    v_def := replace(
        v_def,
$old$
                from public.pago_aplicaciones opa
                where opa.pago_id=v_app.pago_origen_id
                order by opa.creado_en,opa.id
$old$,
$new$
                from public.pago_aplicaciones opa
                join public.cargos oc on oc.id=opa.cargo_id
                where opa.pago_id=v_app.pago_origen_id
                  and oc.estadia_id=v_estadia.id
                order by opa.creado_en,opa.id
$new$
    );
    if v_def = v_prev then
        raise exception 'Migración detenida: no se encontró el bloque de devolución esperado';
    end if;

    execute v_def;
end;
$migration$;

comment on function public.haiku_modificar_reserva_completa_core(uuid,text,smallint,date,date,text,smallint,smallint,smallint,text,text,text,text,jsonb,bigint,jsonb)
is 'Edición completa de reserva. Desde 2026-09-09, la reconstrucción financiera queda acotada a la estadía editada para no mezclar cargos/pagos de otras estadías de la misma reserva.';
