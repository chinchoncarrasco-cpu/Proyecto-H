// Contrato visual de la comparación mensual real: CSS disponible antes de pintar
// y render sin wrappers legacy, con la lógica financiera simulada en memoria.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const source = fs.readFileSync(path.join(root, 'js/haiku-libro-consultas-v1.js'), 'utf8')
    .replace('Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })',
        'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion, renderizarComparacion })');

const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/sites-shell-v1.css"><link rel="stylesheet" href="/css/supabase-asistente-v1.css"><link rel="stylesheet" href="/css/supabase-haku-reconciliacion-v1.css"><link rel="stylesheet" href="/css/sites-asistente-v1.css"></head><body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel" style="display:block;position:relative!important;height:100dvh"><div class="haiku-asistente-mensajes" id="mensajes"></div></div></div></body></html>');
        return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
        response.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
        response.end(fs.readFileSync(file));
    } catch { response.writeHead(404).end(); }
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/haiku-libro-semantica-v1.js'), 'utf8') });
        await page.addScriptTag({ content: source });
        await page.evaluate(() => {
            const libro = { titular: 'Persona de prueba', cabana: 2, fecha_checkin: '2026-09-12', fecha_checkout: '2026-09-13', noches: 1,
                coordenadas_origen: { hoja: 'Sep26', celda: 'D20' }, pagos: [], pagos_sin_asociacion: [], advertencias_informativas: [] };
            const grupo = { estado: 'asociada', cabanas: [2], principal: libro, diferencias: ['Fecha distinta'], items: [{ libro }] };
            const comparacion = [{ estado: 'asociada', libro }];
            comparacion.grupos = [grupo];
            comparacion.pagosDetalle = [{ estado: 'revisar', reserva: libro, pago: { tipo_movimiento: 'alojamiento', monto: 16000 } }];
            comparacion.serviciosDetalle = [{ estado: 'revisar', reserva: libro, servicio: { concepto: 'Tinaja', texto_original: 'Servicio por revisar' } }];
            comparacion.meta = { libro: 1, estadias_libro: 1, proyecto: 2, asociadas: 1, faltantes: 0, ambiguas: 0,
                pagos_faltantes: 0, pagos_revisar: 1, servicios_revisar: 1 };
            window.__comparacionDePrueba = comparacion;
            const out = document.createElement('div');
            window.HAIKU_LIBRO_CONSULTAS.renderizarComparacion(out, { q: { desde: '2026-09-01', hasta: '2026-09-30' }, comparacion });
            document.getElementById('mensajes').append(out);
        });
        const report = page.locator('.haku-comparacion-sites');
        assert.equal(await report.count(), 1);
        assert.equal(await report.locator('.haiku-asistente-preview-resumen').count(), 0, 'sin banda legacy en el primer render');
        assert.equal(await report.locator('.haku-comparacion-sites-resumen').count(), 1);
        assert.equal(await report.locator('.haku-comparacion-sites-metricas > *').count(), 3);
        assert.match(await report.innerText(), /1 \/ 1[\s\S]*Estancias del Libro coinciden/);
        assert.match(await report.innerText(), /1 pagos requieren revisión/);
        assert.match(await report.innerText(), /Detalles técnicos XLSX/);
        const rows = report.locator('.haku-comparacion-sites-seccion .haiku-comparacion-acordeon');
        assert.ok(await rows.count() >= 4);
        await rows.first().locator('summary').click();
        assert.equal(await rows.first().getAttribute('open'), '');
        assert.match(await rows.first().innerText(), /Fecha distinta/);
        assert.equal(await report.locator('button', { hasText: 'Preparar incorporación' }).count(), 1);
        assert.equal(await report.locator('.haku-comparacion-sites-lectura').innerText(), 'Sólo lectura');
        for (const width of [1600, 1440, 1200, 1100, 390]) {
            await page.setViewportSize({ width, height: 900 });
            if (width === 390) {
                const closed = report.locator('.haku-comparacion-sites-seccion details:not([open]) > summary');
                while (await closed.count()) await closed.first().click();
                assert.match(await report.innerText(), /Sep26!D20/, 'origen XLSX sólo en su detalle abierto');
            }
            const fit = await report.evaluate(el => ({ width: el.getBoundingClientRect().width,
                scroll: el.scrollWidth, client: el.clientWidth, visible: getComputedStyle(el).display !== 'none' }));
            assert.equal(fit.visible, true, `${width}: informe visible`);
            assert.ok(fit.scroll <= fit.client + 1, `${width}: desborde horizontal ${fit.scroll}/${fit.client}`);
            if (width === 390 && process.env.HAKU_COMPARACION_SCREENSHOT) await page.screenshot({ path: process.env.HAKU_COMPARACION_SCREENSHOT, fullPage: true });
        }
        await page.evaluate(() => window.HAIKU_LIBRO_CONSULTAS.renderizarComparacion(
            document.querySelector('.haku-comparacion-sites'),
            { q: { desde: '2026-10-01', hasta: '2026-10-31' }, comparacion: window.__comparacionDePrueba }));
        assert.match(await report.locator('.haku-comparacion-sites-periodo').innerText(),
            /2026-10-01 al 2026-10-31/);
        assert.equal(await report.locator('button', { hasText: 'Preparar incorporación' }).count(), 1);
        assert.deepEqual(errors, []);
        console.log('Comparación Sites: primer render, contenido, acordeones, preparación y responsive OK');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
