const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../js/haiku-libro-semantica-v1.js');
const { entorno, consulta } = require('./fixtures/libro-servicio-manual.cjs');
const F = require('./fixtures/libro-servicios-color.cjs');
const reserva = h => S.normalizarHoja(h, 'Oct26').reservas[0];
const servicio = (h, concepto = 'tonel') => [...reserva(h).servicios, ...reserva(h).menciones_servicio].find(s => s.concepto === concepto);
const amarilla = texto => F.hojaColor([F.run(texto)]);

test('A: Tinaja amarilla sin pagar es cobrable y conserva spans/origen de su evidencia', async () => {
    const h = amarilla(F.tinaja), e = entorno(), r = F.configurar(e, h);
    const item = (await e.construir()).items[0], visual = item.servicio.evidencia_visual_v1;
    const estadia = e.state.db.reserva_estadias[1];
    assert.equal(item.reserva.titular, r.titular);
    assert.equal(item.asociacion.sistema.id, estadia.id);
    assert.equal(item.asociacion.sistema.reserva_id, estadia.reserva_id);
    assert.equal(item.semantica, 'SERVICIO_REAL');
    assert.equal(item.mapa.codigo, 'tinajaTonel');
    assert.equal(item.fecha, '2026-10-23'); assert.equal(item.hora, '19:15');
    assert.equal(item.intencion_cobro, 'cobrable'); assert.equal(item.payload.tipo_cobro, 'normal');
    assert.equal(item.estado, 'listo'); assert.equal(item.razones.length, 0);
    assert.equal(visual.fuente, 'rich_text_font'); assert.equal(visual.rgb, 'FFFF00');
    assert.equal(visual.inferencia, 'amarillo_cobrable');
    assert.equal(visual.origen.hoja, 'Oct26'); assert.equal(visual.origen.celda, 'CM7');
    const texto = reserva(h).texto_original;
    for (const span of visual.runs) assert.equal(texto.slice(span.inicio, span.fin), span.texto);
    assert.equal(visual.runs.map(r => r.texto).join(''), F.tinaja);
    assert.equal(e.state.escrituras.length, 0);
});

test('B: Masaje amarillo sigue siendo cobrable con su agrupación y hora originales', async () => {
    const e = entorno(); F.configurar(e, amarilla(F.masaje));
    const item = (await e.construir()).items[0];
    assert.equal(item.semantica, 'SERVICIO_REAL'); assert.equal(item.intencion_cobro, 'cobrable');
    assert.equal(item.fecha, '2026-10-24'); assert.equal(item.hora, '11:00');
    assert.equal(item.payload.codigo_servicio, 'masajeDescontracturante60');
    assert.equal(item.servicio.evidencia_visual_v1.rgb, 'FFFF00');
});

test('C: Late amarillo resuelve únicamente su intención financiera', async () => {
    const e = entorno(); F.configurar(e, amarilla('LATE OUT 1 HORA A LAS 13:00'));
    const item = (await e.construir()).items[0];
    assert.equal(item.semantica, 'SERVICIO_REAL'); assert.equal(item.intencion_cobro, 'cobrable');
    assert.equal(item.payload.codigo_servicio, 'lateCheckout'); assert.equal(item.payload.tipo_cobro, 'normal');
});

test('D / N: cortesía textual gana tanto a rojo como a amarillo', async () => {
    for (const color of [F.rojo, F.amarillo]) {
        const h = F.hojaColor([F.run(`${F.tinaja} DE CORTESÍA`, color)]), e = entorno(); F.configurar(e, h);
        const item = (await e.construir()).items[0];
        assert.equal(item.semantica, 'SERVICIO_REAL'); assert.equal(item.intencion_cobro, 'cortesia');
        assert.equal(item.payload.tipo_cobro, 'cortesia');
        assert.equal(item.servicio.evidencia_visual_v1.inferencia, null);
    }
});

test('E: por coordinar conserva NO_SERVICIO y nota, independientemente del color', async () => {
    for (const color of [F.rojo, F.amarillo]) {
        const e = entorno(); F.configurar(e, F.hojaColor([F.run('TINAJA TONEL POR COORDINAR', color)]));
        const item = (await e.construir()).items[0];
        assert.equal(item.kind, 'nota'); assert.equal(item.semantica, 'NO_SERVICIO');
        assert.ok(!item.payload?.codigo_servicio); assert.equal(e.state.escrituras.length, 0);
    }
});

