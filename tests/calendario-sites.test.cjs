const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// DOM pequeño que ejecuta calendario.js completo, incluidos sus listeners.
class Element {
    constructor(tag = 'div') {
        this.tagName = tag;
        this.children = [];
        this.dataset = {};
        this.style = {setProperty(name, value) { this[name] = value; }};
        this.className = '';
        this.listeners = {};
        this.classList = {
            contains: name => this.className.split(/\s+/).includes(name),
            add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
            remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
            toggle: (name, enabled) => {
                const present = this.classList.contains(name);
                if (enabled ?? !present) this.classList.add(name);
                else this.classList.remove(name);
            }
        };
    }
    appendChild(element) { element.parentNode = this; this.children.push(element); return element; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(element => element !== this); }
    set innerHTML(value) {
        this.html = value;
        this.children = [];
        for (const match of value.matchAll(/<([\w-]+)\b[^>]*class="([^"]+)"[^>]*>/g)) {
            const element = new Element(match[1]);
            element.className = match[2];
            this.appendChild(element);
        }
    }
    matches(selector) {
        if (selector.includes(' ')) selector = selector.split(' ').at(-1);
        const id = selector.match(/#([\w-]+)/);
        if (id && this.id !== id[1]) return false;
        for (const match of selector.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(match[1])) return false;
        for (const match of selector.matchAll(/\[data-([\w-]+)(?:="([^"]*)")?\]/g)) {
            const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            if (!(key in this.dataset) || (match[2] !== undefined && this.dataset[key] !== match[2])) return false;
        }
        return true;
    }
    querySelectorAll(selector) {
        return this.children.flatMap(element => [
            ...(selector.split(',').some(part => element.matches(part.trim())) ? [element] : []),
            ...element.querySelectorAll(selector)
        ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    click() { for (const callback of this.listeners.click || []) callback({target: this, stopPropagation() {}, preventDefault() {}}); }
    setAttribute(name, value) { this[name] = value; }
}

function harness(cache = {}) {
    const body = new Element('body');
    const ids = new Map();
    const store = new Map([['haikuDatos', JSON.stringify(cache)]]);
    const document = {
        body,
        createElement: tag => new Element(tag),
        addEventListener() {},
        getElementById(id) {
            if (!ids.has(id)) {
                const element = new Element();
                element.id = id;
                ids.set(id, element);
                body.appendChild(element);
            }
            return ids.get(id);
        },
        querySelector: selector => body.querySelector(selector),
        querySelectorAll: selector => body.querySelectorAll(selector)
    };
    const context = vm.createContext({
        document,
        localStorage: {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)},
        datosPorFecha: {},
        obtenerDatosDia(fecha) { return context.datosPorFecha[fecha] ||= {cabanas: {}}; },
        guardarDatos() {},
        console: {log() {}, info() {}, warn() {}, error() {}},
        setTimeout() {},
        addEventListener() {}
    });
    context.window = context;
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'calendario.js'), 'utf8'), context, {filename: 'calendario.js'});
    vm.runInContext('fechaCalendario = new Date(2026, 8, 1); fechaSeleccionada = "2026-09-03"; generarCalendario();', context);
    return {body, document, context};
}

function reserva(id, titular, cabana, fecha = '2026-09-04') {
    return [cabana, {
        reservaId: `R${id}`,
        estadiaId: `E${id}`,
        titular,
        fechaOrigenReserva: fecha,
        noches: 1,
        estado: 'reservada',
        tipoEstadia: 'alojamiento'
    }];
}

test('cuatro reservas reales en un día mantienen tres barras y +1; el panel lista las cuatro', () => {
    const cabanas = Object.fromEntries([
        reserva(1, 'Ana Real', 1),
        reserva(2, 'Bruno Real', 2),
        reserva(3, 'Carla Real', 3),
        reserva(4, 'Diego Real', 4)
    ]);
    const h = harness({'2026-09-04': {cabanas}});
    assert.equal(h.document.getElementById('calendario-descripcion').textContent, '4 reservas · 0 bloqueos');
    const bars = h.body.querySelectorAll('.calendario-reserva-barra');
    assert.deepEqual(bars.map(bar => bar.dataset.reservaId), ['R1', 'R2', 'R3']);

    const more = h.body.querySelector('.calendario-mas-reservas');
    assert.ok(more);
    assert.equal(more.textContent, '+1');
    assert.equal(more.dataset.fecha, '2026-09-04');
    more.click();

    const panel = h.body.querySelector('.calendario-panel-dia');
    assert.ok(panel);
    assert.ok(panel.classList.contains('sites-calendario-popover'));
    assert.equal(panel.role, 'dialog');
    assert.match(panel['aria-label'], /4 de septiembre de 2026/i);
    const items = panel.querySelectorAll('.calendario-panel-reserva');
    assert.deepEqual(items.map(item => item.dataset.reservaId), ['R1', 'R2', 'R3', 'R4']);
    assert.deepEqual(items.map(item => item.dataset.estadiaId), ['E1', 'E2', 'E3', 'E4']);
    assert.match(items[3].textContent, /CAB 4 · Diego Real/);

    // El mismo botón reemplaza el panel anterior; la X lo cierra.
    more.click();
    assert.equal(h.body.querySelectorAll('.calendario-panel-dia').length, 1);
    h.body.querySelector('.calendario-panel-cerrar').click();
    assert.equal(h.body.querySelector('.calendario-panel-dia'), null);
});

