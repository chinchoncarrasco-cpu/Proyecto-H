# Cloudbeds / TOTAL 2 — etapa 2A, sólo lectura

## Revisión previa y alcance

- `js/supabase-asistente-v1.js` crea el input `haiku-asistente-archivos`, mantiene
  adjuntos en memoria y atiende Adjuntar/Enviar/Ctrl+Enter. Antes sólo imágenes.
- `js/supabase-asistente-listado-cloudbeds-v2.js` interpreta capturas mediante Edge
  Function y confirma creación usando `haiku_crear_lote_listado_cloudbeds_asistente_v2`.
  El campo `Reserva` del listado se guarda como `reservas.cloudbeds_id`; Habitación
  ID puede tener sufijos y NO se usa como sustituto automático de ese identificador.
- Creación individual usa las RPC oficiales existentes del asistente/reservas.
  Ninguna se llama desde el PDF; no se añadieron writers ni migraciones.
- TOTAL 1 usa `haiku_cambiar_totales_lote_v1`, con preview/revalidación/confirmación.
  Es la vía prevista para una etapa futura; 2A no la invoca ni cambia sus reglas.
- Resolución existente de TOTAL 1: nombre exacto normalizado y CAB con rechazo
  de ambigüedades. El PDF añade evidencia de ID Cloudbeds exacto, sin fuzzy.

## Lectura y normalización

PDF.js 5.6.205 local (`vendor/pdfjs/`, licencia incluida); no había lector PDF
en el proyecto. Se explicó la dependencia antes de incorporarla. Extracción de
texto/posiciones en worker local; no OCR, subida, storage ni persistencia del PDF.
Hasta 12 MB/50 páginas, con límite de tiempo y errores visibles. Un PDF por envío,
sin mezcla de imágenes. PNG/JPEG/WEBP mantienen la ruta anterior.

El parser reconoce encabezados por texto y posición, conserva columnas entre
páginas, agrupa filas por la columna Reserva y recoge las líneas de cada celda.
Descarta encabezados/pies de impresión; formatos desconocidos se rechazan, sin
adivinar columnas. Admite Total de la habitación opcional; no distribuye importes
multihabitación aunque exista un importe global en esa columna.

Estructura normalizada: reserva_cloudbeds, fecha_reserva, habitaciones_raw,
habitaciones (código, cantidad, cabana), check_in, check_out, precio_total,
total_habitacion, estado, noches, adultos, ninos, habitacion_ids, nombre_huesped,
correo/movil/telefono y sus indicadores de enmascaramiento, contactos_verificados
(false), saldo_pendiente, origen (página/fila), advertencias y multihabitacion.
Precio total es el importe de toda la estadía; valor_por_noche_referencia sólo
divide por noches en una reserva simple. No se redondean ni preparan tarifas.

Fechas DD/MM/YYYY validadas contra calendario; CLP entero con separadores de miles.
Cero no se confunde con dato ausente. Se conservan contactos enmascarados y sufijo
-2 de Habitación ID. Nunca se usan contactos enmascarados como identidad fuerte.

## Mapping cerrado encontrado

Fuente: `supabase/functions/haiku-asistente-reserva/index.ts`, regla explícita de
Asignado, y `supabase/functions/haiku-asistente-pago-existente/index.ts`.

LC1→1, LC2→2, LC3→3, LC4→4, LC6→6; CD5→5, CD7→7, CD8→8, CD9→9;
C10→10, C11→11. Otros códigos se conservan pero no se infieren por su número.
Cantidad entre paréntesis >1 y varios códigos/IDs marcan multihabitación.

## Matching y consulta

Sólo SELECT paginado de reservas/estadías/cabañas y
`vista_saldos_alojamiento_reserva.total_alojamiento` (importe efectivo).
No se leen contactos completos de Proyecto H ni se reemplazan contactos.

ID Cloudbeds exacto primero; después CAB + check-in + check-out + nombre exacto
normalizado (tildes/case/espacios). ID contradictorio, evidencia parcial, duplicados,
grupo o múltiples estadías quedan para revisión. Un nombre distinto sin ID fuerte
no se une automáticamente. Fecha/CAB compatibles son obligatorias incluso con ID
para atribuir el total al segmento. Tolerancia inclusiva de $5 CLP.

Canceladas se clasifican aparte; no se propone creación activa. Faltante significa
sin coincidencia en las reservas accesibles consultadas, no garantía fuera de RLS.
Si falla una lectura no se emite un informe de falsas reservas faltantes.

## PDF real validado

Archivo usado: “Haiku Cabañas Panorámicas Mes Sep - Reservas.pdf”, 3 páginas,
55 entradas, sin columna Total de la habitación. Validado con el mismo PDF.js y
parser usados por el navegador, además de inspección visual de la primera página.
El otro PDF “Septimebre” es un formato anterior que no aporta las columnas exigidas.
No se copió ningún PDF real ni contacto real a fixtures.

Comparación con lectura de 55 reservas y 55 saldos de Proyecto H:

| Clasificación | Entradas |
|---|---:|
| COINCIDE | 24 |
| TOTAL_DIFERENTE | 7 |
| FALTA_EN_PROYECTO_H | 5 |
| CANCELADA | 11 |
| MULTIHABITACION_REQUIERE_REVISION | 2 |
| AMBIGUA | 6 |
| NO_SOPORTADA | 0 |

Ejemplos anonimizados: A, CAB9, 11→12 septiembre, 160000, coincide por contexto
exacto. B, CAB5/CAB10, 03→05 septiembre, 313000, multihabitación sin reparto.
C, CAB5, 04→07 septiembre, 459000, ambiguo: el nombre del PDF difiere del nombre
en Proyecto H y no hay ID Cloudbeds coincidente. Este último corresponde al caso
Bruno que el usuario pidió comprobar: no se fuerza el matching por similitud.

## Pruebas

- `node --test tests/*.test.cjs`: suite del proyecto + regresiones 2A.
- `tests/cloudbeds-pdf.test.cjs`: normalización, fechas, multilinea, páginas,
  encabezados, dinero/cero, contactos, canceladas, múltiples habitaciones, -2,
  tolerancia, ID/contexto/ambigüedad, mapping, fallos/timeouts, sólo SELECT y XSS.
- `node tests/cloudbeds-pdf-browser.cjs` con NODE_PATH del runtime que incluye
  playwright/pdf-lib: PDF sintético de dos páginas, upload real al input, extracción
  real en worker y tarjeta sin botones de escritura. PDF inválido termina con error;
  PNG/JPEG/WEBP siguen llegando a la ruta anterior. Backend completamente simulado:
  cualquier RPC está prohibida. No se generó ni guardó una reserva real.

El informe usa un bloque propio, sin la clase de preview que activa interceptores
de creación. PDF se reclama en captura antes de la ruta de imágenes; sólo lectura
también si el texto del mensaje pide una creación/cambio. No inicia etapa 2B/2C.
