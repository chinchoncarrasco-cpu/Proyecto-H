const test = require('node:test');
const assert = require('node:assert/strict');
const pdf = require('../js/haiku-cloudbeds-pdf-v1');
const tarifas = require('../js/haiku-cloudbeds-tarifas-v1');

function entrada(nombre, extra = {}) {
  return pdf.normalizar({
    reserva_cloudbeds: 'CB-NOMBRE-1',
    id_cloudbeds: 'RID-NOMBRE-1',
    nombre_huesped: nombre,
    habitaciones_raw: 'CD5(1)',
    check_in: '20/09/2026',
    check_out: '21/09/2026',
    noches: '1',
    precio_total: '$120.000',
    deposito: '$120.000',
    saldo_pendiente: '$0',
    productos: '',
    estado: 'Confirmada',
    ...extra
  });
}

function reserva(id, nombre, extra = {}) {
  return {
    id,
    cloudbeds_id: null,
    titular_nombre: nombre,
    estado_reserva: 'confirmada',
    grupo_reserva_id: null,
    estadias: [{
      id: `e-${id}`,
      fecha_ingreso: '2026-09-20',
      fecha_salida: '2026-09-21',
      tipo_estadia: 'alojamiento',
      cabanas: { numero: 5 }
    }],
    ...extra
  };
}

function compararUna(nombreCloudbeds, proyecto, extraEntrada = {}) {
  const reservas = Array.isArray(proyecto) ? proyecto : [proyecto];
  const saldos = reservas.map(item => ({ reserva_id: item.id, total_alojamiento: 150000 }));
  return pdf.comparar([entrada(nombreCloudbeds, extraEntrada)], reservas, saldos).filas[0];
}

const capacidadV31 = Object.freeze({
  consultada: true,
  version: 'total1_financiero_v31',
  writer_disponible: true,
  v31_disponible: true,
  motivo: 'Disponible sólo para diagnóstico.',
  escritura_habilitada: false
});

test('normaliza tildes, puntuación y espacios a tokens completos', () => {
  assert.deepEqual(pdf.tokensNombre('  Yérko,   Andrés-Baeza.  '), ['yerko', 'andres', 'baeza']);
  assert.equal(pdf.clasificarNombres('Yerko Baeza', 'Yerko Andres Baeza valenzuela').tipo, 'parcial');
});

test('Yerko Baeza identifica de forma parcial única contra el nombre completo Cloudbeds', () => {
  const fila = compararUna('Yerko Andres Baeza valenzuela', reserva('r-yerko', 'Yerko Baeza'));
  assert.equal(fila.identidad_tipo, 'CONTEXTO_NOMBRE_PARCIAL_UNICO');
  assert.equal(fila.certeza, 'ALTA_CERTEZA');
  assert.equal(fila.reserva_id, 'r-yerko');
  assert.equal(fila.propuesta.nombre_parcial_origen, 'proyecto_h');
  assert.equal(fila.vinculo_cloudbeds_sugerido.evidencia, 'contexto_nombre_parcial_unico');
});

test('Mauricio Cepeda identifica contra Mauricio Cepeda Grez y funciona en ambos sentidos', () => {
  const proyectoCorto = compararUna('Mauricio Cepeda Grez', reserva('r-mauricio-1', 'Mauricio Cepeda'));
  const cloudbedsCorto = compararUna('Mauricio Cepeda', reserva('r-mauricio-2', 'Mauricio Andres Cepeda Grez'));
  assert.equal(proyectoCorto.identidad_tipo, 'CONTEXTO_NOMBRE_PARCIAL_UNICO');
  assert.equal(cloudbedsCorto.identidad_tipo, 'CONTEXTO_NOMBRE_PARCIAL_UNICO');
  assert.equal(cloudbedsCorto.propuesta.nombre_parcial_origen, 'cloudbeds');
});

test('Maria Angelica Ciifuentes se resuelve por typo y no por nombre parcial', () => {
  const fila = compararUna('Maria Angelica Ciifuentes', reserva('r-maria', 'Maria Angelica Cifuentes'));
  assert.equal(pdf.clasificarNombres('Maria Angelica Cifuentes', 'Maria Angelica Ciifuentes').tipo, 'typo');
  assert.equal(fila.identidad_tipo, 'CONTEXTO_TYPO_UNICO');
  assert.equal(fila.reserva_id, 'r-maria');
});

