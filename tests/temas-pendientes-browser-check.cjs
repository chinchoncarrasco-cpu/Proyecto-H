// Páginas y renderizadores reales; datos sintéticos y toda red productiva interceptada.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {panelSinDatos,auditarContraste}=require('./haiku-tema-browser-check.cjs');
const fixtures=require('./fixtures/haiku-tema-v1.cjs');
const Redes=require('../js/haiku-redes-core-v1.js');
const F=require('./fixtures/libro-comparacion-readonly.cjs'),Core=require('../js/haiku-libro-comparacion-readonly-v1.js');
const root=path.resolve(__dirname,'..'),out=process.env.HAIKU_TEMAS_OUTPUT||'/tmp/haiku-temas-pendientes';
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const plan=JSON.parse(read('data/haiku-redes-2027.json'));
const month=plan.posts.find(p=>p.content_type==='publicacion').date.slice(0,7);
const sample=plan.posts.find(p=>p.date.startsWith(month)&&p.content_type==='publicacion');
let dto, navegacion;
async function capture(p,name,width,theme,scope='body'){
  await p.locator(scope).first().waitFor({state:'visible'});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' sin desborde del documento');
  assert.deepEqual(await p.evaluate(auditarContraste,scope),[],name+' contraste');
  await p.screenshot({path:path.join(out,`${name}-${width}-${theme}.png`),fullPage:true});
}
async function themeToggle(p,theme){
  await p.locator('#haiku-tema-boton').click();
  assert.equal(await p.locator('html').getAttribute('data-haiku-tema'),theme==='claro'?'oscuro':'claro');
  await p.locator('#haiku-tema-boton').click();
  assert.equal(await p.locator('html').getAttribute('data-haiku-tema'),theme);
}
async function comparacion(p,url,width,theme){
  // El flujo con sesión, XLSX y M2 reales está en libro-informe-readonly-web-browser-check.
  await p.route('**/js/*.js*',r=>/haiku-tema-v1|sites-libro-comparacion-readonly/.test(r.request().url())?r.continue():r.fulfill({contentType:'application/javascript',body:''}));
  await p.goto(url+'libro-comparacion.html');
  await p.evaluate(dto=>{
    const target=document.getElementById('informe-resultado');
    HAIKU_LIBRO_INFORME_READONLY_V1.renderizar(document,target,dto);
    document.getElementById('informe-estado').textContent='Resultado de prueba · Solo lectura';
    document.getElementById('informe-periodo').textContent='Octubre 2026 · Mes de prueba';
  },dto);
  const selected='.informe-categoria[open]';
  assert.equal(await p.locator(selected).count(),1);
  const control=width>700?'.informe-nav button':'.informe-categoria > summary';
  await p.locator(control).nth(4).click();
  assert.equal(await p.locator(selected).count(),1);
  const before=await p.locator(selected).textContent();await themeToggle(p,theme);
  assert.equal(await p.locator(selected).textContent(),before);
  await p.locator(control).nth(1).click();
  await capture(p,'comparacion',width,theme,'.informe-pagina');
  const cols=await p.locator('.informe-explorador').evaluate(e=>getComputedStyle(e).gridTemplateColumns);
  if(width>700)assert.match(cols,/px .*px/);
  for(let i=0;i<8;i++){
    if(await p.locator('.informe-categoria').nth(i).getAttribute('open')===null)await p.locator(control).nth(i).click();
    const buttons=p.locator(selected+' .informe-caso-boton');
    for(let j=0;j<await buttons.count();j++){
      if(await buttons.nth(j).isVisible())await buttons.nth(j).click();
      else assert.equal(await buttons.count(),1,'móvil omite el selector de un único caso');
      assert.equal(await p.locator(selected+' .informe-item:not([hidden])').count(),1);
      const evidence=p.locator(selected+' .informe-item:not([hidden]) .informe-tecnico');
      for(let k=0;k<await evidence.count();k++){await evidence.nth(k).locator('summary').click();assert.equal(await evidence.nth(k).getAttribute('open'),'');}
    }
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await p.evaluate(d=>HAIKU_LIBRO_INFORME_READONLY_V1.renderizar(document,document.getElementById('informe-resultado'),d),navegacion);
  assert.equal(await p.locator('.informe-categoria[open] .informe-caso-boton').count(),2);
  await p.locator('.informe-categoria[open] .informe-caso-boton').nth(1).click();
  assert.match(await p.locator('.informe-categoria[open] .informe-item:not([hidden]) h3').innerText(),/CAB 2/);
  await p.locator('#haiku-tema-boton').click();await p.reload();
  assert.equal(await p.locator('html').getAttribute('data-haiku-tema'),theme==='claro'?'oscuro':'claro');
}
async function calendario(p,url,width,theme){
  const calls=[];let revoked=false,withMedia=false;
  await p.route('https://zqfegylkylxsuoejomow.supabase.co/**',r=>{
    const data=r.request().postDataJSON();calls.push(data.action);
    if(revoked)return r.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Este enlace ya no está disponible.'})});
    if(data.action==='media')return r.fulfill({contentType:'application/json',body:JSON.stringify({url:url+'assets/icons/finanzas-compactas/cerrar.svg'})});
    return r.fulfill({contentType:'application/json',body:JSON.stringify({posts:[{...Redes.row(sample),copy:'Un descanso entre árboles.\nPrepara tu próxima escapada.',workflow_status:'borrador'}],assets:withMedia?[{id:'asset-demo',post_id:sample.id,state:'ready',position:0,created_at:'2026-11-01',mime:'image/svg+xml',filename:'adjunto-de-prueba.svg',kind:'material'}]:[]})});
  });
  await p.goto(url+'calendario-redes.html#enlace='+'a'.repeat(64)+'&mes='+month);
  const event=p.locator(`[data-event="${sample.id}"]`).first();await event.waitFor();
  await capture(p,'calendario',width,theme,'body');
  await event.click();await p.locator('.hr-dialog[open]').waitFor();
  assert.equal(await p.locator('.hr-dialog').evaluate(e=>e.matches(':modal')),width<1000);
  assert.match(await p.locator('.hr-read-copy').innerText(),/Un descanso entre árboles/);
  if(width>=1000){
    const a=await p.locator('.hr-month-scroll').boundingBox(),b=await p.locator('.hr-dialog').boundingBox();assert.ok(b.x>=a.x+a.width,'detalle junto al calendario');
    await themeToggle(p,theme);assert.equal(await p.locator('.hr-dialog[open]').count(),1);
    await p.locator('[data-action="refresh"]').click();await p.waitForFunction(()=>document.querySelector('[data-notice]').textContent.startsWith('Solo lectura'));
    assert.match(await p.locator('.hr-read-copy').innerText(),/Un descanso entre árboles/);
  }
  await capture(p,'calendario-detalle',width,theme,'.hr-dialog');
  await p.setViewportSize({width:width>=1000?390:1100,height:1000});await p.waitForFunction(modal=>document.querySelector('.hr-dialog').matches(':modal')===modal,width>=1000);
  await p.setViewportSize({width,height:1000});await p.waitForFunction(modal=>document.querySelector('.hr-dialog').matches(':modal')===modal,width<1000);await p.keyboard.press('Escape');await p.locator('.hr-dialog').waitFor({state:'hidden'});
  await p.locator('.hr-filters > summary').click();assert.equal(await p.locator('[data-filter]').count(),8);
  await p.locator('[data-filter="search"]').fill('no-existe-este-contenido');await p.locator('[data-view="agenda"]').click();
  assert.match(await p.locator('[data-calendar] .hr-empty').innerText(),/No hay contenido/);
  await capture(p,'calendario-vacio',width,theme);
  await p.locator('[data-filter="search"]').fill('');
  for(const view of ['ano','campanas']){await p.locator(`[data-view="${view}"]`).click();await capture(p,'calendario-'+view,width,theme);}
  await p.locator('[data-view="agenda"]').click();await event.click();await p.locator('[data-close]').click();
  withMedia=true;await p.locator('[data-action="refresh"]').click();await p.waitForFunction(()=>document.querySelector('[data-notice]').textContent.startsWith('Solo lectura'));await event.click();await p.waitForFunction(()=>document.querySelector('[data-read-gallery] img')?.naturalWidth>0);await p.locator('[data-close]').click();
  revoked=true;await p.locator('[data-action="refresh"]').click();await p.waitForFunction(()=>document.querySelector('[data-notice]').textContent.includes('ya no está'));
  assert.equal(await p.locator('[data-event]').count(),0);assert.equal(await p.locator('.hr-dialog[open]').count(),0);
  await capture(p,'calendario-enlace-cerrado',width,theme);
  assert.ok(calls.length>=2&&calls.includes('media')&&calls.every(x=>['calendar','media'].includes(x)),'sólo consultas');
  await p.locator('#haiku-tema-boton').click();await p.reload();assert.equal(await p.locator('html').getAttribute('data-haiku-tema'),theme==='claro'?'oscuro':'claro');
}
const scopes={'ficha-reserva':'#sites-resumen-reserva-drawer',cuenta:'#haiku-cuenta-menu-panel','haku-inicio':'#haiku-asistente-panel',servicios:'#seccion-servicios'};
async function secondary(p,url,width,theme,key){
  await p.goto(url);
  await p.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
  await p.evaluate(k=>{const s=k==='servicios'?'servicios':'resumen';document.querySelectorAll('.seccion-app').forEach(e=>{e.classList.toggle('activa',e.id==='seccion-'+s);e.classList.remove('oculto');});window.fechaSeleccionada='2026-10-22';},key);
  await fixtures[key](p);
  await capture(p,key,width,theme,scopes[key]);
  // Desplazar la superficie para medir también las etiquetas inferiores.
  await p.locator(scopes[key]).evaluate(e=>{for(const x of [e,...e.querySelectorAll('*')])if(x.scrollHeight>x.clientHeight&&getComputedStyle(x).overflowY.match(/auto|scroll/))x.scrollTop=x.scrollHeight;});
  await capture(p,key+'-inferior',width,theme,scopes[key]);
  if(key==='haku-inicio')assert.equal(await p.locator('.haiku-asistente-pista').isVisible(),true);
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});const html=await panelSinDatos();
  assert.equal((html.match(/href="css\/haiku-tema-legibilidad-v1.css/g)||[]).length,1);
  const scenarios=await Promise.all(F.casos().map(async f=>({f,dto:await Core.crearNucleo().compararMes({fuente:{hojas:{Oct26:f.data},nombre:'Fixture.xlsx'},cliente:F.cliente(f.db),ahora:F.ahora})})));
  dto=scenarios.find(x=>x.dto.presentacion.gruposConDiferencias>0)?.dto||scenarios[0].dto;
  const nf=F.caso('navegacion',(_,db,data)=>{const r=F.reserva({id:'libro-2',titular:'Sofía Prado',cabana:2});data.reservas.push(r);db.reserva_estadias.push(F.estadia(r,{id:'estadia-2',reserva_id:'reserva-2',reservas:{id:'reserva-2',titular_nombre:r.titular,estado_reserva:'confirmada'}}));});
  navegacion=await Core.crearNucleo().compararMes({fuente:{hojas:{Oct26:nf.data},nombre:'Fixture.xlsx'},cliente:F.cliente(nf.db),ahora:F.ahora});
  const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost').pathname;const f=path.resolve(root,'.'+u);if(u==='/')return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(html);if(!f.startsWith(root+path.sep))return res.writeHead(403).end();try{res.writeHead(200,{'Content-Type':f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':f.endsWith('.svg')?'image/svg+xml':'application/octet-stream'}).end(fs.readFileSync(f))}catch{res.writeHead(404).end()}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
  const browser=await chromium.launch({headless:true}),results=[];
  try{for(const width of [1600,390,320])for(const theme of ['claro','oscuro'])for(const name of ['comparacion','calendario',...Object.keys(scopes)]){
    const ctx=await browser.newContext({viewport:{width,height:1000},timezoneId:'America/Santiago'});
    await ctx.addInitScript(t=>{if(localStorage.getItem('haikuTemaV1')===null)localStorage.setItem('haikuTemaV1',t);},theme);
    await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
    const p=await ctx.newPage(),errors=[];p.setDefaultTimeout(6000);p.on('pageerror',e=>errors.push(e.message));
    try{if(name==='comparacion')await comparacion(p,url,width,theme);else if(name==='calendario')await calendario(p,url,width,theme);else await secondary(p,url,width,theme,name);assert.deepEqual(errors,[]);results.push({name,width,theme,ok:true});console.log('OK',name,width,theme);}
    catch(e){results.push({name,width,theme,error:e.message});console.error(name,width,theme,e);await p.screenshot({path:path.join(out,`error-${name}-${width}-${theme}.png`),fullPage:true});}
    finally{fs.writeFileSync(path.join(out,'resultados.json'),JSON.stringify(results,null,2));await ctx.close();}
  }}finally{await browser.close();await new Promise(r=>server.close(r));}
  assert.equal(results.filter(r=>!r.ok).length,0,'36 combinaciones y sus estados');
})().catch(e=>{console.error(e);process.exitCode=1;});
