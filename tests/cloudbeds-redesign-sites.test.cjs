const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tarifas = require('../js/haiku-cloudbeds-tarifas-v1');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const css = read('css/haiku-cloudbeds-tarifas-redesign-v1.css');
const frontend = read('js/haiku-cloudbeds-tarifas-v1.js');

function modeloVisual(capacidad) {
  const certezas = ['ALTA_CERTEZA', 'SIN_CAMBIO', 'REVISION_MANUAL', 'NO_APLICA', 'NO_IDENTIFICADA'];
  return tarifas.prepararModelo({
    filas: certezas.map((certeza, indice) => ({
      certeza,
      entrada: { nombre_huesped: `Huésped ${indice + 1}` },
      propuesta: { reservation_number: `VISUAL-${indice + 1}` }
    }))
  }, capacidad);
}

test('la cabecera y el resumen Sites se alimentan sólo del modelo real', () => {
  const modelo = modeloVisual({
    consultada: true,
    version: tarifas.VERSION_V32,
    writer_disponible: true,
    total_disponible: true,
    v32_disponible: true,
    motivo: 'Capacidad ficticia disponible.'
  });
  const html = tarifas.renderizar(modelo);
  assert.match(html, /CLOUDBEDS · REVISIÓN DE PDF/);
  assert.match(html, /Propuestas de alojamiento · 5 resultados/);
  assert.match(html, /<strong>1<\/strong><span>propuestas seguras/);
  assert.match(html, /<strong>1<\/strong><span>requieren revisión manual/);
  assert.match(html, /<b>1<\/b> coinciden/);
  assert.match(html, /<b>1<\/b> canceladas \/ no aplica/);
  assert.match(html, /<b>1<\/b> no identificadas/);
  assert.match(html, /Writer auditado/);
  assert.match(html, /<code>total1_financiero_v32<\/code>/);
  assert.doesNotMatch(html, /92 resultados|8 propuestas|59 coinciden|16 canceladas|3 no identificadas/);
});

test('Writer auditado no se muestra sin capacidad backend compatible', () => {
  const html = tarifas.renderizar(modeloVisual({
    consultada: true,
    version: 'total1_financiero_no_compatible',
    writer_disponible: false,
    motivo: 'Capacidad no disponible.'
  }));
  assert.doesNotMatch(html, /Writer auditado/);
  assert.match(html, /Capacidad financiera global no disponible/);
});

test('el stylesheet queda namespaced y no copia shell, shade ni backdrop de Sites', () => {
  assert.match(css, /^\/\* Cloudbeds · Tarifas/m);
  assert.match(css, /\.haiku-cloudbeds-tarifas\.haiku-cloudbeds-tarifas-v1/);
  assert.match(css, /\.haiku-cloudbeds-tarifas-lote\s*\{[\s\S]*position:\s*relative/);
  assert.doesNotMatch(css, /\.haiku-cloudbeds-tarifas-lote\s*\{[\s\S]{0,120}position:\s*sticky/);
  assert.match(css, /@container \(max-width: 430px\)/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.doesNotMatch(css, /(^|[}\n])\s*\.(?:context|context-nav|context-work|context-calendar|shade|assistant|assistant-head|assistant-bottom|composer|group|record|report|technical)(?=[\s:{.#])/m);
  assert.doesNotMatch(css, /::backdrop|backdrop\s*:/i);
});

test('el control de detalle usa un chevron derecho que rota hacia abajo al abrirse', () => {
  assert.match(frontend, /class="haiku-cloudbeds-tarifas-chevron" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(frontend, /haiku-cloudbeds-tarifas-chevron[^>]*>⌄/);
  assert.match(css, /\.haiku-cloudbeds-tarifas-chevron\s*\{[\s\S]*?border-right:\s*1\.5px solid currentColor;[\s\S]*?border-bottom:\s*1\.5px solid currentColor;[\s\S]*?transform:\s*rotate\(-45deg\)/);
  assert.match(css, /\.haiku-cloudbeds-tarifas-detalle\[open\][\s\S]*?\.haiku-cloudbeds-tarifas-chevron\s*\{\s*transform:\s*rotate\(45deg\);\s*\}/);
});

test('el frontend conserva datos y acciones reales sin comportamiento demo de Sites', () => {
  for (const textoProhibido of [
    'En esta muestra no se ejecutan escrituras.',
    'Esta muestra visual no aplica cambios.',
    'VISTA DE MUESTRA',
    'Ejemplo visual del resultado verificado',
    'Payload futuro',
    'El listado completo vendrá del PDF procesado en Proyecto H.'
  ]) assert.equal(frontend.includes(textoProhibido), false, textoProhibido);
  assert.doesNotMatch(frontend, /allReadySelected|simulationDialog|const records\s*=|const totals\s*=/);
  for (const contrato of [
    'data-cloudbeds-ver-reserva', 'data-cloudbeds-seleccionar', 'data-cloudbeds-actualizar',
    'data-cloudbeds-seleccionar-todo', 'data-cloudbeds-abrir-confirmacion',
    'data-cloudbeds-cancelar', 'data-cloudbeds-confirmar',
    'data-cloudbeds-post-write-ver-reserva', 'data-cloudbeds-post-write-cerrar'
  ]) assert.match(frontend, new RegExp(contrato));
});

test('la API pública Cloudbeds permanece completa', () => {
  assert.deepEqual(Object.keys(tarifas), [
    'CLOUDBEDS_TARIFAS_WRITER_HABILITADO', 'RPC_CAPACIDAD', 'RPC_PREVIEW', 'RPC_WRITER',
    'VERSION_PREVIEW', 'VERSION_VIGENTE', 'VERSION_V31', 'VERSION_V32', 'VERSIONES_COMPATIBLES',
    'CERTEZAS', 'CATEGORIAS', 'consultarCapacidad', 'propuestaTieneServicios', 'prepararModelo',
    'preparar', 'capacidadCorreccionFullDay', 'consultarPreparacionFullDay', 'seleccionar',
    'seleccionarTodo', 'solicitudesPreview', 'aplicarPreview', 'previsualizarSeleccion',
    'construirPayload', 'confirmarSimulacion', 'mapearErrorWriter', 'sanitizarDetalleWriter',
    'crearDiagnosticoWriter', 'ejecutarActualizacion', 'reconsultarDespuesDeEscritura',
    'construirResultadoPostWrite', 'abrirReserva', 'renderResultadoPostWrite', 'renderizar', 'montar'
  ]);
  assert.equal(tarifas.CLOUDBEDS_TARIFAS_WRITER_HABILITADO, true);
});

test('panel y fixture cargan el rediseño después del CSS base de Haku', () => {
  for (const archivo of ['panel.html', 'tests/fixtures/cloudbeds-haku-tarifas-2e/index.html']) {
    const contenido = read(archivo);
    assert.ok(contenido.indexOf('supabase-asistente-v1.css') >= 0, `${archivo}: falta CSS base`);
    assert.ok(contenido.indexOf('supabase-asistente-v1.css') < contenido.indexOf('haiku-cloudbeds-tarifas-redesign-v1.css'),
      `${archivo}: orden de estilos incorrecto`);
  }
});
