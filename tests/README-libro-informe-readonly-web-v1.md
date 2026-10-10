# Etapa 4B.3 — Informe mensual Web de solo lectura

Implementación local en `codex/libro-informe-readonly-web`, desde
`3c3f99f222647302e9c4f6a974fcd488df7a81b1` (HEAD/main/origin/main al iniciar).
Entrada: `libro-comparacion.html`, con rutas relativas compatibles con
`/Proyecto-H/libro-comparacion.html`. No se ha publicado ni desplegado.

## Arquitectura y dependencias reales

La página ejecuta: sesión Web existente → validación de acceso Haku → OAuth
Google explícito del operador → fuente oficial 4B.2C → comparación mensual
4B.1-R1 → M2 → revalidación de sesión/permisos/handle → presentación del DTO.
El código productivo no contiene fixtures ni clientes simulados.

Orden de carga: SDK Supabase y `supabase-client.js`; lector canónico;
semántica; tarifa Full Day; pagos canon; lenguaje natural; destinos de pagos;
cancelaciones; bloqueos; consultas; núcleo readonly; fuente oficial;
conector Google; controlador del informe. El lector se carga antes de los
adaptadores para que pagos/lenguaje envuelvan el objeto que usa realmente el
navegador. Se conserva la idempotencia de lenguaje natural de R1.
El worker XLSX/JSZip/SheetJS es el mismo del visor existente.

No se cargan `panel.html`, `index.html`, controladores de incorporación ni un
iframe. El módulo de consultas exporta el motor canónico, pero el marcador
`data-libro-informe-readonly="1"` impide instalar su UI/handlers de Haku.
Las definiciones antiguas de escritura de ese módulo no se invocan.

## Autenticación y autorización

Se reutiliza `haikuSupabase`, sin cliente nuevo, service role ni credenciales
administrativas. Se comprueba `getSession()`, se valida el usuario con
`getUser()` y se invoca exclusivamente el RPC de lectura
`haiku_sesion_actual`. Se exige usuario activo y los permisos existentes
`reservas.ver`, `pagos.ver` y `servicios.ver`. No se inventan permisos ni RLS.
Una comprobación final de sesión evita cambios de propietario durante el gate.

La página remite al login canónico `panel.html`: ese loader obtiene el HTML
base de `index.html` e inyecta `supabase-client.js` y `supabase-auth.js`.
`index.html` por sí solo no instala el login Supabase. El informe no copia
formularios ni instala el módulo de login/recuerdo de correo. Después de
iniciar sesión en el panel, «Atrás» vuelve al informe, que revalida la sesión
del mismo sitio mediante el cliente canónico y su `haiku-supabase-auth`.
No se añaden parámetros de retorno, tokens ni credenciales a las URLs.
El botón Comprobar acceso permite
reintentar. Los eventos de autenticación limpian inmediatamente el resultado;
la revalidación asíncrona se difiere con `setTimeout(..., 0)`, fuera del callback
de Supabase. Una renovación del mismo usuario conserva OAuth, limpia el Libro
y exige revalidación. Logout/cambio de cuenta también desconectan Google.
Se verifica el propietario nuevamente antes de mostrar el DTO, incluso si no
llegó un callback de autenticación. Los errores de signOut se muestran de
forma segura después de limpiar el informe.

