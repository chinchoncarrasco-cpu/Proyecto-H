# Comparación Libro anterior ↔ Libro actual

Ejecutar `node --test tests/*.test.cjs` desde la raíz del repositorio.
Los casos son sintéticos. No se guardan XLSX ni datos de huéspedes reales en estas pruebas.

## Verificación con las dos copias reales

1. En PC, abrir Proyecto H con la versión del commit de esta corrección. Recargar la página para cargar los scripts actualizados.
2. En **Libro de Reserva**, cargar primero el XLSX anterior y esperar a que termine su lectura y guardado local. Después cargar el XLSX actual, diferente del anterior, y esperar a que termine. El flujo conserva esas dos copias en el navegador; no modifica los archivos originales.
3. Abrir **Consultar Libro con Haku** y preguntar: `Libro: compara los cambios entre el Libro anterior y el actual de septiembre 2026`.
4. Verificar la cabecera **CAMBIOS ENTRE LIBROS · Septiembre 2026** y sus cinco totales. Las tarjetas de modificaciones y revisión están abiertas; **Sin cambios** se pliega cuando el informe tiene más de ocho casos. **Detalles técnicos** siempre empieza cerrado.
5. Buscar Marco Iturrieta Rojas: debe aparecer una sola tarjeta **CAB 1 + CAB 2**, 17/09/26 → 20/09/26, **Sin cambios**, si todos los datos y pagos verificables son iguales. También se puede preguntar `Libro: cambios de la reserva de Marco Iturrieta Rojas en septiembre 2026`.
6. Para cambios reales, contrastar el detalle: cabaña añadida/quitada, Check-In/Check-Out, contacto, huéspedes, estado, servicios, notas y pagos. Una cabaña añadida no debe generar otra reserva nueva ni otra desaparición. Las notas no interpretadas se conservan en un desplegable de la tarjeta.
7. Expandir **Detalles técnicos** para comprobar las celdas de ambas versiones y CodAut, Folio+Bovtar o BOVE. Un pago repetido con el mismo identificador fuerte y contenido cuenta una vez. Un identificador conflictivo, compartido entre reservas o cobertura incompleta exige revisión; no se afirma un agregado/eliminado seguro en esos casos. Un monto modificado en un pago asociado inequívocamente aparece como **Cambio detectado**, con el monto anterior y actual.
8. Confirmar que una reserva realmente retirada aparece como **Ya no aparece** y una nueva como **Reserva nueva**. Un homónimo o asociación insegura aparece como **Requiere revisión**, conservando candidatos; no como desaparición.
9. Si la reserva pudo moverse de mes, consultar ambos meses: `Libro: cambios del 01-09-26 al 31-10-26`. Las asociaciones se resuelven antes de filtrar el intervalo, sobre las hojas mensuales seleccionadas. No se afirma qué ocurrió fuera de las hojas consultadas; “Ya no aparece” no significa cancelación.
10. La consulta debe mantener Haku abierto, permitir desplegar y plegar tarjetas y no ofrecer incorporación, aprobación ni guardado. El flujo entre versiones no consulta ni escribe Supabase y no añade polling ni observers globales.

## Límites conservadores

- Se agrupan filas con titular normalizado, mismas fechas y señales de identidad compatibles; las cabañas forman un conjunto. Filas duplicadas, documentos conflictivos o puentes entre identidades incompatibles no se asocian automáticamente.
- Las asociaciones entre versiones deben ser recíprocas y únicas. Un documento coincidente o contacto fuerte aporta identidad; un documento diferente bloquea la asociación. Una modificación aislada de contacto puede asociarse por nombre, fechas y cabaña, mientras que contactos conflictivos múltiples requieren revisión.
- La comparación describe lo que el lector pudo interpretar en las hojas seleccionadas. Geometría no reconocida produce **No comparable**. Un pago sin identificadores suficientes o sin cobertura completa no se declara faltante por inferencia.
- Las pruebas automatizadas incluyen la regresión de Marco, cabañas añadidas/quitadas, reservas nuevas/retiradas, fechas, homónimos, contactos, notas simultáneas, pagos, inmutabilidad, filtros, consulta sin base de datos y tarjetas con coordenadas ocultas.

## Validación de Sebastian Martin · CAB 1 · transferencia $160.000

Con ambas copias cargadas en el orden del paso 2, consultar `Libro: cambios de la reserva de Sebastian Martin`.
Si titular, fechas, bloque de Check-In, concepto/tipo, monto, moneda, medio y glosa coinciden y el emparejamiento es único, la tarjeta debe mostrar **Sin cambios** y **Sin cambios aparentes en el pago**. Debajo debe aparecer la nota secundaria: **Identificación débil: no posee CodAut/Folio+Bovtar/BOVE para validación inequívoca.** El estado verificado de Proyecto H no se consulta ni se modifica para decidir este resultado.

La glosa se compara normalizando mayúsculas, tildes y espacios, sin inferir equivalencias semánticas. Se exige el mismo titular, estadía, bloque y cabaña; no se usan coordenadas para asociar. Una coincidencia exacta debe ser única en ambos sentidos. Sin coincidencia exacta, sólo se compara como modificación si existe un único candidato recíproco en ese contexto. Los pagos con identificador fuerte se resuelven por separado y nunca compiten con los débiles.

Con copias de prueba, cambiar sólo el monto o una glosa relevante: debe aparecer **Cambio detectado**, **Pago modificado** y los valores anteriores y actuales. Con dos candidatos indistinguibles debe aparecer **Requiere revisión** y **No se puede asociar de forma inequívoca entre versiones**. **Detalles técnicos** debe comenzar plegado en todos los casos. Si hay cambios ajenos al pago, la tarjeta conserva esos cambios y muestra por separado el pago sin cambios aparentes.

Las regresiones usan transferencias sintéticas de $160.000; la validación con los XLSX reales debe hacerse en el navegador donde están cargados.
