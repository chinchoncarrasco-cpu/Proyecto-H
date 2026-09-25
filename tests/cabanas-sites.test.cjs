const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "js/sites-cabanas-v1.js"), "utf8");
const checklistSource = fs.readFileSync(path.join(root, "js/checklist.js"), "utf8");
const checklistsCabanas = vm.runInNewContext(`${checklistSource}\nchecklistsCabanas`);
const FECHA = "2026-09-23";

function nodo() {
    const clases = new Set();
    const atributos = new Map();
    const elemento = {
        dataset: {}, style: {}, hidden: false, disabled: false, value: "",
        innerHTML: "", textContent: "", children: [],
        get className() { return [...clases].join(" "); },
        set className(valor) {
            clases.clear();
            String(valor || "").split(/\s+/).filter(Boolean).forEach(clase => clases.add(clase));
        },
        classList: {
            add: clase => clases.add(clase),
            remove: clase => clases.delete(clase),
            contains: clase => clases.has(clase),
            toggle(clase, activo) {
                if (activo === undefined ? !clases.has(clase) : activo) clases.add(clase);
                else clases.delete(clase);
            }
        },
        setAttribute: (nombre, valor) => atributos.set(nombre, String(valor)),
        getAttribute: nombre => atributos.get(nombre) ?? null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {}, scrollIntoView() {}, click() {}, contains: () => false
    };
    return elemento;
}

function arnes(cabanas = {}, almacenamientoInicial = {}, opciones = {}) {
    const nodos = new Map();
    const seccion = nodo();
    const escuchas = new Map();
    const eventosDocumento = new Map();
    const eventosVentana = new Map();
    const temporizadores = [];
    const tabs = ["operation", "review"].map(cabTab => {
        const boton = nodo();
        boton.dataset.cabTab = cabTab;
        return boton;
    });
    seccion.querySelector = selector => {
        if (!nodos.has(selector)) {
            const elemento = nodo();
            if (selector === "#cabinsDetailCleaner") elemento.dataset.aseoEncargado = "";
            if (selector === "#cabinsDetailReviewer") elemento.dataset.revisionCabana = "";
            if (["#cabinsDetailIn", "#cabinsDetailOut", "#cabinsDetailAseo"].includes(selector)) {
                elemento.dataset.cabana = "";
            }
            nodos.set(selector, elemento);
        }
        return nodos.get(selector);
    };
    seccion.querySelectorAll = selector => selector === "[data-cab-tab]" ? tabs : [];
    seccion.addEventListener = (tipo, fn) => escuchas.set(tipo, fn);
    const almacenamiento = new Map(Object.entries(almacenamientoInicial));
    const sesion = opciones.sesion || new Map();
    const sessionStorage = {
        getItem: clave => sesion.get(clave) ?? null,
        setItem: (clave, valor) => sesion.set(clave, String(valor)),
        removeItem: clave => sesion.delete(clave)
    };
    let menuCabanasClick = null;
    const menuCabanas = nodo();
    menuCabanas.addEventListener = (tipo, fn) => {
        if (tipo === "click") menuCabanasClick = fn;
    };
    const localStorage = {
        getItem: clave => almacenamiento.get(clave) ?? null,
        setItem: (clave, valor) => almacenamiento.set(clave, String(valor)),
        removeItem: clave => almacenamiento.delete(clave)
    };
    const aperturas = [];
    const fecha = opciones.fecha || FECHA;
    const datosPorFecha = { [fecha]: { cabanas, notasOperativas: [] } };
    const document = {
        documentElement: nodo(),
        readyState: opciones.esperarModulos ? "loading" : "complete",
        activeElement: null,
        getElementById: id => id === "seccion-cabanas" ? seccion : null,
        querySelector: selector => selector === '.menu-item[data-seccion="cabanas"]' ? menuCabanas : null,
        addEventListener: (tipo, fn) => eventosDocumento.set(tipo, fn),
        createElement: () => nodo()
    };
    if (opciones.panel) document.documentElement.classList.add("haiku-cabanas-pendiente");
    const window = {
        haikuSesion: opciones.usuario ? { auth: { id: opciones.usuario } } : null,
        addEventListener: (tipo, fn) => {
            if (!eventosVentana.has(tipo)) eventosVentana.set(tipo, []);
            eventosVentana.get(tipo).push(fn);
        },
        abrirRevisionCabana: numero => {
            aperturas.push(["completa", String(numero)]);
            localStorage.setItem("haikuRevisionCabana", numero);
        },
        abrirRevisionAseoExpress: numero => {
            aperturas.push(["aseo_express", String(numero)]);
            localStorage.setItem("haikuAseoExpressCabana", numero);
        }
    };
    if (opciones.panel && !opciones.esperarModulos) {
        window.HAIKU_REVISION_SUPABASE_V1 = {};
        window.HAIKU_ASEO_OPERACION_V1 = {};
    }
    const contexto = vm.createContext({
        window, document, localStorage, sessionStorage, fechaSeleccionada: fecha,
        obtenerDatosDia: fecha => datosPorFecha[fecha], checklistsCabanas,
        Date, Intl, console, alert() {}, setTimeout: (fn, ms) => {
            if (ms >= 1000) temporizadores.push(fn);
            else fn();
            return 1;
        },
        MutationObserver: class { observe() {} }
    });
    vm.runInContext(source, contexto, { filename: "sites-cabanas-v1.js" });
    return { api: window.HAIKU_CABANAS_SITES_V1, nodos, tabs, seccion,
        escuchas, aperturas, localStorage, sessionStorage, sesion, almacenamiento,
        datosPorFecha, window, contexto, document,
        authReady(usuario) {
            window.haikuSesion = { auth: { id: usuario } };
            for (const fn of eventosVentana.get("haiku:auth-ready") || []) fn();
        },
        pulsarTab(tab) {
            const boton = tabs.find(item => item.dataset.cabTab === tab);
            escuchas.get("click")({ target: { closest: () => boton } });
        },
        vencerRestauracion() { temporizadores.splice(0).forEach(fn => fn()); },
        pulsarMenuCabanas: () => menuCabanasClick?.(),
        emitirDocumento: (tipo, detalle) => eventosDocumento.get(tipo)?.({ detail: detalle }) };
}

