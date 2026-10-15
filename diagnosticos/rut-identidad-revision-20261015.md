# Identidad por RUT: candidata para revisión

**READY FOR REVIEW — NO PRODUCTION CHANGES**

Fecha: 15/10/2026, America/Santiago. Base `main`, HEAD
`34ec003b90915d580ed9b738c3ac96c974a23e23`, árbol inicialmente limpio.
Rama local: `fix/rut-identidad-supervisada`. Sin commits, merge, push ni despliegue.
Producción se consultó exclusivamente con transacciones `READ ONLY`.

## Causa y evidencia

El índice `huespedes_documento_uidx` compara el par textual de tipo y número.
El alta normaliza sólo la entrada y busca igualdad contra el texto almacenado.
Un registro con separadores puede quedar fuera de la búsqueda y permitir otra
identidad con el RUT compacto. La cancelación no elimina la identidad ni libera
su documento. El Libro encuentra después el documento en otra fila y protege el
lote mediante `HLI01`; su rechazo es correcto y se conserva.

La consulta productiva confirmó dos grupos y cuatro huéspedes. En el par
confirmado, ambos RUT tienen DV válido, normalizan a la misma clave y sus nombres
y caches son compatibles. Eso complementa la confirmación del operador; **no
constituye autorización para ejecutar la reparación** ni una regla de fusión por nombre.

La reserva original permanece cancelada, CAB 8, 09–11/10/2026, con un pago;
la posterior permanece confirmada, CAB 8, 30/10–01/11/2026, sin pagos.
Cada huésped tiene una referencia de titular, una de `reserva_huespedes` y una de
`estadia_huespedes`; ninguno tiene referencias directas en notas o solicitudes.
Se verificaron todas las FK entrantes a huéspedes: esas cinco vías son las reales.
No se localizaron otras FK entrantes en el catálogo consultado.

El manifiesto JSON adyacente conserva conteos, huellas de los cinco writers,
ACL/owner/security/search_path, correspondencia de migraciones y hashes del par.
No contiene nombres, RUT, contactos ni UUID personales completos. Los hashes
de filas son comparadores, no respaldos recuperables ni pruebas de identidad.
`04-manifiesto-par-readonly.sql` permite reproducirlos con los códigos verificados
proporcionados únicamente en la sesión privada del operador.

## Correspondencia con Supabase

Se compararon las instrucciones completas de cuatro migraciones desplegadas con
sus archivos locales, normalizando sólo CRLF y espacios exteriores: las cuatro
coinciden. No se dedujo equivalencia a partir de los números.

| Migración | Versión local | Versión desplegada | Contenido |
| --- | --- | --- | --- |
| modificación completa original | 20260902051904 | 20260902051904 | Igual |
| crear reserva Full Day | 20260902053250 | 20260902053250 | Igual |
| prevención tarifa FD-3 | 20260929023216 | 20260929155720 | Igual |
| guard identidad Libro | 20261010034622 | 20261010230638 | Igual |

Los cuerpos efectivos también incorporan modificaciones posteriores. Las cinco
huellas efectivas están en el JSON; la candidata exige esos cuerpos **y** sus
metadatos de seguridad antes de parchearlos. Las pruebas reconstruyen tres desde
el repositorio; los cuerpos sin datos de `haiku_actualizar_reserva` y del importador
efectivo se guardan como fixtures de catálogo para no atribuirles otra versión.

Se inspeccionaron los cinco writers solicitados, sus llamadas envolventes y los
INSERT/UPDATE de huéspedes del repositorio. El catálogo productivo identificó
exactamente esos cinco escritores directos. Las altas de acompañantes sin documento
siguen creando personas independientes. El DML directo queda cubierto por trigger.

Se revisaron el check de consistencia documental, el índice textual, las unicidades
de vínculos, las FK RESTRICT, el trigger que exige pertenencia a la reserva antes
de asignar una estadía, los timestamps y la auditoría de reservas. Las seis tablas
consultadas tienen RLS. Las políticas conservan sus permisos existentes de reservas,
huéspedes, notas y solicitudes; la candidata no las reemplaza.

## Implementación candidata

Los SQL están en `supabase/candidates/rut-identidad`, **fuera del directorio de
migraciones automáticas**. No se modificó ninguna migración histórica.

1. `00-preflight-readonly.sql`: verifica inventario, cuerpos y catálogo sin devolver documentos.
2. `01-registro-y-guard.sql`: normalizador RUT, registro privado y triggers de protección.
3. `02-writers.sql`: parches acotados sobre los cinco cuerpos auditados.
4. `03-indice-diferido.sql`: opción separada que aborta ante cualquier duplicado.
5. `04-manifiesto-par-readonly.sql`: huellas del par con parámetros privados.

