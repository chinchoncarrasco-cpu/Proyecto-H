// Ampliar/reducir desde el chat real; ninguna conexión productiva.
const {iniciarEntorno}=require('./libro-reprogramacion-browser-check.cjs');
const {futuro}=require('./fixtures/libro-reprogramacion-sql.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{read}=require('./fixtures/libro-reprogramacion-sql.cjs');
const base=process.env.HAKU_REPROGRAMACION_BASE==='1';
async function cargarRevision(p){
 await p.evaluate(()=>{
  document.body.insertAdjacentHTML('beforeend','<section id="seccion-historial" hidden></section>');
  const original=haikuLeerFichaSupabaseV2;window.haikuLeerFichaSupabaseV2=async rid=>{
   const f=await original(rid),apps=await __select('pago_aplicaciones');
   f.pagos=await __select('pagos');f.servicios=await __select('servicios');f.notas=await __select('notas');
   f.cargos=f.cargos.map(c=>({...c,saldo_cargo:c.monto-apps.filter(a=>a.cargo_id===c.id).reduce((s,a)=>s+a.monto_aplicado,0)}));return f;
  };
 });
 for(const f of ['haiku-reserva-estado-manual-v1','supabase-finanzas-resumen-v1','sites-resumen-reserva-v1','supabase-historial-v1'])await p.addScriptTag({content:read('js/'+f+'.js')});
 for(const f of ['sites-resumen-v1','sites-historial-v1','haiku-tema-oscuro-v1','haiku-tema-v1','haiku-tema-legibilidad-v1'])await p.addStyleTag({content:read('css/'+f+'.css')});
}
const viewport=mobile=>mobile?{width:390,height:844}:{width:1440,height:1000};
async function aprobarPendientes(p){
 await p.locator('[data-haku-reprogramacion] select').evaluateAll(xs=>xs.forEach(x=>{
  if(!x.value){x.value=[...x.options].some(o=>o.value==='aprobar')?'aprobar':[...x.options].some(o=>o.value==='revision')?'revision':'conservar';x.dispatchEvent(new Event('change'));}
 }));
}
async function ejecutar(){const e=await iniciarEntorno({revisionNoches:!base}),{h,browser}=e,out=[];try{
 for(const n of process.env.HAKU_REPROGRAMACION_SOLO_ESTADOS==='1'?[]:[1,2])for(const mobile of base?[false]:[false,true])for(const tema of base?['claro']:['claro','oscuro']){
  await h.db.exec('begin');const name=(base?'base967-':'')+(n===1?'ampliacion':'reduccion')+'-'+(mobile?'movil':'escritorio')+'-'+tema;
  const p=await browser.newPage({viewport:viewport(mobile)}),errors=[];p.on('pageerror',x=>errors.push(x.message));
  await p.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  try{await futuro(h,n);await e.init(p,tema);if(!base)await cargarRevision(p);const antes=await h.snapshot();
   await e.haku(p,`cambia fechas de CAB 9 28/12/2026 del 28/12/2026 al ${n===1?'30':'29'}/12/2026`);
   const preview=p.locator('[data-haku-reprogramacion]'),button=p.getByRole('button',{name:'Confirmar reprogramación',exact:true});
   const r={name,antes,vistaPrevia:await preview.innerText()};assert.equal(await button.isDisabled(),true);
   if(base){assert.match(r.vistaPrevia,/duración/);assert.equal(await preview.getByRole('button').count(),0);r.resultado='Bloqueado sin acción para completar';}
   else{
    assert.match(r.vistaPrevia,/Noches verificadas.*144\.000.*288\.000|Noches verificadas.*288\.000.*144\.000/);
    await e.capture(p,name+'-previa');await aprobarPendientes(p);
    assert.equal(await button.isDisabled(),false);await button.click();await p.locator('[data-guardado="1"]').waitFor();r.despues=await h.snapshot();r.diario=await e.views(p);
    assert.equal(r.despues.reserva_estadias.find(x=>x.id===h.id.estadia).fecha_salida,n===1?'2026-12-30':'2026-12-29');
    assert.deepEqual(r.despues.pagos,antes.pagos);assert.deepEqual(r.despues.pago_aplicaciones,antes.pago_aplicaciones);
    assert.deepEqual(r.despues.cargo_ajustes,antes.cargo_ajustes);
    const activos=s=>s.cargos.filter(c=>c.estadia_id===h.id.estadia&&c.tipo_cargo==='alojamiento'&&c.estado==='activo');
    assert.equal(activos(r.despues).length,n===1?2:1);
    assert.equal(activos(r.despues).reduce((s,c)=>s+c.monto,0),n===1?288000:144000);
    const retenida=activos(antes).find(c=>antes.estadia_noches.some(x=>x.id===c.estadia_noche_id&&x.fecha==='2026-12-28'));
    assert.deepEqual(r.despues.cargos.find(c=>c.id===retenida.id),retenida);
    assert.deepEqual(r.despues.estadia_noches.find(x=>x.id===retenida.estadia_noche_id),antes.estadia_noches.find(x=>x.id===retenida.estadia_noche_id));
    assert.equal(r.despues.servicios.find(x=>x.id===h.id.late).fecha_servicio,n===1?'2026-12-30':'2026-12-29');
    assert.equal(r.diario[n===1?'2026-12-30':'2026-12-29'].servicios.some(x=>x.id===h.id.late),true);
    assert.equal(r.diario[n===1?'2026-12-29':'2026-12-30'].servicios.some(x=>x.id===h.id.late),false);
    assert.equal(r.diario['2026-12-28'].notas.some(x=>x.texto==='Llegada 19:00 · Dejar dos batas'),true);
    if(n===2){assert.equal(r.despues.servicios.find(x=>x.id===h.id.jacuzzi).reprogramacion_revision_v1.version,1);
     const retirada=antes.estadia_noches.find(x=>x.fecha==='2026-12-29');
     assert.deepEqual(r.despues.estadia_noches.find(x=>x.id===retirada.id),retirada);
     assert.equal(r.despues.cargos.find(c=>c.estadia_noche_id===retirada.id).estado,'anulado');
    }
    await e.capture(p,name+'-confirmado');
    assert.equal(await p.evaluate(()=>HAIKU_RESUMEN_RESERVA_SITES_V1.abrirPorId(__id.reserva,null,{estadiaId:__id.estadia,numeroCabana:'9'})),true);
    const drawer=p.locator('#sites-resumen-reserva-drawer');await drawer.locator('[data-reserva-contenido]').waitFor();
    assert.equal(await drawer.locator('[data-reserva-duracion]').innerText(),n===1?'2':'1');
    assert.equal(Number((await drawer.locator('[data-reserva-total]').innerText()).replace(/\D/g,'')),r.despues.cargos.filter(c=>c.estado==='activo').reduce((s,c)=>s+c.monto,0));
    assert.match(await drawer.locator('[data-reserva-servicios]').innerText(),/Requiere revisión por reprogramación/);
    r.ficha=await drawer.innerText();
    r.resultado='PASS';
   }await e.capture(p,name);assert.deepEqual(errors,[]);out.push(r);console.log(name+' '+r.resultado);
  }finally{await p.close();await h.db.exec('rollback');}
 }
 if(!base)for(const status of ['hospedada','checked_out'])for(const mobile of [false,true])for(const tema of ['claro','oscuro']){
  const name='revision-'+status+'-'+(mobile?'movil':'escritorio')+'-'+tema;
  await h.db.exec('begin');const p=await browser.newPage({viewport:viewport(mobile)}),errors=[];p.on('pageerror',x=>errors.push(x.message));
  await p.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());try{
   await futuro(h);await h.db.query("update reserva_estadias set estado_estadia=$1,checkin_realizado_en='2026-12-28T15:00:00Z',checkout_realizado_en=case when $1='checked_out' then '2026-12-29T12:00:00Z'::timestamptz else null end where id=$2",[status,h.id.estadia]);
   await h.db.exec('create table eventos_auditoria(id uuid default gen_random_uuid(),reserva_id uuid,estadia_id uuid,cabana_id uuid,usuario_id uuid,accion text,tipo_evento text,entidad_tipo text,entidad_id uuid,turno_id uuid,descripcion text,cambios jsonb,datos_contexto jsonb,origen text,creado_en timestamptz default now())');
   await h.db.query("insert into eventos_auditoria(reserva_id,estadia_id,cabana_id,accion,tipo_evento,entidad_tipo,entidad_id,descripcion,cambios) values($1,$2,$3,'UPDATE','actualizacion','reserva_estadias',$2,$4,$5)",[h.id.reserva,h.id.estadia,h.id.cabana,status==='hospedada'?'Ingreso registrado en prueba ficticia':'Salida registrada en prueba ficticia',JSON.stringify([{campo:'estado_estadia',anterior:'confirmada',nuevo:status},{campo:status==='hospedada'?'checkin_realizado_en':'checkout_realizado_en',anterior:null,nuevo:status==='hospedada'?'2026-12-28T15:00:00Z':'2026-12-29T12:00:00Z'}])]);
   // Una edición técnica común sigue fuera del historial operativo.
   await h.db.query("insert into eventos_auditoria(reserva_id,estadia_id,accion,tipo_evento,entidad_tipo,entidad_id,cambios) values($1,$2,'UPDATE','actualizacion','reserva_estadias',$2,$3)",[h.id.reserva,h.id.estadia,JSON.stringify([{campo:'adultos',anterior:1,nuevo:2}])]);
   await e.init(p,tema);await cargarRevision(p);
   const antes=await h.snapshot();await e.haku(p,'cambia fechas de CAB 9 28/12/2026 del 28/12/2026 al 30/12/2026');
   assert.equal(await p.getByRole('button',{name:'Confirmar reprogramación',exact:true}).isDisabled(),true);
   await aprobarPendientes(p);assert.equal(await p.getByRole('button',{name:'Confirmar reprogramación',exact:true}).isDisabled(),true);
   await e.capture(p,name+'-bloqueo');
   await p.getByRole('button',{name:'Abrir ficha de esta estadía',exact:true}).click();const drawer=p.locator('#sites-resumen-reserva-drawer');await drawer.locator('[data-reserva-contenido]').waitFor();
   assert.equal(await drawer.locator('[data-reserva-estado-operativo]').getAttribute('data-reserva-estado'),status);
   const ficha=await drawer.innerText();await e.capture(p,name+'-ficha');
   // Una corrección del registro tiene su propia confirmación y puede cancelarse.
   await drawer.getByRole('button',{name:'Cambiar estado de la reserva',exact:true}).click();
   await drawer.locator('[data-reserva-nuevo-estado="confirmada"]').click();
   const correccion=drawer.locator('[data-reserva-estado-confirmacion]');await correccion.waitFor();
   assert.match(await correccion.innerText(),/Se limpiarán el check-in y el check-out/);
   await e.capture(p,name+'-correccion');await correccion.getByRole('button',{name:'Cancelar',exact:true}).click();
   await drawer.getByRole('button',{name:'Cerrar ficha de reserva',exact:true}).click();
   await p.getByRole('button',{name:'Revisar historial de la reserva',exact:true}).click();
   const historial=p.locator('[data-historial-reserva-lista]');await historial.locator('details').waitFor();
   assert.equal(await historial.locator('details').count(),1);
   await p.locator('[data-historial-reserva-lista] details summary').click();
   assert.match(await p.locator('[data-historial-reserva-lista]').innerText(),status==='hospedada'?/Check-in|Hospedada/i:/Check-out|Check out/i);
   await e.capture(p,name+'-historial');assert.deepEqual(await h.snapshot(),antes);assert.deepEqual(errors,[]);
   out.push({name,ficha,historial:await historial.innerText(),sinEscrituras:true,resultado:'PASS'});console.log(name+' PASS');
  }finally{await p.close();await h.db.exec('rollback');}
 }
 fs.writeFileSync(path.join(e.evidence,base?'noches-base967.json':process.env.HAKU_REPROGRAMACION_SOLO_ESTADOS==='1'?'estados-navegador-sintetico.json':'noches-navegador-sintetico.json'),JSON.stringify(out,null,2));
}finally{await e.cerrar();}}
module.exports={futuro};if(require.main===module)ejecutar().catch(x=>{console.error(x);process.exitCode=1;});
