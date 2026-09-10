// PostgreSQL efímero en memoria: nunca conecta a Proyecto H ni acepta URL remota.
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const id='00000000-0000-4000-8000-000000000001',usuario='00000000-0000-4000-8000-000000000002';
(async()=>{
 const db=new PGlite();let checks=0;
 try{
 await db.exec(read('tests/fixtures/bove-schema.sql'));
 await db.exec(read('tests/fixtures/bove-rpc-originales.sql'));
 for(const fn of ['haiku_registrar_bove_reserva','haiku_registrar_bove_checkout'])await db.exec(`revoke all on function public.${fn}(uuid,text) from public; grant execute on function public.${fn}(uuid,text) to authenticated;`);
 const metadata=async()=>(await db.query("select proname,prosecdef,proconfig,proacl::text,proowner from pg_proc where proname in ('haiku_registrar_bove_reserva','haiku_registrar_bove_checkout') order by proname")).rows;
 const antes=await metadata();await db.exec(read('supabase/migrations/20260910180000_bove_registro_atomico.sql'));assert.deepEqual(await metadata(),antes);checks++;
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[usuario]);
 await db.query('insert into reservas(id) values($1)',[id]);
 await db.query('insert into saldos_fixture values($1,0,100)',[id]);
 await db.query("insert into cargos_fixture values($1,30,0,'servicio','activo')",[id]);
 const snapshot=async()=>(await db.query('select * from reservas where id=$1',[id])).rows[0];
 const count=async()=>(await db.query('select count(*)::int n from auditoria_fixture')).rows[0].n;
 for(const [fn,campo,key] of [['haiku_registrar_bove_reserva','bove_cierre','bove'],['haiku_registrar_bove_checkout','bove_checkout','bove_checkout']]){
  const call=async n=>(await db.query(`select public.${fn}($1,$2) r`,[id,n])).rows[0].r;
  for(const vacio of [null,'','   ']){
   await db.query(`update reservas set ${campo}=$2 where id=$1`,[id,vacio]);
   const resultado=await call('16989');assert.equal(resultado[key],'16989');assert.equal((await snapshot())[campo],'16989');checks++;
   const previo=await snapshot(),auditoria=await count();
   const idem=await call('16989');assert.equal(idem.ya_registrado,true);assert.deepEqual(await snapshot(),previo);assert.equal(await count(),auditoria);assert.equal(idem.registrado_por,usuario);checks++;
   await assert.rejects(call('16988'),/BOVE ya registrado con un número diferente/);assert.deepEqual(await snapshot(),previo);assert.equal(await count(),auditoria);checks++;
  }
  await db.query("select set_config('haku.test_permit','off',false)");await assert.rejects(call('16989'),/permiso/);checks++;
  await db.query("select set_config('haku.test_permit','on',false)");
  await db.query("select set_config('request.jwt.claim.sub','',false)");await assert.rejects(call('16989'),/iniciar sesión/);checks++;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[usuario]);
  await assert.rejects(call('  '),/Ingresa el BOVE/);checks++;
  if(campo==='bove_cierre')await db.exec('update saldos_fixture set saldo_alojamiento=1');else await db.exec('update cargos_fixture set saldo_cargo=1');
  const previo=await snapshot();await assert.rejects(call('16989'),/pagado/);assert.deepEqual(await snapshot(),previo);checks++;
  await db.exec('update saldos_fixture set saldo_alojamiento=0; update cargos_fixture set saldo_cargo=0');
 }
 await db.exec('update cargos_fixture set monto=0');await assert.rejects(db.query('select haiku_registrar_bove_checkout($1,$2)',[id,'16989']),/no tiene cargos/);checks++;
 const falta='00000000-0000-4000-8000-000000000099';await assert.rejects(db.query('select haiku_registrar_bove_reserva($1,$2)',[falta,'16989']),/No se encontró/);checks++;
 // Validación financiera satisfecha pero reserva inexistente: el lock detecta ausencia.
 await db.query("insert into cargos_fixture values($1,30,0,'servicio','activo')",[falta]);await assert.rejects(db.query('select haiku_registrar_bove_checkout($1,$2)',[falta,'16989']),/No fue posible actualizar/);checks++;
 console.log(`PASS SQL: ${checks} comprobaciones en PostgreSQL efímero. Concurrencia real requiere bove-rpc-concurrencia.cjs (dos conexiones).`);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
