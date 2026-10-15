const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/haiku-libro-semantica-v1.js');
const D = require('../js/haiku-libro-pagos-destinos-v1.js');

// Caso ficticio con la geometría real del Libro: 1 Full Day, pago en el bloque
// de Check-In, fecha de transferencia anterior y concepto de la columna financiera.
function hoja(concepto) {
    return {
        celdas: [
            {r:1,c:2,valor:'15 oct',fechaISO:'2026-10-15'},
            {r:1,c:6,valor:'16 oct',fechaISO:'2026-10-16'},
            {r:2,c:0,valor:'cabaña 1'},
            {r:2,c:2,valor:'Rodrigo Ejemplo // FULLDAY // 2 ADL'},
            {r:24,c:2,valor:'Pagos de arriendos de hoy'},
            {r:25,c:0,valor:'cabaña 1'},
            {r:26,c:2,valor:'14-10-2026',fechaISO:'2026-10-14'},
            {r:26,c:3,valor:'Rodrigo Ejemplo // Transferencia // GO'},
            {r:26,c:4,valor:concepto},
            {r:26,c:5,valor:'$120.000',valorNumero:120000}
        ],
        combinaciones: [
            {s:{r:2,c:2},e:{r:2,c:4}},
            {s:{r:25,c:0},e:{r:29,c:0}}
        ],
        estilos:[]
    };
}

for (const [concepto, tipo] of [
    ['FULLDAY','alojamiento'],
    ['FULL DAY','alojamiento'],
    ['full day','alojamiento'],
    ['FullDay','alojamiento'],
    ['alojamiento','alojamiento'],
    ['arriendo','alojamiento'],
    ['cab1/fullday','alojamiento'],
    ['tinaja','servicio'],
    ['early check in','servicio'],
    ['PENALIDAD 10%','penalidad'],
    ['FULLDAY + TINAJA','servicio'],
    ['OTRO','otro']
]) {
    test('Libro: concepto ' + concepto + ' conserva su clasificación y datos', () => {
        const resultado = S.normalizarHoja(hoja(concepto), 'Oct26');
        assert.equal(resultado.reservas.length, 1);
        assert.equal(resultado.reservas[0].tipo_estadia, 'full_day');
        assert.equal(resultado.pagos.length, 1);
        const pago = resultado.pagos[0];
        assert.equal(pago.tipo_movimiento, tipo);
        assert.equal(pago.concepto, concepto);
        assert.equal(pago.monto, 120000);
        assert.equal(pago.fecha_bloque, '2026-10-15');
        assert.equal(pago.fecha_comprobante, '2026-10-14');
        // FULLDAY es alojamiento, por tanto no debe buscar cargos de servicios.
        if (tipo === 'alojamiento') assert.deepEqual(D.aplicacionesLibro(pago), []);
    });
}
