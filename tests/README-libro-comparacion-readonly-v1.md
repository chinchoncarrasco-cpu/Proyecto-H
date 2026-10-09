# Comparación mensual canónica de sólo lectura — etapa 4B.1

Rama de trabajo: `codex/libro-comparacion-readonly`. Contrato v1,
`canonicalRevision = proyecto-h/libro-mensual-readonly/1-r1`.
Los cambios quedan sin staging. Esta etapa no agrega transporte remoto.

## Corrección contractual 4B.1-R1

El DTO público no expone IDs persistentes de Proyecto H: se retiraron `id`,
`reserva_id`, `estadia_id`, `grupo_reserva_id`, `servicio_id` y `cargo_id`
de estadías/candidatos, pagos, servicios, aplicaciones/cargos, bloqueos y
cancelaciones. No se identificó ninguna excepción imprescindible para
presentación. Los IDs siguen disponibles internamente para comparar;
las relaciones públicas utilizan únicamente los IDs de transporte existentes.
Los campos visibles, categorías, montos, diferencias y contadores se conservan.

Lenguaje natural identifica la semántica adaptada con
`Symbol.for('haiku.libro.lenguaje-natural.v1')`: propiedad no enumerable,
no configurable y no escribible, cuyo valor congelado conserva versión y
semántica base. `crearSemantica` reutiliza una adaptación existente y su
misma función `normalizar`; una WeakMap reutiliza también la adaptación de
una base suministrada repetidamente. Los correctores financieros siguen
usando su contexto de pagos canon correspondiente. `dependencias()` utiliza
esa misma semántica adaptada para fuente y motor, sin acumular capas.

Regresiones nuevas: verificación recursiva de IDs en todos los DTO y contextos,
inyección de IDs internos centinela sin alterar el resultado calculado,
inmutabilidad de la marca y tres núcleos en CommonJS/Web ya inicializado.
Incluyen consulta mensual, normalización de titular, Full Day, aplicación
financiera existente, bloqueos y cancelaciones. Las dos regresiones iniciales
fallaron antes del arreglo y pasan después. No se cambiaron reglas del motor,
renderer, writers, SQL ni historia Git. El ZIP anterior corresponde a la
revisión `/1`; esta corrección queda identificada como `/1-r1`.

## Arquitectura y entrada pública

La fuente entrega un Libro ya cargado, hojas extraídas/semánticas o bytes XLSX.
El núcleo adapta esa fuente, ejecuta **el mismo `consultar(...)`** de
`haiku-libro-consultas-v1.js` en un contexto aislado sin DOM y exporta un objeto
JSON convencional. No sustituye el flujo por una llamada a `compararSistema`.

```js
const R = require('../js/haiku-libro-comparacion-readonly-v1.js');
const nucleo = R.crearNucleo();
const dto = await nucleo.compararMes({
  fuente: { libro: entradaCanonicaYaCargada },
  cliente: clienteProyectoH,
  ahora: '2026-10-09T12:00:00Z'
});
const json = JSON.stringify(dto);
```

En Web: `HAIKU_LIBRO_COMPARACION_READONLY_V1.crearNucleo().compararMes(...)`.
Invocar después de cargar las dependencias canónicas de `panel.html`.
El objeto del núcleo sólo expone `compararMes`. La API del módulo también
expone `schemaVersion`, `canonicalRevision` y el exportador puro `exportar`.

Entradas de fuente aceptadas:

- `{ libro }`: API canónica cargada, con `listo`, `estado`, `listarHojas` y
  `consultarHoja`. Usa `consultarHojaMensual` cuando está disponible para evitar
  heredar un scope focalizado transitorio de la UI. No vuelve a corregir hojas
  que ya atravesaron los wrappers Web.
- `{ hojas: { Oct26: hoja } }`: celdas extraídas por el lector canónico, o
  semántica base del worker **antes** de los wrappers de pagos/lenguaje.
- `{ bytes, nombre?, version?, modifiedTime?, verifiedAt?, generacion? }`:
  `ArrayBuffer` o vista de bytes. Se copian los bytes antes de procesarlos.
  Requiere `lector`, creado por el mismo worker:
  `require('../js/supabase-libro-reserva-worker-v1.js').crearLector({XLSX, JSZip})`.
  Se inyectan las dependencias existentes; el modo Node no descarga librerías.

