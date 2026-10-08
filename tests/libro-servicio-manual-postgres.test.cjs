const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const { read, entorno } = require('./fixtures/libro-servicio-manual.cjs');
const migration = read('supabase/migrations/20261007225155_libro_servicio_manual_v1.sql');
async function preparar(aplicar = true, opciones = {}) {
    const frontend = entorno(); opciones.configurar?.(frontend);
    await frontend.resolver(0, { codigo_servicio: 'tinajaTonel', hora: '18:00' });
    await frontend.resolver(1, { hora: '12:20' }); await frontend.resolver(2, opciones.masaje || { codigo_servicio: 'masajeTerapeutico60', hora: '17:00' });
    const payload = JSON.parse(JSON.stringify((await frontend.construir()).items.filter(x => x.payload && x.kind === 'servicio').map(x => x.payload)));
    const db = new PGlite();
    try {
        await db.exec(read('tests/fixtures/servicios-idempotencia-schema.sql'));
        await db.exec(`alter table reservas add column estado_reserva text default 'confirmada';
          alter table reserva_estadias add column cabana_id uuid,add column fecha_ingreso date,add column fecha_salida date,add column tipo_estadia text;
          create table notas(id uuid primary key default gen_random_uuid(),reserva_id uuid,estadia_id uuid,cabana_id uuid,fecha_operacion date,tipo text,texto text,importante boolean,creado_por uuid);
          create table eventos_fixture(id uuid default gen_random_uuid(),entidad text,operacion text);
          create function haiku_auditar_cambio() returns trigger language plpgsql as $$begin
            insert into eventos_fixture(entidad,operacion) values(tg_table_name,current_setting('app.haiku_operacion_id',true));return null;end$$;
          create trigger auditoria_servicios after insert on servicios for each row execute function haiku_auditar_cambio();`);
        await db.exec(read('supabase/migrations/20260916211226_haku_servicios_idempotencia_atomica.sql'));
        const registrar = read('supabase/migrations/20261006174344_libro_servicio_faltante_guardia_manual.sql')
            .match(/create or replace function public\.haiku_registrar_servicio\([\s\S]*?\$function\$;/)[0];
        await db.exec(registrar);
        await db.exec(read('supabase/migrations/20260908222500_haku_notas_libro_al_resumen.sql'));
        await db.exec(read('supabase/migrations/20260919023558_haku_libro_auditoria_importacion_segura.sql'));
        const seguridad = async () => (await db.query(`select p.oid,p.proname,p.proowner,p.proacl::text,p.prosecdef,p.proconfig,p.prosrc
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by p.oid`)).rows;
        const antes = await seguridad();
        if (aplicar) await db.exec(migration);
        for (const r of frontend.state.db.reservas) await db.query('insert into reservas(id,estado_reserva) values($1,$2)', [r.id, r.estado_reserva]);
        for (const e of frontend.state.db.reserva_estadias) await db.query('insert into reserva_estadias values($1,$2,$3,$4,$5,$6,$7)', [e.id, e.reserva_id, e.estado_estadia, e.cabana_id, e.fecha_ingreso, e.fecha_salida, e.tipo_estadia]);
        for (const c of frontend.state.db.catalogo_servicios) {
            const keys = Object.keys(c);
            await db.query(`insert into catalogo_servicios(${keys.join(',')}) values(${keys.map((_, i) => '$' + (i + 1)).join(',')})
              on conflict(codigo) do update set ${keys.filter(k => k !== 'codigo').map(k => `${k}=excluded.${k}`).join(',')}`, Object.values(c));
        }
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [frontend.state.usuario]);
        const importar = (items = payload, op = randomUUID(), notas = []) => db.query('select haiku_importar_libro_operaciones_v2($1,$2::jsonb,$3::jsonb) r', [op, JSON.stringify(items), JSON.stringify(notas)]);
        const contar = async () => (await db.query('select (select count(*)::int from servicios) servicios,(select count(*)::int from cargos where estado=\'activo\') cargos,(select count(*)::int from notas) notas')).rows[0];
        return { db, payload, importar, contar, seguridad, antes, frontend };
    } catch (e) { await db.close(); throw e; }
}

