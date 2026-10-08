const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../js/haiku-libro-semantica-v1.js');
const vm = require('node:vm');
const { entorno, consulta, read } = require('./fixtures/libro-servicio-manual.cjs');
const { fragmentos, delimitadores, hoja, configurarRocio, masajeReal, tinajaReal, textoReal } = require('./fixtures/libro-masaje-fragmentos.cjs');
const servicios = r => r.items.filter(x => x.kind === 'servicio');
const rocio = r => servicios(r).filter(x => x.reserva.titular === 'Rocío Leal');
const origen = { hoja: 'Oct26', celda: 'C3', fila: 3, columna: 3, merge: hoja().combinaciones[0] };
const parsear = texto => S.servicios(texto, { origen_campo: 'notas_reserva', coordenadas_origen: origen });
const puro = { document: {}, addEventListener() {}, HAIKU_LIBRO_SEMANTICA: S };
vm.createContext(puro); vm.runInContext(read('js/haiku-libro-servicios-scope-v2.js')
    .replace('const api = Object.freeze({', 'const api = Object.freeze({prepararServicio, horaTexto, horaFinTexto,'), puro);

test('fechas DD/MM permanecen dentro de su prestación y // conserva el límite', () => {
    assert.deepEqual(S.separarCampos(textoReal), [masajeReal, tinajaReal]);
    assert.deepEqual(S.separarCampos('24/10/2026 / MASAJE / C/U / 23/10'), ['24/10/2026', 'MASAJE', 'C/U', '23/10']);
});

for (const [texto, esperado] of [
    ['A LAS 11 AM', '11:00'], ['A LAS 11:00 AM', '11:00'], ['A LAS 11.00 AM', '11:00'],
    ['A LAS 19:15 HRS', '19:15'], ['A LAS 19:15', '19:15'], ['11 AM', '11:00'], ['11 PM', '23:00'],
    ['11:15 AM', '11:15'], ['7:15 PM', '19:15'], ['12 AM', '00:00'], ['12 PM', '12:00']
]) {
    test(`${texto}: hora inequívoca, sin segundo horario falso y preparable sin aprobación manual`, async () => {
        assert.deepEqual(S.horasDeServicio(texto), [esperado]);
        assert.equal(puro.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.horaTexto(texto), esperado);
        assert.equal(puro.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.horaFinTexto(texto), null);
        const e = entorno(); configurarRocio(e, masajeReal.replace('A LAS 11 AM', texto));
        const items = rocio(await e.construir()); assert.equal(items.length, 1);
        assert.equal(items[0].hora, esperado); assert.equal(items[0].hora_fin, null);
        assert.equal(items[0].fecha, '2026-10-24'); assert.equal(items[0].estado, 'listo');
        assert.equal(items[0].razones.length, 0); assert.equal(items[0].payload.hora, esperado);
        assert.equal(items[0].payload.servicio_manual_v1, undefined); assert.equal(e.manuales.size, 0);
    });
}

test('horas inválidas o números sin meridiano/minutos siguen sin inferencia; intervalos AM/PM se consumen completos', () => {
    for (const texto of ['A LAS 11', '11', '13 AM', '0 PM', '25:00', '11:60 AM', '11:5 PM', '24/10']) {
        assert.deepEqual(S.horasDeServicio(texto), [], texto);
    }
    assert.deepEqual(S.horasDeServicio('DE 11:15 AM A 12:15 PM'), ['11:15', '12:15']);
    assert.equal(puro.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.horaTexto('HASTA LAS 7:15 PM', true), '19:15');
});

test('la hora con punto y AM/PM no se interpreta como fecha, antes de DD/MM ni junto a para el 24', async () => {
    for (const texto of [
        masajeReal.replace('PARA EL 24/10 A LAS 11 AM', '11.00 AM PARA EL 24/10'),
        masajeReal.replace('PARA EL 24/10 A LAS 11 AM', 'PARA EL 24 A LAS 11.00 AM')
    ]) {
        const e = entorno(); configurarRocio(e, texto);
        const items = rocio(await e.construir()); assert.equal(items.length, 1);
        assert.equal(items[0].hora, '11:00'); assert.equal(items[0].fecha, '2026-10-24');
        assert.equal(items[0].estado, 'listo'); assert.equal(items[0].payload.servicio_manual_v1, undefined);
    }
});

