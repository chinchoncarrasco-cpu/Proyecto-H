const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const F = require('../js/haiku-libro-fuente-oficial-v1.js');
const googleCode = fs.readFileSync(path.join(__dirname, '../js/supabase-libro-google-readonly-v1.js'), 'utf8');
const fileId = googleCode.match(/const FILE_ID = "([^"]+)"/)[1];
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/libro-reconciliacion-oct26-real.xlsx'));
const hash = algorithm => createHash(algorithm).update(bytes).digest('hex');
const original = () => ({ id: fileId, name: 'Libro ficticio.xlsx', mimeType: mime,
    modifiedTime: '2026-10-09T12:00:00Z', size: String(bytes.length), version: '77',
    md5Checksum: hash('md5'), sha256Checksum: hash('sha256'), trashed: false, capabilities: { canDownload: true } });
const deferred = () => { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve }; };
const rechazo = (promise, code) => assert.rejects(promise, e => e instanceof F.FuenteOficialError && e.code === code);

function fixture(options = {}) {
    let control, carga = Promise.resolve(), lecturas = 0, descargas = 0, cargas = 0, autorizado = true;
    let estado = { cargado: false, nombre: '', version: null, generacion: 0 };
    const libro = { estado: () => ({ ...estado }), listo: () => carga, listarHojas: () => ['Oct26'],
        consultarHoja: options.query ?? (async () => ({ fixture: true })),
        cargarDesdeGoogle(archivo) {
            cargas++; control.cambioLibro(); estado.generacion++; estado.cargado = false;
            options.alIniciar?.(control, estado);
            const generacion = estado.generacion;
            carga = (async () => {
                if (options.esperaCarga) await options.esperaCarga.promise;
                if (options.errorCarga) throw new Error('CONTENIDO_PRIVADO_NO_EXPORTAR');
                if (generacion !== estado.generacion) return;
                const buffer = await archivo.arrayBuffer();
                estado = { ...estado, nombre: archivo.name, cargado: true,
                    version: createHash('sha256').update(new Uint8Array(buffer)).digest('hex') };
                options.alCargar?.(estado);
                control.vistaLibro({ origen: 'google', cargado: true });
            })();
            return carga;
        } };
    libro.cargarDesdeGoogleParaVerificacion = libro.cargarDesdeGoogle;
    let lector = libro;
    control = F.crearControlador({ fileId, lector: () => lector, autorizado: () => autorizado, crypto: webcrypto,
        ahora: () => Date.parse('2026-10-09T12:30:00Z'), timeoutMs: options.timeoutMs ?? 2000,
        obtenerMetadata: async signal => { lecturas++; return options.metadata ? options.metadata(lecturas, signal) : original(); },
        descargar: async (metadata, signal) => { descargas++; if (options.descargar) return options.descargar(metadata, signal);
            return new File([options.bytes ?? bytes], metadata.name, { type: mime }); },
        entregar: (archivo, reader) => reader.cargarDesdeGoogleParaVerificacion(archivo) });
    return { control, libro, stats: () => ({ lecturas, descargas, cargas }), estado: () => estado,
        perderAuth: () => { autorizado = false; control.invalidar(); }, expirar: () => { autorizado = false; },
        reemplazarLector: () => { lector = { ...libro }; },
        manual: () => { control.cambioLibro(); estado.generacion++; estado.cargado = true; estado.version = hash('sha256');
            estado.nombre = original().name; control.vistaLibro({ origen: 'manual', cargado: true }); },
        limpiar: () => { control.cambioLibro(); estado.generacion++; estado.cargado = false; estado.version = null; } };
}

