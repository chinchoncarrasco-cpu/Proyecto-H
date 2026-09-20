# Haku: informe solicitado de actualización (ETAPA 2)

El módulo `supabase-asistente-libro-actualizacion-v1.js` se carga después del motor de diferencias y antes del interceptor general del Libro. Captura únicamente consultas completas reconocidas, desde `window` en fase capture. No interviene con adjuntos, Shift+Enter, composición de texto ni comandos de edición.

Consultas: «Haku, informe de actualización», «qué cambió en el libro», «cambios del libro», «cambios de la última actualización», «última actualización del libro» y «qué cambió desde la última carga». Admite variantes sin tildes, signos de pregunta, «dame», «muéstrame» y «por favor».

El informe tiene dos zonas independientes. La primera conserva `HAIKU_LIBRO_DIFERENCIAS_V1.compararUltimasVersiones()` y responde qué cambió entre la versión anterior y la actual. La segunda muestra exclusivamente cambios que esa comparación detectó en alguna actualización y cuyo valor objetivo todavía no coincide con Proyecto H. No ejecuta la auditoría general de «Comparar Libro mes actual con Proyecto H» ni descubre diferencias nuevas por su cuenta. Los campos modificados provienen de `cambios`; no reinterpreta texto original. Documento y contacto quedan ocultos, incluso al informar que esos campos cambiaron.

Las versiones binarias siguen guardadas localmente en IndexedDB como `actual` y `anterior`. El historial pequeño de cambios usa una tercera clave, `cambios_detectados`, dentro del mismo almacén local; no crea tablas ni escribe en Supabase. Las transiciones encadenadas se fusionan: si A→B dejó un estado pendiente y B→C cambió otro campo, el registro conserva ambos objetivos usando C como reserva vigente. Un cambio resuelto se determina comparando nuevamente su objetivo con Proyecto H y entonces se retira del registro; no se persiste un booleano `pendiente`.

La caché de presentación vive en memoria, con la generación del Libro como clave. `haiku:libro-cambio` la invalida sin borrar el historial local. «Revalidar contra Proyecto H» vuelve a consultar únicamente las entidades del historial, sin releer el XLSX. «Preparar incorporación» aparece sólo cuando existe al menos un cambio pendiente accionable; reutiliza la comparación focalizada y entra al flujo existente de vista previa, revalidación y confirmación.

## Lecturas principales por generación

- Zona histórica: dos índices/huellas y sólo las hojas operacionales cuya huella cambió, una vez por versión.
- Historial: una lectura/escritura pequeña en el almacén IndexedDB existente cuando aparecen cambios nuevos o se resuelven cambios anteriores.
- Proyecto H: una comparación focalizada y agrupada de las reservas afectadas. Aplica el rango de fechas del historial en la consulta de estadías, omite por completo pagos para los cambios que hoy produce `compararVersiones()` y sólo lee servicios si el historial contiene un cambio de servicios.
- Revalidación: cero lecturas del XLSX, cero parseos de hojas y una nueva comparación focalizada del mismo historial.

Si no hay cambios históricos pendientes, la interfaz indica «Todos los cambios detectados ya están sincronizados con Proyecto H» y no muestra «Preparar incorporación». Una asociación insegura sólo bloquea ese cambio previamente detectado; no incorpora las demás ambigüedades del mes. Si Proyecto H falla, la primera zona permanece visible y la segunda ofrece reintento.

## Verificación

`node --test tests/*.test.cjs`

Los tests usan resultados sintéticos y eventos simulados; no escriben datos reales. Cubren reconocimiento estricto, presentación, privacidad, escape HTML, caché, invalidación, concurrencia, fusión A→B→C, estado Libro hospedada frente a Proyecto H confirmada, resolución cuando Proyecto H ya está hospedada, ausencia del botón sin pendientes, habilitación con un cambio accionable y revalidación sin lectura del XLSX ni consultas de pagos/servicios innecesarias.

Prueba manual en el panel local con las dos versiones ya guardadas:

1. Escribir «Haku, informe de actualización» y comprobar espera y tarjeta.
2. Repetir sin cambiar el Libro: debe reutilizar el resultado.
3. Verificar que resumen del día, búsquedas normales y adjuntos mantienen su flujo.
4. Tras una carga realizada por el usuario, la siguiente consulta debe comparar nuevamente.

El módulo no modifica reservas, pagos, servicios ni Supabase. IndexedDB conserva únicamente el historial local derivado de las comparaciones ya realizadas. No implementa la burbuja automática de ETAPA 3.
