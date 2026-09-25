const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const codigo = fs.readFileSync(path.join(__dirname, '../js/supabase-pagos-refresh-v1.js'), 'utf8');
const espera = ms => new Promise(resolve => setTimeout(resolve, ms));
function diferida() {
    let resolver, rechazar;
    const promesa = new Promise((a, b) => { resolver = a; rechazar = b; });
    return { promesa, resolver, rechazar };
}
function entorno() {
    const clases = new Set(['haiku-pagos-pendiente']);
    const listeners = new Map();
    const canales = [];
    const nodos = new Map();
    const listas = ['abonos', 'checkin', 'checkout', 'webpay'];
    for (const nombre of listas) {
        nodos.set(`pagos-lista-${nombre}`, {
            childNodes: [`A-${nombre}`],
            replaceChildren(...hijos) { this.childNodes = hijos; }
        });
        nodos.set(`pagos-contador-${nombre}`, { textContent: '1' });
    }
    nodos.set('pagos-refresh-estado', { textContent: 'Cargando Pagos…' });
    nodos.set('seccion-pagos', { classList: { contains: x => x === 'activa' } });
    const puertas = {};
    const llamadas = [];
    const publicadosSites = [];
    const estado = { fecha: '2026-09-25', usuario: 'u1', rpc: 0 };
    function bloque(nombre, { fecha }) {
        llamadas.push([nombre, fecha]);
        const salida = () => ({ lista: { childNodes: [`${fecha}-${nombre}`] },
            contador: { textContent: '2' }, autoridad: nombre });
        const puerta = puertas[nombre];
        return puerta ? puerta.promesa.then(salida) : salida();
    }
    const fuentes = {
        HAIKU_ABONOS_VERIFICACION_V2: { preparar: c => bloque('abonos', c) },
        HAIKU_PAGO_CHECKIN_RESUMEN_V1: { preparar: c => bloque('checkin', c) },
        HAIKU_PAGO_CHECKOUT_RESUMEN_V1: { preparar: c => bloque('checkout', c) },
        HAIKU_WEBPAY_PAGOS_V1: { preparar: c => bloque('webpay', c) },
        HAIKU_PAGO_CHECKIN_GRUPO_RESUMEN_V1: {
            preparar: c => Promise.resolve(bloque('grupo', c)).then(() => []),
            publicar(_datos, lista) { lista.childNodes.push('grupo-preparado'); }
        },
        HAIKU_SALDO_FAVOR_V2: {
            preparar: (_checkin, _checkout) => {
                llamadas.push(['credito', estado.fecha]);
                return puertas.credito ? puertas.credito.promesa.then(() => new Map()) : new Map();
            },
            publicar(_datos, checkin) { checkin.childNodes.push('credito-preparado'); }
        },
        HAIKU_SITES_PAGOS_V1: { publicar(filas) { publicadosSites.push(filas); } }
    };
    const supabase = {
        rpc: async (_nombre, args) => { estado.rpc++; return { data: [{ fecha: args.p_fecha }], error: null }; },
        channel(nombre) {
            const canal = { nombre, handlers: [], on(_tipo, filtro, callback) {
                this.handlers.push({ filtro, callback }); return this;
            }, subscribe() { return this; } };
            canales.push(canal);
            return canal;
        }
    };
    const win = { ...fuentes, haikuSupabase: supabase,
        haikuSesion: { auth: { id: estado.usuario } },
        addEventListener(nombre, callback) {
            const key = `window:${nombre}`;
            listeners.set(key, [...(listeners.get(key) || []), callback]);
        } };
    const doc = { documentElement: { classList: {
        toggle(nombre, on) { on ? clases.add(nombre) : clases.delete(nombre); }
    } }, getElementById: id => nodos.get(id), querySelectorAll: () => [], addEventListener(nombre, callback) {
        listeners.set(nombre, [...(listeners.get(nombre) || []), callback]);
    } };
    const contexto = { window: win, document: doc, performance,
        requestAnimationFrame: callback => callback(), setTimeout, clearTimeout,
        queueMicrotask, Date, Map, Promise, Error,
        get fechaSeleccionada() { return estado.fecha; } };
    vm.runInNewContext(codigo, contexto, { filename: 'supabase-pagos-refresh-v1.js' });
    return { api: win.HAIKU_PAGOS_REFRESH_V1, estado, nodos, clases,
        puertas, llamadas, canales, listeners, publicadosSites, win };
}

