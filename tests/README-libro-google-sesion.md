# Conexión Google del panel al recargar

## Problema comprobado

El conector guardaba `accessToken` y su vencimiento exclusivamente en variables
JavaScript. F5 los borraba aunque Google aún permitiera usar ese acceso. El polling
se detenía y Haku dejaba de recibir versiones nuevas para sus avisos.
La revisión normal ocurría cada 60 segundos.

## Comportamiento

- Conserva el permiso temporal en `sessionStorage` de la pestaña, con su fecha
  original de vencimiento, usuario Haku, cliente OAuth y archivo fijo.
- Recupera únicamente después de validar la sesión Haku del mismo usuario. Espera
  la restauración del Libro antes de sincronizar, conservando la versión anterior
  que permite detectar cambios. No abre OAuth por F5 ni por una comparación.
- Borra el permiso al desconectar, cerrar sesión, cambiar de usuario, vencer o
  recibir un 401. La renovación de Supabase del mismo usuario no desconecta Google.
- Revisa metadata cada 15 segundos mientras la página está visible y al recuperar
  foco, visibilidad o internet. Agrupa eventos cercanos y no solapa sincronizaciones.
- Detecta cambios de versión/checksums/tamaño además de fecha. Al recuperar una
  copia usa SHA-256 para comprobar coincidencia; si no está disponible, descarga.
  El lector existente evita avisos duplicados cuando los bytes son idénticos.
- Reintenta tras errores temporales conservando el permiso. Un timeout de red de
  30 segundos libera la sincronización. Descargas tardías tras logout se descartan.
- Muestra la última comprobación y distingue un permiso vencido/revocado.
- Conserva la verificación de fuente y el modo del informe readonly independiente,
  que no lee ni escribe este permiso de sesión. El cambio de persistencia corresponde
  al panel; no activa comparaciones ni registros automáticos de negocio.

## Alcance y límite pendiente

Esto resuelve F5 en la misma pestaña mientras el permiso Google sigue vigente.
No mantiene acceso después de su vencimiento ni garantiza continuidad al cerrar
la pestaña. Tampoco reemite avisos antiguos por una simple recarga.

No almacena refresh tokens, claves de cuenta de servicio o client secrets. El
access token temporal sigue siendo accesible a JavaScript del mismo origen, ahora
también en sessionStorage; se limita al usuario y a su vencimiento real. No se
incluye en logs, estado público, URLs, localStorage o IndexedDB. Si el navegador
bloquea sessionStorage, funciona en memoria y no puede sobrevivir a F5.

El modelo GIS actual exige una acción del usuario para obtener otro token al
vencer: https://developers.google.com/identity/oauth2/web/guides/use-token-model

Para conexión continua durante toda la jornada hace falta una lectura autenticada
desde el servidor, con renovación segura. El proyecto contiene helpers de cuenta
de servicio, pero no hay una Edge Function de lectura del Libro desplegada en la
lista consultada el 2026-10-25. Falta configurar credenciales de servidor y otorgar
acceso lector al archivo, o configurar OAuth offline con refresh token protegido.
Este cambio no instala ese backend ni presenta el permiso del navegador como permanente.

## Validación reproducible

`node --test tests/libro-google-sesion.test.cjs tests/libro-web-fuente-oficial.test.cjs tests/supabase-libro-google-carga.test.cjs tests/haiku-libro-auto.test.cjs tests/libro-informe-readonly-web.test.cjs`

189 pruebas aprobadas, incluyendo 25 casos nuevos de sesión, expiración, cambio de
usuario, almacenamiento bloqueado, cortes de red, respuestas tardías y sincronización.

`node tests/libro-google-sesion-browser-check.cjs` usa Playwright, un Chromium local
configurable mediante `HAIKU_BROWSER_EXECUTABLE` y las dependencias locales del
Worker en `HAIKU_LIBRO_WORKER_ASSETS`. Google/Auth son ficticios; lector, Worker,
IndexedDB y avisos son reales. Verifica F5, ausencia de OAuth, versión nueva con
un aviso, repetición sin duplicados, comparación verificada, logout y claro/oscuro.
No realiza peticiones a servicios externos ni modifica registros de negocio.
