// Browser real + backend simulado. No conecta con Supabase ni carga el XLSX remoto.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const server=http.createServer((req,res)=>res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="out"></main></body></html>'));
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.HAIKU_BROWSER_PATH || (fs.existsSync(edge)?edge:undefined),headless:true});
 try {
  const page=await browser.newPage({viewport:{width:980,height:760}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const origin=`http://127.0.0.1:${server.address().port}`;
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);
  for(const file of ['css/styles.css','css/sites-shell-v1.css','css/supabase-libro-reserva-v1.css',
   'css/haiku-libro-decision-cards-v1.css','css/haiku-libro-resoluciones-v1.css','css/haiku-tema-oscuro-v1.css'])
   await page.addStyleTag({content:read(file)});
  if(process.env.HAKU_TEST_FONT_DIR) {
   const fonts=[[400,'400Regular'],[500,'500Medium'],[600,'600SemiBold']].map(([weight,name])=>
    `@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/ttf;base64,${fs.readFileSync(path.join(process.env.HAKU_TEST_FONT_DIR,name,`Inter_${name}.ttf`)).toString('base64')})}`);
   await page.addStyleTag({content:fonts.join('\n')});
  }
  await page.addStyleTag({content:'body{display:block;margin:24px;background:var(--sites-shell-canvas)}#out{width:100%;max-width:436px}@media(max-width:500px){body{margin:16px}}'});
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
  await card.getByRole('button',{name:'Confirmar ocupación'}).click();assert.match(await card.getByRole('alert').textContent(),/entero/);
  await card.getByRole('spinbutton',{name:'Adultos',exact:true}).fill('2');await page.evaluate(()=>window.__fallar=true);
  await card.getByRole('button',{name:'Confirmar ocupación'}).click();assert.match(await card.getByRole('alert').textContent(),/guardar/);
  assert.equal(await card.locator('.haiku-ocupacion-badge').textContent(),'Por completar');
  await page.evaluate(()=>window.__fallar=false);await card.getByRole('button',{name:'Confirmar ocupación'}).click();
  await card.getByRole('button',{name:'Editar ocupación'}).waitFor();
  assert.equal(await card.locator('.haiku-ocupacion-badge').textContent(),'Confirmado');
  assert.deepEqual(await card.locator('.haiku-ocupacion-resumen dd').allTextContents(),['2','0','0']);
  assert.equal(await card.locator('.haiku-ocupacion-aviso').isVisible(),false);
  await card.getByRole('button',{name:'Editar ocupación'}).click();await card.getByRole('spinbutton',{name:'Adultos',exact:true}).fill('3');
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
  await card.getByRole('button',{name:'Confirmar ocupación'}).click();assert.match(await card.getByRole('alert').textContent(),/2 ADL/);
  await card.getByRole('spinbutton',{name:'Adultos',exact:true}).fill('2');await card.getByRole('button',{name:'Confirmar ocupación'}).click();
  await card.getByRole('button',{name:'Editar ocupación'}).waitFor();
  const tariff=await page.evaluate(async()=>{
   const p=await HAIKU_LIBRO_CONSULTAS.prepararIncorporacion({reservas:[window.__original],generacion:1,q:{desde:'2026-10-02',hasta:'2026-10-02'}});
   return HAIKU_LIBRO_CONSULTAS.serializarIncorporacion(p)[0].estadias[0].tarifas['2026-10-02'];
  });assert.equal(tariff,120000);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'sin desborde horizontal móvil');
  await page.screenshot({path:path.join(os.tmpdir(),'haku-libro-resolucion-ocupacion.png'),fullPage:true});
  await page.evaluate(()=>{window.__gen++;window.dispatchEvent(new CustomEvent('haiku:libro-cambio'));});
  assert.equal(await card.getByRole('button',{name:'Editar ocupación'}).isDisabled(),true);assert.match(await card.textContent(),/Libro cambió/);
  assert.equal(await card.locator('.haiku-ocupacion-resumen').isVisible(),false,'un Libro obsoleto no sigue mostrando una confirmación vigente');

  for(const width of [980,390,320]) for(const theme of ['claro','oscuro']) {
   await page.setViewportSize({width,height:844});
   await page.evaluate(theme=>{
    document.documentElement.setAttribute('data-haiku-tema',theme);
    window.__data=[];
    window.__original={...window.__original,id:'Nov26!D11',titular:'Titular de ejemplo',cabana:9,
     fecha_checkin:'2026-11-01',fecha_checkout:'2026-11-02',tipo_estadia:'alojamiento',adultos:null,ninos:null,mascotas:null,
     coordenadas_origen:{hoja:'Nov26',celda:'D11'}};
    window.__comparison=[{libro:window.__original,estado:'nueva',sistema:null}];
    document.getElementById('out').replaceChildren();
    HAIKU_LIBRO_RESOLUCIONES_V1.adjuntar(document.getElementById('out'),[window.__original],window.__gen,async()=>{},window.__comparison);
   },theme);
   await card.getByRole('button',{name:'Completar ocupación'}).click();
   await card.getByRole('spinbutton',{name:'Adultos',exact:true}).fill('4');
   await card.getByRole('spinbutton',{name:'Adultos',exact:true}).blur();
   await page.mouse.move(0,0);
   await page.evaluate(()=>document.fonts.ready);
   const fields=await card.locator('.haiku-ocupacion-campo input').evaluateAll(inputs=>inputs.map(input=>{
    const box=input.getBoundingClientRect();return {top:box.top,width:box.width};
   }));
   assert.equal(fields.length,3);
   assert.ok(Math.max(...fields.map(f=>f.top))-Math.min(...fields.map(f=>f.top))<1,'los tres campos quedan alineados');
   assert.ok(Math.max(...fields.map(f=>f.width))-Math.min(...fields.map(f=>f.width))<1,'los tres campos tienen igual ancho');
   const cancelBox=await card.getByRole('button',{name:'Cancelar',exact:true}).boundingBox();
   const saveBox=await card.getByRole('button',{name:'Confirmar ocupación',exact:true}).boundingBox();
   assert.ok(Math.abs(cancelBox.height-saveBox.height)<1,'acciones de igual alto');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'sin desborde horizontal');
   assert.match(await card.evaluate(node=>getComputedStyle(node).fontFamily),/Inter/);
   assert.equal(await card.evaluate(node=>getComputedStyle(node).backgroundColor),theme==='oscuro'?'rgb(27, 38, 33)':'rgb(255, 255, 255)','el tema global conserva la superficie aprobada');
   assert.notEqual(await card.locator('.haiku-ocupacion-badge').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(0, 0, 0)');
   if(process.env.HAKU_UI_SHOTS) {
    fs.mkdirSync(process.env.HAKU_UI_SHOTS,{recursive:true});
    await card.screenshot({path:path.join(process.env.HAKU_UI_SHOTS,`ocupacion-${width}-${theme}-pendiente.png`)});
   }
   await card.getByRole('button',{name:'Confirmar ocupación',exact:true}).click();
   await card.getByRole('button',{name:'Editar ocupación',exact:true}).waitFor();
   assert.deepEqual(await card.locator('.haiku-ocupacion-resumen dd').allTextContents(),['4','0','0']);
   assert.equal(await card.locator('.haiku-ocupacion-aviso').isVisible(),false);
   assert.equal(await card.locator('.haiku-ocupacion-editor').isVisible(),false);
   assert.equal(await page.evaluate(()=>window.__original.adultos),null,'conserva la evidencia original del Libro');
   await page.evaluate(()=>{
    document.getElementById('out').replaceChildren();
    HAIKU_LIBRO_RESOLUCIONES_V1.adjuntar(document.getElementById('out'),[window.__original],window.__gen,async()=>{},window.__comparison);
   });
   await card.getByRole('button',{name:'Editar ocupación',exact:true}).waitFor();
   assert.deepEqual(await card.locator('.haiku-ocupacion-resumen dd').allTextContents(),['4','0','0'],'la confirmación se conserva tras una lectura nueva');
   if(process.env.HAKU_UI_SHOTS) await card.screenshot({path:path.join(process.env.HAKU_UI_SHOTS,`ocupacion-${width}-${theme}-confirmada.png`)});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS browser: resolver inline, cancelar, invalidar, error de persistencia, editar, preparación, original intacto, Full Day 120000, móvil y generación obsoleta.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
