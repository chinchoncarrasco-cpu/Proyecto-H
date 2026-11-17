# Haku: Concepto de los comprobantes del Libro

Revisión del 17 de noviembre de 2026. Rama local `codex/haku-concepto-comprobantes-revision`, sobre `16d3f85` de `origin/main`. La rama `codex/haku-alojamiento-comprobante` y el commit `372b026` no estaban disponibles en los clones locales ni en `origin`. El cambio y las pruebas quedan en un directorio de trabajo separado.

## Qué aparece en la copia autorizada

Leí la copia local con el lector de Proyecto H. Incluí las 61 hojas mensuales y excluí plantillas y otras hojas auxiliares. El lector identificó 15.200 filas de origen, incluidas notas y detalles de bloque; 11.237 tenían Concepto. El SHA-256 del archivo fue igual antes y después de leerlo. Las cifras cuentan filas, no pagos únicos. No se cruzaron los comprobantes con cargos de producción.

| Familia observada | Filas | Ejemplos sin nombres ni identificadores de comprobante |
| --- | ---: | --- |
| Noches | 8.381 | `CAB1/1noche` (393), `CAB1/2noches` (381) |
| Cabaña sin noches explícitas | 109 | `CAB` seguido del número de cabaña |
| Abono o anticipo explícito | 1 | Una mención de abono |
| Promoción | 4 | `CAB2/promo` (2), `CAB3/promo` (1) |
| Full Day | 169 | `FullDay` (39), `Full Day` (3), `CAB1/FullDay` (27) |
| Servicio explícito | 2.013 | `Tinaja` (1.160), `Masajes` (195), `Late Check Out` (90) |
| Cabaña o noches con servicio | 14 | `CAB2/1noche + tinaja` (2), `CAB10/2noches+tinaja` (1), `CAB2/tinaja` (1), `CAB6/latecheckout` (1) |
| Penalidad en Concepto | 23 | `Penalidad` (21) |
| Reembolso en Concepto | 31 | `Reembolso` (26) |
| Resto | 492 | Otros conceptos, sin validar como pagos |

Cada fila se cuenta en una sola familia. Si hay solapamiento, se priorizan reembolso y penalidad, luego cabaña/noches con servicio, Full Day, promoción, servicio, abono, noches y cabaña. Las cuentas de los ejemplos corresponden al texto de Concepto normalizado. `CAB` con un servicio y sin noches ni cargo de alojamiento puede ser un cobro de servicio; la cabaña indica dónde se presta.

Al comparar la clasificación anterior con las reglas nuevas sobre esa copia, **19 filas cambian de tipo**: una de otro a alojamiento; ocho a mixto (siete antes alojamiento y una antes servicio); seis de alojamiento a servicio; y cuatro de alojamiento a revisión (mención de promo sin destino acreditado). Cambiar el tipo en la lectura no acredita el pago ni su aplicación.

`2adl/1noche`, `2 ADL / 1 noche`, `2 pax - 1 noche`, `Abono de reserva`, `Anticipo alojamiento`, `Promo Haiku / 2 ADL / 1 noche` y `CAB 10 / 1 noche / tinaja` son ejemplos sintéticos: ninguno aparece tal cual en la copia, incluso al ignorar mayúsculas y tildes. Los mixtos reales de la tabla tienen estructura comparable.

## De la celda a la preparación del pago

1. **Concepto.** `normalizarHoja` en `js/haiku-libro-semantica-v1.js` conserva el texto y la celda, lee los identificadores del comprobante y llama a `interpretarConceptoPago`. Los formatos acotados de noches y abono o anticipo apuntan a alojamiento. Si hay alojamiento y servicio, separa los componentes. La mención de una promo sola queda en revisión; si acompaña un concepto válido de alojamiento, no genera un descuento. La lectura no cambia `promocionReserva` ni las tarifas.
2. **Evidencia.** `evaluarMovimientoFinanciero` en `js/haiku-libro-lenguaje-natural-v1.js` distingue pago real, dudoso y nota. Respeta el sector y la estructura de la fila; una glosa de saldo, una mención de promo o un precio sin comprobante no se convierten en pago recibido.
3. **Reserva.** `resolverPagosExistentes` concilia pagos ya registrados. `verificarPagosDeBloque` en `js/haiku-libro-consultas-v1.js` cruza cabaña y fecha del bloque entre Reservas y Pagos del Libro y exige una estadía única de Proyecto H con las mismas fechas y tipo. Si el comprobante trae titular, comprueba que coincida con el Libro y Proyecto H. Un nombre abreviado sirve si no hay otra reserva compatible. Para tarjeta física verifica folio y BOVTAR o, en los nuevos formatos, folio y autorización explícita. Para WebPay verifica el código de autorización. El monto no desempata.
4. **Cargo y saldo.** `verificarPagosDeBloque` consulta los cargos activos que pertenecen a la estadía, comprueba su saldo y revisa duplicados, incluidos folio y autorización en pagos de tarjeta ya registrados. Si el conjunto de abonos supera el saldo, no se prepara. Para mixtos, `resolverPagoMixto` en `js/haiku-libro-pagos-destinos-v1.js` exige un desglose con importes explícitos que sumen el total. Identifica cada cargo por estadía y concepto antes de comprobar su saldo; un importe coincidente no elige entre cargos compatibles.

