const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fuente = fs.readFileSync(require.resolve('../js/supabase-data.js'), 'utf8');

function bloque(inicio, fin, contexto) {
    const desde = fuente.indexOf(inicio);
    const hasta = fuente.indexOf(fin, desde);
    assert.ok(desde >= 0 && hasta > desde, `No se encontró ${inicio}`);
    vm.runInContext(fuente.slice(desde, hasta), contexto);
}

test('el artículo conserva los UUID exactos de la reserva visible y de entrada/salida', () => {
    const titular = { textContent: '' };
    const estado = { value: '' };
    const articulo = {
        dataset: {},
        querySelector(selector) {
            if (selector.startsWith('[data-titular-cabana=')) return titular;
            if (selector === '[data-campo="estado"]') return estado;
            return null;
        }
    };
    const contexto = vm.createContext({
        document: { querySelector: () => articulo },
        obtenerTitularPrincipal: fila => fila.ingreso_titular || 'Sin titular'
    });
    bloque('    function pintarEstadoOperacion', '    function pintarFilaOperacion', contexto);

    contexto.pintarEstadoOperacion({
        numero: 2,
        estado_operativo: 'sale-ingresa',
        ingreso_reserva_id: 'reserva-entrante',
        salida_reserva_id: 'reserva-saliente',
        salida_titular: 'Huésped saliente',
        ingreso_titular: 'Huésped nuevo'
    }, '2026-09-23');
    assert.equal(articulo.dataset.resumenFecha, '2026-09-23');
    assert.equal(articulo.dataset.resumenReservaId, 'reserva-entrante');
    assert.equal(articulo.dataset.ingresoReservaId, 'reserva-entrante');
    assert.equal(articulo.dataset.salidaReservaId, 'reserva-saliente');
    assert.equal(articulo.dataset.resumenSalidaTitular, 'Huésped saliente');
    assert.equal(articulo.dataset.resumenTitularReservaId, 'reserva-entrante');
    assert.equal(articulo.dataset.resumenTitular, 'Huésped nuevo');

    contexto.pintarEstadoOperacion({ numero: 2, estado_operativo: 'libre-libre' }, '2026-09-24');
    assert.equal(articulo.dataset.resumenFecha, '2026-09-24');
    assert.equal(articulo.dataset.resumenReservaId, '');
    assert.equal(articulo.dataset.ingresoReservaId, '');
    assert.equal(articulo.dataset.salidaReservaId, '');
    assert.equal(articulo.dataset.resumenSalidaTitular, '');
    assert.equal(articulo.dataset.resumenTitularReservaId, '');
    assert.equal(articulo.dataset.resumenTitular, '');
});

test('una respuesta RPC sin filas limpia enlaces previos y anuncia el repintado', async () => {
    const articulo = {
        dataset: {
            resumenFecha: '2026-09-22',
            resumenReservaId: 'anterior',
            ingresoReservaId: 'anterior',
            salidaReservaId: 'anterior',
            resumenSalidaTitular: 'Huésped anterior',
            resumenTitularReservaId: 'anterior',
            resumenTitular: 'Huésped anterior',
            resumenEstadiaId: 'estadia-anterior'
        }
    };
    const eventos = [];
    const contexto = vm.createContext({
        cargandoDia: false,
        ultimoDiaCargado: '',
        window: { haikuSesion: {} },
        cliente: { rpc: async () => ({ data: [], error: null }) },
        normalizarFecha: fecha => fecha,
        document: {
            querySelectorAll: () => [articulo],
            getElementById: () => null,
            dispatchEvent: evento => eventos.push(evento)
        },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        cargarDetallesEstadias: async () => new Map(),
        pintarEstadoOperacion() {},
        pintarFilaOperacion() {},
        cargarContadoresRelacionados: async () => {},
        console: { info() {}, error() {} }
    });
    bloque('    async function cargarOperacionDia', '    function limpiarCacheLegacyUnaVez', contexto);

    await contexto.cargarOperacionDia('2026-09-23');
    assert.deepEqual({ ...articulo.dataset }, {
        resumenFecha: '',
        resumenReservaId: '',
        ingresoReservaId: '',
        salidaReservaId: '',
        resumenSalidaTitular: '',
        resumenTitularReservaId: '',
        resumenTitular: '',
        resumenEstadiaId: ''
    });
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].type, 'haiku:resumen-datos-actualizados');
    assert.equal(eventos[0].detail.fecha, '2026-09-23');
});
