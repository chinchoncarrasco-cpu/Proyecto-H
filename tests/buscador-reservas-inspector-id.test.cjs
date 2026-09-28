const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const source = read("js/haiku-buscador-reservas-v1.js");
const cabanas = read("js/cabanas.js");
const sync = read("js/supabase-sync-v3.js");
const panel = read("panel.html");
const index = read("index.html");
const fixture = read("tests/fixtures/haku-reserva-convivencia/index.html");

const RESERVA_A = "11111111-1111-4111-8111-111111111111";
const ESTADIA_A = "22222222-2222-4222-8222-222222222222";
const RESERVA_B = "33333333-3333-4333-8333-333333333333";
const ESTADIA_B1 = "44444444-4444-4444-8444-444444444444";
const ESTADIA_B2 = "55555555-5555-4555-8555-555555555555";

function elemento() {
    return {
        dataset: {}, attributes: {}, children: [], parentElement: null,
        setAttribute(nombre, valor) { this.attributes[nombre] = String(valor); },
        removeAttribute(nombre) { delete this.attributes[nombre]; },
        appendChild(hijo) { hijo.parentElement = this; this.children.push(hijo); },
        querySelector(selector) {
            return selector === "[data-buscador-reserva-error]"
                ? this.children.find(hijo => Object.hasOwn(hijo.dataset, "buscadorReservaError")) || null
                : null;
        },
        closest(selector) {
            return selector === "#resultados-busqueda-reservas" ? this.parentElement : null;
        },
        remove() {
            if (!this.parentElement) return;
            this.parentElement.children = this.parentElement.children.filter(hijo => hijo !== this);
        }
    };
}

