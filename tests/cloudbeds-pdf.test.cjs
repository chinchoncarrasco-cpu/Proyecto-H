const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../js/haiku-cloudbeds-pdf-v1');

const raw = (extra = {}) => ({
  reserva_cloudbeds: '9000000000001',
  fecha_reserva: '01/09/2026',
  habitaciones_raw: 'CD5(1)',
  check_in: '04/09/2026',
  check_out: '07/09/2026',
  precio_total: '$459.000',
  total_habitacion: '$385.714',
  deposito: '$459.000',
  productos: '',
  estado: 'Checked Out',
  noches: '3',
  adultos: '2',
  ninos: '0',
  habitacion_ids: '9000000000001',
  nombre_huesped: 'Persona Ejemplo',
  correo: 'p****a@example.invalid',
  movil: '+*******1234',
  telefono: '',
  saldo_pendiente: '0',
  ...extra
});

const reserva = (extra = {}) => ({
  id: 'r1',
  cloudbeds_id: '9000000000001',
  titular_nombre: 'Persona Ejemplo',
  estado_reserva: 'checked_out',
  estadias: [{ fecha_ingreso: '2026-09-04', fecha_salida: '2026-09-07', cabanas: { numero: 5 } }],
  ...extra
});

const comparar = (entrada = raw(), reservas = [reserva()], total = 459000) =>
  api.comparar([api.normalizar(entrada)], reservas, [{ reserva_id: 'r1', total_alojamiento: total }]);

const columnasBase = [
  ['Reserva', 'reserva_cloudbeds'],
  ['Fecha de la reserva', 'fecha_reserva'],
  ['Número de habitación', 'habitaciones_raw'],
  ['Check-in', 'check_in'],
  ['Check-out', 'check_out'],
  ['Precio Total', 'precio_total'],
  ['Total De La Habitación', 'total_habitacion'],
  ['Depósito', 'deposito'],
  ['Productos', 'productos'],
  ['Estado', 'estado'],
  ['Noches', 'noches'],
  ['Adultos', 'adultos'],
  ['Niños', 'ninos'],
  ['Habitación ID', 'habitacion_ids'],
  ['Nombre y apellido', 'nombre_huesped'],
  ['Correo electrónico', 'correo'],
  ['Móvil', 'movil'],
  ['Teléfono', 'telefono'],
  ['Saldo pendiente', 'saldo_pendiente']
];

function paginaFlexible(columnas, rows, { header = true, width, rowStart = 86, rowGap = 54 } = {}) {
  const items = [];
  const gap = 112;
  const x0 = 32;
  if (header) {
    columnas.forEach(([encabezado], i) => String(encabezado).split('\n').forEach((str, j) =>
      items.push({ str, x: x0 + i * gap, y: 38 + j * 7, h: 4 })));
  }
  rows.forEach((row, rowIndex) => columnas.forEach(([, key], i) => {
    const valor = row[key] ?? '';
    String(valor).split('\n').forEach((str, j, lineas) => items.push({
      str,
      x: x0 + i * gap,
      y: rowStart + rowIndex * rowGap + (j - (lineas.length - 1) / 2) * 9,
      h: 4
    }));
  }));
  return { width: width || x0 * 2 + Math.max(1, columnas.length) * gap, height: Math.max(400, rowStart + rows.length * rowGap + 50), items };
}

const pagina = (rows, opciones = {}) => paginaFlexible(columnasBase, rows, opciones);

test('catálogo flexible supera las 50 columnas y no expone REQUERIDAS global', () => {
  assert.ok(api.COLUMNAS.length >= 50);
  assert.equal(api.REQUERIDAS, undefined);
  assert.equal(api.MATRIZ_CAPACIDADES.actualizar_tarifa.implementada, false);
});

test('dinero chileno conserva cero y rechaza formatos ambiguos', () => {
  for (const [texto, numero] of [['$540.003', 540003], ['$1.068.000', 1068000], ['$0', 0], ['0', 0], ['CLP $160.000', 160000]]) {
    assert.equal(api.dinero(texto), numero);
  }
  assert.equal(api.dinero('$1.20'), null);
});

