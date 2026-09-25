const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const leer = nombre => fs.readFileSync(path.join(__dirname, '..', 'js', nombre), 'utf8');

function instalarCargaRealDeCabanas(contexto) {
    const codigo = leer('cabanas.js');
    const inicio = codigo.indexOf('function cargarCabanasDia(fecha, origen = ');
    const fin = codigo.indexOf('    const datos = obtenerDatosDia(fecha);', inicio);
    assert.ok(inicio >= 0 && fin > inicio, 'se encuentra la ruta activa real de cabañas');
    vm.runInContext(`${codigo.slice(inicio, fin)}\n}\nwindow.cargarCabanasDia = cargarCabanasDia;`,
        contexto);
}

test('checkout DOM y click diferido se clasifican como internos; realtime como externo', async () => {
    const solicitudes = [];
    const escuchas = new Map();
    const escuchasWindow = new Map();
    const realtime = new Map();
    const observadores = [];
    const lista = { addEventListener() {} };
    const checkout = {};
    const document = {
        readyState: 'complete',
        addEventListener(nombre, fn) {
            const callbacks = escuchas.get(nombre) || [];
            callbacks.push(fn);
            escuchas.set(nombre, callbacks);
        },
        querySelector(selector) {
            return selector === '#seccion-resumen .sites-resumen-lista' ? lista : null;
        },
        getElementById(id) { return id === 'pagos-lista-checkout' ? checkout : null; }
    };
    const coordinador = {
        activo: () => true,
        publicando: () => false,
        ultimo: () => ({ fecha: '2026-09-25' }),
        registrar() {},
        solicitar(fecha, origen) {
            solicitudes.push({ fecha: fecha || contexto.fechaSeleccionada, origen });
            return Promise.resolve(true);
        }
    };
    const window = {
        HAIKU_RESUMEN_REFRESH_V1: coordinador,
        haikuSesion: null,
        haikuSupabase: { channel: () => ({
            on(_tipo, filtro, callback) {
                realtime.set(filtro.table, callback);
                return this;
            },
            subscribe() { return this; }
        }) },
        addEventListener(nombre, fn) { escuchasWindow.set(nombre, fn); }
    };
    const contexto = vm.createContext({ window, document, console,
        fechaSeleccionada: '2026-09-25',
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observadores.push(this); }
            observe(nodo) { this.nodo = nodo; }
        },
        setTimeout, clearTimeout, requestAnimationFrame() {}
    });
    vm.runInContext(leer('supabase-resumen-tablero-v1.js'), contexto);
    vm.runInContext(leer('supabase-pagos-pendientes-v1.js'), contexto);
    window.haikuSesion = { auth: { id: 'usuario' } };
    escuchasWindow.get('haiku:auth-ready')();
    solicitudes.length = 0;

    // Reproduce el orden de callbacks de un clic: MutationObserver corre en
    // microtarea y el detector de Pagos en setTimeout(0).
    contexto.fechaSeleccionada = '2026-09-24';
    observadores.find(item => item.nodo === checkout).callback();
    (escuchas.get('click') || []).forEach(fn => fn({ target: {
        closest: selector => selector.includes('#resumen-dia-anterior') ? {} : null
    } }));
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.equal(solicitudes.length, 2);
    assert.deepEqual(solicitudes.map(item => item.fecha),
        ['2026-09-24', '2026-09-24']);
    assert.equal(solicitudes[0].origen.evento,
        'MutationObserver pagos-lista-checkout');
    assert.equal(solicitudes[1].origen.evento, 'click document delayed');
    assert.equal(solicitudes[0].origen.tipo, 'interno_derivado');
    assert.equal(solicitudes[1].origen.tipo, 'interno_derivado');

    // El detector genérico de clicks sólo sincroniza la fecha; la escritura
    // real pide refresh mediante su API explícita o Realtime.
    (escuchas.get('click') || []).forEach(fn => fn({ target: {
        closest: () => null
    } }));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(solicitudes.length, 3);
    assert.equal(solicitudes[2].origen.evento, 'click document delayed');
    assert.equal(solicitudes[2].origen.tipo, 'interno_derivado');

    await window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1.refrescar('2026-09-24', {
        evento: 'acción de pago confirmada', tipo: 'externo'
    });
    assert.equal(solicitudes.length, 4);
    assert.equal(solicitudes[3].origen.tipo, 'externo');

    realtime.get('pagos')();
    await new Promise(resolve => setTimeout(resolve, 140));
    assert.equal(solicitudes.length, 5);
    assert.equal(solicitudes[4].fecha, '2026-09-24');
    assert.equal(solicitudes[4].origen.evento, 'realtime pagos');
    assert.equal(solicitudes[4].origen.tipo, 'externo');

    // Un focus posterior no puede cancelar el refresh externo pendiente.
    realtime.get('pagos')();
    escuchasWindow.get('focus')();
    await new Promise(resolve => setTimeout(resolve, 140));
    assert.equal(solicitudes.length, 6);
    assert.equal(solicitudes[5].origen.evento, 'realtime pagos');
    assert.equal(solicitudes[5].origen.tipo, 'externo');

    // Una nueva fecha solicitada explícitamente sigue entrando al coordinador.
    contexto.fechaSeleccionada = '2026-09-25';
    await coordinador.solicitar('2026-09-25', {
        categoria: 'navegación usuario', evento: 'Día siguiente'
    });
    assert.equal(solicitudes.length, 7);
    assert.equal(solicitudes[6].origen.categoria, 'navegación usuario');
});

