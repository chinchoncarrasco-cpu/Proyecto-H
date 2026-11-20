const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { parseHTML } = require('linkedom');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/haiku-tareas-generales-v1.js'), 'utf8');
const esperar = () => new Promise(resolve => setImmediate(resolve));
const diferida = () => { let resolver; return { promesa: new Promise(r => { resolver = r; }), resolver: v => resolver(v) }; };
const tarea = (fecha = '2026-01-19', extra = {}) => ({ fecha_operativa: fecha, tipo: 'jardines_terraza', titulo: 'Jardines y terraza', descripcion: 'Sra. Naifi', encargado: 'Camila', revisor: 'Felipe', estado: 'pendiente', revision: 1, ...extra });
const datos = (fecha, extra = {}) => ({ fecha, puede_editar: true, puede_verificar: true, tareas: [tarea(fecha)], anteriores: [], ...extra });

async function entorno(handler) {
    const { document } = parseHTML('<html><body><section id="cabinsGeneralTasks"></section></body></html>');
    const eventos = new EventTarget();
    const window = { crypto: webcrypto, addEventListener: eventos.addEventListener.bind(eventos), dispatchEvent: eventos.dispatchEvent.bind(eventos) };
    const llamadas = [], almacen = new Map();
    let canalEliminado = 0;
    window.haikuSesion = { auth: { id: 'usuario-a' } };
    const apiCliente = {
        rpc: async (nombre, args) => {
            llamadas.push({ nombre, args: structuredClone(args) });
            return handler ? handler(nombre, args, almacen) : { data: almacen.get(args.p_fecha) || datos(args.p_fecha) };
        },
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => { canalEliminado++; }
    };
    window.haikuSupabase = apiCliente;
    const contexto = vm.createContext({ window, document, fechaSeleccionada: '2026-01-19', console, Intl, Date, setTimeout, clearTimeout });
    vm.runInContext(source, contexto);
    await esperar(); await esperar();
    return { window, document, contexto, api: window.HAIKU_TAREAS_GENERALES_V1, llamadas, almacen, canalEliminado: () => canalEliminado };
}

test('sólo confirma datos remotos y escapa nombres y notas al construir el DOM', async () => {
    const e = await entorno((n, a) => ({ data: datos(a.p_fecha, { tareas: [tarea(a.p_fecha, { encargado: '<img src=x onerror=alert(1)>', nota: '<script>falla()</script>' })] }) }));
    assert.equal(e.api.contexto().datos.tareas.length, 1);
    assert.equal(e.document.querySelector('img'), null);
    assert.equal(e.document.querySelector('script'), null);
    assert.match(e.document.querySelector('.tg-person').textContent, /<img/);
    assert.equal(e.llamadas.some(c => c.nombre.includes('guardar')), false);
});

test('una lectura atrasada de otro día nunca reemplaza el día seleccionado', async () => {
    const anterior = diferida();
    const e = await entorno((n, a) => a.p_fecha === '2026-01-18' ? anterior.promesa : { data: datos(a.p_fecha) });
    const p = e.api.cargar('2026-01-18');
    await e.api.cargar('2026-01-20');
    anterior.resolver({ data: datos('2026-01-18') }); await p;
    assert.equal(e.api.contexto().fecha, '2026-01-20');
    assert.equal(e.document.querySelector('[data-tg-key]').dataset.tgKey, '2026-01-20:jardines_terraza');
});

test('cambiar de cuenta invalida lecturas, borradores y canal de la cuenta anterior', async () => {
    const anterior = diferida(); let bloquear = false;
    const e = await entorno((n, a) => bloquear ? anterior.promesa : { data: datos(a.p_fecha) });
    bloquear = true; const p = e.api.cargar('2026-01-19', { forzar: true });
    e.window.haikuSesion = { auth: { id: 'usuario-b' } }; bloquear = false;
    await e.api.cargar('2026-01-20');
    anterior.resolver({ data: datos('2026-01-19', { tareas: [tarea('2026-01-19', { encargado: 'Dato de cuenta anterior' })] }) }); await p;
    assert.equal(e.api.contexto().usuario, 'usuario-b');
    assert.equal(e.api.contexto().fecha, '2026-01-20');
    assert.doesNotMatch(e.document.body.textContent, /Dato de cuenta anterior/);
    assert.equal(e.canalEliminado(), 1);
});