test('fechas DD/MM/YYYY se validan contra calendario', () => {
  assert.equal(api.fecha('04/09/2026'), '2026-09-04');
  for (const texto of ['31/02/2026', '9/4/26', '2026-09-04']) assert.equal(api.fecha(texto), null);
});

test('los cuatro campos financieros se conservan por separado', () => {
  const entrada = api.normalizar(raw({
    precio_total: '$180.000', total_habitacion: '$144.000', saldo_pendiente: '$30.000', deposito: '$50.000'
  }));
  assert.deepEqual(
    [entrada.precio_total, entrada.total_habitacion, entrada.saldo_pendiente, entrada.deposito],
    [180000, 144000, 30000, 50000]
  );
  assert.equal(entrada.valor_alojamiento_propuesto, 50000);
  assert.equal(entrada.fuente_tarifa_propuesta, 'deposito_100_alojamiento_haiku_cabanas');
});

test('contactos enmascarados se conservan sin declararlos verificados', () => {
  const entrada = api.normalizar(raw({ telefono: '***5678' }));
  assert.equal(entrada.correo, 'p****a@example.invalid');
  assert.ok(entrada.correo_enmascarado && entrada.movil_enmascarado && entrada.telefono_enmascarado);
  assert.equal(entrada.contactos_verificados, false);
});

test('filas con nombres multilínea y varias páginas se mantienen delimitadas', () => {
  const entradas = api.parsearPaginas([
    pagina([raw({ nombre_huesped: 'Persona\nEjemplo' })]),
    pagina([raw({ reserva_cloudbeds: '9000000000002' })], { header: false }),
    pagina([raw({ reserva_cloudbeds: '9000000000003' })])
  ]);
  assert.equal(entradas.length, 3);
  assert.equal(entradas[0].nombre_huesped, 'Persona Ejemplo');
  assert.equal(entradas[2].origen.pagina, 3);
});

test('cabecera de impresión no contamina una página sin encabezado repetido', () => {
  const segunda = pagina([raw()], { header: false });
  segunda.items.push({ str: 'Cloudbeds Reservas', x: 452, y: 23, h: 8 });
  const entradas = api.parsearPaginas([pagina([raw()]), segunda]);
  assert.equal(entradas[1].noches, 3);
});

test('PDF no Cloudbeds se rechaza sin inventar columnas', () => {
  assert.throws(() => api.parsearPaginas([{ width: 600, height: 800, items: [{ str: 'Otro documento', x: 30, y: 30, h: 10 }] }]), /no Cloudbeds/);
});

