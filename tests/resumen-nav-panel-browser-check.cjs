// Usa panel.html real y los botones visibles; las lecturas externas se sustituyen.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const raiz = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const modulos = new Set([
    'js/supabase-resumen-refresh-v1.js',
    'js/calendario.js',
    'js/supabase-resumen-tablero-v1.js'
]);

(async () => {
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 },
            timezoneId: 'America/Santiago' });
        const errores = [];
        page.on('pageerror', error => errores.push(error.message));
        await page.addInitScript(() => {
            window.haikuSesion = { auth: { id: 'usuario-prueba' } };
            window.haikuSupabase = { rpc: async () => ({ data: [], error: null }) };
            window.HAIKU_PRIVACIDAD = { estado: () => ({ modo: 'visible', armado: true }) };
        });
        await page.route('https://cdn.jsdelivr.net/**', ruta => ruta.fulfill({
            contentType: 'application/javascript',
            body: 'window.supabase={createClient:()=>({})}'
        }));
        await page.route('http://haiku.test/**', ruta => {
            const nombre = decodeURIComponent(new URL(ruta.request().url()).pathname.slice(1));
            if (nombre.includes('..')) return ruta.abort();
            const archivo = path.join(raiz, nombre);
            if (!fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) return ruta.abort();
            if (nombre.endsWith('.js') && !modulos.has(nombre)) {
                return ruta.fulfill({ contentType: 'application/javascript', body: '' });
            }
            const tipo = nombre.endsWith('.html') ? 'text/html' :
                nombre.endsWith('.js') ? 'application/javascript' :
                    nombre.endsWith('.css') ? 'text/css' : 'application/octet-stream';
            return ruta.fulfill({ contentType: tipo, body: fs.readFileSync(archivo) });
        });
        await page.goto('http://haiku.test/panel.html');
        await page.waitForFunction(() => window.HAIKU_RESUMEN_SITES_V1 &&
            window.HAIKU_RESUMEN_REFRESH_V1?.activo());
        assert.equal(await page.evaluate(() => Boolean(window.HAIKU_RESUMEN_NAV_DIAG_V1)), false);
        assert.equal(await page.locator('#resumen-nav-diagnostico-temporal').count(), 0);
        await page.evaluate(() => {
            const coordinador = window.HAIKU_RESUMEN_REFRESH_V1;
            for (const nombre of ['reservas', 'servicios', 'pagos', 'checkout',
                'checkoutAutoridad', 'operacion', 'autoridadVisual']) {
                coordinador.registrar(nombre, {
                    preparar: () => {
                        const dato = nombre === 'operacion' ? { filas: [] } :
                            nombre === 'pagos' ? { cargos: [], pendientes: [] } : true;
                        if (nombre === 'pagos' && window.__retenerPagos) {
                            return new Promise(resolve => { window.__liberarPagos = () => resolve(dato); });
                        }
                        return dato;
                    },
                    publicar: () => {}
                });
            }
        });
        await page.waitForFunction(() => window.HAIKU_RESUMEN_REFRESH_V1.publicaciones() >= 1);
        const fechaInicial = await page.evaluate(() => String(fechaSeleccionada));
        const anterior = await page.evaluate(fecha => {
            const [anio, mes, dia] = fecha.split('-').map(Number);
            const valor = new Date(anio, mes - 1, dia - 1);
            return [valor.getFullYear(), String(valor.getMonth() + 1).padStart(2, '0'),
                String(valor.getDate()).padStart(2, '0')].join('-');
        }, fechaInicial);

        await page.evaluate(() => { window.__retenerPagos = true; });
        await page.locator('#resumen-dia-anterior').click();
        await page.waitForFunction(() => typeof window.__liberarPagos === 'function');
        assert.equal(await page.evaluate(() => String(fechaSeleccionada)), anterior);
        assert.equal(await page.evaluate(() => window.HAIKU_RESUMEN_REFRESH_V1.ultimo().fecha),
            fechaInicial);
        assert.equal(await page.locator('#resumen-dia-anterior').getAttribute('aria-busy'), 'true');
        const solicitudAnterior = await page.evaluate(() =>
            window.HAIKU_RESUMEN_REFRESH_V1.historialGeneraciones().at(-1));
        assert.equal(solicitudAnterior.fecha, anterior);
        assert.equal(solicitudAnterior.evento, 'Día anterior');
        assert.equal(solicitudAnterior.categoria, 'navegación usuario');
        await page.evaluate(() => {
            window.__retenerPagos = false;
            window.__liberarPagos();
        });
        await page.waitForFunction(fecha => window.HAIKU_RESUMEN_REFRESH_V1.ultimo().fecha === fecha,
            anterior);
        assert.equal(await page.locator('#resumen-dia-anterior').getAttribute('aria-busy'), null);

        await page.locator('#resumen-dia-siguiente').click();
        await page.waitForFunction(fecha => window.HAIKU_RESUMEN_REFRESH_V1.ultimo().fecha === fecha,
            fechaInicial);
        assert.equal(await page.evaluate(() =>
            window.HAIKU_RESUMEN_REFRESH_V1.historialGeneraciones().at(-1).evento),
        'Día siguiente');

        await page.locator('#resumen-dia-anterior').click();
        await page.locator('#resumen-dia-hoy').click();
        const hoy = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date());
        await page.waitForFunction(fecha => window.HAIKU_RESUMEN_REFRESH_V1.ultimo().fecha === fecha,
            hoy);
        assert.equal(await page.evaluate(() => String(fechaSeleccionada)), hoy);
        assert.equal(await page.evaluate(() =>
            window.HAIKU_RESUMEN_REFRESH_V1.historialGeneraciones().at(-1).evento), 'Hoy');
        assert.equal(errores.length, 0, errores.join('\n'));
        console.log('Panel sin diagnóstico: anterior, siguiente y Hoy publican la fecha completa.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
