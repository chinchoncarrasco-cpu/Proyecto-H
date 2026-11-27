const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const read = file => readFileSync(join(__dirname, '..', file), 'utf8');
const uuid = n => 'ee040000-0000-4000-8000-' + String(n).padStart(12, '0');

test('Mapa lee estadías del esquema de Haku, filtra huéspedes tras check-out y protege las ediciones', async () => {
    const db = new PGlite();
    const [actor, member, reservation, stay, cabin, car, action, marker, markerAction] =
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map(uuid);
    const [companion, stayCompanion, reservationWithoutProfile, confirmedStay, cleaningUser] =
        [12, 13, 14, 15, 16].map(uuid);
    try {
        await db.exec(read('tests/fixtures/huespedes-schema.sql'));
        await db.exec(read('supabase/migrations/20261120205010_haku_huespedes_v1_1.sql'));
        await db.exec(`
            set time zone 'America/Santiago';
            alter table public.reserva_estadias add column checkin_realizado_en timestamptz;
            create table public.aseos (id uuid primary key, cabana_id uuid, fecha date, estado text,
                iniciado_en timestamptz, completado_en timestamptz, observaciones text);
            create table public.catalogo_servicios (id uuid primary key, codigo text, nombre text,
                duracion_minutos integer, capacidad_maxima integer, activo boolean, orden_visual integer);
            create table public.servicios (id uuid primary key, catalogo_servicio_id uuid, estadia_id uuid,
                fecha_servicio date, hora_inicio time, hora_fin time, estado_servicio text);
            grant select on public.aseos, public.catalogo_servicios, public.servicios to authenticated;
            create function public.haiku_tareas_generales_dia_v1(date) returns jsonb language sql stable
                as $$ select '{"tareas":[]}'::jsonb $$;
            create function public.haiku_operacion_dia(date)
                returns table(cabana_id uuid, numero smallint, estado_operativo text, ingreso_checkin_en timestamptz,
                    aseo_estado text, aseo_id uuid, continua_reserva_id uuid, ingreso_reserva_id uuid,
                    fullday_reserva_id uuid, salida_reserva_id uuid)
                language sql stable as $$
                    select b.id, b.numero, 'continua', s.checkin_realizado_en, null::text, null::uuid,
                        s.reserva_id, null::uuid, null::uuid, null::uuid
                    from public.cabanas b join public.reserva_estadias s on s.cabana_id=b.id
                    where s.fecha_ingreso <= $1 and s.fecha_salida >= $1
                $$;
        `);
        await db.exec(read('supabase/migrations/20261127054554_haiku_mapa_recinto_v1.sql'));
        await db.query('insert into public.usuarios(id,nombre) values($1,\'Recepción de prueba\')', [actor]);
        await db.query('insert into private.permisos select $1::uuid, unnest($2::text[])',
            [actor, ['cabanas.ver', 'reservas.ver', 'huespedes.ver', 'huespedes.gestionar', 'servicios.ver']]);
        await db.query("insert into public.usuarios(id,nombre) values($1,'Aseo de prueba')", [cleaningUser]);
        await db.query("insert into private.permisos values($1,'cabanas.ver')", [cleaningUser]);
        await db.query('insert into public.huespedes(id,nombre) values($1,\'Huésped ficticio\')', [member]);
        await db.query('insert into public.reservas(id,titular_huesped_id,titular_nombre) values($1,$2,\'Huésped ficticio\')', [reservation, member]);
        await db.query('insert into public.cabanas(id,numero) values($1,5)', [cabin]);
        await db.query(`
            insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,
                adultos,estado_estadia,checkin_realizado_en)
            values($1,$2,$3,current_date - 1,current_date + 1,1,'hospedada',now() - interval '1 day')
        `, [stay, reservation, cabin]);
        await db.query("insert into public.huespedes(id,nombre,apellido) values ($1,'  Primera  ',' Acompañante '), ($2,'Segunda','Acompañante')",
            [companion, stayCompanion]);
        await db.query('insert into public.reserva_huespedes values ($1,$2)', [reservation, companion]);
        await db.query('insert into public.estadia_huespedes values ($1,$2), ($1,$3)', [stay, companion, stayCompanion]);
        await db.query("insert into public.reservas(id,titular_nombre) values ($1,'Titular de registro anterior')", [reservationWithoutProfile]);
        await db.query(`
            insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,adultos)
            values ($1,$2,$3,current_date,current_date+1,2)
        `, [confirmedStay, reservationWithoutProfile, cabin]);
        await db.exec('set role anon');
        const snapshot = async () => (await db.query('select public.haiku_mapa_dia_v1() as mapa')).rows[0].mapa;
        await assert.rejects(snapshot, { code: '42501' });
        await db.exec('set role authenticated');
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
        const initial = await snapshot();
        assert.equal(initial.cabanas[0].numero, 5);
        assert.equal(initial.personas.find(p => p.id === member).hospedado, true);
        assert.equal(initial.personas.filter(p => p.id === companion).length, 1);
        assert.equal(initial.personas.find(p => p.id === companion).nombre, 'Primera Acompañante');
        assert.equal(initial.personas.find(p => p.id === stayCompanion).rol, 'acompanante');
        assert.equal(initial.personas.find(p => p.reserva_id === reservationWithoutProfile).hospedado, false);
        assert.equal(initial.personas.length, 4);
        assert.deepEqual(initial.elementos, []);

        await db.exec('reset role');
        await db.exec(read('supabase/migrations/20261127183314_haiku_mapa_carga_agil.sql'));
        await db.exec('set role anon');
        await assert.rejects(snapshot, { code: '42501' });
        await db.exec('set role authenticated');
        assert.deepEqual(await snapshot(), initial);
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [cleaningUser]);
        assert.deepEqual((await snapshot()).personas, []);
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);

        const save = async (id, kind, data, request) => (await db.query(
            "select public.haiku_mapa_guardar_v1($1,$2,0,'guardar',$3,$4) as cambio",
            [id, kind, JSON.stringify(data), request],
        )).rows[0].cambio;
        const vehicle = { puesto:8, patente:'QA AB-47', vehiculo:'SUV', estacionado:true, reserva_id:reservation };
        assert.equal((await save(car, 'vehiculo', vehicle, action)).revision, 1);
        assert.equal((await save(car, 'vehiculo', vehicle, action)).repetido, true);
        assert.equal((await snapshot()).elementos[0].datos.patente, 'QAAB47');
        await assert.rejects(() => db.query('update public.haiku_mapa_elementos set activo=false'), { code: '42501' });
        const person = { persona_id:member, reserva_id:reservation, x:742, y:1260 };
        await save(marker, 'persona', person, markerAction);
        assert((await snapshot()).elementos.some(e => e.id === marker));
        await db.exec('reset role');
        await db.query("update public.reserva_estadias set estado_estadia='checked_out',checkout_realizado_en=now() where id=$1", [stay]);
        await db.exec('set role authenticated');
        assert.equal((await snapshot()).personas.find(p => p.id === member).hospedado, false);
        assert.equal((await snapshot()).elementos.some(e => e.id === marker), false);
        await assert.rejects(() => save(uuid(10), 'persona', person, uuid(11)), { code: '22023' });
    } finally {
        await db.close();
    }
});