test('Habitación ID conserva sufijos y el mapping de cabañas es cerrado', () => {
  assert.deepEqual(api.normalizar(raw({ habitacion_ids: '9000000000001-2' })).habitacion_ids, ['9000000000001-2']);
  assert.deepEqual(Object.values(api.MAPA).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(api.normalizar(raw({ habitaciones_raw: 'XX5(1)' })).habitaciones[0].cabana, null);
});

test('canceladas y multihabitación permanecen fuera de una corrección automática', () => {
  assert.equal(comparar(raw({ estado: 'Cancelada', habitaciones_raw: 'N/A', precio_total: '$0', total_habitacion: '$0' })).filas[0].clase, 'CANCELADA');
  assert.equal(comparar(raw({ habitaciones_raw: 'CD5(1), C10(1)', habitacion_ids: 'x x-2' })).filas[0].clase, 'MULTIHABITACION_REQUIERE_REVISION');
  assert.equal(comparar(raw({ habitaciones_raw: 'CD5(2)' })).filas[0].clase, 'MULTIHABITACION_REQUIERE_REVISION');
});

for (const diferencia of [-5, -1, 0, 1, 5, 6, -6]) {
  test(`tolerancia inclusiva de $5 CLP: ${diferencia}`, () => {
    const informe = comparar(raw(), [reserva()], 459000 + diferencia);
    assert.equal(informe.filas[0].clase, Math.abs(diferencia) <= 5 ? 'COINCIDE' : 'TOTAL_DIFERENTE');
  });
}

test('ID Cloudbeds exacto prima sobre un nombre distinto, con contexto compatible', () => {
  assert.equal(comparar(raw(), [reserva({ titular_nombre: 'Otro nombre' })]).filas[0].clase, 'COINCIDE');
});

test('fallback sólo de revisión exige nombre exacto, habitación y ambas fechas', () => {
  const entrada = api.normalizar(raw({ reserva_cloudbeds: '', id_cloudbeds: '' }));
  const informe = api.comparar([entrada], [reserva({ cloudbeds_id: null })], [{ reserva_id: 'r1', total_alojamiento: 459000 }]);
  assert.equal(informe.filas[0].certeza, 'REVISION_MANUAL');
  assert.match(informe.filas[0].evidencias.join(' '), /fallback informativo/);
  assert.equal(informe.filas[0].actualizacion.disponible, false);
  for (const incompleto of [
    raw({ reserva_cloudbeds: '', nombre_huesped: '' }),
    raw({ reserva_cloudbeds: '', habitaciones_raw: '' }),
    raw({ reserva_cloudbeds: '', check_in: '' }),
    raw({ reserva_cloudbeds: '', check_out: '' })
  ]) {
    assert.equal(api.comparar([api.normalizar(incompleto)], [reserva({ cloudbeds_id: null })], []).filas[0].certeza, 'NO_IDENTIFICADA');
  }
});

test('Reservation Number e ID se preservan separados y Reserva mantiene prioridad', () => {
  const entrada = api.normalizar(raw({ id_cloudbeds: 'ID-INTERNO-OTRO' }));
  assert.deepEqual(entrada.identificadores_cloudbeds, { reserva: '9000000000001', id: 'ID-INTERNO-OTRO' });
  assert.equal(entrada.identificador_cloudbeds, '9000000000001');
  assert.equal(comparar(raw({ id_cloudbeds: 'ID-INTERNO-OTRO' })).filas[0].clase, 'COINCIDE');
});

test('identidades duplicadas, contexto contradictorio o IDs cruzados son ambiguos', () => {
  assert.equal(comparar(raw(), [reserva(), reserva({ id: 'r2' })]).filas[0].certeza, 'REVISION_MANUAL');
  assert.equal(comparar(raw(), [reserva({ estadias: [] })]).filas[0].certeza, 'REVISION_MANUAL');
  assert.equal(comparar(raw({ id_cloudbeds: 'otro-id' }), [reserva(), reserva({ id: 'r2', cloudbeds_id: 'otro-id' })]).filas[0].certeza, 'REVISION_MANUAL');
});

test('ninguna coincidencia no altera reservas ni crea datos', () => {
  const reservas = [reserva({ cloudbeds_id: 'otro', titular_nombre: 'Otra persona', estadias: [], correo_contacto: 'completo@example.invalid' })];
  const antes = JSON.stringify(reservas);
  assert.equal(comparar(raw(), reservas).filas[0].clase, 'FALTA_EN_PROYECTO_H');
  assert.equal(JSON.stringify(reservas), antes);
});

test('Total habitación ausente no bloquea señales principales coherentes', () => {
  const fila = comparar(raw({ total_habitacion: '' })).filas[0];
  assert.equal(fila.certeza, 'SIN_CAMBIO');
  assert.equal(fila.total_cloudbeds_alojamiento, 459000);
});

test('Saldo Pendiente nunca se convierte en tarifa y Depósito sí es candidato', () => {
  const fila = comparar(raw({ precio_total: '$50.000', total_habitacion: '', saldo_pendiente: '$0', deposito: '$50.000' }), [reserva()], 50000).filas[0];
  assert.equal(fila.certeza, 'SIN_CAMBIO');
  assert.equal(fila.total_cloudbeds_alojamiento, 50000);
  assert.equal(fila.entrada.saldo_pendiente, 0);
});

test('duplicado de ID en el mismo PDF no se interpreta dos veces', () => {
  const entrada = api.normalizar(raw());
  assert.equal(api.comparar([entrada, entrada], [reserva()], []).conteos_certeza.REVISION_MANUAL, 2);
});

test('A: descuento 10% compara 144000 contra tarifa estándar 160000', () => {
  const fila = comparar(raw({ total_habitacion: '$121.008', precio_total: '$144.000', deposito: '$144.000', productos: '' }), [reserva()], 160000).filas[0];
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.equal(fila.propuesta.total_alojamiento_propuesto, 144000);
  assert.equal(fila.diferencia, -16000);
});

test('B: Jacuzzi eleva Precio Total pero alojamiento sigue siendo Depósito', () => {
  const fila = comparar(raw({ total_habitacion: '$242.016', precio_total: '$318.000', deposito: '$288.000', productos: 'Tinaja tipo Jacuzzi' }), [reserva()], 300000).filas[0];
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.equal(fila.total_cloudbeds_alojamiento, 288000);
  assert.equal(fila.propuesta.componente_no_alojamiento_observable, 30000);
});

test('C: varios productos no se incorporan al alojamiento', () => {
  const fila = comparar(raw({ total_habitacion: '$269.102', precio_total: '$430.232', deposito: '$320.232', productos: 'Late check out, masaje' }), [reserva()], 330000).filas[0];
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.equal(fila.total_cloudbeds_alojamiento, 320232);
  assert.equal(fila.propuesta.componente_no_alojamiento_observable, 110000);
  assert.deepEqual(fila.propuesta.productos, ['Late check out', 'masaje']);
});

test('D: producto de $10.000 se mantiene fuera del alojamiento', () => {
  const fila = comparar(raw({ total_habitacion: '$151.261', precio_total: '$190.001', deposito: '$180.001', productos: 'Late check out' }), [reserva()], 190000).filas[0];
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.equal(fila.propuesta.total_alojamiento_propuesto, 180001);
  assert.equal(fila.propuesta.componente_no_alojamiento_observable, 10000);
});

test('5: cancelada con Depósito histórico queda NO_APLICA y sin propuesta', () => {
  const fila = comparar(raw({ estado: 'Cancelada', precio_total: '$0', deposito: '$144.000' }), [reserva()], 160000).filas[0];
  assert.equal(fila.certeza, 'NO_APLICA');
  assert.equal(fila.propuesta.total_alojamiento_propuesto, null);
});

test('6: multihabitación con señales limpias requiere revisión sin repartir', () => {
  const fila = comparar(raw({ habitaciones_raw: 'LC4(1), C10(1)', precio_total: '$288.000', deposito: '$288.000' })).filas[0];
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.propuesta.total_alojamiento_propuesto, null);
});

