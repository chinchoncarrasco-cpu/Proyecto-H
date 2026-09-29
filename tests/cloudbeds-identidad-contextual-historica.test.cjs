const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pdf = require('../js/haiku-cloudbeds-pdf-v1');
const tarifas = require('../js/haiku-cloudbeds-tarifas-v1');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function entrada(extra = {}) {
  return pdf.normalizar({
    reserva_cloudbeds: 'CB-HIST-1',
    id_cloudbeds: 'RID-HIST-1',
    nombre_huesped: 'José Pérez',
    habitaciones_raw: 'CD5(1)',
    check_in: '20/09/2026',
    check_out: '21/09/2026',
    noches: '1',
    precio_total: '$144.000',
    total_habitacion: '$121.008',
    deposito: '$144.000',
    saldo_pendiente: '$0',
    productos: '',
    estado: 'Confirmada',
    ...extra
  });
}

function reserva(id = 'r-historica', extra = {}) {
  return {
    id,
    cloudbeds_id: null,
    titular_nombre: 'José Pérez',
    estado_reserva: 'confirmada',
    grupo_reserva_id: null,
    estadias: [{ fecha_ingreso: '2026-09-20', fecha_salida: '2026-09-21', cabanas: { numero: 5 } }],
    ...extra
  };
}

function compararUna(fila, reservas, totales = {}) {
  return pdf.comparar([fila], reservas, reservas.map(item => ({
    reserva_id: item.id,
    total_alojamiento: Object.hasOwn(totales, item.id) ? totales[item.id] : 160000
  }))).filas[0];
}

const capacidadV31 = Object.freeze({
  consultada: true,
  version: 'total1_financiero_v31',
  writer_disponible: true,
  v31_disponible: true,
  motivo: 'Disponible globalmente; cada reserva requiere revalidación.',
  escritura_habilitada: false
});

test('reservation number exacto conserva identidad fuerte prioritaria', () => {
  const fila = compararUna(entrada({ id_cloudbeds: '' }), [reserva('r-numero', { cloudbeds_id: 'CB-HIST-1' })]);
  assert.equal(fila.identidad_tipo, 'CLOUDBEDS_RESERVA_EXACTA');
  assert.equal(fila.reserva_id, 'r-numero');
  assert.equal(fila.vinculo_cloudbeds_sugerido, null);
});

test('ID Cloudbeds exacto se distingue del reservation number', () => {
  const fila = compararUna(entrada({ reserva_cloudbeds: '' }), [reserva('r-id', { cloudbeds_id: 'RID-HIST-1' })]);
  assert.equal(fila.identidad_tipo, 'CLOUDBEDS_ID_EXACTO');
  assert.equal(fila.reserva_id, 'r-id');
});

test('cloudbeds_id NULL con contexto exacto único recupera la reserva histórica', () => {
  const proyecto = [reserva()];
  const antes = structuredClone(proyecto);
  const fila = compararUna(entrada(), proyecto);
  assert.equal(fila.identidad_tipo, 'CONTEXTO_EXACTO_UNICO');
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.equal(fila.reserva_id, 'r-historica');
  assert.deepEqual(fila.vinculo_cloudbeds_sugerido, {
    reserva_id: 'r-historica',
    reservation_number: 'CB-HIST-1',
    reservation_id: 'RID-HIST-1',
    evidencia: 'contexto_exacto_unico'
  });
  assert.deepEqual(proyecto, antes, 'comparar no escribe cloudbeds_id ni muta la reserva');
});

test('Rodrigo sin nombre, cabaña y fechas coincidentes sigue NO_IDENTIFICADA', () => {
  const fila = compararUna(entrada({ nombre_huesped: 'Rodrigo Control' }), [reserva()]);
  assert.equal(fila.identidad_tipo, 'NO_IDENTIFICADA');
  assert.equal(fila.certeza, 'NO_IDENTIFICADA');
  assert.equal(fila.reserva_id, null);
  assert.equal(fila.vinculo_cloudbeds_sugerido, null);
});

test('dos candidatas contextuales quedan AMBIGUA y sin reserva elegida', () => {
  const fila = compararUna(entrada(), [reserva('r-1'), reserva('r-2')]);
  assert.equal(fila.identidad_tipo, 'AMBIGUA');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.reserva_id, null);
  assert.match(fila.revisiones.join(' '), /más de una reserva o estadía/);
});

