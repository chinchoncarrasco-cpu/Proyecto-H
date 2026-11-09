// Panel y tablero reales. Identidades ficticias y lecturas aisladas, sin escrituras.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const auditor=read('tests/haiku-tema-browser-check.cjs');
const contraste=vm.runInNewContext('('+auditor.slice(auditor.indexOf('function auditarContraste()'),auditor.indexOf('main().catch'))+')');
async function htmlPanel(){
 let html;const document={createElement:()=>({}),head:{appendChild:s=>s.onload()},open(){},write:s=>html=s,close(){}};
 await vm.runInNewContext(read('panel.html').match(/<script>([\s\S]*)<\/script>/)[1],{document,window:{supabase:{createClient(){}}},fetch:async()=>({ok:true,text:async()=>read('index.html')}),Date,console,URLSearchParams,location:{search:""}});
 return html.replace(/<script\b[\s\S]*?<\/script>/g,'').replace(/class="haiku-privacidad-arranque[^"]*"/,'');
}
(async()=>{
 const html=await htmlPanel();const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost').pathname;
  if(u==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html);return;}
  const f=path.resolve(root,'.'+u);if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{res.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css; charset=utf-8':f.endsWith('.svg')?'image/svg+xml':'application/octet-stream'}).end(fs.readFileSync(f));}catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
 const browser=await chromium.launch({headless:true,executablePath:process.env.HAKU_CHROMIUM_PATH});
 try{
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:1000},timezoneId:'America/Santiago'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
   await page.goto(url);await page.evaluate(()=>{
    window.fechaSeleccionada='2026-11-08';window.datosPorFecha={};window.__reads=[];window.__permission=true;
    window.haikuSesion={usuario:{id:'ficticio'}};window.haikuTienePermiso=()=>window.__permission;
    const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const name=n=>['','Andrea Rojas','Bruno Díaz','Camila Torres','Diego Soto','Elena Pérez'][n];
    const op=(cab,n,estado)=>({numero:cab,estado_operativo:estado,continua_reserva_id:id(n),continua_estadia_id:id(n+10),continua_titular:name(n),
     ingreso_reserva_id:id(n),ingreso_estadia_id:id(n+10),ingreso_titular:name(n),salida_reserva_id:id(cab===1?n-1:n),salida_estadia_id:id((cab===1?n-1:n)+10),salida_titular:name(cab===1?n-1:n)});
    window.__ops={};for(const [dia,n] of [['2026-11-07',1],['2026-11-08',2],['2026-11-09',3]]){
     __ops[dia]=[op(1,n,n===1?'continua':'sale-ingresa'),op(2,4,'continua'),op(3,5,dia==='2026-11-09'?'libre-libre':dia==='2026-11-08'?'sale-libre':'continua')];
     datosPorFecha[dia]={cabanas:{}};
     __ops[dia].forEach(o=>{const n=o.numero===1?Number(o.ingreso_reserva_id.slice(-2)):o.numero===2?4:5;
      datosPorFecha[dia].cabanas[o.numero]={estado:o.estado_operativo,reservaId:id(n),estadiaId:id(n+10),estadoEstadia:n===1||n===5?'checked_out':n===4?'hospedada':'confirmada',titular:name(n),adultos:2};});
    }
    for(const row of document.querySelectorAll('.sites-resumen-cabana')){
     const cab=Number(row.dataset.cabana),o=__ops['2026-11-08'].find(x=>x.numero===cab),n=cab===1?2:cab===2?4:5;
     row.dataset.resumenFecha='2026-11-08';row.querySelector('[data-campo="estado"]').value=o?.estado_operativo||'libre-libre';
     if(o){Object.assign(row.dataset,{resumenReservaId:id(n),resumenEstadiaId:id(n+10),resumenTitularReservaId:id(n),resumenTitular:name(n),resumenSalidaTitular:o.salida_titular});}
     if(cab>3)row.remove();
    }
    window.haikuSupabase={rpc:async(nombre,p)=>{if(nombre!=='haiku_operacion_dia')throw Error('RPC inesperada '+nombre);return {data:structuredClone(__ops[p.p_fecha]||[])};}};
    window.haikuLeerFichaSupabaseV2=async reservaId=>{
     __reads.push(reservaId);const n=Number(reservaId.slice(-2)),cab=n<=3?1:n===4?2:3;
     const ingreso=n===2?'2026-11-08':n===3?'2026-11-09':'2026-11-06',salida=n===1||n===5?'2026-11-08':n===2?'2026-11-09':'2026-11-11';
     const state=n===1||n===5?'checked_out':n===4?'hospedada':'confirmada';
     const e={id:id(n+10),reserva_id:reservaId,cabana_numero:cab,fecha_ingreso:ingreso,fecha_salida:salida,tipo_estadia:'alojamiento',estado_estadia:state,adultos:2};
     return {reserva:{id:reservaId,codigo_haiku:'H-DEMO-'+n,titular_nombre:name(n),estado_reserva:'confirmada',observaciones:''},
      estadias:n===2?[{...e,id:id(99),cabana_numero:5},e]:[e],huespedes:[],servicios:[],cargos:[],pagos:[],notas:[],solicitudes:[],boves:{}};
    };
   });
   for(const p of ['js/haiku-reserva-estado-manual-v1.js','js/supabase-finanzas-resumen-v1.js','js/sites-resumen-drawer-v1.js','js/sites-resumen-reserva-v1.js','js/supabase-resumen-tablero-v1.js'])await page.addScriptTag({content:read(p)});
   const row=page.locator('.sites-resumen-cabana[data-cabana="1"]');
   await page.waitForFunction(()=>document.querySelector('.sites-resumen-dia--anterior')?.dataset.resumenDiaAcceso==='true');
   for(const tema of ['claro','oscuro']){
    await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
    const hospedado=page.locator('.sites-resumen-cabana[data-cabana="2"] .sites-resumen-dia--actual');
    const checkout=row.locator('.sites-resumen-dia--anterior');
    const colors=await Promise.all([hospedado,checkout].map(e=>e.evaluate(n=>getComputedStyle(n).backgroundColor)));
    assert.notEqual(colors[0],colors[1]);
    if(tema==='oscuro'){assert.equal(colors[0],'rgb(22, 72, 47)');assert.equal(colors[1],'rgb(56, 59, 66)');}
    assert.equal(await checkout.evaluate(e=>getComputedStyle(e,'::after').content),'"✓ Salió"');
    assert.equal(await page.locator('.sites-resumen-cabana[data-cabana="3"] .sites-resumen-estado-badge').innerText(),'Ya salió');
    const fallos=await page.evaluate(contraste);
    assert.deepEqual(fallos.filter(f=>/sites-resumen-dia|sites-resumen-estado-badge/.test(f.element)),[],`${width} ${tema}: contraste`);
    assert.equal(await row.locator('.sites-resumen-flujo').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'La franja no desborda');
    if(width===1440)console.log(`RESUMEN_VISUAL_${tema.toUpperCase()}:`+(await page.locator('.sites-resumen-lista').screenshot()).toString('base64'));
   }
   for(const [tipo,n,metodo]of [['anterior',1,'click'],['actual',2,'Enter'],['siguiente',3,' ']]){
    const celda=row.locator('.sites-resumen-dia--'+tipo);if(metodo==='click')await celda.click();else{await celda.focus();await page.keyboard.press(metodo===' '?'Space':metodo);}
    await page.waitForFunction(n=>document.querySelector('[data-reserva-codigo]').textContent==='H-DEMO-'+n,n);
    assert.match(await page.locator('[data-reserva-kicker]').innerText(),/CABAÑA 1/);
    assert.equal(await page.evaluate(()=>fechaSeleccionada),'2026-11-08');
    await page.locator('[data-reserva-cerrar]').click();
   }
   // Hoy libre tras la salida conserva el acceso a la reserva saliente.
   await page.locator('.sites-resumen-cabana[data-cabana="3"] .sites-resumen-dia--actual').click();
   await page.waitForFunction(()=>document.querySelector('[data-reserva-codigo]').textContent==='H-DEMO-5');
   await page.locator('[data-reserva-cerrar]').click();
   const antes=await page.evaluate(()=>__reads.length);
   await page.locator('.sites-resumen-cabana[data-cabana="3"] .sites-resumen-dia--siguiente').click();
   assert.equal(await page.evaluate(()=>__reads.length),antes,'Libre sin reserva no abre ficha');
   await page.evaluate(()=>window.__permission=false);await row.locator('.sites-resumen-dia--actual').click();
   assert.equal(await page.evaluate(()=>__reads.length),antes,'Permiso perdido no abre ficha');
   assert.deepEqual(errors,[]);console.log(`OK Resumen ${width}: temas, salida distinguible, tres accesos, teclado y estadía exacta.`);await page.close();
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1);});
