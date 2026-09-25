// ========================================
// HAIKU · PAGOS PENDIENTES SUPABASE V1
// Supabase como fuente única: pagos y BOVE se calculan juntos,
// pero se presentan como pendientes independientes.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const cachePorFecha = new Map();
    const cacheBovesPorFecha = new Map();
    const cargasPorFecha = new Map();

    let canal = null;
    let fechaVisible = "";
    let temporizador = null;
    let origenProgramado = null;

    function fechaActual() {
        try {
            return String(fechaSeleccionada || "").slice(0, 10);
        } catch (_) {
            return "";
        }
    }

    function claveReserva(fila, tipo) {
        if (tipo === "ingreso") {
            if (fila.estado_operativo === "fullday") {
                return {
                    reservaId: fila.fullday_reserva_id,
                    titular: fila.fullday_titular
                };
            }

            return {
                reservaId: fila.ingreso_reserva_id,
                titular: fila.ingreso_titular
            };
        }

        if (fila.estado_operativo === "fullday") {
            return {
                reservaId: fila.fullday_reserva_id,
                titular: fila.fullday_titular
            };
        }

        return {
            reservaId: fila.salida_reserva_id,
            titular: fila.salida_titular
        };
    }

    function operacionesDelDia(filas) {
        const ingresos = [];
        const salidas = [];

        (filas || []).forEach(fila => {
            if (
                ["libre-ingresa", "sale-ingresa", "fullday"]
                    .includes(fila.estado_operativo)
            ) {
                const ingreso = claveReserva(fila, "ingreso");
                if (ingreso.reservaId) {
                    ingresos.push({
                        numeroCabana: String(fila.numero),
                        reservaId: ingreso.reservaId,
                        titular: ingreso.titular || "Sin titular"
                    });
                }
            }

            if (
                ["sale-libre", "sale-ingresa", "fullday"]
                    .includes(fila.estado_operativo)
            ) {
                const salida = claveReserva(fila, "salida");
                if (salida.reservaId) {
                    salidas.push({
                        numeroCabana: String(fila.numero),
                        reservaId: salida.reservaId,
                        titular: salida.titular || "Sin titular"
                    });
                }
            }
        });

        return { ingresos, salidas };
    }

    function sumarSaldos(cargos, tipoCargo) {
        const saldos = new Map();

        (cargos || [])
            .filter(cargo =>
                cargo.estado === "activo" &&
                cargo.tipo_cargo === tipoCargo
            )
            .forEach(cargo => {
                const actual = Number(
                    saldos.get(cargo.reserva_id) || 0
                );
                saldos.set(
                    cargo.reserva_id,
                    actual + Number(cargo.saldo_cargo || 0)
                );
            });

        return saldos;
    }

    function ordenarPendientes(pendientes) {
        return pendientes.sort((a, b) => {
            const cabana =
                Number(a.numeroCabana) - Number(b.numeroCabana);

            if (cabana !== 0) return cabana;
            return String(a.tipo).localeCompare(String(b.tipo));
        });
    }

    function obtener(fecha = fechaActual()) {
        return (cachePorFecha.get(String(fecha).slice(0, 10)) || [])
            .map(item => ({ ...item }));
    }

    function estaListo(fecha = fechaActual()) {
        return cachePorFecha.has(String(fecha).slice(0, 10));
    }

    function obtenerBoves(fecha = fechaActual()) {
        return (cacheBovesPorFecha.get(String(fecha).slice(0, 10)) || [])
            .map(item => ({ ...item }));
    }

    function bovesListos(fecha = fechaActual()) {
        return cacheBovesPorFecha.has(String(fecha).slice(0, 10));
    }

    function actualizarPantalla(fecha, pendientes) {
        if (fecha !== fechaActual()) return;

        const contador = document.getElementById("contador-pagos");
        if (contador) contador.textContent = String(pendientes.length);

        try {
            if (typeof generarResumenOperativo === "function") {
                generarResumenOperativo(fecha);
            }
        } catch (_) {}

        const panel = document.getElementById("panel-notificaciones");
        if (panel && !panel.hidden) {
            try {
                if (typeof actualizarNotificaciones === "function") {
                    actualizarNotificaciones();
                }
            } catch (_) {}
        }

        // La vista Resumen reaplica su filtro cuando cambia el conjunto real
        // de pendientes, incluso si la cantidad permanece igual.
        document.dispatchEvent(new CustomEvent("haiku:resumen-pagos-actualizados", {
            detail: { fecha }
        }));

    }

    async function prepararPagos(fecha, filasOperacion = null) {
        const fechaISO = String(fecha || "").slice(0, 10);
        if (!fechaISO || !window.haikuSesion) return { pendientes: [], boves: [], cargos: [] };
            let filas = filasOperacion;
            if (!filas) {
                const respuesta = await cliente.rpc(
                    "haiku_operacion_dia", { p_fecha: fechaISO });
                if (respuesta.error) throw respuesta.error;
                filas = respuesta.data;
            }

            const { ingresos, salidas } = operacionesDelDia(filas);
            const ids = [
                ...new Set(
                    [...ingresos, ...salidas]
                        .map(item => item.reservaId)
                        .filter(Boolean)
                )
            ];

            if (ids.length === 0) {
                return { pendientes: [], boves: [], cargos: [] };
            }

            const [cargosR, reservasR] = await Promise.all([
                cliente
                    .from("vista_estado_cargos")
                    .select(
                        "reserva_id,tipo_cargo,estado,saldo_cargo,monto_ajustado"
                    )
                    .in("reserva_id", ids),
                cliente
                    .from("reservas")
                    .select("id,bove_cierre")
                    .in("id", ids)
            ]);

            if (cargosR.error) throw cargosR.error;
            if (reservasR.error) throw reservasR.error;

            const cargos = cargosR.data || [];
            const saldoAlojamiento = sumarSaldos(
                cargos,
                "alojamiento"
            );
            const saldoServicios = sumarSaldos(cargos, "servicio");
            const reservas = new Map(
                (reservasR.data || []).map(item => [item.id, item])
            );
            const pendientes = [];
            const bovesPendientes = [];

            ingresos.forEach(item => {
                if (!saldoAlojamiento.has(item.reservaId)) return;

                const saldo = Number(
                    saldoAlojamiento.get(item.reservaId) || 0
                );

                // Conservamos la secuencia operativa existente:
                // mientras queda saldo de alojamiento, primero se recuerda
                // el cobro. Cuando el saldo llega a 0, BOVE pasa a su propio
                // apartado si todavía no se ha cerrado.
                if (saldo > 0) {
                    pendientes.push({
                        tipo: "checkin",
                        numeroCabana: item.numeroCabana,
                        reservaId: item.reservaId,
                        titular: item.titular,
                        titulo: "Cobro check-in pendiente",
                        monto: saldo
                    });
                    return;
                }

                if (!reservas.get(item.reservaId)?.bove_cierre) {
                    bovesPendientes.push({
                        tipo: "bove",
                        numeroCabana: item.numeroCabana,
                        reservaId: item.reservaId,
                        titular: item.titular,
                        titulo: "BOVE alojamiento pendiente",
                        monto: 0
                    });
                }
            });

            salidas.forEach(item => {
                const saldo = Number(
                    saldoServicios.get(item.reservaId) || 0
                );

                if (saldo <= 0) return;

                pendientes.push({
                    tipo: "servicio",
                    numeroCabana: item.numeroCabana,
                    reservaId: item.reservaId,
                    titular: item.titular,
                    titulo: "Servicios pendientes de pago",
                    monto: saldo
                });
            });

            const resultado = ordenarPendientes(pendientes);
            const resultadoBoves = ordenarPendientes(bovesPendientes);

            return { pendientes: resultado, boves: resultadoBoves, cargos };
    }

    function publicarPagos(fechaISO, datos, avisar = true) {
        cachePorFecha.set(fechaISO, datos.pendientes);
        cacheBovesPorFecha.set(fechaISO, datos.boves);
        fechaVisible = fechaISO;
        if (avisar) actualizarPantalla(fechaISO, datos.pendientes);
        else {
            const contador = document.getElementById("contador-pagos");
            if (contador) contador.textContent = String(datos.pendientes.length);
        }
    }

    window.HAIKU_RESUMEN_REFRESH_V1?.registrar("pagos", {
        orden: 30,
        dependencias: ["operacion"],
        preparar: () => true,
        completar: ({ fecha, datos }) => prepararPagos(fecha, datos.operacion.filas),
        publicar: snapshot => publicarPagos(snapshot.fecha, snapshot.datos.pagos, false)
    });

    async function cargar(fecha = fechaActual(), origen = "cargar pagos") {
        const fechaISO = String(fecha || "").slice(0, 10);
        const solicitud = typeof origen === "string"
            ? { evento: origen, tipo: "externo" } : origen;
        if (!fechaISO || !window.haikuSesion) return [];
        if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) {
            await window.HAIKU_RESUMEN_REFRESH_V1.solicitar(fechaISO, {
                categoria: "pagos", ...solicitud
            });
            return obtener(fechaISO);
        }
        if (cargasPorFecha.has(fechaISO)) return cargasPorFecha.get(fechaISO);
        const carga = prepararPagos(fechaISO).then(datos => {
            if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) {
                return window.HAIKU_RESUMEN_REFRESH_V1.solicitar(fechaISO, {
                    categoria: "pagos", ...solicitud
                })
                    .then(() => obtener(fechaISO));
            }
            publicarPagos(fechaISO, datos);
            return obtener(fechaISO);
        });

        cargasPorFecha.set(fechaISO, carga);

        try {
            return await carga;
        } catch (error) {
            console.error(
                "HAIKU · No fue posible calcular pagos/BOVE pendientes:",
                error
            );
            throw error;
        } finally {
            cargasPorFecha.delete(fechaISO);
        }
    }

    function programar(retraso = 100, origen = "programar pagos") {
        const tipo = typeof origen === "string" ? "externo" : origen?.tipo;
        if (temporizador && origenProgramado === "externo" &&
            tipo === "interno_derivado") return;
        clearTimeout(temporizador);
        origenProgramado = tipo;
        temporizador = setTimeout(() => {
            temporizador = null;
            origenProgramado = null;
            cargar(fechaActual(), origen).catch(() => {});
        }, retraso);
    }

    function instalarRealtime() {
        if (canal || !window.haikuSesion) return;

        canal = cliente.channel("haiku-pagos-pendientes-v1");

        [
            "pagos",
            "pago_aplicaciones",
            "cargos",
            "reservas",
            "reserva_estadias"
        ].forEach(tabla => {
            canal.on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: tabla
                },
                () => programar(120, `realtime ${tabla}`)
            );
        });

        canal.subscribe(estado => {
            if (estado === "SUBSCRIBED") {
                console.info(
                    "HAIKU · Pagos/BOVE pendientes Realtime conectado."
                );
            }
        });
    }

    function obtenerSeccionNotificaciones(contenido) {
        let seccion = contenido.querySelector(
            ".notificaciones-seccion"
        );

        if (seccion) return seccion;

        contenido.innerHTML = "";

        seccion = document.createElement("div");
        seccion.className = "notificaciones-seccion";

        const titulo = document.createElement("div");
        titulo.className = "notificaciones-seccion-titulo";
        titulo.textContent = "Ahora";

        seccion.appendChild(titulo);
        contenido.appendChild(seccion);

        return seccion;
    }

    function renderizarBovesPendientes() {
        const contenido = document.getElementById(
            "notificaciones-contenido"
        );

        if (!contenido) return;

        contenido
            .querySelectorAll("[data-haiku-boves-pendientes]")
            .forEach(elemento => elemento.remove());

        const fecha = fechaActual();
        if (!bovesListos(fecha)) return;

        const boves = obtenerBoves(fecha);
        if (boves.length === 0) return;

        const seccion = obtenerSeccionNotificaciones(contenido);

        const resumenBoves = document.createElement("button");
        resumenBoves.type = "button";
        resumenBoves.className = "notificacion-item";
        resumenBoves.dataset.haikuBovesPendientes = "resumen";

        resumenBoves.innerHTML = `
            <span class="notificacion-icono">
                🧾
            </span>

            <span class="notificacion-contenido">
                <strong>
                    ${boves.length}
                    ${
                        boves.length === 1
                            ? "BOVE pendiente"
                            : "BOVE pendientes"
                    }
                </strong>

                <small>
                    Ver pendientes
                </small>
            </span>

            <span class="notificacion-flecha">
                ›
            </span>
        `;

        const detalleBoves = document.createElement("div");
        detalleBoves.className = "notificacion-detalle";
        detalleBoves.dataset.haikuBovesPendientes = "detalle";
        detalleBoves.hidden = true;

        boves.forEach(bove => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "notificacion-reserva";
            item.dataset.cabana = bove.numeroCabana;

            item.innerHTML = `
                <strong>
                    CAB ${bove.numeroCabana}
                    ·
                    ${bove.titular}
                </strong>

                <span>
                    BOVE alojamiento pendiente
                </span>
            `;

            detalleBoves.appendChild(item);
        });

        resumenBoves.addEventListener("click", () => {
            detalleBoves.hidden = !detalleBoves.hidden;

            const flecha = resumenBoves.querySelector(
                ".notificacion-flecha"
            );

            if (flecha) {
                flecha.textContent = detalleBoves.hidden
                    ? "›"
                    : "⌄";
            }
        });

        detalleBoves.addEventListener("click", evento => {
            const bove = evento.target.closest(
                ".notificacion-reserva"
            );

            if (!bove) return;

            const numeroCabana = bove.dataset.cabana;
            const botonCabana = document.querySelector(
                `[data-ficha-cabana="${numeroCabana}"]`
            );

            if (!botonCabana) return;

            try {
                if (typeof cerrarPanelNotificaciones === "function") {
                    cerrarPanelNotificaciones();
                }
            } catch (_) {}

            botonCabana.click();
        });

        seccion.appendChild(resumenBoves);
        seccion.appendChild(detalleBoves);
    }

    function instalarIntegracionNotificaciones() {
        const base = window.actualizarNotificaciones;

        if (
            typeof base !== "function" ||
            base.__haikuBovesSeparadosV1 === true
        ) {
            return;
        }

        const integrada = function (...args) {
            const resultado = base.apply(this, args);
            renderizarBovesPendientes();
            return resultado;
        };

        integrada.__haikuBovesSeparadosV1 = true;
        window.actualizarNotificaciones = integrada;
    }

    function iniciar() {
        if (!window.haikuSesion) return;
        instalarIntegracionNotificaciones();
        instalarRealtime();
        cargar(fechaActual()).catch(() => {});
    }

    window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1 = Object.freeze({
        obtener,
        estaListo,
        refrescar: cargar
    });

    window.HAIKU_BOVES_PENDIENTES_SUPABASE_V1 = Object.freeze({
        obtener: obtenerBoves,
        estaListo: bovesListos,
        refrescar: cargar
    });

    instalarIntegracionNotificaciones();

    window.addEventListener("haiku:auth-ready", iniciar);
    window.addEventListener("online", () => programar(0, "online"));
    window.addEventListener("focus", () => programar(0, {
        evento: "focus", tipo: "interno_derivado"
    }));
    window.addEventListener("pageshow", () => programar(0, {
        evento: "pageshow", tipo: "interno_derivado"
    }));

    document.addEventListener("click", () => {
        setTimeout(() => {
            const fecha = fechaActual();
            if (fecha && fecha !== fechaVisible) {
                cargar(fecha, { evento: "click document delayed",
                    tipo: "interno_derivado" })
                    .catch(() => {});
            }
        }, 0);
    }, true);

    if (window.haikuSesion) iniciar();
})();
