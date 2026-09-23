const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

(async () => {
  const db = new PGlite();
  let checks = 0;
  try {
    for (const file of [
      'tests/fixtures/servicio-cortesia-schema.sql',
      'tests/fixtures/servicio-cancelacion-asistente-schema.sql',
      'tests/fixtures/servicio-reactivacion-asistente-schema.sql',
      'tests/fixtures/servicio-realizado-asistente-schema.sql',
      'supabase/migrations/20260923133205_haiku_marcar_servicio_realizado_asistente_v1.sql'
    ]) await db.exec(read(file));
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
    const security = await one(`select p.prosecdef,p.proconfig,p.proacl::text acl,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
      has_function_privilege('anon',p.oid,'EXECUTE') anon
      from pg_proc p where p.oid=$1::regprocedure`,
      ['public.haiku_marcar_servicio_realizado_asistente_v1(uuid,uuid,jsonb)']);
    assert.equal(security.prosecdef, true);
    assert.ok(security.proconfig.includes('search_path=pg_catalog, public, private'));
    assert.equal(security.authenticated, true);
    assert.equal(security.anon, false);
    assert.doesNotMatch(security.acl, /(?:^|\{)"?=X/i);
    checks++;

    const user = randomUUID();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    async function scenario(fn) {
      await db.exec('begin');
      try { await fn(); } finally { await db.exec('rollback'); }
    }
    async function seed({normal = true, state = 'programado', date = -1,
      start = '21:15', end = '22:15', reservationState = 'confirmada',
      stayState = 'confirmada'} = {}) {
      const x = {reservation: randomUUID(), stay: randomUUID(),
        catalog: randomUUID(), service: randomUUID()};
      await db.query('insert into public.reservas(id,titular_nombre,estado_reserva) values($1,$2,$3)',
        [x.reservation, 'Caso de prueba', reservationState]);
      await db.query('insert into public.reserva_estadias(id,reserva_id,estado_estadia) values($1,$2,$3)',
        [x.stay,x.reservation,stayState]);
      await db.query("insert into public.catalogo_servicios(id,codigo,nombre,activo,permite_cortesia,requiere_horario) values($1,'tinajaTonel','Tinaja Tonel de Madera',true,true,true)",[x.catalog]);
      await db.query(`insert into public.servicios(id,reserva_id,estadia_id,catalogo_servicio_id,
        fecha_servicio,hora_inicio,hora_fin,cantidad,personas,precio_unitario_aplicado,
        total,tipo_cobro,motivo_cortesia,estado_servicio,creado_por)
        values($1,$2,$3,$4,(now() at time zone 'America/Santiago')::date+$5::integer,
        $6,$7,1,2,$8,$8,$9,$10,$11,$12)`,
        [x.service,x.reservation,x.stay,x.catalog,date,start,end,normal?30000:0,
          normal?'normal':'cortesia',normal?null:'Cortesía inicial',state,user]);
      x.cargo = (await one("select id from public.cargos where servicio_id=$1 and estado='activo'",[x.service]))?.id || null;
      return x;
    }
    const snapshot = async id => (await one('select private.haiku_realizado_estado_prueba($1) estado',[id])).estado;
    const run = async (id,expected,op=randomUUID()) =>
      (await one('select public.haiku_marcar_servicio_realizado_asistente_v1($1,$2,$3::jsonb) result',
        [op,id,JSON.stringify(expected)])).result;
    const state = async x => (await one(`select jsonb_build_object(
      'servicio',(select to_jsonb(s) from public.servicios s where s.id=$1),
      'cargos',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from public.cargos c where c.servicio_id=$1),
      'finanzas',(select coalesce(jsonb_agg(to_jsonb(ec) order by ec.cargo_id),'[]'::jsonb) from public.vista_estado_cargos ec where ec.servicio_id=$1),
      'aplicaciones',(select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id),'[]'::jsonb) from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where c.servicio_id=$1),
      'ajustes',(select coalesce(jsonb_agg(to_jsonb(ca) order by ca.id),'[]'::jsonb) from public.cargo_ajustes ca join public.cargos c on c.id=ca.cargo_id where c.servicio_id=$1),
      'pagos',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from public.pagos p where p.reserva_id=$2),
      'reserva',(select to_jsonb(r) from public.reservas r where r.id=$2),
      'auditoria',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from public.eventos_auditoria e where e.entidad_id=$1),
      'operaciones',(select coalesce(jsonb_agg(to_jsonb(o) order by o.operacion_id),'[]'::jsonb) from private.haiku_marcar_servicio_realizado_asistente_operaciones_v1 o where o.servicio_id=$1)) result`,
      [x.service,x.reservation])).result;
    async function rejected(x, fn, message) {
      const before = await state(x);
      await db.exec('savepoint attempt');
      let error;
      try { await fn(); } catch (e) { error = e; }
      await db.exec('rollback to savepoint attempt');
      assert.ok(error, 'La llamada debía rechazarse');
      assert.match(String(error.message || error), message);
      assert.deepEqual(await state(x), before);
      checks++;
    }
    async function pay(x, amount) {
      const payment = randomUUID();
      await db.query("insert into public.pagos(id,reserva_id,monto,tipo_movimiento) values($1,$2,$3,'pago')",
        [payment,x.reservation,amount]);
      await db.query('insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,$3)',
        [payment,x.cargo,amount]);
      return payment;
    }
    async function success(options={}, paid=0) {
      const x=await seed(options);
      if(paid) await pay(x,paid);
      const before=await state(x);
      const result=await run(x.service,await snapshot(x.service));
      const after=await state(x);
      assert.equal(result.estado,'realized');
      assert.equal(after.servicio.estado_servicio,'realizado');
      assert.equal(after.servicio.id,before.servicio.id);
      assert.equal(after.servicio.tipo_cobro,before.servicio.tipo_cobro);
      assert.equal(after.servicio.total,before.servicio.total);
      assert.deepEqual(after.cargos.map(c=>({ ...c, actualizado_en:null })),
        before.cargos.map(c=>({ ...c, actualizado_en:null })));
      assert.deepEqual(after.finanzas,before.finanzas);
      assert.deepEqual(after.aplicaciones,before.aplicaciones);
      assert.deepEqual(after.pagos,before.pagos);
      assert.deepEqual(after.ajustes,before.ajustes);
      assert.deepEqual(after.reserva,before.reserva);
      const audit=after.auditoria.filter(e=>e.origen==='haku' && e.datos_contexto.operacion_id===result.operacion_id);
      assert.equal(audit.length,1);
      assert.equal(audit[0].usuario_id,user);
      assert.ok(audit[0].cambios.some(c=>c.campo==='estado_servicio' &&
        c.anterior===(options.state||'programado') && c.nuevo==='realizado'));
      checks++;
      return {x,before,after,result};
    }

    for(const paid of [0,10000,30000]) await scenario(async()=>{
      const {before,after,result}=await success({},paid);
      assert.equal(Number(result.saldo_cargo),30000-paid);
      assert.equal(Number(after.finanzas[0].saldo_cargo),30000-paid);
      assert.equal(after.cargos[0].id,before.cargos[0].id);
      checks++;
    });
    await scenario(async()=>{const {after}=await success({normal:false}); assert.deepEqual(after.cargos,[]);checks++;});
    await scenario(async()=>{await success({state:'en_proceso'});});
    await scenario(async()=>{
      const x=await seed({state:'realizado'}),before=await state(x);
      const result=await run(x.service,await snapshot(x.service));
      assert.equal(result.estado,'already_realized');
      assert.deepEqual((await state(x)).servicio,before.servicio);
      assert.deepEqual((await state(x)).cargos,before.cargos);
      checks++;
    });
    for(const stateName of ['cancelado','no_show']) await scenario(async()=>{
      const x=await seed({state:stateName});
      await rejected(x,async()=>run(x.service,await snapshot(x.service)),/estado operativo/i);
    });
    await scenario(async()=>{
      const x=await seed({date:1});
      await rejected(x,async()=>run(x.service,await snapshot(x.service)),/fecha futura/i);
    });
    await scenario(async()=>{
      const x=await seed({date:0,start:'00:01',end:'23:59'});
      await rejected(x,async()=>run(x.service,await snapshot(x.service)),/horario.*no termina/i);
    });
    await scenario(async()=>{await success({date:0,start:'00:00',end:'00:01'});});
    await scenario(async()=>{
      const x=await seed({date:0,state:'en_proceso',start:'00:01',end:'23:59'});
      await rejected(x,async()=>run(x.service,await snapshot(x.service)),/horario.*no termina|en proceso/i);
    });
    await scenario(async()=>{
      const x=await seed({date:0,end:null});
      await rejected(x,async()=>run(x.service,await snapshot(x.service)),/horario.*no termina/i);
    });
    for(const reservationState of ['checked_out','cancelada']) await scenario(async()=>{
      const x=await seed({reservationState});
      await rejected(x,async()=>run(x.service,await snapshot(x.service)),/reserva cerró/i);
    });
    await scenario(async()=>{
      const x=await seed();
      await db.query('update public.reserva_estadias set checkout_realizado_en=now() where id=$1',[x.stay]);
      await rejected(x,async()=>run(x.service,await snapshot(x.service)),/check-out/i);
    });
    for(const field of ['bove_checkout','bove_cierre']) await scenario(async()=>{
      const x=await seed();
      await db.query(`update public.reservas set ${field}='BOVE-123' where id=$1`,[x.reservation]);
      await rejected(x,async()=>run(x.service,await snapshot(x.service)),/BOVE/i);
    });
    await scenario(async()=>{
      const x=await seed();
      await db.query('update public.cargos set monto=29000 where id=$1',[x.cargo]);
      await rejected(x,async()=>run(x.service,await snapshot(x.service)),/cargo.*requiere/i);
    });
    await scenario(async()=>{
      const x=await seed();
      const payment=await pay(x,10000);
      await db.query("update public.pagos set estado='anulado' where id=$1",[payment]);
      await rejected(x,async()=>run(x.service,await snapshot(x.service)),/pagos.*requieren/i);
    });
    await scenario(async()=>{
      const x=await seed();
      await db.exec('drop index public.cargos_servicio_activo_uidx');
      await db.query("insert into public.cargos(reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto) values($1,$2,$3,'servicio','Tinaja Tonel de Madera',30000)",
        [x.reservation,x.stay,x.service]);
      await rejected(x,async()=>run(x.service,await snapshot(x.service)),/cargo normal/i);
    });
    await scenario(async()=>{
      const x=await seed(),expected=await snapshot(x.service);
      await db.query('update public.servicios set personas=3 where id=$1',[x.service]);
      await rejected(x,()=>run(x.service,expected),/obsoleta/i);
    });
    await scenario(async()=>{
      const x=await seed(),expected=await snapshot(x.service);
      await pay(x,5000);
      await rejected(x,()=>run(x.service,expected),/obsoleta/i);
    });
    await scenario(async()=>{
      const x=await seed(),expected=await snapshot(x.service),op=randomUUID();
      const first=await run(x.service,expected,op),after=await state(x);
      const second=await run(x.service,expected,op);
      assert.equal(second.reintento,true);
      assert.equal(second.estado,first.estado);
      assert.deepEqual((await state(x)).cargos,after.cargos);
      assert.equal(after.operaciones.length,1);
      assert.equal(after.auditoria.filter(e=>e.origen==='haku').length,1);
      checks++;
      await rejected(x,()=>run(x.service,{...expected,version:2},op),/otra solicitud/i);
    });
    await scenario(async()=>{
      const x=await seed(),expected=await snapshot(x.service);
      await db.exec('drop trigger auditoria_servicios on public.servicios');
      await rejected(x,()=>run(x.service,expected),/auditoría/i);
    });
    await scenario(async()=>{
      const x=await seed(),expected=await snapshot(x.service);
      await db.exec(`create function public.test_corromper_cargo_realizado() returns trigger
        language plpgsql as $$begin
          update public.cargos set monto=monto+1 where servicio_id=new.id and estado='activo';
          return null;
        end$$;
        create trigger zz_test_corromper_cargo_realizado after update of estado_servicio
        on public.servicios for each row execute function public.test_corromper_cargo_realizado();`);
      await rejected(x,()=>run(x.service,expected),/postcondición de cargos/i);
    });
    await scenario(async()=>{
      const x=await seed();
      await db.query('insert into public.cargo_ajustes(cargo_id,monto) values($1,5000)',[x.cargo]);
      await rejected(x,async()=>run(x.service,await snapshot(x.service)),/ajustes históricos/i);
    });
    await scenario(async()=>{
      const x=await seed({normal:false});
      await db.query("insert into public.cargos(reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,estado) values($1,$2,$3,'servicio','Tinaja Tonel de Madera',30000,'anulado')",[x.reservation,x.stay,x.service]);
      const result=await run(x.service,await snapshot(x.service));
      assert.equal(result.estado,'realized');
      assert.equal((await state(x)).cargos.length,1);
      checks++;
    });
    await scenario(async()=>{
      const x=await seed();
      const historic=randomUUID();
      await db.query("insert into public.cargos(id,reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,estado) values($1,$2,$3,$4,'servicio','Cargo anterior',30000,'anulado')",[historic,x.reservation,x.stay,x.service]);
      const before=await state(x);
      const result=await run(x.service,await snapshot(x.service));
      const after=await state(x);
      assert.equal(result.estado,'realized');
      assert.deepEqual(after.cargos.find(c=>c.id===historic),before.cargos.find(c=>c.id===historic));
      assert.equal(after.cargos.filter(c=>c.estado==='activo').length,1);
      checks++;
    });
    await scenario(async()=>{
      const x=await seed(),expected=await snapshot(x.service);
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await rejected(x,()=>run(x.service,expected),/iniciar sesión/i);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
      await db.query("select set_config('test.servicios_editar','false',false)");
      await rejected(x,()=>run(x.service,expected),/permiso/i);
      await db.query("select set_config('test.servicios_editar','true',false)");
      await db.query("select set_config('test.usuario_activo','false',false)");
      await rejected(x,()=>run(x.service,expected),/Usuario no activo/i);
      await db.query("select set_config('test.usuario_activo','true',false)");
    });
    console.log(`PASS: ${checks} comprobaciones PostgreSQL efímero de marcar realizado.`);
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
