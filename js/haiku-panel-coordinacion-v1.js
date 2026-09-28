// HAIKU · INSPECTOR CENTRAL + PANEL HAKU V1
// Coordina superficies persistentes sin acoplarse a la navegación principal.
(() => {
    "use strict";

    if (window.HAIKU_PANELES_V1) return;

    const CLASE_HAKU = "haiku-panel-abierto";
    const CLASE_INSPECTOR = "haiku-inspector-abierto";
    const CLASE_FICHA_LEGACY = "haiku-ficha-reserva-abierta";
    const CLASE_AMBOS = "haiku-paneles-convivencia";
    const MEDIA_COMPACTA = "(max-width: 900px)";
    const TIPOS_INSPECTOR = Object.freeze(["reserva", "pago", "servicio", "solicitud", "aseo"]);
    const TIPOS_PERMITIDOS = new Set(TIPOS_INSPECTOR);
    const SELECTORES_MODAL_PRIORITARIO = [
        '[role="dialog"][aria-modal="true"]',
        ".modal-nueva-reserva:not([hidden])",
        ".modal-bloqueo-calendario:not([hidden])",
        ".historial-reserva-modal:not([hidden])",
        ".resumen-servicio-modal:not([hidden])"
    ].join(",");

    const adaptadores = new Map();
    const observadoresInspector = new Map();
    const historialInspector = [];
    let observadorHaku = null;
    let observadorDescubrimiento = null;
    let panelHakuObservado = null;
    let superficieActiva = null;
    let descriptorActual = null;
    let estadoAnterior = "";

    function panelHaku() {
        return document.getElementById("haiku-asistente-panel");
    }

    function normalizarTipo(tipo) {
        return String(tipo || "").trim().toLowerCase();
    }

    function selectoresInspector() {
        return [...adaptadores.values()].map(adaptador => adaptador.selector).filter(Boolean).join(",");
    }

    function superficiesInspector() {
        const selector = selectoresInspector();
        if (!selector) return [];
        return [...new Set(document.querySelectorAll(selector))];
    }

    function tipoSuperficie(superficie) {
        const declarado = normalizarTipo(superficie?.dataset?.haikuInspectorSuperficie);
        if (declarado && adaptadores.has(declarado)) return declarado;
        for (const [tipo, adaptador] of adaptadores) {
            if (superficie?.matches?.(adaptador.selector)) return tipo;
        }
        return "";
    }

    function prepararSuperficie(superficie) {
        const tipo = tipoSuperficie(superficie);
        if (!superficie || !tipo) return "";
        superficie.dataset.haikuInspectorSuperficie = tipo;
        return tipo;
    }

    function superficieVisible(superficie) {
        return Boolean(superficie && superficie.isConnected && !superficie.hidden);
    }

    function entidadSuperficie(superficie, tipo = tipoSuperficie(superficie)) {
        const adaptador = adaptadores.get(tipo);
        const entidad = adaptador?.obtenerEntidad?.(superficie)
            || superficie?.dataset?.haikuInspectorEntidadId
            || superficie?.dataset?.reservaId
            || "";
        return String(entidad || "");
    }

    function descriptorSuperficie(superficie) {
        if (!superficieVisible(superficie)) return null;
        const tipo = prepararSuperficie(superficie);
        if (!tipo) return null;
        return {
            ...(descriptorActual?.tipo === tipo ? descriptorActual : {}),
            tipo,
            entidadId: entidadSuperficie(superficie, tipo)
        };
    }

    function contenedorScroll(superficie) {
        const adaptador = adaptadores.get(tipoSuperficie(superficie));
        return adaptador?.contenedorScroll?.(superficie)
            || superficie?.querySelector?.(".sites-resumen-drawer-body, .ficha-reserva-cuerpo")
            || null;
    }

    function capturarActual() {
        const descriptor = descriptorSuperficie(superficieActiva);
        if (!descriptor) return null;
        return { ...descriptor, scrollTop: Number(contenedorScroll(superficieActiva)?.scrollTop || 0) };
    }

    function cerrarSuperficie(superficie) {
        if (!superficieVisible(superficie)) return false;
        const adaptador = adaptadores.get(tipoSuperficie(superficie));
        if (adaptador?.cerrar) adaptador.cerrar(superficie);
        else superficie.hidden = true;
        return true;
    }

    function activarSuperficie(preferida = null) {
        const visibles = superficiesInspector().filter(superficieVisible);
        const elegida = preferida && visibles.includes(preferida)
            ? preferida
            : visibles.includes(superficieActiva) ? superficieActiva : visibles.at(-1) || null;

        if (elegida) {
            for (const superficie of visibles) {
                if (superficie !== elegida) cerrarSuperficie(superficie);
            }
            superficieActiva = elegida;
            descriptorActual = descriptorSuperficie(elegida);
        } else {
            superficieActiva = null;
            descriptorActual = null;
        }
        return superficieActiva;
    }

    function hakuAbierto() {
        const panel = panelHaku();
        return Boolean(panel && !panel.hidden);
    }

    function inspectorAbierto() {
        return Boolean(activarSuperficie());
    }

    function modoCompacto() {
        return window.matchMedia(MEDIA_COMPACTA).matches;
    }

    function estaVisible(elemento) {
        if (!elemento || elemento.hidden || elemento.getAttribute("aria-hidden") === "true") return false;
        const estilo = getComputedStyle(elemento);
        return estilo.display !== "none"
            && estilo.visibility !== "hidden"
            && elemento.getClientRects().length > 0;
    }

    function modalPrioritarioActivo() {
        const excluidos = new Set([panelHaku()]);
        for (const superficie of superficiesInspector()) {
            excluidos.add(superficie);
            excluidos.add(superficie.querySelector(":scope > [role='dialog'], :scope > .ficha-reserva"));
        }
        return [...document.querySelectorAll(SELECTORES_MODAL_PRIORITARIO)]
            .some(elemento => !excluidos.has(elemento) && estaVisible(elemento));
    }

    function cerrarInspector({ conservarHistorial = false } = {}) {
        const superficie = activarSuperficie();
        if (!superficie) return false;
        if (!conservarHistorial) historialInspector.length = 0;
        const cerrado = cerrarSuperficie(superficie);
        if (cerrado) {
            superficieActiva = null;
            descriptorActual = null;
            requestAnimationFrame(sincronizar);
        }
        return cerrado;
    }

    function volverAHaku() {
        if (!cerrarInspector()) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (inspectorAbierto()) return;
            const destino = document.getElementById("haiku-asistente-texto")
                || document.getElementById("haiku-asistente-cerrar");
            destino?.focus?.({ preventScroll: true });
        }));
    }

    function asegurarRetornoMovil(superficie) {
        if (!superficie) return null;
        let boton = superficie.querySelector("[data-haiku-volver-haku]");
        if (boton) return boton;

        const cabecera = superficie.querySelector(
            ".sites-resumen-drawer-head, .ficha-reserva-cabecera, [data-inspector-cabecera]"
        );
        if (!cabecera) return null;

        boton = document.createElement("button");
        boton.type = "button";
        boton.className = "haiku-volver-haku";
        boton.dataset.haikuVolverHaku = "";
        boton.textContent = "← Volver a Haku";
        boton.setAttribute("aria-label", "Cerrar el inspector y volver a Haku");
        boton.addEventListener("click", volverAHaku);

        const cerrar = cabecera.querySelector(
            "[data-reserva-cerrar], #ficha-reserva-cerrar, [data-inspector-cerrar]"
        );
        cabecera.insertBefore(boton, cerrar || null);
        return boton;
    }

    function estadoActual() {
        const haku = hakuAbierto();
        const inspector = inspectorAbierto();
        const descriptor = inspector ? descriptorSuperficie(superficieActiva) : null;
        return {
            hakuAbierto: haku,
            inspectorAbierto: inspector,
            inspector: descriptor ? { tipo: descriptor.tipo, entidadId: descriptor.entidadId || "" } : null,
            tipoInspector: descriptor?.tipo || "",
            entidadInspector: descriptor?.entidadId || "",
            historialInspector: historialInspector.length,
            reservaAbierta: inspector && descriptor?.tipo === "reserva",
            modo: haku && inspector
                ? (modoCompacto() ? "alternado" : "lado-a-lado")
                : "independiente"
        };
    }

    function sincronizar() {
        enlazarObservadores();
        const estado = estadoActual();
        const cuerpo = document.body;
        if (!cuerpo) return estado;

        cuerpo.classList.toggle(CLASE_HAKU, estado.hakuAbierto);
        cuerpo.classList.toggle(CLASE_INSPECTOR, estado.inspectorAbierto);
        cuerpo.classList.toggle(CLASE_FICHA_LEGACY, estado.reservaAbierta);
        cuerpo.classList.toggle(CLASE_AMBOS, estado.hakuAbierto && estado.inspectorAbierto);
        if (estado.tipoInspector) cuerpo.dataset.haikuInspectorTipo = estado.tipoInspector;
        else delete cuerpo.dataset.haikuInspectorTipo;

        const overlayHaku = document.getElementById("haiku-asistente-overlay");
        if (overlayHaku) overlayHaku.hidden = true;

        for (const superficie of superficiesInspector()) {
            prepararSuperficie(superficie);
            const retorno = asegurarRetornoMovil(superficie);
            if (retorno) retorno.setAttribute("aria-hidden",
                estado.modo === "alternado" && superficieVisible(superficie) ? "false" : "true");
            const dialogo = superficie.querySelector(":scope > [role='dialog'], :scope > .ficha-reserva");
            if (dialogo) dialogo.setAttribute("aria-modal", modoCompacto() ? "true" : "false");
        }

        const firma = JSON.stringify(estado);
        if (firma !== estadoAnterior) {
            estadoAnterior = firma;
            window.dispatchEvent(new CustomEvent("haiku:inspector-estado", { detail: estado }));
            window.dispatchEvent(new CustomEvent("haiku:paneles-estado", { detail: estado }));
        }
        return estado;
    }

    function observarSuperficie(superficie) {
        if (!superficie || observadoresInspector.has(superficie)) return;
        prepararSuperficie(superficie);
        const observador = new MutationObserver(() => {
            if (superficieVisible(superficie)) activarSuperficie(superficie);
            else if (superficieActiva === superficie) activarSuperficie();
            sincronizar();
        });
        observador.observe(superficie, {
            attributes: true,
            attributeFilter: ["hidden", "data-reserva-id", "data-haiku-inspector-entidad-id"]
        });
        observadoresInspector.set(superficie, observador);
        asegurarRetornoMovil(superficie);
    }

    function enlazarObservadores() {
        const haku = panelHaku();
        if (haku && haku !== panelHakuObservado) {
            observadorHaku?.disconnect();
            panelHakuObservado = haku;
            observadorHaku = new MutationObserver(sincronizar);
            observadorHaku.observe(haku, { attributes: true, attributeFilter: ["hidden"] });
        }

        for (const [superficie, observador] of observadoresInspector) {
            if (!superficie.isConnected) {
                observador.disconnect();
                observadoresInspector.delete(superficie);
                if (superficieActiva === superficie) superficieActiva = null;
            }
        }
        superficiesInspector().forEach(observarSuperficie);
    }

    function registrarTipoInspector(tipo, configuracion) {
        const clave = normalizarTipo(tipo);
        if (!TIPOS_PERMITIDOS.has(clave)) {
            throw new Error(`Tipo de inspector no permitido: ${clave || "vacío"}.`);
        }
        if (!configuracion?.selector || typeof configuracion.abrir !== "function") {
            throw new Error(`El inspector ${clave} requiere selector y función abrir.`);
        }
        adaptadores.set(clave, Object.freeze({ ...configuracion, tipo: clave }));
        enlazarObservadores();
        sincronizar();
        return true;
    }

    async function abrirInspector(solicitud, opciones = {}) {
        const tipo = normalizarTipo(solicitud?.tipo);
        if (!TIPOS_PERMITIDOS.has(tipo)) {
            throw new Error(`Tipo de inspector no permitido: ${tipo || "vacío"}.`);
        }
        const adaptador = adaptadores.get(tipo);
        if (!adaptador) {
            throw new Error(`El inspector de ${tipo} está preparado, pero todavía no tiene una vista registrada.`);
        }

        const anterior = capturarActual();
        if (opciones.recordarActual === true && anterior?.entidadId) historialInspector.push(anterior);
        if (superficieActiva && tipoSuperficie(superficieActiva) !== tipo) {
            cerrarInspector({ conservarHistorial: true });
        }

        const origen = opciones.origen
            || solicitud.origen
            || (panelHaku()?.contains(document.activeElement) ? document.activeElement : panelHaku());
        const resultado = await adaptador.abrir(solicitud, origen);
        enlazarObservadores();
        const abierta = superficiesInspector().filter(superficieVisible)
            .find(superficie => tipoSuperficie(superficie) === tipo);
        if (abierta) {
            superficieActiva = abierta;
            const entidadId = String(solicitud.entidadId || solicitud.reservaId
                || entidadSuperficie(abierta, tipo) || "");
            if (entidadId) abierta.dataset.haikuInspectorEntidadId = entidadId;
            descriptorActual = { ...solicitud, tipo, entidadId };
            activarSuperficie(abierta);
            sincronizar();
            const restaurarScroll = Number(opciones.restaurarScroll);
            if (Number.isFinite(restaurarScroll)) {
                requestAnimationFrame(() => {
                    const scroll = contenedorScroll(abierta);
                    if (scroll) scroll.scrollTop = restaurarScroll;
                });
            }
        }
        return resultado;
    }

    async function volverInspector() {
        const anterior = historialInspector.pop();
        if (!anterior) return false;
        return abrirInspector(anterior, {
            recordarActual: false,
            restaurarScroll: anterior.scrollTop
        });
    }

    function puedeCerrarHakuConEscape() {
        return !inspectorAbierto() && !modalPrioritarioActivo();
    }

    function manejarEscape(evento) {
        if (evento.key !== "Escape" || evento.defaultPrevented || !inspectorAbierto()) return;
        if (modalPrioritarioActivo()) return;
        evento.preventDefault();
        evento.stopImmediatePropagation();
        cerrarInspector();
    }

    registrarTipoInspector("reserva", {
        selector: "#sites-resumen-reserva-drawer, #ficha-reserva-modal",
        abrir: (solicitud, origen) => {
            const abrir = window.HAIKU_RESUMEN_RESERVA_SITES_V1?.abrirPorId;
            if (typeof abrir !== "function") {
                throw new Error("La ficha de reserva todavía no está disponible.");
            }
            return abrir(String(solicitud.entidadId || solicitud.reservaId || ""), origen,
                solicitud.seleccion || null);
        },
        cerrar: superficie => {
            if (superficie.id === "sites-resumen-reserva-drawer" &&
                typeof window.HAIKU_RESUMEN_RESERVA_SITES_V1?.cerrar === "function") {
                window.HAIKU_RESUMEN_RESERVA_SITES_V1.cerrar();
                return;
            }
            const boton = superficie.querySelector("[data-reserva-cerrar], #ficha-reserva-cerrar");
            if (boton) boton.click();
            else superficie.hidden = true;
        },
        obtenerEntidad: superficie => superficie.dataset.haikuInspectorEntidadId
            || superficie.dataset.reservaId || ""
    });

    const api = {
        TIPOS_INSPECTOR,
        abrirInspector,
        registrarTipoInspector,
        volverInspector,
        cerrarInspector,
        abrirReserva(reservaId, origen, seleccion = null) {
            return abrirInspector({ tipo: "reserva", entidadId: String(reservaId || ""), seleccion }, { origen });
        },
        cerrarReserva: cerrarInspector,
        estado: estadoActual,
        sincronizar,
        puedeCerrarHakuConEscape
    };
    window.HAIKU_PANELES_V1 = Object.freeze(api);
    window.HAIKU_INSPECTOR_V1 = window.HAIKU_PANELES_V1;

    document.addEventListener("keydown", manejarEscape, true);
    window.addEventListener("resize", sincronizar, { passive: true });
    window.addEventListener("haiku:panel-estado", sincronizar);

    if (document.body) {
        observadorDescubrimiento = new MutationObserver(mutaciones => {
            const selector = `${selectoresInspector()}, #haiku-asistente-panel`;
            const requiereSincronizar = mutaciones.some(mutacion => [...mutacion.addedNodes].some(nodo =>
                nodo.nodeType === 1 && (nodo.matches?.(selector) || nodo.querySelector?.(selector))));
            if (requiereSincronizar) sincronizar();
        });
        observadorDescubrimiento.observe(document.body, { childList: true, subtree: true });
    }

    sincronizar();
})();
