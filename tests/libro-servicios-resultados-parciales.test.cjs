// Sólo fixtures sintéticos: respuestas contractuales 4C, conflicto y red incierta.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
global.HAIKU_LIBRO_SEMANTICA = require('../js/haiku-libro-semantica-v1.js');
global.HAIKU_LIBRO_PAGOS_DESTINOS_V1 = require('../js/haiku-libro-pagos-destinos-v1.js');
const Q = require('../js/haiku-libro-consultas-v1.js');
const RPC = 'haiku_incorporar_pago_servicios_libro_v1';
const creado = () => ({ data: { ok: true, pagos_creados: 1, omitidos: 0, pago_id: 'pago-ficticio' } });
const omitido = () => ({ data: { ok: true, pagos_creados: 0, omitidos: 1, pago_id: 'pago-ficticio-existente' } });
const conflicto = () => ({ error: { code: 'HLC01', message: 'El destino dejó de ser único; vuelve a preparar' } });

async function escenario(respuestas, { dosServicios = false, lote = conflicto } = {}) {
    const q = { desde: '2026-10-01', hasta: '2026-10-31' };
    const pagos = ['tinaja', ...(dosServicios ? ['late_checkout'] : [])].map((concepto, n) => ({
        tipo_movimiento: 'servicio', concepto, monto: 10000, moneda: 'CLP', medio_pago: 'webpay_debito',
        codigo_autorizacion: 'FICTICIO-4C-' + n, fecha_comprobante: '2026-10-13', fecha_bloque: '2026-10-13',
        pago_recibido: true, estado_pago: 'registrado_en_libro', texto_original: 'Servicio ficticio ' + n,
        origen: { hoja: 'Oct26', celda: 'K' + (n + 20) }
    }));
    const reserva = { id: 'libro-ficticio-1', titular: 'Persona Ficticia Servicios', rut_documento: 'FICTICIO-DOC-4C',
        cabana: 1, fecha_checkin: '2026-10-13', fecha_checkout: '2026-10-14', tipo_estadia: 'alojamiento',
        noches: 1, adultos: 2, ninos: 0, mascotas: 0, pagos, pagos_sin_asociacion: [], servicios: [], advertencias: [],
        coordenadas_origen: { hoja: 'Oct26', celda: 'C20' } };
    const nueva = { ...reserva, id: 'alta-ficticia', titular: 'Persona Ficticia Alta', rut_documento: 'FICTICIO-DOC-ALTA',
        cabana: 2, pagos: [], coordenadas_origen: { hoja: 'Oct26', celda: 'C40' } };
    const tablas = { reserva_estadias: [{ id: 'estadia-ficticia', reserva_id: 'reserva-ficticia',
        fecha_ingreso: reserva.fecha_checkin, fecha_salida: reserva.fecha_checkout, estado_estadia: 'confirmada',
        tipo_estadia: 'alojamiento', adultos: 2, ninos: 0, mascotas: 0, cabanas: { numero: 1 },
        reservas: { id: 'reserva-ficticia', titular_nombre: reserva.titular,
            titular_numero_documento: reserva.rut_documento, estado_reserva: 'confirmada' } }], pagos: [], pago_aplicaciones: [],
        servicios: pagos.map((p, n) => ({ id: 'servicio-' + n, reserva_id: 'reserva-ficticia', fecha_servicio: '2026-10-13',
            total: 10000, tipo_cobro: 'normal', estado_servicio: 'programado',
            catalogo_servicios: { codigo: p.concepto, nombre: n ? 'Late Checkout' : 'Tinaja Tonel', categoria: 'servicio' } })),
        vista_estado_cargos: pagos.map((p, n) => ({ cargo_id: 'cargo-' + n, reserva_id: 'reserva-ficticia', servicio_id: 'servicio-' + n,
            tipo_cargo: 'servicio', concepto: n ? 'Late Checkout' : 'Tinaja Tonel', monto: 10000, monto_ajustado: 10000,
            aplicado_neto: 0, saldo_cargo: 10000, estado: 'activo', estado_pago: 'pendiente' })) };
    const calls = [], db = { calls, auth: { getSession: async () => ({ data: { session: { user: { id: 'usuario-ficticio' } } } }) },
        from(table) { const b = { select() { return b; }, in() { return b; }, eq() { return b; }, lte() { return b; },
            gte() { return b; }, order() { return b; }, range: async (a, z) => ({ data: structuredClone((tablas[table] || []).slice(a, z + 1)) }) }; return b; },
        async rpc(name, args) {
            calls.push({ name, args: structuredClone(args) });
            if (name === 'haiku_libro_aplicaciones_servicio_capacidad_v1') return { data: {
                version: 1, contrato: 'aplicaciones_servicio_v1', rpc: RPC, efectivo_sin_identificador: false } };
            if (name === RPC) {
                const response = respuestas.shift(); assert.ok(response, 'Respuesta sintética disponible');
                return typeof response === 'function' ? response(args) : response;
            }
            if (name === 'haiku_incorporar_libro_v1') return lote(args);
            throw Error('RPC inesperada');
        } };
    const result = { reservas: [reserva, nueva], q }, decisiones = new Map(), aprobados = new Set();
    const plan = await Q.prepararIncorporacion(result, decisiones, aprobados, db);
    assert.equal(Q.serializarIncorporacion(plan).filter(i => i.tipo === 'pago_servicios_4c').length, pagos.length);
    assert.equal(Q.serializarIncorporacion(plan).filter(i => i.tipo === 'reserva_nueva').length, 1);
    return { db, plan, result, confirmar: () => Q.confirmarIncorporacion(result, decisiones, aprobados, plan, db) };
}

