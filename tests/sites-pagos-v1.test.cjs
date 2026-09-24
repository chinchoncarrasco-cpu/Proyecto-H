const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const leer = archivo => fs.readFileSync(path.join(__dirname, '..', archivo), 'utf8');
const fuente = leer('js/sites-pagos-v1.js');

test('Pagos Sites conserva un único montaje para cada lector financiero y el formulario WebPay real', () => {
    const html = leer('index.html');
    const panel = leer('panel.html');
    const seccion = html.slice(html.indexOf('<section id="seccion-pagos"'),
        html.indexOf('<!-- ============================= -->', html.indexOf('<section id="seccion-pagos"')));
    for (const tipo of ['abonos', 'checkin', 'checkout', 'webpay']) {
        assert.equal((seccion.match(new RegExp(`id="pagos-lista-${tipo}"`, 'g')) || []).length, 1);
        assert.equal((seccion.match(new RegExp(`id="pagos-contador-${tipo}"`, 'g')) || []).length, 1);
    }
    for (const id of ['pagos-webpay-nombre', 'pagos-webpay-rut', 'pagos-webpay-cabana',
        'pagos-webpay-monto', 'pagos-webpay-codaut', 'pagos-webpay-tipo',
        'pagos-webpay-fecha-pago', 'pagos-webpay-fecha-reserva',
        'pagos-webpay-tarjeta', 'pagos-webpay-agregar']) {
        assert.equal((seccion.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
    }
    assert.doesNotMatch(seccion, /prototipo|fictici|demostraci[oó]n|s[oó]lo demo/i);
    assert.match(panel, /css\/sites-pagos-v1\.css\?v=\$\{version\}/);
    assert.match(panel, /js\/sites-pagos-v1\.js\?v=\$\{version\}/);
    assert.ok(panel.indexOf('scriptsSupabaseV2}\\n<script src="js/sites-pagos-v1.js') >
        panel.indexOf('const scriptsSupabaseV2'));
});

test('los contadores y saldos los producen autoridades reales, y pagos/BOVE mantienen escritores separados', () => {
    const fuentes = {
        abonos: leer('js/supabase-abonos-verificacion-v2.js'),
        checkin: leer('js/supabase-pagos-checkin-v5.js'),
        checkout: leer('js/supabase-pagos-checkout-v1.js'),
        webpay: leer('js/supabase-webpay-v1.js'),
        grupo: leer('js/supabase-pagos-checkin-grupo-v2.js')
    };
    for (const tipo of ['abonos', 'checkin', 'checkout', 'webpay']) {
        assert.match(fuentes[tipo], new RegExp(`getElementById\\("pagos-contador-${tipo}"\\)`));
        assert.match(fuentes[tipo], new RegExp(`getElementById\\("pagos-lista-${tipo}"\\)`));
        assert.doesNotMatch(fuente, new RegExp(`getElementById\\(["']pagos-contador-${tipo}["']\\)\\.textContent\\s*=`));
    }
    assert.match(fuentes.checkin, /from\("vista_saldos_alojamiento_reserva"\)/);
    assert.match(fuentes.checkout, /from\("vista_estado_cargos"\)[\s\S]*?\.eq\("tipo_cargo", "servicio"\)[\s\S]*?\.eq\("estado", "activo"\)/);
    assert.match(fuentes.checkin, /rpc\("haiku_registrar_pago_checkin_v2"/);
    assert.match(fuentes.checkout, /rpc\("haiku_registrar_pago_checkout"/);
    assert.match(fuentes.checkin, /rpc\("haiku_registrar_bove_reserva"/);
    assert.match(fuentes.checkout, /"haiku_registrar_bove_checkout"/);
    assert.match(fuentes.grupo, /"haiku_registrar_bove_reserva_grupo"/);
    assert.match(fuentes.webpay, /\.eq\("estado", "pendiente_asociacion"\)/);
    assert.doesNotMatch(fuente, /\.from\(|\.insert\(|\.update\(|\.delete\(/);
    assert.deepEqual([...fuente.matchAll(/\.rpc\("([^"]+)"/g)].map(x => x[1]), ['haiku_operacion_dia']);
});

test('Pagos oculta los cuatro montajes legacy desde HTML/CSS estático, antes de JS u observer', () => {
    const html = leer('index.html');
    const css = leer('css/sites-pagos-v1.css');
    const panel = leer('panel.html');
    const cssCritico = html.match(/<style id="sites-pagos-primer-paint">([\s\S]*?)<\/style>/)?.[1];
    const seccion = html.slice(html.indexOf('<section id="seccion-pagos"'),
        html.indexOf('<!-- ============================= -->', html.indexOf('<section id="seccion-pagos"')));
    assert.ok(cssCritico, 'la barrera CSS debe ser parte del HTML inicial');
    assert.ok(html.indexOf('sites-pagos-primer-paint') < html.indexOf('css/styles.css'));
    assert.match(seccion, /id="seccion-pagos" class="seccion-app sites-pagos sites-pagos-protegido"/);
    for (const tipo of ['abonos', 'checkin', 'checkout', 'webpay']) {
        assert.match(seccion, new RegExp(`class="panel pagos-panel sites-pagos-section"`));
        assert.match(seccion, new RegExp(`data-sites-pagos-count="${tipo}"`));
        for (const hoja of [cssCritico, css]) {
            assert.ok(hoja.includes(`#seccion-pagos.sites-pagos-protegido #pagos-lista-${tipo} > :not(`), tipo);
            assert.ok(hoja.includes(`#seccion-pagos.sites-pagos-protegido #pagos-lista-${tipo}:not(:has(`), tipo);
        }
    }
    for (const hoja of [cssCritico, css]) {
        assert.match(hoja, /#pagos-lista-abonos > :not\(\.haiku-abono-verificacion-v2\):not\(\.sites-pagos-vacio-canonico\)/);
        assert.match(hoja, /#pagos-lista-checkin > :not\(\.haiku-saldo-v5\[data-sites-pagos-compuesto="1"\]\):not\(\.sites-pagos-vacio-canonico\)/);
        assert.match(hoja, /#pagos-lista-checkout > :not\(\.haiku-checkout-v1\[data-sites-pagos-compuesto="1"\]\):not\(\.sites-pagos-vacio-canonico\)/);
        assert.match(hoja, /#pagos-lista-webpay > :not\(\.haiku-webpay-pendiente\):not\(\.sites-pagos-vacio-canonico\)\s*\{\s*display:\s*none/);
        assert.match(hoja, /content:\s*"Cargando datos del turno…"/);
    }
    assert.ok(panel.indexOf('css/sites-pagos-v1.css?v=${version}') <
        panel.indexOf('js/sites-pagos-v1.js?v=${version}'));
    assert.doesNotMatch(fuente, /setTimeout\(instalar/);
    assert.doesNotMatch(seccion + css + fuente, /prototipo|fictici|demostraci[oó]n|s[oó]lo demo|sin registro real/i);
});

function crearEntorno(filas, opciones = {}) {
    const listenersDocumento = new Map();
    const listenersVentana = new Map();
    const temporizadores = new Map();
    const nodos = new Map();
    let siguienteTimer = 0;
    let observadores = 0;
    const callbacksObservadores = new Map();
    const rpc = [];
    const avisos = [];

    function claveDato(atributo) {
        return atributo.slice(5).replace(/-([a-z])/g, (_, letra) => letra.toUpperCase());
    }
    function coincide(nodo, selector) {
        const texto = selector.trim();
        if (/^[a-z][a-z0-9]*$/i.test(texto)) return nodo.tagName.toLowerCase() === texto.toLowerCase();
        const id = texto.match(/#([\w-]+)/);
        if (id && nodo.id !== id[1]) return false;
        for (const [, clase] of texto.matchAll(/\.([\w-]+)/g)) {
            if (!nodo.className.split(/\s+/).includes(clase)) return false;
        }
        for (const [, atributo] of texto.matchAll(/\[([^\]]+)\]/g)) {
            if (atributo.startsWith('data-') &&
                !Object.hasOwn(nodo.dataset, claveDato(atributo))) return false;
        }
        return Boolean(id || texto.includes('.') || texto.includes('['));
    }
    class Elemento {
        constructor(etiqueta = 'div', clase = '') {
            this.tagName = etiqueta.toUpperCase();
            this.className = clase;
            this.children = [];
            this.dataset = {};
            this.hidden = false;
            this.open = false;
            this.isConnected = true;
            this.listeners = new Map();
            this.value = '';
            this.textContent = '';
            this.id = '';
            this.parentNode = null;
            this.classList = {
                add: claseNueva => { this.className = `${this.className} ${claseNueva}`.trim(); },
                contains: claseBuscada => this.className.split(/\s+/).includes(claseBuscada)
            };
        }
        appendChild(nodo) {
            if (nodo.parentNode) nodo.parentNode.children.splice(
                nodo.parentNode.children.indexOf(nodo), 1);
            this.children.push(nodo);
            nodo.parentNode = this;
            return nodo;
        }
        append(...hijos) { hijos.forEach(hijo => this.appendChild(hijo)); }
        before(nodo) {
            const padre = this.parentNode;
            assert.ok(padre, 'before requiere un padre');
            if (nodo.parentNode) nodo.parentNode.children.splice(
                nodo.parentNode.children.indexOf(nodo), 1);
            padre.children.splice(padre.children.indexOf(this), 0, nodo);
            nodo.parentNode = padre;
        }
        after(nodo) {
            const padre = this.parentNode;
            assert.ok(padre, 'after requiere un padre');
            if (nodo.parentNode) nodo.parentNode.children.splice(
                nodo.parentNode.children.indexOf(nodo), 1);
            padre.children.splice(padre.children.indexOf(this) + 1, 0, nodo);
            nodo.parentNode = padre;
        }
        setAttribute(nombre, valor) { this[nombre] = valor; }
        addEventListener(tipo, listener) {
            const lista = this.listeners.get(tipo) || [];
            lista.push(listener);
            this.listeners.set(tipo, lista);
        }
        click() { return Promise.all((this.listeners.get('click') || []).map(
            listener => listener({ target: this }))); }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        querySelectorAll(selector) {
            const hijos = nodo => nodo.children.flatMap(hijo => [hijo, ...hijos(hijo)]);
            const resultado = new Set();
            for (const parteOriginal of selector.split(',')) {
                const parte = parteOriginal.trim();
                if (parte.startsWith(':scope > ')) {
                    this.children.filter(nodo => coincide(nodo, parte.slice(9))).forEach(nodo => resultado.add(nodo));
                } else if (parte.includes(' > ')) {
                    const [padre, hijo] = parte.split(' > ');
                    hijos(this).filter(nodo => coincide(nodo, padre)).forEach(nodo =>
                        nodo.children.filter(desc => coincide(desc, hijo)).forEach(desc => resultado.add(desc)));
                } else {
                    hijos(this).filter(nodo => coincide(nodo, parte)).forEach(nodo => resultado.add(nodo));
                }
            }
            return [...resultado];
        }
        set innerHTML(valor) {
            this.html = valor;
            this.children = [];
            if (this.className.includes('sites-pagos-bove')) {
                const contexto = new Elemento('p'); contexto.dataset.sitesBoveContexto = '';
                const estado = new Elemento('p'); estado.dataset.sitesBoveEstado = '';
                const codigo = new Elemento('input'); codigo.id = 'sites-pagos-bove-codigo';
                const cerrar = new Elemento('button'); cerrar.dataset.sitesBoveCerrar = '';
                const confirmar = new Elemento('button'); confirmar.dataset.sitesBoveConfirmar = '';
                this.append(contexto, estado, codigo, cerrar, confirmar);
            } else if (this.className.includes('sites-pagos-selector')) {
                const select = new Elemento('select'); select.id = 'sites-pagos-reserva';
                const estado = new Elemento('p', 'sites-pagos-selector-estado');
                const cerrar = new Elemento('button'); cerrar.dataset.sitesPagosCerrar = '';
                const continuar = new Elemento('button'); continuar.dataset.sitesPagosContinuar = '';
                continuar.disabled = true;
                this.append(select, estado, cerrar, continuar);
            }
        }
        get innerHTML() { return this.html || ''; }
    }
    const documento = {
        body: new Elemento('body'),
        getElementById: id => nodos.get(id) || null,
        createElement: etiqueta => new Elemento(etiqueta),
        addEventListener(tipo, listener) {
            const lista = listenersDocumento.get(tipo) || [];
            lista.push(listener);
            listenersDocumento.set(tipo, lista);
        }
    };
    for (const id of ['seccion-pagos', 'sites-pagos-fecha', 'pagos-lista-abonos',
        'pagos-lista-checkin', 'pagos-lista-checkout']) {
        const nodo = new Elemento(); nodo.id = id; nodos.set(id, nodo);
    }
    const ventana = {
        haikuSesion: { id: 'usuario' },
        haikuSupabase: { rpc(nombre, payload) {
            rpc.push({ nombre, payload });
            return Promise.resolve(opciones.errorLectura
                ? { data: null, error: new Error('Lectura operativa no disponible') }
                : { data: filas, error: null });
        } },
        HAIKU_RESUMEN_PAGO_SITES_V1: {},
        HAIKU_SITES_RESUMEN_DRAWER_V1: {
            registrar() {}, sincronizar() {}, marcarDisparador() {}
        },
        haikuTienePermiso: () => false,
        addEventListener(tipo, listener) {
            const lista = listenersVentana.get(tipo) || [];
            lista.push(listener);
            listenersVentana.set(tipo, lista);
        }
    };
    const contexto = vm.createContext({
        window: ventana, document: documento, fechaSeleccionada: '2026-09-23',
        MutationObserver: class {
            constructor(callback) { this.callback = callback; }
            observe(nodo) { observadores++; callbacksObservadores.set(nodo.id, this.callback); }
        },
        setTimeout(listener) { const id = ++siguienteTimer; temporizadores.set(id, listener); return id; },
        clearTimeout(id) { temporizadores.delete(id); },
        console: { ...console, warn: (...args) => avisos.push(args) }, Intl, Date
    });
    vm.runInContext(fuente, contexto, { filename: 'sites-pagos-v1.js' });
    async function vaciarTimers() {
        for (let vueltas = 0; temporizadores.size && vueltas < 10; vueltas++) {
            const [id, listener] = temporizadores.entries().next().value;
            temporizadores.delete(id);
            await listener();
        }
        // El adaptador agenda una composición async sin devolver su Promise.
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(temporizadores.size, 0, 'la composición debe estabilizarse');
    }
    function tarjeta(etapa, reservaId, conBove = false, legacy = false) {
        const card = new Elemento('div', etapa === 'checkout' ?
            (legacy ? 'pago-checkout-item' : 'pago-checkout-item haiku-checkout-v1') :
            (legacy ? 'pago-checkin-item' : 'pago-checkin-item haiku-saldo-v5'));
        card.dataset.reservaId = reservaId;
        const cuerpo = new Elemento('div', 'pago-checkin-nuevo');
        const cabecera = new Elemento('div', 'pago-checkin-cabecera');
        const resumen = new Elemento('div', 'pago-checkin-resumen-nuevo');
        const formulario = new Elemento('div', 'haiku-saldo-formulario');
        cuerpo.append(cabecera, resumen, formulario);
        let bove = null;
        if (conBove) {
            const bloque = new Elemento('div', 'haiku-bove-cierre haiku-bove-pendiente');
            const fila = new Elemento('div', 'haiku-bove-fila');
            const campo = new Elemento('input');
            campo.dataset[etapa === 'checkout' ? 'haikuCheckoutBove' : 'haikuBoveTotal'] = '';
            const original = new Elemento('button');
            fila.append(campo, original); bloque.appendChild(fila); cuerpo.appendChild(bloque);
            bove = { bloque, fila, campo, original };
        }
        card.appendChild(cuerpo);
        nodos.get(`pagos-lista-${etapa}`).appendChild(card);
        return { card, cuerpo, formulario, bove };
    }
    return { ventana, contexto, documento, nodos, rpc, avisos, tarjeta, vaciarTimers,
        crearElemento: (etiqueta, clase) => new Elemento(etiqueta, clase),
        emitirMutacion: id => callbacksObservadores.get(id)?.(),
        get observadores() { return observadores; },
        listenerDocumento: tipo => listenersDocumento.get(tipo) || [],
        listenerVentana: tipo => listenersVentana.get(tipo) || [] };
}

test('una tarjeta recién insertada se compone antes de cualquier timeout o lectura RPC', () => {
    const ui = crearEntorno([]);
    const ingreso = ui.tarjeta('checkin', 'reserva-9');
    assert.equal(ingreso.card.dataset.sitesPagosCompuesto, undefined);
    ui.emitirMutacion('pagos-lista-checkin');
    assert.equal(ingreso.card.dataset.sitesPagosCompuesto, '1');
    assert.ok(ingreso.card.querySelector('.sites-pagos-detalle'));
    assert.equal(ui.rpc.length, 0);
});

test('una tarjeta legacy temprana no puede recibir el atributo que la haría visible', () => {
    const ui = crearEntorno([]);
    const ingresoLegacy = ui.tarjeta('checkin', 'reserva-9', false, true);
    const salidaLegacy = ui.tarjeta('checkout', 'reserva-6', false, true);
    ui.emitirMutacion('pagos-lista-checkin');
    ui.emitirMutacion('pagos-lista-checkout');
    for (const tarjeta of [ingresoLegacy, salidaLegacy]) {
        assert.equal(tarjeta.card.dataset.sitesPagosCompuesto, undefined);
        assert.equal(tarjeta.card.querySelector('.sites-pagos-detalle'), null);
    }
    assert.equal(ui.rpc.length, 0);
});

test('el detalle plano distribuye pagos, BOVE y servicios reales sin reemplazar sus nodos', () => {
    const ui = crearEntorno([]);
    const elemento = ui.crearElemento;
    const ingreso = ui.tarjeta('checkin', 'reserva-1');
    const pagos = elemento('details', 'haiku-saldo-detalle');
    const listaPagos = elemento('div', 'haiku-saldo-pagos-lista');
    const pago = elemento('div', 'haiku-saldo-pago-confirmado');
    const editar = elemento('button', 'haiku-pago-editar');
    editar.dataset.haikuPagoEditar = '';
    let ediciones = 0;
    editar.addEventListener('click', () => { ediciones++; });
    pago.appendChild(editar);
    listaPagos.appendChild(pago);
    pagos.appendChild(listaPagos);
    const bove = elemento('div', 'haiku-bove-cierre haiku-bove-ok');
    const titulo = elemento('strong');
    const numero = elemento('span'); numero.textContent = '16981';
    const recepcion = elemento('small'); recepcion.textContent = 'Recepción · 23 sep';
    bove.append(titulo, numero, recepcion);
    const servicios = elemento('div', 'haiku-checkin-servicios-separados');
    const boveSalida = elemento('div', 'haiku-checkin-servicios-bove');
    boveSalida.textContent = '✓ BOVE Check-out 19888';
    servicios.appendChild(boveSalida);
    ingreso.cuerpo.append(pagos, bove, servicios);
    ui.emitirMutacion('pagos-lista-checkin');

    const columnaPagos = ingreso.card.querySelector('.sites-pagos-detalle-pagos');
    const columnaDocumentos = ingreso.card.querySelector('.sites-pagos-detalle-documentos');
    assert.equal(columnaPagos.querySelector('h3').textContent, 'Pagos registrados');
    assert.equal(columnaDocumentos.querySelector('h3').textContent, 'Documentos y servicios');
    assert.equal(pagos.parentNode, columnaPagos);
    assert.equal(pagos.open, true);
    assert.equal(pago.parentNode, listaPagos);
    assert.equal(editar.parentNode, pago);
    editar.click();
    assert.equal(ediciones, 1);
    assert.equal(bove.parentNode, columnaDocumentos);
    assert.equal(titulo.textContent, '✓ BOVE alojamiento');
    assert.equal(numero.textContent, '16981');
    assert.equal(recepcion.textContent, 'Recepción · 23 sep');
    assert.equal(ingreso.card.querySelector('.sites-pagos-abrir-bove'), null);
    assert.equal(servicios.parentNode, columnaDocumentos);
    assert.equal(boveSalida.parentNode, servicios);
});

test('dos pagos y servicios pagado/pendiente quedan en filas propias; sin servicios se muestra vacío', () => {
    const ui = crearEntorno([]);
    const elemento = ui.crearElemento;
    const salida = ui.tarjeta('checkout', 'reserva-6');
    const pagos = elemento('details', 'haiku-saldo-detalle');
    const lista = elemento('div', 'haiku-saldo-pagos-lista');
    const pagosReales = ['Transferencia · $30.000', 'WebPay · $12.000'].map(texto => {
        const fila = elemento('div', 'haiku-saldo-pago-confirmado');
        fila.textContent = texto;
        lista.appendChild(fila);
        return fila;
    });
    pagos.appendChild(lista);
    const servicios = elemento('div', 'haiku-checkout-servicios');
    const servicioPendiente = elemento('div', 'haiku-checkout-servicio');
    servicioPendiente.textContent = 'Tinaja · Pendiente $50.000';
    const servicioPagado = elemento('div', 'haiku-checkout-servicio');
    servicioPagado.textContent = 'Leña · Pagado $12.000';
    servicios.append(servicioPendiente, servicioPagado);
    salida.cuerpo.append(servicios, pagos);
    ui.emitirMutacion('pagos-lista-checkout');
    assert.equal(salida.card.querySelector('.sites-pagos-detalle-pagos')
        .querySelectorAll('.haiku-saldo-pago-confirmado').length, 2);
    assert.equal(pagosReales[0].textContent, 'Transferencia · $30.000');
    assert.equal(pagosReales[1].textContent, 'WebPay · $12.000');
    assert.equal(servicios.parentNode, salida.card.querySelector('.sites-pagos-detalle-documentos'));
    assert.equal(servicioPendiente.textContent, 'Tinaja · Pendiente $50.000');
    assert.equal(servicioPagado.textContent, 'Leña · Pagado $12.000');

    const sinServicios = ui.tarjeta('checkin', 'reserva-7');
    ui.emitirMutacion('pagos-lista-checkin');
    assert.match(sinServicios.card.querySelector('.sites-pagos-detalle-documentos')
        .querySelector('.sites-pagos-detalle-vacio').textContent,
        /Sin documentos ni servicios/);
});

test('la capa Sites aplana tarjetas internas y apila columnas antes de 760 px', () => {
    const css = leer('css/sites-pagos-v1.css');
    assert.match(css, /\.sites-pagos-detalle-pagos \.haiku-saldo-pago-confirmado\s*\{[^}]*border-radius:\s*0;[^}]*background:\s*transparent/s);
    assert.match(css, /\.sites-pagos-detalle-documentos > \.haiku-bove-cierre\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent/s);
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.sites-pagos-detalle-contenido\s*\{\s*grid-template-columns:\s*1fr/);
});

test('el adaptador usa ID exacto y etapa del día; conserva el formulario real y no duplica controles al refrescar', async () => {
    const ui = crearEntorno([
        { numero: 9, estado_operativo: 'libre-ingresa',
            ingreso_reserva_id: 'reserva-9', salida_reserva_id: 'antigua-9' },
        { numero: 6, estado_operativo: 'sale-libre', salida_reserva_id: 'reserva-6' },
        { numero: 4, estado_operativo: 'libre-ingresa',
            ingreso_reserva_id: 'miembro-grupo-4' }
    ]);
    const ingreso = ui.tarjeta('checkin', 'reserva-9');
    const salida = ui.tarjeta('checkout', 'reserva-6');
    const etapaAjena = ui.tarjeta('checkin', 'reserva-6');
    const grupo = ui.tarjeta('checkin', 'miembro-grupo-4');
    grupo.card.classList.add('haiku-checkin-grupo-v2');
    grupo.card.dataset.grupoId = 'grupo-4';
    await ui.vaciarTimers();
    for (const [tarjeta, etapa, cabana] of [
        [ingreso, 'checkin', '9'], [salida, 'checkout', '6'],
        [grupo, 'checkin', '4']
    ]) {
        const detalle = tarjeta.card.querySelector('.sites-pagos-detalle');
        const boton = tarjeta.card.querySelector('.sites-pagos-abrir-pago');
        assert.ok(detalle);
        assert.ok(boton, `no se creó botón para ${etapa} de ${tarjeta.card.dataset.reservaId}`);
        assert.equal(boton.dataset.resumenPagoReservaId, tarjeta.card.dataset.reservaId);
        assert.equal(boton.dataset.resumenPagoEtapa, etapa);
        assert.equal(boton.dataset.resumenPago, cabana);
        assert.equal(boton.dataset.sitesPagosFecha, '2026-09-23');
        assert.equal(tarjeta.formulario.parentNode,
            tarjeta.card.querySelector('.sites-pagos-detalle-pagos'));
        assert.equal(tarjeta.formulario.hidden, true);
    }
    assert.equal(etapaAjena.card.querySelector('.sites-pagos-abrir-pago'), null);
    assert.equal(etapaAjena.formulario.hidden, false);
    assert.equal(ui.rpc.length, 1);
    assert.equal(ui.rpc[0].nombre, 'haiku_operacion_dia');
    assert.equal(ui.rpc[0].payload.p_fecha, '2026-09-23');
    const listenersIniciales = ui.listenerDocumento('click').length;
    ui.ventana.HAIKU_SITES_PAGOS_V1.refrescar();
    await ui.vaciarTimers();
    assert.equal(ingreso.card.querySelectorAll('.sites-pagos-abrir-pago').length, 1);
    assert.equal(salida.card.querySelectorAll('.sites-pagos-abrir-pago').length, 1);
    assert.equal(grupo.card.querySelectorAll('.sites-pagos-abrir-pago').length, 1);
    assert.equal(ui.observadores, 3);
    assert.equal(ui.listenerDocumento('click').length, listenersIniciales);
    assert.equal(ui.rpc.length, 2);
});

test('el drawer BOVE cancela sin escribir y confirma una sola vez mediante el botón real de Check-out', async () => {
    const ui = crearEntorno([{ numero: 6, estado_operativo: 'sale-libre',
        salida_reserva_id: 'reserva-6' }]);
    const salida = ui.tarjeta('checkout', 'reserva-6', true);
    let escrituras = 0;
    const tituloBove = ui.crearElemento('strong');
    tituloBove.textContent = 'Pagos de servicios completos · falta BOVE final';
    salida.bove.fila.before(tituloBove);
    salida.bove.original.addEventListener('click', () => { escrituras++; });
    await ui.vaciarTimers();
    const proxy = salida.card.querySelector('.sites-pagos-abrir-bove');
    assert.ok(proxy);
    assert.equal(tituloBove.textContent, 'BOVE Check-out · Pendiente');
    assert.equal(salida.bove.bloque.parentNode,
        salida.card.querySelector('.sites-pagos-detalle-documentos'));
    assert.equal(salida.bove.fila.hidden, true);
    proxy.click();
    const panel = ui.documento.body.querySelector('.sites-pagos-bove');
    assert.equal(panel.hidden, false);
    panel.querySelector('[data-sites-bove-cerrar]').click();
    assert.equal(panel.hidden, true);
    assert.equal(escrituras, 0);
    assert.equal(salida.bove.campo.value, '');

    proxy.click();
    panel.querySelector('#sites-pagos-bove-codigo').value = 'BOVE-6';
    panel.querySelector('[data-sites-bove-confirmar]').click();
    assert.equal(escrituras, 1);
    assert.equal(salida.bove.campo.value, 'BOVE-6');
    assert.equal(panel.hidden, true);
    panel.querySelector('[data-sites-bove-confirmar]').click();
    assert.equal(escrituras, 1);

    ui.ventana.HAIKU_SITES_PAGOS_V1.refrescar();
    await ui.vaciarTimers();
    assert.equal(salida.card.querySelectorAll('.sites-pagos-abrir-bove').length, 1);
    ui.contexto.fechaSeleccionada = '2026-09-24';
    proxy.click();
    panel.querySelector('#sites-pagos-bove-codigo').value = 'BOVE-obsoleto';
    ui.contexto.fechaSeleccionada = '2026-09-25';
    panel.querySelector('[data-sites-bove-confirmar]').click();
    assert.equal(escrituras, 1);
    assert.match(panel.querySelector('[data-sites-bove-estado]').textContent, /estado cambi[oó]/i);
});

test('si falla la lectura del día, el formulario canónico queda disponible y no se ofrece un pago sin identidad verificada', async () => {
    const ui = crearEntorno([], { errorLectura: true });
    const ingreso = ui.tarjeta('checkin', 'reserva-9');
    await ui.vaciarTimers();
    assert.ok(ingreso.card.querySelector('.sites-pagos-detalle'));
    assert.equal(ingreso.card.querySelector('.sites-pagos-abrir-pago'), null);
    assert.equal(ingreso.formulario.hidden, false);
    assert.equal(ingreso.formulario.parentNode,
        ingreso.card.querySelector('.sites-pagos-detalle-pagos'));
    assert.equal(ui.rpc.length, 1);
    assert.match(ui.avisos[0][1].message, /Lectura operativa no disponible/);
});

test('Añadir pago revalida reserva y cabaña exactas antes de abrir el controlador de abono', async () => {
    const ui = crearEntorno([
        { numero: 9, estado_operativo: 'continua', continua_reserva_id: 'reserva-9' }
    ]);
    const llamadas = [];
    ui.ventana.HAIKU_PAGO_GRUPO_V1 = {
        listarReservasDia: async () => [
            { reservaId: 'reserva-antigua', cabs: [9], titular: 'Titular anterior' },
            { reservaId: 'reserva-9', cabs: [9], titular: 'Yann O\'Connell' }
        ]
    };
    ui.ventana.HAIKU_RESUMEN_PAGO_SITES_V1.abrirPagoReserva = async (...args) => {
        llamadas.push(args);
    };
    await ui.vaciarTimers();
    const disparador = ui.documento.createElement('button');
    disparador.className = 'haiku-anadir-pago-boton';
    disparador.isConnected = true;
    const evento = {
        target: { closest: selector => selector === '#seccion-pagos .haiku-anadir-pago-boton'
            ? disparador : null },
        preventDefault() {}, stopImmediatePropagation() {}
    };
    ui.listenerDocumento('click').forEach(listener => listener(evento));
    await new Promise(resolve => setImmediate(resolve));
    const panel = ui.documento.body.querySelector('.sites-pagos-selector');
    assert.ok(panel);
    assert.equal(panel.hidden, false);
    const select = panel.querySelector('#sites-pagos-reserva');
    assert.deepEqual(select.children.map(option => option.value),
        ['reserva-antigua', 'reserva-9']);
    const continuar = panel.querySelector('[data-sites-pagos-continuar]');
    select.value = 'reserva-antigua';
    select.listeners.get('change')[0]({ target: select });
    await continuar.click();
    assert.equal(llamadas.length, 0);
    assert.match(panel.querySelector('.sites-pagos-selector-estado').textContent,
        /reserva o la fecha cambi[oó]/i);

    select.value = 'reserva-9';
    await continuar.click();
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0][0], 'reserva-9');
    assert.equal(llamadas[0][1], 'abono');
    assert.equal(llamadas[0][2], 9);
    assert.equal(llamadas[0][3], disparador);
    assert.equal(disparador.dataset.sitesPagosFecha, '2026-09-23');
    assert.equal(panel.hidden, true);
});
