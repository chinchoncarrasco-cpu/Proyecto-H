// PostgreSQL efímero, writer vigente reconstruido y sólo identidades sintéticas.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const F=require('./fixtures/libro-transferencias-bancarias.cjs');
global.HAIKU_LIBRO_SEMANTICA=F.S;
const Q=require('../js/haiku-libro-consultas-v1.js');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const candidata='supabase/candidates/libro-glosa-sin-nombre/01-writer.sql',numero='0123456701';
async function entorno(instalar=true) {
 const db=new PGlite(),id=randomUUID(),estadia=randomUUID(),cab=randomUUID(),usuario=randomUUID();
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
  await db.exec(read('supabase/candidates/libro-pago-revision-admin/01-writer.sql'));
  await db.exec(`revoke all on function private.haiku_libro_transferencia_validar_v2(uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
   revoke all on function public.haiku_incorporar_libro_v1(uuid,jsonb),public.haiku_libro_transferencias_capacidad_v2() from public,anon;
   grant execute on function public.haiku_incorporar_libro_v1(uuid,jsonb),public.haiku_libro_transferencias_capacidad_v2() to authenticated;`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[usuario]);
  await db.query("insert into reservas values($1,'Titular Sintetico','11111111-1','confirmada')",[id]);
  await db.query('insert into cabanas values($1,1)',[cab]);
  await db.query("insert into reserva_estadias values($1,$2,'confirmada',$3,'2026-10-30','2026-10-31')",[estadia,id,cab]);
  await db.query("insert into cargos(reserva_id,estadia_id,tipo_cargo,concepto,monto) values($1,$2,'alojamiento','Alojamiento',300000)",[id,estadia]);
  if(instalar)await db.exec(read(candidata));
  const front=async(glosa=numero+' Transf.',guardados=[])=>{
   const libro=F.leer([{titular:'Titular Sintetico',rut:'11111111-1',cabana:1,pagos:[{glosa,concepto:'cab1/1noche // Transferencia'}]}]);
   const cliente=F.cliente(libro.reservas,guardados),e=cliente.estadias[0];e.id=estadia;e.reserva_id=id;
   cliente.rpc=async n=>n==='haiku_libro_transferencias_capacidad_v2'?
    {data:(await db.query('select haiku_libro_transferencias_capacidad_v2() r')).rows[0].r}:{data:null};
   const comparacion=await Q.compararSistema(libro.reservas,cliente,{desde:'2026-10-01',hasta:'2026-10-31'});
   const result={reservas:libro.reservas,q:{},comparacion};
   const plan=await Q.prepararIncorporacion(result,new Map(),new Set(),cliente);
   return {plan,comparacion,item:Q.serializarIncorporacion(plan).find(i=>i.tipo==='pago')};
  };
  const guardar=(items,op=randomUUID())=>db.query('select haiku_incorporar_libro_v1($1,$2::jsonb) r',[op,JSON.stringify(Array.isArray(items)?items:[items])]);
  return {db,id,front,guardar};
 }catch(e){await db.close();throw e;}
}
const pagos=async h=>(await h.db.query('select * from pagos order by id')).rows;
const metadatos=async h=>(await h.db.query("select oid,proowner,proacl,prosecdef,proconfig from pg_proc where proname like 'haiku_%' order by oid")).rows;

