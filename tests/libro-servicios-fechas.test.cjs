const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const context = { document: {}, addEventListener() {}, HAIKU_LIBRO_SEMANTICA: require('../js/haiku-libro-semantica-v1.js') };
vm.createContext(context);
// Exponer sólo en memoria las funciones puras; no se invocan consultas ni writers.
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/haiku-libro-servicios-scope-v2.js'), 'utf8')
    .replace('const api = Object.freeze({', 'const api = Object.freeze({fechaExplicita, prepararServicio, prepararNota, extraerNotasReserva, servicioYaExiste,'), context);
const P = context.HAIKU_LIBRO_SERVICIOS_SCOPE_V2;
const S = require('../js/haiku-libro-semantica-v1.js');
const reserva = { titular: 'Ignacio Figueroa', cabana: 6, fecha_checkin: '2026-09-11', fecha_checkout: '2026-09-13', noches: 2, adultos: 2, tipo_estadia: 'alojamiento' };
const asociacion = { estado: 'asociada', sistema: { id: 'fixture-estadia', reserva_id: 'fixture-reserva' } };
const servicio = texto_original => ({ concepto: 'tonel', texto_original, hora: '22:15', cortesia: false, semantica: 'SERVICIO_REAL', intencion_cobro: 'cobrable' });

test('Ignacio: real service text survives semantic parsing and resolves date, time and people', () => {
    const texto = 'tónel a las 22.15 el sáb 12-09';
    const data = { celdas: [
        { r: 1, c: 2, valor: '11 sep', fechaISO: '2026-09-11' },
        { r: 1, c: 6, valor: '12 sep', fechaISO: '2026-09-12' },
        { r: 1, c: 10, valor: '13 sep', fechaISO: '2026-09-13' },
        { r: 2, c: 0, valor: 'cabaña 6' },
        { r: 2, c: 2, valor: `Ignacio Figueroa // 2 adultos // 2 noches // ${texto}` },
        { r: 24, c: 2, valor: 'Pagos de arriendos de hoy' }
    ], combinaciones: [{ s: { r: 2, c: 2 }, e: { r: 2, c: 8 } }] };
    const r = S.normalizarHoja(data, 'Sep26').reservas[0];
    assert.equal(r.servicios[0].texto_original, texto);
    const item = P.prepararServicio(r, r.servicios[0], asociacion);
    assert.equal(item.fecha, '2026-09-12'); assert.equal(item.hora, '22:15'); assert.equal(item.personas, 2);
    assert.equal(item.mapa.codigo, 'tinajaTonel'); assert.equal(item.semantica, 'SERVICIO_REAL');
    assert.ok(item.razones.some(x => /cobrable o cortesía/i.test(x)));
});

test('partial dates work with weekday variants, Unicode dashes and no weekday', () => {
    for (const texto of ['tonel a las 22.15 el sab 12-09', 'tonel a las 22.15 el sábado 12-09',
        'tonel a las 22.15 el sáb 12–09', '12-09', 'a las 10.09 el sáb 12-09',
        'a las 22.15 el 12/09', 'a las 22.15 el 12.09', '12−09']) {
        assert.equal(P.fechaExplicita(texto, reserva), '2026-09-12', texto);
    }
    assert.equal(P.fechaExplicita('12-09', {}), null);
    assert.equal(P.fechaExplicita('31-02', reserva), null);
    assert.equal(P.fechaExplicita('12-09-2026', {}), '2026-09-12');
});

