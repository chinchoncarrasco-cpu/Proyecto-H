const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures/libro-comparacion-readonly.cjs');

async function fixture({rechazarCancelacion = false, cancelacionSeleccionada = true, ocupacion = {cabana: 1,
    ingreso: '2026-10-03', salida: '2026-10-05', tipo: 'alojamiento'}, errorBase} = {}) {
    const {data, db} = F.caso('altas-ficticias', (r, sistema, hoja) => {
        sistema.reserva_estadias = []; sistema.reservas = [];
        hoja.reservas.push(F.reserva({id: 'alta-independiente', titular: 'Persona Independiente Ficticia',
            cabana: 2, coordenadas_origen: F.origen('C4')}));
    });
    const context = F.web(data), cliente = F.cliente(db), llamadas = [];
    context.haikuSupabase = cliente; context.haikuTienePermiso = () => true;
    const Q = context.HAIKU_LIBRO_CONSULTAS;
    const q = {desde: '2026-10-01', hasta: '2026-10-31', incluirFinanzas: false};
    const result = {reservas: data.reservas, q, generacion: 1,
        comparacion: await Q.compararSistema(data.reservas, cliente, q)};
    const decisiones = new Map(), aprobados = new Set();
    const plan = await Q.prepararIncorporacion(result, decisiones, aprobados, cliente);
    assert.equal(plan.items.filter(i => i.categoria === 'nuevas' && i.seleccionado).length, 2);
    let cancelada = false, intentoBase = 0;
    plan.items.push({id: 'cancelacion:ficticia', categoria: 'cambios_detectados', esCambioDetectado: true,
        tipoCambio: 'cancelar_reserva', seleccionado: cancelacionSeleccionada, motivos: [], dependeDe: [],
        texto: 'Persona Anterior Ficticia · CAB 1', etiquetaCambio: 'Cancelar reserva',
        ocupacionCancelacion: ocupacion, propuestaCambio: {ocupacion, firma: 'firma-ficticia', guardar: async () => {
            llamadas.push({tipo: 'cancelacion'});
            if (rechazarCancelacion) throw Error('Entró un pago: requiere revisión.');
            cancelada = true; return 'cancelada';
        }}});
    cliente.rpc = async (nombre, args) => {
        assert.equal(nombre, 'haiku_incorporar_libro_v1');
        llamadas.push({tipo: 'altas', args}); intentoBase++;
        if (errorBase?.(intentoBase)) return {error: errorBase(intentoBase)};
        const altas = args.p_items.filter(i => i.tipo === 'reserva_nueva');
        if (ocupacion.cabana === 1 && ocupacion.ingreso === '2026-10-03' && !cancelada &&
            altas.some(i => i.estadias.some(e => e.cabana_numero === 1)))
            return {error: {code: 'P0001', message: 'La CAB 1 no está disponible para esa fecha o rango'}};
        return {data: {ok: true, reservas_creadas: altas.length, resultados: []}};
    };
    return {context, Q, cliente, plan, llamadas, confirmar: () => Q.confirmarIncorporacion(result, decisiones, aprobados, plan, cliente)};
}

test('confirma la cancelación antes de crear la reserva que ocupa su cabaña', async () => {
    const h = await fixture(), r = await h.confirmar();
    assert.deepEqual(h.llamadas.map(x => x.tipo), ['cancelacion', 'altas']);
    assert.equal(r.resultado.reservas_creadas, 2);
    assert.equal(r.cambiosDetectados[0].estado, 'Incorporado');
});

for (const seleccionada of [true, false]) test(`cancelación ${seleccionada ? 'rechazada' : 'sin seleccionar'}: bloquea el alta dependiente y su pago; permite la independiente`, async () => {
    const h = await fixture({rechazarCancelacion: true, cancelacionSeleccionada: seleccionada});
    const dependiente = h.plan.items.find(i => i.categoria === 'nuevas' && i.payload.estadias[0].cabana_numero === 1);
    h.plan.items.push({id: 'pago-dependiente', categoria: 'pagos', seleccionado: true, motivos: [],
        texto: 'Pago ficticio', dependeDe: [dependiente.id], payload: {tipo: 'pago', reserva_ref: dependiente.id}});
    const r = await h.confirmar();
    const altas = h.llamadas.filter(x => x.tipo === 'altas');
    assert.equal(altas.length, 1); assert.equal(altas[0].args.p_items.length, 1);
    assert.equal(altas[0].args.p_items[0].estadias[0].cabana_numero, 2);
    assert.equal(r.resultado.reservas_creadas, 1);
    assert.equal(dependiente.seleccionado, false); assert.match(dependiente.motivos.join(' '), /cancelación/);
    assert.equal(h.plan.items.find(i => i.id === 'pago-dependiente').seleccionado, false);
    assert.ok(r.cambiosDetectados.some(i => i.estado === 'Por verificar'));
});

test('respuesta de red perdida después de cancelar: conserva el recibo y reintenta sólo la misma alta', async () => {
    const h = await fixture({errorBase: n => n === 1 ? {message: 'Respuesta de red perdida'} : null});
    await assert.rejects(h.confirmar(), e => {
        assert.equal(e.haikuCambiosDetectados[0].estado, 'Incorporado'); return true;
    });
    const operacion = h.plan.solicitudPendiente.operacionId;
    const r = await h.confirmar();
    assert.deepEqual(h.llamadas.map(x => x.tipo), ['cancelacion', 'altas', 'altas']);
    assert.ok(h.llamadas.filter(x => x.tipo === 'altas').every(x => x.args.p_operacion_id === operacion));
    assert.equal(r.cambiosDetectados.filter(i => i.estado === 'Incorporado').length, 1);
});

test('conflicto de disponibilidad confirmado por servidor: exige volver a comparar, sin bloquear Volver como error de red', async () => {
    const h = await fixture({errorBase: () => ({code: 'P0001', message: 'La CAB 2 no está disponible para esa fecha o rango'})});
    await assert.rejects(h.confirmar(), e => {
        assert.equal(e.haikuConflictoDatos, true);
        assert.equal(e.haikuCambiosDetectados[0].estado, 'Incorporado'); return true;
    });
    assert.equal(h.plan.solicitudPendiente, null);
});

test('cancelación rechazada sin cabaña verificada: no presume que las altas son independientes', async () => {
    const h = await fixture({rechazarCancelacion: true, ocupacion:{cabana:null,ingreso:'2026-10-03',salida:'2026-10-05',tipo:'alojamiento'}});
    const r = await h.confirmar();
    assert.deepEqual(h.llamadas.map(x => x.tipo), ['cancelacion']);
    assert.equal(r.cambiosDetectados.filter(i => i.estado === 'Por verificar').length, 3);
});

for (const [nombre, ocupacion, cantidad] of [
    ['alojamiento contiguo', {cabana: 1, ingreso: '2026-10-01', salida: '2026-10-03', tipo: 'alojamiento'}, 2],
    ['Full Day en el checkout', {cabana: 1, ingreso: '2026-10-05', salida: '2026-10-05', tipo: 'fullday'}, 1],
    ['otra cabaña', {cabana: 9, ingreso: '2026-10-03', salida: '2026-10-05', tipo: 'alojamiento'}, 2]
]) test(`cancelación rechazada y ${nombre}: respeta la dependencia real`, async () => {
    const h = await fixture({rechazarCancelacion: true, ocupacion});
    const r = await h.confirmar(); assert.equal(r.resultado.reservas_creadas, cantidad);
});
