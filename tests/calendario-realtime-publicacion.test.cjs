const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const migration = read('supabase/migrations/20261005200318_calendario_realtime_publicacion.sql');
const contract = read('tests/sql/calendario-realtime-publicacion.sql');

test('migración de Calendario sólo añade los dos miembros faltantes', () => {
    assert.equal((migration.match(/alter publication\s+supabase_realtime\s+add table/gi) || []).length, 2);
    assert.equal((migration.match(/if not exists/gi) || []).length, 2);
    assert.doesNotMatch(migration, /\b(drop|delete|insert|update|truncate|create publication|alter table|set table)\b/i);
});

for (const alreadyPublished of [[], ['bloqueos_cabana'], ['cabanas'], ['bloqueos_cabana', 'cabanas']]) {
    test(`Postgres: presencia, idempotencia y conservación con ${alreadyPublished.join(', ') || 'ambas ausentes'}`, async () => {
        const db = new PGlite();
        try {
            for (const table of ['reservas', 'reserva_estadias', 'bloqueos_cabana', 'cabanas', 'otra_tabla']) {
                await db.exec(`create table public.${table}(id integer primary key, valor text);
                    alter table public.${table} enable row level security;
                    insert into public.${table} values (1, 'sin cambios');`);
            }
            await db.exec(`create publication supabase_realtime for table public.reservas, public.reserva_estadias, public.otra_tabla
                ${alreadyPublished.map(table => ', public.' + table).join('')}`);
            const metadata = async () => (await db.query(`select relname, relreplident, relrowsecurity
                from pg_catalog.pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`)).rows;
            const before = await metadata();
            if (alreadyPublished.length < 2) await assert.rejects(db.exec(contract), /Calendario: faltan tablas/);
            for (let run = 0; run < 2; run++) {
                await db.exec(migration);
                await db.exec(contract);
                const { rows } = await db.query(`select tablename from pg_catalog.pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public'`);
                const members = new Set(rows.map(row => row.tablename));
                for (const required of ['reservas', 'reserva_estadias', 'bloqueos_cabana', 'cabanas']) assert.ok(members.has(required), required);
                assert.ok(members.has('otra_tabla'), 'no elimina miembros ajenos al Calendario');
                assert.deepEqual(await metadata(), before);
                for (const table of members) assert.deepEqual((await db.query(`select * from public.${table}`)).rows, [{ id: 1, valor: 'sin cambios' }]);
            }
        } finally { await db.close(); }
    });
}
