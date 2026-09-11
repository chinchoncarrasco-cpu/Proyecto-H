// Prueba aislada en Edge/Chromium: backend simulado, PDF sintético sólo en memoria.
// NODE_PATH debe apuntar al runtime con playwright y pdf-lib. No usa Supabase real.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{PDFDocument,StandardFonts}=require('pdf-lib');
const xs=[32,69.5,103.78,139.06,168.06,197.06,225.14,262.64,284.95,307.48,325.58,373.77,416.66,485.66,517.94,554.88];
async function fixture(){const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 const headers=['Reserva','Fecha de la\nreserva','Número de\nhabitación','Check-in','Check-out','Precio\ntotal','Estado','Noches','Adultos','Niños','Habitación ID','Nombre y\napellido','Correo electrónico','Móvil','Teléfono','Saldo\npendiente'];
 const row=(id,name,room,total,estado='Confirmada')=>[id,'01/09/2026',room,'04/09/2026','07/09/2026',total,estado,'3','2','0',id,name,'p****a@example.invalid','','+*******1234','0'];
 const rows=[[row('9000000000001','Persona\nEjemplo','CD5(1)','$459.000'),row('9000000000002','Otra Persona','CD5(1), C10(1)','$313.000')],[row('9000000000003','Cancelada Ejemplo','N/A','$0','Cancelada')]];
 for(let n=0;n<2;n++){const p=doc.addPage([612,792]);const dibujar=(cells,y)=>cells.forEach((v,i)=>v.split('\n').forEach((str,j,all)=>p.drawText(str,{x:xs[i],y:792-y-(j-(all.length-1)/2)*5,size:4,font})));if(n===0)dibujar(headers,38);p.drawText('Cloudbeds Reservas',{x:283,y:769,size:8,font});rows[n].forEach((r,i)=>dibujar(r,80+i*50));}
 return Buffer.from(await doc.save());}
(async()=>{const pdf=await fixture();let browser,server;try{
 const html=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/supabase-asistente-v1.css"></head><body><script>
 window.haikuSesion={auth:true};window.calls=[];window.haikuSupabase={from(t){window.calls.push('select:'+t);return {select(){return this},order(){return this},range:async()=>({data:t==='reservas'?[{id:'r1',cloudbeds_id:'9000000000001',titular_nombre:'Persona Ejemplo',estado_reserva:'confirmada',estadias:[{fecha_ingreso:'2026-09-04',fecha_salida:'2026-09-07',cabanas:{numero:5}}]}]:t==='vista_saldos_alojamiento_reserva'?[{reserva_id:'r1',total_alojamiento:459000}]:[]})}},rpc(){throw Error('RPC prohibida')},functions:{invoke:async()=>{window.calls.push('imagen');return {error:{message:'Imagen llegó a ruta anterior'}}}}};
 </script><script src="/js/haiku-cloudbeds-pdf-v1.js"></script><script src="/js/supabase-asistente-v1.js"></script><script src="/js/supabase-asistente-listado-cloudbeds-v2.js"></script></body></html>`;
 server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}const url=new URL(req.url,'http://local').pathname;if(!/^\/(js|vendor|css|assets)\//.test(url)){res.writeHead(404).end();return;}const file=path.resolve('.'+url);if(!file.startsWith(process.cwd()+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',file.endsWith('.mjs')||file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'image/png');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:process.env.HAKU_BROWSER_CHANNEL||'msedge',headless:true});const page=await browser.newPage({viewport:{width:1100,height:850}});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#haiku-asistente-boton').click();
 await page.locator('#haiku-asistente-archivos').setInputFiles({name:'anonimo.pdf',mimeType:'application/pdf',buffer:pdf});await page.locator('#haiku-asistente-enviar').click();
 await page.locator('.haiku-cloudbeds-informe').waitFor({timeout:45000});assert.match(await page.locator('.haiku-cloudbeds-informe').innerText(),/Revisé 3 entradas/);
 assert.deepEqual(await page.evaluate(()=>window.calls),['select:reservas','select:vista_saldos_alojamiento_reserva']);assert.equal(await page.locator('.haiku-cloudbeds-informe button').count(),0);
 assert.equal(await page.locator('.haiku-cloudbeds-informe details').count(),7);await page.locator('.haiku-cloudbeds-informe summary').first().click();
 await page.screenshot({path:path.join(process.env.TEMP||'.','haiku-cloudbeds-ui.png')});
 await page.locator('#haiku-asistente-archivos').setInputFiles({name:'invalido.pdf',mimeType:'application/pdf',buffer:Buffer.from('no es PDF')});await page.locator('#haiku-asistente-texto').press('Control+Enter');await page.getByText(/Archivo PDF inválido/).waitFor();assert.equal((await page.evaluate(()=>window.calls)).length,2);
 for(const [mime,ext]of [['image/png','png'],['image/jpeg','jpg'],['image/webp','webp']]){
  await page.locator('#haiku-asistente-archivos').setInputFiles({name:'captura.'+ext,mimeType:mime,buffer:Buffer.from([1,2,3])});await page.locator('#haiku-asistente-enviar').click();await page.waitForFunction(n=>window.calls.filter(c=>c==='imagen').length===n,ext==='png'?1:ext==='jpg'?2:3);
 }
 assert.deepEqual(await page.evaluate(()=>window.calls),['select:reservas','select:vista_saldos_alojamiento_reserva','imagen','imagen','imagen']);
 console.log('PASS navegador: PDF real sintético de 2 páginas; 3 filas; una respuesta; sólo SELECT; PDF inválido; PNG/JPEG/WEBP preservados.');
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
