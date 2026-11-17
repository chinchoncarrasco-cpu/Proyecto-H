// Interfaz real → RPC y PostgreSQL local; red externa bloqueada, sólo datos sintéticos.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {randomUUID}=require('crypto'),{chromium}=require('playwright');
const {crear,read,R,id,user}=require('./fixtures/libro-pago-existente-postgres.cjs');
const repo=path.resolve(__dirname,'..');
const evidence=process.env.HAKU_APLICACION_EVIDENCIA||path.join(process.env.LOCALAPPDATA,'ProyectoH/diagnosticos/libro-pago-existente-sintetico');
fs.mkdirSync(evidence,{recursive:true});
const results={datos:'Sintéticos',flujos:[],rpc:[]};let h,server,browser;
const select=t=>h.select(t),snapshot=()=>h.snapshot(),reset=()=>h.reset();
async function rpc(name,a){try{let data;
 if(name==='haiku_libro_aplicaciones_servicio_capacidad_v1')data=(await h.db.query('select public.haiku_libro_aplicaciones_servicio_capacidad_v1() r')).rows[0].r;
 else if(name==='haiku_libro_transferencias_capacidad_v2')data={version:2,confirmacion_final:true,glosa_sin_nombre:true};
 else if(name==='haiku_resumen_ajustes_unidad')data={reserva_id:a.p_reserva_id,ajustes:await select('cargo_ajustes')};
 else if(name==='haiku_incorporar_pago_servicios_libro_v1'||name==='haiku_libro_aplicar_pago_existente_v1'){
  const argumento=name==='haiku_libro_aplicar_pago_existente_v1'?'p_propuesta':'p_item';
  data=(await h.db.query('select public.'+name+'($1,$2::jsonb) r',[a.p_operacion_id,JSON.stringify(a[argumento])])).rows[0].r;
  results.rpc.push({nombre:name,args:a,resultado:data});
 }else throw Error('RPC no autorizada: '+name);
 return{data,error:null};}catch(e){return{data:null,error:{message:e.message}};}}
