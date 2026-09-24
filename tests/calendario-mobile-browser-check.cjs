// Verificación visual local del Calendario real en Edge, con datos deterministas.
// No conecta a Supabase ni escribe datos remotos.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

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
const css = ['css/styles.css', 'css/sites-shell-v1.css', 'css/sites-calendario-v1.css'].map(read).join('\n');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const documentHTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><span id="fecha-actual"></span><main style="min-width:0">${section}</main></body></html>`;

(async () => {
    const server = http.createServer((_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(documentHTML);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(() => {
            localStorage.setItem('haikuDatos', JSON.stringify({
                '2026-09-20': { cabanas: {
                    2: { reservaId: 'R-sale', estadiaId: 'E-sale', titular: 'Martín López', fechaOrigenReserva: '2026-09-20', noches: 3 }
                } },
                '2026-09-23': { cabanas: {
                    3: { reservaId: 'R-ingresa', estadiaId: 'E-ingresa', titular: 'Camila Ortega', fechaOrigenReserva: '2026-09-23', noches: 2 }
                } }
            }));
            window.__opened = [];
            window.HAIKU_RESUMEN_RESERVA_SITES_V1 = { abrirPorId: id => window.__opened.push(id) };
            window.HAIKU_CALENDARIO_ESTADOS_V1 = { estado: id => id === 'R-ingresa' ? 'confirmada' : 'hospedada' };
        });
        await page.addScriptTag({ content: read('js/calendario.js') });
        await page.evaluate(() => {
            fechaCalendario = new Date(2026, 8, 1);
            fechaCalendarioSeleccionadaMovil = '2026-09-23';
            generarCalendario();
        });
        assert.equal(await page.locator('[data-calendario-leyenda="hospedado"]').isVisible(), true);
        assert.equal(await page.locator('[data-calendario-leyenda="confirmada"]').isVisible(), true);
        assert.equal(await page.locator('[data-calendario-leyenda="fullday"]').isVisible(), false);
        assert.equal(await page.locator('[data-calendario-leyenda="bloqueo"]').isVisible(), false);

        for (const width of [390, 430, 780, 781, 1100, 1200, 1440, 1600]) {
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

        await page.setViewportSize({ width: 390, height: 844 });
        if (process.env.CALENDARIO_SCREENSHOT) {
            await page.screenshot({ path: process.env.CALENDARIO_SCREENSHOT, fullPage: true });
        }
        await page.locator('#calendario-grid .dia-calendario').first().evaluate(node => {
            node.dataset.browserIdentity = 'stable';
        });
        await page.locator('.sites-calendario-agenda-item[data-reserva-id="R-sale"]').click();
        assert.deepEqual(await page.evaluate(() => window.__opened), ['R-sale']);
        await page.locator('#calendario-grid .dia-calendario[data-fecha="2026-09-28"]').click();
        assert.equal(await page.locator('#calendario-grid .dia-calendario').first().getAttribute('data-browser-identity'), 'stable');
        assert.match(await page.locator('.sites-calendario-agenda-vacia').innerText(), /Sin reservas/);
        assert.equal(await page.locator('#calendario-grid .dia-calendario.seleccionado').getAttribute('data-fecha'), '2026-09-28');
        console.log('Calendario móvil Sites: 390/430/780 y desktop 781/1100/1200/1440/1600 px correctos.');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
