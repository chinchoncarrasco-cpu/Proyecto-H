// Eventos reales del paso Sites de servicios y notas, incluido el guard de escritura existente.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const source = read('js/haiku-libro-servicios-scope-v2.js').replace(
    'const api = Object.freeze({ version: "2.0.0", esConsultaServicios, rangoDesdeTexto, construir, revalidarVista, procesar, renderizarResultadoServicios });',
    'const api = Object.freeze({ version: "2.0.0", esConsultaServicios, rangoDesdeTexto, construir: async () => root.__resultadoActual, revalidarVista: async () => root.__resultadoActual, renderizar, procesar, renderizarResultadoServicios });'
).replace('async function procesar(texto) {', 'async function procesar(texto) { root.__reviewCalls.push(texto); return;');
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
            '<footer class="haiku-asistente-compositor">Acciones rápidas</footer></div></div></body></html>'
        );
        return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
        const content = fs.readFileSync(file);
        response.writeHead(200, { 'Content-Type': 'text/css' }).end(content);
    } catch { response.writeHead(404).end(); }
});

(async () => {
    assert.notEqual(source, read('js/haiku-libro-servicios-scope-v2.js'), 'el renderer real queda expuesto sólo en el test');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.addScriptTag({ content: source });
        await page.evaluate(() => {
            window.__closed = 0;
            window.__rpcCalls = 0;
            window.__confirmCalls = 0;
            window.__pendingRpc = null;
            window.__reviewCalls = [];
            window.confirm = () => { window.__confirmCalls++; return true; };
            document.getElementById('haiku-asistente-cerrar').addEventListener('click', () => window.__closed++);
            const asociacion = { estado: 'asociada', sistema: { reserva_id: 'r1', id: 'e1', cabana_id: 'c2',
                fecha_ingreso: '2026-09-12', fecha_salida: '2026-09-13' }, nota: 'Reserva y estadía verificadas.' };
            const base = { reserva: { cabana: 2, titular: 'Yervic Enrique' }, asociacion,
                servicio: { concepto: 'tonel', texto_original: '1 hora de tinaja caliente de madera a las 11:00' },
                mapa: { nombre: 'Tinaja Tonel de Madera' }, fecha: '2026-09-12', hora: '11:00', personas: 2,
                intencion_cobro: 'cobrable', semantica: 'SERVICIO_REAL', completitud: 'COMPLETO',
                inferencias: [], razones: [], payload: { reserva_id: 'r1', estadia_id: 'e1', fecha_servicio: '2026-09-12' } };
            const listo = { ...base, item_id: 'servicio-listo', kind: 'servicio', estado: 'listo' };
            const revisar = { ...base, item_id: 'servicio-revisar', kind: 'servicio', estado: 'revisar',
                completitud: 'FALTAN_DATOS', payload: null,
                razones: ['El horario está fuera de la estadía.', 'Falta el cobro para asociarlo automáticamente.'] };
            const nota = { ...base, item_id: 'nota-lista', kind: 'nota', estado: 'listo', texto: 'Dejar batas en recepción',
                payload: { reserva_id: 'r1', estadia_id: 'e1', importante: true }, servicio: null, mapa: null };
            const existente = { ...base, item_id: 'servicio-existente', kind: 'servicio', estado: 'existente',
                payload: null, servicio_existente: { id: 's1' } };
            window.__resultadoActual = { desde: '2026-09-01', hasta: '2026-09-30', items: [listo, revisar, nota, existente] };
            window.haikuSupabase = {
                from: () => {
                    const query = { select: () => query, eq: () => query,
                        then: (ok, fail) => Promise.resolve({ data: [{ id: 'e1', reserva_id: 'r1', estado_estadia: 'confirmada' }], error: null }).then(ok, fail) };
                    return query;
                },
                rpc: () => { window.__rpcCalls++; return new Promise((resolve, reject) => { window.__pendingRpc = { resolve, reject }; }); }
            };
            const mensajes = document.getElementById('haiku-asistente-mensajes');
            const consulta = document.createElement('div'); consulta.className = 'haiku-asistente-mensaje--usuario';
            consulta.textContent = 'incorpora servicios del Libro septiembre 2026';
            const card = document.createElement('div'); mensajes.append(consulta, card);
            window.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.renderizar(window.__resultadoActual, card, consulta.textContent);
        });
        await page.addScriptTag({ content: read('js/haiku-libro-confirm-cancel-fix-v1.js') });

        const card = page.locator('.haku-libro-servicios-sites');
        const final = card.locator('[data-haku-accion="incorporar"]');
        assert.equal(await card.count(), 1, 'Sites desde el primer render');
        assert.equal(await card.locator('.haku-libro-servicios__head').innerText().then(x => x.includes('Interpretación operativa')), true);
        assert.match(await card.locator('.haku-libro-servicios-sites__resultado').innerText(), /01–30 septiembre 2026/);
        const periodoSiguiente = await page.evaluate(() => {
            const muestra = document.createElement('div');
            document.getElementById('haiku-asistente-mensajes').append(muestra);
            window.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.renderizar(
                { ...window.__resultadoActual, desde: '2026-10-01', hasta: '2026-10-31' },
                muestra, 'Libro: compara servicios de octubre 2026 con Proyecto H');
            const texto = muestra.querySelector('.haku-libro-servicios-sites__resultado').textContent;
            muestra.remove();
            return texto;
        });
        assert.match(periodoSiguiente, /01–31 octubre 2026/);
        assert.deepEqual(await card.locator('.haku-libro-servicios__stat strong').allInnerTexts(), ['1', '1', '1']);
        assert.match(await card.locator('.haku-libro-servicios-sites__secundarios').innerText(), /1 ya existen.*4 hallazgos/s);
        const groups = card.locator('.haku-libro-servicios-sites__seccion');
        assert.equal(await groups.count(), 4);
        for (const row of await groups.all()) {
            await row.locator(':scope > summary').click();
            assert.equal(await row.getAttribute('open'), '');
            await row.locator(':scope > summary').click();
            assert.equal(await row.getAttribute('open'), null);
        }
        const rules = card.locator('.haku-libro-servicios-sites__reglas');
        await rules.locator('summary').click();
        assert.match(await rules.innerText(), /Full Day 09:30→21:30/);
        const review = card.locator('.haku-libro-servicios__seccion--revision');
        await review.locator('summary').click();
        assert.match(await review.innerText(), /Identifica el dato faltante/);
        assert.match(await review.innerText(), /El horario está fuera de la estadía/);
        assert.match(await review.innerText(), /Falta el cobro/);
        assert.equal(await review.locator('input[type=checkbox]').isDisabled(), true);
        assert.equal(await card.locator('.haku-libro-servicios__seccion--existentes input[type=checkbox]').isDisabled(), true);
        await card.locator('.haku-libro-servicios__seccion--servicios > summary').click();
        await card.locator('.haku-libro-servicios__seccion--notas > summary').click();

        const readyCheck = card.locator('.haku-libro-servicios__seccion--servicios input[type=checkbox]');
        const noteCheck = card.locator('.haku-libro-servicios__seccion--notas input[type=checkbox]');
        assert.equal(await final.isEnabled(), true);
        assert.match(await card.locator('.haku-libro-servicios-sites__seleccion').innerText(), /1 servicio · 1 nota/);
        await readyCheck.uncheck();
        assert.match(await card.locator('.haku-libro-servicios-sites__seleccion').innerText(), /0 servicios · 1 nota/);
        await noteCheck.uncheck();
        assert.equal(await final.isDisabled(), true);
        await readyCheck.check(); await noteCheck.check();
        assert.equal(await final.isEnabled(), true);

        await card.locator('.haku-libro-servicios-sites__cerrar').click();
        assert.equal(await page.evaluate(() => window.__closed), 1);
        assert.equal(await page.evaluate(() => window.__rpcCalls), 0);
        const style = await page.evaluate(() => ({
            area: getComputedStyle(document.getElementById('haiku-asistente-mensajes')).overflowY,
            card: getComputedStyle(document.querySelector('.haku-libro-servicios-sites')).overflowY,
            scrollbar: getComputedStyle(document.getElementById('haiku-asistente-mensajes')).scrollbarWidth
        }));
        assert.deepEqual(style, { area: 'auto', card: 'visible', scrollbar: 'none' });
        const scrollArea = page.locator('#haiku-asistente-mensajes');
        await scrollArea.evaluate(element => { element.scrollTop = 0; });
        const box = await card.boundingBox();
        await page.mouse.move(box.x + 45, Math.min(box.y + 240, 500));
        await page.mouse.wheel(0, 420);
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 0);
        const scrolled = await scrollArea.evaluate(element => element.scrollTop);
        await page.mouse.wheel(0, -420);
        await page.waitForFunction(previous => document.getElementById('haiku-asistente-mensajes').scrollTop < previous, scrolled);
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0);
        for (const width of [1000, 390]) {
            await page.setViewportSize({ width, height: 800 });
            const fit = await card.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
            assert.ok(fit.scroll <= fit.client + 1, `${width}: sin desborde horizontal (${fit.scroll}/${fit.client})`);
            assert.equal(await final.isVisible(), true);
        }
        if (process.env.HAKU_SERVICIOS_SCREENSHOT) {
            await page.setViewportSize({ width: 600, height: 900 });
            if (await review.getAttribute('open') === null) await review.locator('summary').click();
            await page.screenshot({ path: process.env.HAKU_SERVICIOS_SCREENSHOT, fullPage: true });
        }

        await final.click();
        await page.waitForFunction(() => window.__pendingRpc !== null);
        assert.match(await final.innerText(), /Revalidando/);
        await final.dispatchEvent('click');
        assert.equal(await page.evaluate(() => window.__rpcCalls), 1, 'doble clic no repite la incorporación');
        await page.evaluate(() => window.__pendingRpc.resolve({ data: null, error: { message: 'Error de prueba' } }));
        await page.waitForFunction(() => document.querySelector('.haku-libro-servicios__error-guard')?.textContent.includes('Error de prueba'));
        assert.equal(await final.isEnabled(), true, 'error real permite reintentar');
        await final.click();
        await page.waitForFunction(() => window.__rpcCalls === 2);
        await page.evaluate(() => window.__pendingRpc.resolve({ data: { ok: false }, error: null }));
        await page.waitForFunction(() => document.querySelector('.haku-libro-servicios__error-guard')?.textContent.includes('no confirmó'));
        assert.equal(await page.locator('.haku-libro-resultado-sites').count(), 0, 'sin ok del RPC no se anuncia éxito');
        await final.click();
        await page.waitForFunction(() => window.__rpcCalls === 3);
        await page.evaluate(() => window.__pendingRpc.resolve({ data: {
            ok: true, servicios_creados: 0, notas_creadas: 1, servicios_omitidos: 1, notas_omitidas: 0,
            servicios: [{ item_id: 'servicio-listo', estado: 'ya_importado' }],
            notas: [{ item_id: 'nota-lista', estado: 'creada' }]
        }, error: null }));
        await page.waitForFunction(() => document.querySelector('.haku-incorporacion-resultado--servicios'));
        const saved = page.locator('.haku-libro-resultado-sites');
        assert.equal(await saved.count(), 1, 'Sites aparece en el primer render posterior al RPC');
        assert.equal(await saved.locator('.haku-libro-resultado-sites__chip').innerText(), 'Guardado');
        assert.deepEqual(await saved.locator('.haku-libro-resultado-sites__metrica strong').allInnerTexts(), ['0', '1', '1']);
        assert.match(await saved.locator('.haku-libro-resultado-sites__mensaje').innerText(), /Proyecto H confirmó la incorporación.*Libro original no fue modificado/s);
        assert.doesNotMatch(await saved.innerText(), /Ejemplo del estado final|esta vista no guardó datos reales/);
        assert.equal(await saved.locator('[data-haku-accion="incorporar"]').count(), 0, 'el botón de escritura no sobrevive');
        if (process.env.HAKU_RESULTADO_SCREENSHOT) {
            await page.setViewportSize({ width: 600, height: 900 });
            await saved.scrollIntoViewIfNeeded();
            await page.screenshot({ path: process.env.HAKU_RESULTADO_SCREENSHOT });
        }
        const previousReview = saved.locator('.haku-libro-resultado-sites__detalle');
        await previousReview.locator('summary').click();
        assert.equal(await previousReview.getAttribute('open'), '');
        assert.match(await previousReview.innerText(), /Ya incorporado · omitido/);
        assert.match(await previousReview.innerText(), /Requiere revisión/);
        assert.match(await previousReview.innerText(), /Reserva y estadía verificadas/);
        await previousReview.locator('summary').click();
        assert.equal(await previousReview.getAttribute('open'), null);
        await saved.locator('.haku-libro-resultado-sites__cerrar').click();
        assert.equal(await page.evaluate(() => window.__closed), 2);
        assert.equal(await page.evaluate(() => window.__rpcCalls), 3, 'cerrar no vuelve a escribir');
        await saved.locator('.haku-libro-resultado-sites__revisar').click();
        assert.deepEqual(await page.evaluate(() => window.__reviewCalls), ['incorpora servicios del Libro septiembre 2026']);
        assert.equal(await page.evaluate(() => window.__rpcCalls), 3, 'revisar no reincorpora');
        await page.setViewportSize({ width: 390, height: 420 });
        await previousReview.locator('summary').click();
        const resultFit = await saved.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth, overflow: getComputedStyle(element).overflowY }));
        assert.ok(resultFit.scroll <= resultFit.client + 1, 'resultado móvil sin scroll horizontal');
        assert.equal(resultFit.overflow, 'visible');
        assert.equal(await saved.locator('.haku-libro-resultado-sites__revisar').isVisible(), true);
        assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('haiku-asistente-mensajes')).scrollbarWidth), 'none');
        const resultBox = await previousReview.boundingBox();
        await page.mouse.move(resultBox.x + 30, Math.min(resultBox.y + 30, 360));
        await page.mouse.wheel(0, 300);
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 0);
        await page.evaluate(() => { document.getElementById('haiku-asistente-mensajes').scrollTop = 0; });
        const touch = await page.context().newCDPSession(page);
        await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        for (const [type, y] of [['touchStart', 330], ['touchMove', 270], ['touchMove', 210], ['touchMove', 150], ['touchEnd', 150]]) {
            await touch.send('Input.dispatchTouchEvent', {
                type, touchPoints: type === 'touchEnd' ? [] : [{ x: 190, y, id: 1 }]
            });
        }
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 0);
        await touch.detach();
        assert.equal(await page.evaluate(() => window.__confirmCalls), 3);
        assert.deepEqual(errors, []);
        console.log('Servicios Sites: revisión, escritura confirmada, resultado real, detalle, revisar, cerrar, scroll y móvil OK');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
