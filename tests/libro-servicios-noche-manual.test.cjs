const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/haiku-libro-servicios-scope-v2.js'), 'utf8');
const copy = x => JSON.parse(JSON.stringify(x));
const textoYenny = 'TÓNEL A LAS 19:15 X PAGAR / CAB 6 YA ENTREGO SUS BATAS A RECEPCION';
function entorno() {
    const r = { titular: 'Yenny Acuña Berrios', cabana: 6, fecha_checkin: '2026-09-04', fecha_checkout: '2026-09-06', noches: 2, adultos: 2,
        tipo_estadia: 'alojamiento', texto_original: textoYenny, coordenadas_origen: { hoja: 'Sep26', celda: 'O8' },
        servicios: [{ concepto: 'tonel', texto_original: textoYenny, hora: '19:15' }] };
    const db = { reserva_estadias: [{ id: 'e1', reserva_id: 'r1', cabana_id: 'c6', fecha_ingreso: r.fecha_checkin, fecha_salida: r.fecha_checkout }],
        reservas: [{ id: 'r1', titular_nombre: r.titular }], cabanas: [{ id: 'c6', numero: 6 }], servicios: [], notas: [] };
    const state = { r, db, generacion: 1, calls: [], lecturas: 0 };
    class Element {
        constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; this.style = {}; this.dataset = {}; }
        append(...els) { this.children.push(...els); els.forEach(el => el.parentElement = this); } appendChild(el) { this.append(el); }
        setAttribute(k, v) { this[k] = v; } addEventListener(k, fn) { this.listeners[k] = fn; }
        replaceChildren(...els) { this.children = []; this.append(...els); }
        get isConnected() { return true; }
        get classList() { return { contains: cls => (this.className || '').split(' ').includes(cls) }; }
        matches(selector) {
            if (selector.includes(',')) return selector.split(',').some(s => this.matches(s.trim()));
            const parts = selector.trim().split(/\s+/);
            if (parts.length > 1) return this.matches(parts.at(-1)) && Boolean(this.parentElement?.closest(parts.slice(0, -1).join(' ')));
            if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
            if (selector.startsWith('#')) return this.id === selector.slice(1);
            if (!selector.startsWith(this.tag)) return false;
            if (selector.includes('data-haku-item-id') && !this.dataset.hakuItemId) return false;
            if (selector.includes('checkbox') && this.type !== 'checkbox') return false;
            if (selector.includes(':checked') && !this.checked) return false;
            if (selector.includes(':not(:disabled)') && this.disabled) return false;
            return true;
        }
        closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
        querySelectorAll(selector) { if (selector === ':scope > details') return this.children.filter(x => x.tag === 'details'); return this.children.flatMap(x => [...(x.matches(selector) ? [x] : []), ...x.querySelectorAll(selector)]); }
        set textContent(v) { this.text = v; this.children = []; } get textContent() { return (this.text || '') + this.children.map(x => x.textContent).join(''); }
    }
    const captures = [], document = { createElement: t => new Element(t), getElementById: () => null, head: new Element('head'),
        addEventListener: (type, fn, capture) => captures.push({ type, fn, capture }), querySelectorAll: selector => document.card?.querySelectorAll(selector) || [] };
    const c = { document, queueMicrotask, addEventListener() {}, confirm: () => { state.calls.push('confirm'); return false; },
        HAIKU_LIBRO_RESERVA_V1: { listo: async () => {}, estado: () => ({ cargado: true, nombre: 'fixture.xlsx', generacion: state.generacion }),
            listarHojas: () => ['Sep26'], consultarHoja: async () => { state.lecturas++; return { reservas: [copy(r)] }; } },
        haikuSupabase: { from: tabla => { const q = { select: () => q, lte: () => q, gte: () => q, in: () => q, eq: () => q,
            then: (ok, fail) => Promise.resolve({ data: copy(db[tabla]), error: null }).then(ok, fail) }; return q; },
            rpc: () => { state.calls.push('rpc'); throw Error('Prohibida escritura en test'); } } };
    vm.createContext(c);
    state.importaciones = 0;
    c.registrarImportacion = () => state.importaciones++;
    vm.runInContext(source.replace('const ids = [...seleccionados];', 'registrarImportacion(); const ids = [...seleccionados];').replace('const api = Object.freeze({', 'const api = Object.freeze({prepararServicio, nochesValidas, aplicarNocheManual, crearItem, renderizar, importarSeleccionados,'), c);
    const cargarGuard = () => vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/haiku-libro-confirm-cancel-fix-v1.js'), 'utf8'), c);
    const click = async target => {
        const event = { target, type: 'click', preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; } };
        for (const listener of captures.filter(x => x.type === 'click' && x.capture)) { listener.fn(event); if (event.stopped) break; }
        if (!event.stopped) await target.listeners.click?.(event);
        await new Promise(resolve => setImmediate(resolve));
    };
    return { ...state, state, api: c.HAIKU_LIBRO_SERVICIOS_SCOPE_V2, document, Element, cargarGuard, click };
}
const consulta = 'incorpora servicios del Libro septiembre 2026';
const consultaComparacion = 'Libro: compara servicios de septiembre 2026 con Proyecto H';
const asociacion = { estado: 'asociada', sistema: { reserva_id: 'r1', id: 'e1' } };
function preparar(e, texto, extra = {}) { return e.api.prepararServicio(e.r, { concepto: 'jacuzzi', texto_original: texto, hora: '19:15', ...extra }, asociacion); }
async function elegir(e) {
    const result = await e.api.construir(consulta), item = result.items.find(x => x.kind === 'servicio');
    const overrides = new Map([[item.item_id, { noche_indice: 2, firma: item.firmaNoche }]]);
    return { item, overrides };
}

