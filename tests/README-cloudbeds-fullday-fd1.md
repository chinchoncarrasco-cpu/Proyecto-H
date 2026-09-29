# Cloudbeds Full Day FD-1 · diagnóstico y auditoría de solo lectura

Esta etapa no cambia SQL, migraciones, RPC, Supabase ni writers. La comparación local sigue siendo informativa y `CLOUDBEDS_TARIFAS_WRITER_HABILITADO` permanece en `false`.

## Causa exacta de identidad

Cloudbeds representa un Full Day con `check-in D` y `check-out D+1`. Proyecto H persiste la misma ocupación como `reserva_estadias.tipo_estadia = 'fullday'`, `fecha_ingreso = D` y `fecha_salida = D`.

El fallback anterior sólo aceptaba igualdad literal de cabaña, ingreso y salida. Por eso una reserva Full Day histórica sin `reservas.cloudbeds_id` no podía llegar a `CONTEXTO_EXACTO_UNICO`, aunque nombre y cabaña fueran correctos.

FD-1 agrega `CONTEXTO_FULLDAY_UNICO`. Sus señales de identidad son independientes de los montos:

- una sola habitación Cloudbeds;
- Cloudbeds exactamente `D → D+1`;
- una sola estadía Proyecto H `fullday`, en la misma cabaña, `D → D`;
- una sola reserva/estadía compatible;
- nombre normalizado exactamente igual para continuar con certeza alta.

Si cabaña, patrón de fechas y Full Day identifican una estadía única, pero el nombre difiere, la reserva se conserva como contexto visible y queda en `REVISION_MANUAL`. No existe fuzzy matching. Más de una reserva/estadía compatible queda `AMBIGUA`.

## Regla financiera observada

- `Deposit` sigue siendo siempre el candidato de alojamiento.
- `Price Total` puede incluir productos y nunca reemplaza ni se suma a `Deposit`.
- `Productos` presente y vacío es una señal distinta de una columna `Productos` ausente.
- Para la composición comprobable de 2 adultos y 0 niños, la referencia es `2 × $60.000 = $120.000` (mínimo 2 personas).
- Para cualquier otra composición, FD-1 no inventa precios de niños: conserva `Deposit` como fuente primaria y la regla por persona sólo como señal secundaria.
- Se leen también total, pagado y saldo actuales; `saldo esperado = Deposit - pagado actual` se muestra como diagnóstico y no escribe nada.

## Auditoría de `public.haiku_crear_reserva(...)`

La función vigente está definida en `supabase/migrations/20260902053250_crear_reserva_fullday_con_cargo.sql`.

Para `p_tipo_estadia = 'fullday'` busca `p_tarifas[D]`. Si esa clave falta o su texto está vacío, usa `cabanas.precio_base`. Ese valor es el precio base nocturno de la cabaña, no una tarifa Full Day por personas. Así un Full Day pudo terminar históricamente en $150.000 o $160.000.

Flujos cliente revisados:

- `js/supabase-nueva-reserva-fullday-v1.js`: llama directamente a `haiku_crear_reserva` con `p_tipo_estadia = 'fullday'` y una tarifa explícita. Al seleccionar fecha/cabaña, su fallback local usa `precioCabana(cabana)`, por lo que también puede enviar explícitamente el precio nocturno como tarifa Full Day.
- `js/supabase-data.js`: llama al RPC para alojamiento normal y pasa `datos.tarifas`.
- `js/supabase-asistente-v1.js`: el creador general bloquea tipos distintos de `alojamiento`; sus variantes directa, Webpay, transferencia y abonos pasan el mapa calculado por `tarifasDesdeReserva`.
- `js/supabase-asistente-actividad-hoy-v1.js`: crea alojamiento y distribuye el total por noches.
- `js/supabase-asistente-listado-cloudbeds-v2.js`: para Full Day convierte salida a ingreso y hoy prepara `{ [checkIn]: precio_total }`; luego usa el RPC de lote. Si `Price Total` contiene productos, ese flujo puede llevarlos a la tarifa de alojamiento.
- `js/supabase-reserva-multiple-v1.js`: usa el RPC de reservas múltiples, limitado a alojamiento.

Wrappers SQL que llaman a la misma función fueron auditados sin modificarlos:

- reservas múltiples;
- creación atómica con Webpay, transferencia o múltiples abonos;
- lote del asistente y actividad de hoy;
- importación de listado Cloudbeds;
- incorporación desde Libro/Haku.

Los wrappers financieros y de lote reenvían `p_tarifas` o el mapa de cada ítem. Las rutas de Libro visibles en migraciones posteriores invocan la función con `{}` y pueden activar el fallback a `precio_base` si el tipo es Full Day. La importación Cloudbeds reenvía el mapa armado en el cliente, actualmente basado en `Price Total` para Full Day.

## Dónde corresponde la corrección de backend futura

La corrección de creación no debe vivir en el lector FD-1. Debe hacerse en el límite de dominio que crea Full Day:

1. calcular y validar una tarifa Full Day explícita antes de invocar el RPC, con una política definida para adultos, niños y mínimo;
2. evitar que el formulario Full Day use silenciosamente `cabanas.precio_base`;
3. separar productos de alojamiento en el importador Cloudbeds y no enviar `Price Total` como tarifa cuando contiene extras;
4. hacer que el RPC rechace una tarifa Full Day ausente/vacía en vez de degradar al precio base nocturno, una vez migrados todos sus llamadores.

Ese trabajo requiere una etapa backend coordinada y una migración; queda deliberadamente fuera de FD-1.

## Demo local

```powershell
node tests/cloudbeds-pdf-demo-server.cjs 4175
```

Abrir:

```text
http://127.0.0.1:4175/tests/fixtures/cloudbeds-haku-tarifas-2e/?inspector=1
```

La fixture contiene solamente datos ficticios y rechaza cualquier RPC distinta de la consulta simulada de capacidad.
