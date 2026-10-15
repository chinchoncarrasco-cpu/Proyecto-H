# Procedimiento pendiente de autorización

Estos archivos son una candidata local. **No ejecutar DDL/DML en producción**
sin una nueva autorización. No están en `supabase/migrations` ni en el despliegue.
Las dos bibliotecas de `tools/` exportan funciones; no abren conexiones ni realizan
acciones por ejecutar `node archivo.cjs`.

## Respaldo y preflight

1. Revisar el informe y el manifiesto saneado en `diagnosticos/rut-identidad-*`.
   Confirmar rama, HEAD, diff completo y resultados de pruebas.
2. Con una conexión administrativa verificada y exclusivamente de lectura,
   ejecutar `00-preflight-readonly.sql`. Todos los cuerpos y sus metadatos deben
   coincidir con el manifiesto. Revisar también triggers, RLS, permisos, índices y
   nuevas dependencias. No cambiar guards para hacer pasar una diferencia.
3. Verificar privadamente ambos códigos de reserva y los dos UUID completos;
   las etiquetas y prefijos del informe no bastan para ejecutar. Documentar la
   evidencia del operador que demuestra misma persona. El hash de evidencia
   sólo vincula un archivo revisado: no demuestra por sí mismo su autenticidad.
4. Parametrizar los dos códigos en la sesión privada y ejecutar
   `04-manifiesto-par-readonly.sql`. Debe devolver `pair_count=2`. Conservar su
   resultado y contrastar los hashes; cualquier actividad posterior obliga a revisar.
5. Antes de instalar, obtener respaldo recuperable y cifrado de esquema y datos
   con el procedimiento habitual de Supabase/PITR o `pg_dump`, verificar una
   restauración en entorno aislado y registrar el punto de recuperación.
   Guardar `pg_get_functiondef`, owner, ACL, security y search_path de los cinco
   writers para un posible regreso de código. No poner respaldo ni credenciales
   en Git, logs de CI, shell history o este directorio.

## Instalación autorizada, separada de la reparación

Pausar escrituras operativas y acordar una ventana. Usar una conexión directa
dedicada, sin transacción externa. El adaptador del cliente `pg` necesita:

```js
const db = {
  query: (...args) => client.query(...args),
  exec: sql => client.query(sql)
};
// Sólo después de la aprobación específica de instalación:
await require('../../../tools/rut-identidad-instalar.cjs')
  .install(db, {authorized: true});
```

Las rutas de ejemplo parten de este directorio. 01 y 02 se ejecutan en una sola
transacción; un guard fallido revierte ambos. No ejecutar esos dos archivos por
separado ni aplicar 03. No se actualiza ningún huésped histórico al instalar:
se crean metadatos privados y protecciones para las escrituras posteriores.

Verificar las nuevas huellas, ACL y RLS; ambos grupos históricos deben seguir
bloqueados. Repetir la inspección de los casos con consultas, sin probar writers
con datos productivos. Un fallo de instalación no autoriza una reparación.

## Preparación privada de la reparación

La selección se carga desde un archivo privado externo al checkout, nunca desde
nombres o coincidencias parciales. Su forma es:

```js
const selection = {
  canonicalId: config.canonicalId, redundantId: config.redundantId,
  original: {
    id: config.originalId, code: config.originalCode,
    arrival: config.originalArrival, departure: config.originalDeparture,
    cabin: 8, status: 'cancelada', payments: 1
  },
  subsequent: {
    id: config.subsequentId, code: config.subsequentCode,
    arrival: config.subsequentArrival, departure: config.subsequentDeparture,
    cabin: 8, status: 'confirmada', payments: 0
  }
};
const repair = require('../../../tools/rut-identidad-reparacion.cjs');
const manifest = await repair.manifest(db, selection); // READ ONLY
```

Guardar el manifiesto completo fuera del repositorio, cifrado y con ACL del
operador. Contiene el catálogo y todas las filas de las tablas dependientes;
puede contener datos de otras reservas. Verificar escritura y lectura del
respaldo, su `sha256` y la restauración aislada. No usar `console.log(manifest)`.
El archivo JSON saneado del repositorio **no sustituye este respaldo**.

