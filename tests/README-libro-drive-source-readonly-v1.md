# Libro Drive Source backend readonly — Etapa 4B.2B

Implementación offline en `codex/libro-drive-backend-readonly`, basada en
`d36fa035efe3448b735f17522cf33a5d9b7774e4`. No incorpora un endpoint ni llama
al núcleo 4B.1. No cambia el DTO público, Web, Mobile, OAuth Web, SQL, permisos,
writers ni datos. No instala dependencias.

## Compatibilidad con el tamaño operativo del Libro

La revisión externa informó que `Libro de reservas actual 2025.xlsx` tenía
**6.656.601 bytes** en metadata del 09-10-2026. No se consultó Drive ni se leyó
ese archivo para este ajuste. El límite anterior de 5.242.880 bytes lo rechazaba
en M0 con `FUENTE_DEMASIADO_GRANDE`, antes de descargar; se reprodujo offline.

El límite operativo propuesto y aplicado como default es **8 MiB = 8.388.608
bytes**, con 1.732.007 bytes de margen (**26,02%**) sobre el tamaño informado.
Es un aumento acotado respecto del dato conocido, sin asumir una tasa futura
de crecimiento ni retirar checks de stream, Content-Length, tamaño real,
checksums o estabilidad. El único cambio de producción es esa constante.

Actualmente `maxBytes` se valida y captura al construir `createLibroDriveSource`;
no existe un endpoint que lo configure. La futura composición backend 4B.3
debe fijarlo en esa llamada con `LIBRO_MAX_COMPRESSED_BYTES`, como muestra el
ejemplo inferior, sin tomarlo de requests, DTOs o parámetros Mobile. Omitirlo
también aplica el default de 8 MiB. Se conserva la posibilidad de probar
límites menores y el techo técnico interno de configuración de 64 MiB; ese
techo no es una recomendación ni una capacidad Edge certificada. Un aumento
del límite operativo requerirá revisar nuevamente recursos y seguridad.

