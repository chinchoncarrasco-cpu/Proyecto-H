// Contrato de eventos del paso Sites de incorporación sobre el renderer real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const source = read('js/haiku-libro-consultas-v1.js').replace(
    'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })',
    'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion, renderizarIncorporacion })'
);
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
        response.writeHead(200, { 'Content-Type': pathname.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(content);
    } catch { response.writeHead(404).end(); }
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: edge, headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.addScriptTag({ content: read('js/haiku-libro-semantica-v1.js') });
        await page.addScriptTag({ content: source });
        await page.addScriptTag({ content: read('js/haiku-libro-confirmacion-estado-v1.js') });
        await page.evaluate(() => {
            window.__closed = 0;
            window.__back = 0;
            window.__approved = [];
            window.__approveFail = false;
            window.__writes = 0;
            window.__pendingWrite = null;
            window.haikuTienePermiso = () => true;
            window.confirm = () => true;
            document.getElementById('haiku-asistente-cerrar').addEventListener('click', () => window.__closed++);
            const item = (categoria, id, extra = {}) => ({ categoria, id, texto: `CAB 2 · Persona ${id} · 12/09/26`,
                payload: {}, motivos: [], dependeDe: [], seleccionado: ['nuevas', 'actualizaciones', 'estadias', 'pagos'].includes(categoria), ...extra });
            const plan = { escrituraHabilitada: true, permisos: [], items: [
                item('nuevas', 'nueva', { payload: { reserva: { titular_nombre: 'Persona nueva', observaciones: 'Nota real' }, estadias: [] } }),
                item('actualizaciones', 'cambio', { payload: { reserva: { titular_nombre: 'Persona actual' } } }),
                item('estadias', 'estadia', { payload: { estadias: [{ cabana_numero: 2, noches: 1,
                    datos: { fecha_ingreso: '2026-09-12', fecha_salida: '2026-09-13', tipo_estadia: 'alojamiento', adultos: 2, ninos: 0, mascotas: 0 } }] } }),
                item('pagos', 'pago', { pagoLibro: { monto: 16000, medio_pago: 'transferencia', fecha_comprobante: '2026-09-12', texto_original: 'Transferencia de prueba' } }),
                item('dudosos', 'dudoso', { seleccionado: false, motivos: ['Requiere aprobación manual de esta parte del comprobante y su asociación.'],
                    aprobable: true, pagoLibro: { monto: 9000, medio_pago: 'efectivo', fecha_comprobante: '2026-09-12' } }),
                item('pendientes', 'pendiente', { seleccionado: false, motivos: ['No se incorporará mientras siga pendiente.'] }),
                item('asociadas', 'asociada', { seleccionado: false, movimientosLibro: [] }),
                item('omitidos', 'omitido', { seleccionado: false })
            ] };
            window.__plan = plan;
            window.__render = nextPlan => {
                const out = document.createElement('div');
                document.getElementById('haiku-asistente-mensajes').replaceChildren(out);
                window.HAIKU_LIBRO_CONSULTAS.renderizarIncorporacion(out, nextPlan,
                    () => { window.__back++; },
                    ids => {
                        window.__approved.push(ids);
                        if (window.__approveFail) throw new Error('Aprobación de prueba rechazada');
                    },
                    () => {
                        window.__writes++;
                        return new Promise((resolve, reject) => { window.__pendingWrite = { resolve, reject }; });
                    });
            };
            window.__render(plan);
        });

        const card = page.locator('.haku-incorporacion-sites');
        const final = card.locator('.haku-incorporacion-sites-pie .libro-reserva-boton:not(.secundario)');
        assert.equal(await card.count(), 1);
        assert.equal(await card.locator(':scope > .haiku-incorporacion-seccion').count(), 0, 'no hay estructura legacy en el primer render');
        assert.equal(await card.locator('.haku-incorporacion-sites-grupo').count(), 3);
        assert.equal(await card.locator('.haku-incorporacion-sites-fila').count(), 9);
        for (const [grupo, categorias] of [
            ['listos', ['nuevas', 'actualizaciones', 'estadias', 'pagos']],
            ['decision', ['dudosos', 'pendientes']],
            ['trazabilidad', ['asociadas', 'omitidos']]
        ]) {
            const actual = await card.locator(`.haku-incorporacion-sites-grupo--${grupo} > .haiku-incorporacion-seccion`)
                .evaluateAll(rows => rows.map(row => [...row.classList].find(name => name.startsWith('haiku-incorporacion-seccion--')).slice('haiku-incorporacion-seccion--'.length)));
            assert.deepEqual(actual, categorias, `${grupo}: categorías Sites en orden`);
        }
        assert.match(await card.locator('.haku-incorporacion-sites-preparacion').innerText(), /El Libro de Reservas tiene prioridad/);
        assert.equal(await card.locator('.haku-incorporacion-sites-modo').innerText(), 'Escritura habilitada');
        for (const categoria of ['nuevas', 'actualizaciones', 'estadias', 'pagos', 'dudosos', 'pendientes', 'asociadas', 'omitidos']) {
            const row = card.locator(`.haiku-incorporacion-seccion--${categoria}`);
            assert.equal(await row.count(), 1, `fila ${categoria}`);
            await row.locator(':scope > summary').click();
            assert.equal(await row.getAttribute('open'), '', `${categoria} abre`);
            assert.equal(await row.locator('.haiku-incorporacion-item').count(), 1, `${categoria} conserva su detalle`);
            if (categoria !== 'dudosos') { await row.locator(':scope > summary').click(); assert.equal(await row.getAttribute('open'), null); }
        }
        const info = card.locator('.haiku-incorporacion-ayuda');
        await info.locator('summary').click();
        assert.match(await info.innerText(), /Permiso|Los pagos se revisan/);
        assert.equal(await final.isEnabled(), true, 'selección inicial habilita la acción real');
        for (const categoria of ['nuevas', 'actualizaciones', 'estadias', 'pagos']) {
            await card.locator(`.haiku-incorporacion-seccion--${categoria} > summary`).click();
        }
        const notas = card.locator('.haiku-incorporacion-seccion--nuevas .haiku-incorporacion-notas');
        await notas.locator('summary').click();
        assert.match(await notas.innerText(), /Nota real/, 'detalle interno conserva la información');
        const scrollArea = page.locator('#haiku-asistente-mensajes');
        const scrollStyle = await page.evaluate(() => ({
            area: getComputedStyle(document.getElementById('haiku-asistente-mensajes')).overflowY,
            card: getComputedStyle(document.querySelector('.haku-incorporacion-sites')).overflowY,
            scrollbar: getComputedStyle(document.getElementById('haiku-asistente-mensajes')).scrollbarWidth
        }));
        assert.deepEqual(scrollStyle, { area: 'auto', card: 'visible', scrollbar: 'none' }, 'una sola superficie de scroll sin barra');
        await scrollArea.evaluate(element => { element.scrollTop = 0; });
        const box = await card.boundingBox();
        await page.mouse.move(box.x + 60, Math.min(box.y + 260, 500));
        await page.mouse.wheel(0, 530);
        await page.waitForFunction(() => document.getElementById('haiku-asistente-mensajes').scrollTop > 0);
        const scrolled = await scrollArea.evaluate(element => element.scrollTop);
        await page.mouse.wheel(0, -530);
        await page.waitForFunction(previous => document.getElementById('haiku-asistente-mensajes').scrollTop < previous, scrolled);
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0, 'la página de fondo no se desplaza');
        const checks = card.locator('.haku-incorporacion-sites-grupo--listos input[type=checkbox]');
        assert.equal(await checks.count(), 4);
        for (const checkbox of await checks.all()) await checkbox.uncheck();
        assert.equal(await final.isDisabled(), true, 'sin seleccionados no se incorpora');
        assert.match(await card.locator('.haku-incorporacion-sites-cifra--listos').innerText(), /^4\s/, 'los listos siguen disponibles aunque no estén seleccionados');
        await card.getByRole('button', { name: 'Seleccionar todo lo listo' }).click();
        assert.equal(await final.isEnabled(), true);
        assert.equal(await page.evaluate(() => window.__plan.items.filter(item => item.seleccionado).length), 4);

        const review = card.locator('.haiku-incorporacion-seccion--dudosos');
        await review.getByRole('button', { name: 'Aprobar este pago' }).click();
        await review.getByRole('button', { name: 'Aprobar 1 pago revisable' }).click();
        assert.deepEqual(await page.evaluate(() => window.__approved), ['dudoso', ['dudoso']], 'ambos controles usan aprobar');
        await page.evaluate(() => { window.__approveFail = true; });
        await review.getByRole('button', { name: 'Aprobar este pago' }).click();
        await page.waitForFunction(() => document.querySelector('.haiku-incorporacion-error')?.textContent.includes('Aprobación de prueba rechazada'));
        await page.evaluate(() => { window.__approveFail = false; });

        await card.locator('.haku-incorporacion-sites-cerrar').click();
        assert.equal(await page.evaluate(() => window.__closed), 1, 'X reutiliza el cierre de Haku');
        await card.locator('.haku-incorporacion-sites-pie .secundario').click();
        assert.equal(await page.evaluate(() => window.__back), 1, 'Volver usa callback y no escribe');
        assert.equal(await page.evaluate(() => window.__writes), 0);

        if (process.env.HAKU_INCORPORACION_SCREENSHOT) {
            await page.evaluate(() => { document.getElementById('haiku-asistente-mensajes').scrollTop = 0; });
            await page.screenshot({ path: process.env.HAKU_INCORPORACION_SCREENSHOT, fullPage: true });
        }
        if (process.env.HAKU_INCORPORACION_SCREENSHOT_BOTTOM) {
            await page.evaluate(() => {
                const mensajes = document.getElementById('haiku-asistente-mensajes');
                mensajes.scrollTop = mensajes.scrollHeight;
            });
            await page.screenshot({ path: process.env.HAKU_INCORPORACION_SCREENSHOT_BOTTOM, fullPage: true });
        }
        await final.click();
        await page.waitForFunction(() => window.__pendingWrite !== null);
        assert.equal(await final.isDisabled(), true, 'confirmación en curso bloquea segundo clic');
        await page.waitForFunction(() => document.querySelector('.haku-incorporacion-sites > .haiku-confirmacion-estado-v1--proceso'));
        await final.dispatchEvent('click');
        assert.equal(await page.evaluate(() => window.__writes), 1, 'doble clic llama una vez a incorporar');
        await page.evaluate(() => window.__pendingWrite.reject(new Error('Conflicto de prueba')));
        await page.waitForFunction(() => document.querySelector('.haku-incorporacion-sites')?.textContent.includes('Conflicto de prueba'));
        await page.waitForFunction(() => document.querySelector('.haku-incorporacion-sites > .haiku-confirmacion-estado-v1--error')?.textContent.includes('Conflicto de prueba'));
        assert.equal(await final.isEnabled(), true, 'error real visible y reintento disponible');
        await final.click();
        await page.waitForFunction(() => window.__writes === 2);
        await page.evaluate(() => window.__pendingWrite.resolve({ resultado: { reservas_creadas: 1, estadias_agregadas: 1, pagos_creados: 1, actualizaciones: 1, omitidos: 0 } }));
        await page.waitForFunction(() => document.querySelector('.haku-incorporacion-resultado'));
        assert.equal(await page.evaluate(() => window.__writes), 2, 'cada intento ejecuta exactamente una operación');

        await page.evaluate(() => {
            const bloqueado = { ...window.__plan, escrituraHabilitada: false,
                items: window.__plan.items.map(item => ({ ...item, seleccionado: true })) };
            window.__render(bloqueado);
        });
        assert.equal(await card.locator('.haku-incorporacion-sites-modo').innerText(), 'Escritura bloqueada');
        assert.equal(await final.isDisabled(), true, 'autoridad de escritura bloquea el botón');
        assert.equal(await card.locator('.haku-incorporacion-sites-grupo--listos input[type=checkbox]').first().isDisabled(), true);
        for (const width of [1000, 390]) {
            await page.setViewportSize({ width, height: 800 });
            const fit = await card.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
            assert.ok(fit.scroll <= fit.client + 1, `${width}: sin desborde horizontal`);
            assert.equal(await card.locator('.haku-incorporacion-sites-pie').isVisible(), true);
        }
        await page.evaluate(() => {
            const distribucion = { id: 'comprobante', ids: ['parte-1', 'parte-2'], total: 588000, tipo: 'grupo_alojamiento' };
            const items = distribucion.ids.map(id => ({ id, categoria: 'dudosos', texto: `CAB 2 · ${id} · $294.000`,
                payload: {}, pagoLibro: { monto: 294000, medio_pago: 'transferencia' },
                motivos: ['Requiere aprobación manual.'], dependeDe: [], seleccionado: false,
                aprobable: true, distribucionManual: distribucion }));
            window.__render({ escrituraHabilitada: true, permisos: [], items });
        });
        const groupReview = card.locator('.haiku-incorporacion-seccion--dudosos');
        await groupReview.locator(':scope > summary').click();
        await groupReview.getByRole('button', { name: /Aprobar comprobante completo/ }).click();
        assert.deepEqual(await page.evaluate(() => window.__approved.at(-1)), ['parte-1', 'parte-2'], 'el comprobante completo conserva su aprobación conjunta');
        assert.deepEqual(errors, []);
        console.log('Incorporación Sites: grupos, acordeones, selección, aprobación, X, Volver, confirmación única, error, bloqueo y móvil OK');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
