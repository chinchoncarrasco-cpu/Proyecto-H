// PostgreSQL embebido desechable. Sólo fixtures sintéticos; no acepta conexiones externas.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const R=require('./libro-pagos-revision.cjs'),id=R.ids;
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const user='99999999-9999-4999-8999-999999999999';
async function crear(){
 const db=new PGlite();
 await db.exec(read('tests/fixtures/libro-distribucion-schema.sql'));
 await db.exec(`create table usuarios(id uuid primary key);
  alter table catalogo_servicios add column nombre text,add column categoria text,add column precio_base bigint;
  alter table servicios add column total bigint default 0,add column tipo_cobro text default 'normal',add column hora_inicio time;
  alter table cargos add column concepto text,add column estadia_noche_id uuid;
  alter table pagos add column pago_origen_id uuid references pagos;
  alter table reserva_estadias add column tipo_estadia text,add column adultos integer,add column ninos integer,add column mascotas integer;
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
 const capAnterior=(await db.query("select pg_get_functiondef('public.haiku_libro_aplicaciones_servicio_capacidad_v1()'::regprocedure) src")).rows[0].src;
 await db.exec(read('supabase/migrations/20261116191114_libro_aplicar_pago_existente.sql'));
 const queries={reserva_estadias:"select to_jsonb(e)||jsonb_build_object('cabanas',to_jsonb(c),'reservas',to_jsonb(r)) fila from reserva_estadias e join reservas r on r.id=e.reserva_id join cabanas c on c.id=e.cabana_id",
  servicios:"select to_jsonb(s)||jsonb_build_object('catalogo_servicios',to_jsonb(c)) fila from servicios s join catalogo_servicios c on c.id=s.catalogo_servicio_id"};
 for(const t of ['reservas','cabanas','catalogo_servicios','cargos','cargo_ajustes','pagos','pago_aplicaciones','vista_estado_cargos'])queries[t]=`select to_jsonb(x) fila from public.${t} x`;
 async function select(t){
  if(['bloqueos_cabana','estadia_noches','eventos_auditoria'].includes(t))return[];
  if(!queries[t])throw Error('Lectura no autorizada en fixture: '+t);
  return(await db.query(queries[t])).rows.map(x=>x.fila);
 }
 async function reset(){
  await db.exec('truncate pago_aplicaciones,pagos,cargo_ajustes,cargos,servicios,catalogo_servicios,reserva_estadias,cabanas,reservas,usuarios,private.haiku_libro_pagos_servicio_operaciones cascade');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec("select set_config('haku.test_permit','on',false)");
  const p=R.caso().db.pagos[0];
  await db.query('insert into usuarios values($1)',[user]);await db.query("insert into reservas(id,titular_nombre,estado_reserva) values($1,'Persona Ficticia','checked_out')",[id.reserva]);
  const cab='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',cat='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await db.query('insert into cabanas values($1,2)',[cab]);
  await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia,tipo_estadia,adultos,ninos,mascotas) values($1,$2,$3,'2026-11-13','2026-11-14','checked_out','alojamiento',2,0,0)",[id.estadia,id.reserva,cab]);
  await db.query("insert into catalogo_servicios(id,codigo,nombre,categoria,precio_base) values($1,'tinajaJacuzzi','Tinaja Jacuzzi','tinaja',30000)",[cat]);
  await db.query("insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,estado_servicio,total,tipo_cobro,hora_inicio) values($1,$2,$3,$4,'2026-11-13','programado',30000,'normal','22:15')",[id.servicio,id.reserva,id.estadia,cat]);
  await db.query("insert into cargos(id,reserva_id,estadia_id,servicio_id,tipo_cargo,estado,monto,concepto) values($1,$2,$3,null,'alojamiento','activo',144000,'Alojamiento CAB 2 actual'),($4,$2,$3,$5,'servicio','activo',30000,'Tinaja Jacuzzi')",[id.alojamiento,id.reserva,id.estadia,id.jacuzzi,id.servicio]);
  await db.query("insert into cargos(id,reserva_id,estadia_id,tipo_cargo,estado,monto,concepto) values($1,$2,$3,'alojamiento','anulado',160000,'Alojamiento anterior CAB 3'),($4,$2,$3,'alojamiento','anulado',160000,'Cargo de alojamiento sustituido')",[randomUUID(),id.reserva,id.estadia,randomUUID()]);
  await db.query("insert into cargo_ajustes(operacion_id,reserva_id,cargo_id,tipo_ajuste,signo,porcentaje,base_calculo,monto,concepto,observaciones,creado_por) values($1,$2,$3,'cargo_modificacion',1,10,144000,14400,'Cargo de modificación 10%','Modificación confirmada por operador ficticio',$4)",[randomUUID(),id.reserva,id.alojamiento,user]);
  await db.query("insert into pagos(id,reserva_id,monto,moneda,tipo_movimiento,etapa_operativa,medio_pago,estado,fecha_pago,codigo_autorizacion,datos_origen) values($1,$2,144000,'CLP','pago','abono','webpay_debito','confirmado','2026-10-16','770031',$3::jsonb)",[id.pago,id.reserva,JSON.stringify({...p.datos_origen,cabana:3})]);
 }
 async function snapshot(){
  const cargos=await select('vista_estado_cargos'),pagos=await select('pagos'),aplicaciones=await select('pago_aplicaciones'),ajustes=await select('cargo_ajustes');
  const c={window:{}};vm.runInNewContext(read('js/supabase-finanzas-resumen-v1.js'),c);
  return{cargos,pagos,aplicaciones,ajustes,resumen:structuredClone(c.window.HAIKU_FINANZAS_RESUMEN_V1.detalle(cargos,pagos))};
 }
 async function propuesta(cargoId=id.alojamiento){
  const s=await snapshot(),p=s.pagos.find(p=>p.id===id.pago),c=s.cargos.find(c=>c.cargo_id===cargoId);
  const refunds=s.pagos.filter(q=>q.pago_origen_id===p.id&&q.estado==='confirmado'&&q.tipo_movimiento==='devolucion');
  const devuelto=refunds.reduce((n,p)=>n+p.monto,0),refundIds=new Set(refunds.map(p=>p.id));
  const aplicado=s.aplicaciones.reduce((n,a)=>n+(a.pago_id===p.id?a.monto_aplicado:refundIds.has(a.pago_id)?-a.monto_aplicado:0),0);
  return{reserva_id:id.reserva,estadia_id:id.estadia,cabana:2,ingreso:'2026-11-13',salida:'2026-11-14',pago_id:p.id,cargo_id:c.cargo_id,
   pago_esperado:Object.fromEntries(['id','reserva_id','monto','moneda','estado','tipo_movimiento','medio_pago','folio','codigo_autorizacion','bove','datos_origen'].map(k=>[k,p[k]??null])),
   fecha_pago_esperada:p.fecha_pago,disponible_esperado:p.monto-devuelto-aplicado,aplicado_pago_esperado:aplicado,devuelto_esperado:devuelto,
   saldo_cargo_esperado:c.saldo_cargo,monto_ajustado_esperado:c.monto_ajustado,aplicado_cargo_esperado:c.aplicado_neto,
   aplicacion_previa_esperada:s.aplicaciones.filter(a=>a.pago_id===p.id&&a.cargo_id===c.cargo_id).reduce((n,a)=>n+a.monto_aplicado,0),
   candidatos_esperados:s.cargos.filter(c=>c.reserva_id===id.reserva&&c.estadia_id===id.estadia&&c.tipo_cargo==='alojamiento'&&c.estado==='activo'&&c.saldo_cargo>0).map(c=>c.cargo_id).sort(),
   monto_aplicar:Math.min(p.monto-devuelto-aplicado,c.saldo_cargo),confirmado:true,version_libro:'f'.repeat(64),origen_libro:{hoja:'Nov26',celda:'AZ31:BC31'}};
 }
 const call=async(p,op=randomUUID())=>(await db.query('select public.haiku_libro_aplicar_pago_existente_v1($1,$2::jsonb) r',[op,JSON.stringify(p)])).rows[0].r;
 return{db,select,reset,snapshot,propuesta,call,capAnterior};
}
module.exports={crear,read,user,id,R};
