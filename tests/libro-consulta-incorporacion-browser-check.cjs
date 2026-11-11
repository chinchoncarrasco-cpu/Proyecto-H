// Sólo en CI: consulta e incorporación reales contra una base ficticia, en ambos temas.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),f=require('./fixtures/libro-comparacion-readonly.cjs');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
    const ruta=new URL(req.url,'http://localhost').pathname;
    if(ruta==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><html></html>');return;}
    const file=path.resolve(root,'.'+ruta);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    try{const data=fs.readFileSync(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'}).end(data);}
    catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.HAKU_CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
        await require('./fixtures/dialogos.cjs').prepararNavegador(page);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const theme of ['claro','oscuro']){
   await page.goto(base+'/');
   await page.setContent(`<!doctype html><html lang="es" data-haiku-tema="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
   ${['styles','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1','haiku-libro-pagos-ui-v1','haiku-tema-oscuro-v1'].map(s=>`<link rel="stylesheet" href="${base}/css/${s}.css">`).join('')}
   </head><body><div class="haiku-asistente-root"><div class="haiku-asistente-panel" id="haiku-asistente-panel">
   <header class="haiku-asistente-cabecera">Haku Consultas<button id="haiku-asistente-cerrar">Cerrar</button></header>
   <div id="haiku-asistente-mensajes" class="haiku-asistente-mensajes"><div id="respuesta" data-haiku-libro-respuesta="1"></div></div>
   <footer class="haiku-asistente-compositor"><input id="haiku-asistente-texto" value="Consulta en curso"><button id="haiku-asistente-enviar">Enviar</button></footer></div></div></body></html>`);
   await page.evaluate(data=>{
    window.__data=data;window.__generation=1;window.__rpc=[];window.__scroll=0;
    window.haikuTienePermiso=()=>true;window.HAIKU_ASISTENTE={abierta:()=>!document.getElementById('haiku-asistente-panel').hidden,procesando:()=>false};
    const estado=()=>({cargado:true,generacion:window.__generation,version:String(window.__generation).repeat(64)});
    window.HAIKU_LIBRO_RESERVA_V1={estado,crearLectura:async()=>{
     const fijo=estado(),copia=structuredClone(window.__data);
     return {estado:()=>fijo,listarHojas:()=>['Oct26'],consultarHojas:async()=>[copia]};
    }};
    window.haikuSupabase={auth:{getSession:async()=>({data:{session:{user:{id:'usuario-ficticio'}}}})},
     from:()=>{const q={select:()=>q,eq:()=>q,in:()=>q,lte:()=>q,gte:()=>q,range:()=>q,order:()=>q,then:(ok,no)=>Promise.resolve({data:[],error:null}).then(ok,no)};return q;},
     rpc:async(n,args)=>{window.__rpc.push({n,args});window.__generation++;
      return {data:{ok:true,reservas_creadas:args.p_items.length,pagos_creados:0,estadias_agregadas:0,omitidos:0}};}};
    window.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1={obtenerResultado:()=>new Promise(resolve=>window.__resolverAviso=resolve)};
   },f.casos().find(c=>c.id==='reserva_faltante').data);
   for(const name of ['haiku-libro-semantica-v1','haiku-fullday-tarifa-v1','haiku-libro-pagos-canon-v1','haiku-libro-lenguaje-natural-v1','haiku-libro-pagos-destinos-v1','haiku-libro-consultas-v1','supabase-asistente-libro-auto-v1'])
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'js',name+'.js'),'utf8')});
   assert.deepEqual(errors,[],'Los módulos reales deben inicializarse antes de la consulta');
   await page.evaluate(async()=>{
    await HAIKU_LIBRO_CONSULTAS.abrirComparacionEstructurada(document.getElementById('respuesta'),{reservas:structuredClone(window.__data.reservas),generacion:1});
    document.getElementById('haiku-asistente-texto').focus();
    const mensajes=document.getElementById('haiku-asistente-mensajes');mensajes.scrollTop=70;window.__scroll=mensajes.scrollTop;
    window.__generation++;
    dispatchEvent(new CustomEvent('haiku:libro-version-cargada',{detail:{generacion:window.__generation,tenia_anterior:true,carga_automatica:true}}));
   });
   await page.locator('.haku-libro-auto').waitFor();
   assert.match(await page.locator('.haku-libro-auto').innerText(),/Revisando la actualización/);
   const posicion=await page.evaluate(()=>{
    const a=document.querySelector('.haku-libro-auto').getBoundingClientRect(),p=document.getElementById('haiku-asistente-panel').getBoundingClientRect();
    return {right:a.right,left:a.left,panelLeft:p.left,scroll:document.getElementById('haiku-asistente-mensajes').scrollTop,antes:window.__scroll,activo:document.activeElement.id};
   });
   assert.ok(posicion.right<=posicion.panelLeft-10,JSON.stringify(posicion));assert.ok(posicion.left>=0);
   assert.equal(posicion.scroll,posicion.antes);assert.equal(posicion.activo,'haiku-asistente-texto');
   await page.evaluate(()=>window.__resolverAviso({estado:'ok',generado_en:new Date().toISOString(),nuevas:[],modificadas:[{actual:{titular:'Otra Persona',cabana:2},cambios:[{campo:'notas_importantes',antes:[],ahora:['Entrega de carbón']}]}],ya_no_aparecen:[],ambiguas:[],advertencias:[]}));
   await page.getByText('Otra Persona · CAB 2',{exact:true}).waitFor();
   if(process.env.HAKU_RESUMEN_CAPTURES){
    fs.mkdirSync(process.env.HAKU_RESUMEN_CAPTURES,{recursive:true});
    for(const width of [1440,390,320]){
     await page.setViewportSize({width,height:1000});
     await page.locator('.haku-libro-auto').screenshot({path:path.join(process.env.HAKU_RESUMEN_CAPTURES,`hora-deteccion-${theme}-${width}.png`)});
    }
    await page.setViewportSize({width:1440,height:1000});
   }
   await page.getByRole('button',{name:'Preparar incorporación',exact:true}).click();
   await page.getByRole('button',{name:'Continuar con 1 elemento listo',exact:true}).waitFor();
   assert.equal(await page.locator('#haiku-asistente-texto').inputValue(),'Consulta en curso');
   await page.getByRole('button',{name:'Continuar con 1 elemento listo',exact:true}).click();
   await page.waitForFunction(()=>window.__rpc.length===1);
   await page.getByText('Incorporación completada',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.__rpc[0].args.p_items.length),1);
   assert.doesNotMatch(await page.locator('#respuesta').innerText(),/El Libro cambió; vuelve a comparar|No se pudo confirmar/);
   await page.setViewportSize({width:390,height:844});
   await page.waitForFunction(()=>{const r=document.querySelector('.haku-libro-auto').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;});
   const movil=await page.locator('.haku-libro-auto').boundingBox();assert.ok(movil.x>=0 && movil.x+movil.width<=391);
   await page.getByRole('button',{name:'Seguir con mi consulta',exact:true}).click();assert.equal(await page.locator('.haku-libro-auto').count(),0);
   await page.setViewportSize({width:1440,height:1000});
  }
  assert.deepEqual(errors,[]);console.log('OK: consulta conservada, burbuja inmediata junto al panel, incorporación y respuesta durante actualización; ambos temas y móvil.');
 } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
