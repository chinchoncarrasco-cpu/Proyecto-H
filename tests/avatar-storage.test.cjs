const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20261002050445_avatar_perfil_canonico.sql');

async function contracts(db) {
  return (await db.query(`select jsonb_build_object(
    'evidencias', (select to_jsonb(b) from storage.buckets b where id='haiku-evidencias'),
    'policies', (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p
      where schemaname='storage' and policyname like 'haiku_evidencias_%'),
    'usuarios', (select jsonb_agg(to_jsonb(c) order by ordinal_position) from information_schema.columns c
      where table_schema='public' and table_name='usuarios'),
    'sesion', pg_get_functiondef('public.haiku_sesion_actual()'::regprocedure),
    'activo', pg_get_functiondef('private.haiku_usuario_activo()'::regprocedure)
  ) as value`)).rows[0].value;
}

test('Storage avatar: RLS real, 16 requisitos, idempotencia y rollback', async () => {
  const db = new PGlite();
  try {
    // Incluso fixtures y migration se revierten. El SQL de pruebas tiene su propio rollback.
    await db.exec('begin');
    await db.exec(read('tests/fixtures/avatar-storage-schema.sql'));
    const before = await contracts(db);
    const ddl = migration.replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '');
    await db.exec(ddl);
    assert.deepEqual(await contracts(db), before, '13-16: evidencias, usuarios, sesion y helper intactos');
    await db.exec(ddl);
    assert.deepEqual(await contracts(db), before, 'reaplicar conserva contratos');
    assert.equal((await db.query("select count(*)::int as n from pg_policies where schemaname='storage' and policyname like 'haiku_avatares_%'")).rows[0].n, 4);
    await db.exec('savepoint casos');
    const sql = read('tests/avatar-storage.integration.sql').replace(/^begin;\s*$/m, '')
      .replace(/^rollback;\s*$/m, '');
    const results = await db.exec(sql);
    const checks = results.flatMap(r => r.rows).filter(row => typeof row.nombre === 'string');
    assert.ok(checks.length >= 30, `se ejecutaron ${checks.length} comprobaciones RLS`);
    console.log(`Avatar: ${checks.length} comprobaciones SQL aprobadas con roles authenticated/anon.`);
    await db.exec('rollback to savepoint casos');
    assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from public.usuarios')).rows[0].n, 0);
    assert.deepEqual(await contracts(db), before);
    await db.exec('rollback');
    assert.equal((await db.query("select to_regclass('storage.objects') as tabla")).rows[0].tabla, null,
      'rollback elimina incluso fixture y migration de la base efimera');
  } finally { await db.close(); }
});

test('migration minima sin ampliar usuarios, sesion, permisos ni evidencias', () => {
  assert.doesNotMatch(migration, /alter table|create (?:or replace )?function|security definer|service_role|secret/i);
  assert.doesNotMatch(migration, /usuarios\.gestionar|evidencias\.(?:ver|subir)|haiku-evidencias|haiku_sesion_actual/i);
  assert.equal((migration.match(/to authenticated/g) || []).length, 4);
  assert.equal((migration.match(/with check/g) || []).length, 2);
  assert.equal((migration.match(/storage\.foldername\(name\)/g) || []).length, 5);
  assert.match(migration, /on conflict \(id\) do update/);
});
