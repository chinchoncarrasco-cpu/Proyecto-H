const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const leer = nombre => fs.readFileSync(path.join(__dirname, '..', 'js', nombre), 'utf8');
const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

function productor(nombre, { primeraIife = false, clientePrueba = {} } = {}) {
    const solicitudes = [];
    const fuentes = new Map();
    const realtime = new Map();
    const eventosDocument = new Map();
    const eventosWindow = new Map();
    const escuchar = (mapa, tipo, fn) => mapa.set(tipo, [...(mapa.get(tipo) || []), fn]);
    const document = {
        readyState: 'loading', hidden: false, visibilityState: 'visible',
        head: { appendChild() {} },
        addEventListener: (tipo, fn) => escuchar(eventosDocument, tipo, fn),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({ dataset: {} })
    };
    const coordinador = {
        activo: () => true, publicando: () => false,
        registrar(nombreFuente, fuente) { fuentes.set(nombreFuente, fuente); },
        ultimo: () => ({ fecha: '2026-09-25', datos: { operacion: { filas: [] } } }),
        solicitar(fecha, origen) {
            solicitudes.push({ fecha: fecha || '2026-09-25', origen });
            return Promise.resolve(true);
        }
    };
    const canal = { on(_tipo, filtro, callback) {
        realtime.set(filtro.table, callback);
        return this;
    }, subscribe() { return this; } };
    const window = {
        haikuSesion: null, haikuSupabase: { channel: () => canal, ...clientePrueba },
        HAIKU_RESUMEN_REFRESH_V1: coordinador,
        addEventListener: (tipo, fn) => escuchar(eventosWindow, tipo, fn)
    };
    const contexto = vm.createContext({ window, document, console,
        fechaSeleccionada: '2026-09-25', setTimeout, clearTimeout,
        obtenerDatosDia: () => ({ cabanas: {} }),
        requestAnimationFrame: fn => fn(),
        localStorage: { getItem: () => null, setItem() {} },
        MutationObserver: class { observe() {} },
        CustomEvent: class { constructor(type, options) {
            this.type = type; this.detail = options?.detail;
        } }
    });
    const codigo = leer(nombre);
    vm.runInContext(primeraIife ? codigo.slice(0,
        codigo.indexOf('// Carga desacoplada')) : codigo, contexto);
    const emitir = (mapa, tipo, evento = {}) => {
        (mapa.get(tipo) || []).forEach(fn => fn(evento));
    };
    return { window, solicitudes, fuentes, realtime,
        documento: (tipo, evento) => emitir(eventosDocument, tipo, evento),
        ventana: (tipo, evento) => emitir(eventosWindow, tipo, evento) };
}

test('revisión: entrada derivada y escritura confirmada conservan orígenes distintos', async () => {
    const h = productor('supabase-revision-resumen-sync-v2.js');
    h.documento('DOMContentLoaded');
    assert.equal(h.solicitudes.at(-1).origen.tipo, 'interno_derivado');
    h.documento('haiku:revision-estado-guardado', {
        detail: { fecha: '2026-09-25' }
    });
    assert.equal(h.solicitudes.at(-1).origen.tipo, 'externo');
});

test('aseo: focus derivado y refresh explícito externo', async () => {
    const h = productor('supabase-aseo-resumen-sync-v1.js');
    h.window.haikuSesion = { auth: { id: 'usuario' } };
    h.ventana('focus');
    await esperar(65);
    assert.equal(h.solicitudes.at(-1).origen.evento, 'sincronización derivada');
    assert.equal(h.solicitudes.at(-1).origen.tipo, 'interno_derivado');
    await h.window.HAIKU_ASEO_RESUMEN_SYNC_V1.refrescar();
    assert.equal(h.solicitudes.at(-1).origen.tipo, 'externo');
});

test('aseo: focus no cancela un Realtime pendiente', async () => {
    const h = productor('supabase-aseo-resumen-sync-v1.js');
    h.window.haikuSesion = { auth: { id: 'usuario' } };
    h.ventana('haiku:auth-ready');
    await esperar(10);
    h.solicitudes.length = 0;
    h.realtime.get('aseos')();
    h.ventana('focus');
    await esperar(75);
    assert.equal(h.solicitudes.length, 1);
    assert.equal(h.solicitudes[0].origen.evento, 'realtime aseos');
    assert.equal(h.solicitudes[0].origen.tipo, 'externo');
});

