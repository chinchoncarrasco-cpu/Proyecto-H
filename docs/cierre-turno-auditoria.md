# Auditoría de Cierre de turno

Se revisaron el panel web, la pantalla de Haku Mobile y las definiciones activas de Supabase. La consulta a producción se limitó al catálogo de controles y a las reglas de cierre.

| Área | Hallazgo | Diseño web |
| --- | --- | --- |
| Recepción y reservas | Salidas tempranas, entradas y salidas y registros estaban mezclados con pagos, inventario de llaves y revisiones de caja. | Cuatro controles de recepción y acceso al Resumen. El registro admite cualquier respaldo de imagen, incluida una foto del papel si se usa. |
| Caja y pagos | El registro de pagos y la verificación de caja son controles distintos. Las tres validaciones administrativas cuentan para completar el cierre y tienen permisos separados. | Registro con respaldo, verificación de pagos, revisión de caja y respaldo de cortesías. Se retiró la exigencia visible de imprimir hojas o comprobantes y de usar un sistema concreto. |
| Llaves y accesos | El catálogo de llaves es propio de Haiku. Supabase deriva un control global al confirmar las once llaves. | Inventario plegable con nombres y detalles de identificación propios del alojamiento. |
| Instalaciones | La revisión estaba dedicada a Tonel, Jacuzzi y cojines. | Sección de instalaciones con tareas propias del equipamiento de Haiku. El título y sus tareas tienen una definición separada. |
| Cabañas | Se repetían siete controles en once bloques HTML. El estado final de Cabañas podía aparecer como «Completa» aunque faltaran controles del cierre. | Una lista a partir de las cabañas activas, con el estado de Operación separado del checklist y acceso a la ficha operativa. Una cabaña ocupada queda exenta de esos controles al marcarla. |
| Entrega | Las tres preguntas y el cierre definitivo quedaban en lugares distintos. El avance de pantalla estimaba pendientes con unidades diferentes al cálculo del servidor. | Preguntas y novedades junto al resumen de entrega y la decisión final. El avance general se muestra con el resultado guardado en Supabase. |

## Base para Personalizar

La plantilla web concentra títulos, orden, preguntas, opciones de respuesta, inventario, tareas de instalaciones y checklist repetible de cabañas. Conserva los códigos de respuesta y respaldo para que cada control siga apuntando a su dato original.

El futuro editor puede partir por cambiar nombres, orden y agrupación de secciones y tareas. Agregar o desactivar controles, definir cuáles cuentan como requeridos o cambiar las llaves y equipos para otro alojamiento exige guardar una versión de la plantilla por alojamiento y evaluar cada turno con su propia versión. Las once llaves actuales todavía participan en la regla de Supabase que deriva la devolución completa.

La fecha y el estado de la operación, los permisos de validación, el cálculo de pendientes, la confirmación, la reapertura y los cierres históricos corresponden al sistema. Los controles requeridos que falten permiten cerrar con pendientes si se escribe una entrega. El cierre guarda sus respuestas y respaldos y se bloquea para edición normal.

Haku Mobile tiene una pantalla nativa propia con el mismo almacenamiento y aún usa los rótulos anteriores. Esta etapa implementa el rediseño del panel en escritorio y navegador móvil.
