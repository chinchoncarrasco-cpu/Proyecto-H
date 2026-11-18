# HAIKU · Revisión de temas claro y oscuro

Revisión del 10 de noviembre de 2026 sobre `main` en `d114d899ec4d63cfeaeccf9486792cd0fa5f087f`.

**Resultado: hay cuatro superficies sin una adaptación completa al otro tema, un fallo adicional de legibilidad en Haku y mejoras transversales pendientes en el contraste del tema claro.** Las nueve secciones principales del panel sí tienen tratamiento claro y oscuro en las vistas examinadas.

Esta revisión añade exclusivamente pruebas y documentación. No modifica la interfaz publicada ni datos operativos.

## Hallazgos confirmados

| Prioridad | Superficie | Problema observado | Evidencia y ubicación | Dirección de diseño |
|---|---|---|---|---|
| Alta | **Usar saldo a favor** | El diálogo completo permanece blanco al activar oscuro. El símbolo × queda blanco sobre blanco y desaparece visualmente. | Reproducido a 1600 y 390 px con el módulo real. Contraste de ×: **1:1**. `js/supabase-saldo-favor-v2.js:161-168`; estilos insertados mediante `css.textContent`, fuera del recolector actual. | Crear ambas variantes del diálogo, con cierre visible, resumen financiero compacto y etiquetas legibles. |
| Alta | **Detalle financiero de la ficha** — pulsación prolongada sobre los importes | El desglose permanece claro sobre la ficha oscura. El recuadro financiero activo combina fondo claro con texto claro heredado. | Reproducido a 1600 y 390 px mediante `HAIKU_FICHA_ATAJOS_V2.abrirDetalle`. Importe del recuadro activo: **1,08:1**. `js/supabase-ficha-atajos.js:716-879`, especialmente 754 y 771. | Unificar estados normal, pulsado y abierto en ambos temas; mantener la lectura de total, pagado, saldo y desglose. |
| Alta | **Haku → Incorporación completada** | “Servicios incorporados” y “Notas incorporadas” conservan un verde muy oscuro sobre fondo oscuro. También queda tenue el texto de ausencia de notas. | Capturas de la prueba de historial manual a 1100, 390 y 320 px; hoja oscura cargada. Títulos: **1,50:1**. `js/haiku-libro-confirm-cancel-fix-v1.js:206-243`: `heading.style.color = '#254531'`. | Corregir los colores semánticos de títulos, estados vacíos y divisores conservando el concepto compacto de la burbuja. |
| Media | **Comparación del Libro en página independiente** | Sólo tiene tema claro; no carga el controlador de tema ni una paleta oscura. Sigue blanca aun estableciendo el atributo de tema oscuro. | `libro-comparacion.html:1-26`; `css/sites-libro-comparacion-readonly-v1.css:1-10`. Verificado a 1600 y 390 px en la estructura de acceso. | Incorporar preferencia de tema y las dos paletas. Revisar además el límite de 680 px del contenido en escritorio para aprovechar el ancho disponible cuando haya resultados. |
| Media | **Calendario compartido de redes sociales** | La página abre forzosamente oscura, sin selector ni lectura de la preferencia del panel. Su envolvente no tiene variante clara. | `calendario-redes.html:2` fija `data-haiku-tema="oscuro"`; no carga `haiku-tema-v1.js`. `css/haiku-redes-public-v1.css:1-6` fija fondos y textos oscuros. La hoja interna de redes sí tiene variables de ambos temas, pero eso no completa la página pública. | Diseñar también la envolvente clara y definir cómo se elige y conserva el tema en el enlace compartido. |
| Media | **Textos secundarios del tema claro** | Varias pantallas tienen los dos temas, pero algunas etiquetas pequeñas son demasiado tenues en claro. | Ejemplos medidos sin animaciones: ficha, etiquetas “Titular/Teléfono” **3,33:1** y contador de servicios **2,93:1**; Cuenta, etiquetas **3,24:1**; Haku, ayuda de adjuntar captura **3,21:1**; Servicios, explicación de columnas **3,04:1**. | Ajustar una paleta común de texto secundario en claro; conservar jerarquía sin reducir más el tamaño del texto. |

Las relaciones de contraste son mediciones de los estados de prueba, no una certificación integral de accesibilidad. La revisión usa 4,5:1 como referencia para texto pequeño, excluye controles deshabilitados y no considera defectos de texto los valores internos de casillas o iconos decorativos.

## Cobertura ejecutada

La prueba principal examinó **27 pantallas o estados**, cada uno a **1600 × 1000** y **390 × 844**, alternando claro/oscuro: **54 combinaciones de pantalla y ancho** y **198 capturas** incluyendo zonas inferiores donde había desplazamiento.

| Área | Estados examinados |
|---|---|
| Operación principal | Resumen, Calendario, Cabañas, Servicios, Pagos, Cierre, Historial, Reservas y Libro de Reserva |
| Haku y utilidades | Inicio del asistente, respuesta del resumen del día, Notificaciones y Cuenta |
| Reservas y formularios | Ficha lateral, cuatro etapas de Nueva reserva, bloqueo del calendario, añadir nota, añadir servicio, filtros y columnas de Reservas |
| Finanzas secundarias | Usar saldo a favor y detalle financiero por pulsación prolongada |
| Páginas independientes | Envolvente del calendario público de redes y acceso del informe de comparación del Libro |

