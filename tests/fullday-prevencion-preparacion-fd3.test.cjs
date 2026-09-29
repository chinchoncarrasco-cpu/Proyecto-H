const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const regla = require('../js/haiku-fullday-tarifa-v1');
const pdf = require('../js/haiku-cloudbeds-pdf-v1');
const tarifas = require('../js/haiku-cloudbeds-tarifas-v1');

const migration = 'supabase/migrations/20260929023216_fullday_prevencion_tarifa_explicita_fd3.sql';

function entrada(extra = {}) {
  return pdf.normalizar({
    reserva_cloudbeds: 'CB-FD-3',
    id_cloudbeds: 'RID-FD-3',
    nombre_huesped: 'Amanda Full Day',
    habitaciones_raw: 'CD5(1)',
    check_in: '28/09/2026',
    check_out: '29/09/2026',
    noches: '1',
    precio_total: '$150.000',
    deposito: '$120.000',
    saldo_pendiente: '$0',
    productos: 'Almuerzo ficticio',
    estado: 'Confirmada',
    adultos: '2',
    ninos: '0',
    ...extra
  });
}

function filaFullDay() {
  const reserva = {
    id: 'r-fd-3',
    cloudbeds_id: null,
    titular_nombre: 'Amanda Full Day',
    estado_reserva: 'confirmada',
    grupo_reserva_id: null,
    estadias: [{
      id: 'e-fd-3',
      fecha_ingreso: '2026-09-28',
      fecha_salida: '2026-09-28',
      tipo_estadia: 'fullday',
      adultos: 2,
      ninos: 0,
      mascotas: 0,
      cabanas: { numero: 5 }
    }]
  };
  return pdf.comparar([entrada()], [reserva], [{
    reserva_id: reserva.id,
    total_alojamiento: 160000,
    pagado_alojamiento: 120000,
    saldo_alojamiento: 40000
  }]).filas[0];
}

function clienteLectura({ estadiasExtra = [] } = {}) {
  const consultas = [];
  const datos = {
    reservas: {
      id: 'r-fd-3',
      titular_nombre: 'Amanda Full Day',
      titular_huesped_id: 'h-titular',
      titular_tipo_documento: 'rut',
      titular_numero_documento: '12345678K',
      correo_contacto: 'amanda@example.test',
      telefono_contacto: '+56900000000',
      observaciones: 'Dato vigente de Proyecto H',
      grupo_reserva_id: null
    },
    reserva_estadias: [{
      id: 'e-fd-3',
      reserva_id: 'r-fd-3',
      fecha_ingreso: '2026-09-28',
      fecha_salida: '2026-09-28',
      tipo_estadia: 'fullday',
      adultos: 2,
      ninos: 0,
      mascotas: 0,
      estado_estadia: 'confirmada',
      cabanas: { numero: 5 }
    }, ...estadiasExtra],
    reserva_huespedes: [
      { huesped_id: 'h-titular', huespedes: { id: 'h-titular', nombre: 'Amanda', apellido: 'Full Day' } },
      { huesped_id: 'h-acompanante', huespedes: { id: 'h-acompanante', nombre: 'Persona', apellido: 'Ficticia' } }
    ],
    vista_saldos_alojamiento_reserva: {
      reserva_id: 'r-fd-3', total_alojamiento: 160000, pagado_alojamiento: 120000, saldo_alojamiento: 40000
    }
  };

  return {
    consultas,
    from(tabla) {
      const registro = { tabla, select: '', filtros: [] };
      consultas.push(registro);
      const respuesta = () => ({ data: datos[tabla], error: null });
      const builder = {
        select(campos) { registro.select = campos; return this; },
        eq(campo, valor) { registro.filtros.push(['eq', campo, valor]); return this; },
        not(campo, operador, valor) { registro.filtros.push(['not', campo, operador, valor]); return this; },
        order(campo, opciones) { registro.orden = [campo, opciones]; return this; },
        maybeSingle() { return Promise.resolve(respuesta()); },
        then(resolve, reject) { return Promise.resolve(respuesta()).then(resolve, reject); }
      };
      return builder;
    },
    rpc() { throw new Error('FD-3 no debe invocar RPC'); }
  };
}

