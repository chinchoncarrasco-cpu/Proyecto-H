const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('supabase/migrations/20260929170344_cloudbeds_writer_fullday_v31_w12.sql');
const frontendSource = read('js/haiku-cloudbeds-tarifas-v1.js');
const inicioWriter = migration.indexOf('create or replace function public.haiku_aplicar_tarifas_cloudbeds_v1');
const previewSql = migration.slice(0, inicioWriter);
const writerSql = migration.slice(inicioWriter);

function cargarTarifas(source = frontendSource) {
  const contexto = { module: { exports: {} }, console };
  vm.runInNewContext(source, contexto, { filename: 'haiku-cloudbeds-tarifas-v1.js' });
  return contexto.module.exports;
}

function modeloSeleccionado(tarifas) {
  const modelo = tarifas.prepararModelo({ filas: [{
    certeza: 'ALTA_CERTEZA',
    evidencias: ['fixture local W1.2'],
    entrada: { nombre_huesped: 'Vanessa Ficticia' },
    propuesta: {
      reserva_id: '00000000-0000-4000-8000-000000000020',
      estadia_id: '00000000-0000-4000-8000-000000001020',
      tipo_estadia_proyecto_h: 'fullday',
      es_full_day: true,
      reservation_number: 'CB-W12-20',
      reservation_id: 'RID-W12-20',
      cabana: 20,
      total_actual_haku: 160000,
      total_alojamiento_propuesto: 120000,
      diferencia: -40000,
      pagado_actual_haku: 120000,
      saldo_actual_haku: 40000,
      saldo_esperado_haku: 0
    }
  }] }, {
    v31_disponible: true,
    version: 'total1_financiero_v31',
    motivo: 'fixture W1.2'
  });
  tarifas.seleccionarTodo(modelo, true);
  tarifas.aplicarPreview(modelo.items[0], {
    solo_lectura: true,
    version: tarifas.VERSION_PREVIEW,
    autoridad_financiera_version: 'total1_financiero_v31',
    reserva_id: modelo.items[0].fila.propuesta.reserva_id,
    estadia_id: modelo.items[0].fila.propuesta.estadia_id,
    tipo_estadia: 'fullday',
    total_actual: 160000,
    total_objetivo: 120000,
    pagado_actual: 120000,
    saldo_actual: 40000,
    saldo_esperado: 0,
    elegible: true
  });
  return modelo;
}

test('W1.2 reemplaza incrementalmente las dos funciones públicas sin cambiar firmas', () => {
  assert.match(migration, /create or replace function public\.haiku_previsualizar_tarifa_cloudbeds_v1\(\s*p_reserva_id uuid,\s*p_estadia_id uuid,\s*p_total_objetivo bigint\s*\)/i);
  assert.match(migration, /create or replace function public\.haiku_aplicar_tarifas_cloudbeds_v1\(p_operaciones jsonb\)/i);
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.haiku_aplicar_tarifas_cloudbeds_v1\(jsonb\) from public, anon/i);
});

test('preview Full Day usa el mismo plan financiero v3 que alojamiento', () => {
  assert.equal((previewSql.match(/private\.haiku_plan_total_financiero_v3\(p_reserva_id, p_total_objetivo\)/g) || []).length, 1);
  assert.doesNotMatch(previewSql, /v_motivo is null and v_estadia\.tipo_estadia = 'alojamiento'/);
  assert.match(previewSql, /v_estadia\.tipo_estadia = 'fullday'[\s\S]*fecha_salida is distinct from v_estadia\.fecha_ingreso[\s\S]*estadia_noches/);
  assert.match(previewSql, /'autoridad', 'public\.haiku_cambiar_totales_lote_v1'/);
});