En esas 54 combinaciones no se observó desbordamiento horizontal del documento, cambio de geometría al alternar el atributo de tema ni errores JavaScript. Esto no equivale a haber probado todas las operaciones de cada formulario: algunos se abrieron a partir del marcado real con contenido sintético o vacío para comprobar su aspecto.

Se ejecutaron también **21 pruebas de recorridos existentes**, instrumentadas para comparar estados de diálogos y capturas: checkout, contexto de cabañas, filtros, repaso, seguimiento, solicitudes, insumos, aseo, cambio de estado, accesos del Resumen, guías de Haku, resumen del día, actualización del Libro, bloqueos, cancelaciones, historial de incorporación, promociones, tinajas y servicios manuales. Produjeron **160 estados adicionales / 320 capturas**, con tamaños entre 320 y 1440 px según la prueba.

**20 de esas 21 pruebas terminaron correctamente.** `insumos-destinos-browser-check.cjs` se detuvo porque su aserción espera la antigua frase “Aseo Full: 1 saco”, mientras el diseño actual presenta “Cabaña 1 · Aseo Full / Leña · 1 saco · 18 kg”. No se presenta ese resultado como un fallo de tema; el recorrido posterior de esa prueba quedó sin cubrir.

La revisión visual confirmó los hallazgos de la tabla y descartó falsos positivos del chequeo automático. Por ejemplo, una lectura transitoria del campo de observaciones de Aseo Express durante la transición de color no se considera un fallo: la captura final muestra el texto sobre fondo oscuro correctamente.

## Causas de cobertura incompleta

El cambio de tema del panel funciona, pero no todas las superficies siguen la misma vía:

- Los estilos de saldo a favor se inyectan en una variable llamada `css`; el generador sólo recoge determinados nombres (`style`, `estilo`, `estilos`).
- Los estilos del detalle financiero contienen interpolación de una duración de animación. El generador excluye bloques con interpolación, aunque sus colores sean literales.
- El resultado de incorporación asigna colores directamente a elementos mediante `.style.color`, fuera de las hojas de tema.
- Las dos páginas independientes no integran el mismo controlador y envolvente temática que el panel.
- La regeneración de diagnóstico produjo diferencias respecto de la hoja almacenada. No se aplicó ese resultado: regenerar automáticamente no resuelve por sí solo las cuatro causas anteriores y puede interferir con componentes que ya tienen sus propias variantes.

## Límites y excepciones

- La prueba principal usa el orden real de estilos de `panel.html`, renderizadores reales, datos sintéticos y red externa bloqueada. No accede a reservas, pagos ni sesiones reales.
- Las páginas públicas se verificaron sin token compartido ni sesión real; se confirmó el defecto de su envolvente y configuración de tema, no todos sus datos y estados autenticados.
- Algunas pruebas de componentes usan una selección de CSS, en lugar del panel completo. Sus avisos automáticos no se atribuyen al producto sin comprobación visual y de código.
- La captura auxiliar limita la cantidad de estados por recorrido. Por eso no todos sus diálogos tienen captura en todos los anchos; la matriz completa de escritorio/móvil corresponde a las 27 vistas de la prueba principal.
- El XLSX conserva deliberadamente los colores del documento importado. Su fondo blanco y celdas coloreadas no son un fallo de tema del panel. La barra lateral oscura compartida también es intencional.
- No se certifican todos los mensajes de error posibles, permisos, integraciones externas, contenido aportado por usuarios, impresiones o comportamientos de todos los navegadores.

## Siguiente diseño recomendado

Primero resolver los tres puntos de lectura y operación: **saldo a favor, detalle financiero y resultado de incorporación de Haku**. Después completar las dos páginas independientes y ajustar los textos secundarios del tema claro.

Aplicar el criterio HAIKU en las variantes: escritorio con ancho útil y distribución apropiada, móvil compacto, misma jerarquía en claro y oscuro, estados vacíos/errores/foco visibles y funciones aprobadas conservadas.

## Reproducción

- Prueba principal: `TEMA_OUTPUT_DIR=/tmp/haiku-auditoria node tests/auditoria-temas-20261110.cjs` (requiere Playwright/Chromium).
- Instrumentación auxiliar: `AUDIT_OUTPUT_DIR=/tmp/haiku-recorrido node --require ./tests/auditoria-temas-hook-20261110.cjs tests/<recorrido>-browser-check.cjs`.
- [Ejecución principal completada](https://github.com/chinchoncarrasco-cpu/Proyecto-H/actions/runs/42925929851).
- [Ejecución de recorridos complementarios](https://github.com/chinchoncarrasco-cpu/Proyecto-H/actions/runs/42925562561). Su primer trabajo principal falló por un fixture desactualizado de `URLSearchParams`; fue corregido exclusivamente en la instrumentación y repetido con éxito en la ejecución anterior.
- Las capturas están en los artefactos de esas ejecuciones, con retención de tres días. Este informe conserva los hallazgos, fuentes y alcance de la revisión.
