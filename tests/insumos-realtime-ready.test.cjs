const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { crearSupabaseInsumos } = require('./fixtures/insumos-supabase-mock.cjs');
const insumos = fs.readFileSync(path.join(__dirname, '../js/supabase-insumos-aseo-v1.js'), 'utf8');
const realtime = fs.readFileSync(path.join(__dirname, '../js/supabase-aseo-realtime-v1.js'), 'utf8');
const fecha = '2026-09-27';
const siguiente = () => new Promise(resolve => setImmediate(resolve));
const listo = { extension: 'postgres_changes', status: 'ok', message: 'Subscribed to PostgreSQL' };

function arnes() {
    const remoto = crearSupabaseInsumos();
    const timers = new Map(), intervals = new Map(), escuchas = new Map();
    const forzadas = [], advertencias = [], otrasLecturas = [];
    let id = 0;
    const superficie = nombre => ({
        addEventListener(tipo, fn) {
            const key = nombre + ':' + tipo;
            if (!escuchas.has(key)) escuchas.set(key, []);
            escuchas.get(key).push(fn);
        },
        dispatchEvent(evento) { for (const fn of escuchas.get(nombre + ':' + evento.type) || []) fn(evento); }
    });
    const storage = () => {
        const mapa = new Map();
        return { get length() { return mapa.size; }, key: i => [...mapa.keys()][i] ?? null,
            getItem: k => mapa.get(k) ?? null, setItem: (k, v) => mapa.set(k, String(v)), removeItem: k => mapa.delete(k) };
    };
    remoto.cliente.channel = nombre => {
        const canal = { nombre, eventos: [], removido: false,
            on(tipo, filtro, fn) { this.eventos.push({ tipo, filtro, fn }); return this; },
            subscribe(fn) {
                assert.equal(this.eventos.filter(e => e.tipo === 'postgres_changes').length, 6);
                assert.equal(this.eventos.filter(e => e.tipo === 'system').length, 1);
                this.estado = fn;
                queueMicrotask(() => fn('SUBSCRIBED'));
                return this;
            },
            sistema(payload) { this.eventos.filter(e => e.tipo === 'system').forEach(e => e.fn(payload)); }
        };
        remoto.control.canales.push(canal);
        return canal;
    };
    const window = { ...superficie('window'), haikuSupabase: remoto.cliente,
        haikuSesion: { usuario: { id: 'operador' } }, crypto: webcrypto, innerWidth: 1400,
        localStorage: storage(), sessionStorage: storage(),
        HAIKU_ASEO_OPERACION_V1: { hidratar() { otrasLecturas.push('aseos'); } },
        HAIKU_REVISION_RESUMEN_SYNC_V2: { resincronizar() { otrasLecturas.push('revision'); } }
    };
    const document = { ...superficie('document'), readyState: 'complete', hidden: false,
        getElementById: () => null, querySelector: () => null, activeElement: null };
    const contexto = vm.createContext({ window, document, fechaSeleccionada: fecha, Date, Promise,
        CustomEvent: class { constructor(type, args) { this.type = type; this.detail = args?.detail; } },
        console: { info() {}, error() {}, warn(...args) { advertencias.push(args); } },
        setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
        setInterval(fn, ms) { intervals.set(++id, { fn, ms }); return id; }
    });
    vm.runInContext(insumos, contexto);
    const api = window.HAIKU_INSUMOS_ASEO_V1;
    window.HAIKU_INSUMOS_ASEO_V1 = { ...api, hidratar(f, opciones) {
        if (opciones?.forzar === true) forzadas.push(f);
        return api.hidratar(f, opciones);
    } };
    vm.runInContext(realtime, contexto);
    return { ...remoto, window, document, contexto, api, timers, intervals, escuchas, forzadas, advertencias, otrasLecturas,
        rt: window.HAIKU_ASEO_REALTIME_V1,
        get canal() { return remoto.control.canales.at(-1); },
        async cargar() { await api.hidratar(fecha); await siguiente(); },
        async timer(ms) {
            const entrada = [...timers].find(([, t]) => t.ms === ms);
            assert(entrada, 'Falta timer ' + ms);
            timers.delete(entrada[0]); await entrada[1].fn(); await siguiente();
        }
    };
}

test('SUBSCRIBED sólo conecta el canal; registra ambos callbacks antes de subscribe', async () => {
    const h = arnes(); await h.cargar();
    assert.equal(h.rt.estado(), 'SUBSCRIBED');
    assert.equal(h.rt.postgres_changes_ready, false);
    assert.equal(h.rt.estadoPostgresChanges(), 'ESPERANDO');
    h.canal.sistema({ extension: 'system', status: 'ok' });
    h.canal.sistema({ extension: 'postgres_changes', status: 'unknown' });
    assert.equal(h.rt.postgres_changes_ready, false);
    assert.equal(h.forzadas.length, 0);
});

