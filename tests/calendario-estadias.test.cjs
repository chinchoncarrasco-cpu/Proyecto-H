const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// DOM mínimo: ejecuta los módulos completos y sus eventos, sin servidor ni BD real.
class Element {
    constructor(tag = 'div') {
        this.tagName = tag; this.children = []; this.dataset = {}; this.style = {setProperty(k,v) { this[k] = v; }};
        this.className = ''; this.listeners = {};
        this.classList = {
            contains: c => this.className.split(/\s+/).includes(c),
            add: (...cs) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...cs])].join(' '); },
            remove: (...cs) => { this.className = this.className.split(/\s+/).filter(c => !cs.includes(c)).join(' '); }
        };
    }
    appendChild(e) { e.parentNode = this; this.children.push(e); return e; }
    remove() { this.parentNode.children = this.parentNode.children.filter(e => e !== this); }
    set innerHTML(value) {
        this.children = [];
        for (const m of value.matchAll(/<([\w-]+)\b[^>]*class="([^"]+)"[^>]*>/g)) {
            const e = new Element(m[1]); e.className = m[2]; this.appendChild(e);
        }
    }
    matches(selector) {
        if (selector.includes(' ')) selector = selector.split(' ').at(-1);
        const id = selector.match(/#([\w-]+)/);
        if (id && this.id !== id[1]) return false;
        for (const m of selector.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(m[1])) return false;
        for (const m of selector.matchAll(/\[data-([\w-]+)(?:="([^"]*)")?\]/g)) {
            const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            if (!(key in this.dataset) || (m[2] !== undefined && this.dataset[key] !== m[2])) return false;
        }
        return true;
    }
    querySelectorAll(selector) {
        return this.children.flatMap(e => [...(selector.split(',').some(s => e.matches(s.trim())) ? [e] : []), ...e.querySelectorAll(selector)]);
    }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    click() { for (const fn of this.listeners.click || []) fn({target: this, stopPropagation() {}}); }
}

function harness(rows = [], cache = {}) {
    const body = new Element('body'), head = new Element('head'), ids = new Map(), timers = [], callbacks = {};
    const storage = new Map(Object.entries(cache));
    const h = { rows, body, timers, callbacks, queries: [], errors: [] };
    const document = {
        body, head, createElement: tag => new Element(tag), addEventListener() {},
        getElementById(id) { if (!ids.has(id)) { const e = new Element(); e.id = id; ids.set(id, e); body.appendChild(e); } return ids.get(id); },
        querySelectorAll: s => body.querySelectorAll(s), querySelector: s => body.querySelector(s)
    };
    const cliente = {
        from(table) {
            const query = { select(columns) { h.queries.push({table, columns}); return query; },
                order() { return query; }, in() { return query; }, eq() { return query; },
                then(resolve, reject) { return Promise.resolve(h.response ? h.response(table) : {data: table === 'reserva_estadias' ? structuredClone(h.rows) : [], error: null}).then(resolve, reject); }
            }; return query;
        },
        channel() { const channel = { on(_, filter, fn) { callbacks[filter.table] = fn; return channel; }, subscribe() { return channel; } }; return channel; }
    };
    const context = vm.createContext({document, localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v)},
        console: {info() {}, warn() {}, error: (...a) => h.errors.push(a)}, haikuSupabase: cliente,
        setTimeout: fn => { timers.push(fn); }, setInterval() { throw Error('No polling'); },
        MutationObserver: class { constructor() { throw Error('No observers'); } }, addEventListener() {},
        fechaSeleccionada: '2026-09-03', datosPorFecha: {},
        obtenerDatosDia(fecha) { return context.datosPorFecha[fecha] ||= {cabanas: {}}; },
        guardarDatos() { storage.set('haikuDatos', JSON.stringify(context.datosPorFecha)); }
    });
    context.window = context;
    h.context = context; h.storage = storage;
    h.load = name => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', name), 'utf8'), context, {filename: name});
    h.refresh = () => context.HAIKU_CALENDARIO_ESTADOS_V1.refrescar({sincronizarCache: false, redibujar: true});
    h.element = (id, fullDay = false, panel = false, reservaId = 'R1') => {
        const e = new Element('button'); e.className = panel ? 'calendario-panel-reserva' : 'calendario-reserva-barra';
        e.dataset = {reservaId, estadiaId: id}; if (fullDay) e.dataset.haikuFullday = '1'; body.appendChild(e); return e;
    };
    h.calendar = data => {
        storage.set('haikuDatos', JSON.stringify(data)); h.load('calendario.js');
        vm.runInContext('fechaCalendario = new Date(2026, 8, 1); generarCalendario();', context);
    };
    return h;
}
const stay = (id, estado, extra = {}) => ({id, reserva_id: 'R1', estado_estadia: estado, reservas: {id: 'R1', titular_nombre: 'Macarena Hurtado', estado_reserva: 'checked_out'}, ...extra});
const visual = (id, fullDay = false) => ({estadiaId: id, reservaId: 'R1', estado: fullDay ? 'fullday' : 'reservada', tipoEstadia: fullDay ? 'fullday' : 'alojamiento', noches: fullDay ? 0 : 1, titular: 'Macarena Hurtado', nombre: 'Macarena Hurtado'});

