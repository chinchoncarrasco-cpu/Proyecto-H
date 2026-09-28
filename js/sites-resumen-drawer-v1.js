// Comportamiento compartido de los drawers reales abiertos desde Resumen.
// La lectura, validación y escritura pertenecen a cada módulo funcional.
(() => {
    "use strict";

    const nota = document.getElementById("panel-agregar-nota");
    const servicio = document.getElementById("resumen-servicio-modal");
    const paneles = [];
    const opciones = new WeakMap();

    const disparadores = new WeakMap();
    const abiertos = new Set();
    let overflowAnterior = "";
    let gestionandoOverflow = false;

    function abierto(panel) {
        return panel === nota ? panel.classList.contains("activo") : !panel.hidden;
    }

    function cerrar(panel) {
        const cierre = opciones.get(panel)?.cerrar;
        if (cierre) {
            cierre();
            return;
        }
        panel.querySelector(panel === nota
            ? "#cerrar-panel-nota" : "#resumen-servicio-cerrar")?.click();
    }

    function elementosFoco(panel) {
        return [...panel.querySelectorAll("button, input, select, textarea, [tabindex]")]
            .filter(elemento => !elemento.disabled && elemento.tabIndex >= 0 &&
                elemento.getClientRects().length > 0);
    }

    function comparteEscritorio(panel) {
        return panel?.hasAttribute?.("data-haiku-inspector-superficie")
            && window.matchMedia?.("(min-width: 901px)").matches;
    }

    function sincronizarBloqueoScroll() {
        if (!abiertos.size) {
            if (gestionandoOverflow) document.body.style.overflow = overflowAnterior;
            gestionandoOverflow = false;
            return;
        }
        const requiereBloqueo = [...abiertos].some(panel => !comparteEscritorio(panel));
        document.body.style.overflow = requiereBloqueo ? "hidden" : overflowAnterior;
    }

    function sincronizar() {
        for (const panel of paneles) {
            const visible = abierto(panel);
            if (visible && !abiertos.has(panel)) {
                if (!abiertos.size) {
                    overflowAnterior = document.body.style.overflow;
                    gestionandoOverflow = true;
                }
                abiertos.add(panel);
                const inicio = opciones.get(panel)?.focoInicial?.() ||
                    (panel === nota ? panel.querySelector("#nota-texto") :
                        panel.querySelector("#resumen-servicio-producto"));
                requestAnimationFrame(() => inicio?.focus());
            } else if (!visible && abiertos.delete(panel)) {
                const disparador = disparadores.get(panel);
                requestAnimationFrame(() => disparador?.isConnected && disparador.focus());
            }
        }
        sincronizarBloqueoScroll();
    }

    document.addEventListener("click", evento => {
        const boton = evento.target.closest?.("[data-agregar-nota-cabana], [data-agregar-servicio]");
        if (!boton) return;
        disparadores.set(boton.hasAttribute("data-agregar-nota-cabana") ? nota : servicio, boton);
        requestAnimationFrame(sincronizar);
    }, true);

    function registrar(panel, configuracion = {}) {
        if (!panel || paneles.includes(panel)) return;
        paneles.push(panel);
        opciones.set(panel, configuracion);
        const observador = new MutationObserver(sincronizar);
        observador.observe(panel, { attributes: true, attributeFilter: ["class", "hidden"] });
        panel.addEventListener("click", evento => {
            if (evento.target === panel && !comparteEscritorio(panel)) cerrar(panel);
        });
        sincronizar();
    }

    for (const panel of [nota, servicio]) registrar(panel);

    document.addEventListener("keydown", evento => {
        const panel = [...paneles].reverse().find(abierto);
        if (!panel) return;
        if (evento.key === "Escape") {
            evento.preventDefault();
            evento.stopImmediatePropagation();
            cerrar(panel);
            return;
        }
        if (evento.key !== "Tab" || comparteEscritorio(panel)) return;
        const elementos = elementosFoco(panel);
        if (!elementos.length) return;
        const primero = elementos[0];
        const ultimo = elementos.at(-1);
        if (evento.shiftKey && (document.activeElement === primero || !panel.contains(document.activeElement))) {
            evento.preventDefault();
            ultimo.focus();
        } else if (!evento.shiftKey && (document.activeElement === ultimo || !panel.contains(document.activeElement))) {
            evento.preventDefault();
            primero.focus();
        }
    }, true);

    window.addEventListener?.("resize", sincronizar, { passive: true });
    window.addEventListener?.("haiku:paneles-estado", sincronizar);

    window.HAIKU_SITES_RESUMEN_DRAWER_V1 = Object.freeze({
        abierto, sincronizar, registrar,
        marcarDisparador(panel, boton) { if (panel && boton) disparadores.set(panel, boton); }
    });
})();
