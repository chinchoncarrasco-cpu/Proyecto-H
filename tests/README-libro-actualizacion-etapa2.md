# Haku: informe solicitado de actualización (ETAPA 2)

El módulo `supabase-asistente-libro-actualizacion-v1.js` se carga después del motor de diferencias y antes del interceptor general del Libro. Captura únicamente consultas completas reconocidas, desde `window` en fase capture. No interviene con adjuntos, Shift+Enter, composición de texto ni comandos de edición.

Consultas: «Haku, informe de actualización», «qué cambió en el libro», «cambios del libro», «cambios de la última actualización», «última actualización del libro» y «qué cambió desde la última carga». Admite variantes sin tildes, signos de pregunta, «dame», «muéstrame» y «por favor».

El informe se obtiene exclusivamente de `HAIKU_LIBRO_DIFERENCIAS_V1.compararUltimasVersiones()`. No usa IA, consultas adicionales a datos ni persistencia. Soporta primera versión, sin cambios, resultado completo, parcial, no comparable y errores. Los campos modificados provienen de `cambios`; no reinterpreta texto original. Las continuidades no suman cambios y en esta etapa no se muestran como sección independiente. Documento y contacto quedan ocultos, incluso al informar que esos campos cambiaron.

La caché vive sólo en memoria, con la generación del Libro como clave. `haiku:libro-cambio` la invalida. Una comparación en vuelo se comparte; si cambia la generación o llega el evento, el resultado se descarta. Los errores y resultados no comparables no se cachean. No hay respuesta automática al evento.

## Verificación

`node --test tests/*.test.cjs`

Los tests nuevos usan resultados sintéticos y eventos simulados; no escriben datos. Cubren reconocimiento estricto, presentación, privacidad, escape HTML, caché, invalidación, concurrencia, errores, adjuntos y orden de carga.

Prueba manual en el panel local con las dos versiones ya guardadas:

1. Escribir «Haku, informe de actualización» y comprobar espera y tarjeta.
2. Repetir sin cambiar el Libro: debe reutilizar el resultado.
3. Verificar que resumen del día, búsquedas normales y adjuntos mantienen su flujo.
4. Tras una carga realizada por el usuario, la siguiente consulta debe comparar nuevamente.

El módulo no modifica reservas, pagos, servicios, Supabase, IndexedDB ni el motor de ETAPA 1. No implementa la burbuja automática de ETAPA 3.
