# Ampliación/reducción de noches y revisión de ingreso/salida

Continuación local en `codex/libro-reprogramacion-20261116`, sobre `967e294`. Al retomar, HEAD seguía en ese commit: se conservaron los seis archivos modificados y todos los archivos sin seguimiento. Antes de editar se respaldó ese estado en `%LOCALAPPDATA%\ProyectoH\diagnosticos\libro-reprogramacion-noches-retoma-20261116\estado-recuperado`. No hubo push, merge, despliegue ni escrituras en reservas reales.

## Resultado

Se completó la revisión de noches empezada después de `967e294`. El bloqueo general de duración impedía cambios válidos de alojamientos futuros. La migración local `20261117020759_libro_reprogramacion_revision_noches.sql` los admite con aprobación explícita de cada noche adicional o retirada. Conserva las tarifas y cargos de las noches retenidas; una retirada sin aplicaciones ni ajustes activos anula su cargo y conserva la noche y el cargo como historial. Los pagos y sus aplicaciones permanecen intactos.

| Recorrido ficticio por el chat de Haku | Resultado verificado |
| --- | --- |
| CAB 9, 28–29/12 → 28–30/12 | 1 → 2 noches; alojamiento $144.000 → $288.000; nuevo cargo aprobado; Late Check-out el 30/12 |
| CAB 9, 28–30/12 → 28–29/12 | 2 → 1 noche; alojamiento $288.000 → $144.000; cargo retirado anulado; Late Check-out el 29/12 |
| Jacuzzi o nota fuera del nuevo rango | Se conserva su fecha; el servicio queda señalado para revisión, también en la ficha |
| Ingreso registrado o salida registrada | Confirmación de reprogramación deshabilitada; accesos reales a la ficha de la estadía y al historial de la reserva |

La prueba interrumpida estaba en el historial: los eventos de `reserva_estadias` con cambios de `checkin_realizado_en` / `checkout_realizado_en` se ocultaban como técnicos, dejando una reserva sin actividad visible. Ahora esos movimientos muestran Check-in/Check-out y su fecha, incluso si se retira el registro. Las ediciones técnicas comunes mantienen su filtro.

El operador puede abrir **Ficha → Estado** para revisar una corrección. Volver a Confirmada avisa que limpiará el ingreso/salida y exige su confirmación propia. En estas pruebas se abrió esa confirmación y se canceló: no se modificó el estado ni los timestamps. La reprogramación nunca los reinicia automáticamente. Un ingreso/salida real requiere revisión operativa antes de cambiar las fechas por esta ruta.

## Verificación

- Chromium: 16 recorridos nuevos, ampliación/reducción e ingreso/salida × escritorio/móvil × claro/oscuro. Guardado contra PostgreSQL local, lectura posterior en la ficha, Agenda y notas del Resumen; comprobación de noches, importes, cargos, aplicaciones, estado e historial. Sin desborde horizontal. Se corrigió la carga de la hoja real de la ficha en el fixture del navegador.
- Regresión de navegador: 9 recorridos Haku/Libro, ambos tamaños y temas, más conflicto surgido después de revisar la propuesta.
- Suites focales: 194 pruebas aprobadas, sin fallos ni omisiones. Incluyen PostgreSQL, Haku, Libro, pagos, notas, identidad de servicios, ficha, estados e historial. Las nuevas guardas comprueban aplicaciones/ajustes, disponibilidad, tarifa concurrente, permisos, decisiones falsificadas, reintentos y timestamps de ingreso/salida independientes del estado.
- JavaScript modificado y pruebas nuevas: sintaxis verificada. Reloj fijo únicamente en el PostgreSQL efímero de prueba para que diciembre de 2026 siga siendo futuro en CI.

Evidencia privada: `%LOCALAPPDATA%\ProyectoH\diagnosticos\libro-reprogramacion-noches-retoma-20261116`. Incluye `noches-navegador-sintetico.json`, capturas de previa/confirmación/ficha/estado/historial, `noches-browser-final.log`, `regresion-focal.log` y la regresión previa en `regresion/`. [Resumen de resultados sintéticos](libro-reprogramacion-noches-20261116.json).

Para repetir con `NODE_PATH` apuntando a las dependencias aisladas de prueba:

```powershell
node --test --test-concurrency=1 tests/libro-reprogramacion.test.cjs tests/libro-reprogramacion-postgres.test.cjs tests/libro-reprogramacion-noches-postgres.test.cjs
node tests/libro-reprogramacion-noches-browser-check.cjs
node tests/libro-reprogramacion-browser-check.cjs
```

## Límites y publicación

No queda un bloqueo en las dos modificaciones válidas probadas. Se mantienen bloqueos por ingreso/salida, cancelación/no-show, ocupación, tarifas no verificables y noches retiradas con aplicaciones o ajustes activos. Estas últimas requieren revisión financiera; no se desvinculan pagos ni se realizan devoluciones implícitas. Cambiar duración exige alojamiento futuro de 1 a 366 noches; Full Day mantiene el tratamiento anterior.

Todo se probó con datos ficticios y PostgreSQL embebido PGlite con exclusiones reales. No se comprobó concurrencia de dos conexiones independientes ni la ejecución en Supabase productivo. La publicación sigue pendiente de autorización: deberá aplicar primero `20261117005357` y después `20261117020759`, antes del frontend correspondiente. `diagnosticos/libro-estados-20261115.json` y `supabase/.temp/`, encontrados al retomar, se conservan sin incorporarlos al cambio.
