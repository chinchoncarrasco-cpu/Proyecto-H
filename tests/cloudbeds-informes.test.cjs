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

test("Sólo ofrece incorporar un pago faltante respaldado por la misma estadía del Libro", () => {
    const movimientos = pagar(fila("Tarjeta de Debito - Pago Registrada", "9000", 0, 30000));
    const p = { ...pagoLibro, tipo_movimiento: "servicio", bove: "17900" };
    const reservaLibro = { ...libro.reservas[0], pagos: [p] };
    const fuentes = (r, extra = {}) => ({
        libro: { hojas: [{ ...libro, reservas: [r], pagos: r.pagos || [p] }] },
        proyecto: { pagosDisponibles: true, ...extra }
    });
    const [faltante] = comparar(movimientos, fuentes(reservaLibro));
    assert.deepEqual(faltante.pagoIncorporable, { reservaLibro, origen: p.origen, destino: faltante.destino });
    for (const datos of [
        fuentes(libro.reservas[0]),
        fuentes({ ...reservaLibro, pagos: [{ ...p, bove: "17901" }] }),
        fuentes(reservaLibro, { pagos: new Map([["r", [pagoProyecto]]]) }),
        fuentes(reservaLibro, { pagosDisponibles: false }),
        fuentes(reservaLibro, { reservas: [{ ...estadia, cloudbedsId: id, salida: "2026-11-10" }] })
    ]) assert.equal(comparar(movimientos, datos)[0].pagoIncorporable, null);
    const [reversado] = comparar(pagar(
        fila("Tarjeta de Debito - Pago Registrada", "9000", 0, 30000),
        fila("Tarjeta de Debito - Anulación Registrada", "9000V", 0, -30000)
    ), fuentes(reservaLibro));
    assert.equal(reversado.pagoIncorporable, null);
});

