# Transferencias del Libro: candidata pendiente

`01-writer.sql` **no se ha aplicado a Supabase**. Se ejecuta únicamente en PostgreSQL efímero mediante `tests/libro-transferencias-postgres.test.cjs`. Requiere revisión y aprobación de aplicación independientes.

El writer capturado en el repositorio exige identificador fuerte o aprobación manual, copia el titular a `pagador_nombre` y descarta la evidencia bancaria del payload. Por eso el frontend consulta `haiku_libro_transferencias_capacidad_v2`: si falta, falla o no anuncia el contrato esperado, el pago permanece en revisión con el motivo SQL. No promete un NUEVO_SEGURO que el writer anterior rechace.

La candidata:

- Permite confirmar transferencias de alojamiento con evidencia completa sin aprobación intermedia. Exige `confirmacion_final=true`, que el frontend añade exclusivamente dentro de la confirmación final, tras revalidar la selección. No escribe una aprobación manual ficticia.
- Verifica fecha de recepción, monto, CLP, medio, glosa, remitente, origen y reserva/CAB/bloque únicos. Conserva las guardias de permisos, reserva vigente, operación idempotente y los demás medios del writer.
- Conserva el nombre del pagador en `pagador_nombre`, y pagador y evidencia bancaria en `datos_origen`. No modifica documentos ni identidades de huéspedes o titulares.
- No deduplica por celda, RUT, glosa, hora o `item_id` para este recorrido bancario. Una operación bancaria coincidente requiere además compatibilidad de remitente, fecha, monto, moneda, estado y destino; varias coincidencias o contradicciones abortan el lote.
- Dos operaciones distintas pueden registrar dos transferencias iguales del mismo día. Sin operación, un candidato indistinguible queda en revisión; no se supone que sea relectura ni movimiento nuevo. La relectura sin operación también exige revisión, evitando una segunda inserción.
- Serializa las confirmaciones bancarias del Libro con un advisory lock transaccional para que dos confirmaciones de este writer no pasen a la vez el control de duplicados. Otros canales conservan sus contratos; no se anuncia una garantía global para escrituras externas al writer.
- Guarda el día civil de recepción a mediodía de Chile, sin inferir una hora real del banco. La hora que aparezca en el Libro se conserva en la referencia y no se usa como identidad.

No hace actualización masiva, backfill, limpieza, aprobación ni registro de pagos al instalarse. No altera filas existentes; sólo cambia el comportamiento de futuras confirmaciones y añade funciones. Los pagos históricos sin operación/evidencia persistida no se completan automáticamente.

## Baseline y orden

Se acepta exclusivamente el writer auditado por catálogo el 21/10/2026 (`1898d46805d4d65f582dada43909b745`), o ese mismo writer con la candidata de formato RUT (`005385ccd81ea8b30f67adace1ac45f2`). También se comprueban owner, ACL, SECURITY DEFINER y search_path; un cambio ajeno detiene toda la transacción.

Dependencias existentes en el contrato reconstruido: `haiku_incorporar_libro_v1`, `haiku_registrar_pago`, auditoría del medio manual, tablas de pagos, reservas, estadías y cabañas. Las pruebas reconstruyen esos contratos versionados, comprueban ambas variantes del writer y preservación de permisos e históricos. No se ha vuelto a consultar el catálogo remoto en esta tarea: antes de aplicar, hay que comprobar en sólo lectura la definición vigente y estas dependencias. La candidata se detendrá si no corresponden.

Si se aplicarán ambas candidatas, aplicar primero la de formato RUT y después ésta. Si se aplica transferencias primero, la candidata RUT anterior se detendrá por su hash y deberá regenerarse/revisarse para ese nuevo baseline; no eludir la guardia. Transferencias no depende funcionalmente de aplicar el formato RUT.

La capacidad pública comprueba el hash del writer instalado. Si otra revisión lo cambia, deja de anunciar compatibilidad y la interfaz vuelve a revisión. Un cambio posterior requiere verificar también los helpers de este contrato.
