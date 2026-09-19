const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function cargarPersistencia(
    valorInicial,
    fechaInicial = "2026-09-18",
    bloquesAnterioresIniciales
) {
    const almacenamiento = new Map();
    if (valorInicial !== undefined) {
        almacenamiento.set("haikuResumenFilasOcultasPorFechaV2", valorInicial);
    }
    if (bloquesAnterioresIniciales !== undefined) {
        almacenamiento.set(
            "haikuResumenDiaAnteriorOcultoPorFechaV1",
            bloquesAnterioresIniciales
        );
    }

    const localStorage = {
        getItem(clave) {
            return almacenamiento.get(clave) ?? null;
        },
        setItem(clave, valor) {
            almacenamiento.set(clave, String(valor));
        }
    };

    const fuente = fs.readFileSync(
        require.resolve("../js/supabase-resumen-tablero-v1.js"),
        "utf8"
    );
    const inicio = fuente.indexOf("    const filasOcultasPorFecha = new Map();");
    const fin = fuente.indexOf("    function fechaVisible", inicio);
    const fragmento = fuente.slice(inicio, fin);
    const contexto = vm.createContext({
        window: { localStorage },
        fechaSeleccionada: fechaInicial
    });

    vm.runInContext(
        `${fragmento};globalThis.api={
            leer:fecha=>JSON.stringify([...filasOcultasDeFecha(fecha)]),
            leerActual:()=>JSON.stringify([...filasOcultasDeFecha()]),
            cambiarFecha:fecha=>{fechaSeleccionada=fecha},
            agregar:(fecha,numero)=>filasOcultasDeFecha(fecha).add(String(numero)),
            guardar:guardarFilasOcultas,
            leerAnterior:fecha=>JSON.stringify([...bloquesAnterioresOcultosDeFecha(fecha)]),
            leerAnteriorActual:()=>JSON.stringify([...bloquesAnterioresOcultosDeFecha()]),
            agregarAnterior:(fecha,numero)=>bloquesAnterioresOcultosDeFecha(fecha).add(String(numero)),
            quitarAnterior:(fecha,numero)=>bloquesAnterioresOcultosDeFecha(fecha).delete(String(numero)),
            guardarAnterior:guardarBloquesAnterioresOcultos
        };`,
        contexto
    );

    return { api: contexto.api, almacenamiento };
}

test("las cabañas minimizadas se restauran y se guardan por fecha", () => {
    const { api, almacenamiento } = cargarPersistencia(
        '{"2026-09-18":["7","2"],"2026-09-19":["4"]}'
    );

    assert.equal(api.leer("2026-09-18"), '["7","2"]');
    assert.equal(api.leer("2026-09-19"), '["4"]');
    api.agregar("2026-09-18", "11");
    api.guardar();

    assert.deepEqual(
        JSON.parse(almacenamiento.get("haikuResumenFilasOcultasPorFechaV2")),
        {
            "2026-09-18": ["2", "7", "11"],
            "2026-09-19": ["4"]
        }
    );
});

test("cambiar de fecha no hereda las cabañas minimizadas", () => {
    const { api } = cargarPersistencia('{"2026-09-18":["1"]}');

    assert.equal(api.leerActual(), '["1"]');
    api.cambiarFecha("2026-09-19");
    assert.equal(api.leerActual(), "[]");
    api.cambiarFecha("2026-09-18");
    assert.equal(api.leerActual(), '["1"]');
});

test("un valor local inválido no impide cargar el tablero", () => {
    const { api } = cargarPersistencia(
        "{valor-invalido",
        "2026-09-18",
        "{tambien-invalido"
    );
    assert.equal(api.leerActual(), "[]");
    assert.equal(api.leerAnteriorActual(), "[]");
});

test("el bloque individual de Día anterior sobrevive a F5 y se separa por fecha", () => {
    const { api, almacenamiento } = cargarPersistencia(
        undefined,
        "2026-09-18",
        '{"2026-09-18":["7","2"],"2026-09-19":["4"]}'
    );

    assert.equal(api.leerAnteriorActual(), '["7","2"]');
    api.cambiarFecha("2026-09-19");
    assert.equal(api.leerAnteriorActual(), '["4"]');
    api.agregarAnterior("2026-09-19", "11");
    api.quitarAnterior("2026-09-19", "4");
    api.guardarAnterior();

    assert.deepEqual(
        JSON.parse(
            almacenamiento.get("haikuResumenDiaAnteriorOcultoPorFechaV1")
        ),
        {
            "2026-09-18": ["2", "7"],
            "2026-09-19": ["11"]
        }
    );

    const recargado = cargarPersistencia(
        undefined,
        "2026-09-19",
        almacenamiento.get("haikuResumenDiaAnteriorOcultoPorFechaV1")
    );
    assert.equal(recargado.api.leerAnteriorActual(), '["11"]');
    recargado.api.cambiarFecha("2026-09-18");
    assert.equal(recargado.api.leerAnteriorActual(), '["2","7"]');
});
