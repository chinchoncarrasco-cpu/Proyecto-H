const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const tablero = fs.readFileSync(require.resolve("../js/supabase-resumen-tablero-v1.js"), "utf8");
const datos = fs.readFileSync(require.resolve("../js/supabase-data.js"), "utf8");
const DIA = "2026-09-23";
const SIGUIENTE = "2026-09-24";

function diferida() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

async function vaciarMicrotareas() {
    await new Promise(resolve => setImmediate(resolve));
}

function arnesHistorial() {
    const solicitudes = [];
    const fila = { dataset: { cabana: "1", resumenFecha: DIA }, hidden: false };
    const conteo = { textContent: "" };
    const mostrarTodas = { hidden: true, addEventListener() {} };
    const escuchasDocumento = new Map();
    const escuchasVentana = new Map();
    const escuchar = (mapa, tipo, receptor) => {
        const lista = mapa.get(tipo) || [];
        lista.push(receptor);
        mapa.set(tipo, lista);
    };
    const emitir = (mapa, tipo) => {
        for (const receptor of mapa.get(tipo) || []) receptor({ type: tipo });
    };
    const lista = { addEventListener() {} };
    const documento = {
        readyState: "loading",
        addEventListener: (tipo, receptor) => escuchar(escuchasDocumento, tipo, receptor),
        querySelector: selector => selector === "#seccion-resumen .sites-resumen-lista" ? lista : null,
        querySelectorAll: selector => selector.includes("sites-resumen-cabana") ? [fila] : [],
        getElementById: id => id === "resumen-cabanas-conteo" ? conteo
            : id === "resumen-mostrar-todas" ? mostrarTodas : null
    };
    const ventana = {
        haikuSesion: { usuario: { id: "usuario-anterior" } },
        haikuSupabase: {
            rpc(nombre, { p_fecha }) {
                assert.equal(nombre, "haiku_operacion_dia");
                if (p_fecha !== DIA) return Promise.resolve({ data: [], error: null });
                const carga = diferida();
                solicitudes.push(carga);
                return carga.promise;
            }
        },
        addEventListener: (tipo, receptor) => escuchar(escuchasVentana, tipo, receptor)
    };
    const contexto = vm.createContext({
        document: documento, window: ventana, fechaSeleccionada: DIA,
        datosPorFecha: {}, localStorage: { getItem: () => "[]" },
        requestAnimationFrame: callback => callback(),
        MutationObserver: class { observe() {} },
        Date, Intl, console: { warn() {} }
    });
    const cierre = tablero.lastIndexOf("})();");
    assert.ok(cierre > 0);
    vm.runInContext(`${tablero.slice(0, cierre)}\n` +
        "resumenFila = () => {}; pintarFlujo = () => {};" +
        "globalThis.__api = { iniciar, seleccionarFiltro };\n})();", contexto);
    contexto.__api.iniciar();
    contexto.__api.seleccionarFiltro("continuan");
    return {
        fila, solicitudes, conteo,
        nuevaSesion() {
            ventana.haikuSesion = { usuario: { id: "usuario-nuevo" } };
            emitir(escuchasVentana, "haiku:auth-ready");
        }
    };
}

test("cambiar de sesión invalida el historial ya cargado del filtro", async () => {
    const h = arnesHistorial();
    assert.equal(h.solicitudes.length, 1);
    h.solicitudes[0].resolve({ data: [{ numero: 1, estado_operativo: "continua" }], error: null });
    await vaciarMicrotareas();
    assert.equal(h.fila.hidden, false);

    h.nuevaSesion();
    assert.equal(h.solicitudes.length, 2,
        "la nueva sesión debe leer la operación aunque la fecha ya estuviera en caché");
    h.solicitudes[1].resolve({ data: [{ numero: 1, estado_operativo: "libre-ingresa" }], error: null });
    await vaciarMicrotareas();
    assert.equal(h.fila.hidden, true);
    assert.equal(h.conteo.textContent, "0 de 1 cabañas");
});