for (const [name, estado, checkin, checkout, expected, clase] of [
    ['histórico Bruno/Paulette: checkout sin timestamp no retrocede a hospedada', 'checked_out', '2026-09-05T14:00:00Z', null, 'checked_out', 'checkout'],
    ['hospedada con checkin mantiene hospedada', 'hospedada', '2026-09-05T14:00:00Z', null, 'hospedada', 'checkin'],
    ['checked_out con timestamp mantiene checkout', 'checked_out', '2026-09-05T14:00:00Z', '2026-09-06T12:00:00Z', 'checked_out', 'checkout'],
    ['confirmada sin timestamps no hereda checkout del padre', 'confirmada', null, null, 'confirmada', 'confirmada'],
    ['cancelada queda fuera aunque tenga timestamps', 'cancelada', '2026-09-05T14:00:00Z', '2026-09-06T12:00:00Z', '', null],
    ['no_show queda fuera aunque tenga checkin', 'no_show', '2026-09-05T14:00:00Z', null, '', null]
]) {
    test(`prioridad de estado: ${name}`, async () => {
        const h = harness([stay('E1', estado, {checkin_realizado_en: checkin, checkout_realizado_en: checkout})]);
        const elements = [h.element('E1'), h.element('E1', false, true)];
        h.load('supabase-calendario-estados-v1.js'); await h.refresh();
        assert.equal(h.context.HAIKU_CALENDARIO_ESTADOS_V1.estado('R1', 'E1'), expected);
        for (const e of elements) {
            if (clase) assert.ok(e.classList.contains(`cal-reserva-${clase}`));
            else assert.equal(e.dataset.haikuEstadoCanonico, undefined);
        }
    });
}

test('Macarena: ambas estadías checked_out pintan barras y panel por ID propio', async () => {
    const h = harness([stay('E1', 'checked_out'), stay('E2', 'checked_out')]);
    const elements = [h.element('E1'), h.element('E2', true), h.element('E1', false, true), h.element('E2', true, true)];
    h.load('supabase-calendario-estados-v1.js'); await h.refresh();
    for (const e of elements) { assert.ok(e.classList.contains('cal-reserva-checkout')); assert.ok(!e.classList.contains('cal-reserva-fullday')); }
    assert.match(h.queries[0].columns, /id,reserva_id/);
});

test('estados distintos no heredan checkout del padre; timestamps mandan por estadía', async () => {
    const h = harness([stay('E1', 'confirmada'), stay('E2', 'pendiente', {checkin_realizado_en: '2026-09-04'}), stay('E3', 'confirmada', {checkin_realizado_en: 'a', checkout_realizado_en: 'b'}), stay('E4', 'pendiente'), stay('E5', null)]);
    h.load('supabase-calendario-estados-v1.js'); await h.refresh();
    const api = h.context.HAIKU_CALENDARIO_ESTADOS_V1;
    assert.deepEqual(['E1','E2','E3','E4','E5'].map(id => api.estado('R1', id)), ['confirmada','hospedada','checked_out','pendiente','checked_out']);
    assert.equal(api.estado('R1'), ''); assert.equal(api.estado('R1', 'missing'), '');
});

test('Full Day conserva tipo al pasar confirmada → hospedada → checkout → confirmada; bloqueo intacto', async () => {
    const h = harness([stay('E1', 'confirmada')]); const e = h.element('E1', true); const block = h.element('E1');
    block.classList.add('cal-reserva-bloqueada'); const before = block.className;
    h.load('supabase-calendario-estados-v1.js');
    for (const [state, cls] of [['confirmada','fullday'], ['hospedada','checkin'], ['checked_out','checkout'], ['confirmada','fullday']]) {
        h.rows[0].estado_estadia = state; await h.refresh();
        assert.ok(e.classList.contains(`cal-reserva-${cls}`)); assert.equal(block.className, before);
    }
});

test('legacy sólo usa reserva si sus estadías coinciden; ignora caché anterior agregado', async () => {
    const h = harness([stay('E1','confirmada'), stay('E2','confirmada')], {haikuEstadosCalendarioV1: JSON.stringify({R1:'checked_out'})});
    const e = h.element(''); h.load('supabase-calendario-estados-v1.js');
    assert.equal(h.context.HAIKU_CALENDARIO_ESTADOS_V1.estado('R1'), '');
    await h.refresh(); assert.ok(e.classList.contains('cal-reserva-confirmada'));
    h.rows[1].estado_estadia = 'hospedada'; await h.refresh();
    assert.ok(!e.classList.contains('cal-reserva-confirmada'));
    assert.equal(JSON.parse(h.storage.get('haikuEstadosCalendarioV1')).version, 2);
});

