const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function funciones(ruta, inicio, fin, exportacion, extras = {}) {
    const source = fs.readFileSync(require.resolve(ruta), 'utf8');
    const desde = source.indexOf(inicio);
    const hasta = source.indexOf(fin, desde);
    assert.ok(desde >= 0 && hasta > desde, `No se encontró el bloque ${inicio}`);
    const context = vm.createContext({...extras});
    vm.runInContext(`${source.slice(desde, hasta)};globalThis.api={${exportacion}};`, context);
    return context.api;
}

test('SALE / LIBRE no usa la estadía ni el titular saliente como contenido actual', () => {
    const data = funciones(
        '../js/supabase-data.js',
        '    function obtenerEstadiaPrincipal',
        '    async function cargarDetallesEstadias',
        'obtenerEstadiaPrincipal,obtenerTitularPrincipal'
    );
    const fila = {
        estado_operativo: 'sale-libre',
        salida_estadia_id: 'E1',
        salida_titular: 'Huésped saliente'
    };
    assert.equal(data.obtenerEstadiaPrincipal(fila, new Map([['E1', {id:'E1'}]])), null);
    assert.equal(data.obtenerTitularPrincipal(fila), 'Sin titular');

    const final = funciones(
        '../js/supabase-autoridad-visual-final-v1.js',
        '    function esSaleBloq',
        '    function asegurarOpcionSaleBloq',
        'titularPrincipal'
    );
    assert.equal(final.titularPrincipal(fila), 'Sin titular');
});

test('SALE / LIBRE conserva color Libre aunque exista una hora de checkout', () => {
    const clases = new Set(['cabana-checkout']);
    const fila = {
        classList: {
            add: clase => clases.add(clase),
            remove: (...valores) => valores.forEach(valor => clases.delete(valor))
        }
    };
    const checkout = funciones(
        '../js/supabase-checkout-resumen-v1.js',
        '    function aplicarColorFila',
        '    function aplicarColoresResumen',
        'aplicarColorFila',
        {
            datosCabanaDia: () => ({estado:'sale-libre', checkout:'10:03'}),
            fechaActualResumen: () => '2026-09-17',
            document: {querySelector: () => fila},
            CSS: {escape: valor => valor},
            window: {}
        }
    );
    assert.equal(checkout.aplicarColorFila('11'), true);
    assert.deepEqual([...clases], ['cabana-libre']);
});

test('la ficha del día actual no enlaza la reserva que ya salió', () => {
    const ficha = funciones(
        '../js/supabase-ficha-v2.js',
        '    function reservaIdDeFila',
        '    async function resolverReserva',
        'reservaIdDeFila'
    );
    assert.equal(ficha.reservaIdDeFila({
        estado_operativo:'sale-libre',
        salida_reserva_id:'R1'
    }), '');
});

test('la fila libre oculta noches y ocupación sin una reserva actual', () => {
    const cabanas = fs.readFileSync(require.resolve('../js/cabanas.js'), 'utf8');
    const data = fs.readFileSync(require.resolve('../js/supabase-data.js'), 'utf8');
    assert.match(cabanas, /contenedorNoches\.hidden\s*=\s*!String\(datosCabana\.noches/);
    assert.match(cabanas, /sinReservaActual[\s\S]*?texto\.hidden\s*=\s*sinReservaActual/);
    assert.match(data, /contenedorNoches\.hidden\s*=\s*!estadia/);
    assert.match(data, /actualizarTextoOcupacionResumen\(ocupacion/);
});
