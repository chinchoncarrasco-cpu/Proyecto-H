const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const source = fs.readFileSync(require.resolve("../js/supabase-resumen-tablero-v1.js"), "utf8");

const DIA = "2026-09-23";
const OTRO_DIA = "2026-09-24";
const TIPOS = ["continuan", "ingresan", "salen", "servicios", "pagos"];

class Nodo {
    constructor({ id = "", dataset = {}, attributes = {}, textContent = "" } = {}) {
        this.id = id;
        this.dataset = { ...dataset };
        this.attributes = new Map(Object.entries(attributes));
        this.textContent = textContent;
        this.hidden = false;
        this.style = {};
        this.parentElement = null;
        this.listeners = new Map();
        this.classes = new Set();
        this.classList = {
            add: (...names) => names.forEach(name => this.classes.add(name)),
            remove: (...names) => names.forEach(name => this.classes.delete(name)),
            contains: name => this.classes.has(name),
            toggle: (name, force) => {
                const add = force === undefined ? !this.classes.has(name) : Boolean(force);
                add ? this.classes.add(name) : this.classes.delete(name);
                return add;
            }
        };
        this.nodes = new Map();
    }
    addEventListener(type, callback) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(callback);
        this.listeners.set(type, listeners);
    }
    emit(type, target = this, extras = {}) {
        const event = { type, target, key: extras.key, repeat: false,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.stopped = true; } };
        for (let current = this; current && !event.stopped; current = current.parentElement) {
            for (const callback of current.listeners.get(type) || []) callback(event);
        }
        return event;
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    closest(selector) {
        for (let current = this; current; current = current.parentElement) {
            if (selector.includes("data-resumen-filtro") && current.dataset.resumenFiltro) return current;
            if (selector.includes("data-resumen-expandir") && current.dataset.resumenExpandir) return current;
            if (selector.includes("data-resumen-ficha-cabana") && current.dataset.resumenFichaCabana) return current;
            if (selector.includes("sites-resumen-cabana") && current.dataset.cabana) return current;
        }
        return null;
    }
    querySelector(selector) { return this.nodes.get(selector) || null; }
    querySelectorAll(selector) { return this.nodes.get(selector) || []; }
}