test('Isabel: segunda noche and numeric ordinal variants resolve only within the stay', () => {
    const e = entorno();
    const isabel = preparar(e, 'PROMO HAIKU SEGUNDA NOCHE, TINAJA JACUZZI A LAS 19,15 HRS CORTESIA- ENTREGAR BATAS.');
    assert.equal(isabel.fecha, '2026-09-05'); assert.equal(isabel.cortesia, true); assert.equal(isabel.razones.length, 0);
    for (const t of ['primera noche', '1ra noche', '1era noche', 'noche 1']) assert.equal(preparar(e, t).fecha, '2026-09-04', t);
    for (const t of ['segunda noche', '2da noche', 'noche 2']) assert.equal(preparar(e, t).fecha, '2026-09-05', t);
    assert.equal(preparar(e, 'noche 3').fecha, null);
    e.r.noches = 3; e.r.fecha_checkout = '2026-09-07';
    assert.equal(preparar(e, 'noche 3').fecha, '2026-09-06');
    assert.equal(preparar(e, 'tercera noche').fecha, '2026-09-06');
    assert.equal(preparar(e, '3ra noche').fecha, '2026-09-06');
    assert.equal(preparar(e, 'segunda tinaja').fecha, null);
});

test('date contradictions, nonexistent nights and multiple ordinals never enable manual selection', () => {
    const e = entorno();
    assert.equal(preparar(e, 'segunda noche el 05-09').fecha, '2026-09-05');
    for (const t of ['segunda noche el 04-09', 'noche 3', 'primera noche y segunda noche']) {
        const item = preparar(e, t); assert.equal(item.fecha, null); assert.equal(item.puedeElegirNoche, false); assert.ok(item.razones.length);
    }
    const morning = preparar(e, 'segunda noche', { hora: '10:00' }); assert.equal(morning.fecha, '2026-09-06');
    assert.equal(preparar(e, 'segunda noche', { hora: '13:00' }).fecha, null);
});

