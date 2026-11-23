const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const scenario=require('./fixtures/huespedes-figma/scenario.cjs');
const root=path.resolve(__dirname,'..');
const out=process.env.HAKU_GUEST_SHOTS;
if(!out)throw new Error('HAKU_GUEST_SHOTS must name an evidence directory.');
const native=process.env.HAKU_GUEST_NATIVE_PREVIEW;
const allowed=new Set(['js/historial.js','js/calendario.js','js/checklist.js','js/app.js','js/cabanas.js','js/haiku-huespedes-api-v1.js','js/haiku-huespedes-v1.js']);
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.ttf':'font/ttf','.woff':'font/woff','.png':'image/png'};
async function settled(page){await page.evaluate(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));await new Promise(requestAnimationFrame);});}
function shell(page){
 return page.evaluate(()=>{
  const box=(selector)=>{
   const node=document.querySelector(selector);
   const style=getComputedStyle(node),{width,height}=node.getBoundingClientRect();
   return {width,height,display:style.display,padding:style.padding,font:style.fontFamily,background:style.backgroundColor};
  };
  const nav=document.querySelector('.sites-shell-sidebar nav.menu');
  return {
   sidebar:box('.sites-shell-sidebar'),
   header:box('.sites-shell-topbar'),
   brand:box('.sites-shell-sidebar .logo'),
   search:box('.sites-shell-topbar .busqueda-reservas-wrap'),
   keyword:box('.sites-shell-topbar .busqueda-palabra-wrap'),
   add:box('.sites-shell-topbar .boton-nueva-reserva'),
   notices:box('.sites-shell-topbar .boton-notificaciones'),
   menu:[...nav.children].filter(item=>item.getClientRects().length).map(item=>{
    const style=getComputedStyle(item);
    return [item.textContent.trim(),style.order,style.minHeight,style.fontSize,style.padding];
   }),
  };
 });
}
async function assertSharedShell(page){
 const menu=page.locator('.sites-shell-sidebar nav.menu');
 const guestShell=await shell(page);
 await menu.locator('[data-seccion=calendario]').evaluate(button=>button.click());
 await page.locator('#seccion-calendario.activa').waitFor();
 assert.deepEqual(guestShell,await shell(page),'Huéspedes usa el mismo encabezado y menú que Calendario');
 await menu.locator('[data-seccion=huespedes]').evaluate(button=>button.click());
 await page.locator('#seccion-huespedes.activa').waitFor();
 await menu.locator('[data-seccion=huespedes].activo').waitFor();
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.HAIKU_BROWSER_PATH||undefined});
 const measurements=[];
 try{
  for(const theme of ['claro','oscuro']){
   const page=await browser.newPage({viewport:{width:1440,height:1360},deviceScaleFactor:1});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.exposeFunction('__rpc',async(n,a)=>({data:scenario.rpc(n,a),error:null}));
   await page.addInitScript(theme=>{
    localStorage.setItem('haikuSeccionActual','huespedes');window.haikuSesion={auth:{id:'fictional-user'},usuario:{nombre:'Felipe'}};
    window.haikuTienePermiso=()=>true;
    window.haikuSupabase={rpc:window.__rpc,auth:{onAuthStateChange(){}},storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'/tests/fixtures/huespedes-figma/demo-avatar.png'}})})}};
    addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.haikuTema=theme;document.documentElement.classList.remove('haiku-privacidad-arranque','haiku-resumen-pendiente','haiku-cabanas-pendiente','haiku-pagos-pendiente');});
   },theme);
   await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({})}'});
    if(url.hostname!=='haku-figma.test')return route.abort();
    const name=decodeURIComponent(url.pathname.slice(1));const file=path.join(root,name);
    if(name.includes('..')||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.abort();
    if(name.endsWith('.js')&&!allowed.has(name))return route.fulfill({contentType:'application/javascript',body:''});
    return route.fulfill({path:file,contentType:mime[path.extname(name)]});
   });
   await page.goto('https://haku-figma.test/panel.html');
   const section=page.locator('#seccion-huespedes');const card=section.locator('.hu-ficha');
   await card.getByRole('heading',{name:'Diego Rojas',exact:true}).waitFor();
   await page.evaluate(theme=>{document.documentElement.dataset.haikuTema=theme;document.documentElement.classList.remove('haiku-privacidad-arranque','haiku-resumen-pendiente','haiku-cabanas-pendiente','haiku-pagos-pendiente');},theme);
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForFunction(()=>document.querySelector('.hu-avatar-perfil img')?.complete);
   await assertSharedShell(page);
   await settled(page);await page.screenshot({path:path.join(out,'web-'+theme+'-perfil.png'),fullPage:true});
   measurements.push({client:'web',theme,geometry:await section.evaluate(n=>Object.fromEntries(['.hu-layout','.hu-lista','.hu-ficha','.hu-estadia-fila'].map(key=>{const r=n.querySelector(key).getBoundingClientRect();return [key,{x:r.x,y:r.y,w:r.width,h:r.height}];})))});
   const geometry=measurements.at(-1).geometry;
   assert.ok(geometry['.hu-lista'].w>geometry['.hu-ficha'].w&&geometry['.hu-ficha'].w>=338,'directorio y ficha aprovechan el espacio horizontal');
   assert.equal(geometry['.hu-layout'].y,geometry['.hu-ficha'].y);
   assert.equal(geometry['.hu-estadia-fila'].h,68);
   const modal=section.locator('dialog');
   for(const [name,open] of [
    ['foto',()=>card.getByRole('button',{name:'Cambiar foto',exact:true}).click()],
    ['vehiculo',()=>card.getByRole('button',{name:'Ver perfil',exact:true}).nth(1).click()],
    ['mascota',()=>card.getByRole('button',{name:'Ver perfil',exact:true}).nth(2).click()],
    ['etiquetas',()=>card.getByRole('button',{name:'Editar',exact:true}).nth(0).click()],
    ['nota',()=>card.getByRole('button',{name:'Registrar información',exact:true}).click()],
   ]){
    await open();await modal.waitFor({state:'visible'});await settled(page);await page.screenshot({path:path.join(out,'web-'+theme+'-'+name+'.png')});
    assert.equal(await modal.evaluate(n=>n.scrollWidth>n.clientWidth+1),false,'form fits');
    await modal.getByRole('button',{name:'Cerrar',exact:true}).click();
   }
   await card.getByRole('button',{name:'Ver perfil',exact:true}).first().click();
   await card.getByRole('heading',{name:'Camila Pérez',exact:true}).waitFor();
   assert.equal(await card.getByText('Prefiere chocolate amargo.',{exact:true}).count(),0);
   await settled(page);await page.screenshot({path:path.join(out,'web-'+theme+'-acompanante.png')});
   await card.getByRole('button',{name:'Ver perfil',exact:true}).first().click();
   await card.getByRole('heading',{name:'Diego Rojas',exact:true}).waitFor();
   await card.getByRole('button',{name:'Completar',exact:true}).click();
   await card.getByRole('button',{name:'Completar datos',exact:true}).click();await page.screenshot({path:path.join(out,'web-'+theme+'-borrador.png')});
   await modal.getByRole('button',{name:'Cerrar',exact:true}).click();
   await page.setViewportSize({width:390,height:850});
   await assertSharedShell(page);
   assert.ok(await section.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'Huéspedes cabe en el ancho del móvil');
   assert.deepEqual(errors,[]);await page.close();
   if(!native)continue;
   const mobile=await browser.newPage({viewport:{width:390,height:1141},colorScheme:theme==='oscuro'?'dark':'light',hasTouch:true,isMobile:true});
   const nativeErrors=[];mobile.on('pageerror',e=>nativeErrors.push(e.message));
   await mobile.exposeFunction('__rpc',async(n,a)=>({data:scenario.rpc(n,a),error:null}));
   await mobile.addInitScript(()=>{window.haikuSupabase={rpc:window.__rpc,storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'/demo-avatar.png'}})})}};});
   await mobile.route('**/*',route=>{
    const url=new URL(route.request().url());if(url.hostname!=='haku-native-figma.test')return route.abort();
    const name=decodeURIComponent(url.pathname.slice(1))||'index.html';
    const file=name==='demo-avatar.png'?path.join(root,'tests/fixtures/huespedes-figma/demo-avatar.png'):path.join(native,name);
    if(name.includes('..')||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.abort();
    return route.fulfill({path:file,contentType:mime[path.extname(name)]});
   });
   await mobile.goto('https://haku-native-figma.test/');
   const titleButton=mobile.getByRole('button',{name:'Ver perfil de Diego Rojas',exact:true});
   await titleButton.waitFor().catch(async error=>{
     await mobile.screenshot({path:path.join(out,'android-browser-failure.png')});
     throw new Error(JSON.stringify({errors:nativeErrors,body:await mobile.locator('body').innerText(),cause:error.message}));
   });
   await settled(mobile);await mobile.screenshot({path:path.join(out,'android-browser-'+theme+'-directorio.png')});
   const nativeRow=await mobile.getByTestId('guest-stay-stay-guest-0').boundingBox();
   measurements.push({client:'native-components',theme,directoryRow:nativeRow});
   assert.ok(Math.abs(nativeRow.x-13)<=1&&Math.abs(nativeRow.width-364)<=2&&nativeRow.height===94,'mobile row width and height match Figma');
   await mobile.setViewportSize({width:390,height:1232});
   await titleButton.click();await mobile.getByRole('heading',{name:'Diego Rojas',exact:true}).waitFor();
   await settled(mobile);await mobile.screenshot({path:path.join(out,'android-browser-'+theme+'-perfil.png')});
   const nativeCard=await mobile.getByTestId('guest-profile-card').boundingBox();
   measurements.at(-1).profile=nativeCard;
   assert.ok(Math.abs(nativeCard.x-12)<=1&&Math.abs(nativeCard.y-114)<=2&&Math.abs(nativeCard.width-366)<=1&&Math.abs(nativeCard.height-1030)<=4,'mobile profile matches approved compact dimensions');
   for(const [name,open] of [
    ['foto',()=>mobile.getByRole('button',{name:'Cambiar foto',exact:true}).click()],
    ['vehiculo',()=>mobile.getByRole('button',{name:'Ver perfil',exact:true}).nth(1).click()],
    ['mascota',()=>mobile.getByRole('button',{name:'Ver perfil',exact:true}).nth(2).click()],
    ['etiquetas',()=>mobile.getByRole('button',{name:'Editar',exact:true}).nth(0).click()],
    ['nota',()=>mobile.getByRole('button',{name:'Registrar información',exact:true}).click()],
   ]){
    await mobile.setViewportSize({width:390,height:{foto:795,vehiculo:731,mascota:740,etiquetas:883,nota:768}[name]});
    await open();await mobile.getByRole('button',{name:'Cerrar',exact:true}).waitFor();
    await settled(mobile);
    await mobile.screenshot({path:path.join(out,'android-browser-'+theme+'-'+name+'.png')});
    await mobile.getByRole('button',{name:'Cerrar',exact:true}).click();
    await mobile.setViewportSize({width:390,height:1232});
   }
   await mobile.getByRole('button',{name:'Ver perfil',exact:true}).first().click();
   await mobile.getByRole('heading',{name:'Camila Pérez',exact:true}).waitFor();
   assert.equal(await mobile.getByText('Prefiere chocolate amargo.',{exact:true}).count(),0);
   await mobile.screenshot({path:path.join(out,'android-browser-'+theme+'-acompanante.png')});
   await mobile.getByRole('button',{name:'Ver perfil',exact:true}).first().click();
   await mobile.getByRole('heading',{name:'Diego Rojas',exact:true}).waitFor();
   await mobile.getByRole('button',{name:'Completar',exact:true}).click();await mobile.getByRole('button',{name:'Completar datos',exact:true}).click();
   await mobile.setViewportSize({width:390,height:767});
   await mobile.screenshot({path:path.join(out,'android-browser-'+theme+'-borrador.png')});
   assert.deepEqual(nativeErrors,[]);await mobile.close();
  }
  fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify(measurements,null,2));
  console.log('Rendered real web and native components with Figma fictional content: '+out);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
