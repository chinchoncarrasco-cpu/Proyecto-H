const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const leer = nombre => fs.readFileSync(path.join(__dirname, '..', 'js', nombre), 'utf8');
const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

function productor(nombre, { primeraIife = false } = {}) {
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
        haikuSesion: null, haikuSupabase: { channel: () => canal },
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
