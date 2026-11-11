const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const core = require('../js/revision-plantilla-core-v1.js');

const migrations = path.join(__dirname, '..', 'supabase', 'migrations');
const migration = fs.readFileSync(path.join(migrations,
    fs.readdirSync(migrations).find(file => file.endsWith('_haku_personalizar_revision_completa_v1.sql'))), 'utf8');

const admin = '10000000-0000-4000-8000-000000000001';
const team = '10000000-0000-4000-8000-000000000002';
const cabin = '20000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
const fridge = '30000000-0000-4000-8000-000000000001';
const coffee = '30000000-0000-4000-8000-000000000002';
const towels = '30000000-0000-4000-8000-000000000003';

const baseline = [
    "create schema auth; create schema private; create role anon; create role authenticated;",
    "grant usage on schema auth, private to authenticated;",
    "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
    "create function private.haiku_usuario_activo() returns boolean language sql stable as $$ select auth.uid() is not null $$;",
    "create function private.haiku_tiene_permiso(p text) returns boolean language sql stable as $$ select auth.uid() is not null and (p <> 'configuracion.gestionar' or auth.uid() = '" + admin + "'::uuid) $$;",
    "create table usuarios(id uuid primary key,nombre text not null);",
    "create table cabanas(id uuid primary key,numero smallint not null,activa boolean not null default true);",
    "create table checklist_items(id uuid primary key default gen_random_uuid(),nombre text not null,categoria text not null);",
    "create table cabana_checklist_config(cabana_id uuid references cabanas,checklist_item_id uuid references checklist_items,legacy_checklist_id text,subarea text,orden_visual int,activo bool not null default true,obligatorio bool not null default true,cantidad_esperada int,unique(cabana_id,checklist_item_id));",
    "create table checklist_plantillas(id uuid primary key,codigo text not null unique,nombre text not null,tipo text);",
    "create table checklist_plantilla_items(plantilla_id uuid references checklist_plantillas,checklist_item_id uuid references checklist_items,obligatorio boolean not null,orden_visual int,unique(plantilla_id,checklist_item_id));",
    "create table revisiones_cabana(id uuid primary key default gen_random_uuid(),cabana_id uuid references cabanas,fecha date not null,tipo_revision text,estado text not null default 'pendiente',plantilla_id uuid references checklist_plantillas,creado_en timestamptz not null default now());",
    "create table revision_items(revision_id uuid references revisiones_cabana,checklist_item_id uuid references checklist_items,estado text,cantidad_esperada int,unique(revision_id,checklist_item_id));",
    "grant select,insert,update on revisiones_cabana,revision_items to authenticated;",
    "insert into usuarios values ('" + admin + "','Administrador QA'),('" + team + "','Recepción QA');",
    "insert into cabanas values ('" + cabin + "',1,true),('" + other + "',2,true);",
    "insert into checklist_items values ('" + fridge + "','Refri','Cocina'),('" + coffee + "','Cafetera','Cocina'),('" + towels + "','Toallas','Baño');",
    "insert into cabana_checklist_config(cabana_id,checklist_item_id,legacy_checklist_id,subarea,orden_visual,obligatorio,cantidad_esperada) values "
        + "('" + cabin + "','" + fridge + "','0-0-0','Subárea 1',1,true,1),"
        + "('" + cabin + "','" + coffee + "','0-0-1','Subárea 1',2,false,2),"
        + "('" + cabin + "','" + towels + "','1-0',null,3,true,4),"
        + "('" + other + "','" + fridge + "','0-0-0','Subárea 1',1,true,1);",
].join('\n');

