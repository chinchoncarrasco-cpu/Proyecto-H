const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.HAKU_PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..'), read=f=>fs.readFileSync(path.join(root,f),'utf8');
const migration='supabase/migrations/20261002151142_libro_fullday_tarifa_adl.sql';
const estadia=(adultos,ninos=0,tipo='fullday')=>({cabana_numero:1,datos:{adultos,ninos,mascotas:0,
 fecha_ingreso:'2026-10-02',fecha_salida:tipo==='fullday'?'2026-10-02':'2026-10-03',tipo_estadia:tipo,estado_estadia:'pendiente'}});

test('importador SQL: ADL canonicos en reserva nueva y estadia agregada; rollback',async()=>{
 const db=new PGlite();
 const call=async item=>(await db.query('select public.haiku_incorporar_libro_v1($1,$2::jsonb) as result',[randomUUID(),JSON.stringify([item])])).rows[0].result;
 const nueva=e=>({tipo:'reserva_nueva',item_id:'full-day',reserva:{titular_nombre:'Esperanza Aranda'},estadias:[e]});
 const rollback=async fn=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}};
 try{
  await db.exec(read('tests/fixtures/libro-distribucion-schema.sql'));
  await db.exec(read('tests/fixtures/libro-fullday-schema.sql'));
  const base=read('supabase/migrations/20260908113000_haku_incorporar_libro_v1.sql');
  await db.exec(base.slice(base.indexOf('create or replace function private.haiku_libro_agregar_estadia_v1'),base.indexOf('create or replace function public.haiku_incorporar_libro_v1')));
  await db.exec(read('supabase/migrations/20260908164059_haku_libro_estado_confirmado.sql'));
  await db.exec(read('supabase/migrations/20260909215808_haku_libro_aprobacion_distribucion_manual.sql'));
  await db.exec("set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; insert into cabanas(id,numero,precio_base) values(gen_random_uuid(),1,160000)");
  await rollback(async()=>{await assert.rejects(call(nueva(estadia(2))),/Falta tarifa explicita/);});
  const signatures=['public.haiku_incorporar_libro_v1(uuid,jsonb)','private.haiku_libro_agregar_estadia_v1(uuid,jsonb)'];
  const metadata=async()=> (await db.query('select proacl::text,proowner,prosecdef,proconfig from pg_proc where oid=any($1::regprocedure[]) order by oid',[signatures])).rows;
  const before=await metadata();
  await db.exec(read(migration));
  assert.deepEqual(await metadata(),before,'ACL, owner, seguridad y search_path intactos');
  await db.exec(read(migration));
  assert.deepEqual(await metadata(),before,'reaplicacion segura');
  for(const [adultos,ninos,total] of [[2,0,120000],[3,0,180000],[4,0,240000],[2,1,120000],[3,2,180000]]){
   for(const tipo of ['nueva','agregada'])await rollback(async()=>{
    const e=estadia(adultos,ninos);e.tarifas={'2026-10-02':1}; // No confiar en un precio adulterado del cliente.
    if(tipo==='nueva') await call(nueva(e));
    else{
     const rid=randomUUID();await db.query("insert into reservas(id,titular_nombre,estado_reserva) values($1,'Destino','pendiente')",[rid]);
     await call({tipo:'estadia',item_id:'adicional',reserva_id:rid,estadias:[e]});
    }
    const row=(await db.query('select c.monto,e.adultos,e.ninos from cargos c join reserva_estadias e on e.id=c.estadia_id')).rows[0];
    assert.equal(Number(row.monto),total);assert.equal(row.adultos,adultos);assert.equal(row.ninos,ninos);
    assert.equal((await db.query('select count(*)::int n from pagos')).rows[0].n,0);
   });
  }
  for(const adultos of [1,0,null,undefined,2.5,'2',true,32768])await rollback(async()=>{
   await assert.rejects(call(nueva(estadia(adultos,2))),/ADL|smallint/);
  });
  await rollback(async()=>{
   await call(nueva(estadia(1,2,'alojamiento')));
   assert.equal(Number((await db.query('select monto from cargos')).rows[0].monto),160000);
  });
  // Rechazo del minimo tambien al agregar a una reserva existente.
  await rollback(async()=>{
   const rid=randomUUID();await db.query("insert into reservas(id,titular_nombre,estado_reserva) values($1,'Destino','pendiente')",[rid]);
   await assert.rejects(call({tipo:'estadia',item_id:'bad',reserva_id:rid,estadias:[estadia(1,2)]}),/ADL/);
  });
  assert.equal((await db.query('select count(*)::int n from reservas')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from cargos')).rows[0].n,0);
 }finally{await db.close();}
});