test('7: multihabitación con señales contradictorias también requiere revisión', () => {
  const fila = comparar(raw({ habitaciones_raw: 'LC2(1), CD7(1)', precio_total: '$1.128.003', total_habitacion: '$1.073.145', deposito: '$1.020.003' })).filas[0];
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.propuesta.total_alojamiento_propuesto, null);
});

test('8: Precio Total menor que Depósito es contradicción financiera', () => {
  const fila = comparar(raw({ precio_total: '$143.000', deposito: '$144.000', total_habitacion: '$121.008' }), [reserva()], 160000).filas[0];
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.match(fila.revisiones.join(' '), /menor que Depósito/);
});

test('9 y 10: Productos presente-vacío se distingue de columna ausente', () => {
  const presente = api.normalizar(raw({ productos: '' }));
  const sinColumna = raw();
  delete sinColumna.productos;
  const ausente = api.normalizar(sinColumna);
  assert.equal(presente.productos_columna_presente, true);
  assert.equal(presente.productos_celda_vacia, true);
  assert.equal(ausente.productos_columna_presente, false);
  assert.equal(ausente.productos_celda_vacia, false);
  assert.equal(api.comparar([presente], [reserva()], [{ reserva_id: 'r1', total_alojamiento: 459000 }]).filas[0].certeza, 'SIN_CAMBIO');
  assert.equal(api.comparar([ausente], [reserva()], [{ reserva_id: 'r1', total_alojamiento: 459000 }]).filas[0].certeza, 'REVISION_MANUAL');
});