test('el editor conserva claves y deshacer el orden deja el borrador sin cambios', () => {
    const original = [{ id: '0-0', label: 'Subárea 1', items: [
        { id: '0-0-0', label: 'Refri', active: true, itemId: fridge, expected: 1 },
        { id: '0-0-1', label: 'Cafetera', active: true, itemId: coffee, expected: 2 },
    ] }];
    let draft = core.moveItem(original, '0-0', '0-0-1', -1);
    assert.deepEqual(core.changes(original, draft), [{ kind: 'move', label: 'Cafetera', detail: 'Posición 2 → 1' }]);
    draft = core.moveItem(draft, '0-0', '0-0-1', 1);
    assert.deepEqual(core.changes(original, draft), []);
    draft = core.renameItem(draft, '0-0', '0-0-0', ' Refrigerador ');
    draft = core.setItemActive(draft, '0-0', '0-0-1', false);
    assert.equal(draft[0].items[0].itemId, fridge);
    assert.equal(original[0].items[0].label, 'Refri');
    assert.deepEqual(core.payload(draft)[0].items, [
        { id: '0-0-0', label: 'Refrigerador', active: true },
        { id: '0-0-1', label: 'Cafetera', active: false },
    ]);
    assert.equal(core.validLabel('  '), false);
    assert.equal(core.validLabel('Café 🍵'), true);
});

test('la publicación versiona por cabaña y deja revisiones, checks, cantidades y permisos en su alcance', async () => {
    const db = new PGlite();
    try {
        await db.exec(baseline);
        const today = (await db.query("select timezone('America/Santiago', now())::date::text as operative_day")).rows[0].operative_day;
        const later = offset => new Date(Date.parse(today + 'T00:00:00Z') + 86400000 * offset).toISOString().slice(0, 10);
        const query = async (sql, args = []) => (await db.query(sql, args)).rows[0];
        const revision = (day, id = cabin, type = 'completa') => query(
            'insert into revisiones_cabana(cabana_id,fecha,tipo_revision) values($1,$2,$3) returning id,plantilla_id',
            [id, day, type]);
        const old = await revision(today);
        await db.query("insert into revision_items values ($1,$2,'ok',1)", [old.id, fridge]);
        await db.exec(migration);
        const setUser = async (id, role = 'authenticated') => {
            await db.exec('reset role');
            await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
            await db.exec('set role ' + role);
        };
        const resolve = async (day, id = cabin) => (await query(
            'select public.haku_revision_plantillas_v1($1::date,$2::uuid) result', [day, id])).result;
        const edit = async () => (await query('select public.haku_revision_plantilla_editar_v1($1::uuid) result', [cabin])).result;
        const save = async (version, request, groups) => (await query(
            'select public.haku_revision_plantilla_guardar_v1($1::uuid,$2::uuid,$3::uuid,$4::jsonb) result',
            [cabin, version, request, JSON.stringify(groups)])).result;
        await setUser(team);
        assert.deepEqual(await resolve(today), { can_edit: false, templates: [] });
        await assert.rejects(edit(), error => error.code === '42501');
        await assert.rejects(save(null, randomUUID(), []), error => error.code === '42501');

        await setUser(admin);
        const draft = await edit();
        assert.equal(draft.version_id, null);
        let edited = core.renameGroup(draft.groups, '0-0', 'Cocina y encendido');
        edited = core.moveItem(edited, '0-0', '0-0-1', -1);
        edited = core.renameItem(edited, '0-0', '0-0-0', 'Refrigerador');
        edited = core.setItemActive(edited, '1', '1-0', false);
        const newKey = 'nuevo-' + draft.request_id + '-1';
        edited = core.addItem(edited, '0-0', newKey, 'Microondas');
        const v1 = await save(null, draft.request_id, core.payload(edited));
        assert.equal(v1.author, 'Administrador QA');
        assert.equal(v1.version_id, draft.request_id);
        assert.deepEqual(await save(null, draft.request_id, core.payload(edited)), v1);
        await assert.rejects(save(null, randomUUID(), core.payload(edited)), error => error.code === '40001');
        assert.deepEqual((await resolve(today)).templates, []);
        assert.deepEqual((await resolve(later(-1))).templates, []);
        assert.deepEqual((await resolve(later(1), other)).templates, []);

        await setUser(team);
        const pending = (await resolve(later(1))).templates[0];
        assert.equal(pending.revision_id, null);
        assert.equal(pending.groups[0].items[0].id, '0-0-1');
        assert.equal(pending.groups[0].items[0].expected, 2);
        assert.equal(pending.groups[0].items[0].required, false);
        assert.equal(pending.groups[0].items[1].itemId, fridge);
        assert.equal(pending.groups[1].items[0].active, false);
        const newItem = pending.groups[0].items.find(item => item.id === newKey);
        assert.ok(newItem.itemId);
        const review = await revision(later(1));
        assert.equal(review.plantilla_id, v1.version_id);
        await db.query("insert into revision_items values ($1,$2,'ok',null)", [review.id, newItem.itemId]);
        assert.equal((await revision(later(1), other)).plantilla_id, null);
        assert.equal((await revision(later(1), cabin, 'repaso')).plantilla_id, null);
        assert.equal((await revision(later(1), cabin, 'aseo_express')).plantilla_id, null);
        assert.equal((await revision(later(-1))).plantilla_id, null);
        await assert.rejects(db.query('update revisiones_cabana set plantilla_id=null where id=$1', [review.id]), /conserva la plantilla/);

        await setUser(admin);
        const next = await edit();
        const wrong = core.payload(next.groups);
        wrong[0].items = wrong[0].items.filter(item => item.id !== '0-0-0');
        await assert.rejects(save(next.version_id, next.request_id, wrong), /historial/);
        const restored = core.setItemActive(next.groups, '1', '1-0', true);
        const v2 = await save(next.version_id, next.request_id, core.payload(restored));
        assert.notEqual(v1.version_id, v2.version_id);
        assert.equal((await resolve(later(1))).templates[0].version_id, v1.version_id);
        assert.equal((await resolve(later(2))).templates[0].version_id, v2.version_id);
        assert.equal((await resolve(later(2))).templates[0].groups[1].items[0].itemId, towels);
        assert.deepEqual(await query('select estado,cantidad_esperada from revision_items where revision_id=$1', [old.id]),
            { estado: 'ok', cantidad_esperada: 1 });
        assert.equal((await query('select plantilla_id from revisiones_cabana where id=$1', [old.id])).plantilla_id, null);
        await assert.rejects(query('select * from private.haku_revision_versiones'), error => error.code === '42501');
        await setUser('', 'anon');
        await assert.rejects(resolve(later(1)), error => error.code === '42501');
        await db.exec('reset role');
        assert.equal((await query("select nombre from checklist_items where id=$1", [fridge])).nombre, 'Refri');
        assert.equal((await query("select count(*)::int n from checklist_items where categoria='REVISIÓN COMPLETA PERSONALIZADA'")).n, 1);
    } finally {
        await db.close();
    }
});

