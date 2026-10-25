const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const fixture = fs.readFileSync(require.resolve('./fixtures/libro-reconciliacion-oct26-real.xlsx'));
const apiKey = 'API_KEY_FICTICIA_SOLO_PARA_PRUEBAS_2026';
const auth = 'Bearer SESION_HAKU_FICTICIA_SOLO_PRUEBAS';
const resourceKey = 'recurso-ficticio';
const origin = 'https://chinchoncarrasco-cpu.github.io';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
let handlerModule, sourceModule;
test.before(async () => {
    handlerModule = await import('../supabase/functions/haku-libro-enlace-readonly/handler.ts');
    sourceModule = await import('../supabase/functions/_shared/libroDriveSource.ts');
});
function setup(options = {}) {
    const calls = [], id = handlerModule.LIBRO_FILE_ID;
    const metadata = { id, name: 'Libro ficticio.xlsx', mimeType: sourceModule.LIBRO_XLSX_MIME,
        modifiedTime: '2026-10-25T00:00:00Z', size: String(fixture.length), version: '25',
        md5Checksum: createHash('md5').update(fixture).digest('hex'),
        sha256Checksum: createHash('sha256').update(fixture).digest('hex'),
        trashed: false, capabilities: { canDownload: true }, ...options.metadata };
    let metaReads = 0;
    const fetch = async (url, init) => {
        calls.push({ url, init });
        assert.equal(init.cache, 'no-store'); assert.ok(init.signal instanceof AbortSignal);
        if (url.endsWith('/auth/v1/user')) {
            assert.equal(init.headers.Authorization, auth); assert.equal(init.headers.apikey, 'publicable-ficticia');
            return json({ id: 'usuario-ficticio' }, options.authStatus ?? 200);
        }
        if (url.endsWith('/rest/v1/rpc/haiku_sesion_actual')) {
            assert.equal(init.method, 'POST'); assert.equal(init.body, '{}');
            return json(options.session ?? { usuario: { activo: true }, permisos: ['reservas.ver', 'pagos.ver', 'servicios.ver'] });
        }
        const u = new URL(url);
        assert.equal(u.origin, 'https://www.googleapis.com'); assert.equal(u.pathname, '/drive/v3/files/' + id);
        assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'manual');
        assert.equal(init.headers.Authorization, undefined); assert.equal(init.headers['X-Goog-Api-Key'], apiKey);
        assert.equal(init.headers['X-Goog-Drive-Resource-Keys'], id + '/' + resourceKey);
        assert.equal(url.includes(apiKey), false); assert.equal(url.includes(resourceKey), false);
        if (options.driveStatus) return json({ error: { message: apiKey + ' CUERPO_SENSIBLE' } }, options.driveStatus);
        if (options.redirect) return new Response(null, { status: 302, headers: { Location: 'https://otro.invalid' } });
        if (u.searchParams.has('alt')) return new Response(options.bytes ?? fixture);
        metaReads++;
        return json({ ...metadata, ...(metaReads > 1 ? options.nextMetadata : {}) });
    };
    const handler = handlerModule.createHandler({ supabaseKey: 'publicable-ficticia',
        driveApiKey: options.unconfigured ? undefined : apiKey, resourceKey, fetch });
    const request = (body = { accion: 'metadata' }, patch = {}) => handler(new Request('https://edge.invalid/haku-libro-enlace-readonly', {
        method: 'POST', headers: { Origin: origin, Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), ...patch,
    }));
    return { handler, request, calls, metadata, fetch };
}