test('11: Depósito ausente mantiene el PDF legible pero deshabilita propuesta', () => {
  const sinDeposito = raw();
  delete sinDeposito.deposito;
  const entrada = api.normalizar(sinDeposito);
  const fila = api.comparar([entrada], [reserva()], [{ reserva_id: 'r1', total_alojamiento: 459000 }]).filas[0];
  assert.equal(entrada.capacidades.parsear, 'disponible');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.propuesta.total_alojamiento_propuesto, null);
});

test('13: neto × 1,19 dentro de $5 corrobora sin construir el candidato', () => {
  const fila = comparar(raw({ precio_total: '$144.000', deposito: '$144.000', total_habitacion: '$121.008' }), [reserva()], 160000).filas[0];
  assert.equal(fila.propuesta.total_alojamiento_propuesto, 144000);
  assert.match(fila.evidencias.join(' '), /× 1,19 corrobora/);
});

test('14: si neto × 1,19 no coincide, otras señales pueden mantener alta certeza', () => {
  const fila = comparar(raw({ precio_total: '$144.000', deposito: '$144.000', total_habitacion: '$110.000' }), [reserva()], 160000).filas[0];
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.match(fila.evidencias.join(' '), /no corrobora/);
});

test('15: ID y Reserva diferentes se preservan y un cruce a reservas distintas se revisa', () => {
  const entrada = api.normalizar(raw({ id_cloudbeds: 'ID-OTRO' }));
  const fila = api.comparar([entrada], [reserva(), reserva({ id: 'r2', cloudbeds_id: 'ID-OTRO' })], [
    { reserva_id: 'r1', total_alojamiento: 459000 }, { reserva_id: 'r2', total_alojamiento: 459000 }
  ]).filas[0];
  assert.equal(entrada.reserva_cloudbeds, '9000000000001');
  assert.equal(entrada.id_cloudbeds, 'ID-OTRO');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
});

test('17: fallback ambiguo nunca identifica automáticamente', () => {
  const entrada = api.normalizar(raw({ reserva_cloudbeds: '', id_cloudbeds: '' }));
  const duplicada = reserva({ id: 'r2', cloudbeds_id: null });
  const fila = api.comparar([entrada], [reserva({ cloudbeds_id: null }), duplicada], []).filas[0];
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.reserva_id, null);
});

test('18: una noche usa el Depósito como total completo, no como valor por noche inferido', () => {
  const entrada = raw({ check_in: '20/09/2026', check_out: '21/09/2026', noches: '1', precio_total: '$144.000', deposito: '$144.000', total_habitacion: '$121.008' });
  const proyecto = reserva({ estadias: [{ fecha_ingreso: '2026-09-20', fecha_salida: '2026-09-21', cabanas: { numero: 5 } }] });
  const fila = comparar(entrada, [proyecto], 160000).filas[0];
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.equal(fila.propuesta.total_alojamiento_propuesto, 144000);
});

test('19: varias noches conservan un único total canónico sin inventar reparto', () => {
  const fila = comparar(raw(), [reserva()], 470000).filas[0];
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.equal(fila.propuesta.total_alojamiento_propuesto, 459000);
  assert.match(fila.propuesta.distribucion_v31, /total canónico/);
});

test('21: “Núm. habitación” se reconoce como alias compacto', () => {
  const columnas = [['Reserva', 'reserva_cloudbeds'], ['Núm. habitación', 'habitaciones_raw'], ['Depósito', 'deposito']];
  const [entrada] = api.parsearPaginas([paginaFlexible(columnas, [raw()])]);
  assert.equal(entrada.habitaciones[0].cabana, 5);
  assert.ok(entrada.columnas_presentes.includes('habitaciones_raw'));
});

