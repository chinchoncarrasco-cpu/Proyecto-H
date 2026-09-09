// ========================================
// HAKU · HISTORIAL LOCAL DE CHAT V1
// Conserva el historial visible de Haku al recargar (F5) dentro de la misma
// sesión/pestaña del navegador.
//
// Seguridad / alcance:
// - Usa sessionStorage; no escribe en Supabase.
// - No usa MutationObserver, polling ni intervalos.
// - Guarda al ocultar/recargar/cerrar el panel.
// - Las vistas previas restauradas son SOLO HISTORIAL: sus botones quedan
//   deshabilitados para impedir ejecutar operaciones antiguas.
// - No persiste blobs/imágenes adjuntas; el texto del mensaje sí permanece.
// - "Borrar historial" limpia sólo esta conversación local de Haku. No toca
//   reservas, pagos, auditoría ni el Historial operativo de Proyecto H.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_HISTORIAL_V1) return;

    const mensajes = document.getElementById("haiku-asistente-mensajes");
    const cerrar = document.getElementById("haiku-asistente-cerrar");
    const boton = document.getElementById("haiku-asistente-boton");

    if (!mensajes) {
        console.info("HAKU · Historial V1 no se instaló: panel de mensajes no disponible.");
        return;
    }

    const VERSION = 1;
    const MAX_ITEMS = 120;
    const MAX_CHARS = 900000;
    const CLAVE = `haiku_asistente_historial_v1::${location.pathname}`;
    // Al instalarse, el panel contiene el saludo limpio de Haku, antes de restaurar
    // cualquier conversación previa. Ese estado se reutiliza al borrar el chat.
    const HTML_INICIAL = mensajes.innerHTML;

    // Estos dos parches son puramente de interfaz. Se cargan desde aquí porque
    // el módulo de historial ya está presente siempre que Haku conserva el chat:
    // 1) vuelve a aplicar el diseño a tarjetas restauradas (el sanitizador elimina <style>);
    // 2) reactiva el botón si una confirmación del Libro se cancela o el navegador la descarta.
    function cargarParche(nombre) {
        const id = `haiku-carga-${nombre}`;
        if (document.getElementById(id)) return;
        const script = document.createElement("script");
        script.id = id;
        script.src = `js/${nombre}.js?v=${Date.now()}`;
        script.async = false;
        script.onerror = () => console.warn(`HAKU · No pude cargar ${nombre}.`);
        document.head.appendChild(script);
    }

    cargarParche("haiku-libro-historial-ui-fix-v1");
    cargarParche("haiku-libro-confirm-cancel-fix-v1");

    function asegurarEstilosBorrar() {
        if (document.getElementById("haiku-historial-borrar-v1-css")) return;
        const style = document.createElement("style");
        style.id = "haiku-historial-borrar-v1-css";
        style.textContent = `
            .haiku-asistente-cabecera-acciones {
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 0 0 auto;
            }
            .haiku-asistente-borrar-historial {
                min-height: 31px;
                padding: 6px 9px;
                border: 1px solid #d9e0dc;
                border-radius: 9px;
                background: #fff;
                color: #6b5149;
                cursor: pointer;
                font: inherit;
                font-size: .65rem;
                font-weight: 750;
                white-space: nowrap;
            }
            .haiku-asistente-borrar-historial:hover {
                border-color: #d7b9af;
                background: #fff8f6;
                color: #8a4638;
            }
            .haiku-asistente-borrar-historial:focus-visible {
                outline: 3px solid rgba(138, 70, 56, .16);
                outline-offset: 2px;
            }
            @media (max-width: 480px) {
                .haiku-asistente-borrar-historial {
                    max-width: 82px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function quitarAtributosPeligrosos(elemento) {
        [...elemento.attributes].forEach(attr => {
            const nombre = String(attr.name || "").toLowerCase();
            if (nombre.startsWith("on") || nombre === "srcdoc" || nombre === "formaction") {
                elemento.removeAttribute(attr.name);
            }
        });
    }

    function convertirEnHistorial(contenedor) {
        contenedor.querySelectorAll("script,style,iframe,object,embed,input,textarea,select").forEach(n => n.remove());

        contenedor.querySelectorAll("*").forEach(elemento => {
            quitarAtributosPeligrosos(elemento);
            elemento.removeAttribute("id");
            elemento.removeAttribute("contenteditable");

            if (elemento instanceof HTMLImageElement) {
                const src = String(elemento.getAttribute("src") || "");
                if (/^(?:blob:|data:)/i.test(src)) elemento.remove();
            }
        });

        contenedor.querySelectorAll("button").forEach(btn => {
            btn.disabled = true;
            btn.setAttribute("aria-disabled", "true");
            btn.removeAttribute("name");
        });

        contenedor.querySelectorAll(".haiku-asistente-preview").forEach(card => {
            card.dataset.haikuHistorialRestaurado = "1";

            const marca = card.querySelector(".haiku-asistente-preview-cabecera span");
            const textoMarca = String(marca?.textContent || "");
            const creada = /CREAD|GUARDAD|CONFIRMAD/i.test(textoMarca) ||
                card.dataset.haikuReservaCreada === "1" ||
                card.dataset.haikuLoteCreado === "1";

            if (!creada) {
                if (marca) marca.textContent = "VISTA PREVIA ANTERIOR · SOLO HISTORIAL";
                const botonAccion = card.querySelector(".haiku-asistente-preview-pie button");
                if (botonAccion) botonAccion.textContent = "Vista previa anterior";
            }
        });

        return contenedor;
    }

    function clonarSeguro() {
        const copia = mensajes.cloneNode(true);
        copia.removeAttribute("id");
        convertirEnHistorial(copia);

        while (copia.children.length > MAX_ITEMS) {
            copia.firstElementChild?.remove();
        }

        let html = copia.innerHTML;
        while (html.length > MAX_CHARS && copia.children.length > 1) {
            copia.firstElementChild?.remove();
            html = copia.innerHTML;
        }

        return html;
    }

    function guardar() {
        try {
            const html = clonarSeguro();
            if (!html.trim()) return;
            sessionStorage.setItem(CLAVE, JSON.stringify({
                version: VERSION,
                guardado_en: new Date().toISOString(),
                html
            }));
        } catch (error) {
            console.warn("HAKU · No pude conservar el historial local:", error);
        }
    }

    function fragmentoSeguroDesdeHtml(html) {
        const template = document.createElement("template");
        template.innerHTML = String(html || "");
        convertirEnHistorial(template.content);
        return template.content;
    }

    function restaurar() {
        let registro = null;
        try {
            const crudo = sessionStorage.getItem(CLAVE);
            if (!crudo) return false;
            registro = JSON.parse(crudo);
        } catch {
            return false;
        }

        if (!registro || registro.version !== VERSION || !registro.html) return false;

        try {
            const fragmento = fragmentoSeguroDesdeHtml(registro.html);
            if (!fragmento.childNodes.length) return false;

            mensajes.replaceChildren(fragmento);
            mensajes.dataset.haikuHistorialRestaurado = "1";
            requestAnimationFrame(() => {
                mensajes.scrollTop = mensajes.scrollHeight;
            });
            return true;
        } catch (error) {
            console.warn("HAKU · No pude restaurar el historial local:", error);
            return false;
        }
    }

    function borrar({ confirmar = true } = {}) {
        if (window.HAIKU_ASISTENTE?.procesando?.()) {
            window.alert("Haku todavía está procesando una solicitud. Espera a que termine antes de borrar la conversación.");
            return false;
        }

        if (confirmar) {
            const aceptado = window.confirm(
                "¿Borrar el historial de esta conversación con Haku?\n\n" +
                "Esto sólo limpia los mensajes de este chat en esta pestaña. No borra reservas, pagos, servicios ni el Historial operativo de Proyecto H."
            );
            if (!aceptado) return false;
        }

        try {
            sessionStorage.removeItem(CLAVE);
        } catch (error) {
            console.warn("HAKU · No pude quitar el historial de sessionStorage:", error);
        }

        mensajes.innerHTML = HTML_INICIAL;
        delete mensajes.dataset.haikuHistorialRestaurado;
        mensajes.scrollTop = 0;
        return true;
    }

    function instalarBotonBorrar() {
        if (!cerrar || document.getElementById("haiku-asistente-borrar-historial")) return;
        asegurarEstilosBorrar();

        const cabecera = cerrar.closest(".haiku-asistente-cabecera");
        if (!cabecera) return;

        let acciones = cabecera.querySelector(".haiku-asistente-cabecera-acciones");
        if (!acciones) {
            acciones = document.createElement("div");
            acciones.className = "haiku-asistente-cabecera-acciones";
            cabecera.insertBefore(acciones, cerrar);
            acciones.appendChild(cerrar);
        }

        const borrarBtn = document.createElement("button");
        borrarBtn.type = "button";
        borrarBtn.id = "haiku-asistente-borrar-historial";
        borrarBtn.className = "haiku-asistente-borrar-historial";
        borrarBtn.textContent = "Borrar historial";
        borrarBtn.title = "Borrar sólo la conversación local de Haku";
        borrarBtn.setAttribute("aria-label", "Borrar historial de conversación de Haku");
        borrarBtn.addEventListener("click", () => borrar({ confirmar: true }));
        acciones.insertBefore(borrarBtn, cerrar);
    }

    const restaurado = restaurar();
    instalarBotonBorrar();

    // Eventos naturales del navegador: sin observers ni temporizadores.
    window.addEventListener("pagehide", guardar);
    window.addEventListener("beforeunload", guardar);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") guardar();
    });
    cerrar?.addEventListener("click", guardar);
    boton?.addEventListener("click", () => {
        if (!document.getElementById("haiku-asistente-panel")?.hidden) return;
        guardar();
    });

    window.HAIKU_ASISTENTE_HISTORIAL_V1 = Object.freeze({
        guardar,
        restaurar,
        borrar,
        clave: CLAVE,
        restaurado
    });

    console.info(`HAKU · Historial local V1 preparado${restaurado ? " y restaurado" : ""}.`);
})();
