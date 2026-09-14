// PostgreSQL en memoria exclusivamente. No acepta ninguna URL ni conexión remota.
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration='supabase/migrations/20260914155231_liberar_bloqueo_libro_seguro.sql';
const id='00000000-0000-4000-8000-000000000001',cab='00000000-0000-4000-8000-000000000002',usuario='00000000-0000-4000-8000-000000000003';
(async()=>{
 const db=new PGlite();let checks=0;
 try{
  await db.exec(read('tests/fixtures/bloqueos-retiro-schema.sql'));
  await db.exec(read('supabase/migrations/20260902042119_liberar_bloqueos_calendario.sql'));
  const original=(await db.query("select pg_get_functiondef('public.haiku_liberar_bloqueo_calendario(uuid)'::regprocedure) d")).rows[0].d;
  await db.exec(read(migration));
  assert.equal((await db.query("select pg_get_functiondef('public.haiku_liberar_bloqueo_calendario(uuid)'::regprocedure) d")).rows[0].d,original);checks++;
  await db.query('insert into cabanas values($1,2)',[cab]);
  const version='2026-09-14T10:00:00.123456Z';
  const args=()=>[id,2,'2026-09-06','2026-09-07','LATE HASTA LAS 14:00',version];
  const call=async a=>(await db.query('select public.haiku_liberar_bloqueo_libro_seguro($1,$2,$3,$4,$5,$6) r',a||args())).rows[0].r;
  const snapshot=async()=>(await db.query('select row_to_json(b) r from bloqueos_cabana b where id=$1',[id])).rows[0]?.r;
  const reset=async()=>{
   await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('test.activo','true',false),set_config('test.permiso','true',false)",[usuario]);
   await db.query('delete from bloqueos_cabana');await db.query('update cabanas set numero=2 where id=$1',[cab]);
   await db.query("insert into bloqueos_cabana values($1,$2,'activo','2026-09-06T04:00:00Z','2026-09-07T03:00:00Z','LATE HASTA LAS 14:00',$3,null,null)",[id,cab,version]);
  };
  await reset();const ok=await call();assert.equal(ok.resultado,'liberado');assert.equal(ok.desde,'2026-09-06');assert.equal(ok.hasta,'2026-09-07');
  const after=await snapshot();assert.equal(after.estado,'liberado');assert.equal(after.liberado_por,usuario);assert.ok(after.liberado_en);checks++;
  assert.equal((await call()).resultado,'ya_liberado');assert.deepEqual(await snapshot(),after);checks++;
  await db.query('delete from bloqueos_cabana');assert.equal((await call()).resultado,'ya_no_existe');checks++;
  for(const [sql,params] of [
   ['update cabanas set numero=3',[]],
   ["update bloqueos_cabana set desde='2026-09-05T04:00:00Z'",[]],
   ["update bloqueos_cabana set hasta='2026-09-08T03:00:00Z'",[]],
   ["update bloqueos_cabana set motivo='Otro'",[]],
   ["update bloqueos_cabana set actualizado_en='2026-09-14T10:00:00.123457Z'",[]]
  ]){
   await reset();await db.query(sql,params);const before=await snapshot();await assert.rejects(call(),e=>e.code==='40001');assert.deepEqual(await snapshot(),before);checks++;
  }
  for(const index of [1,2,3,4,5]){await reset();const a=args();a[index]=null;await assert.rejects(call(a),e=>e.code==='40001');assert.equal((await snapshot()).estado,'activo');checks++;}
  for(const [key,value] of [['request.jwt.claim.sub',''],['test.activo','false'],['test.permiso','false']]){
   await reset();await db.query('select set_config($1,$2,false)',[key,value]);await assert.rejects(call(),/sesión|permiso/);assert.equal((await snapshot()).estado,'activo');checks++;
  }
  await reset();await db.query("update bloqueos_cabana set desde='2026-04-04T03:00:00Z',hasta='2026-04-05T04:00:00Z'");
  const a=args();a[2]='2026-04-04';a[3]='2026-04-05';assert.equal((await call(a)).resultado,'liberado');checks++;
  await reset();assert.equal((await db.query('select public.haiku_liberar_bloqueo_calendario($1) r',[id])).rows[0].r.estado,'liberado');checks++;
  const grants=(await db.query("select has_function_privilege('anon','public.haiku_liberar_bloqueo_libro_seguro(uuid,integer,date,date,text,timestamptz)','EXECUTE') anon,has_function_privilege('authenticated','public.haiku_liberar_bloqueo_libro_seguro(uuid,integer,date,date,text,timestamptz)','EXECUTE') authenticated")).rows[0];
  assert.equal(grants.anon,false);assert.equal(grants.authenticated,true);checks++;
  console.log(`PASS: ${checks} escenarios SQL en PostgreSQL efímero. No son una prueba de dos conexiones concurrentes.`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
