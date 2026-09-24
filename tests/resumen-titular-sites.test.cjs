const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const fuente = fs.readFileSync(require.resolve("../js/supabase-resumen-tablero-v1.js"), "utf8");
const fuenteDatos = fs.readFileSync(require.resolve("../js/supabase-data.js"), "utf8");
const fuenteAutoridad = fs.readFileSync(require.resolve("../js/supabase-autoridad-visual-final-v1.js"), "utf8");
const fecha = "2026-09-23";
const ids = {
    yerko: "11111111-1111-4111-8111-111111111111",
    yervic: "22222222-2222-4222-8222-222222222222",
    luis: "33333333-3333-4333-8333-333333333333",
    saliente: "44444444-4444-4444-8444-444444444444",
    continua: "55555555-5555-4555-8555-555555555555",
    salida: "66666666-6666-4666-8666-666666666666",
    vieja: "77777777-7777-4777-8777-777777777777"
};

function modulo({ datos = {}, rpc = async () => ({ data: [], error: null }), filas = [] } = {}) {
    const cierre = fuente.lastIndexOf("})();");
    const codigo = `${fuente.slice(0, cierre)}\n` +
        "globalThis.__api={resumenFila,pintarFlujo,cargarHistorial,invalidarHistorial};\n})();";
    const llamadas = [];
    const contexto = vm.createContext({
        document: {
            readyState: "loading", addEventListener() {},
            querySelectorAll: () => filas
        },
        window: {
            haikuSesion: { usuario: { id: "u1" } },
            haikuSupabase: { rpc(nombre, argumentos) {
                llamadas.push([nombre, argumentos.p_fecha]);
                return rpc(nombre, argumentos);
            } },
            haikuTienePermiso: () => false
        },
        datosPorFecha: datos,
        fechaSeleccionada: "2026-09-23",
        Date, Intl, console,
        requestAnimationFrame: callback => callback()
    });
    vm.runInContext(codigo, contexto);
    return { api: contexto.__api, llamadas };
}

function fila(estado, { id = "", numero = 1, titularDOM = "Sin reserva",
    adultos = "", ninos = "" } = {}) {
    const principal = { textContent: titularDOM };
    const secundario = { textContent: "" };
    const hoy = { textContent: "" };
    const celda = { querySelector(selector) {
        if (selector === ".sites-resumen-valor") return principal;
        if (selector === ".sites-resumen-subvalor") return secundario;
        return null;
    } };
    const controles = {
        '[data-campo="estado"]': { value: estado },
        '[data-campo="adultos"]': { value: adultos },
        '[data-campo="ninos"]': { value: ninos },
        ".sites-resumen-celda--huesped": celda,
        ".titular-cabana": principal,
        [`[data-titular-cabana="${numero}"]`]: principal,
        ".sites-resumen-dia--actual .sites-resumen-dia-valor": hoy
    };
    return {
        principal, secundario, hoy,
        elemento: {
            dataset: {
                cabana: String(numero), resumenFecha: fecha, ingresoReservaId: id,
                resumenReservaId: id
            },
            querySelector: selector => controles[selector] || null
        }
    };
}

function bloqueDatos(inicio, fin) {
    const desde = fuenteDatos.indexOf(inicio);
    const hasta = fuenteDatos.indexOf(fin, desde);
    assert.ok(desde >= 0 && hasta > desde, `No se encontró ${inicio}`);
    return fuenteDatos.slice(desde, hasta);
}

function proyectarOperacion(operacion, item, dia = fecha) {
    const codigo = bloqueDatos("    function obtenerTitularPrincipal", "    async function cargarDetallesEstadias") +
        bloqueDatos("    function pintarEstadoOperacion", "    function pintarFilaOperacion");
    const contexto = vm.createContext({
        document: { querySelector: selector =>
            selector.includes(`[data-cabana="${item.elemento.dataset.cabana}"]`)
                ? item.elemento : null }
    });
    vm.runInContext(codigo, contexto);
    assert.equal(contexto.pintarEstadoOperacion(operacion, dia), item.elemento);
}

