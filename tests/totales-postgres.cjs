const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const read=p=>fs.readFileSync(p,'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();let checks=0;
 try{
  await db.exec(read('tests/fixtures/total-schema.sql'));
  await db.exec(read('tests/fixtures/total-trigger-original.sql'));
  await db.exec('create trigger sincronizar after insert or update on estadia_noches for each row execute function haiku_sincronizar_cargo_noche();');
  await db.exec(read('tests/fixtures/total-core-original.sql'));
  await db.exec(read('tests/fixtures/total-editor-original.sql'));
  await db.exec(read('supabase/preparadas/haiku_totales_lote_v1.sql'));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(99)]);
  for(let n=1;n<=2;n++){
   await db.query('insert into cabanas(id,numero) values($1,$2)',[id(10+n),n===1?5:9]);
   await db.query("insert into reservas(id,titular_nombre,estado_reserva,bove_cierre,bove_checkout) values($1,$2,'checked_out','16989','19890')",[id(n),n===1?'Bruno Borge':'Constanza Kutscher']);
   await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia,checkin_realizado_en,checkout_realizado_en) values($1,$2,$3,'2026-09-04','2026-09-07','alojamiento','checked_out',now(),now())",[id(20+n),id(n),id(10+n)]);
   await db.query("insert into estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) select $1,d::date,150000,'manual' from generate_series('2026-09-04'::date,'2026-09-06'::date,'1 day') d",[id(20+n)]);
   await db.query("insert into servicios values($1,$2,20000,'activo')",[id(30+n),id(n)]);
   await db.query("insert into cargos(reserva_id,servicio_id,tipo_cargo,monto,estado) values($1,$2,'servicio',20000,'activo')",[id(n),id(30+n)]);
   await db.query("insert into pagos(id,reserva_id,monto,estado,tipo_movimiento) values($1,$2,100000,'confirmado','pago')",[id(40+n),id(n)]);
   await db.query("insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) select $1,id,100000 from cargos where reserva_id=$2 and tipo_cargo='alojamiento' order by id limit 1",[id(40+n),id(n)]);
  }
  const snap=async()=>JSON.stringify((await db.query("select (select jsonb_agg(r order by id) from reservas r) reservas,(select jsonb_agg(e order by id) from reserva_estadias e) estadias,(select jsonb_agg(p order by id) from pagos p) pagos,(select jsonb_agg(s order by id) from servicios s) servicios")).rows);
  const all=async()=>JSON.stringify((await db.query("select (select jsonb_agg(c order by id) from cargos c) cargos,(select jsonb_agg(n order by id) from estadia_noches n) noches,(select jsonb_agg(p order by id) from pago_aplicaciones p) apps,(select count(*) from auditoria_total) auditoria")).rows);
  const lote=(a=459000,b=480000)=>[{reserva_id:id(1),total_actual:450000,total_objetivo:a},{reserva_id:id(2),total_actual:450000,total_objetivo:b}];
  const call=x=>db.query('select haiku_cambiar_totales_lote_v1($1::jsonb) r',[JSON.stringify(x)]);
  const before=await snap();await call(lote());assert.equal(await snap(),before);checks++;
  assert.deepEqual((await db.query('select total_alojamiento from vista_saldos_alojamiento_reserva order by reserva_id')).rows.map(x=>Number(x.total_alojamiento)),[459000,480000]);checks++;
  assert.equal(Number((await db.query('select sum(monto_aplicado) v from pago_aplicaciones')).rows[0].v),200000);checks++;
  // Revertir sólo importes mediante la MISMA ruta antes de pruebas de fallo.
  await call([{reserva_id:id(1),total_actual:459000,total_objetivo:450000},{reserva_id:id(2),total_actual:480000,total_objetivo:450000}]);
  for(const changes of [lote(99999),lote(0),lote(459001),[{...lote()[0],total_actual:1}], [lote()[0],lote()[0]]]){const a=await all();await assert.rejects(call(changes));assert.equal(await all(),a);checks++;}
  await db.exec("create function fallo_segundo() returns trigger language plpgsql as $$begin if new.reserva_id='"+id(2)+"' and new.estado='activo' then raise exception 'fallo segunda reserva';end if;return new;end;$$; create trigger fallo before insert on cargos for each row execute function fallo_segundo();");
  const antes=await all();await assert.rejects(call(lote()),/fallo segunda reserva/);assert.equal(await all(),antes);assert.equal(await snap(),before);checks++;
  await db.exec('drop trigger fallo on cargos;');
  const misma=lote(450000,450000),s=await all();await call(misma);assert.equal(await all(),s);checks++;
  await db.exec("select set_config('haku.test_permit','off',false)");await assert.rejects(call(lote()),/permisos|requieren/);checks++;
  await db.exec("select set_config('haku.test_permit','on',false)");
  await db.query("update reservas set titular_numero_documento='pasaporte-123',titular_tipo_documento='pasaporte' where id=$1",[id(2)]);
  const protegido=await snap(),finanzas=await all();await assert.rejects(call(lote()),/datos ajenos/);assert.equal(await snap(),protegido);assert.equal(await all(),finanzas);checks++;
  const acl=(await db.query("select has_function_privilege('anon','public.haiku_cambiar_totales_lote_v1(jsonb)','execute') a,has_function_privilege('authenticated','public.haiku_cambiar_totales_lote_v1(jsonb)','execute') b")).rows[0];assert.deepEqual(acl,{a:false,b:true});checks++;
  await db.query('update reservas set titular_numero_documento=null,titular_tipo_documento=null where id=$1',[id(2)]);
  for(const estado of ['cancelada','no_show']){await db.query('update reservas set estado_reserva=$1 where id=$2',[estado,id(1)]);await assert.rejects(call(lote()),/cancelada/);checks++;}
  await db.query("update reservas set estado_reserva='checked_out' where id=$1",[id(1)]);
  await db.query("insert into reserva_estadias(id,reserva_id,estado_estadia) values($1,$2,'confirmada')",[id(90),id(1)]);await assert.rejects(call(lote()),/varias estadías/);checks++;await db.query('delete from reserva_estadias where id=$1',[id(90)]);
  await db.query("insert into cargo_ajustes values($1,$2,'activo')",[id(90),id(1)]);await assert.rejects(call(lote()),/Ajustes activos/);checks++;await db.query('delete from cargo_ajustes where id=$1',[id(90)]);
  await db.query("update estadia_noches set tarifa=149000 where estadia_id=$1 and fecha='2026-09-04'",[id(21)]);
  const variable=lote();variable[0].total_actual=449000;await assert.rejects(call(variable),/Tarifas variables/);checks++;
  await db.query("update estadia_noches set tarifa=150000 where estadia_id=$1 and fecha='2026-09-04'",[id(21)]);
  await db.query("insert into huespedes(id,nombre) values($1,'Acompañante Original')",[id(80)]);
  await db.query('insert into reserva_huespedes values($1,$2)',[id(1),id(80)]);await db.query('insert into estadia_huespedes values($1,$2)',[id(21),id(80)]);
  const hs=JSON.stringify((await db.query('select private.haiku_total_snapshot($1) s',[id(1)])).rows);await call(lote());assert.equal(JSON.stringify((await db.query('select private.haiku_total_snapshot($1) s',[id(1)])).rows),hs);checks++;
  await db.query("insert into reservas(id,titular_nombre,estado_reserva) values($1,'Full Day Test','confirmada')",[id(3)]);
  await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia) values($1,$2,$3,'2026-09-10','2026-09-10','fullday','confirmada')",[id(23),id(3),id(11)]);
  await db.query("insert into cargos(reserva_id,estadia_id,tipo_cargo,monto,estado) values($1,$2,'alojamiento',120000,'activo')",[id(3),id(23)]);
  await call([{reserva_id:id(3),total_actual:120000,total_objetivo:130000}]);assert.equal(Number((await db.query('select total_alojamiento t from vista_saldos_alojamiento_reserva where reserva_id=$1',[id(3)])).rows[0].t),130000);checks++;
  console.log(`PASS SQL: ${checks} escenarios, motor y trigger originales, rollback completo y datos sintéticos locales.`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
