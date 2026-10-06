const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../js/haiku-libro-semantica-v1.js');
const tarifaFullDay = require('../js/haiku-fullday-tarifa-v1.js');

const leer = nombre => fs.readFileSync(require.resolve(`../js/${nombre}`), 'utf8');
const consultas = leer('haiku-libro-consultas-v1.js');
const datos = leer('supabase-data.js');
const RESERVA = '46c3428a-3a4a-48a9-bafd-fa359fc8ef72';
const ESTADIA = 'a2cab260-4ad4-402a-bd05-919fdda1893b';
const FECHA = '2026-10-06';
const fuentes = ['reservas', 'servicios', 'pagos', 'checkout', 'checkoutAutoridad',
    'operacion', 'autoridadVisual', 'tablero'];
const tick = () => new Promise(resolve => setImmediate(resolve));
function diferida() {
    let resolver;
    const promesa = new Promise(resolve => { resolver = resolve; });
    return { promesa, resolver };
}

class El {
    constructor(tag) {
        this.tag = tag; this.tagName = tag.toUpperCase(); this.textContent = '';
        this.children = []; this.style = {}; this.events = {}; this.dataset = {};
        this.selectedIndex = 0; this.campos = new Map();
    }
    append(...xs) { this.children.push(...xs); }
    appendChild(x) { this.append(x); return x; }
    replaceChildren(...xs) { this.children = xs; }
    addEventListener(k, f) { this.events[k] = f; }
    setAttribute(k, v) { this[k] = v; }
    getAttribute(k) { return this[k]; }
    removeAttribute(k) { delete this[k]; }
    get options() { return this.children; }
    get text() { return this.textContent; }
    focus() {}
    closest() { return null; }
    click() { assert.fail('El flujo del Libro no debe hacer fake clicks'); }
    querySelectorAll(s) {
        return this.children.flatMap(e => [e, ...e.querySelectorAll('*')]).filter(e =>
            s === '*' || s === e.tag || s === 'details[open]' && e.tag === 'details' && e.open ||
            s.startsWith('.') && (e.className || '').split(' ').includes(s.slice(1)));
    }
    querySelector(s) {
        if (this.esDrawer && !this.campos.has(s)) this.campos.set(s, new El('span'));
        return this.campos.get(s) || this.querySelectorAll(s)[0] || null;
    }
}

