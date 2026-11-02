const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { crearControlador, instalar } = require('../js/haku-mobile-assistant-v1.js');
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NONCE = '33333333-3333-4333-8333-333333333333';
const PERMS = ['reservas.ver', 'pagos.ver', 'servicios.ver'];
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
    let context = { auth: { id: OWNER }, usuario: { id: OWNER, activo: true }, permisos: [...PERMS] };
    let token = 'synthetic-token-never-post';
    const audit = { rpc: [], user: 0, session: 0, open: 0, close: 0, reload: 0, views: [], posts: [], history: [] };
    const client = { auth: {
        getSession: async () => { audit.session++; return { data: { session: { user: { id: OWNER }, access_token: token } } }; },
        getUser: async () => { audit.user++; return { data: { user: { id: options.authUser || OWNER } } }; }
    }, rpc: async name => {
        audit.rpc.push(name); await options.rpcWait?.(); if (options.rotate) token = 'new-synthetic-token';
        return { data: { usuario: { id: options.rpcUser || OWNER, activo: true },
            permisos: options.rpcPerms || [...PERMS], roles: [] } };
    } };
    const chat = { abrir: () => { audit.open++; }, cerrar: () => { audit.close++; } };
    const controller = crearControlador({ contexto: () => context, cliente: () => client,
        chat: () => chat, vista: (state, message) => audit.views.push({ state, message }),
        publicar: p => audit.posts.push(p), recargar: () => { audit.reload++; },
        prepararHistorial: owner => { audit.history.push(owner); return options.reloadForHistory === true; } });
    const bind = value => controller.bind(value || { owner: OWNER, nonce: NONCE });
    return { controller, audit, client, chat, bind, setContext: next => { context = next; },
        context: () => context };
}
test('sin binding no expone chat, sesión, consultas ni mensajes nativos', async () => {
    const f = fixture(); await f.controller.revisar();
    assert.equal(f.controller.permitido(), false); assert.equal(f.audit.open, 0);
    assert.deepEqual(f.audit.posts, []); assert.deepEqual(f.audit.rpc, []);
});
test('binding requiere owner y nonce UUID; no admite URL, tokens ni prompts', async () => {
    const f = fixture();
    for (const value of [{ owner: OWNER }, { owner: 'https://evil.invalid', nonce: NONCE },
        { owner: OWNER, nonce: 'access_token=bad' }, null]) assert.equal(f.bind(value || {}), false);
    await flush(); assert.equal(f.audit.open, 0); assert.deepEqual(f.audit.rpc, []);
});
test('identidad validada usa Auth y RPC antes de permitir el chat; puente sin credenciales', async () => {
    const f = fixture(); assert.equal(f.bind(), true); await flush();
    assert.equal(f.controller.permitido(), true); assert.equal(f.audit.open, 1);
    assert.equal(f.audit.user, 1); assert.equal(f.audit.session, 2);
    assert.deepEqual(f.audit.rpc, ['haiku_sesion_actual']);
    assert.deepEqual(f.audit.posts.at(-1), { type: 'haku-assistant-session', nonce: NONCE, userId: OWNER, state: 'ready' });
    assert.doesNotMatch(JSON.stringify(f.audit.posts), /synthetic-token|access_token|roles|permisos/);
});
for (const [name, change] of [
    ['otra cuenta Auth', c => { c.auth.id = OTHER; }],
    ['perfil ajeno', c => { c.usuario.id = OTHER; }],
    ['usuario inactivo', c => { c.usuario.activo = false; }],
    ['permisos incompletos', c => { c.permisos = ['reservas.ver']; }]
]) test(name + ': permanece bloqueado y no ejecuta consultas', async () => {
    const f = fixture(); change(f.context()); f.bind(); await flush();
    assert.equal(f.controller.permitido(), false); assert.equal(f.audit.open, 0);
    assert.equal(f.audit.posts.at(-1).state, 'mismatch'); assert.deepEqual(f.audit.rpc, []);
});
test('sesión web ausente solicita login sin exponer chat', async () => {
    const f = fixture(); f.setContext(null); f.bind(); await flush();
    assert.equal(f.audit.posts.at(-1).state, 'login'); assert.equal(f.audit.posts.at(-1).userId, null);
    assert.equal(f.audit.open, 0);
});
for (const [name, options] of [
    ['getUser distinto', { authUser: OTHER }], ['RPC distinto', { rpcUser: OTHER }],
    ['permisos RPC incompletos', { rpcPerms: ['reservas.ver'] }], ['token rotado durante RPC', { rotate: true }]
]) test(name + ': fallo cerrado sin mensajes internos', async () => {
    const f = fixture(options); f.bind(); await flush();
    assert.equal(f.controller.permitido(), false); assert.equal(f.audit.open, 0);
    assert.equal(f.audit.posts.at(-1).state, 'error');
    assert.doesNotMatch(JSON.stringify(f.audit.posts), /synthetic|token/);
});
test('logout durante validación descarta la respuesta tardía y requiere documento nuevo', async () => {
    let resume; const wait = new Promise(resolve => { resume = resolve; });
    const f = fixture({ rpcWait: () => wait }); f.bind(); await flush();
    f.setContext(null); f.controller.cambioSesion('SIGNED_OUT', null); resume(); await flush();
    assert.equal(f.audit.reload, 1); assert.equal(f.audit.open, 0); assert.equal(f.controller.permitido(), false);
});
test('cambio real de cuenta recarga y deja el chat inaccesible', async () => {
    const f = fixture(); f.bind(); await flush();
    f.setContext({ auth: { id: OTHER }, usuario: { id: OTHER, activo: true }, permisos: [...PERMS] });
    f.controller.cambioSesion('SIGNED_IN', { user: { id: OTHER } });
    assert.equal(f.audit.reload, 1); assert.equal(f.controller.permitido(), false);
});
test('renovar token del mismo usuario revalida sin cambiar documento ni historial', async () => {
    const f = fixture(); f.bind(); await flush();
    f.controller.cambioSesion('TOKEN_REFRESHED', { user: { id: OWNER } });
    await f.controller.revisar(); await flush();
    assert.equal(f.audit.reload, 0); assert.equal(f.controller.permitido(), true);
    assert.deepEqual(f.audit.history, [OWNER]); assert.equal(f.audit.rpc.length, 2);
});
test('cerrar y volver a bind con el mismo nonce conserva conversación y no compara', async () => {
    const f = fixture(); f.bind(); await flush(); f.controller.cerrar();
    assert.equal(f.controller.permitido(), false); assert.equal(f.audit.posts.at(-1).state, 'closed');
    f.bind(); await flush(); assert.equal(f.controller.permitido(), true); assert.equal(f.audit.open, 2);
    assert.deepEqual(Object.keys(f.chat).sort(), ['abrir', 'cerrar']);
});
test('cambiar nonce invalida respuestas del documento o binding anterior', async () => {
    const f = fixture(); f.bind(); await flush();
    assert.equal(f.controller.coincide({ owner: OWNER, nonce: NONCE }), true);
    f.bind({ owner: OWNER, nonce: OTHER });
    assert.equal(f.controller.coincide({ owner: OWNER, nonce: NONCE }), false);
    await flush(); assert.equal(f.controller.coincide({ owner: OWNER, nonce: OTHER }), true);
});
test('partición inicial de historial requiere recarga antes de consultar o abrir', async () => {
    const f = fixture({ reloadForHistory: true }); f.bind(); await flush();
    assert.equal(f.audit.open, 0); assert.deepEqual(f.audit.rpc, []); assert.equal(f.controller.permitido(), false);
});
test('el modo no se instala fuera del opt-in del panel', () => {
    for (const href of ['https://example.invalid/panel.html', 'https://example.invalid/index.html?haku-mobile-assistant=1',
        'https://example.invalid/panel.html?haku-mobile-assistant=0']) assert.equal(instalar({ location: { href } }), null);
});
test('el boot del panel carga el gate sólo en HTML final y protege primer frame', () => {
    const panel = readFileSync(new URL('../panel.html', 'file://' + __filename), 'utf8');
    assert.match(panel, /const asistenteMovil = new URLSearchParams/);
    assert.ok(panel.indexOf('js/haku-mobile-assistant-v1.js') < panel.indexOf('document.open(); document.write(html)'));
    assert.match(panel, /if \(asistenteMovil\)/); assert.match(panel, /visibility:hidden!important;pointer-events:none!important/);
});
test('las cuatro acciones son sólo enum, reutilizan botones y esperan módulos canónicos', () => {
    const code = readFileSync(new URL('../js/haku-mobile-assistant-v1.js', 'file://' + __filename), 'utf8');
    for (const action of ['book-current', 'book-next', 'services-current', 'services-next']) assert.ok(code.includes(action));
    assert.match(code, /control\.coincide\(context\)/); assert.match(code, /root\.HAIKU_LIBRO_CONSULTAS/);
    assert.match(code, /root\.HAIKU_LIBRO_SERVICIOS_SCOPE_V2/); assert.match(code, /boton\.click\(\)/);
    assert.doesNotMatch(code, /\.rpc\(['"](?:haku_incorporar|haiku_importar)|accessToken|refresh_token|setSession\(/);
});

function installedFixture() {
    const f = fixture(), intervals = [], events = new Map(), actions = [];
    const map = new Map(), storage = new Map([['haku-mobile-assistant-owner-v1', OWNER]]);
    function element() {
        return { dataset: {}, children: [], hidden: false, inert: false, className: '',
            setAttribute() {}, addEventListener() {},
            append(...children) { this.children.push(...children); }, prepend(child) { this.children.unshift(child); },
            replaceChildren(...children) { this.children = children; } };
    }
    const panel = element(), messages = element(), conversation = element();
    map.set('haiku-asistente-panel', panel); map.set('haiku-asistente-mensajes', messages);
    const doc = { body: element(), documentElement: { dataset: {}, classList: { toggle() {}, remove() {} } },
        getElementById: id => map.get(id), createElement: () => element(), addEventListener() {},
        querySelector: selector => selector === '.haiku-asistente-conversacion' ? conversation :
            selector.startsWith('[data-haiku-accion-rapida=') ? { click() { actions.push(selector); } } : null };
    const root = { document: doc, location: { href: 'https://chinchoncarrasco-cpu.github.io/Proyecto-H/panel.html?haku-mobile-assistant=1',
        pathname: '/Proyecto-H/panel.html', reload: () => { root.reloads++; } }, reloads: 0,
        haikuSesion: f.context(), haikuSupabase: { ...f.client, auth: { ...f.client.auth, onAuthStateChange() {} } },
        HAIKU_ASISTENTE: { ...f.chat, procesando: () => false },
        HAIKU_PRIVACIDAD: { estado: () => ({ armado: true, modo: 'oculto' }) },
        HAIKU_LIBRO_CONSULTAS: {}, HAIKU_LIBRO_SERVICIOS_SCOPE_V2: {},
        HAIKU_LIBRO_RESERVA_V1: { estado: () => ({ cargado: true }) },
        HAIKU_LIBRO_GOOGLE_V1: { estado: () => ({ conectado: true, sincronizando: false }), conectar() { assert.fail('Unexpected connect'); } },
        sessionStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
        ReactNativeWebView: { postMessage: value => f.audit.posts.push(JSON.parse(value)) },
        setInterval: cb => { intervals.push(cb); return intervals.length; }, clearInterval() {}, setTimeout: cb => queueMicrotask(cb),
        addEventListener: (name, cb, capture) => { const list = events.get(name) || []; list.push({ cb, capture }); events.set(name, list); } };
    return { root, api: instalar(root), actions, intervals, events, panel, messages, storage, audit: f.audit };
}
test('focusMonth real: rechaza acción/nonce/owner ajenos y dispara cada botón canónico correcto', async () => {
    const f = installedFixture(), context = { owner: OWNER, nonce: NONCE };
    f.api.bind(context); await flush();
    assert.equal(f.api.focusMonth('arbitrary prompt', context), false);
    assert.equal(f.api.focusMonth('book-current', { owner: OTHER, nonce: NONCE }), false);
    assert.equal(f.api.focusMonth('book-current', { owner: OWNER, nonce: OTHER }), false);
    assert.equal(f.api.focusMonth('book-current'), false); assert.deepEqual(f.actions, []);
    for (const [action, button] of [['book-current', 'libro'], ['book-next', 'libro-siguiente'],
        ['services-current', 'servicios'], ['services-next', 'servicios-siguiente']]) {
        assert.equal(f.api.focusMonth(action, context), true);
        assert.equal(f.actions.at(-1), `[data-haiku-accion-rapida="${button}"]`);
    }
    assert.equal(f.actions.length, 4);
});
test('focusMonth espera PIN y módulos reales; no puede saltar bloqueo mediante click programático', async () => {
    const f = installedFixture(), context = { owner: OWNER, nonce: NONCE };
    f.api.bind(context); await flush();
    f.root.HAIKU_PRIVACIDAD.estado = () => ({ armado: true, modo: 'pin' });
    assert.equal(f.api.focusMonth('book-current', context), true); assert.deepEqual(f.actions, []);
    f.root.HAIKU_PRIVACIDAD.estado = () => ({ armado: true, modo: 'oculto' });
    f.root.HAIKU_LIBRO_CONSULTAS = null; f.intervals.forEach(cb => cb()); assert.deepEqual(f.actions, []);
    f.root.HAIKU_LIBRO_CONSULTAS = {}; f.intervals.forEach(cb => cb()); assert.equal(f.actions.length, 1);
});
test('al cambiar de cuenta limpia también mensajes tardíos antes de guardar el historial al salir', async () => {
    const f = installedFixture(), context = { owner: OWNER, nonce: NONCE };
    f.api.bind(context); await flush();
    f.storage.set('haku-mobile-assistant-owner-v1', OTHER);
    f.api.bind(context); assert.equal(f.root.reloads, 1);
    f.messages.children.push('respuesta tardía ajena');
    f.storage.set('haiku_asistente_historial_v1::/Proyecto-H/panel.html', 'old-secret');
    for (const { cb, capture } of f.events.get('pagehide')) if (capture === true) cb();
    assert.deepEqual(f.messages.children, []);
    assert.equal(f.storage.has('haiku_asistente_historial_v1::/Proyecto-H/panel.html'), false);
});
