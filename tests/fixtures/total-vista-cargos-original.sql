-- Definición leída de producción, sin datos de clientes.
create or replace view public.vista_estado_cargos as  WITH aplicaciones_netas AS (
         SELECT pa.cargo_id,
            sum(
                CASE
                    WHEN p.estado = 'confirmado'::text AND p.tipo_movimiento = 'pago'::text THEN pa.monto_aplicado
                    WHEN p.estado = 'confirmado'::text AND p.tipo_movimiento = 'devolucion'::text THEN - pa.monto_aplicado
                    ELSE 0::bigint
                END)::bigint AS aplicado_original
           FROM pago_aplicaciones pa
             JOIN pagos p ON p.id = pa.pago_id
          GROUP BY pa.cargo_id
        ), ajustes_activos AS (
         SELECT ca.cargo_id,
            sum(
                CASE
                    WHEN ca.estado = 'activo'::text THEN ca.signo * ca.monto
                    ELSE 0::bigint
                END)::bigint AS ajuste_neto
           FROM cargo_ajustes ca
          GROUP BY ca.cargo_id
        ), base AS (
         SELECT c.id,
            c.reserva_id,
            c.estadia_id,
            c.servicio_id,
            c.estadia_noche_id,
            c.tipo_cargo,
            c.concepto,
            c.monto,
            c.estado,
            c.creado_en,
            COALESCE(an.aplicado_original, 0::bigint) AS aplicado_original,
            COALESCE(aa.ajuste_neto, 0::bigint) AS ajuste_neto,
            GREATEST(c.monto + COALESCE(aa.ajuste_neto, 0::bigint), 0::bigint) AS monto_ajustado
           FROM cargos c
             LEFT JOIN aplicaciones_netas an ON an.cargo_id = c.id
             LEFT JOIN ajustes_activos aa ON aa.cargo_id = c.id
        ), contexto AS (
         SELECT b.id,
            b.reserva_id,
            b.estadia_id,
            b.servicio_id,
            b.estadia_noche_id,
            b.tipo_cargo,
            b.concepto,
            b.monto,
            b.estado,
            b.creado_en,
            b.aplicado_original,
            b.ajuste_neto,
            b.monto_ajustado,
            sum(
                CASE
                    WHEN b.tipo_cargo = 'alojamiento'::text AND b.estado = 'activo'::text THEN b.aplicado_original
                    ELSE 0::bigint
                END) OVER (PARTITION BY b.reserva_id)::bigint AS aplicado_alojamiento_total,
            COALESCE(sum(
                CASE
                    WHEN b.tipo_cargo = 'alojamiento'::text AND b.estado = 'activo'::text THEN b.monto_ajustado
                    ELSE 0::bigint
                END) OVER (PARTITION BY b.reserva_id ORDER BY b.creado_en, b.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0::bigint::numeric)::bigint AS monto_alojamiento_previo,
            sum(
                CASE
                    WHEN b.tipo_cargo = 'alojamiento'::text AND b.estado = 'activo'::text THEN 1
                    ELSE 0
                END) OVER (PARTITION BY b.reserva_id ORDER BY b.creado_en, b.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS orden_alojamiento
           FROM base b
        ), normalizado AS (
         SELECT x.id,
            x.reserva_id,
            x.estadia_id,
            x.servicio_id,
            x.estadia_noche_id,
            x.tipo_cargo,
            x.concepto,
            x.monto,
            x.estado,
            x.creado_en,
            x.aplicado_original,
            x.ajuste_neto,
            x.monto_ajustado,
            x.aplicado_alojamiento_total,
            x.monto_alojamiento_previo,
            x.orden_alojamiento,
                CASE
                    WHEN x.tipo_cargo = 'alojamiento'::text AND x.estado = 'activo'::text THEN
                    CASE
                        WHEN x.aplicado_alojamiento_total >= 0 THEN GREATEST(LEAST(x.aplicado_alojamiento_total - x.monto_alojamiento_previo, x.monto_ajustado), 0::bigint)
                        WHEN x.orden_alojamiento = 1 THEN x.aplicado_alojamiento_total
                        ELSE 0::bigint
                    END
                    ELSE x.aplicado_original
                END AS aplicado_neto
           FROM contexto x
        )
 SELECT id AS cargo_id,
    reserva_id,
    estadia_id,
    servicio_id,
    estadia_noche_id,
    tipo_cargo,
    concepto,
    monto,
    estado,
    aplicado_neto,
    GREATEST(monto_ajustado - aplicado_neto, 0::bigint) AS saldo_cargo,
        CASE
            WHEN estado <> 'activo'::text THEN 'anulado'::text
            WHEN aplicado_neto <= 0 THEN 'pendiente'::text
            WHEN aplicado_neto < monto_ajustado THEN 'parcial'::text
            ELSE 'pagado'::text
        END AS estado_pago,
    ajuste_neto,
    monto_ajustado
   FROM normalizado n;
