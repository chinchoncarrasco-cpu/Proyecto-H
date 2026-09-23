const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

(async () => {
  const db = new PGlite();
  let checks = 0;
  try {
    await db.exec(read('tests/fixtures/servicio-cortesia-schema.sql'));
    await db.exec(read('tests/fixtures/servicio-cancelacion-asistente-schema.sql'));
    await db.exec(read('supabase/migrations/20260923035510_haiku_cancelar_servicio_asistente_v1.sql'));
    const signature = 'public.haiku_cancelar_servicio_asistente_v1(uuid,uuid,text,jsonb)';
    const security = (await db.query(`select p.prosecdef,p.proconfig,p.proacl::text acl,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
      has_function_privilege('anon',p.oid,'EXECUTE') anon
      from pg_proc p where p.oid=$1::regprocedure`, [signature])).rows[0];
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
    async function seed({ normal = false, state = 'programado',
      reservationState = 'confirmada', bove = null, checkout = false,
      historic = false } = {}) {
      const reservation = randomUUID(), stay = randomUUID(), catalog = randomUUID(), service = randomUUID();
      await db.query('insert into public.reservas(id,titular_nombre,estado_reserva) values($1,$2,$3)',
        [reservation, 'Persona de prueba', reservationState]);
      await db.query('insert into public.reserva_estadias(id,reserva_id) values($1,$2)', [stay,reservation]);
      await db.query("insert into public.catalogo_servicios(id,codigo,nombre,activo,permite_cortesia) values($1,'tinajaTonel','Tinaja Tonel',true,true)", [catalog]);
      await db.query(`insert into public.servicios
        (id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,hora_inicio,hora_fin,
         cantidad,personas,precio_unitario_aplicado,total,tipo_cobro,motivo_cortesia,
         estado_servicio,creado_por)
        values($1,$2,$3,$4,'2026-09-12','22:15','23:15',1,2,$5,$6,$7,$8,$9,$10)`,
        [service,reservation,stay,catalog,normal ? 30000 : 0,normal ? 30000 : 0,
          normal ? 'normal' : 'cortesia',normal ? null : 'Cortesía original',state,user]);
      // El cargo activo proviene únicamente del trigger del servicio.
      const activeId = (await db.query("select id from public.cargos where servicio_id=$1 and estado='activo'", [service])).rows[0]?.id;
      let historicalId = null;
      if (historic) {
        historicalId = randomUUID();
        await db.query(`insert into public.cargos
          (id,reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,estado)
          values($1,$2,$3,$4,'servicio','Cargo anterior',30000,'anulado')`,
          [historicalId,reservation,stay,service]);
      }
      if (checkout) await db.query('update public.reserva_estadias set checkout_realizado_en=now() where id=$1',[stay]);
      if (bove) await db.query('update public.reservas set bove_checkout=$2 where id=$1',[reservation,bove]);
      return {reservation,stay,catalog,service,activeId,historicalId};
    }
    async function snapshot(service) {
      const { rows } = await db.query(`select jsonb_build_object(
        'version',1,'servicio_id',s.id,'servicio_actualizado_en',s.actualizado_en,
        'estado_servicio',s.estado_servicio,'tipo_cobro',s.tipo_cobro,'total',s.total,
        'fecha_servicio',s.fecha_servicio,'hora_inicio',s.hora_inicio,'hora_fin',s.hora_fin,
        'reserva_id',s.reserva_id,'estadia_id',s.estadia_id,
        'estado_reserva',r.estado_reserva,'reserva_actualizado_en',r.actualizado_en,
        'checkout_realizado_en',(select max(re.checkout_realizado_en) from public.reserva_estadias re where re.reserva_id=s.reserva_id),
        'bove_checkout',r.bove_checkout,
        'cargos',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from public.cargos c where c.servicio_id=s.id),
        'cargo_activo_id',case when (select count(*) from public.cargos c where c.servicio_id=s.id and c.estado='activo')=1 then (select c.id from public.cargos c where c.servicio_id=s.id and c.estado='activo' order by c.id limit 1) end,
        'cargo_monto',case when (select count(*) from public.cargos c where c.servicio_id=s.id and c.estado='activo')=1 then (select c.monto from public.cargos c where c.servicio_id=s.id and c.estado='activo' order by c.id limit 1) end,
        'cargo_aplicado_neto',case when (select count(*) from public.cargos c where c.servicio_id=s.id and c.estado='activo')=1 then (select ec.aplicado_neto from public.vista_estado_cargos ec where ec.servicio_id=s.id and ec.estado='activo' order by ec.cargo_id limit 1) end,
        'cargo_saldo',case when (select count(*) from public.cargos c where c.servicio_id=s.id and c.estado='activo')=1 then (select ec.saldo_cargo from public.vista_estado_cargos ec where ec.servicio_id=s.id and ec.estado='activo' order by ec.cargo_id limit 1) end,
        'cantidad_cargos_activos',(select count(*) from public.cargos c where c.servicio_id=s.id and c.estado='activo'),
        'cantidad_aplicaciones',(select count(*) from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where c.servicio_id=s.id),
        'cantidad_ajustes',(select count(*) from public.cargo_ajustes ca join public.cargos c on c.id=ca.cargo_id where c.servicio_id=s.id)
      ) estado from public.servicios s join public.reservas r on r.id=s.reserva_id where s.id=$1`,[service]);
      return rows[0].estado;
    }
    async function call(service,expected,{op=randomUUID(),reason='Huésped desistió'}={}) {
      const {rows}=await db.query('select public.haiku_cancelar_servicio_asistente_v1($1,$2,$3,$4::jsonb) result',
        [op,service,reason,JSON.stringify(expected)]);
      return rows[0].result;
    }
    async function state(service) {
      const {rows}=await db.query(`select jsonb_build_object(
        'servicio',(select to_jsonb(s) from public.servicios s where s.id=$1),
        'cargos',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from public.cargos c where c.servicio_id=$1),
        'aplicaciones',(select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id),'[]'::jsonb) from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where c.servicio_id=$1),
        'ajustes',(select coalesce(jsonb_agg(to_jsonb(ca) order by ca.id),'[]'::jsonb) from public.cargo_ajustes ca join public.cargos c on c.id=ca.cargo_id where c.servicio_id=$1),
        'auditoria',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from public.eventos_auditoria e where e.entidad_id=$1),
        'operaciones',(select coalesce(jsonb_agg(to_jsonb(o) order by o.operacion_id),'[]'::jsonb) from private.haiku_cancelar_servicio_asistente_operaciones_v1 o where o.servicio_id=$1)
      ) state`,[service]);
      return rows[0].state;
    }
    async function rejectUnchanged(service,fn,pattern) {
      const before=await state(service);
      await db.exec('savepoint attempt');
      let error;
      try { await fn(); } catch(e) { error=e; }
      await db.exec('rollback to savepoint attempt');
      assert.ok(error,'La llamada debía rechazarse');
      assert.match(String(error.message||error),pattern);
      assert.deepEqual(await state(service),before);
      checks++;
    }
    async function payment(x,amount,type='pago',cargo=x.activeId) {
      const id=randomUUID();
      await db.query('insert into public.pagos(id,reserva_id,monto,tipo_movimiento) values($1,$2,$3,$4)',
        [id,x.reservation,amount,type]);
      await db.query('insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,$3)',
        [id,cargo,amount]);
    }

    for(const normal of [false,true]) await scenario(async()=>{
      const x=await seed({normal,historic:!normal});
      const before=await state(x.service);
      const result=await call(x.service,await snapshot(x.service));
      const after=await state(x.service);
      assert.equal(result.estado,'cancelled');
      assert.equal(after.servicio.estado_servicio,'cancelado');
      assert.equal(after.servicio.motivo_cancelacion,'Huésped desistió');
      assert.equal(after.servicio.cancelado_por,user);
      assert.ok(after.servicio.cancelado_en);
      assert.equal(after.servicio.tipo_cobro,before.servicio.tipo_cobro);
      assert.equal(after.servicio.total,before.servicio.total);
      assert.equal(after.cargos.filter(c=>c.estado==='activo').length,0);
      assert.equal(after.cargos.length,before.cargos.length);
      if(normal){assert.equal(after.cargos[0].id,x.activeId);assert.equal(after.cargos[0].estado,'anulado');assert.equal(Number(after.cargos[0].monto),30000);}
      else assert.deepEqual(after.cargos,before.cargos);
      assert.deepEqual(after.aplicaciones,before.aplicaciones);
      assert.deepEqual(after.ajustes,before.ajustes);
      const audit=after.auditoria.filter(e=>e.origen==='haku');
      assert.equal(audit.length,1);
      assert.equal(audit[0].datos_contexto.operacion_id,result.operacion_id);
      assert.ok(audit[0].cambios.some(c=>c.campo==='motivo_cancelacion'&&c.nuevo==='Huésped desistió'));
      checks++;
    });

    for(const amount of [10000,30000]) await scenario(async()=>{
      const x=await seed({normal:true});await payment(x,amount);
      const expected=await snapshot(x.service);
      await rejectUnchanged(x.service,()=>call(x.service,expected),/aplicaciones de pago históricas/i);
    });

    await scenario(async()=>{
      const x=await seed({normal:true});
      await payment(x,10000);await payment(x,10000,'devolucion');
      const expected=await snapshot(x.service);
      assert.equal(Number(expected.cargo_aplicado_neto),0);
      await rejectUnchanged(x.service,()=>call(x.service,expected),/aplicaciones de pago históricas/i);
    });
    await scenario(async()=>{
      const x=await seed({normal:true});
      await db.query('insert into public.cargo_ajustes(cargo_id,monto) values($1,5000)',[x.activeId]);
      await rejectUnchanged(x.service,async()=>call(x.service,await snapshot(x.service)),/ajustes históricos/i);
    });
    await scenario(async()=>{
      const x=await seed({historic:true});
      await payment(x,5000,'pago',x.historicalId);
      await rejectUnchanged(x.service,async()=>call(x.service,await snapshot(x.service)),/aplicaciones de pago históricas/i);
    });
    await scenario(async()=>{
      const x=await seed();
      await db.query(`insert into public.cargos
        (reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,estado)
        values($1,$2,$3,'servicio','Cargo incoherente',30000,'activo')`,
        [x.reservation,x.stay,x.service]);
      await rejectUnchanged(x.service,async()=>call(x.service,await snapshot(x.service)),/cortesía o sus finanzas/i);
    });
    for(const problem of ['amount','identity','extra_active']) await scenario(async()=>{
      const x=await seed({normal:true,historic:true});
      if(problem==='amount') await db.query('update public.cargos set monto=29999 where id=$1',[x.activeId]);
      if(problem==='identity') {
        const other=randomUUID();
        await db.query("insert into public.reservas(id,titular_nombre) values($1,'Otra reserva')",[other]);
        await db.query('update public.cargos set reserva_id=$2 where id=$1',[x.historicalId,other]);
      }
      if(problem==='extra_active'){
        await db.exec('drop index public.cargos_servicio_activo_uidx');
        await db.query("update public.cargos set estado='activo' where id=$1",[x.historicalId]);
      }
      const patterns={amount:/cargo activo no coincide/i,identity:/historial de cargos/i,
        extra_active:/cargo activo no coincide/i};
      await rejectUnchanged(x.service,async()=>call(x.service,await snapshot(x.service)),patterns[problem]);
    });
    await scenario(async()=>{
      const x=await seed({state:'cancelado'}),before=await state(x.service);
      const result=await call(x.service,await snapshot(x.service));
      assert.equal(result.estado,'already_cancelled');
      const after=await state(x.service);
      assert.deepEqual(after.servicio,before.servicio);
      assert.deepEqual(after.cargos,before.cargos);
      assert.deepEqual(after.auditoria,before.auditoria);
      checks++;
    });
    for(const operational of ['realizado','no_show','en_proceso']) await scenario(async()=>{
      const x=await seed({state:operational});
      await rejectUnchanged(x.service,async()=>call(x.service,await snapshot(x.service)),/estado operativo/i);
    });
    await scenario(async()=>{
      const x=await seed();
      await db.query("update public.servicios set motivo_cancelacion='Motivo anterior',cancelado_en=now() where id=$1",[x.service]);
      await rejectUnchanged(x.service,async()=>call(x.service,await snapshot(x.service)),/cancelación previa/i);
    });
    for(const reservationState of ['checked_out','cancelada','no_show']) await scenario(async()=>{
      const x=await seed({reservationState});
      await rejectUnchanged(x.service,async()=>call(x.service,await snapshot(x.service)),/cerró o hizo check-out/i);
    });
    await scenario(async()=>{
      const x=await seed({checkout:true});
      await rejectUnchanged(x.service,async()=>call(x.service,await snapshot(x.service)),/cerró o hizo check-out/i);
    });
    await scenario(async()=>{
      const x=await seed({normal:true,bove:'BOVE-123'});
      await rejectUnchanged(x.service,async()=>call(x.service,await snapshot(x.service)),/BOVE de checkout/i);
      assert.equal((await db.query('select bove_checkout from public.reservas where id=$1',[x.reservation])).rows[0].bove_checkout,'BOVE-123');
    });
    for(const reason of ['', '   ', null]) await scenario(async()=>{
      const x=await seed();
      await rejectUnchanged(x.service,async()=>call(x.service,await snapshot(x.service),{reason}),/requiere un motivo/i);
    });
    await scenario(async()=>{
      const x=await seed({normal:true}),old=await snapshot(x.service);
      await db.query('update public.cargos set monto=29999 where id=$1',[x.activeId]);
      await rejectUnchanged(x.service,()=>call(x.service,old),/obsoleta/i);
    });
    await scenario(async()=>{
      const x=await seed({normal:true}),op=randomUUID(),expected=await snapshot(x.service);
      const first=await call(x.service,expected,{op,reason:'  Motivo exacto  '});
      const after=await state(x.service);
      const second=await call(x.service,expected,{op,reason:'  Motivo exacto  '});
      assert.equal(second.reintento,true);
      assert.equal(second.servicio_id,first.servicio_id);
      assert.deepEqual((await state(x.service)).auditoria,after.auditoria);
      assert.equal(after.servicio.motivo_cancelacion,'  Motivo exacto  ');
      await rejectUnchanged(x.service,()=>call(x.service,expected,{op,reason:'Motivo distinto'}),/otra solicitud/i);
      checks++;
    });
    await scenario(async()=>{
      const x=await seed({normal:true}),expected=await snapshot(x.service);
      await db.exec('drop trigger servicios_sincronizar_cargo on public.servicios');
      await rejectUnchanged(x.service,()=>call(x.service,expected),/postcondición del cargo/i);
    });
    await scenario(async()=>{
      const x=await seed({normal:true}),expected=await snapshot(x.service);
      await db.exec('drop trigger auditoria_servicios on public.servicios');
      await rejectUnchanged(x.service,()=>call(x.service,expected),/auditoría/i);
    });
    await scenario(async()=>{
      const x=await seed({normal:true,bove:'BOVE-LEGADO'});
      const {rows}=await db.query('select public.haiku_cancelar_servicio($1,$2) result',
        [x.service,'  Motivo manual  ']);
      assert.equal(rows[0].result.estado,'cancelado');
      const after=await state(x.service);
      assert.equal(after.servicio.motivo_cancelacion,'Motivo manual');
      assert.equal(after.cargos[0].estado,'anulado');
      assert.equal((await db.query('select bove_checkout from public.reservas where id=$1',
        [x.reservation])).rows[0].bove_checkout,null);
      checks++;
    });
    await scenario(async()=>{
      const x=await seed({normal:true}),expected=await snapshot(x.service);
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await rejectUnchanged(x.service,()=>call(x.service,expected),/iniciar sesión/i);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
      await db.query("select set_config('test.servicios_cancelar','false',false)");
      await rejectUnchanged(x.service,()=>call(x.service,expected),/permiso/i);
      await db.query("select set_config('test.servicios_cancelar','true',false)");
    });

    console.log(`PASS: ${checks} escenarios PostgreSQL efímero de cancelación asistida.`);
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
