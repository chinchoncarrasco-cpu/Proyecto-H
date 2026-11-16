// Renderers reales de Haku e informe, datos inventados y red exclusivamente local.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {chromium}=require('playwright'),S=require('../js/haiku-libro-semantica-v1.js');
const F=require('./fixtures/libro-comparacion-readonly.cjs'),T=require('./fixtures/libro-titulares-sinteticos.cjs');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const screenshots=path.join(os.tmpdir(),'haku-titulares-20261115','navegador');fs.mkdirSync(screenshots,{recursive:true});
const raw=T.hoja(''),textos=[
 `${T.titular} // aurora@example.invalid // 2 ADL // 2 NOCHES // CHECK-IN EN ACORDEÓN // Datos Facturación:\nNombre: Empresa Imaginaria\nGiro: Investigación\ny la ingeniería\nComuna Imaginaria, Ciudad de Prueba.`,
 'Titular: Bastián Inventado // Titular: Cielo Ejemplo // 2 ADL // 2 NOCHES',
 'Maëlle O’Ficticio-Lenoir // BOOKING // 2 ADL // 2 NOCHES',
 'Aurora Ficción // Titular: aurora ficción // Aurora Ficcionn // 2 ADL // 2 NOCHES'
];
raw.celdas=raw.celdas.filter(c=>c.r!==2);raw.combinaciones=[];
textos.forEach((valor,i)=>{const r=i+2;raw.celdas.push({r,c:0,valor:`cabaña ${i+1}`},{r,c:2,valor,estiloId:0});raw.combinaciones.push({s:{r,c:2},e:{r,c:8}})});
const data=S.normalizarHoja(raw,'Oct26'),db={reserva_estadias:[F.estadia(data.reservas[0])],pagos:[],cabanas:[],bloqueos_cabana:[]};
const scripts=['haiku-libro-semantica-v1','haiku-fullday-tarifa-v1','haiku-libro-pagos-canon-v1','haiku-libro-lenguaje-natural-v1',
 'haiku-libro-pagos-destinos-v1','haiku-libro-consultas-v1','haiku-libro-cancelaciones-v1','haiku-libro-bloqueos-v1',
 'haiku-libro-comparacion-readonly-v1','sites-libro-comparacion-readonly-v1'];
const css=['styles','haiku-paleta-v1','supabase-asistente-v1','sites-asistente-v1','supabase-haku-reconciliacion-v1',
 'sites-libro-comparacion-readonly-v1','haiku-tema-oscuro-v1'];
