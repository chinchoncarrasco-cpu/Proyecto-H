# TOTAL 1 financiero v2 — desplegado, sin ejecutar escrituras reales

Migración aplicada mediante MCP e historial Supabase:
`20260910225553_haiku_total_financiero_v2.sql`, en `supabase/migrations/`.
La versión corresponde al historial real del despliegue. No se modificaron las
migraciones históricas. Ninguna RPC de escritura fue invocada en Supabase durante
este trabajo; la primera confirmación queda reservada al usuario.

Verificación posterior mediante SELECT: capacidad `total1_financiero_v2`,
`writer_disponible: true`; Constanza conserva $180.000 y Bruno $428.571.
Owner postgres y grants públicos conservados (authenticated, sin anon/PUBLIC);
helpers privados sin acceso de authenticated. Search path restringido a pg_catalog.

`totales-verificar-capacidad-cliente.cjs` verificó preparación y render del módulo
actual con respuestas reales obtenidas por SELECT: Confirmar habilitado para
Constanza $180.000 → $160.000 y única RPC consultada de capacidad. El verificador
rechaza cualquier RPC de escritura. No hubo pestaña autenticada de Proyecto H
disponible, por lo que esto verifica el render del cliente, no una prueba visual
en la sesión del usuario. El JSON temporal con las respuestas fue eliminado.

## Arquitectura

Se conserva una sola RPC de escritura: `haiku_cambiar_totales_lote_v1`.
La nueva implementación no llama al editor de reserva completa, no normaliza
documentos y no anula/reconstruye cargos ni aplicaciones.

1. Validación de lote (1–20), UUIDs distintos y montos enteros.
2. Advisory locks y filas ordenadas por UUID: reservas, estadías, cargos, pagos,
   aplicaciones, ajustes y noches.
3. Comprobación de todos los expected totals (`total_actual`) bajo lock.
4. Plan financiero completo y snapshots previos para todas las reservas.
5. Actualización en sitio únicamente de filas y columnas autorizadas.
6. Comparación literal de snapshots, importes por cargo y total final exacto.
7. Cualquier excepción revierte todo, incluidos eventos nuevos de auditoría.

Helpers privados nuevos: `haiku_plan_total_financiero_v2` y
`haiku_snapshot_total_financiero_v2`. Sin EXECUTE para anon/authenticated.
La RPC pública verifica auth.uid, reservas.editar y pagos.ver; IVA conserva
además pagos.registrar a través del plan autoritativo existente.

## Cambios admitidos

| Estructura | Cambio permitido |
|---|---|
| estadia_noches | tarifa; actualizado_en técnico si el trigger lo actualiza |
| cargos de alojamiento del plan | monto; actualizado_en técnico |
| cargo_ajustes IVA del plan | base_calculo y monto |
| eventos_auditoria | eventos nuevos del cambio financiero; registros anteriores intactos |

En alojamiento se actualiza tarifa y el trigger oficial actualiza el mismo cargo.
En Full Day inequívoco (sin noches, un cargo activo) se actualiza su monto.
Un cambio de concepto causado por un trigger NO se tolera: el snapshot lo detecta
y revierte. Tampoco se fuerza `origen_tarifa='manual'`: se conserva el origen.

Las exclusiones del snapshot se aplican sólo a filas cuyo valor financiero debe
cambiar según el plan. Servicios, cargos inactivos y filas sin cambios quedan
completamente protegidos. Se conserva toda metadata de ajustes, incluidos IDs,
operación, porcentaje, signo, concepto, observaciones, estado, creador y fecha.

## Protección literal

Reserva, estadías, todos sus huéspedes y vínculos, pagos completos, aplicaciones,
servicios, notas y solicitudes relacionadas se comparan sin normalización ni
excluir sus timestamps. Esto incluye documentos, contactos, notas, ocupación,
fechas, CAB, estado, check-in/out, BOVE, datos de pagos y BOVTAR.
Hay comprobaciones explícitas de `reservas.titular_numero_documento` y
`huespedes.numero_documento`, con detalle técnico si fallan.

## Distribución y aplicaciones

Normal: sólo noches uniformes y relación inequívoca noche→cargo activo, con
montos originales coincidentes. Se reparte cociente/resto por fecha e ID de noche.
500002 en tres noches produce 166668, 166667, 166667.
Las tarifas variables siguen bloqueadas; también una segunda edición de una
distribución previa con residuo si ya dejó tarifas no uniformes.

Las aplicaciones no se escriben, eliminan ni redistribuyen. Se comprueba el
aplicado neto de la vista financiera y conservadoramente la suma de pagos
confirmados por cargo contra su nuevo monto efectivo. Además se conserva el
límite global del dinero aplicado. Si una reducción requiere mover aplicaciones,
se bloquea incluso si el total de la reserva resulta suficiente.

IVA: reutiliza `private.haiku_plan_total_iva`, la misma autoridad de
`haiku_previsualizar_total_iva_v1`, sin copiar su fórmula. Una operación IVA puede
tener varias filas por noche; varias operaciones, otros tipos o mezclas se bloquean.
Bruno simulado: base 546210, exención 87210, final 459000, misma operación/metadata.

## Capacidad y estado remoto

El cliente exige `total1_financiero_v2`; el backend anterior anuncia
`total1_atomico_v1`, por lo que no habilita Confirmar aun cuando anuncie
writer_disponible=true. Se consulta al preparar y al confirmar.
El SQL candidato actualiza la capacidad y el comentario de versión del writer
en una misma transacción, comprobando existencia y grants de la RPC y helpers.
No se cambió esa capacidad en Supabase durante este trabajo.
Se debe recargar el panel local para usar el cliente corregido.

## Verificación

`tests/totales-financiero-v2-postgres.cjs` aplica el SQL candidato exclusivamente
en PGlite. 20 escenarios: RUT exacto `12.345.678-9` en ambas tablas; Constanza
180000→160000 con pago/aplicación 160000 intactos; Bruno; lote mixto; fallos en
ambos órdenes; stale preview; no-op; residuo exacto; sobreaplicación por cargo;
tarifas variables; otros ajustes; cambios laterales de documento/pago; Full Day.

La fixture anonimizada conserva la estructura que hizo fallar al writer anterior.
El test histórico del rollback sigue vigente y no fue adaptado para ocultar el
fallo antiguo. Los tests de contrato comprueban la lista exacta de UPDATEs y la
ausencia de reconstrucción, editor completo y fórmulas IVA paralelas.

Límites: esquema y datos sintéticos, funciones financieras originales; sin
escrituras reales ni pruebas de concurrencia con dos conexiones. La primera
prueba real debe esperar a la revisión y despliegue autorizados de esta migración.
