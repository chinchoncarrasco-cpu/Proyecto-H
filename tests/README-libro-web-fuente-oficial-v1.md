# Etapa 4B.2C — Fuente Web oficial verificada

Implementación offline en `codex/libro-web-fuente-oficial`, desde
`cd1296150cd8f1ab90e9d81903068091b6557e68`. No ejecuta la comparación 4B.1,
no crea informe, bridge, endpoint ni identidad Google. El backend 4B.2B
permanece íntegro e inactivo; esta ruta usa sólo el conector OAuth Web existente.

## Archivos

Nuevos:

- `js/haiku-libro-fuente-oficial-v1.js`: controlador interno, handles,
  checksums, lectura acotada, invalidación y M2.
- `tests/libro-web-fuente-oficial.test.cjs`: contratos offline del controlador
  y ejecución del conector real en un runtime Web controlado.
- `tests/libro-web-fuente-oficial-browser-check.cjs`: Edge local, lector y worker
  reales, GIS/Drive falsos y XLSX anonimizado.
- Este README.

Modificados:

- `js/supabase-libro-google-readonly-v1.js`: API aditiva verificable, metadata
  ampliada y enlace privado con la autorización existente.
- `js/supabase-libro-reserva-v1.js`: carga aditiva para verificación sin aviso
  automático; conserva la carga normal, la interpretación y la persistencia.
- `panel.html`: carga el módulo nuevo después del lector y antes del conector.
- `tests/sites-libro-browser-check.cjs`: incorpora esa misma dependencia,
  sin quitar ni debilitar aserciones del visor existente.

No cambian worker, semántica, DTO, asociación, pagos, servicios, escritores,
SQL, ACL, OAuth Client ID, scopes, Supabase ni Haku-Mobile. No hay fixtures
nuevos ni cambios a los fixtures existentes.

## Arquitectura y autoridad

```text
Autorización Web Google vigente y explícita
 → M0: metadata autenticada del FILE_ID configurado
 → descarga autenticada y acotada
 → SHA-256 local + todos los checksums remotos disponibles
 → M1: misma identidad, versión, checksums, tamaño y demás señales
 → lector canónico: carga real sin informe automático
 → cargado + SHA-256 + generación propia confirmados
 → handle opaco vigente

M2, operación separada:
 handle vigente + autorización + lector/generación/hash
 → metadata autenticada actual
 → mismo sello + lector/generación/hash nuevamente
```

La autoridad del ID continúa siendo exclusivamente el `FILE_ID` constante
del conector existente. Sus métodos nuevos no aceptan configuración, otro
ID, URL, token, mensaje Mobile ni una carga manual como fuente. La fábrica
del módulo auxiliar es composición interna con dependencias inyectables
para tests; no constituye una entrada de transporte ni autentica objetos
aportados por un consumidor. Sólo la instancia privada del conector acepta
sus propios handles.

M0 exige ID exacto, MIME XLSX, nombre no vacío, tamaño decimal positivo y
verificable, versión decimal positiva conservada como string int64,
modifiedTime interpretable, `canDownload === true` y `trashed === false`.
Checksum presente pero malformado falla; ausencia de MD5 y SHA-256 también.
Estos campos corresponden al contrato de
[files de Drive](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).

Se calcula siempre SHA-256 de los bytes completos. Si Drive entrega SHA-256
se compara; si entrega MD5 se compara; si entrega ambos deben coincidir ambos.
MD5 reutiliza el algoritmo matemático RFC 1321 del módulo backend aprobado,
adaptado a JS de navegador sin activarlo ni importar su autenticación.
Se verifica contra Node, bordes de bloques y el algoritmo backend.
No se duplican reglas de negocio. MD5 es checksum legado, no autenticación;
el fingerprint local sigue siendo SHA-256.

M1 compara ID, nombre, MIME, modifiedTime, tamaño, versión de Drive,
MD5, SHA-256, capacidad de descarga y papelera. No basta modifiedTime.
Las snapshots son copias congeladas de valores primitivos.

## API Web

```js
// Requiere autorización vigente obtenida con el botón existente Conectar Google.
const google = window.HAIKU_LIBRO_GOOGLE_V1;
const handle = await google.obtenerFuenteVerificada();
const fuente = google.fuenteVerificada(handle);

// Después de una comparación futura, que esta etapa NO ejecuta:
await google.verificarVigencia(handle);
```

`obtenerFuenteVerificada()` rechaza errores; no delega en `sincronizar()` ni
interpreta su promesa resuelta como éxito. Siempre descarga y verifica una
fuente nueva. Si hay sincronización habitual en curso devuelve `FUENTE_OCUPADA`.

El handle es un objeto congelado sin propiedades ni prototipo. JSON,
structured clones, objetos con campos iguales o handles de otra instancia
no son autoridad: la pertenencia y el sello están en una WeakMap privada y
sólo el handle activo es válido.

`fuenteVerificada(handle)` comprueba vigencia local en cada acceso y entrega:

