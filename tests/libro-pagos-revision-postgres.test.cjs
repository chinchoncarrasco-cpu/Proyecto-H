// PostgreSQL embebido y desechable. No admite URL ni conexiones de producción.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('escrituras financieras del Libro en PostgreSQL local',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(read('tests/fixtures/libro-distribucion-schema.sql'));
 await db.exec(`create table usuarios(id uuid primary key);
  alter table catalogo_servicios add column nombre text,add column categoria text,add column precio_base bigint;
  alter table servicios add column total bigint default 0,add column tipo_cobro text default 'normal',add column hora_inicio time;
  alter table cargos add column concepto text,add column estadia_noche_id uuid;
  alter table pago_aplicaciones add column id uuid default gen_random_uuid(),add primary key(pago_id,cargo_id);`);
 const ajustes=read('supabase/migrations/20260902035146_ajustes_cargo_financieros.sql');
 await db.exec(ajustes.slice(0,ajustes.indexOf('create index')));
 await db.exec('drop view vista_estado_cargos');
 await db.exec(ajustes.slice(ajustes.indexOf('create or replace view public.vista_estado_cargos'),ajustes.indexOf('create or replace view public.vista_saldos_reserva')));
 await db.exec(read('tests/fixtures/registrar-pago-supabase.sql'));
 await db.exec(read('tests/fixtures/libro-transferencia-validador-sql-v2.sql'));
 await db.exec(read('supabase/migrations/20260908164059_haku_libro_estado_confirmado.sql'));
 await db.exec(read('supabase/migrations/20260916041430_haku_libro_aplicaciones_servicio_seguras.sql'));
 const validacion=read('supabase/migrations/20261007181953_libro_medio_pago_manual_auditoria.sql');
 await db.exec(validacion.slice(validacion.indexOf('create function'),validacion.indexOf('do $migration$')));
 await db.exec(read('supabase/migrations/20261016165354_libro_transferencia_late_manual_v1.sql'));
 await db.exec(read('supabase/migrations/20261116151953_libro_revision_pagos_excedente.sql'));
 const id={u:randomUUID(),r:randomUUID(),e:randomUUID(),cab:randomUUID(),cat:randomUUID(),s:randomUUID(),c:randomUUID(),a:randomUUID()};
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id.u]);
 await db.query('insert into usuarios values($1)',[id.u]);
 await db.query("insert into reservas values($1,'Persona Ficticia','checked_out')",[id.r]);
 await db.query('insert into cabanas values($1,2)',[id.cab]);
 await db.query("insert into reserva_estadias values($1,$2,$3,'2026-11-13','2026-11-14','checked_out')",[id.e,id.r,id.cab]);
 await db.query("insert into catalogo_servicios(id,codigo,nombre,precio_base) values($1,'tinajaJacuzzi','Tinaja Jacuzzi',30000)",[id.cat]);
 await db.query("insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,estado_servicio,total,tipo_cobro) values($1,$2,$3,$4,'2026-11-13','programado',30000,'normal')",[id.s,id.r,id.e,id.cat]);
 await db.query("insert into cargos(id,reserva_id,estadia_id,servicio_id,tipo_cargo,estado,monto,concepto) values($1,$2,$3,$4,'servicio','activo',30000,'Tinaja Jacuzzi'),($5,$2,$3,null,'alojamiento','activo',158400,'Alojamiento')",[id.c,id.r,id.e,id.s,id.a]);
 const item={item_id:'recibo-ficticio',reserva_id:id.r,aprobado_manualmente:true,
  argumentos:{p_monto:32500,p_medio_pago:'tarjeta_debito',p_fecha_pago:'2026-11-14',p_folio:'810034',p_bove:'910034',p_modo_aplicacion:'ninguno'},
  datos_origen:{reserva_id:id.r,cabana:2,fecha_bloque:'2026-11-13',origen:{hoja:'Nov26',celda:'AZ34:BC34'},bovtar:'910034',
   excedente_servicio_libro_v1:{version:1,confirmado:true,monto_sin_aplicar:2500},
   aplicaciones_servicio_v1:{version:1,reserva_id:id.r,monto_total:32500,monto_sin_aplicar:2500,moneda:'CLP',aplicaciones:[{
    cargo_id:id.c,servicio_id:id.s,monto:30000,saldo_esperado:30000,aplicado_esperado:0,cantidad_aplicaciones_esperada:0,
    concepto_canon:'tinaja',fecha_contexto:'2026-11-13',fecha_servicio_esperada:'2026-11-13'}]}}};
 const call=async(i=item,op=randomUUID())=>(await db.query('select public.haiku_incorporar_pago_servicios_libro_v1($1,$2::jsonb) r',[op,JSON.stringify(i)])).rows[0].r;
 const count=async tabla=>(await db.query(`select count(*)::int n from ${tabla}`)).rows[0].n;
 const rollback=async fn=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}};
 const rechaza=async(fn,patron)=>{await db.exec('savepoint esperado');try{await assert.rejects(fn,patron);}finally{await db.exec('rollback to savepoint esperado; release savepoint esperado');}};
 const propuesta={reserva_id:id.r,cargo_id:id.c,servicio_id:id.s,estadia_id:id.e,cabana:2,fecha_servicio:'2026-11-13',hora_inicio:null,ingreso:'2026-11-13',salida:'2026-11-14',
  precio_final:32500,monto_ajustado:30000,saldo_esperado:30000,confirmado:true,motivo:'Precio final acordado con operador ficticio',
  autorizacion:'Autorización ficticia de administración en acta 777',comprobante:'810034:910034',version_libro:'f'.repeat(64),origen:{hoja:'Nov26',celda:'AZ34:BC34'}};
 const precio=async(p=propuesta,op=randomUUID())=>(await db.query('select public.haiku_libro_ajustar_precio_cargo_v1($1,$2::jsonb) r',[op,JSON.stringify(p)])).rows[0].r;
 await t.test('recibo íntegro, aplicación parcial, excedente y dos formas de reintento',()=>rollback(async()=>{
  const op=randomUUID(),r=await call(item,op);assert.equal(r.monto,32500);assert.equal(r.aplicado,30000);assert.equal(r.sin_aplicar,2500);
  assert.equal((await call(item,op)).reintento,true);assert.equal((await call()).omitidos,1);
  assert.equal(await count('pagos'),1);assert.equal(await count('pago_aplicaciones'),1);assert.equal(await count('cargo_ajustes'),0);
 }));
 await t.test('sin aprobación de excedente no registra ni aplica',()=>rollback(async()=>{
  const p=structuredClone(item);delete p.datos_origen.excedente_servicio_libro_v1;
  await rechaza(()=>call(p),/suma de aplicaciones/);assert.equal(await count('pagos'),0);
 }));
 await t.test('aplicaciones previas cambian saldo y revierten todo',()=>rollback(async()=>{
  await db.query("insert into pagos(reserva_id,monto,estado,tipo_movimiento) values($1,1000,'confirmado','pago') returning id",[id.r]).then(async r=>db.query('insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,1000)',[r.rows[0].id,id.c]));
  await rechaza(()=>call(),/saldo o las aplicaciones/);assert.equal(await count('pagos'),1);
 }));
 await t.test('identificador ya registrado con otro monto queda para revisión',()=>rollback(async()=>{
  await db.query("insert into pagos(reserva_id,monto,estado,tipo_movimiento,medio_pago,folio,bove) values($1,30000,'confirmado','pago','tarjeta_debito','810034','910034')",[id.r]);
  await rechaza(()=>call(),/datos diferentes/);assert.equal(await count('pagos'),1);
 }));
 await t.test('excedente no se aplica a cargo de otra estadía de la misma reserva',()=>rollback(async()=>{
  const otra=randomUUID();await db.query("insert into reserva_estadias values($1,$2,$3,'2026-11-20','2026-11-21','confirmada')",[otra,id.r,id.cab]);
  await db.query('update cargos set estadia_id=$1 where id=$2',[otra,id.c]);await db.query('update servicios set estadia_id=$1 where id=$2',[otra,id.s]);
  await rechaza(()=>call(),/Excedente.*destino único/);assert.equal(await count('pagos'),0);
 }));
 await t.test('precio autorizado ajusta sólo el cargo y conserva catálogo, servicio y recibo',()=>rollback(async()=>{
  const op=randomUUID(),r=await precio(propuesta,op);assert.equal(r.ajuste,2500);assert.equal((await precio(propuesta,op)).reintento,true);
  await rechaza(()=>precio(),/cambiaron/);assert.equal(await count('cargo_ajustes'),1);
  assert.equal(Number((await db.query('select precio_base from catalogo_servicios')).rows[0].precio_base),30000);
  assert.equal(Number((await db.query('select total from servicios')).rows[0].total),30000);
  const p=structuredClone(item);delete p.datos_origen.excedente_servicio_libro_v1;delete p.datos_origen.aplicaciones_servicio_v1.monto_sin_aplicar;
  Object.assign(p.datos_origen.aplicaciones_servicio_v1.aplicaciones[0],{monto:32500,saldo_esperado:32500});
  const pago=await call(p);assert.equal(pago.monto,32500);assert.equal(pago.aplicado,32500);assert.equal(pago.sin_aplicar,0);
 }));
 await t.test('precio sin evidencia independiente o con cargo pagado permanece bloqueado',()=>rollback(async()=>{
  await rechaza(()=>precio({...propuesta,confirmado:false}),/confirmar/);
  await rechaza(()=>precio({...propuesta,autorizacion:propuesta.comprobante}),/independiente/);
  await call();await rechaza(()=>precio(),/cambiaron/);
 }));
 await t.test('cambio de fecha o cabaña impide ajustar el precio con una vista previa antigua',()=>rollback(async()=>{
  await db.query("update servicios set fecha_servicio='2026-11-14' where id=$1",[id.s]);
  await rechaza(()=>precio(),/cambiaron/);await db.query("update servicios set fecha_servicio='2026-11-13' where id=$1",[id.s]);
  await db.query('update cabanas set numero=3 where id=$1',[id.cab]);await rechaza(()=>precio(),/cambiaron/);
  assert.equal(await count('cargo_ajustes'),0);
 }));
 await t.test('tarjeta penalidad usa sólo alojamiento verificado, sin tocar ajuste ni tinaja',()=>rollback(async()=>{
  const p=structuredClone(item);p.item_id='penalidad-ficticia';p.argumentos={...p.argumentos,p_monto:16000,p_medio_pago:'tarjeta_credito',p_folio:'810033',p_bove:'910033'};
  delete p.datos_origen.aplicaciones_servicio_v1;delete p.datos_origen.excedente_servicio_libro_v1;
  p.datos_origen={...p.datos_origen,tipo_movimiento:'penalidad',bovtar:'910033',item_id:p.item_id,source_kind:'libro_reserva',source_fingerprint:'prueba',moneda:'CLP',monto:16000,fecha:'2026-11-14',
   destino_alojamiento_libro_v1:{version:1,cargo_id:id.a,estadia_id:id.e,saldo_esperado:158400,monto_ajustado:158400,aplicado_esperado:0}};
  const mezclado=structuredClone(p);mezclado.datos_origen.excedente_servicio_libro_v1={version:1};
  await rechaza(()=>call(mezclado),/Comprobante.*incompleto/);
  const op=randomUUID(),r=await call(p,op);assert.equal(r.aplicado,16000);assert.equal((await call(p,op)).reintento,true);assert.equal((await call(p)).omitidos,1);
  assert.equal((await db.query('select cargo_id from pago_aplicaciones')).rows[0].cargo_id,id.a);assert.equal(await count('cargo_ajustes'),0);
  const q=structuredClone(p);q.argumentos.p_folio='810099';q.datos_origen.bovtar='910099';q.argumentos.p_bove='910099';
  await rechaza(()=>call(q),/cambiaron/);assert.equal(await count('pagos'),1);
 }));
 await t.test('diferencia de tarifa reutiliza validación bancaria y exige el saldo del alojamiento',()=>rollback(async()=>{
  const p=structuredClone(item);p.item_id='tarifa-ficticia';p.argumentos={p_monto:14400,p_medio_pago:'transferencia',p_fecha_pago:'2026-10-22',
   p_referencia_externa:'1234567890 Transf. Persona Ficticia // GO',p_folio:null,p_bove:null,p_codigo_autorizacion:null};
  p.datos_origen={reserva_id:id.r,cabana:2,fecha_bloque:'2026-11-13',origen:{hoja:'Nov26',celda:'AZ32:BC32'},item_id:p.item_id,
   source_kind:'libro_reserva',source_fingerprint:'tarifa-ficticia',moneda:'CLP',monto:14400,fecha:'2026-10-22',medio:'transferencia',tipo_movimiento:'alojamiento',
   pagador:{nombre:'Persona Ficticia',numero_remitente:'1234567890'},evidencia_transferencia:{version:2,operacion_bancaria:null,
    glosa_original:'1234567890 Transf. Persona Ficticia',numero_remitente:'1234567890',fecha_recepcion:'2026-10-22'},
   destino_alojamiento_libro_v1:{version:1,cargo_id:id.a,estadia_id:id.e,saldo_esperado:158400,monto_ajustado:158400,aplicado_esperado:0}};
  const op=randomUUID(),r=await call(p,op);assert.equal(r.monto,14400);assert.equal(r.aplicado,14400);
  assert.equal((await call(p,op)).reintento,true);await rechaza(()=>call(p),/posiblemente duplicada/);assert.equal(await count('pagos'),1);
  const origen=(await db.query('select datos_origen from pagos')).rows[0].datos_origen;assert.equal(origen.evidencia_transferencia.operacion_bancaria??null,null);
  assert.equal(origen.pagador.numero_remitente,'1234567890');assert.equal((await db.query('select cargo_id from pago_aplicaciones')).rows[0].cargo_id,id.a);
 }));
 await t.test('permisos revocados bloquean pago y ajuste',()=>rollback(async()=>{
  await db.exec("select set_config('haku.test_permit','off',true)");
  await rechaza(()=>call(),/Sin permiso/);await rechaza(()=>precio(),/Sin permiso/);
 }));
 if(process.env.HAKU_LIBRO_ESCRITORES_SQL)await t.test('extensión compatible con cuerpos vigentes leídos de producción, sin sustituir guardas',()=>rollback(async()=>{
  await db.exec(fs.readFileSync(process.env.HAKU_LIBRO_ADMIN_SQL,'utf8'));
  await db.exec(fs.readFileSync(process.env.HAKU_LIBRO_ESCRITORES_SQL,'utf8'));
  await db.exec(read('supabase/migrations/20261116151953_libro_revision_pagos_excedente.sql'));
  const cap=(await db.query('select public.haiku_libro_aplicaciones_servicio_capacidad_v1() c')).rows[0].c;
  assert.equal(cap.revision_pago_admin_v1,true);assert.equal(cap.excedente_servicio_libro_v1,true);assert.equal(cap.destino_alojamiento_libro_v1,true);
  const r=await call();assert.equal(r.monto,32500);assert.equal(r.aplicado,30000);assert.equal(r.sin_aplicar,2500);
 }));
 assert.equal(await count('pagos'),0);assert.equal(await count('cargo_ajustes'),0);
});
