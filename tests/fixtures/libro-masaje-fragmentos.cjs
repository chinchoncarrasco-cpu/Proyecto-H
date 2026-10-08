const S = require('../../js/haiku-libro-semantica-v1.js');
const fragmentos = ['1 MASAJE DE 1 HORA', 'DESCONTRACTURANTE PARA EL 24'];
const delimitadores = [' ', '\n', ' / ', '; '];
const masajeReal = '1 MASAJE DE 1 HORA DESCONTRACTURANTE PARA EL 24/10 A LAS 11 AM SAB 24/10 CON MÓNICA';
const tinajaReal = 'TINAJA TONEL 1 HORA EL VIERNES 23/10 A LAS 19:15 HRS';
const textoReal = `${masajeReal} // ${tinajaReal}`;
function hoja(texto = fragmentos.join(' / ')) {
    return { celdas: [
        { r: 1, c: 2, valor: '23 oct', fechaISO: '2026-10-23' },
        { r: 1, c: 6, valor: '24 oct', fechaISO: '2026-10-24' },
        { r: 1, c: 10, valor: '25 oct', fechaISO: '2026-10-25' },
        { r: 2, c: 0, valor: 'cabaña 5' },
        { r: 2, c: 2, valor: `Rocío Leal // 2 noches // 2 ADL // ${texto}` },
        { r: 24, c: 2, valor: 'Pagos de arriendos de hoy' }
    ], combinaciones: [{ s: { r: 2, c: 2 }, e: { r: 2, c: 8 } }] };
}
function configurarRocio(entorno, texto = fragmentos.join(' / ')) {
    const reserva = S.normalizarHoja(hoja(texto), 'Oct26').reservas[0];
    entorno.state.reservas[1] = reserva;
    Object.assign(entorno.state.db.reserva_estadias[1], { fecha_ingreso: reserva.fecha_checkin, fecha_salida: reserva.fecha_checkout });
    return reserva;
}
module.exports = { fragmentos, delimitadores, hoja, configurarRocio, masajeReal, tinajaReal, textoReal };
