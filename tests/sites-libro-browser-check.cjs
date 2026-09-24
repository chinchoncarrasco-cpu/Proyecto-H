// Browser harness for the real Libro UI and handlers. XLSX Worker and Google replies
// are deterministic; IndexedDB, DOM rendering and downloads run in local Edge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const start = html.indexOf('<section id="seccion-libro-reserva"');
const end = html.indexOf('</main>', start);
assert.ok(start >= 0 && end > start, 'Libro section exists');
const section = html.slice(start, end).replace(/(<section id="seccion-libro-reserva"[^>]*class=")([^"]+)/, '$1$2 activa');
const styles = [
    'css/styles.css', 'css/sites-shell-v1.css',
    'css/supabase-libro-reserva-v1.css',
    'css/supabase-libro-reserva-fidelidad-v1.css',
    'css/sites-libro-reserva-v1.css'
].filter(file => fs.existsSync(path.join(root, file))).map(read).join('\n');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const bytesA = Buffer.from([80, 75, 3, 4, 1, 2, 3, 4, 65]);
const bytesB = Buffer.from([80, 75, 3, 4, 9, 8, 7, 6, 66]);
const bytesGoogle = Buffer.from([80, 75, 3, 4, 11, 12, 13, 14, 67]);
const screenshotDir = path.join(os.tmpdir(), 'haiku-sites-libro');
fs.mkdirSync(screenshotDir, { recursive: true });

function documentFor(scripted) {
    const scripts = scripted ? [
        '<script src="/js/supabase-libro-reserva-v1.js" defer></script>',
        '<script src="/js/supabase-libro-google-readonly-v1.js" defer></script>',
        '<script src="/js/haiku-libro-consultas-v1.js" defer></script>'
    ].join('') : '';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}\nbody{margin:0}.test-layout{display:flex;min-width:0}.test-sidebar{width:212px;flex:0 0 212px;background:#192923;min-height:100vh}.test-main{flex:1;min-width:0;padding:0 24px}@media(max-width:700px){.test-sidebar{display:none}.test-main{padding:0 10px}}</style>${scripts}</head><body><div class="test-layout"><aside class="test-sidebar"></aside><main class="test-main">${section}</main></div><input id="haiku-asistente-texto"><script>window.HAIKU_ASISTENTE={abrir(){window.__assistantOpens=(window.__assistantOpens||0)+1}};</script></body></html>`;
}

