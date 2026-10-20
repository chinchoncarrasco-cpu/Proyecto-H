// Cargador panel.html, consulta mensual, renderer e inspector reales.
// Los límites de Auth/Libro/Supabase usan fixtures: no sustituye la sesión productiva.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),solicitudes=[];
const modulos=new Set(['supabase-client','supabase-auth-menu-v1','supabase-asistente-v1','supabase-reserva-estados-v1',
    'haiku-libro-semantica-v1','haiku-fullday-tarifa-v1','haiku-libro-pagos-canon-v1','haiku-libro-lenguaje-natural-v1',
    'haiku-libro-pagos-destinos-v1','haiku-libro-consultas-v1','haiku-libro-cancelaciones-v1','haiku-libro-reconciliacion-ux-v1',
    'haiku-panel-coordinacion-v1','sites-resumen-drawer-v1','sites-resumen-reserva-v1','supabase-ficha-v2']);
function sdkFixture(){
    const id='11111111-1111-4111-8111-111111111111',user={id:'operador-fixture'};
    const row={id,titular_nombre:'Huésped integración local',correo_contacto:'integracion@example.test',estado_reserva:'confirmada',
        estadias:[{id:'22222222-2222-4222-8222-222222222222',reserva_id:id,cabana_id:'cab-7',fecha_ingreso:'2026-10-01',fecha_salida:'2026-10-03',
            estado_estadia:'confirmada',tipo_estadia:'alojamiento',cabanas:{numero:7}}]};
    const hoja={hoja:'Oct26',reservas:[],bloqueos:[],aseos:[],espacios:[],anotaciones:[],advertencias:[],cobertura:{geometria:true},
        cancelaciones:[{bloque:'CANCELACIONES',titular:row.titular_nombre,fecha_checkin:'2026-10-01',noches:2,correo:row.correo_contacto,origen:{hoja:'Oct26',celda:'D16'}}]};
    const control=window.__cancelacionIntegracion={row,hoja,rpc:[],lecturas:[],escenario:'exito'};
    const cliente={
        auth:{getSession:async()=>({data:{session:{user}}}),getUser:async()=>({data:{user}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
        from(tabla){
            control.lecturas.push(tabla);let unica=false;
            const datos=()=>tabla==='reservas'?[structuredClone(row)]:tabla==='reserva_estadias'?row.estadias.map(e=>({...e,reservas:{...row,estadias:undefined}})):[];
            const resultado=()=>({data:unica?(datos()[0]||null):datos(),error:null});
            const q={then:(ok,no)=>Promise.resolve(resultado()).then(ok,no),range:async()=>resultado(),single(){unica=true;return q;},maybeSingle(){unica=true;return q;}};
            for(const name of ['select','eq','neq','in','gte','lte','gt','lt','or','is','order','limit'])q[name]=()=>q;
            return q;
        },
        async rpc(nombre,args){
            control.rpc.push({nombre,args});
            if(nombre==='haiku_cancelar_reserva'){
                if(control.escenario==='error')return {error:{message:'Fallo de escritura de fixture'}};
                row.estado_reserva='cancelada';row.estadias[0].estado_estadia='cancelada';return {data:{ok:true}};
            }
            if(nombre==='haiku_reserva_detalle')return {data:{reserva:structuredClone(row),estadias:structuredClone(row.estadias),pagos:[],servicios:[],notas:[]}};
            return {data:[]};
        },
        functions:{invoke:async()=>({error:{message:'No se admite IA remota en esta prueba'}})}
    };
    window.supabase={createClient:()=>cliente};
    window.haikuSesion={usuario:{id:user.id,nombre:'Operador fixture',rol:'administrador'},auth:user};
    window.haikuTienePermiso=()=>true;
    window.HAIKU_PRIVACIDAD={estado:()=>({modo:'visible',armado:true})};
    window.HAIKU_LIBRO_RESERVA_V1={listo:async()=>{},estado:()=>({cargado:true,generacion:1,nombre:'Fixture integrado.xlsx'}),
        listarHojas:()=>['Oct26'],consultarHoja:async()=>structuredClone(hoja)};
}
const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost'),nombre=decodeURIComponent(url.pathname.slice(1));solicitudes.push(url.pathname+url.search);
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'");
    if(nombre==='__sdk.js')return res.writeHead(200,{'Content-Type':'application/javascript'}).end(`(${sdkFixture.toString()})();`);
    const file=path.resolve(root,nombre);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
    const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.js':'application/javascript;charset=utf-8','.css':'text/css;charset=utf-8'})[ext]||'application/octet-stream');
    if(ext==='.js'&&!modulos.has(path.basename(file,'.js')))return res.end('/* Módulo ajeno a este smoke test. */');
    let body=fs.readFileSync(file);
    if(nombre==='panel.html')body=body.toString('utf8').replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','/__sdk.js');
    res.end(body);
});
(async()=>{
    await new Promise(ok=>server.listen(0,'127.0.0.1',ok));let browser;
    try{
        browser=await chromium.launch({executablePath:process.env.HAIKU_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
        const origin='http://127.0.0.1:'+server.address().port;
        for(const width of [320,390,1100]){
            const context=await browser.newContext({viewport:{width,height:900},timezoneId:'America/Santiago'}),externos=[],errores=[];
            await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();externos.push(route.request().url());return route.abort();});
            const page=await context.newPage();page.on('pageerror',e=>errores.push(e.message));await page.goto(origin+'/panel.html');
            await page.waitForFunction(()=>window.HAIKU_ASISTENTE&&window.HAIKU_LIBRO_CANCELACIONES_V1&&window.HAIKU_INSPECTOR_V1);
            await page.locator('#haiku-asistente-boton').click();
            await page.locator('#haiku-asistente-texto').fill('Libro: compara octubre 2026 con Proyecto H');await page.locator('#haiku-asistente-enviar').click();
            const preparar=page.getByRole('button',{name:/^Preparar cancelación/});await preparar.waitFor();
            assert.ok(solicitudes.some(s=>s==='/css/haiku-libro-decision-cards-v1.css?v=2'));
            const comparacion=page.locator('.haku-comparacion-sites'),texto=await comparacion.innerText();assert.match(texto,/Huésped integración local/);
            await preparar.click();const panel=page.locator('.haiku-cancelacion-pantalla');
            await page.getByRole('heading',{name:'Revisar cancelación',exact:true}).waitFor();assert.match(await panel.innerText(),/1 oct → 3 oct 2026 · 2 noches/);
            assert.equal(await page.evaluate(()=>__cancelacionIntegracion.rpc.filter(x=>x.nombre==='haiku_cancelar_reserva').length),0);
            await panel.getByRole('button',{name:'Volver',exact:true}).click();assert.equal(await comparacion.innerText(),texto);
            await preparar.click();
            await panel.getByRole('button',{name:'Ver reserva',exact:true}).click();
            await page.waitForFunction(()=>window.HAIKU_INSPECTOR_V1.estado().reservaAbierta);
            await page.evaluate(()=>window.HAIKU_INSPECTOR_V1.cerrarReserva());
            page.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'Confirmar cancelación',exact:true}).click();
            await page.getByRole('heading',{name:'Cancelación completada',exact:true}).waitFor();
            await panel.getByRole('button',{name:'Volver a la revisión',exact:true}).click();assert.match(await comparacion.innerText(),/Proyecto H: Cancelada/);
            assert.equal(await page.evaluate(()=>__cancelacionIntegracion.rpc.filter(x=>x.nombre==='haiku_cancelar_reserva').length),1);
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
            assert.deepEqual(externos,[]);assert.deepEqual(errores,[]);
            console.log(JSON.stringify({width,entrada:'panel.html',consulta:'interceptor y renderer de producción',backend:'fixture aislado',resultado:'PASS'}));await context.close();
        }
    }finally{await browser?.close();await new Promise(ok=>server.close(ok));}
})().catch(e=>{console.error(e);process.exitCode=1;});
