const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {preparar,instalarCandidata,read}=require('./fixtures/rut-identidad-sql.cjs');
const {incidente}=require('./fixtures/rut-incidente-ficticio.cjs');
const repair=require('../tools/rut-identidad-reparacion.cjs');
const full=async h=>(await repair.manifest(h.db,{})).snapshot;
const using=(opts,fn)=>async()=>{const h=await preparar(opts);try{await fn(h)}finally{await h.db.close()}};
const create=(h,rut,name='Persona Sintética')=>h.db.query(`select haiku_crear_reserva($1,1::smallint,'2026-12-10'::date,'2026-12-12'::date,p_rut=>$2) r`,[name,rut]);

test('RUT: formato, módulo 11, K, ausencia e inválidos; pasaporte no se interpreta como RUT',using({},async h=>{
  for(const input of ['12.345.670-K','12345670k','12345670-K',' 12345670K '])
    assert.equal((await h.db.query('select private.haiku_rut_clave_v1($1) k',[input])).rows[0].k,'12345670K');
  for(const input of ['123.456-0','1234560'])assert.equal((await h.db.query('select private.haiku_rut_clave_v1($1) k',[input])).rows[0].k,'1234560');
  for(const input of [null,'','12345670-1','ABC12345670K','12..345.670-K','00000000-0','123 45670K'])
    assert.equal((await h.db.query('select private.haiku_rut_clave_v1($1) k',[input])).rows[0].k,null);
  await h.db.query(`insert into huespedes(nombre,tipo_documento,numero_documento) values('Extranjera Ficticia','pasaporte','12.345.670-K'),('Otra Extranjera Ficticia','pasaporte','12345670K')`);
  assert.equal((await h.db.query(`select count(*)::int n from huespedes where tipo_documento='pasaporte'`)).rows[0].n,4);
}));
test('alta reutiliza RUT almacenado visible sin sobrescribir contacto ni crear otro huésped',using({},async h=>{
  await h.db.query(`insert into huespedes(nombre,tipo_documento,numero_documento,correo) values('Persona Sintética','rut','12.345.670-K','sintetica@example.invalid')`);
  const before=(await h.db.query('select to_jsonb(h) r from huespedes h order by id')).rows;
  const a=(await create(h,'12345670k')).rows[0].r,b=(await create(h,'12.345.670-K')).rows[0].r;
  assert.notEqual(a.reserva_id,b.reserva_id);
  assert.deepEqual((await h.db.query('select to_jsonb(h) r from huespedes h order by id')).rows,before);
  assert.equal((await h.db.query(`select count(distinct titular_huesped_id)::int n from reservas where id=any($1::uuid[])`,[[a.reserva_id,b.reserva_id]])).rows[0].n,1);
}));
test('documento ocupado por otra persona: HLI02 y ausencia de escrituras en alta',using({},async h=>{
  await create(h,'12345670K');const before=await full(h);
  await assert.rejects(create(h,'12.345.670-K','Nombre Diferente Ficticio'),e=>e.code==='HLI02'&&!e.message.includes('12345670'));
  assert.deepEqual(await full(h),before);
}));
test('documentos ausentes no fusionan por nombre; inválidos abortan de forma tipada',using({},async h=>{
  await create(h,null);await create(h,'');
  assert.equal((await h.db.query(`select count(distinct titular_huesped_id)::int n from reservas where titular_nombre='Persona Sintética'`)).rows[0].n,2);
  const before=await full(h);
  for(const input of ['12345670-1','ABC12345670K','12..345.670-K'])await assert.rejects(create(h,input),e=>e.code==='HLI03'&&!e.message.includes(input));
  assert.deepEqual(await full(h),before);
}));
test('huésped sin documento no absorbe el documento ocupado por otro registro',using({},async h=>{
  await create(h,'12345670K');await h.db.query('update huespedes set tipo_documento=null,numero_documento=null where id=$1',[h.ids.guest]);
  const before=await full(h);
  await assert.rejects(h.db.query(`update huespedes set tipo_documento='rut',numero_documento='12.345.670-K' where id=$1`,[h.ids.guest]),e=>e.code==='HLI01');
  assert.deepEqual(await full(h),before);
}));
test('DML directo no puede duplicar un RUT con otro formato',using({},async h=>{
  await create(h,'12345670K');const before=await full(h);
  await assert.rejects(h.db.query(`insert into huespedes(nombre,tipo_documento,numero_documento) values('Otra Ficticia','rut','12.345.670-k')`),e=>e.code==='HLI01');
  assert.deepEqual(await full(h),before);
}));
test('editores invoker y core revierten reserva, huéspedes y finanzas ante conflicto',using({},async h=>{
  await create(h,'12345670K');const before=await full(h);
  for(const fn of ['haiku_actualizar_reserva','haiku_modificar_reserva_completa_core']){
    await assert.rejects(h.db.query(`select ${fn}($1,'Persona Ficticia A',1::smallint,'2026-10-13'::date,'2026-10-15'::date,p_rut=>'12.345.670-K')`,[h.ids.reserva]),e=>e.code==='HLI01');
    assert.deepEqual(await full(h),before);
  }
}));
test('el Libro conserva pasaporte numérico explícito y rechaza RUT inválido con rollback del lote',using({},async h=>{
  const item={tipo:'reserva_nueva',item_id:'ficticia',reserva:{titular_nombre:'Pasaporte Ficticio',titular_tipo_documento:'pasaporte',titular_numero_documento:'12345670K'},
    estadias:[{cabana_numero:1,datos:{fecha_ingreso:'2026-12-20',fecha_salida:'2026-12-22',tipo_estadia:'alojamiento',adultos:1,ninos:0,mascotas:0}}]};
  await h.lote([item]);assert.equal((await h.db.query(`select titular_tipo_documento t from reservas where titular_nombre='Pasaporte Ficticio'`)).rows[0].t,'pasaporte');
  const before=await full(h);item.item_id='invalida';item.reserva={titular_nombre:'Inválida Ficticia',titular_tipo_documento:'rut',titular_numero_documento:'12345670-1'};
  await assert.rejects(h.lote([item]),e=>e.code==='HLI03');assert.deepEqual(await full(h),before);
}));
test('conflictos históricos se inventarían bloqueados; no se instala índice normalizado',using({historicos:true},async h=>{
  assert.equal((await h.db.query('select count(*)::int n from private.haiku_rut_registro_v1 where bloqueado')).rows[0].n,1);
  const before=await full(h);await assert.rejects(create(h,'12345670K'),e=>e.code==='HLI01');assert.deepEqual(await full(h),before);
  assert.equal((await h.db.query(`select to_regclass('public.huespedes_rut_normalizado_uidx') x`)).rows[0].x,null);
}));
test('reparación aprobada preserva cancelación, reserva nueva, pago original, notas e historial; retry idempotente',using({historicos:true},async h=>{
  const {p,m,approval,pid,eid}=await incidente(h),receipt=await repair.apply(h.db,m,approval);
  const after=await full(h);
  assert.deepEqual(after.rows['public.huespedes'],m.snapshot.rows['public.huespedes']);
  for(const t of ['public.pagos','public.pago_aplicaciones','public.cargos','public.reserva_estadias'])assert.deepEqual(after.rows[t],m.snapshot.rows[t]);
  assert.equal(after.rows['public.pagos'].find(x=>x.id===pid).reserva_id,p.original.id);
  assert.equal(after.rows['public.reservas'].find(x=>x.id===p.original.id).estado_reserva,'cancelada');
  assert.equal(after.rows['public.reservas'].find(x=>x.id===p.subsequent.id).titular_huesped_id,p.canonicalId);
  assert.equal(after.rows['public.estadia_huespedes'].find(x=>x.estadia_id===eid).huesped_id,p.canonicalId);
  const retry=await repair.apply(h.db,m,approval,receipt);assert.equal(retry.retry,true);assert.deepEqual(await full(h),after);
}));
test('después de reparación el Libro permite formato equivalente y revalida antes de pagos',using({historicos:true},async h=>{
  const {p,m,approval,eid}=await incidente(h);await repair.apply(h.db,m,approval);
  const before=await full(h);
  const item={tipo:'reserva_actualizar',item_id:'ficticia-revisada',reserva_id:p.subsequent.id,estadia_id:eid,
    reserva:{antes:{titular_numero_documento:'12345670k'},despues:{titular_numero_documento:'12.345.670-K'}},estadia:{antes:{},despues:{}},cambios:[]};
  const op=randomUUID();await h.lote([item],op);const after=await full(h);
  assert.equal(after.rows['public.reservas'].length,2);assert.equal(after.rows['public.reserva_estadias'].length,2);
  for(const t of ['public.pagos','public.pago_aplicaciones','public.cargos','public.huespedes'])assert.deepEqual(after.rows[t],before.rows[t]);
  assert.equal(after.rows['public.reservas'].find(x=>x.id===p.original.id).estado_reserva,'cancelada');
  const retry=await h.lote([item],op);assert.equal(retry.reintento,true);assert.deepEqual(await full(h),after);
}));
test('falta aprobación o manifiesto vigente: ninguna escritura parcial',using({historicos:true},async h=>{
  const {m,approval}=await incidente(h),before=await full(h);
  await assert.rejects(repair.apply(h.db,m,{...approval,samePerson:false}),e=>e.code==='HLR01');assert.deepEqual(await full(h),before);
  await h.db.query(`update reservas set observaciones='Nueva evidencia ficticia' where id=$1`,[h.ids.reserva]);const changed=await full(h);
  await assert.rejects(repair.apply(h.db,m,approval),e=>e.code==='HLR01');assert.deepEqual(await full(h),changed);
}));
test('error tardío en reparación revierte todas las reasociaciones y auditoría',using({historicos:true},async h=>{
  await h.db.exec(`create function impedir_alias_fixture() returns trigger language plpgsql as $$begin raise exception 'Fallo ficticio';end$$;
    create trigger impedir before insert on private.haiku_huesped_alias_v1 for each row execute function impedir_alias_fixture()`);
  const {m,approval}=await incidente(h),before=await full(h);await assert.rejects(repair.apply(h.db,m,approval),e=>e.code==='HLR01');assert.deepEqual(await full(h),before);
}));
test('identidad retirada no admite asociaciones ni ediciones; segundo grupo queda íntegro',using({instalar:false,historicos:true},async h=>{
  await h.db.query(`insert into huespedes(nombre,tipo_documento,numero_documento) values('Independiente Uno Ficticio','rut','12.345.671-8'),('Independiente Dos Ficticio','rut','123456718')`);
  await instalarCandidata(h.db);const {p,m,approval}=await incidente(h);await repair.apply(h.db,m,approval);const before=await full(h);
  await assert.rejects(h.db.query(`update huespedes set nombre='No autorizado' where id=$1`,[p.redundantId]),e=>e.code==='HLI02');
  await assert.rejects(h.db.query(`update reservas set titular_huesped_id=$1 where id=$2`,[p.redundantId,p.subsequent.id]),e=>e.code==='HLI02');
  await assert.rejects(create(h,'123456718','Independiente Uno Ficticio'),e=>e.code==='HLI01');assert.deepEqual(await full(h),before);
}));
test('reversión restaura asociaciones sin borrar huéspedes, pagos o historial',using({historicos:true},async h=>{
  const {m,approval}=await incidente(h),receipt=await repair.apply(h.db,m,approval);
  assert.equal((await repair.revert(h.db,m,{...approval,action:'revert'},receipt)).reverted,true);
  const after=await full(h);
  for(const t of ['public.reservas','public.huespedes','public.reserva_huespedes','public.estadia_huespedes','public.reserva_estadias','public.pagos','public.pago_aplicaciones','public.cargos','public.notas','public.solicitudes'])
    assert.deepEqual(after.rows[t],m.snapshot.rows[t]);
  assert.ok(after.rows['private.haiku_huesped_alias_v1'][0].revertido_en);
  assert.equal(after.rows['private.haiku_rut_registro_v1'].find(r=>r.clave==='12345670K').bloqueado,true);
}));
test('reversión ante actividad posterior aborta sin pisar cambios nuevos',using({historicos:true},async h=>{
  const {p,m,approval}=await incidente(h),receipt=await repair.apply(h.db,m,approval);
  await h.db.query(`update reservas set observaciones='Actividad posterior ficticia' where id=$1`,[p.subsequent.id]);const before=await full(h);
  await assert.rejects(repair.revert(h.db,m,{...approval,action:'revert'},receipt),e=>e.code==='HLR01');assert.deepEqual(await full(h),before);
}));
test('candidata preserva owner, ACL, invoker, RLS y pago_actualizar; drift de cuerpo aborta',using({instalar:false},async h=>{
  const security=await h.seguridad();const src=(await h.db.query(`select prosrc from pg_proc where oid='private.haiku_libro_actualizar_v1(jsonb)'::regprocedure`)).rows[0].prosrc;
  await instalarCandidata(h.db);
  const after=await h.seguridad();for(const s of security)assert.deepEqual(after.find(x=>x.oid===s.oid),s);
  const body=(await h.db.query(`select prosrc from pg_proc where oid='private.haiku_libro_actualizar_v1(jsonb)'::regprocedure`)).rows[0].prosrc;
  const financial=s=>s.slice(s.indexOf("  elsif p_item->>'tipo'='pago_actualizar' then"));assert.equal(financial(body),financial(src));
  const before=await full(h);await assert.rejects(h.db.exec(read('supabase/candidates/rut-identidad/02-writers.sql')),/no coincide/);await h.db.exec('rollback');assert.deepEqual(await full(h),before);
}));

