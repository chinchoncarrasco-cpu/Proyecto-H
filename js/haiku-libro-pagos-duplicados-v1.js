// ========================================
// HAKU · LIBRO · PRESENTACIÓN DE PAGOS YA EXISTENTES V2
//
// La identidad de un pago se decide exclusivamente en compararSistema().
// Este módulo conserva sólo los estilos de presentación usados por la vista;
// no consulta Supabase, no reclasifica tarjetas y no altera controles.
// ========================================
(function (root) {
    "use strict";
    if (!root.document) return;

    function asegurarCss() {
        if (document.getElementById("haiku-pagos-duplicados-v1-css")) return;
        const style = document.createElement("style");
        style.id = "haiku-pagos-duplicados-v1-css";
        style.textContent = `
            .haiku-incorporacion-item.haiku-pago-ya-existe {
                border-color: #b9d9c7 !important;
                background: #f4faf6 !important;
            }
            .haiku-pago-ya-existe .haiku-incorporacion-estado {
                background: #e3f3e8 !important;
                color: #205c38 !important;
                border-color: #c5e3d0 !important;
                opacity: 1 !important;
            }
            .haiku-pago-ya-existe .haiku-incorporacion-seleccion input[type="checkbox"] {
                opacity: .55 !important;
                cursor: not-allowed;
            }
            .haiku-pago-duplicado-aviso {
                margin: 8px 0 0;
                padding: 8px 10px;
                border: 1px solid #cfe5d7;
                border-radius: 9px;
                background: #edf8f1;
                color: #28553a;
                font-size: .68rem;
                line-height: 1.4;
            }
        `;
        document.head.appendChild(style);
    }

    asegurarCss();
    root.HAIKU_LIBRO_PAGOS_DUPLICADOS_V1 = Object.freeze({
        version: 2,
        autoridad: "compararSistema",
        clasifica: false
    });
})(typeof window !== "undefined" ? window : globalThis);