test('M0 → descarga → hashes → M1 → carga confirmada produce handle opaco y fachada sólo lectura', async () => {
    const x = fixture(), h = await x.control.obtener(), fuente = x.control.fuente(h);
    assert.equal(JSON.stringify(h), '{}'); assert.ok(Object.isFrozen(h)); assert.ok(Object.isFrozen(fuente));
    assert.equal(fuente.tipo, 'google-drive-oficial-verificado'); assert.equal(fuente.version, hash('sha256'));
    assert.equal(fuente.generacion, 1); assert.equal(fuente.verifiedAt, '2026-10-09T12:30:00.000Z');
    assert.equal(fuente.libro.estado().version, fuente.version);
    assert.deepEqual(fuente.libro.listarHojas(), ['Oct26']);
    assert.equal(fuente.libro.cargarDesdeGoogle, undefined); assert.equal(fuente.libro.limpiar, undefined);
    assert.equal(fuente.libro.cargarDesdeGoogleParaVerificacion, undefined);
    assert.deepEqual(x.stats(), { lecturas: 2, descargas: 1, cargas: 1 });
    assert.doesNotMatch(JSON.stringify(fuente), /token|cookie|bytes|reserva_id|estadia_id|contenido_privado/i);
});
test('un lector antiguo sin carga de verificación falla cerrado sin iniciar descargas ni informes', async () => {
    const x = fixture(); delete x.libro.cargarDesdeGoogleParaVerificacion;
    await rechazo(x.control.obtener(), 'LECTOR_NO_CONFIRMADO'); assert.deepEqual(x.stats(), { lecturas: 0, descargas: 0, cargas: 0 });
});

for (const [label, patch, code] of [
    ['ID', { id: 'otro-libro' }, 'FUENTE_INVALIDA'], ['MIME', { mimeType: 'text/plain' }, 'FUENTE_INVALIDA'],
    ['capacidad ausente', { capabilities: {} }, 'FUENTE_INVALIDA'], ['no descargable', { capabilities: { canDownload: false } }, 'FUENTE_INVALIDA'],
    ['papelera', { trashed: true }, 'FUENTE_INVALIDA'], ['papelera desconocida', { trashed: undefined }, 'FUENTE_INVALIDA'],
    ['version ausente', { version: undefined }, 'FUENTE_INVALIDA'], ['version unsafe number', { version: 77 }, 'FUENTE_INVALIDA'],
    ['version int64 excesiva', { version: '9223372036854775808' }, 'FUENTE_INVALIDA'],
    ['tamaño ausente', { size: undefined }, 'FUENTE_INVALIDA'], ['tamaño cero', { size: '0' }, 'FUENTE_INVALIDA'],
    ['tamaño sobre 8 MiB', { size: String(F.MAX_BYTES + 1) }, 'FUENTE_DEMASIADO_GRANDE'],
    ['fecha inválida', { modifiedTime: 'no-fecha' }, 'FUENTE_INVALIDA'],
    ['sin checksums', { md5Checksum: undefined, sha256Checksum: undefined }, 'FUENTE_NO_VERIFICABLE'],
    ['MD5 inválido', { md5Checksum: 'xyz' }, 'FUENTE_INVALIDA'], ['SHA inválido', { sha256Checksum: 'xyz' }, 'FUENTE_INVALIDA']
]) test('M0 rechaza ' + label + ' sin descarga ni carga', async () => {
    const x = fixture({ metadata: () => ({ ...original(), ...patch }) }); await rechazo(x.control.obtener(), code);
    assert.deepEqual(x.stats(), { lecturas: 1, descargas: 0, cargas: 0 });
});
for (const key of ['md5Checksum', 'sha256Checksum']) test('valida checksum disponible ' + key, async () => {
    const x = fixture({ metadata: () => ({ ...original(), [key === 'md5Checksum' ? 'sha256Checksum' : 'md5Checksum']: undefined }) });
    assert.equal(x.control.fuente(await x.control.obtener()).version, hash('sha256'));
});
for (const key of ['md5Checksum', 'sha256Checksum']) test('ningún checksum contradictorio se ignora: ' + key, async () => {
    const x = fixture({ metadata: () => ({ ...original(), [key]: '0'.repeat(key === 'md5Checksum' ? 32 : 64) }) });
    await rechazo(x.control.obtener(), 'CHECKSUM_INVALIDO'); assert.equal(x.stats().cargas, 0);
});
for (const content of [Buffer.alloc(0), bytes.subarray(0, bytes.length - 1)]) test('descarga vacía/incompleta no llega al lector: ' + content.length, async () => {
    const x = fixture({ bytes: content }); await rechazo(x.control.obtener(), 'FUENTE_INVALIDA'); assert.equal(x.stats().cargas, 0);
});
test('un CSV con MIME/nombre XLSX y checksums coincidentes no se certifica ni se carga', async () => {
    const csv = Buffer.from('cabana,fecha\n1,2026-10-09\n');
    const x = fixture({ bytes: csv, metadata: () => ({ ...original(), size: String(csv.length),
        md5Checksum: createHash('md5').update(csv).digest('hex'), sha256Checksum: createHash('sha256').update(csv).digest('hex') }) });
    await rechazo(x.control.obtener(), 'FUENTE_INVALIDA'); assert.equal(x.stats().cargas, 0);
});
for (const [key, value] of [['version', '78'], ['modifiedTime', '2026-10-09T13:00:00Z'], ['name', 'Otro nombre.xlsx'],
    ['size', String(bytes.length + 1)], ['md5Checksum', '0'.repeat(32)], ['sha256Checksum', '0'.repeat(64)]])
    test('M0/M1 detecta cambio de ' + key + ' antes de cargar', async () => {
        const x = fixture({ metadata: n => ({ ...original(), ...(n > 1 ? { [key]: value } : {}) }) });
        await rechazo(x.control.obtener(), 'FUENTE_CAMBIADA'); assert.equal(x.stats().cargas, 0);
    });
