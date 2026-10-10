# Libro: documento de titular ocupado — hotfix local

Base verificada: `main` y `origin/main`, `7bbf56f25dcb785f8fb88853489536fea301991b`.
Rama de desarrollo: `fix/libro-identidad-documento-duplicado`.
El cierre autorizado publica el código y el SQL en Git; no instala la migration
ni ejecuta actualizaciones de identidad, reservas o pagos en producción.

## Causa y reproducción

La definición versionada está en
`supabase/migrations/20260908162301_haku_libro_prioridad_confirmada.sql`, extendida por
`20260908164318_haku_libro_validar_campos_conocidos.sql` y
`20261006231428_airbnb_prepaid_card.sql`.
`private.haiku_libro_actualizar_v1(jsonb)` valida el parche revisado, actualiza el cache
del titular en `reservas` y copia su identidad a `huespedes`. Su comprobación de
compartición anterior sólo miraba titulares de otras reservas; no comprobaba el
propietario del documento ni las referencias de las tablas de huéspedes.

Se reconstruyó esa cadena en PGlite con dos huéspedes ficticios y el índice real
informado: `UNIQUE (tipo_documento, numero_documento)` con ambos campos no nulos.
Actualizar A al documento de B produjo exactamente:
`23505: duplicate key value violates unique constraint "huespedes_documento_uidx"`.
La regresión falló antes del arreglo (`23505` en lugar de `HLI01`) y pasa después.
No se descargó el Libro ni se consultaron identidades productivas.

## Decisión segura

| Situación | Resultado |
| --- | --- |
| Documento pertenece al huésped ya asociado | Actualización revisada admitida, sin reasociar. |
| Documento libre y huésped no compartido | Se mantiene el contrato de edición revisada existente. |
| Documento pertenece a otra fila, incluso con nombre idéntico y documento anterior ausente | `HLI01`, revisión humana, rollback del lote. |
| Huésped compartido y cambio de identidad incompatible con su registro | `HLI02`, revisión humana, rollback del lote. |
| Huésped compartido e identidad coincidente | Se puede corregir el cache de la reserva; no se edita al huésped compartido. |
| Cambio ajeno a identidad en huésped compartido | Se conserva el comportamiento anterior; no se corrigen diferencias históricas de nombre automáticamente. |
| Documento ocupado durante la escritura | El índice rechaza; sólo esa restricción se traduce a `HLI01`. |

El documento aportado por el Libro y el nombre de una segunda fila no demuestran
que sea la misma persona que el huésped actualmente asociado. No se implementa
reasociación automática, fusión, eliminación ni sustitución artificial de documentos.
No cambian `titular_huesped_id`, `reserva_huespedes` ni `estadia_huespedes`.
Una reasociación futura requiere evidencia inequívoca y revisión expresa de esas
tres relaciones, sus restricciones reales y los huéspedes compartidos.

## Migration nueva (no aplicada)

`supabase/migrations/20261010034622_libro_identidad_documento_guard.sql`, creada con
el CLI local existente mediante `supabase migration new libro_identidad_documento_guard`.

- Parche incremental de la función privada, sin reemplazar su rama `pago_actualizar`.
- Guard del cuerpo auditado, MD5 de `prosrc` sin CR: `b9b1a3567ddc9b6ed79b9bca5867a143`.
  Otra definición o índice con distinta forma aborta la migration para revisión.
- Bloquea el huésped actual con `FOR UPDATE` y comprueba compartición por las tres vías:
  titular de otra reserva, `reserva_huespedes` y `estadia_huespedes` de otra reserva.
- Comprueba el propietario exacto del documento antes de las escrituras. El índice
  sigue siendo autoridad frente a una ocupación concurrente; no se desactiva ni altera.
- Mantiene owner `postgres`, ACL `{postgres=X/postgres}`, `SECURITY INVOKER` y
  `search_path = pg_catalog, public, private`; sin EXECUTE directo para authenticated/anon.
- Sin UPDATE de datos al aplicar la migration. No reescribe huéspedes, reservas,
  pagos, cargos o historia. Los efectos sólo ocurren al ejecutar posteriormente el writer.
- El RPC público, sus permisos, auditoría e idempotencia permanecen sin modificaciones.

Antes de aplicar en otro entorno debe comprobarse que su cuerpo e índice coinciden
con esos guards. La inspección remota previa de sólo lectura confirmó el MD5,
owner, ACL, invoker y search_path esperados, y la presencia de RLS en las tablas
implicadas. Esa fotografía no sustituye un preflight nuevo antes de instalar ni
prueba las políticas con las identidades operativas actuales.

## Frontend

`js/haiku-libro-consultas-v1.js` reconoce `HLI01`/`HLI02` como conflictos de datos,
invalida `solicitudPendiente` y exige volver a comparar y confirmar. También reconoce
el error legado únicamente por código `23505` y el mensaje exacto del índice confirmado;
no muestra el DETAIL que puede contener el documento. Otros índices no se traducen.