function vista(h) {
    class Element {
        constructor(tag) { this.tag = tag; this.textContent = ''; this.children = []; this.events = {}; this.dataset = {}; this.style = {}; }
        append(...xs) { this.children.push(...xs); } replaceChildren(...xs) { this.children = xs; }
        addEventListener(k, f) { this.events[k] = f; } setAttribute(k, v) { this[k] = v; } removeAttribute(k) { delete this[k]; }
        querySelectorAll(s) { return this.children.flatMap(e => [e, ...e.querySelectorAll('*')]).filter(e =>
            s === '*' || s === e.tag || s.startsWith('.') && (e.className || '').split(' ').includes(s.slice(1))); }
        querySelector(s) { return this.querySelectorAll(s)[0] || null; } get options() { return this.children; }
    }
    const context = { structuredClone, haikuSupabase: h.db, confirm: () => true, HAIKU_LIBRO_SEMANTICA: global.HAIKU_LIBRO_SEMANTICA,
        document: { createElement: t => new Element(t), querySelector: () => null, getElementById: () => null }, addEventListener() {},
        Option: function(t, v) { const e = new Element('option'); e.textContent = t; e.value = v; return e; } };
    const api = 'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'), 'utf8').replace(api,
        api.replace(' })', ', renderizarIncorporacion })')), context);
    const out = new Element('div'); context.HAIKU_LIBRO_CONSULTAS.renderizarIncorporacion(out, h.plan, () => {}, () => {}, h.confirmar);
    return { confirmar: () => out.querySelectorAll('button').find(e => e.textContent.startsWith('Continuar con ') || e.textContent === 'Reintentar confirmación').events.click(),
        aviso: () => out.querySelector('.haiku-incorporacion-aviso').textContent };
}

