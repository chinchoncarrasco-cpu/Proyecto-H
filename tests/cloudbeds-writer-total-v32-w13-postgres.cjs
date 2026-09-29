// PostgreSQL efímero PGlite; fixtures sintéticos y cero conexiones remotas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const init = require('./fixtures/cloudbeds-writer-w1-runtime.cjs');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migrationW13 = fs.readFileSync('supabase/migrations/20260929193900_cloudbeds_writer_total_v32_w13.sql', 'utf8');
const migrationV32 = fs.readFileSync('supabase/migrations/20260929194050_total_v32_servicios_separados.sql', 'utf8');

(async () => {
  const db = await init();
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

  const crearAlojamiento = async (n, total = 320000) => {
    const reservaId = id(n), estadiaId = id(1000 + n), cabanaId = id(2000 + n), titularId = id(3000 + n);
    const tarifa = total / 2;
    await q('insert into public.cabanas(id,numero,activa,precio_base) values($1,$2,true,$3)', [cabanaId, n, tarifa]);
    await q("insert into public.huespedes(id,nombre,apellido,tipo_documento,numero_documento) values($1,$2,'Fixture','rut','111111111')", [titularId, `Titular ${n}`]);
    await q("insert into public.reservas(id,titular_nombre,estado_reserva,titular_huesped_id,titular_tipo_documento,titular_numero_documento,cloudbeds_id) values($1,$2,'confirmada',$3,'rut','111111111',$4)", [reservaId, `Titular ${n}`, titularId, `CB-W13-${n}`]);
    await q("insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia,adultos,ninos,mascotas) values($1,$2,$3,'2026-10-10','2026-10-12','alojamiento','confirmada',2,0,0)", [estadiaId, reservaId, cabanaId]);
    await q('insert into public.reserva_huespedes(reserva_id,huesped_id) values($1,$2)', [reservaId, titularId]);
    await q('insert into public.estadia_huespedes(estadia_id,huesped_id) values($1,$2)', [estadiaId, titularId]);
    await q("insert into public.estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) values($1,'2026-10-10',$2,'manual'),($1,'2026-10-11',$2,'manual')", [estadiaId, tarifa]);
    const cargos = (await q("select id from public.cargos where reserva_id=$1 and tipo_cargo='alojamiento' order by creado_en,id", [reservaId])).rows.map(fila => fila.id);
    return { reservaId, estadiaId, cargos };
  };

  const crearFullDay = async (n, total = 160000) => {
    const reservaId = id(n), estadiaId = id(1000 + n), cabanaId = id(2000 + n), titularId = id(3000 + n), cargoId = id(5000 + n);
    await q('insert into public.cabanas(id,numero,activa,precio_base) values($1,$2,true,999999)', [cabanaId, n]);
    await q("insert into public.huespedes(id,nombre,apellido,tipo_documento,numero_documento) values($1,$2,'Fixture','rut','222222222')", [titularId, `Vanessa ${n}`]);
    await q("insert into public.reservas(id,titular_nombre,estado_reserva,titular_huesped_id,titular_tipo_documento,titular_numero_documento,cloudbeds_id) values($1,$2,'confirmada',$3,'rut','222222222',$4)", [reservaId, `Vanessa ${n}`, titularId, `CB-W13-${n}`]);
    await q("insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia,adultos,ninos,mascotas) values($1,$2,$3,'2026-10-15','2026-10-15','fullday','confirmada',2,0,0)", [estadiaId, reservaId, cabanaId]);
    await q('insert into public.reserva_huespedes(reserva_id,huesped_id) values($1,$2)', [reservaId, titularId]);
    await q('insert into public.estadia_huespedes(estadia_id,huesped_id) values($1,$2)', [estadiaId, titularId]);
    await q("insert into public.cargos(id,reserva_id,estadia_id,tipo_cargo,concepto,monto,moneda,estado) values($1,$2,$3,'alojamiento','Full Day',$4,'CLP','activo')", [cargoId, reservaId, estadiaId, total]);
    return { reservaId, estadiaId, cargos: [cargoId] };
  };

  const agregarServicio = async (n, monto = 30000) => {
    const reservaId = id(n), servicioId = id(6000 + n), cargoId = id(7000 + n);
    await q("insert into public.servicios(id,reserva_id,total,estado_servicio) values($1,$2,$3,'pendiente')", [servicioId, reservaId, monto]);
    await q("insert into public.cargos(id,reserva_id,servicio_id,tipo_cargo,concepto,monto,moneda,estado) values($1,$2,$3,'servicio','Tinaja Jacuzzi',$4,'CLP','activo')", [cargoId, reservaId, servicioId, monto]);
    return { servicioId, cargoId };
  };

  const agregarPagoMixto = async (n, cargoAlojamiento, cargoServicio) => {
    const pagoId = id(9000 + n);
    await q("insert into public.pagos(id,reserva_id,monto,estado,tipo_movimiento,etapa_operativa,medio_pago,codigo_autorizacion,bove,folio,observaciones,datos_origen) values($1,$2,130000,'confirmado','pago','abono','tarjeta','AUTH','BOV','FOL','mixto','{}')", [pagoId, id(n)]);
    await q('insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,100000),($1,$3,30000)', [pagoId, cargoAlojamiento, cargoServicio]);
  };

  const totalAlojamiento = reservaId => one('select total_alojamiento total from public.vista_saldos_alojamiento_reserva where reserva_id=$1', [reservaId]).then(fila => Number(fila.total));
  const totalGlobal = reservaId => one("select coalesce(sum(monto_ajustado),0) total from public.vista_estado_cargos where reserva_id=$1 and estado='activo'", [reservaId]).then(fila => Number(fila.total));
  const snapshotServicio = reservaId => one(`select jsonb_build_object(
    'servicios',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.servicios s where s.reserva_id=$1),
    'cargos',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.cargos c where c.reserva_id=$1 and c.servicio_id is not null),
    'aplicaciones',(select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id),'[]') from public.pago_aplicaciones pa where pa.cargo_id in(select id from public.cargos where reserva_id=$1 and servicio_id is not null))
  ) valor`, [reservaId]).then(fila => fila.valor);

  const snapshotPreview = reservaId => one(`select jsonb_build_object(
    'reserva',(select to_jsonb(r) from public.reservas r where r.id=$1),
    'estadias',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from public.reserva_estadias e where e.reserva_id=$1),
    'reserva_huespedes',(select coalesce(jsonb_agg(to_jsonb(rh) order by rh.huesped_id),'[]'::jsonb) from public.reserva_huespedes rh where rh.reserva_id=$1),
    'estadia_huespedes',(select coalesce(jsonb_agg(to_jsonb(eh) order by eh.estadia_id,eh.huesped_id),'[]'::jsonb) from public.estadia_huespedes eh where eh.estadia_id in(select id from public.reserva_estadias where reserva_id=$1)),
    'noches',(select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.estadia_noches n where n.estadia_id in(select id from public.reserva_estadias where reserva_id=$1)),
    'cargos',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from public.cargos c where c.reserva_id=$1),
    'ajustes',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from public.cargo_ajustes a where a.reserva_id=$1),
    'pagos',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from public.pagos p where p.reserva_id=$1),
    'aplicaciones',(select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id),'[]'::jsonb) from public.pago_aplicaciones pa where pa.pago_id in(select id from public.pagos where reserva_id=$1) or pa.cargo_id in(select id from public.cargos where reserva_id=$1)),
    'servicios',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from public.servicios s where s.reserva_id=$1),
    'auditoria',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from public.eventos_auditoria a where a.reserva_id=$1)
  ) valor`, [reservaId]).then(fila => fila.valor);

  const metadataFuncion = firma => one(`select
    p.provolatile,
    p.prosecdef,
    ('search_path=""'=any(coalesce(p.proconfig,'{}'::text[]))) search_path_vacio,
    has_function_privilege('authenticated',p.oid,'EXECUTE') ejecuta_authenticated,
    has_function_privilege('anon',p.oid,'EXECUTE') ejecuta_anon
  from pg_proc p where p.oid=to_regprocedure($1::text)`, [firma]);

  const preview = (reserva, objetivo) => one(
    'select public.haiku_previsualizar_tarifa_cloudbeds_v1($1,$2,$3) resultado',
    [reserva.reservaId, reserva.estadiaId, objetivo]
  ).then(fila => fila.resultado);

  const operacion = async (n, reserva, tipo, objetivo, extra = {}) => ({
    reserva_id: reserva.reservaId,
    estadia_id: reserva.estadiaId,
    tipo_estadia: tipo,
    total_actual_esperado: await totalAlojamiento(reserva.reservaId),
    total_objetivo: objetivo,
    cloudbeds_reservation_number: `CB-W13-${n}`,
    cloudbeds_reservation_id: `RID-W13-${n}`,
    certeza: 'ALTA_CERTEZA',
    evidencia: ['fixture transición W1.3'],
    ...extra
  });

  const writer = operaciones => one(
    'select public.haiku_aplicar_tarifas_cloudbeds_v1($1::jsonb) resultado',
    [JSON.stringify(operaciones)]
  ).then(fila => fila.resultado);

  try {
    await db.exec(migrationW13);

    await test('ESTADO A: preview VOLATILE conserva seguridad, permisos, JSON y cero writes', async () => {
      const metadata = await metadataFuncion('public.haiku_previsualizar_tarifa_cloudbeds_v1(uuid,uuid,bigint)');
      assert.equal(metadata.provolatile, 'v');
      assert.equal(metadata.prosecdef, true);
      assert.equal(metadata.search_path_vacio, true);
      assert.equal(metadata.ejecuta_authenticated, true);
      assert.equal(metadata.ejecuta_anon, false);
      const reserva = await crearAlojamiento(38);
      const antes = await snapshotPreview(reserva.reservaId);
      const primera = await preview(reserva, 288000);
      const segunda = await preview(reserva, 288000);
      assert.deepEqual(segunda, primera);
      assert.deepEqual(await snapshotPreview(reserva.reservaId), antes);
    });

    await test('ESTADO A: capacidad continúa en v31 y alojamiento normal sigue escribiendo', async () => {
      const cap = (await one('select public.haiku_capacidad_totales_v1() capacidad')).capacidad;
      assert.equal(cap.version, 'total1_financiero_v31');
      assert.equal(cap.writer_disponible, true);
      const reserva = await crearAlojamiento(31);
      const vista = await preview(reserva, 288000);
      assert.equal(vista.autoridad_financiera_version, 'total1_financiero_v31');
      assert.equal(vista.elegible, true);
      const respuesta = await writer([await operacion(31, reserva, 'alojamiento', 288000)]);
      assert.equal(respuesta.autoridad_financiera_version, 'total1_financiero_v31');
      assert.equal(await totalAlojamiento(reserva.reservaId), 288000);
    });

    await test('ESTADO A: Daniel con servicio permanece bloqueado por v31', async () => {
      const reserva = await crearAlojamiento(32);
      await agregarServicio(32);
      const vista = await preview(reserva, 288000);
      assert.equal(vista.autoridad_financiera_version, 'total1_financiero_v31');
      assert.equal(vista.elegible, false);
      assert.match(vista.motivo_bloqueo, /Servicios u otros cargos/);
    });

    await test('W1.3 rechaza cualquier etiqueta fuera de la whitelist exacta', async () => {
      const reserva = await crearAlojamiento(37);
      const item = await operacion(37, reserva, 'alojamiento', 288000);
      await q("comment on function public.haiku_cambiar_totales_lote_v1(jsonb) is 'total1_financiero_v999'");
      await q('savepoint preview_invalida');
      await assert.rejects(preview(reserva, 288000), /CONFLICTO_FINANCIERO/);
      await q('rollback to preview_invalida');
      await q('savepoint writer_invalido');
      await assert.rejects(writer([item]), /CONFLICTO_FINANCIERO/);
      await q('rollback to writer_invalido');
    });

    // Simula el orden futuro: W1.3 ya está operativo y luego se instala TOTAL v32.
    await db.exec(migrationV32);

    await test('ESTADO B: toda la cadena nueva conserva volatilidad semantica', async () => {
      for (const firma of [
        'private.haiku_plan_aplicaciones_total_v32(uuid,jsonb)',
        'private.haiku_plan_total_financiero_v32(uuid,bigint)',
        'private.haiku_plan_total_financiero_v3(uuid,bigint)',
        'public.haiku_previsualizar_tarifa_cloudbeds_v1(uuid,uuid,bigint)',
        'public.haiku_aplicar_tarifas_cloudbeds_v1(jsonb)'
      ]) assert.equal((await metadataFuncion(firma)).provolatile, 'v', firma);
    });

    await test('ESTADO B: capacidad reporta v32 sólo con dependencias v32 presentes', async () => {
      assert.deepEqual((await one('select public.haiku_capacidad_totales_v1() capacidad')).capacidad, {
        version: 'total1_financiero_v32', writer_disponible: true, servicios_separados: true
      });
    });

    await test('ESTADO B: Daniel pasa preview y writer conserva servicio 30000', async () => {
      const reserva = await crearAlojamiento(33);
      await agregarServicio(33);
      const servicioAntes = await snapshotServicio(reserva.reservaId);
      const todoAntes = await snapshotPreview(reserva.reservaId);
      const vista = await preview(reserva, 288000);
      assert.equal(vista.autoridad_financiera_version, 'total1_financiero_v32');
      assert.equal(vista.elegible, true);
      assert.equal(vista.servicios_sin_cambios, true);
      assert.equal(vista.total_servicios_sin_cambio, 30000);
      assert.equal(vista.total_reserva_actual, 350000);
      assert.equal(vista.total_reserva_esperado, 318000);
      assert.deepEqual(await snapshotPreview(reserva.reservaId), todoAntes);
      await writer([await operacion(33, reserva, 'alojamiento', 288000)]);
      assert.equal(await totalAlojamiento(reserva.reservaId), 288000);
      assert.equal(await totalGlobal(reserva.reservaId), 318000);
      assert.deepEqual(await snapshotServicio(reserva.reservaId), servicioAntes);
    });

    await test('ESTADO B: Isadora cambia sólo alojamiento +232 y conserva total de servicio', async () => {
      const reserva = await crearAlojamiento(34);
      await agregarServicio(34, 45000);
      const vista = await preview(reserva, 320232);
      assert.equal(vista.total_objetivo, 320232);
      assert.equal(vista.total_reserva_actual, 365000);
      assert.equal(vista.total_reserva_esperado, 365232);
      await writer([await operacion(34, reserva, 'alojamiento', 320232)]);
      assert.equal(await totalAlojamiento(reserva.reservaId), 320232);
      assert.equal(await totalGlobal(reserva.reservaId), 365232);
    });

    await test('ESTADO B: pago mixto queda bloqueado en preview y writer', async () => {
      const reserva = await crearAlojamiento(35);
      const servicio = await agregarServicio(35);
      await agregarPagoMixto(35, reserva.cargos[0], servicio.cargoId);
      const vista = await preview(reserva, 288000);
      assert.equal(vista.elegible, false);
      assert.match(vista.motivo_bloqueo, /Pago mezclado entre alojamiento y servicios/);
      await assert.rejects(writer([await operacion(35, reserva, 'alojamiento', 288000)]), /CONFLICTO_FINANCIERO/);
    });

    await test('ESTADO B: Vanessa Full Day sin servicios conserva la regresión W1.2', async () => {
      const reserva = await crearFullDay(36);
      const vista = await preview(reserva, 120000);
      assert.equal(vista.elegible, true);
      assert.equal(vista.tipo_estadia, 'fullday');
      assert.equal(vista.total_servicios_sin_cambio, 0);
      await writer([await operacion(36, reserva, 'fullday', 120000)]);
      assert.equal(await totalAlojamiento(reserva.reservaId), 120000);
    });

    console.log(`PASS W1.3 TRANSICIÓN V31/V32: ${checks} escenarios PostgreSQL locales, cero conexiones remotas.`);
  } finally {
    await db.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
