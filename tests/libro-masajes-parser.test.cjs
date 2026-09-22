const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../js/haiku-libro-semantica-v1.js');
const golden = require('./fixtures/libro-masajes-sep26-golden.cjs');

const proyectar = unidad => ({
  tipo: unidad.tipo,
  duracion_minutos: unidad.duracion_minutos,
  cantidad: unidad.cantidad,
  hora: unidad.hora,
  simultaneo: unidad.simultaneo,
  profesionales: unidad.profesionales,
  asignacion_profesional: unidad.asignacion_profesional,
  intencion_financiera: unidad.intencion_financiera,
  marcadores_distribucion: unidad.marcadores_distribucion
});

function scope() {
  const context = { document: {}, addEventListener() {}, HAIKU_LIBRO_SEMANTICA: S };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/haiku-libro-servicios-scope-v2.js'), 'utf8')
    .replace('const api = Object.freeze({', 'const api = Object.freeze({depurarServicios, mapearConcepto, prepararServicio,'), context);
  return context.HAIKU_LIBRO_SERVICIOS_SCOPE_V2;
}

test('golden de masajes Sep26 conserva 8 fragmentos, 10 grupos y 17 masajes individuales', () => {
  assert.equal(golden.length, 8);
  const unidades = golden.flatMap(caso => S.parsearUnidadesMasaje(caso.texto));
  assert.equal(unidades.length, 10);
  assert.equal(unidades.reduce((total, unidad) => total + unidad.cantidad, 0), 17);
  const servicios = golden.flatMap(caso => S.servicios(caso.texto, { origen_campo: 'notas_reserva' }));
  assert.equal(servicios.length, 10);
  assert.equal(servicios.reduce((total, servicio) => total + servicio.cantidad, 0), 17);
  assert.ok(servicios.every(servicio => Object.hasOwn(servicio, 'tipo') && Object.hasOwn(servicio, 'duracion_minutos')));
});

for (const caso of golden) {
  test(`${caso.celda}: estructura completa de masaje`, () => {
    const unidades = S.parsearUnidadesMasaje(caso.texto);
    assert.deepEqual(unidades.map(proyectar), caso.unidades);
    assert.ok(unidades.every(unidad => unidad.texto_fuente_completo === caso.texto));
    const canon = S.clasificarFragmentoServicio(caso.texto, { origen_campo: 'notas_reserva' });
    assert.equal(canon.semantica, 'SERVICIO_REAL');
    assert.deepEqual(canon.unidadesServicio.map(proyectar), caso.unidades);
  });
}

test('las fronteras conservan y 1 con la segunda prestación', () => {
  for (const caso of [golden[0], golden[3]]) {
    const unidades = S.parsearUnidadesMasaje(caso.texto);
    assert.doesNotMatch(unidades[0].texto, /\by\s+1\s*$/i);
    assert.match(unidades[1].texto, /^y\s+1\s+/i);
  }
});

test('C3 conserva ambas unidades al depurar los servicios para la UI', () => {
  const P = scope();
  const fuente = S.servicios(golden[0].texto, { origen_campo: 'notas_reserva' });
  const depurados = P.depurarServicios({ servicios: fuente });

  assert.deepEqual(fuente.map(servicio => servicio.unidad_indice), [0, 1]);
  assert.deepEqual(Array.from(depurados, servicio => servicio.tipo), ['terapeutico', 'descontracturante']);
});

test('duraciones equivalentes y variantes tipográficas se normalizan sin fuzzy abierto', () => {
  for (const [duracion, texto] of [
    [60, '1 masaje terapéutico de 60 MIN a las 18 hrs'],
    [60, '1 masaje terapeutico de 1 hora a las 18 hrs'],
    [60, '1 masaje descontraturante de 1 hr a las 18 hrs'],
    [60, '1 masaje descontracturante de 1 h a las 18 hrs'],
    [30, '1 masaje reljante de media hora a las 18 hrs']
  ]) assert.equal(S.parsearUnidadesMasaje(texto)[0].duracion_minutos, duracion, texto);
  assert.equal(S.parsearUnidadesMasaje('1 masaje relevante de 60 min')[0].tipo, null);
  assert.deepEqual(S.parsearUnidadesMasaje('Coordinar con masajista Mónica'), []);
  const horarioUna = S.parsearUnidadesMasaje('1 masaje terapéutico a las 1 h')[0];
  assert.equal(horarioUna.duracion_minutos, null);
  assert.equal(horarioUna.hora, '01:00');
});

test('C/U y C/D se preservan, pero la fecha nunca vuelve a ser cantidad', () => {
  const cu = S.parsearUnidadesMasaje(golden[5].texto)[0];
  const cd = S.parsearUnidadesMasaje(golden[4].texto)[0];
  assert.equal(cu.cantidad, 4);
  assert.deepEqual(cu.marcadores_distribucion, ['C/U']);
  assert.equal(cd.cantidad, 2);
  assert.deepEqual(cd.marcadores_distribucion, ['C/D']);
});

test('simultaneidad comparte hora y profesionales sin inventar asignación individual', () => {
  const unidades = S.parsearUnidadesMasaje(golden[0].texto);
  assert.deepEqual(unidades.map(x => x.hora), ['19:00', '19:00']);
  assert.ok(unidades.every(x => x.simultaneo));
  assert.ok(unidades.every(x => x.asignacion_profesional === null));
  assert.deepEqual(unidades.map(x => x.profesionales), [
    ['Mónica', 'Josefina'], ['Mónica', 'Josefina']
  ]);
});