test('cargarCabanasDia real y su envoltorio son derivados; escritura y refresh explícito siguen externos', async () => {
    const solicitudes = [];
    const lista = { addEventListener() {} };
    const document = {
        readyState: 'complete', addEventListener() {},
        querySelector(selector) {
            return selector === '#seccion-resumen .sites-resumen-lista' ? lista : null;
        },
        getElementById() { return null; }
    };
    const window = {
        HAIKU_RESUMEN_REFRESH_V1: {
            activo: () => true, publicando: () => false, ultimo: () => null,
            registrar() {}, solicitar(fecha, origen) {
                solicitudes.push({ fecha, origen });
                return Promise.resolve(true);
            }
        },
        haikuSupabase: { rpc: async () => ({ data: [], error: null }) },
        addEventListener() {}
    };
    const contexto = vm.createContext({ window, document, console,
        fechaSeleccionada: '2026-09-25',
        MutationObserver: class { observe() {} },
        setTimeout, clearTimeout, requestAnimationFrame() {}
    });
    instalarCargaRealDeCabanas(contexto);
    vm.runInContext(leer('supabase-resumen-tablero-v1.js'), contexto);
    assert.deepEqual(solicitudes.map(item =>
        [item.origen.categoria, item.origen.evento, item.origen.tipo]), [
        ['tablero', 'programarActualizacion', 'interno_derivado']
    ]);
    solicitudes.length = 0;

    window.cargarCabanasDia('2026-09-25');
    assert.deepEqual(solicitudes.map(item =>
        [item.fecha, item.origen.categoria, item.origen.evento, item.origen.tipo]), [
        ['2026-09-25', 'cabañas', 'cargarCabanasDia', 'interno_derivado'],
        ['2026-09-25', 'tablero', 'cargarCabanasDia envuelto', 'interno_derivado']
    ]);

    window.cargarCabanasDia('2026-09-25', {
        evento: 'escritura confirmada', tipo: 'externo'
    });
    assert.equal(solicitudes[2].origen.tipo, 'externo');
    assert.equal(solicitudes[3].origen.tipo, 'interno_derivado');
    window.HAIKU_RESUMEN_SITES_V1.refrescar();
    assert.equal(solicitudes[4].origen.tipo, 'externo');
});