for (const texto of [textoReal, textoReal.replace(' A LAS 11 AM', '\nA LAS 11 AM')]) {
    test(`Rocío real ${texto.includes('\n') ? 'multilínea' : 'completo'}: masaje automático único y tinaja sin contaminación`, async () => {
        const e = entorno(), reserva = configurarRocio(e, texto);
        assert.equal(reserva.servicios.length, 2);
        const resultado = await e.construir(), items = rocio(resultado);
        const masaje = items.find(x => x.servicio.concepto === 'masaje'), tinaja = items.find(x => x.servicio.concepto === 'tonel');
        assert.equal(items.filter(x => x.servicio.concepto === 'masaje').length, 1);
        assert.equal(masaje.servicio.tipo, 'descontracturante'); assert.equal(masaje.servicio.duracion_minutos, 60);
        assert.equal(masaje.servicio.cantidad, 1); assert.equal(masaje.fecha, '2026-10-24'); assert.equal(masaje.hora, '11:00');
        assert.equal(masaje.hora_fin, null); assert.equal(masaje.estado, 'listo'); assert.equal(masaje.razones.length, 0);
        assert.deepEqual(Array.from(masaje.servicio.profesionales), ['Mónica']);
        assert.ok(masaje.servicio.grupo_masaje_v1.evidencias.hora.some(f => f.texto.includes('11 AM')));
        assert.equal(tinaja.fecha, '2026-10-23'); assert.equal(tinaja.hora, '19:15'); assert.equal(tinaja.hora_fin, null);
        assert.ok(!masaje.servicio.texto_original.includes('TINAJA')); assert.ok(!tinaja.servicio.texto_original.includes('MASAJE'));
        assert.equal(masaje.payload.codigo_servicio, 'masajeDescontracturante60'); assert.equal(masaje.payload.hora, '11:00');
        assert.equal(masaje.payload.servicio_manual_v1, undefined); assert.equal(e.manuales.size, 0);
        const out = new e.Element('div'); e.api.renderizar(resultado, out, consulta);
        const row = out.querySelectorAll('.haku-libro-servicios__item').find(x => x.textContent.includes('Masaje Descontracturante'));
        assert.ok(row.classList.contains('haku-libro-servicios__item--listo'));
        assert.equal(row.querySelectorAll('input[type=checkbox]').length, 1);
        assert.equal(row.querySelector('input[type=checkbox]').disabled, false);
        assert.equal(row.querySelector('input[type=checkbox]').checked, true);
        assert.ok(!row.querySelectorAll('button').some(b => b.textContent === 'Aprobación manual'));
        assert.doesNotMatch(row.textContent, /Falta horario|Falta fecha|Aprobación manual/);
        assert.equal(items.filter(x => x.payload).length, 1);
        assert.equal(tinaja.payload, null); assert.equal(e.state.escrituras.length, 0);
    });
}

test('la hora de otra prestación no completa el masaje ni la tinaja cuando falta su propio horario', async () => {
    for (const [texto, concepto, hora] of [
        [textoReal.replace(' A LAS 11 AM', ''), 'masaje', '19:15'],
        [textoReal.replace(' A LAS 19:15 HRS', ''), 'tonel', '11:00']
    ]) {
        const e = entorno(); configurarRocio(e, texto);
        const items = rocio(await e.construir()), incompleto = items.find(x => x.servicio.concepto === concepto);
        assert.equal(incompleto.hora, null); assert.equal(incompleto.payload, null); assert.equal(incompleto.estado, 'revisar');
        assert.equal(items.find(x => x !== incompleto).hora, hora);
    }
});

test('la duración 1 HR / 1 H nunca se reinterpreta como hora de inicio o término del grupo canónico', async () => {
    for (const duracion of ['1 HR', '1 H']) {
        for (const conHora of [true, false]) {
            const texto = masajeReal.replace('1 HORA', duracion).replace(' A LAS 11 AM', conHora ? ' A LAS 11 AM' : '');
            const e = entorno(); configurarRocio(e, texto);
            const items = rocio(await e.construir()); assert.equal(items.length, 1);
            assert.equal(items[0].hora, conHora ? '11:00' : null); assert.equal(items[0].hora_fin, null);
            assert.equal(items[0].estado, conHora ? 'listo' : 'revisar');
            if (!conHora) assert.equal(items[0].payload, null);
        }
    }
});

