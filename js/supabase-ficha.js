// ========================================
// HAIKU · FICHA DE RESERVA DESDE SUPABASE
// Cache local = presentación, Supabase = verdad
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let permitiendoFichaLegacy = false;
    let cargandoFicha = false;

    function fechaActualHaiku() {
        try {
            return typeof fechaSeleccionada !== "undefined"
                ? String(fechaSeleccionada || "")
                : "";
        } catch {
            return "";
        }
    }

    function sumarDias(fecha, dias) {
        const [a, m, d] = String(fecha).split("-").map(Number);
        const base = new Date(a, m - 1, d, 12, 0, 0);
        base.setDate(base.getDate() + dias);
        return [
            base.getFullYear(),
            String(base.getMonth() + 1).padStart(2, "0"),
            String(base.getDate()).padStart(2, "0")
        ].join("-");
    }

    function diferenciaDias(inicio, fin) {
        const a = new Date(`${inicio}T12:00:00`);
        const b = new Date(`${fin}T12:00:00`);
        return Math.max(0, Math.round((b - a) / 86400000));
    }

    function formatearFecha(fecha) {
        if (!fecha) return "—";
        const [a, m, d] = String(fecha).slice(0, 10).split("-");
        return a && m && d ? `${d}-${m}-${a.slice(-2)}` : String(fecha);
    }

    function dinero(valor) {
        return `$${Number(valor || 0).toLocaleString("es-CL")}`;
    }

    function horaCorta(valor) {
        return valor ? String(valor).slice(0, 5) : "";
    }

    function reservaIdDeFila(fila) {
        if (!fila) return "";
        switch (fila.estado_operativo) {
            case "sale-ingresa":
            case "libre-ingresa":
                return fila.ingreso_reserva_id || "";
            case "sale-libre":
                return fila.salida_reserva_id || "";
            case "continua":
                return fila.continua_reserva_id || "";
            case "fullday":
                return fila.fullday_reserva_id || "";
            default:
                return "";
        }
    }

    async function resolverReserva(numeroCabana, fecha) {
        const { data, error } = await cliente.rpc(
            "haiku_operacion_dia",
            { p_fecha: fecha }
        );
        if (error) throw error;

        const fila = (data || []).find(
            item => Number(item.numero) === Number(numeroCabana)
        );

        return {
            fila: fila || null,
            reservaId: reservaIdDeFila(fila)
        };
    }

    async function cargarFichaCompleta(reservaId) {
        const { data: core, error: errorCore } = await cliente.rpc(
            "haiku_ficha_reserva_core",
            { p_reserva_id: reservaId }
        );
        if (errorCore) throw errorCore;
        if (!core?.reserva) return null;

        const [serviciosR, cargosR, notasR, solicitudesR, pagosR] =
            await Promise.all([
                cliente
                    .from("servicios")
                    .select("id,estadia_id,fecha_servicio,hora_inicio,hora_fin,cantidad,personas,precio_unitario_aplicado,monto_adicional,total,tipo_cobro,estado_servicio,observaciones,catalogo_servicios(codigo,nombre,categoria)")
                    .eq("reserva_id", reservaId)
                    .order("fecha_servicio", { ascending: true }),
                cliente
                    .from("vista_estado_cargos")
                    .select("cargo_id,servicio_id,estadia_noche_id,tipo_cargo,monto,estado,aplicado_neto,saldo_cargo,estado_pago")
                    .eq("reserva_id", reservaId),
                cliente
                    .from("notas")
                    .select("id,fecha_operacion,tipo,texto,importante,creado_en")
                    .eq("reserva_id", reservaId)
                    .order("creado_en", { ascending: true }),
                cliente
                    .from("solicitudes")
                    .select("id,categoria,descripcion,prioridad,estado,vence_en,observacion_cierre,creado_en")
                    .eq("reserva_id", reservaId)
                    .order("creado_en", { ascending: true }),
                cliente
                    .from("pagos")
                    .select("id,monto,tipo_movimiento,etapa_operativa,medio_pago,estado,fecha_pago")
                    .eq("reserva_id", reservaId)
                    .order("fecha_pago", { ascending: true })
            ]);

        [serviciosR, cargosR, notasR, solicitudesR, pagosR].forEach(resultado => {
            if (resultado.error) {
                console.warn("HAIKU · Ficha: lectura parcial no disponible", resultado.error);
            }
        });

        const cargos = cargosR.data || [];
        const estadoCargoServicio = new Map(
            cargos
                .filter(c => c.servicio_id)
                .map(c => [c.servicio_id, c])
        );

        const servicios = (serviciosR.data || []).map(servicio => {
            const catalogo = servicio.catalogo_servicios || {};
            const cargo = estadoCargoServicio.get(servicio.id);
            return {
                id: servicio.id,
                reservaId,
                tipoServicio: catalogo.codigo || "",
                categoria: catalogo.categoria || "",
                nombre: catalogo.nombre || "Servicio",
                cantidad: servicio.cantidad,
                personas: servicio.personas,
                fechaServicio: servicio.fecha_servicio,
                hora: horaCorta(servicio.hora_inicio),
                precioUnitario: servicio.precio_unitario_aplicado,
                total: servicio.total,
                tipoCobro: servicio.tipo_cobro,
                cortesia: servicio.tipo_cobro === "cortesia",
                estadoServicio:
                    servicio.estado_servicio === "programado"
                        ? "pendiente"
                        : servicio.estado_servicio,
                estadoPago:
                    cargo?.estado_pago ||
                    (Number(servicio.total || 0) === 0
                        ? "no-corresponde"
                        : "pendiente"),
                observaciones: servicio.observaciones || ""
            };
        });

        return {
            ...core,
            servicios,
            cargos,
            notas: notasR.data || [],
            solicitudes: solicitudesR.data || [],
            pagos: pagosR.data || []
        };
    }

    function prepararCacheLegacy(ficha, filaOperacion, fechaSeleccionadaLocal) {
        const reserva = ficha.reserva;
        const estadias = Array.isArray(ficha.estadias) ? ficha.estadias : [];
        const estadia = estadias[0];
        if (!estadia) return;

        const noches = (ficha.noches || []).filter(
            noche => String(noche.estadia_id) === String(estadia.id)
        );

        const tarifasNoches = {};
        noches.forEach(noche => {
            tarifasNoches[String(noche.fecha).slice(0, 10)] = Number(noche.tarifa || 0);
        });

        const totalAlojamiento = noches.reduce(
            (suma, noche) => suma + Number(noche.tarifa || 0),
            0
        );

        const cargosAlojamiento = (ficha.cargos || []).filter(
            cargo => cargo.tipo_cargo === "alojamiento" && cargo.estado === "activo"
        );

        const abonoAlojamiento = cargosAlojamiento.reduce(
            (suma, cargo) => suma + Number(cargo.aplicado_neto || 0),
            0
        );

        const huespedes = Array.isArray(ficha.huespedes) ? ficha.huespedes : [];
        const titular = huespedes.find(h => h.es_titular) || {};
        const acompanantes = huespedes.filter(h => !h.es_titular);

        const numeroCabana = String(estadia.cabana_numero);
        const cantidadNoches =
            estadia.tipo_estadia === "fullday"
                ? 0
                : diferenciaDias(estadia.fecha_ingreso, estadia.fecha_salida);

        const pagoAbono = (ficha.pagos || []).find(
            pago => pago.estado === "confirmado" && pago.etapa_operativa === "abono"
        );

        const base = {
            reservaId: reserva.id,
            codigoHaiku: reserva.codigo_haiku || "",
            titular: reserva.titular_nombre || "",
            adultos: estadia.adultos || 0,
            ninos: estadia.ninos || 0,
            mascotas: estadia.mascotas || 0,
            noches: cantidadNoches,
            fechaOrigenReserva: estadia.fecha_ingreso,
            fechaIngresoReserva: estadia.fecha_ingreso,
            correo: reserva.correo_contacto || titular.correo || "",
            telefono: reserva.telefono_contacto || titular.telefono || "",
            rut:
                reserva.titular_numero_documento ||
                titular.numero_documento || "",
            observaciones: reserva.observaciones || "",
            tarifasNoches,
            totalReserva: totalAlojamiento,
            abono: abonoAlojamiento,
            montoAbono: abonoAlojamiento,
            abonoVerificado: abonoAlojamiento > 0,
            medioPago: pagoAbono?.medio_pago || "",
            checkinRealizado: Boolean(estadia.checkin_realizado_en),
            checkinManual: Boolean(estadia.checkin_realizado_en),
            checkout: estadia.checkout_realizado_en
                ? horaCorta(new Date(estadia.checkout_realizado_en).toLocaleTimeString("es-CL", {
                    timeZone: "America/Santiago",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false
                }))
                : "",
            continuidadAutomatica: false
        };

        const fechaIngreso = String(estadia.fecha_ingreso).slice(0, 10);
        const fechaSalida = String(estadia.fecha_salida).slice(0, 10);

        if (typeof obtenerDatosDia === "function") {
            if (estadia.tipo_estadia === "fullday") {
                const dia = obtenerDatosDia(fechaIngreso);
                dia.cabanas[numeroCabana] = {
                    ...base,
                    estado: "fullday"
                };
            } else {
                for (let i = 0; i <= cantidadNoches; i++) {
                    const fecha = sumarDias(fechaIngreso, i);
                    const dia = obtenerDatosDia(fecha);
                    let estado = "continua";
                    if (i === 0) estado = "libre-ingresa";
                    if (i === cantidadNoches) estado = "sale-libre";
                    if (
                        fecha === fechaSeleccionadaLocal &&
                        filaOperacion?.estado_operativo
                    ) {
                        estado = filaOperacion.estado_operativo;
                    }

                    dia.cabanas[numeroCabana] = {
                        ...base,
                        estado,
                        continuidadAutomatica: i > 0,
                        checkout:
                            i === cantidadNoches
                                ? base.checkout
                                : ""
                    };
                }
            }
        }

        const fichas = JSON.parse(
            localStorage.getItem("haikuFichaReservas") || "{}"
        );

        fichas[reserva.id] = {
            titular: reserva.titular_nombre || "",
            rut: base.rut,
            telefono: base.telefono,
            correo: base.correo,
            observaciones: base.observaciones,
            totalReserva: totalAlojamiento,
            tarifasNoches,
            checkoutRealizado: Boolean(estadia.checkout_realizado_en)
        };

        for (let i = 0; i < 5; i++) {
            const huesped = acompanantes[i];
            fichas[reserva.id][`acompanante${i + 1}`] =
                huesped
                    ? [huesped.nombre, huesped.apellido].filter(Boolean).join(" ")
                    : "";
        }

        localStorage.setItem("haikuFichaReservas", JSON.stringify(fichas));

        const serviciosGuardados = JSON.parse(
            localStorage.getItem("haikuServicios") || "[]"
        ).filter(
            servicio => String(servicio.reservaId || "") !== String(reserva.id)
        );

        ficha.servicios.forEach(servicio => {
            serviciosGuardados.push({
                ...servicio,
                numeroCabana,
                titular: reserva.titular_nombre || ""
            });
        });

        localStorage.setItem("haikuServicios", JSON.stringify(serviciosGuardados));

        try {
            if (typeof guardarDatos === "function") guardarDatos();
        } catch {}
    }

    function limpiarClasesEstado(elemento) {
        if (!elemento) return;
        elemento.classList.remove(
            "ficha-estado-hospedado",
            "ficha-estado-checkout",
            "ficha-estado-pendiente",
            "ficha-estado-confirmada",
            "ficha-estado-confirmacion-pendiente",
            "ficha-estado-cancelada",
            "ficha-estado-no-show"
        );
    }

    function pintarEstado(ficha) {
        const campo = document.getElementById("ficha-reserva-estado");
        if (!campo) return;

        limpiarClasesEstado(campo);
        const estadia = ficha.estadias?.[0] || {};
        const estado = ficha.reserva.estado_reserva;

        if (estado === "cancelada") {
            campo.textContent = "● Cancelada";
            campo.classList.add("ficha-estado-cancelada");
        } else if (estado === "no_show") {
            campo.textContent = "● No-Show";
            campo.classList.add("ficha-estado-no-show");
        } else if (estado === "checked_out" || estadia.checkout_realizado_en) {
            campo.textContent = "● Checked Out";
            campo.classList.add("ficha-estado-checkout");
        } else if (estado === "hospedada" || estadia.checkin_realizado_en) {
            campo.textContent = "● Hospedado";
            campo.classList.add("ficha-estado-hospedado");
        } else if (estado === "confirmada") {
            campo.textContent = "● Confirmada";
            campo.classList.add("ficha-estado-confirmada");
        } else {
            campo.textContent = "● Confirmación pendiente";
            campo.classList.add("ficha-estado-confirmacion-pendiente");
        }
    }

    function crearFilaServicio(servicio, mostrarFecha) {
        const item = document.createElement("div");
        item.className = "ficha-servicio-item";

        const izquierda = document.createElement("span");
        const partes = [];
        if (mostrarFecha && servicio.fechaServicio) {
            partes.push(formatearFecha(servicio.fechaServicio));
        }
        if (servicio.hora) partes.push(servicio.hora);
        partes.push(servicio.nombre || "Servicio");
        izquierda.textContent = partes.join(" · ");

        const derecha = document.createElement("span");
        derecha.textContent = servicio.cortesia
            ? "🎁"
            : Number(servicio.total || 0) > 0
                ? dinero(servicio.total)
                : "";

        item.append(izquierda, derecha);
        return item;
    }

    function pintarServicios(ficha) {
        const programados = document.getElementById("ficha-servicios-programados");
        const realizados = document.getElementById("ficha-servicios-realizados");
        const pendientes = document.getElementById("ficha-servicios-pendientes");
        if (!programados || !realizados || !pendientes) return;

        const lista = ficha.servicios || [];
        const listaProgramados = lista.filter(s => s.estadoServicio !== "realizado");
        const listaRealizados = lista.filter(s => s.estadoServicio === "realizado");
        const listaPendientes = lista.filter(
            s => s.estadoPago === "pendiente" && !s.cortesia
        );

        programados.innerHTML = "";
        realizados.innerHTML = "";
        pendientes.innerHTML = "";

        listaProgramados.forEach(s => programados.appendChild(crearFilaServicio(s, true)));
        listaRealizados.forEach(s => realizados.appendChild(crearFilaServicio(s, true)));
        listaPendientes.forEach(s => pendientes.appendChild(crearFilaServicio(s, true)));

        const contadores = [
            ["ficha-servicios-programados-contador", listaProgramados.length],
            ["ficha-servicios-realizados-contador", listaRealizados.length],
            ["ficha-servicios-pendientes-contador", listaPendientes.length]
        ];
        contadores.forEach(([id, valor]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = String(valor);
        });
    }

    function pintarPagos(ficha) {
        const cargosAlojamiento = (ficha.cargos || []).filter(
            c => c.tipo_cargo === "alojamiento" && c.estado === "activo"
        );
        const cargosServicios = (ficha.cargos || []).filter(
            c => c.tipo_cargo === "servicio" && c.estado === "activo"
        );

        const total = cargosAlojamiento.reduce((s, c) => s + Number(c.monto || 0), 0);
        const abono = cargosAlojamiento.reduce((s, c) => s + Number(c.aplicado_neto || 0), 0);
        const saldo = cargosAlojamiento.reduce((s, c) => s + Number(c.saldo_cargo || 0), 0);
        const servicios = cargosServicios.reduce((s, c) => s + Number(c.saldo_cargo || 0), 0);

        const valores = {
            "ficha-pago-total": total,
            "ficha-pago-abono": abono,
            "ficha-pago-saldo": saldo,
            "ficha-pago-servicios": servicios
        };

        Object.entries(valores).forEach(([id, valor]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = dinero(valor);
        });
    }

    function pintarNotas(ficha) {
        const cont = document.getElementById("ficha-reserva-notas");
        if (!cont) return;
        cont.innerHTML = "";

        const notas = ficha.notas || [];
        if (notas.length === 0) {
            cont.textContent = "Sin notas registradas.";
            return;
        }

        notas.forEach(nota => {
            const fila = document.createElement("div");
            fila.className = "ficha-nota-item";
            const fecha = document.createElement("strong");
            fecha.textContent = `${formatearFecha(nota.fecha_operacion || String(nota.creado_en).slice(0,10))} ·`;
            const texto = document.createElement("span");
            texto.textContent = nota.texto || "";
            fila.append(fecha, texto);
            cont.appendChild(fila);
        });
    }

    function pintarSolicitudes(ficha) {
        const cont = document.getElementById("ficha-reserva-solicitudes");
        const contador = document.getElementById("ficha-solicitudes-contador");
        if (!cont) return;

        const solicitudes = ficha.solicitudes || [];
        const pendientes = solicitudes.filter(
            s => !["completada", "cancelada"].includes(s.estado)
        );
        const listas = solicitudes.filter(s => s.estado === "completada");

        if (contador) {
            contador.textContent = "";
            contador.hidden = true;
        }

        cont.innerHTML = "";
        if (solicitudes.length === 0) {
            cont.textContent = "Sin solicitudes pendientes.";
            return;
        }

        function grupo(titulo, items) {
            if (items.length === 0) return;
            const h = document.createElement("div");
            h.className = "ficha-solicitud-grupo-titulo";
            h.textContent = `${titulo} ${items.length}`;
            cont.appendChild(h);

            items.forEach(item => {
                const fila = document.createElement("div");
                fila.className = "ficha-solicitud-item";
                const fecha = document.createElement("strong");
                fecha.textContent = `${formatearFecha(item.vence_en?.slice(0,10) || item.creado_en?.slice(0,10))} ·`;
                const texto = document.createElement("span");
                texto.textContent = item.descripcion || "";
                fila.append(fecha, texto);
                cont.appendChild(fila);
            });
        }

        grupo("PENDIENTES", pendientes);
        grupo("LISTAS", listas);
    }

    function pintarFichaSupabase(ficha) {
        const reserva = ficha.reserva;
        const estadia = ficha.estadias?.[0];
        if (!reserva || !estadia) return;

        const idVisible =
            reserva.codigo_haiku ||
            reserva.cloudbeds_id ||
            reserva.id;

        const campoId = document.getElementById("ficha-reserva-id");
        if (campoId) campoId.textContent = idVisible;

        const modal = document.getElementById("ficha-reserva-modal");
        if (modal) {
            modal.dataset.reservaId = reserva.id;
            modal.dataset.numeroCabana = String(estadia.cabana_numero);
        }

        pintarEstado(ficha);
        pintarServicios(ficha);
        pintarPagos(ficha);
        pintarNotas(ficha);
        pintarSolicitudes(ficha);
        window.HAIKU_CHECKOUT_UI_V2?.mountStayLoans(document.getElementById("ficha-reserva-notas")?.closest(".ficha-bloque"),
            (ficha.estadias || []).map(item => ({ id: item.id, number: item.cabana_numero })));

        // Hasta conectar la edición real, evitamos guardar sólo en localStorage.
        const editar = document.getElementById("ficha-reserva-editar");
        if (editar) editar.hidden = true;

        document
            .querySelectorAll("#ficha-reserva-modal .ficha-dato-editable")
            .forEach(campo => {
                campo.readOnly = true;
                campo.tabIndex = -1;
            });

        console.info(
            "HAIKU · Ficha cargada desde Supabase:",
            idVisible
        );
    }

    async function abrirFichaDesdeSupabase(boton) {
        const numeroCabana = boton.dataset.fichaCabana;
        const fecha = fechaActualHaiku();
        if (!numeroCabana || !fecha || cargandoFicha) return;

        cargandoFicha = true;
        boton.disabled = true;

        try {
            const { fila, reservaId } = await resolverReserva(numeroCabana, fecha);

            if (!reservaId) {
                // Sin reserva real: limpiamos cualquier fantasma legacy de esa fecha/cabaña.
                try {
                    const dia = obtenerDatosDia(fecha);
                    if (dia?.cabanas) delete dia.cabanas[String(numeroCabana)];
                    if (typeof guardarDatos === "function") guardarDatos();
                } catch {}

                permitiendoFichaLegacy = true;
                try { boton.click(); } finally { permitiendoFichaLegacy = false; }
                return;
            }

            const ficha = await cargarFichaCompleta(reservaId);
            if (!ficha) throw new Error("No se encontró la ficha en Supabase.");

            prepararCacheLegacy(ficha, fila, fecha);

            permitiendoFichaLegacy = true;
            try {
                boton.disabled = false;
                boton.click();
            } finally {
                permitiendoFichaLegacy = false;
            }

            requestAnimationFrame(() => pintarFichaSupabase(ficha));
        } catch (error) {
            console.error("HAIKU · No fue posible abrir ficha desde Supabase:", error);
            window.HAIKU_DIALOGOS.aviso("No fue posible cargar la ficha desde Supabase.");
        } finally {
            boton.disabled = false;
            cargandoFicha = false;
        }
    }

    document.addEventListener(
        "click",
        evento => {
            const boton = evento.target.closest("[data-ficha-cabana]");
            if (!boton || permitiendoFichaLegacy || !window.haikuSesion) return;

            evento.preventDefault();
            evento.stopPropagation();
            evento.stopImmediatePropagation();

            abrirFichaDesdeSupabase(boton);
        },
        true
    );

    console.info("HAIKU · Puente Ficha Supabase preparado.");
})();
