# BOVE ETAPA 2 — sólo lectura

`supabase-asistente-bove-consultas-v1.js` intercepta consultas explícitas de BOVE
antes del parser general. No llama a reconciliación ni ofrece guardar.

## Fuentes

- Proyecto H: exclusivamente `reservas.bove_cierre` (alojamiento) y
  `reservas.bove_checkout` (servicios), con `reserva_estadias` y `cabanas`.
- Libro cargado: colección independiente `evidencias_bove` de la semántica.
  Conserva texto y coordenadas aun sin monto. BOVTAR queda excluido.
- `PEND BOVE`, `BOVE PEND`, `PENDIENTE BOVE` y `PEND 50% BOVE Y MANAGER`
  producen número null. Texto BOVE no interpretable conserva estado no_determinado.
- Fecha/cabaña del bloque financiero sólo se agregan con geometría inequívoca.
  No son identidad. El titular/tipo se obtiene únicamente de una reserva o pago
  ya asociado por la semántica, nunca de pagos_sin_asociacion ni de proximidad.

Si falta titular directo, se evalúan las reservas semánticas de la misma hoja
por cabaña y día ocupado. Una única candidata sin advertencias y con titular
produce `titular_resuelto` y `resolucion: contexto_unico`, sólo para presentación.
El checkout del alojamiento queda fuera; Full Day incluye su propio día.
Cero candidatas, múltiples segmentos o dudas mantienen el titular no determinado.
`reserva_contexto` conserva sólo cabaña, fechas y tipo; no crea una identidad.
Ni `titular`, ni los segmentos/tipos usados en comparación se sustituyen por
esta resolución secundaria. No hay lecturas adicionales ni cambios en pagos.

## Consultas manuales

- `Haku, busca el BOVE 16968`
- `Haku, busca el BOVE 16968 en el Libro`
- `Haku, busca en Proyecto H el BOVE 16968`
- `Haku, ¿qué BOVE está pendiente completar para hoy?`
- `Haku, ¿qué BOVE existe en Proyecto H que no esté en el Libro?`
- `Haku, ¿qué BOVE existe en el Libro que no esté en Proyecto H?`
- `Haku, ¿cuál es el último BOVE registrado?`

Pendientes usa hoy en America/Santiago, los check-in de hoy y la hoja mensual
inequívoca de ese mes. No incluye reservas futuras o canceladas. Alojamiento
requiere cargos activos positivos; servicios exige al menos un servicio cobrable,
no cancelado, con cargos activos pagados, igual que el indicador existente.
Pago pendiente y BOVE pendiente se mantienen separados.

Búsquedas por número filtran Proyecto H y seleccionan hojas del Libro mediante
`buscarHojasBove(numero)`: una lectura OOXML que admite puntos/comas de miles,
sin SheetJS ni semántica global. Sólo las hojas candidatas pasan a semántica.
La selección por número y la lectura semántica se guardan
sólo en memoria por generación; Proyecto H se vuelve a consultar. Comparaciones
globales y último BOVE son consultas históricas explícitas y pueden tardar en su
primera lectura. No usan el monitor operacional ni su caché.

La consulta tiene un límite total de 20 segundos, incluyendo esperas de carga y
cola. Al vencer muestra error, libera el envío y no agenda más hojas desde esa
consulta. No declara inexistencia. Una lectura de worker ya iniciada mantiene el
límite de vida del lector existente; su resultado tardío no modifica la respuesta.
Medición local con `(9)`: selección de `16968` → sólo `Sep26`, 1,26 s. Es la
selección de candidatos, no la latencia total de la tarjeta en el navegador.

## Límites deliberados

Coincidencia/conflicto requiere contexto compatible único (titular, segmento y
alcance). Evidencia sin asociación segura se muestra no determinada; no prueba
ausencia. Los fallos de lectura tampoco se presentan como ausencia.

Sin evidencia explícita de serie se informa mayor número observado por longitud,
sin certificar serie ni orden temporal de registro. Tres dígitos no implican por
sí solos no afecta. El mismo número en ambos campos de Proyecto H se presenta
una vez con ambos alcances, sin inferir una boleta combinada.

No se muestran texto original libre ni contactos/documentos en las tarjetas.
No hay RPC, escritores, cambios de esquema ni acciones financieras.

Pruebas: `node --test tests/*.test.cjs`. Los dos archivos `bove-*.test.cjs`
cubren extracción independiente, regresión, fuentes, coincidencias, conflictos,
pendientes, Full Day, ambigüedad, series, caché, consultas focalizadas y routing UI.
