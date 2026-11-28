const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const read = file => readFileSync(join(__dirname, '..', file), 'utf8');
const uuid = n => 'ee040000-0000-4000-8000-' + String(n).padStart(12, '0');

test('Mapa y Huéspedes comparten vehículos y conservan las reglas de estadías, checkout y permisos', async () => {
    const db = new PGlite();
    const [actor, member, reservation, stay, cabin, car, action, marker, markerAction] =
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map(uuid);
    const [companion, stayCompanion, reservationWithoutProfile, confirmedStay, cleaningUser] =
        [12, 13, 14, 15, 16].map(uuid);
    try {
        await db.exec(read('tests/fixtures/huespedes-schema.sql'));
        await db.exec(read('supabase/migrations/20261120205010_haku_huespedes_v1_1.sql'));
        await db.exec(read('supabase/migrations/20261121003000_haku_huespedes_directorio_foto.sql'));
        await db.exec(read('supabase/migrations/20261122233716_huespedes_fotos_vehiculo.sql'));
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
                    fullday_reserva_id uuid, salida_reserva_id uuid, continua_estadia_id uuid, ingreso_estadia_id uuid,
                    fullday_estadia_id uuid, salida_estadia_id uuid)
                language sql stable as $$
                    select b.id, b.numero,
                        case when s.fecha_ingreso=s.fecha_salida then 'fullday'
                            when s.fecha_ingreso=$1 then 'libre-ingresa' else 'continua' end,
                        s.checkin_realizado_en, null::text, null::uuid,
                        case when s.fecha_ingreso<$1 then s.reserva_id end,
                        case when s.fecha_ingreso=$1 and s.fecha_salida>$1 then s.reserva_id end,
                        case when s.fecha_ingreso=s.fecha_salida then s.reserva_id end, null::uuid,
                        case when s.fecha_ingreso<$1 then s.id end,
                        case when s.fecha_ingreso=$1 and s.fecha_salida>$1 then s.id end,
                        case when s.fecha_ingreso=s.fecha_salida then s.id end, null::uuid
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
        await db.query("insert into public.usuarios(id,nombre) values($1,'Huéspedes de prueba')", [uuid(17)]);
        await db.query('insert into private.permisos select $1::uuid, unnest($2::text[])',
            [uuid(17), ['reservas.ver', 'huespedes.ver', 'huespedes.gestionar']]);
        await db.query('insert into public.huespedes(id,nombre) values($1,\'Huésped ficticio\')', [member]);
        await db.query('insert into public.reservas(id,titular_huesped_id,titular_nombre) values($1,$2,\'Huésped ficticio\')', [reservation, member]);
        await db.query('insert into public.cabanas(id,numero) values($1,5)', [cabin]);
        await db.query(`
            insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,
                adultos,ninos,estado_estadia,checkin_realizado_en)
            values($1,$2,$3,current_date - 1,current_date + 1,1,2,'hospedada',now() - interval '1 day')
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

        const save = async (id, kind, data, request, revision = 0, action = 'guardar') => (await db.query(
            'select public.haiku_mapa_guardar_v1($1,$2,$3,$4,$5,$6) as cambio',
            [id, kind, revision, action, JSON.stringify(data), request],
        )).rows[0].cambio;
        const profile = async (person = member, reserve = reservation) => (await db.query(
            'select public.haiku_huesped_perfil_v1($1,$2,false) as ficha', [person, reserve],
        )).rows[0].ficha;
        const saveProfile = async vehicle => (await db.query(
            "select public.haiku_huesped_guardar_v1($1,$2,'vehiculo',$3) as cambio",
            [member, reservation, JSON.stringify(vehicle)],
        )).rows[0].cambio;
        const parked = async number => (await snapshot()).elementos.find(e => e.puesto === number);
        const vehicle = { puesto:8, patente:'QA AB-47', vehiculo:'SUV', estacionado:true, reserva_id:reservation };
        assert.equal((await save(car, 'vehiculo', vehicle, action)).revision, 1);
        assert.equal((await save(car, 'vehiculo', vehicle, action)).repetido, true);
        assert.equal((await parked(8)).datos.patente, 'QAAB47');
        const originalMovement = (await parked(8)).datos;
        assert.deepEqual((await profile()).vehiculos, []);

        // Existing parked-only, matching profile, and unlinked registrations before the migration.
        const [matched, matchedMap, unlinked, additional, newMap, freeProfile] = [20, 21, 22, 23, 24, 25].map(uuid);
        await saveProfile({id:matched,tipo:'Camioneta',modelo:'Marca ya registrada',patente:'PZ 11-23'});
        const parkedWithProfile = {...vehicle,puesto:9,patente:'pz1123',color:'Cereza'};
        await save(matchedMap,'vehiculo',parkedWithProfile,uuid(40));
        await save(unlinked,'vehiculo',{...vehicle,puesto:10,patente:'RN8899',reserva_id:null},uuid(41));
        await db.exec('reset role');
        const photo = actor + '/' + additional + '.jpg';
        await db.query('update public.haiku_huesped_vehiculos set foto=$2, fotos_adicionales=array[$3] where id=$1',
            [matched,photo,actor + '/' + uuid(26) + '.jpg']);
        await db.exec(read('supabase/migrations/20261127200953_haiku_vehiculos_mapa_huespedes.sql'));
        await db.exec('set role authenticated');
        const afterMigration = (await profile()).vehiculos;
        const fromMap = afterMigration.find(v => v.patente === 'QAAB47');
        assert.equal(afterMigration.length,2);
        assert.deepEqual(fromMap.estacionamiento,{puesto:8,estacionado:true});
        assert.equal((await parked(8)).vehiculo_id,fromMap.id);
        assert.deepEqual((await parked(8)).datos,originalMovement);
        assert.equal((await parked(9)).vehiculo_id,matched);
        assert.equal((await parked(9)).datos.vehiculo,'Camioneta');
        assert.equal((await parked(9)).datos.modelo,'Marca ya registrada');
        assert.equal(afterMigration.find(v => v.id === matched).foto,photo);
        assert.equal((await parked(10)).vehiculo_id,null);
        assert.equal((await save(car,'vehiculo',vehicle,action)).repetido,true);

        const [fullDay, fullDayCabin, future] = [29, 30, 31].map(uuid);
        await db.exec('reset role');
        await db.query('insert into public.cabanas(id,numero) values($1,6)',[fullDayCabin]);
        await db.query(`insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,adultos)
            values ($1,$2,$3,current_date,current_date,2), ($4,$2,$3,current_date+2,current_date+3,2)`,
            [fullDay, reservationWithoutProfile, fullDayCabin, future]);
        await db.exec('set role authenticated');
        const beforeOccupancy = await snapshot();
        await db.exec('reset role');
        await db.exec(read('supabase/migrations/20261127223323_haiku_mapa_ocupacion_estadias.sql'));
        await db.exec(read('supabase/migrations/20261127223413_haiku_mapa_puestos_adicionales.sql'));
        await db.exec(read('supabase/migrations/20261127233716_haiku_mapa_hospedaje_estacionamientos.sql'));
        const checkoutMigration = read('supabase/migrations/20261128030143_haiku_mapa_checkout_estadia.sql');
        await db.exec(checkoutMigration);
        await db.exec(checkoutMigration);
        await db.exec('set role authenticated');
        const {ocupacion_estadias, ...sameMap} = await snapshot();
        assert.deepEqual(sameMap, beforeOccupancy);
        assert.deepEqual(ocupacion_estadias, {
            [confirmedStay]: {huespedes:2,noches:1,por_llegar:true,hospedada:false,checked_out:false},
            [stay]: {huespedes:3,noches:2,por_llegar:false,hospedada:true,checked_out:false},
            [fullDay]: {huespedes:2,noches:0,por_llegar:true,hospedada:false,checked_out:false},
        });
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [cleaningUser]);
        assert.deepEqual((await snapshot()).ocupacion_estadias,{});
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);

        await saveProfile({id:fromMap.id,tipo:'Sedán',modelo:'Modelo de prueba',color:'Cereza',patente:'QAAB48',version:fromMap.fecha});
        let park = await parked(8);
        assert.equal(park.datos.patente,'QAAB48');
        assert.equal(park.datos.modelo,'Modelo de prueba');
        assert.equal(park.datos.llegada,originalMovement.llegada);
        await assert.rejects(() => saveProfile({id:fromMap.id,tipo:'SUV',patente:'QAAB49',version:fromMap.fecha}), {code:'40001'});
        await assert.rejects(() => saveProfile({id:fromMap.id,tipo:'SUV',patente:'PZ1123'}), /ya está registrada en la ficha/);
        await assert.rejects(() => saveProfile({id:fromMap.id,tipo:'SUV',patente:'RN8899'}), /asignada a otro puesto/);
        await assert.rejects(() => saveProfile({id:fromMap.id,tipo:'SUV',patente:''}), /necesita una patente válida/);
        await assert.rejects(() => save(car,'vehiculo',vehicle,uuid(42),2), {code:'40001'});
        await save(car,'vehiculo',{...vehicle,patente:'QAAB48',vehiculo:'Sedán',modelo:'Editado en mapa',color:'Cereza',
            nota:'Recibe llamado para la salida'},uuid(43),park.revision);
        assert.equal((await profile()).vehiculos.find(v => v.id === fromMap.id).modelo,'Editado en mapa');
        park = await parked(8);
        await save(car,'vehiculo',{},uuid(44),park.revision,'salida');
        assert.deepEqual((await profile()).vehiculos.find(v => v.id === fromMap.id).estacionamiento,{puesto:8,estacionado:false});
        assert.equal((await snapshot()).ocupacion_estadias[stay].hospedada,true);
        park = await parked(8);
        await save(car,'vehiculo',{},uuid(45),park.revision,'retirar');
        assert.equal(await parked(8),undefined);
        assert.equal((await profile()).vehiculos.find(v => v.id === fromMap.id).estacionamiento,null);

        // Reuse a vehicle registered first in Huéspedes and keep its photos/person separate from another reservation.
        await saveProfile({id:freeProfile,tipo:'Vehículo familiar',modelo:'Otro modelo'});
        const previous = (await profile()).vehiculos.find(v => v.id === freeProfile);
        const choose = {...vehicle,puesto:8,patente:'AW4455',vehiculo:'Otro',modelo:'Otro modelo',
            vehiculo_id:freeProfile,vehiculo_version:previous.fecha};
        await save(newMap,'vehiculo',choose,uuid(46));
        assert.equal((await parked(8)).vehiculo_id,freeProfile);
        assert.equal((await parked(8)).datos.vehiculo,'Vehículo familiar');
        assert.equal((await profile()).vehiculos.length,3);
        await assert.rejects(() => save(uuid(27),'vehiculo',{...choose,puesto:7,reserva_id:reservationWithoutProfile},
            uuid(47)), /no pertenece a esta reserva/);
        assert.equal(await parked(7),undefined);
        await assert.rejects(() => saveProfile({id:uuid(28),tipo:'SUV',patente:'AW 44-55'}), /ya está registrada en la ficha/);
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uuid(17)]);
        assert.equal((await profile()).vehiculos.find(v => v.id === freeProfile).estacionamiento,null);
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [cleaningUser]);
        await assert.rejects(profile, {code:'42501'});
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
        await assert.rejects(() => db.query('update public.haiku_mapa_elementos set activo=false'), { code: '42501' });
        const person = { persona_id:member, reserva_id:reservation, x:742, y:1260 };
        await save(marker, 'persona', person, markerAction);
        assert((await snapshot()).elementos.some(e => e.id === marker));
        const [primaryCar, secondCar, overflowCar, ownerCar] = [50, 51, 52, 53].map(uuid);
        await save(primaryCar,'vehiculo',{...vehicle,puesto:7,patente:'QA7001'},uuid(61));
        await save(secondCar,'vehiculo',{...vehicle,puesto:12,patente:'QA7002'},uuid(62));
        const vehicleProfiles = (await profile()).vehiculos;
        assert.deepEqual(vehicleProfiles.find(v => v.patente === 'QA7001').estacionamiento,{puesto:7,estacionado:true});
        assert.deepEqual(vehicleProfiles.find(v => v.patente === 'QA7002').estacionamiento,{puesto:12,estacionado:true,etiqueta:'Puesto 7B'});
        assert.equal((await parked(12)).reserva_id,reservation);
        await assert.rejects(() => save(uuid(54),'vehiculo',{...vehicle,puesto:12,patente:'QA7099'},uuid(63)), /ya figura en el mapa/);
        assert.equal((await profile()).vehiculos.length,vehicleProfiles.length);
        await save(overflowCar,'vehiculo',{...vehicle,puesto:15,patente:'QA1501'},uuid(64));
        assert.equal((await profile()).vehiculos.find(v => v.patente === 'QA1501').estacionamiento.etiqueta,'Adicional');
        await assert.rejects(() => save(ownerCar,'vehiculo',{...vehicle,puesto:16,patente:'QA1601'},uuid(65)), /puesto de la dueña/);
        await save(ownerCar,'vehiculo',{...vehicle,puesto:16,patente:'QA1601',reserva_id:null},uuid(66));
        assert.equal((await parked(16)).vehiculo_id,null);
        await assert.rejects(() => save(uuid(55),'vehiculo',{...vehicle,puesto:17,patente:'QA1701'},uuid(67)), /Revisa el puesto/);

        await db.exec('reset role');
        await db.query('update public.reserva_estadias set checkout_realizado_en=now() where id=$1', [stay]);
        await db.query(`update public.reserva_estadias set estado_estadia='checked_out',
            checkin_realizado_en=now() - interval '1 hour', checkout_realizado_en=null where id=$1`, [confirmedStay]);
        await db.exec('set role authenticated');
        const after = await snapshot();
        assert.equal(after.personas.find(p => p.id === member).hospedado,false);
        assert.equal(after.ocupacion_estadias[stay].hospedada,false);
        assert.equal(after.ocupacion_estadias[stay].checked_out,true);
        assert.equal(after.cabanas.find(row => row.ingreso_estadia_id === confirmedStay).estado_operativo,'libre-ingresa');
        assert.deepEqual(after.ocupacion_estadias[confirmedStay],
            {huespedes:2,noches:1,por_llegar:false,hospedada:false,checked_out:true});
        assert.equal(after.ocupacion_estadias[fullDay].checked_out,false);
        assert.equal(after.elementos.some(e => e.id === marker),false);
        await assert.rejects(() => save(uuid(10), 'persona', person, uuid(11)), { code: '22023' });

        await db.exec('reset role');
        await db.exec(`
            alter table public.cabanas add column activa boolean not null default true;
            create table public.notas (id uuid primary key default gen_random_uuid(), reserva_id uuid, estadia_id uuid,
                cabana_id uuid, fecha_operacion date, tipo text, texto text, creado_en timestamptz);
            grant select on public.notas to authenticated;
            alter table public.notas enable row level security;
            create policy notas_select on public.notas for select to authenticated
                using (private.haiku_usuario_activo() and private.haiku_tiene_permiso('notas.ver'));
        `);
        const emptyCabin = uuid(74);
        await db.query('insert into public.cabanas(id,numero) values($1,11)',[emptyCabin]);
        await db.query("insert into private.permisos values($1,'notas.ver')", [actor]);
        await db.query(`insert into public.notas (reserva_id,estadia_id,cabana_id,fecha_operacion,tipo,texto,creado_en) values
            ($1,$2,$3,current_date,'operativa_resumen','Entregar espumante',now()),
            ($1,null,$4,current_date,'operativa_resumen','Cortesía a las 09:00',now()+interval '1 minute'),
            ($5,null,$4,current_date,'operativa_resumen','Dejar batas',now()),
            (null,null,$6,current_date,'operativa_resumen','Revisar canasta',now()),
            ($1,null,null,current_date,'operativa_resumen','Sin cabaña identificada',now()),
            (null,null,$3,current_date,'operativa_resumen','  ',now()),
            (null,null,$3,current_date+1,'operativa_resumen','Encargo de mañana',now()),
            (null,null,$3,current_date,'reserva','Nota de otro tipo',now())`,
        [reservationWithoutProfile,fullDay,cabin,fullDayCabin,reservation,emptyCabin]);
        const notesMigration = read('supabase/migrations/20261128040620_haiku_mapa_notas_resumen.sql');
        await db.exec(notesMigration);
        await db.exec(notesMigration);
        await db.exec('set role authenticated');
        const {notas_resumen, ...mapWithoutNotes} = await snapshot();
        assert.deepEqual(mapWithoutNotes,after);
        assert.deepEqual(notas_resumen,{
            5:['Dejar batas'], 6:['Entregar espumante','Cortesía a las 09:00'], 11:['Revisar canasta'],
        });
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [cleaningUser]);
        assert.deepEqual((await snapshot()).notas_resumen,{});

        await db.exec('reset role');
        await db.query(`insert into public.catalogo_servicios values
            ($1,'lateCheckout','Late Check-out',null,null,true,1),
            ($2,'tinajaTonel','Tinaja Tonel',60,3,true,2)`, [uuid(75),uuid(76)]);
        await db.query(`insert into public.servicios values
            ($1,$7,$9,current_date,'13:30','14:30','programado'),
            ($2,$7,$9,current_date,'14:00','15:00','cancelado'),
            ($3,$7,$9,current_date+1,'13:30','14:30','programado'),
            ($4,$7,$9,current_date,null,null,'programado'),
            ($5,$7,null,current_date,'16:00','17:00','programado'),
            ($6,$8,$10,current_date,'10:00','11:00','realizado')`,
        [77,78,79,80,81,82,75,76].map(uuid).concat(stay,fullDay));
        const agendaMigration = read('supabase/migrations/20261128043618_haiku_mapa_agenda_cabanas.sql');
        await db.exec(agendaMigration);
        await db.exec(agendaMigration);
        await db.exec('set role authenticated');
        assert.deepEqual((await snapshot()).agenda,[]);
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
        const agenda = (await snapshot()).agenda;
        assert.deepEqual(agenda.map(({codigo,numero,hora,estado}) => ({codigo,numero,hora,estado})),[
            {codigo:'tinajaTonel',numero:6,hora:'10:00:00',estado:'realizado'},
            {codigo:'lateCheckout',numero:5,hora:'13:30:00',estado:'programado'},
        ]);
    } finally {
        await db.close();
    }
});
