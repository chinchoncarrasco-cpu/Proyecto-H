// ========================================
// HAKU · LIBRO · SELECCIÓN DE PAGOS V1
// Conserva durante la sesión actual los pagos que el usuario desmarcó.
// Si Haku revalida/reconstruye el plan (por ejemplo al aprobar otro pago),
// vuelve a desmarcar el mismo movimiento antes de la confirmación final.
// No escribe en Supabase ni cambia el matching del Libro.
// ========================================
(function (root) {
    "use strict";
    if (!root.document) return;

    const OMITIDOS = new Set();
    let programado = false;
    let aplicando = false;

    function asegurarEstadoConfirmacion() {
        if (document.getElementById("haiku-libro-confirmacion-estado-v1-script")) return;
        const script = document.createElement("script");
        script.id = "haiku-libro-confirmacion-estado-v1-script";
        script.src = "js/haiku-libro-confirmacion-estado-v1.js?v=1";
        script.defer = true;
        document.head.appendChild(script);
    }

    function normalizar(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function esTarjetaPago(card) {
        return card?.matches?.(".haiku-incorporacion-item--pagos, .haiku-incorporacion-item--dudosos");
    }

    function checkbox(card) {
        return card?.querySelector?.('.haiku-incorporacion-seleccion input[type="checkbox"]') || null;
    }

    function clave(card) {
        if (!esTarjetaPago(card)) return "";
        const titular = card.querySelector(".haiku-incorporacion-identidad > strong")?.textContent || "";
        const resumen = card.querySelector(".haiku-incorporacion-identidad > small")?.textContent || "";
        const datos = Array.from(card.querySelectorAll(".haiku-incorporacion-meta-item .haiku-incorporacion-dato"))
            .map(dato => {
                const etiqueta = dato.querySelector("span")?.textContent || "";
                const valor = dato.querySelector("strong")?.textContent || "";
                return `${normalizar(etiqueta)}=${normalizar(valor)}`;
            })
            .filter(Boolean)
            .join("|");
        if (!datos) return ""; // Esperar a que la UI de pagos termine de enriquecer la tarjeta.
        return [normalizar(titular), normalizar(resumen), datos].join("||");
    }

    function marcarEstadoVisual(card, check) {
        const omitido = Boolean(check && !check.checked && !check.disabled);
        card?.classList?.toggle("haiku-pago-omitido-sesion", omitido);
        const estado = card?.querySelector?.(".haiku-incorporacion-estado");
        if (!estado) return;
        if (!estado.dataset.haikuEstadoOriginal) estado.dataset.haikuEstadoOriginal = estado.textContent || "";
        const textoDeseado = omitido ? "No se incorporará" : estado.dataset.haikuEstadoOriginal;
        // No reescribir el mismo textContent: hacerlo dispara childList y puede
        // alimentar al MutationObserver indefinidamente cuando hay muchos pagos.
        if (estado.textContent !== textoDeseado) estado.textContent = textoDeseado;
    }

    function restaurar() {
        if (aplicando) return;
        aplicando = true;
        try {
            const cards = document.querySelectorAll(
                ".haiku-asistente-preview.haiku-incorporacion .haiku-incorporacion-item--pagos," +
                ".haiku-asistente-preview.haiku-incorporacion .haiku-incorporacion-item--dudosos"
            );
            cards.forEach(card => {
                const check = checkbox(card);
                if (!check) return;
                const key = clave(card);
                if (key) card.dataset.haikuPagoSeleccionKey = key;
                if (key && OMITIDOS.has(key) && !check.disabled && check.checked) {
                    check.checked = false;
                    // El listener del plan de incorporación actualiza item.seleccionado
                    // y recalcula el contador/botón final.
                    check.dispatchEvent(new Event("change", { bubbles: true }));
                }
                marcarEstadoVisual(card, check);
            });
        } finally {
            aplicando = false;
        }
    }

    function programar() {
        if (programado) return;
        programado = true;
        requestAnimationFrame(() => {
            programado = false;
            restaurar();
        });
    }

    document.addEventListener("change", event => {
        const check = event.target?.matches?.(
            '.haiku-incorporacion-item--pagos .haiku-incorporacion-seleccion input[type="checkbox"], ' +
            '.haiku-incorporacion-item--dudosos .haiku-incorporacion-seleccion input[type="checkbox"]'
        ) ? event.target : null;
        if (!check || aplicando) return;
        const card = check.closest(".haiku-incorporacion-item");
        const key = card?.dataset.haikuPagoSeleccionKey || clave(card);
        if (!key) {
            programar();
            return;
        }
        card.dataset.haikuPagoSeleccionKey = key;
        if (check.checked) OMITIDOS.delete(key);
        else OMITIDOS.add(key);
        marcarEstadoVisual(card, check);
    }, true);

    function nodoAgregaTarjetaPago(nodo) {
        if (!(nodo instanceof Element)) return false;
        const selector = ".haiku-incorporacion-item--pagos, .haiku-incorporacion-item--dudosos";
        return nodo.matches?.(selector) || Boolean(nodo.querySelector?.(selector));
    }

    // Aprobar/revalidar un pago reconstruye el DOM. Sólo reaccionamos cuando
    // aparecen tarjetas de pago reales; cambios de texto/estado no deben volver
    // a programar otra pasada.
    const observer = new MutationObserver(mutations => {
        if (mutations.some(m => Array.from(m.addedNodes || []).some(nodoAgregaTarjetaPago))) programar();
    });

    function iniciar() {
        observer.observe(document.body, { childList: true, subtree: true });
        programar();
    }

    root.addEventListener("haiku:libro-cambio", () => {
        OMITIDOS.clear();
        document.querySelectorAll(".haiku-pago-omitido-sesion").forEach(el => el.classList.remove("haiku-pago-omitido-sesion"));
    });

    asegurarEstadoConfirmacion();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    else iniciar();
})(typeof window !== "undefined" ? window : globalThis);
