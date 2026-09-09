# Diagnóstico local de pagos del 03 de septiembre

Base: `bac87aea591c1e4d306c7400cb929a422dd16b24`, árbol inicialmente limpio.
Respaldo local: `codex/seguro-pagos-20260909`. Sin push ni escrituras en Supabase.

## Evidencia del archivo real

Se leyó `Libro de reservas actual 2025 (8).xlsx` de Descargas, hoja `Sep26`, con
`leerHoja` del worker original, SheetJS 0.20.3 y JSZip 3.10.1 (las versiones del
lector). El XLSX no se modificó ni se agregó al repositorio. La fixture de pruebas
reproduce la geometría relevante y los datos del caso proporcionado, sin contactos
ni documentos de huéspedes.

Las celdas K46 y K47 son fechas numéricas Excel: `t=n`, `v=46268`. Con la opción
real del worker, `cellDates:true`, llegan como `t=d`, Date
`2026-09-03T00:00:00.000Z`. `leerHoja` devuelve para ambas:
`valor: "3-9-2026"`, `valorNumero: null`, `fechaISO: "2026-09-03"`.

| Campo semántico tras recuperar el bloque | K46:N46 | K47:N47 |
|---|---|---|
| titular | Macarena Hurtado | Macarena Hurtado |
| fecha_bloque | 2026-09-03 | 2026-09-03 |
| fecha_comprobante | 2026-09-03 | 2026-09-03 |
| monto / moneda | 153000 / CLP | 40000 / CLP |
| medio_pago | credito | credito |
| concepto | cab1/1noche | early check in |
| folio | 000235 | 000235 |
| bovtar | 173121 | 173121 |
| codigo_autorizacion | null | null |
| cabana del bloque | 5 | 5 |
| tipo_movimiento | alojamiento | servicio |
| origen.hoja | Sep26 | Sep26 |
| estado_pago / pago_recibido | registrado_en_libro / true | registrado_en_libro / true |

No existe un campo genérico `fecha` ni `medio` en ese objeto: son los campos
anteriores. BOVTAR se conserva en `bovtar`; no se inventa `codigo_autorizacion`.
El canon existente mantiene su compatibilidad con los identificadores históricos.
`texto_original` concatena fecha visible, detalle, concepto e importe. Los detalles
reales son:

```text
Macarena Hurtado // Luigi Martínez // Bovtar: 173121-Folio: 000235// CREDITO // DG
Macarena Hurtado // Luigi Martínez // Bovtar: 173121-Folio: 000235 //CREDITO// DG
```

La reserva del Libro está en `K7`: CAB 5, 03/09 → 04/09. La otra está en `O12`:
CAB 10, Full Day del 04. Los pagos del 04 están en `O71:R71` y `O72:R72`.

## Causa y corrección limitada

`supabase-libro-reserva-worker-v1.js::leerHoja` sí devuelve las cuatro celdas de
cada movimiento. `haiku-libro-semantica-v1.js::normalizarHoja` exigía un marcador
«Pagos de arriendos de hoy» en la columna de cada día y ejecutaba `continue` si
faltaba. `K25:N25` conserva su combinación de cuatro columnas, pero su título
está vacío. Por eso no se creaban objetos semánticos para el 03: no llegaban al
canon, al filtro focalizado, a la conciliación ni a la tarjeta. La fecha estaba bien.

La recuperación exige geometría mensual reconocida, filas de cabañas financieras,
banda vacía combinada de cuatro columnas en la fila de títulos y, en cada fila,
fecha tipada, titular, concepto y monto positivo. No acepta otro título ni geometría
desconocida. Mantiene `cobertura_pagos:false` para ese día; no declara lectura completa.
Los movimientos recuperados quedan en `pagos_sin_asociacion`, con advertencia y
revisión manual. El concepto CAB 1 se muestra como discrepancia de la CAB 5 física;
no cambia la estadía. Early Check-In queda como servicio y conserva su propio importe.
Compartir Folio/BOVTAR no suma ni fusiona estos dos importes automáticamente.

En conciliación, un movimiento recuperado sólo se muestra ya existente si coincide
inequívocamente por identificador, reserva, titular, monto, moneda, medio y fecha.
Las protecciones de incorporación existentes siguen bloqueando identificadores
conflictivos. La tarjeta muestra concepto además del identificador y las advertencias.

La frase exacta «Haku revisa los pagos de Macarena Hurtado del 03 de septiembre
para agregarlos a Proyecto H» tampoco activaba el scope por omitir «Libro».
`haiku-libro-pagos-focalizados-v1.js` ahora reconoce esa petición de revisión y la
enruta al Libro antes del parser general. Conserva las dos estadías de la persona.

## Archivos de aplicación modificados

- `js/haiku-libro-semantica-v1.js`: recuperación y clasificación descritas.
- `js/haiku-libro-consultas-v1.js`: identificación conservadora de recuperados ya
  existentes y visualización del concepto/advertencias.
- `js/haiku-libro-pagos-focalizados-v1.js`: petición explícita de Haku sin «Libro».

El cargador, worker, canon y capa UX de reconciliación no requirieron cambios.
Se mantuvo la ruta normal de los bloques rotulados. La comparación real antes/después
confirmó igualdad JSON de los 20 movimientos del bloque del 04, incluidos los dos
de Macarena. No se consultó ni modificó la base de producción; los tests de
conciliación usan un cliente simulado de sólo lectura.

## Verificación y prueba local

Antes: 130/130 pruebas. Después: 137/137; `git diff --check` sin errores.
Siete pruebas nuevas cubren A/B (importes y Early Check-In), C (04 intacto),
D (identificador existente omitido), E (ambigüedad sin asociación automática),
geometría incompleta y la frase exacta a través del canon, compatibilidad y scope.
La prueba de render comprueba ambas tarjetas y sus importes, conceptos y advertencias.

```powershell
node --test tests/*.test.cjs
& 'C:\Users\Pipe\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m http.server 8000 --bind 127.0.0.1
```

Desde la carpeta del proyecto, abrir `http://localhost:8000/panel.html`, recargar,
iniciar sesión y cargar el XLSX. Pedir la frase exacta anterior y preparar la
incorporación para revisar las tarjetas. CAB 5 debe mostrar $153.000 y $40.000 en
revisión; CAB 10 conserva $100.000 efectivo y $20.000 débito. El estado «Ya existe»
del débito depende del pago real presente en Proyecto H y se vuelve a consultar
durante la preparación. Esta validación final en la sesión del operador queda para
la prueba local solicitada; no se confirmó ninguna incorporación.
