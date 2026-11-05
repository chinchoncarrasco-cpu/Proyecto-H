/* Synthetic PostgREST fixture: no network, users or production records. */
function createFixtureClient(tables, failures = {}) {
  const reads = [], callbacks = [];
  const value = (row, field) => field.split('.').reduce((item, part) => item?.[part], row);
  const client = {
    reads, callbacks,
    from(table) {
      const filters = [], orders = []; let selected = '', single = false, start = 0, end = Infinity;
      const query = {
        select(columns) { selected = columns; return this; },
        eq(field, expected) { filters.push({ kind: 'eq', field, expected }); return this; },
        lte(field, expected) { filters.push({ kind: 'lte', field, expected }); return this; },
        gte(field, expected) { filters.push({ kind: 'gte', field, expected }); return this; },
        not(field, _operator, expected) { filters.push({ kind: 'not', field, expected }); return this; },
        order(field) { orders.push(field); return this; },
        range(from, to) { start = from; end = to; return this; },
        maybeSingle() { single = true; return this; },
        then(resolve, reject) {
          reads.push({ table, selected, filters: filters.slice(), start, end });
          if (failures[table]) return Promise.resolve({ data: null, error: { message: failures[table] } }).then(resolve, reject);
          let data = (tables[table] || []).filter(row => filters.every(filter => {
            const actual = value(row, filter.field), expected = filter.expected;
            return filter.kind === 'eq' ? actual === expected : filter.kind === 'lte' ? actual <= expected : filter.kind === 'gte' ? actual >= expected : !expected.slice(1, -1).split(',').includes(actual);
          })).slice();
          data.sort((a, b) => { for (const field of orders) { const result = String(value(a, field) || '').localeCompare(String(value(b, field) || '')); if (result) return result; } return 0; });
          data = data.slice(start, end + 1);
          return Promise.resolve({ data: single ? data.length === 1 ? data[0] : null : data, error: null }).then(resolve, reject);
        },
      }; return query;
    },
    channel() { return { on(_event, filter, fn) { callbacks.push({ ...filter, fn }); return this; }, subscribe() { return this; } }; },
    removeChannel() {},
  }; return client;
}
function contextFixtureData() {
  return {
    reserva_estadias: [
      { id: 'stay-3', reserva_id: 'reservation-3', cabana_id: 'cab-3', cabanas: { numero: 3 }, fecha_ingreso: '2026-11-03', fecha_salida: '2026-11-05', estado_estadia: 'checked_in', adultos: 2, ninos: 1, mascotas: 1 },
      { id: 'incoming-stay', reserva_id: 'incoming', cabana_id: 'cab-3', cabanas: { numero: 3 }, fecha_ingreso: '2026-11-05', fecha_salida: '2026-11-07', estado_estadia: 'confirmada', adultos: 4, ninos: 0, mascotas: 0 },
      { id: 'stay-5', reserva_id: 'reservation-5', cabana_id: 'cab-5', cabanas: { numero: 5 }, fecha_ingreso: '2026-11-04', fecha_salida: '2026-11-05', estado_estadia: 'checked_out', adultos: 2, ninos: 0, mascotas: 0 },
    ],
    servicios: [
      { id: 'tinaja', reserva_id: 'reservation-3', estadia_id: 'stay-3', fecha_servicio: '2026-11-03', hora_inicio: '18:00:00', estado_servicio: 'realizado', catalogo_servicios: { nombre: 'Tinaja' } },
      { id: 'masaje', reserva_id: 'reservation-3', estadia_id: 'stay-3', fecha_servicio: '2026-11-04', hora_inicio: '17:00:00', estado_servicio: 'cancelado', catalogo_servicios: { nombre: 'Masaje' } },
      { id: 'desayuno', reserva_id: 'reservation-3', estadia_id: 'stay-3', fecha_servicio: '2026-11-05', hora_inicio: '09:30:00', estado_servicio: 'programado', catalogo_servicios: { nombre: 'Desayuno' } },
      { id: 'another-cabin', reserva_id: 'reservation-3', estadia_id: 'sibling', fecha_servicio: '2026-11-05', hora_inicio: '16:00:00', estado_servicio: 'realizado', catalogo_servicios: { nombre: 'Otra cabaña' } },
      { id: 'incoming', reserva_id: 'incoming', estadia_id: 'incoming-stay', fecha_servicio: '2026-11-05', hora_inicio: '19:00:00', estado_servicio: 'programado', catalogo_servicios: { nombre: 'Tinaja entrante' } },
    ],
    notas: [
      { id: 'old-out', reserva_id: 'reservation-3', estadia_id: 'stay-3', cabana_id: 'cab-3', fecha_operacion: '2026-11-03', texto: 'Nota del ingreso', creado_en: '2026-11-03T18:00:00Z' },
      { id: 'current-out', reserva_id: 'reservation-3', estadia_id: 'stay-3', cabana_id: 'cab-3', fecha_operacion: '2026-11-05', texto: 'Nota de salida', creado_en: '2026-11-05T14:00:00Z' },
      { id: 'sibling-note', reserva_id: 'reservation-3', estadia_id: 'sibling', cabana_id: 'cab-6', fecha_operacion: '2026-11-05', texto: 'Nota de otra cabaña', creado_en: '2026-11-05T14:00:00Z' },
      { id: 'in-note', reserva_id: 'incoming', estadia_id: 'incoming-stay', cabana_id: 'cab-3', fecha_operacion: '2026-11-05', texto: 'Nota entrante', creado_en: '2026-11-05T14:00:00Z' },
    ],
    solicitudes: [
      { id: 'old-request', reserva_id: 'reservation-3', estadia_id: 'stay-3', cabana_id: 'cab-3', fecha_operativa: '2026-11-03', categoria: 'recambio_toallas', descripcion: 'Cambiar toallas', estado: 'completada', creado_en: '2026-11-03T18:00:00Z' },
      { id: 'current-request', reserva_id: 'reservation-3', estadia_id: 'stay-3', cabana_id: 'cab-3', fecha_operativa: '2026-11-05', categoria: 'reposicion_lena', descripcion: 'Reposición de Leña', estado: 'pendiente', creado_en: '2026-11-05T14:00:00Z' },
      { id: 'in-request', reserva_id: 'incoming', estadia_id: 'incoming-stay', cabana_id: 'cab-3', fecha_operativa: '2026-11-05', categoria: 'aseo_express', descripcion: 'Solicitud entrante', estado: 'pendiente', creado_en: '2026-11-05T14:00:00Z' },
    ],
  };
}
module.exports = { createFixtureClient, contextFixtureData };
