const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const F = require('./fixtures/libro-comparacion-readonly.cjs');

class Elemento {
    constructor(tag) {
        Object.assign(this, {tag, children: [], dataset: {}, style: {}, events: {}, textContent: ''});
    }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(event, callback) { this.events[event] = callback; }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    querySelectorAll(selector) {
        return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(child =>
            selector === '*' || selector === child.tag ||
            (selector.startsWith('.') && (child.className || '').split(' ').includes(selector.slice(1))));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

for (const cambioTrasPreparar of [false, true]) test(
    cambioTrasPreparar ? 'un pago nuevo deja la cancelación en revisión y conserva lo incorporado' :
        'un clic guarda estado, alta y retiro de servicio y cancelación, con pagos pendientes fuera', async () => {
    const {data, db} = F.caso('lote-ficticio', (r, sistema, hoja) => {
        r.hoja = 'Oct26';
        r.estado_confirmacion = 'confirmada_por_color';
        sistema.reserva_estadias[0].reservas.estado_reserva = 'pendiente';
        sistema.reserva_estadias[0].estado_estadia = 'pendiente';
        sistema.servicios.push(F.servicioH({
            catalogo_servicios: {codigo: 'tinajaTonel', nombre: 'Tinaja Tonel'},
            hora_inicio: '18:00', total: 0, tipo_cobro: 'cortesia',
            observaciones: 'Importado desde Libro de Reserva. TINAJA TONEL 18:00 CORTESIA [HAKU-LIBRO-SERVICIO:srv:sintetico]'
        }));
        for (const [id, titular] of [['baja', 'Persona Baja Ficticia'], ['pago', 'Persona Abonó Ficticia']]) {
            const e = {id: 'estadia-' + id, reserva_id: id, cabana_id: 'cab-2', fecha_ingreso: '2026-10-05',
                fecha_salida: '2026-10-06', estado_estadia: 'confirmada', cabanas: {numero: 2}};
            sistema.reserva_estadias.push(e);
            sistema.reservas.push({id, titular_nombre: titular, estado_reserva: 'confirmada', estadias: [e]});
            hoja.cancelaciones.push({titular, fecha_checkin: e.fecha_ingreso, noches: 1,
                bloque: 'CANCELACIONES', origen: F.origen(id === 'baja' ? 'C16' : 'D16')});
        }
    });
    const context = F.web(data);
    const cliente = F.cliente(db);
    context.haikuSupabase = cliente;
    context.haikuTienePermiso = () => true;
    context.HAIKU_RESERVA_ESTADOS_SUPABASE_V2 = {cancelar: () => assert.fail('El lote no debe abrir confirmaciones individuales')};
    const escrituras = [];
    context.HAIKU_ASISTENTE_SERVICIOS_CANCELACION_V1 = {
        preparar: async (_, opciones) => ({estado: 'propuesta', p_estado_esperado: {}, opciones}),
        confirmar: async (p, motivo) => {
            assert.match(motivo, /Retiro verificado/);
            await p.opciones.antesDeConfirmar();
            escrituras.push('servicio');
            return {estado: 'realizado', mensaje: 'Cancelado'};
        }
    };
    context.HAIKU_LIBRO_SERVICIOS_SCOPE_V2 = {
        compararReservas: async ([reserva]) => ({items: reserva ? [{
            reserva, kind: 'servicio', estado: 'listo', item_id: 'servicio-nuevo', mapa: {nombre: 'Masaje'},
            servicio: {concepto: 'Masaje'}, fecha: '2026-10-03', hora: '17:00',
            asociacion: {estado: 'asociada', sistema: {id: 'estadia-ficticia-1', reserva_id: 'reserva-ficticia-1'}}
        }] : []}),
        prepararServicioEnLinea: async (_, id, estadiaId, opciones) => {
            assert.equal(id, 'servicio-nuevo');
            assert.equal(estadiaId, 'estadia-ficticia-1');
            assert.equal(opciones.paraLote, true);
            return {firma: 'servicio-nuevo', texto: 'Masaje · 17:00 · $35.000', guardar: async () => {
                escrituras.push('nuevo servicio');
                return 'incorporado';
            }};
        }
    };
    const libro = {...context.HAIKU_LIBRO_RESERVA_V1};
    context.HAIKU_LIBRO_RESERVA_V1 = libro;
    libro.crearLectura = async () => libro;
    cliente.rpc = async (nombre, args) => {
        if (nombre === 'haiku_libro_cancelacion_segura_lote_v1') {
            if (args.p_reserva_id === 'pago') return {data: {estado: 'revision', motivo: 'Hay pagos que requieren revisión.'}};
            if (!args.p_confirmar) return {data: {estado: 'listo'}};
            if (cambioTrasPreparar) return {data: {estado: 'revision', motivo: 'Entró un pago después de preparar.'}};
            escrituras.push('cancelacion');
            return {data: {estado: 'cancelada'}};
        }
        assert.equal(nombre, 'haiku_incorporar_libro_v1');
        assert.equal(args.p_items.length, 1);
        assert.equal(args.p_items[0].estadia.despues.estado_estadia, 'confirmada');
        escrituras.push('estado');
        return {data: {ok: true, actualizaciones: 1}};
    };
    const Q = context.HAIKU_LIBRO_CONSULTAS;
    const q = {desde: '2026-10-01', hasta: '2026-10-31', incluirFinanzas: false, serviciosOperativos: true};
    const comparacion = await Q.compararSistema(data.reservas, cliente, q);
    assert.ok(cliente.lecturas.some(x => x.tabla === 'servicios' && x.columns.split(',').includes('estado_servicio')));
    const cancelaciones = await context.HAIKU_LIBRO_CANCELACIONES_V1.detectarActual(data, cliente);
    const resultado = {reservas: data.reservas, q, generacion: 1, comparacion, ...cancelaciones};
    const decisiones = new Map(), aprobados = new Set();
    const plan = await Q.prepararIncorporacion(resultado, decisiones, aprobados, cliente);
    assert.deepEqual(escrituras, []);
    const elegidos = Array.from(plan.items.filter(i => i.seleccionado), i => i.categoria);
    assert.deepEqual(elegidos.sort(), ['actualizaciones', 'cambios_detectados', 'cambios_detectados', 'cambios_detectados'], JSON.stringify(plan.items.map(i => [i.id, i.motivos])));
    assert.match(plan.items.find(i => i.id === 'cancelacion:pago').motivos[0], /pagos/);
    context.document = {createElement: tag => new Elemento(tag), getElementById: () => null};
    context.HAIKU_DIALOGOS = {confirmar: () => assert.fail('La vista preparada es la confirmación del lote seguro')};
    const vista = new Elemento('div');
    await Q.abrirPreparacionComparacion(vista, resultado);
    const textos = () => vista.querySelectorAll('*').map(e => e.textContent).join(' ');
    assert.match(textos(), /Cambios detectados/);
    assert.match(textos(), /1 reserva por cancelar · 1 servicio por cancelar · 1 servicio por agregar/);
    assert.match(textos(), /Hay pagos que requieren revisión/);
    const boton = vista.querySelectorAll('button').find(e => e.textContent === 'Incorporar todo lo seguro (4)');
    assert.ok(boton);
    const incorporacion = boton.events.click();
    await boton.events.click();
    await incorporacion;
    if (cambioTrasPreparar) {
        assert.deepEqual(escrituras, ['estado', 'servicio', 'nuevo servicio'], textos());
        assert.match(textos(), /Cambios detectados incorporados \(2\)/);
        assert.match(textos(), /Cambios por verificar \(1\)/);
        assert.match(textos(), /Entró un pago después de preparar/);
    } else {
        assert.deepEqual(escrituras, ['cancelacion', 'estado', 'servicio', 'nuevo servicio'], textos());
        assert.match(textos(), /Cambios detectados incorporados \(3\)/);
    }
});

test('el RPC revalida la cancelación al confirmar y conserva pagos y servicios', async t => {
    const {crear} = require('./fixtures/libro-reprogramacion-sql.cjs');
    const {db, read, id} = await crear();
    t.after(() => db.close());
    const guardas = read('supabase/migrations/20260916041430_haku_libro_aplicaciones_servicio_seguras.sql');
    await db.exec(guardas.slice(0, guardas.indexOf('-- Todos los writers')));
    await db.exec(read('supabase/migrations/20260902045000_cancelar_reserva_desde_ficha_supabase.sql'));
    await db.exec(read('supabase/migrations/20261117034000_libro_cancelacion_segura_lote.sql'));

    async function preparar() {
        const r = randomUUID(), e = randomUUID();
        await db.query("insert into reservas(id,titular_nombre,estado_reserva) values($1,'Ejemplo sin datos reales','confirmada')", [r]);
        await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia) values($1,$2,$3,'2026-12-10','2026-12-11','confirmada')", [e, r, id.cabana]);
        const esperado = {estadia_id: e, cabana_id: id.cabana, titular: 'Ejemplo sin datos reales',
            estado_reserva: 'confirmada', estado_estadia: 'confirmada', entrada: '2026-12-10', salida: '2026-12-11'};
        const llamada = async confirmar => (await db.query('select public.haiku_libro_cancelacion_segura_lote_v1($1,$2::jsonb,$3) dato',
            [r, JSON.stringify(esperado), confirmar])).rows[0].dato;
        const estado = async () => (await db.query('select estado_reserva from reservas where id=$1', [r])).rows[0].estado_reserva;
        return {r, e, llamada, estado};
    }

    const segura = await preparar();
    assert.equal((await segura.llamada(false)).estado, 'listo');
    assert.equal(await segura.estado(), 'confirmada');
    assert.equal((await segura.llamada(true)).estado, 'cancelada');
    assert.equal(await segura.estado(), 'cancelada');
    assert.equal((await segura.llamada(true)).estado, 'ya_coincide');

    const conPago = await preparar();
    assert.equal((await conPago.llamada(false)).estado, 'listo');
    await db.query("insert into pagos(id,reserva_id,monto,moneda,tipo_movimiento,estado,fecha_pago) values($1,$2,10000,'CLP','pago','confirmado','2026-11-01')", [randomUUID(), conPago.r]);
    assert.match((await conPago.llamada(true)).motivo, /pagos/);
    assert.equal(await conPago.estado(), 'confirmada');

    await db.query("update reserva_estadias set checkin_realizado_en=now() where id=$1", [conPago.e]);
    assert.match((await conPago.llamada(true)).motivo, /actividad operativa/);
    await db.query("update reserva_estadias set fecha_salida='2026-12-12' where id=$1", [conPago.e]);
    assert.match((await conPago.llamada(true)).motivo, /fechas cambiaron/);
    await db.exec("select set_config('reprog.deny_permission','reservas.cancelar',false)");
    await assert.rejects(() => conPago.llamada(true), /permiso/);
});
