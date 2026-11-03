// Panel real con estados ficticios: sólo filtra en memoria; no usa sesiones ni datos reales.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const scripts = new Set(['js/historial.js','js/calendario.js','js/checklist.js','js/app.js','js/cabanas.js','js/sites-cabanas-v1.js']);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  for(const width of [1440,390,320]) for(const theme of ['claro','oscuro']) {
   const page=await browser.newPage({viewport:{width,height:1000},timezoneId:'America/Santiago'});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='cdn.jsdelivr.net') return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({})}'});
    if(url.hostname!=='haku-filters.test') return route.abort();
    const name=decodeURIComponent(url.pathname.slice(1)),file=path.join(root,name);
    if(name.includes('..')||!fs.existsSync(file)||!fs.statSync(file).isFile()) return route.abort();
    if(name.endsWith('.js')&&!scripts.has(name)) return route.fulfill({contentType:'application/javascript',body:''});
    return route.fulfill({contentType:name.endsWith('.html')?'text/html':name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'application/octet-stream',body:fs.readFileSync(file)});
   });
   await page.goto('http://haku-filters.test/panel.html');
   await page.waitForFunction(()=>window.HAIKU_CABANAS_SITES_V1);
   await page.evaluate(theme=>{
    fechaSeleccionada='2026-11-03';window.haikuSesion={auth:{id:'filter-fixture'}};
    document.documentElement.setAttribute('data-haiku-tema',theme);
    document.documentElement.classList.remove('haiku-cabanas-pendiente','haiku-privacidad-arranque','haiku-resumen-pendiente','haiku-pagos-pendiente');
    const d=obtenerDatosDia(fechaSeleccionada),cycle=(state,result,repaso=false)=>({fecha:fechaSeleccionada,verificado:true,estado:state,resultado:result,esRepaso:repaso});
    for(let n=1;n<=11;n++) d.cabanas[n]={revisionCompletaCiclo:cycle('pendiente',null)};
    d.cabanas[1]={revisionCompletaCiclo:cycle('completada','lista'),aseoExpressCiclo:{fecha:fechaSeleccionada,verificado:true,existe:true,estadoRevision:'pendiente'}};
    d.cabanas[2]={revisionCompletaCiclo:cycle('pendiente',null,true),repasoRevision:cycle('completada','lista')};
    d.cabanas[3]={aseoEstado:'no_requiere',revisionCompletaCiclo:cycle('pendiente',null)};
    d.cabanas[4]={aseo:'Scarla',aseoIn:'10:00',revisionCompletaCiclo:cycle('pendiente',null)};
    d.cabanas[5]={aseoIn:'09:00',aseoOut:'10:00',revisionCompletaCiclo:cycle('en_proceso',null)};
    d.cabanas[6]={revisionCompletaCiclo:cycle('completada','con_detalles')};
    d.cabanas[7]={revisionCompletaCiclo:cycle('completada','lista')};
    d.cabanas[8]={revisionCompletaCiclo:cycle('pendiente',null),aseoExpressCiclo:{fecha:fechaSeleccionada,verificado:true,existe:true,estadoRevision:'completada',resultadoRevision:'lista'}};
    d.cabanas[9]={revisionCompletaCiclo:cycle('completada','lista',true),repasoRevision:cycle('en_proceso',null)};
    window.HAIKU_ASEO_OPERACION_V1={obtenerCicloExpress:(day,n)=>obtenerDatosDia(day).cabanas[n]?.aseoExpressCiclo};
    window.HAIKU_CABANAS_SITES_V1.pintar();
    window.__filterOriginal=JSON.stringify(d.cabanas);
   },theme);
   await page.locator('.menu-item[data-seccion="cabanas"]').click();
   const selector=page.locator('#cabinsFilterCategory'),chips=page.locator('#cabinsFilters');
   const choose=async value=>{await selector.locator('summary').click();await selector.locator(`[data-cb-filter-category="${value}"]`).click();assert.equal(await chips.locator('[data-cb-filter="todas"]').getAttribute('aria-pressed'),'true');};
   const ids=()=>page.locator('#cabinsOperation article:visible').evaluateAll(rows=>rows.map(r=>Number(r.dataset.cbCabin)));
   assert.equal(await page.locator('#cabinsFilterLabel').textContent(),'Filtrar: General');
   await chips.locator('[data-cb-filter="en_curso"]').click();
   assert.equal(await page.locator('.cb-tracking-row').count(),1);
   await choose('revision');
   assert.equal((await ids()).length,11);
   await chips.getByRole('button',{name:'Lista · 3',exact:true}).click();
   assert.deepEqual(await ids(),[2,7,8],'Lista usa Repaso, completa y Express independientes');
   assert.equal(await page.locator('#cabinsFilterCount').textContent(),'3 cabañas visibles');
   await chips.getByRole('button',{name:'En revisión · 2',exact:true}).click();
   assert.deepEqual(await ids(),[5,9]);
   await chips.getByRole('button',{name:'No requiere · 1',exact:true}).click();
   assert.deepEqual(await ids(),[3]);
   await choose('aseo');
   await chips.getByRole('button',{name:'Pendiente · 8',exact:true}).click();
   assert.deepEqual(await ids(),[1,2,6,7,8,9,10,11]);
   await chips.getByRole('button',{name:'En curso · 1',exact:true}).click();
   assert.deepEqual(await ids(),[4]);assert.equal(await page.locator('.cb-tracking-row').count(),0);
   await choose('final');
   await chips.getByRole('button',{name:'Con detalles · 1',exact:true}).click();
   assert.deepEqual(await ids(),[6]);
   await chips.getByRole('button',{name:'Todas · 11',exact:true}).click();
   assert.equal((await ids()).length,11);
   if(width<700) {
    const scroll=await chips.evaluate(n=>({width:n.clientWidth,full:n.scrollWidth,height:n.clientHeight}));
    assert.ok(scroll.full>scroll.width,'estados en una fila horizontal');assert.ok(scroll.height<=34);
    await chips.hover();await page.mouse.wheel(300,0);
    await page.waitForFunction(()=>document.querySelector('#cabinsFilters').scrollLeft>0);
   }
   await page.locator('#cabinsSummary [data-cb-filter="listas"]').click();
   assert.equal(await page.locator('#cabinsFilterLabel').textContent(),'Filtrar: General');
   assert.deepEqual(await ids(),[2,3,7,8]);
   await selector.locator('summary').focus();await page.keyboard.press('Enter');
   assert.equal(await selector.getAttribute('open'),'');await page.keyboard.press('Escape');assert.equal(await selector.getAttribute('open'),null);
   await choose('revision');
   await chips.getByRole('button',{name:'Lista · 3',exact:true}).click();
   await page.evaluate(()=>{
    const d=obtenerDatosDia(fechaSeleccionada);d.cabanas[9].repasoRevision.estado='completada';d.cabanas[9].repasoRevision.resultado='lista';
    window.HAIKU_CABANAS_SITES_V1.pintar();
   });
   assert.deepEqual(await ids(),[2,7,8,9],'un cambio recibido actualiza el filtro y su conteo');
   assert.equal(await chips.getByRole('button',{name:'Lista · 4',exact:true}).count(),1);
   await page.evaluate(()=>{obtenerDatosDia(fechaSeleccionada).cabanas[9].repasoRevision.estado='en_proceso';obtenerDatosDia(fechaSeleccionada).cabanas[9].repasoRevision.resultado=null;});
   assert.equal(await page.evaluate(()=>JSON.stringify(obtenerDatosDia(fechaSeleccionada).cabanas)===window.__filterOriginal),true,'filtrar no escribe ni cambia estados');
   const overflow=await page.locator('#seccion-cabanas').evaluate(n=>n.scrollWidth-n.clientWidth);assert.ok(overflow<=1);
   if(process.env.HAKU_UI_SHOTS){fs.mkdirSync(process.env.HAKU_UI_SHOTS,{recursive:true});await page.locator('#cabinsOperation').screenshot({path:path.join(process.env.HAKU_UI_SHOTS,`filters-${width}-${theme}.png`)});await selector.locator('summary').click();await page.screenshot({path:path.join(process.env.HAKU_UI_SHOTS,`filters-menu-${width}-${theme}.png`)});}
   assert.deepEqual(errors,[]);await page.close();console.log(`Web ${width} ${theme}: filtros, conteos, tipo activo, resumen, teclado y deslizamiento OK`);
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
