# BOVE ETAPA 3 — requisito de atomicidad pendiente de despliegue

Estado: migración preparada, NO aplicada a Proyecto H. Haku puede preparar y
revalidar una propuesta mediante SELECT y lectura del Libro. Confirmar permanece
bloqueado: el módulo no contiene ninguna llamada RPC ni writer. La primera prueba
real puede llegar a la segunda revalidación, sin guardar.

SQL completo: `supabase/migrations/20260910180000_bove_registro_atomico.sql`.
Reemplaza únicamente `haiku_registrar_bove_reserva(uuid,text)` y
`haiku_registrar_bove_checkout(uuid,text)`.

## Mecanismo

Después de las validaciones originales de sesión, `pagos.verificar`, número,
reserva y pago completo, se ejecuta `SELECT ... FOR UPDATE` sobre la reserva.
El bloqueo permanece hasta terminar la transacción. Otro intento sobre la misma
fila espera y examina el valor confirmado por el primero. Con aislamiento más
estricto PostgreSQL puede rechazar por serialización; nunca autoriza reemplazo.

- NULL, cadena vacía o espacios: UPDATE original con su auditoría habitual.
- Mismo número (comparación de texto recortado): retorna estado original y
  `ya_registrado: true`, sin UPDATE ni trigger de auditoría.
- Otro número: excepción; BOVE y auditoría originales intactos.

Se conserva el formato de retorno: alojamiento usa `bove`, checkout usa
`bove_checkout`, ambos mantienen reserva_id, registrado_por/en y total.
El retorno idempotente conserva autor y fecha originales, incluso si son NULL.
No se interpretan series ni se cambian las validaciones financieras. Un reintento
idéntico también debe superar los permisos y condiciones financieras originales.

Definiciones originales verificadas en Proyecto H: alojamiento SECURITY INVOKER,
checkout SECURITY DEFINER; ambos search_path public/private/pg_temp, propietario
postgres, EXECUTE postgres/authenticated. CREATE OR REPLACE conserva ACL y dueño;
no se incluyen GRANT/REVOKE. Los botones manuales conservan sus RPC y eventos.
No hay excepción para reemplazar números desde los botones.

## Dependencia obligatoria de ETAPA 3

El guardado desde Haku sigue pendiente; este cambio no añade un writer
activo ni modifica los botones manuales. No basta revisar el resultado de la RPC después
de escribir para detectar una versión antigua: para entonces sería demasiado
tarde. Antes de habilitar Confirmar BOVE debe autorizarse el despliegue, aplicarse
esta migración y verificarse su definición/protección. Después se expondrá el
mismo núcleo de los botones para Haku, manteniendo propuesta, permisos y segunda
revalidación. No debe añadirse un flag force, bypass ni RPC de corrección.
Las regresiones de preparación, routing y revalidación Haku están en
`bove-escritura-preparacion.test.cjs` y `bove-routing.test.cjs`. El guardado Haku,
éxito/error de RPC y refresco tras guardado no se presentan como implementados:
son parte de la futura habilitación por el mismo núcleo de los botones manuales.

## Preparación Haku disponible, con guardado bloqueado

`js/supabase-asistente-bove-escritura-v1.js` se registra antes de los handlers de
lectura. Reclama sólo intenciones explícitas BOVE, normaliza números con punto o
coma y resuelve CAB/titular exacto. Sin fecha usa la operación de hoy (incluye
salida y Full Day), sin recorrer arbitrariamente el historial. Varias candidatas ofrecen selección y dos
alcances posibles ofrecen alojamiento/servicios. Cada selección vuelve a leer.

Comprueba `pagos.verificar`, BOVE actual y vistas financieras existentes con
SELECT. El alojamiento y servicios mantienen campos separados. El Libro se
consulta con `HAIKU_ASISTENTE_BOVE_CONSULTAS_V1.consultar`, `desdeLibro` y
`comparar`, más `consultarHoja` de los meses de los segmentos (caché existente).
Un número distinto con vínculo fuerte bloquea; un titular resuelto sólo por
contexto sigue siendo evidencia no concluyente. Errores del lector bloquean la
preparación; Libro ausente o cobertura parcial se declaran explícitamente.

La tarjeta ofrece «Revalidar propuesta»: repite lecturas por el mismo ID,
permiso, estado, finanzas y Libro. No admite una propuesta fabricada. El botón
«Confirmar BOVE · bloqueado» está deshabilitado y `confirmar()` también rechaza
incondicionalmente. No hay flag en localStorage, DOM o API para habilitarlo.
No se emite `haiku:bove-actualizado`, porque no existe guardado.