test('F: un servicio rojo continúa siendo real, con cobro por definir', async () => {
    const e = entorno(); F.configurar(e, F.hojaColor([F.run(F.tinaja, F.rojo)]));
    const item = (await e.construir()).items[0];
    assert.equal(item.semantica, 'SERVICIO_REAL'); assert.equal(item.estado, 'revisar');
    assert.equal(item.intencion_cobro, 'no_determinada'); assert.equal(item.payload, null);
});

test('G / M: sin runs, fondo amarillo o fuente general amarilla no prestan color al servicio', () => {
    for (const opciones of [{ sinRuns: true }, { sinRuns: true, fuente: F.amarillo }, { fondo: F.amarillo }]) {
        const s = servicio(F.hojaColor([F.run(F.tinaja, F.negro)], opciones));
        assert.equal(s.intencion_cobro, 'no_determinada');
    }
    const s = S.servicios(F.tinaja, { origen_campo: 'notas_reserva' })[0];
    assert.equal(s.intencion_cobro, 'no_determinada');
    assert.equal(s.evidencia_visual_v1, undefined);
    assert.equal(S.servicios(F.masaje, { origen_campo: 'notas_reserva' })[0].intencion_cobro, 'cobrable');
});

test('H: indexed, theme, tint, auto o RGB inválido no resolubles no infieren amarillo', () => {
    for (const color of [{ indexed: 5 }, { indexed: 99 }, { theme: 5 }, { rgb: 'FFFFFF00', tint: 0.1 },
        { rgb: 'FFFFFF00', auto: true }, { rgb: 'oopsFFFF00' }]) {
        const s = servicio(F.hojaColor([F.run(F.tinaja, color)]));
        assert.equal(s.intencion_cobro, 'no_determinada', JSON.stringify(color));
        assert.equal(s.evidencia_visual_v1.inferencia, null);
    }
    assert.equal(servicio(F.hojaColor([F.run(F.tinaja, { theme: 5, rgb: 'FFFFFF00', tint: 0 })])).intencion_cobro, 'cobrable');
});

test('I / Rocío: masaje y tinaja amarillos comparten run sin contaminación de la nota roja', async () => {
    const h = F.rocio(), e = entorno(); F.configurar(e, h);
    const antes = JSON.stringify({ hoja: h, db: e.state.db }), resultado = await e.construir();
    const items = resultado.items.filter(i => i.kind === 'servicio');
    assert.equal(items.length, 2); assert.ok(items.every(i => i.estado === 'listo'));
    const tinaja = items.find(i => i.mapa.codigo === 'tinajaTonel'), masaje = items.find(i => i.servicio.concepto === 'masaje');
    assert.equal(tinaja.fecha, '2026-10-23'); assert.equal(tinaja.hora, '19:15');
    assert.equal(tinaja.payload.tipo_cobro, 'normal');
    assert.equal(masaje.fecha, '2026-10-24'); assert.equal(masaje.hora, '11:00');
    for (const item of items) {
        assert.equal(item.servicio.evidencia_visual_v1.rgb, 'FFFF00');
        assert.ok(item.servicio.evidencia_visual_v1.runs.every(r => !r.texto.includes(F.nota)));
    }
    assert.ok(resultado.items.some(i => i.kind === 'nota' && i.texto.includes(F.nota)));
    const out = new e.Element('div'); e.api.renderizar(resultado, out, consulta);
    assert.ok(!out.textContent.includes('Aprobación manual'));
    assert.equal(e.state.escrituras.length, 0);
    assert.equal(JSON.stringify({ hoja: h, db: e.state.db }), antes);
});

