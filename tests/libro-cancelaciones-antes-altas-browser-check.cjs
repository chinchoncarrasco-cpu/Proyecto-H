// Flujo y UI reales en Chromium. Base, RPC y personas ficticias; sólo localhost.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),F=require('./fixtures/libro-comparacion-readonly.cjs');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sample=F.caso('cancelacion-previa',(_r,db,hoja)=>{
    db.reserva_estadias=[];db.reservas=[];
    const e={id:'estadia-anterior',reserva_id:'reserva-anterior',cabana_id:'cab-7',fecha_ingreso:'2026-10-03',
        fecha_salida:'2026-10-05',tipo_estadia:'alojamiento',estado_estadia:'confirmada',cabanas:{numero:7}};
    db.reserva_estadias.push({...e,reservas:{id:'reserva-anterior',titular_nombre:'Persona Anterior Ficticia',estado_reserva:'confirmada'}});
    db.reservas.push({id:'reserva-anterior',titular_nombre:'Persona Anterior Ficticia',estado_reserva:'confirmada',estadias:[e]});
    hoja.cancelaciones.push({titular:'Persona Anterior Ficticia',fecha_checkin:'2026-10-03',noches:2,bloque:'CANCELACIONES',origen:F.origen('CC15')});
});
const styles=['styles','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1','haiku-tema-oscuro-v1'];
const server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname.slice(1),file=path.resolve(root,name);
    if(!name)return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html></html>');
    if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
    try{res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css':'application/octet-stream'}).end(fs.readFileSync(file));}
    catch{res.writeHead(404).end();}
});
(async()=>{
    await new Promise(ok=>server.listen(0,'127.0.0.1',ok));let browser;
    try{
        browser=await chromium.launch({executablePath:process.env.HAIKU_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
        const origin='http://127.0.0.1:'+server.address().port,errors=[],external=[];
        const shots=process.env.HAIKU_CANCELACION_SHOTS||'/tmp/haku-cancelacion-orden';fs.mkdirSync(shots,{recursive:true});
        for(const width of [390,1440])for(const theme of ['claro','oscuro'])for(const mode of ['disponibilidad','fuente','red']){
            const context=await browser.newContext({viewport:{width,height:900}});
            await context.route('**/*',route=>{const url=route.request().url();if(new URL(url).origin===origin)return route.continue();external.push(url);return route.abort();});
            const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
            await page.setContent(`<!doctype html><html lang="es" data-haiku-tema="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1">
                ${styles.map(s=>`<link rel="stylesheet" href="${origin}/css/${s}.css">`).join('')}</head><body>
                <div class="haiku-asistente-root"><div id="haiku-asistente-panel" class="haiku-asistente-panel">
                <header class="haiku-asistente-cabecera">Haku · Asistente operativo<button id="haiku-asistente-cerrar">Cerrar</button></header>
                <div id="haiku-asistente-mensajes" class="haiku-asistente-mensajes"><div id="respuesta"></div></div>
                <footer class="haiku-asistente-compositor"><input id="haiku-asistente-texto"><button id="haiku-asistente-enviar">Enviar</button></footer></div></div></body></html>`);
            await page.evaluate(({data,db,source,mode})=>{
                const copy=x=>structuredClone(x);window.__data=data;window.__calls=[];window.__mode=mode;window.__generation=1;
                window.haikuSupabase=eval('('+source+')')(db);let attempts=0;
                window.haikuSupabase.rpc=async(name,args)=>{
                    if(name==='haiku_libro_cancelacion_segura_lote_v1'){
                        if(!args.p_confirmar)return {data:{estado:'listo'}};
                        __calls.push({tipo:'cancelacion'});
                        if(__mode==='fuente'){
                            __generation++;__data.reservas[0].fecha_checkout='2026-10-06';__data.reservas[0].noches=3;
                            __data.reservas[0].fechas_ocupadas.push('2026-10-05');
                        }
                        return {data:{estado:'cancelada'}};
                    }
                    if(name!=='haiku_incorporar_libro_v1')throw Error('RPC no permitido');
                    __calls.push({tipo:'altas',operacion:args.p_operacion_id});attempts++;
                    if(__mode==='disponibilidad')return {error:{code:'P0001',message:'La CAB 1 no está disponible para esa fecha o rango'}};
                    if(attempts===1)return {error:{message:'Respuesta de red perdida'}};
                    return {data:{ok:true,reservas_creadas:1,resultados:[]}};
                };
                window.haikuTienePermiso=()=>true;window.HAIKU_ASISTENTE={abierta:()=>true,procesando:()=>false};
                window.HAIKU_DIALOGOS={confirmar:async()=>true};
                const estado=()=>({cargado:true,generacion:__generation,version:'fixture-'+__generation});
                window.HAIKU_LIBRO_RESERVA_V1={listo:async()=>{},estado,
                    crearLectura:async()=>{const fijo=estado(),hoja=structuredClone(__data);return {
                        estado:()=>fijo,listarHojas:()=>['Oct26'],consultarHojas:async()=>[hoja]};},
                    listarHojas:()=>['Oct26'],consultarHoja:async()=>structuredClone(__data)};
            },{data:sample.data,db:sample.db,source:F.cliente.toString(),mode});
            for(const name of ['haiku-libro-semantica-v1','haiku-fullday-tarifa-v1','haiku-libro-pagos-canon-v1',
                'haiku-libro-lenguaje-natural-v1','haiku-libro-pagos-destinos-v1','haiku-libro-consultas-v1','haiku-libro-cancelaciones-v1'])
                await page.addScriptTag({content:read('js/'+name+'.js')});
            await page.evaluate(async()=>{
                const Q=HAIKU_LIBRO_CONSULTAS,q={desde:'2026-10-01',hasta:'2026-10-31',incluirFinanzas:false};
                const comparacion=await Q.compararSistema(__data.reservas,haikuSupabase,q);
                const cancelaciones=await HAIKU_LIBRO_CANCELACIONES_V1.detectarActual(__data,haikuSupabase);
                await Q.abrirPreparacionComparacion(document.getElementById('respuesta'),{reservas:structuredClone(__data.reservas),q,generacion:1,comparacion,...cancelaciones});
            });
            const submit=page.getByRole('button',{name:/^Incorporar todo lo seguro/});await submit.click();
            await page.waitForFunction(()=>document.querySelector('.haku-incorporacion-cambios-parciales')?.textContent.includes('Persona Anterior Ficticia'));
            assert.match(await page.locator('#respuesta').innerText(),/1 cancelación ya confirmada/);
            assert.deepEqual(await page.evaluate(()=>__calls.map(x=>x.tipo)),mode==='fuente'?['cancelacion']:['cancelacion','altas']);
            const back=page.getByRole('button',{name:'Volver',exact:true});
            if(mode!=='red'){
                assert.equal(await back.isEnabled(),true);
                await page.getByRole('button',{name:'Volver a comparar con datos actuales',exact:true}).waitFor();
                assert.equal(await page.getByRole('button',{name:'Reintentar confirmación',exact:true}).count(),0);
                await page.locator('.haku-incorporacion-cambios-parciales summary').click();
                assert.equal(await page.locator('.haku-incorporacion-cambios-parciales .haku-incorporacion-final-item-cabecera').evaluate(el=>getComputedStyle(el).display),'flex');
                if(mode==='disponibilidad')await page.locator('.haku-incorporacion-sites-preparacion').screenshot({path:path.join(shots,`${width}-${theme}.png`)});
            }else{
                assert.equal(await back.isEnabled(),false,'una respuesta de red incierta conserva la operación');
                await page.getByRole('button',{name:'Reintentar confirmación',exact:true}).click();
                await page.getByText('Incorporación completada',{exact:true}).waitFor();
                const calls=await page.evaluate(()=>__calls);assert.deepEqual(calls.map(x=>x.tipo),['cancelacion','altas','altas']);
                assert.equal(calls[1].operacion,calls[2].operacion);
                assert.match(await page.locator('#respuesta').innerText(),/Cambios detectados incorporados/);
            }
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
            await context.close();
        }
        assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
        console.log('PASS: cancelación antes de altas; recibo parcial real; disponibilidad permite volver; red conserva operación; 390/1440, claro/oscuro, cero tráfico externo.');
    }finally{await browser?.close();await new Promise(ok=>server.close(ok));}
})().catch(error=>{console.error(error);process.exitCode=1;});
