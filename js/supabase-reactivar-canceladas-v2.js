// ========================================
// HAIKU · REACTIVAR RESERVAS CANCELADAS V2
// Búsqueda Supabase + ficha cancelada + reactivación segura.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let reactivando = false;
    let cargandoFicha = false;
    let temporizadorBusqueda = null;
    let secuenciaModal = 0;

    const id = valor => document.getElementById(valor);

    function dinero(valor) {
        return `$${Number(valor || 0).toLocaleString("es-CL")}`;
    }

    function fechaCorta(fecha) {
        if (!fecha) return "—";
        const [a, m, d] = String(fecha).slice(0, 10).split("-");
        return a && m && d ? `${d}-${m}-${a.slice(-2)}` : String(fecha);
    }

    function diferenciaDias(inicio, fin) {
        const a = new Date(`${String(inicio).slice(0, 10)}T12:00:00`);
        const b = new Date(`${String(fin).slice(0, 10)}T12:00:00`);
        return Math.max(0, Math.round((b - a) / 86400000));
    }

    function cerrarMenuEstado() {
        try {
            if (typeof cerrarMenuEstadoFicha === "function") cerrarMenuEstadoFicha();
        } catch (_) {}
    }

    function limpiarClasesEstado(campo) {
        if (!campo) return;
        campo.classList.remove(
            "ficha-estado-hospedado",
            "ficha-estado-checkout",
            "ficha-estado-pendiente",
            "ficha-estado-confirmada",
            "ficha-estado-confirmacion-pendiente",
            "ficha-estado-cancelada",
            "ficha-estado-no-show"
        );
    }

    function restaurarMenuReactivacion() {
        document
            .querySelectorAll("#ficha-estado-menu [data-haiku-reactivacion-oculto='1']")
            .forEach(boton => {
                boton.hidden = false;
                delete boton.dataset.haikuReactivacionOculto;
            });

        document
            .querySelectorAll("#ficha-estado-menu [data-haiku-reactivacion-bloqueado='1']")
            .forEach(boton => {
                boton.disabled = false;
                boton.removeAttribute("aria-disabled");
                boton.removeAttribute("title");
                delete boton.dataset.haikuReactivacionBloqueado;
            });
    }

    async function obtenerInfo(reservaId) {
        const { data, error } = await cliente.rpc(
            "haiku_info_reactivacion_reserva",
            { p_reserva_id: reservaId }
        );
        if (error) throw error;
        return data || null;
    }

    async function prepararMenuCancelada(reservaId) {
        const modal = id("ficha-reserva-modal");
        if (!modal || modal.hidden || !reservaId) return;

        const turno = ++secuenciaModal;

        try {
            const info = await obtenerInfo(reservaId);
            if (turno !== secuenciaModal || modal.hidden) return;

            restaurarMenuReactivacion();

            if (!info || info.estado_reserva !== "cancelada") {
                if (modal.dataset.reservaCancelada !== "false") {
                    modal.dataset.reservaCancelada = "false";
                }
                return;
            }

            if (modal.dataset.reservaCancelada !== "true") {
                modal.dataset.reservaCancelada = "true";
            }
            modal.__haikuInfoReactivacion = info;

            const desplegar = id("ficha-estado-desplegar");
            if (desplegar) {
                desplegar.hidden = false;
                desplegar.disabled = false;
                desplegar.title = "Reactivar reserva";
            }

            const conAbono = Number(info.abono_confirmado || 0) > 0;
            const correcta = conAbono ? "confirmada" : "confirmacion-pendiente";

            document
                .querySelectorAll("#ficha-estado-menu [data-ficha-estado-opcion]")
                .forEach(boton => {
                    const opcion = boton.dataset.fichaEstadoOpcion;

                    if (!["confirmada", "confirmacion-pendiente"].includes(opcion)) {
                        boton.hidden = true;
                        boton.dataset.haikuReactivacionOculto = "1";
                        return;
                    }

                    boton.hidden = false;
                    const permitido = opcion === correcta;
                    boton.disabled = !permitido;

                    if (!permitido) {
                        boton.dataset.haikuReactivacionBloqueado = "1";
                        boton.setAttribute("aria-disabled", "true");
                        boton.title = conAbono
                            ? "Tiene abono confirmado: debe reactivarse como Confirmada"
                            : "No tiene abono confirmado: debe reactivarse como Confirmación pendiente";
                    } else {
                        boton.removeAttribute("aria-disabled");
                        boton.title = conAbono
                            ? `Reactivar como Confirmada · Abono ${dinero(info.abono_confirmado)}`
                            : "Reactivar como Confirmación pendiente";
                    }
                });
        } catch (error) {
            console.warn("HAIKU · No fue posible preparar reactivación:", error);
        }
    }

    function itemServicio(servicio) {
        const fila = document.createElement("div");
        fila.className = "ficha-servicio-item";
        const catalogo = servicio.catalogo_servicios || {};
        const partes = [];
        if (servicio.fecha_servicio) partes.push(fechaCorta(servicio.fecha_servicio));
        if (servicio.hora_inicio) partes.push(String(servicio.hora_inicio).slice(0, 5));
        partes.push(catalogo.nombre || "Servicio");
        fila.textContent = partes.join(" · ");
        return fila;
    }

    function pintarServicios(servicios, cargos) {
        const programados = id("ficha-servicios-programados");
        const realizados = id("ficha-servicios-realizados");
        const pendientes = id("ficha-servicios-pendientes");
        if (!programados || !realizados || !pendientes) return;

        const cargosPorServicio = new Map(
            (cargos || [])
                .filter(c => c.servicio_id)
                .map(c => [String(c.servicio_id), c])
        );
        const lista = servicios || [];
        const p = lista.filter(s => s.estado_servicio !== "realizado");
        const r = lista.filter(s => s.estado_servicio === "realizado");
        const pp = lista.filter(s => {
            const cargo = cargosPorServicio.get(String(s.id));
            return s.tipo_cobro !== "cortesia" && Number(cargo?.saldo_cargo || 0) > 0;
        });

        [programados, realizados, pendientes].forEach(el => el.innerHTML = "");
        p.forEach(s => programados.appendChild(itemServicio(s)));
        r.forEach(s => realizados.appendChild(itemServicio(s)));
        pp.forEach(s => pendientes.appendChild(itemServicio(s)));

        [
            ["ficha-servicios-programados-contador", p.length],
            ["ficha-servicios-realizados-contador", r.length],
            ["ficha-servicios-pendientes-contador", pp.length]
        ].forEach(([campoId, valor]) => {
            const el = id(campoId);
            if (el) el.textContent = String(valor);
        });
    }

    function pintarNotas(notas) {
        const cont = id("ficha-reserva-notas");
        if (!cont) return;
        cont.innerHTML = "";
        if (!(notas || []).length) {
            cont.textContent = "Sin notas registradas.";
            return;
        }
        notas.forEach(nota => {
            const fila = document.createElement("div");
            fila.className = "ficha-nota-item";
            fila.textContent = `${fechaCorta(nota.fecha_operacion || nota.creado_en)} · ${nota.texto || ""}`;
            cont.appendChild(fila);
        });
    }

    function pintarSolicitudes(solicitudes) {
        const cont = id("ficha-reserva-solicitudes");
        const contador = id("ficha-solicitudes-contador");
        if (!cont) return;
        if (contador) contador.hidden = true;
        cont.innerHTML = "";
        if (!(solicitudes || []).length) {
            cont.textContent = "Sin solicitudes pendientes.";
            return;
        }
        solicitudes.forEach(sol => {
            const fila = document.createElement("div");
            fila.className = "ficha-solicitud-item";
            fila.textContent = `${fechaCorta(sol.vence_en || sol.creado_en)} · ${sol.descripcion || ""}`;
            cont.appendChild(fila);
        });
    }

    async function abrirFichaCancelada(reservaId) {
        if (!reservaId || cargandoFicha) return;
        cargandoFicha = true;

        try {
            const { data: core, error: errorCore } = await cliente.rpc(
                "haiku_ficha_reserva_core",
                { p_reserva_id: reservaId }
            );
            if (errorCore) throw errorCore;
            if (!core?.reserva) throw new Error("No se encontró la reserva en Supabase.");

            const [cargosR, serviciosR, notasR, solicitudesR] = await Promise.all([
                cliente
                    .from("vista_estado_cargos")
                    .select("cargo_id,servicio_id,tipo_cargo,monto,estado,aplicado_neto,saldo_cargo,estado_pago")
                    .eq("reserva_id", reservaId),
                cliente
                    .from("servicios")
                    .select("id,fecha_servicio,hora_inicio,total,tipo_cobro,estado_servicio,catalogo_servicios(nombre)")
                    .eq("reserva_id", reservaId)
                    .order("fecha_servicio", { ascending: true }),
                cliente
                    .from("notas")
                    .select("id,fecha_operacion,texto,creado_en")
                    .eq("reserva_id", reservaId)
                    .order("creado_en", { ascending: true }),
                cliente
                    .from("solicitudes")
                    .select("id,descripcion,estado,vence_en,creado_en")
                    .eq("reserva_id", reservaId)
                    .order("creado_en", { ascending: true })
            ]);

            [cargosR, serviciosR, notasR, solicitudesR].forEach(respuesta => {
                if (respuesta.error) {
                    console.warn("HAIKU · Lectura parcial de ficha cancelada:", respuesta.error);
                }
            });

            const reserva = core.reserva;
            const estadia = core.estadias?.[0];
            if (!estadia) throw new Error("La reserva no tiene estadía asociada.");

            const huespedes = Array.isArray(core.huespedes) ? core.huespedes : [];
            const titular = huespedes.find(h => h.es_titular) || {};
            const acompanantes = huespedes.filter(h => !h.es_titular);
            const esFullDay = estadia.tipo_estadia === "fullday";
            const noches = esFullDay ? 0 : diferenciaDias(estadia.fecha_ingreso, estadia.fecha_salida);

            const textos = {
                "ficha-reserva-cabana": `CAB ${estadia.cabana_numero}`,
                "ficha-reserva-titular": reserva.titular_nombre || "Sin titular",
                "ficha-reserva-id": reserva.codigo_haiku || reserva.cloudbeds_id || reserva.id,
                "ficha-reserva-ingreso": fechaCorta(estadia.fecha_ingreso),
                "ficha-reserva-salida": fechaCorta(estadia.fecha_salida),
                "ficha-reserva-noches": esFullDay
                    ? "◷ Full Day"
                    : noches === 1 ? "◷ 1 noche" : `◷ ${noches} noches`,
                "ficha-huesped-titular": reserva.titular_nombre || "Sin titular"
            };
            Object.entries(textos).forEach(([campoId, texto]) => {
                const el = id(campoId);
                if (el) el.textContent = texto;
            });

            const principal = id("ficha-reserva-acompanante-principal");
            if (principal) {
                if (acompanantes[0]) {
                    principal.textContent = `Acompañante principal: ${[acompanantes[0].nombre, acompanantes[0].apellido].filter(Boolean).join(" ")}`;
                    principal.hidden = false;
                } else {
                    principal.textContent = "";
                    principal.hidden = true;
                }
            }

            try {
                if (typeof actualizarOcupacionFicha === "function") {
                    actualizarOcupacionFicha({
                        adultos: Number(estadia.adultos || 0),
                        ninos: Number(estadia.ninos || 0),
                        mascotas: Number(estadia.mascotas || 0)
                    }, false);
                }
            } catch (_) {}

            for (let i = 1; i <= 5; i++) {
                const campo = id(`ficha-acompanante-${i}`);
                const fila = campo?.closest(".ficha-acompanante-fila");
                const h = acompanantes[i - 1];
                if (campo) campo.value = h ? [h.nombre, h.apellido].filter(Boolean).join(" ") : "";
                if (fila) fila.style.display = h ? "" : "none";
            }

            const rut = id("ficha-reserva-rut");
            const telefono = id("ficha-reserva-telefono");
            if (rut) rut.value = reserva.titular_numero_documento || titular.numero_documento || "";
            if (telefono) telefono.value = reserva.telefono_contacto || titular.telefono || "";

            document
                .querySelectorAll("#ficha-reserva-modal .ficha-dato-editable")
                .forEach(campo => {
                    campo.readOnly = true;
                    campo.tabIndex = -1;
                });

            const estado = id("ficha-reserva-estado");
            if (estado) {
                limpiarClasesEstado(estado);
                estado.textContent = "● Cancelada";
                estado.classList.add("ficha-estado-cancelada");
            }

            const cargos = cargosR.data || [];
            const alojamiento = cargos.filter(c => c.tipo_cargo === "alojamiento" && c.estado === "activo");
            const serviciosCargo = cargos.filter(c => c.tipo_cargo === "servicio" && c.estado === "activo");
            const valores = {
                "ficha-pago-total": alojamiento.reduce((s, c) => s + Number(c.monto || 0), 0),
                "ficha-pago-abono": alojamiento.reduce((s, c) => s + Number(c.aplicado_neto || 0), 0),
                "ficha-pago-saldo": alojamiento.reduce((s, c) => s + Number(c.saldo_cargo || 0), 0),
                "ficha-pago-servicios": serviciosCargo.reduce((s, c) => s + Number(c.saldo_cargo || 0), 0)
            };
            Object.entries(valores).forEach(([campoId, valor]) => {
                const el = id(campoId);
                if (el) el.textContent = dinero(valor);
            });

            pintarServicios(serviciosR.data || [], cargos);
            pintarNotas(notasR.data || []);
            pintarSolicitudes(solicitudesR.data || []);

            const editar = id("ficha-reserva-editar");
            if (editar) editar.hidden = true;

            const modal = id("ficha-reserva-modal");
            if (!modal) throw new Error("No se encontró la ficha visual.");
            modal.dataset.reservaId = reserva.id;
            modal.dataset.numeroCabana = String(estadia.cabana_numero || "");
            modal.dataset.reservaCancelada = "true";
            modal.dataset.reservaNoShow = "false";
            modal.hidden = false;

            await prepararMenuCancelada(reserva.id);
            console.info("HAIKU · Ficha cancelada cargada desde Supabase:", reserva.codigo_haiku || reserva.id);
        } catch (error) {
            console.error("HAIKU · No fue posible abrir reserva cancelada:", error);
            alert(error?.message || "No fue posible abrir la reserva cancelada.");
        } finally {
            cargandoFicha = false;
        }
    }

    function limpiarArchivoLegacy(reservaId) {
        try {
            const clave = "haikuReservasCanceladas";
            const datos = JSON.parse(localStorage.getItem(clave) || "[]");
            if (Array.isArray(datos)) {
                localStorage.setItem(
                    clave,
                    JSON.stringify(datos.filter(item =>
                        String(item?.reservaId || item?.id || "") !== String(reservaId)
                    ))
                );
                return;
            }
            if (datos && typeof datos === "object") {
                delete datos[reservaId];
                Object.keys(datos).forEach(claveItem => {
                    const item = datos[claveItem];
                    if (String(item?.reservaId || item?.id || "") === String(reservaId)) {
                        delete datos[claveItem];
                    }
                });
                localStorage.setItem(clave, JSON.stringify(datos));
            }
        } catch (_) {}
    }

    async function refrescarTrasReactivar() {
        const tareas = [];
        if (typeof window.haikuSincronizarReservasSupabase === "function") {
            tareas.push(Promise.resolve().then(() => window.haikuSincronizarReservasSupabase()));
        }
        if (window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar) {
            tareas.push(Promise.resolve().then(() => window.HAIKU_OPERACION_RESUMEN_FIX_V1.refrescar()));
        }
        if (typeof window.haikuCargarPagosPendientesSupabase === "function") {
            tareas.push(Promise.resolve().then(() => window.haikuCargarPagosPendientesSupabase()));
        }
        await Promise.allSettled(tareas);

        try { if (typeof generarCalendario === "function") generarCalendario(); } catch (_) {}
        try { if (typeof cargarCabanasDia === "function") cargarCabanasDia(fechaSeleccionada, {
            evento: "reserva reactivada", tipo: "externo"
        }); } catch (_) {}
        try { if (typeof actualizarResumenDia === "function") actualizarResumenDia(fechaSeleccionada); } catch (_) {}
        try { if (typeof generarResumenOperativo === "function") generarResumenOperativo(fechaSeleccionada); } catch (_) {}
    }

    async function reactivarReserva(reservaId, estadoSolicitado) {
        if (!reservaId || reactivando) return;

        const etiqueta = estadoSolicitado === "confirmada"
            ? "Confirmada"
            : "Confirmación pendiente";

        if (!window.confirm(
            `¿Reactivar esta reserva como ${etiqueta}?\n\n` +
            "HAIKU comprobará que la misma cabaña y fechas sigan disponibles antes de reactivarla."
        )) return;

        reactivando = true;
        cerrarMenuEstado();

        try {
            const { data, error } = await cliente.rpc(
                "haiku_reactivar_reserva_cancelada",
                {
                    p_reserva_id: reservaId,
                    p_estado_solicitado: estadoSolicitado
                }
            );
            if (error) throw error;

            limpiarArchivoLegacy(reservaId);
            document
                .querySelectorAll(`[data-haiku-cancelada-supabase='1'][data-reserva-id='${CSS.escape(String(reservaId))}']`)
                .forEach(el => el.remove());

            const modal = id("ficha-reserva-modal");
            if (modal) {
                modal.dataset.reservaCancelada = "false";
                modal.hidden = true;
            }
            restaurarMenuReactivacion();

            await refrescarTrasReactivar();

            const estadoFinal = data?.estado === "confirmada"
                ? "Confirmada"
                : "Confirmación pendiente";
            alert(`Reserva reactivada como ${estadoFinal}. Ya volvió al Resumen y al Calendario.`);
        } catch (error) {
            console.error("HAIKU · No fue posible reactivar reserva:", error);
            alert(error?.message || "No fue posible reactivar la reserva.");
        } finally {
            reactivando = false;
        }
    }

    async function buscarCanceladas(texto) {
        const contenedor = id("resultados-busqueda-reservas");
        if (!contenedor) return;

        contenedor
            .querySelectorAll("[data-haiku-cancelada-supabase='1']")
            .forEach(el => el.remove());

        const termino = String(texto || "").trim();
        if (termino.length < 2 || !window.haikuSesion) return;

        try {
            const { data, error } = await cliente.rpc(
                "haiku_buscar_reservas_canceladas",
                { p_busqueda: termino }
            );
            if (error) throw error;

            const resultados = Array.isArray(data) ? data : [];
            resultados.forEach(item => {
                const reservaId = String(item.reserva_id || "");
                if (!reservaId) return;

                const existente = Array.from(
                    contenedor.querySelectorAll("[data-reserva-id]")
                ).find(el => String(el.dataset.reservaId || "") === reservaId);

                if (existente) {
                    existente.dataset.haikuCanceladaSupabase = "1";
                    return;
                }

                const boton = document.createElement("button");
                boton.type = "button";
                boton.className = "resultado-reserva-item haiku-resultado-cancelada";
                boton.dataset.reservaId = reservaId;
                boton.dataset.haikuCanceladaSupabase = "1";

                const fuerte = document.createElement("strong");
                fuerte.textContent = item.titular || "Sin titular";
                const meta = document.createElement("span");
                const tipo = item.tipo_estadia === "fullday" ? "Full Day" : "Alojamiento";
                meta.textContent = `Cancelada · CAB ${item.cabana_numero} · ${fechaCorta(item.fecha_ingreso)} · ${tipo}`;
                const codigo = document.createElement("small");
                codigo.textContent = item.codigo_haiku || item.cloudbeds_id || "";

                boton.append(fuerte, meta, codigo);
                contenedor.appendChild(boton);
            });

            if (resultados.length > 0) contenedor.hidden = false;
        } catch (error) {
            console.warn("HAIKU · Búsqueda de canceladas:", error);
        }
    }

    document.addEventListener("input", evento => {
        if (evento.target?.id !== "busqueda-reservas") return;
        clearTimeout(temporizadorBusqueda);
        const valor = evento.target.value;
        temporizadorBusqueda = setTimeout(() => buscarCanceladas(valor), 180);
    });

    document.addEventListener("click", evento => {
        const resultado = evento.target?.closest?.(
            "[data-haiku-cancelada-supabase='1'][data-reserva-id]"
        );
        if (!resultado) return;

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();

        const resultados = id("resultados-busqueda-reservas");
        if (resultados) resultados.hidden = true;
        abrirFichaCancelada(String(resultado.dataset.reservaId || ""));
    }, true);

    document.addEventListener("click", evento => {
        const opcion = evento.target?.closest?.(
            '#ficha-estado-menu [data-ficha-estado-opcion="confirmada"], ' +
            '#ficha-estado-menu [data-ficha-estado-opcion="confirmacion-pendiente"]'
        );
        if (!opcion) return;

        const modal = id("ficha-reserva-modal");
        if (!modal || modal.dataset.reservaCancelada !== "true") return;

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();

        if (opcion.disabled) return;
        reactivarReserva(
            String(modal.dataset.reservaId || ""),
            String(opcion.dataset.fichaEstadoOpcion || "")
        );
    }, true);

    const modal = id("ficha-reserva-modal");
    if (modal) {
        const observador = new MutationObserver(() => {
            if (modal.hidden) {
                secuenciaModal++;
                restaurarMenuReactivacion();
                return;
            }

            const reservaId = String(modal.dataset.reservaId || "");
            if (!reservaId) return;
            setTimeout(() => prepararMenuCancelada(reservaId), 30);
        });
        observador.observe(modal, {
            attributes: true,
            attributeFilter: ["hidden", "data-reserva-id"]
        });
    }

    const estilo = document.createElement("style");
    estilo.textContent = `
        #ficha-estado-menu button:disabled[data-haiku-reactivacion-bloqueado="1"] {
            opacity: .38;
            cursor: not-allowed;
        }
        .haiku-resultado-cancelada {
            position: relative;
        }
        .haiku-resultado-cancelada::after {
            content: "CANCELADA";
            margin-left: auto;
            padding: 2px 6px;
            border-radius: 999px;
            background: #f7e8e6;
            color: #9b433a;
            font-size: 8px;
            font-weight: 700;
            letter-spacing: .05em;
        }
        .haiku-resultado-cancelada strong,
        .haiku-resultado-cancelada span,
        .haiku-resultado-cancelada small {
            pointer-events: none;
        }
    `;
    document.head.appendChild(estilo);

    window.HAIKU_REACTIVAR_CANCELADAS_V2 = Object.freeze({
        abrir: abrirFichaCancelada,
        reactivar: reactivarReserva,
        buscar: buscarCanceladas
    });

    console.info("HAIKU · Reactivación segura de canceladas V2 preparada.");
})();
