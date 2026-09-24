const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const fuente = fs.readFileSync(path.join(__dirname, "../js/supabase-aseo-operacion-v1.js"), "utf8");
const fuenteOptimista = fs.readFileSync(path.join(__dirname, "../js/checklist-optimista-v1.js"), "utf8");
const FECHA = "2026-09-24";

function arnes({ aseos = [], solicitudes = [], revisiones = [], local = {}, fallar = false,
    optimista = false, demorarItems = false } = {}) {
    const escrituras = [];
    const listeners = new Map();
    const eventos = [];
    let lecturaFalla = fallar;
    const checks = [];
    const resolucionesItems = [];
    let contadorExpress = 0;
    const datos = { cabanas: { 9: local } };
    const filas = {
        cabanas: [{ id: "cab-9", numero: 9 }],
        checklist_items: optimista ? [{ id: "item-losa", nombre: "Losa" },
            { id: "item-cafe", nombre: "Café" }] : [],
        aseos,
        solicitudes,
        revisiones_cabana: revisiones,
        revision_items: []
    };
    const supabase = {
        from(tabla) {
            const filtros = new Map();
            let mutacion = "";
            let payloadMutacion = null;
            const consulta = {
                select() { return consulta; },
                eq(campo, valor) { filtros.set(campo, valor); return consulta; },
                neq(campo, valor) { filtros.set(`no:${campo}`, valor); return consulta; },
                order() { return consulta; },
                limit() { return consulta; },
                in() { return consulta; },
                upsert(payload) {
                    mutacion = "upsert";
                    payloadMutacion = payload;
                    escrituras.push({ tabla, payload });
                    return consulta;
                },
                insert(payload) {
                    mutacion = "insert";
                    payloadMutacion = payload;
                    escrituras.push({ tabla, payload });
                    return consulta;
                },
                update(payload) {
                    mutacion = "update";
                    payloadMutacion = payload;
                    escrituras.push({ tabla, payload });
                    return consulta;
                },
                single() {
                    if (tabla === "revisiones_cabana" && mutacion === "insert") {
                        const data = { id: "rev-nueva-9", ...payloadMutacion };
                        filas.revisiones_cabana.push(data);
                        return Promise.resolve({ data, error: null });
                    }
                    if (tabla === "revisiones_cabana" && mutacion === "update") {
                        const data = filas.revisiones_cabana.find(fila => fila.id === filtros.get("id"));
                        if (data) Object.assign(data, payloadMutacion);
                        return Promise.resolve({ data: data || null, error: null });
                    }
                    return Promise.resolve({ data: { id: "aseo-9", ...payloadMutacion }, error: null });
                },
                maybeSingle() {
                    const data = (filas[tabla] || []).find(fila =>
                        fila.cabana_id === filtros.get("cabana_id") &&
                        (tabla === "solicitudes" ? fila.fecha_operativa === filtros.get("fecha_operativa")
                            : fila.fecha === filtros.get("fecha")) &&
                        (!filtros.has("no:estado") || fila.estado !== filtros.get("no:estado"))) || null;
                    return Promise.resolve({ data, error: null });
                },
                then(resolver, rechazar) {
                    if (demorarItems && tabla === "revision_items" && mutacion === "upsert") {
                        return new Promise(resolve => resolucionesItems.push(resolve)).then(resolver, rechazar);
                    }
                    const error = lecturaFalla && tabla === "solicitudes" ? new Error("lectura fallida") : null;
                    return Promise.resolve({ data: filas[tabla] || [], error }).then(resolver, rechazar);
                }
            };
            return consulta;
        }
    };
    const window = { haikuSupabase: supabase, haikuSesion: null, addEventListener() {},
        HAIKU_CABANAS_SITES_V1: {
            actualizarConteos() { contadorExpress = checks.filter(check => check.checked).length; }
        } };
    const document = { readyState: "complete", hidden: false,
        addEventListener(tipo, listener) { listeners.set(tipo, listener); },
        dispatchEvent(evento) { eventos.push(evento); },
        querySelector: () => null, getElementById: () => null,
        querySelectorAll(selector) { return selector.includes("aseo-express-item") ? checks : []; } };
    class CustomEvent {
        constructor(type, opciones) { this.type = type; this.detail = opciones.detail; }
    }
    const contexto = vm.createContext({
        window, document, CustomEvent,
        localStorage: { getItem: llave => llave === "haikuAseoExpressCabana" ? "9" : null },
        fechaSeleccionada: FECHA, obtenerDatosDia: () => datos,
        guardarDatos() {}, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1,
        Date, Intl, Promise, console: { info() {}, error() {}, warn() {} }
    });
    if (optimista) vm.runInContext(fuenteOptimista, contexto, { filename: "checklist-optimista-v1.js" });
    vm.runInContext(fuente, contexto, { filename: "supabase-aseo-operacion-v1.js" });
    window.haikuSesion = { usuario: { id: "usuario-1" } };
    return { api: window.HAIKU_ASEO_OPERACION_V1, local, escrituras, listeners, eventos,
        checks, resolucionesItems, get contadorExpress() { return contadorExpress; },
        optimista: window.HAIKU_CHECKLIST_OPTIMISTA_V1,
        fallarSiguienteLectura() { lecturaFalla = true; } };
}

