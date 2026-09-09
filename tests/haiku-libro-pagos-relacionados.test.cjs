const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function cargar(datos, scope) {
  const window = {
    HAIKU_LIBRO_PAGOS_FOCALIZADOS_V1: { estado: () => structuredClone(scope) },
    HAIKU_LIBRO_RESERVA_V1: {
      version: 'test',
      consultarHoja: async () => structuredClone(datos)
    }
  };
  const document = { addEventListener() {} };
  const context = { window, document, console, structuredClone };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-pagos-relacionados-v1.js'), 'utf8'), context);
  return window.HAIKU_LIBRO_RESERVA_V1;
}

const scopeMacarena = {
  fecha: '2026-09-03',
  texto: 'haku revisa el libro los pagos asociados a Macarena Hurtado el jueves 03 de septiembre para agregarlos al proyecto H',
  objetivos: [{ cabana: null, nombre: 'Macarena Hurtado' }]
};

test('recupera pagos del titular y fecha aunque el bloque financiero tenga otra CAB', async () => {
  const api = cargar({
    reservas: [
      { titular: 'Macarena Hurtado', cabana: 5, fecha_checkin: '2026-09-03', fecha_checkout: '2026-09-04', fechas_ocupadas: ['2026-09-03'], pagos: [], pagos_sin_asociacion: [] },
      { titular: 'Macarena Hurtado', cabana: 10, fecha_checkin: '2026-09-04', fecha_checkout: '2026-09-04', fechas_ocupadas: ['2026-09-04'], pagos: [], pagos_sin_asociacion: [] }
    ],
    pagos: [
      { titular: 'Macarena Hurtado', cabana: 1, monto: 153000, concepto: 'cab1/1noche', tipo_movimiento: 'alojamiento', fecha_comprobante: '2026-09-03', fecha_bloque: '2026-09-04', origen: { hoja: 'Sep26', celda: 'AA10:AD10' } },
      { titular: 'Macarena Hurtado', cabana: 1, monto: 40000, concepto: 'early check in', tipo_movimiento: 'otro', fecha_comprobante: '2026-09-03', fecha_bloque: '2026-09-04', origen: { hoja: 'Sep26', celda: 'AA11:AD11' } }
    ]
  }, scopeMacarena);

  const data = await api.consultarHoja('Sep26');
  const cab5 = data.reservas.find(r => r.cabana === 5);
  const cab10 = data.reservas.find(r => r.cabana === 10);
  assert.deepEqual(cab5.pagos_sin_asociacion.map(p => p.monto), [153000, 40000]);
  assert.equal(cab10.pagos_sin_asociacion.length, 0);
  assert.equal(cab5.pagos_sin_asociacion.find(p => p.monto === 40000).tipo_movimiento, 'servicio');
  assert.equal(cab5.pagos_sin_asociacion.find(p => p.monto === 40000).servicio_tipo, 'early_checkin');
});

test('recupera fecha visible cuando Excel la guardó como texto y no como fecha tipada', async () => {
  const api = cargar({
    reservas: [
      { titular: 'Macarena Hurtado', cabana: 5, fecha_checkin: '2026-09-03', fecha_checkout: '2026-09-04', fechas_ocupadas: ['2026-09-03'], pagos: [], pagos_sin_asociacion: [] },
      { titular: 'Macarena Hurtado', cabana: 10, fecha_checkin: '2026-09-04', fecha_checkout: '2026-09-04', fechas_ocupadas: ['2026-09-04'], pagos: [], pagos_sin_asociacion: [] }
    ],
    pagos: [
      { titular: 'Macarena Hurtado', cabana: 1, monto: 153000, concepto: 'cab1/1noche', tipo_movimiento: 'alojamiento', fecha_comprobante: null, fecha_bloque: '2026-09-04', texto_original: '3-9-2026 // Macarena Hurtado // Luigi Martínez // Bovtar: 173121-Folio: 000235 // CREDITO // DG // cab1/1noche // 153000', origen: { hoja: 'Sep26', celda: 'AA10:AD10' } },
      { titular: 'Macarena Hurtado', cabana: 1, monto: 40000, concepto: 'early check in', tipo_movimiento: 'otro', fecha_comprobante: null, fecha_bloque: '2026-09-04', texto_original: '3-9-2026 // Macarena Hurtado // Luigi Martínez // Bovtar: 173121-Folio: 000235 // CREDITO // DG // early check in // 40000', origen: { hoja: 'Sep26', celda: 'AA11:AD11' } }
    ]
  }, scopeMacarena);

  const data = await api.consultarHoja('Sep26');
  const cab5 = data.reservas.find(r => r.cabana === 5);
  assert.deepEqual(cab5.pagos_sin_asociacion.map(p => p.monto), [153000, 40000]);
  assert.ok(cab5.pagos_sin_asociacion.every(p => p.fecha_comprobante === '2026-09-03'));
  assert.equal(cab5.pagos_sin_asociacion.find(p => p.monto === 40000).servicio_tipo, 'early_checkin');
});

