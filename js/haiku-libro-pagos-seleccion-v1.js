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

    const TARJETA_PAGO = ".haiku-asistente-preview.haiku-incorporacion " +
        ":is(.haiku-incorporacion-item--pagos, .haiku-incorporacion-item--dudosos)";
    const OMITIDOS = new Set();
    const pendientes = new Set();
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

    function checkbox(card) {
        return card?.querySelector?.('.haiku-incorporacion-seleccion input[type="checkbox"]') || null;
    }

    function clave(card) {
        if (!card?.matches(TARJETA_PAGO)) return "";
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
        aplicando = true;
        try {
            for (const card of pendientes) {
                if (!card.isConnected) continue;
                const check = checkbox(card);
                if (!check) continue;
                const key = clave(card);
                if (key) card.dataset.haikuPagoSeleccionKey = key;
                if (key && OMITIDOS.has(key) && !check.disabled && check.checked) {
                    check.checked = false;
                    // El listener del plan de incorporación actualiza item.seleccionado
                    // y recalcula el contador/botón final.
                    check.dispatchEvent(new Event("change", { bubbles: true }));
                }
                marcarEstadoVisual(card, check);
            }
        } finally {
            pendientes.clear();
            aplicando = false;
        }
    }

    function programar() {
        if (programado || !pendientes.size) return;
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
        if (!key) return;
        card.dataset.haikuPagoSeleccionKey = key;
        if (check.checked) OMITIDOS.delete(key);
        else OMITIDOS.add(key);
        marcarEstadoVisual(card, check);
    }, true);

    function recogerTarjetas(nodo) {
        if (nodo.nodeType !== 1) return;
        if (nodo.matches(TARJETA_PAGO)) pendientes.add(nodo);
        if (nodo.childElementCount) nodo.querySelectorAll(TARJETA_PAGO).forEach(card => pendientes.add(card));
    }

    function iniciar() {
        const area = document.getElementById("haiku-asistente-mensajes") || document.body;
        const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (m.type === "attributes" && m.target.matches(TARJETA_PAGO)) pendientes.add(m.target);
                else m.addedNodes.forEach(recogerTarjetas);
            }
            programar();
        });
        observer.observe(area, {
            childList: true, subtree: true, attributes: true, attributeFilter: ["data-haiku-pago-ui-v1"]
        });
        recogerTarjetas(area);
        programar();
        root.addEventListener("haiku:libro-cambio", () => {
            OMITIDOS.clear();
            area.querySelectorAll(".haiku-pago-omitido-sesion").forEach(el => el.classList.remove("haiku-pago-omitido-sesion"));
        });
    }

    asegurarEstadoConfirmacion();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    else iniciar();
})(typeof window !== "undefined" ? window : globalThis);
