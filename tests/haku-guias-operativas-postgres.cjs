const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const catalogo = 'public.haiku_manager_capturas_v1';
const archivo = 'recortes/rut';

async function comprobar() {
    const db = new PGlite();
    try {
        await db.exec(fs.readFileSync('tests/fixtures/huespedes-schema.sql', 'utf8'));
        await db.exec(fs.readFileSync('supabase/migrations/20261120205010_haku_huespedes_v1_1.sql', 'utf8'));
        await db.exec(fs.readFileSync('supabase/migrations/20261125220046_haiku_manager_capturas_privadas.sql', 'utf8'));
        await db.query(`insert into ${catalogo} values ($1,'image/png','YQ==')`, [archivo]);
        for (const [n, activo, permisos] of [
            [1, true, ['huespedes.ver', 'pagos.ver']],
            [2, true, ['huespedes.ver']],
            [3, true, ['pagos.ver']],
            [4, false, ['huespedes.ver', 'pagos.ver']]
        ]) {
            await db.query("insert into public.usuarios (id,nombre,activo) values ($1,'Persona de prueba',$2)", [id(n), activo]);
            for (const permiso of permisos) {
                await db.query('insert into private.permisos values ($1,$2)', [id(n), permiso]);
            }
        }
        await db.exec('set role anon');
        await assert.rejects(db.query(`select clave from ${catalogo}`), { code: '42501' });
        await db.exec('reset role; set role authenticated');
        for (const n of [1, 2, 3, 4, 5]) {
            await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)]);
            const {rows} = await db.query(`select clave from ${catalogo}`);
            assert.deepEqual(rows, n === 1 ? [{clave:archivo}] : [], `usuario de prueba ${n}`);
        }
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(1)]);
        await assert.rejects(db.query(`update ${catalogo} set contenido='Yg==' where clave=$1`, [archivo]), {code:'42501'});
        await assert.rejects(db.query(`delete from ${catalogo} where clave=$1`, [archivo]), {code:'42501'});
        await assert.rejects(db.query(`insert into ${catalogo} values ('recortes/prueba','image/png','YQ==')`), {code:'42501'});
        console.log('Capturas Manager: lectura de recepción, sin acceso anónimo ni escrituras desde la app.');
    } finally {
        await db.close();
    }
}

comprobar().catch(error=>{ console.error(error); process.exitCode=1; });
