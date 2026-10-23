# Confirmación manual de pagos por administrador

Estado: candidata preparada y probada localmente; **sin aplicar en Supabase**.
Base web: `5513fe06840e1d5d27d3e51e98d2e6daa35e8604`.

## Comportamiento

- Efectivo de servicio, sin identificador bancario: el administrador puede confirmar recepción y asociación a **un cargo real, compatible y pendiente**. No se inventa un identificador, ni se crea un servicio al confirmar el pago. Si falta el servicio, el panel explica que debe resolverse primero.
- Transferencia de alojamiento cuyo único conflicto de evidencia es el número de cabaña del concepto: confirma la cabaña del bloque, inequívocamente asociada a una estadía existente. El concepto y la glosa originales permanecen intactos. No se elige otra reserva por nombre o RUT del pagador.
- El botón abre el panel existente de Haku. Exige check y motivo; conserva el resultado abierto como **Listo para incorporar**. Revisar no escribe pagos: sólo la confirmación final ejecuta el writer.
- Sin capacidad SQL, el administrador puede abrir el panel y leer el bloqueo; el botón de confirmar permanece deshabilitado. Los posibles duplicados, datos incompletos y destinos ambiguos siguen bloqueados.
- Cambiar permisos, sesión, Libro, servicio, cargo o saldo invalida la decisión. El backend verifica administrador activo, permiso, evidencia, destino y saldo antes de registrar.
- El pago conserva `revision_pago_admin_v1` (actor autenticado, motivo, destino, evidencia y fecha de validación del servidor) y `evidencia_libro`. La relectura reconoce el recibo sin reprocesarlo. BOVE y movimiento de fila no invalidan una aclaración bancaria íntegra; cambios de monto, fecha o destino sí requieren revisión.

## SQL y alcance

`01-writer.sql` se aplica completo y en una transacción. Verifica las huellas de siete funciones vigentes antes de cambiar nada. Un writer distinto o una segunda aplicación detienen el script.

Crea un validador privado `SECURITY INVOKER`, sin permiso de ejecución directo para `PUBLIC`, `anon` o `authenticated`. Modifica únicamente:

1. `private.haiku_libro_pago_servicios_v1`: excepción acotada de efectivo validado por administrador y protección ante otro pago de igual fecha/monto o fuente.
2. `public.haiku_incorporar_pago_servicios_libro_v1`: validar y conservar la aclaración.
3. `public.haiku_incorporar_libro_v1`: validar y conservar la aclaración de cabaña.
4. `public.haiku_libro_aplicaciones_servicio_capacidad_v1`: anunciar `revision_pago_admin_v1` manteniendo deshabilitado el efectivo genérico sin identificador.
5. `public.haiku_libro_transferencias_capacidad_v2`: actualizar la huella esperada del writer, preservando transferencias v2.

Conserva ACL, `search_path`, propietario y modalidad de seguridad de las funciones existentes. No modifica la normalización RUT, el validador bancario v2, los pagos históricos, las reservas, los servicios ni las notificaciones. Reutiliza los recibos idempotentes existentes. No introduce costos ni dependencias de ejecución nuevos.

Orden de activación: instalar la candidata después de reconfirmar las huellas y publicar el frontend de este mismo PR. Instalar SQL primero es compatible con el frontend anterior. No invocar RPC de registro sobre pagos reales como prueba de despliegue.

## Validación

**142 pruebas focales aprobadas, cero fallos:** 122 regresiones existentes de pagos/transferencias, 15 pruebas nuevas de preparación e interfaz y 5 escenarios PostgreSQL con writers reales y datos sintéticos. Las 15 de interfaz se repitieron después del ajuste final de clases, todas aprobadas.

Incluye registro exacto, asociación al cargo, pagador separado, conservación de evidencia, doble envío con la misma operación, rechazo con una operación nueva duplicada, relectura, BOVE/fila movida, cambios de monto, roles, permisos, sesión, capacidad, cancelación, checkbox, motivo y resultado visible. PostgreSQL verifica rechazo ante evidencia alterada, ACL intactas y detención ante definiciones distintas. La fecha del pago puede ser posterior a la del servicio.

```sh
node --test tests/libro-pago-revision-admin.test.cjs \
  tests/haiku-libro-pagos-aprobacion-manual.test.cjs \
  tests/haiku-libro-pagos-servicios-frontend.test.cjs \
  tests/libro-transferencias-bancarias.test.cjs

# Requiere @electric-sql/pglite; también admite HAKU_PGLITE_MODULE con su ruta instalada.
node --test tests/libro-pago-revision-admin-postgres.test.cjs
```

Se trabajó con un snapshot parcial de la base indicada; no se afirma ejecución de la suite completa. No se completó QA visual en navegador: el entorno no tenía Chromium y su descarga devolvió un archivo inválido. Las interacciones se validaron con el DOM de pruebas existente. Se reutilizan las clases y el input del panel aprobado, sin modificar CSS, tema claro ni tema oscuro.

La fixture SQL contiene sólo definiciones capturadas mediante SELECT, sin registros personales; permite probar las huellas exactas y los writers en PostgreSQL efímero. En producción únicamente se consultaron definiciones y metadatos durante esta implementación.
