const test=require('node:test'),assert=require('node:assert/strict');
const {preparar,read}=require('./fixtures/rut-identidad-sql.cjs');
const S=require('../js/haiku-libro-semantica-v1.js');
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
  const existente={tipo:'reserva_nueva',item_id:'previa-a-candidata',reserva:{titular_nombre:'Persona Preexistente',titular_tipo_documento:'rut',titular_numero_documento:'1234567-4'},estadias:[{cabana_numero:1,datos:{fecha_ingreso:'2026-12-23',fecha_salida:'2026-12-24',tipo_estadia:'alojamiento',adultos:1,ninos:0,mascotas:0}}]};
  await h.lote([existente]);
  const antes=(await h.db.query('select to_jsonb(r) r from reservas r order by id')).rows;
  const firma=async()=> (await h.db.query("select proowner,proacl,prosecdef,proconfig from pg_proc where oid='haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure")).rows;
  const permisos=await firma();
  const vigente=(await h.db.query("select md5(replace(prosrc,chr(13),'')) h from pg_proc where oid='haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure")).rows[0].h;
  assert.equal(vigente,'1898d46805d4d65f582dada43909b745'); // Coincide con el SELECT al writer vigente.
  await h.db.exec(read(script)); assert.deepEqual(await firma(),permisos);
  assert.deepEqual((await h.db.query('select to_jsonb(r) r from reservas r order by id')).rows,antes);
  await h.lote([existente]); // Una reserva que ya apareció se omite antes de alcanzar el ancla.
  assert.deepEqual((await h.db.query('select to_jsonb(r) r from reservas r order by id')).rows,antes);
  assert.equal((await h.db.query("select titular_numero_documento d from reservas where titular_nombre='Persona Preexistente'")).rows[0].d,'12345674');
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
  const hoja={celdas:[{r:1,c:2,valor:'20 dic',fechaISO:'2026-12-20'},{r:1,c:6,valor:'21 dic',fechaISO:'2026-12-21'},
   {r:2,c:0,valor:'cabana 1'},{r:2,c:2,valor:'Persona Invalida // 1 ADL // RUT 123456781'},
   {r:24,c:2,valor:'Pagos de arriendos de hoy'}],combinaciones:[{s:{r:2,c:2},e:{r:2,c:4}}]};
  item.reserva.titular_numero_documento=S.normalizarHoja(hoja,'Dic26').reservas[0].rut_documento;
  assert.equal(item.reserva.titular_numero_documento,'12345678-1');
  await assert.rejects(h.lote([item]),e=>e.code==='HLI03');
  assert.deepEqual((await h.db.query('select to_jsonb(r) r from reservas r order by id')).rows,snapshot);
 } finally {await h.db.close();}
});
test('la candidata se detiene si el writer cambia aunque conserve el mismo punto de insercion',async()=>{
 const h=await preparar();
 try {
  const original=(await h.db.query("select pg_get_functiondef('haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure) d")).rows[0].d;
  const cambiado=original.replace('\ndeclare','\n-- Simula una revision posterior del writer.\ndeclare');
  assert.notEqual(cambiado,original);
  await h.db.exec(cambiado);
  const antes=(await h.db.query('select to_jsonb(r) r from reservas r order by id')).rows;
  await assert.rejects(h.db.exec(read(script)),/definición vigente del writer cambió/);
  await h.db.exec('rollback');
  assert.deepEqual((await h.db.query('select to_jsonb(r) r from reservas r order by id')).rows,antes);
  assert.equal((await h.db.query("select pg_get_functiondef('haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure) d")).rows[0].d,cambiado);
 } finally {await h.db.close();}
});
