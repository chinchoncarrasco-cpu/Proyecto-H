// Datos exclusivamente sintéticos; no conecta con servicios externos.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const F = require('./fixtures/libro-actualizaciones-pagos-flujo.cjs');
const source = fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'), 'utf8');
const api = 'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
function vista(db) {
    class Element {
        constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; this.style = {}; this.textContent = ''; }
        append(...xs) { this.children.push(...xs); } replaceChildren(...xs) { this.children = xs; }
        addEventListener(k, f) { this.events[k] = f; } setAttribute(k, v) { this[k] = v; } removeAttribute(k) { delete this[k]; }
        querySelectorAll(s) { return this.children.flatMap(e => [e, ...e.querySelectorAll('*')]).filter(e => s === '*' || s === e.tag || s === 'details[open]' && e.tag === 'details' && e.open || s.startsWith('.') && (e.className || '').split(' ').includes(s.slice(1))); }
        querySelector(s) { return this.querySelectorAll(s)[0] || null; } get options() { return this.children; }
    }
    const context = { structuredClone, haikuSupabase: db, confirm: () => true,
        HAIKU_LIBRO_SEMANTICA: require('../js/haiku-libro-semantica-v1.js'),
        document: { createElement: t => new Element(t), querySelector: () => null, getElementById: () => null }, addEventListener() {},
        Option: function(t, v) { const e = new Element('option'); e.textContent = t; e.value = v; return e; } };
    assert.ok(source.includes(api));
    vm.runInNewContext(source.replace(api, api.replace(' })', ', renderizarComparacion, renderizarIncorporacion, restaurarSeleccionIncorporacion, contextoDetalleIncorporacion, detalleResultadoIncorporacion, ENTRADA_ESTRUCTURADA })')), context);
    const out = new Element('div'), text = e => e.querySelectorAll('*').map(x => x.textContent).join(' ');
    return { Q: context.HAIKU_LIBRO_CONSULTAS, context, out, text: () => text(out),
        receipt: () => out.querySelector('.haku-incorporacion-actualizacion-completada'), receiptText() { return text(this.receipt()); },
        button: t => out.querySelectorAll('button').find(e => e.textContent === t),
        render(plan) { this.Q.renderizarIncorporacion(out, plan, () => {}, () => {}, () => {}); } };
}
async function escenario(opciones = { conflicto: -1 }, configurar = () => {}) {
    const f = F.crear(); configurar(f);
    const db = F.cliente(f, opciones), v = vista(db), decisiones = new Map(), aprobados = new Set();
    const comparacion = await v.Q.compararSistema(f.reservas, db, f.q);
    for (const g of comparacion.grupos) {
        const s = f.estadias.find(s => s.cabanas.numero === g.items[0].libro.cabana);
        if (s) decisiones.set(g.clave, { valor: 'asociar:' + s.id });
    }
    const result = { reservas: f.reservas, q: f.q, comparacion }, preparar = () => v.Q.prepararIncorporacion(result, decisiones, aprobados, db);
    const plan = await preparar();
    return { f, db, v, decisiones, aprobados, result, plan, preparar,
        confirmar: p => v.Q.confirmarIncorporacion(result, decisiones, aprobados, p, db),
        async continuar(anterior = plan) { const nuevo = v.Q.restaurarSeleccionIncorporacion(await preparar(), anterior); v.render(nuevo); return nuevo; },
        async abrir() { v.Q.renderizarComparacion(v.out, result, { decisiones, aprobados }); await v.button('Preparar incorporación').events.click(); },
    };
}
test('guardado confirmado muestra cuatro reservas y sólo los campos enviados, encima de pagos sin registrarlos', async () => {
    const h = await escenario(); await h.abrir(); await h.v.button('Actualizar titular y RUT').events.click();
    assert.ok(h.v.receipt()); assert.match(h.v.receiptText(), /Actualización completada.*4 actualizaciones confirmadas.*Detalle de las actualizaciones/);
    const rows = h.v.receipt().querySelectorAll('.haku-incorporacion-final-item'); assert.equal(rows.length, 4);
    for (let i = 1; i <= 4; i++) {
        assert.match(h.v.receiptText(), new RegExp(`Persona Ficticia Libro ${i}`)); assert.match(h.v.receiptText(), new RegExp(`CAB ${i}`));
        assert.match(h.v.receiptText(), new RegExp(`Nombre: Persona Ficticia Proyecto ${i} → Persona Ficticia Libro ${i}`));
        assert.match(h.v.receiptText(), new RegExp(`RUT/pasaporte: FICTICIO-PROYECTO-${i} → FICTICIO-LIBRO-${i}`));
    }
    assert.doesNotMatch(h.v.receiptText(), /Adultos:|Pagos incorporados|registrados/);
    assert.match(h.v.text(), /Paso 2 de 2 · Aprobar pagos/);
    assert.ok(h.v.out.children.indexOf(h.v.receipt()) < h.v.out.children.indexOf(h.v.out.querySelector('.haku-incorporacion-sites-cabecera')));
    assert.equal(h.db.calls.length, 1); assert.equal(h.db.pagos.length, 0);
    assert.equal(h.v.out.querySelectorAll('input').filter(i => i.type === 'checkbox' && i.checked).length, 0);
});
test('detalle usa antes/después exactos del envío, nunca una etiqueta o comparación posterior', async () => {
    const h = await escenario(), guardado = await h.confirmar(h.plan);
    h.f.reservas[0].titular = 'Persona Ficticia Otra Comparación'; h.plan.items.forEach(i => { i.texto = 'Etiqueta posterior ficticia'; });
    const nuevo = h.v.Q.restaurarSeleccionIncorporacion(await h.preparar(), h.plan); h.v.render(nuevo);
    assert.match(h.v.receiptText(), /Nombre: Persona Ficticia Proyecto 1 → Persona Ficticia Libro 1/);
    assert.doesNotMatch(h.v.receiptText(), /Otra Comparación|Etiqueta posterior/);
    assert.equal(guardado.detalle.actualizaciones.length, 4); assert.equal(h.db.calls.length, 1);
});
test('confirmación parcial conserva conflicto y pago dependiente bloqueado fuera del comprobante', async () => {
    const h = await escenario({ conflicto: 1 });
    await assert.rejects(h.confirmar(h.plan), e => e.code === 'HLI01');
    const plan = await h.preparar(); await h.confirmar(plan); const siguiente = await h.continuar(plan);
    assert.equal(h.v.receipt().querySelectorAll('.haku-incorporacion-final-item').length, 3);
    assert.doesNotMatch(h.v.receiptText(), /Persona Ficticia Libro 2|CAB 2/);
    const bloqueado = siguiente.items.find(i => i.pagoLibro?.codigo_autorizacion === 'FICTICIO-AUT-2');
    assert.equal(bloqueado.etapaSiguiente, true); assert.equal(bloqueado.seleccionado, false); assert.equal(bloqueado.aprobable, false);
    assert.match(h.v.text(), /revisión humana/); assert.equal(h.db.pagos.length, 0);
});
test('omisión contractual se distingue de las tres actualizaciones realmente confirmadas', async () => {
    const h = await escenario(), rpc = h.db.rpc;
    h.db.rpc = async (n, a) => {
        const omitido = a.p_items[0], r = await rpc(n, { ...a, p_items: a.p_items.slice(1) });
        r.data.omitidos = 1; r.data.detalle_omitidos = [{ item_id: omitido.item_id, tipo: omitido.tipo, motivo: 'Ya coincide; omitido ficticio.' }]; return r;
    };
    await h.confirmar(h.plan); await h.continuar();
    const grupos = h.v.receipt().querySelectorAll('details'), actual = grupos.find(g => g.dataset.categoria === 'actualizaciones'), omitido = grupos.find(g => g.dataset.categoria === 'omitidos');
    assert.equal(actual.querySelectorAll('.haku-incorporacion-final-item').length, 3);
    assert.match(actual.querySelector('summary').textContent, /\(3\)/);
    assert.doesNotMatch(actual.querySelectorAll('*').map(e => e.textContent).join(' '), /Persona Ficticia Libro 1/);
    assert.match(omitido.querySelector('summary').textContent, /\(1\)/); assert.match(h.v.receiptText(), /Ya coincide; omitido ficticio/);
});
test('error rechazado y respuesta incierta no generan confirmación visual; retry recupera una sola evidencia', async () => {
    for (const incierta of [false, true]) {
        const h = await escenario(incierta ? { conflicto: -1 } : { conflicto: 1 });
        if (incierta) h.db.red = true;
        await assert.rejects(h.confirmar(h.plan)); h.v.render(h.plan); assert.equal(h.v.receipt(), null);
        if (incierta) {
            await h.confirmar(h.plan); await h.continuar();
            assert.equal(h.v.out.querySelectorAll('.haku-incorporacion-actualizacion-completada').length, 1);
            assert.equal(h.db.calls[0].args.p_operacion_id, h.db.calls[1].args.p_operacion_id);
        }
    }
});
test('escritura ejecutada sin respuesta no se anuncia hasta recuperar el resultado idempotente', async () => {
    const h = await escenario(), rpc = h.db.rpc; let interrumpir = true;
    h.db.rpc = async (...a) => { const r = await rpc(...a); if (interrumpir) { interrumpir = false; throw Error('Respuesta interrumpida ficticia'); } return r; };
    await assert.rejects(h.confirmar(h.plan)); h.v.render(h.plan); assert.equal(h.v.receipt(), null);
    assert.equal(h.db.operaciones.size, 1); await h.confirmar(h.plan); await h.confirmar(h.plan); await h.continuar();
    assert.equal(h.db.operaciones.size, 1); assert.equal(h.v.receipt().querySelectorAll('.haku-incorporacion-final-item').length, 4);
    assert.match(h.v.receiptText(), /\(4\)/);
});
test('rerenders, cambios de selección y volver a preparar preservan el comprobante sin nuevos writers', async () => {
    const h = await escenario(); await h.abrir(); await h.v.button('Actualizar titular y RUT').events.click();
    const texto = h.v.receiptText(), check = h.v.out.querySelectorAll('input').find(i => i.type === 'checkbox' && !i.disabled);
    check.checked = true; check.events.change(); assert.equal(h.v.receiptText(), texto);
    await h.v.button('Volver').events.click(); assert.equal(h.v.receiptText(), texto);
    await h.v.button('Preparar incorporación').events.click();
    assert.equal(h.v.receiptText(), texto); assert.match(h.v.text(), /Paso 2 de 2 · Aprobar pagos/); assert.equal(h.db.calls.length, 1);
});
test('aprobación manual conserva evidencia, selección y verificación previa; no registra el pago al aprobar', async () => {
    const h = await escenario({ conflicto: -1 }, f => {
        for (const r of f.reservas.slice(0, 2)) { r.pagos[0].codigo_autorizacion = null; r.pagos[0].medio_pago = 'efectivo'; }
    });
    await h.abrir(); await h.v.button('Actualizar titular y RUT').events.click();
    assert.ok(h.v.receipt()); const texto = h.v.receiptText();
    const aprobar = h.v.button('Aprobar 2 pagos revisables'); assert.ok(aprobar); await aprobar.events.click();
    assert.equal(h.v.receiptText(), texto); assert.match(h.v.text(), /Paso 2 de 2 · Aprobar pagos/);
    assert.equal(h.v.out.querySelectorAll('input').filter(i => i.type === 'checkbox' && i.checked).length, 2);
    assert.equal(h.db.pagos.length, 0); assert.equal(h.db.calls.length, 1);
});
test('otra consulta, otro usuario o generación no heredan evidencia del flujo anterior', async () => {
    const h = await escenario(); await h.confirmar(h.plan);
    const nuevo = await h.preparar(); h.v.render(nuevo); assert.equal(h.v.receipt(), null);
    for (const contextoSeleccion of [{ usuario: 'otra-sesion-ficticia' }, { ...h.plan.contextoSeleccion, generacion: 2 }]) {
        nuevo.contextoSeleccion = contextoSeleccion; h.v.Q.restaurarSeleccionIncorporacion(nuevo, h.plan); h.v.render(nuevo); assert.equal(h.v.receipt(), null);
    }
    h.v.render({ ...h.plan, actualizacionesConfirmadas: 4 }); assert.equal(h.v.receipt(), null, 'contadores públicos no fabrican comprobantes');
});
test('relectura fallida conserva detalle confirmado y aviso, sin afirmar paso de pagos habilitado', async () => {
    const h = await escenario(), rpc = h.db.rpc;
    h.db.rpc = async (...a) => { const r = await rpc(...a); if (r.data?.ok) h.db.lecturaFallida = true; return r; };
    await h.abrir(); await h.v.button('Actualizar titular y RUT').events.click();
    assert.match(h.v.text(), /Incorporación completada/); assert.match(h.v.text(), /No se pudo volver a leer los pagos/);
    assert.match(h.v.text(), /Nombre: Persona Ficticia Proyecto 1 → Persona Ficticia Libro 1/);
    assert.doesNotMatch(h.v.text(), /Paso 2 de 2|No se guardó nada/); assert.equal(h.db.calls.length, 1);
    h.db.lecturaFallida = false; await h.v.button('Volver a la comparación').events.click(); await h.v.button('Preparar incorporación').events.click();
    assert.ok(h.v.receipt()); assert.match(h.v.text(), /Paso 2 de 2 · Aprobar pagos/); assert.equal(h.db.calls.length, 1);
});
test('al finalizar pagos, otra operación no reutiliza el comprobante de identidad', async () => {
    const h = await escenario(); await h.abrir(); await h.v.button('Actualizar titular y RUT').events.click();
    const inputs = h.v.out.querySelector('.haiku-incorporacion-seccion--pagos').querySelectorAll('input').filter(i => i.type === 'checkbox' && !i.disabled);
    for (const i of inputs) { i.checked = true; i.events.change(); }
    await h.v.button('Continuar con 2 elementos listos').events.click();
    assert.equal(h.db.pagos.length, 2); await h.v.button('Volver a la comparación').events.click(); await h.v.button('Preparar incorporación').events.click();
    assert.equal(h.v.receipt(), null);
});
test('contador confirmado sin filas atribuibles informa detalle no disponible en vez de inventarlo', async () => {
    const h = await escenario(), rpc = h.db.rpc;
    h.db.rpc = async (...a) => { const r = await rpc(...a); r.data.resultados = [{ item_id: 'ajeno-ficticio', tipo: 'reserva_actualizar' }]; return r; };
    await h.confirmar(h.plan); await h.continuar();
    assert.match(h.v.receiptText(), /4 elementos sin detalle individual disponible/);
    assert.equal(h.v.receipt().querySelectorAll('.haku-incorporacion-final-item').length, 0);
});
test('antes desconocido muestra sólo lo nuevo; null conocido permite indicar sin dato, sin campos opcionales ajenos', async () => {
    const h = await escenario();
    const enviado = { item_id:'parche-ficticio',tipo:'reserva_actualizar',reserva_id:'reserva-ficticia-1',
        reserva:{antes:{titular_tipo_documento:null},despues:{titular_nombre:'Persona Ficticia',titular_tipo_documento:'pasaporte'}},
        estadia:{antes:{adultos:1},despues:{adultos:2}} };
    const contexto = h.v.Q.contextoDetalleIncorporacion([enviado], { items:[{ id:enviado.item_id,
        texto:'CAB 1 · Persona Ficticia',cambios:[{campo:'Teléfono',libro:'CAMBIO-NO-ENVIADO-FICTICIO'}],payload:enviado }] });
    const detalle = h.v.Q.detalleResultadoIncorporacion({ items:[enviado],detalleContexto:contexto },
        { ok:true,actualizaciones:1,resultados:[{ item_id:enviado.item_id,tipo:enviado.tipo,reserva_id:enviado.reserva_id }] });
    assert.match(detalle.actualizaciones[0].descripcion, /Nombre: Persona Ficticia · Tipo de documento: sin dato → pasaporte · Adultos: 1 → 2/);
    assert.doesNotMatch(detalle.actualizaciones[0].descripcion, /Nombre:.*→.*Persona Ficticia|CAMBIO-NO-ENVIADO/);
});
test('cero actualizaciones, resultado no contractual o resultado contradictorio nunca inventan una reserva actualizada', async () => {
    for (const tipo of ['cero','ok-no-contractual','destino-distinto','estadia-distinta','omitido-y-confirmado','fila-duplicada']) {
        const h = await escenario(), rpc = h.db.rpc;
        h.db.rpc = async (...a) => {
            const r = await rpc(...a);
            if (tipo === 'cero') { r.data.actualizaciones = 0; r.data.omitidos = 4; }
            if (tipo === 'ok-no-contractual') r.data.ok = 'sí';
            if (tipo === 'destino-distinto') r.data.resultados.forEach(x => { x.reserva_id = 'destino-ajeno-ficticio'; });
            if (tipo === 'estadia-distinta') r.data.resultados.forEach(x => { x.estadia_id = 'estadia-ajena-ficticia'; });
            if (tipo === 'omitido-y-confirmado') { r.data.omitidos = 4; r.data.detalle_omitidos = r.data.resultados; }
            if (tipo === 'fila-duplicada') r.data.resultados.push(...r.data.resultados);
            return r;
        };
        await h.confirmar(h.plan); await h.continuar();
        if (['cero','ok-no-contractual'].includes(tipo)) assert.equal(h.v.receipt(), null);
        if (['destino-distinto','estadia-distinta','omitido-y-confirmado'].includes(tipo)) {
            const grupo = h.v.receipt().querySelectorAll('details').find(g => g.dataset.categoria === 'actualizaciones');
            assert.equal(grupo.querySelectorAll('.haku-incorporacion-final-item').length, 0);
        }
        if (tipo === 'fila-duplicada') assert.equal(h.v.receipt().querySelectorAll('.haku-incorporacion-final-item').length, 4);
    }
});
test('selección individual confirma una reserva; siguientes lotes acumulan sólo escrituras confirmadas del mismo flujo', async () => {
    const h = await escenario();
    h.plan.items.forEach(i => { i.seleccionado = i.payload?.reserva_id === 'reserva-ficticia-1' && i.payload.tipo === 'reserva_actualizar'; });
    await h.confirmar(h.plan); const siguiente = await h.continuar();
    assert.match(h.v.receiptText(), /1 actualización confirmada/);
    assert.equal(h.v.receipt().querySelectorAll('.haku-incorporacion-final-item').length, 1);
    assert.doesNotMatch(h.v.receiptText(), /Persona Ficticia Libro [234]/);
    siguiente.items.forEach(i => { i.seleccionado = i.payload?.tipo === 'reserva_actualizar'; });
    await h.confirmar(siguiente); await h.continuar(siguiente);
    assert.match(h.v.receiptText(), /4 actualizaciones confirmadas/);
    assert.equal(h.v.receipt().querySelectorAll('.haku-incorporacion-final-item').length, 4);
    assert.equal(h.db.operaciones.size, 2); assert.equal(h.db.pagos.length, 0);
});
test('fallo posterior al aprobar conserva evidencia, retira controles de pagos y permite revalidar sin repetir escrituras', async () => {
    const h = await escenario({ conflicto:-1 }, f => {
        for (const r of f.reservas.slice(0,2)) { r.pagos[0].codigo_autorizacion = null; r.pagos[0].medio_pago = 'efectivo'; }
    });
    await h.abrir(); await h.v.button('Actualizar titular y RUT').events.click(); const texto = h.v.receiptText();
    h.db.lecturaFallida = true; await h.v.button('Aprobar 2 pagos revisables').events.click();
    assert.equal(h.v.receiptText(), texto); assert.match(h.v.text(), /No se pudo actualizar la comparación/);
    assert.doesNotMatch(h.v.text(), /Paso 2 de 2/); assert.equal(h.v.out.querySelectorAll('input').length, 0);
    assert.equal(h.db.calls.length, 1); assert.equal(h.db.pagos.length, 0);
    h.db.lecturaFallida = false; await h.v.button('Volver a comparar con datos actuales').events.click();
    assert.equal(h.v.receiptText(), texto); await h.v.button('Preparar incorporación').events.click();
    assert.equal(h.v.receiptText(), texto); assert.equal(h.db.calls.length, 1);
});
test('cambiar de sesión al volver a comparar elimina el comprobante visible antes de preparar otra operación', async () => {
    const h = await escenario(); await h.abrir(); await h.v.button('Actualizar titular y RUT').events.click();
    assert.ok(h.v.receipt()); h.db.usuario = 'otra-sesion-ficticia';
    await h.v.button('Volver').events.click(); assert.equal(h.v.receipt(), null);
    await h.v.button('Preparar incorporación').events.click(); assert.equal(h.v.receipt(), null);
});
test('revalidación explícita del mismo informe conserva comprobante y selección compatible con lecturas nuevas', async () => {
    const h = await escenario(); h.v.context.HAIKU_LIBRO_RESERVA_V1 = { estado:() => ({generacion:1}) };
    h.result.generacion = 1; h.result[h.v.Q.ENTRADA_ESTRUCTURADA] = true;
    await h.abrir(); await h.v.button('Actualizar titular y RUT').events.click(); const texto = h.v.receiptText();
    const check = h.v.out.querySelector('.haiku-incorporacion-seccion--pagos').querySelector('input');
    check.checked = true; check.events.change();
    await h.v.button('Volver').events.click(); await h.v.button('Revalidar contra Proyecto H').events.click();
    assert.equal(h.v.receiptText(), texto); assert.match(h.v.text(), /Revalidación completada/);
    await h.v.button('Preparar incorporación').events.click(); assert.equal(h.v.receiptText(), texto);
    assert.equal(h.v.out.querySelectorAll('input').filter(i => i.type === 'checkbox' && i.checked).length, 1);
    assert.equal(h.db.calls.length, 1); assert.equal(h.db.pagos.length, 0);
});
