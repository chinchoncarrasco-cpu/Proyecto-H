// Sólo loopback y fixtures en memoria; ninguna petición externa se permite.
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const { chromium } = require('playwright');
const { read, source, setup, consulta } = require('./fixtures/libro-servicio-manual.cjs');
const { hoja, fragmentos, delimitadores, textoReal } = require('./fixtures/libro-masaje-fragmentos.cjs');
const root = path.resolve(__dirname, '..'), errores = [], externos = [];
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        ['styles', 'supabase-asistente-v1', 'supabase-haku-reconciliacion-v1', 'sites-asistente-v1'].map(s => `<link rel="stylesheet" href="/css/${s}.css">`).join('') +
        '</head><body><div class="haiku-asistente-panel"><div id="prev" class="haiku-asistente-mensaje--usuario"></div><div id="out"></div></div></body></html>');
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try { res.writeHead(200, { 'Content-Type': 'text/css' }).end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); }
});
(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    let browser;
    try {
        browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
        for (const viewport of [{ width: 1100, height: 950 }, { width: 390, height: 844 }]) {
            for (const separador of delimitadores) {
                const page = await browser.newPage({ viewport }); page.on('pageerror', e => errores.push(e.message));
                await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : (externos.push(r.request().url()), r.abort()));
                await page.goto(`http://127.0.0.1:${server.address().port}`);
                for (const file of ['haiku-libro-semantica-v1', 'haiku-servicios-identidad-v1']) await page.addScriptTag({ content: read(`js/${file}.js`) });
                await page.evaluate(setup);
                await page.evaluate(data => {
                    const r = HAIKU_LIBRO_SEMANTICA.normalizarHoja(data, 'Oct26').reservas[0];
                    fixtureServicios.reservas[1] = r;
                    Object.assign(fixtureServicios.db.reserva_estadias[1], { fecha_ingreso: r.fecha_checkin, fecha_salida: r.fecha_checkout });
                }, hoja(fragmentos.join(separador)));
                await page.addScriptTag({ content: source });
                await page.addScriptTag({ content: read('js/haiku-libro-confirm-cancel-fix-v1.js') });
                await page.evaluate(async q => {
                    window.q = q; document.getElementById('prev').textContent = q;
                    HAIKU_LIBRO_SERVICIOS_SCOPE_V2.renderizar(await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.construir(q), document.getElementById('out'), q);
                }, consulta);
                const filaRocio = () => page.locator('.haku-libro-servicios__item').filter({ hasText: 'Rocío Leal' });
                assert.equal(await filaRocio().count(), 1); assert.equal(await filaRocio().locator('input[type=checkbox]').count(), 1);
                assert.match(await filaRocio().textContent(), /Masaje Descontracturante 60 min/);
                const abrir = async nombre => {
                    const row = page.locator('.haku-libro-servicios__item').filter({ hasText: nombre });
                    await row.locator('..').locator('..').evaluate(el => el.open = true);
                    await row.getByRole('button', { name: 'Aprobación manual', exact: true }).click();
                    await page.locator('.haku-libro-servicio-manual').waitFor();
                };
                const hora = async valor => {
                    const el = page.locator('[data-campo-manual="hora"]'); await el.fill(valor); await el.dispatchEvent('change');
                };
                const confirmar = async () => {
                    await page.getByRole('button', { name: 'Confirmar datos y revalidar' }).click();
                    await page.locator('.haku-libro-servicio-manual').waitFor({ state: 'detached' });
                };
                const listos = () => page.evaluate(async () => (await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.revalidarVista(document.getElementById('out'), q)).items.filter(x => x.kind === 'servicio' && x.estado === 'listo').length);
                await abrir('Rocío Leal');
                assert.equal(await page.locator('[data-campo-manual]').count(), 1);
                assert.equal(await page.locator('[data-campo-manual="hora"]').count(), 1);
                assert.match(await page.locator('.haku-libro-servicio-manual').innerText(), /2026-10-24/);
                await hora('17:00'); await confirmar(); assert.equal(await listos(), 1);
                assert.equal(await page.evaluate(() => HAIKU_LIBRO_SERVICIOS_SCOPE_V2.estadosPorVista.get(document.getElementById('out')).manuales.size), 1);
                const id = await filaRocio().locator('input').getAttribute('data-haku-item-id');
                await page.locator('.haku-libro-servicios__seccion--servicios').evaluate(el => el.open = true);
                await filaRocio().locator('input[type=checkbox]').uncheck();
                await abrir('1 HORA DE CORTESIA TINAJA');
                await page.locator('[data-campo-manual="codigo_servicio"]').selectOption('tinajaTonel'); await hora('18:00'); await confirmar();
                await abrir('X PAGAR LATE OUT'); await hora('12:20'); await confirmar(); assert.equal(await listos(), 3);
                assert.equal(await filaRocio().locator('input[type=checkbox]').isChecked(), false);
                await abrir('Rocío Leal'); await hora('18:00'); await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
                assert.equal(await listos(), 3); assert.equal(await filaRocio().locator('input').getAttribute('data-haku-item-id'), id);
                assert.equal(await filaRocio().locator('input[type=checkbox]').isChecked(), false);
                await page.locator('.haku-libro-servicios__seccion--servicios').evaluate(el => el.open = true);
                // Incorporar sólo Rocío demuestra un payload único desde la selección real.
                const checks = await page.locator('.haku-libro-servicios__item--listo input[type=checkbox]').all();
                for (const check of checks) await check.uncheck();
                await filaRocio().locator('input[type=checkbox]').check();
                await page.locator('[data-haku-accion="incorporar"]').click();
                await page.waitForFunction(() => fixtureServicios.escrituras.length === 1);
                const payload = await page.evaluate(() => fixtureServicios.escrituras[0].p_servicios);
                assert.equal(payload.length, 1); assert.equal(payload[0].item_id, id);
                assert.equal(payload[0].servicio_manual_v1.evidencia_original.texto, fragmentos.join(separador));
                await page.close();
                console.log(`PASS masaje agrupado: ${viewport.width}px, separador ${JSON.stringify(separador)}, sólo hora, A+B+C, deselección, payload único`);
            }
            const page = await browser.newPage({ viewport }); page.on('pageerror', e => errores.push(e.message));
            await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : (externos.push(r.request().url()), r.abort()));
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            for (const file of ['haiku-libro-semantica-v1', 'haiku-servicios-identidad-v1']) await page.addScriptTag({ content: read(`js/${file}.js`) });
            await page.evaluate(setup);
            await page.evaluate(data => {
                const r = HAIKU_LIBRO_SEMANTICA.normalizarHoja(data, 'Oct26').reservas[0];
                fixtureServicios.reservas[1] = r;
                Object.assign(fixtureServicios.db.reserva_estadias[1], { fecha_ingreso: r.fecha_checkin, fecha_salida: r.fecha_checkout });
            }, hoja(textoReal));
            await page.addScriptTag({ content: source });
            await page.addScriptTag({ content: read('js/haiku-libro-confirm-cancel-fix-v1.js') });
            await page.evaluate(async q => {
                window.q = q; document.getElementById('prev').textContent = q;
                const api = HAIKU_LIBRO_SERVICIOS_SCOPE_V2;
                api.renderizar(await api.construir(q), document.getElementById('out'), q);
            }, consulta);
            const masaje = page.locator('.haku-libro-servicios__item').filter({ hasText: 'Masaje Descontracturante 60 min' });
            const tinaja = page.locator('.haku-libro-servicios__item').filter({ hasText: 'TINAJA TONEL' });
            assert.equal(await masaje.count(), 1); assert.equal(await tinaja.count(), 1);
            assert.equal(await page.locator('.haku-libro-servicios__item--listo').count(), 1);
            assert.match(await masaje.getAttribute('class'), /haku-libro-servicios__item--listo/);
            await page.locator('.haku-libro-servicios__seccion--servicios').evaluate(el => el.open = true);
            assert.match(await masaje.innerText(), /2026-10-24/); assert.match(await masaje.innerText(), /11:00/);
            assert.doesNotMatch(await masaje.innerText(), /Falta horario|Falta fecha|Aprobación manual|19:15/);
            assert.equal(await masaje.getByRole('button', { name: 'Aprobación manual', exact: true }).count(), 0);
            assert.equal(await masaje.locator('input[type=checkbox]').count(), 1);
            assert.equal(await masaje.locator('input[type=checkbox]').isEnabled(), true);
            assert.equal(await masaje.locator('input[type=checkbox]').isChecked(), true);
            assert.equal(await page.locator('[data-campo-manual]').count(), 0);
            const antes = await page.evaluate(async () => {
                const api = HAIKU_LIBRO_SERVICIOS_SCOPE_V2, out = document.getElementById('out');
                const resultado = await api.revalidarVista(out, q);
                return { manuales: api.estadosPorVista.get(out).manuales.size,
                    rocio: resultado.items.filter(x => x.kind === 'servicio' && x.reserva.titular === 'Rocío Leal')
                        .map(x => ({ concepto: x.servicio.concepto, fecha: x.fecha, hora: x.hora, payload: x.payload })) };
            });
            assert.equal(antes.manuales, 0); assert.equal(antes.rocio.filter(x => x.payload).length, 1);
            assert.equal(antes.rocio.find(x => x.concepto === 'masaje').hora, '11:00');
            assert.equal(antes.rocio.find(x => x.concepto === 'tonel').hora, '19:15');
            assert.equal(antes.rocio.find(x => x.concepto === 'tonel').fecha, '2026-10-23');
            assert.equal(antes.rocio.find(x => x.concepto === 'masaje').payload.servicio_manual_v1, undefined);
            await tinaja.locator('..').locator('..').evaluate(el => el.open = true);
            await tinaja.getByRole('button', { name: 'Aprobación manual', exact: true }).click();
            await page.locator('.haku-libro-servicio-manual').waitFor();
            // La tinaja sólo pide su cobro pendiente; ninguno de los horarios se vuelve a solicitar.
            assert.equal(await page.locator('[data-campo-manual]').count(), 1);
            assert.equal(await page.locator('[data-campo-manual="tipo_cobro"]').count(), 1);
            assert.equal(await page.locator('[data-campo-manual="hora"]').count(), 0);
            assert.match(await page.locator('.haku-libro-servicio-manual').innerText(), /19:15/);
            await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
            await page.locator('.haku-libro-servicio-manual').waitFor({ state: 'detached' });
            await page.locator('.haku-libro-servicios__seccion--servicios').evaluate(el => el.open = true);
            assert.equal(await masaje.locator('input[type=checkbox]').isChecked(), true);
            await page.locator('[data-haku-accion="incorporar"]').click();
            await page.waitForFunction(() => fixtureServicios.escrituras.length === 1);
            const payload = await page.evaluate(() => fixtureServicios.escrituras[0].p_servicios);
            assert.equal(payload.length, 1); assert.equal(payload[0].codigo_servicio, 'masajeDescontracturante60');
            assert.equal(payload[0].fecha_servicio, '2026-10-24'); assert.equal(payload[0].hora, '11:00');
            assert.equal(payload[0].cantidad, 1); assert.equal(payload[0].servicio_manual_v1, undefined);
            await page.close();
            console.log(`PASS Rocío real: ${viewport.width}px, 11 AM automático, tinaja 19:15 independiente, sin aprobación, un checkbox y payload`);
        }
        assert.deepEqual(errores, []); assert.deepEqual(externos, []);
    } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
