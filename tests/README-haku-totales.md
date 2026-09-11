# Haku · TOTAL 1 (preparación local)

**Estado vigente:** la corrección exclusivamente financiera v2 fue desplegada como
`20260910225553_haiku_total_financiero_v2.sql`. El cliente exige
`total1_financiero_v2`; la capacidad real y su render habilitado fueron verificados
sin invocar el writer. Constanza conserva $180.000 y Bruno $428.571.
La primera confirmación corresponde al usuario. Ver `README-total-financiero-v2.md`.
Los estados siguientes son históricos.

## Historial: writer v1 desplegado

Aplicada mediante MCP e historial Supabase la migración
`20260910210508_haiku_total_writer_atomico_v1.sql`. Esta sección sustituye los
estados de «sólo preview»/«writer pendiente» descritos cronológicamente abajo.
No se invocó el writer remoto, ni siquiera dentro de una transacción revertida.
La primera confirmación sobre una reserva real corresponde al usuario.

La UI consulta `haiku_capacidad_totales_v1()` al preparar y al confirmar. Exige
la versión contractual `total1_atomico_v1`, presencia de la RPC y soporte IVA,
grant y permisos efectivos. Ausencia, error o versión distinta bloquean todas
las reservas, incluidas las normales. No hay un booleano local de activación.
Una preview antigua marcada sólo lectura sigue bloqueada: debe prepararse otra.

El lote valida todas las entradas bajo locks antes del primer cambio. El campo
`total_actual` transporta el expected total. Si no coincide, aborta TODO, incluso
si otro proceso alcanzó ya el objetivo: no se acepta una propuesta obsoleta.
Con una preview vigente cuyo actual ya coincide con el objetivo, la entrada es
no-op sin reconstrucción ni nueva auditoría. Un plan IVA también se revalida por
firma. El guard del editor general permanece intacto.

En IVA se comprueban además los snapshots de IDs/metadatos de cargos, noches,
ajustes y aplicaciones; sólo pueden cambiar las tarifas/bases/importes previstos.
En una operación normal se reutiliza el editor existente y se verifican los
datos protegidos; sus aplicaciones de alojamiento siguen el motor original.
Los tests mixtos provocan fallo en Constanza después de Bruno y fallo en Bruno
después de una entrada normal, y exigen rollback íntegro en ambos órdenes.

Verificación real posterior: capacidad disponible; Bruno preview base 546210,
IVA 87210, final 459000; Constanza una noche uniforme, sin ajustes, actual 180000
y objetivo 160000. Se ejecutaron sólo SELECTs dentro de REPEATABLE READ READ ONLY,
con contexto de un usuario autorizado, comparando snapshots y finalizando con
ROLLBACK. Reserva, estado, vínculos, pagos, BOVE, servicios y auditoría intactos.
El writer no se probó con datos reales. No hay test de dos conexiones concurrentes.

Validación del SQL final: `node tests/totales-writer-mixto-postgres.cjs` (12
escenarios). La prueba usa el archivo real de migración, PGlite y datos sintéticos.
Las otras pruebas PostgreSQL conservan los 45 escenarios base/IVA/preview.

## Diagnóstico y estrategia antes de implementar

`haiku_listado_reservas_operativo` presenta `precio_total` desde
`vista_saldos_alojamiento_reserva.total_alojamiento`. Esta vista suma los cargos
activos de alojamiento, con sus ajustes. No existe un campo independiente que
deba sobrescribirse en reservas.

La edición manual usa `haiku_modificar_reserva_completa`. Reconstruye cargos,
actualiza tarifas y reasigna aplicaciones sin borrar pagos; rechaza un objetivo
inferior al dinero aplicado. También procesa datos personales y acompañantes.
Los ajustes existentes representan IVA o cargos de cancelación/modificación,
pueden afectar grupos y no son un mecanismo general para fijar cualquier total.

Se prepara un wrapper transaccional que llama a la RPC oficial, sin copiar su
motor. Bloquea grupos, más de una estadía, ajustes activos, tarifas variables y
estructura de noches incompleta. Sólo acepta tarifa uniforme: objetivo divisible
exactamente entre noches, sin redondeo ni redistribución inventada. Full Day usa
su importe único. Estos límites se muestran antes de confirmar.

