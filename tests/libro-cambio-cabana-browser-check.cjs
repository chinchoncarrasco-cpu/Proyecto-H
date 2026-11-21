// Navegador real, sólo servidor local y datos ficticios; ninguna conexión productiva.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),F=require('./fixtures/libro-comparacion-readonly.cjs');
const root=path.resolve(__dirname,'..'),f=F.casos().find(x=>x.id==='cambio_cabana');
const cruces=F.caso('cruces', (r, db, data) => {
 const otraFecha=F.reserva({id:'otra-fecha',titular:'Persona Independiente',fecha_checkin:'2026-10-11',fecha_checkout:'2026-10-12',
  fechas_ocupadas:['2026-10-11'],noches:1,coordenadas_origen:F.origen('AQ3')});
 const contradictoria={...otraFecha,id:'contradictoria',titular:'Persona En Revisión',fecha_checkin:'2026-10-18',fecha_checkout:'2026-10-19',
  fechas_ocupadas:['2026-10-18'],coordenadas_origen:F.origen('BQ3'),cancelaciones_contradictorias:[F.origen('BR17')]};
 data.reservas.push(otraFecha,contradictoria);
 db.reserva_estadias=[F.estadia(r,{fecha_ingreso:'2026-10-04',fecha_salida:'2026-10-07',estado_estadia:'pendiente',
  reservas:{titular_nombre:'Persona ya registrada',estado_reserva:'pendiente'}})];
});
const scripts=['haiku-libro-semantica-v1','haiku-fullday-tarifa-v1','haiku-libro-pagos-canon-v1',
 'haiku-libro-lenguaje-natural-v1','haiku-libro-pagos-destinos-v1','haiku-libro-consultas-v1',
 'haiku-libro-cancelaciones-v1','haiku-libro-bloqueos-v1'];
const css=['styles','haiku-paleta-v1','sites-asistente-v1','supabase-asistente-v1',
 'supabase-haku-reconciliacion-v1','haiku-libro-decision-cards-v1','haiku-tema-oscuro-v1'];
