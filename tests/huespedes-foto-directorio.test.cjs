const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(read('tests/fixtures/huespedes-schema.sql'));
  await db.exec(read('supabase/migrations/20261120205010_haku_huespedes_v1_1.sql'));
  await db.exec(read('supabase/migrations/20261121003000_haku_huespedes_directorio_foto.sql'));
  // Reuse accredited regressions against the additive API payload too.
  await db.exec(read('tests/huespedes-v1-postgres.test.sql'));
  await db.exec(read('tests/huespedes-v1-postgres.test.sql').split('set local role authenticated;')[0]+'commit;');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",['a0000000-0000-4000-8000-000000000001']);
  await db.exec('set role authenticated');
  const id='a1000000-0000-4000-8000-000000000001',res='a2000000-0000-4000-8000-000000000001';
  const photo='a0000000-0000-4000-8000-000000000001/a5000000-0000-4000-8000-000000000001.jpg';
  await db.query("select public.haiku_huesped_guardar_v1($1,$2,'registro',$3)",[id,res,JSON.stringify({categoria:'preferencia',texto:'Prefiere cacao',fuente:'Lo comentó'})]);
  await db.query("insert into storage.objects(bucket_id,name) values ('haiku-huespedes',$1)",[photo]);
  await db.query("select public.haiku_huesped_guardar_v1($1,$2,'foto',$3)",[id,res,JSON.stringify({clase:'persona',ruta:photo,esperada:null})]);
  const data=(await db.query("select public.haiku_huesped_directorio_v1('hospedados') data")).rows[0].data;
  const row=data.filas.find(r=>r.id===id);
  assert.equal(row.foto,photo);assert.equal(row.registros,1);assert.equal(row.documento,'••••78-5');assert.equal(row.numero_documento,undefined);
  const profile=(await db.query('select public.haiku_huesped_perfil_v1($1,$2) data',[id,res])).rows[0].data;
  assert.ok(profile.tipos_visitados.includes('Loft'));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",['a0000000-0000-4000-8000-000000000003']);
  await assert.rejects(db.query("select public.haiku_huesped_directorio_v1('todos')"),/No tienes permiso/);
  console.log('PASS: photo, record counts and visited types respect the existing permission boundary; V1.1 regressions passed.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
