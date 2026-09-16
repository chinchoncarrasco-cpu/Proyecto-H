const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const D = require('../js/haiku-libro-pagos-destinos-v1.js');

const servicio = (id, reserva_id, nombre, fecha, total, extra = {}) => ({
    id, reserva_id, fecha_servicio: fecha, total, tipo_cobro: 'normal', estado_servicio: 'programado',
    catalogo_servicios: { codigo: nombre, nombre, categoria: 'servicio' }, ...extra
});
const cargo = (cargo_id, reserva_id, servicio_id, concepto, saldo, extra = {}) => ({
    cargo_id, reserva_id, servicio_id, tipo_cargo: 'servicio', concepto, monto: saldo,
    monto_ajustado: saldo, aplicado_neto: 0, saldo_cargo: saldo, estado: 'activo', estado_pago: 'pendiente', ...extra
});
const snapshot = (servicios, cargos, aplicaciones = [], pagos = []) => ({ disponible: true, servicios, cargos, aplicaciones, pagos });
const pagoServicio = (concepto, monto, fecha = '2026-09-12', extra = {}) => ({
    tipo_movimiento: 'servicio', concepto, monto, fecha_bloque: fecha, moneda: 'CLP', ...extra
});

test('Carlos: Tinaja de 30000 encuentra un único cargo pendiente', () => {
    const s = servicio('s1', 'r-carlos', 'Tinaja Tonel', '2026-09-12', 30000);
    const out = D.resolverTransaccion(pagoServicio('tinaja', 30000), 'r-carlos', snapshot([s], [cargo('c1', 'r-carlos', 's1', 'Tinaja Tonel', 30000)]));
    assert.equal(out.estado, 'destino_unico');
    assert.deepEqual(out.aplicaciones_payload, [{ cargo_id: 'c1', monto: 30000 }]);
});

test('Yenny: sin cargo pendiente compatible queda bloqueada sin destino', () => {
    const out = D.resolverTransaccion(pagoServicio('tinaja', 30000, '2026-09-05'), 'r-yenny', snapshot([], []));
    assert.equal(out.aplicaciones[0].estado, 'sin_destino');
    assert.equal(out.resoluble, false);
});

test('un único cargo compatible ya pagado no vuelve a usarse', () => {
    const s = servicio('s1', 'r-yenny', 'Tinaja Tonel', '2026-09-05', 30000);
    const c = cargo('c1', 'r-yenny', 's1', 'Tinaja Tonel', 0, { monto: 30000, monto_ajustado: 30000, aplicado_neto: 30000, estado_pago: 'pagado' });
    const out = D.resolverTransaccion(pagoServicio('tinaja', 30000, '2026-09-05'), 'r-yenny', snapshot([s], [c]));
    assert.equal(out.estado, 'ya_aplicada');
    assert.equal(out.resoluble, false);
});

test('Constanza: servicio de cortesía sin cargo no inventa destino', () => {
    const s = servicio('s1', 'r-constanza', 'Tinaja Jacuzzi', '2026-09-04', 0, { tipo_cobro: 'cortesia' });
    const out = D.resolverTransaccion(pagoServicio('tinaja', 30000, '2026-09-04'), 'r-constanza', snapshot([s], []));
    assert.equal(out.aplicaciones[0].estado, 'sin_destino');
});

test('Pascual: Late Out selecciona el cargo pendiente de la fecha exacta', () => {
    const servicios = [
        servicio('s1', 'r-pascual', 'Late Check-out', '2026-09-04', 20000),
        servicio('s2', 'r-pascual', 'Late Check-out', '2026-09-06', 20000)
    ];
    const cargos = [
        cargo('c1', 'r-pascual', 's1', 'Late Check-out', 20000),
        cargo('c2', 'r-pascual', 's2', 'Late Check-out', 0, { monto: 20000, monto_ajustado: 20000, aplicado_neto: 20000 })
    ];
    const out = D.resolverTransaccion(pagoServicio('lateout', 20000, '2026-09-04'), 'r-pascual', snapshot(servicios, cargos));
    assert.deepEqual(out.aplicaciones_payload, [{ cargo_id: 'c1', monto: 20000 }]);
});

