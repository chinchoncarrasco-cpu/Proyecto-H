const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const codigo = fs.readFileSync(path.join(__dirname,
    '../js/supabase-resumen-tablero-v1.js'), 'utf8');
const inicio = codigo.indexOf('    function navegarHoy()');
const fin = codigo.indexOf('    function alternarDetalle(', inicio);
assert.ok(inicio >= 0 && fin > inicio);

test('Hoy usa la fecha de America/Santiago aun cerca de medianoche UTC', () => {
    let argumentos;
    class FechaFija extends Date {
        constructor(...valores) {
            super(...(valores.length ? valores : ['2026-09-25T02:30:00.000Z']));
        }
    }
    const contexto = vm.createContext({
        Date: FechaFija, Intl, Object, Number,
        seleccionarDia: (...valores) => { argumentos = valores; },
        mostrarNavegacionCargando: () => {},
        window: { HAIKU_RESUMEN_REFRESH_V1: { activo: () => true } }
    });
    vm.runInContext(`${codigo.slice(inicio, fin)}; navegarHoy();`, contexto);
    assert.deepEqual(argumentos.slice(0, 4), [2026, 8, 24, '2026-09-24']);
    assert.equal(argumentos[4].evento, 'Hoy');
});
