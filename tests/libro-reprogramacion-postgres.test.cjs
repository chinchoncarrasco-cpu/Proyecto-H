const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {crear}=require('./fixtures/libro-reprogramacion-sql.cjs');
test('reprogramación conjunta en PostgreSQL con exclusiones reales de cabaña y recurso',async t=>{
 const h=await crear(),{db,id}=h;t.after(()=>db.close());
 const caso=(nombre,fn)=>t.test(nombre,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});
 const fin=s=>Object.fromEntries(['cargos','pagos','pago_aplicaciones','cargo_ajustes'].map(k=>[k,s[k]]));
 const ocupado=async()=>{const r=randomUUID(),e=randomUUID(),s=randomUUID();
  await db.query("insert into reservas(id,titular_nombre,estado_reserva) values($1,'Otra reserva ficticia','confirmada')",[r]);
  await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia) values($1,$2,$3,'2026-12-28','2026-12-29','confirmada')",[e,r,id.cabanaDestino]);
  await db.query("insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,recurso_id,fecha_servicio,hora_inicio,hora_fin,estado_servicio,total) values($1,$2,$3,$4,$5,'2026-12-28','18:00','19:00','programado',30000)",[s,r,e,id.catJacuzzi,id.recurso]);return s;
 };
 const rechaza=async(fn,re)=>{await db.exec('savepoint esperado');try{await assert.rejects(fn,re);}finally{await db.exec('rollback to savepoint esperado;release savepoint esperado');}};
 await caso('CAB 9: salida/ingreso anclados, notas de llegada y horarios; antiguo no confirmado',async()=>{
  const p=await h.plan(),item=s=>p.items.find(i=>i.registro_id===id[s]);
  assert.equal(item('late').fecha_propuesta,'2026-12-29');assert.equal(item('early').fecha_propuesta,'2026-12-28');
  assert.equal(item('nota').fecha_propuesta,'2026-12-28');assert.equal(item('jacuzzi').hora_inicio,'18:30:00');
  assert.equal(item('antiguo').inicial,null);assert.equal(item('antiguo').estado,'revision');assert.equal(item('antiguo').opciones.includes('mover'),false);
  assert.match(item('antiguo').motivo,/fuera de las fechas originales/);assert.equal(item('anterior').estado,'otra_estadia');assert.equal(item('realizado').estado,'historico');
  const antes=await h.snapshot(),d=h.decisiones(p);delete d['servicio:'+id.antiguo];
  await rechaza(()=>h.aplicar(p,d),/Decide/);assert.deepEqual(await h.snapshot(),antes);
 });
 for(const cabana of [9,4])await caso('traslado completo a CAB '+cabana+': mismos IDs, horas, textos y ledger',async()=>{
  const p=await h.plan(h.destino(cabana)),antes=await h.snapshot(),op=randomUUID();
  const result=await h.aplicar(p,undefined,op),despues=await h.snapshot();
  assert.equal(result.finanzas_conservadas,true);assert.equal(result.cambios.length,4);assert.deepEqual(fin(despues),fin(antes));
  const late=despues.servicios.find(s=>s.id===id.late),early=despues.servicios.find(s=>s.id===id.early),nota=despues.notas.find(n=>n.id===id.nota);
  assert.equal(late.fecha_servicio,'2026-12-29');assert.equal(late.hora_fin,'14:00:00');assert.equal(early.fecha_servicio,'2026-12-28');
  assert.equal(nota.fecha_operacion,'2026-12-28');assert.equal(nota.cabana_id,cabana===9?id.cabana:id.cabanaDestino);
  assert.equal(nota.texto,antes.notas.find(n=>n.id===id.nota).texto);assert.deepEqual(despues.notas.find(n=>n.id===id.notaManual),antes.notas.find(n=>n.id===id.notaManual));
  assert.equal(despues.estadia_noches[0].id,antes.estadia_noches[0].id);assert.equal(despues.estadia_noches[0].fecha,'2026-12-28');assert.equal(despues.estadia_noches[0].tarifa,144000);
  const viejo=despues.servicios.find(s=>s.id===id.antiguo);assert.equal(viejo.fecha_servicio,'2026-10-03');assert.equal(viejo.reprogramacion_revision_v1.version,1);
  for(const s of [id.anterior,id.realizado])assert.deepEqual(despues.servicios.find(x=>x.id===s),antes.servicios.find(x=>x.id===s));
  assert.deepEqual(despues.servicios.map(s=>s.id).sort(),antes.servicios.map(s=>s.id).sort());
  assert.ok(!despues.servicios.some(s=>s.id===id.late&&s.fecha_servicio==='2026-11-16'));
  assert.ok(!despues.notas.some(n=>n.id===id.nota&&n.fecha_operacion==='2026-11-15'));
  assert.equal((await h.aplicar(p,undefined,op)).reintento,true);assert.deepEqual(await h.snapshot(),despues);
  await rechaza(()=>h.aplicar(p),/Cambió/);assert.deepEqual(await h.snapshot(),despues);
 });
 await caso('horario ocupado: no propone mover el Jacuzzi; decisión explícita deja revisión',async()=>{
  await ocupado();const p=await h.plan(),j=p.items.find(i=>i.registro_id===id.jacuzzi);assert.equal(j.estado,'revision');assert.equal(j.conflictos.length,1);assert.equal(j.inicial,null);assert.match(j.motivo,/ocupado/);
  const result=await h.aplicar(p);assert.ok(result.servicios_revision.includes(id.jacuzzi));
  const s=(await h.snapshot()).servicios.find(s=>s.id===id.jacuzzi);assert.equal(s.fecha_servicio,'2026-11-15');assert.equal(s.reprogramacion_revision_v1.version,1);
 });
 await caso('horario ocupado después de la vista previa revierte toda la operación',async()=>{
  const p=await h.plan();await ocupado();const antes=await h.snapshot();await rechaza(()=>h.aplicar(p),/disponibilidad.*ocupado/);assert.deepEqual(await h.snapshot(),antes);
 });
 for(const [nombre,cambio]of [
  ['nota',()=>db.query("update notas set texto='Cambio manual concurrente' where id=$1",[id.nota])],
  ['servicio',()=>db.query("update servicios set hora_fin='14:30' where id=$1",[id.late])],
  ['reserva',()=>db.query("update reservas set observaciones='Comentario agregado' where id=$1",[id.reserva])],
  ['cabaña destino',()=>db.query('update cabanas set precio_base=precio_base+1000 where id=$1',[id.cabana])]
 ])await caso('rechaza cambio concurrente de '+nombre+' y exige nueva revisión',async()=>{
  const p=await h.plan();await cambio();const antes=await h.snapshot();await rechaza(()=>h.aplicar(p),/Cambió/);assert.deepEqual(await h.snapshot(),antes);
 });
 await caso('sin permiso, duración diferente o estadía con ingreso no usa un traslado parcial',async()=>{
  const p=await h.plan();await db.exec("select set_config('reprog.deny_permission','reservas.editar',true)");await rechaza(()=>h.aplicar(p),/permiso/);
  await db.exec("select set_config('reprog.deny_permission','',true)");const largo=await h.plan({...h.destino(),fecha_salida:'2026-12-30'});assert.match(largo.bloqueos.join(' '),/duración/);await rechaza(()=>h.aplicar(largo),/duración/);
  await db.query("update reserva_estadias set checkin_realizado_en=now() where id=$1",[id.estadia]);const ingresada=await h.plan();assert.match(ingresada.bloqueos.join(' '),/ingreso\/salida/);await rechaza(()=>h.aplicar(ingresada),/ingreso\/salida/);
 });
 await caso('el Libro usa la misma transacción, conserva pagos y registra un único lote',async()=>{
  const p=await h.plan(h.destino(4)),antes=await h.snapshot(),item=h.item({});
  item.item_id='traslado-libro-ficticio';item.estadia={antes:{fecha_ingreso:'2026-11-15',fecha_salida:'2026-11-16',cabana_numero:9},despues:{fecha_ingreso:'2026-12-28',fecha_salida:'2026-12-29',cabana_numero:4}};
  item.reprogramacion_v1={operacion_id:randomUUID(),version_libro:'f'.repeat(64),propuesta:p,decisiones:h.decisiones(p)};
  const op=randomUUID();await h.lote([item],op);const final=await h.snapshot();assert.deepEqual(fin(final),fin(antes));
  assert.equal(final.servicios.find(s=>s.id===id.late).fecha_servicio,'2026-12-29');assert.equal(final.notas.find(n=>n.id===id.nota).cabana_id,id.cabanaDestino);
  assert.equal((await h.lote([item],op)).reintento,true);assert.deepEqual(await h.snapshot(),final);
 });
 await caso('rechazo del resto del lote del Libro revierte también servicios y notas',async()=>{
  const p=await h.plan(),item=h.item({titular_numero_documento:'FICTICIO-B'});
  item.estadia={antes:{fecha_ingreso:'2026-11-15',fecha_salida:'2026-11-16'},despues:{fecha_ingreso:'2026-12-28',fecha_salida:'2026-12-29'}};
  item.reprogramacion_v1={operacion_id:randomUUID(),version_libro:'f'.repeat(64),propuesta:p,decisiones:h.decisiones(p)};
  const antes=await h.snapshot();await rechaza(()=>h.lote([item]),/documento|identidad/i);assert.deepEqual(await h.snapshot(),antes);
 });
 await caso('los clientes antiguos no pueden cambiar fechas sin revisar servicios y notas',async()=>{
  const i=h.item({});i.estadia={antes:{fecha_ingreso:'2026-11-15'},despues:{fecha_ingreso:'2026-12-28'}};
  await rechaza(()=>h.lote([i]),/conjuntamente/);
  await rechaza(()=>db.query('select private.haiku_editar_reserva_asistente_impl_v1($1,$2,$3,$4,$5)',[id.reserva,id.estadia,'{}',JSON.stringify(h.destino()),null]),/conjuntamente/);
 });
 await caso('un servicio pagado conserva el cargo, el pago y su aplicación al trasladarse',async()=>{
  const cargo=(await db.query('select id from cargos where servicio_id=$1',[id.late])).rows[0].id,pago=randomUUID();
  await db.query("insert into pagos(id,reserva_id,monto,moneda,tipo_movimiento,estado,fecha_pago) values($1,$2,30000,'CLP','pago','confirmado','2026-11-01')",[pago,id.reserva]);
  await db.query('insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,30000)',[pago,cargo]);
  const antes=await h.snapshot();await h.aplicar(await h.plan());const despues=await h.snapshot();assert.deepEqual(fin(despues),fin(antes));
  assert.equal(despues.servicios.find(s=>s.id===id.late).fecha_servicio,'2026-12-29');
 });
 await caso('ocupación nueva de cabaña detiene la confirmación y mantiene el origen',async()=>{
  const p=await h.plan(h.destino(4));await ocupado();const antes=await h.snapshot();
  await rechaza(()=>h.aplicar(p),/ocupada/);assert.deepEqual(await h.snapshot(),antes);
 });
 await caso('RPC sólo autenticado, sin acceso directo al registro de operaciones',async()=>{
  for(const f of ['haiku_reprogramacion_preparar_v1(uuid,uuid,jsonb)','haiku_reprogramar_estadia_v1(uuid,jsonb,jsonb)']){
   const x=(await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') usuario",['public.'+f])).rows[0];
   assert.equal(x.anon,false);assert.equal(x.usuario,true);
  }
  assert.equal((await db.query("select has_table_privilege('authenticated','private.haiku_reprogramaciones_v1','insert') ok")).rows[0].ok,false);
 });
 await caso('desplazamiento solapado conserva dos noches y evita colisión de fecha',async()=>{
  await db.query("update reserva_estadias set fecha_salida='2026-11-17' where id=$1",[id.estadia]);
  await db.query("update servicios set fecha_servicio='2026-11-17' where id=$1",[id.late]);
  await db.query("insert into estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) values($1,'2026-11-16',144000,'catalogo')",[id.estadia]);
  const antes=await h.snapshot(),p=await h.plan({cabana_numero:9,fecha_ingreso:'2026-11-16',fecha_salida:'2026-11-18'});await h.aplicar(p);
  const despues=await h.snapshot();assert.deepEqual(despues.estadia_noches.map(n=>n.fecha).sort(),['2026-11-16','2026-11-17']);assert.deepEqual(fin(despues),fin(antes));
 });
 await caso('no se puede falsificar la guardia para omitir rango o marcar revisión',async()=>{
  await db.query("select set_config('app.haiku_reprogramacion_v1',$1,true)",[randomUUID()]);
  await rechaza(()=>db.query("update reserva_estadias set fecha_ingreso='2026-12-28',fecha_salida='2026-12-29' where id=$1",[id.estadia]),/rango/);
  await rechaza(()=>db.query("update servicios set reprogramacion_revision_v1='{}' where id=$1",[id.late]),/confirmación transaccional/);
  await rechaza(()=>db.query("insert into servicios(reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,estado_servicio,total,reprogramacion_revision_v1) values($1,$2,$3,'2026-11-15','programado',30000,'{}')",[id.reserva,id.estadia,id.catLate]),/confirmación transaccional/);
 });
});
