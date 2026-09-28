// PostgreSQL WASM efímero. No usa Docker, credenciales ni una base real.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const M=require('../js/haiku-reserva-estado-manual-v1.js');
const read=f=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8');
(async()=>{
 const db=new PGlite(); let checks=0;
 try{
  for(const f of ['tests/fixtures/reserva-estado-manual-schema.sql',
   'supabase/migrations/20260902045000_cancelar_reserva_desde_ficha_supabase.sql',
   'supabase/migrations/20260902162629_reactivar_reserva_cancelada_segura.sql',
   'supabase/migrations/20260927225926_cambio_manual_estado_reserva.sql']) await db.exec(read(f));
  const uid=randomUUID(); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const signature='public.haiku_cambiar_estado_reserva_manual_v1(uuid,uuid,text,jsonb)';
  const [security]=await q(`select prosecdef,proconfig,
    has_function_privilege('anon',oid,'EXECUTE') anon,
    has_function_privilege('authenticated',oid,'EXECUTE') authenticated from pg_proc where oid=$1::regprocedure`,[signature]);
  assert.equal(security.prosecdef,true); assert.equal(security.anon,false); assert.equal(security.authenticated,true);
  assert.ok(security.proconfig.includes('search_path=""')); checks++;
  async function scenario(fn){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
  async function seed({state='confirmada',rstate=state,group=false,abono=0,checkin=false,checkout=false,future=false}={}){
   const r=randomUUID(),e=randomUUID(),cab=randomUUID();
   await db.query("insert into cabanas(id,numero) values($1,2)",[cab]);
   await db.query("insert into reservas(id,estado_reserva,titular_nombre,observaciones,bove_cierre) values($1,$2,'Titular sintético','No alterar','BOVE protegido')",[r,rstate]);
   await db.query(`insert into reserva_estadias(id,reserva_id,cabana_id,estado_estadia,fecha_ingreso,fecha_salida,checkin_realizado_en,checkout_realizado_en)
    values($1,$2,$3,$4,(now() at time zone 'America/Santiago')::date+$5::integer,(now() at time zone 'America/Santiago')::date+2,$6,$7)`,
    [e,r,cab,state,future?1:-1,checkin?new Date().toISOString():null,checkout?new Date().toISOString():null]);
   if(group){const cab2=randomUUID();await db.query('insert into cabanas(id,numero) values($1,7)',[cab2]);
    await db.query(`insert into reserva_estadias(id,reserva_id,cabana_id,estado_estadia,fecha_ingreso,fecha_salida)
      select $1,reserva_id,$2,estado_estadia,fecha_ingreso,fecha_salida from reserva_estadias where id=$3`,[randomUUID(),cab2,e]);}
   if(abono)await db.query('insert into pagos(reserva_id,monto) values($1,$2)',[r,abono]);
   await db.exec(`insert into test_datos_ajenos values('servicios/cargos/aseos/revisiones/solicitudes', '{"conservar":true}')`);
   return{r,e,cab};
  }
  async function expected(x){const [r]=await q('select to_jsonb(r) value from reservas r where id=$1',[x.r]);
   const estadias=await q("select to_jsonb(s)||jsonb_build_object('cabana_numero',c.numero) value from reserva_estadias s join cabanas c on c.id=s.cabana_id where s.reserva_id=$1",[x.r]);
   return M.esperado({reserva:r.value,estadias:estadias.map(e=>e.value)});}
  async function call(x,state,exp){const [result]=await q('select public.haiku_cambiar_estado_reserva_manual_v1($1,$2,$3,$4::jsonb) value',
   [x.r,x.e,state,JSON.stringify(exp||await expected(x))]);return result.value;}
  async function snapshot(){const out={};for(const t of ['reservas','reserva_estadias','pagos','eventos_auditoria','test_rutas','test_datos_ajenos'])
   out[t]=await q(`select to_jsonb(t) value from ${t} t order by to_jsonb(t)::text`);return out;}
  async function rejects(fn,pattern,code){const before=await snapshot();await db.exec('savepoint attempt');
   await assert.rejects(fn,error=>{assert.match(error.message,pattern);
    if(code)assert.equal(error.code,code);else assert.notEqual(error.code,'40001');return true;});
   await db.exec('rollback to savepoint attempt');assert.deepEqual(await snapshot(),before);checks++;}
  for(const target of M.estados.map(e=>e.valor))await scenario(async()=>{
   const x=await seed({state:target==='confirmada'?'pendiente':'confirmada'});const before=await snapshot();
   const result=await call(x,target);assert.equal(result.ok,true);assert.equal(result.estado,target);
   const after=await snapshot();assert.deepEqual(after.pagos,before.pagos);assert.deepEqual(after.test_datos_ajenos,before.test_datos_ajenos);
   for(const field of ['titular_nombre','observaciones','bove_cierre'])assert.equal(after.reservas[0].value[field],before.reservas[0].value[field]);
   for(const field of ['fecha_ingreso','fecha_salida','tipo_estadia','cabana_id'])
    assert.equal(after.reserva_estadias[0].value[field],before.reserva_estadias[0].value[field]);
   const [audit]=await q('select * from eventos_auditoria where reserva_id=$1',[x.r]);assert.equal(audit.usuario_id,uid);
   assert.equal(audit.cambios[0].nuevo,target);assert.ok(audit.datos_contexto.operacion_id);
   assert.equal((await q('select * from test_rutas')).length,['pendiente','confirmada','hospedada','checked_out'].includes(target)?1:0);checks++;
  });
  await scenario(async()=>{const x=await seed({group:true});const others=await q('select * from reserva_estadias where reserva_id=$1 and id<>$2',[x.r,x.e]);
   await call(x,'hospedada');assert.deepEqual(await q('select * from reserva_estadias where reserva_id=$1 and id<>$2',[x.r,x.e]),others);checks++;});
  await scenario(async()=>{const x=await seed({state:'hospedada'});
   await db.query("update reserva_estadias set checkin_realizado_en='2026-09-25T18:00:00.123456Z' where id=$1",[x.e]);
   const exp=await expected(x);assert.equal(exp.estadias[0].checkin_realizado_en,'2026-09-25T18:00:00.123456Z');
   await call(x,'confirmada',exp);checks++;});
  for(const target of ['cancelada','no_show'])await scenario(async()=>{const x=await seed({group:true});await call(x,target);
   assert.ok((await q('select estado_estadia from reserva_estadias where reserva_id=$1',[x.r])).every(s=>s.estado_estadia===target));checks++;});
  for(const [abono,target] of [[0,'pendiente'],[100,'confirmada']])await scenario(async()=>{
   const x=await seed({state:'cancelada',abono});await call(x,target);assert.equal((await q('select estado_estadia from reserva_estadias where id=$1',[x.e]))[0].estado_estadia,target);checks++;});
  await scenario(async()=>{const x=await seed({state:'cancelada'});await rejects(()=>call(x,'confirmada'),/no tiene abono/);});
  await scenario(async()=>{const x=await seed({state:'cancelada',abono:100});await rejects(()=>call(x,'pendiente'),/abono/);});
  await scenario(async()=>{const x=await seed({state:'cancelada',checkin:true});await rejects(()=>call(x,'pendiente'),/movimientos/);});
  await scenario(async()=>{const x=await seed({state:'cancelada',group:true});await rejects(()=>call(x,'pendiente'),/varias/);});
  await scenario(async()=>{const x=await seed({state:'cancelada'});
   await db.query("insert into bloqueos_cabana(cabana_id,desde,hasta) values($1,now()-interval '2 days',now()+interval '4 days')",[x.cab]);
   await rejects(()=>call(x,'pendiente'),/bloqueada/);});
  await scenario(async()=>{const x=await seed({state:'cancelada'});
   await db.query(`insert into reserva_estadias(id,reserva_id,cabana_id,estado_estadia,fecha_ingreso,fecha_salida)
    select $1,reserva_id,cabana_id,'confirmada',fecha_ingreso,fecha_salida from reserva_estadias where id=$2`,[randomUUID(),x.e]);
   // La reserva cancelada no admite multiestadía; un conflicto independiente prueba la RPC oficial.
   const r2=randomUUID();await db.query("insert into reservas(id,estado_reserva) values($1,'confirmada')",[r2]);
   await db.query('update reserva_estadias set reserva_id=$1 where id<>$2',[r2,x.e]);
   await rejects(()=>call(x,'pendiente'),/otra reserva/);});
  for(const opts of [{future:true},{checkin:true},{checkout:true},{state:'hospedada'}])await scenario(async()=>{
   const x=await seed(opts);await rejects(()=>call(x,'no_show'),/00:00|check-in/);});
  // Sólo en la base WASM efímera se sustituye el reloj de pared por un timestamp
  // controlado. La firma, el predicado America/Santiago y las demás reglas son
  // los de la migración real; no se introduce un reloj manipulable en producción.
  const migration=read('supabase/migrations/20260927225926_cambio_manual_estado_reserva.sql');
  assert.equal((migration.match(/clock_timestamp\(\)/g)||[]).length,1);
  const controlledClock=migration.replace('create function','create or replace function')
   .replace('clock_timestamp()',"(current_setting('test.ahora',true)::timestamptz)");
  for(const [caso,ingreso,timestamp,permitido,opts] of [
   ['futuro','2026-09-28','2026-09-27T15:00:00Z',false,{}],
   ['23:59 anterior','2026-09-27','2026-09-27T02:59:00Z',false,{}],
   ['último microsegundo anterior','2026-09-27','2026-09-27T02:59:59.999999Z',false,{}],
   ['00:00 exacto','2026-09-27','2026-09-27T03:00:00Z',true,{}],
   ['hoy posterior','2026-09-27','2026-09-27T15:00:00Z',true,{}],
   ['check-in previo','2026-09-27','2026-09-27T15:00:00Z',false,{checkin:true}],
   ['checkout previo','2026-09-27','2026-09-27T15:00:00Z',false,{checkout:true}],
   ['invierno anterior','2026-07-27','2026-07-27T03:59:59Z',false,{}],
   ['invierno 00:00','2026-07-27','2026-07-27T04:00:00Z',true,{}]
  ])await scenario(async()=>{
   await db.exec(controlledClock);
   await db.query("select set_config('test.ahora',$1,true)",[timestamp]);
   // La sesión SQL usa otro huso horario para acreditar independencia de TimeZone.
   await db.exec("set local time zone 'Asia/Tokyo'");
   const x=await seed(opts);await db.query('update reserva_estadias set fecha_ingreso=$1::date,fecha_salida=$1::date+2 where id=$2',[ingreso,x.e]);
   if(permitido){assert.equal((await call(x,'no_show')).estado,'no_show',caso);checks++;}
   else await rejects(()=>call(x,'no_show'),/00:00|check-in/,'P0001');
  });
  await scenario(async()=>{const x=await seed({state:'no_show'});await rejects(()=>call(x,'confirmada'),/ruta segura/);});
  await scenario(async()=>{const x=await seed({abono:100});await rejects(()=>call(x,'pendiente'),/abono/);});
  await scenario(async()=>{const x=await seed();const exp=await expected(x);await db.query("update reserva_estadias set fecha_salida=fecha_salida+1 where id=$1",[x.e]);
   await rejects(()=>call(x,'cancelada',exp),/cambió/,'40001');});
  await scenario(async()=>{const x=await seed();const exp=await expected(x);await call(x,'hospedada',exp);
   await rejects(()=>call(x,'hospedada',exp),/cambió/,'40001');});
  await scenario(async()=>{const x=await seed();const exp=await expected(x);
   await db.query("update reservas set estado_reserva='pendiente' where id=$1",[x.r]);
   await rejects(()=>call(x,'cancelada',exp),/cambió/,'40001');});
  await scenario(async()=>{const x=await seed();await rejects(()=>call(x,'inventado'),/Estado no válido/,'P0001');});
  await scenario(async()=>{const x=await seed();await db.exec("set local test.error_rpc='true'");await rejects(()=>call(x,'checked_out'),/Protección de RPC oficial/);});
  await scenario(async()=>{const x=await seed();await db.exec(`create function public.test_reject_audit() returns trigger language plpgsql as $$
    begin raise exception 'Auditoría no disponible'; end$$;
    create trigger test_reject_audit before insert on eventos_auditoria for each row execute function public.test_reject_audit()`);
   await rejects(()=>call(x,'hospedada'),/Auditoría no disponible/);});
  await scenario(async()=>{const x=await seed();await db.exec('drop function public.haiku_cambiar_estado_estadia(uuid,text,timestamptz)');
   await rejects(()=>call(x,'checked_out'),/haiku_cambiar_estado_estadia/);});
  await scenario(async()=>{const x=await seed();const exp=await expected(x);await db.exec('set local role authenticated');
   assert.equal((await call(x,'hospedada',exp)).ok,true);checks++;});
  await scenario(async()=>{const x=await seed();await db.exec("set local test.sin_permiso='reservas.cancelar'");
   await rejects(()=>call(x,'cancelada'),/permiso/,'42501');});
  for(const [setting,value,pattern] of [['test.activo','false',/activo/],['test.sin_permiso','reservas.editar',/permiso/],['request.jwt.claim.sub','',/sesión/]])
   await scenario(async()=>{const x=await seed();await db.query('select set_config($1,$2,true)',[setting,value]);await rejects(()=>call(x,'hospedada'),pattern);});
  await scenario(async()=>{const x=await seed();await db.exec("set local test.null_permiso='reservas.editar'");
   await rejects(()=>call(x,'hospedada'),/permiso/);});
  await scenario(async()=>{const x=await seed();await db.exec('create or replace function private.haiku_usuario_activo() returns boolean language sql stable as $$select null::boolean$$');
   await rejects(()=>call(x,'hospedada'),/activo/);});
  await scenario(async()=>{const x=await seed();await db.exec('set local role authenticated');
   await assert.rejects(()=>db.query("update public.reservas set estado_reserva='cancelada' where id=$1",[x.r]),/permission denied/);checks++;});
  console.log(`PASS: ${checks} comprobaciones SQL en PGlite. RPC operativa ausente probada mediante doble explícito; cancelación/reactivación usan SQL real del repo.`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
