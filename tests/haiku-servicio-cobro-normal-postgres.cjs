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
    await db.exec(read('tests/fixtures/servicio-cobro-normal-schema.sql'));
    await db.exec(read('supabase/migrations/20260923002858_haiku_cambiar_servicio_a_cobro_normal_v1.sql'));
    const signature = 'public.haiku_cambiar_servicio_a_cobro_normal_v1(uuid,uuid,smallint,jsonb)';
    const security = (await db.query(`select p.prosecdef, p.proconfig,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
      has_function_privilege('anon',p.oid,'EXECUTE') anon,
      p.proacl::text acl
      from pg_proc p where p.oid=$1::regprocedure`, [signature])).rows[0];
    assert.equal(security.prosecdef, true);
    assert.ok(security.proconfig.includes('search_path=pg_catalog, public, private'));
    assert.equal(security.authenticated, true);
    assert.equal(security.anon, false);
    assert.doesNotMatch(security.acl, /(?:^|\{)"?=X/i);
    checks++;
    const usuario = randomUUID();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [usuario]);

    async function scenario(fn) {
      await db.exec('begin');
      try { await fn(); } finally { await db.exec('rollback'); }
    }

    async function seed({ kind = 'tinajaTonel', quantity = 1, courtesy = true,
      historical = false, bove = null, persons = 1 } = {}) {
      const reservation = randomUUID(), stay = randomUUID();
      const catalog = randomUUID(), service = randomUUID();
      const jacuzzi = kind === 'tinajaJacuzzi';
      const hourly = 30000 + Math.max(0, persons - 3) * (jacuzzi ? 10000 : 0);
      await db.query('insert into public.reservas(id,titular_nombre) values($1,$2)',
        [reservation, 'Persona de prueba']);
      await db.query('insert into public.reserva_estadias(id,reserva_id) values($1,$2)',
        [stay, reservation]);
      await db.query(`insert into public.catalogo_servicios
        (id,codigo,nombre,activo,permite_cortesia,unidad,precio_base,
         capacidad_incluida,capacidad_maxima,precio_persona_adicional)
         values($1,$2,$3,true,true,'hora',30000,3,$4,$5)`,
        [catalog, kind, jacuzzi ? 'Tinaja Jacuzzi' : 'Tinaja Tonel de Madera',
          jacuzzi ? 5 : 3, jacuzzi ? 10000 : null]);
      await db.query(`insert into public.servicios
        (id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,
         hora_inicio,hora_fin,cantidad,personas,precio_unitario_aplicado,
         monto_adicional,total,tipo_cobro,motivo_cortesia,
         motivo_ajuste_precio,observaciones,creado_por)
         values($1,$2,$3,$4,'2026-09-12','20:45','21:45',$5,$6,$7,$8,$9,$10,$11,$12,'observación conservada',$13)`,
        [service, reservation, stay, catalog, quantity, persons,
          courtesy ? 0 : 30000,
          courtesy ? 0 : quantity * (hourly - 30000),
          courtesy ? 0 : quantity * hourly,
          courtesy ? 'cortesia' : 'normal',
          courtesy ? 'Cortesía original' : null,
          courtesy ? 'precio manual previo' : null, usuario]);
      let historic = null;
      if (historical) {
        historic = randomUUID();
        await db.query(`insert into public.cargos
          (id,reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,estado)
          values($1,$2,$3,$4,'servicio','Tinaja anterior',30000,'anulado')`,
          [historic, reservation, stay, service]);
      }
      if (bove !== null) {
        await db.query('update public.reservas set bove_checkout=$2 where id=$1',
          [reservation, bove]);
      }
      return { reservation, stay, catalog, service, historic };
    }

    async function snapshot(service) {
      const { rows } = await db.query(`select jsonb_build_object(
        'version',1,'servicio_id',s.id,'servicio_actualizado_en',s.actualizado_en,
        'catalogo_servicio_id',cs.id,'catalogo_codigo',cs.codigo,
        'catalogo_activo',cs.activo,
        'catalogo_permite_cortesia',cs.permite_cortesia,
        'catalogo_unidad',cs.unidad,
        'precio_base',cs.precio_base,'capacidad_incluida',cs.capacidad_incluida,
        'capacidad_maxima',cs.capacidad_maxima,
        'precio_persona_adicional',cs.precio_persona_adicional,
        'cantidad',s.cantidad,'personas',s.personas,
        'tipo_cobro',s.tipo_cobro,'total',s.total,
        'estado_servicio',s.estado_servicio,
        'estado_reserva',r.estado_reserva,'bove_checkout',r.bove_checkout,
        'cargos',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb)
                  from public.cargos c where c.servicio_id=s.id),
        'cantidad_cargos_activos',(select count(*) from public.cargos c
                                    where c.servicio_id=s.id and c.estado='activo'),
        'cantidad_aplicaciones',(select count(*) from public.pago_aplicaciones pa
          join public.cargos c on c.id=pa.cargo_id where c.servicio_id=s.id),
        'cantidad_ajustes',(select count(*) from public.cargo_ajustes ca
          join public.cargos c on c.id=ca.cargo_id where c.servicio_id=s.id)
      ) estado from public.servicios s
      join public.reservas r on r.id=s.reserva_id
      join public.catalogo_servicios cs on cs.id=s.catalogo_servicio_id
      where s.id=$1`, [service]);
      return rows[0].estado;
    }

    async function call(service, persons, expected, op = randomUUID()) {
      const { rows } = await db.query(
        'select public.haiku_cambiar_servicio_a_cobro_normal_v1($1,$2,$3::smallint,$4::jsonb) resultado',
        [op, service, persons, JSON.stringify(expected)]);
      return rows[0].resultado;
    }

    async function state(service) {
      const { rows } = await db.query(`select jsonb_build_object(
        'servicio',(select to_jsonb(s) from public.servicios s where s.id=$1),
        'cargos',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb)
                  from public.cargos c where c.servicio_id=$1),
        'aplicaciones',(select coalesce(jsonb_agg(to_jsonb(pa)),'[]'::jsonb)
          from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id
          where c.servicio_id=$1),
        'ajustes',(select coalesce(jsonb_agg(to_jsonb(ca)),'[]'::jsonb)
          from public.cargo_ajustes ca join public.cargos c on c.id=ca.cargo_id
          where c.servicio_id=$1),
        'auditoria',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb)
          from public.eventos_auditoria e where e.entidad_id=$1),
        'operaciones',(select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb)
          from private.haiku_servicio_cobro_normal_operaciones_v1 o
          where o.servicio_id=$1)) estado`, [service]);
      return rows[0].estado;
    }

    async function rejectsUnchanged(service, fn, pattern) {
      const before = await state(service);
      await db.exec('savepoint rpc_attempt');
      let error;
      try { await fn(); } catch (e) { error = e; }
      await db.exec('rollback to savepoint rpc_attempt');
      assert.ok(error, 'La llamada debía fallar');
      assert.match(String(error.message || error), pattern);
      assert.deepEqual(await state(service), before);
    }

    for (const [kind, quantity, persons, total] of [
      ['tinajaTonel',1,1,30000], ['tinajaTonel',1,2,30000],
      ['tinajaTonel',1,3,30000], ['tinajaJacuzzi',1,1,30000],
      ['tinajaJacuzzi',1,3,30000], ['tinajaJacuzzi',1,4,40000],
      ['tinajaJacuzzi',1,5,50000], ['tinajaJacuzzi',2,4,80000],
      ['tinajaJacuzzi',2,5,100000]
    ]) await scenario(async () => {
      const x = await seed({ kind, quantity });
      const result = await call(x.service, persons, await snapshot(x.service));
      assert.equal(result.estado, 'changed_to_normal');
      assert.equal(Number(result.total), total);
      assert.equal(Number(result.precio_unitario_aplicado), 30000);
      assert.equal(Number(result.monto_adicional), total - quantity * 30000);
      const after = await state(x.service);
      assert.equal(after.servicio.tipo_cobro, 'normal');
      assert.equal(after.servicio.personas, persons);
      assert.equal(Number(after.servicio.total), total);
      assert.equal(after.servicio.motivo_cortesia, null);
      assert.equal(after.servicio.motivo_ajuste_precio, null);
      assert.equal(after.servicio.observaciones, 'observación conservada');
      assert.equal(after.cargos.length, 1);
      assert.equal(after.cargos[0].estado, 'activo');
      assert.equal(Number(after.cargos[0].monto), total);
      const audit = after.auditoria.filter(e => e.origen === 'haku');
      assert.equal(audit.length, 1);
      assert.equal(audit[0].datos_contexto.operacion_id, result.operacion_id);
      checks++;
    });

    for (const [kind, persons] of [['tinajaTonel',4],['tinajaJacuzzi',6],
      ['tinajaTonel',0],['tinajaJacuzzi',null]]) await scenario(async () => {
      const x = await seed({ kind });
      const expected = await snapshot(x.service);
      await rejectsUnchanged(x.service,
        () => call(x.service, persons, expected),
        /personas|cantidad válida/i);
      checks++;
    });

    await scenario(async () => {
      const x = await seed({ historical: true, bove: 'BOVE-123' });
      const before = await state(x.service);
      const result = await call(x.service, 2, await snapshot(x.service));
      const after = await state(x.service);
      assert.equal(after.cargos.length, 2);
      assert.deepEqual(after.cargos.find(c => c.id === x.historic), before.cargos[0]);
      assert.notEqual(result.cargo_id, x.historic);
      assert.equal(after.cargos.find(c => c.id === result.cargo_id).estado, 'activo');
      assert.equal(result.bove_checkout_anterior, 'BOVE-123');
      assert.equal(result.bove_checkout_invalidado, true);
      assert.equal((await db.query('select bove_checkout from public.reservas where id=$1',
        [x.reservation])).rows[0].bove_checkout, null);
      checks++;
    });

    for (const problem of ['application','adjustment','active','identity']) await scenario(async () => {
      const x = await seed({ historical: true });
      if (problem === 'application') {
        const payment = randomUUID();
        await db.query("insert into public.pagos(id,reserva_id,monto,tipo_movimiento) values($1,$2,10000,'pago')",
          [payment, x.reservation]);
        await db.query('insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,10000)',
          [payment, x.historic]);
      }
      if (problem === 'adjustment') await db.query(
        'insert into public.cargo_ajustes(cargo_id,monto) values($1,5000)', [x.historic]);
      if (problem === 'active') await db.query(
        "update public.cargos set estado='activo' where id=$1", [x.historic]);
      if (problem === 'identity') {
        const other = randomUUID();
        await db.query('insert into public.reservas(id,titular_nombre) values($1,$2)', [other,'Otra']);
        await db.query('update public.cargos set reserva_id=$2 where id=$1', [x.historic,other]);
      }
      const patterns = { application:/aplicaciones de pago históricas/i,
        adjustment:/ajustes históricos/i, active:/finanzas requieren revisión humana/i,
        identity:/historial de cargos requiere revisión humana/i };
      const expected = await snapshot(x.service);
      await rejectsUnchanged(x.service,
        () => call(x.service, 2, expected), patterns[problem]);
      checks++;
    });

    await scenario(async () => {
      const x = await seed({ courtesy: false, persons: 4, kind: 'tinajaJacuzzi' });
      const before = await state(x.service);
      const result = await call(x.service, 4, await snapshot(x.service));
      assert.equal(result.estado, 'already_normal');
      assert.equal(result.sin_cambios, true);
      const after = await state(x.service);
      assert.deepEqual(after.servicio, before.servicio);
      assert.deepEqual(after.cargos, before.cargos);
      assert.deepEqual(after.auditoria, before.auditoria);
      checks++;
    });

    await scenario(async () => {
      const x = await seed({ courtesy: false });
      await db.query("update public.cargos set monto=29999 where servicio_id=$1 and estado='activo'",
        [x.service]);
      const expected = await snapshot(x.service);
      await rejectsUnchanged(x.service,
        () => call(x.service, 1, expected), /revisión financiera humana/i);
      checks++;
    });

    await scenario(async () => {
      const x = await seed();
      const old = await snapshot(x.service);
      await db.query('update public.catalogo_servicios set precio_base=35000 where id=$1',
        [x.catalog]);
      await rejectsUnchanged(x.service, () => call(x.service, 2, old), /obsoleta/i);
      checks++;
    });

    await scenario(async () => {
      const x = await seed();
      await db.query('update public.catalogo_servicios set precio_base=35000 where id=$1',
        [x.catalog]);
      const expected = await snapshot(x.service);
      await rejectsUnchanged(x.service,
        () => call(x.service, 2, expected), /configuración de personas del catálogo/i);
      checks++;
    });

    await scenario(async () => {
      const x = await seed();
      const op = randomUUID(), expected = await snapshot(x.service);
      const first = await call(x.service, 2, expected, op);
      const second = await call(x.service, 2, expected, op);
      assert.equal(second.reintento, true);
      assert.equal(second.cargo_id, first.cargo_id);
      assert.equal((await state(x.service)).cargos.length, 1);
      await rejectsUnchanged(x.service,
        () => call(x.service, 3, expected, op), /otra solicitud/i);
      checks += 2;
    });

    await scenario(async () => {
      const x = await seed();
      const expected = await snapshot(x.service);
      await db.exec('drop trigger servicios_sincronizar_cargo on public.servicios');
      await rejectsUnchanged(x.service,
        () => call(x.service, 2, expected), /postcondición del cargo/i);
      checks++;
    });

    await scenario(async () => {
      const x = await seed(), expected = await snapshot(x.service);
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await rejectsUnchanged(x.service, () => call(x.service,2,expected), /iniciar sesión/i);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [usuario]);
      await db.query("select set_config('test.servicios_editar','false',false)");
      await rejectsUnchanged(x.service, () => call(x.service,2,expected), /permiso/i);
      await db.query("select set_config('test.servicios_editar','true',false)");
      checks += 2;
    });

    console.log(`PASS: ${checks} escenarios PostgreSQL efímero de cortesía a cobro normal.`);
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
