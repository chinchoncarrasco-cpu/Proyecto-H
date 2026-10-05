const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const app = fs.readFileSync(require.resolve("../js/app.js"), "utf8");
const inicio = app.indexOf("async function abrirReservaCreadaPorId()");

assert.ok(inicio >= 0, "app.js expone el handler de la confirmacion");

const handler = app.slice(inicio);
const RESERVA_ID = "11111111-1111-4111-8111-111111111111";

function montar({ reservaId = RESERVA_ID, abrirPorId } = {}) {
    const eventos = new Map();
    const alertas = [];
    const orden = [];
    let modalCerrado = false;

    const boton = {
        addEventListener(tipo, callback) {
            eventos.set(tipo, callback);
        }
    };
    const contexto = {
        botonVerReservaCreada: boton,
        reservaCreadaId: reservaId,
        cabanaSeleccionadaReserva: "",
        fechaLlegadaReserva: "",
        fechaSeleccionada: "2026-10-05",
        window: {},
        document: {
            querySelector() {
                throw new Error("El flujo no debe consultar filas del Resumen");
            }
        },
        cerrarModalNuevaReserva() {
            modalCerrado = true;
            orden.push("cerrar");
        },
        alert(mensaje) {
            alertas.push(String(mensaje));
        },
        console: { error() {} }
    };

    if (abrirPorId !== undefined) {
        contexto.window.HAIKU_RESUMEN_RESERVA_SITES_V1 = { abrirPorId };
    }

    vm.runInNewContext(handler, contexto, {
        filename: "app.js/abrir-reserva-creada"
    });

    return {
        contexto,
        alertas,
        orden,
        modalCerrado: () => modalCerrado,
        click: () => eventos.get("click")()
    };
}

test("Ver reserva abre inmediatamente por reservaCreadaId sin depender del Resumen", async () => {
    const llamadas = [];
    let caso;
    caso = montar({
        abrirPorId: async (...argumentos) => {
            llamadas.push(argumentos);
            assert.equal(caso.modalCerrado(), true,
                "el modal se cierra antes de mostrar la ficha compartida");
            caso.orden.push("abrir");
            return true;
        }
    });

    assert.equal(await caso.click(), true);
    assert.deepEqual(llamadas, [[RESERVA_ID]],
        "el ID creado es la unica identidad enviada a la ficha");
    assert.deepEqual(caso.orden, ["cerrar", "abrir"]);
    assert.equal(caso.contexto.fechaSeleccionada, "2026-10-05",
        "abrir la ficha no cambia temporalmente la fecha visible");
    assert.deepEqual(caso.alertas, []);
});

test("Ver reserva falla de forma visible si abrirPorId no esta disponible", async () => {
    const caso = montar();

    assert.equal(await caso.click(), false);
    assert.equal(caso.modalCerrado(), false);
    assert.equal(caso.contexto.fechaSeleccionada, "2026-10-05");
    assert.equal(caso.alertas.length, 1);
    assert.match(caso.alertas[0], /ficha de reserva no está disponible/i);
});

test("Ver reserva informa cuando la ficha compartida rechaza la apertura", async () => {
    const caso = montar({ abrirPorId: async () => false });

    assert.equal(await caso.click(), false);
    assert.equal(caso.modalCerrado(), true);
    assert.equal(caso.alertas.length, 1);
    assert.match(caso.alertas[0], /no se pudo abrir la ficha/i);
});
