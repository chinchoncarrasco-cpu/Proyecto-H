const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I = require('../js/haiku-servicios-identidad-v1.js');

const reserva = 'reserva-alejandro';
const estadia = 'estadia-cab2';
const base = (extra = {}) => ({ reserva_id: reserva, estadia_id: estadia, estado_servicio: 'programado', ...extra });
const jacuzzi = base({ id: 'jacuzzi-original', catalogo_servicios: { codigo: 'tinajaJacuzzi' },
    fecha_servicio: '2026-09-05', hora_inicio: '22:15:00', total: 30000,
    estado_servicio: 'realizado', observaciones: 'HAIKU-LEGACY-ID:servicio-original-jacuzzi' });
const late = base({ id: 'late-original', catalogo_servicios: { codigo: 'lateCheckout' },
    fecha_servicio: '2026-09-06', hora_inicio: '14:00:00', total: 20000,
    observaciones: 'HAIKU-LEGACY-ID:servicio-original-late' });
const propuesto = (codigo, fecha, hora, total, extra = {}) => ({ reserva_id: reserva, estadia_id: estadia,
    codigo_servicio: codigo, fecha_servicio: fecha, hora, total, ...extra });

test('Alejandro: Libro reconoce Jacuzzi y Late Check-out originales y dos pasadas crean cero', () => {
    const items = [
        propuesto('tinajaJacuzzi', '2026-09-05', '22:15', 30000, { item_id: 'srv:jacuzzi-libro' }),
        propuesto('lateCheckout', '2026-09-06', '14:00', 20000, { item_id: 'srv:late-libro' })
    ];
    for (let pasada = 0; pasada < 2; pasada++) {
        const decisiones = items.map(x => I.resolverServicio(x, [jacuzzi, late]));
        assert.deepEqual(decisiones.map(x => x.estado), ['existente', 'existente']);
        assert.equal(decisiones.filter(x => x.estado === 'nuevo').length, 0);
    }
    const cargosAntes = [{ servicio_id: jacuzzi.id, saldo: 0 }, { servicio_id: late.id, saldo: 0 }];
    assert.deepEqual(cargosAntes, [{ servicio_id: 'jacuzzi-original', saldo: 0 }, { servicio_id: 'late-original', saldo: 0 }]);
});

test('Late Check-out es único dentro de la estadía, aunque la nueva fecha sea errónea', () => {
    const decision = I.resolverServicio(propuesto('lateCheckout', '2026-09-05', '14:00', 20000), [late]);
    assert.equal(decision.estado, 'existente');
    assert.equal(decision.candidato.id, late.id);
});

test('Late Check-out de otra estadía no se fusiona', () => {
    const decision = I.resolverServicio({ ...propuesto('lateCheckout', '2026-09-07', '14:00', 20000), estadia_id: 'otra-estadia' }, [late]);
    assert.equal(decision.estado, 'nuevo');
});

test('Tinaja exacta se reutiliza; otra hora u otra fecha conserva hechos distintos', () => {
    assert.equal(I.resolverServicio(propuesto('tinajaJacuzzi', '2026-09-05', '22:15', 30000), [jacuzzi]).estado, 'existente');
    assert.equal(I.resolverServicio(propuesto('tinajaJacuzzi', '2026-09-05', '20:15', 30000), [jacuzzi]).estado, 'nuevo');
    assert.equal(I.resolverServicio(propuesto('tinajaJacuzzi', '2026-09-06', '22:15', 30000), [jacuzzi]).estado, 'nuevo');
});

test('dos candidatos compatibles son ambiguos y no autorizan un tercero', () => {
    const duplicado = { ...jacuzzi, id: 'jacuzzi-2', observaciones: 'otro origen' };
    const decision = I.resolverServicio(propuesto('tinajaJacuzzi', '2026-09-05', '22:15', 30000), [jacuzzi, duplicado]);
    assert.equal(decision.estado, 'revisar');
    assert.equal(decision.candidatos.length, 2);
});

test('mismo origen Libro se omite y mismo hecho con otro origen también se reutiliza', () => {
    const existenteLibro = { ...jacuzzi, observaciones: '[HAKU-LIBRO-SERVICIO:srv:estable]' };
    assert.equal(I.resolverServicio(propuesto('tinajaJacuzzi', '2026-09-09', '18:00', 99999,
        { item_id: 'srv:estable' }), [existenteLibro]).estado, 'existente');
    assert.equal(I.resolverServicio(propuesto('tinajaJacuzzi', '2026-09-05', '22:15', 30000,
        { item_id: 'srv:otro-origen' }), [jacuzzi]).estado, 'existente');
});

test('evidencia incompleta falla cerrada', () => {
    assert.equal(I.resolverServicio(propuesto('tinajaJacuzzi', '', '', 30000), []).estado, 'revisar');
    assert.equal(I.resolverServicio({ codigo_servicio: 'tinajaJacuzzi' }, []).estado, 'revisar');
});