function arnes() {
    const rows = Array.from({ length: 11 }, (_, index) => {
        const number = index + 1;
        const row = new Nodo({ dataset: { cabana: String(number), resumenFecha: DIA } });
        row.nodes.set('[data-campo="estado"]', { value: "libre-libre" });
        row.nodes.set('[data-campo="servicio"]', { value: number === 5 ? "Tinaja de texto" : "" });
        const cobros = new Nodo();
        cobros.nodes.set(".sites-resumen-valor", new Nodo({ textContent: "—" }));
        cobros.nodes.set(".sites-resumen-subvalor", new Nodo());
        row.nodes.set(".sites-resumen-celda--cobros", cobros);
        const detail = new Nodo({ dataset: { resumenExpandir: String(number) },
            attributes: { "aria-controls": `sites-resumen-detalle-${number}`, "aria-expanded": "false" },
            textContent: "Ver detalle ↓" });
        detail.parentElement = row;
        row.nodes.set("[data-resumen-expandir]", detail);
        return row;
    });
    const list = new Nodo();
    rows.forEach(row => { row.parentElement = list; });
    const metrics = new Nodo();
    const cards = new Map(TIPOS.map(type => {
        const card = new Nodo({ dataset: { resumenFiltro: type },
            attributes: { "aria-pressed": "false" } });
        card.parentElement = metrics;
        return [type, card];
    }));
    const count = new Nodo({ id: "resumen-cabanas-conteo", textContent: "11 de 11 cabañas" });
    const serviceCount = new Nodo({ id: "contador-servicios", textContent: "0" });
    const operationCounts = new Map(["continuan", "ingresan", "salen"].map(type =>
        [`contador-${type}`, new Nodo({ id: `contador-${type}`, textContent: "0" })]));
    const clear = new Nodo({ id: "resumen-mostrar-todas" });
    const next = new Nodo({ id: "resumen-dia-siguiente" });
    clear.hidden = true;
    const details = new Map(rows.map(row => [
        `sites-resumen-detalle-${row.dataset.cabana}`, { hidden: true }
    ]));
    const dates = new Map([
        [DIA, new Map([["1", "continua"], ["2", "libre-ingresa"],
            ["3", "sale-libre"], ["4", "sale-ingresa"], ["5", "libre-libre"]])],
        [OTRO_DIA, new Map([["1", "libre-libre"], ["2", "continua"],
            ["3", "libre-libre"], ["4", "libre-libre"], ["5", "libre-ingresa"]])]
    ]);
    let payments = [{ numeroCabana: "3", monto: 20000 }, { numeroCabana: "3", monto: 15000 }];
    let charges = [];
    let services = [
        { id: "s1", numeroCabana: "6", fechaServicio: DIA, estadoServicio: "pendiente" },
        { id: "s2", numeroCabana: "6", fechaServicio: DIA, estadoServicio: "realizado" },
        { id: "s3", numeroCabana: "7", fechaServicio: DIA, estadoServicio: "cancelado" },
        { id: "s4", numeroCabana: "8", fechaServicio: DIA, estadoServicio: "no_show" },
        { id: "s5", numeroCabana: "9", fechaServicio: OTRO_DIA, estadoServicio: "pendiente" }
    ];
    const writes = [];
    const reads = [];
    const document = {
        readyState: "loading", listeners: new Map(),
        addEventListener(type, callback) {
            const list = this.listeners.get(type) || [];
            list.push(callback);
            this.listeners.set(type, list);
        },
        dispatchEvent(event) {
            for (const callback of this.listeners.get(event.type) || []) callback(event);
        },
        querySelector(selector) {
            if (selector.includes("sites-resumen-lista")) return list;
            if (selector === "#seccion-resumen > .resumen") return metrics;
            if (selector.includes("resumen-cabanas-conteo")) return count;
            if (selector.includes("resumen-mostrar-todas")) return clear;
            return null;
        },
        querySelectorAll(selector) {
            if (selector.includes("sites-resumen-cabana")) return rows;
            if (selector.includes("data-resumen-filtro")) return [...cards.values()];
            return [];
        },
        getElementById(id) {
            if (id === count.id) return count;
            if (id === serviceCount.id) return serviceCount;
            if (operationCounts.has(id)) return operationCounts.get(id);
            if (id === clear.id) return clear;
            if (id === next.id) return next;
            if (details.has(id)) return details.get(id);
            return null;
        }
    };
    const context = vm.createContext({
        document,
        window: {
            haikuSesion: { user: { id: "u1" } },
            HAIKU_OPERACION_DIA_IDENTIDAD_V1: {
                obtener(fecha, numero) {
                    const estado = dates.get(fecha)?.get(String(numero)) || "libre-libre";
                    return { estado, ingresaHoy: ["libre-ingresa", "sale-ingresa", "fullday"].includes(estado),
                        saleHoy: ["sale-libre", "sale-ingresa", "fullday", "sale-bloqueada"].includes(estado) };
                }
            },
            HAIKU_PAGOS_PENDIENTES_SUPABASE_V1: {
                estaListo: () => true,
                obtener: fecha => fecha === DIA ? payments.map(item => ({ ...item })) : []
            },
            haikuSupabase: {
                rpc() { writes.push("rpc"); throw Error("El filtro no llama RPC"); },
                from(table) {
                    assert.equal(table, "vista_estado_cargos");
                    return {
                        select() {
                            return { in(_field, ids) {
                                reads.push({ table, ids });
                                return Promise.resolve(charges === null
                                    ? { data: null, error: new Error("Lectura no disponible") }
                                    : { data: charges.filter(cargo =>
                                        ids.includes(cargo.reserva_id)), error: null });
                            } };
                        }
                    };
                }
            }
        },
        localStorage: {
            getItem: key => key === "haikuServicios" ? JSON.stringify(services) : null,
            setItem: () => { writes.push("localStorage.setItem"); throw Error("El filtro no escribe almacenamiento"); }
        },
        get serviciosRegistrados() { return services; },
        fechaSeleccionada: DIA,
        datosPorFecha: {},
        __sourceRows: dates,
        obtenerPagosPendientes() { throw Error("Con sesión se usa el puente financiero canónico"); },
        seleccionarDia(anio, mes, dia, fecha) { context.fechaSeleccionada = fecha; },
        Date, Intl, console: { warn() {}, error() {} },
        requestAnimationFrame: callback => callback(),
        MutationObserver: class { observe() {} },
        CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
    });
    const closing = source.lastIndexOf("})();");
    assert.ok(closing > 0, "El módulo del Resumen conserva su cierre");
    const instrumented = `${source.slice(0, closing)}\n` +
        "resumenFila = () => {}; pintarFlujo = () => {};" +
        "const filaRpc = (numero, estado) => [numero, { estado_operativo: estado," +
        " salida_estadia_id: estado === 'sale-bloqueada' ? 'salida-real' : null }];" +
        "cargarHistorial = fecha => { if (historial.has(fecha) || !__sourceRows.has(fecha)) return;" +
        " historial.set(fecha, new Map([...__sourceRows.get(fecha)].map(([numero, estado]) => filaRpc(numero, estado))));" +
        " programarActualizacion(); };" +
        "globalThis.__filtroTest = { coincideFiltro, aplicarFiltro, seleccionarFiltro, iniciar, alternarDetalle," +
        " seedHistory(fecha) { historial.set(fecha, new Map([...__sourceRows.get(fecha)].map(([numero, estado]) => filaRpc(numero, estado)))); }," +
        " setOperation(fecha, numero, row) { historial.get(fecha).set(String(numero), row); programarActualizacion(); }," +
        " get seleccionado() { return filtroSeleccionado; } };\n})();";
    vm.runInContext(instrumented, context, { filename: "supabase-resumen-tablero-v1.js" });
    const api = context.__filtroTest;
    api.seedHistory(DIA);
    api.iniciar();
    const visible = () => rows.filter(row => !row.hidden && row.style.display !== "none")
        .map(row => Number(row.dataset.cabana));
    const select = type => api.seleccionarFiltro(type);
    const notify = (type, fecha = context.fechaSeleccionada) => document.dispatchEvent(
        new context.CustomEvent(type, { detail: { fecha } })
    );
    return { api, cards, clear, count, serviceCount, operationCounts, context, dates, details, document, list, next,
        metrics, notify, rows, select, visible, writes, reads,
        setPayments: value => { payments = value; },
        setCharges: value => { charges = value; },
        setServices: value => { services = value; } };
}