function serve() {
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/first' || url.pathname === '/app') {
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(documentFor(url.pathname === '/app'));
            return;
        }
        if (/^\/js\/[a-z0-9-]+\.js$/.test(url.pathname)) {
            response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
            response.end(read(url.pathname.slice(1)));
            return;
        }
        if (/^\/css\/[a-z0-9-]+\.css$/.test(url.pathname)) {
            response.setHeader('Content-Type', 'text/css; charset=utf-8');
            response.end(read(url.pathname.slice(1)));
            return;
        }
        response.statusCode = 404;
        response.end('Not found');
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function mockExternalSources(context) {
    await context.addInitScript(({ fileId, mimeType, googleBytes }) => {
        window.__bookWorkerMessages = [];
        window.__driveCalls = [];
        // The conversational adapter only installs when its semantic engine
        // exists. Its data-path is covered by separate Libro tests.
        window.HAIKU_LIBRO_SEMANTICA = {};
        window.google = { accounts: { oauth2: {
            initTokenClient(config) {
                return {
                    callback: config.callback,
                    requestAccessToken() {
                        this.callback({ access_token: 'local-test-token', expires_in: 3600 });
                    }
                };
            },
            revoke(_token, done) { done?.(); }
        } } };
        const originalFetch = window.fetch.bind(window);
        window.fetch = (resource, init = {}) => {
            const url = String(resource);
            if (!url.startsWith('https://www.googleapis.com/drive/v3/files/')) return originalFetch(resource, init);
            window.__driveCalls.push({ url, method: init.method || 'GET' });
            if (url.includes('alt=media')) {
                return Promise.resolve(new Response(new Uint8Array(googleBytes), { status: 200 }));
            }
            return Promise.resolve(new Response(JSON.stringify({
                id: fileId,
                name: 'Libro Google real.xlsx',
                mimeType,
                modifiedTime: '2026-09-24T10:00:00Z',
                capabilities: { canDownload: true }
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        };
        class TestWorker {
            constructor() { this.listeners = new Map(); this.onmessage = null; this.onerror = null; }
            addEventListener(type, callback) { this.listeners.set(type, callback); }
            terminate() {}
            postMessage(message) {
                window.__bookWorkerMessages.push({ type: message.tipo, sheet: message.nombreHoja,
                    bytes: Array.from(new Uint8Array(message.buffer)) });
                const version = new Uint8Array(message.buffer).at(-1);
                let result;
                if (message.tipo === 'indice') {
                    result = { nombres: ['Sep26', 'Oct26'], hojas: [{ name: 'Sep26', Hidden: 0 }, { name: 'Oct26', Hidden: 0 }] };
                } else if (message.tipo === 'hoja') {
                    const name = message.nombreHoja;
                    result = {
                        rango: { s: { r: 0, c: 0 }, e: { r: 129, c: 19 } },
                        celdas: [
                            { r: 0, c: 0, valor: `${name} · ${version}`, estiloId: 0 },
                            { r: 18, c: 3, valor: 'Huésped real desde XLSX', estiloId: 0 }
                        ],
                        estilos: [{ fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF00' } },
                            font: { bold: true }, border: { bottom: { style: 'thin', color: { rgb: 'FF000000' } } } }],
                        columnas: Array.from({ length: 20 }, () => ({ wpx: 120 })),
                        filas: [], combinaciones: []
                    };
                } else {
                    result = { mock: true, type: message.tipo };
                }
                const event = { data: { id: message.id, ok: true, resultado: result } };
                queueMicrotask(() => {
                    this.listeners.get('message')?.(event);
                    this.onmessage?.(event);
                });
            }
        }
        window.Worker = TestWorker;
    }, { fileId: '1ZX4KqcdY6LORafrI6NkqwT3hGxrdK2rk', mimeType: mime, googleBytes: [...bytesGoogle] });
}

async function indexedVersions(page) {
    return page.evaluate(() => new Promise((resolve, reject) => {
        const opening = indexedDB.open('haiku-libro-reserva-local', 1);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
            const db = opening.result;
            const tx = db.transaction('libro', 'readonly');
            const store = tx.objectStore('libro');
            const current = store.get('actual');
            const previous = store.get('anterior');
            tx.oncomplete = () => {
                db.close();
                resolve({
                    current: current.result ? { name: current.result.nombre, bytes: Array.from(new Uint8Array(current.result.buffer)) } : null,
                    previous: previous.result ? { name: previous.result.nombre, bytes: Array.from(new Uint8Array(previous.result.buffer)) } : null
                });
            };
            tx.onerror = () => reject(tx.error);
        };
    }));
}

async function upload(page, name, bytes) {
    await page.locator('#libro-reserva-archivo').setInputFiles({ name, mimeType: mime, buffer: bytes });
    await page.waitForFunction(() => !!document.querySelector('#libro-reserva-visor table'));
    await page.evaluate(() => window.HAIKU_LIBRO_RESERVA_V1.listo());
}

(async () => {
    const server = await serve();
    const address = server.address();
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
        await mockExternalSources(context);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        const base = `http://127.0.0.1:${address.port}`;

        // The static document is rendered before any app JS/Worker/observer exists.
        await page.goto(`${base}/first`);
        assert.equal(await page.locator('#seccion-libro-reserva').isVisible(), true);
        assert.equal(await page.locator('.sites-libro-shell').isVisible(), true, 'Sites shell exists at first paint');
        assert.equal(await page.locator('.libro-reserva-vacio:visible').count(), 0, 'legacy empty state never paints');
        assert.match(await page.locator('#seccion-libro-reserva').innerText(), /Libro de Reserva/);
        assert.doesNotMatch(await page.locator('#seccion-libro-reserva').innerText(), /Descarga pendiente de enlace|Esta versión no inicia sesión en Google/);

        await page.goto(`${base}/app`);
        await page.waitForFunction(() => !!window.HAIKU_LIBRO_RESERVA_V1 && !!window.HAIKU_LIBRO_GOOGLE_V1);
        assert.equal(await page.evaluate(() => HAIKU_LIBRO_RESERVA_V1.estado().cargado), false);
        assert.equal(await page.locator('#libro-reserva-hoja').isDisabled(), true);
        assert.equal(await page.locator('#haiku-libro-google-sincronizar').isDisabled(), true);
        assert.equal(await page.evaluate(() => HAIKU_LIBRO_GOOGLE_V1.estado().conectado), false);

        await upload(page, 'Copia A.xlsx', bytesA);
        assert.match(await page.locator('#libro-reserva-estado-titulo').innerText(), /Copia A\.xlsx/);
        assert.match(await page.locator('#libro-reserva-estado-detalle').innerText(), /B|KB/);
        assert.deepEqual(await page.locator('#libro-reserva-hoja option').allTextContents(), ['Sep26', 'Oct26']);
        assert.match(await page.locator('#libro-reserva-meta').innerText(), /2 hojas.*130 filas.*20 columnas/);
        assert.match(await page.locator('#libro-reserva-pagina-estado').innerText(), /Filas 1–120 de 130/);
        assert.equal(await page.locator('#libro-reserva-pagina-siguiente').isEnabled(), true);
        assert.ok(await page.locator('#libro-reserva-visor thead th').count() >= 21, 'column letters and corner are visible');
        assert.match(await page.locator('#libro-reserva-visor tbody tr').first().locator('th').innerText(), /^1$/, 'row-number gutter is visible');
        assert.match(await page.locator('#libro-reserva-visor td[data-fila="0"][data-columna="0"]').innerText(), /Sep26/);
        assert.equal(await page.locator('#libro-reserva-visor td[data-fila="0"][data-columna="0"]').evaluate(cell => cell.style.backgroundColor), 'rgb(255, 255, 0)', 'XLSX cell fill survives Sites frame');
        assert.equal(await page.locator('#libro-reserva-visor td[data-fila="0"][data-columna="0"]').evaluate(cell => cell.style.fontWeight), '700');
        await page.locator('#libro-reserva-pagina-siguiente').click();
        assert.match(await page.locator('#libro-reserva-pagina-estado').innerText(), /Filas 121–130 de 130/);
        await page.locator('#libro-reserva-pagina-anterior').click();
        await page.locator('#libro-reserva-hoja').selectOption('Oct26');
        await page.waitForFunction(() => document.querySelector('#libro-reserva-visor td')?.textContent.includes('Oct26'));
        assert.match(await page.locator('#libro-reserva-visor td').first().innerText(), /Oct26/);
        assert.equal(await page.locator('#libro-reserva-visor').evaluate(el => el.scrollWidth > el.clientWidth), true, 'viewer scrolls horizontally');
        assert.equal(await page.locator('#libro-reserva-visor').evaluate(el => getComputedStyle(el).overflowY), 'auto');
        const desktopScreenshot = path.join(screenshotDir, 'sites-libro-1600.png');
        await page.screenshot({ path: desktopScreenshot, fullPage: true });

        const zoomOut = page.locator('[aria-label="Alejar Libro"]');
        const zoomIn = page.locator('[aria-label="Acercar Libro"]');
        assert.equal(await zoomOut.count(), 1);
        await zoomOut.click();
        assert.equal(await page.locator('#libro-reserva-visor table').evaluate(el => el.style.zoom), '0.9');
        await zoomIn.click();
        assert.equal(await page.locator('#libro-reserva-visor table').evaluate(el => el.style.zoom), '1');

        let versions = await indexedVersions(page);
        assert.deepEqual(versions.current.bytes, [...bytesA]);
        assert.equal(versions.current.name, 'Copia A.xlsx');
        assert.equal(versions.previous, null);

        const [download] = await Promise.all([
            page.waitForEvent('download'), page.locator('#libro-reserva-descargar').click()
        ]);
        assert.equal(download.suggestedFilename(), 'Copia A.xlsx');
        assert.deepEqual(fs.readFileSync(await download.path()), bytesA, 'download is the local XLSX bytes, not reconstructed DOM or fixed Google file');

        await page.locator('#libro-reserva-archivo').setInputFiles({ name: 'No es libro.txt', mimeType: 'text/plain', buffer: Buffer.from('not xlsx') });
        await page.waitForFunction(() => document.querySelector('#libro-reserva-visor')?.textContent.includes('Formato no compatible'));
        assert.equal(await page.evaluate(() => HAIKU_LIBRO_RESERVA_V1.estado().nombre), 'Copia A.xlsx', 'invalid import does not replace the loaded file');
        assert.deepEqual((await indexedVersions(page)).current.bytes, [...bytesA]);

        await upload(page, 'Copia B.xlsx', bytesB);
        versions = await indexedVersions(page);
        assert.deepEqual(versions.current.bytes, [...bytesB]);
        assert.deepEqual(versions.previous.bytes, [...bytesA]);
        assert.equal(versions.previous.name, 'Copia A.xlsx');
        assert.match(await page.locator('#sites-libro-memoria-detalle').innerText(), /anterior|2 versiones|dos versiones/i);
        await upload(page, 'Copia B.xlsx', bytesB);
        versions = await indexedVersions(page);
        assert.deepEqual(versions.previous.bytes, [...bytesA], 'reloading identical bytes does not rotate the previous version');

        await page.reload();
        await page.waitForFunction(() => window.HAIKU_LIBRO_RESERVA_V1?.estado().cargado === true);
        await page.locator('#libro-reserva-visor table').waitFor();
        assert.equal(await page.evaluate(() => HAIKU_LIBRO_RESERVA_V1.estado().nombre), 'Copia B.xlsx');
        versions = await indexedVersions(page);
        assert.deepEqual(versions.previous.bytes, [...bytesA]);

        const consult = page.getByRole('button', { name: 'Consultar Libro con Haku' });
        assert.equal(await consult.count(), 1);
        await consult.click();
        assert.equal(await page.evaluate(() => window.__assistantOpens), 1);
        assert.match(await page.locator('#haiku-asistente-texto').inputValue(), /Libro:/);

        for (const width of [1600, 1440, 1200, 1100, 390]) {
            await page.setViewportSize({ width, height: 900 });
            assert.equal(await page.locator('#seccion-libro-reserva').isVisible(), true, `visible at ${width}px`);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `no page horizontal scroll at ${width}px`);
            assert.equal(await page.locator('#libro-reserva-visor').evaluate(el => el.scrollWidth > el.clientWidth), true, `internal spreadsheet scroll at ${width}px`);
            if (width === 390) await page.screenshot({ path: path.join(screenshotDir, 'sites-libro-390.png'), fullPage: true });
        }
        await page.setViewportSize({ width: 1600, height: 900 });

        // Real connector path: OAuth read-only token, Drive metadata, byte fetch,
        // and delivery to the same local XLSX loader (all remote replies mocked).
        await page.locator('#haiku-libro-google-conectar').click();
        await page.waitForFunction(() => window.HAIKU_LIBRO_GOOGLE_V1?.estado().conectado &&
            window.HAIKU_LIBRO_RESERVA_V1?.estado().nombre === 'Libro Google real.xlsx');
        assert.equal(await page.locator('#haiku-libro-google-sincronizar').isEnabled(), true);
        assert.match(await page.locator('#sites-libro-online-titulo').innerText(), /conectado/i);
        assert.deepEqual(await page.evaluate(() => window.__driveCalls.map(call => call.method)), ['GET', 'GET']);
        versions = await indexedVersions(page);
        assert.equal(versions.current.name, 'Libro Google real.xlsx');
        assert.deepEqual(versions.current.bytes, [...bytesGoogle]);
        assert.deepEqual(versions.previous.bytes, [...bytesB]);
        await page.locator('#haiku-libro-google-sincronizar').click();
        await page.waitForFunction(() => window.__driveCalls.length >= 4);
        assert.deepEqual(await page.evaluate(() => window.__driveCalls.map(call => call.method)), ['GET', 'GET', 'GET', 'GET']);

        // Clearing the local book must not disconnect OAuth, but the status
        // must stop describing a local copy as updated from Google.
        await page.locator('#libro-reserva-quitar').click();
        await page.waitForFunction(() => window.HAIKU_LIBRO_RESERVA_V1?.estado().cargado === false);
        assert.equal(await page.evaluate(() => HAIKU_LIBRO_GOOGLE_V1.estado().conectado), true);
        assert.match(await page.locator('#sites-libro-online-titulo').innerText(), /conectado/i);
        assert.doesNotMatch(await page.locator('#sites-libro-online-detalle').innerText(), /copia local actualizad|al día|vigente/i);
        assert.match(await page.locator('#sites-libro-online-detalle').innerText(), /sin copia local|no verificada/i);

        // A different manual XLSX can be loaded while Drive's modifiedTime
        // stays unchanged. The automatic check may skip media GET; it must
        // not claim those local bytes were compared or synchronized.
        await upload(page, 'Copia B.xlsx', bytesB);
        const callsBeforeAutoCheck = await page.evaluate(() => window.__driveCalls.length);
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForFunction(count => window.__driveCalls.length > count &&
            window.HAIKU_LIBRO_GOOGLE_V1.estado().sincronizando === false, callsBeforeAutoCheck);
        assert.equal(await page.evaluate(() => window.__driveCalls.length), callsBeforeAutoCheck + 1,
            'unchanged modifiedTime performs only metadata GET');
        assert.deepEqual((await indexedVersions(page)).current.bytes, [...bytesB], 'manual local bytes remain authoritative');
        assert.match(await page.locator('#sites-libro-online-detalle').innerText(), /sin cambios|comprobado|comprobada/i);
        assert.match(await page.locator('#sites-libro-online-detalle').innerText(), /no comparad/i);
        assert.match(await page.locator('#sites-libro-sync-titulo').innerText(), /Comprobación automática activa/i);

        await page.locator('#libro-reserva-quitar').click();
        await page.waitForFunction(() => window.HAIKU_LIBRO_RESERVA_V1?.estado().cargado === false);
        versions = await indexedVersions(page);
        assert.equal(versions.current, null);
        assert.equal(versions.previous, null);
        await page.reload();
        await page.waitForFunction(() => !!window.HAIKU_LIBRO_RESERVA_V1);
        assert.equal(await page.evaluate(() => HAIKU_LIBRO_RESERVA_V1.estado().cargado), false);
        assert.deepEqual(errors, [], 'no runtime errors');

        // The Haku action must also be installed by a fresh mobile load, not
        // merely carried over from an earlier desktop DOM.
        const mobileFresh = await context.newPage();
        await mobileFresh.setViewportSize({ width: 390, height: 800 });
        await mobileFresh.goto(`${base}/app`);
        await mobileFresh.waitForFunction(() => !!window.HAIKU_LIBRO_RESERVA_V1);
        const mobileConsult = mobileFresh.getByRole('button', { name: 'Consultar Libro con Haku' });
        assert.equal(await mobileConsult.isVisible(), true, 'Haku action appears on fresh 390px load');
        await mobileConsult.click();
        assert.equal(await mobileFresh.evaluate(() => window.__assistantOpens), 1);
        await mobileFresh.close();
        await context.close();
        console.log('PASS Sites Libro browser: first paint, XLSX metadata/format, sheets, rows, zoom, exact bytes, IndexedDB versions/reload/clear, Haku, Google readonly, responsive.');
        console.log(`Screenshots: ${desktopScreenshot} ; ${path.join(screenshotDir, 'sites-libro-390.png')}`);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