const evidence=process.env.HAIKU_DIALOGOS_OUTPUT||path.join(require('node:os').tmpdir(),'haku-cambio-cabana');
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 if(p==='/')return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+
  css.map(x=>`<link rel="stylesheet" href="/css/${x}.css">`).join('')+
  '</head><body><div class="haiku-asistente-root"><section class="haiku-asistente-panel">'+
  '<div class="haiku-asistente-mensajes"><div id="out"></div></div></section></div></body></html>');
 const match=p.match(/^\/(js|css)\/([a-z0-9-]+)\.(js|css)$/);
 if(!match||!(match[1]==='js'?scripts:css).includes(match[2]))return res.writeHead(404).end();
 let text=fs.readFileSync(path.join(root,p),'utf8');
 if(match[2]==='haiku-libro-consultas-v1')text=text.replace('const apiConsultas = Object.freeze({ interpretar,',
  'const apiConsultas = Object.freeze({ renderizarComparacion, renderizarIncorporacion, priorizarActualizacionesEstadia, interpretar,');
 res.writeHead(200,{'Content-Type':match[1]==='js'?'application/javascript':'text/css'}).end(text);
});
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));let browser;
 fs.mkdirSync(evidence,{recursive:true});
 try{
  browser=await chromium.launch({executablePath:process.env.HAIKU_BROWSER_EXECUTABLE||chromium.executablePath(),headless:true});
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const width of [1440,390])for(const tema of ['claro','oscuro']){
   const context=await browser.newContext({viewport:{width,height:900}}),externas=[],errors=[];
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(externas.push(route.request().url()),route.abort()));
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
   await page.evaluate(({data,libro,cliente,tema})=>{
    globalThis.copy=structuredClone;globalThis.HAIKU_LIBRO_RESERVA_V1=(0,eval)('('+libro+')')(data);
    globalThis.clienteFixture=(0,eval)('('+cliente+')');document.documentElement.dataset.haikuTema=tema;
   },{data:f.data,libro:F.libroBase.toString(),cliente:F.cliente.toString(),tema});
   for(const s of scripts)await page.addScriptTag({url:origin+'/js/'+s+'.js'});
   const proof=await page.evaluate(async({db,consulta})=>{
    const cliente=clienteFixture(db),Q=HAIKU_LIBRO_CONSULTAS,original=JSON.stringify(cliente.db);
    const r=await Q.consultar(consulta,HAIKU_LIBRO_RESERVA_V1,cliente);
    Q.renderizarComparacion(document.getElementById('out'),r,{preguntasAbiertas:true});
    return {estado:r.comparacion[0].estado,categoria:r.comparacion[0].categoria,
     mutaciones:cliente.mutaciones,sinCambios:JSON.stringify(cliente.db)===original};
   },{db:f.db,consulta:F.consulta});
   assert.equal(proof.estado,'ambigua');assert.equal(proof.categoria,'posible_cambio_cabana');assert.equal(proof.sinCambios,true);
   assert.deepEqual(proof.mutaciones,[]);
   const title=page.getByText('Cambios de cabaña por revisar',{exact:true});await title.waitFor();await title.scrollIntoViewIfNeeded();
   assert.match(await page.locator('#out').textContent(),/Proyecto H CAB 2 → Libro CAB 1/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await page.evaluate(()=>Array.from(document.querySelectorAll('#out select')).every(s=>
    s.getBoundingClientRect().width<=s.closest('.haiku-asistente-panel').clientWidth)),true);
   await page.screenshot({path:path.join(evidence,`libro-cambio-${width}-${tema}.png`)});
   const etapa=await page.evaluate(async({db,consulta})=>{
    const Q=HAIKU_LIBRO_CONSULTAS,cliente=clienteFixture({...db,reserva_estadias:[],reservas:[]});
    const r=await Q.consultar(consulta,HAIKU_LIBRO_RESERVA_V1,cliente),plan=Q.crearPlanIncorporacion(r.reservas,r.comparacion);
    const alta=plan.items.find(i=>i.categoria==='nuevas');if(!alta)throw Error('Falta el alta ficticia');
    plan.items.unshift({id:'mover-anterior',categoria:'actualizaciones',seleccionado:true,motivos:[],dependeDe:[],permisos:['reservas.editar'],
     texto:'Persona Anterior Ficticia · CAB 1 → CAB 2',cambios:[{campo:'Cabaña',anterior:1,libro:2}],
     payload:{tipo:'reserva_actualizar',reserva_id:'reserva-anterior',estadia_id:'estadia-anterior',reserva:{antes:{},despues:{}},
      estadia:{antes:{cabana_numero:1,fecha_ingreso:'2026-10-03',fecha_salida:'2026-10-05',tipo_estadia:'alojamiento'},despues:{cabana_numero:2}}}});
    Q.priorizarActualizacionesEstadia(plan);window.haikuTienePermiso=()=>true;
    Q.renderizarIncorporacion(document.getElementById('out'),plan,()=>{},null,async()=>{throw Error('No se permiten escrituras en esta captura');});
    return {tipos:Q.serializarIncorporacion(plan).map(i=>i.tipo),altaAplazada:!alta.seleccionado&&alta.etapaSiguiente};
   },{db:f.db,consulta:F.consulta});
   assert.deepEqual(etapa.tipos,['reserva_actualizar']);assert.equal(etapa.altaAplazada,true);
   await page.getByText('Paso 1 · Corregir reservas primero',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(evidence,`libro-etapa-${width}-${tema}.png`)});
   const revision=await page.evaluate(async({data,db,libro})=>{
    const Q=HAIKU_LIBRO_CONSULTAS,cliente=clienteFixture(db);
    window.HAIKU_LIBRO_RESERVA_V1=(0,eval)('('+libro+')')(data);
    const plan=await Q.prepararIncorporacion({reservas:data.reservas,generacion:1},new Map(),new Set(),cliente);
    Q.renderizarIncorporacion(document.getElementById('out'),plan,()=>{},null,async()=>{throw Error('No se permiten escrituras');});
    return {enviables:Q.serializarIncorporacion(plan).map(i=>i.reserva.titular_nombre),mutaciones:cliente.mutaciones};
   },{data:cruces.data,db:cruces.db,libro:F.libroBase.toString()});
   assert.deepEqual(revision,{enviables:['Persona Independiente'],mutaciones:[]});
   const pendientes=page.locator('.haiku-incorporacion-seccion--pendientes');
   await pendientes.locator('summary').click();
   await pendientes.getByText(/CAB 1 ocupada en Proyecto H por Persona ya registrada/).waitFor();
   await pendientes.getByText(/activa en Oct26!BQ3.*Cancelaciones.*Oct26!BR17/).waitFor();
   assert.equal(await pendientes.locator('input[type=checkbox]:disabled').count(),2);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(evidence,`libro-cruces-${width}-${tema}.png`)});
   assert.deepEqual(errors,[]);assert.deepEqual(externas,[]);
   console.log(`PASS ${width}px ${tema}: traslado, cruces y cancelación contradictoria visibles, 0 escrituras y 0 red externa`);
   await context.close();
  }
 }finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok));}
})().catch(e=>{console.error(e);process.exitCode=1;});
