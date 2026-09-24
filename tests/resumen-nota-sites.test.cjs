const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const fuente = fs.readFileSync(require.resolve("../js/sites-resumen-nota-v1.js"), "utf8");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const app = fs.readFileSync(require.resolve("../js/app.js"), "utf8");
const puente = fs.readFileSync(require.resolve("../js/supabase-notas-resumen-v1.js"), "utf8");
const ids = {
    cabana: "11111111-1111-4111-8111-111111111111",
    reserva: "22222222-2222-4222-8222-222222222222",
    estadia: "33333333-3333-4333-8333-333333333333"
};

function escenario({ reserva = ids.reserva, estadia = ids.estadia, permiso = true,
    sesion = true, puenteDisponible = true } = {}) {
    const panel = { dataset: {} };
    const article = { dataset: {
        cabana: "1", haikuFuente: "supabase", resumenFecha: "2026-09-23",
        haikuCabanaId: ids.cabana, resumenReservaId: reserva,
        resumenEstadiaId: estadia
    } };
    const boton = { dataset: { agregarNotaCabana: "1" },
        closest: selector => selector === ".sites-resumen-cabana" ? article : null };
    let consultas = 0;
    let filas = [{ numero: 1, cabana_id: ids.cabana, estado_operativo: "continua",
        continua_reserva_id: reserva, continua_estadia_id: estadia }];
    const cliente = { rpc: async (nombre, parametros) => {
        assert.equal(nombre, "haiku_operacion_dia");
        assert.equal(parametros.p_fecha, "2026-09-23");
        consultas++;
        return { data: filas, error: null };
    } };
    const ventana = { haikuSesion: sesion ? {} : null,
        haikuTienePermiso: () => permiso,
        haikuSupabase: cliente,
        HAIKU_NOTAS_RESUMEN_SUPABASE_V1: puenteDisponible ? { guardar() {} } : null };
    const documento = { getElementById: id => id === "panel-agregar-nota" ? panel : null,
        querySelector: selector => selector.includes('data-cabana="1"') ? article : null };
    const contexto = { window: ventana, document: documento,
        fechaSeleccionada: "2026-09-23" };
    vm.runInNewContext(fuente, contexto);
    return { api: ventana.HAIKU_SITES_RESUMEN_NOTA_V1, article, boton, panel,
        setFilas: valor => { filas = valor; },
        setFecha: valor => { contexto.fechaSeleccionada = valor; },
        consultas: () => consultas };
}

test("Nota conserva el único formulario real dentro del drawer Sites", () => {
    assert.equal((html.match(/id="panel-agregar-nota"/g) || []).length, 1);
    assert.match(html, /id="panel-agregar-nota" class="sites-resumen-drawer"/);
    assert.match(html, /id="guardar-nota"[\s\S]*?Guardar nota/);
    assert.match(html, /src="js\/sites-resumen-drawer-v1\.js"/);
    assert.match(html, /src="js\/sites-resumen-nota-v1\.js"/);
    assert.doesNotMatch(html, /Guardar en esta vista|vista de demostración/i);
    assert.match(app, /HAIKU_SITES_RESUMEN_NOTA_V1\?\.preparar/);
    assert.match(app, /HAIKU_SITES_RESUMEN_NOTA_V1\.validar/);
    assert.match(app, /await puenteNotas\.guardar/);
    assert.match(app, /await puenteNotas\.refrescar/);
    assert.match(puente, /estadiaId === undefined/);
    assert.match(html, /id="sites-resumen-nota-contexto"/);
    assert.ok(app.includes("cabanaIdEsperada: identidadNota?.cabanaId"));
});

test("Nota revalida reserva y estadía de la cabaña exacta antes del writer", async () => {
    const caso = escenario();
    assert.equal(caso.api.preparar(caso.boton).reservaId, ids.reserva);
    const identidad = await caso.api.validar("2026-09-23", "1");
    assert.equal(identidad.estadiaId, ids.estadia);
    assert.equal(caso.consultas(), 1);
});

test("Nota bloquea estado obsoleto y no consulta para una cabaña cambiada", async () => {
    const caso = escenario();
    caso.api.preparar(caso.boton);
    caso.article.dataset.resumenReservaId = "44444444-4444-4444-8444-444444444444";
    await assert.rejects(caso.api.validar("2026-09-23", "1"), /cambió/);
    assert.equal(caso.consultas(), 0);
});

test("Nota bloquea cambio entre preview y confirmación desde PostgreSQL", async () => {
    const caso = escenario();
    caso.api.preparar(caso.boton);
    caso.setFilas([{ numero: 1, cabana_id: ids.cabana,
        estado_operativo: "libre-libre" }]);
    await assert.rejects(caso.api.validar("2026-09-23", "1"), /cambió/);
    assert.equal(caso.consultas(), 1);
});