test('Yenny manual index survives rebuilding; no write occurs and only actual nights appear', async () => {
    const e = entorno(), { item, overrides } = await elegir(e);
    assert.equal(item.estado, 'revisar'); assert.equal(item.puedeElegirNoche, true);
    assert.deepEqual(copy(item.opcionesNoches), [{ noche_indice: 1, fecha: '2026-09-04' }, { noche_indice: 2, fecha: '2026-09-05' }]);
    const actual = await e.api.construir(consulta, overrides), listo = actual.items.find(x => x.kind === 'servicio');
    assert.equal(listo.estado, 'listo'); assert.equal(listo.fecha, '2026-09-05'); assert.equal(listo.nocheManual, 2);
    assert.match(listo.inferencias.join(' '), /Fecha confirmada: Noche 2/);
    await e.api.importarSeleccionados(new Set([listo.item_id]), new e.Element('div'), consulta, overrides);
    assert.deepEqual(e.calls, ['confirm']); // Explicit confirmation refused: no writer call.
});

test('changes to book, stay, service, identity or night index invalidate evidence and prevent writing', async () => {
    for (const mutate of [e => e.state.generacion++, e => e.r.noches++, e => e.r.fecha_checkout = '2026-09-07',
        e => e.r.servicios[0].hora = '20:00', e => e.r.servicios[0].texto_original += ' cambiado',
        e => e.db.reservas[0].titular_nombre = 'Otra Persona', e => e.db.reserva_estadias[0].id = 'otra-estadia',
        e => e.r.adultos++, e => e.r.texto_original += ' otra nota']) {
        const e = entorno(), { item, overrides } = await elegir(e); mutate(e);
        await assert.rejects(e.api.importarSeleccionados(new Set([item.item_id]), new e.Element('div'), consulta, overrides), /cambiaron/);
        assert.equal(overrides.values().next().value.invalidada, true); assert.deepEqual(e.calls, []);
        await assert.rejects(e.api.importarSeleccionados(new Set([item.item_id]), new e.Element('div'), consulta, overrides), /cambiaron/);
    }
    const e = entorno(), { overrides } = await elegir(e); overrides.values().next().value.noche_indice = 99;
    assert.equal((await e.api.construir(consulta, overrides)).items.find(x => x.kind === 'servicio').estado, 'revisar');
    assert.equal(overrides.values().next().value.invalidada, true);
});

test('existing service is omitted after choice, and its existing marker works in a fresh query without override', async () => {
    const e = entorno(), { item, overrides } = await elegir(e);
    e.db.servicios.push({ reserva_id: 'r1', fecha_servicio: '2026-09-05', hora_inicio: '19:15:00', catalogo_servicios: { codigo: 'tinajaTonel' } });
    assert.equal((await e.api.construir(consulta, overrides)).items.find(x => x.kind === 'servicio').estado, 'existente');
    await assert.rejects(e.api.importarSeleccionados(new Set([item.item_id]), new e.Element('div'), consulta, overrides), /cambiaron/);
    assert.deepEqual(e.calls, []);
    e.db.servicios[0].observaciones = `[HAKU-LIBRO-SERVICIO:${item.item_id}]`;
    assert.equal((await e.api.construir(consulta)).items.find(x => x.kind === 'servicio').estado, 'existente');
});

test('additional safety issues suppress the selector; operational notes stay notes', async () => {
    for (const change of [e => { e.r.servicios[0].hora = null; e.r.servicios[0].texto_original = 'tonel'; },
        e => e.r.adultos = null, e => e.r.adultos = 9, e => { e.r.servicios[0].concepto = 'desconocido'; e.r.servicios[0].texto_original = 'servicio sin tipo'; },
        e => e.r.servicios[0].hora = '29:15', e => e.r.servicios[0].cortesia = true, e => e.db.reservas[0].titular_nombre = 'Otra Persona']) {
        const e = entorno(); change(e); const item = (await e.api.construir(consulta)).items.find(x => x.kind === 'servicio');
        assert.equal(item.puedeElegirNoche, false);
    }
    const e = entorno(); e.r.texto_original = 'Dejar batas en cabaña';
    assert.ok((await e.api.construir(consulta)).items.some(x => x.kind === 'nota' && x.texto === 'Dejar batas en cabaña'));
});