test('entrada a Pagos mantiene shell hasta publicar los cuatro bloques, grupo y crédito', async () => {
    const e = entorno();
    e.puertas.checkout = diferida();
    const click = e.listeners.get('click')[0];
    click({ target: { closest: selector => selector.includes('data-seccion') ? {} : null } });
    assert.equal(e.api.interceptar('lector del mismo clic'), true);
    await espera(0);
    assert.equal(e.api.perfil().origen.tipo, 'usuario');
    assert.equal(e.estado.rpc, 1);
    assert.equal(e.clases.has('haiku-pagos-pendiente'), true);
    assert.equal(e.api.publicaciones(), 0);
    assert.deepEqual(e.nodos.get('pagos-lista-abonos').childNodes, ['A-abonos']);
    e.puertas.checkout.resolver();
    await espera(0);
    assert.equal(e.api.publicaciones(), 1);
    assert.equal(e.clases.has('haiku-pagos-pendiente'), false);
    assert.deepEqual(e.nodos.get('pagos-lista-checkin').childNodes,
        ['2026-09-25-checkin', 'grupo-preparado', 'credito-preparado']);
    assert.equal(e.publicadosSites.length, 1);
    assert.equal(e.api.snapshot().webpayScope, 'global');
    assert.equal(e.api.perfil().publicaciones, 1);
});

for (const lenta of ['abonos', 'checkin', 'checkout', 'webpay', 'grupo', 'credito']) {
    test(`refresh conserva A mientras ${lenta} termina tarde`, async () => {
        const e = entorno();
        await e.api.solicitar({ tipo: 'usuario', nombre: 'primera carga' });
        const antes = e.nodos.get('pagos-lista-abonos').childNodes;
        e.puertas[lenta] = diferida();
        const pendiente = e.api.solicitar({ tipo: 'usuario', nombre: 'refresh' });
        await espera(0);
        assert.equal(e.api.publicaciones(), 1);
        assert.deepEqual(e.nodos.get('pagos-lista-abonos').childNodes, antes);
        assert.match(e.nodos.get('pagos-refresh-estado').textContent, /Actualizando/);
        e.puertas[lenta].resolver();
        assert.equal((await pendiente).estado, 'publicada');
        assert.equal(e.api.publicaciones(), 2);
        assert.equal(e.nodos.get('pagos-refresh-estado').textContent, '');
    });
}

test('una generación anterior y sus respuestas financieras no sobrescriben la fecha nueva', async () => {
    const e = entorno();
    e.puertas.checkin = diferida();
    const vieja = e.api.solicitar({ tipo: 'usuario', nombre: 'día anterior' });
    await espera(0);
    e.estado.fecha = '2026-09-26';
    const puertaVieja = e.puertas.checkin;
    delete e.puertas.checkin;
    const nueva = e.api.solicitar({ tipo: 'usuario', nombre: 'día siguiente' });
    assert.equal((await nueva).estado, 'publicada');
    puertaVieja.resolver();
    assert.equal((await vieja).estado, 'descartada');
    assert.equal(e.api.publicaciones(), 1);
    assert.equal(e.api.snapshot().contexto.fecha, '2026-09-26');
});

test('lectores internos coalescen durante la generación y después de publicada', async () => {
    const e = entorno();
    e.puertas.webpay = diferida();
    const pendiente = e.api.solicitar({ tipo: 'usuario', nombre: 'entrar' });
    await espera(0);
    for (const origen of ['abonos', 'checkin', 'checkout', 'webpay', 'grupo', 'credito', 'sites']) {
        assert.equal(e.api.interceptar(origen), true);
    }
    assert.equal(e.api.perfil().generationId, 1);
    e.puertas.webpay.resolver();
    await pendiente;
    assert.equal(e.api.interceptar('mutation'), true);
    assert.equal(e.api.publicaciones(), 1);
    assert.equal(e.estado.rpc, 1);
    assert.ok(e.api.coalescidas() >= 8);
});