test('primer system/ok fuerza una sola lectura de la fecha visible, sin escrituras ni otros módulos', async () => {
    const h = arnes(); await h.cargar();
    h.contexto.fechaSeleccionada = '2026-09-28';
    h.canal.sistema(listo); h.canal.sistema(listo); await siguiente();
    assert.equal(h.rt.postgres_changes_ready, true);
    assert.equal(h.rt.estadoPostgresChanges(), 'LISTO');
    assert.deepEqual(h.forzadas, ['2026-09-28']);
    assert.equal(h.control.escrituras.length, 0);
    assert.deepEqual(h.otrasLecturas, []);
    assert(![...h.timers.values()].some(t => t.ms === 10000));
});

test('la barrera recupera un cambio sin evento dentro del hueco', async () => {
    const h = arnes(); await h.cargar();
    h.filas.movimientos_insumos.push({ id: 'gap', fecha_operativa: fecha, cabana_id: 'cab-1',
        aseo_id: 'aseo', origen: 'aseo', insumo: 'carbon', cantidad: 7 });
    assert.equal(h.api.obtener(fecha, 1).carbon.cantidad, 0);
    h.canal.sistema(listo); await siguiente();
    assert.equal(h.api.obtener(fecha, 1).carbon.cantidad, 7);
    assert.equal(h.api.total(fecha).carbon, 7);
    assert.equal(h.control.escrituras.length, 0);
});

test('invalidar al recibir system/ok descarta una lectura anterior que estaba en vuelo', async () => {
    const h = arnes(); await h.cargar();
    let liberar;
    h.control.pausaLectura = new Promise(resolve => { liberar = resolve; });
    const lectura = h.api.hidratar(fecha); await siguiente();
    h.filas.movimientos_insumos.push({ id: 'gap', fecha_operativa: fecha, cabana_id: 'cab-1',
        aseo_id: 'aseo', origen: 'aseo', insumo: 'carbon', cantidad: 8 });
    h.canal.sistema(listo); liberar(); await lectura;
    assert.equal(h.api.obtener(fecha, 1).carbon.cantidad, 8);
    assert.equal(h.forzadas.length, 1);
});

test('un evento anterior a ready rehidrata sin marcar listo ni generar escrituras derivadas', async () => {
    const h = arnes(); await h.cargar();
    await h.cliente.rpc('haiku_reponer_insumo_aseo_v2', { p_fecha: fecha, p_cabana_id: 'cab-1',
        p_insumo: 'carbon', p_delta: 1, p_cantidad_esperada: 0, p_destino: 'aseo_full', p_cantidad_destino_esperada: 0 });
    await siguiente();
    assert.equal(h.rt.postgres_changes_ready, false);
    assert.equal(h.api.obtener(fecha, 1).carbon.cantidad, 1);
    assert.equal(h.control.escrituras.length, 1);
});

for (const estado of ['CHANNEL_ERROR', 'CLOSED', 'TIMED_OUT']) {
    test(estado + ' resetea ready; nuevo canal reconcilia y descarta callbacks del anterior', async () => {
        const h = arnes(); await h.cargar();
        const anterior = h.canal;
        anterior.sistema(listo); await siguiente();
        anterior.estado(estado);
        assert.equal(h.rt.postgres_changes_ready, false);
        await h.timer(800);
        assert.notEqual(h.canal, anterior);
        assert.equal(h.rt.postgres_changes_ready, false);
        anterior.sistema(listo);
        assert.equal(h.forzadas.length, 1);
        assert.equal(h.rt.postgres_changes_ready, false);
        h.canal.sistema(listo); h.canal.sistema(listo); await siguiente();
        assert.equal(h.forzadas.length, 2);
        assert.equal(h.control.canales.filter(c => !c.removido).length, 1);
        assert.equal(h.canal.eventos.filter(e => e.tipo === 'system').length, 1);
    });
}

test('resuscripción del mismo canal exige otro system/ok', async () => {
    const h = arnes(); await h.cargar();
    h.canal.sistema(listo); await siguiente();
    h.canal.estado('SUBSCRIBED');
    assert.equal(h.rt.postgres_changes_ready, false);
    h.canal.sistema(listo); h.canal.sistema(listo); await siguiente();
    assert.equal(h.forzadas.length, 2);
    assert.equal(h.control.canales.length, 1);
});

test('offline y cierre de sesión resetean ready y rechazan señales del canal anterior', async () => {
    const h = arnes(); await h.cargar();
    h.canal.sistema(listo);
    h.window.dispatchEvent({ type: 'offline' });
    assert.equal(h.rt.postgres_changes_ready, false);
    h.canal.sistema(listo);
    assert.equal(h.rt.postgres_changes_ready, false);
    h.window.haikuSesion = null;
    h.control.auth.forEach(fn => fn('SIGNED_OUT'));
    assert.equal(h.rt.estadoPostgresChanges(), 'DESCONECTADO');
    h.canal.sistema(listo);
    assert.equal(h.rt.postgres_changes_ready, false);
});

