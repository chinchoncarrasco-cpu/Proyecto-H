// ========================================
// HAIKU · SUPABASE · FORMATO VISUAL MONTO
// Mantiene entero limpio para Supabase y muestra miles con puntos.
// ========================================

(() => {
    "use strict";

    function formatear(valor) {
        const numero = Number(valor || 0);
        return numero > 0 ? numero.toLocaleString("es-CL") : "";
    }

    function prepararMonto(raw) {
        if (!raw || raw.dataset.haikuMontoFormateado === "1") return;

        const contenedor = raw.closest(".pago-checkin-input-monto");
        if (!contenedor) return;

        raw.dataset.haikuMontoFormateado = "1";

        const maximo = Number(raw.getAttribute("max") || 0);
        const valorInicial = Number(raw.value || 0);

        // El input original sigue siendo la fuente numérica que lee la lógica V4.
        raw.type = "hidden";
        raw.value = String(valorInicial);

        const visual = document.createElement("input");
        visual.type = "text";
        visual.inputMode = "numeric";
        visual.autocomplete = "off";
        visual.className = "haiku-monto-visual";
        visual.setAttribute("aria-label", "Monto de este pago");
        visual.value = formatear(valorInicial);

        raw.insertAdjacentElement("afterend", visual);

        function sincronizar() {
            const soloDigitos = String(visual.value || "").replace(/\D/g, "");
            let numero = Number(soloDigitos || 0);

            if (maximo > 0 && numero > maximo) numero = maximo;

            raw.value = String(numero);
            visual.value = formatear(numero);

            // Mantiene actualizado el borrador que usa la V4.
            raw.dispatchEvent(new Event("input", { bubbles: true }));
        }

        visual.addEventListener("input", sincronizar);

        visual.addEventListener("focus", () => {
            requestAnimationFrame(() => visual.select());
        });

        visual.addEventListener("blur", () => {
            visual.value = formatear(raw.value);
        });
    }

    function prepararTodos(raiz = document) {
        raiz.querySelectorAll?.(
            '.haiku-saldo-v4 .pago-checkin-input-monto input[data-haiku-saldo-monto]:not([data-haiku-monto-formateado="1"])'
        ).forEach(prepararMonto);
    }

    const observador = new MutationObserver(cambios => {
        for (const cambio of cambios) {
            for (const nodo of cambio.addedNodes) {
                if (!(nodo instanceof Element)) continue;

                if (nodo.matches?.('.haiku-saldo-v4')) prepararTodos(nodo);
                else prepararTodos(nodo);
            }
        }
    });

    function activar() {
        prepararTodos();
        if (document.body) {
            observador.observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", activar, { once: true });
    } else {
        activar();
    }

    setTimeout(prepararTodos, 250);
    window.addEventListener("haiku:auth-ready", () => setTimeout(prepararTodos, 120));
})();

// Carga aislada del sidebar redimensionable en escritorio.
(() => {
    "use strict";

    if (document.querySelector('script[data-haiku-sidebar-resize-v1]')) return;

    const script = document.createElement("script");
    script.src = `js/supabase-sidebar-resize-v1.js?v=${Date.now()}`;
    script.async = true;
    script.dataset.haikuSidebarResizeV1 = "1";
    document.head.appendChild(script);
})();
