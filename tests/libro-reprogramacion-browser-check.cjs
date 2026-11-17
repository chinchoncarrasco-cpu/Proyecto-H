// Navegador real y funciones PostgreSQL reales en PGlite. Sólo datos sintéticos.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {chromium}=require('playwright'),{randomUUID}=require('crypto');
const {crear,read}=require('./fixtures/libro-reprogramacion-sql.cjs');
const F=require('./fixtures/libro-comparacion-readonly.cjs');
const repo=path.resolve(__dirname,'..'),evidence=process.env.HAKU_REPROGRAMACION_EVIDENCIA||path.join(process.env.LOCALAPPDATA||require('os').tmpdir(),'ProyectoH/diagnosticos/libro-reprogramacion-20261116');
fs.mkdirSync(evidence,{recursive:true});let h,browser,server;const results={datos:'Exclusivamente sintéticos',casos:[],rpc:[]};
const tables=['reservas','reserva_estadias','estadia_noches','cabanas','servicios','catalogo_servicios','notas','pagos','pago_aplicaciones','cargos','cargo_ajustes','bloqueos_cabana','huespedes'];
async function select(t){
 if(t==='vista_estado_cargos')return[];
 if(!tables.includes(t))throw Error('Tabla fuera del fixture: '+t);
 const data=(await h.db.query('select to_jsonb(t) d from public.'+t+' t')).rows.map(r=>r.d);
 if(t==='reserva_estadias'){const cs=await select('cabanas'),rs=await select('reservas');return data.map(x=>({...x,cabanas:cs.find(c=>c.id===x.cabana_id),reservas:rs.find(r=>r.id===x.reserva_id)}));}
 if(t==='servicios'){const es=await select('reserva_estadias'),cs=await select('catalogo_servicios'),rs=await select('reservas');return data.map(x=>({...x,reserva_estadias:es.find(e=>e.id===x.estadia_id),catalogo_servicios:cs.find(c=>c.id===x.catalogo_servicio_id),reservas:rs.find(r=>r.id===x.reserva_id)}));}return data;
}
async function rpc(n,a){try{let data;
 if(n==='haiku_reprogramacion_preparar_v1')data=(await h.db.query('select public.haiku_reprogramacion_preparar_v1($1,$2,$3::jsonb) r',[a.p_reserva_id,a.p_estadia_id,JSON.stringify(a.p_destino)])).rows[0].r;
 else if(n==='haiku_reprogramar_estadia_v1'){data=(await h.db.query('select public.haiku_reprogramar_estadia_v1($1,$2::jsonb,$3::jsonb) r',[a.p_operacion_id,JSON.stringify(a.p_propuesta),JSON.stringify(a.p_decisiones)])).rows[0].r;results.rpc.push({n,a,data});}
 else if(n==='haiku_incorporar_libro_v1'){data=await h.lote(a.p_items,a.p_operacion_id);results.rpc.push({n,a,data});}
 else if(/operacion.*resumen/.test(n))data=[];
 else throw Error('RPC fuera del fixture: '+n);
 return{data,error:null};}catch(e){return{data:null,error:{message:e.message,code:e.code}};}}
