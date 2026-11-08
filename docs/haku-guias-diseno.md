# Guías de recepción · referencia visual

[Diseño editable en Figma](https://www.figma.com/design/QaCAPbu2nzVAFYlxQSVumT?node-id=4-5)

Menús en dos columnas, cabecera sin duplicar el nombre, un paso a la vez, datos con divisores y capturas ampliables. Se conservan los contratos de historial, borrador y consultas del asistente. Las imágenes se sirven localmente y se cargan sólo en los pasos donde aportan contexto.

## Capturas incorporadas

Todas proceden de `PROCESO DE RESERVAS.docx`, entregado por recepción. `INGRESOS MANAGER.docx` no contiene imágenes; no se inventan pantallas de Manager.

| Recurso local | Imagen del documento | Tratamiento |
| --- | --- | --- |
| cloudbeds-anadir-pago.png | image13.png | Recorte de Folio y menú Añadir pago |
| santander-movimientos.png | image20.png | Sólo navegación; se excluye la cabecera con el usuario |
| cloudbeds-tarjeta-registro.png | image27.png | Sólo menú Acciones, sin cabecera de la reserva |
| cloudbeds-guardar-pago.png | image14.png | Campos recortados; nombre, habitación, importe y notas ocultos en los píxeles |
| terminal-tarjetas.jpg | image30.jpg | Recorte del terminal, menú Tarjetas |
| terminal-hotel.jpg | image31.jpg | Recorte del terminal, menú Hotel |
| terminal-checkin-checkout.jpg | image29.jpg | Recorte del terminal, menú Check-in / Check-out |
| terminal-monto.jpg | image33.jpg | Recorte del terminal, pantalla de importe sin completar |

Los recortes aplanados se inspeccionaron visualmente y con OCR. No se incluyen originales, datos personales, números de tarjeta ni capas recuperables con esos datos. Las imágenes ilustran controles; sus valores y fechas de ejemplo no se usan como datos para registrar un pago.

## Verificación

Pruebas del catálogo y reglas de los manuales; recorrido de los diez ingresos Manager y los seis medios de reserva; historial y consulta en curso; miniaturas, diálogo nativo con foco y Escape, navegación entre capturas, error de carga y tamaños de 320/390/1100 px en ambos temas. Las capturas del navegador se guardan en el artefacto de CI `haku-guias-capturas`.