test('Rocío agrupada genera máximo un servicio/cargo, conserva ambas evidencias y retry no duplica', async () => {
    const { configurarRocio, fragmentos } = require('./fixtures/libro-masaje-fragmentos.cjs');
    const h = await preparar(true, { configurar: configurarRocio, masaje: { hora: '17:00' } });
    try {
        const items = h.payload.filter(x => x.codigo_servicio === 'masajeDescontracturante60');
        assert.equal(items.length, 1);
        const op = randomUUID(); await h.importar(items, op); await h.importar(items, op); await h.importar(items);
        assert.deepEqual(await h.contar(), { servicios: 1, cargos: 1, notas: 0 });
        const s = (await h.db.query('select * from servicios')).rows[0];
        assert.equal(s.libro_resolucion_manual_v1.item_id, items[0].item_id);
        assert.equal(s.libro_resolucion_manual_v1.evidencia_original.texto, fragmentos.join(' / '));
        assert.deepEqual(s.libro_resolucion_manual_v1.origen, { hoja: 'Oct26', celda: 'C3' });
        assert.equal(new Date(s.fecha_servicio).toISOString().slice(0, 10), '2026-10-24'); assert.equal(Number(s.cantidad), 1);
        assert.equal((await h.db.query('select count(*)::int n from eventos_fixture')).rows[0].n, 1);
    } finally { await h.db.close(); }
});
test('migration preserva ACL/owner/seguridad/search_path y sólo modifica importer de servicios', async () => {
    const h = await preparar(false); try {
        await h.db.exec(migration); const despues = await h.seguridad();
        for (const a of h.antes) {
            const b = despues.find(x => x.oid === a.oid); assert.ok(b);
            assert.deepEqual({ ...b, prosrc: null }, { ...a, prosrc: null });
            if (a.proname !== 'haiku_importar_servicios_libro_v1') assert.equal(b.prosrc, a.prosrc);
        }
        assert.deepEqual((await h.db.query('select haiku_libro_servicio_manual_capacidad_v1() r')).rows[0].r, { version: 1, auditoria: true });
        assert.deepEqual(await h.contar(), { servicios: 0, cargos: 0, notas: 0 });
    } finally { await h.db.close(); }
});
test('A+B+C crea tres servicios, dos cargos, auditoría durable y retry no duplica', async () => {
    const h = await preparar(); try {
        const op = randomUUID(); await h.importar(h.payload, op); await h.importar(h.payload, op);
        assert.deepEqual(await h.contar(), { servicios: 3, cargos: 2, notas: 0 });
        const rows = (await h.db.query('select * from servicios')).rows;
        const A = rows.find(x => x.tipo_cobro === 'cortesia'); assert.equal(Number(A.total), 0);
        assert.equal((await h.db.query('select count(*)::int n from cargos where servicio_id=$1', [A.id])).rows[0].n, 0);
        for (const s of rows) {
            assert.equal(s.libro_resolucion_manual_v1.usuario, h.frontend.state.usuario);
            assert.ok(s.libro_resolucion_manual_v1.incorporado_en); assert.match(s.observaciones, /HAKU-LIBRO-SERVICIO:srv:/);
        }
        assert.equal((await h.db.query('select count(*)::int n from eventos_fixture')).rows[0].n, 3);
        await assert.rejects(h.db.query("update servicios set libro_resolucion_manual_v1='{}' where id=$1", [A.id]), /inmutable/);
    } finally { await h.db.close(); }
});
test('precio/catálogo, destino y permisos obsoletos abortan el lote sin escrituras', async () => {
    const h = await preparar(); try {
        for (const cambio of ["update catalogo_servicios set precio_base=precio_base+1 where codigo='lateCheckout'",
            "update catalogo_servicios set activo=false where codigo='tinajaTonel'",
            "update catalogo_servicios set permite_cortesia=false where codigo='tinajaTonel'",
            "update reserva_estadias set estado_estadia='no_show'",
            "update reservas set estado_reserva='cancelada'",
            "create or replace function private.haiku_tiene_permiso(text) returns boolean language sql as $$select false$$"]) {
            await h.db.exec('begin'); try { await h.db.exec(cambio); await assert.rejects(h.importar()); } finally { await h.db.exec('rollback'); }
            assert.deepEqual(await h.contar(), { servicios: 0, cargos: 0, notas: 0 });
        }
    } finally { await h.db.close(); }
});
test('evidencia/actor, precio unitario, fecha y capacidad alterados fallan cerrados', async () => {
    const h = await preparar(); try {
        for (const change of [x => x[0].servicio_manual_v1.usuario = randomUUID(),
            x => x[0].servicio_manual_v1.evidencia_original.semantica = 'AMBIGUO',
            x => x[0].servicio_manual_v1 = null,
            x => x[1].precio_manual = 10000, x => x[0].personas = 9,
            x => x[0].fecha_servicio = '2026-10-09',
            x => x[0].servicio_manual_v1.evidencia_original.concepto = 'alimento']) {
            const items = JSON.parse(JSON.stringify(h.payload)); change(items); await assert.rejects(h.importar(items));
            assert.deepEqual(await h.contar(), { servicios: 0, cargos: 0, notas: 0 });
        }
    } finally { await h.db.close(); }
});
test('retry paralelo reutiliza único existente y conserva auditoría original', async () => {
    const h = await preparar(); try {
        await Promise.all([h.importar(), h.importar(), h.importar()]);
        assert.deepEqual(await h.contar(), { servicios: 3, cargos: 2, notas: 0 });
        const antes = (await h.db.query('select libro_resolucion_manual_v1 from servicios order by id')).rows;
        await h.importar(); assert.deepEqual((await h.db.query('select libro_resolucion_manual_v1 from servicios order by id')).rows, antes);
    } finally { await h.db.close(); }
});
test('una nota inválida revierte también servicios y auditoría; nota normal conserva writer', async () => {
    const h = await preparar(); try {
        await assert.rejects(h.importar(h.payload, randomUUID(), [{ item_id: 'nota:1', reserva_id: h.payload[0].reserva_id, fecha_operacion: '2026-10-10', texto: '' }]));
        assert.deepEqual(await h.contar(), { servicios: 0, cargos: 0, notas: 0 });
        await h.importar(h.payload, randomUUID(), [{ item_id: 'nota:1', reserva_id: h.payload[0].reserva_id, estadia_id: h.payload[0].estadia_id, fecha_operacion: '2026-10-10', texto: 'Dejar batas', importante: true }]);
        assert.deepEqual(await h.contar(), { servicios: 3, cargos: 2, notas: 1 });
        assert.equal((await h.db.query('select tipo from notas')).rows[0].tipo, 'operativa_resumen');
    } finally { await h.db.close(); }
});
test('migration rechaza un cuerpo de writer inesperado y revierte la columna nueva', async () => {
    const h = await preparar(false); try {
        await h.db.exec('create or replace function haiku_importar_servicios_libro_v1(p_operacion_id uuid,p_items jsonb) returns jsonb language sql as $$select null::jsonb$$');
        await assert.rejects(h.db.exec(migration), /Contrato inesperado/); await h.db.exec('rollback');
        assert.equal((await h.db.query("select count(*)::int n from information_schema.columns where table_name='servicios' and column_name='libro_resolucion_manual_v1'")).rows[0].n, 0);
    } finally { await h.db.close(); }
});
test('operador puede bloquear catálogo sin permiso de editarlo; anon no puede llamar el helper', async () => {
    const h = await preparar(); try {
        await h.db.exec(`grant usage on schema public,private,auth to authenticated;
          grant select on catalogo_servicios to authenticated; alter table catalogo_servicios enable row level security;
          create policy catalogo_lectura on catalogo_servicios for select to authenticated using(true);
          set role authenticated;`);
        assert.equal((await h.db.query("select private.haiku_libro_servicio_manual_catalogo_v1('lateCheckout') r")).rows[0].r.codigo, 'lateCheckout');
        await assert.rejects(h.db.exec("update catalogo_servicios set precio_base=1"), /permission denied/);
        await h.db.exec('reset role');
        assert.equal((await h.db.query("select has_function_privilege('anon','private.haiku_libro_servicio_manual_catalogo_v1(text)','execute') permiso")).rows[0].permiso, false);
    } finally { await h.db.close(); }
});
test('existente previo compatible se reutiliza sin reescribir ni agregarle auditoría', async () => {
    const h = await preparar(false); try {
        const previo = { ...h.payload[1] }; delete previo.servicio_manual_v1;
        await h.importar([previo]); const antes = (await h.db.query('select * from servicios')).rows[0];
        await h.db.exec(migration); await h.importar([h.payload[1]]);
        const despues = (await h.db.query('select * from servicios')).rows[0];
        assert.deepEqual(despues, { ...antes, libro_resolucion_manual_v1: null });
        assert.deepEqual(await h.contar(), { servicios: 1, cargos: 1, notas: 0 });
    } finally { await h.db.close(); }
});
test('múltiples históricos y contradicción no autorizan un tercero ni reescriben cargos', async () => {
    const h = await preparar(false); try {
        const previo = { ...h.payload[1] }; delete previo.servicio_manual_v1;
        await h.importar([previo]);
        await h.db.exec("update servicios set total=20000");
        await h.db.exec(migration); await assert.rejects(h.importar([h.payload[1]]), /existente contradice/);
        assert.equal((await h.contar()).servicios, 1);
        await h.db.exec(`alter table servicios disable trigger user;
          insert into servicios(reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,hora_inicio,hora_fin,precio_unitario_aplicado,total,tipo_cobro)
            select reserva_id,estadia_id,catalogo_servicio_id,fecha_servicio,hora_inicio,hora_fin,precio_unitario_aplicado,total,tipo_cobro from servicios;
          alter table servicios enable trigger user;`);
        await assert.rejects(h.importar([h.payload[1]]), /Múltiples/);
        assert.equal((await h.contar()).servicios, 2);
    } finally { await h.db.close(); }
});
test('Full Day rechaza término fuera de franja incluso con snapshot de destino actualizado', async () => {
    const h = await preparar(); try {
        await h.db.query("update reserva_estadias set tipo_estadia='full_day',fecha_salida=fecha_ingreso where id=$1", [h.payload[0].estadia_id]);
        const A = JSON.parse(JSON.stringify(h.payload[0])); A.hora = '21:00';
        Object.assign(A.servicio_manual_v1.destino_esperado, { tipo_estadia: 'full_day', fecha_salida: '2026-10-10' });
        Object.assign(A.servicio_manual_v1.resuelto, { hora: '21:00', hora_fin: '22:00' });
        await assert.rejects(h.importar([A]), /Horario fuera/);
        assert.deepEqual(await h.contar(), { servicios: 0, cargos: 0, notas: 0 });
    } finally { await h.db.close(); }
});