test('Alejandro: comprobante distribuido conserva dos destinos distintos', () => {
    const servicios = [
        servicio('s1', 'r-alejandro', 'Late Check-out', '2026-09-06', 20000),
        servicio('s2', 'r-alejandro', 'Tinaja Jacuzzi', '2026-09-06', 30000)
    ];
    const cargos = [
        cargo('c1', 'r-alejandro', 's1', 'Late Check-out', 20000),
        cargo('c2', 'r-alejandro', 's2', 'Tinaja Jacuzzi', 30000)
    ];
    const pago = { monto: 50000, transaccion_distribuida: true, aplicaciones_libro: [
        { concepto: 'Late Out', monto: 20000, fecha_bloque: '2026-09-06' },
        { concepto: 'Jacuzzi', monto: 30000, fecha_bloque: '2026-09-06' }
    ] };
    const out = D.resolverTransaccion(pago, 'r-alejandro', snapshot(servicios, cargos));
    assert.equal(out.estado, 'destino_unico');
    assert.deepEqual(out.aplicaciones_payload, [{ cargo_id: 'c1', monto: 20000 }, { cargo_id: 'c2', monto: 30000 }]);
});

test('Hernán: Tinaja y Masaje sólo se resuelven si ambos cargos existen', () => {
    const servicios = [servicio('s1', 'r-hernan', 'Tinaja Tonel', '2026-09-08', 30000), servicio('s2', 'r-hernan', 'Masaje', '2026-09-08', 70000)];
    const cargos = [cargo('c1', 'r-hernan', 's1', 'Tinaja Tonel', 30000), cargo('c2', 'r-hernan', 's2', 'Masaje', 70000)];
    const pago = { monto: 100000, transaccion_distribuida: true, aplicaciones_libro: [{ concepto: 'Tinaja', monto: 30000 }, { concepto: 'Masaje', monto: 70000 }] };
    assert.equal(D.resolverTransaccion(pago, 'r-hernan', snapshot(servicios, cargos)).estado, 'destino_unico');
    assert.equal(D.resolverTransaccion(pago, 'r-hernan', snapshot(servicios.slice(0, 1), cargos.slice(0, 1))).estado, 'revision');
});

test('dos cargos pendientes del mismo concepto sin fecha inequívoca quedan en revisión', () => {
    const servicios = [servicio('s1', 'r1', 'Tinaja Tonel', '2026-09-01', 30000), servicio('s2', 'r1', 'Tinaja Tonel', '2026-09-02', 30000)];
    const cargos = [cargo('c1', 'r1', 's1', 'Tinaja Tonel', 30000), cargo('c2', 'r1', 's2', 'Tinaja Tonel', 30000)];
    const out = D.resolverTransaccion(pagoServicio('tinaja', 30000, null), 'r1', snapshot(servicios, cargos));
    assert.equal(out.aplicaciones[0].estado, 'multiples_destinos');
});

test('una aplicación parcial conserva el remanente del cargo', () => {
    const s = servicio('s1', 'r1', 'Masaje', '2026-09-01', 70000);
    const out = D.resolverTransaccion(pagoServicio('masaje', 30000, '2026-09-01'), 'r1', snapshot([s], [cargo('c1', 'r1', 's1', 'Masaje', 70000)]));
    assert.equal(out.aplicaciones[0].aplicacion_parcial, true);
    assert.equal(out.aplicaciones[0].remanente_cargo, 40000);
});

test('monto mayor que el saldo del cargo se bloquea', () => {
    const s = servicio('s1', 'r1', 'Masaje', '2026-09-01', 70000);
    const out = D.resolverTransaccion(pagoServicio('masaje', 80000, '2026-09-01'), 'r1', snapshot([s], [cargo('c1', 'r1', 's1', 'Masaje', 70000)]));
    assert.equal(out.aplicaciones[0].estado, 'saldo_insuficiente');
});

