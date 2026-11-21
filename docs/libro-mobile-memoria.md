# Libro móvil · copias locales y conexión automática

El visor activo de Android es la página web dentro de una WebView con almacenamiento local habilitado. El lector de la página desactivaba la persistencia por debajo de 901 px. La conexión de lectura del servidor está desplegada y respondió correctamente a solicitudes de Android durante la investigación; eso no acredita que la copia haya llegado al visor del teléfono.

El panel conserva ahora el Libro actual y el anterior en IndexedDB a cualquier ancho. Reutiliza la misma transacción, comparación de bytes, rotación y eliminación de PC. Al abrir, restaura la copia local antes de sincronizar con Google. Archivos idénticos no reemplazan la anterior ni emiten avisos repetidos. La primera descarga crea la copia actual; la anterior aparece con una segunda versión distinta. Cada navegador o aplicación conserva sus propias copias: no se transfieren desde el PC.

La conexión inicia los reintentos de lectura antes de la primera respuesta correcta. Un fallo inicial ya no queda esperando exclusivamente un evento de foco o conexión: vuelve a intentar cada 15 s mientras la página está visible. También reacciona a la preparación del cliente y a la entrada en Libro. Respeta pausa, sesión, deduplicación y descarte de respuestas tardías.

El informe independiente conserva su modo de memoria. La burbuja móvil, que utiliza otra WebView, tampoco escribe ni rota las copias del visor. No se modifican el XLSX oficial, funciones servidor, base de datos, permisos, writers ni APK.

Validación: regresiones de fuente verificada, sesiones, comparación de versiones, errores de guardado, readonly y visor. Chromium ejecutó lector, Worker e IndexedDB reales a 390 y 1100 px en claro/oscuro, con servidor y archivos de prueba locales: restauración al recargar y reabrir una vista, dos snapshots con hashes exactos, cambio de versión, deduplicación, comparación verificada y cierre de sesión. El informe readonly pasó sus recorridos de 320 a 1100 px, sin IndexedDB ni escrituras de negocio. [Estados visibles del Libro](evidencia/libro-mobile-memoria/).

Reproducción: `node --test tests/libro-google-sesion.test.cjs tests/haiku-libro-auto.test.cjs tests/libro-indice-lectura.test.cjs tests/libro-informe-readonly-web.test.cjs tests/libro-web-fuente-oficial.test.cjs tests/supabase-libro-google-carga.test.cjs tests/sites-libro-v1.test.cjs`. Para navegador: `tests/libro-google-sesion-browser-check.cjs`, con `HAIKU_LIBRO_SERVER=1`, `HAIKU_LIBRO_VIEWPORT=390` o `1100`, `HAIKU_LIBRO_WORKER_ASSETS` y un Chromium local en `HAIKU_BROWSER_EXECUTABLE`.

Pendiente de autorización para publicar y de comprobación en la WebView del teléfono. Se distribuye como actualización web; al activarla basta recargar el visor o cerrar y volver a abrir Haku. La copia local permite recuperar el Libro cuando el panel ya está cargado; no convierte toda la aplicación web en una aplicación sin conexión.
