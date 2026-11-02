const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const API = require('../js/sites-libro-comparacion-readonly-v1.js');
const Fuente = require('../js/haiku-libro-fuente-oficial-v1.js');
const connector = fs.readFileSync(require.resolve('../js/supabase-libro-google-readonly-v1.js'), 'utf8');
const permissions = ['reservas.ver', 'pagos.ver', 'servicios.ver'];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function controller(options = {}) {
    const published = [], cleared = [];
    let user = 'usuario-ficticio-a', token = 'token-ficticio-no-publicar', sessions = 0;
    const client = { auth: {
        getSession: async () => {
            sessions++;
            if (options.sessionGate && sessions === 2) await options.sessionGate.promise;
            return { data: { session: user ? { user: { id: user }, access_token: token } : null }, error: null };
        },
        getUser: async () => ({ data: { user: { id: user } }, error: options.getUserError || null }),
        signOut: async () => { user = null; }
    }, rpc: async () => {
        if (options.rpcGate) await options.rpcGate.promise;
        if (options.rotateToken) token = 'otro-token-ficticio';
        return { data: { usuario: { id: options.rpcUser || user, activo: options.active !== false },
            permisos: options.permissions || permissions, roles: [{ codigo: 'recepcion' }] }, error: options.rpcError || null };
    } };
    const google = { estado: () => ({ conectado: false, sincronizando: false }), desconectar() {} };
    const control = API.crearControlador({ cliente: client, google, lector: { limpiar: async () => {} }, nucleo: {},
        sesionVerificada: value => published.push(value), limpiarSesionVerificada: () => cleared.push(true) });
    return { control, client, published, cleared, setUser: id => { user = id; } };
}

test('publica identidad canónica sólo después de Auth, RPC y sesión final; no publica tokens', async () => {
    const wait = gate(), x = controller({ sessionGate: wait });
    const pending = x.control.comprobarSesion(); await tick();
    assert.equal(x.published.length, 0);
    wait.resolve(); await pending;
    assert.equal(x.published.length, 1);
    assert.deepEqual(x.published[0], { auth: { id: 'usuario-ficticio-a' },
        usuario: { id: 'usuario-ficticio-a', activo: true }, roles: [{ codigo: 'recepcion' }], permisos: permissions });
    assert.doesNotMatch(JSON.stringify(x.published), /token-ficticio|access_token|refresh_token/);
});

for (const [name, options] of [
    ['RPC de otro usuario', { rpcUser: 'usuario-ficticio-b' }],
    ['usuario inactivo', { active: false }],
    ['permisos insuficientes', { permissions: ['reservas.ver'] }],
    ['Auth rechazado', { getUserError: { message: 'NO_MOSTRAR' } }],
    ['RPC rechazado', { rpcError: { message: 'NO_MOSTRAR' } }],
    ['credencial rotada durante la validación', { rotateToken: true }]
]) test(name + ': no publica contexto y limpia el anterior', async () => {
    const x = controller(options); await x.control.comprobarSesion();
    assert.equal(x.published.length, 0); assert.ok(x.cleared.length > 0);
    assert.equal(x.control.estado().acceso, false);
});

test('logout mientras RPC está pendiente no publica una identidad tardía', async () => {
    const wait = gate(), x = controller({ rpcGate: wait });
    const pending = x.control.comprobarSesion(); await tick();
    x.setUser(null); x.control.cambioSesion('SIGNED_OUT', null); wait.resolve(); await pending;
    assert.equal(x.published.length, 0); assert.equal(x.control.estado().acceso, false);
});

test('invalidar el resultado antes de Conectar conserva la identidad validada', async () => {
    const x = controller(); await x.control.comprobarSesion();
    x.control.invalidar('google_desconectado');
    assert.equal(x.published.length, 1); assert.equal(x.cleared.length, 0);
    assert.equal(x.control.estado().acceso, true);
});

for (const action of ['logout', 'otra cuenta', 'destruir', 'cerrarSesion']) test(action + ' limpia la identidad del informe', async () => {
    const x = controller(); await x.control.comprobarSesion();
    if (action === 'logout') x.control.cambioSesion('SIGNED_OUT', null);
    else if (action === 'otra cuenta') x.control.cambioSesion('SIGNED_IN', { user: { id: 'usuario-ficticio-b' } });
    else await x.control[action]();
    assert.equal(x.cleared.length, 1); assert.equal(x.control.estado().acceso, false);
});