test('una reserva elegida en +N abre la ficha real para ese día y restaura la fecha operativa', () => {
    const cabanas = Object.fromEntries([
        reserva(1, 'Ana Real', 1), reserva(2, 'Bruno Real', 2),
        reserva(3, 'Carla Real', 3), reserva(4, 'Diego Real', 4)
    ]);
    const h = harness({'2026-09-04': {cabanas}});
    const ficha = new Element('button');
    ficha.dataset.fichaCabana = '4';
    let clicks = 0;
    let fechaDuranteClick;
    ficha.addEventListener('click', () => {
        clicks++;
        fechaDuranteClick = vm.runInContext('fechaSeleccionada', h.context);
    });
    h.body.appendChild(ficha);

    h.body.querySelector('.calendario-mas-reservas').click();
    h.body.querySelector('.calendario-panel-reserva[data-reserva-id="R4"]').click();
    assert.equal(clicks, 1);
    assert.equal(fechaDuranteClick, '2026-09-04');
    assert.equal(vm.runInContext('fechaSeleccionada', h.context), '2026-09-03');
    assert.equal(h.body.querySelector('.calendario-panel-dia'), null);
});

test('mes sin reservas conserva sus días y navegación anterior/siguiente sin +N', () => {
    const h = harness({});
    const grid = h.document.getElementById('calendario-grid');
    const dias = () => grid.querySelectorAll('.dia-calendario').filter(element => !element.classList.contains('dia-vacio'));
    assert.equal(dias().length, 30);
    assert.ok(dias().some(element => element.dataset.fecha === '2026-09-30'));
    assert.ok(grid.querySelectorAll('.dia-calendario').every(element => element.querySelector('.numero-dia')));
    assert.ok(grid.querySelectorAll('.dia-vacio').some(element => element.dataset.fecha === '2026-08-31'));
    assert.equal(h.body.querySelector('.calendario-mas-reservas'), null);
    assert.equal(h.body.querySelector('.calendario-reserva-barra'), null);
    assert.equal(h.document.getElementById('calendario-descripcion').textContent, '0 reservas · 0 bloqueos');

    h.document.getElementById('mes-siguiente').click();
    assert.equal(dias().length, 31);
    assert.ok(dias().some(element => element.dataset.fecha === '2026-10-31'));
    assert.equal(h.body.querySelector('.calendario-mas-reservas'), null);

    h.document.getElementById('mes-anterior').click();
    assert.equal(dias().length, 30);
    assert.ok(dias().some(element => element.dataset.fecha === '2026-09-01'));

    h.document.getElementById('mes-siguiente').click();
    h.document.getElementById('calendario-hoy').click();
    const hoy = vm.runInContext('fechaHoy', h.context);
    assert.equal(grid.querySelector('.dia-calendario.hoy')?.dataset.fecha, hoy);
    assert.equal(h.document.getElementById('calendario-hoy').hidden, true);
});

test('entrypoint carga la capa Sites y preserva IDs funcionales del Calendario', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    for (const id of ['seccion-calendario', 'calendario-grid', 'calendario-descripcion', 'calendario-hoy', 'mes-anterior', 'mes-siguiente', 'titulo-mes', 'activar-bloqueo-calendario']) {
        assert.equal([...html.matchAll(new RegExp(`\\bid="${id}"`, 'g'))].length, 1, id);
    }
    assert.match(html, /id="seccion-calendario"[^>]*class="[^"]*sites-calendario/);
    assert.match(html, /href="css\/sites-calendario-v1\.css"/);
});

test('la geometría Sites reserva la franja superior del número y un carril propio para +N', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'sites-calendario-v1.css'), 'utf8');
    const rule = selector => {
        const start = css.indexOf(`${selector} {`);
        assert.notEqual(start, -1, selector);
        return css.slice(start, css.indexOf('}', start));
    };
    const px = (source, property) => {
        const match = source.match(new RegExp(`${property}:\\s*(\\d+)px`));
        assert.ok(match, `${property} en ${source.slice(0, 90)}`);
        return Number(match[1]);
    };
    const root = rule('#seccion-calendario');
    const day = rule('#seccion-calendario .dia-calendario');
    const number = rule('#seccion-calendario .dia-calendario .numero-dia');
    const more = rule('#seccion-calendario .calendario-mas-reservas');
    const bar = rule('#seccion-calendario .calendario-reserva-barra');
    const row = px(root, '--cal-sites-row-height');
    const barTop = px(root, '--cal-sites-bars-top');
    const lane = px(root, '--cal-sites-lane-step');
    const barHeight = px(root, '--cal-sites-bar-height');
    const numberTop = Number(day.match(/padding:\s*(\d+)px/)[1]);
    const numberHeight = px(number, 'height');
    const moreHeight = px(more, 'height');

    assert.ok(barTop >= numberTop + numberHeight + 4, 'la primera barra no invade el número');
    assert.ok(barTop + 3 * lane >= barTop + 2 * lane + barHeight, '+N no tapa la tercera barra');
    assert.ok(barTop + 3 * lane + moreHeight <= row, '+N cabe dentro del día');
    assert.match(bar, /margin-top:\s*calc\(var\(--cal-sites-bars-top\)\s*\+\s*var\(--fila-reserva\)\s*\*\s*var\(--cal-sites-lane-step\)\)/);
    assert.match(more, /margin-top:\s*calc\(var\(--cal-sites-bars-top\)\s*\+\s*3\s*\*\s*var\(--cal-sites-lane-step\)\)/);
});
