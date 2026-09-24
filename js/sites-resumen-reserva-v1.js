// Ficha de reserva del Resumen Sites. Sólo lee Proyecto H; edición e historial
// siguen en sus flujos oficiales y se abren por la identidad exacta de la fila.
(() => {
    "use strict";

    if (window.HAIKU_RESUMEN_RESERVA_SITES_V1) return;

    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const FECHA = /^\d{4}-\d{2}-\d{2}$/;
    const OMITIDOS = new Set(["cancelado", "cancelada", "anulado", "anulada", "no_show"]);
    const estado = { version: 0, reservaId: null, identidad: null, ficha: null,
        estadia: null, ocupado: false, drawer: null };

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
                            <span class="rd-status" data-reserva-estado-operativo></span></div>
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
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.registrar?.(drawer, {
            cerrar,
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

    function estadoReserva(ficha, estadia) {
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
        const drawer = estado.drawer;
        if (!drawer || drawer.hidden) return;
        estado.version++;
        estado.reservaId = null;
        estado.identidad = null;
        estado.ficha = null;
        estado.estadia = null;
        drawer.hidden = true;
        window.HAIKU_SITES_RESUMEN_DRAWER_V1?.sincronizar?.();
    }

    async function abrirDesdeBoton(boton) {
        if (!window.haikuSesion || window.haikuTienePermiso?.("reservas.ver") !== true) return false;
        const drawer = crearDrawer();
        const version = ++estado.version;
        const identidad = capturar(boton);
        estado.reservaId = identidad?.reservaId || null;
        estado.identidad = identidad;
        estado.ficha = null;
        estado.estadia = null;
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

    async function abrirPorId(reservaId, disparador = null) {
        if (!window.haikuSesion || !window.haikuSupabase ||
            window.haikuTienePermiso?.("reservas.ver") !== true ||
            !UUID.test(String(reservaId || ""))) return false;
        const drawer = crearDrawer();
        const version = ++estado.version;
        estado.reservaId = String(reservaId);
        estado.identidad = null;
        estado.ficha = null;
        estado.estadia = null;
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
