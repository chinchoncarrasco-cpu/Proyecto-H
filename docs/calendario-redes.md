# Calendario de redes sociales

En `panel.html`: **Calendario → Redes sociales**. Reservas sigue siendo la vista inicial.

Para probar una foto inmediatamente: **Nuevo contenido**, escribir un título, dejar Publicación / Foto y elegir un JPG, PNG o WebP. La carga guarda también los campos de la ficha. Cerrar y volver a abrir muestra el archivo compartido. Las publicaciones previstas se abren directamente desde el mes, la agenda o la campaña.

El plan aprobado vive en `data/haiku-redes-2027.json`: rutina completa desde el 4 de noviembre de 2026 hasta diciembre de 2027. Noviembre incluye 27 historias diarias, 7 contenidos permanentes y 8 apoyos comerciales; diciembre, 31, 9 y 9 respectivamente. Los apoyos comerciales dependen de cupos verificados y el sábado es opcional. Los días previos al inicio no generan tareas retroactivas.

La extensión conserva los ocho contenidos previos de las campañas de Año Nuevo y verano y todo el plan 2027. Añade Navidad, una escapada alrededor del 8 de diciembre y nueve tareas de preparación semanal. El lunes 7 de diciembre no se considera feriado. `scripts/extend-redes-2026.cjs` reconstruye esta extensión de forma idempotente; los textos nuevos son propuestas para revisar antes de publicar.

Al editar una tarea se guarda una sobrescritura por ID; se conservan los contextos de campaña, estación y fecha objetivo. Los cambios del equipo prevalecen sobre el plan. El botón Actualizar recupera cambios de otros equipos; esta primera integración no usa Realtime ni publica en Meta.

## Material y estados

- Fotos: JPG, PNG, WebP, hasta 10 MB por archivo. Videos: MP4 o WebM, hasta 50 MB. Son límites de almacenamiento de trabajo; no equivalen a los límites de anuncios. No hay recorte, compresión, mejora automática ni conversión de HEIC/MOV.
- Foto y carrusel reciben imágenes. Historia de video y Reel reciben video. Reel admite una portada de imagen independiente.
- Los archivos se pueden previsualizar, descargar, reordenar, reemplazar o retirar. Se sube el reemplazo antes de retirar el anterior; si el retiro falla ambos quedan visibles para resolverlo sin pérdida del original.
- Una carga interrumpida conserva un registro para poder retirarla y reintentar. Nunca se presenta como archivo listo.
- Historia **del día**: el servidor exige que la fecha de la tarea sea hoy en `America/Santiago` y que el operador confirme captura del mismo día. Es una declaración del operador, no un análisis EXIF. Las historias comerciales y de refuerzo pueden prepararse antes.
- Con adjuntos, fecha y formato quedan bloqueados. Retirarlos permite cambiar esos campos. Agregar o retirar material devuelve la tarea a Material pendiente.
- Listo, Programado en Meta y Publicado requieren material. Estos estados son registros manuales del equipo; el calendario no agenda ni publica automáticamente en Meta.

## Persistencia y autorización

Migración aplicada: `20261104164121_calendario_redes_adjuntos.sql`. Crea únicamente `haiku_redes_posts`, `haiku_redes_assets`, funciones de validación/orden y el bucket privado `haiku-redes`. El permiso `redes.gestionar` se otorga a recepción, manager y administrador. No modifica reservas, bloqueos, pagos ni los buckets de evidencias.

RLS se aplica a filas y objetos. Las rutas pertenecen a registros de archivo reservados por el usuario de la carga, con UUID y sin sobrescritura. Las vistas previas usan enlaces firmados por 15 minutos, renovados mientras la ficha permanece abierta. La confirmación de un archivo verifica la presencia del objeto, su MIME y tamaño. La revisión de la tarea evita sobrescrituras de ediciones simultáneas. Al cerrar sesión se limpian las fichas, filas y enlaces en memoria.

## Verificación

`node --test tests/redes-sociales.test.cjs` cubre fechas de Chile, validación de material, filtros, plan, persistencia entre clientes, conflictos y recuperación de cargas. `tests/redes-sociales-sql.test.cjs` ejecuta la migración en Postgres/PGlite con RLS para recepción, manager, aseo y acceso anónimo, incluyendo rutas privadas y captura diaria. La dependencia de prueba es `@electric-sql/pglite@0.5.15`, instalada fuera del código servido. El workflow también ejecuta las regresiones del calendario de reservas.

La prueba de interfaz usa una imagen sintética y almacenamiento simulado aislado del panel de producción. La primera carga real debe comprobarse con la sesión habitual del equipo. Fechas escolares aún pendientes en el plan se muestran como pendientes; no se inventan períodos oficiales.
# Compartir sin sesión

Las ventanas del calendario se suspenden al activarse la cortina o el bloqueo visual de Haku y se restauran después de desbloquear. Se conserva el DOM del formulario, incluidos textos sin guardar; el PIN y su plazo de un minuto no cambian. Las aperturas asíncronas también esperan al desbloqueo. El cierre de sesión descarta la restauración pendiente.

El botón **Compartir**, junto a **Nuevo contenido**, permite activar y copiar un enlace exclusivo del calendario editorial. La dirección compartida es `https://calendario-editorial-haiku.fulgor.chatgpt.site/`, una publicación independiente que sirve sus propios archivos y no redirige ni incrusta GitHub Pages. Conserva la clave y el mes en el fragmento; los cambios guardados siguen leyéndose del endpoint social existente. La página `calendario-redes.html` no carga el panel, la sesión ni el cliente de reservas. En celular comienza en Agenda; conserva Mes, Año, Campañas y todos los filtros. Las fichas muestran indicaciones, textos y adjuntos sin controles de edición.

El enlace incluye una clave aleatoria de 256 bits en el fragmento, que no se envía al servidor de páginas ni como referencia a otros sitios. La tabla `haiku_redes_share` queda sin enlaces activos al instalar la migración. Solo usuarios con `redes.gestionar` pueden activarlo, rotarlo o desactivarlo. La lectura se realiza a través de la función `redes-calendar-share`, que comprueba la clave en cada solicitud y devuelve exclusivamente columnas sociales; excluye responsables internos, IDs de autores y rutas privadas. No concede acceso anónimo a tablas ni al bucket.

Los cambios guardados se leen al abrir, al pulsar Actualizar, al volver a la pestaña y cada minuto mientras está visible. Las fotos/videos se firman únicamente al abrir una ficha, por 5 minutos. Desactivar o rotar impide nuevas lecturas; no puede retirar copias ya descargadas y las URLs de archivos emitidas previamente caducan a los 5 minutos. Compartir abarca todos los meses, textos en preparación y adjuntos; el diálogo explica ese alcance antes de activar.

Desplegar primero la migración `calendario_redes_compartir` y la función `redes-calendar-share` con `verify_jwt=false`: la autorización de este endpoint es su clave de enlace, no una sesión de Haku. La función usa `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` solo en el servidor; no imprime claves ni acepta nombres de tablas, buckets o rutas del visitante. La versión de supabase-js está fijada en su importación. No activar un enlace real para probar: las pruebas de interfaz usan datos y archivos sintéticos.