test('all weekday aliases resolve only a unique day under the existing stay bounds', () => {
    const r = { fecha_checkin: '2026-09-07', fecha_checkout: '2026-09-13' };
    const dias = [['lunes', 'lun'], ['martes', 'mar'], ['miércoles', 'miercoles', 'mie', 'mié'],
        ['jueves', 'jue'], ['viernes', 'vie'], ['sábado', 'sabado', 'sab', 'sáb'], ['domingo', 'dom']];
    dias.forEach((nombres, i) => nombres.forEach(nombre => assert.equal(P.fechaExplicita(nombre, r), `2026-09-${String(7 + i).padStart(2, '0')}`, nombre)));
    assert.equal(P.fechaExplicita('sáb', reserva), '2026-09-12');
    const larga = { ...reserva, fecha_checkout: '2026-09-20', noches: 9 };
    assert.equal(P.fechaExplicita('sáb', larga), null);
    const item = P.prepararServicio(larga, servicio('tonel el sáb'), asociacion);
    assert.equal(item.fecha, null); assert.ok(item.razones.some(x => x.includes('fecha inequívoca')));
});

test('several nights without a date stay under review; existing ready cases stay ready', () => {
    for (const texto of ['tonel a las 22.15', 'tonel a las 10.09']) {
        const item = P.prepararServicio(reserva, servicio(texto), asociacion);
        assert.equal(item.fecha, null); assert.ok(item.razones.some(x => x.includes('fecha inequívoca')));
    }
    for (const texto of ['tonel el sábado', 'tonel el 12/09/2026', 'tonel el 12.09.2026']) {
        const item = P.prepararServicio(reserva, servicio(texto), asociacion);
        assert.equal(item.fecha, '2026-09-12'); assert.equal(item.razones.length, 0);
    }
    const unaNoche = { ...reserva, noches: 1, fecha_checkout: '2026-09-12' };
    assert.equal(P.prepararServicio(unaNoche, servicio('tonel a las 22.15'), asociacion).fecha, '2026-09-11');
});

test('operational notes and existing-service detection preserve their read-only result', () => {
    const texto = 'Dejar batas en cabaña';
    assert.deepEqual(Array.from(P.extraerNotasReserva({ texto_original: texto }, [])), [texto]);
    const nota = P.prepararNota(reserva, texto, asociacion);
    assert.equal(nota.kind, 'nota'); assert.equal(nota.payload.texto, texto);
    const item = P.prepararServicio(reserva, servicio('tonel el 12/09/2026'), asociacion);
    const existentes = [{ reserva_id: 'fixture-reserva', fecha_servicio: '2026-09-12', hora_inicio: '22:15:00', catalogo_servicios: { codigo: 'tinajaTonel' } }];
    const before = JSON.stringify(existentes);
    assert.equal(P.servicioYaExiste(item, existentes), true);
    assert.equal(JSON.stringify(existentes), before);
});

test('recognized incomplete services stay pending and never become notes or service payloads', () => {
    const casos = [
        { concepto: 'cama_adicional', texto_original: 'Agregar cama adicional' },
        { concepto: 'cuna', texto_original: 'Cuna confirmada' },
        { concepto: 'tinaja', texto_original: '1 hora de tinaja' },
        { concepto: 'jacuzzi', texto_original: 'Jacuzzi por coordinar por cobrar', intencion_cobro: 'cobrable' },
        { concepto: 'tonel', texto_original: 'TONEL POR CONFIRMAR el 12/09/2026 a las 20:00', hora: '20:00' }
    ];
    for (const s of casos) {
        const item = P.prepararServicio(reserva, { ...s, semantica: 'SERVICIO_REAL' }, asociacion);
        assert.equal(item.clasificacion, 'servicio_por_confirmar', s.texto_original);
        assert.equal(item.payload, null, s.texto_original);
        assert.ok(item.razones.length, s.texto_original);
    }
    const notas = P.extraerNotasReserva({ texto_original: casos.map(x => x.texto_original).join(' // ') }, casos);
    assert.deepEqual(Array.from(notas), []);
});

