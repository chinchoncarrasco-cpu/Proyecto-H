# Pruebas del lector semántico

Ejecutar con Node.js: `node --test tests/libro-semantica.test.cjs`.

El módulo de interpretación no requiere navegador ni Supabase. Las pruebas usan datos sintéticos y comprueban separación de colores, fechas, asociación conservadora, ausencia de inferencias con geometría desconocida y consultas sin escritura.

Verificación funcional con un XLSX real (no incluir datos de huéspedes en el repositorio):

1. Cargar una copia anterior y una copia actual desde Libro de Reserva.
2. Preguntar a Haku: `Libro: CAB 6 el 05-09-26`. Contrastar celda y merge con el original, fechas de estancia y movimientos del bloque de ingreso.
3. Preguntar por aseo en una fecha con datos, y comprobar inicio, fin y revisión en la columna estrecha correspondiente.
4. Preguntar por diferencias entre versiones dentro de un mes.
5. Recargar y repetir ambas consultas. Volver a cargar el mismo archivo y comprobar que no reemplaza el snapshot anterior.
6. Quitar el Libro: deben desaparecer ambos snapshots y quedar invalidadas las respuestas de esa copia. Tras recargar, Haku debe pedir que se cargue un archivo.
7. Comparar una reserva con Proyecto H en una sesión autenticada. Verificar que sólo se emiten SELECT y que los movimientos sin asociación segura no se asignan.
8. Probar nota roja y fragmento amarillo junto a texto blanco, negro o azul: la nota no cambia el estado operativo.

La aplicación sólo incorpora rutas de lectura. Las órdenes de crear, modificar o borrar desde el Libro se detienen en una explicación; no llegan a los procesadores de escritura existentes.

## Preparar incorporación (rama preview, sin escrituras)

Ejecutar todas las pruebas: `node --test tests/*.test.cjs`.

1. En la copia local de `haku-reconciliacion-preview`, actualizar con `git pull --ff-only` y recargar con Ctrl+Shift+R.
2. Iniciar sesión, cargar el XLSX real en Libro de Reserva y pedir: `Libro: compara septiembre 2026 con Proyecto H y prepara la incorporación de reservas y pagos faltantes`.
3. Revisar las decisiones de Yann, Macarena, Angelo y los demás casos. Elegir misma reserva, independiente/nueva, añadir estadía o pendiente según el Libro.
4. Pulsar **Preparar incorporación**. Esperar la nueva consulta de reservas y pagos. Revisar las siete categorías, datos conocidos, motivos de bloqueo y resumen de seleccionados.
5. Contrastar una multicabaña (una reserva con varias estadías), un Full Day (mismo día, cero noches) y los pagos bajo el bloque del Check-In, aunque la fecha del comprobante sea anterior.
6. Desmarcar una reserva nueva: sus pagos dependientes deben quedar desmarcados y bloqueados. Volver a marcarla permite seleccionar sus pagos de nuevo.
7. Aprobar para simulación un pago manual sólo cuando el botón esté disponible y sus datos sean correctos. La aprobación vuelve a revalidar. Datos esenciales faltantes, pagos pendientes o medio Webpay sin subtipo permanecen bloqueados.
8. Volver a la comparación: las decisiones se conservan. Preparar otra vez debe producir la misma propuesta si nada cambió. Un registro añadido por la operación habitual entre ambas consultas debe aparecer como **Ya existe / omitido**; no crear registros reales sólo para esta prueba.
9. Confirmar que **Confirmar incorporación** está deshabilitado y muestra **Escritura real deshabilitada en modo de prueba**. No hay ejecución de RPC ni inserts/updates desde este módulo.

### Contrato de simulación

- `crearPlanIncorporacion` produce datos puros; `prepararIncorporacion` realiza una nueva comparación autenticada de sólo lectura antes de construirlos. La deduplicación global alcanza los pagos visibles por RLS; no certifica registros ocultos a la sesión.
- Reservas: nombres de columnas de `reservas` y `reserva_estadias`, con `cabana_numero` como referencia pendiente de resolución a `cabana_id`. Una multicabaña tiene una cabecera única. Estado inicial propuesto: `pendiente`; los estados observados del Libro se conservan aparte.
- No se inventan cantidades, documentos, contactos, precios ni fechas de comprobante. Los adultos ausentes bloquean; niños y mascotas desconocidos permanecen `null`, sin convertirse en cero. El tipo de documento desconocido también permanece `null`.
- Pagos: argumentos de `haiku_registrar_pago` y `datos_origen` separados, incluyendo Bovtar y bloque de Check-In. `reserva_ref` vincula pagos a la reserva por crear; nunca se usa un identificador ficticio como UUID. La etapa abono/saldo queda pendiente de resolución en el contrato, sin inferirla a partir del bloque del Libro. Estos borradores NO son solicitudes listas para ejecutar directamente.
- Referencias de contrato: `20260902053250_crear_reserva_fullday_con_cargo.sql` y llamadas a `haiku_registrar_pago` en `20260903194500_saldo_a_favor_huesped.sql`. Permisos existentes: `reservas.crear`, `reservas.editar`, `pagos.registrar`. No se amplían permisos.
- Identificador ya existente: omitido globalmente. Asociación y monto repetidos: omisión conservadora para revisión, sin afirmar que necesariamente sean el mismo pago.
- La fase futura, posterior a validación visual, deberá resolver los campos pendientes, validar disponibilidad/capacidad/permisos y volver a deduplicar dentro de una única RPC transaccional. No conectar estos borradores directamente a las RPC actuales.

Validación visual con el Libro real: pendiente del usuario. No subir XLSX ni datos personales al repositorio.
