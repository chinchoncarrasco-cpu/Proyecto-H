// Edge headless, servidor loopback y cliente en memoria; toda red externa se aborta.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const {read,consultas,setup,agregarCasosAcumulados}=require('./fixtures/libro-medio-pago-manual.cjs');
const root=path.resolve(__dirname,'..'),externos=[],errores=[];
const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/') return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
        ['styles','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1','haiku-libro-pagos-ui-v1'].map(s=>'<link rel="stylesheet" href="/css/'+s+'.css">').join('')+
        '</head><body style="margin:0"><div class="haiku-asistente-root"><div class="haiku-asistente-panel"><header class="haiku-asistente-cabecera">Haku</header><div id="out" class="haiku-asistente-mensajes"></div></div></div></body></html>');
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)) return res.writeHead(403).end();
    try {res.writeHead(200,{'Content-Type':pathname.endsWith('.css')?'text/css':pathname.endsWith('.svg')?'image/svg+xml':'text/javascript'}).end(fs.readFileSync(file));}
    catch {res.writeHead(404).end();}
});
(async()=>{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    let browser;
    try {
        browser=await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
        for(const viewport of [{width:1100,height:950},{width:390,height:844}]) {
            const page=await browser.newPage({viewport});page.on('pageerror',e=>errores.push(e.message));
            await page.route('**/*',r=>{if(new URL(r.request().url()).hostname==='127.0.0.1') return r.continue();externos.push(r.request().url());return r.abort();});
            await page.goto('http://127.0.0.1:'+server.address().port);
            await page.evaluate(()=>window.HAIKU_LIBRO_RESERVA_V1={consultarHoja:async x=>x});
            for(const file of ['haiku-libro-semantica-v1','haiku-libro-pagos-destinos-v1','haiku-libro-pagos-canon-v1','haiku-libro-lenguaje-natural-v1']) await page.addScriptTag({content:read('js/'+file+'.js')});
            await page.addScriptTag({content:consultas});
            await page.addScriptTag({content:'const global=window,assert={equal(a,b){if(a!==b)throw Error(a+" != "+b)},fail(t){throw Error(t)}},S=HAIKU_LIBRO_SEMANTICA,C=HAIKU_LIBRO_PAGOS_CANON_V1,D=HAIKU_LIBRO_PAGOS_DESTINOS_V1,Q=HAIKU_LIBRO_CONSULTAS;'+setup});
            await page.addScriptTag({content:agregarCasosAcumulados.toString()});
            await page.evaluate(()=>{
                window.start=async servicio=>{
                    const h=entorno({distribuido:false,conServicios:false});window.h=h;window.haikuSupabase=h.db;
                    const estado=HAIKU_LIBRO_RESERVA_V1.estado;window.HAIKU_LIBRO_RESERVA_V1={estado:()=>({...estado(),version:'a'.repeat(64)})};
                    const p=h.r.pagos[0];p.medio_pago=null;p.texto_original+=' // '+(servicio?'PrePago / FC':'TDC');
                    p.evidencia_financiera={sector:'pagos',columnas_ocupadas:{detalle:true,concepto:true,monto:true,fecha:true}};
                    if(!servicio){p.tipo_movimiento='alojamiento';p.concepto='cab2/1noche';}
                    window.original=JSON.stringify(h.r);window.gate=false;window.release=null;window.inc=0;window.actions=0;
                    const render=plan=>{window.plan=plan;const out=document.createElement('div');document.getElementById('out').replaceChildren(out);Q.renderizarIncorporacion(out,plan,()=>{},aprobar,()=>window.inc++);};
                    const aprobar=async id=>{h.aprobados.add(id);render(await h.preparar());};
                    aprobar.manualPago=async(plan,id,accion)=>{window.actions++;if(window.gate)await new Promise(r=>window.release=r);const next=await h.resolver(plan,plan.items.find(i=>i.id===id),accion);Q.continuarVistaManualPago(plan,next,id,accion);render(next);};
                    render(await h.preparar());
                };
                window.startAcumulado=async()=>{
                    const h=agregarCasosAcumulados(entorno({distribuido:false,conServicios:false}));
                    window.h=h;h.Q=Q;window.haikuSupabase=h.db;window.inc=0;
                    const estado=HAIKU_LIBRO_RESERVA_V1.estado;
                    window.HAIKU_LIBRO_RESERVA_V1={estado:()=>({...estado(),version:'a'.repeat(64)})};
                    window.original=JSON.stringify(h.result.reservas);
                    const incorporar=async plan=>{const r=await Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,plan,h.db);window.inc++;return r;};
                    const render=plan=>{window.plan=plan;const out=document.createElement('div');document.getElementById('out').replaceChildren(out);Q.renderizarIncorporacion(out,plan,()=>{},aprobar,incorporar);};
                    const aprobar=async id=>{h.aprobados.add(id);render(await h.preparar());};
                    aprobar.manualPago=async(plan,id,accion)=>{
                        const next=await h.resolver(plan,plan.items.find(i=>i.id===id),accion);
                        Q.continuarVistaManualPago(plan,next,id,accion);render(next);
                    };
                    render(await h.preparar());
                };
            });
            await page.evaluate(()=>start(false));
            await page.locator('.haiku-incorporacion-seccion--dudosos > summary').click();
            await page.getByRole('button',{name:'Aprobación manual',exact:true}).click();
            await assert.equal(await page.getByRole('heading',{name:'Definir medio de pago',exact:true}).count(),1);
            const selector=page.getByLabel('Medio de pago',{exact:true}),cta=page.getByRole('button',{name:'Confirmar medio y revalidar',exact:true});
            assert.equal(await cta.isDisabled(),true);assert.equal(await selector.locator('option').count(),8);
            await selector.selectOption('tarjeta_credito');await page.getByRole('button',{name:'Cancelar revisión',exact:true}).click();
            assert.equal(await page.evaluate(()=>h.aprobados.size),0);
            await page.getByRole('button',{name:'Aprobación manual',exact:true}).click();assert.equal(await selector.inputValue(),'');
            await selector.selectOption('webpay_credito');
            const panel=page.locator('.haiku-incorporacion-manual-pago-panel:not([hidden])');
            const vista=await panel.evaluate(e=>{
                const copia=e.cloneNode(true);copia.style.margin='0';
                [...copia.querySelector('select').options].forEach(o=>o.toggleAttribute('selected',o.value===e.querySelector('select').value));
                return {html:copia.outerHTML,font:getComputedStyle(e).fontFamily,width:Math.min(486,innerWidth),scroll:e.scrollWidth,client:e.clientWidth};
            });
            assert.ok(vista.scroll<=vista.client+1);
            const preview=await browser.newPage({viewport:{width:vista.width,height:2000}});
            try {
                await preview.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
                await preview.setContent('<!doctype html><html><head><base href="'+page.url()+'">'+
                    ['styles','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1','haiku-libro-pagos-ui-v1'].map(s=>'<link rel="stylesheet" href="css/'+s+'.css">').join('')+
                    '</head><body style="display:block;margin:0;overflow:auto;width:100vw"><div class="haiku-asistente-root" style="position:static;width:100%;max-width:none">'+vista.html+'</div></body></html>');
                await preview.locator('body').evaluate((e,font)=>e.style.fontFamily=font,vista.font);
                await preview.locator('.haiku-incorporacion-manual-pago-panel').screenshot({path:path.join(require('node:os').tmpdir(),'haiku-medio-'+viewport.width+'.png')});
            } finally {await preview.close();}
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
            await page.evaluate(()=>window.gate=true);await cta.click();assert.equal(await cta.isDisabled(),true);
            await cta.dispatchEvent('click');assert.equal(await page.evaluate(()=>window.actions),1);
            await page.evaluate(()=>{window.gate=false;window.release();});
            await page.waitForFunction(()=>plan.items.find(i=>i.pagoLibro)?.medioPagoManual);
            await page.locator('.haiku-incorporacion-seccion--dudosos > summary').click();
            await page.getByRole('button',{name:'Aprobar este pago',exact:true}).waitFor();
            assert.equal(await page.getByRole('heading',{name:'Definir medio de pago',exact:true}).isVisible(),false);
            assert.deepEqual(await page.evaluate(()=>({aprobados:h.aprobados.size,selected:plan.items.filter(i=>i.pagoLibro).some(i=>i.seleccionado),original:JSON.stringify(h.r)===window.original,inc:window.inc})),{aprobados:0,selected:false,original:true,inc:0});
            await page.getByRole('button',{name:'Cambiar medio de pago',exact:true}).click();
            assert.equal(await selector.inputValue(),'');await page.getByRole('button',{name:'Cancelar revisión',exact:true}).click();
            assert.equal(await page.evaluate(()=>plan.items.find(i=>i.pagoLibro).pagoLibro.medio_pago),'webpay_credito');
            await page.evaluate(()=>start(true));await page.locator('.haiku-incorporacion-seccion--dudosos > summary').click();await page.getByRole('button',{name:'Aprobación manual',exact:true}).click();
            await page.getByLabel('Medio de pago',{exact:true}).selectOption('tarjeta_credito');await page.getByRole('button',{name:'Confirmar medio y revalidar',exact:true}).click();
            await page.waitForFunction(()=>plan.items.find(i=>i.pagoLibro)?.manualPago?.tipo==='crear_servicio_faltante');
            await page.locator('.haiku-incorporacion-seccion--dudosos > summary').click();
            await page.getByRole('button',{name:'Aprobación manual',exact:true}).click();
            assert.equal(await page.getByRole('heading',{name:'Asociar el servicio',exact:true}).count(),1);
            assert.equal(await page.evaluate(()=>h.llamadas.some(x=>x.nombre==='haiku_registrar_servicio')),false);
            // Flujo completo con dos evidencias: el servicio de B modifica el
            // snapshot mientras A ya está preparado. Sólo cliente en memoria.
            await page.evaluate(()=>startAcumulado());
            const abrirRevision=()=>page.locator('.haiku-incorporacion-seccion--dudosos').evaluate(e=>e.open=true);
            const a=page.locator('article[data-haiku-pago-origen-celda="C20:F20"]');
            const b=page.locator('article[data-haiku-pago-origen-celda="G40:J40"]');
            const comprobarA=async()=>assert.equal(await page.evaluate(()=>h.itemCaso(plan,'A').categoria),'pagos');
            await abrirRevision();await a.getByRole('button',{name:'Aprobación manual',exact:true}).click();
            await a.getByLabel('Medio de pago',{exact:true}).selectOption('tarjeta_credito');
            await a.getByRole('button',{name:'Confirmar medio y revalidar',exact:true}).click();
            await page.waitForFunction(()=>h.itemCaso(plan,'A').medioPagoManual);
            await abrirRevision();await a.getByRole('button',{name:'Aprobar este pago',exact:true}).click();
            await page.waitForFunction(()=>h.itemCaso(plan,'A').categoria==='pagos');
            await abrirRevision();await b.getByRole('button',{name:'Aprobación manual',exact:true}).click();
            await b.getByRole('button',{name:'Aprobación manual',exact:true}).click();await comprobarA();
            await b.getByRole('button',{name:'Aprobación manual',exact:true}).click();
            await b.getByLabel('Medio de pago',{exact:true}).selectOption('efectivo');
            await b.getByRole('button',{name:'Cancelar revisión',exact:true}).click();await comprobarA();
            await b.getByRole('button',{name:'Aprobación manual',exact:true}).click();
            await b.getByLabel('Medio de pago',{exact:true}).selectOption('tarjeta_debito');
            await b.getByRole('button',{name:'Confirmar medio y revalidar',exact:true}).click();
            await page.waitForFunction(()=>h.itemCaso(plan,'B').manualPago?.tipo==='crear_servicio_faltante');await comprobarA();
            await abrirRevision();await b.getByRole('button',{name:'Aprobación manual',exact:true}).click();
            await b.getByLabel('Aplicación a resolver',{exact:true}).selectOption('0');
            await b.getByLabel('Servicio del catálogo',{exact:true}).selectOption('tinajaTonel');
            await b.getByLabel('Fecha del servicio',{exact:true}).fill('2026-10-03');
            await b.getByLabel('Cantidad',{exact:true}).fill('1');
            await b.getByLabel('Precio unitario CLP',{exact:true}).fill('40000');
            await b.getByLabel('Personas',{exact:true}).fill('2');
            await b.getByLabel('Tipo de cobro',{exact:true}).selectOption('normal');
            await b.getByLabel('Confirmo el precio manual y el total exacto del Libro',{exact:true}).check();
            await b.getByRole('button',{name:'Guardar servicio y continuar',exact:true}).click();
            await page.waitForFunction(()=>h.itemCaso(plan,'B').manualPago?.tipo==='asociacion_pago');await comprobarA();
            await b.getByRole('button',{name:'Confirmar asociación y pago',exact:true}).click();
            await page.waitForFunction(()=>h.itemCaso(plan,'B').categoria==='pagos');await comprobarA();
            const preparados=page.locator('.haiku-incorporacion-seccion--pagos');
            assert.equal(await preparados.locator('summary .haku-incorporacion-sites-fila-cantidad').textContent(),'2');
            await preparados.evaluate(e=>e.open=true);
            await a.getByRole('checkbox',{name:'Seleccionar Kyleigh Laughlan',exact:true}).uncheck();
            await b.getByRole('checkbox',{name:'Seleccionar Joseph Vargas',exact:true}).uncheck();
            assert.equal(await page.evaluate(()=>Q.serializarIncorporacion(plan).length),0);
            await page.getByRole('button',{name:'Seleccionar todo lo listo',exact:true}).click();
            assert.equal(await a.getByRole('checkbox',{name:'Seleccionar Kyleigh Laughlan',exact:true}).isChecked(),true);
            assert.equal(await b.getByRole('checkbox',{name:'Seleccionar Joseph Vargas',exact:true}).isChecked(),true);
            const payload=await page.evaluate(()=>Q.serializarIncorporacion(plan));
            assert.equal(payload.length,2);assert.equal(new Set(payload.map(i=>i.item_id)).size,2);
            assert.deepEqual(payload.map(i=>[i.datos_origen.medio_pago_manual_v1.medio,i.datos_origen.medio_pago_manual_v1.origen.celda]),
                [['tarjeta_credito','C20:F20'],['tarjeta_debito','G40:J40']]);
            assert.equal(await page.evaluate(()=>JSON.stringify(h.result.reservas)===window.original),true);
            page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Continuar con 2 elementos listos',exact:true}).click();
            await page.waitForFunction(()=>window.inc===1);
            assert.equal(await page.evaluate(()=>h.registrados.length),2);
            assert.equal(await page.evaluate(()=>h.tablas.pagos.length),2);
            await page.close();
        }
        assert.deepEqual(externos,[]);assert.deepEqual(errores,[]);
        console.log('OK · desktop/móvil: medio manual, cancelar, doble clic y Kyleigh + Joseph acumulados tras crear/asociar servicio; seleccionar todo e incorporar dos pagos únicos con auditoría y cero red remota.');
    } finally {await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
