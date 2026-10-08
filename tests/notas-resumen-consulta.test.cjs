const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fuente = fs.readFileSync(require.resolve('../js/supabase-notas-resumen-v1.js'), 'utf8');
const ids = {
    cabana1: '11111111-1111-4111-8111-111111111111',
    cabana7: '77777777-7777-4777-8777-777777777777',
    reserva: '22222222-2222-4222-8222-222222222222',
    estadia: '33333333-3333-4333-8333-333333333333'
};
const nota = (campos = {}) => ({
    id: 'nota-1', tipo: 'operativa_resumen', fecha_operacion: '2026-10-07',
    cabana_id: ids.cabana1, texto: 'Cama adicional\nCoordinar antes de las 18:00.',
    creado_en: '2026-10-07T10:00:00Z', ...campos
});
const estadia = (campos = {}) => ({
    id: ids.estadia, reserva_id: ids.reserva, cabana_id: ids.cabana7,
    fecha_ingreso: '2026-10-06', fecha_salida: '2026-10-09',
    estado_estadia: 'confirmada', ...campos
});

function escenario({ notas = [], estadias = [], fallarEn = '' } = {}) {
    const consultas = [];
    const escrituras = [];
    const tablas = {
        cabanas: [
            { id: ids.cabana1, numero: 1, activa: true },
            { id: ids.cabana7, numero: 7, activa: true }
        ], notas, reserva_estadias: estadias
    };
    const prohibido = nombre => () => {
        escrituras.push(nombre);
        throw new Error(`La lectura llamó ${nombre}`);
    };
    const cliente = {
        rpc: prohibido('rpc'),
        from(tabla) {
            const consulta = { tabla, filtros: [] };
            const query = {
                select(columnas) { consulta.columnas = columnas; return query; },
                eq(campo, valor) { consulta.filtros.push({ campo, valor, tipo: 'eq' }); return query; },
                in(campo, valor) { consulta.filtros.push({ campo, valor: [...valor], tipo: 'in' }); return query; },
                order(campo) { consulta.orden = campo; return query; },
                then(resolve, reject) {
                    consultas.push(consulta);
                    const data = (tablas[tabla] || []).filter(fila => consulta.filtros.every(filtro =>
                        filtro.tipo === 'in' ? filtro.valor.includes(fila[filtro.campo]) : fila[filtro.campo] === filtro.valor
                    ));
                    if (consulta.orden) data.sort((a, b) => String(a[consulta.orden]).localeCompare(String(b[consulta.orden])));
                    return Promise.resolve({ data, error: tabla === fallarEn ? new Error(`Error de lectura ${tabla}`) : null }).then(resolve, reject);
                }
            };
            for (const metodo of ['insert', 'upsert', 'update', 'delete']) query[metodo] = prohibido(metodo);
            return query;
        }
    };
    const window = {
        haikuSupabase: cliente, haikuSesion: null, addEventListener() {},
        HAIKU_RESUMEN_REFRESH_V1: {
            activo: () => true, registrar() {}, solicitar: prohibido('refresh coordinado')
        }
    };
    vm.runInNewContext(fuente.slice(0, fuente.indexOf('// Carga desacoplada')), {
        window, document: { addEventListener() {} }, console, setTimeout, clearTimeout,
        obtenerDatosDia: prohibido('obtenerDatosDia'), guardarDatos: prohibido('guardarDatos'),
        mostrarNotasOperativas: prohibido('repintar'),
        localStorage: { getItem: prohibido('leer caché de migración'), setItem: prohibido('guardar caché') }
    });
    return { api: window.HAIKU_NOTAS_RESUMEN_SUPABASE_V1, consultas, escrituras };
}

