// ========================================
// HAIKU · FECHA OPERATIVA EN CABECERAS
// ========================================

(function sincronizarFechaOperativaEnCabeceras() {
    "use strict";

    const fechaResumen = document.getElementById("fecha-actual");
    if (!fechaResumen) return;

    function actualizarCabeceras() {
        const textoFecha = String(fechaResumen.textContent || "").trim();
        if (!textoFecha) return;

        document
            .querySelectorAll(".seccion-app > .cabecera")
            .forEach(cabecera => {
                // Resumen es la fuente de verdad de la fecha seleccionada.
                if (cabecera.closest("#seccion-resumen")) return;

                const titulo = cabecera.querySelector("h1, h2");
                if (!titulo) return;

                let fecha = cabecera.querySelector(".fecha-seccion-actual");

                if (!fecha) {
                    fecha = document.createElement("p");
                    fecha.className = "texto-secundario fecha-seccion-actual";
                    titulo.insertAdjacentElement("afterend", fecha);
                }

                fecha.textContent = textoFecha;
            });
    }

    // Estado inicial: replica la fecha que ya muestra Resumen.
    actualizarCabeceras();

    // Cuando el calendario cambia la fecha de Resumen, propagamos exactamente
    // esa misma fecha al resto de las secciones sin volver a calcular "hoy".
    const observador = new MutationObserver(actualizarCabeceras);
    observador.observe(fechaResumen, {
        childList: true,
        subtree: true,
        characterData: true
    });

    // Refuerzo al navegar: la fecha elegida no cambia por moverse de sección.
    document.addEventListener("click", evento => {
        if (!evento.target.closest?.(".menu-item[data-seccion]")) return;
        requestAnimationFrame(actualizarCabeceras);
    });

    window.HAIKU_FECHA_OPERATIVA_V1 = {
        actualizar: actualizarCabeceras
    };
})();

// Carga aislada del Libro online sin tocar el cargador principal.
(() => {
    "use strict";

    if (document.querySelector('script[data-haiku-libro-google-v1]')) return;

    const script = document.createElement("script");
    script.src = `js/supabase-libro-google-readonly-v1.js?v=${Date.now()}`;
    script.async = true;
    script.dataset.haikuLibroGoogleV1 = "1";
    document.head.appendChild(script);
})();

// Fix visual aislado: evita que las miniaturas adjuntas de Haku se compriman.
(() => {
    "use strict";

    if (document.querySelector('link[data-haiku-asistente-adjuntos-fix-v1]')) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `css/supabase-asistente-adjuntos-fix-v1.css?v=${Date.now()}`;
    link.dataset.haikuAsistenteAdjuntosFixV1 = "1";
    document.head.appendChild(link);
})();