test("la autoridad Express exige solicitud real de la fecha y no migra texto/checks locales", async () => {
    const local = { solicitudAseoExpress: "Texto obsoleto", detallesAseoExpress: "Detalle viejo",
        checklistAseoExpress: { losa: true } };
    const h = arnes({ local });
    await h.api.hidratar(FECHA, { pintar: false });
    assert.equal(local.aseoExpressCiclo.fecha, FECHA);
    assert.equal(local.aseoExpressCiclo.verificado, true);
    assert.equal(local.aseoExpressCiclo.existe, false);
    assert.equal(local.aseoExpressCiclo.solicitudId, null);
    assert.equal(local.aseoExpressCiclo.revisionId, null);
    assert.equal(local.solicitudAseoExpress, "Texto obsoleto");
    assert.equal(local.detallesAseoExpress, "Detalle viejo");
    assert.equal(local.checklistAseoExpress.losa, true);
    assert.equal(h.escrituras.length, 0);
});

test("solicitud vigente y revisión Express se proyectan por separado; cancelada no habilita el ciclo", async () => {
    const solicitud = { id: "sol-9", cabana_id: "cab-9", descripcion: "Reponer toallas", estado: "pendiente" };
    const revision = { id: "rev-9", cabana_id: "cab-9", estado: "completada", resultado: "con_detalles" };
    const activa = arnes({ solicitudes: [solicitud], revisiones: [revision] });
    await activa.api.hidratar(FECHA, { pintar: false });
    assert.equal(activa.local.aseoExpressCiclo.existe, true);
    assert.equal(activa.local.aseoExpressCiclo.solicitudId, "sol-9");
    assert.equal(activa.local.aseoExpressCiclo.estadoSolicitud, "pendiente");
    assert.equal(activa.local.aseoExpressCiclo.revisionId, "rev-9");
    assert.equal(activa.local.aseoExpressCiclo.estadoRevision, "completada");
    assert.equal(activa.local.aseoExpressCiclo.resultadoRevision, "con_detalles");

    const cancelada = arnes({ solicitudes: [{ ...solicitud, estado: "cancelada" }],
        local: { solicitudAseoExpress: "Legado local" } });
    await cancelada.api.hidratar(FECHA, { pintar: false });
    assert.equal(cancelada.local.aseoExpressCiclo.existe, false);
    assert.equal(cancelada.local.aseoExpressCiclo.solicitudId, null);
    assert.equal(cancelada.local.solicitudAseoExpress, "Legado local", "el texto histórico no se borra ni habilita Express");

    const mezcla = arnes({ solicitudes: [{ ...solicitud, id: "cancelada-9", estado: "cancelada" }, solicitud] });
    await mezcla.api.hidratar(FECHA, { pintar: false });
    assert.equal(mezcla.local.aseoExpressCiclo.solicitudId, "sol-9", "se prefiere explícitamente la vigente");

    const soloRevision = arnes({ revisiones: [revision] });
    await soloRevision.api.hidratar(FECHA, { pintar: false });
    assert.equal(soloRevision.local.aseoExpressCiclo.existe, false);
    assert.equal(soloRevision.local.aseoExpressCiclo.solicitudId, null);
    assert.equal(soloRevision.local.aseoExpressCiclo.revisionId, null);
});