La extensión IVA documentada al final habilita una excepción acotada a este
bloqueo de ajustes; no modifica el guard del editor general.

El wrapper bloquea reservas en orden de UUID y revalida los totales esperados
antes de actuar. Cualquier excepción revierte TODO el lote. Compara snapshots de
datos protegidos antes/después de llamar al motor; si la edición completa
normalizara contactos, documentos o vínculos, rechaza y revierte también.
No restaura datos con un segundo UPDATE para ocultar efectos laterales.

El SQL se entrega en `supabase/preparadas/haiku_totales_lote_v1.sql`, sin aplicar.
No se genera una migración numerada porque no hay Supabase CLI disponible; la
generación y despliegue son un paso posterior explícito. No hay fallback a RPCs
individuales si falta la RPC de lote. Tests SQL usan PGlite ya instalado y datos
sintéticos; no acceden a Proyecto H.

No se implementa PDF ni tolerancia de $5 en TOTAL 1: un mismo total es no-op;
cualquier otro total solicitado explícitamente requiere vista previa.

## Implementación y prueba

- `js/supabase-asistente-totales-v1.js`: intenciones claras, hasta 20 entradas,
  separación por «y», coma o salto de línea. Nombre exacto normalizado y CAB
  opcional; consulta histórica sin elegir arbitrariamente nombres duplicados.
- `preparar(texto | entradas, opciones)` genera una vista previa. La entrada
  estructurada admite `reserva_id`, `total_actual`, `total_objetivo`, `origen`.
  El total esperado de la fuente también se verifica. No existe writer PDF.
- `confirmar(preview)` acepta sólo propuestas emitidas por el módulo, impide
  doble envío, relee reserva/total/estructura/ajustes y comprueba permisos.
  Envía una sola RPC `haiku_cambiar_totales_lote_v1`, sin fallback por reserva.
  RPC ausente, error o respuesta incierta no se presentan como éxito; no se
  reintenta automáticamente. Cancelar y totales iguales no llaman RPC.
- Tras éxito se recargan Reservas, sincronización normal, resumen, saldos y la
  ficha abierta por ID. El nuevo refresco de ficha sólo hace lectura y verifica
  que siga abierta la misma reserva antes de pintar.

Se leyeron únicamente metadatos SQL remotos para confirmar las definiciones
actuales. El editor actual envuelve `haiku_modificar_reserva_completa_core` y
reinicia estados sólo ante cambios estructurales. Las fixtures conservan ambas
definiciones y el trigger real `haiku_sincronizar_cargo_noche`. El esquema y los
datos del test son sintéticos; la auditoría del test es simplificada. No se
aplicó ninguna migración ni se invocaron escritores reales.

Validación:

```
node --test tests/*.test.cjs
node tests/totales-postgres.cjs
```

El segundo comando necesita `HAKU_PGLITE_MODULE` apuntando al PGlite existente.
Prueba el motor y trigger originales, dos cambios exitosos, no-op, permisos,
totales inválidos/obsoletos, pagos aplicados, duplicados, tarifas variables,
multiestadía, ajustes, Full Day, acompañantes y conservación de datos protegidos.
Inyecta un fallo en el INSERT de cargos de la segunda reserva: comprueba rollback
de cargos, noches, aplicaciones y auditoría de TODO el lote. También provoca una
normalización de documento no autorizada y verifica rollback completo.
No es una prueba de dos conexiones concurrentes; no hay PostgreSQL servidor local.

Ejemplos para probar la vista previa (sin confirmar en datos reales):

```
Haku cambia el total de CAB 5 Bruno Borge a CLP$459.000
Haku cambia el total de la reserva de CAB 5 · Bruno Borge a CLP$459.000 y CAB 9 · Constanza Kutscher a CLP$160.000
```

El SQL preparado debe revisarse, convertirse en migración y desplegarse antes
de que el nuevo Confirmar pueda guardar en Proyecto H. BOVE continúa con su
bloqueo independiente; este trabajo no lo habilita.

## Total final con una operación IVA exento

**Despliegue escalonado 10/09/2026:** aplicada por MCP con historial la migración
`20260910205010_haiku_total_iva_preview_solo_lectura.sql`. Únicamente crea
`public.haiku_previsualizar_total_iva_v1(uuid,bigint)` STABLE, grants y comentario.
Incluye la fórmula PostgreSQL original dentro de la única función, sin instalar
helpers ni reemplazar las RPC existentes que aplican ajustes. Retorna
`solo_lectura: true`; Haku muestra la propuesta sin botón de Confirmar y no la
registra como confirmable. Incluso un lote mixto queda sin acceso al writer.

