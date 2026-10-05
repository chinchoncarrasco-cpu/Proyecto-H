# Completar ocupación V1: sólo reservas nuevas del Libro

Implementación local en `feat/libro-revision-manual-resoluble`. Sin commit, push, PR, merge ni SQL remoto.

## Alcance

Una reserva nueva del Libro con ocupación insuficiente → completar adultos/niños/mascotas → persistir resolución → preparar y crear reserva, estadías y cargos iniciales normales.

Agregar/asociar estadías a reservas existentes y modificar estadías existentes quedan fuera del resolver V1. La tarjeta indica **Requiere revisión manual** si la comparación encuentra una estadía/candidato existente, incluyendo hermanas del grupo. Una resolución previa tampoco habilita esas acciones en preparación/backend. Las acciones ordinarias de main conservan su contrato; no se agrega aprobación de destinos.

## Persistencia y frontera de confianza

Única tabla nueva: `private.haiku_libro_resoluciones`. Guarda UUID, revisión, usuario de `auth.uid()`, fecha del servidor, campo, ocupación original/confirmada, identidad y revisión anterior. Editar inserta otra fila; no sobrescribe historia. RLS habilitado, sin políticas y sin privilegios directos para PUBLIC/anon/authenticated; secuencia también revocada.

La identidad persistente contiene SHA-256, elemento, coordenadas y evidencia completa. **SHA, coordenadas y evidencia son una declaración autenticada del cliente. El servidor no recibe el XLSX y no proporciona verificación criptográfica independiente del archivo.** Es aceptable para V1: el operador ya posee `reservas.crear`; la resolución agrega trazabilidad al flujo de Haku.

La generación existe únicamente en el lector y guards runtime: no es columna, argumento RPC ni parte de la identidad persistente. Mismo SHA/elemento/origen/evidencia tras recarga recupera la decisión propia sin reconfirmar. Otro SHA/evidencia/origen no la recupera.

RPC: `public.haiku_libro_confirmar_resolucion_v1(uuid,jsonb,text,jsonb,uuid)` y `public.haiku_libro_leer_resoluciones_v1(jsonb)`. Ambos exigen UID y `reservas.crear`, son DEFINER con `search_path = ''` y sólo conceden ejecución cliente a authenticated. Los tres validadores privados son INVOKER y no ejecutables por clientes. [Documentación de funciones de Supabase](https://supabase.com/docs/guides/database/functions).

## Flujo

1. El parser conserva la ocupación desconocida. Cancelar el editor no escribe.
2. Confirmar guarda una resolución propia; `aplicar()`/`efectivos()` producen copias con `structuredClone`, completan sólo ocupación y agregan la referencia.
3. Preparar relee la última resolución y ejecuta comparación/validaciones normales. Otros conflictos siguen bloqueados.
4. Confirmar llama directamente a `haiku_incorporar_libro_v1`. Sólo la ruta manual de `reserva_nueva` envía `resolucion_manual`, `libro_origen` y `ocupacion_manual`.
5. Backend comprueba usuario, última revisión, SHA/elemento/origen/evidencia exactos, valores efectivos, titular, CAB, fechas y tipo. Una referencia de A no crea B.
6. Reintentos completados devuelven el resultado idempotente, incluso si luego se editó la resolución; solicitudes pendientes validan la revisión actual.

Alojamiento: adultos enteros 1..32767, niños/mascotas 0..32767. Full Day usa reglas canónicas existentes: mínimo 2 ADL y CLP 60000 por adulto; 2 ADL + 1 niño = CLP 120000. El parser, advertencias y buffer XLSX permanecen intactos; descargar usa bytes originales. Cada hermana multicabaña requiere resolución propia.

## Compatibilidad y conflictos

Incorporaciones ordinarias no necesitan `libro_origen` ni otros campos nuevos. Clientes antiguos siguen enviando reservas/estadías válidas con el contrato de main. Omitir referencias no acredita el archivo: conserva la autoridad ordinaria del operador.

El importador normaliza `tipo` una vez por elemento con `lower(btrim(...))`, antes del hash. Validadores y todas las fases, incluidas actualizaciones, reciben el mismo valor canónico. ` ESTADIA ` no evita el bloqueo manual.

- `HLC01`: resolución ajena/reemplazada/obsoleta, referencia/origen ausente o elemento/valores distintos.
- `HLC02`: resolución manual fuera de `reserva_nueva`.

Esos códigos descartan la solicitud pendiente y exigen comparar/preparar de nuevo. Errores de transporte conservan UUID/payload para retry. La generación invalida operaciones asíncronas y editores antiguos aunque el SHA permanezca igual.

## Finanzas y migración

`20261005051906_libro_resoluciones_ocupacion.sql` sólo inserta en la tabla privada. No escribe pagos/pago_aplicaciones ni altera cargos existentes; no cambia `private.haiku_libro_actualizar_v1` ni sus rutas financieras de main.

Parche guardado de `public.haiku_incorporar_libro_v1(uuid,jsonb)`: tipos antes del hash; validación manual después del retorno idempotente y antes de crear. Conserva owner, ACL, definer y search_path. BEGIN/COMMIT; aborta con anclas inesperadas.

## Pruebas locales

SQL en PGlite en memoria, cuerpos del repositorio y fixtures simplificados de esquema/Auth/creador general. No representa una instancia Supabase real ni prueba dos sesiones concurrentes. Browser con backend simulado y recursos externos bloqueados; captura en el directorio temporal.

PGlite 0.3.14 y Playwright 1.63.0 disponibles fuera del repositorio; no se añaden dependencias. Comandos:

```powershell
$env:HAKU_PGLITE_MODULE = Join-Path $env:TEMP 'haku-libro-resoluciones-tools\pglite\package'
node --test tests/libro-resoluciones-ocupacion.test.cjs tests/libro-resoluciones-postgres.test.cjs
$hakuTests = @(rg --files tests -g '*.test.cjs' | Where-Object { $_ -match 'libro|fullday|pago|comparacion' })
node --test @hakuTests
node tests/libro-resoluciones-browser-check.cjs
node tests/sites-libro-incorporacion-browser-check.cjs
git diff --check
git status --short
```

Ninguna prueba configura ni utiliza Supabase remoto.