test('timeout de readiness degrada y lee una vez; una señal tardía reconcilia sin polling nuevo', async () => {
    const h = arnes(); await h.cargar();
    assert.equal(h.intervals.size, 1, 'Se conserva únicamente el respaldo móvil preexistente');
    assert.equal([...h.intervals.values()][0].ms, 4000);
    await h.timer(10000);
    assert.equal(h.rt.postgres_changes_ready, false);
    assert.equal(h.rt.estadoPostgresChanges(), 'DEGRADADO');
    assert.equal(h.forzadas.length, 1);
    assert.equal(h.advertencias.length, 1);
    assert.equal(h.control.escrituras.length, 0);
    h.canal.sistema(listo); await siguiente();
    assert.equal(h.rt.postgres_changes_ready, true);
    assert.equal(h.forzadas.length, 2);
});

test('system/error degrada y conserva el respaldo por foco sin declarar listo', async () => {
    const h = arnes(); await h.cargar();
    h.canal.sistema(listo); await siguiente();
    h.canal.sistema({ extension: 'postgres_changes', status: 'error', message: 'subscription error' });
    assert.equal(h.rt.postgres_changes_ready, false);
    h.window.dispatchEvent({ type: 'focus' }); await siguiente();
    assert([...h.timers.values()].some(t => t.ms === 80));
    assert.equal(h.control.canales.length, 1);
});

test('reinicializaciones simultáneas no duplican canales, listeners ni temporizadores', async () => {
    const h = arnes(); await h.cargar();
    const escuchas = () => [...h.escuchas.values()].reduce((n, e) => n + e.length, 0);
    const antes = escuchas();
    vm.runInContext(realtime, h.contexto);
    h.window.dispatchEvent({ type: 'haiku:auth-ready' });
    h.window.dispatchEvent({ type: 'haiku:auth-ready' });
    await siguiente();
    assert.equal(escuchas(), antes);
    assert.equal(h.control.canales.length, 1);
    assert.equal(h.canal.eventos.length, 7);
    assert.equal([...h.timers.values()].filter(t => t.ms === 10000).length, 1);
});

test('las cuatro operaciones locales funcionan antes de ready y releen después', async () => {
    const h = arnes(); await h.cargar();
    const lecturas = h.control.lecturas.filter(t => t === 'movimientos_insumos_resumen').length;
    await h.api.cambiar(fecha, 1, 'carbon', 1,'aseo_full');
    await h.api.agregarSaco(fecha, 1, 12.3,'aseo_full');
    const saco = h.api.obtener(fecha, 1).lena.sacos[0];
    await h.api.editarSaco(fecha, 1, saco.id, 12.4, saco.version);
    await h.api.anularSaco(fecha, 1, saco.id); await siguiente();
    assert.equal(h.rt.postgres_changes_ready, false);
    assert.equal(h.api.obtener(fecha, 1).carbon.cantidad, 1);
    assert.equal(h.api.obtener(fecha, 1).lena.cantidad, 0);
    assert.equal(h.control.escrituras.length, 4);
    assert(h.control.lecturas.filter(t => t === 'movimientos_insumos_resumen').length > lecturas);
});

for (const operacion of ['carbon', 'peso']) for (const code of ['40001', 'XX000']) {
    test(operacion + ': HTTP 500 / ' + code + ' distingue conflicto por código y relee sin reintentar RPC', async () => {
        const h = arnes(); await h.cargar();
        if (operacion === 'carbon') await h.api.cambiar(fecha, 1, 'carbon', 1,'aseo_full');
        else await h.api.agregarSaco(fecha, 1, 12.3,'aseo_full');
        await siguiente();
        const saco = h.api.obtener(fecha, 1).lena.sacos[0];
        // Cambio remoto sin evento: la relectura del catch/finally debe recuperarlo.
        if (operacion === 'carbon') h.filas.movimientos_insumos.find(f => f.insumo === 'carbon').cantidad = 7;
        else { h.filas.movimientos_insumos_unidades[0].peso_kg = 19; h.filas.movimientos_insumos_unidades[0].version++; }
        let llamadas = 0;
        h.cliente.rpc = async () => {
            llamadas++;
            return { status: 500, data: null, error: Object.assign(new Error('RPC rechazada'), { code }) };
        };
        const pendiente = operacion === 'carbon' ? h.api.cambiar(fecha, 1, 'carbon', 1,'aseo_full')
            : h.api.editarSaco(fecha, 1, saco.id, 20, saco.version);
        await assert.rejects(pendiente, error => error.code === code); await siguiente();
        const estado = h.api.obtener(fecha, 1);
        const mensaje = operacion === 'carbon' ? estado.carbon.error : estado.lena.error;
        if (code === '40001') assert.match(mensaje, /cambió en otro dispositivo/);
        else { assert.match(mensaje, /No se confirmó/); assert.doesNotMatch(mensaje, /cambió en otro dispositivo/); }
        if (operacion === 'carbon') assert.equal(estado.carbon.cantidad, 7);
        else assert.equal(estado.lena.pesoKg, 19);
        assert.equal(llamadas, 1);
    });
}
