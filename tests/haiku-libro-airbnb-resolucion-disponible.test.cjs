const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {ACCION} = require('./fixtures/libro-airbnb-confirmacion-manual.cjs');
const {SOLICITUD_AGUSTIN, hojaAgustinFocalizado} = require('./fixtures/libro-airbnb-agustin-focalizado.cjs');
const {PAGO_AGUSTIN_RUNTIME, resultadoAgustinRuntime} = require('./fixtures/libro-airbnb-agustin-runtime.cjs');

// Usa el plan y el render reales, con el mismo cliente en memoria del caso Agustin.
function entorno(options = {}) {
    class Element {
        constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; this.style = {}; this.textContent = ''; }
        append(...xs) { this.children.push(...xs); }
        appendChild(x) { this.append(x); }
        replaceChildren(...xs) { this.children = xs; }
        addEventListener(k, f) { this.events[k] = f; }
        setAttribute(k, v) { this[k] = v; }
        querySelectorAll(selector) {
            return this.children.flatMap(e => [e, ...e.querySelectorAll('*')]).filter(e => selector === '*' || selector === e.tag ||
                selector.startsWith('.') && (e.className || '').split(' ').includes(selector.slice(1)));
        }
        querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    }
    const context = {structuredClone, HAIKU_LIBRO_SEMANTICA: global.HAIKU_LIBRO_SEMANTICA,
        HAIKU_LIBRO_PAGOS_DESTINOS_V1: global.HAIKU_LIBRO_PAGOS_DESTINOS_V1,
        HAIKU_LIBRO_PAGOS_CANON_V1: global.HAIKU_LIBRO_PAGOS_CANON_V1,
        document: {createElement: t => new Element(t), querySelector: () => null}, addEventListener() {}};
    const api = 'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
    const source = fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'), 'utf8');
    assert.ok(source.includes(api));
    vm.runInNewContext(source.replace(api, api.replace(' })',
        ', renderizarItemIncorporacion, resolucionManualDisponible, propuestaConfirmacionAirbnb, contextoVisualPlanes, continuarVistaManualPago })')), context);
    const fixture = fs.readFileSync(require.resolve('./fixtures/libro-airbnb-confirmacion-manual.cjs'), 'utf8');
    vm.runInNewContext(fixture.slice(fixture.indexOf('const id ='), fixture.indexOf('module.exports=')) +
        '\nglobalThis.crearEntorno = entorno;', context);
    const h = context.crearEntorno(options), Q = h.Q;
    const approve = () => assert.fail('No debe aprobar genéricamente al abrir');
    approve.manualPago = () => assert.fail('No debe resolver al abrir');
    return {...h, context, approve,
        disponible: item => Q.resolucionManualDisponible(item),
        render: (item, plan) => Q.renderizarItemIncorporacion(item, new Map(), () => {}, approve, Q.contextoVisualPlanes.get(plan), plan)};
}
async function prepararFocalizado(h, tipoDestino = 'alojamiento', capturado = null) {
    const ctx = h.context, raw = capturado || ctx.HAIKU_LIBRO_SEMANTICA.normalizarHoja(hojaAgustinFocalizado(), 'Oct26');
    const campo = {value: SOLICITUD_AGUSTIN}, listeners = [];
    ctx.window = ctx; ctx.document.readyState = 'complete'; ctx.document.documentElement = {};
    ctx.document.getElementById = id => id === 'haiku-asistente-texto' ? campo : null;
    ctx.document.head = {appendChild() {}}; ctx.document.addEventListener = () => {};
    ctx.addEventListener = (tipo, handler) => {if (tipo === 'click') listeners.push(handler);};
    ctx.MutationObserver = class {observe() {}}; ctx.setInterval = () => 1; ctx.clearInterval = () => {};
    ctx.console = {info() {}};
    ctx.HAIKU_LIBRO_RESERVA_V1 = {...ctx.HAIKU_LIBRO_RESERVA_V1,
        listo: async () => {}, listarHojas: () => ['Oct26'], consultarHoja: async () => structuredClone(raw)};
    for (const name of ['haiku-libro-pagos-canon-v1', 'haiku-libro-lenguaje-natural-v1', 'haiku-libro-pagos-focalizados-v1'])
        vm.runInNewContext(fs.readFileSync(require.resolve('../js/' + name + '.js'), 'utf8'), ctx);
    const original = JSON.stringify(raw);
    for (const handler of listeners) handler({type: 'click', target: {closest: s => s === '#haiku-asistente-enviar' ? {} : null}});
    const efectivo = await ctx.HAIKU_LIBRO_RESERVA_V1.consultarHoja('Oct26');
    h.result.reservas = efectivo.reservas; h.result.q = {desde: '2026-10-14', hasta: '2026-10-15'};
    Object.assign(h.tablas.reserva_estadias[0], {fecha_ingreso: '2026-10-14', fecha_salida: '2026-10-15', tipo_estadia: tipoDestino});
    return {plan: await h.preparar(), raw, original, efectivo};
}
const pago = plan => plan.items.find(i => i.pagoLibro);
const boton = (fila, texto) => fila.querySelectorAll('button').find(e => e.textContent === texto);
const textos = fila => fila.querySelectorAll('*').map(e => e.textContent).join(' ');