const exp='Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
const qsrc=read('js/haiku-libro-consultas-v1.js').replace(exp,exp.replace(' })',', renderizarIncorporacion })'));
async function init(page,tema){
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.exposeFunction('__select',select);await page.exposeFunction('__rpc',rpc);
 await page.evaluate(({id,user,tema})=>{
  window.__id=id;window.serviciosRegistrados=[];document.documentElement.dataset.haikuTema=tema;window.haikuTienePermiso=()=>true;
  const get=(r,k)=>k.split('.').reduce((v,p)=>v?.[p],r);
  const from=t=>{const filters=[];let range,single=false;const b={select(){return b},order(){return b},
   eq(k,v){filters.push(r=>get(r,k)===v);return b},in(k,vs){filters.push(r=>vs.includes(get(r,k)));return b},
   lte(k,v){filters.push(r=>get(r,k)<=v);return b},gte(k,v){filters.push(r=>get(r,k)>=v);return b},range(a,z){range=[a,z];return b},maybeSingle(){single=true;return b},
   then(ok,no){return __select(t).then(rows=>{let data=rows.filter(r=>filters.every(f=>f(r)));if(range)data=data.slice(range[0],range[1]+1);return ok({data:single?data[0]||null:data,error:null});},no);}};return b;};
  window.haikuSupabase={from,rpc:__rpc,auth:{getSession:async()=>({data:{session:{user:{id:user}}}})}};
  window.__sesion={auth:{id:user},usuario:{id:user}};
  window.haikuLeerFichaSupabaseV2=async rid=>({reserva:(await __select('reservas')).find(r=>r.id===rid),
   estadias:(await __select('reserva_estadias')).filter(e=>e.reserva_id===rid).map(e=>({...e,cabana_numero:e.cabanas.numero})),
   noches:await __select('estadia_noches'),huespedes:[],cargos:await __select('cargos'),saldo:0});
 },{id:h.id,user:h.usuario,tema});
 for(const f of ['haiku-dialogos-v1','haiku-asistente-lenguaje-v1','haiku-asistente-operaciones-v1','haiku-servicios-identidad-v1','haiku-reprogramacion-estadia-v1',
  'supabase-asistente-operaciones-v1','haiku-asistente-acciones-v1','haiku-libro-semantica-v1','haiku-libro-pagos-canon-v1','haiku-libro-pagos-destinos-v1',
  'supabase-notas-resumen-v1','supabase-servicios-hidratacion-v2','supabase-servicios-tinajas-horarios-v1','sites-servicios-v1'])await page.addScriptTag({content:read('js/'+f+'.js')});
 await page.addScriptTag({content:qsrc});await page.evaluate(()=>{window.haikuSesion=__sesion;});
}
async function capture(page,name){await page.screenshot({path:path.join(evidence,name+'.png'),fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert.equal(overflow,false,name+' sin desborde horizontal');}
async function views(page){return page.evaluate(async()=>{
 await HAIKU_SERVICIOS_HIDRATACION_V2.sincronizar('verificación sintética');
 const out={};for(const d of ['2026-10-03','2026-11-15','2026-11-16','2026-12-28','2026-12-29']){
  const agenda=HAIKU_SITES_SERVICIOS_V1.proyectar(serviciosRegistrados,d,{fecha:'2026-11-01',hora:'00:00'});
  out[d]={servicios:agenda.dia.map(s=>({id:s.id,nombre:s.nombre,hora:s.hora,cabana:s.numeroCabana,revision:HAIKU_SERVICIOS_IDENTIDAD_V1.revisionReprogramacion(s)})),notas:await HAIKU_NOTAS_RESUMEN_SUPABASE_V1.consultar(d)};
 }return out;
});}
async function showDaily(page){await page.evaluate(async()=>{
 const id=__id,notas=await HAIKU_NOTAS_RESUMEN_SUPABASE_V1.consultar('2026-12-28');
 document.getElementById('diario').textContent='Resumen diario · 28/12/2026\n'+notas.map(n=>'CAB '+n.cabana+' · '+n.texto).join('\n');
 HAIKU_SITES_SERVICIOS_V1.estado.fecha='2026-12-29';HAIKU_SITES_SERVICIOS_V1.renderizar();
});}
async function chooseOld(page){await page.locator(`[data-registro-id="${h.id.antiguo}"] select`).selectOption('revision');}
async function haku(page,cmd){await page.locator('#haiku-asistente-texto').fill(cmd);await page.locator('#haiku-asistente-enviar').click();try{await page.locator('[data-haku-reprogramacion]').waitFor({timeout:10000});}catch(e){console.error(await page.locator('main').innerText());throw e;}}
async function libro(page,cabana){
 const source=F.reserva({id:'Dic26!D9',hoja:'Dic26',titular:'Persona Ficticia A',rut_documento:'FICTICIO-A',tipo_documento:'pasaporte',cabana,
  adultos:1,fecha_checkin:'2026-12-28',fecha_checkout:'2026-12-29',noches:1,fechas_ocupadas:['2026-12-28'],coordenadas_origen:{hoja:'Dic26',celda:'D9'}});
 await page.evaluate(async r=>{
  const Q=HAIKU_LIBRO_CONSULTAS,version='f'.repeat(64);window.__fuenteLibro=r;
  window.HAIKU_LIBRO_RESERVA_V1={estado:()=>({cargado:true,generacion:1,version})};
  const e=(await __select('reserva_estadias')).find(e=>e.id===__id.estadia);
  const q={desde:'2026-11-15',hasta:'2026-12-29',focal:true,incluirFinanzas:false,incluirServicios:false};
  const comparacion=await Q.compararSistema([r],haikuSupabase,q),traslado=comparacion.snapshot.estadias.find(s=>s.id===e.id);
  const result={reservas:[r],generacion:1,comparacion,traslado,q},ds=new Map(),aprobados=new Set();
  const volver=async()=>render(await Q.prepararIncorporacion(result,ds,aprobados));
  const guardar=async plan=>{window.__guardado=await Q.confirmarIncorporacion(result,ds,aprobados,plan);return __guardado;};
  const render=p=>{window.__plan=p;Q.renderizarIncorporacion(document.getElementById('out'),p,volver,()=>{},guardar);document.querySelectorAll('.haiku-incorporacion-seccion').forEach(e=>e.open=true);};
  window.__releer=volver;await volver();
 },source);
 await page.locator('[data-haku-reprogramacion]').waitFor();
}
(async()=>{h=await crear();try{
 server=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;if(p==='/'){
 const ids=['sites-servicios-selector','sites-servicios-cabanas','sites-servicios-selector-estado','sites-servicios-copia-estado','sites-servicios-fecha-label','sites-servicios-realizado','sites-servicios-realizado-contenido','sites-servicios-realizado-confirmar','sites-servicios-cancelar','sites-servicios-cancelar-contenido','sites-servicios-cancelar-confirmar'];
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 ['styles','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1','haiku-tema-oscuro-v1','haiku-dialogos-v1','sites-servicios-v1'].map(f=>`<link rel="stylesheet" href="/css/${f}.css">`).join('')+
 '<style>body{margin:0}main{padding:12px}#haiku-asistente-mensajes{width:100%}article.haku-orden{max-width:none}html[data-haiku-tema="oscuro"] body{background:#17221d;color:#edf5ef}#diario{white-space:pre-line}input,button,select{max-width:100%;box-sizing:border-box}</style>'+
 '<body><main><p>Prueba local · Datos ficticios · PostgreSQL local</p><input id="haiku-asistente-texto" aria-label="Mensaje a Haku"><button id="haiku-asistente-enviar">Enviar</button><div id="haiku-asistente-mensajes"></div><div id="out"></div><section id="diario"></section><section id="seccion-servicios"><div id="sites-servicios-root"><input type="date" id="sites-servicios-fecha"><div id="sites-servicios-contenido"></div>'+ids.map(id=>`<div id="${id}" hidden></div>`).join('')+'</div></section></main>');return;}
 const file=path.resolve(repo,'.'+p);if(!file.startsWith(repo+path.sep)){res.writeHead(403).end();return;}try{res.writeHead(200,{'Content-Type':p.endsWith('.css')?'text/css':'text/javascript'}).end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));browser=await chromium.launch({headless:true});
 for(const mobile of [false,true])for(const tema of ['claro','oscuro'])for(const flujo of ['haku','libro']){
  await h.db.exec('begin');const name=(mobile?'movil':'escritorio')+'-'+tema+'-'+flujo;
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}}),errors=[],externas=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){externas.push(route.request().url());return route.abort();}return route.continue();});
  try{await init(page,tema);const before=await h.snapshot(),dailyBefore=await views(page);
   if(flujo==='haku')await haku(page,'cambia fechas de CAB 9 15/11/2026 del 28/12/2026 al 29/12/2026');else await libro(page,4);
   const preview=page.locator('[data-haku-reprogramacion]');assert.match(await preview.innerText(),/15\/11\/2026/);assert.match(await preview.innerText(),/29\/12\/2026/);
   assert.doesNotMatch(await page.locator('#out').innerText(),/noches nuevas usarán|pagos de noches retiradas/);
   if(flujo==='haku')assert.equal(await page.getByRole('button',{name:'Confirmar reprogramación',exact:true}).isDisabled(),true);
   const record={name,antes:before,diarioAntes:dailyBefore,vistaPrevia:await preview.innerText()};await capture(page,name+'-previa');
   if(name==='escritorio-claro-haku'){
    const html=await preview.evaluate(e=>e.outerHTML);fs.writeFileSync(path.join(evidence,'vista-previa-sintetica.html'),'<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vista previa sintética · Reprogramación</title><style>body{font:15px system-ui;margin:20px;color:#193b2c}'+read('css/haiku-reprogramacion-estadia-v1.css')+'</style><p>Vista previa local con datos ficticios. Documento de revisión; guardar requiere el panel y confirmación.</p>'+html);
   }await chooseOld(page);
   if(flujo==='haku'){await page.getByRole('button',{name:'Confirmar reprogramación',exact:true}).click();await page.locator('[data-guardado="1"]').waitFor();}
   else{const input=page.locator('article').filter({has:preview}).locator('input[type=checkbox]').first();await input.check();
    await page.locator('.haku-incorporacion-sites-pie').getByRole('button',{name:/Continuar con/}).click();await page.getByRole('dialog').getByRole('button',{name:'Incorporar selección',exact:true}).click();await page.getByText('Incorporación completada',{exact:true}).waitFor();}
   record.despues=await h.snapshot();record.diarioDespues=await views(page);const a=record.diarioDespues;
   assert.equal(a['2026-11-16'].servicios.some(s=>s.id===h.id.late),false);assert.equal(a['2026-12-29'].servicios.some(s=>s.id===h.id.late&&s.hora==='12:00'),true);
   assert.equal(a['2026-11-15'].notas.length,0);assert.equal(a['2026-12-28'].notas[0].cabana,flujo==='haku'?'9':'4');
   assert.equal(a['2026-10-03'].servicios.find(s=>s.id===h.id.antiguo).revision,true);assert.equal(a['2026-12-28'].servicios.some(s=>s.id===h.id.antiguo),false);
   for(const k of ['cargos','pagos','pago_aplicaciones','cargo_ajustes'])assert.deepEqual(record.despues[k],before[k]);
   const call=results.rpc.at(-1);assert.equal((await rpc(call.n,call.a)).error,null);assert.deepEqual(await h.snapshot(),record.despues);
   if(flujo==='libro'){
    // El resultado guardado no repite la operación: la comparación nueva parte del destino persistido.
    record.relectura=await page.evaluate(async()=>{
     const origen=__plan.items.find(i=>i.reprogramacion).payload.reprogramacion_v1.propuesta.destino;
     const r={...__fuenteLibro,cabana:origen.cabana_numero};
     const p=await HAIKU_LIBRO_CONSULTAS.prepararIncorporacion({reservas:[r],generacion:1,q:{desde:'2026-11-15',hasta:'2026-12-29',incluirFinanzas:false,incluirServicios:false}},new Map(),new Set());
     return {traslados:p.items.filter(i=>i.reprogramacion).length};
    });assert.equal(record.relectura.traslados,0);
   }
   await showDaily(page);await capture(page,name+'-confirmado');
   await page.evaluate(()=>{HAIKU_SITES_SERVICIOS_V1.estado.fecha='2026-12-28';HAIKU_SITES_SERVICIOS_V1.renderizar();});await capture(page,name+'-llegada-confirmada');
   assert.deepEqual(errors,[]);assert.deepEqual(externas,[]);record.resultado='PASS';results.casos.push(record);console.log(name+' PASS');
  }finally{await page.close();await h.db.exec('rollback');}
 }
 // Conflicto nuevo: Haku vuelve a mostrar la revisión, sin guardar datos parciales.
 await h.db.exec('begin');const page=await browser.newPage({viewport:{width:1440,height:1000}});try{
  await init(page,'claro');await haku(page,'cambia fechas de CAB 9 15/11/2026 del 28/12/2026 al 29/12/2026');await chooseOld(page);
  await h.db.query("insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,recurso_id,fecha_servicio,hora_inicio,hora_fin,estado_servicio,total) values($1,$2,$3,$4,$5,'2026-12-28','18:30','19:30','programado',30000)",[randomUUID(),h.id.reserva,h.id.estadiaAnterior,h.id.catJacuzzi,h.id.recurso]);
  const before=await h.snapshot();await page.getByRole('button',{name:'Confirmar reprogramación',exact:true}).click();await page.getByText(/Cambió.*servicios/).waitFor();assert.deepEqual(await h.snapshot(),before);
  assert.match(await page.locator(`[data-registro-id="${h.id.jacuzzi}"]`).innerText(),/ocupad|conflicto/);assert.equal(await page.getByRole('button',{name:'Confirmar reprogramación',exact:true}).isDisabled(),true);
  await capture(page,'conflicto-nuevo-sin-guardado');results.casos.push({name:'conflicto nuevo tras vista previa',resultado:'PASS',antes:before,despues:await h.snapshot()});console.log('conflicto nuevo PASS');
 }finally{await page.close();await h.db.exec('rollback');}
 fs.writeFileSync(path.join(evidence,'navegador-sintetico.json'),JSON.stringify(results,null,2));
}finally{await browser?.close();if(server)await new Promise(ok=>server.close(ok));await h.db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