`tools/rut-identidad-instalar.cjs` instala 01 y 02 en **una sola transacción**.
Si un cuerpo o permiso difiere, se revierten también los DDL y la carga del registro.
No tiene CLI ni conexión automática. Los SQL individuales no deben instalarse
por separado: el módulo es el punto de entrada de la candidata.

El normalizador acepta cuerpo de 1–8 dígitos sin ceros iniciales y DV módulo 11,
compacto, con guion o agrupación de miles correcta; convierte `k` en `K`. Rechaza
símbolos, letras extra, puntos mal agrupados y DV incorrecto. La clave nunca
depende del formato visible. Los valores ausentes crean personas independientes;
los pares incompletos o inválidos nuevos se rechazan con `HLI03`. Un inválido
histórico no se reescribe por una actualización ajena al documento.

El registro privado reserva una clave por grupo documental; los RUT históricos
duplicados se cargan **bloqueados, sin propietario canónico**. Esto no impone
unicidad sobre las filas históricas de huéspedes ni resuelve sus conflictos.
La PK del registro serializa las escrituras nuevas, incluso con snapshot antiguo.
Los pasaportes y demás tipos conservan igualdad textual exacta del par tipo/número;
no reciben módulo 11 ni eliminación de separadores. El registro también protege
sus conflictos con `HLI01` sin el DETAIL documental del índice original.

El alta reutiliza únicamente el dueño inequívoco del RUT y no actualiza sus datos.
Un nombre diferente exige `HLI02`. Compartir un nombre sin documento nunca fusiona.
Una carrera rechaza una de las operaciones de forma íntegra; un reintento nuevo
puede consultar la identidad que ganó. `40001` continúa siendo un error de
serialización de PostgreSQL: no se reutiliza automáticamente un lote financiero.

El Libro reconoce equivalencia de RUT y excluye sólo los alias aprobados activos
de su búsqueda de otros propietarios. Conserva `HLI01/HLI02`, sus permisos y toda
la rama `pago_actualizar`. El frontend añade el manejo seguro de `HLI03`, respeta
el tipo documental explícito y reconoce el compacto con K. El puente
`supabase-asistente-libro-incorporacion-v1.js` se inspeccionó y no necesita cambios:
ya transfiere la comparación al mismo núcleo y mantiene la vigencia del informe.

Los errores invalidan el payload y exigen comparar de nuevo. Los pagos dependientes
siguen pendientes hasta guardar identidad y revalidarlos. Las altas independientes
se pueden seleccionar expresamente en otro lote; un lote rechazado nunca se
divide para guardar parcialmente. No se cambia el protocolo separado de servicios 4C.

## Reparación propuesta y preservación

Se propone como canónica la identidad de la reserva original, por ser el ancla
del historial con pago. No se infiere esa elección por igualdad de nombre ni por
estar cancelada. La fila redundante conserva todos sus campos, incluido su RUT;
un alias privado aprobado impide reutilizarla. No se borran huéspedes.

La herramienta exige UUID/códigos completos proporcionados de forma privada,
fechas/CAB/estados/conteos exactos, dos huéspedes con RUT válido equivalente,
dos reservas distintas y un solo grupo de dos filas. Exige manifiesto SHA-256
vigente, evidencia externa y aprobación explícita vinculadas a una operación.
Cualquier otra FK a huéspedes aborta para revisión.

Descubre recursivamente tablas dependientes, captura sus filas y catálogo, bloquea
el conjunto en orden, vuelve a comprobarlo y actualiza las cinco vías de referencia.
No mueve pagos ni cambia sus FK. Verifica todos los campos salvo las FK aprobadas
y el timestamp operativo de filas efectivamente actualizadas. Los eventos previos
de auditoría deben permanecer íntegros; se permiten nuevos eventos del trigger.
No reescribe UUID, timestamps de creación ni demás columnas de los vínculos.

Una diferencia, colisión de vínculos o error tardío revierte todo. La reejecución
con recibo posterior idéntico no escribe. La reversión requiere autorización de
acción `revert`, el respaldo y un recibo que coincida exactamente con el estado
actual; restaura las FK por ID de fila, conserva el alias como revertido y vuelve
a bloquear el grupo. Si hubo actividad posterior, aborta y exige un nuevo plan.

Matriz verificada con personas y fechas ficticias en PGlite y PostgreSQL nativo:

