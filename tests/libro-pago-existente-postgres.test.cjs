const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {crear,id,user}=require('./fixtures/libro-pago-existente-postgres.cjs');
test('aplicar el pago original al alojamiento reprogramado en PostgreSQL local',async t=>{
 const h=await crear();t.after(()=>h.db.close());const {db}=h;
 const caso=(nombre,fn)=>t.test(nombre,async()=>{await h.reset();await fn();});
 const segundaAplicacion=async(monto=1000)=>{
  const p=randomUUID();await db.query("insert into pagos(id,reserva_id,monto,estado,tipo_movimiento,moneda) values($1,$2,$3,'confirmado','pago','CLP')",[p,id.reserva,monto]);
  await db.query('insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,$3)',[p,id.alojamiento,monto]);
 };
 await caso('144.000, un pago original intacto y una aplicación; dos reintentos no suman',async()=>{
  const antes=await h.snapshot(),p=await h.propuesta(),op=randomUUID(),r=await h.call(p,op);
  assert.equal(r.pago_id,id.pago);assert.equal(r.monto_aplicado,144000);assert.equal(r.sin_aplicar,0);
  assert.equal((await h.call(p,op)).reintento,true);assert.equal((await h.call(p)).ya_aplicado,true);
  const despues=await h.snapshot();assert.deepEqual(despues.pagos,antes.pagos);
  assert.deepEqual([antes.resumen.saldoCargos,antes.resumen.sinAplicar,antes.resumen.saldoNeto],[188400,144000,44400]);
  assert.deepEqual([despues.resumen.saldoCargos,despues.resumen.sinAplicar,despues.resumen.saldoNeto],[44400,0,44400]);
  assert.equal(despues.aplicaciones.length,1);assert.equal(despues.aplicaciones[0].monto_aplicado,144000);
  const audit=(await db.query('select usuario_id,resultado,completado_en from private.haiku_libro_pagos_servicio_operaciones where operacion_id=$1',[op])).rows[0];
  assert.equal(audit.usuario_id,user);assert.ok(audit.completado_en);assert.equal(audit.resultado.origen_libro.celda,'AZ31:BC31');
  assert.equal(despues.pagos[0].datos_origen.cabana,3);assert.deepEqual(despues.ajustes,antes.ajustes);
 });
 await caso('cargo menor: se aplica sólo su saldo y el resto sigue disponible',async()=>{
  await db.query('update cargos set monto=85600 where id=$1',[id.alojamiento]);
  const r=await h.call(await h.propuesta());assert.equal(r.monto_aplicado,100000);assert.equal(r.sin_aplicar,44000);assert.equal(r.saldo_cargo,0);
  const s=await h.snapshot();assert.equal(s.pagos.length,1);assert.equal(s.aplicaciones[0].monto_aplicado,100000);
 });
 await caso('aplicación previa al mismo cargo se amplía sin otra fila',async()=>{
  await db.query('insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,44000)',[id.pago,id.alojamiento]);
  const p=await h.propuesta();assert.equal(p.disponible_esperado,100000);await h.call(p);
  const s=await h.snapshot();assert.equal(s.aplicaciones.length,1);assert.equal(s.aplicaciones[0].monto_aplicado,144000);
 });
 await caso('devolución confirmada reduce el pago disponible',async()=>{
  await db.query("insert into pagos(reserva_id,monto,tipo_movimiento,estado,moneda,pago_origen_id) values($1,44000,'devolucion','confirmado','CLP',$2)",[id.reserva,id.pago]);
  const p=await h.propuesta();assert.equal(p.disponible_esperado,100000);const r=await h.call(p);assert.equal(r.monto_aplicado,100000);assert.equal(r.sin_aplicar,0);
 });
 await caso('dos cargos requieren ID explícito y no distribuyen por su cuenta',async()=>{
  const otro=randomUUID();await db.query("insert into cargos(id,reserva_id,estadia_id,tipo_cargo,estado,monto,concepto) values($1,$2,$3,'alojamiento','activo',50000,'Otro alojamiento')",[otro,id.reserva,id.estadia]);
  const p=await h.propuesta(otro);assert.equal(p.candidatos_esperados.length,2);
  await h.call(p);const s=await h.snapshot();assert.equal(s.aplicaciones.length,1);assert.equal(s.aplicaciones[0].cargo_id,otro);assert.equal(s.aplicaciones[0].monto_aplicado,50000);
 });
 for(const [nombre,cambiar] of [
  ['saldo del cargo',()=>segundaAplicacion()],
  ['disponible por aplicación a servicio',()=>db.query('insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,1000)',[id.pago,id.jacuzzi])],
  ['devolución nueva',()=>db.query("insert into pagos(reserva_id,monto,tipo_movimiento,estado,pago_origen_id) values($1,1000,'devolucion','confirmado',$2)",[id.reserva,id.pago])],
  ['ajuste del cargo',()=>db.query('update cargos set monto=monto+1000 where id=$1',[id.alojamiento])],
  ['candidato nuevo',()=>db.query("insert into cargos(id,reserva_id,estadia_id,tipo_cargo,estado,monto) values($1,$2,$3,'alojamiento','activo',50000)",[randomUUID(),id.reserva,id.estadia])],
  ['fecha reprogramada',()=>db.query("update reserva_estadias set fecha_ingreso='2026-11-12' where id=$1",[id.estadia])],
  ['cabaña reprogramada',()=>db.query('update cabanas set numero=3')],
  ['pago y su trazabilidad',()=>db.query("update pagos set datos_origen='{}'::jsonb where id=$1",[id.pago])],
  ['reserva cancelada',()=>db.query("update reservas set estado_reserva='cancelada'")],
  ['destino de otra estadía',async()=>{const e=randomUUID();await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia) select $1,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia from reserva_estadias limit 1",[e]);await db.query('update cargos set estadia_id=$1 where id=$2',[e,id.alojamiento]);}]
 ])await caso('rechaza vista previa obsoleta: '+nombre,async()=>{
  const p=await h.propuesta();await cambiar();const antes=await h.snapshot();
  await assert.rejects(()=>h.call(p),/cambi|destino|confirmad/i);assert.deepEqual(await h.snapshot(),antes);
 });
 await caso('sin confirmar, sin versión o sin permiso no aplica',async()=>{
  const p=await h.propuesta();await assert.rejects(()=>h.call({...p,confirmado:false}),/confirmaci/);
  await assert.rejects(()=>h.call({...p,version_libro:''}),/incompleta/);
  await db.exec("select set_config('haku.test_permit','off',false)");await assert.rejects(()=>h.call(p),/permiso/);
  assert.equal((await h.snapshot()).aplicaciones.length,0);
 });
 await caso('mismo UUID no se reutiliza con otro actor ni otra solicitud',async()=>{
  const p=await h.propuesta(),op=randomUUID();await h.call(p,op);
  await assert.rejects(()=>h.call({...p,monto_aplicar:1000},op),/otro usuario o propuesta/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);await assert.rejects(()=>h.call(p,op),/otro usuario o propuesta/);
 });
 await caso('rollback de funciones conserva el ledger y deshabilita la capacidad nueva',async()=>{
  await h.call(await h.propuesta());const antes=await h.snapshot();
  await db.exec(h.capAnterior+';drop function public.haiku_libro_aplicar_pago_existente_v1(uuid,jsonb)');
  assert.deepEqual(await h.snapshot(),antes);
  const cap=(await db.query('select public.haiku_libro_aplicaciones_servicio_capacidad_v1() r')).rows[0].r;assert.notEqual(cap.aplicar_pago_existente_v1,true);
 });
});