test('consulta sólo notas operativas de la fecha solicitada, ordenadas y sin escrituras', async () => {
    const caso = escenario({ notas: [
        nota({ id: 'segunda', creado_en: '2026-10-07T11:00:00Z' }),
        nota({ id: 'otra-fecha', fecha_operacion: '2026-10-08' }),
        nota({ id: 'otro-tipo', tipo: 'interna' }),
        nota({ id: 'primera' })
    ] });
    const resultado = await caso.api.consultar('2026-10-07');
    assert.deepEqual(Array.from(resultado, fila => fila.id), ['primera', 'segunda']);
    assert.equal(resultado[0].texto, nota().texto, 'conserva saltos de línea y texto íntegro');
    assert.equal(resultado[0].cabana, '1');
    assert.equal(resultado[0].haikuFuente, 'supabase');
    assert.deepEqual(caso.consultas.find(c => c.tabla === 'notas').filtros, [
        { campo: 'tipo', valor: 'operativa_resumen', tipo: 'eq' },
        { campo: 'fecha_operacion', valor: '2026-10-07', tipo: 'eq' }
    ]);
    assert.deepEqual(caso.escrituras, [], 'no llama migración, refresh, caché, RPC ni publicación');
    for (const nombre of ['guardar', 'eliminar', 'refrescar']) assert.equal(typeof caso.api[nombre], 'function');
});

test('la consulta del asistente sigue la cabaña actual de la estadía', async () => {
    const caso = escenario({
        notas: [nota({ reserva_id: ids.reserva, estadia_id: ids.estadia })],
        estadias: [estadia()]
    });
    const [resultado] = await caso.api.consultar('2026-10-07');
    assert.equal(resultado.cabana, '7');
    assert.equal(resultado.reservaId, ids.reserva);
    assert.equal(resultado.estadiaId, ids.estadia);
    assert.equal(caso.consultas.filter(c => c.tabla === 'reserva_estadias').length, 2);
    assert.deepEqual(caso.escrituras, []);
});

test('una reserva multicabaña ambigua conserva la cabaña original', async () => {
    const caso = escenario({
        notas: [nota({ reserva_id: ids.reserva })],
        estadias: [
            estadia(),
            estadia({ id: '44444444-4444-4444-8444-444444444444', cabana_id: 'otra-cabana' })
        ]
    });
    const [resultado] = await caso.api.consultar('2026-10-07');
    assert.equal(resultado.cabana, '1');
    assert.equal(resultado.estadiaId, '');
});

test('lecturas simultáneas de dos fechas mantienen su contexto de estadías aislado', async () => {
    const otraEstadia = '44444444-4444-4444-8444-444444444444';
    const caso = escenario({
        notas: [
            nota({ reserva_id: ids.reserva, estadia_id: ids.estadia }),
            nota({ id: 'nota-2', fecha_operacion: '2026-10-08', reserva_id: ids.reserva, estadia_id: otraEstadia })
        ],
        estadias: [estadia(), estadia({ id: otraEstadia, cabana_id: ids.cabana1 })]
    });
    const [dia1, dia2] = await Promise.all([caso.api.consultar('2026-10-07'), caso.api.consultar('2026-10-08')]);
    assert.equal(dia1[0].cabana, '7');
    assert.equal(dia2[0].cabana, '1');
    assert.equal(dia1.length, 1);
    assert.equal(dia2.length, 1);
    assert.deepEqual(caso.escrituras, []);
});

test('sin notas devuelve vacío sin consultar estadías ni ejecutar migración', async () => {
    const caso = escenario();
    assert.equal((await caso.api.consultar('2026-10-07')).length, 0);
    assert.deepEqual(caso.consultas.map(c => c.tabla), ['cabanas', 'notas']);
    assert.deepEqual(caso.escrituras, []);
});

test('no permite una consulta sin fecha ni un filtro de fecha incompleto', async () => {
    const caso = escenario();
    for (const fecha of ['', undefined, '07/10/2026', '2026-10-07 extra']) {
        await assert.rejects(caso.api.consultar(fecha), /requiere una fecha/);
    }
    assert.deepEqual(caso.consultas, []);
});

for (const tabla of ['cabanas', 'notas', 'reserva_estadias']) {
    test(`un error al leer ${tabla} se propaga sin ocultarlo como cero notas`, async () => {
        const caso = escenario({
            notas: [nota({ estadia_id: ids.estadia })], estadias: [estadia()], fallarEn: tabla
        });
        await assert.rejects(caso.api.consultar('2026-10-07'), new RegExp(`Error de lectura ${tabla}`));
        assert.deepEqual(caso.escrituras, []);
    });
}
