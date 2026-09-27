# Reposición de insumos desde Aseo — etapa 1

Este documento describe la implementación original. La extensión actual de destinos,
sus decisiones y validación están en [README-insumos-destinos.md](README-insumos-destinos.md).

Base: `main`/`origin/main` verificados en `f757203b434bcb33888957ea0a188f87635ae1ec`.
Rama: `feat/consumo-insumos-aseo`. Sin commit, push ni migración remota.

## Modelo y seguridad

Migración base actualmente versionada: `supabase/migrations/20260927150418_movimientos_insumos_aseo.sql`,
creada con `supabase migration new movimientos_insumos_aseo` (CLI 2.118.0).

`movimientos_insumos` guarda fecha operativa, cabaña, aseo, reserva opcional,
solicitud opcional reservada para el futuro, código de insumo, cantidad, unidad,
origen, autor original, último editor y ambas marcas de tiempo.

- Unicidad: `(fecha_operativa, cabana_id, aseo_id, insumo, origen)`.
- La FK compuesta `(aseo_id, fecha_operativa, cabana_id)` exige que las tres
  identidades pertenezcan al mismo aseo. Mantiene la unicidad existente de Aseo por día/cabaña.
- Carbón: cantidad `numeric` sin escala fija, con CHECK versionado: entero entre 0 y
  999999999. Se conserva el rango entero anterior y se rechazan fracciones
  (incluso `1.0000000001`), negativos, NaN e infinitos sin redondearlos primero.
  La constraint puede evolucionar en una migración futura sin cambiar el tipo.
  Tabla y RPC exigen `unidad = 'unidad'`. Carbón no tiene peso ni filas hijas.
- Leña: `movimientos_insumos.cantidad` debe ser NULL. La única autoridad de cantidad
  y peso es `movimientos_insumos_unidades`: una fila por saco, `peso_kg numeric`
  obligatorio, decimal, positivo y finito; FK a cabecera y autores con DELETE RESTRICT.
  Un trigger rechaza hijos de Carbón u otros insumos y fija autores/fechas de sesión.
  La identidad es inmutable. El peso se corrige en el mismo saco mediante RPC;
  `version integer` comienza en 1 y el trigger la incrementa al editar o anular.
  La anulación lógica conserva el peso, autor original y último editor.
- `movimientos_insumos_unidades_historial` conserva saco, peso anterior/nuevo,
  versión anterior/nueva, autor y fecha de cada corrección. Un trigger AFTER UPDATE
  lo inserta en la misma transacción; rollback revierte peso e historial juntos.
  Tiene RLS heredada del saco, SELECT para authenticated y ninguna escritura directa.
  Su trigger rechaza UPDATE/DELETE; las FK usan RESTRICT. No es otra autoridad del
  peso actual ni participa en COUNT/SUM: conserva evidencia de valores anteriores.
- `movimientos_insumos_resumen` es una vista read-only, `security_invoker = true`:
  obtiene COUNT/SUM de sacos activos para Leña y la cantidad de cabecera para Carbón.
  Devuelve también el detalle activo en JSON. No hay contador ni peso acumulado
  persistido de Leña que pueda divergir; una sola consulta lee cabecera y detalles.
- `insumo` es texto validado, sin enum ni columnas por material: permite incorporar
  otros insumos sin modificar el esquema. Ampliar unidades requerirá sustituir
  la constraint versionada y definir cómo se agrupan antes de sumarlas.
- Esta etapa sólo permite `origen = aseo`, `aseo_id` presente y `solicitud_id` nulo.
  Carbón en cero conserva su fila; Leña sin sacos activos conserva la cabecera con
  cantidad NULL y se proyecta como 0 sacos / 0 kg. Ninguno suma consumo en ese estado.
