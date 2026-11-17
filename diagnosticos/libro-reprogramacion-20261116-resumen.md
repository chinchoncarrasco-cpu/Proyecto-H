# Reprogramación conjunta de estadía, servicios y notas

Candidato local en `codex/libro-reprogramacion-20261116`, desde `main` `b8ea94e`. Sin push, merge, despliegue ni modificaciones de reservas reales. Todos los ejemplos y evidencias incorporados al repositorio son ficticios.

Este documento describe el avance confirmado en `967e294`. La continuación de ampliación/reducción de noches y revisión de ingresos/salidas está en [la verificación de noches y estados](libro-reprogramacion-noches-20261116-resumen.md).

La causa era que Haku y Libro actualizaban la estadía sin trasladar las fechas propias de servicios y notas operativas. El Resumen consulta `notas.fecha_operacion`; vincular una nota a la estadía no corrige esa fecha. Además, compartir el vínculo de reserva no demuestra que un servicio antiguo corresponda a la nueva estadía. El editor anterior podía reconstruir noches/cargos y deshacer aplicaciones de pagos al cambiar fechas.

## Resultado observado

| Registro ficticio | Antes, CAB 9 | Después de aprobar |
| --- | --- | --- |
| Estadía | 15–16/11/2026 | 28–29/12/2026, mismo ID |
| Early Check-in | 15/11, 10:00–12:00 | 28/12, mismas horas e ID |
| Late Check-out | 16/11, 12:00–14:00 | 29/12, mismas horas e ID |
| Nota «Llegada 19:00 · Dejar dos batas» | 15/11 | 28/12; texto y hora intactos |
| Jacuzzi de la estadía vigente | 15/11, 18:30–19:30 | 28/12, previa comprobación de disponibilidad |
| Jacuzzi antiguo vinculado a la estadía | 03/10, 20:00–21:00 | Sin traslado; decisión explícita y «Requiere revisión» |
| Jacuzzi de otra estadía identificada | 03/10, 10:00–11:00 | Fecha, asociación e historial intactos |
| Masaje realizado | 15/11, 17:00–17:30 | Histórico intacto; no se traslada |
| Comentario general | Sin fecha operativa | Íntegro |

El segundo recorrido usa Libro y cambia también de CAB 9 a CAB 4. La nota queda en CAB 4, el 28/12; los servicios siguen la misma estadía, sin reemplazar IDs. La Agenda y la consulta real de notas del Resumen dejan de devolver los registros trasladados en noviembre y los devuelven en diciembre. La ficha separa los servicios marcados para revisión de los programados confirmados. Las dos variantes conservan íntegros cargos, pagos, aplicaciones, ajustes y tarifas acordadas.

## Implementación

- Vista previa compartida con origen/destino, horarios, notas, propuestas y decisiones. Detalles plegables y distribución adaptable al ancho real del panel.
- RPC de preparación de lectura y confirmación transaccional; bloqueos, exclusiones existentes de ocupación/recurso, permisos, identidad y huella del estado revalidados antes de escribir.
- La misma operación mueve estadía, filas de noches, servicios aprobados y notas operativas. Las guardas existentes admiten únicamente el estado intermedio de esa transacción autorizada; se comprueba el rango final y que el registro financiero no cambió.
- Se conservan las implementaciones anteriores para las ediciones ajenas al traslado. Haku/Libro antiguos no pueden guardar un cambio estructural parcial sin esta revisión.
- Registro privado de operación y actor; reintento con el mismo ID devuelve el resultado confirmado sin repetir cambios.
- Si una reserva, nota, servicio, cargo, permiso o disponibilidad cambió, se rechaza el guardado. Haku vuelve a mostrar la revisión actual, explicando el cambio; necesita otra confirmación. Libro revalida también la versión de la fuente.

## Pruebas

428 pruebas focales aprobadas, sin fallos: reprogramación PostgreSQL y frontend, Haku, notas del Resumen, Servicios, identidad/procedencia, retiros, incorporación continua, documento de titular y aplicación de pagos existentes. Tras la limpieza final se revalidaron las 63 pruebas de reprogramación/Haku afectadas, todas aprobadas, y se repitieron los nueve recorridos de navegador con el código final. Sintaxis de los JavaScript modificados: PASS. Logs privados en `%LOCALAPPDATA%\ProyectoH\diagnosticos\libro-reprogramacion-20261116`.

El PostgreSQL embebido usa PGlite 0.5.14 con `btree_gist`, exclusiones reales y los cuerpos existentes de las guardas de noches, rango, cabaña y cargos de servicios. Se probaron ambos destinos, un servicio pagado con aplicación previa, un horario ocupado antes y después de la vista previa, cambios concurrentes de reserva/notas/servicios, permisos, falsificación del contexto, reintentos, intervalos solapados de noches, lote real del Libro y reversión íntegra si falla la identidad en el resto del lote.

Chromium: ocho recorridos completos (Haku/Libro × escritorio/móvil × claro/oscuro) y un conflicto nuevo entre vista previa y confirmación. Guardado real contra el PostgreSQL local del fixture, lectura posterior por la hidratación real de Servicios y la API real de notas del Resumen, sin desborde horizontal ni conexiones externas. Libro vuelve a preparar desde el destino persistido sin otra propuesta de traslado. Evidencia detallada y capturas privadas: `navegador-sintetico.json`, `*-previa.png`, `*-confirmado.png`, `*-llegada-confirmada.png` y `conflicto-nuevo-sin-guardado.png`.

Ejecución: usar `NODE_PATH` hacia las dependencias aisladas de prueba; ejecutar `node --test --test-concurrency=1` con las suites focales y `node tests/libro-reprogramacion-browser-check.cjs`. El workflow existente de notas y servicios incorpora ambas pruebas nuevas y conserva los controles anteriores.

## Archivos y revisión

- Backend: `supabase/migrations/20261117005357_libro_reprogramacion_estadia_atomica.sql`.
- Flujo compartido: `js/haiku-reprogramacion-estadia-v1.js`, su CSS y carga en `panel.html`/`libro-comparacion.html`.
- Entradas Haku/Libro: `supabase-asistente-operaciones-v1.js`, `haiku-asistente-acciones-v1.js`, `haiku-libro-consultas-v1.js`.
- Lecturas y revisión: identidad/scope de servicios, hidratación, ficha y Agenda.
- Pruebas nuevas: `tests/libro-reprogramacion*.cjs` y dos fixtures sintéticos/guardas sin datos personales. Dos pruebas anteriores ahora comprueban el bloqueo del traslado parcial cuando falta la revisión conjunta.
- Antes/después: [libro-reprogramacion-20261116.json](libro-reprogramacion-20261116.json). [Vista previa sintética](libro-reprogramacion-vista-previa-sintetica.html), sin capacidad de guardar.

## Límites y publicación pendiente

En `967e294` este traslado conserva la duración y el tipo. La continuación local citada arriba añade revisión explícita de noches y tarifas para cambiar la duración de alojamientos futuros. Estadías con ingreso/salida registrados, canceladas o no-show quedan bloqueadas para proteger su historial. Un servicio sin recurso u horario inequívoco requiere revisión. No se da por realizada una prestación antigua ni se la cancela automáticamente.

La migración sólo está probada localmente; no se aplicó en Supabase productivo. La futura publicación autorizada deberá instalar primero la migración y luego el frontend. Los campos nuevos no son compatibles con publicar sólo el frontend. Esta verificación no mide rendimiento productivo ni simula concurrencia de dos conexiones independientes; comprueba cambios entre preparación y confirmación, exclusiones y reversión en PostgreSQL local.
