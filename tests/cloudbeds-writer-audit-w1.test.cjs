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

function previewElegible(tarifas, modelo, extra = {}) {
  const item = modelo.items.find(actual => actual.seleccionado);
  const propuesta = item.fila.propuesta;
  return {
    solo_lectura: true,
    version: tarifas.VERSION_PREVIEW,
    autoridad_financiera_version: modelo.capacidad.version,
    reserva_id: propuesta.reserva_id,
    estadia_id: propuesta.estadia_id,
    tipo_estadia: propuesta.es_full_day ? 'fullday' : propuesta.tipo_estadia_proyecto_h,
    cabana_numero: propuesta.cabana,
    total_actual: propuesta.total_actual_haku,
    total_objetivo: propuesta.total_alojamiento_propuesto,
    pagado_actual: propuesta.pagado_actual_haku,
    saldo_actual: propuesta.saldo_actual_haku,
    saldo_esperado: propuesta.saldo_esperado_haku,
    elegible: true,
    ...extra
  };
}

function aplicarPreviewElegible(tarifas, modelo, extra = {}) {
  const item = modelo.items.find(actual => actual.seleccionado);
  tarifas.aplicarPreview(item, previewElegible(tarifas, modelo, extra));
  return item;
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

test('el writer frontend queda activado exclusivamente por su bandera', () => {
  const tarifas = cargarTarifas();
  assert.equal(tarifas.CLOUDBEDS_TARIFAS_WRITER_HABILITADO, true);
  assert.match(frontendSource, /const CLOUDBEDS_TARIFAS_WRITER_HABILITADO = true/);
});

test('sólo una propuesta elegible muestra la acción de escritura', () => {
  const tarifas = cargarTarifas();
  const elegible = tarifas.renderizar(modeloSeleccionado(tarifas));
  assert.match(elegible, /data-cloudbeds-actualizar[^>]*>Actualizar tarifa<\/button>/);
  assert.doesNotMatch(elegible, /data-cloudbeds-actualizar[^>]*disabled/);

  const bloqueada = tarifas.prepararModelo({ filas: [fila({ certeza: 'REVISION_MANUAL' })] }, {
    v31_disponible: true,
    version: tarifas.VERSION_VIGENTE
  });
  assert.doesNotMatch(tarifas.renderizar(bloqueada), /data-cloudbeds-actualizar/);

  const sinCapacidad = tarifas.prepararModelo({ filas: [fila({ propuesta: { productos: ['Tinaja ficticia'] } })] }, {
    v31_disponible: false,
    version: null,
    motivo: 'TOTAL v31 no disponible.'
  });
  assert.doesNotMatch(tarifas.renderizar(sinCapacidad), /data-cloudbeds-actualizar/);
});

test('el payload frontend coincide con el contrato RPC W1', () => {
  const tarifas = cargarTarifas();
  const modelo = modeloSeleccionado(tarifas);
  aplicarPreviewElegible(tarifas, modelo);
  const payload = tarifas.construirPayload(modelo);
  assert.deepEqual(Object.keys(payload[0]), [
    'reserva_id', 'estadia_id', 'tipo_estadia', 'total_actual_esperado', 'total_objetivo',
    'cloudbeds_reservation_number', 'cloudbeds_reservation_id', 'certeza', 'evidencia'
  ]);
  assert.equal(payload[0].total_actual_esperado, 160000);
  assert.equal(payload[0].total_objetivo, 144000);
});

test('la preview bloqueada impide construir payload y nunca llama al writer', async () => {
  const tarifas = cargarTarifas();
  const modelo = modeloSeleccionado(tarifas);
  const llamadas = [];
  const cliente = {
    async rpc(nombre) {
      llamadas.push(nombre);
      assert.equal(nombre, tarifas.RPC_PREVIEW);
      return { data: previewElegible(tarifas, modelo, {
        elegible: false,
        motivo_bloqueo: 'La reserva requiere revisión manual.'
      }) };
    }
  };
  const preview = await tarifas.previsualizarSeleccion(modelo, cliente);
  const resultado = await tarifas.ejecutarActualizacion(modelo, cliente);
  assert.equal(preview.ok, false);
  assert.equal(preview.mensaje, 'La reserva requiere revisión manual.');
  assert.equal(resultado.codigo, 'RESERVA_NO_ELEGIBLE');
  assert.equal(resultado.escrituras, 0);
  assert.deepEqual(llamadas, [tarifas.RPC_PREVIEW]);
  assert.deepEqual(tarifas.construirPayload(modelo), []);
});

test('preview precede al writer y el éxito obliga a reconsultar Proyecto H', async () => {
  const tarifas = cargarTarifas();
  const modelo = modeloSeleccionado(tarifas);
  const llamadas = [];
  const lectorAnterior = global.HAIKU_CLOUDBEDS_PDF_V1;
  global.HAIKU_CLOUDBEDS_PDF_V1 = {
    async consultar(entradas) {
      llamadas.push('reconsulta-proyecto-h');
      assert.deepEqual(entradas, [modelo.informe.filas[0].entrada]);
      return {
        filas: [fila({
          certeza: 'SIN_CAMBIO',
          propuesta: {
            total_actual_haku: 144000,
            total_alojamiento_propuesto: 144000,
            diferencia: 0,
            pagado_actual_haku: 100000,
            saldo_actual_haku: 44000
          }
        })]
      };
    }
  };
  const cliente = {
    from() { return {}; },
    async rpc(nombre, parametros) {
      llamadas.push(nombre);
      if (nombre === tarifas.RPC_PREVIEW) {
        assert.equal(parametros.p_total_objetivo, 144000);
        return { data: previewElegible(tarifas, modelo, { firma_iva: 'firma-canario' }) };
      }
      if (nombre === tarifas.RPC_WRITER) {
        assert.equal(parametros.p_operaciones.length, 1);
        return { data: { ok: true, cambios: 1, resultados: [{ operacion_id: 'op-canario' }] } };
      }
      if (nombre === tarifas.RPC_CAPACIDAD) {
        return { data: { version: tarifas.VERSION_VIGENTE, writer_disponible: true } };
      }
      throw new Error(`RPC inesperada: ${nombre}`);
    }
  };
  try {
    const preview = await tarifas.previsualizarSeleccion(modelo, cliente);
    const resultado = await tarifas.ejecutarActualizacion(modelo, cliente);
    assert.equal(preview.ok, true);
    assert.equal(resultado.ok, true);
    assert.equal(resultado.estado_final_confirmado, true);
    assert.deepEqual(resultado.confirmacion_post_write.actualizaciones[0], {
      reserva_id: modelo.items[0].fila.propuesta.reserva_id,
      estadia_id: modelo.items[0].fila.propuesta.estadia_id,
      nombre: 'Héctor Ficticio',
      total_anterior: 160000,
      total_nuevo: 144000,
      pagado: 100000,
      saldo: 44000,
      certeza: 'SIN_CAMBIO',
      operacion_id: 'op-canario'
    });
    assert.equal(resultado.reconsulta.modelo.conteos.SIN_CAMBIO, 1);
    assert.equal(modelo.items[0].fila.propuesta.total_actual_haku, 160000);
    assert.deepEqual(llamadas, [
      tarifas.RPC_PREVIEW,
      tarifas.RPC_WRITER,
      'reconsulta-proyecto-h',
      tarifas.RPC_CAPACIDAD
    ]);
  } finally {
    if (lectorAnterior === undefined) delete global.HAIKU_CLOUDBEDS_PDF_V1;
    else global.HAIKU_CLOUDBEDS_PDF_V1 = lectorAnterior;
  }
});

test('un error writer conserva el modelo local y no intenta una reconsulta', async () => {
  const tarifas = cargarTarifas();
  const modelo = modeloSeleccionado(tarifas);
  aplicarPreviewElegible(tarifas, modelo);
  const antes = JSON.stringify(modelo);
  const llamadas = [];
  const resultado = await tarifas.ejecutarActualizacion(modelo, {
    from() { return {}; },
    async rpc(nombre) {
      llamadas.push(nombre);
      return { error: { message: 'ESTADO_DESACTUALIZADO' } };
    }
  });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.confirmacion_post_write, undefined);
  assert.equal(resultado.codigo, 'ESTADO_DESACTUALIZADO');
  assert.equal(JSON.stringify(modelo), antes);
  assert.deepEqual(llamadas, [tarifas.RPC_WRITER]);
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

test('alojamiento normal y Full Day conservan el tipo revalidado por preview', () => {
  const tarifas = cargarTarifas();
  const alojamiento = modeloSeleccionado(tarifas);
  aplicarPreviewElegible(tarifas, alojamiento);
  assert.equal(tarifas.construirPayload(alojamiento)[0].tipo_estadia, 'alojamiento');

  const fullDay = modeloSeleccionado(tarifas, {
    propuesta: {
      tipo_estadia_proyecto_h: 'fullday',
      es_full_day: true,
      total_alojamiento_propuesto: 120000,
      saldo_esperado_haku: 20000
    }
  });
  aplicarPreviewElegible(tarifas, fullDay, {
    tipo_estadia: 'fullday',
    total_objetivo: 120000,
    saldo_esperado: 20000
  });
  assert.equal(tarifas.construirPayload(fullDay)[0].tipo_estadia, 'fullday');
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

test('la confirmación post-write usa exclusivamente montos previsualizados y reconsultados', () => {
  const tarifas = cargarTarifas();
  const modeloAnterior = modeloSeleccionado(tarifas, { propuesta: {
    es_full_day: true,
    tipo_estadia_proyecto_h: 'fullday',
    total_actual_haku: 160000,
    total_alojamiento_propuesto: 120000,
    diferencia: -40000,
    pagado_actual_haku: 120000,
    saldo_actual_haku: 40000,
    saldo_esperado_haku: 0
  } });
  aplicarPreviewElegible(tarifas, modeloAnterior);
  const modeloReconsultado = tarifas.prepararModelo({ filas: [fila({
    certeza: 'SIN_CAMBIO',
    propuesta: {
      es_full_day: true,
      tipo_estadia_proyecto_h: 'fullday',
      total_actual_haku: 120000,
      total_alojamiento_propuesto: 120000,
      diferencia: 0,
      pagado_actual_haku: 120000,
      saldo_actual_haku: 0,
      saldo_esperado_haku: 0
    }
  })] }, modeloAnterior.capacidad);
  const resultado = tarifas.construirResultadoPostWrite(
    modeloAnterior,
    { modelo: modeloReconsultado },
    { resultados: [{ operacion_id: 'op-no-visible' }] }
  );
  assert.equal(resultado.confirmado, true);
  assert.deepEqual(resultado.actualizaciones[0], {
    reserva_id: modeloAnterior.items[0].fila.propuesta.reserva_id,
    estadia_id: modeloAnterior.items[0].fila.propuesta.estadia_id,
    nombre: 'Héctor Ficticio',
    total_anterior: 160000,
    total_nuevo: 120000,
    pagado: 120000,
    saldo: 0,
    certeza: 'SIN_CAMBIO',
    operacion_id: 'op-no-visible'
  });

  modeloReconsultado.resultado_post_write = { tipo: 'exito', actualizaciones: resultado.actualizaciones };
  const html = tarifas.renderizar(modeloReconsultado);
  assert.match(html, /✓<\/span><div><strong>Tarifa actualizada correctamente/);
  assert.match(html, /Proyecto H[\s\S]*\$160\.000[\s\S]*→[\s\S]*\$120\.000/);
  assert.match(html, /Pagado[\s\S]*\$120\.000/);
  assert.match(html, /Saldo[\s\S]*\$0/);
  assert.match(html, /La reserva fue reconsultada y el cambio quedó registrado\./);
  assert.match(html, /data-cloudbeds-post-write-ver-reserva/);
  assert.match(html, /data-cloudbeds-post-write-cerrar/);
  assert.doesNotMatch(html, /op-no-visible/);

  const otroAnalisis = modeloSeleccionado(tarifas);
  otroAnalisis.resultado_post_write = { tipo: 'exito', actualizaciones: resultado.actualizaciones };
  assert.equal(tarifas.seleccionar(otroAnalisis, otroAnalisis.items[0].id, false), true);
  assert.equal(otroAnalisis.resultado_post_write, null, 'iniciar otra actualización descarta el éxito anterior');
  assert.equal(tarifas.prepararModelo({ filas: [fila()] }, otroAnalisis.capacidad).resultado_post_write, null,
    'cargar un informe nuevo no hereda el éxito anterior');
});

test('un total reconsultado distinto del objetivo nunca produce tarjeta verde', () => {
  const tarifas = cargarTarifas();
  const modeloAnterior = modeloSeleccionado(tarifas);
  aplicarPreviewElegible(tarifas, modeloAnterior);
  const modeloReconsultado = tarifas.prepararModelo({ filas: [fila({ propuesta: {
    total_actual_haku: 143000,
    total_alojamiento_propuesto: 144000,
    pagado_actual_haku: 100000,
    saldo_actual_haku: 43000
  } })] }, modeloAnterior.capacidad);
  const resultado = tarifas.construirResultadoPostWrite(modeloAnterior, { modelo: modeloReconsultado }, { resultados: [{}] });
  assert.equal(resultado.confirmado, false);
  assert.match(resultado.motivo, /no coincide con el objetivo/);
  assert.doesNotMatch(tarifas.renderResultadoPostWrite({ resultado_post_write: {
    tipo: 'advertencia',
    mensaje: 'Proyecto H confirmó la operación, pero no fue posible refrescar la reserva.'
  } }), /Tarifa actualizada correctamente/);
  modeloReconsultado.resultado_post_write = {
    tipo: 'advertencia',
    mensaje: 'Proyecto H confirmó la operación, pero no fue posible refrescar la reserva.'
  };
  modeloReconsultado.actualizaciones_bloqueadas = true;
  const htmlAdvertencia = tarifas.renderizar(modeloReconsultado);
  assert.match(htmlAdvertencia, /Actualización registrada; refresco pendiente/);
  assert.match(htmlAdvertencia, /data-cloudbeds-actualizar[^>]*disabled/);
  assert.equal(tarifas.seleccionar(modeloReconsultado, modeloReconsultado.items[0].id, true), false,
    'una reconsulta no confirmada impide repetir la escritura dentro del mismo análisis');
});

test('writer ok con reconsulta fallida avisa sin éxito falso ni segundo intento de escritura', async () => {
  const tarifas = cargarTarifas();
  const modelo = modeloSeleccionado(tarifas);
  aplicarPreviewElegible(tarifas, modelo);
  const lectorAnterior = global.HAIKU_CLOUDBEDS_PDF_V1;
  const llamadas = [];
  global.HAIKU_CLOUDBEDS_PDF_V1 = { async consultar() { throw new Error('lectura ficticia fallida'); } };
  try {
    const resultado = await tarifas.ejecutarActualizacion(modelo, {
      from() { return {}; },
      async rpc(nombre) {
        llamadas.push(nombre);
        assert.equal(nombre, tarifas.RPC_WRITER);
        return { data: { ok: true, cambios: 1, resultados: [{}] } };
      }
    });
    assert.equal(resultado.ok, true);
    assert.equal(resultado.estado_final_confirmado, false);
    assert.equal(resultado.confirmacion_post_write, null);
    assert.equal(resultado.requiere_reapertura, true);
    assert.match(resultado.mensaje, /no fue posible refrescar la reserva/);
    assert.deepEqual(llamadas, [tarifas.RPC_WRITER]);
  } finally {
    if (lectorAnterior === undefined) delete global.HAIKU_CLOUDBEDS_PDF_V1;
    else global.HAIKU_CLOUDBEDS_PDF_V1 = lectorAnterior;
  }
});

test('la interacción exige preview, cancelar no escribe y el doble clic queda bloqueado', () => {
  const inicioModal = frontendSource.indexOf('async function abrirConfirmacion');
  const finModal = frontendSource.indexOf('function montar', inicioModal);
  const modal = frontendSource.slice(inicioModal, finModal);
  assert.ok(modal.indexOf('await previsualizarSeleccion') < modal.indexOf('confirmacion.hidden = false'));
  assert.match(modal, /disabled = !resultadoPreview\.ok/);

  const montaje = frontendSource.slice(frontendSource.indexOf('function montar'));
  assert.match(montaje, /if \(!boton \|\| ejecutando\) return/);
  assert.ok(montaje.indexOf('ejecutando = true') < montaje.indexOf('await ejecutarActualizacion'));
  const cancelar = montaje.slice(montaje.indexOf('data-cloudbeds-cancelar'), montaje.indexOf('data-cloudbeds-confirmar'));
  assert.match(cancelar, /\.hidden = true;[\s\S]*return;/);
  assert.doesNotMatch(cancelar, /ejecutarActualizacion|RPC_WRITER/);
  assert.match(montaje, /data-cloudbeds-post-write-ver-reserva[\s\S]*abrirReserva/);
  assert.match(montaje, /data-cloudbeds-post-write-cerrar[\s\S]*resultado_post_write = null[\s\S]*\.remove\(\)/);
});

test('los controles recuperan su estado después de una respuesta o error', () => {
  const montaje = frontendSource.slice(frontendSource.indexOf('function montar'));
  assert.match(montaje, /finally\s*\{[\s\S]*ejecutando = false;[\s\S]*elemento\.disabled = estabaDeshabilitado/);
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
