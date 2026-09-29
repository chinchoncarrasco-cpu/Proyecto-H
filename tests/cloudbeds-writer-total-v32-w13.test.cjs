const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const w13 = fs.readFileSync('supabase/migrations/20260929193900_cloudbeds_writer_total_v32_w13.sql', 'utf8');
const v32 = fs.readFileSync('supabase/migrations/20260929194050_total_v32_servicios_separados.sql', 'utf8');
const frontend = fs.readFileSync('js/haiku-cloudbeds-tarifas-v1.js', 'utf8');

function cargar(source = frontend) {
  const contexto = { module: { exports: {} }, console };
  vm.runInNewContext(source, contexto, { filename: 'haiku-cloudbeds-tarifas-v1.js' });
  return contexto.module.exports;
}

const capacidad = version => Object.freeze({
  consultada: true,
  version,
  writer_disponible: true,
  total_disponible: true,
  v31_disponible: version === 'total1_financiero_v31',
  v32_disponible: version === 'total1_financiero_v32',
  servicios_separados: version === 'total1_financiero_v32',
  motivo: 'fixture transición W1.3',
  escritura_habilitada: false
});

function informeServicio({ nombre = 'Daniel', actual = 320000, objetivo = 288000 } = {}) {
  return { filas: [{
    certeza: 'ALTA_CERTEZA',
    evidencias: ['fixture local W1.3'],
    entrada: { nombre_huesped: `${nombre} Ficticio` },
    propuesta: {
      reserva_id: `reserva-${nombre.toLowerCase()}`,
      estadia_id: `estadia-${nombre.toLowerCase()}`,
      tipo_estadia_proyecto_h: 'alojamiento',
      es_full_day: false,
      reservation_number: `CB-${nombre}`,
      reservation_id: `RID-${nombre}`,
      cabana: 5,
      total_actual_haku: actual,
      total_alojamiento_propuesto: objetivo,
      diferencia: objetivo - actual,
      productos: ['Tinaja tipo Jacuzzi']
    }
  }] };
}

function previewServicio(tarifas, modelo, {
  elegible = true,
  actual = 320000,
  objetivo = 288000,
  servicios = 30000,
  totalActual = 350000,
  totalEsperado = 318000,
  motivo = null
} = {}) {
  const item = modelo.items[0];
  return tarifas.aplicarPreview(item, {
    solo_lectura: true,
    version: tarifas.VERSION_PREVIEW,
    autoridad_financiera_version: 'total1_financiero_v32',
    reserva_id: item.fila.propuesta.reserva_id,
    estadia_id: item.fila.propuesta.estadia_id,
    tipo_estadia: 'alojamiento',
    total_actual: actual,
    total_objetivo: objetivo,
    pagado_actual: 0,
    saldo_actual: actual,
    saldo_esperado: objetivo,
    ...(elegible ? {
      servicios_sin_cambios: true,
      total_servicios_sin_cambio: servicios,
      total_reserva_actual: totalActual,
      total_reserva_esperado: totalEsperado
    } : {}),
    elegible,
    motivo_bloqueo: motivo
  });
}

