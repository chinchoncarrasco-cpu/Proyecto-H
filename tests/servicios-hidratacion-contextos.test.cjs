const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const js = nombre => fs.readFileSync(path.join(__dirname, '..', 'js', nombre), 'utf8');
const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
const servicio = (id, cambios = {}) => ({
    id, fecha_servicio: hoy, hora_inicio: '19:15:00', hora_fin: '20:15:00',
    total: 30000, tipo_cobro: 'normal', estado_servicio: 'programado',
    reserva_id: 'reserva-2', reserva_estadias: { cabanas: { numero: 2 } },
    reservas: { titular_nombre: 'Huésped real', codigo_haiku: 'H-2' },
    catalogo_servicios: { codigo: 'tinaja', categoria: 'tinaja',
        nombre: 'Tinaja Tonel', duracion_minutos: 60 },
    ...cambios
});

function entorno({ fallo = null } = {}) {
    const eventos = new Map();
    const eventosWindow = new Map();
    const nodos = new Map();
    const temporizadores = new Map();
    const almac = new Map();
    const llamadas = { consultas: [], coordinador: [], finanzas: 0,
        resumen: 0, agenda: 0, errores: [] };
    let proximoTimer = 0;
    let filas = [servicio('servicio-1')];
    const nodo = id => {
        const valor = { id, dataset: {}, style: {}, classList: { contains: () => false },
            innerHTML: '', textContent: '', value: hoy, hidden: false, listeners: {},
            setAttribute() {}, removeAttribute() {},
            addEventListener(tipo, fn) { (this.listeners[tipo] ||= []).push(fn); },
            replaceChildren() { this.innerHTML = ''; } };
        nodos.set(id, valor);
        return valor;
    };
    for (const id of ['sites-servicios-root', 'sites-servicios-contenido',
        'sites-servicios-fecha-label', 'seccion-servicios', 'servicios-contador-hoy']) nodo(id);
    const campoResumen = { value: 'sin tocar' };
    const filaResumen = { dataset: { cabana: '2' },
        querySelector: selector => selector === '[data-campo="servicio"]' ? campoResumen : null };
    const document = {
        getElementById: id => nodos.get(id) || null,
        querySelectorAll: selector => selector.includes('#seccion-resumen .sites-resumen-cabana')
            ? [filaResumen] : [],
        addEventListener(tipo, fn) { (eventos.get(tipo) || eventos.set(tipo, []).get(tipo)).push(fn); },
        dispatchEvent(evento) {
            for (const fn of eventos.get(evento.type) || []) fn(evento);
            return true;
        },
        hidden: false
    };
    const cliente = { from(tabla) {
        assert.equal(tabla, 'servicios');
        const consulta = { select() { return this; }, order() { return this; },
            then(resolve, reject) {
                llamadas.consultas.push(tabla);
                return Promise.resolve({ data: fallo ? null : filas, error: fallo }).then(resolve, reject);
            } };
        return consulta;
    } };
    const fuentes = new Map();
    const coordinador = { activo: () => true, publicando: () => false,
        registrar(nombre, fuente) { fuentes.set(nombre, fuente); return true; },
        solicitar(fecha, origen) {
            llamadas.coordinador.push({ fecha, origen });
            return Promise.resolve(true);
        } };
    const window = {
        haikuSupabase: cliente, haikuSesion: { auth: { id: 'usuario' } },
        HAIKU_RESUMEN_REFRESH_V1: coordinador,
        haikuTienePermiso: () => true,
        HAIKU_SERVICIOS_TINAJAS_HORARIOS_V1: {
            horarios: [{ inicio: '19:15', fin: '20:15' }],
            serviciosTinajaDelDia: () => [],
            estadoHorario: () => ({ estado: 'libre', activos: [] })
        },
        async haikuSincronizarFinanzasServicios() {
            llamadas.finanzas++;
            for (const item of contexto.serviciosRegistrados) {
                item.saldoPendienteVerificado = 12000;
            }
            document.dispatchEvent(new CustomEvent('haiku:servicios-finanzas-actualizadas'));
        },
        addEventListener(tipo, fn) {
            (eventosWindow.get(tipo) || eventosWindow.set(tipo, []).get(tipo)).push(fn);
        }
    };
    const CustomEvent = class { constructor(type, init = {}) {
        this.type = type; this.detail = init.detail;
    } };
    const logger = { info() {}, warn() {}, error(...args) { llamadas.errores.push(args); } };
    const contexto = vm.createContext({ window, document, CustomEvent,
        fechaSeleccionada: hoy, serviciosRegistrados: [],
        localStorage: { getItem: k => almac.get(k) || null,
            setItem: (k, v) => almac.set(k, v) },
        renderizarAgendaServicios: () => { llamadas.agenda++; },
        actualizarResumenDia: () => { llamadas.resumen++; },
        generarResumenOperativo: () => { llamadas.resumen++; },
        setTimeout(fn, ms) { const id = ++proximoTimer; temporizadores.set(id, { fn, ms }); return id; },
        clearTimeout(id) { temporizadores.delete(id); },
        Date, Intl, console: logger
    });
    vm.runInContext(js('supabase-servicios-hidratacion-v2.js'), contexto);
    vm.runInContext(js('sites-servicios-v1.js'), contexto);
    return {
        window, document, contexto, fuentes, nodos, campoResumen, llamadas,
        html: () => nodos.get('sites-servicios-contenido').innerHTML,
        setFilas(nuevas) { filas = nuevas; },
        emitir(tipo) { document.dispatchEvent(new CustomEvent(tipo)); },
        clickSeccionServicios() {
            document.dispatchEvent({ type: 'click', target: {
                closest: selector => selector.includes('[data-seccion="servicios"]') ? {} : null
            } });
        },
        async temporizadoresHasta(limite) {
            const pendientes = [...temporizadores].filter(([, t]) => t.ms <= limite)
                .sort((a, b) => a[1].ms - b[1].ms);
            for (const [id, timer] of pendientes) {
                if (!temporizadores.has(id)) continue;
                temporizadores.delete(id);
                await timer.fn();
            }
            await new Promise(setImmediate);
        },
        escuchas(tipo) { return (eventos.get(tipo) || []).length; }
    };
}

