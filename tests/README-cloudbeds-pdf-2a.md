# Cloudbeds PDF 2C — certeza y propuestas de tarifa (sólo lectura)

## 1. Archivos y alcance

2C extiende el parser flexible 2B en `js/haiku-cloudbeds-pdf-v1.js`, sus pruebas
y el fixture local. No añade RPC, migración, upload, escritura Supabase ni acción
de UI que cambie datos. `actualizacion.disponible` y
`propuesta.actualizacion_disponible` siempre son `false`.

El PDF se procesa localmente. `consultar()` sólo hace `SELECT` paginados sobre
`reservas` y `vista_saldos_alojamiento_reserva`; un error de lectura aborta antes
de clasificar registros como ausentes.

## 2. Motor de clasificación

Cada fila produce una `propuesta` explicable con identidad Cloudbeds, reserva
Proyecto H, cabaña/fechas, cuatro señales financieras separadas, productos,
diferencia, evidencias, observaciones y una certeza:

- `ALTA_CERTEZA`: hay cambio propuesto y todas las señales mínimas concuerdan.
- `SIN_CAMBIO`: mismas garantías, pero Depósito y Proyecto H difieren hasta $5.
- `REVISION_MANUAL`: la fila es legible, pero alguna decisión no es inequívoca.
- `NO_APLICA`: cancelada; no genera propuesta aunque exista Depósito histórico.
- `NO_IDENTIFICADA`: no se pudo asociar una reserva accesible.

Se conserva `clase` como compatibilidad con el informe 2B, pero la decisión 2C se
expresa en `certeza`. El resumen UI muestra Coinciden, Propuestas seguras,
Revisión manual, Canceladas/no aplica y No identificadas.

## 3. Reglas exactas de alta certeza

Se exige simultáneamente:

1. coincidencia única por un identificador Cloudbeds ya vinculado;
2. una reserva y una estadía, no agrupada;
3. una sola habitación Cloudbeds, mapeable a una cabaña;
4. check-in, check-out y cabaña idénticos a Proyecto H;
5. estado Cloudbeds conocido, no cancelado ni no-show;
6. Depósito entero CLP positivo;
7. Precio Total entero CLP positivo;
8. columna Productos presente;
9. si Productos está vacío, Precio Total ≈ Depósito (tolerancia $5);
10. si hay Productos, Precio Total > Depósito + $5;
11. total efectivo de alojamiento disponible en Proyecto H;
12. ausencia de contradicciones financieras.

El nombre no sustituye al identificador fuerte. El fallback exacto de nombre +
cabaña + ambas fechas sólo permite `REVISION_MANUAL`, aunque sea único.

## 4. Casos que requieren revisión

Entre otros: identidad débil o múltiple, identificadores cruzados, ID duplicado
en el PDF, no-show, multihabitación, reserva agrupada, varias estadías, falta de
habitación/fechas, Depósito ausente/cero/negativo, Precio Total ausente o menor
que Depósito, Productos ausente, Productos vacío con diferencia relevante,
productos declarados sin componente adicional, total Proyecto H no disponible o
señales financieras contradictorias. No se reparte un total global entre
cabañas.

## 5. Productos ausente frente a vacío

`productos_columna_presente` se deriva de la cabecera, no del texto de la celda.
Por tanto:

- columna presente + celda vacía: evidencia explícita de que el export no declara
  extras; puede alcanzar alta certeza si Precio Total ≈ Depósito;
- columna ausente: no permite asumir que no existan extras y obliga revisión.

`productos_lista` sólo separa rótulos para mostrarlos. No asigna precios por
producto ni afirma que la diferencia corresponda a un desglose individual.

## 6. Uso de Depósito

