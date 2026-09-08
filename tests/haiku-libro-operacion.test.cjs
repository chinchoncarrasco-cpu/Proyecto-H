const test = require('node:test');
const assert = require('node:assert/strict');

const base = require('../js/haiku-libro-semantica-v1.js');
global.HAIKU_LIBRO_SEMANTICA = base;

global.HAIKU_LIBRO_RESERVA_V1 = Object.freeze({
    consultarHoja: async () => ({
        reservas: [
            {
                id: 'frecuente',
                cabana: 9,
                titular: 'HUESPED FRECUENTE',
                fecha_checkin: '2026-10-09',
                fecha_checkout: '2026-10-12',
                texto_original: 'HUESPED FRECUENTE // Maria Ejemplo // 3 Adultos',
                notas_importantes: [],
                pagos: [],
                pagos_sin_asociacion: [],
                coordenadas_origen: { hoja: 'Oct26', celda: 'J20' },
                formato: { fondo: 'B4A7D6' }
            },
            {
                id: 'trato-especial',
                cabana: 5,
                titular: 'HUESPED FRECUENTE TRATO ESPECIAL',
                fecha_checkin: '2026-10-09',
                fecha_checkout: '2026-10-12',
                texto_original: 'HUESPED FRECUENTE TRATO ESPECIAL // Pedro Ejemplo // 2 Adultos + 1 Mascota',
                notas_importantes: [],
                pagos: [],
                pagos_sin_asociacion: [],
                coordenadas_origen: { hoja: 'Oct26', celda: 'F25' },
                formato: { fondo: 'D5A6BD' }
            },
            {
                id: 'late',
                cabana: 9,
                titular: 'LATE CHECK OUT',
                fecha_checkin: '2026-10-12',
                fecha_checkout: '2026-10-13',
                texto_original: 'LATE CHECK OUT',
                notas_importantes: [],
                pagos: [],
                pagos_sin_asociacion: [],
                coordenadas_origen: { hoja: 'Oct26', celda: 'N31' },
                formato: { fondo: 'FF0000' }
            }
        ],
        pagos: [],
        espacios: [
            {
                fecha: '2026-10-08',
                cabana: 5,
                estado: 'bloque_o_marca',
                texto_original: 'FULLDAY',
                origen: { hoja: 'Oct26', celda: 'E25' }
            }
        ],
        anotaciones: []
    })
});

require('../js/haiku-libro-lenguaje-natural-v1.js');

test('HUESPED FRECUENTE es nota y no reemplaza al titular real', async () => {
    const data = await global.HAIKU_LIBRO_RESERVA_V1.consultarHoja('Oct26');
    const frecuente = data.reservas.find(r => r.id === 'frecuente');
    const especial = data.reservas.find(r => r.id === 'trato-especial');

    assert.equal(frecuente.titular, 'Maria Ejemplo');
    assert.deepEqual(frecuente.notas_importantes, ['HUESPED FRECUENTE']);

    assert.equal(especial.titular, 'Pedro Ejemplo');
    assert.deepEqual(especial.notas_importantes, ['HUESPED FRECUENTE TRATO ESPECIAL']);
});

test('FULLDAY exacto marca la noche anterior como bloqueada por el FullDay siguiente', async () => {
    const data = await global.HAIKU_LIBRO_RESERVA_V1.consultarHoja('Oct26');
    const marca = data.espacios.find(x => x.subtipo === 'fullday_dia_siguiente');

    assert.ok(marca);
    assert.equal(marca.fecha, '2026-10-08');
    assert.equal(marca.fecha_fullday, '2026-10-09');
    assert.equal(marca.estado, 'bloqueo_previo_fullday');
    assert.equal(marca.bloquea_alojamiento_nocturno, true);
    assert.deepEqual(marca.horario_fullday, { ingreso: '09:30', salida: '21:30' });
    assert.equal(marca.checkout_alojamiento_estandar, '12:00');
});

test('LATE CHECK OUT rojo no se convierte en un huésped inventado', async () => {
    const data = await global.HAIKU_LIBRO_RESERVA_V1.consultarHoja('Oct26');

    assert.equal(data.reservas.some(r => r.id === 'late'), false);
    const marca = data.espacios.find(x => x.subtipo === 'late_check_out');
    assert.ok(marca);
    assert.equal(marca.estado, 'bloqueo_operativo');
    assert.equal(marca.bloquea_venta, true);
});
