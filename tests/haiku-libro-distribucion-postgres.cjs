// Explicit integration command; uses ephemeral PostgreSQL, never a network database.
// HAKU_PGLITE_MODULE points at a separately installed @electric-sql/pglite package.
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const S=require('../js/haiku-libro-semantica-v1.js');global.HAIKU_LIBRO_SEMANTICA=S;
const Q=require('../js/haiku-libro-consultas-v1.js');

(async()=>{
 const db=new PGlite();
 await db.exec(read('tests/fixtures/libro-distribucion-schema.sql'));
 await db.exec(read('tests/fixtures/registrar-pago-supabase.sql'));
 await db.exec(read('supabase/migrations/20260908164059_haku_libro_estado_confirmado.sql'));
 const original=(await db.query("select pg_get_functiondef('public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure) d")).rows[0].d;
 await db.exec(read('supabase/migrations/20260909215808_haku_libro_aprobacion_distribucion_manual.sql'));
 assert.equal((await db.query("select has_function_privilege('authenticated','private.haiku_libro_pago_distribuido_v1(uuid,jsonb,jsonb,boolean)','execute') allowed")).rows[0].allowed,false);
 const patched=(await db.query("select pg_get_functiondef('public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure) d")).rows[0].d;
 const restored=patched.replace("    if v_origen ? 'distribucion_manual' then\n      v_pago := private.haiku_libro_pago_distribuido_v1(v_reserva_id,v_argumentos,v_origen,v_manual);\n    else\n",'')
  .replace("    end if;\n    v_pago_id :=",'    v_pago_id :=');
 assert.equal(restored,original.replace(/\r/g,''),'Existing RPC body otherwise unchanged');
 const user=randomUUID(),reserva=randomUUID(),estadia=randomUUID(),cab=randomUUID(),charge=randomUUID(),service=randomUUID(),catalog=randomUUID(),serviceCharge=randomUUID();
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 await db.query("insert into reservas values($1,'Macarena Hurtado','confirmada')",[reserva]);
 await db.query('insert into cabanas values($1,5)',[cab]);
 await db.query("insert into reserva_estadias values($1,$2,$3,'2026-09-03','2026-09-04','confirmada')",[estadia,reserva,cab]);
 await db.query("insert into cargos(id,reserva_id,estadia_id,tipo_cargo,estado,monto) values($1,$2,$3,'alojamiento','activo',153000)",[charge,reserva,estadia]);
 const r=S.normalizarHoja(require('./fixtures/libro-pagos-sep26.cjs')(),'Sep26').reservas[0];r.texto_original='';
 const row={id:estadia,reserva_id:reserva,cabanas:{numero:5},fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout,
  estado_estadia:'confirmada',tipo_estadia:'alojamiento',reservas:{titular_nombre:r.titular,estado_reserva:'confirmada'}};
 const client={auth:{getSession:async()=>({data:{session:{user:{id:user}}}})},from(table){
  const data={reserva_estadias:[row],pagos:[],servicios:[]}[table];
  const b={select(){return b},lte(){return b},gte(){return b},in(){return b},order(){return b},range:async()=>({data})};return b;
 }};
 const comp=await Q.compararSistema([r],client,{desde:'2026-09-01',hasta:'2026-09-30'});
 const review=Q.crearPlanIncorporacion([r],comp);
 const approvals=new Set(review.items.filter(i=>i.distribucionManual).map(i=>i.id));
 const prepared=Q.crearPlanIncorporacion([r],comp,new Map(),approvals);
 const item=Q.serializarIncorporacion(prepared)[0];assert.equal(item.argumentos.p_monto,193000);
 const call=async(items=[item],op=randomUUID())=>(await db.query('select public.haiku_incorporar_libro_v1($1,$2::jsonb) result',[op,JSON.stringify(items)])).rows[0].result;
 const count=async()=>(await db.query('select count(*)::int n from pagos')).rows[0].n;
 const inRollback=async(fn)=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}};
 const reject=async(change,pattern)=>inRollback(async()=>{const copy=structuredClone(item);change(copy);await assert.rejects(()=>call([copy]),pattern);});
 await inRollback(async()=>{
  const op=randomUUID(),result=await call([item],op);
  assert.equal(result.pagos_creados,1);assert.equal(await count(),1);
  const p=(await db.query('select * from pagos')).rows[0];
  assert.equal(Number(p.monto),193000);assert.equal(p.folio,'000235');assert.equal(p.bove,'173121');
  assert.equal(Number((await db.query('select sum(monto_aplicado) n from pago_aplicaciones')).rows[0].n),153000);
  assert.deepEqual(p.datos_origen.aplicaciones_pendientes.map(a=>[a.monto,a.tipo_movimiento,a.concepto]),[[40000,'servicio','early check in']]);
  assert.equal((await call([item],op)).reintento,true);assert.equal(await count(),1);
  assert.equal((await call()).omitidos,1);assert.equal(await count(),1);
  const altered=structuredClone(item);altered.argumentos.p_monto=200000;
  await assert.rejects(()=>call([altered],op),/otra seleccion/);
 });
 await inRollback(async()=>{
  await db.query("insert into catalogo_servicios values($1,'earlyCheckin')",[catalog]);
  await db.query("insert into servicios values($1,$2,$3,$4,'2026-09-03','pendiente')",[service,reserva,estadia,catalog]);
  await db.query("insert into cargos(id,reserva_id,estadia_id,servicio_id,tipo_cargo,estado,monto) values($1,$2,$3,$4,'servicio','activo',40000)",[serviceCharge,reserva,estadia,service]);
  await call();
  assert.equal(Number((await db.query('select monto_aplicado n from pago_aplicaciones where cargo_id=$1',[serviceCharge])).rows[0].n),40000);
  assert.equal((await db.query('select datos_origen from pagos')).rows[0].datos_origen.aplicaciones_pendientes.length,0);
 });
 await reject(i=>i.aprobado_manualmente=false,/aprobadas/);
 await reject(i=>i.datos_origen.distribucion_manual.componentes[1].aprobado_manualmente=false,/incompatibles/);
 await reject(i=>i.argumentos.p_monto=999,/Total/);
 await reject(i=>delete i.datos_origen.distribucion_manual.total,/Total/);
 await reject(i=>i.datos_origen.distribucion_manual.componentes[0].texto_original+=' // Monto: $153.000',/total declarado/);
 await reject(i=>i.datos_origen.distribucion_manual.componentes[1]={...i.datos_origen.distribucion_manual.componentes[0]},/repite/);
 await reject(i=>i.datos_origen.distribucion_manual.componentes[1].folio='different',/incompatibles/);
 await reject(i=>i.datos_origen.distribucion_manual.componentes[1].medio_pago='efectivo',/Medios/);
 await inRollback(async()=>{
  await db.query("insert into reserva_estadias values($1,$2,$3,'2026-09-03','2026-09-04','confirmada')",[randomUUID(),reserva,cab]);
  await assert.rejects(()=>call(),/única/);
 });
 await inRollback(async()=>{
  const bad={...structuredClone(item),item_id:'bad',argumentos:{...item.argumentos,p_monto:-1}};
  // Different voucher avoids the existing-receipt shortcut on the second item.
  bad.argumentos.p_folio='other';bad.argumentos.p_bove='other';bad.datos_origen.bovtar='other';
  await assert.rejects(()=>call([item,bad]),/monto/);
 });
 assert.equal(await count(),0,'Failed and rolled-back transactions leave no payments');
 await db.query("select set_config('request.jwt.claim.sub','',false)");await assert.rejects(()=>call(),/iniciar sesion/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 await db.query("select set_config('haku.test_permit','off',false)");await assert.rejects(()=>call(),/permiso/);
 await db.query("select set_config('haku.test_permit','on',false)");
 const ordinary=structuredClone(item);delete ordinary.datos_origen.distribucion_manual;
 ordinary.argumentos.p_monto=20000;ordinary.argumentos.p_folio='000242';ordinary.argumentos.p_bove='750453';ordinary.datos_origen.bovtar='750453';
 await inRollback(async()=>{await call([ordinary]);assert.equal(Number((await db.query('select sum(monto_aplicado) n from pago_aplicaciones')).rows[0].n),20000);});
 assert.equal(await count(),0);
 await db.close();
 console.log('PASS PostgreSQL: explicit approvals, 193000 receipt, lodging/service allocation, missing service, true duplicates, retries, ambiguity, invalid data, permissions, atomic rollback and ordinary payment path. No remote writes.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
