# Revisión del avatar canónico de perfil HAKU

Preparado exclusivamente en `codex/avatar-perfil-canonico`. Se elige la opción A: un objeto privado de Storage por usuario, sin columna nueva, sin nuevo permiso y sin modificar `haiku_sesion_actual()`. La migration está lista para revisión; no se aplicó a Supabase remoto y no se hicieron escrituras productivas, commit, push ni merge.

## Auditoría y decisión

La inspección de producción del 2 de octubre de 2026 usó únicamente transacciones READ ONLY para consultar catálogo, configuración de buckets, políticas y definiciones de funciones. Confirmó que `usuarios` sólo tiene `id`, `nombre`, `apellido`, `telefono`, `activo`, `creado_en` y `actualizado_en`; Storage tiene RLS habilitada y sólo el bucket privado `haiku-evidencias` con políticas SELECT/INSERT acotadas a ese bucket y sus permisos. No se consultaron imágenes ni datos personales.

El helper existente `private.haiku_usuario_activo()` comprueba `auth.uid()` contra `usuarios.activo`. Se reutiliza sin cambios. Su SECURITY DEFINER ya existe y queda intacto; la migration no crea funciones ni introduce nuevos privilegios de ejecución. El wrapper de sesión también se conserva.

| Opción | Evaluación |
| --- | --- |
| A — ruta determinística | Elegida. El UID resuelve un único objeto; no requiere metadata adicional ni sincronización de una fila con Storage |
| B — path en usuarios | Añadiría una escritura y posibles referencias obsoletas sin aportar información necesaria para este caso |

El contrato usa `haiku-avatares/<uid>/avatar`, donde `haiku-avatares` es el bucket y `<uid>/avatar` es el nombre del objeto. La ausencia de extensión es deliberada: Content-Type identifica el formato y cambiar JPEG por PNG reemplaza el mismo objeto. Sólo se admite el nombre exacto; no variantes, subcarpetas ni nombres con timestamps. La Web actual no cambia.

## Bucket y formatos

