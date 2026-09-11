# TOTAL V3.1 — desplegado, sin ejecutar writer real

Migración aplicada con historial: `20260910235134_haiku_total_financiero_v31_guard_servicios.sql`.
Corrige el guard privado y actualiza la identificación del writer/capacidad a
`total1_financiero_v31`; el cliente acepta explícitamente esa versión. V3 histórica
permanece intacta. La lógica restante del writer y los permisos no cambian.
Backend comprobado: writer_disponible true. Bruno conserva 428571; pagos 459000;
aplicado 428571; servicio realizado, total cero. Las huellas de diez tablas,
incluida auditoría, coinciden antes/después. No se invocó el writer remoto.

Antes: cualquier servicio de la reserva bloqueaba.
Ahora: permite servicios de total exactamente cero, sin ningún cargo vinculado.
Bloquea total positivo, negativo o NULL, y cualquier cargo asociado al servicio,
incluso si la relación apunta a otra reserva. El guard anterior de cargos y las
restricciones de aplicaciones/destino/devoluciones/sobrepago siguen idénticos.
No se presume que ausencia de cargo signifique servicio gratuito.

Pruebas:

- `node --test tests/*.test.cjs`: 576 aprobados; 0 fallos.
- `node tests/totales-financiero-v3-postgres.cjs --v31`: 31 escenarios SQL
  (21 regresiones existentes + 10 casos específicos).
- Siete scripts SQL históricos: 106 escenarios adicionales.
- Prueba contractual compara la función completa contra V3, permitiendo sólo
  la sustitución exacta del predicado de servicios.

Casos nuevos: servicio pendiente/realizado cero sin cargo; positivo con/sin cargo;
cargo servicio activo cero; aplicaciones a servicios y a otros cargos; total NULL;
cargo vinculado fuera de reserva; impacto financiero aparecido durante escritura
que revierte todo el lote. El caso Bruno conserva pagos, metadata, servicio,
reservas, huéspedes y estadías: base 546210, IVA -87210, final/aplicado 459000,
sin aplicar y saldo cero. Datos sintéticos, PostgreSQL efímero, sin conexión real.

Despliegue autorizado realizado. Sin escritura de datos reales, git add, commit
ni push. La prueba real desde Haku corresponde al usuario.
