const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../js/haiku-libro-semantica-v1.js');
const { entorno, consulta } = require('./fixtures/libro-servicio-manual.cjs');
const F = require('./fixtures/libro-servicios-color.cjs');

// Reproducción sintética del texto informado; no se abre el Libro real.
const jonathan = 'X PAGAR 2 MASAJES RELAJANTES DE 30 MINS\nCOMENZANDO A LAS 19.00 HRS\nEL 03/10/26\nCON MONICA';
function configurar(texto = jonathan, inicio = '2026-10-02', fin = '2026-10-03') {
    const e = entorno(), r = e.state.reservas[1];
    Object.assign(r, { titular: 'Ficticioab Apellidoab', cabana: 6, fecha_checkin: inicio, fecha_checkout: fin,
        noches: S.sumarDias(inicio, 1) === fin ? 1 : 2, texto_original: texto,
        coordenadas_origen: { hoja: 'Oct26', celda: 'C6' } });
    r.servicios = S.servicios(texto, { origen_campo: 'notas_reserva', coordenadas_origen: r.coordenadas_origen });
    e.state.reservas = [r];
    e.state.db.reservas[1].titular_nombre = r.titular;
    e.state.db.cabanas[1].numero = 6;
    Object.assign(e.state.db.reserva_estadias[1], { fecha_ingreso: inicio, fecha_salida: fin });
    return e;
}

test('Jonathan exacto multilínea: un masaje terapéutico de 30 min, dos unidades, 03/10/26 a las 19:00', async () => {
    const e = configurar(), antes = JSON.stringify(e.state.db), resultado = await e.construir();
    const items = resultado.items.filter(i => i.kind === 'servicio');
    assert.equal(items.length, 1);
    const item = items[0];
    assert.equal(item.semantica, 'SERVICIO_REAL'); assert.equal(item.estado, 'listo');
    assert.equal(item.mapa.codigo, 'masajeTerapeutico30'); assert.equal(item.servicio.cantidad, 2);
    assert.equal(item.fecha, '2026-10-03'); assert.equal(item.hora, '19:00');
    assert.equal(item.intencion_cobro, 'cobrable'); assert.equal(item.payload.tipo_cobro, 'normal');
    assert.equal(item.payload.fecha_servicio, '2026-10-03'); assert.equal(item.payload.cantidad, 2);
    assert.equal(item.proveniencia.fecha, 'EXPLICITO'); assert.equal(item.razones.length, 0);
    assert.ok(item.servicio.texto_original.includes('CON MONICA'));
    assert.deepEqual(Array.from(item.servicio.profesionales), ['Mónica']);
    assert.equal(item.servicio.asignacion_profesional, null);
    assert.ok(!Object.hasOwn(item.payload, 'profesional_id'));
    const out = new e.Element('div'); e.api.renderizar(resultado, out, consulta);
    assert.doesNotMatch(out.textContent, /Fecha por definir|Información contradictoria de fecha|Aprobación manual/);
    assert.equal(e.manuales.size, 0); assert.equal(e.state.escrituras.length, 0);
    assert.equal(JSON.stringify(e.state.db), antes);
});

test('A: fecha explícita y contexto coincidente usan 03/10/26', async () => {
    const e = configurar(jonathan.replace(/\n/g, ' '), '2026-10-03', '2026-10-04');
    const item = (await e.construir()).items[0];
    assert.equal(item.fecha, '2026-10-03'); assert.equal(item.proveniencia.fecha, 'EXPLICITO');
    assert.equal(item.estado, 'listo');
});

test('B: 03/10/26 gana a la inferencia de ingreso 02/10 por horario y a la fuente contextual ajena', async () => {
    const e = configurar(jonathan.replace(/\n/g, ' '));
    const s = e.state.reservas[0].servicios[0];
    s.texto_fuente_completo = 'CONTEXTO RESERVA 02/10/26 ' + s.texto_original;
    s.unidad_servicio.texto_fuente_completo = s.texto_fuente_completo;
    const item = (await e.construir()).items[0];
    assert.equal(item.fecha, '2026-10-03'); assert.equal(item.proveniencia.fecha, 'EXPLICITO');
    assert.equal(item.estado, 'listo'); assert.equal(item.razones.length, 0);
});

test('C: dos fechas explícitas distintas en una misma prestación bloquean, contiguas o agrupadas', async () => {
    for (const texto of [jonathan.replace(/\n/g, ' ') + ' EL 04/10/26',
        jonathan.replace('EL 03/10/26', 'EL 03/10/26\nEL 04/10/26')]) {
        const e = configurar(texto, '2026-10-02', '2026-10-04'), items = (await e.construir()).items.filter(i => i.kind === 'servicio');
        assert.ok(items.length > 0); assert.ok(items.every(i => i.estado === 'revisar' && !i.payload));
        assert.ok(items.every(i => i.razones.some(r => /contradictoria de fecha/.test(r))));
        assert.equal(e.state.escrituras.length, 0);
    }
});

