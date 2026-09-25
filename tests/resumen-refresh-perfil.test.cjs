const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const codigo = fs.readFileSync(path.join(__dirname,
    '../js/supabase-resumen-refresh-v1.js'), 'utf8');
const dormir = ms => new Promise(resolve => setTimeout(resolve, ms));

test('perfil de primera carga registra la barrera y las fases dependientes', async () => {
    const clases = new Set(['haiku-resumen-pendiente']);
    const document = {
        readyState: 'complete',
        documentElement: { classList: { add: x => clases.add(x), remove: x => clases.delete(x) } },
        getElementById: () => null,
        querySelectorAll: () => [], querySelector: () => null
    };
    const window = {
        haikuSesion: null,
        addEventListener() {}
    };
    const contexto = vm.createContext({ window, document, console, queueMicrotask,
        performance, Date, Intl, setTimeout, fechaSeleccionada: '2026-09-24' });
    vm.runInContext(codigo, contexto);
    const api = window.HAIKU_RESUMEN_REFRESH_V1;
    const latencias = {
        reservas: 45, servicios: 35, pagos: 0, checkout: 50,
        checkoutAutoridad: 125, operacion: 40, autoridadVisual: 0,
        tablero: 20, notas: 30, aseo: 25, revision: 30
    };
    const visibles = [];
    for (const [nombre, ms] of Object.entries(latencias)) {
        api.registrar(nombre, {
            obligatoria: !['notas', 'aseo', 'revision'].includes(nombre),
            orden: nombre === 'pagos' ? 30 : nombre === 'tablero' ? 100 : 10,
            dependencias: nombre === 'pagos' ? ['operacion'] :
                nombre === 'tablero' ? ['operacion', 'pagos'] : [],
            preparar: async () => { await dormir(ms); return nombre; },
            ...(nombre === 'pagos' ? { completar: async () => {
                await dormir(85); return 'pagos-listos';
            } } : {}),
            ...(nombre === 'tablero' ? { completar: async () => {
                await dormir(5); return 'tablero-listo';
            } } : {}),
            publicar: snapshot => visibles.push(`${snapshot.generacion}:${nombre}`)
        });
    }
    window.haikuSesion = { auth: { id: 'usuario-perfil' } };
    assert.equal(await api.solicitar(), true);
    const perfil = api.diagnostico();
    for (const nombre of Object.keys(latencias)) {
        assert.ok(perfil.fuentes[nombre].preparar.inicio);
        assert.ok(perfil.fuentes[nombre].preparar.fin);
        assert.equal(perfil.fuentes[nombre].preparar.estado, 'éxito');
    }
    assert.ok(perfil.fuentes.checkoutAutoridad.preparar.duracionMs >= 110);
    assert.ok(perfil.fuentes.pagos.completar.duracionMs >= 75);
    assert.ok(Date.parse(perfil.fuentes.pagos.completar.inicio) <
        Date.parse(perfil.fuentes.checkoutAutoridad.preparar.fin),
    'pagos empieza tras operación mientras autoridad checkout aún se prepara');
    assert.ok(perfil.snapshotMs < perfil.fuentes.checkoutAutoridad.preparar.duracionMs +
        perfil.fuentes.pagos.completar.duracionMs + 10,
    'la consulta de pagos ya no se suma a toda la barrera inicial');
    assert.ok(perfil.visibleMs >= perfil.snapshotMs);
    assert.equal(perfil.resultado, 'publicado');
    assert.equal(api.publicaciones(), 1);
    assert.equal(visibles.length, Object.keys(latencias).length);
    assert.equal(clases.has('haiku-resumen-pendiente'), false);
});