Bucket privado `haiku-avatares`, con límite de **5 MiB = 5 242 880 bytes**, y lista exacta de MIME: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`. PDF, SVG, GIF, AVIF y tipos arbitrarios quedan fuera de esta lista. Se conserva la propuesta de cinco formatos; no se utiliza el bucket de evidencias.

Supabase permite restringir tamaño y MIME por bucket. Son restricciones de la API de Storage, no constraints del JSON `storage.objects.metadata`; las pruebas SQL verifican su configuración, no simulan la validación HTTP de bytes. Content-Type debe corresponder al archivo real: una lista de MIME no equivale a analizar o sanear el contenido de una imagen. [Configuración de buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets).

Para interoperabilidad, el contrato recomendado de Haku-Mobile es seleccionar una imagen y **normalizarla localmente a JPEG** antes de subirla. Expo ImageManipulator ofrece exportación JPEG/PNG/WebP; se propone limitar el lado mayor a 1024 px, comprimir y verificar el tamaño final. No hay procesamiento servidor-side. [ImageManipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/).

El picker puede entregar originales HEIC; no se debe deducir el formato sólo del nombre original. [ImagePicker](https://docs.expo.dev/versions/latest/sdk/imagepicker/). Aceptar HEIC/HEIF en Storage no garantiza decodificación universal: el soporte de imagen varía por plataforma. La normalización evita depender de esos formatos en otros dispositivos. Si el dispositivo no puede decodificar la selección, se informa el error y no se reemplaza el avatar anterior. [Formatos y API de expo-image](https://docs.expo.dev/versions/latest/sdk/image/).

Este repositorio no contiene el proyecto Expo ni sus dependencias: la auditoría Mobile es documental, no una prueba en el build concreto de Haku-Mobile. La implementación del cliente deberá verificar las versiones instaladas y probar selección/conversión en dispositivos reales.

## Políticas y alcance de seguridad

Cuatro policies en `storage.objects`, exclusivamente para `authenticated`:

| Policy | Operación | Condiciones |
| --- | --- | --- |
| haiku_avatares_select_propio | SELECT | Bucket avatar, usuario activo, primer folder igual a auth.uid y nombre exacto `<uid>/avatar` |
| haiku_avatares_insert_propio | INSERT | Las mismas condiciones en WITH CHECK |
| haiku_avatares_update_propio | UPDATE | Las mismas condiciones en USING y WITH CHECK |
| haiku_avatares_delete_propio | DELETE | Las mismas condiciones en USING |

SELECT permite leer el objeto propio y listar únicamente lo propio; no permite enumerar otros usuarios. UPDATE valida el origen y el destino: no se puede mover el objeto a otro usuario, otro nombre ni otro bucket. No se concede acceso a anon. Un usuario autenticado ausente de HAKU o inactivo tampoco puede operar.

No se exige `usuarios.gestionar`, ni se crea un permiso nuevo: identidad, pertenencia activa y propiedad ya expresan la autorización de esta acción personal. No hay service_role, secretos nuevos ni acceso público permanente. Tener permisos de evidencias o gestión de usuarios no amplía acceso a avatares ajenos.

La migration sólo actualiza la configuración de su bucket y recrea sus cuatro políticas con nombres propios dentro de una transacción. Se prueba su reaplicación. No altera grants, RLS, policies de evidencias, columnas de usuarios ni contratos de sesión. Antes de un despliegue futuro debe comprobarse que no hayan aparecido otras políticas permisivas globales en Storage: PostgreSQL combina policies permisivas con OR.

## Contrato de subida y reemplazo para Mobile

1. Obtener la sesión autenticada y el usuario HAKU activo. Resolver `path = usuario.id + '/avatar'`; la policy es la autoridad final y compara con auth.uid().
2. Seleccionar y normalizar la imagen localmente; no subir si falla la conversión o supera el límite. Usar bytes del resultado, no del archivo original.
3. Subir mediante el cliente autenticado de Supabase y `upsert: true`. La misma ruta evita archivos huérfanos; no borrar antes de subir. Ante error conservar la foto anterior en la UI.
4. Sólo después de éxito, invalidar la vista y volver a descargar desde Storage. No marcar como persistida una previsualización local.

```javascript
// jpegBytes: ArrayBuffer de la imagen YA convertida y validada localmente.
const path = `${usuario.id}/avatar`;
const { error } = await supabase.storage.from('haiku-avatares').upload(path, jpegBytes, {
  contentType: 'image/jpeg',
  upsert: true,
  cacheControl: '0',
});
if (error) throw error;
// A continuacion renovar la fuente autenticada de imagen con un nonce nuevo.
```

Se usa ArrayBuffer como cuerpo de subida. [API de upload](https://supabase.com/docs/reference/javascript/storage-from-upload). El reemplazo mediante upsert requiere las políticas SELECT, INSERT y UPDATE preparadas. Si dos dispositivos reemplazan a la vez, prevalece la última subida completada; no hay una segunda referencia que actualizar. [Subidas y reemplazos](https://supabase.com/docs/guides/storage/uploads/standard-uploads).

El borrado futuro utiliza `supabase.storage.from('haiku-avatares').remove([path])`. Nunca se borran filas directamente de `storage.objects` desde el cliente: Storage debe gestionar también los bytes.

## Lectura autenticada y caché

Se elige descarga autenticada. Para mostrarla directamente con expo-image, construir la URL desde la configuración Supabase del entorno, el bucket y el path canónico; enviar el access token vigente en Authorization. No guardar la URL ni el token como metadata de perfil. El endpoint es `/storage/v1/object/authenticated/haiku-avatares/<uid>/avatar`. [Lectura privada de Storage](https://supabase.com/docs/guides/storage/serving/downloads).

Ejemplo conceptual para la futura integración, sin credenciales incrustadas:

```javascript
const url = new URL(
  `/storage/v1/object/authenticated/haiku-avatares/${usuario.id}/avatar`,
  supabaseUrlDelEntorno,
);
url.searchParams.set('cacheNonce', nonceNuevoEnMemoria);
const source = {
  uri: url.toString(),
  headers: { Authorization: `Bearer ${accessTokenVigente}` },
};
// <Image key={`${usuario.id}:${nonceNuevoEnMemoria}`}
//        source={source} cachePolicy="none" />
```

expo-image admite headers en la fuente y control de caché. Renovar el token en la fuente cuando cambie la sesión, y retirar la imagen al cerrar sesión o cambiar de cuenta. No registrar Authorization en logs. Un 404 se representa con el avatar por defecto; un error de autorización requiere revalidar la sesión, no presentar una subida como exitosa. [API de expo-image](https://docs.expo.dev/versions/latest/sdk/image/).

Generar un nonce nuevo en memoria tras upload/remove exitoso y al volver al perfil o recuperar el foco de la aplicación; así otro dispositivo consulta el mismo objeto actualizado. No se requiere un campo de versión en DB. `cacheControl: '0'` y `cachePolicy="none"` evitan retener deliberadamente la imagen, mientras `cacheNonce` permite saltar la caché de CDN. Cambiar sólo la key del componente no invalida la CDN. [Caché de Storage](https://supabase.com/docs/guides/storage/cdn/smart-cdn).

No se eligen signed URLs como lectura principal: quien posee una URL firmada puede usarla sin el JWT y su revocación no sigue inmediatamente la sesión HAKU. La descarga autenticada permite evaluar RLS en nuevas solicitudes. Ningún diseño puede retirar bytes que un cliente ya descargó. No se promete actualización push instantánea entre dispositivos: se recarga al entrar/volver al perfil.

## Review pack y ejecución

Archivos nuevos:

- [Migration SQL](../supabase/migrations/20261002050445_avatar_perfil_canonico.sql).
- [Tests SQL transaccionales](../tests/avatar-storage.integration.sql).
- [Runner y verificaciones de contratos](../tests/avatar-storage.test.cjs).
- [Fixture local de Storage](../tests/fixtures/avatar-storage-schema.sql).
- Este documento.

El fixture reproduce las políticas productivas de evidencias y las funciones de usuario activo/foldername. Usa tablas mínimas y claims sintéticos; la implementación interna de sesión y el resolvedor de permisos de evidencias son dobles explícitos. Las operaciones probadas se ejecutan bajo `authenticated` o `anon`, sin superuser ni BYPASSRLS. El helper de usuario activo mantiene su definición real.

Se requiere Node y PGlite 0.3.14, disponible en esta sesión en una carpeta temporal externa al repo. Para reproducir, instalar esa versión en una carpeta local de herramientas y apuntar `HAKU_PGLITE_MODULE` a su módulo:

```powershell
$env:HAKU_PGLITE_MODULE = '<carpeta-herramientas>/node_modules/@electric-sql/pglite'
node --test tests/avatar-storage.test.cjs tests/bove-evidencias.test.cjs tests/sites-cierre-v1.test.cjs
git diff --check
```

El test SQL tiene BEGIN/ROLLBACK. El runner también engloba fixture y migration en una transacción, usa savepoint para los casos y verifica que el rollback borre incluso el esquema efímero. No admite URL de base remota.

| Requisitos | Evidencia |
| --- | --- |
| 1–3 | Bucket privado, 5242880 bytes y MIME exactos |
| 4–7 | SELECT/INSERT/UPDATE/DELETE propios y upsert sin duplicados |
| 8–10 | A no inserta, actualiza ni elimina B; B permanece intacto |
| 11–12 | Anon e inactivo sin acceso en las cuatro operaciones; no HAKU y sin UID rechazados |
| 13–14 | Comparación antes/después de bucket y políticas de evidencias; sus permisos siguen funcionando |
| 15–16 | Columnas de usuarios y definición de haiku_sesion_actual idénticas antes/después y al reaplicar |

Cobertura adicional: no enumeración de B, rechazo de extensión alternativa, subcarpetas, traversal, raíz y movimiento entre usuarios/buckets. La suite hace **36 comprobaciones SQL**; junto con tests relacionados arroja **21 tests aprobados, cero fallos y cero omitidos**.

`git diff --check` terminó sin errores. También se verificaron explícitamente los cinco archivos nuevos con `git diff --no-index --check`, ya que permanecen sin seguimiento y no están staged.

Las pruebas son de PostgreSQL/RLS y configuración. No ejecutan el servicio HTTP de Storage, subida real de archivos, CDN ni Expo en dispositivo. Esas comprobaciones de transporte, límites efectivos y decodificación quedan para la integración Mobile en un entorno no productivo. No se presenta esta preparación backend como una pantalla Mobile ya implementada.
