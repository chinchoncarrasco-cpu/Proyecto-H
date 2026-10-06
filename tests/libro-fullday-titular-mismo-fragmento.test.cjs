const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/haiku-libro-semantica-v1.js');

global.HAIKU_LIBRO_SEMANTICA = S;
const Q = require('../js/haiku-libro-consultas-v1.js');

const fecha = '2026-10-06';
const textoReal = 'FULLDAY Jean Volky Weentchel // correo@example.com // 2 ADL // +56912345678 // Pedir Rut // FC // 1 HORA DE TINAJA...';
function hoja(texto) {
    return {
        celdas: [
            ...Array.from({ length: 31 }, (_, i) => ({ r: 1, c: 2 + i * 4, valor: String(i + 1), fechaISO: `2026-10-${String(i + 1).padStart(2, '0')}` })),
            { r: 2, c: 0, valor: 'cabaña 1' },
            { r: 2, c: 22, valor: texto },
            { r: 24, c: 2, valor: 'Pagos de arriendos de hoy' },
        ],
        combinaciones: [{ s: { r: 2, c: 22 }, e: { r: 2, c: 24 } }],
    };
}
const leer = texto => S.normalizarHoja(hoja(texto), 'Oct26');
const cliente = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'test' } } } }) },
    from() {
        const query = { select() { return query; }, lte() { return query; }, gte() { return query; },
            in() { return query; }, order() { return query; }, range: async () => ({ data: [] }) };
        return query;
    },
};
async function plan(reservas) {
    const comparacion = await Q.compararSistema(reservas, cliente, { desde: fecha, hasta: fecha });
    return Q.crearPlanIncorporacion(reservas, comparacion);
}

test('Oct26 CAB 1, 06/10: FULLDAY Jean Volky Weentchel crea una reserva Full Day incorporable de $120000', async () => {
    const data = hoja(textoReal), original = structuredClone(data);
    const resultado = S.normalizarHoja(data, 'Oct26');
    assert.equal(resultado.reservas.length, 1);
    const reserva = resultado.reservas[0];
    assert.equal(reserva.titular, 'Jean Volky Weentchel');
    assert.equal(reserva.cabana, 1);
    assert.equal(reserva.id, 'Oct26!W3');
    assert.equal(reserva.tipo_estadia, 'full_day');
    assert.equal(reserva.adultos, 2);
    assert.equal(reserva.fecha_checkin, fecha);
    assert.equal(reserva.fecha_checkout, fecha);
    assert.equal(reserva.noches, 0);
    assert.deepEqual(reserva.fechas_ocupadas, [fecha]);
    assert.equal(reserva.texto_original, textoReal);
    assert.deepEqual(data, original);

    const preparacion = await plan(resultado.reservas);
    const item = preparacion.items.find(i => i.categoria === 'nuevas');
    assert.ok(item);
    assert.equal(item.seleccionado, true);
    assert.deepEqual(item.motivos, []);
    const payload = Q.serializarIncorporacion(preparacion);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].tipo, 'reserva_nueva');
    assert.equal(payload[0].reserva.titular_nombre, 'Jean Volky Weentchel');
    assert.equal(payload[0].estadias[0].cabana_numero, 1);
    assert.equal(payload[0].estadias[0].datos.tipo_estadia, 'fullday');
    assert.equal(payload[0].estadias[0].datos.adultos, 2);
    assert.equal(payload[0].estadias[0].datos.fecha_ingreso, fecha);
    assert.equal(payload[0].estadias[0].datos.fecha_salida, fecha);
    assert.equal(payload[0].estadias[0].tarifas[fecha], 120000);
});

test('FULLDAY y FULL DAY con nombre usan las mismas reglas y preservan los formatos existentes', () => {
    for (const texto of ['FULLDAY Ana Pérez // 2 ADL', 'FULL DAY Ana Pérez // 2 ADL',
        'full day Ana Pérez // 2 ADL', 'FULLDAY // Ana Pérez // 2 ADL', 'FULL DAY // Ana Pérez // 2 ADL',
        'Ana Pérez // FULLDAY // 2 ADL', 'Ana Pérez // FULL DAY // 2 ADL']) {
        const reservas = leer(texto).reservas;
        assert.equal(reservas.length, 1, texto);
        assert.equal(reservas[0].titular, 'Ana Pérez', texto);
        assert.equal(reservas[0].tipo_estadia, 'full_day', texto);
        assert.equal(reservas[0].adultos, 2, texto);
        assert.equal(reservas[0].fecha_checkin, fecha, texto);
        assert.equal(reservas[0].fecha_checkout, fecha, texto);
    }
    assert.equal(leer('FULLDAY // Ana Pérez').reservas[0].titular, 'Ana Pérez');
});