La [documentación de límites Edge](https://supabase.com/docs/guides/functions/limits)
establece 256 MB de memoria y 2 s de CPU por request, además de límites de wall
clock. Los 8 MiB sólo acotan entrada comprimida: acumulación de chunks, buffer
continuo, hashing/MD5 y la futura copia del lector agregan memoria. Un ZIP puede
expandirse mucho más y los objetos/textos del parser consumen recursos extra.
No se deduce de 8 MiB que toda la comparación cabrá en 256 MB o 2 s: falta medir
el flujo completo en Deno/Edge, incluidos parsing, comparación y concurrencia.
Se mantiene explícito que el adaptador no ejecuta los límites ZIP/XML 32/8 MiB.

Se agregaron seis regresiones de capacidad: bloqueo del tamaño reportado con
5 MiB, aceptación de bytes generados de 6.656.601 bytes, aceptación exacta de
8 MiB, bloqueo M0 de 8 MiB + 1 y cancelación de ese exceso real con Content-Length
ausente o falso. Los casos aceptados verifican ambos hashes, bytes íntegros,
una sola descarga y M0/M1/M2. También se conserva el borde de un límite interno
reducido de 5 MiB y se actualizan las pruebas de headers/exceso al nuevo default.
Antes del cambio hubo 2 PASS / 4 fail en esos seis casos; ahora todos pasan.

Estos bytes grandes son generados y ficticios, **no el XLSX productivo ni una
prueba de su estructura o semántica**. La adquisición real con cuenta de
servicio, el reader canónico para ese Libro y el presupuesto Edge siguen
pendientes. La prueba existente con XLSX anonimizado sigue cubriendo únicamente
el transporte offline de ese fixture, no la compatibilidad del Libro real.

## Corrección 4B.2B-R1

El transport toma un snapshot inmediato de sus nueve opciones de red: fetch,
now, sleep, random, setTimer, clearTimer, budgetMs, maxRetries y retryDelayMs.
Ninguna función retornada consulta posteriormente el objeto de opciones.
Además, el provider pasa explícitamente sólo esos campos a la capa de red:
el JSON de cuenta de servicio no se entrega al transport. Mutar las opciones
originales después de construirlo no cambia sleepers, timers, requests ni
refresh. Se mantienen CryptoKey no extraíble, limpieza DER, firma y caché.
Las pruebas son contractuales de snapshot y no intentan medir GC.

Para Drive HTTP 403 se lee como máximo 32 KiB de JSON bajo el mismo timeout y
AbortSignal del request. Sólo `error.errors[].reason`, en objetos estructurados,
puede activar retry por coincidencia exacta con `rateLimitExceeded` o
`userRateLimitExceeded`. Esos casos usan `GOOGLE_RATE_LIMIT` y la política
acotada existente. Messages, substrings, campos desconocidos y formas distintas
no activan retry. JSON inválido, UTF8 inválido, cuerpo excesivo, fallo de lectura
o reason no reconocido permanecen `GOOGLE_ACCESS_DENIED`; un timeout mantiene
`GOOGLE_TIMEOUT`. El cuerpo se descarta tras clasificar y nunca sale en error,
stack externo, fuente ni logs. OAuth 403 conserva `GOOGLE_AUTH_ERROR` y no se
inspecciona por reason.

Se agregaron 34 tests R1. Las siete regresiones centrales se ejecutaron primero
contra la implementación anterior: 0 PASS / 7 fail; demostraron uso de sleep B,
lectura tardía de opciones y clasificación incorrecta de ambas razones 403.
Después del arreglo pasan dentro del conjunto focal actual. También se comprueban
refresh sin relectura de credencial, whitelist estricta, límites exactos de
cuerpo, cancelación/timeout, backoff, Retry-After y M1/M2 sin nueva descarga.

## Módulos y contrato

- `supabase/functions/_shared/googleServiceAccountToken.ts`: validación de la
  cuenta de servicio, firma PKCS8/RS256 y caché de token exclusivamente en memoria.
- `supabase/functions/_shared/libroDriveSource.ts`: adquisición M0/bytes/M1 y
  verificación posterior M2, separadas de cualquier comparación canónica.
- `supabase/functions/_shared/googleDriveReadonlyCommon.ts`: transporte acotado,
  lectura de cuerpos, cancelación, retries y errores cerrados compartidos.
- `supabase/functions/_shared/libroDriveChecksums.ts`: MD5 pequeño, sin librerías
  ni APIs de Node; se usa sólo para el checksum remoto legado, nunca para autenticar.
- `tests/libro-drive-source-readonly.test.cjs`: HTTP falso, claves efímeras y
  regresiones de integridad, estabilidad, límites y seguridad.

API backend:

```ts
const tokenProvider = createGoogleServiceAccountTokenProvider({
  serviceAccountJson: configuracion.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
});
const drive = createLibroDriveSource({
  fileId: configuracion.GOOGLE_DRIVE_FILE_ID,
  tokenProvider,
  maxBytes: LIBRO_MAX_COMPRESSED_BYTES, // Límite operativo backend de 8 MiB.
});
const source = await drive.obtain();
// El futuro orquestador hará aquí la comparación canónica, fuera del adaptador.
await drive.verifyStillCurrent(source.stamp);
```

Este ejemplo no lee secretos ni variables de entorno. La configuración es
responsabilidad del futuro backend; no se debe construir con valores de una
request. El ID aprobado actualmente es `1ZX4KqcdY6LORafrI6NkqwT3hGxrdK2rk`;
el módulo no lo hardcodea ni lo consulta durante tests. La cuenta dedicada con
acceso `reader` sólo al Libro debe provisionarse y verificarse en una etapa
posterior. El scope readonly no sustituye esa restricción de acceso.

`LibroDriveSource` es un resultado interno:

```ts
{
  bytes: Uint8Array,
  metadata: {
    name: string,
    mimeType: string,
    modifiedTime: string | null,
    size: number | null,
    driveVersion: string,
    md5Checksum: string | null,
    sha256Checksum: string | null
  },
  sha256: string,
  verifiedAt: string, // ISO UTC del reloj backend tras validar M1
  stamp: LibroDriveStamp
}
```

El resultado, metadata y stamp están congelados. Los bytes son una copia propia
del stream; `Uint8Array` sigue siendo mutable y el orquestador debe preservarlos
hasta entregarlos al lector canónico, que ya copia su entrada. `stamp` incluye
el ID interno y las nueve señales de estabilidad, nunca un token. M2 admite
únicamente el mismo objeto stamp emitido por esa instancia del adaptador:
no es un contrato serializable para aceptar decisiones de clientes ni recuperar
stamps entre instancias. El ID de Drive y el stamp no se proyectan al DTO público.

## Autenticación y transporte

La credencial debe ser JSON de tipo `service_account`, con email de cuenta de
servicio, PEM PKCS8 válido y `private_key_id` válido si está presente. La clave
se importa con Web Crypto como RSA/SHA-256, no extraíble, con al menos 2048 bits;
los bytes DER se limpian después de importarla. No se conserva una credencial
ejemplo real ni se persiste el token. El llamador sigue siendo responsable de
custodiar el string de configuración original.

JWT: `alg=RS256`, `typ=JWT`, `kid` opcional; claims `iss`, `scope`, `aud`, `iat`
y `exp`. Vigencia predeterminada 300 s, configurable hasta 3600 s.
`aud=https://oauth2.googleapis.com/token` y
`scope=https://www.googleapis.com/auth/drive.readonly` son constantes.
Los URLs, scopes y campos de delegación recibidos en el JSON se ignoran.

La caché comparte una adquisición de token en vuelo por provider, respeta
`expires_in` y renueva anticipadamente con margen `min(60 s, 10% de vigencia)`.
El cálculo parte del instante de emisión y descuenta la latencia HTTP.
Invalidar un token viejo no elimina otro token más reciente.

OAuth sólo usa POST al endpoint fijo. Drive sólo usa GET a paths construidos
con el ID backend validado, `supportsAllDrives=true`, `redirect: manual` y
`cache: no-store`. No se siguen redirects. Los tests bloquean el fetch global y
usan únicamente HTTP falso; el browser check sólo permite su servidor local.
No hay escrituras Drive ni Proyecto H: el POST OAuth obtiene un token, no
escribe el Libro. El adaptador no conoce roles/permisos Haku.

## Integridad y estabilidad

1. M0 solicita exactamente `id,name,mimeType,modifiedTime,size,version,`
   `md5Checksum,sha256Checksum,trashed,capabilities(canDownload)`.
2. Valida ID configurado, MIME XLSX, `trashed !== true`, `canDownload === true`,
   tamaño positivo verificable y version decimal int64 conservada como string.
   No deduce identidad ni formato desde el nombre o extensión.
3. Descarga un único cuerpo completo exitoso y comprueba tamaño real.
4. Calcula siempre SHA-256 local. Compara TODOS los checksums remotos presentes,
   SHA-256 y/o MD5. Cualquiera que contradiga los bytes aborta. Sin ambos
   checksums remotos, aborta antes de descargar con `FUENTE_NO_VERIFICABLE`.
5. M1 consulta metadata de nuevo. Sólo entrega la fuente si coinciden ID, MIME,
   version, modifiedTime, size, MD5, SHA-256, canDownload y trashed.
6. M2 es otra operación explícita, con presupuesto propio, que sólo consulta
   metadata; no descarga ni compara servicios/pagos. Un cambio aborta con
   `FUENTE_CAMBIADA`. El futuro orquestador debe descartar su comparación.

Metadata malformada en M1/M2 también bloquea como `FUENTE_CAMBIADA`. Errores
HTTP y timeouts conservan su código: nunca se sustituyen por metadata vieja,
lista vacía ni una fuente supuestamente válida. Los checksums hex se normalizan
a minúsculas; el nombre se conserva como evidencia visible de M0, pero su
cambio no declara cambio de contenido. Fecha ausente y trashed ausente se
normalizan a null y participan en la comparación. Size ausente bloquea M0.

M2 observa estabilidad hasta esa última lectura; no bloquea Google Drive ni
promete impedir un cambio posterior. El hash identifica los bytes utilizados.

## Límites, retries y errores

- Máximo predeterminado **8 MiB = 8.388.608 bytes XLSX comprimidos**. Puede
  configurarse sólo internamente; los tests cubren el borde y exceso real del
  stream aunque headers/metadata mientan. Se rechazan cero bytes y tamaño
  distinto de M0.
- `Content-Length`, si está presente, debe ser decimal válido. Se contrasta
  con tamaño/límite cuando no hay Content-Encoding o es identity; con encoding
  de transporte puede medir otra representación. Siempre manda el tamaño real
  de bytes entregados por fetch, además del checksum.
- JSON de OAuth/metadata y JSON de credencial limitados a 32 KiB; PEM a 16 KiB.
- **No abre ZIP/XML ni valida estructuralmente el XLSX. No ejecuta límites de
  32 MiB ZIP descomprimido / 8 MiB XML.** Esas defensas pertenecen al lector/bundle
  posterior; MIME y checksums no sustituyen un parser XLSX seguro.
- Timeout token/metadata 10 s; descarga 20 s. AbortController y temporizador
  cubren fetch y lectura del cuerpo. Presupuesto total 60 s por adquisición y
  por M2, incluyendo token, esperas y retries. Son configurables/injectables.
- Drive 401: como máximo una invalidación/renovación y retry en toda una
  adquisición, no una por cada lectura. M2 tiene su propio presupuesto de una
  renovación. El segundo 401 bloquea.
- 429, 403 con reason `rateLimitExceeded`/`userRateLimitExceeded`, 5xx y fallos
  de transporte temporales: un retry predeterminado por
  operación HTTP, máximo configurable dos. Backoff inicial 250 ms, exponencial
  con jitter, y Retry-After acotado por el presupuesto; reloj/sleeper se inyectan.
- Los demás 403, 404, redirects, timeout, MIME/checksum inválido y fuente cambiada no se
  reintentan automáticamente. `retryable` describe si una nueva consulta
  completa podría tener sentido; no habilita loops dentro de una adquisición.
- Un retry de M1/M2 jamás repite la descarga completa ya verificada. Intentos
  media rechazados antes del cuerpo o streams interrumpidos no son descargas
  completas exitosas.

Errores cerrados con mensajes fijos, `code`, `retryable` y `retryAfterMs`:

`CONFIG_INVALIDA`, `GOOGLE_AUTH_ERROR`, `GOOGLE_ACCESS_DENIED`,
`GOOGLE_FILE_NOT_FOUND`, `GOOGLE_RATE_LIMIT`, `GOOGLE_TEMPORARY_ERROR`,
`GOOGLE_TIMEOUT`, `FUENTE_INVALIDA`, `FUENTE_DEMASIADO_GRANDE`,
`FUENTE_NO_VERIFICABLE`, `CHECKSUM_INVALIDO`, `FUENTE_CAMBIADA`.

No incluyen causa/stack externo, cuerpo crudo, JWT, token, clave ni headers.
No existen logs, almacenamiento persistente ni lectura de configuración real.

## Validación offline ejecutada

Entorno: Windows, Node **v24.21.0**, Web Crypto y ejecución nativa de TypeScript
erasable. Deno y un compilador TypeScript no están disponibles en PATH;
no se instalaron ni descargaron herramientas para esta etapa.

- `node --test tests/libro-drive-source-readonly.test.cjs`: **164 PASS,
  0 fail, 0 skip**. Comprueba firma RSA mediante verificación criptográfica,
  credenciales inválidas, cache/expiry, metadata, MD5/SHA-256, M0/M1/M2,
  retries, timeouts de fetch/cuerpo, redirects, sanitización y cero escrituras.
  Incluye los 124 tests iniciales, 34 R1 y seis de capacidad operativa.
  Incluye transporte completo del XLSX anonimizado versionado de 49.120 bytes,
  con OAuth falso y clave PKCS8 generada sólo en memoria. No lo reinterpreta
  ni ejecuta la comparación 4B.1 dentro del adaptador.
- Suite Libro aplicable: **56 archivos, 1.236 PASS, 0 fail, 0 skip**, incluyendo
  los **66** focales 4B.1-R1 y los 164 del adaptador. Usa cachés locales existentes de
  SheetJS/JSZip; no descargas. Se excluyen las suites Postgres del selector.
- `node tests/libro-comparacion-readonly-browser-check.cjs`: **PASS a 1100 y
  390 px**, 6 casos × 3 núcleos por ancho, paridad Web/readonly, wrappers sin
  acumulación, DTO sin IDs persistentes y **0 mutaciones**.
- `git diff --check`: PASS. Los archivos nuevos se comprueban además contra
  archivo vacío porque el diff normal no incluye untracked. Sin staging.

Selector de la suite aplicable en PowerShell:

```powershell
$env:NODE_PATH = Join-Path $env:TEMP 'haiku-libro-medio-pago-validation/node_modules'
$taskTests = @(rg --files tests | Where-Object {
  [IO.Path]::GetFileName($_) -match '^(haiku-libro-|haku-libro-|libro-|haiku-servicios-(identidad|idempotencia)|servicios-hidratacion-contextos|sites-libro-v1|supabase-libro-google-carga).*\.test\.cjs$' -and
  $_ -notmatch 'postgres'
} | Sort-Object)
node --test @taskTests
```

## Pendientes y frontera de esta etapa

No ejecutado: typecheck Deno, integración del bundle/lector canónico en Edge,
medición CPU/memoria/concurrencia con los límites Edge, acceso real de cuenta
reader y disponibilidad real de checksums/canDownload del Libro. No se ha
certificado funcionamiento productivo ni se han configurado credenciales.

La autorización Haku corresponde a 4B.3; no se decide aquí entre usuario activo
y permisos de reservas/pagos/auditoría. Las pruebas SQL preexistentes y la
diferencia pendiente de 34 vs. 41 hallazgos entre fuentes siguen fuera de esta
validación; no se presentan como resueltas ni ejecutadas. Esta etapa sólo
verifica adquisición estable, y no reconcilia esas dos copias del Libro.

Siguiente paso recomendado: revisión externa de estos módulos y contratos
antes de diseñar el orquestador. No se ejecuta ese paso ni se crea endpoint.

Referencias primarias consultadas:
[cuenta de servicio/JWT](https://developers.google.com/identity/protocols/oauth2/service-account),
[campos de files](https://developers.google.com/workspace/drive/api/reference/rest/v3/files),
[descarga Drive](https://developers.google.com/workspace/drive/api/guides/manage-downloads),
[errores Drive](https://developers.google.com/workspace/drive/api/guides/handle-errors),
[Web Crypto Deno](https://docs.deno.com/api/web/crypto/),
[MD5 RFC 1321](https://www.rfc-editor.org/rfc/rfc1321),
[límites Edge](https://supabase.com/docs/guides/functions/limits).
