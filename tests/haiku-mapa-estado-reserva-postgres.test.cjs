const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const states = require('../js/haiku-reserva-estado-manual-v1.js');

const read = file => readFileSync(join(__dirname,'..',file),'utf8');
const uid = n => '8ca80000-0000-4000-8000-' + String(n).padStart(12,'0');

test('El mapa distingue llegada y salida y usa la estadía exacta al guardar', async () => {
    const db = new PGlite();
    const [arrival, departure, other] = [1,2,3].map(uid);
    const [arrivingStay, departingStay, groupStay, futureStay] = [5,6,7,8].map(uid);
    const [cabin, cabinGroup, actor] = [9,10,11].map(uid);
    try {
        for (const file of ['tests/fixtures/reserva-estado-manual-schema.sql',
            'supabase/migrations/20260902045000_cancelar_reserva_desde_ficha_supabase.sql',
            'supabase/migrations/20260902162629_reactivar_reserva_cancelada_segura.sql',
            'supabase/migrations/20260928020822_cambio_manual_estado_reserva.sql',
            'supabase/migrations/20261127202611_haiku_mapa_estado_reserva.sql']) {
            await db.exec(read(file));
        }
        await db.exec('grant usage on schema private, auth to authenticated');
        await db.exec('grant select on cabanas,reservas,reserva_estadias,pagos to authenticated');
        const today = (await db.query("select (now() at time zone 'America/Santiago')::date::text as dia")).rows[0].dia;
        await db.query('insert into cabanas(id,numero) values ($1,6),($2,7)',[cabin,cabinGroup]);
        await db.query("insert into reservas(id,estado_reserva,titular_nombre,observaciones) values " +
            "($1,'confirmada','Llegada de prueba','Observación privada'), " +
            "($2,'checked_out','Salida de prueba','Observación privada'), ($3,'pendiente','Reserva futura','')",
            [arrival,departure,other]);
        await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,estado_estadia,fecha_ingreso,fecha_salida,tipo_estadia,checkout_realizado_en) values " +
            "($1,$2,$3,'confirmada',$9::date,$9::date+2,'alojamiento',null), " +
            "($4,$5,$3,'checked_out',$9::date-1,$9::date,'alojamiento',($9::date::timestamp at time zone 'America/Santiago') + interval '1 hour'), " +
            "($6,$2,$10,'confirmada',$9::date,$9::date+2,'alojamiento',null), " +
            "($7,$8,$3,'pendiente',$9::date+4,$9::date+6,'alojamiento',null)",
            [arrivingStay,arrival,cabin,departingStay,departure,groupStay,futureStay,other,today,cabinGroup]);
        await db.query('insert into pagos(reserva_id,monto) values ($1,10000)',[arrival]);
        const section = async (ids, number=6, date=today) => (await db.query(
            'select public.haiku_mapa_reservas_cabana_v1($1,$2,$3) as data',[number,date,ids])).rows[0].data;
        await db.exec('set role anon');
        await assert.rejects(() => section([arrivingStay]),{code:'42501'});
        await db.exec('set role authenticated');
        await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
        const incoming = [arrivingStay, departingStay];
        const map = await section(incoming);
        assert.deepEqual(map.fichas.map(f => f.estadia_id),incoming);
        const [arrivalCard,departureCard] = map.fichas;
        assert.equal(arrivalCard.tiene_abono_confirmado,true);
        assert.equal(arrivalCard.reserva.observaciones,undefined);
        assert.equal(arrivalCard.pagos,undefined);
        assert.equal(arrivalCard.estadias.length,2,'La validación incluye la otra cabaña de la reserva.');
        assert.equal(states.actual(departureCard,departureCard.estadias[0]),'checked_out');
        assert.deepEqual((await section([])).fichas.map(f => f.estadia_id),[departingStay]);
        assert.deepEqual((await section([groupStay,futureStay])).fichas.map(f => f.estadia_id),[departingStay]);
        await assert.rejects(() => section(incoming,12),{code:'22023'});
        await db.exec("set test.sin_permiso = 'reservas.editar'");
        assert.equal((await section(incoming)).puede_editar,false);
        await db.exec("set test.sin_permiso = 'reservas.ver'");
        await assert.rejects(() => section(incoming),{code:'42501'});
        await db.exec('reset test.sin_permiso');

        const writes = async (state,card) => (await db.query(
            'select public.haiku_cambiar_estado_reserva_manual_v1($1,$2,$3,$4::jsonb) as data',
            [card.reserva.id,card.estadia_id,state,JSON.stringify(states.esperado(card))])).rows[0].data;
        assert.equal((await writes('hospedada',arrivalCard)).estado,'hospedada');
        const [arrived] = (await section(incoming)).fichas;
        assert.equal(arrived.estadias.find(e=>e.id===groupStay).estado_estadia,'confirmada');
        await assert.rejects(() => writes('checked_out',arrivalCard),{code:'40001'});
        assert.equal((await writes('checked_out',arrived)).estado,'checked_out');
        assert((await section([])).fichas.some(f=>f.estadia_id===arrivingStay));
        await db.exec('reset role');
        assert.equal((await db.query('select monto from pagos where reserva_id=$1',[arrival])).rows[0].monto,10000);
        assert.equal((await db.query('select count(*)::integer as total from eventos_auditoria')).rows[0].total,2);
    } finally {
        await db.close();
    }
});
