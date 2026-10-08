// Navegador real, cliente en memoria y servidor loopback: se aborta toda red externa.
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const { chromium } = require('playwright');
const { read, source, setup, consulta } = require('./fixtures/libro-servicio-manual.cjs');
const root = path.resolve(__dirname, '..'), errors = [], externos = [];
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        ['styles', 'supabase-asistente-v1', 'supabase-haku-reconciliacion-v1', 'sites-asistente-v1'].map(s => `<link rel="stylesheet" href="/css/${s}.css">`).join('') +
        '</head><body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel"><header class="haiku-asistente-cabecera">Haku</header><div class="haiku-asistente-mensajes" id="mensajes"><div id="prev" class="haiku-asistente-mensaje--usuario"></div><div id="out"></div></div></div></div></body></html>');
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
            const page = await browser.newPage({ viewport }); page.on('pageerror', e => errors.push(e.message));
            await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : (externos.push(r.request().url()), r.abort()));
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            for (const file of ['haiku-libro-semantica-v1', 'haiku-servicios-identidad-v1']) await page.addScriptTag({ content: read(`js/${file}.js`) });
            await page.evaluate(setup);
            await page.addScriptTag({ content: source });
            await page.addScriptTag({ content: read('js/haiku-libro-confirm-cancel-fix-v1.js') });
            await page.evaluate(async q => { document.getElementById('prev').textContent = q; window.q = q; const api = HAIKU_LIBRO_SERVICIOS_SCOPE_V2; api.renderizar(await api.construir(q), document.getElementById('out'), q); }, consulta);
            const ready = () => page.evaluate(async () => (await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.revalidarVista(document.getElementById('out'), q)).items.filter(x => x.kind === 'servicio' && x.estado === 'listo').length);
            const abrir = async texto => {
                const row = page.locator('.haku-libro-servicios__item').filter({ hasText: texto });
                await row.locator('..').locator('..').evaluate(el => el.open = true);
                await row.getByRole('button', { name: 'Aprobación manual', exact: true }).click();
                await page.locator('.haku-libro-servicio-manual').waitFor();
            };
            const hora = async valor => { const el = page.locator('[data-campo-manual="hora"]'); await el.fill(valor); await el.dispatchEvent('change'); };
            const confirmar = async () => { await page.getByRole('button', { name: 'Confirmar datos y revalidar' }).click(); await page.locator('.haku-libro-servicio-manual').waitFor({ state: 'detached' }); };
            await abrir('1 HORA DE CORTESIA TINAJA');
            assert.equal(await page.locator('[data-campo-manual="tipo_cobro"]').count(), 0);
            await page.locator('[data-campo-manual="codigo_servicio"]').selectOption('tinajaTonel'); await hora('18:00');
            assert.equal(await page.locator('[data-campo-manual="fecha"]').count(), 0);
            assert.equal(await page.locator('[data-campo-manual="personas"]').count(), 0);
            await confirmar(); assert.equal(await ready(), 1);
            await page.getByText('Servicios preparables para incorporar', { exact: true }).click();
            const checkA = page.locator('.haku-libro-servicios__item--listo input[type=checkbox]'); await checkA.uncheck();
            await abrir('X PAGAR LATE OUT'); await hora('12:20');
            assert.match(await page.locator('.haku-libro-servicio-manual').innerText(), /término 13:20/);
            assert.equal(await page.locator('[data-campo-manual="precio_decision"]').count(), 0);
            await confirmar(); assert.equal(await ready(), 2);
            assert.equal(await page.locator('.haku-libro-servicios__item--listo').filter({ hasText: '1 HORA DE CORTESIA TINAJA' }).locator('input').isChecked(), false);
            await abrir('1 MASAJE DE 1 HORA');
            assert.equal(await page.locator('[data-campo-manual="duracion_minutos"]').count(), 0);
            assert.equal(await page.locator('[data-campo-manual="cantidad"]').count(), 0);
            await page.locator('[data-campo-manual="codigo_servicio"]').selectOption('masajeTerapeutico60'); await hora('17:00'); await confirmar(); assert.equal(await ready(), 3);
            await abrir('X PAGAR LATE OUT'); await hora('12:45'); await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
            assert.equal(await ready(), 3);
            assert.equal(await page.evaluate(() => fixtureServicios.escrituras.length), 0);
            await page.locator('.haku-libro-servicios__seccion--servicios').evaluate(el => el.open = true);
            const cajas = await page.locator('.haku-libro-servicios__item--listo input').all(); for (const caja of cajas) await caja.check();
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); assert.equal(overflow, false);
            await page.locator('[data-haku-accion="incorporar"]').click();
            await page.waitForFunction(() => fixtureServicios.escrituras.length === 1);
            assert.equal(await page.evaluate(() => new Set(fixtureServicios.escrituras[0].p_servicios.map(x => x.item_id)).size), 3);
            // Javiera: el horario del existente sólo completa evidencia ausente.
            const mostrarLate = async (horaLibro = '', sinExistente = false) => {
                await page.evaluate(setup);
                return page.evaluate(async ({ horaLibro, sinExistente }) => {
                    const f = fixtureServicios, r = f.reservas[0], estadia = f.db.reserva_estadias[0];
                    const texto = `X PAGAR LATE OUT CLP$10,000 1 HORA${horaLibro ? ' ' + horaLibro : ''}`;
                    Object.assign(r, { fecha_checkin: '2026-10-03', fecha_checkout: '2026-10-04', texto_original: texto,
                        servicios: HAIKU_LIBRO_SEMANTICA.servicios(texto, { origen_campo: 'notas_reserva' }) });
                    f.reservas.splice(1);
                    Object.assign(estadia, { fecha_ingreso: r.fecha_checkin, fecha_salida: r.fecha_checkout });
                    if (!sinExistente) f.db.servicios.push({ id: 'late-javiera', reserva_id: estadia.reserva_id, estadia_id: estadia.id,
                        fecha_servicio: '2026-10-04', hora_inicio: '13:00:00', hora_fin: '14:00:00', cantidad: 1,
                        tipo_cobro: 'normal', total: 10000, estado_servicio: 'programado', personas: 0,
                        catalogo_servicios: { codigo: 'lateCheckout', nombre: 'Late Check-out' } });
                    const antes = JSON.stringify(f.db.servicios), out = document.createElement('div'); out.id = 'out';
                    document.getElementById('out').replaceWith(out);
                    const api = HAIKU_LIBRO_SERVICIOS_SCOPE_V2, resultado = await api.construir(q);
                    api.renderizar(resultado, out, q);
                    const item = resultado.items.find(i => i.mapa?.codigo === 'lateCheckout');
                    return { estado: item.estado, identidad: item.identidad, payload: item.payload, hora: item.hora, hora_fin: item.hora_fin, antes };
                }, { horaLibro, sinExistente });
            };
            for (const horaLibro of ['', '13:00']) {
                const resultado = await mostrarLate(horaLibro);
                assert.equal(resultado.estado, 'existente'); assert.equal(resultado.identidad, 'YA_EXISTE'); assert.equal(resultado.payload, null);
                assert.equal(resultado.hora, '13:00'); assert.equal(resultado.hora_fin, '14:00');
                const row = page.locator('.haku-libro-servicios__item--existente');
                await row.locator('..').locator('..').evaluate(el => el.open = true);
                assert.match(await row.innerText(), /Javiera Barrera/);
                assert.match(await row.innerText(), /13:00/);
                assert.match(await row.locator('..').locator('..').innerText(), /Ya existen en Proyecto H/);
                assert.equal(await page.getByRole('button', { name: 'Aprobación manual', exact: true }).count(), 0);
                assert.equal(await page.locator('[data-campo-manual="hora"]').count(), 0);
                assert.equal(await page.locator('.haku-libro-servicios__item--revisar').count(), 0);
                assert.equal(await page.evaluate(() => fixtureServicios.escrituras.length), 0);
                assert.equal(await page.evaluate(() => JSON.stringify(fixtureServicios.db.servicios)), resultado.antes);
            }
            const contradictorio = await mostrarLate('12:00');
            assert.equal(contradictorio.estado, 'revisar'); assert.equal(contradictorio.payload, null);
            const revision = page.locator('.haku-libro-servicios__item--revisar');
            await revision.locator('..').locator('..').evaluate(el => el.open = true);
            assert.match(await revision.innerText(), /contradice.*horario/);
            assert.equal(await page.evaluate(() => JSON.stringify(fixtureServicios.db.servicios)), contradictorio.antes);
            const nuevo = await mostrarLate('', true);
            assert.equal(nuevo.estado, 'revisar'); assert.equal(nuevo.identidad, 'NO_EXISTE'); assert.equal(nuevo.payload, null);
            await abrir('X PAGAR LATE OUT');
            assert.equal(await page.locator('[data-campo-manual="hora"]').inputValue(), '');
            assert.equal(await page.evaluate(() => fixtureServicios.escrituras.length), 0);
            await page.close(); console.log(`PASS servicios manual: ${viewport.width}px, A+B+C, cancelación, selección, payload único, Late existente y ausencia/contradicción`);
        }
        assert.deepEqual(errors, []); assert.deepEqual(externos, []);
    } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
