const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const fuenteRevision = fs.readFileSync(path.join(root, "js/supabase-aseo-revision-v1.js"), "utf8");
const fuenteResumen = fs.readFileSync(path.join(root, "js/supabase-revision-resumen-sync-v2.js"), "utf8");
const fuentePuente = fs.readFileSync(path.join(root, "js/supabase-aseo-estado-sync-v1.js"), "utf8");
const fecha = "2026-09-24";

function arnesRevision(valor) {
    const escrituras = [];
    const eventos = [];
    const cabana = { aseoEstado: "completado" };
    const datosPorFecha = { [fecha]: { cabanas: { 1: cabana } } };
    const revision = { id: "revision-1", fecha, cabana_id: "cabana-1", tipo_revision: "completa",
        estado: "en_proceso", resultado: null };
    const supabase = {
        auth: { async getUser() { return { data: { user: { id: "usuario-1" } }, error: null }; } },
        from(tabla) {
            assert.equal(tabla, "revisiones_cabana");
            return {
                update(payload) {
                    escrituras.push(payload);
                    return { eq(campo, id) {
                        assert.equal(campo, "id");
                        assert.equal(id, revision.id);
                        return Promise.resolve({ error: null });
                    } };
                }
            };
        }
    };
    const controles = { "revision-estado": { value: valor }, "revision-detalles": { value: "Observación real" } };
    const document = { readyState: "loading", addEventListener() {},
        getElementById: id => controles[id] || null,
        dispatchEvent: evento => eventos.push(evento) };
    const window = { haikuSupabase: supabase,
        HAIKU_CABANAS_SITES_V1: { estadoFinal: dato => dato.estadoRevision } };
    const codigo = fuenteRevision.replace("    function iniciar() {",
        "    window.__pruebaRevision = { estadoLegacyDesdeRevision, cicloRevision, guardarEstadoRevision, invalidarCiclosPersistidos, cacheCabanas, cacheRevisiones };\n    function iniciar() {");
    assert.notEqual(codigo, fuenteRevision, "Debe poder exponer la lógica real de revisión");
    vm.runInNewContext(codigo, { window, document, fechaSeleccionada: fecha,
        localStorage: { getItem: () => "1" }, datosPorFecha,
        obtenerDatosDia: seleccionada => datosPorFecha[seleccionada],
        guardarDatos() {}, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
        Date, Promise, setTimeout, clearTimeout, console: { log() {}, error() {} }
    }, { filename: "supabase-aseo-revision-v1.js" });
    const api = window.__pruebaRevision;
    api.cacheCabanas.set("1", { id: "cabana-1", numero: 1 });
    api.cacheRevisiones.set(`${fecha}::1`, revision);
    return { api, cabana, revision, escrituras, eventos };
}

test("la revisión completa distingue Pendiente, En revisión, Con detalles y Lista", () => {
    const h = arnesRevision("pendiente");
    const leer = h.api.estadoLegacyDesdeRevision;
    assert.equal(leer(null), "pendiente");
    assert.equal(leer({ estado: "pendiente" }), "pendiente");
    assert.equal(leer({ estado: "en_proceso" }), "en_revision");
    assert.equal(leer({ estado: "completada", resultado: "con_detalles" }), "con-detalles");
    assert.equal(leer({ estado: "completada", resultado: "lista" }), "lista");
});

test("al reiniciar se invalida una revisión completa verificada por una sesión anterior", () => {
    const h = arnesRevision("pendiente");
    h.cabana.revisionCompletaCiclo = h.api.cicloRevision(fecha, h.revision);
    assert.equal(h.cabana.revisionCompletaCiclo.verificado, true);
    h.api.invalidarCiclosPersistidos();
    assert.equal(h.cabana.revisionCompletaCiclo.verificado, false);
    assert.equal(h.eventos.at(-1).type, "haiku:resumen-datos-actualizados");
});

for (const [seleccion, estado, resultado] of [
    ["pendiente", "pendiente", null],
    ["en_revision", "en_proceso", null],
    ["con-detalles", "completada", "con_detalles"],
    ["lista", "completada", "lista"]
]) {
    test(`guardar revisión ${seleccion} usa el estado canónico ${estado}`, async () => {
        const h = arnesRevision(seleccion);
        await h.api.guardarEstadoRevision("1");
        assert.equal(h.escrituras.length, 1);
        assert.equal(h.escrituras[0].estado, estado);
        assert.equal(h.escrituras[0].resultado, resultado);
        assert.equal(h.cabana.estadoRevision, seleccion);
        assert.equal(h.cabana.revisionCompletaCiclo.fecha, fecha);
        assert.equal(h.cabana.revisionCompletaCiclo.id, h.revision.id);
        assert.equal(h.cabana.revisionCompletaCiclo.verificado, true);
        assert.equal(h.eventos.at(-1).type, "haiku:revision-estado-guardado");
    });
}

test("el selector Express no guarda una revisión completa", async () => {
    const escrituras = [];
    let escucharCambio;
    const seccion = { dataset: {}, addEventListener(tipo, handler) {
        if (tipo === "change") escucharCambio = handler;
    } };
    const window = {
        HAIKU_ASEO_RESUMEN_SYNC_V1: {},
        HAIKU_REVISION_RESUMEN_SYNC_V2: {
            async guardarDesdeResumen(...args) { escrituras.push(args); },
            async resincronizar() {}
        }
    };
    const document = { readyState: "complete",
        getElementById: id => id === "seccion-cabanas" ? seccion : null };
    vm.runInNewContext(fuentePuente, { window, document,
        localStorage: { getItem: () => "1" }, console: { log() {}, error() {} }
    }, { filename: "supabase-aseo-estado-sync-v1.js" });
    assert.equal(typeof escucharCambio, "function");
    escucharCambio({ target: { id: "aseo-express-estado", value: "lista", closest: () => null } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(escrituras, []);
});

test("el puente de Resumen respeta el Estado final derivado de Aseo", () => {
    const cabana = { aseoEstado: "no_requiere", estadoRevision: "pendiente" };
    const window = { HAIKU_CABANAS_SITES_V1: {
        estadoFinal: dato => dato.aseoEstado === "no_requiere" ? "no_requiere" : dato.estadoRevision
    } };
    const codigo = fuenteResumen.replace("    function iniciar() {",
        "    window.__pruebaResumen = { aplicarLocal, estadoFinalDerivado };\n    function iniciar() {");
    assert.notEqual(codigo, fuenteResumen);
    vm.runInNewContext(codigo, { window, document: { readyState: "loading", addEventListener() {} },
        fechaSeleccionada: fecha, obtenerDatosDia: () => ({ cabanas: { 1: cabana } }),
        guardarDatos() {}, localStorage: { getItem: () => null }, Date, Promise, console
    }, { filename: "supabase-revision-resumen-sync-v2.js" });
    window.__pruebaResumen.aplicarLocal("1", "lista");
    assert.equal(cabana.estadoRevision, "lista");
    assert.equal(cabana.estadoFinal, "no_requiere",
        "La revisión Lista no puede pisar el No requiere canónico de Aseo");
});
