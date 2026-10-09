// XLSX derivado anonimizado → worker original → semántica → consulta → tarjeta.
// NODE_PATH: Playwright. HAIKU_LIBRO_WORKER_ASSETS: dependencias exactas del worker,
// xlsx.full.min.js (0.20.3) y jszip.min.js (3.10.1), descargadas desde sus CDN fijados.
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http');
const path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const { setup, consulta } = require('./fixtures/libro-servicio-manual.cjs');
const F = require('./fixtures/libro-jonathan-real.cjs');
const root = path.resolve(__dirname, '..'), assets = process.env.HAIKU_LIBRO_WORKER_ASSETS || path.join(os.tmpdir(), 'haiku-jonathan-real-xlsx');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
// El derivado anonimizado es la única entrada: los originales privados no son fixtures.
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/libro-jonathan-real.xlsx'));
assert.equal(hash(fixture), F.origen.sha256_fixture_xlsx);
const dependencias = new Map([
    ['https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', fs.readFileSync(path.join(assets, 'xlsx.full.min.js'))],
    ['https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', fs.readFileSync(path.join(assets, 'jszip.min.js'))]
]);
const servidos = new Map(), errores = [], externos = [];
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' }).end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        ['styles', 'sites-asistente-v1', 'supabase-asistente-v1'].map(s => `<link rel="stylesheet" href="/css/${s}.css">`).join('') +
        '</head><body><div class="haiku-asistente-panel"><div id="haiku-asistente-mensajes"></div></div></body></html>');
    if (url.pathname === '/original.xlsx') return res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).end(fixture);
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !/^\/(?:css|js)\//.test(url.pathname)) return res.writeHead(403).end();
    try {
        const bytes = fs.readFileSync(file); servidos.set(url.pathname, hash(bytes));
        res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript' : 'text/css', 'Cache-Control': 'no-store' }).end(bytes);
    } catch { res.writeHead(404).end(); }
});
(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r)); let browser;
    try {
        browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
        for (const width of [1100, 390]) {
            const context = await browser.newContext({ viewport: { width, height: 950 } });
            await context.route('**/*', route => {
                const url = route.request().url();
                if (dependencias.has(url)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: dependencias.get(url) });
                return new URL(url).hostname === '127.0.0.1' ? route.continue() : (externos.push(url), route.abort());
            });
            const page = await context.newPage(); page.on('pageerror', e => errores.push(e.message));
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            for (const name of ['haiku-libro-semantica-v1', 'haiku-servicios-identidad-v1']) await page.addScriptTag({ url: `/js/${name}.js` });
            await page.evaluate(setup);
            const original = await page.evaluate(async () => {
                const buffer = await (await fetch('/original.xlsx')).arrayBuffer();
                const worker = new Worker('/js/supabase-libro-reserva-worker-v1.js');
                const normalizada = await new Promise((resolve, reject) => {
                    worker.addEventListener('error', reject);
                    worker.addEventListener('message', event => event.data.ok ? resolve(event.data.resultado) : reject(new Error(event.data.error)));
                    worker.postMessage({ id: 1, tipo: 'semantica', nombreHoja: 'Oct26', buffer }, [buffer]);
                });
                worker.terminate();
                const r = normalizada.reservas.find(r => r.coordenadas_origen.celda === 'K8');
                fixtureServicios.reservas = [r]; fixtureServicios.db.reservas[1].titular_nombre = r.titular;
                fixtureServicios.db.cabanas[1].numero = r.cabana;
                Object.assign(fixtureServicios.db.reserva_estadias[1], { fecha_ingreso: r.fecha_checkin, fecha_salida: r.fecha_checkout });
                return { texto: r.texto_original, checkin: r.fecha_checkin, checkout: r.fecha_checkout };
            });
            assert.equal(hash(original.texto), F.origen.sha256_texto_celda);
            assert.equal(original.checkin, '2026-10-03'); assert.equal(original.checkout, '2026-10-04');
            // API pública original: procesa la consulta y renderiza la misma tarjeta.
            await page.addScriptTag({ url: '/js/haiku-libro-servicios-scope-v2.js' });
            const items = await page.evaluate(async q => {
                const api = HAIKU_LIBRO_SERVICIOS_SCOPE_V2;
                await api.procesar(q);
                return (await api.construir(q)).items.filter(i => i.kind === 'servicio').map(i => ({
                    categoria: i.semantica, estado: i.estado, fecha: i.fecha, hora: i.hora, razones: i.razones,
                    codigo: i.mapa.codigo, cantidad: i.servicio.cantidad, payload: i.payload }));
            }, consulta);
            assert.equal(items.length, 1);
            assert.equal(items[0].categoria, 'SERVICIO_REAL', JSON.stringify(items[0]));
            assert.equal(items[0].estado, 'listo'); assert.equal(items[0].codigo, 'masajeTerapeutico30');
            assert.equal(items[0].fecha, '2026-10-03'); assert.equal(items[0].hora, '19:00'); assert.equal(items[0].cantidad, 2);
            assert.equal(items[0].payload.tipo_cobro, 'normal'); assert.deepEqual(items[0].razones, []);
            const seccion = page.locator('.haku-libro-servicios__seccion--servicios');
            assert.match(await seccion.locator('summary').innerText(), /Servicios preparables para incorporar/);
            await seccion.evaluate(el => el.open = true);
            const tarjeta = seccion.locator('.haku-libro-servicios__item--listo').filter({ hasText: 'Ficticioab Apellidoab' });
            assert.equal(await tarjeta.count(), 1); assert.equal(await tarjeta.locator('input[type=checkbox]').count(), 1);
            assert.doesNotMatch(await tarjeta.innerText(), /Fecha por definir|Información contradictoria de fecha|Aprobación manual/);
            assert.equal(await page.getByRole('button', { name: 'Aprobación manual', exact: true }).count(), 0);
            assert.equal(await page.evaluate(() => fixtureServicios.escrituras.length), 0);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
            for (const name of ['haiku-libro-semantica-v1', 'haiku-libro-servicios-scope-v2', 'supabase-libro-reserva-worker-v1'])
                assert.equal(servidos.get(`/js/${name}.js`), hash(fs.readFileSync(path.join(root, 'js', name + '.js'))));
            await page.screenshot({ path: path.join(assets, `jonathan-real-${width}.png`), fullPage: true });
            console.log(`PASS caso K8 anonimizado ${width}px: fixture OOXML → worker → semántica → consulta → Servicios preparables para incorporar; JS coincide SHA-256 con la rama`);
            await context.close();
        }
        assert.deepEqual(errores, []); assert.deepEqual(externos, []);
    } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
