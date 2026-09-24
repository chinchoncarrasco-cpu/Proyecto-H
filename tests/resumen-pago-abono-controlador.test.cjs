const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const fuente = fs.readFileSync(require.resolve("../js/supabase-pago-grupo-v1.js"), "utf8");

function preparar({ grupo = false, permiso = true } = {}) {
    const fecha = "2026-09-23";
    const reserva = "reserva-9";
    let saldo = 30000;
    const llamadas = [];
    const filas = [{ numero: 9, estado_operativo: "continua",
        continua_reserva_id: reserva, continua_titular: "Yann O'Connell" }];
    const cliente = {
        async rpc(nombre, datos) {
            llamadas.push({ nombre, datos });
            if (nombre === "haiku_operacion_dia") {
                return { data: filas, error: null };
            }
            if (nombre === "haiku_finanzas_grupo") {
                return { data: grupo ? {
                    es_grupo: true, titular: "Yann O'Connell",
                    total_alojamiento: 60000, saldo_alojamiento: saldo,
                    miembros: [
                        { reserva_id: reserva, cabana: 9 },
                        { reserva_id: "reserva-10", cabana: 10 }
                    ]
                } : { es_grupo: false }, error: null };
            }
            if (nombre === "haiku_registrar_pago_grupo") {
                return { data: { pago_id: "pago-1" }, error: null };
            }
            throw new Error(`RPC inesperado: ${nombre}`);
        },
        from(tabla) {
            if (tabla === "reservas") {
                return { select() { return this; }, async in(campo, ids) {
                    assert.equal(campo, "id");
                    assert.deepEqual([...ids], [reserva]);
                    return { data: [{ id: reserva, grupo_reserva_id: null,
                        titular_nombre: "Yann O'Connell" }], error: null };
                } };
            }
            assert.equal(tabla, "vista_estado_cargos");
            return { select() { return this; }, async eq(campo, id) {
                assert.equal(campo, "reserva_id");
                assert.equal(id, reserva);
                return { data: [{ tipo_cargo: "alojamiento", estado: "activo",
                    monto_ajustado: 80000, aplicado_neto: 80000 - saldo,
                    saldo_cargo: saldo }], error: null };
            } };
        }
    };
    const window = { haikuSupabase: cliente, haikuSesion: { id: "u1" },
        haikuTienePermiso: nombre => nombre === "pagos.registrar" && permiso,
        addEventListener() {} };
    const document = { addEventListener() {} };
    const contexto = vm.createContext({ window, document,
        fechaSeleccionada: fecha, setTimeout() {}, Date, Intl,
        console: { info() {}, error() {} } });
    vm.runInContext(fuente, contexto, { filename: "supabase-pago-grupo-v1.js" });
    return { api: window.HAIKU_PAGO_GRUPO_V1, llamadas, contexto,
        cambiarSaldo(nuevo) { saldo = nuevo; }, filas };
}

test("abono de Continúa usa saldo real, fecha y el único RPC canónico", async () => {
    const ui = preparar();
    const contexto = await ui.api.contextoResumen("reserva-9", "2026-09-23");
    assert.equal(contexto.saldo, 30000);
    assert.deepEqual([...contexto.cabanas], [9]);
    const respuesta = await ui.api.registrarResumen("reserva-9", {
        monto: 12000, medio: "Tarjeta Crédito", fechaPago: "2026-09-22",
        folio: "F-1", bovtar: "B-1", observacion: "Abono del huésped"
    }, "2026-09-23");
    assert.equal(respuesta.pago_id, "pago-1");
    const escrituras = ui.llamadas.filter(item => item.nombre === "haiku_registrar_pago_grupo");
    assert.equal(escrituras.length, 1);
    assert.equal(escrituras[0].datos.p_reserva_id, "reserva-9");
    assert.equal(escrituras[0].datos.p_medio_pago, "tarjeta_credito");
    assert.equal(escrituras[0].datos.p_etapa_operativa, "abono");
    assert.equal(escrituras[0].datos.p_fecha_pago, "2026-09-22T12:00:00.000Z");
    assert.equal(escrituras[0].datos.p_bove, "B-1");
});

test("abono conjunto revalida miembros y saldo; estado obsoleto bloquea escritura", async () => {
    const ui = preparar({ grupo: true });
    const inicial = await ui.api.contextoResumen("reserva-9", "2026-09-23");
    assert.deepEqual([...inicial.cabanas], [9, 10]);
    assert.deepEqual([...inicial.miembros], ["reserva-10", "reserva-9"]);
    ui.cambiarSaldo(0);
    await assert.rejects(ui.api.registrarResumen("reserva-9", {
        monto: 1000, medio: "Efectivo", fechaPago: "2026-09-23"
    }, "2026-09-23"), /ya no tiene saldo/);
    assert.equal(ui.llamadas.filter(item => item.nombre === "haiku_registrar_pago_grupo").length, 0);
});

test("abono exige permiso y datos del medio antes de escribir", async () => {
    const sinPermiso = preparar({ permiso: false });
    await assert.rejects(sinPermiso.api.registrarResumen("reserva-9", {
        monto: 1000, medio: "Efectivo", fechaPago: "2026-09-23"
    }, "2026-09-23"), /permiso/);
    assert.equal(sinPermiso.llamadas.filter(item => item.nombre === "haiku_registrar_pago_grupo").length, 0);

    const ui = preparar();
    await assert.rejects(ui.api.registrarResumen("reserva-9", {
        monto: 1000, medio: "Tarjeta Crédito", fechaPago: "2026-09-23",
        folio: "F-1"
    }, "2026-09-23"), /Folio y BOVTAR/);
    assert.equal(ui.llamadas.filter(item => item.nombre === "haiku_registrar_pago_grupo").length, 0);
});

test("el modal canónico conserva abonos de otras etapas mediante el mismo writer", async () => {
    const ui = preparar();
    ui.filas[0] = { numero: 9, estado_operativo: "sale-libre",
        salida_reserva_id: "reserva-9", salida_titular: "Yann O'Connell" };
    assert.equal(await ui.api.contextoResumen("reserva-9", "2026-09-23"), null);
    await ui.api.registrarResumen("reserva-9", {
        monto: 15000, medio: "Efectivo", fechaPago: "2026-09-23"
    }, "2026-09-23", "modal");
    assert.equal(ui.llamadas.filter(item => item.nombre === "haiku_registrar_pago_grupo").length, 1);
});