test('confirmed massage and late checkout keep normal incorporation semantics', () => {
    const massage = P.prepararServicio(reserva, {
        concepto: 'masaje', texto_original: 'Masaje terapéutico 60 min 16:00 confirmado el 12/09/2026 por cobrar',
        tipo: 'terapeutico', duracion_minutos: 60, hora: '16:00', semantica: 'SERVICIO_REAL',
        clasificacion: 'servicio_confirmado', intencion_cobro: 'cobrable'
    }, asociacion);
    assert.equal(massage.clasificacion, 'servicio_confirmado');assert.equal(massage.intencion_cobro, 'cobrable');
    assert.equal(massage.payload.codigo_servicio, 'masajeTerapeutico60');assert.equal(massage.payload.tipo_cobro, 'normal');

    const late = P.prepararServicio(reserva, {
        concepto: 'lateout', texto_original: 'Late Check-out 13:00 confirmado por cobrar', hora: '13:00',
        semantica: 'SERVICIO_REAL', clasificacion: 'servicio_confirmado', intencion_cobro: 'cobrable'
    }, asociacion);
    assert.equal(late.clasificacion, 'servicio_confirmado');assert.equal(late.payload.fecha_servicio, reserva.fecha_checkout);
    assert.equal(late.payload.tipo_cobro, 'normal');
});

test('payment intent is preserved and undetermined intent is never promoted to normal', () => {
    const courtesy = P.prepararServicio(reserva, {
        concepto: 'jacuzzi', texto_original: 'Jacuzzi 20:00 el 12/09/2026 de cortesía', hora: '20:00',
        semantica: 'SERVICIO_REAL', clasificacion: 'servicio_confirmado', intencion_cobro: 'cortesia'
    }, asociacion);
    assert.equal(courtesy.intencion_cobro, 'cortesia');assert.equal(courtesy.payload.tipo_cobro, 'cortesia');

    const unknown = P.prepararServicio(reserva, {
        concepto: 'jacuzzi', texto_original: 'Jacuzzi 20:00 el 12/09/2026 confirmado', hora: '20:00',
        semantica: 'SERVICIO_REAL', clasificacion: 'servicio_confirmado', intencion_cobro: 'no_determinada'
    }, asociacion);
    assert.equal(unknown.clasificacion, 'servicio_por_confirmar');assert.equal(unknown.payload, null);
    assert.ok(unknown.razones.some(x => /no lo convertirá automáticamente en cobrable/i.test(x)));
});

test('Jacuzzi and Tonel courtesy stay free while normal Tonel remains collectible', () => {
    const prepararTinaja = (concepto, texto_original, intencion_cobro) => P.prepararServicio(reserva, {
        concepto, texto_original, hora: '20:00', semantica: 'SERVICIO_REAL',
        clasificacion: 'servicio_confirmado', intencion_cobro
    }, asociacion);

    const jacuzziCortesia = prepararTinaja('jacuzzi', 'Jacuzzi 20:00 el 12/09/2026 de cortesía', 'cortesia');
    assert.equal(jacuzziCortesia.razones.length, 0);
    assert.equal(jacuzziCortesia.payload.codigo_servicio, 'tinajaJacuzzi');
    assert.equal(jacuzziCortesia.payload.tipo_cobro, 'cortesia');
    assert.equal(jacuzziCortesia.payload.precio_manual, null);

    const tonelCortesia = prepararTinaja('tonel', 'Tonel de madera 20:00 el 12/09/2026 de cortesía', 'cortesia');
    assert.equal(tonelCortesia.razones.length, 0);
    assert.equal(tonelCortesia.payload.codigo_servicio, 'tinajaTonel');
    assert.equal(tonelCortesia.payload.tipo_cobro, 'cortesia');
    assert.equal(tonelCortesia.payload.precio_manual, null);
    assert.match(tonelCortesia.payload.motivo_cortesia, /Cortesía indicada en el Libro/i);

    const tonelNormal = prepararTinaja('tonel', 'Tonel de madera 20:00 el 12/09/2026 por cobrar', 'cobrable');
    assert.equal(tonelNormal.razones.length, 0);
    assert.equal(tonelNormal.payload.codigo_servicio, 'tinajaTonel');
    assert.equal(tonelNormal.payload.tipo_cobro, 'normal');
    assert.equal(tonelNormal.payload.motivo_cortesia, null);
});