test("las cinco métricas tienen controles accesibles y el listado conserva sus 11 artículos", () => {
    for (const type of TIPOS) {
        assert.match(html, new RegExp(`data-resumen-filtro="${type}"[^>]*aria-pressed="false"`));
    }
    assert.match(html, /id="resumen-mostrar-todas"[^>]*hidden/);
    assert.match(html, /id="resumen-cabanas-conteo"/);
    assert.equal([...html.matchAll(/<article class="sites-resumen-cabana"/g)].length, 11);
});

test("operación real: Continúan, Ingresan y Salen comparten correctamente Sale + ingresa", () => {
    const h = arnes();
    h.select("continuan");
    assert.deepEqual(h.visible(), [1]);
    assert.equal(h.count.textContent, "1 de 11 cabañas");
    h.select("ingresan");
    assert.deepEqual(h.visible(), [2, 4]);
    h.select("salen");
    assert.deepEqual(h.visible(), [3, 4]);
    assert.equal(h.count.textContent, "2 de 11 cabañas");
    assert.equal(h.operationCounts.get("contador-continuan").textContent, "1");
    assert.equal(h.operationCounts.get("contador-ingresan").textContent, "2");
    assert.equal(h.operationCounts.get("contador-salen").textContent, "2");
    assert.deepEqual(h.writes, []);
});