`ahora` permite fijar el reloj de tests. Sin él se usa el instante actual.
El mes se calcula en `America/Santiago`, no con el mes UTC. El parámetro
opcional `periodo: {desde, hasta}` permite un mes calendario completo explícito;
rechaza rangos parciales y años fuera de 2000–2099.

La obtención oficial de Google Drive sigue fuera de alcance. No se agregan
OAuth backend, endpoint, Edge Function, Mobile, caché persistente ni deploy.

## Cadena canónica conservada

1. OOXML/SheetJS del worker actual: geometría, merges, estilos y rich text.
2. `haiku-libro-semantica-v1.normalizarHoja`, sin copiar sus reglas.
3. `haiku-libro-pagos-canon-v1.corregirResultado`: medios, identificadores y
   agrupación de comprobantes distribuidos.
4. `haiku-libro-lenguaje-natural-v1.ajustarResultadoPagos` y su misma semántica
   de consulta: notas financieras, intenciones y reparación de titular/notas.
5. `haiku-libro-consultas-v1.consultar`: selección mensual, filtrado, geometría,
   asociación, agrupación multicabaña, pagos, aplicaciones y servicios.
6. Lectura informativa de cancelaciones y comparación directa/inversa de
   bloqueos, con la cobertura segura original.

En una fuente Web cargada, los pasos 1–4 ya pertenecen a `consultarHoja`.
`supabase-libro-reserva-v1` continúa siendo el dueño del lector/worker Web;
no se cambió ese archivo. La nueva adaptación no usa sus métodos de cargar,
guardar historial ni actualizar fuente. La UI focalizada conserva su flujo.

No se incluye el cálculo de incorporación ni la aplicación de decisiones
manuales persistidas de la UI. La comparación mensual se calcula desde su
evidencia canónica actual. Las resoluciones y aprobaciones siguen en sus
flujos Web existentes; esta frontera no las expone ni las ejecuta.

`serviciosDetalle` conserva los cinco estados del flujo mensual:
`en_sistema`, `diferente`, `faltante`, `revisar`, `con_reserva_faltante`.
No se reemplaza por la reconciliación especializada de `servicios-scope-v2`.
La clasificación por color, las fechas explícitas, las cortesías y la
agrupación de masajes siguen en la semántica original. No se modificaron
reglas de clasificación para hacer pasar las pruebas.

## Cálculo y presentación

Se extrae `modeloPresentacionComparacion(result)` de los filtros del renderer.
Web y DTO consumen esa función pura. El renderer, los handlers, la preparación,
la incorporación y la revisión manual permanecen disponibles en la API Web.
La fábrica `crearMotorLectura` retorna únicamente `consultar`, `interpretar` y
`modeloPresentacionComparacion`, antes de instalar DOM/listeners.

| Campo `presentacion` | Unidad / fórmula canónica |
|---|---|
| `gruposLibro` | `meta.libro` |
| `registrosDetectados` | `meta.libro_detectadas` |
| `reservasProyecto` | `meta.proyecto` |
| `estadiasAsociadas` | casos con `estado === asociada` |
| `estadiasValidas` | `meta.estadias_libro`, fallback visual Web 0 |
| `gruposAsociados` | `meta.asociadas` |
| `faltantes`, `ambiguas` | grupos de esos estados |
| `casosConDiferencias` | `meta.con_diferencias` |
| `gruposConDiferencias` | grupos asociados con diferencias |
| `pagosFaltantes` | detalles `nuevo_seguro` |
| `pagosRevisar` | detalles `revisar` o `diferente` |
| `serviciosRevisar` | detalles distintos de `en_sistema` |
| `advertencias` | avisos superiores de `result` |
| `advertenciasInformativas` | avisos informativos rotulados únicos |

La fracción Web es `estadiasAsociadas / estadiasValidas`. Los tests fijan
3 estadías / 3 válidas frente a 1 grupo; también 2 casos con diferencias
frente a 1 grupo/acordeón. Los campos desconocidos de `comparacion.meta` se
proyectan como `null`; el fallback visual no convierte cobertura desconocida
en una lectura completa.

## DTO JSON v1

```text
schemaVersion, intent, mode, canonicalRevision, generatedAt
status: ok | incompleto | error
error: null | {code, message}
periodo: {desde, hasta, etiqueta, timezone}
fuente: {tipo, nombre, version, modifiedTime, verifiedAt, generacion}
alcance: {tipo: registros_accesibles_sesion, hojas, comparacion}
comparacion: {items, grupos, meta}
pagosDetalle, serviciosDetalle, advertencias, cobertura, contexto, presentacion
```