test('render real conserva dos estadías de una reserva, incluido Full Day con cero noches', async () => {
    const h = harness([stay('E1','checked_out'), stay('E2','checked_out')]);
    h.calendar({'2026-09-03': {cabanas: {5: visual('E1')}}, '2026-09-04': {cabanas: {10: visual('E2', true)}}});
    h.load('supabase-calendario-estados-v1.js'); await h.refresh();
    const bars = h.body.querySelectorAll('.calendario-reserva-barra');
    assert.deepEqual(bars.map(e => e.dataset.estadiaId), ['E1','E2']);
    assert.ok(bars.every(e => e.classList.contains('cal-reserva-checkout')));
    assert.equal(JSON.parse(h.storage.get('haikuDatos'))['2026-09-04'].cabanas[10].noches, 0);
});

test('panel +N recibe estado en el mismo clic y Realtime actualiza panel abierto y barras', async () => {
    const h = harness([stay('E1','confirmada'), stay('E2','confirmada')]);
    const cabanas = {5: visual('E1'), 10: visual('E2', true)};
    for (const n of [1,2,3]) cabanas[n] = {...visual(`X${n}`), reservaId: `RX${n}`};
    h.calendar({'2026-09-04': {cabanas}}); h.load('supabase-calendario-estados-v1.js'); await h.refresh();
    h.body.querySelector('.calendario-mas-reservas').click();
    const panel = h.body.querySelector('.calendario-panel-dia');
    const e2 = panel.querySelector('[data-estadia-id="E2"]');
    assert.ok(e2.classList.contains('cal-reserva-fullday')); // Sin esperar timer/frame.
    h.rows[1].estado_estadia = 'checked_out'; h.callbacks.reserva_estadias();
    await h.timers.shift()();
    assert.equal(h.body.querySelector('.calendario-panel-dia'), panel);
    assert.ok(e2.classList.contains('cal-reserva-checkout'));
    // La estadía visible E1 mantiene estado independiente en ambos DOM.
    assert.ok(panel.querySelector('[data-estadia-id="E1"]').classList.contains('cal-reserva-confirmada'));
    assert.equal(h.errors.length, 0);
});

test('Realtime actualiza también barras visibles y conserva eventos durante lectura en curso', async () => {
    const h = harness([stay('E1','confirmada')]); const bar = h.element('E1'), panel = h.element('E1', false, true);
    h.load('supabase-calendario-estados-v1.js'); await h.refresh();
    let finish; h.response = () => new Promise(resolve => { finish = resolve; });
    const pending = h.refresh(); await Promise.resolve(); await Promise.resolve();
    h.callbacks.reserva_estadias(); await h.timers.shift()();
    h.response = null; h.rows[0].estado_estadia = 'checked_out';
    finish({data: [stay('E1','confirmada')], error: null}); await pending;
    assert.equal(h.timers.length, 1); await h.timers.shift()();
    for (const e of [bar,panel]) assert.ok(e.classList.contains('cal-reserva-checkout'));
});

test('decorador Full Day delega y no vuelve a pintar checkout con color de tipo', async () => {
    const h = harness([stay('E1','checked_out')], {haikuDatos: JSON.stringify({'2026-09-04': {cabanas: {10: visual('E1',true)}}})});
    const e = h.element('E1', true); h.load('supabase-calendario-estados-v1.js'); await h.refresh();
    h.load('supabase-reserva-estados-v1.js'); h.context.HAIKU_RESERVA_ESTADOS_SUPABASE_V2.decorarFullDaysCalendario();
    assert.ok(e.classList.contains('cal-reserva-checkout')); assert.ok(!e.classList.contains('cal-reserva-fullday'));
});

test('sync completo conserva estadiaId desde Supabase hasta las barras, sin usar ficha ni flags locales', async () => {
    const h = harness([
        stay('E1','pendiente', {fecha_ingreso:'2026-09-03', fecha_salida:'2026-09-04', tipo_estadia:'alojamiento', cabanas:{numero:5}}),
        stay('E2','checked_out', {fecha_ingreso:'2026-09-04', fecha_salida:'2026-09-04', tipo_estadia:'fullday', cabanas:{numero:10}})
    ]);
    h.context.haikuSesion = {};
    h.load('supabase-sync-v3.js'); await h.context.haikuSincronizarReservasSupabase();
    assert.equal(h.errors.length, 0);
    const data = JSON.parse(h.storage.get('haikuDatos'));
    assert.equal(data['2026-09-03'].cabanas[5].estadiaId, 'E1');
    assert.equal(data['2026-09-04'].cabanas[5].estadiaId, 'E1');
    assert.equal(data['2026-09-04'].cabanas[10].estadiaId, 'E2');
    Object.assign(data['2026-09-03'].cabanas[5], {checkout: true, checkinRealizado: true, abonoVerificado: true, abono: 999});
    h.storage.set('haikuFichaReservas', JSON.stringify({R1:{checkoutRealizado: true}}));
    h.calendar(data); h.context.haikuSesion = null;
    h.load('supabase-calendario-estados-v1.js'); await h.refresh();
    assert.ok(h.body.querySelector('[data-estadia-id="E1"]').classList.contains('cal-reserva-confirmacion-pendiente'));
    assert.ok(h.body.querySelector('[data-estadia-id="E2"]').classList.contains('cal-reserva-checkout'));
});
