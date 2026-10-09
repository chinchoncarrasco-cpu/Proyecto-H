const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const S = require('../js/haiku-libro-semantica-v1.js');
const { entorno, consulta } = require('./fixtures/libro-servicio-manual.cjs');
const F = require('./fixtures/libro-jonathan-real.cjs');
const hash = texto => crypto.createHash('sha256').update(texto).digest('hex');

test('Jonathan Oct26!K8 real: normalización → comparación → tarjeta en Servicios preparables para incorporar', async () => {
    const e = entorno(), r = F.configurar(e), celda = F.hoja.celdas.find(c => c.r === 7 && c.c === 10);
    assert.equal(hash(celda.valor), F.origen.sha256_texto_celda);
    assert.equal(celda.valor.includes('\n'), false);
    assert.ok(celda.valor.includes('19,00 HRS EL 03.10.26'));
    const antes = JSON.stringify({ hoja: F.hoja, db: e.state.db }), resultado = await e.construir();
    const servicios = resultado.items.filter(i => i.kind === 'servicio'); assert.equal(servicios.length, 1);
    const item = servicios[0];
    assert.equal(item.semantica, 'SERVICIO_REAL', JSON.stringify({ categoria: item.semantica, razones: item.razones }));
    assert.equal(item.estado, 'listo'); assert.equal(item.mapa.codigo, 'masajeTerapeutico30');
    assert.equal(item.servicio.cantidad, 2); assert.equal(item.fecha, '2026-10-03'); assert.equal(item.hora, '19:00');
    assert.equal(item.intencion_cobro, 'cobrable'); assert.equal(item.payload.tipo_cobro, 'normal');
    assert.equal(item.razones.length, 0); assert.equal(item.payload.cantidad, 2);
    assert.equal(item.payload.servicio_manual_v1, undefined); assert.equal(item.servicio.asignacion_profesional, null);
    assert.ok(item.payload.observaciones.includes('CON TESSY'));
    assert.ok(!item.servicio.texto_original.includes('22-09-26'));
    assert.equal(r.fecha_checkin, '2026-10-03'); assert.equal(r.fecha_checkout, '2026-10-04');
    const out = new e.Element('div'); e.api.renderizar(resultado, out, consulta);
    const seccion = out.querySelector('.haku-libro-servicios__seccion--servicios');
    assert.match(seccion.textContent, /Servicios preparables para incorporar/);
    assert.match(seccion.textContent, /Ficticioab Apellidoab/);
    assert.doesNotMatch(out.textContent, /Fecha por definir|Información contradictoria de fecha|Aprobación manual/);
    assert.equal(e.manuales.size, 0); assert.equal(e.state.escrituras.length, 0);
    assert.equal(JSON.stringify({ hoja: F.hoja, db: e.state.db }), antes);
});

test('una fecha suelta anterior a la prestación en notas de reserva no es fecha explícita del masaje', () => {
    const original = F.hoja.celdas.find(c => c.r === 7 && c.c === 10).valor;
    for (const contextual of ['22-09-26', '02.10.26', '03/10/26']) {
        const s = S.servicios(original.replace('22-09-26', contextual), { origen_campo: 'notas_reserva' });
        assert.equal(s.length, 1); assert.equal(s[0].semantica, 'SERVICIO_REAL');
        assert.deepEqual(s[0].unidad_servicio.conflictos_masaje, []);
        assert.ok(s[0].grupo_masaje_v1.fragmentos.every(f => !f.texto.includes(contextual)));
    }
});

test('fechas declaradas contradictorias dentro de la prestación continúan bloqueadas', async () => {
    const e = entorno(), hoja = structuredClone(F.hoja), celda = hoja.celdas.find(c => c.r === 7 && c.c === 10);
    celda.valor += ' // EL 04.10.26'; celda.runs = [{ texto: celda.valor }];
    F.configurar(e, hoja);
    const items = (await e.construir()).items.filter(i => i.kind === 'servicio');
    assert.ok(items.every(i => i.estado === 'revisar' && !i.payload));
    assert.ok(items.every(i => i.razones.some(r => /contradictoria de fecha/.test(r))));
});

test('la fecha suelta sí complementa un bloque de masaje ya iniciado; servicios conserva su contexto explícito', () => {
    for (const [texto, campo] of [['1 MASAJE RELAJANTE DE 30 MIN // 03.10.26 // A LAS 19,00 HRS', 'notas_reserva'],
        ['03.10.26 // 1 MASAJE RELAJANTE DE 30 MIN A LAS 19,00 HRS', 'servicios']]) {
        const s = S.servicios(texto, { origen_campo: campo });
        assert.equal(s.length, 1); assert.equal(s[0].semantica, 'SERVICIO_REAL');
        assert.ok(s[0].texto_original.includes('03.10.26')); assert.equal(s[0].hora, '19:00');
    }
});
