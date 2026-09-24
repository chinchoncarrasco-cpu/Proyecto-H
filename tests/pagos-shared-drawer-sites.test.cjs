const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const fuenteDrawer = fs.readFileSync(require.resolve("../js/sites-resumen-pago-v1.js"), "utf8");
const fuenteAbono = fs.readFileSync(require.resolve("../js/supabase-pago-grupo-v1.js"), "utf8");

const fecha = "2026-09-23";
const filaCruce = { numero: 9, estado_operativo: "sale-ingresa",
    ingreso_reserva_id: "reserva-entrante", ingreso_titular: "Titular entrante",
    salida_reserva_id: "reserva-saliente", salida_titular: "Titular saliente" };

function controladorAbono(filaInicial = filaCruce, { grupo = false, conModal = false } = {}) {
    let fila = { ...filaInicial };
    let saldo = 30000;
    const llamadas = [];
    const cliente = {
        async rpc(nombre, datos) {
            llamadas.push({ nombre, datos });
            if (nombre === "haiku_operacion_dia") return { data: [fila], error: null };
            if (nombre === "haiku_finanzas_grupo") return { data: { es_grupo: false }, error: null };
            if (nombre === "haiku_registrar_pago_grupo") {
                return { data: { pago_id: "pago-1" }, error: null };
            }
            throw new Error(`RPC inesperado: ${nombre}`);
        },
        from(tabla) {
            if (tabla === "reservas") {
                return { select() { return this; }, async in(_campo, ids) {
                    return { data: ids.map(id => ({ id, grupo_reserva_id: grupo ? "grupo-9" : null,
                        titular_nombre: id === "reserva-saliente" ? "Titular saliente" :
                            "Titular entrante" })), error: null };
                } };
            }
            assert.equal(tabla, "vista_estado_cargos");
            return { select() { return this; }, async eq(_campo, id) {
                assert.ok(["reserva-entrante", "reserva-saliente"].includes(id));
                return { data: [{ tipo_cargo: "alojamiento", estado: "activo",
                    monto_ajustado: 80000, aplicado_neto: 50000,
                    saldo_cargo: saldo }], error: null };
            } };
        }
    };
    const window = { haikuSupabase: cliente, haikuSesion: { id: "u1" },
        haikuTienePermiso: nombre => nombre === "pagos.registrar", addEventListener() {} };
    const seleccionados = [];
    const opciones = [];
    const select = { disabled: false, value: "", options: opciones,
        set innerHTML(_valor) { opciones.length = 0; },
        appendChild(opcion) { opciones.push(opcion); },
        dispatchEvent() { seleccionados.push(this.value); } };
    const overlay = { hidden: true };
    const document = { addEventListener() {},
        body: { style: {} }, querySelectorAll() { return []; },
        getElementById(id) {
            if (!conModal) return null;
            if (id === "haiku-pago-grupo-overlay") return overlay;
            if (id === "haiku-pago-reserva") return select;
            return null;
        },
        createElement() { return { dataset: {}, value: "", textContent: "" }; }
    };
    const contexto = vm.createContext({ window, document, fechaSeleccionada: fecha,
        setTimeout() {}, Date, Intl, Event: class Event {},
        console: { info() {}, error() {} } });
    vm.runInContext(fuenteAbono, contexto, { filename: "supabase-pago-grupo-v1.js" });
    return { api: window.HAIKU_PAGO_GRUPO_V1, llamadas, contexto,
        select, overlay, seleccionados,
        cambiarFila(nueva) { fila = { ...nueva }; },
        cambiarSaldo(nuevo) { saldo = nuevo; } };
}

test("Pagos lista reservas reales y su abono acepta ambos titulares del cruce", async () => {
    const ui = controladorAbono();
    const items = await ui.api.listarReservasDia(fecha);
    assert.deepEqual([...items.map(item => item.reservaId)],
        ["reserva-entrante", "reserva-saliente"]);
    assert.equal(await ui.api.contextoResumen("reserva-saliente", fecha), null);
    for (const [id, titular] of [["reserva-entrante", "Titular entrante"],
        ["reserva-saliente", "Titular saliente"]]) {
        const contexto = await ui.api.contextoResumen(id, fecha, "pagos", 9);
        assert.equal(contexto.reservaId, id);
        assert.equal(contexto.titular, titular);
        assert.equal(contexto.saldo, 30000);
        assert.deepEqual([...contexto.cabanas], [9]);
    }
    assert.equal(await ui.api.contextoResumen("reserva-saliente", fecha, "pagos", 8), null);
    assert.equal(await ui.api.contextoResumen("otra-reserva", fecha, "pagos", 9), null);
});

test("editar abono conserva editor real y selecciona miembro exacto de grupo", async () => {
    const ui = controladorAbono(filaCruce, { grupo: true, conModal: true });
    assert.equal(await ui.api.abrirEdicion("reserva-saliente"), true);
    assert.equal(ui.overlay.hidden, false);
    assert.equal(ui.select.value, "reserva-entrante");
    assert.deepEqual(ui.seleccionados, ["reserva-entrante"]);
    assert.equal(ui.llamadas.filter(item => item.nombre === "haiku_registrar_pago_grupo").length, 0);
    assert.equal(await ui.api.abrirEdicion("otra-reserva"), false);
    assert.deepEqual(ui.seleccionados, ["reserva-entrante"]);
});

