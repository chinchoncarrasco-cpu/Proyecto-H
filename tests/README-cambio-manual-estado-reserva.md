# Cambio manual de estado en Ver reserva

Rama: `feat/cambio-manual-estado-reserva`, desde `main` (`fabfe99`). La base
versionada estaba limpia. `.cd` y `supabase/.temp/` ya eran archivos no rastreados.
No se conectó producción ni se aplicó la migración a una base real.

El badge del drawer compartido de Resumen, Calendario y Reservas conserva su
estilo y abre seis opciones. Identifica la actual y explica las restricciones.
Pendiente, Confirmada, Cancelada y No Show abren una confirmación compacta que
muestra anterior → nuevo; Cancelar/Escape no escriben. Hospedado y Check-out
ejecutan directamente al seleccionar, sin mostrar el aviso «¿Estás seguro?».
Ambos caminos comparten la misma revalidación de identidad y snapshot,
bloqueo de doble clic y llamada a `haiku_cambiar_estado_reserva_manual_v1`.
El badge cambia tras respuesta y lectura verificadas del servidor. Los errores
normales conservan el badge anterior. Un conflicto `error.code === '40001'`
rechaza el cambio y relee/reconcilia el estado real, sin reintentar la escritura
ni depender del HTTP status. Un fallo de relectura se informa sin simular éxito.

| Estado canónico | Ruta y alcance |
| --- | --- |
| `pendiente` | Estadía exacta. Sin abono confirmado. La RPC operativa revierte a Confirmada (limpia check-in/check-out); el coordinador establece Pendiente y recalcula el estado global según las otras estadías. La confirmación explica la reversión. |
| `confirmada` | `haiku_cambiar_estado_estadia`, estadía exacta. Conserva la reversión oficial de check-in/check-out. No exige un abono nuevo ni crea pagos. |
| `hospedada` | Selección directa, sin aviso. `haiku_cambiar_estado_estadia`, estadía exacta. Conserva check-in y reversión de check-out oficiales. |
| `checked_out` | Selección directa, sin aviso. `haiku_cambiar_estado_estadia`, estadía exacta, incluida su protección temporal. No liquida pagos ni emite BOVE. |
| `cancelada` | `haiku_cancelar_reserva`, reserva completa. Conserva las estadías y datos históricos y libera disponibilidad. |
| `no_show` | Reserva completa. Desde las 00:00 de la fecha de ingreso de TODAS las estadías en `America/Santiago`; ninguna puede tener check-in/check-out o estado hospedada/checked_out. SQL compara `clock_timestamp()` con `fecha_ingreso::timestamp AT TIME ZONE 'America/Santiago'`. Libera disponibilidad, conserva pagos/cargos. |

Desde Cancelada se usa `haiku_reactivar_reserva_cancelada`, sólo a Pendiente
(sin abono) o Confirmada (con abono). La RPC conserva validaciones de cabaña
activa, bloqueos, reservas solapadas y ausencia de movimientos operativos.
El coordinador bloquea la reactivación de múltiples estadías, porque la RPC
existente recupera sólo una. Tampoco inventa una ruta de reactivación de No Show:
sus estados operativos quedan deshabilitados con una explicación.

La RPC nueva exige sesión/usuario activo, `reservas.ver` y `reservas.editar`
(o `reservas.cancelar` para Cancelada). Sólo `authenticated` tiene EXECUTE;
`PUBLIC` y `anon` no. No agrega permisos de escritura sobre tablas al cliente.
Bloquea reserva y estadías, compara el snapshot esperado (sólo su discrepancia
produce SQLSTATE `40001`; los demás errores conservan su código) y conserva la auditoría
oficial. Añade un evento manual a `eventos_auditoria` con usuario, anterior,
nuevo, alcance y snapshot previo, dentro de la misma transacción. Un fallo de
auditoría revierte la operación. No crea tablas de historial ni modifica Realtime.

Tras guardar se reconcilian las fuentes de reservas, Resumen, listado, Pagos,
historial, checkout y Calendario. Se vuelve a leer la ficha completa. Los cambios
siguen siendo UPDATE de las tablas existentes, por lo que conservan sus triggers
y las publicaciones Realtime ya configuradas.

## Dependencias y límites verificables

La cadena del repositorio no contiene el schema base completo ni la definición
de `haiku_cambiar_estado_estadia` ni los triggers base de auditoría de reservas.
La nueva migración es incremental sobre ese schema previo: requiere reservas,
reserva_estadias, cabanas, pagos, eventos_auditoria, helpers privados de permisos
y las RPC oficiales. No reemplaza la RPC ausente ni presupone sus reglas.

Para probar sin producción se usa PGlite en memoria con un fixture sintético.
Cancelación y reactivación cargan las migraciones reales del repositorio; la RPC
operativa ausente usa un doble explícito que verifica delegación, reversión y
rollback. **No verifica la regla temporal real de Check-out**, cuya definición
no está disponible. Antes de cualquier despliegue futuro deberá contrastarse
este contrato con un schema local fiel que contenga esa función. La migración
queda preparada y sin aplicar; la funcionalidad necesita ese backend instalado
para guardar, y falla sin hacer escrituras alternativas si la RPC no existe.

## Pruebas locales

```powershell
node --test --test-isolation=none tests/reserva-estado-manual.test.cjs tests/resumen-reserva-sites.test.cjs tests/ficha-estado-estadia.test.cjs tests/sites-reservas-v1.test.cjs
$env:HAKU_PGLITE_MODULE='<ruta al módulo @electric-sql/pglite>'
node tests/reserva-estado-manual-postgres.cjs
$env:NODE_PATH='<ruta a node_modules con playwright>'
node tests/reserva-estado-manual-browser-check.cjs
```

