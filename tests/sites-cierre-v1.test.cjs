const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/sites-cierre-v1.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'js/sites-cierre-v1.js'), 'utf8');
const final = fs.readFileSync(path.join(root, 'js/supabase-cierre-final-v1.js'), 'utf8');
const writer = fs.readFileSync(path.join(root, 'js/supabase-cierre-v1.js'), 'utf8');
const evidence = fs.readFileSync(path.join(root, 'js/supabase-cierre-evidencias-v1.js'), 'utf8');
const legacyClosing = fs.readFileSync(path.join(root, 'js/cierre.js'), 'utf8');
const refresh = fs.readFileSync(path.join(root, 'js/supabase-cierre-autorefresh-v1.js'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'panel.html'), 'utf8');

test('Cierre Sites tiene shell estático y oculta legacy antes de JS', () => {
    assert.match(html, /id="seccion-cierre"[^>]*sites-cierre-pending/);
    for (const id of ['sites-cierre-estado', 'sites-cierre-progress-slot', 'sites-cierre-stages',
        'sites-cierre-final-slot']) assert.ok(html.includes(`id="${id}"`));
    assert.match(css, /#seccion-cierre \.sites-cierre-legacy\s*\{\s*display:none!important/);
    assert.ok(html.includes('<link rel="stylesheet" href="css/sites-cierre-v1.css">'));
    assert.ok(panel.includes('css/sites-cierre-v1.css'));
    assert.ok(html.indexOf('src="js/cierre.js"') < html.indexOf('src="js/sites-cierre-v1.js"'));
    assert.ok(panel.indexOf("'supabase-cierre-v1'") < panel.indexOf("'supabase-cierre-final-v1'"));
    const bootstrap = panel.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(bootstrap);
    assert.doesNotThrow(() => new Function(bootstrap));
});

test('Cierre conserva los 4 controles de etapa y las 11 cabañas reales', () => {
    const section = html.slice(html.indexOf('<section id="seccion-cierre"'), html.indexOf('<section id="seccion-pagos"'));
    assert.equal((section.match(/class="cierre-etapa"/g) || []).length, 4);
    assert.equal((section.match(/class="cierre-cabana-card"/g) || []).length, 11);
    for (const name of ['salida-temprana', 'salio-antes', 'detalles-cabanas', 'pendientes-hacer', 'hay-novedades'])
        assert.ok(section.includes(`name="${name}"`));
    for (const name of ['registro-guardado', 'reserva-marcada', 'pago-registrado', 'manager-pagos',
        'manager-caja', 'manager-vale-salida', 'tinaja-tonel-apagado', 'tinaja-jacuzzi-apagado',
        'tinaja-tonel-funcionamiento', 'tinaja-jacuzzi-funcionamiento', 'tinaja-cojines-retirados', 'novedades'])
        assert.ok(section.includes(`data-cierre-campo="${name}"`));
    for (let n = 1; n <= 11; n++) assert.ok(section.includes(`data-cierre-cabana-ocupada="${n}"`));
});

test('La autoridad final sigue siendo el RPC seguro, con confirmación y cancelación', () => {
    assert.match(final, /"haiku_estado_cierre_dia"/);
    assert.match(final, /"haiku_cerrar_turno_dia"/);
    assert.match(final, /if \(!confirm\(pregunta\)\) return/);
    assert.match(final, /if \(pendientes > 0 && !resumen\)/);
    assert.match(final, /"haiku_reabrir_cierre_dia"/);
    assert.match(final, /#sites-cierre-final-slot/);
    assert.match(writer, /"haiku_guardar_respuesta_cierre"/);
    assert.match(writer, /"haiku_guardar_novedades_cierre"/);
    assert.match(writer, /haiku:cierre-respuesta-guardada/);
    assert.match(evidence, /\.storage\s*\.from\(BUCKET\)/);
    assert.match(evidence, /\.from\("evidencias"\)/);
    assert.match(refresh, /haikuRefrescarCierreAlEntrar/);
    assert.match(final, /puedeReabrirLocal/);
    assert.doesNotMatch(js, /\.rpc\(|\.from\(|\.update\(/);
});

test('La proyección usa RPC para progreso y Cabañas para estado final', () => {
    assert.match(js, /haiku:cierre-estado-actualizado/);
    assert.match(js, /state\.porcentaje/);
    assert.match(js, /state\.pendientes/);
    assert.match(js, /HAIKU_CABANAS_SITES_V1\?\.estadoFinal/);
    assert.match(js, /HAIKU_CABANAS_SITES_V1\.abrir\(number\)/);
    assert.match(js, /sites-cierre-volver/);
    assert.match(js, /data-sites-cierre-filter/);
    assert.match(js, /\.sites-cierre-warnings/);
    assert.match(js, /radioCount\(stage\)/);
});

test('Pendientes nace como tres bloques Sites y conserva las respuestas reales', () => {
    const section = html.slice(html.indexOf('data-cierre-etapa="2"'), html.indexOf('data-cierre-etapa="3"'));
    for (const [name, values] of [
        ['detalles-cabanas', ['si', 'pendientes']],
        ['pendientes-hacer', ['no', 'si']],
        ['hay-novedades', ['no', 'si']]
    ]) {
        assert.ok(section.includes(`name="${name}"`));
        for (const value of values) assert.match(section, new RegExp(`name="${name}"[\\s\\S]*?value="${value}"`));
    }
    assert.equal((section.match(/class="sites-cierre-pending-item"/g) || []).length, 3);
    assert.doesNotMatch(section, /class="cierre-bloques"|class="cierre-bloque"/);
    assert.equal((section.match(/class="sites-cierre-pending-count"/g) || []).length, 3);
    assert.equal((section.match(/class="sites-cierre-pending-head"/g) || []).length, 3);
    assert.match(js, /function assemblePending\(stage\)/);
    assert.match(js, /if \(index === 1\) assemblePending\(stage\)/);
    assert.match(js, /updatePendingFields\(\)/);
    assert.match(js, /radioCount\(stage\)/);
    assert.match(css, /\.sites-cierre-pending-grid \{ display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
    assert.match(css, /\.sites-cierre-pending-field\[hidden\] \{ display:none!important/);
    assert.match(section, /data-cierre-campo="novedades"/);
    assert.doesNotMatch(section, /data-cierre-campo="tarea-pendiente"/);
    const bridge = fs.readFileSync(path.join(root, 'js/supabase-cierre-v1.js'), 'utf8');
    for (const [name, code] of [['detalles-cabanas', 'detalles_cabanas'],
        ['pendientes-hacer', 'pendientes_hacer'], ['hay-novedades', 'hay_novedades']]) {
        assert.ok(bridge.includes(`"${name}": "${code}"`));
    }
    assert.match(bridge, /"haiku_guardar_novedades_cierre"/);
});

test('Responsive Sites define apilado y evita ancho fijo', () => {
    assert.match(css, /@media\(max-width:1100px\)/);
    assert.match(css, /@media\(max-width:740px\)/);
    assert.match(css, /@media\(max-width:420px\)/);
    assert.match(css, /\.sites-cierre-workspace\s*\{[^}]*max-width:none/);
    assert.match(css, /\.cierre-cabanas-grid,#seccion-cierre \.sites-cierre-pending-grid\{grid-template-columns:1fr!important/);
});

test('Evidencias de Cierre usan franja compacta y conservan controles reales', () => {
    const section = html.slice(html.indexOf('<section id="seccion-cierre"'), html.indexOf('<section id="seccion-pagos"'));
    for (const key of ['registro', 'cloudbeds-reserva', 'cloudbeds-pago', 'manager-pagos', 'manager-caja']) {
        assert.ok(section.includes(`data-evidencia="${key}"`));
        assert.ok(section.includes(`data-evidencia-input="${key}"`));
        assert.ok(section.includes(`data-evidencia-pegar="${key}"`));
        assert.ok(section.includes(`data-evidencia-preview="${key}"`));
    }
    assert.doesNotMatch(section, /data-evidencia-zona=|Haz clic aquí y presiona Ctrl/);
    assert.match(js, /Adjuntar imágenes/);
    assert.match(js, /Sin adjuntos/);
    assert.match(js, /Ver evidencia/);
    assert.match(css, /\.cierre-evidencia-toggle\[hidden\]\s*\{\s*display:none!important/);
    assert.match(legacyClosing, /boton\.addEventListener\("paste"/);
    assert.match(legacyClosing, /await guardarEvidencia\(/);
    assert.match(legacyClosing, /Promise\.resolve\(guardarEvidencia\(fechaSeleccionada, nombre, lector\.result\)\)/);
    assert.match(evidence, /listarEvidenciasSupabase/);
    assert.match(evidence, /\.order\("creado_en", \{ ascending: false \}\)/);
});

test('Listado visual de evidencias lee cero, una o varias sin escribir', async () => {
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
    vm.runInNewContext(evidence, context);
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
