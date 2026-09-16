/* Haku Libro: resolución pura de aplicaciones de servicios contra cargos reales. */
(function (root) {
    "use strict";

    const normalizar = valor => String(valor ?? "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

    function conceptoCanon(valor) {
        const texto = normalizar(valor);
        if (!texto) return null;
        if (/\blate\s*(?:check\s*)?out\b|\blateout\b/.test(texto)) return "late_checkout";
        if (/\bearly\s*(?:check\s*)?in\b|\bearlyin\b/.test(texto)) return "early_checkin";
        if (/\bcama\s+adicional\b/.test(texto)) return "cama_adicional";
        if (/\blena\b/.test(texto)) return "lena";
        if (/\bmasaj/.test(texto)) return "masaje";
        if (/\btonel\b/.test(texto)) return "tinaja_tonel";
        if (/\bjacuzzi\b/.test(texto)) return "tinaja_jacuzzi";
        if (/\btinaja\b/.test(texto)) return "tinaja";
        if (/\bcuna\b/.test(texto)) return "cuna";
        return null;
    }

    function aplicacionesLibro(pago) {
        if (!pago || typeof pago !== "object") return [];
        if (pago.clasificacion_financiera === "nota_financiera" || pago.conflicto_distribucion) return [];
        if (/anulad|cancelad|invalid/.test(normalizar(pago.estado || pago.estado_pago))) return [];
        if (pago.transaccion_distribuida && Array.isArray(pago.aplicaciones_libro)) {
            return pago.aplicaciones_libro.map((aplicacion, indice) => ({
                ...aplicacion,
                indice,
                concepto_canon: conceptoCanon(aplicacion.concepto || aplicacion.tipo_movimiento),
                monto: Number(aplicacion.monto),
                fecha: aplicacion.fecha_bloque || aplicacion.fecha_comprobante || null
            }));
        }
        if (pago.tipo_movimiento !== "servicio") return [];
        return [{
            indice: 0,
            concepto: pago.concepto || null,
            concepto_canon: conceptoCanon(pago.concepto),
            monto: Number(pago.monto),
            fecha: pago.fecha_bloque || pago.fecha_comprobante || null,
            origen: pago.origen || null,
            metadata_servicio: pago.servicio || pago.metadata_servicio || null
        }];
    }

    async function paginas(fabrica) {
        const salida = [];
        for (let desde = 0; ; desde += 1000) {
            const consulta = fabrica();
            const respuesta = typeof consulta?.range === "function"
                ? await consulta.range(desde, desde + 999)
                : await consulta;
            if (respuesta?.error) throw respuesta.error;
            const filas = Array.isArray(respuesta?.data) ? respuesta.data : [];
            salida.push(...filas);
            if (filas.length < 1000) return salida;
        }
    }

    async function leerSnapshot(cliente, reservaIds) {
        const ids = [...new Set((reservaIds || []).filter(Boolean))];
        if (!cliente?.from) throw new Error("No está disponible la lectura financiera de Proyecto H.");
        if (!ids.length) return { disponible: true, cargos: [], servicios: [], aplicaciones: [], pagos: [] };

        const [cargos, servicios] = await Promise.all([
            paginas(() => cliente.from("vista_estado_cargos")
                .select("cargo_id,reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,monto_ajustado,aplicado_neto,saldo_cargo,estado,estado_pago")
                .in("reserva_id", ids).eq("tipo_cargo", "servicio").order("cargo_id")),
            paginas(() => cliente.from("servicios")
                .select("id,reserva_id,estadia_id,fecha_servicio,total,tipo_cobro,estado_servicio,observaciones,catalogo_servicios(codigo,nombre,categoria)")
                .in("reserva_id", ids).order("id"))
        ]);

        const cargoIds = cargos.map(cargo => cargo.cargo_id).filter(Boolean);
        const aplicaciones = cargoIds.length ? await paginas(() => cliente.from("pago_aplicaciones")
            .select("id,pago_id,cargo_id,monto_aplicado").in("cargo_id", cargoIds).order("cargo_id")) : [];
        const pagoIds = [...new Set(aplicaciones.map(aplicacion => aplicacion.pago_id).filter(Boolean))];
        const pagos = pagoIds.length ? await paginas(() => cliente.from("pagos")
            .select("id,reserva_id,monto,moneda,estado,folio,codigo_autorizacion,bove,datos_origen,medio_pago,fecha_pago,tipo_movimiento")
            .in("id", pagoIds).order("id")) : [];

        return { disponible: true, cargos, servicios, aplicaciones, pagos };
    }

    function enriquecerCargos(snapshot, reservaId) {
        const servicios = new Map((snapshot?.servicios || []).map(servicio => [servicio.id, servicio]));
        return (snapshot?.cargos || []).filter(cargo => cargo.reserva_id === reservaId && cargo.tipo_cargo === "servicio")
            .map(cargo => {
                const servicio = servicios.get(cargo.servicio_id) || null;
                const catalogo = servicio?.catalogo_servicios || {};
                return {
                    ...cargo,
                    servicio,
                    concepto_canon: conceptoCanon([cargo.concepto, catalogo.codigo, catalogo.nombre, catalogo.categoria].filter(Boolean).join(" ")),
                    monto_ajustado: Number(cargo.monto_ajustado ?? cargo.monto),
                    aplicado_neto: Number(cargo.aplicado_neto || 0),
                    saldo_cargo: Number(cargo.saldo_cargo || 0)
                };
            });
    }

    function cargoAplicable(cargo) {
        const servicio = cargo.servicio;
        return cargo.estado === "activo" && cargo.monto_ajustado > 0 && servicio &&
            !/cancelad|no show/.test(normalizar(servicio.estado_servicio)) &&
            servicio.tipo_cobro !== "cortesia" && Number(servicio.total || 0) > 0;
    }

    function resolverAplicacion(aplicacion, cargos, snapshot, pagoSistema = null) {
        if (!aplicacion.concepto_canon || !Number.isSafeInteger(aplicacion.monto) || aplicacion.monto <= 0) {
            return { ...aplicacion, estado: "revision", motivo: "La aplicación no tiene concepto o monto financiero válido." };
        }
        const conceptoCompatible = cargo => cargo.concepto_canon === aplicacion.concepto_canon ||
            (aplicacion.concepto_canon === "tinaja" && ["tinaja_tonel", "tinaja_jacuzzi"].includes(cargo.concepto_canon));
        let compatibles = cargos.filter(cargo => cargoAplicable(cargo) && conceptoCompatible(cargo));
        if (!compatibles.length) {
            return { ...aplicacion, estado: "sin_destino", motivo: "No existe un servicio pendiente compatible en Proyecto H.", candidatos: [] };
        }

        const mismaFecha = compatibles.filter(cargo => aplicacion.fecha && cargo.servicio?.fecha_servicio === aplicacion.fecha);
        if (mismaFecha.length) compatibles = mismaFecha;

        const yaAplicada = cargo => pagoSistema?.id && (snapshot?.aplicaciones || []).some(item =>
            item.pago_id === pagoSistema.id && item.cargo_id === cargo.cargo_id && Number(item.monto_aplicado) === aplicacion.monto);
        const exacta = compatibles.filter(yaAplicada);
        if (exacta.length === 1) {
            return { ...aplicacion, estado: "ya_aplicada", cargo_id: exacta[0].cargo_id, cargo: exacta[0], motivo: "El comprobante ya está aplicado a este cargo." };
        }
        if (exacta.length > 1) {
            return { ...aplicacion, estado: "revision", motivo: "El comprobante aparece aplicado a más de un cargo compatible.", candidatos: exacta };
        }

        const pendientes = compatibles.filter(cargo => cargo.saldo_cargo > 0);
        if (!pendientes.length) {
            return { ...aplicacion, estado: "ya_aplicada", motivo: "El cargo compatible ya está pagado; no se puede aplicar nuevamente.", candidatos: compatibles };
        }
        if (pendientes.length > 1) {
            return { ...aplicacion, estado: "multiples_destinos", motivo: "Existe más de un cargo pendiente compatible; no se elige por orden.", candidatos: pendientes };
        }

        const cargo = pendientes[0];
        if (aplicacion.monto > cargo.saldo_cargo) {
            return { ...aplicacion, estado: "saldo_insuficiente", cargo_id: cargo.cargo_id, cargo,
                motivo: "El monto de la aplicación supera el saldo pendiente del cargo." };
        }
        return { ...aplicacion, estado: "destino_unico", cargo_id: cargo.cargo_id, cargo,
            aplicacion_parcial: aplicacion.monto < cargo.saldo_cargo,
            remanente_cargo: cargo.saldo_cargo - aplicacion.monto,
            motivo: aplicacion.monto < cargo.saldo_cargo
                ? "Destino único; la aplicación es parcial y conserva saldo pendiente."
                : "Destino financiero único y saldo exacto." };
    }

    function resolverTransaccion(pago, reservaId, snapshot, pagoSistema = null) {
        if (!snapshot?.disponible) return { estado: "revision", resoluble: false, aplicaciones: [], motivo: snapshot?.error || "No fue posible leer el snapshot financiero." };
        if (!reservaId) return { estado: "revision", resoluble: false, aplicaciones: [], motivo: "La reserva destino no es inequívoca." };
        const aplicaciones = aplicacionesLibro(pago);
        if (!aplicaciones.length) return null;
        const suma = aplicaciones.reduce((total, aplicacion) => total + Number(aplicacion.monto || 0), 0);
        if (pago.transaccion_distribuida && suma !== Number(pago.monto)) {
            return { estado: "revision", resoluble: false, aplicaciones, motivo: "La suma de aplicaciones no coincide con el comprobante padre." };
        }
        const cargos = enriquecerCargos(snapshot, reservaId);
        const resueltas = aplicaciones.map(aplicacion => resolverAplicacion(aplicacion, cargos, snapshot, pagoSistema));
        const usados = new Map();
        for (const aplicacion of resueltas.filter(item => item.cargo_id && item.estado === "destino_unico")) {
            usados.set(aplicacion.cargo_id, (usados.get(aplicacion.cargo_id) || 0) + 1);
        }
        for (const aplicacion of resueltas) {
            if (aplicacion.cargo_id && usados.get(aplicacion.cargo_id) > 1) {
                aplicacion.estado = "revision";
                aplicacion.motivo = "Más de una aplicación intenta usar el mismo cargo; requiere revisión.";
            }
        }
        const resoluble = resueltas.length > 0 && resueltas.every(item => item.estado === "destino_unico");
        const todasAplicadas = resueltas.length > 0 && resueltas.every(item => item.estado === "ya_aplicada");
        return {
            estado: resoluble ? "destino_unico" : todasAplicadas ? "ya_aplicada" : "revision",
            resoluble,
            aplicaciones: resueltas,
            aplicaciones_payload: resoluble ? resueltas.map(item => ({ cargo_id: item.cargo_id, monto: item.monto })) : [],
            monto_total: Number(pago.monto),
            motivo: resoluble ? "Todas las aplicaciones tienen un destino financiero único." :
                todasAplicadas ? "Todas las aplicaciones ya están cubiertas en Proyecto H." : "Una o más aplicaciones requieren revisión."
        };
    }

    const api = Object.freeze({ conceptoCanon, aplicacionesLibro, leerSnapshot, resolverAplicacion, resolverTransaccion });
    root.HAIKU_LIBRO_PAGOS_DESTINOS_V1 = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
