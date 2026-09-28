// Estados canónicos y reglas compartidas por la ficha y sus pruebas locales.
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.HAIKU_RESERVA_ESTADO_MANUAL_V1 = api;
})(typeof window === "object" ? window : globalThis, function () {
    "use strict";
    const estados = Object.freeze([
        { valor: "pendiente", etiqueta: "Confirmación Pendiente" },
        { valor: "confirmada", etiqueta: "Confirmada" },
        { valor: "hospedada", etiqueta: "Hospedado" },
        { valor: "checked_out", etiqueta: "Check-out" },
        { valor: "cancelada", etiqueta: "Cancelada" },
        { valor: "no_show", etiqueta: "No Show" }
    ].map(Object.freeze));
    const etiqueta = valor => estados.find(e => e.valor === valor)?.etiqueta || valor;
    function actual(ficha, estadia) {
        const reserva = ficha.reserva.estado_reserva;
        if (["cancelada", "no_show"].includes(reserva)) return reserva;
        if (estadia.checkout_realizado_en || estadia.estado_estadia === "checked_out") return "checked_out";
        if (estadia.checkin_realizado_en || estadia.estado_estadia === "hospedada") return "hospedada";
        return estadia.estado_estadia === "confirmada" ? "confirmada" : "pendiente";
    }
    function esperado(ficha) {
        // Conserva los microsegundos de Postgres: Date.toISOString() los pierde.
        const hora = valor => {
            if (!valor) return null;
            const texto = String(valor);
            const fraccion = (texto.match(/[T ]\d{2}:\d{2}:\d{2}\.(\d+)/)?.[1] || "").replace(/0+$/, "");
            return new Date(valor).toISOString().slice(0, 19) + (fraccion ? `.${fraccion}` : "") + "Z";
        };
        return {
            estado_reserva: ficha.reserva.estado_reserva,
            estadias: ficha.estadias.map(e => ({
                id: e.id, cabana_numero: Number(e.cabana_numero),
                estado_estadia: e.estado_estadia,
                fecha_ingreso: String(e.fecha_ingreso).slice(0, 10),
                fecha_salida: String(e.fecha_salida).slice(0, 10), tipo_estadia: e.tipo_estadia,
                checkin_realizado_en: hora(e.checkin_realizado_en),
                checkout_realizado_en: hora(e.checkout_realizado_en)
            })).sort((a, b) => a.id.localeCompare(b.id))
        };
    }
    function abono(ficha) {
        return (ficha.pagos || []).filter(p => p.estado === "confirmado" &&
            p.tipo_movimiento === "pago" && p.etapa_operativa === "abono")
            .reduce((total, p) => total + Number(p.monto || 0), 0);
    }
    function opciones(ficha, estadia, permiso, ahora = new Date()) {
        const estado = actual(ficha, estadia);
        const partesChile = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
        }).formatToParts(ahora).map(p => [p.type, p.value]));
        const ahoraChile = `${partesChile.year}-${partesChile.month}-${partesChile.day}` +
            `T${partesChile.hour}:${partesChile.minute}:${partesChile.second}`;
        return estados.map(e => {
            let motivo = "";
            if (e.valor === estado) motivo = "Estado actual";
            else if (!permiso(e.valor === "cancelada" ? "reservas.cancelar" : "reservas.editar"))
                motivo = "No tienes permiso para realizar este cambio.";
            else if (estado === "cancelada" && e.valor !== "cancelada") {
                if (!["pendiente", "confirmada"].includes(e.valor))
                    motivo = "Primero reactiva la reserva como Pendiente o Confirmada.";
                else if (ficha.estadias.length !== 1)
                    motivo = "La reactivación de varias estadías requiere revisión.";
                else if (ficha.estadias.some(s => s.checkin_realizado_en || s.checkout_realizado_en))
                    motivo = "Tiene movimientos de check-in/check-out; no admite reactivación por esta vía.";
                else if (e.valor !== (abono(ficha) > 0 ? "confirmada" : "pendiente"))
                    motivo = abono(ficha) > 0 ? "Tiene abono confirmado: debe volver a Confirmada." :
                        "Sin abono confirmado: debe volver a Confirmación Pendiente.";
            } else if (estado === "no_show" && e.valor !== "cancelada")
                motivo = "No existe una ruta segura de reactivación de No Show; requiere revisión.";
            else if (e.valor === "pendiente" && abono(ficha) > 0)
                motivo = "Tiene abono confirmado; no puede quedar pendiente.";
            else if (e.valor === "no_show") {
                if (ficha.estadias.some(s => s.checkin_realizado_en || s.checkout_realizado_en ||
                    ["hospedada", "checked_out"].includes(s.estado_estadia)))
                    motivo = "Una reserva con check-in o check-out no puede ser No Show.";
                else if (ficha.estadias.some(s => !s.fecha_ingreso ||
                    ahoraChile < `${String(s.fecha_ingreso).slice(0, 10)}T00:00:00`))
                    motivo = "No Show se habilita desde las 00:00 de la fecha de ingreso en Chile.";
            }
            return { ...e, actual: e.valor === estado, motivo };
        });
    }
    function aviso(ficha, estadia, destino) {
        if (destino === "cancelada" || destino === "no_show")
            return "Afecta todas las estadías de la reserva y libera su disponibilidad. Conserva pagos y cargos.";
        if (ficha.reserva.estado_reserva === "cancelada")
            return "Se comprobarán abonos, bloqueos y disponibilidad antes de reactivar.";
        if (["confirmada", "pendiente"].includes(destino) &&
            (estadia.checkin_realizado_en || estadia.checkout_realizado_en ||
            ["hospedada", "checked_out"].includes(estadia.estado_estadia)))
            return "Se limpiarán el check-in y el check-out de esta estadía. Las fechas y los pagos se conservan.";
        if (destino === "hospedada" && actual(ficha, estadia) === "checked_out")
            return "Se eliminará el check-out de esta estadía y volverá a estar hospedada.";
        return "El cambio operativo afecta sólo a la estadía seleccionada. Se mantienen las validaciones de Proyecto H.";
    }
    return Object.freeze({ estados, etiqueta, actual, esperado, opciones, aviso });
});