// Usa el flujo UI real, el coordinador real y los productores de identidad reales.
// Todos los accesos de red son mocks en memoria; no hay conexión a Supabase.
function entorno({ fechaVisible = FECHA, confirmar = true, delegar = false,
    fallarLegacy = false, bloquearPagos = null, fallarOperacion = false,
    coordinador = true, activo = true } = {}) {
    const eventos = [], escritura = diferida();
    let guardado = false, fecha = fechaVisible, generacionLibro = 1, lecturasFicha = 0;
    const out = new El('div'), fila = new El('article'), botonFicha = new El('button');
    fila.dataset.cabana = '2';
    const estado = new El('select'); estado.value = 'libre-libre';
    fila.campos.set('[data-campo="estado"]', estado);
    fila.campos.set('[data-ficha-cabana]', botonFicha);
    botonFicha.closest = selector => selector.startsWith('.sites-resumen-cabana') ? fila : null;
    const estadoRefresh = new El('p'), tituloFecha = new El('h2');
    const documento = {
        readyState: activo ? 'complete' : 'loading',
        documentElement: { classList: { add() {}, remove() {} } },
        body: { style: {}, appendChild(x) { eventos.push('drawer'); } },
        createElement: t => new El(t), addEventListener() {},
        getElementById: id => ({ 'resumen-refresh-estado': estadoRefresh, 'fecha-actual': tituloFecha }[id] || null),
        querySelectorAll: s => s.includes('.sites-resumen-cabana') ? [fila] : [],
        querySelector: s => s.includes('.sites-resumen-cabana') ? fila : null
    };
    const estadia = { id: ESTADIA, reserva_id: RESERVA, cabana_numero: 2,
        adultos: 2, ninos: 0, mascotas: 0, fecha_ingreso: FECHA, fecha_salida: FECHA,
        tipo_estadia: 'fullday', estado_estadia: 'confirmada' };
    const ficha = {
        reserva: { id: RESERVA, titular_nombre: 'Mery Vasquez Carrion',
            estado_reserva: 'confirmada', codigo_haiku: 'H-20261006-02', observaciones: '' },
        estadias: [estadia], huespedes: [], servicios: [], notas: [], solicitudes: [], boves: [],
        cargos: [{ estado: 'activo', tipo_cargo: 'fullday', monto: 120000, saldo_cargo: 0 }],
        pagos: [{ estado_pago: 'confirmado', monto: 120000 }]
    };
    const cliente = {
        auth: { getSession: async () => ({ data: { session: { user: { id: 'usuario' } } } }) },
        from(tabla) {
            const rows = tabla === 'reserva_estadias' && guardado ? [estadia] : [];
            const b = { select() { return b; }, lte() { return b; }, gte() { return b; },
                in() { return b; }, order() { return b; },
                range(a, z) { return Promise.resolve({ data: rows.slice(a, z + 1) }); },
                then(resolve, reject) { return Promise.resolve({ data: rows }).then(resolve, reject); } };
            return b;
        },
        async rpc(nombre, args) {
            if (nombre === 'haiku_incorporar_libro_v1') {
                eventos.push('escritura solicitada');
                assert.equal(args.p_items[0].tipo, 'reserva_nueva');
                const respuesta = await escritura.promesa;
                guardado = respuesta.data?.ok === true && !respuesta.error;
                eventos.push(guardado ? 'escritura confirmada' : 'escritura fallida');
                return respuesta;
            }
            assert.equal(nombre, 'haiku_operacion_dia');
            eventos.push(`operacion:${args.p_fecha}`);
            if (fallarOperacion) throw new Error('Operación no disponible');
            return { data: [{ numero: 2, estado_operativo: guardado && args.p_fecha === FECHA ? 'fullday' : 'libre-libre',
                ...(guardado && args.p_fecha === FECHA ? { fullday_reserva_id: RESERVA,
                    fullday_estadia_id: ESTADIA, fullday_titular: 'Mery Vasquez Carrion' } : {}) }] };
        }
    };
    const ventana = {
        haikuSesion: null, haikuSupabase: cliente, HAIKU_LIBRO_SEMANTICA: S,
        HAIKU_FULLDAY_TARIFA_V1: tarifaFullDay,
        HAIKU_LIBRO_RESERVA_V1: { estado: () => ({ generacion: generacionLibro }) },
        haikuTienePermiso: () => true, confirm: () => confirmar,
        addEventListener() {}, document: documento,
        haikuLeerFichaSupabaseV2: async id => {
            assert.equal(id, RESERVA); assert.equal(guardado, true);
            lecturasFicha++; return ficha;
        }
    };
    const contexto = vm.createContext({ window: ventana, document: documento,
        structuredClone, queueMicrotask, Date, Intl, console: { warn() {}, error() {} },
        get fechaSeleccionada() { return fecha; },
        set fechaSeleccionada(v) { assert.fail(`No debe cambiar fechaSeleccionada a ${v}`); },
        Option: function(t, v) { const e = new El('option'); e.textContent = t; e.value = v; return e; }
    });
    // Aísla las funciones privadas del productor de operación sin reemplazarlas.
    function bloque(inicio, fin) {
        const a = datos.indexOf(inicio), b = datos.indexOf(fin, a);
        assert.ok(a >= 0 && b > a);
        vm.runInContext(datos.slice(a, b), contexto);
    }
    contexto.cliente = cliente; contexto.identidadDia = {}; contexto.ultimoDiaCargado = '';
    bloque('    function normalizarFecha', '    async function cargarContadoresRelacionados');
    bloque('    async function prepararOperacionResumen', '    // Proyección de identidad');
    if (coordinador) {
        vm.runInContext(leer('supabase-resumen-refresh-v1.js'), contexto);
        const api = ventana.HAIKU_RESUMEN_REFRESH_V1;
        fuentes.forEach((nombre, orden) => api.registrar(nombre, {
            orden,
            preparar: async solicitud => {
                eventos.push(`preparar:${nombre}:${solicitud.generacion}:${solicitud.fecha}`);
                if (nombre === 'pagos' && bloquearPagos) await bloquearPagos(solicitud);
                return nombre === 'operacion' ? contexto.prepararOperacionResumen(solicitud) : {};
            },
            publicar: snapshot => {
                eventos.push(`publicar:${nombre}:${snapshot.generacion}`);
                if (nombre === 'operacion') contexto.publicarOperacionResumen(snapshot);
            }
        }));
        fila.dataset = new Proxy(fila.dataset, {
            set(obj, clave, valor) {
                if (/^resumen(?:Fecha|ReservaId|EstadiaId)$/.test(clave)) {
                    assert.equal(api.publicando(), true, 'Sólo el productor oficial publica identidades');
                }
                obj[clave] = valor; return true;
            }
        });
    }
    ventana.haikuSesion = { auth: { id: 'usuario' } };
    const legacy = nombre => async () => {
        eventos.push(`legacy:${nombre}`);
        if (fallarLegacy) throw new Error(`Fallo en ${nombre}`);
        if (delegar && nombre === 'reservas') return ventana.HAIKU_RESUMEN_REFRESH_V1.solicitar(undefined,
            { categoria: 'reservas', evento: 'refresh explícito reservas', tipo: 'externo' });
    };
    ventana.haikuSincronizarReservasSupabase = legacy('reservas');
    ventana.haikuCargarAbonosSupabase = legacy('abonos');
    ventana.haikuCargarSaldosCheckinSupabase = legacy('saldos');
    vm.runInContext(consultas, contexto);
    return { eventos, escritura, contexto, ventana, out, fila, botonFicha, estadoRefresh,
        api: ventana.HAIKU_RESUMEN_REFRESH_V1,
        get fecha() { return fecha; }, get lecturasFicha() { return lecturasFicha; },
        cambiarFecha(v) { fecha = v; }, cambiarLibro() { generacionLibro++; },
        async preparar() {
            const r = { id: 'Oct26!CAB2', titular: 'Mery Vasquez Carrion', cabana: 2,
                fecha_checkin: FECHA, fecha_checkout: FECHA, tipo_estadia: 'full_day', noches: 0,
                adultos: 2, ninos: 0, mascotas: 0, rut_documento: '12345678-9',
                correo: 'prueba@example.test', telefono: '+56912345678', pagos: [],
                pagos_sin_asociacion: [], servicios: [], advertencias: [], notas_importantes: [],
                coordenadas_origen: { hoja: 'Oct26', celda: 'CAB2' } };
            await ventana.HAIKU_LIBRO_CONSULTAS.abrirComparacionEstructurada(out, { reservas: [r], generacion: 1 });
            const preparar = out.querySelectorAll('button').find(x => x.textContent === 'Preparar incorporación');
            assert.ok(preparar); await preparar.events.click();
            const continuar = out.querySelectorAll('button').find(x => /^Continuar con/.test(x.textContent));
            assert.ok(continuar, out.querySelectorAll('*').map(x => x.textContent).join(' '));
            assert.equal(continuar.disabled, false);
            return () => continuar.events.click();
        },
        montarFicha() {
            vm.runInContext(leer('supabase-finanzas-resumen-v1.js'), contexto);
            vm.runInContext(leer('sites-resumen-reserva-v1.js'), contexto);
            const crear = documento.createElement;
            documento.createElement = t => { const e = crear(t); if (t === 'div') e.esDrawer = true; return e; };
            return ventana.HAIKU_RESUMEN_RESERVA_SITES_V1;
        }
    };
}

