# Haku: aviso automático de actualización (ETAPA 3)

## Disparador

El cargador emite `haiku:libro-version-cargada` sólo tras una carga manual válida cuyo guardado local terminó y reemplazó bytes distintos con una versión previa disponible. La comparación binaria se realiza en la misma transacción existente: no depende del nombre ni modifica la rotación de actual/anterior. El resultado del guardado sólo añade metadata de actualización.

El despacho usa la siguiente tarea y verifica de nuevo generación, persistencia y Libro disponible. El listener no bloquea `cargarArchivo()` ni espera desde el cargador a `listo()`. Primera carga, archivo idéntico, restauración, lectura inválida, guardado fallido y quitar Libro no disparan el evento. En móvil, donde no se conserva la versión anterior, no hay aviso automático.

## Comparación y aviso

`supabase-asistente-libro-auto-v1.js` escucha el evento dedicado. `haiku:libro-cambio` sólo retira avisos y desactiva acciones anteriores; nunca inicia una comparación.

ETAPA 2 expone `obtenerResultado()` y `mostrarResultado(resultado)`. Manual y automático usan la misma instancia de caché. Si hay una comparación antigua en vuelo, la nueva espera su finalización y después obtiene la generación vigente; no hay paralelismo de comparaciones. El controlador descarta resultados y errores obsoletos y acepta una sola notificación por generación.

La burbuja contiene un resumen seguro, botón Cerrar y Ver informe. El mensaje final permanece en Haku. Ver informe usa el resultado retenido, renderiza la tarjeta de ETAPA 2 sin recalcular y abre el panel mediante `HAIKU_ASISTENTE.abrir()`. No abre Haku espontáneamente. Las acciones de versiones anteriores quedan desactivadas al cambiar el Libro.

No se muestran contactos, documentos ni valores financieros en la burbuja. Sólo se resumen hasta dos cambios de campos operacionales numéricos o de fechas; los otros remiten al informe. Advertencias y ambigüedades se mantienen separadas. Ausencia no se interpreta como cancelación.

## Verificación

`node --test tests/*.test.cjs`

Los tests de `haiku-libro-auto.test.cjs` instrumentan las dependencias de UI/lectura y simulan IndexedDB en memoria para ejecutar el cargador y su transacción reales. También cargan juntos los módulos de ETAPA 2/3 con eventos y DOM simulados. No usan datos ni escrituras de producción.

Prueba manual pendiente en una ventana privada de la versión local:

1. Cargar XLSX (8): sin aviso.
2. Cargar XLSX (9): aparece Revisando la actualización y después el resumen.
3. Ver informe: tarjeta completa sin nueva comparación.
4. Preguntar «Haku, informe de actualización»: caché inmediata.
5. F5: restauración silenciosa.
6. Volver a cargar (9): sin aviso ni comparación nueva.

No se modificaron matching, huellas, semántica ni selección de hojas. No hay persistencia nueva, cambios operacionales ni escrituras Supabase.
