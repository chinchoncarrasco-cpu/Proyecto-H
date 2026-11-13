// Renderer y callbacks reales, Edge local y fixtures sintéticos. Toda conexión externa se bloquea.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright'), F = require('./fixtures/libro-actualizaciones-pagos-flujo.cjs');
const root = path.resolve(__dirname, '..'), read = p => fs.readFileSync(path.join(root, p), 'utf8');
const api = 'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
const source = read('js/haiku-libro-consultas-v1.js'); assert.ok(source.includes(api));
const assets = { '/semantica.js': read('js/haiku-libro-semantica-v1.js'),
    '/estados.js': read('js/haiku-reserva-estado-manual-v1.js'),
    '/consultas.js': source.replace(api, api.replace(' })', ', renderizarComparacion, renderizarResultadoIncorporacion })')),
    '/cliente.js': 'window.crearClienteFicticio = ' + F.cliente.toString() };
for (const p of ['css/styles.css','css/haiku-paleta-v1.css','css/supabase-asistente-v1.css','css/supabase-haku-reconciliacion-v1.css',
    'css/sites-asistente-v1.css','css/haiku-tema-oscuro-v1.css']) assets['/' + p] = read(p);
const server = http.createServer((req, res) => {
    if (Object.hasOwn(assets, req.url)) return res.writeHead(200, { 'Content-Type': req.url.endsWith('.css') ? 'text/css;charset=utf-8' : 'application/javascript;charset=utf-8' }).end(assets[req.url]);
    if (req.url !== '/') return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        ${Object.keys(assets).filter(p => p.endsWith('.css')).map(p => `<link rel="stylesheet" href="${p}">`).join('')}
        <body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel">
        <header class="haiku-asistente-cabecera">Haku · Prueba sintética</header><div class="haiku-asistente-mensajes"><div id="out"></div></div>
        <footer class="haiku-asistente-compositor">Prueba local</footer></div></div>
        <script src="/semantica.js"></script><script src="/estados.js"></script><script src="/cliente.js"></script><script src="/consultas.js"></script></body></html>`);
});
async function verificarCampo(recibo, campo, anterior, guardado) {
    const fila = recibo.locator('.haku-comprobante-campo').filter({hasText:anterior}).filter({hasText:campo});
    assert.equal(await fila.count(),1);
    assert.equal(await fila.locator('.haku-comprobante-antes > .haku-comprobante-valor').innerText(),anterior);
    assert.equal(await fila.locator('.haku-comprobante-guardado > .haku-comprobante-valor').innerText(),guardado);
}
async function verificarNotas(browser, origin, width, tema) {
    const context = await browser.newContext({viewport:{width,height:900},hasTouch:width < 600});
    try {
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        const page = await context.newPage();
        await page.goto(origin);
        const errores = [];
        page.on('pageerror',e=>errores.push(e.message));
        await page.evaluate(tema => {
            document.documentElement.dataset.haikuTema = tema;
            if (innerWidth < 600) document.documentElement.dataset.hakuMobileAssistant = '1';
            const comun = 'Texto ficticio largo de referencia de una noche con indicaciones repetidas para los turnos de recepción que permanecen en ambas versiones.';
            const pareja = (campo,anterior,libro) => ({campo,anterior,libro,tieneAnterior:true});
            const actualizaciones = [
                {titular:'Camila Torres',cabana:'CAB 4',periodo:'13/11/26 → 15/11/26',estado:'Actualizado',
                    identidad:{reservaId:'00000000-0000-4000-8000-000000000001'},cambios:[
                    pareja('Adultos',2,4), pareja('Estado de estadía','pendiente','confirmada')]},
                {titular:'Daniel Vega',cabana:'CAB 7',periodo:'14/11/26 → 15/11/26',estado:'Actualizado',
                    identidad:{reservaId:'00000000-0000-4000-8000-000000000002'},cambios:[
                    pareja('Notas y detalles del Libro',
                        `[DATOS DEL LIBRO]\nIndicaciones de llegada\n${comun} Tonel a las 17:15\n[/DATOS DEL LIBRO]`,
                        `[DATOS DEL LIBRO]\nIndicaciones de llegada\n${comun} Jacuzzi a las 17:15\n[/DATOS DEL LIBRO]`)]}
            ];
            window.HAIKU_LIBRO_CONSULTAS.renderizarResultadoIncorporacion(document.getElementById('out'),
                {resultado:{actualizaciones:2,omitidos:1},detalle:{actualizaciones,omitidos:[
                    {titular:'Caso ficticio',cabana:'CAB 9',estado:'Omitido',motivo:'Coincidencia que requiere revisión.'}
                ]}},()=>{});
        },tema);
        const recibo = page.locator('[data-categoria="actualizaciones"]');
        const campos = recibo.locator('.haku-comprobante-campo');
        const notas = recibo.locator('.haku-comprobante-notas').first();
        const omitidos = page.locator('[data-categoria="omitidos"]');
        assert.equal(await recibo.getByRole('button',{name:'Ver reserva',exact:true}).count(),2);
        assert.equal(await omitidos.evaluate(e=>e.open),false);
        await omitidos.locator('summary').click();
        assert.match(await omitidos.innerText(),/Coincidencia que requiere revisión/);
        await omitidos.locator('summary').click();
        assert.equal(await notas.evaluate(e=>e.open),false);
        await verificarCampo(recibo,'Estado de estadía','Confirmación Pendiente','Confirmada');
        await notas.getByText('Notas del Libro · 1 añadida · 1 retirada',{exact:true}).click();
        const resumen = notas.locator('.haku-comprobante-notas-pares').first();
        assert.match(await resumen.innerText(),/Antes · retirada.*Tonel.*Guardado · añadida.*Jacuzzi/s);
        assert.doesNotMatch(await resumen.innerText(),/Texto ficticio largo|Indicaciones de llegada|DATOS DEL LIBRO/);
        const completas = notas.locator('.haku-comprobante-notas');
        assert.equal(await completas.evaluate(e=>e.open),false);
        await completas.getByText('Ver notas completas',{exact:true}).click();
        assert.match(await completas.innerText(),/Indicaciones de llegada.*Texto ficticio largo/s);
        assert.doesNotMatch(await completas.innerText(),/DATOS DEL LIBRO/);
        const medidas = await campos.first().evaluate(e => {
            const antes=e.querySelector('.haku-comprobante-antes'), guardado=e.querySelector('.haku-comprobante-guardado');
            const estilos=el=>getComputedStyle(el);
            const titulo=e.closest('.haku-incorporacion-final-item').querySelector('.haku-incorporacion-final-item-cabecera');
            return { antes:estilos(antes).color,guardado:estilos(guardado).color,titulo:parseFloat(estilos(titulo).fontSize),
                valor:parseFloat(estilos(antes).fontSize),columnas:estilos(e.parentElement.previousElementSibling).display,
                fila:Math.abs(antes.getBoundingClientRect().top-guardado.getBoundingClientRect().top),
                overflow:e.closest('#out').scrollWidth-e.closest('#out').clientWidth };
        });
        assert.equal(medidas.antes,tema==='oscuro'?'rgb(177, 194, 183)':'rgb(88, 108, 96)');
        assert.equal(medidas.guardado,tema==='oscuro'?'rgb(159, 210, 179)':'rgb(40, 108, 78)');
        assert.ok(medidas.titulo <= 12 && medidas.valor <= 10.1 && medidas.overflow <= 1,JSON.stringify(medidas));
        assert.equal(medidas.columnas,width < 600 ? 'none' : 'grid');
        assert.equal(medidas.fila < 1,width >= 600);
        await completas.getByText('Ver notas completas',{exact:true}).click();
        if (process.env.HAKU_CONFIRMACION_CAPTURAS) await recibo.screenshot({
            path:path.join(process.env.HAKU_CONFIRMACION_CAPTURAS,`comprobante-${width}-${tema}.png`)
        });
        assert.deepEqual(errores,[]);
        console.log(JSON.stringify({width,tema,resultado:'PASS',vista:'comprobante con notas'}));
    } finally { await context.close(); }
}
(async () => {
    await new Promise(ok => server.listen(0, '127.0.0.1', ok)); let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.HAIKU_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
        const origin = 'http://127.0.0.1:' + server.address().port;
        for (const width of [390, 1100]) for (const caso of ['confirmado', 'parcial', 'manual', 'relectura-fallida', 'aprobacion-fallida']) {
            const context = await browser.newContext({ viewport: { width, height: 900 } }), externos = [], errores = [];
            await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); externos.push(route.request().url()); return route.abort(); });
            const page = await context.newPage();
        await require('./fixtures/dialogos.cjs').prepararNavegador(page); page.on('pageerror', e => errores.push(e.message)); await page.goto(origin);
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
                await verificarCampo(page.locator('#out'),'Nombre','Persona Ficticia Proyecto 1','Persona Ficticia Libro 1');
                assert.match(texto, /No se pudo volver a leer los pagos/); assert.doesNotMatch(texto, /Paso 2 de 2/);
                await page.evaluate(() => { window.__db.lecturaFallida = false; });
                await page.getByRole('button', { name: 'Volver a la comparación', exact: true }).click();
                await page.getByRole('button', { name: 'Preparar incorporación', exact: true }).click();
            }
            await recibo.getByText('Actualización completada', { exact: true }).waitFor();
            const esperado = caso === 'parcial' ? 3 : 4, texto = await recibo.innerText();
            assert.match(texto, new RegExp(`${esperado} actualizaciones confirmadas`));
            assert.equal(await recibo.locator('.haku-incorporacion-final-item').count(), esperado);
            assert.match(texto, /CAB 1/);
            await verificarCampo(recibo,'Nombre','Persona Ficticia Proyecto 1','Persona Ficticia Libro 1');
            await verificarCampo(recibo,'RUT/pasaporte','FICTICIO-PROYECTO-1','FICTICIO-LIBRO-1');
            assert.doesNotMatch(texto, /Adultos|Pagos incorporados/);
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
        for (const width of [390,1100]) for (const tema of ['claro','oscuro']) await verificarNotas(browser,origin,width,tema);
    } finally { await browser?.close(); await new Promise(ok => server.close(ok)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
