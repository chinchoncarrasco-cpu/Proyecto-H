// Verificación visual local del Calendario real en Edge, con datos deterministas.
// No conecta a Supabase ni escribe datos remotos.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { auditarContraste } = require('./haiku-tema-browser-check.cjs');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const start = html.indexOf('<section id="seccion-calendario"');
const end = html.indexOf('<!-- =========================\n         CALENDARIO · SELECCIÓN', start);
const endCrLf = html.indexOf('<!-- =========================\r\n         CALENDARIO · SELECCIÓN', start);
const sectionEnd = end >= 0 ? end : endCrLf;
assert.ok(start >= 0 && sectionEnd > start);
const section = html.slice(start, sectionEnd).replace('class="seccion-app sites-calendario"',
    'class="seccion-app sites-calendario activa"');
const css = ['css/styles.css', 'css/sites-shell-v1.css', 'css/sites-calendario-v1.css', 'css/haiku-tema-oscuro-v1.css',
    'css/haiku-tema-v1.css', 'css/haiku-tema-legibilidad-v1.css'].map(read).join('\n');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const documentHTML = `<!doctype html><html lang="es" data-haiku-tema="claro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><span id="fecha-actual"></span><main style="min-width:0">${section}</main></body></html>`;

const coloresBarras = page => page.locator('.calendario-reserva-barra').evaluateAll(barras => Object.fromEntries(barras.map(barra => {
    const estilo = getComputedStyle(barra);
    return [barra.dataset.reservaId, { fondo: estilo.backgroundColor, acento: estilo.boxShadow.match(/rgba?\([^)]+\)/)?.[0] }];
})));

