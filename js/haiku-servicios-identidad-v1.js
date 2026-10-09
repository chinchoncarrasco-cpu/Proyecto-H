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

    const ESTADOS_RECONCILIACION = Object.freeze({
        EXISTENTE_SEGURO: 'EXISTENTE_SEGURO', CANDIDATO_EXISTENTE: 'CANDIDATO_EXISTENTE',
        CONFLICTO: 'CONFLICTO', SIN_EXISTENTE: 'SIN_EXISTENTE'
    });
    const familia = c => /^masaje/.test(c) ? 'masaje' : /^tinaja/.test(c) ? 'tinaja' : c;
    const segundos = v => {
        const m = texto(v).match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d(?:\.\d+)?))?$/);
        return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0) : null;
    };
    const etiquetaCampo = campo => ({ hora_inicio: 'horario de inicio', hora_fin: 'horario de término',
        duracion: 'duración', estadia: 'estadía', fecha_fuera_estadia: 'fecha fuera de estadía',
        tipo_cobro: 'tipo de cobro', catalogo: 'tipo de servicio' }[campo] || campo);
    function decisionReconciliacion(categoria, evaluados, motivo, bloqueos = []) {
        const aliases = { EXISTENTE_SEGURO: 'existente', CANDIDATO_EXISTENTE: 'candidato', CONFLICTO: 'revisar', SIN_EXISTENTE: 'nuevo' };
        const candidatos = evaluados.map(x => x.candidato);
        return { categoria, estado: aliases[categoria], candidato: candidatos.length === 1 ? candidatos[0] : null,
            candidatos, evaluados, motivo, bloqueos,
            contradicciones: [...new Set(evaluados.flatMap(x => x.contradicciones.map(c => c.campo)))] };
    }
    // Evidencia parcial del Libro. No requiere ni recibe un payload de creación.
    function reconciliarServicio(e, existentes = []) {
        const salida = (estado, evaluados, motivo, bloqueos) => decisionReconciliacion(estado, evaluados, motivo, bloqueos);
        const codigos = new Set(e.codigos || []), marca = e.itemId ? `[HAKU-LIBRO-SERVICIO:${e.itemId}]` : '';
        const porOrigen = marca ? existentes.filter(x => texto(x.observaciones).includes(marca)) : [];
        const evaluar = candidato => {
            const n = normalizar(candidato), contradicciones = [], coincidencias = [], faltantes = [];
            const comprobar = (campo, esperado, actual, presente, igual = (a, b) => a === b) => {
                if (!presente) { faltantes.push(campo); return; }
                if (!igual(esperado, actual)) contradicciones.push({ campo, libro: esperado, proyectoH: actual });
                else coincidencias.push(campo);
            };
            comprobar('reserva', e.reservaId, n.reservaId, true);
            comprobar('estadia', e.estadiaId, n.estadiaId, true);
            comprobar('catalogo', [...codigos].join(' / '), n.codigo, true, (_, c) => codigos.has(c));
            if (!activo(candidato)) contradicciones.push({ campo: 'estado', libro: 'activo', proyectoH: n.estado });
            if (!n.fecha || (e.ingreso && n.fecha < e.ingreso) || (e.salida && n.fecha > e.salida))
                contradicciones.push({ campo: 'fecha_fuera_estadia', libro: `${e.ingreso} → ${e.salida}`, proyectoH: n.fecha });
            comprobar('fecha', e.fecha, n.fecha, e.fechaExplicita || e.fuerzaFecha);
            comprobar('hora_inicio', e.inicio, candidato.hora_inicio, Boolean(e.inicio), (a, b) => segundos(a) != null && segundos(a) === segundos(b));
            comprobar('hora_fin', e.fin, candidato.hora_fin, Boolean(e.fin), (a, b) => segundos(a) != null && segundos(a) === segundos(b));
            comprobar('cantidad', e.cantidad, numero(candidato.cantidad), e.cantidad != null);
            comprobar('personas', e.personas, numero(candidato.personas), e.personas != null);
            comprobar('tipo_cobro', e.tipoCobro, candidato.tipo_cobro, Boolean(e.tipoCobro));
            if (!['normal', 'cortesia'].includes(candidato.tipo_cobro))
                contradicciones.push({ campo: 'tipo_cobro', libro: e.tipoCobro || 'normal / cortesia', proyectoH: candidato.tipo_cobro });
            comprobar('monto', e.monto, numero(candidato.total), e.monto != null);
            if ((e.tipoCobro === 'cortesia' || candidato.tipo_cobro === 'cortesia') && numero(candidato.total) !== 0)
                contradicciones.push({ campo: 'monto', libro: 0, proyectoH: candidato.total });
            if (e.duracion != null) {
                const desde = segundos(candidato.hora_inicio), hasta = segundos(candidato.hora_fin);
                comprobar('duracion', e.duracion, desde != null && hasta != null ? (hasta - desde) / 60 : null, true);
            }
            return { candidato, coincidencias, contradicciones, faltantes };
        };
        if (!e.reservaId || !e.estadiaId)
            return salida('CONFLICTO', [], 'Falta una reserva y estadía inequívocas; no se ha demostrado ausencia de servicios.', e.bloqueos || []);
        const mismaFamilia = x => familia(codigo(x)) === e.familia;
        const relacionados = existentes.filter(x => activo(x) && texto(x.reserva_id) === e.reservaId &&
            (!x.estadia_id || texto(x.estadia_id) === e.estadiaId) && mismaFamilia(x));
        const esLate = e.familia === 'lateCheckout';
        const temporales = relacionados.filter(x => esLate ||
            ((!e.fechaExplicita || x.fecha_servicio === e.fecha) && (!e.inicio || hora(x.hora_inicio) === hora(e.inicio))));
        const pool = porOrigen.length ? [...new Map([...porOrigen, ...temporales].map(x => [x.id, x])).values()] : temporales;
        const evaluados = pool.map(evaluar);
        if (e.bloqueos?.length) return salida('CONFLICTO', evaluados, e.bloqueos.join(' '), e.bloqueos);
        if (!codigos.size) return salida('CONFLICTO', evaluados, 'No hay un catálogo compatible demostrado para esta prestación.');
        if (esLate && relacionados.length > 1)
            return salida('CONFLICTO', relacionados.map(evaluar), 'Hay más de un Late Check-out activo en la estadía; no se elige ni se crea otro.');
        if (porOrigen.length > 1)
            return salida('CONFLICTO', evaluados, 'El mismo origen identifica varios servicios; requiere revisión.');
        if (porOrigen.length === 1 && temporales.some(x => x.id !== porOrigen[0].id &&
            codigo(x) === codigo(porOrigen[0]) && x.fecha_servicio === porOrigen[0].fecha_servicio &&
            hora(x.hora_inicio) === hora(porOrigen[0].hora_inicio)))
            return salida('CONFLICTO', evaluados, 'Hay varias prestaciones del mismo tipo en el mismo horario; el marcador no permite elegir una automáticamente.');
        // Un origen estable conserva todas las restricciones, incluida fecha/estado/cobro.
        if (porOrigen.length === 1) {
            const delOrigen = evaluar(porOrigen[0]);
            if (delOrigen.contradicciones.length)
                return salida('CONFLICTO', [delOrigen], `El servicio del mismo origen contradice datos del Libro: ${delOrigen.contradicciones.map(x => etiquetaCampo(x.campo)).join(', ')}.`);
            return salida('EXISTENTE_SEGURO', [delOrigen], 'Mismo origen estable, destino correcto y evidencia compatible.');
        }
        const mismoCatalogo = evaluados.filter(x => codigos.has(codigo(x.candidato)));
        if (mismoCatalogo.length > 1)
            return salida('CONFLICTO', mismoCatalogo, 'Hay más de un servicio existente relacionado compatible con el catálogo; no se elige automáticamente.');
        if (mismoCatalogo.length === 1) {
            const evaluado = mismoCatalogo[0];
            if (evaluado.contradicciones.length)
                return salida('CONFLICTO', [evaluado], `El servicio existente contradice datos explícitos del Libro: ${evaluado.contradicciones.map(x => etiquetaCampo(x.campo)).join(', ')}.`);
            const temporalSegura = e.fecha && evaluado.candidato.fecha_servicio === e.fecha && Boolean(e.inicio);
            if (esLate || (e.catalogoDemostrado && temporalSegura))
                return salida('EXISTENTE_SEGURO', [evaluado], esLate ? 'Late Check-out único compatible con la evidencia declarada del Libro.' : 'Identidad operativa única compatible con la evidencia del Libro.');
            return salida('CANDIDATO_EXISTENTE', [evaluado], 'Único candidato compatible; falta evidencia para demostrar que sea la misma prestación repetible.');
        }
        if (evaluados.length)
            return salida('CONFLICTO', evaluados, `Hay servicios relacionados con diferencias: ${[...new Set(evaluados.flatMap(x => x.contradicciones.map(c => etiquetaCampo(c.campo))))].join(', ')}; no se creará otro sin resolverlas.`);
        return salida('SIN_EXISTENTE', [], 'Consulta completada: no se identificaron servicios relacionados con esta prestación.');
    }
    function reconciliarAsignaciones(items) {
        const reclamos = new Map();
        for (const item of items) {
            const d = item.reconciliacion;
            if (!d || !['EXISTENTE_SEGURO', 'CANDIDATO_EXISTENTE'].includes(d.categoria) || !d.candidato?.id) continue;
            if (!reclamos.has(d.candidato.id)) reclamos.set(d.candidato.id, []);
            reclamos.get(d.candidato.id).push(item);
        }
        for (const grupo of reclamos.values()) {
            if (grupo.length < 2) continue;
            // La misma evidencia/origen deduplicada puede aparecer en varias vistas;
            // dos ocurrencias independientes nunca consumen el mismo registro.
            if (grupo.every(x => x.item_id === grupo[0].item_id && x.firmaManual === grupo[0].firmaManual)) continue;
            for (const item of grupo) item.reconciliacion = decisionReconciliacion('CONFLICTO', item.reconciliacion.evaluados,
                'Dos prestaciones independientes reclaman el mismo servicio existente; la asociación está bloqueada.');
        }
        return items;
    }

    return Object.freeze({ version: "1.1.0", normalizar, activo, resolverServicio, huellaServicio, auditarDuplicados,
        ESTADOS_RECONCILIACION, reconciliarServicio, reconciliarAsignaciones });
});
