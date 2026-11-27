const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const read = file => readFileSync(join(__dirname, '..', file), 'utf8');
const uid = n => '1aec0000-0000-4000-8000-' + String(n).padStart(12, '0');

test('El mapa guarda el aseo diario con las mismas filas y permisos que Cabañas', async () => {
    const db = new PGlite();
    const [manager, reader, assignee, guestUser, cabin, stay] = [1,2,3,4,5,6].map(uid);
    try {
        await db.exec(read('tests/fixtures/huespedes-schema.sql'));
        await db.exec(`
            alter table public.cabanas add column activa boolean not null default true;
            create table public.aseos (
                id uuid primary key default gen_random_uuid(), fecha date not null, cabana_id uuid not null,
                tipo_aseo text not null, estado text not null, creado_por uuid, asignado_a uuid,
                estadia_salida_id uuid, estadia_ingreso_id uuid, encargado_nombre text, revisor_nombre text,
                iniciado_en timestamptz, completado_en timestamptz, observaciones text,
                actualizado_en timestamptz not null default clock_timestamp(), unique(fecha,cabana_id)
            );
            create function public.set_test_version() returns trigger language plpgsql as $$
              begin new.actualizado_en := clock_timestamp(); return new; end
            $$;
            create trigger test_aseo_version before update on public.aseos
                for each row execute function public.set_test_version();
            alter table public.aseos enable row level security;
            grant select,insert,update on public.aseos to authenticated;
            create policy read_aseo on public.aseos for select to authenticated using (
                private.haiku_usuario_activo() and (private.haiku_tiene_permiso('aseos.ver_todos') or
                (asignado_a=auth.uid() and private.haiku_tiene_permiso('aseos.ver_asignados')))
            );
            create policy insert_aseo on public.aseos for insert to authenticated
                with check (private.haiku_tiene_permiso('aseos.gestionar_todos'));
            create policy edit_aseo on public.aseos for update to authenticated using (
                private.haiku_tiene_permiso('aseos.gestionar_todos') or
                (asignado_a=auth.uid() and private.haiku_tiene_permiso('aseos.gestionar_asignados'))
            );
            create function public.haiku_operacion_dia(date)
                returns table(cabana_id uuid,salida_estadia_id uuid,ingreso_estadia_id uuid)
                language sql stable as $$
                    select id, '1aec0000-0000-4000-8000-000000000006'::uuid, null::uuid
                    from public.cabanas where activa
                $$;
        `);
        await db.exec(read('supabase/migrations/20261127180820_haiku_mapa_aseo_inline.sql'));
        for (const [id, permissions] of [
            [manager, ['cabanas.ver','reservas.ver','aseos.ver_todos','aseos.gestionar_todos']],
            [reader, ['cabanas.ver','aseos.ver_todos']],
            [assignee, ['cabanas.ver','aseos.ver_asignados','aseos.gestionar_asignados']],
            [guestUser, ['cabanas.ver']],
        ]) {
            await db.query("insert into public.usuarios(id,nombre) values($1,'Cuenta ficticia')", [id]);
            await db.query('insert into private.permisos select $1::uuid,unnest($2::text[])', [id, permissions]);
        }
        await db.query('insert into public.cabanas(id,numero) values($1,1)', [cabin]);
        const call = async (patch = null, version = null, dayOffset = 0) => (await db.query(`
            select public.haiku_mapa_aseo_v1(1,(now() at time zone 'America/Santiago')::date + $3::int,$1,$2) as result
        `, [patch === null ? null : JSON.stringify(patch), version, dayOffset])).rows[0].result;
        async function login(user) {
            await db.exec('set role authenticated');
            await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
        }
        await db.exec('set role anon');
        await assert.rejects(() => call(), {code:'42501'});
        await login(guestUser);
        assert.equal((await call()).puede_leer, false);
        await assert.rejects(() => call({inicio:'12:00'}), {code:'42501'});
        await login(manager);
        assert.equal((await call()).version, null);
        await assert.rejects(() => call({inicio:'12:00'}, null, -1), {code:'22023'});
        await assert.rejects(() => call({fin:'12:15'}), {code:'22023'});
        await assert.rejects(() => call({no_requiere:true,inicio:'12:00'}), {code:'22023'});
        await assert.rejects(() => call({cabana_id:cabin}), {code:'22023'});
        const started = await call({encargado:'Camarera ficticia',inicio:'12:00'});
        assert.equal(started.estado, 'en_proceso');
        await assert.rejects(() => call({encargado:'Edición que perdió la carrera'}), {code:'40001'});
        await assert.rejects(() => call({fin:'11:50'}, started.version), {code:'22023'});
        const done = await call({fin:'12:45',observacion:'Aseo de prueba'}, started.version);
        assert.equal(done.estado, 'completado');
        assert.equal(done.encargado, started.encargado);
        assert.equal(done.inicio, started.inicio);
        await assert.rejects(() => call({fin:'12:50'}, started.version), {code:'40001'});
        await login(reader);
        assert.equal((await call()).observacion, 'Aseo de prueba');
        assert.equal((await call()).puede_editar, false);
        await assert.rejects(() => call({fin:'12:50'}, done.version), {code:'42501'});
        await login(assignee);
        assert.equal((await call()).puede_leer, false);
        await db.exec('reset role');
        await db.query('update public.aseos set asignado_a=$1 where cabana_id=$2',[assignee,cabin]);
        await login(assignee);
        const assigned = await call();
        assert.equal(assigned.puede_editar, true);
        const checked = await call({revisor:'Revisor ficticio'},assigned.version);
        assert.equal(checked.estado, 'completado');
        assert.equal(checked.fin, done.fin);
        const changed = await call({inicio:'',fin:'',no_requiere:true},checked.version);
        assert.equal(changed.estado, 'no_requiere');
        const row = (await db.query('select cabana_id,asignado_a,estadia_salida_id from public.aseos')).rows[0];
        assert.deepEqual(row,{cabana_id:cabin,asignado_a:assignee,estadia_salida_id:stay});
    } finally {
        await db.close();
    }
});