Referencias oficiales del contrato de autenticación:
[getUser](https://supabase.com/docs/reference/javascript/auth-getuser) y
[onAuthStateChange](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).

## Procedencia, vigencia y concurrencia

Se usa exclusivamente `HAIKU_LIBRO_GOOGLE_V1` y su OAuth Client ID, File ID y
scope readonly ya existentes. Conectar/renovar requiere una acción explícita;
comparar no abre OAuth, no pide tokens y no admite URL, archivo manual,
periodo arbitrario ni fuente suministrada por el consumidor.

`obtenerFuenteVerificada()` produce un handle opaco. `fuenteVerificada(handle)`
entrega el lector sellado: M0, descarga acotada a 8 MiB, checksums, M1 y
coincidencia de SHA-256/generación del lector. La página verifica tipo de
fuente y hash/generación del DTO. `verificarVigencia(handle)` hace M2 antes
de mostrar nada; después se revalidan acceso y handle. Se conservan los
contratos y límites de 4B.2C sin alterar el DTO ni el motor 4B.1.

Cada operación pertenece a una revisión y un usuario. Se bloquea doble
pulsación; una respuesta antigua no puede sobrescribir el handle de una
consulta posterior. El evento aditivo `haiku:libro-fuente-invalidada` contiene
sólo un código, nunca metadata/tokens/huéspedes. Limpieza, carga manual,
cambio/expiración de Google, M2 fallido y pérdida de procedencia retiran el
informe. El observador no puede impedir la invalidación de 4B.2C.

Connect conserva la sincronización inicial del conector existente: su copia
queda en memoria, todavía sin autoridad para este informe. Comparar obtiene
la fuente verificada por separado. Un guard exclusivo del modo dedicado
comprueba la revisión de autorización después de metadata, body y entrega:
un body tardío de Connect no puede recargar el lector después de logout.
La regresión falló antes del guard (`cargado: true` en vez de `false`) y pasó
después en los cuatro anchos. El Web normal conserva su comportamiento.

`pagehide` cancela, limpia, desconecta y retira suscripciones/timers. Un retorno
desde BFCache recarga la página. No se reutiliza un informe de otra cuenta.

## Memoria y flujo readonly

`data-libro-modo="informe-readonly"` activa
`informe-readonly-solo-memoria` en el lector. `persistenciaPC` es falso incluso
a 1100 px: no abre/restaura IndexedDB, no guarda XLSX, historial ni versiones.
Se usa el worker/consulta semántica real sin renderizar el visor. El timestamp
Google de esta ruta se conserva en memoria, no en localStorage. Los errores
del lector dedicado no imprimen el contenido original a consola.

XLSX, DTO, notas, pagos y datos de huéspedes permanecen en memoria/DOM durante
la consulta. No se exportan a URL, storage, logs, analytics ni deep links.
La persistencia de la sesión de autenticación del cliente canónico sigue
siendo la existente; no se promete que las credenciales de login desaparezcan
del storage por abrir esta página. El modo normal del visor mantiene su
IndexedDB y se verificó restauración/historial/borrado sin regresiones.

El núcleo usa su fachada SELECT y la envoltura del controlador impide iniciar
nuevas lecturas de una consulta obsoleta. No hay preparación, payload de
incorporación, aprobación manual, acciones financieras ni RPC mutativas.
El único RPC es `haiku_sesion_actual`; signOut/revocación OAuth son acciones
de autenticación. La evidencia de cero mutaciones corresponde al flujo del
informe, no a una afirmación de que todo el navegador sea incapaz de escribir.

## Presentación y estados

CSS propio: padding 11 px, gaps 5 px, título 15 px, métricas de tres columnas,
filas de acordeón de 36 px, verde y ámbar suaves, bordes finos. Sin overflow
horizontal ni scroll vertical anidado. Todos los acordeones comienzan cerrados
y varios pueden abrirse juntos; la revisión de vigencia no vuelve a cerrarlos.

Los números proceden de `dto.presentacion`: hero estadías asociadas/válidas;
grupos asociados/Libro/con diferencias se explican aparte. Desconocido se
muestra como `—`, nunca como cero inventado. Coincidencias contiene grupos
asociados y puede tener diferencias; no significa igualdad de todos sus campos.
Pagos/Servicios muestran todos sus estados canónicos y el badge cuenta los que
requieren revisión. Advertencias separa las informativas, sin sumarlas al
contador canónico de advertencias.

Se presentan reservas, candidatos, motivos/diferencias y valores disponibles;
pagos, comprobantes, aplicaciones, destinos/cargos; servicios y su evidencia;
notas y contexto de cobertura, bloqueos y cancelaciones. Se usan relaciones
de transporte del DTO sólo internamente, sin imprimir IDs persistentes.
Hoja/celda/rango aparecen en subdetalles técnicos inicialmente cerrados.
Todo dato se inserta con `textContent`, sin HTML de entrada ejecutable.

Estados explícitos: sin sesión, error de sesión/permisos, Google desconectado,
listo, verificando fuente, comparando, verificando vigencia, completo,
incompleto, error de fuente/comparación, archivo modificado, consulta obsoleta
y destruido. `status: error` no produce contadores exitosos. `incompleto`
conserva cobertura/advertencias; M2 fallido descarta el resultado. Una consulta
nueva retira inmediatamente la tarjeta anterior.

## Archivos de esta etapa

Nuevos (6):

- `libro-comparacion.html`
- `css/sites-libro-comparacion-readonly-v1.css`
- `js/sites-libro-comparacion-readonly-v1.js`
- `tests/libro-informe-readonly-web.test.cjs`
- `tests/libro-informe-readonly-web-browser-check.cjs`
- Este README.

Modificados (4):

- `js/supabase-libro-reserva-v1.js`: modo de memoria, lector sin visor y errores seguros.
- `js/supabase-libro-google-readonly-v1.js`: timestamp en memoria, señal de invalidación y guard de descarga tardía dedicado.
- `js/haiku-libro-fuente-oficial-v1.js`: observador opcional de invalidación sin datos sensibles.
- `js/haiku-libro-consultas-v1.js`: opt-out de instalación UI en la página dedicada.

Sin cambios a worker, semántica, pagos canon, lenguaje, DTO readonly,
backend Drive 4B.2B, escritores, migrations, RLS, panel, OAuth Client ID,
Haku-Mobile ni fixtures. No staging, commit, push, merge, despliegue ni
consultas a Google/Supabase productivos.

## Validación offline — 09/10/2026

`node --test tests/libro-comparacion-readonly.test.cjs tests/libro-web-fuente-oficial.test.cjs tests/libro-informe-readonly-web.test.cjs`:
**211 PASS / 0 fail / 0 skip** (66 + 88 + 57 nuevas).

Suite aplicable: **1.381 PASS / 0 fail / 0 skip**, 58 archivos. Selección exacta
en PowerShell, sin suites PostgreSQL:

```powershell
$taskTests = @(rg --files tests | Where-Object {
    [IO.Path]::GetFileName($_) -match '^(haiku-libro-|haku-libro-|libro-|haiku-servicios-(identidad|idempotencia)|servicios-hidratacion-contextos|sites-libro-v1|supabase-libro-google-carga).*\.test\.cjs$' -and $_ -notmatch 'postgres'
} | Sort-Object)
node --test @taskTests
```

Browser checks ejecutados con Edge headless local y Playwright en caché:

- `node tests/libro-informe-readonly-web-browser-check.cjs`: **320/360/390/1100 PASS**. Página real bajo `/Proyecto-H/`, XLSX anonimizado → worker → semántica → núcleo → M2 → tarjeta. Además, renderer de los 31 casos canónicos, datos desconocidos, escape, acordeones, error M2, cambio de usuario/logout y body tardío. Cero writers, aperturas de IndexedDB o escrituras de storage en el informe; una copia antigua precargada no se restaura. Regresión R1 adicional **390/1100 PASS**: sin sesión → enlace real → `panel.html`/loader/cliente/auth canónicos → login ficticio → «Atrás» → informe con sesión revalidada, sin tokens en URL ni OAuth automático. Sólo el SDK/red de auth y los módulos de negocio ajenos al login del panel se aíslan; no se simula el formulario ni el loader. El panel conserva su recuerdo canónico de correo ficticio, fuera del gate de cero persistencia de datos del informe.
- `node tests/libro-comparacion-readonly-browser-check.cjs`: **1100/390 PASS**, 6 casos × 3 núcleos, paridad Web, semántica idempotente y DTO sin IDs persistentes; cero mutaciones.
- `node tests/libro-web-fuente-oficial-browser-check.cjs`: **1100/390 PASS**, fuente/lector reales, M0/M1/M2, carga manual/limpieza/401/respuestas tardías, cero escrituras/tokens exportados.
- `node tests/sites-libro-browser-check.cjs`: **1600/390 PASS**, visor normal, bytes, hojas/filas/zoom, IndexedDB/versiones/reload/clear, Haku y OAuth readonly.

El test de navegador sirve bibliotecas worker ya cacheadas mediante
`HAIKU_LIBRO_WORKER_ASSETS` o `%TEMP%/haiku-jonathan-real-xlsx`, y usa
`NODE_PATH=%TEMP%/haiku-libro-medio-pago-validation/node_modules`.
No se instalaron/descargaron dependencias. Sólo se leen JSZip/SheetJS de esa
caché; no se lee ningún XLSX productivo que pudiera existir allí.
GIS, Google Drive, Supabase y reloj son controlados exclusivamente en tests.
La producción utiliza sus dependencias y clientes reales.

Logs/listado exacto de suite/capturas quedan en `%TEMP%`, fuera del repo,
con prefijo `haiku-libro-informe-` y capturas en `haiku-libro-informe-readonly`.
`git diff --check`: PASS. Todos los cambios quedan sin staging.

## Corrección focal R1 — enlace de autenticación

La revisión del paquete previo identificó que `#informe-login` apuntaba a
`index.html`, que no instala la autenticación. Se cambió exclusivamente su
`href` a `panel.html`; ningún JS productivo, regla del motor, permiso o
configuración de autenticación cambió respecto del paquete aprobado.
Se actualizaron este documento y las dos pruebas del informe.

Antes del arreglo, la regresión focal falló con ruta real
`/Proyecto-H/index.html` frente a la esperada `/Proyecto-H/panel.html`.
Después pasa junto con el recorrido de navegador descrito arriba.
El log RED y los logs posteriores se conservan fuera del repositorio con
prefijo `haiku-libro-informe-login-r1-`.
Paquete anterior conservado como referencia: SHA-256
`5a94cd15343a501853cfa9ae5c683a59afee67a98ae8b11662cea710ec06e932`.
La validación del login es offline con datos ficticios; no acredita login,
RLS ni OAuth reales en el dominio publicado.

## Límites y pendientes

El recorrido XLSX anonimizado produce `status: incompleto`: 41 registros,
40 grupos, 0/41 estadías asociadas/válidas, 40 faltantes, 0 ambiguas y
21 servicios por revisar. Es el mismo resultado del núcleo canónico sobre
esa entrada; no se cambió asociación ni se inventaron coincidencias para
mostrar una tarjeta exitosa. Los casos contractuales adicionales sí cubren
resultados completos, asociaciones, diferencias y estados financieros.
Ninguno demuestra equivalencia con el Libro productivo del operador.

Sigue pendiente la diferencia **34 vs. 41 hallazgos** entre copia restaurada
y XLSX auditado de Drive. No se declara conciliada. No se ejecutan suites
SQL/PGlite ni writers. El test preexistente `libro-resoluciones-postgres.test.cjs`
referencia la migration ausente `20261005051906_libro_resoluciones_ocupacion.sql`;
el checkout contiene `20261005191959_libro_resoluciones_ocupacion.sql`.
La suite de texto SQL no sustituye ejecución PostgreSQL.

Pendientes de validación autorizada futura: sesión/RLS reales, OAuth en el
dominio publicado/navegador externo, disponibilidad/lectura del Libro oficial
y tiempo/memoria del XLSX operativo en dispositivos móviles. La comparación
respeta RLS pero no constituye un snapshot transaccional de todas las tablas.
No hay retorno nativo/bridge a Mobile. El backend de cuenta de servicio y sus
pruebas Deno/Edge siguen fuera de esta etapa.

Único siguiente paso recomendado: revisión externa del diff y de esta
evidencia de 4B.3. No se ejecuta ese paso ni se inicia otra etapa.