function harness() {
    const context = {
        console: { warn() {} },
        document: { createElement: () => elemento() },
        window: {}
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return context;
}

function botonResultado() {
    const contenedor = elemento();
    const boton = elemento();
    boton.parentElement = contenedor;
    contenedor.children.push(boton);
    return { boton, contenedor };
}

const plano = valor => JSON.parse(JSON.stringify(valor));

(async () => {
    assert.doesNotThrow(() => new Function(source), "el adaptador mantiene sintaxis válida");

    const h = harness();
    const api = h.window.HAIKU_BUSCADOR_RESERVAS_V1;
    const exacta = botonResultado();
    const identidadA = api.prepararResultado(exacta.boton, {
        reservaId: RESERVA_A,
        numeroCabana: "1",
        codigoHaiku: "H-2024-014",
        cloudbedsId: "CB-90014",
        estadias: [
            { estadiaId: ESTADIA_A, numeroCabana: "1" },
            { estadiaId: ESTADIA_A, numeroCabana: "1" }
        ]
    });
    assert.deepEqual(plano(identidadA), {
        reservaId: RESERVA_A, valida: true,
        seleccion: { estadiaId: ESTADIA_A, numeroCabana: "1" }, multiple: false
    }, "los días repetidos de una estadía se deduplican");
    assert.equal(exacta.boton.dataset.haikuOrigen, "buscador");
    assert.equal(exacta.boton.dataset.codigoHaiku, "H-2024-014");
    assert.equal(exacta.boton.dataset.cloudbedsId, "CB-90014");

    const aperturas = [];
    const haku = { abierto: true, borrador: "conservar", scrollTop: 318 };
    h.window.HAIKU_INSPECTOR_V1 = {
        async abrirInspector(solicitud, opciones) {
            aperturas.push({ solicitud: plano(solicitud), origen: opciones.origen });
            return true;
        }
    };
    assert.equal(await api.abrirResultado(exacta.boton), true);
    assert.deepEqual(aperturas[0].solicitud, {
        tipo: "reserva", entidadId: RESERVA_A, reservaId: RESERVA_A,
        seleccion: { estadiaId: ESTADIA_A, numeroCabana: "1" }, origen: "buscador"
    });
    assert.equal(aperturas[0].origen, exacta.boton, "el resultado conserva el foco de origen");
    assert.deepEqual(haku, { abierto: true, borrador: "conservar", scrollTop: 318 },
        "abrir desde búsqueda no toca el estado de Haku");

    const multiple = botonResultado();
    api.prepararResultado(multiple.boton, {
        reservaId: RESERVA_B,
        numeroCabana: "2",
        estadias: [
            { estadiaId: ESTADIA_B1, numeroCabana: "2" },
            { estadiaId: ESTADIA_B2, numeroCabana: "7" }
        ]
    });
    assert.equal(multiple.boton.dataset.reservaMultiple, "true");
    assert.equal(multiple.boton.dataset.estadiaId, undefined,
        "una reserva multiestadía no inventa una estadía exacta");
    assert.equal(await api.abrirResultado(multiple.boton), true);
    assert.equal(aperturas.length, 2);
    assert.equal(aperturas[1].solicitud.entidadId, RESERVA_B);
    assert.equal(aperturas[1].solicitud.seleccion, null,
        "abrirPorId podrá mostrar el selector multiestadía");

    const invalida = botonResultado();
    invalida.boton.dataset.reservaId = "CAB-1-AYER";
    let fallbackLegacy = 0;
    invalida.boton.click = () => { fallbackLegacy++; };
    assert.equal(await api.abrirResultado(invalida.boton), false);
    assert.equal(aperturas.length, 2, "un ID débil no llega al Inspector");
    assert.equal(fallbackLegacy, 0, "un ID débil no vuelve al clic por cabaña");
    assert.match(invalida.boton.dataset.haikuBuscadorError, /identidad verificable/);
    assert.equal(invalida.contenedor.children.length, 2, "el error se informa dentro del buscador");

    const parcial = botonResultado();
    parcial.boton.dataset.reservaId = RESERVA_A;
    parcial.boton.dataset.estadiaId = "estadia-no-uuid";
    parcial.boton.dataset.cabana = "1";
    assert.equal(await api.abrirResultado(parcial.boton), false);
    assert.equal(aperturas.length, 2, "una selección parcial o inválida tampoco abre");

    const respaldo = harness();
    const llamadaPaneles = [];
    respaldo.window.HAIKU_PANELES_V1 = {
        abrirReserva: async (...args) => { llamadaPaneles.push(args); return true; }
    };
    const botonRespaldo = botonResultado().boton;
    respaldo.window.HAIKU_BUSCADOR_RESERVAS_V1.prepararResultado(botonRespaldo, {
        reservaId: RESERVA_A, estadiaId: ESTADIA_A, numeroCabana: "1"
    });
    assert.equal(await respaldo.window.HAIKU_BUSCADOR_RESERVAS_V1.abrirResultado(botonRespaldo), true);
    assert.equal(llamadaPaneles.length, 1);
    assert.equal(llamadaPaneles[0][0], RESERVA_A);
    assert.deepEqual(plano(llamadaPaneles[0][2]), { estadiaId: ESTADIA_A, numeroCabana: "1" });

    const sinInspector = harness();
    const resultadoSinInspector = botonResultado();
    sinInspector.window.HAIKU_BUSCADOR_RESERVAS_V1.prepararResultado(resultadoSinInspector.boton, {
        reservaId: RESERVA_A, estadiaId: ESTADIA_A, numeroCabana: "1"
    });
    assert.equal(await sinInspector.window.HAIKU_BUSCADOR_RESERVAS_V1
        .abrirResultado(resultadoSinInspector.boton), false);
    assert.match(resultadoSinInspector.boton.dataset.haikuBuscadorError, /Inspector/);

    assert.match(sync, /id,reserva_id,fecha_ingreso/,
        "la consulta de estadías ya trae reserva_estadias.id y reserva_id");
    assert.match(sync, /reservas\([\s\S]*?id,codigo_haiku,cloudbeds_id/,
        "la consulta ya trae reservas.id, código Haiku y Cloudbeds ID");
    assert.match(sync, /cabanas\(numero,nombre\)/,
        "el número de cabaña verificable llega en la misma lectura");
    assert.match(cabanas, /String\(cabana\.estadiaId \|\| ""\)/,
        "cada resultado conserva el UUID de estadía leído");
    assert.match(cabanas, /HAIKU_BUSCADOR_RESERVAS_V1[\s\S]*?abrirResultado/,
        "el clic del buscador usa el adaptador explícito");
    const bloqueClick = cabanas.slice(cabanas.indexOf("// CLICK EN UNA RESERVA ENCONTRADA"),
        cabanas.indexOf("// CERRAR BUSCADOR AL HACER CLICK AFUERA"));
    assert.doesNotMatch(bloqueClick, /fechaSeleccionada\s*=/,
        "seleccionar un resultado no cambia la fecha visible");
    assert.doesNotMatch(bloqueClick, /data-ficha-cabana|\.click\(\)/,
        "seleccionar un resultado no simula un clic en el Resumen");
    assert.match(index, /haiku-buscador-reservas-v1\.js[\s\S]*?cabanas\.js/,
        "el adaptador carga antes del buscador legacy");
    assert.match(panel, /"haiku-buscador-reservas-v1"/,
        "el panel interno evita una versión cacheada del adaptador");
    assert.match(fixture, /Antonia Histórica[\s\S]*?CAB 1[\s\S]*?febrero 2024/,
        "la demo contiene una reserva histórica ficticia en CAB 1");
    assert.match(fixture, /Carolina Actual[\s\S]*?CAB 1[\s\S]*?septiembre 2026/,
        "la demo contiene otra reserva actual ficticia en la misma cabaña");
    assert.match(fixture, /data-demo-buscador="B"/,
        "la demo permite cambiar a una reserva multiestadía desde el buscador");

    console.log("Buscador superior -> Inspector por UUID: identidades, errores y rutas OK");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
