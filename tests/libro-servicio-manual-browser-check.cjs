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
            const page = await browser.newPage({ viewport });
        await require('./fixtures/dialogos.cjs').prepararNavegador(page); page.on('pageerror', e => errors.push(e.message));
            await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : (externos.push(r.request().url()), r.abort()));
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            for (const file of ['haiku-libro-semantica-v1', 'haiku-servicios-identidad-v1']) await page.addScriptTag({ content: read(`js/${file}.js`) });
            await page.evaluate(setup);
            await page.addScriptTag({ content: source });
            await page.addScriptTag({ content: read('js/haiku-libro-confirm-cancel-fix-v1.js') });
            await page.evaluate(async q => { document.getElementById('prev').textContent = q; window.q = q; const api = HAIKU_LIBRO_SERVICIOS_SCOPE_V2; api.renderizar(await api.construir(q), document.getElementById('out'), q); }, consulta);
            for (const [texto,campos,codigo] of [
                ['1 HORA DE CORTESIA TINAJA',{codigo_servicio:'tinajaTonel',hora:'18:00'},'tinajaTonel'],
                ['X PAGAR LATE OUT',{hora:'12:20'},'lateCheckout'],
                ['1 MASAJE DE 1 HORA',{codigo_servicio:'masajeTerapeutico60',hora:'17:00'},'masajeTerapeutico60']]) {
                await page.evaluate(async q=>{const api=HAIKU_LIBRO_SERVICIOS_SCOPE_V2;await api.renderizar(await api.construir(q),document.getElementById('out'),q);},consulta);
                const row=page.locator('.haku-libro-servicios__item').filter({hasText:texto});
                await row.locator('..').locator('..').evaluate(el=>el.open=true);
                await row.getByRole('button',{name:'Aprobación manual',exact:true}).click();
                const panel=page.locator('.haku-libro-servicio-manual');
                for(const [clave,valor] of Object.entries(campos)){
                    const input=panel.locator(`[data-campo-manual="${clave}"]`);
                    if(clave==='codigo_servicio')await input.selectOption(valor);
                    else {await input.fill(valor);await input.dispatchEvent('change');}
                }
                const antes=await page.evaluate(()=>fixtureServicios.escrituras.length);
                await page.evaluate(()=>window.confirm=()=>{throw Error('No corresponde otro diálogo');});
                await panel.getByRole('button',{name:'Confirmar servicio',exact:true}).click();
                await page.waitForFunction(n=>fixtureServicios.escrituras.length===n+1,antes);
                const payload=await page.evaluate(()=>fixtureServicios.escrituras.at(-1));
                assert.equal(payload.p_servicios.length,1);assert.equal(payload.p_notas.length,0);
                assert.equal(payload.p_servicios[0].codigo_servicio,codigo);
                await page.getByText('Incorporación completada',{exact:true}).waitFor();
            }
            await page.close(); console.log(`PASS servicios manual: ${viewport.width}px, A+B+C, confirmación directa, sin segundo diálogo, payload único`);
        }
        assert.deepEqual(errors, []); assert.deepEqual(externos, []);
    } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