const exito = () => ({ data: { ok: true, reservas_creadas: 1 } });
const texto = h => h.out.querySelectorAll('*').map(x => x.textContent).join(' ');

test('confirmación real precede a los refresh; la publicación hidrata UUID y permite abrir ficha sin F5', async () => {
    const pagos = diferida(), h = entorno({ bloquearPagos: () => pagos.promesa });
    const confirmar = await h.preparar(), apiFicha = h.montarFicha();
    assert.equal(await apiFicha.abrirDesdeBoton(h.botonFicha), false, 'Reproduce la fila aún sin identidad');
    const ejecucion = confirmar(); await tick();
    assert.deepEqual(h.eventos.filter(x => x.startsWith('legacy:')), []);
    assert.equal(h.api.historialGeneraciones().length, 0);
    h.escritura.resolver(exito()); await tick();
    assert.deepEqual(h.eventos.filter(x => x.startsWith('legacy:')),
        ['legacy:reservas', 'legacy:abonos', 'legacy:saldos']);
    const confirmada = h.eventos.indexOf('escritura confirmada');
    assert.ok(confirmada >= 0);
    assert.ok(h.eventos.findIndex(x => x.startsWith('preparar:')) > confirmada);
    assert.ok(h.eventos.findIndex(x => x.startsWith('preparar:')) > h.eventos.indexOf('legacy:saldos'));
    assert.equal(h.api.publicaciones(), 0, 'No publica antes de completar todas las fuentes');
    assert.equal(h.fila.dataset.resumenReservaId, undefined);
    pagos.resolver(); await ejecucion;
    assert.equal(h.api.publicaciones(), 1);
    assert.equal(h.api.ultimo().fecha, FECHA); assert.equal(h.fecha, FECHA);
    assert.equal(h.fila.dataset.resumenReservaId, RESERVA);
    assert.equal(h.fila.dataset.resumenEstadiaId, ESTADIA);
    assert.equal(h.fila.dataset.resumenFecha, FECHA);
    assert.equal(h.fila.querySelector('[data-campo="estado"]').value, 'fullday');
    assert.equal(await apiFicha.abrirDesdeBoton(h.botonFicha), true);
    assert.equal(h.lecturasFicha, 1);
    assert.match(texto(h), /Incorporación completada/);
});

