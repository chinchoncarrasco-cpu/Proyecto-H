const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function cargarModulo(datosLibro = { reservas: [] }, capas = false) {
    const listeners = new Map();
    const campo = { value: '' };
    class FechaPrueba extends Date {
        constructor(...args) { super(...(args.length ? args : ['2026-09-09T12:00:00Z'])); }
        static now() { return Date.parse('2026-09-09T12:00:00Z'); }
    }
    const document = {
        documentElement: {},
        head: { appendChild() {} },
        getElementById(id) { return id === 'haiku-asistente-texto' ? campo : null; },
        createElement() { return { className: '', id: '', innerHTML: '', style: {}, dataset: {} }; },
        addEventListener() {}
    };
    class MutationObserver { observe() {} }
    const libro = {
        version: 'test',
        consultarHoja: async () => structuredClone(datosLibro)
    };
    const window = {
        document,
        HAIKU_LIBRO_RESERVA_V1: libro,
        addEventListener(tipo, handler) {
            if (!listeners.has(tipo)) listeners.set(tipo, []);
            listeners.get(tipo).push(handler);
        }
    };
    const context = {
        window, document, MutationObserver, structuredClone, console, Date: FechaPrueba, Math,
        setInterval: () => 1, clearInterval() {}, Event: class Event {}
    };
    if (capas) {
        window.HAIKU_LIBRO_SEMANTICA = require('../js/haiku-libro-semantica-v1.js');
        for (const nombre of ['haiku-libro-pagos-canon-v1', 'haiku-libro-lenguaje-natural-v1']) {
            vm.runInNewContext(fs.readFileSync(require.resolve('../js/' + nombre + '.js'), 'utf8'), context);
        }
    }
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-pagos-focalizados-v1.js'), 'utf8'), context);
    return {
        api: window.HAIKU_LIBRO_PAGOS_FOCALIZADOS_V1,
        textoEnrutado: () => campo.value,
        consultarHoja: (...args) => window.HAIKU_LIBRO_RESERVA_V1.consultarHoja(...args),
        disparar(texto) {
            campo.value = texto;
            for (const handler of listeners.get('click') || []) {
                handler({ type: 'click', target: { closest: selector => selector === '#haiku-asistente-enviar' ? {} : null } });
            }
        }
    };
}

test('one holder and one written date activate the focused payment scope without a CAB', () => {
    const h = cargarModulo();
    const scope = h.api.detectar('haku revisa el Libro los pagos asociados a Macarena Hurtado el Jueves 03 de septiembre para agregarlos al proyecto H');
    assert.ok(scope);
    assert.equal(scope.fecha, '2026-09-03');
    assert.equal(scope.objetivos.length, 1);
    assert.equal(scope.objetivos[0].nombre, 'Macarena Hurtado');
    assert.equal(scope.objetivos[0].cabana, null);
});

test('the exact Macarena request excludes other holders but preserves every related multi-stay movement', async () => {
    const h = cargarModulo({ reservas: [
        { titular: 'Macarena Hurtado', cabana: 5, pagos: [
            { monto: 160000, fecha_comprobante: '2026-09-03' },
            { monto: 20000, fecha_comprobante: '2026-09-04' }
        ], pagos_sin_asociacion: [], servicios: [{ tipo: 'early_checkin' }] },
        { titular: 'Macarena Hurtado', cabana: 10, pagos: [
            { monto: 20000, fecha_comprobante: '2026-09-04' }
        ], pagos_sin_asociacion: [], servicios: [] },
        { titular: 'Pascual Abarca', cabana: 4, pagos: [
            { monto: 160000, fecha_comprobante: '2026-09-03' }
        ], pagos_sin_asociacion: [] }
    ] });
    h.disparar('haku revisa el Libro los pagos asociados a Macarena Hurtado el Jueves 03 de septiembre para agregarlos al proyecto H');
    const resultado = await h.consultarHoja('Sep26');
    assert.equal(resultado.reservas.length, 2);
    assert.ok(resultado.reservas.every(r => r.titular === 'Macarena Hurtado'));
    assert.deepEqual(resultado.reservas.find(r => r.cabana === 5).pagos.map(p => p.monto), [160000, 20000]);
    assert.deepEqual(resultado.reservas.find(r => r.cabana === 10).pagos.map(p => p.monto), [20000]);
    assert.ok(resultado.reservas.every(r => r.servicios.length === 0));
});

test('the existing multi-CAB focused syntax remains supported', () => {
    const h = cargarModulo();
    const scope = h.api.detectar('Haku revisa los pagos del Libro\nCAB 4 Pascual Abarca\nCAB 10 Macarena Hurtado\nJueves 03 de septiembre');
    assert.ok(scope);
    assert.equal(scope.fecha, '2026-09-03');
    assert.deepEqual(Array.from(scope.objetivos, x => [x.cabana, x.nombre]), [
        [4, 'Pascual Abarca'],
        [10, 'Macarena Hurtado']
    ]);
});

test('exact request without Libro routes through all payment layers and retains both September stays', async () => {
    const S = require('../js/haiku-libro-semantica-v1.js');
    const raw = require('./fixtures/libro-pagos-sep26.cjs')();
    const h = cargarModulo(S.normalizarHoja(raw, 'Sep26'), true);
    const texto = 'Haku revisa los pagos de Macarena Hurtado del 03 de septiembre para agregarlos a Proyecto H';
    h.disparar(texto);
    assert.equal(h.textoEnrutado(), 'Libro: ' + texto);
    const out = await h.consultarHoja('Sep26');
    assert.equal(out.reservas.length, 2);
    const cinco = out.reservas.find(r => r.cabana === 5);
    assert.deepEqual(Array.from(cinco.pagos_sin_asociacion, p => p.monto), [153000, 40000]);
    assert.equal(cinco.pagos.length, 0);
    assert.equal(cinco.pagos_sin_asociacion[1].tipo_movimiento, 'servicio');
    assert.deepEqual(Array.from(out.reservas.find(r => r.cabana === 10).pagos, p => p.monto), [100000, 20000]);
});
