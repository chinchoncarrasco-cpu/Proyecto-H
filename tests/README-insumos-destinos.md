# Destinos de reposición de insumos

Base: `main` en `6b0af1e`, coincidente con la referencia local `origin/main` al iniciar.
Rama: `feat/destino-reposicion-insumos-aseo`. El árbol versionado estaba limpio;
`.cd` y `supabase/.temp/` ya existían sin seguimiento y se conservaron.

## Comportamiento

- Leña: cada alta exige `aseo_full`, `aseo_express` o `venta_huesped`.
  El selector comienza sin selección al cambiar de cabaña/fecha; conserva la elección
  después de guardar para facilitar sacos consecutivos. Peso y destino son visibles
  en cada saco. Corregir cambia sólo el peso, con la versión y auditoría existentes;
  anular conserva el registro y su destino. El destino es inmutable: una clasificación
  equivocada se resuelve anulando el saco y registrándolo correctamente.
- Carbón: una fila canónica por cabaña/fecha/aseo. El total `cantidad` permanece como
  autoridad y se actualiza junto al contador del destino elegido, bajo el mismo bloqueo.
  Los tres contadores son enteros no negativos; su suma nunca supera el total.
  Cada fila de la UI tiene su propio `− / +`, y reducir un destino vacío está bloqueado.
- Históricos: los sacos previos conservan `destino = NULL`, presentado como
  **Sin especificar**. Para Carbón, la parte histórica es el total menos los tres
  contadores clasificados. Sólo aparece si es positiva y permite reducirla, nunca
  agregar consumo sin destino. No se reclasifican ni eliminan datos existentes.
- Resumen: totales de sacos/kg siguen siendo principales. **Ver destinos** abre
  el desglose diario de cantidades; sólo incluye destinos con consumo. La grilla
  de Operación mantiene nueve columnas y filas desktop de 73 px.
- “Venta / compra huésped” clasifica la entrega de insumos. No crea cargos, pagos,
  solicitudes ni un ciclo Express; `origen = aseo` y los permisos actuales se conservan.

## Datos y seguridad

Archivo nuevo: `supabase/migrations/20260927182654_destinos_reposicion_insumos_aseo.sql`,
creado mediante `supabase migration new destinos_reposicion_insumos_aseo` con CLI 2.118.0,
telemetría desactivada. No se ejecutaron `init`, `start`, `reset`, `push` ni SQL contra
una instancia Supabase. La migración base no se modifica.

La migración añade `destino` a `movimientos_insumos_unidades` y tres columnas a la
cabecera de Carbón: `carbon_aseo_full`, `carbon_aseo_express`, `carbon_venta_huesped`.
La vista conserva sus columnas originales y añade `destinos` como JSON de cantidades;
los sacos del JSON incluyen también `destino`. Sigue usando `security_invoker = true`.

Las altas usan `haiku_agregar_saco_lena_v2` y `haiku_reponer_insumo_aseo_v2`, con destino
explícito. Carbón compara tanto el total esperado como el saldo esperado del destino.
Ambas RPC reutilizan el helper privado que verifica usuario activo, visibilidad,
gestión y asignación, y bloquea aseo/cabecera. Conservan `SECURITY DEFINER`,
`search_path = pg_catalog, pg_temp` y EXECUTE sólo para `authenticated` como rol cliente.
No se conceden escrituras directas en tablas, ni se cambian RLS o publicaciones.
Corrección/anulación siguen en sus RPC v1.

Las antiguas RPC de alta/incremento v1 pierden EXECUTE para `authenticated`: una pestaña
antigua no podrá registrar consumo sin destino. La futura entrega debe coordinar
esta migración con el cliente actualizado. El repositorio sigue necesitando su
esquema previo de aplicación para un entorno Supabase completo; este cambio no
resuelve el bootstrap incompleto detectado en el preflight anterior.

No se modifica `js/supabase-aseo-realtime-v1.js`. Las dos tablas ya publicadas emiten
los cambios y el canal existente invalida/relee la vista, incluido su nuevo desglose.

## Reintentos durables

