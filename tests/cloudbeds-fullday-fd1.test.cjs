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
    reserva_cloudbeds: 'CB-FD-1',
    id_cloudbeds: 'RID-FD-1',
    nombre_huesped: 'Amanda Full Day',
    habitaciones_raw: 'CD5(1)',
    check_in: '28/09/2026',
    check_out: '29/09/2026',
    noches: '1',
    precio_total: '$120.000',
    deposito: '$120.000',
    saldo_pendiente: '$0',
    productos: '',
    estado: 'Confirmada',
    adultos: '2',
    ninos: '0',
    ...extra
  });
}

function reserva(id = 'r-fd-1', extra = {}) {
  return {
    id,
    cloudbeds_id: null,
    titular_nombre: 'Amanda Full Day',
    estado_reserva: 'confirmada',
    grupo_reserva_id: null,
    estadias: [{
      id: `e-${id}`,
      fecha_ingreso: '2026-09-28',
      fecha_salida: '2026-09-28',
      tipo_estadia: 'fullday',
      adultos: 2,
      ninos: 0,
      mascotas: 0,
      cabanas: { numero: 5 }
    }],
    ...extra
  };
}

function compararUna(fila = entrada(), proyecto = [reserva()], saldos = {}) {
  return pdf.comparar([fila], proyecto, proyecto.map(item => ({
    reserva_id: item.id,
    total_alojamiento: saldos[item.id]?.total ?? 160000,
    pagado_alojamiento: saldos[item.id]?.pagado ?? 120000,
    saldo_alojamiento: saldos[item.id]?.saldo ?? 40000
  }))).filas[0];
}

const capacidadV31 = Object.freeze({
  consultada: true,
  version: 'total1_financiero_v31',
  writer_disponible: true,
  v31_disponible: true,
  motivo: 'Disponible sólo para diagnóstico.',
  escritura_habilitada: false
});
test('FD-1 reconoce Cloudbeds D→D+1 contra Proyecto H fullday D→D', () => {
  const fila = compararUna();
  assert.equal(pdf.esVentanaFullDay(fila.entrada), true);
  assert.equal(fila.identidad_tipo, 'CONTEXTO_FULLDAY_UNICO');
  assert.equal(fila.reserva_id, 'r-fd-1');
  assert.equal(fila.propuesta.es_full_day, true);
  assert.deepEqual(
    [fila.propuesta.fecha_ingreso_proyecto_h, fila.propuesta.fecha_salida_proyecto_h],
    ['2026-09-28', '2026-09-28']
  );
});

test('identidad Full Day exacta es contextual y no depende de montos', () => {
  const fila = compararUna(entrada({ precio_total: '$1', deposito: '$999' }));
  assert.equal(fila.identidad_tipo, 'CONTEXTO_FULLDAY_UNICO');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
});

test('caso A: 160000 actual, 120000 pagado y Deposit 120000 propone saldo esperado cero', () => {
  const fila = compararUna();
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.equal(fila.propuesta.total_actual_haku, 160000);
  assert.equal(fila.propuesta.total_alojamiento_propuesto, 120000);
  assert.equal(fila.propuesta.pagado_actual_haku, 120000);
  assert.equal(fila.propuesta.saldo_actual_haku, 40000);
  assert.equal(fila.propuesta.saldo_esperado_haku, 0);
});

test('caso B: 150000 actual conserva Deposit 120000 como propuesta', () => {
  const fila = compararUna(entrada(), [reserva()], { 'r-fd-1': { total: 150000, pagado: 120000, saldo: 30000 } });
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.equal(fila.total_cloudbeds_alojamiento, 120000);
  assert.equal(fila.diferencia, -30000);
});

test('caso C: 120000 actual queda SIN_CAMBIO', () => {
  const fila = compararUna(entrada(), [reserva()], { 'r-fd-1': { total: 120000, pagado: 120000, saldo: 0 } });
  assert.equal(fila.certeza, 'SIN_CAMBIO');
  assert.equal(fila.diferencia, 0);
  assert.equal(fila.propuesta.saldo_esperado_haku, 0);
});

