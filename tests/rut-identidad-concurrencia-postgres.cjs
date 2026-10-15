// PostgreSQL nativo, conexiones separadas. Crea y elimina sólo su BD ficticia local.
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Client}=require('pg');
const {preparar}=require('./fixtures/rut-identidad-sql.cjs');
const {incidente}=require('./fixtures/rut-incidente-ficticio.cjs');
const repair=require('../tools/rut-identidad-reparacion.cjs');
const input=process.env.HAKU_RUT_TEST_DATABASE_URL;
if(process.env.HAKU_RUT_ALLOW_DISPOSABLE_DB!=='YES'||!input)throw Error('Requiere autorización para PostgreSQL local desechable');
const url=new URL(input);if(!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Sólo se permite loopback local');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('PostgreSQL nativo: reparación y carreras entre sesiones reales',async t=>{
  const admin=new Client({connectionString:input}),name='haiku_rut_test_'+randomUUID().replace(/-/g,'');
  const clients=[];let h;
  await admin.connect();await admin.query('create database '+name);
  try{
    url.pathname='/'+name;
    const connect=async()=>{const c=new Client({connectionString:url.href});await c.connect();clients.push(c);return c;};
    const setup=await connect();
    const db={query:(...a)=>setup.query(...a),exec:sql=>setup.query(sql.replace('create role anon; create role authenticated;',()=>
      `do $$begin if not exists(select from pg_roles where rolname='anon') then create role anon;end if;
       if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;end$$;`)),close:async()=>{}};
    h=await preparar({db,historicos:true});
    console.log('Servidor aislado:',(await setup.query('show server_version')).rows[0].server_version);
    await t.test('reparación, pago histórico, retry y reversión preservan filas',async()=>{
      const {m,approval}=await incidente(h),receipt=await repair.apply(db,m,approval);
      assert.equal((await repair.apply(db,m,approval,receipt)).retry,true);
      assert.equal((await repair.revert(db,m,{...approval,action:'revert'},receipt)).reverted,true);
      const after=(await repair.manifest(db,{})).snapshot;
      for(const name of ['public.pagos','public.pago_aplicaciones','public.cargos','public.reserva_estadias','public.huespedes','public.reserva_huespedes','public.estadia_huespedes'])
        assert.deepEqual(after.rows[name],m.snapshot.rows[name]);
    });
    const a=await connect(),b=await connect();
    for(const c of [a,b])await c.query("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);
    const create=(c,rut)=>c.query(`select public.haiku_crear_reserva('Concurrente Ficticio',1::smallint,'2027-01-10'::date,'2027-01-12'::date,p_rut=>$1) r`,[rut]);
    const waitForLock=async()=>{
      for(let i=0;i<100;i++){
        const state=(await setup.query('select wait_event_type from pg_stat_activity where pid=$1',[b.processID])).rows[0];
        if(state?.wait_event_type==='Lock')return;
        await pause(10);
      }assert.fail('La segunda sesión no alcanzó el bloqueo esperado');
    };
    await t.test('READ COMMITTED: alta concurrente espera, aborta tipada y retry reutiliza',async()=>{
      const before=(await setup.query('select count(*)::int n from huespedes')).rows[0].n;
      await a.query('begin');await b.query('begin');const first=(await create(a,'12.345.671-8')).rows[0].r;
      let settled=false;const pending=create(b,'123456718').then(()=>({ok:true}),e=>({code:e.code})).finally(()=>{settled=true});
      await waitForLock();assert.equal(settled,false);await a.query('commit');assert.deepEqual(await pending,{code:'HLI01'});await b.query('rollback');
      const retry=(await create(b,'123456718')).rows[0].r;assert.notEqual(first.reserva_id,retry.reserva_id);
      assert.equal((await setup.query('select count(*)::int n from huespedes')).rows[0].n,before+1);
      assert.equal((await setup.query('select count(distinct titular_huesped_id)::int n from reservas where id=any($1::uuid[])',[[first.reserva_id,retry.reserva_id]])).rows[0].n,1);
    });
    await t.test('REPEATABLE READ: snapshot antiguo no atraviesa la PK normalizada',async()=>{
      await a.query('begin isolation level repeatable read');await b.query('begin isolation level repeatable read');
      await b.query('select count(*) from huespedes');await create(a,'12.345.672-6');
      const pending=create(b,'123456726').then(()=>({ok:true}),e=>({code:e.code}));
      await waitForLock();await a.query('commit');assert.deepEqual(await pending,{code:'40001'});await b.query('rollback');
      assert.equal((await setup.query(`select count(*)::int n from huespedes where private.haiku_rut_clave_v1(numero_documento)='123456726' and tipo_documento='rut'`)).rows[0].n,1);
    });
    await t.test('DML directo concurrente queda protegido por el mismo registro',async()=>{
      await a.query('begin');await b.query('begin');
      await a.query(`insert into huespedes(nombre,tipo_documento,numero_documento) values('Directo Ficticio','rut','12.345.673-4')`);
      const pending=b.query(`insert into huespedes(nombre,tipo_documento,numero_documento) values('Otra Persona Ficticia','rut','123456734')`).then(()=>({ok:true}),e=>({code:e.code}));
      await waitForLock();await a.query('commit');assert.deepEqual(await pending,{code:'HLI01'});await b.query('rollback');
      assert.equal((await setup.query(`select count(*)::int n from huespedes where tipo_documento='rut' and private.haiku_rut_clave_v1(numero_documento)='123456734'`)).rows[0].n,1);
    });
    await t.test('authenticated no puede leer alias o registro ni ejecutar resolver',async()=>{
      const privileges=(await setup.query(`select
        has_table_privilege('authenticated','private.haiku_rut_registro_v1','SELECT') r,
        has_table_privilege('authenticated','private.haiku_huesped_alias_v1','SELECT') a,
        has_function_privilege('authenticated','private.haiku_rut_resolver_v1(text,text)','EXECUTE') f,
        has_function_privilege('anon','private.haiku_huesped_guard_v1()','EXECUTE') g`)).rows[0];
      assert.deepEqual(privileges,{r:false,a:false,f:false,g:false});
    });
    await t.test('pasaportes concurrentes mantienen igualdad textual y errores sin documento',async()=>{
      await a.query('begin');await b.query('begin');
      await a.query(`insert into huespedes(nombre,tipo_documento,numero_documento) values('Extranjera Ficticia','pasaporte','PASAPORTE-CARRERA-FICTICIO')`);
      const pending=b.query(`insert into huespedes(nombre,tipo_documento,numero_documento) values('Otra Extranjera Ficticia','pasaporte','PASAPORTE-CARRERA-FICTICIO')`).then(()=>({ok:true}),e=>({code:e.code,private:!String(e.message+e.detail).includes('PASAPORTE-CARRERA-FICTICIO')}));
      await waitForLock();await a.query('commit');assert.deepEqual(await pending,{code:'HLI01',private:true});await b.query('rollback');
    });
    await t.test('DML authenticated respeta RLS y no puede duplicar el registro privado invisible',async()=>{
      await b.query('set role authenticated');
      try {
        await b.query(`insert into huespedes(nombre,tipo_documento,numero_documento) values('Autenticada Ficticia','rut','12.345.674-2')`);
        await assert.rejects(b.query(`insert into huespedes(nombre,tipo_documento,numero_documento) values('Otra Ficticia','rut','123456742')`),e=>e.code==='HLI01');
        await assert.rejects(b.query('select * from private.haiku_rut_registro_v1'),e=>e.code==='42501');
      }finally{await b.query('reset role');}
    });
  }finally{
    for(const c of clients)await c.end();
    await admin.query('drop database '+name);await admin.end();
  }
});