const exportsBase='Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
const Qsrc=read('js/haiku-libro-consultas-v1.js').replace(exportsBase,exportsBase.replace(' })',', renderizarIncorporacion, resolverAprobacionManualPago, capturarVistaAprobaciones, restaurarVistaAprobaciones })'));
async function start(page,tema,pagosAbiertos=true){
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.evaluate(tema=>document.documentElement.dataset.haikuTema=tema,tema);
 await page.exposeFunction('__localSelect',select);await page.exposeFunction('__localRpc',rpc);
 await page.evaluate(({data,user})=>{window.__fixture=data;window.haikuTienePermiso=()=>true;window.haikuSesion={usuario:{id:user,activo:true},roles:[{codigo:'administrador'}]};
  window.HAIKU_LIBRO_RESERVA_V1={listo:async()=>{},estado:()=>({cargado:true,generacion:1,version:'f'.repeat(64)}),listarHojas:()=>['Nov26'],consultarHoja:async()=>structuredClone(__fixture)};
  const from=table=>{const filters=[];let range=null;const b={select(){return b},order(){return b},eq(k,v){filters.push(r=>r[k]===v);return b},
   in(k,vs){filters.push(r=>vs.includes(r[k]));return b},lte(k,v){filters.push(r=>r[k]<=v);return b},gte(k,v){filters.push(r=>r[k]>=v);return b},range(a,z){range=[a,z];return b},
   async then(ok,no){try{let data=(await __localSelect(table)).filter(r=>filters.every(f=>f(r)));if(range)data=data.slice(range[0],range[1]+1);return ok({data,error:null});}catch(e){if(no)return no(e);throw e;}}};return b;};
  window.haikuSupabase={from,auth:{getSession:async()=>({data:{session:{user:{id:user}}}})},rpc:__localRpc};
 },{data:R.caso().data,user});
 for(const f of ['haiku-dialogos-v1','haiku-libro-semantica-v1','haiku-libro-pagos-canon-v1','haiku-libro-lenguaje-natural-v1','haiku-libro-pagos-destinos-v1'])await page.addScriptTag({content:read('js/'+f+'.js')});
 await page.addScriptTag({content:Qsrc});await page.addScriptTag({content:read('js/supabase-finanzas-resumen-v1.js')});
 const ficha=read('js/supabase-ficha-v2.js');await page.addScriptTag({content:'const dinero=n=>"$"+Number(n).toLocaleString("es-CL");'+ficha.slice(ficha.indexOf('    function pintarPagos'),ficha.indexOf('    function crearItemServicio'))});
 await page.evaluate(async(pagosAbiertos)=>{
  const Q=HAIKU_LIBRO_CONSULTAS,decisiones=new Map(),aprobados=new Set(),r=__fixture.reservas[0];
  const result={reservas:[r],generacion:1,q:{desde:r.fecha_checkin,hasta:r.fecha_checkout,incluirFinanzas:true}};
  const pintar=async()=>pintarPagos({cargos:await __localSelect('vista_estado_cargos'),pagos:await __localSelect('pagos')});
  const volver=async()=>{aprobados.clear();const p=await Q.prepararIncorporacion(result,decisiones,aprobados);p.items.forEach(i=>i.seleccionado=false);await render(p);};
  const aprobar=async id=>{aprobados.add(id);await render(await Q.prepararIncorporacion(result,decisiones,aprobados));};
  aprobar.manualPago=async(plan,id,accion)=>{const siguiente=await Q.resolverAprobacionManualPago(result,decisiones,aprobados,plan,id,accion);await render(siguiente);return siguiente;};
  const incorporar=async plan=>{window.__ultimaEjecucion=await Q.confirmarIncorporacion(result,decisiones,aprobados,plan);await pintar();return __ultimaEjecucion;};
  const render=async p=>{window.__plan=p;const out=document.getElementById('out'),vista=Q.capturarVistaAprobaciones(out);Q.renderizarIncorporacion(out,p,volver,aprobar,incorporar);Q.restaurarVistaAprobaciones(out,vista);document.querySelectorAll('.haiku-incorporacion-seccion').forEach(e=>e.open=true);if(pagosAbiertos)document.querySelectorAll('.haku-pago-revisar').forEach(e=>e.open=true);await pintar();};
  window.__releer=volver;await volver();
 },pagosAbiertos);
}
async function guardar(page){
 await page.locator('.haku-incorporacion-sites-pie').getByRole('button',{name:/Continuar con/}).click();
 await page.getByRole('dialog').waitFor();await page.getByRole('dialog').getByRole('button',{name:'Incorporar selección',exact:true}).click();
 await page.getByText('Incorporación completada',{exact:true}).waitFor();
}
async function photo(page,name){await page.screenshot({path:path.join(evidence,name+'.png'),fullPage:true,timeout:30000});}
(async()=>{h=await crear();try{
 server=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;if(p==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 ['styles','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1','haiku-libro-pagos-ui-v1','haiku-tema-oscuro-v1','haiku-dialogos-v1'].map(x=>`<link rel="stylesheet" href="/css/${x}.css">`).join('')+
 '<body><main style="padding:8px"><p>Verificación local · datos sintéticos · PostgreSQL local</p><div class="ficha-pagos"><div><span>Total</span><strong id="ficha-pago-total"></strong></div><div><span>Abonos</span><strong id="ficha-pago-abono"></strong></div><div><span>Saldo neto</span><strong id="ficha-pago-saldo"></strong></div><div><span>Servicios</span><strong id="ficha-pago-servicios"></strong></div></div><div id="out"></div></main></body></html>');return;}
  const file=path.resolve(repo,'.'+p);if(!file.startsWith(repo+path.sep)){res.writeHead(403).end();return;}try{res.writeHead(200,{'Content-Type':p.endsWith('.css')?'text/css':'image/svg+xml'}).end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});

 for(const mobile of [false,true])for(const tema of ['claro','oscuro']){
  const prefix=(mobile?'movil':'escritorio')+'-'+tema;
  for(const flujo of ['abono','penalidad','tinaja']){
   await reset();const page=await browser.newPage({viewport:{width:mobile?390:1440,height:1000}}),errors=[],external=[];page.setDefaultTimeout(10000);
   page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():(external.push(route.request().url()),route.abort()));
   await start(page,tema);const antes=await snapshot(),registro={flujo,mobile,tema,antes};await photo(page,prefix+'-'+flujo+'-antes');
   if(flujo==='abono'){
    const registrados=page.locator('.haiku-incorporacion-seccion--registrados');
    assert.match(await registrados.locator('summary').first().innerText(), /Pagos ya registrados/);
    assert.equal(await registrados.locator('input[type=checkbox]').count(), 0);
    assert.equal(await page.locator('.haiku-incorporacion-seccion--dudosos').getByText('WebPay Débito', {exact:true}).count(), 0);
    const panel=registrados.locator('.haiku-incorporacion-aplicar-existente');assert.equal(await panel.count(),1);
    await panel.getByText('Aplicar pago existente',{exact:true}).click();registro.vistaPrevia=await panel.innerText();
    assert.match(registro.vistaPrevia,/158.400.*144.000.*144.000.*\$0/s);assert.match(registro.vistaPrevia,/CAB 2/);
    assert.equal(await panel.locator('select').inputValue(),id.alojamiento);assert.deepEqual((await snapshot()).aplicaciones,[]);
    const geo=await panel.boundingBox();registro.ancho=geo.width;assert.ok(geo.width>(mobile?250:600));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await photo(page,prefix+'-'+flujo+'-previa');
    await panel.screenshot({path:path.join(evidence,prefix+'-abono-detalle.png'),timeout:30000});
    await panel.getByRole('button',{name:'Confirmar aplicación',exact:true}).click();await page.getByRole('dialog').waitFor();
    await photo(page,prefix+'-'+flujo+'-confirmacion');
    await page.getByRole('dialog').getByRole('button',{name:'Aplicar pago existente',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Aplicación confirmada'}).waitFor();
    registro.persistido=await snapshot();assert.deepEqual(registro.persistido.pagos,antes.pagos);
    assert.equal(registro.persistido.pagos.length,1);assert.equal(registro.persistido.aplicaciones.length,1);assert.equal(registro.persistido.aplicaciones[0].monto_aplicado,144000);
    assert.deepEqual([antes.resumen.saldoCargos,antes.resumen.sinAplicar,antes.resumen.saldoNeto],[188400,144000,44400]);
    assert.deepEqual([registro.persistido.resumen.saldoCargos,registro.persistido.resumen.sinAplicar,registro.persistido.resumen.saldoNeto],[44400,0,44400]);
    await page.waitForFunction(()=>document.getElementById('ficha-pago-aplicaciones-detalle')?.hidden===true);
    assert.match(await page.locator('#ficha-pago-saldo').innerText(),/44.400/);
    const call=results.rpc.at(-1);registro.reintentoMismoId=(await rpc(call.nombre,call.args)).data;
    registro.reintentoNuevoId=(await rpc(call.nombre,{...call.args,p_operacion_id:randomUUID()})).data;assert.equal(registro.reintentoNuevoId.ya_aplicado,true);
    await photo(page,prefix+'-'+flujo+'-persistido');await page.evaluate(()=>__releer());
    registro.releido=await snapshot();assert.deepEqual(registro.releido,registro.persistido);assert.equal(await page.locator('.haiku-incorporacion-aplicar-existente').count(),0);
    assert.match(await page.locator('#out').innerText(),/aplicado \$144.000.*sin aplicar \$0/);
   }else{
    if(flujo==='penalidad'){
     const tarifa=page.locator('article[data-haiku-pago-origen-celda="AZ32:BC32"]');
     const contexto=tarifa.locator('.haku-pago-contexto');
     assert.match(await contexto.innerText(),/Diferencia de tarifa[\s\S]*Destino[\s\S]*Alojamiento[\s\S]*Saldo del cargo/);
     assert.doesNotMatch(await contexto.innerText(),/[0-9a-f]{8}-[0-9a-f]{4}-/i);
     assert.equal(await tarifa.locator('.haku-pago-contexto-tecnico[open]').count(),0);
     assert.match(await tarifa.locator('.haku-pago-revision-motivos').innerText(),/Para continuar/);
     await tarifa.screenshot({path:path.join(evidence,prefix+'-tarifa-contexto.png')});
    }
    const n=flujo==='penalidad'?33:34,articulo=page.locator('article[data-haiku-pago-origen-celda="AZ'+n+':BC'+n+'"]');
    const objetivo=flujo==='penalidad'?articulo.filter({has:page.getByRole('button',{name:/Aprobar comprobante de tarjeta/})}):articulo;
    await objetivo.getByRole('button',{name:flujo==='penalidad'?/Aprobar comprobante de tarjeta/:/Registrar \$32.500/}).click();
    await page.waitForFunction(()=>__plan.items.some(i=>i.seleccionado&&i.categoria==='pagos'));await guardar(page);registro.persistido=await snapshot();
    const monto=flujo==='penalidad'?16000:32500,p=registro.persistido.pagos.find(p=>p.monto===monto),apps=registro.persistido.aplicaciones.filter(a=>a.pago_id===p.id);
    assert.equal(apps.length,1);assert.equal(apps[0].cargo_id,flujo==='penalidad'?id.alojamiento:id.jacuzzi);
    assert.equal(apps[0].monto_aplicado,flujo==='penalidad'?16000:30000);assert.equal(p.monto-apps[0].monto_aplicado,flujo==='penalidad'?0:2500);
    assert.equal(registro.persistido.ajustes.length,1);assert.equal(registro.persistido.ajustes[0].monto,14400);
    const call=results.rpc.at(-1);await rpc(call.nombre,call.args);await rpc(call.nombre,{...call.args,p_operacion_id:randomUUID()});
    await page.getByRole('button',{name:'Volver a la comparación',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.haku-incorporacion-sites-cabecera'));
    registro.releido=await snapshot();assert.deepEqual(registro.releido,registro.persistido);registro.textoRelectura=await page.locator('#out').innerText();
    if(flujo==='penalidad'){
     assert.match(registro.textoRelectura,/monto: Libro \$16.000.*Proyecto H \$14.400/);assert.match(registro.textoRelectura,/Comprobante registrado/);
     const tarifa=page.locator('article[data-haiku-pago-origen-celda="AZ32:BC32"]');await tarifa.getByRole('button',{name:/Aprobar transferencia para alojamiento/}).click();await guardar(page);
     const s=await snapshot();assert.equal(s.pagos.filter(p=>p.monto===14400).length,1);assert.equal(s.ajustes.length,1);assert.equal(s.ajustes[0].monto,14400);
     await page.evaluate(()=>__releer());
     const tarifaRegistrada=page.locator('.haiku-incorporacion-seccion--registrados article[data-haiku-pago-origen-celda="AZ32:BC32"]');
     assert.equal(await tarifaRegistrada.count(),1);
     assert.equal(await page.locator('.haiku-incorporacion-seccion--dudosos article[data-haiku-pago-origen-celda="AZ32:BC32"]').count(),0);
     assert.equal(await tarifaRegistrada.locator('input[type=checkbox]').count(),0);
     assert.equal(await tarifaRegistrada.locator('.haiku-incorporacion-aplicar-existente').count(),0);
     assert.deepEqual((await snapshot()).pagos,s.pagos);
    }else assert.match(registro.textoRelectura,/aplicado \$30.000.*sin aplicar \$2.500/);
   }
   registro.resultado='PASS';await photo(page,prefix+'-'+flujo+'-relectura');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
   results.flujos.push(registro);console.log(prefix+' '+flujo+' PASS');await page.close();
  }
 }
 for(const escenario of ['parcial','ambiguo','saldo-cambiado']){
  await reset();
  if(escenario==='parcial')await h.db.query('update cargos set monto=85600 where id=$1',[id.alojamiento]);
  const otro='77777777-7777-4777-8777-777777777777';
  if(escenario==='ambiguo')await h.db.query("insert into cargos(id,reserva_id,estadia_id,tipo_cargo,estado,monto,concepto) values($1,$2,$3,'alojamiento','activo',50000,'Alojamiento alternativo')",[otro,id.reserva,id.estadia]);
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);await start(page,'claro');
  const panel=page.locator('.haiku-incorporacion-aplicar-existente');await panel.locator('summary').click();
  if(escenario==='ambiguo'){
   assert.equal(await panel.locator('select').inputValue(),'');assert.equal(await panel.getByRole('button',{name:'Confirmar aplicación'}).isDisabled(),true);
   await panel.locator('select').selectOption(otro);
  }
  await photo(page,escenario+'-previa');await panel.getByRole('button',{name:'Confirmar aplicación'}).click();await page.getByRole('dialog').waitFor();
  if(escenario==='saldo-cambiado')await h.db.query('insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,1000)',[id.pago,id.jacuzzi]);
  const count=results.rpc.length;await page.getByRole('dialog').getByRole('button',{name:'Aplicar pago existente',exact:true}).click();
  if(escenario==='saldo-cambiado'){
   await page.getByText(/No se pudo aprobar:.*saldo cambió/).waitFor();assert.equal(results.rpc.length,count);
   assert.equal((await snapshot()).aplicaciones.filter(a=>a.cargo_id===id.alojamiento).length,0);
  }else{
   await page.getByRole('status').filter({hasText:'Aplicación confirmada'}).waitFor();const s=await snapshot();
   assert.equal(s.pagos.length,1);assert.equal(s.aplicaciones.length,1);assert.equal(s.aplicaciones[0].monto_aplicado,escenario==='parcial'?100000:50000);
   assert.equal(s.aplicaciones[0].cargo_id,escenario==='parcial'?id.alojamiento:otro);assert.equal(s.resumen.sinAplicar,escenario==='parcial'?44000:94000);
  }
  await photo(page,escenario+'-resultado');results.flujos.push({flujo:escenario,resultado:'PASS',persistido:await snapshot()});await page.close();console.log(escenario+' PASS');
 }
 for (const ancho of [1440,390]) for (const tema of ['claro','oscuro']) {
 await reset();const acceso=await browser.newPage({viewport:{width:ancho,height:850}});
 await start(acceso,tema);
 await acceso.evaluate(reservaId=>{
  const mensajes=document.createElement('div');mensajes.id='haiku-asistente-mensajes';document.body.append(mensajes);
  return HAIKU_LIBRO_CONSULTAS.abrirPagosRegistrados({reservaId,fecha:__fixture.reservas[0].fecha_checkin,cabana:'2'});
 },id.reserva);
 const destino=acceso.locator('#haiku-asistente-mensajes');
 assert.match(await destino.innerText(),/Pagos ya registrados[\s\S]*WebPay Débito/);
 assert.equal(await destino.locator('input[type=checkbox]').count(),0);
 assert.equal((await snapshot()).aplicaciones.length,0);
 const desplegable=destino.locator('.haiku-incorporacion-aplicar-existente');
 assert.equal(await desplegable.getAttribute('open'),null);
 await desplegable.locator('summary').click();
 const revision=destino.locator('.haku-pagos-registrados');
 const desbordes=await revision.evaluate(el=>[el,...el.querySelectorAll('*')].filter(n=>{
   if(!n.getClientRects().length||n.closest('details:not([open])')&&!n.closest('summary'))return false;
   return n.scrollWidth>n.clientWidth+2&&getComputedStyle(n).display!=='contents';
 }).map(n=>n.className));
 assert.deepEqual(desbordes,[]);
 assert.equal(await destino.locator('.haku-registrados-origen').getAttribute('open'),null);
 await revision.screenshot({path:path.join(evidence,'revision-'+ancho+'-'+tema+'.png')});
 assert.ok(await destino.getByRole('button',{name:'Confirmar aplicación',exact:true}).evaluate(el=>el.getBoundingClientRect().height<=42));
 await destino.getByRole('button',{name:'Confirmar aplicación',exact:true}).click();
 await acceso.getByRole('dialog').getByRole('button',{name:'Aplicar pago existente',exact:true}).click();
 await destino.getByRole('status').filter({hasText:'Aplicación confirmada'}).waitFor();
 assert.equal((await snapshot()).pagos.length,1);
 assert.equal((await snapshot()).aplicaciones[0].monto_aplicado,144000);
 results.flujos.push({flujo:'acceso-ficha',ancho,tema,resultado:'PASS'});await acceso.close();console.log('acceso-ficha '+ancho+' '+tema+' PASS');
 }
 for(const width of [1440,390,320])for(const tema of ['claro','oscuro']){
  await reset();const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<=600});
  await start(page,tema,false);
  const grupo=page.locator('.haiku-incorporacion-seccion--dudosos');
  const detalles=grupo.locator('details.haku-pago-revisar');
  assert.ok(await detalles.count()>=4);
  assert.equal(await grupo.locator('details.haku-pago-revisar[open]').count(),0);
  const primero=detalles.first(),segundo=detalles.nth(1),summary=primero.locator(':scope > summary');
  assert.match(await summary.innerText(),/Persona Ficticia[\s\S]*CAB 2[\s\S]*14.400[\s\S]*13\/11\/26/);
  const cerrado=await primero.boundingBox();assert.ok(cerrado.height<=90);
  await grupo.screenshot({path:path.join(evidence,'lista-cerrada-'+width+'-'+tema+'.png')});
  await summary.focus();await page.keyboard.press('Enter');
  assert.equal(await primero.getAttribute('open'),'');
  assert.equal(await segundo.getAttribute('open'),null);
  assert.equal(await primero.locator('.haku-pago-revisar-contenido').isVisible(),true);
  await page.keyboard.press('Space');assert.equal(await primero.getAttribute('open'),null);
  await summary.click();await segundo.locator(':scope > summary').click();
  assert.equal(await grupo.locator('details.haku-pago-revisar[open]').count(),2);
  await page.evaluate(()=>__releer());
  assert.equal(await grupo.locator('details.haku-pago-revisar[open]').count(),2);
  await primero.screenshot({path:path.join(evidence,'pago-abierto-'+width+'-'+tema+'.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const antes=(await snapshot()).pagos;
  await grupo.locator(':scope > summary').click();
  await grupo.locator(':scope > summary').click();
  assert.equal(await primero.getAttribute('open'),'');
  assert.deepEqual((await snapshot()).pagos,antes);
  results.flujos.push({flujo:'pagos-desplegables',width,tema,resultado:'PASS'});
  await page.close();console.log('pagos-desplegables '+width+' '+tema+' PASS');
 }
 fs.writeFileSync(path.join(evidence,'resultados.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({pass:true,casos:results.flujos.length,evidencia:evidence}));
}finally{await browser?.close();server?.close();await h?.db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