test('version int64 se conserva exactamente y checksums en mayúsculas se normalizan', async () => {
    const x = fixture({ metadata: () => ({ ...original(), version: '9223372036854775807', md5Checksum: hash('md5').toUpperCase() }) });
    await x.control.obtener();
});
for (const [label, alCargar] of [['hash distinto', estado => { estado.version = '0'.repeat(64); }],
    ['generación distinta', estado => { estado.generacion++; }], ['no cargado', estado => { estado.cargado = false; }]])
    test('confirmación del lector rechaza ' + label, async () => {
        const x = fixture({ alCargar }); await assert.rejects(x.control.obtener());
        assert.throws(() => x.control.fuente({}), { code: 'FUENTE_CAMBIADA' });
    });
test('no certifica mientras la carga real sigue pendiente', async () => {
    const gate = deferred(), x = fixture({ esperaCarga: gate }); let terminado = false;
    const result = x.control.obtener().then(h => { terminado = true; return h; });
    while (x.stats().cargas === 0) await new Promise(ok => setImmediate(ok));
    assert.equal(terminado, false); assert.throws(() => x.control.fuente({}), { code: 'FUENTE_CAMBIADA' });
    gate.resolve(); await result;
});
test('error del lector se sanitiza y no produce éxito', async () => {
    const x = fixture({ errorCarga: true }); await rechazo(x.control.obtener(), 'GOOGLE_ERROR');
});
for (const action of ['manual', 'limpiar', 'reemplazarLector', 'perderAuth', 'expirar']) test('invalida sello ante ' + action, async () => {
    const x = fixture(), h = await x.control.obtener(); x[action]();
    assert.throws(() => x.control.fuente(h), F.FuenteOficialError);
    await assert.rejects(x.control.verificarVigencia(h));
});
test('copia manual con idéntico nombre/hash jamás certifica ni admite sello fabricado', async () => {
    const x = fixture(); x.manual();
    assert.throws(() => x.control.fuente({ tipo: 'google-drive-oficial-verificado', nombre: original().name,
        version: hash('sha256'), generacion: x.estado().generacion }), { code: 'FUENTE_CAMBIADA' });
    const h = await x.control.obtener(); x.manual(); assert.throws(() => x.control.fuente(h), { code: 'FUENTE_CAMBIADA' });
});
test('el handle es exclusivo de la instancia que lo emitió', async () => {
    const x = fixture(), y = fixture(), h = await x.control.obtener();
    assert.throws(() => y.control.fuente(h), { code: 'FUENTE_CAMBIADA' });
});
test('nueva descarga retira el sello anterior desde su inicio', async () => {
    const x = fixture(), h = await x.control.obtener(), next = x.control.obtener();
    assert.throws(() => x.control.fuente(h), { code: 'FUENTE_CAMBIADA' });
    await next;
});
test('solicitud tardía jamás certifica una fuente posterior', async () => {
    const gate = deferred(), x = fixture({ metadata: n => n === 1 ? gate.promise : original() });
    const old = x.control.obtener(), rejected = rechazo(old, 'SOLICITUD_OBSOLETA');
    const h = await x.control.obtener(); gate.resolve(original()); await rejected;
    assert.equal(x.control.fuente(h).version, hash('sha256')); assert.equal(x.stats().cargas, 1);
});
test('carga manual concurrente de los mismos bytes bloquea la certificación', async () => {
    const gate = deferred(), x = fixture({ esperaCarga: gate }), pending = x.control.obtener();
    const rejected = rechazo(pending, 'SOLICITUD_OBSOLETA');
    while (x.stats().cargas === 0) await new Promise(ok => setImmediate(ok));
    x.manual(); gate.resolve(); await rejected;
});
test('error externo nunca filtra mensaje, stack o causa y retira el sello anterior', async () => {
    let fail = false;
    const x = fixture({ metadata: () => { if (fail) throw new Error('TOKEN_FICTICIO_CONTENIDO_PRIVADO'); return original(); } });
    const h = await x.control.obtener(); fail = true;
    await assert.rejects(x.control.obtener(), e => { assert.equal(e.code, 'GOOGLE_ERROR');
        assert.doesNotMatch(e.message + e.stack + JSON.stringify(e), /TOKEN_FICTICIO_CONTENIDO_PRIVADO/); return true; });
    assert.throws(() => x.control.fuente(h), { code: 'FUENTE_CAMBIADA' });
});
test('timeout acotado aborta metadata y permite reintentar', async () => {
    let signal;
    const x = fixture({ timeoutMs: 20, metadata: (n, s) => { signal = s; return n === 1 ? new Promise(() => {}) : original(); } });
    await rechazo(x.control.obtener(), 'GOOGLE_TIMEOUT'); assert.ok(signal.aborted); await x.control.obtener();
});
test('M2 verifica metadata/hash/generación sin otra descarga y sin comparar', async () => {
    const x = fixture(), h = await x.control.obtener();
    assert.equal(await x.control.verificarVigencia(h), x.control.fuente(h));
    assert.deepEqual(x.stats(), { lecturas: 3, descargas: 1, cargas: 1 });
});
for (const key of ['version', 'generacion']) test('M2 comprueba ' + key + ' del lector antes de leer Drive', async () => {
    const x = fixture(), h = await x.control.obtener();
    x.estado()[key] = key === 'version' ? '0'.repeat(64) : 900;
    await rechazo(x.control.verificarVigencia(h), 'FUENTE_CAMBIADA'); assert.equal(x.stats().lecturas, 2);
});
test('M2 detecta carga manual durante su consulta', async () => {
    const gate = deferred(), x = fixture({ metadata: n => n === 3 ? gate.promise : original() }), h = await x.control.obtener();
    const check = x.control.verificarVigencia(h), rejected = rechazo(check, 'SOLICITUD_OBSOLETA');
    x.manual(); gate.resolve(original()); await rejected;
});
test('una consulta de la fachada no entrega datos si cambia la generación mientras espera', async () => {
    const gate = deferred(), x = fixture({ query: () => gate.promise }), h = await x.control.obtener();
    const lectura = x.control.fuente(h).libro.consultarHoja('Oct26'), rejected = rechazo(lectura, 'FUENTE_CAMBIADA');
    x.manual(); gate.resolve({ fixture: true }); await rejected;
});
test('la fachada también sanitiza errores del lector', async () => {
    const x = fixture({ query: async () => { throw new Error('NO_PUBLICAR_CONTENIDO'); } }), h = await x.control.obtener();
    await rechazo(x.control.fuente(h).libro.consultarHoja('Oct26'), 'LECTOR_NO_CONFIRMADO');
    assert.throws(() => x.control.fuente(h), { code: 'FUENTE_CAMBIADA' });
});
for (const [key, value] of [['version', '78'], ['md5Checksum', '0'.repeat(32)], ['sha256Checksum', '0'.repeat(64)], ['size', String(bytes.length + 1)]])
    test('M2 rechaza cambio de ' + key + ' y retira la fuente', async () => {
        const x = fixture({ metadata: n => ({ ...original(), ...(n === 3 ? { [key]: value } : {}) }) }), h = await x.control.obtener();
        await rechazo(x.control.verificarVigencia(h), 'FUENTE_CAMBIADA');
        assert.throws(() => x.control.fuente(h), { code: 'FUENTE_CAMBIADA' }); assert.equal(x.stats().descargas, 1);
    });
