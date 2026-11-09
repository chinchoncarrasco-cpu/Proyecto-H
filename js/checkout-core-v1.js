/* Shared operational checkout state. No booking, payment or housekeeping writes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./checkout-workflow-v2.js'));
  else root.HAIKU_CHECKOUT_CORE_V1 = factory(root.HAIKU_CHECKOUT_WORKFLOW_V2);
})(typeof globalThis === 'object' ? globalThis : this, function (workflow) {
  const key = t => [t.day, t.cabinId, t.stayId].join(':');
  function normalizeTime(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const normalized = /^\d{4}$/.test(text) ? text.slice(0, 2) + ':' + text.slice(2) : text;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) throw new Error('Escribe una hora válida: hh:mm.');
    return normalized;
  }
  function empty(t) { return { fecha_operativa: t.day, cabana_id: t.cabinId, estadia_id: t.stayId, hora_out: null,
    hora_out_definida: false, encargado: '', recuperados: [], chequeados: [], revision: 0,
    reposiciones: {}, observaciones: {}, detalles: {}, conteos: {}, prestamos: {}, revision_estado: 'pendiente' }; }
  function validate(row, t) {
    if (!row || typeof row.cabana_id !== 'string' || !row.cabana_id || typeof row.estadia_id !== 'string' || !row.estadia_id || row.fecha_operativa !== t.day || row.cabana_id !== t.cabinId || row.estadia_id !== t.stayId
      || typeof row.encargado !== 'string' || typeof row.hora_out_definida !== 'boolean'
      || !Array.isArray(row.recuperados) || !Array.isArray(row.chequeados) || !Number.isSafeInteger(Number(row.revision))
      || Number(row.revision) < 1 || (row.hora_out !== null && !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(row.hora_out))) {
      throw new Error('La revisión recibida no corresponde a esta cabaña, estadía y fecha.');
    }
    for (const field of ['reposiciones', 'observaciones', 'detalles', 'conteos']) if (row[field] !== undefined && (!row[field] || typeof row[field] !== 'object' || Array.isArray(row[field]))) throw new Error('El detalle de la revisión no es válido.');
    return { ...row, revision: Number(row.revision), reposiciones: row.reposiciones || {}, observaciones: row.observaciones || {}, detalles: row.detalles || {}, revision_estado: row.revision_estado || 'pendiente' };
  }
  function patch(row, field, value) {
    if (field === 'hora_out') return { ...row, hora_out: value || null, hora_out_definida: true };
    if (field === 'encargado') return { ...row, encargado: value };
    if (['punto', 'conteo', 'reposicion', 'observacion', 'detalle', 'detalle_foto', 'revision_estado', 'prestamo', 'devolucion'].includes(field)) return workflow.patchWorkflow(row, field, value);
    const column = field === 'recuperado' ? 'recuperados' : 'chequeados';
    const selected = new Set(row[column]);
    if (value.checked) selected.add(value.id); else selected.delete(value.id);
    return { ...row, [column]: [...selected] };
  }
  function createCheckoutStore(options) {
    const drafts = new Map();
    const records = new Map(), loanRecords = new Map(), notes = new Map(), pending = new Map(), tails = new Map(), listeners = new Set(), errors = new Map();
    let disposed = false, loading = null, readId = 0, readError = null;
    const state = { ready: false, loading: false, error: null, canEdit: false };
    const updateError = () => { state.error = readError || [...errors.values()].pop() || null; };
    const alive = () => !disposed && options.isCurrent();
    const emit = () => { if (alive()) for (const fn of listeners) fn(); };
    function accept(row) {
      const t = { day: row.fecha_operativa, cabinId: row.cabana_id, stayId: row.estadia_id };
      const normalized = validate(row, t);
      const current = records.get(key(t));
      if (!current || Number(row.revision) >= current.revision) records.set(key(t), normalized);
    }
    function acceptLoans(row, expectedStay) {
      if (!row || typeof row.estadia_id !== 'string' || (expectedStay && row.estadia_id !== expectedStay) || !row.items || typeof row.items !== 'object' || Array.isArray(row.items) || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 0) throw new Error('Los préstamos no corresponden a esta estadía.');
      const current = loanRecords.get(row.estadia_id);
      if (!current || Number(row.revision) >= Number(current.revision)) loanRecords.set(row.estadia_id, { ...row, revision: Number(row.revision) });
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
        if (result.prestamos !== undefined && !Array.isArray(result.prestamos)) throw new Error('La lectura de préstamos no es válida.');
        for (const row of result.prestamos || []) acceptLoans(row);
        for (const row of result.notas_prestamos || []) {
          if (typeof row.estadia_id !== 'string' || !Array.isArray(row.textos) || row.textos.some(t => typeof t !== 'string')) throw new Error('Las notas de préstamos no son válidas.');
          notes.set(row.estadia_id, row.textos);
        }
        state.ready = true; state.canEdit = result.puede_editar; readError = null; updateError();
      } catch (e) { if (alive() && request === readId) { readError = e.message || String(e); updateError(); } }
      finally { if (alive() && request === readId) { state.loading = false; emit(); } }
    }
    const store = {
      state,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      ensure() { if (!state.ready && !loading) loading = refresh().finally(() => { loading = null; }); return loading || Promise.resolve(); },
      refresh() { if (!loading) loading = refresh().finally(() => { loading = null; }); return loading; },
      receive(row) { if (!alive() || row?.fecha_operativa !== options.day) return false; try { accept(row); emit(); return true; } catch (_) { return false; } },
      receiveLoans(row) { if (!alive()) return false; try { acceptLoans(row); emit(); return true; } catch (_) { return false; } },
      view(t) {
        let row = { ...(records.get(key(t)) || empty(t)), prestamos: loanRecords.get(t.stayId)?.items || {}, notas_prestamos: notes.get(t.stayId) || [] };
        for (const p of pending.values()) if (key(p.target) === key(t)) row = patch(row, p.field, p.value);
        for (const draft of drafts.values()) if (key(draft.target) === key(t)) row = workflow.patchWorkflow(row, 'detalle', { id: draft.id, texto: draft.text });
        return row;
      },
      focusDetail(t, id) {
        const draft = drafts.get(key(t) + ':' + id);
        if (draft) draft.focused = true;
      },
      editDetail(t, id, text) {
        if (!alive() || t.day !== options.day || !state.ready || !state.canEdit) return;
        workflow.validateMutation('detalle', { id, texto: text });
        const draftKey = key(t) + ':' + id;
        let draft = drafts.get(draftKey);
        if (!draft) { draft = { target: { ...t }, id, text, version: 0, dirty: false, focused: true, timer: null, inflight: null }; drafts.set(draftKey, draft); }
        clearTimeout(draft.timer); draft.text = text; draft.version++; draft.dirty = true;
        draft.timer = setTimeout(() => { draft.timer = null; void store.flushDetail(t, id).catch(() => undefined); }, 600);
        emit();
      },
      blurDetail(t, id) {
        const draft = drafts.get(key(t) + ':' + id); if (draft) draft.focused = false;
        return store.flushDetail(t, id);
      },
      async flushDetail(t, id) {
        const draftKey = key(t) + ':' + id, draft = drafts.get(draftKey);
        if (!draft) return;
        clearTimeout(draft.timer); draft.timer = null;
        if (draft.inflight) { await draft.inflight; if (draft.dirty) return store.flushDetail(t, id); return; }
        if (!draft.dirty) { if (!draft.focused) drafts.delete(draftKey); return; }
        const version = draft.version, text = draft.text;
        const task = store.set(t, 'detalle', { id, texto: text }).then(() => {
          if (draft.version === version) draft.dirty = false;
        }).finally(() => {
          if (draft.inflight === task) draft.inflight = null;
          if (!draft.dirty && !draft.focused && drafts.get(draftKey) === draft) drafts.delete(draftKey);
          emit();
        });
        draft.inflight = task;
        await task;
        if (draft.dirty) return store.flushDetail(t, id);
      },
      async flushDetails(t) {
        do { for (const sector of workflow.sectors) await store.flushDetail(t, sector.id); }
        while ([...drafts.values()].some(d => key(d.target) === key(t) && (d.dirty || d.inflight)));
      },
      async flush(t) {
        await store.flushDetails(t);
        while (tails.has(key(t))) await tails.get(key(t));
        const error = [...errors].find(([id]) => id.startsWith(key(t) + ':'));
        if (error) throw new Error(error[1]);
      },
      saving(t) { return [...pending.values()].some(p => key(p.target) === key(t)) || [...drafts.values()].some(d => key(d.target) === key(t) && (d.dirty || d.inflight)); },
      set(t, field, value) {
        if (!alive() || t.day !== options.day) return Promise.reject(new Error('La fecha o la sesión cambió. Abre nuevamente la revisión.'));
        if (!state.ready || !state.canEdit) return Promise.reject(new Error('Tu usuario no puede editar la revisión de salida.'));
        if (!['punto', 'conteo', 'hora_out', 'encargado', 'recuperado', 'chequeado', 'reposicion', 'observacion', 'detalle', 'detalle_foto', 'revision_estado', 'prestamo', 'devolucion'].includes(field)) return Promise.reject(new Error('Campo de salida no válido.'));
        if (field === 'hora_out') { try { value = normalizeTime(value); } catch (e) { return Promise.reject(e); } }
        else if (field === 'encargado') { value = String(value || '').trim(); if (value.length > 120) return Promise.reject(new Error('El nombre es demasiado largo.')); }
        else if (field === 'recuperado' || field === 'chequeado') { if (!value || !/^[a-z][a-z0-9_]{0,63}$/.test(value.id) || typeof value.checked !== 'boolean') return Promise.reject(new Error('Ítem no válido.')); }
        else { try { workflow.validateMutation(field, value); } catch (e) { return Promise.reject(e); } }
        if (['punto', 'conteo'].includes(field) && store.view(t).revision_estado === 'revisada') return Promise.reject(new Error('Reabre la revisión para cambiar los checks.'));
        if (field === 'revision_estado' && value === 'revisada' && !workflow.sectors.every(s => workflow.sectorProgress(store.view(t), s.id).complete)) return Promise.reject(new Error('Completa los checks de los cuatro sectores.'));
        if (typeof value === 'object') value = JSON.parse(JSON.stringify(value));
        const itemKey = field === 'reposicion' ? Object.keys(value.items).sort().join('_') : typeof value === 'object' ? value.id : '';
        const targetKey = key(t), fieldKey = targetKey + ':' + field + ':' + itemKey, token = {};
        pending.set(fieldKey, { target: t, field, value, token }); errors.delete(fieldKey); updateError(); emit();
        const task = (tails.get(targetKey) || Promise.resolve()).catch(() => undefined).then(async () => {
          if (!alive()) throw new Error('La fecha o la sesión cambió.');
          if (pending.get(fieldKey)?.token !== token) return;
          const response = await options.write(t, field, value);
          const row = Array.isArray(response) ? response.length === 1 ? response[0] : null : response;
          if (field === 'prestamo' || field === 'devolucion') acceptLoans(row, t.stayId); else validate(row, t);
          if (!alive()) return;
          if (field !== 'prestamo' && field !== 'devolucion') accept(row);
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
      dispose() { disposed = true; for (const draft of drafts.values()) clearTimeout(draft.timer); drafts.clear(); listeners.clear(); readId++; },
    };
    return store;
  }
  return { createCheckoutStore, normalizeTime, key };
});