El intento de Leña guarda también destino antes de enviar la RPC. UUID, peso,
cabecera y destino se verifican al reconciliar; otra clasificación con el mismo UUID
es un conflicto. Durante el envío/verificación se bloquea el selector.

Un intento anterior sin destino primero consulta el UUID, incluidos sacos anulados.
Si ya existe, se confirma como histórico sin escribir ni reclasificarlo. Si se verifica
su ausencia, exige elegir destino y conserva UUID/peso para el reintento. Una lectura
fallida nunca habilita una nueva identidad. No se añaden canales ni envíos automáticos.

## Validación local

Las pruebas SQL usan exclusivamente PGlite efímero con `tests/fixtures/insumos-schema.sql`,
la migración base y la nueva extensión. Incluyen actualización con registros anteriores,
conservación de fechas/autores/cantidades, RLS/publication, permisos, restricciones,
destinos, idempotencia, conflictos y corrección/anulación.

Las pruebas de navegador usan Edge headless y el panel real con Supabase simulado.
La demo sirve sólo archivos locales, bloquea conexiones externas y no entrega la
configuración de producción. Su fecha se guarda después de establecer el usuario
de prueba, para no depender de la fecha del equipo.

```powershell
$env:HAKU_PGLITE_MODULE = "$env:TEMP\haiku-insumos-runtime\node_modules\@electric-sql\pglite"
$env:NODE_PATH = "$env:TEMP\haiku-playwright-runtime\node_modules"
node --test --test-isolation=none tests/aseo-operacion-autoridad.test.cjs tests/aseos-estado-no-requiere-migration.test.cjs tests/checklist-optimista.test.cjs tests/cabanas-sites.test.cjs tests/revision-completa-estados.test.cjs tests/revision-checklist-realtime.test.cjs tests/resumen-refresh-atomico.test.cjs tests/resumen-refresh-navegacion.test.cjs tests/resumen-refresh-perfil.test.cjs tests/insumos-aseo.test.cjs tests/insumos-aseo-postgres.test.cjs tests/insumos-realtime-ready.test.cjs
node tests/insumos-aseo-panel-browser-check.cjs
node tests/insumos-aseo-durable-browser-check.cjs
node tests/insumos-destinos-browser-check.cjs
node tests/aseo-derivado-panel-browser-check.cjs
node tests/cabanas-contexto-panel-browser-check.cjs
git diff --check
```

Estas pruebas no certifican un despliegue Supabase completo ni dos sesiones
PostgreSQL reales concurrentes; el transporte Realtime se simula. No se consultó
producción ni se aplicaron migraciones a una base persistente.

Resultado del 2026-09-27: **213 pruebas JS/SQL aprobadas, 0 fallos, 0 omitidas**;
los cinco scripts de navegador anteriores finalizaron correctamente. Se revisaron
capturas de ficha y desglose en 1440 y 390 px; la regresión de la grilla cubre
390–1600 px. Comprobaciones de sintaxis JavaScript y `git diff --check` correctas.
No se hicieron commits ni se prepararon archivos en staging.

## Archivos de esta mejora

- `index.html`
- `css/sites-cabanas-v1.css`
- `js/sites-cabanas-v1.js`
- `js/supabase-insumos-aseo-v1.js`
- `supabase/migrations/20260927182654_destinos_reposicion_insumos_aseo.sql` (nuevo)
- `tests/fixtures/insumos-supabase-mock.cjs`
- `tests/insumos-aseo-localhost.cjs`
- `tests/insumos-aseo.test.cjs`
- `tests/insumos-aseo-postgres.test.cjs`
- `tests/insumos-realtime-ready.test.cjs`
- `tests/insumos-aseo-panel-browser-check.cjs`
- `tests/insumos-aseo-durable-browser-check.cjs`
- `tests/insumos-destinos-browser-check.cjs` (nuevo)
- `tests/aseo-derivado-panel-browser-check.cjs` (preparación de la fecha de prueba)
- `tests/README-insumos-aseo.md`
- `tests/README-insumos-destinos.md` (nuevo)

Referencias de seguridad: [funciones de Supabase](https://supabase.com/docs/guides/database/functions)
y [RLS y vistas](https://supabase.com/docs/guides/database/postgres/row-level-security).
