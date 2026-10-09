# Libro: reconciliación sistémica y estado del respaldo

Auditoría de cierre: 2026-10-09, America/Santiago.
Rama: `feat/libro-color-intencion-cobro`.
HEAD al iniciar el cierre: `40f28e0241d445a513069925abe8f692af919191`.

## Estado del respaldo

**Validaciones ejecutables de cierre: PASS.** El respaldo está autorizado
mediante commit y push de esta rama, sin PR, merge ni cambios en Supabase.
Los cuatro fixtures JSON/XLSX están anonimizados. El cierre final corrigió
exclusivamente estas referencias de fixtures y tests:

- `libro-servicios-color.cjs` cambió el titular de la celda, pero su función
  `configurar()` no cambiaba el titular del destino del fixture base. Ahora
  obtiene la reserva destino por el `reserva_id` de la misma estadía y alinea
  su titular ficticio. No cambia UUID, CAB ni relación reserva/estadía, ni
  inyecta una asociación: la asociación por nombre + CAB + fechas sigue
  pasando por producción y se comprueba explícitamente en el test.
- `libro-reconciliacion-sistemica-browser-check.cjs` conserva búsquedas por
  un item_id previo a anonimizar. Ahora ambas verificaciones del vínculo
  derivan el ID de `F.antes[12].item_id`, también usado para seleccionar la
  tarjeta. Se mantienen las aserciones de estado, payload nulo, revalidación,
  selección persistente, cargos intactos y cero RPC al vincular.

El browser check de masajes deriva el titular de cada fixture cargado y
alinea también el destino del caso con colores. Así distingue el fixture
base del derivado ficticio sin asumir que comparten el mismo nombre.

No se modificó lógica de producción durante la anonimización. Los hashes de
los tres JS coinciden con los capturados al iniciar el cierre.

## Alcance identificado

Al inicio había 9 archivos modificados y 13 nuevos, todos relacionados con
esta implementación. No se identificaron cambios ajenos. El cierre añadió
esta documentación; la anonimización posterior adaptó únicamente fixtures,
sus referencias en tests y añadió un contrato de privacidad.

Código modificado:

- `js/haiku-libro-semantica-v1.js`
- `js/haiku-libro-servicios-scope-v2.js`
- `js/haiku-servicios-identidad-v1.js`

Tests modificados:

- `tests/haiku-servicios-identidad-proveniencia.test.cjs`
- `tests/libro-late-existente-prioridad.test.cjs`
- `tests/libro-masaje-fragmentos-browser-check.cjs`
- `tests/libro-servicio-manual.test.cjs`
- `tests/libro-servicios-fechas.test.cjs`
- `tests/libro-servicios-noche-manual.test.cjs`

Tests nuevos:

- `tests/libro-jonathan-real-browser-check.cjs`
- `tests/libro-jonathan-real.test.cjs`
- `tests/libro-masaje-fecha-explicita.test.cjs`
- `tests/libro-reconciliacion-sistemica-browser-check.cjs`
- `tests/libro-reconciliacion-sistemica.test.cjs`
- `tests/libro-servicios-color-intencion.test.cjs`
- `tests/libro-fixtures-anonimizados.test.cjs`

Fixtures nuevos auxiliares:

- `tests/fixtures/libro-jonathan-real.cjs`
- `tests/fixtures/libro-reconciliacion-real.cjs`
- `tests/fixtures/libro-servicios-color.cjs`

Fixtures nuevos derivados y anonimizados:

- `tests/fixtures/libro-jonathan-real.json`
- `tests/fixtures/libro-jonathan-real.xlsx`
- `tests/fixtures/libro-reconciliacion-oct26-real.json`
- `tests/fixtures/libro-reconciliacion-oct26-real.xlsx`

Los diagnósticos, descargas completas del Libro, capturas, dependencias de
pruebas y paquetes ZIP de revisión están en directorios temporales externos
al repositorio. No forman parte del alcance para staging. Las copias privadas
y los mapas de correspondencias usados para anonimizar también permanecen
fuera del repositorio; nunca deben incorporarse al commit.