async function comprobarCalendario(browser, temas = process.env.CALENDARIO_TEMAS_CAPTURAS) {
    const server = http.createServer((_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(documentHTML);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let page;
    try {
        page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        page.setDefaultTimeout(6000);
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(() => {
            localStorage.setItem('haikuDatos', JSON.stringify({
                '2026-09-20': { cabanas: {
                    2: { reservaId: 'R-sale', estadiaId: 'E-sale', titular: 'Martín López', fechaOrigenReserva: '2026-09-20', noches: 3 }
                } },
                '2026-09-23': { cabanas: {
                    3: { reservaId: 'R-ingresa', estadiaId: 'E-ingresa', titular: 'Camila Ortega', fechaOrigenReserva: '2026-09-23', noches: 2 }
                } },
                '2026-09-24': { cabanas: {
                    4: { reservaId: 'R-out', estadiaId: 'E-out', titular: 'Estadía finalizada', noches: 1 },
                    8: { reservaId: 'R-extra1', estadiaId: 'E-extra1', titular: 'Reserva adicional 1', noches: 1 },
                    9: { reservaId: 'R-extra2', estadiaId: 'E-extra2', titular: 'Reserva adicional 2', noches: 1 }
                } },
                '2026-09-25': { cabanas: {
                    5: { reservaId: 'R-full', estadiaId: 'E-full', titular: 'Visita Full Day', tipoEstadia: 'fullday' }
                } },
                '2026-09-26': { cabanas: {
                    6: { estado: 'bloqueada', bloqueoId: 'B-prueba' }
                } },
                '2026-09-27': { cabanas: {
                    7: { reservaId: 'R-pendiente', estadiaId: 'E-pendiente', titular: 'Reserva pendiente', noches: 1 }
                } }
            }));
            window.__opened = [];
            window.HAIKU_RESUMEN_RESERVA_SITES_V1 = { abrirPorId: (id, _boton, contexto) =>
                window.__opened.push([id, contexto.estadiaId, contexto.numeroCabana]) };
            localStorage.setItem('haikuEstadosCalendarioV1', JSON.stringify({ version: 2, estadias: {
                'E-sale': { reservaId: 'R-sale', estado: 'hospedada' },
                'E-ingresa': { reservaId: 'R-ingresa', estado: 'confirmada' },
                'E-out': { reservaId: 'R-out', estado: 'checked_out' },
                'E-extra1': { reservaId: 'R-extra1', estado: 'confirmada' },
                'E-extra2': { reservaId: 'R-extra2', estado: 'confirmada' },
                'E-full': { reservaId: 'R-full', estado: 'confirmada' },
                'E-pendiente': { reservaId: 'R-pendiente', estado: 'pendiente' }
            } }));
            window.haikuSupabase = { channel: () => ({ on() { return this; }, subscribe() { return this; } }) };
        });
        await page.addScriptTag({ content: read('js/calendario.js') });
        await page.addScriptTag({ content: read('js/supabase-calendario-estados-v1.js') });
        await page.evaluate(() => {
            fechaCalendario = new Date(2026, 8, 1);
            fechaCalendarioSeleccionadaMovil = '2026-09-23';
            generarCalendario();
        });
        assert.equal(await page.locator('[data-calendario-leyenda="hospedado"]').isVisible(), true);
        assert.equal(await page.locator('[data-calendario-leyenda="confirmada"]').isVisible(), true);
        assert.equal(await page.locator('[data-calendario-leyenda="fullday"]').isVisible(), true);
        assert.equal(await page.locator('[data-calendario-leyenda="bloqueo"]').isVisible(), true);

        for (const width of [320, 390, 430, 780, 781, 1100, 1200, 1440, 1600]) {
            await page.setViewportSize({ width, height: 844 });
            const mobile = width <= 780;
            await page.waitForFunction(mobile =>
                (document.querySelectorAll('#calendario-grid .calendario-reserva-barra').length === 0) === mobile,
            mobile);
            const result = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
                bars: document.querySelectorAll('#calendario-grid .calendario-reserva-barra').length,
                agendaVisible: getComputedStyle(document.getElementById('calendario-agenda-movil')).display !== 'none',
                dayHeight: document.querySelector('#calendario-grid .dia-calendario').getBoundingClientRect().height,
                gridWidth: document.getElementById('calendario-grid').getBoundingClientRect().width,
                panelWidth: document.querySelector('.sites-calendario-panel').getBoundingClientRect().width
            }));
            assert.ok(result.scrollWidth <= result.clientWidth, `${width}px: scroll horizontal ${JSON.stringify(result)}`);
            assert.ok(result.gridWidth <= result.panelWidth + 1, `${width}px: cuadrícula cortada`);
            assert.equal(result.agendaVisible, mobile, `${width}px: agenda`);
            if (mobile) assert.equal(result.bars, 0, `${width}px: renderer móvil`);
            else assert.ok(result.bars >= 2, `${width}px: renderer desktop ${JSON.stringify(result)}`);
            if (mobile) assert.equal(result.dayHeight, 44);
        }

        if (temas) fs.mkdirSync(temas, { recursive: true });
        const claro = await coloresBarras(page);
        assert.equal(claro['R-out'].fondo, 'rgb(160, 160, 160)');
        if (temas) await page.locator('#seccion-calendario').screenshot({ path: path.join(temas, 'calendario-claro.png') });
        await page.evaluate(() => { document.documentElement.dataset.haikuTema = 'oscuro'; });
        const oscuro = await coloresBarras(page);
        assert.deepEqual(Object.keys(oscuro), Object.keys(claro));
        assert.equal(new Set(Object.values(oscuro).map(x => x.fondo)).size, 5, 'cada grupo conserva su fondo en oscuro');
        assert.equal(new Set(Object.values(oscuro).map(x => x.acento)).size, 5, 'cada grupo conserva su acento en oscuro');
        assert.deepEqual(oscuro['R-pendiente'], oscuro['R-ingresa']);
        assert.equal(oscuro['R-out'].fondo, 'rgb(56, 59, 66)');
        assert.deepEqual(await page.evaluate(auditarContraste, '.calendario-reservas-capa'), []);
        assert.match(await page.locator('.cal-reserva-bloqueada.calendario-reserva-barra').evaluate(el => getComputedStyle(el).backgroundImage), /repeating-linear-gradient/);
        for (const [leyenda, id] of [['hospedado', 'R-sale'], ['confirmada', 'R-ingresa'], ['fullday', 'R-full'], ['bloqueo', 'B-prueba-CAB-6']]) {
            const marca = page.locator(`[data-calendario-leyenda="${leyenda}"] .sites-calendario-leyenda-marca`);
            assert.deepEqual(await marca.evaluate(el => ({ fondo: getComputedStyle(el).backgroundColor, acento: getComputedStyle(el).borderLeftColor })), oscuro[id]);
        }
        if (temas) await page.locator('#seccion-calendario').screenshot({ path: path.join(temas, 'calendario-oscuro.png') });
        await page.setViewportSize({ width: 1100, height: 844 });
        assert.deepEqual(await coloresBarras(page), oscuro);
        await page.locator('.calendario-mas-reservas[data-fecha="2026-09-24"]').click();
        const panel = page.locator('.sites-calendario-popover');
        for (const id of ['R-ingresa', 'R-out']) {
            const fila = panel.locator(`[data-reserva-id="${id}"]`);
            assert.equal(await fila.evaluate(el => getComputedStyle(el).borderLeftColor), oscuro[id].acento);
        }
        await panel.locator('.calendario-panel-cerrar').click();
        await page.evaluate(() => { document.documentElement.dataset.haikuTema = 'claro'; });
        assert.deepEqual(await coloresBarras(page), claro);
        await page.locator('.calendario-reserva-barra[data-reserva-id="R-ingresa"]').click();
        assert.deepEqual(await page.evaluate(() => window.__opened), [['R-ingresa', 'E-ingresa', '3']]);

        await page.evaluate(() => { document.documentElement.dataset.haikuTema = 'oscuro'; });
        for (const width of [320, 390]) {
            await page.setViewportSize({ width, height: 844 });
            for (const [dia, id] of [[23, 'R-sale'], [23, 'R-ingresa'], [24, 'R-out'], [25, 'R-full'], [26, 'B-prueba-CAB-6']]) {
                await page.locator(`.dia-calendario[data-fecha="2026-09-${dia}"]`).click();
                const riel = page.locator(`.sites-calendario-agenda-item[data-reserva-id="${id}"] .sites-calendario-agenda-riel`);
                assert.equal(await riel.evaluate(el => getComputedStyle(el).backgroundColor), oscuro[id].acento);
            }
        }
        await page.locator('.dia-calendario[data-fecha="2026-09-23"]').click();
        if (temas) await page.locator('#seccion-calendario').screenshot({ path: path.join(temas, 'calendario-oscuro-movil.png') });
        await page.evaluate(() => { document.documentElement.dataset.haikuTema = 'claro'; });
        if (process.env.CALENDARIO_SCREENSHOT) {
            await page.screenshot({ path: process.env.CALENDARIO_SCREENSHOT, fullPage: true });
        }
        await page.locator('#calendario-grid .dia-calendario').first().evaluate(node => {
            node.dataset.browserIdentity = 'stable';
        });
        await page.locator('.sites-calendario-agenda-item[data-reserva-id="R-sale"]').click();
        assert.deepEqual(await page.evaluate(() => window.__opened),
            [['R-ingresa', 'E-ingresa', '3'], ['R-sale', 'E-sale', '2']]);
        await page.locator('#calendario-grid .dia-calendario[data-fecha="2026-09-28"]').click();
        assert.equal(await page.locator('#calendario-grid .dia-calendario').first().getAttribute('data-browser-identity'), 'stable');
        assert.match(await page.locator('.sites-calendario-agenda-vacia').innerText(), /Sin reservas/);
        assert.equal(await page.locator('#calendario-grid .dia-calendario.seleccionado').getAttribute('data-fecha'), '2026-09-28');
        console.log('Calendario Sites: colores por estado, contraste, leyenda, agenda y navegación correctos.');
    } finally {
        await page?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

if (require.main === module) (async () => {
    const browser = await chromium.launch({ executablePath: process.env.HAKU_CHROMIUM_PATH || edge, headless: true });
    try { await comprobarCalendario(browser); }
    finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { comprobarCalendario };