test('firma IVA del plan viaja para cualquier tipo sin excepción Full Day', () => {
  assert.match(previewSql, /'firma_iva', case when v_plan \? 'firma' then v_plan->>'firma' end/);
  assert.match(writerSql, /v_item \? 'firma_iva'[\s\S]*jsonb_build_object\('firma_iva', v_item->>'firma_iva'\)/);
  assert.doesNotMatch(writerSql, /tipo_estadia'\s*=\s*'fullday'[\s\S]{0,120}firma_iva/);
});

test('writer arma v_financieras para ambos tipos y llama TOTAL v31 una sola vez', () => {
  assert.match(writerSql, /v_financieras jsonb := '\[\]'::jsonb/);
  assert.doesNotMatch(writerSql, /v_tipo\s*=\s*'alojamiento'\s+and\s+v_esperado\s*<>/);
  assert.equal((writerSql.match(/v_respuesta := public\.haiku_cambiar_totales_lote_v1\(v_financieras\)/g) || []).length, 1);
  assert.match(writerSql, /Una sola autoridad y una sola llamada para el lote mixto completo/);
});

test('W1.2 no participa del editor genérico ni de ningún core', () => {
  assert.doesNotMatch(migration, /haiku_modificar_reserva_completa/i);
  assert.doesNotMatch(migration, /\b[a-z0-9_]*_core\s*\(/i);
  assert.doesNotMatch(writerSql, /(?:insert into|update|delete from) public\.(?:pagos|pago_aplicaciones|cargos|cargo_ajustes|estadia_noches|servicios)\b/i);
});

test('snapshots W1.2 protegen identidad, ocupación, estados, pagos y servicios completos', () => {
  for (const campo of ['reserva', 'estadias', 'huespedes', 'reserva_huespedes', 'estadia_huespedes', 'pagos', 'servicios', 'cargos_servicio']) {
    assert.match(writerSql, new RegExp(`'${campo}'`));
  }
  assert.match(writerSql, /to_jsonb\(r\)[\s\S]*to_jsonb\(e\)[\s\S]*to_jsonb\(h\)/);
  assert.match(writerSql, /v_snapshot_despues is distinct from v_invariantes_antes->v_reserva_id::text/);
  assert.match(writerSql, /TOTAL v31 alteró datos ajenos a la corrección financiera; lote revertido/);
});

test('no-op no entra al lote financiero y auditoría W1 sólo se inserta con cambio real', () => {
  assert.match(writerSql, /if v_esperado <> v_objetivo then[\s\S]*v_financieras :=/);
  assert.match(writerSql, /if v_esperado <> v_objetivo then[\s\S]*insert into public\.eventos_auditoria/);
});

test('writer frontend activado conserva el contrato W1.2', () => {
  const tarifas = cargarTarifas();
  assert.equal(tarifas.CLOUDBEDS_TARIFAS_WRITER_HABILITADO, true);
  assert.match(frontendSource, /const CLOUDBEDS_TARIFAS_WRITER_HABILITADO = true/);
});

test('error backend real produce diagnóstico W1 no vacío y conserva detail sanitizado', async () => {
  const tarifas = cargarTarifas();
  const modelo = modeloSeleccionado(tarifas);
  const resultado = await tarifas.ejecutarActualizacion(modelo, {
    async rpc(nombre) {
      assert.equal(nombre, tarifas.RPC_WRITER);
      return {
        error: {
          message: 'CONFLICTO_FINANCIERO',
          details: 'El editor Full Day alteraría identidad u ocupación; lote revertido. Authorization: Bearer eyJabc12345.eyJdef67890.xyz98765432 apikey="super-secreto" password=oculta'
        }
      };
    }
  });
  assert.equal(resultado.ok, false);
  assert.deepEqual(JSON.parse(JSON.stringify(resultado.diagnostico)), {
    etapa: 'writer',
    codigo: 'CONFLICTO_FINANCIERO',
    mensaje: 'Proyecto H detectó un conflicto financiero. Revisión manual requerida.',
    detalle_backend: 'El editor Full Day alteraría identidad u ocupación; lote revertido. Authorization: [REDACTADO] apikey=[REDACTADO] password=[REDACTADO]'
  });
  const serializado = JSON.stringify(resultado.diagnostico);
  assert.doesNotMatch(serializado, /eyJabc|super-secreto|oculta/);
});

test('sanitizador elimina JWT, API keys, headers y secretos sin ocultar el detalle útil', () => {
  const tarifas = cargarTarifas();
  const detalle = tarifas.sanitizarDetalleWriter('Guard financiero: Authorization=Bearer token.abc API_KEY: abc123456789 secret=shhhhhhhhh refresh_token=toktoktok');
  assert.match(detalle, /Guard financiero/);
  assert.doesNotMatch(detalle, /token\.abc|abc123456789|shhhhhhhhh|toktoktok/);
  assert.match(detalle, /\[REDACTADO\]/);
});

test('panel diagnóstico renderiza el objeto persistido y no vuelve a []', () => {
  const tarifas = cargarTarifas();
  const modelo = modeloSeleccionado(tarifas);
  modelo.diagnostico_writer = tarifas.crearDiagnosticoWriter('writer', {
    message: 'CONFLICTO_FINANCIERO',
    details: 'Detalle financiero local.'
  });
  const html = tarifas.renderizar(modelo);
  assert.match(html, /Payload W1 · diagnóstico/);
  assert.match(html, /CONFLICTO_FINANCIERO/);
  assert.match(html, /detalle_backend/);
  assert.doesNotMatch(html, /data-cloudbeds-payload>\[\]<\/pre>/);
});

test('seleccionar otra propuesta limpia un diagnóstico obsoleto', () => {
  const tarifas = cargarTarifas();
  const modelo = modeloSeleccionado(tarifas);
  modelo.diagnostico_writer = { etapa: 'writer', codigo: 'CONFLICTO_FINANCIERO' };
  tarifas.seleccionar(modelo, modelo.items[0].id, false);
  assert.equal(modelo.diagnostico_writer, null);
});