test("Full day integra ambos filtros y sale-bloqueada entra sólo si la autoridad marca salida", () => {
    const h = arnes();
    h.dates.get(DIA).set("7", "sale-bloqueada");
    h.dates.get(DIA).set("8", "fullday");
    h.api.seedHistory(DIA);
    h.select("ingresan");
    assert.deepEqual(h.visible(), [2, 4, 8]);
    h.select("salen");
    assert.deepEqual(h.visible(), [3, 4, 7, 8]);
    assert.equal(h.count.textContent, "4 de 11 cabañas");
    assert.equal(h.operationCounts.get("contador-salen").textContent, "4");
});

test("Servicios usa registros de la fecha y excluye notas, cancelados y no show", () => {
    const h = arnes();
    h.notify("haiku:servicios-hidratados");
    h.cards.get("servicios").emit("click");
    assert.deepEqual(h.visible(), [6], "dos servicios activos de CAB 6 muestran una sola fila");
    assert.equal(h.count.textContent, "1 de 11 cabañas");
    assert.equal(h.serviceCount.textContent, "2", "la métrica excluye cancelado, no show y otra fecha");
    assert.deepEqual(h.writes, []);
});

test("un refresh de servicios conserva el filtro y vuelve a evaluar sus registros", () => {
    const h = arnes();
    h.notify("haiku:servicios-hidratados");
    h.select("servicios");
    assert.deepEqual(h.visible(), [6]);
    h.setServices([{ id: "s6", numeroCabana: "10", fechaServicio: DIA,
        estadoServicio: "programado" }]);
    h.notify("haiku:servicios-hidratados");
    assert.deepEqual(h.visible(), [10]);
    assert.equal(h.api.seleccionado, "servicios");
    assert.equal(h.cards.get("servicios").getAttribute("aria-pressed"), "true");
    assert.deepEqual(h.writes, []);
});

test("Pagos usa el puente financiero canónico y una fila por cabaña", () => {
    const h = arnes();
    h.notify("haiku:resumen-pagos-actualizados");
    h.select("pagos");
    assert.deepEqual(h.visible(), [3]);
    assert.equal(h.count.textContent, "1 de 11 cabañas");
    assert.deepEqual(h.writes, []);
});

test("un refresh de pagos conserva el filtro y usa la nueva respuesta canónica", () => {
    const h = arnes();
    h.notify("haiku:resumen-pagos-actualizados");
    h.select("pagos");
    assert.deepEqual(h.visible(), [3]);
    h.setPayments([{ numeroCabana: "7", monto: 0, titulo: "Abono por verificar" }]);
    h.notify("haiku:resumen-pagos-actualizados");
    assert.deepEqual(h.visible(), [7]);
    assert.equal(h.api.seleccionado, "pagos");
    assert.deepEqual(h.writes, []);
});

test("COBROS y filtro comparten el saldo canónico de check-in, incluido CAB 2", () => {
    const h = arnes();
    h.api.setOperation(DIA, 2, { estado_operativo: "libre-ingresa", ingreso_reserva_id: "yervic" });
    h.setPayments([{ tipo: "checkin", numeroCabana: "2", reservaId: "yervic", monto: 16000 }]);
    h.notify("haiku:resumen-pagos-actualizados");
    h.select("pagos");
    const celda = h.rows[1].querySelector(".sites-resumen-celda--cobros");
    assert.deepEqual(h.visible(), [2]);
    assert.equal(celda.querySelector(".sites-resumen-valor").textContent, "Saldo $16.000");
    assert.equal(celda.querySelector(".sites-resumen-subvalor").textContent,
        "Cobro pendiente de ingreso");
    assert.equal(celda.querySelector(".sites-resumen-valor").dataset.cobroVisual, "pendiente");
    assert.deepEqual(h.writes, []);
});

