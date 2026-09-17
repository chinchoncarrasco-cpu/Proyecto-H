// ========================================
// HAIKU · IDENTIDAD OPERATIVA DE SERVICIOS V1
// Comparación pura y conservadora compartida por Libro y UI legacy.
// ========================================
(function (root, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.HAIKU_SERVICIOS_IDENTIDAD_V1 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const CANCELADO_RE = /cancelad|no_show|anulad/i;
    const CODIGOS_CON_HORA = /^(?:tinajaJacuzzi|tinajaTonel|lateCheckout|masaje)/;

    function texto(valor) {
        return String(valor == null ? "" : valor).trim();
    }

    function hora(valor) {
        const m = texto(valor).match(/^(\d{1,2}):(\d{2})/);
        return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
    }

    function codigo(servicio) {
        const catalogo = servicio?.catalogo_servicios;
        return texto(
            servicio?.codigo_servicio ||
            servicio?.tipoServicio ||
            (Array.isArray(catalogo) ? catalogo[0]?.codigo : catalogo?.codigo)
        );
    }

    function numero(valor) {
        if (valor === null || valor === undefined || valor === "") return null;
        const n = Number(valor);
        return Number.isFinite(n) ? n : null;
    }

    function normalizar(servicio) {
        return {
            id: texto(servicio?.id || servicio?.servicio_id),
            reservaId: texto(servicio?.reserva_id || servicio?.reservaId),
            estadiaId: texto(servicio?.estadia_id || servicio?.estadiaId),
            cabana: texto(servicio?.cabana || servicio?.numeroCabana),
            codigo: texto(servicio?.codigo) || codigo(servicio),
            fecha: texto(servicio?.fecha_servicio || servicio?.fechaServicio || servicio?.fecha).slice(0, 10),
            hora: hora(servicio?.hora_inicio || servicio?.hora),
            total: numero(servicio?.total ?? servicio?.precio_manual ?? servicio?.precioManual),
            estado: texto(servicio?.estado_servicio || servicio?.estadoServicio),
            observaciones: texto(servicio?.observaciones),
            itemId: texto(servicio?.item_id || servicio?.itemId),
            legacyId: texto(servicio?.legacy_id || servicio?.idLegacy || servicio?.legacyId)
        };
    }

    function activo(servicio) {
        return !CANCELADO_RE.test(normalizar(servicio).estado);
    }

    function marcadores(servicio) {
        const n = normalizar(servicio), salida = [];
        if (n.itemId) salida.push(`[HAKU-LIBRO-SERVICIO:${n.itemId}]`);
        if (n.legacyId) salida.push(`HAIKU-LEGACY-ID:${n.legacyId}`);
        return salida;
    }

    function mismaReservaYEstadia(a, b) {
        return Boolean(a.reservaId && b.reservaId && a.reservaId === b.reservaId &&
            a.estadiaId && b.estadiaId && a.estadiaId === b.estadiaId);
    }

    function resultado(estado, candidatos, motivo) {
        return Object.freeze({ estado, candidato: candidatos.length === 1 ? candidatos[0] : null, candidatos, motivo });
    }

    function resolverServicio(nuevoServicio, existentes = []) {
        const nuevo = normalizar(nuevoServicio);
        if (!nuevo.reservaId || !nuevo.estadiaId || !nuevo.codigo) {
            return resultado("revisar", [], "Faltan reserva, estadía o tipo para comprobar el servicio sin adivinar.");
        }

        const activos = existentes.filter(activo).map(original => ({ original, normal: normalizar(original) }))
            .filter(x => mismaReservaYEstadia(nuevo, x.normal));
        const marcas = marcadores(nuevo);
        if (marcas.length) {
            const porOrigen = activos.filter(x => marcas.some(m => x.normal.observaciones.includes(m)));
            if (porOrigen.length === 1) return resultado("existente", [porOrigen[0].original], "Mismo origen estable.");
            if (porOrigen.length > 1) return resultado("revisar", porOrigen.map(x => x.original), "El mismo origen identifica varios servicios activos.");
        }

        const mismoCodigo = activos.filter(x => x.normal.codigo === nuevo.codigo);
        if (nuevo.codigo === "lateCheckout") {
            if (mismoCodigo.length === 1) return resultado("existente", [mismoCodigo[0].original], "Late Check-out activo único de la misma estadía.");
            if (mismoCodigo.length > 1) return resultado("revisar", mismoCodigo.map(x => x.original), "Ya hay varios Late Check-out activos en la estadía; requiere revisión.");
            return resultado("nuevo", [], "No existe un Late Check-out activo en esta estadía.");
        }

        if (!nuevo.fecha || (CODIGOS_CON_HORA.test(nuevo.codigo) && !nuevo.hora)) {
            return resultado("revisar", [], "Falta fecha u hora para comprobar la identidad operativa del servicio.");
        }

        const compatibles = mismoCodigo.filter(x => {
            if (x.normal.fecha !== nuevo.fecha) return false;
            if (CODIGOS_CON_HORA.test(nuevo.codigo) && x.normal.hora !== nuevo.hora) return false;
            if (nuevo.total !== null && x.normal.total !== null && x.normal.total !== nuevo.total) return false;
            return true;
        });

        if (compatibles.length === 1) return resultado("existente", [compatibles[0].original], "Mismo hecho operativo en la misma estadía.");
        if (compatibles.length > 1) return resultado("revisar", compatibles.map(x => x.original), "Más de un servicio activo representa el mismo hecho; no se elige automáticamente.");
        return resultado("nuevo", [], "No existe un servicio operativo compatible.");
    }

    function hashCorto(valor) {
        let h = 2166136261;
        for (const ch of texto(valor)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
        return (h >>> 0).toString(36);
    }

    function huellaServicio(servicio) {
        const n = normalizar(servicio);
        return `hecho:${hashCorto([n.reservaId, n.estadiaId, n.cabana, n.codigo, n.fecha, n.hora,
            n.total === null ? "" : n.total].join("|"))}`;
    }

    function auditarDuplicados(servicios = []) {
        const activos = servicios.filter(activo), agrupar = clave => {
            const grupos = new Map();
            activos.forEach(s => { const k = clave(normalizar(s)); if (!k) return; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(s); });
            return [...grupos.entries()].filter(([, items]) => items.length > 1).map(([claveGrupo, items]) => ({ clave: claveGrupo, items }));
        };
        return {
            lateCheckout: agrupar(n => n.codigo === "lateCheckout" && n.reservaId && n.estadiaId ? `${n.reservaId}|${n.estadiaId}` : ""),
            mismoHecho: agrupar(n => n.reservaId && n.estadiaId && n.codigo && n.fecha ?
                `${n.reservaId}|${n.estadiaId}|${n.codigo}|${n.fecha}|${n.hora}|${n.total ?? ""}` : "")
        };
    }

    return Object.freeze({ version: "1.0.0", normalizar, activo, resolverServicio, huellaServicio, auditarDuplicados });
});