test('aviso real sin nombre: parser deja el encabezado en pagos_sin_asociacion, pero el destino único permite resolver Airbnb', async () => {
    for (const focalizado of [false, true]) {
        const h = entorno(), raw = resultadoAgustinRuntime(h.context.HAIKU_LIBRO_SEMANTICA);
        assert.equal(raw.pagos[0].titular, 'El viajero ha pagado');
        assert.equal(raw.reservas[0].pagos.length, 0);
        assert.equal(raw.reservas[0].pagos_sin_asociacion[0], raw.pagos[0]);
        let plan;
        if (focalizado) ({plan} = await prepararFocalizado(h, 'alojamiento', raw));
        else {
            h.result.reservas = raw.reservas;
            h.result.q = {desde: '2026-10-14', hasta: '2026-10-15'};
            Object.assign(h.tablas.reserva_estadias[0], {fecha_ingreso: '2026-10-14', fecha_salida: '2026-10-15'});
            plan = await h.preparar();
        }
        const item = pago(plan), comp = h.Q.contextoVisualPlanes.get(plan);
        const x = comp.pagosDetalle.find(x => x.pago === item.pagoLibro);
        if (!focalizado) assert.equal(x.reserva.tipo_estadia, 'alojamiento');
        assert.equal(comp.find(r => r.libro === x.reserva).sistema.tipo_estadia, 'alojamiento');
        assert.equal(item.pagoLibro.texto_original, PAGO_AGUSTIN_RUNTIME.texto_original);
        assert.equal(item.pagoLibro.origen.celda, 'BC41:BF41');
        assert.equal(item.pagoLibro.tipo_movimiento, 'alojamiento');
        assert.equal(x.reserva.pagos.includes(item.pagoLibro), false);
        assert.equal(x.reserva.pagos_sin_asociacion.includes(item.pagoLibro), true);
        assert.equal(h.context.HAIKU_LIBRO_PAGOS_CANON_V1.medioDesdeTexto({...item.pagoLibro, medio_pago: null}), 'airbnb_prepaid_card');
        assert.deepEqual(Array.from(item.motivos), ['Requiere aprobación manual de la asociación y el pago.',
            'Falta la fecha del comprobante; no se usa la fecha del bloque como fecha de pago.']);
        assert.ok(h.Q.propuestaConfirmacionAirbnb(item, comp, h.context.HAIKU_LIBRO_RESERVA_V1.estado().generacion));
        assert.equal(item.aprobable, false);
        assert.equal(h.disponible(item), true);
        const original = JSON.stringify(plan), fila = h.render(item, plan);
        assert.ok(boton(fila, 'Aprobación manual'));
        boton(fila, 'Aprobación manual').events.click();
        const panel = fila.querySelector('.haiku-incorporacion-manual-pago-panel');
        assert.match(textos(panel), /Completar confirmación Airbnb/);
        assert.equal(panel.querySelectorAll('input').find(e => e.type === 'date').value, '');
        assert.equal(item.seleccionado, false);
        assert.equal(item.categoria, 'dudosos');
        assert.equal(JSON.stringify(plan), original);
        assert.equal(h.Q.serializarIncorporacion(plan).filter(i => i.tipo === 'pago').length, 0);
        assert.equal(h.llamadas.filter(x => x.nombre).length, 0);
        const preparado = pago(await h.resolver(plan, item));
        assert.equal(preparado.categoria, 'pagos');
        assert.equal(preparado.payload.argumentos.p_fecha_pago, ACCION.fecha);
        assert.equal(preparado.payload.argumentos.p_medio_pago, 'airbnb_prepaid_card');
        assert.equal(h.llamadas.filter(x => x.nombre).length, 0);
    }
});