test("check-in con saldo cero confirmado se muestra Pagado; sin cargos queda neutro", async () => {
    const h = arnes();
    h.api.setOperation(DIA, 2, { estado_operativo: "libre-ingresa", ingreso_reserva_id: "pagada" });
    h.setPayments([]);
    const celda = h.rows[1].querySelector(".sites-resumen-celda--cobros");
    h.notify("haiku:resumen-pagos-actualizados");
    assert.equal(celda.querySelector(".sites-resumen-valor").textContent, "—",
        "la ausencia en pendientes no prueba que la reserva esté pagada");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(celda.querySelector(".sites-resumen-valor").textContent, "—",
        "sin cargo confirmado se conserva estado neutro");
    h.setCharges([{ reserva_id: "pagada", tipo_cargo: "alojamiento", estado: "activo",
        saldo_cargo: 0, monto_ajustado: 160000 }]);
    h.notify("haiku:resumen-pagos-actualizados");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(celda.querySelector(".sites-resumen-valor").textContent, "Pagado");
    assert.equal(celda.querySelector(".sites-resumen-subvalor").textContent, "Sin saldo pendiente");
    assert.ok(h.reads.some(lectura => lectura.table === "vista_estado_cargos" &&
        lectura.ids.includes("pagada")), "saldo cero se verifica en la misma vista canónica");
    assert.deepEqual(h.writes, []);
});

test("checkout con servicio pendiente mantiene filtro y COBROS coherentes", () => {
    const h = arnes();
    h.api.setOperation(DIA, 3, { estado_operativo: "sale-libre", salida_reserva_id: "salida" });
    h.setPayments([{ tipo: "servicio", numeroCabana: "3", reservaId: "salida", monto: 30000 }]);
    h.notify("haiku:resumen-pagos-actualizados");
    h.select("pagos");
    const celda = h.rows[2].querySelector(".sites-resumen-celda--cobros");
    assert.deepEqual(h.visible(), [3]);
    assert.equal(celda.querySelector(".sites-resumen-valor").textContent, "Saldo $30.000");
    assert.equal(celda.querySelector(".sites-resumen-subvalor").textContent,
        "Servicios pendientes de salida");
});

test("sale e ingresa suma dos pendientes reales de la misma cabaña una sola vez", () => {
    const h = arnes();
    h.api.setOperation(DIA, 4, { estado_operativo: "sale-ingresa",
        ingreso_reserva_id: "entrante", salida_reserva_id: "saliente" });
    h.setPayments([
        { tipo: "checkin", numeroCabana: "4", reservaId: "entrante", monto: 16000 },
        { tipo: "servicio", numeroCabana: "4", reservaId: "saliente", monto: 30000 }
    ]);
    h.notify("haiku:resumen-pagos-actualizados");
    h.select("pagos");
    const celda = h.rows[3].querySelector(".sites-resumen-celda--cobros");
    assert.deepEqual(h.visible(), [4]);
    assert.equal(h.count.textContent, "1 de 11 cabañas");
    assert.equal(celda.querySelector(".sites-resumen-valor").textContent, "Saldo $46.000");
    assert.equal(celda.querySelector(".sites-resumen-subvalor").textContent, "2 cobros pendientes");
});

test("checkout pagado y cargo cero conservan estados verificados sin inventar saldo", async () => {
    const h = arnes();
    h.api.setOperation(DIA, 3, { estado_operativo: "sale-libre", salida_reserva_id: "servicio-pagado" });
    h.setPayments([]);
    h.setCharges([{ reserva_id: "servicio-pagado", tipo_cargo: "servicio", estado: "activo",
        saldo_cargo: 0, monto_ajustado: 30000 }]);
    h.notify("haiku:resumen-pagos-actualizados");
    await new Promise(resolve => setImmediate(resolve));
    const celda = h.rows[2].querySelector(".sites-resumen-celda--cobros");
    assert.equal(celda.querySelector(".sites-resumen-valor").textContent, "Pagado");
    assert.deepEqual(h.writes, []);
});