test("no_requiere se guarda como estado canónico y cancelado remoto conserva su valor legacy", async () => {
    const h = arnes({ aseos: [{ id: "aseo-9", cabana_id: "cab-9", estado: "cancelado" }] });
    await h.api.hidratar(FECHA, { pintar: false });
    assert.equal(h.local.aseoEstado, "cancelado");
    await h.api.guardarEstadoAseo("9", "no_requiere");
    assert.equal(h.escrituras.length, 1);
    assert.equal(h.escrituras[0].tabla, "aseos");
    assert.equal(h.escrituras[0].payload.estado, "no_requiere");
    assert.equal(h.eventos.at(-1).type, "haiku:resumen-datos-actualizados");
    assert.equal(h.eventos.at(-1).detail.fecha, FECHA);
});

test("una lectura fallida invalida la proyección Express previa", async () => {
    const local = { aseoExpressCiclo: { fecha: FECHA, verificado: true, existe: true, solicitudId: "vieja" } };
    const h = arnes({ local, solicitudes: [{ id: "sol-9", cabana_id: "cab-9", estado: "pendiente" }] });
    assert.equal(Object.hasOwn(local, "aseoExpressCiclo"), false, "el caché de la sesión anterior se invalida al iniciar");
    await h.api.hidratar(FECHA, { pintar: false });
    assert.equal(local.aseoExpressCiclo.existe, true);
    h.fallarSiguienteLectura();
    await h.api.hidratar(FECHA, { pintar: false });
    assert.equal(Object.hasOwn(local, "aseoExpressCiclo"), false);
    assert.equal(h.escrituras.length, 0);
});

test("el writer Express guarda sólo la revisión Express y rehidrata los cuatro estados", async () => {
    const conversiones = [
        ["pendiente", "pendiente", null],
        ["en_revision", "en_proceso", null],
        ["con-detalles", "completada", "con_detalles"],
        ["lista", "completada", "lista"]
    ];
    for (const [visual, estado, resultado] of conversiones) {
        const revision = { id: "rev-9", fecha: FECHA, cabana_id: "cab-9", estado: "pendiente", resultado: null };
        const solicitud = { id: "sol-9", fecha_operativa: FECHA, cabana_id: "cab-9", estado: "pendiente" };
        const h = arnes({ solicitudes: [solicitud], revisiones: [revision] });
        await h.api.guardarEstadoRevisionExpress("9", visual);
        assert.equal(h.escrituras.length, 1);
        assert.equal(h.escrituras[0].tabla, "revisiones_cabana");
        assert.equal(h.escrituras[0].payload.estado, estado);
        assert.equal(h.escrituras[0].payload.resultado, resultado);
        assert.equal(Boolean(h.escrituras[0].payload.finalizado_en), estado === "completada");
        assert.equal(h.escrituras[0].payload.revisado_por, "usuario-1");
        assert.equal(h.local.estadoRevisionExpress, visual);
        assert.equal(h.local.aseoExpressCiclo.revisionId, "rev-9");
    }
});

test("seleccionar un estado no crea Express sin ciclo real, pero puede iniciar revisión de una solicitud real", async () => {
    const ausente = arnes({ local: { solicitudAseoExpress: "Texto local" } });
    await assert.rejects(ausente.api.guardarEstadoRevisionExpress("9", "en_revision"), /ciclo real/);
    assert.equal(ausente.escrituras.length, 0);

    const solicitud = { id: "sol-9", fecha_operativa: FECHA, cabana_id: "cab-9",
        descripcion: "Reponer toallas", estado: "pendiente" };
    const vigente = arnes({ solicitudes: [solicitud] });
    await vigente.api.guardarEstadoRevisionExpress("9", "en_revision");
    assert.equal(vigente.escrituras.length, 2, "inserta revisión y actualiza su estado");
    assert.deepEqual(vigente.escrituras.map(escritura => escritura.tabla),
        ["revisiones_cabana", "revisiones_cabana"]);
    assert.equal(vigente.local.aseoExpressCiclo.solicitudId, "sol-9");
    assert.equal(vigente.local.aseoExpressCiclo.revisionId, "rev-nueva-9");
});

test("solicitud real sin revisión no reutiliza checks ni detalles legacy", async () => {
    const solicitud = { id: "sol-9", fecha_operativa: FECHA, cabana_id: "cab-9", estado: "pendiente" };
    const local = { detallesAseoExpress: "Anterior", checklistAseoExpress: { losa: true } };
    const h = arnes({ solicitudes: [solicitud], local });
    await h.api.hidratar(FECHA, { pintar: false });
    assert.equal(local.aseoExpressCiclo.existe, true);
    assert.equal(local.aseoExpressCiclo.revisionId, null);
    assert.equal(local.detallesAseoExpress, "");
    assert.equal(local.checklistAseoExpress.losa, undefined);
    assert.equal(local.aseoExpressLegacy.detalles, "Anterior");
    assert.equal(local.aseoExpressLegacy.checklist.losa, true);
});