test("Pagos revalida fecha, ID y cabaña antes del único RPC de abono", async () => {
    const ui = controladorAbono();
    const datos = { monto: 12000, medio: "Efectivo", fechaPago: fecha };
    await ui.api.registrarResumen("reserva-saliente", datos, fecha, "pagos", 9);
    let escrituras = ui.llamadas.filter(item => item.nombre === "haiku_registrar_pago_grupo");
    assert.equal(escrituras.length, 1);
    assert.equal(escrituras[0].datos.p_reserva_id, "reserva-saliente");
    assert.equal(escrituras[0].datos.p_etapa_operativa, "abono");
    await assert.rejects(ui.api.registrarResumen("reserva-saliente", datos,
        fecha, "pagos", 8), /ya no tiene saldo/);
    ui.cambiarFila({ ...filaCruce, salida_reserva_id: "otra-reserva" });
    await assert.rejects(ui.api.registrarResumen("reserva-saliente", datos,
        fecha, "pagos", 9), /ya no tiene saldo/);
    ui.contexto.fechaSeleccionada = "2026-09-24";
    assert.equal((await ui.api.listarReservasDia(fecha)).length, 0);
    await assert.rejects(ui.api.registrarResumen("reserva-entrante", datos,
        fecha, "pagos", 9), /ya no tiene saldo/);
    escrituras = ui.llamadas.filter(item => item.nombre === "haiku_registrar_pago_grupo");
    assert.equal(escrituras.length, 1);
});

function drawerPago(filaInicial = filaCruce) {
    let fila = { ...filaInicial };
    const llamadas = [];
    const eventos = {};
    const controles = Object.fromEntries(["monto", "medio", "glosa", "folio", "bovtar",
        "codaut", "fecha", "observacion", "manager"].map(nombre =>
        [nombre, { value: "", checked: false, disabled: false, focus() {} }]));
    Object.assign(controles.monto, { value: "30000" });
    controles.medio.value = "Efectivo";
    controles.fecha.value = fecha;
    controles.manager.checked = true;
    const estado = { textContent: "", dataset: {} };
    const contenido = { innerHTML: "" };
    const confirmar = { disabled: true, textContent: "Registrar pago",
        addEventListener(_nombre, receptor) { eventos.confirmar = receptor; } };
    const campo = { hidden: true, querySelector() { return { required: false }; } };
    const drawer = { hidden: true, dataset: {}, className: "", setAttribute() {},
        addEventListener() {}, contains() { return false; },
        querySelectorAll(selector) {
            return selector === "[data-pago-cerrar]" ? [{ addEventListener() {} }] :
                selector.startsWith(".sites-resumen-pago-formulario") ?
                    Object.values(controles) : [];
        },
        querySelector(selector) {
            if (selector === "[data-pago-contenido]") return contenido;
            if (selector === "[data-pago-confirmar]") return confirmar;
            if (selector === "[data-pago-estado]") return estado;
            if (selector === "[data-pago-kicker]") return { textContent: "" };
            if (selector.startsWith("[data-pago-campo=")) return campo;
            return controles[selector.match(/^\[data-pago-(\w+)\]$/)?.[1]] || null;
        } };
    const document = { body: { appendChild() {} }, createElement() { return drawer; },
        addEventListener() {} };
    const contextoFinanciero = id => ({ reservaId: id, cabana: 9, cabanas: [9],
        titular: "Titular financiero", total: 80000, saldo: 30000,
        cargos: ["cargo-1"] });
    const operador = tipo => ({
        contexto: async id => contextoFinanciero(id),
        registrar: async (...args) => { llamadas.push({ tipo, args }); },
        requisitos: () => ({})
    });
    const abono = {
        contextoResumen: async (...args) => {
            llamadas.push({ tipo: "contexto-abono", args });
            return contextoFinanciero(args[0]);
        },
        registrarResumen: async (...args) => { llamadas.push({ tipo: "abono", args }); },
        requisitosResumen: () => ({}), fechaPagoPredeterminada: () => fecha
    };
    const window = { haikuSesion: { id: "u1" },
        haikuSupabase: { async rpc(nombre, datos) {
            assert.equal(nombre, "haiku_operacion_dia");
            assert.equal(datos.p_fecha, fecha);
            return { data: [fila], error: null };
        } },
        haikuTienePermiso: nombre => ["pagos.registrar", "pagos.verificar"].includes(nombre),
        HAIKU_PAGO_CHECKIN_GRUPO_RESUMEN_V1: { contexto: async () => null },
        HAIKU_PAGO_CHECKIN_RESUMEN_V1: operador("checkin"),
        HAIKU_PAGO_CHECKOUT_RESUMEN_V1: operador("checkout"),
        HAIKU_PAGO_GRUPO_V1: abono,
        HAIKU_SITES_RESUMEN_DRAWER_V1: {
            registrar() {}, marcarDisparador() {}, sincronizar() {}
        } };
    const contexto = vm.createContext({ window, document, fechaSeleccionada: fecha,
        requestAnimationFrame() {}, Promise, Number, String, Object, JSON });
    vm.runInContext(fuenteDrawer, contexto, { filename: "sites-resumen-pago-v1.js" });
    const boton = (id, etapa, origenPagos = true) => ({ isConnected: true, hidden: false,
        dataset: { resumenPagoReservaId: id, resumenPagoEtapa: etapa,
            resumenPago: "9", ...(origenPagos ? { sitesPagosOrigen: "1",
                sitesPagosFecha: fecha } : {}) } });
    return { api: window.HAIKU_RESUMEN_PAGO_SITES_V1, drawer, contenido,
        confirmar, estado, controles, llamadas, contexto, boton,
        confirmarClick: () => eventos.confirmar(),
        cambiarFila(nueva) { fila = { ...nueva }; } };
}

