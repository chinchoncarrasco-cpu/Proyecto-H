const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const fuente = fs.readFileSync(require.resolve("../js/sites-resumen-pago-v1.js"), "utf8");

function preparar({ etapa = "checkin", estado = "libre-ingresa", permisoVerificar = true,
    grupo = null, saldo = 30000, registrar = async () => null,
    lecturaConfirmacion = null } = {}) {
    const reservaId = "reserva-9", cabana = 9, fecha = "2026-09-23";
    const eventos = {};
    const botones = {};
    let lecturas = 0, escrituras = 0, navegaciones = 0;
    let fila = { numero: cabana, estado_operativo: estado, ingreso_reserva_id: reservaId,
        ingreso_titular: "Yann O'Connell", salida_reserva_id: reservaId,
        salida_titular: "Yann O'Connell", continua_reserva_id: reservaId,
        continua_titular: "Yann O'Connell" };
    const documento = { activeElement: null };
    const controles = Object.fromEntries(["monto", "medio", "glosa", "folio", "bovtar",
        "codaut", "fecha", "observacion", "manager"].map(nombre => [nombre, { value: "", checked: false,
            disabled: false,
            focus() { documento.activeElement = this; } }]));
    controles.monto.value = String(saldo);
    controles.medio.value = "Transferencia";
    controles.glosa.value = "Transferencia de prueba";
    controles.fecha.value = fecha;
    controles.observacion.value = "Abono del turno";
    controles.manager.checked = true;
    const estadoEl = { textContent: "", dataset: {} };
    const contenido = { innerHTML: "" };
    const kicker = { textContent: "" };
    const confirmar = { disabled: true, textContent: "Registrar pago",
        addEventListener(nombre, receptor) { botones[nombre] = receptor; } };
    const cerrar = { addEventListener() {}, focus() { documento.activeElement = this; } };
    const campos = Object.fromEntries(["glosa", "folio", "bovtar", "codaut"]
        .map(nombre => [nombre, { hidden: true, input: { required: false },
            querySelector() { return this.input; } }]));
    const drawer = {
        dataset: {}, hidden: true, className: "", innerHTML: "",
        setAttribute() {}, addEventListener() {},
        contains(elemento) { return elemento === cerrar ||
            Object.values(controles).includes(elemento); },
        querySelectorAll(selector) {
            if (selector === "[data-pago-cerrar]") return [cerrar];
            if (selector.startsWith(".sites-resumen-pago-formulario")) {
                return Object.values(controles);
            }
            return [];
        },
        querySelector(selector) {
            if (selector === "[data-pago-contenido]") return contenido;
            if (selector === "[data-pago-confirmar]") return confirmar;
            if (selector === "[data-pago-estado]") return estadoEl;
            if (selector === "[data-pago-kicker]") return kicker;
            const campo = selector.match(/^\[data-pago-campo="(.*)"\]$/);
            if (campo) return campos[campo[1]] || null;
            const valor = selector.match(/^\[data-pago-([a-z]+)\]$/);
            return valor ? controles[valor[1]] || null : null;
        }
    };
    const botonOrigen = { isConnected: true, hidden: false,
        dataset: { resumenPagoReservaId: reservaId, resumenPagoEtapa: etapa,
            resumenPago: String(cabana) } };
    const contextoBase = { reservaId, cabana, cabanas: [cabana], titular: "Yann O'Connell",
        total: 80000, saldo, cargos: ["cargo-1"] };
    const requisitos = medio => ({ glosa: medio === "Transferencia",
        folio: medio === "Tarjeta Crédito", bovtar: medio === "Tarjeta Crédito",
        codAut: medio === "WebPay Crédito" });
    const individual = { contexto: async () => ({ ...contextoBase }), requisitos,
        registrar: async (...args) => { escrituras++; return registrar(...args); } };
    const grupoApi = { contexto: async () => grupo && { ...grupo }, requisitos,
        registrar: async (...args) => { escrituras++; return registrar(...args); } };
    const checkoutApi = { contexto: async () => ({ ...contextoBase }), requisitos,
        registrar: async (...args) => { escrituras++; return registrar(...args); } };
    const abonoApi = { contextoResumen: async () => ({ ...contextoBase }),
        requisitosResumen: requisitos, fechaPagoPredeterminada: () => fecha,
        registrarResumen: async (...args) => { escrituras++; return registrar(...args); } };
    Object.assign(documento, {
        body: { appendChild() {} },
        createElement() { return drawer; },
        addEventListener(nombre, receptor) { eventos[nombre] = receptor; }
    });
    const ventana = {
        haikuSesion: { user: "u1" },
        haikuSupabase: { async rpc(nombre, args) {
            assert.equal(nombre, "haiku_operacion_dia");
            assert.equal(args.p_fecha, fecha);
            lecturas++;
            if (lecturas === 2 && lecturaConfirmacion) await lecturaConfirmacion;
            return { data: [fila], error: null };
        } },
        haikuTienePermiso: nombre => nombre === "pagos.registrar" ||
            (nombre === "pagos.verificar" && permisoVerificar),
        HAIKU_PAGO_CHECKIN_RESUMEN_V1: individual,
        HAIKU_PAGO_CHECKIN_GRUPO_RESUMEN_V1: grupoApi,
        HAIKU_PAGO_CHECKOUT_RESUMEN_V1: checkoutApi,
        HAIKU_PAGO_GRUPO_V1: abonoApi,
        HAIKU_SITES_RESUMEN_DRAWER_V1: {
            registrar() {}, marcarDisparador() {}, sincronizar() {}
        },
        HAIKU_RESUMEN_SITES_V1: { refrescar() {} }
    };
    const contexto = vm.createContext({ document: documento, window: ventana,
        fechaSeleccionada: fecha, Promise, Number, String, Object, JSON,
        requestAnimationFrame: funcion => funcion() });
    vm.runInContext(fuente, contexto, { filename: "sites-resumen-pago-v1.js" });
    return {
        api: ventana.HAIKU_RESUMEN_PAGO_SITES_V1, drawer, contenido, controles,
        confirmar, estadoEl, botonOrigen, contexto, eventos, documento, cerrar,
        confirmarClick: () => botones.click(),
        get lecturas() { return lecturas; },
        get escrituras() { return escrituras; },
        get navegaciones() { return navegaciones; },
        cambiarFila(nueva) { fila = nueva; },
        cambiarSaldo(nuevo) { contextoBase.saldo = nuevo; },
        cambiarCargos(nuevos) { contextoBase.cargos = nuevos; }
    };
}