test('el encabezado del aviso no permite resolver identidad conflictiva, filas ajenas, advertencias, duplicados ni evidencia insuficiente', async () => {
    for (const variante of ['titular ajeno', 'sin fila', 'CAB ajena', 'advertencia pago', 'advertencia reserva', 'origen repetido', 'evidencia insuficiente']) {
        const h = entorno(), raw = resultadoAgustinRuntime(h.context.HAIKU_LIBRO_SEMANTICA);
        const r = raw.reservas[0], p = r.pagos_sin_asociacion[0];
        if (variante === 'titular ajeno') p.titular = 'Roberto Perez';
        if (variante === 'sin fila') {
            r.pagos_sin_asociacion = [];
        }
        if (variante === 'CAB ajena') p.cabana = 5;
        if (variante === 'advertencia pago') p.advertencias = ['Identidad financiera requiere revisión.'];
        if (variante === 'advertencia reserva') r.advertencias = ['Identidad de la reserva requiere revisión.'];
        if (variante === 'origen repetido') r.pagos_sin_asociacion.push({...structuredClone(p), monto: p.monto + 1});
        if (variante === 'evidencia insuficiente') p.texto_original = 'El viajero ha pagado';
        h.result.reservas = raw.reservas;
        h.result.q = {desde: '2026-10-14', hasta: '2026-10-15'};
        Object.assign(h.tablas.reserva_estadias[0], {fecha_ingreso: '2026-10-14', fecha_salida: '2026-10-15'});
        const plan = await h.preparar(), item = pago(plan);
        if (variante === 'sin fila') assert.equal(item, undefined);
        else {
            assert.equal(item.manualPago, null, variante);
            assert.equal(h.disponible(item), false, variante);
            assert.equal(boton(h.render(item, plan), 'Aprobación manual'), undefined, variante);
        }
        assert.equal(h.llamadas.filter(x => x.nombre).length, 0);
    }
});

test('aviso real sin nombre mantiene las guardas de generación, SHA, permiso y pago existente', async () => {
    for (const variante of ['generación', 'SHA', 'permiso', 'pago existente']) {
        const h = entorno(), raw = resultadoAgustinRuntime(h.context.HAIKU_LIBRO_SEMANTICA);
        h.result.reservas = raw.reservas;
        h.result.q = {desde: '2026-10-14', hasta: '2026-10-15'};
        Object.assign(h.tablas.reserva_estadias[0], {fecha_ingreso: '2026-10-14', fecha_salida: '2026-10-15'});
        let plan = await h.preparar(), item = pago(plan);
        assert.equal(h.disponible(item), true);
        if (variante === 'generación') h.cambiarLibro();
        if (variante === 'SHA') h.cambiarVersion();
        if (variante === 'permiso') h.permisos.delete('pagos.registrar');
        if (variante === 'pago existente') {
            h.tablas.pagos.push({id: '00000000-0000-4000-8000-000000000050',
                reserva_id: h.tablas.reserva_estadias[0].reserva_id, monto: 165598, medio_pago: 'airbnb_prepaid_card',
                moneda: 'CLP', estado: 'confirmado', tipo_movimiento: 'pago', fecha_pago: '2026-10-12', datos_origen: {}});
            plan = await h.preparar(); item = pago(plan);
        }
        assert.equal(h.disponible(item), false, variante);
        assert.equal(boton(h.render(item, plan), 'Aprobación manual'), undefined, variante);
        assert.equal(item.seleccionado, false);
        assert.equal(h.llamadas.filter(x => x.nombre).length, 0);
    }
});