function renderProyectado({ numero, estado, operacion, datos = {},
    titularDOM = "Sin reserva", datasetPrevio = {} }) {
    const item = fila(estado, { numero, titularDOM });
    Object.assign(item.elemento.dataset, datasetPrevio);
    proyectarOperacion({ numero, estado_operativo: estado, ...operacion }, item);
    const { api, llamadas } = modulo({ datos: { [fecha]: { cabanas: { [numero]: datos } } } });
    api.resumenFila(item.elemento, fecha);
    api.pintarFlujo(item.elemento, fecha);
    assert.equal(llamadas.length, 0, "el titular proyectado no exige un segundo RPC");
    return item;
}

test("CAB 1: ingreso de Yerko conserva código y ocupación bajo el titular sin segundo RPC", () => {
    const item = renderProyectado({ numero: 1, estado: "libre-ingresa",
        operacion: { ingreso_reserva_id: ids.yerko,
            ingreso_estadia_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            ingreso_titular: "Yerko Baeza" },
        datos: { reservaId: ids.yerko, codigoHaiku: "H-20260912-01-2C1B4D",
            titular: "", adultos: 2, ninos: 1 } });
    assert.equal(item.elemento.dataset.resumenTitularReservaId, ids.yerko);
    assert.equal(item.elemento.dataset.resumenTitular, "Yerko Baeza");
    assert.equal(item.principal.textContent, "Yerko Baeza");
    assert.equal(item.secundario.textContent, "H-20260912-01-2C1B4D · 2 adultos · 1 niño");
    assert.equal(item.hoy.textContent, "Ingresa · Yerko Baeza");
});

test("CAB 2: ingreso de Yervic usa el titular del UUID de la fila", () => {
    const item = renderProyectado({ numero: 2, estado: "libre-ingresa",
        operacion: { ingreso_reserva_id: ids.yervic, ingreso_titular: "Yervic Enrique" },
        datos: { reservaId: ids.yervic, codigoHaiku: "H-20260912-02-8AEB49",
            titular: "", adultos: 2 } });
    assert.equal(item.principal.textContent, "Yervic Enrique");
    assert.equal(item.secundario.textContent, "H-20260912-02-8AEB49 · 2 adultos");
    assert.equal(item.hoy.textContent, "Ingresa · Yervic Enrique");
});

test("continúa: titular y reserva siguen unidos en la fecha seleccionada", () => {
    const item = renderProyectado({ numero: 4, estado: "continua",
        operacion: { continua_reserva_id: ids.continua,
            continua_titular: "Valentina Araya" },
        datos: { reservaId: ids.continua, codigoHaiku: "H-PRUEBA-CONTINUA",
            titular: "", adultos: 2 } });
    assert.equal(item.elemento.dataset.resumenTitularReservaId, ids.continua);
    assert.equal(item.principal.textContent, "Valentina Araya");
    assert.equal(item.hoy.textContent, "Ocupada · Valentina Araya");
});

test("sale hoy: muestra el titular saliente de esa reserva", () => {
    const item = renderProyectado({ numero: 5, estado: "sale-libre",
        operacion: { salida_reserva_id: ids.salida, salida_titular: "Martín López" },
        datos: { reservaId: ids.salida, codigoHaiku: "H-PRUEBA-SALIDA",
            titular: "", adultos: 2 } });
    assert.equal(item.elemento.dataset.resumenTitularReservaId, ids.salida);
    assert.equal(item.principal.textContent, "Martín López");
    assert.equal(item.hoy.textContent, "Sale · Martín López");
});

