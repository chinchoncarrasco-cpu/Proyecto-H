const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('supabase/migrations/20260929043150_cloudbeds_writer_audit_w1.sql');
const frontendSource = read('js/haiku-cloudbeds-tarifas-v1.js');
const labReadme = read('tests/README-cloudbeds-writer-w1.md');

function cargarTarifas() {
  const ruta = require.resolve('../js/haiku-cloudbeds-tarifas-v1');
  delete require.cache[ruta];
  delete global.HAIKU_CLOUDBEDS_TARIFAS_V1;
  delete global.CLOUDBEDS_TARIFAS_WRITER_HABILITADO;
  return require(ruta);
}

function fila(extra = {}) {
  const propuesta = {
    reserva_id: '00000000-0000-4000-8000-000000000001',
    estadia_id: '00000000-0000-4000-8000-000000000002',
    tipo_estadia_proyecto_h: 'alojamiento',
    es_full_day: false,
    reservation_number: 'CB-W1-1',
    reservation_id: 'RID-W1-1',
    cabana: 5,
    total_actual_haku: 160000,
    total_alojamiento_propuesto: 144000,
    diferencia: -16000,
    pagado_actual_haku: 100000,
    saldo_actual_haku: 60000,
    saldo_esperado_haku: 44000,
    ...extra.propuesta
  };
  return {
    certeza: 'ALTA_CERTEZA',
    evidencias: ['ID y contexto coherentes', 'Depósito es alojamiento'],
    entrada: { nombre_huesped: 'Héctor Ficticio' },
    propuesta,
    ...extra,
    propuesta
  };
}

function modeloSeleccionado(tarifas, extra = {}) {
  const modelo = tarifas.prepararModelo({ filas: [fila(extra)] }, {
    v31_disponible: true,
    version: 'total1_financiero_v31',
    motivo: 'Prueba W1'
  });
  tarifas.seleccionarTodo(modelo, true);
  return modelo;
}

test('la migración crea preview de lectura y writer Cloudbeds', () => {
  assert.match(migration, /create function public\.haiku_previsualizar_tarifa_cloudbeds_v1\([\s\S]*p_reserva_id uuid[\s\S]*p_estadia_id uuid[\s\S]*p_total_objetivo bigint/i);
  assert.match(migration, /create function public\.haiku_aplicar_tarifas_cloudbeds_v1\(p_operaciones jsonb\)/i);
});

test('la RPC usa SECURITY DEFINER con search_path vacío', () => {
  assert.match(migration, /language plpgsql\s+security definer\s+set search_path = ''/i);
});

test('la RPC revoca PUBLIC y anon y concede sólo authenticated', () => {
  assert.match(migration, /revoke all on function public\.haiku_previsualizar_tarifa_cloudbeds_v1\(uuid, uuid, bigint\)[\s\S]*from public, anon/i);
  assert.match(migration, /grant execute on function public\.haiku_previsualizar_tarifa_cloudbeds_v1\(uuid, uuid, bigint\)[\s\S]*to authenticated/i);
  assert.match(migration, /revoke all on function public\.haiku_aplicar_tarifas_cloudbeds_v1\(jsonb\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.haiku_aplicar_tarifas_cloudbeds_v1\(jsonb\) to authenticated/i);
});

test('la RPC exige usuario activo y permisos internos financieros', () => {
  for (const contrato of ['haiku_usuario_activo', "reservas.editar", "pagos.ver", "pagos.registrar"]) {
    assert.match(migration, new RegExp(contrato.replace('.', '\\.')));
  }
});

test('certeza y evidencia son metadata, no una autorización backend', () => {
  for (const campo of ['reserva_id', 'estadia_id', 'tipo_estadia', 'total_actual_esperado', 'total_objetivo', 'certeza', 'evidencia']) {
    assert.match(migration, new RegExp(campo));
  }
  assert.doesNotMatch(migration, /v_item->>'certeza'\s*,?\s*''\)\s*<>\s*'ALTA_CERTEZA'/);
  assert.match(migration, /metadata inválida/);
  assert.match(migration, /autoriza por sesión, permisos, estructura y snapshot financiero; certeza\/evidencia son sólo metadata/);
});

test('la preview normal relee Proyecto H y usa el plan financiero vigente sin escribir', () => {
  assert.match(migration, /private\.haiku_plan_total_financiero_v3\(p_reserva_id, p_total_objetivo\)/);
  assert.match(migration, /'firma_iva', case when v_plan \? 'firma' then v_plan->>'firma' end/);
  assert.match(migration, /'total_actual', v_actual[\s\S]*'pagado_actual'[\s\S]*'saldo_actual'[\s\S]*'saldo_esperado'/);
  assert.doesNotMatch(migration.slice(0, migration.indexOf('create function public.haiku_aplicar_tarifas_cloudbeds_v1')), /(?:insert into|update|delete from) public\./i);
});

test('la preview Full Day valida D a D, dinero aplicado y autoridad pública futura', () => {
  assert.match(migration, /v_estadia\.tipo_estadia = 'fullday'[\s\S]*fecha_salida is distinct from v_estadia\.fecha_ingreso/);
  assert.match(migration, /v_pagado > p_total_objetivo/);
  assert.match(migration, /public\.haiku_modificar_reserva_completa/);
});

test('la concurrencia se protege con advisory lock y orden estable', () => {
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]*hashtextextended/i);
  assert.match(migration, /jsonb_array_elements\(p_operaciones\)[\s\S]*order by 1/i);
});