test('filtros revisan todo, día, rango y reserva concreta sin depender del Resumen', () => {
  const otraEntrada = api.normalizar(raw({ reserva_cloudbeds: '9000000000002', check_in: '10/09/2026', check_out: '12/09/2026' }));
  const otraReserva = reserva({ id: 'r2', cloudbeds_id: '9000000000002', estadias: [{ fecha_ingreso: '2026-09-10', fecha_salida: '2026-09-12', cabanas: { numero: 5 } }] });
  const informe = api.comparar([api.normalizar(raw()), otraEntrada], [reserva(), otraReserva], [
    { reserva_id: 'r1', total_alojamiento: 459000 }, { reserva_id: 'r2', total_alojamiento: 459000 }
  ]);
  assert.equal(api.filtrarInforme(informe).total, 2);
  assert.equal(api.filtrarInforme(informe, { fecha: '2026-09-05' }).total, 1);
  assert.equal(api.filtrarInforme(informe, { desde: '2026-09-06', hasta: '2026-09-10' }).total, 2);
  assert.equal(api.filtrarInforme(informe, { reserva: '9000000000002' }).filas[0].reserva_id, 'r2');
});

test('E: subconjunto sin ID se parsea y usa fallback exacto sólo para revisión', () => {
  const columnas = [
    ['Nombre y apellido', 'nombre_huesped'], ['Número de habitación', 'habitaciones_raw'],
    ['Check-in', 'check_in'], ['Check-out', 'check_out'], ['Total De La Habitación', 'total_habitacion']
  ];
  const [entrada] = api.parsearPaginas([paginaFlexible(columnas, [raw()])]);
  assert.equal(entrada.identificador_cloudbeds, null);
  const fila = api.comparar([entrada], [reserva({ cloudbeds_id: null })], [{ reserva_id: 'r1', total_alojamiento: 459000 }]).filas[0];
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.match(fila.evidencias.join(' '), /fallback informativo/);
});

test('F: ID + campo financiero sin contexto no se eleva a alta certeza', () => {
  const columnas = [['Reserva', 'reserva_cloudbeds'], ['Total De La Habitación', 'total_habitacion']];
  const [entrada] = api.parsearPaginas([paginaFlexible(columnas, [raw()])]);
  assert.equal(entrada.nombre_huesped, null);
  assert.equal(api.comparar([entrada], [reserva()], [{ reserva_id: 'r1', total_alojamiento: 459000 }]).filas[0].certeza, 'REVISION_MANUAL');
});

test('G: el orden de columnas puede cambiar completamente', () => {
  const columnas = [
    ['Depósito', 'deposito'], ['Check-out', 'check_out'], ['Reserva', 'reserva_cloudbeds'],
    ['Total De La Habitación', 'total_habitacion'], ['Número de habitación', 'habitaciones_raw'], ['Check-in', 'check_in']
  ];
  const [entrada] = api.parsearPaginas([paginaFlexible(columnas, [raw({ deposito: '$50.000' })])]);
  assert.equal(entrada.identificador_cloudbeds, '9000000000001');
  assert.equal(entrada.total_habitacion, 385714);
  assert.equal(entrada.deposito, 50000);
});

test('H: columnas desconocidas intercaladas conservan sus límites', () => {
  const columnas = [
    ['Reserva', 'reserva_cloudbeds'], ['Columna futura Alpha', 'desconocida_a'],
    ['Total De La Habitación', 'total_habitacion'], ['Columna futura Beta', 'desconocida_b'],
    ['Check-in', 'check_in']
  ];
  const [entrada] = api.parsearPaginas([paginaFlexible(columnas, [{ ...raw(), desconocida_a: '$999.999', desconocida_b: '31/02/1999' }])]);
  assert.equal(entrada.total_habitacion, 385714);
  assert.equal(entrada.check_in, '2026-09-04');
  assert.deepEqual(entrada.columnas_desconocidas.map(item => item.encabezado), ['Columna futura Alpha', 'Columna futura Beta']);
});

test('I: un PDF ancho con muchas columnas conocidas sigue siendo legible', () => {
  const columnas = api.COLUMNAS.map((definicion, indice) => [definicion.aliases[0], definicion.key + '_' + indice]);
  const row = {};
  columnas.forEach(([, key]) => { row[key] = 'Dato'; });
  const asignar = (canonical, valor) => {
    const columna = columnas.find(([, key]) => key.startsWith(canonical + '_'));
    delete row[columna[1]];
    columna[1] = canonical;
    row[canonical] = valor;
  };
  asignar('reserva_cloudbeds', '9000000000001');
  asignar('total_habitacion', '$459.000');
  asignar('check_in', '04/09/2026');
  const [entrada] = api.parsearPaginas([paginaFlexible(columnas, [row])]);
  assert.ok(entrada.columnas_presentes.length >= 50);
  assert.equal(entrada.total_habitacion, 459000);
});