test('una reserva con dos estadías exactas no satisface la unicidad contextual', () => {
  const estadia = { fecha_ingreso: '2026-09-20', fecha_salida: '2026-09-21', cabanas: { numero: 5 } };
  const fila = compararUna(entrada(), [reserva('r-doble', { estadias: [estadia, { ...estadia }] })]);
  assert.equal(fila.identidad_tipo, 'AMBIGUA');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.reserva_id, null);
});

test('identificador fuerte y contexto exacto hacia otra reserva producen conflicto', () => {
  const fuerte = reserva('r-fuerte', { cloudbeds_id: 'CB-HIST-1', titular_nombre: 'Otra Persona' });
  const contextual = reserva('r-contexto');
  const fila = compararUna(entrada({ id_cloudbeds: '' }), [fuerte, contextual]);
  assert.equal(fila.identidad_tipo, 'AMBIGUA');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.reserva_id, null);
  assert.match(fila.revisiones.join(' '), /identificador fuerte.*reservas distintas/i);
});

test('contexto exacto no reutiliza una reserva ya vinculada a otro Cloudbeds', () => {
  const fila = compararUna(entrada(), [reserva('r-ocupada', { cloudbeds_id: 'CB-OTRA' })]);
  assert.equal(fila.identidad_tipo, 'AMBIGUA');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.reserva_id, null);
  assert.match(fila.revisiones.join(' '), /ya tiene otro vínculo Cloudbeds/);
});

test('tildes, mayúsculas y espacios usan la normalización exacta existente', () => {
  const fila = compararUna(entrada({ nombre_huesped: '  JOSE    PEREZ  ' }), [reserva()]);
  assert.equal(fila.identidad_tipo, 'CONTEXTO_EXACTO_UNICO');
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
});

test('nombre parecido pero no exacto nunca usa fuzzy match', () => {
  const fila = compararUna(entrada({ nombre_huesped: 'José Peres' }), [reserva()]);
  assert.equal(fila.identidad_tipo, 'NO_IDENTIFICADA');
  assert.equal(fila.reserva_id, null);
});

test('cabaña distinta no identifica por contexto', () => {
  const fila = compararUna(entrada({ habitaciones_raw: 'CD7(1)' }), [reserva()]);
  assert.equal(fila.identidad_tipo, 'NO_IDENTIFICADA');
});

test('fechas distintas no identifican a la misma persona y cabaña', () => {
  const fila = compararUna(entrada({ check_in: '22/09/2026', check_out: '23/09/2026' }), [reserva()]);
  assert.equal(fila.identidad_tipo, 'NO_IDENTIFICADA');
});

test('contexto exacto con descuento continúa a ALTA_CERTEZA', () => {
  const fila = compararUna(entrada(), [reserva()]);
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.equal(fila.total_proyecto_h, 160000);
  assert.equal(fila.total_cloudbeds_alojamiento, 144000);
  assert.equal(fila.diferencia, -16000);
});

test('contexto exacto con productos coherentes continúa a ALTA_CERTEZA', () => {
  const fila = compararUna(entrada({
    precio_total: '$318.000', total_habitacion: '$242.016', deposito: '$288.000', productos: 'Tinaja tipo Jacuzzi'
  }), [reserva()], { 'r-historica': 300000 });
  assert.equal(fila.identidad_tipo, 'CONTEXTO_EXACTO_UNICO');
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.equal(fila.propuesta.componente_no_alojamiento_observable, 30000);
});

test('contexto aparente en fila multihabitación permanece REVISION_MANUAL', () => {
  const fila = compararUna(entrada({ habitaciones_raw: 'CD5(1), C10(1)' }), [reserva()]);
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.identidad_tipo, 'AMBIGUA');
});

test('contexto exacto identifica un grupo, pero la capa financiera lo bloquea', () => {
  const fila = compararUna(entrada(), [reserva('r-grupo', { grupo_reserva_id: 'grupo-1' })]);
  assert.equal(fila.identidad_tipo, 'CONTEXTO_EXACTO_UNICO');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.reserva_id, 'r-grupo');
  assert.match(fila.revisiones.join(' '), /grupo o más de una estadía/);
});