test("una respuesta RPC de la sesión anterior no reemplaza la operación nueva", async () => {
    const h = arnesHistorial();
    assert.equal(h.solicitudes.length, 1);
    h.nuevaSesion();
    assert.equal(h.solicitudes.length, 2,
        "se inicia otra lectura aun cuando la anterior sigue pendiente");

    h.solicitudes[1].resolve({ data: [{ numero: 1, estado_operativo: "libre-ingresa" }], error: null });
    await vaciarMicrotareas();
    assert.equal(h.fila.hidden, true);
    h.solicitudes[0].resolve({ data: [{ numero: 1, estado_operativo: "continua" }], error: null });
    await vaciarMicrotareas();
    assert.equal(h.fila.hidden, true,
        "la respuesta anterior no debe reactivar una fila bajo la nueva sesión");
});

test("cambio rápido de fecha descarta la primera carga y recupera el día visible", async () => {
    const desde = datos.indexOf("    async function cargarOperacionDia(");
    const hasta = datos.indexOf("    // Proyección de identidad del RPC", desde);
    assert.ok(desde >= 0 && hasta > desde);
    const cargas = new Map([[DIA, diferida()], [SIGUIENTE, diferida()]]);
    const llamadas = [];
    const pintadas = [];
    const eventos = [];
    const contadores = new Map(["contador-ingresan", "contador-salen", "contador-continuan"]
        .map(id => [id, { textContent: "" }]));
    const articulo = { dataset: {} };
    const contexto = vm.createContext({
        fechaSeleccionada: DIA, cargandoDia: false, ultimoDiaCargado: "",
        identidadDia: { fecha: "", filas: new Map() },
        window: { haikuSesion: {} },
        cliente: {
            rpc(nombre, { p_fecha }) {
                assert.equal(nombre, "haiku_operacion_dia");
                llamadas.push(p_fecha);
                return cargas.get(p_fecha).promise;
            }
        },
        normalizarFecha: fecha => fecha,
        fechaVisibleResumen: () => contexto.fechaSeleccionada,
        document: {
            querySelectorAll: () => [articulo],
            getElementById: id => contadores.get(id) || null,
            dispatchEvent: evento => eventos.push(evento)
        },
        CustomEvent: class {
            constructor(type, options) { this.type = type; this.detail = options.detail; }
        },
        pintarEstadoOperacion: (_, fecha) => pintadas.push(`estado:${fecha}`),
        pintarFilaOperacion: (_, __, fecha) => pintadas.push(`fila:${fecha}`),
        cargarDetallesEstadias: async () => new Map(),
        cargarContadoresRelacionados: async () => {},
        console: { info() {}, error() {} }
    });
    vm.runInContext(`${datos.slice(desde, hasta)}\n` +
        "globalThis.__cargarOperacionDia = cargarOperacionDia;", contexto);

    const primera = contexto.__cargarOperacionDia(DIA);
    contexto.fechaSeleccionada = SIGUIENTE;
    await contexto.__cargarOperacionDia(SIGUIENTE);
    assert.deepEqual(llamadas, [DIA], "la carga intermedia puede quedar en espera");

    cargas.get(DIA).resolve({ data: [{ numero: 1, estado_operativo: "continua" }], error: null });
    await primera;
    assert.deepEqual(llamadas, [DIA, SIGUIENTE]);
    assert.deepEqual(pintadas, [], "el día anterior no se pinta tras cambiar fecha");

    cargas.get(SIGUIENTE).resolve({ data: [{ numero: 1, estado_operativo: "libre-ingresa" }], error: null });
    await vaciarMicrotareas();
    assert.deepEqual(pintadas, [`estado:${SIGUIENTE}`, `fila:${SIGUIENTE}`]);
    assert.equal(contexto.identidadDia.fecha, SIGUIENTE);
    assert.deepEqual(eventos.map(evento => evento.detail.fecha), [SIGUIENTE]);
});
