const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('crypto');
const {crear,futuro}=require('./fixtures/libro-reprogramacion-sql.cjs');
test('duración futura: noches, cargos, servicios, notas y disponibilidad en PostgreSQL',async t=>{
 const h=await crear(),{db,id}=h;t.after(()=>db.close());
 const caso=(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});
 const destino=salida=>({cabana_numero:9,fecha_ingreso:'2026-12-28',fecha_salida:salida});
 const plan=salida=>h.plan(destino(salida));
 const rechaza=async(fn,re)=>{await db.exec('savepoint esperado');try{await assert.rejects(fn,re);}finally{await db.exec('rollback to savepoint esperado;release savepoint esperado');}};
 for(const [n,salida,op]of [[1,'2026-12-30','agregar'],[2,'2026-12-29','retirar']])await caso(op+' noche requiere aprobación explícita y conserva todo pago/aplicación',async()=>{
  await futuro(h,n);const p=await plan(salida),antes=await h.snapshot(),noches=p.items.filter(i=>i.tipo==='noche');
  assert.deepEqual(p.bloqueos,[]);const item=noches.find(i=>i.operacion===op);assert.equal(item.inicial,null);assert.equal(item.tarifa,144000);
  const d=h.decisiones(p);delete d[item.id];await rechaza(()=>h.aplicar(p,d),/Decide/);assert.deepEqual(await h.snapshot(),antes);
  const opid=randomUUID();await h.aplicar(p,undefined,opid);const despues=await h.snapshot();
  assert.deepEqual(despues.pagos,antes.pagos);assert.deepEqual(despues.pago_aplicaciones,antes.pago_aplicaciones);assert.deepEqual(despues.cargo_ajustes,antes.cargo_ajustes);
  const activos=despues.cargos.filter(c=>c.estadia_id===id.estadia&&c.tipo_cargo==='alojamiento'&&c.estado==='activo');assert.equal(activos.length,op==='agregar'?2:1);
  assert.equal(despues.servicios.find(s=>s.id===id.late).fecha_servicio,salida);assert.equal(despues.notas.find(n=>n.id===id.nota).fecha_operacion,'2026-12-28');
  if(op==='retirar'){
   const viejo=despues.cargos.find(c=>c.id===item.cargo_id);assert.equal(viejo.estado,'anulado');assert.equal(viejo.monto,144000);
   assert.ok(despues.estadia_noches.some(n=>n.id===item.registro_id),'la noche retirada se conserva con su cargo histórico');
   assert.equal(despues.servicios.find(s=>s.id===id.jacuzzi).reprogramacion_revision_v1.version,1);
   assert.ok(p.items.find(i=>i.tipo==='nota'&&i.nombre==='Coordinar retiro de equipaje').opciones.every(x=>x!=='mover'));
  }
  await h.aplicar(p,undefined,opid);assert.deepEqual(await h.snapshot(),despues);
 });
 await caso('reducción y reampliación: reutiliza la noche, conserva el cargo anulado y crea sólo uno activo',async()=>{
  await futuro(h,2);const antes=await h.snapshot();await h.aplicar(await plan('2026-12-29'));await h.aplicar(await plan('2026-12-30'));
  const despues=await h.snapshot();assert.deepEqual(despues.estadia_noches.map(n=>n.id).sort(),antes.estadia_noches.map(n=>n.id).sort());
  assert.equal(despues.cargos.filter(c=>c.estadia_id===id.estadia&&c.tipo_cargo==='alojamiento'&&c.estado==='activo').length,2);
  assert.equal(despues.cargos.filter(c=>c.estadia_id===id.estadia&&c.tipo_cargo==='alojamiento'&&c.estado==='anulado').length,1);
  assert.deepEqual(despues.pago_aplicaciones,antes.pago_aplicaciones);
 });
 await caso('una noche con dinero aplicado o ajuste activo dirige a revisión financiera, sin retirarla',async()=>{
  await futuro(h,2);const cargo=(await db.query("select c.id from cargos c join estadia_noches n on n.id=c.estadia_noche_id where n.fecha='2026-12-29' and c.estado='activo'")).rows[0].id;
  const pago=randomUUID();await db.query("insert into pagos(id,reserva_id,monto,moneda,tipo_movimiento,estado,fecha_pago) values($1,$2,1000,'CLP','pago','confirmado','2026-12-01')",[pago,id.reserva]);
  await db.query('insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,1000)',[pago,cargo]);
  const p=await plan('2026-12-29'),antes=await h.snapshot();assert.match(p.bloqueos.join(' '),/Pagos y cargos/);await rechaza(()=>h.aplicar(p),/aplicaciones/);assert.deepEqual(await h.snapshot(),antes);
 });
 await caso('un ajuste activo en la noche retirada exige revisión financiera y no se anula',async()=>{
  await futuro(h,2);const cargo=(await db.query("select c.id from cargos c join estadia_noches n on n.id=c.estadia_noche_id where n.fecha='2026-12-29' and c.estado='activo'")).rows[0].id;
  await db.query("insert into cargo_ajustes(id,cargo_id,reserva_id,estado) values($1,$2,$3,'activo')",[randomUUID(),cargo,id.reserva]);
  const p=await plan('2026-12-29'),antes=await h.snapshot();assert.match(p.bloqueos.join(' '),/ajustes activos/);
  await rechaza(()=>h.aplicar(p),/ajustes activos/);assert.deepEqual(await h.snapshot(),antes);
 });
 for(const [estado,ingreso,salida]of [
  ['confirmada','2026-12-28T15:00:00Z',null],['confirmada',null,'2026-12-29T12:00:00Z'],['hospedada',null,null],['checked_out',null,null]
 ])await caso('protege estado '+estado+' e ingreso/salida registrados '+ingreso+'/'+salida,async()=>{
  await futuro(h);await db.query('update reserva_estadias set estado_estadia=$1,checkin_realizado_en=$2,checkout_realizado_en=$3 where id=$4',[estado,ingreso,salida,id.estadia]);
  const p=await plan('2026-12-30'),antes=await h.snapshot();assert.match(p.bloqueos.join(' '),/ingreso\/salida/);
  await rechaza(()=>h.aplicar(p),/ingreso\/salida/);assert.deepEqual(await h.snapshot(),antes);
 });
 await caso('cabaña ocupada antes de ampliar y nueva ocupación después de revisar bloquean el guardado',async()=>{
  await futuro(h);const p=await plan('2026-12-30');
  await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia) values($1,$2,$3,'2026-12-29','2026-12-30','confirmada')",[randomUUID(),id.reserva,id.cabana]);
  const antes=await h.snapshot();assert.match((await plan('2026-12-30')).bloqueos.join(' '),/ocupada/);await rechaza(()=>h.aplicar(p),/ocupada/);assert.deepEqual(await h.snapshot(),antes);
 });
 await caso('horario propio ocupado requiere revisión; no mueve el servicio por ampliar noches',async()=>{
  await futuro(h);await db.query("insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,recurso_id,fecha_servicio,hora_inicio,hora_fin,estado_servicio,total) values($1,$2,$3,$4,$5,'2027-01-01','18:30','19:30','programado',30000)",[randomUUID(),id.reserva,id.estadiaAnterior,id.catJacuzzi,id.recurso]);
  const p=await h.plan({cabana_numero:9,fecha_ingreso:'2027-01-01',fecha_salida:'2027-01-03'}),j=p.items.find(i=>i.registro_id===id.jacuzzi);assert.equal(j.inicial,null);assert.match(j.motivo,/ocupado/);
  await h.aplicar(p);const s=(await h.snapshot()).servicios.find(s=>s.id===id.jacuzzi);assert.equal(s.fecha_servicio,'2026-12-28');assert.ok(s.reprogramacion_revision_v1);
 });
 await caso('tarifa cambiada, aprobación falsificada o permiso retirado no guarda nada',async()=>{
  await futuro(h);const p=await plan('2026-12-30');const alterado=structuredClone(p);alterado.items.find(i=>i.tipo==='noche'&&i.operacion==='agregar').tarifa=1;
  await rechaza(()=>h.aplicar(alterado),/revisión de noches/);
  await db.query('update cabanas set precio_base=150000 where id=$1',[id.cabana]);const antes=await h.snapshot();await rechaza(()=>h.aplicar(p),/Cambió/);assert.deepEqual(await h.snapshot(),antes);
  await db.exec("select set_config('reprog.deny_permission','reservas.editar',true)");await rechaza(()=>h.aplicar(p),/permiso/);
 });
 await caso('Libro incorpora la misma revisión de noches en un único lote',async()=>{
  await futuro(h);const p=await plan('2026-12-30'),i=h.item({});i.estadia={antes:{fecha_ingreso:'2026-12-28',fecha_salida:'2026-12-29',cabana_numero:9},despues:{fecha_ingreso:'2026-12-28',fecha_salida:'2026-12-30',cabana_numero:9}};
  i.reprogramacion_v1={operacion_id:randomUUID(),version_libro:'f'.repeat(64),propuesta:p,decisiones:h.decisiones(p)};
  const antes=await h.snapshot();await h.lote([i]);const despues=await h.snapshot();assert.equal(despues.reserva_estadias.find(e=>e.id===id.estadia).fecha_salida,'2026-12-30');assert.deepEqual(despues.pago_aplicaciones,antes.pago_aplicaciones);
 });
});