- Índices para fecha/origen y para las FK. Sin borrado en cascada.
- SELECT por RLS replica `aseos.ver_todos/ver_asignados`, con usuario activo y
  asignación cuando aplica. `authenticated` no tiene INSERT/UPDATE/DELETE ni
  policies de escritura: sólo las RPC canónicas escriben. La tabla hija hereda
  visibilidad de la cabecera por RLS; la vista no evita las policies del usuario.
  Sin acceso anónimo. El resumen respeta esos permisos: un usuario
  limitado a aseos asignados sólo suma los movimientos que está autorizado a ver.
- RPC `haiku_reponer_insumo_aseo_v1` (sólo Carbón), `haiku_agregar_saco_lena_v1`,
  `haiku_anular_saco_lena_v1` y `haiku_editar_peso_saco_lena_v1`: `SECURITY DEFINER`, necesario para retirar
  las escrituras directas. EXECUTE revocado a PUBLIC/anon y concedido únicamente
  a authenticated como rol de aplicación. `search_path = pg_catalog, pg_temp`,
  objetos de aplicación calificados por esquema y sin SQL dinámico.
  Comparten un helper privado SECURITY INVOKER sin EXECUTE para authenticated.
  Comprueba auth.uid(), usuario activo y tanto visibilidad como gestión
  (`aseos.gestionar_todos/gestionar_asignados`) sobre la asignación real del aseo;
  NULL nunca autoriza. Bloquea el aseo FOR SHARE para estabilizar esa asignación.
  Crear un aseo ausente requiere visibilidad y gestión globales. No se conceden
  nuevos permisos funcionales al usuario. Los administradores de base de datos
  conservan sus privilegios de mantenimiento; los CHECK también se aplican a sus escrituras.
  Crea el aseo pendiente sólo ante una reposición explícita si aún no existe;
  nunca actualiza un aseo existente ni sus estados, personas u horarios.
- El movimiento se bloquea al escribir. Carbón compara la cantidad esperada:
  un dispositivo obsoleto recibe conflicto, sin sobrescribir la cantidad remota.
  Leña identifica cada alta con UUID: repetir el mismo UUID/peso no duplica un saco;
  reutilizarlo con otro peso o cabecera falla. Dos UUID distintos agregan dos sacos,
  aunque se registren a la vez. Repetir una anulación no cambia nada ni revive sacos.
  La edición recibe UUID, peso nuevo y versión esperada. Comprueba permisos sobre
  el aseo real, bloquea cabecera/saco y rechaza una versión obsoleta con SQLSTATE
  40001, incluso si otro editor cambió el peso y luego lo volvió a su valor original.
  Sólo admite sacos activos; guardar el mismo peso con versión vigente no crea
  una corrección artificial. Un retry del alta original se verifica contra el peso
  inicial del historial si ese saco ya fue corregido, conservando su idempotencia.
- El trigger fija autor/fechas desde la sesión y preserva la identidad al actualizar.
  Reserva: consulta estadías reales de esa cabaña que intersecten el día, incluyendo
  llegada y salida, excluyendo canceladas/no-show. Sólo enlaza si hay una única reserva
  y el usuario tiene permiso para verlas todas. Recambios ambiguos quedan en `null`.

Durante la implementación inicial se inspeccionaron columnas, restricciones y políticas de `aseos`,
`revisiones_cabana`, `cabanas`, `reservas`, `reserva_estadias` y `solicitudes`
mediante consultas remotas de **metadatos de sólo lectura**. No se leyeron datos
de huéspedes para estas pruebas ni se ejecutaron escrituras o pruebas en producción.
Las correcciones de la auditoría y su validación se realizaron exclusivamente
con archivos locales y transporte/base de datos efímeros, sin consultar producción.