La comprobación manual de preparación se hace con una CAB operativa de hoy o
una fecha explícita y un número BOVE explícito. No requiere borrar ni recargar el XLSX. No confundir este
flujo con los botones manuales existentes, cuyo comportamiento no se ha cambiado.

### Resolución histórica con fecha explícita

Ejemplo admitido: «Haku, a CAB 5 Macarena Hurtado 03 septiembre ponle BOVE 19800».
También admite «3 de septiembre», «03-09-2026» y «03/09/26», antes o después
de la acción. El año omitido se toma del día actual en America/Santiago y se
declara en la propuesta junto a la fecha ISO completa. Fechas inválidas o varias
fechas se rechazan. Un número BOVE aislado nunca se interpreta como fecha.

La consulta SELECT queda acotada a esa fecha. CAB y titular, si se indicaron,
deben coincidir con la misma reserva y segmento operativo; no se usa semejanza.
En fechas explícitas el alojamiento incluye check-in y excluye checkout.
Full Day sólo corresponde a su día real de ingreso/salida. Cero candidatas
detiene; varias muestran opciones. Las selecciones y segunda revalidación
conservan la fecha explícita.

La entrada estructurada `preparar({numero, tipo, fecha}, {reservaId})` permite
una futura tarjeta de pendientes ETAPA 2B. Sigue releyendo y comprobando ese ID
contra la fecha y los demás criterios suministrados; no permite saltarlos.
No se modifica todavía la tarjeta ETAPA 2B. Regresiones permanentes:
`tests/bove-escritura-historica.test.cjs`, sólo datos simulados.

## Pruebas

Suite JS: `node --test tests/*.test.cjs`.

PostgreSQL efímero PGlite (sin red): configurar HAKU_PGLITE_MODULE a la instalación
local de @electric-sql/pglite y ejecutar `node tests/bove-rpc-postgres.cjs`.
Comprueba SQL real, vacío/mismo/distinto, auditoría, permisos, validaciones,
reserva inexistente y conservación de ACL/security/search_path/owner.

Concurrencia auténtica: `node tests/bove-rpc-concurrencia.cjs` usa dos procesos
psql y observa wait_event_type=Lock de la segunda conexión. Requiere un clúster
PostgreSQL local de pruebas, base nueva vacía con nombre haku_bove_test_..., y
variables HAKU_BOVE_TEST_DATABASE, HAKU_BOVE_TEST_PSQL (ruta a psql), opcionales
HAKU_BOVE_TEST_HOST/PORT/USER/PASSWORD. No acepta host remoto ni lee DATABASE_URL
o credenciales Supabase. Las fixtures crean roles authenticated/anon, por lo que
se requiere un clúster desechable sin esos roles. No elimina bases ni datos.
Ejecuta cuatro escenarios: mismo/distinto para alojamiento/servicios; sólo una
auditoría debe existir y el autor del primer guardado debe conservarse.

No confundir la ejecución serial en PGlite con esa prueba de dos conexiones.

## Revisión final local, 10-09-2026

- Lock y UPDATE usan `public.reservas WHERE id = p_reserva_id` en ambas RPC.
- El BOVE se examina desde `v_actual` obtenido por SELECT FOR UPDATE, tras
  adquirir el bloqueo. Conflicto eleva excepción sin handler que permita seguir.
- Idempotencia retorna antes del único UPDATE, con auditoría original.
- Entrada conserva exactamente btrim/coalesce/nullif originales; el valor
  existente NULL/vacío/espacios se trata como vacío. No normaliza series SQL.
- Prueba de contrato compara las funciones con los originales quitando sólo
  el guard nuevo: validaciones financieras/permisos y UPDATE intactos.
- Conserva INVOKER de alojamiento y DEFINER de checkout; search_path, owner y
  grants se comprueban también ejecutando SQL en PostgreSQL efímero.
- Botones manuales no necesitan cambios para obtener el lock tras el despliegue.
- No se encontraron psql/postgres/pg_ctl/docker/supabase en PATH, servicios
  PostgreSQL/Docker ni instalaciones estándar en Program Files. PGlite ya
  disponible sólo permite los checks seriales. La prueba real de dos conexiones
  queda PENDIENTE. No se instaló software ni se aplicó SQL remoto.