El paso de identidad mantiene su selección inicial. Permite seleccionar manualmente
reservas nuevas sin dependencias, después de desmarcar las actualizaciones conflictivas.
Los pagos dependientes siguen no aprobables y fuera del envío hasta guardar la identidad
y revalidar. No se excluyen ítems automáticamente ni se reenvía un subconjunto sin confirmación.
Guardar sólo altas no muestra falsamente “titular y RUT actualizados”: el siguiente plan
conserva el paso de identidad si quedan dependencias.

La atomicidad comprobada corresponde a `haiku_incorporar_libro_v1`: una excepción en
identidad revierte altas, pagos, aplicaciones, auditoría y operación idempotente de ese
RPC, aunque su cuerpo procese los pagos antes de las actualizaciones. No se modifica
el protocolo separado de pagos de servicios 4C ni se afirma atomicidad entre RPC distintos.
Una llamada 4C ya confirmada no se revierte porque falle después el RPC general;
su resultado debe consultarse antes de reintentar. El paso de identidad excluye
los pagos dependientes del envío. No se afirma que intentos productivos anteriores
no hayan escrito: no se dispone de sus identificadores ni de su plan actual.

## Pruebas y ejecución

Se usan Node v24.21.0, PGlite y Playwright ya disponibles en cachés locales.
Para ejecutar los tests SQL/browser se configura `NODE_PATH` con esos módulos;
el recorrido XLSX de la suite usa la caché existente `HAIKU_LIBRO_WORKER_ASSETS`.
No se instalaron dependencias. Las pruebas usan clientes sintéticos y PostgreSQL
local; no acceden a Google ni ejecutan writers en Supabase productivo.

1. RED: `HAKU_IDENTIDAD_RED=1 node --test --test-name-pattern="^documento de otro huésped" tests/libro-identidad-documento-postgres.test.cjs`.
   **1 FAIL**, error original `23505`, esperado `HLI01`.
2. `node --test tests/libro-identidad-documento-postgres.test.cjs tests/airbnb-libro-writers-postgres.test.cjs tests/libro-fullday-postgres.test.cjs`.
   **26 PASS / 0 FAIL / 0 SKIP**: 14 del hotfix y 12 regresiones previas.
3. Focal frontend: seis tests nuevos en `tests/haiku-libro-reconciliacion.test.cjs`,
   mediante `--test-name-pattern="identidad conflictiva|conflicto de identidad|persona nueva|otro índice unique"`.
   **6 PASS / 0 FAIL / 0 SKIP**.
4. Suite aplicable de Libro: 58 archivos `.test.cjs`, excluyendo los `postgres`,
   seleccionados por los prefijos `haiku-libro-`, `haku-libro-`, `libro-`,
   `haiku-servicios-identidad`, `haiku-servicios-idempotencia`,
   `servicios-hidratacion-contextos`, `sites-libro-v1`, `supabase-libro-google-carga`.
   **1.387 PASS / 0 FAIL / 0 SKIP**.
5. `node tests/libro-identidad-documento-browser-check.cjs`:
   **PASS 1100/390 px**, error legado real → revisión, dos altas sintéticas seleccionadas,
   cero pagos enviados, cero solicitudes externas. Ejecuta los callbacks reales de Haku.
6. `node tests/libro-comparacion-readonly-browser-check.cjs`:
   **PASS 1100/390 px**, paridad Web, tres núcleos, DTO sin IDs persistentes, cero mutaciones.
7. `node tests/libro-informe-readonly-web-browser-check.cjs`:
   **PASS 320/360/390/1100 px**, login canónico 390/1100, XLSX/worker reales sobre fixture
   anonimizado, M2, descarte por cambio de usuario, cero writers/tokens en URL.
8. `git diff --check`: **PASS**. Los archivos nuevos se comprueban además con
   `git diff --no-index --check` contra un archivo vacío.

### Cierre tras anonimización

La anonimización aprobada se conserva en el test de reconciliación, los ejemplos
del frontend y la fixture de apoyo `tests/fixtures/libro-pagos-sep26.cjs`.
Se alinean exclusivamente identidades ficticias, aliases de helpers y referencias
de comprobantes en estos cuatro consumidores de la fixture:

- `tests/haiku-libro-pagos-destinos-integracion.test.cjs`
- `tests/haiku-libro-pagos-encabezado.test.cjs`
- `tests/haiku-libro-pagos-focalizados.test.cjs`
- `tests/libro-oct26-anclas.test.cjs`

Los cinco FAIL heredados procedían de expectativas anteriores a la anonimización.
No se cambian las reglas productivas, importes, fechas, operadores ni el número
de aserciones: los cuatro archivos conservan respectivamente 71, 14, 22 y 12.
Los 11 RUT distintos siguen representando siete válidos y cuatro inválidos según
módulo 11. Se preservan igualdad, diferencias, asociaciones y colisiones de pago.
No se publica una tabla de correspondencias ni valores originales.