test("CAB 3: sale e ingresa muestra a Luis y no al huésped saliente", () => {
    const item = renderProyectado({ numero: 3, estado: "sale-ingresa",
        operacion: { salida_reserva_id: ids.saliente,
            salida_titular: "Huésped saliente", ingreso_reserva_id: ids.luis,
            ingreso_titular: "Luis Rosales" },
        datos: { reservaId: ids.luis, codigoHaiku: "H-20260912-03-B2B06A",
            titular: "", adultos: 2 } });
    assert.equal(item.elemento.dataset.resumenTitularReservaId, ids.luis);
    assert.equal(item.elemento.dataset.salidaReservaId, ids.saliente);
    assert.equal(item.principal.textContent, "Luis Rosales");
    assert.equal(item.hoy.textContent, "Sale e ingresa · Luis Rosales");
    assert.doesNotMatch(`${item.principal.textContent} ${item.hoy.textContent}`, /Huésped saliente/);
});

test("sin reserva limpia titular y UUID proyectados aun con caché local antigua", () => {
    const item = renderProyectado({ numero: 6, estado: "libre-libre",
        operacion: {},
        datos: { reservaId: ids.vieja, codigoHaiku: "H-VIEJO",
            titular: "Nombre viejo", adultos: 4 },
        titularDOM: "Nombre viejo",
        datasetPrevio: { resumenTitular: "Nombre viejo",
            resumenTitularReservaId: ids.vieja, resumenReservaId: ids.vieja } });
    assert.equal(item.elemento.dataset.resumenTitular, "");
    assert.equal(item.elemento.dataset.resumenTitularReservaId, "");
    assert.equal(item.principal.textContent, "Sin reserva");
    assert.equal(item.secundario.textContent, "Disponible hoy");
    assert.equal(item.hoy.textContent, "Libre");
});

test("UUID local viejo no contamina el titular, código ni ocupación de la reserva actual", () => {
    const item = renderProyectado({ numero: 7, estado: "libre-ingresa",
        operacion: { ingreso_reserva_id: ids.yerko, ingreso_titular: "Yerko Baeza" },
        datos: { reservaId: ids.vieja, codigoHaiku: "H-VIEJO",
            titular: "Nombre viejo", adultos: 4 },
        titularDOM: "Nombre viejo" });
    assert.equal(item.elemento.dataset.resumenTitularReservaId, ids.yerko);
    assert.equal(item.principal.textContent, "Yerko Baeza");
    assert.equal(item.secundario.textContent, "Reserva del día");
    assert.equal(item.hoy.textContent, "Ingresa · Yerko Baeza");
    assert.doesNotMatch(`${item.principal.textContent} ${item.secundario.textContent} ${item.hoy.textContent}`,
        /Nombre viejo|H-VIEJO|4 adultos/);
});

test("un titular proyectado de otro UUID no desplaza el código de la reserva visible", () => {
    const item = fila("libre-ingresa", { numero: 8, id: ids.yervic,
        titularDOM: "Nombre viejo" });
    item.elemento.dataset.resumenTitular = "Nombre viejo";
    item.elemento.dataset.resumenTitularReservaId = ids.vieja;
    const { api } = modulo({ datos: { [fecha]: { cabanas: { "8": {
        reservaId: ids.yervic, codigoHaiku: "H-PRUEBA-CAB8", adultos: 2
    } } } } });
    api.resumenFila(item.elemento, fecha);
    api.pintarFlujo(item.elemento, fecha);
    assert.equal(item.principal.textContent, "H-PRUEBA-CAB8");
    assert.equal(item.hoy.textContent, "Ingresa");
    assert.doesNotMatch(`${item.principal.textContent} ${item.hoy.textContent}`, /Nombre viejo/);
});

