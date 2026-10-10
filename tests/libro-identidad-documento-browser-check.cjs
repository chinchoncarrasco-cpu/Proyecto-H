// UI real y cliente sintético: todas las conexiones externas están bloqueadas.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),fixture=require('./fixtures/libro-identidad-documento.cjs');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const api='Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
const source=read('js/haiku-libro-consultas-v1.js');assert.ok(source.includes(api));
const scripts={'/semantica.js':read('js/haiku-libro-semantica-v1.js'),'/consultas.js':source.replace(api,api.replace(' })',', renderizarComparacion, renderizarIncorporacion })'))};
const css=['css/styles.css','css/supabase-asistente-v1.css','css/sites-asistente-v1.css','css/supabase-haku-reconciliacion-v1.css'].map(read).join('\n');
const server=http.createServer((req,res)=>{
    if(scripts[req.url]) return res.writeHead(200,{'Content-Type':'application/javascript;charset=utf-8'}).end(scripts[req.url]);
    res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><main style="max-width:920px;margin:auto;padding:8px"><div id="out"></div></main><script src="/semantica.js"></script><script src="/consultas.js"></script></body></html>`);
});
(async()=>{
    await new Promise(ok=>server.listen(0,'127.0.0.1',ok));let browser;
    try {
        browser=await chromium.launch({executablePath:process.env.HAIKU_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
        const origin='http://127.0.0.1:'+server.address().port;
        for(const width of [1100,390]) {
            const context=await browser.newContext({viewport:{width,height:850}}),externos=[],errores=[];
            await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin) return route.continue();externos.push(route.request().url());return route.abort()});
            const page=await context.newPage();page.on('pageerror',e=>errores.push(e.message));await page.goto(origin);
            await page.evaluate(async f=>{
                const Q=window.HAIKU_LIBRO_CONSULTAS;window.__calls=[];window.confirm=()=>true;
                window.haikuSupabase={auth:{getSession:async()=>({data:{session:{user:{id:'ficticio'}}}})},from(table){
                    const data=table==='reserva_estadias'?f.estadias:[];
                    const b={select(){return b},lte(){return b},gte(){return b},in(){return b},order(){return b},range(a,z){return Promise.resolve({data:data.slice(a,z+1)})}};return b;
                },async rpc(name,args){window.__calls.push({name,args});return {error:{code:'23505',
                    message:'duplicate key value violates unique constraint "huespedes_documento_uidx"',details:'Documento FICTICIO-PRIVADO'}}}};
                const comp=await Q.compararSistema(f.reservas,window.haikuSupabase,f.q),decisiones=new Map();
                for(const g of comp.grupos){const s=f.estadias.find(s=>s.cabanas.numero===g.items[0].libro.cabana);if(s) decisiones.set(g.clave,{valor:'asociar:'+s.id})}
                const result={reservas:f.reservas,q:f.q,comparacion:comp};
                window.__plan=await Q.prepararIncorporacion(result,decisiones,new Set(),window.haikuSupabase);
                Q.renderizarIncorporacion(document.getElementById('out'),window.__plan,()=>{window.__recomparar=true},()=>{},p=>Q.confirmarIncorporacion(result,decisiones,new Set(),p,window.haikuSupabase));
                window.__abrirComparacion=()=>Q.renderizarComparacion(document.getElementById('out'),result,{decisiones,aprobados:new Set()});
            },fixture());
            await page.getByRole('button',{name:'Actualizar titular y RUT',exact:true}).click();
            await page.getByRole('button',{name:'Volver a comparar con datos actuales',exact:true}).waitFor();
            assert.match(await page.locator('#out').innerText(),/No se guardó nada.*revisión manual/);
            assert.ok(!(await page.locator('#out').innerText()).includes('FICTICIO-PRIVADO'));
            assert.equal(await page.evaluate(()=>window.__plan.solicitudPendiente),null);
            const fallidas=await page.evaluate(()=>window.__calls);assert.equal(fallidas.length,1);
            assert.ok(fallidas[0].args.p_items.every(i=>i.tipo==='reserva_actualizar'));
            // El flujo de preparación/confirmación que usa Haku, incluidos sus callbacks.
            await page.evaluate(()=>{window.__calls=[];window.__abrirComparacion();window.haikuSupabase.rpc=async(name,args)=>{
                window.__calls.push({name,args});return {data:{ok:true,reservas_creadas:2,pagos_creados:0,resultados:[]}}
            }});
            await page.getByRole('button',{name:'Preparar incorporación',exact:true}).click();
            const nuevas=page.locator('.haiku-incorporacion-seccion--nuevas input[type=checkbox]');assert.equal(await nuevas.count(),2);
            await page.locator('.haiku-incorporacion-seccion--actualizaciones > summary').click();
            const seleccionadas=page.locator('.haiku-incorporacion-seccion--actualizaciones input[type=checkbox]:checked');
            while(await seleccionadas.count()) await seleccionadas.first().uncheck();
            await page.locator('.haiku-incorporacion-seccion--nuevas > summary').click();
            for(const checkbox of await nuevas.all()){assert.equal(await checkbox.isEnabled(),true);await checkbox.check()}
            assert.equal(await page.locator('.haiku-incorporacion-seccion--dudosos input[type=checkbox]:checked').count(),0);
            await page.getByRole('button',{name:'Continuar con 2 elementos listos',exact:true}).click();
            await page.waitForFunction(()=>window.__calls.length===1&&!document.querySelector('[aria-busy=true]'));
            await page.getByText('Paso 1 de 2 · Actualizar titular y RUT',{exact:true}).waitFor();
            const enviadas=await page.evaluate(()=>window.__calls);assert.equal(enviadas.length,1);
            assert.equal(enviadas[0].name,'haiku_incorporar_libro_v1');assert.deepEqual(enviadas[0].args.p_items.map(i=>i.tipo),['reserva_nueva','reserva_nueva']);
            assert.ok(!await page.getByText('Titular y RUT actualizados.',{exact:false}).count());
            assert.deepEqual(externos,[]);assert.deepEqual(errores,[]);
            console.log(JSON.stringify({width,resultado:'PASS',conflicto:'HLI01',altas_independientes:2,pagos_enviados:0,rpc_externos:0}));
            await context.close();
        }
    } finally {await browser?.close();await new Promise(ok=>server.close(ok))}
})().catch(e=>{console.error(e);process.exitCode=1});