Por regla específica confirmada para Haiku Cabañas, Depósito representa 100% del
alojamiento bruto final con IVA y puede cubrir una o varias noches. Es el único
candidato 2C: `deposito_100_alojamiento_haiku_cabanas`. Nunca se reconstruye a
partir de otra columna. Fuera de `ALTA_CERTEZA`/`SIN_CAMBIO`,
`total_alojamiento_propuesto` queda `null`.

## 7. Uso de Precio Total

Precio Total se trata como alojamiento + productos/extras. Sin productos debe
coincidir con Depósito dentro de $5. Con productos debe ser superior; su
diferencia con Depósito se muestra como `componente_no_alojamiento_observable`.
Nunca se propone Precio Total como alojamiento.

## 8. Uso de Productos

Productos es evidencia de conceptos adicionales y permanece fuera del total de
alojamiento. La UI muestra los rótulos y la diferencia global observable, sin
inventar importes individuales.

## 9. Uso de Total habitación e IVA

Total habitación es una señal secundaria, aproximadamente neta en los casos
observados. `round(total_habitacion × 1,19)` puede corroborar Depósito con
tolerancia de $5, pero no es requisito universal, no se convierte en fuente y no
se usa para escribir. Si no coincide y el resto sí, se explica la falta de
corroboración sin degradar automáticamente. Si es no positivo o supera el
Depósito de forma material, sí constituye contradicción. Su ausencia no invalida
una propuesta inequívoca.

Saldo Pendiente es únicamente deuda restante y nunca participa como tarifa.

## 10. Canceladas y no-show

Una cancelada es `NO_APLICA`: conserva datos históricos, pero no presenta total
propuesto. Un no-show queda en `REVISION_MANUAL`, porque su tratamiento financiero
no se presume.

## 11. Multihabitación y grupos

Filas como `LC4(1), C10(1)` o `LC2(1), CD7(1)` siempre quedan en revisión, incluso
si Precio Total y Depósito coinciden. Lo mismo ocurre con grupos o múltiples
estadías de Proyecto H. 2C no inventa una distribución por segmento.

## 12. Auditoría ID versus Reserva

Cloudbeds exporta `ID` (Reservation ID) y `Reserva` (Reservation Number) como
campos distintos; el parser los conserva como `id_cloudbeds` y
`reserva_cloudbeds`. Que sus textos sean diferentes no es por sí mismo un error.
Ambos se contrastan contra vínculos existentes; si apuntan a reservas distintas,
el caso se revisa. No se crean vínculos nuevos.

Referencias Cloudbeds:

- [Data Fields: definitions and calculations](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/6621695765531-Cloudbeds-Data-Fields-CDFs-definitions-and-calculations)
- [Reservations Management: flexible exports](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/43663431474715-Reservations-Management-Filtering-and-Flexible-Exports)

## 13. Qué guarda `reservas.cloudbeds_id`

La ruta de importación de listado
`supabase/functions/haiku-asistente-listado-reservas-cloudbeds-v2/index.ts`
copia explícitamente la columna `Reserva` a `cloudbeds_id`; el comentario del
cliente histórico confirma la misma decisión. Otros flujos antiguos presentan
el campo sólo como “ID Cloudbeds”, y el esquema tiene una sola columna sin tipo.
Por ello 2C prioriza una coincidencia exacta de `Reserva`, acepta un vínculo
histórico exacto por `ID` como evidencia legada y bloquea cruces ambiguos.

## 14. Modelo financiero actual

`vista_saldos_alojamiento_reserva` agrupa `vista_estado_cargos` por reserva y sólo
incluye cargos activos de tipo `alojamiento`:

- `total_alojamiento = sum(monto_ajustado)`;
- `pagado_alojamiento = sum(aplicado_neto)`;
- `saldo_alojamiento = max(total_alojamiento - pagado_alojamiento, 0)`.

Servicios quedan fuera. Cambiar tarifa modifica el total contractual materializado
en noches/cargos. Cambiar saldo no es equivalente: el saldo también depende de
pagos y aplicaciones. 2C compara el Depósito con `total_alojamiento`, nunca con
`saldo_alojamiento`.

