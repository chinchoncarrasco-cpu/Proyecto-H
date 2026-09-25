const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const raiz = path.resolve(__dirname, "..");
const optimista = fs.readFileSync(path.join(raiz, "js/checklist-optimista-v1.js"), "utf8");
const revision = fs.readFileSync(path.join(raiz, "js/supabase-aseo-revision-v1.js"), "utf8")
    .replace("    function iniciar() {", "    window.__revisionTest = { instalarListenerItemsRevision, cacheCabanas, cacheConfig, cacheRevisiones, refrescarChecklistAbierto };\n    function iniciar() {");
const realtime = fs.readFileSync(path.join(raiz, "js/supabase-aseo-realtime-v1.js"), "utf8");
const fecha = "2026-09-24";

function arnes() {
    const filas = new Map();
    const revisiones = new Map([
        ["rev-1", { id: "rev-1", fecha, cabana_id: "cab-1", tipo_revision: "completa", estado: "en_proceso", observaciones: "" }],
        ["rev-2", { id: "rev-2", fecha: "2026-09-25", cabana_id: "cab-1", tipo_revision: "completa", estado: "en_proceso" }],
        ["rev-3", { id: "rev-3", fecha, cabana_id: "cab-2", tipo_revision: "completa", estado: "en_proceso" }]
    ]);
    const canales = [];
    const pendientes = [];
    let escrituras = 0;

    function emitir(payload) {
        for (const canal of canales.filter(canal => !canal.removido)) {
            for (const registro of canal.registros) {
                if (registro.filtro.table === payload.table) registro.fn(payload);
            }
        }
    }

    function cliente(nombre) {
        const listeners = new Map();
        const checks = ["a", "b"].map(id => ({ checked: false, dataset: { checklistId: id },
            closest() { return this; }, matches() { return true; } }));
        const datos = { cabanas: { 1: { checklist: {} } } };
        const abierto = { haikuRevisionCabana: "1" };
        const panel = { classList: { contains: clase => clase === "activa" && abierto.haikuRevisionCabana === "1" } };
        const contenedor = { contains: check => checks.includes(check), querySelectorAll: () => checks };
        const estado = { value: "en_revision" };
        const detalles = { value: "" };
        const conteos = { general: "0/2", sector: "0/2", actualizaciones: 0 };
        const sitios = {
            actualizarConteos() {
                const marcados = checks.filter(check => check.checked).length;
                conteos.general = `${marcados}/2`;
                conteos.sector = `${marcados}/2`;
                conteos.actualizaciones++;
            },
            pintarRevision() {},
            pintarDetalle() { conteos.progreso = datos.cabanas[1]?.estadoRevision; },
            estadoFinal: () => "en_curso"
        };
        const documento = {
            readyState: "loading", hidden: false, activeElement: null,
            addEventListener(tipo, fn) {
                if (!listeners.has(tipo)) listeners.set(tipo, []);
                listeners.get(tipo).push(fn);
            },
            getElementById(id) {
                return { "revision-individual": panel, "revision-checklist": contenedor,
                    "revision-estado": estado, "revision-detalles": detalles,
                    "seccion-cabanas": { contains: check => checks.includes(check) } }[id] || null;
            },
            querySelectorAll(selector) {
                return selector.includes("aseo-express") ? [] : checks;
            },
            dispatchEvent() {}
        };
        const supabase = {
            auth: {
                getUser: async () => ({ data: { user: { id: nombre } }, error: null }),
                onAuthStateChange() {}
            },
            from(tabla) {
                const filtros = new Map();
                const consulta = {
                    select() { return this; },
                    eq(campo, valor) { filtros.set(campo, valor); return this; },
                    neq() { return this; }, not() { return this; },
                    order() { return this; }, limit() { return this; },
                    async single() { return this.maybeSingle(); },
                    async maybeSingle() {
                        if (tabla === "revisiones_cabana") {
                            const data = [...revisiones.values()].find(fila =>
                                [...filtros].every(([campo, valor]) => fila[campo] === valor)) || null;
                            return { data, error: null };
                        }
                        return { data: null, error: null };
                    },
                    then(resolve, reject) {
                        let data = [];
                        if (tabla === "revision_items") {
                            data = [...filas.values()].filter(fila => fila.revision_id === filtros.get("revision_id"));
                        }
                        return Promise.resolve({ data, error: null }).then(resolve, reject);
                    },
                    upsert(payload) {
                        assert.equal(tabla, "revision_items");
                        escrituras++;
                        filas.set(`${payload.revision_id}:${payload.checklist_item_id}`, { ...payload });
                        emitir({ table: tabla, eventType: escrituras <= 2 ? "INSERT" : "UPDATE", new: { ...payload }, old: {} });
                        return new Promise(resolve => pendientes.push(() => resolve({ error: null })));
                    }
                };
                return consulta;
            },
            channel(id) {
                const canal = { id, registros: [], removido: false,
                    on(tipo, filtro, fn) { this.registros.push({ tipo, filtro, fn }); return this; },
                    subscribe(fn) { this.estado = fn; canales.push(this); queueMicrotask(() => fn("SUBSCRIBED")); return this; } };
                return canal;
            },
            async removeChannel(canal) { canal.removido = true; }
        };
        const window = { haikuSupabase: supabase, haikuSesion: { id: nombre },
            HAIKU_CABANAS_SITES_V1: sitios, innerWidth: 1200,
            addEventListener() {}, matchMedia: () => ({ matches: false }) };
        const contexto = vm.createContext({ window, document: documento,
            fechaSeleccionada: fecha,
            localStorage: { getItem: clave => abierto[clave] || null },
            obtenerDatosDia: () => datos, guardarDatos() {},
            CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
            alert() {}, Date, Promise, setTimeout: () => 1, clearTimeout() {}, setInterval() {},
            console: { log() {}, info() {}, warn() {}, error() {} } });
        vm.runInContext(optimista, contexto);
        vm.runInContext(revision, contexto);
        const api = window.__revisionTest;
        api.cacheCabanas.set("1", { id: "cab-1" });
        api.cacheConfig.set("1", new Map([
            ["a", { checklist_item_id: "item-a", legacy_checklist_id: "a", cantidad_esperada: 1 }],
            ["b", { checklist_item_id: "item-b", legacy_checklist_id: "b", cantidad_esperada: 1 }]
        ]));
        api.cacheRevisiones.set(`${fecha}::1`, revisiones.get("rev-1"));
        window.HAIKU_REVISION_SUPABASE_V1 = { refrescarChecklistAbierto: api.refrescarChecklistAbierto };
        api.instalarListenerItemsRevision();
        vm.runInContext(realtime, contexto);
        return { nombre, window, contexto, checks, datos, conteos, abierto, listeners,
            async click(indice, valor) {
                checks[indice].checked = valor;
                const escritor = listeners.get("change").find(fn => fn.toString().includes("guardarItem"));
                return escritor({ target: checks[indice] });
            } };
    }

    const A = cliente("A"), B = cliente("B");
    async function vaciar() {
        for (let i = 0; i < 12; i++) await new Promise(setImmediate);
    }
    return { A, B, filas, revisiones, pendientes, emitir, vaciar,
        get escrituras() { return escrituras; },
        get canalesActivos() { return canales.filter(canal => !canal.removido); } };
}