test('error SELECT equivalente de metadata M2 no se convierte en vigencia', async () => {
    const x = fixture({ metadata: n => { if (n === 3) throw new Error('NO_DIVULGAR'); return original(); } }), h = await x.control.obtener();
    await rechazo(x.control.verificarVigencia(h), 'GOOGLE_ERROR'); assert.throws(() => x.control.fuente(h));
});
test('polling invalida por version/checksum aunque modifiedTime sea idéntico', async () => {
    const x = fixture(), h = await x.control.obtener(); assert.equal(x.control.observarMetadata(original()), true);
    assert.equal(x.control.observarMetadata({ ...original(), version: '78' }), false); assert.throws(() => x.control.fuente(h));
});
for (const length of [1, 55, 56, 63, 64, 65, 512, 8193]) test('MD5 verificado contra Node en borde ' + length, () => {
    const input = Uint8Array.from({ length }, (_, i) => i * 71 % 256);
    assert.equal(F.md5Hex(input), createHash('md5').update(input).digest('hex'));
});
test('MD5 coincide con el algoritmo backend aprobado', async () => {
    const backend = await import('../supabase/functions/_shared/libroDriveChecksums.ts');
    assert.equal(F.md5Hex(bytes), backend.md5Hex(bytes));
});
for (const [label, body, headers, limit, code] of [
    ['cero', Buffer.alloc(0), {}, 4, 'FUENTE_INVALIDA'], ['Content-Length falso', Buffer.from([1]), { 'Content-Length': '2' }, 4, 'FUENTE_INVALIDA'],
    ['Content-Length excesivo', Buffer.from([1]), { 'Content-Length': '5' }, 4, 'FUENTE_DEMASIADO_GRANDE'],
    ['exceso sin header', Buffer.alloc(5), {}, 4, 'FUENTE_DEMASIADO_GRANDE'],
    ['header malformado', Buffer.from([1]), { 'Content-Length': 'x' }, 4, 'FUENTE_INVALIDA']
]) test('stream bounded rechaza ' + label, async () => {
    await rechazo(F.leerBytes(new Response(body, { headers }), limit), code);
});
test('stream acepta borde exacto y mide bytes reales con encoding', async () => {
    assert.equal((await F.leerBytes(new Response(Buffer.alloc(4)), 4)).length, 4);
    assert.equal((await F.leerBytes(new Response(Buffer.alloc(4), { headers: { 'Content-Length': '2', 'Content-Encoding': 'gzip' } }), 4)).length, 4);
});

