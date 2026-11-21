// PostgreSQL efímero con datos ficticios; nunca conecta a Supabase.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261121151108_aseo_vinculos_estadia_traslado.sql'),'utf8');
const cab1='10000000-0000-4000-8000-000000000001',cab2='10000000-0000-4000-8000-000000000002';
const entrada='20000000-0000-4000-8000-000000000001',salida='20000000-0000-4000-8000-000000000002';
async function fixture(){const db=new PGlite();await db.exec(`
 create table reserva_estadias(id uuid primary key,cabana_id uuid not null);
 create table aseos(id integer primary key,fecha date,cabana_id uuid,estadia_ingreso_id uuid references reserva_estadias(id),
  estadia_salida_id uuid references reserva_estadias(id),iniciado_en timestamptz,completado_en timestamptz,
  encargado_nombre text,revisor_nombre text,estado text);
 insert into reserva_estadias values('${entrada}','${cab1}'),('${salida}','${cab1}');
 insert into aseos values(1,'2026-12-01','${cab1}','${entrada}','${salida}',null,null,'Persona A','Persona B','pendiente');
 ${migration}
 create trigger validar before insert or update on aseos for each row execute function haiku_validar_aseo_estadias();
 `);return db;}
test('una estadía trasladada no bloquea IN/OUT y conserva el trabajo en su cabaña física',async()=>{
 const db=await fixture();try{
  await db.query('update reserva_estadias set cabana_id=$1 where id=$2',[cab2,entrada]);
  await db.exec("update aseos set iniciado_en='2026-12-01T10:00:00-03:00',estado='en_proceso' where id=1");
  let a=(await db.query('select * from aseos')).rows[0];assert.equal(a.estadia_ingreso_id,null);assert.equal(a.estadia_salida_id,salida);
  assert.equal(a.cabana_id,cab1);assert.equal(a.encargado_nombre,'Persona A');assert.equal(a.revisor_nombre,'Persona B');
  const inicio=a.iniciado_en;
  await db.query('update reserva_estadias set cabana_id=$1 where id=$2',[cab2,salida]);
  await db.exec("update aseos set completado_en='2026-12-01T10:30:00-03:00',estado='completado' where id=1");
  a=(await db.query('select * from aseos')).rows[0];assert.equal(a.estadia_salida_id,null);assert.deepEqual(a.iniciado_en,inicio);
  assert.equal(new Date(a.completado_en).toISOString(),'2026-12-01T13:30:00.000Z');assert.equal(a.encargado_nombre,'Persona A');
 }finally{await db.close();}
});
test('un vínculo válido permanece intacto al editar horas',async()=>{const db=await fixture();try{
 await db.exec("update aseos set iniciado_en='2026-12-01T10:00:00-03:00' where id=1");
 const a=(await db.query('select * from aseos')).rows[0];assert.equal(a.estadia_ingreso_id,entrada);assert.equal(a.estadia_salida_id,salida);
 assert.equal((await db.query("select prosecdef from pg_proc where proname='haiku_validar_aseo_estadias'")).rows[0].prosecdef,false);
 }finally{await db.close();}});
test('una nueva referencia ajena, un INSERT inválido o cambiar la cabaña/fecha siguen rechazados',async()=>{const db=await fixture();try{
 const otro='20000000-0000-4000-8000-000000000003';await db.query('insert into reserva_estadias values($1,$2)',[otro,cab2]);
 await assert.rejects(()=>db.query('update aseos set estadia_ingreso_id=$1 where id=1',[otro]),/estadía de ingreso/);
 await assert.rejects(()=>db.query("insert into aseos(id,fecha,cabana_id,estadia_ingreso_id) values(2,'2026-12-01',$1,$2)",[cab1,otro]),/estadía de ingreso/);
 await assert.rejects(()=>db.query('update aseos set cabana_id=$1 where id=1',[cab2]),/estadía de salida/);
 await db.query('update reserva_estadias set cabana_id=$1 where id=$2',[cab2,entrada]);
 await assert.rejects(()=>db.exec("update aseos set fecha='2026-12-02' where id=1"),/estadía de ingreso/);
 const a=(await db.query('select * from aseos')).rows[0];assert.equal(a.estadia_ingreso_id,entrada);assert.equal(a.iniciado_en,null);
 }finally{await db.close();}});
