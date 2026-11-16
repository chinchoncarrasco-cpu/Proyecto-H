Proyecto H · candidato de incorporación financiera · ejemplo sintético · 16/11/2026

Base: `8431b62636a0fc224e5d2e6a982c81d2bd663e05`. Rama: `codex/libro-pagos-20261116`.
No se publicaron cambios ni se escribieron reservas reales. La evidencia de huéspedes permanece fuera del repositorio, en `%LOCALAPPDATA%\ProyectoH\diagnosticos\libro-pagos-20261116-privado`.

Este documento describe únicamente el ejemplo ficticio de `tests/fixtures/libro-pagos-revision.cjs`, no un extracto del Libro ni de reservas reales. Su recorrido reproduce lectura, normalización financiera, asociación de reserva/estadía, destino y serialización. El diagnóstico real por celdas, la auditoría histórica y sus limitaciones se conservaron en la evidencia privada del equipo.

| Rango ficticio | Caso de regresión | Resultado del candidato |
|---|---|---|
| AZ31:BC31 · 144.000 | Pago ficticio confirmado ya existente, con origen en otra fecha/cabaña y sin aplicaciones. | Registrado, aplicado 0 y sin aplicar 144.000. Muestra el origen histórico. No duplica ni reasigna el abono. |
| AZ32:BC32 · 14.400 | «DIFERENCIA TARIFA» se clasificaba como «otro» y terminaba en la ruta de servicios. La glosa identifica al remitente, sin número de operación bancaria explícito. | Alojamiento, separado del ajuste que genera un cargo. Muestra su cargo y saldo; requiere aprobación del comprobante y reutiliza el validador bancario contextual existente dentro del escritor idempotente. El cargo único de esta estadía y su saldo se revalidan antes de aplicar. Conserva la glosa, fecha e importe, sin inventar un identificador bancario. |
| AZ33:BC33 · 16.000 | Ajuste ficticio de 14.400 al 10%, ligado a alojamiento; no coincide con los 16.000 de la fila de prueba. Crédito, fecha, folio/BOVTAR ficticios y «PEND BOVE Y MANAGEER». | La discrepancia del ajuste permanece en revisión y se identifica el campo distinto. El comprobante recibido se revisa en un ítem independiente: aprobación explícita, destino de alojamiento revalidado y comprobación de pagos/aplicaciones existentes. No cambia ni duplica el ajuste. |
| AZ34:BC34 · 32.500 | «Tinaja» resuelve el único cargo compatible: Jacuzzi de la misma estadía, con saldo 30.000. El recibo supera ese saldo en 2.500. | La misma fila muestra concepto, cargo, recibo, aplicación y diferencia. Puede aprobarse registrar 32.500, aplicar 30.000 y dejar 2.500 sin aplicar. Otra acción exige motivo, confirmación y evidencia independiente del precio final: ajusta solamente ese cargo en 2.500 y después revalida el pago. No cambia catálogo, servicio original ni comprobante. |
| AZ35:BC35 · 65.000 | El cliente ficticio no contiene servicio/cargo de masaje. | Requiere revisión. Reutiliza la creación manual protegida de servicio, previa elección de tipo/duración, fecha/hora y precio. No lo aplica al Jacuzzi ni a otra estadía. |

Los identificadores del ejemplo son UUID ficticios. Una fecha antigua de comprobante no se convierte en otra estadía y el titular no se usa por sí solo para fusionar reservas.

En el ejemplo sintético, la ficha anterior presentaba magnitudes distintas sin explicación: total activo 188.400 = alojamiento ajustado 158.400 + servicio 30.000; abonos confirmados 144.000; cargos pendientes de aplicación 188.400. El candidato etiqueta **Saldo neto: 44.400** y explica **saldo de cargos: 188.400 / pagos sin aplicar: 144.000**. No ejecuta aplicaciones para corregir la presentación.

Archivos de implementación: `js/haiku-libro-consultas-v1.js`, `js/haiku-libro-lenguaje-natural-v1.js`, `js/haiku-libro-pagos-destinos-v1.js`, `js/haiku-libro-semantica-v1.js`, `js/supabase-finanzas-resumen-v1.js`, `js/supabase-ficha-v2.js` y `css/supabase-haku-reconciliacion-v1.css`.

La migración local `20261116151953_libro_revision_pagos_excedente.sql` amplía el escritor 4C existente: asignación parcial expresamente aprobada, destino único de alojamiento y ajuste de precio sobre un único cargo. Conserva controles de usuario/permisos, identidad, bloqueos, saldos esperados, idempotencia y auditoría. Falla si la estructura del escritor no coincide con los puntos de extensión esperados. No se aplicó a Supabase. La interfaz exige capacidades anunciadas por el servidor: las acciones nuevas siguen bloqueadas con el backend anterior.

Verificaciones ejecutadas:

**293 pruebas PASS**, incluida la instalación local sobre copias de los cuerpos SQL vigentes, más la suite PostgreSQL 4C existente y las cuatro combinaciones de navegador PASS.

- Suites focales del Libro, destinos, pagos canónicos, aprobación manual, penalidades, actualizaciones, ficha y semántica; pruebas nuevas de regresión financiera y PostgreSQL local.
- Reintentos con igual operación e igual comprobante, pagos existentes con y sin aplicaciones, ajuste coincidente y diferencias de monto/porcentaje/motivo/reserva/cargo, respuesta perdida, detalle de ajuste incompleto, cambio de saldo antes de confirmar y bloqueo de destinos de otra estadía.
- PostgreSQL embebido y desechable (PGlite): cuerpos reales del escritor, registro de pagos y vista de cargos; 32.500/30.000/2.500, ajuste aislado +2.500, catálogo y recibo intactos, permisos revocados, cambio de fecha/cabaña y rollback de errores. No se usó una base remota para probar escrituras.
- Suite PostgreSQL 4C existente: distribución múltiple, subconjuntos ambiguos, idempotencia y rollback PASS.
- Chromium real: escritorio 1440 px y móvil 390 px, claro/oscuro; formulario plegable, campos en dos columnas o una según ancho, estado antes/después confirmado y cero llamadas externas. Datos exclusivamente ficticios.

Pruebas nuevas: `tests/libro-pagos-revision-financiera.test.cjs`, `tests/libro-pagos-revision-postgres.test.cjs`, `tests/libro-pagos-revision-browser-check.cjs`, `tests/libro-pagos-revision-evidencia.cjs` y los fixtures `libro-pagos-revision.cjs` / `libro-transferencia-validador-sql-v2.sql`. Se adaptaron las suites existentes de penalidad (ajuste, pago manual y revalidación), destinos/integración, servicios/frontend y aprobación manual para incluir el vínculo explícito de estadía y los nuevos RPC protegidos.

`libro-pagos-revision-antes-despues-sintetico.json` contiene la comparación reproducible contra la base y las propuestas serializadas tras aprobaciones ficticias. Se regenera con `node tests/libro-pagos-revision-evidencia.cjs`. Las imágenes sintéticas están en `%LOCALAPPDATA%\ProyectoH\diagnosticos\libro-pagos-20261116-sintetico`.

Limitaciones: no se verificó un extracto bancario externo ni una autorización real de precio final; la aprobación corresponde al operador. La concurrencia se valida mediante snapshots obsoletos y bloqueos del escritor en PostgreSQL embebido; no se acreditó una prueba con dos conexiones PostgreSQL independientes. La migración y publicación quedan pendientes de revisión y autorización.