El exportador usa listas explícitas de campos, sin serializar objetos internos
completos. `JSON.stringify(comparacion)` anteriormente perdía las propiedades
agregadas al Array; el DTO hace explícitas todas las colecciones necesarias.

- Items: `id`, estado/categoría/confianza/pregunta/motivo, Libro, Proyecto H,
  candidatos informativos, diferencias, `pagoIds` y `servicioIds`.
- Grupos: `id`, estado/categoría/confianza/pregunta, `itemIds`,
  `principalItemId`, cabañas, diferencias y referencias a detalles.
- IDs de transporte: `caso:1`, `grupo:1`, `pago:1`, `servicio:1`, según orden
  de este resultado. No son IDs persistentes ni claves de futuras escrituras.
  Los detalles llevan `itemIds` y `grupoIds`. El roundtrip JSON conserva las
  relaciones. Una relación ausente o ambigua falla con `RESULTADO_INVALIDO`.
  Son los únicos campos `id` permitidos: dentro de las cuatro colecciones de
  transporte. Los objetos `proyecto`, candidatos, cargos y contexto no tienen
  IDs de base de datos ni referencias persistentes.
- Pagos: estado general y resolución semántica
  `EXISTENTE_SEGURO/NUEVO_SEGURO/AMBIGUO/CONFLICTO`, monto/moneda/medio,
  clasificación, texto y referencias BOVTAR/CodAut/folio, motivos, diferencias,
  origen, aplicaciones del Libro y resumen visible del destino financiero.
  BOVE/Manager pendientes conservan la semántica canónica administrativa;
  no se inventa un pago cuando el flujo original los trata como nota.
- Servicios: estado mensual, evidencia visible del Libro y Proyecto H,
  catálogo visible, intención de cobro/color resumido, motivo y diferencias.
- Origen: hoja, celda, fila, columna, rango, merge y celdas disponibles.
- Cobertura: geometría/pagos por hoja, cobertura de pagos por caso,
  bloqueos de lectura segura y cabañas en revisión. Desconocido es `null`.
- Contexto: cadena canónica, advertencias informativas, bloqueos y
  cancelaciones, exclusivamente como evidencia para presentación.

No se exportan DOM/HTML renderizado, funciones, callbacks, tokens, sesiones,
clientes, planes, decisiones manuales, payloads de mutación ni snapshots
financieros completos. El texto original sigue siendo texto de evidencia;
un consumidor futuro debe representarlo como texto, no interpretarlo como HTML.

## Frontera de sólo lectura y errores

El motor recibe una fachada congelada de SELECT, nunca el cliente original.
Sólo admite ocho tablas del flujo: `reserva_estadias`, `reservas`, `pagos`,
`servicios`, `vista_estado_cargos`, `pago_aplicaciones`, `cabanas`,
`bloqueos_cabana`. Cada cadena empieza por SELECT; después sólo admite
`eq/in/lte/gte/order/range`. La sesión se reduce a `user.id` y nunca se exporta.
Las trampas RPC/insert/update/upsert/delete bloquean antes de delegar y
registran el intento, aunque el motor lo capture. No existe excepción para
RPCs: toda RPC queda bloqueada. La capacidad de red del cliente inyectado
sigue bajo responsabilidad del consumidor; esta fachada limita sus métodos,
no es un sandbox de código hostil ni cambia permisos RLS.

Toda lectura fallida se registra y aborta el DTO, incluso si el motor Web la
convierte internamente en revisión financiera o informativa. SELECT exitoso
con `data: []` sigue siendo una lectura vacía válida; `data: null` sin error
es una respuesta incompleta y falla. Los mensajes externos se sanitizan.

Códigos explícitos: `LIBRO_AUSENTE`, `LIBRO_INVALIDO`, `HOJA_AUSENTE`,
`ERROR_LECTURA`, `ERROR_SUPABASE`, `SESION_PERMISOS`,
`PERIODO_INCONSISTENTE`, `FUENTE_CAMBIADA`, `OPERACION_NO_READONLY`,
`RESULTADO_INVALIDO` y `COBERTURA_INSUFICIENTE`.
Un error retorna `status: error`, `comparacion/pagosDetalle/serviciosDetalle/
presentacion: null`; no contadores cero de supuesto éxito.
La cobertura insuficiente retorna `status: incompleto`, con lo conocido y
su error explícito. No debe presentarse como comparación completa.

