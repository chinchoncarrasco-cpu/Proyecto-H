const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const fuente = fs.readFileSync(path.join(__dirname, "../js/sites-resumen-servicio-v1.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const RESERVA = "11111111-1111-4111-8111-111111111111";
const ESTADIA = "22222222-2222-4222-8222-222222222222";
const SERVICIO = "33333333-3333-4333-8333-333333333333";
const catalogo = {
    codigo: "tinajaTonel", nombre: "Tinaja Tonel de Madera", categoria: "tinaja",
    unidad: "hora", precio_base: 30000, precio_persona_adicional: null,
    capacidad_incluida: 3, capacidad_maxima: 3,
    requiere_horario: true, permite_cortesia: true, activo: true
};

function entorno() {
    const eventos = [];
    const campos = new Map();
    const campo = (id, value = "") => {
        const el = {
            id, value, textContent: "", hidden: false, disabled: false,
            dataset: {}, focus() {}, setAttribute() {},
            replaceChildren(...opciones) { this.options = opciones; },
            closest() { return null; }
        };
        campos.set(id, el);
        return el;
    };
    ["resumen-servicio-modal", "resumen-servicio-guardar", "resumen-servicio-producto",
        "resumen-servicio-cantidad", "resumen-servicio-personas", "resumen-servicio-fecha",
        "resumen-servicio-hora", "resumen-servicio-total", "resumen-servicio-cabana",
        "resumen-servicio-titulo", "resumen-servicio-precio-manual",
        "resumen-servicio-precio-manual-wrap", "resumen-servicio-precio-manual-label",
        "resumen-servicio-programacion",
        "resumen-servicio-motivo-wrap", "resumen-servicio-motivo-cortesia",
        "resumen-servicio-observaciones", "resumen-servicio-sites-estado", "resumen-servicio-kicker",
        "resumen-servicio-contexto", "sites-servicios-fecha"].forEach(id => campo(id));
    campos.get("sites-servicios-fecha").value = "2026-09-23";
    campos.get("resumen-servicio-modal").hidden = true;
    campos.get("resumen-servicio-guardar").textContent = "Guardar servicio";
    campos.get("resumen-servicio-cantidad").value = "1";
    campos.get("resumen-servicio-personas").value = "2";

    const accion = { hidden: false };
    const article = {
        dataset: {
            resumenFecha: "2026-09-23", resumenReservaId: RESERVA,
            resumenEstadiaId: ESTADIA
        },
        querySelector: selector => selector === "[data-agregar-servicio]" ? accion : null
    };
    const fila = {
        numero: 6, estado_operativo: "libre-ingresa",
        ingreso_reserva_id: RESERVA, ingreso_estadia_id: ESTADIA
    };
    const servicioDb = {
        id: SERVICIO, reserva_id: RESERVA, estadia_id: ESTADIA,
        fecha_servicio: "2026-09-23", hora_inicio: "19:15:00",
        cantidad: 1, personas: 2, total: 30000, tipo_cobro: "normal",
        estado_servicio: "programado", catalogo_servicios: { codigo: "tinajaTonel" }
    };
    const llamadas = [];
    let estadoReserva = "confirmada";
    let catalogoActivo = [catalogo];
    let resolverRpc = null;
    let resolverAntes = null;
    const cliente = {
        rpc(nombre, args) {
            llamadas.push({ nombre, args });
            if (nombre === "haiku_operacion_dia") {
                return Promise.resolve({ data: [fila], error: null });
            }
            if (nombre === "haiku_registrar_servicio") {
                return new Promise(resolve => { resolverRpc = resolve; });
            }
            throw new Error(`RPC inesperado: ${nombre}`);
        },
        from(tabla) {
            const query = {
                filtros: [],
                select() { return this; },
                eq(nombre, valor) { this.filtros.push([nombre, valor]); return this; },
                order() { return this; },
                single() {
                    if (tabla === "reserva_estadias") return Promise.resolve({
                        data: {
                            id: ESTADIA, reserva_id: RESERVA, fecha_ingreso: "2026-09-23",
                            fecha_salida: "2026-09-25", estado_estadia: "confirmada",
                            adultos: 2, ninos: 1,
                            cabanas: { numero: 6 }
                        }, error: null
                    });
                    if (tabla === "reservas") return Promise.resolve({
                        data: { id: RESERVA, estado_reserva: estadoReserva,
                            titular_nombre: "Valentina Araya", codigo_haiku: "H-2841" }, error: null
                    });
                    if (tabla === "servicios") return Promise.resolve({ data: servicioDb, error: null });
                    throw new Error(`Tabla inesperada: ${tabla}`);
                },
                then(resolve, reject) {
                    if (tabla !== "catalogo_servicios") throw new Error(`Tabla inesperada: ${tabla}`);
                    return Promise.resolve({ data: catalogoActivo, error: null }).then(resolve, reject);
                }
            };
            return query;
        }
    };
    let hidrataciones = 0;
    const ventana = {
        haikuSesion: { usuario: { id: "u" } }, haikuSupabase: cliente,
        haikuTienePermiso: nombre => nombre === "servicios.crear",
        haikuSincronizarServiciosDesdeSupabase: async () => { hidrataciones++; return [servicioDb]; },
        cargarCabanasDia() {}, actualizarResumenDia() {}
    };
    const documento = {
        getElementById: id => campos.get(id) || null,
        querySelector(selector) {
            if (selector.startsWith("#seccion-resumen .sites-resumen-cabana")) return article;
            if (selector === 'input[name="resumen-servicio-tipo-cobro"]:checked') {
                return { value: "normal" };
            }
            if (selector === 'input[name="resumen-servicio-tipo-cobro"][value="normal"]') {
                return { checked: true };
            }
            return null;
        },
        addEventListener(tipo, listener, captura) { eventos.push({ tipo, listener, captura }); },
        dispatchEvent() {}
    };
    vm.runInNewContext(fuente, {
        window: ventana, document: documento, fechaSeleccionada: "2026-09-23",
        Option: class { constructor(label, value) { this.label = label; this.value = value; } },
        CustomEvent: class { constructor(tipo, opciones) { this.type = tipo; this.detail = opciones.detail; } },
        console
    }, { filename: "sites-resumen-servicio-v1.js" });
    const api = ventana.HAIKU_RESUMEN_SERVICIO_SITES_V1;
    return {
        api, campos, article, fila, catalogo, llamadas,
        setEstadoReserva: valor => { estadoReserva = valor; },
        setCatalogo: filas => { catalogoActivo = filas; },
        get hidrataciones() { return hidrataciones; },
        resolver: () => resolverRpc?.({ data: {
            servicio_id: SERVICIO, estado: "creado", codigo: "tinajaTonel",
            tipo_cobro: "normal", total: 30000
        }, error: null }),
        click(target) {
            const evento = {
                target: { closest: selector => selector === target.selector ? target.valor : null },
                preventDefault() { this.preventido = true; },
                stopImmediatePropagation() { this.interceptado = true; }
            };
            eventos.find(e => e.tipo === "click" && e.captura).listener(evento);
            return evento;
        },
        input(id) {
            const evento = {
                target: {
                    closest: selector => selector === "#resumen-servicio-modal" ? campos.get("resumen-servicio-modal") : null,
                    matches: selector => selector === "select, input, textarea"
                },
                stopImmediatePropagation() { this.interceptado = true; }
            };
            eventos.find(e => e.tipo === "input" && e.captura).listener(evento);
            return evento;
        }
    };
}

test("identidad operativa elige ingreso en recambio y salida exacta para Late Check-out", () => {
    const { api } = entorno();
    const ingreso = api.identidadOperacion({
        numero: 6, estado_operativo: "sale-ingresa",
        ingreso_reserva_id: RESERVA, ingreso_estadia_id: ESTADIA,
        salida_reserva_id: SERVICIO
    });
    assert.equal(ingreso.reservaId, RESERVA);
    assert.equal(ingreso.estadiaId, ESTADIA);
    const salida = api.identidadOperacion({
        numero: 6, estado_operativo: "sale-libre",
        salida_reserva_id: RESERVA, salida_estadia_id: ESTADIA,
        ingreso_reserva_id: SERVICIO
    });
    assert.equal(salida.reservaId, RESERVA);
    assert.equal(salida.estadiaId, ESTADIA);
    assert.equal(api.identidadOperacion({
        numero: 6, estado_operativo: "sale-libre",
        salida_reserva_id: RESERVA
    }), null);
});

test("el drawer Sites muestra campos reales y conserva los IDs que consumen los handlers", () => {
    const drawer = html.match(/<div id="resumen-servicio-modal"[\s\S]*?<!-- =========================\s*SECCIÓN CALENDARIO/)?.[0];
    assert.ok(drawer);
    assert.match(drawer, /sites-resumen-drawer-panel/);
    assert.match(drawer, /id="resumen-servicio-contexto"/);
    assert.match(drawer, /sites-resumen-servicio-grid/);
    for (const id of ["producto", "cantidad", "personas", "fecha", "hora",
        "precio-manual", "precio-manual-label", "motivo-cortesia", "observaciones",
        "total", "guardar", "cerrar", "cancelar", "cabana"]) {
        assert.equal((drawer.match(new RegExp(`id="resumen-servicio-${id}"`, "g")) || []).length, 1);
    }
    assert.doesNotMatch(drawer, /Guardar en esta vista|Detalle para el turno/);
});

test("Early Check-In conserva precio manual positivo por hora y no permite alta normal a $0", async () => {
    const h = entorno();
    const early = { ...catalogo, codigo: "earlyCheckin", nombre: "Early Check-In",
        precio_base: 0, requiere_horario: true, unidad: "hora", capacidad_maxima: null };
    h.setCatalogo([early]);
    await h.api.abrir("6");
    const producto = h.campos.get("resumen-servicio-producto");
    producto.value = "earlyCheckin";
    h.input("resumen-servicio-producto");
    assert.equal(h.campos.get("resumen-servicio-precio-manual-wrap").hidden, false);
    assert.equal(h.campos.get("resumen-servicio-programacion").hidden, false);
    assert.equal(h.campos.get("resumen-servicio-precio-manual-label").textContent,
        "Precio por hora · Early Check-In");
    assert.equal(h.campos.get("resumen-servicio-total").textContent, "—");
    h.campos.get("resumen-servicio-hora").value = "09:00";
    assert.equal(await h.api.confirmar(), false);
    assert.equal(h.llamadas.filter(x => x.nombre === "haiku_registrar_servicio").length, 0);
    assert.match(h.campos.get("resumen-servicio-sites-estado").textContent, /precio manual positivo/);
    h.campos.get("resumen-servicio-cantidad").value = "2";
    h.campos.get("resumen-servicio-precio-manual").value = "12500";
    h.input("resumen-servicio-precio-manual");
    assert.equal(h.campos.get("resumen-servicio-total").textContent, "$25.000");
    const identidad = { reservaId: RESERVA, estadiaId: ESTADIA,
        ingreso: "2026-09-23", salida: "2026-09-25" };
    const payload = h.api.validarFormulario({ cantidad: "2", personas: "2", fecha: "2026-09-23",
        hora: "09:00", tipoCobro: "normal", precioManual: "12500" }, early, identidad);
    assert.equal(payload.p_precio_manual, 12500);
    assert.equal(payload.p_cantidad, 2);
    assert.equal(h.api.precioCatalogo(early, payload.p_cantidad, payload.p_personas,
        payload.p_precio_manual), 25000);
    assert.throws(() => h.api.validarFormulario({ cantidad: "2", personas: "2",
        fecha: "2026-09-23", hora: "", tipoCobro: "normal", precioManual: "12500" },
    early, identidad), /hora/);
});

test("salida sola abre servicio únicamente con reserva y estadía salientes coincidentes", async () => {
    const h = entorno();
    h.fila.estado_operativo = "sale-libre";
    h.fila.salida_reserva_id = RESERVA;
    h.fila.salida_estadia_id = ESTADIA;
    await h.api.abrir("6");
    assert.equal(h.campos.get("resumen-servicio-guardar").disabled, false);
    h.article.dataset.resumenEstadiaId = SERVICIO;
    await h.api.abrir("6");
    assert.equal(h.campos.get("resumen-servicio-guardar").disabled, true);
    assert.match(h.campos.get("resumen-servicio-sites-estado").textContent,
        /estadía visible ya no coincide/);
});

test("formulario exige catálogo activo, fecha de estadía, horario, personas y motivo", () => {
    const { api } = entorno();
    const identidad = { reservaId: RESERVA, estadiaId: ESTADIA,
        ingreso: "2026-09-23", salida: "2026-09-25" };
    const valores = {
        cantidad: "1", personas: "2", fecha: "2026-09-24", hora: "19:15",
        tipoCobro: "normal", precioManual: "", motivo: ""
    };
    const payload = api.validarFormulario(valores, catalogo, identidad);
    assert.equal(payload.p_reserva_id, RESERVA);
    assert.equal(payload.p_estadia_id, ESTADIA);
    assert.equal(payload.p_hora, "19:15");
    assert.equal(payload.p_observaciones, null);
    assert.equal(api.validarFormulario({ ...valores, observaciones: "  Detalle del turno  " },
        catalogo, identidad).p_observaciones, "Detalle del turno");
    assert.throws(() => api.validarFormulario({ ...valores, fecha: "2026-09-26" }, catalogo, identidad), /fecha/);
    assert.throws(() => api.validarFormulario({ ...valores, hora: "" }, catalogo, identidad), /hora/);
    assert.throws(() => api.validarFormulario({ ...valores, personas: "4" }, catalogo, identidad), /máximo/);
    assert.throws(() => api.validarFormulario({ ...valores, cantidad: "0" }, catalogo, identidad), /Cantidad/);
    assert.throws(() => api.validarFormulario({ ...valores, personas: "0" },
        { ...catalogo, categoria: "servicio" }, identidad), /tinaja/);
    assert.throws(() => api.validarFormulario({ ...valores, tipoCobro: "cortesia" }, catalogo, identidad), /motivo/);
    assert.throws(() => api.validarFormulario(valores, { ...catalogo, activo: false }, identidad), /activo/);
    const jacuzzi = { ...catalogo, codigo: "tinajaJacuzzi", capacidad_maxima: 5,
        precio_persona_adicional: 10000 };
    assert.throws(() => api.validarFormulario({ ...valores, cantidad: "2", personas: "4" },
        jacuzzi, identidad), /requiere revisión de precio/);
});

test("sesión real intercepta el modal legacy y escribe una sola vez con RPC tras revalidar", async () => {
    const h = entorno();
    h.campos.get("resumen-servicio-observaciones").value = "Observación de otra apertura";
    const boton = { hidden: false, dataset: { agregarServicio: "6" } };
    const evento = h.click({ selector: "[data-agregar-servicio]", valor: boton });
    assert.equal(evento.interceptado, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.campos.get("resumen-servicio-modal").hidden, false);
    assert.equal(h.campos.get("resumen-servicio-guardar").disabled, false);
    assert.equal(h.campos.get("resumen-servicio-kicker").textContent, "CABAÑA 6");
    assert.equal(h.campos.get("resumen-servicio-titulo").textContent, "Agregar servicio");
    assert.equal(h.campos.get("resumen-servicio-contexto").textContent,
        "Valentina Araya · H-2841 · 2 adultos · 1 niño. Guardar servicio modificará Proyecto H.");
    assert.equal(h.campos.get("resumen-servicio-observaciones").value, "");
    assert.equal(h.campos.get("resumen-servicio-producto").options[1].value, "tinajaTonel");
    h.campos.get("resumen-servicio-producto").value = "tinajaTonel";
    h.campos.get("resumen-servicio-personas").value = "2";
    h.campos.get("resumen-servicio-hora").value = "19:15";
    h.campos.get("resumen-servicio-observaciones").value = "  Agua tibia  ";
    const primero = h.api.confirmar();
    const segundo = await h.api.confirmar();
    assert.equal(segundo, false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.llamadas.filter(x => x.nombre === "haiku_registrar_servicio").length, 1);
    h.resolver();
    assert.equal(await primero, true);
    assert.equal(h.hidrataciones, 1);
    assert.equal(h.campos.get("resumen-servicio-modal").hidden, true);
    const llamada = h.llamadas.find(x => x.nombre === "haiku_registrar_servicio");
    assert.equal(llamada.args.p_codigo_servicio, "tinajaTonel");
    assert.equal(llamada.args.p_personas, 2);
    assert.equal(llamada.args.p_estadia_id, ESTADIA);
    assert.equal(llamada.args.p_observaciones, "Agua tibia");
});

test("reserva o estadía obsoleta bloquean antes de llamar al writer", async () => {
    const h = entorno();
    await h.api.abrir("6");
    h.campos.get("resumen-servicio-producto").value = "tinajaTonel";
    h.campos.get("resumen-servicio-hora").value = "19:15";
    h.article.dataset.resumenEstadiaId = SERVICIO;
    assert.equal(await h.api.confirmar(), false);
    assert.equal(h.llamadas.filter(x => x.nombre === "haiku_registrar_servicio").length, 0);
    assert.match(h.campos.get("resumen-servicio-sites-estado").textContent, /estadía visible/);
});

test("la reserva cancelada después de abrir bloquea el RPC al confirmar", async () => {
    const h = entorno();
    await h.api.abrir("6");
    h.campos.get("resumen-servicio-producto").value = "tinajaTonel";
    h.campos.get("resumen-servicio-hora").value = "19:15";
    h.setEstadoReserva("cancelada");
    assert.equal(await h.api.confirmar(), false);
    assert.equal(h.llamadas.filter(x => x.nombre === "haiku_registrar_servicio").length, 0);
    assert.match(h.campos.get("resumen-servicio-sites-estado").textContent, /reserva ya no está activa/);
});

test("modo local sin sesión conserva la ruta heredada y no intercepta", () => {
    const h = entorno();
    const source = fuente;
    assert.match(source, /if \(!sesionReal\(\)\) return;/);
    assert.match(source, /evento\.stopImmediatePropagation\(\)/);
    assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(/);
    assert.equal(h.api.precioCatalogo(catalogo, 1, 2), 30000);
});

test("Servicios abre el mismo drawer con identidad RPC sin depender del artículo de Resumen", async () => {
    const h = entorno();
    h.article.dataset.resumenReservaId = SERVICIO;
    await h.api.abrirDesdeServicios("6", "2026-09-23");
    assert.equal(h.campos.get("resumen-servicio-guardar").disabled, false);
    assert.match(h.campos.get("resumen-servicio-contexto").textContent, /Valentina Araya/);
    h.campos.get("resumen-servicio-producto").value = "tinajaTonel";
    h.campos.get("resumen-servicio-hora").value = "19:15";
    h.campos.get("resumen-servicio-personas").value = "2";
    const pendiente = h.api.confirmar();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.llamadas.filter(x => x.nombre === "haiku_registrar_servicio").length, 1);
    h.resolver();
    assert.equal(await pendiente, true, h.campos.get("resumen-servicio-sites-estado").textContent);
});