test("dos clientes intercambian marcas, desmarcas y contadores sin bucle de escritura", async () => {
    const h = arnes();
    await h.vaciar();
    h.B.contexto.document.activeElement = h.B.checks[0]; // el foco no aplaza el checklist
    const primera = h.A.click(0, true);
    await h.vaciar();
    assert.equal(h.B.checks[0].checked, true);
    assert.equal(h.B.conteos.general, "1/2");
    assert.equal(h.B.conteos.sector, "1/2");
    assert.equal(h.escrituras, 1);
    h.pendientes.shift()(); await primera;
    assert.equal(h.A.window.HAIKU_CHECKLIST_OPTIMISTA_V1.pendiente("completa", fecha, 1, "a"), false);

    const segunda = h.A.click(0, false);
    await h.vaciar();
    assert.equal(h.B.checks[0].checked, false);
    assert.equal(h.B.conteos.general, "0/2");
    assert.equal(h.escrituras, 2);
    h.pendientes.shift()(); await segunda;

    const tercera = h.B.click(1, true);
    await h.vaciar();
    assert.equal(h.A.checks[1].checked, true);
    assert.equal(h.A.conteos.general, "1/2");
    assert.equal(h.escrituras, 3);
    h.pendientes.shift()(); await tercera;
});

test("la protección optimista dura sólo hasta confirmar y luego acepta otro dispositivo", async () => {
    const h = arnes(); await h.vaciar();
    const local = h.A.click(0, true);
    await h.vaciar();
    assert.equal(h.A.window.HAIKU_CHECKLIST_OPTIMISTA_V1.pendiente("completa", fecha, 1, "a"), true);
    h.filas.set("rev-1:item-a", { revision_id: "rev-1", checklist_item_id: "item-a", estado: "pendiente" });
    h.emitir({ table: "revision_items", eventType: "UPDATE", new: { revision_id: "rev-1", checklist_item_id: "item-a" } });
    await h.vaciar();
    assert.equal(h.A.checks[0].checked, true);
    h.pendientes.shift()(); await local;
    assert.equal(h.A.window.HAIKU_CHECKLIST_OPTIMISTA_V1.pendiente("completa", fecha, 1, "a"), false);
    h.emitir({ table: "revision_items", eventType: "UPDATE", new: { revision_id: "rev-1", checklist_item_id: "item-a" } });
    await h.vaciar();
    assert.equal(h.A.checks[0].checked, false);
    assert.equal(h.escrituras, 1);
});

