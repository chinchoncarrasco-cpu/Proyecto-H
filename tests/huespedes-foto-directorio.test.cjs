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
  await db.exec(read('supabase/migrations/20261122233716_huespedes_fotos_vehiculo.sql'));
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
  const save=async(action,values)=>(await db.query('select public.haiku_huesped_guardar_v1($1,$2,$3,$4) data',
    [id,res,action,JSON.stringify(values)])).rows[0].data;
  const vehicle=(await save('vehiculo',{tipo:'Auto'})).id;
  const pet=(await save('mascota',{nombre:'Pipa',especie:'Perro'})).id;
  const asset=number=>photo.replace(/1\.jpg$/,number+'.jpg');
  for(const route of [asset(2),asset(3),asset(4)]) {
   await db.query("insert into storage.objects(bucket_id,name) values ('haiku-huespedes',$1)",[route]);
  }
  await save('foto',{clase:'vehiculo',id:vehicle,ruta:asset(2),esperada:null});
  await save('foto',{clase:'mascota',id:pet,ruta:asset(4),esperada:null});
  const original={principal:asset(2),posicion_y:50,adicionales:[]};
  const gallery={principal:asset(2),posicion_y:72,adicionales:[asset(3)]};
  const saved=await save('vehiculo',{id:vehicle,tipo:'SUV',fotos:{...gallery,esperadas:original}});
  assert.deepEqual(saved,{id:vehicle,fotos_guardadas:true,fotos_retiradas:[]});
  const profileWithGallery=async()=>(await db.query('select public.haiku_huesped_perfil_v1($1,$2) data',[id,res])).rows[0].data;
  async function checkGallery(type,position,extra) {
   const result=await profileWithGallery();
   const current=result.vehiculos.find(v=>v.id===vehicle);
   assert.equal(current.tipo,type);
   assert.equal(current.foto,asset(2));
   assert.equal(current.foto_posicion_y,position);
   assert.deepEqual(current.fotos_adicionales,extra);
   assert.equal(result.mascotas.find(m=>m.id===pet).foto,asset(4));
  }
  await checkGallery('SUV',72,[asset(3)]);
  const subject=uuid=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[uuid]);
  const canRead=async route=>(await db.query("select name from storage.objects where bucket_id='haiku-huespedes' and name=$1",[route])).rows.length;
  await subject('a0000000-0000-4000-8000-000000000002');
  assert.equal(await canRead(asset(3)),1);
  await assert.rejects(save('vehiculo',{id:vehicle,tipo:'Otro'}),{code:'42501'});
  await subject('a0000000-0000-4000-8000-000000000003');
  assert.equal(await canRead(asset(3)),0);
  await subject('a0000000-0000-4000-8000-000000000001');
  await assert.rejects(save('vehiculo',{id:vehicle,tipo:'Otro',fotos:{...gallery,esperadas:original}}),{code:'40001'});
  await assert.rejects(save('vehiculo',{id:vehicle,tipo:'Otro',fotos:{...gallery,esperadas:gallery,adicionales:[asset(5)]}}),{code:'P0002'});
  await assert.rejects(save('vehiculo',{id:vehicle,tipo:'Otro',fotos:{...gallery,esperadas:gallery,adicionales:[asset(2)]}}),{code:'22023'});
  await checkGallery('SUV',72,[asset(3)]);
  const blockedDelete=await db.query("delete from storage.objects where bucket_id='haiku-huespedes' and name=$1 returning name",[asset(3)]);
  assert.equal(blockedDelete.rows.length,0);
  await save('vehiculo',{id:vehicle,tipo:'Station wagon'});
  await checkGallery('Station wagon',72,[asset(3)]);
  const removed=await save('vehiculo',{id:vehicle,tipo:'Station wagon',fotos:{...gallery,esperadas:gallery,adicionales:[]}});
  assert.deepEqual(removed.fotos_retiradas,[asset(3)]);
  await checkGallery('Station wagon',72,[]);
  const allowedDelete=await db.query("delete from storage.objects where bucket_id='haiku-huespedes' and name=$1 returning name",[asset(3)]);
  assert.equal(allowedDelete.rows.length,1);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",['a0000000-0000-4000-8000-000000000003']);
  await assert.rejects(db.query("select public.haiku_huesped_directorio_v1('todos')"),/No tienes permiso/);
  console.log('PASS: photo, record counts and visited types respect the existing permission boundary; V1.1 regressions passed.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
