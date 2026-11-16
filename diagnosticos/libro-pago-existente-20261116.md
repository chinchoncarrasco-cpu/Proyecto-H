Proyecto H · aplicación del abono original · evidencia sintética · 16/11/2026

Base `c3e0c68528d83f1d5ba70bf03b9b8de1b559f21b`, rama local `codex/libro-pagos-20261116`.
No se consultó ni escribió una reserva real para estas pruebas. No se aplicaron migraciones remotas ni se publicó el cambio.

La fila del pago ya registrado ofrece **Aplicar pago existente**. Abrirla no escribe: muestra el cargo de alojamiento, CAB 2, 13–14/11/2026, saldo 158.400, pago disponible 144.000, aplicación propuesta 144.000 y remanente 0. Si hay varios cargos, exige elegir uno. Después de **Confirmar aplicación** aparece la confirmación final **Aplicar pago existente**.

Se reutiliza el pago ficticio `66666666-6666-4666-8666-666666666666`, sin editar ninguno de sus campos. Conserva CAB 3 y el origen `Oct26!CI36:CL36` en `datos_origen`, así como fecha, autorización e historial. Se aplica exclusivamente al cargo activo `33333333-3333-4333-8333-333333333333` de la misma reserva y estadía reprogramada. Los cargos anteriores anulados quedan intactos.

| Magnitud · escenario aislado del abono | Antes | Después confirmado y releído |
|---|---:|---:|
| Pagos confirmados | 1 · 144.000 | 1 · 144.000, mismo ID y contenido |
| Aplicaciones de ese pago | 0 | 1 · 144.000 al alojamiento |
| Cargos pendientes | 188.400 | 44.400 |
| Pagos sin aplicar | 144.000 | 0 |
| Saldo neto | 44.400 | 44.400 |

El alojamiento pendiente queda en 14.400 y el Jacuzzi en 30.000. La ficha mantiene saldo neto 44.400; oculta el aviso de abonos sin aplicar cuando llega a cero. Haku muestra la aplicación confirmada y, al releer, «Pago registrado · aplicado 144.000 · sin aplicar 0»; desaparece la acción del pago ya consumido. Reenviar la misma operación o la misma propuesta con otro UUID no añade otra aplicación.

La confirmación relee Libro, asociación, capacidades, usuario y permiso. PostgreSQL vuelve a bloquear y comprobar reserva/estadía, cabaña/fechas, pago original, devoluciones, aplicaciones previas, candidatos y saldo ajustado del cargo. Un cambio exige nueva revisión y revierte la operación. Una respuesta perdida reutiliza el UUID. Si el guardado está confirmado y falla la relectura, se informa como confirmado con lectura pendiente y se deshabilita la vista antigua.

Casos adicionales: cargo de 100.000 recibe 100.000 y deja 44.000 disponibles; dos cargos exigen selección explícita; disponible modificado entre vista previa y confirmación bloquea antes del escritor. La lectura reutiliza la cobertura financiera histórica cuando ya existe; una lectura incompleta no presupone disponibilidad.

Validación:

- **323 pruebas PASS, 0 fallos** en 20 suites focales de pagos/destinos, aprobación manual, penalidad, ficha, comparación e incorporación; incluye las regresiones nuevas de aplicación existente y PostgreSQL local. Ejecutadas con `node --test --test-concurrency=1` para limitar la memoria del entorno. Resultado final en `libro-pago-existente-antes-despues-sintetico.json` y registro privado `pruebas-focales.log`.
- Chromium real → RPC SQL real → PGlite local desechable: **15 escenarios PASS**, sin respuestas de escritura simuladas. Abono, tinaja y penalidad en escritorio/móvil y claro/oscuro (12), más aplicación parcial, destino ambiguo y cambio de disponible (3). Sin llamadas de red externas.
- Tinaja: un pago de 32.500, aplicación de 30.000 y 2.500 sin aplicar, sin duplicaciones al repetir. Penalidad: comprobante de 16.000 separado del ajuste activo de 14.400; transferencia por diferencia de tarifa aprobada aparte, sin alterar ese ajuste.
- Permisos revocados, cambio de Libro, estadía o saldo, cargo de otra estadía, devolución, aplicación previa, respuesta perdida, relectura fallida e idempotencia; reversión de funciones conservando las tablas financieras.

Evidencia completa exclusivamente sintética en `%LOCALAPPDATA%\ProyectoH\diagnosticos\libro-pago-existente-sintetico`: `resultados.json`, `escritorio-claro-abono-detalle.png`, `escritorio-claro-abono-persistido.png`, `movil-oscuro-abono-detalle.png` y capturas de confirmación/relectura y de los otros flujos. El JSON adjunto a este informe resume las filas PostgreSQL y los importes antes/después.

Implementación: `js/haiku-libro-consultas-v1.js`, `css/haiku-libro-pagos-ui-v1.css` y `supabase/migrations/20261116191114_libro_aplicar_pago_existente.sql`. Pruebas: `tests/libro-pago-existente*.cjs`, fixture `tests/fixtures/libro-pago-existente-postgres.cjs` y lista explícita de RPC permitidos en `tests/haiku-libro-pagos-aprobacion-manual.test.cjs`.

Para revisión de despliegue, aún sin ejecutar: aplicar primero la migración de `c3e0c68` (`20261116151953`), luego `20261116191114` y por último el frontend. El backend debe anunciar `aplicar_pago_existente_v1`; sin ello no aparece la acción. La migración nueva añade un RPC protegido y amplía la capacidad existente; reutiliza el registro privado de idempotencia, sin tablas públicas ni cambios de roles/RLS. El RPC sólo permite ejecutar con sesión autenticada y permiso `pagos.registrar`; no crea ni edita pagos.

Vuelta atrás: recuperar primero el frontend anterior. Puede mantenerse el backend ampliado. Si se retira también SQL, detener nuevas confirmaciones, esperar las operaciones en curso, restaurar el cuerpo/ACL de la capacidad capturado antes del cambio y retirar únicamente `haiku_libro_aplicar_pago_existente_v1(uuid,jsonb)`, mediante migración compensatoria. No borrar pagos, aplicaciones ni auditoría. Se ensayó esa reversión en PostgreSQL local conservando íntegro el ledger.

Límites: PostgreSQL embebido sobre esquema financiero reducido con vistas/RPC y bloqueos existentes; no se ejecutó una prueba de concurrencia con dos conexiones independientes ni una operación sobre la reserva real. Publicación y aplicación productiva de las migraciones pendientes de autorización.