test('pagoLibro exacto de Edge BC41:BF41: evidencia válida, propuesta y botón sin aprobar, seleccionar ni escribir', async () => {
    const h = entorno({pagoExtra: PAGO_AGUSTIN_RUNTIME}), plan = await h.preparar(), item = pago(plan);
    const comp = h.Q.contextoVisualPlanes.get(plan);
    const x = comp.pagosDetalle.find(x => x.pago === item.pagoLibro);
    assert.equal(item.pagoLibro.texto_original, PAGO_AGUSTIN_RUNTIME.texto_original);
    assert.equal(item.pagoLibro.origen.celda, 'BC41:BF41');
    assert.equal(x.reserva.tipo_estadia, 'alojamiento');
    assert.equal(comp.find(r => r.libro === x.reserva).sistema.tipo_estadia, 'alojamiento');
    assert.equal(h.context.HAIKU_LIBRO_PAGOS_CANON_V1.medioDesdeTexto({...item.pagoLibro, medio_pago: null}), 'airbnb_prepaid_card');
    assert.ok(h.Q.propuestaConfirmacionAirbnb(item, comp, h.context.HAIKU_LIBRO_RESERVA_V1.estado().generacion));
    assert.equal(item.aprobable, false);
    assert.equal(h.disponible(item), true);
    assert.equal(Boolean(h.approve.manualPago && h.disponible(item)), true);
    assert.deepEqual(Array.from(item.motivos), ['Requiere aprobación manual de la asociación y el pago.',
        'Falta la fecha del comprobante; no se usa la fecha del bloque como fecha de pago.']);
    const before = JSON.stringify(plan), fila = h.render(item, plan);
    assert.ok(boton(fila, 'Aprobación manual'));
    boton(fila, 'Aprobación manual').events.click();
    const panel = fila.querySelector('.haiku-incorporacion-manual-pago-panel');
    assert.match(textos(panel), /Completar confirmación Airbnb/);
    assert.equal(panel.querySelectorAll('input').find(e => e.type === 'date').value, '');
    assert.equal(item.seleccionado, false);
    assert.equal(item.categoria, 'dudosos');
    assert.equal(h.Q.serializarIncorporacion(plan).filter(i => i.tipo === 'pago').length, 0);
    assert.equal(JSON.stringify(plan), before);
    assert.equal(h.llamadas.filter(x => x.nombre).length, 0);
});

test('Agustin CAB 4, $165.598 Airbnb sin fecha: resolver visible con aprobable=false; render y abrir no cambian el plan ni escriben', async () => {
    const h = entorno(), plan = await h.preparar(), item = pago(plan);
    const original = JSON.stringify(plan), libro = JSON.stringify(h.r);
    assert.equal(item.aprobable, false); assert.equal(item.seleccionado, false);
    assert.equal(h.disponible(item, plan), true);
    const fila = h.render(item, plan);
    assert.match(textos(fila), /Agustin Rampa Spinelli.*CAB 4.*165\.598/s);
    assert.match(textos(fila), /Airbnb Prepaid Card/);
    assert.match(textos(fila), /Falta la fecha del comprobante; no se usa la fecha del bloque como fecha de pago\./);
    const abrir = boton(fila, 'Aprobación manual'); assert.ok(abrir);
    const panel = fila.querySelector('.haiku-incorporacion-manual-pago-panel'); assert.equal(panel.hidden, true);
    abrir.events.click(); assert.equal(panel.hidden, false);
    assert.match(textos(panel), /Completar confirmación Airbnb/);
    assert.equal(panel.querySelectorAll('input').find(e => e.type === 'date').value, '');
    assert.equal(boton(panel, 'Completar confirmación Airbnb').disabled, true);
    assert.equal(item.categoria, 'dudosos'); assert.equal(item.payload.argumentos.p_fecha_pago, null);
    assert.equal(h.Q.serializarIncorporacion(plan).filter(i => i.tipo === 'pago').length, 0);
    assert.equal(JSON.stringify(plan), original); assert.equal(JSON.stringify(h.r), libro);
    assert.equal(h.aprobados.size, 0); assert.equal(h.decisiones.size, 0);
    assert.equal(h.llamadas.filter(x => x.nombre).length, 0);
});

