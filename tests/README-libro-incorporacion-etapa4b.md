# ETAPA 4B: puente del informe a Proyecto H

## Contrato y flujo

El informe de ETAPA 2 adjunta `Preparar cambios en Proyecto H` al resultado ya mostrado. La generación se recuerda en un WeakMap al completar la comparación validada; no se modifica el resultado ni se toma la generación actual como sustituto de una desconocida. Tanto el informe manual como Ver informe usan el mismo mecanismo.

`supabase-asistente-libro-incorporacion-v1.js` clona completos los `actual` de nuevas y modificadas. Sólo elimina repeticiones idénticas del mismo ID semántico y objeto completo; no fusiona por nombre ni descarta versiones conflictivas de un ID. Conserva anterior, cambios y continuidades como contexto. No lee XLSX, no ejecuta parser y no convierte campos en patches.

El puente llama a `HAIKU_LIBRO_CONSULTAS.abrirComparacionEstructurada(out, {reservas, generacion})`. Esta entrada usa la normalización existente para determinar el intervalo y `compararSistema` para leer el estado actual de Proyecto H. Muestra `renderizarComparacion`, la UI existente con decisiones y pagos.

La acción siguiente, Preparar incorporación, sigue ejecutando `prepararIncorporacion` y `crearPlanIncorporacion`. Las aprobaciones, selección, distribución y confirmación son las existentes. `confirmarIncorporacion` conserva la segunda revalidación y `serializarIncorporacion`; la única RPC de escritura sigue siendo `haiku_incorporar_libro_v1`. No se añadió ni modificó un writer, RPC o SQL.

La ruta estructurada lleva una marca interna Symbol que sobrevive a los spreads de la UI. Revalidar contra Proyecto H compara los mismos registros directamente. La ruta manual conserva su llamada `consultar(result.q.texto)` y no cambia de comportamiento.

## Límites

Ausencias, ambiguas, advertencias y no comparables no se convierten en acciones. Se enumeran como no transferibles/avisos cuando hay candidatos accionables para preparar. Sin candidatos no se muestra el botón. Una continuidad no incorpora por sí sola segmentos sin cambios: sólo contextualiza los actuales presentes en nuevas/modificadas.

Servicios se conservan en el objeto completo y se avisan como no transferibles automáticamente por este flujo: las categorías canónicas guardables siguen siendo nuevas, estadías, pagos y actualizaciones. No se creó escritura de servicios ni tratamiento nuevo de hojas especiales, BOVE o reembolsos. Los pagos conservan todos los campos originales y atraviesan exclusivamente el núcleo existente.

La preparación se bloquea si la generación del informe no coincide. Un cambio del Libro retira cualquier preparación mostrada y desactiva el botón. Los fallos de red nunca presentan una preparación anterior como vigente. No hay nueva persistencia; las decisiones usan los mecanismos existentes de la UI.

## Pruebas

`node --test tests/*.test.cjs`

Las pruebas nuevas colocan centinelas en interpretar/consultar para probar que la ruta estructurada nunca llega al texto. Ejecutan el núcleo existente con clientes/DOM simulados, verifican datos completos, generaciones, botón, ausencia de otra comparación XLSX, segmentos y confirmación con segunda lectura/RPC mock. Las regresiones manuales, de pagos, distribución, conflictos e idempotencia se mantienen.

No se probaron escrituras reales. La comprobación manual pendiente es (8) → (9) → Ver informe → Preparar cambios en Proyecto H. Revisar primero la comparación real de Mauricio, sus pagos y las decisiones de la UI; no confirmar todavía. La propuesta concreta depende del estado de Proyecto H con la sesión del usuario.