test('mismo origen y total no permiten reutilizar una prestación distinta', async () => {
    const h = await preparar(false); try {
        const previo = { ...h.payload[0] }; delete previo.servicio_manual_v1;
        await h.importar([previo]); await h.db.exec(migration);
        for (const alteracion of ["cantidad=2", "personas=1", "hora_fin='19:30'", "fecha_servicio='2026-10-11'", "hora_inicio='17:00'"]) {
            await h.db.exec(`update servicios set cantidad=1,personas=2,hora_inicio='18:00',hora_fin='19:00',fecha_servicio='2026-10-10';
              update servicios set ${alteracion};`);
            await assert.rejects(h.importar([h.payload[0]]), /existente contradice/);
            assert.deepEqual(await h.contar(), { servicios: 1, cargos: 0, notas: 0 });
        }
    } finally { await h.db.close(); }
});

test('Late manual rechaza horario/fecha contradictorios de un único existente y revierte el lote', async () => {
    const h = await preparar(false); try {
        const previo = { ...h.payload[1], hora: '14:00', observaciones: 'Late histórico sin marca del Libro' };
        delete previo.servicio_manual_v1; await h.importar([previo]); await h.db.exec(migration);
        for (const alteracion of ["hora_inicio='14:00',hora_fin='15:00'", "fecha_servicio='2026-10-10'",
            "hora_fin='13:45'", "hora_inicio='12:20:01'", "hora_fin='13:20:01'"]) {
            await h.db.exec(`update servicios set fecha_servicio='2026-10-11',hora_inicio='12:20',hora_fin='13:20';
              update servicios set ${alteracion};`);
            await assert.rejects(h.importar([h.payload[0], h.payload[1]]), /existente contradice/);
            assert.deepEqual(await h.contar(), { servicios: 1, cargos: 1, notas: 0 });
            assert.equal((await h.db.query('select count(*)::int n from servicios where libro_resolucion_manual_v1 is not null')).rows[0].n, 0);
        }
    } finally { await h.db.close(); }
});

