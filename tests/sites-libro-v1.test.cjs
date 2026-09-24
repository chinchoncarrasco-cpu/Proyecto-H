const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const panel = read('panel.html');
const reader = read('js/supabase-libro-reserva-v1.js');
const worker = read('js/supabase-libro-reserva-worker-v1.js');
const google = read('js/supabase-libro-google-readonly-v1.js');
const css = read('css/sites-libro-reserva-v1.css');
const start = html.indexOf('<section id="seccion-libro-reserva"');
const end = html.indexOf('</main>', start);
const section = html.slice(start, end);

test('Libro nace como shell Sites de solo lectura antes de ejecutar JavaScript', () => {
    assert.ok(start >= 0 && end > start);
    assert.match(section, /sites-libro-shell/);
    assert.match(section, /CONSULTA DEL LIBRO/);
    assert.match(section, /Consulta la copia XLSX dentro de Haku/);
    assert.match(section, /Solo lectura|Sólo lectura/);
    for (const id of [
        'libro-reserva-estado-titulo', 'libro-reserva-estado-detalle',
        'sites-libro-memoria-titulo', 'sites-libro-memoria-detalle',
        'sites-libro-online-titulo', 'sites-libro-online-detalle',
        'sites-libro-sync-titulo', 'sites-libro-sync-detalle',
        'libro-reserva-hoja', 'libro-reserva-meta',
        'libro-reserva-pagina-anterior', 'libro-reserva-pagina-estado',
        'libro-reserva-pagina-siguiente', 'libro-reserva-visor',
        'sites-libro-zoom-slot'
    ]) assert.match(section, new RegExp(`id="${id}"`), `${id} is present in static shell`);
    assert.match(section, /Cargando|Preparando|Sin libro cargado/);
    assert.doesNotMatch(section, /libro-reserva-vacio|Esta versión no inicia sesión en Google|datos de muestra|libro-reserva-muestra\.xlsx/i);
    assert.match(css, /#seccion-libro-reserva/);
    assert.match(html, /css\/sites-libro-reserva-v1\.css/);
    assert.match(panel, /css\/sites-libro-reserva-v1\.css/);
});

test('la UI nueva conserva los controles que consumen los handlers reales', () => {
    for (const id of [
        'libro-reserva-descargar', 'libro-reserva-cargar', 'libro-reserva-archivo',
        'libro-reserva-quitar', 'libro-reserva-hoja',
        'libro-reserva-pagina-anterior', 'libro-reserva-pagina-siguiente'
    ]) assert.match(section, new RegExp(`id="${id}"`));
    assert.match(section, /accept="\.xlsx,/);
    assert.match(read('js/haiku-libro-consultas-v1.js'), /Consultar Libro con Haku/);
    assert.match(google, /Conectar Google/);
    assert.match(google, /Sincronizar ahora/);
    const readerPos = panel.indexOf("'supabase-libro-reserva-v1'");
    const googlePos = panel.indexOf("'supabase-libro-google-readonly-v1'");
    const assistantPos = panel.indexOf("'haiku-libro-consultas-v1'");
    assert.ok(readerPos >= 0 && googlePos > readerPos && assistantPos > googlePos);
});

test('el visor sigue leyendo los bytes originales con Worker, sin editar el XLSX', () => {
    assert.match(reader, /new Worker\(`js\/supabase-libro-reserva-worker-v1\.js/);
    assert.match(reader, /copiaLocal\("guardar"/);
    assert.match(reader, /copiaLocal\("leer_anterior"/);
    assert.match(reader, /accion === "borrar" \? almacen\.clear\(\)/);
    assert.match(reader, /tipo, nombreHoja, buffer: copia/);
    assert.match(reader, /descargar|configurarDescarga/);
    assert.match(reader, /new Blob\(\[archivoBuffer\]/);
    assert.doesNotMatch(reader, /libro-reserva-visor[^\n]*outerHTML[^\n]*xlsx/i);
    assert.match(worker, /tipo === "indice"/);
    assert.match(worker, /leerHoja|tipo === "buscar"/);
    assert.match(reader, /aplicarEstiloCelda\(celda, estiloCelda\(fila, columna\)\)/);
    assert.match(reader, /FILAS_POR_PAGINA = 120/);
    assert.match(reader, /hojaActual = nombre/);
});

test('Google es un conector de lectura real y la UI no simula escritura ni sincronización', () => {
    assert.match(google, /drive\.readonly/);
    assert.match(google, /https:\/\/www\.googleapis\.com\/drive\/v3\/files/);
    assert.match(google, /method: "GET"/);
    assert.match(google, /cargarDesdeGoogle/);
    assert.doesNotMatch(google, /files\.(?:create|update|delete)|method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)/i);
    assert.doesNotMatch(section, /Datos de demostración|Sólo demostración|Google se conectará al implementar/i);
});
