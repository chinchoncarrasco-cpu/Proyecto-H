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
test('cerrar y reabrir la misma conversación rota el nonce sin otra validación ni espera', async () => {
    const f = fixture(); f.bind(); await flush(); f.controller.cerrar();
    assert.equal(f.controller.permitido(), false); assert.equal(f.audit.posts.at(-1).state, 'closed');
    const vistasAntes = f.audit.views.length;
    f.bind({ owner: OWNER, nonce: OTHER });
    assert.equal(f.controller.permitido(), true); assert.equal(f.audit.open, 2);
    assert.deepEqual(f.audit.views.slice(vistasAntes).map(v => v.state), ['ready']);
    assert.deepEqual(f.audit.posts.at(-1), { type: 'haku-assistant-session', nonce: OTHER, userId: OWNER, state: 'ready' });
    assert.equal(f.controller.coincide({ owner: OWNER, nonce: NONCE }), false);
    assert.equal(f.audit.user, 1); assert.equal(f.audit.session, 2);
    assert.deepEqual(f.audit.rpc, ['haiku_sesion_actual']); assert.equal(f.audit.reload, 0);
    assert.deepEqual(Object.keys(f.chat).sort(), ['abrir', 'cerrar']);
});
for (const event of ['TOKEN_REFRESHED', 'SIGNED_IN']) test(event + ' mientras está cerrado exige validar antes de reabrir', async () => {
    const f = fixture(); f.bind(); await flush(); f.controller.cerrar();
    f.controller.cambioSesion(event, { user: { id: OWNER } });
    await f.controller.revisar();
    assert.equal(f.controller.permitido(), false); assert.equal(f.audit.user, 1);
    f.bind({ owner: OWNER, nonce: OTHER });
    assert.equal(f.controller.permitido(), false);
    await flush();
    assert.equal(f.controller.permitido(), true); assert.equal(f.audit.user, 2);
    assert.equal(f.audit.session, 4); assert.equal(f.audit.rpc.length, 2); assert.equal(f.audit.reload, 0);
});
test('cerrar sesión mientras el panel está cerrado descarta su autorización anterior', async () => {
    const f = fixture(); f.bind(); await flush(); f.controller.cerrar();
    f.setContext(null); f.controller.cambioSesion('SIGNED_OUT', null);
    f.bind({ owner: OWNER, nonce: OTHER }); await flush();
    assert.equal(f.controller.permitido(), false); assert.equal(f.audit.posts.at(-1).state, 'login');
    assert.equal(f.audit.open, 1); assert.equal(f.audit.reload, 1); assert.equal(f.audit.rpc.length, 1);
});
for (const [name, change] of [
    ['otra cuenta Auth', c => { c.auth.id = OTHER; }],
    ['perfil ajeno', c => { c.usuario.id = OTHER; }],
    ['usuario inactivo', c => { c.usuario.activo = false; }],
    ['permiso retirado', c => { c.permisos = ['reservas.ver']; }]
]) test('reabrir con ' + name + ' bloquea la confianza anterior', async () => {
    const f = fixture(); f.bind(); await flush(); f.controller.cerrar(); change(f.context());
    f.bind({ owner: OWNER, nonce: OTHER }); await flush();
    assert.equal(f.controller.permitido(), false); assert.equal(f.audit.posts.at(-1).state, 'mismatch');
    assert.equal(f.audit.open, 1); assert.equal(f.audit.rpc.length, 1);
});
test('cerrar y reabrir después de un error no reutiliza una validación anterior', async () => {
    const options = { authUser: OWNER }, f = fixture(options);
    f.bind(); await flush(); options.authUser = OTHER;
    f.controller.revalidar(); await flush(); assert.equal(f.audit.posts.at(-1).state, 'error');
    f.controller.cerrar(); f.bind({ owner: OWNER, nonce: OTHER }); await flush();
    assert.equal(f.controller.permitido(), false); assert.equal(f.audit.posts.at(-1).state, 'error');
    assert.equal(f.audit.open, 1); assert.equal(f.audit.user, 3);
});
test('cerrar durante la validación descarta la respuesta anterior y no acredita el nonce nuevo', async () => {
    let resume; const wait = new Promise(resolve => { resume = resolve; });
    const f = fixture({ rpcWait: () => wait }); f.bind(); await flush();
    f.controller.cerrar(); f.bind({ owner: OWNER, nonce: OTHER });
    assert.equal(f.controller.permitido(), false);
    resume(); await flush();
    assert.equal(f.audit.open, 0); assert.equal(f.controller.permitido(), false);
    assert.equal(f.audit.posts.some(p => p.state === 'ready'), false);
    await f.controller.revisar(); await flush();
    assert.equal(f.audit.open, 1); assert.equal(f.audit.rpc.length, 2);
    assert.equal(f.audit.posts.at(-1).nonce, OTHER); assert.equal(f.audit.posts.at(-1).state, 'ready');
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
    const f = fixture(), intervals = [], events = new Map(), actions = [], submissions = [], authCallbacks = [];
    const map = new Map(), storage = new Map([['haku-mobile-assistant-owner-v1', OWNER]]);
    function element() {
        return { dataset: {}, children: [], hidden: false, inert: false, className: '',
            handlers: {}, setAttribute() {}, addEventListener(name, cb) { this.handlers[name] = cb; },
            append(...children) { this.children.push(...children); }, prepend(child) { this.children.unshift(child); },
            replaceChildren(...children) { this.children = children; } };
    }
    const panel = element(), messages = element(), conversation = element();
    const field = { ...element(), id: 'haiku-asistente-texto', value: '' };
    function dispatch(type, target, props = {}) {
        let stopped = false;
        const event = { type, target, ...props, preventDefault() {}, stopImmediatePropagation() { stopped = true; } };
        for (const { cb, capture } of events.get(type) || []) {
            if (capture === true) cb(event);
            if (stopped) break;
        }
        return !stopped;
    }
    let sendInProgress = false;
    const send = { ...element(),
        closest: selector => selector === '#haiku-asistente-enviar' ? send : null,
        click() {
            if (sendInProgress || this.disabled) return;
            sendInProgress = true;
            try { if (dispatch('click', this)) submissions.push(field.value); }
            finally { sendInProgress = false; }
        } };
    const buttons = new Map();
    function button(action) {
        let clickInProgress = false;
        if (!buttons.has(action)) buttons.set(action, {
            getAttribute: () => action,
            closest: selector => selector === '[data-haiku-accion-rapida]' ? button(action) : null,
            click() {
                if (clickInProgress) return;
                clickInProgress = true;
                try {
                let stopped = false;
                const event = { type: 'click', target: this, preventDefault() { stopped = true; }, stopImmediatePropagation() {} };
                for (const { cb, capture } of events.get('click') || []) if (capture === true) cb(event);
                if (!stopped) actions.push(`[data-haiku-accion-rapida="${action}"]`);
                } finally { clickInProgress = false; }
            }
        });
        return buttons.get(action);
    }
    map.set('haiku-asistente-panel', panel); map.set('haiku-asistente-mensajes', messages);
    map.set('haiku-asistente-texto', field); map.set('haiku-asistente-enviar', send);
    const doc = { body: element(), documentElement: { dataset: {}, classList: { toggle() {}, remove() {} } },
        getElementById: id => map.get(id), createElement: () => element(), addEventListener() {},
        querySelector: selector => selector === '.haiku-asistente-conversacion' ? conversation :
            selector.startsWith('[data-haiku-accion-rapida=') ? button(selector.match(/="([^"]+)"/)[1]) : null };
    const root = { document: doc, location: { href: 'https://chinchoncarrasco-cpu.github.io/Proyecto-H/panel.html?haku-mobile-assistant=1',
        pathname: '/Proyecto-H/panel.html', reload: () => { root.reloads++; } }, reloads: 0,
        haikuSesion: f.context(), haikuSupabase: { ...f.client, auth: { ...f.client.auth, onAuthStateChange(cb) { authCallbacks.push(cb); } } },
        HAIKU_ASISTENTE: { ...f.chat, procesando: () => false },
        HAIKU_PRIVACIDAD: { estado: () => ({ armado: true, modo: 'oculto' }) },
        HAIKU_LIBRO_CONSULTAS: {}, HAIKU_LIBRO_SERVICIOS_SCOPE_V2: {},
        HAIKU_LIBRO_RESERVA_V1: { estado: () => ({ cargado: true }) },
        HAIKU_LIBRO_GOOGLE_V1: { estado: () => ({ conectado: true, sincronizando: false }), conectar() { assert.fail('Unexpected connect'); } },
        sessionStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
        ReactNativeWebView: { postMessage: value => f.audit.posts.push(JSON.parse(value)) },
        setInterval: cb => { intervals.push(cb); return intervals.length; }, clearInterval() {}, setTimeout: cb => queueMicrotask(cb),
        addEventListener: (name, cb, capture) => { const list = events.get(name) || []; list.push({ cb, capture }); events.set(name, list); } };
    return { root, api: instalar(root), actions, submissions, intervals, events, panel, messages, conversation, storage, field,
        clickQuick: action => button(action).click(), audit: f.audit,
        sendText(text) { field.value = text; send.click(); },
        sendKey(text, props) {
            field.value = text;
            if (dispatch('keydown', field, { key: 'Enter', ...props })) submissions.push(field.value);
        },
        signOut() { root.haikuSesion = null; authCallbacks.forEach(cb => cb('SIGNED_OUT', null)); }
    };
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
        await flush();
        assert.equal(f.actions.at(-1), `[data-haiku-accion-rapida="${button}"]`);
    }
    assert.equal(f.actions.length, 4);
});
test('reabrir conserva los mismos mensajes, borrador y lector sin volver a conectar el Libro', async () => {
    const f = installedFixture(), context = { owner: OWNER, nonce: NONCE };
    f.api.bind(context); await flush();
    const card = { textContent: 'Resultado visible de una consulta', handlers: { click: () => 'vigente' } };
    f.messages.children.push(card); f.field.value = 'Mi próxima consulta';
    const reader = f.root.HAIKU_LIBRO_RESERVA_V1;
    const close = { closest: selector => selector === '#haiku-asistente-cerrar' ? close : null };
    for (const { cb, capture } of f.events.get('click')) if (capture === true)
        cb({ type: 'click', target: close, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(f.api.focusMonth('book-current', context), false);
    f.api.bind({ owner: OWNER, nonce: OTHER }); await flush();
    assert.equal(f.messages.children[0], card); assert.equal(card.handlers.click(), 'vigente');
    assert.equal(f.field.value, 'Mi próxima consulta'); assert.equal(f.root.HAIKU_LIBRO_RESERVA_V1, reader);
    assert.equal(f.root.reloads, 0); assert.equal(f.audit.user, 1); assert.equal(f.audit.rpc.length, 1);
    assert.deepEqual(f.actions, []); assert.deepEqual(f.submissions, []);
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
test('con Libro listo, los clicks programáticos salen del evento original antes del despacho canónico', async () => {
    const f = installedFixture();
    f.api.bind({ owner: OWNER, nonce: NONCE }); await flush();
    for (const action of ['libro', 'libro-siguiente', 'servicios', 'servicios-siguiente']) {
        f.clickQuick(action);
        await flush();
        assert.equal(f.actions.at(-1), `[data-haiku-accion-rapida="${action}"]`);
    }
    assert.equal(f.actions.length, 4);
    const text = 'Libro: compara noviembre 2026 con Proyecto H';
    f.sendText(text); await flush();
    assert.deepEqual(f.submissions, [text]);
});
test('las cuatro acciones manuales esperan preparación y no ejecutan consultas si la descarga falla', async () => {
    for (const action of ['libro', 'libro-siguiente', 'servicios', 'servicios-siguiente']) {
        const f = installedFixture(); let loaded = false, downloads = 0;
        f.api.bind({ owner: OWNER, nonce: NONCE }); await flush();
        f.root.HAIKU_LIBRO_RESERVA_V1.estado = () => ({ cargado: loaded });
        f.root.HAIKU_LIBRO_GOOGLE_V1 = {
            estado: () => ({ conectado: loaded, sincronizando: false, error: loaded ? null : { code: 'LIBRO_ENLACE_NO_DISPONIBLE' } }),
            async conectar() { downloads++; return loaded; }
        };
        f.clickQuick(action); await flush();
        assert.equal(downloads, 1); assert.deepEqual(f.actions, []);
        const status = f.conversation.children[0];
        assert.match(status.textContent, /no está disponible/);
        const retry = status.children.find(child => child?.textContent === 'Reintentar');
        assert.ok(retry); loaded = true; retry.handlers.click(); await flush();
        assert.deepEqual(f.actions, [`[data-haiku-accion-rapida="${action}"]`]);
        assert.equal(downloads, 1); // Un solo despacho canónico, sin recursión.
    }
});
test('una consulta escrita conserva su texto y espera descarga y PIN; se envía una sola vez', async () => {
    const f = installedFixture(); let loaded = false, resolveDownload, downloads = 0, pin = true;
    const wait = new Promise(resolve => { resolveDownload = resolve; });
    f.api.bind({ owner: OWNER, nonce: NONCE }); await flush();
    f.root.HAIKU_LIBRO_RESERVA_V1.estado = () => ({ cargado: loaded });
    f.root.HAIKU_LIBRO_GOOGLE_V1 = { estado: () => ({ conectado: loaded, sincronizando: !loaded }),
        async conectar() { downloads++; await wait; loaded = true; return true; } };
    f.root.HAIKU_PRIVACIDAD.estado = () => ({ armado: true, modo: pin ? 'pin' : 'oculto' });
    const text = '  Libro: revisa CAB 7 el 05-11-2026  ';
    f.sendText(text); f.sendText(text); await flush();
    assert.equal(f.field.value, text); assert.deepEqual(f.submissions, []); assert.equal(downloads, 1);
    resolveDownload(); await flush(); assert.deepEqual(f.submissions, []);
    pin = false; f.intervals.forEach(cb => cb()); f.intervals.forEach(cb => cb());
    assert.deepEqual(f.submissions, [text]); assert.equal(f.field.value, text);
});
test('la consulta escrita que falla sigue editable y Reintentar envía el mismo texto sin duplicarlo', async () => {
    const f = installedFixture(); let loaded = false;
    f.api.bind({ owner: OWNER, nonce: NONCE }); await flush();
    f.root.HAIKU_LIBRO_RESERVA_V1.estado = () => ({ cargado: loaded });
    f.root.HAIKU_LIBRO_GOOGLE_V1 = { estado: () => ({ conectado: loaded, sincronizando: false,
        error: loaded ? null : { code: 'LIBRO_ENLACE_NO_DISPONIBLE' } }), async conectar() { return loaded; } };
    const text = 'Libro: compara las reservas de noviembre 2026 con Proyecto H';
    f.sendText(text); await flush();
    assert.deepEqual(f.submissions, []); assert.equal(f.field.value, text);
    const status = f.conversation.children[0]; assert.match(status.textContent, /no está disponible/);
    const retry = status.children.find(child => child?.textContent === 'Reintentar'); assert.ok(retry);
    loaded = true; retry.handlers.click(); await flush(); f.intervals.forEach(cb => cb());
    assert.deepEqual(f.submissions, [text]);
});
test('editar una consulta pendiente cancela su envío y conserva la nueva consulta', async () => {
    const f = installedFixture(); let loaded = false, resume;
    const wait = new Promise(resolve => { resume = resolve; });
    f.api.bind({ owner: OWNER, nonce: NONCE }); await flush();
    f.root.HAIKU_LIBRO_RESERVA_V1.estado = () => ({ cargado: loaded });
    f.root.HAIKU_LIBRO_GOOGLE_V1 = { estado: () => ({ conectado: loaded, sincronizando: false }),
        async conectar() { await wait; loaded = true; return true; } };
    f.sendText('Libro: compara noviembre 2026'); f.field.value = 'Haku, resumen del día';
    resume(); await flush(); f.intervals.forEach(cb => cb());
    assert.deepEqual(f.submissions, []); assert.equal(f.field.value, 'Haku, resumen del día');
});
test('logout o nonce nuevo descarta el envío escrito aunque termine la descarga anterior', async () => {
    for (const change of ['logout', 'nonce']) {
        const f = installedFixture(); let loaded = false, resume;
        const wait = new Promise(resolve => { resume = resolve; });
        f.api.bind({ owner: OWNER, nonce: NONCE }); await flush();
        f.root.HAIKU_LIBRO_RESERVA_V1.estado = () => ({ cargado: loaded });
        f.root.HAIKU_LIBRO_GOOGLE_V1 = { estado: () => ({ conectado: loaded, sincronizando: false }),
            async conectar() { await wait; loaded = true; return true; } };
        f.sendText('Libro: compara noviembre 2026');
        if (change === 'logout') f.signOut(); else f.api.bind({ owner: OWNER, nonce: OTHER });
        resume(); await flush(); f.intervals.forEach(cb => cb());
        assert.deepEqual(f.submissions, []);
    }
});
test('Ctrl/Meta Enter y Enter de servicios reutilizan el envío canónico con el texto exacto', async () => {
    for (const props of [{ ctrlKey: true }, { metaKey: true }, {}]) {
        const f = installedFixture(); let loaded = false;
        f.api.bind({ owner: OWNER, nonce: NONCE }); await flush();
        f.root.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.esConsultaServicios = text => /servicios/.test(text);
        f.root.HAIKU_LIBRO_RESERVA_V1.estado = () => ({ cargado: loaded });
        f.root.HAIKU_LIBRO_GOOGLE_V1 = { estado: () => ({ conectado: loaded, sincronizando: false }),
            async conectar() { loaded = true; return true; } };
        const text = 'Libro: revisa los servicios de diciembre 2026';
        f.sendKey(text, props); await flush();
        assert.deepEqual(f.submissions, [text]);
    }
});
test('las otras consultas no esperan descarga ni consultan Google', async () => {
    const f = installedFixture();
    f.api.bind({ owner: OWNER, nonce: NONCE }); await flush();
    f.root.HAIKU_LIBRO_RESERVA_V1.estado = () => ({ cargado: false });
    f.sendText('Haku, resumen del día');
    assert.deepEqual(f.submissions, ['Haku, resumen del día']);
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
