const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20261002011039_alinear_cierre_turno_canonico.sql');

test('contrato SQL real: 16 requisitos, matriz estado/trigger y rollback', async () => {
  const db = new PGlite();
  try {
    for (const file of ['tests/fixtures/cierre-schema.sql',
      'tests/fixtures/cierre-funciones-originales.sql', 'tests/fixtures/cierre-triggers.sql']) {
      await db.exec(read(file));
    }
    // Demuestra que el fixture reproduce ambos bugs antes de aplicar la migration.
    await db.exec(`begin;
      set local test.permisos='cierres.ver,cierres.realizar,cierres.validar_pagos,cierres.validar_caja,cierres.validar_vale_salida';
      insert into public.cabanas(numero) values(1);
      select public.haiku_asegurar_cierre_dia('2099-02-01');
      select public.haiku_guardar_respuesta_cierre('2099-02-01','llaves_recepcion','confirmado',
        '{"tonel":true,"jacuzzi":true,"lavanderia":true,"masajes":true,"generadores":true,"jardineria":true,"marcelo":true,"cisterna":true,"internet":true,"gas11":true,"torreon":true}');`);
    assert.equal((await db.query(`select count(*)::int as n from public.cierre_respuestas r
      join public.cierre_checklist_items i on i.id=r.item_id where i.codigo='llaves_retiradas'`)).rows[0].n, 0);
    await db.exec(`insert into public.cierre_respuestas(cierre_id,item_id,cabana_id,estado,valor,origen)
      select ct.id,i.id,case when i.alcance='cabana' then cb.id else null end,'confirmado','true','sistema'
      from public.cierres_turno ct cross join public.cierre_checklist_items i cross join public.cabanas cb
      where i.obligatorio and i.codigo<>'cabana_ocupada';`);
    const before = (await db.query("select public.haiku_estado_cierre_dia('2099-02-01') as estado")).rows[0].estado;
    assert.equal(before.pendientes, 0);
    assert.equal(before.puede_cerrar_limpio, true);
    await assert.rejects(db.query("select public.haiku_cerrar_turno_dia('2099-02-01')"), /complete la revisión/);
    await db.exec('rollback');
    await db.exec(migration);
    await db.exec(read('tests/cierre-canonico.integration.sql'));
    for (const table of ['turnos', 'cierres_turno', 'cierre_respuestas', 'cabanas', 'eventos_auditoria']) {
      assert.equal((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n, 0,
        `rollback no deja datos en ${table}`);
    }
    assert.equal((await db.query("select count(*)::int as n from public.cierre_checklist_items where codigo like 'prueba_%'" )).rows[0].n, 0);
  } finally { await db.close(); }
});

test('migration conserva RPC de cierre/reapertura, snapshot, RLS y catalogo', () => {
  assert.doesNotMatch(migration, /create or replace function public\.haiku_(cerrar_turno_dia|reabrir_cierre_dia|asegurar_cierre_dia|guardar_novedades_cierre)\(/i);
  assert.doesNotMatch(migration, /(?:insert into|update|delete from) public\.cierre_checklist_items/i);
  assert.doesNotMatch(migration, /(?:create|alter|drop) policy|disable row level|security definer/i);
  assert.equal((migration.match(/from private\.haiku_evaluar_cierre\(/g) || []).length, 2);
  assert.match(migration, /revoke all on function private\.haiku_evaluar_cierre\(uuid\) from public, anon/i);
});

test('Web envia las 11 claves al RPC canonico sin control visual duplicado', async () => {
  const keys = ['tonel','jacuzzi','lavanderia','masajes','generadores','jardineria','marcelo','cisterna','internet','gas11','torreon'];
  const html = read('index.html');
  assert.doesNotMatch(html, /<input[^>]+name="llaves-retiradas"/);
  assert.deepEqual([...html.matchAll(/data-cierre-llave="([^"]+)"/g)].map(x => x[1]).sort(), [...keys].sort());
  const listeners = {};
  const calls = [];
  class Input {
    constructor(key) { this.dataset = { cierreLlave: key }; this.checked = true; }
    matches() { return false; }
    getAttribute() { return null; }
    hasAttribute(name) { return name === 'data-cierre-llave'; }
  }
  const inputs = keys.map(key => new Input(key));
  const context = {
    window: { haikuSupabase: { rpc: async (name, params) => { calls.push({name, params}); return {error:null}; } },
      addEventListener() {}, dispatchEvent() {} },
    document: { addEventListener(name, fn) { listeners[name] = fn; }, querySelectorAll: () => inputs },
    HTMLElement: Input, HTMLInputElement: Input, fechaSeleccionada: '2099-01-01',
    CustomEvent: class {}, setTimeout() {}, clearTimeout() {}, console: { info() {}, error() {} },
    alert() { throw new Error('error de guardado'); }
  };
  vm.runInNewContext(read('js/supabase-cierre-v1.js'), context);
  listeners.change({ target: inputs[0] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1, 'una transaccion RPC, derivacion en backend');
  assert.equal(calls[0].name, 'haiku_guardar_respuesta_cierre');
  assert.equal(calls[0].params.p_codigo, 'llaves_recepcion');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].params.p_valor)), Object.fromEntries(keys.map(k => [k,true])));
  inputs[0].checked = false;
  listeners.change({ target: inputs[0] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[1].params.p_valor.tonel, false);
  assert.equal(Object.keys(calls[1].params.p_valor).length, 11);
});