test('doble pulsación usa un solo writer y el estado no cambia antes de la confirmación', async () => {
    const escritura = diferida(); let confirmada = false;
    const e = await entorno((n, a) => n.includes('guardar') ? escritura.promesa : { data: datos(a.p_fecha, { tareas: [tarea(a.p_fecha, { estado: confirmada ? 'en_curso' : 'pendiente', revision: confirmada ? 2 : 1 })] }) });
    const a = e.api.guardar('2026-01-19:jardines_terraza', 'iniciar');
    const b = e.api.guardar('2026-01-19:jardines_terraza', 'iniciar');
    await b;
    assert.equal(e.llamadas.filter(c => c.nombre.includes('guardar')).length, 1);
    assert.equal(e.api.contexto().datos.tareas[0].estado, 'pendiente');
    confirmada = true; escritura.resolver({ data: { tarea: tarea('2026-01-19', { estado: 'en_curso', revision: 2 }) } }); await a;
    assert.equal(e.api.contexto().datos.tareas[0].estado, 'en_curso');
    assert.match(e.document.body.textContent, /Tarea iniciada/);
});

test('si cambia el día mientras guarda, la respuesta no devuelve la interfaz al día anterior', async () => {
    const escritura = diferida();
    const e = await entorno((n, a) => n.includes('guardar') ? escritura.promesa : { data: datos(a.p_fecha) });
    const p = e.api.guardar('2026-01-19:jardines_terraza', 'iniciar');
    await e.api.cargar('2026-01-20');
    escritura.resolver({ data: { tarea: tarea('2026-01-19', { revision: 2 }) } }); await p;
    assert.equal(e.api.contexto().fecha, '2026-01-20');
    assert.equal(e.api.contexto().datos.fecha, '2026-01-20');
});

test('un rechazo no muestra éxito y un fallo de transporte conserva el mismo UUID al reintentar', async () => {
    let intentos = 0;
    const e = await entorno((n, a) => {
        if (!n.includes('guardar')) return { data: datos(a.p_fecha) };
        if (++intentos === 1) throw new Error('Conexión interrumpida');
        return { data: { tarea: tarea(a.p_fecha, { revision: 2 }) } };
    });
    await e.api.guardar('2026-01-19:jardines_terraza', 'iniciar');
    assert.doesNotMatch(e.document.body.textContent, /Tarea iniciada/);
    await e.api.guardar('2026-01-19:jardines_terraza', '', {}, true);
    const escrituras = e.llamadas.filter(c => c.nombre.includes('guardar'));
    assert.equal(escrituras.length, 2);
    assert.deepEqual(escrituras[0].args, escrituras[1].args);
});

test('una actualización mientras escribe exige revisar el conflicto antes de guardar', async () => {
    let revision = 1;
    const e = await entorno((n, a) => ({ data: datos(a.p_fecha, { tareas: [tarea(a.p_fecha, { revision })] }) }));
    const raiz = e.document.querySelector('#cabinsGeneralTasks');
    raiz.insertAdjacentHTML('beforeend', '<input id="edicion">');
    e.document.activeElement = e.document.querySelector('#edicion');
    revision = 2; await e.api.cargar('2026-01-19', { forzar: true });
    assert.equal(e.document.querySelector('[data-tg-key]').dataset.tgRevision, '1');
    await e.api.guardar('2026-01-19:jardines_terraza', 'asignar', { encargado: 'Nombre obsoleto' });
    assert.equal(e.llamadas.filter(c => c.nombre.includes('guardar')).length, 0);
    assert.equal(e.document.querySelector('[data-tg-key]').dataset.tgRevision, '2');
});

test('sólo lectura bloquea el writer incluso si se invoca directamente', async () => {
    const e = await entorno((n, a) => ({ data: datos(a.p_fecha, { puede_editar: false, puede_verificar: false }) }));
    await e.api.guardar('2026-01-19:jardines_terraza', 'verificar');
    assert.equal(e.llamadas.filter(c => c.nombre.includes('guardar')).length, 0);
});

test('un refresco conserva el botón enfocado para no interrumpir la pulsación', async () => {
    const e = await entorno();
    const boton = e.document.querySelector('[data-tg-open]');
    e.document.activeElement = boton;
    await e.api.cargar('2026-01-19', { forzar: true });
    assert.equal(e.document.querySelector('[data-tg-open]'), boton);
});
