// ========================================
// HAIKU · ASEO -> REVISIÓN SUPABASE SYNC V1
// Reutiliza el puente ya probado de Resumen/Cabañas.
// ========================================

(() => {
    "use strict";

    function apiRevision() {
        return window.HAIKU_REVISION_RESUMEN_SYNC_V2 || null;
    }

    function estadoFinalDesdeRevision(valor) {
        if (valor === "lista") return "LISTA";
        if (valor === "con-detalles") return "CON DETALLES";
        return "";
    }

    function aplicarResumenVisual(numero, valorRevision) {
        const fila = document.querySelector(
            `#seccion-resumen .sites-resumen-cabana[data-cabana="${String(numero)}"]`
        );
        const selector = fila?.querySelector('[data-campo="estadoFinal"]');

        if (!selector) return;
        selector.value = estadoFinalDesdeRevision(valorRevision);
        document.dispatchEvent(new CustomEvent("haiku:resumen-datos-actualizados", {
            detail: {
                fecha: typeof fechaSeleccionada === "undefined"
                    ? ""
                    : String(fechaSeleccionada || "").slice(0, 10)
            }
        }));
    }

    function aplicarRevisionCabanaVisual(numero, valorRevision) {
        const numeroAbierto = localStorage.getItem("haikuRevisionCabana") || "";
        if (String(numeroAbierto) !== String(numero)) return;

        const selector = document.getElementById("revision-estado");
        if (selector) selector.value = valorRevision;
    }

    async function guardarDesdeAseo(numero, valorRevision) {
        const api = apiRevision();
        if (!api || !numero) return;

        aplicarResumenVisual(numero, valorRevision);
        aplicarRevisionCabanaVisual(numero, valorRevision);

        try {
            await api.guardarDesdeResumen(
                String(numero),
                estadoFinalDesdeRevision(valorRevision)
            );
            await api.resincronizar?.();
        } catch (error) {
            console.error(
                "HAIKU · No fue posible sincronizar estado desde Aseo:",
                error
            );
            await api.resincronizar?.();
        }
    }

    function instalar() {
        const seccion = document.getElementById("seccion-aseo");
        if (!seccion || seccion.dataset.haikuAseoEstadoSyncV1 === "1") return;

        seccion.dataset.haikuAseoEstadoSyncV1 = "1";

        seccion.addEventListener(
            "change",
            evento => {
                const objetivo = evento.target;

                // Selector de la tarjeta principal de Aseo.
                const selectorAseo = objetivo?.closest?.("[data-estado-revision]");
                if (selectorAseo) {
                    const numero = String(selectorAseo.dataset.estadoRevision || "");
                    const valor = selectorAseo.value || "pendiente";
                    guardarDesdeAseo(numero, valor);
                    return;
                }

                // Selector dentro de Revisión Aseo Express.
                if (objetivo?.id === "aseo-express-estado") {
                    const numero = localStorage.getItem("haikuAseoExpressCabana") || "";
                    const valor = objetivo.value || "pendiente";
                    guardarDesdeAseo(numero, valor);
                }
            },
            true
        );

        console.log("HAIKU · Aseo -> Revisión Supabase Sync V1 activo.");
    }

    function cargarSyncResumenAseo() {
        if (
            window.HAIKU_ASEO_RESUMEN_SYNC_V1 ||
            document.querySelector('script[data-haiku-aseo-resumen-sync-v1]')
        ) {
            return;
        }

        const script = document.createElement("script");
        script.src = `js/supabase-aseo-resumen-sync-v1.js?v=${Date.now()}`;
        script.dataset.haikuAseoResumenSyncV1 = "1";
        script.async = false;
        script.onerror = () => {
            console.error("HAIKU · No fue posible cargar Aseo Resumen Sync V1.");
        };
        document.head.appendChild(script);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            instalar();
            cargarSyncResumenAseo();
        }, { once: true });
    } else {
        instalar();
        cargarSyncResumenAseo();
    }
})();