test('un horario completo no elimina bloqueos reales de destino o existentes ambiguos', async () => {
    for (const bloqueo of ['destino', 'existente']) {
        const e = entorno(); configurarRocio(e, masajeReal);
        if (bloqueo === 'destino') e.state.db.reservas[1].titular_nombre = 'Otra persona';
        if (bloqueo === 'existente') {
            const antes = rocio(await e.construir())[0];
            const existente = { reserva_id: antes.payload.reserva_id,
                estadia_id: antes.payload.estadia_id, catalogo_servicios: { codigo: 'masajeDescontracturante60' },
                fecha_servicio: '2026-10-24', hora_inicio: '11:00', cantidad: 1, personas: 1, tipo_cobro: 'normal', total: 45000, estado_servicio: 'activo' };
            e.state.db.servicios.push(...[88, 89].map(n => ({ ...existente, id: `00000000-0000-4000-8000-0000000000${n}` })));
        }
        const item = rocio(await e.construir())[0]; assert.notEqual(item.estado, 'listo', bloqueo);
        assert.equal(item.payload, null, bloqueo); assert.equal(e.state.escrituras.length, 0);
    }
});

for (const separador of delimitadores) {
    test(`Rocío ${JSON.stringify(separador)}: un grupo con ambas evidencias, una tarjeta y un payload`, async () => {
        const e = entorno(), reserva = configurarRocio(e, fragmentos.join(separador));
        assert.equal(reserva.servicios.length, 1);
        const s = reserva.servicios[0];
        assert.equal(s.tipo, 'descontracturante'); assert.equal(s.duracion_minutos, 60); assert.equal(s.cantidad, 1);
        assert.equal(s.semantica, 'SERVICIO_REAL'); assert.equal(s.grupo_masaje_v1.agrupado, true);
        assert.deepEqual(s.grupo_masaje_v1.fragmentos.map(f => f.texto), fragmentos);
        for (const f of s.grupo_masaje_v1.fragmentos) {
            assert.equal(reserva.texto_original.slice(f.inicio, f.fin), f.texto);
            assert.deepEqual(f.origen, origen);
        }
        for (const campo of ['cantidad', 'duracion', 'tipo', 'fecha']) assert.ok(s.grupo_masaje_v1.evidencias[campo].length);
        const antes = rocio(await e.construir()); assert.equal(antes.length, 1);
        assert.equal(antes[0].fecha, '2026-10-24'); assert.ok(antes[0].razones.includes('Falta horario del masaje.'));
        assert.ok(!antes[0].razones.some(r => /Falta tipo|Falta duración|Falta una fecha inequívoca/.test(r)));
        const id = antes[0].item_id; assert.match(id, /^srv:[a-z0-9]+$/);
        const resultado = await e.resolver(2, { hora: '17:00' }), item = rocio(resultado)[0];
        assert.equal(item.item_id, id); assert.equal(item.estado, 'listo'); assert.equal(e.manuales.size, 1);
        assert.equal(item.payload.codigo_servicio, 'masajeDescontracturante60'); assert.equal(item.payload.cantidad, 1);
        assert.equal(item.payload.servicio_manual_v1.evidencia_original.texto, fragmentos.join(separador));
        assert.equal(item.payload.servicio_manual_v1.origen.celda, 'C3');
        const out = new e.Element('div'); e.api.renderizar(resultado, out, consulta);
        assert.equal(out.querySelectorAll('.haku-libro-servicios__item').filter(row => row.textContent.includes('Rocío Leal')).length, 1);
        assert.equal(out.querySelectorAll('input[data-haku-item-id]').filter(c => c.dataset.hakuItemId === id).length, 1);
        const payloads = rocio(await e.construir()).filter(x => x.payload).map(x => x.payload);
        assert.equal(payloads.length, 1); assert.equal(new Set(payloads.map(x => x.item_id)).size, 1);
        assert.equal(e.state.escrituras.length, 0);
    });
    test(`cantidad 2 ${JSON.stringify(separador)} conserva un grupo sin unidad adicional`, () => {
        const s = parsear(['2 MASAJES DE 1 HORA', 'DESCONTRACTURANTE'].join(separador));
        assert.equal(s.length, 1); assert.equal(s[0].cantidad, 2); assert.equal(s[0].tipo, 'descontracturante');
    });
}

