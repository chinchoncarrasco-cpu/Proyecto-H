// Writers reales y datos sintéticos; sin conexión a Supabase.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const {caso}=require('./fixtures/libro-pago-revision-admin.cjs');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const candidata='supabase/candidates/libro-pago-revision-admin/01-writer.sql';
async function entorno(tipo,{instalar=true}={}) {
 const db=new PGlite(),h=caso(tipo);
 try {
  await db.exec(read('tests/fixtures/servicios-idempotencia-schema.sql'));
  const schema=read('tests/fixtures/libro-distribucion-schema.sql');
  await db.exec(schema.slice(schema.indexOf('create table public.pagos'),schema.indexOf('create view public.vista_estado_cargos')));
  await db.exec(schema.slice(schema.indexOf('create table private.haiku_libro_incorporaciones')));
  await db.exec(`alter table reservas add column titular_nombre text,add column titular_numero_documento text,add column estado_reserva text;
   create table cabanas(id uuid primary key,numero integer);
   alter table reserva_estadias add column cabana_id uuid,add column fecha_ingreso date,add column fecha_salida date;
   alter table pago_aplicaciones add column id uuid default gen_random_uuid(),add primary key(pago_id,cargo_id);
   create table roles(id uuid primary key,codigo text,activo boolean);
   create table usuario_roles(usuario_id uuid,rol_id uuid);
   create or replace function private.haiku_tiene_permiso(text) returns boolean language sql as $$select current_setting('haku.test_permit',true) is distinct from 'off'$$;
   create view vista_estado_cargos as select c.id cargo_id,c.reserva_id,c.estadia_id,c.servicio_id,c.tipo_cargo,c.concepto,c.monto,
    c.monto monto_ajustado,c.estado,
    coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a join pagos p on p.id=a.pago_id where a.cargo_id=c.id and p.estado='confirmado'),0) aplicado_neto,
    c.monto-coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a join pagos p on p.id=a.pago_id where a.cargo_id=c.id and p.estado='confirmado'),0) saldo_cargo
    from cargos c;`);
  const servicios=read('supabase/migrations/20260916041430_haku_libro_aplicaciones_servicio_seguras.sql');
  await db.exec(servicios.match(/create or replace function private\.haiku_libro_concepto_servicio_canon_v1[\s\S]*?\$function\$;/)[0]);
  await db.exec(servicios.slice(servicios.indexOf('create table if not exists private.haiku_libro_pagos_servicio_operaciones'),servicios.indexOf('create or replace function public.haiku_incorporar_pago_servicios_libro_v1')));
  await db.exec(read('supabase/migrations/20261007181953_libro_medio_pago_manual_auditoria.sql').match(/create function private\.haiku_libro_medio_pago_manual_validar_v1[\s\S]*?\$function\$;/)[0]);
  await db.exec(read('supabase/candidates/libro-transferencias/01-writer.sql').match(/create function private\.haiku_libro_operacion_bancaria_v2[\s\S]*?\$fn\$;/)[0]);
  await db.exec(read('tests/fixtures/libro-pago-revision-admin-baseline.sql'));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[h.usuario]);
  const e=h.tablas.reserva_estadias[0],cab=randomUUID(),rol=randomUUID();
  await db.query("insert into roles values($1,'administrador',true);",[rol]);
  await db.query('insert into usuario_roles values($1,$2)',[h.usuario,rol]);
  await db.query('insert into reservas values($1,$2,$3,$4)',[e.reserva_id,e.reservas.titular_nombre,e.reservas.titular_numero_documento,e.reservas.estado_reserva]);
  await db.query('insert into cabanas values($1,$2)',[cab,e.cabanas.numero]);
  await db.query('insert into reserva_estadias values($1,$2,$3,$4,$5,$6)',[e.id,e.reserva_id,e.estado_estadia,cab,e.fecha_ingreso,e.fecha_salida]);
  for(const s of h.tablas.servicios) {
   const cat=randomUUID();
   await db.query('insert into catalogo_servicios(id,codigo,nombre,categoria) values($1,$2,$3,$4)',[cat,s.catalogo_servicios.codigo,s.catalogo_servicios.nombre,s.catalogo_servicios.categoria]);
   await db.query(`insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,cantidad,personas,precio_unitario_aplicado,total,tipo_cobro,estado_servicio)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[s.id,s.reserva_id,s.estadia_id,cat,s.fecha_servicio,s.cantidad,s.personas,s.precio_unitario_aplicado,s.total,s.tipo_cobro,s.estado_servicio]);
   // El trigger realista crea un cargo; fija el UUID del snapshot sintético del frontend.
   const c=h.tablas.vista_estado_cargos.find(c=>c.servicio_id===s.id);
   await db.query('update cargos set id=$1 where servicio_id=$2',[c.cargo_id,s.id]);
  }
  if(tipo==='cabana_transferencia')await db.query("insert into cargos(reserva_id,estadia_id,tipo_cargo,concepto,monto) values($1,$2,'alojamiento','Alojamiento',150000)",[e.reserva_id,e.id]);
  if(instalar)await db.exec(read(candidata));
  const plan=await h.preparar(),listo=await h.confirmar(plan);
  const item=h.Q.serializarIncorporacion(listo).find(i=>i.tipo.startsWith('pago'));
  if(tipo==='cabana_transferencia')item.confirmacion_final=true;
  const guardar=(i=item,op=randomUUID())=>db.query(tipo==='efectivo_servicio' ?
    'select haiku_incorporar_pago_servicios_libro_v1($1,$2::jsonb) r':'select haiku_incorporar_libro_v1($1,$2::jsonb) r',
    [op,JSON.stringify(tipo==='efectivo_servicio'?i:[i])]);
  return {db,h,item,guardar};
 }catch(e){await db.close();throw e;}
}
for(const tipo of ['efectivo_servicio','cabana_transferencia']) {
 test('SQL '+tipo+': evidencia intacta, auditoría, aplicación exacta, reintento y relectura sin duplicar',async()=>{
  const {db,h,item,guardar}=await entorno(tipo);
  try {
   const op=randomUUID();await guardar(item,op);await guardar(item,op);
   const rows=(await db.query('select * from pagos')).rows;assert.equal(rows.length,1);
   const p=rows[0];assert.equal(p.monto,h.p.monto);assert.equal(p.referencia_externa,h.p.texto_original);
   assert.equal(p.datos_origen.revision_pago_admin_v1.usuario,h.usuario);assert.ok(p.datos_origen.revision_pago_admin_v1.validado_en);
   assert.equal(p.datos_origen.revision_pago_admin_v1.tipo,tipo);
   assert.equal(p.datos_origen.evidencia_libro.texto_original,h.p.texto_original);
   assert.equal(Number((await db.query('select sum(monto_aplicado) n from pago_aplicaciones')).rows[0].n),h.p.monto);
   if(tipo==='cabana_transferencia')assert.equal(p.pagador_nombre,h.p.pagador.nombre);
   // PostgREST entrega fechas JSON, no instancias Date de PGlite.
   h.tablas.pagos=JSON.parse(JSON.stringify(rows));h.tablas.pago_aplicaciones=(await db.query('select * from pago_aplicaciones')).rows;
   h.tablas.vista_estado_cargos=(await db.query('select * from vista_estado_cargos')).rows;
   const reread=await h.preparar();assert.equal(h.Q.serializarIncorporacion(reread).filter(i=>i.tipo.startsWith('pago')).length,0);
   assert.equal(h.Q.contextoVisualPlanes.get(reread).pagosDetalle[0].estado,'en_sistema');
   await assert.rejects(guardar(item));assert.equal((await db.query('select count(*)::int n from pagos')).rows[0].n,1);
   if(tipo==='cabana_transferencia') {
    h.p.texto_original+=' // BOVE: 123';h.p.origen.celda='C99:F99';
    const movido=await h.preparar();
    assert.equal(h.Q.contextoVisualPlanes.get(movido).pagosDetalle[0].estado,'en_sistema');
    h.p.monto++;
    const alterado=await h.preparar();
    assert.notEqual(h.Q.contextoVisualPlanes.get(alterado).pagosDetalle[0].estado,'en_sistema');
   }

  }finally{await db.close();}
 });
 test('SQL '+tipo+': rol, evidencia alterada, confirmación ausente y destino cambiado son rechazados',async()=>{
  const {db,item,guardar}=await entorno(tipo);
  try {
   for(const modificar of [i=>i.aprobado_manualmente=false,i=>i.datos_origen.revision_pago_admin_v1.confirmado=false,
    i=>i.datos_origen.revision_pago_admin_v1.motivo='',i=>i.datos_origen.revision_pago_admin_v1.usuario=randomUUID(),
    i=>i.datos_origen.revision_pago_admin_v1.cabana_confirmada=99,i=>i.datos_origen.evidencia_libro.monto++,
    i=>i.datos_origen.evidencia_libro.texto_original+=' alterado',i=>i.argumentos.p_monto++,i=>i.item_id='otra fila']) {
    const i=structuredClone(item);modificar(i);await assert.rejects(guardar(i));
   }
   await db.exec('delete from usuario_roles');await assert.rejects(guardar(item),/administrador/);
   assert.equal((await db.query('select count(*)::int n from pagos')).rows[0].n,0);
  }finally{await db.close();}
 });
}
test('SQL candidata preserva registros/ACL y se detiene ante una definición desconocida',async()=>{
 const {db}=await entorno('efectivo_servicio',{instalar:false});
 try {
  const antes=await db.query('select * from cargos order by id');
  const acl=await db.query("select oid,proacl,prosecdef,proconfig from pg_proc where proname like 'haiku_%' order by oid");
  await db.exec(read(candidata));assert.deepEqual(await db.query('select * from cargos order by id'),antes);
  const ahora=await db.query("select oid,proacl,prosecdef,proconfig from pg_proc where oid=any($1::oid[]) order by oid",[acl.rows.map(r=>r.oid)]);
  assert.deepEqual(ahora.rows,acl.rows);
  assert.equal((await db.query('select haiku_libro_transferencias_capacidad_v2() r')).rows[0].r.confirmacion_final,true);
  assert.equal((await db.query('select haiku_libro_aplicaciones_servicio_capacidad_v1() r')).rows[0].r.revision_pago_admin_v1,true);
  await assert.rejects(db.exec(read(candidata)),/Writer distinto/);await db.exec('rollback');
  assert.equal((await db.query("select has_function_privilege('authenticated','private.haiku_libro_revision_pago_admin_validar_v1(uuid,jsonb,jsonb,boolean)','execute') p")).rows[0].p,false);
 }finally{await db.close();}
});
