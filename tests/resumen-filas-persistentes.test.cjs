const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const fuente = fs.readFileSync(
    require.resolve("../js/supabase-resumen-tablero-v1.js"), "utf8"
);

function articulos() {
    return [...html.matchAll(
        /<article\b(?=[^>]*\bclass="[^"]*\bsites-resumen-cabana\b[^"]*")(?=[^>]*\bdata-cabana="(\d+)")[^>]*>([\s\S]*?)<\/article>/g
    )].map(([, numero, cuerpo]) => ({ numero, cuerpo }));
}

function alternador() {
    const detalles = new Map([
        ["sites-resumen-detalle-1", { hidden: true }],
        ["sites-resumen-detalle-2", { hidden: true }]
    ]);
    const inicio = fuente.indexOf("    function alternarDetalle(");
    const fin = fuente.indexOf("    function iniciar(", inicio);
    assert.ok(inicio >= 0 && fin > inicio, "existe el alternador de detalle");
    const contexto = vm.createContext({
        document: { getElementById: id => detalles.get(id) || null }
    });
    vm.runInContext(
        fuente.slice(inicio, fin) + ";globalThis.alternarDetalleProbado = alternarDetalle;",
        contexto
    );
    return { alternar: contexto.alternarDetalleProbado, detalles };
}

function boton(numero) {
    const atributos = new Map([
        ["aria-controls", "sites-resumen-detalle-" + numero],
        ["aria-expanded", "false"]
    ]);
    return {
        atributos,
        textContent: "Ver detalle ↓",
        getAttribute: nombre => atributos.get(nombre),
        setAttribute: (nombre, valor) => atributos.set(nombre, valor)
    };
}

test("cada cabaña mantiene su franja de tres días visible antes del detalle", () => {
    const filas = articulos();
    assert.ok(filas.length >= 10, "se muestran las cabañas del tablero");
    for (const { numero, cuerpo } of filas) {
        const flujo = cuerpo.match(/<div class="sites-resumen-flujo"[^>]*>/)?.[0];
        assert.ok(flujo, "franja de CAB " + numero);
        assert.doesNotMatch(flujo, /\bhidden\b/);
        assert.ok(
            cuerpo.indexOf('class="sites-resumen-flujo"') <
            cuerpo.indexOf('class="sites-resumen-detalle"'),
            "la franja precede el detalle de CAB " + numero
        );
        for (const dia of ["anterior", "actual", "siguiente"]) {
            assert.ok(cuerpo.includes("sites-resumen-dia--" + dia), dia + " de CAB " + numero);
        }
        assert.ok(cuerpo.includes('data-resumen-expandir="' + numero + '"'));
        assert.ok(cuerpo.includes('aria-controls="sites-resumen-detalle-' + numero + '"'));
        assert.ok(cuerpo.includes('id="sites-resumen-detalle-' + numero + '"'));
    }
});

test("abrir un detalle no minimiza la fila ni altera otras cabañas", () => {
    const { alternar, detalles } = alternador();
    const primero = boton(1);
    const segundo = boton(2);

    alternar(primero);
    assert.equal(detalles.get("sites-resumen-detalle-1").hidden, false);
    assert.equal(detalles.get("sites-resumen-detalle-2").hidden, true);
    assert.equal(primero.atributos.get("aria-expanded"), "true");
    assert.equal(primero.textContent, "Ocultar detalle ↑");

    alternar(segundo);
    assert.equal(detalles.get("sites-resumen-detalle-1").hidden, false);
    assert.equal(detalles.get("sites-resumen-detalle-2").hidden, false);

    alternar(primero);
    assert.equal(detalles.get("sites-resumen-detalle-1").hidden, true);
    assert.equal(detalles.get("sites-resumen-detalle-2").hidden, false);
    assert.equal(primero.atributos.get("aria-expanded"), "false");
    assert.equal(primero.textContent, "Ver detalle ↓");
});
