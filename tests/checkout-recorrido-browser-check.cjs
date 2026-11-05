// Actual checkout modules and markup. All reservations, users, RPCs and photos are local fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parseHTML}=require('linkedom'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),source=p=>fs.readFileSync(path.join(root,p),'utf8');
const section=parseHTML(source('index.html')).document.querySelector('#seccion-cabanas').outerHTML;
const modules=['checkout-workflow-v2.js','checkout-core-v1.js','checkout-ui-v2.js','cabanas-espacios-v1.js'];
const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/sites-cabanas-v1.css"><link rel="stylesheet" href="/css/checkout-recorrido-v2.css"><style>body{margin:0;background:#f4f7f5}html[data-haiku-tema=oscuro] body{background:#0f1915}.co-dialog{font-family:Inter,Arial,sans-serif}#seccion-cabanas{box-sizing:border-box}#cabinsOperation,#cabinsSummary,#cabinsFilters,#cabinsDetail{display:none!important}</style></head><body>${section}${modules.map(name=>`<script src="/js/${name}"></script>`).join('')}</body></html>`;
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.HAIKU_BROWSER_PATH||undefined});
 try{for(const width of [1440,390])for(const theme of ['claro','oscuro']){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='haku-checkout.test')return route.abort();if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
   const file=path.join(root,decodeURIComponent(u.pathname));if(u.pathname.includes('..')||!fs.existsSync(file))return route.abort();return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'image/svg+xml',body:fs.readFileSync(file)});});
  await page.goto('https://haku-checkout.test/');
  await page.evaluate(theme=>{
   document.documentElement.dataset.haikuTema=theme;const root=document.querySelector('#seccion-cabanas');root.classList.add('activa');
   const V=window.HAIKU_CHECKOUT_WORKFLOW_V2,rows={},loans={},calls=[],callbacks=[];window.__calls=calls;window.__rows=rows;window.__loans=loans;window.__callbacks=callbacks;window.__clipboard='';
   Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__clipboard=text;}},configurable:true});
   window.haikuSesion={user:{id:'staff'}};const day='2026-11-05';
   const departures=[3,5].map(n=>({fecha:day,cabana_id:'cab-'+n,numero:n,salida_estadia_id:'stay-'+n,salida_reserva_id:'reservation-'+n,salida_titular:n===3?'Felipe de prueba':'Salida de prueba'}));
   const empty=t=>({fecha_operativa:day,cabana_id:t.cabinId,estadia_id:t.stayId,hora_out:null,hora_out_definida:false,encargado:'',recuperados:[],chequeados:['llaves'],revision:1,reposiciones:{},observaciones:{},revision_estado:'pendiente'});
   rows['cab-3:stay-3']=empty({cabinId:'cab-3',stayId:'stay-3'});rows['cab-5:stay-5']=empty({cabinId:'cab-5',stayId:'stay-5'});
   loans['stay-3']={estadia_id:'stay-3',revision:1,items:{batas:{id:'batas',label:'Batas',area:'bano',cantidad:2,devueltos:2,origen:'notas'},cenicero:{id:'cenicero',label:'Cenicero',area:'cocina',cantidad:1,devueltos:1,origen:'manual'},asado:{id:'asado',label:'Asado',area:'terraza',cantidad:1,devueltos:1,origen:'notas'}}};
   const notes=[{estadia_id:'stay-3',textos:['Se prestó un sacacorcho; 2 batas; un set de asado']},{estadia_id:'stay-5',textos:[]}];
   window.haikuSupabase={async rpc(name,p){calls.push({name,p});if(name==='haiku_operacion_dia')return{data:departures};if(name==='haiku_revisiones_checkout_dia_v2')return{data:{fecha:day,puede_editar:true,revisiones:Object.values(rows),prestamos:Object.values(loans),notas_prestamos:notes}};
    if(name==='haiku_guardar_prestamo_estadia_v1'){const old=loans[p.p_estadia_id]||{estadia_id:p.p_estadia_id,revision:0,items:{}};const next=V.patchWorkflow({prestamos:old.items},p.p_campo,p.p_valor);const row={...old,revision:old.revision+1,items:next.prestamos};loans[p.p_estadia_id]=row;queueMicrotask(()=>callbacks.filter(c=>c.table==='prestamos_estadia').forEach(c=>c.fn({new:row})));return{data:row};}
    if(!['haiku_guardar_revision_checkout_v2','haiku_guardar_detalle_checkout_v1'].includes(name))throw Error('Consulta inesperada: '+name);
    const k=p.p_cabana_id+':'+p.p_estadia_id;let r={...rows[k]};if(p.p_campo==='hora_out'){r.hora_out=p.p_valor||null;r.hora_out_definida=true;}else if(p.p_campo==='encargado')r.encargado=p.p_valor;
    else if(p.p_campo==='chequeado'){r.chequeados=p.p_valor.checked?[...new Set([...r.chequeados,p.p_valor.id])]:r.chequeados.filter(id=>id!==p.p_valor.id);}else r=V.patchWorkflow(r,p.p_campo,p.p_valor);
    if(p.p_campo==='revision_estado'&&p.p_valor==='en_revision'&&!r.encargado)r.encargado='Felipe';r.revision++;rows[k]=r;queueMicrotask(()=>callbacks.filter(c=>c.table==='revisiones_checkout').forEach(c=>c.fn({new:r})));return{data:r};
   },channel(){return{on(_,filter,fn){callbacks.push({...filter,fn});return this;},subscribe(){return this;}};},removeChannel(){},storage:{from(){return{async upload(path,blob){window.__uploaded={path,blob};return{data:{path}};},async createSignedUrl(){return{data:{signedUrl:URL.createObjectURL(window.__uploaded.blob)}};},async remove(){return{data:[]};}}}}};
   const app=window.HAIKU_CABANAS_ESPACIOS_V1.create({root,date:()=>day,user:()=>window.haikuSesion?.user?.id,dayData:()=>({cabanas:{},notasOperativas:[]}),afterSupply:()=>{}});window.__app=app;app.render('checkout',day);
  },theme);
  const card=page.locator('[data-checkout-card="2026-11-05:cab-3:stay-3"]');await card.getByRole('button',{name:'Revisar',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Copiar para aseo',exact:true}).count(),0,'No se copia desde el listado inicial');
  await card.locator('[data-checkout-open]').click();const detail=page.locator('#cabinsCheckoutDetail');await detail.locator('[data-co-sector="cocina"]').waitFor();
  assert.deepEqual(await detail.locator('[data-co-sector]').evaluateAll(nodes=>nodes.map(n=>n.dataset.coSector)),['cocina','bano','living','terraza']);
  const reads=await page.evaluate(()=>window.__calls.filter(c=>['haiku_operacion_dia','haiku_revisiones_checkout_dia_v2'].includes(c.name)).length);
  await detail.locator('[data-co-supply="cafe"]').click();let modal=page.locator('dialog.co-dialog');await modal.locator('[data-qty="2"]').click();
  assert.ok(await modal.locator('input[type=number]').evaluate(n=>parseFloat(getComputedStyle(n).fontSize))<=16);
  await modal.getByRole('button',{name:'Listo',exact:true}).click();await modal.waitFor({state:'detached'});await detail.locator('[data-co-supply="cafe"]').filter({hasText:'2'}).waitFor();
  await detail.locator('[data-co-supply="amenities"]').click();modal=page.locator('dialog.co-dialog');await modal.locator('[data-all-qty="2"]').click();await modal.locator('input[name=jabon]').fill('1');await modal.getByRole('button',{name:'Listo',exact:true}).click();await modal.waitFor({state:'detached'});
  assert.match(await detail.locator('[data-co-message]').textContent(),/Champú × 2\n- Jabón × 1\n- Bálsamo × 2/);
  assert.equal(await detail.locator('[data-co-problem]').count(),0);assert.equal(await detail.locator('[data-co-supply="jabon_liquido"],[data-co-supply="papel_higienico"]').count(),0);
  assert.equal(await detail.locator('[data-co-area-detail][open]').count(),0);
  await detail.locator('[data-co-usage=uso_salamandra]').click();
  await detail.locator('[data-co-area-detail=living]>summary').click();await detail.locator('[data-co-detail=living]').fill('Sábana manchada con sangre');
  await detail.locator('[data-co-copy]').click();assert.match(await page.evaluate(()=>window.__clipboard),/Café × 2/);assert.match(await page.evaluate(()=>window.__clipboard),/- Usaron Salamandra/);assert.match(await page.evaluate(()=>window.__clipboard),/- No usaron Fogón/);assert.match(await page.evaluate(()=>window.__clipboard),/- Detalle: Sábana manchada con sangre/);assert.match(await page.evaluate(()=>window.__clipboard),/Artículos prestados:\n- Sacacorcho/);await detail.locator('[data-co-area-detail=living]>summary').click();await detail.locator('[data-co-area-detail=living]>summary').click();assert.equal(await detail.locator('[data-co-detail=living]').inputValue(),'Sábana manchada con sangre');
  // The browser camera produces a real canvas stream; all stored files stay in the fixture.
  await page.evaluate(()=>{Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;canvas.getContext('2d').fillRect(0,0,64,64);const stream=canvas.captureStream(5);window.__cameraStream=stream;return stream;}},configurable:true});});
  await detail.locator('[data-co-area-camera=living]').click();modal=page.locator('dialog.co-dialog');await modal.getByRole('button',{name:'Tomar foto',exact:true}).click();await modal.locator('video').waitFor();await page.waitForFunction(()=>document.querySelector('dialog video')?.videoWidth>0);
  await modal.getByRole('button',{name:'Capturar',exact:true}).click();await modal.locator('[data-photo-name]').filter({hasText:'Foto tomada'}).waitFor();await modal.getByRole('button',{name:'Guardar foto',exact:true}).click();await modal.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.__cameraStream.getTracks().every(t=>t.readyState==='ended')),true,'La cámara se apaga tras capturar');
  assert.match(await page.evaluate(()=>window.__rows['cab-3:stay-3'].detalles.living.foto_path),/detalle_living_[a-f0-9]{32}[.]jpg$/);
  const download=page.waitForEvent('download');await detail.locator('[data-co-download-area-photo=living]').click();const evidence=await download;assert.match(evidence.suggestedFilename(),/^Haku-detalle_living_/);assert.equal(await evidence.failure(),null);
  await detail.locator('[data-co-add]').click();modal=page.locator('dialog.co-dialog');await modal.locator('[data-pick-loan="juegos_mesa"]').click();await modal.locator('input[name=cantidad]').fill('2');await modal.getByRole('button',{name:'Añadir',exact:true}).click();await modal.getByText('Juegos de mesa',{exact:true}).waitFor();await modal.locator('[data-dialog-close]').click();
  await detail.locator('[data-co-return=juegos_mesa]').click();modal=page.locator('dialog.co-dialog');await modal.locator('input[name=devueltos]').fill('1');await modal.getByRole('button',{name:'Listo',exact:true}).click();await modal.waitFor({state:'detached'});
  assert.match(await detail.locator('[data-co-return=juegos_mesa]').textContent(),/1\/2/);
  await detail.locator('[data-co-observation=mantencion]').click();modal=page.locator('dialog.co-dialog');await modal.locator('textarea').fill('Revisar la llave de ducha.');await modal.locator('[data-photo-options]').click();assert.equal(await modal.getByRole('button',{name:'Tomar foto',exact:true}).isVisible(),true);const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=10;canvas.height=10;return canvas.toDataURL('image/png').split(',')[1];});await modal.locator('input[name=foto]').setInputFiles({name:'ducha.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await modal.getByRole('button',{name:'Guardar',exact:true}).click();await modal.waitFor({state:'detached'});
  assert.match(await detail.locator('[data-co-observations]').textContent(),/Mantención/);assert.doesNotMatch(await detail.locator('[data-co-message]').textContent(),/ducha/);
  const maintenanceDownload=page.waitForEvent('download');await detail.locator('[data-co-download-photo]').click();assert.match((await maintenanceDownload).suggestedFilename(),/^Haku-obs_/);
  await detail.locator('[data-co-copy-maintenance]').click();assert.match(await page.evaluate(()=>window.__clipboard),/^@Mantención/);assert.match(await page.evaluate(()=>window.__clipboard),/Revisar la llave/);assert.doesNotMatch(await page.evaluate(()=>window.__clipboard),/Café|Sacacorcho/);
  await detail.locator('[data-co-supply=te]').click();modal=page.locator('dialog.co-dialog');await modal.locator('input[type=number]').fill('100');await modal.getByRole('button',{name:'Listo',exact:true}).click();await modal.locator('[data-dialog-error]').filter({hasText:'99'}).waitFor();await modal.locator('[data-dialog-close]').click();
  for(const id of ['cocina','bano','living','terraza'])await detail.locator(`[data-checkout-item=${id}]`).click();
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>['haiku_operacion_dia','haiku_revisiones_checkout_dia_v2'].includes(c.name)).length),reads,'Las marcas, reposiciones y préstamos no recargan operación ni Resumen');
  if(process.env.HAKU_UI_SHOTS){fs.mkdirSync(process.env.HAKU_UI_SHOTS,{recursive:true});await detail.screenshot({path:path.join(process.env.HAKU_UI_SHOTS,`checkout-web-${width}-${theme}.png`)});}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Sin desborde horizontal');
  await detail.locator('[data-co-finish]').click();await card.waitFor();assert.equal(await card.locator('[data-co-status]').textContent(),'Revisada');assert.match(await card.locator('[data-co-loans]').textContent(),/por recuperar/);
  await page.locator('[data-checkout-retry]').click();await card.getByRole('button',{name:'Abrir',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__loans['stay-3'].items.juegos_mesa.cantidad),2);
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
 console.log('Checkout web: desktop/móvil, claro/oscuro, cantidades, préstamos, observaciones, guardado y ausencia de recargas OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
