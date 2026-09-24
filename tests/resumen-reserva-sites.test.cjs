const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const fuente = fs.readFileSync(require.resolve("../js/sites-resumen-reserva-v1.js"), "utf8");
const finanzas = fs.readFileSync(require.resolve("../js/supabase-finanzas-resumen-v1.js"), "utf8");
const fichaFuente = fs.readFileSync(require.resolve("../js/supabase-ficha-v2.js"), "utf8");
const historialFuente = fs.readFileSync(require.resolve("../js/supabase-historial-v1.js"), "utf8");
const RESERVA = "46c3428a-3a4a-48a9-bafd-fa359fc8ef72";
const ESTADIA = "a2cab260-4ad4-402a-bd05-919fdda1893b";
const OTRA_ESTADIA = "12cab260-4ad4-402a-bd05-919fdda1893b";
const FECHA = "2026-09-23";

function nodo(tag = "div") {
    const hijos = [];
    const campos = new Map();
    const eventos = new Map();
    return {
        tagName: tag.toUpperCase(), dataset: {}, children: hijos, hidden: false,
        disabled: false, textContent: "", innerHTML: "", className: "", id: "",
        querySelector(selector) {
            if (!campos.has(selector)) campos.set(selector, nodo("span"));
            return campos.get(selector);
        },
        appendChild(elemento) { hijos.push(elemento); return elemento; },
        replaceChildren(...elementos) { hijos.splice(0, hijos.length, ...elementos); },
        addEventListener(tipo, callback) { eventos.set(tipo, callback); },
        click() { return eventos.get("click")?.({ target: this }); },
        focus() {},
        get(selector) { return this.querySelector(selector); }
    };
}

function fixture({ grupo = false } = {}) {
    const estadia = { id: ESTADIA, cabana_numero: 9, adultos: 2, ninos: 1,
        fecha_ingreso: "2026-09-20", fecha_salida: "2026-09-24", tipo_estadia: "alojamiento",
        estado_estadia: "hospedada" };
    return {
        reserva: { id: RESERVA, codigo_haiku: "H-20260920-01-625014",
            titular_nombre: "Yann O'Connell", estado_reserva: "confirmada",
            telefono_contacto: "+56 9 1234 5678", observaciones: "Llegada confirmada" },
        estadias: grupo ? [{ ...estadia, id: OTRA_ESTADIA, cabana_numero: 1,
            fecha_ingreso: "2026-09-01" }, estadia] : [estadia],
        huespedes: [{ es_titular: true, nombre: "Yann", apellido: "O'Connell" },
            { es_titular: false, nombre: "Alex", apellido: "Rivas" }],
        servicios: [{ estado_servicio: "programado", fecha_servicio: FECHA,
            hora_inicio: "19:15:00", catalogo_servicios: { nombre: "Tinaja Tonel" } }],
        cargos: [{ estado: "activo", tipo_cargo: "alojamiento", monto: 200000,
            saldo_cargo: 50000 }, { estado: "activo", tipo_cargo: "servicio", monto: 30000,
            saldo_cargo: 30000 }],
        pagos: [{ tipo_movimiento: "pago", estado: "confirmado", monto: 150000 }],
        notas: [{ texto: "Aviso para el turno", fecha_operacion: FECHA }],
        solicitudes: [{ descripcion: "Desayuno sin frutos secos", vence_en: FECHA }],
        boves: {}
    };
}