test('Borge borge contra Bruno Borge queda en revisión manual', () => {
  const fila = compararUna('Bruno Borge', reserva('r-borge', 'Borge borge'));
  assert.equal(pdf.clasificarNombres('Borge borge', 'Bruno Borge'), null);
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.reserva_id, null);
});

test('Juan Perez identifica sólo con una única candidata de CAB y fechas', () => {
  const unica = compararUna('Juan Pedro Perez', reserva('r-juan', 'Juan Perez'));
  const doble = compararUna('Juan Pedro Perez', [
    reserva('r-juan-1', 'Juan Perez'),
    reserva('r-juan-2', 'Juan Perez')
  ]);
  assert.equal(unica.identidad_tipo, 'CONTEXTO_NOMBRE_PARCIAL_UNICO');
  assert.equal(doble.identidad_tipo, 'AMBIGUA');
  assert.equal(doble.certeza, 'REVISION_MANUAL');
  assert.equal(doble.reserva_id, null);
});

test('otra estadía operativa con la misma CAB y fechas bloquea el nombre parcial', () => {
  const fila = compararUna('Juan Pedro Perez', [
    reserva('r-juan', 'Juan Perez'),
    reserva('r-otra', 'Persona Diferente')
  ]);
  assert.equal(fila.identidad_tipo, 'AMBIGUA');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.reserva_id, null);
});

test('no acepta coincidencias parciales dentro de una palabra', () => {
  const fila = compararUna('Juan Pedro Perez', reserva('r-substring', 'Juan Per'));
  assert.equal(pdf.clasificarNombres('Juan Per', 'Juan Pedro Perez'), null);
  assert.notEqual(fila.identidad_tipo, 'CONTEXTO_NOMBRE_PARCIAL_UNICO');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
});

test('cloudbeds_id incompatible bloquea la candidata contextual', () => {
  const fila = compararUna('Yerko Andres Baeza Valenzuela',
    reserva('r-vinculada', 'Yerko Baeza', { cloudbeds_id: 'CB-OTRA' }));
  assert.equal(fila.identidad_tipo, 'AMBIGUA');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.reserva_id, null);
});

test('un identificador fuerte hacia otra reserva prevalece y denuncia conflicto', () => {
  const fuerte = reserva('r-fuerte', 'Persona Distinta', { cloudbeds_id: 'CB-NOMBRE-1' });
  const contextual = reserva('r-contextual', 'Yerko Baeza');
  const fila = compararUna('Yerko Andres Baeza Valenzuela', [fuerte, contextual], { id_cloudbeds: '' });
  assert.equal(fila.identidad_tipo, 'AMBIGUA');
  assert.equal(fila.certeza, 'REVISION_MANUAL');
  assert.equal(fila.reserva_id, null);
  assert.match(fila.revisiones.join(' '), /identificador fuerte.*reservas distintas/i);
});

test('CAB o fechas distintas no habilitan la identidad parcial', () => {
  const proyecto = reserva('r-contexto', 'Yerko Baeza');
  const cabana = compararUna('Yerko Andres Baeza Valenzuela', proyecto, { habitaciones_raw: 'CD7(1)' });
  const fecha = compararUna('Yerko Andres Baeza Valenzuela', proyecto, {
    check_in: '22/09/2026', check_out: '23/09/2026'
  });
  assert.equal(cabana.identidad_tipo, 'NO_IDENTIFICADA');
  assert.equal(fecha.identidad_tipo, 'NO_IDENTIFICADA');
});

test('Haku muestra la explicación y ambos nombres con el writer global activo', () => {
  const fila = compararUna('Yerko Andres Baeza valenzuela', reserva('r-yerko', 'Yerko Baeza'));
  const html = tarifas.renderizar(tarifas.prepararModelo({ filas: [fila] }, capacidadV31));
  assert.match(html, /✓<\/span> Reserva identificada por contexto único/);
  assert.match(html, /≈<\/span> Proyecto H contiene una versión abreviada del nombre/);
  assert.match(html, /<b>Cloudbeds:<\/b> Yerko Andres Baeza valenzuela/);
  assert.match(html, /<b>Proyecto H:<\/b> Yerko Baeza/);
  assert.equal(tarifas.CLOUDBEDS_TARIFAS_WRITER_HABILITADO, true);
  assert.equal(fila.propuesta.solo_lectura, true);
  assert.equal(fila.propuesta.actualizacion_disponible, false);
});