test("un titular proyectado para ayer no se usa en el día seleccionado", () => {
    const item = fila("libre-ingresa", { numero: 9, id: ids.yerko,
        titularDOM: "Nombre de ayer" });
    item.elemento.dataset.resumenFecha = "2026-09-22";
    item.elemento.dataset.resumenTitular = "Nombre de ayer";
    item.elemento.dataset.resumenTitularReservaId = ids.yerko;
    const { api } = modulo({ datos: { [fecha]: { cabanas: { "9": {
        reservaId: ids.yerko, codigoHaiku: "H-PRUEBA-CAB9", adultos: 2
    } } } } });
    api.resumenFila(item.elemento, fecha);
    api.pintarFlujo(item.elemento, fecha);
    assert.equal(item.principal.textContent, "Sin reserva");
    assert.equal(item.hoy.textContent, "Ingresa");
    assert.doesNotMatch(`${item.principal.textContent} ${item.hoy.textContent}`, /Nombre de ayer/);
});

test("CAB 1: el titular del RPC que alimenta HOY lidera y código/ocupación quedan secundarios", async () => {
    const datos = { "2026-09-23": { cabanas: { "1": {
        reservaId: "reserva-yerko", codigoHaiku: "H-20260912-01-2C1B4D",
        titular: "", adultos: 2, ninos: 1
    } } } };
    const item = fila("libre-ingresa", { id: "reserva-yerko" });
    const { api, llamadas } = modulo({ datos, filas: [item.elemento],
        rpc: async (_, { p_fecha }) => ({ data: p_fecha === "2026-09-23"
            ? [{ numero: 1, estado_operativo: "libre-ingresa",
                ingreso_reserva_id: "reserva-yerko", ingreso_titular: "Yerko Baeza" }]
            : [], error: null }) });

    api.resumenFila(item.elemento, "2026-09-23");
    assert.equal(item.principal.textContent, "H-20260912-01-2C1B4D",
        "el código es fallback mientras llega el RPC");
    api.cargarHistorial("2026-09-23");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(item.principal.textContent, "Yerko Baeza");
    assert.equal(item.secundario.textContent, "H-20260912-01-2C1B4D · 2 adultos · 1 niño");
    api.cargarHistorial("2026-09-23");
    assert.equal(llamadas.filter(([, fecha]) => fecha === "2026-09-23").length, 1,
        "una sola lectura RPC de HOY queda cacheada entre repintados");
});

test("reserva con titular ausente muestra su código real y no repite el código", async () => {
    const datos = { "2026-09-23": { cabanas: { "1": {
        reservaId: "reserva-sin-nombre", codigoHaiku: "H-SIN-NOMBRE", adultos: 2
    } } } };
    const item = fila("continua", { id: "reserva-sin-nombre", titularDOM: "H-VIEJO" });
    const { api } = modulo({ datos, rpc: async (_, { p_fecha }) => ({
        data: p_fecha === "2026-09-23" ? [{ numero: 1, estado_operativo: "continua",
            continua_reserva_id: "reserva-sin-nombre", continua_titular: "" }] : [],
        error: null
    }) });
    api.cargarHistorial("2026-09-23");
    await new Promise(resolve => setImmediate(resolve));
    api.resumenFila(item.elemento, "2026-09-23");
    assert.equal(item.principal.textContent, "H-SIN-NOMBRE");
    assert.equal(item.secundario.textContent, "2 adultos");
});

test("sin reserva muestra vacío aunque persista un nombre anterior en DOM o caché", () => {
    const datos = { "2026-09-23": { cabanas: { "1": {
        reservaId: "reserva-vieja", codigoHaiku: "H-VIEJO", titular: "Nombre anterior",
        adultos: 3
    } } } };
    const item = fila("libre-libre", { titularDOM: "Nombre anterior", adultos: "3" });
    const { api } = modulo({ datos });
    api.resumenFila(item.elemento, "2026-09-23");
    assert.equal(item.principal.textContent, "Sin reserva");
    assert.equal(item.secundario.textContent, "Disponible hoy");
});