const html='<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 css.map(s=>`<link rel="stylesheet" href="/css/${s}.css">`).join('')+
 '<style>body{margin:0}main{padding:12px;min-width:0}#haku,#informe{min-width:0;max-width:100%}#haku{width:100%}</style>'+
 '<body><main><h1>Haku · Titulares del Libro</h1><button id="comparar">Comparar Libro</button><button id="ver-informe">Ver informe</button><div id="haku"></div><div id="informe" hidden></div></main></body></html>';
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');if(u.pathname==='/')return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(html);
 if(!/^\/(js|css)\/[a-z0-9-]+\.(js|css)$/.test(u.pathname))return res.writeHead(404).end();
 let code=read(u.pathname.slice(1));if(u.pathname==='/js/haiku-libro-consultas-v1.js')code=code.replace('const apiConsultas = Object.freeze({ interpretar,','const apiConsultas = Object.freeze({ renderizarComparacion, interpretar,');
 res.writeHead(200,{'Content-Type':u.pathname.endsWith('.js')?'application/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(code);
});
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));let browser;const pruebas=[];
 try{
  browser=await chromium.launch({executablePath:process.env.HAIKU_BROWSER_EXECUTABLE||chromium.executablePath(),headless:true});
  const origin='http://127.0.0.1:'+server.address().port;
  for(const width of [1440,390])for(const tema of ['claro','oscuro']){
   const context=await browser.newContext({viewport:{width,height:900}}),externos=[],errors=[];
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();externos.push(route.request().url());return route.abort()});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
   await page.evaluate(({data,db,libro,cliente,tema})=>{
    document.documentElement.dataset.haikuTema=tema;globalThis.copy=structuredClone;
    globalThis.HAIKU_LIBRO_RESERVA_V1=(0,eval)('('+libro+')')(data);
    globalThis.clientePrueba=(0,eval)('('+cliente+')')(db);
   },{data,db,libro:F.libroBase.toString(),cliente:F.cliente.toString(),tema});
   for(const s of scripts)await page.addScriptTag({url:origin+'/js/'+s+'.js'});
   await page.evaluate(({consulta,ahora})=>{
    document.querySelector('#comparar').onclick=async()=>{
     globalThis.resultadoPrueba=await HAIKU_LIBRO_CONSULTAS.consultar(consulta,HAIKU_LIBRO_RESERVA_V1,clientePrueba);
     HAIKU_LIBRO_CONSULTAS.renderizarComparacion(document.querySelector('#haku'),resultadoPrueba);
    };
    document.querySelector('#ver-informe').onclick=async()=>{
     try {
      const dto=await HAIKU_LIBRO_COMPARACION_READONLY_V1.crearNucleo().compararMes({fuente:{libro:HAIKU_LIBRO_RESERVA_V1},cliente:clientePrueba,ahora});
      globalThis.dtoPrueba=dto;document.querySelector('#haku').hidden=true;
      HAIKU_LIBRO_INFORME_READONLY_V1.renderizar(document,document.querySelector('#informe'),dto);
     }catch(e){globalThis.errorInforme=e.message;}finally{globalThis.informeListo=true;}
    };
   },{consulta:F.consulta,ahora:F.ahora});
   await page.locator('#comparar').click();await page.locator('#haku').getByText(/etiquetas de titular contradictorias/).waitFor();
   const estado=await page.evaluate(()=>({titulares:resultadoPrueba.reservas.map(r=>r.titular),
    asociadas:resultadoPrueba.comparacion.filter(r=>r.estado==='asociada').length,mutaciones:clientePrueba.mutaciones}));
   assert.deepEqual(estado.titulares,[T.titular,'Maëlle O’Ficticio-Lenoir','aurora ficción']);assert.equal(estado.asociadas,1);assert.deepEqual(estado.mutaciones,[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Haku sin desborde');
   await page.screenshot({path:path.join(screenshots,`haku-${width}-${tema}.png`),fullPage:true});
   await page.locator('#ver-informe').click();await page.waitForFunction(()=>globalThis.informeListo);
   assert.equal(await page.evaluate(()=>globalThis.errorInforme),undefined);
   assert.equal(await page.evaluate(()=>dtoPrueba.contexto.reservasPorIdentificar.length),1);
   if(width>=500)await page.locator('#informe').getByRole('button',{name:/Reservas por identificar/}).click();
   else await page.locator('#informe .informe-categoria > summary').filter({hasText:'Reservas por identificar'}).click();
   await page.locator('#informe').getByText(/etiquetas de titular contradictorias/).waitFor();
   const informe=await page.locator('#informe').innerText();assert.match(informe,/Bastián Inventado \/ Cielo Ejemplo/);assert.match(informe,/CAB 2/);assert.doesNotMatch(informe,/Empresa Imaginaria/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Informe sin desborde');
   await page.screenshot({path:path.join(screenshots,`informe-${width}-${tema}.png`),fullPage:true});
   assert.deepEqual(await page.evaluate(()=>clientePrueba.mutaciones),[]);assert.deepEqual(externos,[]);assert.deepEqual(errors,[]);
   pruebas.push({width,tema,haku:'PASS',informe:'PASS',mutaciones:0,redExterna:0});await context.close();
  }
  fs.writeFileSync(path.join(screenshots,'resultado.json'),JSON.stringify(pruebas,null,2));console.log(JSON.stringify({status:'PASS',vistas:pruebas.length,capturas:pruebas.length*2}));
 }finally{await browser?.close();await new Promise(ok=>server.close(ok))}
})().catch(e=>{console.error(e);process.exitCode=1});
