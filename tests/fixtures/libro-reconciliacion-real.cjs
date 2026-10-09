const fs = require('node:fs'), path = require('node:path');
const F = require('./libro-reconciliacion-oct26-real.json');
const copy = x => JSON.parse(JSON.stringify(x));
const esperados = ['CONFLICTO', 'EXISTENTE_SEGURO', 'SIN_EXISTENTE', 'EXISTENTE_SEGURO', 'CONFLICTO',
    'CONFLICTO', 'EXISTENTE_SEGURO', 'EXISTENTE_SEGURO', 'EXISTENTE_SEGURO', 'SIN_EXISTENTE',
    'CONFLICTO', 'EXISTENTE_SEGURO', 'CANDIDATO_EXISTENTE', 'EXISTENTE_SEGURO', 'CONFLICTO',
    'CONFLICTO', 'SIN_EXISTENTE', 'SIN_EXISTENTE', 'CONFLICTO', 'SIN_EXISTENTE', 'CONFLICTO'];
// SELECT local del derivado anonimizado del snapshot auditado. Sin red ni datos vivos.
function instalar(normalizada, dbOriginal, origen) {
    const db = structuredClone(dbOriginal), w = globalThis;
    const state = w.reconciliacionFixture = { db, normalizada, lecturas: [], escrituras: [], rpcs: [], usuario: '00000000-0000-4000-8000-000000000099', generacion: 1 };
    w.HAIKU_LIBRO_RESERVA_V1 = { listo: async () => {}, estado: () => ({ cargado: true, nombre: origen.archivo, version: origen.sha256_fixture, generacion: state.generacion }),
        listarHojas: () => ['Oct26'], consultarHoja: async () => structuredClone(state.normalizada) };
    w.haikuSupabase = { auth: { getUser: async () => ({ data: { user: { id: state.usuario } } }) }, from: tabla => {
        const filtros = [], q = { select: s => (state.lecturas.push({ tabla, select: s }), q),
            in: (k, v) => (filtros.push(x => v.includes(x[k])), q), eq: (k, v) => (filtros.push(x => x[k] === v), q),
            lte: (k, v) => (filtros.push(x => x[k] <= v), q), gte: (k, v) => (filtros.push(x => x[k] >= v), q),
            then: (ok, no) => {
                if (state.errorTabla === tabla) return Promise.resolve({ data: null, error: new Error('SELECT falló') }).then(ok, no);
                let rows = structuredClone((db[tabla] || []).filter(x => filtros.every(f => f(x))));
                if (tabla === 'servicios') rows = rows.map(s => ({ ...s, catalogo_servicios: {
                    ...db.catalogo_servicios.find(c => c.codigo === s.catalogo_servicios?.codigo), ...s.catalogo_servicios } }));
                return Promise.resolve({ data: rows, error: null }).then(ok, no);
            } }; return q;
    }, rpc: async (nombre, args) => {
        state.rpcs.push(nombre);
        if (nombre === 'haiku_libro_servicio_manual_capacidad_v1') return { data: { version: 1, auditoria: true } };
        if (!state.permitirWriterLocal || nombre !== 'haiku_importar_libro_operaciones_v2') throw Error('Escritura prohibida: sólo snapshot local');
        // Simulación para la UI. La idempotencia SQL real se prueba por separado en PGlite.
        state.escrituras.push(structuredClone(args));
        const servicios = args.p_servicios.map(p => {
            const c = db.catalogo_servicios.find(c => c.codigo === p.codigo_servicio);
            const existe = db.servicios.find(s => s.reserva_id === p.reserva_id && s.estadia_id === p.estadia_id &&
                s.catalogo_servicios.codigo === p.codigo_servicio && s.fecha_servicio === p.fecha_servicio && s.hora_inicio.slice(0, 5) === p.hora);
            if (existe) return { item_id: p.item_id, estado: 'existente' };
            const inicio = Number(p.hora.slice(0, 2)) * 60 + Number(p.hora.slice(3)), duracion = c.duracion_minutos || p.cantidad * 60;
            const fin = `${String(Math.floor((inicio + duracion) / 60)).padStart(2, '0')}:${String((inicio + duracion) % 60).padStart(2, '0')}:00`;
            db.servicios.push({ id: `local-${p.item_id}`, reserva_id: p.reserva_id, estadia_id: p.estadia_id, fecha_servicio: p.fecha_servicio,
                hora_inicio: p.hora + ':00', hora_fin: fin, cantidad: p.cantidad, personas: p.personas, tipo_cobro: p.tipo_cobro,
                total: p.tipo_cobro === 'cortesia' ? 0 : c.precio_base * p.cantidad, estado_servicio: 'programado',
                observaciones: `[HAKU-LIBRO-SERVICIO:${p.item_id}]`, catalogo_servicios: { codigo: c.codigo, nombre: c.nombre } });
            return { item_id: p.item_id, estado: 'creado' };
        });
        return { data: { ok: true, servicios_creados: servicios.filter(s => s.estado === 'creado').length, servicios, notas: [], notas_creadas: 0 } };
    } };
    w.confirm = () => true;
}
function entornoReal() {
    const vm = require('node:vm'), { entorno } = require('./libro-servicio-manual.cjs'), e = entorno();
    const normalizada = e.c.HAIKU_LIBRO_SEMANTICA.normalizarHoja(copy(F.hoja), 'Oct26');
    e.c.structuredClone = structuredClone;
    e.c.fixtureNormalizada = normalizada; e.c.fixtureDb = copy(F.db); e.c.fixtureOrigen = F.origen;
    vm.runInContext(`(${instalar.toString()})(fixtureNormalizada, fixtureDb, fixtureOrigen)`, e.c);
    e.state = e.c.reconciliacionFixture; e.vinculos = new Map();
    e.construir = () => e.api.construir('Libro: compara servicios de octubre 2026 con Proyecto H', new Map(), e.manuales, e.vinculos);
    e.vincular = async item => e.api.confirmarVinculoExistente('Libro: compara servicios de octubre 2026 con Proyecto H',
        item.item_id, item.reconciliacion.candidato.id, item.firmaVinculo, e.vinculos, new Map(), e.manuales);
    return e;
}
module.exports = { F, esperados, instalar, entornoReal, copy };