test('navegación absorbe todos los productores derivados y publica T3/T4/T5', async () => {
    const escuchas = new Map();
    const escuchasWindow = new Map();
    const observadores = [];
    const lista = { addEventListener() {} };
    const checkout = {};
    const elementos = new Map([
        ['pagos-lista-checkout', checkout],
        ['resumen-refresh-estado', { textContent: '' }],
        ['fecha-actual', { textContent: '' }]
    ]);
    const document = {
        readyState: 'complete',
        documentElement: { classList: { add() {}, remove() {} } },
        addEventListener(nombre, fn) {
            const callbacks = escuchas.get(nombre) || [];
            callbacks.push(fn);
            escuchas.set(nombre, callbacks);
        },
        querySelector(selector) {
            return selector === '#seccion-resumen .sites-resumen-lista' ? lista : null;
        },
        querySelectorAll() { return []; },
        getElementById(id) { return elementos.get(id) || null; }
    };
    const window = {
        haikuSesion: null,
        haikuSupabase: { rpc: async () => ({ data: [], error: null }) },
        addEventListener(nombre, fn) {
            const callbacks = escuchasWindow.get(nombre) || [];
            callbacks.push(fn);
            escuchasWindow.set(nombre, callbacks);
        }
    };
    const contexto = vm.createContext({ window, document, console,
        fechaSeleccionada: '2026-09-25', Date, Intl, performance,
        queueMicrotask, setTimeout, clearTimeout,
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observadores.push(this); }
            observe(nodo) { this.nodo = nodo; }
        }
    });
    vm.runInContext(leer('supabase-resumen-refresh-v1.js'), contexto);
    instalarCargaRealDeCabanas(contexto);
    vm.runInContext(leer('supabase-resumen-tablero-v1.js'), contexto);
    vm.runInContext(leer('supabase-pagos-pendientes-v1.js'), contexto);
    const api = window.HAIKU_RESUMEN_REFRESH_V1;
    const resolverReserva = new Map();
    for (const nombre of ['reservas', 'servicios', 'checkout', 'checkoutAutoridad',
        'operacion', 'autoridadVisual', 'notas', 'aseo', 'revision']) {
        api.registrar(nombre, {
            preparar: ({ fecha, generacion }) => nombre === 'reservas' && fecha === '2026-09-24'
                ? new Promise(resolve => { resolverReserva.set(generacion, resolve); })
                : nombre === 'operacion' ? { filas: [] } : true,
            publicar() {}
        });
    }
    window.haikuSesion = { auth: { id: 'usuario' } };
    assert.equal(await api.solicitar('2026-09-25'), true);
    window.haikuSesion = null;
    const codigoNotas = leer('supabase-notas-resumen-v1.js');
    vm.runInContext(codigoNotas.slice(0,
        codigoNotas.indexOf('// Carga desacoplada')), contexto);
    window.haikuSesion = { auth: { id: 'usuario' } };
    contexto.fechaSeleccionada = '2026-09-24';
    const navegacion = api.solicitar('2026-09-24', {
        categoria: 'navegación usuario', evento: 'Día anterior'
    });
    await Promise.resolve();
    window.cargarCabanasDia('2026-09-24');
    observadores.find(item => item.nodo === checkout).callback();
    (escuchas.get('click') || []).forEach(fn => fn({ target: {
        closest: selector => selector.includes('#resumen-dia-anterior') ? {} : null
    } }));
    await new Promise(resolve => setTimeout(resolve, 10));
    (escuchasWindow.get('focus') || []).forEach(fn => fn());
    await new Promise(resolve => setTimeout(resolve, 10));
    const derivados = [
        ['revisión', 'sincronización derivada'],
        ['aseo', 'sincronización derivada'],
        ['autoridad visual', 'rehidratación visual derivada'],
        ['checkout', 'abrir Resumen'],
        ['checkout autoridad', 'focus checkout autoridad'],
        ['servicios', 'focus']
    ];
    for (const [categoria, evento] of derivados) {
        assert.equal(await api.solicitar('2026-09-24', {
            categoria, evento, tipo: 'interno_derivado'
        }), true);
    }
    const generacionesB = api.historialGeneraciones().filter(item =>
        item.generacion && item.fecha === '2026-09-24');
    assert.equal(generacionesB.length, 1);
    assert.equal(generacionesB[0].evento, 'Día anterior');
    assert.deepEqual(Array.from(api.solicitudesCoalescidas(), item =>
        [item.categoria, item.evento]), [
        ['cabañas', 'cargarCabanasDia'],
        ['tablero', 'cargarCabanasDia envuelto'],
        ['tablero', 'MutationObserver pagos-lista-checkout'],
        ['pagos', 'click document delayed'],
        ['notas', 'click document delayed'],
        ['notas', 'focus'],
        ['pagos', 'focus'],
        ...derivados
    ]);
    assert.equal(api.ultimo().fecha, '2026-09-25');
    assert.equal(api.publicaciones(), 1);
    resolverReserva.forEach(resolver => resolver(true));
    assert.equal(await navegacion, true);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(api.ultimo().fecha, '2026-09-24');
    const id = api.ultimo().generacion;
    assert.equal(id, generacionesB[0].generacion);
    assert.equal(api.publicaciones(), 2);
    const publicada = api.historialGeneraciones().find(item => item.generacion === id);
    assert.ok(publicada.t3 && publicada.t4 && publicada.t5);
    assert.ok(Date.parse(publicada.t3) <= Date.parse(publicada.t4));
    assert.ok(Date.parse(publicada.t4) <= Date.parse(publicada.t5));
});

