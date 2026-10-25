// Sólo localhost: Google/Auth falsos; lector, Worker, IndexedDB y avisos de Haku reales.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const http = require('node:http'), os = require('node:os'), { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const serverMode = process.env.HAIKU_LIBRO_SERVER === '1';
const root = path.resolve(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/libro-reconciliacion-oct26-real.xlsx'));
const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), comment = Buffer.from('version-ficticia-nueva');
assert.ok(eocd >= 0);
const alternate = Buffer.concat([bytes.subarray(0, eocd + 22), comment]); alternate.writeUInt16LE(comment.length, eocd + 20);
const versions = [bytes, alternate].map(b => ({ bytes: [...b], md5: createHash('md5').update(b).digest('hex'), sha256: createHash('sha256').update(b).digest('hex') }));
const fileId = read('js/supabase-libro-google-readonly-v1.js').match(/const FILE_ID = "([^"]+)"/)[1];
const assets = process.env.HAIKU_LIBRO_WORKER_ASSETS || path.join(os.tmpdir(), 'haiku-pago-visible-assets');
const html = read('index.html'), start = html.indexOf('<section id="seccion-libro-reserva"'), end = html.indexOf('</main>', start);
const section = html.slice(start, end).replace(/(<section id="seccion-libro-reserva"[^>]*class=")([^"]+)/, '$1$2 activa');
const scripts = [...(serverMode ? ['supabase-client'] : []), 'supabase-libro-reserva-v1', 'haiku-libro-fuente-oficial-v1', 'supabase-libro-google-readonly-v1', 'supabase-asistente-libro-auto-v1'];
const styles = ['css/styles.css', 'css/sites-shell-v1.css', 'css/supabase-libro-reserva-v1.css',
    'css/supabase-libro-reserva-fidelidad-v1.css', 'css/sites-libro-reserva-v1.css', 'css/haiku-tema-oscuro-v1.css', 'css/haiku-tema-v1.css'];
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(
        '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + styles.map(read).join('\n') +
        '</style><body><main>' + section + '</main><div id="haiku-asistente-mensajes"></div>' +
        scripts.map(s => '<script src="/js/' + s + '.js"></script>').join('') + '</body></html>');
    if (/^\/js\/[a-z0-9-]+\.js$/.test(pathname)) return res.writeHead(200, { 'Content-Type': 'application/javascript' }).end(read(pathname.slice(1)));
    if (/^\/css\/[a-z0-9-]+\.css$/.test(pathname)) return res.writeHead(200, { 'Content-Type': 'text/css' }).end(read(pathname.slice(1)));
    res.writeHead(404).end();
});
(async () => {
    await new Promise(ok => server.listen(0, '127.0.0.1', ok)); let browser;
    const errors = [], external = [], screenshots = path.join(os.tmpdir(), serverMode ? 'haku-libro-enlace' : 'haku-google-sesion'); fs.mkdirSync(screenshots, { recursive: true });
    try {
        browser = await chromium.launch({ executablePath: process.env.HAIKU_BROWSER_EXECUTABLE || path.join(assets, 'chromium'), headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process'] });
        const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
        const origin = 'http://127.0.0.1:' + server.address().port;
        await context.route('**/*', route => {
            const url = route.request().url();
            if (new URL(url).origin === origin) return route.continue();
            if (url.includes('xlsx.full.min.js')) return route.fulfill({ path: path.join(assets, 'xlsx.full.min.js'), contentType: 'application/javascript' });
            if (url.includes('jszip.min.js')) return route.fulfill({ path: path.join(assets, 'jszip.min.js'), contentType: 'application/javascript' });
            external.push(new URL(url).origin); return route.abort();
        });
        await context.addInitScript(({ fileId, versions, serverMode }) => {
            const version = Number(sessionStorage.getItem('test-version') || 0), fixture = versions[version];
            window.__audit = { oauth: 0, downloads: 0, notices: 0, callbacks: [] };
            window.haikuSesion = sessionStorage.getItem('test-logout') ? null : { auth: { id: 'usuario-prueba' }, usuario: { activo: true } };
            window.haikuSupabase = { auth: { onAuthStateChange(cb) { __audit.callbacks.push(cb); } } };
            const metadata = () => ({ id: fileId, name: 'Libro prueba.xlsx',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                size: String(fixture.bytes.length), version: String(version + 1), modifiedTime: `2026-10-25T0${version}:00:00Z`,
                md5Checksum: fixture.md5, sha256Checksum: fixture.sha256, capabilities: { canDownload: true }, trashed: false });
            if (serverMode) {
                // Ejecutar el cliente/configuración real; sólo el SDK y la red se sustituyen.
                window.supabase = { createClient() { return window.haikuSupabase; } };
                window.haikuSupabase.functions = { async invoke(name, { body }) {
                    if (name !== 'haku-libro-enlace-readonly' || !window.haikuSesion) throw Error('Solicitud no autorizada');
                    if (body.accion === 'metadata') return { data: metadata(), error: null };
                    if (body.accion !== 'descargar' || body.version !== String(version + 1)) throw Error('Descarga no permitida');
                    __audit.downloads++; return { data: new Blob([new Uint8Array(fixture.bytes)]), error: null };
                } };
            }
            window.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1 = { obtenerResultado: async () => {
                __audit.notices++; return { estado: 'sin_cambios', nuevas: [], modificadas: [], ambiguas: [] };
            } };
            window.google = { accounts: { oauth2: { initTokenClient(config) { return { callback: config.callback,
                requestAccessToken() { __audit.oauth++; this.callback({ access_token: 'token-ficticio-browser', expires_in: 3600 }); } }; },
                revoke(_token, done) { done(); } } } };
            const fetchOriginal = window.fetch.bind(window);
            window.fetch = async (resource, init) => {
                const url = new URL(resource, location.href);
                if (url.origin !== 'https://www.googleapis.com') return fetchOriginal(resource, init);
                if (serverMode) throw Error('Google directo no permitido en modo servidor');
                if (init.method !== 'GET' || !url.pathname.endsWith(fileId)) throw Error('Petición no permitida');
                if (url.searchParams.get('alt') === 'media') { __audit.downloads++; return new Response(new Uint8Array(fixture.bytes)); }
                return new Response(JSON.stringify(metadata()));
            };
        }, { fileId, versions, serverMode });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        const ready = () => page.waitForFunction(() => window.HAIKU_LIBRO_GOOGLE_V1?.estado().conectado &&
            !HAIKU_LIBRO_GOOGLE_V1.estado().sincronizando && HAIKU_LIBRO_RESERVA_V1.estado().cargado);
        await page.goto(origin); if (!serverMode) await page.click('#haiku-libro-google-conectar'); await ready();
        assert.equal(await page.evaluate(() => __audit.oauth), serverMode ? 0 : 1);
        assert.equal(await page.evaluate(() => __audit.notices), 0);
        await page.reload(); await ready();
        assert.equal(await page.evaluate(() => __audit.oauth), 0);
        assert.equal(await page.evaluate(() => __audit.downloads), 0);
        assert.equal(await page.evaluate(() => __audit.notices), 0);
        // Cambio guardado en Google mientras se recargaba: recupera A, descarga B y avisa una sola vez.
        await page.evaluate(() => sessionStorage.setItem('test-version', '1'));
        await page.reload(); await ready();
        await page.waitForFunction(() => __audit.notices === 1 && !!document.querySelector('.haku-libro-auto'));
        assert.equal(await page.evaluate(() => __audit.oauth), 0);
        assert.equal(await page.evaluate(() => __audit.downloads), 1);
        await page.click('#haiku-libro-google-sincronizar'); await ready();
        assert.equal(await page.evaluate(() => __audit.notices), 1);
        // La comparación verificada sigue disponible y no desconecta Google.
        await page.evaluate(async () => { const handle = await HAIKU_LIBRO_GOOGLE_V1.obtenerFuenteVerificada();
            await HAIKU_LIBRO_GOOGLE_V1.verificarVigencia(handle); });
        assert.equal(await page.evaluate(() => HAIKU_LIBRO_GOOGLE_V1.estado().conectado), true);
        for (const theme of ['claro', 'oscuro']) {
            await page.evaluate(theme => document.documentElement.dataset.haikuTema = theme, theme);
            await page.locator('#haiku-libro-google').screenshot({ path: path.join(screenshots, theme + '.png') });
        }
        await page.evaluate(() => {
            window.haikuSesion = null; sessionStorage.setItem('test-logout', '1');
            __audit.callbacks.forEach(cb => cb('SIGNED_OUT', null));
        });
        assert.equal(await page.evaluate(() => sessionStorage.getItem('haikuLibroGoogleSesionV1')), null);
        await page.reload(); await page.waitForFunction(() => !!window.HAIKU_LIBRO_GOOGLE_V1);
        assert.equal(await page.evaluate(() => HAIKU_LIBRO_GOOGLE_V1.estado().conectado), false);
        assert.deepEqual(errors, []); assert.deepEqual(external, []);
        console.log('PASS Chromium (' + (serverMode ? 'servidor' : 'Google personal') + '): F5 sin OAuth, mismo Libro sin descarga/aviso duplicado, versión nueva con aviso, comparación verificada, logout, claro/oscuro; cero tráfico externo.');
    } finally { await browser?.close(); await new Promise(ok => server.close(ok)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
