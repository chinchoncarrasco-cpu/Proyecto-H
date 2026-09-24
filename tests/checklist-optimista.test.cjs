const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const fuente = fs.readFileSync(path.join(root, "js/checklist-optimista-v1.js"), "utf8");
const fuenteRevision = fs.readFileSync(path.join(root, "js/supabase-aseo-revision-v1.js"), "utf8");
const fecha = "2026-09-24";

test("el panel autenticado carga la protección antes de los writers Supabase", () => {
    const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const panel = fs.readFileSync(path.join(root, "panel.html"), "utf8");
    assert.ok(index.includes('<script src="js/checklist-optimista-v1.js"></script>'));
    assert.ok(index.indexOf("js/checklist-optimista-v1.js") < index.indexOf("js/sites-cabanas-v1.js"));
    assert.ok(panel.includes('"checklist-optimista-v1"'));
    assert.ok(panel.indexOf("'supabase-aseo-revision-v1'") < panel.indexOf("'supabase-aseo-operacion-v1'"));
});

function arnes() {
    const checks = { completa: [], express: [] };
    const datos = { cabanas: { 1: { checklist: {}, checklistAseoExpress: {} } } };
    const eventos = {};
    const abierto = { haikuRevisionCabana: "1", haikuAseoExpressCabana: "1" };
    let conteos = { completa: 0, express: 0 };
    let guardados = 0;
    const window = { HAIKU_CABANAS_SITES_V1: {
        actualizarConteos() {
            conteos = {
                completa: checks.completa.filter(check => check.checked).length,
                express: checks.express.filter(check => check.checked).length
            };
        }
    } };
    const document = {
        addEventListener(tipo, fn) { eventos[tipo] = fn; },
        querySelectorAll(selector) {
            return checks[selector.includes("aseo-express") ? "express" : "completa"];
        }
    };
    vm.runInNewContext(fuente, {
        window, document, fechaSeleccionada: fecha,
        localStorage: { getItem: key => abierto[key] || null },
        obtenerDatosDia: () => datos, guardarDatos() { guardados++; }
    }, { filename: "checklist-optimista-v1.js" });
    function nuevo(tipo, item, checked = false) {
        const check = {
            checked, dataset: tipo === "express"
                ? { aseoExpressItem: item } : { checklistId: item },
            matches(selector) { return selector.includes(tipo === "express" ? "aseo-express-item" : "checklist-id"); },
            closest() { return this; }
        };
        checks[tipo].push(check);
        return check;
    }
    return {
        api: window.HAIKU_CHECKLIST_OPTIMISTA_V1, nuevo, checks, datos,
        eventos, abierto, get conteos() { return conteos; },
        get guardados() { return guardados; }
    };
}

test("un clic de revisión completa deja el check visible antes de persistir", () => {
    const h = arnes(), check = h.nuevo("completa", "0-0-0");
    check.checked = true;
    h.api.iniciar("completa", fecha, 1, "0-0-0", check);
    assert.equal(check.checked, true);
    assert.equal(h.datos.cabanas[1].checklist["0-0-0"], true);
});

test("el inicio no espera una promesa de Supabase", () => {
    const h = arnes(), check = h.nuevo("completa", "0-0-0");
    check.checked = true;
    const entrada = h.api.iniciar("completa", fecha, 1, "0-0-0", check);
    assert.equal(typeof entrada?.then, "undefined");
    assert.equal(h.api.pendiente("completa", fecha, 1, "0-0-0"), true);
});

test("el contador de revisión completa sube en el mismo turno", () => {
    const h = arnes(), check = h.nuevo("completa", "0-0-0");
    check.checked = true;
    h.api.iniciar("completa", fecha, 1, "0-0-0", check);
    assert.equal(h.conteos.completa, 1);
});

test("desmarcar reduce inmediatamente el contador", () => {
    const h = arnes(), check = h.nuevo("completa", "0-0-0", true);
    check.checked = false;
    h.api.iniciar("completa", fecha, 1, "0-0-0", check);
    assert.equal(h.conteos.completa, 0);
});

test("segundo clic del mismo ítem pendiente no produce toggle", () => {
    const h = arnes(), check = h.nuevo("completa", "0-0-0");
    check.checked = true;
    h.api.iniciar("completa", fecha, 1, "0-0-0", check);
    let evitado = false, detenido = false;
    h.eventos.click({ target: check, preventDefault() { evitado = true; },
        stopImmediatePropagation() { detenido = true; } });
    assert.equal(evitado, true);
    assert.equal(detenido, true);
    assert.equal(check.checked, true);
    assert.equal(h.api.iniciar("completa", fecha, 1, "0-0-0", check), null);
});

test("un segundo ítem puede marcarse mientras el primero guarda", () => {
    const h = arnes(), a = h.nuevo("completa", "0-0-0"), b = h.nuevo("completa", "0-0-1");
    a.checked = true;
    h.api.iniciar("completa", fecha, 1, "0-0-0", a);
    b.checked = true;
    h.api.iniciar("completa", fecha, 1, "0-0-1", b);
    assert.equal(h.conteos.completa, 2);
    assert.equal(h.api.pendiente("completa", fecha, 1, "0-0-1"), true);
});

