const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const context = { document: {}, addEventListener() {} };
vm.createContext(context);
// Exponer sólo en memoria las funciones puras; no se invocan consultas ni writers.
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/haiku-libro-servicios-scope-v2.js'), 'utf8')
    .replace('const api = Object.freeze({', 'const api = Object.freeze({fechaExplicita, prepararServicio, prepararNota, extraerNotasReserva, servicioYaExiste,'), context);
const P = context.HAIKU_LIBRO_SERVICIOS_SCOPE_V2;
const S = require('../js/haiku-libro-semantica-v1.js');
const reserva = { titular: 'Ignacio Figueroa', cabana: 6, fecha_checkin: '2026-09-11', fecha_checkout: '2026-09-13', noches: 2, adultos: 2, tipo_estadia: 'alojamiento' };
const asociacion = { estado: 'asociada', sistema: { id: 'fixture-estadia', reserva_id: 'fixture-reserva' } };
const servicio = texto_original => ({ concepto: 'tonel', texto_original, hora: '22:15', cortesia: false });

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
    assert.equal(item.mapa.codigo, 'tinajaTonel'); assert.equal(item.razones.length, 0);
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
