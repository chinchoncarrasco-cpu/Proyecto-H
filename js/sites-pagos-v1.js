// Composición Sites de Pagos sobre las lecturas y los escritores financieros existentes.
(() => {
    "use strict";
    if (window.HAIKU_SITES_PAGOS_V1) return;

    const raiz = document.getElementById("seccion-pagos");
    if (!raiz) return;

    const fechaActual = () => {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    };
    const listas = ["abonos", "checkin", "checkout", "webpay"];
    const abiertoPorReserva = new Map();
    let temporizador = 0;
    let lecturaDia = null;
    let selector = null;
    let disparadorSeleccion = null;
    let bove = null;
    let boveActual = null;
    let editorVisible = null;
    let overflowAntesEditor = "";

    function fechaVisible() {
        const nodo = document.getElementById("sites-pagos-fecha");
        if (!nodo) return;
        const fecha = fechaActual();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
            nodo.textContent = "Fecha operativa por verificar";
            return;
        }
        const [anio, mes, dia] = fecha.split("-").map(Number);
        nodo.textContent = new Intl.DateTimeFormat("es-CL", {
            timeZone: "America/Santiago", weekday: "long", day: "numeric",
            month: "long", year: "numeric"
        }).format(new Date(Date.UTC(anio, mes - 1, dia, 12)));
    }

    async function operacionDia() {
        const fecha = fechaActual();
        if (!fecha || !window.haikuSesion || !window.haikuSupabase) return [];
        if (!lecturaDia || lecturaDia.fecha !== fecha || Date.now() - lecturaDia.creada > 10000) {
            const promesa = window.haikuSupabase.rpc("haiku_operacion_dia", { p_fecha: fecha })
                .then(({ data, error }) => {
                    if (error) throw error;
                    return data || [];
                });
            lecturaDia = { fecha, creada: Date.now(), promesa };
        }
        return lecturaDia.promesa;
    }

    function identidadExacta(filas, reservaId, etapa) {
        const id = String(reservaId || "");
        if (!id) return null;
        for (const fila of filas) {
            const numero = Number(fila.numero || 0);
            const estado = String(fila.estado_operativo || "");
            if (!numero) continue;
            if (etapa === "checkin" &&
                ((["libre-ingresa", "sale-ingresa"].includes(estado) &&
                    String(fila.ingreso_reserva_id || "") === id) ||
                    (estado === "fullday" && String(fila.fullday_reserva_id || "") === id))) {
                return { reservaId: id, cabana: numero, etapa };
            }
            if (etapa === "checkout" &&
                ((["sale-libre", "sale-ingresa"].includes(estado) &&
                    String(fila.salida_reserva_id || "") === id) ||
                    (estado === "fullday" && String(fila.fullday_reserva_id || "") === id))) {
                return { reservaId: id, cabana: numero, etapa };
            }
            if (etapa === "abono" &&
                ((["libre-ingresa", "sale-ingresa"].includes(estado) &&
                    String(fila.ingreso_reserva_id || "") === id) ||
                    (estado === "continua" && String(fila.continua_reserva_id || "") === id) ||
                    (["sale-libre", "sale-ingresa"].includes(estado) &&
                    String(fila.salida_reserva_id || "") === id) ||
                    (estado === "fullday" && String(fila.fullday_reserva_id || "") === id))) {
                return { reservaId: id, cabana: numero, etapa };
            }
        }
        return null;
    }

    function detalle(card, etapa) {
        if (card.dataset.sitesPagosCompuesto === "1") return;
        const cuerpo = card.querySelector(":scope > .pago-checkin-nuevo");
        if (!cuerpo) return;
        const cabecera = cuerpo.querySelector(":scope > .pago-checkin-cabecera");
        const resumen = cuerpo.querySelector(":scope > .pago-checkin-resumen-nuevo");
        if (!cabecera || !resumen) return;

        const desplegable = document.createElement("details");
        desplegable.className = "sites-pagos-detalle";
        const clave = `${etapa}:${card.dataset.reservaId || card.dataset.grupoId || ""}`;
        desplegable.open = abiertoPorReserva.get(clave) === true;
        const sumario = document.createElement("summary");
        sumario.textContent = etapa === "checkout"
            ? "Ver servicios, pagos y BOVE Check-out"
            : "Ver detalle de pagos y documentos";
        const contenido = document.createElement("div");
        contenido.className = "sites-pagos-detalle-contenido";
        const pagos = document.createElement("section");
        pagos.className = "sites-pagos-detalle-col sites-pagos-detalle-pagos";
        const documentos = document.createElement("section");
        documentos.className = "sites-pagos-detalle-col sites-pagos-detalle-documentos";
        const tituloPagos = document.createElement("h3");
        tituloPagos.textContent = "Pagos registrados";
        const tituloDocumentos = document.createElement("h3");
        tituloDocumentos.textContent = "Documentos y servicios";
        pagos.appendChild(tituloPagos);
        documentos.appendChild(tituloDocumentos);
        [...cuerpo.children].forEach(hijo => {
            if (hijo === cabecera || hijo === resumen) return;
            if (hijo.classList.contains("haiku-saldo-detalle")) hijo.open = true;
            const esDocumento = ["haiku-bove-cierre", "haiku-checkout-servicios",
                "haiku-checkin-servicios-separados", "haiku-checkin-grupo-servicios"]
                .some(clase => hijo.classList.contains(clase));
            (esDocumento ? documentos : pagos).appendChild(hijo);
        });
        const bove = documentos.querySelector(":scope > .haiku-bove-cierre");
        const rotuloBove = bove?.querySelector(":scope > strong");
        if (rotuloBove) {
            const nombre = etapa === "checkout" ? "BOVE Check-out" :
                card.classList.contains("haiku-checkin-grupo-v2")
                    ? "BOVE alojamiento conjunto" : "BOVE alojamiento";
            rotuloBove.textContent = bove.classList.contains("haiku-bove-ok")
                ? `✓ ${nombre}` : `${nombre} · Pendiente`;
        }
        if (!pagos.querySelector(".haiku-saldo-pago-confirmado")) {
            const vacio = document.createElement("p");
            vacio.className = "sites-pagos-detalle-vacio";
            vacio.textContent = "Sin pagos registrados en este detalle.";
            tituloPagos.after(vacio);
        }
        if (documentos.children.length === 1) {
            const vacio = document.createElement("p");
            vacio.className = "sites-pagos-detalle-vacio";
            vacio.textContent = "Sin documentos ni servicios en este detalle.";
            documentos.appendChild(vacio);
        }
        contenido.append(pagos, documentos);
        desplegable.append(sumario, contenido);
        cuerpo.appendChild(desplegable);
        desplegable.addEventListener("toggle", () => {
            abiertoPorReserva.set(clave, desplegable.open);
        });
        card.classList.add("sites-pagos-registro");
        card.dataset.sitesPagosCompuesto = "1";
    }

    function trasladarPago(card, identidad, fecha) {
        const formulario = card.querySelector(".sites-pagos-detalle-pagos > .haiku-saldo-formulario");
        if (!formulario || formulario.dataset.sitesPagosTrasladado === "1" ||
            !window.HAIKU_RESUMEN_PAGO_SITES_V1) return;
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "sites-pagos-abrir-pago";
        boton.textContent = identidad.etapa === "checkout"
            ? "Registrar pago de servicios" : "Registrar pago";
        boton.dataset.resumenPagoReservaId = identidad.reservaId;
        boton.dataset.resumenPagoEtapa = identidad.etapa;
        boton.dataset.resumenPago = String(identidad.cabana);
        boton.dataset.sitesPagosOrigen = "1";
        boton.dataset.sitesPagosFecha = fecha;
        formulario.before(boton);
        formulario.hidden = true;
        formulario.dataset.sitesPagosTrasladado = "1";
    }

    function trasladarBove(card) {
        const bloque = card.querySelector(".sites-pagos-detalle-documentos > .haiku-bove-cierre.haiku-bove-pendiente");
        const fila = bloque?.querySelector(".haiku-bove-fila");
        const campo = fila?.querySelector("[data-haiku-bove-total], [data-grupo-bove], [data-haiku-checkout-bove]");
        const botonOriginal = fila?.querySelector("button");
        if (!fila || !campo || !botonOriginal || fila.dataset.sitesPagosTrasladado === "1") return;
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "sites-pagos-abrir-bove";
        boton.textContent = "Registrar BOVE";
        boton.addEventListener("click", () => abrirBove(card, campo, botonOriginal, boton));
        fila.before(boton);
        fila.hidden = true;
        fila.dataset.sitesPagosTrasladado = "1";
    }

    function componerEstructura() {
        fechaVisible();
        const fecha = fechaActual();
        for (const tipo of listas) {
            const lista = document.getElementById(`pagos-lista-${tipo}`);
            const contador = raiz.querySelector(`[data-sites-pagos-count="${tipo}"]`);
            if (!lista || !contador) continue;
            const numero = tipo === "abonos"
                ? document.getElementById("pagos-contador-abonos")?.textContent || "0"
                : lista.querySelectorAll(tipo === "webpay" ? ":scope > .pago-webpay-item"
                    : ":scope > .pago-checkin-item, :scope > .pago-checkout-item").length;
            contador.textContent = String(numero);
        }
        for (const etapa of ["checkin", "checkout"]) {
            const lista = document.getElementById(`pagos-lista-${etapa}`);
            const selector = etapa === "checkin"
                ? ":scope > .pago-checkin-item.haiku-saldo-v5"
                : ":scope > .pago-checkout-item.haiku-checkout-v1";
            lista?.querySelectorAll(selector)
                .forEach(card => { detalle(card, etapa); trasladarBove(card); });
        }
        const listaAbonos = document.getElementById("pagos-lista-abonos");
        listaAbonos?.querySelectorAll(".haiku-abono-v2-unidad[data-reserva-id]").forEach(card => {
            if (card.querySelector(".sites-pagos-editar-abonos") ||
                !window.haikuTienePermiso?.("pagos.registrar") ||
                !window.haikuTienePermiso?.("pagos.anular")) return;
            const identidad = card.querySelector(".haiku-abono-v2-identidad");
            if (!identidad) return;
            const boton = document.createElement("button");
            boton.type = "button";
            boton.className = "sites-pagos-editar-abonos";
            boton.textContent = "Editar abonos";
            boton.dataset.sitesPagosEditarReserva = card.dataset.reservaId;
            boton.dataset.sitesPagosFecha = fecha;
            identidad.appendChild(boton);
        });
    }

    async function componer() {
        componerEstructura();
        const fecha = fechaActual();
        if (!fecha) return;
        let filas;
        try { filas = await operacionDia(); }
        catch (error) {
            console.warn("HAIKU · No se pudo vincular el drawer de Pagos al día operativo:", error);
            return; // Los controles reales originales permanecen disponibles en el detalle.
        }
        if (fecha !== fechaActual()) return;
        for (const etapa of ["checkin", "checkout"]) {
            const lista = document.getElementById(`pagos-lista-${etapa}`);
            const selector = etapa === "checkin"
                ? ":scope > .pago-checkin-item.haiku-saldo-v5"
                : ":scope > .pago-checkout-item.haiku-checkout-v1";
            lista?.querySelectorAll(selector)
                .forEach(card => {
                    if (!card.isConnected || card.hidden) return;
                    const identidad = identidadExacta(filas, card.dataset.reservaId, etapa);
                    if (identidad) trasladarPago(card, identidad, fecha);
                });
        }
    }

    function programar(ms = 70) {
        clearTimeout(temporizador);
        temporizador = setTimeout(() => {
            componer();
            sincronizarEditor();
        }, ms);
    }

    function sincronizarEditor() {
        const editor = raiz.querySelector("[data-haiku-pago-editor]:not([hidden])");
        if (editor === editorVisible) return;
        if (!editorVisible && editor) {
            overflowAntesEditor = document.body.style.overflow;
            document.body.style.overflow = "hidden";
        } else if (editorVisible && !editor) {
            document.body.style.overflow = overflowAntesEditor;
        }
        editorVisible = editor || null;
        if (editorVisible) {
            editorVisible.setAttribute("role", "dialog");
            editorVisible.setAttribute("aria-modal", "true");
            editorVisible.setAttribute("aria-label", "Editar pago confirmado");
            requestAnimationFrame(() => {
                if (editorVisible === editor) editor.querySelector("select, input, button")?.focus();
            });
        }
    }

    function crearSelector() {
        if (selector) return selector;
        selector = document.createElement("div");
        selector.className = "sites-resumen-drawer sites-pagos-selector";
        selector.hidden = true;
        selector.setAttribute("role", "presentation");
        selector.innerHTML = `
            <section class="sites-resumen-drawer-panel sites-pagos-selector-panel" role="dialog"
                aria-modal="true" aria-labelledby="sites-pagos-selector-titulo" tabindex="-1">
                <header class="sites-resumen-drawer-head"><div><small class="sites-resumen-drawer-kicker">Control financiero</small>
                    <h2 id="sites-pagos-selector-titulo">Añadir pago</h2></div>
                    <button type="button" class="sites-resumen-drawer-close" data-sites-pagos-cerrar aria-label="Cerrar">×</button></header>
                <div class="sites-resumen-drawer-body sites-pagos-selector-body">
                    <p>Selecciona la reserva exacta del día operativo.</p>
                    <label for="sites-pagos-reserva">Titular / reserva</label>
                    <select id="sites-pagos-reserva"><option value="">Seleccionar reserva…</option></select>
                    <p class="sites-pagos-selector-estado" role="status" aria-live="polite"></p>
                </div>
                <footer class="sites-resumen-drawer-footer"><button type="button" data-sites-pagos-cerrar>Cerrar</button>
                    <button type="button" data-sites-pagos-continuar disabled>Continuar al pago</button></footer>
            </section>`;
        document.body.appendChild(selector);
        selector.querySelectorAll("[data-sites-pagos-cerrar]").forEach(boton =>
            boton.addEventListener("click", cerrarSelector));
        selector.querySelector("#sites-pagos-reserva").addEventListener("change", evento => {
            selector.querySelector("[data-sites-pagos-continuar]").disabled = !evento.target.value;
        });
        selector.querySelector("[data-sites-pagos-continuar]").addEventListener("click", continuarPago);
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.registrar?.(selector, {
            cerrar: cerrarSelector,
            focoInicial: () => selector.querySelector("#sites-pagos-reserva")
        });
        return selector;
    }

    function cerrarSelector() {
        if (!selector) return;
        selector.hidden = true;
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.sincronizar?.();
    }

    async function abrirSelector(boton) {
        const api = window.HAIKU_PAGO_GRUPO_V1;
        if (!api?.listarReservasDia || !window.HAIKU_RESUMEN_PAGO_SITES_V1) {
            await api?.abrir?.();
            return;
        }
        const panel = crearSelector();
        disparadorSeleccion = boton;
        const fecha = fechaActual();
        const select = panel.querySelector("#sites-pagos-reserva");
        const estado = panel.querySelector(".sites-pagos-selector-estado");
        select.innerHTML = '<option value="">Cargando reservas…</option>';
        select.disabled = true;
        panel.querySelector("[data-sites-pagos-continuar]").disabled = true;
        estado.textContent = "";
        panel.hidden = false;
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.marcarDisparador?.(panel, boton);
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.sincronizar?.();
        try {
            const reservas = await api.listarReservasDia();
            if (panel.hidden || fecha !== fechaActual()) {
                if (!panel.hidden) estado.textContent = "La fecha cambió. Cierra y vuelve a abrir.";
                return;
            }
            select.innerHTML = '<option value="">Seleccionar reserva…</option>';
            reservas.forEach(item => {
                const option = document.createElement("option");
                option.value = String(item.reservaId || "");
                option.textContent = `${(item.cabs || []).map(n => `CAB ${n}`).join(" + ")} · ${item.titular || "Sin titular"}`;
                select.appendChild(option);
            });
            select.disabled = false;
            if (!reservas.length) estado.textContent = "No hay reservas para el día seleccionado.";
        } catch (error) {
            select.innerHTML = '<option value="">No disponible</option>';
            estado.textContent = error?.message || "No se pudo cargar la lista de reservas.";
        }
    }

    async function continuarPago() {
        const id = selector?.querySelector("#sites-pagos-reserva")?.value || "";
        const estado = selector?.querySelector(".sites-pagos-selector-estado");
        const boton = disparadorSeleccion;
        const fecha = fechaActual();
        if (!id || !boton?.isConnected || !fecha || !estado) return;
        try {
            const identidad = identidadExacta(await operacionDia(), id, "abono");
            if (!identidad || fecha !== fechaActual()) {
                throw new Error("La reserva o la fecha cambió. Vuelve a seleccionar.");
            }
            boton.dataset.resumenPagoReservaId = id;
            boton.dataset.resumenPagoEtapa = "abono";
            boton.dataset.resumenPago = String(identidad.cabana);
            boton.dataset.sitesPagosOrigen = "1";
            boton.dataset.sitesPagosFecha = fecha;
            cerrarSelector();
            await window.HAIKU_RESUMEN_PAGO_SITES_V1.abrirPagoReserva(
                id, "abono", identidad.cabana, boton);
        } catch (error) {
            estado.textContent = error?.message || "No fue posible verificar la reserva.";
        }
    }

    function crearBove() {
        if (bove) return bove;
        bove = document.createElement("div");
        bove.className = "sites-resumen-drawer sites-pagos-bove";
        bove.hidden = true;
        bove.setAttribute("role", "presentation");
        bove.innerHTML = `
            <section class="sites-resumen-drawer-panel sites-pagos-bove-panel" role="dialog"
                aria-modal="true" aria-labelledby="sites-pagos-bove-titulo" tabindex="-1">
                <header class="sites-resumen-drawer-head"><div><small class="sites-resumen-drawer-kicker">Control financiero</small>
                    <h2 id="sites-pagos-bove-titulo">Registrar BOVE</h2></div>
                    <button type="button" class="sites-resumen-drawer-close" data-sites-bove-cerrar aria-label="Cerrar">×</button></header>
                <div class="sites-resumen-drawer-body sites-pagos-bove-body">
                    <p data-sites-bove-contexto></p><label for="sites-pagos-bove-codigo">Número de BOVE</label>
                    <input id="sites-pagos-bove-codigo" type="text" autocomplete="off">
                    <p data-sites-bove-estado role="status" aria-live="polite"></p>
                </div>
                <footer class="sites-resumen-drawer-footer"><button type="button" data-sites-bove-cerrar>Cancelar</button>
                    <button type="button" data-sites-bove-confirmar>Registrar BOVE</button></footer>
            </section>`;
        document.body.appendChild(bove);
        bove.querySelectorAll("[data-sites-bove-cerrar]").forEach(boton =>
            boton.addEventListener("click", cerrarBove));
        bove.querySelector("[data-sites-bove-confirmar]").addEventListener("click", confirmarBove);
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.registrar?.(bove, {
            cerrar: cerrarBove,
            focoInicial: () => bove.querySelector("#sites-pagos-bove-codigo")
        });
        return bove;
    }

    function abrirBove(card, campo, botonOriginal, disparador) {
        if (!card.isConnected || !campo.isConnected || !botonOriginal.isConnected) return;
        const panel = crearBove();
        boveActual = { card, campo, botonOriginal, fecha: fechaActual() };
        const esCheckout = card.classList.contains("haiku-checkout-v1");
        panel.querySelector("[data-sites-bove-contexto]").textContent = esCheckout
            ? "BOVE de servicios Check-out. No registra un pago ni modifica el saldo."
            : "BOVE de alojamiento. No registra un pago ni modifica el saldo.";
        panel.querySelector("#sites-pagos-bove-codigo").value = campo.value || "";
        panel.querySelector("[data-sites-bove-estado]").textContent = "";
        panel.hidden = false;
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.marcarDisparador?.(panel, disparador);
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.sincronizar?.();
    }

    function cerrarBove() {
        if (!bove) return;
        bove.hidden = true;
        boveActual = null;
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.sincronizar?.();
    }

    function confirmarBove() {
        const actual = boveActual;
        if (!actual || !bove) return;
        const estado = bove.querySelector("[data-sites-bove-estado]");
        const valor = bove.querySelector("#sites-pagos-bove-codigo").value.trim();
        if (!valor) { estado.textContent = "Ingresa el número de BOVE."; return; }
        if (actual.fecha !== fechaActual() || !actual.card.isConnected ||
            !actual.campo.isConnected || !actual.botonOriginal.isConnected ||
            !actual.card.querySelector(".haiku-bove-cierre.haiku-bove-pendiente")) {
            estado.textContent = "El estado cambió. Cierra y vuelve a abrir el registro.";
            return;
        }
        actual.campo.value = valor;
        cerrarBove();
        actual.botonOriginal.click(); // Entra una sola vez por el handler/RPC protegido existente.
    }

    function instalar() {
        for (const tipo of listas) {
            const lista = document.getElementById(`pagos-lista-${tipo}`);
            if (!lista || lista.dataset.sitesPagosObservado === "1") continue;
            lista.dataset.sitesPagosObservado = "1";
            // El CSS inicial mantiene ocultas las tarjetas tempranas aun sin observer.
            new MutationObserver(() => {
                componerEstructura();
                if (tipo !== "webpay") programar();
            }).observe(lista, { childList: true });
        }
        componerEstructura();
        programar(0);
    }

    document.addEventListener("click", evento => {
        const boton = evento.target.closest?.("#seccion-pagos .haiku-anadir-pago-boton");
        if (!boton) return;
        evento.preventDefault();
        evento.stopImmediatePropagation();
        abrirSelector(boton);
    }, true);
    document.addEventListener("click", evento => {
        if (!editorVisible || !editorVisible.isConnected || editorVisible.hidden ||
            editorVisible.contains(evento.target) ||
            evento.target.closest?.("[data-haiku-pago-editar]")) return;
        evento.preventDefault();
        evento.stopImmediatePropagation();
        editorVisible.querySelector("[data-haiku-editar-pago-cancelar]")?.click();
        sincronizarEditor();
    }, true);
    document.addEventListener("click", evento => {
        if (!evento.target.closest?.("#seccion-pagos [data-haiku-pago-editar], #seccion-pagos [data-haiku-editar-pago-cancelar]")) return;
        queueMicrotask(sincronizarEditor);
    });
    document.addEventListener("keydown", evento => {
        const editor = editorVisible;
        if (!editor || !editor.isConnected || editor.hidden) return;
        if (evento.key === "Escape") {
            evento.preventDefault();
            evento.stopImmediatePropagation();
            editor.querySelector("[data-haiku-editar-pago-cancelar]")?.click();
            sincronizarEditor();
            return;
        }
        if (evento.key !== "Tab") return;
        const controles = [...editor.querySelectorAll("button, input, select, textarea")]
            .filter(item => !item.disabled && !item.hidden && item.getClientRects().length);
        if (!controles.length) return;
        const primero = controles[0], ultimo = controles.at(-1);
        if (evento.shiftKey && (document.activeElement === primero || !editor.contains(document.activeElement))) {
            evento.preventDefault();
            ultimo.focus();
        } else if (!evento.shiftKey && (document.activeElement === ultimo || !editor.contains(document.activeElement))) {
            evento.preventDefault();
            primero.focus();
        }
    }, true);
    document.addEventListener("click", evento => {
        const boton = evento.target.closest?.(".sites-pagos-editar-abonos");
        if (!boton) return;
        evento.preventDefault();
        window.HAIKU_PAGO_GRUPO_V1?.abrirEdicion?.(
            boton.dataset.sitesPagosEditarReserva, boton.dataset.sitesPagosFecha);
    });
    document.addEventListener("click", evento => {
        if (evento.target.closest?.('[data-seccion="pagos"]')) programar(150);
    });
    window.addEventListener("haiku:auth-ready", () => { lecturaDia = null; instalar(); });
    window.addEventListener("load", instalar);
    instalar();

    window.HAIKU_SITES_PAGOS_V1 = Object.freeze({ refrescar: () => {
        lecturaDia = null;
        componerEstructura();
        programar(0);
    }});
})();