test('SQL: sólo tres definiciones cambian; conserva datos, permisos y capacidades previas',async()=>{
 const h=await entorno(false);
 try {
  const antes=await metadatos(h),cargos=await h.db.query('select * from cargos'),rs=await h.db.query('select * from reservas');
  const huellas=await h.db.query("select oid,md5(prosrc) hash from pg_proc where proname like 'haiku_%' order by oid");
  await h.db.exec(read(candidata));assert.deepEqual(await metadatos(h),antes);
  assert.deepEqual(await h.db.query('select * from cargos'),cargos);assert.deepEqual(await h.db.query('select * from reservas'),rs);assert.equal((await pagos(h)).length,0);
  const ahora=await h.db.query("select oid,md5(prosrc) hash from pg_proc where proname like 'haiku_%' order by oid");
  assert.equal(ahora.rows.filter((r,i)=>r.hash!==huellas.rows[i].hash).length,3);
  assert.deepEqual((await h.db.query('select haiku_libro_transferencias_capacidad_v2() r')).rows[0].r,{version:2,confirmacion_final:true,glosa_sin_nombre:true});
  await h.db.exec('set role authenticated');
  assert.deepEqual((await h.db.query('select haiku_libro_transferencias_capacidad_v2() r')).rows[0].r,{version:2,confirmacion_final:true,glosa_sin_nombre:true});
  await h.db.exec('reset role');
  assert.equal((await h.db.query('select haiku_libro_aplicaciones_servicio_capacidad_v1() r')).rows[0].r.revision_pago_admin_v1,true);
 }finally{await h.db.close();}
});
for(const glosa of [numero+' Transf.','Transf. '+numero,numero])test('SQL: registra sólo tras confirmar, conserva número y no copia el titular: '+glosa,async()=>{
 const h=await entorno();
 try {
  const {item}=await h.front(glosa);assert.ok(item);assert.equal(item.confirmacion_final,undefined);
  await assert.rejects(h.guardar(item));assert.equal((await pagos(h)).length,0);
  item.confirmacion_final=true;const op=randomUUID();await h.guardar(item,op);await h.guardar(item,op);
  const rows=await pagos(h);assert.equal(rows.length,1);assert.equal(rows[0].pagador_nombre,null);
  assert.equal(rows[0].datos_origen.pagador.numero_remitente,numero);assert.ok(!rows[0].datos_origen.pagador.nombre);
  assert.equal(rows[0].datos_origen.evidencia_transferencia.glosa_original,glosa);
  assert.equal(rows[0].datos_origen.aprobado_manualmente,false);assert.equal(rows[0].datos_origen.confirmacion_final,true);
  assert.equal((await h.db.query('select titular_nombre from reservas')).rows[0].titular_nombre,'Titular Sintetico');
  const relectura=await h.front(glosa,JSON.parse(JSON.stringify(rows)));
  assert.equal(relectura.comparacion.pagosDetalle[0].estado,'en_sistema');assert.equal(relectura.item,undefined);
  await assert.rejects(h.guardar(item),/duplicada/);assert.equal((await pagos(h)).length,1);
 }finally{await h.db.close();}
});
test('SQL: operaciones diferentes separan pagos iguales; sin operación revierte el lote completo',async()=>{
 const h=await entorno();
 try {
  const {item}=await h.front();item.confirmacion_final=true;const otro=structuredClone(item);otro.item_id+='otra';
  await assert.rejects(h.guardar([item,otro]),/duplicada/);assert.equal((await pagos(h)).length,0);
  const a=(await h.front(numero+' Transf. // Operacion 901')).item,b=(await h.front(numero+' Transf. // Operacion 902')).item;
  a.confirmacion_final=b.confirmacion_final=true;await h.guardar([a,b]);assert.equal((await pagos(h)).length,2);
 }finally{await h.db.close();}
});
test('SQL: conserva el pagador explícito y rechaza evidencia alterada, otro medio y otra CAB',async()=>{
 const h=await entorno();
 try {
  const {item}=await h.front();item.confirmacion_final=true;
  for(const cambiar of [i=>i.datos_origen.pagador.nombre='Titular Sintetico',i=>i.datos_origen.evidencia_transferencia.numero_remitente='0765432109',
   i=>i.argumentos.p_referencia_externa='referencia ajena',i=>i.argumentos.p_medio_pago='webpay_credito',i=>i.datos_origen.cabana=2,
   i=>{i.datos_origen.evidencia_transferencia.glosa_original+=' Nombre Omitido';i.argumentos.p_referencia_externa+=' Nombre Omitido';}]){
   const x=structuredClone(item);cambiar(x);await assert.rejects(h.guardar(x));
  }
  assert.equal((await pagos(h)).length,0);
  const x=(await h.front(numero+' Transf. Pagador Distinto')).item;x.confirmacion_final=true;await h.guardar(x);
  assert.equal((await pagos(h))[0].pagador_nombre,'Pagador Distinto');
 }finally{await h.db.close();}
});
test('SQL: capacidad no se anuncia si cambia el validador; sin permiso no registra',async()=>{
 const h=await entorno();
 try {
  const {item}=await h.front();item.confirmacion_final=true;
  await h.db.exec("select set_config('haku.test_permit','off',false)");await assert.rejects(h.guardar(item));
  await h.db.exec("select set_config('haku.test_permit','on',false)");
  const def=(await h.db.query("select pg_get_functiondef('private.haiku_libro_transferencia_validar_v2(uuid,jsonb,jsonb,boolean)'::regprocedure) d")).rows[0].d;
  await h.db.exec(def.replace('\nbegin','\n-- cambio posterior\nbegin'));
  assert.equal((await h.db.query('select haiku_libro_transferencias_capacidad_v2() r')).rows[0].r.glosa_sin_nombre,false);
  assert.equal((await h.front()).item,undefined);assert.equal((await pagos(h)).length,0);
 }finally{await h.db.close();}
});
test('SQL: baseline desconocido aborta sin reemplazar definiciones ni tocar datos',async()=>{
 const h=await entorno(false);
 try {
  const def=(await h.db.query("select pg_get_functiondef('public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure) d")).rows[0].d;
  await h.db.exec(def.replace('\nbegin','\n-- cambio ajeno\nbegin'));
  const antes=await h.db.query("select oid,prosrc from pg_proc where proname like 'haiku_%' order by oid");
  await assert.rejects(h.db.exec(read(candidata)),/baseline/);await h.db.exec('rollback');
  assert.deepEqual(await h.db.query("select oid,prosrc from pg_proc where proname like 'haiku_%' order by oid"),antes);
  assert.equal((await pagos(h)).length,0);
 }finally{await h.db.close();}
});
