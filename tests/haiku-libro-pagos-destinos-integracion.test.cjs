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
    assert.match(item.motivos.join(' '), /escritura protegida.+todavía no está disponible/i);
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

function casoEfectivoMacarena(cambios = {}) {
    const movimiento = { tipo_movimiento: 'alojamiento', concepto: 'cab10/fullday', monto: 100000, moneda: 'CLP',
        medio_pago: 'efectivo', codigo_autorizacion: null, folio: null, bovtar: null,
        fecha_comprobante: '2026-09-04', fecha_bloque: '2026-09-04', cabana: 10,
        pago_recibido: true, estado_pago: 'registrado_en_libro', texto_original: 'Macarena // cab10/fullday // Efectivo $100.000',
        origen: { hoja: 'Sep26', celda: 'L27' }, ...(cambios.movimiento || {}) };
    const libro = { id: 'libro-macarena', titular: 'Macarena Hurtado', rut_documento: '22222222-2', cabana: 10,
        fecha_checkin: '2026-09-04', fecha_checkout: '2026-09-04', tipo_estadia: 'full_day', noches: 0,
        adultos: 2, ninos: 0, mascotas: 0, pagos: [movimiento], pagos_sin_asociacion: [], servicios: [], advertencias: [],
        coordenadas_origen: { hoja: 'Sep26', celda: 'K27' }, ...(cambios.libro || {}) };
    const estadiaSistema = { id: 'e-macarena-full', reserva_id: 'r-macarena', fecha_ingreso: '2026-09-04', fecha_salida: '2026-09-04',
        estado_estadia: 'confirmada', tipo_estadia: 'fullday', adultos: 2, ninos: 0, mascotas: 0,
        cabanas: { numero: 10 }, reservas: { id: 'r-macarena', titular_nombre: 'Macarena Hurtado',
            titular_numero_documento: '22222222-2', estado_reserva: 'confirmada' }, ...(cambios.estadia || {}) };
    const efectivo = { id: 'p-efectivo-100', reserva_id: 'r-macarena', monto: 100000, moneda: 'CLP', estado: 'confirmado',
        medio_pago: 'efectivo', fecha_pago: '2026-09-04', tipo_movimiento: 'pago', ...(cambios.pago || {}) };
    const tarjeta = { id: 'p-tarjeta-20', reserva_id: 'r-macarena', monto: 20000, moneda: 'CLP', estado: 'confirmado',
        medio_pago: 'tarjeta_debito', fecha_pago: '2026-09-04', tipo_movimiento: 'pago' };
    const cargoFull = { cargo_id: 'c-full-day', reserva_id: 'r-macarena', estadia_id: 'e-macarena-full', tipo_cargo: 'alojamiento',
        concepto: 'Full Day · 04-09-2026', monto: 120000, monto_ajustado: 120000, estado: 'activo', estado_pago: 'pagado',
        ...(cambios.cargo || {}) };
    const aplicacion100 = { id: 'pa-100', pago_id: 'p-efectivo-100', cargo_id: 'c-full-day', monto_aplicado: 100000,
        ...(cambios.aplicacion || {}) };
    const aplicacion20 = { id: 'pa-20', pago_id: 'p-tarjeta-20', cargo_id: 'c-full-day', monto_aplicado: 20000 };
    const tablas = { reserva_estadias: [estadiaSistema], pagos: [efectivo, tarjeta], servicios: [],
        vista_estado_cargos: [cargoFull], pago_aplicaciones: [aplicacion100, aplicacion20] };
    if (cambios.tablas) cambios.tablas(tablas, { movimiento, libro, estadiaSistema, efectivo, cargoFull, aplicacion100 });
    return { movimiento, libro, tablas };
}

async function compararEfectivo(cambios) {
    const caso = casoEfectivoMacarena(cambios);
    const db = cliente(caso.tablas, Boolean(cambios?.fallarFinanzas));
    const comp = await Q.compararSistema([caso.libro], db, q);
    return { ...caso, db, comp, detalle: comp.pagosDetalle.find(x => x.pago === caso.movimiento) };
}

