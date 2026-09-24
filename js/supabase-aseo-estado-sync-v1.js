// ========================================
// HAIKU · ASEO -> REVISIÓN SUPABASE SYNC V1
// Reutiliza el puente ya probado de Resumen/Cabañas.
// ========================================

(() => {
    "use strict";

    function apiRevision() {
        return window.HAIKU_REVISION_RESUMEN_SYNC_V2 || null;
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

        aplicarRevisionCabanaVisual(numero, valorRevision);

        try {
            await api.guardarDesdeResumen(
                String(numero),
                valorRevision
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
        const seccion = document.getElementById("seccion-cabanas");
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

                // Aseo Express usa su propia revisión; nunca escribe la
                // revisión completa a través de este puente.
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