test("Incorporar desde Cloudbeds prepara y confirma sólo el comprobante elegido para el cargo de la estadía", async t => {
    require("../js/haiku-libro-pagos-destinos-v1.js");
    const libroConsultas = require("../js/haiku-libro-consultas-v1.js");
    const p = { ...pagoLibro, tipo_movimiento: "servicio", concepto: "masaje", texto_original: comprobante,
        moneda: "CLP", bove: "17900" };
    const otroPago = { ...p, tipo_movimiento: "alojamiento", concepto: "estadía", monto: 100000, folio: "001111",
        bovtar: "001112", origen: { hoja: "Nov26", celda: "AB44:AE44" } };
    const r = { ...libro.reservas[0], id: "reserva-libro", titular, tipo_estadia: "alojamiento",
        pagos: [p, otroPago], advertencias: [] };
    const servicio = { id: "s", reserva_id: "r", estadia_id: "e", fecha_servicio: entrada, hora_inicio: "19:30:00",
        cantidad: 2, total: 30000, tipo_cobro: "normal", estado_servicio: "programado", catalogo_servicios: { nombre: "Masaje Terapéutico 30 min" } };
    const cargo = { cargo_id: "c", servicio_id: servicio.id, reserva_id: "r", estadia_id: "e", tipo_cargo: "servicio",
        concepto: "Masaje", monto: 30000, monto_ajustado: 30000, aplicado_neto: 0, saldo_cargo: 30000, estado: "activo" };
    const tablas = { reserva_estadias: [{
        id: "e", reserva_id: "r", fecha_ingreso: entrada, fecha_salida: salida, estado_estadia: "checked_out",
        tipo_estadia: "alojamiento", cabanas: { numero: 4 },
        reservas: { id: "r", titular_nombre: titular, estado_reserva: "checked_out" }
    }], pagos: [], servicios: [servicio], vista_estado_cargos: [cargo] };
    const estado = { generacion: 1, version: "a".repeat(64) };
    let permite = true, autor = "operador";
    const escrituras = [], lecturas = [];
    global.HAIKU_LIBRO_RESERVA_V1 = { estado: () => estado };
    global.haikuTienePermiso = () => permite;
    t.after(() => {
        delete global.HAIKU_LIBRO_RESERVA_V1;
        delete global.haikuTienePermiso;
    });
    const cliente = {
        auth: { getSession: async () => ({ data: { session: { user: { id: autor } } } }) },
        from(tabla) {
            const consulta = { select: () => consulta, in: () => consulta, eq: () => consulta, order: () => consulta,
                lte: () => consulta, gte: () => consulta,
                range: async (a, z) => {
                    lecturas.push(tabla);
                    return { data: structuredClone((tablas[tabla] || []).slice(a, z + 1)) };
                } };
            return consulta;
        },
        async rpc(nombre, args) {
            if (nombre === "haiku_libro_aplicaciones_servicio_capacidad_v1") {
                lecturas.push(nombre);
                return { data: { version: 1, contrato: "aplicaciones_servicio_v1",
                    rpc: "haiku_incorporar_pago_servicios_libro_v1", efectivo_sin_identificador: false } };
            }
            assert.equal(nombre, "haiku_incorporar_pago_servicios_libro_v1");
            escrituras.push(args);
            if (escrituras.length === 1) throw new Error("Conexión interrumpida");
            return { data: { ok: true, pagos_creados: 1, omitidos: 0 } };
        }
    };
    const datos = { ...estado, autor, reservaLibro: r, origen: p.origen,
        destino: { reservaId: "r", estadiaId: "e", cabana: 4, fecha: entrada } };
    const preparar = (cambios = {}) => libroConsultas.prepararPagoInformeCloudbeds({ ...datos, ...cambios }, cliente);
    await assert.rejects(preparar({ destino: { ...datos.destino, estadiaId: "otra" } }), /estadía destino/);
    const revision = await preparar();
    assert.deepEqual(revision.destinos, [{ nombre: "Masaje Terapéutico 30 min", cantidad: 2, fecha: entrada, hora: "19:30", monto: 30000 }]);
    permite = false;
    await assert.rejects(revision.confirmar(), /permiso/);
    permite = true;
    autor = "otra-sesion";
    await assert.rejects(revision.confirmar(), /sesión/);
    autor = datos.autor;
    servicio.cantidad = 1;
    await assert.rejects(revision.confirmar(), /destino o los datos financieros/);
    servicio.cantidad = 2;
    cargo.saldo_cargo = 29000;
    await assert.rejects(revision.confirmar());
    cargo.saldo_cargo = 30000;
    assert.equal(escrituras.length, 0);
    lecturas.length = 0;
    await assert.rejects(revision.confirmar(), { pagoInformePendiente: true });
    assert.equal(lecturas.filter(x => x === "servicios").length, 1);
    assert.equal(lecturas.filter(x => x === "haiku_libro_aplicaciones_servicio_capacidad_v1").length, 1);
    assert.deepEqual(await revision.confirmar(), { creado: true });
    assert.deepEqual(escrituras[0], escrituras[1], "el reintento conserva la operación idempotente");
    const item = escrituras[1].p_item;
    assert.equal(item.reserva_id, "r");
    assert.deepEqual(
        [item.argumentos.p_monto, item.argumentos.p_fecha_pago, item.argumentos.p_folio, item.argumentos.p_bove],
        [p.monto, diaPago, p.folio, p.bovtar]
    );
    assert.deepEqual(item.datos_origen.origen_libro, p.origen);
    assert.deepEqual(item.datos_origen.aplicaciones_servicio_v1.aplicaciones.map(a => a.cargo_id), ["c"]);
});

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