test('Repaso y Express versionan listas comunes sin cambiar revisiones ya iniciadas', async () => {
    const db = new PGlite();
    const repaso = require('../js/haiku-repaso-checklist-v1.js');
    const express = ['Losa', 'Llave de gas', 'Té', 'Café', 'Té Hierbas', 'Cama', 'Salamandra', 'Leña',
        'Diario', 'Amenities', 'Papel H.', 'Toallas', 'WC', 'Carbón', 'Fogón', 'Ventanas'];
    const sharedMigration = fs.readFileSync(path.join(migrations,
        fs.readdirSync(migrations).find(file => file.endsWith('_haku_personalizar_repaso_express_v1.sql'))), 'utf8');
    try {
        await db.exec(baseline);
        await db.exec('alter table checklist_items add column activo boolean not null default true');
        for (const section of repaso.sections) for (const item of section.items) {
            await db.query('insert into checklist_items(nombre,categoria) values($1,$2)', [item.label, section.category]);
        }
        for (const label of express) {
            await db.query('insert into checklist_items(nombre,categoria) values($1,$2)', [label, '🧹 ASEO EXPRESS']);
        }
        await db.exec(migration);
        await db.exec(sharedMigration);
        const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
        const { today, tomorrow } = await first("select timezone('America/Santiago',now())::date::text today,(timezone('America/Santiago',now())::date+1)::text tomorrow");
        const setUser = async (id, role = 'authenticated') => {
            await db.exec('reset role');
            await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
            await db.exec('set role ' + role);
        };
        const addReview = (date, id, type) => first(
            'insert into revisiones_cabana(cabana_id,fecha,tipo_revision) values($1,$2,$3) returning id,plantilla_id', [id, date, type]);
        const edit = async type => (await first('select haku_revision_modalidad_editar_v1($1) r', [type])).r;
        const save = async (type, draft, groups) => (await first(
            'select haku_revision_modalidad_guardar_v1($1,$2,$3,$4) r',
            [type, draft.version_id, draft.request_id, JSON.stringify(core.payload(groups))])).r;
        const read = async (date, type = null) => (await first('select haku_revision_modalidades_v1($1,$2) r', [date, type])).r;

        await setUser(team);
        assert.deepEqual(await read(today), { can_edit: false, templates: [] });
        await assert.rejects(edit('repaso'), error => error.code === '42501');
        const oldRepaso = await addReview(today, cabin, 'repaso');
        const oldExpress = await addReview(today, cabin, 'aseo_express');
        await setUser(admin);
        const repasoDraft = await edit('repaso');
        assert.deepEqual(repasoDraft.groups.map(g => [g.id, g.items.map(i => [i.id, i.label])]),
            repaso.sections.map(g => [g.id, g.items.map(i => [i.id, i.label])]));
        const repasoItem = repasoDraft.groups[0].items[0];
        await db.query("insert into revision_items values($1,$2,'ok',null)", [oldRepaso.id, repasoItem.itemId]);
        let repasoChanges = core.renameItem(repasoDraft.groups, 'living', repasoItem.id, 'Cama y cojines');
        repasoChanges = core.addItem(repasoChanges, 'living', 'nuevo-' + repasoDraft.request_id + '-1', 'Manta');
        const repasoPublished = await save('repaso', repasoDraft, repasoChanges);
        assert.deepEqual(await save('repaso', repasoDraft, repasoChanges), repasoPublished);
        assert.deepEqual((await read(tomorrow, 'aseo_express')).templates, []);
        assert.equal((await read(today, 'repaso')).templates.some(entry => entry.cabana_id === cabin), false);
        assert.equal((await read(tomorrow, 'repaso')).templates.length, 2);
        const newRepaso = await addReview(tomorrow, other, 'repaso');
        assert.equal(newRepaso.plantilla_id, repasoPublished.version_id);
        const nextRepaso = await edit('repaso');
        const laterRepaso = await save('repaso', nextRepaso, core.setItemActive(nextRepaso.groups, 'living', repasoItem.id, false));
        assert.notEqual(laterRepaso.version_id, newRepaso.plantilla_id);
        assert.equal((await read(tomorrow, 'repaso')).templates.find(t => t.revision_id === newRepaso.id).version_id, newRepaso.plantilla_id);
        assert.equal((await first('select estado from revision_items where revision_id=$1', [oldRepaso.id])).estado, 'ok');

        const expressDraft = await edit('aseo_express');
        assert.deepEqual(expressDraft.groups.flatMap(g => g.items.map(i => i.label)), express);
        const expressItem = expressDraft.groups[0].items[0];
        await db.query("insert into revision_items values($1,$2,'ok',1)", [oldExpress.id, expressItem.itemId]);
        const expressChanges = core.moveItem(expressDraft.groups, 'kitchen', expressItem.id, 1);
        const expressPublished = await save('aseo_express', expressDraft, expressChanges);
        assert.equal((await read(today, 'aseo_express')).templates.some(entry => entry.cabana_id === cabin), false);
        assert.equal((await addReview(tomorrow, other, 'aseo_express')).plantilla_id, expressPublished.version_id);
        assert.equal((await addReview(tomorrow, cabin, 'completa')).plantilla_id, null);
        assert.equal((await first('select estado from revision_items where revision_id=$1', [oldExpress.id])).estado, 'ok');
        await assert.rejects(db.query('update revisiones_cabana set plantilla_id=$1 where id=$2',
            [expressPublished.version_id, newRepaso.id]), error => error.code === '22023');
        await setUser('', 'anon');
        await assert.rejects(read(today), error => error.code === '42501');
    } finally {
        await db.close();
    }
});
