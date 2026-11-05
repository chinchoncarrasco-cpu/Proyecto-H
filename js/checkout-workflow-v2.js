/* Shared checkout rules. Pure functions; no network, timers or application events. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HAIKU_CHECKOUT_WORKFLOW_V2 = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const sectors = [
    { id: 'cocina', label: 'COCINA', title: 'Cocina', points: 'Loza · Refri · Perillas · Llave de gas · Piso', supplies: ['sal', 'aceite', 'te', 'cafe', 'te_hierbas', 'azucar', 'servilletas'] },
    { id: 'bano', label: 'BAÑO', title: 'Baño', points: 'Secador · Toallas · Ducha · WC · Cortina / Alfombra · Piso', supplies: ['amenities', 'jabon_liquido', 'papel_higienico'] },
    { id: 'living', label: 'LIVING / CAMA', title: 'Living', points: 'Cama / Debajo · Cajones / Clóset · Controles · TV · AC · Salamandra · Manilla · Ventanales / Cortinas · Piso', supplies: ['lena', 'diario'] },
    { id: 'terraza', label: 'TERRAZA', title: 'Terraza', points: 'Fogón · Atizador / Pala · Escobillón · Mesa / Sillas · Cojines · Jardineras · Piso', supplies: ['carbon'] },
  ];
  const supplies = [
    ['sal', 'Sal', 'cocina'], ['aceite', 'Aceite', 'cocina'], ['te', 'Té', 'cocina', true],
    ['cafe', 'Café', 'cocina', true], ['te_hierbas', 'Té hierbas', 'cocina', true],
    ['azucar', 'Azúcar', 'cocina'], ['servilletas', 'Servilletas', 'cocina'],
    ['champu', 'Champú', 'bano', true], ['jabon', 'Jabón', 'bano', true], ['balsamo', 'Bálsamo', 'bano', true],
    ['jabon_liquido', 'Jabón liq.', 'bano'], ['papel_higienico', 'P.H.', 'bano'],
    ['lena', 'Leña', 'living'], ['diario', 'Diario', 'living'], ['carbon', 'Carbón', 'terraza'],
  ].map(([id, label, area, countable]) => ({ id, label, area, countable: Boolean(countable) }));
  const amenities = ['champu', 'jabon', 'balsamo'];
  const catalog = [
    ['sacacorchos', 'Sacacorcho', 'cocina', 'sacacorchos?'],
    ['cenicero', 'Cenicero', 'cocina', 'ceniceros?'],
    ['asado', 'Asado', 'terraza', '(?:articulos?|utensilios?|implementos?|kit|set)(?:\\s+(?:de|para))?\\s+asado|(?:pinzas?|tenazas?)\\s+(?:de|para)\\s+asado'],
    ['batas', 'Batas', 'bano', 'batas?'],
    ['juegos_mesa', 'Juegos de mesa', 'living', 'juegos?(?:\\s+de)?\\s+mesa'],
    ['sal_mar', 'Sal de mar', 'cocina', 'sal\\s+(?:de\\s+)?mar'],
    ['vasos', 'Vasos', 'cocina', 'vasos?'],
    ['paraguas', 'Paraguas', 'living', 'paraguas'],
    ['trapero', 'Trapero', 'living', 'traperos?'],
  ].map(([id, label, area, pattern]) => ({ id, label, area, pattern }));
  const observationTypes = [{ id: 'dano', label: 'Daño' }, { id: 'faltante', label: 'Faltante' }, { id: 'olvido', label: 'Olvido' }, { id: 'mantencion', label: 'Mantención' }];
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const safeId = id => typeof id === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id);
  const units = (value, min = 0) => Number.isInteger(value) && value >= min && value <= 99;
  const words = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
  function detectLoans(notes) {
    const found = new Map();
    for (const note of notes || []) {
      for (const raw of normalize(typeof note === 'string' ? note : note.text || note.texto).split(/[;,\n.]+/)) {
        if (/\b(?:no\s+(?:(?:se\s+)?(?:presto|prestaron|entrego|entregaron|dejar|entregar)|hay|llevar)|sin\s+(?:batas?|prestamos?))\b/.test(raw)) continue;
        for (const item of catalog) {
          // Glassware only becomes a loan when an actual lending action is stated.
          if (item.id === 'vasos' && !/\b(?:prest|entreg|dejar|adicional|extra)/.test(raw)) continue;
          const match = new RegExp('\\b(?:' + item.pattern + ')\\b').exec(raw);
          if (!match) continue;
          const before = raw.slice(0, match.index).match(/(?:^|\s)(\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(?:x\s*)?$/);
          const after = raw.slice(match.index + match[0].length).match(/^\s*(?:[:x=]\s*|\(\s*)(\d{1,2})(?:\b|\))/);
          const token = before?.[1] || after?.[1];
          const quantity = token ? (words[token] || Number(token)) : null;
          const old = found.get(item.id);
          // Repeated summary notes describe the same loan; never add them together.
          found.set(item.id, { id: item.id, label: item.label, area: item.area, cantidad: old && old.cantidad !== quantity ? null : units(quantity, 1) ? quantity : null, devueltos: 0, origen: 'notas', descartado: false });
        }
      }
    }
    return [...found.values()];
  }
  function loansFor(notes, stored = {}, recovered = []) {
    const result = new Map(detectLoans(notes).map(item => [item.id, item]));
    for (const [id, value] of Object.entries(stored || {})) {
      if (safeId(id) && value && typeof value === 'object') result.set(id, { ...result.get(id), ...value, id });
    }
    return [...result.values()].filter(item => !item.descartado).map(item => ({ ...item,
      devueltos: Math.min(item.cantidad || 0, Number.isInteger(item.devueltos) ? item.devueltos : recovered.includes(item.id) ? item.cantidad || 0 : 0),
    }));
  }
  function loanSummary(loans) {
    return { total: loans.reduce((n, i) => n + (i.cantidad || 0), 0), returned: loans.reduce((n, i) => n + (i.devueltos || 0), 0),
      unknown: loans.filter(i => i.cantidad === null).length, pending: loans.filter(i => i.cantidad === null || i.devueltos < i.cantidad) };
  }
  function replenishmentLabel(id, quantities) {
    if (id === 'amenities') { const q = amenities.reduce((sum, key) => sum + (quantities[key] || 0), 0); return 'Amenities' + (q ? ' · ' + q + ' un.' : ''); }
    const item = supplies.find(s => s.id === id); return item ? item.label + (item.countable && quantities[id] ? ' · ' + quantities[id] : '') : '';
  }
  function selectedSupply(id, quantities) { return id === 'amenities' ? amenities.some(k => quantities[k] > 0) : quantities[id] > 0; }
  function housekeepingMessage(cabin, row) {
    const lines = ['CAB ' + cabin + ' · Reponer'];
    for (const sector of sectors) {
      const list = supplies.filter(s => s.area === sector.id && row.reposiciones?.[s.id] > 0).map(s => s.label + (s.countable ? ' × ' + row.reposiciones[s.id] : ''));
      if (list.length) lines.push(sector.title + ': ' + list.join(' · '));
    }
    // Damage/maintenance/lost property belong in Observaciones, not in the cleaning supply message.
    if (lines.length === 1) lines.push('Sin reposiciones.');
    return lines.join('\n');
  }
  function reviewStatus(row) { return row.revision_estado || 'pendiente'; }
  function validateMutation(field, value) {
    if (field === 'reposicion') {
      const values = value?.items;
      if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length || Object.keys(values).length > 3
        || Object.entries(values).some(([id, q]) => !supplies.some(s => s.id === id) || !units(q) || (!supplies.find(s => s.id === id).countable && q > 1))) throw new Error('Cantidad de reposición no válida.');
    } else if (field === 'prestamo') {
      if (!value || !safeId(value.id) || (value.descartado !== true && (!units(value.cantidad, 1) || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 80 || !sectors.some(s => s.id === value.area) || !['manual', 'notas'].includes(value.origen)))) throw new Error('Préstamo no válido.');
    } else if (field === 'devolucion') {
      if (!value || !safeId(value.id) || !units(value.cantidad) || !units(value.total, 1) || value.cantidad > value.total || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 80 || !sectors.some(s => s.id === value.area) || !['manual', 'notas'].includes(value.origen)) throw new Error('Cantidad devuelta no válida.');
    } else if (field === 'observacion') {
      if (!value || !safeId(value.id) || (value.borrar !== true && (!observationTypes.some(t => t.id === value.tipo) || (value.area !== null && !sectors.some(s => s.id === value.area)) || typeof value.texto !== 'string' || value.texto.length > 1000 || (!value.texto.trim() && !value.foto_path) || (value.foto_path !== null && typeof value.foto_path !== 'string')))) throw new Error('Completa el detalle o adjunta una foto.');
    } else if (field === 'revision_estado' && !['en_revision', 'revisada', 'pendiente'].includes(value)) throw new Error('Estado de revisión no válido.');
  }
  function patchWorkflow(row, field, value) {
    if (field === 'reposicion') { const next = { ...row.reposiciones }; for (const [id, q] of Object.entries(value.items)) { if (q) next[id] = q; else delete next[id]; } return { ...row, reposiciones: next }; }
    if (field === 'revision_estado') return { ...row, revision_estado: value };
    if (field === 'observacion') { const next = { ...row.observaciones }; if (value.borrar) delete next[value.id]; else next[value.id] = { ...value }; return { ...row, observaciones: next }; }
    const next = { ...row.prestamos }, existing = own(next, value.id) ? next[value.id] : null;
    if (field === 'prestamo') next[value.id] = value.descartado ? { ...existing, descartado: true } : { ...existing, ...value, descartado: false, devueltos: Math.min(existing?.devueltos || 0, value.cantidad) };
    if (field === 'devolucion') next[value.id] = { label: value.label, area: value.area, cantidad: existing?.cantidad || value.total, origen: existing?.origen || value.origen, ...existing, devueltos: value.cantidad };
    return { ...row, prestamos: next };
  }
  return { sectors, supplies, amenities, catalog, observationTypes, normalize, safeId, units, detectLoans, loansFor, loanSummary, replenishmentLabel, selectedSupply, housekeepingMessage, reviewStatus, validateMutation, patchWorkflow };
});