test("Pago abre drawer con reserva exacta y saldo real sin navegar ni escribir", async () => {
    const ui = preparar();
    assert.equal(await ui.api.abrirPagoReserva("reserva-9", "checkin", 9, ui.botonOrigen), true);
    assert.equal(ui.drawer.hidden, false);
    assert.match(ui.drawer.className, /sites-resumen-drawer/);
    assert.match(ui.contenido.innerHTML, /Yann O&#039;Connell/);
    assert.match(ui.contenido.innerHTML, /\$30\.000/);
    assert.equal(ui.confirmar.disabled, false);
    assert.equal(ui.lecturas, 1);
    assert.equal(ui.escrituras, 0);
    assert.equal(ui.navegaciones, 0);
});

test("la confirmación revalida identidad y sólo llama al controlador canónico", async () => {
    const llamadas = [];
    const ui = preparar({ registrar: async (...args) => { llamadas.push(args); } });
    await ui.api.abrirPagoReserva("reserva-9", "checkin", 9, ui.botonOrigen);
    await ui.confirmarClick();
    assert.equal(ui.lecturas, 2);
    assert.equal(ui.escrituras, 1);
    assert.equal(llamadas[0][0], "reserva-9");
    assert.equal(llamadas[0][1].monto, 30000);
    assert.equal(llamadas[0][1].glosa, "Transferencia de prueba");
    assert.equal(ui.confirmar.disabled, true);
    assert.match(ui.estadoEl.textContent, /registrado/);
});

test("errores locales conservan formulario y permiten corregir antes de escribir", async () => {
    const ui = preparar();
    await ui.api.abrirPagoReserva("reserva-9", "checkin", 9, ui.botonOrigen);
    ui.controles.medio.value = "";
    await ui.confirmarClick();
    assert.match(ui.estadoEl.textContent, /medio de pago válido/);
    assert.equal(ui.escrituras, 0);
    assert.equal(ui.lecturas, 1);
    assert.equal(ui.confirmar.disabled, false);

    ui.controles.medio.value = "Transferencia";
    ui.controles.monto.value = "31000";
    await ui.confirmarClick();
    assert.match(ui.estadoEl.textContent, /monto debe/);
    ui.controles.monto.value = "12000";
    ui.controles.glosa.value = "";
    await ui.confirmarClick();
    assert.match(ui.estadoEl.textContent, /glosa/);
    ui.controles.glosa.value = "Transferencia parcial";
    ui.controles.manager.checked = false;
    await ui.confirmarClick();
    assert.match(ui.estadoEl.textContent, /Manager/);
    assert.equal(ui.escrituras, 0);

    ui.controles.manager.checked = true;
    await ui.confirmarClick();
    assert.equal(ui.escrituras, 1);
    assert.equal(ui.lecturas, 2);
});

test("estado obsoleto y falta de permiso Manager bloquean sin writer", async () => {
    const ui = preparar();
    await ui.api.abrirPagoReserva("reserva-9", "checkin", 9, ui.botonOrigen);
    ui.cambiarFila({ numero: 9, estado_operativo: "libre-ingresa",
        ingreso_reserva_id: "otra-reserva" });
    await ui.confirmarClick();
    assert.equal(ui.escrituras, 0);
    assert.match(ui.estadoEl.textContent, /reserva o la etapa de cobro cambió/);

    const sinPermiso = preparar({ permisoVerificar: false });
    await sinPermiso.api.abrirPagoReserva("reserva-9", "checkin", 9,
        sinPermiso.botonOrigen);
    assert.equal(sinPermiso.confirmar.disabled, true);
    await sinPermiso.confirmarClick();
    assert.equal(sinPermiso.escrituras, 0);
});

test("checkout usa su controlador y grupo conserva la reserva miembro", async () => {
    const salida = preparar({ etapa: "checkout", estado: "sale-libre" });
    await salida.api.abrirPagoReserva("reserva-9", "checkout", 9, salida.botonOrigen);
    await salida.confirmarClick();
    assert.equal(salida.escrituras, 1);

    const conjunto = preparar({ grupo: { reservaId: "reserva-9", cabanas: [9, 10],
        miembros: ["reserva-9", "reserva-10"], total: 120000, saldo: 30000 } });
    await conjunto.api.abrirPagoReserva("reserva-9", "checkin", 9,
        conjunto.botonOrigen);
    assert.match(conjunto.contenido.innerHTML, /Reserva conjunta/);
    await conjunto.confirmarClick();
    assert.equal(conjunto.escrituras, 1);
});

test("Continúa usa abono real con fecha de pago y sin exigir Manager de check-in", async () => {
    const llamadas = [];
    const ui = preparar({ etapa: "abono", estado: "continua",
        permisoVerificar: false, registrar: async (...args) => llamadas.push(args) });
    ui.controles.manager.checked = false;
    await ui.api.abrirPagoReserva("reserva-9", "abono", 9, ui.botonOrigen);
    assert.equal(ui.confirmar.disabled, false);
    assert.match(ui.contenido.innerHTML, /Fecha del pago/);
    assert.match(ui.contenido.innerHTML, /Nota opcional/);
    assert.match(ui.contenido.innerHTML, /Otro/);
    assert.doesNotMatch(ui.contenido.innerHTML, /Manager revisó/);
    await ui.confirmarClick();
    assert.equal(ui.escrituras, 1);
    assert.equal(llamadas[0][0], "reserva-9");
    assert.equal(llamadas[0][1].fechaPago, "2026-09-23");
    assert.equal(llamadas[0][1].observacion, "Abono del turno");
});

test("abono valida fecha, Folio y BOVTAR localmente sin consumir el drawer", async () => {
    const ui = preparar({ etapa: "abono", estado: "continua" });
    await ui.api.abrirPagoReserva("reserva-9", "abono", 9, ui.botonOrigen);
    ui.controles.medio.value = "Tarjeta Crédito";
    ui.controles.fecha.value = "";
    await ui.confirmarClick();
    assert.match(ui.estadoEl.textContent, /fecha de pago válida/);
    ui.controles.fecha.value = "2026-09-23";
    ui.controles.folio.value = "F-1";
    await ui.confirmarClick();
    assert.match(ui.estadoEl.textContent, /BOVTAR/);
    assert.equal(ui.escrituras, 0);
    assert.equal(ui.confirmar.disabled, false);
    ui.controles.bovtar.value = "B-1";
    await ui.confirmarClick();
    assert.equal(ui.escrituras, 1);
});

test("dos pulsaciones simultáneas preparan una sola escritura", async () => {
    let liberar;
    const espera = new Promise(resolve => { liberar = resolve; });
    const ui = preparar({ registrar: () => espera });
    await ui.api.abrirPagoReserva("reserva-9", "checkin", 9, ui.botonOrigen);
    const primera = ui.confirmarClick();
    const segunda = ui.confirmarClick();
    await Promise.resolve();
    assert.equal(ui.escrituras, 0);
    liberar();
    await Promise.all([primera, segunda]);
    assert.equal(ui.escrituras, 1);
});

test("durante la revalidación congela los campos y rechaza una mutación inesperada", async () => {
    let liberar;
    const pendiente = new Promise(resolve => { liberar = resolve; });
    const ui = preparar({ lecturaConfirmacion: pendiente });
    await ui.api.abrirPagoReserva("reserva-9", "checkin", 9, ui.botonOrigen);
    const confirmacion = ui.confirmarClick();
    assert.equal(ui.controles.monto.disabled, true);
    assert.equal(ui.controles.medio.disabled, true);
    ui.controles.monto.value = "1000";
    liberar();
    await confirmacion;
    assert.equal(ui.escrituras, 0);
    assert.equal(ui.controles.monto.disabled, false);
    assert.match(ui.estadoEl.textContent, /datos del pago cambiaron/);
});

test("saldo cambiado durante la vista previa impide registrar y exige reabrir", async () => {
    const ui = preparar();
    await ui.api.abrirPagoReserva("reserva-9", "checkin", 9, ui.botonOrigen);
    ui.cambiarSaldo(15000);
    await ui.confirmarClick();
    assert.equal(ui.escrituras, 0);
    assert.match(ui.estadoEl.textContent, /saldo o la reserva cambió/);
    assert.equal(ui.confirmar.disabled, true);
});

test("checkout rechaza un cargo sustituido aunque total y saldo coincidan", async () => {
    const ui = preparar({ etapa: "checkout", estado: "sale-libre" });
    await ui.api.abrirPagoReserva("reserva-9", "checkout", 9, ui.botonOrigen);
    ui.cambiarCargos(["cargo-2"]);
    await ui.confirmarClick();
    assert.equal(ui.escrituras, 0);
    assert.match(ui.estadoEl.textContent, /saldo o la reserva cambió/);
});

test("un error incierto bloquea nuevo intento hasta releer saldo", async () => {
    const ui = preparar({ registrar: async () => { throw new Error("Respuesta incierta"); } });
    await ui.api.abrirPagoReserva("reserva-9", "checkin", 9, ui.botonOrigen);
    await ui.confirmarClick();
    await ui.confirmarClick();
    assert.equal(ui.escrituras, 1);
    assert.equal(ui.confirmar.disabled, true);
    assert.match(ui.estadoEl.textContent, /verificar el saldo antes de reintentar/);
    ui.api.cerrar();
    ui.cambiarSaldo(0);
    await ui.api.abrirPagoReserva("reserva-9", "checkin", 9, ui.botonOrigen);
    assert.equal(ui.confirmar.disabled, true);
    assert.equal(ui.escrituras, 1);
});

test("al finalizar la lectura enfoca monto sólo si el foco sigue dentro del drawer", async () => {
    const ui = preparar();
    ui.cerrar.focus();
    await ui.api.abrirPagoReserva("reserva-9", "checkin", 9, ui.botonOrigen);
    assert.equal(ui.documento.activeElement, ui.controles.monto);
    ui.api.cerrar();
    const externo = {};
    ui.documento.activeElement = externo;
    await ui.api.abrirPagoReserva("reserva-9", "checkin", 9, ui.botonOrigen);
    assert.equal(ui.documento.activeElement, externo);
});