test('J: faltar una columna opcional no invalida el archivo', () => {
  const columnas = [['Reserva', 'reserva_cloudbeds'], ['Total De La Habitación', 'total_habitacion'], ['Número de habitación', 'habitaciones_raw']];
  const [entrada] = api.parsearPaginas([paginaFlexible(columnas, [raw()])]);
  assert.equal(entrada.correo, null);
  assert.equal(entrada.check_out, null);
  assert.equal(entrada.capacidades.parsear, 'disponible');
});

test('lector procesa un PDF textual válido, rechaza bytes inválidos y libera recursos', async () => {
  await assert.rejects(api.leerPDF(new TextEncoder().encode('no pdf'), { pdfjs: { getDocument() { throw Error('No llamar'); } } }), /inválido/);
  let cerrado = false;
  const p = pagina([raw()]);
  const pdfjs = { getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: p.width, height: p.height }),
        getTextContent: async () => ({ items: p.items.map(item => ({ str: item.str, transform: [1, 0, 0, 1, item.x, p.height - item.y], width: 10, height: item.h })) })
      })
    }),
    destroy: async () => { cerrado = true; }
  }) };
  const entradas = await api.leerPDF(new TextEncoder().encode('%PDF-test'), { pdfjs });
  assert.equal(entradas[0].total_habitacion, 385714);
  assert.ok(cerrado);
});

test('timeout PDF termina con error y destruye la tarea', async () => {
  let cerrado = false;
  await assert.rejects(api.leerPDF(new TextEncoder().encode('%PDF-test'), {
    timeout: 5,
    pdfjs: { getDocument: () => ({ promise: new Promise(() => {}), destroy: async () => { cerrado = true; } }) }
  }), /tardó/);
  assert.ok(cerrado);
});

test('consulta paginada sólo usa SELECT y no limita al mes visible', async () => {
  const llamadas = [];
  const reservas = Array.from({ length: 501 }, (_, i) => reserva({
    id: `r${i}`,
    cloudbeds_id: i ? `otro-${i}` : '9000000000001',
    titular_nombre: i ? `Otra persona ${i}` : 'Persona Ejemplo'
  }));
  const saldos = Array.from({ length: 501 }, (_, i) => ({ reserva_id: `r${i}`, total_alojamiento: i ? 1 : 459000 }));
  const cliente = {
    from(tabla) {
      llamadas.push(tabla);
      return {
        select() { return this; }, order() { return this; },
        range(inicio, fin) { const fuente = tabla === 'reservas' ? reservas : saldos; return Promise.resolve({ data: fuente.slice(inicio, fin + 1) }); }
      };
    },
    rpc() { throw Error('Writer prohibido'); },
    storage: { from() { throw Error('Upload prohibido'); } }
  };
  const informe = await api.consultar([api.normalizar(raw())], cliente);
  assert.equal(informe.conteos.COINCIDE, 1);
  assert.deepEqual(llamadas, ['reservas', 'vista_saldos_alojamiento_reserva', 'reservas', 'vista_saldos_alojamiento_reserva']);
});

test('errores de lectura no generan falsos faltantes', async () => {
  const cliente = { from: () => ({ select() { return this; }, order() { return this; }, range: async () => ({ error: { message: 'fallo' } }) }) };
  await assert.rejects(api.consultar([api.normalizar(raw())], cliente), /No se pudo consultar/);
});

test('informe escapa texto del PDF y no contiene controles de escritura', () => {
  const html = api.renderizar(comparar(raw({ nombre_huesped: '<img src=x onerror=alert(1)>' }), []));
  assert.doesNotMatch(html, /<img|<button|data-total-confirmar/);
  assert.match(html, /&lt;img/);
  assert.match(html, /Precio Total/);
  assert.match(html, /Saldo \(nunca tarifa\)/);
  assert.match(html, /Depósito/);
});

module.exports = { raw, pagina, paginaFlexible, columnasBase };