test('Late manual reutiliza existente con checkout e inicio/término exactos conservando su fila', async () => {
    const h = await preparar(false); try {
        const previo = { ...h.payload[1], personas: 3, observaciones: 'Late histórico compatible sin marca del Libro' };
        delete previo.servicio_manual_v1; await h.importar([previo]); await h.db.exec(migration);
        const antes = (await h.db.query('select * from servicios')).rows[0];
        assert.equal(antes.fecha_servicio.toISOString().slice(0, 10), h.payload[1].fecha_servicio);
        assert.equal(antes.hora_inicio, '12:20:00'); assert.equal(antes.hora_fin, '13:20:00');
        await h.importar([h.payload[1]]); await h.importar([h.payload[1]]);
        assert.deepEqual((await h.db.query('select * from servicios')).rows[0], antes);
        assert.deepEqual(await h.contar(), { servicios: 1, cargos: 1, notas: 0 });
    } finally { await h.db.close(); }
});

for (const [campo, asignacion] of [
    ['hora_fin', "new.hora_fin := new.hora_fin + interval '1 second'"],
    ['cantidad', 'new.cantidad := new.cantidad + 1'],
    ['personas', 'new.personas := new.personas + 1'],
    ['tipo_cobro', "new.tipo_cobro := 'cortesia'"]
]) {
    test(`trigger de auditoría rechaza ${campo} alterado antes de ejecutarse y revierte todas las escrituras`, async () => {
        const h = await preparar(); try {
            await h.db.exec(`create function private.fixture_alterar_servicio_manual() returns trigger language plpgsql as $$begin
              if new.catalogo_servicio_id='${h.payload[1].servicio_manual_v1.catalogo_esperado.id}'::uuid then ${asignacion}; end if;
              return new; end$$;
              create trigger aaa_fixture_alterar_servicio_manual before insert on servicios
                for each row execute function private.fixture_alterar_servicio_manual();`);
            // El masaje se inserta con cargo y auditoría antes de alterar el Late: deben revertirse también.
            await assert.rejects(h.importar([h.payload[2], h.payload[1]]), /Auditoría incompatible con el servicio nuevo/);
            assert.deepEqual(await h.contar(), { servicios: 0, cargos: 0, notas: 0 });
            assert.equal((await h.db.query('select count(*)::int n from cargos')).rows[0].n, 0);
            assert.equal((await h.db.query('select count(*)::int n from eventos_fixture')).rows[0].n, 0);
        } finally { await h.db.close(); }
    });
}