test("WebPay de alojamiento coteja el anticipo y agrupa el comprobante contradictorio en la misma estadía", () => {
    const notaWebpay = "08-11-2026 Elena Rojas Vera // Cod Aut 012031 // CREDITO";
    const notaDebito = "07-11-2026 Elena Rojas Vera // Cod Aut 08552I // CREDITO";
    const movimientos = pagar(fila("Webpay - Pago Registrada", "9000", 0, 159840, { 13:notaWebpay }),
        fila("Tarjeta de Debito - Pago Registrada", "9000", 0, 160, { 13:notaDebito }));
    const p = { ...pagoLibro, monto:159840, moneda:"CLP", tipo_movimiento:"alojamiento", concepto:"cab4/2noche",
        medio_pago:"credito", codigo_autorizacion:"012031", folio:null, bovtar:null, texto_original:notaWebpay,
        advertencias:["El bloque del Check-In conserva su estructura, pero falta el encabezado de pagos; requiere revisión."],
        evidencia_financiera:{sector:"pagos",estructura_fila:"fecha_detalle_concepto_monto",
            columnas_ocupadas:{fecha:true,detalle:true,concepto:true,monto:true}} };
    const ficha = { ...libro.reservas[0], titular, pagos_sin_asociacion:[p] };
    const fuentes = (pago = p, extra = {}) => ({
        proyecto:{pagosDisponibles:true,...extra},
        libro:{hojas:[{...libro,reservas:[{...ficha,pagos_sin_asociacion:[pago]}],pagos:[pago]}]}
    });
    const [incorporable, revision] = comparar(movimientos, fuentes());
    assert.equal(incorporable.proyecto.estado, "falta");
    assert.equal(incorporable.libro.estado, "coincide");
    assert.equal(incorporable.pagoIncorporable.comprobanteCloudbeds.comprobante.autorizacion, "012031");
    assert.equal(revision.pagoIncorporable, null);
    assert.equal(revision.comprobante.autorizacion, "08552I");
    assert.match(revision.proyecto.detalle, /registra débito.*dice crédito/);
    const otraEstadia = {...revision, salida:"2026-11-10", destino:{...revision.destino,estadiaId:"e2"}};
    const grupos = api.agruparPagos([incorporable, otraEstadia, revision]);
    assert.deepEqual(grupos.get(incorporable), [revision, incorporable]);
    assert.equal(grupos.has(otraEstadia), false);
    assert.equal(comparar(movimientos, fuentes({...p, advertencias:["Fecha contradictoria"]}))[0].pagoIncorporable, null);
    assert.equal(comparar(movimientos, fuentes({...p, medio_pago:"debito",texto_original:"DÉBITO"}))[0].pagoIncorporable, null);
    const otroVoucher = {...pagoProyecto, monto:159840, medio_pago:"webpay_credito", codigo_autorizacion:"118877", folio:null};
    assert.ok(comparar(movimientos, fuentes(p, {pagos:new Map([["r",[otroVoucher]]])}))[0].pagoIncorporable);
    const mismoVoucher = {...otroVoucher,codigo_autorizacion:"12031"};
    assert.equal(comparar(movimientos, fuentes(p, {pagos:new Map([["r",[mismoVoucher]]])}))[0].pagoIncorporable, null);
});

test("Un abono con tarjeta requiere que coincidan tanto el folio como el BOVTAR", () => {
    const movimientos = pagar(fila("Tarjeta de Debito - Pago Registrada", "9000", 0, 30000));
    const p = {...pagoLibro, moneda:"CLP", tipo_movimiento:"alojamiento", concepto:"cab4/2noche", texto_original:comprobante};
    const compararComprobante = abono => comparar(movimientos, {proyecto:{pagosDisponibles:true},
        libro:{hojas:[{...libro,reservas:[{...libro.reservas[0],titular,pagos:[abono]}],pagos:[abono]}]}})[0];
    assert.ok(compararComprobante(p).pagoIncorporable);
    for (const campo of ["folio","bovtar"]) {
        assert.equal(compararComprobante({...p,[campo]:"009876"}).pagoIncorporable,null);
    }
});

