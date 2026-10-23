// Flujo real de UI con datos sintéticos y todas las conexiones externas bloqueadas.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const {read,source,setup,consulta}=require('./fixtures/libro-servicio-manual.cjs');
const {configurar}=require('./fixtures/libro-tinaja-cambio-color.cjs');
const root=path.resolve(__dirname,'..'),errores=[],externos=[];
const server=http.createServer((req,res)=>{
    const p=new URL(req.url,'http://localhost').pathname;
    if(p==='/')return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
        ['styles','sites-shell-v1','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1',
            'haiku-tema-oscuro-v1','haiku-tema-v1'].map(x=>`<link rel="stylesheet" href="/css/${x}.css">`).join('')+
        '</head><body style="margin:0;font-family:var(--sites-shell-font)"><div class="haiku-asistente-root"><div class="haiku-asistente-panel">'+
        '<div class="haiku-asistente-mensajes"><div id="out"></div></div></div></div></body></html>');
    const f=path.resolve(root,'.'+p);if(!f.startsWith(root+path.sep))return res.writeHead(403).end();
    try{res.writeHead(200,{'Content-Type':f.endsWith('.svg')?'image/svg+xml':'text/css'}).end(fs.readFileSync(f));}catch{res.writeHead(404).end();}
});
(async()=>{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
    try{
        browser=await chromium.launch({headless:true,...(process.env.HAKU_CHROMIUM_PATH?{executablePath:process.env.HAKU_CHROMIUM_PATH}:{})});
        for(const width of [1100,390,320])for(const tema of ['claro','oscuro']){
            const page=await browser.newPage({viewport:{width,height:1100}});
            page.on('pageerror',e=>errores.push(e.message));
            await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(externos.push(r.request().url()),r.abort()));
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            for(const f of ['haiku-libro-semantica-v1','haiku-servicios-identidad-v1'])await page.addScriptTag({content:read(`js/${f}.js`)});
            await page.evaluate(setup);await page.addScriptTag({content:source});await page.evaluate(configurar);
            await page.evaluate(async({q,tema})=>{
                document.documentElement.dataset.haikuTema=tema;
                HAIKU_LIBRO_SERVICIOS_SCOPE_V2.renderizar(await HAIKU_LIBRO_SERVICIOS_SCOPE_V2.construir(q),document.getElementById('out'),q);
            },{q:consulta,tema});
            await page.locator('.haku-libro-servicios__seccion--revision > summary').click();
            const fila=page.locator('.haku-libro-servicios__item').filter({hasText:'JACUZZI 1 HORA'});
            assert.match(await fila.innerText(),/Posible modificación.*Tonel/s);
            assert.match(await fila.innerText(),/cortesía.*cobro previo/s);
            assert.doesNotMatch(await fila.innerText(),/cobro por definir|Falta definir si el servicio es cobrable/);
            assert.equal(await fila.locator('input[type="checkbox"]').isDisabled(),true);
            await fila.getByRole('button',{name:'Aprobación manual',exact:true}).click();
            const panel=fila.locator('.haku-libro-servicio-manual');await panel.waitFor({state:'visible'});
            assert.match(await panel.innerText(),/Registrado en Haku.*Tonel.*19:15–20:15/s);
            assert.match(await panel.innerText(),/Indicado en el Libro.*Jacuzzi.*19:15/s);
            assert.equal(await panel.locator('[data-servicio-campo="tipo_cobro"]').count(),0);
            await page.waitForFunction(()=>[...document.styleSheets].some(s=>s.href?.includes('haiku-libro-pagos-ui-v1.css')));
            if(tema==='oscuro')assert.equal(await panel.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(27, 36, 32)');
            assert.equal(await panel.evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
            if(process.env.HAKU_TINAJA_SCREENSHOT_DIR){fs.mkdirSync(process.env.HAKU_TINAJA_SCREENSHOT_DIR,{recursive:true});
                await panel.screenshot({path:path.join(process.env.HAKU_TINAJA_SCREENSHOT_DIR,`traslado-${width}-${tema}.png`)});}
            const confirmar=panel.getByRole('button',{name:'Confirmar decisión',exact:true});assert.equal(await confirmar.isDisabled(),true);
            assert.equal(await page.evaluate(()=>fixtureServicios.revisiones.length+fixtureServicios.escrituras.length),0);
            await panel.locator('[data-revision-admin="modo"]').selectOption('actualizar');
            await panel.locator('[data-revision-admin="motivo"]').fill('Traslado por reparación de la banca del Tonel');
            await panel.locator('[data-revision-admin="aceptar"]').check();assert.equal(await confirmar.isEnabled(),true);
            await confirmar.click();
            await page.waitForFunction(()=>fixtureServicios.revisiones.length===1&&!document.querySelector('.haku-libro-servicio-manual'));
            assert.match(await page.locator('.haku-libro-revision-admin-resultado').innerText(),/Aprobación guardada/);
            const actual=await page.evaluate(()=>({s:fixtureServicios.db.servicios,creados:fixtureServicios.escrituras.length}));
            assert.equal(actual.s.length,1);assert.equal(actual.s[0].id,'tinaja-existente');
            assert.equal(actual.s[0].catalogo_servicios.codigo,'tinajaJacuzzi');assert.equal(actual.s[0].total,30000);
            assert.equal(actual.creados,0);await page.close();console.log(`PASS ${width}px ${tema}`);
        }
        assert.deepEqual(errores,[]);assert.deepEqual(externos,[]);
    }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
