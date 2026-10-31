// Edición de cuatro dígitos: 1137 confirma 11:37 sin guardar valores intermedios.
(() => {
    "use strict";
    if (window.HAIKU_HORAS_EDICION_V1) return;
    window.HAIKU_HORAS_EDICION_V1 = true;

    const selector = 'input[type="time"].campo-cabana, input[type="time"].aseo-hora-input';
    let edicion = null;
    const estilo = document.createElement("style");
    estilo.textContent = 'input[data-haiku-hora-editando]::-webkit-datetime-edit { opacity: 0; }';
    document.head.append(estilo);

    function campoHora(objetivo) {
        return objetivo?.matches?.(selector) && !objetivo.disabled && !objetivo.readOnly
            ? objetivo : null;
    }

    function limpiar() {
        if (!edicion) return;
        const { input, capa, validacion, ariaInvalid } = edicion;
        edicion = null;
        input.removeAttribute("data-haiku-hora-editando");
        input.setCustomValidity(validacion);
        if (ariaInvalid === null) input.removeAttribute("aria-invalid");
        else input.setAttribute("aria-invalid", ariaInvalid);
        capa.remove();
    }

    function posicionar() {
        if (!edicion) return;
        const { input, capa } = edicion;
        if (!input.isConnected) return limpiar();
        const caja = input.getBoundingClientRect();
        const css = getComputedStyle(input);
        const izquierda = parseFloat(css.paddingLeft) + parseFloat(css.borderLeftWidth);
        Object.assign(capa.style, {
            left: `${caja.left + izquierda}px`, top: `${caja.top}px`,
            height: `${caja.height}px`, maxWidth: `${Math.max(0, caja.width - izquierda - 26)}px`,
            font: css.font, letterSpacing: css.letterSpacing
        });
    }

    function comenzar(input) {
        if (edicion?.input === input) return edicion;
        limpiar();
        const capa = document.createElement("span");
        capa.setAttribute("aria-hidden", "true");
        capa.dataset.haikuHoraBorrador = "";
        Object.assign(capa.style, {
            position: "fixed", display: "flex", alignItems: "center", overflow: "hidden",
            whiteSpace: "nowrap", pointerEvents: "none", zIndex: "2147483647"
        });
        edicion = {
            input, capa, digitos: "", inicial: input.value,
            validacion: input.validity.customError ? input.validationMessage : "",
            ariaInvalid: input.getAttribute("aria-invalid")
        };
        // La capa no mueve ni reemplaza el input enfocado; el reloj sigue siendo nativo.
        document.body.append(capa);
        input.setAttribute("data-haiku-hora-editando", "");
        posicionar();
        return edicion;
    }

    function dibujar(invalido = false) {
        const { input, capa, digitos, validacion } = edicion;
        const visible = digitos.padEnd(4, "_");
        capa.textContent = `${visible.slice(0, 2)}:${visible.slice(2)}`;
        capa.style.color = invalido ? "#d46b6b" : getComputedStyle(input).color;
        input.setCustomValidity(invalido ? "Escribe una hora válida con cuatro dígitos (HHMM)." : validacion);
        if (invalido) input.setAttribute("aria-invalid", "true");
        else if (edicion.ariaInvalid === null) input.removeAttribute("aria-invalid");
        else input.setAttribute("aria-invalid", edicion.ariaInvalid);
        posicionar();
    }

    function confirmar(input, valor) {
        const anterior = input.value;
        if (edicion) input.setCustomValidity(edicion.validacion);
        input.value = valor;
        if (input.value !== valor || !input.validity.valid) {
            input.value = anterior;
            return false;
        }
        limpiar();
        // Los mismos writers validan y guardan una única hora completa.
        if (valor !== anterior) input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }

    function agregar(input, digito) {
        const actual = comenzar(input);
        if (actual.digitos.length === 4) actual.digitos = "";
        actual.digitos += digito;
        dibujar();
        if (actual.digitos.length !== 4) return;
        const valor = `${actual.digitos.slice(0, 2)}:${actual.digitos.slice(2)}`;
        if (!confirmar(input, valor)) dibujar(true);
    }

    document.addEventListener("keydown", evento => {
        const input = campoHora(evento.target);
        if (!input || evento.isComposing || evento.ctrlKey || evento.metaKey || evento.altKey) return;
        if (/^[0-9]$/.test(evento.key)) {
            evento.preventDefault();
            evento.stopImmediatePropagation();
            if (!evento.repeat) agregar(input, evento.key);
        } else if (evento.key === "Backspace" || evento.key === "Delete") {
            evento.preventDefault();
            evento.stopImmediatePropagation();
            if (!edicion) comenzar(input);
            if (evento.key === "Delete" || !edicion.digitos) {
                if (!confirmar(input, "")) dibujar(true);
            } else {
                edicion.digitos = edicion.digitos.slice(0, -1);
                dibujar();
            }
        } else if (edicion?.input === input) {
            if (evento.key === ":" || evento.key.startsWith("Arrow") || evento.key === "Enter") {
                evento.preventDefault();
                if (evento.key === "Enter") dibujar(true);
            } else if (evento.key === "Escape") {
                evento.preventDefault();
                limpiar();
            }
        }
    }, true);

    document.addEventListener("paste", evento => {
        const input = campoHora(evento.target);
        if (!input) return;
        evento.preventDefault();
        evento.stopImmediatePropagation();
        const texto = String(evento.clipboardData?.getData("text/plain") || "").trim();
        comenzar(input).digitos = "";
        if (!/^\d{2}:?\d{2}$/.test(texto)) return dibujar(true);
        for (const digito of texto.replace(":", "")) agregar(input, digito);
    }, true);

    for (const tipo of ["input", "change"]) document.addEventListener(tipo, evento => {
        if (edicion?.input !== evento.target) return;
        evento.target.value = edicion.inicial;
        evento.stopImmediatePropagation();
    }, true);
    document.addEventListener("focusout", evento => {
        if (edicion?.input === evento.target) limpiar();
    }, true);
    document.addEventListener("pointerdown", limpiar, true);
    document.addEventListener("scroll", posicionar, true);
    window.addEventListener("resize", posicionar);
})();
