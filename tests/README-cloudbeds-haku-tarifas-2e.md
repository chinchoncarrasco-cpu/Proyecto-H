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
2. Confirmar que Héctor y Elena aparecen en `Propuestas seguras` como `CONTEXTO_EXACTO_UNICO`, aunque sus reservas ficticias no tienen `cloudbeds_id`.
3. Confirmar que Rodrigo permanece en `No identificadas`: no existe nombre + cabaña + fechas coincidente.
4. En una propuesta segura, pulsar `Ver reserva`; debe reutilizarse el Inspector existente por el `reserva_id` interno.
5. Cerrar la ficha y comprobar que el borrador de Haku sigue intacto.
6. Seleccionar una propuesta o `Seleccionar todo lo listo`.
7. Abrir la confirmación y confirmar la simulación. El resultado debe indicar cero escrituras.
8. Revisar `Payload futuro · diagnóstico`; sólo contiene `reserva_id`, `total_actual` y `total_objetivo`.
9. Reducir el viewport a 390 px, abrir `Ver reserva` y usar `← Volver a Haku`.

La variante `?inspector=1` facilita comparar el modo lado a lado de escritorio y el modo alternado móvil.
