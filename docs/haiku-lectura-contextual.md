# Lectura contextual del Libro

La identidad se resuelve dentro del bloque de reserva, después de localizar cabaña, fechas y celdas combinadas. Una frase con varias palabras no basta para declarar un titular: primero se descartan roles e instrucciones explícitos. No se excluyen personas por su nombre.

| Evidencia ficticia | Interpretación |
| --- | --- |
| Ana Pérez // aseo express realizado por Rosa Vega | Titular: Ana Pérez. La segunda parte permanece como nota de aseo. |
| Camarero // Rosa Vega // Ana Pérez | El campo inmediato a Camarero es el responsable de aseo. Ana Pérez sigue siendo candidata a titular. |
| Ana Pérez // Pagador: Pedro Silva | El pagador no reemplaza al huésped. Esta nota por sí sola no registra un pago. |
| Masajista: Rosa Vega 17:00 | Profesional y horario, sin declarar una prestación. No crear un masaje. |
| BOOKING - Ana Pérez // NO SHOW | Ana Pérez es titular. Canal y estado permanecen en el texto original. |
| Ana Pérez // Pedro Silva | Dos nombres sin rol: conservar la duda y pedir aclaración. |

El rol separado afecta sólo al campo inmediatamente contiguo y no salta teléfonos, fechas u otros datos. Las notas, instrucciones, préstamos e insumos conservan su texto original. Las columnas de aseo y pagos mantienen sus lectores propios. Importes, comprobantes, cortesías y fechas de servicio siguen exigiendo evidencia de su campo; no se deducen del nombre de una persona.

## Verificación del 8 de noviembre de 2026

- Reproducción con las hojas de octubre y noviembre mediante el lector XLSX y OOXML de producción: nueve reservas dejan de aparecer como titulares ambiguos (ocho de octubre y una de noviembre). Además se corrige un titular que antes era «NO SHOW».
- Ninguna reserva previamente reconocida desaparece. Los 218 pagos leídos, aseos, bloqueos y cancelaciones conservan exactamente su salida anterior. En las reservas existentes sólo cambia aquel titular erróneo.
- Normalización local de ambas hojas, 36.054 celdas: mediana 234 ms, percentil 95 de 259 ms, en 25 iteraciones tras calentamiento. No incluye descarga, descompresión ni consulta a Proyecto H; no es una promesa de tiempo de informe.
- 369 pruebas locales del lector, identidad, notas, ocupación, servicios, pagos y continuidad pasan. El contrato XLSX utiliza las versiones verificadas de SheetJS 0.20.3 y JSZip 3.10.1.
- Los casos reproducibles usan personas ficticias en `tests/libro-roles-contexto.test.cjs` y forman parte de la integración continua.

La revisión fue de lectura, sin modificar el Libro ni registrar reservas, pagos o servicios. Esta mejora corrige los patrones comprobados; no implica interpretación perfecta de cualquier texto futuro. Dos huéspedes sin rol o datos realmente contradictorios siguen requiriendo aclaración.
