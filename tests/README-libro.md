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

Las consultas normales siguen siendo de lectura. La única escritura habilitada desde el Libro es la confirmación explícita de una incorporación preparada y revalidada.

## Incorporar reservas y pagos desde la rama preview

Ejecutar todas las pruebas: `node --test tests/*.test.cjs`.

1. En la copia local de `haku-reconciliacion-preview`, actualizar con `git pull --ff-only` y recargar con Ctrl+Shift+R.
2. Iniciar sesión, cargar el XLSX real en Libro de Reserva y pedir: `Libro: compara septiembre 2026 con Proyecto H y prepara la incorporación de reservas y pagos faltantes`.
3. Revisar las decisiones de Yann, Macarena, Angelo y los demás casos. Elegir misma reserva, independiente/nueva, añadir estadía o pendiente según el Libro.
4. Pulsar **Preparar incorporación**. Esperar la nueva consulta de reservas y pagos. Revisar las siete categorías, datos conocidos, motivos de bloqueo y resumen de seleccionados.
5. Contrastar una multicabaña (una reserva con varias estadías), un Full Day (mismo día, cero noches) y los pagos bajo el bloque del Check-In, aunque la fecha del comprobante sea anterior.
6. Desmarcar una reserva nueva: sus pagos dependientes deben quedar desmarcados y bloqueados. Volver a marcarla permite seleccionar sus pagos de nuevo.
7. Aprobar un pago manual sólo cuando el botón esté disponible y sus datos sean correctos. La aprobación vuelve a revalidar. Datos esenciales faltantes, pagos pendientes o medio Webpay sin subtipo permanecen bloqueados.
8. Volver a la comparación: las decisiones se conservan. Preparar otra vez debe producir la misma propuesta si nada cambió. Un registro añadido por la operación habitual entre ambas consultas debe aparecer como **Ya existe / omitido**; no crear registros reales sólo para esta prueba.
9. Desmarcar todo lo que no deba guardarse. Pulsar **Confirmar incorporación**, revisar el resumen final y aceptar la confirmación del navegador. Haku vuelve a consultar Proyecto H inmediatamente antes de escribir.
10. Comprobar el resultado en Reservas, calendario y pagos. Repetir la misma confirmación tras una interrupción de red debe recuperar el resultado anterior sin duplicarlo.

### Contrato de incorporación

- `crearPlanIncorporacion` produce datos puros y `prepararIncorporacion` realiza una comparación autenticada antes de construirlos. Al confirmar se revalida por segunda vez y se llama una sola vez a `haiku_incorporar_libro_v1`.
- Reservas: nombres de columnas de `reservas` y `reserva_estadias`, con `cabana_numero` como referencia pendiente de resolución a `cabana_id`. Una multicabaña tiene una cabecera única. Estado inicial propuesto: `pendiente`; los estados observados del Libro se conservan aparte.
- No se inventan documentos, contactos, precios ni fechas de comprobante. Los adultos ausentes bloquean; los datos no conocidos se conservan en las notas del Libro. El tipo de documento desconocido permanece `null`.
- Pagos: `reserva_ref` vincula el pago con el UUID obtenido al crear la reserva. Se registran como abonos previos al ingreso, con la fecha real del comprobante; la fecha del bloque sólo valida que corresponde al Check-In.
- Referencias de contrato: `20260902053250_crear_reserva_fullday_con_cargo.sql` y llamadas a `haiku_registrar_pago` en `20260903194500_saldo_a_favor_huesped.sql`. Permisos existentes: `reservas.crear`, `reservas.editar`, `pagos.registrar`. No se amplían permisos.
- La RPC toma bloqueos breves sobre estadías y pagos, valida disponibilidad y permisos, deduplica identificadores fuertes globalmente y omite asociación/monto repetidos. Si algo falla, PostgreSQL revierte la operación completa.
- `operacion_id` queda registrado en `private.haiku_libro_incorporaciones`. Un reintento con la misma selección devuelve el resultado guardado. La función sólo puede ejecutarla una sesión autenticada.

No subir XLSX ni datos personales al repositorio.

## Prioridad del Libro al confirmar (septiembre 2026)

