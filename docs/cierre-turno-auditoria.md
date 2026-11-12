# Auditoría de Cierre de turno

Se revisaron el panel web, la pantalla de Haku Mobile y las definiciones activas de Supabase. La consulta a producción se limitó al catálogo de controles y a las reglas de cierre.

| Área | Hallazgo | Diseño web |
| --- | --- | --- |
| Recepción y reservas | Salidas tempranas, entradas y salidas y registros estaban mezclados con pagos, inventario de llaves y revisiones de caja. | Cuatro controles de recepción y acceso al Resumen. El registro admite cualquier respaldo de imagen, incluida una foto del papel si se usa. |
| Caja y pagos | El registro de pagos y la verificación de caja son controles distintos. Las tres validaciones administrativas cuentan para completar el cierre y tienen permisos separados. | Registro con respaldo, verificación de pagos, revisión de caja y respaldo de cortesías. Se retiró la exigencia visible de imprimir hojas o comprobantes y de usar un sistema concreto. |
| Llaves y accesos | El catálogo de llaves es propio de Haiku. Las once llaves son el inventario inicial de Haiku. | Desplegable propio. La devolución cuenta al confirmar las llaves activas de la plantilla del turno. |
| Instalaciones | La revisión estaba dedicada a Tonel, Jacuzzi y cojines. | Sección de instalaciones con tareas propias del equipamiento de Haiku. El título y sus tareas tienen una definición separada. |
| Cabañas | Se repetían siete controles en once bloques HTML. El estado final de Cabañas podía aparecer como «Completa» aunque faltaran controles del cierre. | Una lista a partir de las cabañas activas, con el estado de Operación separado del checklist y acceso a la ficha operativa. Una cabaña ocupada queda exenta de esos controles al marcarla. |
| Entrega | Las tres preguntas y el cierre definitivo quedaban en lugares distintos. El avance de pantalla estimaba pendientes con unidades diferentes al cálculo del servidor. | Preguntas y novedades junto al resumen de entrega y la decisión final. El avance general se muestra con el resultado guardado en Supabase. |

## Personificar

Con el permiso de configuración se pueden editar títulos, preguntas, campos de entrega, llaves y su detalle, tareas generales y checklist de cabañas. El editor permite crear secciones, mover controles, reordenar y recuperar elementos ocultos. La lista de llaves conserva al menos una entrada activa y los controles de pagos y novedades mantienen su función.

Cada publicación queda guardada en Supabase. Se aplica desde el día operativo de Chile a turnos por iniciar. El primer control guardado, novedad o cierre fija la versión. Los cierres con actividad anterior a la incorporación del editor usan la plantilla inicial.

El servidor calcula los pendientes con la versión del turno y deriva el estado de las llaves. Cuando faltan controles, exige un resumen de entrega para cerrar con pendientes. El historial conserva las respuestas y los respaldos.

El editor y la plantilla editable se muestran en Proyecto H web, también en navegador móvil. Haku Mobile conserva sus contratos de lectura y escritura y requiere una actualización de interfaz para mostrar controles nuevos.
