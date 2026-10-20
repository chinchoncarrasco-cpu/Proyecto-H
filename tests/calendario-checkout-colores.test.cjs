const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const base = fs.readFileSync(require.resolve('../css/styles.css'), 'utf8').replace(/\r\n/g,'\n');
const sites = fs.readFileSync(require.resolve('../css/sites-calendario-v1.css'), 'utf8').replace(/\r\n/g,'\n');
const estados = fs.readFileSync(require.resolve('../js/supabase-calendario-estados-v1.js'), 'utf8');

function regla(css, selector) {
    const inicio = css.indexOf(selector + ' {');
    assert.ok(inicio >= 0, 'No se encontró selector: ' + selector);
    return css.slice(css.indexOf('{', inicio) + 1, css.indexOf('}', inicio));
}

test('Check-out conserva el gris canónico de la ficha', () => {
    assert.match(base, /--haiku-reserva-checkout-fondo:\s*#a0a0a0/i);
    assert.match(base, /--haiku-reserva-checkout-texto:\s*#ffffff/i);
});

test('checked_out sigue usando la clase canónica del Calendario', () => {
    assert.match(estados, /case "checked_out":\s*return "cal-reserva-checkout"/);
    assert.match(estados, /\.calendario-panel-reserva\[data-reserva-id\]/);
});

test('barra mensual Check-out gris, no azul', () => {
    const barra = regla(sites, '#seccion-calendario .calendario-reserva-barra.cal-reserva-checkout');
    assert.match(barra, /--cal-sites-bar-bg:\s*var\(--haiku-reserva-checkout-fondo\)/);
    assert.match(barra, /--cal-sites-bar-ink:\s*var\(--haiku-reserva-checkout-texto\)/);
    assert.doesNotMatch(barra, /#e5eff3|#84b2be/i);
});

test('recuadro del día Check-out con fondo y texto de ficha', () => {
    const panel = regla(sites, '.calendario-panel-dia .calendario-panel-reserva.cal-reserva-checkout');
    assert.match(panel, /background:\s*var\(--haiku-reserva-checkout-fondo\)/);
    assert.match(panel, /color:\s*var\(--haiku-reserva-checkout-texto\)/);
    assert.match(panel, /border-color:\s*var\(--haiku-reserva-checkout-fondo\)/);
});

test('estilos heredados tampoco pintan Check-out azul', () => {
    assert.match(regla(base, '.calendario-panel-reserva.cal-reserva-checkout'), /background:\s*var\(--haiku-reserva-checkout-fondo\)/);
    assert.match(regla(base, '.calendario-reserva-barra.cal-reserva-checkout,\n.calendario-panel-reserva.cal-reserva-checkout'), /color:\s*var\(--haiku-reserva-checkout-texto\)/);
});

test('agenda móvil usa indicador gris para Check-out', () => {
    const agenda = regla(sites, '#seccion-calendario .sites-calendario-agenda-item.cal-reserva-checkout');
    assert.match(agenda, /--cal-agenda-accent:\s*var\(--haiku-reserva-checkout-fondo\)/);
});

test('otros estados no pierden sus tonos previos', () => {
    const grupo = regla(sites, '#seccion-calendario .calendario-reserva-barra:is(.cal-reserva-confirmada, .cal-reserva-confirmacion-pendiente)');
    assert.match(grupo, /--cal-sites-bar-bg:\s*#e5eff3/);
    assert.doesNotMatch(grupo, /cal-reserva-checkout/);
    const agenda = regla(sites, '#seccion-calendario .sites-calendario-agenda-item:is(.cal-reserva-confirmada, .cal-reserva-confirmacion-pendiente)');
    assert.match(agenda, /--cal-agenda-accent:\s*#84b2be/);
});
