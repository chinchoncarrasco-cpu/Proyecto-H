# Revisión del contrato canónico de Cierre de turno

Cambios preparados exclusivamente en `codex/alinear-cierre-turno-canonico`. La migration corrige la derivación de llaves y unifica la definición de cierre limpio que usan el estado y el trigger. No se ha aplicado a Supabase remoto. No se realizaron commits, push ni merge.

## Archivos del review pack

- [Migration append-only](../supabase/migrations/20261002011039_alinear_cierre_turno_canonico.sql).
- [Prueba SQL transaccional](../tests/cierre-canonico.integration.sql).
- [Runner y prueba de integración Web](../tests/cierre-canonico.test.cjs).
- [Funciones originales](../tests/fixtures/cierre-funciones-originales.sql), [schema y catálogo de prueba](../tests/fixtures/cierre-schema.sql) y [triggers de prueba](../tests/fixtures/cierre-triggers.sql).

Todos son archivos nuevos. No se editaron migrations históricas ni archivos de la UI.

## Causas verificadas

La inspección productiva se realizó mediante transacciones `READ ONLY`, consultando definiciones de funciones, columnas, constraints, índices, triggers y catálogo. No se descargaron respuestas de huéspedes ni cierres históricos. Captura: 1 de octubre de 2026 en Santiago; el CLI creó el nombre de la migration con fecha UTC del 2 de octubre.

`llaves_retiradas` sigue siendo obligatorio, global y de tipo opción. La Web no tiene el radio que antes lo respondía; únicamente guarda `llaves_recepcion`, JSON opcional. No existía relación automática entre esas respuestas.

El estado acepta una CAB con sus siete controles completos aunque `cabana_ocupada` esté ausente o pendiente/false. El trigger exigía además una respuesta confirmada/no_corresponde de ocupación. También diferían al evaluar booleanos confirmados false y el efecto de no_corresponde sobre la ocupación. El runner demuestra primero el rechazo contradictorio con las funciones originales y luego ejecuta la migration local.

## Derivación de llaves

La integración se resuelve dentro de la RPC existente `haiku_guardar_respuesta_cierre`, conservando firma, permisos y respuesta pública. Se eligió esta ubicación porque dos llamadas desde Web podrían quedar parcialmente guardadas y obligarían a duplicar la lógica en Mobile.

Al guardar `llaves_recepcion` confirmado, las claves `tonel`, `jacuzzi`, `lavanderia`, `masajes`, `generadores`, `jardineria`, `marcelo`, `cisterna`, `internet`, `gas11` y `torreon` deben ser booleanos JSON true. Las 11 completas generan `llaves_retiradas` confirmado con valor `"si"`. Una clave false, ausente, null o de otro tipo deja la respuesta derivada pendiente con valor JSON null. Un detalle pendiente tampoco confirma la respuesta derivada.

El JSON original se conserva íntegro. La respuesta derivada se guarda por la misma RPC y sus índices únicos hacen upsert, sin duplicados. Ambos guardados pertenecen a la misma transacción; un fallo revierte ambos. El bloqueo de la fila del cierre serializa las escrituras y vuelve a verificar que siga editable. No se añade control visual ni se usa localStorage como autoridad.

La migration no hace backfill ni modifica respuestas anteriores. Un cierre editable con las once llaves guardadas antes del despliegue se sincroniza al volver a guardar el detalle mediante la RPC. Los snapshots históricos permanecen intactos.

## Definición compartida de cierre limpio

La función interna `private.haiku_evaluar_cierre(uuid)` concentra el cálculo antes usado por el estado y las comprobaciones bloqueantes del trigger. Tanto `haiku_estado_cierre_dia` como `haiku_validar_cierre_turno` consumen el mismo resultado.

Para cada CAB activa, ocupada confirmada true o no_corresponde cuenta como 1/1 según la semántica del estado existente. En caso contrario se evalúan los controles activos obligatorios de CAB distintos de ocupación: actualmente son siete. Una respuesta no_corresponde satisface un control; un booleano confirmado requiere valor true. No se exige contestar artificialmente ocupación. Los futuros controles obligatorios entran por catálogo, sin una lista SQL cerrada de siete códigos.

Los bloqueantes conservan su semántica previa: confirmado/no_corresponde satisface el item; ocupada confirmada true exime otros bloqueantes de CAB. No_corresponde en ocupación no exime esos bloqueantes. Si ocupación misma se configura como bloqueante, su respuesta sigue siendo exigible. Ambas formas de cierre siguen rechazando bloqueantes pendientes.

