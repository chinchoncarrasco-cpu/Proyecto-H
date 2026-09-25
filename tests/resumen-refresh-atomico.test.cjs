const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const codigo = fs.readFileSync(path.join(__dirname, '../js/supabase-resumen-refresh-v1.js'), 'utf8');
const fuentes = ['reservas', 'servicios', 'pagos', 'checkout', 'checkoutAutoridad',
    'notas', 'aseo', 'revision', 'operacion', 'autoridadVisual', 'tablero'];
const diferida = () => {
    let resolver;
    let rechazar;
    const promesa = new Promise((resolve, reject) => { resolver = resolve; rechazar = reject; });
    return { promesa, resolver, rechazar };
};

function entorno({ dependientes = [], omitidas = [], sesionInicial = false } = {}) {
    const clases = new Set(['haiku-resumen-pendiente']);
    const nodos = new Map([
        ['resumen-refresh-estado', { textContent: 'Cargando Resumen…' }],
        ['fecha-actual', { textContent: 'Cargando fecha operativa…' }]
    ]);
    const listeners = new Map();
    const document = {
        readyState: 'complete',
        documentElement: { classList: {
            add: nombre => clases.add(nombre),
            remove: nombre => clases.delete(nombre)
        } },
        getElementById: id => nodos.get(id) || null,
        querySelectorAll: () => [],
        querySelector: () => null
    };
    const window = {
        haikuSesion: sesionInicial ? { auth: { id: 'usuario-a' } } : null,
        addEventListener: (nombre, fn) => listeners.set(nombre, fn)
    };
    const contexto = vm.createContext({ window, document, console, queueMicrotask,
        Date, Intl, fechaSeleccionada: '2026-09-12' });
    vm.runInContext(codigo, contexto);
    const api = window.HAIKU_RESUMEN_REFRESH_V1;
    const lecturas = new Map();
    const complementos = new Map();
    const visible = {};
    const lecturasDe = (nombre, generacion) => {
        const clave = `${nombre}:${generacion}`;
        if (!lecturas.has(clave)) lecturas.set(clave, diferida());
        return lecturas.get(clave);
    };
    const complementoDe = (nombre, generacion) => {
        const clave = `${nombre}:${generacion}`;
        if (!complementos.has(clave)) complementos.set(clave, diferida());
        return complementos.get(clave);
    };
    fuentes.filter(nombre => !omitidas.includes(nombre)).forEach((nombre, orden) => api.registrar(nombre, {
        orden,
        obligatoria: !['notas', 'aseo', 'revision'].includes(nombre),
        dependencias: nombre === 'pagos' ? ['operacion'] :
            nombre === 'tablero' ? ['operacion', 'pagos'] : [],
        preparar: ({ generacion }) => lecturasDe(nombre, generacion).promesa,
        ...(dependientes.includes(nombre) ? {
            completar: ({ generacion }) => complementoDe(nombre, generacion).promesa
        } : {}),
        publicar: snapshot => { visible[nombre] = snapshot.datos[nombre]; }
    }));
    if (!sesionInicial) window.haikuSesion = { auth: { id: 'usuario-a' } };
    return { api, contexto, document, window, clases, nodos, visible, lecturasDe,
        complementoDe, complementos, lecturas, emitir: nombre => listeners.get(nombre)?.() };
}

async function resolverTodas(h, generacion, valor, omitir = []) {
    fuentes.filter(nombre => !omitir.includes(nombre)).forEach(nombre =>
        h.lecturasDe(nombre, generacion).resolver(`${valor}-${nombre}`));
    await Promise.resolve();
    await Promise.resolve();
}

test('primera carga espera operación, servicios, pagos y checkout; publica una vez', async () => {
    const h = entorno();
    const carga = h.api.solicitar();
    await resolverTodas(h, 1, 'B', ['servicios', 'pagos', 'checkout']);
    assert.equal(h.api.publicaciones(), 0);
    assert.equal(h.visible.operacion, undefined);
    assert.equal(h.clases.has('haiku-resumen-pendiente'), true);
    h.lecturasDe('servicios', 1).resolver('B-servicios');
    h.lecturasDe('pagos', 1).resolver('B-pagos');
    await Promise.resolve();
    assert.equal(h.api.publicaciones(), 0);
    h.lecturasDe('checkout', 1).resolver('B-checkout');
    assert.equal(await carga, true);
    assert.equal(h.api.publicaciones(), 1);
    assert.equal(h.visible.operacion, 'B-operacion');
    assert.equal(h.visible.pagos, 'B-pagos');
    assert.equal(h.clases.has('haiku-resumen-pendiente'), false);
});

