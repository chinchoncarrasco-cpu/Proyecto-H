const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const F = require('../js/haiku-libro-fuente-oficial-v1.js');
const code = fs.readFileSync(require.resolve('../js/supabase-libro-google-readonly-v1.js'), 'utf8');
const fileId = code.match(/const FILE_ID = "([^"]+)"/)[1];
const key = 'haikuLibroGoogleSesionV1';
const serverError = (status, code) => ({ data: null, error: { context: new Response(JSON.stringify({ code }), { status }) } });
const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const storage = (map, fail = false) => ({
    getItem(k) { if (fail) throw Error('Storage disabled'); return map.get(k) ?? null; },
    setItem(k, v) { if (fail) throw Error('Storage disabled'); map.set(k, v); },
    removeItem(k) { if (fail) throw Error('Storage disabled'); map.delete(k); }
});

function browser(options = {}) {
    const session = options.session || new Map(), local = options.local || new Map();
    const events = new EventTarget(), docEvents = new EventTarget(), timers = new Map(), intervals = new Map();
    const requests = [], serverRequests = [], loads = [], bytes = fs.readFileSync(require.resolve('./fixtures/libro-reconciliacion-oct26-real.xlsx'));
    let now = options.now ?? 1792886400000, seq = 0, oauth = 0, revokes = 0, callback, pendingOAuth;
    const meta = { id: fileId, name: 'Libro prueba.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        modifiedTime: '2026-10-25T00:00:00Z', version: '1', size: String(bytes.length),
        md5Checksum: createHash('md5').update(bytes).digest('hex'), sha256Checksum: createHash('sha256').update(bytes).digest('hex'),
        trashed: false, capabilities: { canDownload: true } };
    let state = { cargado: !!options.loaded, generacion: 0, version: null };
    const reader = { estado: () => ({ ...state }), listo: () => options.restoration || Promise.resolve(),
        async cargarDesdeGoogle(file) {
            loads.push(file); state = { ...state, generacion: state.generacion + 1 };
            state = { cargado: true, generacion: state.generacion,
                version: createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex') };
        } };
    reader.cargarDesdeGoogleParaVerificacion = reader.cargarDesdeGoogle;
    const root = { Date: class extends Date { static now() { return now; } }, File, Blob, Event, CustomEvent, AbortController,
        crypto: webcrypto, HAIKU_LIBRO_FUENTE_OFICIAL_V1: F, HAIKU_LIBRO_RESERVA_V1: reader,
        haikuSesion: options.user === null ? null : { auth: { id: options.user || 'usuario-a' }, usuario: { activo: true } },
        haikuSupabase: { auth: { onAuthStateChange(cb) { callback = cb; } } },
        sessionStorage: storage(session, options.failStorage), localStorage: storage(local, options.failStorage),
        document: { readyState: 'complete', visibilityState: 'visible',
            getElementById: id => id === 'seccion-libro-reserva' && options.readonly ? { dataset: { libroModo: 'informe-readonly' } } : null,
            querySelector: () => null, addEventListener: docEvents.addEventListener.bind(docEvents) },
        addEventListener: events.addEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
        setTimeout: (f, ms) => { timers.set(++seq, { f, ms }); return seq; }, clearTimeout: id => timers.delete(id),
        setInterval: (f, ms) => { intervals.set(++seq, { f, ms }); return seq; }, clearInterval: id => intervals.delete(id),
        google: { accounts: { oauth2: {
            initTokenClient(config) { const client = { callback: config.callback, requestAccessToken() {
                oauth++; pendingOAuth = () => client.callback({ access_token: 'token-ficticio-no-real', expires_in: 3600 });
                if (!options.delayOAuth) pendingOAuth();
            } }; return client; }, revoke(_token, done) { revokes++; done(); }
        } } },
        fetch: async (url, init) => {
            requests.push({ url, init });
            if (options.fetcher) return options.fetcher(url, init, meta, bytes);
            return url.includes('alt=media') ? new Response(bytes) : new Response(JSON.stringify(meta));
        }
    };
    if (options.server) {
        root.HAIKU_SUPABASE_CONFIG = { libroConexionServidor: true };
        root.haikuSupabase.functions = { async invoke(name, init) {
            assert.equal(name, 'haku-libro-enlace-readonly'); serverRequests.push(init);
            return options.serverFetcher ? options.serverFetcher(init, meta, bytes) :
                { data: init.body.accion === 'metadata' ? { ...meta } : new Blob([bytes]), error: null };
        } };
    }
    root.window = root; vm.runInNewContext(code, root);
    return { root, api: root.HAIKU_LIBRO_GOOGLE_V1, session, local, requests, serverRequests, loads, timers, intervals, meta,
        now: () => now, advance: ms => { now += ms; }, oauth: () => oauth, revokes: () => revokes, oauthReply: () => pendingOAuth(),
        event: name => events.dispatchEvent(new Event(name)),
        visibility(value) { root.document.visibilityState = value; docEvents.dispatchEvent(new Event('visibilitychange')); },
        auth(event, id) { callback(event, id ? { user: { id } } : null); },
        async idle() { for (let i = 0; i < 12; i++) await tick(); }
    };
}

test('F5 en la misma pestaña recupera el permiso vigente, consulta Google y no abre OAuth', async () => {
    const first = browser(); await first.api.conectar(); const stored = first.session.get(key);
    const next = browser({ session: first.session, local: first.local, now: first.now() + 120000 }); await next.idle();
    assert.equal(next.api.estado().conectado, true); assert.equal(next.oauth(), 0);
    assert.equal(next.loads.length, 1); assert.equal(next.session.get(key), stored);
    assert.equal([...next.intervals.values()][0].ms, 15000);
    assert.ok([...next.timers.values()].some(t => t.ms === 3420000));
    assert.doesNotMatch(JSON.stringify(next.api.estado()), /token-ficticio|access_token/);
    assert.ok([...first.local.keys()].every(k => !/sesion|token/i.test(k)));
});

test('la recuperación espera la sesión Haku validada y la restauración del Libro anterior', async () => {
    const first = browser(); await first.api.conectar();
    const restore = gate(), next = browser({ session: first.session, user: null, restoration: restore.promise });
    await next.idle(); assert.equal(next.requests.length, 0);
    next.root.haikuSesion = { auth: { id: 'usuario-a' }, usuario: { activo: true } };
    next.event('haiku:auth-ready'); await next.idle(); assert.equal(next.requests.length, 0);
    restore.resolve(); await next.idle(); assert.equal(next.loads.length, 1); assert.equal(next.oauth(), 0);
});

for (const change of ['vencida', 'otro usuario', 'otro cliente', 'otro archivo', 'token vacío', 'fecha falsa', 'demasiado futura', 'JSON inválido']) {
    test('no restaura una sesión ' + change, async () => {
        const first = browser(); await first.api.conectar();
        const value = JSON.parse(first.session.get(key));
        if (change === 'vencida') value.expiraEn = first.now() - 1;
        if (change === 'otro usuario') value.usuario = 'usuario-b';
        if (change === 'otro cliente') value.clientId = 'otro';
        if (change === 'otro archivo') value.fileId = 'otro';
        if (change === 'token vacío') value.token = '';
        if (change === 'fecha falsa') value.expiraEn = 'mañana';
        if (change === 'demasiado futura') value.expiraEn = first.now() + 86400000;
        first.session.set(key, change === 'JSON inválido' ? '{' : JSON.stringify(value));
        const next = browser({ session: first.session }); await next.idle();
        assert.equal(next.api.estado().conectado, false); assert.equal(next.oauth(), 0);
        assert.equal(next.requests.length, 0); assert.equal(next.session.has(key), false);
    });
}

test('Desconectar elimina el permiso y F5 no lo recupera', async () => {
    const first = browser(); await first.api.conectar(); first.api.desconectar();
    const next = browser({ session: first.session }); await next.idle();
    assert.equal(next.api.estado().conectado, false); assert.equal(next.requests.length, 0);
    assert.equal(first.revokes(), 1);
});

test('cerrar localmente el informe elimina su token sin revocar Google ni borrar la sesión del panel', async () => {
    const panel = browser(); await panel.api.conectar(); const stored = panel.session.get(key);
    const report = browser({ readonly: true, session: panel.session }); await report.api.conectar();
    report.api.desconectar({ revocar: false });
    assert.equal(report.api.estado().conectado, false); assert.equal(report.revokes(), 0);
    assert.equal(panel.session.get(key), stored); assert.equal(panel.api.estado().conectado, true);
});

for (const event of ['SIGNED_OUT', 'SIGNED_IN']) test(event + ' de salida/cambio de usuario borra el permiso y detiene polling', async () => {
    const b = browser(); await b.api.conectar(); b.auth(event, event === 'SIGNED_IN' ? 'usuario-b' : null);
    assert.equal(b.api.estado().conectado, false); assert.equal(b.session.has(key), false); assert.equal(b.intervals.size, 0);
});

test('renovar la sesión Supabase del mismo usuario no desconecta Google ni reinicia OAuth', async () => {
    const b = browser(); await b.api.conectar(); const before = b.session.get(key);
    b.auth('TOKEN_REFRESHED', 'usuario-a'); b.event('haiku:auth-ready'); await b.idle();
    assert.equal(b.api.estado().conectado, true); assert.equal(b.session.get(key), before); assert.equal(b.oauth(), 1);
});

test('vencimiento elimina la sesión; F5 no amplía el permiso ni solicita OAuth automáticamente', async () => {
    const b = browser(); await b.api.conectar();
    [...b.timers.values()].find(t => t.ms === 3540000).f();
    assert.equal(b.session.has(key), false); assert.equal(b.api.estado().conectado, false); assert.equal(b.intervals.size, 0);
    const next = browser({ session: b.session }); await next.idle(); assert.equal(next.oauth(), 0);
});

test('almacenamiento bloqueado no rompe conexión, lectura ni desconexión', async () => {
    const b = browser({ failStorage: true }); await b.api.conectar();
    assert.equal(b.api.estado().conectado, true); assert.equal(b.loads.length, 1);
    await b.api.sincronizar(); assert.equal(b.loads.length, 2); b.api.desconectar();
});

test('informe readonly no restaura ni modifica la sesión guardada del panel', async () => {
    const first = browser(); await first.api.conectar(); const stored = first.session.get(key);
    const next = browser({ session: first.session, readonly: true }); await next.idle();
    assert.equal(next.requests.length, 0); await next.api.conectar(); next.api.desconectar();
    assert.equal(next.session.get(key), stored); assert.equal(next.local.size, 0);
});

test('401 al recuperar invalida el permiso; una caída de red lo conserva para reintentar', async () => {
    for (const status of [401, 503]) {
        const first = browser(); await first.api.conectar();
        const next = browser({ session: first.session, fetcher: async () => new Response('', { status }) }); await next.idle();
        assert.equal(next.api.estado().conectado, status !== 401); assert.equal(next.session.has(key), status !== 401);
        assert.equal(next.api.estado().sincronizando, false); assert.equal(next.oauth(), 0);
    }
});

test('volver a la pestaña o recuperar internet comprueba cambios sin esperar al próximo intervalo', async () => {
    const b = browser(); await b.api.conectar(); const before = b.requests.length;
    b.advance(4000); b.visibility('hidden'); await b.idle(); assert.equal(b.requests.length, before);
    b.meta.version = '2'; b.visibility('visible'); b.event('focus'); await b.idle();
    assert.equal(b.requests.length, before + 2); assert.equal(b.loads.length, 2);
    b.advance(4000); b.event('online'); await b.idle(); assert.equal(b.requests.length, before + 3);
    assert.equal(b.loads.length, 2); // Mismo archivo: sólo metadata, sin aviso duplicado.
});

test('un cambio de versión con igual fecha se reintenta si falla la descarga', async () => {
    let fail = false;
    const b = browser({ fetcher: async (url, _init, meta, bytes) => url.includes('alt=media')
        ? new Response(fail ? '' : bytes, { status: fail ? 503 : 200 }) : new Response(JSON.stringify(meta)) });
    await b.api.conectar(); b.meta.version = '2'; fail = true;
    [...b.intervals.values()][0].f(); await b.idle(); assert.equal(b.loads.length, 1);
    fail = false; [...b.intervals.values()][0].f(); await b.idle(); assert.equal(b.loads.length, 2);
});

test('al recargar, una fecha idéntica no basta para confiar en una copia sin SHA-256 coincidente', async () => {
    const first = browser(); await first.api.conectar();
    const next = browser({ session: first.session, local: first.local, loaded: true }); await next.idle();
    assert.equal(next.loads.length, 1); assert.equal(next.oauth(), 0);
});

test('logout durante la descarga descarta el body tardío también en el panel normal', async () => {
    const body = gate();
    const b = browser({ fetcher: async url => url.includes('alt=media')
        ? { ok: true, status: 200, arrayBuffer: () => body.promise }
        : new Response(JSON.stringify(b.meta)) });
    const connecting = b.api.conectar(); await b.idle(); b.auth('SIGNED_OUT');
    body.resolve(new Uint8Array([1, 2, 3]).buffer); await connecting;
    assert.equal(b.loads.length, 0); assert.equal(b.session.has(key), false);
});

test('timeout de red libera la sincronización y permite un siguiente intento', async () => {
    let hang = true;
    const b = browser({ fetcher: async (url, init, meta, bytes) => {
        if (hang) return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Error('timeout'))));
        return new Response(url.includes('alt=media') ? bytes : JSON.stringify(meta));
    } });
    const connecting = b.api.conectar(); await b.idle();
    [...b.timers.values()].find(t => t.ms === 30000).f(); await connecting;
    assert.equal(b.api.estado().sincronizando, false); assert.equal(b.api.estado().conectado, true);
    hang = false; await b.api.sincronizar(); assert.equal(b.loads.length, 1);
});

