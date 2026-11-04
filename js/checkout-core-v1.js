/* Shared operational checkout state. No booking, payment or housekeeping writes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HAIKU_CHECKOUT_CORE_V1 = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const key = t => [t.day, t.cabinId, t.stayId].join(':');
  function normalizeTime(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const normalized = /^\d{4}$/.test(text) ? text.slice(0, 2) + ':' + text.slice(2) : text;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) throw new Error('Escribe una hora válida: hh:mm.');
    return normalized;
  }
  function empty(t) { return { fecha_operativa: t.day, cabana_id: t.cabinId, estadia_id: t.stayId, hora_out: null,
    hora_out_definida: false, encargado: '', recuperados: [], chequeados: [], revision: 0 }; }
  function validate(row, t) {
    if (!row || typeof row.cabana_id !== 'string' || !row.cabana_id || typeof row.estadia_id !== 'string' || !row.estadia_id || row.fecha_operativa !== t.day || row.cabana_id !== t.cabinId || row.estadia_id !== t.stayId
      || typeof row.encargado !== 'string' || typeof row.hora_out_definida !== 'boolean'
      || !Array.isArray(row.recuperados) || !Array.isArray(row.chequeados) || !Number.isSafeInteger(Number(row.revision))
      || Number(row.revision) < 1 || (row.hora_out !== null && !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(row.hora_out))) {
      throw new Error('La revisión recibida no corresponde a esta cabaña, estadía y fecha.');
    }
    return { ...row, revision: Number(row.revision) };
  }
  function patch(row, field, value) {
    if (field === 'hora_out') return { ...row, hora_out: value || null, hora_out_definida: true };
    if (field === 'encargado') return { ...row, encargado: value };
    const column = field === 'recuperado' ? 'recuperados' : 'chequeados';
    const selected = new Set(row[column]);
    if (value.checked) selected.add(value.id); else selected.delete(value.id);
    return { ...row, [column]: [...selected] };
  }
  function createCheckoutStore(options) {
    const records = new Map(), pending = new Map(), tails = new Map(), listeners = new Set(), errors = new Map();
    let disposed = false, loading = null, readId = 0, readError = null;
    const state = { ready: false, loading: false, error: null, canEdit: false };
    const updateError = () => { state.error = readError || [...errors.values()].pop() || null; };
    const alive = () => !disposed && options.isCurrent();
    const emit = () => { if (alive()) for (const fn of listeners) fn(); };
    function accept(row) {
      const t = { day: row.fecha_operativa, cabinId: row.cabana_id, stayId: row.estadia_id };
      validate(row, t);
      const current = records.get(key(t));
      if (!current || Number(row.revision) >= current.revision) records.set(key(t), { ...row, revision: Number(row.revision) });
    }
    async function refresh() {
      if (!alive()) return;
      const request = ++readId;
      state.loading = true; emit();
      try {
        const result = await options.read(options.day);
        if (!alive() || request !== readId) return;
        if (result.fecha !== options.day || !Array.isArray(result.revisiones) || typeof result.puede_editar !== 'boolean') throw new Error('La lectura de salidas no es válida.');
        for (const row of result.revisiones) {
          if (row.fecha_operativa !== options.day) throw new Error('La revisión pertenece a otra fecha.');
          accept(row);
        }
        state.ready = true; state.canEdit = result.puede_editar; readError = null; updateError();
      } catch (e) { if (alive() && request === readId) { readError = e.message || String(e); updateError(); } }
      finally { if (alive() && request === readId) { state.loading = false; emit(); } }
    }
    const store = {
      state,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      ensure() { if (!state.ready && !loading) loading = refresh().finally(() => { loading = null; }); return loading || Promise.resolve(); },
      refresh,
      view(t) {
        let row = records.get(key(t)) || empty(t);
        for (const p of pending.values()) if (key(p.target) === key(t)) row = patch(row, p.field, p.value);
        return row;
      },
      saving(t) { return [...pending.values()].some(p => key(p.target) === key(t)); },
      set(t, field, value) {
        if (!alive() || t.day !== options.day) return Promise.reject(new Error('La fecha o la sesión cambió. Abre nuevamente la revisión.'));
        if (!state.ready || !state.canEdit) return Promise.reject(new Error('Tu usuario no puede editar la revisión de salida.'));
        if (!['hora_out', 'encargado', 'recuperado', 'chequeado'].includes(field)) return Promise.reject(new Error('Campo de salida no válido.'));
        if (field === 'hora_out') { try { value = normalizeTime(value); } catch (e) { return Promise.reject(e); } }
        else if (field === 'encargado') { value = String(value || '').trim(); if (value.length > 120) return Promise.reject(new Error('El nombre es demasiado largo.')); }
        else if (!value || !/^[a-z][a-z0-9_]{0,63}$/.test(value.id) || typeof value.checked !== 'boolean') return Promise.reject(new Error('Ítem no válido.'));
        const targetKey = key(t), fieldKey = targetKey + ':' + field + (typeof value === 'object' ? ':' + value.id : ''), token = {};
        pending.set(fieldKey, { target: t, field, value, token }); errors.delete(fieldKey); updateError(); emit();
        const task = (tails.get(targetKey) || Promise.resolve()).catch(() => undefined).then(async () => {
          if (!alive()) throw new Error('La fecha o la sesión cambió.');
          if (pending.get(fieldKey)?.token !== token) return;
          const response = await options.write(t, field, value);
          const row = Array.isArray(response) ? response.length === 1 ? response[0] : null : response;
          validate(row, t);
          if (!alive()) return;
          accept(row);
          if (pending.get(fieldKey)?.token === token) { pending.delete(fieldKey); errors.delete(fieldKey); }
          updateError(); emit();
          return row;
        }).catch(e => {
          if (alive()) { if (pending.get(fieldKey)?.token === token) { pending.delete(fieldKey); errors.set(fieldKey, e.message || String(e)); } updateError(); emit(); }
          throw e;
        }).finally(() => { if (tails.get(targetKey) === task) tails.delete(targetKey); });
        tails.set(targetKey, task);
        return task;
      },
      dispose() { disposed = true; listeners.clear(); readId++; },
    };
    return store;
  }
  return { createCheckoutStore, normalizeTime, key };
});
