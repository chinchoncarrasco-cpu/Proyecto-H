// ========================================
// HAKU · BORRADOR PERSISTENTE V1
// Conserva el texto aún no enviado del compositor al recargar (F5)
// dentro de la misma pestaña/sesión del navegador.
// No escribe en Supabase ni guarda adjuntos.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_BORRADOR_V1) return;

    const campo = document.getElementById("haiku-asistente-texto");
    const enviar = document.getElementById("haiku-asistente-enviar");
    if (!campo) return;

    const CLAVE = `haiku_asistente_borrador_v1::${location.pathname}`;

    function guardar() {
        try {
            const texto = String(campo.value || "");
            if (texto) sessionStorage.setItem(CLAVE, texto);
            else sessionStorage.removeItem(CLAVE);
        } catch (error) {
            console.warn("HAKU · No pude guardar el borrador local:", error);
        }
    }

    function limpiar() {
        try {
            sessionStorage.removeItem(CLAVE);
        } catch (error) {
            console.warn("HAKU · No pude limpiar el borrador local:", error);
        }
    }

    function restaurar() {
        try {
            if (campo.value) return false;
            const texto = sessionStorage.getItem(CLAVE);
            if (!texto) return false;

            campo.value = texto;
            // Permite que el asistente recalcule el estado del botón Enviar.
            campo.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
        } catch (error) {
            console.warn("HAKU · No pude restaurar el borrador local:", error);
            return false;
        }
    }

    // Guardado inmediato: si se pulsa F5 mientras se está escribiendo,
    // el último valor ya quedó en sessionStorage.
    campo.addEventListener("input", guardar);

    // Al enviar, el texto deja de ser borrador. El asistente principal ya lo
    // incorpora al historial visible, por lo que no debe reaparecer en el campo.
    enviar?.addEventListener("click", limpiar);
    campo.addEventListener("keydown", evento => {
        if ((evento.ctrlKey || evento.metaKey) && evento.key === "Enter") limpiar();
    });

    // Cobertura adicional para recarga/cierre/navegación.
    window.addEventListener("pagehide", guardar);
    window.addEventListener("beforeunload", guardar);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") guardar();
    });

    const restaurado = restaurar();

    window.HAIKU_ASISTENTE_BORRADOR_V1 = Object.freeze({
        guardar,
        limpiar,
        restaurar,
        clave: CLAVE,
        restaurado
    });

    console.info(`HAKU · Borrador persistente preparado${restaurado ? " y restaurado" : ""}.`);
})();
