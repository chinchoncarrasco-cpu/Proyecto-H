# Glosa de transferencia sin nombre del remitente

El banco puede entregar `0123456701 Transf.`, `Transf. 0123456701` o sólo el número cuando el medio transferencia está confirmado. El lector y el validador exigían además un nombre dentro del mismo fragmento, por lo que una glosa válida quedaba en revisión.

`01-writer.sql` ajusta únicamente tres definiciones: el validador privado de transferencias, la asignación de `pagador_nombre` en el writer y el anuncio público de capacidad. No incorpora pagos, modifica filas históricas, cambia permisos ni agrega tablas. Si la glosa no contiene nombre, el pagador queda sin nombre; nunca se completa con el titular de la reserva. El número conserva el cero inicial y no se usa como identificador único de transacción.

## Contrato y controles conservados

- API de transferencias v2 y confirmación final obligatoria.
- Validación de medio, monto, moneda, fecha, origen y reserva/cabaña destino.
- Evidencia bancaria y nombre explícito del pagador, si existe.
- Bloqueos, idempotencia y revisión ante posibles duplicados. Dos abonos iguales necesitan operaciones distintas para poder distinguirse.
- Aprobación administrativa y capacidades de aplicaciones a servicios existentes.
- Los clientes anteriores siguen funcionando; el cliente nuevo requiere `glosa_sin_nombre: true` antes de seleccionar este nuevo caso.

## Orden de activación

1. Cotejar las tres huellas, propietarios, permisos y rutas de búsqueda del servidor. La candidata aborta y revierte si cualquiera difiere del baseline revisado o cambia un atributo de seguridad.
2. Aplicar `01-writer.sql` como una migración transaccional.
3. Comprobar como usuario autenticado que `haiku_libro_transferencias_capacidad_v2()` devuelve `version: 2`, `confirmacion_final: true` y `glosa_sin_nombre: true`.
4. Publicar el lector y la comparación. Recargar Haku y volver a consultar el Libro para generar un plan nuevo; los planes anteriores no se convierten ni se registran automáticamente.

Baselines: validador `8f7b3cb53ea7a4a64354890b280812c1`, writer `6b3ffdc6e8ce5b376eb3df7a00d1ad2c`, capacidad `54aa5878d74a868adf9fa5aac1ac06ea`. Se comparan con `md5(replace(prosrc,chr(13),''))`.

## Validación y reversión

Las pruebas recorren lector → comparación → preparación → writer en PostgreSQL efímero, con identidades sintéticas. Cubren ambos órdenes, número solo con medio confirmado, confirmación final, pagador tercero, relectura del recibo, duplicados, operaciones distintas, evidencia alterada, permisos y rechazo de baselines desconocidos.

Ante una regresión se puede revertir primero el cliente; las definiciones nuevas son compatibles con el cliente anterior. Para revertir también SQL, restaurar exclusivamente las tres definiciones originales cotejadas antes de aplicar, conservando sus atributos y permisos. Los pagos ya registrados no deben borrarse ni reformatearse. No ejecutar otra candidata de writer sin cotejar las nuevas huellas.