test("interacciones de checklist y detalles no escriben sin ciclo Express verificado", async () => {
    const local = { checklistAseoExpress: { losa: true }, detallesAseoExpress: "Viejo" };
    const h = arnes({ local });
    await h.api.hidratar(FECHA, { pintar: false });
    const check = { checked: false, dataset: { aseoExpressItem: "losa" } };
    let detenido = 0;
    h.listeners.get("change")({ target: { closest: selector => selector === "[data-aseo-express-item]" ? check : null },
        stopImmediatePropagation() { detenido++; } });
    assert.equal(check.checked, true);
    const texto = { id: "aseo-express-detalles", value: "Nuevo", closest: () => null };
    h.listeners.get("input")({ target: texto, stopImmediatePropagation() { detenido++; } });
    assert.equal(texto.value, "Viejo");
    assert.equal(detenido, 2);
    assert.equal(h.escrituras.length, 0);
});

test("writer Express muestra dos checks y contador antes de que Supabase responda", async () => {
    const solicitud = { id: "sol-9", fecha_operativa: FECHA, cabana_id: "cab-9", estado: "pendiente" };
    const revision = { id: "rev-9", fecha: FECHA, cabana_id: "cab-9", estado: "en_proceso" };
    const h = arnes({ solicitudes: [solicitud], revisiones: [revision],
        optimista: true, demorarItems: true });
    await h.api.hidratar(FECHA, { pintar: false });
    const crear = item => {
        const check = { checked: false, dataset: { aseoExpressItem: item },
            closest(selector) { return selector === "[data-aseo-express-item]" ? this : null; },
            matches() { return true; } };
        h.checks.push(check);
        return check;
    };
    const losa = crear("losa"), cafe = crear("cafe");
    losa.checked = true;
    h.listeners.get("change")({ target: losa });
    cafe.checked = true;
    h.listeners.get("change")({ target: cafe });
    assert.equal(h.contadorExpress, 2);
    assert.equal(h.local.checklistAseoExpress.losa, true);
    assert.equal(h.local.checklistAseoExpress.cafe, true);
    for (let i = 0; i < 12 && !h.resolucionesItems.length; i++) await new Promise(setImmediate);
    assert.equal(h.escrituras.filter(escritura => escritura.tabla === "revision_items").length, 1,
        "La cola existente serializa persistencia, pero no la respuesta visual");
    h.resolucionesItems[0]({ data: null, error: null });
    for (let i = 0; i < 12 && h.resolucionesItems.length < 2; i++) await new Promise(setImmediate);
    h.resolucionesItems[1]({ data: null, error: null });
    for (let i = 0; i < 4; i++) await new Promise(setImmediate);
    assert.equal(h.optimista.pendiente("express", FECHA, 9, "losa"), false);
    assert.equal(h.optimista.pendiente("express", FECHA, 9, "cafe"), false);
    assert.equal(h.escrituras.filter(escritura => escritura.tabla === "revision_items").length, 2);
});

test("writer Express revierte sólo el ítem cuyo upsert falló", async () => {
    const solicitud = { id: "sol-9", fecha_operativa: FECHA, cabana_id: "cab-9", estado: "pendiente" };
    const revision = { id: "rev-9", fecha: FECHA, cabana_id: "cab-9", estado: "en_proceso" };
    const h = arnes({ solicitudes: [solicitud], revisiones: [revision],
        optimista: true, demorarItems: true });
    await h.api.hidratar(FECHA, { pintar: false });
    const check = { checked: true, dataset: { aseoExpressItem: "losa" },
        closest(selector) { return selector === "[data-aseo-express-item]" ? this : null; },
        matches() { return true; } };
    h.checks.push(check);
    h.listeners.get("change")({ target: check });
    assert.equal(h.contadorExpress, 1);
    for (let i = 0; i < 12 && !h.resolucionesItems.length; i++) await new Promise(setImmediate);
    h.resolucionesItems[0]({ data: null, error: new Error("upsert rechazado") });
    for (let i = 0; i < 4; i++) await new Promise(setImmediate);
    assert.equal(check.checked, false);
    assert.equal(h.contadorExpress, 0);
    assert.equal(h.local.checklistAseoExpress.losa, false);
});