test("no mezcla titular ni código de otro UUID, aunque el DOM conserve el nombre viejo", async () => {
    const datos = { "2026-09-23": { cabanas: { "1": {
        reservaId: "reserva-vieja", codigoHaiku: "H-VIEJO", titular: "Nombre viejo",
        adultos: 4
    } } } };
    const item = fila("libre-ingresa", { id: "reserva-nueva", titularDOM: "Nombre viejo", adultos: "4" });
    const { api } = modulo({ datos, rpc: async (_, { p_fecha }) => ({
        data: p_fecha === "2026-09-23" ? [{ numero: 1, estado_operativo: "libre-ingresa",
            ingreso_reserva_id: "reserva-nueva", ingreso_titular: "Yerko Baeza" }] : [],
        error: null
    }) });
    api.resumenFila(item.elemento, "2026-09-23");
    assert.equal(item.principal.textContent, "Sin titular");
    assert.doesNotMatch(item.secundario.textContent, /H-VIEJO/);
    api.cargarHistorial("2026-09-23");
    await new Promise(resolve => setImmediate(resolve));
    api.resumenFila(item.elemento, "2026-09-23");
    assert.equal(item.principal.textContent, "Yerko Baeza");
    assert.doesNotMatch(item.secundario.textContent, /H-VIEJO/);
});

test("un RPC más reciente invalida los datos locales aunque coincidan con el UUID viejo del DOM", async () => {
    const datos = { "2026-09-23": { cabanas: { "1": {
        reservaId: "reserva-vieja", codigoHaiku: "H-VIEJO", titular: "Nombre viejo",
        adultos: 4
    } } } };
    const item = fila("continua", { id: "reserva-vieja", titularDOM: "Nombre viejo", adultos: "4" });
    const { api } = modulo({ datos, rpc: async (_, { p_fecha }) => ({
        data: p_fecha === "2026-09-23" ? [{ numero: 1, estado_operativo: "continua",
            continua_reserva_id: "reserva-nueva", continua_titular: "Nombre nuevo" }] : [],
        error: null
    }) });
    api.cargarHistorial("2026-09-23");
    await new Promise(resolve => setImmediate(resolve));
    api.resumenFila(item.elemento, "2026-09-23");
    assert.equal(item.principal.textContent, "Sin titular");
    assert.equal(item.secundario.textContent, "Reserva del día");
});

test("la autoridad visual no pisa el titular verificado de una salida Sites", () => {
    const desde = fuenteAutoridad.indexOf("    function aplicarFila(");
    const hasta = fuenteAutoridad.indexOf("    function aplicarFilasFecha(", desde);
    assert.ok(desde >= 0 && hasta > desde);
    const nombre = { textContent: "H-CODIGO" };
    const estado = { value: "", options: [{ value: "sale-libre" }] };
    const articulo = {
        dataset: { cabana: "5", resumenFecha: fecha,
            resumenTitularReservaId: ids.salida, resumenTitular: "Martín López" },
        classList: { remove() {}, add() {} },
        querySelector(selector) {
            if (selector === '[data-campo="estado"]') return estado;
            if (selector.startsWith("[data-titular-cabana=")) return nombre;
            return null;
        }
    };
    const contexto = vm.createContext({
        document: { querySelector: () => articulo },
        CSS: { escape: String },
        window: { HAIKU_CHECKOUT_RESUMEN_V2: { aplicarColorFila() {} } },
        esSaleBloq: () => false,
        asegurarOpcionSaleBloq() {},
        titularPrincipal: () => "Sin titular",
        limpiarColor() {},
        aplicarFallbackColor() {}
    });
    vm.runInContext(fuenteAutoridad.slice(desde, hasta), contexto);
    const operacion = { numero: 5, estado_operativo: "sale-libre",
        salida_reserva_id: ids.salida, salida_titular: "Martín López" };
    contexto.aplicarFila(operacion, fecha);
    assert.equal(nombre.textContent, "Martín López");
    articulo.dataset.resumenTitularReservaId = ids.vieja;
    contexto.aplicarFila(operacion, fecha);
    assert.equal(nombre.textContent, "Sin titular", "un UUID distinto no conserva el nombre previo");
});
