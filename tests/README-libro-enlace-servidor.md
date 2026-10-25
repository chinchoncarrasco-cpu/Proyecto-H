# Libro por enlace compartido desde el servidor

El permiso personal de Google vencía y detenía la lectura automática. Esta conexión consulta el mismo XLSX compartido como «Cualquier persona con el enlace / Lector» mediante una API key guardada exclusivamente en el servidor. No exige agregar una cuenta de servicio al archivo.

## Alcance

- Edge Function `haku-libro-enlace-readonly`, sólo `metadata` y `descargar`, archivo y origen web fijados en código.
- Auth valida cada sesión Haku y `haiku_sesion_actual` confirma usuario activo y permisos `reservas.ver`, `pagos.ver`, `servicios.ver`. No usa `service_role` ni datos editables por el usuario para autorizar.
- API key sólo en el header saliente a Drive; no se devuelve, persiste en cliente, incorpora en URLs ni registra en logs. Redirecciones rechazadas, límites de bytes/tiempo y errores sanitizados.
- El adapter existente admite exactamente una credencial (API key o proveedor de token). La descarga conserva M0/checksums/M1; la comparación web conserva su propio handle opaco y M2. `readMetadata` no emite un sello confiable.
- La conexión se recupera automáticamente con la sesión válida de Haku; F5 espera restaurar el Libro anterior. Polling cada 15 segundos en pestaña visible y al volver. Pausar detiene consultas en la página actual; cerrar sesión invalida respuestas tardías.
- Misma copia/bytes no producen avisos repetidos. Se conserva el lector XLSX completo, incluidos estilos y comentarios. No hay cambios en incorporación, pagos, servicios, validaciones o writers.
- Si falta instalar/configurar la función, permanece disponible la conexión Google anterior. Un enlace denegado o un error de acceso no intenta obtener silenciosamente otro permiso personal.

## Configuración y activación

1. En Google Cloud, proyecto `proyecto-h-508400`, crear una API key estándar restringida a **Google Drive API**. Debe ser una clave para servidor; una restricción de referente web no sirve para solicitudes desde Edge Functions. No pegarla en chat, archivos versionados ni capturas.
2. Guardarla directamente en Supabase → Edge Functions → Secrets, como `HAKU_LIBRO_DRIVE_API_KEY`. Si el enlace requiere resource key, usar `HAKU_LIBRO_DRIVE_RESOURCE_KEY`; nunca ampliar permisos para resolver un 404 sin investigarlo.
3. Desplegar la función con sus dependencias `_shared/libroDriveSource.ts`, `googleDriveReadonlyCommon.ts`, `libroDriveChecksums.ts` y `googleServiceAccountToken.ts` (importación de tipos). La función autentica internamente mediante Auth y el RPC; `verify_jwt=false` permite claves de firma actuales sin delegar la autorización a la pasarela.
4. Probar metadata y XLSX reales: ID/MIME/tamaño, permiso de descarga, hashes y versión estable. No suponer que la configuración pública de la captura acredita por sí sola estos resultados.
5. Tras esa comprobación, activar `HAIKU_SUPABASE_CONFIG.libroConexionServidor` y publicar. La configuración queda **true** después de verificar el acceso real del servidor. El flag permite volver al modo Google personal sin cambiar el Libro.

Mientras el archivo sea accesible por enlace, cualquier poseedor de ese enlace puede leerlo. Si pasa a restringido o se prohíbe descargarlo, esta vía deja de funcionar y muestra la incidencia. No cambia esa configuración de Drive ni incorpora cuentas nuevas.

## Validación local

`node --test tests/libro-enlace-servidor.test.cjs tests/libro-drive-source-readonly.test.cjs tests/libro-google-sesion.test.cjs tests/libro-web-fuente-oficial.test.cjs tests/supabase-libro-google-carga.test.cjs tests/libro-informe-readonly-web.test.cjs`

379 pruebas focalizadas y 3.465 de la suite completa aprobadas, sin fallos ni omisiones. TypeScript del handler y dependencias aprobado. Browser check `tests/libro-google-sesion-browser-check.cjs`, modo anterior y `HAIKU_LIBRO_SERVER=1`: Chromium con lector/Worker/IndexedDB reales y servicios ficticios, F5, mismo archivo sin descarga/aviso repetido, versión nueva con un aviso, comparación/vigencia, logout y temas claro/oscuro. Cero tráfico real y cero escrituras de negocio.

## Comprobación del servidor — 25 de octubre de 2026 UTC

La clave fue introducida por el propietario directamente en Secrets. Una comprobación administrativa temporal con credencial aleatoria efímera confirmó lectura/descarga real, checksums y M0/M1/M2 estables: 6.665.712 bytes, versión Drive `369898`, SHA-256 `e54ee3dda146a7ac68ef30f8cf62227ad86789d11720b8f33c97d9b948c02c58`. Sólo se devolvieron indicadores, tamaño, versión y hash; ningún valor de credencial ni fila del Libro.

La comprobación temporal fue retirada inmediatamente. La función definitiva versión 2 coincide byte por byte con los archivos versionados (la importación de tipos es eliminada por el empaquetador). En HTTP real: falta de sesión y JWT inválido → 401; origen ajeno → 403; preflight permitido → 204; credencial temporal retirada → 401. No se crearon usuarios ni sesiones de prueba en producción, ni se cambiaron registros o permisos.

El browser check del modo servidor ejecuta el `supabase-client.js` real, con SDK/red ficticios, además del lector, Worker e IndexedDB reales. Falta la observación final en la sesión personal del operador después de publicar; no se ha simulado ni extraído esa sesión.

Referencias: [credenciales Workspace](https://developers.google.com/workspace/guides/create-credentials), [descargas Drive](https://developers.google.com/workspace/drive/api/guides/manage-downloads), [resource keys](https://developers.google.com/workspace/drive/api/guides/resource-keys), [secrets Supabase](https://supabase.com/docs/guides/functions/secrets).
