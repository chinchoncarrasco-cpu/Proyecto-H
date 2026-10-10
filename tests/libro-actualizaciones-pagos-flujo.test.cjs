const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const F = require('./fixtures/libro-actualizaciones-pagos-flujo.cjs');
global.HAIKU_LIBRO_SEMANTICA = require('../js/haiku-libro-semantica-v1.js');
const Q = require('../js/haiku-libro-consultas-v1.js');
async function escenario(opciones) {
    const f = F.crear(), db = F.cliente(f, opciones), aprobados = new Set(), decisiones = new Map();
    const comparacion = await Q.compararSistema(f.reservas, db, f.q);
    for (const g of comparacion.grupos) {
        const s = f.estadias.find(s => s.cabanas.numero === g.items[0].libro.cabana);
        if (s) decisiones.set(g.clave, { valor: 'asociar:' + s.id });
    }
    const result = { reservas: f.reservas, q: f.q, comparacion };
    const plan = await Q.prepararIncorporacion(result, decisiones, aprobados, db);
    return { f, db, aprobados, decisiones, result, plan };
}
function vista(db) {
    class Element {
        constructor(tag) { this.tag = tag; this.textContent = ''; this.children = []; this.events = {}; this.dataset = {}; this.style = {}; }
        append(...xs) { this.children.push(...xs); } replaceChildren(...xs) { this.children = xs; }
        addEventListener(k, f) { this.events[k] = f; } setAttribute(k, v) { this[k] = v; } removeAttribute(k) { delete this[k]; }
        querySelectorAll(s) { return this.children.flatMap(e => [e, ...e.querySelectorAll('*')]).filter(e => s === '*' || s === e.tag || s.startsWith('.') && (e.className || '').split(' ').includes(s.slice(1))); }
        querySelector(s) { return this.querySelectorAll(s)[0] || null; } get options() { return this.children; }
    }
    const context = { structuredClone, haikuSupabase: db, confirm: () => true, HAIKU_LIBRO_SEMANTICA: global.HAIKU_LIBRO_SEMANTICA,
        document: { createElement: t => new Element(t), querySelector: () => null, getElementById: () => null }, addEventListener() {},
        Option: function(t, v) { const e = new Element('option'); e.textContent = t; e.value = v; return e; } };
    const api = 'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'), 'utf8').replace(api, api.replace(' })', ', renderizarComparacion, renderizarIncorporacion })')), context);
    const out = new Element('div');
    return { Q: context.HAIKU_LIBRO_CONSULTAS, out, button: text => out.querySelectorAll('button').find(e => e.textContent === text),
        text: () => out.querySelectorAll('*').map(e => e.textContent).join(' ') };
}
test('cuatro actualizaciones seleccionables antes de los dos pagos dependientes', async () => {
    const h = await escenario(), v = vista(h.db);
    v.Q.renderizarIncorporacion(v.out, h.plan, () => {}, () => {}, () => {});
    assert.equal(h.plan.items.filter(i => i.payload?.tipo === 'reserva_actualizar' && i.seleccionado).length, 4);
    assert.equal(v.out.querySelectorAll('input').filter(i => i.type === 'checkbox' && !i.disabled).length, 6);
    assert.ok(h.plan.items.filter(i => i.pagoLibro).every(i => !i.aprobable && !i.seleccionado));
});
test('un conflicto queda pendiente; tres actualizaciones válidas habilitan sólo su pago independiente', async () => {
    const h = await escenario();
    await assert.rejects(Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, h.plan, h.db), e => e.code === 'HLI01');
    assert.equal(h.plan.solicitudPendiente, null);
    const nuevo = await Q.prepararIncorporacion(h.result, h.decisiones, h.aprobados, h.db);
    const conflicto = nuevo.items.find(i => i.payload?.reserva_id === 'reserva-ficticia-2');
    assert.equal(conflicto.categoria, 'pendientes'); assert.equal(conflicto.seleccionado, false);
    nuevo.items.forEach(i => { i.seleccionado = i.payload?.tipo === 'reserva_actualizar' && !i.motivos.length; });
    const guardado = await Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, nuevo, h.db);
    assert.equal(guardado.resultado.actualizaciones, 3); assert.equal(guardado.resultado.pagos_creados, 0);
    const pagos = await Q.prepararIncorporacion(h.result, h.decisiones, h.aprobados, h.db);
    const p1 = pagos.items.find(i => i.pagoLibro?.codigo_autorizacion === 'FICTICIO-AUT-1');
    const p2 = pagos.items.find(i => i.pagoLibro?.codigo_autorizacion === 'FICTICIO-AUT-2');
    assert.equal(p1.categoria, 'pagos'); assert.deepEqual(p1.dependeDe, []);
    assert.equal(p2.etapaSiguiente, true); assert.equal(p2.aprobable, false);
    const v = vista(h.db); v.Q.renderizarIncorporacion(v.out, pagos, () => {}, () => {}, () => {});
    assert.equal(v.out.querySelectorAll('input').find(i => i.checked && !i.disabled)?.type, 'checkbox');
    pagos.items.forEach(i => { i.seleccionado = i === p1; });
    await Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, pagos, h.db);
    assert.equal(h.db.pagos.length, 1);
    const repetido = await Q.prepararIncorporacion(h.result, h.decisiones, h.aprobados, h.db);
    assert.ok(repetido.items.some(i => i.categoria === 'omitidos' && i.id === p1.id));
});
test('retry de red conserva operación; cambiar selección no reenvía el lote anterior', async () => {
    const h = await escenario({ conflicto: -1 }); h.db.red = true;
    await assert.rejects(Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, h.plan, h.db), e => e.code === 'NETWORK');
    const primera = h.db.calls.at(-1); h.plan.items.find(i => i.seleccionado).seleccionado = false;
    await assert.rejects(Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, h.plan, h.db), /confirmación anterior.*pendiente/i);
    assert.equal(h.db.calls.length, 1);
    h.plan.items.filter(i => i.payload?.tipo === 'reserva_actualizar').forEach(i => i.seleccionado = true);
    await Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, h.plan, h.db);
    assert.equal(h.db.calls.at(-1).args.p_operacion_id, primera.args.p_operacion_id);
});
test('volver a comparar conserva desmarcados compatibles sin seleccionar pagos recién habilitados', async () => {
    const h = await escenario({ conflicto: -1 }), v = vista(h.db);
    v.Q.renderizarComparacion(v.out, h.result, { decisiones: h.decisiones, aprobados: h.aprobados });
    await v.button('Preparar incorporación').events.click();
    const inputs = v.out.querySelectorAll('input').filter(i => i.type === 'checkbox' && i.checked);
    assert.equal(inputs.length, 4);
    inputs[2].checked = false; inputs[2].events.change();
    await v.button('Volver').events.click();
    await v.button('Preparar incorporación').events.click();
    assert.equal(v.out.querySelectorAll('input').filter(i => i.type === 'checkbox' && i.checked).length, 3);
});
test('error legado permite corregir selección y confirmar sólo altas independientes sin forzar comparación', async () => {
    const h = await escenario({ legado: true }), v = vista(h.db);
    v.Q.renderizarIncorporacion(v.out, h.plan, () => {}, () => {}, p => Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, p, h.db));
    await v.button('Actualizar titular y RUT').events.click();
    assert.ok(v.button('Volver a comparar con datos actuales'));
    const inputs = v.out.querySelectorAll('input').filter(i => i.type === 'checkbox');
    for (const i of inputs.filter(i => i.checked)) { i.checked = false; i.events.change(); }
    for (const i of inputs.filter(i => !i.disabled).slice(0, 2)) { i.checked = true; i.events.change(); }
    const continuar = v.button('Continuar con 2 elementos listos'); assert.ok(continuar);
    await continuar.events.click();
    assert.ok(h.db.calls.at(-1).args.p_items.every(i => i.tipo === 'reserva_nueva'));
    assert.doesNotMatch(v.text(), /FICTICIO-PRIVADO/);
});
test('ambos pagos permanecen bloqueados ante una selección forzada antes de confirmar identidades', async () => {
    const h = await escenario();
    h.plan.items.forEach(i => i.seleccionado = !!i.pagoLibro);
    await assert.rejects(Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, h.plan, h.db), e => e.haikuConflictoDatos === true);
    assert.equal(h.db.calls.length, 0);
});
test('pago aparecido entretanto se omite al revalidar y nunca llega a otro writer', async () => {
    const h = await escenario({ conflicto: -1 });
    await Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, h.plan, h.db);
    const p = await Q.prepararIncorporacion(h.result, h.decisiones, h.aprobados, h.db);
    const pago = p.items.find(i => i.pagoLibro?.codigo_autorizacion === 'FICTICIO-AUT-1');
    p.items.forEach(i => i.seleccionado = i === pago);
    h.db.pagos.push({ id: 'externo-ficticio', reserva_id: 'reserva-ficticia-1', monto: 10000, moneda: 'CLP',
        medio_pago: 'webpay_debito', fecha_pago: '2026-10-13', estado: 'confirmado', codigo_autorizacion: 'FICTICIO-AUT-1' });
    await assert.rejects(Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, p, h.db), e => e.haikuConflictoDatos === true);
    assert.equal(h.db.calls.length, 1); assert.equal(h.db.pagos.length, 1);
});
test('datos cambiados tras la selección exigen comparación nueva y no una repetición de red', async () => {
    const h = await escenario({ conflicto: -1 });
    h.f.estadias[0].reservas.titular_nombre = 'Persona Externa Ficticia';
    await assert.rejects(Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, h.plan, h.db), e => e.code === 'HLC01' && e.haikuConflictoDatos === true);
    assert.equal(h.db.calls.length, 0);
});
test('volver a comparar descarta selección cuyo payload cambió; mantiene las otras tres', async () => {
    const h = await escenario({ conflicto: -1 }), v = vista(h.db);
    v.Q.renderizarComparacion(v.out, h.result, { decisiones: h.decisiones, aprobados: h.aprobados });
    await v.button('Preparar incorporación').events.click();
    h.f.estadias[0].reservas.titular_nombre = 'Persona Externa Ficticia';
    await v.button('Volver').events.click(); await v.button('Preparar incorporación').events.click();
    assert.equal(v.out.querySelectorAll('input').filter(i => i.type === 'checkbox' && i.checked).length, 3);
});
test('cambio de usuario no restaura las selecciones del usuario anterior', async () => {
    const h = await escenario({ conflicto: -1 }), v = vista(h.db);
    v.Q.renderizarComparacion(v.out, h.result, { decisiones: h.decisiones, aprobados: h.aprobados });
    await v.button('Preparar incorporación').events.click(); h.db.usuario = 'otro-usuario-ficticio';
    await v.button('Volver').events.click(); await v.button('Preparar incorporación').events.click();
    assert.equal(v.out.querySelectorAll('input').filter(i => i.type === 'checkbox' && i.checked).length, 0);
});
test('escritura confirmada y relectura fallida muestran el éxito real sin reenviar identidades', async () => {
    const h = await escenario({ conflicto: -1 }), v = vista(h.db), rpc = h.db.rpc;
    h.db.rpc = async (...args) => { const r = await rpc(...args); if (r.data?.ok) h.db.lecturaFallida = true; return r; };
    v.Q.renderizarComparacion(v.out, h.result, { decisiones: h.decisiones, aprobados: h.aprobados });
    await v.button('Preparar incorporación').events.click(); await v.button('Actualizar titular y RUT').events.click();
    assert.match(v.text(), /Incorporación completada/);
    assert.match(v.text(), /ya confirmó la operación.*No se pudo volver a leer/);
    assert.doesNotMatch(v.text(), /No se guardó nada|No se pudo confirmar/);
    assert.equal(h.db.calls.length, 1);
});
test('un cambio de reserva financiera después de la selección no redirige el pago silenciosamente', async () => {
    const h = await escenario({ conflicto: -1 });
    await Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, h.plan, h.db);
    const pagos = await Q.prepararIncorporacion(h.result, h.decisiones, h.aprobados, h.db);
    pagos.items.forEach(i => i.seleccionado = i.pagoLibro?.codigo_autorizacion === 'FICTICIO-AUT-1');
    h.f.estadias[0].reserva_id = 'otra-reserva-financiera-ficticia';
    await assert.rejects(Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, pagos, h.db), e => e.code === 'HLC01' && e.haikuConflictoDatos === true);
    assert.equal(h.db.calls.length, 1); assert.equal(h.db.pagos.length, 0);
});
test('un documento conflictivo sin item_id en un lote mixto no acusa otra actualización', async () => {
    const h = await escenario({ legado: true });
    h.plan.items.forEach(i => i.seleccionado = i.categoria === 'nuevas' || i.payload?.reserva_id === 'reserva-ficticia-2' && i.payload.tipo === 'reserva_actualizar');
    await assert.rejects(Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, h.plan, h.db), e => e.code === 'HLI01');
    const siguiente = await Q.prepararIncorporacion(h.result, h.decisiones, h.aprobados, h.db);
    assert.equal(siguiente.items.filter(i => i.conflictoIdentidad).length, 0);
});
test('una corrección necesaria de estadía precede al pago aunque titular y documento ya coincidan', async () => {
    const f = F.crear(); f.reservas = f.reservas.slice(0, 1); f.estadias = f.estadias.slice(0, 1);
    const r = f.reservas[0], s = f.estadias[0];
    Object.assign(s.reservas, { titular_nombre: r.titular, titular_numero_documento: r.rut_documento, titular_tipo_documento: 'pasaporte' });
    s.fecha_salida = '2026-10-16';
    const db = F.cliente(f, { conflicto: -1 }), comparacion = await Q.compararSistema(f.reservas, db, f.q);
    const decisiones = new Map([[comparacion.grupos[0].clave, { valor: 'actualizar:' + s.id }]]), aprobados = new Set();
    const result = { reservas: f.reservas, q: f.q, comparacion }, plan = await Q.prepararIncorporacion(result, decisiones, aprobados, db);
    const pago = plan.items.find(i => i.pagoLibro);
    assert.equal(plan.etapa, undefined); assert.equal(pago.etapaSiguiente, true); assert.equal(pago.aprobable, false);
    assert.ok(pago.dependeDe.length); assert.deepEqual(Q.serializarIncorporacion(plan).map(i => i.tipo), ['reserva_actualizar']);
    assert.equal((await Q.confirmarIncorporacion(result, decisiones, aprobados, plan, db)).resultado.pagos_creados, 0);
    const actualizado = await Q.prepararIncorporacion(result, decisiones, aprobados, db);
    assert.equal(actualizado.items.find(i => i.pagoLibro).categoria, 'pagos');
});
