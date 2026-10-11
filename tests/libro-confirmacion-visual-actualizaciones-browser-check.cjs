// Renderer y callbacks reales, Edge local y fixtures sintéticos. Toda conexión externa se bloquea.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright'), F = require('./fixtures/libro-actualizaciones-pagos-flujo.cjs');
const root = path.resolve(__dirname, '..'), read = p => fs.readFileSync(path.join(root, p), 'utf8');
const api = 'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
const source = read('js/haiku-libro-consultas-v1.js'); assert.ok(source.includes(api));
const assets = { '/semantica.js': read('js/haiku-libro-semantica-v1.js'),
    '/consultas.js': source.replace(api, api.replace(' })', ', renderizarComparacion })')),
    '/cliente.js': 'window.crearClienteFicticio = ' + F.cliente.toString() };
for (const p of ['css/styles.css','css/supabase-asistente-v1.css','css/supabase-haku-reconciliacion-v1.css','css/sites-asistente-v1.css']) assets['/' + p] = read(p);
const server = http.createServer((req, res) => {
    if (Object.hasOwn(assets, req.url)) return res.writeHead(200, { 'Content-Type': req.url.endsWith('.css') ? 'text/css;charset=utf-8' : 'application/javascript;charset=utf-8' }).end(assets[req.url]);
    if (req.url !== '/') return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        ${Object.keys(assets).filter(p => p.endsWith('.css')).map(p => `<link rel="stylesheet" href="${p}">`).join('')}
        <body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel">
        <header class="haiku-asistente-cabecera">Haku · Prueba sintética</header><div class="haiku-asistente-mensajes"><div id="out"></div></div>
        <footer class="haiku-asistente-compositor">Prueba local</footer></div></div>
        <script src="/semantica.js"></script><script src="/cliente.js"></script><script src="/consultas.js"></script></body></html>`);
});
(async () => {
    await new Promise(ok => server.listen(0, '127.0.0.1', ok)); let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.HAIKU_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
        const origin = 'http://127.0.0.1:' + server.address().port;
        for (const width of [390, 1100]) for (const caso of ['confirmado', 'parcial', 'manual', 'relectura-fallida', 'aprobacion-fallida']) {
            const context = await browser.newContext({ viewport: { width, height: 900 } }), externos = [], errores = [];
            await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); externos.push(route.request().url()); return route.abort(); });
            const page = await context.newPage(); page.on('pageerror', e => errores.push(e.message)); await page.goto(origin);
            await page.evaluate(async ({ f, caso }) => {
                window.confirm = () => true;
                if (['manual','aprobacion-fallida'].includes(caso)) for (const r of f.reservas.slice(0, 2)) { r.pagos[0].codigo_autorizacion = null; r.pagos[0].medio_pago = 'efectivo'; }
                const Q = window.HAIKU_LIBRO_CONSULTAS, db = window.__db = window.haikuSupabase = window.crearClienteFicticio(f, { conflicto: caso === 'parcial' ? 1 : -1 });
                if (caso === 'relectura-fallida') { const rpc = db.rpc; db.rpc = async (...args) => { const r = await rpc(...args); if (r.data?.ok) db.lecturaFallida = true; return r; }; }
                const comparacion = await Q.compararSistema(f.reservas, db, f.q), decisiones = new Map();
                for (const g of comparacion.grupos) { const s = f.estadias.find(s => s.cabanas.numero === g.items[0].libro.cabana); if (s) decisiones.set(g.clave, { valor: 'asociar:' + s.id }); }
                Q.renderizarComparacion(document.getElementById('out'), { reservas: f.reservas, q: f.q, comparacion }, { decisiones, aprobados: new Set() });
            }, { f: F.crear(), caso });
            await page.getByRole('button', { name: 'Preparar incorporación', exact: true }).click();
            await page.getByRole('button', { name: 'Actualizar titular y RUT', exact: true }).click();
            const recibo = page.locator('.haku-incorporacion-actualizacion-completada');
            if (caso === 'parcial') {
                assert.equal(await recibo.count(), 0);
                await page.getByRole('button', { name: 'Volver a comparar con datos actuales', exact: true }).click();
                await page.getByRole('button', { name: 'Preparar incorporación', exact: true }).click();
                await page.getByRole('button', { name: 'Actualizar titular y RUT', exact: true }).click();
            }
            if (caso === 'relectura-fallida') {
                await page.getByText('Incorporación completada', { exact: true }).waitFor();
                const texto = await page.locator('#out').innerText();
                assert.match(texto, /Nombre: Persona Ficticia Proyecto 1 → Persona Ficticia Libro 1/);
                assert.match(texto, /No se pudo volver a leer los pagos/); assert.doesNotMatch(texto, /Paso 2 de 2/);
                await page.evaluate(() => { window.__db.lecturaFallida = false; });
                await page.getByRole('button', { name: 'Volver a la comparación', exact: true }).click();
                await page.getByRole('button', { name: 'Preparar incorporación', exact: true }).click();
            }
            await recibo.getByText('Actualización completada', { exact: true }).waitFor();
            const esperado = caso === 'parcial' ? 3 : 4, texto = await recibo.innerText();
            assert.match(texto, new RegExp(`${esperado} actualizaciones confirmadas`));
            assert.equal(await recibo.locator('.haku-incorporacion-final-item').count(), esperado);
            assert.match(texto, /CAB 1.*Nombre: Persona Ficticia Proyecto 1 → Persona Ficticia Libro 1/s);
            assert.match(texto, /RUT\/pasaporte: FICTICIO-PROYECTO-1 → FICTICIO-LIBRO-1/);
            assert.doesNotMatch(texto, /Adultos:|Pagos incorporados/);
            if (caso === 'parcial') {
                assert.doesNotMatch(texto, /Persona Ficticia Libro 2|CAB 2/);
                assert.equal(await page.locator('.haiku-incorporacion-seccion--pagos input').count(), 1);
            } else if (caso !== 'relectura-fallida') await page.getByText('Paso 2 de 2 · Aprobar pagos', { exact: true }).waitFor();
            if (['manual','aprobacion-fallida'].includes(caso)) {
                await page.locator('.haiku-incorporacion-seccion--dudosos > summary').click();
                if (caso === 'aprobacion-fallida') await page.evaluate(() => { window.__db.lecturaFallida = true; });
                await page.getByRole('button', { name: 'Aprobar 2 pagos revisables', exact: true }).click();
                if (caso === 'aprobacion-fallida') {
                    assert.equal(await recibo.innerText(), texto); assert.match(await page.locator('#out').innerText(), /No se pudo actualizar la comparación/);
                    assert.equal(await page.locator('#out input').count(), 0);
                    await page.evaluate(() => { window.__db.lecturaFallida = false; });
                    await page.getByRole('button', { name:'Volver a comparar con datos actuales',exact:true }).click();
                    assert.equal(await recibo.innerText(), texto);
                    await page.getByRole('button', { name:'Preparar incorporación',exact:true }).click();
                    await page.locator('.haiku-incorporacion-seccion--dudosos > summary').click();
                    await page.getByRole('button', { name:'Aprobar 2 pagos revisables',exact:true }).click();
                }
                assert.equal(await recibo.innerText(), texto);
                assert.equal(await page.locator('.haiku-incorporacion-seccion--pagos input:checked').count(), 2);
            }
            await page.getByRole('button', { name: 'Volver', exact: true }).click();
            await page.getByRole('button', { name: 'Preparar incorporación', exact: true }).click();
            assert.equal(await recibo.innerText(), texto); assert.equal(await recibo.count(), 1);
            assert.equal(await page.evaluate(() => window.__db.pagos.length), 0);
            assert.equal(await page.evaluate(() => window.__db.calls.length), caso === 'parcial' ? 2 : 1);
            const geometria = await page.evaluate(() => {
                const r = document.querySelector('.haku-incorporacion-actualizacion-completada'), p = document.querySelector('.haku-incorporacion-sites-cabecera');
                return { reciboAbajo:r.getBoundingClientRect().bottom, pagosArriba:p.getBoundingClientRect().top,
                    overflow:r.scrollWidth - r.clientWidth, pantalla:document.documentElement.scrollWidth - innerWidth,
                    estilo:getComputedStyle(r.querySelector('summary')).borderLeftWidth };
            });
            assert.ok(geometria.reciboAbajo <= geometria.pagosArriba + 1); assert.ok(geometria.overflow <= 1); assert.ok(geometria.pantalla <= 1);
            assert.equal(geometria.estilo, '3px', 'se usan los estilos del informe existente');
            if (process.env.HAKU_CONFIRMACION_CAPTURAS) {
                await recibo.scrollIntoViewIfNeeded();
                await page.screenshot({ path:path.join(process.env.HAKU_CONFIRMACION_CAPTURAS, `confirmacion-${width}-${caso}.png`), fullPage:true });
                await page.locator('.haku-incorporacion-sites-cabecera').scrollIntoViewIfNeeded();
                await page.screenshot({ path:path.join(process.env.HAKU_CONFIRMACION_CAPTURAS, `confirmacion-${width}-${caso}-pagos.png`), fullPage:true });
            }
            assert.deepEqual(externos, []); assert.deepEqual(errores, []);
            console.log(JSON.stringify({ width, caso, resultado:'PASS', actualizaciones:esperado, pagosRegistrados:0, externos:0 }));
            await context.close();
        }
    } finally { await browser?.close(); await new Promise(ok => server.close(ok)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
