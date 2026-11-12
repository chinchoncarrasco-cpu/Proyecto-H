const {test} = require("node:test");
const assert = require("node:assert/strict");
require("../js/haiku-libro-semantica-v1.js");
require("../js/haiku-libro-pagos-canon-v1.js");
const api = require("../js/haiku-cloudbeds-informes-v1.js");

const id = "9000000000001", otroId = "9000000000002";
const entrada = "2026-11-07", salida = "2026-11-09", diaPago = "2026-11-08";
const titular = "Elena Rojas Vera";
const referencia = { archivo: "Reservas.pdf", pagina: 1, fila: 2 };
const reserva = { tipo: "reserva", id, titular, entrada, salida, cabana: 4, estado: "confirmada", desdeListado: true, origenes: [referencia] };
const estadia = { titular: "Rojas Vera Elena", entrada, salida, cabana: 4, estado: "confirmada", reservaId: "r", estadiaId: "e" };
const libro = { hoja: "Nov26", cobertura: { geometria: true, pagos: true }, fechas: [entrada, diaPago, salida], reservas: [{
    titular: "Elena Rojas", fecha_checkin: entrada, fecha_checkout: salida, cabana: 4, estado_confirmacion: "confirmada_por_color",
    geometria_inequivoca: true, noches: 2, noches_texto: 2, coordenadas_origen: { hoja: "Nov26", celda: "AB7" }
}] };

const encabezado = ["Usuario", "Fecha y hora", "Fecha del servicio", "Habitación", "Nombre", "Apellido", "Núm. de reserva",
    "Código", "Código de la transacción", "Descripción", "Check-in", "Check-out", "Estado", "Nota", "Cant.", "Débito", "Crédito"];
const comprobante = "8-11-2026 Elena Rojas // BOVTAR: 001235 - folio: 000438 // débito // BOVE: 17900";
const fila = (descripcion, codigo, debito, credito, cambios = {}) => {
    const datos = ["Operador", "09/11/2026 20:12", "08/11/2026", "LC4(1)", "Elena", "Rojas Vera", id,
        "-", codigo, descripcion, "07/11/2026", "09/11/2026", "Confirmada", comprobante, 1, debito, credito];
    for (const [i, v] of Object.entries(cambios)) datos[Number(i)] = v;
    return datos;
};
const xlsx = (...filas) => api.parsearXLSX([{ hoja: "Sheet1", primeraFila: 3, filas: [encabezado, ...filas] }], "Transacciones.xlsx");
const doc = (...filas) => ({ filas });
const pagar = (...filas) => api.preparar([xlsx(...filas)]);
const comparar = (filas, cambios = {}) => api.comparar(filas, {
    proyecto: { disponible: true, reservas: [estadia], ...cambios.proyecto },
    libro: { hojas: [libro], finanzas: true, ...cambios.libro }
});

test("Transacciones conserva la fila física y separa registro, servicio y comprobante", () => {
    const d = xlsx(fila("Tarjeta de Debito - Pago Registrada", "9000", 0, 30000), ["Fecha de la transacción", "01/11/2026 - 12/11/2026"]);
    assert.equal(d.filas.length, 1);
    assert.deepEqual(d.filtros, ["Fecha de la transacción · 01/11/2026 → 12/11/2026"]);
    const [p] = d.filas;
    assert.deepEqual(p.origenes, [{ archivo: "Transacciones.xlsx", hoja: "Sheet1", fila: 4 }]);
    assert.equal(p.id, id);
    assert.equal(p.cabana, 4);
    assert.deepEqual([p.tipo, p.registradoEn, p.horaRegistro, p.servicioEn, p.medio], ["pago", salida, "20:12", diaPago, "débito"]);
    assert.deepEqual(p.comprobante, { autorizacion: "001235", folio: "000438", bove: "17900", fecha: diaPago });
});