Validación del cierre:

- Cuatro consumidores afectados: **41 PASS / 0 FAIL / 0 SKIP**.
- Suite de Libro anterior (58 archivos) más `bove-evidencias.test.cjs`:
  **1.398 PASS / 0 FAIL / 0 SKIP**; son 1.387 más 11 controles de evidencia.
- Reconciliación completa y las tres suites SQL indicadas:
  **186 PASS / 0 FAIL / 0 SKIP**; 160 de frontend y 26 SQL.
- Navegador: hotfix y comparación readonly **1100/390 PASS**; informe
  **320/360/390/1100 PASS**, incluyendo login en 390/1100.
- La migration y el frontend conservan sus hashes aprobados. PostgreSQL local
  informa **17.5 / server_version_num 170005**, mediante PGlite (WASM).

Se revisó la compatibilidad con [CREATE OR REPLACE FUNCTION en PostgreSQL 17](https://www.postgresql.org/docs/17/sql-createfunction.html),
los [diagnósticos de excepciones PL/pgSQL](https://www.postgresql.org/docs/17/plpgsql-control-structures.html)
y el [catálogo pg_index](https://www.postgresql.org/docs/17/catalog-pg-index.html).
No es una ejecución multisesión en el servidor productivo.

El alcance final son **13 archivos**: los ocho del hotfix, la fixture de apoyo y
los cuatro consumidores anteriores. Los respaldos de revisión se conservan fuera
del repositorio; no se agregan ZIPs, diagnósticos, capturas ni logs al commit.
El saneamiento del árbol actual no borra referencias de commits históricos ni
respaldos privados. No se reescribe historia Git en este cierre.

### Activación productiva pendiente

Publicar en main puede actualizar el frontend mediante GitHub Pages, pero no
instala `20261010034622_libro_identidad_documento_guard.sql`. Antes de instalarla,
con autorización independiente, verificar nuevamente el cuerpo/índice/ACL reales,
guardar la definición anterior para recuperación y aplicar la migration por el
procedimiento controlado habitual. Si un guard aborta, detenerse y revisar; no
editar el guard ni desactivar el índice. Una recuperación requiere restaurar la
definición anterior auditada en una nueva migration autorizada; no modificar datos.

Después, reconstruir la consulta actual y resolver cada identidad por evidencia
de reserva, estadía y documento. Documentos de otra fila requieren revisión humana;
no se fusionan personas ni se reasocia automáticamente. Guardar sólo actualizaciones
válidas seleccionadas, volver a comparar y preparar sus pagos dependientes.
No usar una copia antigua del Libro como autoridad ni asumir que los dos pagos
operativos ya están desbloqueados.

Los casos SQL verifican documento ocupado, homónimo sin documento anterior, mismo
huésped, las tres vías de compartición, permisos/sesión, rollback de lote con alta y pago,
retry con misma operación, segunda operación sin duplicar comprobante, conservación
de asociaciones/auditoría y guards de cuerpo/índice. Toda la rama financiera del updater
se compara byte a byte antes/después.

## Límites y revisión pendiente

- El caso operativo pendiente requiere verificar cabaña, fechas e identidad, incluida
  cualquier coincidencia documental. No se consultaron ni modificaron sus registros.
  No se autoriza un alta por nombre; el control sintético conserva un homónimo con
  otra CAB/documento que no permite una asociación automática.
- Las cuatro actualizaciones y los dos pagos reales no se han ejecutado. Los documentos
  de otra fila continúan requiriendo revisión humana; este hotfix no determina su identidad real.
- PGlite reproduce PostgreSQL y el índice informado; FKs/PKs de asociación reflejan los
  fixtures versionados. No sustituye la comprobación de restricciones, RLS y permisos
  productivos antes de aplicar. El trigger de auditoría local es sintético.
- La ocupación en la ventana de escritura se reproduce mediante un trigger determinista;
  no constituye una prueba de concurrencia multisesión en el servidor real.
- No se ejecutaron integraciones SQL contra Supabase ni toda la colección histórica de
  tests PostgreSQL; se ejecutaron las tres suites SQL indicadas. El helper previo conserva
  su limitación representativa del writer checkout no versionado, que este hotfix no toca.
- La diferencia histórica de 34 frente a 41 hallazgos sigue pendiente y fuera del alcance.
- Sin cambios en permisos, OAuth, Drive, Mobile, semántica de asociación o reglas financieras.

Alcance funcional original del hotfix: dos modificados (`js/haiku-libro-consultas-v1.js`,
`tests/haiku-libro-reconciliacion.test.cjs`) y seis nuevos (migration, los dos fixtures
`libro-identidad-documento*.cjs`, test PostgreSQL, browser check y este README).