test('consulta individual con fecha exacta elimina pagos de otros días', async () => {
  const api = cargar({
    reservas: [
      { titular: 'Macarena Hurtado', cabana: 5, fecha_checkin: '2026-09-03', fecha_checkout: '2026-09-04', fechas_ocupadas: ['2026-09-03'], pagos: [], pagos_sin_asociacion: [] },
      { titular: 'Macarena Hurtado', cabana: 10, fecha_checkin: '2026-09-04', fecha_checkout: '2026-09-04', fechas_ocupadas: ['2026-09-04'], pagos: [
        { titular: 'Macarena Hurtado', monto: 100000, concepto: 'cab10/fullday', fecha_comprobante: '2026-09-04', origen: { hoja: 'Sep26', celda: 'AE20:AH20' } },
        { titular: 'Macarena Hurtado', monto: 20000, concepto: 'cab10/fullday', fecha_comprobante: '2026-09-04', origen: { hoja: 'Sep26', celda: 'AE21:AH21' } }
      ], pagos_sin_asociacion: [] }
    ],
    pagos: [
      { titular: 'Macarena Hurtado', cabana: 1, monto: 153000, concepto: 'cab1/1noche', fecha_comprobante: '2026-09-03', origen: { hoja: 'Sep26', celda: 'AA10:AD10' } }
    ]
  }, scopeMacarena);

  const data = await api.consultarHoja('Sep26');
  assert.deepEqual(data.reservas.find(r => r.cabana === 5).pagos_sin_asociacion.map(p => p.monto), [153000]);
  assert.equal(data.reservas.find(r => r.cabana === 10).pagos.length, 0);
});

test('no duplica un movimiento que ya estaba asociado a la reserva', async () => {
  const pago = { titular: 'Macarena Hurtado', cabana: 1, monto: 153000, concepto: 'cab1/1noche', fecha_comprobante: '2026-09-03', origen: { hoja: 'Sep26', celda: 'AA10:AD10' } };
  const api = cargar({
    reservas: [
      { titular: 'Macarena Hurtado', cabana: 5, fecha_checkin: '2026-09-03', fecha_checkout: '2026-09-04', fechas_ocupadas: ['2026-09-03'], pagos: [pago], pagos_sin_asociacion: [] }
    ],
    pagos: [pago]
  }, scopeMacarena);

  const data = await api.consultarHoja('Sep26');
  assert.equal(data.reservas[0].pagos.length, 1);
  assert.equal(data.reservas[0].pagos_sin_asociacion.length, 0);
});

test('si dos estadias del mismo titular abarcan la fecha no adivina el destino', async () => {
  const api = cargar({
    reservas: [
      { titular: 'Macarena Hurtado', cabana: 5, fecha_checkin: '2026-09-03', fecha_checkout: '2026-09-04', fechas_ocupadas: ['2026-09-03'], pagos: [], pagos_sin_asociacion: [] },
      { titular: 'Macarena Hurtado', cabana: 6, fecha_checkin: '2026-09-03', fecha_checkout: '2026-09-04', fechas_ocupadas: ['2026-09-03'], pagos: [], pagos_sin_asociacion: [] }
    ],
    pagos: [
      { titular: 'Macarena Hurtado', monto: 153000, concepto: 'cab1/1noche', fecha_comprobante: '2026-09-03', origen: { hoja: 'Sep26', celda: 'AA10:AD10' } }
    ]
  }, scopeMacarena);

  const data = await api.consultarHoja('Sep26');
  assert.ok(data.reservas.every(r => r.pagos_sin_asociacion.length === 0));
});