test('FULLDAY solo sigue siendo marca de disponibilidad, sin titular', () => {
    for (const texto of ['FULLDAY', 'FULL DAY']) {
        const resultado = leer(texto);
        assert.equal(resultado.reservas.length, 0, texto);
        assert.equal(resultado.bloqueos.length, 1, texto);
        assert.equal(resultado.bloqueos[0].evidencia.tipo, 'marcador_full_day', texto);
    }
});

test('el sufijo debe pasar las exclusiones existentes de etiquetas, datos, notas y nombre humano', () => {
    for (const sufijo of ['HUESPED FRECUENTE', 'HUESPED FRECUENTE TRATO ESPECIAL', 'CLIENTE FRECUENTE',
        'AIRBNB', 'BOOKING', 'FULLDAY Ana Pérez', '2 ADL', 'FC', 'correo@example.com', '+56912345678',
        'RUT documento', 'PEDIR RUT', 'NO MOVER', 'LATE CHECK OUT', 'CAMA ADICIONAL', 'MANAGER PENDIENTE',
        '1 HORA DE TINAJA', 'Ana', 'Ana Pérez 2 ADL', 'Ana Pérez + Juan Soto']) {
        const texto = `FULLDAY ${sufijo} // 2 ADL`;
        assert.equal(leer(texto).reservas.length, 0, texto);
        const conTitularSeparado = leer(`FULLDAY ${sufijo} // Jean Volky Weentchel // 2 ADL`);
        assert.equal(conTitularSeparado.reservas[0]?.titular, 'Jean Volky Weentchel', texto);
    }
});

test('varios nombres humanos siguen ambiguos aunque uno lleve FULLDAY en el mismo fragmento', () => {
    for (const texto of ['FULLDAY Ana Pérez // Juan Soto // 2 ADL',
        'Juan Soto // FULL DAY Ana Pérez // 2 ADL',
        'FULLDAY Ana Pérez // 2 ADL // +56912345678 // Juan Soto',
        'FULL DAY Ana Pérez // FULLDAY Juan Soto // 2 ADL']) {
        const resultado = leer(texto);
        assert.equal(resultado.reservas.length, 0, texto);
        assert.match(resultado.advertencias.join(' '), /varios posibles titulares/, texto);
        assert.ok(resultado.anotaciones.some(a => a.texto_original === texto), texto);
    }
});

test('Full Day con nombre en el mismo fragmento conserva mínimo 2 ADL y niños sin tarifa', async () => {
    for (const [adl, ninos, tarifa] of [[1, 0, null], [2, 0, 120000], [2, 1, 120000], [3, 2, 180000]]) {
        const resultado = leer(`FULLDAY Ana Pérez // ${adl} ADL + ${ninos} niños`);
        const preparacion = await plan(resultado.reservas);
        const payload = Q.serializarIncorporacion(preparacion);
        if (tarifa === null) {
            assert.deepEqual(payload, []);
            const item = preparacion.items.find(i => i.categoria === 'nuevas' || i.categoria === 'pendientes');
            assert.equal(item.seleccionado, false);
            assert.match(item.motivos.join(' '), /ADL|adultos/);
        } else {
            assert.equal(payload[0].estadias[0].tarifas[fecha], tarifa);
            assert.equal(payload[0].estadias[0].datos.ninos, ninos);
        }
    }
});

test('otras etiquetas no adquieren el formato de titular en el mismo fragmento', () => {
    for (const etiqueta of ['AIRBNB', 'BOOKING', 'PROMO', 'HUESPED FRECUENTE']) {
        assert.equal(leer(`${etiqueta} Ana Pérez // 2 ADL`).reservas.length, 0, etiqueta);
    }
});
