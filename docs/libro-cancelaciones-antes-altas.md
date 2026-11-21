# Cancelaciones antes de reservas nuevas

El lote mixto enviaba primero reservas/pagos y después ejecutaba los cambios detectados, incluidas las cancelaciones aprobadas. Un alta que necesitaba esa ocupación libre podía fallar antes de llegar a la cancelación.

La confirmación ejecuta ahora primero las cancelaciones seleccionadas y revalidadas por el RPC existente. Después incorpora las altas. Las cancelaciones rechazadas o sin seleccionar dejan pendientes las altas que dependen de su cabaña/rango y sus pagos dependientes; los elementos independientes pueden continuar. Se conservan las fronteras de alojamiento y Full Day de la disponibilidad oficial, incluido el cruce con checkout. Sin rango verificado no se presume independencia.

No se cancelan reservas por el simple hecho de aparecer en una comparación. Se mantienen la selección, confirmación del propietario, fuente, permisos y las guardas del servidor contra pagos, actividad operativa y servicios asociados. No hay migración ni cambios en datos reales.

Las cancelaciones y las altas utilizan RPC existentes separados: una cancelación confirmada no se deshace porque falle después un alta. El recibo queda visible y se conserva al reintentar; no se vuelve a ejecutar la cancelación confirmada. Una respuesta de red incierta conserva el mismo identificador de operación. Un rechazo explícito de disponibilidad permite volver a comparar en lugar de retener la selección como si fuera un fallo de red.

Validación local con datos ficticios: reproducción del conflicto antes del ajuste; cancelación antes del alta; cancelación rechazada/sin seleccionar; bloqueo transitivo del pago; continuidad independiente; Full Day y alojamientos contiguos; recibo e idempotencia tras pérdida de respuesta; conflicto de disponibilidad. Las regresiones de cancelación y el RPC en PostgreSQL embebido conservan las guardas financieras.

Chromium ejecutó el flujo y la interfaz reales a 390/1440 px, claro/oscuro: recibo de la cancelación ante fallo posterior, Volver habilitado ante disponibilidad, operación conservada ante fallo de red y resultado final tras reintentar. Cero tráfico externo. [Capturas con datos ficticios](evidencia/libro-cancelaciones-antes-altas/).

Pruebas nuevas: `node --test tests/libro-cancelaciones-antes-altas.test.cjs` y `node tests/libro-cancelaciones-antes-altas-browser-check.cjs` (Playwright/Chromium local). Integradas en el flujo de CI existente. Pendiente de autorización para publicar y de comprobación en el teléfono.
