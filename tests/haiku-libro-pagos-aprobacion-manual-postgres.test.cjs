const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const ALIMENTOS='supabase/migrations/20261006174307_libro_pagos_conceptos_alimentos.sql';
const GUARDIA='supabase/migrations/20261006174344_libro_servicio_faltante_guardia_manual.sql';

test('la extensión financiera conserva todas las guardias del writer existente',()=>{
 const rpc=s=>s.replace(/\r\n/g,'\n').match(/create or replace function private\.haiku_libro_pago_servicios_v1\([\s\S]*?\$function\$;/)[0];
 const anterior=rpc(read('supabase/migrations/20260916191841_haku_libro_aplicaciones_servicio_conjunto_unico.sql'));
 const actual=rpc(read(ALIMENTOS)).replace(",'queque','pan','huevos'",'');
 assert.equal(actual,anterior);
 const servicio=s=>s.replace(/\r\n/g,'\n').match(/create or replace function public\.haiku_registrar_servicio\([\s\S]*?\$function\$;/)[0];
 const sinGuardia=servicio(read(GUARDIA)).replace(/\n  -- Only the new manual Libro origin[\s\S]*?\n  end if;\n\n(?=  if v_servicio_id is not null then\n    select s.id)/,'\n');
 assert.equal(sinGuardia,servicio(read('supabase/migrations/20260916211226_haku_servicios_idempotencia_atomica.sql')));
});

test('Gaston end-to-end: plan real, catálogo realista y ambos RPC SQL desde cero servicios hasta un pago 13000',async()=>{
 const db=new PGlite(),usuario=randomUUID(),reserva=randomUUID(),estadia=randomUUID(),cabana=randomUUID();
 try {
  await db.exec(read('tests/fixtures/servicios-idempotencia-schema.sql'));
  const schema=read('tests/fixtures/libro-distribucion-schema.sql');
  await db.exec(schema.slice(schema.indexOf('create table public.pagos'),schema.indexOf('create view public.vista_estado_cargos')));
  await db.exec(schema.slice(schema.indexOf('create table private.haiku_libro_incorporaciones')));
  await db.exec(`alter table reservas add column titular_nombre text,add column titular_numero_documento text,add column estado_reserva text;
   create table cabanas(id uuid primary key,numero integer);
   alter table reserva_estadias add column cabana_id uuid,add column fecha_ingreso date,add column fecha_salida date,
    add column tipo_estadia text,add column adultos smallint,add column ninos smallint,add column mascotas smallint;
   alter table pago_aplicaciones add column id uuid default gen_random_uuid(),add primary key(pago_id,cargo_id);
   create view vista_estado_cargos as select c.id cargo_id,c.reserva_id,c.estadia_id,c.servicio_id,c.tipo_cargo,c.concepto,c.monto,
    c.monto monto_ajustado,c.estado,
    coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a join pagos p on p.id=a.pago_id where a.cargo_id=c.id and p.estado='confirmado'),0) aplicado_neto,
    c.monto-coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a join pagos p on p.id=a.pago_id where a.cargo_id=c.id and p.estado='confirmado'),0) saldo_cargo
    from cargos c;`);
  for(const archivo of ['supabase/migrations/20260916211226_haku_servicios_idempotencia_atomica.sql',
   'tests/fixtures/registrar-pago-supabase.sql','supabase/migrations/20260908164059_haku_libro_estado_confirmado.sql',
   'supabase/migrations/20260916041430_haku_libro_aplicaciones_servicio_seguras.sql',
   'supabase/migrations/20260916191841_haku_libro_aplicaciones_servicio_conjunto_unico.sql',ALIMENTOS,GUARDIA]) await db.exec(read(archivo));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[usuario]);
  await db.query("insert into reservas values($1,'Gastón Vera Valenzuela','11111111-1','confirmada')",[reserva]);
  await db.query('insert into cabanas values($1,3)',[cabana]);
  await db.query("insert into reserva_estadias values($1,$2,'confirmada',$3,'2026-10-03','2026-10-04','alojamiento',2,0,0)",[estadia,reserva,cabana]);
  await db.query("insert into catalogo_servicios(codigo,nombre,precio_base) values('huevo','Huevo',500),('panMasaMadre','Pan masa madre',7000),('quequeEntero','Queque entero',8000),('trozoQueque','Trozo de queque',2000)");
  await db.query("insert into cargos(reserva_id,estadia_id,tipo_cargo,concepto,monto,creado_por) values($1,$2,'alojamiento','Alojamiento',160000,$3)",[reserva,estadia,usuario]);
  await db.query("select public.haiku_registrar_pago($1,160000,'tarjeta_debito','abono','2026-10-03',null,'GASTON-ALOJ',null,null,null,'[]','alojamiento')",[reserva]);

  // Adapter de SELECT/RPC en memoria: el motor de plan usa los SQL de producción.
  const consultas={
   reserva_estadias:`select to_jsonb(e)||jsonb_build_object('cabanas',to_jsonb(c),'reservas',to_jsonb(r)) fila from reserva_estadias e join reservas r on r.id=e.reserva_id join cabanas c on c.id=e.cabana_id`,
   servicios:`select to_jsonb(s)||jsonb_build_object('catalogo_servicios',to_jsonb(c)) fila from servicios s join catalogo_servicios c on c.id=s.catalogo_servicio_id`,
   pagos:'select to_jsonb(p) fila from pagos p',catalogo_servicios:'select to_jsonb(c) fila from catalogo_servicios c',
   vista_estado_cargos:'select to_jsonb(c) fila from vista_estado_cargos c',pago_aplicaciones:'select to_jsonb(a) fila from pago_aplicaciones a'};
  const llamadas=[];
  const cliente={auth:{getSession:async()=>({data:{session:{user:{id:usuario}}}})},from(tabla){
   assert.ok(consultas[tabla],tabla);const filtros=[];
   const b={select(){return b},order(){return b},eq(k,v){filtros.push(r=>r[k]===v);return b},
    in(k,vs){filtros.push(r=>vs.includes(r[k]));return b},lte(k,v){filtros.push(r=>r[k]<=v);return b},gte(k,v){filtros.push(r=>r[k]>=v);return b},
    async range(a,z){return {data:(await db.query(consultas[tabla])).rows.map(r=>r.fila).filter(r=>filtros.every(f=>f(r))).slice(a,z+1)}}};return b;
  },async rpc(nombre,a){
   llamadas.push({nombre,args:a});
   if(nombre==='haiku_libro_aplicaciones_servicio_capacidad_v1') return {data:(await db.query('select public.haiku_libro_aplicaciones_servicio_capacidad_v1() r')).rows[0].r};
   if(nombre==='haiku_registrar_servicio') return {data:(await db.query(`select public.haiku_registrar_servicio($1,$2,$3::date,$4::time,$5::integer,$6::smallint,$7,$8::bigint,$9,$10,$11) r`,
    [a.p_reserva_id,a.p_codigo_servicio,a.p_fecha_servicio,a.p_hora,a.p_cantidad,a.p_personas,a.p_tipo_cobro,a.p_precio_manual,a.p_motivo_cortesia,a.p_observaciones,a.p_estadia_id])).rows[0].r};
   assert.equal(nombre,'haiku_incorporar_pago_servicios_libro_v1');
   return {data:(await db.query('select public.haiku_incorporar_pago_servicios_libro_v1($1,$2::jsonb) r',[a.p_operacion_id,JSON.stringify(a.p_item)])).rows[0].r};
  }};
  const S=require('../js/haiku-libro-semantica-v1.js'),D=require('../js/haiku-libro-pagos-destinos-v1.js');
  global.HAIKU_LIBRO_SEMANTICA=S;global.HAIKU_LIBRO_PAGOS_DESTINOS_V1=D;
  global.HAIKU_LIBRO_RESERVA_V1={estado:()=>({generacion:1})};global.haikuTienePermiso=()=>true;
  const Q=require('../js/haiku-libro-consultas-v1.js');
  const origen={hoja:'Oct26',celda:'K36:N36'};
  const p={titular:'Gastón Vera Valenzuela',cabana:3,tipo_movimiento:'distribuido',monto:13000,moneda:'CLP',
   medio_pago:'debito',folio:'00013',bovtar:'003013',pago_recibido:true,estado_pago:'registrado_en_libro',
   fecha_bloque:'2026-10-03',fecha_comprobante:'2026-10-03',texto_original:'Gastón Vera Valenzuela // DEBITO // Folio 00013 // BOVTAR 003013 // TOTAL $13.000',
   origen,transaccion_distribuida:true,aplicaciones_libro:[['QUEQUE',5000],['PAN',5000],['HUEVOS',3000]].map(([concepto,monto],i)=>({
    concepto,monto,tipo_movimiento:'servicio',fecha_bloque:'2026-10-03',fecha_comprobante:'2026-10-03',origen:{hoja:'Oct26',celda:`K${36+i}:N${36+i}`}}))};
  const libro={id:'Oct26!K4',titular:p.titular,cabana:3,rut_documento:'11111111-1',fecha_checkin:'2026-10-03',fecha_checkout:'2026-10-04',
   adultos:2,ninos:0,mascotas:0,tipo_estadia:'alojamiento',noches:1,pagos:[p],pagos_sin_asociacion:[],servicios:[],advertencias:[],coordenadas_origen:{hoja:'Oct26',celda:'K4'}};
  const result={reservas:[libro],generacion:1,q:{desde:'2026-10-03',hasta:'2026-10-04'}},decisiones=new Map(),aprobados=new Set();
  const original=JSON.stringify(libro),item=plan=>plan.items.find(i=>i.pagoLibro),preparar=()=>Q.prepararIncorporacion(result,decisiones,aprobados,cliente);
  let plan=await preparar();assert.equal(item(plan).manualPago.tipo,'distribucion_comprobante');
  plan=await Q.resolverAprobacionManualPago(result,decisiones,aprobados,plan,item(plan).id,{tipo:'distribucion_comprobante'},cliente);
  for(const [i,[indice,codigo,precio]] of [[2,'huevo',3000],[1,'panMasaMadre',5000],[0,'trozoQueque',5000]].entries()) {
   assert.equal(item(plan).manualPago.tipo,'crear_servicio_faltante');
   assert.equal(Q.serializarIncorporacion(plan).filter(p=>p.tipo.startsWith('pago')).length,0);
   plan=await Q.resolverAprobacionManualPago(result,decisiones,aprobados,plan,item(plan).id,
    {tipo:'crear_servicio_faltante',indice,codigo,precio,cantidad:1,personas:0,fecha:'2026-10-03',tipoCobro:'normal',precioManualConfirmado:true},cliente);
   assert.equal((await db.query('select count(*) n from servicios')).rows[0].n,i+1);
   assert.equal((await db.query('select count(*) n from pagos')).rows[0].n,1); // sólo alojamiento
  }
  const serializados=Q.serializarIncorporacion(plan).filter(p=>p.tipo.startsWith('pago'));
  assert.equal(serializados.length,1);assert.equal(serializados[0].argumentos.p_monto,13000);
  assert.equal(serializados[0].datos_origen.aplicaciones_servicio_v1.aplicaciones.length,3);
  await Q.confirmarIncorporacion(result,decisiones,aprobados,plan,cliente);
  assert.equal((await db.query('select count(*) n from pagos where monto=13000')).rows[0].n,1);
  assert.equal((await db.query('select count(*) n from pago_aplicaciones a join pagos p on p.id=a.pago_id where p.monto=13000')).rows[0].n,3);
  assert.equal(Number((await db.query('select sum(a.monto_aplicado) n from pago_aplicaciones a join pagos p on p.id=a.pago_id where p.monto=13000')).rows[0].n),13000);
  assert.ok((await db.query("select saldo_cargo from vista_estado_cargos where tipo_cargo='servicio'")).rows.every(r=>Number(r.saldo_cargo)===0));
  assert.equal((await db.query('select count(*) n from pagos')).rows[0].n,2);
  assert.equal(JSON.stringify(libro),original);
  assert.equal(item(await preparar()).categoria,'omitidos');
  assert.equal(llamadas.filter(r=>r.nombre==='haiku_incorporar_pago_servicios_libro_v1').length,1);
 } finally {await db.close();}
});

test('Gaston SQL real: un pago padre con tres aplicaciones; sumas, saldo, conceptos, ACL e idempotencia',async()=>{
 const db=new PGlite();
 try{
  await db.exec(read('tests/fixtures/libro-distribucion-schema.sql'));
  await db.exec(`alter table public.catalogo_servicios add column nombre text,add column categoria text;
   alter table public.servicios add column total bigint default 0,add column tipo_cobro text default 'normal';
   alter table public.pago_aplicaciones add column id uuid default gen_random_uuid(),add primary key(pago_id,cargo_id);
   drop view public.vista_estado_cargos;
   create view public.vista_estado_cargos as select c.id cargo_id,c.reserva_id,c.tipo_cargo,c.estado,
    coalesce(cs.nombre,cs.codigo,c.tipo_cargo) concepto,
    coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a join pagos p on p.id=a.pago_id where a.cargo_id=c.id and p.estado='confirmado'),0) aplicado_neto,
    c.monto-coalesce((select sum(a.monto_aplicado) from pago_aplicaciones a join pagos p on p.id=a.pago_id where a.cargo_id=c.id and p.estado='confirmado'),0) saldo_cargo
    from cargos c left join servicios s on s.id=c.servicio_id left join catalogo_servicios cs on cs.id=s.catalogo_servicio_id;`);
  for(const archivo of ['tests/fixtures/registrar-pago-supabase.sql',
   'supabase/migrations/20260908164059_haku_libro_estado_confirmado.sql',
   'supabase/migrations/20260916041430_haku_libro_aplicaciones_servicio_seguras.sql',
   'supabase/migrations/20260916191841_haku_libro_aplicaciones_servicio_conjunto_unico.sql',ALIMENTOS]) await db.exec(read(archivo));
  const reserva=randomUUID(),estadia=randomUUID(),cabana=randomUUID(),usuario=randomUUID();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[usuario]);
  await db.query("insert into reservas values($1,'Gaston Vera Valenzuela','confirmada')",[reserva]);
  await db.query('insert into cabanas values($1,3)',[cabana]);
  await db.query("insert into reserva_estadias values($1,$2,$3,'2026-10-03','2026-10-04','confirmada')",[estadia,reserva,cabana]);
  const apps=[];
  for(const [concepto,codigo,nombre,monto] of [['queque','quequeEntero','Queque entero',5000],
   ['pan','panMasaMadre','Pan masa madre',5000],['huevos','huevo','Huevo',3000]]){
   const catalogo=randomUUID(),servicio=randomUUID(),cargo=randomUUID();
   await db.query('insert into catalogo_servicios(id,codigo,nombre,categoria) values($1,$2,$3,\'servicio\')',[catalogo,codigo,nombre]);
   await db.query("insert into servicios values($1,$2,$3,$4,'2026-10-03','programado',$5,'normal')",[servicio,reserva,estadia,catalogo,monto]);
   await db.query("insert into cargos(id,reserva_id,estadia_id,servicio_id,tipo_cargo,estado,monto) values($1,$2,$3,$4,'servicio','activo',$5)",[cargo,reserva,estadia,servicio,monto]);
   apps.push({cargo_id:cargo,servicio_id:servicio,concepto_canon:concepto,monto,saldo_esperado:monto,
    aplicado_esperado:0,cantidad_aplicaciones_esperada:0,fecha_contexto:'2026-10-03',fecha_servicio_esperada:'2026-10-03'});
  }
  const item={tipo:'pago_servicios_4c',item_id:'Gaston-13000',reserva_id:reserva,aprobado_manualmente:true,
   argumentos:{p_reserva_id:reserva,p_monto:13000,p_medio_pago:'tarjeta_debito',p_etapa_operativa:'abono',
    p_fecha_pago:'2026-10-03',p_folio:'00013',p_codigo_autorizacion:null,p_bove:'003013',p_modo_aplicacion:'ninguno',p_aplicaciones:[]},
   datos_origen:{bovtar:'003013',aplicaciones_servicio_v1:{version:1,reserva_id:reserva,monto_total:13000,moneda:'CLP',aplicaciones:apps}}};
  const call=async(p,op=randomUUID())=>(await db.query('select public.haiku_incorporar_pago_servicios_libro_v1($1,$2::jsonb) result',[op,JSON.stringify(p)])).rows[0].result;
  const rollback=async fn=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}};
  for(const monto of [2000,4000]) await rollback(async()=>{
   const p=structuredClone(item);p.datos_origen.aplicaciones_servicio_v1.aplicaciones[2].monto=monto;
   await assert.rejects(call(p));
  });
  await rollback(async()=>{
   const p=structuredClone(item);p.datos_origen.aplicaciones_servicio_v1.aplicaciones[0].monto=6000;
   p.datos_origen.aplicaciones_servicio_v1.aplicaciones[1].monto=4000;await assert.rejects(call(p));
  });
  await rollback(async()=>{const p=structuredClone(item);p.datos_origen.aplicaciones_servicio_v1.aplicaciones[0].concepto_canon='inventado';await assert.rejects(call(p));});
  assert.equal((await db.query('select count(*) n from pagos')).rows[0].n,0);
  const operacion=randomUUID();assert.equal((await call(item,operacion)).ok,true);
  await call(item,operacion);await call(item);
  assert.equal((await db.query('select count(*) n,sum(monto) total from pagos')).rows[0].n,1);
  assert.equal(Number((await db.query('select sum(monto) total from pagos')).rows[0].total),13000);
  assert.equal((await db.query('select count(*) n,sum(monto_aplicado) total from pago_aplicaciones')).rows[0].n,3);
  assert.equal(Number((await db.query('select sum(monto_aplicado) total from pago_aplicaciones')).rows[0].total),13000);
  assert.ok((await db.query('select saldo_cargo from vista_estado_cargos')).rows.every(r=>Number(r.saldo_cargo)===0));
  assert.equal((await db.query("select private.haiku_libro_concepto_servicio_canon_v1('QUEQUE PAN') concepto")).rows[0].concepto,null);
  for(const texto of ['QUEQUE TINAJA','PAN MASAJE']) {
   assert.equal((await db.query('select private.haiku_libro_concepto_servicio_canon_v1($1) concepto',[texto])).rows[0].concepto,null);
  }
  const acl=(await db.query(`select
   has_function_privilege('anon','public.haiku_libro_aplicaciones_servicio_capacidad_v1()','execute') anon,
   has_function_privilege('authenticated','public.haiku_libro_aplicaciones_servicio_capacidad_v1()','execute') auth,
   has_function_privilege('authenticated','private.haiku_libro_concepto_servicio_canon_v1(text)','execute') privado,
   has_function_privilege('authenticated','private.haiku_libro_pago_servicios_v1(uuid,jsonb,jsonb,boolean)','execute') writer_privado`)).rows[0];
  assert.deepEqual(acl,{anon:false,auth:true,privado:false,writer_privado:false});
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(db.query('select public.haiku_libro_aplicaciones_servicio_capacidad_v1()'));
 }finally{await db.close();}
});