test('el clic de entrada a Servicios hidrata y renderiza aun con Resumen coordinado', async () => {
    const e = entorno();
    e.clickSeccionServicios();
    await e.temporizadoresHasta(80);
    assert.equal(e.llamadas.coordinador.length, 1);
    assert.equal(e.llamadas.consultas.length, 1);
    assert.match(e.html(), /Tinaja Tonel/);
    assert.match(e.html(), /Servicios del día.*?<strong>1<\/strong>/s);
    assert.doesNotMatch(e.html(), /No fue posible comprobar los servicios/);
    assert.equal(e.campoResumen.value, 'sin tocar');
});

test('Resumen prepara servicios sin publicar parcialmente; Servicios usa la misma consulta y renderiza', async () => {
    const e = entorno();
    const fuente = e.fuentes.get('servicios');
    assert.ok(fuente);
    const preparada = await fuente.preparar({ fecha: hoy });
    assert.equal(preparada.length, 1);
    assert.equal(e.campoResumen.value, 'sin tocar');
    assert.equal(e.contexto.serviciosRegistrados.length, 0);
    assert.equal(e.html().includes('Tinaja Tonel'), false);

    const derivada = await e.window.HAIKU_SERVICIOS_HIDRATACION_V2.sincronizar('focus', 'resumen');
    assert.equal(derivada, true);
    assert.equal(e.llamadas.consultas.length, 1);
    assert.equal(e.llamadas.coordinador[0].origen.tipo, 'interno_derivado');

    const lista = await e.window.HAIKU_SITES_SERVICIOS_V1.refrescar();
    assert.equal(lista, undefined); // La API Sites renderiza; el productor devuelve la lista.
    const directa = await e.window.haikuSincronizarServiciosDesdeSupabase();
    assert.equal(Array.isArray(directa), true);
    assert.equal(directa.length, 1);
    assert.equal(e.contexto.serviciosRegistrados[0].id, 'servicio-1');
    assert.match(e.html(), /Tinaja Tonel/);
    assert.match(e.html(), /Huésped real/);
    assert.match(e.html(), /Servicios del día.*?<strong>1<\/strong>/s);
    assert.match(e.html(), /Pendientes de pago.*?<strong>1<\/strong>/s);
    assert.match(e.html(), /Tinaja Tonel.*?Libre/s);
    assert.match(e.html(), /Agenda del día/);
    assert.match(e.html(), /Consumos adicionales/);
    assert.match(e.html(), /Marcar realizado/);
    assert.equal(e.campoResumen.value, 'sin tocar');
    assert.equal(e.llamadas.resumen, 0);
    assert.equal(e.llamadas.finanzas, 2);
    assert.equal(e.escuchas('haiku:servicios-hidratados'), 1);

    fuente.publicar({ fecha: hoy, datos: { servicios: preparada } });
    assert.equal(e.campoResumen.value.includes('Tinaja Tonel'), true);
    assert.equal(e.llamadas.resumen > 0, true);
});

test('Servicios refresca y Realtime actualiza sin duplicar listeners; Resumen conserva origen externo', async () => {
    const e = entorno();
    await e.window.HAIKU_SITES_SERVICIOS_V1.refrescar();
    e.setFilas([servicio('servicio-1'), servicio('servicio-2', {
        hora_inicio: '20:15:00', catalogo_servicios: {
            codigo: 'masaje', categoria: 'masaje', nombre: 'Masaje', duracion_minutos: 60
        }
    })]);
    await e.window.HAIKU_SITES_SERVICIOS_V1.refrescar();
    assert.match(e.html(), /Masaje/);
    assert.match(e.html(), /Servicios del día.*?<strong>2<\/strong>/s);
    assert.equal(e.llamadas.consultas.length, 2);

    e.setFilas([servicio('servicio-3', { catalogo_servicios: {
        codigo: 'jacuzzi', categoria: 'tinaja', nombre: 'Tinaja Jacuzzi', duracion_minutos: 60
    } })]);
    e.emitir('haiku:servicio-supabase-cambiado');
    await e.temporizadoresHasta(100);
    assert.match(e.html(), /Tinaja Jacuzzi/);
    assert.equal(e.llamadas.consultas.length, 3);
    assert.equal(e.llamadas.coordinador.at(-1).origen.tipo, 'externo');
    assert.equal(e.escuchas('haiku:servicio-supabase-cambiado'), 2);
    assert.equal(e.escuchas('haiku:servicios-hidratados'), 1);
    assert.equal(e.nodos.get('sites-servicios-root').listeners.click.length, 1);
    assert.equal(e.campoResumen.value, 'sin tocar');
});

test('un fallo real de la consulta conserva el error de Servicios', async () => {
    const e = entorno({ fallo: new Error('falló select servicios') });
    await e.window.HAIKU_SITES_SERVICIOS_V1.refrescar();
    assert.match(e.html(), /No fue posible comprobar los servicios\. Vuelve a intentar\./);
    assert.equal(e.llamadas.consultas.length, 1);
    assert.equal(e.llamadas.errores[0][1].message, 'falló select servicios');
    await assert.rejects(e.fuentes.get('servicios').preparar({ fecha: hoy }),
        /falló select servicios/);
});