La opción canónica propuesta es la fila de la reserva original. Revisar campos
divergentes de ambos huéspedes y conservarlos en ambas filas; no combinarlos
automáticamente. Revisar la lista completa de referencias y cualquier colisión.
El manifiesto debe generarse después de instalar, porque incluye el catálogo
nuevo. La operación exige exactamente dos huéspedes, dos reservas, una estadía
por reserva, las tres asociaciones coherentes, el pago sólo en la original y
ninguna referencia a una tercera reserva. Una FK desconocida exige ampliar el
plan con revisión; no se omite.

## Ejecución específica autorizada

Mantener pausadas las escrituras entre captura, revisión y ejecución. La aprobación
debe incluir explícitamente la acción, el hash del manifiesto y el de evidencia:

```js
const approval = {
  action: 'apply', samePerson: true, authorized: true,
  manifestHash: manifest.sha256,
  evidenceHash: config.approvedEvidenceSha256,
  operationId: config.approvedOperationUuid
};
const receipt = await repair.apply(db, manifest, approval);
```

Los booleanos son declaraciones de una aprobación externa real; no generarla
automáticamente desde nombres o desde el RUT. Guardar privadamente el recibo
duradero y validar su hash con una nueva fotografía. No registrar parámetros,
contenido del respaldo ni errores SQL crudos. Las bibliotecas devuelven errores
administrativos saneados; una respuesta perdida requiere consultar el estado,
no asumir rollback.
`HLR03` indica que el COMMIT pudo completarse. En reparación incluye un recibo
con hashes para contrastar en una conexión nueva; en instalación/reversión exige
consultar el estado antes de decidir el siguiente paso. No repetir ciegamente.

La herramienta bloquea las tablas dependientes en orden, con `lock_timeout=5s`,
revalida fotografía y catálogo, reasocia las cinco vías aprobadas, registra el
alias y verifica preservación antes de COMMIT. Un timeout, colisión o diferencia
aborta toda la transacción. No altera pagos, cargos, aplicaciones, estados o fechas.
Las notas/solicitudes sólo cambian de FK si pertenecen al huésped redundante.

## Validación posterior

Comprobar dos reservas y dos estadías originales, mismos códigos, fechas, CAB,
estados y montos; 1 pago en la cancelada y 0 en la confirmada; las tres vías de
asociación a la canónica; cero referencias operativas a la redundante; ambas
filas personales intactas; alias activo; segundo grupo intacto y bloqueado.
Contrastar cargos, aplicaciones, servicios, notas, solicitudes e historia. Los
timestamps de actualización y nuevos eventos de auditoría son efectos esperados;
los eventos anteriores nunca se reescriben.

La repetición con el mismo `manifest`, aprobación y `receipt` debe devolver
`retry: true` sin escrituras. Si hubo actividad posterior, detenerse y revisar.
Después, regenerar comparación Haku/Libro y volver a verificar cada pago antes
de incorporarlo. No reenviar el payload financiero anterior. La reserva cancelada
no se reactiva. La publicación del frontend requiere otra autorización.

## Reversión

Antes del COMMIT, cualquier error produce rollback íntegro. Después del COMMIT,
con una **autorización nueva de reversión**, y sólo si el estado coincide con el
recibo sin actividad posterior:

```js
await repair.revert(db, manifest, {...approval, action: 'revert'}, receipt);
```

Restaura por ID las FK respaldadas, deja ambos huéspedes y todos los pagos,
conserva el alias con `revertido_en` y vuelve a bloquear la identidad duplicada.
No borra auditoría; la reversión añade su trazabilidad. Una reejecución de reversión
ya completada se detiene sin escrituras. Si existe actividad posterior, preparar
un nuevo plan de compensación revisado; no restaurar toda la base encima de
reservas posteriores ni trasladar pagos.

Para un regreso del código ya instalado, preparar otra transacción revisada que
restaure los cinco cuerpos y metadatos respaldados. Conservar registro/alias y sus
protecciones hasta resolver su compatibilidad: no borrar tablas de metadatos con
historia ni desactivar HLI01/HLI02. La instalación fallida ya tiene rollback
automático; no necesita ese regreso manual.

## Índice y segundo grupo

03 no forma parte de la instalación. Aborta si hay duplicados, incluidos los alias
que conservan documentos. La PK privada protege operaciones nuevas mientras la
tabla histórica mantiene sus conflictos visibles. Resolver el segundo grupo exige
su propia evidencia, manifiesto y aprobación; no reutilizar esta selección.
Una decisión futura de archivo documental debe acordarse antes de considerar el
índice global. No vaciar documentos ni eliminar filas para forzarlo.
