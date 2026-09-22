const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../js/haiku-libro-semantica-v1.js');
const golden = require('./fixtures/libro-servicios-sep26-golden.cjs');

test('golden Sep26 cubre exactamente 63 fragmentos con las cinco semánticas canónicas', () => {
  assert.equal(golden.casos.length, 63);
  assert.deepEqual(Object.fromEntries(Object.values(golden.S).map(estado => [estado, golden.casos.filter(x => x.semantica === estado).length])), {
    NO_SERVICIO: 8,
    SERVICIO_REAL: 49,
    CONSULTA_SERVICIO: 3,
    SERVICIO_DESCARTADO: 2,
    AMBIGUO: 1
  });
  assert.deepEqual(golden.casos.map(x => x.id), Array.from({ length: 63 }, (_, i) => i + 1));
  assert.ok(golden.casos.every(x => x.origen.startsWith('Sep26!') && x.texto && x.evidencias.length));
  assert.deepEqual(Object.fromEntries(['servicio_confirmado', 'servicio_por_confirmar', 'nota'].map(estado => [estado, golden.antes.filter(x => x === estado).length])), {
    servicio_confirmado: 33, servicio_por_confirmar: 15, nota: 15
  });
});

for (const caso of golden.casos) {
  test(`golden ${caso.id} ${caso.origen}: ${caso.semantica}`, () => {
    const actual = S.clasificarFragmentoServicio(caso.texto, caso.contexto);
    assert.equal(actual.semantica, caso.semantica, caso.texto);
    assert.deepEqual(actual.conceptos, caso.conceptos, caso.texto);
    assert.equal(S.clasificarIntencionFinanciera(caso.texto).intencion, caso.financiera, caso.texto);
    assert.ok(Array.isArray(actual.evidencias));
    assert.ok(Array.isArray(actual.unidadesServicio));
    if (caso.semantica === golden.S.REAL) assert.ok(actual.unidadesServicio.length, caso.texto);
  });
}

test('segmentación conserva tokens léxicos y separa sólo delimitadores reales', () => {
  assert.deepEqual(S.separarCampos('Nombre/03/09/26/2 MASAJES C/U X PAGAR/PROFESIONAL A'), [
    'Nombre', '03/09/26', '2 MASAJES C/U X PAGAR', 'PROFESIONAL A'
  ]);
  assert.deepEqual(S.separarCampos('2 MASAJES C/D CON PROFESIONAL A//JACUZZI 19:15/$30.000'), [
    '2 MASAJES C/D CON PROFESIONAL A', 'JACUZZI 19:15', '$30.000'
  ]);
  assert.deepEqual(S.separarCampos('Jacuzzi 19:15 x pagar / Late check-out 14:00 x pagar'), [
    'Jacuzzi 19:15 x pagar', 'Late check-out 14:00 x pagar'
  ]);
  assert.deepEqual(S.separarCampos('A /*/ B'), ['A', 'B']);
});

test('unidades múltiples no mezclan horarios ni conceptos', () => {
  const mixto = S.clasificarFragmentoServicio(golden.casos[5].texto);
  assert.deepEqual(mixto.unidadesServicio.map(x => [x.concepto, x.hora, x.intencion_financiera]), [
    ['jacuzzi', '22:15', 'COBRABLE'],
    ['lateout', '14:00', 'COBRABLE']
  ]);

  const dosMasajes = S.clasificarFragmentoServicio(golden.casos[24].texto);
  assert.deepEqual(dosMasajes.unidadesServicio.map(x => [x.concepto, x.hora]), [
    ['masaje', '12:15'],
    ['masaje', '13:15']
  ]);

  const simultaneos = S.clasificarFragmentoServicio(golden.casos[1].texto);
  assert.equal(simultaneos.unidadesServicio.length, 2);
  assert.deepEqual(simultaneos.unidadesServicio.map(x => x.hora), ['19:00', '19:00']);
});

test('Tinaja x confirmar permanece como el único ambiguo documentado', () => {
  const ambiguos = golden.casos.filter(x => S.clasificarFragmentoServicio(x.texto, x.contexto).semantica === 'AMBIGUO');
  assert.deepEqual(ambiguos.map(x => x.id), [17]);
  assert.match(ambiguos[0].observacion, /no contiene fecha, hora, duración/i);
});

test('scope-v2 consume la autoridad canónica y no conserva clasificadores semánticos paralelos', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/haiku-libro-servicios-scope-v2.js'), 'utf8');
  assert.doesNotMatch(source, /function\s+(?:clasificacionServicio|intencionOperativaServicio|esNotaNarrativaServicio)\s*\(/);
  assert.match(source, /clasificarFragmentoServicio/);
  assert.match(source, /servicio\?\.semantica\s*!==\s*"SERVICIO_REAL"/);
  assert.doesNotMatch(source.slice(source.indexOf('async function construir'), source.indexOf('function mensaje')), /clasificacion\s*===\s*"nota"/);
});