for (const [nombre, respuesta] of [
    ['RPC fallido', { error: new Error('Escritura rechazada') }],
    ['respuesta sin confirmación', { data: { ok: false } }]
]) test(`${nombre} no solicita ni publica Resumen ni ejecuta sincronizaciones`, async () => {
    const h = entorno(), confirmar = await h.preparar();
    h.escritura.resolver(respuesta); await confirmar();
    assert.equal(h.api.historialGeneraciones().length, 0);
    assert.equal(h.api.publicaciones(), 0);
    assert.deepEqual(h.eventos.filter(x => x.startsWith('legacy:')), []);
    assert.doesNotMatch(texto(h), /Incorporación completada/);
    assert.match(texto(h), /No se pudo confirmar/);
});

test('confirmación cancelada no escribe ni refresca', async () => {
    const h = entorno({ confirmar: false }), confirmar = await h.preparar();
    await confirmar();
    assert.deepEqual(h.eventos, []); assert.equal(h.api.publicaciones(), 0);
});

test('Libro invalidado antes de confirmar aborta sin publicación', async () => {
    const h = entorno(), confirmar = await h.preparar(); h.cambiarLibro();
    await confirmar(); assert.deepEqual(h.eventos, []);
    assert.equal(h.api.historialGeneraciones().length, 0);
    assert.doesNotMatch(texto(h), /Incorporación completada/);
});

test('incorporar otro día refresca únicamente la fecha visible y Calendario conserva abrirPorId', async () => {
    const h = entorno({ fechaVisible: '2026-10-07' }), confirmar = await h.preparar();
    h.escritura.resolver(exito()); await confirmar();
    assert.equal(h.fecha, '2026-10-07'); assert.equal(h.api.ultimo().fecha, '2026-10-07');
    assert.equal(h.fila.dataset.resumenReservaId, ''); assert.equal(h.fila.dataset.resumenEstadiaId, '');
    const apiFicha = h.montarFicha();
    assert.equal(await apiFicha.abrirPorId(RESERVA, h.botonFicha, { estadiaId: ESTADIA, numeroCabana: 2 }), true);
});

