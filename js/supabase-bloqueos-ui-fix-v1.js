// ========================================
// HAIKU · BLOQUEOS UI FIX V2
// Sólo mantiene la interacción de las barras de bloqueo del Calendario.
//
// Importante:
// - NO modifica estado, titular ni color del Resumen.
// - NO usa MutationObserver global.
// - NO usa polling ni setInterval.
// - El estado visual del Resumen queda en Operación Resumen Fix V4.
// ========================================
(() => {
    "use strict";

    function datosLegacy() {
        try {
            return JSON.parse(localStorage.getItem("haikuDatos") || "{}") || {};
        } catch (_) {
            return {};
        }
    }

    function idDesdeBarra(barra) {
        if (!barra) return "";

        const reservaId = String(barra.dataset?.reservaId || "");
        const match = reservaId.match(/BLQ-SB-([0-9a-f-]{36})/i);
        if (match?.[1]) return match[1];

        const numero = String(barra.dataset?.cabana || "");
        if (!numero) return "";

        // El bloqueo es metadata independiente del estado operativo visible.
        // No exigimos cabana.estado === "bloqueada" para encontrarlo.
        const datos = datosLegacy();
        for (const dia of Object.values(datos)) {
            const cabana = dia?.cabanas?.[numero];
            const id = String(cabana?.bloqueoSupabaseId || "");
            if (id) return id;
        }

        return "";
    }

    function etiquetarBarras() {
        document
            .querySelectorAll(".calendario-bloqueo-barra")
            .forEach(barra => {
                barra.setAttribute("aria-label", "Abrir opciones del bloqueo");
            });
    }

    function interceptarClickBloqueo(evento) {
        const barra = evento.target?.closest?.(".calendario-bloqueo-barra");
        if (!barra) return;

        const id = idDesdeBarra(barra);
        if (!id) return;

        const api = window.HAIKU_BLOQUEOS_CALENDARIO_SUPABASE_V1;
        if (!api?.liberar) return;

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();

        api.liberar(id);
    }

    function instalar() {
        if (document.documentElement.dataset.haikuBloqueosUiFixV2 === "1") {
            etiquetarBarras();
            return;
        }

        document.documentElement.dataset.haikuBloqueosUiFixV2 = "1";

        const style = document.createElement("style");
        style.id = "haiku-bloqueos-ui-fix-v2-style";
        style.textContent = `
            #seccion-calendario .calendario-bloqueo-barra {
                pointer-events: auto !important;
                cursor: pointer !important;
                z-index: 25 !important;
                touch-action: manipulation;
            }
        `;
        document.head.appendChild(style);

        // Delegación de click: funciona también si generarCalendario recrea la barra.
        document.addEventListener("click", interceptarClickBloqueo, true);

        document.addEventListener("click", evento => {
            if (
                evento.target?.closest?.('[data-seccion="calendario"]') ||
                evento.target?.closest?.("#mes-anterior") ||
                evento.target?.closest?.("#mes-siguiente") ||
                evento.target?.closest?.(".dia-calendario")
            ) {
                requestAnimationFrame(etiquetarBarras);
            }
        });

        window.addEventListener("haiku:auth-ready", () => {
            requestAnimationFrame(etiquetarBarras);
        });

        window.addEventListener("pageshow", () => {
            requestAnimationFrame(etiquetarBarras);
        });

        etiquetarBarras();
        console.info("HAIKU · Bloqueos UI Fix V2 preparado sin observer global.");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", instalar, { once: true });
    } else {
        instalar();
    }
})();