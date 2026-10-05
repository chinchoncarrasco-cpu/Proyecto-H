const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const migration='supabase/migrations/20261005051906_libro_resoluciones_ocupacion.sql';
const evidencia=(extra={})=>({id:'Oct26!C3',coordenadas_origen:{hoja:'Oct26',celda:'C3'},titular:'Esperanza Aranda',cabana:1,
 fecha_checkin:'2026-10-02',fecha_checkout:'2026-10-03',tipo_estadia:'alojamiento',adultos:null,ninos:null,mascotas:null,texto_original:'ocupacion por confirmar',...extra});
const identidad=e=>({version:'a'.repeat(64),elemento:e.id,origen:e.coordenadas_origen,evidencia:e});
const valor=(adultos=2,ninos=0,mascotas=0)=>({adultos,ninos,mascotas});
const stay=(v=valor(),tipo='alojamiento',ref)=>({cabana_numero:1,datos:{...v,tipo_estadia:tipo,fecha_ingreso:'2026-10-02',
 fecha_salida:tipo==='fullday'?'2026-10-02':'2026-10-03',estado_estadia:'pendiente'},
 ...(ref?{libro_origen:ref.identidad,ocupacion_manual:true,resolucion_manual:ref}:{})});
const nueva=e=>({tipo:'reserva_nueva',item_id:'nueva',reserva:{titular_nombre:'Esperanza Aranda'},estadias:[e]});
const conflicto=e=>e.code==='HLC01';
const fueraV1=e=>e.code==='HLC02';