function montar({ rpcId = RESERVA, rpcEstadia = ESTADIA, fecha = FECHA,
    estadoOperativo = "continua",
    ficha = fixture(), permisoEditar = true, errorLectura = null } = {}) {
    const drawer = nodo();
    const body = nodo("body");
    let llamadasRpc = 0;
    let lecturas = 0;
    let aperturasEditor = 0;
    let historial = null;
    let cacheEdit = null;
    const boton = nodo("button");
    const fila = nodo("article");
    fila.dataset = { cabana: "9", resumenFecha: fecha,
        resumenReservaId: RESERVA, resumenEstadiaId: ESTADIA };
    fila.querySelector = selector => selector === '[data-campo="estado"]'
        ? { value: estadoOperativo } : selector === "[data-ficha-cabana]" ? boton : null;
    boton.closest = selector => selector.startsWith(".sites-resumen-cabana") ? fila : null;
    const documento = {
        body: { appendChild(elemento) { assert.equal(elemento, drawer); }, style: {} },
        createElement: tag => tag === "div" && !drawer.id ? drawer : nodo(tag),
        querySelector: selector => selector.includes(".sites-resumen-cabana") ? fila : null
    };
    const ventana = {
        haikuSesion: { user: "u" },
        haikuTienePermiso: codigo => codigo === "reservas.ver" ||
            (codigo === "reservas.editar" && permisoEditar),
        haikuSupabase: { rpc: async (nombre, payload) => {
            assert.equal(nombre, "haiku_operacion_dia");
            assert.equal(payload.p_fecha, fecha);
            llamadasRpc++;
            return { data: [{ numero: 9, estado_operativo: estadoOperativo,
                continua_reserva_id: rpcId, continua_estadia_id: rpcEstadia,
                salida_reserva_id: rpcId, salida_estadia_id: rpcEstadia }], error: null };
        } },
        haikuLeerFichaSupabaseV2: async id => {
            assert.equal(id, RESERVA);
            lecturas++;
            if (errorLectura) throw errorLectura;
            return ficha;
        },
        haikuPrepararEdicionFichaSupabaseV2: (valor, estadiaId) => {
            cacheEdit = { valor, estadiaId };
            return true;
        },
        HistorialSupabase: { abrirReserva: async (id, meta) => { historial = { id, meta }; } },
        HAIKU_SITES_RESUMEN_DRAWER_V1: {
            registrar(panel, opciones) { assert.equal(panel, drawer); assert.equal(typeof opciones.cerrar, "function"); },
            marcarDisparador(panel, elemento) { assert.equal(panel, drawer); assert.equal(elemento, boton); },
            sincronizar() {}
        }
    };
    let fechaSeleccionada = fecha;
    const contexto = vm.createContext({
        window: ventana, document: documento, Intl, Date, console: { warn() {} },
        get fechaSeleccionada() { return fechaSeleccionada; },
        abrirModalEditarReserva(id) { assert.equal(id, RESERVA); aperturasEditor++; return true; }
    });
    vm.runInContext(finanzas, contexto);
    vm.runInContext(fuente, contexto);
    return {
        api: ventana.HAIKU_RESUMEN_RESERVA_SITES_V1, boton, fila, drawer,
        get llamadasRpc() { return llamadasRpc; },
        get lecturas() { return lecturas; },
        get aperturasEditor() { return aperturasEditor; },
        get historial() { return historial; },
        get cacheEdit() { return cacheEdit; },
        cambiarFecha(valor) { fechaSeleccionada = valor; }
    };
}

test("Ver reserva usa UUID y estadía exactos, muestra lectura real y cálculo compartido", async () => {
    const caso = montar();
    assert.equal(await caso.api.abrirDesdeBoton(caso.boton), true);
    assert.equal(caso.llamadasRpc, 2);
    assert.equal(caso.lecturas, 1);
    assert.equal(caso.drawer.hidden, false);
    assert.equal(caso.drawer.get("#sites-resumen-reserva-titulo").textContent, "Yann O'Connell");
    assert.equal(caso.drawer.get("[data-reserva-codigo]").textContent, "H-20260920-01-625014");
    assert.equal(caso.drawer.get("[data-reserva-personas]").textContent, "3 personas");
    assert.equal(caso.drawer.get("[data-reserva-total]").textContent, "$230.000");
    assert.equal(caso.drawer.get("[data-reserva-abono]").textContent, "$150.000");
    assert.equal(caso.drawer.get("[data-reserva-saldo]").textContent, "$80.000");
    assert.equal(caso.drawer.get("[data-reserva-servicios-pendientes]").textContent, "$30.000");
    assert.equal(caso.drawer.get("[data-reserva-comentarios]").textContent, "Llegada confirmada");
});

