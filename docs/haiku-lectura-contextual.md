# Lectura estructural y contextual del Libro

Haku localiza primero las secciones, la cabaña, el calendario y las celdas combinadas. Después interpreta el texto de cada bloque. Encontrar un nombre no determina dónde empieza una reserva; una nota de aseo, un contacto de facturación o una fecha de tinaja no pueden sustituir la evidencia del huésped o de su estadía.

## Contrato de lectura

| Capa | Evidencia y comportamiento |
| --- | --- |
| Archivo | Conservar coordenada, valor mostrado, valor tipado, fórmula almacenada, error de Excel, estilo y colores por fragmento. No ejecutar ni recalcular fórmulas. |
| Calendario | Admitir fechas XLSX y fechas textuales explícitas. Un día y mes sin año se aceptan sólo si el calendario físico y las fechas completas a ambos lados lo corroboran. |
| Encabezado incorrecto | Localizar la duda con los días vecinos y mostrar la celda que debe aclararse. Esa referencia no autoriza reservas, pagos, cancelaciones ni aseos del bloque afectado. Los demás días siguen siendo legibles. |
| Reserva | Usar fila de cabaña y extensión física del bloque, incluyendo anclas desplazadas. Dos bloques en la misma cabaña y día permanecen como una duda explícita. |
| Disponibilidad y mantención | Separar LIBRE, marcas de mantención y notas contiguas. Un correo o una mención a personal dentro de mantención no crea una reserva. |
| Identidad | Separar huésped, acompañante, pagador, intermediario, facturación y personal de servicios. Reconocer nombres junto al RUT, rótulos de huésped, tildes Unicode, comillas y puntuación. Dos personas sin rol siguen siendo una duda. |
| Contactos | Leer los campos de identidad del bloque, incluidos datos ya completados tras «pedir RUT». No tomar el RUT de una empresa ni el teléfono de un servicio como identidad del huésped. |
| Fechas del texto | La fecha administrativa debe tener evidencia propia. Las fechas de notas, entregas y servicios no reemplazan el registro de la reserva ni resuelven una geometría ambigua. |
| Notas y servicios | Conservar el texto original y la clasificación existente de concepto, fecha, horario, cortesía y cobro. «Masajista» identifica un rol; por sí solo no declara un masaje. |
| Pagos | Identificar cabañas en la columna de rótulos y comprobar el final de cada bloque antes de leer fecha, detalle, concepto y monto. No extender el bloque sobre otras ventas ni duplicarlo por una etiqueta copiada dentro de los datos. |
| Lectura parcial | Si falla la lectura del formato OOXML, conservar valores para consulta y señalar la limitación; no presentar el formato como verificado ni incorporar cambios dependientes de él. |

Cada reserva, anotación y movimiento mantiene su origen. Las dudas nuevas incluyen una explicación concreta, por ejemplo: «El bloque tiene datos de estadía, pero no un titular identificable. Completa el nombre en esa celda del Libro». La consulta muestra la hoja y coordenada, sin repetir una explicación genérica de varios nombres cuando el problema es una fecha.

Las hojas administrativas sin cuadrícula mensual permanecen disponibles como coincidencias textuales con coordenadas. No se transforman artificialmente en reservas. Una hoja mensual sin encabezados financieros conserva sus reservas, pero no afirma que sus pagos estén completos.

## Ejemplos de roles — datos ficticios

| Contenido | Interpretación |
| --- | --- |
| Ana Pérez // aseo express realizado por Rosa Vega | Ana Pérez es titular; la segunda parte es nota de aseo. |
| Camarero // Rosa Vega // Ana Pérez | El rol afecta al campo inmediato. Ana Pérez sigue siendo candidata a titular. |
| BOOKER Pedro Silva // HUÉSPED: Ana Pérez | Pedro Silva es intermediario; Ana Pérez es huésped. |
| Ana Pérez Rut: 12345678-5 | Separar nombre y documento sin alterar el texto original. La validación del documento sigue en los controles existentes. |
| Ana Pérez // Sociedad comercial Ejemplo spa 11111111-1 | Los datos de facturación no sustituyen al huésped. |
| Masajista: Rosa Vega 17:00 | Profesional y horario, sin declarar una prestación. |
| Ana Pérez // Pedro Silva | Dos personas sin rol: conservar la duda. |

