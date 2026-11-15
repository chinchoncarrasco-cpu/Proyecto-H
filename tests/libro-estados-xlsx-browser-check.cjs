// DOM, worker y renderer reales. Sólo HTTP local; admite una copia real opcional
// en un contexto efímero, sin solicitudes productivas ni escrituras de negocio.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const assets=process.env.HAIKU_LIBRO_WORKER_ASSETS||path.join(os.tmpdir(),'haku-lectura-assets');
const actual=process.env.HAKU_LIBRO_AUDIT_XLSX;
const bytes=fs.readFileSync(actual||path.join(__dirname,'fixtures/libro-reconciliacion-oct26-real.xlsx'));
const hoja=actual?'Nov26':'Oct26',screens=path.join(os.tmpdir(),'haku-estados-audit','capturas');
fs.mkdirSync(screens,{recursive:true});
const html=read('index.html'),start=html.indexOf('<section id="seccion-libro-reserva"');
const section=html.slice(start,html.indexOf('</main>',start))
 .replace('class="seccion"','class="seccion activa"');
const scripts=['supabase-libro-reserva-v1','haiku-libro-semantica-v1','haiku-fullday-tarifa-v1','haiku-libro-pagos-canon-v1',
 'haiku-libro-lenguaje-natural-v1','haiku-libro-pagos-destinos-v1','haiku-libro-cancelaciones-v1','haiku-libro-bloqueos-v1',
 'haiku-libro-consultas-v1','haiku-libro-comparacion-readonly-v1','sites-libro-comparacion-readonly-v1'];
const css=['styles','haiku-paleta-v1','supabase-libro-reserva-v1','supabase-libro-reserva-fidelidad-v1',
 'sites-libro-reserva-v1','sites-libro-comparacion-readonly-v1','haiku-tema-oscuro-v1'];
const doc='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 css.map(n=>`<link rel="stylesheet" href="/css/${n}.css">`).join('')+
 '<style>#seccion-libro-reserva{display:block!important}body{margin:0}main{padding:12px;min-width:0}#prueba-informe{max-width:100%}</style>'+
 scripts.map(n=>`<script defer src="/js/${n}.js?v=estados-test"></script>`).join('')+
 '</head><body><main>'+section+'<div id="prueba-informe"></div></main></body></html>';
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/')return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(doc);
 if(url.pathname==='/input.xlsx')return res.writeHead(200,{'Content-Type':'application/octet-stream'}).end(bytes);
 if(!/^\/(?:js|css)\/[a-z0-9-]+\.(?:js|css)$/.test(url.pathname))return res.writeHead(404).end();
 res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'application/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(read(url.pathname.slice(1)));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.HAIKU_BROWSER_EXECUTABLE||chromium.executablePath(),headless:true});
 try{
  for(const width of [1440,390])for(const tema of ['claro','oscuro']){
   const context=await browser.newContext({viewport:{width,height:900}}),errors=[];
   await context.route('**/*',route=>{
    const u=route.request().url();if(new URL(u).origin===origin)return route.continue();
    for(const name of ['xlsx.full.min.js','jszip.min.js'])if(u.endsWith('/'+name))return route.fulfill({path:path.join(assets,name),contentType:'application/javascript'});
    errors.push('Red externa bloqueada');return route.abort();
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
   await page.waitForFunction(()=>!!window.HAIKU_LIBRO_RESERVA_V1);
   const result=await page.evaluate(async({hoja,tema})=>{
    document.documentElement.dataset.haikuTema=tema;
    const bytes=await (await fetch('/input.xlsx')).arrayBuffer(),libro=HAIKU_LIBRO_RESERVA_V1;
    let etapa=performance.now();const tiempos={};
    await libro.cargarDesdeGoogleParaVerificacion(new File([bytes],'Libro-local.xlsx'));
    tiempos.carga_indice_ms=Math.round(performance.now()-etapa);etapa=performance.now();
    const lectura=await libro.crearLectura(),data=await lectura.consultarHoja(hoja);
    tiempos.lectura_semantica_ms=Math.round(performance.now()-etapa);etapa=performance.now();
    const dto={status:'incompleto',presentacion:{},comparacion:{items:data.reservas.map((r,i)=>({id:'caso:'+i,libro:{...r,
     notasInterpretacion:r.notas_interpretacion,notasImportantes:r.notas_importantes},estado:'Sólo lectura local',categoria:'Auditoría',diferencias:[]})),grupos:[]},
     pagosDetalle:[],serviciosDetalle:[],advertencias:[],contexto:{advertenciasInformativas:[],bloqueos:{},cancelaciones:{}},cobertura:{hojas:[]},fuente:{},periodo:{}};
    dto.comparacion.grupos=dto.comparacion.items.map(i=>({estado:'ambigua',itemIds:[i.id],pregunta:'Prueba local del renderer. Proyecto H no consultado en esta vista.'}));
    HAIKU_LIBRO_INFORME_READONLY_V1.renderizar(document,document.getElementById('prueba-informe'),dto);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    tiempos.informe_y_pintado_ms=Math.round(performance.now()-etapa);
    return {modo:libro.modo,version:libro.estado().version,reservas:data.reservas.map(r=>({cab:r.cabana,celda:r.coordenadas_origen.celda,estado:r.estado_operativo})),
     tiempos,texto:document.getElementById('prueba-informe').textContent};
   },{hoja,tema});
   assert.equal(result.modo,'archivo-local-solo-lectura-estilo-xlsx-richtext');assert.match(result.version,/^[a-f\d]{64}$/);
   assert.ok(result.reservas.length);assert.match(result.texto,/Estado leído del Libro/);assert.match(result.texto,/Estado registrado en Proyecto H/);
   if(actual){
    for(const [cab,celda] of [[4,'BD6'],[9,'AZ11']])assert.equal(result.reservas.find(r=>r.cab===cab&&r.celda===celda)?.estado,'checked_out');
    for(const celda of ['X12','BD12'])assert.equal(result.reservas.find(r=>r.celda===celda)?.estado,'hospedada');
    assert.match(result.texto,/Estado del Libro no determinado/);
   }
   await page.locator('#libro-reserva-hoja').selectOption(hoja);
   await page.waitForFunction(()=>document.querySelector('#seccion-libro-reserva table td'));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(screens,`libro-informe-${width}-${tema}.png`),fullPage:true});
   assert.deepEqual(errors,[]);console.log(`PASS Libro XLSX y estados: ${width}px ${tema}, ${result.reservas.length} reservas, sin red productiva. ${JSON.stringify(result.tiempos)}`);
   await context.close();
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
