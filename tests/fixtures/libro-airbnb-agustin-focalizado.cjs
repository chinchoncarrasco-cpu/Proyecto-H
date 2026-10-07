// Ancla Oct26 BC6 y fechas del caso reportado. El item no se fabrica:
// se obtiene mediante parser, canon, compatibilidad, proxy focalizado y plan reales.
const SOLICITUD_AGUSTIN = 'Haku revisa los pagos de Agustin Rampa Spinelli del 14 de octubre de 2026 para agregarlos a Proyecto H';
function hojaAgustinFocalizado() {
    const celdas = [], combinaciones = [];
    const cell = (r, c, valor, extra = {}) => celdas.push({r, c, valor, ...extra});
    for (let d = 1; d <= 31; d++) cell(1, 2 + (d - 1) * 4, String(d), {fechaISO: `2026-10-${String(d).padStart(2, '0')}`});
    for (let cab = 1; cab <= 11; cab++) cell(cab + 1, 0, `cabaña ${cab}`);
    cell(5, 54, 'AIRBNB // Agustin Rampa Spinelli // 2 ADL // 0 niños // 0 mascotas');
    combinaciones.push({s: {r: 5, c: 54}, e: {r: 5, c: 56}});
    cell(24, 54, 'Pagos de arriendos de hoy');
    cell(40, 0, 'cabaña 4');
    combinaciones.push({s: {r: 40, c: 0}, e: {r: 44, c: 0}});
    cell(41, 55, ['Agustin Rampa Spinelli // El viajero ha pagado ...',
        'Comisión de servicio del viajero ...', 'Impuesto sobre el uso de la propiedad ...',
        'Precio de la habitación ...', 'Comisión de servicio del anfitrión ...', 'Ganás ...'].join('\n'));
    cell(41, 56, 'cab4/1noche');
    cell(41, 57, '$165.598', {valorNumero: 165598});
    return {celdas, combinaciones};
}
module.exports = {SOLICITUD_AGUSTIN, hojaAgustinFocalizado};