test("Desglosa reversos, impuestos y cargos y conserva ventas sin reserva", () => {
    const d = xlsx(
        fila("Tinaja caliente", "2000", 30000, 0),
        fila("IVA", "8000", 5700, 0),
        fila("Tinaja caliente", "2000V", -30000, 0),
        fila("Webpay - Anulación Registrada", "9000V", 0, -30000),
        fila("Transferencia Bancaria - Reembolso Registrada", "9200A", 0, -30000),
        fila("Tarjeta de Debito - Pago Registrada", "9000", 0, 30000, {3:"-",4:"-",5:"-",6:"-"}),
        fila("Movimiento mixto", "9000", 500, 30000),
        fila("Pago de monto ambiguo", "9000", 0, "30,50"),
        ["Total general", null, null, null, null, null, null]
    );
    assert.deepEqual(d.filas.map(f => f.tipo), ["cargo", "impuesto", "ajuste", "anulacion", "reembolso", "pago", "movimiento", "movimiento"]);
    assert.equal(d.filas[5].id, null);
    assert.equal(d.filas[5].titular, null);
    assert.equal(d.filas[7].credito, null);
    assert.throws(() => api.parsearXLSX([{ hoja: "Otro", primeraFila: 1, filas: [["fecha", "monto"]] }], "transacciones.xlsx"), /encabezados/);
});

test("Cancelaciones cruza la misma reserva entre Excel y listado sin repetir el evento", () => {
    const [f] = api.preparar([api.parsearXLSX([{ hoja: "Sheet1", primeraFila: 1, filas: [
        ["Número de la reserva", "Fecha de cancelación", "Nombre", "Apellido", "Fecha de llegada", "Fecha de salida", "Noches de estadía", "Categoría de habitación"],
        [id, "05/11/2026", "Elena", "Rojas Vera", "07/11/2026", "09/11/2026", 2, "Cabaña Loft Clásico 4"]
    ] }], "Cancelaciones.xlsx"), doc({ ...reserva, tipo: "cancelacion", estado: "cancelada", cabana: null })]);
    assert.equal(f.tipo, "cancelacion");
    assert.equal(f.cabana, 4);
    assert.equal(f.canceladaEn, "2026-11-05");
    assert.equal(f.origenes.length, 2);
    assert.equal(f.conflicto, false);
});

test("Notas en PDF conserva el autor y las líneas del texto y coteja el titular por ID", () => {
    const xs = [30, 90, 150, 202, 253, 303, 365, 426, 503, 590, 630, 665];
    const items = [];
    const linea = (y, valores) => valores.forEach((str, n) => {
        if (str) items.push({ x: xs[n], y, h: 9, w: str.length * 4, str });
    });
    linea(81, ["Usuario", "Fecha de la", "Fecha de", "Fecha de", "Nota", "Estado de la", "Fuente de la",
        "Identificador de", "Categoría de", "Tipo de", "Estado", "Nota"]);
    linea(92, ["", "reserva", "llegada", "salida", "creada", "reserva", "reserva", "la reserva", "habitación", "nota"]);
    linea(110, ["Ana", "03/11/2026", "07/11/2026", "09/11/2026", "05/11/2026", "Confirmada", "Teléfono",
        id, "Loft (LC4(1))", "Reserva", "Activa", "Dejar dos batas"]);
    linea(121, ["Operadora", "", "", "", "12:34", "", "", "", "", "", "", "antes del ingreso."]);
    linea(568, ["Report generated on 2026-11-12"]);
    const paginas = [{ width: 841.89, height: 595.28, items }];
    assert.equal(api.esPDFNotas(paginas), true);
    const notas = api.parsearPDF(paginas, "Notas.pdf");
    assert.equal(notas.filas[0].titular, null);
    const fila = api.preparar([notas, doc(reserva)])[0];
    assert.equal(fila.titular, titular);
    assert.equal(fila.autor, "Ana Operadora");
    assert.equal(fila.nota, "Dejar dos batas antes del ingreso.");
    assert.equal(fila.horaNota, "12:34");
    assert.deepEqual(fila.contextoCloudbeds, referencia);
    const [r] = comparar([fila], { proyecto: { notasDisponibles: true, notas: new Map([["r", ["Dejar dos batas antes del ingreso."]]]) } });
    assert.equal(r.proyecto.estado, "coincide");
    assert.equal(r.libro.estado, "falta");
});