```text
libro: fachada congelada de lectura del lector canónico
tipo: google-drive-oficial-verificado
nombre: nombre de M0
version: SHA-256 de los bytes completos
generacion: generación exacta capturada al iniciar esta carga
modifiedTime: fecha declarada por Google
verifiedAt: ISO UTC del reloj Web, después de confirmar la carga
```

La fachada expone sólo `estado`, `listo`, `listarHojas`, `consultarHoja` y,
cuando exista, `consultarHojaMensual`. No expone cargar, limpiar ni guardar.
Revalida antes y después de lecturas, incluidas respuestas asíncronas, y
sanitiza errores del lector. El resultado serializado no contiene bytes,
tokens, cookies, clientes ni contenido de huéspedes. Los métodos de lectura
son la capacidad interna necesaria para un futuro consumidor canónico;
esta etapa no extrae ni devuelve sus hojas como nuevo informe.

La metadata descriptiva o un resultado guardado no sustituye el handle
vigente. El consumidor futuro debe validar el handle y ejecutar M2 al final;
ante cualquier error debe descartar la comparación, no presentar éxito.
No cambia el contrato DTO v1 actual.

## Enlace con el lector e invalidación

No se sella una copia preexistente por nombre, hash declarado u origen.
Después de M1 se llama al lector exacto capturado para esta operación,
se captura su generación inmediatamente tras el inicio síncrono, se exige
incremento de una generación, se espera su promesa real y `listo()`, y se
confirman cargado, hash y esa misma generación. Una carga obsoleta resuelta
por el lector no puede certificar una carga posterior.

La API aditiva `cargarDesdeGoogleParaVerificacion(archivo)` utiliza el mismo
`cargarArchivo`, worker, buffers, hash, render y almacenamiento del lector.
Sólo omite `haiku:libro-version-cargada`, que inicia el informe automático
preexistente cuando cambian los bytes. No certifica procedencia por sí sola.
`cargarDesdeGoogle(archivo)`, la carga manual y la sincronización habitual
mantienen sus avisos y contratos anteriores. Un lector antiguo sin esta
capacidad falla cerrado antes de descargar; no se usa un fallback silencioso.

Invalidación inmediata mediante eventos, revisiones y comprobaciones:

- Cambio/limpieza del Libro y selección manual, incluso bytes idénticos.
- Hash, generación o instancia de lector distintos.
- Desconexión, vencimiento o 401, sin OAuth ni renovación implícitos.
- Nuevo intento de verificación, nueva descarga o fallo de verificación.
- Metadata incompatible observada por M2 o polling.
- Solicitud o carga sustituida por otra; las respuestas tardías no sellan
  el lector actual ni invalidan incorrectamente un sello posterior.

El único evento de limpieza síncrona propio de la entrega se reconoce dentro
de esa llamada; no se ignoran arbitrariamente todos los eventos Google.
La finalización propia exige también revisión, instancia y generación.
Un atributo `origen: google` por sí solo nunca demuestra procedencia.

M2 consulta únicamente metadata y no descarga, compara ni incorpora nada.
Comprueba hash/generación antes y después, y retira el sello si la metadata
o la lectura fallan. Su vigencia llega hasta esa observación; no bloquea
Drive ni garantiza que nadie cambie el archivo después de M1 o M2.

## Autorización, errores y límites

