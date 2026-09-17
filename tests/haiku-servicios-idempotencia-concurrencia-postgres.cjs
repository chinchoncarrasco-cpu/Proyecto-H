// Ejecutar solo contra una base PostgreSQL local nueva y desechable.
// HAKU_SERVICIOS_ALLOW_DISPOSABLE_DB=YES
// HAKU_SERVICIOS_TEST_DATABASE_URL=postgres://.../haku_servicios_test_...
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {URL}=require('node:url');
const {randomUUID}=require('node:crypto');
const url=process.env.HAKU_SERVICIOS_TEST_DATABASE_URL||'';
if(process.env.HAKU_SERVICIOS_ALLOW_DISPOSABLE_DB!=='YES'||!url)throw Error('Falta autorizacion explicita para una base PostgreSQL local desechable.');
const parsed=new URL(url);
if(!['127.0.0.1','localhost','::1'].includes(parsed.hostname)||!/^haku_servicios_test_[a-z0-9_]+$/.test(parsed.pathname.slice(1)))throw Error('La prueba solo acepta localhost y una base haku_servicios_test_*.');
let Client;try{({Client}=require('pg'));}catch{throw Error('Falta el paquete pg; no instalar automaticamente.');}
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),wait=ms=>new Promise(r=>setTimeout(r,ms));
const setup=new Client({connectionString:url}),a=new Client({connectionString:url}),b=new Client({connectionString:url});

(async()=>{
 await setup.connect();await a.connect();await b.connect();
 const n=Number((await setup.query("select count(*) n from information_schema.tables where table_schema in ('public','private','auth')")).rows[0].n);
 assert.equal(n,0,'La base debe estar vacia; la prueba nunca limpia una base existente.');
 await setup.query(read('tests/fixtures/servicios-idempotencia-schema.sql'));
 await setup.query(read('supabase/migrations/20260916211226_haku_servicios_idempotencia_atomica.sql'));
 const reserva=randomUUID(),estadia=randomUUID(),usuario=randomUUID();
 await setup.query('insert into reservas(id) values($1)',[reserva]);
 await setup.query('insert into reserva_estadias(id,reserva_id) values($1,$2)',[estadia,reserva]);
 for(const c of [a,b])await c.query("select set_config('request.jwt.claim.sub',$1,false)",[usuario]);
 const args=[reserva,'lateCheckout','2026-09-06','14:00',1,1,'normal',null,null,'HAIKU-LEGACY-ID:concurrente',estadia];
 const sql=`select public.haiku_registrar_servicio(
  $1::uuid,$2::text,$3::date,$4::time,$5::integer,$6::smallint,$7::text,
  $8::bigint,$9::text,$10::text,$11::uuid
 ) resultado`;

 await a.query('begin');
 const ra=(await a.query(sql,args)).rows[0].resultado;
 let termino=false;const pb=b.query(sql,args).then(r=>{termino=true;return r.rows[0].resultado;});
 await wait(200);assert.equal(termino,false,'La segunda conexion debe esperar el lock de la reserva.');
 await a.query('commit');const rb=await pb;
 assert.equal(rb.servicio_id,ra.servicio_id);assert.equal(rb.reutilizado,true);
 assert.equal(Number((await setup.query('select count(*) n from servicios')).rows[0].n),1);
 assert.equal(Number((await setup.query('select count(*) n from cargos')).rows[0].n),1);

 const retry=(await b.query(sql,args)).rows[0].resultado;
 assert.equal(retry.servicio_id,ra.servicio_id);assert.equal(retry.reutilizado,true);
 console.log('PASS concurrencia PostgreSQL: dos conexiones, un Late Check-out, un cargo y retry idempotente.');
})().finally(async()=>{await Promise.allSettled([a.end(),b.end(),setup.end()]);}).catch(e=>{console.error(e);process.exitCode=1;});