test("Identidad contextual admite nombres reordenados o abreviados y muestra fechas distintas", () => {
    const [r] = comparar([reserva]);
    assert.equal(r.proyecto.estado, "coincide");
    assert.equal(r.libro.estado, "coincide");
    const [distinta] = comparar([reserva], { proyecto: { reservas: [{ ...estadia, salida: "2026-11-10" }] } });
    assert.equal(distinta.proyecto.estado, "dato_distinto");
    assert.match(distinta.proyecto.dato, /10-11-2026/);
    assert.equal(distinta.destino.estadiaId, "e");
});

test("Cancelación con número diferente se conserva junto a la activa", () => {
    const cancelar = { ...reserva, id: otroId, tipo: "cancelacion", estado: "cancelada" };
    const [activa, cancelada] = comparar(api.preparar([doc(reserva, cancelar)]));
    assert.equal(activa.proyecto.estado, "coincide");
    assert.equal(cancelada.proyecto.estado, "por_verificar");
    assert.equal(cancelada.libro.estado, "por_verificar");
    assert.equal(cancelada.destino, undefined);
    const [vinculada] = comparar([cancelar], { proyecto: { reservas: [{ ...estadia, cloudbedsId: otroId }] } });
    assert.equal(vinculada.proyecto.estado, "dato_distinto");
});

test("Dos identificadores activos de Cloudbeds no concilian contra una sola ficha contextual", () => {
    const filas = api.preparar([doc(reserva, { ...reserva, id: otroId })]);
    const [a, b] = comparar(filas, { proyecto: { reservas: [{ ...estadia, cloudbedsId: id }] } });
    assert.equal(a.proyecto.estado, "coincide");
    assert.equal(a.libro.estado, "por_verificar");
    assert.equal(b.proyecto.estado, "por_verificar");
    assert.equal(b.libro.estado, "por_verificar");
});

test("Sin lectura de la fuente conserva la revisión y sólo declara faltantes con cobertura", () => {
    const [r] = comparar([reserva], { proyecto: { disponible: false, reservas: [] }, libro: { hojas: [] } });
    assert.deepEqual([r.proyecto.estado, r.libro.estado], ["por_verificar", "por_verificar"]);
    const [c] = comparar([reserva], { proyecto: { reservas: [] }, libro: { hojas: [{ ...libro, reservas: [] }] } });
    assert.deepEqual([c.proyecto.estado, c.libro.estado], ["falta", "falta"]);
    const [d] = comparar([reserva], { libro: { hojas: [{ ...libro, reservas: [{ ...libro.reservas[0], noches_texto: 1 }] }] } });
    assert.equal(d.libro.estado, "por_verificar");
    assert.match(d.libro.detalle, /texto del Libro indica 1/);
});

const pagoProyecto = { estado: "confirmado", tipo_movimiento: "pago", monto: 30000, moneda: "CLP", medio_pago: "tarjeta_debito",
    fecha_pago: "2026-11-09T00:30:00Z", folio: "438", codigo_autorizacion: "1235" };
const pagoLibro = { titular, cabana: 4, fecha_bloque: entrada, fecha_comprobante: diaPago, pago_recibido: true,
    estado_pago: "registrado_en_libro", monto: 30000, medio_pago: "debito", folio: "000438", bovtar: "001235", origen: { hoja: "Nov26", celda: "AB43:AE43" } };

test("Pago coteja folio y autorización, y usa la fecha del comprobante en horario Chile", () => {
    const movimientos = pagar(fila("Tarjeta de Debito - Pago Registrada", "9000", 0, 30000));
    const conPago = p => ({ pagosDisponibles: true, pagos: new Map([["r", [p]]]) });
    const [r] = comparar(movimientos, { proyecto: conPago(pagoProyecto), libro: { hojas: [{ ...libro, pagos: [pagoLibro] }] } });
    assert.equal(r.proyecto.estado, "coincide");
    assert.match(r.proyecto.dato, /08-11-2026/);
    assert.equal(r.libro.estado, "coincide");
    assert.deepEqual(r.libro.origen, pagoLibro.origen);
    const [d] = comparar(movimientos, { proyecto: conPago({ ...pagoProyecto, monto: 32000 }) });
    assert.equal(d.proyecto.estado, "dato_distinto");
    assert.match(d.proyecto.detalle, /monto/);
    const [a] = comparar(movimientos, { proyecto: conPago({ ...pagoProyecto, folio: null, codigo_autorizacion: null }) });
    assert.equal(a.proyecto.estado, "por_verificar");
    assert.match(a.proyecto.detalle, /referencia/);
});