test('servicio faltante SQL real: RPC existente, solicitudes encoladas, reutilización exacta y conflictos sin duplicar',async()=>{
 const db=new PGlite();
 try{
  await db.exec(read('tests/fixtures/servicios-idempotencia-schema.sql'));
  await db.exec("alter table reservas add column estado_reserva text default 'confirmada'");
  await db.exec(read('supabase/migrations/20260916211226_haku_servicios_idempotencia_atomica.sql'));
  await db.exec(read(ALIMENTOS));await db.exec(read(GUARDIA));
  const reserva=randomUUID(),estadia=randomUUID(),usuario=randomUUID(),otraReserva=randomUUID(),otraEstadia=randomUUID(),segundaEstadia=randomUUID();
  await db.query('insert into reservas values($1)',[reserva]);
  await db.query('insert into reserva_estadias(id,reserva_id) values($1,$2)',[estadia,reserva]);
  await db.query('insert into reservas values($1)',[otraReserva]);
  await db.query('insert into reserva_estadias(id,reserva_id) values($1,$2),($3,$4)',[otraEstadia,otraReserva,segundaEstadia,reserva]);
  await db.query("insert into catalogo_servicios(codigo,nombre,precio_base) values('quequeEntero','Queque entero',8000),('trozoQueque','Trozo de queque',2000)");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[usuario]);
  const call=async({observaciones='[HAKU-LIBRO-SERVICIO:pago_manual:00013:003013:queque:0]',precio=5000,personas=1,fecha='2026-10-03',cantidad=1,hora=null,
   reservaId=reserva,estadiaId=estadia,codigo='quequeEntero',tipo='normal'}={})=>
   (await db.query(`select public.haiku_registrar_servicio($1,$9,$2::date,$7::time,$8::integer,$3::smallint,$10,$4::bigint,null,$5,$6) result`,
    [reservaId,fecha,personas,precio,observaciones,estadiaId,hora,cantidad,codigo,tipo])).rows[0].result;
  // PGlite usa una conexión: encola ambas solicitudes, no simula dos sesiones PostgreSQL.
  const [primero,segundo]=await Promise.all([call(),call()]);
  assert.equal(primero.servicio_id,segundo.servicio_id);assert.equal(segundo.reutilizado,true);
  // Otro origen del mismo servicio tampoco crea una segunda fila bajo el lock.
  assert.equal((await call({observaciones:'[HAKU-LIBRO-SERVICIO:pago_manual:OTRO:queque:0]'})).servicio_id,primero.servicio_id);
  for(const cambio of [{precio:4000},{personas:2},{fecha:'2026-10-04'},{cantidad:2,precio:2500},{hora:'14:00'},
   {reservaId:otraReserva,estadiaId:otraEstadia},{estadiaId:segundaEstadia},{codigo:'trozoQueque'},
   {tipo:'otro'},{tipo:null},{precio:null},{precio:0},
   {observaciones:'[HAKU-LIBRO-SERVICIO:pago_manual:OTRO:queque:0]',precio:4000}]) await assert.rejects(call(cambio));
  const marca='[HAKU-LIBRO-SERVICIO:pago_manual:00013:003013:queque:0]';
  await db.exec('begin');
  try {
   await db.query("update servicios set observaciones=observaciones||E'\\n[HAKU-LIBRO-SERVICIO:ANTERIOR]' where id=$1",[primero.servicio_id]);
   // Una marca anterior al origen manual no puede eludir la guardia de precio.
   await assert.rejects(call({observaciones:'[HAKU-LIBRO-SERVICIO:ANTERIOR]\n'+marca,precio:4000}),/origen manual/);
  } finally { await db.exec('rollback'); }
  for(const observaciones of [marca+'\n[HAKU-LIBRO-SERVICIO:pago_manual:OTRO:queque:0]',
   marca+'\n'+marca,'[HAKU-LIBRO-SERVICIO:pago_manual:incompleto']) {
   await assert.rejects(call({observaciones}),/origen manual/);
  }
  // Mismo total con otra composición del precio tampoco es una reutilización exacta.
  await db.exec('begin');
  try {
   await db.query('update servicios set precio_unitario_aplicado=4000,monto_adicional=1000 where id=$1',[primero.servicio_id]);
   await assert.rejects(call(),/cambio/);
  } finally { await db.exec('rollback'); }
  await db.exec('begin');
  try {
   await db.query("update servicios set hora_fin='15:00' where id=$1",[primero.servicio_id]);
   await assert.rejects(call(),/cambio/);
  } finally { await db.exec('rollback'); }
  // Reaplicar los drafts es idempotente y conserva servicio, cargo e identidad.
  await db.exec(read(ALIMENTOS));await db.exec(read(GUARDIA));
  assert.equal((await call()).servicio_id,primero.servicio_id);
  assert.equal((await db.query('select count(*) n from servicios')).rows[0].n,1);
  assert.equal((await db.query('select count(*) n from cargos')).rows[0].n,1);
  assert.equal((await db.query('select public.haiku_libro_aplicaciones_servicio_capacidad_v1() cap')).rows[0].cap.servicio_faltante_manual_v1,true);
  const rpc=(await db.query("select prosecdef,proconfig from pg_proc where oid='public.haiku_registrar_servicio(uuid,text,date,time,integer,smallint,text,bigint,text,text,uuid)'::regprocedure")).rows[0];
  assert.equal(rpc.prosecdef,false);assert.ok(rpc.proconfig.includes('search_path=public, pg_temp'));
  // Incluso ocultando el origen anterior con RLS, el índice impide recrearlo
  // silenciosamente en otra reserva. Los grants siguientes son sólo del fixture.
  await db.exec(`grant usage on schema public,private,auth to authenticated;
   grant all on all tables in schema public to authenticated;
   alter table servicios enable row level security;
   create policy visible on servicios for select to authenticated using(reserva_id=nullif(current_setting('haku.visible_reserva',true),'')::uuid);
   create policy crear on servicios for insert to authenticated with check(reserva_id=nullif(current_setting('haku.visible_reserva',true),'')::uuid);
   create policy editar on servicios for update to authenticated using(reserva_id=nullif(current_setting('haku.visible_reserva',true),'')::uuid);`);
  await db.query("select set_config('haku.visible_reserva',$1,false)",[otraReserva]);
  await db.exec('set role authenticated');
  try {
   assert.equal((await db.query('select count(*) n from servicios')).rows[0].n,0);
   await assert.rejects(call({reservaId:otraReserva,estadiaId:otraEstadia}),/duplicate key|duplicada/);
  } finally { await db.exec('reset role'); }
  assert.equal((await db.query('select count(*) n from servicios')).rows[0].n,1);
  const acl=(await db.query(`select
   has_function_privilege('anon','public.haiku_registrar_servicio(uuid,text,date,time,integer,smallint,text,bigint,text,text,uuid)','execute') anon,
   has_function_privilege('authenticated','public.haiku_registrar_servicio(uuid,text,date,time,integer,smallint,text,bigint,text,text,uuid)','execute') auth`)).rows[0];
  assert.deepEqual(acl,{anon:false,auth:true});
  await db.exec("create or replace function private.haiku_tiene_permiso(text) returns boolean language sql stable as $$select false$$");
  await assert.rejects(call(),/permiso/);
  await db.exec("select set_config('request.jwt.claim.sub','',false)");await assert.rejects(call(),/sesion/);
 }finally{await db.close();}
});

