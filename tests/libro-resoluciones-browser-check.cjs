// Browser real + backend simulado. No conecta con Supabase ni carga el XLSX remoto.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const server=http.createServer((req,res)=>res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="out"></main></body></html>'));
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:edge,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:980,height:760}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const origin=`http://127.0.0.1:${server.address().port}`;
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);
  await page.addStyleTag({content:read('css/haiku-libro-resoluciones-v1.css')});
  await page.addStyleTag({content:'body{font:16px system-ui;margin:24px}#out{max-width:800px}button{font:inherit;padding:8px}'});
  await page.evaluate(()=>{
   window.__gen=1;window.__writes=0;window.__fallar=false;window.__data=[];
   window.HAIKU_LIBRO_RESERVA_V1={estado:()=>({generacion:window.__gen,version:'a'.repeat(64)})};
   window.haikuTienePermiso=()=>true;
   window.haikuSupabase={auth:{getSession:async()=>({data:{session:{user:{id:'local'}}}})},from(){
    const b={select(){return b},lte(){return b},gte(){return b},in(){return b},order(){return b},range:async()=>({data:[]})};return b;
   },async rpc(name,args){
    if(name==='haiku_libro_leer_resoluciones_v1')return {data:args.p_identidades.flatMap(id=>window.__data.filter(x=>JSON.stringify(x.identidad)===JSON.stringify(id)).slice(-1))};
    if(name==='haiku_libro_confirmar_resolucion_v1'){
     if(window.__fallar)return {error:{message:'No se pudo guardar'}};
     window.__writes++;const d={id:args.p_operacion_id,campo:'ocupacion',identidad:args.p_identidad,valor_confirmado:args.p_valor};window.__data.push(d);return {data:d};
    }throw Error('RPC no autorizado en browser: '+name);
   }};
   window.__original={id:'Oct26!C3',titular:'Esperanza Aranda',cabana:1,fecha_checkin:'2026-10-02',fecha_checkout:'2026-10-03',tipo_estadia:'alojamiento',adultos:null,ninos:null,mascotas:null,
    texto_original:'Esperanza Aranda // 1 noche // ocupación por confirmar',coordenadas_origen:{hoja:'Oct26',celda:'C3'},pagos:[],pagos_sin_asociacion:[],servicios:[],advertencias:[],notas_importantes:[]};
  });
  for(const f of ['haiku-fullday-tarifa-v1','haiku-libro-semantica-v1','haiku-libro-resoluciones-v1','haiku-libro-consultas-v1','supabase-asistente-libro-incorporacion-v1'])await page.addScriptTag({content:read(`js/${f}.js`)});
  await page.evaluate(()=>HAIKU_ASISTENTE_LIBRO_INCORPORACION_V1.adjuntar(document.getElementById('out'),{estado:'ok',nuevas:[{actual:window.__original}]},1));
  const card=page.locator('.haiku-libro-resolucion').first();
  await assert.equal(await card.getByRole('button',{name:'Completar ocupación'}).isVisible(),true);
  await card.getByRole('button',{name:'Completar ocupación'}).click();await card.getByRole('spinbutton',{name:'Adultos',exact:true}).fill('2');
  await card.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(await page.evaluate(()=>window.__writes),0);
  await card.getByRole('button',{name:'Completar ocupación'}).click();await card.getByRole('spinbutton',{name:'Adultos',exact:true}).fill('2.5');
  await card.getByRole('button',{name:'Confirmar datos'}).click();assert.match(await card.getByRole('alert').textContent(),/entero/);
  await card.getByRole('spinbutton',{name:'Adultos',exact:true}).fill('2');await page.evaluate(()=>window.__fallar=true);
  await card.getByRole('button',{name:'Confirmar datos'}).click();assert.match(await card.getByRole('alert').textContent(),/guardar/);
  assert.doesNotMatch(await card.textContent(),/✓ Resuelto/);
  await page.evaluate(()=>window.__fallar=false);await card.getByRole('button',{name:'Confirmar datos'}).click();
  await card.getByRole('button',{name:'Editar resolución'}).waitFor();assert.match(await card.textContent(),/✓ Resuelto manualmente · 2 adultos · 0 niños · 0 mascotas/);
  await card.getByRole('button',{name:'Editar resolución'}).click();await card.getByRole('spinbutton',{name:'Adultos',exact:true}).fill('3');
  await card.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(await page.evaluate(()=>window.__writes),1);
  await page.getByRole('button',{name:'Preparar cambios en Proyecto H',exact:true}).click();
  await page.getByRole('button',{name:'Preparar incorporación',exact:true}).waitFor();
  const stats=await page.evaluate(async()=>{
   const p=await HAIKU_LIBRO_CONSULTAS.prepararIncorporacion({reservas:[window.__original],generacion:1,q:{desde:'2026-10-02',hasta:'2026-10-03'}});
   return {serialized:HAIKU_LIBRO_CONSULTAS.serializarIncorporacion(p),original:window.__original};
  });assert.equal(stats.serialized[0].estadias[0].datos.adultos,2);assert.equal(stats.original.adultos,null);
  await page.getByRole('button',{name:'Preparar incorporación',exact:true}).click();assert.match(await page.locator('#out').textContent(),/Confirmar incorporación/);
  await page.evaluate(async()=>{
   window.__original={...window.__original,id:'Oct26!FD',tipo_estadia:'full_day',fecha_checkout:'2026-10-02',coordenadas_origen:{hoja:'Oct26',celda:'FD'},texto_original:'FULLDAY // ocupación por confirmar'};
   await HAIKU_LIBRO_CONSULTAS.abrirComparacionEstructurada(document.getElementById('out'),{reservas:[window.__original],generacion:1});
  });
  await card.getByRole('button',{name:'Completar ocupación'}).click();await card.getByRole('spinbutton',{name:'Adultos',exact:true}).fill('1');await card.getByRole('spinbutton',{name:'Niños',exact:true}).fill('1');
  await card.getByRole('button',{name:'Confirmar datos'}).click();assert.match(await card.getByRole('alert').textContent(),/2 ADL/);
  await card.getByRole('spinbutton',{name:'Adultos',exact:true}).fill('2');await card.getByRole('button',{name:'Confirmar datos'}).click();
  await card.getByRole('button',{name:'Editar resolución'}).waitFor();
  const tariff=await page.evaluate(async()=>{
   const p=await HAIKU_LIBRO_CONSULTAS.prepararIncorporacion({reservas:[window.__original],generacion:1,q:{desde:'2026-10-02',hasta:'2026-10-02'}});
   return HAIKU_LIBRO_CONSULTAS.serializarIncorporacion(p)[0].estadias[0].tarifas['2026-10-02'];
  });assert.equal(tariff,120000);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'sin desborde horizontal móvil');
  await page.screenshot({path:path.join(os.tmpdir(),'haku-libro-resolucion-ocupacion.png'),fullPage:true});
  await page.evaluate(()=>{window.__gen++;window.dispatchEvent(new CustomEvent('haiku:libro-cambio'));});
  assert.equal(await card.getByRole('button',{name:'Editar resolución'}).isDisabled(),true);assert.match(await card.textContent(),/Libro cambió/);
  assert.deepEqual(errors,[]);
  console.log('PASS browser: resolver inline, cancelar, invalidar, error de persistencia, editar, preparación, original intacto, Full Day 120000, móvil y generación obsoleta.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