## Resultados y casos en revisión

- **Caso original ficticio:** débito de $144.000 con nombre abreviado, folio y autorización válidos y $160.000 de saldo. En los seis formatos de alojamiento ensayados se prepara un abono por $144.000, sin descuento ni ajuste de tarifa. Las pruebas recorren lectura, comparación, preparación y serialización, y no ejecutan la incorporación.
- **Controles.** Quedan en revisión una segunda reserva compatible, un titular incompatible, un identificador faltante, una autorización repetida sin conciliación, saldo insuficiente (incluido si baja antes de preparar), una promo sola y un concepto de noches para una reserva Full Day. Las pruebas focalizadas también cubren Full Day puro, servicios, penalidades y reembolsos.
- **Mixtos:** `CAB 10 / 1 noche / tinaja` sin desglose queda en revisión. Con $120.000 para alojamiento y $24.000 para tinaja, la prueba confirma ambos destinos y saldos. Se informa el dato faltante si los importes no suman, si Concepto y Detalle se contradicen, si un cargo falta, si hay varios compatibles o si su saldo es insuficiente. Incluso con ambos destinos comprobados, el sistema no prepara una escritura mixta: la incorporación existente solo admite un destino de alojamiento o un conjunto de servicios. No se desdobla un comprobante en pagos independientes.
- **Verificación:** 543 pruebas pasaron en la corrida focal final de 18 archivos. La primera corrida general quedó incompleta por falta de memoria; cuatro fallos de Airbnb y renovación de sesión se reprodujeron también en `16d3f85` sin cambios. No se publicó ni se modificaron pagos o tarifas reales.

## Pagos sin titular

Las pruebas con débitos ficticios incluyen folio, BOVTAR y un cargo de alojamiento con saldo comprobable.

| Formatos probados | Resultado sin titular |
| --- | --- |
| `CAB 10/1 noche` (débito completo de $72.000 y parcial de $36.000), `CAB10/2noches`, `Alojamiento`, `Arriendo` | Preparan el abono por cabaña y fecha si la estadía es única, el comprobante es válido y el importe cabe en el saldo. |
| `2adl/1noche`, `2 ADL / 1 noche`, `2 pax - 1 noche`, `Abono de reserva`, `Anticipo alojamiento`, `Promo Haiku / 2 ADL / 1 noche` | Usan la misma verificación por cabaña y fecha cuando el comprobante no trae titular. |

Se prepara un WebPay con código de autorización, pago recibido y destino comprobable. Si Proyecto H ya tiene el pago confirmado y conciliado, la fila queda omitida aunque el Libro conserve la glosa «por confirmar». Si la glosa indica que el pago sigue pendiente y no existe esa conciliación, queda en revisión.

Las pruebas inspeccionan el plan de incorporación y la operación que resultaría, sin registrar pagos.

## Revisión independiente del parche

Las coincidencias con un comprobante de tarjeta ya registrado en formato histórico quedan en revisión. Las noches con niños, mascotas o ADLT conservan su clasificación de alojamiento. Una cantidad de noches contradictoria requiere revisión y un CodAut explícito compuesto por letras se conserva.

Pasaron 1.637 pruebas del Libro y cuatro vistas de navegador. En PostgreSQL local, el abono ficticio de $144.000 dejó $16.000 de saldo de alojamiento y dos reintentos conservaron un solo pago y una sola aplicación. Las cifras de la copia autorizada corresponden al análisis previo a esta revisión.