test('rendered confirmation rebuilds the card into ready services without invoking the writer', async () => {
    const e = entorno(), out = new e.Element('div'), result = await e.api.construir(consulta);
    e.api.renderizar(result, out, consulta);
    const all = el => [el, ...el.children.flatMap(all)];
    const select = all(out).find(x => x.tag === 'select'); select.value = '2';
    await e.click(all(out).find(x => x.tag === 'button' && x.textContent === 'Confirmar'));
    assert.equal(all(out).some(x => x.tag === 'select'), false);
    assert.ok(all(out).some(x => x.textContent.includes('Listo · fecha confirmada manualmente')));
    assert.ok(all(out).some(x => x.textContent.includes('Incorporar 1 servicio')));
    assert.deepEqual(e.calls, []);
});

test('a comparison renders four compact sections and its incorporation button', async () => {
    const e = entorno(), out = new e.Element('div');
    const built = await e.api.construir(consulta), original = built.items.find(x => x.kind === 'servicio');
    const ready = { ...copy(original), item_id: 'ready', estado: 'listo', razones: [], inferencias: [] };
    const note = { ...copy(ready), item_id: 'note', kind: 'nota', texto: 'Dejar batas en recepción', payload: { reserva_id: 'r1', importante: true } };
    const existing = { ...copy(ready), item_id: 'existing', estado: 'existente' };
    const review = { ...copy(original), item_id: 'review', estado: 'revisar', razones: ['Requiere revisión manual.'] };
    const result = { ...built, items: [ready, note, existing, review], quiereIncorporar: false };

    e.api.renderizar(result, out, consulta);
    let sections = out.querySelectorAll(':scope > details');
    assert.equal(sections.length, 4);
    assert.deepEqual(sections.map(x => x.children[0].children[0].textContent), [
        'Servicios listos para incorporar',
        'Notas operativas para el resumen',
        'Ya existen en Proyecto H',
        'Requieren revisión manual'
    ]);
    assert.deepEqual(sections.map(x => x.children[0].children[1].textContent), ['1', '1', '1', '1']);
    assert.ok(sections.every(x => x.open === false));
    assert.ok(sections.every(x => x.classList.contains('haku-libro-servicios__seccion')));
    assert.ok(sections.every(x => x.classList.contains('haiku-comparacion-acordeon')));
    for (const icon of ['haku-icono--servicio', 'haku-icono--archivo', 'haku-icono--calendario', 'haku-icono--alerta']) {
        assert.ok(sections.some(x => x.classList.contains(icon)), icon);
    }
    assert.ok(out.classList.contains('haku-comparacion-compacta'));
    assert.equal(out.querySelectorAll('input[type=checkbox]').length, 4);
    assert.equal(out.querySelectorAll('input[type=checkbox]:not(:disabled)').length, 2);
    const incorporar = out.querySelectorAll('button').find(x => x.dataset.hakuAccion === 'incorporar');
    assert.ok(incorporar);
    assert.equal(incorporar.textContent, 'Incorporar 1 servicio + 1 nota');
    assert.equal(incorporar.disabled, false);

    sections[0].open = true;
    e.api.renderizar(result, out, consulta);
    sections = out.querySelectorAll(':scope > details');
    assert.ok(sections.every(x => x.open === false));

    const css = e.document.head.children.at(-1).textContent;
    assert.match(css, /\.haiku-asistente-panel \.haku-libro-servicios\.haiku-asistente-preview>\.haku-libro-servicios__seccion>\.haku-libro-servicios__lista\{[^}]*width:100%;max-width:none;max-height:none;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;overflow:visible/);
    assert.doesNotMatch(css, /max-height:250px|overflow:auto/);
    assert.match(css, /\.haku-libro-servicios__item\{[^}]*border-bottom:1px solid #e3eae5;[^}]*border-radius:0/);
});

test('an invalidated confirmation stays invalid even when the old data reappears', async () => {
    const e = entorno(), { item, overrides } = await elegir(e);
    e.state.generacion++;
    await e.api.construir(consulta, overrides);
    e.state.generacion--;
    await assert.rejects(e.api.importarSeleccionados(new Set([item.item_id]), new e.Element('div'), consulta, overrides), /cambiaron/);
    assert.deepEqual(e.calls, []);
});

test('compact selector confirms an index, and confirmed item is selectable in the same UI', async () => {
    const e = entorno(), { item } = await elegir(e), seleccionados = new Set(), calls = [];
    const fila = e.api.crearItem(item, seleccionados, async (_, i) => calls.push(i));
    const all = el => [el, ...el.children.flatMap(all)];
    const select = all(fila).find(x => x.tag === 'select'), button = all(fila).find(x => x.tag === 'button');
    assert.deepEqual(select.children.map(x => x.value), ['1', '2']); select.value = '2'; await e.click(button);
    assert.deepEqual(calls, [2]); assert.equal(seleccionados.size, 0);
    const overrides = new Map([[item.item_id, { noche_indice: 2, firma: item.firmaNoche }]]);
    const listo = (await e.api.construir(consulta, overrides)).items.find(x => x.kind === 'servicio');
    const nueva = e.api.crearItem(listo, seleccionados);
    assert.equal(nueva.children[0].disabled, false); assert.ok(seleccionados.has(item.item_id));
    assert.equal(all(nueva).some(x => x.tag === 'select'), false);
});

test('comparison button enters the guarded incorporation flow and preserves the manual-night override', async () => {
    const e = entorno(), out = new e.Element('div'); e.document.card = out;
    // Otros elementos ya listos: el guard anterior abría el confirm global por ellos.
    e.r.servicios.push({ concepto: 'jacuzzi', texto_original: 'jacuzzi el 04-09 a las 18:00', hora: '18:00' });
    const previous = new e.Element('div'); previous.className = 'haiku-asistente-mensaje--usuario'; previous.textContent = consultaComparacion;
    out.previousElementSibling = previous;
    e.cargarGuard(); e.api.renderizar(await e.api.construir(consultaComparacion), out, consultaComparacion);
    const all = el => [el, ...el.children.flatMap(all)];
    const manual = all(out).find(x => x.dataset.hakuAccion === 'confirmar-noche');
    assert.equal(manual.type, 'button'); all(out).find(x => x.tag === 'select').value = '2';
    await e.click(manual); // Dispatch document capture first, then target handler.
    assert.deepEqual(e.calls, []); assert.equal(e.state.importaciones, 0);
    const actual = await e.api.revalidarVista(out, consultaComparacion), yenny = actual.items.find(x => x.kind === 'servicio');
    assert.equal(yenny.estado, 'listo'); assert.equal(yenny.nocheManual, 2); assert.equal(yenny.fecha, '2026-09-05');
    assert.ok(all(out).some(x => x.textContent.includes('Listo · fecha confirmada manualmente')));
    const antes = e.state.lecturas;
    await e.click(all(out).find(x => x.dataset.hakuAccion === 'incorporar'));
    assert.ok(e.state.lecturas > antes); assert.deepEqual(e.calls, ['confirm']);
    assert.equal(e.state.importaciones, 0); // Guard owns the existing incorporation path; no double dispatch.
});

test('active capture guard blocks obsolete overrides instead of selecting another row by position', async () => {
    const e = entorno(), out = new e.Element('div'); e.document.card = out;
    const previous = new e.Element('div'); previous.className = 'haiku-asistente-mensaje--usuario'; previous.textContent = consulta; out.previousElementSibling = previous;
    e.cargarGuard(); e.api.renderizar(await e.api.construir(consulta), out, consulta);
    const all = el => [el, ...el.children.flatMap(all)];
    all(out).find(x => x.tag === 'select').value = '2';
    await e.click(all(out).find(x => x.dataset.hakuAccion === 'confirmar-noche'));
    e.r.noches = 3;
    await e.click(all(out).find(x => x.dataset.hakuAccion === 'incorporar'));
    assert.deepEqual(e.calls, []);
    assert.ok(all(out).some(x => x.textContent.includes('cambiaron desde la vista previa')));
});
