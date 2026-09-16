// Explicit integration command; uses ephemeral PostgreSQL and never a network database.
// HAKU_PGLITE_MODULE may point at a separately installed @electric-sql/pglite package.
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const S=require('../js/haiku-libro-semantica-v1.js');global.HAIKU_LIBRO_SEMANTICA=S;
const Q=require('../js/haiku-libro-consultas-v1.js');

(async()=>{
 const db=new PGlite();
 await db.exec(read('tests/fixtures/libro-distribucion-schema.sql'));
 await db.exec(`
  alter table public.catalogo_servicios add column nombre text, add column categoria text;
  alter table public.servicios add column total bigint default 0, add column tipo_cobro text default 'normal';
  alter table public.pago_aplicaciones add column id uuid default gen_random_uuid(), add primary key(pago_id,cargo_id);
  drop view public.vista_estado_cargos;
  create view public.vista_estado_cargos as
   select c.id cargo_id,c.reserva_id,c.tipo_cargo,c.estado,
    coalesce(cs.nombre,cs.codigo,c.tipo_cargo) concepto,
    coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a join pagos p on p.id=a.pago_id where a.cargo_id=c.id and p.estado='confirmado'),0) aplicado_neto,
    c.monto-coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a join pagos p on p.id=a.pago_id where a.cargo_id=c.id and p.estado='confirmado'),0) saldo_cargo
   from cargos c left join servicios s on s.id=c.servicio_id left join catalogo_servicios cs on cs.id=s.catalogo_servicio_id;
 `);
 await db.exec(read('tests/fixtures/registrar-pago-supabase.sql'));
 await db.exec(read('supabase/migrations/20260908164059_haku_libro_estado_confirmado.sql'));
 await db.exec(read('supabase/migrations/20260915233506_haku_libro_aplicaciones_servicio_seguras.sql'));

 const user=randomUUID(),reserva=randomUUID(),otherReserva=randomUUID(),estadia=randomUUID(),cab=randomUUID();
 const catalogLate=randomUUID(),catalogJacuzzi=randomUUID(),serviceLate=randomUUID(),serviceJacuzzi=randomUUID();
 const cargoLate=randomUUID(),cargoJacuzzi=randomUUID();
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 await db.query("insert into reservas values($1,'Carlos Marquez','confirmada'),($2,'Otra reserva','confirmada')",[reserva,otherReserva]);
 await db.query('insert into cabanas values($1,5)',[cab]);
 await db.query("insert into reserva_estadias values($1,$2,$3,'2026-09-03','2026-09-04','confirmada')",[estadia,reserva,cab]);
 await db.query("insert into catalogo_servicios(id,codigo,nombre) values($1,'lateCheckout','Late Checkout'),($2,'jacuzzi','Jacuzzi')",[catalogLate,catalogJacuzzi]);
 await db.query("insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,estado_servicio,total,tipo_cobro) values($1,$2,$3,$4,'2026-09-03','pendiente',20000,'normal'),($5,$2,$3,$6,'2026-09-03','pendiente',30000,'normal')",[serviceLate,reserva,estadia,catalogLate,serviceJacuzzi,catalogJacuzzi]);
 await db.query("insert into cargos(id,reserva_id,estadia_id,servicio_id,tipo_cargo,estado,monto) values($1,$2,$3,$4,'servicio','activo',20000),($5,$2,$3,$6,'servicio','activo',30000)",[cargoLate,reserva,estadia,serviceLate,cargoJacuzzi,serviceJacuzzi]);

 const r=S.normalizarHoja(require('./fixtures/libro-pagos-sep26.cjs')(),'Sep26').reservas[0];r.texto_original='';
 const row={id:estadia,reserva_id:reserva,cabanas:{numero:5},fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout,
  estado_estadia:'confirmada',tipo_estadia:'alojamiento',reservas:{titular_nombre:r.titular,estado_reserva:'confirmada'}};
 const client={auth:{getSession:async()=>({data:{session:{user:{id:user}}}})},from(table){
  const data={reserva_estadias:[row],pagos:[],servicios:[]}[table];const b={select(){return b},lte(){return b},gte(){return b},in(){return b},order(){return b},range:async()=>({data})};return b;
 }};
 const comp=await Q.compararSistema([r],client,{desde:'2026-09-01',hasta:'2026-09-30'});
 const review=Q.crearPlanIncorporacion([r],comp);
 const approvals=new Set(review.items.filter(i=>i.distribucionManual).map(i=>i.id));
 const prepared=Q.crearPlanIncorporacion([r],comp,new Map(),approvals);
 const item=Q.serializarIncorporacion(prepared)[0];
 delete item.datos_origen.distribucion_manual;
 item.reserva_id=reserva;item.aprobado_manualmente=true;
 item.argumentos={...item.argumentos,p_monto:50000,p_medio_pago:'tarjeta_debito',p_folio:'000270',p_codigo_autorizacion:'622979',p_bove:null,p_modo_aplicacion:'ninguno'};
 item.datos_origen={...item.datos_origen,bovtar:null,aplicaciones_servicio_v1:{version:1,reserva_id:reserva,monto_total:50000,moneda:'CLP',aplicaciones:[
  {cargo_id:cargoLate,servicio_id:serviceLate,monto:20000,saldo_esperado:20000,aplicado_esperado:0,cantidad_aplicaciones_esperada:0,concepto_canon:'late_checkout',fecha_contexto:'2026-09-03',fecha_servicio_esperada:'2026-09-03'},
  {cargo_id:cargoJacuzzi,servicio_id:serviceJacuzzi,monto:30000,saldo_esperado:30000,aplicado_esperado:0,cantidad_aplicaciones_esperada:0,concepto_canon:'tinaja_jacuzzi',fecha_contexto:'2026-09-03',fecha_servicio_esperada:'2026-09-03'}
 ]}};
 const call=async(i=item,op=randomUUID())=>(await db.query('select public.haiku_incorporar_pago_servicios_libro_v1($1,$2::jsonb) result',[op,JSON.stringify(i)])).rows[0].result;
 const counts=async()=>({
  pagos:(await db.query('select count(*)::int n from pagos')).rows[0].n,
  aplicaciones:(await db.query('select count(*)::int n from pago_aplicaciones')).rows[0].n
 });
 const rollback=async(fn)=>{await db.exec('begin');try{return await fn();}finally{await db.exec('rollback');}};
 const rejectItem=async(change,pattern)=>{const before=await counts();await rollback(async()=>{const copy=structuredClone(item);change(copy);await assert.rejects(()=>call(copy),pattern);});assert.deepEqual(await counts(),before);};
 const rejectDb=async(change,pattern)=>{const before=await counts();await rollback(async()=>{await change();await assert.rejects(()=>call(),pattern);});assert.deepEqual(await counts(),before);};

 await rollback(async()=>{
  const op=randomUUID(),result=await call(item,op);assert.equal(result.pagos_creados,1);
  assert.deepEqual(await counts(),{pagos:1,aplicaciones:2});
  const sums=(await db.query('select p.monto,sum(a.monto_aplicado) aplicado from pagos p join pago_aplicaciones a on a.pago_id=p.id group by p.id,p.monto')).rows[0];
  assert.equal(Number(sums.monto),50000);assert.equal(Number(sums.aplicado),50000);
  const repeat=await call(item,op);assert.equal(repeat.reintento,true);assert.deepEqual(await counts(),{pagos:1,aplicaciones:2});
 });
 await rejectDb(()=>db.query("update cargos set monto=19000 where id=$1",[cargoLate]),/saldo|cargo/i);
 await rejectDb(()=>db.query("update cargos set estado='anulado' where id=$1",[cargoLate]),/cargo o servicio/i);
 await rejectDb(()=>db.query("update servicios set tipo_cobro='cortesia' where id=$1",[serviceLate]),/cargo o servicio/i);
 await rejectDb(async()=>{
  const s=randomUUID(),c=randomUUID();
  await db.query("insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,estado_servicio,total,tipo_cobro) values($1,$2,$3,$4,'2026-09-03','pendiente',20000,'normal')",[s,reserva,estadia,catalogLate]);
  await db.query("insert into cargos(id,reserva_id,estadia_id,servicio_id,tipo_cargo,estado,monto) values($1,$2,$3,$4,'servicio','activo',20000)",[c,reserva,estadia,s]);
 },/destino dejó de ser único/i);
 await rejectDb(async()=>{
  const p=randomUUID();await db.query("insert into pagos(id,reserva_id,monto,moneda,tipo_movimiento,medio_pago,estado,fecha_pago) values($1,$2,1000,'CLP','pago','efectivo','confirmado',now())",[p,reserva]);
  await db.query('insert into pago_aplicaciones values($1,$2,1000)',[p,cargoLate]);
 },/saldo o las aplicaciones/i);
 await rollback(async()=>{
  await db.query("insert into pagos(reserva_id,monto,moneda,tipo_movimiento,medio_pago,estado,fecha_pago,codigo_autorizacion) values($1,50000,'CLP','pago','tarjeta_debito','confirmado',now(),'622979')",[reserva]);
  const result=await call();assert.equal(result.omitidos,1);assert.equal((await counts()).pagos,1);
 });
 await rejectDb(async()=>{
  await db.query("insert into pagos(reserva_id,monto,moneda,tipo_movimiento,medio_pago,estado,fecha_pago,codigo_autorizacion) values($1,50000,'CLP','pago','tarjeta_debito','confirmado',now(),'622979')",[reserva]);
  await db.query("insert into pagos(reserva_id,monto,moneda,tipo_movimiento,medio_pago,estado,fecha_pago,codigo_autorizacion) values($1,50000,'CLP','pago','tarjeta_debito','confirmado',now(),'622979')",[reserva]);
 },/múltiples pagos confirmados/i);
 await rejectDb(()=>db.query("insert into pagos(reserva_id,monto,moneda,tipo_movimiento,medio_pago,estado,fecha_pago,codigo_autorizacion) values($1,50000,'CLP','pago','tarjeta_debito','confirmado',now(),'622979')",[otherReserva]),/otra reserva/i);
 await rejectItem(i=>{i.datos_origen.aplicaciones_servicio_v1.aplicaciones[1].monto=29999;},/suma de aplicaciones/i);
 await rejectItem(i=>{i.datos_origen.aplicaciones_servicio_v1.aplicaciones[1].cargo_id=cargoLate;},/reutilizar el mismo cargo/i);
 await rejectItem(i=>{i.datos_origen.aplicaciones_servicio_v1.aplicaciones[0].monto=20001;},/supera el saldo/i);
 await rejectItem(i=>{i.datos_origen.aplicaciones_servicio_v1.aplicaciones[0].concepto_canon='masaje';},/cargo o servicio/i);
 for(const estado of ['anulado','pendiente','pendiente_asociacion']) await rollback(async()=>{
  await db.query("insert into pagos(reserva_id,monto,moneda,tipo_movimiento,medio_pago,estado,fecha_pago,codigo_autorizacion) values($1,50000,'CLP','pago','tarjeta_debito',$2,now(),'622979')",[reserva,estado]);
  const result=await call();assert.equal(result.pagos_creados,1);assert.deepEqual(await counts(),{pagos:2,aplicaciones:2});
 });
 await rejectItem(i=>{i.argumentos.p_medio_pago='efectivo';i.argumentos.p_codigo_autorizacion=null;i.argumentos.p_folio=null;i.datos_origen.bovtar=null;},/Efectivo sin identificador/);
 await rejectItem(i=>{i.argumentos.p_bove='BOVE-ADMINISTRATIVO';i.datos_origen.bovtar=null;},/BOVE administrativo/);
 await rejectDb(()=>db.query("update reservas set estado_reserva='cancelada' where id=$1",[reserva]),/reserva destino/i);
 await rejectDb(()=>db.query("update servicios set estado_servicio='cancelado' where id=$1",[serviceJacuzzi]),/cargo o servicio/i);

 assert.deepEqual(await counts(),{pagos:0,aplicaciones:0});
 await db.close();
 console.log('PASS PostgreSQL: Carlos contract, one payment/two applications, 13 negative paths, idempotency and atomic rollback. No remote writes.');
})().catch(e=>{console.error(e);process.exitCode=1;});
