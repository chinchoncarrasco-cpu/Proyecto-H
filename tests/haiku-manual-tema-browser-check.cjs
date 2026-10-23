// Paneles producidos por el renderer real, con fixtures locales y red externa bloqueada.
// NODE_PATH=<playwright> CHROMIUM_PATH=<chromium> node tests/haiku-manual-tema-browser-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const vm = require('node:vm');
const { chromium } = require('playwright');
const { caso } = require('./fixtures/libro-pago-revision-admin.cjs');
const { entorno } = require('./fixtures/libro-medio-pago-manual.cjs');
const root = path.resolve(__dirname, '..');
const output = process.env.TEMA_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'haku-manual-tema-'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function html(e) {
    const attrs = [];
    for (const key of ['className','id','type','value','title','role','src','alt','width','height','min','max','step','maxLength',
        ...Object.keys(e).filter(k => k.startsWith('aria-'))]) {
        if (e[key] != null) attrs.push(`${key === 'className' ? 'class' : key}="${esc(e[key])}"`);
    }
    for (const key of ['disabled','hidden','checked','selected','open']) if (e[key]) attrs.push(key);
    for (const [key,value] of Object.entries(e.dataset || {})) attrs.push(`data-${key.replace(/[A-Z]/g, c=>'-'+c.toLowerCase())}="${esc(value)}"`);
    const start = `<${e.tag} ${attrs.join(' ')}>`;
    return ['input','img','br'].includes(e.tag) ? start : start + esc(e.textContent || '') + e.children.map(html).join('') + `</${e.tag}>`;
}
async function panels() {
    const result = {};
    for (const name of ['efectivo','transferencia','confirmado','medio','servicio']) {
        const h = name === 'medio' ? entorno() : name === 'servicio' ? entorno({alojamiento:false,conServicios:false}) :
            caso(name === 'transferencia' ? 'cabana_transferencia' : 'efectivo_servicio');
        if (name === 'servicio') h.r.pagos[0].medio_pago = 'debito';
        let plan = await h.preparar();
        if (name === 'confirmado') {
            await h.render(plan).querySelectorAll('button').find(b=>b.textContent === 'Aprobación manual').events.click();
            const next = await h.confirmar(plan);
            h.Q.continuarVistaManualPago(plan,next,h.item(plan).id,{tipo:'revision_admin_pago'});
            plan = next;
        }
        const row = h.render(plan);
        if (name !== 'confirmado') await row.querySelectorAll('button').find(b=>b.textContent === 'Aprobación manual').events.click();
        const panel = row.querySelector('.haiku-incorporacion-manual-pago-panel');
        assert.equal(panel.hidden, false);
        assert.equal(h.llamadas.filter(x=>/incorporar|registrar/.test(x.nombre || '')).length, 0);
        result[name] = html(panel);
    }
    return result;
}
function state() {
    const p = document.querySelector('.haiku-incorporacion-manual-pago-panel');
    return {
        content:p.textContent,
        boxes:[p,...p.querySelectorAll('*')].filter(e=>e.getClientRects().length).map(e=>{
            const r=e.getBoundingClientRect(); return [e.tagName,e.className,...['x','y','width','height'].map(k=>Math.round(r[k]*100)/100)];
        }),
        fields:[...p.querySelectorAll('input,select,button')].map(e=>[e.value,e.checked,e.disabled]),
        details:[...p.querySelectorAll('details')].map(e=>e.open)
    };
}
const contrastSource = read('tests/haiku-tema-browser-check.cjs');
const contrast = vm.runInNewContext('(' + contrastSource.slice(contrastSource.indexOf('function auditarContraste()'), contrastSource.indexOf('main().catch')) + ')');
async function main() {
    fs.mkdirSync(output,{recursive:true});
    const cases = await panels();
    const server = http.createServer((req,res)=>{
        const u=new URL(req.url,'http://localhost');
        if (u.pathname === '/') {
            const styles=['styles','sites-shell-v1','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1','haiku-tema-oscuro-v1','haiku-tema-v1','haiku-libro-pagos-ui-v1'];
            res.setHeader('Content-Type','text/html; charset=utf-8');
            res.end('<!doctype html><html lang="es" data-haiku-tema="claro"><head><meta name="viewport" content="width=device-width,initial-scale=1">'+
                styles.map(s=>`<link rel="stylesheet" href="/css/${s}.css">`).join('')+
                '</head><body style="margin:0;font-family:var(--sites-shell-font)"><main style="width:min(396px,calc(100% - 24px));margin:12px auto">'+cases[u.searchParams.get('caso')]+'</main></body></html>'); return;
        }
        const file=path.resolve(root,'.'+u.pathname);
        if (!file.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
        try {res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(fs.readFileSync(file));}
        catch {res.writeHead(404).end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
    const errors=[], failures=[]; let views=0;
    try {
        const context=await browser.newContext();
        await context.route('**/*',route=>new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
        page.on('response',r=>{if(r.status()>=400)failures.push(r.url());});
        for (const width of [320,390,1000]) for (const name of Object.keys(cases)) {
            await page.setViewportSize({width,height:1200});
            await page.goto(`http://127.0.0.1:${server.address().port}/?caso=${name}`);
            const panel=page.locator('.haiku-incorporacion-manual-pago-panel');
            assert.equal(await panel.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
            await page.locator('input[type="text"]').evaluateAll(es=>es.forEach(e=>e.value='Revisión de ejemplo conservada'));
            await page.locator('input[type="checkbox"]').evaluateAll(es=>es.forEach(e=>e.checked=true));
            await page.locator('details').evaluateAll(es=>es.forEach(e=>e.open=true));
            const before=await page.evaluate(state);
            await page.evaluate(()=>document.documentElement.dataset.haikuTema='oscuro');
            assert.deepEqual(await page.evaluate(state),before,`${width}/${name}: geometría, campos y estado intactos`);
            assert.equal(await panel.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(27, 36, 32)');
            assert.equal(await panel.evaluate(e=>getComputedStyle(e).color),'rgb(232, 239, 234)');
            assert.deepEqual(await page.evaluate(contrast),[],`${width}/${name}: contraste`);
            const primary=panel.locator('.haiku-manual-primario');
            if (await primary.count()) {
                const disabled=await primary.isDisabled();
                await primary.evaluate(e=>e.disabled=false);
                assert.equal(await primary.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(34, 115, 92)');
                assert.deepEqual(await page.evaluate(contrast),[],`${width}/${name}: contraste de acción disponible`);
                await primary.focus();
                assert.equal(await primary.evaluate(e=>getComputedStyle(e).outlineColor),'rgb(159, 210, 179)');
                await primary.evaluate((e,d)=>{e.blur();e.disabled=d;},disabled);
            }
            assert.equal(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,`${width}/${name}: sin desborde`);
            assert.deepEqual(await panel.locator('input,select,.haiku-manual-destino,.haiku-manual-secundario').evaluateAll(es=>es.filter(e=>getComputedStyle(e).backgroundColor==='rgb(255, 255, 255)').map(e=>e.className)),[],`${name}: sin superficies blancas`);
            await panel.screenshot({path:path.join(output,`${width}-${name}-oscuro.png`)});
            await page.evaluate(()=>document.documentElement.dataset.haikuTema='claro');
            assert.deepEqual(await page.evaluate(state),before,`${width}/${name}: regreso a claro`);
            await panel.screenshot({path:path.join(output,`${width}-${name}-claro.png`)});
            console.log(`OK ${width} ${name}`); views++;
        }
        assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
        await page.evaluate(()=>document.documentElement.dataset.haikuTema='oscuro');
        await page.emulateMedia({media:'print'});
        assert.equal(await page.locator('.haiku-incorporacion-manual-pago-panel').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
        console.log(`${views} casos de navegador aprobados. ${output}`);
    } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
