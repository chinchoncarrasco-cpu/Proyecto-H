// Formulario real del servicio desde el historial; Libro y RPC sólo de prueba.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const {read,setup}=require('./fixtures/libro-servicio-manual.cjs');
const root=path.resolve(__dirname,'..'),errors=[],externos=[];
const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/')return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
        ['styles','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1','haiku-tema-oscuro-v1','haiku-tema-v1']
            .map(s=>`<link rel="stylesheet" href="/css/${s}.css">`).join('')+
        '</head><body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel">'+
        '<header class="haiku-asistente-cabecera">Haku</header><div class="haiku-asistente-mensajes">'+
        '<details class="haku-actualizacion-sites__pendiente" open><summary>CAB 4 · Reserva de prueba</summary>'+
        '<div class="haku-pendiente-detalle"><div id="out"></div></div></details></div></div></div></body></html>');
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
    try{res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css':'image/svg+xml'}).end(fs.readFileSync(file));}
    catch{res.writeHead(404).end();}
});
(async()=>{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const browser=await chromium.launch({executablePath:process.env.HAKU_CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
    try{
        for(const width of [1100,390,320])for(const tema of ['claro','oscuro']){
            const page=await browser.newPage({viewport:{width,height:950}});
            page.on('pageerror',e=>errors.push(e.message));
            await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(externos.push(r.request().url()),r.abort()));
            await page.goto(`http://127.0.0.1:${server.address().port}/`);
            for(const f of ['haiku-libro-semantica-v1','haiku-servicios-identidad-v1'])await page.addScriptTag({content:read(`js/${f}.js`)});
            await page.evaluate(setup);
            await page.addScriptTag({content:read('js/haiku-libro-servicios-scope-v2.js')});
            await page.addScriptTag({content:read('js/haiku-libro-confirm-cancel-fix-v1.js')});
            await page.evaluate(async tema=>{
                document.documentElement.dataset.haikuTema=tema;
                window.haikuSesion={usuario:{activo:true},roles:[{codigo:'administrador'}]};
                window.haikuTienePermiso=p=>p==='pagos.ver';
                fixtureServicios.db.pagos=[];fixtureServicios.db.vista_estado_cargos=[];
                const r=fixtureServicios.reservas[0];r.texto_original='PROMO HAIKU // 18hrs jacuzzi // DEJAR BATAS';
                r.servicios=HAIKU_LIBRO_SEMANTICA.servicios('18hrs jacuzzi',{origen_campo:'notas_reserva'});
                window.abrirManualHistorial=()=>HAIKU_LIBRO_SERVICIOS_SCOPE_V2.abrirRevisionHistorial(document.getElementById('out'),{
                    reservas:[r],generacion:1,aprobacionManual:true});
                await abrirManualHistorial();
            },tema);
            const out=page.locator('#out'),panel=out.locator('.haku-libro-servicio-manual');
            await panel.waitFor();
            await page.waitForFunction(()=>[...document.styleSheets].some(s=>s.href?.includes('haiku-libro-pagos-ui-v1.css')));
            assert.equal(await panel.count(),1);
            assert.doesNotMatch(await out.innerText(),/Interpretación operativa|Reglas de lectura|DEJAR BATAS|Seleccionados:/);
            assert.equal(await panel.evaluate(el=>getComputedStyle(el).backgroundColor),tema==='oscuro'?'rgb(27, 36, 32)':'rgb(255, 255, 255)');
            const desbordes=await out.evaluate(el=>[el,...el.querySelectorAll('*')].filter(x=>x.getClientRects().length&&x.scrollWidth>x.clientWidth+1).map(x=>x.className));
            assert.deepEqual(desbordes,[],`${width}/${tema}: sin desbordes`);
            if(process.env.HAKU_HISTORIAL_MANUAL_SCREENSHOT_DIR){
                fs.mkdirSync(process.env.HAKU_HISTORIAL_MANUAL_SCREENSHOT_DIR,{recursive:true});
                await out.screenshot({path:path.join(process.env.HAKU_HISTORIAL_MANUAL_SCREENSHOT_DIR,`manual-${tema}-${width}.png`)});
            }
            await panel.getByRole('button',{name:'Cancelar',exact:true}).click();
            assert.equal(await panel.count(),0);assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),0);
            await page.evaluate(()=>abrirManualHistorial());
            await panel.getByRole('button',{name:'Confirmar datos y revalidar',exact:true}).click();
            const incorporar=out.getByRole('button',{name:'Incorporar este servicio',exact:true});await incorporar.waitFor();
            assert.doesNotMatch(await out.innerText(),/Interpretación operativa|DEJAR BATAS/);
            assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),0);
            assert.equal(await page.locator('details.haku-actualizacion-sites__pendiente').evaluate(el=>el.open),true);
            await page.evaluate(()=>window.confirm=()=>false);await incorporar.click();
            await page.waitForFunction(()=>!document.querySelector('[data-haku-accion="incorporar"]')?.disabled);
            assert.equal(await page.evaluate(()=>fixtureServicios.escrituras.length),0);
            await page.evaluate(()=>window.confirm=()=>true);await incorporar.click();
            await page.waitForFunction(()=>fixtureServicios.escrituras.length===1);
            const payload=await page.evaluate(()=>fixtureServicios.escrituras[0]);
            assert.equal(payload.p_servicios.length,1);assert.equal(payload.p_notas.length,0);assert.equal(payload.p_servicios[0].tipo_cobro,'cortesia');
            await out.getByText('Incorporación completada',{exact:true}).waitFor();
            assert.equal(await page.locator('details.haku-actualizacion-sites__pendiente').evaluate(el=>el.open),true);
            await page.close();
        }
        assert.deepEqual(errors,[]);assert.deepEqual(externos,[]);
        console.log('Historial manual: formulario directo, claro/oscuro 1100/390/320, cancelación y confirmación aislada OK');
    }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