test('J: dos servicios con colores diferentes mantienen evidencia e intención propias', () => {
    const h = F.hojaColor([F.run(F.tinaja), F.run(' // ', F.negro), F.run('LATE OUT 1 HORA A LAS 13:00', F.rojo)]);
    const r = reserva(h);
    assert.equal(r.servicios.find(s => s.concepto === 'tonel').intencion_cobro, 'cobrable');
    const late = r.servicios.find(s => s.concepto === 'lateout');
    assert.equal(late.intencion_cobro, 'no_determinada');
    assert.ok(late.evidencia_visual_v1.runs.every(s => s.rgb === 'FF0000'));
});

test('K: varios runs amarillos cubren el servicio; espacios y separadores negros no contaminan', () => {
    const s = servicio(F.hojaColor([F.run('TINAJA TONEL'), F.run(' ', F.negro), F.run('1 HORA PARA EL VIERNES'),
        F.run(' ', F.rojo), F.run('23/10 A LAS 19:15 HRS')]));
    assert.equal(s.intencion_cobro, 'cobrable');
    assert.equal(s.evidencia_visual_v1.cobertura, 'amarillo_inequivoco');
    assert.ok(s.evidencia_visual_v1.runs.length > 1);
    const masaje = servicio(F.hojaColor([F.run('1 MASAJE DE 1 HORA'), F.run(' / ', F.rojo),
        F.run('DESCONTRACTURANTE PARA EL 24/10 A LAS 11 AM')]), 'masaje');
    assert.equal(masaje.grupo_masaje_v1.agrupado, true);
    assert.equal(masaje.evidencia_visual_v1.cobertura, 'amarillo_inequivoco');
});

test('L: una palabra relevante negra, un hueco o runs desalineados impiden inferir', () => {
    const h = F.hojaColor([F.run('TINAJA '), F.run('TONEL', F.negro), F.run(' 1 HORA EL 23/10 A LAS 19:15 HRS')]);
    assert.equal(servicio(h).intencion_cobro, 'no_determinada');
    const desalineada = amarilla(F.tinaja);
    desalineada.celdas.find(c => c.r === 6 && c.c === 90).runs[1].texto = F.tinaja.slice(1);
    const s = servicio(desalineada);
    assert.equal(s.intencion_cobro, 'no_determinada');
    assert.equal(s.evidencia_visual_v1.cobertura, 'atribucion_ambigua');
});

test('O: una contradicción textual explícita no se resuelve con amarillo', async () => {
    for (const texto of [`${F.tinaja} CORTESÍA X PAGAR`, `${F.masaje} CORTESÍA X PAGAR`]) {
        const e = entorno(); F.configurar(e, amarilla(texto));
        const item = (await e.construir()).items[0];
        assert.equal(item.semantica, 'SERVICIO_REAL'); assert.equal(item.estado, 'revisar');
        assert.equal(item.intencion_cobro, 'no_determinada'); assert.equal(item.payload, null);
        assert.equal(item.servicio.evidencia_visual_v1.inferencia, null);
    }
});

test('P: cambiar color/origen invalida sólo la decisión dependiente sin cambiar su item_id', async () => {
    for (const nuevoColor of [{ theme: 5 }, { theme: 5, rgb: 'FFFFFF00' }]) {
        const e = entorno(), texto = 'TINAJA 1 HORA EL 23/10 A LAS 19:15 HRS';
        F.configurar(e, F.hojaColor([F.run(texto)]));
        const original = (await e.construir()).items[0];
        await e.resolver(0, { codigo_servicio: 'tinajaTonel' });
        assert.equal((await e.construir()).items[0].estado, 'listo');
        F.configurar(e, F.hojaColor([F.run(texto, nuevoColor)]));
        const cambiado = (await e.construir()).items[0];
        assert.equal(cambiado.item_id, original.item_id); assert.equal(cambiado.payload, null);
        assert.equal(cambiado.estado, 'revisar'); assert.equal(e.manuales.get(original.item_id).invalidada, true);
        assert.equal(e.state.escrituras.length, 0);
    }
});

test('una nota ajena que cambia de color no invalida la aprobación del servicio', async () => {
    const texto = 'TINAJA 1 HORA EL 23/10 A LAS 19:15 HRS', e = entorno();
    F.configurar(e, F.hojaColor([F.run(texto), F.run(' // '), F.run(F.nota, F.rojo)]));
    await e.resolver(0, { codigo_servicio: 'tinajaTonel' });
    F.configurar(e, F.hojaColor([F.run(texto), F.run(' // '), F.run(F.nota, F.negro)]));
    assert.equal((await e.construir()).items.find(i => i.kind === 'servicio').estado, 'listo');
    assert.equal([...e.manuales.values()][0].invalidada, undefined);
});

