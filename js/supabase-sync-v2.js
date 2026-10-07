// ========================================
// HAIKU · SUPABASE · SINCRONIZACIÓN VISUAL V2
// Supabase = verdad; localStorage = cache temporal de presentación
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let sincronizando = false;

    function sumarDias(fecha, dias) {
        const [a, m, d] = String(fecha).slice(0, 10).split("-").map(Number);
        const base = new Date(a, m - 1, d, 12, 0, 0);
        base.setDate(base.getDate() + dias);
        return [
            base.getFullYear(),
            String(base.getMonth() + 1).padStart(2, "0"),
            String(base.getDate()).padStart(2, "0")
        ].join("-");
    }

    function diferenciaDias(inicio, fin) {
        const a = new Date(`${String(inicio).slice(0,10)}T12:00:00`);
        const b = new Date(`${String(fin).slice(0,10)}T12:00:00`);
        return Math.max(0, Math.round((b - a) / 86400000));
    }

    async function obtenerReservasActivas() {
        const { data, error } = await cliente
            .from("reserva_estadias")
            .select(`
                id,reserva_id,fecha_ingreso,fecha_salida,adultos,ninos,mascotas,
                tipo_estadia,estado_estadia,hora_ingreso_prevista,
                checkin_realizado_en,checkout_realizado_en,
                reservas(
                    id,codigo_haiku,cloudbeds_id,titular_nombre,
                    titular_numero_documento,correo_contacto,telefono_contacto,
                    observaciones,estado_reserva
                ),
                cabanas(numero,nombre),
                estadia_noches(fecha,tarifa)
            `)
            .order("fecha_ingreso", { ascending: true });

        if (error) throw error;

        return (data || []).filter(estadia =>
            !["cancelada", "no_show"].includes(estadia.estado_estadia) &&
            !["cancelada", "no_show"].includes(estadia.reservas?.estado_reserva)
        );
    }

    async function obtenerAbonos(reservaIds) {
        if (reservaIds.length === 0) return new Map();

        const { data, error } = await cliente
            .from("pagos")
            .select("reserva_id,monto,medio_pago,estado,tipo_movimiento,etapa_operativa,fecha_pago")
            .in("reserva_id", reservaIds)
            .eq("estado", "confirmado")
            .eq("tipo_movimiento", "pago")
            .eq("etapa_operativa", "abono")
            .order("fecha_pago", { ascending: true });

        if (error) throw error;

        const mapa = new Map();
        (data || []).forEach(pago => {
            const actual = mapa.get(pago.reserva_id) || {
                total: 0,
                ultimoMedio: ""
            };
            actual.total += Number(pago.monto || 0);
            actual.ultimoMedio = pago.medio_pago || actual.ultimoMedio;
            mapa.set(pago.reserva_id, actual);
        });
        return mapa;
    }

    async function obtenerHuespedes(reservaIds) {
        if (reservaIds.length === 0) return new Map();

        const { data, error } = await cliente
            .from("reserva_huespedes")
            .select("reserva_id,huespedes(id,nombre,apellido,tipo_documento,numero_documento,telefono,correo)")
            .in("reserva_id", reservaIds);

        if (error) throw error;

        const mapa = new Map();
        (data || []).forEach(rel => {
            if (!mapa.has(rel.reserva_id)) mapa.set(rel.reserva_id, []);
            if (rel.huespedes) mapa.get(rel.reserva_id).push(rel.huespedes);
        });
        return mapa;
    }

    function limpiarReservasDelCache() {
        try {
            Object.values(datosPorFecha || {}).forEach(dia => {
                if (!dia?.cabanas) return;
                Object.keys(dia.cabanas).forEach(numero => {
                    const cab = dia.cabanas[numero];
                    if (cab?.reservaId || cab?.haikuFuente === "supabase") {
                        delete dia.cabanas[numero];
                    }
                });
            });
        } catch {}
    }

    function medioUI(valor) {
        const mapa = {
            transferencia: "Transferencia",
            webpay_credito: "WebPay Crédito",
            webpay_debito: "WebPay Débito",
            tarjeta_credito: "Tarjeta Crédito",
            tarjeta_debito: "Tarjeta Débito",
            airbnb_prepaid_card: "Airbnb Prepaid Card", efectivo: "Efectivo"
        };
        return mapa[valor] || "";
    }

    function escribirEstadiaEnCache(estadia, abonos, huespedesPorReserva, fichas) {
        const reserva = estadia.reservas || {};
        const cabana = estadia.cabanas || {};
        const numero = String(cabana.numero || "");
        if (!numero || !reserva.id) return;

        const nochesDB = Array.isArray(estadia.estadia_noches)
            ? estadia.estadia_noches
            : [];
        const tarifasNoches = {};
        nochesDB.forEach(noche => {
            tarifasNoches[String(noche.fecha).slice(0,10)] = Number(noche.tarifa || 0);
        });

        const totalReserva = Object.values(tarifasNoches)
            .reduce((s, valor) => s + Number(valor || 0), 0);
        const infoAbono = abonos.get(reserva.id) || { total: 0, ultimoMedio: "" };
        const cantidadNoches = estadia.tipo_estadia === "fullday"
            ? 0
            : diferenciaDias(estadia.fecha_ingreso, estadia.fecha_salida);

        const huespedes = huespedesPorReserva.get(reserva.id) || [];
        const titularHuesped = huespedes.find(h =>
            String(h.numero_documento || "") === String(reserva.titular_numero_documento || "")
        ) || huespedes[0] || {};

        const acompanantes = huespedes.filter(h => h.id !== titularHuesped.id);

        const base = {
            haikuFuente: "supabase",
            reservaId: reserva.id,
            codigoHaiku: reserva.codigo_haiku || "",
            titular: reserva.titular_nombre || "",
            adultos: Number(estadia.adultos || 0),
            ninos: Number(estadia.ninos || 0),
            mascotas: Number(estadia.mascotas || 0),
            noches: cantidadNoches,
            fechaOrigenReserva: String(estadia.fecha_ingreso).slice(0,10),
            fechaIngresoReserva: String(estadia.fecha_ingreso).slice(0,10),
            correo: reserva.correo_contacto || titularHuesped.correo || "",
            telefono: reserva.telefono_contacto || titularHuesped.telefono || "",
            rut: reserva.titular_numero_documento || titularHuesped.numero_documento || "",
            observaciones: reserva.observaciones || "",
            tarifasNoches,
            totalReserva,
            abono: Number(infoAbono.total || 0),
            montoAbono: Number(infoAbono.total || 0),
            abonoVerificado: Number(infoAbono.total || 0) > 0,
            medioPago: medioUI(infoAbono.ultimoMedio),
            checkinRealizado: Boolean(estadia.checkin_realizado_en),
            checkinManual: Boolean(estadia.checkin_realizado_en),
            continuidadAutomatica: false
        };

        if (typeof obtenerDatosDia === "function") {
            const ingreso = String(estadia.fecha_ingreso).slice(0,10);

            if (estadia.tipo_estadia === "fullday") {
                const dia = obtenerDatosDia(ingreso);
                dia.cabanas[numero] = { ...base, estado: "fullday" };
            } else {
                for (let i = 0; i <= cantidadNoches; i++) {
                    const fecha = sumarDias(ingreso, i);
                    const dia = obtenerDatosDia(fecha);
                    const existente = dia.cabanas?.[numero];

                    let estado = "continua";
                    if (i === 0) estado = "libre-ingresa";
                    if (i === cantidadNoches) estado = "sale-libre";

                    if (
                        i === 0 &&
                        existente?.reservaId &&
                        existente.reservaId !== reserva.id &&
                        existente.estado === "sale-libre"
                    ) {
                        estado = "sale-ingresa";
                    }

                    dia.cabanas[numero] = {
                        ...base,
                        estado,
                        continuidadAutomatica: i > 0
                    };
                }
            }
        }

        fichas[reserva.id] = {
            titular: reserva.titular_nombre || "",
            rut: base.rut,
            telefono: base.telefono,
            correo: base.correo,
            observaciones: base.observaciones,
            totalReserva,
            tarifasNoches,
            numeroCabana: numero,
            fechaIngreso: base.fechaOrigenReserva,
            noches: cantidadNoches,
            adultos: base.adultos,
            ninos: base.ninos,
            mascotas: base.mascotas
        };

        for (let i = 0; i < 5; i++) {
            const h = acompanantes[i];
            fichas[reserva.id][`acompanante${i + 1}`] = h
                ? [h.nombre, h.apellido].filter(Boolean).join(" ")
                : "";
        }
    }

    async function sincronizarReservasSupabase() {
        if (sincronizando || !window.haikuSesion) return;
        sincronizando = true;

        try {
            const estadias = await obtenerReservasActivas();
            const reservaIds = [...new Set(estadias.map(e => e.reserva_id).filter(Boolean))];
            const [abonos, huespedes] = await Promise.all([
                obtenerAbonos(reservaIds),
                obtenerHuespedes(reservaIds)
            ]);

            limpiarReservasDelCache();

            const fichas = {};
            estadias.forEach(estadia =>
                escribirEstadiaEnCache(estadia, abonos, huespedes, fichas)
            );

            localStorage.setItem("haikuFichaReservas", JSON.stringify(fichas));

            try {
                if (typeof guardarDatos === "function") guardarDatos();
            } catch {}

            try {
                if (typeof generarCalendario === "function") generarCalendario();
            } catch {}

            console.info(
                "HAIKU · Cache visual sincronizado desde Supabase:",
                estadias.length,
                "estadías"
            );
        } catch (error) {
            console.error("HAIKU · No fue posible sincronizar cache visual:", error);
        } finally {
            sincronizando = false;
        }
    }

    window.haikuSincronizarReservasSupabase = sincronizarReservasSupabase;

    window.addEventListener("haiku:auth-ready", () => {
        setTimeout(sincronizarReservasSupabase, 50);
    });

    document.addEventListener("click", evento => {
        if (!evento.target.closest('[data-seccion="calendario"]')) return;
        setTimeout(sincronizarReservasSupabase, 20);
    });

    setTimeout(() => {
        if (window.haikuSesion) sincronizarReservasSupabase();
    }, 100);

    console.info("HAIKU · Sincronización visual Supabase V2 preparada.");
})();
