const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function cargarModulo(datosLibro = { reservas: [] }) {
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
    const context = { window, document, MutationObserver, structuredClone, console, Date: FechaPrueba, Math };
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-pagos-focalizados-v1.js'), 'utf8'), context);
    return {
        api: window.HAIKU_LIBRO_PAGOS_FOCALIZADOS_V1,
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

test('the exact Macarena request excludes other holders and payments from other dates', async () => {
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
    assert.deepEqual(resultado.reservas.find(r => r.cabana === 5).pagos.map(p => p.monto), [160000]);
    assert.equal(resultado.reservas.find(r => r.cabana === 10).pagos.length, 0);
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