function fila(contenido, numero, tipo) {
    const atributo = tipo === "review" ? "data-cb-review-cabana" : "data-cb-cabin";
    return contenido.match(new RegExp(`<article[^>]*${atributo}="${numero}"[\\s\\S]*?<\\/article>`))?.[0] || "";
}

test("proyecta once cabañas reales y el trabajo operativo de cada estado", () => {
    const h = arnes({
        1: { estado: "libre-ingresa", reservaId: "r1", resumenTitular: "Yerko Baeza", resumenTitularReservaId: "r1", aseo: "Rodolfo" },
        2: { estado: "sale-libre", salidaReservaId: "r2", titular: "Yervic Enrique" },
        3: { estado: "continua", reservaId: "r3", titular: "Valentina Araya" },
        4: { estado: "sale-ingresa", reservaId: "r4", titular: "Luis Rosales" },
        5: {}
    });
    const contenido = h.nodos.get("#aseo-resumen").innerHTML;
    assert.equal((contenido.match(/class="cb-operation-row aseo-resumen-cabana"/g) || []).length, 11);
    for (const [numero, titular, trabajo] of [
        [1, "Yerko Baeza", "Ingreso"], [2, "Yervic Enrique", "Salida"],
        [3, "Valentina Araya", "Arrumación"], [4, "Luis Rosales", "Recambio"],
        [5, "Sin reserva", "Sin reserva"]
    ]) {
        const actual = fila(contenido, numero);
        assert.ok(actual, `Falta CAB ${numero}`);
        assert.match(actual, new RegExp(titular));
        assert.match(actual, new RegExp(trabajo));
    }
    assert.match(h.nodos.get("#cabinsOperationDescription").textContent, /11 cabañas visibles/);
});

test("la identidad de la fila pertenece a su reserva exacta y no reutiliza un titular anterior", () => {
    const h = arnes();
    assert.equal(h.api.titular({ reservaId: "r1", resumenTitular: "Yann O'Connell",
        resumenTitularReservaId: "r1", codigoHaiku: "H-1" }), "Yann O'Connell");
    assert.equal(h.api.titular({ reservaId: "r2", resumenTitular: "Titular viejo",
        resumenTitularReservaId: "r1", titular: "Titular actual", codigoHaiku: "H-2" }), "Titular actual");
    assert.equal(h.api.titular({ reservaId: "r2", resumenTitular: "Titular viejo",
        resumenTitularReservaId: "r1", codigoHaiku: "H-2" }), "H-2");
    assert.equal(h.api.titular({ resumenTitular: "Titular viejo", titular: "Titular viejo" }), "Sin reserva");
});

