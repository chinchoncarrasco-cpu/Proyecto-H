// Comprueba la vista Sites con los módulos reales de informe, prioridad y aviso automático.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
            '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/supabase-asistente-v1.css">' +
            '<link rel="stylesheet" href="/css/supabase-haku-reconciliacion-v1.css"><link rel="stylesheet" href="/css/sites-asistente-v1.css">' +
            '</head><body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel">' +
            '<header class="haiku-asistente-cabecera"><span>Haku</span><button id="haiku-asistente-cerrar" type="button">Cerrar</button></header>' +
            '<div id="haiku-asistente-mensajes" class="haiku-asistente-mensajes"></div>' +
            '<footer class="haiku-asistente-compositor">Acciones rápidas <input id="haiku-asistente-texto"><button id="haiku-asistente-enviar">Enviar</button></footer>' +
            '</div></div></body></html>'
        );
        return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try { const content = fs.readFileSync(file); response.writeHead(200, { 'Content-Type': 'text/css' }).end(content); }
    catch { response.writeHead(404).end(); }
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 600, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(() => {
            window.__generation = 1;
            window.__closed = 0;
            window.__opened = 0;
            window.__revalidations = 0;
            window.__preparations = 0;
            window.__registration = { version: 1, cambios: [] };
            window.__pending = null;
            window.__revalidationMode = 'ready';
            window.__sawLegacy = false;
            document.getElementById('haiku-asistente-cerrar').addEventListener('click', () => window.__closed++);
            new MutationObserver(() => {
                window.__sawLegacy ||= Boolean(document.querySelector('.haku-actualizacion-compacta'));
            }).observe(document.getElementById('haiku-asistente-mensajes'), { childList: true, subtree: true });
            window.HAIKU_ASISTENTE = { abrir: () => window.__opened++ };
            window.HAIKU_LIBRO_RESERVA_V1 = {
                estado: () => ({ generacion: window.__generation }),
                leerCambiosDetectados: async () => window.__registration,
                guardarCambiosDetectados: async value => { window.__registration = value; }
            };
            window.HAIKU_LIBRO_DIFERENCIAS_V1 = { compararUltimasVersiones: async () => window.__resultadoActual };
            window.HAIKU_LIBRO_CONSULTAS = {
                revalidarCambiosDetectados: async () => {
                    window.__revalidations++;
                    if (window.__revalidationMode === 'pending') return new Promise((resolve, reject) => { window.__pending = { resolve, reject }; });
                    if (window.__revalidationMode === 'error') throw new Error('Fallo focal de prueba');
                    return structuredClone(window.__pendientesActual);
                },
                abrirPreparacionComparacion: async element => { window.__preparations++; element.textContent = 'Preparación canónica abierta'; }
            };
            const empty = { estado: 'sin_cambios', nuevas: [], modificadas: [], ya_no_aparecen: [], ambiguas: [],
                cancelaciones_confirmadas: [], advertencias: [], no_comparables: [], libro_actual: { generacion: 1 } };
            window.__resultadoActual = empty;
            window.__pendientesActual = { items: [], resueltos: [], reservas: [], comparacion: [], q: null };
        });
        for (const file of [
            'js/supabase-asistente-libro-prioridad-v1.js',
            'js/supabase-asistente-libro-actualizacion-v1.js',
            'js/supabase-asistente-libro-auto-v1.js'
        ]) await page.addScriptTag({ content: read(file) });

        await page.evaluate(() => window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada', {
            detail: { carga_manual: true, tenia_anterior: true, generacion: 1 }
        })));
        const announcement = page.locator('#haiku-asistente-mensajes .haiku-asistente-mensaje').filter({ hasText: 'Ver informe' }).last();
        await announcement.locator('button').click();
        const first = page.locator('.haku-actualizacion-sites').last();
        assert.equal(await first.count(), 1);
        assert.equal(await page.evaluate(() => window.__opened), 1);
        assert.match(await first.locator('.haku-actualizacion-sites__mensaje').innerText(), /Libro actualizado.*No detecté cambios operacionales/);
        assert.deepEqual(await first.locator('.haku-actualizacion-sites__metricas strong').allInnerTexts(), ['0', '0', '0', '0']);
        assert.deepEqual(await first.locator('.haku-prioridad-fila > .haku-actualizacion-sites__fila-vacia strong').allInnerTexts(), ['0', '0', '0', '0']);
        assert.equal(await first.locator('.haku-actualizacion-sites__sin-cambios').count(), 1);
        await page.waitForFunction(() => document.querySelector('.haku-actualizacion-sites__historial')?.textContent.includes('Todos los cambios detectados ya están sincronizados'));
        assert.equal(await announcement.count(), 0, 'el aviso previo se integra en el informe abierto');
        assert.equal(await page.locator('.haku-actualizacion-sites').count(), 1);

        await page.evaluate(() => {
            const base = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
            const date = delta => {
                const value = new Date(`${base}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + delta);
                return value.toISOString().slice(0, 10);
            };
            const row = (id, day, titular) => ({ id, cabana: 2, titular, fecha_checkin: date(day), fecha_checkout: date(day + 1), noches: 1 });
            const nueva = row('new', 0, 'Yervic Enrique');
            const antes = row('changed-old', 1, 'Camila Ortega');
            const ahora = { ...antes, id: 'changed-new', adultos: 3 };
            const ausente = row('gone', 2, 'Martín López');
            const candidato = row('candidate', 10, 'Titular pendiente');
            window.__resultadoActual = {
                estado: 'ok', nuevas: [{ actual: nueva }], modificadas: [{ anterior: antes, actual: ahora, cambios: [{ campo: 'adultos', antes: 2, ahora: 3 }] }],
                ya_no_aparecen: [{ anterior: ausente }], ambiguas: [{ motivo: 'Asociación no determinada.', anteriores: [], actuales: [candidato] }],
                cancelaciones_confirmadas: [], advertencias: [], no_comparables: [], libro_actual: { generacion: 2 }
            };
            window.__pendientesActual = {
                items: [{ tipo: 'modificacion', actual: ahora, detectado_generacion: 2, estado: 'pendiente', accionable: true,
                    cambios: [{ campo: 'adultos', antes: 2, ahora: 3, proyecto: 2 }] }],
                resueltos: [], reservas: [ahora], comparacion: [], q: { texto: 'informe' }
            };
            window.__generation = 2;
            window.dispatchEvent(new Event('haiku:libro-cambio'));
            window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada', {
                detail: { carga_manual: true, tenia_anterior: true, generacion: 2 }
            }));
        });
        const secondAnnouncement = page.locator('#haiku-asistente-mensajes .haiku-asistente-mensaje').filter({ hasText: 'Ver informe' }).last();
        await secondAnnouncement.locator('button').click();
        const report = page.locator('.haku-actualizacion-sites').last();
        assert.deepEqual(await report.locator('.haku-actualizacion-sites__metricas strong').allInnerTexts(), ['1', '1', '1', '1']);
        assert.deepEqual(await report.locator('.haku-prioridad-fila > summary strong').allInnerTexts(), ['1', '1', '1', '1']);
        assert.equal(await report.locator('.haku-actualizacion-sites__sin-cambios').count(), 0);
        if (process.env.HAKU_ACTUALIZACION_SCREENSHOT) {
            await report.evaluate(element => element.scrollIntoView({ block: 'start' }));
            await page.screenshot({ path: process.env.HAKU_ACTUALIZACION_SCREENSHOT });
        }
        for (const category of await report.locator('details.haku-prioridad-fila').all()) {
            await category.locator('summary').click();
            assert.equal(await category.getAttribute('open'), '');
            assert.match(await category.innerText(), /CAB 2/);
            await category.locator('summary').click();
            assert.equal(await category.getAttribute('open'), null);
        }
        const modified = report.locator('.haku-actualizacion-sites__grupo--modificadas');
        await modified.locator(':scope > summary').click();
        await modified.locator('.haku-pregunta-caso > summary').click();
        assert.match(await modified.innerText(), /2 → 3/);
        await page.waitForFunction(() => document.querySelectorAll('.haku-actualizacion-sites__historial').length === 2);
        const history = report.locator('.haku-actualizacion-sites__historial');
        assert.match(await history.innerText(), /Cambios detectados aún pendientes de aplicar/);
        await history.locator('.haku-actualizacion-sites__pendiente > summary').click();
        assert.match(await history.innerText(), /Proyecto H actual: 2/);
        assert.equal(await history.locator('[data-haku-preparar-pendientes]').count(), 1);
        await history.locator('[data-haku-preparar-pendientes]').click();
        await page.waitForFunction(() => window.__preparations === 1);

        const before = await page.evaluate(() => window.__revalidations);
        await page.evaluate(() => { window.__revalidationMode = 'pending'; });
        const refresh = await history.locator('[data-haku-revalidar-proyecto]').elementHandle();
        await refresh.click();
        await page.waitForFunction(count => window.__revalidations === count + 1, before);
        assert.deepEqual(await refresh.evaluate(element => [element.disabled, element.textContent, element.getAttribute('aria-busy')]),
            [true, 'Revalidando…', 'true']);
        await refresh.evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(await page.evaluate(() => window.__revalidations), before + 1, 'doble clic no duplica revalidación');
        await page.evaluate(() => window.__pending.reject(new Error('Fallo focal de prueba')));
        await page.waitForFunction(() => document.querySelector('.haku-libro-pendientes-error')?.textContent.includes('Fallo focal de prueba'));
        await page.evaluate(() => { window.__revalidationMode = 'ready'; });
        await report.locator('.haku-libro-pendientes-zona > button').click();
        await report.locator('.haku-actualizacion-sites__historial').waitFor();
        assert.equal(await page.evaluate(() => window.__sawLegacy), false);
        assert.doesNotMatch(await report.innerText(), /Vista de ejemplo basada en captura|datos de muestra|prototipo|demostración/);
        await report.locator('[data-haku-cerrar-actualizacion]').click();
        assert.equal(await page.evaluate(() => window.__closed), 1);
        await page.setViewportSize({ width: 390, height: 420 });
        const fit = await report.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth, overflow: getComputedStyle(element).overflowY }));
        assert.ok(fit.scroll <= fit.client + 1, `móvil sin scroll horizontal: ${fit.scroll}/${fit.client}`);
        assert.equal(fit.overflow, 'visible');
        assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('haiku-asistente-mensajes')).scrollbarWidth), 'none');
        const area = page.locator('#haiku-asistente-mensajes');
        await area.evaluate(element => { element.scrollTop = 0; });
        const box = await report.boundingBox();
        await page.mouse.move(box.x + 30, Math.min(box.y + 180, 320));
        await page.mouse.wheel(0, 300);
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 0);
        await area.evaluate(element => { element.scrollTop = 0; });
        const touch = await page.context().newCDPSession(page);
        await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        for (const [type, y] of [['touchStart', 330], ['touchMove', 270], ['touchMove', 210], ['touchMove', 150], ['touchEnd', 150]]) {
            await touch.send('Input.dispatchTouchEvent', {
                type, touchPoints: type === 'touchEnd' ? [] : [{ x: 190, y, id: 1 }]
            });
        }
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 0);
        await touch.detach();
        assert.deepEqual(errors, []);
        console.log('Actualización Sites: informe real, categorías, historial, controles, error, scroll y móvil OK');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
