# Libro → actualizaciones → pagos

Base: `cfcf23b61e0136642124a5852efaa3f391a5242e`.
Rama local: `fix/libro-actualizaciones-pagos-progresivos`.

Desarrollo local sin commit, push, merge, deploy ni acceso a Supabase productivo.
La migration histórica `20261010034622_libro_identidad_documento_guard.sql`
permanece sin cambios y no se instala en ningún entorno persistente.

## Causa y comportamiento corregido

El conflicto documental anulaba la solicitud y convertía el botón principal en
`Volver a comparar`. Ese botón seguía forzando el retorno aunque el usuario
desmarcara el elemento conflictivo. Al preparar otra vez se reconstruían las
selecciones por defecto, de modo que reaparecía el lote que había fallado.
Además, el filtro global del paso de identidad impedía seleccionar un pago ya
independiente mientras otra reserva seguía pendiente.

Ahora las cuatro actualizaciones de identidad son revisables. Un `HLI01`/`HLI02`
que identifica un elemento exacto conserva esa actualización en Casos pendientes,
junto con el bloqueo de sus pagos. La marca vive sólo en esa consulta y usuario;
una propuesta de identidad distinta debe revisarse de nuevo. Nunca se fusionan
huéspedes ni se desactiva el índice de documentos.

Con el writer legado, el error `23505` del índice exacto se reconoce sin mostrar
su DETAIL. Si un lote contiene varios elementos y el servidor no identifica la
actualización conflictiva, no se acusa ni se excluye automáticamente otra fila.
El usuario puede desmarcar los casos que requieren revisión y confirmar una
selección independiente; esa selección se vuelve a validar antes del RPC.

Volver a comparar conserva tanto seleccionados como desmarcados cuando siguen
coincidiendo usuario, generación, destino, payload y dependencias. Los elementos
cambiados o recién habilitados requieren selección nueva. Ningún subconjunto
se reenvía automáticamente tras un conflicto.

Cada pago exige que sus actualizaciones necesarias ya estén confirmadas y su
destino financiero permanezca inequívoco. Las correcciones de estadía necesarias
también preceden al pago. Adultos y otros cambios opcionales conservan sus reglas;
no se inventan dependencias nuevas. Las altas independientes permanecen elegibles,
y un pago de una reserva nueva conserva la referencia atómica `reserva_ref`.

La confirmación vuelve a comprobar pagos existentes. Un destino o payload financiero
distinto del mostrado exige otra revisión, incluso cuando el nuevo destino es único.
Los reintentos de red conservan operación y solicitud; mientras su resultado está
pendiente no se cambia la selección ni se sale mediante el botón Volver. La función
también rechaza cambios de selección programáticos antes de reenviar.

Después de guardar actualizaciones se relee Proyecto H y se muestran los pagos
habilitados, sin confundir un conflicto pendiente con una actualización completada.
Si esa relectura falla, se muestra el éxito confirmado y se pide volver a comparar;
no se presenta como fallo de escritura. Guardar un pago independiente muestra su
resultado aunque todavía queden identidades pendientes. Cada render reemplaza
la vista anterior para evitar controles y encabezados duplicados.

El RPC general conserva su atomicidad. Los pagos de servicios 4C siguen teniendo
operaciones separadas: si alguno fue confirmado antes de un conflicto del lote
general, el aviso reconoce ese resultado y la comparación comprueba su existencia.
No se promete rollback entre RPC distintos. Esto es coherente con el
[alcance del rollback en bloques PL/pgSQL](https://www.postgresql.org/docs/17/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING).

## Pruebas locales

Node `24.17.0`; PGlite `0.5.8` con PostgreSQL `18.3`; Playwright `1.64.0`
y Microsoft Edge instalado. Los módulos se instalaron únicamente bajo
`$env:TEMP\proyecto-h-flujo-testdeps`, sin cambiar dependencias del repositorio.

En PowerShell:

```powershell
$env:NODE_PATH = Join-Path $env:TEMP 'proyecto-h-flujo-testdeps\node_modules'
node --test tests/libro-actualizaciones-pagos-flujo.test.cjs tests/haiku-libro-reconciliacion.test.cjs tests/haiku-libro-pagos-destinos-integracion.test.cjs tests/haiku-libro-pagos-focalizados.test.cjs tests/haiku-libro-pagos-aprobacion-manual.test.cjs tests/haiku-libro-medio-pago-manual.test.cjs
node --test tests/libro-actualizaciones-pagos-flujo-postgres.test.cjs tests/libro-identidad-documento-postgres.test.cjs tests/airbnb-libro-writers-postgres.test.cjs tests/libro-fullday-postgres.test.cjs
node tests/libro-actualizaciones-pagos-flujo-browser-check.cjs
node tests/libro-identidad-documento-browser-check.cjs
git diff --check
```

- Regresiones focalizadas: **271 PASS, 0 FAIL, 0 SKIP**, incluidos 14 casos nuevos.
- PostgreSQL efímero: **28 PASS, 0 FAIL, 0 SKIP**; se volvieron a comprobar
  los dos recorridos nuevos después del control adicional de destino financiero.
- Navegador nuevo: **1100/390 px**, con y sin conflicto; selección restaurada,
  pago independiente, dos pagos cuando todas sus dependencias están confirmadas,
  reintento con la misma operación y omisión posterior de pagos existentes.
- Navegador histórico: **1100/390 px**, error legado y dos altas independientes,
  sin pagos enviados. Ambos browser checks bloquean conexiones externas.

El escenario SQL integra el frontend real con los RPC versionados: cuatro
actualizaciones fallan de forma atómica por una identidad, tres se confirman,
el primer pago queda habilitado, el segundo sigue bloqueado y sólo avanza después
de corregir la evidencia sintética y revisar su asociación. Los dos comprobantes
terminan registrados una vez, conservando huéspedes y asociaciones ajenas.

Se comprueban además una selección forzada, cambios de usuario o payload, pago
aparecido entretanto, cambio de reserva financiera, lote mixto legado sin item_id,
corrección necesaria de fechas y escritura confirmada con relectura fallida.
Todos los datos nuevos son sintéticos. No se inspeccionan identidades reales.

PGlite verifica PostgreSQL real compilado a WASM en una base efímera, con SQL
versionado y permisos representados por los fixtures. No sustituye una prueba
multisesión ni la comprobación de RLS, permisos y definiciones del servidor
productivo. No se ejecutan migrations remotas ni SQL sobre datos productivos.

## Activación posterior

La migration existente es suficiente para este cambio: entrega conflictos
tipados con `item_id`, mantiene el índice único, protege huéspedes compartidos
y conserva auditoría, permisos e idempotencia. Este desarrollo no añade SQL.

Falta revisar y publicar los cambios locales de esta rama por el procedimiento
habitual. La publicación del frontend no instala la migration de Supabase.
Con autorización posterior, comprobar nuevamente el cuerpo/índice/ACL frente
a sus guards, guardar la definición anterior y aplicar la migration existente.
Si un guard falla, detener la instalación y revisar la diferencia.

Después, reconstruir la consulta con el Libro vigente y la sesión operativa,
verificar cada destino, confirmar sólo actualizaciones válidas y comprobar los
pagos existentes antes de confirmar los pendientes. Un documento de otro huésped,
una identidad compartida incompatible, una asociación ambigua o un destino
financiero no único siguen exigiendo revisión humana. Si ambos pagos dependen
de una identidad sin resolver, ambos permanecen bloqueados.

Las pruebas sintéticas no establecen qué identidades o dependencias tienen los
dos pagos reales. Esa verificación operativa queda para la activación autorizada.