| Control | Antes | Después de reparar | Después de revertir |
| --- | --- | --- | --- |
| Reservas / estadías | 2 / 2 | 2 / 2 | 2 / 2 |
| Reserva original | cancelada | cancelada | cancelada |
| Reserva posterior | confirmada, huésped B | confirmada, huésped A | confirmada, huésped B |
| Identidades guardadas | A y B completas | A y B completas; B retirada | A y B completas; alias revertido |
| Pagos por reserva | 1 original / 0 posterior | 1 / 0 | 1 / 0 |
| Monto y destino del pago | 10.000 ficticios, original | Exactamente iguales | Exactamente iguales |
| Cargos / aplicaciones / noches | fotografía completa | Iguales | Iguales |
| Fechas / CAB / estados operacionales | fotografía completa | Iguales | Iguales |
| UUID y creación de vínculos | fotografía completa | Iguales; sólo cambia huésped | Restaurados |
| Notas / solicitudes ficticias | asociadas a B | mismo contenido, asociadas a A | misma fila y contenido, B |
| Historial previo | fotografía completa | Se conserva; auditoría puede crecer | Se conserva; auditoría puede crecer |

Los editores anteriores intentaban normalizar el documento canónico al formato
del alias. El trigger conserva la representación anterior si son equivalentes;
así ambos editores siguen funcionando después de reparar, sin desactivar el índice
textual ni vaciar el documento de B. Este caso tiene una regresión específica.

## Pruebas y límites

- Node, 62 archivos del Libro: **1.447 PASS / 0 FAIL / 0 SKIP**.
- SQL: **51 PASS / 0 FAIL / 0 SKIP**, 25 nuevas y 26 regresiones existentes.
  Incluye las 14 pruebas anteriores del guard. Se verifica también una respuesta
  perdida después del COMMIT: `HLR03` indica resultado incierto, nunca un rollback
  confirmado; consultar y reintentar con el recibo no vuelve a escribir.
- PostgreSQL nativo **17.6**, conexiones separadas: **8 PASS / 0 FAIL / 0 SKIP**
  (siete subcasos más el contenedor Node). Cubre READ COMMITTED, REPEATABLE READ,
  DML directo, pasaportes concurrentes, RLS/privilegios y reparación/reversión.
- Navegador: **8/8 recorridos PASS**, códigos legado/HLI01/HLI02/HLI03 a
  1100 y 390 px. Cero peticiones externas, cero pagos enviados durante el paso
  de identidad. Capturas sintéticas inspeccionadas en escritorio y móvil.
- Pruebas SQL con motor PGlite 17.5 y servidor nativo 17.6. Se ejecutan los cuerpos
  reales sobre un esquema representativo, no una copia integral de producción.
  Disponibilidad y ciertos servicios financieros externos conservan los límites
  documentados por las fixtures originales.

El único ajuste de infraestructura a las fixtures anteriores normaliza LF y
permite inyectar el cliente nativo. No se quita ni debilita ninguna aserción previa.
Los logs y capturas de ejecución son locales temporales y sintéticos.

## Segundo grupo, riesgos y autorizaciones pendientes

El otro grupo tiene dos huéspedes y dos referencias de titular, sin notas o
solicitudes directas. No se ha confirmado que sean la misma persona y no se
incluye ninguno de sus identificadores. La candidata lo mantiene pendiente y no
escoge dueño. Las pruebas comprueban que reparar el primer grupo no lo altera.

El índice normalizado global queda **BLOCKED por diseño**: sigue habiendo el
segundo grupo y las filas redundantes conservan sus documentos. El registro
privado ofrece la garantía transaccional nueva sin falsear ese inventario.
Una política futura de archivo documental requerirá revisión y autorización
independientes; esta candidata no vacía documentos para hacer pasar el índice.

La herramienta administrativa toma una fotografía completa del conjunto de tablas
dependientes y bloqueos de tabla conservadores. Requiere ventana de mantenimiento,
respaldo privado cifrado, evaluación de volumen y nuevo preflight. No es una
operación de autoservicio para la UI. Su manifiesto completo puede contener datos
de otras reservas y nunca debe imprimirse, enviarse al frontend ni versionarse.

Quedan pendientes la revisión humana de la candidata, la evidencia/aprobación
específica de identidad, el segundo grupo y autorizaciones separadas para instalar,
reparar o desplegar. No se solicita ejecutar producción como parte de este cierre.

Referencias técnicas consultadas: [funciones y privilegios en Supabase](https://supabase.com/docs/guides/database/functions),
[consistencia y bloqueos en PostgreSQL 17](https://www.postgresql.org/docs/17/applevel-consistency.html).
