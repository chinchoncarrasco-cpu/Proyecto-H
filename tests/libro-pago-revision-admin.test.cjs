const test=require('node:test'),assert=require('node:assert/strict');
const {caso}=require('./fixtures/libro-pago-revision-admin.cjs');
const pagos=h=>h.llamadas.filter(x=>/incorporar|registrar/.test(x.nombre||''));
for(const tipo of ['efectivo_servicio','cabana_transferencia']) {
 test(tipo+': revisión explícita prepara sin escribir; el pago sólo sale en confirmación final',async()=>{
  const h=caso(tipo),evidencia=JSON.stringify(h.p),plan=await h.preparar(),item=h.item(plan);
  assert.equal(item.manualPago?.caso,tipo);assert.equal(item.manualPago.bloqueo,null);
  assert.equal(item.seleccionado,false);assert.equal(h.Q.serializarIncorporacion(plan).filter(i=>i.tipo.startsWith('pago')).length,0);
  const listo=await h.confirmar(plan),p=h.item(listo);
  assert.equal(p.categoria,'pagos');assert.equal(p.seleccionado,true);assert.deepEqual(Array.from(p.motivos),[]);
  assert.equal(JSON.stringify(h.p),evidencia);assert.equal(pagos(h).length,0);
  const serial=h.Q.serializarIncorporacion(listo).find(i=>i.tipo.startsWith('pago'));
  assert.equal(serial.datos_origen.revision_pago_admin_v1.tipo,tipo);
  assert.equal(serial.datos_origen.evidencia_libro.texto_original,h.p.texto_original);
  await h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,listo,h.db);
  assert.equal(pagos(h).length,1);
  if(tipo==='cabana_transferencia')assert.equal(pagos(h)[0].args.p_items.find(i=>i.tipo==='pago').confirmacion_final,true);
 });
 test(tipo+': permiso, confirmación, cancelación y cambios de evidencia invalidan la decisión',async()=>{
  for(const cambio of ['rol','permiso','libro','monto','sesion','capacidad']) {
   const h=caso(tipo),plan=await h.preparar();
   if(cambio==='rol')h.ctx.haikuSesion.roles=[];
   if(cambio==='permiso')h.ctx.haikuTienePermiso=()=>false;
   if(cambio==='libro')h.cambiarLibro();
   if(cambio==='monto')h.p.monto++;
   if(cambio==='sesion')h.usuario='00000000-0000-4000-8000-000000000091';
   if(cambio==='capacidad')h.capacidad=false;
   await assert.rejects(h.confirmar(plan));assert.equal(pagos(h).length,0);
  }
  const h=caso(tipo),plan=await h.preparar();
  for(const extra of [{confirmado:false},{motivo:''},{cabana:99},{vigente:()=>false}])await assert.rejects(h.confirmar(plan,extra));
  assert.equal(pagos(h).length,0);
 });
 test(tipo+': administrador conserva botón sin SQL; revisión muestra bloqueo sin confirmar',async()=>{
  const h=caso(tipo);h.capacidad=false;const plan=await h.preparar(),fila=h.render(plan);
  const boton=fila.querySelectorAll('button').find(b=>b.textContent==='Aprobación manual');assert.ok(boton);
  await boton.events.click();const panel=fila.querySelector('.haiku-incorporacion-manual-pago-panel');assert.equal(panel.hidden,false);
  assert.ok(panel.querySelectorAll('*').some(x=>/todavía no está habilitada/.test(x.textContent)));
  assert.equal(panel.querySelectorAll('button').find(b=>b.textContent==='Confirmar revisión').disabled,true);
  assert.equal(pagos(h).length,0);
 });
 test(tipo+': duplicados siguen bloqueados aunque el operador confirme',async()=>{
  const h=caso(tipo),p=h.p;
  h.tablas.pagos.push({id:'00000000-0000-4000-8000-000000000077',reserva_id:h.tablas.reserva_estadias[0].reserva_id,
   tipo_movimiento:'pago',monto:p.monto,moneda:'CLP',medio_pago:p.medio_pago,fecha_pago:p.fecha_comprobante,estado:'pendiente'});
  const plan=await h.preparar();assert.equal(h.item(plan).seleccionado,false);
  await assert.rejects(h.confirmar(plan));assert.equal(pagos(h).length,0);
 });
}
test('efectivo: servicio ausente, cancelado o saldo cambiado no se aprueba',async()=>{
 for(const cambio of ['ausente','cancelado','saldo']) {
  const h=caso(),plan=await h.preparar();
  if(cambio==='ausente')h.tablas.servicios=[];
  if(cambio==='cancelado')h.tablas.servicios[0].estado_servicio='cancelado';
  if(cambio==='saldo')h.tablas.vista_estado_cargos[0].saldo_cargo=10000;
  await assert.rejects(h.confirmar(plan));assert.equal(pagos(h).length,0);
 }
});
test('recepción no obtiene la resolución exclusiva de administrador',async()=>{
 for(const tipo of ['efectivo_servicio','cabana_transferencia']) {
  const h=caso(tipo);h.ctx.haikuSesion.roles=[{codigo:'recepcion'}];
  const plan=await h.preparar();assert.equal(h.item(plan).manualPago,null);assert.equal(h.item(plan).seleccionado,false);
 }
});