test('regla automática Full Day cubre 1, 2, 3 y 4 adultos sin precio de cabaña', () => {
  assert.equal(regla.resolver({ adultos: 1, ninos: 0 }).tarifa, 120000);
  assert.equal(regla.resolver({ adultos: 2, ninos: 0 }).tarifa, 120000);
  assert.equal(regla.resolver({ adultos: 3, ninos: 0 }).tarifa, 180000);
  assert.equal(regla.resolver({ adultos: 4, ninos: 0 }).tarifa, 240000);
  assert.equal(regla.resolver({ adultos: 2, ninos: 0 }).mensaje, '2 personas × $60.000 = $120.000');
});

test('niños sin tarifa manual quedan bloqueados con el mensaje acordado', () => {
  const resultado = regla.resolver({ adultos: 2, ninos: 1 });
  assert.equal(resultado.tarifa, null);
  assert.equal(resultado.bloqueada, true);
  assert.equal(resultado.mensaje,
    'No hay una regla automática definida para la tarifa Full Day con niños. Ingresa la tarifa manualmente.');
});

test('una tarifa manual válida se respeta también cuando hay niños', () => {
  const resultado = regla.resolver({ adultos: 2, ninos: 1, tarifaManual: 175000 });
  assert.equal(resultado.tarifa, 175000);
  assert.equal(resultado.fuente, 'manual');
  assert.equal(resultado.bloqueada, false);
});

test('el alta Full Day recalcula por ocupación y envía p_tarifas explícito', () => {
  const source = read('js/supabase-nueva-reserva-fullday-v1.js');
  assert.match(source, /reserva-ocupacion-adultos, \.reserva-ocupacion-ninos/);
  assert.match(source, /p_tarifas:\s*\{ \[datos\.llegada\]: datos\.tarifa \}/);
  assert.doesNotMatch(source, /precioCabana|catalogoCabanasReserva/);
});

test('la conversión/edición Full Day tampoco hereda precio_base y conserva el RPC público', () => {
  const source = read('js/supabase-edicion-pre.js');
  assert.match(source, /"haiku_modificar_reserva_completa"/);
  assert.doesNotMatch(source, /haiku_modificar_reserva_completa_core/);
  assert.doesNotMatch(source, /precioCabana|catalogoCabanasReserva/);
  assert.match(source, /p_tarifa_fullday:/);
});

test('alojamiento conserva su fallback nocturno en UI y SQL', () => {
  const app = read('js/app.js');
  const sql = read(migration);
  assert.match(app, /tarifasNochesReserva\[fechaNoche\]\s*\?\? cabana\.precio/);
  assert.match(sql, /Falta tarifa para la noche % y la CAB no tiene precio base/);
  assert.match(sql, /v_tarifa := v_precio_base/);
});

test('la migración elimina sólo el fallback Full Day y exige tarifa explícita', () => {
  const sql = read(migration);
  assert.match(sql, /No hay una regla automática definida para la tarifa Full Day con niños\. Ingresa la tarifa manualmente\./);
  assert.match(sql, /Falta tarifa explícita para el Full Day\. Ingresa una tarifa válida\./);
  assert.match(sql, /no se encontró el fallback Full Day esperado/);
  assert.doesNotMatch(sql, /raise exception 'Falta tarifa para el Full Day y la CAB no tiene precio base';\s*\n\s*end if;\s*\n\s*v_tarifa := v_precio_base;\s*\n\s*else(?![\s\S]*\$old\$)/);
});

test('la migración protege firma, SECURITY DEFINER, search_path, owner y ACL sin DML de negocio', () => {
  const sql = read(migration);
  assert.match(sql, /haiku_crear_reserva\(text,smallint,date,date,smallint,smallint,smallint,text,text,text,text,jsonb,jsonb,text,text\)/);
  assert.match(sql, /prosecdef/);
  assert.match(sql, /search_path/);
  assert.match(sql, /v_after_acl is distinct from v_previous_acl/);
  assert.match(sql, /v_after_owner is distinct from v_previous_owner/);
  assert.doesNotMatch(sql, /\b(?:insert\s+into|update\s+public\.|delete\s+from|alter\s+table)\b/i);
});

test('Cloudbeds conserva Deposit como candidato, productos separados y añade estadía verificada', () => {
  const fila = filaFullDay();
  assert.equal(fila.propuesta.estadia_id, 'e-fd-3');
  assert.equal(fila.propuesta.total_alojamiento_propuesto, 120000);
  assert.equal(fila.propuesta.precio_total_cloudbeds, 150000);
  assert.equal(fila.propuesta.componente_no_alojamiento_observable, 30000);
});

