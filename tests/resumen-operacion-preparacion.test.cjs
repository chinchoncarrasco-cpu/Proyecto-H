const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fuente = fs.readFileSync(require.resolve('../js/supabase-data.js'), 'utf8');
const inicio = fuente.indexOf('    async function prepararOperacionResumen');
const fin = fuente.indexOf('    function publicarOperacionResumen', inicio);
assert.ok(inicio >= 0 && fin > inicio);
const codigo = fuente.slice(inicio, fin);

test('la operación no prepara un candidato antes de conocer las estadías', async () => {
    let entregarEstadias;
    const estadias = new Promise(resolve => { entregarEstadias = resolve; });
    const mutaciones = [];
    const contexto = vm.createContext({
        cliente: { rpc: async () => ({ data: [
            { numero: 1, ingreso_estadia_id: 'estadia-1' },
            { numero: 2, estado_operativo: 'libre-libre' }
        ], error: null }) },
        cargarDetallesEstadias: () => estadias,
        document: { querySelectorAll: () => [
            { dataset: { cabana: '1' } }, { dataset: { cabana: '2' } }
        ], getElementById: () => { mutaciones.push('escritura'); } }
    });
    vm.runInContext(`${codigo}; globalThis.preparar = prepararOperacionResumen`, contexto);
    let completo = false;
    const candidato = contexto.preparar({ fecha: '2026-09-12' }).then(valor => {
        completo = true;
        return valor;
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(completo, false);
    assert.deepEqual(mutaciones, []);
    entregarEstadias(new Map([['estadia-1', { id: 'estadia-1' }]]));
    const resultado = await candidato;
    assert.equal(resultado.filas.length, 2);
    assert.equal(resultado.estadiasPorId.get('estadia-1').id, 'estadia-1');
    assert.deepEqual(mutaciones, []);
});

test('una operación sin todas las filas visibles no puede publicarse', async () => {
    const contexto = vm.createContext({
        cliente: { rpc: async () => ({ data: [{ numero: 1 }], error: null }) },
        cargarDetallesEstadias: async () => new Map(),
        document: { querySelectorAll: () => [
            { dataset: { cabana: '1' } }, { dataset: { cabana: '2' } }
        ] }
    });
    vm.runInContext(`${codigo}; globalThis.preparar = prepararOperacionResumen`, contexto);
    await assert.rejects(contexto.preparar({ fecha: '2026-09-12' }),
        /no contiene todas las cabañas/);
});

test('una estadía ausente en la respuesta impide publicar identidad provisional', async () => {
    const contexto = vm.createContext({
        cliente: { rpc: async () => ({ data: [
            { numero: 1, ingreso_estadia_id: 'estadia-sin-detalle' }
        ], error: null }) },
        cargarDetallesEstadias: async () => new Map(),
        document: { querySelectorAll: () => [{ dataset: { cabana: '1' } }] }
    });
    vm.runInContext(`${codigo}; globalThis.preparar = prepararOperacionResumen`, contexto);
    await assert.rejects(contexto.preparar({ fecha: '2026-09-12' }),
        /estadías sin detalle verificable/);
});