Se conserva GIS, Client ID, `drive.readonly`, autorización explícita y token
privado en la memoria existente del conector, según el
[modelo Web de tokens de Google](https://developers.google.com/identity/oauth2/web/guides/use-token-model).
No se agrega un accessor de tokens, identidad, almacenamiento de credenciales
ni transferencia a otro entorno. Un epoch de autorización impide reutilizar
respuestas antiguas tras desconexión/reconexión. Una respuesta OAuth tardía
no puede reconectar una sesión desconectada. El vencimiento tiene timer
propio y vuelve a habilitar la acción explícita Conectar Google.

La ruta verificada sólo usa GET autenticado a Drive API con ID fijo,
`cache: no-store`, sin redirects. La ruta habitual conserva su política
anterior de redirects. No usa el enlace de exportación público del visor.

Límites de la ruta nueva: 8 MiB comprimidos, JSON 32 KiB y timeout cancelable
de 60 s por adquisición/M2. Se valida Content-Length cuando representa los
bytes entregados, se limita siempre el stream real, se compara tamaño con
M0 y se rechazan cero bytes, truncados y formatos sin cabecera ZIP XLSX.
La cabecera no sustituye la validación del lector ni valida todos los XML.
Los cuerpos excesivos/interrumpidos se cancelan. No hay retries automáticos:
el llamador puede iniciar otro intento explícito tras un error.

Errores `FuenteOficialError`, con códigos y mensajes cerrados:
`GOOGLE_NO_AUTORIZADO`, `GOOGLE_ACCESO_DENEGADO`, `GOOGLE_ERROR`,
`GOOGLE_TIMEOUT`, `FUENTE_OCUPADA`, `FUENTE_INVALIDA`,
`FUENTE_DEMASIADO_GRANDE`, `FUENTE_NO_VERIFICABLE`, `CHECKSUM_INVALIDO`,
`LECTOR_NO_CONFIRMADO`, `FUENTE_CAMBIADA`, `SOLICITUD_OBSOLETA`.
No propagan cuerpo, headers, token, causa ni stack externo. Se eliminaron
los logs crudos del conector; el Web habitual mantiene errores visibles.

El polling conserva 60 s. Durante una verificación se difiere la comprobación
automática; Sincronizar ahora explícito puede cancelarla y cargar normalmente.
Metadata idéntica al sello vigente evita una descarga automática redundante;
una versión/checksum distinta invalida aunque modifiedTime no cambie.

Cero escrituras remotas. Se conserva exclusivamente la persistencia local
ya existente del lector en escritorio (actual/anterior); no se agrega otra
base, historial, exportación ni copia de datos personales. En móvil continúa
el comportamiento de memoria de la pestaña. El controlador guarda sólo
handles y metadata mínima en memoria, no los bytes ni credenciales.

## Validación offline — 09-10-2026

- `node --test tests/libro-web-fuente-oficial.test.cjs`: **88 PASS / 0 fail /
  0 skip**. Metadata, checksums, tamaño, stream, tipo, carga real/espera,
  generaciones, manual idéntico, limpieza, autoridad, autorización, timeout,
  concurrencia, respuestas tardías, M2, fachada y privacidad.
- Suite Libro aplicable: **57 archivos / 1.324 PASS / 0 fail / 0 skip**.
  Incluye los 66 tests 4B.1-R1 y 164 tests 4B.2B-R1/tamaño operativo.
- `node tests/libro-web-fuente-oficial-browser-check.cjs`: **1100/390 PASS**.
  Lector y worker reales; XLSX anonimizado versionado, HTTP/GIS falsos,
  hashes y generación, M2 sin descarga, manual idéntico, 401 y respuesta
  tardía. Listener automático real con spy: cero informes/comparaciones por
  carga verificada, incluso con bytes distintos. El camino habitual sigue
  notificando cambios. La variante de bytes cambia sólo un comentario ZIP
  ficticio en memoria; no modifica el fixture ni su OOXML.
- `node tests/libro-comparacion-readonly-browser-check.cjs`: **1100/390 PASS**,
  paridad Web, tres núcleos, wrappers idempotentes, DTO y cero mutaciones.
- `node tests/sites-libro-browser-check.cjs`: **PASS**, visor real, navegación,
  zoom, formato/bytes, persistencia/recarga/limpieza, Haku, Google Connect/Sync
  y responsive incluidos 1100/390.
- `git diff --check`: PASS; archivos nuevos comprobados además contra vacío.

Entorno Node v24.21.0, Edge headless y cachés locales existentes; ninguna
instalación ni descarga nueva. Las llamadas Google se sustituyen por fetch
falso; CDN del worker se sirve desde caché local. Ninguna lectura productiva,
sesión personal ni credencial real se usan en las pruebas.

Selector reproducible de suite, desde el repositorio en PowerShell:

```powershell
$env:NODE_PATH = Join-Path $env:TEMP 'haiku-libro-medio-pago-validation/node_modules'
$taskTests = @(rg --files tests | Where-Object {
  [IO.Path]::GetFileName($_) -match '^(haiku-libro-|haku-libro-|libro-|haiku-servicios-(identidad|idempotencia)|servicios-hidratacion-contextos|sites-libro-v1|supabase-libro-google-carga).*\.test\.cjs$' -and
  $_ -notmatch 'postgres'
} | Sort-Object)
node --test @taskTests
```

Los browser checks requieren la caché de Playwright indicada y los assets
SheetJS/JSZip existentes en `HAIKU_LIBRO_WORKER_ASSETS` o
`TEMP/haiku-jonathan-real-xlsx`. Sin caché fallan; no descargan dependencias.
Logs y capturas permanecen en TEMP, fuera del repositorio.

## Límites pendientes y revisión

No se valida todavía el acceso al Libro real con la autorización personal
existente, la respuesta efectiva de Drive/checksums/flags ni comportamiento
en otros navegadores externos. Falta medir CPU, memoria, expansión ZIP/XML y
lectura semántica completa del Libro operativo; 8 MiB de entrada y un timeout
no certifican esos recursos ni todas las hojas. La evidencia es offline.

No se llama todavía al núcleo de comparación, al transporte de Mobile ni a
un backend. Las validaciones reales Deno/Edge y de cuenta de servicio del
backend conservado siguen pendientes e inactivas, no se presentan como
ejecutadas. Las pruebas PostgreSQL preexistentes y la diferencia de 34 vs.
41 hallazgos entre fuentes también siguen fuera de esta validación.

Estado para revisión: cuatro tracked modificados y cuatro nuevos, staging
vacío en la rama indicada; HEAD/main/origin/main conservan el commit base.
Sin commit, push, merge ni deploy.

Único siguiente paso recomendado: revisión externa de este contrato de
fuente, invalidación y ausencia de comparación antes de autorizar una prueba
real de la ruta Web.
