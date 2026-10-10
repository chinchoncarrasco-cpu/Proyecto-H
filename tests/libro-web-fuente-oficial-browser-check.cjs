// Sólo localhost, GIS/Drive falsos y XLSX anonimizado; lector y Worker canónicos reales.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const http = require('node:http'), os = require('node:os'), { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/libro-reconciliacion-oct26-real.xlsx'));
const sha = createHash('sha256').update(bytes).digest('hex'), md5 = createHash('md5').update(bytes).digest('hex');
// Otra copia válida con igual OOXML: sólo cambia el comentario ZIP ficticio en memoria.
const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
assert.ok(eocd >= 0 && eocd + 22 + bytes.readUInt16LE(eocd + 20) === bytes.length);
const comment = Buffer.from('copia-ficticia-verificacion');
const alternate = Buffer.concat([bytes.subarray(0, eocd + 22), comment]); alternate.writeUInt16LE(comment.length, eocd + 20);
const alternateSha = createHash('sha256').update(alternate).digest('hex'), alternateMd5 = createHash('md5').update(alternate).digest('hex');
const fileId = read('js/supabase-libro-google-readonly-v1.js').match(/const FILE_ID = "([^"]+)"/)[1];
const assets = process.env.HAIKU_LIBRO_WORKER_ASSETS || path.join(os.tmpdir(), 'haiku-jonathan-real-xlsx');
for (const name of ['xlsx.full.min.js', 'jszip.min.js']) assert.ok(fs.existsSync(path.join(assets, name)), 'Falta caché local: ' + name);
const html = read('index.html'), start = html.indexOf('<section id="seccion-libro-reserva"'), end = html.indexOf('</main>', start);
assert.ok(start >= 0 && end > start);
const section = html.slice(start, end).replace(/(<section id="seccion-libro-reserva"[^>]*class=")([^"]+)/, '$1$2 activa');
const scripts = ['supabase-libro-reserva-v1', 'haiku-libro-fuente-oficial-v1', 'supabase-libro-google-readonly-v1', 'supabase-asistente-libro-auto-v1'];
const allowed = new Set([...scripts, 'supabase-libro-reserva-worker-v1', 'haiku-libro-semantica-v1']);
const styles = ['css/styles.css', 'css/sites-shell-v1.css', 'css/supabase-libro-reserva-v1.css',
    'css/supabase-libro-reserva-fidelidad-v1.css', 'css/sites-libro-reserva-v1.css'].map(read).join('\n');
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(
        '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + styles +
        '</style><body><main>' + section + '</main>' + scripts.map(s => '<script src="/js/' + s + '.js"></script>').join('') + '</body></html>');
    const name = pathname.match(/^\/js\/([a-z0-9-]+)\.js$/)?.[1];
    if (allowed.has(name)) return res.writeHead(200, { 'Content-Type': 'application/javascript;charset=utf-8', 'Cache-Control': 'no-store' }).end(read('js/' + name + '.js'));
    if (pathname === '/css/supabase-libro-reserva-fidelidad-v1.css') return res.writeHead(200, { 'Content-Type': 'text/css' }).end(read(pathname.slice(1)));
    return res.writeHead(404).end();
});
(async () => {
    await new Promise(ok => server.listen(0, '127.0.0.1', ok)); let browser;
    const externos = [], errores = [], capturas = path.join(os.tmpdir(), 'haiku-libro-web-fuente-oficial'); fs.mkdirSync(capturas, { recursive: true });
    try {
        browser = await chromium.launch({ executablePath: process.env.HAIKU_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
        const origin = 'http://127.0.0.1:' + server.address().port;
        for (const width of [1100, 390]) {
            const context = await browser.newContext({ viewport: { width, height: 850 } });
            await context.route('**/*', route => {
                const url = route.request().url();
                if (new URL(url).origin === origin) return route.continue();
                if (url === 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js') return route.fulfill({ path: path.join(assets, 'xlsx.full.min.js'), contentType: 'application/javascript' });
                if (url === 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js') return route.fulfill({ path: path.join(assets, 'jszip.min.js'), contentType: 'application/javascript' });
                externos.push(new URL(url).origin); return route.abort();
            });
            await context.addInitScript(({ fileId, bytes, sha, md5 }) => {
                const data = { id: fileId, name: 'Libro ficticio.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    size: String(bytes.length), version: '77', modifiedTime: '2026-10-09T12:00:00Z', md5Checksum: md5, sha256Checksum: sha,
                    capabilities: { canDownload: true }, trashed: false };
                window.__drive = { metadata: data, bytes, reads: 0, downloads: 0, oauth: 0, mutations: 0, forbiddenStorage: 0, autoComparisons: 0, requests: [] };
                window.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1 = { obtenerResultado: async () => {
                    window.__drive.autoComparisons++; return { estado: 'sin_linea_base' };
                } };
                const setItem = Storage.prototype.setItem;
                Storage.prototype.setItem = function (key, value) { if (String(value).includes('TOKEN_FICTICIO_WEB')) window.__drive.forbiddenStorage++;
                    return setItem.call(this, key, value); };
                window.google = { accounts: { oauth2: { initTokenClient(config) { return { callback: config.callback,
                    requestAccessToken() { window.__drive.oauth++; this.callback({ access_token: 'TOKEN_FICTICIO_WEB', expires_in: 3600 }); } }; },
                    revoke(_token, done) { done(); } } } };
                const original = window.fetch.bind(window);
                window.fetch = async (resource, init = {}) => {
                    const url = new URL(String(resource), location.href);
                    if (url.origin !== 'https://www.googleapis.com') return original(resource, init);
                    if (init.method !== 'GET') window.__drive.mutations++;
                    if (url.pathname !== '/drive/v3/files/' + fileId || init.headers.Authorization !== 'Bearer TOKEN_FICTICIO_WEB') throw new Error('Unexpected mock request');
                    window.__drive.requests.push({ method: init.method, path: url.pathname, redirect: init.redirect });
                    if (window.__drive.httpError) return new Response('CONTENIDO_PRIVADO_FICTICIO', { status: window.__drive.httpError });
                    if (url.searchParams.get('alt') === 'media') { window.__drive.downloads++; return new Response(new Uint8Array(window.__drive.bytes)); }
                    window.__drive.reads++;
                    if (window.__drive.pauseNext) { window.__drive.pauseNext = false; await new Promise(ok => { window.__drive.release = ok; }); }
                    return new Response(JSON.stringify(window.__drive.metadata));
                };
            }, { fileId, bytes: [...bytes], sha, md5 });
            const page = await context.newPage(); page.on('pageerror', e => errores.push(e.message));
            await page.goto(origin); await page.waitForFunction(() => window.HAIKU_LIBRO_GOOGLE_V1 && window.HAIKU_LIBRO_RESERVA_V1);
            assert.equal(await page.evaluate(async () => { try { await HAIKU_LIBRO_GOOGLE_V1.obtenerFuenteVerificada(); return 'success'; } catch (e) { return e.code; } }), 'GOOGLE_NO_AUTORIZADO');
            assert.equal(await page.evaluate(() => __drive.oauth + __drive.reads + __drive.downloads), 0);
            await page.locator('#libro-reserva-archivo').setInputFiles({ name: 'Libro ficticio.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes });
            await page.evaluate(() => HAIKU_LIBRO_RESERVA_V1.listo());
            assert.equal(await page.evaluate(() => HAIKU_LIBRO_RESERVA_V1.estado().version), sha);
            assert.equal(await page.evaluate(() => { try { HAIKU_LIBRO_GOOGLE_V1.fuenteVerificada({ tipo: 'google-drive-oficial-verificado', ...HAIKU_LIBRO_RESERVA_V1.estado() }); return 'success'; } catch (e) { return e.code; } }), 'FUENTE_CAMBIADA');
            await page.evaluate(() => HAIKU_LIBRO_GOOGLE_V1.conectar());
            const result = await page.evaluate(async () => {
                const before = { reads: __drive.reads, downloads: __drive.downloads };
                window.__handle = await HAIKU_LIBRO_GOOGLE_V1.obtenerFuenteVerificada();
                const fuente = HAIKU_LIBRO_GOOGLE_V1.fuenteVerificada(__handle), estado = HAIKU_LIBRO_RESERVA_V1.estado();
                const m2before = { reads: __drive.reads, downloads: __drive.downloads };
                await HAIKU_LIBRO_GOOGLE_V1.verificarVigencia(__handle);
                return { handle: JSON.stringify(__handle), tipo: fuente.tipo, hash: fuente.version, generacion: fuente.generacion,
                    estado, sheets: fuente.libro.listarHojas(), mutations: __drive.mutations, forbiddenStorage: __drive.forbiddenStorage,
                    exportedToken: JSON.stringify(fuente).includes('TOKEN_FICTICIO_WEB'),
                    downloads: m2before.downloads - before.downloads, reads: m2before.reads - before.reads,
                    m2Reads: __drive.reads - m2before.reads, m2Downloads: __drive.downloads - m2before.downloads,
                    facadeOnlyRead: fuente.libro.cargarDesdeGoogle === undefined && fuente.libro.limpiar === undefined };
            });
            assert.equal(result.handle, '{}'); assert.equal(result.tipo, 'google-drive-oficial-verificado'); assert.equal(result.hash, sha);
            assert.equal(result.estado.version, sha); assert.equal(result.generacion, result.estado.generacion); assert.ok(result.estado.cargado);
            assert.ok(result.sheets.includes('Oct26')); assert.equal(result.downloads, 1); assert.equal(result.reads, 2);
            assert.equal(result.m2Reads, 1); assert.equal(result.m2Downloads, 0); assert.ok(result.facadeOnlyRead);
            assert.equal(result.mutations + result.forbiddenStorage, 0); assert.equal(result.exportedToken, false);
            await page.locator('#libro-reserva-hoja').selectOption('Oct26');
            await page.locator('#libro-reserva-visor table').waitFor();
            await page.screenshot({ path: path.join(capturas, 'fuente-oficial-' + width + '.png'), fullPage: true });
            assert.equal(await page.evaluate(async () => { __drive.metadata.version = '78';
                try { await HAIKU_LIBRO_GOOGLE_V1.verificarVigencia(__handle); return 'success'; } catch (e) { return e.code; } }), 'FUENTE_CAMBIADA');
            await page.evaluate(async () => { window.__handle = await HAIKU_LIBRO_GOOGLE_V1.obtenerFuenteVerificada(); });
            // Solicitud antigua en M0: se cancela; su respuesta tardía no certifica el estado nuevo.
            await page.evaluate(() => { __drive.pauseNext = true; window.__old = HAIKU_LIBRO_GOOGLE_V1.obtenerFuenteVerificada().catch(e => e.code); });
            await page.waitForFunction(() => typeof __drive.release === 'function');
            assert.equal(await page.evaluate(async () => { window.__handle = await HAIKU_LIBRO_GOOGLE_V1.obtenerFuenteVerificada();
                __drive.release(); const code = await __old; HAIKU_LIBRO_GOOGLE_V1.fuenteVerificada(__handle); return code; }), 'SOLICITUD_OBSOLETA');
            // Una carga manual idéntica revoca procedencia, incluso si conserva SHA-256 y nombre.
            await page.locator('#libro-reserva-archivo').setInputFiles({ name: 'Libro ficticio.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes });
            await page.evaluate(() => HAIKU_LIBRO_RESERVA_V1.listo());
            assert.equal(await page.evaluate(() => { try { HAIKU_LIBRO_GOOGLE_V1.fuenteVerificada(__handle); return 'success'; } catch (e) { return e.code; } }), 'FUENTE_CAMBIADA');
            await page.evaluate(async () => { window.__handle = await HAIKU_LIBRO_GOOGLE_V1.obtenerFuenteVerificada(); });
            // Aun con bytes distintos y el listener automático real instalado, la ruta nueva no inicia informes/comparaciones.
            await page.evaluate(async ({ bytes, sha, md5 }) => {
                __drive.bytes = bytes; Object.assign(__drive.metadata, { size: String(bytes.length), sha256Checksum: sha, md5Checksum: md5, version: '79' });
                window.__handle = await HAIKU_LIBRO_GOOGLE_V1.obtenerFuenteVerificada();
                if (HAIKU_LIBRO_GOOGLE_V1.fuenteVerificada(__handle).version !== sha) throw new Error('Alternate hash mismatch');
                await new Promise(ok => setTimeout(ok, 25));
            }, { bytes: [...alternate], sha: alternateSha, md5: alternateMd5 });
            assert.equal(await page.evaluate(() => __drive.autoComparisons), 0);
            // El botón habitual conserva su aviso de actualización cuando vuelve a bytes distintos.
            await page.evaluate(({ bytes, sha, md5 }) => { __drive.bytes = bytes;
                Object.assign(__drive.metadata, { size: String(bytes.length), sha256Checksum: sha, md5Checksum: md5, version: '80' });
            }, { bytes: [...bytes], sha, md5 });
            await page.locator('#haiku-libro-google-sincronizar').click();
            await page.waitForFunction(() => !HAIKU_LIBRO_GOOGLE_V1.estado().sincronizando);
            if (width === 1100) await page.waitForFunction(() => __drive.autoComparisons === 1);
            assert.equal(await page.evaluate(() => __drive.autoComparisons), width === 1100 ? 1 : 0);
            assert.equal(await page.evaluate(() => { try { HAIKU_LIBRO_GOOGLE_V1.fuenteVerificada(__handle); return 'success'; } catch (e) { return e.code; } }), 'FUENTE_CAMBIADA');
            await page.evaluate(async () => { window.__handle = await HAIKU_LIBRO_GOOGLE_V1.obtenerFuenteVerificada(); });
            await page.locator('#libro-reserva-quitar').click();
            assert.equal(await page.evaluate(() => { try { HAIKU_LIBRO_GOOGLE_V1.fuenteVerificada(__handle); return 'success'; } catch (e) { return e.code; } }), 'FUENTE_CAMBIADA');
            assert.equal(await page.evaluate(() => HAIKU_LIBRO_GOOGLE_V1.estado().conectado), true);
            await page.evaluate(async () => { window.__handle = await HAIKU_LIBRO_GOOGLE_V1.obtenerFuenteVerificada(); __drive.httpError = 401;
                try { await HAIKU_LIBRO_GOOGLE_V1.verificarVigencia(__handle); } catch (e) { if (e.code !== 'GOOGLE_NO_AUTORIZADO') throw e; } });
            assert.equal(await page.evaluate(() => HAIKU_LIBRO_GOOGLE_V1.estado().conectado), false);
            await page.evaluate(() => HAIKU_LIBRO_GOOGLE_V1.desconectar());
            assert.equal(await page.evaluate(() => __drive.mutations + __drive.forbiddenStorage), 0);
            console.log('PASS 4B.2C ' + width + 'px: XLSX anonimizado → Drive falso M0/M1 → lector/Worker reales; SHA/generación; M2 sin descarga; manual idéntico, limpieza, 401 y respuesta tardía invalidan; 0 informes automáticos en ruta nueva; Google Connect/Sync intactos; 0 escrituras remotas/tokens exportados.');
            await context.close();
        }
        assert.deepEqual(errores, []); assert.deepEqual(externos, []);
    } finally { if (browser) await browser.close(); await new Promise(ok => server.close(ok)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
