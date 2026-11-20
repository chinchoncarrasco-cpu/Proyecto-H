# Huéspedes V1.1

El directorio usa `huespedes`, `reservas`, `reserva_estadias`, `reserva_huespedes` y `estadia_huespedes`. El titular y los acompañantes se determinan por reserva. Los vínculos de una persona en reservas de un mismo grupo se cuentan como una visita en el historial. Los borradores se identifican con una clave estable por reserva y plaza. Una plaza guardada que excede la ocupación sigue visible y puede marcarse como revisada.

La migración [20261120205010_haku_huespedes_v1_1.sql](../supabase/migrations/20261120205010_haku_huespedes_v1_1.sql) incorpora el perfil operativo, etiquetas, registros, vehículos, mascotas y fotos. Requiere el guard existente de identidades RUT. Conserva los datos manuales separados de las importaciones de reservas. Reutiliza `huespedes.ver`, `huespedes.gestionar` y `reservas.ver`. El bucket `haiku-huespedes` es privado y los clientes usan URLs firmadas de corta duración.

## Orden de activación

1. Revisar la migración en un entorno aislado y confirmar los permisos de los roles que usarán Huéspedes.
2. Tras la autorización, aplicar la migración al entorno que usarán ambos clientes. Verificar consultas, escrituras y fotos con una cuenta autorizada y otra sin acceso.
3. Habilitar los clientes aprobados con el mismo entorno y verificar el flujo completo. La APK candidata requiere la migración para que Huéspedes pueda consultar y guardar datos.

## Pruebas reproducibles

- [Fixture del esquema](../tests/fixtures/huespedes-schema.sql) y [recorrido PostgreSQL](../tests/huespedes-v1-postgres.test.sql) para una base temporal con datos ficticios. Cargar el esquema, aplicar la migración y ejecutar el recorrido.
- [Recorrido de navegador](../tests/huespedes-browser-check.cjs) con Playwright y PGlite. `HAKU_GUEST_SHOTS` permite elegir la carpeta de capturas. Con `HAKU_GUEST_NATIVE_PREVIEW` apuntando a la salida de `tests/prepare-huespedes-browser.cjs` de Haku-Mobile, verifica el intercambio de datos entre web y los componentes Android renderizados en el navegador.
- Vinculación concurrente con `node tests/huespedes-vinculacion-postgres.test.cjs` y `pg`. Usar `HAKU_GUEST_TEST_DATABASE` con la URL de una base PostgreSQL local vacía en la que solo se hayan cargado el esquema de prueba y la migración.
- Para comprobar el guardado demorado y la exclusión de integrantes en ambos clientes, preparar la vista Android y ejecutar `node tests/huespedes-browser-check.cjs --correcciones`.
