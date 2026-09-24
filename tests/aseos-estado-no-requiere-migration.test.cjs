const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations",
    "20260924040844_aseos_estado_no_requiere.sql"), "utf8");
// Valores leidos del CHECK aseos_estado_valido vigente antes de esta migracion.
const antiguos = ["pendiente", "asignado", "en_proceso", "completado", "cancelado"];

test("la migracion conserva todos los estados de aseo y agrega solo no_requiere", () => {
    assert.match(migration, /alter table public\.aseos\s+drop constraint aseos_estado_valido,\s+add constraint aseos_estado_valido check/i);
    const definicion = migration.match(/add constraint aseos_estado_valido check\s*\(\s*estado\s*=\s*any\s*\(\s*array\[([\s\S]*?)\]\s*\)\s*\)/i);
    assert.ok(definicion, "Debe reemplazar el CHECK del estado de aseos");
    const valores = [...definicion[1].matchAll(/'([^']+)'::text/g)].map(coincidencia => coincidencia[1]);
    assert.deepEqual(valores, [...antiguos, "no_requiere"]);
    assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate)\b/i);
});

let PGlite;
try {
    ({ PGlite } = require(process.env.HAKU_PGLITE_MODULE || "@electric-sql/pglite"));
} catch (_) {
    // El contrato estatico sigue corriendo; la ejecucion espera un PostgreSQL local.
}

test("PostgreSQL local acepta el nuevo estado sin alterar cancelado ni otros historicos",
    { skip: PGlite ? false : "PGlite no esta disponible en este entorno" }, async () => {
        const db = new PGlite();
        try {
            await db.exec(`create table public.aseos (
                id integer primary key,
                estado text not null,
                constraint aseos_estado_valido check (
                    estado = any (array[
                        'pendiente'::text, 'asignado'::text, 'en_proceso'::text,
                        'completado'::text, 'cancelado'::text
                    ])
                )
            );`);
            for (const [indice, valor] of antiguos.entries()) {
                await db.query("insert into public.aseos(id,estado) values($1,$2)", [indice + 1, valor]);
            }
            const antes = (await db.query("select id,estado from public.aseos order by id")).rows;
            await db.exec(migration);
            const despues = (await db.query("select id,estado from public.aseos order by id")).rows;
            assert.deepEqual(despues, antes);
            await db.query("insert into public.aseos(id,estado) values($1,$2)", [6, "no_requiere"]);
            await assert.rejects(
                db.query("insert into public.aseos(id,estado) values($1,$2)", [7, "desconocido"]),
                /check constraint/i
            );
        } finally {
            await db.close?.();
        }
    });
