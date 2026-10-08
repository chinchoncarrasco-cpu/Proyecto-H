const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const consulta = 'Libro: compara servicios de octubre 2026 con Proyecto H';
const source = read('js/haiku-libro-servicios-scope-v2.js').replace('const api = Object.freeze({',
    'const api = Object.freeze({renderizar, confirmarServicioManual, calcularManual, cargarContratoManual, estadosPorVista,');
function setup() {
    const w = globalThis;
    const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const copy = x => JSON.parse(JSON.stringify(x));
    const textos = ['1 HORA DE CORTESIA TINAJA', 'X PAGAR LATE OUT CLP$10,000 1 HORA', '1 MASAJE DE 1 HORA'];
    const r = (nombre, cabana, texto) => ({ titular: nombre, cabana, fecha_checkin: '2026-10-10', fecha_checkout: '2026-10-11',
        noches: 1, adultos: 2, tipo_estadia: 'alojamiento', texto_original: texto,
        coordenadas_origen: { hoja: 'Oct26', celda: cabana === 4 ? 'C4' : 'C5' },
        servicios: w.HAIKU_LIBRO_SEMANTICA.servicios(texto, { origen_campo: 'notas_reserva' }) });
    const javiera = r('Javiera Barrera', 4, textos.slice(0, 2).join(' / ')), rocio = r('Rocío Leal', 5, textos[2]);
    const catalogo = ['tinajaTonel', 'tinajaJacuzzi', 'masajeTerapeutico30', 'masajeTerapeutico60', 'masajeDescontracturante30', 'masajeDescontracturante60', 'lateCheckout'].map((codigo, i) => ({
        id: id(20 + i), codigo, nombre: codigo === 'tinajaTonel' ? 'Tonel de madera' : codigo === 'tinajaJacuzzi' ? 'Jacuzzi' : codigo === 'lateCheckout' ? 'Late Check-out' : `Masaje ${/Terapeutico/.test(codigo) ? 'Terapéutico' : 'Descontracturante'} ${codigo.slice(-2)} min`, activo: true, unidad: /tinaja|late/.test(codigo) ? 'hora' : 'servicio',
        precio_base: codigo === 'lateCheckout' ? 10000 : /masaje/.test(codigo) ? 45000 : 30000,
        duracion_minutos: /masaje/.test(codigo) ? Number(codigo.match(/\d+$/)[0]) : null,
        capacidad_incluida: /tinaja/.test(codigo) ? 3 : null, capacidad_maxima: codigo === 'tinajaJacuzzi' ? 5 : codigo === 'tinajaTonel' ? 3 : null,
        precio_persona_adicional: codigo === 'tinajaJacuzzi' ? 10000 : null, permite_cortesia: /tinaja/.test(codigo), requiere_horario: true
    }));
    const db = { catalogo_servicios: catalogo, reservas: [{ id: id(1), titular_nombre: javiera.titular, estado_reserva: 'confirmada' },
        { id: id(2), titular_nombre: rocio.titular, estado_reserva: 'confirmada' }],
        reserva_estadias: [javiera, rocio].map((r, i) => ({ id: id(3 + i), reserva_id: id(1 + i), cabana_id: id(5 + i),
            fecha_ingreso: r.fecha_checkin, fecha_salida: r.fecha_checkout, tipo_estadia: r.tipo_estadia, estado_estadia: 'confirmada' })),
        cabanas: [{ id: id(5), numero: 4 }, { id: id(6), numero: 5 }], servicios: [], notas: [] };
    const state = w.fixtureServicios = { db, reservas: [javiera, rocio], usuario: id(99), generacion: 1, llamadas: [], escrituras: [], contrato: true };
    w.HAIKU_LIBRO_RESERVA_V1 = { listo: async () => {}, estado: () => ({ cargado: true, nombre: 'fixture.xlsx', version: 'a'.repeat(64), generacion: state.generacion }),
        listarHojas: () => ['Oct26'], consultarHoja: async () => ({ reservas: copy(state.reservas) }) };
    w.haikuSupabase = { auth: { getUser: async () => ({ data: { user: { id: state.usuario } } }) }, from: tabla => {
        const filtros = [], q = { select: () => q, in: (k, v) => { filtros.push(x => v.includes(x[k])); return q; },
            eq: (k, v) => { filtros.push(x => x[k] === v); return q; }, lte: () => q, gte: () => q,
            then: (ok, fail) => Promise.resolve({ data: copy((db[tabla] || []).filter(x => filtros.every(f => f(x)))), error: null }).then(ok, fail) };
        return q;
    }, rpc: async (nombre, args) => {
        state.llamadas.push(nombre);
        if (nombre === 'haiku_libro_servicio_manual_capacidad_v1') return { data: state.contrato ? { version: 1, auditoria: true } : null };
        if (nombre !== 'haiku_importar_libro_operaciones_v2') throw Error('RPC fuera del contrato');
        state.escrituras.push(copy(args));
        return { data: { ok: true, servicios_creados: args.p_servicios.length, notas_creadas: args.p_notas.length,
            servicios: args.p_servicios.map(x => ({ item_id: x.item_id, estado: 'creado' })), notas: [] } };
    } };
    w.confirm = () => true;
}
class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; this.style = {}; this.dataset = {}; }
    append(...els) { this.children.push(...els); els.forEach(el => el.parentElement = this); }
    appendChild(el) { this.append(el); }
    setAttribute(k, v) { this[k] = v; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); }
    get isConnected() { return true; }
    get classList() { return { contains: c => (this.className || '').split(' ').includes(c) }; }
    matches(selector) {
        if (selector.includes(',')) return selector.split(',').some(s => this.matches(s.trim()));
        const parts = selector.trim().split(/\s+/);
        if (parts.length > 1) return this.matches(parts.at(-1)) && Boolean(this.parentElement?.closest(parts.slice(0, -1).join(' ')));
        if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
        if (!selector.startsWith(this.tag)) return false;
        if (selector.includes('data-haku-item-id') && !this.dataset.hakuItemId) return false;
        if (selector.includes('checkbox') && this.type !== 'checkbox') return false;
        if (selector.includes(':checked') && !this.checked) return false;
        if (selector.includes(':not(:disabled)') && this.disabled) return false;
        return true;
    }
    closest(s) { return this.matches(s) ? this : this.parentElement?.closest(s) || null; }
    querySelectorAll(s) { return this.children.flatMap(x => [...(x.matches(s) ? [x] : []), ...x.querySelectorAll(s)]); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    set textContent(v) { this.text = v; this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(x => x.textContent).join(''); }
}
function entorno() {
    const captures = [], document = { createElement: t => new Element(t), getElementById: () => null, head: new Element('head'),
        addEventListener: (t, fn) => captures.push([t, fn]), querySelectorAll: s => document.card?.querySelectorAll(s) || [] };
    const c = { document, queueMicrotask, addEventListener() {}, HAIKU_LIBRO_SEMANTICA: require('../../js/haiku-libro-semantica-v1.js'),
        HAIKU_SERVICIOS_IDENTIDAD_V1: require('../../js/haiku-servicios-identidad-v1.js') };
    vm.createContext(c); vm.runInContext(`(${setup.toString()})()`, c); vm.runInContext(source, c);
    const api = c.HAIKU_LIBRO_SERVICIOS_SCOPE_V2, manuales = new Map();
    const construir = () => api.construir(consulta, new Map(), manuales);
    const resolver = async (indice, campos) => {
        const actual = await construir(), item = actual.items.filter(x => x.kind === 'servicio')[indice];
        return api.confirmarServicioManual(consulta, item.item_id, campos, manuales, item.firmaManual);
    };
    return { c, api, manuales, construir, resolver, state: c.fixtureServicios, document, Element,
        guard: () => vm.runInContext(read('js/haiku-libro-confirm-cancel-fix-v1.js'), c), captures };
}
module.exports = { read, source, consulta, setup, entorno, Element };
