# TOTAL 1 — diagnóstico de aplicaciones de Bruno (sólo lectura)

Consulta real en Supabase después de la prueba del usuario. No se invocó el writer,
no se desplegó SQL y no se modificaron datos ni código funcional. Consultas dentro
de `BEGIN READ ONLY` / `ROLLBACK`; simulación obtenida de la preview IVA existente.
Se omiten documentos, contactos y metadatos personales de pagos.

## Conclusión

**Escenario A para el objetivo $459.000**, con una diferencia relevante entre
pagos confirmados y aplicaciones: pagos $459.000, aplicaciones $428.571,
saldo sin aplicar $30.429. No es B: el dinero confirmado no supera el objetivo.

Actualmente el total base es $510.000, IVA exento -$81.429 y final $428.571.
La vista global informa saldo -$30.429: ya hay ese excedente respecto del total
actual. La vista de alojamiento informa aplicado $428.571 y saldo cero.

`vista_estado_cargos` redistribuye virtualmente el aplicado de alojamiento a nivel
de reserva y limita cada cargo a su monto ajustado; **no refleja necesariamente
las filas físicas de pago_aplicaciones**. Por eso informa $142.857 aplicados en
cada noche aunque la distribución física sea distinta. El guard adicional de V2
comprueba las aplicaciones reales y detecta la noche del 06/09. No se relajó.

## Cargos actuales (CLP)

| Noche 2026 | Base | IVA | Efectivo | Aplicaciones físicas | Aplicado en vista |
|---|---:|---:|---:|---:|---:|
| 04/09 | 170000 | -27143 | 142857 | 115714 | 142857 |
| 05/09 | 170000 | -27143 | 142857 | 142857 | 142857 |
| 06/09 | 170000 | -27143 | 142857 | 170000 | 142857 |
| Total | 510000 | -81429 | 428571 | 428571 | 428571 |

Todos los ajustes son `iva_exento`, activos, signo -1 y base_calculo 170000.
En la distribución física actual, 06/09 excede su efectivo por $27.143 y 04/09
tiene capacidad física por los mismos $27.143. La vista normalizada no muestra
ese desajuste por cargo.

Identificadores de cargos:

- 04/09: `4b73719d-f836-4ed0-8168-0cf697de39ed`.
- 05/09: `90274dd8-f070-4451-8a58-a0a1a6596f79`.
- 06/09: `214ce541-ec05-4949-89b3-58a17b1b37c6`.

## Pagos y aplicaciones físicas

Ambos pagos están confirmados y son movimientos `pago`. Todas sus aplicaciones
van a cargos activos de alojamiento de esta misma reserva; ninguna a servicios
ni a otra reserva. No hay devoluciones entre los pagos de esta reserva.

| Pago | pago_id | Monto | Aplicado | Sin aplicar |
|---|---|---:|---:|---:|
| P1 | 51ae74b2-ed2e-4ed0-afaf-9688ee627b18 | 173571 | 173571 | 0 |
| P2 | 884f9379-9550-4aee-af39-905cb70f0244 | 285429 | 255000 | 30429 |
| Total | | 459000 | 428571 | 30429 |

| Aplicación id | Pago | Cargo/noche | monto_aplicado |
|---|---|---|---:|
| 1c2b9b68-0c56-43d0-8e2a-e0aa71ad706a | P1 | 04/09 | 3571 |
| eb6ee44a-c53a-4ac3-9b36-e5c0c4ec9b0f | P2 | 04/09 | 112143 |
| 600e860c-49fc-450f-8313-aa4754adfad7 | P2 | 05/09 | 142857 |
| a6384719-ba56-435b-934b-f440f8dfddca | P1 | 06/09 | 170000 |

## Preview autoritativa del objetivo $459.000

| Noche | Base nueva | IVA nuevo | Efectivo nuevo | Aplicación existente | Capacidad (efectivo - aplicado) |
|---|---:|---:|---:|---:|---:|
| 04/09 | 182070 | -29070 | 153000 | 115714 | 37286 |
| 05/09 | 182070 | -29070 | 153000 | 142857 | 10143 |
| 06/09 | 182070 | -29070 | 153000 | 170000 | **-17000** |
| Total | 546210 | -87210 | 459000 | 428571 | 30429 |

La aplicación `a6384719-ba56-435b-934b-f440f8dfddca`, de P1 al cargo
`214ce541-ec05-4949-89b3-58a17b1b37c6`, viola $170.000 <= $153.000.
Ésta es la causa exacta del mensaje de V2, no el cálculo del IVA.

## Propuesta futura — NO implementada

Una redistribución mínima posible sería mover **$17.000 del mismo P1** desde
06/09 hacia su aplicación existente de 04/09: 170000 → 153000 y 3571 → 20571.
Quedarían totales físicos por cargo 132714, 142857 y 153000. Se conservan los
cuatro IDs de aplicación, sus pago_id y el total aplicado de cada pago.

Esto sólo ilustra factibilidad: no se ejecutó. Una futura implementación debe
planificar bajo los locks deterministas del lote, revalidar expected total,
permisos, firma IVA y aplicaciones, y ejecutar total + redistribución en la misma
transacción. Debe conservar todos los datos de pagos (monto, medio, fecha, BOVTAR,
folio, CodAut, glosa, estado), verificar snapshots, capacidad por cargo y suma
exacta por pago/reserva, excluir servicios/otras reservas y revertir TODO si falla.

**Los $30.429 de P2 seguirían sin aplicar.** Conservar exactamente el total
aplicado impide consumirlos automáticamente. Tras esa propuesta, habría capacidad
de $30.429 en cargos y $30.429 sin aplicar, aunque pagos confirmados = total nuevo.
Aplicar ese remanente necesita una decisión explícita separada; no forma parte de
esta redistribución conservadora. No se propone devolución porque el dinero no
supera el nuevo objetivo.

La protección actual permanece activa hasta aprobar e implementar otro flujo.