for (const event of ['SIGNED_OUT', 'SIGNED_IN']) test(event + ' durante autorización descarta una respuesta OAuth tardía', async () => {
    const b = browser({ delayOAuth: true }); const connecting = b.api.conectar(); await b.idle();
    b.auth(event, event === 'SIGNED_IN' ? 'usuario-b' : null); b.oauthReply(); await connecting;
    assert.equal(b.api.estado().conectado, false); assert.equal(b.session.has(key), false); assert.equal(b.requests.length, 0);
});

test('servidor: conexión automática y F5 descargan sin permiso personal ni almacenamiento de credenciales', async () => {
    const b = browser({ server: true }); await b.idle();
    assert.equal(b.api.estado().conexion, 'servidor-enlace'); assert.equal(b.api.estado().conectado, true);
    assert.equal(b.loads.length, 1); assert.equal(b.oauth(), 0); assert.equal(b.requests.length, 0); assert.equal(b.session.size, 0);
    const reload = browser({ server: true, session: b.session, local: b.local }); await reload.idle();
    assert.equal(reload.api.estado().conectado, true); assert.equal(reload.loads.length, 1); assert.equal(reload.oauth(), 0);
});
test('servidor: sigue conectado tras una jornada y comprueba cambios por versión', async () => {
    const b = browser({ server: true }); await b.idle(); b.advance(12 * 3600000);
    b.meta.version = '2'; b.event('focus'); await b.idle();
    assert.equal(b.api.estado().conectado, true); assert.equal(b.loads.length, 2); assert.equal(b.oauth(), 0);
    assert.equal([...b.timers.values()].some(t => t.ms > 30000), false);
});
test('servidor: espera auth de Haku y restauración del Libro antes de cargarlo', async () => {
    const restore = gate(); const b = browser({ server: true, user: null, restoration: restore.promise }); await b.idle();
    assert.equal(b.serverRequests.length, 0);
    b.root.haikuSesion = { auth: { id: 'usuario-a' }, usuario: { activo: true } };
    b.event('haiku:auth-ready'); await b.idle(); assert.equal(b.loads.length, 0);
    restore.resolve(); await b.idle(); assert.equal(b.loads.length, 1); assert.equal(b.oauth(), 0);
});
test('servidor: auth-ready y foco con hash idéntico no vuelven a cargar un archivo sin cambios', async () => {
    const b = browser({ server: true }); await b.idle();
    b.meta.sha256Checksum = b.root.HAIKU_LIBRO_RESERVA_V1.estado().version;
    const calls = b.serverRequests.length; b.event('haiku:auth-ready'); await b.idle();
    assert.equal(b.serverRequests.length, calls); assert.equal(b.loads.length, 1);
    b.advance(4000); b.event('focus'); await b.idle(); assert.equal(b.loads.length, 1);
});
test('servidor: comparación y vigencia conservan handles opacos y checksums', async () => {
    const b = browser({ server: true }); await b.idle();
    const handle = await b.api.obtenerFuenteVerificada();
    assert.ok(b.api.fuenteVerificada(handle)); await b.api.verificarVigencia(handle);
    b.meta.version = '2'; await assert.rejects(() => b.api.verificarVigencia(handle), { code: 'FUENTE_CAMBIADA' });
    assert.equal(b.oauth(), 0);
});
test('servidor: Pausar detiene consultas y Conectar Libro reanuda sin Google', async () => {
    const b = browser({ server: true }); await b.idle(); b.api.desconectar();
    const calls = b.serverRequests.length; b.event('haiku:auth-ready'); b.event('focus'); await b.idle();
    assert.equal(b.serverRequests.length, calls); assert.equal(b.api.estado().conectado, false); assert.equal(b.intervals.size, 0);
    await b.api.conectar(); assert.equal(b.api.estado().conectado, true); assert.equal(b.oauth(), 0); assert.equal(b.revokes(), 0);
});
test('servidor: logout durante la conexión descarta metadata tardía sin iniciar OAuth', async () => {
    const wait = gate(); const b = browser({ server: true, serverFetcher: async (_init, meta) => {
        await wait.promise; return { data: meta, error: null };
    } });
    const connecting = b.api.conectar(); await b.idle(); b.root.haikuSesion = null; b.auth('SIGNED_OUT');
    wait.resolve(); await connecting; await b.idle();
    assert.equal(b.loads.length, 0); assert.equal(b.api.estado().conectado, false); assert.equal(b.oauth(), 0);
});
test('servidor: logout durante descarga descarta bytes tardíos', async () => {
    const wait = gate(); const b = browser({ server: true, serverFetcher: async (init, meta, bytes) => {
        if (init.body.accion === 'metadata') return { data: meta, error: null };
        await wait.promise; return { data: new Blob([bytes]), error: null };
    } }); await b.idle(); b.root.haikuSesion = null; b.auth('SIGNED_OUT'); wait.resolve(); await b.idle();
    assert.equal(b.loads.length, 0); assert.equal(b.api.estado().conectado, false); assert.equal(b.intervals.size, 0);
});
test('servidor: 401 cierra acceso; 503 de red permite reintentar sin OAuth', async () => {
    for (const status of [401, 503]) {
        let failing = false;
        const b = browser({ server: true, serverFetcher: async (init, meta, bytes) => failing
            ? serverError(status, 'GOOGLE_TEMPORARY_ERROR') : { data: init.body.accion === 'metadata' ? meta : new Blob([bytes]), error: null } });
        await b.idle(); failing = true; await b.api.sincronizar();
        assert.equal(b.api.estado().conectado, status !== 401); assert.equal(b.oauth(), 0);
        failing = false; await b.api.conectar(); assert.equal(b.api.estado().conectado, true);
    }
});
test('servidor sin configurar conserva conexión Google previa como transición', async () => {
    const first = browser(); await first.api.conectar();
    const b = browser({ server: true, session: first.session, serverFetcher: async () => serverError(503, 'CONFIGURACION_PENDIENTE') });
    await b.idle(); assert.equal(b.api.estado().conexion, 'google-personal'); assert.equal(b.api.estado().conectado, true);
    assert.equal(b.oauth(), 0);
});
test('servidor: acceso al enlace retirado muestra fallo y no intenta obtener permiso personal', async () => {
    const b = browser({ server: true, serverFetcher: async () => serverError(502, 'GOOGLE_ACCESS_DENIED') });
    await b.idle(); await b.api.conectar(); assert.equal(b.oauth(), 0); assert.equal(b.loads.length, 0);
});
test('servidor: informe readonly no persiste permisos ni afecta al token guardado del panel', async () => {
    const first = browser(); await first.api.conectar(); const previous = first.session.get(key);
    const b = browser({ server: true, readonly: true, session: first.session }); await b.idle();
    assert.equal(b.loads.length, 1); assert.equal(b.local.size, 0); assert.equal(b.session.get(key), previous);
    b.api.desconectar({ revocar: false }); assert.equal(b.session.get(key), previous); assert.equal(b.revokes(), 0);
});