test('estado de reserva: pago_manual rechaza cancelada/no_show con estadía activa y conserva callers legacy',async()=>{
 const db=new PGlite();
 try {
  await db.exec(read('tests/fixtures/servicios-idempotencia-schema.sql'));
  await db.exec("alter table reservas add column estado_reserva text default 'confirmada'; create table pagos(id uuid primary key)");
  await db.exec(read('supabase/migrations/20260916211226_haku_servicios_idempotencia_atomica.sql'));
  const permisoAntes=(await db.query("select proacl,prosecdef,proconfig from pg_proc where oid='private.haiku_tiene_permiso(text)'::regprocedure")).rows[0];
  await db.exec(read(GUARDIA));
  assert.deepEqual((await db.query("select proacl,prosecdef,proconfig from pg_proc where oid='private.haiku_tiene_permiso(text)'::regprocedure")).rows[0],permisoAntes);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);
  await db.query("insert into catalogo_servicios(codigo,nombre,precio_base) values('huevo','Huevo',500)");
  for(const estado of ['confirmada','cancelada','no_show']) {
   const reserva=randomUUID(),estadia=randomUUID(),marca=`[HAKU-LIBRO-SERVICIO:pago_manual:${reserva}:huevos:0]`;
   await db.query('insert into reservas(id,estado_reserva) values($1,$2)',[reserva,estado]);
   await db.query("insert into reserva_estadias(id,reserva_id,estado_estadia) values($1,$2,'confirmada')",[estadia,reserva]);
   const call=async observaciones=>(await db.query(`select public.haiku_registrar_servicio(
    p_reserva_id=>$1,p_estadia_id=>$2,p_codigo_servicio=>'huevo',p_fecha_servicio=>'2026-10-03',
    p_personas=>0::smallint,p_precio_manual=>3000,p_observaciones=>$3) r`,[reserva,estadia,observaciones])).rows[0].r;
   if(estado==='confirmada') {
    const creado=await call(marca);assert.equal(creado.estado,'creado');assert.equal(creado.total,3000);
    const retry=await call(marca);assert.equal(retry.reutilizado,true);assert.equal(retry.servicio_id,creado.servicio_id);
   } else {
    await assert.rejects(call(marca),/reserva.*cancelada.*no_show.*vuelve a preparar/i);
    assert.equal((await db.query('select count(*) n from servicios where reserva_id=$1',[reserva])).rows[0].n,0);
    assert.equal((await db.query('select count(*) n from cargos where reserva_id=$1',[reserva])).rows[0].n,0);
    // También impide reutilizar un servicio creado antes de cambiar el estado.
    await db.query("update reservas set estado_reserva='confirmada' where id=$1",[reserva]);
    const creado=await call(marca);
    await db.query('update reservas set estado_reserva=$2 where id=$1',[reserva,estado]);
    const antes=(await db.query('select to_jsonb(s) fila from servicios s where id=$1',[creado.servicio_id])).rows[0].fila;
    await assert.rejects(call(marca),/reserva.*cancelada.*no_show.*vuelve a preparar/i);
    await assert.rejects(call(marca.replace(':huevos:0]',':huevos:1]')),/reserva.*cancelada.*no_show.*vuelve a preparar/i);
    assert.deepEqual((await db.query('select to_jsonb(s) fila from servicios s where id=$1',[creado.servicio_id])).rows[0].fila,antes);
    assert.equal((await db.query('select count(*) n from servicios where reserva_id=$1',[reserva])).rows[0].n,1);
    assert.equal((await db.query('select count(*) n from cargos where reserva_id=$1',[reserva])).rows[0].n,1);
   }
   assert.equal((await db.query('select estado_estadia from reserva_estadias where id=$1',[estadia])).rows[0].estado_estadia,'confirmada');
   assert.equal((await db.query('select count(*) n from pagos')).rows[0].n,0);
   // Sin marca y con una marca anterior del Libro conservan la creación/retry.
   assert.equal((await call('Servicio general')).estado,'creado');
   const legacy=`[HAKU-LIBRO-SERVICIO:legacy:${reserva}]`,creadoLegacy=await call(legacy);
   assert.equal(creadoLegacy.estado,'creado');
   const retryLegacy=await call(legacy);
   assert.equal(retryLegacy.reutilizado,true);assert.equal(retryLegacy.servicio_id,creadoLegacy.servicio_id);
  }
 } finally {await db.close();}
});
