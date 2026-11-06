# Haku: aviso automático de actualización (ETAPA 3)

## Disparador

El cargador emite `haiku:libro-version-cargada` tras una carga manual válida o una sincronización confirmada desde Google cuyo guardado local terminó y reemplazó bytes distintos con una versión previa disponible. La comparación binaria se realiza en la misma transacción existente: no depende del nombre ni modifica la rotación de actual/anterior. El evento identifica el origen como `manual` o `google` y el resultado del guardado sólo añade metadata de actualización.

Google entrega el archivo mediante `cargarDesdeGoogle()` para conservar el origen de la actualización sin simular una selección manual. El despacho usa la siguiente tarea y verifica de nuevo generación, persistencia y Libro disponible. El listener no bloquea `cargarArchivo()`. Primera carga, archivo idéntico, restauración, lectura inválida, guardado fallido y quitar Libro no disparan el evento. En móvil, donde no se conserva la versión anterior, no hay aviso automático.

## Comparación y aviso

`supabase-asistente-libro-auto-v1.js` escucha el evento dedicado. `haiku:libro-cambio` sólo retira avisos y desactiva acciones anteriores; nunca inicia una comparación.

ETAPA 2 expone `obtenerResultado()` y `mostrarResultado(resultado)`. Manual y automático usan la misma instancia de caché. Si hay una comparación antigua en vuelo, la nueva espera su finalización y después obtiene la generación vigente; no hay paralelismo de comparaciones. El controlador descarta resultados y errores obsoletos y acepta una sola notificación por generación.

La burbuja muestra hasta tres reservas, con nombre/cabaña y hasta tres detalles concretos por reserva; indica cuántos quedan en el informe. El diseño aprobado conserva el ancho de 340 px, separadores y botones, con «Hoy / Mañana / Próximos / Info» en una franja de 24 px, sin círculos ni cifras grandes. Los contadores provienen de `clasificar()`; no alteran la clasificación del informe. Claro y oscuro usan la misma estructura.

Cuando hay una consulta o revisión abierta, el aviso no inserta mensajes ni desplaza la conversación; «Seguir con mi consulta» sólo cierra la burbuja. «Ver informe» se habilita al finalizar la consulta, usa el resultado retenido y abre Haku sólo por acción del usuario. Sin consulta abierta, el mensaje final permanece en el chat. Las acciones de informes anteriores quedan desactivadas al cambiar el Libro.

## Consultas conservadas

`crearLectura()` mantiene una referencia a los bytes actuales, metadatos y copia anterior de esa consulta. Sus workers y cola no se cancelan por una actualización; todas las hojas corresponden a la misma versión. El visor y las consultas siguientes reciben la versión nueva. No añade almacenamiento persistente.

Las consultas del Libro, comparación de versiones, comparación mensual de sólo lectura, servicios y búsqueda BOVE usan esa lectura estable. En servicios sólo se utiliza para consultar; las preparaciones y confirmaciones siguen releyendo la fuente viva. La caché devuelve el informe anterior a quien lo solicitó, pero no lo conserva como vigente ni lo incorpora al historial nuevo.

Actualizar el Libro ya no reemplaza las respuestas por «consulta invalidada». Conserva desplegables, selecciones y datos escritos; añade una nota si la consulta usa una versión anterior. Los controles de generación, permisos y confirmación de reservas/pagos siguen activos: conservar una respuesta no permite guardar desde una comparación antigua. Una recarga de página, cierre de sesión o error real de lectura no quedan cubiertos por esta conservación en memoria.

El detalle distingue fechas (antes → después), notas agregadas/retiradas, cambios de tinaja/horario, servicios agregados/retirados, ocupantes y estados. Los extractos de notas son acotados y ocultan patrones de contacto, documento o monto; los campos de contacto/cobro se describen sin sus valores. El texto del Libro se inserta mediante `textContent`, nunca HTML. Advertencias y ambigüedades se mantienen separadas. Ausencia no se interpreta como cancelación, y una cancelación detectada en el Libro sigue pendiente de confirmación en Proyecto H.

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