test("si falla la lectura financiera, COBROS conserva el estado neutro", async () => {
    const h = arnes();
    h.api.setOperation(DIA, 2, { estado_operativo: "libre-ingresa", ingreso_reserva_id: "sin-lectura" });
    h.setPayments([]);
    h.setCharges(null);
    h.notify("haiku:resumen-pagos-actualizados");
    await new Promise(resolve => setImmediate(resolve));
    const celda = h.rows[1].querySelector(".sites-resumen-celda--cobros");
    assert.equal(celda.querySelector(".sites-resumen-valor").textContent, "—");
    assert.equal(celda.querySelector(".sites-resumen-subvalor").textContent, "");
    assert.deepEqual(h.writes, []);
});

test("al pasar de saldo pendiente a cero, filtro y COBROS se actualizan juntos", async () => {
    const h = arnes();
    h.api.setOperation(DIA, 2, { estado_operativo: "libre-ingresa", ingreso_reserva_id: "r2" });
    h.setPayments([{ tipo: "checkin", numeroCabana: "2", reservaId: "r2", monto: 16000 }]);
    h.notify("haiku:resumen-pagos-actualizados");
    h.select("pagos");
    assert.deepEqual(h.visible(), [2]);
    h.setPayments([]);
    h.setCharges([{ reserva_id: "r2", tipo_cargo: "alojamiento", estado: "activo",
        saldo_cargo: 0, monto_ajustado: 160000 }]);
    h.notify("haiku:resumen-pagos-actualizados");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.visible(), []);
    assert.equal(h.rows[1].querySelector(".sites-resumen-celda--cobros")
        .querySelector(".sites-resumen-valor").textContent, "Pagado");
    assert.deepEqual(h.writes, []);
});

test("sólo una tarjeta queda activa y Mostrar todas restaura las mismas filas", () => {
    const h = arnes();
    const sameRows = [...h.rows];
    h.cards.get("continuan").emit("click");
    assert.equal(h.cards.get("continuan").getAttribute("aria-pressed"), "true");
    assert.equal(h.clear.hidden, false);
    h.cards.get("ingresan").emit("keydown", h.cards.get("ingresan"), { key: "Enter" });
    assert.equal(h.cards.get("continuan").getAttribute("aria-pressed"), "false");
    assert.equal(h.cards.get("ingresan").getAttribute("aria-pressed"), "true");
    h.clear.emit("click");
    assert.deepEqual(h.visible(), Array.from({ length: 11 }, (_, i) => i + 1));
    assert.equal(h.count.textContent, "11 de 11 cabañas");
    assert.equal(h.clear.hidden, true);
    assert.ok(TIPOS.every(type => h.cards.get(type).getAttribute("aria-pressed") === "false"));
    assert.ok(h.rows.every((row, index) => row === sameRows[index]), "no se recrean artículos");
});

test("el filtro se recalcula al cambiar la fecha y sobrevive a un refresh", () => {
    const h = arnes();
    h.select("continuan");
    assert.deepEqual(h.visible(), [1]);
    h.next.emit("click");
    assert.equal(h.context.fechaSeleccionada, OTRO_DIA);
    assert.equal(h.api.seleccionado, "continuan");
    assert.deepEqual(h.visible(), [], "no reutiliza la clasificación de la fecha anterior");
    h.rows.forEach(row => { row.dataset.resumenFecha = OTRO_DIA; });
    h.api.seedHistory(OTRO_DIA);
    h.notify("haiku:resumen-datos-actualizados", OTRO_DIA);
    assert.deepEqual(h.visible(), [2]);
    h.dates.get(OTRO_DIA).set("2", "libre-libre");
    h.dates.get(OTRO_DIA).set("5", "continua");
    h.api.seedHistory(OTRO_DIA);
    h.notify("haiku:resumen-datos-actualizados", OTRO_DIA);
    assert.deepEqual(h.visible(), [5]);
    assert.equal(h.count.textContent, "1 de 11 cabañas");
});

test("Ver detalle sigue operando en la misma fila filtrada", () => {
    const h = arnes();
    h.select("ingresan");
    const original = h.rows[3];
    const button = original.querySelector("[data-resumen-expandir]");
    button.emit("click");
    assert.equal(h.details.get("sites-resumen-detalle-4").hidden, false);
    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.equal(h.rows[3], original);
    assert.deepEqual(h.visible(), [2, 4]);
});
