const test = require('node:test'), assert = require('node:assert/strict');
const V = require('../js/cabin-context-v1.js');
const { createFixtureClient, contextFixtureData } = require('./fixtures/cabin-context/client.cjs');
const target = { scope: 'stay', day: '2026-11-05', stayId: 'stay-3', reservationId: 'reservation-3', cabinId: 'cab-3', cabinNumber: 3 };
test('checkout recupera toda la estadía y excluye otra cabaña y el ingreso del mismo día', async () => {
  const client = createFixtureClient(contextFixtureData()), data = await V.readStayContext(client, target), lines = V.contextLines(data);
  assert.equal(V.occupancyLabel(data.occupancy), '3 personas · 2 adultos · 1 niño · 1 mascota');
  assert.deepEqual(data.services.map(row => row.id), ['tinaja', 'masaje', 'desayuno']);
  assert.deepEqual(lines.notes, ['03/11 · Nota del ingreso', '05/11 · Nota de salida']);
  assert.match(lines.requests[0], /03\/11 · Completada/); assert.match(lines.services[0], /Tinaja · 03\/11 · 18:00 · Realizado/);
  assert.match(lines.services[1], /Cancelado/); assert.doesNotMatch(JSON.stringify(lines), /entrante|Otra cabaña|otra cabaña/);
  assert.equal(client.reads.length, 4); assert.ok(client.reads.every(row => !/total|saldo|precio/.test(row.selected)));
  const otherDate = await V.readStayContext(createFixtureClient(contextFixtureData()), { ...target, day: '2027-01-01' });
  assert.equal(otherDate.notes.length, 2); assert.equal(otherDate.services.length, 3);
});
test('revisión conserva el día seleccionado y consulta sólo sus servicios y personas', async () => {
  const client = createFixtureClient(contextFixtureData());
  const data = await V.readStayContext(client, { ...target, scope: 'day', stayId: null, cabinId: null });
  assert.deepEqual(data.services.map(row => row.id), ['desayuno']); assert.equal(client.reads.length, 2);
  assert.deepEqual(V.contextLines(data).services, ['Desayuno · 09:30 · Programado']);
  const incoming = await V.readStayContext(createFixtureClient(contextFixtureData()), { ...target, scope: 'day', stayId: null, reservationId: 'incoming' });
  assert.equal(incoming.occupancy.adults, 4); assert.equal(incoming.services[0].id, 'incoming');
});
test('rechaza identidades ambiguas y conserva las secciones disponibles cuando falla una lectura', async () => {
  await assert.rejects(V.readStayContext(createFixtureClient(contextFixtureData()), { ...target, reservationId: 'incoming' }), /verificar/);
  const data = await V.readStayContext(createFixtureClient(contextFixtureData(), { servicios: 'Sin permiso' }), target);
  assert.deepEqual(data.unavailable, ['services']); assert.equal(data.notes.length, 2); assert.equal(data.occupancy.pets, 1);
  assert.equal(V.occupancyLabel({ adults: 2, children: 0, pets: 0 }), '2 personas · 2 adultos · 0 niños · Sin mascotas');
  assert.doesNotMatch(V.occupancyLabel({ adults: null, children: null, pets: null }), /NaN|0 personas|Sin mascotas/);
});
test('las notas y solicitudes históricas no duplican el contexto diario compartido', async () => {
  const data = await V.readStayContext(createFixtureClient(contextFixtureData()), target);
  const lines = V.contextLines(data, { notes: ['Nota de salida', 'Nota general', 'Nota general'], requests: [{ id: 'current-request', category: 'reposicion_lena', description: 'Reposición de Leña' }] });
  assert.deepEqual(lines.notes, ['03/11 · Nota del ingreso', '05/11 · Nota de salida', 'Nota general']); assert.equal(lines.requests.length, 2);
});
test('el caché une lecturas simultáneas y separa usuario, fecha y estadía', async () => {
  let reads = 0, release;
  const cache = V.createContextCache({ read: async (_client, t) => { reads++; if (reads === 1) await new Promise(resolve => { release = resolve; }); return { ...t, reservationId: t.reservationId }; } });
  const first = cache.load(null, 'staff', target), second = cache.load(null, 'staff', target);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 1); release(); assert.equal(await first, await second);
  await cache.load(null, 'staff', target); assert.equal(reads, 1);
  await cache.load(null, 'other-user', target); await cache.load(null, 'staff', { ...target, day: '2026-11-06' }); await cache.load(null, 'staff', { ...target, stayId: 'stay-5' }); assert.equal(reads, 4);
  cache.invalidate('staff', target.reservationId); await cache.load(null, 'staff', target); assert.equal(reads, 5);
});
test('la paginación recupera todas las notas de una reserva sin limitarse a la primera página', async () => {
  const tables = contextFixtureData(); tables.notas = Array.from({ length: 501 }, (_, i) => ({ ...tables.notas[0], id: String(i).padStart(4, '0'), texto: 'Nota ' + i }));
  const client = createFixtureClient(tables), data = await V.readStayContext(client, target);
  assert.equal(data.notes.length, 501); assert.equal(client.reads.filter(row => row.table === 'notas').length, 2);
});
