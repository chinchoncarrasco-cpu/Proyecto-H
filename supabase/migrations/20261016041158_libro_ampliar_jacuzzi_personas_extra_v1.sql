-- Haku · Libro: añadir personas a una Jacuzzi ya cobrada sin reemplazar pagos históricos.
-- Sólo modifica el servicio después de la aprobación humana. Su trigger habitual
-- actualiza el mismo cargo de servicio y conserva todos los pagos aplicados.
CREATE OR REPLACE FUNCTION public.haiku_libro_ampliar_jacuzzi_v1(
    p_reserva_id uuid,
    p_estadia_id uuid,
    p_servicio_id uuid,
    p_adicionales smallint,
    p_estado_esperado jsonb,
    p_origen jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, private
AS $fn$
DECLARE
    v_servicio public.servicios%rowtype;
    v_despues public.servicios%rowtype;
    v_catalogo public.catalogo_servicios%rowtype;
    v_cargo public.cargos%rowtype;
    v_saldo bigint;
    v_aplicado bigint;
    v_personas_finales smallint;
    v_total_final bigint;
    v_adicional bigint;
    v_nombre text;
    v_folio text;
    v_bovtar text;
    v_concepto text;
    v_grupo text[];
    v_origen_hash text;
    v_marca text;
    v_servicios_activos integer;
    v_fecha_ingreso date;
    v_fecha_salida date;
BEGIN
    IF auth.uid() IS NULL OR NOT private.haiku_tiene_permiso('servicios.editar')
        OR NOT private.haiku_tiene_permiso('pagos.registrar') THEN
        RAISE EXCEPTION 'La ampliación necesita sesión y permisos de servicios y pagos' USING errcode='42501';
    END IF;
    IF p_reserva_id IS NULL OR p_estadia_id IS NULL OR p_servicio_id IS NULL
       OR p_adicionales IS NULL OR p_adicionales NOT IN (1,2)
       OR jsonb_typeof(p_estado_esperado) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_origen) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Ampliación incompleta: reserva, servicio o personas adicionales inválidos';
    END IF;
    v_folio := regexp_replace(upper(coalesce(p_origen->>'folio','')),'[^0-9A-Z]','','g');
    v_bovtar := regexp_replace(upper(coalesce(p_origen->>'bovtar','')),'[^0-9A-Z]','','g');
    v_concepto := regexp_replace(lower(coalesce(p_origen->>'concepto','')),'[^a-z0-9]+',' ','g');
    v_grupo := regexp_match(v_concepto,
        '(^| )([12]) *(adl|adulto|adultos|persona|personas) *(extra|adicional|adicionales)( |$)');
    IF v_grupo IS NULL OR v_grupo[2]::smallint IS DISTINCT FROM p_adicionales
       OR position('tinaja' in v_concepto)=0 AND position('jacuzzi' in v_concepto)=0
       OR v_folio !~ '^[0-9A-Z]{4,24}$' OR v_bovtar !~ '^[0-9A-Z]{4,24}$'
       OR p_origen->>'moneda' IS DISTINCT FROM 'CLP'
       OR coalesce(p_origen->>'monto','') !~ '^[0-9]{1,9}$'
       OR (p_origen->>'monto')::bigint IS DISTINCT FROM p_adicionales::bigint*10000
       OR coalesce(p_origen->>'fecha_pago','') !~ '^\d{4}-\d{2}-\d{2}$'
       OR coalesce(p_origen->>'fecha_bloque','') !~ '^\d{4}-\d{2}-\d{2}$'
       OR nullif(btrim(p_origen->>'hoja'),'') IS NULL
       OR nullif(btrim(p_origen->>'celda'),'') IS NULL THEN
        RAISE EXCEPTION 'El Libro no acredita personas adicionales y un segundo comprobante completo';
    END IF;
    IF (p_origen->>'fecha_pago')::date > current_date + 1 THEN
        RAISE EXCEPTION 'La fecha del comprobante requiere revisión';
    END IF;

    -- Compartir exactamente la autoridad financiera que ya usan Libro y Pagos.
    PERFORM pg_advisory_xact_lock(private.haiku_libro_lock_key_v1(
        'reserva_finanzas', p_reserva_id::text));
    PERFORM 1 FROM public.reservas r WHERE r.id=p_reserva_id
        AND r.estado_reserva NOT IN ('cancelada','no_show') FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La reserva destino ya no está vigente'; END IF;
    SELECT e.fecha_ingreso,e.fecha_salida INTO v_fecha_ingreso,v_fecha_salida
       FROM public.reserva_estadias e WHERE e.id=p_estadia_id
        AND e.reserva_id=p_reserva_id
        AND e.estado_estadia NOT IN ('cancelada','no_show')
        AND e.fecha_ingreso=(p_origen->>'fecha_bloque')::date FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La estadía no coincide con el bloque del Libro'; END IF;

    SELECT * INTO v_servicio FROM public.servicios s WHERE s.id=p_servicio_id FOR UPDATE;
    IF NOT FOUND OR v_servicio.reserva_id IS DISTINCT FROM p_reserva_id
        OR v_servicio.estadia_id IS DISTINCT FROM p_estadia_id THEN
        RAISE EXCEPTION 'La Jacuzzi ya no corresponde a esa reserva y estadía';
    END IF;
    SELECT * INTO v_catalogo FROM public.catalogo_servicios cs
       WHERE cs.id=v_servicio.catalogo_servicio_id FOR SHARE;
    IF NOT FOUND OR v_catalogo.codigo IS DISTINCT FROM 'tinajaJacuzzi'
        OR v_catalogo.activo IS DISTINCT FROM true
        OR v_catalogo.precio_base IS DISTINCT FROM 30000
        OR v_catalogo.capacidad_incluida IS DISTINCT FROM 3
        OR v_catalogo.capacidad_maxima IS DISTINCT FROM 5
        OR v_catalogo.precio_persona_adicional IS DISTINCT FROM 10000 THEN
        RAISE EXCEPTION 'La tarifa o capacidad Jacuzzi cambió; revisa el catálogo';
    END IF;

    v_origen_hash := encode(sha256(convert_to(
        p_reserva_id::text||'|'||p_servicio_id::text||'|'||
        v_folio||'|'||v_bovtar||'|'||p_origen->>'fecha_pago'||'|'||
        p_origen->>'monto','UTF8')),'hex');
    v_marca := '[HAKU-LIBRO-JACUZZI-ADL:'||v_origen_hash||']';
    IF position(v_marca in coalesce(v_servicio.observaciones,''))>0 THEN
        RETURN jsonb_build_object('ok',true,'ya_ampliado',true,
            'servicio_id',v_servicio.id,'reserva_id',p_reserva_id,
            'personas_finales',v_servicio.personas,'total',v_servicio.total);
    END IF;

    IF v_servicio.tipo_cobro IS DISTINCT FROM 'normal'
       OR v_servicio.estado_servicio IN ('cancelado','no_show')
       OR v_servicio.fecha_servicio NOT BETWEEN v_fecha_ingreso AND v_fecha_salida
       OR v_servicio.cantidad IS DISTINCT FROM 1
       OR v_servicio.precio_unitario_aplicado IS DISTINCT FROM 30000
       OR v_servicio.personas NOT BETWEEN 1 AND 4
       OR v_servicio.monto_adicional IS DISTINCT FROM
            greatest(0,v_servicio.personas-3)::bigint*10000
       OR v_servicio.total IS DISTINCT FROM 30000+v_servicio.monto_adicional THEN
        RAISE EXCEPTION 'La Jacuzzi tiene condiciones distintas; requiere revisión del servicio';
    END IF;
    IF coalesce(p_estado_esperado->>'personas','') IS DISTINCT FROM v_servicio.personas::text
       OR coalesce(p_estado_esperado->>'total','') IS DISTINCT FROM v_servicio.total::text
       OR coalesce(p_estado_esperado->>'cantidad','') IS DISTINCT FROM v_servicio.cantidad::text
       OR coalesce(p_estado_esperado->>'precio','') IS DISTINCT FROM v_servicio.precio_unitario_aplicado::text
       OR coalesce(p_estado_esperado->>'fecha_servicio','') IS DISTINCT FROM v_servicio.fecha_servicio::text
       OR coalesce(p_estado_esperado->>'hora','') IS DISTINCT FROM left(v_servicio.hora_inicio::text,5) THEN
        RAISE EXCEPTION 'El servicio cambió desde la comparación; vuelve a revisar';
    END IF;
    SELECT count(*) INTO v_servicios_activos FROM public.servicios s
       JOIN public.catalogo_servicios cs ON cs.id=s.catalogo_servicio_id
       WHERE s.estadia_id=p_estadia_id AND cs.codigo='tinajaJacuzzi'
         AND s.estado_servicio NOT IN ('cancelado','no_show');
    IF v_servicios_activos IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'Hay varias Jacuzzi candidatas para esa estadía';
    END IF;
    SELECT * INTO v_cargo FROM public.cargos c WHERE c.servicio_id=p_servicio_id
        AND c.estado='activo' FOR UPDATE;
    IF NOT FOUND OR v_cargo.tipo_cargo IS DISTINCT FROM 'servicio'
       OR v_cargo.reserva_id IS DISTINCT FROM p_reserva_id
       OR v_cargo.estadia_id IS DISTINCT FROM p_estadia_id
       OR v_cargo.monto IS DISTINCT FROM v_servicio.total THEN
        RAISE EXCEPTION 'El cargo original de la Jacuzzi requiere revisión';
    END IF;
    SELECT ec.saldo_cargo,ec.aplicado_neto INTO v_saldo,v_aplicado
       FROM public.vista_estado_cargos ec WHERE ec.cargo_id=v_cargo.id;
    IF v_saldo IS DISTINCT FROM 0 OR v_aplicado IS DISTINCT FROM v_servicio.total
       OR coalesce(p_estado_esperado->>'aplicado','') IS DISTINCT FROM v_aplicado::text
       OR coalesce(p_estado_esperado->>'saldo','') IS DISTINCT FROM v_saldo::text THEN
        RAISE EXCEPTION 'El cargo o los pagos originales cambiaron; vuelve a comparar';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.pagos p
        WHERE p.tipo_movimiento='pago' AND p.estado <> 'anulado'
          AND regexp_replace(upper(coalesce(p.folio,'')),'[^0-9A-Z]','','g')=v_folio
          AND regexp_replace(upper(coalesce(p.bove,p.codigo_autorizacion,'')),'[^0-9A-Z]','','g')=v_bovtar
    ) THEN RAISE EXCEPTION 'El segundo comprobante ya tiene un pago registrado'; END IF;

    v_personas_finales := greatest(v_servicio.personas,3)+p_adicionales;
    IF v_personas_finales>5 THEN RAISE EXCEPTION 'La Jacuzzi excede el máximo de cinco personas'; END IF;
    v_total_final := 30000+greatest(0,v_personas_finales-3)::bigint*10000;
    v_adicional := v_total_final-v_servicio.total;
    IF v_adicional IS DISTINCT FROM (p_origen->>'monto')::bigint THEN
        RAISE EXCEPTION 'La diferencia del cargo no coincide con el comprobante adicional';
    END IF;

    UPDATE public.servicios s SET personas=v_personas_finales,
       monto_adicional=v_total_final-30000,
       total=v_total_final,
       observaciones=concat_ws(E'\n',nullif(s.observaciones,''),v_marca)
    WHERE s.id=p_servicio_id RETURNING * INTO v_despues;

    SELECT ec.saldo_cargo,ec.aplicado_neto INTO v_saldo,v_aplicado
       FROM public.vista_estado_cargos ec WHERE ec.cargo_id=v_cargo.id;
    IF v_despues.personas IS DISTINCT FROM v_personas_finales
       OR v_despues.total IS DISTINCT FROM v_total_final
       OR v_saldo IS DISTINCT FROM v_adicional
       OR v_aplicado IS DISTINCT FROM v_servicio.total
       OR (SELECT count(*) FROM public.cargos c WHERE c.servicio_id=p_servicio_id AND c.estado='activo')<>1 THEN
        RAISE EXCEPTION 'Falló la comprobación del cargo ampliado; no se guardó la operación';
    END IF;
    RETURN jsonb_build_object('ok',true,'ya_ampliado',false,
        'reserva_id',p_reserva_id,'estadia_id',p_estadia_id,
        'servicio_id',p_servicio_id,'cargo_id',v_cargo.id,
        'personas_anteriores',v_servicio.personas,
        'personas_finales',v_personas_finales,
        'total_anterior',v_servicio.total,'total',v_total_final,
        'abono_original',v_aplicado,'nuevo_saldo',v_saldo);
END;
$fn$;

REVOKE ALL ON FUNCTION public.haiku_libro_ampliar_jacuzzi_v1(uuid,uuid,uuid,smallint,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.haiku_libro_ampliar_jacuzzi_v1(uuid,uuid,uuid,smallint,jsonb,jsonb) TO authenticated;
