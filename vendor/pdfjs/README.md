# PDF.js local

Mozilla PDF.js / pdfjs-dist **5.6.205**, distribución `legacy/build` (compatibilidad
de APIs JavaScript), licencia Apache-2.0 adjunta. Copia exacta del runtime disponible
en el entorno de desarrollo, sin instalación ni CDN. Archivos: pdf.mjs y
pdf.worker.mjs. Fuente: https://github.com/mozilla/pdf.js

Usado únicamente al adjuntar un PDF Cloudbeds. Se carga localmente y el worker
recibe bytes en memoria; no se envía el PDF a Supabase ni a un servicio externo.
`isEvalSupported:false`; sin OCR ni ejecución de acciones de documentos.