test('Airbnb con reserva ambigua o monto inválido no ofrece resolver', async () => {
    for (const options of [{}, {pagoExtra: {monto: 0}}, {pagoExtra: {monto: -1}}, {pagoExtra: {monto: 1.5}}]) {
        const h = entorno(options);
        if (!options.pagoExtra) h.tablas.reserva_estadias.push({...structuredClone(h.tablas.reserva_estadias[0]), id: '00000000-0000-4000-8000-000000000003'});
        const plan = await h.preparar(), item = pago(plan);
        assert.equal(h.disponible(item, plan), false);
        assert.equal(boton(h.render(item, plan), 'Aprobación manual'), undefined);
        assert.equal(h.llamadas.filter(x => x.nombre).length, 0);
    }
});

test('Airbnb no ofrece una propuesta anterior si hay un motivo adicional que la fecha no resuelve', async () => {
    for (const motivo of ['Reserva ambigua.', 'Conflicto de identidad.', 'Monto desconocido.',
        'Pago duplicado o conflictivo.', 'Destino no verificable.', 'Otro bloqueo no resoluble.']) {
        const h = entorno(), plan = await h.preparar(), item = pago(plan);
        assert.equal(h.disponible(item, plan), true);
        item.motivos.push(motivo);
        const before = JSON.stringify(item);
        assert.equal(h.disponible(item, plan), false);
        assert.equal(boton(h.render(item, plan), 'Aprobación manual'), undefined);
        assert.equal(JSON.stringify(item), before);
    }
});

test('Airbnb con pago existente, evidencia insuficiente o destino no verificable no ofrece resolver', async () => {
    for (const variante of ['existente', 'evidencia', 'destino']) {
        const h = entorno(variante === 'evidencia' ? {pagoExtra: {texto_original: 'Airbnb'}} : {});
        if (variante === 'existente') h.tablas.pagos.push({id: '00000000-0000-4000-8000-000000000050',
            reserva_id: h.tablas.reserva_estadias[0].reserva_id, monto: 165598, medio_pago: 'airbnb_prepaid_card',
            moneda: 'CLP', estado: 'confirmado', tipo_movimiento: 'pago', fecha_pago: '2026-10-12', datos_origen: {}});
        if (variante === 'destino') h.tablas.reserva_estadias[0].reserva_id = 'sin-uuid';
        const plan = await h.preparar(), item = pago(plan);
        assert.equal(h.disponible(item, plan), false);
        assert.equal(boton(h.render(item, plan), 'Aprobación manual'), undefined);
    }
});

test('Airbnb con fecha del comprobante ya presente mantiene la aprobación normal, sin resolver fecha otra vez', async () => {
    const h = entorno({pagoExtra: {fecha_comprobante: ACCION.fecha}}), plan = await h.preparar(), item = pago(plan);
    assert.equal(h.disponible(item, plan), false); assert.equal(item.aprobable, true);
    const fila = h.render(item, plan);
    assert.equal(boton(fila, 'Aprobación manual'), undefined); assert.ok(boton(fila, 'Aprobar este pago'));
});

test('Airbnb confirmado pasa a preparados y conserva la vista de resultado, sin reabrir un formulario de fecha', async () => {
    const h = entorno(), first = await h.preparar(), item = pago(first), next = await h.resolver(first, item);
    const resuelto = pago(next); assert.equal(h.disponible(resuelto, next), false);
    h.Q.continuarVistaManualPago(first, next, item.id, ACCION);
    const fila = h.render(resuelto, next), panel = fila.querySelector('.haiku-incorporacion-manual-pago-panel');
    assert.equal(resuelto.categoria, 'pagos'); assert.equal(panel.dataset.paso, 'aprobado');
    assert.match(textos(panel), /Confirmación Airbnb completada/);
    assert.equal(panel.querySelectorAll('input').filter(e => e.type === 'date').length, 0);
    assert.equal(h.llamadas.filter(x => x.nombre).length, 0);
});

