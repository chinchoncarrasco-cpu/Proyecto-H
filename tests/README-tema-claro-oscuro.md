# Tema claro y oscuro

Implementa el diseño aprobado en [Figma](https://www.figma.com/design/LtDuKmtjTHE3hmtPo0wO58?node-id=18-876), sobre los componentes existentes. El modo inicial es claro. La preferencia `haikuTemaV1` se guarda en este navegador y se comparte entre sus pestañas. Si el almacenamiento está restringido, el selector funciona durante la visita.

El selector queda al pie del menú en escritorio y como un icono de 44 px junto a la navegación móvil. Es un botón nativo, operable con Enter y Espacio. Cambiar el tema sólo actualiza el atributo del documento y su etiqueta: no vuelve a construir vistas ni llama a los lectores o writers.

## Archivos y mantenimiento

- `js/haiku-tema-v1.js`: aplica la preferencia en el head, antes del contenido, y enlaza el selector cuando el DOM está listo.
- `css/haiku-tema-v1.css`: selector, paleta de estados, fondos y complementos explícitos. La geometría nueva se limita al espacio del selector.
- `css/haiku-tema-oscuro-v1.css`: hoja estática generada a partir de los colores de los componentes existentes, incluidos estilos que Haku monta dinámicamente. Sólo contiene propiedades visuales de color y sombra, bajo el atributo de tema y `@media screen`. No hay filtros de imágenes ni recoloreado del DOM durante el uso.
- `tools/generar-tema-oscuro.cjs`: paleta y generación reproducible. Mantiene las condiciones responsive y el orden de las hojas del panel. Los colores de celdas XLSX y de la barra lateral quedan excluidos. Las variables dinámicas de estado se conservan.

Los estilos del proyecto tienen colores literales en hojas antiguas, modernas y tarjetas de Haku. La hoja generada permite cubrirlos sin modificar sus reglas de funcionamiento ni sustituir sus componentes. Cuando cambien esos estilos o sus colores, regenerar y verificar ambas apariencias. La aplicación no necesita Playwright ni ejecutar el generador.

## Validación local

Con `playwright` y `@electric-sql/pglite` disponibles en Node:

```sh
node tools/generar-tema-oscuro.cjs
node --test tests/haiku-tema-v1.test.cjs
node tests/haiku-tema-browser-check.cjs
TZ=America/Santiago node --test tests/*.test.cjs
```

`NODE_PATH` puede apuntar a dependencias instaladas fuera del repositorio. `CHROMIUM_PATH` permite especificar el ejecutable Chromium/Edge local. `TEMA_OUTPUT_DIR` define el directorio de capturas; por defecto se crea uno temporal.

El harness del navegador bloquea la red externa. Reutiliza los renderizadores y clientes falsos de las pruebas existentes, con datos sintéticos. Compara claro → oscuro → claro en 13 vistas a 1600 y 390 px: Calendario, Cabañas, Servicios, Reservas, Historial, Cierre, Pagos, Haku inicial, Haku con respuesta, Notificaciones, Cuenta, Libro y ficha de reserva. Compara cajas, campos, desplegables, desplazamientos y colores exactos de las celdas del Libro; también comprueba errores de navegador y contraste del texto visible activo. Es una comprobación de esos escenarios, no una auditoría completa de accesibilidad de la aplicación.

Incluye teclado, persistencia al recargar, sincronización entre pestañas, tamaños 320 × 568 y 1280 × 600 e impresión con la apariencia original. Las pruebas unitarias cubren primera visita, preferencia inválida, almacenamiento restringido y carga repetida.

No contiene migraciones, cambios de reglas de reservas/pagos ni llamadas para actualizar registros reales.

Resultado del 23-10-2026: **3.245 pruebas de la suite completa aprobadas**, sin fallos ni omisiones, con `TZ=America/Santiago`; **26 escenarios visuales aprobados** en Chromium, más teclado, recarga, tamaños reducidos e impresión. La primera ejecución heredó `Australia/Sydney` del entorno y dos pruebas de fecha fallaron; ambas y la suite completa pasaron al usar la zona horaria de Chile, sin modificar esas pruebas ni el código de fechas.
