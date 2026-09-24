const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const fuente = fs.readFileSync(require.resolve("../js/supabase-resumen-tablero-v1.js"), "utf8");

function articulos() {
    return [...html.matchAll(/<article class="sites-resumen-cabana"[^>]*data-cabana="(\d+)"[^>]*>([\s\S]*?)<\/article>/g)]
        .map(([, numero, contenido]) => ({ numero, contenido }));
}

function api({ document, sesion = true, permisos = [], datos = {}, checkoutDisponible = true,
    rpc = null, logger = console, finalResolver = null } = {}) {
    const cierre = fuente.lastIndexOf("})();");
    assert.ok(cierre > 0);
    const codigo = `${fuente.slice(0, cierre)}\n` +
        "globalThis.__api={alternarDetalle,reservaExacta,habilitarAcciones,resumenFila,titularVisible,listaLectura,servicioParaLectura,pintarFlujo,cargarHistorial,invalidarHistorial,iniciar};\n})();";
    const documento = document || { readyState: "loading", addEventListener() {} };
    const contexto = vm.createContext({
        document: documento,
        window: {
            haikuSesion: sesion ? { usuario: { id: "u1" } } : null,
            haikuTienePermiso: codigo => permisos.includes(codigo),
            HAIKU_RESUMEN_PAGO_SITES_V1: { tieneTarjeta: () => checkoutDisponible },
            HAIKU_CABANAS_SITES_V1: finalResolver ? { estadoFinal: finalResolver } : null,
            haikuSupabase: rpc ? { rpc } : null
        },
        datosPorFecha: datos,
        fechaSeleccionada: "2026-09-23",
        Date, Intl, console: logger, setTimeout, clearTimeout,
        requestAnimationFrame: callback => callback(),
        MutationObserver: class { observe() {} }
    });
    vm.runInContext(codigo, contexto, { filename: "supabase-resumen-tablero-v1.js" });
    return contexto.__api;
}

function filaFalsa(numero, estado, extras = {}) {
    const acciones = Object.fromEntries(["ficha", "servicio", "nota", "pago"]
        .map(nombre => [nombre, { hidden: true, dataset: {} }]));
    const controles = {
        '[data-campo="estado"]': { value: estado },
        "[data-ficha-cabana]": acciones.ficha,
        "[data-agregar-servicio]": acciones.servicio,
        "[data-agregar-nota-cabana]": acciones.nota,
        "[data-resumen-pago]": acciones.pago,
        ...extras
    };
    const fila = {
        dataset: { cabana: String(numero), resumenFecha: "2026-09-23" },
        querySelector: selector => controles[selector] || null
    };
    return { fila, acciones, controles };
}

