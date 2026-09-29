const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pdf = require('../js/haiku-cloudbeds-pdf-v1');
const tarifas = require('../js/haiku-cloudbeds-tarifas-v1');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function raw(numero, nombre, extra = {}) {
  return {
    reserva_cloudbeds: numero,
    id_cloudbeds: `RID-${numero}`,
    nombre_huesped: nombre,
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
  };
}

function reserva(id, numero, nombre, extra = {}) {
  return {
    id,
    cloudbeds_id: numero,
    titular_nombre: nombre,
    estado_reserva: 'confirmada',
    grupo_reserva_id: null,
    estadias: [{ id: `e-${id}`, fecha_ingreso: '2026-09-20', fecha_salida: '2026-09-21',
      tipo_estadia: 'alojamiento', adultos: 2, ninos: 0, mascotas: 0, cabanas: { numero: 5 } }],
    ...extra
  };
}

function informeRealista() {
  const alta = raw('CB-A', 'Héctor Ficticio');
  const coincide = raw('CB-B', 'Amelia Ficticia');
  const manual = raw('CB-C', 'Bruno Ficticio');
  delete manual.productos;
  const cancelada = raw('CB-D', 'Camila Ficticia', { estado: 'Cancelada', precio_total: '$0' });
  const noIdentificada = raw('CB-X', 'Damián Ficticio');
  const producto = raw('CB-E', 'Elena Ficticia', {
    precio_total: '$318.000', total_habitacion: '$242.016', deposito: '$288.000', productos: 'Tinaja tipo Jacuzzi'
  });
  const reservas = [
    reserva('r-a', 'CB-A', 'Héctor Ficticio'),
    reserva('r-b', 'CB-B', 'Amelia Ficticia'),
    reserva('r-c', 'CB-C', 'Bruno Ficticio'),
    reserva('r-d', 'CB-D', 'Camila Ficticia'),
    reserva('r-e', 'CB-E', 'Elena Ficticia')
  ];
  const saldos = [
    { reserva_id: 'r-a', total_alojamiento: 160000 },
    { reserva_id: 'r-b', total_alojamiento: 144000 },
    { reserva_id: 'r-c', total_alojamiento: 160000 },
    { reserva_id: 'r-d', total_alojamiento: 160000 },
    { reserva_id: 'r-e', total_alojamiento: 300000 }
  ];
  return pdf.comparar([alta, coincide, manual, cancelada, noIdentificada, producto].map(item => pdf.normalizar(item)), reservas, saldos);
}

const capacidadV31 = Object.freeze({
  consultada: true,
  version: 'total1_financiero_v31',
  writer_disponible: true,
  v31_disponible: true,
  motivo: 'Disponible globalmente; requiere revalidación.',
  escritura_habilitada: false
});

test('PDF compacto realista se parsea y termina en el resumen operativo de Haku', () => {
  const columnas = [
    ['Nombre', 'Héctor'], ['Apellido', 'Ficticio'], ['Check-in', '20/09/2026'],
    ['Check-out', '21/09/2026'], ['Precio total', '$144.000'], ['Estado', 'Confirmada'],
    ['Saldo pendiente', '$0'], ['Total de la habitación', '$121.008'], ['Depósito', '$144.000'],
    ['ID', 'RID-CB-A'], ['Reserva', 'CB-A'], ['Productos', ''], ['Núm. habitación', 'CD5(1)']
  ];
  const items = [];
  columnas.forEach(([encabezado], indice) => items.push({ str: encabezado, x: 30 + indice * 115, y: 38, h: 4 }));
  columnas.forEach(([, valor], indice) => items.push({ str: valor, x: 30 + indice * 115, y: 88, h: 4 }));
  const [entrada] = pdf.parsearPaginas([{ width: 1600, height: 400, items }]);
  const informe = pdf.comparar([entrada], [reserva('r-a', 'CB-A', 'Héctor Ficticio')], [{ reserva_id: 'r-a', total_alojamiento: 160000 }]);
  const html = tarifas.renderizar(tarifas.prepararModelo(informe, capacidadV31));
  assert.equal(informe.filas[0].certeza, 'ALTA_CERTEZA');
  assert.match(html, /Héctor Ficticio · CAB 5/);
  assert.match(html, /Propuestas seguras/);
  assert.match(html, /Preparar actualización/);
});

test('PDF realista produce las cinco categorías del resumen Haku', () => {
  const modelo = tarifas.prepararModelo(informeRealista(), capacidadV31);
  assert.deepEqual(modelo.conteos, {
    SIN_CAMBIO: 1,
    ALTA_CERTEZA: 2,
    REVISION_MANUAL: 1,
    NO_APLICA: 1,
    NO_IDENTIFICADA: 1
  });
  const html = tarifas.renderizar(modelo);
  for (const texto of ['Cloudbeds', 'Tarifas', 'Coinciden', 'Propuestas seguras', 'Revisión manual', 'Canceladas / no aplica', 'No identificadas']) {
    assert.match(html, new RegExp(texto));
  }
});