test('primera carga absorbe cabañas y tablero sin reiniciar generación ni loading', async () => {
    const lista = { addEventListener() {} };
    let finalizacionesCarga = 0;
    const document = {
        readyState: 'complete',
        documentElement: { classList: {
            add() {}, remove() { finalizacionesCarga++; }
        } },
        addEventListener() {},
        querySelector(selector) {
            return selector === '#seccion-resumen .sites-resumen-lista' ? lista : null;
        },
        querySelectorAll() { return []; },
        getElementById() { return null; }
    };
    const window = {
        haikuSesion: { auth: { id: 'usuario' } },
        haikuSupabase: { rpc: async () => ({ data: [], error: null }) },
        addEventListener() {}
    };
    const contexto = vm.createContext({ window, document, console,
        fechaSeleccionada: '2026-09-25', Date, Intl, performance,
        queueMicrotask, setTimeout, clearTimeout,
        MutationObserver: class { observe() {} }
    });
    vm.runInContext(leer('supabase-resumen-refresh-v1.js'), contexto);
    instalarCargaRealDeCabanas(contexto);
    vm.runInContext(leer('supabase-resumen-tablero-v1.js'), contexto);
    const api = window.HAIKU_RESUMEN_REFRESH_V1;
    let resolverReservas;
    let lecturasReservas = 0;
    for (const nombre of ['servicios', 'pagos', 'checkout', 'checkoutAutoridad',
        'operacion', 'autoridadVisual', 'reservas']) {
        api.registrar(nombre, {
            preparar: () => nombre === 'reservas' && ++lecturasReservas === 1
                ? new Promise(resolve => { resolverReservas = resolve; })
                : nombre === 'pagos' ? { cargos: [] }
                    : nombre === 'operacion' ? { filas: [] } : true,
            publicar() {}
        });
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    const enCurso = api.historialGeneraciones().filter(item => item.generacion);
    assert.equal(enCurso.length, 1);
    assert.equal(enCurso[0].categoria, 'primera carga');
    assert.equal(api.enCurso(), true);
    window.cargarCabanasDia('2026-09-25');
    assert.equal(api.historialGeneraciones().filter(item => item.generacion).length, 1);
    assert.deepEqual(Array.from(api.solicitudesCoalescidas(), item =>
        [item.categoria, item.evento]), [
        ['cabañas', 'cargarCabanasDia'],
        ['tablero', 'cargarCabanasDia envuelto']
    ]);
    assert.equal(api.publicaciones(), 0);
    resolverReservas(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(api.ultimo().fecha, '2026-09-25');
    assert.equal(api.publicaciones(), 1);
    assert.equal(finalizacionesCarga, 1);
    const publicada = api.historialGeneraciones().find(item =>
        item.generacion === enCurso[0].generacion);
    assert.ok(publicada.t3 && publicada.t4 && publicada.t5);
    assert.ok(Date.parse(publicada.t3) <= Date.parse(publicada.t4));
    assert.ok(Date.parse(publicada.t4) <= Date.parse(publicada.t5));

    window.cargarCabanasDia('2026-09-25', {
        evento: 'escritura confirmada', tipo: 'externo'
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    const despuesDeEscritura = api.historialGeneraciones().filter(item => item.generacion);
    assert.equal(despuesDeEscritura.length, 2);
    assert.equal(despuesDeEscritura[1].evento, 'escritura confirmada');
    assert.equal(api.solicitudesCoalescidas().at(-1).evento,
        'cargarCabanasDia envuelto');
    assert.equal(api.publicaciones(), 2);
});