// Runtime Web del conector real: no exporta acceso a su token; GIS/fetch son falsos.
function web(options = {}) {
    const x = fixture(), events = new EventTarget(), timers = new Map(), requests = [], logs = [];
    let tokenCallback, time = Date.parse('2026-10-09T12:30:00Z'), oauthRequests = 0, sequence = 0;
    const context = { HAIKU_LIBRO_FUENTE_OFICIAL_V1: F, HAIKU_LIBRO_RESERVA_V1: x.libro, crypto: webcrypto,
        Date: class extends Date { static now() { return time; } }, File, Event, CustomEvent,
        document: { readyState: 'complete', visibilityState: 'visible', getElementById: () => null, querySelector: () => null,
            addEventListener() {} }, localStorage: { getItem: () => original().modifiedTime, setItem() {} },
        addEventListener: events.addEventListener.bind(events),
        setInterval: f => { timers.set(++sequence, f); return sequence; }, clearInterval: id => timers.delete(id),
        setTimeout: (f, ms) => { timers.set(++sequence, { f, ms }); return sequence; }, clearTimeout: id => timers.delete(id),
        console: { error: (...args) => logs.push(args), log: (...args) => logs.push(args) },
        google: { accounts: { oauth2: { initTokenClient: config => { const client = { callback: config.callback,
            requestAccessToken() { oauthRequests++; tokenCallback = () => client.callback(options.oauthError ?
                { error: 'access_denied', error_description: 'CONTENIDO_PRIVADO_NO_EXPORTAR' } : { access_token: 'TOKEN_FICTICIO_WEB', expires_in: 3600 });
                if (!options.delayOAuth) tokenCallback(); } }; return client; }, revoke(_token, done) { done(); } } } },
        fetch: async (url, init) => { requests.push({ url, method: init.method, authorization: init.headers.Authorization, redirect: init.redirect });
            if (options.esperaM0 && requests.length === 3) await options.esperaM0.promise;
            if (options.responseError) return new Response('TOKEN_FICTICIO_CONTENIDO_PRIVADO', { status: options.responseError });
            if (options.networkError) throw new Error('TOKEN_FICTICIO_CONTENIDO_PRIVADO');
            return url.includes('alt=media') ? new Response(bytes) : new Response(JSON.stringify(original())); }
    };
    // El lector simulado emite los mismos eventos que el lector canónico.
    const load = x.libro.cargarDesdeGoogle.bind(x.libro);
    x.libro.cargarDesdeGoogle = archivo => { events.dispatchEvent(new Event('haiku:libro-cambio'));
        const promise = load(archivo); return promise.then(() => events.dispatchEvent(new CustomEvent('haiku:libro-vista-actualizada',
            { detail: { origen: 'google', cargado: true } }))); };
    x.libro.cargarDesdeGoogleParaVerificacion = x.libro.cargarDesdeGoogle;
    context.window = context; vm.runInNewContext(googleCode, context, { filename: 'supabase-libro-google-readonly-v1.js' });
    return { api: context.HAIKU_LIBRO_GOOGLE_V1, context, requests, logs, oauthRequests: () => oauthRequests,
        expirar: () => { time += 3600_000; }, completarOAuth: () => tokenCallback(), timers, events, x };
}
test('sin autorización devuelve error tipado, cero fetch y cero OAuth implícito', async () => {
    const w = web(); await rechazo(w.api.obtenerFuenteVerificada(), 'GOOGLE_NO_AUTORIZADO');
    assert.equal(w.oauthRequests(), 0); assert.deepEqual(w.requests, []);
});
test('conector sólo usa el FILE_ID configurado; no acepta autoridad desde parámetros ni exporta tokens', async () => {
    const w = web(); await w.api.conectar();
    const h = await w.api.obtenerFuenteVerificada({ fileId: 'otro', token: 'TOKEN_NO_ACEPTAR' });
    assert.equal(w.oauthRequests(), 1); assert.equal(w.api.fuenteVerificada(h).version, hash('sha256'));
    assert.ok(w.requests.every(r => new URL(r.url).pathname === '/drive/v3/files/' + fileId && r.method === 'GET'));
    assert.ok(w.requests.every(r => r.authorization === 'Bearer TOKEN_FICTICIO_WEB'));
    assert.ok(w.requests.slice(0, 2).every(r => r.redirect === 'follow'));
    assert.ok(w.requests.slice(2).every(r => r.redirect === 'error'));
    assert.ok(w.requests.some(r => new URL(r.url).searchParams.get('fields').includes('version,md5Checksum,sha256Checksum')));
    assert.doesNotMatch(JSON.stringify(w.api.estado()) + JSON.stringify(h) + JSON.stringify(w.api.fuenteVerificada(h)), /TOKEN_FICTICIO_WEB|Authorization|access_token/);
    assert.deepEqual(w.logs, []); await w.api.verificarVigencia(h);
});
for (const status of [401, 403, 500]) test('HTTP ' + status + ' se convierte en error seguro, nunca éxito', async () => {
    const w = web({ responseError: status }); await w.api.conectar();
    await assert.rejects(w.api.obtenerFuenteVerificada(), e => { assert.ok(e instanceof F.FuenteOficialError);
        assert.doesNotMatch(e.message + e.stack, /TOKEN_FICTICIO_CONTENIDO_PRIVADO/); return true; });
    assert.deepEqual(w.logs, []);
});
test('error OAuth no inicia ruta verificable ni registra la respuesta privada', async () => {
    const w = web({ oauthError: true }); await w.api.conectar();
    await rechazo(w.api.obtenerFuenteVerificada(), 'GOOGLE_NO_AUTORIZADO'); assert.equal(w.requests.length, 0); assert.deepEqual(w.logs, []);
});
test('una respuesta OAuth tardía no reconecta tras Desconectar', async () => {
    const w = web({ delayOAuth: true }), pending = w.api.conectar();
    while (w.oauthRequests() === 0) await new Promise(ok => setImmediate(ok));
    w.api.desconectar(); w.completarOAuth(); await pending;
    assert.equal(w.api.estado().conectado, false); assert.equal(w.requests.length, 0);
    await rechazo(w.api.obtenerFuenteVerificada(), 'GOOGLE_NO_AUTORIZADO');
});
test('vencimiento por timer revoca el sello sin polling ni nuevos requests', async () => {
    const w = web(); await w.api.conectar(); const h = await w.api.obtenerFuenteVerificada();
    const before = w.requests.length;
    const expiry = [...w.timers.values()].find(t => t.ms === 3540000); assert.ok(expiry); expiry.f();
    assert.equal(w.api.estado().conectado, false); assert.throws(() => w.api.fuenteVerificada(h));
    assert.equal(w.requests.length, before); assert.equal(w.oauthRequests(), 1);
});
test('desconexión y expiración retiran handles; nunca renuevan OAuth automáticamente', async () => {
    const w = web(); await w.api.conectar(); const h = await w.api.obtenerFuenteVerificada();
    w.expirar(); assert.throws(() => w.api.fuenteVerificada(h));
    await rechazo(w.api.obtenerFuenteVerificada(), 'GOOGLE_NO_AUTORIZADO'); assert.equal(w.oauthRequests(), 1);
    w.api.desconectar(); assert.equal(w.api.estado().conectado, false);
});
test('Sincronizar ahora sigue disponible y sustituir la copia invalida su sello', async () => {
    const w = web(); await w.api.conectar(); const h = await w.api.obtenerFuenteVerificada();
    await w.api.sincronizar(); assert.throws(() => w.api.fuenteVerificada(h), { code: 'FUENTE_CAMBIADA' });
    assert.equal(w.api.estado().archivoLocalCargado, true);
});
test('Sincronizar ahora explícito puede cancelar una verificación pendiente; la antigua no certifica', async () => {
    const gate = deferred(), w = web({ esperaM0: gate }); await w.api.conectar();
    const pending = w.api.obtenerFuenteVerificada(), rejected = rechazo(pending, 'SOLICITUD_OBSOLETA');
    while (w.requests.length < 3) await new Promise(ok => setImmediate(ok));
    await w.api.sincronizar(); gate.resolve(); await rejected;
    assert.equal(w.api.estado().archivoLocalCargado, true);
    assert.equal(w.requests.length, 5);
    assert.throws(() => w.api.fuenteVerificada({}), { code: 'FUENTE_CAMBIADA' });
});
test('no hay activación backend, comparación, bridge, endpoint ni persistencia adicional de secretos', () => {
    const moduleCode = fs.readFileSync(path.join(__dirname, '../js/haiku-libro-fuente-oficial-v1.js'), 'utf8');
    // La única eliminación es de un AbortController en un Set local, nunca de datos.
    assert.doesNotMatch((moduleCode + googleCode).replace('operaciones.delete(op)', ''), /serviceAccountJson|createGoogleServiceAccountTokenProvider|Deno\.serve|postMessage|compararMes\(|\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    assert.doesNotMatch(moduleCode, /localStorage|indexedDB|console\.|access_token|Authorization/);
    const panel = fs.readFileSync(path.join(__dirname, '../panel.html'), 'utf8');
    assert.ok(panel.indexOf("'haiku-libro-fuente-oficial-v1'") < panel.indexOf("'supabase-libro-google-readonly-v1'"));
});
