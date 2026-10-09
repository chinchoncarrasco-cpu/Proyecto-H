const datos = require('./libro-jonathan-real.json');
function configurar(e, hoja = datos.hoja) {
    const r = e.c.HAIKU_LIBRO_SEMANTICA.normalizarHoja(hoja, datos.origen.hoja).reservas.find(r => r.coordenadas_origen.celda === datos.origen.celda);
    if (!r) throw new Error('La celda original de Jonathan no produjo reserva.');
    e.state.reservas = [r];
    e.state.db.reservas[1].titular_nombre = r.titular;
    e.state.db.cabanas[1].numero = r.cabana;
    Object.assign(e.state.db.reserva_estadias[1], { fecha_ingreso: r.fecha_checkin, fecha_salida: r.fecha_checkout });
    return r;
}
module.exports = { ...datos, configurar };