La llamada real de Bruno se verificó mediante el conector SQL, con contexto
transaccional de un usuario activo con los permisos requeridos, dentro de
`REPEATABLE READ READ ONLY`, terminando con ROLLBACK. Devolvió base 546210,
IVA 87210 y final 459000. Las huellas antes/después de reserva, estadías, noches,
cargos, ajustes, pagos, aplicaciones, servicios y auditoría fueron iguales.
Se comprobó que no existe `haiku_cambiar_totales_lote_v1` ni el writer IVA remoto.
La prueba visual en Haku queda para el usuario; no se pulsó ninguna escritura.

La revisión de advisors señala la exposición autenticada SECURITY DEFINER
([aviso 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)).
Es intencional para esta RPC: comprueba auth.uid y los tres permisos, excluye anon,
usa search_path pg_catalog y sólo lectura. Los avisos de otras funciones/Auth no
se modificaron en esta etapa. La CLI no está instalada: la versión local se tomó
del historial generado por Supabase, sin inventar un timestamp ni instalar software.

Test exclusivo: `node tests/totales-iva-preview-postgres.cjs`: 12 escenarios
sin instalar writers, llamada READ ONLY, permisos, importes e incompatibilidades.

Preparación adicional: `supabase/preparadas/haiku_totales_iva_v1.sql`, para aplicar
después del SQL base, únicamente en un despliegue autorizado posterior. No está
aplicada a Supabase. Esta extensión completa y su writer siguen pendientes;
la función de preview desplegada arriba mantiene expresamente el guardado bloqueado.

El objetivo es el total final de alojamiento. Se extrae a un helper privado la
fórmula original `base - round(base / 1.19)` y se reutiliza en las dos funciones
existentes de aplicar ajustes, conservando literalmente sus restantes reglas,
permisos y distribución. El navegador no calcula IVA. La base propuesta es
`round(objetivo * 1.19)` y se verifica que el final sea exactamente el solicitado.
Para Bruno: 510000 − 81429 = 428571; objetivo 459000 requiere base 546210 e IVA
87210. Un objetivo igual al actual conserva la base y no escribe.

Una operación IVA puede estar repartida en tres filas: se exige un único
`operacion_id`, tipo IVA exento, signo −1, porcentaje 19 y correspondencia única
entre cada noche, cargo activo y ajuste. Cancelación, modificación, combinaciones
y operaciones múltiples permanecen bloqueadas. Requiere además `pagos.registrar`.

El lote adquiere los locks, comprueba el total y vuelve a calcular el plan/firma.
La rama IVA conserva los cargos existentes: cambia las tarifas y el trigger
oficial actualiza esos mismos cargos. Sólo actualiza `base_calculo` y `monto` de
los ajustes; conserva IDs, operación, creador, fecha original y concepto. Registra
los valores anteriores/nuevos en `eventos_auditoria` dentro de la transacción.
No anula ajustes, reconstruye cargos ni reasigna pagos. Cualquier fallo revierte
el lote y su auditoría. La rama sin IVA mantiene el editor oficial anterior.

La base se reparte por cociente y resto, en orden fecha/ID de noche. El IVA usa
el orden cargo creado_en/ID y el residuo final de la función original. Se bloquea
si una noche quedaría por debajo de sus pagos aplicados, sin redistribuirlos.
Se aceptan inicialmente tarifas uniformes; después de repartir un residuo las
tarifas pueden diferir en un peso y una nueva edición requerirá revisión bajo
ese mismo límite conservador.

Validación adicional: `node tests/totales-iva-postgres.cjs` con el mismo módulo
PGlite. Comprueba plan sin escrituras, fórmula, distribución exacta/con residuo,
persistencia exacta, metadatos originales, pagos/BOVE/servicios/datos personales,
no-op, plan obsoleto, rollback intermedio y bloqueo de otros ajustes. El esquema
y la tabla de auditoría de prueba son sintéticos; no equivalen a una validación
remota ni a una prueba de dos conexiones concurrentes.
