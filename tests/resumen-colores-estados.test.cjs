const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const fuente = fs.readFileSync(
    require.resolve("../js/supabase-resumen-tablero-v1.js"), "utf8"
);

function entre(inicio, fin) {
    const desde = fuente.indexOf(inicio);
    const hasta = fuente.indexOf(fin, desde);
    assert.ok(desde >= 0 && hasta > desde, "el módulo conserva la función comprobada");
    return fuente.slice(desde, hasta);
}

function pintarEstado(estado) {
    const badge = { textContent: "", dataset: {} };
    const fila = {
        dataset: { cabana: "1" },
        estado,
        querySelector(selector) {
            if (selector === ".sites-resumen-estado-badge") return badge;
            if (selector === ".titular-cabana") return { textContent: "Sin titular" };
            return null;
        }
    };
    const contexto = vm.createContext({
        window: { haikuSesion: null },
        historial: new Map(),
        datosLocales: () => ({ estado, estadoEstadia: "confirmada" }),
        campo: (elemento, nombre) => nombre === "estado" ? { value: elemento.estado } : null,
        reservaExacta: () => ({ id: "" }),
        titularVisible: () => "",
        titularReservaExacta: () => "",
        obtenerNotas: () => [],
        habilitarAcciones: () => {}
    });
    vm.runInContext(
        entre("    const estados = Object.freeze({", "    const selectorFila") +
        entre("    function texto(", "    function campo(") +
        entre("    function resumenFila(", "    function titularOperacion(") +
        ";globalThis.pintar = resumenFila;",
        contexto
    );
    contexto.pintar(fila, "2026-09-18");
    return badge;
}

test("el badge muestra el estado operativo de cada cabaña", () => {
    for (const [estado, texto, tono] of [
        ["libre-libre", "Libre", "libre"],
        ["libre-ingresa", "Ingresa hoy", "ingresa"],
        ["sale-libre", "Sale hoy", "sale"],
        ["sale-ingresa", "Sale + ingresa", "recambio"],
        ["sale-bloqueada", "Sale · bloqueada", "bloqueada"],
        ["continua", "Continúa", "continua"],
        ["fullday", "Full day", "fullday"]
    ]) {
        const badge = pintarEstado(estado);
        assert.equal(badge.textContent, texto, estado);
        assert.equal(badge.dataset.estadoVisual, tono, estado);
    }
});

test("bloqueada conserva su señal roja aunque exista una reserva confirmada", () => {
    const badge = pintarEstado("bloqueada");
    assert.equal(badge.textContent, "Bloqueada");
    assert.equal(badge.dataset.estadoVisual, "bloqueada");
});

test("los tonos pertenecen al badge de Sites y no al fondo completo de la fila", () => {
    const css = fs.readFileSync(require.resolve("../css/sites-resumen-v1.css"), "utf8");
    assert.match(css, /\.sites-resumen-estado-badge\s*\{/);
    for (const tono of ["libre", "ingresa", "sale", "recambio", "bloqueada", "fullday"]) {
        assert.ok(css.includes('data-estado-visual="' + tono + '"'), tono);
    }
    assert.match(
        css,
        /\.sites-resumen-estado-badge\[data-estado-visual="bloqueada"\]\s*\{[^}]*background:\s*#f9e9e6/i
    );
    assert.doesNotMatch(css, /\.sites-resumen-cabana\.cabana-estado-/);
});