test('horarios distintos, cantidades independientes y dos prestaciones completas permanecen separadas', async () => {
    for (const texto of ['MASAJE 10:00 / MASAJE 15:00',
        '1 masaje de 1 hora y 1 descontracturante de 60 min',
        '1 masaje terapéutico de 60 min a las 17 hrs / 1 masaje descontracturante de 60 min a las 18 hrs',
        '1 masaje descontracturante de 60 min a las 17 hrs / DESCONTRACTURANTE DE 60 MIN A LAS 17 HRS',
        '1 masaje descontracturante de 60 min a las 17 hrs / 1 masaje descontracturante de 60 min a las 17 hrs']) {
        const e = entorno(); configurarRocio(e, texto);
        const items = rocio(await e.construir()); assert.equal(items.length, 2, texto);
        assert.equal(new Set(items.map(x => x.item_id)).size, 2, texto);
        assert.ok(items.every(x => !x.servicio.grupo_masaje_v1.agrupado));
        assert.ok(items.every(x => x.semantica === 'SERVICIO_REAL'), texto);
    }
});

test('una fecha de otro masaje separado no completa la fecha del primero', async () => {
    const e = entorno(); configurarRocio(e,
        '1 masaje terapéutico de 60 min a las 17 hrs / 1 masaje descontracturante de 60 min a las 18 hrs el 24-10');
    const items = rocio(await e.construir());
    assert.equal(items.length, 2); assert.equal(items[0].fecha, null); assert.equal(items[1].fecha, '2026-10-24');
    assert.equal(items[0].payload, null);
});

test('varias prestaciones candidatas mantienen el atributo separado y ambiguo', () => {
    const s = parsear('1 masaje de 1 hora / 1 masaje de 30 min / DESCONTRACTURANTE PARA EL 24');
    assert.equal(s.length, 3); assert.equal(s[2].semantica, 'AMBIGUO'); assert.equal(s[2].cantidad, null);
    assert.ok(s.every(x => !x.grupo_masaje_v1.agrupado));
});

test('el consumidor legado también recibe grupos canónicos y no hereda SERVICIO_REAL en atributos hijos', async () => {
    const e = entorno(), r = configurarRocio(e);
    r.servicios = [{ concepto: 'masaje', texto_original: fragmentos.join(' / ') }];
    let items = rocio(await e.construir()); assert.equal(items.length, 1);
    assert.equal(items[0].servicio.grupo_masaje_v1.fragmentos.length, 2);
    r.servicios = [{ concepto: 'masaje', texto_original: '1 masaje de 1 hora / 1 masaje de 30 min / DESCONTRACTURANTE PARA EL 24' }];
    items = rocio(await e.construir()); assert.equal(items.length, 3);
    assert.equal(items[2].semantica, 'AMBIGUO'); assert.equal(items[2].payload, null);
});

test('tipos, duración, fecha y horario contradictorios bloquean sin elegir un atributo', async () => {
    for (const texto of ['1 MASAJE DE 1 HORA / TERAPÉUTICO / DESCONTRACTURANTE',
        '1 MASAJE DE 30 MIN / DESCONTRACTURANTE DE 60 MIN',
        '1 MASAJE DE 1 HORA PARA EL 23 / DESCONTRACTURANTE PARA EL 24',
        '1 MASAJE DE 1 HORA A LAS 17:00 / DESCONTRACTURANTE A LAS 18:00']) {
        const e = entorno(); configurarRocio(e, texto);
        const items = rocio(await e.construir()); assert.ok(items.length > 1);
        assert.ok(items.every(x => x.semantica === 'AMBIGUO' && x.estado === 'revisar' && !x.payload), texto);
        assert.ok(items.every(x => !x.servicio.grupo_masaje_v1.agrupado));
    }
});

