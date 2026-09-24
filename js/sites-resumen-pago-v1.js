// Pago desde Resumen: drawer Sites sobre los controladores financieros existentes.
(() => {
    "use strict";
    if (window.HAIKU_RESUMEN_PAGO_SITES_V1) return;

    const MEDIOS = ["Transferencia", "WebPay Crédito", "WebPay Débito",
        "Tarjeta Crédito", "Tarjeta Débito", "Efectivo"];
    let drawer = null;
    let actual = null;
    let guardando = false;
    let secuencia = 0;
    const escapar = valor => String(valor ?? "").replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
    const dinero = valor => `$${Math.round(Number(valor || 0)).toLocaleString("es-CL")}`;
    const fechaActual = () => {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    };

    function crearDrawer() {
        if (drawer) return drawer;
        drawer = document.createElement("div");
        drawer.className = "sites-resumen-drawer sites-resumen-pago-drawer";
        drawer.dataset.sitesDrawer = "pago";
        drawer.hidden = true;
        drawer.setAttribute("role", "presentation");
        drawer.innerHTML = `
            <section class="sites-resumen-drawer-panel sites-resumen-pago-panel" role="dialog"
                aria-modal="true" aria-labelledby="sites-resumen-pago-titulo" tabindex="-1">
                <header class="sites-resumen-drawer-head">
                    <div><small class="sites-resumen-drawer-kicker" data-pago-kicker>Control financiero</small>
                    <h2 id="sites-resumen-pago-titulo">Registrar pago</h2></div>
                    <button type="button" class="sites-resumen-drawer-close" data-pago-cerrar aria-label="Cerrar">×</button>
                </header>
                <div class="sites-resumen-drawer-body sites-resumen-pago-body" data-pago-contenido></div>
                <footer class="sites-resumen-drawer-footer sites-resumen-pago-footer">
                    <button type="button" class="sites-resumen-pago-cancelar" data-pago-cerrar>Cerrar</button>
                    <button type="button" class="sites-resumen-pago-confirmar" data-pago-confirmar disabled>Registrar pago</button>
                </footer>
            </section>`;
        document.body.appendChild(drawer);
        drawer.querySelectorAll("[data-pago-cerrar]").forEach(boton =>
            boton.addEventListener("click", cerrar));
        drawer.querySelector("[data-pago-confirmar]").addEventListener("click", confirmar);
        drawer.addEventListener("change", evento => {
            if (evento.target.matches("[data-pago-medio]")) actualizarCampos();
        });
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.registrar?.(drawer, {
            cerrar,
            focoInicial: () => drawer.querySelector("[data-pago-monto]") ||
                drawer.querySelector("[data-pago-cerrar]")
        });
        return drawer;
    }

    function cerrar() {
        if (guardando || !drawer) return;
        drawer.hidden = true;
        actual = null;
        ++secuencia;
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.sincronizar?.();
    }

    function estado(mensaje, tipo = "") {
        const campo = drawer?.querySelector("[data-pago-estado]");
        if (campo) {
            campo.textContent = mensaje;
            campo.dataset.tipo = tipo;
        }
    }

    async function identidadReal({ cabana, reservaId, etapa, fecha, origenPagos, fechaDisparador }) {
        if (fecha !== fechaActual()) throw new Error("La fecha seleccionada cambió. Vuelve a abrir el pago.");
        if (origenPagos && fechaDisparador !== fecha) {
            throw new Error("La fecha del pago cambió. Vuelve a abrir la acción desde Pagos.");
        }
        const cliente = window.haikuSupabase;
        if (!cliente || !window.haikuSesion) throw new Error("Debes iniciar sesión para registrar pagos.");
        const { data, error } = await cliente.rpc("haiku_operacion_dia", { p_fecha: fecha });
        if (error) throw error;
        if (fecha !== fechaActual()) throw new Error("La fecha seleccionada cambió. Vuelve a abrir el pago.");
        const fila = (data || []).find(item => Number(item.numero) === Number(cabana));
        if (!fila) throw new Error("La cabaña ya no aparece en el día seleccionado.");
        const estado = String(fila.estado_operativo || "");
        const esCheckin = ["libre-ingresa", "sale-ingresa", "fullday"].includes(estado);
        const identidades = etapa === "checkin" && esCheckin
            ? [{ id: estado === "fullday" ? fila.fullday_reserva_id : fila.ingreso_reserva_id,
                titular: estado === "fullday" ? fila.fullday_titular : fila.ingreso_titular }]
            : etapa === "checkout" && (["sale-libre", "sale-ingresa", "fullday"].includes(estado))
                ? [{ id: estado === "fullday" ? fila.fullday_reserva_id : fila.salida_reserva_id,
                    titular: estado === "fullday" ? fila.fullday_titular : fila.salida_titular }]
                : etapa === "abono" && estado === "continua"
                    ? [{ id: fila.continua_reserva_id, titular: fila.continua_titular }]
                    : etapa === "abono" && origenPagos
                        ? [
                            ...(["libre-ingresa", "sale-ingresa"].includes(estado)
                                ? [{ id: fila.ingreso_reserva_id, titular: fila.ingreso_titular }] : []),
                            ...(["sale-libre", "sale-ingresa"].includes(estado)
                                ? [{ id: fila.salida_reserva_id, titular: fila.salida_titular }] : []),
                            ...(estado === "fullday"
                                ? [{ id: fila.fullday_reserva_id, titular: fila.fullday_titular }] : [])
                        ] : [];
        const coincidencia = identidades.find(item => String(item.id || "") === reservaId);
        if (!coincidencia) {
            throw new Error("La reserva o la etapa de cobro cambió. Vuelve a abrir el pago.");
        }
        return { fila, titular: coincidencia.titular || "" };
    }

    async function contextoValidado(solicitud) {
        const { titular: titularDia } = await identidadReal(solicitud);
        let operador, tipo, contexto;
        if (solicitud.etapa === "checkout") {
            operador = window.HAIKU_PAGO_CHECKOUT_RESUMEN_V1;
            tipo = "checkout";
            contexto = await operador?.contexto(solicitud.reservaId, solicitud.fecha);
        } else if (solicitud.etapa === "abono") {
            const abono = window.HAIKU_PAGO_GRUPO_V1;
            operador = abono && {
                contexto: abono.contextoResumen,
                registrar: abono.registrarResumen,
                requisitos: abono.requisitosResumen,
                fechaPagoPredeterminada: abono.fechaPagoPredeterminada
            };
            tipo = "abono";
            contexto = await operador?.contexto(solicitud.reservaId, solicitud.fecha,
                solicitud.origenPagos ? "pagos" : "resumen", solicitud.cabana);
        } else {
            const grupo = window.HAIKU_PAGO_CHECKIN_GRUPO_RESUMEN_V1;
            if (!grupo) throw new Error("El módulo de pagos conjuntos no está disponible.");
            contexto = await grupo.contexto(solicitud.reservaId, solicitud.fecha);
            if (contexto) {
                operador = grupo;
                tipo = "checkin-grupo";
            } else {
                operador = window.HAIKU_PAGO_CHECKIN_RESUMEN_V1;
                tipo = "checkin";
                contexto = await operador?.contexto(solicitud.reservaId, solicitud.fecha);
            }
        }
        if (!operador || !contexto) {
            throw new Error("No hay un cobro disponible para esta reserva y etapa en el día seleccionado.");
        }
        if (solicitud.fecha !== fechaActual()) {
            throw new Error("La fecha seleccionada cambió. Vuelve a abrir el pago.");
        }
        const cabanas = contexto.cabanas || [contexto.cabana];
        if (!cabanas.map(Number).includes(Number(solicitud.cabana))) {
            throw new Error("El cobro ya no corresponde a esta cabaña.");
        }
        return { ...solicitud, operador, tipo, contexto,
            titular: titularDia || contexto.titular || "Sin titular" };
    }

    function formulario() {
        const { contexto, tipo, cabana, titular, fecha, reservaId } = actual;
        const saldo = Number(contexto.saldo || 0), total = Number(contexto.total || 0);
        const alcance = contexto.cabanas?.length > 1
            ? `Reserva conjunta · ${contexto.cabanas.map(numero => `CAB ${numero}`).join(" + ")}`
            : tipo === "checkout" ? "Servicios de check-out" :
                tipo === "abono" ? "Abono de alojamiento" : "Alojamiento de check-in";
        const permitido = window.haikuTienePermiso?.("pagos.registrar") &&
            (tipo === "abono" || window.haikuTienePermiso?.("pagos.verificar"));
        const medios = tipo === "abono" ? [...MEDIOS, "Otro"] : MEDIOS;
        drawer.querySelector("[data-pago-kicker]").textContent = `Cabaña ${cabana}`;
        drawer.querySelector("[data-pago-contenido]").innerHTML = `
            <p class="sites-resumen-pago-intro"><strong>${escapar(titular)}</strong> · CAB ${escapar(cabana)}
                <span>${escapar(alcance)} · ${escapar(fecha)}</span></p>
            <p class="sites-resumen-pago-reserva">Reserva: ${escapar(reservaId)}</p>
            <div class="sites-resumen-pago-resumen">
                <div><span>Total</span><strong>${dinero(total)}</strong></div>
                ${actual.origenPagos ? "" :
                    `<div><span>Abonado</span><strong>${dinero(Math.max(0, total - saldo))}</strong></div>`}
                <div><span>Saldo pendiente</span><strong>${dinero(saldo)}</strong></div>
            </div>
            ${saldo > 0 ? `<div class="sites-resumen-pago-formulario">
                ${tipo === "abono" ? `<label>Fecha del pago<input data-pago-fecha type="date" value="${escapar(actual.operador.fechaPagoPredeterminada())}"></label>` : ""}
                <label>Monto de este pago<input data-pago-monto type="number" min="1" max="${saldo}" step="1" inputmode="numeric" value="${saldo}"></label>
                <label>Medio de pago<select data-pago-medio><option value="">Seleccionar...</option>
                    ${medios.map(nombre => `<option value="${escapar(nombre)}">${escapar(nombre)}</option>`).join("")}
                </select></label>
                <label data-pago-campo="glosa" hidden>Glosa<input data-pago-glosa type="text" placeholder="Pegar glosa bancaria"></label>
                <label data-pago-campo="folio" hidden>Folio<input data-pago-folio type="text" placeholder="Folio de transacción"></label>
                <label data-pago-campo="bovtar" hidden>BOVTAR<input data-pago-bovtar type="text" placeholder="Código BOVTAR"></label>
                <label data-pago-campo="codaut" hidden>CodAut<input data-pago-codaut type="text" placeholder="Código de autorización"></label>
                ${tipo === "abono" ? `<label>Nota opcional<textarea data-pago-observacion placeholder="Ej: Abono recibido por titular..."></textarea></label>` :
                    `<label class="sites-resumen-pago-manager"><input data-pago-manager type="checkbox"><span>Manager revisó este pago</span></label>`}
            </div>` : `<p class="sites-resumen-pago-aviso">No hay saldo pendiente de cobro para esta reserva.</p>`}
            ${!permitido ? `<p class="sites-resumen-pago-aviso">${tipo === "abono" ?
                "Tu usuario no tiene permiso para registrar pagos." :
                "Tu usuario no tiene permiso para registrar y verificar pagos como Manager."}</p>` : ""}
            <p class="sites-resumen-pago-estado" data-pago-estado role="status" aria-live="polite"></p>`;
        drawer.querySelector("[data-pago-confirmar]").disabled = !(saldo > 0 && permitido);
    }

    function actualizarCampos() {
        if (!actual || !drawer) return;
        const medio = drawer.querySelector("[data-pago-medio]")?.value || "";
        const req = actual.operador.requisitos(medio);
        for (const [campo, obligatorio] of Object.entries({
            glosa: req.glosa, folio: req.folio,
            bovtar: req.bovtar, codaut: req.codAut || req.codaut
        })) {
            const fila = drawer.querySelector(`[data-pago-campo="${campo}"]`);
            if (!fila) continue;
            fila.hidden = !obligatorio;
            fila.querySelector("input").required = Boolean(obligatorio);
        }
    }

    function datosFormulario() {
        const leer = nombre => drawer.querySelector(`[data-pago-${nombre}]`)?.value.trim() || "";
        return {
            monto: Number(leer("monto")), medio: leer("medio"),
            fechaPago: leer("fecha"), observacion: leer("observacion"),
            glosa: leer("glosa"), folio: leer("folio"),
            bovtar: leer("bovtar"), codAut: leer("codaut"), codaut: leer("codaut"),
            manager: drawer.querySelector("[data-pago-manager]")?.checked === true
        };
    }

    function errorFormulario(pago, datos) {
        if (!window.haikuTienePermiso?.("pagos.registrar") ||
            (pago.tipo !== "abono" && !window.haikuTienePermiso?.("pagos.verificar"))) {
            return "Tu usuario ya no tiene permiso para registrar este pago.";
        }
        const saldo = Number(pago.contexto.saldo || 0);
        if (!Number.isInteger(datos.monto) || datos.monto <= 0 || datos.monto > saldo) {
            return `El monto debe ser un número entero entre $1 y ${dinero(saldo)}.`;
        }
        const medios = pago.tipo === "abono" ? [...MEDIOS, "Otro"] : MEDIOS;
        if (!medios.includes(datos.medio)) return "Selecciona un medio de pago válido.";
        if (pago.tipo === "abono") {
            const fecha = datos.fechaPago;
            const interpretada = /^\d{4}-\d{2}-\d{2}$/.test(fecha)
                ? new Date(`${fecha}T12:00:00.000Z`) : null;
            if (!interpretada || Number.isNaN(interpretada.getTime()) ||
                interpretada.toISOString().slice(0, 10) !== fecha) {
                return "Selecciona una fecha de pago válida.";
            }
        } else if (!datos.manager) {
            return "Manager debe revisar el pago antes de registrarlo.";
        }
        const requisitos = pago.operador.requisitos(datos.medio);
        if (requisitos.glosa && !datos.glosa) return "Ingresa la glosa de la transferencia.";
        if (requisitos.folio && !datos.folio) return "Ingresa el Folio del pago.";
        if (requisitos.bovtar && !datos.bovtar) return "Ingresa el BOVTAR del pago.";
        if ((requisitos.codAut || requisitos.codaut) && !datos.codAut) {
            return "Ingresa el CodAut del pago.";
        }
        return "";
    }

    async function abrirPagoReserva(reservaId, etapa = "", cabana = "", boton = null) {
        const id = String(reservaId || "").trim(), fecha = fechaActual();
        if (!id || !["checkin", "checkout", "abono"].includes(etapa) || !Number(cabana) || !fecha ||
            !window.haikuTienePermiso?.("pagos.registrar")) return false;
        const panel = crearDrawer(), turno = ++secuencia;
        actual = null;
        panel.querySelector("[data-pago-contenido]").innerHTML =
            `<p class="sites-resumen-pago-estado" data-pago-estado role="status">Verificando reserva y saldo...</p>`;
        panel.querySelector("[data-pago-confirmar]").disabled = true;
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.marcarDisparador?.(panel, boton);
        panel.hidden = false;
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.sincronizar?.();
        try {
            const contexto = await contextoValidado({ reservaId: id, etapa,
                cabana: Number(cabana), fecha, boton,
                origenPagos: boton?.dataset?.sitesPagosOrigen === "1",
                fechaDisparador: boton?.dataset?.sitesPagosFecha || "" });
            if (turno !== secuencia || panel.hidden) return true;
            actual = contexto;
            formulario();
            actualizarCampos();
            if (typeof requestAnimationFrame === "function") {
                requestAnimationFrame(() => {
                    if (turno === secuencia && !panel.hidden &&
                        panel.contains(document.activeElement)) {
                        panel.querySelector("[data-pago-monto]")?.focus();
                    }
                });
            }
            return true;
        } catch (error) {
            if (turno !== secuencia || panel.hidden) return true;
            estado(error?.message || "No fue posible verificar el cobro.", "error");
            return false;
        }
    }

    async function confirmar() {
        if (guardando || !actual) return;
        const previo = actual, boton = drawer.querySelector("[data-pago-confirmar]");
        if (boton.disabled) return;
        const datos = datosFormulario();
        const errorLocal = errorFormulario(previo, datos);
        if (errorLocal) {
            estado(errorLocal, "error");
            return;
        }
        const controles = [...drawer.querySelectorAll(
            ".sites-resumen-pago-formulario input, .sites-resumen-pago-formulario select, .sites-resumen-pago-formulario textarea"
        )];
        const deshabilitados = controles.map(control => control.disabled);
        guardando = true;
        boton.disabled = true;
        boton.textContent = "Verificando...";
        controles.forEach(control => { control.disabled = true; });
        try {
            if (!previo.boton?.isConnected || previo.boton.hidden ||
                previo.boton.dataset.resumenPagoReservaId !== previo.reservaId ||
                previo.boton.dataset.resumenPagoEtapa !== previo.etapa ||
                Number(previo.boton.dataset.resumenPago) !== previo.cabana ||
                (previo.origenPagos &&
                    (previo.boton.dataset.sitesPagosOrigen !== "1" ||
                        previo.boton.dataset.sitesPagosFecha !== previo.fechaDisparador))) {
                throw new Error("La acción de esta cabaña cambió. Vuelve a abrir el pago.");
            }
            const vigente = await contextoValidado(previo);
            if (vigente.tipo !== previo.tipo ||
                vigente.contexto.total !== previo.contexto.total ||
                vigente.contexto.saldo !== previo.contexto.saldo ||
                JSON.stringify(vigente.contexto.miembros || []) !==
                    JSON.stringify(previo.contexto.miembros || []) ||
                JSON.stringify(vigente.contexto.cargos || []) !==
                    JSON.stringify(previo.contexto.cargos || [])) {
                throw new Error("El saldo o la reserva cambió. Vuelve a abrir el pago.");
            }
            if (JSON.stringify(datosFormulario()) !== JSON.stringify(datos)) {
                throw new Error("Los datos del pago cambiaron durante la verificación. Vuelve a abrir el pago.");
            }
            boton.textContent = "Registrando...";
            if (vigente.tipo === "abono") {
                await vigente.operador.registrar(vigente.reservaId, datos, vigente.fecha,
                    vigente.origenPagos ? "pagos" : "resumen", vigente.cabana);
            } else {
                await vigente.operador.registrar(vigente.reservaId, datos, vigente.fecha);
            }
            actual = null;
            estado(`Pago de ${dinero(datos.monto)} registrado. Cierra y vuelve a abrir para consultar el saldo actualizado.`, "exito");
            Promise.allSettled([
                Promise.resolve().then(() => window.haikuSincronizarReservasSupabase?.()),
                Promise.resolve().then(() => window.HAIKU_RESUMEN_SITES_V1?.refrescar?.())
            ]);
        } catch (error) {
            actual = null;
            estado(`${error?.message || "No fue posible confirmar el pago."} Cierra y vuelve a abrir para verificar el saldo antes de reintentar.`, "error");
        } finally {
            controles.forEach((control, indice) => { control.disabled = deshabilitados[indice]; });
            guardando = false;
            boton.textContent = "Registrar pago";
            boton.disabled = true;
        }
    }

    document.addEventListener("click", evento => {
        const boton = evento.target.closest?.("[data-resumen-pago-reserva-id]");
        if (!boton) return;
        evento.preventDefault();
        abrirPagoReserva(boton.dataset.resumenPagoReservaId,
            boton.dataset.resumenPagoEtapa || "", boton.dataset.resumenPago || "", boton);
    });

    window.HAIKU_RESUMEN_PAGO_SITES_V1 = Object.freeze({ abrirPagoReserva, cerrar });
})();