test("El anticipo de alojamiento revalida tres lecturas y confirma el comprobante, su estadía y saldo", async t => {
    const consultas = require("../js/haiku-libro-consultas-v1.js");
    const nota = "01-11-2026 Elena Rojas Vera // Cod Aut 012031 // CREDITO";
    const monto = 159840, fecha = "2026-11-01";
    const p = { ...pagoLibro, monto, moneda:"CLP", tipo_movimiento:"alojamiento", concepto:"cab4/2noche",
        fecha_comprobante:fecha, medio_pago:"credito", codigo_autorizacion:"012031", folio:null, bovtar:null, texto_original:nota };
    const reservaLibro = { ...libro.reservas[0], id:"libro", titular, tipo_estadia:"alojamiento",
        pagos:[p], pagos_sin_asociacion:[], advertencias:[] };
    const [movimiento] = pagar(fila("Webpay - Pago Registrada", "9000", 0, monto, {13:nota}));
    const [filaLista] = comparar([movimiento], {proyecto:{pagosDisponibles:true},
        libro:{hojas:[{...libro,reservas:[reservaLibro],pagos:[p]}]}});
    const cargo = {cargo_id:"c",reserva_id:"r",estadia_id:"e",tipo_cargo:"alojamiento",estado:"activo",
        monto_ajustado:320000,saldo_cargo:320000};
    const tablas = {reserva_estadias:[{
        id:"e",reserva_id:"r",fecha_ingreso:entrada,fecha_salida:salida,estado_estadia:"confirmada",tipo_estadia:"alojamiento",
        cabanas:{numero:4},reservas:{id:"r",titular_nombre:titular,estado_reserva:"confirmada"}
    }],pagos:[],vista_estado_cargos:[cargo]};
    const estado = {generacion:1,version:"a".repeat(64)};
    global.HAIKU_LIBRO_RESERVA_V1 = {estado:() => estado};
    global.haikuTienePermiso = () => true;
    t.after(() => {
        delete global.HAIKU_LIBRO_RESERVA_V1;
        delete global.haikuTienePermiso;
    });
    const lecturas = [], escrituras = [];
    const cliente = {
        auth:{getSession:async () => ({data:{session:{user:{id:"operador"}}}})},
        from(tabla) {
            const q = {select:() => q,eq:() => q,order:() => q,lte:() => q,gte:() => q,
                range:async () => { lecturas.push(tabla); return {data:structuredClone(tablas[tabla])}; }};
            return q;
        },
        async rpc(nombre, args) {
            assert.equal(nombre,"haiku_incorporar_libro_v1");
            escrituras.push(args);
            if (escrituras.length === 1) throw Error("Conexión interrumpida");
            return {data:{ok:true,pagos_creados:1,omitidos:0}};
        }
    };
    const preparar = () => consultas.prepararPagoInformeCloudbeds({...filaLista.pagoIncorporable,...estado,autor:"operador"},cliente);
    const revision = await preparar();
    assert.deepEqual(lecturas.sort(),["pagos","reserva_estadias","vista_estado_cargos"]);
    assert.deepEqual(revision.destinos,[{nombre:"Alojamiento",saldo:320000}]);
    assert.equal(revision.medio,"WebPay Crédito");
    assert.equal(escrituras.length,0);
    cargo.saldo_cargo = 200000;
    await assert.rejects(revision.confirmar(), /datos financieros del pago cambiaron/);
    cargo.saldo_cargo = 320000;
    const duplicadoAjeno = {...pagoProyecto,id:"duplicado",reserva_id:"ajena",medio_pago:"webpay_credito",
        folio:null,codigo_autorizacion:"12031",monto,fecha_pago:fecha};
    tablas.pagos.push(duplicadoAjeno);
    await assert.rejects(preparar(), /identificador|Proyecto H|comprobante/i);
    tablas.pagos.length = 0;
    assert.equal(escrituras.length,0);
    lecturas.length = 0;
    await assert.rejects(revision.confirmar(), {pagoInformePendiente:true});
    assert.deepEqual(lecturas.sort(),["pagos","reserva_estadias","vista_estado_cargos"]);
    lecturas.length = 0;
    assert.deepEqual(await revision.confirmar(),{creado:true});
    assert.deepEqual(lecturas,[]);
    assert.deepEqual(escrituras[0],escrituras[1]);
    const [item] = escrituras[0].p_items;
    assert.deepEqual([item.tipo,item.reserva_id,item.argumentos.p_monto,item.argumentos.p_fecha_pago,item.argumentos.p_medio_pago,
        item.argumentos.p_codigo_autorizacion],["pago","r",monto,fecha,"webpay_credito","012031"]);
    assert.deepEqual(item.datos_origen.alojamiento_cloudbeds_v1,{estadia_id:"e",salida,cargos:[{id:"c",saldo:320000}]});
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