Esta sección reemplaza el comportamiento anterior de “Es la misma reserva” que sólo asociaba en la vista previa.

- **Es la misma reserva** prepara una actualización real de esa reserva: documento completo (incluidas letras del pasaporte), nombre, contacto, ocupación, estado y notas disponibles en el Libro. La categoría **Actualizar Proyecto H con el Libro** muestra valores anteriores y propuestos; sólo se escriben tras la confirmación final.
- Cuando CAB o fechas difieren, **Es la misma estadía: corregir CAB/fechas y datos con el Libro** reemplaza los datos de la estadía seleccionada. **Añadir esta estadía** continúa siendo una alternativa distinta. La disponibilidad y los bloqueos se validan en la transacción.
- Los pagos ya identificados inequívocamente en la reserva se actualizan con el monto, medio, fecha, identificadores y concepto conocidos del Libro. Un identificador de otra reserva o repetido con datos incompatibles permanece en revisión. Un pago débil no se sobrescribe por tener el mismo monto.
- El Libro tiene prioridad para los campos presentes. Un dato ausente no borra datos existentes ni se convierte en cero. Las notas de varias cabañas se combinan sin reemplazarse entre sí. Los detalles no estructurados y las solicitudes se conservan en observaciones; no se inventan importes o fechas para crear cargos de servicios.
- Nuevas reservas y estadías toman el estado conocido del Libro; si no está determinado, comienzan pendientes. Los pasaportes se guardan íntegros con un tipo de documento válido.
- Al volver de la pantalla de guardado se consulta nuevamente Proyecto H. Las actualizaciones ya aplicadas dejan de proponerse. Si los valores cambian después de revisar la propuesta, se exige prepararla de nuevo antes de sobrescribirlos.

### Validación con Yann y septiembre

1. Recargar el panel sin caché y cargar el Libro actualizado.
2. Pedir `Libro: compara septiembre 2026 con Proyecto H y prepara la incorporación de reservas y pagos faltantes`.
3. Para Yann, elegir **Es la misma reserva** sobre la referencia correcta. Pulsar **Preparar incorporación**.
4. Revisar **Actualizar Proyecto H con el Libro**: el pasaporte debe conservar todas sus letras y números; comprobar los cambios de correo y demás campos. Los cambios largos de notas comienzan plegados.
5. Confirmar únicamente la selección revisada. Comprobar el documento y los detalles en la ficha, y volver a comparar septiembre: los datos ya corregidos no deben volver a prepararse como actualización.
6. Con datos de prueba, un pago existente con identificador fuerte y monto distinto debe actualizar el mismo pago, sin crear uno nuevo. La reducción de monto ajusta su distribución entre cargos y deja historial. No permite reducir por debajo de devoluciones confirmadas.
7. Si se corrigen fechas, la vista explica que las noches nuevas usan tarifa de catálogo y que los pagos aplicados a noches retiradas quedan como saldo disponible. Se conservan los registros de pago y se guarda el historial de las aplicaciones ajustadas.

### Verificación realizada

`node --test tests/*.test.cjs`: 112 pruebas aprobadas. Incluye Libro anterior ↔ actual, preparación/confirmación, pasaporte y contacto, datos desconocidos, pagos existentes, conflictos, revalidación, notas multicabaña y estados iniciales.

`tests/haiku-libro-prioridad.integration.sql`: prueba transaccional con identidades y referencias únicas de prueba. Comprueba persistencia, reintentos, rechazo de propuestas obsoletas, reversión completa ante errores, autenticación, reducción de pagos y aplicaciones, fechas/cargos, ocupación desconocida y creación con pasaporte y estado del Libro. Termina en `ROLLBACK`; no conserva registros de prueba.

Migraciones aplicadas: `20260908162301_haku_libro_prioridad_confirmada.sql`, `20260908164059_haku_libro_estado_confirmado.sql` y `20260908164318_haku_libro_validar_campos_conocidos.sql`. La RPC conserva autenticación, permisos existentes e idempotencia. Los dos auxiliares nuevos son privados y no ejecutables directamente por `anon` ni `authenticated`.