`puede_cerrar_limpio` significa pendientes obligatorios igual a cero **y** ausencia de bloqueantes. Los contadores mantienen su contrato de controles obligatorios: un bloqueante opcional puede dejar pendientes=0, pero puede_cerrar_limpio=false. Nunca se promete cierre limpio en ese caso. El trigger utiliza exactamente el mismo predicado para aceptar `cerrado`.

La invariante se prueba ejecutando la RPC real: cuando pendientes=0 y puede_cerrar_limpio=true, el cierre termina en `cerrado`, sin rechazo contradictorio del trigger. Esto supone que las respuestas y el catálogo no cambien entre la consulta y la acción.

## Contratos preservados

Se reemplazan únicamente las funciones de estado, validación del cierre y guardado de respuesta; se añade un helper privado SECURITY INVOKER con search_path explícito y ejecución revocada a PUBLIC/anon. CREATE OR REPLACE conserva los grants de las RPC existentes. No se modifica RLS, ni se introduce SECURITY DEFINER o service_role en frontend.

Permanecen los permisos `cierres.ver`, `cierres.realizar`, `cierres.reabrir`, `cierres.validar_pagos`, `cierres.validar_caja` y `cierres.validar_vale_salida`. La derivación no omite las validaciones de respuesta.

Las RPC de asegurar cierre, novedades, cierre y reapertura conservan sus definiciones. Se mantienen los cuatro estados, resumen obligatorio ante pendientes, snapshot, evidencias y reapertura con motivo. No se modifica el catálogo ni se crea otro sistema de cierre.

## Validación local

El runner requiere Node y `@electric-sql/pglite` 0.3.14. La dependencia se instaló en una carpeta temporal fuera del repositorio. Puede indicarse su ruta con `HAKU_PGLITE_MODULE`; no se usa DATABASE_URL ni se abre una conexión remota.

```powershell
$env:HAKU_PGLITE_MODULE = '<ruta-local>/node_modules/@electric-sql/pglite'
node --test tests/cierre-canonico.test.cjs tests/sites-cierre-v1.test.cjs
git diff --check
```

La prueba SQL usa BEGIN/ROLLBACK. El runner verifica después que no queden turnos, cierres, respuestas, cabañas, auditorías ni items de prueba. PGlite es efímero y se cierra siempre. Los fixtures replican columnas, constraints, catálogo y las funciones/trigger relevantes; Auth y el resolvedor de permisos son dobles controlados. No reproducen toda la RLS, la auditoría general ni concurrencia entre conexiones. Las comprobaciones de permisos prueban las rutas reales de RPC/trigger contra esos dobles; no sustituyen una prueba de integración de roles en staging.

Cobertura:

| Requisito | Comprobación |
| --- | --- |
| 1–4 | Once true confirman; una false revoca; JSON conserva las once; upsert sin duplicados |
| 5–9 | Matriz de 64 combinaciones de ocupación, valor y 0–7 checks; cierre real cuando el estado promete limpio; rechazo directo del trigger en los demás casos |
| 10–11 | Con pendientes y resumen cierra; sin resumen o con espacios rechaza |
| 12 | Bloqueantes globales/CAB opcionales, ocupación bloqueante y reglas de exención previas |
| 13 | Cada permiso Manager se exige para confirmado y no_corresponde; permisos generales separados |
| 14 | Snapshot con respuestas/evidencias, inmutable ante reintento y edición tras reapertura |
| 15 | Reapertura con motivo y retorno a turno abierto; motivo vacío rechazado |
| 16 | Ambos estados cerrados rechazan respuestas y novedades |

Además se prueban claves ausentes, booleanos estrictos, rollback del detalle si falla la derivación, CAB inactiva, no_corresponde normal, y la llamada Web con las once claves sin pregunta duplicada.

Resultado: 11 pruebas aprobadas, cero fallos y cero omitidas (3 del nuevo contrato y 8 de la suite existente de Cierre). La prueba SQL incluye los 16 requisitos y la matriz de 64 combinaciones. `git diff --check` sin errores; los siete archivos nuevos también se revisaron explícitamente con `git diff --no-index --check` porque todavía están sin seguimiento.

Antes de un despliegue futuro, comparar las funciones actuales con la captura de referencia para detectar cambios posteriores. Este pack no aplica la migration ni ejecuta pruebas sobre producción.