test('tipo huérfano nunca recibe cantidad default ni aprobación incorporable', async () => {
    for (const campo of ['servicios', 'notas_reserva']) {
        const s = S.servicios(fragmentos[1], { origen_campo: campo });
        assert.equal(s.length, 1); assert.equal(s[0].semantica, 'AMBIGUO'); assert.equal(s[0].cantidad, null);
        assert.equal(S.clasificarFragmentoServicio(fragmentos[1], { origen_campo: campo }).semantica, 'AMBIGUO');
    }
    const e = entorno(); configurarRocio(e, fragmentos[1]);
    const item = rocio(await e.construir())[0]; assert.equal(item.payload, null);
    await assert.rejects(e.api.confirmarServicioManual(consulta, item.item_id, { hora: '17:00' }, e.manuales, item.firmaManual), /evidencia/);
});

test('otra glosa, otro servicio o consulta corta la continuidad y no presta intención operativa', () => {
    for (const texto of ['1 MASAJE DE 1 HORA / Dejar batas en cabaña / DESCONTRACTURANTE',
        '1 MASAJE DE 1 HORA / TINAJA 19:00 / DESCONTRACTURANTE']) {
        const s = parsear(texto); assert.ok(s.every(x => !x.grupo_masaje_v1?.agrupado));
        assert.equal(s.at(-1).semantica, 'AMBIGUO');
    }
    for (const texto of ['Consultó cómo era el masaje de 1 hora / DESCONTRACTURANTE',
        '1 MASAJE DE 1 HORA POR CONFIRMAR / DESCONTRACTURANTE']) {
        const s = parsear(texto); assert.ok(s.every(x => x.semantica !== 'SERVICIO_REAL'));
    }
});

test('sin agrupación genérica: tinaja, Late y sus complementos conservan contratos', () => {
    for (const texto of ['TINAJA 1 HORA / CORTESIA', 'LATE OUT 1 HORA / CLP$10,000']) {
        const s = parsear(texto); assert.equal(s.length, 1); assert.equal(s[0].grupo_masaje_v1, undefined);
        assert.equal(s[0].intencion_cobro, 'no_determinada');
    }
});

test('para el 24 sólo resuelve una fecha válida: cero, varias, contexto inválido y contradicción quedan pendientes', async () => {
    const casos = [
        ['2026-10-23', '2026-10-25', '2026-10-24'],
        ['2026-10-25', '2026-10-26', null],
        ['2026-10-23', '2026-11-25', null],
        ['2026-02-30', '2026-03-25', null],
        ['2026-10-25', '2026-10-23', null],
        ['2026-10-24', '2026-10-24', '2026-10-24']
    ];
    for (const [inicio, fin, fecha] of casos) {
        const e = entorno(), r = configurarRocio(e);
        Object.assign(r, { fecha_checkin: inicio, fecha_checkout: fin, noches: 1 });
        Object.assign(e.state.db.reserva_estadias[1], { fecha_ingreso: inicio, fecha_salida: fin });
        const item = puro.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.prepararServicio(r, r.servicios[0], { estado: 'asociada', sistema: {} });
        assert.equal(item.fecha, fecha);
        if (!fecha) {
            const resuelto = puro.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.prepararServicio(r, r.servicios[0], { estado: 'asociada', sistema: {} }, null, { hora: '17:00' });
            assert.equal(resuelto.fecha, null); assert.equal(resuelto.payload, null);
        }
    }
    const e = entorno(), r = configurarRocio(e, fragmentos.join(' / ') + ' 25-10-2026');
    const item = rocio(await e.construir())[0]; assert.equal(item.payload, null);
    assert.ok(r.servicios.every(s => s.semantica === 'AMBIGUO'));
});

test('complementos de duración y horario quedan en el mismo grupo', () => {
    const s = parsear('1 MASAJE / DE 1 HORA / DESCONTRACTURANTE / PARA EL 24 / A LAS 17:00');
    assert.equal(s.length, 1); assert.equal(s[0].duracion_minutos, 60); assert.equal(s[0].hora, '17:00');
    assert.equal(s[0].grupo_masaje_v1.fragmentos.length, 5);
});