test('D: fecha explícita fuera de la estadía sigue declarada pero no genera payload', async () => {
    const e = configurar(jonathan.replace(/\n/g, ' '), '2026-10-04', '2026-10-05');
    const item = (await e.construir()).items[0];
    assert.equal(item.fecha, '2026-10-03'); assert.equal(item.estado, 'revisar'); assert.equal(item.payload, null);
    assert.ok(item.razones.some(r => /fuera de la estadía/.test(r)));
});

test('E: sin fecha explícita se conserva inferencia por horario de una noche', async () => {
    const e = configurar(jonathan.replace('\nEL 03/10/26', ''));
    const item = (await e.construir()).items[0];
    assert.equal(item.fecha, '2026-10-02'); assert.equal(item.hora, '19:00'); assert.equal(item.estado, 'listo');
    assert.equal(item.proveniencia.fecha, 'INFERIDA_SEGURA');
});

test('F: PARA EL 24 conserva su resolución contextual sin confundirse con fecha completa', async () => {
    const e = configurar(jonathan.replace('EL 03/10/26', 'PARA EL 24'), '2026-10-23', '2026-10-25');
    const item = (await e.construir()).items[0];
    assert.equal(item.fecha, '2026-10-24'); assert.equal(item.hora, '19:00'); assert.equal(item.estado, 'listo');
});

test('G: Rocío conserva masaje 24/10 11:00 y tinaja 23/10 19:15 con amarillo aislado', async () => {
    const e = entorno(); F.configurar(e, F.rocio());
    const items = (await e.construir()).items.filter(i => i.kind === 'servicio');
    assert.equal(items.length, 2); assert.ok(items.every(i => i.estado === 'listo'));
    assert.equal(items.find(i => i.servicio.concepto === 'masaje').fecha, '2026-10-24');
    assert.equal(items.find(i => i.servicio.concepto === 'masaje').hora, '11:00');
    assert.equal(items.find(i => i.mapa.codigo === 'tinajaTonel').fecha, '2026-10-23');
    assert.equal(items.find(i => i.mapa.codigo === 'tinajaTonel').hora, '19:15');
});

test('fecha explícita inválida no cae silenciosamente en la inferencia ni se sustituye manualmente', async () => {
    const e = configurar(jonathan.replace(/\n/g, ' ').replace('03/10/26', '31/02/26'));
    const item = (await e.construir()).items[0];
    assert.equal(item.fecha, null); assert.equal(item.estado, 'revisar'); assert.equal(item.payload, null);
    assert.ok(item.razones.some(r => /fecha explícita.*interpretar/i.test(r)));
    const manual = await e.resolver(0, { fecha: '2026-10-02' });
    assert.equal(manual.items[0].payload, null);
});

test('fecha completa precisa PARA EL 03 aunque haya varios meses; otro día explícito bloquea', async () => {
    const texto = jonathan.replace(/\n/g, ' ');
    const e = configurar(texto + ' PARA EL 03', '2026-09-02', '2026-11-04');
    e.state.reservas[0].noches = 63;
    const item = (await e.construir()).items[0];
    assert.equal(item.fecha, '2026-10-03'); assert.equal(item.estado, 'listo');
    const contradiccion = configurar(texto + ' PARA EL 04', '2026-10-02', '2026-10-04');
    assert.equal((await contradiccion.construir()).items[0].payload, null);
});

test('separadores de fragmentos y repetición coincidente de fecha mantienen una sola prestación', async () => {
    for (const separador of ['\n', ' / ', ' // ', '; ']) {
        const e = configurar(jonathan.split('\n').join(separador) + separador + 'EL 03/10/2026');
        const items = (await e.construir()).items.filter(i => i.kind === 'servicio');
        assert.equal(items.length, 1); assert.equal(items[0].estado, 'listo'); assert.equal(items[0].fecha, '2026-10-03');
    }
});

test('una fecha completa precisa el año de su repetición parcial sin competir con el año contextual', async () => {
    const e = configurar(jonathan.replace(/\n/g, ' ') + ' EL 03/10', '2025-10-02', '2026-10-04');
    e.state.reservas[0].noches = 367;
    const item = (await e.construir()).items[0];
    assert.equal(item.fecha, '2026-10-03'); assert.equal(item.estado, 'listo');
});

test('una noche declarada que contradice la fecha explícita sigue bloqueada', async () => {
    const e = configurar(jonathan.replace(/\n/g, ' ') + ' PRIMERA NOCHE');
    const item = (await e.construir()).items[0];
    assert.equal(item.estado, 'revisar'); assert.equal(item.payload, null);
    assert.ok(item.razones.some(r => /noche indicada contradice/.test(r)));
});