test('Relajante y Holístico son alias explícitos de Terapéutico según duración', () => {
  const P = scope();
  const casos = [
    ['1 masaje relajante de 30 min a las 18 hrs', 30, 'masajeTerapeutico30'],
    ['1 masaje relajante de 60 min a las 18 hrs', 60, 'masajeTerapeutico60'],
    ['1 masaje reljante de 60 min a las 18 hrs', 60, 'masajeTerapeutico60'],
    ['1 masaje holístico de 30 min a las 18 hrs', 30, 'masajeTerapeutico30'],
    ['1 masaje holistico de 1 hora a las 18 hrs', 60, 'masajeTerapeutico60']
  ];

  for (const [texto, duracion, codigo] of casos) {
    const unidad = S.parsearUnidadesMasaje(texto)[0];
    assert.equal(unidad.tipo, 'terapeutico', texto);
    assert.equal(unidad.duracion_minutos, duracion, texto);
    assert.equal(P.mapearConcepto({ ...unidad, concepto: 'masaje', texto_original: unidad.texto, unidad_servicio: unidad }).codigo, codigo, texto);
  }

  const descontracturante = S.parsearUnidadesMasaje('1 masaje descontracturante de 60 min a las 18 hrs')[0];
  assert.equal(descontracturante.tipo, 'descontracturante');
  assert.equal(P.mapearConcepto({ ...descontracturante, concepto: 'masaje', texto_original: descontracturante.texto, unidad_servicio: descontracturante }).codigo, 'masajeDescontracturante60');
});

test('Relajante sin duración conserva la revisión manual', () => {
  const P = scope();
  const asociacion = { estado: 'asociada', sistema: { id: 'estadia', reserva_id: 'reserva' } };
  const reserva = { titular: 'Prueba', cabana: 1, fecha_checkin: '2026-09-18', fecha_checkout: '2026-09-19', noches: 1, adultos: 2, tipo_estadia: 'alojamiento' };
  const servicio = S.servicios('1 masaje relajante a las 18 hrs x pagar', { origen_campo: 'notas_reserva' })[0];
  const preparado = P.prepararServicio(reserva, servicio, asociacion);

  assert.equal(servicio.tipo, 'terapeutico');
  assert.deepEqual(Array.from(preparado.razones), ['Falta duración del masaje.']);
  assert.equal(preparado.payload, null);
});

test('catálogo consume tipo y duración estructurados y entrega motivos precisos', () => {
  const P = scope();
  const servicio = unidad => ({ ...unidad, concepto: 'masaje', texto_original: unidad.texto, unidad_servicio: unidad });
  const c3 = S.parsearUnidadesMasaje(golden[0].texto);
  const descontracturante = P.mapearConcepto(servicio(c3[1]));
  assert.equal(descontracturante.codigo, 'masajeDescontracturante60');

  const relajante = P.mapearConcepto(servicio(c3[0]));
  assert.equal(c3[0].tipo, 'terapeutico');
  assert.equal(relajante.codigo, 'masajeTerapeutico60');

  const sinTipo = P.mapearConcepto(servicio(S.parsearUnidadesMasaje(golden[1].texto)[0]));
  assert.deepEqual(Array.from(sinTipo.motivos), ['Falta tipo de masaje.']);

  const sinDuracion = P.mapearConcepto(servicio(S.parsearUnidadesMasaje(golden[3].texto)[1]));
  assert.deepEqual(Array.from(sinDuracion.motivos), ['Falta duración del masaje.']);

  const terapeutico = S.parsearUnidadesMasaje('1 masaje terapéutico de 1 hora a las 18 hrs')[0];
  assert.equal(P.mapearConcepto(servicio(terapeutico)).codigo, 'masajeTerapeutico60');
});

test('la preparación muestra la causa restante, no vuelve a negar datos comprendidos', () => {
  const P = scope();
  const asociacion = { estado: 'asociada', sistema: { id: 'estadia', reserva_id: 'reserva' } };
  const reserva = { titular: 'Prueba', cabana: 1, fecha_checkin: '2026-09-18', fecha_checkout: '2026-09-19', noches: 1, adultos: 2, tipo_estadia: 'alojamiento' };

  const relajante = P.prepararServicio(reserva, S.servicios(golden[0].texto, { origen_campo: 'notas_reserva' })[0], asociacion);
  assert.deepEqual(Array.from(relajante.razones), []);
  assert.equal(relajante.payload.codigo_servicio, 'masajeTerapeutico60');

  const sinTipo = P.prepararServicio(reserva, S.servicios(golden[1].texto, { origen_campo: 'notas_reserva' })[0], asociacion);
  assert.ok(sinTipo.razones.includes('Falta tipo de masaje.'));
  assert.doesNotMatch(sinTipo.razones.join(' '), /Falta duración/i);

  const reservaAy10 = { ...reserva, fecha_checkin: '2026-09-13', fecha_checkout: '2026-09-14' };
  const sinHora = P.prepararServicio(reservaAy10, S.servicios(golden[4].texto, { origen_campo: 'notas_reserva' })[0], asociacion);
  assert.ok(sinHora.razones.includes('Falta horario del masaje.'));
  assert.doesNotMatch(sinHora.razones.join(' '), /Falta (?:tipo|duración)/i);
});