test('la preparación FD-3 sigue sin escritura directa y W1 v32 ofrece una única acción auditada', () => {
  const fila = filaFullDay();
  const capacidad = tarifas.capacidadCorreccionFullDay(fila);
  assert.equal(capacidad.certeza_cloudbeds, 'ALTA_CERTEZA');
  assert.equal(capacidad.estado, 'PREPARADA_SIN_ESCRITURA');
  assert.equal(capacidad.escritura_autorizada, false);
  const html = tarifas.renderizar(tarifas.prepararModelo({ filas: [fila] }, {
    writer_disponible: true,
    v32_disponible: true,
    servicios_separados: true,
    version: 'total1_financiero_v32',
    motivo: 'Prueba v32'
  }));
  assert.match(html, /data-cloudbeds-actualizar="r-fd-3"[^>]*>Actualizar tarifa<\/button>/);
  assert.doesNotMatch(html, /haiku-cloudbeds-tarifas-fd3|Actualizar tarifa Full Day/);
});

test('la preparación relee Proyecto H y conserva el snapshot completo para el RPC canónico', async () => {
  const cliente = clienteLectura();
  const payload = await tarifas.consultarPreparacionFullDay(filaFullDay(), cliente);
  assert.equal(payload.solo_lectura, true);
  assert.equal(payload.ejecutar, false);
  assert.equal(payload.capacidad_edicion.rpc_canonica, 'public.haiku_modificar_reserva_completa');
  assert.deepEqual(payload.identidad_verificada, { reserva_id: 'r-fd-3', estadia_id: 'e-fd-3' });
  assert.equal(payload.argumentos_rpc_futura.p_tarifa_fullday, 120000);
  assert.equal(payload.argumentos_rpc_futura.p_titular_nombre, 'Amanda Full Day');
  assert.equal(payload.argumentos_rpc_futura.p_cabana_numero, 5);
  assert.equal(payload.argumentos_rpc_futura.p_fecha_ingreso, '2026-09-28');
  assert.equal(payload.argumentos_rpc_futura.p_fecha_salida, '2026-09-28');
  assert.equal(payload.argumentos_rpc_futura.p_correo_contacto, 'amanda@example.test');
  assert.equal(payload.argumentos_rpc_futura.p_rut, '12345678K');
  assert.deepEqual(payload.argumentos_rpc_futura.p_acompanantes, ['Persona']);
  assert.deepEqual(cliente.consultas.map(item => item.tabla),
    ['reservas', 'reserva_estadias', 'reserva_huespedes', 'vista_saldos_alojamiento_reserva']);
});

test('una segunda estadía activa invalida la preparación antes de cualquier escritura', async () => {
  const cliente = clienteLectura({
    estadiasExtra: [{
      id: 'e-otra', reserva_id: 'r-fd-3', fecha_ingreso: '2026-09-30', fecha_salida: '2026-10-01',
      tipo_estadia: 'alojamiento', adultos: 2, ninos: 0, mascotas: 0, cabanas: { numero: 7 }
    }]
  });
  await assert.rejects(
    tarifas.consultarPreparacionFullDay(filaFullDay(), cliente),
    /única estadía activa coincidente/
  );
});

test('la preparación FD-3 no llama al editor directo y conserva el writer W1 activo', () => {
  const source = read('js/haiku-cloudbeds-tarifas-v1.js');
  assert.equal(tarifas.CLOUDBEDS_TARIFAS_WRITER_HABILITADO, true);
  assert.doesNotMatch(source, /\.rpc\(\s*["']haiku_modificar_reserva_completa/);
  assert.doesNotMatch(source, /\.update\(|\.insert\(/);
});

test('las otras rutas de creación siguen acotadas o envían una tarifa explícita', () => {
  const asistente = read('js/supabase-asistente-v1.js');
  const cloudbeds = read('js/supabase-asistente-listado-cloudbeds-v2.js');
  const libro = read('js/haiku-libro-consultas-v1.js');
  assert.match(asistente, /p_tipo_estadia:\s*"alojamiento"/);
  assert.match(cloudbeds, /tarifas:\s*f\.tarifas/);
  assert.match(cloudbeds, /f\.tipo_estadia === "fullday"/);
  assert.match(libro, /todavía no transporta una tarifa Full Day explícita/);
});