test('la identidad se resuelve antes y sin usar montos o productos', () => {
  const fila = compararUna(entrada({ precio_total: '$1', deposito: '$999', productos: 'Dato contradictorio' }), [reserva()]);
  assert.equal(fila.identidad_tipo, 'CONTEXTO_EXACTO_UNICO');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
});

test('Haku muestra el contexto sin moverlo a No identificadas y Ver reserva usa el ID interno', async () => {
  const fila = compararUna(entrada(), [reserva()]);
  const informe = {
    filas: [fila],
    conteos_certeza: { SIN_CAMBIO: 0, ALTA_CERTEZA: 1, REVISION_MANUAL: 0, NO_APLICA: 0, NO_IDENTIFICADA: 0 }
  };
  const modelo = tarifas.prepararModelo(informe, capacidadV31);
  const html = tarifas.renderizar(modelo);
  assert.equal(modelo.conteos.ALTA_CERTEZA, 1);
  assert.equal(modelo.conteos.NO_IDENTIFICADA, 0);
  assert.match(html, /Reserva identificada por contexto exacto/);
  assert.match(html, /Vínculo Cloudbeds aún no guardado/);
  assert.match(html, /Nombre, cabaña, check-in y check-out identifican una única reserva/);
  const aperturas = [];
  global.HAIKU_INSPECTOR_V1 = { abrirReserva: async id => { aperturas.push(id); return true; } };
  await tarifas.abrirReserva(fila.propuesta.reserva_id);
  delete global.HAIKU_INSPECTOR_V1;
  assert.deepEqual(aperturas, ['r-historica']);
});

test('writer 2E permanece apagado y el vínculo sugerido no entra en el payload', () => {
  const fila = compararUna(entrada(), [reserva()]);
  const modelo = tarifas.prepararModelo({ filas: [fila] }, capacidadV31);
  tarifas.seleccionarTodo(modelo, true);
  assert.equal(tarifas.CLOUDBEDS_TARIFAS_WRITER_HABILITADO, false);
  assert.deepEqual(tarifas.construirPayload(modelo), [{
    reserva_id: 'r-historica', total_actual: 160000, total_objetivo: 144000
  }]);
  assert.equal(tarifas.confirmarSimulacion(modelo).escrituras, 0);
  assert.doesNotMatch(read('js/haiku-cloudbeds-tarifas-v1.js'), /haiku_cambiar_totales_lote_v1/);
});

test('fixture histórico recupera dos propuestas y mantiene a Rodrigo como control negativo', () => {
  const demo = read('tests/fixtures/cloudbeds-haku-tarifas-2e/demo.js');
  assert.match(demo, /reserva\('r-hector', null, 'Héctor Ficticio'\)/);
  assert.match(demo, /reserva\('r-elena', null, 'Elena Ficticia'\)/);
  assert.match(demo, /base\('CB-RODRIGO', 'Rodrigo Control'\)/);
  const entradas = [
    entrada({ reserva_cloudbeds: 'CB-HECTOR', id_cloudbeds: 'RID-HECTOR', nombre_huesped: 'Héctor Ficticio' }),
    entrada({ reserva_cloudbeds: 'CB-ELENA', id_cloudbeds: 'RID-ELENA', nombre_huesped: 'Elena Ficticia', precio_total: '$318.000', total_habitacion: '$242.016', deposito: '$288.000', productos: 'Tinaja tipo Jacuzzi' }),
    entrada({ reserva_cloudbeds: 'CB-RODRIGO', id_cloudbeds: 'RID-RODRIGO', nombre_huesped: 'Rodrigo Control' })
  ];
  const reservas = [
    reserva('r-hector', { titular_nombre: 'Héctor Ficticio' }),
    reserva('r-elena', { titular_nombre: 'Elena Ficticia' })
  ];
  const informe = pdf.comparar(entradas, reservas, [
    { reserva_id: 'r-hector', total_alojamiento: 160000 },
    { reserva_id: 'r-elena', total_alojamiento: 300000 }
  ]);
  assert.equal(informe.filas.filter(fila => fila.identidad_tipo === 'CONTEXTO_EXACTO_UNICO').length, 2);
  assert.equal(informe.conteos_certeza.ALTA_CERTEZA, 2);
  assert.equal(informe.conteos_certeza.NO_IDENTIFICADA, 1);
  assert.equal(informe.filas.find(fila => fila.entrada.nombre_huesped === 'Rodrigo Control').identidad_tipo, 'NO_IDENTIFICADA');
});
