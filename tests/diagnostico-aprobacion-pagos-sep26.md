# Aprobación manual del comprobante compartido

Base estable: `b6d9b9edbdb6820db3a94a3302f4afd3a4445070`, árbol inicialmente limpio.
Respaldo: `codex/seguro-aprobacion-pagos-20260909`. No se hizo push.

## Causa comprobada

En `crearPlanIncorporacion`, `conflictoIdentificador` trataba dos importes distintos
con Folio/BOVTAR compartidos como incompatibles. Marcaba ambos con «Identificador
repetido con monto o reserva diferente» y `aprobable:false`. El Early Check-In
también recibía «El concepto requiere una aplicación manual», fuera de los motivos
que permiten aprobación. Por eso el render no mostraba «Aprobar este pago».

El problema no terminaba en la interfaz: una consulta de sólo lectura a las
definiciones vigentes de Proyecto H confirmó que `haiku_incorporar_libro_v1`
omitía el segundo pago por identificador y forzaba `p_modo_aplicacion:'alojamiento'`.
La función contable `haiku_registrar_pago` sí admite aplicaciones explícitas a cargos
y el modo `ninguno` para conservar importes sin aplicar.

Se verificó asimismo que no existe un servicio Early Check-In activo para esa
estadía de Macarena el 03/09. No se inventaron hora, cantidad de horas ni un servicio.

## Cambio acotado

Sólo cambió `js/haiku-libro-consultas-v1.js` en el frontend. El lector, encabezado
recuperado, canon, asociación, fechas y scope focalizado no se modificaron.

En preparación se admite una distribución revisable sólo si hay exactamente dos
partes: alojamiento y Early Check-In; una única estadía activa del titular exacto
en el Check-In; misma reserva, CAB física, moneda, fecha y medio; identificadores
fuertes coincidentes; importes positivos; origen distinto para cada parte; y ningún
total declarado contradictorio. Cualquier otro caso conserva las protecciones previas.

Cada parte muestra su propio botón. Una aprobación sólo prepara y selecciona esa
parte. No participa del botón de aprobación masiva. El aviso explica que ambas
deben aprobarse y seleccionarse para confirmar el comprobante completo. Ninguna
aprobación crea una reserva ni cambia CAB/fecha.

Al confirmar ambas se envía **un pago de $193.000**, con las dos partes originales
($153.000 alojamiento y $40.000 Early Check-In), aprobaciones y referencias en
`datos_origen.distribucion_manual`. No se envían dos pagos con el mismo identificador.
Los datos originales también permanecen en las tarjetas y referencias del pago.
Si existe ese identificador, no se habilita como nuevo; si ya se incorporó esta
distribución, sus dos partes se omiten como existentes.

## Migración local necesaria para guardar

`supabase/migrations/20260909215808_haku_libro_aprobacion_distribucion_manual.sql`
fue creada con Supabase CLI y **no se aplicó a Proyecto H**.

Agrega un auxiliar privado, sin permiso de ejecución directa para usuarios,
e inserta una rama específica en la RPC existente. Conserva el resto de su cuerpo,
autenticación, permisos, bloqueos, comprobación global de identificadores y reintentos.
La sustitución comprueba la forma esperada de la función antes de modificarla.

El auxiliar vuelve a validar titular, estadía única, comprobante, importes y ambas
aprobaciones. Registra una sola transacción y limita las aplicaciones a cada parte:

- Hasta $153.000 a cargos activos de alojamiento de esa estadía.
- Hasta $40.000 a un único cargo activo de Early Check-In de esa estadía y fecha.
- Si ese cargo no existe, está pagado o es ambiguo, el importe restante queda sin
  aplicar y conserva su concepto en `aplicaciones_pendientes`. No paga alojamiento
  con el importe del servicio ni crea cargos/servicios con datos inventados.

La confirmación consulta una capacidad de sólo lectura antes de escribir. Si la
migración aún no está instalada, muestra un error explícito y conserva las
aprobaciones; nunca envía este comprobante al comportamiento antiguo.

## Verificación

- Base: 137 pruebas pasando. Resultado: 142 pruebas pasando.
- Cinco pruebas nuevas: botones y aprobación separada en ambos órdenes, protección
  de selección incompleta, transacción única, servicio conservado, duplicados,
  ambigüedad, importes declarados incompatibles, revalidación, backend antiguo y
  pagos del 04 idénticos después de aprobar el 03.
- PostgreSQL aislado con PGlite: ejecutó la RPC de incorporación anterior, la
  definición vigente de `haiku_registrar_pago` y la nueva migración. Validó
  persistencia del pago único, aplicaciones a cargos, servicio ausente, totales,
  identificadores, permisos, helper privado, duplicados, idempotencia, ambigüedad,
  rollback atómico y conservación del camino de pagos ordinarios.
- El esquema contable de la prueba es mínimo; no reemplaza una validación de
  despliegue contra el esquema completo. No se hicieron escrituras remotas.

Desde la carpeta del proyecto:

```powershell
node --test tests/*.test.cjs
$env:HAKU_PGLITE_MODULE="$env:TEMP\haku-pagos-runtime\node_modules\@electric-sql\pglite"
node tests/haiku-libro-distribucion-postgres.cjs
```

PGlite 0.3.14 quedó instalado en temporal para esta prueba. El segundo comando
requiere ese paquete; no conecta con Supabase.

Para la prueba visual local: recargar el panel, cargar el Libro y preparar los pagos
de Macarena del 03. Aprobar primero cualquiera de las partes: sólo ésa pasa a
Pagos preparados. Aprobar la otra: ambas quedan seleccionadas. Desmarcar una
impide confirmar el comprobante incompleto. El 04 conserva su comportamiento.
El guardado de esta distribución requiere aplicar previamente la migración local.
