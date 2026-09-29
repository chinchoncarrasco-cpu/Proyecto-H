# TOTAL v32 · servicios separados

Implementación incremental y local. No modifica las migraciones históricas de TOTAL v31 y mantiene el writer frontend deshabilitado.

## Autoridad

Se conserva la firma pública:

```text
public.haiku_cambiar_totales_lote_v1(jsonb)
```

La capacidad pasa a `total1_financiero_v32` y declara `servicios_separados=true`.

El plan v32 divide el universo financiero por destino físico:

- alojamiento: cargo activo, `tipo_cargo='alojamiento'` y `servicio_id is null`;
- servicio: cargo activo, `tipo_cargo<>'alojamiento'`, `servicio_id` presente y servicio de la misma reserva.

Sólo las aplicaciones de alojamiento entran al reconciliador. Los pagos exclusivos de servicio deben estar completamente aplicados y se preservan junto con sus aplicaciones. Un mismo `pago_id` con aplicaciones a ambos destinos se bloquea.

## Casos certificados

- Daniel: alojamiento `320000 → 288000`, servicio `30000` intacto, total económico `318000`.
- Isadora: alojamiento `320000 → 320232`, servicios intactos, total económico `+232`.
- sin pagos y servicio impago;
- pago exclusivo de alojamiento y servicio impago;
- pagos separados por destino;
- ajuste de cargo de servicio intacto;
- Full Day con servicio separado;
- IVA de alojamiento con servicio separado;
- no-op y lote atómico.

Siguen bloqueados pagos mixtos, pagos sin aplicación, pagos de servicio con remanente, devoluciones vinculadas, cargos no separados, servicios cuyo total no coincide con sus cargos y objetivos inferiores al pago de alojamiento confirmado.

## Pruebas locales

```powershell
$env:HAKU_PGLITE_MODULE = 'C:\Users\Pipe\Documents\HAIKU\tests\artifacts\pglite-w1\node_modules\@electric-sql\pglite'
node tests/totales-v32-servicios-separados-postgres.cjs
node --test tests/totales-v32-servicios-separados.test.cjs
```

El módulo PGlite se lee desde el worktree de activación únicamente como dependencia instalada; las pruebas y sus bases efímeras se ejecutan en memoria y no modifican ese worktree.

## Integración W1.3

`20260929193900_cloudbeds_writer_total_v32_w13.sql` habilita la transición controlada. TOTAL v32 adapta el nombre estable `private.haiku_plan_total_financiero_v3(uuid,bigint)` al planner v32 para que la preview W1.3 use la misma autoridad sin duplicar guards. El orden operativo completo está documentado en `tests/README-cloudbeds-writer-total-v32-w13.md`.