test('evidencia visual queda en frontend y no se agrega a payloads ni auditoría del writer', async () => {
    const e = entorno(); F.configurar(e, amarilla('TINAJA 1 HORA EL 23/10 A LAS 19:15 HRS'));
    const item = (await e.resolver(0, { codigo_servicio: 'tinajaTonel' })).items[0];
    assert.equal(item.estado, 'listo'); assert.ok(item.servicio.evidencia_visual_v1);
    assert.ok(!JSON.stringify(item.payload).includes('evidencia_visual_v1'));
    assert.ok(!JSON.stringify(item.payload).includes('rich_text_font'));
    assert.equal(item.payload.servicio_manual_v1.evidencia_original.intencion_cobro, 'cobrable');
});

test('amarillo no promueve consultas, descartados ni menciones ambiguas a SERVICIO_REAL', () => {
    for (const [texto, categoria] of [['CONSULTAR SI DESEA TINAJA', 'CONSULTA_SERVICIO'],
        ['FINALMENTE NO RESERVÓ TINAJA', 'SERVICIO_DESCARTADO'], ['TINAJA TONEL', 'AMBIGUO']]) {
        const s = servicio(amarilla(texto), texto === 'CONSULTAR SI DESEA TINAJA' || texto.startsWith('FINALMENTE') ? 'tinaja' : 'tonel');
        assert.equal(s.semantica, categoria); assert.equal(s.intencion_cobro, 'no_determinada');
        assert.equal(s.evidencia_visual_v1.inferencia, null);
    }
});

test('texto cobrable explícito gana al rojo y no depende de la inferencia amarilla', () => {
    const s = servicio(F.hojaColor([F.run(`${F.tinaja} X PAGAR`, F.rojo)]));
    assert.equal(s.intencion_cobro, 'cobrable'); assert.equal(s.evidencia_visual_v1.inferencia, null);
});

test('dos unidades en un mismo fragmento y textos repetidos reciben sus propios spans', () => {
    const h = F.hojaColor([F.run(F.tinaja + ' '), F.run('LATE OUT 1 HORA A LAS 13:00', F.rojo)]);
    const r = reserva(h);
    assert.equal(r.servicios.find(s => s.concepto === 'tonel').intencion_cobro, 'cobrable');
    assert.equal(r.servicios.find(s => s.concepto === 'lateout').intencion_cobro, 'no_determinada');
    const repetida = reserva(F.hojaColor([F.run(F.tinaja, F.negro), F.run(' // '), F.run(F.tinaja)]));
    const [primera, segunda] = repetida.servicios;
    assert.equal(primera.intencion_cobro, 'no_determinada'); assert.equal(segunda.intencion_cobro, 'cobrable');
    assert.ok(primera.evidencia_visual_v1.rangos[0].fin < segunda.evidencia_visual_v1.rangos[0].inicio);
});

test('color de un servicio cambia sin invalidar otro preparado manual de la misma celda', async () => {
    const textoTinaja = 'TINAJA 1 HORA EL 23/10 A LAS 19:15 HRS', textoMasaje = '1 MASAJE DE 1 HORA EL 24/10';
    const e = entorno(), datos = color => F.hojaColor([F.run(textoTinaja, color), F.run(' // '), F.run(textoMasaje)]);
    F.configurar(e, datos(F.amarillo));
    await e.resolver(0, { codigo_servicio: 'tinajaTonel' });
    await e.resolver(1, { codigo_servicio: 'masajeDescontracturante60', hora: '11:00' });
    const anteriores = (await e.construir()).items;
    F.configurar(e, datos({ theme: 5 }));
    const nuevos = (await e.construir()).items;
    assert.equal(nuevos[0].item_id, anteriores[0].item_id); assert.equal(nuevos[0].estado, 'revisar'); assert.equal(nuevos[0].payload, null);
    assert.equal(nuevos[1].item_id, anteriores[1].item_id); assert.equal(nuevos[1].estado, 'listo');
    assert.equal(e.state.escrituras.length, 0);
});

