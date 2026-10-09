// Datos sintéticos: reproduce estructura y colores del caso aprobado, sin XLSX real.
const amarillo = { rgb: 'FFFFFF00' }, rojo = { rgb: 'FFFF0000' }, negro = { rgb: 'FF000000' };
const tinaja = 'TINAJA TONEL 1 HORA PARA EL VIERNES 23/10 A LAS 19:15 HRS';
const masaje = '1 MASAJE DE 1 HORA DESCONTRACTURANTE PARA EL 24/10 A LAS 11 AM SÁB 24/10 CON MÓNICA';
const nota = 'NO MOVER RESERVA';
const run = (texto, color = amarillo) => ({ texto, font: { color: { ...color } } });

function hojaColor(runs, opciones = {}) {
    const prefijo = 'Ficticioat Apellidoat // 2 noches // 2 ADL // ';
    const enriquecido = [{ texto: prefijo, font: { color: { rgb: 'FF000000' } } }, ...runs];
    const valor = enriquecido.map(r => r.texto).join('');
    return { celdas: [
        { r: 1, c: 90, valor: '23 oct', fechaISO: '2026-10-23' },
        { r: 1, c: 94, valor: '24 oct', fechaISO: '2026-10-24' },
        { r: 1, c: 98, valor: '25 oct', fechaISO: '2026-10-25' },
        { r: 6, c: 0, valor: 'cabaña 5' },
        { r: 6, c: 90, valor, estiloId: 0, ...(opciones.sinRuns ? {} : { runs: enriquecido }) },
        { r: 24, c: 90, valor: 'Pagos de arriendos de hoy' }
    ], combinaciones: [{ s: { r: 6, c: 90 }, e: { r: 6, c: 96 } }],
    estilos: [{ font: { color: opciones.fuente || { rgb: 'FF000000' } },
        fill: { patternType: 'solid', fgColor: opciones.fondo || { rgb: 'FFB4A7D6' } } }] };
}
const rocio = () => hojaColor([run(` ${masaje} // ${tinaja} // `), run(nota, rojo)]);
function configurar(e, hoja) {
    const r = e.c.HAIKU_LIBRO_SEMANTICA.normalizarHoja(hoja, 'Oct26').reservas[0];
    e.state.reservas = [r];
    const estadia = e.state.db.reserva_estadias[1];
    const destino = e.state.db.reservas.find(x => x.id === estadia.reserva_id);
    destino.titular_nombre = r.titular;
    Object.assign(estadia, { fecha_ingreso: r.fecha_checkin, fecha_salida: r.fecha_checkout });
    return r;
}
module.exports = { amarillo, rojo, negro, tinaja, masaje, nota, run, hojaColor, rocio, configurar };