test("drawer Pagos usa identidad exacta de ingreso, salida y Full Day", async () => {
    const casos = [
        [filaCruce, "reserva-entrante", "checkin", "Titular entrante"],
        [filaCruce, "reserva-saliente", "checkout", "Titular saliente"],
        [filaCruce, "reserva-saliente", "abono", "Titular saliente"],
        [{ numero: 9, estado_operativo: "fullday", fullday_reserva_id: "reserva-full",
            fullday_titular: "Titular Full Day" }, "reserva-full", "abono", "Titular Full Day"],
        [{ numero: 9, estado_operativo: "continua", continua_reserva_id: "reserva-cont",
            continua_titular: "Titular continúa" }, "reserva-cont", "abono", "Titular continúa"]
    ];
    for (const [fila, id, etapa, titular] of casos) {
        const ui = drawerPago(fila), origen = ui.boton(id, etapa);
        assert.equal(await ui.api.abrirPagoReserva(id, etapa, 9, origen), true);
        assert.match(ui.contenido.innerHTML, new RegExp(titular));
        assert.doesNotMatch(ui.contenido.innerHTML, /Abonado/);
        assert.equal(ui.confirmar.disabled, false);
        assert.equal(ui.llamadas.filter(item => ["abono", "checkin", "checkout"]
            .includes(item.tipo)).length, 0);
    }
});

test("origen Resumen no adquiere permiso de abono para ingreso o salida", async () => {
    const ui = drawerPago();
    const boton = ui.boton("reserva-entrante", "abono", false);
    assert.equal(await ui.api.abrirPagoReserva("reserva-entrante", "abono", 9, boton), false);
    assert.match(ui.estado.textContent, /reserva o la etapa de cobro cambió/);
    assert.equal(ui.llamadas.filter(item => item.tipo === "abono").length, 0);
});

test("fecha del botón e identidad obsoletas impiden el writer protegido", async () => {
    const ui = drawerPago();
    const origen = ui.boton("reserva-saliente", "abono");
    origen.dataset.sitesPagosFecha = "2026-09-22";
    assert.equal(await ui.api.abrirPagoReserva("reserva-saliente", "abono", 9, origen), false);
    assert.match(ui.estado.textContent, /fecha del pago cambió/);
    origen.dataset.sitesPagosFecha = fecha;
    assert.equal(await ui.api.abrirPagoReserva("reserva-saliente", "abono", 9, origen), true);
    origen.dataset.sitesPagosFecha = "2026-09-22";
    await ui.confirmarClick();
    assert.equal(ui.llamadas.filter(item => item.tipo === "abono").length, 0);
    assert.match(ui.estado.textContent, /acción de esta cabaña cambió/);
});

test("cambio de huésped saliente entre vista previa y confirmación bloquea abono", async () => {
    const ui = drawerPago();
    const origen = ui.boton("reserva-saliente", "abono");
    await ui.api.abrirPagoReserva("reserva-saliente", "abono", 9, origen);
    ui.cambiarFila({ ...filaCruce, salida_reserva_id: "otra-reserva",
        salida_titular: "Otro huésped" });
    await ui.confirmarClick();
    assert.equal(ui.llamadas.filter(item => item.tipo === "abono").length, 0);
    assert.match(ui.estado.textContent, /reserva o la etapa de cobro cambió/);
});

test("confirmación de abono Pagos envía origen y cabaña al mismo controlador", async () => {
    const ui = drawerPago();
    const origen = ui.boton("reserva-saliente", "abono");
    await ui.api.abrirPagoReserva("reserva-saliente", "abono", 9, origen);
    await ui.confirmarClick();
    const contexto = ui.llamadas.filter(item => item.tipo === "contexto-abono");
    const escritura = ui.llamadas.filter(item => item.tipo === "abono");
    assert.equal(contexto.length, 2);
    assert.deepEqual([...contexto[0].args], ["reserva-saliente", fecha, "pagos", 9]);
    assert.equal(escritura.length, 1);
    assert.equal(escritura[0].args[0], "reserva-saliente");
    assert.equal(escritura[0].args[3], "pagos");
    assert.equal(escritura[0].args[4], 9);
});
