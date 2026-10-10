// Frontend real y RPC versionados sobre PostgreSQL efímero. Sin conexiones externas.
const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { preparar } = require('./fixtures/libro-identidad-documento-sql.cjs');
const { crear } = require('./fixtures/libro-actualizaciones-pagos-flujo.cjs');
global.HAIKU_LIBRO_SEMANTICA = require('../js/haiku-libro-semantica-v1.js');
const Q = require('../js/haiku-libro-consultas-v1.js');
async function escenario({ aplicar = true } = {}) {
    const h = await preparar({ aplicar }), f = crear();
    try {
        await h.db.query('update reserva_estadias set adultos=2 where id=$1', [h.ids.estadia]);
        const destinos = [h.ids.reserva];
        for (let n = 2; n <= 4; n++) {
            const r = randomUUID(), g = randomUUID(), e = randomUUID(), c = randomUUID(); destinos.push(r);
            await h.db.query(`insert into huespedes(id,nombre,tipo_documento,numero_documento)
                values($1,$2,'pasaporte',$3)`, [g, 'Persona Ficticia Proyecto ' + n, 'FICTICIO-PROYECTO-' + n]);
            await h.db.query(`insert into reservas(id,titular_nombre,titular_tipo_documento,titular_numero_documento,titular_huesped_id,estado_reserva)
                values($1,$2,'pasaporte',$3,$4,'confirmada')`, [r, 'Persona Ficticia Proyecto ' + n, 'FICTICIO-PROYECTO-' + n, g]);
            await h.db.query('insert into cabanas(id,numero) values($1,$2)', [c, n]);
            await h.db.query(`insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia,adultos)
                values($1,$2,$3,'2026-10-13','2026-10-15','confirmada',2)`, [e, r, c]);
            await h.db.query('insert into reserva_huespedes values($1,$2)', [r, g]);
            await h.db.query('insert into estadia_huespedes values($1,$2)', [e, g]);
        }
        f.reservas[1].rut_documento = 'FICTICIO-B'; // Ocupado por otro huésped sin reasociarlo.
        const calls = [], cliente = { calls, auth: { getSession: async () => ({ data: { session: { user: { id: h.usuario } } } }) },
            from(table) {
                const b = { select() { return b; }, lte() { return b; }, gte() { return b; }, in() { return b; }, order() { return b; },
                    async range(a, z) {
                        if (table === 'reserva_estadias') {
                            const rows = (await h.db.query(`select e.*,to_char(e.fecha_ingreso,'YYYY-MM-DD') fecha_ingreso,
                                to_char(e.fecha_salida,'YYYY-MM-DD') fecha_salida,jsonb_build_object('numero',c.numero) cabanas,to_jsonb(r) reservas
                                from reserva_estadias e join cabanas c on c.id=e.cabana_id join reservas r on r.id=e.reserva_id order by c.numero`)).rows;
                            return { data: rows.slice(a, z + 1) };
                        }
                        assert.ok(['pagos','servicios','pago_aplicaciones','vista_estado_cargos'].includes(table), table);
                        return { data: JSON.parse(JSON.stringify((await h.db.query('select * from ' + table)).rows)).slice(a, z + 1) };
                    } }; return b;
            },
            async rpc(name, args) {
                assert.equal(name, 'haiku_incorporar_libro_v1'); calls.push(structuredClone(args));
                try { return { data: await h.lote(args.p_items, args.p_operacion_id) }; }
                catch (e) { return { error: { code: e.code, message: e.message, details: e.detail } }; }
            } };
        const decisiones = new Map(), aprobados = new Set(), comparacion = await Q.compararSistema(f.reservas, cliente, f.q);
        for (const g of comparacion.grupos) {
            const stay = comparacion.snapshot.estadias.find(s => s.cabana === g.items[0].libro.cabana);
            if (stay) decisiones.set(g.clave, { valor: 'asociar:' + stay.id });
        }
        return { ...h, f, destinos, cliente, decisiones, aprobados, result: { reservas: f.reservas, q: f.q, comparacion } };
    } catch (e) { await h.db.close(); throw e; }
}
test('SQL: cuatro actualizaciones, conflicto atómico, tres válidas y dos pagos progresivos sin duplicar', async () => {
    const h = await escenario();
    try {
        const prepararPlan = () => Q.prepararIncorporacion(h.result, h.decisiones, h.aprobados, h.cliente);
        const confirmar = p => Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, p, h.cliente);
        const inicial = await prepararPlan(), antes = await h.snapshot();
        assert.equal(inicial.items.filter(i => i.seleccionado).length, 4);
        await assert.rejects(confirmar(inicial), e => e.code === 'HLI01');
        assert.deepEqual(await h.snapshot(), antes, 'El lote fallido no escribe identidades, pagos ni auditoría');
        const valido = await prepararPlan();
        valido.items.forEach(i => i.seleccionado = i.payload?.tipo === 'reserva_actualizar' && !i.motivos.length);
        const confirmado = await confirmar(valido); assert.equal(confirmado.resultado.actualizaciones, 3);
        assert.equal(confirmado.resultado.pagos_creados, 0);
        const parcial = await prepararPlan(), pago1 = parcial.items.find(i => i.pagoLibro?.codigo_autorizacion === 'FICTICIO-AUT-1');
        const pago2 = parcial.items.find(i => i.pagoLibro?.codigo_autorizacion === 'FICTICIO-AUT-2');
        assert.equal(pago1.categoria, 'pagos'); assert.equal(pago2.etapaSiguiente, true);
        parcial.items.forEach(i => i.seleccionado = i === pago1); const primero = await confirmar(parcial);
        assert.equal(primero.resultado.pagos_creados, 1);
        const retry = await confirmar(parcial); assert.equal(retry.resultado.reintento, true);
        assert.equal((await h.snapshot()).pagos.length, 1);
        const siguiente = await prepararPlan(); assert.ok(siguiente.items.some(i => i.id === pago1.id && i.categoria === 'omitidos'));
        const pendiente = siguiente.items.find(i => i.conflictoIdentidad);
        assert.equal(pendiente.payload.reserva_id, h.destinos[1]);
        const ownerAntes = antes.huespedes.find(g => g.id === h.ids.owner);
        // Evidencia sintética corregida en un Libro nuevo; nunca reasociar el documento ocupado.
        h.f.reservas[1].rut_documento = 'FICTICIO-LIBRO-2-CORREGIDO';
        h.result.comparacion = await Q.compararSistema(h.f.reservas, h.cliente, h.f.q);
        const grupoCorregido = h.result.comparacion.grupos.find(g => g.items.some(i => i.libro.id === h.f.reservas[1].id));
        const destinoRevisado = h.result.comparacion.snapshot.estadias.find(s => s.reserva_id === h.destinos[1]);
        h.decisiones.set(grupoCorregido.clave, { valor: 'asociar:' + destinoRevisado.id });
        const corregido = await prepararPlan();
        corregido.items.forEach(i => i.seleccionado = i.payload?.reserva_id === h.destinos[1] && i.payload?.tipo === 'reserva_actualizar');
        assert.equal((await confirmar(corregido)).resultado.actualizaciones, 1);
        const final = await prepararPlan(), segundo = final.items.find(i => i.pagoLibro?.codigo_autorizacion === 'FICTICIO-AUT-2');
        assert.equal(segundo.categoria, 'pagos'); final.items.forEach(i => i.seleccionado = i === segundo);
        assert.equal((await confirmar(final)).resultado.pagos_creados, 1);
        assert.equal((await h.snapshot()).pagos.length, 2);
        assert.deepEqual((await h.snapshot()).huespedes.find(g => g.id === h.ids.owner), ownerAntes);
        const existente = await prepararPlan(); assert.equal(existente.items.filter(i => i.id.startsWith('pago:') && i.categoria === 'omitidos').length, 2);
        assert.deepEqual((await h.snapshot()).reserva_huespedes, antes.reserva_huespedes);
        assert.deepEqual((await h.snapshot()).estadia_huespedes, antes.estadia_huespedes);
    } finally { await h.db.close(); }
});
test('SQL legado sin migration instalada: conflicto no pierde datos y un subconjunto confirmado puede avanzar', async () => {
    const h = await escenario({ aplicar: false });
    try {
        const p = await Q.prepararIncorporacion(h.result, h.decisiones, h.aprobados, h.cliente), antes = await h.snapshot();
        await assert.rejects(Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, p, h.cliente), e => e.code === 'HLI01');
        assert.deepEqual(await h.snapshot(), antes);
        p.items.forEach(i => i.seleccionado = i.payload?.tipo === 'reserva_actualizar' && i.payload.reserva_id !== h.destinos[1]);
        assert.equal((await Q.confirmarIncorporacion(h.result, h.decisiones, h.aprobados, p, h.cliente)).resultado.actualizaciones, 3);
        const siguiente = await Q.prepararIncorporacion(h.result, h.decisiones, h.aprobados, h.cliente);
        assert.equal(siguiente.items.find(i => i.pagoLibro?.codigo_autorizacion === 'FICTICIO-AUT-1').categoria, 'pagos');
        assert.equal(siguiente.items.find(i => i.pagoLibro?.codigo_autorizacion === 'FICTICIO-AUT-2').etapaSiguiente, true);
    } finally { await h.db.close(); }
});
