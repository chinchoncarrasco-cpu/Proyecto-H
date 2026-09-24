// Presentación Sites de las notificaciones reales. Los lectores y escritores existentes
// siguen siendo la autoridad; el popover legacy sólo conserva un montaje oculto.
(() => {
    "use strict";
    if (window.HAIKU_SITES_NOTIFICACIONES_V1) return;

    const boton = document.getElementById("boton-notificaciones");
    const badge = document.getElementById("contador-notificaciones");
    const overlay = document.getElementById("sites-notificaciones-overlay");
    const drawer = document.getElementById("sites-notificaciones-drawer");
    const cerrarBoton = document.getElementById("sites-notificaciones-cerrar");
    const cuerpo = document.getElementById("sites-notificaciones-contenido");
    const turno = document.getElementById("sites-notificaciones-turno");
    if (!boton || !badge || !overlay || !drawer || !cerrarBoton || !cuerpo || !turno) return;

    const iconos = Object.freeze({
        pago: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 14h4"/>',
        servicio: '<path d="M3 18h18M5 18c0-6 3-10 7-10s7 4 7 10M12 5v3"/>',
        checkin: '<path d="M4 19h16M6 16l6-11 6 11z"/>',
        bove: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3.5h6M8 9h8M8 13h8"/>'
    });
    const icono = tipo => `<svg class="sites-notificaciones-icon" viewBox="0 0 24 24" aria-hidden="true">${iconos[tipo]}</svg>`;
    const esc = valor => String(valor ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
    const moneda = valor => `$${Math.round(Number(valor) || 0).toLocaleString("es-CL")}`;
    let fechaAnterior = "";
    let firmaAnterior = "";
    let espera = 0;
    let overflowAnterior = "";
    let disparador = null;

    function fechaActual() {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    }

    function listaServicios() {
        try {
            if (typeof serviciosRegistrados !== "undefined" && Array.isArray(serviciosRegistrados))
                return serviciosRegistrados;
        } catch (_) {}
        try {
            const lista = JSON.parse(localStorage.getItem("haikuServicios") || "[]");
            return Array.isArray(lista) ? lista : [];
        } catch (_) { return []; }
    }

    function estadoServicio(servicio, listaDia) {
        try {
            const estado = window.haikuEstadoTemporalServicio?.(servicio, listaDia);
            if (estado?.clave) return estado.clave;
        } catch (_) {}
        const bruto = String(servicio?.estadoServicioDb || servicio?.estadoServicio || "").toLowerCase();
        if (["cancelado", "cancelada", "no_show"].includes(bruto)) return "cancelada";
        if (["realizado", "completada"].includes(bruto)) return "completada";
        return "pendiente";
    }

    function leer(fecha = fechaActual()) {
        const serviciosDia = listaServicios()
            .filter(item => String(item?.fechaServicio || item?.fecha || "").slice(0, 10) === fecha)
            .sort((a, b) => String(a.hora || "99:99").localeCompare(String(b.hora || "99:99")));
        const servicios = serviciosDia.map(item => ({ ...item, estado: estadoServicio(item, serviciosDia) }));
        let checkins = [];
        try {
            checkins = (window.obtenerCheckinsPendientes?.() || []).map(item => {
                let cabana;
                try { cabana = datosPorFecha?.[fecha]?.cabanas?.[item.numeroCabana]; } catch (_) {}
                return { ...item, codigoHaiku: cabana?.codigoHaiku || "",
                    adultos: cabana?.adultos, ninos: cabana?.ninos };
            });
        } catch (_) {}
        const pagosApi = window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1;
        const bovesApi = window.HAIKU_BOVES_PENDIENTES_SUPABASE_V1;
        const pagosListos = Boolean(pagosApi?.estaListo?.(fecha));
        const bovesListos = Boolean(bovesApi?.estaListo?.(fecha));
        const pagos = pagosListos ? pagosApi.obtener(fecha) : [];
        const boves = bovesListos ? bovesApi.obtener(fecha) : [];
        const atencion = [];

        pagos.forEach(item => atencion.push({ tipo: "pago", item }));
        servicios.filter(item => ["actual", "proxima"].includes(item.estado))
            .forEach(item => atencion.push({ tipo: "servicio", item }));
        checkins.forEach(item => atencion.push({ tipo: "checkin", item }));
        boves.forEach(item => atencion.push({ tipo: "bove", item }));
        return { fecha, servicios, checkins, pagos, boves, pagosListos, bovesListos, atencion };
    }

    function fechaRotulo(fecha) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return "TURNO · FECHA POR VERIFICAR";
        const [anio, mes, dia] = fecha.split("-");
        return `TURNO · ${dia}-${mes}-${anio.slice(2)}`;
    }

    function botonAccion(tipo, clave, texto, clase = "") {
        return `<button type="button" class="sites-notificaciones-action ${clase}" data-sites-noti-accion="${esc(tipo)}" data-sites-noti-clave="${esc(clave)}">${esc(texto)}</button>`;
    }

    function clavePago(item) { return `${item.tipo}:${item.reservaId}:${item.numeroCabana}`; }
    function claveBove(item) { return `${item.reservaId}:${item.numeroCabana}`; }
    function claveServicio(item) { return String(item.id || ""); }
    function accionPago(item, etiqueta = "Registrar pago") {
        return window.HAIKU_RESUMEN_PAGO_SITES_V1 && window.haikuTienePermiso?.("pagos.registrar")
            ? botonAccion("pago", clavePago(item), etiqueta) : "";
    }
    function accionBove(item) {
        return window.HAIKU_SITES_PAGOS_V1 && window.haikuTienePermiso?.("pagos.verificar")
            ? botonAccion("bove", claveBove(item), "Registrar BOVE") : "";
    }
    function botonCabana(numero) {
        return [...document.querySelectorAll("[data-ficha-cabana]")]
            .find(nodo => nodo.dataset.fichaCabana === String(numero));
    }
    function accionCabana(item) {
        return item.numeroCabana && botonCabana(item.numeroCabana)
            ? botonAccion("cabana", item.numeroCabana, "Ver cabaña") : "";
    }
    function accionesServicio(item, atencion = false) {
        if (!item.id || ["completada", "cancelada"].includes(item.estado)) return "";
        const api = window.HAIKU_SITES_SERVICIOS_V1;
        const realizar = api && window.haikuTienePermiso?.("servicios.editar") === true
            ? botonAccion("realizar", claveServicio(item), atencion ? "Realizado" : "✓ Realizado") : "";
        const programable = ["tinaja", "masaje"].includes(String(item.categoria || "").toLowerCase());
        const cancelar = api && programable && window.haikuTienePermiso?.("servicios.cancelar") === true
            ? botonAccion("cancelar", claveServicio(item), "Cancelar", "danger") : "";
        return realizar + (atencion ? "" : cancelar);
    }

    function resumenAtencion(entrada) {
        const { tipo, item } = entrada;
        let titulo = "", detalle = "", accion = "";
        if (tipo === "pago") {
            titulo = `Cabaña ${item.numeroCabana} · Saldo ${moneda(item.monto)}`;
            detalle = `${item.titular || "Sin titular"} · ${item.tipo === "checkin" ? "cobro pendiente de ingreso" : "servicios pendientes de pago"}`;
            accion = accionPago(item, "Cobrar");
        } else if (tipo === "servicio") {
            titulo = `Cabaña ${item.numeroCabana || "—"} · ${item.nombre || "Servicio"}`;
            detalle = `${item.titular || "Sin titular"}${item.hora ? ` · ${item.hora}` : ""} · ${item.estado === "actual" ? "en curso" : "próximo"}`;
            accion = accionesServicio(item, true);
        } else if (tipo === "checkin") {
            titulo = `Cabaña ${item.numeroCabana} · Check-in pendiente`;
            detalle = `${item.titular || "Sin titular"}${item.hora ? ` · ${item.hora}` : ""}`;
            accion = accionCabana(item);
        } else {
            titulo = `Cabaña ${item.numeroCabana} · BOVE pendiente`;
            detalle = `${item.titular || "Sin titular"} · alojamiento`;
            accion = accionBove(item);
        }
        return `<div class="sites-notificaciones-row" data-kind="${tipo}">${icono(tipo)}<div><strong>${esc(titulo)}</strong><p>${esc(detalle)}</p></div><div class="sites-notificaciones-row-actions">${accion}</div></div>`;
    }

    function entradaServicio(item) {
        const final = item.estado === "completada" ? "✓ Realizado" : item.estado === "cancelada" ? "Cancelado" : "";
        const acciones = final ? `<span class="sites-notificaciones-status">${final}</span>` : accionesServicio(item);
        return `<div class="sites-notificaciones-entry"><div class="sites-notificaciones-entry-main">
            <span class="sites-notificaciones-hour">${esc(item.hora || "—")}</span><strong>${esc(item.nombre || "Servicio")}</strong></div>
            <small>Cabaña ${esc(item.numeroCabana || "—")}${item.titular ? ` · ${esc(item.titular)}` : ""}</small>
            ${acciones ? `<div class="sites-notificaciones-entry-actions">${acciones}</div>` : ""}</div>`;
    }
    function entradaCheckin(item) {
        const ocupacion = Number.isFinite(Number(item.adultos))
            ? ` · ${Number(item.adultos)} adultos${Number(item.ninos) > 0 ? ` · ${Number(item.ninos)} niños` : ""}` : "";
        const detalle = `Check-in pendiente${item.hora ? ` · ${item.hora}` : ""}${item.codigoHaiku ? ` · ${item.codigoHaiku}` : ""}${ocupacion}`;
        const accion = accionCabana(item);
        return `<div class="sites-notificaciones-entry"><strong>Cabaña ${esc(item.numeroCabana)} · ${esc(item.titular || "Sin titular")}</strong>
            <small>${esc(detalle)}</small>${accion ? `<div class="sites-notificaciones-entry-actions">${accion}</div>` : ""}</div>`;
    }
    function entradaPago(item) {
        const contexto = item.tipo === "checkin" ? "Check-in" : "Servicios de check-out";
        return `<div class="sites-notificaciones-entry"><strong>Cabaña ${esc(item.numeroCabana)} · ${esc(item.titular || "Sin titular")}</strong>
            <small>Saldo ${esc(moneda(item.monto))} · ${contexto}</small>${accionPago(item) ? `<div class="sites-notificaciones-entry-actions">${accionPago(item)}</div>` : ""}</div>`;
    }
    function entradaBove(item) {
        const detalle = `BOVE alojamiento pendiente${item.reservaId ? ` · ${item.reservaId}` : ""}`;
        const accion = accionBove(item);
        return `<div class="sites-notificaciones-entry"><strong>Cabaña ${esc(item.numeroCabana)} · ${esc(item.titular || "Sin titular")}</strong>
            <small>${esc(detalle)}</small>${accion ? `<div class="sites-notificaciones-entry-actions">${accion}</div>` : ""}</div>`;
    }
    function grupo(clave, titulo, tipo, lista, listo, renderizarEntrada, abiertos) {
        const contenido = !listo ? "Actualizando datos del turno…" : !lista.length ? "Sin pendientes para esta fecha." : "";
        return `<details class="sites-notificaciones-group" data-sites-noti-grupo="${clave}" ${abiertos.includes(clave) ? "open" : ""}>
            <summary>${icono(tipo)}<span class="sites-notificaciones-group-title">${titulo}</span>
                <span class="sites-notificaciones-group-count">${listo ? lista.length : "…"}</span>
                <span class="sites-notificaciones-chevron" aria-hidden="true">›</span></summary>
            <div class="sites-notificaciones-list">${contenido ? `<div class="sites-notificaciones-empty">${contenido}</div>` : lista.map(renderizarEntrada).join("")}</div>
        </details>`;
    }

    function renderizar() {
        const datos = leer();
        const firma = JSON.stringify({ fecha: datos.fecha,
            servicios: datos.servicios.map(item => [item.id, item.numeroCabana, item.nombre,
                item.titular, item.hora, item.categoria, item.estado]),
            checkins: datos.checkins, pagos: datos.pagos, boves: datos.boves,
            pagosListos: datos.pagosListos, bovesListos: datos.bovesListos,
            pagoPermitido: window.haikuTienePermiso?.("pagos.registrar"),
            bovePermitido: window.haikuTienePermiso?.("pagos.verificar") });
        if (firma === firmaAnterior) return datos;
        const abiertos = [...cuerpo.querySelectorAll(".sites-notificaciones-group[open]")]
            .map(grupo => grupo.dataset.sitesNotiGrupo);
        const scroll = cuerpo.scrollTop;
        turno.textContent = fechaRotulo(datos.fecha);
        badge.textContent = String(datos.atencion.length);
        badge.hidden = datos.atencion.length === 0;
        boton.setAttribute("aria-label", `Centro de notificaciones: ${datos.atencion.length} asuntos requieren atención`);
        cuerpo.innerHTML = `<section class="sites-notificaciones-section" aria-label="Requiere atención">
            <h3 class="sites-notificaciones-heading"><span>Requiere atención</span><span class="sites-notificaciones-total">${datos.atencion.length} ${datos.atencion.length === 1 ? "asunto" : "asuntos"}</span></h3>
            ${datos.atencion.length ? datos.atencion.map(resumenAtencion).join("") :
                `<div class="sites-notificaciones-empty">${!datos.pagosListos || !datos.bovesListos ? "Actualizando datos del turno…" : "Sin asuntos pendientes para esta fecha."}</div>`}
        </section><section class="sites-notificaciones-section" aria-label="Actividad del turno">
            <h3 class="sites-notificaciones-heading">Actividad del turno</h3>
            <div class="sites-notificaciones-activity">
                ${grupo("servicios", "Servicios del día", "servicio", datos.servicios, true, entradaServicio, abiertos)}
                ${grupo("checkin", "Check-in pendientes", "checkin", datos.checkins, true, entradaCheckin, abiertos)}
                ${grupo("pagos", "Pagos pendientes", "pago", datos.pagos, datos.pagosListos, entradaPago, abiertos)}
                ${grupo("bove", "BOVE pendientes", "bove", datos.boves, datos.bovesListos, entradaBove, abiertos)}
            </div></section>`;
        cuerpo.scrollTop = scroll;
        fechaAnterior = datos.fecha;
        firmaAnterior = firma;
        return datos;
    }

    function programar(ms = 30) {
        clearTimeout(espera);
        espera = setTimeout(renderizar, ms);
    }
    function cerrar() {
        if (drawer.hidden) return;
        drawer.hidden = true;
        overlay.hidden = true;
        document.body.style.overflow = overflowAnterior;
        boton.setAttribute("aria-expanded", "false");
        if (disparador?.isConnected) disparador.focus({ preventScroll: true });
    }
    function abrir() {
        if (!drawer.hidden) return;
        disparador = boton;
        overflowAnterior = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        renderizar();
        overlay.hidden = false;
        drawer.hidden = false;
        boton.setAttribute("aria-expanded", "true");
        cerrarBoton.focus({ preventScroll: true });
        const fecha = fechaActual();
        if (fecha && window.haikuSesion) {
            window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1?.refrescar?.(fecha)?.catch?.(() => {});
        }
    }

    function reabrirTrasCerrar(panel) {
        if (!panel || panel.hidden) {
            setTimeout(abrir, 0);
            return;
        }
        const observador = new MutationObserver(() => {
            if (!panel.hidden) return;
            observador.disconnect();
            setTimeout(abrir, 0);
        });
        observador.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
    }

    async function abrirBoveReal(item) {
        cerrar();
        document.querySelector('.menu-item[data-seccion="pagos"]')?.click();
        window.HAIKU_SITES_PAGOS_V1?.refrescar?.();
        const inicio = Date.now();
        while (Date.now() - inicio < 5000 && fechaActual() === fechaAnterior) {
            const tarjetas = [...document.querySelectorAll("#pagos-lista-checkin > .haiku-saldo-v5")];
            const tarjeta = tarjetas.find(card => !card.hidden &&
                (card.dataset.reservaId === item.reservaId ||
                    String(card.dataset.miembros || "").split(",").includes(item.reservaId)));
            const accion = tarjeta?.querySelector(".sites-pagos-abrir-bove");
            if (accion) {
                tarjeta.querySelector(".sites-pagos-detalle")?.setAttribute("open", "");
                accion.click();
                reabrirTrasCerrar(document.querySelector(".sites-pagos-bove"));
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.warn("HAIKU · El BOVE ya no está disponible en el detalle de Pagos:", item.reservaId);
        abrir();
        return false;
    }

    async function abrirAccionServicio(item, accion, fecha) {
        const atributo = accion === "realizar" ? "data-sites-servicios-realizar" : "data-sites-servicios-cancelar";
        cerrar();
        document.querySelector('.menu-item[data-seccion="servicios"]')?.click();
        try { await Promise.resolve(window.HAIKU_SITES_SERVICIOS_V1?.refrescar?.()); } catch (_) {}
        const campoFecha = document.getElementById("sites-servicios-fecha");
        if (campoFecha && campoFecha.value !== fecha) {
            campoFecha.value = fecha;
            campoFecha.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const inicio = Date.now();
        while (Date.now() - inicio < 5000 && fechaActual() === fecha) {
            const botonReal = [...document.querySelectorAll(`[${atributo}]`)]
                .find(nodo => nodo.getAttribute(atributo) === String(item.id));
            if (botonReal) {
                botonReal.click(); // El módulo Sites abre su confirmación y ejecuta su RPC protegido.
                reabrirTrasCerrar(document.getElementById(
                    accion === "realizar" ? "sites-servicios-realizado" : "sites-servicios-cancelar"));
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.warn("HAIKU · La acción del servicio ya no está disponible:", item.id);
        abrir();
        return false;
    }

    async function ejecutar(accion, clave) {
        const datos = leer();
        if (accion === "pago") {
            const item = datos.pagos.find(pago => clavePago(pago) === clave);
            if (!item) return;
            cerrar();
            const apertura = window.HAIKU_RESUMEN_PAGO_SITES_V1?.abrirPagoReserva?.(
                item.reservaId, item.tipo === "checkin" ? "checkin" : "checkout", item.numeroCabana, boton);
            reabrirTrasCerrar(document.querySelector(".sites-resumen-pago-drawer"));
            await apertura;
            return;
        }
        if (accion === "bove") {
            const item = datos.boves.find(bove => claveBove(bove) === clave);
            if (item) await abrirBoveReal(item);
            return;
        }
        if (accion === "cabana") {
            const ficha = botonCabana(clave);
            if (ficha) { cerrar(); ficha.click(); }
            return;
        }
        const item = datos.servicios.find(servicio => claveServicio(servicio) === clave);
        if (!item || ["completada", "cancelada"].includes(item.estado)) return;
        if (accion === "realizar" && window.haikuTienePermiso?.("servicios.editar") === true)
            await abrirAccionServicio(item, accion, datos.fecha);
        if (accion === "cancelar" && window.haikuTienePermiso?.("servicios.cancelar") === true &&
            ["tinaja", "masaje"].includes(String(item.categoria || "").toLowerCase()))
            await abrirAccionServicio(item, accion, datos.fecha);
    }

    // Captura antes del listener del popover original: éste nunca se abre ni un frame.
    boton.addEventListener("click", evento => {
        evento.preventDefault();
        evento.stopImmediatePropagation();
        drawer.hidden ? abrir() : cerrar();
    }, true);
    cerrarBoton.addEventListener("click", cerrar);
    overlay.addEventListener("click", cerrar);
    document.addEventListener("keydown", evento => {
        if (drawer.hidden) return;
        if (evento.key === "Escape") {
            evento.preventDefault();
            evento.stopImmediatePropagation();
            cerrar();
        } else if (evento.key === "Tab") {
            const controles = [...drawer.querySelectorAll("button, summary")]
                .filter(nodo => !nodo.disabled && nodo.getClientRects().length);
            if (!controles.length) return;
            if (evento.shiftKey && document.activeElement === controles[0]) {
                evento.preventDefault(); controles.at(-1).focus();
            } else if (!evento.shiftKey && document.activeElement === controles.at(-1)) {
                evento.preventDefault(); controles[0].focus();
            }
        }
    }, true);
    cuerpo.addEventListener("click", evento => {
        const accion = evento.target.closest?.("[data-sites-noti-accion]");
        if (!accion) return;
        evento.preventDefault();
        evento.stopPropagation();
        ejecutar(accion.dataset.sitesNotiAccion, accion.dataset.sitesNotiClave)
            .catch(error => console.error("HAIKU · Acción de notificaciones:", error));
    });

    const actualizarBase = window.actualizarNotificaciones;
    if (typeof actualizarBase === "function") {
        window.actualizarNotificaciones = function (...args) {
            const resultado = actualizarBase.apply(this, args);
            programar(0);
            return resultado;
        };
    }
    for (const nombre of ["haiku:servicios-hidratados", "haiku:servicio-supabase-cambiado",
        "haiku:resumen-pagos-actualizados", "haiku:resumen-datos-actualizados"]) {
        document.addEventListener(nombre, () => programar(30));
    }
    window.addEventListener("haiku:auth-ready", () => programar(60));
    window.addEventListener("haiku:bove-actualizado", () => {
        window.HAIKU_BOVES_PENDIENTES_SUPABASE_V1?.refrescar?.(fechaActual())?.catch?.(() => {});
        programar(60);
    });
    window.addEventListener("focus", () => programar(30));
    setInterval(() => {
        const fecha = fechaActual();
        if (fecha !== fechaAnterior) {
            programar(0);
            if (fecha && window.haikuSesion)
                window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1?.refrescar?.(fecha)?.catch?.(() => {});
        } else if (!drawer.hidden) programar(0);
    }, 15000);
    window.HAIKU_SITES_NOTIFICACIONES_V1 = Object.freeze({ abrir, cerrar, renderizar, leer });
    renderizar();
})();
