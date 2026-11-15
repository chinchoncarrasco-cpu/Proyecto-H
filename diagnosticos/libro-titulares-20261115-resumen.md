Candidato local de reconocimiento de titulares · 15/11/2026

Base: `411c27ad4b2b122651e24977d360cac9c1fca7a6`. Rama: `codex/libro-titulares-20261115`. Sin publicación ni escrituras de negocio. No hay cambios SQL, Auth, permisos, RLS ni dependencias.

La comparación utilizó la misma copia autorizada del XLSX para ambas versiones: 68 hojas, SHA-256 `758df858c16f89b1bd85bbe8d5f1146f5a620e43b30fe08cc7ae604f410d4f16`. Las celdas, nombres, contactos y resultados individuales permanecen fuera del repositorio, en la evidencia privada local. Este documento contiene únicamente resultados agregados.

| Medida sobre los mismos bloques | Antes | Candidato |
| --- | ---: | ---: |
| Bloques con titular reconocido | 5.545 | 5.676 |
| Bloques pendientes de identificar | 521 | 390 |
| Repeticiones de titular eliminadas dentro de celdas | 2 | 2 |
| Normalización completa de 68 hojas, medición local | 21,83 s | 23,47 s |

Se recuperaron 131 bloques, correspondientes a 117 grafías de titular normalizadas; 78 de esas grafías no figuraban entre los titulares antes reconocidos. El conteo se realiza por bloque y grafía: una persona puede tener varias estadías y varias grafías. En los 131 casos el nombre recuperado ya estaba entre los candidatos escritos en su propia celda; no se generaron nombres nuevos.

La causa principal eran notas administrativas que competían como personas: registros en acordeón, tarifas autorizadas, préstamos de objetos, instrucciones y datos de facturación repartidos en varias líneas. Se mejoró su clasificación y la separación de roles explícitos de acompañantes, pagadores, agencias y personal. La etiqueta `Titular:` conserva prioridad incluso cuando repite un nombre ya leído. Los compuestos y guiones tipográficos admiten más formatos. Una variante o errata sin evidencia suficiente conserva la ambigüedad y explica el motivo; no sustituye arbitrariamente el nombre.

La deduplicación se limita al mismo bloque. Las dos repeticiones históricas ya estaban resueltas en la base y se conservan resueltas; no se atribuye una mejora adicional a ese conteo. Se añadió cobertura para la pérdida de prioridad de una etiqueta explícita repetida y sus variantes. No se fusionó ninguna estadía del historial. Las asociaciones automáticas exigen fechas y CAB presentes y coincidentes, sin conflictos documentales. Un correo o teléfono compartido permite proponer revisión, pero no confirmar un nombre diferente ni mostrarlo como identidad verificada. Las propuestas multicabaña nuevas requieren decisión explícita; las asociaciones verificadas en Proyecto H se conservan.

El diagnóstico de titular viaja con la lectura y las dudas llegan tanto a Haku como al informe: candidatos, motivo y coordenadas. Se reutilizan los componentes existentes. No se incorporó un diccionario de personas: el historial no acredita por sí solo variantes de identidad verificadas, y la frecuencia no se utiliza para confirmarlas. Se mantienen las comparaciones y resoluciones verificadas existentes.

Validación de invariantes: los 5.545 registros previamente reconocidos conservan todos sus campos anteriores, incluido formato, estados, fechas, documentos, contactos, notas, pagos y servicios. Solo se añade el diagnóstico de titular. Los sectores completos de pagos, cancelaciones, cancelaciones pendientes, bloqueos, aseos y espacios también son idénticos. El clasificador de comprobantes y cancelaciones conserva su comportamiento anterior, evitando efectos indirectos de las mejoras de reservas.

Pruebas: 588 automatizadas PASS, incluidas 77 nuevas de titulares. Cubren etiquetas, roles, facturación multilínea, notas, nombres compuestos/extranjeros, variantes, duplicación dentro de celda, estadías repetidas, homónimos, contactos reutilizados y multicabaña con y sin vínculo verificado. Cero asociaciones incorrectas observadas en los casos controlados; clientes instrumentados sin escrituras. Chromium real: Haku e informe PASS a 1440 y 390 px, temas claro y oscuro, ocho capturas locales, sin desborde horizontal ni red externa. El navegador usa datos sintéticos y los renderers reales.

Comando de las pruebas afectadas:

```powershell
node --test tests/libro-titulares-inteligente.test.cjs tests/libro-titular-fragmentos.test.cjs tests/libro-titulares-periodo.test.cjs tests/libro-reservas-identificacion.test.cjs tests/libro-fullday-titular-mismo-fragmento.test.cjs tests/libro-semantica.test.cjs tests/libro-comparacion-readonly.test.cjs tests/haiku-libro-versiones.test.cjs tests/haiku-libro-diferencias.test.cjs tests/libro-comparacion-criterio-unificado.test.cjs tests/libro-informe-readonly-web.test.cjs tests/haiku-libro-reconciliacion.test.cjs tests/libro-consulta-incorporacion-continua.test.cjs tests/libro-consultas-visual.test.cjs
node tests/libro-titulares-browser-check.cjs
```

El navegador requiere Playwright y Chromium, ya disponibles en el entorno usado. Las capturas y registros privados están en `%TEMP%\haku-titulares-20261115`; no forman parte del candidato. El diagnóstico previo `diagnosticos/libro-estados-20261115.json`, que contiene datos reales, tampoco se incorpora.

La medición de rendimiento alternó ambas versiones por hoja en una pasada sobre los mismos datos cargados en memoria. Incluye normalización semántica completa; excluye descarga, lectura XLSX y producción. El incremento fue 1,65 s (+7,5 %). No es una medición de producción ni demuestra una mejora de velocidad.

Limitaciones: quedan 390 bloques pendientes: 384 con varios candidatos, cuatro sin nombre identificable y dos con otra duda de origen. Incluyen personas sin rol explícito, variantes sin respaldo suficiente, nombres o vouchers incompletos y datos de origen ambiguos. Las identidades civiles del historial completo no cuentan con una verdad de referencia independiente; las cifras de reconocimiento no certifican su identidad. No se consultaron ni alteraron reservas o huéspedes productivos y no se realizó una auditoría nueva de colores, pagos o cancelaciones.
