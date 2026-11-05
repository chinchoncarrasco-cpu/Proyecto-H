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

test('seleccionar otro día prepara el Resumen y deja las consultas de otras secciones para su apertura', () => {
    const calendario = fs.readFileSync(path.join(__dirname, '../js/calendario.js'), 'utf8');
    const inicio = calendario.indexOf('function seleccionarDia(');
    const regreso = calendario.indexOf('        return;', inicio);
    const fin = calendario.indexOf('    fechaSeleccionada = fechaISO;', regreso);
    assert.ok(inicio >= 0 && fin > inicio);
    const llamadas = [];
    const contexto = vm.createContext({
        window: { HAIKU_RESUMEN_REFRESH_V1: {
            activo: () => true, publicando: () => false,
            solicitar: fecha => llamadas.push(['resumen', fecha])
        } },
        document: {
            querySelectorAll: () => [],
            getElementById: () => null,
            querySelector: () => null
        },
        guardarContextoFechas() {},
        renderizarAgendaServicios: () => llamadas.push(['servicios']),
        cargarAbonosPagos: () => llamadas.push(['pagos']),
        cargarCierreDia: () => llamadas.push(['cierre']),
        actualizarCierreTurno: () => llamadas.push(['estado cierre'])
    });
    vm.runInContext(calendario.slice(inicio, fin) + '} seleccionarDia(2026, 10, 6, "2026-11-06");', contexto);
    assert.equal(contexto.fechaSeleccionada, '2026-11-06');
    assert.deepEqual(llamadas, [['resumen', '2026-11-06']]);
});

test('publicar los datos de un día no abre consultas de detalle de Pagos', () => {
    const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
    const inicio = app.indexOf('function cargarDatosDia(fecha)');
    const fin = app.indexOf('// ========================================', inicio);
    const consultas = [];
    const contexto = vm.createContext({
        window: { HAIKU_RESUMEN_REFRESH_V1: { activo: () => true } },
        obtenerDatosDia: () => ({ notas: 'Nota del turno', mantencion: '', lavanderia: '' }),
        notasDia: {}, resumenMantencion: {}, resumenLavanderia: {},
        mostrarNotasOperativas: fecha => consultas.push(['notas', fecha]),
        cargarAbonosPagos: () => consultas.push(['abonos']),
        cargarSaldosCheckin: () => consultas.push(['saldos'])
    });
    vm.runInContext(app.slice(inicio, fin) + 'cargarDatosDia("2026-11-06");', contexto);
    assert.equal(contexto.notasDia.value, 'Nota del turno');
    assert.deepEqual(consultas, [['notas', '2026-11-06']]);
    contexto.window.HAIKU_RESUMEN_REFRESH_V1.activo = () => false;
    vm.runInContext('cargarDatosDia("2026-11-07");', contexto);
    assert.deepEqual(consultas.slice(-3), [['notas', '2026-11-07'], ['abonos'], ['saldos']]);
});
