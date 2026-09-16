const test = require('node:test');
const assert = require('node:assert/strict');

global.HAIKU_LIBRO_SEMANTICA = require('../js/haiku-libro-semantica-v1.js');
global.HAIKU_LIBRO_PAGOS_DESTINOS_V1 = require('../js/haiku-libro-pagos-destinos-v1.js');
delete require.cache[require.resolve('../js/haiku-libro-consultas-v1.js')];
const Q = require('../js/haiku-libro-consultas-v1.js');

const q = { desde: '2026-09-01', hasta: '2026-09-30' };
const pago = extra => ({ tipo_movimiento: 'servicio', concepto: 'tinaja', monto: 30000, moneda: 'CLP',
    medio_pago: 'debito', codigo_autorizacion: '622979', fecha_comprobante: '2026-09-12', fecha_bloque: '2026-09-12',
    pago_recibido: true, estado_pago: 'registrado_en_libro', texto_original: 'Tinaja $30.000',
    origen: { hoja: 'Sep26', celda: 'K20' }, ...extra });
const reserva = p => ({ id: 'libro-1', titular: 'Carlos Marquez', rut_documento: '11111111-1', cabana: 1,
    fecha_checkin: '2026-09-12', fecha_checkout: '2026-09-13', tipo_estadia: 'alojamiento', noches: 1,
    adultos: 2, ninos: 0, mascotas: 0, pagos: [p], pagos_sin_asociacion: [], servicios: [], advertencias: [],
    coordenadas_origen: { hoja: 'Sep26', celda: 'C20' } });
const estadia = r => ({ id: 'e1', reserva_id: 'r1', fecha_ingreso: r.fecha_checkin, fecha_salida: r.fecha_checkout,
    estado_estadia: 'confirmada', tipo_estadia: 'alojamiento', adultos: 2, ninos: 0, mascotas: 0,
    cabanas: { numero: r.cabana }, reservas: { id: 'r1', titular_nombre: r.titular,
        titular_numero_documento: r.rut_documento, estado_reserva: 'confirmada' } });
const servicio = { id: 's1', reserva_id: 'r1', fecha_servicio: '2026-09-12', total: 30000,
    tipo_cobro: 'normal', estado_servicio: 'programado', catalogo_servicios: { codigo: 'TIN-TONEL', nombre: 'Tinaja Tonel', categoria: 'servicio' } };
const cargo = { cargo_id: 'c1', reserva_id: 'r1', servicio_id: 's1', tipo_cargo: 'servicio', concepto: 'Tinaja Tonel',
    monto: 30000, monto_ajustado: 30000, aplicado_neto: 0, saldo_cargo: 30000, estado: 'activo', estado_pago: 'pendiente' };

function cliente(tablas, fallarFinanzas = false) {
    const calls = [];
    return { calls, auth: { getSession: async () => ({ data: { session: { user: { id: 'test' } } } }) },
        from(tabla) {
            calls.push(tabla);
            const builder = {
                select() { return builder; }, in() { return builder; }, eq() { return builder; },
                lte() { return builder; }, gte() { return builder; }, order() { return builder; },
                async range(desde, hasta) {
                    if (fallarFinanzas && tabla === 'vista_estado_cargos') return { error: { message: 'denied' } };
                    return { data: (tablas[tabla] || []).slice(desde, hasta + 1), error: null };
                }
            };
            return builder;
        },
        async rpc() { throw new Error('Una prueba de lectura no debe invocar RPC.'); }
    };
}

test('comparación adjunta destino único, pero el plan bloquea escritura por contrato incompatible', async () => {
    const p = pago(), r = reserva(p);
    const db = cliente({ reserva_estadias: [estadia(r)], pagos: [], servicios: [servicio], vista_estado_cargos: [cargo], pago_aplicaciones: [] });
    const comp = await Q.compararSistema([r], db, q);
    assert.equal(comp.pagosDetalle[0].estado, 'nuevo_seguro');
    assert.equal(comp.pagosDetalle[0].destinoFinanciero.estado, 'destino_unico');
    assert.deepEqual(comp.pagosDetalle[0].destinoFinanciero.aplicaciones_payload, [{ cargo_id: 'c1', monto: 30000 }]);
    const plan = Q.crearPlanIncorporacion([r], comp);
    const item = plan.items.find(x => x.pagoLibro === p);
    assert.equal(item.aprobableFinancieramente, true);
    assert.equal(item.aprobable, false);
    assert.equal(item.seleccionado, false);
    assert.match(item.motivos.join(' '), /writer actual no admite aplicaciones explícitas/i);
    assert.equal(Q.serializarIncorporacion(plan).some(x => x.tipo === 'pago'), false);
    assert.equal(db.calls.includes('vista_estado_cargos'), true);
});

test('deduplicación en_sistema ocurre antes del destino y no lee cargos financieros', async () => {
    const p = pago(), r = reserva(p);
    const existente = { id: 'p1', reserva_id: 'r1', monto: 30000, moneda: 'CLP', estado: 'confirmado',
        codigo_autorizacion: p.codigo_autorizacion, medio_pago: 'tarjeta_debito', fecha_pago: p.fecha_comprobante };
    const db = cliente({ reserva_estadias: [estadia(r)], pagos: [existente], servicios: [servicio] });
    const comp = await Q.compararSistema([r], db, q);
    assert.equal(comp.pagosDetalle[0].estado, 'en_sistema');
    assert.equal(comp.pagosDetalle[0].destinoFinanciero, undefined);
    assert.equal(db.calls.includes('vista_estado_cargos'), false);
    const item = Q.crearPlanIncorporacion([r], comp).items.find(x => x.texto.includes('Carlos Marquez') && x.categoria === 'omitidos');
    assert.ok(item);
    assert.equal(item.payload, null);
});

test('fallo de lectura financiera queda en revisión y nunca se interpreta como ausencia', async () => {
    const p = pago(), r = reserva(p);
    const db = cliente({ reserva_estadias: [estadia(r)], pagos: [], servicios: [servicio], vista_estado_cargos: [cargo] }, true);
    const comp = await Q.compararSistema([r], db, q);
    assert.equal(comp.snapshot.finanzas.disponible, false);
    assert.equal(comp.pagosDetalle[0].destinoFinanciero.estado, 'revision');
    assert.match(comp.pagosDetalle[0].destinoFinanciero.motivo, /denied/);
    const item = Q.crearPlanIncorporacion([r], comp).items.find(x => x.pagoLibro === p);
    assert.equal(item.aprobable, false);
    assert.equal(item.seleccionado, false);
});