test("éxito mantiene el valor y libera sólo el ítem confirmado", () => {
    const h = arnes(), a = h.nuevo("completa", "a"), b = h.nuevo("completa", "b");
    a.checked = true; b.checked = true;
    const entrada = h.api.iniciar("completa", fecha, 1, "a", a);
    h.api.iniciar("completa", fecha, 1, "b", b);
    h.api.terminar(entrada, true);
    assert.equal(a.checked, true);
    assert.equal(h.api.pendiente("completa", fecha, 1, "a"), false);
    assert.equal(h.api.pendiente("completa", fecha, 1, "b"), true);
});

test("error revierte únicamente el checkbox rechazado", () => {
    const h = arnes(), a = h.nuevo("completa", "a"), b = h.nuevo("completa", "b");
    a.checked = true; b.checked = true;
    const entrada = h.api.iniciar("completa", fecha, 1, "a", a);
    h.api.iniciar("completa", fecha, 1, "b", b);
    h.api.terminar(entrada, false);
    assert.equal(a.checked, false);
    assert.equal(b.checked, true);
    assert.equal(h.datos.cabanas[1].checklist.a, false);
});

test("error revierte el contador junto con el checkbox", () => {
    const h = arnes(), check = h.nuevo("completa", "a");
    check.checked = true;
    const entrada = h.api.iniciar("completa", fecha, 1, "a", check);
    assert.equal(h.conteos.completa, 1);
    h.api.terminar(entrada, false);
    assert.equal(h.conteos.completa, 0);
});

test("un snapshot viejo de revisión no pisa el caché pendiente", () => {
    const h = arnes(), check = h.nuevo("completa", "a");
    check.checked = true;
    h.api.iniciar("completa", fecha, 1, "a", check);
    const remoto = h.api.aplicarCache("completa", fecha, 1, { a: false });
    assert.equal(remoto.a, true);
});

test("un repintado atrasado restaura el check pendiente", () => {
    const h = arnes(), check = h.nuevo("completa", "a");
    check.checked = true;
    h.api.iniciar("completa", fecha, 1, "a", check);
    check.checked = false;
    h.api.repintar();
    assert.equal(check.checked, true);
    assert.equal(h.conteos.completa, 1);
});

test("tras confirmar vuelve a mandar el valor remoto", () => {
    const h = arnes(), check = h.nuevo("completa", "a");
    check.checked = true;
    const entrada = h.api.iniciar("completa", fecha, 1, "a", check);
    h.api.terminar(entrada, true);
    assert.equal(h.api.valor("completa", fecha, 1, "a", false), false);
    assert.equal(h.api.aplicarCache("completa", fecha, 1, { a: false }).a, false);
});

test("Aseo Express usa el mismo estado optimista y contador inmediato", () => {
    const h = arnes(), check = h.nuevo("express", "losa");
    check.checked = true;
    const entrada = h.api.iniciar("express", fecha, 1, "losa", check);
    assert.equal(h.conteos.express, 1);
    assert.equal(h.datos.cabanas[1].checklistAseoExpress.losa, true);
    h.api.terminar(entrada, false);
    assert.equal(check.checked, false);
    assert.equal(h.conteos.express, 0);
});

test("revisión completa y Express no mezclan claves ni bloqueos", () => {
    const h = arnes(), completo = h.nuevo("completa", "losa"), express = h.nuevo("express", "losa");
    completo.checked = true; express.checked = true;
    h.api.iniciar("completa", fecha, 1, "losa", completo);
    h.api.iniciar("express", fecha, 1, "losa", express);
    assert.equal(h.api.pendiente("completa", fecha, 1, "losa"), true);
    assert.equal(h.api.pendiente("express", fecha, 1, "losa"), true);
    assert.equal(h.conteos.completa, 1);
    assert.equal(h.conteos.express, 1);
});

test("no instala más de una captura de clic y no mantiene entradas terminadas", () => {
    const h = arnes(), check = h.nuevo("completa", "a");
    assert.equal(typeof h.eventos.click, "function");
    check.checked = true;
    const entrada = h.api.iniciar("completa", fecha, 1, "a", check);
    h.api.terminar(entrada, true);
    assert.equal(h.api.pendiente("completa", fecha, 1, "a"), false);
    assert.equal(h.guardados, 2);
});