test("Una reserva grupal usa la estadía de la CAB seleccionada y no la primera", async () => {
    const caso = montar({ ficha: fixture({ grupo: true }) });
    assert.equal(await caso.api.abrirDesdeBoton(caso.boton), true);
    assert.equal(caso.drawer.get("[data-reserva-ingreso]").textContent.includes("20"), true);
    assert.equal(caso.drawer.get("[data-reserva-duracion]").textContent, "4");
});

test("la salida libre abre la ficha de la reserva saliente exacta", async () => {
    const caso = montar({ estadoOperativo: "sale-libre" });
    assert.equal(await caso.api.abrirDesdeBoton(caso.boton), true);
    assert.equal(caso.drawer.get("#sites-resumen-reserva-titulo").textContent, "Yann O'Connell");
    assert.equal(caso.drawer.get("[data-reserva-kicker]").textContent,
        "CABAÑA 9 · H-20260920-01-625014");
    assert.equal(caso.llamadasRpc, 2);
});

test("UUID RPC obsoleto bloquea antes de leer ficha", async () => {
    const caso = montar({ rpcId: "16c3428a-3a4a-48a9-bafd-fa359fc8ef72" });
    assert.equal(await caso.api.abrirDesdeBoton(caso.boton), false);
    assert.equal(caso.lecturas, 0);
    assert.equal(caso.drawer.get("[data-reserva-contenido]").hidden, true);
    assert.equal(caso.drawer.get("[data-reserva-editar]").disabled, true);
});

test("Un fallo de lectura no transforma datos desconocidos en cero ni habilita acciones", async () => {
    const caso = montar({ errorLectura: new Error("Lectura parcial") });
    assert.equal(await caso.api.abrirDesdeBoton(caso.boton), false);
    assert.equal(caso.drawer.get("[data-reserva-contenido]").hidden, true);
    assert.equal(caso.drawer.get("[data-reserva-estado]").textContent, "Lectura parcial");
    assert.equal(caso.drawer.get("[data-reserva-historial]").disabled, true);
});

test("Historial y Editar reutilizan flujos reales y revalidan antes de abrir", async () => {
    const caso = montar();
    assert.equal(await caso.api.abrirDesdeBoton(caso.boton), true);
    await caso.drawer.get("[data-reserva-historial]").click();
    assert.equal(caso.historial.id, RESERVA);
    assert.equal(caso.historial.meta.titular, "Yann O'Connell");
    assert.equal(caso.drawer.hidden, true);
    assert.equal(caso.aperturasEditor, 0);

    assert.equal(await caso.api.abrirDesdeBoton(caso.boton), true);
    await caso.drawer.get("[data-reserva-editar]").click();
    assert.equal(caso.cacheEdit.estadiaId, ESTADIA);
    assert.equal(caso.aperturasEditor, 1);
    assert.equal(caso.drawer.hidden, true);
    assert.equal(caso.llamadasRpc >= 5, true);
});

test("Cambiar fecha tras abrir bloquea la acción real", async () => {
    const caso = montar();
    assert.equal(await caso.api.abrirDesdeBoton(caso.boton), true);
    caso.cambiarFecha("2026-09-24");
    await caso.drawer.get("[data-reserva-editar]").click();
    assert.equal(caso.aperturasEditor, 0);
    assert.equal(caso.drawer.get("[data-reserva-estado]").dataset.error, "true");
});

test("La ficha legacy sigue disponible y su lectura Sites exige datos completos", () => {
    assert.match(fichaFuente, /cargarFicha\(reservaId, \{ lecturaCompleta: true \}\)/);
    assert.match(fichaFuente, /boton\.closest\("#seccion-resumen"\)/);
    assert.match(fichaFuente, /abrirFicha\(boton\.dataset\.fichaCabana, fechaActual\(\)\)/);
    assert.match(historialFuente, /abrirHistorialReserva\(reservaIdSolicitado = "", metaSolicitud = null\)/);
    assert.match(historialFuente, /abrirReserva: abrirHistorialReserva/);
});
