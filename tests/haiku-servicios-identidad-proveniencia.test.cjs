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

  const cortesiaConCargo = P.decisionServicioExistente(cortesia, [existente({ total: 30000, tipo_cobro: 'cortesia' })]);
  assert.equal(cortesiaConCargo.estado, 'revisar');
  assert.deepEqual(Array.from(cortesiaConCargo.contradicciones), ['total']);

  const cobrable = preparar('TINAJA TONEL 19.15 HRS POR COBRAR');
  const decision = P.decisionServicioExistente(cobrable, [existente({ total: 0, tipo_cobro: 'cortesia' })]);
  assert.equal(decision.estado, 'revisar');
  assert.deepEqual(Array.from(decision.contradicciones), ['tipo_cobro']);
  assert.match(decision.motivo, /datos explícitos.*tipo_cobro/i);
});

test('Carlos: candidato único por reserva, hora y cortesía se omite sin inventar fecha ni subtipo', () => {
  const reservaLarga = { ...reserva, titular: 'Carlos', fecha_checkin: '2026-09-11', fecha_checkout: '2026-09-13', noches: 2 };
  const servicio = S.servicios('tinaja de cortesía 19.15 hrs', { origen_campo: 'notas_reserva' })[0];
  const item = P.prepararServicio(reservaLarga, servicio, asociacion);
  assert.equal(item.fecha, null);
  assert.equal(item.mapa.codigo, undefined);

  const candidato = existente({ id: 'servicio-carlos', fecha_servicio: '2026-09-11', catalogo_servicios: { codigo: 'tinajaTonel', nombre: 'Tinaja Tonel de Madera' } });
  const decision = P.decisionServicioExistente(item, [candidato]);
  assert.equal(decision.estado, 'existente');
  assert.match(decision.motivo, /candidato|equivalente único|fecha ausente/i);
});

test('Yenny: dos candidatos compatibles en noches distintas mantienen la revisión', () => {
  const reservaLarga = { ...reserva, titular: 'Yenny', fecha_checkin: '2026-09-11', fecha_checkout: '2026-09-13', noches: 2 };
  const servicio = S.servicios('tinaja de cortesía 19.15 hrs', { origen_campo: 'notas_reserva' })[0];
  const item = P.prepararServicio(reservaLarga, servicio, asociacion);
  const candidatos = [
    existente({ id: 'servicio-yenny-1', fecha_servicio: '2026-09-11' }),
    existente({ id: 'servicio-yenny-2', fecha_servicio: '2026-09-12' })
  ];
  const decision = P.decisionServicioExistente(item, candidatos);
  assert.equal(decision.estado, 'revisar');
  assert.equal(decision.candidatos.length, 2);
  assert.match(decision.motivo, /más de un servicio existente compatible/i);
});

test('dos candidatos compatibles conservan identidad ambigua', () => {
  const item = preparar('TINAJA DE CORTESIA TONEL 19.15 HRS');
  const decision = P.decisionServicioExistente(item, [existente(), existente({ id: 'servicio-catalina-2' })]);
  assert.equal(decision.estado, 'revisar');
  assert.equal(decision.candidatos.length, 2);
  assert.match(decision.motivo, /más de un servicio existente compatible/i);
});
