// PostgreSQL efímero PGlite; datos sintéticos y cero conexiones remotas.
const assert = require('node:assert/strict');
const init = require('./fixtures/cloudbeds-writer-w1-runtime.cjs');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

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

  const actual = async reservaId => Number((await one(
    'select total_alojamiento total from public.vista_saldos_alojamiento_reserva where reserva_id=$1',
    [reservaId]
  )).total);

  const item = async (n, tipo, objetivo, extra = {}) => ({
    reserva_id: id(n),
    estadia_id: id(1000 + n),
    tipo_estadia: tipo,
    total_actual_esperado: await actual(id(n)),
    total_objetivo: objetivo,
    cloudbeds_reservation_number: `CB-W1-${n}`,
    cloudbeds_reservation_id: `RID-W1-${n}`,
    certeza: 'ALTA_CERTEZA',
    evidencia: ['fixture local', `caso ${n}`],
    ...extra
  });

  const crearNormal = async (n, { total = 160000, pagado = 0, estado = 'confirmada', cloudbedsId = null } = {}) => {
    const cabanaId = id(2000 + n);
    const titularId = id(3000 + n);
    const estadiaId = id(1000 + n);
    await q('insert into public.cabanas(id,numero,activa,precio_base) values($1,$2,true,$3)', [cabanaId, n, total]);
    await q("insert into public.huespedes(id,nombre,apellido,tipo_documento,numero_documento) values($1,$2,'Prueba','rut','111111111')", [titularId, `Titular ${n}`]);
    await q("insert into public.reservas(id,titular_nombre,estado_reserva,titular_huesped_id,titular_tipo_documento,titular_numero_documento,cloudbeds_id) values($1,$2,$3,$4,'rut','111111111',$5)", [id(n), `Titular ${n}`, estado, titularId, cloudbedsId]);
    await q("insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia,adultos,ninos,mascotas) values($1,$2,$3,'2026-10-01','2026-10-02','alojamiento',$4,2,0,0)", [estadiaId, id(n), cabanaId, estado]);
    await q('insert into public.reserva_huespedes(reserva_id,huesped_id) values($1,$2)', [id(n), titularId]);
    await q('insert into public.estadia_huespedes(estadia_id,huesped_id) values($1,$2)', [estadiaId, titularId]);
    await q("insert into public.estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) values($1,'2026-10-01',$2,'manual')", [estadiaId, total]);
    const cargo = (await one("select id from public.cargos where reserva_id=$1 and tipo_cargo='alojamiento' and estado='activo'", [id(n)])).id;
    if (pagado) {
      const pagoId = id(4000 + n);
      await q("insert into public.pagos(id,reserva_id,monto,estado,tipo_movimiento,etapa_operativa,medio_pago,codigo_autorizacion,bove,folio,observaciones,datos_origen) values($1,$2,$3,'confirmado','pago','abono','tarjeta','AUTH','BOVTAR','FOLIO','intacto','{}')", [pagoId, id(n), pagado]);
      await q('insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,$3)', [pagoId, cargo, pagado]);
    }
    return { cargo, estadiaId };
  };

  const crearFullDay = async (n, { total = 160000, pagado = 0, aplicado = pagado, estado = 'confirmada', cloudbedsId = null } = {}) => {
    const cabanaId = id(2000 + n);
    const titularId = id(3000 + n);
    const acompananteId = id(3500 + n);
    const estadiaId = id(1000 + n);
    await q('insert into public.cabanas(id,numero,activa,precio_base) values($1,$2,true,999999)', [cabanaId, n]);
    await q("insert into public.huespedes(id,nombre,apellido,tipo_documento,numero_documento,telefono,correo) values($1,$2,'Prueba','rut','18.185.017-5','+56900000000','titular@example.test')", [titularId, `Full ${n}`]);
    await q("insert into public.huespedes(id,nombre,apellido) values($1,'Persona','Acompañante')", [acompananteId]);
    await q("insert into public.reservas(id,titular_nombre,estado_reserva,titular_huesped_id,titular_tipo_documento,titular_numero_documento,correo_contacto,telefono_contacto,observaciones,cloudbeds_id) values($1,$2,$3,$4,'rut','18.185.017-5','titular@example.test','+56900000000','Observación intacta',$5)", [id(n), `Full ${n}`, estado, titularId, cloudbedsId]);
    await q("insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia,adultos,ninos,mascotas) values($1,$2,$3,'2026-10-03','2026-10-03','fullday',$4,2,0,0)", [estadiaId, id(n), cabanaId, estado]);
    await q('insert into public.reserva_huespedes(reserva_id,huesped_id) values($1,$2),($1,$3)', [id(n), titularId, acompananteId]);
    await q('insert into public.estadia_huespedes(estadia_id,huesped_id) values($1,$2),($1,$3)', [estadiaId, titularId, acompananteId]);
    const cargo = id(5000 + n);
    await q("insert into public.cargos(id,reserva_id,estadia_id,tipo_cargo,concepto,monto,moneda,estado) values($1,$2,$3,'alojamiento','Full Day fixture',$4,'CLP','activo')", [cargo, id(n), estadiaId, total]);
    if (pagado) {
      const pagoId = id(4000 + n);
      await q("insert into public.pagos(id,reserva_id,monto,estado,tipo_movimiento,etapa_operativa,medio_pago,codigo_autorizacion,bove,folio,observaciones,datos_origen) values($1,$2,$3,'confirmado','pago','abono','tarjeta','AUTH','BOVTAR','FOLIO','intacto','{}')", [pagoId, id(n), pagado]);
      if (aplicado) {
        await q('insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,$3)', [pagoId, cargo, aplicado]);
      }
    }
    return { cargo, estadiaId, titularId, acompananteId };
  };

  const call = operaciones => q(
    'select public.haiku_aplicar_tarifas_cloudbeds_v1($1::jsonb) resultado',
    [JSON.stringify(operaciones)]
  );

  const preview = (reservaId, estadiaId, objetivo) => one(
    'select public.haiku_previsualizar_tarifa_cloudbeds_v1($1,$2,$3) resultado',
    [reservaId, estadiaId, objetivo]
  ).then(fila => fila.resultado);

  const crearNormalIva = async n => {
    const ids = await crearNormal(n, { total: 170000 });
    const iva = Number((await one('select private.haiku_iva_incluido(170000) monto')).monto);
    await q(`insert into public.cargo_ajustes(
      id,operacion_id,reserva_id,cargo_id,tipo_ajuste,signo,porcentaje,
      base_calculo,monto,concepto,estado,creado_por
    ) values($1,$2,$3,$4,'iva_exento',-1,19,170000,$5,'Exención IVA extranjero','activo',$6)`,
    [id(8000 + n), id(8100 + n), id(n), ids.cargo, iva, id(99)]);
    return ids;
  };

  const snapshot = async reservaId => (await one(`select jsonb_build_object(
    'total',(select total_alojamiento from public.vista_saldos_alojamiento_reserva where reserva_id=$1),
    'pagos',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.pagos p where p.reserva_id=$1),
    'aplicaciones',(select coalesce(jsonb_agg(to_jsonb(pa) order by pa.id),'[]') from public.pago_aplicaciones pa where pa.pago_id in(select id from public.pagos where reserva_id=$1) or pa.cargo_id in(select id from public.cargos where reserva_id=$1)),
    'servicios',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.servicios s where s.reserva_id=$1),
    'cargos_servicio',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.cargos c where c.reserva_id=$1 and c.servicio_id is not null),
    'auditoria',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.eventos_auditoria a where a.reserva_id=$1)
  ) valor`, [reservaId])).valor;

  const invariantes = async reservaId => (await one(`select jsonb_build_object(
    'reserva',(select to_jsonb(r) from public.reservas r where r.id=$1),
    'estadias',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from public.reserva_estadias e where e.reserva_id=$1),
    'huespedes',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]') from public.huespedes h where h.id in(
      select r.titular_huesped_id from public.reservas r where r.id=$1 and r.titular_huesped_id is not null
      union select rh.huesped_id from public.reserva_huespedes rh where rh.reserva_id=$1
      union select eh.huesped_id from public.estadia_huespedes eh where eh.estadia_id in(select id from public.reserva_estadias where reserva_id=$1)
    )),
    'reserva_huespedes',(select coalesce(jsonb_agg(to_jsonb(rh) order by rh.huesped_id),'[]') from public.reserva_huespedes rh where rh.reserva_id=$1),
    'estadia_huespedes',(select coalesce(jsonb_agg(to_jsonb(eh) order by eh.estadia_id,eh.huesped_id),'[]') from public.estadia_huespedes eh where eh.estadia_id in(select id from public.reserva_estadias where reserva_id=$1)),
    'pagos',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.pagos p where p.reserva_id=$1),
    'servicios',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.servicios s where s.reserva_id=$1),
    'cargos_servicio',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.cargos c where c.reserva_id=$1 and c.servicio_id is not null)
  ) valor`, [reservaId])).valor;

  const financiero = async reservaId => {
    const fila = await one('select total_alojamiento,pagado_alojamiento,saldo_alojamiento from public.vista_saldos_alojamiento_reserva where reserva_id=$1', [reservaId]);
    return Object.fromEntries(Object.entries(fila).map(([clave, valor]) => [clave, Number(valor)]));
  };

  const fallaSinCambios = async (operaciones, reservaIds, patron) => {
    const antes = {};
    for (const reservaId of reservaIds) antes[reservaId] = await snapshot(reservaId);
    await q('savepoint intento');
    await assert.rejects(call(operaciones), patron);
    await q('rollback to intento');
    for (const reservaId of reservaIds) assert.deepEqual(await snapshot(reservaId), antes[reservaId]);
  };

  try {
    await test('preview alojamiento relee total, pagado y saldo sin escribir', async () => {
      const ids = await crearNormal(40, { pagado: 100000 });
      const antes = await snapshot(id(40));
      const resultado = await preview(id(40), ids.estadiaId, 144000);
      assert.equal(resultado.solo_lectura, true);
      assert.equal(resultado.elegible, true);
      assert.equal(resultado.tipo_estadia, 'alojamiento');
      assert.equal(resultado.total_actual, 160000);
      assert.equal(resultado.pagado_actual, 100000);
      assert.equal(resultado.saldo_actual, 60000);
      assert.equal(resultado.saldo_esperado, 44000);
      assert.equal('firma_iva' in resultado, false);
      assert.deepEqual(await snapshot(id(40)), antes);
    });

    await test('preview Full Day revalida D a D y dinero aplicado', async () => {
      const ids = await crearFullDay(41, { pagado: 120000 });
      const resultado = await preview(id(41), ids.estadiaId, 120000);
      assert.equal(resultado.elegible, true);
      assert.equal(resultado.tipo_estadia, 'fullday');
      assert.equal(resultado.fecha_ingreso, resultado.fecha_salida);
      assert.equal(resultado.total_actual, 160000);
      assert.equal(resultado.pagado_actual, 120000);
      assert.equal(resultado.saldo_esperado, 0);
      assert.equal(resultado.capacidad_financiera.autoridad, 'public.haiku_cambiar_totales_lote_v1');
    });

    await test('preview IVA entrega firma y W1 la transporta; firma stale bloquea', async () => {
      const ids = await crearNormalIva(42);
      const preparada = await preview(id(42), ids.estadiaId, 153000);
      assert.equal(preparada.elegible, true);
      assert.equal(typeof preparada.firma_iva, 'string');
      assert.ok(preparada.firma_iva.length > 0);
      const operacion = await item(42, 'alojamiento', 153000, { firma_iva: preparada.firma_iva });
      await fallaSinCambios([{ ...operacion, firma_iva: 'firma-obsoleta' }], [id(42)], /PLAN_IVA_DESACTUALIZADO/);
      const respuesta = (await call([operacion])).rows[0].resultado;
      assert.equal(respuesta.ok, true);
      assert.equal(await actual(id(42)), 153000);
    });

    await test('certeza alta por sí sola no autoriza y cambiarla no evita guards', async () => {
      await crearNormal(43, { estado: 'cancelada' });
      const alta = await item(43, 'alojamiento', 144000);
      await fallaSinCambios([alta], [id(43)], /RESERVA_NO_ELEGIBLE/);
      await fallaSinCambios([{ ...alta, certeza: 'ALTERADA_EN_CLIENTE' }], [id(43)], /RESERVA_NO_ELEGIBLE/);
    });

    await test('certeza no amplía ni reduce la capacidad backend; queda como metadata', async () => {
      await crearNormal(44);
      const operacion = await item(44, 'alojamiento', 144000, { certeza: 'REVISION_MANUAL' });
      const respuesta = (await call([operacion])).rows[0].resultado;
      assert.equal(respuesta.ok, true);
      const evento = await one("select datos_contexto from public.eventos_auditoria where reserva_id=$1 and origen='cloudbeds'", [id(44)]);
      assert.equal(evento.datos_contexto.certeza, 'REVISION_MANUAL');
      assert.deepEqual(evento.datos_contexto.evidencia, operacion.evidencia);
    });

    await test('alojamiento 160000 a 144000 sin pago', async () => {
      await crearNormal(10);
      const respuesta = (await call([await item(10, 'alojamiento', 144000)])).rows[0].resultado;
      assert.equal(respuesta.ok, true);
      assert.equal(await actual(id(10)), 144000);
      assert.equal(respuesta.resultados[0].saldo_alojamiento, 144000);
    });

    await test('alojamiento 160000 a 144000 con pago 100000', async () => {
      await crearNormal(11, { pagado: 100000 });
      const pagosAntes = (await snapshot(id(11))).pagos;
      const respuesta = (await call([await item(11, 'alojamiento', 144000)])).rows[0].resultado;
      assert.equal(respuesta.resultados[0].pagado_alojamiento, 100000);
      assert.equal(respuesta.resultados[0].saldo_alojamiento, 44000);
      assert.deepEqual((await snapshot(id(11))).pagos, pagosAntes);
    });

    await test('alojamiento pagado completo bloquea una rebaja', async () => {
      await crearNormal(12, { pagado: 160000 });
      await fallaSinCambios([await item(12, 'alojamiento', 144000)], [id(12)], /PAGO_SUPERA_NUEVO_TOTAL/);
    });

    await test('expected total obsoleto bloquea', async () => {
      await crearNormal(13);
      const operacion = await item(13, 'alojamiento', 144000);
      operacion.total_actual_esperado = 150000;
      await fallaSinCambios([operacion], [id(13)], /ESTADO_DESACTUALIZADO/);
    });

    await test('servicio incompatible conserva el guard v31', async () => {
      await crearNormal(14);
      await q("insert into public.servicios(id,reserva_id,total,estado_servicio) values($1,$2,30000,'pendiente')", [id(6000 + 14), id(14)]);
      await fallaSinCambios([await item(14, 'alojamiento', 144000)], [id(14)], /CONFLICTO_FINANCIERO/);
    });

    await test('alojamiento normal aumenta 160000 a 180000', async () => {
      await crearNormal(15);
      await call([await item(15, 'alojamiento', 180000)]);
      assert.equal(await actual(id(15)), 180000);
    });

    await test('tarifas variables normales mantienen el guard TOTAL v31', async () => {
      const ids = await crearNormal(16);
      await q("update public.reserva_estadias set fecha_salida='2026-10-03' where id=$1", [ids.estadiaId]);
      await q("insert into public.estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) values($1,'2026-10-02',150000,'manual')", [ids.estadiaId]);
      await fallaSinCambios([await item(16, 'alojamiento', 300000)], [id(16)], /CONFLICTO_FINANCIERO/);
    });

    await test('reserva agrupada se bloquea antes de TOTAL v31', async () => {
      await crearNormal(17);
      await q('update public.reservas set grupo_reserva_id=$2 where id=$1', [id(17), id(9917)]);
      await fallaSinCambios([await item(17, 'alojamiento', 144000)], [id(17)], /RESERVA_NO_ELEGIBLE/);
    });

    await test('reserva con múltiples estadías operativas se bloquea', async () => {
      await crearNormal(18);
      await q('insert into public.cabanas(id,numero,activa,precio_base) values($1,118,true,100000)', [id(2118)]);
      await q("insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia,adultos,ninos,mascotas) values($1,$2,$3,'2026-10-05','2026-10-06','alojamiento','confirmada',1,0,0)", [id(9118), id(18), id(2118)]);
      await fallaSinCambios([await item(18, 'alojamiento', 144000)], [id(18)], /RESERVA_NO_ELEGIBLE/);
    });

    await test('regresión Vanessa: Full Day 160000 a 120000 conserva RUT formateado e identidad completa', async () => {
      const ids = await crearFullDay(20, { pagado: 120000, cloudbedsId: 'CB-W1-20' });
      const invariantesAntes = await invariantes(id(20));
      const aplicacionesAntes = (await snapshot(id(20))).aplicaciones;
      const respuesta = (await call([await item(20, 'fullday', 120000)])).rows[0].resultado;
      assert.deepEqual(await financiero(id(20)), {
        total_alojamiento: 120000,
        pagado_alojamiento: 120000,
        saldo_alojamiento: 0
      });
      assert.equal(respuesta.resultados[0].saldo_alojamiento, 0);
      assert.deepEqual(await invariantes(id(20)), invariantesAntes);
      assert.deepEqual((await snapshot(id(20))).aplicaciones, aplicacionesAntes);
      assert.equal(invariantesAntes.reserva.titular_numero_documento, '18.185.017-5');
      assert.equal(invariantesAntes.huespedes.find(h => h.id === ids.titularId).numero_documento, '18.185.017-5');
      const acompanante = await one('select nombre,apellido from public.huespedes where id=$1', [ids.acompananteId]);
      assert.deepEqual(acompanante, { nombre: 'Persona', apellido: 'Acompañante' });
    });

    await test('Full Day 150000 a 120000 con pago 120000', async () => {
      await crearFullDay(21, { total: 150000, pagado: 120000 });
      await call([await item(21, 'fullday', 120000)]);
      assert.deepEqual(await financiero(id(21)), {
        total_alojamiento: 120000,
        pagado_alojamiento: 120000,
        saldo_alojamiento: 0
      });
    });

    await test('Full Day 120000 a 120000 es no-op sin auditoría Cloudbeds', async () => {
      await crearFullDay(22, { total: 120000, pagado: 120000 });
      const antes = await snapshot(id(22));
      const respuesta = (await call([await item(22, 'fullday', 120000)])).rows[0].resultado;
      assert.equal(respuesta.cambios, 0);
      assert.equal(respuesta.resultados[0].sin_cambios, true);
      assert.deepEqual(await snapshot(id(22)), antes);
    });

    await test('Full Day pagado completo bloquea rebaja', async () => {
      await crearFullDay(23, { pagado: 160000 });
      await fallaSinCambios([await item(23, 'fullday', 120000)], [id(23)], /PAGO_SUPERA_NUEVO_TOTAL/);
    });

    await test('Full Day 160000 a 120000 sin pagos', async () => {
      await crearFullDay(25);
      await call([await item(25, 'fullday', 120000)]);
      assert.deepEqual(await financiero(id(25)), {
        total_alojamiento: 120000,
        pagado_alojamiento: 0,
        saldo_alojamiento: 120000
      });
    });

    await test('Full Day aumenta 120000 a 180000 y conserva pago 120000', async () => {
      await crearFullDay(26, { total: 120000, pagado: 120000 });
      await call([await item(26, 'fullday', 180000)]);
      assert.deepEqual(await financiero(id(26)), {
        total_alojamiento: 180000,
        pagado_alojamiento: 120000,
        saldo_alojamiento: 60000
      });
    });

    await test('TOTAL v31 reconcilia remanente de aplicación Full Day', async () => {
      await crearFullDay(27, { pagado: 120000, aplicado: 100000 });
      const pagosAntes = (await invariantes(id(27))).pagos;
      await call([await item(27, 'fullday', 120000)]);
      assert.deepEqual(await financiero(id(27)), {
        total_alojamiento: 120000,
        pagado_alojamiento: 120000,
        saldo_alojamiento: 0
      });
      assert.deepEqual((await invariantes(id(27))).pagos, pagosAntes);
      assert.equal(Number((await one('select sum(monto_aplicado) monto from public.pago_aplicaciones where pago_id=$1', [id(4027)])).monto), 120000);
    });

    await test('servicio independiente Full Day y su pago/aplicación quedan intactos al bloquear', async () => {
      await crearFullDay(24, { pagado: 120000 });
      const servicioId = id(6024), cargoServicioId = id(7024);
      await q("insert into public.servicios(id,reserva_id,total,estado_servicio) values($1,$2,30000,'pendiente')", [servicioId, id(24)]);
      await q("insert into public.cargos(id,reserva_id,servicio_id,tipo_cargo,concepto,monto,moneda,estado) values($1,$2,$3,'servicio','Almuerzo ficticio',30000,'CLP','activo')", [cargoServicioId, id(24), servicioId]);
      await q("insert into public.pagos(id,reserva_id,monto,estado,tipo_movimiento,etapa_operativa,medio_pago,codigo_autorizacion,bove,folio,observaciones,datos_origen) values($1,$2,30000,'confirmado','pago','abono','tarjeta','AUTH-S','BOV-S','FOL-S','servicio intacto','{}')", [id(9024), id(24)]);
      await q('insert into public.pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,30000)', [id(9024), cargoServicioId]);
      const antes = await snapshot(id(24));
      await fallaSinCambios([await item(24, 'fullday', 120000)], [id(24)], /CONFLICTO_FINANCIERO/);
      assert.deepEqual(await snapshot(id(24)), antes);
    });

    await test('cancelada o no-show se bloquea', async () => {
      await crearNormal(30, { estado: 'cancelada' });
      await fallaSinCambios([await item(30, 'alojamiento', 144000)], [id(30)], /RESERVA_NO_ELEGIBLE/);
    });

    await test('estadía equivocada se bloquea', async () => {
      await crearNormal(31);
      const operacion = await item(31, 'alojamiento', 144000);
      operacion.estadia_id = id(9999);
      await fallaSinCambios([operacion], [id(31)], /RESERVA_NO_ELEGIBLE/);
    });

    await test('tipo cambiado se bloquea', async () => {
      await crearNormal(32);
      await fallaSinCambios([await item(32, 'fullday', 144000)], [id(32)], /RESERVA_NO_ELEGIBLE/);
    });

    await test('vínculo Cloudbeds conflictivo no autoriza', async () => {
      await crearNormal(33, { cloudbedsId: 'OTRA-RESERVA' });
      await fallaSinCambios([await item(33, 'alojamiento', 144000)], [id(33)], /RESERVA_NO_ELEGIBLE/);
    });

    await test('auditoría Cloudbeds existe sólo tras éxito', async () => {
      await crearNormal(34);
      await call([await item(34, 'alojamiento', 144000)]);
      const evento = await one("select * from public.eventos_auditoria where reserva_id=$1 and origen='cloudbeds'", [id(34)]);
      assert.equal(evento.usuario_id, id(99));
      assert.equal(evento.estadia_id, id(1034));
      assert.equal(evento.datos_contexto.fuente, 'cloudbeds_pdf');
      assert.equal(evento.datos_contexto.diferencia, -16000);
      assert.equal(evento.datos_contexto.vinculo_cloudbeds_persistido, false);
      assert.equal(Number((await one("select count(*) cantidad from public.eventos_auditoria where reserva_id=$1 and origen='cloudbeds'", [id(34)])).cantidad), 1);
    });

    await test('lote mixto válido actualiza alojamiento y Full Day en una operación', async () => {
      await crearNormal(38);
      await crearFullDay(39, { pagado: 120000 });
      const respuesta = (await call([
        await item(38, 'alojamiento', 144000),
        await item(39, 'fullday', 120000)
      ])).rows[0].resultado;
      assert.equal(respuesta.ok, true);
      assert.equal(respuesta.cambios, 2);
      assert.equal(respuesta.resultados.length, 2);
      assert.equal(await actual(id(38)), 144000);
      assert.deepEqual(await financiero(id(39)), {
        total_alojamiento: 120000,
        pagado_alojamiento: 120000,
        saldo_alojamiento: 0
      });
      for (const reservaId of [id(38), id(39)]) {
        assert.equal(Number((await one("select count(*) cantidad from public.eventos_auditoria where reserva_id=$1 and origen='cloudbeds'", [reservaId])).cantidad), 1);
      }
    });

    await test('lote mixto revierte normal si Full Day falla después', async () => {
      await crearNormal(35);
      const full = await crearFullDay(36, { pagado: 120000 });
      await q("insert into public.cargo_ajustes(id,reserva_id,cargo_id,tipo_ajuste,signo,porcentaje,base_calculo,monto,concepto,estado) values($1,$2,$3,'manual',1,0,160000,1,'bloqueo fixture','activo')", [id(8036), id(36), full.cargo]);
      const opNormal = await item(35, 'alojamiento', 144000);
      const opFull = await item(36, 'fullday', 120000);
      await fallaSinCambios([opNormal, opFull], [id(35), id(36)], /RESERVA_NO_ELEGIBLE|CONFLICTO_FINANCIERO/);
      assert.equal(await actual(id(35)), 160000);
    });

    await test('ACL impide anon y permite authenticated', async () => {
      const acl = await one("select has_function_privilege('anon','public.haiku_aplicar_tarifas_cloudbeds_v1(jsonb)','execute') anon, has_function_privilege('authenticated','public.haiku_aplicar_tarifas_cloudbeds_v1(jsonb)','execute') authenticated, has_function_privilege('anon','public.haiku_previsualizar_tarifa_cloudbeds_v1(uuid,uuid,bigint)','execute') preview_anon, has_function_privilege('authenticated','public.haiku_previsualizar_tarifa_cloudbeds_v1(uuid,uuid,bigint)','execute') preview_authenticated");
      assert.deepEqual(acl, { anon: false, authenticated: true, preview_anon: false, preview_authenticated: true });
    });

    await test('la escritura no persiste cloudbeds_id', async () => {
      await crearNormal(37);
      await call([await item(37, 'alojamiento', 144000)]);
      assert.equal((await one('select cloudbeds_id from public.reservas where id=$1', [id(37)])).cloudbeds_id, null);
    });

    console.log(`PASS CLOUDBEDS WRITER W1.2: ${checks} escenarios PostgreSQL locales, cero escrituras remotas.`);
  } finally {
    await db.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
