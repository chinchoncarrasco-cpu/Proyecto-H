/* Read-only cabin context. Shared by Web and Mobile; no operational refreshes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HAIKU_CABIN_CONTEXT_V1 = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const requestLabels = { aseo_express: 'Solicita Express', reposicion_carbon: 'Reposición de Carbón', reposicion_lena: 'Reposición de Leña', recambio_toallas: 'Recambio de Toallas', recambio_sabanas: 'Recambio de Sábanas', recambio_ropa_cama: 'Recambio de Ropa Completa de Cama' };
  const serviceStates = { programado: 'Programado', en_proceso: 'En curso', realizado: 'Realizado', cancelado: 'Cancelado', no_show: 'No asistió' };
  const requestStates = { pendiente: 'Pendiente', en_proceso: 'En curso', completada: 'Completada', cancelada: 'Cancelada' };
  const count = value => Number.isInteger(value) && value >= 0 ? value : null;
  const text = value => typeof value === 'string' ? value.trim() : '';
  const shortDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.slice(8, 10) + '/' + value.slice(5, 7) : '';
  const key = (owner, target) => JSON.stringify([owner, target.scope, target.day, target.stayId || '', target.reservationId || '', target.cabinId || '', target.cabinNumber]);
  const belongs = (row, stay) => row.reserva_id === stay.reserva_id && (!row.estadia_id || row.estadia_id === stay.id) && (!row.cabana_id || row.cabana_id === stay.cabana_id);

  async function rows(query) {
    const result = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await query.range(offset, offset + 499);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('El contexto devolvió una respuesta no válida.');
      result.push(...data);
      if (data.length < 500) return result;
    }
  }
  async function readStayContext(client, target) {
    if (!client || !target.day || !['day', 'stay'].includes(target.scope) || (!target.stayId && !target.reservationId) || (target.scope === 'stay' && !target.stayId)) throw new Error('La estadía no está identificada.');
    const byNumber = !target.cabinId;
    let query = client.from('reserva_estadias').select('id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,adultos,ninos,mascotas' + (byNumber ? ',cabanas!inner(numero)' : ''));
    if (target.stayId) query = query.eq('id', target.stayId);
    if (target.reservationId) query = query.eq('reserva_id', target.reservationId);
    query = byNumber ? query.eq('cabanas.numero', target.cabinNumber) : query.eq('cabana_id', target.cabinId);
    if (!target.stayId) query = query.lte('fecha_ingreso', target.day).gte('fecha_salida', target.day).not('estado_estadia', 'in', '(cancelada,no_show)');
    const { data: stay, error } = await query.maybeSingle();
    if (error) throw error;
    if (!stay || !stay.id || !stay.reserva_id || !stay.cabana_id || (target.stayId && stay.id !== target.stayId) || (target.reservationId && stay.reserva_id !== target.reservationId) || (target.cabinId && stay.cabana_id !== target.cabinId)) throw new Error('No se pudo verificar la estadía de esta cabaña.');
    if (byNumber && (Array.isArray(stay.cabanas) ? stay.cabanas[0] : stay.cabanas)?.numero !== Number(target.cabinNumber)) throw new Error('La estadía no corresponde a esta cabaña.');
    const tasks = {
      services: () => {
        let services = client.from('servicios').select('id,reserva_id,estadia_id,fecha_servicio,hora_inicio,estado_servicio,catalogo_servicios(nombre)').eq('reserva_id', stay.reserva_id).order('fecha_servicio', { ascending: true }).order('hora_inicio', { ascending: true }).order('id', { ascending: true });
        if (target.scope === 'day') services = services.eq('fecha_servicio', target.day);
        return rows(services);
      },
    };
    if (target.scope === 'stay') {
      tasks.notes = () => rows(client.from('notas').select('id,reserva_id,estadia_id,cabana_id,fecha_operacion,texto').eq('reserva_id', stay.reserva_id).order('creado_en', { ascending: true }).order('id', { ascending: true }));
      tasks.requests = () => rows(client.from('solicitudes').select('id,reserva_id,estadia_id,cabana_id,fecha_operativa,categoria,descripcion,estado').eq('reserva_id', stay.reserva_id).order('creado_en', { ascending: true }).order('id', { ascending: true }));
    }
    const result = { ...target, stayId: stay.id, reservationId: stay.reserva_id, cabinId: stay.cabana_id,
      occupancy: { adults: count(stay.adultos), children: count(stay.ninos), pets: count(stay.mascotas) }, services: [], notes: [], requests: [], unavailable: [] };
    await Promise.all(Object.entries(tasks).map(async ([section, read]) => {
      try { result[section] = (await read()).filter(row => belongs(row, stay)); }
      catch (_) { result.unavailable.push(section); }
    }));
    return result;
  }
  function occupancyLabel(occupancy) {
    if (!occupancy) return '';
    const adults = count(occupancy.adults), children = count(occupancy.children), pets = count(occupancy.pets);
    const parts = [];
    if (adults !== null && children !== null) { const total = adults + children; parts.push(total + (total === 1 ? ' persona' : ' personas')); }
    parts.push(adults === null ? 'Adultos: sin dato' : adults + (adults === 1 ? ' adulto' : ' adultos'));
    parts.push(children === null ? 'Niños: sin dato' : children + (children === 1 ? ' niño' : ' niños'));
    parts.push(pets === null ? 'Mascotas: sin dato' : pets === 0 ? 'Sin mascotas' : pets + (pets === 1 ? ' mascota' : ' mascotas'));
    return parts.join(' · ');
  }
  function requestText(row) {
    const category = row.categoria || row.category, description = text(row.descripcion || row.description);
    const title = requestLabels[category] || description || text(category) || 'Solicitud';
    return title + (description && description !== title ? ': ' + description : '');
  }
  function contextLines(data, fallback = {}) {
    const historical = data?.scope === 'stay';
    const notes = data?.notes || [], requests = data?.requests || [];
    const noteTexts = new Set(notes.map(row => text(row.texto)));
    return {
      services: (data?.services || []).map(row => {
        const catalog = Array.isArray(row.catalogo_servicios) ? row.catalogo_servicios[0] : row.catalogo_servicios;
        return [text(catalog?.nombre) || 'Servicio', historical ? shortDate(row.fecha_servicio) : '', text(row.hora_inicio).slice(0, 5), serviceStates[row.estado_servicio] || text(row.estado_servicio)].filter(Boolean).join(' · ');
      }),
      requests: [...requests.map(row => [requestText(row), historical ? shortDate(row.fecha_operativa) : '', historical ? requestStates[row.estado] || text(row.estado) : ''].filter(Boolean).join(' · ')),
        ...(fallback.requests || []).filter(row => !requests.some(other => row.id && row.id === other.id || (row.categoria || row.category) === other.categoria && text(row.descripcion || row.description) === text(other.descripcion))).map(requestText)],
      notes: [...notes.filter(row => text(row.texto)).map(row => [historical ? shortDate(row.fecha_operacion) : '', text(row.texto)].filter(Boolean).join(' · ')),
        ...[...new Set((fallback.notes || []).map(text).filter(value => value && !noteTexts.has(value)))]],
    };
  }
  function createContextCache({ read = readStayContext, now = Date.now, ttl = 60000 } = {}) {
    const entries = new Map();
    return {
      load(client, owner, target, force = false) {
        const id = key(owner, target), old = entries.get(id);
        if (old && (old.pending || !force && now() - old.created < ttl)) return old.promise;
        const entry = { owner, target, pending: true, created: now(), promise: null };
        entry.promise = Promise.resolve().then(() => read(client, target)).then(data => { entry.pending = false; entry.data = data; return data; }, error => { if (entries.get(id) === entry) entries.delete(id); throw error; });
        entries.set(id, entry); return entry.promise;
      },
      invalidate(owner, reservationId) { for (const [id, entry] of entries) if (entry.owner === owner && (!reservationId || entry.target.reservationId === reservationId || entry.data?.reservationId === reservationId)) entries.delete(id); },
      clear() { entries.clear(); },
    };
  }
  return Object.freeze({ readStayContext, occupancyLabel, requestText, contextLines, createContextCache, key });
});
