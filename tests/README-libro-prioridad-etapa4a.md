# ETAPA 4A: prioridad operativa del Libro

`supabase-asistente-libro-prioridad-v1.js` consume exclusivamente el resultado ya calculado. No lee XLSX, consulta bases de datos ni ejecuta comparaciones. Expone `clasificar`, `renderizar` y `resumen`.

La fecha actual se obtiene en America/Santiago. Se puede fijar `fechaActual` (ISO) para pruebas. Hoy, mañana, días 2–7 e informativos son los cuatro grupos. El intervalo operativo incluye check-in y check-out: una salida también requiere atención ese día. Full Day con fechas iguales se considera operativo ese día, aun con cero noches.

Cada caso conserva su tipo. Una modificación se evalúa con anterior y actual; una ambigüedad, con todos los candidatos. Cada segmento se evalúa individualmente y el caso queda en el grupo de mayor proximidad. Los contadores cuentan casos, no segmentos. Las relaciones de continuidad no generan elementos por sí solas.

Advertencias y cobertura no comparable se incluyen como tipos propios, sin aumentar los contadores originales de modificaciones ni ambiguas. Se usan fechas explícitas del aviso o referencias exactas a segmentos disponibles en el resultado. No se extraen fechas del nombre de hoja, archivo ni coordenadas. Cuando una advertencia de una reserva sin cambios no incluye fechas y su segmento no está disponible en el resultado, se informa sin prioridad temporal determinada; no se vuelve a leer el Libro para completarla.

Fechas insuficientes, imposibles, estadías pasadas o fuera de siete días se presentan en Informativos con una explicación. Informativo sin fechas no significa que se haya confirmado ausencia de urgencia.

La tarjeta manual y Ver informe pasan por el renderer de ETAPA 2, que añade la sección sin sustituir el detalle anterior. La burbuja automática añade contadores compactos. La proyección temporal se calcula al presentar, no se almacena en la caché del comparador; el cambio de día no requiere recalcular XLSX.

Ejecutar `node --test tests/*.test.cjs`. Las regresiones cubren hoy, mañana, límites 2–7 días, futuro, salida, cambio de fechas/cabaña, Full Day, ausencias, ambigüedad, referencias de avisos, fechas faltantes, segmentos y entrada inmutable. Las pruebas anteriores de Macarena, Angelo y Mauricio se mantienen.

No modifica ETAPAS 1–3 en su lógica, persistencia, incorporación, pagos, servicios ni RPC. ETAPA 4B no está implementada.