for(const tipo of ['efectivo_servicio','cabana_transferencia']) {
 test(tipo+': el panel exige motivo y check; cancelar no guarda y el éxito permanece visible',async()=>{
  const h=caso(tipo),plan=await h.preparar(),fila=h.render(plan);
  const boton=t=>fila.querySelectorAll('button').find(b=>b.textContent===t);
  await boton('Aprobación manual').events.click();
  const campo=n=>fila.querySelectorAll('*').find(e=>e['aria-label']===n);
  const motivo=campo('Motivo de la confirmación'),check=campo('Confirmo la recepción y el destino del pago');
  motivo.value='Recepción verificada personalmente';motivo.events.input();
  assert.equal(boton('Confirmar revisión').disabled,true);
  check.checked=true;check.events.change();assert.equal(boton('Confirmar revisión').disabled,false);
  await boton('Volver a pagos').events.click();assert.equal(check.checked,false);assert.equal(pagos(h).length,0);
  await boton('Aprobación manual').events.click();check.checked=true;check.events.change();
  await boton('Confirmar revisión').events.click();assert.ok(h.next);assert.equal(pagos(h).length,0);
  h.Q.continuarVistaManualPago(plan,h.next,h.item(plan).id,{tipo:'revision_admin_pago'});
  const despues=h.render(h.next),panel=despues.querySelector('.haiku-incorporacion-manual-pago-panel');
  assert.equal(panel.hidden,false);assert.equal(panel.dataset.paso,'aprobado');
  assert.ok(panel.querySelectorAll('*').some(e=>e.textContent.includes('confirmación final')));
 });
 test(tipo+': retirar permiso o capacidad después de revisar impide la incorporación final',async()=>{
  for(const cambio of ['rol','permiso','capacidad']) {
   const h=caso(tipo),listo=await h.confirmar(await h.preparar());
   if(cambio==='rol')h.ctx.haikuSesion.roles=[];
   if(cambio==='permiso')h.ctx.haikuTienePermiso=()=>false;
   if(cambio==='capacidad')h.capacidad=false;
   await assert.rejects(h.Q.confirmarIncorporacion(h.result,h.decisiones,h.aprobados,listo,h.db));
   assert.equal(pagos(h).length,0);
  }
 });
}


test('efectivo conserva fecha del pago posterior a la fecha del servicio',async()=>{
 const h=caso();h.p.fecha_comprobante='2026-10-04';
 const listo=await h.confirmar(await h.preparar());
 const p=h.Q.serializarIncorporacion(listo).find(i=>i.tipo.startsWith('pago'));
 assert.equal(p.argumentos.p_fecha_pago,'2026-10-04');
 assert.equal(p.datos_origen.aplicaciones_servicio_v1.aplicaciones[0].fecha_servicio_esperada,'2026-10-03');
});
