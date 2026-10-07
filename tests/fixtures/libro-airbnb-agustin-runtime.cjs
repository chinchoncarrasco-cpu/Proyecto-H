// Texto y campos capturados en Edge / localhost:5500/panel.html.
// Mantener el desglose, separadores e importes exactamente como fueron reportados.
const PAGO_AGUSTIN_RUNTIME = Object.freeze({
    medio_pago: 'airbnb_prepaid_card',
    monto: 165598,
    concepto: 'cab4/1noche',
    texto_original: 'El viajero ha pagado // 134.454 $ por 1 noche // 134.454 $ //\n' +
        'Comisión de servicio del viajero // 0 $ //\n' +
        'Impuesto sobre el uso de la propiedad // 25.544 $ //\n' +
        'Total (CLP) 159.998 $ //\n' +
        'Cobro del anfitrión //\n' +
        'Precio de la habitación por 1 noche 134.454 $ //\n' +
        'Comisión de servicio del anfitrión (15.5 %) -20.840 $ //\n' +
        'Impuesto sobre el uso de la propiedad // 25.544 $ //\n' +
        'Ganas 139.158 $ //\n' +
        'cab4/1noche // $165,598',
    origen: Object.freeze({hoja: 'Oct26', celda: 'BC41:BF41'}),
    fecha_comprobante: null,
    folio: null,
    bovtar: null,
    codigo_autorizacion: null
});
// El aviso real no contiene el nombre del huésped. Dejar que el parser
// determine titular y asociación, en lugar de inventarlos en el fixture.
function resultadoAgustinRuntime(semantica, hoja = require('./libro-airbnb-agustin-focalizado.cjs').hojaAgustinFocalizado()) {
    const detalle = PAGO_AGUSTIN_RUNTIME.texto_original.split(' //\ncab4/1noche')[0];
    for (const celda of hoja.celdas.filter(c => c.r === 41 && c.c >= 55 && c.c <= 57)) {
        celda.r = 40;
        if (celda.c === 55) celda.valor = detalle;
        if (celda.c === 57) celda.valor = '$165,598';
    }
    const resultado = semantica.normalizarHoja(hoja, 'Oct26');
    // Conserva literalmente los campos capturados; los demás campos y las
    // listas pagos/pagos_sin_asociacion proceden del parser real.
    Object.assign(resultado.pagos[0], PAGO_AGUSTIN_RUNTIME);
    return resultado;
}
module.exports = {PAGO_AGUSTIN_RUNTIME, resultadoAgustinRuntime};
