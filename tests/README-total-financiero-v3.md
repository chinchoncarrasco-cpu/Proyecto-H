# TOTAL 1 V3 — desplegada, primera escritura reservada al usuario

Aplicada mediante MCP con historial real:
`supabase/migrations/20260910233821_haiku_total_financiero_v3.sql`.
Backend verificado: `total1_financiero_v3`, `writer_disponible: true`.
Constanza conserva 160000; Bruno 428571, pagos 459000 y aplicado 428571.
Ningún writer remoto fue invocado. La primera confirmación V3 corresponde al usuario.
V2 histórica está intacta (SHA256
2268BBF07A994AA4C5EFEB3AD9982562104EDC87A36EA100B8726CECE846D587).
No se invocó ningún writer remoto. Lecturas remotas: esquema/trigger/vista y
clasificación de origen de los dos pagos, sin documentos ni contactos.

## Alcance deliberadamente conservador

Una reserva soportada por TOTAL, sólo cargos activos de alojamiento y sin servicios
registrados. Todos sus pagos deben ser confirmados, tipo pago, misma reserva,
sin grupo ni devolución vinculada, etapa abono/saldo y al menos una aplicación
previa de alojamiento. Una aplicación a otra reserva, cargo inactivo, servicio,
pago no confirmado o destino ambiguo bloquea el lote entero.

Dinero sin aplicación previa alguna no se presume destinado al alojamiento.
Metadata desconocida bloquea: se admiten las claves de procedencia ya observadas
(verificación migrada y origen Libro), contexto `haku_libro_incorporacion` y
concepto explícito cab/noche cuando vienen informados. No se busca identidad por
ese texto ni se modifican datos de origen. Esta primera versión no reconcilia
reservas mixtas aunque pudiera separarse su dinero en una ampliación posterior.

V3 exige además pagos.registrar; capacidad V3 comprueba ese permiso. No amplía
grants: writer/capacidad públicos para authenticated, funciones privadas sin
EXECUTE para anon/authenticated/PUBLIC; search_path pg_catalog.

## Algoritmo

1. Mismos locks deterministas por reserva y filas de V2, más servicios. Comprobar
   todos los expected totals y firmas antes de la primera mutación del lote.
2. Calcular tarifas/IVA/capacidad exacta. El plan IVA privado V3 conserva cálculo,
   redondeos y firma de V2, pero delega el límite físico de aplicaciones al nuevo
   plan, en vez de rechazar de antemano una distribución corregible. Preview IVA
   pública y funciones V2 no se reemplazan.
3. Construir un plan en memoria: conservar aplicaciones; liberar únicamente exceso
   por cargo. Cargos por fecha de noche/cargo_id, pagos por UUID, desempate por id
   de aplicación. Redistribuir primero TODO lo liberado; después saldo sin aplicar.
4. Si existe pareja pago/cargo, aumentar su fila. Si no, generar una nueva fila
   con la misma identidad de pago y un cargo de alojamiento elegible de la misma
   reserva. La pareja única y el trigger original siguen validando cada cambio.
5. Ejecutar disminuciones, actualizar tarifas/cargos/IVA, luego aumentos/inserts.
   Este orden evita sobreaplicaciones transitorias; no se deshabilitan triggers.
6. Verificar aplicaciones físicas completas contra el plan exacto, límite de cada
   pago y cargo, snapshot literal de pagos y datos ajenos, importes exactos y
   auditoría histórica intacta. Cualquier fallo revierte todas las reservas.

Filas existentes: sólo cambia monto_aplicado; id/pago_id/cargo_id/creado_en se
conservan. Una fila cuyo resultado sea cero se elimina (el modelo exige >0).
Filas nuevas sólo para parejas inexistentes admitidas por el trigger original.
No se crean/modifican pagos. No hay cambios de servicios, documentos, estados,
BOVE, fechas, contactos, manager ni otra metadata. La auditoría nueva contiene
IDs/importes antes/después e incremento aplicado; no documentos/contactos.

Confirmado > objetivo: bloquea. Confirmado < objetivo: aplica sólo dinero real,
queda saldo objetivo - confirmado. Igual: aplicado exacto y saldo cero. Bajo el
alcance admitido, todo el remanente confirmado es elegible; queda sin aplicar cero.
Si actual == objetivo, se conserva el no-op (no se usa como reparación automática).

## Bruno (datos económicos reproducidos, IDs sintéticos)

| Noche | Aplicado previo | Aplicado final | Diferencia |
|---|---:|---:|---:|
| 04/09 | 115714 | 153000 | +37286 |
| 05/09 | 142857 | 153000 | +10143 |
| 06/09 | 170000 | 153000 | -17000 |
| Total | 428571 | 459000 | +30429 |

Base 510000 → 546210; IVA -81429 → -87210; final 428571 → 459000.
Pagos 459000 intactos. Sin aplicar 30429 → 0. Saldo alojamiento final 0.
P1 mantiene 173571 aplicados: 20571 el 04/09 y 153000 el 06/09.
P2 pasa 255000 → 285429: 132429 el 04/09 y 153000 el 05/09.
Las cuatro aplicaciones existentes se conservan en este caso.

## Validación

- `node --test tests/*.test.cjs`: 574 aprobados, 0 fallos.
- `node tests/totales-financiero-v3-postgres.cjs`: 21 escenarios locales.
- Seis scripts SQL anteriores: 85 escenarios aprobados; total SQL 106.
- PGlite efímero, trigger real de aplicaciones y vista real de cargos; fixtures
  sin datos personales reales. No es una prueba de concurrencia de dos conexiones.
- Cubre caso Bruno, saldos menor/igual/mayor, servicios, devoluciones, otra reserva,
  metadata desconocida, residuo $1, varias aplicaciones/pagos, creación legítima,
  lote mixto, fallo a mitad de lote, expected total, no-op, snapshot pago/RUT y
  capacidad imposible. Se verifica rollback de datos y auditoría.

El cliente local acepta explícitamente V2 y V3; usa la misma RPC/confirmación.
Supabase ya anuncia V3. Los generadores temporales fueron eliminados;
se conserva la migración histórica completa y las pruebas permanentes.
