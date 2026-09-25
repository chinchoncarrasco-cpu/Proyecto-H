// Recorre panel.html y los controles visibles con fuentes externas sustituidas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const raiz = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const modulos = new Set([
    'js/historial.js', 'js/calendario.js', 'js/checklist.js', 'js/app.js',
    'js/cabanas.js', 'js/sites-cabanas-v1.js'
]);

(async () => {
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 },
            timezoneId: 'America/Santiago' });
        const errores = [];
        page.on('pageerror', error => errores.push(error.message));
        await page.addInitScript(() => {
            window.haikuSesion = { auth: { id: 'usuario-cabanas' } };
            window.haikuSupabase = { rpc: async () => ({ data: [], error: null }) };
            window.HAIKU_PRIVACIDAD = { estado: () => ({ modo: 'visible', armado: true }) };
            window.HAIKU_REVISION_SUPABASE_V1 = {};
        });
        await page.route('https://cdn.jsdelivr.net/**', ruta => ruta.fulfill({
            contentType: 'application/javascript', body: 'window.supabase={createClient:()=>({})}'
        }));
        await page.route('http://haiku-cabanas.test/**', ruta => {
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
        await page.goto('http://haiku-cabanas.test/panel.html');
        await page.waitForFunction(() => Boolean(window.HAIKU_CABANAS_SITES_V1));
        await page.evaluate(() => {
            fechaSeleccionada = '2026-09-10';
            window.HAIKU_CONTEXTO_FECHAS_V1.guardarFechaActual();
            const datos = obtenerDatosDia(fechaSeleccionada);
            datos.cabanas['1'] = { revisionCompletaCiclo: {
                fecha: fechaSeleccionada, verificado: true, id: 'revision-1', estado: 'en_proceso'
            } };
            guardarDatos();
            window.HAIKU_CABANAS_SITES_V1.pintar(fechaSeleccionada);
        });
        await page.locator('.menu-item[data-seccion="cabanas"]').click();
        await page.locator('#seccion-cabanas [data-cab-tab="review"]').click();
        await page.locator('#cabinsReview [data-cb-open="1"]').click();
        assert.equal(await page.locator('#cabinsDetail').isVisible(), true);
        await page.reload();
        await page.waitForFunction(() => Boolean(window.HAIKU_CABANAS_SITES_V1) &&
            !document.documentElement.classList.contains('haiku-cabanas-pendiente'));
        assert.equal(await page.evaluate(() => fechaSeleccionada), '2026-09-10');
        assert.equal(await page.locator('#seccion-cabanas').isVisible(), true);
        assert.equal(await page.locator('#cabinsDetail').isVisible(), true);
        assert.equal(await page.locator('#revision-individual').evaluate(nodo =>
            nodo.classList.contains('activa')), true);
        assert.match(await page.locator('#revision-titulo').textContent(), /Cabaña 1/);
        assert.equal(await page.evaluate(() => localStorage.getItem('haikuRevisionCabana')), '1');
        assert.equal(errores.length, 0, errores.join('\n'));
        console.log('Panel Cabañas: F5 conserva fecha, sección, ficha y revisión completa.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