test('SQL real en memoria: ocupación manual sólo para reservas nuevas y contrato ordinario de main',async t=>{
 const db=new PGlite();let transaccion=false;
 const aislado=async fn=>{
  if(!transaccion)return fn();await db.exec('savepoint rechazo_test');
  try{const r=await fn();await db.exec('release savepoint rechazo_test');return r;}
  catch(e){await db.exec('rollback to savepoint rechazo_test;release savepoint rechazo_test');throw e;}
 };
 const guardar=async(id,v=valor(),anterior=null,op=randomUUID())=>aislado(async()=>(await db.query(
  "select public.haiku_libro_confirmar_resolucion_v1($1,$2::jsonb,'ocupacion',$3::jsonb,$4) r",
  [op,JSON.stringify(id),JSON.stringify(v),anterior])).rows[0].r);
 const leer=async ids=>aislado(async()=>(await db.query('select public.haiku_libro_leer_resoluciones_v1($1::jsonb) r',[JSON.stringify(ids)])).rows[0].r);
 const incorporar=async(item,op=randomUUID())=>aislado(async()=>(await db.query(
  'select public.haiku_incorporar_libro_v1($1,$2::jsonb) r',[op,JSON.stringify([item])])).rows[0].r);
 const rollback=async fn=>{await db.exec('begin');transaccion=true;try{await fn();}finally{await db.exec('rollback');transaccion=false;}};
 const caso=(nombre,fn)=>t.test(nombre,()=>rollback(fn));
 try{
  for(const f of ['libro-distribucion','libro-fullday','libro-resoluciones'])await db.exec(read('tests/fixtures/'+f+'-schema.sql'));
  const prioridad=read('supabase/migrations/20260908162301_haku_libro_prioridad_confirmada.sql');
  await db.exec(prioridad.slice(0,prioridad.indexOf('create or replace function public.haiku_incorporar_libro_v1')));
  await db.exec(read('supabase/migrations/20260908164318_haku_libro_validar_campos_conocidos.sql'));
  const base=read('supabase/migrations/20260908113000_haku_incorporar_libro_v1.sql');
  await db.exec(base.slice(base.indexOf('create or replace function private.haiku_libro_agregar_estadia_v1'),base.indexOf('create or replace function public.haiku_incorporar_libro_v1')));
  for(const f of ['20260908164059_haku_libro_estado_confirmado','20260909215808_haku_libro_aprobacion_distribucion_manual','20261002151142_libro_fullday_tarifa_adl'])await db.exec(read('supabase/migrations/'+f+'.sql'));
  const meta=async()=>(await db.query("select proacl::text,proowner,prosecdef,proconfig from pg_proc where oid in ('public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure,'private.haiku_libro_actualizar_v1(jsonb)'::regprocedure) order by oid")).rows;
  const updater=async()=>(await db.query("select pg_get_functiondef('private.haiku_libro_actualizar_v1(jsonb)'::regprocedure) body")).rows[0].body;
  const before=await meta(),bodyBefore=await updater();await db.exec(read(migration));
  assert.deepEqual(await meta(),before);assert.equal(await updater(),bodyBefore);
  await db.exec(read(migration));assert.deepEqual(await meta(),before);assert.equal(await updater(),bodyBefore);
  await db.exec("set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';insert into cabanas(id,numero,precio_base) values(gen_random_uuid(),1,160000)");
  await caso('actor/fecha, original/confirmado, edición append-only y retries sin generación persistida',async()=>{
   const id=identidad(evidencia()),op=randomUUID(),d=await guardar(id,valor(),null,op);
   assert.equal(d.valor_original.adultos,null);assert.deepEqual(d.valor_confirmado,valor());assert.equal(d.generacion,undefined);
   assert.equal(d.usuario_id,'00000000-0000-0000-0000-000000000001');assert.ok(d.confirmado_en);
   assert.equal((await guardar(id,valor(),null,op)).id,d.id);
   await assert.rejects(guardar(id,valor(3),null,op),conflicto);
   const edit=await guardar(id,valor(3,1),d.id);assert.equal(edit.anterior,d.id);assert.equal((await leer([id]))[0].id,edit.id);
   const rows=(await db.query('select valor_confirmado from private.haiku_libro_resoluciones order by revision')).rows;
   assert.deepEqual(rows.map(r=>r.valor_confirmado),[valor(),valor(3,1)]);
   await assert.rejects(guardar(id,valor(4),d.id),conflicto);
  });
  await caso('SHA/evidencia/origen exactos recuperan; cualquier cambio invalida',async()=>{
   const id=identidad(evidencia()),d=await guardar(id);
   assert.equal((await leer([id]))[0].id,d.id);
   for(const changed of [{...id,version:'b'.repeat(64)},identidad(evidencia({texto_original:'cambio'})),
    identidad(evidencia({id:'Oct26!G3',coordenadas_origen:{hoja:'Oct26',celda:'G3'}}))]){
    assert.deepEqual(await leer([changed]),[]);const item=nueva(stay(valor(),'alojamiento',d));item.estadias[0].libro_origen=changed;
    await assert.rejects(incorporar(item),conflicto);
   }
  });
  await caso('resolución ajena no puede leerse ni utilizarse',async()=>{
   const id=identidad(evidencia()),d=await guardar(id);
   await db.exec("set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'");
   assert.deepEqual(await leer([id]),[]);await assert.rejects(incorporar(nueva(stay(valor(),'alojamiento',d))),conflicto);
  });
  await caso('valores inválidos no se confirman ni adulteran una referencia válida',async()=>{
   const id=identidad(evidencia()),d=await guardar(id);
   for(const [k,v] of [['adultos',null],['adultos',-1],['adultos',0],['adultos',2.5],['adultos','2'],['adultos',true],['adultos',32768],['ninos',-1],['ninos',0.5],['mascotas',-1],['mascotas',32768]]){
    const invalid={...valor(),[k]:v};await assert.rejects(guardar(identidad(evidencia({id:randomUUID()})),invalid),/Ocupacion|resolucion/);
    await assert.rejects(incorporar(nueva(stay(invalid,'alojamiento',d))),conflicto);
   }
  });
  await caso('resolución anterior reemplazada y referencias modificadas dan conflicto estable',async()=>{
   const id=identidad(evidencia()),d=await guardar(id),edit=await guardar(id,valor(3),d.id);
   for(const ref of [d,{...edit,id:randomUUID()},{...edit,valor_confirmado:valor(4)}])
    await assert.rejects(incorporar(nueva(stay(valor(3),'alojamiento',ref))),conflicto);
   await incorporar(nueva(stay(valor(3),'alojamiento',edit)));
   assert.equal((await db.query('select adultos from reserva_estadias')).rows[0].adultos,3);
  });
  await caso('resolución A no crea B por titular/CAB/fechas/origen distintos, incluso con variantes de tipo',async()=>{
   const d=await guardar(identidad(evidencia()));
   for(const tipo of ['reserva_nueva','RESERVA_NUEVA',' Reserva_Nueva ']){
    const item=nueva(stay(valor(),'alojamiento',d));item.tipo=tipo;item.reserva.titular_nombre='Otra persona';
    await assert.rejects(incorporar(item),conflicto);
    item.reserva.titular_nombre='Esperanza Aranda';item.estadias[0].datos.fecha_salida='2026-10-04';
    await assert.rejects(incorporar(item),conflicto);
    item.estadias[0].datos.fecha_salida='2026-10-03';item.estadias[0].cabana_numero=2;
    await assert.rejects(incorporar(item),conflicto);
    item.estadias[0].cabana_numero=1;item.estadias[0].libro_origen=identidad(evidencia({id:'Oct26!G3',coordenadas_origen:{hoja:'Oct26',celda:'G3'}}));
    await assert.rejects(incorporar(item),conflicto);
   }
   assert.equal((await db.query('select count(*)::int n from reservas')).rows[0].n,0);
  });
  await caso('referencia y origen obligatorios exclusivamente para la ruta manual',async()=>{
   const d=await guardar(identidad(evidencia())),item=nueva(stay(valor(),'alojamiento',d));
   for(const key of ['resolucion_manual','libro_origen']){
    const invalid=structuredClone(item);delete invalid.estadias[0][key];await assert.rejects(incorporar(invalid),conflicto);
   }
   await incorporar(item);assert.equal((await db.query('select adultos from reserva_estadias')).rows[0].adultos,2);
  });
  await caso('tipos normalizados comparten validación, ejecución y reintento idempotente',async()=>{
   const id=identidad(evidencia()),d=await guardar(id),op=randomUUID(),item=nueva(stay(valor(),'alojamiento',d));item.tipo=' RESERVA_NUEVA ';
   assert.equal((await incorporar(item,op)).reservas_creadas,1);
   item.tipo='reserva_nueva';assert.equal((await incorporar(item,op)).reintento,true);
   await guardar(id,valor(4),d.id);assert.equal((await incorporar(item,op)).reintento,true);
   assert.equal((await db.query('select count(*)::int n from reservas')).rows[0].n,1);
  });
  await caso('Full Day 2 ADL + 1 niño = 120000; 1 ADL se rechaza',async()=>{
   const id=identidad(evidencia({tipo_estadia:'full_day',fecha_checkout:'2026-10-02'}));
   await assert.rejects(guardar(id,valor(1,2)),/2 ADL/);const d=await guardar(id,valor(2,1));
   await assert.rejects(incorporar(nueva(stay(valor(1,2),'fullday',d))),conflicto);
   await incorporar(nueva(stay(valor(2,1),'fullday',d)));assert.equal(Number((await db.query('select monto from cargos')).rows[0].monto),120000);
  });
  await caso('reserva ordinaria sin origen/referencia mantiene contrato de main',async()=>{
   const item=nueva(stay(valor(1)));assert.equal(item.estadias[0].libro_origen,undefined);
   await incorporar(item);assert.equal(Number((await db.query('select monto from cargos')).rows[0].monto),160000);
  });
  await caso('estadia manual queda fuera de V1 para todas las variantes de tipo',async()=>{
   const d=await guardar(identidad(evidencia()));
   for(const tipo of ['estadia','ESTADIA',' Estadia '])
    await assert.rejects(incorporar({tipo,item_id:'extra',reserva_id:randomUUID(),estadias:[stay(valor(),'alojamiento',d)]}),fueraV1);
  });
  await caso('actualizaciones manuales y asociación de existentes quedan fuera de V1',async()=>{
   const d=await guardar(identidad(evidencia()));
   for(const tipo of ['reserva_actualizar','RESERVA_ACTUALIZAR',' Reserva_Actualizar ']){
    const item={tipo,item_id:'update',reserva_id:randomUUID(),estadia_id:randomUUID(),resolucion_manual:d};
    await assert.rejects(incorporar(item),fueraV1);
    delete item.resolucion_manual;item.estadia={libro_origen:d.identidad};await assert.rejects(incorporar(item),fueraV1);
   }
  });
  await caso('estadia ordinaria sin referencias sigue usando el contrato de main',async()=>{
   const rid=randomUUID();await db.query("insert into reservas(id,titular_nombre,estado_reserva) values($1,'Esperanza Aranda','pendiente')",[rid]);
   await incorporar({tipo:' ESTADIA ',item_id:'ordinary-extra',reserva_id:rid,estadias:[stay(valor(1))]});
   assert.equal((await db.query('select reserva_id from reserva_estadias')).rows[0].reserva_id,rid);
  });
  await caso('Full Day existente: resolución bloqueada y actualización ordinaria conserva finanzas de main',async()=>{
   const d=await guardar(identidad(evidencia({tipo_estadia:'full_day',fecha_checkout:'2026-10-02'}))),rid=randomUUID(),eid=randomUUID(),cid=randomUUID(),pid=randomUUID();
   await db.query("insert into reservas(id,titular_nombre,estado_reserva) values($1,'Esperanza Aranda','pendiente')",[rid]);
   await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,adultos,ninos,mascotas,estado_estadia) select $1,$2,id,'2026-10-02','2026-10-02','fullday',1,0,0,'pendiente' from cabanas where numero=1",[eid,rid]);
   await db.query("insert into cargos(id,reserva_id,estadia_id,tipo_cargo,estado,monto) values($1,$2,$3,'alojamiento','activo',160000)",[cid,rid,eid]);
   await db.query('insert into pagos(id,reserva_id,monto) values($1,$2,50000)',[pid,rid]);
   await db.query('insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,50000)',[pid,cid]);
   const item={tipo:' RESERVA_ACTUALIZAR ',item_id:'fd-update',reserva_id:rid,estadia_id:eid,reserva:{antes:{},despues:{}},
    estadia:{antes:{adultos:1,ninos:0},despues:{adultos:2,ninos:1}},cambios:[]};
   await assert.rejects(incorporar({...item,resolucion_manual:d}),fueraV1);await incorporar(item);
   assert.equal((await db.query('select adultos from reserva_estadias')).rows[0].adultos,2);
   assert.deepEqual((await db.query('select estado,monto::int from cargos')).rows,[{estado:'activo',monto:160000}]);
   assert.equal(Number((await db.query('select monto from pagos')).rows[0].monto),50000);
   assert.deepEqual((await db.query('select monto_aplicado::int from pago_aplicaciones')).rows,[{monto_aplicado:50000}]);
  });
  await caso('permisos crear, UID y ACL privados; editar solo no autoriza resolver',async()=>{
   const id=identidad(evidencia());await db.exec("set haku.test_permit='off'");
   await assert.rejects(guardar(id),e=>e.code==='42501');await assert.rejects(leer([id]),e=>e.code==='42501');
   await db.exec("set haku.test_permit='on';set request.jwt.claim.sub=''");await assert.rejects(guardar(id),e=>e.code==='42501');
   await db.exec("set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'");
   await db.exec("create or replace function private.haiku_tiene_permiso(p_perm text) returns boolean language sql as $$select p_perm='reservas.editar'$$");
   await assert.rejects(guardar(id),e=>e.code==='42501');await assert.rejects(leer([id]),e=>e.code==='42501');
   const acl=(await db.query("select has_table_privilege('authenticated','private.haiku_libro_resoluciones','select') sel,has_table_privilege('authenticated','private.haiku_libro_resoluciones','insert') ins,has_function_privilege('anon','public.haiku_libro_confirmar_resolucion_v1(uuid,jsonb,text,jsonb,uuid)','execute') anon,has_function_privilege('authenticated','public.haiku_libro_confirmar_resolucion_v1(uuid,jsonb,text,jsonb,uuid)','execute') auth")).rows[0];
   assert.deepEqual(acl,{sel:false,ins:false,anon:false,auth:true});
  });
  await t.test('DML nuevo sólo almacena resoluciones; normalización única antes de hash y validación posterior a retry',async()=>{
   const sql=read(migration);assert.doesNotMatch(sql,/(?:insert into|update|delete from)\s+public\.|v_date_change|v_price\s*:=/i);
   const body=(await db.query("select pg_get_functiondef('public.haiku_incorporar_libro_v1(uuid,jsonb)'::regprocedure) b")).rows[0].b;
   assert.ok(body.indexOf('Canonical operation types')<body.indexOf('v_hash := md5'));
   assert.ok(body.indexOf('return v_registro.resultado')<body.indexOf('perform private.haiku_libro_validar_ocupaciones_lote_v1'));
   assert.equal((await db.query('select count(*)::int n from reservas')).rows[0].n,0);
  });
 }finally{await db.close();}
});
