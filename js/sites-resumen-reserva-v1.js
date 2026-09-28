// Ficha compartida de Resumen, Reservas y Calendario. Los cambios de estado
// se escriben sólo mediante la RPC segura; Hospedado/Check-out omiten el aviso.
(() => {
    "use strict";

    if (window.HAIKU_RESUMEN_RESERVA_SITES_V1) return;

    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const FECHA = /^\d{4}-\d{2}-\d{2}$/;
    const OMITIDOS = new Set(["cancelado", "cancelada", "anulado", "anulada", "no_show"]);
    const estado = { version: 0, reservaId: null, identidad: null, ficha: null,
        estadia: null, ocupado: false, drawer: null, cambio: null };
    const manual = window.HAIKU_RESERVA_ESTADO_MANUAL_V1;

    function fechaActiva() {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    }

    function fechaVisible(valor) {
        const fecha = String(valor || "").slice(0, 10);
        if (!FECHA.test(fecha)) return "—";
        const [a, m, d] = fecha.split("-").map(Number);
        return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric" })
            .format(new Date(a, m - 1, d, 12));
    }

    function dinero(valor) {
        return `$${Number(valor || 0).toLocaleString("es-CL")}`;
    }

    function elegirEstadia(ficha, identidad) {
        return (Array.isArray(ficha?.estadias) ? ficha.estadias : []).find(estadia =>
            String(estadia.id) === identidad.estadiaId &&
            Number(estadia.cabana_numero) === Number(identidad.numeroCabana)
        ) || null;
    }

    function identidadOperacion(fila) {
        const claves = {
            "libre-ingresa": ["ingreso_reserva_id", "ingreso_estadia_id"],
            "sale-ingresa": ["ingreso_reserva_id", "ingreso_estadia_id"],
            "sale-libre": ["salida_reserva_id", "salida_estadia_id"],
            continua: ["continua_reserva_id", "continua_estadia_id"],
            fullday: ["fullday_reserva_id", "fullday_estadia_id"]
        }[String(fila?.estado_operativo || "")];
        return claves ? {
            reservaId: String(fila[claves[0]] || ""),
            estadiaId: String(fila[claves[1]] || ""),
            estadoOperativo: String(fila.estado_operativo || "")
        } : null;
    }

    function capturar(boton) {
        const fila = boton?.closest?.(".sites-resumen-cabana[data-cabana]");
        const numeroCabana = String(fila?.dataset.cabana || "");
        const fecha = String(fila?.dataset.resumenFecha || "");
        const reservaId = String(fila?.dataset.resumenReservaId || "");
        const estadiaId = String(fila?.dataset.resumenEstadiaId || "");
        const estadoOperativo = String(fila?.querySelector('[data-campo="estado"]')?.value || "");
        if (!fila || boton.hidden || !/^\d{1,2}$/.test(numeroCabana) ||
            !FECHA.test(fecha) || fecha !== fechaActiva() ||
            !UUID.test(reservaId) || !UUID.test(estadiaId) ||
            !["libre-ingresa", "sale-ingresa", "sale-libre", "continua", "fullday"].includes(estadoOperativo)) {
            return null;
        }
        return { numeroCabana, fecha, reservaId, estadiaId, estadoOperativo };
    }

    function filaActual(identidad) {
        const fila = document.querySelector(
            `#seccion-resumen .sites-resumen-cabana[data-cabana="${identidad.numeroCabana}"]`
        );
        const boton = fila?.querySelector("[data-ficha-cabana]");
        return fila && boton && !boton.hidden &&
            fila.dataset.resumenFecha === identidad.fecha &&
            fila.dataset.resumenReservaId === identidad.reservaId &&
            fila.dataset.resumenEstadiaId === identidad.estadiaId &&
            String(fila.querySelector('[data-campo="estado"]')?.value || "") === identidad.estadoOperativo
            ? fila : null;
    }

    async function revalidar(identidad) {
        if (identidad.origen === "reservas") {
            if (!window.haikuSesion || !window.haikuSupabase ||
                window.haikuTienePermiso?.("reservas.ver") !== true ||
                typeof window.haikuLeerFichaSupabaseV2 !== "function") {
                throw new Error("El permiso o la lectura de reservas cambiaron. Reabre la ficha.");
            }
            const ficha = await window.haikuLeerFichaSupabaseV2(identidad.reservaId);
            const estadia = elegirEstadia(ficha, identidad);
            if (!window.haikuSesion || window.haikuTienePermiso?.("reservas.ver") !== true ||
                String(ficha?.reserva?.id || "") !== identidad.reservaId || !estadia ||
                (estadia.reserva_id && String(estadia.reserva_id) !== identidad.reservaId) ||
                String(estadia.fecha_ingreso || "").slice(0, 10) !== identidad.fechaIngreso ||
                String(estadia.fecha_salida || "").slice(0, 10) !== identidad.fechaSalida ||
                String(estadia.tipo_estadia || "") !== identidad.tipoEstadia ||
                String(ficha.reserva.estado_reserva || "") !== identidad.estadoReserva) {
                throw new Error("La reserva o su estadía cambiaron. Actualiza Reservas y vuelve a abrirla.");
            }
            return ficha;
        }
        if (!window.haikuSesion || !window.haikuSupabase ||
            window.haikuTienePermiso?.("reservas.ver") !== true ||
            fechaActiva() !== identidad.fecha || !filaActual(identidad)) {
            throw new Error("El día, la reserva o el permiso cambiaron. Reabre la ficha desde el Resumen.");
        }
        const { data, error } = await window.haikuSupabase.rpc("haiku_operacion_dia", {
            p_fecha: identidad.fecha
        });
        if (error) throw error;
        const filas = (Array.isArray(data) ? data : []).filter(fila =>
            Number(fila.numero) === Number(identidad.numeroCabana)
        );
        const actual = filas.length === 1 ? identidadOperacion(filas[0]) : null;
        if (!actual || actual.reservaId !== identidad.reservaId ||
            actual.estadiaId !== identidad.estadiaId ||
            actual.estadoOperativo !== identidad.estadoOperativo ||
            fechaActiva() !== identidad.fecha || !filaActual(identidad)) {
            throw new Error("La reserva o su estadía cambiaron. Actualiza el Resumen y vuelve a abrirla.");
        }
        return actual;
    }

    function crearDrawer() {
        if (estado.drawer) return estado.drawer;
        const drawer = document.createElement("div");
        drawer.id = "sites-resumen-reserva-drawer";
        drawer.className = "sites-resumen-drawer sites-resumen-reserva-drawer";
        drawer.dataset.sitesDrawer = "";
        drawer.dataset.haikuInspectorSuperficie = "reserva";
        drawer.hidden = true;
        drawer.innerHTML = `
            <section class="sites-resumen-drawer-panel" role="dialog" aria-modal="true"
                aria-labelledby="sites-resumen-reserva-titulo" tabindex="-1">
                <header class="sites-resumen-drawer-head">
                    <div><p class="sites-resumen-drawer-kicker" data-reserva-kicker>RESERVA</p>
                        <h3 id="sites-resumen-reserva-titulo">Ficha de reserva</h3></div>
                    <button type="button" class="sites-resumen-drawer-close" data-reserva-cerrar
                        aria-label="Cerrar ficha de reserva">×</button>
                </header>
                <div class="sites-resumen-drawer-body">
                    <p data-reserva-estado role="status">Cargando reserva desde Proyecto H…</p>
                    <div data-reserva-estadias hidden>
                        <label class="sites-resumen-drawer-field">Estadía y cabaña
                            <select data-reserva-estadia-select aria-label="Seleccionar estadía y cabaña"></select>
                        </label>
                    </div>
                    <div data-reserva-contenido hidden>
                        <div class="rd-top"><div class="rd-topline"><span class="rd-reference" data-reserva-codigo></span>
                            <div class="rd-state-control">
                                <button type="button" class="rd-status" data-reserva-estado-operativo
                                    aria-label="Cambiar estado de la reserva" aria-haspopup="menu"
                                    aria-expanded="false" aria-controls="reserva-estado-opciones"></button>
                                <div id="reserva-estado-opciones" class="rd-state-menu" data-reserva-estado-menu
                                    role="menu" aria-label="Estado de la reserva" hidden></div>
                            </div></div>
                            <section class="rd-state-confirm" data-reserva-estado-confirmacion hidden
                                role="alertdialog" aria-labelledby="reserva-estado-confirmacion-titulo"
                                aria-describedby="reserva-estado-confirmacion-mensaje reserva-estado-confirmacion-nota">
                                <h4 id="reserva-estado-confirmacion-titulo">Cambiar estado de la reserva</h4>
                                <p id="reserva-estado-confirmacion-mensaje" data-reserva-estado-mensaje></p>
                                <p id="reserva-estado-confirmacion-nota" data-reserva-estado-nota></p>
                                <div><button type="button" data-reserva-estado-cancelar>Cancelar</button>
                                    <button type="button" data-reserva-estado-confirmar>Confirmar cambio</button></div>
                            </section>
                            <div class="rd-facts"><div class="rd-fact"><span>Ingreso</span><strong data-reserva-ingreso></strong></div>
                                <div class="rd-fact"><span>Salida</span><strong data-reserva-salida></strong></div>
                                <div class="rd-fact"><span data-reserva-duracion-etiqueta>Noches</span>
                                    <strong data-reserva-duracion></strong></div></div></div>
                        <section class="rd-section"><div class="rd-section-head"><h4>Huéspedes</h4>
                            <small data-reserva-personas></small></div>
                            <div class="rd-two"><div><span class="rd-label">Titular</span><span class="rd-value"
                                data-reserva-titular></span></div>
                                <div><span class="rd-label">Acompañantes</span><span class="rd-value"
                                    data-reserva-acompanantes></span></div>
                                <div><span class="rd-label">Teléfono</span><span class="rd-value"
                                    data-reserva-telefono></span></div>
                                <div><span class="rd-label">RUT</span><span class="rd-value"
                                    data-reserva-rut></span></div></div></section>
                        <section class="rd-section"><div class="rd-section-head"><h4>Servicios</h4>
                            <small data-reserva-servicios-contador></small></div>
                            <ul class="rd-list" data-reserva-servicios></ul></section>
                        <section class="rd-section rd-finance"><div class="rd-section-head"><h4>Pagos</h4></div>
                            <div class="rd-finance-grid"><div class="rd-pay-stat"><span>Total reserva</span>
                                <strong data-reserva-total></strong></div><div class="rd-pay-stat"><span>Abonos</span>
                                <strong data-reserva-abono></strong></div><div class="rd-pay-stat balance"><span>Saldo</span>
                                <strong data-reserva-saldo></strong></div></div>
                            <p class="rd-finance-note">Servicios pendientes · <strong
                                data-reserva-servicios-pendientes></strong></p></section>
                        <section class="rd-section"><div class="rd-section-head"><h4>Solicitudes</h4></div>
                            <ul class="rd-list" data-reserva-solicitudes></ul></section>
                        <div class="rd-notes"><section class="rd-section"><div class="rd-section-head"><h4>Notas</h4></div>
                            <div data-reserva-notas></div></section>
                            <section class="rd-section"><div class="rd-section-head"><h4>Comentarios de reserva</h4></div>
                                <p data-reserva-comentarios></p></section></div>
                        <p data-reserva-bove></p>
                    </div>
                </div>
                <footer class="sites-resumen-drawer-footer">
                    <button type="button" data-reserva-historial disabled>Ver historial</button>
                    <button type="button" class="sites-resumen-drawer-primary" data-reserva-editar disabled>Editar reserva</button>
                </footer>
            </section>`;
        document.body.appendChild(drawer);
        drawer.querySelector("[data-reserva-cerrar]").addEventListener("click", cerrar);
        drawer.querySelector("[data-reserva-historial]").addEventListener("click", () => actuar("historial"));
        drawer.querySelector("[data-reserva-editar]").addEventListener("click", () => actuar("editar"));
        drawer.querySelector("[data-reserva-estadia-select]").addEventListener("change", evento => {
            seleccionarEstadia(evento.target.value);
        });
        drawer.querySelector("[data-reserva-estado-operativo]").addEventListener("click", abrirMenuEstado);
        drawer.querySelector("[data-reserva-estado-menu]").addEventListener("click", evento => {
            const opcion = evento.target.closest?.("[data-reserva-nuevo-estado]");
            if (opcion && !opcion.disabled) proponerEstado(opcion.dataset.reservaNuevoEstado);
        });
        drawer.querySelector("[data-reserva-estado-cancelar]").addEventListener("click", () => cerrarCambioEstado(true));
        drawer.querySelector("[data-reserva-estado-confirmar]").addEventListener("click", confirmarEstado);
        drawer.addEventListener("keydown", evento => {
            const menu = drawer.querySelector("[data-reserva-estado-menu]");
            if (evento.key === "Escape" && (!menu.hidden || estado.cambio)) {
                evento.preventDefault(); evento.stopPropagation();
                cerrarCambioEstado(true);
            }
            if (!menu.hidden && ["ArrowDown", "ArrowUp", "Home", "End"].includes(evento.key)) {
                evento.preventDefault();
                const opciones = [...menu.querySelectorAll("button:not(:disabled)")];
                const actual = opciones.indexOf(document.activeElement);
                const indice = evento.key === "Home" ? 0 : evento.key === "End" ? opciones.length - 1 :
                    (actual + (evento.key === "ArrowUp" ? -1 : 1) + opciones.length) % opciones.length;
                opciones[indice]?.focus();
            }
        });
        document.addEventListener?.("click", evento => {
            if (!evento.target.closest?.(".rd-state-control")) cerrarMenuEstado();
        });
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.registrar?.(drawer, {
            cerrar: () => {
                if (estado.cambio || !drawer.querySelector("[data-reserva-estado-menu]").hidden)
                    cerrarCambioEstado(true);
                else cerrar();
            },
            focoInicial: () => drawer.querySelector("[data-reserva-cerrar]")
        });
        estado.drawer = drawer;
        return drawer;
    }

    function colocar(selector, valor) {
        const elemento = estado.drawer.querySelector(selector);
        if (elemento) elemento.textContent = String(valor ?? "");
    }

    function itemLista(lista, principal, secundario = "", final = "") {
        const item = document.createElement("li");
        const texto = document.createElement("span");
        texto.className = "rd-main";
        texto.textContent = principal;
        if (secundario) {
            const sub = document.createElement("small");
            sub.className = "rd-sub";
            sub.textContent = secundario;
            texto.appendChild(sub);
        }
        item.appendChild(texto);
        if (final) {
            const fin = document.createElement("span");
            fin.className = "rd-end";
            fin.textContent = final;
            item.appendChild(fin);
        }
        lista.appendChild(item);
    }

    function listaVacia(lista, texto) {
        lista.replaceChildren();
        if (!lista.children.length) itemLista(lista, texto);
    }

    function estadoVisible(texto, error = false) {
        const mensaje = estado.drawer.querySelector("[data-reserva-estado]");
        mensaje.textContent = texto;
        mensaje.hidden = !texto;
        mensaje.dataset.error = error ? "true" : "false";
    }

    function cerrarMenuEstado() {
        if (!estado.drawer) return;
        estado.drawer.querySelector("[data-reserva-estado-menu]").hidden = true;
        estado.drawer.querySelector("[data-reserva-estado-operativo]").setAttribute?.("aria-expanded", "false");
    }

    function cerrarCambioEstado(foco = false) {
        if (estado.guardandoEstado) return;
        estado.cambio = null;
        if (!estado.drawer) return;
        cerrarMenuEstado();
        estado.drawer.querySelector("[data-reserva-estado-confirmacion]").hidden = true;
        if (foco) estado.drawer.querySelector("[data-reserva-estado-operativo]").focus();
    }

    function abrirMenuEstado() {
        if (!manual || estado.ocupado || !estado.ficha || !estado.estadia) return;
        const menu = estado.drawer.querySelector("[data-reserva-estado-menu]");
        if (!menu.hidden) { cerrarMenuEstado(); return; }
        cerrarCambioEstado();
        menu.replaceChildren();
        for (const opcion of manual.opciones(estado.ficha, estado.estadia,
            permiso => window.haikuTienePermiso?.(permiso) === true)) {
            const boton = document.createElement("button");
            boton.type = "button";
            boton.dataset.reservaNuevoEstado = opcion.valor;
            boton.setAttribute("role", "menuitemradio");
            boton.setAttribute("aria-checked", String(opcion.actual));
            boton.disabled = Boolean(opcion.motivo);
            boton.textContent = opcion.etiqueta;
            if (opcion.motivo) {
                const nota = document.createElement("small");
                nota.textContent = opcion.actual ? "✓ Estado actual" : opcion.motivo;
                boton.appendChild(nota);
            }
            menu.appendChild(boton);
        }
        menu.hidden = false;
        estado.drawer.querySelector("[data-reserva-estado-operativo]").setAttribute("aria-expanded", "true");
        menu.querySelector("button:not(:disabled)")?.focus();
    }

    function proponerEstado(destino) {
        if (estado.ocupado || !manual || !estado.identidad || !estado.ficha || !estado.estadia) return false;
        const opcion = manual.opciones(estado.ficha, estado.estadia,
            permiso => window.haikuTienePermiso?.(permiso) === true).find(e => e.valor === destino);
        if (!opcion || opcion.motivo) return false;
        const anterior = manual.actual(estado.ficha, estado.estadia);
        estado.cambio = { destino, anterior, esperado: manual.esperado(estado.ficha), version: estado.version };
        cerrarMenuEstado();
        if (["hospedada", "checked_out"].includes(destino)) {
            // Sólo omite el aviso: conserva el flujo seguro y todas sus validaciones.
            estadoVisible("Actualizando estado…");
            return confirmarEstado();
        }
        colocar("[data-reserva-estado-mensaje]", `${manual.etiqueta(anterior)} → ${opcion.etiqueta}. ` +
            "¿Estás seguro de que quieres realizar este cambio?");
        colocar("[data-reserva-estado-nota]", manual.aviso(estado.ficha, estado.estadia, destino));
        const aviso = estado.drawer.querySelector("[data-reserva-estado-confirmacion]");
        aviso.dataset.importante = ["cancelada", "no_show"].includes(destino) ? "true" : "false";
        aviso.hidden = false;
        estado.drawer.querySelector("[data-reserva-estado-cancelar]").focus();
        return true;
    }

    async function refrescarTrasEstado(evento = "estado manual de reserva confirmado") {
        const tareas = [
            () => window.haikuSincronizarReservasSupabase?.(),
            () => window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(),
            () => window.haikuCargarPagosPendientesSupabase?.(),
            () => window.HAIKU_RESERVAS_V1?.recargar?.(),
            () => window.HistorialSupabase?.cargar?.()
        ];
        const resultados = await Promise.allSettled(tareas.map(tarea => Promise.resolve().then(tarea)));
        try {
            if (typeof cargarCabanasDia === "function") cargarCabanasDia(fechaActiva(), {
                evento, tipo: "externo"
            });
            await window.HAIKU_CHECKOUT_AUTORIDAD_V1?.refrescar?.();
            await window.HAIKU_CHECKOUT_RESUMEN_V2?.refrescar?.();
            if (typeof generarCalendario === "function") generarCalendario();
            if (typeof actualizarResumenDia === "function") actualizarResumenDia(fechaActiva());
            if (typeof generarResumenOperativo === "function") generarResumenOperativo(fechaActiva());
        } catch (error) { resultados.push({ status: "rejected", reason: error }); }
        return resultados.every(r => r.status === "fulfilled");
    }

    async function confirmarEstado() {
        const cambio = estado.cambio;
        if (estado.ocupado || !cambio || cambio.version !== estado.version) return false;
        const identidad = estado.identidad;
        const version = estado.version;
        estado.ocupado = true;
        estado.guardandoEstado = true;
        const confirmar = estado.drawer.querySelector("[data-reserva-estado-confirmar]");
        const cancelar = estado.drawer.querySelector("[data-reserva-estado-cancelar]");
        confirmar.disabled = cancelar.disabled = true;
        confirmar.textContent = "Guardando…";
        let guardado = false;
        try {
            await revalidar(identidad);
            const ficha = await window.haikuLeerFichaSupabaseV2(identidad.reservaId);
            const estadia = elegirEstadia(ficha, identidad);
            if (version !== estado.version || !estadia ||
                JSON.stringify(manual.esperado(ficha)) !== JSON.stringify(cambio.esperado))
                throw new Error("La reserva cambió desde que elegiste el estado. Reabre la ficha antes de confirmar.");
            const opcion = manual.opciones(ficha, estadia,
                permiso => window.haikuTienePermiso?.(permiso) === true).find(e => e.valor === cambio.destino);
            if (!opcion || opcion.motivo) throw new Error(opcion?.motivo || "Cambio de estado no permitido.");
            const { data, error } = await window.haikuSupabase.rpc("haiku_cambiar_estado_reserva_manual_v1", {
                p_reserva_id: identidad.reservaId, p_estadia_id: identidad.estadiaId,
                p_estado: cambio.destino, p_esperado: cambio.esperado
            });
            if (error) throw error;
            guardado = true;
            if (!data?.ok || data.estado !== cambio.destino)
                throw new Error("La operación respondió sin un resultado verificable. Actualiza la ficha para comprobar el estado.");
            estado.cambio = null;
            estado.drawer.querySelector("[data-reserva-estado-confirmacion]").hidden = true;
            estadoVisible("Cambio guardado. Actualizando la ficha…");
            const refrescado = await refrescarTrasEstado();
            const actualizada = await window.haikuLeerFichaSupabaseV2(identidad.reservaId);
            const seleccionada = elegirEstadia(actualizada, identidad);
            if (!seleccionada || manual.actual(actualizada, seleccionada) !== cambio.destino)
                throw new Error("No se pudo verificar el estado guardado. Actualiza la ficha.");
            estado.ficha = actualizada;
            estado.estadia = seleccionada;
            estado.identidad = identidadEstadia(identidad.reservaId, actualizada, seleccionada);
            pintar(actualizada, seleccionada, estado.identidad);
            estadoVisible(refrescado ? "Estado actualizado." : "Estado guardado. Alguna vista no pudo actualizarse; recárgala.");
            return true;
        } catch (error) {
            if (!guardado && error?.code === "40001") {
                try {
                    const refrescado = await refrescarTrasEstado("conflicto concurrente de estado de reserva");
                    const reconciliada = await window.haikuLeerFichaSupabaseV2(identidad.reservaId);
                    const seleccionada = elegirEstadia(reconciliada, identidad);
                    if (version !== estado.version || !seleccionada ||
                        String(reconciliada?.reserva?.id || "") !== identidad.reservaId ||
                        !window.haikuSesion || window.haikuTienePermiso?.("reservas.ver") !== true)
                        throw new Error("La ficha ya no corresponde a la reserva autorizada.");
                    estado.ficha = reconciliada;
                    estado.estadia = seleccionada;
                    estado.identidad = identidadEstadia(identidad.reservaId, reconciliada, seleccionada);
                    pintar(reconciliada, seleccionada, estado.identidad);
                    estadoVisible("El cambio fue rechazado porque la reserva cambió en otro proceso. " +
                        "Se releyó su estado actual; revísalo antes de volver a confirmar." +
                        (refrescado ? "" : " Alguna vista no pudo actualizarse; recárgala."), true);
                } catch (_) {
                    estadoVisible("El cambio fue rechazado porque la reserva cambió en otro proceso. " +
                        "No se pudo releer su estado actual; vuelve a abrir la ficha.", true);
                }
                return false;
            }
            estadoVisible((guardado ? "El servidor recibió el cambio. " : "No se pudo confirmar el cambio. ") +
                (error?.message || "Inténtalo nuevamente."), true);
            // No hay pintura optimista: ante un fallo conserva el badge previo.
            return false;
        } finally {
            estado.ocupado = false;
            estado.guardandoEstado = false;
            confirmar.disabled = cancelar.disabled = false;
            confirmar.textContent = "Confirmar cambio";
            cerrarCambioEstado(true);
        }
    }

    function estadoReserva(ficha, estadia) {
        if (manual) return manual.etiqueta(manual.actual(ficha, estadia));
        const reserva = String(ficha.reserva?.estado_reserva || "").toLowerCase();
        const actual = String(estadia.estado_estadia || "").toLowerCase();
        if (reserva === "cancelada") return "Cancelada";
        if (reserva === "no_show") return "No-Show";
        if (actual === "checked_out" || estadia.checkout_realizado_en) return "Checked Out";
        if (actual === "hospedada" || estadia.checkin_realizado_en) return "Hospedado";
        if (actual === "confirmada") return "Confirmada";
        return "Confirmación pendiente";
    }

    function pintar(ficha, estadia, identidad) {
        cerrarCambioEstado();
        const reserva = ficha.reserva;
        const huespedes = Array.isArray(ficha.huespedes) ? ficha.huespedes : [];
        const titularHuesped = huespedes.find(h => h.es_titular) || {};
        const acompanantes = huespedes.filter(h => !h.es_titular)
            .map(h => [h.nombre, h.apellido].filter(Boolean).join(" ")).filter(Boolean);
        const ocupacion = Number(estadia.adultos || 0) + Number(estadia.ninos || 0);
        const nombre = String(reserva.titular_nombre || "").trim() || "Sin titular";
        const codigo = reserva.codigo_haiku || reserva.cloudbeds_id || reserva.id;
        const estadoActual = estadoReserva(ficha, estadia);
        const fullday = estadia.tipo_estadia === "fullday";
        const inicio = new Date(`${String(estadia.fecha_ingreso).slice(0, 10)}T12:00:00`);
        const fin = new Date(`${String(estadia.fecha_salida).slice(0, 10)}T12:00:00`);
        const noches = Math.max(0, Math.round((fin - inicio) / 86400000));
        const resumen = window.HAIKU_FINANZAS_RESUMEN_V1?.calcular(ficha.cargos, ficha.pagos);
        if (!resumen || ["total", "abono", "saldo", "servicios"].some(k => !Number.isFinite(resumen[k]))) {
            throw new Error("No se pudo verificar el estado financiero de esta reserva.");
        }

        colocar("#sites-resumen-reserva-titulo", nombre);
        colocar("[data-reserva-kicker]", `CABAÑA ${identidad.numeroCabana} · ${codigo}`);
        colocar("[data-reserva-codigo]", codigo);
        colocar("[data-reserva-estado-operativo]", estadoActual);
        estado.drawer.querySelector("[data-reserva-estado-operativo]").disabled = !manual ||
            (!["reservas.editar", "reservas.cancelar"].some(p => window.haikuTienePermiso?.(p) === true));
        colocar("[data-reserva-ingreso]", fechaVisible(estadia.fecha_ingreso));
        colocar("[data-reserva-salida]", fechaVisible(estadia.fecha_salida));
        colocar("[data-reserva-duracion-etiqueta]", fullday ? "Estadía" : "Noches");
        colocar("[data-reserva-duracion]", fullday ? "Full Day" : `${noches}`);
        colocar("[data-reserva-personas]", `${ocupacion} ${ocupacion === 1 ? "persona" : "personas"}`);
        colocar("[data-reserva-titular]", nombre);
        colocar("[data-reserva-acompanantes]", acompanantes.join(" · ") || "Sin acompañantes registrados");
        colocar("[data-reserva-telefono]", reserva.telefono_contacto || titularHuesped.telefono || "Sin teléfono");
        colocar("[data-reserva-rut]", reserva.titular_numero_documento || titularHuesped.numero_documento || "Sin RUT");
        colocar("[data-reserva-total]", dinero(resumen.total));
        colocar("[data-reserva-abono]", dinero(resumen.abono));
        colocar("[data-reserva-saldo]", dinero(resumen.saldo));
        colocar("[data-reserva-servicios-pendientes]",
            resumen.servicios ? dinero(resumen.servicios) : "Sin cargos pendientes");

        const servicios = (ficha.servicios || []).filter(s =>
            !OMITIDOS.has(String(s.estado_servicio || "").toLowerCase()));
        colocar("[data-reserva-servicios-contador]", `${servicios.length} ${servicios.length === 1 ? "servicio" : "servicios"}`);
        const listaServicios = estado.drawer.querySelector("[data-reserva-servicios]");
        listaServicios.replaceChildren();
        for (const servicio of servicios) {
            const nombreServicio = servicio.catalogo_servicios?.nombre || "Servicio";
            const hora = String(servicio.hora_inicio || "").slice(0, 5);
            itemLista(listaServicios, nombreServicio,
                [fechaVisible(servicio.fecha_servicio), hora].filter(x => x && x !== "—").join(" · "),
                servicio.estado_servicio === "realizado" ? "Realizado" : "Programado");
        }
        if (!servicios.length) listaVacia(listaServicios, "Sin servicios asociados");

        const listaSolicitudes = estado.drawer.querySelector("[data-reserva-solicitudes]");
        listaSolicitudes.replaceChildren();
        for (const solicitud of ficha.solicitudes || []) {
            itemLista(listaSolicitudes, String(solicitud.descripcion || "Solicitud"),
                fechaVisible(solicitud.vence_en || solicitud.creado_en));
        }
        if (!listaSolicitudes.children.length) listaVacia(listaSolicitudes, "Sin solicitudes");

        const notas = estado.drawer.querySelector("[data-reserva-notas]");
        notas.replaceChildren();
        if ((ficha.notas || []).length) {
            const listaNotas = document.createElement("ul");
            listaNotas.className = "rd-list";
            for (const nota of ficha.notas) {
                itemLista(listaNotas, String(nota.texto || ""),
                    fechaVisible(nota.fecha_operacion || nota.creado_en));
            }
            notas.appendChild(listaNotas);
        } else {
            notas.textContent = "Sin notas registradas";
        }
        colocar("[data-reserva-comentarios]", reserva.observaciones || "Sin comentarios de reserva");
        const boves = [reserva.bove_cierre || ficha.boves?.bove_cierre,
            reserva.bove_checkout || ficha.boves?.bove_checkout].filter(Boolean);
        colocar("[data-reserva-bove]", boves.length ? `BOVE · ${[...new Set(boves)].join(" · ")}` : "");
        estado.drawer.querySelector("[data-reserva-contenido]").hidden = false;
        estado.drawer.querySelector("[data-reserva-historial]").disabled = false;
        estado.drawer.querySelector("[data-reserva-editar]").disabled =
            window.haikuTienePermiso?.("reservas.editar") !== true;
        estadoVisible("");
    }

    function cerrar() {
        if (estado.guardandoEstado) return;
        const drawer = estado.drawer;
        if (!drawer || drawer.hidden) return;
        estado.version++;
        estado.reservaId = null;
        estado.identidad = null;
        estado.ficha = null;
        estado.estadia = null;
        cerrarCambioEstado();
        drawer.hidden = true;
        delete drawer.dataset.haikuInspectorEntidadId;
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.sincronizar?.();
    }

    async function abrirDesdeBoton(boton) {
        if (estado.ocupado) return false;
        cerrarCambioEstado();
        if (!window.haikuSesion || window.haikuTienePermiso?.("reservas.ver") !== true) return false;
        const drawer = crearDrawer();
        const version = ++estado.version;
        const identidad = capturar(boton);
        estado.reservaId = identidad?.reservaId || null;
        estado.identidad = identidad;
        estado.ficha = null;
        estado.estadia = null;
        if (estado.reservaId) drawer.dataset.haikuInspectorEntidadId = estado.reservaId;
        else delete drawer.dataset.haikuInspectorEntidadId;
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.marcarDisparador?.(drawer, boton);
        drawer.hidden = false;
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.sincronizar?.();
        colocar("#sites-resumen-reserva-titulo", "Ficha de reserva");
        colocar("[data-reserva-kicker]", identidad
            ? `CABAÑA ${identidad.numeroCabana}` : "RESERVA");
        drawer.querySelector("[data-reserva-contenido]").hidden = true;
        drawer.querySelector("[data-reserva-estadias]").hidden = true;
        drawer.querySelector("[data-reserva-historial]").disabled = true;
        drawer.querySelector("[data-reserva-editar]").disabled = true;
        estadoVisible("Comprobando reserva en Proyecto H…");
        try {
            if (!identidad) throw new Error("La reserva visible no tiene una identidad verificable. Actualiza el Resumen.");
            await revalidar(identidad);
            if (typeof window.haikuLeerFichaSupabaseV2 !== "function") {
                throw new Error("La lectura de ficha de Proyecto H no está disponible.");
            }
            const ficha = await window.haikuLeerFichaSupabaseV2(identidad.reservaId);
            if (version !== estado.version) return false;
            const estadia = elegirEstadia(ficha, identidad);
            if (String(ficha?.reserva?.id || "") !== identidad.reservaId || !estadia) {
                throw new Error("La ficha no corresponde a la reserva y cabaña seleccionadas.");
            }
            if (!Object.hasOwn(ficha.reserva, "observaciones")) {
                const { data, error } = await window.haikuSupabase.from("reservas")
                    .select("observaciones").eq("id", identidad.reservaId).single();
                if (error) throw error;
                ficha.reserva.observaciones = data?.observaciones || "";
            }
            if (version !== estado.version) return false;
            await revalidar(identidad);
            if (version !== estado.version) return false;
            estado.ficha = ficha;
            estado.estadia = estadia;
            pintar(ficha, estadia, identidad);
            return true;
        } catch (error) {
            if (version !== estado.version) return false;
            console.warn("HAIKU · No fue posible verificar ficha Sites:", error);
            estadoVisible(error?.message || "No se pudo cargar la reserva.", true);
            return false;
        }
    }

    function identidadEstadia(reservaId, ficha, estadia) {
        return {
            origen: "reservas", reservaId,
            estadiaId: String(estadia.id), numeroCabana: String(estadia.cabana_numero),
            fechaIngreso: String(estadia.fecha_ingreso || "").slice(0, 10),
            fechaSalida: String(estadia.fecha_salida || "").slice(0, 10),
            tipoEstadia: String(estadia.tipo_estadia || ""),
            estadoReserva: String(ficha.reserva.estado_reserva || "")
        };
    }

    function seleccionarEstadia(estadiaId) {
        const ficha = estado.ficha;
        const reservaId = estado.reservaId;
        if (estado.ocupado) {
            estado.drawer.querySelector("[data-reserva-estadia-select]").value = estado.identidad?.estadiaId || "";
            return false;
        }
        if (!ficha || !reservaId || !window.haikuSesion ||
            window.haikuTienePermiso?.("reservas.ver") !== true) return false;
        const estadia = ficha.estadias.find(item => String(item.id) === String(estadiaId));
        if (!estadia) return false;
        estado.version++;
        const identidad = identidadEstadia(reservaId, ficha, estadia);
        estado.identidad = identidad;
        estado.estadia = estadia;
        try {
            pintar(ficha, estadia, identidad);
            return true;
        } catch (error) {
            estado.identidad = null;
            estado.estadia = null;
            estado.drawer.querySelector("[data-reserva-contenido]").hidden = true;
            estado.drawer.querySelector("[data-reserva-historial]").disabled = true;
            estado.drawer.querySelector("[data-reserva-editar]").disabled = true;
            estadoVisible(error?.message || "No se pudo mostrar la estadía.", true);
            return false;
        }
    }

    async function abrirPorId(reservaId, disparador = null, seleccion = null) {
        if (estado.ocupado) return false;
        cerrarCambioEstado();
        if (!window.haikuSesion || !window.haikuSupabase ||
            window.haikuTienePermiso?.("reservas.ver") !== true ||
            !UUID.test(String(reservaId || ""))) return false;
        const drawer = crearDrawer();
        const version = ++estado.version;
        estado.reservaId = String(reservaId);
        estado.identidad = null;
        estado.ficha = null;
        estado.estadia = null;
        drawer.dataset.haikuInspectorEntidadId = estado.reservaId;
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.marcarDisparador?.(drawer, disparador);
        drawer.hidden = false;
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.sincronizar?.();
        colocar("#sites-resumen-reserva-titulo", "Ficha de reserva");
        colocar("[data-reserva-kicker]", "RESERVA");
        drawer.querySelector("[data-reserva-contenido]").hidden = true;
        drawer.querySelector("[data-reserva-estadias]").hidden = true;
        drawer.querySelector("[data-reserva-historial]").disabled = true;
        drawer.querySelector("[data-reserva-editar]").disabled = true;
        estadoVisible("Comprobando reserva en Proyecto H…");
        try {
            if (typeof window.haikuLeerFichaSupabaseV2 !== "function") {
                throw new Error("La lectura de ficha de Proyecto H no está disponible.");
            }
            const ficha = await window.haikuLeerFichaSupabaseV2(estado.reservaId);
            if (version !== estado.version) return false;
            if (String(ficha?.reserva?.id || "") !== estado.reservaId) {
                throw new Error("La ficha no corresponde a la reserva seleccionada.");
            }
            const estadias = ficha.estadias;
            if (!Array.isArray(estadias) || !estadias.length || estadias.some(estadia =>
                !UUID.test(String(estadia?.id || "")) ||
                !/^\d{1,2}$/.test(String(estadia?.cabana_numero || "")) ||
                (estadia.reserva_id && String(estadia.reserva_id) !== estado.reservaId))) {
                throw new Error("La reserva no tiene estadías y cabañas verificables.");
            }
            if (!Object.hasOwn(ficha.reserva, "observaciones")) {
                const { data, error } = await window.haikuSupabase.from("reservas")
                    .select("observaciones").eq("id", estado.reservaId).single();
                if (error) throw error;
                ficha.reserva.observaciones = data?.observaciones || "";
            }
            if (version !== estado.version) return false;
            if (!window.haikuSesion || window.haikuTienePermiso?.("reservas.ver") !== true) {
                throw new Error("El permiso para ver reservas cambió. Reabre la ficha.");
            }
            estado.ficha = ficha;
            if (seleccion?.estadiaId) {
                const estadiaId = String(seleccion.estadiaId);
                const numeroCabana = String(seleccion.numeroCabana || "");
                const estadia = estadias.find(item => String(item.id) === estadiaId);
                if (!UUID.test(estadiaId) || !/^\d{1,2}$/.test(numeroCabana) ||
                    !estadia || Number(estadia.cabana_numero) !== Number(numeroCabana)) {
                    throw new Error("La estadía y cabaña seleccionadas no corresponden a la reserva. Actualiza el Calendario.");
                }
                return seleccionarEstadia(estadiaId);
            }
            if (estadias.length === 1) return seleccionarEstadia(estadias[0].id);

            colocar("#sites-resumen-reserva-titulo", ficha.reserva.titular_nombre || "Ficha de reserva");
            colocar("[data-reserva-kicker]", `RESERVA · ${ficha.reserva.codigo_haiku || ficha.reserva.cloudbeds_id || estado.reservaId}`);
            const selector = drawer.querySelector("[data-reserva-estadia-select]");
            selector.replaceChildren();
            const opcionInicial = document.createElement("option");
            opcionInicial.value = "";
            opcionInicial.disabled = true;
            opcionInicial.textContent = "Selecciona una estadía";
            selector.appendChild(opcionInicial);
            for (const estadia of estadias) {
                const opcion = document.createElement("option");
                opcion.value = String(estadia.id);
                opcion.textContent = `Cabaña ${estadia.cabana_numero} · ${fechaVisible(estadia.fecha_ingreso)} → ${fechaVisible(estadia.fecha_salida)}`;
                selector.appendChild(opcion);
            }
            selector.value = "";
            drawer.querySelector("[data-reserva-estadias]").hidden = false;
            estadoVisible("Esta reserva tiene varias estadías. Selecciona la cabaña para ver su detalle.");
            return true;
        } catch (error) {
            if (version !== estado.version) return false;
            console.warn("HAIKU · No fue posible verificar ficha Sites por ID:", error);
            estadoVisible(error?.message || "No se pudo cargar la reserva.", true);
            return false;
        }
    }

    async function actuar(accion) {
        if (estado.ocupado || !estado.identidad || !estado.ficha || !estado.estadia) return false;
        const identidad = estado.identidad;
        const version = estado.version;
        estado.ocupado = true;
        try {
            const fichaValidada = await revalidar(identidad);
            if (version !== estado.version) return false;
            if (accion === "historial") {
                const abrir = window.HistorialSupabase?.abrirReserva;
                if (typeof abrir !== "function") throw new Error("El historial de Proyecto H no está disponible.");
                const meta = { cabana: identidad.numeroCabana,
                    titular: String((identidad.origen === "reservas" ? fichaValidada : estado.ficha).reserva.titular_nombre || "") };
                cerrar();
                await abrir(identidad.reservaId, meta);
                return true;
            }
            if (accion === "editar") {
                if (window.haikuTienePermiso?.("reservas.editar") !== true ||
                    typeof window.haikuPrepararEdicionFichaSupabaseV2 !== "function" ||
                    typeof abrirModalEditarReserva !== "function") {
                    throw new Error("No tienes permiso o el editor de reservas no está disponible.");
                }
                const ficha = identidad.origen === "reservas"
                    ? fichaValidada : await window.haikuLeerFichaSupabaseV2(identidad.reservaId);
                if (version !== estado.version) return false;
                if (identidad.origen !== "reservas") await revalidar(identidad);
                if (version !== estado.version ||
                    String(ficha?.reserva?.id || "") !== identidad.reservaId ||
                    !elegirEstadia(ficha, identidad) ||
                    !window.haikuPrepararEdicionFichaSupabaseV2(ficha, identidad.estadiaId)) {
                    throw new Error("La estadía cambió. Reabre la ficha antes de editar.");
                }
                const abierta = abrirModalEditarReserva(identidad.reservaId);
                if (!abierta) throw new Error("No se pudo abrir el editor de esta reserva.");
                cerrar();
                return true;
            }
            return false;
        } catch (error) {
            if (version === estado.version) {
                console.warn("HAIKU · Acción de ficha Sites bloqueada:", error);
                estadoVisible(error?.message || "No se pudo comprobar la reserva.", true);
            }
            return false;
        } finally {
            estado.ocupado = false;
        }
    }

    window.HAIKU_RESUMEN_RESERVA_SITES_V1 = Object.freeze({
        abrirDesdeBoton, abrirPorId, cerrar,
        // Funciones puras para comprobar identidad exacta y cabañas grupales.
        identidadOperacion, elegirEstadia
    });
})();
