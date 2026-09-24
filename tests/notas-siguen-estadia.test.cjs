const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const notas = fs.readFileSync(
    require.resolve('../js/supabase-notas-resumen-v1.js'),
    'utf8'
);
const app = fs.readFileSync(require.resolve('../js/app.js'), 'utf8');
function resolverHarness(estadias, numeros) {
    const inicio = notas.indexOf('    function fechaDentroEstadia');
    const fin = notas.indexOf('    async function migrarNotasLocales', inicio);
    assert.ok(inicio >= 0 && fin > inicio);
    const context = vm.createContext({
        estadiasPorId: new Map(),
        estadiasPorReserva: new Map(),
        numerosPorCabana: new Map(Object.entries(numeros))
    });
    vm.runInContext(
        `${notas.slice(inicio, fin)}; globalThis.api={resolverCabanaIdNota,notaLocalDesdeFila};`,
        context
    );
    context.estadias = estadias;
    vm.runInContext('registrarEstadias(estadias)', context);
    return context.api;
}

test('Resumen ubica la nota por la cabaña actual de su estadía', () => {
    assert.match(notas, /id,reserva_id,estadia_id,cabana_id,fecha_operacion/);
    assert.match(notas, /function resolverCabanaIdNota\(fila\)[\s\S]*?estadiaActualDeNota\(fila\)\?\.cabana_id/);
    assert.match(notas, /candidatas\.length === 1 \? candidatas\[0\] : null/);
    assert.match(notas, /estadiaId: estadia\?\.id \|\| fila\.estadia_id/);

    const e2 = {
        id: 'E2', reserva_id: 'R1', cabana_id: 'C7',
        fecha_ingreso: '2026-09-17', fecha_salida: '2026-09-20',
        estado_estadia: 'confirmada'
    };
    const api = resolverHarness([
        {...e2, id: 'E1', cabana_id: 'C2'},
        e2
    ], {C1: '1', C2: '2', C7: '7'});
    const nota = api.notaLocalDesdeFila({
        id: 'N1', reserva_id: 'R1', estadia_id: 'E2', cabana_id: 'C1',
        fecha_operacion: '2026-09-18', texto: 'CAMA ADICIONAL'
    });
    assert.equal(nota.cabana, '7');
    assert.equal(nota.estadiaId, 'E2');
});

test('sin estadía inequívoca no mezcla notas de una reserva multicabaña', () => {
    const api = resolverHarness([
        {id:'E1',reserva_id:'R1',cabana_id:'C2',fecha_ingreso:'2026-09-17',fecha_salida:'2026-09-20',estado_estadia:'confirmada'},
        {id:'E2',reserva_id:'R1',cabana_id:'C7',fecha_ingreso:'2026-09-17',fecha_salida:'2026-09-20',estado_estadia:'confirmada'}
    ], {C1:'1',C2:'2',C7:'7'});
    assert.equal(api.resolverCabanaIdNota({
        reserva_id:'R1',cabana_id:'C1',fecha_operacion:'2026-09-18'
    }), 'C1');
    assert.equal(api.resolverCabanaIdNota({
        cabana_id:'C1',fecha_operacion:'2026-09-18'
    }), 'C1');
});

test('las notas nuevas guardan la estadía concreta además de la reserva', () => {
    assert.ok(app.includes('reservaId: identidadNota ? identidadNota.reservaId : cabana.reservaId || ""'));
    assert.ok(app.includes('estadiaId: identidadNota ? identidadNota.estadiaId : cabana.estadiaId || ""'));
    assert.match(notas, /registro\.estadia_id = estadiaActual/);
    assert.match(notas, /registro\.estadia_id = estadiaId/);
});