test("la proyección autoritativa muestra al saliente exacto y no mezcla otro ID ni una bloqueada", () => {
    const datos = {
        9: { estado: "sale-libre", salidaReservaId: "r-salida", reservaId: "r-vieja", codigoHaiku: "H-9" },
        10: { estado: "bloqueada", reservaId: "r-antigua", titular: "Huésped anterior" }
    };
    const h = arnes(datos);
    const antes = fila(h.nodos.get("#aseo-resumen").innerHTML, 9);
    assert.match(antes, /H-9/);
    h.window.HAIKU_OPERACION_DIA_IDENTIDAD_V1 = {
        obtener(fecha, numero) {
            if (fecha !== FECHA || String(numero) !== "9") return null;
            return { estado: "sale-libre", reservaId: "r-salida", titular: "Yann O'Connell" };
        }
    };
    h.emitirDocumento("haiku:resumen-datos-actualizados", { fecha: FECHA });
    const correcta = fila(h.nodos.get("#aseo-resumen").innerHTML, 9);
    assert.match(correcta, /Yann O&#39;Connell/);
    assert.doesNotMatch(correcta, /<span title="H-9">H-9<\/span>/);
    assert.equal(h.api.titular(datos[9], FECHA, "9"), "Yann O'Connell",
        "En sale-libre debe prevalecer salidaReservaId frente al reservaId local obsoleto");
    assert.match(fila(h.nodos.get("#aseo-resumen").innerHTML, 10), /Sin reserva/);
    assert.doesNotMatch(fila(h.nodos.get("#aseo-resumen").innerHTML, 10), /Huésped anterior/);

    datos[9].salidaReservaId = "r-otra";
    h.emitirDocumento("haiku:resumen-datos-actualizados", { fecha: FECHA });
    const otra = fila(h.nodos.get("#aseo-resumen").innerHTML, 9);
    assert.match(otra, /<span title="Sin titular">Sin titular<\/span>/);
    assert.doesNotMatch(otra, /Yann O&#39;Connell/);
});

test("la identidad proyectada puede resolver al saliente sin ID local, pero exige fecha y estado coincidentes", () => {
    const h = arnes();
    h.window.HAIKU_OPERACION_DIA_IDENTIDAD_V1 = {
        obtener(fecha, numero) {
            if (fecha !== FECHA || String(numero) !== "9") return null;
            return { estado: "sale-libre", reservaId: "r-salida", titular: "Yann O'Connell" };
        }
    };
    assert.equal(h.api.titular({ estado: "sale-libre" }, FECHA, "9"), "Yann O'Connell");
    assert.equal(h.api.titular({ estado: "sale-libre", reservaId: "r-vieja" }, FECHA, "9"), "Yann O'Connell",
        "El reservaId local no identifica al saliente de sale-libre");
    assert.equal(h.api.titular({ estado: "sale-libre", salidaReservaId: "r-otra" }, FECHA, "9"), "Sin titular");
    assert.equal(h.api.titular({ estado: "continua" }, FECHA, "9"), "Sin reserva");
    assert.equal(h.api.titular({ estado: "sale-libre" }, "2026-09-24", "9"), "Sin reserva");
});

test("el puente de identidad del RPC selecciona al saliente por fecha y reserva exactas", () => {
    const fuente = fs.readFileSync(path.join(root, "js/supabase-data.js"), "utf8");
    const corte = fuente.indexOf("    function limpiarCacheLegacyUnaVez(");
    assert.ok(corte > 0);
    const parcial = `${fuente.slice(0, corte)}
        window.__inyectarIdentidadPrueba = (fecha, filas) => {
            identidadDia = { fecha, filas: new Map(filas.map(fila => [String(fila.numero), fila])) };
        };
    })();`;
    const window = { haikuSupabase: {} };
    vm.runInNewContext(parcial, { window, console, Date, Intl }, { filename: "supabase-data.js/identidad" });
    window.__inyectarIdentidadPrueba(FECHA, [{ numero: 9, estado_operativo: "sale-libre",
        salida_reserva_id: "r-salida", salida_titular: "Yann O'Connell" }]);
    const identidad = window.HAIKU_OPERACION_DIA_IDENTIDAD_V1.obtener(FECHA, 9);
    assert.equal(identidad.estado, "sale-libre");
    assert.equal(identidad.reservaId, "r-salida");
    assert.equal(identidad.titular, "Yann O'Connell");
    assert.equal(window.HAIKU_OPERACION_DIA_IDENTIDAD_V1.obtener("2026-09-24", 9), null);
    assert.equal(window.HAIKU_OPERACION_DIA_IDENTIDAD_V1.obtener(FECHA, 8), null);
});

test("eliminar una solicitud registra historial sólo después de cancelarla en Supabase", async () => {
    const fuente = fs.readFileSync(path.join(root, "js/supabase-aseo-operacion-v1.js"), "utf8");
    async function ejecutar(fallar) {
        const actividad = [];
        const listeners = new Map();
        const cabana = { reservaId: "r9", titular: "Yann O'Connell",
            solicitudAseoExpress: "Reponer toallas" };
        const consulta = tabla => {
            const q = { select: () => q, eq: () => q, order: () => q, update: () => q,
                then(resolver, rechazar) {
                    const resultado = tabla === "cabanas"
                        ? { data: [{ id: "c9", numero: 9 }], error: null }
                        : tabla === "checklist_items"
                            ? { data: [], error: null }
                            : { data: null, error: fallar ? new Error("Sin conexión") : null };
                    return Promise.resolve(resultado).then(resolver, rechazar);
                } };
            return q;
        };
        const window = { haikuSupabase: { from: consulta }, haikuSesion: null,
            addEventListener() {} };
        const document = { readyState: "complete", hidden: false,
            addEventListener: (tipo, fn) => listeners.set(tipo, fn), querySelector: () => null };
        const localStorage = { getItem: () => null };
        const datosDia = { cabanas: { 9: cabana } };
        vm.runInNewContext(fuente, { window, document, localStorage, fechaSeleccionada: FECHA,
            obtenerDatosDia: () => datosDia, guardarDatos() {},
            registrarActividadHaiku: evento => actividad.push(evento),
            setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1,
            Date, Intl, Promise, console: { info() {}, error() {}, warn() {} }
        }, { filename: "supabase-aseo-operacion-v1.js" });
        const boton = { dataset: { eliminarSolicita: "9" } };
        listeners.get("click")({ target: { closest: selector =>
            selector === "[data-eliminar-solicita]" ? boton : null } });
        await window.HAIKU_ASEO_OPERACION_V1.esperarEscrituras();
        await new Promise(resolve => setImmediate(resolve));
        return { actividad, cabana };
    }
    const exito = await ejecutar(false);
    assert.equal(exito.cabana.solicitudAseoExpress, "");
    assert.equal(exito.actividad.length, 1);
    assert.equal(exito.actividad[0].accion, "Solicitud eliminada");
    assert.equal(exito.actividad[0].detalle, "Reponer toallas");
    assert.equal(exito.actividad[0].numeroCabana, "9");
    const fallo = await ejecutar(true);
    assert.equal(fallo.actividad.length, 0);
});

test("Aseo expone cuatro estados canónicos y no confunde cancelado histórico con No requiere", () => {
    const h = arnes();
    const casos = [
        [{}, "pendiente"],
        [{ aseoIn: "09:35" }, "en_curso"],
        [{ aseoOut: "10:02" }, "lista_para_revisar"],
        [{ aseoOut: "10:02", estadoRevision: "lista" }, "lista_para_revisar"],
        [{ aseoEstado: "no_requiere" }, "no_requiere"],
        [{ aseoEstado: "cancelado" }, "cancelado"]
    ];
    for (const [datos, esperado] of casos) assert.equal(h.api.estadoAseo(datos), esperado);
    const opciones = h.api.opcionesAseo("lista_para_revisar");
    assert.deepEqual([...opciones.matchAll(/<option value="([^"]+)"/g)].map(x => x[1]),
        ["pendiente", "en_curso", "lista_para_revisar", "no_requiere"]);
    assert.match(opciones, /value="lista_para_revisar" selected>Lista para revisar/);
    assert.match(h.api.opcionesAseo("cancelado"), /value="cancelado" selected disabled>Cancelado \(histórico\)/);
});

test("No requiere y Lista para revisar guardan sólo en Aseo, sin escribir revisión", async () => {
    const h = arnes({ 6: {}, 7: { aseoEstado: "en_proceso" } });
    const escrituras = [];
    h.window.HAIKU_ASEO_OPERACION_V1 = {
        async guardarEstadoAseo(numero, valor) {
            escrituras.push(["aseo", String(numero), valor]);
            h.datosPorFecha[FECHA].cabanas[numero].aseoEstado = valor;
        }
    };
    h.window.HAIKU_REVISION_RESUMEN_SYNC_V2 = {
        async guardarDesdeResumen(numero, valor) {
            escrituras.push(["revision", String(numero), valor]);
            h.datosPorFecha[FECHA].cabanas[numero].estadoRevision = "lista";
        }
    };
    const cambiar = h.escuchas.get("change");
    for (const [numero, valor] of [["6", "no_requiere"], ["7", "lista_para_revisar"]]) {
        const control = { dataset: { cabana: numero }, value: valor, disabled: false,
            matches: selector => selector === "[data-cb-clean-status]" };
        cambiar({ target: control });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(control.disabled, false);
    }
    assert.deepEqual(escrituras, [
        ["aseo", "6", "no_requiere"],
        ["aseo", "7", "completado"]
    ]);
    assert.equal(h.api.estadoAseo(h.datosPorFecha[FECHA].cabanas[6]), "no_requiere");
    assert.equal(h.api.estadoAseo(h.datosPorFecha[FECHA].cabanas[7]), "lista_para_revisar");
});

test("una revisión Lista impide retroceder Aseo y no convierte Aseo en Lista", async () => {
    const h = arnes({ 1: { aseoOut: "10:02", estadoRevision: "lista" } });
    const escrituras = [];
    h.window.HAIKU_ASEO_OPERACION_V1 = {
        async guardarEstadoAseo(numero, valor) { escrituras.push(["aseo", numero, valor]); }
    };
    h.window.HAIKU_REVISION_RESUMEN_SYNC_V2 = {
        async guardarDesdeResumen(numero, valor) { escrituras.push(["revision", numero, valor]); }
    };
    for (const nuevo of ["pendiente", "en_curso", "no_requiere"]) {
        const selector = { dataset: { cabana: "1" }, value: nuevo, disabled: false,
            matches: patron => patron === "[data-cb-clean-status]" };
        h.escuchas.get("change")({ target: selector });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(selector.value, "lista_para_revisar", `${nuevo}: el selector vuelve a Lista para revisar`);
        assert.equal(selector.disabled, false);
        assert.equal(h.api.estadoAseo(h.datosPorFecha[FECHA].cabanas[1]), "lista_para_revisar");
        assert.match(fila(h.nodos.get("#aseo-resumen").innerHTML, 1),
            /<option value="lista_para_revisar" selected>Lista para revisar<\/option>/);
    }
    assert.deepEqual(escrituras, []);
});

test("Estado final deriva seis estados sin tomar solicitudes operativas como autoridad", () => {
    const h = arnes();
    const casos = [
        [{}, "pendiente"],
        [{ aseoEstado: "en_proceso" }, "en_curso"],
        [{ aseoEstado: "completado" }, "lista_para_revisar"],
        [{ aseoEstado: "completado", estadoRevision: "con-detalles" }, "con-detalles"],
        [{ aseoEstado: "completado", estadoRevision: "lista" }, "lista"],
        [{ aseoEstado: "no_requiere", estadoRevision: "lista" }, "no_requiere"]
    ];
    for (const [dato, esperado] of casos) {
        assert.equal(h.api.estadoFinal(dato, FECHA), esperado);
        assert.equal(h.api.estadoFinal({ ...dato, solicitudAseoExpress: "Traer toallas" }, FECHA), esperado);
    }
    assert.equal(h.api.revision({ estadoRevision: "en_revision" }, FECHA), "en_revision");
    assert.equal(h.api.estadoFinal({ aseoEstado: "cancelado" }, FECHA), "pendiente",
        "un cancelado histórico no se presenta como No requiere");
});

test("la revisión autenticada pertenece al ciclo completo de la fecha y no hereda un resultado antiguo", () => {
    const h = arnes();
    h.window.haikuSesion = { usuario: { id: "u1" } };
    const dato = { aseoEstado: "completado", estadoRevision: "lista" };
    assert.equal(h.api.revision(dato, FECHA), "pendiente",
        "el estado local no sustituye un ciclo completo sin verificar");
    assert.equal(h.api.estadoFinal(dato, FECHA), "lista_para_revisar");
    dato.revisionCompletaCiclo = { fecha: "2026-09-22", verificado: true,
        estado: "completada", resultado: "lista" };
    assert.equal(h.api.revision(dato, FECHA), "pendiente",
        "una revisión del día anterior no autoriza Lista hoy");
    dato.revisionCompletaCiclo = { fecha: FECHA, verificado: true,
        estado: "en_proceso", resultado: null };
    assert.equal(h.api.revision(dato, FECHA), "en_revision");
    assert.equal(h.api.estadoFinal(dato, FECHA), "lista_para_revisar");
    dato.revisionCompletaCiclo = { fecha: FECHA, verificado: true,
        estado: "completada", resultado: "con_detalles" };
    assert.equal(h.api.estadoFinal(dato, FECHA), "con-detalles");
    dato.revisionCompletaCiclo.resultado = "lista";
    assert.equal(h.api.estadoFinal(dato, FECHA), "lista");
});

test("tabla y ficha comparten los selectores originales que guardan en Supabase", () => {
    const h = arnes({ 1: { aseo: "Rodolfo", revisionAseo: "Aura", aseoIn: "09:35", aseoOut: "10:02" } });
    const actual = fila(h.nodos.get("#aseo-resumen").innerHTML, 1);
    for (const contrato of [
        'class="aseo-encargado-input" data-aseo-encargado="1"',
        'class="aseo-revision-input" data-revision-cabana="1"',
        'class="aseo-hora-input" data-aseo-hora="aseoIn" data-cabana="1"',
        'class="aseo-hora-input" data-aseo-hora="aseoOut" data-cabana="1"',
        'data-cb-clean-status data-cabana="1"'
    ]) assert.ok(actual.includes(contrato), contrato);
    h.api.abrir(1);
    assert.deepEqual(h.aperturas, [["completa", "1"]]);
    for (const [selector, valor] of [["#cabinsDetailCleaner", "Rodolfo"],
        ["#cabinsDetailReviewer", "Aura"], ["#cabinsDetailIn", "09:35"],
        ["#cabinsDetailOut", "10:02"]]) {
        assert.equal(h.nodos.get(selector).value, valor, selector);
    }
    assert.equal(h.nodos.get("#cabinsDetailCleaner").dataset.aseoEncargado, "1");
    assert.equal(h.nodos.get("#cabinsDetailReviewer").dataset.revisionCabana, "1");
    assert.equal(h.nodos.get("#cabinsDetailIn").dataset.cabana, "1");
    assert.equal(h.nodos.get("#cabinsDetail").hidden, false);
    assert.equal(h.nodos.get("#cabinsList").hidden, true);
});

test("la pestaña de revisión usa el checklist completo y muestra Express sólo con ciclo verificado", () => {
    const dato = { reservaId: "r1", titular: "Valentina", checklist: { "0-0-0": true },
        solicitudAseoExpress: "Solicitado en texto local", checklistAseoExpress: { losa: true },
        aseoExpressCiclo: { fecha: FECHA, verificado: true, existe: false } };
    const h = arnes({ 1: dato });
    const cambiarTab = h.escuchas.get("click");
    const boton = { dataset: { cabTab: "review" } };
    cambiarTab({ target: { closest: selector => selector === "button" ? boton : null } });
    assert.equal(h.nodos.get("#cabinsOperation").hidden, true);
    assert.equal(h.nodos.get("#cabinsReview").hidden, false);
    const revision = fila(h.nodos.get(".lista-revision-cabanas").innerHTML, 1, "review");
    const total = checklistsCabanas[1].reduce((suma, area) => suma + (area.items?.length || 0)
        + (area.subareas || []).reduce((n, sub) => n + (sub.items?.length || 0), 0), 0);
    assert.match(revision, new RegExp(`1/${total}`));
    h.api.abrir(1, "review", "aseo_express");
    assert.deepEqual(h.aperturas, [["completa", "1"]],
        "el texto y el checklist local no crean un ciclo Express");
    assert.equal(h.nodos.get("#aseo-express-individual").classList.contains("activa"), false);
    assert.equal(h.nodos.get("#cabinsExpressAvailability").textContent, "No solicitado");
    assert.equal(h.nodos.get("#cabinsExpressToggle").getAttribute("aria-expanded"), "false");
    assert.equal(h.nodos.get("#revision-individual").classList.contains("activa"), true);
    dato.aseoExpressCiclo = { fecha: FECHA, verificado: true, existe: true };
    h.api.abrir(1, "review", "aseo_express");
    assert.deepEqual(h.aperturas.at(-1), ["aseo_express", "1"]);
    assert.equal(h.nodos.get("#aseo-express-individual").classList.contains("activa"), true);
    assert.equal(h.nodos.get("#revision-individual").classList.contains("activa"), false);
    assert.equal(h.nodos.get("#cabinsExpressAvailability").textContent, "Solicitado");
    assert.match(html, /id="revision-checklist"/);
    assert.match(html, /id="aseo-express-checklist"[\s\S]*?data-aseo-express-item=/);
});

test("Express exige autoridad real para la fecha de la ficha y permite abrir/cerrar sin crear ciclo", () => {
    const dato = { aseoExpressCiclo: { fecha: "2026-09-22", verificado: true, existe: true } };
    const h = arnes({ 1: dato });
    assert.equal(h.api.expressReal(dato, FECHA), false);
    h.api.abrir(1);
    const pulsarToggle = () => h.escuchas.get("click")({ target: { closest: selector =>
        selector === "button" ? { id: "cabinsExpressToggle", dataset: {} } : null } });
    pulsarToggle();
    assert.equal(h.nodos.get("#aseo-express-individual").classList.contains("activa"), false);
    assert.equal(h.nodos.get("#cabinsExpressToggle").getAttribute("aria-expanded"), "false");
    assert.equal(h.localStorage.getItem("haikuAseoExpressCabana"), null);
    dato.aseoExpressCiclo = { fecha: FECHA, verificado: true, existe: true };
    h.api.pintar();
    pulsarToggle();
    assert.equal(h.nodos.get("#aseo-express-individual").classList.contains("activa"), true);
    assert.equal(h.nodos.get("#cabinsExpressToggle").getAttribute("aria-expanded"), "true");
    pulsarToggle();
    assert.equal(h.nodos.get("#aseo-express-individual").classList.contains("activa"), false);
    assert.equal(h.localStorage.getItem("haikuAseoExpressCabana"), null);
});

test("checklist Express conserva dieciséis claves y rótulos en el orden aprobado", () => {
    const bloque = html.match(/id="aseo-express-checklist"[\s\S]*?(?=<div class="cb-observations">)/)?.[0] || "";
    const sectores = [...bloque.matchAll(/<div class="revision-area"><h4>([^<]+)<\/h4>([\s\S]*?)<\/div>/g)]
        .map(([, nombre, contenido]) => ({ nombre, items: [...contenido.matchAll(
            /data-aseo-express-item="([^"]+)">\s*([^<]+)<\/label>/g)]
            .map(([, clave, rotulo]) => [clave, rotulo]) }));
    assert.deepEqual(sectores, [
        { nombre: "Cocina", items: [["losa", "Losa"], ["llaveGas", "Llave de gas"],
            ["te", "Té"], ["cafe", "Café"], ["teHierbas", "Té Hierbas"]] },
        { nombre: "Baño", items: [["amenities", "Amenities"], ["papelH", "Papel H."],
            ["toallas", "Toallas"], ["wc", "WC"]] },
        { nombre: "Living/Cama", items: [["cama", "Cama"], ["salamandra", "Salamandra"],
            ["lena", "Leña"], ["diario", "Diario"]] },
        { nombre: "Terraza", items: [["carbon", "Carbón"], ["fogon", "Fogón"],
            ["ventanas", "Ventanas"]] }
    ]);
    assert.equal(sectores.flatMap(sector => sector.items).length, 16);
    assert.match(html, /id="cabinsExpressToggle"[^>]*aria-controls="aseo-express-individual"[^>]*aria-expanded="false"/);
    assert.match(html, /id="revision-estado"[^>]*>[\s\S]*?<option value="en_revision">En revisión<\/option>/);
    assert.match(html, /id="aseo-express-estado"[^>]*>[\s\S]*?<option value="en_revision">En revisión<\/option>/);
    assert.match(html, /id="cabinsFinalStateDisplay"[^>]*aria-live="polite"/);
    assert.match(html, /id="cabinsExpressFinalStateDisplay"[^>]*aria-live="polite"/);
});

test("cambiar entre revisión completa y Express mantiene una sola cabaña escritora", () => {
    const h = arnes({ 1: { reservaId: "r1", titular: "Titular uno" },
        2: { reservaId: "r2", titular: "Titular dos",
            aseoExpressCiclo: { fecha: FECHA, verificado: true, existe: true } } });
    h.api.abrir(1, "review", "completa");
    assert.equal(h.localStorage.getItem("haikuRevisionCabana"), "1");
    assert.equal(h.localStorage.getItem("haikuAseoExpressCabana"), null);

    h.api.abrir(2, "review", "aseo_express");
    assert.equal(h.localStorage.getItem("haikuRevisionCabana"), null);
    assert.equal(h.localStorage.getItem("haikuAseoExpressCabana"), "2");
    assert.equal(h.nodos.get("#revision-titulo").textContent, "Cabaña 2");
    assert.equal(h.nodos.get("#cabinsDetailCleaner").dataset.aseoEncargado, "2");
    assert.equal(h.nodos.get("#revision-individual").classList.contains("activa"), false);
    assert.equal(h.nodos.get("#aseo-express-individual").classList.contains("activa"), true);

    h.api.abrir(1, "review", "completa");
    assert.equal(h.localStorage.getItem("haikuRevisionCabana"), "1");
    assert.equal(h.localStorage.getItem("haikuAseoExpressCabana"), null);
    assert.equal(h.nodos.get("#revision-titulo").textContent, "Cabaña 1");
    assert.equal(h.nodos.get("#aseo-express-individual").classList.contains("activa"), false);

    h.datosPorFecha[FECHA].cabanas[1].aseoExpressCiclo = { fecha: FECHA, verificado: true, existe: true };
    const modo = { id: "cabinsReviewMode", value: "aseo_express", matches: () => false };
    h.escuchas.get("change")({ target: modo });
    assert.equal(h.localStorage.getItem("haikuRevisionCabana"), null);
    assert.equal(h.localStorage.getItem("haikuAseoExpressCabana"), "1");
    modo.value = "completa";
    h.escuchas.get("change")({ target: modo });
    assert.equal(h.localStorage.getItem("haikuRevisionCabana"), "1");
    assert.equal(h.localStorage.getItem("haikuAseoExpressCabana"), null);
});

test("F5 restaura ficha y writer de la misma cabaña o descarta llaves contradictorias", () => {
    const datos = { 1: { reservaId: "r1", titular: "Titular uno" },
        2: { reservaId: "r2", titular: "Titular dos",
            aseoExpressCiclo: { fecha: FECHA, verificado: true, existe: true } } };
    const h = arnes(datos);
    h.api.abrir(2, "operation", "aseo_express");
    const refrescada = arnes(datos, Object.fromEntries(h.almacenamiento));
    assert.equal(refrescada.nodos.get("#cabinsDetail").hidden, false);
    assert.equal(refrescada.nodos.get("#revision-titulo").textContent, "Cabaña 2");
    assert.deepEqual(refrescada.aperturas, [["completa", "2"]],
        "F5 no restaura un writer Express antes de revalidar su ciclo");
    assert.equal(refrescada.localStorage.getItem("haikuRevisionCabana"), "2");
    assert.equal(refrescada.localStorage.getItem("haikuAseoExpressCabana"), null);

    const contradictoria = arnes(datos, { haikuRevisionCabana: "1", haikuAseoExpressCabana: "2" });
    assert.equal(contradictoria.nodos.get("#cabinsDetail").hidden, true);
    assert.deepEqual(contradictoria.aperturas, []);
    assert.equal(contradictoria.localStorage.getItem("haikuRevisionCabana"), null);
    assert.equal(contradictoria.localStorage.getItem("haikuAseoExpressCabana"), null);
});

test("panel restaura Operación y Revisión de cabañas en la fecha de la pestaña", () => {
    const fecha = "2026-09-10";
    const sesion = new Map();
    const primero = arnes({}, {}, { panel: true, fecha, usuario: "usuario-a", sesion });
    assert.equal(primero.document.documentElement.classList.contains("haiku-cabanas-pendiente"), false);
    assert.equal(JSON.parse(sesion.get("haikuCabanasContextoPestanaV1")).tab, "operation");
    const operacion = arnes({}, {}, { panel: true, fecha, usuario: "usuario-a", sesion });
    assert.equal(operacion.nodos.get("#cabinsOperation").hidden, false);
    assert.equal(operacion.nodos.get("#cabinsDetail").hidden, true);
    assert.match(operacion.nodos.get("#cabinsDate").textContent, /10 de septiembre de 2026/i);

    operacion.pulsarTab("review");
    assert.equal(JSON.parse(sesion.get("haikuCabanasContextoPestanaV1")).tab, "review");
    const revision = arnes({}, {}, { panel: true, fecha, usuario: "usuario-a", sesion });
    assert.equal(revision.nodos.get("#cabinsReview").hidden, false);
    assert.equal(revision.nodos.get("#cabinsOperation").hidden, true);
    assert.equal(revision.aperturas.length, 0);
});

test("panel restaura ficha y revisión completa de la misma cabaña con un solo writer", () => {
    const fecha = "2026-09-10";
    const datos = { 1: { revisionCompletaCiclo: {
        fecha, verificado: true, id: "revision-1", estado: "en_proceso"
    } } };
    const sesion = new Map();
    const primero = arnes(datos, {}, { panel: true, fecha, usuario: "usuario-a", sesion });
    primero.api.abrir(1, "operation", "completa");
    const ficha = arnes(datos, Object.fromEntries(primero.almacenamiento),
        { panel: true, fecha, usuario: "usuario-a", sesion });
    assert.equal(ficha.nodos.get("#cabinsDetail").hidden, false);
    assert.equal(ficha.nodos.get("#revision-individual").classList.contains("activa"), true);
    assert.deepEqual(ficha.aperturas, [["completa", "1"]]);
    assert.equal(ficha.localStorage.getItem("haikuRevisionCabana"), "1");
    assert.equal(ficha.document.documentElement.classList.contains("haiku-cabanas-pendiente"), false);

    ficha.api.cerrar();
    ficha.pulsarTab("review");
    ficha.api.abrir(1, "review", "completa");
    const recarga = arnes(datos, Object.fromEntries(ficha.almacenamiento),
        { panel: true, fecha, usuario: "usuario-a", sesion });
    assert.equal(recarga.nodos.get("#cabinsDetail").hidden, false);
    assert.equal(recarga.nodos.get("#revision-individual").classList.contains("activa"), true);
    assert.equal(recarga.nodos.get("#volver-cabanas").textContent.includes("Revisión de cabañas"), true);
    assert.deepEqual(recarga.aperturas, [["completa", "1"]]);
    recarga.authReady("usuario-a");
    assert.deepEqual(recarga.aperturas, [["completa", "1"]],
        "un segundo auth-ready no abre otra vez el writer");
});

test("panel espera autenticación y revisión verificada sin mostrar Hoy ni otra subvista", () => {
    const fecha = "2026-09-10";
    const sesion = new Map([["haikuCabanasContextoPestanaV1", JSON.stringify({
        usuarioId: "usuario-a", fecha, tab: "review", numero: "1", origen: "review",
        modo: "completa", revisionId: "revision-1"
    })]]);
    const datos = { 1: { revisionCompletaCiclo: { fecha, verificado: false, id: "revision-1" } } };
    const h = arnes(datos, { haikuRevisionCabana: "9" }, { panel: true, fecha, sesion });
    assert.equal(h.nodos.has("#cabinsDate"), false, "no se pinta Hoy antes de auth-ready");
    assert.equal(h.document.documentElement.classList.contains("haiku-cabanas-pendiente"), true);
    h.authReady("usuario-a");
    assert.deepEqual(h.aperturas, [["completa", "1"]]);
    assert.equal(h.localStorage.getItem("haikuRevisionCabana"), "1");
    assert.equal(h.document.documentElement.classList.contains("haiku-cabanas-pendiente"), true);
    datos[1].revisionCompletaCiclo.verificado = true;
    h.emitirDocumento("haiku:resumen-datos-actualizados", { fecha });
    assert.equal(h.document.documentElement.classList.contains("haiku-cabanas-pendiente"), false);
    assert.equal(h.nodos.get("#cabinsDetail").hidden, false);
});

test("auth-ready temprano espera el puente real antes de abrir un checklist", () => {
    const fecha = "2026-09-10";
    const sesion = new Map([["haikuCabanasContextoPestanaV1", JSON.stringify({
        usuarioId: "usuario-a", fecha, tab: "review", numero: "1", origen: "review",
        modo: "completa", revisionId: "revision-1"
    })]]);
    const datos = { 1: { revisionCompletaCiclo: { fecha, verificado: false } } };
    const h = arnes(datos, {}, { panel: true, fecha, sesion, esperarModulos: true });
    h.authReady("usuario-a");
    assert.deepEqual(h.aperturas, []);
    h.window.HAIKU_REVISION_SUPABASE_V1 = {};
    h.emitirDocumento("DOMContentLoaded");
    assert.deepEqual(h.aperturas, [["completa", "1"]]);
    datos[1].revisionCompletaCiclo = { fecha, verificado: true, id: "revision-1" };
    h.emitirDocumento("haiku:resumen-datos-actualizados", { fecha });
    assert.equal(h.nodos.get("#cabinsDetail").hidden, false);
    assert.equal(h.document.documentElement.classList.contains("haiku-cabanas-pendiente"), false);
});

test("Aseo Express se reabre sólo después de verificar el ciclo de esa fecha", () => {
    const fecha = "2026-09-10";
    const sesion = new Map([["haikuCabanasContextoPestanaV1", JSON.stringify({
        usuarioId: "usuario-a", fecha, tab: "review", numero: "2", origen: "review",
        modo: "aseo_express", revisionId: "express-2"
    })]]);
    const datos = { 2: { aseoExpressCiclo: {
        fecha, verificado: false, existe: true, revisionId: "express-2"
    } } };
    const h = arnes(datos, {}, { panel: true, fecha, usuario: "usuario-a", sesion });
    assert.deepEqual(h.aperturas, [], "no abre un writer completo mientras Express se verifica");
    assert.equal(h.document.documentElement.classList.contains("haiku-cabanas-pendiente"), true);
    datos[2].aseoExpressCiclo.verificado = true;
    h.emitirDocumento("haiku:resumen-datos-actualizados", { fecha });
    assert.deepEqual(h.aperturas, [["aseo_express", "2"]]);
    assert.equal(h.nodos.get("#cabinsDetail").hidden, false);
    assert.equal(h.document.documentElement.classList.contains("haiku-cabanas-pendiente"), false);
});

test("una revisión que no logra verificarse abandona la espera en Operación de la misma fecha", () => {
    const fecha = "2026-09-10";
    const sesion = new Map([["haikuCabanasContextoPestanaV1", JSON.stringify({
        usuarioId: "usuario-a", fecha, tab: "review", numero: "1", origen: "review",
        modo: "completa", revisionId: "revision-1"
    })]]);
    const h = arnes({ 1: { revisionCompletaCiclo: { fecha, verificado: false } } }, {},
        { panel: true, fecha, usuario: "usuario-a", sesion });
    assert.equal(h.document.documentElement.classList.contains("haiku-cabanas-pendiente"), true);
    h.vencerRestauracion();
    assert.equal(h.nodos.get("#cabinsOperation").hidden, false);
    assert.equal(h.nodos.get("#cabinsDetail").hidden, true);
    assert.equal(h.document.documentElement.classList.contains("haiku-cabanas-pendiente"), false);
    assert.equal(JSON.parse(sesion.get("haikuCabanasContextoPestanaV1")).fecha, fecha);
});

test("contexto inválido, revisión cambiada o usuario nuevo vuelven a Operación de la fecha vigente", () => {
    const fecha = "2026-09-10";
    const contexto = { usuarioId: "usuario-a", fecha, tab: "review", numero: "1",
        origen: "review", modo: "completa", revisionId: "revision-vieja" };
    for (const variante of [
        { contexto: { ...contexto, fecha: "2026-09-09" }, usuario: "usuario-a" },
        { contexto, usuario: "usuario-b" },
        { contexto: { ...contexto, numero: "99" }, usuario: "usuario-a" }
    ]) {
        const sesion = new Map([["haikuCabanasContextoPestanaV1", JSON.stringify(variante.contexto)]]);
        const h = arnes({}, { haikuRevisionCabana: "1" },
            { panel: true, fecha, usuario: variante.usuario, sesion });
        assert.equal(h.nodos.get("#cabinsOperation").hidden, false);
        assert.equal(h.nodos.get("#cabinsDetail").hidden, true);
        assert.equal(h.aperturas.length, 0);
        assert.equal(h.localStorage.getItem("haikuRevisionCabana"), null);
        assert.equal(JSON.parse(sesion.get("haikuCabanasContextoPestanaV1")).fecha, fecha);
    }
    const distinta = arnes({ 1: { revisionCompletaCiclo: {
        fecha, verificado: true, id: "revision-nueva"
    } } }, {}, { panel: true, fecha, usuario: "usuario-a", sesion: new Map([
        ["haikuCabanasContextoPestanaV1", JSON.stringify(contexto)]
    ]) });
    assert.equal(distinta.nodos.get("#cabinsDetail").hidden, true);
    assert.equal(distinta.nodos.get("#cabinsOperation").hidden, false);
});

test("pestaña nueva no reutiliza writer legacy ni una ficha de la sesión anterior", () => {
    const h = arnes({}, { haikuRevisionCabana: "1" },
        { panel: true, fecha: "2026-09-10", usuario: "usuario-a", sesion: new Map() });
    assert.equal(h.nodos.get("#cabinsDetail").hidden, true);
    assert.equal(h.localStorage.getItem("haikuRevisionCabana"), null);
    assert.equal(h.document.documentElement.classList.contains("haiku-cabanas-pendiente"), false);
});

test("panel no ejecuta la reapertura legacy antes del contexto validado", () => {
    const cabanas = fs.readFileSync(path.join(root, "js/cabanas.js"), "utf8");
    const inicio = cabanas.indexOf("const revisionCabanaGuardada =");
    const fin = cabanas.indexOf("// RESUMEN DE ASEO", inicio);
    assert.ok(inicio > 0 && fin > inicio);
    const arranque = cabanas.slice(inicio, fin);
    for (const [panel, esperadas] of [[true, 0], [false, 1]]) {
        const aperturas = [];
        vm.runInNewContext(arranque, {
            localStorage: { getItem: () => "1" },
            document: { documentElement: { classList: {
                contains: clase => panel && clase === "haiku-cabanas-pendiente"
            } } },
            abrirRevisionCabana: numero => aperturas.push(numero)
        });
        assert.equal(aperturas.length, esperadas);
    }
});

test("panel mantiene Cabañas oculta hasta validar fecha y subvista", () => {
    const panel = fs.readFileSync(path.join(root, "panel.html"), "utf8");
    assert.match(panel, /haiku-cabanas-pendiente #seccion-cabanas\{visibility:hidden\}/);
    assert.match(panel, /haiku-resumen-pendiente haiku-pagos-pendiente haiku-cabanas-pendiente/);
});

test("al cambiar la fecha operativa se cierra la ficha antes de mostrar el nuevo día", () => {
    const h = arnes({ 1: { reservaId: "r1", titular: "Titular día 23" } });
    h.api.abrir(1, "review", "completa");
    assert.equal(h.nodos.get("#cabinsDetail").hidden, false);
    assert.equal(h.localStorage.getItem("haikuRevisionCabana"), "1");
    h.datosPorFecha["2026-09-24"] = { cabanas: { 1: { reservaId: "r2", titular: "Titular día 24" } },
        notasOperativas: [] };
    h.contexto.fechaSeleccionada = "2026-09-24";
    h.api.pintar("2026-09-24");
    assert.equal(h.nodos.get("#cabinsDetail").hidden, true,
        "el checklist cerrado sobre el día 23 ya no queda accesible en la ficha");
    assert.equal(h.nodos.get("#cabinsList").hidden, false);
    assert.equal(h.nodos.get("#revision-individual").classList.contains("activa"), false);
    assert.equal(h.localStorage.getItem("haikuRevisionCabana"), null);
    assert.equal(h.localStorage.getItem("haikuAseoExpressCabana"), null);
    assert.match(fila(h.nodos.get("#aseo-resumen").innerHTML, 1), /Titular día 24/);
    assert.doesNotMatch(fila(h.nodos.get("#aseo-resumen").innerHTML, 1), /Titular día 23/);
});

test("pulsar Cabañas en el menú cierra ficha y restaura el listado", () => {
    const h = arnes({ 2: { reservaId: "r2", titular: "Titular dos" } });
    h.api.abrir(2, "operation", "aseo_express");
    assert.equal(h.nodos.get("#cabinsDetail").hidden, false);
    h.pulsarMenuCabanas();
    assert.equal(h.nodos.get("#cabinsDetail").hidden, true);
    assert.equal(h.nodos.get("#cabinsList").hidden, false);
    assert.equal(h.nodos.get("#aseo-express-individual").classList.contains("activa"), false);
    assert.equal(h.localStorage.getItem("haikuRevisionCabana"), null);
    assert.equal(h.localStorage.getItem("haikuAseoExpressCabana"), null);
    assert.match(h.nodos.get("#aseo-resumen").innerHTML, /data-cb-cabin="2"/);
});

test("Aseo deja el menú, y una sección guardada antigua se restaura como Cabañas", () => {
    assert.doesNotMatch(html, /class="menu-item" data-seccion="aseo"/);
    assert.match(html, /class="menu-item" data-seccion="cabanas"/);
    const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
    const nav = app.slice(0, app.indexOf("// DATOS OPERATIVOS POR FECHA"));
    const menu = nodo(); menu.dataset.seccion = "cabanas";
    const cabañas = nodo(); const otra = nodo();
    const storage = new Map([["haikuSeccionActual", "aseo"]]);
    const document = {
        querySelectorAll: selector => selector === ".menu-item[data-seccion]" ? [menu] : [cabañas, otra],
        querySelector: selector => selector.includes("cabanas") ? menu : null,
        getElementById: id => id === "seccion-cabanas" ? cabañas : null
    };
    const localStorage = { getItem: clave => storage.get(clave) || null,
        setItem: (clave, valor) => storage.set(clave, valor) };
    vm.runInNewContext(nav, { document, localStorage }, { filename: "app.js/navegación" });
    assert.equal(storage.get("haikuSeccionActual"), "cabanas");
    assert.equal(cabañas.classList.contains("activa"), true);
    assert.equal(menu.classList.contains("activo"), true);
});