function page(options = {}) {
    const events = new EventTarget(), documentEvents = new Map(), elements = new Map(), authObservers = [];
    const requests = [], published = [], loads = [], timers = new Map(); let seq = 0, oauth = 0;
    let user = 'usuario-ficticio-a', loaded = false;
    const bytes = Buffer.from('XLSX ficticio; la prueba no usa datos productivos');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const metadata = { id: '1ZX4KqcdY6LORafrI6NkqwT3hGxrdK2rk', name: 'Libro ficticio.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', version: '1',
        modifiedTime: '2026-11-02T12:00:00Z', size: String(bytes.length), sha256Checksum: hash,
        trashed: false, capabilities: { canDownload: true } };
    const node = () => ({ dataset: {}, hidden: false, disabled: false, textContent: '',
        addEventListener() {}, removeEventListener() {}, replaceChildren() {} });
    for (const id of ['informe-resultado', 'informe-comparar', 'informe-estado', 'informe-periodo',
        'informe-login', 'informe-salir', 'informe-reintentar', 'seccion-libro-reserva']) elements.set(id, node());
    elements.get('seccion-libro-reserva').dataset.libroModo = 'informe-readonly';
    const reader = { modo: 'informe-readonly-solo-memoria', listo: async () => {},
        estado: () => ({ cargado: loaded, version: loaded ? hash : null, generacion: loads.length }),
        async cargarDesdeGoogle(file) { loads.push(file); loaded = true; },
        async limpiar() { loaded = false; }
    };
    const root = { Date, File, Blob, Event, CustomEvent, AbortController, crypto: webcrypto,
        HAIKU_LIBRO_FUENTE_OFICIAL_V1: Fuente, HAIKU_LIBRO_RESERVA_V1: reader,
        HAIKU_LIBRO_COMPARACION_READONLY_V1: { crearNucleo: () => ({}) },
        HAIKU_SUPABASE_CONFIG: { libroConexionServidor: true },
        haikuSupabase: { auth: {
            getSession: async () => ({ data: { session: user ? { user: { id: user }, access_token: 'token-ficticio' } : null }, error: null }),
            getUser: async () => ({ data: { user: { id: user } }, error: null }),
            onAuthStateChange(callback) { authObservers.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
            signOut: async () => { user = null; }
        }, rpc: async () => {
            if (options.rpcGate) await options.rpcGate.promise;
            return { data: { usuario: { id: user, activo: true }, permisos: options.permissions || permissions }, error: null };
        },
        functions: { async invoke(name, init) {
            requests.push({ name, action: init.body.accion });
            if (options.serverGate) await options.serverGate.promise;
            return { data: init.body.accion === 'metadata' ? { ...metadata } : new Blob([bytes]), error: null };
        } } },
        document: { readyState: 'complete', visibilityState: 'visible', getElementById: id => elements.get(id) || null,
            querySelector: () => null,
            addEventListener(name, callback) { const callbacks = documentEvents.get(name) || []; callbacks.push(callback); documentEvents.set(name, callbacks); },
            removeEventListener(name, callback) { documentEvents.set(name, (documentEvents.get(name) || []).filter(fn => fn !== callback)); }
        },
        addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
        setTimeout(callback, ms) { timers.set(++seq, { callback, ms }); return seq; }, clearTimeout: id => timers.delete(id),
        setInterval(callback, ms) { timers.set(++seq, { callback, ms }); return seq; }, clearInterval: id => timers.delete(id),
        google: { accounts: { oauth2: { initTokenClient() { oauth++; throw Error('GIS no debe iniciarse'); } } } },
        fetch: async () => { throw Error('No debe consultar Google directamente'); }
    };
    root.window = root;
    root.addEventListener('haiku:auth-ready', event => published.push(event.detail));
    vm.runInNewContext(connector, root);
    assert.equal(root.haikuSesion, undefined, 'El informe empieza sin el global que crea el panel');
    API.instalar(root);
    return { root, requests, published, loads, elements, oauth: () => oauth,
        async idle() { for (let i = 0; i < 15; i++) await tick(); },
        auth(event, id) { user = id; for (const callback of authObservers) callback(event, id ? { user: { id } } : null); },
        async connectClick() {
            const event = { target: { closest: () => ({ id: 'haiku-libro-google-conectar' }) }, preventDefault() { this.blocked = true; }, stopImmediatePropagation() {} };
            for (const callback of documentEvents.get('click') || []) callback(event);
            if (!event.blocked) await root.HAIKU_LIBRO_GOOGLE_V1.conectar();
        },
        destroy() { root.dispatchEvent(new Event('pagehide')); }
    };
}

test('productor y conector reales: la sesión del informe activa servidor sin GIS ni token bridge', async t => {
    const x = page(); t.after(() => x.destroy()); await x.idle();
    assert.equal(x.root.haikuSesion.auth.id, 'usuario-ficticio-a');
    assert.equal(x.root.HAIKU_LIBRO_GOOGLE_V1.estado().conexion, 'servidor-enlace');
    assert.equal(x.root.HAIKU_LIBRO_GOOGLE_V1.estado().conectado, true);
    assert.ok(x.requests.some(r => r.action === 'metadata')); assert.ok(x.requests.some(r => r.action === 'descargar'));
    assert.equal(x.loads.length, 1); assert.equal(x.oauth(), 0);
    assert.ok(x.requests.every(r => r.name === 'haku-libro-enlace-readonly'));
    assert.doesNotMatch(JSON.stringify(x.published), /access_token|token-ficticio|refresh_token/);
    x.root.HAIKU_LIBRO_GOOGLE_V1.desconectar({ revocar: false });
    await x.connectClick(); await x.idle();
    assert.equal(x.root.HAIKU_LIBRO_GOOGLE_V1.estado().conectado, true, 'El click no elimina el contexto validado');
    assert.equal(x.oauth(), 0);
});

test('permisos rechazados en informe no publican identidad ni llaman al servidor o GIS', async t => {
    const x = page({ permissions: ['reservas.ver'] }); t.after(() => x.destroy()); await x.idle();
    await x.connectClick();
    assert.equal(x.root.haikuSesion, undefined); assert.equal(x.published.length, 0);
    assert.equal(x.requests.length, 0); assert.equal(x.oauth(), 0);
});

test('renovar Auth del mismo usuario conserva el enlace servidor y revalida el contexto', async t => {
    const x = page(); t.after(() => x.destroy()); await x.idle();
    const previous = x.root.haikuSesion;
    x.auth('TOKEN_REFRESHED', 'usuario-ficticio-a');
    await new Promise(resolve => setTimeout(resolve, 0)); await x.idle();
    assert.equal(x.root.haikuSesion.auth.id, 'usuario-ficticio-a');
    assert.notEqual(x.root.haikuSesion, previous);
    assert.equal(x.root.HAIKU_LIBRO_GOOGLE_V1.estado().conexion, 'servidor-enlace');
    assert.equal(x.root.HAIKU_LIBRO_GOOGLE_V1.estado().conectado, true);
    assert.equal(x.oauth(), 0);
});

test('logout invalida metadata tardía y elimina únicamente el contexto del informe', async t => {
    const wait = gate(), x = page({ serverGate: wait }); t.after(() => x.destroy()); await x.idle();
    assert.equal(x.requests.length, 1); x.auth('SIGNED_OUT', null); wait.resolve(); await x.idle();
    assert.equal(x.root.haikuSesion, null); assert.equal(x.root.HAIKU_LIBRO_GOOGLE_V1.estado().conectado, false);
    assert.equal(x.loads.length, 0); assert.equal(x.oauth(), 0);
});

test('al destruir, no restaura ni borra contexto reemplazado por otro consumidor', async t => {
    const x = page(); t.after(() => x.destroy()); await x.idle();
    const replacement = { auth: { id: 'otro-contexto' }, usuario: { id: 'otro-contexto', activo: true } };
    x.root.haikuSesion = replacement; x.destroy();
    assert.equal(x.root.haikuSesion, replacement);
});

test('no sobrescribe contexto ajeno que se publica mientras valida el acceso', async t => {
    const wait = gate(), x = page({ rpcGate: wait }); t.after(() => x.destroy()); await x.idle();
    const replacement = { auth: { id: 'usuario-ficticio-a' }, usuario: { id: 'usuario-ficticio-a', activo: true } };
    x.root.haikuSesion = replacement; wait.resolve(); await x.idle();
    assert.equal(x.root.haikuSesion, replacement); assert.equal(x.published.length, 0);
    assert.equal(x.requests.length, 0); assert.equal(x.oauth(), 0);
    assert.equal(x.elements.get('informe-comparar').disabled, true);
});