test('el arranque con sesión activa programa una sola generación inicial', async () => {
    const h = entorno({ sesionInicial: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal([...h.lecturas.keys()].some(clave => clave.endsWith(':2')), false);
    await resolverTodas(h, 1, 'A');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.api.publicaciones(), 1);
});

test('primera carga fallida conserva el shell y muestra un error controlado', async () => {
    const h = entorno();
    const carga = h.api.solicitar();
    h.lecturasDe('operacion', 1).rechazar(new Error('Operación no disponible'));
    await resolverTodas(h, 1, 'B', ['operacion']);
    assert.equal(await carga, false);
    assert.equal(h.api.publicaciones(), 0);
    assert.equal(h.clases.has('haiku-resumen-pendiente'), true);
    assert.match(h.nodos.get('resumen-refresh-estado').textContent,
        /No fue posible cargar el Resumen/);
});

test('A permanece visible hasta B; un fallo obligatorio conserva A', async () => {
    const h = entorno();
    const primera = h.api.solicitar();
    await resolverTodas(h, 1, 'A');
    assert.equal(await primera, true);
    const segunda = h.api.solicitar();
    await resolverTodas(h, 2, 'B', ['pagos']);
    assert.equal(h.visible.operacion, 'A-operacion');
    assert.equal(h.api.publicaciones(), 1);
    h.lecturasDe('pagos', 2).resolver('B-pagos');
    assert.equal(await segunda, true);
    assert.equal(h.visible.operacion, 'B-operacion');
    assert.equal(h.api.publicaciones(), 2);
    const tercera = h.api.solicitar();
    h.lecturasDe('operacion', 3).rechazar(new Error('RPC fuera de servicio'));
    await resolverTodas(h, 3, 'C', ['operacion']);
    assert.equal(await tercera, false);
    assert.equal(h.visible.operacion, 'B-operacion');
    assert.equal(h.api.publicaciones(), 2);
    assert.match(h.nodos.get('resumen-refresh-estado').textContent,
        /Se conserva la vista anterior/);
});

test('generación vieja y cambio rápido de fecha nunca reemplazan la última', async () => {
    const h = entorno();
    const vieja = h.api.solicitar('2026-09-12');
    h.contexto.fechaSeleccionada = '2026-09-11';
    const intermedia = h.api.solicitar('2026-09-11');
    h.contexto.fechaSeleccionada = '2026-09-13';
    const nueva = h.api.solicitar('2026-09-13');
    await resolverTodas(h, 3, 'B3');
    assert.equal(await nueva, true);
    await resolverTodas(h, 2, 'B2');
    await resolverTodas(h, 1, 'B1');
    assert.equal(await intermedia, false);
    assert.equal(await vieja, false);
    assert.equal(h.api.ultimo().fecha, '2026-09-13');
    assert.equal(h.visible.operacion, 'B3-operacion');
    assert.equal(h.api.publicaciones(), 1);
});

test('realtime externo del mismo día sí sustituye una navegación en curso', async () => {
    const h = entorno();
    const inicial = h.api.solicitar('2026-09-12');
    await resolverTodas(h, 1, 'A');
    assert.equal(await inicial, true);
    h.contexto.fechaSeleccionada = '2026-09-11';
    const navegacion = h.api.solicitar('2026-09-11', {
        categoria: 'navegación usuario', evento: 'Día anterior', tipo: 'usuario'
    });
    const realtime = h.api.solicitar('2026-09-11', {
        categoria: 'pagos', evento: 'realtime pagos', tipo: 'externo'
    });
    await resolverTodas(h, 3, 'R');
    assert.equal(await realtime, true);
    await resolverTodas(h, 2, 'B');
    assert.equal(await navegacion, false);
    assert.equal(h.api.ultimo().generacion, 3);
    assert.equal(h.api.ultimo().fecha, '2026-09-11');
    assert.equal(h.api.publicaciones(), 2);
});

test('refresh manual explícito del mismo día conserva prioridad sobre la navegación', async () => {
    const h = entorno();
    const navegacion = h.api.solicitar('2026-09-12', {
        categoria: 'navegación usuario', evento: 'Hoy', tipo: 'usuario'
    });
    const manual = h.api.solicitar('2026-09-12', {
        categoria: 'refresh manual', evento: 'Actualizar', tipo: 'externo'
    });
    await resolverTodas(h, 2, 'M');
    assert.equal(await manual, true);
    await resolverTodas(h, 1, 'N');
    assert.equal(await navegacion, false);
    assert.equal(h.api.ultimo().generacion, 2);
    assert.equal(h.api.publicaciones(), 1);
});

test('un productor atrasado que pide A no invalida la navegación pendiente hacia B', async () => {
    const h = entorno();
    const primera = h.api.solicitar();
    await resolverTodas(h, 1, 'A');
    assert.equal(await primera, true);
    h.contexto.fechaSeleccionada = '2026-09-11';
    const nueva = h.api.solicitar('2026-09-11');
    assert.equal(await h.api.solicitar('2026-09-12'), false);
    await resolverTodas(h, 2, 'B');
    assert.equal(await nueva, true);
    assert.equal(h.api.ultimo().fecha, '2026-09-11');
    assert.equal(h.api.publicaciones(), 2);
});

test('fuente secundaria fallida no publica a mitad de carga', async () => {
    const h = entorno();
    const carga = h.api.solicitar();
    h.lecturasDe('notas', 1).rechazar(new Error('Notas no disponibles'));
    await resolverTodas(h, 1, 'B', ['notas']);
    assert.equal(await carga, true);
    assert.equal(h.api.publicaciones(), 1);
    assert.equal(h.visible.notas, null);
});

test('una fuente secundaria no instalada no congela la primera carga', async () => {
    const h = entorno({ omitidas: ['notas', 'aseo', 'revision'] });
    const carga = h.api.solicitar();
    await resolverTodas(h, 1, 'B', ['notas', 'aseo', 'revision']);
    assert.equal(await carga, true);
    assert.equal(h.api.publicaciones(), 1);
    assert.equal(h.api.ultimo().datos.notas, null);
    assert.equal(h.api.ultimo().datos.aseo, null);
    assert.equal(h.api.ultimo().datos.revision, null);
});

test('los cobros dependientes esperan la operación de la misma generación', async () => {
    const h = entorno({ dependientes: ['pagos', 'tablero'] });
    const carga = h.api.solicitar();
    await resolverTodas(h, 1, 'B');
    assert.equal(h.api.publicaciones(), 0);
    h.complementoDe('pagos', 1).resolver('saldo-canónico');
    await Promise.resolve();
    assert.equal(h.api.publicaciones(), 0);
    h.complementoDe('tablero', 1).resolver('filtro-coherente');
    assert.equal(await carga, true);
    assert.equal(h.visible.pagos, 'saldo-canónico');
    assert.equal(h.visible.tablero, 'filtro-coherente');
    assert.equal(h.api.publicaciones(), 1);
});

test('pagos se prepara tras operación mientras otra fuente primaria aún tarda', async () => {
    const h = entorno({ dependientes: ['pagos', 'tablero'] });
    const carga = h.api.solicitar();
    await resolverTodas(h, 1, 'B', ['checkoutAutoridad']);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.complementos.has('pagos:1'), true);
    assert.equal(h.api.publicaciones(), 0);
    h.complementoDe('pagos', 1).resolver('saldo-listo');
    await Promise.resolve();
    await Promise.resolve();
    h.complementoDe('tablero', 1).resolver('tablero-listo');
    await Promise.resolve();
    assert.equal(h.api.publicaciones(), 0);
    h.lecturasDe('checkoutAutoridad', 1).resolver('B-checkoutAutoridad');
    assert.equal(await carga, true);
    assert.equal(h.api.publicaciones(), 1);
});

