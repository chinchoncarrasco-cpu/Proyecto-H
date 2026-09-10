# Libro: motor aislado de diferencias, etapa 1

Base de trabajo: `f555d0fad07d9d6d5d9fd72f43a7ba47481a7594`, árbol limpio y 157 tests aprobados antes de editar.

## Uso técnico

En el navegador donde ya existen las dos copias del Libro:

```js
const resultado = await window.HAIKU_LIBRO_DIFERENCIAS_V1.compararUltimasVersiones();
```

No se ejecuta automáticamente. No tiene UI, mensajes, suscripciones ni acciones. No usa Supabase. No carga archivos reales durante las pruebas automatizadas. No es necesario volver a cargar ni borrar IndexedDB para llamar al motor.

Para tests o consumidores con hojas semánticas ya leídas:

```js
const resultado = HAIKU_LIBRO_DIFERENCIAS_V1.comparar(hojasAnteriores, hojasActuales);
```

La función pura no agrega reloj: entrada idéntica produce salida idéntica. El adaptador asíncrono agrega `generado_en`. Ambas salidas son clonables y conservan registros originales y cambios `{campo, antes, ahora}`.

## Matching

- El parser actual expone documento, correo y teléfono. Su `id` es hoja/celda, útil como evidencia, nunca como identidad permanente.
- No expone un código único explícito de reserva. No se extraen códigos hipotéticos desde texto libre: folio, BOVTAR, BOVE y autorizaciones de pago no son códigos de reserva.
- Contactos coincidentes requieren contexto de nombre o estadía. Cambiar un contacto contradictorio exige otros dos contactos coincidentes. Se conservan los valores originales para comparar los cambios.
- Sin contactos, exige nombre normalizado, tipo de estadía y ambas fechas; o nombre, tipo, cabaña y una fecha. Nunca empareja sólo por nombre, fecha, posición o cabaña.
- Se resuelven primero segmentos exactos (identidad compatible, CAB, fechas, tipo y noches), con pareja única en ambos sentidos. Después se buscan cambios entre los restantes. No hay desempate por orden ni proximidad de celda. Los duplicados indistinguibles siguen ambiguos.
- `continuidades` registra relaciones inferidas alojamiento→Full Day con contactos fuertes, fechas contiguas y candidatos únicos, conservando cada segmento. No crea ni fusiona reservas.
- La advertencia de discrepancia entre noches escritas y geometría permite una pareja exacta sólo si ambas versiones conservan la misma advertencia, las mismas noches escritas y el contexto completo. La advertencia se conserva en la salida. Las advertencias desconocidas, cambiadas y cronologías inválidas no reciben esta excepción. Las regresiones de segmentos y de esta excepción están en `haiku-libro-diferencias.test.cjs`.
- Fechas imposibles reciben `advertencias_validacion` en una copia y quedan fuera de matching/altas/bajas concluyentes. No se inventa una fecha de reemplazo. La semántica compartida no se modificó.
- Compartir cabaña/check-in sólo crea un candidato para revisión si la identidad cambió por completo; no confirma que sean la misma reserva.
- Los registros sin pareja se clasifican como nuevas/ya_no_aparecen sólo si no tienen candidatos, advertencias de parser ni cobertura incompleta. Desaparición nunca implica cancelación.

## Campos comparados

Cabaña, check-in, check-out, noches, tipo de estadía, titular, adultos, niños, mascotas, confirmación, estado operativo, operador, documento, correo, teléfono, notas importantes, pagos pendientes y servicios.

Los escalares deben estar determinados en ambos lados: NULL no significa cero ni eliminación. Una pérdida de información genera advertencia, no una transición inventada. Confirmación y operación conservan las etiquetas interpretadas por el parser, incluidas las basadas en colores.

Se normalizan espacios, mayúsculas, documento y teléfono. Los acentos se ignoran para nombres; se conservan en notas. Listas sin orden significativo se ordenan. Los servicios comparan concepto, pendiente, cortesía, hora y monto estructurados; su texto libre queda como evidencia. El texto original completo y el formato de la celda no producen por sí mismos una modificación.

## Límites financieros y semánticos

- El parser produce pagos, pagos sin asociación, cobertura financiera, importes y referencias. Este motor no compara movimientos financieros: exigiría resolver su identidad y cobertura de manera específica. No altera ni reutiliza el comparador financiero actual de Haku.
- Bove, reembolsos y relaciones especiales: **campo todavía no estructurado por la semántica** de manera suficiente para esta etapa. La presencia de una referencia no demuestra la naturaleza de una operación.
- Precios de servicios, muchas cantidades no escritas y observaciones fuera de notas importantes pueden no estar estructurados. No se infieren desde el texto completo.
- Si se cambian simultáneamente todos los identificadores y también las fechas/cabaña, no existe información suficiente para reconstruir la continuidad. Los resultados requieren revisión manual antes de cualquier futura acción.

## Lectura, cobertura y compatibilidad

Extensiones al cargador: `consultarIndice(version)` y `consultarHuellas(version, nombres)` reutilizan la consulta en cola y el worker existente. Leen IndexedDB con transacción `readonly`; no modifican guardado, rotación, borrado ni esquema. Versión anterior ausente devuelve NULL; un error de almacenamiento o guardado no confirmado se informa como no comparable. En celular se mantiene la política existente sin persistencia de dos versiones y se devuelve `sin_linea_base`.