test('W1.3 reemplaza sólo preview/writer y acepta una whitelist estricta v31/v32', () => {
  assert.match(w13, /create or replace function public\.haiku_previsualizar_tarifa_cloudbeds_v1/i);
  assert.match(w13, /create or replace function public\.haiku_aplicar_tarifas_cloudbeds_v1/i);
  assert.equal((w13.match(/v_autoridad_version not in \('total1_financiero_v31', 'total1_financiero_v32'\)/g) || []).length, 2);
  assert.equal((w13.match(/obj_description\([\s\S]{0,180}to_regprocedure\('public\.haiku_cambiar_totales_lote_v1\(jsonb\)'\)/g) || []).length, 2);
  assert.doesNotMatch(w13, /total1_financiero_v3'\s*\)/i);
});

test('preview W1.3 usa el planner v3 y expone autoridad y totales v32', () => {
  const previewSql = w13.slice(0, w13.indexOf('create or replace function public.haiku_aplicar_tarifas_cloudbeds_v1'));
  assert.equal((previewSql.match(/private\.haiku_plan_total_financiero_v3\(p_reserva_id, p_total_objetivo\)/g) || []).length, 1);
  assert.doesNotMatch(previewSql, /haiku_plan_total_financiero_v32/);
  for (const campo of ['autoridad_financiera_version', 'servicios_sin_cambios', 'total_servicios_sin_cambio', 'total_reserva_actual', 'total_reserva_esperado']) {
    assert.match(previewSql, new RegExp(`'${campo}'`));
  }
});

test('preview W1.3 es VOLATILE por su planner, conserva ACL/seguridad y no escribe', () => {
  const previewSql = w13.slice(0, w13.indexOf('create or replace function public.haiku_aplicar_tarifas_cloudbeds_v1'));
  assert.match(previewSql, /returns jsonb\s+language plpgsql\s+volatile\s+security definer\s+set search_path = ''/i);
  assert.match(previewSql, /revoke all on function public\.haiku_previsualizar_tarifa_cloudbeds_v1\(uuid, uuid, bigint\)\s+from public, anon/i);
  assert.match(previewSql, /grant execute on function public\.haiku_previsualizar_tarifa_cloudbeds_v1\(uuid, uuid, bigint\)\s+to authenticated/i);
  assert.doesNotMatch(previewSql, /\b(?:insert\s+into|update|delete\s+from)\b/i);
  assert.doesNotMatch(previewSql, /(?:perform|select|:=)\s+(?:private\.)?haiku_ejecutar_aplicaciones|(?:perform|select|:=)\s+(?:public\.)?haiku_cambiar_totales_lote_v1\s*\(/i);
});

test('writer W1.3 delega una sola vez en la autoridad pública y nunca usa editor/core', () => {
  const writerSql = w13.slice(w13.indexOf('create or replace function public.haiku_aplicar_tarifas_cloudbeds_v1'));
  assert.equal((writerSql.match(/v_respuesta := public\.haiku_cambiar_totales_lote_v1\(v_financieras\)/g) || []).length, 1);
  assert.doesNotMatch(writerSql, /haiku_modificar_reserva_completa|\b[a-z0-9_]*_core\s*\(/i);
  assert.doesNotMatch(writerSql, /(?:insert into|update|delete from) public\.(?:pagos|pago_aplicaciones|cargos|cargo_ajustes|estadia_noches|servicios)\b/i);
});

test('TOTAL v32 adapta el nombre estable v3 y capacidad exige todas las dependencias v32', () => {
  assert.match(v32, /create or replace function private\.haiku_plan_total_financiero_v3[\s\S]*select private\.haiku_plan_total_financiero_v32\(p_id,p_objetivo\)/i);
  assert.match(v32, /plan:=private\.haiku_plan_total_financiero_v3\(rid,objetivo\)/i);
  for (const dependencia of ['haiku_plan_total_financiero_v3', 'haiku_plan_total_financiero_v32', 'haiku_snapshot_total_financiero_v32', 'haiku_plan_aplicaciones_total_v32', 'haiku_plan_total_iva_v32']) {
    assert.match(v32, new RegExp(`to_regprocedure\\('private\\.${dependencia}`));
  }
});

test('cadena planner v32 propaga VOLATILE y explicita las inicializaciones JSONB', () => {
  assert.match(v32, /haiku_plan_aplicaciones_total_v32[\s\S]*?returns jsonb language plpgsql volatile security invoker/i);
  assert.match(v32, /haiku_plan_total_financiero_v32[\s\S]*?returns jsonb language plpgsql volatile security invoker/i);
  assert.match(v32, /haiku_plan_total_financiero_v3[\s\S]*?returns jsonb language sql volatile security invoker/i);
  assert.equal((v32.match(/filas jsonb:='\[\]'::jsonb/g) || []).length, 2);
  for (const inicializacion of ["planes jsonb:='{}'::jsonb", "antes jsonb:='{}'::jsonb", "resultados jsonb:='[]'::jsonb"]) {
    assert.ok(v32.includes(inicializacion), `falta inicialización explícita: ${inicializacion}`);
  }
});

test('capacidad frontend acepta exactamente v31/v32 y conserva writer false', async () => {
  const tarifas = cargar();
  for (const version of tarifas.VERSIONES_COMPATIBLES) {
    const data = await tarifas.consultarCapacidad({ async rpc() { return { data: {
      version, writer_disponible: true, servicios_separados: version === tarifas.VERSION_V32
    } }; } });
    assert.equal(data.total_disponible, true);
    assert.equal(data.v32_disponible, version === tarifas.VERSION_V32);
  }
  const rechazada = await tarifas.consultarCapacidad({ async rpc() {
    return { data: { version: 'total1_financiero_v999', writer_disponible: true } };
  } });
  assert.equal(rechazada.total_disponible, false);
  assert.equal(tarifas.CLOUDBEDS_TARIFAS_WRITER_HABILITADO, false);
  assert.match(frontend, /const CLOUDBEDS_TARIFAS_WRITER_HABILITADO = false/);
});

test('Daniel queda en revisión con v31 y pendiente de preview con v32', () => {
  const tarifas = cargar();
  const enV31 = tarifas.prepararModelo(informeServicio(), capacidad(tarifas.VERSION_V31));
  assert.equal(enV31.items[0].tiene_servicios, true);
  assert.equal(enV31.items[0].seleccionable, false);
  assert.equal(enV31.items[0].compatibilidad_financiera, 'REQUIERE_REVISION_V32');
  assert.match(tarifas.renderizar(enV31), /Servicios detectados · revisión manual hasta disponer de TOTAL v32/);

  const enV32 = tarifas.prepararModelo(informeServicio(), capacidad(tarifas.VERSION_V32));
  assert.equal(enV32.items[0].seleccionable, true);
  assert.equal(enV32.items[0].compatibilidad_financiera, 'REQUIERE_REVALIDACION_V32');
  assert.match(tarifas.renderizar(enV32), /Pendiente de revalidación v32/);
});

test('Daniel v32 muestra alojamiento, servicio intacto y totales globales sin alerta amarilla', () => {
  const tarifas = cargar();
  const modelo = tarifas.prepararModelo(informeServicio(), capacidad(tarifas.VERSION_V32));
  tarifas.seleccionarTodo(modelo, true);
  previewServicio(tarifas, modelo);
  const html = tarifas.renderizar(modelo);
  for (const texto of [
    'Alojamiento actual</dt><dd>$320.000',
    'Alojamiento Cloudbeds</dt><dd>$288.000',
    'Servicios sin cambios</dt><dd>$30.000',
    'Total reserva actual</dt><dd>$350.000',
    'Total reserva esperado</dt><dd>$318.000',
    'Los servicios se conservarán sin cambios.'
  ]) assert.match(html, new RegExp(texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /Hay pagos o cargos mezclados/);
  assert.equal(tarifas.construirPayload(modelo).length, 1);
});

test('Isadora deja claro que 320232 es alojamiento y el total global sube sólo 232', () => {
  const tarifas = cargar();
  const modelo = tarifas.prepararModelo(informeServicio({ nombre: 'Isadora', objetivo: 320232 }), capacidad(tarifas.VERSION_V32));
  tarifas.seleccionarTodo(modelo, true);
  previewServicio(tarifas, modelo, { objetivo: 320232, servicios: 45000, totalActual: 365000, totalEsperado: 365232 });
  const html = tarifas.renderizar(modelo);
  assert.match(html, /Alojamiento Cloudbeds<\/dt><dd>\$320\.232/);
  assert.match(html, /Total reserva esperado<\/dt><dd>\$365\.232/);
});

test('pago mixto bloqueado no entra al payload y usa el aviso amarillo acordado', () => {
  const tarifas = cargar();
  const modelo = tarifas.prepararModelo(informeServicio(), capacidad(tarifas.VERSION_V32));
  tarifas.seleccionarTodo(modelo, true);
  previewServicio(tarifas, modelo, { elegible: false, motivo: 'Pago mezclado entre alojamiento y servicios: requiere revisión' });
  assert.equal(modelo.items[0].compatibilidad_financiera, 'REQUIERE_REVISION_MANUAL_SERVICIOS');
  assert.equal(tarifas.construirPayload(modelo).length, 0);
  const html = tarifas.renderizar(modelo);
  assert.match(html, /haiku-cloudbeds-tarifas-preview-alerta/);
  assert.match(html, /Hay pagos o cargos mezclados entre alojamiento y servicios\. Revisión manual requerida\./);
});
