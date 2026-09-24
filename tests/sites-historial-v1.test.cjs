const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const panel = read('panel.html');
const css = read('css/sites-historial-v1.css');
const history = read('js/supabase-historial-v1.js');
const section = html.slice(html.indexOf('<section id="seccion-historial"'), html.indexOf('<section id="seccion-reservas"'));

test('Historial nace como shell Sites y el legado está oculto antes de ejecutar JS', () => {
    assert.match(section, /class="sites-history-workspace"/);
    assert.match(section, /class="sites-history-legacy"/);
    assert.match(section, /Cargando actividad real/);
    assert.match(css, /#seccion-historial\s+\.sites-history-legacy\s*\{[^}]*display:\s*none\s*!important/);
    assert.match(section, /data-historial-lista/);
    assert.match(section, /data-historial-refresh/);
    assert.match(section, /data-historial-contador/);
    assert.doesNotMatch(section.slice(0, section.indexOf('sites-history-legacy')), /datos de muestra|prototipo|demostraci[oó]n|hxSeed/i);
    assert.match(history, /sites-history-date-group/);
    assert.match(history, /sites-history-event/);
    assert.doesNotMatch(history, /seccion\.innerHTML\s*=|historial-supa-card/);
});

test('Los filtros, tabs y paginación Sites existen como controles reales', () => {
    for (const attr of [
        'data-historial-modo="historial"', 'data-historial-modo="auditoria"',
        'data-historial-buscar', 'data-historial-desde', 'data-historial-hasta',
        'data-historial-tipo', 'data-historial-mas', 'data-historial-limpiar'
    ]) assert.ok(section.includes(attr), attr);
    assert.match(section, /Historial y auditoría/);
    assert.match(section, /Actividad operativa y detalle técnico de los cambios/);
    assert.match(section, /Mostrar más eventos/);
    assert.match(history, /window\.HistorialSupabase\s*=/);
    assert.match(history, /abrirReserva:\s*abrirHistorialReserva/);
});

test('La autoridad sigue siendo eventos_auditoria y las consultas son sólo lectura', () => {
    assert.match(history, /\.from\("eventos_auditoria"\)/);
    assert.match(history, /\.eq\("reserva_id",\s*reservaId\)/);
    assert.match(history, /\.order\("creado_en",\s*\{\s*ascending:\s*false\s*\}\)/);
    assert.match(history, /\.range\(0,\s*limite\s*-\s*1\)/);
    assert.match(history, /consultaPorIds\("usuarios"/);
    assert.doesNotMatch(history, /\bhxSeed\b|Martina León|Camila Soto|datos de muestra|demostraci[oó]n/i);
    assert.doesNotMatch(history, /\.insert\(|\.upsert\(|\.update\(|\.rpc\(/);
});

test('El panel carga la hoja de Sites con el módulo real y preserva el bootstrap', () => {
    assert.match(html, /href="css\/sites-historial-v1\.css"/);
    assert.match(panel, /css\/sites-historial-v1\.css/);
    assert.match(panel, /'supabase-historial-v1'/);
    assert.match(panel, /scriptsSupabaseV2/);
    assert.match(panel, /src="js\/\$\{n\}\.js/);
});

test('Los estilos tienen ancho útil y contratos responsive para el timeline', () => {
    assert.match(css, /#seccion-historial\s+\.sites-history-workspace\s*\{[^}]*width:\s*100%/);
    assert.match(css, /#seccion-historial\s+\.sites-history-date-group/);
    assert.match(css, /#seccion-historial\s+\.sites-history-event/);
    assert.match(css, /@media\s*\(max-width:\s*1100px\)/);
    assert.match(css, /@media\s*\(max-width:\s*[78]\d\dpx\)/);
    assert.match(css, /@media\s*\(max-width:\s*4\d\dpx\)/);
});
