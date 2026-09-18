const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function cargarPersistencia(valorInicial, fechaInicial = "2026-09-18") {
    const almacenamiento = new Map();
    if (valorInicial !== undefined) {
        almacenamiento.set("haikuResumenFilasOcultasPorFechaV2", valorInicial);
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
            guardar:guardarFilasOcultas
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
    const { api } = cargarPersistencia("{valor-invalido");
    assert.equal(api.leerActual(), "[]");
});