function arnesWriterCompleto({ estadoRevision = "en_proceso" } = {}) {
    const listeners = {};
    const checks = [];
    const datos = { cabanas: { 1: { checklist: {} } } };
    const resoluciones = [];
    const escrituras = [];
    const alertas = [];
    let contador = 0;
    const contenedor = { contains: check => checks.includes(check),
        querySelectorAll: () => checks };
    const document = {
        readyState: "loading",
        addEventListener(tipo, fn) { listeners[tipo] = fn; },
        getElementById(id) {
            if (id === "revision-checklist") return contenedor;
            if (id === "revision-estado") return { value: "en_revision" };
            return null;
        },
        querySelectorAll(selector) {
            return selector.includes("aseo-express") ? [] : checks;
        },
        dispatchEvent() {}
    };
    const supabase = {
        auth: { getUser: async () => ({ data: { user: { id: "usuario-1" } }, error: null }) },
        from(tabla) {
            if (tabla === "revisiones_cabana") {
                return { update() { return { eq: async () => ({ error: new Error("estado rechazado") }) }; } };
            }
            assert.equal(tabla, "revision_items");
            return { upsert(payload) {
                escrituras.push(payload);
                return new Promise(resolve => resoluciones.push(resolve));
            } };
        }
    };
    const window = { haikuSupabase: supabase,
        HAIKU_CABANAS_SITES_V1: {
            actualizarConteos() { contador = checks.filter(check => check.checked).length; },
            estadoFinal: () => "en_revision"
        } };
    const codigoRevision = fuenteRevision.replace("    function iniciar() {",
        "    window.__pruebaItems = { instalarListenerItemsRevision, cacheCabanas, cacheConfig, cacheRevisiones };\n    function iniciar() {");
    assert.notEqual(codigoRevision, fuenteRevision);
    const contexto = vm.createContext({
        window, document, fechaSeleccionada: fecha,
        localStorage: { getItem: key => key === "haikuRevisionCabana" ? "1" : null },
        obtenerDatosDia: () => datos, guardarDatos() {},
        alert: mensaje => alertas.push(mensaje),
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
        Date, Promise, setTimeout, clearTimeout,
        console: { log() {}, error() {} }
    });
    vm.runInContext(fuente, contexto);
    vm.runInContext(codigoRevision, contexto);
    const api = window.__pruebaItems;
    api.cacheCabanas.set("1", { id: "cab-1" });
    api.cacheConfig.set("1", new Map([
        ["a", { checklist_item_id: "item-a", cantidad_esperada: 1 }],
        ["b", { checklist_item_id: "item-b", cantidad_esperada: 1 }]
    ]));
    api.cacheRevisiones.set(`${fecha}::1`, {
        id: "rev-1", fecha, estado: estadoRevision, resultado: null
    });
    api.instalarListenerItemsRevision();
    function nuevo(item) {
        const check = { checked: false, dataset: { checklistId: item },
            closest() { return this; },
            matches() { return true; } };
        checks.push(check);
        return check;
    }
    return { listeners, checks, nuevo, resoluciones, escrituras, alertas, datos,
        get contador() { return contador; }, optimista: window.HAIKU_CHECKLIST_OPTIMISTA_V1 };
}

test("writer real de revisión completa persiste dos ítems distintos sin esperar para mostrarlos", async () => {
    const h = arnesWriterCompleto(), a = h.nuevo("a"), b = h.nuevo("b");
    a.checked = true;
    const primero = h.listeners.change({ target: a });
    b.checked = true;
    const segundo = h.listeners.change({ target: b });
    assert.equal(h.contador, 2);
    assert.equal(h.datos.cabanas[1].checklist.a, true);
    assert.equal(h.datos.cabanas[1].checklist.b, true);
    for (let i = 0; i < 8 && h.resoluciones.length < 2; i++) await new Promise(setImmediate);
    assert.equal(h.escrituras.length, 2);
    h.resoluciones.forEach(resolve => resolve({ error: null }));
    await Promise.all([primero, segundo]);
    assert.equal(h.optimista.pendiente("completa", fecha, 1, "a"), false);
    assert.equal(h.optimista.pendiente("completa", fecha, 1, "b"), false);
});

test("writer real revierte el check cuando revision_items rechaza el upsert", async () => {
    const h = arnesWriterCompleto(), check = h.nuevo("a");
    check.checked = true;
    const tarea = h.listeners.change({ target: check });
    assert.equal(h.contador, 1);
    for (let i = 0; i < 8 && !h.resoluciones.length; i++) await new Promise(setImmediate);
    h.resoluciones[0]({ error: new Error("Supabase no disponible") });
    await tarea;
    assert.equal(check.checked, false);
    assert.equal(h.contador, 0);
    assert.equal(h.alertas.length, 1);
});

test("si el ítem se persistió pero falla el estado secundario conserva el check y avisa", async () => {
    const h = arnesWriterCompleto({ estadoRevision: "pendiente" }), check = h.nuevo("a");
    check.checked = true;
    const tarea = h.listeners.change({ target: check });
    for (let i = 0; i < 8 && !h.resoluciones.length; i++) await new Promise(setImmediate);
    h.resoluciones[0]({ error: null });
    await tarea;
    assert.equal(check.checked, true);
    assert.equal(h.contador, 1);
    assert.match(h.alertas[0], /El check se guardó/);
});
