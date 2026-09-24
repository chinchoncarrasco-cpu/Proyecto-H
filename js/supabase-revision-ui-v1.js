// ========================================
// HAIKU · REVISIÓN DE CABAÑAS · UI V1
// Copiar / pegar detalles + feedback visual.
// ========================================

(() => {
    "use strict";

    let toastTimer = null;

    function obtenerTextarea() {
        return document.getElementById("revision-detalles");
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
        if (
            navigator.clipboard &&
            typeof navigator.clipboard.writeText === "function"
        ) {
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

        // El puente Supabase escucha input para guardar observaciones.
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }

    async function leerPortapapeles() {
        if (
            navigator.clipboard &&
            typeof navigator.clipboard.readText === "function"
        ) {
            return await navigator.clipboard.readText();
        }

        throw new Error("clipboard_read_no_disponible");
    }

    async function manejarCopiar(boton) {
        const textarea = obtenerTextarea();

        if (!textarea) {
            mostrarToast("No encontré el campo Detalles.");
            return;
        }

        const texto = textarea.value || "";

        if (!texto.trim()) {
            mostrarToast("No hay detalles para copiar.");
            textarea.focus();
            return;
        }

        try {
            await copiarTexto(texto);
            marcarExito(boton, "Copiado");
            mostrarToast("Detalles copiados al portapapeles.");
        } catch (error) {
            console.warn("HAIKU · No fue posible copiar detalles:", error);
            mostrarToast("No fue posible copiar automáticamente.");
        }
    }

    async function manejarPegar(boton) {
        const textarea = obtenerTextarea();

        if (!textarea) {
            mostrarToast("No encontré el campo Detalles.");
            return;
        }

        let texto = "";

        try {
            texto = await leerPortapapeles();
        } catch (error) {
            // Algunos navegadores móviles bloquean navigator.clipboard.readText.
            // El prompt mantiene la función usable bajo un gesto explícito.
            const manual = window.prompt(
                "Tu navegador no permitió leer el portapapeles automáticamente. Pega aquí el texto y presiona Aceptar:",
                ""
            );

            if (manual === null) {
                return;
            }

            texto = manual;
        }

        if (!texto) {
            mostrarToast("El portapapeles está vacío.");
            textarea.focus();
            return;
        }

        insertarTextoEnCursor(textarea, texto);
        marcarExito(boton, "Pegado");
        mostrarToast("Texto pegado y guardándose en la revisión.");
    }

    function prepararBotones() {
        const textarea = obtenerTextarea();
        const copiar = document.getElementById("copiar-detalles");

        if (!textarea || !copiar) {
            return;
        }

        if (copiar.dataset.haikuClipboardV1 === "1") {
            return;
        }

        copiar.dataset.haikuClipboardV1 = "1";
        copiar.classList.add("revision-clipboard-btn");
        copiar.title = "Copiar detalles";
        copiar.setAttribute("aria-label", "Copiar detalles");
        copiar.innerHTML = '<span aria-hidden="true">⧉</span><span>Copiar</span>';

        let pegar = document.getElementById("pegar-detalles");

        if (!pegar) {
            pegar = document.createElement("button");
            pegar.type = "button";
            pegar.id = "pegar-detalles";
            pegar.className = "revision-clipboard-btn";
            pegar.title = "Pegar detalles";
            pegar.setAttribute("aria-label", "Pegar detalles");
            pegar.innerHTML = '<span aria-hidden="true">↧</span><span>Pegar</span>';
        }

        let acciones = copiar.closest(".revision-clipboard-acciones");

        if (!acciones) {
            acciones = document.createElement("div");
            acciones.className = "revision-clipboard-acciones";

            const padre = copiar.parentElement;

            if (!padre) {
                return;
            }

            padre.insertBefore(acciones, copiar);
            acciones.appendChild(copiar);
        }

        if (!acciones.contains(pegar)) {
            acciones.appendChild(pegar);
        }

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

    // ========================================
    // NAVEGACIÓN LISTADO ↔ REVISIÓN INDIVIDUAL
    // ========================================
    // La capa moderna usa display:grid !important para el listado.
    // El legacy lo oculta con style.display='none'; por eso debemos
    // elevar ese ocultamiento a !important sólo mientras la revisión
    // individual está activa.
    function sincronizarVistaRevision() {
        const lista = document.querySelector(".lista-revision-cabanas");
        const revision = document.getElementById("revision-individual");

        if (!lista || !revision) {
            return;
        }

        if (revision.classList.contains("activa")) {
            lista.style.setProperty("display", "none", "important");
        } else {
            lista.style.removeProperty("display");
        }
    }

    function prepararNavegacion() {
        const revision = document.getElementById("revision-individual");

        if (!revision || revision.dataset.haikuNavV1 === "1") {
            sincronizarVistaRevision();
            return;
        }

        revision.dataset.haikuNavV1 = "1";

        // Observar el estado real que ya maneja el código legacy.
        if (typeof MutationObserver === "function") {
            const observerRevision = new MutationObserver(() => {
                sincronizarVistaRevision();
            });

            observerRevision.observe(revision, {
                attributes: true,
                attributeFilter: ["class"]
            });
        }

        // Refuerzo después de los clics legacy, por compatibilidad móvil.
        document.addEventListener("click", evento => {
            const abre = evento.target.closest(".cabana-revision[data-revision-cabana]");
            const vuelve = evento.target.closest("#volver-cabanas");

            if (!abre && !vuelve) {
                return;
            }

            setTimeout(() => {
                sincronizarVistaRevision();

                if (abre) {
                    const seccion = document.getElementById("seccion-cabanas");
                    if (seccion) {
                        seccion.scrollIntoView({ block: "start" });
                    }
                }
            }, 0);
        });

        sincronizarVistaRevision();
    }

    function iniciar() {
        prepararBotones();
        prepararNavegacion();

        // La revisión individual ya existe en el DOM, pero dejamos observador
        // por compatibilidad con futuros renders dinámicos.
        const seccion = document.getElementById("seccion-cabanas");

        if (seccion && typeof MutationObserver === "function") {
            const observer = new MutationObserver(() => {
                prepararBotones();
                sincronizarVistaRevision();
            });

            observer.observe(seccion, {
                childList: true,
                subtree: true
            });
        }

        window.HAIKU_REVISION_UI_V1 = Object.freeze({
            prepararBotones,
            prepararNavegacion,
            sincronizarVistaRevision,
            copiar: () => manejarCopiar(document.getElementById("copiar-detalles")),
            pegar: () => manejarPegar(document.getElementById("pegar-detalles"))
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    } else {
        iniciar();
    }
})();