for (const [nombre, respuesta, creados, omitidos] of [
    ['creado', creado, 1, 0], ['omitido', omitido, 0, 1]
]) test(`4C ${nombre}: conflicto posterior cuenta y presenta sólo la respuesta contractual`, async () => {
    const h = await escenario([respuesta()]); let error;
    await assert.rejects(h.confirmar(), e => { error = e; return e.haikuConflictoDatos === true; });
    assert.equal(error.haikuPagosConfirmados, creados); assert.equal(error.haikuPagosOmitidos, omitidos);
    assert.equal(error.haikuPagosInciertos, 0); assert.equal(h.plan.solicitudPendiente, null);
    const ui = vista(await escenario([respuesta()])); await ui.confirmar();
    assert.match(ui.aviso(), creados ? /1 pago\(s\) de servicios creado\(s\) y confirmado\(s\)/ : /1 pago\(s\) de servicios omitido\(s\).*ya existían/);
    if (!creados) assert.doesNotMatch(ui.aviso(), /ya confirmado|creado\(s\) y confirmado/);
});

test('4C mixto: creado y omitido no se cuentan como dos escrituras ante conflicto posterior', async () => {
    const h = await escenario([creado(), omitido()], { dosServicios: true });
    await assert.rejects(h.confirmar(), e => e.haikuPagosConfirmados === 1 && e.haikuPagosOmitidos === 1 && e.haikuPagosInciertos === 0);
    const ui = vista(await escenario([creado(), omitido()], { dosServicios: true })); await ui.confirmar();
    assert.match(ui.aviso(), /1 pago\(s\) de servicios creado\(s\) y confirmado\(s\)/);
    assert.match(ui.aviso(), /1 pago\(s\) de servicios omitido\(s\)/); assert.doesNotMatch(ui.aviso(), /2 pago\(s\).*confirmado/);
});

for (const [nombre, incierta] of [
    ['excepción de red', () => { throw Error('Red ficticia interrumpida'); }],
    ['error de transporte', () => ({ error: { code: 'NETWORK', message: 'Red ficticia interrumpida' } })],
    ['respuesta vacía', () => ({ data: null })],
    ['ok sin conteo contractual', () => ({ data: { ok: true } })]
]) test(`4C ${nombre}: resultado incierto no anuncia ausencia de escrituras y conserva la operación`, async () => {
    const h = await escenario([incierta, creado()], { lote: () => ({ data: { ok: true, reservas_creadas: 1 } }) });
    await assert.rejects(h.confirmar(), e => e.haikuPagosConfirmados === 0 && e.haikuPagosOmitidos === 0 && e.haikuPagosInciertos === 1);
    const op = h.db.calls.find(c => c.name === RPC).args.p_operacion_id;
    assert.ok(h.plan.solicitudPendiente);
    const retry = await h.confirmar(); assert.equal(retry.resultado.pagos_creados, 1);
    assert.equal(h.db.calls.filter(c => c.name === RPC).at(-1).args.p_operacion_id, op);
    const ui = vista(await escenario([incierta])); await ui.confirmar();
    assert.match(ui.aviso(), /resultado incierto.*podrían haberse ejecutado/i);
    assert.doesNotMatch(ui.aviso(), /No se guardó nada|creado\(s\) y confirmado/);
});

test('4C: una escritura confirmada y otra incierta se presentan por separado', async () => {
    const ui = vista(await escenario([creado(), () => { throw Error('Red ficticia interrumpida'); }], { dosServicios: true }));
    await ui.confirmar(); assert.match(ui.aviso(), /1 pago\(s\) de servicios creado\(s\) y confirmado\(s\)/);
    assert.match(ui.aviso(), /1 operación\(es\) de servicios con resultado incierto/); assert.doesNotMatch(ui.aviso(), /No se guardó nada/);
});

test('4C: conflicto conocido en un retry no borra la incertidumbre de la respuesta perdida anterior', async () => {
    const h = await escenario([() => { throw Error('Red ficticia interrumpida'); }, conflicto()]);
    await assert.rejects(h.confirmar());
    const ui = vista(h); await ui.confirmar();
    assert.match(ui.aviso(), /resultado incierto.*podrían haberse ejecutado/i); assert.doesNotMatch(ui.aviso(), /No se guardó nada/);
    const ops = h.db.calls.filter(c => c.name === RPC).map(c => c.args.p_operacion_id); assert.equal(ops[0], ops[1]);
    assert.equal(h.plan.solicitudPendiente, null);
});

