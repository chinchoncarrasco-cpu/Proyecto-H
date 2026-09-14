# Liberación individual desde el Libro

Migración local pendiente de despliegue:
`supabase/migrations/20260914155231_liberar_bloqueo_libro_seguro.sql`.

RPC nueva: `haiku_liberar_bloqueo_libro_seguro(uuid, integer, date, date, text, timestamptz)`.
La función del calendario permanece intacta. No hay DELETE físico ni lote de liberación.

Haku conserva el snapshot mostrado, incluida la precisión original de `actualizado_en`.
Después de la confirmación vuelve a consultar el mismo periodo con el comparador existente,
exige pertenecer aún a `solo_proyecto_h`, relee el ID y contrasta todos los campos.
Una generación distinta invalida la propuesta. La RPC contrasta la identidad y versión
bajo `FOR UPDATE` sobre bloqueo y cabaña. Un conflicto produce SQLSTATE `40001` y cero updates.
Si ya no existe o no está activo, devuelve un resultado idempotente sin alterar auditoría.

## Validación local

- `node --test tests/libro-bloqueos-retiro.test.cjs`
- `node --test tests/*.test.cjs`
- Configurar `HAKU_PGLITE_MODULE` a la instalación existente de `@electric-sql/pglite`,
  luego `node tests/bloqueos-retiro-postgres.cjs`: PostgreSQL efímero sin red.
- Concurrencia: `node tests/bloqueos-retiro-concurrencia.cjs` requiere `psql` y una base
  **nueva, vacía y desechable** en localhost. Configurar `HAKU_BLOQUEOS_TEST_DATABASE`
  con prefijo `haku_bloqueos_test_`, `HAKU_BLOQUEOS_TEST_PSQL` y opcionalmente
  `HAKU_BLOQUEOS_TEST_HOST/PORT/USER/PASSWORD`. No usa credenciales del proyecto.
  Verifica espera real del lock, rechazo de versión concurrente y liberación idempotente.

La prueba de dos conexiones queda preparada pero pendiente: en el entorno disponible
hay PGlite, no un servidor PostgreSQL local/psql. No confundirla con escenarios seriales.

## Límites y despliegue

- No se desplegó esta migración ni se ejecutó liberación real. Hasta desplegarla, la
  confirmación real no puede completar la escritura; no existe fallback al writer antiguo.
- La base de datos no conoce el XLSX. Su ausencia se comprueba en Haku; el backend
  protege los datos de Proyecto H aprobados. Un cambio del Libro posterior al envío de
  la RPC no se puede revertir automáticamente.
- Un fallo de red después del envío exige reconsulta, nunca reintento automático.
- No crear otra función con igual nombre/parámetros: aplicar esta migración una vez
  mediante el historial, cuando se autorice el despliegue.