test("Nota sin reserva queda asociada sólo a cabaña y fecha", async () => {
    const caso = escenario({ reserva: "", estadia: "" });
    caso.api.preparar(caso.boton);
    caso.setFilas([{ numero: 1, cabana_id: ids.cabana,
        estado_operativo: "libre-libre" }]);
    const identidad = await caso.api.validar("2026-09-23", "1");
    assert.equal(identidad.reservaId, "");
    assert.equal(identidad.estadiaId, "");
});

test("Nota falla cerrada sin permiso o sin puente real", async () => {
    const sinPermiso = escenario({ permiso: false });
    assert.throws(() => sinPermiso.api.preparar(sinPermiso.boton), /permiso/);
    const sinPuente = escenario({ puenteDisponible: false });
    sinPuente.api.preparar(sinPuente.boton);
    await assert.rejects(sinPuente.api.validar("2026-09-23", "1"), /guardado real/);
});

test("Nota bloquea si el día cambia durante la lectura de revalidación", async () => {
    const caso = escenario();
    caso.api.preparar(caso.boton);
    caso.setFecha("2026-09-24");
    await assert.rejects(caso.api.validar("2026-09-23", "1"), /cambió/);
});

test("nota duplicada sólo se reutiliza para la misma cabaña, reserva y estadía", async () => {
    const inicio = puente.indexOf("    async function guardarNota(");
    const fin = puente.indexOf("    async function eliminarNota(", inicio);
    assert.ok(inicio >= 0 && fin > inicio);
    let inserciones = 0;
    let existente = { id: "nota-previa", cabana_id: ids.cabana,
        reserva_id: ids.reserva, estadia_id: ids.estadia, texto: "Aviso" };
    const filtro = { eq() { return this; }, async single() { return { data: existente, error: null }; } };
    const cliente = { from() { return {
        insert() { inserciones++; return { select() { return {
            async single() { return { data: null, error: { code: "23505" } }; }
        }; } }; },
        select() { return filtro; }
    }; } };
    const contexto = { cliente, cabanasPorNumero: new Map([["1", ids.cabana]]),
        cargarCabanas: async () => {}, cargarEstadiasDeNotas: async () => {},
        usuarioId: () => "usuario", esUuid: valor => /^[0-9a-f-]{36}$/i.test(valor),
        fechaActual: () => "2026-09-23", notaLocalDesdeFila: fila => fila,
        TIPO_NOTA: "operativa_resumen" };
    vm.runInNewContext(puente.slice(inicio, fin) + ";globalThis.guardar = guardarNota;", contexto);
    const entrada = { fecha: "2026-09-23", numeroCabana: "1", texto: "Aviso",
        cabanaIdEsperada: ids.cabana, reservaId: ids.reserva, estadiaId: ids.estadia };
    assert.equal((await contexto.guardar(entrada)).id, "nota-previa");
    existente = { ...existente, reserva_id: "44444444-4444-4444-8444-444444444444" };
    await assert.rejects(contexto.guardar(entrada), /otra reserva/);
    await assert.rejects(contexto.guardar({ ...entrada,
        cabanaIdEsperada: "55555555-5555-4555-8555-555555555555" }), /cabaña cambió/);
    assert.equal(inserciones, 2);
});

test("el texto persistido de Nota aparece como texto y conserva su acción real", () => {
    const inicio = app.indexOf("function mostrarNotasOperativas(fecha)");
    const fin = app.indexOf("// ELIMINAR NOTA OPERATIVA", inicio);
    assert.ok(inicio >= 0 && fin > inicio);
    const caja = { hijos: [], replaceChildren(...hijos) { this.hijos = hijos; } };
    const documento = {
        querySelector: selector => selector === '[data-nota-cabana="1"]' ? caja : null,
        createElement: tag => ({ tag, dataset: {}, appendChild(hijo) { this.hijo = hijo; } }),
        dispatchEvent() {}
    };
    const contexto = { document: documento,
        CustomEvent: class { constructor(type) { this.type = type; } },
        obtenerDatosDia: () => ({ notasOperativas: [{ cabana: "1",
            texto: '<img src=x onerror="alert(1)">' }] }) };
    vm.runInNewContext(app.slice(inicio, fin) + ";globalThis.mostrar = mostrarNotasOperativas;", contexto);
    contexto.mostrar("2026-09-23");
    assert.equal(caja.hijos.length, 1);
    assert.equal(caja.hijos[0].textContent, '<img src=x onerror="alert(1)">');
    assert.equal(caja.hijos[0].hijo.tag, "button");
    assert.equal(caja.hijos[0].hijo.dataset.texto, '<img src=x onerror="alert(1)">');
});