test('caso tipo Héctor muestra descuento, evidencia y capas separadas', () => {
  const modelo = tarifas.prepararModelo(informeRealista(), capacidadV31);
  const item = modelo.items.find(actual => actual.fila.propuesta.reserva_id === 'r-a');
  assert.equal(item.certeza_cloudbeds, 'ALTA_CERTEZA');
  assert.equal(item.compatibilidad_financiera, 'REQUIERE_REVALIDACION_V31');
  assert.equal(item.seleccionable, true);
  const html = tarifas.renderizar(modelo);
  assert.match(html, /Héctor Ficticio · CAB 5/);
  assert.match(html, /<dt>Proyecto H<\/dt>/);
  assert.match(html, /<dt>Alojamiento Cloudbeds<\/dt>/);
  assert.match(html, /<dt>Diferencia alojamiento<\/dt>/);
  assert.doesNotMatch(html, /<dt>Cloudbeds<\/dt>|<dt>Diferencia<\/dt>/);
  assert.match(html, /\$160\.000/);
  assert.match(html, /\$144\.000/);
  assert.match(html, /-\$16\.000/);
  assert.match(html, /Escritura aún no habilitada/);
});

test('productos se explican sin crear servicios ni inferir precios individuales', () => {
  const modelo = tarifas.prepararModelo(informeRealista(), capacidadV31);
  const producto = modelo.items.find(item => item.fila.propuesta.reserva_id === 'r-e');
  const html = tarifas.renderizar({ ...modelo, items: [producto], conteos: { ...modelo.conteos } });
  assert.match(html, /Productos Cloudbeds/);
  assert.match(html, /Tinaja tipo Jacuzzi/);
  assert.match(html, /\$318\.000/);
  assert.match(html, /\$288\.000/);
  assert.match(html, /\$30\.000/);
  assert.doesNotMatch(read('js/haiku-cloudbeds-tarifas-v1.js'), /\.from\(["']servicios|insert\(|upsert\(/i);
});

test('casos bloqueados nunca son seleccionables', () => {
  const modelo = tarifas.prepararModelo(informeRealista(), capacidadV31);
  for (const certeza of ['REVISION_MANUAL', 'NO_APLICA', 'NO_IDENTIFICADA', 'SIN_CAMBIO']) {
    assert.ok(modelo.items.filter(item => item.certeza_cloudbeds === certeza).every(item => !item.seleccionable));
  }
  const multihabitacion = pdf.comparar([
    pdf.normalizar(raw('CB-M', 'Multi Ficticio', { habitaciones_raw: 'LC4(1), C10(1)' }))
  ], [reserva('r-m', 'CB-M', 'Multi Ficticio')], [{ reserva_id: 'r-m', total_alojamiento: 160000 }]);
  assert.equal(tarifas.prepararModelo(multihabitacion, capacidadV31).items[0].seleccionable, false);
});

test('capacidad v31 disponible y no disponible permanecen globales, no por reserva', async () => {
  const llamadas = [];
  const disponible = await tarifas.consultarCapacidad({
    async rpc(nombre) { llamadas.push(nombre); return { data: { version: 'total1_financiero_v31', writer_disponible: true } }; }
  });
  assert.equal(disponible.v31_disponible, true);
  assert.equal(disponible.escritura_habilitada, false);
  const versionVieja = await tarifas.consultarCapacidad({
    async rpc(nombre) { llamadas.push(nombre); return { data: { version: 'total1_financiero_v3', writer_disponible: true } }; }
  });
  const error = await tarifas.consultarCapacidad({ async rpc() { return { error: { message: 'sin permiso' } }; } });
  assert.equal(versionVieja.v31_disponible, false);
  assert.equal(error.v31_disponible, false);
  assert.deepEqual(llamadas, ['haiku_capacidad_totales_v1', 'haiku_capacidad_totales_v1']);
});

test('flag false impide absolutamente cualquier RPC de escritura', async () => {
  const llamadas = [];
  const cliente = { async rpc(nombre) { llamadas.push(nombre); return { data: { version: 'total1_financiero_v31', writer_disponible: true } }; } };
  const modelo = await tarifas.preparar(informeRealista(), cliente);
  tarifas.seleccionarTodo(modelo, true);
  const resultado = tarifas.confirmarSimulacion(modelo);
  assert.equal(tarifas.CLOUDBEDS_TARIFAS_WRITER_HABILITADO, false);
  assert.equal(global.CLOUDBEDS_TARIFAS_WRITER_HABILITADO, false);
  assert.equal(resultado.escrituras, 0);
  assert.deepEqual(llamadas, ['haiku_capacidad_totales_v1']);
  assert.doesNotMatch(read('js/haiku-cloudbeds-tarifas-v1.js'), /haiku_cambiar_totales_lote_v1/);
});

test('payload futuro usa el contrato Cloudbeds W1 completo', () => {
  const modelo = tarifas.prepararModelo(informeRealista(), capacidadV31);
  const hector = modelo.items.find(item => item.fila.propuesta.reserva_id === 'r-a');
  tarifas.seleccionar(modelo, hector.id, true);
  assert.deepEqual(tarifas.construirPayload(modelo), [{
    reserva_id: 'r-a', estadia_id: 'e-r-a', tipo_estadia: 'alojamiento',
    total_actual_esperado: 160000, total_objetivo: 144000,
    cloudbeds_reservation_number: 'CB-A', cloudbeds_reservation_id: 'RID-CB-A',
    certeza: 'ALTA_CERTEZA', evidencia: hector.fila.evidencias
  }]);
});

test('selección individual y seleccionar todo operan sólo sobre propuestas seguras', () => {
  const modelo = tarifas.prepararModelo(informeRealista(), capacidadV31);
  const seguras = modelo.items.filter(item => item.seleccionable);
  assert.equal(seguras.length, 2);
  assert.equal(tarifas.seleccionar(modelo, seguras[0].id, true), true);
  assert.equal(tarifas.construirPayload(modelo).length, 1);
  assert.equal(tarifas.seleccionarTodo(modelo, true), 2);
  assert.equal(tarifas.construirPayload(modelo).length, 2);
  tarifas.seleccionarTodo(modelo, false);
  assert.equal(tarifas.construirPayload(modelo).length, 0);
});

test('Ver reserva reutiliza Inspector por reserva_id sin alterar scroll ni borrador Haku', async () => {
  const estadoHaku = { scrollTop: 421, borrador: 'nota en progreso' };
  const aperturas = [];
  global.HAIKU_INSPECTOR_V1 = { abrirReserva: async (id, origen) => { aperturas.push({ id, origen }); return true; } };
  const origen = { id: 'boton-ver' };
  await tarifas.abrirReserva('r-a', origen);
  assert.deepEqual(aperturas, [{ id: 'r-a', origen }]);
  assert.deepEqual(estadoHaku, { scrollTop: 421, borrador: 'nota en progreso' });
  delete global.HAIKU_INSPECTOR_V1;
  const fuente = read('js/haiku-cloudbeds-tarifas-v1.js');
  assert.doesNotMatch(fuente, /haiku-asistente-texto|\.scrollTop\s*=/);
});

test('integración Haku carga 2E después del parser y mantiene diagnóstico colapsado', () => {
  const panel = read('panel.html');
  const asistente = read('js/supabase-asistente-v1.js');
  assert.ok(panel.indexOf("'haiku-cloudbeds-pdf-v1','haiku-cloudbeds-tarifas-v1'") >= 0);
  assert.match(asistente, /HAIKU_CLOUDBEDS_PDF_V1/);
  assert.match(asistente, /HAIKU_CLOUDBEDS_TARIFAS_V1/);
  assert.match(tarifas.renderizar(tarifas.prepararModelo(informeRealista(), capacidadV31)), /<details class="haiku-cloudbeds-tarifas-(?:tecnico|payload)"/);
});

test('contratos visuales cubren escritorio y móvil sin drawer adicional', () => {
  const css = read('css/supabase-asistente-v1.css');
  const fuente = read('js/haiku-cloudbeds-tarifas-v1.js');
  const fixture = read('tests/fixtures/cloudbeds-haku-tarifas-2e/index.html');
  const fixtureJs = read('tests/fixtures/cloudbeds-haku-tarifas-2e/demo.js');
  assert.match(css, /\.haiku-cloudbeds-tarifas-resumen\s*\{[\s\S]*grid-template-columns:\s*repeat\(5/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.haiku-cloudbeds-tarifas-resumen/);
  assert.match(css, /\.haiku-cloudbeds-tarifas-montos dt\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.haiku-cloudbeds-tarifas-montos dd\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(fuente, /HAIKU_INSPECTOR_V1 \|\| root\.HAIKU_PANELES_V1/);
  assert.doesNotMatch(fuente, /createElement\(["'](?:dialog|aside)["']\)|drawer/i);
  assert.match(fixture, /data-inspector-cabecera/);
  assert.match(fixture, /role="dialog" aria-modal="false"/);
  assert.match(fixtureJs, /URLSearchParams[\s\S]*inspector[\s\S]*HAIKU_PANELES_V1\.abrirReserva\('r-hector'\)/);
});

test('panel de confirmación futura muestra el detalle y mantiene el writer bloqueado', () => {
  const modelo = tarifas.prepararModelo(informeRealista(), capacidadV31);
  tarifas.seleccionarTodo(modelo, true);
  const resultado = tarifas.confirmarSimulacion(modelo);
  assert.equal(resultado.simulado, true);
  assert.equal(resultado.escrituras, 0);
  assert.match(resultado.mensaje, /No se escribió ningún dato/);
  const html = tarifas.renderizar(modelo);
  assert.match(html, /Los pagos existentes no serán modificados/);
  assert.match(html, /Proyecto H actual/);
  assert.match(html, /Saldo esperado/);
  assert.match(html, /data-cloudbeds-confirmar disabled>Confirmar actualización/);
});
