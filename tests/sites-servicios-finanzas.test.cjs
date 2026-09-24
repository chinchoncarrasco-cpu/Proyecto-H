const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fuente = fs.readFileSync(path.join(__dirname, '../js/supabase-servicios-finanzas-v2.js'), 'utf8');

function entorno(filas, cargos, aplicaciones = [], pagos = [], estados = []) {
    const lista = filas.map(f => ({ id: f.id, estadoServicioDb: f.estado_servicio,
        tipoCobro: f.tipo_cobro, total: f.total, estadoPago: 'pendiente' }));
    const eventos = [];
    const mapa = Object.fromEntries(filas.map(f => [f.id, f.id]));
    const almacen = new Map([['haikuSupabaseServicioMapV1', JSON.stringify(mapa)]]);
    const resultados = { servicios: filas, cargos, pago_aplicaciones: aplicaciones, pagos,
        vista_estado_cargos: estados };
    const cliente = { from(tabla) {
        const q = { select() { return this; }, in() { return this; }, eq() { return this; },
            then(resolve, reject) { return Promise.resolve({ data: resultados[tabla], error: null }).then(resolve, reject); } };
        return q;
    } };
    const ventana = { haikuSupabase: cliente, addEventListener() {}, renderizarAgendaServicios() {} };
    const documento = { getElementById: () => ({}), addEventListener() {},
        dispatchEvent: evento => eventos.push(evento.type) };
    vm.runInNewContext(fuente, {
        window: ventana, document: documento, serviciosRegistrados: lista,
        localStorage: { getItem: k => almacen.get(k) || null, setItem: (k, v) => almacen.set(k, v) },
        setTimeout() {}, clearTimeout() {}, console,
        CustomEvent: class { constructor(type) { this.type = type; } }
    }, { filename: 'supabase-servicios-finanzas-v2.js' });
    return { lista, eventos, sincronizar: ventana.haikuSincronizarFinanzasServicios };
}

test('saldo procede de vista_estado_cargos para el cargo activo', async () => {
    const h = entorno([{ id: 's1', estado_servicio: 'programado', tipo_cobro: 'normal', total: 30000 }],
        [{ id: 'c1', servicio_id: 's1', monto: 30000, estado: 'activo' }],
        [{ cargo_id: 'c1', pago_id: 'p1', monto_aplicado: 18000 },
            { cargo_id: 'c1', pago_id: 'p2', monto_aplicado: 5000 }],
        [{ id: 'p1', estado: 'confirmado' }, { id: 'p2', estado: 'pendiente' }],
        [{ cargo_id: 'c1', monto_ajustado: 30000, saldo_cargo: 12000 }]);
    await h.sincronizar();
    assert.equal(h.lista[0].saldoPendienteVerificado, 12000);
    assert.equal(h.lista[0].estadoPago, 'pendiente');
    assert.deepEqual(h.eventos, ['haiku:servicios-finanzas-actualizadas']);
});

test('pagado, cortesía y cancelado no suman pendiente; anomalías quedan por verificar', async () => {
    const filas = [
        { id: 'pagado', estado_servicio: 'realizado', tipo_cobro: 'normal', total: 30000 },
        { id: 'cortesia', estado_servicio: 'programado', tipo_cobro: 'cortesia', total: 0 },
        { id: 'cancelado', estado_servicio: 'cancelado', tipo_cobro: 'normal', total: 30000 },
        { id: 'sin-cargo', estado_servicio: 'programado', tipo_cobro: 'normal', total: 30000 }
    ];
    const h = entorno(filas,
        [{ id: 'c1', servicio_id: 'pagado', monto: 30000, estado: 'activo' }],
        [{ cargo_id: 'c1', pago_id: 'p1', monto_aplicado: 30000 }],
        [{ id: 'p1', estado: 'confirmado' }],
        [{ cargo_id: 'c1', monto_ajustado: 30000, saldo_cargo: 0 }]);
    await h.sincronizar();
    const porId = Object.fromEntries(h.lista.map(s => [s.id, s]));
    assert.equal(porId.pagado.saldoPendienteVerificado, 0);
    assert.equal(porId.cortesia.saldoPendienteVerificado, 0);
    assert.equal(porId.cancelado.saldoPendienteVerificado, 0);
    assert.equal(porId['sin-cargo'].saldoPendienteVerificado, null);
});