test("once artículos Sites tienen siete celdas, tres días y cuatro bloques de detalle", () => {
    const lista = articulos();
    assert.deepEqual(lista.map(item => Number(item.numero)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const columnas = ["cabana", "huesped", "estado", "aseo", "servicios", "cobros", "final"];
    for (const { numero, contenido } of lista) {
        assert.deepEqual([...contenido.matchAll(/class="sites-resumen-celda sites-resumen-celda--([a-z]+)"/g)]
            .map(([, columna]) => columna), columnas, `CAB ${numero}`);
        for (const dia of ["anterior", "actual", "siguiente"]) {
            assert.equal((contenido.match(new RegExp(`sites-resumen-dia--${dia}`, "g")) || []).length, 1);
        }
        for (const bloque of ["reserva", "aseo", "servicios", "acciones"]) {
            assert.equal((contenido.match(new RegExp(`sites-resumen-detalle-bloque--${bloque}`, "g")) || []).length, 1);
        }
        assert.match(contenido, new RegExp(`data-resumen-expandir="${numero}"[^>]*aria-expanded="false"[^>]*aria-controls="sites-resumen-detalle-${numero}"`));
        assert.match(contenido, new RegExp(`data-resumen-ficha-cabana="${numero}"`));
        assert.match(contenido, /<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10/);
        assert.match(contenido, new RegExp(`id="sites-resumen-detalle-${numero}"[^>]*hidden`));
        assert.doesNotMatch(contenido, /<(?:table|thead|tbody|tr|td|th)\b/i);
    }
});

test("la cabecera del listado y los paneles inferiores respetan la composición Sites", () => {
    const cabecera = html.indexOf('<div class="sites-resumen-tabla-cabecera">');
    const panel = html.indexOf('<section class="panel sites-resumen-tablero-panel">');
    assert.ok(cabecera >= 0 && panel > cabecera, "El título queda fuera del borde del listado");
    assert.match(html, /<label class="sites-resumen-campo-etiqueta" for="notas-dia">Información general<\/label>/);
    const tituloResumen = html.indexOf("<h3>Resumen del día</h3>");
    const copiar = html.indexOf('id="copiar-resumen-dia"', tituloResumen);
    const contenido = html.indexOf('class="resumen-dia-contenido"', tituloResumen);
    assert.ok(tituloResumen >= 0 && tituloResumen < copiar && copiar < contenido,
        "Copiar resumen pertenece a la cabecera del panel");
});

test("hay una sola instancia por cabaña de cada control y acción real", () => {
    const campos = ["adultos", "ninos", "mascotas", "checkout", "ingreso", "aseo",
        "aseoIn", "aseoOut", "estado", "checkinRealizado", "servicio"];
    for (const { numero, contenido } of articulos()) {
        for (const campo of campos) {
            assert.equal((contenido.match(new RegExp(`data-campo="${campo}"`, "g")) || []).length,
                1, `CAB ${numero}: ${campo}`);
        }
        assert.equal((contenido.match(/data-campo="(?:estadoFinal|estadoRevision)"/g) || []).length,
            1, `CAB ${numero}: estado final`);
        for (const accion of ["ficha-cabana", "agregar-servicio", "agregar-nota-cabana", "resumen-pago"]) {
            assert.equal((contenido.match(new RegExp(`data-${accion}="${numero}"`, "g")) || []).length,
                1, `CAB ${numero}: ${accion}`);
        }
        assert.match(contenido, new RegExp(`aria-label="Estado operativo de cabaña ${numero}"`));
        assert.match(contenido, new RegExp(`aria-label="Estado final de cabaña ${numero}"`));
        assert.doesNotMatch(contenido, /nota-resumen-agregar|resumen-contexto-toggle/);
    }
    assert.doesNotMatch(html, /Ocultar día anterior/);
});

test("Ver detalle sólo edita las dos horas de Aseo y deja Estado final en lectura", () => {
    for (const { numero, contenido } of articulos()) {
        assert.match(contenido, new RegExp(
            `<strong class="sites-resumen-valor titular-cabana" data-titular-cabana="${numero}">`),
        `CAB ${numero}: el titular funcional sigue visible para las marcas de reserva vinculada`);
        assert.equal((contenido.match(/data-titular-cabana="\d+"/g) || []).length, 1,
            `CAB ${numero}: el titular no se duplica`);
        const visible = contenido.split('<div class="sites-resumen-detalle"')[1]
            ?.split('<div class="sites-resumen-datos-funcionales"')[0] || "";
        assert.ok(visible, `CAB ${numero}: falta detalle visible`);
        assert.deepEqual([...visible.matchAll(/data-campo="([^"]+)"/g)].map(([, campo]) => campo),
            ["aseoIn", "aseoOut", numero === "7" ? "estadoRevision" : "estadoFinal"],
            `CAB ${numero}: controles visibles`);
        const final = visible.match(/<select[^>]*data-campo="(?:estadoFinal|estadoRevision)"[^>]*>/)?.[0] || "";
        assert.match(final, /\bdisabled\b/, `CAB ${numero}: el estado final no se edita`);
        assert.match(visible, /class="sites-resumen-detalle-servicios"/);
        assert.match(visible, /class="sites-resumen-detalle-notas"/);
        assert.doesNotMatch(visible, /nota-eliminar|nota-resumen-agregar|servicio-resumen-wrap/);
        const oculto = contenido.split('<div class="sites-resumen-datos-funcionales"')[1] || "";
        for (const campo of ["adultos", "ninos", "mascotas", "ingreso", "checkout",
            "aseo", "estado", "checkinRealizado", "servicio"]) {
            assert.match(oculto, new RegExp(`data-campo="${campo}"`),
                `CAB ${numero}: fuente funcional ${campo}`);
        }
        assert.match(oculto, new RegExp(`data-nota-cabana="${numero}"`));
    }
});

test("Resumen pinta los seis finales derivados en un output sin habilitar el selector histórico", () => {
    let valor = "pendiente";
    let salida = null;
    let creaciones = 0;
    const visible = { textContent: "" };
    const contenedor = { querySelector: selector => selector === ".sites-resumen-final-lectura" ? salida : null };
    const selectFinal = {
        disabled: false, hidden: false, parentElement: contenedor,
        selectedOptions: [{ textContent: "Pendiente" }], atributos: {},
        setAttribute(nombre, texto) { this.atributos[nombre] = texto; },
        insertAdjacentElement(posicion, nodo) {
            assert.equal(posicion, "afterend");
            salida = nodo;
        }
    };
    const final = { querySelector: selector => selector === ".sites-resumen-valor" ? visible : null };
    const { fila } = filaFalsa(1, "libre-libre", {
        '[data-campo="estadoFinal"]': selectFinal,
        ".sites-resumen-celda--final": final
    });
    const documento = { readyState: "loading", addEventListener() {},
        createElement(etiqueta) { assert.equal(etiqueta, "output"); creaciones++; return { textContent: "" }; } };
    const modulo = api({ document: documento, finalResolver: () => valor });
    for (const [codigo, rotulo] of [
        ["pendiente", "Pendiente"], ["en_curso", "En curso"],
        ["lista_para_revisar", "Lista para revisar"], ["con-detalles", "Con detalles"],
        ["lista", "Lista"], ["no_requiere", "No requiere"]
    ]) {
        valor = codigo;
        modulo.resumenFila(fila, "2026-09-23");
        assert.equal(visible.textContent, rotulo);
        assert.equal(salida.textContent, rotulo);
        assert.equal(selectFinal.disabled, true);
        assert.equal(selectFinal.hidden, true);
        assert.equal(selectFinal.atributos["aria-label"], `Estado final de cabaña 1: ${rotulo}`);
    }
    assert.equal(creaciones, 1, "los repintados reutilizan el mismo elemento de lectura");
});

test("el titular visible exige proyección con UUID de la reserva exacta", () => {
    const modulo = api();
    const nombre = { textContent: "Sin reserva" };
    const fila = { dataset: { resumenFecha: "2026-09-23",
        resumenReservaId: "reserva-continua" },
        querySelector: selector => selector === ".titular-cabana" ? nombre : null };
    assert.equal(modulo.titularVisible(fila, "2026-09-23", "libre-libre", null), "");
    nombre.textContent = "Valentina Araya";
    assert.equal(modulo.titularVisible(fila, "2026-09-23", "continua", null), "",
        "el texto del DOM no autoriza el titular");
    fila.dataset.resumenTitularReservaId = "reserva-continua";
    fila.dataset.resumenTitular = "Valentina Araya";
    assert.equal(modulo.titularVisible(fila, "2026-09-23", "continua", null), "Valentina Araya");
    fila.dataset.resumenTitularReservaId = "otra-reserva";
    assert.equal(modulo.titularVisible(fila, "2026-09-23", "continua", null), "");
});

test("Servicios y notas se proyectan como lectura sin reescribir la misma lista", () => {
    const documento = { readyState: "loading", addEventListener() {},
        createElement: () => ({ textContent: "" }) };
    const modulo = api({ document: documento });
    const lista = { children: [], cambios: 0,
        replaceChildren(...items) { this.children = items; this.cambios++; } };
    const servicios = [modulo.servicioParaLectura("09:30 Desayuno"),
        modulo.servicioParaLectura("Tinaja Tonel")];
    modulo.listaLectura(lista, servicios, "Sin servicios");
    assert.deepEqual(lista.children.map(item => item.textContent),
        ["Desayuno · 09:30", "Tinaja Tonel"]);
    modulo.listaLectura(lista, servicios, "Sin servicios");
    assert.equal(lista.cambios, 1, "Un refresh sin cambios no muta el DOM");
    modulo.listaLectura(lista, [], "Sin notas");
    assert.equal(lista.children[0].textContent, "Sin notas");
});

test("la salida muestra al huésped saliente sin volverlo reserva activa", () => {
    const modulo = api();
    const { fila } = filaFalsa(2, "sale-libre", {
        ".titular-cabana": { textContent: "Sin titular" }
    });
    fila.dataset.resumenSalidaTitular = "Martín López";
    fila.dataset.salidaReservaId = "reserva-saliente";
    fila.dataset.resumenReservaId = "reserva-saliente";
    fila.dataset.resumenTitularReservaId = "reserva-saliente";
    fila.dataset.resumenTitular = "Martín López";
    assert.equal(modulo.titularVisible(fila, "2026-09-23", "sale-libre", null), "Martín López");
    assert.equal(modulo.reservaExacta(fila, {}).etapa, "checkout");
    assert.equal(modulo.reservaExacta(fila, {}).id, "reserva-saliente");
    assert.equal(modulo.titularVisible(fila, "2026-09-24", "sale-libre", null), "");
    assert.equal(modulo.titularVisible(fila, "2026-09-23", "bloqueada", null), "");
    fila.dataset.resumenTitularReservaId = "otra-reserva";
    assert.equal(modulo.titularVisible(fila, "2026-09-23", "sale-libre", null), "");
});

test("una cabaña bloqueada no se presenta como reserva del día", () => {
    const modulo = api();
    const nombre = { textContent: "" };
    const sublinea = { textContent: "" };
    const huesped = { querySelector: selector => selector === ".sites-resumen-valor"
        ? nombre : selector === ".sites-resumen-subvalor" ? sublinea : null };
    const { fila } = filaFalsa(1, "bloqueada", {
        ".titular-cabana": { textContent: "BLOQUEADA" },
        ".sites-resumen-celda--huesped": huesped
    });
    modulo.resumenFila(fila, "2026-09-23");
    assert.equal(nombre.textContent, "Sin reserva");
    assert.equal(sublinea.textContent, "Cabaña bloqueada");
});

test("la fila no mezcla un código de reserva local obsoleta con el UUID del RPC", () => {
    const datos = { "2026-09-23": { cabanas: { "1": {
        reservaId: "otra-reserva", codigoHaiku: "H-OBSOLETO", adultos: 2
    } } } };
    const modulo = api({ datos });
    const nombre = { textContent: "" };
    const sublinea = { textContent: "" };
    const huesped = { querySelector: selector => selector === ".sites-resumen-valor"
        ? nombre : selector === ".sites-resumen-subvalor" ? sublinea : null };
    const { fila } = filaFalsa(1, "continua", {
        ".titular-cabana": { textContent: "Huésped real" },
        ".sites-resumen-celda--huesped": huesped
    });
    fila.dataset.resumenReservaId = "reserva-real";
    modulo.resumenFila(fila, "2026-09-23");
    assert.equal(nombre.textContent, "Sin titular");
    assert.equal(sublinea.textContent, "Reserva del día");
    datos["2026-09-23"].cabanas["1"].reservaId = "reserva-real";
    modulo.resumenFila(fila, "2026-09-23");
    assert.equal(nombre.textContent, "H-OBSOLETO");
    assert.equal(sublinea.textContent, "2 adultos");
});

test("Ver detalle abre y cierra cada cabaña de forma independiente", () => {
    const detalles = new Map([["sites-resumen-detalle-1", { hidden: true }],
        ["sites-resumen-detalle-2", { hidden: true }]]);
    const modulo = api({ document: { readyState: "loading", addEventListener() {},
        getElementById: id => detalles.get(id) || null } });
    const boton = numero => ({
        atributos: { "aria-controls": `sites-resumen-detalle-${numero}`, "aria-expanded": "false" },
        textContent: "Ver detalle ↓",
        getAttribute(nombre) { return this.atributos[nombre]; },
        setAttribute(nombre, valor) { this.atributos[nombre] = valor; }
    });
    const primero = boton(1), segundo = boton(2);
    modulo.alternarDetalle(primero);
    assert.equal(detalles.get("sites-resumen-detalle-1").hidden, false);
    assert.equal(detalles.get("sites-resumen-detalle-2").hidden, true);
    assert.equal(primero.atributos["aria-expanded"], "true");
    assert.equal(primero.textContent, "Ocultar detalle ↑");
    modulo.alternarDetalle(segundo);
    modulo.alternarDetalle(primero);
    assert.equal(detalles.get("sites-resumen-detalle-1").hidden, true);
    assert.equal(detalles.get("sites-resumen-detalle-2").hidden, false);
    assert.equal(primero.textContent, "Ver detalle ↓");
});

test("el botón de cabaña usa la ficha real o abre el detalle si no hay reserva", () => {
    let manejarClick;
    let aperturasFicha = 0;
    const detalle = { hidden: true };
    const ampliar = {
        textContent: "Ver detalle ↓",
        atributos: { "aria-controls": "sites-resumen-detalle-1", "aria-expanded": "false" },
        getAttribute(nombre) { return this.atributos[nombre]; },
        setAttribute(nombre, valor) { this.atributos[nombre] = valor; }
    };
    const ficha = { hidden: false, click() { aperturasFicha++; } };
    const fila = { querySelector: selector => selector === "[data-ficha-cabana]" ? ficha
        : selector === "[data-resumen-expandir]" ? ampliar : null };
    const cabana = { closest: selector => selector === ".sites-resumen-cabana" ? fila : null };
    const lista = { addEventListener(nombre, receptor) {
        if (nombre === "click") manejarClick = receptor;
    } };
    const documento = {
        readyState: "loading", addEventListener() {},
        querySelector: selector => selector === "#seccion-resumen .sites-resumen-lista" ? lista : null,
        querySelectorAll: () => [],
        getElementById: id => id === "sites-resumen-detalle-1" ? detalle : null
    };
    api({ document: documento }).iniciar();
    const target = { closest: selector => selector === "[data-resumen-ficha-cabana]"
        ? cabana : null };
    manejarClick({ target });
    assert.equal(aperturasFicha, 1);
    assert.equal(detalle.hidden, true);
    ficha.hidden = true;
    manejarClick({ target });
    assert.equal(aperturasFicha, 1);
    assert.equal(detalle.hidden, false);
});

test("acciones usan permisos e identidad exacta en el recambio", () => {
    const modulo = api({ permisos: ["reservas.ver", "servicios.crear", "notas.gestionar", "pagos.registrar"] });
    const { fila, acciones } = filaFalsa(9, "sale-ingresa");
    fila.dataset.ingresoReservaId = "reserva-entrante";
    fila.dataset.salidaReservaId = "reserva-saliente";
    modulo.habilitarAcciones(fila, {});
    assert.deepEqual(Object.values(acciones).map(accion => accion.hidden), [false, false, false, false]);
    assert.equal(acciones.pago.dataset.resumenPagoReservaId, "reserva-entrante");
    assert.equal(acciones.pago.dataset.resumenPagoEtapa, "checkin");

    fila.querySelector('[data-campo="estado"]').value = "sale-libre";
    fila.dataset.resumenReservaId = "reserva-saliente";
    fila.dataset.resumenEstadiaId = "estadia-saliente";
    modulo.habilitarAcciones(fila, {});
    assert.equal(acciones.ficha.hidden, false,
        "la ficha de la reserva saliente sigue disponible");
    assert.equal(acciones.servicio.hidden, false,
        "la reserva y estadía salientes exactas permiten agregar Late Check-out");
    assert.equal(acciones.pago.hidden, false);
    assert.equal(acciones.pago.dataset.resumenPagoReservaId, "reserva-saliente");
    assert.equal(acciones.pago.dataset.resumenPagoEtapa, "checkout");
    fila.dataset.resumenEstadiaId = "";
    modulo.habilitarAcciones(fila, {});
    assert.equal(acciones.servicio.hidden, true,
        "sin estadía saliente exacta no se ofrece alta de servicio");
    fila.dataset.resumenEstadiaId = "estadia-saliente";
    fila.dataset.resumenReservaId = "reserva-distinta";
    modulo.habilitarAcciones(fila, {});
    assert.equal(acciones.servicio.hidden, true,
        "no se reutiliza la identidad de otra reserva");

    fila.querySelector('[data-campo="estado"]').value = "continua";
    fila.dataset.resumenReservaId = "reserva-vigente";
    modulo.habilitarAcciones(fila, {});
    assert.equal(acciones.pago.hidden, false);
    assert.equal(acciones.pago.dataset.resumenPagoReservaId, "reserva-vigente");
    assert.equal(acciones.pago.dataset.resumenPagoEtapa, "abono");

    fila.querySelector('[data-campo="estado"]').value = "sale-libre";
    modulo.habilitarAcciones(fila, {});

    api({ permisos: ["pagos.registrar"], checkoutDisponible: false })
        .habilitarAcciones(fila, {});
    assert.equal(acciones.pago.hidden, false,
        "Pago en salida se verifica por reserva y saldo real al abrir el drawer");
    modulo.habilitarAcciones(fila, {});

    fila.querySelector('[data-campo="estado"]').value = "sale-bloqueada";
    modulo.habilitarAcciones(fila, {});
    assert.equal(acciones.ficha.hidden, true);
    assert.equal(acciones.servicio.hidden, true);
    assert.equal(acciones.pago.hidden, true);
    assert.equal("resumenPagoReservaId" in acciones.pago.dataset, false);

    fila.querySelector('[data-campo="estado"]').value = "bloqueada";
    modulo.habilitarAcciones(fila, {});
    assert.equal(acciones.ficha.hidden, true);
    assert.equal(acciones.servicio.hidden, true);
    assert.equal(acciones.pago.hidden, true);

    fila.querySelector('[data-campo="estado"]').value = "fullday";
    fila.dataset.resumenReservaId = "reserva-fullday";
    modulo.habilitarAcciones(fila, {});
    assert.equal(acciones.pago.hidden, false);
    assert.equal(acciones.pago.dataset.resumenPagoReservaId, "reserva-fullday");
    assert.equal(acciones.pago.dataset.resumenPagoEtapa, "checkin");

    api({ permisos: [] }).habilitarAcciones(fila, {});
    assert.equal(acciones.ficha.hidden, true);
    assert.equal(acciones.servicio.hidden, true);
    assert.equal(acciones.pago.hidden, true);
    assert.equal("resumenPagoReservaId" in acciones.pago.dataset, false);
});

test("los botones Sites conservan los selectores de los flujos reales", () => {
    const leer = ruta => fs.readFileSync(require.resolve(ruta), "utf8");
    assert.match(leer("../js/supabase-ficha-v2.js"), /closest\("\[data-ficha-cabana\]"\)/);
    const cabanas = leer("../js/cabanas.js");
    assert.match(cabanas, /closest\("\[data-agregar-servicio\]"\)/);
    assert.match(cabanas, /registrarServicio\(\{/);
    const app = leer("../js/app.js");
    assert.match(app, /\[data-agregar-nota-cabana\]/);
    assert.match(app, /puenteNotas\.guardar\(\{/);
    assert.match(html, /<script src="js\/sites-resumen-pago-v1\.js"><\/script>/);
});

test("Pago usa un drawer Sites sin navegar a la sección financiera", () => {
    const fuentePago = fs.readFileSync(require.resolve("../js/sites-resumen-pago-v1.js"), "utf8");
    assert.match(fuentePago, /sites-resumen-drawer-panel/);
    assert.match(fuentePago, /haiku_operacion_dia/);
    assert.doesNotMatch(fuentePago, /menu\.click\(\)/);
    assert.doesNotMatch(fuentePago, /haiku_registrar_pago_(?:checkin|checkout|grupo)/);
});

test("Ayer, Hoy y Mañana se repintan con datos de sus fechas", () => {
    const datos = {
        "2026-09-22": { cabanas: { "1": { estado: "libre-libre" } } },
        "2026-09-24": { cabanas: { "1": { estado: "libre-ingresa", titular: "Gabriela" } } }
    };
    const modulo = api({ datos, sesion: false });
    const valor = { anterior: { textContent: "—" }, actual: { textContent: "—" },
        siguiente: { textContent: "—" } };
    const { fila, controles } = filaFalsa(1, "continua", {
        ".titular-cabana": { textContent: "Valentina" },
        ".sites-resumen-dia--anterior .sites-resumen-dia-valor": valor.anterior,
        ".sites-resumen-dia--actual .sites-resumen-dia-valor": valor.actual,
        ".sites-resumen-dia--siguiente .sites-resumen-dia-valor": valor.siguiente
    });
    modulo.pintarFlujo(fila, "2026-09-23");
    assert.equal(valor.anterior.textContent, "Libre");
    assert.equal(valor.actual.textContent, "Ocupada · Valentina");
    assert.equal(valor.siguiente.textContent, "Ingresa · Gabriela");
    datos["2026-09-24"].cabanas["1"].titular = "Tomás";
    controles['[data-campo="estado"]'].value = "sale-libre";
    modulo.pintarFlujo(fila, "2026-09-23");
    assert.equal(valor.actual.textContent, "Sale · Valentina");
    assert.equal(valor.siguiente.textContent, "Ingresa · Tomás");
});

test("el historial reintenta fallos y descarta la caché al actualizar datos", async () => {
    const llamadas = [];
    let fallaAnterior = true;
    const modulo = api({
        document: { readyState: "loading", addEventListener() {}, querySelectorAll: () => [] },
        logger: { warn() {} },
        rpc: async (_, { p_fecha }) => {
            llamadas.push(p_fecha);
            if (p_fecha === "2026-09-22" && fallaAnterior) {
                fallaAnterior = false;
                return { data: null, error: new Error("Temporal") };
            }
            return { data: [], error: null };
        }
    });
    modulo.cargarHistorial("2026-09-23");
    await new Promise(resolve => setImmediate(resolve));
    modulo.cargarHistorial("2026-09-23");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(llamadas.filter(fecha => fecha === "2026-09-22").length, 2);
    assert.equal(llamadas.filter(fecha => fecha === "2026-09-24").length, 1);
    modulo.invalidarHistorial("2026-09-23");
    modulo.cargarHistorial("2026-09-23");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(llamadas.filter(fecha => fecha === "2026-09-24").length, 2);
});

test("CSS Sites conserva siete columnas, detalle y tarjetas móviles", () => {
    const css = fs.readFileSync(require.resolve("../css/sites-resumen-v1.css"), "utf8");
    assert.match(css, /--sites-resumen-grid:\s*[^;]+;/);
    for (const selector of [".sites-resumen-fila", ".sites-resumen-flujo",
        ".sites-resumen-detalle", ".sites-resumen-detalle[hidden]"]) {
        assert.ok(css.includes(selector), `Falta ${selector}`);
    }
    assert.match(css, /@media\s*\(max-width:\s*1100px\)/);
    assert.match(css, /@media\s*\(max-width:\s*780px\)/);
});
