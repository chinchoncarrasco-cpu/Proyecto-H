// Callbacks reales de Haku, Edge local y datos sintéticos. Bloquea toda conexión externa.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright'), F = require('./fixtures/libro-actualizaciones-pagos-flujo.cjs');
const root = path.resolve(__dirname, '..'), read = p => fs.readFileSync(path.join(root, p), 'utf8');
const api = 'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
const source = read('js/haiku-libro-consultas-v1.js'); assert.ok(source.includes(api));
const scripts = { '/semantica.js': read('js/haiku-libro-semantica-v1.js'),
    '/consultas.js': source.replace(api, api.replace(' })', ', renderizarComparacion })')),
    '/cliente.js': 'window.crearClienteFicticio = ' + F.cliente.toString() };
const css = ['css/styles.css','css/supabase-asistente-v1.css','css/sites-asistente-v1.css','css/supabase-haku-reconciliacion-v1.css'].map(read).join('\n');
const server = http.createServer((req, res) => {
    if (scripts[req.url]) return res.writeHead(200, { 'Content-Type': 'application/javascript;charset=utf-8' }).end(scripts[req.url]);
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><main style="max-width:920px;margin:auto;padding:8px"><div id="out"></div></main><script src="/semantica.js"></script><script src="/cliente.js"></script><script src="/consultas.js"></script></body></html>`);
});
(async () => {
    await new Promise(ok => server.listen(0, '127.0.0.1', ok)); let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.HAIKU_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
        const origin = 'http://127.0.0.1:' + server.address().port;
        for (const width of [1100, 390]) for (const conflicto of [1, -1]) {
            const context = await browser.newContext({ viewport: { width, height: 850 } }), externos = [], errores = [];
            await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); externos.push(route.request().url()); return route.abort(); });
            const page = await context.newPage(); page.on('pageerror', e => errores.push(e.message)); await page.goto(origin);
            await page.evaluate(async ({ f, conflicto }) => {
                const Q = window.HAIKU_LIBRO_CONSULTAS; window.confirm = () => true;
                window.__db = window.haikuSupabase = window.crearClienteFicticio(f, { conflicto });
                const comparacion = await Q.compararSistema(f.reservas, window.__db, f.q), decisiones = new Map();
                for (const g of comparacion.grupos) { const s = f.estadias.find(s => s.cabanas.numero === g.items[0].libro.cabana); if (s) decisiones.set(g.clave, { valor: 'asociar:' + s.id }); }
                Q.renderizarComparacion(document.getElementById('out'), { reservas: f.reservas, q: f.q, comparacion }, { decisiones, aprobados: new Set() });
            }, { f: F.crear(), conflicto });
            await page.getByRole('button', { name: 'Preparar incorporación', exact: true }).click();
            assert.equal(await page.locator('.haiku-incorporacion-seccion--actualizaciones input:checked').count(), 4);
            await page.getByRole('button', { name: 'Actualizar titular y RUT', exact: true }).click();
            if (conflicto === 1) {
                await page.getByRole('button', { name: 'Volver a comparar con datos actuales', exact: true }).click();
                await page.getByRole('button', { name: 'Preparar incorporación', exact: true }).click();
                assert.equal(await page.locator('.haiku-incorporacion-seccion--actualizaciones input:checked').count(), 3);
                await page.locator('.haiku-incorporacion-seccion--pendientes > summary').click();
                assert.match(await page.locator('#out').innerText(), /Documento de otro huésped.*revisión humana/);
                await page.locator('.haiku-incorporacion-seccion--actualizaciones > summary').click();
                await page.locator('.haiku-incorporacion-seccion--actualizaciones input:checked').last().uncheck();
                await page.getByRole('button', { name: 'Volver', exact: true }).click();
                await page.getByRole('button', { name: 'Preparar incorporación', exact: true }).click();
                assert.equal(await page.locator('.haiku-incorporacion-seccion--actualizaciones input:checked').count(), 2);
                await page.locator('.haiku-incorporacion-seccion--actualizaciones > summary').click();
                await page.locator('.haiku-incorporacion-seccion--actualizaciones input:not(:checked)').check();
                await page.getByRole('button', { name: 'Actualizar titular y RUT', exact: true }).click();
                await page.getByText('3 actualización(es) confirmada(s).', { exact: false }).waitFor();
                await page.getByText('Revisar pagos · identidades pendientes', { exact: true }).waitFor();
            } else await page.getByText('Paso 2 de 2 · Aprobar pagos', { exact: true }).waitFor();
            // El rerender reemplaza la vista; los pagos recién habilitados exigen selección nueva.
            assert.equal(await page.locator('.haku-incorporacion-sites-cabecera').count(), 1);
            assert.equal(await page.locator('.haiku-incorporacion-seccion--pagos input:checked').count(), 0);
            await page.locator('.haiku-incorporacion-seccion--pagos > summary').click();
            const pagos = page.locator('.haiku-incorporacion-seccion--pagos input[type=checkbox]');
            assert.equal(await pagos.count(), conflicto === 1 ? 1 : 2);
            for (const checkbox of await pagos.all()) { assert.equal(await checkbox.isEnabled(), true); await checkbox.check(); }
            if (process.env.HAKU_FLUJO_CAPTURAS) await page.screenshot({ path: path.join(process.env.HAKU_FLUJO_CAPTURAS, `libro-pagos-${width}-${conflicto}.png`), fullPage: true });
            if (conflicto === -1) await page.evaluate(() => { window.__db.red = true; });
            await page.getByRole('button', { name: conflicto === 1 ? 'Continuar con 1 elemento listo' : 'Continuar con 2 elementos listos', exact: true }).click();
            if (conflicto === -1) {
                await page.getByRole('button', { name: 'Reintentar confirmación', exact: true }).waitFor();
                for (const checkbox of await pagos.all()) assert.equal(await checkbox.isDisabled(), true);
                assert.equal(await page.getByRole('button', { name: 'Volver', exact: true }).isDisabled(), true);
                await page.getByRole('button', { name: 'Reintentar confirmación', exact: true }).click();
                const llamadas = await page.evaluate(() => window.__db.calls.slice(-2));
                assert.equal(llamadas[0].args.p_operacion_id, llamadas[1].args.p_operacion_id);
            }
            await page.getByText('Incorporación completada', { exact: true }).waitFor();
            assert.equal(await page.evaluate(() => window.__db.pagos.length), conflicto === 1 ? 1 : 2);
            await page.getByRole('button', { name: 'Volver a la comparación', exact: true }).click();
            await page.getByRole('button', { name: 'Preparar incorporación', exact: true }).click();
            assert.equal(await page.locator('.haiku-incorporacion-seccion--pagos input').count(), 0);
            const llamadas = await page.evaluate(() => window.__db.calls);
            assert.ok(llamadas.filter(c => c.args.p_items?.some(i => i.tipo === 'pago')).every(c => c.args.p_items.every(i => i.tipo === 'pago')));
            assert.deepEqual(externos, []); assert.deepEqual(errores, []);
            console.log(JSON.stringify({ width, conflicto, resultado: 'PASS', pagos: conflicto === 1 ? 1 : 2, externos: 0 }));
            await context.close();
        }
    } finally { await browser?.close(); await new Promise(ok => server.close(ok)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