test('una reserva o estadía repetida bloquea el lote', () => {
  assert.match(migration, /count\(distinct \(value->>'reserva_id'\)::uuid\)/i);
  assert.match(migration, /count\(distinct \(value->>'estadia_id'\)::uuid\)/i);
});

test('referencias Cloudbeds duplicadas o incompatibles no autorizan', () => {
  assert.match(migration, /Una referencia Cloudbeds apunta a más de una operación/);
  assert.match(migration, /vínculo Cloudbeds incompatible/);
  assert.match(migration, /pertenece a otra reserva de Proyecto H/);
});

test('alojamiento normal delega exclusivamente a TOTAL v31 pública', () => {
  assert.match(migration, /public\.haiku_cambiar_totales_lote_v1\(v_normales\)/);
  assert.match(migration, /total1_financiero_v31/);
});

test('W1 transporta la firma IVA de la preview sin recalcularla', () => {
  assert.match(migration, /v_item \? 'firma_iva'[\s\S]*jsonb_build_object\('firma_iva', v_item->>'firma_iva'\)/);
  const writer = migration.slice(migration.indexOf('create function public.haiku_aplicar_tarifas_cloudbeds_v1'));
  assert.doesNotMatch(writer, /private\.haiku_plan_total_financiero_v3\(/);
  assert.match(writer, /PLAN_IVA_DESACTUALIZADO/);
});

test('Full Day delega exclusivamente al editor público', () => {
  assert.match(migration, /public\.haiku_modificar_reserva_completa\(/);
  assert.match(migration, /p_tarifa_fullday => v_objetivo/);
});

test('la migración nunca llama funciones core', () => {
  assert.doesNotMatch(migration, /\b[a-z0-9_]*_core\s*\(/i);
});

test('el wrapper no implementa DML financiero paralelo', () => {
  assert.doesNotMatch(migration, /(?:insert into|update|delete from) public\.(?:pagos|pago_aplicaciones|cargos|cargo_ajustes|estadia_noches|servicios)\b/i);
});

test('Full Day relee identidad, ocupación, contactos y acompañantes', () => {
  for (const campo of ['titular_nombre', 'cabana_numero', 'fecha_ingreso', 'adultos', 'ninos', 'mascotas',
    'correo_contacto', 'telefono_contacto', 'titular_numero_documento', 'observaciones', 'v_acompanantes']) {
    assert.match(migration, new RegExp(campo));
  }
});

test('Full Day verifica que identidad y ocupación permanezcan iguales', () => {
  assert.match(migration, /v_snapshot_despues is distinct from v_snapshot_antes/);
  assert.match(migration, /alteraría identidad u ocupación; lote revertido/);
});

test('pagos y metadatos se comparan completos antes y después', () => {
  assert.match(migration, /jsonb_agg\(pg_catalog\.to_jsonb\(p\) order by p\.id\)/);
  assert.match(migration, /Una fila de pagos fue modificada; lote revertido/);
});

test('servicios y sus cargos permanecen intactos', () => {
  assert.match(migration, /'servicios'[\s\S]*'cargos'/);
  assert.match(migration, /Un servicio o cargo de servicio fue modificado; lote revertido/);
});

test('el expected total produce un error estable de estado obsoleto', () => {
  assert.match(migration, /v_actual is distinct from v_esperado[\s\S]*ESTADO_DESACTUALIZADO/);
});

test('pagos superiores al objetivo producen un error estable', () => {
  assert.match(migration, /v_pagado, 0\) > v_objetivo[\s\S]*PAGO_SUPERA_NUEVO_TOTAL/);
});

test('el wrapper expone códigos conservadores para stale, IVA, pagos y elegibilidad', () => {
  for (const codigo of ['ESTADO_DESACTUALIZADO', 'PLAN_IVA_DESACTUALIZADO', 'PAGO_SUPERA_NUEVO_TOTAL', 'RESERVA_NO_ELEGIBLE', 'CONFLICTO_FINANCIERO']) {
    assert.match(migration, new RegExp(codigo));
  }
});

test('la auditoría Cloudbeds registra todos los campos exigidos', () => {
  for (const campo of ['reserva_id', 'estadia_id', 'tipo_estadia', 'total_anterior', 'total_nuevo', 'diferencia',
    'cloudbeds_reservation_number', 'cloudbeds_reservation_id', 'certeza', 'evidencia', 'autorizado_por', 'confirmado_en']) {
    assert.match(migration, new RegExp(campo));
  }
  assert.match(migration, /'fuente', 'cloudbeds_pdf'/);
  assert.match(migration, /'cloudbeds'\s*\)/);
});

test('el vínculo Cloudbeds no se persiste', () => {
  assert.doesNotMatch(migration, /update public\.reservas/i);
  assert.match(migration, /'vinculo_cloudbeds_persistido', false/);
});

test('W1 no agrega compatibilidad de esquema para columnas vigentes de producción', () => {
  assert.doesNotMatch(migration, /alter table public\.(?:eventos_auditoria|huespedes)/i);
  for (const campo of ['eventos_auditoria.estadia_id', 'eventos_auditoria.cabana_id', 'huespedes.apellido', 'ON DELETE RESTRICT']) {
    assert.match(labReadme, new RegExp(campo.replace('.', '\\.')));
  }
});

test('el writer frontend continúa literalmente deshabilitado', () => {
  const tarifas = cargarTarifas();
  assert.equal(tarifas.CLOUDBEDS_TARIFAS_WRITER_HABILITADO, false);
  assert.match(frontendSource, /const CLOUDBEDS_TARIFAS_WRITER_HABILITADO = false/);
});

test('el payload frontend coincide con el contrato RPC W1', () => {
  const tarifas = cargarTarifas();
  const payload = tarifas.construirPayload(modeloSeleccionado(tarifas));
  assert.deepEqual(Object.keys(payload[0]), [
    'reserva_id', 'estadia_id', 'tipo_estadia', 'total_actual_esperado', 'total_objetivo',
    'cloudbeds_reservation_number', 'cloudbeds_reservation_id', 'certeza', 'evidencia'
  ]);
  assert.equal(payload[0].total_actual_esperado, 160000);
  assert.equal(payload[0].total_objetivo, 144000);
});

test('una llamada programática no alcanza Supabase mientras el flag sea false', async () => {
  const tarifas = cargarTarifas();
  let llamadas = 0;
  const resultado = await tarifas.ejecutarActualizacion(modeloSeleccionado(tarifas), {
    async rpc() { llamadas++; return { data: { ok: true, resultados: [] } }; }
  });
  assert.equal(resultado.codigo, 'WRITER_DESHABILITADO');
  assert.equal(resultado.escrituras, 0);
  assert.equal(llamadas, 0);
});

test('la preview tampoco alcanza Supabase mientras el writer sea false', async () => {
  const tarifas = cargarTarifas();
  let llamadas = 0;
  const resultado = await tarifas.previsualizarSeleccion(modeloSeleccionado(tarifas), {
    async rpc() { llamadas++; return { data: {} }; }
  });
  assert.equal(resultado.codigo, 'WRITER_DESHABILITADO');
  assert.equal(llamadas, 0);
});

test('snapshot preview alimenta modal y payload W1, incluida firma IVA opcional', () => {
  const tarifas = cargarTarifas();
  const modelo = modeloSeleccionado(tarifas);
  tarifas.aplicarPreview(modelo.items[0], {
    solo_lectura: true,
    version: tarifas.VERSION_PREVIEW,
    autoridad_financiera_version: 'total1_financiero_v31',
    reserva_id: modelo.items[0].fila.propuesta.reserva_id,
    estadia_id: modelo.items[0].fila.propuesta.estadia_id,
    tipo_estadia: 'alojamiento',
    cabana_numero: 5,
    total_actual: 150000,
    total_objetivo: 144000,
    pagado_actual: 100000,
    saldo_actual: 50000,
    saldo_esperado: 44000,
    firma_iva: 'firma-preview-vigente',
    elegible: true
  });
  const payload = tarifas.construirPayload(modelo)[0];
  assert.equal(payload.total_actual_esperado, 150000);
  assert.equal(payload.firma_iva, 'firma-preview-vigente');
  const html = tarifas.renderizar(modelo);
  assert.match(html, /Proyecto H cambió desde que se cargó el PDF/);
  assert.match(html, /\$150\.000/);
});

test('preview sin plan IVA no inventa firma en payload', () => {
  const tarifas = cargarTarifas();
  const modelo = modeloSeleccionado(tarifas);
  tarifas.aplicarPreview(modelo.items[0], {
    solo_lectura: true,
    version: tarifas.VERSION_PREVIEW,
    autoridad_financiera_version: 'total1_financiero_v31',
    reserva_id: modelo.items[0].fila.propuesta.reserva_id,
    estadia_id: modelo.items[0].fila.propuesta.estadia_id,
    tipo_estadia: 'alojamiento',
    total_actual: 160000,
    total_objetivo: 144000,
    pagado_actual: 100000,
    saldo_actual: 60000,
    saldo_esperado: 44000,
    elegible: true
  });
  assert.equal('firma_iva' in tarifas.construirPayload(modelo)[0], false);
});

test('los errores backend se traducen a los textos UX acordados', () => {
  const tarifas = cargarTarifas();
  assert.equal(tarifas.mapearErrorWriter({ message: 'ESTADO_DESACTUALIZADO' }).mensaje,
    'La reserva cambió desde que cargaste el PDF. Revísala nuevamente.');
  assert.equal(tarifas.mapearErrorWriter({ details: 'PAGO_SUPERA_NUEVO_TOTAL' }).mensaje,
    'El nuevo total quedaría por debajo de los pagos ya aplicados.');
  assert.equal(tarifas.mapearErrorWriter({ message: 'RESERVA_NO_ELEGIBLE' }).mensaje,
    'La reserva ya no cumple las condiciones para actualización automática.');
  assert.equal(tarifas.mapearErrorWriter({ message: 'CONFLICTO_FINANCIERO' }).mensaje,
    'Proyecto H detectó un conflicto financiero. Revisión manual requerida.');
  assert.equal(tarifas.mapearErrorWriter({ message: 'PLAN_IVA_DESACTUALIZADO' }).mensaje,
    'El plan IVA cambió desde la preview. Vuelve a revisar la propuesta.');
});

test('el modal humano muestra montos, pagado, saldos y acciones acordadas', () => {
  const tarifas = cargarTarifas();
  const html = tarifas.renderizar(modeloSeleccionado(tarifas));
  for (const texto of ['Actualizar tarifa', 'Héctor Ficticio', 'CAB 5', 'Alojamiento actual', 'Alojamiento Cloudbeds',
    'Diferencia', 'Pagado actual', 'Saldo actual', 'Saldo esperado', 'Cancelar', 'Confirmar actualización']) {
    assert.match(html, new RegExp(texto));
  }
  assert.match(html, /Confirmar actualización<\/button>/);
  assert.match(html, /data-cloudbeds-confirmar disabled/);
});

test('el post-write está preparado para reconsultar Proyecto H e Inspector', () => {
  for (const contrato of ['haikuSincronizarReservasSupabase', 'HAIKU_RESERVAS_V1',
    'HAIKU_OPERACION_RESUMEN_FIX_V1', 'haikuCargarSaldosCheckinSupabase',
    'HAIKU_INSPECTOR_V1', 'lector.consultar']) {
    assert.match(frontendSource, new RegExp(contrato.replace('.', '\\.')));
  }
  assert.match(frontendSource, /preparar\(informe, cliente\)/);
  assert.match(frontendSource, /nunca se parchean montos locales/);
});

test('el frontend futuro llama sólo a la RPC Cloudbeds, no a las autoridades internas', () => {
  assert.match(frontendSource, /haiku_previsualizar_tarifa_cloudbeds_v1/);
  assert.match(frontendSource, /haiku_aplicar_tarifas_cloudbeds_v1/);
  assert.doesNotMatch(frontendSource, /haiku_cambiar_totales_lote_v1|\.rpc\(\s*["']haiku_modificar_reserva_completa/);
});