test('si se navega durante la escritura, el refresh usa la fecha operativa actual', async () => {
    const h = entorno(), confirmar = await h.preparar(), ejecucion = confirmar(); await tick();
    h.cambiarFecha('2026-10-07'); h.escritura.resolver(exito()); await ejecucion;
    assert.equal(h.api.ultimo().fecha, '2026-10-07'); assert.equal(h.fecha, '2026-10-07');
});

test('una sincronización indirecta previa no reemplaza la solicitud explícita nueva del Libro', async () => {
    const h = entorno({ delegar: true }), confirmar = await h.preparar();
    h.escritura.resolver(exito()); await confirmar();
    const historial = h.api.historialGeneraciones();
    assert.equal(historial.length, 2); assert.equal(historial[0].categoria, 'reservas');
    assert.equal(historial[1].categoria, 'Libro'); assert.equal(historial[1].tipo, 'externo');
    assert.equal(historial[1].resultado, 'PUBLICADA'); assert.equal(h.api.ultimo().generacion, 2);
});

test('una generación anterior a la escritura es sustituida y nunca deshidrata la fila nueva', async () => {
    const pendiente = diferida(), h = entorno({ bloquearPagos: s => s.generacion === 1 ? pendiente.promesa : undefined });
    const confirmar = await h.preparar(), vieja = h.api.solicitar(); await tick();
    h.escritura.resolver(exito()); await confirmar();
    assert.equal(h.api.ultimo().generacion, 2); assert.equal(h.api.publicaciones(), 1);
    pendiente.resolver(); assert.equal(await vieja, false);
    assert.equal(h.api.publicaciones(), 1); assert.equal(h.fila.dataset.resumenReservaId, RESERVA);
});

test('un fallo en los refresh legacy conserva las tres llamadas y la solicitud oficial', async () => {
    const h = entorno({ fallarLegacy: true }), confirmar = await h.preparar();
    h.escritura.resolver(exito()); await confirmar();
    assert.equal(h.eventos.filter(x => x.startsWith('legacy:')).length, 3);
    assert.equal(h.api.publicaciones(), 1); assert.equal(h.fila.dataset.resumenEstadiaId, ESTADIA);
});

test('una lectura incompleta no publica identidades ni convierte la escritura confirmada en fallida', async () => {
    const h = entorno({ fallarOperacion: true }), confirmar = await h.preparar();
    h.escritura.resolver(exito()); await confirmar();
    assert.equal(h.api.publicaciones(), 0);
    assert.equal(h.api.historialGeneraciones()[0].resultado, 'NO PUBLICADA');
    assert.equal(h.fila.dataset.resumenReservaId, undefined);
    assert.match(texto(h), /Incorporación completada/);
    assert.match(h.estadoRefresh.textContent, /No fue posible cargar el Resumen/);
});

for (const opciones of [{ coordinador: false }, { activo: false }]) {
    test(`coordinador ${opciones.coordinador === false ? 'ausente' : 'inactivo'} conserva el cierre y los refresh existentes`, async () => {
        const h = entorno(opciones), confirmar = await h.preparar();
        h.escritura.resolver(exito()); await confirmar();
        assert.equal(h.eventos.filter(x => x.startsWith('legacy:')).length, 3);
        assert.match(texto(h), /Incorporación completada/);
        assert.equal(h.api?.historialGeneraciones().length || 0, 0);
    });
}

test('el cierre posterior a la escritura usa sólo el coordinador, sin fecha, clicks, timers ni identidad manual', () => {
    const a = consultas.indexOf('const ejecucion = await incorporar(plan);');
    const b = consultas.indexOf('if (ejecucion.siguientePlan)', a);
    assert.ok(a >= 0 && b > a);
    const cierre = consultas.slice(a, b);
    assert.doesNotMatch(cierre, /fechaSeleccionada|\.click\s*\(|dispatchEvent|setTimeout|setInterval|dataset|setAttribute|data-resumen-/);
    assert.match(cierre, /HAIKU_RESUMEN_REFRESH_V1/);
});
