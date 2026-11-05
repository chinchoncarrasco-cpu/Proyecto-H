/* Updates only the read-only header, independently from the operation/checklist. */
(() => {
  'use strict';
  const V = window.HAIKU_CABIN_CONTEXT_V1, cache = V.createContextCache(), states = new Set(), byHost = new WeakMap();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function dispose(state) {
    state.version++; states.delete(state);
    if (byHost.get(state.host) === state) {
      byHost.delete(state.host); state.host.innerHTML = '';
      if (state.options.occupancy) state.options.occupancy.textContent = '';
    }
    state.host.removeEventListener('click', state.retry);
    if (state.channel) { void state.options.client?.removeChannel(state.channel); state.channel = null; }
  }
  function current(state) { return byHost.get(state.host) === state && state.host.isConnected && state.owner === state.options.user() && state.day === state.options.date(); }
  function linesHTML(lines, type) {
    return lines.length ? `<div class="cb-${type}-summary">${lines.map(line => `<span class="cb-${type}-summary-item">${esc(line)}</span>`).join('')}</div>` : '';
  }
  function paint(state) {
    if (!current(state)) return;
    const { occupancy, target, fallbackHTML = '', fallback = {} } = state.options;
    if (occupancy) {
      occupancy.hidden = !target;
      occupancy.textContent = state.data ? V.occupancyLabel(state.data.occupancy) : state.error ? 'Personas: no disponible' : 'Personas: cargando…';
    }
    const lines = V.contextLines(state.data, fallback);
    let html = !state.data || target.scope === 'day' ? linesHTML(lines.services, 'service') + fallbackHTML
      : linesHTML(lines.services, 'service') + linesHTML(lines.requests, 'request') + linesHTML(lines.notes, 'note');
    const unavailable = state.data?.unavailable.map(section => ({ services: 'Servicios', notes: 'Notas', requests: 'Solicitudes' })[section]) || [];
    if (state.error || unavailable.length) html += `<div class="cb-context-notice"><span>${state.error ? 'Contexto no disponible.' : esc(unavailable.join(' · ')) + ': no disponible.'}</span><button type="button" data-cabin-context-retry>Reintentar</button></div>`;
    state.host.innerHTML = html; state.host.hidden = !html;
  }
  function subscribe(state) {
    const { client, target } = state.options, reservationId = state.data.reservationId;
    if (!client.channel || state.channel || !reservationId) return;
    const refresh = () => {
      if (!current(state)) { dispose(state); return; }
      cache.invalidate(state.owner, reservationId); load(state, true);
    };
    let channel = client.channel('cabin-context-web:' + state.identity);
    for (const table of ['servicios', ...(target.scope === 'stay' ? ['notas', 'solicitudes'] : [])]) channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: 'reserva_id=eq.' + reservationId }, refresh);
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'reserva_estadias', filter: 'id=eq.' + state.data.stayId }, refresh).subscribe();
    state.channel = channel;
  }
  function load(state, force = false) {
    const version = ++state.version;
    void cache.load(state.options.client, state.owner, state.options.target, force).then(data => {
      if (!current(state) || state.version !== version) return;
      state.data = data; state.error = false; paint(state); subscribe(state);
    }, () => {
      if (!current(state) || state.version !== version) return;
      state.error = true; paint(state);
    });
  }
  function render(host, options) {
    if (!host) return;
    for (const state of states) if (!state.host.isConnected) dispose(state);
    const old = byHost.get(host), owner = options.user(), day = options.date();
    if (!options.target || !owner || !options.client) {
      if (old) dispose(old);
      host.innerHTML = owner ? options.fallbackHTML || '' : ''; host.hidden = !host.innerHTML;
      if (options.occupancy) { options.occupancy.textContent = ''; options.occupancy.hidden = true; }
      return;
    }
    const identity = V.key(owner, options.target);
    if (old?.identity === identity) { old.options = options; paint(old); return; }
    if (old) dispose(old);
    const state = { host, options, identity, owner, day, data: null, error: false, version: 0, channel: null, retry: null };
    state.retry = event => { if (event.target.closest('[data-cabin-context-retry]')) { cache.invalidate(owner, options.target.reservationId); load(state, true); } };
    host.addEventListener('click', state.retry); states.add(state); byHost.set(host, state); paint(state); load(state);
  }
  function clear(root) { for (const state of states) if (!root || root.contains(state.host)) { state.host.innerHTML = ''; if (state.options.occupancy) state.options.occupancy.textContent = ''; dispose(state); } }
  window.addEventListener('haiku:auth-ready', () => { for (const state of states) if (state.options.user() !== state.owner) clear(state.host); });
  window.HAIKU_CABIN_CONTEXT_UI_V1 = Object.freeze({ render, clear });
})();