El sello inicial copia nombre/version/generación/cargado/modifiedTime y
verifica cambios al finalizar, incluso con estado modificado in-place.
Metadatos desconocidos siguen siendo `null`. No obtiene hashes/versiones de
Drive ni detecta una alteración sin cambio de metadatos del proveedor.
`canonicalRevision` es una revisión contractual manual, no un hash automático
del working tree; debe actualizarse ante cambios incompatibles del contrato.

## Validación local — 2026-10-09

`node --test tests/libro-comparacion-readonly.test.cjs`: **66 PASS**, cero
fallos, cancelados, skipped o todo. Incluye 31 escenarios de paridad contra
`consultar` Web, JSON/refs, unidades, aplicaciones, warnings/cobertura,
errores, sesión/permisos, origen/rich text y recorrido del XLSX anonimizado.
Clientes instrumentados: cero mutaciones incluso con reservas, pagos y
servicios faltantes. Se prueban además intentos RPC y CRUD capturados por el
motor: quedan bloqueados antes del cliente y el DTO falla explícitamente.

Suite aplicable, selección reproducible en PowerShell:

```powershell
$taskTests = @(rg --files tests | Where-Object {
  [IO.Path]::GetFileName($_) -match '^(haiku-libro-|haku-libro-|libro-|haiku-servicios-(identidad|idempotencia)|servicios-hidratacion-contextos|sites-libro-v1|supabase-libro-google-carga).*\.test\.cjs$' -and
  $_ -notmatch 'postgres'
} | Sort-Object)
node --test @taskTests
```

**61 archivos, 1.174 PASS**, cero fallos, cancelados, skipped o todo.
Checks locales adicionales con Playwright/Edge:

- `tests/libro-comparacion-readonly-browser-check.cjs`: PASS 1100/390 px,
  seis casos × tres núcleos por runtime Web inicializado, misma semántica y
  función `normalizar`, paridad, DTO sin IDs persistentes y cero mutaciones.
- `tests/libro-reconciliacion-sistemica-browser-check.cjs`: PASS 1100/390 px,
  matriz previa 7/1/8/5, dos payloads previstos, error de notas inicial/final
  bloquea RPC, vínculo de sólo lectura y JS servido verificado por SHA-256.
- `tests/libro-jonathan-real-browser-check.cjs`: PASS 1100/390 px, XLSX
  anonimizado → worker → fecha explícita → tarjeta preparable.
- `tests/libro-masaje-fragmentos-browser-check.cjs`: PASS 1100/390 px,
  separadores/agrupación, colores, cortesías y fechas previas.

Se usaron librerías ya presentes en caché temporal, SheetJS 0.20.3,
JSZip 3.10.1 y Playwright. No se instalaron dependencias. Los tests bytes
requieren `HAIKU_LIBRO_WORKER_ASSETS` o la caché existente
`$env:TEMP/haiku-jonathan-real-xlsx`; sin ella no se presentan como PASS.
Los logs y capturas de navegador quedan fuera del repositorio, en TEMP.

`git diff --check`: PASS. Estado esperado: seis archivos existentes
modificados y cinco nuevos, todos sin staging, en la rama indicada.

## Límites y pendientes conservados

La paridad usa entradas y clientes controlados y un derivado XLSX anonimizado;
no verifica sesión/RLS remota, disponibilidad oficial de Drive ni una lectura
transaccional de todas las tablas. Hay controles de cambio de fuente, pero
no un snapshot transaccional frente a cambios concurrentes en Proyecto H.

No se ejecutan suites SQL/PGlite, writers ni concurrencia PostgreSQL en esta
etapa. Los tests de contratos que leen SQL como texto no equivalen a ejecutarlo.
Sigue pendiente `libro-resoluciones-postgres.test.cjs`, que referencia la
migration ausente `20261005051906_libro_resoluciones_ocupacion.sql`; el checkout
contiene `20261005191959_libro_resoluciones_ocupacion.sql`. No se corrige ni
ejecuta ese test como parte de este núcleo de lectura.

La diferencia anterior **34 vs. 41 hallazgos entre la copia restaurada y el
XLSX auditado de Drive sigue pendiente**, como documenta
`README-libro-reconciliacion-sistemica.md`. El fixture 7/1/8/5 y esta paridad
mensual no validan equivalencia entre esas fuentes ni entre flujos distintos.

Siguiente paso recomendado: revisar y aprobar externamente el contrato DTO
v1 y la evidencia de paridad antes de diseñar su transporte. No se realiza
ese paso ni se empieza otra etapa aquí.
