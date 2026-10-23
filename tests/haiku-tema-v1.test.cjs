const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/haiku-tema-v1.js'), 'utf8');

function entorno({ guardado = null, restringido = false, readyState = 'loading' } = {}) {
    const eventos = {}, acciones = {}, atributos = {}, escrituras = [];
    const icono = {}, texto = {}, boton = {
        hidden: true, setAttribute(k, v) { this[k] = v; },
        querySelector(s) { return s === '[data-tema-icono]' ? icono : texto; },
        addEventListener(k, fn) { (acciones[k] ||= []).push(fn); }
    };
    let montado = readyState !== 'loading';
    const context = vm.createContext({
        window: { addEventListener(k, fn) { (eventos[k] ||= []).push(fn); } },
        document: {
            readyState,
            documentElement: { setAttribute(k, v) { atributos[k] = v; } },
            getElementById(id) { assert.equal(id, 'haiku-tema-boton'); return montado ? boton : null; },
            addEventListener(k, fn) { (eventos[k] ||= []).push(fn); }
        },
        localStorage: {
            getItem(k) { assert.equal(k, 'haikuTemaV1'); if (restringido) throw Error('bloqueado'); return guardado; },
            setItem(k, v) { if (restringido) throw Error('bloqueado'); escrituras.push([k,v]); }
        }
    });
    const ejecutar = () => vm.runInContext(source, context);
    const emitir = (k, e = {}) => (eventos[k] || []).forEach(f => f(e));
    const clic = () => (acciones.click || []).forEach(f => f({ stopPropagation() {} }));
    ejecutar();
    return { context, atributos, boton, texto, icono, acciones, escrituras, ejecutar, emitir, clic,
        montar() { montado = true; emitir('DOMContentLoaded'); } };
}

test('primera visita en claro, sin escribir preferencias ni necesitar el cuerpo del documento', () => {
    const e = entorno();
    assert.equal(e.atributos['data-haiku-tema'], 'claro');
    assert.deepEqual(e.escrituras, []);
    e.montar();
    assert.equal(e.boton.hidden, false);
    assert.equal(e.boton['aria-label'], 'Cambiar a tema oscuro');
});
test('recupera oscuro antes de DOMContentLoaded y ofrece volver a claro', () => {
    const e = entorno({ guardado: 'oscuro' });
    assert.equal(e.atributos['data-haiku-tema'], 'oscuro');
    e.montar();
    assert.equal(e.texto.textContent, 'Tema claro');
    assert.equal(e.icono.textContent, '☀');
    assert.deepEqual(e.escrituras, []);
});
test('cada clic cambia una vez y guarda exclusivamente la preferencia visual', () => {
    const e = entorno(); e.montar(); e.clic();
    assert.equal(e.context.window.HAIKU_TEMA_V1.tema, 'oscuro');
    e.clic();
    assert.equal(e.context.window.HAIKU_TEMA_V1.tema, 'claro');
    assert.deepEqual(e.escrituras, [['haikuTemaV1','oscuro'], ['haikuTemaV1','claro']]);
});
test('valor desconocido vuelve a claro sin sobrescribir el almacenamiento', () => {
    const e = entorno({ guardado: 'valor-antiguo' }); e.montar();
    assert.equal(e.context.window.HAIKU_TEMA_V1.tema, 'claro');
    assert.deepEqual(e.escrituras, []);
});
test('el tema sigue funcionando si el navegador restringe localStorage', () => {
    const e = entorno({ restringido: true }); e.montar(); e.clic();
    assert.equal(e.atributos['data-haiku-tema'], 'oscuro');
    e.clic(); assert.equal(e.atributos['data-haiku-tema'], 'claro');
});
test('sincroniza la elección de otra pestaña sin volver a escribirla', () => {
    const e = entorno(); e.montar();
    e.emitir('storage', { key: 'haikuDatos', newValue: 'oscuro' });
    assert.equal(e.atributos['data-haiku-tema'], 'claro');
    e.emitir('storage', { key: 'haikuTemaV1', newValue: 'oscuro' });
    assert.equal(e.atributos['data-haiku-tema'], 'oscuro');
    e.emitir('storage', { key: 'haikuTemaV1', newValue: null });
    assert.equal(e.atributos['data-haiku-tema'], 'claro');
    assert.deepEqual(e.escrituras, []);
});
test('carga repetida no duplica el botón ni sus listeners', () => {
    const e = entorno({ readyState: 'complete' }); e.ejecutar();
    assert.equal(e.acciones.click.length, 1);
    e.clic(); assert.equal(e.escrituras.length, 1);
});
test('el selector no activa los manejadores de clic fuera del panel abierto', () => {
    const e = entorno(); e.montar(); let detenidos = 0;
    for (const nombre of ['pointerdown','click']) e.acciones[nombre][0]({ stopPropagation() { detenidos++; } });
    assert.equal(detenidos, 2);
});
