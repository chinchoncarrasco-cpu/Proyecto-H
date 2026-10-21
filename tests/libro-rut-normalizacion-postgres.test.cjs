const test=require('node:test'),assert=require('node:assert/strict');
const {preparar,read}=require('./fixtures/rut-identidad-sql.cjs');
const script='supabase/candidates/libro-rut-formato/01-incorporacion.sql';
test('sin candidata de formato, el writer conserva la clave interna incluso si recibe un RUT canonico',async()=>{
 const h=await preparar();
 try {
  const item={tipo:'reserva_nueva',item_id:'alta-sin-formato',reserva:{titular_nombre:'Persona Sin Candidata',titular_tipo_documento:'rut',titular_numero_documento:'12345670-k'},estadias:[{cabana_numero:1,datos:{fecha_ingreso:'2026-12-20',fecha_salida:'2026-12-21',tipo_estadia:'alojamiento',adultos:1,ninos:0,mascotas:0}}]};
  await h.lote([item]);
  const r=(await h.db.query('select titular_numero_documento d from reservas where titular_nombre=$1',[item.reserva.titular_nombre])).rows;
  assert.deepEqual(r,[{d:'12345670K'}]);
 } finally {await h.db.close();}
});
test('Libro persiste RUT canónico, conserva validación, documentos extranjeros e históricos',async()=>{
 const h=await preparar();
 try {
  const antes=(await h.db.query('select to_jsonb(r) r from reservas r order by id')).rows;
  const firma=async()=> (await h.db.query("select proowner,proacl,prosecdef,proconfig from pg_proc where oid='haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure")).rows;
  const permisos=await firma();
  await h.db.exec(read(script)); assert.deepEqual(await firma(),permisos);
  assert.deepEqual((await h.db.query('select to_jsonb(r) r from reservas r order by id')).rows,antes);
  let n=0;
  for(const [doc,tipo,esperado] of [
   ['12.345.670-K','rut','12345670-k'],['12345670-K','rut','12345670-k'],['12345670-k','rut','12345670-k'],['12345670K','rut','12345670-k'],
   ['12.345.678-5','rut','12345678-5'],['123456785','rut','12345678-5'],
   ['AB-0123456','pasaporte','AB-0123456'],['12345670K','pasaporte','12345670K'],[null,null,null]
  ]) {
   const day=String(++n+1).padStart(2,'0');
   const item={tipo:'reserva_nueva',item_id:'alta-'+n,reserva:{titular_nombre:tipo==='rut'?'Persona Rut '+esperado:'Extranjera '+n,titular_tipo_documento:tipo,titular_numero_documento:doc},estadias:[{cabana_numero:1,datos:{fecha_ingreso:'2026-12-'+day,fecha_salida:'2026-12-'+String(n+2).padStart(2,'0'),tipo_estadia:'alojamiento',adultos:1,ninos:0,mascotas:0}}]};
   await h.lote([item]);
   const r=(await h.db.query('select titular_numero_documento d from reservas where titular_nombre=$1',[item.reserva.titular_nombre])).rows;
   assert.ok(r.length);assert.ok(r.every(x=>x.d===esperado));
  }
  const snapshot=(await h.db.query('select to_jsonb(r) r from reservas r order by id')).rows;
  const item={tipo:'reserva_nueva',item_id:'invalida',reserva:{titular_nombre:'Rut Invalido',titular_tipo_documento:'rut',titular_numero_documento:'12345670-1'},estadias:[{cabana_numero:1,datos:{fecha_ingreso:'2026-12-20',fecha_salida:'2026-12-21',tipo_estadia:'alojamiento',adultos:1}}]};
  await assert.rejects(h.lote([item]),e=>e.code==='HLI03');
  assert.deepEqual((await h.db.query('select to_jsonb(r) r from reservas r order by id')).rows,snapshot);
 } finally {await h.db.close();}
});