test('el servidor consulta el archivo fijado con API key y valida usuario/permisos antes de Google', async () => {
    const s = setup(); const response = await s.request();
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.deepEqual(await response.json(), s.metadata);
    assert.equal(s.calls.length, 3);
    assert.match(s.calls[0].url, /auth\/v1\/user$/); assert.match(s.calls[1].url, /rpc\/haiku_sesion_actual$/);
});
test('descarga bytes XLSX idénticos sólo tras comprobar M0, checksums y M1', async () => {
    const s = setup(); const response = await s.request({ accion: 'descargar', version: '25' });
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'application/octet-stream');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixture);
    assert.equal(s.calls.length, 5); assert.equal(s.calls.filter(c => c.url.includes('alt=media')).length, 1);
});
for (const [name, patch] of [
    ['usuario inactivo', { session: { usuario: { activo: false }, permisos: ['reservas.ver', 'pagos.ver', 'servicios.ver'] } }],
    ['sin permisos completos', { session: { usuario: { activo: true }, permisos: ['reservas.ver'] } }],
    ['permiso autodeclarado', { session: { usuario: { activo: true }, user_metadata: { permisos: ['reservas.ver', 'pagos.ver', 'servicios.ver'] } } }],
]) test(name + ' no llega a Google', async () => {
    const s = setup(patch); assert.equal((await s.request()).status, 403); assert.equal(s.calls.length, 2);
});
test('sesión revocada se rechaza sin consultar RPC ni Google', async () => {
    const s = setup({ authStatus: 401 }); assert.equal((await s.request()).status, 401); assert.equal(s.calls.length, 1);
});
test('sin clave devuelve configuración pendiente sin pedir permiso Google al usuario', async () => {
    const s = setup({ unconfigured: true }); const r = await s.request();
    assert.equal(r.status, 503); assert.equal((await r.json()).code, 'CONFIGURACION_PENDIENTE'); assert.equal(s.calls.length, 2);
});
for (const status of [401, 403, 404]) test('error Google ' + status + ' es sanitizado y no inicia OAuth ni reintenta acceso denegado', async () => {
    const s = setup({ driveStatus: status }); const r = await s.request(); const text = await r.text();
    assert.equal(r.status, 502); assert.doesNotMatch(text, /API_KEY_FICTICIA|CUERPO_SENSIBLE/); assert.equal(s.calls.length, 3);
});
test('un cambio M0/M1 impide entregar la descarga', async () => {
    const s = setup({ nextMetadata: { version: '26' } }); const r = await s.request({ accion: 'descargar', version: '25' });
    assert.equal(r.status, 409); assert.equal((await r.json()).code, 'FUENTE_CAMBIADA');
});
test('versión solicitada anterior impide usar bytes distintos en una comparación', async () => {
    const s = setup(); const r = await s.request({ accion: 'descargar', version: '24' });
    assert.equal(r.status, 409); assert.equal((await r.json()).code, 'FUENTE_CAMBIADA');
});
test('checksum incorrecto impide entregar bytes y conserva el error concreto', async () => {
    const s = setup({ bytes: Buffer.alloc(fixture.length) }); const r = await s.request({ accion: 'descargar', version: '25' });
    assert.equal(r.status, 502); assert.equal((await r.json()).code, 'CHECKSUM_INVALIDO');
});
test('restricción de descarga y archivo excesivo impiden consultar media', async () => {
    for (const metadata of [{ capabilities: { canDownload: false } }, { size: '99999999' }]) {
        const s = setup({ metadata }); assert.equal((await s.request()).status, 502);
        assert.equal(s.calls.some(c => c.url.includes('alt=media')), false);
    }
});
test('no sigue redirecciones ni expone la API key a otro destino', async () => {
    const s = setup({ redirect: true }); assert.equal((await s.request()).status, 502); assert.equal(s.calls.length, 3);
});
for (const body of [{ accion: 'escribir' }, { accion: 'metadata', fileId: 'otro' }, { accion: 'metadata', url: 'https://otro.invalid' },
    { accion: 'metadata', version: '25' }, { accion: 'descargar' }, { accion: 'descargar', version: '25', stamp: {} }, [], null]) {
    test('contrato de solo lectura rechaza ' + JSON.stringify(body), async () => {
        const s = setup(); assert.equal((await s.request(body)).status, 400); assert.equal(s.calls.length, 0);
    });
}
test('origen ajeno, falta de sesión y método inválido se rechazan antes de red', async () => {
    const s = setup();
    assert.equal((await s.request({}, { headers: { Origin: 'https://otro.invalid' } })).status, 403);
    assert.equal((await s.request({}, { headers: { Origin: origin } })).status, 401);
    assert.equal((await s.request(undefined, { method: 'GET', body: undefined })).status, 405);
    assert.equal(s.calls.length, 0);
});
test('preflight permitido no consulta ni expone datos', async () => {
    const s = setup(); const r = await s.request(undefined, { method: 'OPTIONS', body: undefined });
    assert.equal(r.status, 204); assert.equal(await r.text(), ''); assert.equal(s.calls.length, 0);
});
test('metadata pública no se convierte en sello de vigencia aceptado por el adapter', async () => {
    const s = setup(); const source = sourceModule.createLibroDriveSource({ fileId: handlerModule.LIBRO_FILE_ID, apiKey, resourceKey, fetch: s.fetch });
    const m = await source.readMetadata();
    await assert.rejects(() => source.verifyStillCurrent(m), { code: 'CONFIG_INVALIDA' });
});
test('credenciales ambiguas o inyectadas se rechazan antes de red', () => {
    const base = { fileId: handlerModule.LIBRO_FILE_ID, apiKey, fetch: () => assert.fail('HTTP inesperado') };
    for (const patch of [{ apiKey: '' }, { apiKey: 123456789012345678901 }, { apiKey: apiKey + '\n' },
        { tokenProvider: { getAccessToken() {}, invalidate() {} } }, { resourceKey: 'a,b/c' }])
        assert.throws(() => sourceModule.createLibroDriveSource({ ...base, ...patch }), { code: 'CONFIG_INVALIDA' });
});