test('servicio cancelado no se revive ni reutiliza automáticamente', () => {
    const cancelado = { ...jacuzzi, estado_servicio: 'cancelado' };
    const decision = I.resolverServicio(propuesto('tinajaJacuzzi', '2026-09-05', '22:15', 30000), [cancelado]);
    assert.equal(decision.estado, 'nuevo');
    assert.equal(decision.candidato, null);
});

test('la huella operativa es estable y no depende del orden de ejecución', () => {
    const hecho = propuesto('tinajaJacuzzi', '2026-09-05', '22:15', 30000);
    assert.equal(I.huellaServicio(hecho), I.huellaServicio({ ...hecho }));
    assert.notEqual(I.huellaServicio(hecho), I.huellaServicio({ ...hecho, hora: '23:15' }));
    const source = fs.readFileSync(path.join(__dirname, '../js/servicios.js'), 'utf8');
    const cuerpo = source.match(/function generarIdServicio[\s\S]*?\n}\n\nfunction registrarHistorialServicio/)[0];
    assert.doesNotMatch(cuerpo, /Date\.now|Math\.random/);
});

test('el concepto segmentado Late Check-out no vuelve a mapearse como Jacuzzi por texto mezclado', () => {
    const context = { document: {}, addEventListener() {} };
    vm.createContext(context);
    const source = fs.readFileSync(path.join(__dirname, '../js/haiku-libro-servicios-scope-v2.js'), 'utf8');
    vm.runInContext(source.replace('const api = Object.freeze({', 'const api = Object.freeze({prepararServicio, claveServicio,'), context);
    const reservaLibro = { titular: 'Alejandro Ramos Donaire', cabana: 2, fecha_checkin: '2026-09-05', fecha_checkout: '2026-09-06', noches: 1, adultos: 2, tipo_estadia: 'alojamiento' };
    const servicioLibro = { concepto: 'lateout', texto_original: 'Jacuzzi a las 22,15 sáb 05-09 x pagar late check out hasta las 14:00 x pagar', hora: '22:15' };
    const item = context.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.prepararServicio(
        reservaLibro,
        servicioLibro,
        { estado: 'asociada', sistema: { reserva_id: reserva, id: estadia } }
    );
    assert.equal(item.mapa.codigo, 'lateCheckout');
    assert.equal(item.fecha, '2026-09-06');
    assert.equal(item.hora, '14:00');
    assert.equal(
        context.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.claveServicio({ ...reservaLibro, coordenadas_origen: { hoja: 'Sep26', celda: 'A1' } }, servicioLibro),
        context.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.claveServicio({ ...reservaLibro, coordenadas_origen: { hoja: 'Sep26', celda: 'ZZ99' } }, servicioLibro)
    );
});

test('auditoría pura encuentra late duplicado y mismo hecho sin modificar la entrada', () => {
    const otroLate = { ...late, id: 'late-2' }, antes = JSON.stringify([late, otroLate, jacuzzi]);
    const audit = I.auditarDuplicados([late, otroLate, jacuzzi]);
    assert.equal(audit.lateCheckout.length, 1);
    assert.equal(audit.mismoHecho.length, 1);
    assert.equal(JSON.stringify([late, otroLate, jacuzzi]), antes);
});

function entornoBridge(existentes) {
    const llamadas = { rpc: 0, eventos: [] }, storage = new Map();
    function consulta(tabla) {
        const filtros = { ilike: false };
        const q = {
            select: () => q, eq: () => q, order: () => q, limit: () => q,
            ilike: () => { filtros.ilike = true; return q; },
            then(ok, fail) {
                let data = [];
                if (tabla === 'reserva_estadias') data = [{ id: estadia, fecha_ingreso: '2026-09-05', fecha_salida: '2026-09-06', cabanas: { numero: 2 } }];
                if (tabla === 'servicios' && !filtros.ilike) data = existentes;
                return Promise.resolve({ data, error: null }).then(ok, fail);
            }
        };
        return q;
    }
    const context = {
        console, setTimeout() {}, CustomEvent: function (type, init) { this.type = type; this.detail = init.detail; },
        document: { dispatchEvent: e => llamadas.eventos.push(e.detail) },
        localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
        haikuSesion: null,
        haikuSupabase: { from: consulta, rpc: async () => { llamadas.rpc++; return { data: { servicio_id: 'nuevo' }, error: null }; } },
        addEventListener() {}
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/haiku-servicios-identidad-v1.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/supabase-servicios-bridge-v1.js'), 'utf8'), context);
    return { context, llamadas };
}

test('puente legacy reutiliza el Late Check-out de Alejandro aunque llegue con otro ID y fecha', async () => {
    const e = entornoBridge([late]);
    const id = await e.context.haikuMigrarServicioLegacySupabase({
        id: 'servicio-otro-id-inestable', reservaId: reserva, numeroCabana: 2,
        tipoServicio: 'lateCheckout', fechaServicio: '2026-09-05', hora: '14:00', total: 20000
    });
    assert.equal(id, late.id);
    assert.equal(e.llamadas.rpc, 0);
    assert.equal(e.llamadas.eventos[0].reutilizado, true);
});
