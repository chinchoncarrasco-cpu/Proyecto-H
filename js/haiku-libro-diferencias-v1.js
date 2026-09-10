/* ETAPA 1: comparación explícita, sólo lectura, sin UI ni acciones automáticas. */
(function (root) {
    'use strict';
    const texto = v => String(v ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
    const nombre = v => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const documento = v => texto(v).replace(/[.\s-]/g, '');
    const telefono = v => String(v ?? '').replace(/\D/g, '');
    const conocido = v => v !== null && v !== undefined && v !== '' && v !== 'no_determinado';
    const copia = v => structuredClone(v);
    const campos = ['cabana', 'fecha_checkin', 'fecha_checkout', 'noches', 'tipo_estadia', 'titular',
        'adultos', 'ninos', 'mascotas', 'estado_confirmacion', 'estado_operativo', 'operador',
        'rut_documento', 'correo', 'telefono', 'notas_importantes', 'pagos_pendientes', 'servicios'];
    const listas = new Set(['notas_importantes', 'pagos_pendientes', 'servicios']);
    const numeros = new Set(['cabana', 'noches', 'adultos', 'ninos', 'mascotas']);
    function canon(campo, valor) {
        if (campo === 'servicios') return valor.map(s => JSON.stringify([
            texto(s.concepto), s.pendiente ?? null, s.cortesia ?? null, s.hora ?? null, s.monto ?? null
        ])).sort(); // Texto libre y coordenadas son evidencia, no identidad del servicio.
        if (listas.has(campo)) return [...new Set(valor.map(texto))].sort();
        if (numeros.has(campo)) return Number(valor);
        if (campo === 'rut_documento') return documento(valor);
        if (campo === 'telefono') return telefono(valor);
        if (campo === 'titular') return nombre(valor);
        return texto(valor);
    }
    function salida(estado) {
        return {estado, resumen: {nuevas: 0, modificadas: 0, ya_no_aparecen: 0, ambiguas: 0},
            nuevas: [], modificadas: [], ya_no_aparecen: [], ambiguas: [], advertencias: [], no_comparables: [], continuidades: []};
    }
    function finalizar(r) {
        for (const k of Object.keys(r.resumen)) r.resumen[k] = r[k].length;
        if (r.estado === 'ok' && r.no_comparables.length && Object.values(r.resumen).some(Boolean)) r.estado = 'parcial';
        if (r.estado === 'ok' && !Object.values(r.resumen).some(Boolean)) r.estado = r.no_comparables.length ? 'no_comparable' : 'sin_cambios';
        return r;
    }
    function senales(r) {
        return {nombre: nombre(r.titular), documento: documento(r.rut_documento), correo: texto(r.correo), telefono: telefono(r.telefono)};
    }
    function claves(r) {
        const keys = Object.entries(senales(r)).filter(([k,v]) => v && (k !== 'telefono' || v.length >= 9))
            .map(([k,v]) => `${k}:${v}`);
        // Sólo candidato para revisión: compartir ubicación nunca confirma identidad.
        if (conocido(r.cabana) && conocido(r.fecha_checkin)) keys.push(`contexto:${Number(r.cabana)}:${r.fecha_checkin}`);
        return keys;
    }
    function indice(rows) {
        const map = new Map();
        rows.forEach((r,i) => claves(r).forEach(k => { if (!map.has(k)) map.set(k, []); map.get(k).push(i); }));
        return map;
    }
    function validarSegmento(r) {
        const avisos = [];
        const fechaValida = f => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && Number.isFinite(Date.parse(f)) && new Date(f).toISOString().slice(0,10) === f;
        const agregar = codigo => avisos.push({codigo, fecha_checkin:r.fecha_checkin ?? null, fecha_checkout:r.fecha_checkout ?? null,
            noches:r.noches ?? null, origen:copia(r.coordenadas_origen || {hoja:r.hoja ?? null,celda:r.id ?? null})});
        if (!fechaValida(r.fecha_checkin) || !fechaValida(r.fecha_checkout)) agregar('fechas_no_validas');
        else if (r.fecha_checkout < r.fecha_checkin) agregar('checkout_anterior_al_checkin');
        else if (r.tipo_estadia === 'full_day' && (r.fecha_checkout !== r.fecha_checkin || !conocido(r.noches) || Number(r.noches) !== 0)) agregar('full_day_inconsistente');
        else if (r.tipo_estadia === 'alojamiento' && r.fecha_checkout === r.fecha_checkin) agregar('alojamiento_sin_noche');
        return avisos;
    }
    function contextoExacto(a,b) {
        return ['cabana','fecha_checkin','fecha_checkout','tipo_estadia','noches'].every(k => conocido(a[k]) && conocido(b[k]) && canon(k,a[k]) === canon(k,b[k]));
    }
    function advertenciaNochesIdentica(a,b) {
        const aviso = 'Las noches escritas no coinciden con las fechas combinadas; confirmar ingreso/salida.';
        return a.advertencias?.length && b.advertencias?.length &&
            a.advertencias.every(x=>x===aviso) && b.advertencias.every(x=>x===aviso) &&
            conocido(a.noches_texto) && a.noches_texto === b.noches_texto;
    }
    function confianza(a, b, exacta = false) {
        if (a.advertencias_validacion?.length || b.advertencias_validacion?.length) return null;
        if ((a.advertencias?.length || b.advertencias?.length) && !(exacta && contextoExacto(a,b) && advertenciaNochesIdentica(a,b))) return null;
        const x = senales(a), y = senales(b);
        const iguales = k => !!x[k] && x[k] === y[k];
        const fuertes = ['documento', 'correo', 'telefono'].filter(k => iguales(k) && (k !== 'telefono' || x[k].length >= 9));
        const conflicto = ['documento', 'correo', 'telefono'].some(k => x[k] && y[k] && x[k] !== y[k]);
        const fecha = k => conocido(a[k]) && a[k] === b[k];
        const fechas = fecha('fecha_checkin') && fecha('fecha_checkout');
        const cabana = conocido(a.cabana) && conocido(b.cabana) && Number(a.cabana) === Number(b.cabana);
        // Un contacto identifica personas, no necesariamente una reserva: exigir contexto.
        if (fuertes.length && (!conflicto || fuertes.length >= 2) && (iguales('nombre') || (fechas && cabana) || fuertes.length >= 2)) {
            return {nivel: 'contactos_y_contexto', senales: fuertes};
        }
        if (!conflicto && iguales('nombre') && conocido(a.tipo_estadia) && a.tipo_estadia === b.tipo_estadia &&
            (fechas || (cabana && (fecha('fecha_checkin') || fecha('fecha_checkout'))))) {
            return {nivel: 'nombre_y_estadia', senales: ['titular', 'tipo_estadia', ...(fechas ? ['fecha_checkin','fecha_checkout'] : ['cabana', fecha('fecha_checkin') ? 'fecha_checkin' : 'fecha_checkout'])]};
        }
        return null;
    }
    function detectarContinuidades(rows, version) {
        const enlaces = [];
        rows.forEach((a,i) => {
            if (a.tipo_estadia !== 'alojamiento' || !nombre(a.titular) || a.advertencias?.length || a.advertencias_validacion?.length) return;
            rows.forEach((b,j) => {
                if (b.tipo_estadia !== 'full_day' || b.advertencias?.length || b.advertencias_validacion?.length || a.fecha_checkout !== b.fecha_checkin || nombre(a.titular) !== nombre(b.titular)) return;
                const x=senales(a),y=senales(b), keys=['documento','correo','telefono'];
                if (keys.some(k=>x[k] && y[k] && x[k]!==y[k])) return;
                const iguales=keys.filter(k=>x[k] && x[k]===y[k] && (k!=='telefono'||x[k].length>=9));
                if (!iguales.includes('documento') && !(iguales.includes('correo') && iguales.includes('telefono'))) return;
                enlaces.push({i,j,iguales});
            });
        });
        return enlaces.filter(e=>enlaces.filter(x=>x.i===e.i).length===1 && enlaces.filter(x=>x.j===e.j).length===1).map(e=>({
            version,tipo:'extension_full_day',inferida:true,
            segmentos:[rows[e.i],rows[e.j]].map(r=>({id:r.id,hoja:r.hoja,cabana:r.cabana,fecha_checkin:r.fecha_checkin,fecha_checkout:r.fecha_checkout,tipo_estadia:r.tipo_estadia,noches:r.noches})),
            evidencia:{contactos_coincidentes:e.iguales,fecha_enlace:rows[e.i].fecha_checkout},
            alcance:'Relación compatible de continuidad; conserva los segmentos, no fusiona reservas.'
        }));
    }
    function diferencias(a, b, advertencias) {
        const cambios = [];
        for (const campo of campos) {
            const av = a[campo], bv = b[campo];
            if (!conocido(av) || !conocido(bv) || (listas.has(campo) && (!Array.isArray(av) || !Array.isArray(bv)))) {
                if (conocido(av) || conocido(bv)) advertencias.push({campo, motivo: 'Campo no determinado en ambas versiones.', anterior: a.id, actual: b.id});
                continue;
            }
            if (JSON.stringify(canon(campo, av)) !== JSON.stringify(canon(campo, bv))) cambios.push({campo, antes: copia(av), ahora: copia(bv)});
        }
        return cambios;
    }
    // Entradas: arrays de hojas semánticas completas. null anterior = no hay línea base.
    // Sin fechas de ejecución: la función pura devuelve lo mismo para los mismos datos.
    function comparar(anterior, actual) {
        if (anterior == null) return salida('sin_linea_base');
        const out = salida('ok');
        if (!Array.isArray(anterior) || !Array.isArray(actual)) {
            out.no_comparables.push({motivo: 'Se requieren arrays de hojas semánticas.'}); return finalizar(out);
        }
        const extraer = (hojas, version) => hojas.flatMap(h => {
            if (!h?.cobertura?.geometria || !Array.isArray(h.reservas) || !Array.isArray(h.fechas) || !h.fechas.length) {
                out.no_comparables.push({version, hoja: h?.hoja ?? null, motivo: 'Geometría no reconocida o lectura incompleta.'}); return [];
            }
            if (h.advertencias?.length) out.advertencias.push({version, hoja: h.hoja, detalles: copia(h.advertencias)});
            return h.reservas.map(r => {
                const avisos = validarSegmento(r);
                if (!avisos.length) return r;
                out.advertencias.push({version,hoja:h.hoja,segmento:r.id,validacion:copia(avisos)});
                return {...r,advertencias_validacion:avisos};
            });
        });
        const prev = extraer(anterior, 'anterior'), next = extraer(actual, 'actual');
        out.continuidades = [...detectarContinuidades(prev,'anterior'),...detectarContinuidades(next,'actual')];
        // La cobertura temporal puede cambiar al quitar hojas o columnas: no afirmar ausencias.
        const cobertura = hojas => [...new Set(hojas.filter(h => h?.cobertura?.geometria).flatMap(h => h.fechas || []))].sort();
        if (JSON.stringify(cobertura(anterior)) !== JSON.stringify(cobertura(actual))) out.no_comparables.push({motivo: 'La cobertura de fechas cambió entre versiones.'});
        const ni = indice(next), relaciones = prev.map(a => [...new Set(claves(a).flatMap(k => ni.get(k) || []))]);
        const usadosA = new Set(), usadosB = new Set();
        // Primero desambiguar segmentos exactos dentro de identidades compatibles.
        // Después conservar el matcher flexible para cambios reales de CAB/fechas.
        for (const exacta of [true,false]) {
            const pares = relaciones.map((indices,i) => usadosA.has(i) ? [] : indices.filter(j => !usadosB.has(j) &&
                (!exacta || contextoExacto(prev[i],next[j])) && confianza(prev[i],next[j],exacta)));
            const inversos = next.map(() => []);
            pares.forEach((js,i) => js.forEach(j => inversos[j].push(i)));
            pares.forEach((js,i) => {
                if (js.length !== 1 || inversos[js[0]].length !== 1) return;
                const j = js[0], a = prev[i], b = next[j];
                usadosA.add(i); usadosB.add(j);
                if (exacta && (a.advertencias?.length || b.advertencias?.length)) out.advertencias.push({
                    tipo:'advertencia_de_origen_conservada',anterior:a.id,actual:b.id,detalles:copia(a.advertencias)});
                const cambios = diferencias(a,b,out.advertencias);
                if (cambios.length) out.modificadas.push({anterior: copia(a), actual: copia(b), coincidencia:{...confianza(a,b,exacta),contexto_exacto:exacta}, cambios});
            });
        }
        // Componentes de candidatos sin emparejar: nunca desempatar por posición u orden.
        const pendientesA = new Set(prev.map((_,i) => i).filter(i => !usadosA.has(i)));
        const pendientesB = new Set(next.map((_,i) => i).filter(i => !usadosB.has(i)));
        const inversasRelacion = next.map(() => []);
        relaciones.forEach((js,i) => js.forEach(j => inversasRelacion[j].push(i)));
        function componente(lado, inicio) {
            const a = [], b = [], cola = [[lado,inicio]];
            for (let p = 0; p < cola.length; p++) {
                const [l,i] = cola[p], pendientes = l === 'a' ? pendientesA : pendientesB;
                if (!pendientes.delete(i)) continue;
                (l === 'a' ? a : b).push(i);
                for (const j of (l === 'a' ? relaciones[i] : inversasRelacion[i])) cola.push([l === 'a' ? 'b' : 'a', j]);
            }
            const relacionados = a.some(i => relaciones[i].length) || b.some(i => inversasRelacion[i].length);
            const dudoso = r => r.advertencias?.length || r.advertencias_validacion?.length || !conocido(r.titular) || !conocido(r.cabana) || !conocido(r.fecha_checkin) || !conocido(r.fecha_checkout);
            const dudosos = a.some(i => dudoso(prev[i])) || b.some(i => dudoso(next[i]));
            if (relacionados || dudosos || out.no_comparables.length) {
                out.ambiguas.push({anteriores: a.map(i => copia(prev[i])), actuales: b.map(i => copia(next[i])),
                    motivo: out.no_comparables.length ? 'Cobertura incompleta: no se concluye alta o desaparición.' : 'Identidad no concluyente o múltiples candidatos.'});
            } else {
                out.ya_no_aparecen.push(...a.map(i => ({tipo: 'ya_no_aparece', anterior: copia(prev[i])})));
                out.nuevas.push(...b.map(i => ({actual: copia(next[i])})));
            }
        }
        for (const i of pendientesA) componente('a',i);
        for (const i of pendientesB) componente('b',i);
        return finalizar(out);
    }
    function mesHoja(hoja) {
        const m = String(hoja).trim().match(/^(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\s*(\d{2}|\d{4})$/i);
        if (!m) return null;
        const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
        if (year < 2000 || year > 2099) return null;
        return `${year}-${String(['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'].indexOf(m[1].toLowerCase())+1).padStart(2,'0')}`;
    }
    function planificarHojas(anterior, actual, fechaReferencia) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaReferencia) || !Number.isFinite(Date.parse(fechaReferencia)) || new Date(fechaReferencia).toISOString().slice(0,10) !== fechaReferencia) throw new Error('Fecha de referencia no válida.');
        const [year,month] = fechaReferencia.split('-').map(Number);
        const desde = new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,7);
        if (![1,2].includes(anterior.version_huella) || ![1,2].includes(actual.version_huella) || !Array.isArray(anterior.nombres) || !Array.isArray(actual.nombres) ||
            (anterior.nombres.length && actual.nombres.length && anterior.version_huella !== actual.version_huella)) throw new Error('Huellas no comparables o versión no compatible.');
        const nombres = [...new Set([...anterior.nombres,...actual.nombres])].sort();
        const d = {hojas_totales:nombres.length, rango_operacional_desde:desde, hojas_operacionales:0,
            hojas_cambiadas_operacionales:[], hojas_historicas_modificadas:[], hojas_especiales_modificadas:[],
            hojas_sin_cambios:[], hojas_huella_no_disponible:[], hojas_semanticas_procesadas:0, lecturas_semanticas:0, detalle_huellas:[]};
        for (const hoja of nombres) {
            const mes = mesHoja(hoja), operativa = mes && mes >= desde;
            if (operativa) d.hojas_operacionales++;
            const a = anterior.huellas?.[hoja], b = actual.huellas?.[hoja];
            const existeA = anterior.nombres.includes(hoja), existeB = actual.nombres.includes(hoja);
            d.detalle_huellas.push({hoja,...Object.fromEntries(['valores','formulas','rich_text','colores_semanticos','estructura'].map(k => [k,
                a?.componentes?.[k] && b?.componentes?.[k] ? a.componentes[k] !== b.componentes[k] : null]))});
            if ((existeA && !a?.sha256) || (existeB && !b?.sha256)) {
                d.hojas_huella_no_disponible.push(hoja); continue;
            }
            if (existeA && existeB && a.sha256 === b.sha256) { d.hojas_sin_cambios.push(hoja); continue; }
            (operativa ? d.hojas_cambiadas_operacionales : mes ? d.hojas_historicas_modificadas : d.hojas_especiales_modificadas).push(hoja);
        }
        return d;
    }
    const HOJAS_ESPECIALES_VIGILADAS = Object.freeze(['REAGENDAR','REEMBOLSOS']);
    function seleccionarHojas(anterior, actual, fechaReferencia) {
        const nombres = [...new Set([...anterior.nombres,...actual.nombres])].sort();
        const vacio = {version_huella:1,nombres:[],huellas:{}};
        const desde = planificarHojas(vacio,vacio,fechaReferencia).rango_operacional_desde;
        const historicas = nombres.filter(h => mesHoja(h) && mesHoja(h) < desde);
        const seleccionadas = nombres.filter(h => mesHoja(h) ? mesHoja(h) >= desde : HOJAS_ESPECIALES_VIGILADAS.some(s => texto(s) === texto(h)));
        return {seleccionadas, hojas_totales_libro:nombres.length, hojas_revisadas_actualizacion:seleccionadas.length,
            hojas_historicas_omitidas:historicas.length, hojas_desconocidas_omitidas:nombres.filter(h => !mesHoja(h) && !seleccionadas.includes(h))};
    }
    async function compararUltimasVersiones({libro = root.HAIKU_LIBRO_RESERVA_V1,
        fechaReferencia = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())} = {}) {
        const generado_en = new Date().toISOString();
        const error = motivo => ({...salida('no_comparable'), generado_en, advertencias: [{motivo}]});
        if (!libro?.consultarHuellas || !libro?.consultarIndice) return error('El lector no expone índices y huellas de ambas versiones.');
        try {
            await libro.listo();
            const generacion = libro.estado().generacion;
            const comprobar = () => { if (libro.estado().generacion !== generacion) throw new Error('El Libro cambió durante la comparación. Repite la consulta.'); };
            const indiceAnterior = await libro.consultarIndice('anterior'); comprobar();
            if (!indiceAnterior) return {...salida('sin_linea_base'), generado_en};
            const indiceActual = await libro.consultarIndice('actual'); comprobar();
            const alcance = seleccionarHojas(indiceAnterior,indiceActual,fechaReferencia);
            const huellas = async (indice, version) => {
                const nombres = alcance.seleccionadas.filter(h => indice.nombres.includes(h));
                const resultado = nombres.length ? await libro.consultarHuellas(version,nombres) : {version_huella:1,nombres:[],huellas:{}};
                comprobar();
                // El índice gobierna la existencia; un worker incompleto nunca simula una baja.
                return {...resultado,nombres};
            };
            const previo = await huellas(indiceAnterior,'anterior'), siguiente = await huellas(indiceActual,'actual');
            const diagnostico = {...planificarHojas(previo,siguiente,fechaReferencia),...alcance};
            diagnostico.hojas_totales = alcance.hojas_totales_libro;
            diagnostico.hojas_cambiadas = [...diagnostico.hojas_cambiadas_operacionales,...diagnostico.hojas_especiales_modificadas];
            const seleccionadas = diagnostico.hojas_cambiadas_operacionales;
            const leer = async (indice, version) => {
                if (!Array.isArray(indice?.nombres) || !indice.nombres.length) throw new Error('Índice de hojas no disponible.');
                const hojas = [];
                for (const hoja of seleccionadas.filter(h => indice.nombres.includes(h))) {
                    diagnostico.lecturas_semanticas++;
                    try { hojas.push(await libro.consultarHoja(hoja, version, 'semantica')); }
                    catch (e) { hojas.push({hoja, cobertura: {geometria: false}, advertencias: [String(e.message || e)]}); }
                    comprobar(); // Worker y cola existentes; una sola hoja en vuelo.
                }
                return hojas;
            };
            const anterior = await leer(indiceAnterior, 'anterior');
            const actual = await leer(indiceActual, 'actual'); comprobar();
            diagnostico.hojas_semanticas_procesadas = seleccionadas.length;
            const fuera = [...diagnostico.hojas_historicas_modificadas,...diagnostico.hojas_especiales_modificadas,...diagnostico.hojas_huella_no_disponible];
            // Un traslado desde/hacia una hoja excluida no es una alta/baja segura.
            if (fuera.length) anterior.push({hoja:'alcance_operacional',cobertura:{geometria:false},advertencias:fuera});
            const resultado = comparar(anterior,actual);
            for (const hoja of diagnostico.hojas_historicas_modificadas) resultado.advertencias.push({hoja,tipo:'hoja_historica_modificada'});
            for (const hoja of diagnostico.hojas_especiales_modificadas) resultado.advertencias.push({hoja,tipo:'hoja_especial_modificada'});
            for (const hoja of diagnostico.hojas_huella_no_disponible) resultado.advertencias.push({hoja,tipo:'huella_no_disponible'});
            return {...resultado, generado_en, diagnostico};
        } catch (e) { return error(String(e.message || e)); }
    }
    const api = Object.freeze({comparar, compararUltimasVersiones, validarSegmento, planificarHojas, seleccionarHojas, mesHoja, HOJAS_ESPECIALES_VIGILADAS});
    root.HAIKU_LIBRO_DIFERENCIAS_V1 = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