test('medios tradicionales conservan aprobable y el botón de aprobación existente', async () => {
    for (const medio of ['transferencia', 'efectivo', 'debito', 'credito', 'webpay_debito', 'webpay_credito']) {
        const h = entorno({pagoExtra: {medio_pago: medio, texto_original: 'Pago alojamiento', fecha_comprobante: ACCION.fecha}});
        const plan = await h.preparar(), item = pago(plan), before = JSON.stringify(item);
        assert.equal(h.disponible(item, plan), false); assert.equal(item.aprobable, true);
        const fila = h.render(item, plan);
        assert.equal(boton(fila, 'Aprobación manual'), undefined); assert.ok(boton(fila, 'Aprobar este pago'));
        assert.equal(JSON.stringify(item), before); assert.equal(h.llamadas.filter(x => x.nombre).length, 0);
    }
});

test('Agustin real 14/10/26 atraviesa el proxy focalizado: tipo del Libro null no oculta la resolución del destino verificado', async () => {
    const h = entorno(), {plan, raw, original, efectivo} = await prepararFocalizado(h), item = pago(plan);
    const comp = h.Q.contextoVisualPlanes.get(plan), x = comp.pagosDetalle.find(x => x.pago === item.pagoLibro);
    assert.equal(raw.reservas[0].coordenadas_origen.celda, 'BC6');
    assert.equal(raw.reservas[0].tipo_estadia, 'alojamiento');
    assert.equal(efectivo.reservas[0].tipo_estadia, null);
    assert.equal(efectivo.reservas[0].adultos, null); assert.equal(efectivo.reservas[0].texto_original, '');
    assert.equal(x.reserva.tipo_estadia, null); assert.equal(x.reserva.fecha_checkin, '2026-10-14');
    assert.equal(item.pagoLibro.evidencia_financiera.sector, 'pagos');
    assert.equal(item.payload.argumentos.p_medio_pago, 'airbnb_prepaid_card');
    assert.equal(item.payload.argumentos.p_monto, 165598); assert.equal(item.payload.argumentos.p_fecha_pago, null);
    assert.deepEqual(Array.from(item.motivos), ['Requiere aprobación manual de la asociación y el pago.',
        'Falta la fecha del comprobante; no se usa la fecha del bloque como fecha de pago.']);
    assert.equal(item.aprobable, false); assert.equal(h.disponible(item), true);
    const before = JSON.stringify(plan), fila = h.render(item, plan);
    assert.match(textos(fila), /14\/10\/26/); assert.ok(boton(fila, 'Aprobación manual'));
    boton(fila, 'Aprobación manual').events.click();
    const panel = fila.querySelector('.haiku-incorporacion-manual-pago-panel');
    assert.equal(panel.hidden, false); assert.match(textos(panel), /Completar confirmación Airbnb/);
    assert.equal(panel.querySelectorAll('input').find(e => e.type === 'date').value, '');
    assert.equal(item.seleccionado, false); assert.equal(item.categoria, 'dudosos');
    assert.equal(h.Q.serializarIncorporacion(plan).filter(i => i.tipo === 'pago').length, 0);
    assert.equal(JSON.stringify(plan), before); assert.equal(JSON.stringify(raw), original);
    assert.equal(h.llamadas.filter(x => x.nombre).length, 0);
});

test('tipo omitido por el proxy no permite resolver si el destino real es Full Day o tiene tipo desconocido', async () => {
    for (const tipo of ['full_day', 'fullday', null, 'desconocido']) {
        const h = entorno(), {plan} = await prepararFocalizado(h, tipo), item = pago(plan);
        assert.equal(item.manualPago, null); assert.equal(h.disponible(item), false);
        assert.equal(boton(h.render(item, plan), 'Aprobación manual'), undefined);
    }
});
