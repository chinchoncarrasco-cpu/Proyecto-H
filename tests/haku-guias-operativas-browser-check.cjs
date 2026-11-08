const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),capturasDir=path.join(process.env.RUNNER_TEMP||require('node:os').tmpdir(),'haku-guias-capturas');let falloInicial=true,cargasGuia=0;
fs.mkdirSync(capturasDir,{recursive:true});
const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost'),name=url.pathname;
    if(name==='/')return res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html><html lang="es"><head>
        <meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8">
        <link rel="stylesheet" href="/css/styles.css"><link rel="stylesheet" href="/css/supabase-asistente-v1.css">
        <link rel="stylesheet" href="/css/supabase-haku-reconciliacion-v1.css">
        <link rel="stylesheet" href="/css/sites-asistente-v1.css"><link rel="stylesheet" href="/css/haiku-tema-oscuro-v1.css">
        <link rel="stylesheet" href="/css/haiku-tema-v1.css"></head><body><main>Panel de prueba</main>
        <script src="/js/supabase-asistente-v1.js?v=guias-test"></script><script src="/js/supabase-asistente-historial-v1.js"></script></body></html>`);
    if(name==='/js/haiku-guias-operativas-v1.js'){
        cargasGuia++;
        if(falloInicial){falloInicial=false;return res.writeHead(503).end('Fallo transitorio de prueba');}
    }
    if(/^\/js\/haiku-libro-(historial-ui-fix|confirm-cancel-fix)-v1\.js$/.test(name))return res.writeHead(200,{'Content-Type':'text/javascript'}).end('');
    const file=path.resolve(root,'.'+name);
    if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
    const tipo={'.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.js':'text/javascript'}[path.extname(name)]||'application/octet-stream';
    try{res.writeHead(200,{'Content-Type':tipo}).end(fs.readFileSync(file));}
    catch{res.writeHead(404).end();}
});
(async()=>{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    try{
        const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[],externas=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.route('**/*',route=>{
            if(new URL(route.request().url()).hostname!=='127.0.0.1'){externas.push(route.request().url());return route.abort();}
            return route.continue();
        });
        await page.addInitScript(()=>{
            window.haikuSesion={usuario:{id:'usuario-prueba'}};
            window.__calls=[];window.__writes=[];window.__pending=[];
            window.haikuSupabase={auth:{onAuthStateChange(){}},
                functions:{invoke(name,args){__calls.push({name,args});return new Promise(resolve=>__pending.push(resolve));}},
                rpc(...args){__writes.push(args);throw Error('No debe registrar datos');}};
            window.alert=()=>{};window.confirm=()=>true;
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.locator('#haiku-asistente-boton').click();
        const input=page.locator('#haiku-asistente-texto'),rapidas=page.locator('#haiku-asistente-rapidas');
        const accion=async id=>{if(!await rapidas.evaluate(e=>e.open))await rapidas.locator('summary').click();await rapidas.locator(`[data-haiku-accion-rapida="${id}"]`).click();};
        await input.fill('Mi consulta de reserva pendiente');
        await page.locator('#haiku-asistente-archivos').setInputFiles({name:'captura-sintetica.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])});
        await accion('ingresos-manager');
        await page.getByText('No pude abrir la guía. Pulsa la acción rápida para reintentar.',{exact:true}).waitFor();
        assert.equal(await input.inputValue(),'Mi consulta de reserva pendiente');
        await accion('ingresos-manager');
        const manager=page.locator('.haku-guia-operativa[data-haku-guia-grupo="manager"]');
        await manager.waitFor();assert.equal(await manager.locator('.haku-guia__opcion').count(),10);
        await manager.screenshot({path:path.join(capturasDir,'manager-menu.png')});
        assert.equal(cargasGuia,2,'reintento del módulo sin otra consulta');
        assert.equal(await page.evaluate(()=>HAIKU_ASISTENTE.adjuntos().length),1);
        assert.equal(await page.evaluate(()=>__calls.length),0);
        // Recorrer todas las variantes y verificar que el final nunca afirma un guardado.
        const opciones=await manager.locator('.haku-guia__opcion').evaluateAll(items=>items.map(e=>e.getAttribute('aria-label')));
        for(const nombre of opciones){
            await manager.getByRole('button',{name:new RegExp('^'+nombre.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();
            assert.ok(await manager.locator('.haku-guia__cuerpo').isVisible());
            let pasos=0;
            while(await manager.getByRole('button',{name:'Siguiente',exact:true}).count()){
                await manager.getByRole('button',{name:'Siguiente',exact:true}).click();assert.ok(++pasos<10);
            }
            await manager.getByRole('button',{name:'Terminar guía',exact:true}).click();
            assert.match(await manager.innerText(),/Fin de la guía.*No confirman que el pago o la reserva/s);
            await manager.getByRole('button',{name:'← Opciones',exact:true}).click();
        }
        await manager.getByRole('button',{name:/^Agregar transferencia/}).click();
        await manager.getByRole('button',{name:'Siguiente',exact:true}).click();
        assert.match(await manager.innerText(),/ARE.*Haber/s);
        // El guía y los campos conservan su espacio en ambos temas, hasta 320 px.
        for(const tema of ['claro','oscuro']){
            await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
            for(const width of [1100,390,320]){
                await page.setViewportSize({width,height:900});
                assert.equal(await manager.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,`${tema} ${width}: guía sin desborde`);
                assert.equal(await page.locator('#haiku-asistente-panel').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
                const next=manager.getByRole('button',{name:'Siguiente',exact:true});
                await page.mouse.move(0,0);
                const fondo=await next.evaluate(e=>getComputedStyle(e).backgroundColor);
                await next.hover();
                assert.equal(await next.evaluate(e=>getComputedStyle(e).backgroundColor),fondo,'el hover conserva el fondo que contrasta con el texto');
                await manager.getByRole('button',{name:'Siguiente',exact:true}).focus();
                await page.keyboard.press('Enter');
                assert.match(await manager.innerText(),/ABB\$/);
                await manager.getByRole('button',{name:'Anterior',exact:true}).click();
            }
        }
        await page.locator('#haiku-asistente-cerrar').click();
        await page.locator('#haiku-asistente-boton').click();
        await accion('ingresos-manager');
        assert.equal(await manager.count(),1);assert.equal(await manager.getAttribute('data-haku-guia-paso'),'1');
        assert.equal(await input.inputValue(),'Mi consulta de reserva pendiente');
        // Una consulta real queda en vuelo mientras se abre el menú de reservas.
        await page.locator('.haiku-asistente-quitar').click();
        await input.fill('Revisa esta reserva sintética');await page.locator('#haiku-asistente-enviar').click();
        await page.waitForFunction(()=>__pending.length===1);
        await accion('proceso-reservas');
        const reservas=page.locator('.haku-guia-operativa[data-haku-guia-grupo="reservas"]');
        await reservas.getByRole('button',{name:/^Procesar una reserva completa/}).click();
        for(let i=0;i<3;i++)await reservas.getByRole('button',{name:'Siguiente',exact:true}).click();
        assert.equal(await reservas.locator('.haku-guia__medios button').count(),6);
        await reservas.getByRole('button',{name:'WebPay',exact:true}).click();
        assert.match(await reservas.innerText(),/Comprobar el aviso WebPay/);
        assert.equal(await page.evaluate(()=>__pending.length),1,'la consulta no se cancela');
        assert.equal(await page.evaluate(()=>__calls.length),1,'guías sin invocar otro análisis');
        await page.evaluate(()=>__pending.shift()({data:null,error:{message:'Consulta de prueba completada'}}));
        await page.waitForFunction(()=>!HAIKU_ASISTENTE.procesando());
        assert.match(await reservas.innerText(),/Comprobar el aviso WebPay/);
        // Una actualización del Libro no inserta respuestas ni desplaza la guía abierta.
        const mensajesAntes=await page.locator('#haiku-asistente-mensajes > *').count();
        await page.evaluate(()=>{
            window.HAIKU_LIBRO_RESERVA_V1={estado:()=>({generacion:2})};
            window.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1={procesando:()=>false,obtenerResultado:async()=>({estado:'sin_cambios'})};
        });
        await page.addScriptTag({url:'/js/supabase-asistente-libro-auto-v1.js'});
        await page.evaluate(()=>window.dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{
            detail:{carga_automatica:true,tenia_anterior:true,generacion:2}
        })));
        await page.locator('.haku-libro-auto').getByRole('button',{name:'Seguir con mi consulta',exact:true}).waitFor();
        assert.equal(await page.locator('#haiku-asistente-mensajes > *').count(),mensajesAntes);
        assert.match(await reservas.innerText(),/Comprobar el aviso WebPay/);
        await page.locator('.haku-libro-auto').getByRole('button',{name:'Seguir con mi consulta',exact:true}).click();
        // Cambiar el medio dentro del recorrido sustituye sólo sus pasos.
        await reservas.getByRole('button',{name:'Anterior',exact:true}).click();
        await reservas.getByRole('button',{name:'Transferencia',exact:true}).click();
        assert.match(await reservas.innerText(),/Verificar la transferencia en el banco/);
        let guard=0;
        while(await reservas.getByRole('button',{name:'Siguiente',exact:true}).count()){
            await reservas.getByRole('button',{name:'Siguiente',exact:true}).click();assert.ok(++guard<20);
        }
        assert.match(await reservas.innerText(),/Enviar confirmación del pago/);
        await reservas.getByRole('button',{name:'Terminar guía',exact:true}).click();
        // Persistencia: la guía se rehidrata; los botones de operaciones anteriores siguen bloqueados.
        await page.evaluate(()=>{
            const anterior=document.createElement('div');anterior.className='haiku-asistente-preview';
            const b=document.createElement('button');b.textContent='Operación anterior de prueba';anterior.append(b);
            document.getElementById('haiku-asistente-mensajes').append(anterior);
            HAIKU_ASISTENTE_HISTORIAL_V1.guardar();
        });
        await page.reload();await page.locator('#haiku-asistente-boton').click();
        await manager.getByRole('button',{name:'Siguiente',exact:true}).waitFor({state:'visible'});
        await page.waitForFunction(()=>!document.querySelector('.haku-guia-operativa button')?.disabled);
        assert.equal(await manager.getAttribute('data-haku-guia-paso'),'1');
        await manager.getByRole('button',{name:'Siguiente',exact:true}).click();assert.match(await manager.innerText(),/ABB\$/);
        assert.equal(await page.getByRole('button',{name:'Operación anterior de prueba',exact:true}).isDisabled(),true);
        assert.match(await reservas.innerText(),/Fin de la guía/);
        await reservas.getByRole('button',{name:'Volver a los pasos',exact:true}).click();
        assert.match(await reservas.innerText(),/Verificar el correo/);
        // Capturas reales: rutas locales, ampliación y teclado.
        const capturas=await page.evaluate(()=>Object.values(HAIKU_GUIAS_OPERATIVAS_V1.guias).flatMap(g=>g.pasos.flatMap(p=>HAIKU_GUIAS_OPERATIVAS_V1.imagenesDe(p))).map(r=>r.archivo));
        for(const archivo of new Set(capturas)){
            const response=await page.request.get(new URL('/assets/guias/'+archivo,page.url()).href);
            assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/^image\//);
        }
        await reservas.getByRole('button',{name:'← Opciones',exact:true}).click();
        await reservas.getByRole('button',{name:'Subir pago a Cloudbeds',exact:true}).click();
        const mini=reservas.getByRole('button',{name:'Ampliar captura: Añadir pago',exact:true});
        await mini.scrollIntoViewIfNeeded();
        await mini.locator('img').evaluate(img=>img.decode());
        const estado=await reservas.getAttribute('data-haku-guia-paso');
        for(const tema of ['claro','oscuro']){
            await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
            for(const width of [1100,390,320]){
                await page.setViewportSize({width,height:900});
                if(width===390)await reservas.screenshot({path:path.join(capturasDir,'cloudbeds-'+tema+'.png')});
                await mini.click();
                const modal=page.getByRole('dialog',{name:'Captura del manual'});
                await modal.locator('img').evaluate(img=>img.decode());
                assert.equal(await modal.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
                assert.equal(await modal.locator('img').evaluate(img=>img.naturalWidth>0&&getComputedStyle(img).objectFit==='contain'),true);
                await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});
                assert.equal(await page.locator('#haiku-asistente-panel').isVisible(),true,'Escape cierra sólo la captura');
                assert.equal(await mini.evaluate(e=>e===document.activeElement),true);
                assert.equal(await reservas.getAttribute('data-haku-guia-paso'),estado);
            }
        }
        await reservas.getByRole('button',{name:'← Opciones',exact:true}).click();
        await reservas.getByRole('button',{name:'Procesar pago Booking',exact:true}).click();
        for(let i=0;i<2;i++)await reservas.getByRole('button',{name:'Siguiente',exact:true}).click();
        assert.equal(await reservas.locator('.haku-guia__captura').count(),4);
        await reservas.screenshot({path:path.join(capturasDir,'booking-galeria.png')});
        await reservas.locator('.haku-guia__captura').first().click();
        const galeria=page.getByRole('dialog',{name:'Captura del manual'});
        await page.keyboard.press('ArrowRight');assert.match(await galeria.locator('strong').innerText(),/Hotel/);
        await galeria.getByRole('button',{name:'Siguiente',exact:true}).click();assert.match(await galeria.locator('strong').innerText(),/Check-in/);
        await galeria.getByRole('button',{name:'Cerrar',exact:true}).click();
        assert.equal(await reservas.getAttribute('data-haku-guia-paso'),'2');
        // Fallo de imagen no bloquea el paso ni inventa una captura.
        await page.route('**/assets/guias/terminal-hotel.jpg',route=>route.abort());
        await reservas.locator('.haku-guia__captura').nth(1).click();
        await page.getByRole('dialog').getByText('No se pudo cargar la captura. Puedes continuar con los pasos.').waitFor();
        await page.keyboard.press('Escape');
        await reservas.getByRole('button',{name:'Siguiente',exact:true}).click();
        assert.match(await reservas.innerText(),/Completar Check-out/);
        assert.equal(await page.evaluate(()=>__writes.length),0);assert.equal(await page.evaluate(()=>__calls.length),0);
        assert.deepEqual(externas,[]);assert.deepEqual(errors,[]);
        console.log('Guías Haku: menús, variantes, temas, móvil, teclado, reintento, consulta en curso e historial OK');
    }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