test('Realtime real y escritura confirmada generan refresh; eco de la escritura no duplica', async () => {
    const e = entorno();
    await e.api.solicitar({ tipo: 'usuario', nombre: 'entrar' });
    e.canales[0].handlers[0].callback();
    await espera(150);
    assert.equal(e.api.publicaciones(), 2);
    await e.api.escrituraConfirmada('registrar pago');
    assert.equal(e.api.publicaciones(), 3);
    e.canales[0].handlers[0].callback();
    await espera(150);
    assert.equal(e.api.publicaciones(), 3);
});

test('error obligatorio en primera carga no publica cero; error de refresh conserva A', async () => {
    const e = entorno();
    e.puertas.abonos = diferida();
    const primera = e.api.solicitar({ tipo: 'usuario', nombre: 'entrar' });
    e.puertas.abonos.rechazar(new Error('sin pagos confirmados'));
    assert.equal((await primera).estado, 'error');
    assert.equal(e.api.publicaciones(), 0);
    assert.equal(e.clases.has('haiku-pagos-pendiente'), true);
    assert.match(e.nodos.get('pagos-refresh-estado').textContent, /Reintenta/);
    delete e.puertas.abonos;
    await e.api.solicitar({ tipo: 'usuario', nombre: 'reintentar' });
    const a = e.nodos.get('pagos-lista-abonos').childNodes;
    e.puertas.checkout = diferida();
    const segunda = e.api.solicitar({ tipo: 'usuario', nombre: 'refresh' });
    await espera(0);
    e.puertas.checkout.rechazar(new Error('vista de cargos no disponible'));
    assert.equal((await segunda).estado, 'error');
    assert.equal(e.api.publicaciones(), 1);
    assert.deepEqual(e.nodos.get('pagos-lista-abonos').childNodes, a);
    assert.match(e.nodos.get('pagos-refresh-estado').textContent, /vista anterior/);
});

test('cambio de usuario invalida la vista anterior y la sesión anterior', async () => {
    const e = entorno();
    await e.api.solicitar({ tipo: 'usuario', nombre: 'entrar' });
    e.win.haikuSesion = { auth: { id: 'u2' } };
    e.puertas.grupo = diferida();
    const nueva = e.api.solicitar({ tipo: 'externo', nombre: 'sesión' });
    await espera(0);
    assert.equal(e.clases.has('haiku-pagos-pendiente'), true);
    e.puertas.grupo.resolver();
    await nueva;
    assert.equal(e.api.snapshot().contexto.usuario, 'u2');
});

test('perfil de harness mide fuente lenta, snapshot, publicación, visibilidad y coalescencia', async () => {
    const e = entorno();
    e.puertas.credito = diferida();
    const pendiente = e.api.solicitar({ tipo: 'usuario', nombre: 'medición' });
    await espera(25);
    e.api.interceptar('observer');
    e.puertas.credito.resolver();
    await pendiente;
    const p = e.api.perfil();
    assert.ok(p.fuentes.credito.duracionMs >= 20);
    assert.equal(p.fuentes.credito.estado, 'listo');
    assert.ok(p.tSnapshotMs >= 20);
    assert.ok(p.tPublishMs >= p.tSnapshotMs);
    assert.ok(p.tVisibleMs >= p.tPublishMs);
    assert.equal(p.publicaciones, 1);
    assert.equal(p.coalescidas, 1);
});

test('una falla síncrona al componer Sites revierte las cuatro listas y contadores', async () => {
    const e = entorno();
    await e.api.solicitar({ tipo: 'usuario', nombre: 'A' });
    const anterior = new Map(['abonos', 'checkin', 'checkout', 'webpay'].map(nombre =>
        [nombre, { nodos: [...e.nodos.get(`pagos-lista-${nombre}`).childNodes],
            cuenta: e.nodos.get(`pagos-contador-${nombre}`).textContent }]));
    e.win.HAIKU_SITES_PAGOS_V1.publicar = () => { throw new Error('Sites falló'); };
    const resultado = await e.api.solicitar({ tipo: 'usuario', nombre: 'B' });
    assert.equal(resultado.estado, 'error');
    assert.equal(e.api.publicaciones(), 1);
    for (const [nombre, valor] of anterior) {
        assert.deepEqual(e.nodos.get(`pagos-lista-${nombre}`).childNodes, valor.nodos);
        assert.equal(e.nodos.get(`pagos-contador-${nombre}`).textContent, valor.cuenta);
    }
});
