// Ejecutar ÚNICAMENTE contra una base PostgreSQL nueva y desechable en localhost.
// Requiere psql instalado; nunca toma SUPABASE_URL ni DATABASE_URL del proyecto.
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const host=process.env.HAKU_BOVE_TEST_HOST||'127.0.0.1';
const database=process.env.HAKU_BOVE_TEST_DATABASE||'';
if(!['127.0.0.1','localhost','::1'].includes(host)||!/^haku_bove_test_[a-z0-9_]+$/.test(database))throw Error('Se requiere una base local desechable HAKU_BOVE_TEST_DATABASE=haku_bove_test_...');
const binary=process.env.HAKU_BOVE_TEST_PSQL||'psql';
const env={...process.env,PGHOST:host,PGDATABASE:database,PGPORT:process.env.HAKU_BOVE_TEST_PORT||'5432',PGUSER:process.env.HAKU_BOVE_TEST_USER||'postgres',PGPASSWORD:process.env.HAKU_BOVE_TEST_PASSWORD||'',PGSERVICE:'',PGSERVICEFILE:'',PGOPTIONS:''};
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function iniciar(sql,app='haku_bove_test_admin'){
 const child=spawn(binary,['-X','-w','-A','-t','-v','ON_ERROR_STOP=1'],{env:{...env,PGAPPNAME:app},windowsHide:true});let out='',err='';
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('close',code=>resolve({code,out,err}));});
 child.stdin.end(sql);return {done,output:()=>out};
}
async function query(sql){const r=await iniciar(sql).done;if(r.code!==0)throw Error(r.err);return r.out.trim();}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const id='00000000-0000-4000-8000-000000000001',a='00000000-0000-4000-8000-000000000002',b='00000000-0000-4000-8000-000000000003';
(async()=>{
 const schemas=await query("select count(*) from information_schema.tables where table_schema in ('public','private','auth');");
 assert.equal(schemas,'0','La base de pruebas debe estar vacía; no se limpian datos existentes.');
 await query(read('tests/fixtures/bove-schema.sql')+read('tests/fixtures/bove-rpc-originales.sql')+read('supabase/migrations/20260910180000_bove_registro_atomico.sql'));
 await query(`insert into reservas(id) values('${id}');insert into saldos_fixture values('${id}',0,100);insert into cargos_fixture values('${id}',30,0,'servicio','activo');`);
 let checks=0;
 for(const [fn,campo] of [['haiku_registrar_bove_reserva','bove_cierre'],['haiku_registrar_bove_checkout','bove_checkout']])for(const mismo of [false,true]){
  await query(`update reservas set ${campo}=null,${campo}_registrado_por=null,${campo}_registrado_en=null where id='${id}';truncate auditoria_fixture;`);
  const A=iniciar(`set statement_timeout='15s';select set_config('request.jwt.claim.sub','${a}',false);begin;select ${fn}('${id}','16989');select 'FILA_BLOQUEADA';select pg_sleep(4);commit;`,'haku_bove_test_a');
  for(let i=0;i<100&&!A.output().includes('FILA_BLOQUEADA');i++)await pause(20);
  assert.ok(A.output().includes('FILA_BLOQUEADA'),'A debe haber registrado y retenido el bloqueo');
  const B=iniciar(`set statement_timeout='15s';select set_config('request.jwt.claim.sub','${b}',false);select ${fn}('${id}','${mismo?'16989':'16988'}');`,'haku_bove_test_b');
  let bloqueo=false;
  for(let i=0;i<60&&!bloqueo;i++){
   bloqueo=await query("select exists(select 1 from pg_stat_activity where application_name='haku_bove_test_b' and wait_event_type='Lock');")==='t';
   if(!bloqueo)await pause(20);
  }
  assert.ok(bloqueo,'B debe esperar un bloqueo real de PostgreSQL');
  const [ra,rb]=await Promise.all([A.done,B.done]);assert.equal(ra.code,0,ra.err);
  if(mismo){assert.equal(rb.code,0,rb.err);assert.match(rb.out,/"ya_registrado": true/);}else{assert.notEqual(rb.code,0);assert.match(rb.err,/BOVE ya registrado con un número diferente/);}
  const estado=JSON.parse(await query(`select json_build_object('numero',${campo},'autor',${campo}_registrado_por,'auditorias',(select count(*) from auditoria_fixture)) from reservas where id='${id}';`));
  assert.deepEqual(estado,{numero:'16989',autor:a,auditorias:1});checks++;
 }
 console.log(`PASS: ${checks} escenarios concurrentes con dos conexiones. Sólo datos sintéticos locales.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