test('una fecha manual puede precisar el mes ambiguo pero no sustituir el día original', async () => {
    const e = entorno(), r = configurarRocio(e);
    r.fecha_checkout = '2026-11-25'; r.noches = 33; e.state.db.reserva_estadias[1].fecha_salida = r.fecha_checkout;
    let item = rocio(await e.resolver(2, { hora: '17:00', fecha: '2026-10-23' }))[0];
    assert.equal(item.payload, null); assert.match(item.razones.join(' '), /contradice el día/);
    item = rocio(await e.resolver(2, { hora: '17:00', fecha: '2026-11-24' }))[0];
    assert.equal(item.estado, 'listo'); assert.equal(item.fecha, '2026-11-24');
});

test('la resolución por noche tampoco puede sustituir para el 24 ni una fecha declarada contradictoria', () => {
    const r = { titular: 'Rocío Leal', cabana: 5, fecha_checkin: '2026-10-23', fecha_checkout: '2026-11-25', noches: 33 };
    const s = parsear(fragmentos.join(' / ') + ' A LAS 17:00')[0];
    const P = puro.HAIKU_LIBRO_SERVICIOS_SCOPE_V2, destino = { estado: 'asociada', sistema: {} };
    const item = P.prepararServicio(r, s, destino, 1);
    assert.equal(item.fecha, null); assert.equal(item.payload, null);
    assert.deepEqual(Array.from(item.opcionesNoches, n => n.fecha), ['2026-10-24', '2026-11-24']);
    assert.equal(P.prepararServicio(r, s, destino, 2).fecha, '2026-10-24');
    const contradictorio = parsear('1 MASAJE DESCONTRACTURANTE DE 1 HORA PARA EL 24 EL 25-10-2026 A LAS 17:00')[0];
    assert.equal(P.prepararServicio(r, contradictorio, destino, null, { fecha: '2026-11-24' }).payload, null);
    assert.equal(P.prepararServicio(r, contradictorio, destino).opcionesNoches.length, 0);
});

test('orígenes/reservas/estadías distintos jamás agrupan sus fragmentos', async () => {
    const e = entorno(), r = configurarRocio(e, fragmentos[0]);
    const otra = { ...r, titular: 'Otra persona', cabana: 4, coordenadas_origen: { hoja: 'Oct26', celda: 'D4' },
        texto_original: fragmentos[1], servicios: S.servicios(fragmentos[1], { origen_campo: 'notas_reserva', coordenadas_origen: { hoja: 'Oct26', celda: 'D4' } }) };
    e.state.reservas[0] = otra;
    const items = servicios(await e.construir()); assert.equal(items.length, 2);
    assert.ok(items.every(x => !x.servicio.grupo_masaje_v1.agrupado));
    assert.equal(items.find(x => x.reserva.cabana === 4).semantica, 'AMBIGUO');
});

test('identidad original estable, cambios manuales y A+B+C preservan decisiones y deselecciones', async () => {
    const e = entorno(); configurarRocio(e);
    await e.resolver(0, { codigo_servicio: 'tinajaTonel', hora: '18:00' });
    await e.resolver(2, { hora: '17:00' });
    const id = rocio(await e.construir())[0].item_id;
    await e.resolver(1, { hora: '12:20' });
    assert.equal(servicios(await e.construir()).filter(x => x.estado === 'listo').length, 3);
    const out = new e.Element('div'); e.api.estadosPorVista.set(out, { manuales: e.manuales, selecciones: new Map(), apertura: 0 });
    e.api.renderizar(await e.construir(), out, consulta);
    const check = out.querySelectorAll('input[data-haku-item-id]').find(x => x.dataset.hakuItemId === id);
    check.checked = false; check.listeners.change();
    await e.resolver(1, { hora: '12:30' }); await e.resolver(2, { hora: '18:00' });
    e.api.renderizar(await e.construir(), out, consulta);
    assert.equal(rocio(await e.construir())[0].item_id, id);
    assert.equal(out.querySelectorAll('input[data-haku-item-id]').find(x => x.dataset.hakuItemId === id).checked, false);
    assert.equal(servicios(await e.construir()).filter(x => x.estado === 'listo').length, 3);
    configurarRocio(e, '1 MASAJE DE 1 HORA / DESCONTRACTURANTE PARA EL 23');
    const actual = await e.construir(); assert.notEqual(rocio(actual)[0].item_id, id); assert.equal(rocio(actual)[0].payload, null);
    assert.equal(e.manuales.get(id).invalidada, true);
    assert.equal(servicios(actual).filter(x => x.estado === 'listo').length, 2);
});
