// ========================================
// HAIKU · ASEO EXPRESS · UI V1
// Copiar / pegar detalles + feedback visual.
// ========================================

(() => {
    "use strict";

    let toastTimer = null;

    function obtenerTextarea() {
        return document.getElementById("aseo-express-detalles");
    }

    function mostrarToast(mensaje) {
        let toast = document.querySelector(".haiku-revision-toast");

        if (!toast) {
            toast = document.createElement("div");
            toast.className = "haiku-revision-toast";
            toast.setAttribute("role", "status");
            toast.setAttribute("aria-live", "polite");
            document.body.appendChild(toast);
        }

        toast.textContent = mensaje;
        toast.classList.add("activo");

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove("activo");
        }, 1800);
    }

    function marcarExito(boton, textoTemporal) {
        if (!boton) return;

        const original = boton.innerHTML;
        boton.classList.add("revision-clipboard-ok");
        boton.innerHTML = `<span aria-hidden="true">✓</span><span>${textoTemporal}</span>`;

        setTimeout(() => {
            boton.classList.remove("revision-clipboard-ok");
            boton.innerHTML = original;
        }, 1200);
    }

    async function copiarTexto(texto) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(texto);
            return;
        }

        const auxiliar = document.createElement("textarea");
        auxiliar.value = texto;
        auxiliar.setAttribute("readonly", "");
        auxiliar.style.position = "fixed";
        auxiliar.style.opacity = "0";
        auxiliar.style.pointerEvents = "none";
        document.body.appendChild(auxiliar);
        auxiliar.select();

        const copiado = document.execCommand("copy");
        auxiliar.remove();

        if (!copiado) {
            throw new Error("El navegador no permitió copiar al portapapeles.");
        }
    }

    async function leerPortapapeles() {
        if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
            return await navigator.clipboard.readText();
        }
        throw new Error("clipboard_read_no_disponible");
    }

    function insertarTextoEnCursor(textarea, texto) {
        const inicio = Number.isInteger(textarea.selectionStart)
            ? textarea.selectionStart
            : textarea.value.length;
        const fin = Number.isInteger(textarea.selectionEnd)
            ? textarea.selectionEnd
            : inicio;

        textarea.value =
            textarea.value.slice(0, inicio) +
            texto +
            textarea.value.slice(fin);

        const nuevaPosicion = inicio + texto.length;
        textarea.focus();
        textarea.setSelectionRange(nuevaPosicion, nuevaPosicion);

        // El legacy escucha estos eventos para persistir Detalles.
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }

    async function manejarCopiar(boton) {
        const textarea = obtenerTextarea();
        if (!textarea) return mostrarToast("No encontré el campo Detalles.");

        const texto = textarea.value || "";
        if (!texto.trim()) {
            textarea.focus();
            return mostrarToast("No hay detalles para copiar.");
        }

        try {
            await copiarTexto(texto);
            marcarExito(boton, "Copiado");
            mostrarToast("Detalles copiados al portapapeles.");
        } catch (error) {
            console.warn("HAIKU · No fue posible copiar detalles de Aseo Express:", error);
            mostrarToast("No fue posible copiar automáticamente.");
        }
    }

    async function manejarPegar(boton) {
        const textarea = obtenerTextarea();
        if (!textarea) return mostrarToast("No encontré el campo Detalles.");

        let texto = "";

        try {
            texto = await leerPortapapeles();
        } catch (_) {
            const manual = window.prompt(
                "Tu navegador no permitió leer el portapapeles automáticamente. Pega aquí el texto y presiona Aceptar:",
                ""
            );
            if (manual === null) return;
            texto = manual;
        }

        if (!texto) {
            textarea.focus();
            return mostrarToast("El portapapeles está vacío.");
        }

        insertarTextoEnCursor(textarea, texto);
        marcarExito(boton, "Pegado");
        mostrarToast("Texto pegado en Detalles.");
    }

    function prepararBotones() {
        const textarea = obtenerTextarea();
        const copiar = document.getElementById("copiar-detalles-aseo-express");
        if (!textarea || !copiar) return;

        if (copiar.dataset.haikuAseoExpressClipboardV1 === "1") return;
        copiar.dataset.haikuAseoExpressClipboardV1 = "1";
        copiar.classList.add("aseo-express-clipboard-btn");
        copiar.title = "Copiar detalles";
        copiar.setAttribute("aria-label", "Copiar detalles");
        copiar.innerHTML = '<span aria-hidden="true">⧉</span><span>Copiar</span>';

        let pegar = document.getElementById("pegar-detalles-aseo-express");
        if (!pegar) {
            pegar = document.createElement("button");
            pegar.type = "button";
            pegar.id = "pegar-detalles-aseo-express";
            pegar.className = "aseo-express-clipboard-btn";
            pegar.title = "Pegar detalles";
            pegar.setAttribute("aria-label", "Pegar detalles");
            pegar.innerHTML = '<span aria-hidden="true">↧</span><span>Pegar</span>';
        }

        let acciones = copiar.closest(".aseo-express-clipboard-acciones");
        if (!acciones) {
            acciones = document.createElement("div");
            acciones.className = "aseo-express-clipboard-acciones";
            const padre = copiar.parentElement;
            if (!padre) return;
            padre.insertBefore(acciones, copiar);
            acciones.appendChild(copiar);
        }

        if (!acciones.contains(pegar)) acciones.appendChild(pegar);

        copiar.addEventListener("click", evento => {
            evento.preventDefault();
            evento.stopPropagation();
            manejarCopiar(copiar);
        });

        pegar.addEventListener("click", evento => {
            evento.preventDefault();
            evento.stopPropagation();
            manejarPegar(pegar);
        });
    }

    function iniciar() {
        prepararBotones();

        const seccion = document.getElementById("aseo-express-individual");
        if (seccion && typeof MutationObserver === "function") {
            const observer = new MutationObserver(prepararBotones);
            observer.observe(seccion, { childList: true, subtree: true });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    } else {
        iniciar();
    }
})();