test('notas: focus sin cambio es derivado y no cancela Realtime', async () => {
    const h = productor('supabase-notas-resumen-v1.js', { primeraIife: true });
    h.window.haikuSesion = { auth: { id: 'usuario' } };
    h.ventana('haiku:auth-ready');
    h.fuentes.get('notas').publicar({ fecha: '2026-09-25', datos: { notas: [] } });
    h.solicitudes.length = 0;
    h.ventana('focus');
    await esperar(10);
    assert.equal(h.solicitudes.at(-1).origen.tipo, 'interno_derivado');
    h.solicitudes.length = 0;
    h.realtime.get('notas')();
    h.ventana('focus');
    await esperar(95);
    assert.equal(h.solicitudes.length, 1);
    assert.equal(h.solicitudes[0].origen.evento, 'realtime notas');
    assert.equal(h.solicitudes[0].origen.tipo, 'externo');
});

test('autoridad visual: focus derivado y refresh explícito externo', async () => {
    const h = productor('supabase-autoridad-visual-final-v1.js');
    h.window.haikuSesion = { auth: { id: 'usuario' } };
    h.ventana('focus');
    await esperar(200);
    assert.equal(h.solicitudes.at(-1).origen.categoria, 'autoridad visual');
    assert.equal(h.solicitudes.at(-1).origen.tipo, 'interno_derivado');
    await h.window.HAIKU_AUTORIDAD_VISUAL_FINAL_V1.refrescar();
    assert.equal(h.solicitudes.at(-1).origen.tipo, 'externo');
});

test('checkout: abrir Resumen es derivado y refresh explícito es externo', async () => {
    const h = productor('supabase-checkout-resumen-v1.js');
    h.documento('click', { target: {
        closest: selector => selector.includes('menu-item') ? {} : null
    } });
    assert.equal(h.solicitudes.at(-1).origen.categoria, 'checkout');
    assert.equal(h.solicitudes.at(-1).origen.tipo, 'interno_derivado');
    await h.window.HAIKU_CHECKOUT_RESUMEN_V2.refrescar();
    assert.equal(h.solicitudes.at(-1).origen.tipo, 'externo');
});

test('checkout autoridad: focus derivado y sincronización explícita externa', async () => {
    const h = productor('supabase-checkout-autoridad-v1.js');
    h.ventana('focus');
    assert.equal(h.solicitudes.at(-1).origen.categoria, 'checkout autoridad');
    assert.equal(h.solicitudes.at(-1).origen.tipo, 'interno_derivado');
    await h.window.HAIKU_CHECKOUT_AUTORIDAD_V1.sincronizar();
    assert.equal(h.solicitudes.at(-1).origen.tipo, 'externo');
});


