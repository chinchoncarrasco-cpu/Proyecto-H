# Cloudbeds Writer W1

W1 se dirige al esquema vigente de Proyecto H. Antes de una nueva
certificación, el Supabase Lab local debe sincronizar estas columnas del
esquema real:

- `public.eventos_auditoria.estadia_id uuid`, con FK a
  `public.reserva_estadias(id)` y `ON DELETE RESTRICT`;
- `public.eventos_auditoria.cabana_id uuid`, con FK a `public.cabanas(id)` y
  `ON DELETE RESTRICT`;
- `public.huespedes.apellido`.

La migración W1 no crea ni vuelve opcionales esas dependencias. Los fixtures
PostgreSQL locales las representan exclusivamente dentro de su esquema
efímero.

## Contrato de confirmación

1. `public.haiku_previsualizar_tarifa_cloudbeds_v1(uuid, uuid, bigint)` relee
   reserva, estadía y finanzas desde Proyecto H sin escribir.
2. Para alojamiento normal reutiliza
   `private.haiku_plan_total_financiero_v3` y devuelve `firma_iva` solamente
   cuando el plan la contiene.
3. El modal muestra el snapshot devuelto por la preview antes de habilitar la confirmación.
4. La confirmación reenvía `total_actual` como `total_actual_esperado` y la
   misma `firma_iva` opcional a W1.
5. W1 revalida el total bajo locks y entrega la firma recibida a TOTAL v31.
   No genera una firma nueva.

`certeza`, `evidencia` y las referencias Cloudbeds son metadata de origen y
auditoría. La autorización backend depende de sesión, permisos internos,
estructura actual de la reserva, snapshot vigente y autoridades financieras.
El frontend activa el flujo auditado con `CLOUDBEDS_TARIFAS_WRITER_HABILITADO = true`.