test('caso D: Price Total 150000 con producto 30000 mantiene alojamiento en Deposit 120000', () => {
  const fila = compararUna(entrada({ precio_total: '$150.000', productos: 'Almuerzo ficticio' }));
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.equal(fila.propuesta.precio_total_cloudbeds, 150000);
  assert.equal(fila.propuesta.deposito_cloudbeds, 120000);
  assert.equal(fila.propuesta.total_alojamiento_propuesto, 120000);
  assert.equal(fila.propuesta.componente_no_alojamiento_observable, 30000);
});

test('Deposit siempre es el candidato y Price Total nunca suma productos al alojamiento', () => {
  const fila = compararUna(entrada({ precio_total: '$180.000', deposito: '$120.000', productos: 'Producto A; Producto B' }));
  assert.equal(fila.fuente_financiera, 'deposito_100_alojamiento_haiku_cabanas');
  assert.equal(fila.propuesta.total_alojamiento_propuesto, 120000);
  assert.notEqual(fila.propuesta.total_alojamiento_propuesto, fila.propuesta.precio_total_cloudbeds);
});

test('Productos ausente exige revisión, distinto de Productos presente y vacío', () => {
  const sinProductos = {
    reserva_cloudbeds: 'CB-FD-1', id_cloudbeds: 'RID-FD-1', nombre_huesped: 'Amanda Full Day',
    habitaciones_raw: 'CD5(1)', check_in: '28/09/2026', check_out: '29/09/2026', noches: '1',
    precio_total: '$120.000', deposito: '$120.000', estado: 'Confirmada'
  };
  const ausente = compararUna(pdf.normalizar(sinProductos));
  const vacio = compararUna(entrada());
  assert.equal(ausente.certeza, 'REVISION_MANUAL');
  assert.match(ausente.revisiones.join(' '), /columna Productos está ausente/);
  assert.equal(vacio.certeza, 'ALTA_CERTEZA');
});

test('dos estadías Full Day compatibles quedan AMBIGUA sin elegir drawer', () => {
  const fila = compararUna(entrada(), [reserva('r-fd-1'), reserva('r-fd-2')]);
  assert.equal(fila.identidad_tipo, 'AMBIGUA');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.reserva_id, null);
});

test('nombre distinto con cabina y Full Day únicos queda REVISION_MANUAL, no NO_IDENTIFICADA', () => {
  const fila = compararUna(entrada({ nombre_huesped: 'Amanda Nombre Distinto' }));
  assert.equal(fila.identidad_tipo, 'CONTEXTO_FULLDAY_UNICO');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.reserva_id, 'r-fd-1');
  assert.match(fila.revisiones.join(' '), /nombre no coincide exactamente/);
});

test('nombre parecido nunca se eleva con fuzzy matching', () => {
  const fila = compararUna(entrada({ nombre_huesped: 'Amand Full Dai' }));
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.doesNotMatch(fila.evidencias.join(' '), /parecido|similitud/i);
});

test('cabaña o fechas incompatibles no identifican el Full Day', () => {
  const cabana = compararUna(entrada({ habitaciones_raw: 'CD7(1)' }));
  const fecha = compararUna(entrada({ check_in: '30/09/2026', check_out: '01/10/2026' }));
  assert.equal(cabana.identidad_tipo, 'NO_IDENTIFICADA');
  assert.equal(fecha.identidad_tipo, 'NO_IDENTIFICADA');
});

test('una estadía normal de alojamiento conserva CONTEXTO_EXACTO_UNICO', () => {
  const normal = reserva('r-normal', {
    estadias: [{ fecha_ingreso: '2026-09-28', fecha_salida: '2026-09-29', tipo_estadia: 'alojamiento', cabanas: { numero: 5 } }]
  });
  const fila = compararUna(entrada({ deposito: '$144.000', precio_total: '$144.000' }), [normal]);
  assert.equal(fila.identidad_tipo, 'CONTEXTO_EXACTO_UNICO');
  assert.equal(fila.propuesta.es_full_day, false);
});

test('Full Day multihabitación sigue bloqueado para revisión', () => {
  const fila = compararUna(entrada({ habitaciones_raw: 'CD5(1), CD7(1)' }));
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.identidad_tipo, 'AMBIGUA');
});

