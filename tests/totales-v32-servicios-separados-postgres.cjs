// PostgreSQL efímero PGlite; sólo fixtures sintéticos, sin conexión remota.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const init = require('./fixtures/total-v3-runtime.cjs');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migrationV31 = fs.readFileSync('supabase/migrations/20260910235134_haiku_total_financiero_v31_guard_servicios.sql', 'utf8');
const migrationV32 = fs.readFileSync('supabase/migrations/20260929194050_total_v32_servicios_separados.sql', 'utf8');

(async () => {
  const db = await init();
  await db.exec(migrationV31);
  await db.exec(migrationV32);
  const q = (sql, params = []) => db.query(sql, params);
  const one = async (sql, params = []) => (await q(sql, params)).rows[0];
  let checks = 0;

  const test = async (nombre, fn) => {
    await q('begin');
    try {
      await fn();
      checks++;
      console.log(`OK ${nombre}`);
    } finally {
      await q('rollback');
    }
  };

  const crearAlojamiento = async (n, { tarifa = 160000, iva = false } = {}) => {
    const reservaId = id(n), estadiaId = id(1000 + n), cabanaId = id(2000 + n);
    await q('insert into public.cabanas(id,numero,activa,precio_base) values($1,$2,true,$3)', [cabanaId, n, tarifa]);
    await q("insert into public.reservas(id,titular_nombre,estado_reserva,titular_numero_documento,bove_cierre,bove_checkout) values($1,$2,'confirmada','11.111.111-1','BOVE-CIERRE','BOVE-CHECKOUT')", [reservaId, `Titular ${n}`]);
    await q("insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia) values($1,$2,$3,'2026-10-10','2026-10-12','alojamiento','confirmada')", [estadiaId, reservaId, cabanaId]);
    await q("insert into public.estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) values($1,'2026-10-10',$2,'manual'),($1,'2026-10-11',$2,'manual')", [estadiaId, tarifa]);
    if (iva) await q("select public.haiku_aplicar_ajuste_reserva($1,'iva_exento',null)", [reservaId]);
    const cargos = (await q("select id from public.cargos where reserva_id=$1 and tipo_cargo='alojamiento' order by creado_en,id", [reservaId])).rows.map(fila => fila.id);
    return { reservaId, estadiaId, cargos };
  };

  const crearFullDay = async (n, { tarifa = 160000 } = {}) => {
    const reservaId = id(n), estadiaId = id(1000 + n), cabanaId = id(2000 + n), cargoId = id(5000 + n);
    await q('insert into public.cabanas(id,numero,activa,precio_base) values($1,$2,true,999999)', [cabanaId, n]);
    await q("insert into public.reservas(id,titular_nombre,estado_reserva,titular_numero_documento) values($1,$2,'confirmada','22.222.222-2')", [reservaId, `Full Day ${n}`]);
    await q("insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia) values($1,$2,$3,'2026-10-15','2026-10-15','fullday','confirmada')", [estadiaId, reservaId, cabanaId]);
    await q("insert into public.cargos(id,reserva_id,estadia_id,tipo_cargo,concepto,monto,moneda,estado) values($1,$2,$3,'alojamiento','Full Day',$4,'CLP','activo')", [cargoId, reservaId, estadiaId, tarifa]);
    return { reservaId, estadiaId, cargos: [cargoId] };
  };

  const agregarServicio = async (n, { monto = 30000, ajuste = 0, total = monto + ajuste } = {}) => {
    const reservaId = id(n), servicioId = id(6000 + n), cargoId = id(7000 + n);
    await q("insert into public.servicios(id,reserva_id,total,estado_servicio) values($1,$2,$3,'pendiente')", [servicioId, reservaId, total]);
    await q("insert into public.cargos(id,reserva_id,servicio_id,tipo_cargo,concepto,monto,moneda,estado) values($1,$2,$3,'servicio','Tinaja Jacuzzi',$4,'CLP','activo')", [cargoId, reservaId, servicioId, monto]);
    if (ajuste) {
      await q(`insert into public.cargo_ajustes(
        id,operacion_id,reserva_id,cargo_id,tipo_ajuste,signo,porcentaje,
        base_calculo,monto,concepto,observaciones,estado,creado_por
      ) values($1,$2,$3,$4,'manual',1,0,$5,$6,'Ajuste servicio','Debe permanecer intacto','activo',$7)`,
      [id(8000 + n), id(8500 + n), reservaId, cargoId, monto, ajuste, id(99)]);
    }
    return { servicioId, cargoId };
  };

  const agregarPago = async (n, secuencia, monto, aplicaciones = []) => {
    const pagoId = id(100000 + n * 10 + secuencia);
    await q(`insert into public.pagos(
      id,reserva_id,monto,estado,tipo_movimiento,etapa_operativa,medio_pago,
      bove,folio,codigo_autorizacion,observaciones,datos_origen
    ) values($1,$2,$3,'confirmado','pago','abono','tarjeta','BOVTAR-INTACTO','FOLIO-INTACTO','AUTH-INTACTA','Pago intacto','{}')`,
    [pagoId, id(n), monto]);
    for (const [cargoId, aplicado] of aplicaciones) {
      await q('insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,$3)', [pagoId, cargoId, aplicado]);
    }
    return pagoId;
  };

  const actual = async reservaId => Number((await one('select total_alojamiento valor from public.vista_saldos_alojamiento_reserva where reserva_id=$1', [reservaId])).valor);
  const item = async (reservaId, objetivo, extra = {}) => ({ reserva_id: reservaId, total_actual: await actual(reservaId), total_objetivo: objetivo, ...extra });
  const call = cambios => one('select public.haiku_cambiar_totales_lote_v1($1::jsonb) resultado', [JSON.stringify(cambios)]).then(fila => fila.resultado);
  const noches = reservaId => q('select n.tarifa from public.estadia_noches n join public.reserva_estadias e on e.id=n.estadia_id where e.reserva_id=$1 order by n.fecha,n.id', [reservaId]).then(resultado => resultado.rows.map(fila => Number(fila.tarifa)));
  const economico = reservaId => one("select coalesce(sum(monto_ajustado),0)::bigint total,coalesce(sum(saldo_cargo) filter(where tipo_cargo<>'alojamiento'),0)::bigint servicios_pendientes from public.vista_estado_cargos where reserva_id=$1 and estado='activo'", [reservaId]).then(fila => ({ total: Number(fila.total), servicios_pendientes: Number(fila.servicios_pendientes) }));

  const snapshotServicio = reservaId => one(`select jsonb_build_object(
    'servicios',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.servicios s where s.reserva_id=$1),
    'cargos',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.cargos c where c.reserva_id=$1 and c.servicio_id is not null),
    'ajustes',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.cargo_ajustes a where a.cargo_id in(select id from public.cargos where reserva_id=$1 and servicio_id is not null)),
    'aplicaciones',(select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id),'[]') from public.pago_aplicaciones pa where pa.cargo_id in(select id from public.cargos where reserva_id=$1 and servicio_id is not null)),
    'pagos',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.pagos p where p.reserva_id=$1)
  ) valor`, [reservaId]).then(fila => fila.valor);

  const snapshotCompleto = reservaId => one(`select jsonb_build_object(
    'reserva',(select to_jsonb(r) from public.reservas r where r.id=$1),
    'estadias',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from public.reserva_estadias e where e.reserva_id=$1),
    'noches',(select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]') from public.estadia_noches n where n.estadia_id in(select id from public.reserva_estadias where reserva_id=$1)),
    'cargos',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.cargos c where c.reserva_id=$1),
    'ajustes',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.cargo_ajustes a where a.reserva_id=$1),
    'servicios',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.servicios s where s.reserva_id=$1),
    'pagos',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.pagos p where p.reserva_id=$1),
    'aplicaciones',(select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id),'[]') from public.pago_aplicaciones pa where pa.pago_id in(select id from public.pagos where reserva_id=$1) or pa.cargo_id in(select id from public.cargos where reserva_id=$1)),
    'auditoria',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.eventos_auditoria a where a.reserva_id=$1)
  ) valor`, [reservaId]).then(fila => fila.valor);

  const fallaSinCambios = async (cambios, reservaIds, patron) => {
    const antes = {};
    for (const reservaId of reservaIds) antes[reservaId] = await snapshotCompleto(reservaId);
    await q('savepoint intento');
    await assert.rejects(call(cambios), patron);
    await q('rollback to intento');
    for (const reservaId of reservaIds) assert.deepEqual(await snapshotCompleto(reservaId), antes[reservaId]);
  };

  try {
    await test('capacidad pública reporta TOTAL v32 y servicios separados', async () => {
      assert.deepEqual((await one('select public.haiku_capacidad_totales_v1() capacidad')).capacidad, {
        version: 'total1_financiero_v32', writer_disponible: true, servicios_separados: true
      });
    });

    await test('Daniel 320000 a 288000 conserva Tinaja 30000 y total global 318000', async () => {
      const reserva = await crearAlojamiento(10);
      await agregarServicio(10);
      const servicioAntes = await snapshotServicio(reserva.reservaId);
      const respuesta = await call([await item(reserva.reservaId, 288000)]);
      assert.deepEqual(await noches(reserva.reservaId), [144000, 144000]);
      assert.equal(await actual(reserva.reservaId), 288000);
      assert.deepEqual(await economico(reserva.reservaId), { total: 318000, servicios_pendientes: 30000 });
      assert.deepEqual(await snapshotServicio(reserva.reservaId), servicioAntes);
      assert.deepEqual(respuesta.resultados[0], {
        reserva_id: reserva.reservaId,
        total_anterior: 320000,
        total_nuevo: 288000,
        sin_cambios: false,
        servicios_sin_cambios: 30000,
        servicios_pendientes: 30000,
        total_reserva_anterior: 350000,
        total_reserva_esperado: 318000
      });
      const auditoria = await one('select datos_contexto from public.eventos_auditoria where reserva_id=$1 limit 1', [reserva.reservaId]);
      assert.equal(auditoria.datos_contexto.version, 'total1_financiero_v32');
      assert.equal(auditoria.datos_contexto.separacion_servicios.servicios_sin_cambios, 30000);
    });

    await test('Isadora 320000 a 320232 conserva servicios y cambia el total global sólo +232', async () => {
      const reserva = await crearAlojamiento(11);
      await agregarServicio(11, { monto: 45000 });
      const antes = await snapshotServicio(reserva.reservaId);
      const totalAntes = (await economico(reserva.reservaId)).total;
      const respuesta = await call([await item(reserva.reservaId, 320232)]);
      assert.deepEqual(await noches(reserva.reservaId), [160116, 160116]);
      assert.equal((await economico(reserva.reservaId)).total, totalAntes + 232);
      assert.deepEqual(await snapshotServicio(reserva.reservaId), antes);
      assert.equal(respuesta.resultados[0].total_reserva_anterior, 365000);
      assert.equal(respuesta.resultados[0].total_reserva_esperado, 365232);
    });

    await test('servicio impago y pago aplicado sólo a alojamiento permiten la rebaja', async () => {
      const reserva = await crearAlojamiento(12);
      await agregarServicio(12);
      await agregarPago(12, 1, 100000, [[reserva.cargos[0], 100000]]);
      const servicioAntes = await snapshotServicio(reserva.reservaId);
      await call([await item(reserva.reservaId, 288000)]);
      assert.equal(await actual(reserva.reservaId), 288000);
      assert.deepEqual(await snapshotServicio(reserva.reservaId), servicioAntes);
    });

    await test('pagos separados de alojamiento y servicio permanecen física y documentalmente idénticos', async () => {
      const reserva = await crearAlojamiento(13);
      const servicio = await agregarServicio(13);
      await agregarPago(13, 1, 100000, [[reserva.cargos[0], 100000]]);
      await agregarPago(13, 2, 30000, [[servicio.cargoId, 30000]]);
      const antes = await snapshotServicio(reserva.reservaId);
      await call([await item(reserva.reservaId, 288000)]);
      assert.deepEqual(await snapshotServicio(reserva.reservaId), antes);
      assert.deepEqual(await economico(reserva.reservaId), { total: 318000, servicios_pendientes: 0 });
    });

    await test('ajuste de cargo de servicio queda idéntico y fuera del plan de alojamiento', async () => {
      const reserva = await crearAlojamiento(14);
      await agregarServicio(14, { monto: 25000, ajuste: 5000, total: 30000 });
      const antes = await snapshotServicio(reserva.reservaId);
      await call([await item(reserva.reservaId, 288000)]);
      assert.deepEqual(await snapshotServicio(reserva.reservaId), antes);
      assert.deepEqual(await economico(reserva.reservaId), { total: 318000, servicios_pendientes: 30000 });
    });

    await test('Full Day con servicio separado modifica sólo alojamiento', async () => {
      const reserva = await crearFullDay(15);
      await agregarServicio(15);
      const antes = await snapshotServicio(reserva.reservaId);
      const respuesta = await call([await item(reserva.reservaId, 120000)]);
      assert.equal(await actual(reserva.reservaId), 120000);
      assert.deepEqual(await snapshotServicio(reserva.reservaId), antes);
      assert.equal(respuesta.resultados[0].total_reserva_esperado, 150000);
    });

    await test('alojamiento sin servicios conserva la regresión v31', async () => {
      const reserva = await crearAlojamiento(16);
      await call([await item(reserva.reservaId, 288000)]);
      assert.deepEqual(await noches(reserva.reservaId), [144000, 144000]);
      assert.equal((await economico(reserva.reservaId)).total, 288000);
    });

    await test('IVA de alojamiento sigue funcionando junto a un servicio separado', async () => {
      const reserva = await crearAlojamiento(17, { tarifa: 170000, iva: true });
      await agregarServicio(17);
      const antes = await snapshotServicio(reserva.reservaId);
      const plan = (await one('select private.haiku_plan_total_financiero_v32($1,$2) plan', [reserva.reservaId, 288000])).plan;
      await call([await item(reserva.reservaId, 288000, { firma_iva: plan.firma })]);
      assert.equal(await actual(reserva.reservaId), 288000);
      assert.deepEqual(await snapshotServicio(reserva.reservaId), antes);
    });

    await test('firma IVA stale bloquea sin tocar servicio ni alojamiento', async () => {
      const reserva = await crearAlojamiento(18, { tarifa: 170000, iva: true });
      await agregarServicio(18);
      await fallaSinCambios([await item(reserva.reservaId, 288000, { firma_iva: 'stale' })], [reserva.reservaId], /plan IVA cambió/);
    });

    await test('un pago mezclado entre alojamiento y servicio se bloquea', async () => {
      const reserva = await crearAlojamiento(19);
      const servicio = await agregarServicio(19);
      await agregarPago(19, 1, 130000, [[reserva.cargos[0], 100000], [servicio.cargoId, 30000]]);
      await fallaSinCambios([await item(reserva.reservaId, 288000)], [reserva.reservaId], /Pago mezclado/);
    });

    await test('pago sin aplicación inequívoca se bloquea', async () => {
      const reserva = await crearAlojamiento(20);
      await agregarServicio(20);
      await agregarPago(20, 1, 100000, []);
      await fallaSinCambios([await item(reserva.reservaId, 288000)], [reserva.reservaId], /Pago no elegible/);
    });

    await test('alojamiento totalmente pagado no puede bajar del monto aplicado', async () => {
      const reserva = await crearAlojamiento(21);
      await agregarServicio(21);
      await agregarPago(21, 1, 320000, [[reserva.cargos[0], 160000], [reserva.cargos[1], 160000]]);
      await fallaSinCambios([await item(reserva.reservaId, 288000)], [reserva.reservaId], /Sobrepago de alojamiento/);
    });

    await test('devolución vinculada conserva el guard conservador', async () => {
      const reserva = await crearAlojamiento(22);
      await agregarServicio(22);
      const pagoId = await agregarPago(22, 1, 100000, [[reserva.cargos[0], 100000]]);
      await q("insert into public.pagos(id,reserva_id,monto,estado,tipo_movimiento,pago_origen_id,etapa_operativa,datos_origen) values($1,$2,1000,'confirmado','devolucion',$3,'abono','{}')", [id(100222), reserva.reservaId, pagoId]);
      await fallaSinCambios([await item(reserva.reservaId, 288000)], [reserva.reservaId], /Pago no elegible|devolución vinculada/);
    });

    await test('servicio cuyo total no coincide con sus cargos se bloquea', async () => {
      const reserva = await crearAlojamiento(23);
      await agregarServicio(23, { monto: 30000, total: 31000 });
      await fallaSinCambios([await item(reserva.reservaId, 288000)], [reserva.reservaId], /no separados inequívocamente/);
    });

    await test('expected total stale bloquea antes de escribir', async () => {
      const reserva = await crearAlojamiento(24);
      await agregarServicio(24);
      const cambio = await item(reserva.reservaId, 288000);
      cambio.total_actual = 319999;
      await fallaSinCambios([cambio], [reserva.reservaId], /total cambió desde la preview/);
    });

    await test('lote atómico revierte Daniel si otra reserva tiene pago mixto', async () => {
      const daniel = await crearAlojamiento(25);
      await agregarServicio(25);
      const ambigua = await crearAlojamiento(26);
      const servicio = await agregarServicio(26);
      await agregarPago(26, 1, 130000, [[ambigua.cargos[0], 100000], [servicio.cargoId, 30000]]);
      await fallaSinCambios([
        await item(daniel.reservaId, 288000),
        await item(ambigua.reservaId, 288000)
      ], [daniel.reservaId, ambigua.reservaId], /Pago mezclado/);
    });

    await test('no-op con servicio separado no escribe ni audita', async () => {
      const reserva = await crearAlojamiento(27);
      await agregarServicio(27);
      const antes = await snapshotCompleto(reserva.reservaId);
      const respuesta = await call([await item(reserva.reservaId, 320000)]);
      assert.equal(respuesta.resultados[0].sin_cambios, true);
      assert.deepEqual(await snapshotCompleto(reserva.reservaId), antes);
    });

    console.log(`PASS TOTAL V32 SERVICIOS SEPARADOS: ${checks} escenarios PostgreSQL locales, cero escrituras remotas.`);
  } finally {
    await db.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