La búsqueda en archivos de texto del alcance no encontró patrones de claves
privadas, JWT ni tokens GitHub/AWS/Supabase secretos. Es una comprobación
orientativa, no una certificación de ausencia de secretos. La inspección OOXML
inicial detectó datos personales en ambos XLSX; la comprobación posterior de
privacidad valida los derivados anonimizados.

## Anonimización realizada

Se remapearon 56 nombres, 150 contactos/documentos y 156 UUID del snapshot.
Los emails usan `example.invalid`; los teléfonos son ficticios y los RUT
tienen formato conservado y dígito verificador deliberadamente inválido.
Reservas, estadías, notas, servicios y catálogo conservan sus relaciones
mediante UUID ficticios del espacio `00000000-0000-4000-9000-*`.

JSON y XLSX usan las mismas sustituciones. Se actualizaron hashes de archivo,
celda y XML, item_id derivados y marcas de origen. Los hashes de las fuentes
originales se conservan sólo como procedencia; no se presenta el derivado
como una copia literal ni se permite usar el original privado como entrada
alternativa de los tests de navegador.

Se conservan las 34/84 celdas respectivas, coordenadas, fechas, horas,
cantidades, merges, dimensiones y estilos. En OOXML sólo cambia el contenido
de los nodos de texto de `xl/sharedStrings.xml`; las demás partes y propiedades
de rich text permanecen iguales. El alias profesional de la glosa agrupada
usa un nombre ficticio del vocabulario contractual existente para conservar
la agrupación; no se modificó el parser ni se inventó un destino profesional.

Se revisaron las ocho partes de cada XLSX y sus comentarios ZIP. Estos
extractos conservan 68 declaraciones de hojas, incluidas las ocultas, pero
sólo contienen el XML de Oct26. No incluyen datos de las otras hojas,
docProps, autores, comentarios, personas, conexiones externas, macros ni
objetos incrustados. El contrato nuevo revisa todas las entradas del ZIP.

El replay final desde los derivados anonimizados conserva la matriz 7/1/8/5,
los dos payloads y los resultados de notas, tanto en Node como en navegador.

## Comportamiento preservado

La reconciliación busca servicios existentes antes de exigir todos los datos
necesarios para una creación. Sus cuatro clasificaciones son:

- `EXISTENTE_SEGURO`: identidad demostrada y compatible; `payload = null`.
- `CANDIDATO_EXISTENTE`: coincidencia única con evidencia insuficiente;
  requiere vínculo explícito y conserva `payload = null`.
- `CONFLICTO`: contradicciones, multiplicidad o asignación incompatible;
  bloquea la creación.
- `SIN_EXISTENTE`: sólo prepara una creación cuando la evidencia y sus
  dependencias están completas y verificadas.

Una coincidencia parcial por nombre no demuestra identidad de un repetible.
Una marca de origen no elimina contradicciones explícitas. Dos items
independientes no pueden reclamar el mismo servicio de Proyecto H. El vínculo
manual se revalida con usuario, evidencia, destino, servicio y catálogo; no
crea servicios ni cargos. Los cambios invalidan las decisiones antiguas.

Se conserva el amarillo inequívoco del fragmento como evidencia de cobro,
con prioridad del texto explícito. Rojo no equivale automáticamente a nota
o cortesía. Se conservan cortesías, coordinación, agrupación de masajes,
prioridad de fecha propia y Late Check-out único compatible sin hora declarada.

### Protección de notas

`cargarExistentes()` propaga el error SELECT de servicios y aborta también
ante un error SELECT de notas. Sólo una consulta exitosa puede devolver una
lista vacía válida. La revalidación final ocurre antes de confirmación y RPC:
si falla la lectura de notas, la selección anterior no permite incorporar.
Se muestra el error con indicación de reintentar.

## Validaciones finales después de anonimizar y corregir referencias

