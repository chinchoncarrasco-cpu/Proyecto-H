const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../js/haiku-libro-semantica-v1.js');

const context = { document: {}, addEventListener() {}, HAIKU_LIBRO_SEMANTICA: S };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/haiku-libro-servicios-scope-v2.js'), 'utf8')
  .replace('const api = Object.freeze({', 'const api = Object.freeze({prepararServicio, decisionServicioExistente, aplicarServicioExistente,'), context);
const P = context.HAIKU_LIBRO_SERVICIOS_SCOPE_V2;

const reservaId = '7a51d7b8-fb70-4189-9d0c-3a7b0c247de8';
const estadiaId = 'cf8fa99f-cefc-4c68-9a5a-9b805caefec8';
const reserva = { titular: 'Catalina Sierra', cabana: 1, fecha_checkin: '2026-09-19', fecha_checkout: '2026-09-20', noches: 1, adultos: 3, tipo_estadia: 'alojamiento' };
const asociacion = { estado: 'asociada', sistema: { reserva_id: reservaId, id: estadiaId } };
const existente = (extra = {}) => ({
  id: 'servicio-catalina', reserva_id: reservaId, estadia_id: estadiaId,
  fecha_servicio: '2026-09-19', hora_inicio: '19:15:00', hora_fin: '20:15:00',
  total: 0, cantidad: 1, personas: 1, tipo_cobro: 'cortesia', estado_servicio: 'programado',
  observaciones: 'HAIKU-LEGACY-ID:servicio-hecho-65d8iq',
  catalogo_servicios: { codigo: 'tinajaTonel', nombre: 'Tinaja Tonel de Madera' },
  ...extra
});

function preparar(texto) {
  const servicio = S.servicios(texto, { origen_campo: 'notas_reserva' })[0];
  assert.ok(servicio, texto);
  return P.prepararServicio(reserva, servicio, asociacion);
}

test('Catalina real: hora única y personas inferidas permiten omitir el Tonel existente', () => {
  const item = preparar('TINAJA DE CORTESIA TONEL 19.15 HRS');
  assert.equal(item.hora, '19:15');
  assert.equal(item.hora_fin, null);
  assert.equal(item.personas, 3);
  assert.equal(item.proveniencia.concepto, 'EXPLICITO');
  assert.equal(item.proveniencia.hora_inicio, 'EXPLICITO');
  assert.equal(item.proveniencia.hora_fin, 'AUSENTE');
  assert.equal(item.proveniencia.personas, 'INFERIDO');
  assert.equal(item.proveniencia.cantidad, 'INFERIDO');
  assert.equal(item.proveniencia.tipo_cobro, 'EXPLICITO');
  assert.equal(item.proveniencia.monto, 'AUSENTE');
  assert.equal(item.proveniencia.fecha, 'INFERIDA_SEGURA');

  const decision = P.decisionServicioExistente(item, [existente()]);
  assert.equal(decision.estado, 'existente');
  P.aplicarServicioExistente(item, decision);
  assert.equal(item.estado, 'existente');
  assert.equal(item.identidad, 'YA_EXISTE');
  assert.equal(item.payload, null);
});

test('personas inferidas nunca contradicen; personas explícitas incompatibles sí', () => {
  const inferidas = preparar('TINAJA DE CORTESIA TONEL 19.15 HRS');
  assert.equal(P.decisionServicioExistente(inferidas, [existente({ personas: 1 })]).estado, 'existente');

  const explicitas = preparar('TINAJA DE CORTESIA TONEL 19.15 HRS PARA 3 PERSONAS');
  assert.equal(explicitas.proveniencia.personas, 'EXPLICITO');
  const decision = P.decisionServicioExistente(explicitas, [existente({ personas: 1 })]);
  assert.equal(decision.estado, 'revisar');
  assert.deepEqual(Array.from(decision.contradicciones), ['personas']);
});

test('hora de término ausente no contradice un rango existente; un rango explícito distinto sí', () => {
  const horaUnica = preparar('TINAJA DE CORTESIA TONEL 19.15 HRS');
  assert.equal(P.decisionServicioExistente(horaUnica, [existente({ hora_fin: '20:15:00' })]).estado, 'existente');

  const rango = preparar('TINAJA DE CORTESIA TONEL DE 19:15 A 20:15');
  assert.equal(rango.proveniencia.hora_fin, 'EXPLICITO');
  const decision = P.decisionServicioExistente(rango, [existente({ hora_fin: '21:15:00' })]);
  assert.equal(decision.estado, 'revisar');
  assert.deepEqual(Array.from(decision.contradicciones), ['hora_fin']);
});

test('cortesía equivalente es existente y cobro explícito contra cortesía requiere revisión', () => {
  const cortesia = preparar('TINAJA DE CORTESIA TONEL 19.15 HRS');
  assert.equal(P.decisionServicioExistente(cortesia, [existente({ total: 0, tipo_cobro: 'cortesia' })]).estado, 'existente');

  const cobrable = preparar('TINAJA TONEL 19.15 HRS POR COBRAR');
  const decision = P.decisionServicioExistente(cobrable, [existente({ total: 0, tipo_cobro: 'cortesia' })]);
  assert.equal(decision.estado, 'revisar');
  assert.match(decision.motivo, /intención de cobro o cortesía/i);
});

test('dos candidatos compatibles conservan identidad ambigua', () => {
  const item = preparar('TINAJA DE CORTESIA TONEL 19.15 HRS');
  const decision = P.decisionServicioExistente(item, [existente(), existente({ id: 'servicio-catalina-2' })]);
  assert.equal(decision.estado, 'revisar');
  assert.equal(decision.candidatos.length, 2);
  assert.match(decision.motivo, /más de un servicio existente compatible/i);
});