test('efectivo confirmado aplicado inequívocamente al Full Day queda en_sistema y omitido', async () => {
    const { libro, movimiento, comp, detalle, db } = await compararEfectivo();
    assert.equal(detalle.estado, 'en_sistema');
    assert.equal(detalle.sistema.id, 'p-efectivo-100');
    assert.equal(detalle.coincidencia_aplicacion_alojamiento, true);
    assert.equal(comp.snapshot.efectivo_aplicado.aplicaciones.length, 2);
    assert.equal(comp.snapshot.efectivo_aplicado.aplicaciones.reduce((s, x) => s + x.monto_aplicado, 0), 120000);
    assert.equal(comp.meta.pagos_revisar, 0);
    const plan = Q.crearPlanIncorporacion([libro], comp);
    const item = plan.items.find(x => x.pagoLibro === movimiento || x.texto.includes('$100.000'));
    assert.equal(item.categoria, 'omitidos');
    assert.equal(item.payload, null);
    assert.notEqual(item.aprobable, true);
    assert.equal(Q.serializarIncorporacion(plan).some(x => x.tipo === 'pago'), false);
    assert.equal(db.calls.includes('vista_estado_cargos'), true);
    assert.equal(db.calls.includes('pago_aplicaciones'), true);
});

const revisaEfectivo = async cambios => assert.equal((await compararEfectivo(cambios)).detalle.estado, 'revisar');

test('efectivo aplicado permanece en revisión con dos pagos candidatos', async () => revisaEfectivo({
    tablas(tablas) { tablas.pagos.push({ ...tablas.pagos[0], id: 'p-efectivo-duplicado' }); }
}));

test('efectivo aplicado permanece en revisión con dos cargos compatibles', async () => revisaEfectivo({
    tablas(tablas) { tablas.vista_estado_cargos.push({ ...tablas.vista_estado_cargos[0], cargo_id: 'c-full-day-2' }); }
}));

test('efectivo sin aplicación permanece en revisión', async () => revisaEfectivo({
    tablas(tablas) { tablas.pago_aplicaciones = tablas.pago_aplicaciones.filter(x => x.pago_id !== 'p-efectivo-100'); }
}));

test('efectivo aplicado a otro cargo o estadía permanece en revisión', async () => revisaEfectivo({
    aplicacion: { cargo_id: 'c-otra-estadia' },
    tablas(tablas) { tablas.vista_estado_cargos.push({ ...tablas.vista_estado_cargos[0], cargo_id: 'c-otra-estadia', estadia_id: 'e-otra' }); }
}));

test('efectivo de otra CAB no usa la aplicación de la estadía asociada', async () => revisaEfectivo({ movimiento: { cabana: 9 } }));

test('efectivo con monto aplicado incompatible permanece en revisión', async () => revisaEfectivo({ aplicacion: { monto_aplicado: 90000 } }));

test('efectivo con cargo anulado permanece en revisión', async () => revisaEfectivo({ cargo: { estado: 'anulado' } }));

test('efectivo con pago anulado permanece en revisión', async () => revisaEfectivo({ pago: { estado: 'anulado' } }));

test('fallo al leer aplicaciones de alojamiento conserva revisión sin inferir ausencia', async () => {
    const { comp, detalle } = await compararEfectivo({ fallarFinanzas: true });
    assert.equal(detalle.estado, 'revisar');
    assert.equal(comp.snapshot.efectivo_aplicado.disponible, false);
    assert.match(comp.snapshot.efectivo_aplicado.error, /No fue posible leer las aplicaciones de alojamiento/);
});

test('dos movimientos Libro no pueden reutilizar la misma aplicación', async () => revisaEfectivo({
    libro: { pagos_sin_asociacion: [{ tipo_movimiento: 'alojamiento', concepto: 'cab10/fullday', monto: 100000, moneda: 'CLP',
        medio_pago: 'efectivo', fecha_comprobante: '2026-09-04', fecha_bloque: '2026-09-04', cabana: 10,
        pago_recibido: true, estado_pago: 'registrado_en_libro', texto_original: 'Segundo efectivo', origen: { hoja: 'Sep26', celda: 'M27' } }] }
}));