Suite aplicable: **60 archivos, 1.108 PASS, 0 FAIL, 0 skipped, 0 cancelled**.
Incluye las regresiones afectadas, sistémica, privacidad, fechas, colores,
masajes, Late, notas, idempotencia, hidratación y las regresiones del Libro
que consumen los módulos compartidos. Se ejecutó exactamente esta selección:

```powershell
$env:NODE_PATH=Join-Path $env:TEMP 'haiku-libro-medio-pago-validation/node_modules'
$tests = @(rg --files tests | Where-Object {
    [IO.Path]::GetFileName($_) -match '^(haiku-libro-|haku-libro-|libro-|haiku-servicios-(identidad|idempotencia)|servicios-hidratacion-contextos|sites-libro-v1|supabase-libro-google-carga).*\.test\.cjs$' -and
    $_ -notmatch 'postgres'
} | Sort-Object)
node --test @tests
```

Las tres comprobaciones siguientes pasaron en **1100 y 390 px**:

```powershell
$env:NODE_PATH=Join-Path $env:TEMP 'haiku-libro-medio-pago-validation/node_modules'
$env:HAIKU_RECONCILIACION_REPORT=Join-Path $env:TEMP 'haiku-cierre-final-20261009/sistemica-browser'
node tests/libro-reconciliacion-sistemica-browser-check.cjs
node tests/libro-jonathan-real-browser-check.cjs
node tests/libro-masaje-fragmentos-browser-check.cjs
```

Estas rutas son dependencias locales de esta ejecución, no dependencias
incluidas en Git. Se usó Edge headless y assets locales del worker en
`HAIKU_LIBRO_WORKER_ASSETS` o su directorio temporal predeterminado.

Resultados comprobados:

- Fixture auditado de 21 servicios: **7 EXISTENTE_SEGURO / 1 CANDIDATO_EXISTENTE /
  8 CONFLICTO / 5 SIN_EXISTENTE**.
- Sólo los items `F.antes[9]` y `F.antes[19]` conservan payload de creación:
  `srv:166z9x4` y `srv:yp7ku4` en el derivado anonimizado actual.
- Sus 21 notas conservan 1 lista, 16 existentes y 4 en revisión.
- Error SELECT de notas inicial: error visible, sin controles de incorporación,
  sin RPC ni escrituras.
- Error SELECT de notas durante revalidación: selección anterior bloqueada,
  **0 RPC de incorporación**; reintentar recupera los resultados normales.
- Consulta exitosa sin notas: lista vacía válida. Error SELECT de servicios:
  conserva su bloqueo.
- Joseph, Jonathan, Mayomi, Rocío y Javiera conservan las expectativas del
  fixture. Jonathan llega desde OOXML por el worker hasta la tarjeta preparable.
- Vínculo con existente sólo consulta. Decisiones obsoletas y reclamos dobles
  bloquean. La segunda incorporación simulada no vuelve a crear el servicio.
- Agrupación de masajes, colores, cortesías, notas y fechas mantienen sus
  regresiones; los JS servidos a las pruebas coinciden por SHA-256 con la rama.

`git diff --check`: PASS. Git muestra avisos de conversión LF/CRLF, sin errores
de whitespace. No se ejecutaron migrations ni se accedió a Supabase remoto.

Los tres JS de producción conservan los SHA-256 capturados antes de esta
anonimización y del cierre final:

| Archivo | SHA-256 del working tree |
|---|---|
| `js/haiku-libro-semantica-v1.js` | `0dab67129c940816cf05070e552caab00da61e03381e93592e77d0d9afa76aeb` |
| `js/haiku-libro-servicios-scope-v2.js` | `b1d5132c5c8c5014128e115fc522801f45616f38a4f0b44003f892e5b4ba615c` |
| `js/haiku-servicios-identidad-v1.js` | `9b4cd9d9cfcc4d34d434aba7643f19430345b06e364641afce41a793db6b6604` |

La auditoría de privacidad cubre el contenido completo de los 24 archivos
del alcance y todas las entradas de los XLSX; compara los identificadores
originales contra un mapa privado externo y busca patrones de secretos.
Se revisa también el diff staged y su correspondencia con el working tree.
No se incluyen mapas, originales privados, capturas ni paquetes de revisión.
El vocabulario nominal preexistente del parser y las menciones sintéticas
de profesionales en tests no representan registros ni asignaciones de
personas exportadas; los derivados JSON/XLSX usan sus alias ficticios.