test('reserva ambigua bloquea antes de elegir cargos', () => {
    const out = D.resolverTransaccion(pagoServicio('masaje', 30000), null, snapshot([], []));
    assert.equal(out.estado, 'revision');
    assert.match(out.motivo, /reserva destino/i);
});

test('dos partes no pueden consumir el mismo cargo', () => {
    const s = servicio('s1', 'r1', 'Masaje', '2026-09-01', 70000);
    const pago = { monto: 60000, transaccion_distribuida: true, aplicaciones_libro: [{ concepto: 'masaje', monto: 30000 }, { concepto: 'masaje', monto: 30000 }] };
    const out = D.resolverTransaccion(pago, 'r1', snapshot([s], [cargo('c1', 'r1', 's1', 'Masaje', 70000)]));
    assert.equal(out.estado, 'revision');
    assert.ok(out.aplicaciones.every(x => x.estado === 'revision'));
});

test('suma distribuida diferente del comprobante se bloquea', () => {
    const pago = { monto: 50000, transaccion_distribuida: true, aplicaciones_libro: [{ concepto: 'masaje', monto: 30000 }] };
    assert.match(D.resolverTransaccion(pago, 'r1', snapshot([], [])).motivo, /suma/i);
});

test('conceptos genéricos, notas y movimientos anulados no generan destinos', () => {
    assert.equal(D.conceptoCanon('servicio'), null);
    assert.deepEqual(D.aplicacionesLibro({ tipo_movimiento: 'servicio', concepto: 'tinaja', monto: 30000, clasificacion_financiera: 'nota_financiera' }), []);
    assert.deepEqual(D.aplicacionesLibro({ tipo_movimiento: 'servicio', concepto: 'tinaja', monto: 30000, estado: 'anulado' }), []);
});

test('pago existente aplicado exactamente se reconoce sin crear otra aplicación', () => {
    const s = servicio('s1', 'r1', 'Masaje', '2026-09-01', 30000);
    const c = cargo('c1', 'r1', 's1', 'Masaje', 0, { monto: 30000, monto_ajustado: 30000, aplicado_neto: 30000 });
    const out = D.resolverTransaccion(pagoServicio('masaje', 30000, '2026-09-01'), 'r1', snapshot([s], [c], [{ pago_id: 'p1', cargo_id: 'c1', monto_aplicado: 30000 }]), { id: 'p1' });
    assert.equal(out.estado, 'ya_aplicada');
    assert.equal(out.aplicaciones[0].cargo_id, 'c1');
});

test('leerSnapshot usa sólo SELECT y carga cargos, servicios, aplicaciones y pagos', async () => {
    const calls = [];
    const tablas = {
        vista_estado_cargos: [cargo('c1', 'r1', 's1', 'Masaje', 30000)],
        servicios: [servicio('s1', 'r1', 'Masaje', '2026-09-01', 30000)],
        pago_aplicaciones: [{ id: 'a1', pago_id: 'p1', cargo_id: 'c1', monto_aplicado: 30000 }],
        pagos: [{ id: 'p1', reserva_id: 'r1', monto: 30000 }]
    };
    const cliente = { from(tabla) {
        calls.push(['from', tabla]);
        const query = {
            select(campos) { calls.push(['select', tabla, campos]); return query; },
            in() { return query; }, eq() { return query; }, order() { return query; },
            async range() { return { data: tablas[tabla] || [], error: null }; }
        };
        return query;
    } };
    const out = await D.leerSnapshot(cliente, ['r1']);
    assert.equal(out.cargos.length, 1);
    assert.deepEqual(calls.filter(x => x[0] === 'from').map(x => x[1]).sort(), ['pago_aplicaciones', 'pagos', 'servicios', 'vista_estado_cargos'].sort());
    assert.equal(calls.some(x => /insert|update|delete|rpc/i.test(x[0])), false);
});

test('panel carga el resolver financiero antes del módulo de consultas', () => {
    const html = fs.readFileSync('panel.html', 'utf8');
    assert.ok(html.indexOf("'haiku-libro-pagos-destinos-v1'") < html.indexOf("'haiku-libro-consultas-v1'"));
});
