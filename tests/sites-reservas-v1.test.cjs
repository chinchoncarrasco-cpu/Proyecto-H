const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const panel = read('panel.html');
const css = read('css/sites-reservas-v1.css');
const reservations = read('js/supabase-reservas-v1.js');
const copy = read('js/supabase-reservas-copiar-v1.js');
const rpc = read('supabase/migrations/20260907150000_listado_reservas_operativo_v1.sql');
const start = html.indexOf('<section id="seccion-reservas"');
const end = html.indexOf('<section id="seccion-libro-reserva"', start);
const section = html.slice(start, end);

test('Reservas nace como shell Sites con loading, sin pintar la tabla legacy', () => {
    assert.ok(start >= 0 && end > start);
    assert.match(section, /sites-reservas-workspace/);
    assert.match(section, /reservations-workspace/);
    assert.match(section, /sites-reservas-heading/);
    assert.match(section, /sites-reservas-surface/);
    assert.match(section, /id="reservas-tabla-cabecera"/);
    assert.match(section, /id="reservas-tabla-cuerpo"/);
    assert.match(section, /Cargando reservas/);
    assert.doesNotMatch(section, /datos de muestra|s[oó]lo demostraci[oó]n|prototipo|se habilitar[aá]n en una etapa posterior/i);
    assert.match(html, /css\/sites-reservas-v1\.css/);
    assert.match(panel, /css\/sites-reservas-v1\.css/);
    assert.match(panel, /'supabase-reservas-v1'/);
});

test('La fuente financiera y los filtros siguen siendo la RPC autorizada de lectura', () => {
    assert.match(reservations, /haiku_listar_reservas_v1/);
    assert.match(reservations, /p_busqueda/);
    assert.match(reservations, /p_estado/);
    assert.match(reservations, /p_categoria/);
    assert.match(reservations, /p_limite/);
    assert.match(reservations, /p_offset/);
    assert.match(rpc, /vista_saldos_alojamiento_reserva/);
    assert.match(rpc, /s\.total_alojamiento[^\n]*precio_total/);
    assert.match(rpc, /s\.pagado_alojamiento[^\n]*abono/);
    assert.match(rpc, /s\.saldo_alojamiento[^\n]*saldo_pendiente/);
    assert.doesNotMatch(reservations, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    assert.doesNotMatch(reservations, /precio_total\s*-\s*abono|fila\.precio_total\s*-\s*fila\.abono/);
});

test('Controles Sites se conectan al módulo real sin inventar acciones masivas', () => {
    for (const id of [
        'reservas-buscar', 'reservas-abrir-filtros', 'reservas-contador',
        'reservas-configurar-columnas', 'reservas-columnas-lista',
        'reservas-columnas-restablecer', 'reservas-columnas-mostrar-todas',
        'reservas-copiar-tabla', 'reservas-pagina-anterior',
        'reservas-pagina-siguiente', 'reservas-recargar'
    ]) assert.ok(section.includes(`id="${id}"`), id);
    assert.match(section, /Predeterminadas/);
    assert.match(section, /Mostrar todas/);
    assert.doesNotMatch(section, /reservas-seleccionar-pagina|data-reservas-seleccionar/);
    assert.match(section, /reservas-tabla-cuerpo/);
    assert.match(reservations, /HAIKU_RESERVAS_V1/);
    assert.match(copy, /reservas-copiar-tabla/);
});

test('El detalle usa identidad exacta y la copia consume sólo la tabla visible', () => {
    assert.match(reservations, /data-abrir-reserva/);
    assert.match(reservations, /HAIKU_RESUMEN_RESERVA_SITES_V1/);
    assert.match(copy, /\.rv-table\.sites-reservas-tabla/);
    assert.match(copy, /querySelectorAll\(["']tbody tr|\.querySelectorAll\(["']tr/);
    assert.doesNotMatch(copy, /\.rpc\(|\.from\(/);
});

test('CSS adapta el ancho útil y los cinco tamaños sin tabla ilegible en móvil', () => {
    assert.match(css, /#seccion-reservas/);
    assert.match(css, /sites-reservas-workspace|reservations-workspace/);
    assert.match(css, /rv-table|sites-reservas-tabla/);
    assert.match(css, /rv-mobile-list|sites-reservas-mobile/);
    assert.match(css, /@media\s*\(max-width:/);
});