test('4C: conflicto sin escrituras previas conserva el aviso de lote no guardado', async () => {
    const ui = vista(await escenario([conflicto()])); await ui.confirmar();
    assert.match(ui.aviso(), /^No se guardó nada:/); assert.doesNotMatch(ui.aviso(), /resultado incierto|creado\(s\) y confirmado/);
});

test('4C: crear antes de perder la respuesta y reintentar registra exactamente un pago', async () => {
    const operaciones = new Map(); let escrituras = 0;
    const primera = args => { escrituras++; operaciones.set(args.p_operacion_id, creado()); throw Error('Respuesta ficticia perdida'); };
    const retry = args => { assert.ok(operaciones.has(args.p_operacion_id)); return operaciones.get(args.p_operacion_id); };
    const h = await escenario([primera, retry], { lote: () => ({ data: { ok: true, reservas_creadas: 1 } }) });
    await assert.rejects(h.confirmar(), e => e.haikuPagosInciertos === 1);
    const resultado = await h.confirmar(); assert.equal(resultado.resultado.pagos_creados, 1);
    assert.equal(escrituras, 1); assert.equal(operaciones.size, 1);
    const llamadas = h.db.calls.filter(c => c.name === RPC); assert.deepEqual(llamadas[0].args, llamadas[1].args);
});

test('4C: pago creado y omitido conservan sus totales al reintentar sólo el lote restante', async () => {
    let intentos = 0;
    const h = await escenario([creado(), omitido()], { dosServicios: true, lote: () => {
        if (++intentos === 1) throw Error('Respuesta ficticia del lote perdida');
        return { data: { ok: true, reservas_creadas: 1, pagos_creados: 0, omitidos: 0 } };
    } });
    await assert.rejects(h.confirmar(), e => e.haikuPagosConfirmados === 1 && e.haikuPagosOmitidos === 1 && e.haikuPagosInciertos === 0);
    const resultado = await h.confirmar(); assert.equal(resultado.resultado.pagos_creados, 1); assert.equal(resultado.resultado.omitidos, 1);
    assert.equal(h.db.calls.filter(c => c.name === RPC).length, 2, 'No reenvía servicios creados ni omitidos');
    const lotes = h.db.calls.filter(c => c.name === 'haiku_incorporar_libro_v1'); assert.deepEqual(lotes[0].args, lotes[1].args);
});

test('4C: revalidación local posterior a una respuesta creada no oculta la escritura confirmada', async () => {
    let h;
    h = await escenario([() => { h.result.generacion = 'generacion-ficticia-cambiada'; return creado(); }]);
    await assert.rejects(h.confirmar(), e => e.haikuPagosConfirmados === 1 && e.haikuPagosInciertos === 0);
    assert.equal(h.db.calls.some(c => c.name === 'haiku_incorporar_libro_v1'), false);
});

test('4C: fallo de capability en el retry mantiene visibles los resultados parciales anteriores', async () => {
    const h = await escenario([creado(), () => { throw Error('Red ficticia interrumpida'); }], { dosServicios: true });
    await assert.rejects(h.confirmar());
    const rpc = h.db.rpc; h.db.rpc = (name, args) => name === 'haiku_libro_aplicaciones_servicio_capacidad_v1'
        ? Promise.resolve({ error: { message: 'Capability ficticia no disponible' } }) : rpc(name, args);
    const ui = vista(h); await ui.confirmar();
    assert.match(ui.aviso(), /1 pago\(s\) de servicios creado\(s\) y confirmado\(s\)/);
    assert.match(ui.aviso(), /1 operación\(es\) de servicios con resultado incierto/);
    assert.doesNotMatch(ui.aviso(), /No se guardó nada/);
});
