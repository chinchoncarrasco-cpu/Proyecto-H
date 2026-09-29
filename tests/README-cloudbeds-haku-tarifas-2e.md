# Demo local: Cloudbeds Tarifas 2E en Haku

La fixture usa exclusivamente datos ficticios. No conecta con Supabase: el cliente local sólo acepta `haiku_capacidad_totales_v1` y rechaza cualquier otra RPC. El writer permanece deshabilitado mediante `CLOUDBEDS_TARIFAS_WRITER_HABILITADO = false`.

## Abrir la demo

Desde la raíz del proyecto:

```powershell
node tests/cloudbeds-pdf-demo-server.cjs 4175
```

Abrir:

```text
http://127.0.0.1:4175/tests/fixtures/cloudbeds-haku-tarifas-2e/
```

Para iniciar directamente con Haku y Ver reserva abiertos:

```text
http://127.0.0.1:4175/tests/fixtures/cloudbeds-haku-tarifas-2e/?inspector=1
```

## Guion manual

1. Revisar los cinco contadores y abrir/cerrar las categorías.
2. Confirmar que Amanda y Beatriz aparecen como `CONTEXTO_FULLDAY_UNICO`: Cloudbeds muestra D → D+1 y Proyecto H D → D.
3. Revisar los cuatro casos Full Day: total actual $160.000, $150.000, $120.000 y Price Total $150.000 con producto ficticio de $30.000. El alojamiento candidato siempre debe ser Deposit $120.000.
4. Confirmar que Carla queda en `Coinciden` y que Diana mantiene separado el producto de $30.000.
5. Confirmar que el caso `Nombre Cloudbeds Distinto` queda en `Revisión manual`, no en `No identificadas`.
6. Confirmar que Héctor y Elena siguen en `Propuestas seguras` como `CONTEXTO_EXACTO_UNICO`; Rodrigo sigue como control negativo en `No identificadas`.
7. En una propuesta segura, pulsar `Ver reserva`; debe reutilizarse el Inspector existente por el `reserva_id` interno. También puede abrirse otra reserva desde la tabla principal.
8. Cerrar la ficha y comprobar que el borrador y el scroll de Haku siguen intactos.
9. Seleccionar una propuesta o `Seleccionar todo lo listo`.
10. Abrir la confirmación y confirmar la simulación. El resultado debe indicar cero escrituras.
11. Revisar `Payload futuro · diagnóstico`; sólo contiene `reserva_id`, `total_actual` y `total_objetivo`.
12. Reducir el viewport a 390 px, abrir `Ver reserva` y usar `← Volver a Haku`.

La variante `?inspector=1` facilita comparar el modo lado a lado de escritorio y el modo alternado móvil.
