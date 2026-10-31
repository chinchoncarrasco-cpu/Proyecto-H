// Los horarios con guardado automático se confirman al terminar de editarlos.
(() => {
    "use strict";
    if (window.HAIKU_HORAS_EDICION_V1) return;
    window.HAIKU_HORAS_EDICION_V1 = true;

    const selector = 'input[type="time"].campo-cabana, input[type="time"].aseo-hora-input';
    const ediciones = new WeakMap();

    function campoHora(objetivo) {
        return objetivo?.matches?.(selector) ? objetivo : null;
    }

    document.addEventListener("focusin", evento => {
        const input = campoHora(evento.target);
        if (!input) return;
        const anterior = ediciones.get(input);
        ediciones.set(input, {
            inicial: !input.validity.valid && anterior ? anterior.inicial : input.value,
            cambiado: false,
            activa: true
        });
    }, true);

    function diferirCambio(evento) {
        const input = campoHora(evento.target);
        const edicion = input && ediciones.get(input);
        if (!edicion?.activa) return;
        edicion.cambiado = true;
        // Chromium ya emite change al escribir el primer dígito de los minutos
        // (11:03). Los writers no deben deshabilitar ni repintar ese borrador.
        evento.stopImmediatePropagation();
    }

    document.addEventListener("input", diferirCambio, true);
    document.addEventListener("change", diferirCambio, true);

    document.addEventListener("focusout", evento => {
        const input = campoHora(evento.target);
        const edicion = input && ediciones.get(input);
        if (!edicion?.activa) return;
        edicion.activa = false;
        // Un segmento incompleto tiene value="" y badInput; no equivale a borrar.
        if (!input.validity.valid) return;
        ediciones.delete(input);
        if (!edicion.cambiado || input.value === edicion.inicial) return;
        // Un único change conserva los writers, permisos y validaciones actuales.
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }, true);

    document.addEventListener("keydown", evento => {
        const input = campoHora(evento.target);
        if (!input || evento.key !== "Enter" || evento.isComposing) return;
        evento.preventDefault();
        if (input.validity.valid) input.blur();
    }, true);
})();