### Límites de los tests

El navegador de prueba usa snapshots locales de Proyecto H y un writer
simulado. No valida la pestaña real, sus permisos RLS ni escrituras remotas.
La relectura frontend no es una transacción; cambios posteriores a la última
lectura permanecen sujetos a los locks y contratos SQL vigentes.

No se ejecutaron tests que aplican SQL en PGlite ni el test de concurrencia
PostgreSQL. Los contratos que inspeccionan archivos SQL como texto sí están
incluidos cuando pertenecen a la selección anterior; no son una ejecución
de esos writers. Permanecen pendientes:

- `tests/airbnb-libro-writers-postgres.test.cjs`
- `tests/haiku-libro-medio-pago-manual-postgres.test.cjs`
- `tests/haiku-libro-pagos-aprobacion-manual-postgres.test.cjs`
- `tests/libro-fullday-postgres.test.cjs`
- `tests/libro-resoluciones-postgres.test.cjs`
- `tests/libro-servicio-manual-postgres.test.cjs`
- La concurrencia real en PostgreSQL con dos sesiones.

`tests/libro-resoluciones-postgres.test.cjs` además referencia
`20261005051906_libro_resoluciones_ocupacion.sql`, inexistente en este checkout;
el archivo presente es `20261005191959_libro_resoluciones_ocupacion.sql`.
Ese test preexistente no se contabiliza como PASS. No se cambiaron sus rutas
ni se aplicaron migrations para completar el cierre.

## Diferencia de fuentes pendiente

**La copia local restaurada reportada por el usuario y el XLSX auditado de Drive
no están reconciliados ni se presentan como validados entre sí.** No se pudo
acceder a la pestaña real para verificar el archivo en memoria, su SHA-256,
generación, consulta original, versión ejecutada de JS ni desglose de existentes.

| Resultado | Pantalla reportada | Última auditoría de Drive |
|---|---:|---:|
| Servicios preparables | 1 | 2 |
| Servicios en revisión | 7 | 11 |
| Notas pendientes, nuevas y bloqueadas | 0 | 5 |
| Existentes | 26 sin desglose comprobado | 23: 7 servicios + 16 notas |
| Hallazgos | 34 | 41 |

La auditoría de Drive conserva 21 notas: 1 nueva, 16 existentes y 4 bloqueadas.
`nota:lgr17x` es nueva y seleccionable en esa auditoría; su estado en la
pestaña real sigue pendiente. Ocultar el bloque de notas no explica por sí
solo siete hallazgos menos, porque el total procede de `resultado.items.length`.

Fuente de esa última auditoría: `Libro de reservas actual 2025.xlsx`, hoja
`Oct26`, consulta `Libro: compara servicios de octubre 2026 con Proyecto H`.
SHA-256: `f463829fce2108937ea637da367e007af0debe590ff1706d9d4b0a9f446674c1`.
ModifiedTime de Drive: `2026-10-09T01:59:26.151Z`.
Snapshot de destinos capturado: `2026-10-09T02:25:30.207232+00:00`.

El fixture sistémico de 21 servicios procede de una versión anterior:
SHA-256 original `94a32a02ccfb81bbc157a7d2ef38b1313b83ac90ad855d5efe7b1d94e0801329`,
ModifiedTime `2026-10-08T22:53:46.408Z` y snapshot
`2026-10-08T23:01:59.140066+00:00`. Su matriz 7/1/8/5 no demuestra equivalencia
con otra copia del Libro ni con la consulta de 34 hallazgos.

Antes del merge siguen pendientes la comparación de la tarjeta real por
item_id y metadatos (34 vs. 41 hallazgos), las ejecuciones SQL indicadas y
la validación concurrente. El respaldo de la rama no cierra esos pendientes.
No se creó PR, merge ni una siguiente rama.