test("otra revisión o fecha no contamina la ficha y una reconexión recupera el cambio", async () => {
    const h = arnes(); await h.vaciar();
    h.filas.set("rev-2:item-a", { revision_id: "rev-2", checklist_item_id: "item-a", estado: "ok" });
    h.emitir({ table: "revision_items", eventType: "INSERT", new: { revision_id: "rev-2", checklist_item_id: "item-a" } });
    h.filas.set("rev-3:item-a", { revision_id: "rev-3", checklist_item_id: "item-a", estado: "ok" });
    h.emitir({ table: "revision_items", eventType: "INSERT", new: { revision_id: "rev-3", checklist_item_id: "item-a" } });
    await h.vaciar();
    assert.equal(h.A.checks[0].checked, false);
    assert.equal(h.B.checks[0].checked, false);

    h.filas.set("rev-1:item-a", { revision_id: "rev-1", checklist_item_id: "item-a", estado: "ok" });
    for (const canal of h.canalesActivos) canal.estado("SUBSCRIBED");
    await h.vaciar();
    assert.equal(h.A.checks[0].checked, true);
    assert.equal(h.B.checks[0].checked, true);
    assert.equal(h.escrituras, 0);
    assert.equal(h.canalesActivos.length, 2);
    await Promise.all([
        h.A.window.HAIKU_ASEO_REALTIME_V1.reconectar(true),
        h.B.window.HAIKU_ASEO_REALTIME_V1.reconectar(true)
    ]);
    await h.vaciar();
    assert.equal(h.canalesActivos.length, 2);
    for (const canal of h.canalesActivos) {
        assert.equal(canal.registros.filter(registro => registro.filtro.table === "revision_items").length, 1);
    }
});

test("el estado de la revisión abierta actualiza también el progreso derivado", async () => {
    const h = arnes(); await h.vaciar();
    const revision = h.revisiones.get("rev-1");
    revision.estado = "completada";
    revision.resultado = "lista";
    h.emitir({ table: "revisiones_cabana", eventType: "UPDATE", new: { id: "rev-1" } });
    await h.vaciar();
    assert.equal(h.A.conteos.progreso, "lista");
    assert.equal(h.B.conteos.progreso, "lista");
    assert.equal(h.escrituras, 0);
});