Referencias: [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security)
y [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).
Para las correcciones: [funciones SECURITY DEFINER seguras](https://www.postgresql.org/docs/17/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)
y [numeric sin escala fija](https://www.postgresql.org/docs/17/datatype-numeric.html).

## Hidratación, escritura y realtime

`js/supabase-insumos-aseo-v1.js` es la autoridad del dato nuevo. Mantiene fotografías
en memoria por fecha; no lee ni escribe cantidades en localStorage o caché legacy.
Lectura vacía confirmada significa cero. Una lectura fallida significa no verificado,
muestra un aviso y deshabilita edición; no inventa ceros.

Carbón muestra una cantidad provisional mientras guarda; Leña muestra sólo los
sacos/pesos confirmados. Mientras una escritura
está pendiente se bloquean ambos botones de ese insumo, y llamadas repetidas comparten
la misma promesa. La fila y el resumen suman sólo registros confirmados por Supabase.
Ante error se retira la cantidad provisional y se relee la fuente real. Esto también
reconcilia una respuesta perdida después de que el servidor haya guardado. No hay
reintento automático de escritura ni cola offline.

Un alta de Leña conserva UUID y peso hasta confirmar su resultado. Si falla la RPC,
el cliente muestra “Verificando registro…” y consulta el UUID en la tabla hija,
incluidos los sacos anulados. Comprueba cabecera (fecha/cabaña/aseo/insumo/origen)
y peso original, y relee el resumen. Si existe, termina como éxito sin otra escritura;
si no aparece, “Reintentar saco” reutiliza el mismo UUID. Si la lectura falla,
“Verificar registro” permite repetir sólo la verificación. No se descarta un intento
incierto ni se cambia su peso. La ausencia por RLS tampoco habilita un UUID distinto.
La identidad del intento se conserva en **localStorage antes de enviar la RPC**,
incluidos cierres de pestaña/navegador. Cada entrada tiene una clave independiente:
`haikuSacosPendientesV2:usuario:fecha:cabana_id:aseo_id-o-sin-aseo:lena:UUID`.
Guarda sólo UUID, usuario, fecha, número/ID de cabaña, aseo y movimiento esperados
(si ya se conocen), insumo, peso original y `creadoEn` ISO. No guarda tokens,
secretos, contadores ni totales. Las entradas de otras fechas/usuarios/pestañas
no se sobrescriben al limpiar una operación confirmada.

Al arrancar, hidratar o volver a Cabañas se recuperan los pendientes del usuario
y se reconcilian por UUID, **sólo mediante lecturas**, incluidas fechas no visibles.
Un registro coincidente limpia su entrada; uno ausente habilita retry con el mismo
UUID; un peso/movimiento/aseo incompatible conserva la identidad y muestra conflicto.
Si falla el almacenamiento durable, no se envía el alta; si falla su limpieza tras
confirmar, se conserva el intento en memoria y se exige volver a verificar antes
de iniciar otro. Un intento V1 que todavía esté en sessionStorage se traslada
a localStorage antes de eliminar la copia anterior.

**Antigüedad:** a partir de siete días se informa que el intento es antiguo al
confirmar su ausencia. La edad nunca borra la identidad ni habilita un UUID nuevo.
Se consulta también al siguiente arranque/retorno: si ya existe, se limpia;
si sigue ausente, se puede completar con el UUID original. Conflictos y fallos
de lectura permanecen pendientes para no confundir ausencia con falta de permisos
o conectividad. No hay descarte automático ni nueva acción de descarte manual.
No se agrega polling ni envío offline. El borrado manual de los datos del sitio
o un perfil privado que los elimine al cerrar queda fuera de esta conservación.

La hidratación espera escrituras pendientes y descarta lecturas anteriores a un cambio
local. Los eventos remotos que llegan al terminar una lectura provocan otra lectura;
no se pierden durante la finalización de la promesa. El evento invalida su propia
fecha (`new/old.fecha_operativa`): si está visible, se relee inmediatamente; si no,
la siguiente hidratación al volver ignora la fotografía cargada y consulta Supabase.
Un payload sin fecha invalida todas las fechas conocidas y refresca la visible.
Una lectura anterior al evento no puede borrar esa invalidación.
Cambiar de fecha no mezcla datos.
Cerrar/cambiar sesión invalida respuestas pendientes y limpia las fotografías.

`supabase-aseo-realtime-v1.js` suscribe ambas tablas al **canal existente de Aseo**.
Un evento de saco resuelve la fecha por su movimiento conocido; si no se puede
resolver, invalida las fechas cargadas y relee la visible. No agrega un canal.
Un evento de insumos sólo rehidrata insumos. La recuperación del canal también los
recarga, en paralelo con el inicio del refresco ya existente. No se agrega polling,
canal, listener de click ni intervalo propio. Los guards soportan cliente tardío,
eventos de inicio repetidos y reconexiones concurrentes.

La hidratación de INSUMOS es read-only. Existe fuera de este módulo una conducta
legacy preexistente en `supabase-aseo-operacion-v1.js`: su hidratación general
puede crear un aseo remoto a partir del caché local cuando falta en Supabase.
No se modificó esa ruta. La recuperación general del canal sigue pudiendo invocarla;
un evento de `movimientos_insumos` sólo rehidrata insumos.

## Interfaz

- Bloque secundario “Reposición” dentro de “Aseo y coordinación”. Leña tiene
  “Agregar saco”, peso individual, listado de sacos y acciones “Corregir” / “Anular”.
  Corregir abre un campo compacto con Guardar/Cancelar; conserva la versión del
  momento de abrirlo aunque llegue realtime. Un conflicto relee el peso vigente
  y exige revisar/guardar otra vez. Carbón
  conserva exclusivamente el contador `− / +`, sin campo de peso.
- Leña se muestra como `2 sacos · 36.3 kg`; Carbón como `2 sacos` en el resumen.
- Indicación compacta al lado del trabajo de la cabaña; vacía si ambos consumos son cero.
- “Insumos del día” suma sólo `origen = aseo` para la fecha operativa seleccionada.
- Se conserva la grilla de nueve columnas y la altura desktop de 73 px.
- Los checks Leña/Carbón mantienen su significado: revisión, sin cantidad consumida.
- Reposición no es requisito para OUT y no cambia Aseo, Revisión, Final ni Aseo Express.

## Prueba visual segura en localhost

Desde la raíz del repositorio:

```powershell
node tests/insumos-aseo-localhost.cjs
```

Abrir `http://127.0.0.1:4173/panel.html`. Es una demo del panel con transporte simulado,
identificado por una franja inferior. No carga el cliente real y su CSP bloquea
conexiones externas. No requiere claves, sesión real ni migraciones.

1. Abrir Cabaña 1 → Aseo y coordinación → Reposición.
2. Agregar sacos de Leña de 18.4 y 17.9 kg, y Carbón 1; comprobar `2 sacos · 36.3 kg`.
3. Anular los sacos y reducir Carbón a cero; comprobar que desaparece la indicación de la fila.
4. Probar otra cabaña: sus cantidades son independientes.
5. Recargar: la demo recupera sus datos simulados (almacenamiento local exclusivo
   del simulador; la implementación productiva no utiliza ese almacenamiento).
6. Revisar desktop y móvil. Cerrar el servidor con Ctrl+C.

Para reiniciar sólo los datos de esta demo, en la consola del navegador:
`localStorage.removeItem('haikuInsumosDemo'); localStorage.removeItem('haikuSacosLenaDemo'); location.reload();`.

Una prueba contra Supabase real requeriría revisar y aplicar la migración en un
entorno de desarrollo separado, usuarios de prueba con los permisos de Aseo y
publicación realtime habilitada. **No se hizo ni hace falta para esta entrega.**

## Pruebas automatizadas

Dependencias locales: Node; PGlite 0.3.14 (PostgreSQL efímero) y Playwright/Edge para navegador.
Si PGlite está instalado fuera del proyecto, definir `HAKU_PGLITE_MODULE` con su ruta.
En este entorno se instaló exclusivamente en `%TEMP%/haiku-insumos-runtime/node_modules/@electric-sql/pglite`.
Playwright se resuelve con `NODE_PATH` o mediante la instalación local de desarrollo.
Para validar sacos se instaló Playwright 1.63.0 sólo en `%TEMP%/haiku-playwright-runtime/node_modules`;
se usa Edge existente, sin descargar navegadores ni modificar dependencias del repositorio.

```powershell
$env:HAKU_PGLITE_MODULE = "$env:TEMP\haiku-insumos-runtime\node_modules\@electric-sql\pglite"
node --test --test-isolation=none tests/aseo-operacion-autoridad.test.cjs tests/aseos-estado-no-requiere-migration.test.cjs tests/checklist-optimista.test.cjs tests/cabanas-sites.test.cjs tests/revision-completa-estados.test.cjs tests/revision-checklist-realtime.test.cjs tests/resumen-refresh-atomico.test.cjs tests/resumen-refresh-navegacion.test.cjs tests/resumen-refresh-perfil.test.cjs tests/insumos-aseo.test.cjs tests/insumos-aseo-postgres.test.cjs
node tests/insumos-aseo-panel-browser-check.cjs
node tests/insumos-aseo-durable-browser-check.cjs
node tests/aseo-derivado-panel-browser-check.cjs
node tests/cabanas-contexto-panel-browser-check.cjs
git diff --check
```

Cobertura nueva: cero, incremento/decremento, mínimo, identidad canónica, separación
de insumo/cabaña/fecha, sumas, recarga, dos clientes, carreras de lectura, errores y
respuesta perdida, cliente tardío, reinicialización, reconexión, cambio de sesión,
estados conservados, RLS, permisos, FK, atribución de reserva y SQL inválido.
La prueba de navegador usa el panel real servido por la demo y comprueba alturas,
columnas y desbordamiento entre 390 y 1600 px. Puede guardar capturas definiendo
`HAIKU_INSUMOS_SCREENSHOTS`.

Resultado anterior a las correcciones de auditoría (2026-09-26): **135 pruebas aprobadas, 0 fallos y 0 omitidas**;
los tres scripts de navegador anteriores finalizaron correctamente, al igual que
la comprobación de sintaxis de los tres JS modificados/nuevos y `git diff --check`.
Se inspeccionaron además capturas de Operación y ficha en desktop y móvil.

Validación anterior de la auditoría, antes de sacos con peso (2026-09-26): **144 pruebas aprobadas,
0 fallos y 0 omitidas** con el comando de suites anterior. Incluye rechazo SQL
de fracciones/unidades ajenas, INSERT/UPDATE/DELETE directos denegados, RPC
autorizada y no autorizada, permisos nulos, cantidades esperadas 1→2/1→3,
dos clientes simultáneos y A=1 → B → evento A=3 → volver a A=3 sin escrituras.
También pasaron la comprobación de sintaxis y `git diff --check`.
En esa corrección anterior no se modificó la UI ni se repitieron las pruebas de navegador.

Validación del modelo de peso sólo para Leña: **155 pruebas aprobadas, sin fallos
ni omitidas**. Incluye decimal obligatorio y positivo, rechazo de hijos de Carbón,
COUNT/SUM sin contador paralelo, 7 sacos / 126.8 kg y Carbón 4, anulación con
auditoría, UUID idempotente, dos altas simultáneas, respuesta perdida, RLS de
detalle/vista, permisos y realtime entre fechas de ambos tipos de insumo.
La prueba `insumos-aseo-panel-browser-check.cjs` también pasó con Edge headless:
alta 18.4 + 17.9 kg, error sin incremento, evento remoto de saco, anulación,
persistencia tras recarga y Carbón con contador sin peso. Se inspeccionaron
capturas desktop/móvil; nueve columnas, filas desktop de 73 px y sin
desbordamiento entre 390 y 1600 px. Sintaxis y `git diff --check` aprobados.

Corrección posterior de idempotencia y edición de peso: **170 pruebas aprobadas,
0 fallos y 0 omitidas** con las suites indicadas. Pasaron también el script de
panel en Edge headless, las comprobaciones de sintaxis y `git diff --check`.
Se inspeccionaron capturas de la edición compacta en desktop y móvil; se conservan
las nueve columnas, filas desktop de 73 px y ausencia de desbordamiento.
Las suites verifican
respuesta perdida con/sin commit, reintento con el mismo UUID, segundo saco legítimo
del mismo peso, recarga durante resultado incierto, UUID ya editado, COUNT/SUM,
versiones obsoletas (incluido cambio y vuelta al peso original), historial atómico,
autor distinto, RLS/permisos, UPDATE directo denegado y anulación posterior.
También verifican UUID incompatible y edición realtime de una fecha no visible.
El navegador comprueba además Enter/click repetidos, “Verificando registro…”,
reintento seguro, edición compacta, conflicto remoto y conservación del layout.

Persistencia durable posterior: **181 pruebas aprobadas, sin fallos ni omitidas**.
Incluye commit/respuesta perdida/reload, cierre/reapertura con sessionStorage vacío,
retry sin commit con el mismo UUID, limpieza tras confirmar, siguiente saco legítimo,
intentos antiguos existentes/ausentes, aislamiento usuario/fecha/cabaña/aseo,
almacenamiento bloqueado y recuperación de pendientes V1.
`insumos-aseo-durable-browser-check.cjs` pasó con Edge headless y un perfil temporal:
cerró/reabrió pestaña y navegador realmente, recuperó localStorage, reconcilió sin
otra escritura y mantuvo un saco por UUID. Sólo usa el servidor local con Supabase
simulado y bloquea solicitudes externas; elimina exclusivamente su perfil temporal.
SQL, RPCs, edición/historial de peso, Carbón y UI general permanecen sin cambios
en esta corrección de persistencia durable.

## Límites y segunda etapa

- La migración está pendiente de revisión/aplicación. Hasta entonces el nuevo bloque
  mostrará un error de lectura controlado; los demás flujos siguen funcionando.
- PGlite valida SQL y RLS sobre un esquema mínimo basado en metadatos; el transporte
  realtime se simula. Los dos clientes JS se prueban con solicitudes simultáneas;
  PGlite comprueba las cantidades esperadas obsoletas secuencialmente. No es una
  validación de dos sesiones PostgreSQL concurrentes, del despliegue completo ni
  de WebSockets reales. Ninguna prueba SQL usa una conexión remota: la base es efímera.
- Leña se registra por saco y kg reales. Carbón mantiene su unidad de conteo
  operativa, presentada como saco, sin conversión a kg. No se infiere peso de Carbón.
- En conflicto entre dispositivos se requiere revisar el valor actualizado y volver a
  pulsar si corresponde. No se acumulan automáticamente clicks hechos sobre datos obsoletos.
- No se modificaron `supabase-aseo-operacion-v1.js`, los writers de revisión ni Aseo Express.
  La interacción compartida se limita a la suscripción/recuperación del canal existente.
- Etapa 2: definir entrega efectiva desde Solicita, identidad e idempotencia por solicitud,
  ampliar el CHECK/policies de origen, vincular `solicitud_id` y separar/desglosar totales.
  Stock, bodega, costos, mínimos y reportes mensuales quedan fuera de ambas modificaciones actuales.
- La migración sigue sin aplicarse: se amplió el archivo pendiente. No se convierten
  contadores anteriores de Leña en sacos con pesos inventados ni se ejecuta backfill.

## Archivos

Producción: `index.html`, `panel.html`, `css/sites-cabanas-v1.css`,
`js/sites-cabanas-v1.js`, `js/supabase-aseo-realtime-v1.js`,
`js/supabase-insumos-aseo-v1.js` y la migración nueva.

Pruebas: ajuste del arnés `tests/cabanas-sites.test.cjs`; nuevas suites
`tests/insumos-aseo.test.cjs`, `tests/insumos-aseo-postgres.test.cjs`,
`tests/insumos-aseo-panel-browser-check.cjs`; demo `tests/insumos-aseo-localhost.cjs`;
fixtures `tests/fixtures/insumos-schema.sql` y `tests/fixtures/insumos-supabase-mock.cjs`;
esta guía.