La comparación empieza leyendo únicamente `xl/workbook.xml` para obtener los nombres de ambas versiones, sin SheetJS ni contenido de hojas. Selecciona las mensuales desde el mes anterior y las especiales vigiladas ANTES de solicitar huellas. El worker recibe una lista explícita y sólo abre los XML de esas hojas. Las históricas y desconocidas no vigiladas no reciben huellas ni semántica y no participan en el informe.

La lista explícita de especiales es `REAGENDAR` y `REEMBOLSOS`, verificada leyendo exclusivamente los índices de `Libro de reservas actual 2025 (9).xlsx` y `(8).xlsx` en Descargas. Otras hojas reales encontradas y NO vigiladas: `VOUCHER DE REGALOS`, `formato copia`, `Colores`, `HUESPEDES SEPTIEMBRE`, `Referencias`. Los nombres ambiguos como `Agos22` y `Abri22` también quedan fuera; no se intentan corregir automáticamente.

Las huellas SHA-256 versión 2 de las seleccionadas usan una representación canónica de valores, fórmulas, rich text, colores semánticos y estructura. Se leen las tablas compartidas de texto/estilos y el tema para resolver dependencias; sus IDs no se hashean como identidad. No se abren los XML de hojas históricas para ello. La metadata, las celdas vacías sin fórmula y los atributos cosméticos quedan fuera. Un fallo de huella no significa igualdad. Las regresiones de esta representación están en `libro-huellas-operacionales.test.cjs`.

Después se leen semánticamente sólo las hojas mensuales seleccionadas que cambiaron. El mes actual se calcula en America/Santiago; para reproducir un diagnóstico puede pasarse `{fechaReferencia: '2026-09-10'}`. Septiembre de 2026 comienza en `2026-08`; enero de 2027 comienza en `2026-12`. Se reconocen abreviaturas españolas Ene–Dic seguidas de dos o cuatro dígitos (2000–2099), incluyendo espacios como `Feb 27`, sin sufijos ambiguos. Los demás nombres sólo participan si están en la lista explícita de especiales vigiladas.

La salida incorpora `diagnostico`: `hojas_totales_libro`, `hojas_revisadas_actualizacion`, `hojas_historicas_omitidas`, `hojas_desconocidas_omitidas`, `hojas_cambiadas` y `lecturas_semanticas`, además de los detalles previos de rango, huellas y lecturas. Los totales cuentan nombres únicos entre ambas versiones. El test de 63 hojas verifica 8 seleccionadas, 55 históricas omitidas incluso del worker de huellas y sólo dos lecturas semánticas si cambia Sep26. Las especiales vigiladas se suman al total revisado cuando existen. Las consultas históricas normales siguen intactas.

Las huellas son un filtro conservador, no diferencias de reservas: las celdas o combinaciones modificadas pueden requerir semántica aunque no se determine después una reserva modificada. `diagnostico.detalle_huellas` muestra por hoja qué componentes cambiaron; NULL significa que no se pudo comparar el componente. La fase rápida con las copias (8)/(9) se midió localmente en unos 2,2 segundos; la comparación completa en navegador sigue pendiente. Sólo se descomprimen los XML seleccionados y las tablas compartidas necesarias; JSZip debe leer el directorio del contenedor ZIP.

Una hoja operacional ilegible, geometría no reconocida o cobertura temporal distinta genera `no_comparables`. Las parejas fiables aún pueden compararse, pero no se afirman altas/desapariciones bajo cobertura incompleta. Estado `parcial` identifica resultados con esa limitación. Las especiales vigiladas cambiadas generan advertencias y no se interpretan automáticamente. Las históricas NO generan advertencias de modificación: deliberadamente no se revisan. El informe describe exclusivamente el alcance operacional.

Cambiar el Libro en esta página durante la lectura invalida el resultado completo. La infraestructura existente no comparte la generación entre pestañas: no actualizar las copias simultáneamente desde otra pestaña mientras se hace la comprobación manual.

## Verificación y retirada

Ejecutar `node --test tests/*.test.cjs`. Las pruebas usan fixtures sintéticos, entradas congeladas, mocks de sólo lectura y el código real de consultas instrumentado sólo en tests. Incluyen A–M, contactos conflictivos, múltiples candidatos, cambios entre hojas, errores, cobertura, celular y transacciones readonly. Las pruebas de huellas ejecutan la función real del worker con archivos OOXML sintéticos y un contenedor ZIP simulado; cubren sharedStrings, estilos, colores rich text, referencias corruptas, sistema de fechas, rango mensual y selección de 63 hojas.

Para comprobar manualmente, ejecutar la API sobre las copias ya guardadas y revisar `resumen`, `modificadas[].cambios`, `ambiguas`, `advertencias` y `no_comparables`. La validación con los dos XLSX reales no forma parte de las pruebas sintéticas.

El módulo está registrado una vez en `panel.html`. Retirar su entrada desactiva la API sin cambiar el cargador, la semántica ni los módulos de Haku. No hay commit, push ni nuevas dependencias.