test("Discordancia entre el medio del reporte y su nota queda explícita", () => {
    const [f] = pagar(fila("Tarjeta de Debito - Pago Registrada", "9000", 0, 30000, {13:comprobante.replace("débito", "crédito")}));
    const [r] = comparar([f], { proyecto: { pagosDisponibles: true, pagos: new Map([["r", [pagoProyecto]]]) } });
    assert.equal(r.proyecto.estado, "por_verificar");
    assert.match(r.proyecto.detalle, /registra débito.*dice crédito/);
});

test("La conciliación usa BOVTAR histórico y la celda del comprobante guardada en Proyecto H", () => {
    const movimientos = pagar(fila("Tarjeta de Debito - Pago Registrada", "9000", 0, 30000));
    const [historico] = comparar(movimientos, { proyecto: { pagosDisponibles: true, pagos: new Map([["r", [
        { ...pagoProyecto, codigo_autorizacion: null, datos_origen: { bovtar: "001235" } }
    ]]]) } });
    assert.equal(historico.proyecto.estado, "coincide");
    const [conCelda] = comparar(movimientos, {
        proyecto: { pagosDisponibles: true, pagos: new Map([["r", [
            { ...pagoProyecto, folio: null, codigo_autorizacion: null, datos_origen: { origen_libro: pagoLibro.origen } }
        ]]]) },
        libro: { hojas: [{ ...libro, pagos: [pagoLibro] }] }
    });
    assert.equal(conCelda.proyecto.estado, "coincide");
    assert.match(conCelda.proyecto.detalle, /del Libro asociado/);
});

test("Los impuestos son informativos y el cargo de masaje coteja tipo, fecha y duración", () => {
    const mov = pagar(fila("IVA", "8000", 5700, 0), fila("Terapéutico (1h)", "2000", 50000, 0));
    const [impuesto, cargo] = comparar(mov, { proyecto: { servicios: new Map([["r", [
        { concepto: "Masaje Terapéutico 60 min", monto: 50000, fecha: diaPago, estadiaId: "e" }
    ]]]) } });
    assert.equal(impuesto.proyecto.estado, "informativo");
    assert.equal(impuesto.libro.estado, "informativo");
    assert.equal(cargo.proyecto.estado, "coincide");
});

test("Reversos y duplicados no se presentan como nuevos abonos", () => {
    const pago = fila("Tarjeta de Debito - Pago Registrada", "9000", 0, 30000);
    const anula = fila("Tarjeta de Debito - Anulación Registrada", "9000V", 0, -30000, {1:"10/11/2026 10:30"});
    const despues = fila("Tarjeta de Debito - Pago Registrada", "9000", 0, 30000, {1:"11/11/2026 08:00"});
    const documentos = xlsx(pago, anula, despues, despues);
    const mov = api.preparar([documentos, documentos]);
    assert.equal(mov.length, 4);
    assert.deepEqual(mov.filter(f=>f.tipo==="pago").map(f => Boolean(f.posibleReversa)), [true, false, false]);
    assert.equal(mov[2].repetida, true);
    assert.equal(mov[0].origenes.length, 2);
    const r = comparar(mov, { proyecto: { pagosDisponibles: true } });
    assert.match(r[0].proyecto.detalle, /anulación/);
    assert.match(r[2].proyecto.detalle, /más de una vez/);
});

test("Consulta informal admite Cloudbed y conserva la acción específica de tarifas", () => {
    assert.equal(api.esSolicitud("Haku contrasta estos informes cloudbed con el libro"), true);
    assert.equal(api.esSolicitud("Compara las reservas de Cloud beds"), true);
    assert.equal(api.esSolicitud("Compara tarifas del PDF de Cloudbeds"), false);
    assert.equal(api.esSolicitud("Compara el Libro con Proyecto H"), false);
});
