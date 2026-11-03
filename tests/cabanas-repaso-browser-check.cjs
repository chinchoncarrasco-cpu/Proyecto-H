// Interacción real del listado y ficha Web, con persistencia simulada; sin datos productivos.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const scripts = new Set(['js/historial.js', 'js/calendario.js', 'js/checklist.js', 'js/app.js', 'js/cabanas.js', 'js/sites-cabanas-v1.js', 'js/haiku-repaso-checklist-v1.js', 'js/supabase-repaso-v2.js']);
(async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  for (const width of [1440, 390, 320]) for (const theme of ['claro', 'oscuro']) {
   const page = await browser.newPage({ viewport: { width, height: 1000 }, timezoneId: 'America/Santiago' });
   const errors = [];
   page.on('pageerror', error => errors.push(error.message));
   page.on('dialog', dialog => dialog.dismiss());
   await page.addInitScript(profile => {
    window.haikuSesion = { auth: { id: 'test-repaso' } };
    const catalog = profile.sections.flatMap(s => s.items.map(i => ({id:`db-${i.id}`,nombre:i.label,categoria:s.category,activo:true})));
    window.__db = { cabanas:Array.from({length:11},(_,i)=>({id:`cab-${i+1}`,numero:i+1,activa:true})),checklist_items:catalog,
      revisiones_cabana:[{id:'repaso-1',fecha:'2026-11-03',cabana_id:'cab-1',tipo_revision:'repaso',estado:'pendiente',resultado:null,observaciones:'',creado_en:'2026-11-03'}],revision_items:[] };
    window.__writes=[];
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__clipboard=text},readText:async()=>window.__clipboard||''}});
    window.haikuSupabase = { rpc: async () => ({ data: [], error: null }), from(table) {
      let op='read',payload,filters=[],single=false;
      const q = {select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},neq(k,v){filters.push(r=>r[k]!==v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},order(){return q},limit(){return q},
        update(v){op='update';payload=v;return q},insert(v){op='insert';payload=v;return q},upsert(v){op='upsert';payload=v;return q},
        single(){single=true;return q},maybeSingle(){single=true;return q},
        async then(resolve,reject){try {
          if(op!=='read') {await new Promise(r=>setTimeout(r,window.__writeDelay??20)); if(window.__dbFail) return resolve({data:null,error:new Error('Sin permiso')});window.__writes.push({table,op,payload});}
          let data=window.__db[table].filter(r=>filters.every(f=>f(r)));
          if(op==='update') data.forEach(r=>Object.assign(r,payload));
          if(op==='insert'){data=[{id:`new-${table}-${window.__writes.length}`,...payload}];window.__db[table].push(...data);}
          if(op==='upsert'){let row=window.__db[table].find(r=>r.revision_id===payload.revision_id&&r.checklist_item_id===payload.checklist_item_id);if(row)Object.assign(row,payload);else window.__db[table].push(payload);data=[payload];}
          resolve({data:structuredClone(single?data[0]||null:data),error:null});
        }catch(error){reject(error)}}};return q;
    }};
    window.HAIKU_PRIVACIDAD = { estado: () => ({ modo: 'visible', armado: true }) };
   }, require('../js/haiku-repaso-checklist-v1.js'));
   await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient:()=>({})}' });
    if (u.hostname !== 'haku-repaso.test') return route.abort();
    const name = decodeURIComponent(u.pathname.slice(1));
    if (name.includes('..')) return route.abort();
    const file = path.join(root, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    if (name.endsWith('.js') && !scripts.has(name)) return route.fulfill({ contentType: 'application/javascript', body: '' });
    return route.fulfill({ contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'application/javascript' : 'application/octet-stream', body: fs.readFileSync(file) });
   });
   await page.goto('http://haku-repaso.test/panel.html');
   await page.waitForFunction(() => Boolean(window.HAIKU_CABANAS_SITES_V1));
   await page.evaluate(theme => {
    document.documentElement.setAttribute('data-haiku-tema', theme);
    fechaSeleccionada = '2026-11-03';
    const data = obtenerDatosDia(fechaSeleccionada);
    data.cabanas['1'] = { aseoEstado: 'pendiente', detallesRevision: 'Observación existente', checklist: {}, revisionCompletaCiclo: {
     fecha: fechaSeleccionada, verificado: true, id: 'rev-1', estado: 'completada', resultado:'lista', esRepaso: false,
    } };
    window.__repasoWrites = [];
    window.HAIKU_REVISION_SUPABASE_V1 = { async guardarTipoRevision(number, type, day) {
     await new Promise(r=>setTimeout(r,window.__modeDelay??20));
     if (window.__repasoFail) throw new Error('Sin conexión');
     window.__repasoWrites.push({ number, type, day });
     const cabin = obtenerDatosDia(day).cabanas[number];
     cabin.revisionCompletaCiclo.esRepaso = type === 'repaso'; guardarDatos();
    } };
    guardarDatos(); window.HAIKU_CABANAS_SITES_V1.pintar(fechaSeleccionada);
   }, theme);
   await page.locator('.menu-item[data-seccion="cabanas"]').click();
   const row = page.locator('#cabinsOperation [data-cb-cabin="1"]');
   const repaso = row.locator('[data-cb-repaso="1"]');
   await page.evaluate(()=>{window.__timeNode=document.querySelector('#cabinsOperation [data-cb-cabin="1"] input[type="time"]');window.__modeDelay=800;});
   await repaso.click();
   assert.equal(await repaso.getAttribute('aria-pressed'),'true','selección optimista antes de confirmar');
   assert.equal(await repaso.textContent(),'Repaso','seleccionar el tipo no significa completar');
   assert.equal(await page.evaluate(()=>window.__timeNode===document.querySelector('#cabinsOperation [data-cb-cabin="1"] input[type="time"]')),true,'no reconstruye la fila');
   const textRect=await row.locator('[data-cb-revision-state]').boundingBox(), actionRect=await repaso.boundingBox();
   const actionCenter=actionRect.x+actionRect.width/2-7;
   assert.ok(Math.abs(actionCenter-(textRect.x+textRect.width/2))<5,'Repaso centrado bajo el texto');
   await page.waitForFunction(()=>window.__repasoWrites.length===1);
   assert.equal((await row.locator('.cb-final-status').textContent()).includes('Pendiente'),true,'Completa Lista no hace listo a Repaso pendiente');
   await row.locator('[data-cb-open="1"]').click();
   await page.waitForFunction(()=>document.querySelectorAll('#repaso-checklist [data-repaso-item]').length===26);
   assert.equal(await page.locator('#repaso-individual').isVisible(),true);
   assert.equal(await page.locator('#revision-individual').isVisible(),false);
   assert.equal(await page.locator('#repaso-count').textContent(),'0/26');
   assert.equal(await page.locator('#repaso-checklist .cb-sector-head[aria-expanded="false"]').count(),4,'todas las áreas cerradas');
   await page.locator('#repaso-checklist .cb-sector-head').first().click();
   const detail=page.locator('#repaso-detail-living');
   await page.evaluate(()=>{window.__writeDelay=750;});
   await detail.fill('Limpiar lámparas');await page.waitForTimeout(480);
   await detail.fill('Limpiar lámparas y cajones sin perder lo escrito');
   await page.evaluate(()=>window.HAIKU_REPASO_V2.hidratar());
   assert.equal(await detail.inputValue(),'Limpiar lámparas y cajones sin perder lo escrito');
   await page.locator('[data-repaso-copy="living"]').click();
   assert.equal(await page.evaluate(()=>window.__clipboard),'🛏️ LIVING / CAMA\nLimpiar lámparas y cajones sin perder lo escrito');
   await page.locator('[data-repaso-item="repaso-living-cama"]').check();
   await page.locator('#repaso-status').selectOption('lista');
   assert.equal(await page.locator('#repaso-final').textContent(),'Lista','Lista de Repaso manda inmediatamente');
   await page.waitForFunction(()=>window.__db.revisiones_cabana[0].resultado==='lista');
   assert.equal(await detail.inputValue(),'Limpiar lámparas y cajones sin perder lo escrito');
   await page.locator('#cabinsReviewMode').selectOption('completa');
   await page.waitForFunction(()=>document.querySelector('#revision-individual')?.classList.contains('activa'));
   assert.equal(await page.locator('#revision-detalles').inputValue(),'Observación existente');
   assert.ok(await page.locator('#revision-checklist [data-checklist-id]').count()>26,'completa conserva su checklist');
   await page.locator('#cabinsReviewMode').selectOption('repaso');
   await page.waitForFunction(()=>document.querySelector('#repaso-individual')?.classList.contains('activa'));
   await page.locator('#repaso-checklist .cb-sector-head').first().click();
   assert.equal(await detail.inputValue(),'Limpiar lámparas y cajones sin perder lo escrito');
   await page.locator('#volver-cabanas').click();
   await page.evaluate(()=>{
     const data=obtenerDatosDia(fechaSeleccionada).cabanas['1'];data.aseoEstado='no_requiere';window.HAIKU_CABANAS_SITES_V1.pintar();
   });
   for(const selector of ['[data-cb-aseo-state]','[data-cb-revision-state]','[data-cb-final-state]'])assert.equal(await row.locator(selector).textContent(),'No requiere');
   await page.evaluate(()=>{obtenerDatosDia(fechaSeleccionada).cabanas['1'].aseoEstado='pendiente';window.HAIKU_CABANAS_SITES_V1.pintar();});
   assert.equal(await row.locator('[data-cb-final-state]').textContent(),'Lista');
   await page.evaluate(()=>{window.__repasoFail=true;window.__modeDelay=20;});await repaso.click();
   await page.waitForFunction(()=>document.querySelector('#cabinsOperation [data-cb-repaso="1"]')?.getAttribute('aria-pressed')==='true');
   await page.waitForTimeout(80);assert.equal(await repaso.getAttribute('aria-pressed'),'true','error restaura el tipo confirmado');
   assert.deepEqual(errors, []);
   if (process.env.HAKU_UI_SHOTS) {
    fs.mkdirSync(process.env.HAKU_UI_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.HAKU_UI_SHOTS, `repaso-web-${width}-${theme}.png`) });
   }
   console.log(`PASS Web Repaso ${width} ${theme}: optimismo, 26 ítems, datos aislados, texto estable, Lista y No requiere.`);
   await page.close();
  }
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
