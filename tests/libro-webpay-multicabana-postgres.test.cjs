const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {PGlite} = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');

global.HAIKU_LIBRO_SEMANTICA = require('../js/haiku-libro-semantica-v1.js');
global.HAIKU_LIBRO_PAGOS_CANON_V1 = require('../js/haiku-libro-pagos-canon-v1.js');
const Q = require('../js/haiku-libro-consultas-v1.js');
const read = path => readFileSync(join(__dirname, '..', path), 'utf8');
const sql = name => read('supabase/migrations/' + name + '.sql');

test('un WebPay multicabaña registra un solo pago y conserva los montos por estadía', async () => {
    const db = new PGlite();
    try {
        await db.exec(read('tests/fixtures/libro-distribucion-schema.sql'));
        await db.exec(read('tests/fixtures/registrar-pago-supabase.sql'));
        await db.exec('alter table reservas add column grupo_reserva_id uuid; alter table reserva_estadias add column tipo_estadia text default \'alojamiento\';');
        await db.exec(sql('20260908164059_haku_libro_estado_confirmado'));
        await db.exec(sql('20260909215808_haku_libro_aprobacion_distribucion_manual'));
        const locks = sql('20260916041430_haku_libro_aplicaciones_servicio_seguras');
        await db.exec(locks.slice(0, locks.indexOf('-- Todos los writers')));
        await db.exec(sql('20261126230000_libro_webpay_multicabana'));
        await db.exec(sql('20261126230000_libro_webpay_multicabana'));

        const operador = randomUUID(), reservaId = randomUUID();
        const titular = 'Andrea Cordero', titularPago = 'Andrea Coredro';
        const fecha = '2027-06-15', salida = '2027-06-16', abono = '2027-06-04';
        const glosa = titularPago + ' // WEBPAY CONFIRMADO // COD AUT 428016 // CREDITO // $620.000';
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [operador]);
        await db.query("insert into reservas(id,titular_nombre,estado_reserva) values($1,$2,'confirmada')", [reservaId, titular]);
        assert.ok((await db.query('select haiku_libro_distribucion_capacidad_v1() r')).rows[0].r.modos.includes('webpay_multicabana'));
        assert.equal((await db.query("select has_function_privilege('authenticated','private.haiku_libro_webpay_multicabana_v1(uuid,jsonb,jsonb,boolean)','execute') r")).rows[0].r, false);

        const reservas = [], estadias = [], cargos = [], pagos = [];
        const reparto = [[3, 152000], [4, 143000], [6, 168000], [7, 165000]];
        for (const [cabana, monto] of reparto) {
            const cabanaId = randomUUID(), estadiaId = randomUUID(), cargoId = randomUUID();
            await db.query('insert into cabanas values($1,$2)', [cabanaId, cabana]);
            await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia) values($1,$2,$3,$4,$5,'confirmada')",
                [estadiaId, reservaId, cabanaId, fecha, salida]);
            await db.query("insert into cargos(id,reserva_id,estadia_id,tipo_cargo,estado,monto) values($1,$2,$3,'alojamiento','activo',180000)",
                [cargoId, reservaId, estadiaId]);
            cargos.push(cargoId);
            estadias.push({id:estadiaId, reserva_id:reservaId, cabanas:{numero:cabana}, fecha_ingreso:fecha,
                fecha_salida:salida, tipo_estadia:'alojamiento', estado_estadia:'confirmada',
                reservas:{titular_nombre:titular, estado_reserva:'confirmada'}});
            const parte = {cabana, monto, titular:titularPago, fecha_bloque:fecha, fecha_comprobante:abono,
                codigo_autorizacion:'428016', medio_pago:'webpay_credito', moneda:'CLP',
                tipo_movimiento:'alojamiento', estado_pago:'registrado_en_libro',
                clasificacion_financiera:'pago_real', pago_recibido:true, texto_original:glosa,
                concepto:'CAB ' + cabana, origen:{hoja:'Jun27', celda:'J' + cabana}};
            reservas.push({id:'libro-' + cabana, cabana, titular, fecha_checkin:fecha, fecha_checkout:salida,
                tipo_estadia:'alojamiento', pagos:[], pagos_sin_asociacion:[parte], advertencias:[], servicios:[], notas:[]});
        }
        const cliente = {
            auth:{getSession:async () => ({data:{session:{user:{id:operador}}}})},
            from(tabla) {
                const datos = {reserva_estadias:estadias,pagos}[tabla] || [];
                const consulta = {select:() => consulta,eq:() => consulta,lte:() => consulta,gte:() => consulta,
                    in:() => consulta,order:() => consulta,range:async () => ({data:datos})};
                return consulta;
            }
        };
        const comparar = () => Q.compararSistema(reservas,cliente,{desde:'2027-06-01',hasta:'2027-06-30'});
        const comparacion = await comparar();
        const revisar = Q.crearPlanIncorporacion(reservas,comparacion);
        const partes = revisar.items.filter(item => item.distribucionManual?.tipo === 'webpay_multicabana');
        assert.equal(partes.length, 4);
        assert.ok(partes.every(item => /620\.000/.test(item.aviso) && item.aprobable && !item.seleccionado));
        assert.equal(Q.serializarIncorporacion(revisar).filter(x => x.tipo === 'pago').length, 0);
        const aprobados = new Set(partes.map(x => x.id));
        const plan = Q.crearPlanIncorporacion(reservas,comparacion,new Map(),aprobados);
        const items = Q.serializarIncorporacion(plan).filter(x => x.tipo === 'pago');
        assert.equal(items.length, 1);
        const [item] = items;
        assert.equal(item.argumentos.p_monto, 628000);
        assert.equal(item.datos_origen.distribucion_manual.total_confirmado, 628000);
        assert.deepEqual(item.datos_origen.distribucion_manual.componentes.map(x => [x.cabana,x.monto]), reparto);

        const guardar = async (elemento, operacion = randomUUID()) =>
            (await db.query('select haiku_incorporar_libro_v1($1,$2::jsonb) r',[operacion,JSON.stringify([elemento])])).rows[0].r;
        const contar = async () => (await db.query('select count(*)::integer n from pagos')).rows[0].n;
        const alterado = structuredClone(item);
        delete alterado.datos_origen.distribucion_manual.total_confirmado;
        await assert.rejects(guardar(alterado), /requieren confirmación/);
        const destinoErrado = structuredClone(item);
        destinoErrado.datos_origen.distribucion_manual.componentes[0].estadia_id = randomUUID();
        await assert.rejects(guardar(destinoErrado), /Cambió una estadía/);
        await db.query('update cargos set monto=1000 where id=$1',[cargos[0]]);
        await assert.rejects(guardar(item), /saldo suficiente/);
        assert.equal(await contar(), 0);
        await db.query('update cargos set monto=180000 where id=$1',[cargos[0]]);

        const operacion = randomUUID();
        assert.equal((await guardar(item,operacion)).pagos_creados, 1);
        assert.equal((await guardar(item,operacion)).reintento, true);
        assert.equal((await guardar(item)).omitidos, 1);
        assert.equal(await contar(), 1);
        const aplicado = await db.query('select c.numero, a.monto_aplicado from pago_aplicaciones a join cargos g on g.id=a.cargo_id join reserva_estadias e on e.id=g.estadia_id join cabanas c on c.id=e.cabana_id order by c.numero');
        assert.deepEqual(aplicado.rows.map(x => [x.numero, Number(x.monto_aplicado)]), reparto);
        pagos.push(...JSON.parse(JSON.stringify((await db.query('select * from pagos')).rows)));
        const actualizado = await comparar();
        assert.equal(actualizado.pagosDetalle.filter(x => x.estado === 'en_sistema').length, 4);
    } finally {
        await db.close();
    }
});