test('2 adultos y 0 niños corroboran 2×60000; otra composición no inventa precio infantil', () => {
  const estandar = compararUna();
  const otra = reserva('r-otra', {
    estadias: [{
      fecha_ingreso: '2026-09-28', fecha_salida: '2026-09-28', tipo_estadia: 'fullday',
      adultos: 2, ninos: 1, mascotas: 0, cabanas: { numero: 5 }
    }]
  });
  const variable = compararUna(entrada(), [otra], { 'r-otra': { total: 160000, pagado: 120000, saldo: 40000 } });
  assert.equal(estandar.propuesta.referencia_fullday_clp, 120000);
  assert.match(estandar.evidencias.join(' '), /2 × \$60\.000 = \$120\.000/);
  assert.equal(variable.propuesta.referencia_fullday_clp, null);
  assert.equal(variable.certeza, 'ALTA_CERTEZA');
  assert.match(variable.evidencias.join(' '), /no permite generalizar una tarifa infantil/);
});

test('referencia estándar 120000 contradictoria baja a revisión', () => {
  const fila = compararUna(entrada({ precio_total: '$130.000', deposito: '$130.000' }));
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.match(fila.revisiones.join(' '), /Depósito no coincide con la referencia Full Day/);
});

test('UI Haku muestra FULL DAY, fechas, personas, saldos y Ver reserva interno', async () => {
  const fila = compararUna();
  const modelo = tarifas.prepararModelo({ filas: [fila] }, capacidadV31);
  const html = tarifas.renderizar(modelo);
  assert.match(html, /FULL DAY/);
  assert.match(html, /Proyecto H D → D · Cloudbeds D → D\+1/);
  assert.match(html, /2 adultos · 0 niños · 0 mascotas/);
  assert.match(html, /Pagado actual/);
  assert.match(html, /Saldo esperado/);
  const aperturas = [];
  global.HAIKU_INSPECTOR_V1 = { abrirReserva: async id => { aperturas.push(id); return true; } };
  await tarifas.abrirReserva(fila.propuesta.reserva_id);
  delete global.HAIKU_INSPECTOR_V1;
  assert.deepEqual(aperturas, ['r-fd-1']);
});

test('writer permanece false y el vínculo sugerido nunca entra en payload', () => {
  const fila = compararUna();
  const modelo = tarifas.prepararModelo({ filas: [fila] }, capacidadV31);
  tarifas.seleccionarTodo(modelo, true);
  assert.equal(tarifas.CLOUDBEDS_TARIFAS_WRITER_HABILITADO, false);
  assert.deepEqual(tarifas.construirPayload(modelo), [{
    reserva_id: 'r-fd-1', total_actual: 160000, total_objetivo: 120000
  }]);
  assert.equal(tarifas.confirmarSimulacion(modelo).escrituras, 0);
  assert.doesNotMatch(read('js/haiku-cloudbeds-tarifas-v1.js'), /p_cloudbeds_id|\.update\(|\.insert\(/);
});

test('consulta sólo lectura incorpora tipo, personas y saldos actuales', async () => {
  const selects = [];
  const proyecto = [reserva()];
  const saldos = [{ reserva_id: 'r-fd-1', total_alojamiento: 160000, pagado_alojamiento: 120000, saldo_alojamiento: 40000 }];
  const cliente = {
    from(tabla) {
      return {
        select(campos) { selects.push([tabla, campos]); return this; },
        order() { return this; },
        range() { return Promise.resolve({ data: tabla === 'reservas' ? proyecto : saldos }); }
      };
    },
    rpc() { throw new Error('Writer prohibido'); }
  };
  const informe = await pdf.consultar([entrada()], cliente);
  assert.equal(informe.filas[0].identidad_tipo, 'CONTEXTO_FULLDAY_UNICO');
  assert.match(selects.find(([tabla]) => tabla === 'reservas')[1], /tipo_estadia,adultos,ninos,mascotas/);
  assert.match(selects.find(([tabla]) => tabla === 'vista_saldos_alojamiento_reserva')[1], /pagado_alojamiento,saldo_alojamiento/);
});
