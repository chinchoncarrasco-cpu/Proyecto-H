// HAKU · recuperación segura al cancelar confirmación de servicios/notas
// El flujo V2 deshabilita el botón antes de abrir confirm(). Si el navegador
// interpreta un cambio de pestaña como Cancelar, la operación no se ejecuta,
// pero el botón podía quedar deshabilitado. Este parche sólo reactiva ese botón
// cuando la confirmación específica de importación devuelve false.
(function (root) {
    "use strict";
    if (!root.document || root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V1) return;

    const confirmarNativo = root.confirm.bind(root);

    function esConfirmacionLibro(texto) {
        const t = String(texto || "");
        return /^Se incorporarán\s+\d+\s+servicio(?:s)?\s+y\s+\d+\s+nota(?:s)?\s+desde el Libro\./i.test(t)
            && /operación será atómica/i.test(t);
    }

    function reactivarBotonLibro() {
        queueMicrotask(() => {
            document.querySelectorAll(".haku-libro-servicios__boton").forEach(boton => {
                if (!boton.isConnected) return;
                const card = boton.closest(".haku-libro-servicios");
                if (!card || /Incorporación completada/i.test(card.textContent || "")) return;
                const seleccionados = card.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)').length;
                boton.disabled = seleccionados === 0;
            });
        });
    }

    root.confirm = function (mensaje) {
        const resultado = confirmarNativo(mensaje);
        if (!resultado && esConfirmacionLibro(mensaje)) reactivarBotonLibro();
        return resultado;
    };

    root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V1 = Object.freeze({
        version: "1.0.0",
        reactivar: reactivarBotonLibro
    });
})(typeof window !== "undefined" ? window : globalThis);
