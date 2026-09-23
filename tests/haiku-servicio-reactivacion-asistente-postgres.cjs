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
    await db.exec(read('tests/fixtures/servicio-reactivacion-asistente-schema.sql'));
    await db.exec(read('supabase/migrations/20260923035510_haiku_cancelar_servicio_asistente_v1.sql'));
    await db.exec(read('supabase/migrations/20260923054859_haiku_reactivar_servicio_asistente_v1.sql'));

    async function one(sql, params = []) {
      return (await db.query(sql, params)).rows[0];
    }
    const signature = 'public.haiku_reactivar_servicio_asistente_v1(uuid,uuid,jsonb)';
    const security = await one("select p.prosecdef,p.proconfig,p.proacl::text acl, has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated, has_function_privilege('anon',p.oid,'EXECUTE') anon from pg_proc p where p.oid=$1::regprocedure", [signature]);
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
    async function seed({normal = true, cancelled = true, state = 'programado',
      reservationState = 'confirmada', stayState = 'confirmada',
      resourceId = null, historic = 0} = {}) {
      const reservation = randomUUID(), stay = randomUUID();
      let catalog = randomUUID();
      const service = randomUUID();
      const resource = resourceId || randomUUID();
      await db.query('insert into public.reservas(id,titular_nombre,estado_reserva) values($1,$2,$3)',
        [reservation, 'Sebastián Gatta', reservationState]);
      await db.query('insert into public.reserva_estadias(id,reserva_id,estado_estadia) values($1,$2,$3)',
        [stay, reservation, stayState]);
      if (!resourceId) await db.query('insert into public.recursos_servicio(id,nombre) values($1,$2)',
        [resource, 'Tinaja Tonel de Madera']);
      catalog = (await one("insert into public.catalogo_servicios(id,codigo,nombre,activo,permite_cortesia,requiere_horario) values($1,'tinajaTonel','Tinaja Tonel de Madera',true,true,true) on conflict (codigo) do update set nombre=excluded.nombre returning id", [catalog])).id;
      await db.query("insert into public.servicios(id,reserva_id,estadia_id,catalogo_servicio_id,recurso_id,fecha_servicio,hora_inicio,hora_fin,cantidad,personas,precio_unitario_aplicado,total,tipo_cobro,motivo_cortesia,estado_servicio,creado_por) values($1,$2,$3,$4,$5,current_date+7,'22:15','23:15',1,2,$6,$7,$8,$9,$10,$11)",
        [service,reservation,stay,catalog,resource,normal ? 30000 : 0,
          normal ? 30000 : 0,normal ? 'normal' : 'cortesia',
          normal ? null : 'Cortesía original',state,user]);
      const originalCargo = (await one("select id from public.cargos where servicio_id=$1 and estado='activo'", [service]))?.id || null;
      if (cancelled) await db.query("update public.servicios set estado_servicio='cancelado',cancelado_en=now(),cancelado_por=$2,motivo_cancelacion='Prueba' where id=$1", [service,user]);
      for (let i=0;i<historic;i++) await db.query("insert into public.cargos(reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,estado) values($1,$2,$3,'servicio','Cargo anterior',30000,'anulado')", [reservation,stay,service]);
      return {reservation,stay,catalog,resource,service,originalCargo};
    }
    async function snapshot(service) {
      return (await one('select private.haiku_reactivacion_estado_prueba($1) estado',[service])).estado;
    }
    async function cancelSnapshot(service) {
      return (await one('select private.haiku_cancelacion_estado_prueba($1) estado',[service])).estado;
    }
    async function reactivate(service, expected, op = randomUUID()) {
      return (await one('select public.haiku_reactivar_servicio_asistente_v1($1,$2,$3::jsonb) resultado',
        [op,service,JSON.stringify(expected)])).resultado;
    }
    async function cancel(service, expected, op = randomUUID()) {
      return (await one('select public.haiku_cancelar_servicio_asistente_v1($1,$2,$3,$4::jsonb) resultado',
        [op,service,'Segunda cancelación',JSON.stringify(expected)])).resultado;
    }
    async function state(x) {
      return (await one("select jsonb_build_object('servicio',(select to_jsonb(s) from public.servicios s where s.id=$1),'cargos',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from public.cargos c where c.servicio_id=$1),'aplicaciones',(select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id),'[]'::jsonb) from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where c.servicio_id=$1),'ajustes',(select coalesce(jsonb_agg(to_jsonb(ca) order by ca.id),'[]'::jsonb) from public.cargo_ajustes ca join public.cargos c on c.id=ca.cargo_id where c.servicio_id=$1),'pagos',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from public.pagos p where p.reserva_id=$2),'auditoria',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from public.eventos_auditoria e where e.entidad_id=$1),'operaciones',(select coalesce(jsonb_agg(to_jsonb(o) order by o.operacion_id),'[]'::jsonb) from private.haiku_reactivar_servicio_asistente_operaciones_v1 o where o.servicio_id=$1)) estado",
        [x.service,x.reservation])).estado;
    }
    async function rejectUnchanged(x, fn, pattern) {
      const before = await state(x);
      await db.exec('savepoint attempt');
      let error;
      try { await fn(); } catch (e) { error = e; }
      await db.exec('rollback to savepoint attempt');
      assert.ok(error, 'La llamada debía rechazarse');
      assert.match(String(error.message || error), pattern);
      assert.deepEqual(await state(x), before);
      checks++;
    }

    await scenario(async () => {
      const x=await seed(),before=await state(x);
      assert.equal(before.cargos.length,1);
      assert.equal(before.cargos[0].estado,'anulado');
      const result=await reactivate(x.service,await snapshot(x.service));
      const after=await state(x);
      assert.equal(result.estado,'reactivated');
      assert.equal(result.cargo_nuevo_id,after.cargos.find(c=>c.estado==='activo').id);
      assert.notEqual(result.cargo_nuevo_id,x.originalCargo);
      assert.equal(after.servicio.estado_servicio,'programado');
      assert.equal(after.servicio.tipo_cobro,'normal');
      assert.equal(Number(after.servicio.total),30000);
      assert.equal(after.servicio.cancelado_en,null);
      assert.equal(after.servicio.cancelado_por,null);
      assert.equal(after.servicio.motivo_cancelacion,null);
      assert.equal(after.cargos.length,2);
      assert.equal(after.cargos.find(c=>c.id===x.originalCargo).estado,'anulado');
      assert.equal(Number(after.cargos.find(c=>c.estado==='activo').monto),30000);
      assert.deepEqual(after.aplicaciones,before.aplicaciones);
      assert.deepEqual(after.ajustes,before.ajustes);
      assert.deepEqual(after.pagos,before.pagos);
      assert.equal(after.auditoria.filter(e=>e.origen==='haku').length,1);
      const restoreAudit=after.auditoria.find(e=>e.origen==='haku');
      assert.equal(restoreAudit.datos_contexto.operacion_id,result.operacion_id);
      assert.ok(restoreAudit.cambios.some(c=>c.campo==='estado_servicio'&&c.anterior==='cancelado'&&c.nuevo==='programado'));
      assert.ok(restoreAudit.cambios.some(c=>c.campo==='motivo_cancelacion'&&c.anterior==='Prueba'&&c.nuevo===null));
      assert.ok(after.auditoria.some(e=>e.cambios.some(c=>c.campo==='motivo_cancelacion'&&c.nuevo==='Prueba')));
      checks++;
    });
    await scenario(async()=>{
      const x=await seed({normal:false}),before=await state(x);
      const result=await reactivate(x.service,await snapshot(x.service));
      const after=await state(x);
      assert.equal(result.estado,'reactivated');
      assert.equal(result.cargo_nuevo_id,null);
      assert.equal(after.servicio.estado_servicio,'programado');
      assert.equal(after.servicio.tipo_cobro,'cortesia');
      assert.equal(Number(after.servicio.total),0);
      assert.deepEqual(after.cargos,before.cargos);
      checks++;
    });
    await scenario(async()=>{
      const x=await seed();
      await seed({cancelled:false,resourceId:x.resource});
      const result=await reactivate(x.service,await snapshot(x.service));
      assert.equal(result.ok,false);
      assert.equal(result.estado,'HORARIO_OCUPADO');
      assert.equal(result.conflictos.length,1);
      assert.equal((await state(x)).servicio.estado_servicio,'cancelado');
      checks++;
    });
    await scenario(async()=>{
      const x=await seed();
      const old=await snapshot(x.service);
      await seed({cancelled:false,resourceId:x.resource});
      const result=await reactivate(x.service,old);
      assert.equal(result.estado,'HORARIO_OCUPADO');
      checks++;
    });
    for(const other of ['no_show','otro_recurso']) await scenario(async()=>{
      const x=await seed();
      if(other==='no_show') await seed({cancelled:false,state:'no_show',resourceId:x.resource});
      else await seed({cancelled:false});
      const result=await reactivate(x.service,await snapshot(x.service));
      assert.equal(result.estado,'reactivated');
      checks++;
    });
    for(const kind of ['aplicacion','ajuste']) await scenario(async()=>{
      const x=await seed();
      if(kind==='aplicacion') {
        const pago=randomUUID();
        await db.query("insert into public.pagos(id,reserva_id,monto,tipo_movimiento) values($1,$2,5000,'pago')",[pago,x.reservation]);
        await db.query('insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,5000)',[pago,x.originalCargo]);
      } else await db.query('insert into public.cargo_ajustes(cargo_id,monto) values($1,5000)',[x.originalCargo]);
      await rejectUnchanged(x,async()=>reactivate(x.service,await snapshot(x.service)),kind==='aplicacion'?/aplicaciones de pago históricas/i:/ajustes históricos/i);
    });
    await scenario(async()=>{
      const x=await seed();
      await db.query("update public.cargos set estado='activo' where id=$1",[x.originalCargo]);
      await rejectUnchanged(x,async()=>reactivate(x.service,await snapshot(x.service)),/cargo activo inesperado/i);
    });
    for(const reservationState of ['checked_out','cancelada']) await scenario(async()=>{
      const x=await seed({reservationState});
      await rejectUnchanged(x,async()=>reactivate(x.service,await snapshot(x.service)),/reserva ya cerró/i);
    });
    await scenario(async()=>{
      const x=await seed();
      await db.query('update public.reserva_estadias set checkout_realizado_en=now() where id=$1',[x.stay]);
      await rejectUnchanged(x,async()=>reactivate(x.service,await snapshot(x.service)),/check-out/i);
    });
    for(const campo of ['bove_checkout','bove_cierre']) await scenario(async()=>{
      const x=await seed();
      await db.query('update public.reservas set '+campo+"='BOVE-123' where id=$1",[x.reservation]);
      await rejectUnchanged(x,async()=>reactivate(x.service,await snapshot(x.service)),/BOVE/i);
    });
    await scenario(async()=>{
      const x=await seed();
      await db.query('update public.servicios set fecha_servicio=current_date-1 where id=$1',[x.service]);
      await rejectUnchanged(x,async()=>reactivate(x.service,await snapshot(x.service)),/fecha del servicio ya pasó/i);
    });
    await scenario(async()=>{
      const x=await seed();
      await db.query('delete from public.eventos_auditoria where entidad_id=$1',[x.service]);
      await rejectUnchanged(x,async()=>reactivate(x.service,await snapshot(x.service)),/auditoría de la cancelación anterior/i);
    });
    await scenario(async()=>{
      const x=await seed();
      await db.query("update public.servicios set cancelado_en=cancelado_en+interval '1 second' where id=$1",[x.service]);
      await rejectUnchanged(x,async()=>reactivate(x.service,await snapshot(x.service)),/auditoría de la cancelación anterior/i);
    });
    await scenario(async()=>{
      const x=await seed({cancelled:false});
      const before=await state(x),result=await reactivate(x.service,await snapshot(x.service));
      assert.equal(result.estado,'already_active');
      const after=await state(x);
      assert.deepEqual(after.servicio,before.servicio);
      assert.deepEqual(after.cargos,before.cargos);
      checks++;
    });
    for(const operational of ['realizado','no_show','en_proceso']) await scenario(async()=>{
      const x=await seed({cancelled:false,state:operational});
      await rejectUnchanged(x,async()=>reactivate(x.service,await snapshot(x.service)),/estado operativo/i);
    });
    await scenario(async()=>{
      const x=await seed(),expected=await snapshot(x.service);
      await db.query('update public.servicios set personas=3 where id=$1',[x.service]);
      await rejectUnchanged(x,()=>reactivate(x.service,expected),/obsoleta/i);
    });
    await scenario(async()=>{
      const x=await seed(),expected=await snapshot(x.service),op=randomUUID();
      const first=await reactivate(x.service,expected,op),after=await state(x);
      const second=await reactivate(x.service,expected,op);
      assert.equal(second.reintento,true);
      assert.equal(second.cargo_nuevo_id,first.cargo_nuevo_id);
      assert.deepEqual((await state(x)).cargos,after.cargos);
      assert.equal(after.operaciones.length,1);
      await rejectUnchanged(x,()=>reactivate(x.service,{...expected,total:999},op),/otra solicitud/i);
      checks++;
    });
    for(const trigger of ['servicios_sincronizar_cargo','auditoria_servicios']) await scenario(async()=>{
      const x=await seed(),expected=await snapshot(x.service);
      await db.exec('drop trigger '+trigger+' on public.servicios');
      await rejectUnchanged(x,()=>reactivate(x.service,expected),trigger==='auditoria_servicios'?/auditoría/i:/postcondición del cargo nuevo/i);
    });
    await scenario(async()=>{
      const x=await seed();
      const otherCargo=randomUUID(),pago=randomUUID();
      await db.query("insert into public.cargos(id,reserva_id,estadia_id,tipo_cargo,concepto,monto) values($1,$2,$3,'alojamiento','Alojamiento',160000)",[otherCargo,x.reservation,x.stay]);
      await db.query("insert into public.pagos(id,reserva_id,monto,tipo_movimiento) values($1,$2,160000,'pago')",[pago,x.reservation]);
      await db.query('insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,160000)',[pago,otherCargo]);
      const before=await state(x);
      const result=await reactivate(x.service,await snapshot(x.service));
      assert.equal(result.estado,'reactivated');
      assert.deepEqual((await state(x)).pagos,before.pagos);
      checks++;
    });
    await scenario(async()=>{
      const x=await seed({historic:2}),before=await state(x);
      const result=await reactivate(x.service,await snapshot(x.service));
      const after=await state(x);
      assert.equal(result.estado,'reactivated');
      assert.equal(after.cargos.length,4);
      assert.equal(after.cargos.filter(c=>c.estado==='activo').length,1);
      for(const c of before.cargos) assert.deepEqual(after.cargos.find(a=>a.id===c.id),c);
      checks++;
    });
    await scenario(async()=>{
      const x=await seed({cancelled:false});
      const firstCancel=await cancel(x.service,await cancelSnapshot(x.service));
      assert.equal(firstCancel.estado,'cancelled');
      const firstCargo=x.originalCargo;
      assert.equal((await state(x)).cargos.find(c=>c.id===firstCargo).estado,'anulado');
      const restore=await reactivate(x.service,await snapshot(x.service));
      assert.equal(restore.estado,'reactivated');
      const nextCargo=restore.cargo_nuevo_id;
      assert.notEqual(nextCargo,firstCargo);
      const secondCancel=await cancel(x.service,await cancelSnapshot(x.service));
      const after=await state(x);
      assert.equal(secondCancel.estado,'cancelled');
      assert.equal(after.servicio.estado_servicio,'cancelado');
      assert.equal(after.cargos.length,2);
      assert.ok(after.cargos.every(c=>c.estado==='anulado'));
      assert.deepEqual(after.aplicaciones,[]);
      assert.deepEqual(after.ajustes,[]);
      checks++;
    });
    await scenario(async()=>{
      const x=await seed(),expected=await snapshot(x.service);
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await rejectUnchanged(x,()=>reactivate(x.service,expected),/iniciar sesión/i);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
      await db.query("select set_config('test.servicios_editar','false',false)");
      await rejectUnchanged(x,()=>reactivate(x.service,expected),/permiso/i);
      await db.query("select set_config('test.servicios_editar','true',false)");
      await db.query("select set_config('test.usuario_activo','false',false)");
      await rejectUnchanged(x,()=>reactivate(x.service,expected),/Usuario no activo/i);
      await db.query("select set_config('test.usuario_activo','true',false)");
    });

    console.log('PASS: '+checks+' escenarios PostgreSQL efímero de reactivación asistida.');
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
