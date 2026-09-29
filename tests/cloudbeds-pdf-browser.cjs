// Prueba aislada en Edge/Chromium: backend simulado, PDF sintético sólo en memoria.
// NODE_PATH debe apuntar al runtime con playwright y pdf-lib. No usa Supabase real.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{PDFDocument,StandardFonts}=require('pdf-lib');
const xs=Array.from({length:19},(_,i)=>24+i*35);
async function fixture(){const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 const headers=['Reserva','Fecha de la\nreserva','Núm.\nhabitación','Check-in','Check-out','Precio\ntotal','Estado','Noches','Adultos','Niños','Habitación ID','Nombre y\napellido','Correo electrónico','Móvil','Teléfono','Saldo\npendiente','Total de la\nhabitación','Depósito','Productos'];
 const row=(id,name,room,total,neto,estado='Confirmada',productos='')=>[id,'01/09/2026',room,'04/09/2026','07/09/2026',total,estado,'3','2','0',id,name,'p****a@example.invalid','','+*******1234','0',neto,total,productos];
 const rows=[[row('9000000000001','Persona\nEjemplo','CD5(1)','$459.000','$385.714'),row('9000000000002','Otra Persona','CD5(1), C10(1)','$313.000','$263.025')],[row('9000000000003','Cancelada Ejemplo','N/A','$0','$0','Cancelada')]];
 for(let n=0;n<2;n++){const p=doc.addPage([720,792]);const dibujar=(cells,y)=>cells.forEach((v,i)=>v.split('\n').forEach((str,j,all)=>p.drawText(str,{x:xs[i],y:792-y-(j-(all.length-1)/2)*5,size:4,font})));if(n===0)dibujar(headers,38);p.drawText('Cloudbeds Reservas',{x:330,y:769,size:8,font});rows[n].forEach((r,i)=>dibujar(r,80+i*50));}
 return Buffer.from(await doc.save());}
