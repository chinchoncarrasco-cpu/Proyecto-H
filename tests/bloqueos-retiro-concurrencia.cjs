// Ejecutar ÚNICAMENTE contra una base PostgreSQL nueva y desechable en localhost.
// Requiere psql instalado; nunca toma SUPABASE_URL ni DATABASE_URL del proyecto.
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const host=process.env.HAKU_BLOQUEOS_TEST_HOST||'127.0.0.1';
const database=process.env.HAKU_BLOQUEOS_TEST_DATABASE||'';
if(!['127.0.0.1','localhost','::1'].includes(host)||!/^haku_bloqueos_test_[a-z0-9_]+$/.test(database))throw Error('Se requiere una base local desechable HAKU_BLOQUEOS_TEST_DATABASE=haku_bloqueos_test_...');
const binary=process.env.HAKU_BLOQUEOS_TEST_PSQL||'psql';
const env={...process.env,PGHOST:host,PGDATABASE:database,PGPORT:process.env.HAKU_BLOQUEOS_TEST_PORT||'5432',PGUSER:process.env.HAKU_BLOQUEOS_TEST_USER||'postgres',PGPASSWORD:process.env.HAKU_BLOQUEOS_TEST_PASSWORD||'',PGSERVICE:'',PGSERVICEFILE:'',PGOPTIONS:''};
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function iniciar(sql,app='haku_bloqueos_test_admin'){
 const child=spawn(binary,['-X','-w','-A','-t','-v','ON_ERROR_STOP=1'],{env:{...env,PGAPPNAME:app},windowsHide:true});let out='',err='';
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('close',code=>resolve({code,out,err}));});
 child.stdin.end(sql);return {done,output:()=>out};
}
async function query(sql){const r=await iniciar(sql).done;if(r.code!==0)throw Error(r.err);return r.out.trim();}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const id='00000000-0000-4000-8000-000000000001',cab='00000000-0000-4000-8000-000000000002',user='00000000-0000-4000-8000-000000000003';
(async()=>{
 assert.equal(await query("select count(*) from information_schema.tables where table_schema in ('public','private','auth');"),'0','Usar una base vacía desechable.');
 await query(read('tests/fixtures/bloqueos-retiro-schema.sql')+read('supabase/migrations/20260914155231_liberar_bloqueo_libro_seguro.sql'));
 await query(`insert into cabanas values('${cab}',2);`);
 const call=`select set_config('request.jwt.claim.sub','${user}',false);select public.haiku_liberar_bloqueo_libro_seguro('${id}',2,'2026-09-06','2026-09-07','LATE HASTA LAS 14:00','2026-09-14T10:00:00.123456Z');`;
 for(const op of ['version','liberacion']){
  await query(`delete from bloqueos_cabana;insert into bloqueos_cabana values('${id}','${cab}','activo','2026-09-06T04:00:00Z','2026-09-07T03:00:00Z','LATE HASTA LAS 14:00','2026-09-14T10:00:00.123456Z',null,null);`);
  const mutation=op==='version'?"update bloqueos_cabana set actualizado_en='2026-09-14T10:00:00.123457Z';":call;
  const A=iniciar(`set statement_timeout='15s';begin;${mutation}select 'FILA_BLOQUEADA';select pg_sleep(4);commit;`,'haku_bloqueos_test_a');
  for(let i=0;i<100&&!A.output().includes('FILA_BLOQUEADA');i++)await pause(20);
  assert.ok(A.output().includes('FILA_BLOQUEADA'));
  const B=iniciar(`set statement_timeout='15s';${call}`,'haku_bloqueos_test_b');
  let blocked=false;for(let i=0;i<60&&!blocked;i++){blocked=await query("select exists(select 1 from pg_stat_activity where application_name='haku_bloqueos_test_b' and wait_event_type='Lock');")==='t';if(!blocked)await pause(20);}
  assert.ok(blocked,'La segunda conexión debe esperar el lock real');
  const [a,b]=await Promise.all([A.done,B.done]);assert.equal(a.code,0,a.err);
  if(op==='version'){assert.notEqual(b.code,0);assert.match(b.err,/cambió desde la vista previa/);assert.equal(await query('select estado from bloqueos_cabana;'),'activo');}
  else{assert.equal(b.code,0,b.err);assert.match(b.out,/ya_liberado/);assert.equal(await query('select estado from bloqueos_cabana;'),'liberado');}
 }
 console.log('PASS: 2 escenarios concurrentes reales; sólo base desechable local.');
})().catch(e=>{console.error(e);process.exitCode=1;});