## 15. Situación de TOTAL 1 / v31

La migración rastreada vigente es
`20260910235134_haiku_total_financiero_v31_guard_servicios.sql`; la documentación
de la fase registra v31 como desplegada. Esta auditoría fue sólo local y no
consultó producción.

v31 mantiene un writer transaccional por lote con locks, expected total,
permisos, plan previo, auditoría e invariantes. Requiere una sola estadía y una
estructura financiera inequívoca. Para alojamiento sin ajustes, una noche recibe
el total objetivo completo. Varias noches uniformes/completas reciben cociente y
residuo determinista, ordenado por fecha/id; tarifas variables o noches
incompletas se bloquean. En casos con IVA usa el plan financiero/IVA vigente.

Los pagos originales se conservan; las `pago_aplicaciones` pueden liberarse y
reaplicarse dentro de la transacción para respetar capacidad, con guards de
sobrepago, devoluciones, servicios y destinos ambiguos. Esto confirma que cambiar
un total no equivale a editar pagos ni a imponer un saldo.

`supabase/preparadas/` contiene antecedentes históricos y quedó completamente
fuera de esta fase. No debe usarse para reemplazar v31.

## 16. Diseño recomendado para una futura escritura

Una fase posterior debería tomar sólo propuestas `ALTA_CERTEZA`, exigir revisión
humana y acción explícita, volver a leer identidad/estructura/total, obtener la
capacidad y preview v31, comparar un snapshot inmutable y recién entonces llamar
al writer vigente una sola vez. El payload futuro debe usar Depósito como
`total_objetivo`, no Precio Total ni Total habitación, y registrar fuente,
identificadores Cloudbeds, evidencia, versión del parser/writer y usuario.

## 17. Riesgos pendientes

- `cloudbeds_id` legado no declara si contiene Reservation ID o Number.
- La regla Depósito=100% es contractual de esta propiedad, no genérica.
- Faltan validaciones con una muestra operativa amplia de tratamientos fiscales.
- Multihabitación/grupos no tienen distribución Cloudbeds inequívoca.
- Una futura escritura deberá revalidar concurrencia, permisos, pagos,
  aplicaciones, servicios, IVA e invariantes de v31.

## 18. Pruebas

La suite cubre los 23 puntos pedidos: casos A–G, contradicciones, Productos
presente/ausente, Depósito/Total habitación ausentes, IVA corroborativo y no
corroborativo, ID/Reserva, fallbacks único/ambiguo, una/múltiples noches, orden,
alias `Núm. habitación`, convivencia Haku+Inspector y prohibición de writes.
También conserva regresiones 2B de PDF ancho, columnas desconocidas, varias
páginas, timeout, XSS y paginación.

Comandos principales:

```powershell
node --test tests/cloudbeds-pdf.test.cjs
node --test tests/haku-reserva-convivencia-v1.test.cjs
node tests/cloudbeds-pdf-demo-browser-check.cjs
```

Las regresiones TOTAL/pagos/Inspector se ejecutan con los tests locales
correspondientes; los scripts PostgreSQL dependientes de un runtime efímero sólo
se ejecutan cuando ese runtime está disponible. Ninguna prueba 2C conecta a
Supabase real.

## 19. Demo local

Se reutiliza el fixture 2B, actualizado a 2C:

```powershell
node tests/cloudbeds-pdf-demo-server.cjs 4174
```

Abrir `http://127.0.0.1:4174/tests/fixtures/cloudbeds-pdf-flexible/`.

Permite recorrer diez casos ficticios, ver certeza, propuesta, componente no
alojamiento, evidencias, parser compacto/ancho y presentación responsive. No
incluye cliente Supabase. El browser check guarda capturas únicamente en la
carpeta temporal del sistema (`haiku-cloudbeds-pdf-2c-capturas`), nunca en
`tests/artifacts/`.
