# Rollback de Constanza: diagnóstico, sin despliegue

## Causa exacta

La lectura remota confirmó total 180000, una noche 11/09/2026–12/09/2026,
CAB 9, estado confirmada, 2 adultos y 2 niños, huésped titular vinculado,
RUT con guion tanto en la reserva como en el huésped, y pago confirmado de
160000 por webpay_credito. No hay servicios ni ajustes activos.

El writer desplegado llama al editor completo con el documento actual en p_rut.
Su core ejecuta `regexp_replace(upper(btrim(p_rut)), '[^0-9K]', '', 'g')` y
actualiza ambos documentos. Se reproduce con el RUT ficticio `12345678-5`:

| Ruta del snapshot | Antes | Después dentro del intento local |
|---|---|---|
| reserva.titular_numero_documento | 12345678-5 | 123456785 |
| huespedes[0].numero_documento | 12345678-5 | 123456785 |

Son las dos diferencias encontradas en la reproducción. El snapshot protegido
sigue siendo distinto aunque el RUT represente a la misma persona: la orden de
total no autoriza editar el documento. El rechazo es correcto.

El motor también anula el cargo de alojamiento de 180000, crea uno de 160000 y
recrea la aplicación contra el nuevo cargo. La regresión demuestra pago_id y
monto aplicado 160000 constantes, con nuevo cargo_id e ID de aplicación.
**Estos IDs no causan este error:** `haiku_total_snapshot` no contiene cargos
ni aplicaciones de alojamiento. Sí protege cargos/aplicaciones de servicios,
además de la fila completa del pago. No se ha declarado una excepción nueva.

Se revisaron los triggers remotos: actualización de timestamps (el snapshot ya
excluye actualizado_en en reserva/estadía/huésped), auditoría, validaciones y
limpieza de Full Day. El trigger de BOVE sólo invalida para cargos de servicio,
no los cargos de alojamiento de este caso. No se ejecutó ningún writer remoto.

## Corrección propuesta

No modificar la definición del invariante ni normalizar el snapshot de documentos.
Separar la modificación financiera del uso del editor de personas: para una
estadía normal compatible, actualizar únicamente la tarifa; el trigger oficial
puede actualizar el mismo cargo activo, manteniendo sus aplicaciones existentes.

La prueba de viabilidad local produce 160000, conserva íntegro el snapshot
protegido y mantiene IDs de cargo/aplicación y monto aplicado. No es todavía
una nueva rama de writer: antes de generalizarla hay que conservar sus locks,
permisos, validación de pagos por cargo y total, límites de estructura, Full Day,
invariantes, auditoría y atomicidad mixta. No basta con copiar ese UPDATE aislado.

No se debe corregir retrospectivamente el RUT de Constanza ni restaurarlo con
otro UPDATE después de usar el editor: eso ocultaría una edición no autorizada.

## Regresiones y diagnóstico

- `fixtures/total-constanza-anonimizada.sql`: preserva estructura, fechas,
  ocupación, montos, medio y formato de RUT; IDs/contactos/documento ficticios.
- `totales-constanza-diagnostico-postgres.cjs`: primero reproduce el rechazo
  usando la migración desplegada sin modificaciones y exige rollback íntegro.
  Después obtiene las dos rutas exactas con el diagnóstico local, observa la
  reconstrucción financiera y prueba la alternativa focalizada con ROLLBACK.
- `totales-diagnostico-contrato.test.cjs`: garantiza que el SQL de diagnóstico
  no cambia la comparación ni ninguna otra lógica del writer.
- `../supabase/preparadas/haiku_total_diagnostico_invariantes.sql`: sólo local.
  Mantiene el mensaje y agrega `DETAIL` JSON con rutas, sin valores personales.
  No se aplicó a Supabase ni se modificaron las migraciones históricas.

Limitación explícita: reproducción PGlite con esquema sintético y funciones
financieras originales; no es una repetición del intento contra producción.
La primera fixture normal anterior tenía documento y huésped titular nulos:
por eso no ejercitaba el caso real de RUT con guion. Ahora está cubierto.