## Auditoría del 8 de noviembre de 2026

Se contrastó la versión anterior `7acb1683a02b6ed5acb63c34ef7bd244c8d11753` con la nueva interpretación del mismo XLSX. La revisión fue de lectura: no modificó el Libro ni registró reservas, pagos o servicios en Proyecto H. Los datos originales de huéspedes no forman parte del repositorio.

- **68 hojas, 1.890.467 celdas y 2.279 fórmulas.** Se volvió a leer el archivo con el Worker de producción: mismos valores, fechas tipadas, estilos, colores por fragmento y coordenadas; fidelidad OOXML completa en las 68 hojas. No había errores de Excel en esta copia.
- **62 hojas mensuales reconocidas**, frente a 60. Las otras seis son administrativas o de referencia y conservan su lectura textual.
- **5.448 bloques de reserva interpretados**, frente a 5.327: se recuperan 132 bloques antes omitidos, ocho marcas de mantención/disponibilidad dejan de ser falsos titulares y tres bloques con varios huéspedes pasan a dudas explícitas. Son resultados sobre todo el histórico, no altas nuevas en Proyecto H.
- Las reservas sin geometría resuelta bajan de **338 a 19**. Las fechas textuales de marzo de 2023, septiembre de 2024, julio y septiembre de 2025 ya no provocan huecos artificiales.
- Dos errores del propio calendario quedan localizados: `Jun20!CP2` dice mayo entre días de junio; `Feb 27!S2` dice 2026 entre días de 2027. No se corrigen silenciosamente ni invalidan toda la hoja.
- **14.998 filas de pagos interpretadas**, frente a 14.796: se recuperan 238 filas antes omitidas y se elimina la lectura duplicada de 36 filas de septiembre de 2020. No desaparece ninguna fila única de pagos de la interpretación anterior; sus datos completos se conservan.
- Las anotaciones de reserva por identificar pasan de **575 a 589** en todo el histórico: ahora también se hacen visibles bloques antes ignorados y contradicciones reales. No son tareas nuevas guardadas en Proyecto H ni una obligación de aprobar el histórico completo.
- Octubre conserva sus 170 pagos y recupera una reserva; noviembre conserva sus 29 reservas y 48 pagos. Ambos meses siguen sin reservas por identificar en esta copia. Algunas fechas administrativas se corrigen porque antes se tomaban fechas de servicios o notas.

## Pruebas y rendimiento

`tests/libro-lector-suite.cjs` ejecuta los 65 archivos de pruebas que usan la semántica o el Worker: **1.324 pruebas pasan**, sin omisiones. Incluye continuidad de consultas y revisiones, identidad, ocupación, servicios, cortesías, pagos, asociaciones, incorporaciones e idempotencia con PostgreSQL aislado. La integración continua ejecuta el mismo conjunto, además de los controles de navegador existentes.

`tests/libro-estructura-celdas.test.cjs` incorpora casos de estructura física, cabeceras textuales o incorrectas, campos de identidad, límites financieros, independencia de celdas vecinas, orden de entrada y desplazamiento uniforme. `tests/libro-celdas-xlsx.test.cjs` construye un XLSX sintético y prueba el recorrido real de OOXML a interpretación, incluida lectura por lotes, fórmulas con valor almacenado, errores de Excel y fallo de fidelidad. Usa SheetJS 0.20.3 y JSZip 3.10.1 con sus huellas verificadas en CI.

Se indexaron filas y anclas de celdas combinadas para evitar recorridos completos repetidos. En la misma máquina, octubre y noviembre juntos (36.054 celdas), 11 mediciones alternadas después de tres calentamientos: mediana **243,4 → 125,2 ms**, percentil 95 **427,9 → 160,4 ms**. Mide normalización local; excluye descarga, descompresión y consultas a Proyecto H. No se añadió una llamada a un modelo por celda ni una nueva dependencia de red.

Las pruebas usan identidades ficticias y no escriben datos operacionales. La interpretación libre no es infalible: dos personas sin rol, una fecha realmente contradictoria o un dato ausente deben seguir visibles, con su causa y origen, sin inventar una respuesta.