test('amarillo no reutiliza una cortesía existente contradictoria, ni con marca de origen', async () => {
    for (const marcado of [false, true]) {
        const e = entorno(); F.configurar(e, amarilla(F.tinaja));
        const item = (await e.construir()).items[0], estadia = e.state.db.reserva_estadias[1];
        e.state.db.servicios.push({ id: 'cortesia-sintetica', reserva_id: estadia.reserva_id, estadia_id: estadia.id,
            fecha_servicio: item.fecha, hora_inicio: item.hora, hora_fin: '20:15', cantidad: 1, personas: 2,
            tipo_cobro: 'cortesia', total: 0, estado_servicio: 'programado', catalogo_servicios: { codigo: 'tinajaTonel' },
            observaciones: marcado ? `[HAKU-LIBRO-SERVICIO:${item.item_id}]` : '' });
        const nuevo = (await e.construir()).items[0];
        assert.equal(nuevo.estado, 'revisar'); assert.equal(nuevo.payload, null);
        assert.equal(e.state.escrituras.length, 0);
    }
});

test('Late amarillo sin hora reconoce primero el existente único compatible', async () => {
    const e = entorno(); F.configurar(e, amarilla('LATE OUT 1 HORA'));
    const estadia = e.state.db.reserva_estadias[1];
    e.state.db.servicios.push({ id: 'late-sintetico', reserva_id: estadia.reserva_id, estadia_id: estadia.id,
        fecha_servicio: '2026-10-25', hora_inicio: '13:00', hora_fin: '14:00', cantidad: 1,
        tipo_cobro: 'normal', total: 10000, estado_servicio: 'programado', catalogo_servicios: { codigo: 'lateCheckout' } });
    const item = (await e.construir()).items[0];
    assert.equal(item.estado, 'existente'); assert.equal(item.identidad, 'YA_EXISTE'); assert.equal(item.payload, null);
    assert.equal(e.state.escrituras.length, 0);
});

test('espacios compactados y Unicode no recortan palabras negras ni prestan color entre unidades', () => {
    for (const prefijo of ['TINAJA          TONEL', 'TINAJA TONE\u0301L']) {
        const textoTinaja = `${prefijo} 1 HORA EL 23/10 A LAS 19:15 HRS`;
        const textoLate = 'LATE OUT 1 HORA A LAS 13:00';
        const h = F.hojaColor([F.run(textoTinaja.slice(0, -3)), F.run('HRS ', F.negro), F.run(textoLate)]);
        const r = reserva(h), tinaja = r.servicios.find(s => s.concepto === 'tonel'), late = r.servicios.find(s => s.concepto === 'lateout');
        assert.equal(tinaja.texto_original, textoTinaja); assert.equal(tinaja.intencion_cobro, 'no_determinada');
        assert.equal(late.texto_original, textoLate); assert.equal(late.intencion_cobro, 'cobrable');
        assert.equal(late.hora, '13:00');
    }
});

test('OOXML sintético pasa por el worker existente y conserva amarillo para servicios', () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const w = vm.createContext({ console, addEventListener() {}, postMessage() {}, importScripts() {} }); w.self = w;
    vm.runInContext(fs.readFileSync(require.resolve('../js/supabase-libro-reserva-worker-v1.js'), 'utf8'), w);
    const h = amarilla(F.tinaja), celda = h.celdas.find(c => c.r === 6 && c.c === 90);
    const xml = `<si><r><rPr><color rgb="FF000000"/></rPr><t>${celda.runs[0].texto}</t></r>` +
        `<r><rPr><color rgb="FFFFFF00"/></rPr><t>${F.tinaja}</t></r></si>`;
    celda.runs = structuredClone(w.parsearTextoEnriquecido(xml));
    const s = servicio(h);
    assert.equal(s.intencion_cobro, 'cobrable');
    assert.equal(s.evidencia_visual_v1.runs[0].color_ooxml.rgb, 'FFFFFF00');
    assert.equal(s.evidencia_visual_v1.runs[0].rgb, 'FFFF00');
});
