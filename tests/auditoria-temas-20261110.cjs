// Auditoría visual de lectura: panel real, renderizadores reales, datos sintéticos.
// No se carga el cliente de producción ni se permite red externa.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),Module=require('node:module');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=process.env.TEMA_OUTPUT_DIR||'/tmp/haiku-auditoria-temas';
const original=path.join(__dirname,'haiku-tema-browser-check.cjs');
const helper=new Module(original,module);helper.filename=original;helper.paths=module.paths;
helper._compile(fs.readFileSync(original,'utf8').replace('Date, console', 'Date, console, URLSearchParams, location: {search: ""}').replace(/main\(\)\.catch\([\s\S]*$/,'module.exports={panelSinDatos,estadoVisual};'),original);
const {panelSinDatos,estadoVisual}=helper.exports;
const fixtures=require('./fixtures/haiku-tema-v1.cjs');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

function metrics(){
 const rgb=s=>{const a=s.match(/[\d.]+/g)?.map(Number)||[0,0,0,0];return s.startsWith('color(')?a.map((v,i)=>i<3?v*255:v):a;};
 const mix=(a,b)=>a.slice(0,3).map((v,i)=>v*(a[3]??1)+b[i]*(1-(a[3]??1)));
 const lum=a=>a.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const failures=[],bright=[],samples=[];
 for(const e of document.querySelectorAll('body *')){
  if(e.closest('script,style,#libro-reserva-visor table')||!e.getClientRects().length||e.closest('details:not([open])')&&!e.closest('summary'))continue;
  const s=getComputedStyle(e),r=e.getBoundingClientRect();
  if(s.visibility!=='visible'||r.bottom<=0||r.top>=innerHeight||r.right<=0||r.left>=innerWidth||r.width<1||r.height<1)continue;
  // Reject text clipped by scroll containers or covered by another overlay.
  const x=Math.max(0,Math.min(innerWidth-1,(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2));
  const y=Math.max(0,Math.min(innerHeight-1,(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2));
  const hit=document.elementFromPoint(x,y);if(hit&&hit!==e&&!e.contains(hit)&&!hit.contains(e))continue;
  const id=e.id?'#'+e.id:e.tagName.toLowerCase()+'.'+String(e.className?.baseVal||e.className||'').trim().split(/\s+/).join('.');
  const bg0=rgb(s.backgroundColor);
  if(bg0[3]!==0&&lum(bg0)>.65&&r.width*r.height>6000&&!e.closest('.sidebar'))bright.push({element:id,bg:s.backgroundColor,w:Math.round(r.width),h:Math.round(r.height)});
  if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&!['INPUT','SELECT','TEXTAREA'].includes(e.tagName))continue;
  const chain=[];let parent=e,skip=false;while(parent){const t=getComputedStyle(parent);if(+t.opacity<1||parent.disabled||t.backgroundImage!=='none')skip=true;chain.unshift(rgb(t.backgroundColor));parent=parent.parentElement;}if(skip)continue;
  let bg=[255,255,255];for(const c of chain)bg=mix(c,bg);
  const a=lum(mix(rgb(s.color),bg)),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  const threshold=parseFloat(s.fontSize)>=24||parseFloat(s.fontSize)>=18.66&&+s.fontWeight>=700?3:4.5;
  const item={element:id,text:(e.innerText||e.value||'').trim().slice(0,85),ratio:+ratio.toFixed(2),fg:s.color,bg:bg.map(Math.round),size:s.fontSize};
  samples.push(item);if(ratio<threshold-.05)failures.push(item);
 }
 return{failures,bright,samples,overflow:document.documentElement.scrollWidth>innerWidth,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyBg:getComputedStyle(document.body).backgroundColor,theme:document.documentElement.dataset.haikuTema,hasThemeScript:!!window.HAIKU_TEMA_V1};
}
async function openStatic(p,id){await p.evaluate(id=>{const el=document.getElementById(id);if(!el)throw Error(id+' no existe');el.hidden=false;el.removeAttribute('inert');el.setAttribute('aria-hidden','false');if(id==='panel-agregar-nota')el.classList.add('activo');},id);}
const scenes=[{key:'resumen',section:'resumen',setup:async()=>{}},...Object.entries(fixtures).map(([key,setup])=>({key,setup,section:['haku-inicio','haku-respuesta','notificaciones','cuenta','ficha-reserva'].includes(key)?'resumen':key}))];
for(const [key,id,section]of [['nueva-reserva','modal-nueva-reserva','resumen'],['bloqueo-calendario','modal-bloqueo-calendario','calendario'],['anadir-nota','panel-agregar-nota','resumen'],['anadir-servicio','resumen-servicio-modal','resumen']])scenes.push({key,section,setup:p=>openStatic(p,id),scope:'markup de formulario real; datos vacíos'});
for(const [key,id]of [['reservas-filtros','reservas-panel-filtros'],['reservas-columnas','reservas-panel-columnas']])scenes.push({key,section:'reservas',setup:async p=>{await fixtures.reservas(p);await openStatic(p,id)}});
scenes.push({key:'calendario-redes-publico',file:'calendario-redes.html',setup:async()=>{},scope:'página pública, sin token ni datos externos'});
scenes.push({key:'libro-comparacion-externo',file:'libro-comparacion.html',setup:async()=>{},scope:'página independiente, acceso y estructura; sin sesión de producción'});
for(const step of ['cabana','detalles','confirmacion'])scenes.push({key:'nueva-reserva-'+step,section:'resumen',scope:'markup de etapa real; datos sintéticos',setup:async p=>{await openStatic(p,'modal-nueva-reserva');await p.evaluate(step=>document.querySelectorAll('.nueva-reserva-seccion').forEach(e=>{e.hidden=e.id!=='reserva-paso-'+step;e.classList.toggle('activa',!e.hidden)}),step)}});
scenes.push({key:'saldo-a-favor',section:'pagos',setup:async p=>{
 await p.evaluate(()=>{window.haikuSupabase={rpc:async name=>({data:name==='haiku_saldo_favor_unidad'?{saldo_a_favor:40000,fuentes:[{disponible:40000,medio_pago:'transferencia',fecha_pago:'2026-10-22',glosa:'Pago de prueba'}],cargos_servicio:[{cargo_id:'demo-cargo',cabana:1,hora:'20:45',concepto:'Tinaja',saldo:30000}]}:[]})};window.haikuTienePermiso=()=>true;});
 await p.addScriptTag({content:read('js/supabase-saldo-favor-v2.js')});await p.evaluate(()=>HAIKU_SALDO_FAVOR_V2.abrir('demo-reserva'));
}});
scenes.push({key:'ficha-detalle-financiero',section:'resumen',setup:async p=>{
 await openStatic(p,'ficha-reserva-modal');await p.evaluate(()=>{const m=document.getElementById('ficha-reserva-modal');m.dataset.reservaId='demo-reserva';m.dataset.numeroCabana='1';window.haikuSupabase={rpc:async()=>({data:{es_grupo:false}}),from:table=>{const rows=table==='vista_estado_cargos'?[{cargo_id:'demo-cargo',reserva_id:'demo-reserva',tipo_cargo:'alojamiento',concepto:'Alojamiento',estado:'activo',monto_ajustado:320000,aplicado_neto:160000,saldo_cargo:160000}]:[];const q={select(){return q},in(){return q},eq(){return q},order(){return q},then(resolve){resolve({data:rows})}};return q}};});
 await p.addScriptTag({content:read('js/supabase-finanzas-resumen-v1.js')});await p.addScriptTag({content:read('js/supabase-ficha-atajos.js')});await p.locator('#ficha-pago-total').scrollIntoViewIfNeeded();await p.evaluate(()=>HAIKU_FICHA_ATAJOS_V2.abrirDetalle('ficha-pago-total'));
}});
async function run(){
 fs.mkdirSync(output,{recursive:true});const html=await panelSinDatos();
 const strip=s=>s.replace(/<script\b[\s\S]*?<\/script>/g,'');
 const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost').pathname;const f=path.resolve(root,'.'+decodeURIComponent(u));if(u==='/'){res.setHeader('Content-Type','text/html');return res.end(html)}if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'application/javascript':f.endsWith('.html')?'text/html':'application/octet-stream');const body=fs.readFileSync(f);res.end(f.endsWith('.html')?strip(String(body)):body)}catch{res.writeHead(404).end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/';const browser=await chromium.launch({headless:true});const results=[];
 try{for(const width of[1600,390])for(const scene of scenes){const context=await browser.newContext({viewport:{width,height:width===390?844:1000},timezoneId:'America/Santiago'});await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());const p=await context.newPage();p.setDefaultTimeout(7000);const row={scene:scene.key,width,scope:scene.scope||'renderizador real con fixture sintético',errors:[],themes:{}};p.on('pageerror',e=>row.errors.push(e.message));
 try{await p.goto(url+(scene.file||''));if(!scene.file)await p.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}'});if(!scene.file)await p.evaluate(section=>{document.querySelectorAll('.seccion-app').forEach(e=>{e.classList.toggle('activa',e.id==='seccion-'+section);e.classList.remove('oculto')});document.querySelectorAll('.menu-item[data-seccion]').forEach(e=>e.classList.toggle('activo',e.dataset.seccion===section));window.fechaSeleccionada='2026-10-22';},scene.section);await scene.setup(p);await p.waitForTimeout(500);row.initialTheme=await p.locator('html').getAttribute('data-haiku-tema');let geometry;
 for(const theme of['claro','oscuro']){await p.evaluate(t=>document.documentElement.dataset.haikuTema=t,theme);await p.waitForTimeout(50);const state=await p.evaluate(estadoVisual);if(geometry)row.geometryUnchanged=JSON.stringify(state)===JSON.stringify(geometry);else geometry=state;row.themes[theme]=await p.evaluate(metrics);await p.screenshot({path:path.join(output,`${width}-${scene.key}-${theme}.png`)});}
 // An additional lower viewport catches forms and sections below the fold.
 const scrolled=await p.evaluate(()=>{const candidates=[document.scrollingElement,...document.querySelectorAll('body *')].filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return r.width>150&&r.height>150&&e.scrollHeight>e.clientHeight+100&&(e===document.scrollingElement||/auto|scroll/.test(s.overflowY))});for(const e of candidates)e.scrollTop=e.scrollHeight;return candidates.length});
 if(scrolled)for(const theme of['claro','oscuro']){await p.evaluate(t=>document.documentElement.dataset.haikuTema=t,theme);row.themes[theme+'-abajo']=await p.evaluate(metrics);await p.screenshot({path:path.join(output,`${width}-${scene.key}-${theme}-abajo.png`)});}
 console.log('AUDIT',width,scene.key,Object.fromEntries(Object.entries(row.themes).map(([k,v])=>[k,v.failures.length])));
 }catch(e){row.error=e.message;console.log('AUDIT INCOMPLETE',width,scene.key,e.message)}finally{results.push(row);fs.writeFileSync(path.join(output,'resultados.json'),JSON.stringify(results,null,2));await context.close()}}
 }finally{await browser.close();await new Promise(r=>server.close(r))}
}
if(require.main===module){if(process.argv.includes('--generation')){const f=path.join(root,'tools/generar-tema-oscuro.cjs');const m=new Module(f,module);m.filename=f;m.paths=module.paths;m._compile(read('tools/generar-tema-oscuro.cjs').replace('Date, console','Date, console, URLSearchParams, location: {search: \"\"}'),f)}else run().catch(e=>{console.error(e);process.exitCode=1})}
module.exports={metrics};