test('real narrative service enquiries remain notes without Note + Service duplication', () => {
    const clasificar = texto => S.servicios(texto, { origen_campo: 'notas_reserva' });
    const confirmado = clasificar('Jacuzzi 20:00 confirmado por cobrar')[0];
    const texto = 'Consultó por tinaja, finalmente no reservó // Cliente pregunta precios de masaje // Jacuzzi 20:00 confirmado por cobrar';
    const candidatos = [...clasificar('Consultó por tinaja, finalmente no reservó'), ...clasificar('Cliente pregunta precios de masaje'), confirmado];
    const notas = candidatos.filter(x => x.semantica !== 'SERVICIO_REAL').map(x => x.fragmento_original);
    assert.deepEqual(notas, ['Consultó por tinaja, finalmente no reservó', 'Cliente pregunta precios de masaje']);
    assert.ok(!notas.includes(confirmado.fragmento_original));
    const nota = P.prepararNota(reserva, notas[0], asociacion);
    assert.equal(nota.clasificacion, 'nota');assert.equal(nota.payload.texto, notas[0]);
    assert.equal(Object.hasOwn(nota.payload, 'codigo_servicio'), false);
});

test('one-night service dates use the safe operational windows before matching', () => {
    const unaNoche = { ...reserva, fecha_checkin: '2026-09-11', fecha_checkout: '2026-09-12', noches: 1 };
    const prepararTinaja = texto => P.prepararServicio(unaNoche, {
        concepto: 'tinaja', texto_original: texto, semantica: 'SERVICIO_REAL', clasificacion: 'servicio_por_confirmar', intencion_cobro: 'no_determinada'
    }, asociacion);

    const tarde = prepararTinaja('dejar batas tinaja de 17:45 a 18:45');
    assert.equal(tarde.hora, '17:45');assert.equal(tarde.hora_fin, '18:45');assert.equal(tarde.fecha, unaNoche.fecha_checkin);
    assert.ok(tarde.inferencias.some(x => /15:00 y 23:15/.test(x)));

    const manana = prepararTinaja('tinaja de 10:00 a 11:00');
    assert.equal(manana.fecha, unaNoche.fecha_checkout);
    assert.equal(prepararTinaja('tinaja 14:59').fecha, unaNoche.fecha_checkout);
    assert.equal(prepararTinaja('tinaja 15:00').fecha, unaNoche.fecha_checkin);
    assert.equal(prepararTinaja('tinaja 23:15').fecha, unaNoche.fecha_checkin);

    const varias = P.prepararServicio(reserva, {
        concepto: 'tinaja', texto_original: 'tinaja de 17:45 a 18:45', semantica: 'SERVICIO_REAL', clasificacion: 'servicio_por_confirmar', intencion_cobro: 'no_determinada'
    }, asociacion);
    assert.equal(varias.fecha, null);

    const explicita = prepararTinaja('tinaja de 10:00 a 11:00 el 11/09/2026');
    assert.equal(explicita.fecha, unaNoche.fecha_checkin);
    const parcial = prepararTinaja('tinaja 17:45 el 12.09');
    assert.equal(parcial.fecha, unaNoche.fecha_checkout);assert.equal(parcial.hora, '17:45');assert.equal(parcial.hora_fin, null);
    const soloFecha = prepararTinaja('tinaja el 12.09');
    assert.equal(soloFecha.fecha, unaNoche.fecha_checkout);assert.equal(soloFecha.hora, null);
    const fueraDeVentana = prepararTinaja('tinaja de 23:16 a 23:45');
    assert.equal(fueraDeVentana.fecha, null);
    assert.equal(prepararTinaja('tinaja 07:59').fecha, null);
});
