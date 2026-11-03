const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/supabase-aseo-revision-v1.js'), 'utf8');
const day = '2026-11-03';
function fixture({ existing = true, fail = false } = {}) {
  let remote = existing ? { id: 'review-1', fecha: day, cabana_id: 'cab-1', estado: 'completada', resultado: 'lista', es_repaso: false, observaciones: 'Observación', detalle_cocina: 'Limpiar tetera' } : null;
  const writes = [], events = [], cabin = { checklist: { cocina: true }, detallesRevision: 'Observación' };
  const data = { cabanas: { 1: cabin } };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from(table) {
      assert.equal(table, 'revisiones_cabana'); let kind = 'read', payload;
      const q = {
        select() { return q; }, eq() { return q; }, neq() { return q; }, order() { return q; }, limit() { return q; },
        maybeSingle: async () => ({ data: remote, error: null }),
        update(value) { kind = 'update'; payload = value; return q; },
        insert(value) { kind = 'insert'; payload = value; return q; },
        single: async () => {
          writes.push({ kind, payload });
          if (fail) return { data: null, error: new Error('Sin permiso') };
          remote = kind === 'insert' ? { id: 'new-review', ...payload } : { ...remote, ...payload };
          return { data: remote, error: null };
        },
      }; return q;
    },
  };
  const window = { haikuSupabase: client };
  vm.runInNewContext(source.replace('    function iniciar() {', '    window.testRepaso = { guardarTipoRevision, cacheCabanas };\n    function iniciar() {'), {
    window, document: { readyState: 'loading', addEventListener() {}, dispatchEvent: e => events.push(e) },
    localStorage: { getItem: () => '' }, fechaSeleccionada: day, obtenerDatosDia: () => data, guardarDatos() {},
    CustomEvent: class { constructor(type, value) { this.type = type; this.detail = value.detail; } },
    console, Date, setTimeout, clearTimeout,
  });
  window.testRepaso.cacheCabanas.set('1', { id: 'cab-1' });
  return { api: window.testRepaso, writes, events, cabin, remote: () => remote };
}
test('Web: activar y desactivar Repaso conserva revisión, checklist y observaciones', async () => {
  const f = fixture();
  for (const type of ['repaso', 'completa']) {
    await f.api.guardarTipoRevision('1', type, day);
    assert.equal(f.remote().es_repaso, type === 'repaso');
    assert.equal(f.remote().estado, 'completada'); assert.equal(f.remote().resultado, 'lista');
    assert.equal(f.remote().detalle_cocina, 'Limpiar tetera');
    assert.deepEqual(f.cabin.checklist, { cocina: true });
    assert.equal(f.cabin.detallesRevision, 'Observación');
    assert.equal(f.cabin.revisionCompletaCiclo.esRepaso, type === 'repaso');
    assert.deepEqual(Object.keys(f.writes.at(-1).payload).sort(), ['es_repaso', 'revisado_por']);
  }
});
test('Web: una cabaña sin revisión queda en Repaso pendiente sin inventar hora de inicio', async () => {
  const f = fixture({ existing: false });
  await f.api.guardarTipoRevision('1', 'repaso', day);
  assert.equal(f.remote().estado, 'pendiente'); assert.equal(f.remote().iniciado_en, null);
  assert.equal(f.remote().es_repaso, true); assert.equal(f.cabin.estadoRevision, 'pendiente');
});
test('Web: un error no confirma Repaso en el caché local', async () => {
  const f = fixture({ fail: true });
  await assert.rejects(f.api.guardarTipoRevision('1', 'repaso', day), /Sin permiso/);
  assert.equal(f.remote().es_repaso, false); assert.equal(f.cabin.revisionCompletaCiclo, undefined);
});