test('checkout autoridad lee alojamientos y Full Day a la vez antes de publicar salidas', async () => {
    const consultas = [];
    const resolver = new Map();
    const clientePrueba = {
        from(tabla) {
            const filtros = [];
            const consulta = {
                select(campos) { this.campos = campos; return this; },
                eq(campo, valor) { filtros.push([campo, valor]); return this; },
                not(campo, operador, valor) { filtros.push([campo, operador, valor]); return this; },
                then(resolve, reject) {
                    const tipo = filtros.find(([campo]) => campo === 'tipo_estadia')[1];
                    consultas.push({ tabla, campos: this.campos, filtros });
                    return new Promise(done => resolver.set(tipo, done)).then(resolve, reject);
                }
            };
            return consulta;
        }
    };
    const h = productor('supabase-checkout-autoridad-v1.js', { clientePrueba });
    const lectura = h.fuentes.get('checkoutAutoridad').preparar({ fecha: '2026-11-06' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(consultas.length, 2, 'ambas lecturas empiezan sin esperar a la otra');
    for (const consulta of consultas) {
        assert.equal(consulta.tabla, 'reserva_estadias');
        assert.match(consulta.campos, /cabanas!reserva_estadias_cabana_id_fkey/);
        assert.deepEqual(consulta.filtros.at(-1), ['estado_estadia', 'in', '(cancelada,no_show)']);
    }
    assert.deepEqual(consultas[0].filtros.slice(0, 2),
        [['tipo_estadia', 'alojamiento'], ['fecha_salida', '2026-11-06']]);
    assert.deepEqual(consultas[1].filtros.slice(0, 2),
        [['tipo_estadia', 'fullday'], ['fecha_ingreso', '2026-11-06']]);
    resolver.get('fullday')({ data: [{ id: 'full' }, { id: 'repetida' }], error: null });
    resolver.get('alojamiento')({ data: [{ id: 'noche' }, { id: 'repetida' }], error: null });
    assert.deepEqual(Array.from(await lectura, estadia => estadia.id), ['noche', 'repetida', 'full']);

    const siguiente = h.fuentes.get('checkoutAutoridad').preparar({ fecha: '2026-11-07' });
    await new Promise(resolve => setImmediate(resolve));
    const error = { code: '42501', message: 'Sin permiso' };
    resolver.get('alojamiento')({ data: [], error: null });
    resolver.get('fullday')({ data: null, error });
    await assert.rejects(siguiente, recibido => recibido === error);
});

test('inicio de Pagos y Notas es derivado; sus APIs explícitas conservan actualización externa', async () => {
    for (const [archivo, api] of [
        ['supabase-pagos-pendientes-v1.js', 'HAIKU_PAGOS_PENDIENTES_SUPABASE_V1'],
        ['supabase-notas-resumen-v1.js', 'HAIKU_NOTAS_RESUMEN_SUPABASE_V1']
    ]) {
        const h = productor(archivo, { primeraIife: archivo.includes('notas') });
        h.window.haikuSesion = { auth: { id: 'usuario' } };
        h.ventana('haiku:auth-ready');
        assert.equal(h.solicitudes.length, 1, archivo);
        assert.equal(h.solicitudes[0].origen.tipo, 'interno_derivado', archivo);
        await h.window[api].refrescar();
        assert.equal(h.solicitudes.at(-1).origen.tipo, 'externo', archivo);
    }
});

test('calendario propaga origen de auth a reservas y checkout; realtime y API siguen externos', async () => {
    const h = productor('supabase-calendario-estados-v1.js', {
        clientePrueba: { from: () => ({ select: async () => ({ data: [], error: null }) }) }
    });
    const reservas = [], checkouts = [];
    h.window.haikuSincronizarReservasSupabase = async origen => reservas.push(origen);
    h.window.HAIKU_CHECKOUT_AUTORIDAD_V1 = {
        sincronizar: async opciones => checkouts.push(opciones.origen)
    };
    h.window.haikuSesion = { auth: { id: 'usuario' } };
    h.ventana('haiku:auth-ready');
    await esperar(0);
    assert.equal(reservas.length, 1);
    assert.equal(checkouts.length, 1);
    assert.equal(reservas[0].tipo, 'interno_derivado');
    assert.equal(checkouts[0].tipo, 'interno_derivado');
    assert.equal(checkouts[0].evento, 'auth calendario estados');

    await h.window.HAIKU_CALENDARIO_ESTADOS_V1.refrescar();
    assert.equal(reservas.at(-1).tipo, 'externo');
    assert.equal(checkouts.at(-1).tipo, 'externo');
    h.realtime.get('reserva_estadias')();
    await esperar(95);
    assert.equal(reservas.at(-1).tipo, 'externo');
    assert.equal(checkouts.at(-1).evento, 'realtime calendario estados');

    // Una segunda señal de arranque no debe reemplazar una actualización
    // externa que quedó esperando mientras se leían los estados.
    let liberar;
    h.window.haikuSupabase.from = () => ({ select: () =>
        new Promise(resolve => { liberar = resolve; }) });
    const arranque = h.window.HAIKU_CALENDARIO_ESTADOS_V1.refrescar({ origen: {
        evento: 'inicio calendario estados', tipo: 'interno_derivado'
    } });
    await esperar(0);
    await h.window.HAIKU_CALENDARIO_ESTADOS_V1.refrescar();
    h.ventana('haiku:auth-ready');
    h.window.haikuSupabase.from = () => ({ select: async () => ({ data: [], error: null }) });
    liberar({ data: [], error: null });
    await arranque;
    await esperar(95);
    assert.equal(reservas.at(-1).tipo, 'externo');
    assert.equal(checkouts.at(-1).evento, 'refresh explícito calendario estados');
});