(async()=>{const pdf=await fixture();let browser,server;try{
 const html=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/supabase-asistente-v1.css"></head><body><script>
 window.haikuSesion={auth:true};window.calls=[];window.totalProyecto=470000;window.previewElegible=true;
 window.haikuSupabase={
  from(t){window.calls.push('select:'+t);return {select(){return this},order(){return this},range:async()=>({data:t==='reservas'?[{id:'r1',cloudbeds_id:'9000000000001',titular_nombre:'Persona Ejemplo',estado_reserva:'confirmada',estadias:[{id:'e-r1',fecha_ingreso:'2026-09-04',fecha_salida:'2026-09-07',tipo_estadia:'alojamiento',cabanas:{numero:5}}]}]:t==='vista_saldos_alojamiento_reserva'?[{reserva_id:'r1',total_alojamiento:window.totalProyecto,pagado_alojamiento:300000,saldo_alojamiento:window.totalProyecto-300000}]:[]})}},
  async rpc(n,p={}){window.calls.push('rpc:'+n);
   if(n==='haiku_capacidad_totales_v1')return {data:{version:'total1_financiero_v31',writer_disponible:true}};
   if(n==='haiku_previsualizar_tarifa_cloudbeds_v1')return {data:{solo_lectura:true,version:'cloudbeds_writer_w1_preview_v1',autoridad_financiera_version:'total1_financiero_v31',reserva_id:p.p_reserva_id,estadia_id:p.p_estadia_id,tipo_estadia:'alojamiento',cabana_numero:5,total_actual:window.totalProyecto,total_objetivo:p.p_total_objetivo,pagado_actual:300000,saldo_actual:window.totalProyecto-300000,saldo_esperado:p.p_total_objetivo-300000,elegible:window.previewElegible,motivo_bloqueo:window.previewElegible?null:'Canario bloqueado para revisión manual.'}};
   if(n==='haiku_aplicar_tarifas_cloudbeds_v1'){await new Promise(r=>setTimeout(r,80));window.totalProyecto=p.p_operaciones[0].total_objetivo;return {data:{ok:true,cambios:1,resultados:[{ok:true}]}};}
   throw Error('RPC inesperada: '+n);
  },
  functions:{invoke:async()=>{window.calls.push('imagen');return {error:{message:'Imagen llegó a ruta anterior'}}}}
 };
 </script><script src="/js/haiku-cloudbeds-pdf-v1.js"></script><script src="/js/haiku-cloudbeds-tarifas-v1.js"></script><script src="/js/supabase-asistente-v1.js"></script><script src="/js/supabase-asistente-listado-cloudbeds-v2.js"></script></body></html>`;
 server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}const url=new URL(req.url,'http://local').pathname;if(!/^\/(js|vendor|css|assets)\//.test(url)){res.writeHead(404).end();return;}const file=path.resolve('.'+url);if(!file.startsWith(process.cwd()+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',file.endsWith('.mjs')||file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'image/png');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:process.env.HAKU_BROWSER_CHANNEL||'msedge',headless:true});const page=await browser.newPage({viewport:{width:1100,height:850}});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#haiku-asistente-boton').click();
 await page.locator('#haiku-asistente-archivos').setInputFiles({name:'anonimo.pdf',mimeType:'application/pdf',buffer:pdf});await page.locator('#haiku-asistente-enviar').click();
 await page.locator('.haiku-cloudbeds-tarifas').waitFor({timeout:45000});assert.match(await page.locator('.haiku-cloudbeds-tarifas').innerText(),/Cloudbeds[\s\S]*Tarifas/i);
 assert.deepEqual(await page.evaluate(()=>window.calls),['select:reservas','select:vista_saldos_alojamiento_reserva','rpc:haiku_capacidad_totales_v1']);
 assert.equal(await page.evaluate(()=>window.CLOUDBEDS_TARIFAS_WRITER_HABILITADO),true);
 assert.equal(await page.locator('.haiku-cloudbeds-tarifas-writer:not([disabled])').count(),1);
 assert.equal(await page.locator('.haiku-cloudbeds-tarifas-categoria').count(),5);
 await page.evaluate(()=>{window.previewElegible=false});await page.locator('[data-cloudbeds-actualizar]').click();
 await page.locator('[data-cloudbeds-confirmacion]:not([hidden])').waitFor();assert.equal(await page.locator('[data-cloudbeds-confirmar]:not([disabled])').count(),0);assert.match(await page.locator('[data-cloudbeds-estado]').innerText(),/revisión manual/);assert.equal((await page.evaluate(()=>window.calls.filter(c=>c==='rpc:haiku_aplicar_tarifas_cloudbeds_v1').length)),0);
 await page.evaluate(()=>{window.previewElegible=true});await page.locator('[data-cloudbeds-actualizar]').click();await page.locator('[data-cloudbeds-confirmar]:not([disabled])').waitFor();
 assert.match(await page.locator('[data-cloudbeds-confirmacion]').innerText(),/Proyecto H actual[\s\S]*\$470\.000[\s\S]*Pagado actual[\s\S]*\$300\.000[\s\S]*Saldo esperado[\s\S]*\$159\.000/);
 await page.locator('[data-cloudbeds-cancelar]').click();assert.equal(await page.locator('[data-cloudbeds-confirmacion]:not([hidden])').count(),0);assert.equal((await page.evaluate(()=>window.calls.filter(c=>c==='rpc:haiku_aplicar_tarifas_cloudbeds_v1').length)),0);
 await page.locator('[data-cloudbeds-actualizar]').click();await page.locator('[data-cloudbeds-confirmar]:not([disabled])').waitFor();await page.locator('[data-cloudbeds-confirmar]').dblclick();
 await page.waitForFunction(()=>window.calls.filter(c=>c==='rpc:haiku_aplicar_tarifas_cloudbeds_v1').length===1);await page.waitForFunction(()=>window.totalProyecto===459000);await page.waitForFunction(()=>document.querySelectorAll('[data-cloudbeds-actualizar]').length===0);
 const rpcFlow=await page.evaluate(()=>window.calls.filter(c=>c.startsWith('rpc:')));assert.equal(rpcFlow.filter(c=>c==='rpc:haiku_aplicar_tarifas_cloudbeds_v1').length,1);assert.ok(rpcFlow.indexOf('rpc:haiku_previsualizar_tarifa_cloudbeds_v1')<rpcFlow.indexOf('rpc:haiku_aplicar_tarifas_cloudbeds_v1'));
 await page.screenshot({path:path.join(process.env.TEMP||'.','haiku-cloudbeds-ui.png')});
 const callsDespuesWriter=(await page.evaluate(()=>window.calls)).length;await page.locator('#haiku-asistente-archivos').setInputFiles({name:'invalido.pdf',mimeType:'application/pdf',buffer:Buffer.from('no es PDF')});await page.locator('#haiku-asistente-texto').press('Control+Enter');await page.getByText(/Archivo PDF inválido/).waitFor();assert.equal((await page.evaluate(()=>window.calls)).length,callsDespuesWriter);
 for(const [mime,ext]of [['image/png','png'],['image/jpeg','jpg'],['image/webp','webp']]){
  await page.locator('#haiku-asistente-archivos').setInputFiles({name:'captura.'+ext,mimeType:mime,buffer:Buffer.from([1,2,3])});await page.locator('#haiku-asistente-enviar').click();await page.waitForFunction(n=>window.calls.filter(c=>c==='imagen').length===n,ext==='png'?1:ext==='jpg'?2:3);
 }
 assert.equal((await page.evaluate(()=>window.calls.filter(c=>c==='imagen').length)),3);
 console.log('PASS navegador: preview antes del modal, bloqueo, cancelar, confirmación única, reconsulta y writer W1 simulado.');
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