test('las reservas y estadías pueden terminar antes de la operación sin publicar un parcial', async () => {
    const h = entorno();
    const carga = h.api.solicitar();
    await resolverTodas(h, 1, 'B', ['operacion']);
    assert.equal(h.api.publicaciones(), 0);
    assert.equal(h.visible.reservas, undefined);
    h.lecturasDe('operacion', 1).resolver('B-operacion');
    assert.equal(await carga, true);
    assert.equal(h.api.publicaciones(), 1);
    assert.equal(h.visible.reservas, 'B-reservas');
});

test('un cambio de usuario invalida A y descarta una respuesta de la sesión anterior', async () => {
    const h = entorno();
    const primera = h.api.solicitar();
    await resolverTodas(h, 1, 'A');
    assert.equal(await primera, true);
    const vieja = h.api.solicitar();
    h.window.haikuSesion = { auth: { id: 'usuario-b' } };
    h.emitir('haiku:auth-ready');
    await Promise.resolve();
    assert.equal(h.clases.has('haiku-resumen-pendiente'), true);
    await resolverTodas(h, 4, 'B');
    await Promise.resolve();
    await resolverTodas(h, 2, 'vieja');
    assert.equal(await vieja, false);
    assert.equal(h.api.ultimo().usuario, 'usuario-b');
    assert.equal(h.visible.operacion, 'B-operacion');
    assert.equal(h.api.publicaciones(), 2);
});