for(const drift of ['cuerpo','permisos'])test(`instalación completa revierte DDL y registro ante drift de ${drift}`,using({instalar:false},async h=>{
  if(drift==='permisos')await h.db.exec('alter function haiku_actualizar_reserva(uuid,text,smallint,date,date,smallint,smallint,smallint,text,text,text,text,jsonb,jsonb) security definer');
  else {
    const def=(await h.db.query(`select pg_get_functiondef('haiku_actualizar_reserva(uuid,text,smallint,date,date,smallint,smallint,smallint,text,text,text,text,jsonb,jsonb)'::regprocedure) s`)).rows[0].s;
    await h.db.exec(def.replace('v_idx integer := 0;','v_idx integer := 0; -- drift ficticio'));
  }
  const before=await full(h);await assert.rejects(instalarCandidata(h.db),e=>e.code==='HLR02');assert.deepEqual(await full(h),before);
  assert.equal((await h.db.query(`select to_regclass('private.haiku_rut_registro_v1') r`)).rows[0].r,null);
}));
test('índice opcional aborta ante históricos y alias preservados',using({historicos:true},async h=>{
  for(const repaired of [false,true]){
    if(repaired){const {m,approval}=await incidente(h);await repair.apply(h.db,m,approval);}
    const before=await full(h);await assert.rejects(h.db.exec(read('supabase/candidates/rut-identidad/03-indice-diferido.sql')),/Índice aplazado/);
    await h.db.exec('rollback');assert.deepEqual(await full(h),before);
  }
}));
test('dependencia nueva de huésped exige revisión y no omite referencias desconocidas',using({historicos:true},async h=>{
  await h.db.exec('create table dependencia_nueva_fixture(id uuid primary key,huesped_id uuid references huespedes)');
  await assert.rejects(repair.manifest(h.db,{}),e=>e.code==='HLR01');
}));
test('edición de huésped compartido por ambos titulares exige HLI02 sin efectos parciales',using({},async h=>{
  await create(h,'12345670K');await create(h,'12.345.670-K');const before=await full(h);
  await assert.rejects(h.db.query(`update huespedes set nombre='Identidad Diferente Ficticia' where tipo_documento='rut'`),e=>e.code==='HLI02');
  assert.deepEqual(await full(h),before);
}));
test('documento extranjero ocupado se rechaza con HLI01 sin DETAIL personal',using({},async h=>{
  const before=await full(h);
  await assert.rejects(h.db.query(`insert into huespedes(nombre,tipo_documento,numero_documento) values('Extranjera Ficticia','pasaporte','FICTICIO-A')`),e=>
    e.code==='HLI01'&&!String(e.message+e.detail).includes('FICTICIO-A'));
  assert.deepEqual(await full(h),before);
}));
test('tras reparar, ambos editores conservan el documento visible canónico sin chocar con el índice del alias',using({historicos:true},async h=>{
  const {p,m,approval}=await incidente(h);await repair.apply(h.db,m,approval);
  const before=await full(h);
  for(const fn of ['haiku_actualizar_reserva','haiku_modificar_reserva_completa_core']){
    await h.db.query(`select ${fn}($1,'Persona Sintética',1::smallint,'2026-10-30'::date,'2026-11-01'::date,p_rut=>'12345670K')`,[p.subsequent.id]);
    const after=await full(h);
    assert.deepEqual(after.rows['public.huespedes'],before.rows['public.huespedes']);
    for(const t of ['public.pagos','public.pago_aplicaciones','public.cargos','public.reserva_estadias','public.estadia_noches'])assert.deepEqual(after.rows[t],before.rows[t]);
    assert.equal(after.rows['public.reservas'].find(r=>r.id===p.original.id).estado_reserva,'cancelada');
  }
}));
test('respuesta perdida después de COMMIT no se anuncia como rollback; consulta y retry no duplican',using({historicos:true},async h=>{
  const {m,approval}=await incidente(h);
  const lost={query:async(...args)=>{const r=await h.db.query(...args);if(args[0]==='commit')throw Error('Respuesta perdida ficticia');return r;}};
  let receipt;
  await assert.rejects(repair.apply(lost,m,approval),e=>{assert.equal(e.code,'HLR03');assert.doesNotMatch(e.message,/abortada/);receipt=e.receipt;return true;});
  const before=await full(h);assert.equal((await repair.apply(h.db,m,approval,receipt)).retry,true);assert.deepEqual(await full(h),before);
  await assert.rejects(repair.revert(lost,m,{...approval,action:'revert'},receipt),e=>e.code==='HLR03');
  assert.ok((await full(h)).rows['private.haiku_huesped_alias_v1'][0].revertido_en);
}));
