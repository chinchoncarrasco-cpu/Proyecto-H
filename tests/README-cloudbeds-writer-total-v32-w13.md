# Cloudbeds Writer W1.3 · transición TOTAL v31 → v32

W1.3 es una migración incremental. No modifica W1.1, W1.2 ni TOTAL v31. Reemplaza únicamente las dos RPC públicas de Cloudbeds para que acepten una autoridad financiera cuya descripción sea exactamente `total1_financiero_v31` o `total1_financiero_v32`.

La versión se obtiene con `obj_description(to_regprocedure('public.haiku_cambiar_totales_lote_v1(jsonb)'), 'pg_proc')`; no se aceptan etiquetas distintas. El writer continúa delegando el lote completo, una sola vez, en `public.haiku_cambiar_totales_lote_v1(jsonb)`.

## Planner de nombre estable

La preview llama a `private.haiku_plan_total_financiero_v3(uuid,bigint)` y no replica guards financieros:

- con TOTAL v31, ese planner conserva el bloqueo de servicios;
- TOTAL v32 reemplaza el nombre estable por un adaptador al planner v32;
- el adaptador v32 certifica separación de cargos/pagos y entrega los totales de reserva.

La cadena v32 se declara `VOLATILE` porque el planner de aplicaciones puede generar UUID para nuevas aplicaciones. La preview sigue siendo de sólo lectura: `VOLATILE` evita prometer estabilidad entre llamadas, pero no agrega escrituras.

La preview v32 elegible expone:

- `autoridad_financiera_version`;
- `servicios_sin_cambios=true`;
- `total_servicios_sin_cambio`;
- `total_reserva_actual`;
- `total_reserva_esperado`.

## Orden de despliegue sin ventana insegura

1. Desplegar **solamente W1.3** mientras producción todavía tiene TOTAL v31.
2. Verificar capacidad v31, preview/escritura de alojamiento normal y bloqueo conservador de servicios.
3. Desplegar TOTAL v32.
4. Verificar que `haiku_capacidad_totales_v1()` reporta `total1_financiero_v32`, `writer_disponible=true` y `servicios_separados=true`; repetir Daniel, Isadora y pago mixto.
5. Recién en una entrega frontend posterior integrar el cambio `CLOUDBEDS_TARIFAS_WRITER_HABILITADO=true`.

El orden natural por filename es `20260929193900_cloudbeds_writer_total_v32_w13.sql` y luego `20260929194050_total_v32_servicios_separados.sql`. Así, una ejecución normal de migraciones instala primero la compatibilidad W1.3 y después cambia la autoridad a TOTAL v32, sin depender de una aplicación manual fuera de orden.

## Cobertura local

```powershell
$env:HAKU_PGLITE_MODULE = '<ruta local a @electric-sql/pglite>'
node tests/cloudbeds-writer-total-v32-w13-postgres.cjs
node --test tests/cloudbeds-writer-total-v32-w13.test.cjs
```

La prueba PostgreSQL levanta el estado A (`v31 + W1.3`) y después, sobre la misma base efímera, el estado B (`v32 + W1.3`). Cubre Daniel, Isadora, pago mixto, alojamiento sin servicios y Vanessa Full Day. No usa Supabase remoto.
