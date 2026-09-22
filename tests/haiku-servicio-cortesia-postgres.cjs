const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = 'supabase/migrations/20260922141129_haiku_cambiar_servicio_a_cortesia_v1.sql';

(async () => {
  const db = new PGlite();
  let checks = 0;
  await db.exec(read('tests/fixtures/servicio-cortesia-schema.sql'));
  await db.exec(read(migration));

  const usuario = randomUUID();
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [usuario]);
  await db.query("select set_config('test.usuario_activo', 'true', false)");
  await db.query("select set_config('test.servicios_editar', 'true', false)");

  async function escenario(fn) {
    await db.exec('begin');
    try { await fn(); }
    finally { await db.exec('rollback'); }
  }

  async function sembrar({
    permite = true,
    tipo = 'normal',
    total = tipo === 'cortesia' ? 0 : 30000,
    estado = 'programado',
    estadoReserva = 'checked_out',
    bove = null,
    cargoHistorico = tipo === 'cortesia'
  } = {}) {
    const reserva = randomUUID(), estadia = randomUUID(), catalogo = randomUUID(), servicio = randomUUID();
    await db.query(
      'insert into public.reservas(id,titular_nombre,estado_reserva,bove_checkout) values($1,$2,$3,$4)',
      [reserva, 'Luis Ortiz', estadoReserva, bove]
    );
    await db.query('insert into public.reserva_estadias(id,reserva_id) values($1,$2)', [estadia, reserva]);
    await db.query(
      'insert into public.catalogo_servicios(id,codigo,nombre,permite_cortesia) values($1,$2,$3,$4)',
      [catalogo, `tinajaTonel-${catalogo}`, 'Tinaja Tonel de Madera', permite]
    );
    await db.query(`insert into public.servicios(
      id,reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,hora_inicio,hora_fin,
      cantidad,personas,precio_unitario_aplicado,monto_adicional,total,tipo_cobro,
      motivo_cortesia,estado_servicio,observaciones,creado_por
    ) values($1,$2,$3,$4,'2026-09-12','20:45','21:45',1,1,30000,0,$5,$6,$7,$8,'origen estable',$9)`,
      [servicio, reserva, estadia, catalogo, total, tipo,
       tipo === 'cortesia' ? 'Cortesía ya registrada' : null, estado, usuario]
    );
    if (cargoHistorico) {
      await db.query(`insert into public.cargos(
        reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,estado,creado_por
      ) values($1,$2,$3,'servicio','Tinaja Tonel de Madera',30000,'anulado',$4)`,
        [reserva, estadia, servicio, usuario]
      );
    }
    const cargo = (await db.query(
      "select id from public.cargos where servicio_id=$1 and estado='activo'", [servicio]
    )).rows[0]?.id || null;
    if (bove !== null) {
      // Simula un folio emitido después de crear/cobrar el servicio.
      await db.query('update public.reservas set bove_checkout=$2 where id=$1', [reserva, bove]);
    }
    return { reserva, estadia, catalogo, servicio, cargo };
  }

  async function snapshot(servicio) {
    const result = await db.query(`
      with base as (
        select s.*,r.estado_reserva,r.bove_checkout
        from public.servicios s join public.reservas r on r.id=s.reserva_id
        where s.id=$1
      ), activos as (
        select c.*,ec.aplicado_neto,ec.saldo_cargo
        from public.cargos c left join public.vista_estado_cargos ec on ec.cargo_id=c.id
        where c.servicio_id=$1 and c.estado='activo' order by c.id
      )
      select jsonb_build_object(
        'version',1,
        'servicio_id',b.id,
        'servicio_actualizado_en',b.actualizado_en,
        'tipo_cobro',b.tipo_cobro,
        'total',b.total,
        'estado_servicio',b.estado_servicio,
        'estado_reserva',b.estado_reserva,
        'bove_checkout',b.bove_checkout,
        'cargo_id',case when (select count(*) from activos)=1 then (select id from activos limit 1) end,
        'cargo_estado',case when (select count(*) from activos)=1 then (select estado from activos limit 1) end,
        'cargo_monto',case when (select count(*) from activos)=1 then (select monto from activos limit 1) end,
        'cargo_actualizado_en',case when (select count(*) from activos)=1 then (select actualizado_en from activos limit 1) end,
        'aplicado_neto',case when (select count(*) from activos)=1 then (select aplicado_neto from activos limit 1) end,
        'saldo_cargo',case when (select count(*) from activos)=1 then (select saldo_cargo from activos limit 1) end,
        'cantidad_cargos',(select count(*) from public.cargos c where c.servicio_id=$1),
        'cantidad_cargos_activos',(select count(*) from activos),
        'cantidad_aplicaciones',(select count(*) from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where c.servicio_id=$1),
        'cantidad_ajustes',(select count(*) from public.cargo_ajustes ca join public.cargos c on c.id=ca.cargo_id where c.servicio_id=$1)
      ) estado
      from base b`, [servicio]
    );
    return result.rows[0].estado;
  }

  async function llamar(servicio, estadoEsperado, {
    operacion = randomUUID(),
    motivo = 'Atención de cortesía autorizada por administración'
  } = {}) {
    const result = await db.query(
      'select public.haiku_cambiar_servicio_a_cortesia_v1($1,$2,$3,$4::jsonb) resultado',
      [operacion, servicio, motivo, JSON.stringify(estadoEsperado)]
    );
    return result.rows[0].resultado;
  }

  async function estadoDatos(servicio) {
    return (await db.query(`select jsonb_build_object(
      'servicio',(select to_jsonb(s) from public.servicios s where s.id=$1),
      'cargos',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.cargos c where c.servicio_id=$1),
      'aplicaciones',(select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id),'[]') from public.pago_aplicaciones pa join public.cargos c on c.id=pa.cargo_id where c.servicio_id=$1),
      'ajustes',(select coalesce(jsonb_agg(to_jsonb(ca) order by ca.id),'[]') from public.cargo_ajustes ca join public.cargos c on c.id=ca.cargo_id where c.servicio_id=$1),
      'auditoria',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from public.eventos_auditoria e where e.entidad_id=$1),
      'operaciones',(select coalesce(jsonb_agg(to_jsonb(o) order by o.operacion_id),'[]') from private.haiku_servicio_cortesia_operaciones_v1 o where o.servicio_id=$1)
    ) estado`, [servicio])).rows[0].estado;
  }

  async function rechazaSinCambios(servicio, accion, patron) {
    const antes = await estadoDatos(servicio);
    await db.exec('savepoint llamada_rpc');
    let error = null;
    try { await accion(); }
    catch (e) { error = e; }
    await db.exec('rollback to savepoint llamada_rpc');
    assert.ok(error, 'La llamada debía fallar');
    assert.match(String(error.message || error), patron);
    assert.deepEqual(await estadoDatos(servicio), antes);
  }

  // A + N: éxito limpio aun con reserva checked_out.
  await escenario(async () => {
    const x = await sembrar();
    const esperado = await snapshot(x.servicio);
    const resultado = await llamar(x.servicio, esperado);
    assert.equal(resultado.estado, 'changed_to_courtesy');
    assert.equal(resultado.estado_reserva, 'checked_out');
    assert.equal(resultado.total, 0);
    const servicio = (await db.query('select * from public.servicios where id=$1', [x.servicio])).rows[0];
    assert.equal(servicio.tipo_cobro, 'cortesia');
    assert.equal(Number(servicio.total), 0);
    assert.equal(Number(servicio.precio_unitario_aplicado), 30000);
    const cargos = (await db.query('select estado,monto from public.cargos where servicio_id=$1', [x.servicio])).rows;
    assert.deepEqual(cargos.map(c => [c.estado, Number(c.monto)]), [['anulado', 30000]]);
    const auditoria = (await db.query("select * from public.eventos_auditoria where entidad_id=$1 and origen='haku'", [x.servicio])).rows;
    assert.equal(auditoria.length, 1);
    assert.ok(auditoria[0].cambios.some(c => c.campo === 'tipo_cobro' && c.anterior === 'normal' && c.nuevo === 'cortesia'));
    assert.equal(auditoria[0].datos_contexto.operacion_id, resultado.operacion_id);
    checks++;
  });

  // B: cortesía coherente es no-op.
  await escenario(async () => {
    const x = await sembrar({ tipo: 'cortesia' });
    const antes = await estadoDatos(x.servicio);
    const resultado = await llamar(x.servicio, await snapshot(x.servicio));
    assert.equal(resultado.estado, 'already_courtesy');
    assert.equal(resultado.sin_cambios, true);
    const despues = await estadoDatos(x.servicio);
    assert.deepEqual(despues.servicio, antes.servicio);
    assert.deepEqual(despues.cargos, antes.cargos);
    checks++;
  });

  // Un servicio que dice cortesía pero conserva un cargo activo no es no-op.
  await escenario(async () => {
    const x = await sembrar({ tipo: 'cortesia' });
    await db.query(`insert into public.cargos(
      reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,estado,creado_por
    ) values($1,$2,$3,'servicio','Tinaja Tonel de Madera',30000,'activo',$4)`,
      [x.reserva, x.estadia, x.servicio, usuario]);
    const esperado = await snapshot(x.servicio);
    await rechazaSinCambios(
      x.servicio,
      () => llamar(x.servicio, esperado),
      /finanzas requieren revisión humana/i
    );
    checks++;
  });

  async function agregarAplicacion(x, monto, tipo = 'pago') {
    const pago = randomUUID();
    await db.query(
      "insert into public.pagos(id,reserva_id,monto,tipo_movimiento,estado) values($1,$2,$3,$4,'confirmado')",
      [pago, x.reserva, monto, tipo]
    );
    await db.query('insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,$3)',
      [pago, x.cargo, monto]);
  }

  // C, D y E: cualquier aplicación histórica bloquea, incluso con neto cero.
  for (const caso of ['parcial', 'total', 'neto_cero']) await escenario(async () => {
    const x = await sembrar();
    if (caso === 'parcial') await agregarAplicacion(x, 10000);
    if (caso === 'total') await agregarAplicacion(x, 30000);
    if (caso === 'neto_cero') {
      await agregarAplicacion(x, 10000, 'pago');
      await agregarAplicacion(x, 10000, 'devolucion');
    }
    const esperado = await snapshot(x.servicio);
    await rechazaSinCambios(x.servicio, () => llamar(x.servicio, esperado), /aplicaciones de pago históricas/i);
    checks++;
  });

  // F: ajuste histórico bloquea.
  await escenario(async () => {
    const x = await sembrar();
    await db.query('insert into public.cargo_ajustes(cargo_id,monto) values($1,5000)', [x.cargo]);
    const esperado = await snapshot(x.servicio);
    await rechazaSinCambios(x.servicio, () => llamar(x.servicio, esperado), /ajustes históricos/i);
    checks++;
  });

  // G: catálogo sin cortesía.
  await escenario(async () => {
    const x = await sembrar({ permite: false });
    const esperado = await snapshot(x.servicio);
    await rechazaSinCambios(x.servicio, () => llamar(x.servicio, esperado), /no permite cortesía/i);
    checks++;
  });

  // H: motivo vacío.
  await escenario(async () => {
    const x = await sembrar();
    const esperado = await snapshot(x.servicio);
    await rechazaSinCambios(x.servicio, () => llamar(x.servicio, esperado, { motivo: '   ' }), /requiere un motivo/i);
    checks++;
  });

  // I: servicio normal sin cargo activo.
  await escenario(async () => {
    const x = await sembrar();
    await db.query("update public.cargos set estado='anulado' where id=$1", [x.cargo]);
    const esperado = await snapshot(x.servicio);
    await rechazaSinCambios(x.servicio, () => llamar(x.servicio, esperado), /exactamente un cargo activo/i);
    checks++;
  });

  // J: más de un cargo activo, aun si una restricción externa fue retirada.
  await escenario(async () => {
    const x = await sembrar();
    await db.exec('drop index public.cargos_servicio_activo_uidx');
    await db.query(`insert into public.cargos(
      reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,estado
    ) values($1,$2,$3,'servicio','Duplicado',30000,'activo')`, [x.reserva, x.estadia, x.servicio]);
    const esperado = await snapshot(x.servicio);
    await rechazaSinCambios(x.servicio, () => llamar(x.servicio, esperado), /exactamente un cargo activo/i);
    checks++;
  });

  // K: snapshot obsoleto no modifica nada.
  await escenario(async () => {
    const x = await sembrar();
    const esperado = await snapshot(x.servicio);
    esperado.total = 29999;
    await rechazaSinCambios(x.servicio, () => llamar(x.servicio, esperado), /propuesta quedó obsoleta/i);
    checks++;
  });

  // L y M: retry idéntico es idempotente; operation_id con payload distinto falla.
  await escenario(async () => {
    const x = await sembrar();
    const operacion = randomUUID(), esperado = await snapshot(x.servicio);
    const primero = await llamar(x.servicio, esperado, { operacion });
    const segundo = await llamar(x.servicio, esperado, { operacion });
    assert.equal(segundo.reintento, true);
    assert.equal(segundo.estado, primero.estado);
    assert.equal(Number((await db.query("select count(*) n from public.eventos_auditoria where entidad_id=$1 and origen='haku'", [x.servicio])).rows[0].n), 1);
    await db.exec('savepoint payload_distinto');
    let error = null;
    try { await llamar(x.servicio, esperado, { operacion, motivo: 'Otro motivo' }); }
    catch (e) { error = e; }
    await db.exec('rollback to savepoint payload_distinto');
    assert.match(String(error?.message), /otra solicitud/i);
    checks += 2;
  });

  // BOVE: el resultado informa la invalidación producida por el trigger oficial.
  await escenario(async () => {
    const x = await sembrar({ bove: '17003' });
    const resultado = await llamar(x.servicio, await snapshot(x.servicio));
    assert.equal(resultado.bove_checkout_anterior, '17003');
    assert.equal(resultado.bove_checkout_invalidado, true);
    assert.equal((await db.query('select bove_checkout from public.reservas where id=$1', [x.reserva])).rows[0].bove_checkout, null);
    checks++;
  });

  // O: si el trigger financiero no cumple, la postcondición aborta y revierte.
  await escenario(async () => {
    const x = await sembrar();
    const esperado = await snapshot(x.servicio);
    await db.exec('drop trigger servicios_sincronizar_cargo on public.servicios');
    await rechazaSinCambios(x.servicio, () => llamar(x.servicio, esperado), /postcondición del cargo/i);
    checks++;
  });

  // Autenticación, usuario activo y permiso se validan antes de cualquier efecto.
  await escenario(async () => {
    const x = await sembrar(), esperado = await snapshot(x.servicio);
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await rechazaSinCambios(x.servicio, () => llamar(x.servicio, esperado), /iniciar sesión/i);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [usuario]);
    await db.query("select set_config('test.servicios_editar','false',false)");
    await rechazaSinCambios(x.servicio, () => llamar(x.servicio, esperado), /permiso para editar servicios/i);
    await db.query("select set_config('test.servicios_editar','true',false)");
    await db.query("select set_config('test.usuario_activo','false',false)");
    await rechazaSinCambios(x.servicio, () => llamar(x.servicio, esperado), /Usuario no activo/i);
    await db.query("select set_config('test.usuario_activo','true',false)");
    checks += 3;
  });

  console.log(`PASS: ${checks} escenarios PostgreSQL efímero; cortesía atómica, historial, idempotencia, BOVE, auditoría y rollback.`);
  await db.close();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
