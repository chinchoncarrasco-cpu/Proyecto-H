const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Cierre monta la plantilla antes de cargar respuestas y el panel conserva el orden', () => {
    const html = read('index.html');
    const panel = read('panel.html');
    const ordered = ['cierre-plantilla-v1', 'sites-cierre-v1', 'cierre', 'cierre-personificar-v1'];
    for (const script of ordered) {
        assert.ok(html.includes(`src="js/${script}.js"`));
        assert.ok(panel.includes(`"${script}"`));
    }
    const indices = ordered.map(name => html.indexOf(`src="js/${name}.js"`));
    assert.ok(indices[0] < indices[1] && indices[1] < indices[2]);
    assert.ok(panel.indexOf("'supabase-cierre-v1'") < panel.indexOf("'supabase-cierre-final-v1'"));
    assert.doesNotThrow(() => new Function(panel.match(/<script>([\s\S]*?)<\/script>/)[1]));
    assert.doesNotMatch(html.slice(html.indexOf('id="seccion-cierre"'), html.indexOf('id="seccion-pagos"')),
        /class="cierre-cabana-card"|Impresión de caja/);
});

test('La plantilla general conserva los códigos y opciones de respuesta de los cierres anteriores', () => {
    const context = { window: {} };
    vm.runInNewContext(read('js/cierre-plantilla-v1.js'), context);
    const p = JSON.parse(JSON.stringify(context.window.HAIKU_CIERRE_PLANTILLA_V1));
    assert.deepEqual(p.controles.map(grupo => grupo.id), ['recepcion', 'caja', 'instalaciones']);
    assert.equal(p.entrega.id, 'entrega');
    assert.deepEqual(p.base.grupos.map(grupo => grupo.id), ['recepcion', 'llaves', 'caja', 'instalaciones']);
    const campos = Object.values(p.campos);
    assert.equal(campos.length, 18);
    assert.equal(new Set(campos.map(item => item.campo)).size, campos.length);
    assert.deepEqual(campos.filter(item => item.opciones).map(item => [item.codigo, item.opciones.map(([id]) => id)]), [
        ['salida_temprana', ['si', 'no-hay']], ['salio_antes', ['si', 'no']],
        ['detalles_cabanas', ['si', 'pendientes']], ['pendientes_hacer', ['si', 'no']], ['hay_novedades', ['si', 'no']]
    ]);
    assert.deepEqual(p.controles.flatMap(g => g.items).filter(i => i.evidencia).map(i => i.evidencia.id), [
        'registro', 'cloudbeds-reserva', 'cloudbeds-pago', 'manager-pagos', 'manager-caja'
    ]);
    assert.deepEqual(p.controles[1].items.filter(item => item.permiso).map(item => item.permiso),
        ['cierres.validar_pagos', 'cierres.validar_caja', 'cierres.validar_vale_salida']);
    assert.ok(campos.every(({ texto, evidencia }) => !/impres|manager|cloudbeds|vale de salida/i.test(
        [texto, evidencia?.titulo].filter(Boolean).join(' ')
    )));
    assert.deepEqual(p.inventario.llaves.map(([id]) => id),
        ['tonel', 'jacuzzi', 'lavanderia', 'masajes', 'generadores', 'jardineria', 'marcelo', 'cisterna', 'internet', 'gas11', 'torreon']);
    assert.deepEqual(p.unidades.items.map(([id]) => id), ['perillas', 'gas', 'refri', 'calefactor', 'tv', 'ac', 'luces']);
});

test('La finalización y la reapertura pasan por Supabase y por los diálogos de confirmación', () => {
    const final = read('js/supabase-cierre-final-v1.js');
    for (const nombre of ['haiku_estado_cierre_dia', 'haiku_cerrar_turno_personificado_v1', 'haiku_reabrir_cierre_dia']) {
        assert.ok(final.includes(nombre));
    }
    assert.match(final, /if \(!\(await window\.HAIKU_DIALOGOS\.confirmar\(pregunta,[\s\S]+?\}\)\)\) return/);
    assert.match(final, /if \(pendientes > 0 && !texto\)/);
    assert.match(final, /await window\.haikuEsperarGuardadosCierre/);
    assert.match(final, /puedeReabrirLocal/);
    assert.doesNotMatch(read('js/sites-cierre-v1.js'), /\.rpc\(|\.from\(/);
});

test('Listado visual de respaldos lee cero, uno o varios sin subir ni eliminar archivos', async () => {
    let rows = [];
    const calls = [];
    const query = {
        select(columns) { calls.push(['select', columns]); return this; },
        eq(column, value) { calls.push(['eq', column, value]); return this; },
        async order(column, options) {
            calls.push(['order', column, options.ascending]);
            return { data: rows, error: null };
        }
    };
    const client = {
        async rpc(name, args) {
            calls.push(['rpc', name, args]);
            return { data: { cierre_id: 'cierre-1' }, error: null };
        },
        from(table) { calls.push(['from', table]); return query; },
        storage: { from(bucket) {
            calls.push(['bucket', bucket]);
            return { async createSignedUrl(storagePath) {
                calls.push(['sign', storagePath]);
                return { data: { signedUrl: `https://evidence.invalid/${storagePath}` }, error: null };
            } };
        } }
    };
    const context = { window: { haikuSupabase: client }, console };
    vm.runInNewContext(read('js/supabase-cierre-evidencias-v1.js'), context);
    const list = context.window.HAIKU_CIERRE_EVIDENCIAS_V1.listar;
    assert.equal((await list('2026-09-24', 'registro')).length, 0);
    rows = [{ storage_path: 'primera.png', creado_en: '2026-09-24T12:00:00Z' }];
    assert.equal((await list('2026-09-24', 'registro')).length, 1);
    rows = [...rows, { storage_path: 'segunda.png', creado_en: '2026-09-24T11:00:00Z' }];
    const result = await list('2026-09-24', 'registro');
    assert.equal(result.length, 2);
    assert.ok(result[1].url.endsWith('/segunda.png'));
    assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'descripcion' && call[2] === 'cierre:registro'));
    assert.ok(calls.every(call => !['insert', 'upload', 'update', 'delete'].includes(call[0])));
});
