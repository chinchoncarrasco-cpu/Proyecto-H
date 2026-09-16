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
    const calls = [], ordenes = [];
    return { calls, ordenes, auth: { getSession: async () => ({ data: { session: { user: { id: 'test' } } } }) },
        from(tabla) {
            calls.push(tabla);
            const ordenBuilder = [];
            const builder = {
                select() { return builder; }, in() { return builder; }, eq() { return builder; },
                lte() { return builder; }, gte() { return builder; },
                order(campo) { ordenBuilder.push(campo); ordenes.push([tabla, campo]); return builder; },
                async range(desde, hasta) {
                    if (fallarFinanzas && tabla === 'vista_estado_cargos') return { error: { message: 'denied' } };
                    if (tabla === 'vista_estado_cargos' && ordenBuilder.includes('id')) return { error: { message: 'column vista_estado_cargos.id does not exist' } };
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

function casoYenny(cambios = {}) {
    const movimiento = pago({ fecha_comprobante: '2026-09-06', fecha_bloque: '2026-09-04', medio_pago: 'debito',
        codigo_autorizacion: null, folio: '000249', bovtar: '004290', texto_original: 'Yenny Acuña // Bovtar:004290-Folio:000249 // Debito // TINAJA',
        ...(cambios.movimiento || {}) });
    const libro = { ...reserva(movimiento), titular: 'Yenny Acuña Berrios', rut_documento: '22222222-2', cabana: 6,
        fecha_checkin: '2026-09-04', fecha_checkout: '2026-09-06', noches: 2 };
    const estadiaSistema = estadia(libro);
    Object.assign(estadiaSistema, { id: 'e-yenny', reserva_id: 'r-yenny',
        reservas: { ...estadiaSistema.reservas, id: 'r-yenny', titular_nombre: libro.titular } });
    const pagoSistema = { id: 'p-yenny-tinaja', reserva_id: 'r-yenny', monto: 30000, moneda: 'CLP', estado: 'confirmado',
        tipo_movimiento: 'pago', medio_pago: 'tarjeta_debito', folio: '000249', codigo_autorizacion: '004290',
        fecha_pago: '2026-09-07T02:39:54Z', datos_origen: {}, ...(cambios.pago || {}) };
    const servicioSistema = { ...servicio, id: 's-yenny', reserva_id: 'r-yenny', estadia_id: 'e-yenny',
        fecha_servicio: '2026-09-04', estado_servicio: 'realizado' };
    const cargoSistema = { ...cargo, cargo_id: 'c-yenny-tinaja', reserva_id: 'r-yenny', estadia_id: 'e-yenny',
        servicio_id: 's-yenny', monto: 30000, monto_ajustado: 30000, aplicado_neto: 30000, saldo_cargo: 0,
        estado_pago: 'pagado', ...(cambios.cargo || {}) };
    const aplicacion = { id: 'a-yenny-tinaja', pago_id: 'p-yenny-tinaja', cargo_id: 'c-yenny-tinaja',
        monto_aplicado: 30000, ...(cambios.aplicacion || {}) };
    const tablas = { reserva_estadias: [estadiaSistema], pagos: [pagoSistema, ...(cambios.pagos || [])],
        servicios: [servicioSistema, ...(cambios.servicios || [])],
        vista_estado_cargos: [cargoSistema, ...(cambios.cargos || [])],
        pago_aplicaciones: cambios.sinAplicacion ? [] : [aplicacion, ...(cambios.aplicaciones || [])] };
    if (cambios.tablas) cambios.tablas(tablas, { movimiento, libro, pagoSistema, cargoSistema, servicioSistema, aplicacion });
    return { movimiento, libro, pagoSistema, tablas };
}

async function compararYenny(cambios = {}) {
    const caso = casoYenny(cambios), db = cliente(caso.tablas);
    const comp = await Q.compararSistema([caso.libro], db, q);
    return { ...caso, db, comp, detalle: comp.pagosDetalle.find(item => item.pago === caso.movimiento) };
}

test('Yenny: Folio+BOVTAR del Libro reconoce el CodAut migrado sólo por su aplicación exacta al servicio', async () => {
    const { libro, movimiento, comp, detalle } = await compararYenny();
    assert.equal(detalle.estado, 'en_sistema');
    assert.equal(detalle.sistema.id, 'p-yenny-tinaja');
    assert.equal(detalle.coincidencia_aplicacion_servicio, true);
    assert.equal(detalle.destinoFinanciero.estado, 'ya_aplicada');
    assert.equal(detalle.destinoFinanciero.aplicaciones[0].cargo_id, 'c-yenny-tinaja');
    assert.equal(comp.meta.pagos_faltantes, 0);assert.equal(comp.meta.pagos_revisar, 0);
    const plan = Q.crearPlanIncorporacion([libro], comp), item = plan.items.find(x => x.pagoLibro === movimiento);
    assert.equal(item.categoria, 'omitidos');assert.equal(item.payload, null);assert.notEqual(item.aprobable, true);
    assert.equal(Q.serializarIncorporacion(plan).some(x => x.tipo === 'pago'), false);
});

test('Yenny queda en revisión ante identidad, destino o reutilización no inequívocos', async () => {
    const base = casoYenny(), duplicadoLibro = { ...base.movimiento, origen: { hoja: 'Sep26', celda: 'K99' } };
    const casos = [
        ['mismo Folio global', { pagos: [{ ...base.pagoSistema, id: 'p-otro', codigo_autorizacion: 'OTRO' }] }],
        ['CodAut contradictorio', { pago: { codigo_autorizacion: 'OTRO' } }],
        ['otra reserva', { pago: { reserva_id: 'otra-reserva' } }],
        ['otro monto', { pago: { monto: 31000 } }],
        ['otra moneda', { pago: { moneda: 'USD' } }],
        ['otro medio', { pago: { medio_pago: 'transferencia' } }],
        ['sin aplicación', { sinAplicacion: true }],
        ['aplicación a otro servicio', { aplicacion: { cargo_id: 'c-masaje' }, cargos: [{ ...base.tablas.vista_estado_cargos[0],
            cargo_id: 'c-masaje', servicio_id: 's-masaje', concepto: 'Masaje' }], servicios: [{ ...base.tablas.servicios[0],
            id: 's-masaje', catalogo_servicios: { codigo: 'MASAJE', nombre: 'Masaje', categoria: 'servicio' } }] }],
        ['cargo de otra reserva', { cargo: { reserva_id: 'otra-reserva' } }],
        ['dos movimientos Libro', { tablas(tablas, datos) { datos.libro.pagos.push(duplicadoLibro); } }],
        ['pago anulado', { pago: { estado: 'anulado' } }],
        ['sólo monto y fecha', { movimiento: { folio: null, bovtar: null, codigo_autorizacion: null } }]
    ];
    for (const [nombre, cambios] of casos) {
        const { comp } = await compararYenny(cambios);
        const items = comp.pagosDetalle.filter(item => item.pago.monto === 30000);
        assert.ok(items.length >= 1, nombre);assert.ok(items.every(item => item.estado === 'revisar'), nombre);
        assert.ok(items.every(item => item.estado !== 'en_sistema'), nombre);
    }
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
    assert.equal(db.ordenes.some(([tabla, campo]) => tabla === 'vista_estado_cargos' && campo === 'id'), false);
    assert.equal(db.ordenes.some(([tabla, campo]) => tabla === 'vista_estado_cargos' && campo === 'cargo_id'), true);
});

test('objeto real Sep26 O71:R71 conserva CAB 10 y reconcilia con orden válido de la vista', async () => {
    const hoja = global.HAIKU_LIBRO_SEMANTICA.normalizarHoja(require('./fixtures/libro-pagos-sep26.cjs')(), 'Sep26');
    const libro = hoja.reservas.find(r => r.titular === 'Macarena Hurtado' && r.cabana === 10);
    const movimiento = libro.pagos.find(p => p.monto === 100000 && p.medio_pago === 'efectivo');
    assert.deepEqual({ cabana: movimiento.cabana, fecha_bloque: movimiento.fecha_bloque,
        tipo_movimiento: movimiento.tipo_movimiento, estado_pago: movimiento.estado_pago,
        pago_recibido: movimiento.pago_recibido, concepto: movimiento.concepto }, {
        cabana: 10, fecha_bloque: '2026-09-04', tipo_movimiento: 'alojamiento',
        estado_pago: 'registrado_en_libro', pago_recibido: true, concepto: 'cab10/fullday'
    });
    const caso = casoEfectivoMacarena();
    const db = cliente(caso.tablas);
    const comp = await Q.compararSistema([{ ...libro, pagos: [movimiento], pagos_sin_asociacion: [] }], db, q);
    const detalle = comp.pagosDetalle.find(x => x.pago === movimiento);
    assert.equal(detalle.estado, 'en_sistema');
    assert.equal(detalle.coincidencia_aplicacion_alojamiento, true);
    assert.deepEqual(db.ordenes.filter(([tabla]) => tabla === 'vista_estado_cargos'), [['vista_estado_cargos', 'cargo_id']]);
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
    assert.match(comp.snapshot.efectivo_aplicado.error, /No fue posible leer las aplicaciones de efectivo/);
});

test('dos movimientos Libro no pueden reutilizar la misma aplicación', async () => revisaEfectivo({
    libro: { pagos_sin_asociacion: [{ tipo_movimiento: 'alojamiento', concepto: 'cab10/fullday', monto: 100000, moneda: 'CLP',
        medio_pago: 'efectivo', fecha_comprobante: '2026-09-04', fecha_bloque: '2026-09-04', cabana: 10,
        pago_recibido: true, estado_pago: 'registrado_en_libro', texto_original: 'Segundo efectivo', origen: { hoja: 'Sep26', celda: 'M27' } }] }
}));

function casoEfectivoPascual(cambios = {}) {
    const movimiento = { tipo_movimiento: 'servicio', concepto: 'LATEOUT', monto: 20000, moneda: 'CLP',
        medio_pago: 'efectivo', codigo_autorizacion: null, folio: null, bovtar: null,
        fecha_comprobante: '2026-09-06', fecha_bloque: '2026-09-04', cabana: 4,
        pago_recibido: true, estado_pago: 'registrado_en_libro',
        texto_original: 'Pascual Abarca // efectivo // $20.000 // LATEOUT',
        origen: { hoja: 'Sep26', celda: 'BC45:BF45' }, ...(cambios.movimiento || {}) };
    const evidenciaServicio = { concepto: 'lateout', texto_original: 'late check out hasta las 14:00 x pagar',
        pendiente: true, cortesia: false, hora: '14:00', monto: null };
    const libro = { id: 'libro-pascual', titular: 'Pascual Abarca', rut_documento: '13368741-6', cabana: 4,
        fecha_checkin: '2026-09-04', fecha_checkout: '2026-09-06', tipo_estadia: 'alojamiento', noches: 2,
        adultos: 2, ninos: 0, mascotas: 0, pagos: [movimiento], pagos_sin_asociacion: [],
        servicios: [evidenciaServicio], advertencias: [], coordenadas_origen: { hoja: 'Sep26', celda: 'BC8' },
        ...(cambios.libro || {}) };
    const estadiaSistema = { id: 'e-pascual', reserva_id: 'r-pascual', fecha_ingreso: '2026-09-04', fecha_salida: '2026-09-06',
        estado_estadia: 'confirmada', tipo_estadia: 'alojamiento', adultos: 2, ninos: 0, mascotas: 0,
        cabanas: { numero: 4 }, reservas: { id: 'r-pascual', titular_nombre: 'Pascual Abarca',
            titular_numero_documento: '13368741-6', estado_reserva: 'confirmada' }, ...(cambios.estadia || {}) };
    const efectivo = { id: 'p-efectivo-lateout', reserva_id: 'r-pascual', monto: 20000, moneda: 'CLP', estado: 'confirmado',
        medio_pago: 'efectivo', fecha_pago: '2026-09-06', tipo_movimiento: 'pago', ...(cambios.pago || {}) };
    const servicioAplicado = { id: 's-lateout-06', reserva_id: 'r-pascual', estadia_id: 'e-pascual',
        fecha_servicio: '2026-09-06', total: 20000, estado_servicio: 'programado',
        catalogo_servicios: { codigo: 'lateCheckout', nombre: 'Late Check-out', categoria: 'servicio' },
        ...(cambios.servicio || {}) };
    const servicioExtra = { id: 's-lateout-04', reserva_id: 'r-pascual', estadia_id: 'e-pascual',
        fecha_servicio: '2026-09-04', total: 20000, estado_servicio: 'programado',
        catalogo_servicios: { codigo: 'lateCheckout', nombre: 'Late Check-out', categoria: 'servicio' } };
    const cargoAplicado = { cargo_id: 'c-lateout-06', reserva_id: 'r-pascual', estadia_id: 'e-pascual',
        servicio_id: 's-lateout-06', tipo_cargo: 'servicio', concepto: 'Late Check-out', monto: 20000,
        monto_ajustado: 20000, estado: 'activo', estado_pago: 'pagado', ...(cambios.cargo || {}) };
    const cargoExtra = { cargo_id: 'c-lateout-04', reserva_id: 'r-pascual', estadia_id: 'e-pascual',
        servicio_id: 's-lateout-04', tipo_cargo: 'servicio', concepto: 'Late Check-out', monto: 20000,
        monto_ajustado: 20000, estado: 'activo', estado_pago: 'pendiente' };
    const aplicacion = { id: 'pa-lateout', pago_id: 'p-efectivo-lateout', cargo_id: 'c-lateout-06', monto_aplicado: 20000,
        ...(cambios.aplicacion || {}) };
    const tablas = { reserva_estadias: [estadiaSistema], pagos: [efectivo], servicios: [servicioAplicado, servicioExtra],
        vista_estado_cargos: [cargoAplicado, cargoExtra], pago_aplicaciones: [aplicacion] };
    if (cambios.tablas) cambios.tablas(tablas, { movimiento, libro, estadiaSistema, efectivo, servicioAplicado,
        servicioExtra, cargoAplicado, cargoExtra, aplicacion });
    return { movimiento, libro, tablas };
}

async function compararEfectivoPascual(cambios) {
    const caso = casoEfectivoPascual(cambios);
    const db = cliente(caso.tablas, Boolean(cambios?.fallarFinanzas));
    const comp = await Q.compararSistema([caso.libro], db, q);
    return { ...caso, db, comp, detalle: comp.pagosDetalle.find(x => x.pago === caso.movimiento) };
}

test('Pascual: efectivo aplicado al Late Check-out queda omitido aunque exista otro cargo igual sin aplicación', async () => {
    const { libro, movimiento, comp, detalle } = await compararEfectivoPascual();
    assert.equal(detalle.estado, 'en_sistema');
    assert.equal(detalle.sistema.id, 'p-efectivo-lateout');
    assert.equal(detalle.coincidencia_aplicacion_servicio, true);
    assert.equal(detalle.cargo_sistema.cargo_id, 'c-lateout-06');
    assert.equal(comp.snapshot.efectivo_aplicado.cargos.filter(x => x.tipo_cargo === 'servicio').length, 2);
    assert.equal(comp.serviciosDetalle[0].estado, 'revisar');
    assert.equal(comp.meta.pagos_revisar, 0);
    assert.equal(comp.meta.servicios_revisar, 1);
    const item = Q.crearPlanIncorporacion([libro], comp).items.find(x => x.pagoLibro === movimiento || x.texto.includes('$20.000'));
    assert.equal(item.categoria, 'omitidos');
    assert.equal(item.payload, null);
    assert.notEqual(item.aprobable, true);
    assert.equal(Q.serializarIncorporacion(Q.crearPlanIncorporacion([libro], comp)).some(x => x.tipo === 'pago'), false);
});

const revisaEfectivoPascual = async cambios => assert.equal((await compararEfectivoPascual(cambios)).detalle.estado, 'revisar');

test('Pascual permanece en revisión con dos pagos efectivo candidatos', async () => revisaEfectivoPascual({
    tablas(tablas) { tablas.pagos.push({ ...tablas.pagos[0], id: 'p-efectivo-lateout-2' }); }
}));

test('Pascual permanece en revisión con dos aplicaciones compatibles del pago', async () => revisaEfectivoPascual({
    tablas(tablas) { tablas.pago_aplicaciones.push({ ...tablas.pago_aplicaciones[0], id: 'pa-lateout-2' }); }
}));

test('Pascual permanece en revisión sin aplicación', async () => revisaEfectivoPascual({
    tablas(tablas) { tablas.pago_aplicaciones = []; }
}));

test('Pascual permanece en revisión con monto aplicado distinto', async () => revisaEfectivoPascual({
    aplicacion: { monto_aplicado: 19000 }
}));

test('Pascual permanece en revisión con cargo anulado', async () => revisaEfectivoPascual({
    cargo: { estado: 'anulado' }
}));

test('Pascual permanece en revisión con cargo de otro concepto', async () => revisaEfectivoPascual({
    cargo: { concepto: 'Tinaja' }, servicio: { catalogo_servicios: { codigo: 'tinaja', nombre: 'Tinaja', categoria: 'servicio' } }
}));

test('Pascual permanece en revisión cuando servicio y estadía se contradicen', async () => revisaEfectivoPascual({
    servicio: { estadia_id: 'e-otra' }
}));

test('Pascual permanece en revisión cuando el cargo pertenece a otra reserva', async () => revisaEfectivoPascual({
    cargo: { reserva_id: 'r-otra' }
}));

test('Pascual permanece en revisión con pago anulado', async () => revisaEfectivoPascual({
    pago: { estado: 'anulado' }
}));

test('dos movimientos de servicio del Libro no reutilizan la aplicación de Pascual', async () => revisaEfectivoPascual({
    libro: { pagos_sin_asociacion: [{ tipo_movimiento: 'servicio', concepto: 'LATEOUT', monto: 20000, moneda: 'CLP',
        medio_pago: 'efectivo', fecha_comprobante: '2026-09-06', fecha_bloque: '2026-09-04', cabana: 4,
        pago_recibido: true, estado_pago: 'registrado_en_libro', texto_original: 'Segundo efectivo Late Out',
        origen: { hoja: 'Sep26', celda: 'BC46:BF46' } }] }
}));

test('fallo al leer aplicaciones de servicio conserva Pascual en revisión', async () => {
    const { comp, detalle } = await compararEfectivoPascual({ fallarFinanzas: true });
    assert.equal(detalle.estado, 'revisar');
    assert.equal(comp.snapshot.efectivo_aplicado.disponible, false);
    assert.match(comp.snapshot.efectivo_aplicado.error, /No fue posible leer las aplicaciones de efectivo/);
});
