const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { entorno } = require('./fixtures/libro-servicio-manual.cjs');
const titulo = 'Servicios que requieren revisión';
const archivo = 'js/haiku-libro-consultas-v1.js';
const original = 'const apiConsultas = Object.freeze({ interpretar,';
const fuente = fs.readFileSync(archivo, 'utf8');
assert.equal(fuente.split(original).length, 2, 'acceso de prueba al render, sin cambiar la API publicada');

function vista(estados = [], criterio = 'operativo_v2', pago = false) {
    const e = entorno();
    e.Element.prototype.replaceChildren = function (...xs) { this.text = ''; this.children = []; this.append(...xs); };
    e.document.querySelector = () => null;
    let llamadas = 0;
    e.c.haikuSupabase = { rpc() { llamadas++; throw Error('Sin escrituras'); }, from() { llamadas++; throw Error('Sólo render'); } };
    vm.runInContext(fuente.replace(original, 'const apiConsultas = Object.freeze({ renderizarComparacion, interpretar,'), e.c);
    const reserva = { titular:'Reserva de prueba', cabana:2, fecha_checkin:'2026-10-10', fecha_checkout:'2026-10-11',
        pagos:[], pagos_sin_asociacion:[], servicios:[], advertencias_informativas:[] };
    const comp = [];
    comp.grupos = []; comp.meta = { libro:0, proyecto:0 };
    comp.criterioServiciosNotas = criterio; comp.notasDetalle = [];
    comp.serviciosDetalle = estados.map((estado, i) => ({ estado, canonico:criterio === 'operativo_v2',
        reserva:{...reserva,titular:'Servicio de prueba '+i}, servicio:{concepto:'lateout',texto_original:'Glosa '+i},
        razon:'Diferencia comprobada '+i }));
    comp.pagosDetalle = pago ? [{estado:'diferente',reserva,pago:{tipo_movimiento:'alojamiento',monto:146302},
        actualizacionExistente:{cambios:[{campo:'monto',anterior:146300,libro:146302}],motivos:['Verificar comprobante']}}] : [];
    const out = new e.Element('div'), antes = JSON.stringify(comp.serviciosDetalle);
    const pintar = () => e.c.HAIKU_LIBRO_CONSULTAS.renderizarComparacion(out, {
        q:{desde:'2026-10-01',hasta:'2026-10-31'}, comparacion:comp, reservas:[reserva] });
    pintar();
    const buscar = nombre => out.querySelectorAll('details').find(d => d.querySelector('summary')?.['aria-label']?.startsWith(nombre+' ('));
    assert.equal(JSON.stringify(comp.serviciosDetalle), antes, 'el render no cambia la clasificación');
    return {out, comp, buscar, pintar, llamadas:() => llamadas};
}

test('Restaurar fila compacta aunque no queden servicios pendientes: contador real 0', () => {
    const v = vista(['en_sistema','en_sistema']), fila = v.buscar(titulo);
    assert.ok(fila); assert.ok(fila.classList.contains('haiku-comparacion-acordeon'));
    assert.ok(fila.classList.contains('haku-icono--servicio'));
    assert.ok(fila.classList.contains('haku-franja--revision'));
    assert.equal(fila.querySelector('.haku-comparacion-fila-titulo').textContent, titulo);
    assert.equal(fila.querySelector('.haku-comparacion-fila-cantidad').textContent, '0');
    assert.equal(fila.querySelector('summary')['aria-label'], titulo+' (0)');
    assert.equal(Boolean(fila.open), false, 'cerrada inicialmente, como las otras categorías');
    assert.match(fila.querySelector('ul').textContent, /No hay servicios que requieran revisión/);
    assert.doesNotMatch(fila.textContent, /Servicio de prueba/);
    assert.equal(v.llamadas(), 0);
});

for (const n of [1,2,7]) test('Cuenta '+n+' discrepancias reales y mantiene su detalle', () => {
    const v = vista([...Array(n).fill('revisar'),'en_sistema']), fila = v.buscar(titulo);
    assert.equal(fila.querySelector('.haku-comparacion-fila-cantidad').textContent, String(n));
    assert.equal(fila.querySelectorAll('li').length, n);
    assert.match(fila.textContent, /Diferencia comprobada 0/);
    assert.doesNotMatch(fila.textContent, new RegExp('Servicio de prueba '+n));
    assert.equal(v.llamadas(), 0);
});

test('Servicios preparados y notas no se suman al contador de revisión', () => {
    const v = vista(['faltante','en_sistema']);
    v.comp.notasDetalle = [{estado:'faltante',reserva:{titular:'Nota de prueba'},texto:'Dejar batas'}];
    v.pintar();
    assert.equal(v.buscar(titulo).querySelector('.haku-comparacion-fila-cantidad').textContent, '0');
    assert.ok(v.buscar('Servicios preparados para incorporar')); assert.ok(v.buscar('Notas por incorporar'));
    assert.equal(v.out.querySelectorAll('.haku-icono--servicio').filter(d => d.querySelector('summary')['aria-label'].startsWith(titulo)).length,1);
});

test('Sin párrafo grande: el diseño no mezcla pagos actualizables ni revive avisos conciliados', () => {
    const v = vista(['en_sistema'], 'operativo_v2', true);
    assert.doesNotMatch(v.out.textContent, /Servicios y notas verificados con el mismo criterio/);
    assert.ok(v.buscar('Pagos existentes por actualizar'));
    assert.match(v.buscar('Pagos existentes por actualizar').textContent, /Verificar comprobante/);
    assert.equal(v.buscar(titulo).querySelector('.haku-comparacion-fila-cantidad').textContent, '0');
    assert.equal(v.buscar('Pagos que requieren revisión'), undefined, 'otras categorías vacías no se alteran');
    assert.ok(v.out.querySelectorAll('button').some(b => b.textContent === 'Preparar incorporación'));
    assert.equal(v.llamadas(), 0);
});

test('Motor no disponible: aviso conservado dentro del desplegable, sin afirmar conciliación', () => {
    const v = vista([], 'no_disponible'), fila = v.buscar(titulo);
    assert.ok(fila);
    assert.match(fila.textContent, /comparación preliminar/);
    assert.match(fila.textContent, /No está disponible la revisión operativa común/);
    assert.doesNotMatch(fila.textContent, /No hay servicios que requieran revisión/);
    const aviso = fila.querySelector('.haku-fila-detalle'); assert.ok(aviso);
    assert.equal(aviso.parentElement, fila); assert.equal(v.llamadas(), 0);
});