El browser harness usa Edge headless y bloquea toda la red. Carga el drawer y
CSS reales con RPC simulada. Comprueba escritorio 1440×1000 y móvil 390×844,
los seis estados, actual identificado, selección sin escritura para los cuatro
destinos con aviso, ejecución directa para Hospedado/Check-out, confirmación,
cancelación, mensaje anterior/nuevo, doble clic, errores, concurrencia, cabaña
grupal y restricciones de reactivación. Guarda capturas en TEMP. Los casos de
No Show usan timestamps controlados antes, exactamente en y después de las
00:00 de ingreso, incluidos los husos de verano/invierno y movimientos reales.
En PGlite se sustituye únicamente el reloj dentro de transacciones de prueba;
la migración entregada no admite un reloj controlado por el cliente. El browser
acredita `40001` con HTTP 200/409 y que P0001 con HTTP 409 no se reconcilia.

La validación inicial de la mejora aprobó 219 pruebas JS, 38 comprobaciones SQL
PGlite y 40 de Edge, incluida la regresión de ficha/BOVE, finanzas, Pagos,
Historial, Aseo Full/Express, revisión, resúmenes, insumos y Realtime.

La corrección de No Show y SQLSTATE aprobó **36 pruebas JS**, **49 comprobaciones
SQL PGlite** y **64 de Edge**. Incluye los límites temporales, bloqueos operativos,
estado esperado correcto/obsoleto, rollback y códigos de errores ajenos al
conflicto, así como la relectura por `40001` sin éxito ni reintento automático.
HTML/CSS no cambiaron con estas correcciones. Sintaxis JS y `git diff --check`
sin errores. Todo quedó sin commit ni push; la migración sólo se ejecutó dentro
de la base WASM efímera de prueba.

## Demo visual interactiva aislada

Desde `C:\Users\sandr\Documents\Haiku`:

```powershell
node tests/reserva-estado-manual-localhost.cjs
```

Escritorio: **http://127.0.0.1:4174/**. Vista móvil de 390 px dentro del navegador:
**http://127.0.0.1:4174/movil**. También se puede abrir la primera URL en la
emulación móvil del navegador. `Ctrl+C` detiene el servidor.

Pulsa **Ver reserva**, el badge y un estado nuevo. Hospedado y Check-out se
ejecutan directamente. Los otros cuatro destinos muestran **actual → nuevo**;
Cancelar/Escape no cambian nada y Confirmar actualiza la ficha y la tarjeta
simuladas. Reiniciar demo o recargar restaura Confirmada.

La página de prueba reutiliza el drawer, el modelo y los estilos del repositorio.
El mock de `tests/fixtures/reserva-estado-demo/demo.js` permite todas las
transiciones para revisión visual, dejando el estado actual identificado.
**No demuestra que una transición esté permitida por las reglas operativas**;
éstas no se modifican. El aviso es visible tanto en la página como en la ficha.
Los seis destinos se pueden recorrer, incluso tras Cancelada o No Show.

No carga SDK, credenciales ni cliente de producción; no necesita Supabase ni el
Resumen completo. El método `rpc` es una función JS local: no existe llamada
remota. Todo es ficticio y vive en memoria por pestaña, sin localStorage ni
escrituras en disco/base de datos. El servidor sólo escucha en `127.0.0.1`,
sirve una lista explícita de assets y rechaza métodos de escritura. CSP incluye
`connect-src 'none'`. El servidor de insumos anterior se conserva intacto.

Prueba de aceptación de la demo, con el Playwright local usado por el otro harness:

```powershell
$env:NODE_PATH='<ruta a node_modules con playwright>'
node tests/reserva-estado-manual-demo-browser-check.cjs
```

Comprueba HTTP aislado, ficha completa, seis destinos, confirmación/cancelación,
Hospedado/Check-out sin aviso, badge sin cambio previo a confirmar para los
otros cuatro destinos, reabrir, reiniciar, recargar, escritorio,
móvil y la vista móvil embebida. Las capturas quedan en TEMP.

Validación inicial de la demo: **111 comprobaciones aprobadas** en HTTP + Edge, con
escritorio 1440×1000, móvil 390×844 y móvil embebido de 390 px. Sin errores JS
ni peticiones externas; SDK/configuración excluidos y métodos de escritura
rechazados. Sintaxis de los archivos nuevos y `git diff --check` sin errores.

## Ajuste final de UX: estados operativos directos

Hospedado y Check-out omiten exclusivamente el cuadro de confirmación. El
selector crea el mismo snapshot y ejecuta el flujo compartido de guardado:
revalidación de identidad/permisos, comparación del snapshot, RPC segura,
verificación del resultado y relectura/reconciliación posterior. Mientras se
procesa muestra «Actualizando estado…» y conserva el badge previo, sin pintura
optimista ni escrituras alternativas. Los otros cuatro destinos conservan
exactamente el cuadro actual → nuevo. No se modifican SQL, reglas operativas,
auditoría, RLS, Realtime ni estilos; la protección temporal real de Check-out
sigue delegada a la RPC operativa, con los límites de verificación ya descritos.

Validación del ajuste: **36 pruebas JS**, **49 comprobaciones SQL PGlite**,
**152 comprobaciones Edge de la ficha** y **117 HTTP/Edge de la demo**, todas
aprobadas. En escritorio/móvil se verifica que ninguno de los dos estados
directos muestre el aviso, que doble clic produzca una sola llamada segura,
que los rechazos operativos mantengan el badge, que pérdida de permiso o
identidad obsoleta impidan la RPC y que `40001` reconcilie sin reintentar.
La migración, el helper de reglas y los estilos se comprobaron idénticos antes
y después del ajuste. La demo reutiliza el flujo nuevo al recargar; comando y
URLs no cambian. Sin producción, commit ni push.
