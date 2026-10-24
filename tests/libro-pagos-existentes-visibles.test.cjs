const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const F = require('./fixtures/libro-comparacion-readonly.cjs');
const { Element } = require('./fixtures/libro-servicio-manual.cjs');
const S = require('../js/haiku-libro-semantica-v1.js');
const fuente = fs.readFileSync(require.resolve('../js/haiku-libro-consultas-v1.js'), 'utf8');
const reservaId = '00000000-0000-4000-8000-000000000041';
const estadiaId = '00000000-0000-4000-8000-000000000042';
const pagoId = '00000000-0000-4000-8000-000000000043';
const nombre = 'Álvaro Ficticio';

// Datos inventados: mismo formato de fila bancaria y nota administrativa separada.
function caso() {
    const data = S.normalizarHoja({ celdas: [
        { r:1, c:2, valor:'24 oct', fechaISO:'2026-10-24' },
        { r:1, c:6, valor:'25 oct', fechaISO:'2026-10-25' },
        { r:2, c:0, valor:'cabaña 2' },
        { r:2, c:2, valor:nombre+' // 1 noche // 2 ADL' },
        { r:24, c:2, valor:'Pagos de arriendos de hoy' },
        { r:25, c:0, valor:'cabaña 2' },
        { r:26, c:2, valor:'23-10-2026', fechaISO:'2026-10-23' },
        { r:26, c:3, valor:nombre+' // webpay x confirmar // cod aut 004321 // crédito // GO' },
        { r:26, c:4, valor:'cab2/1noche' },
        { r:26, c:5, valor:'125000', valorNumero:125000 },
        { r:27, c:3, valor:'PEND BOVE Y MANAGER' }
    ], combinaciones: [
        { s:{r:2,c:2}, e:{r:2,c:4} }, { s:{r:25,c:0}, e:{r:28,c:0} }
    ], estilos:[] }, 'Oct26');
    const r = data.reservas[0];
    const db = { reserva_estadias:[F.estadia(r, { id:estadiaId, reserva_id:reservaId,
        reservas:{ id:reservaId, titular_nombre:'Alvaro Ficticio', estado_reserva:'confirmada' } })],
        pagos:[F.pagoH({ id:pagoId, reserva_id:reservaId, monto:125000, codigo_autorizacion:'004321',
            folio:null, datos_origen:{}, tipo_movimiento:'pago', fecha_pago:'2026-10-23T00:00:00+00:00' })] };
    const w = F.web(data), cliente = F.cliente(db);
    return { data, db, w, cliente, Q:w.HAIKU_LIBRO_CONSULTAS,
        consultar:texto => w.HAIKU_LIBRO_CONSULTAS.consultar(texto, w.HAIKU_LIBRO_RESERVA_V1, cliente) };
}

function vista(w) {
    class Nodo extends Element {
        replaceChildren(...xs) { this.text = ''; this.children = []; this.append(...xs); }
    }
    w.document.createElement = t => new Nodo(t);
    w.document.getElementById = () => null;
    vm.runInContext(fuente.replace('const apiConsultas = Object.freeze({ interpretar,',
        'const apiConsultas = Object.freeze({ renderizarComparacion, interpretar,'), w);
    const out = new Nodo('div');
    return { out, render:r => w.HAIKU_LIBRO_CONSULTAS.renderizarComparacion(out, r),
        existentes:() => out.querySelectorAll('details').find(d =>
            d.querySelector('summary')?.['aria-label'] === 'Pagos · Ya registrados (1)') };
}

for (const sufijo of ['con Proyecto H', 'contra el sistema', 'vs. Supabase', 'en Proyecto H']) {
    test('la búsqueda no incorpora al nombre el destino '+sufijo, async () => {
        const h = caso(), r = await h.consultar('Libro: compara la reserva de '+nombre+' '+sufijo);
        assert.equal(r.q.nombre, 'alvaro ficticio');
        assert.equal(r.reservas.length, 1);
        assert.equal(r.comparacion.pagosDetalle.length, 1);
        assert.equal(r.comparacion.pagosDetalle[0].estado, 'en_sistema');
        assert.equal(r.comparacion.pagosDetalle[0].sistema.id, pagoId);
        assert.deepEqual(h.cliente.mutaciones, []);
    });
}

test('buscar por nombre conserva CAB, fecha, acentos y nombres con partículas', () => {
    const h = caso();
    for (const [texto, esperado] of [
        ['Libro: reserva de Álvaro de la Fuente', 'alvaro de la fuente'],
        ['Libro: compara titular Álvaro del Campo con Proyecto H', 'alvaro del campo'],
        ['Libro: huésped Álvaro Ficticio CAB 2 el 24-10-2026 con Proyecto H', 'alvaro ficticio']
    ]) assert.equal(h.Q.interpretar(texto, ['Oct26']).nombre, esperado);
    const q = h.Q.interpretar('Libro: reserva de Álvaro Ficticio CAB 2 el 24-10-2026 con Proyecto H', ['Oct26']);
    assert.equal(q.cabana, 2); assert.equal(q.desde, '2026-10-24');
    assert.equal(h.Q.interpretar('Libro: compara pagos de octubre 2026 con Proyecto H', ['Oct26']).nombre, null);
});

test('la comparación general muestra el pago existente con evidencia y acceso a su reserva', async () => {
    const h = caso(), r = await h.consultar(F.consulta), v = vista(h.w);
    const antes = JSON.stringify(r), item = r.comparacion.pagosDetalle[0];
    assert.equal(item.estado, 'en_sistema'); assert.equal(item.pago.medio_pago, 'webpay_credito');
    assert.equal(item.pago.codigo_autorizacion, '004321'); assert.equal(item.pago.clasificacion_financiera, 'pago_real');
    const modelo = h.Q.modeloPresentacionComparacion(r);
    assert.equal(modelo.pagosExistentes?.length, 1);
    assert.equal(modelo.pagosFaltan.length, 0); assert.equal(modelo.pagosRevisar.length, 0);
    v.render(r);
    const detalle = v.existentes(); assert.ok(detalle, 'no debe desaparecer por estar conciliado');
    for (const texto of [nombre, 'CAB 2', '$125.000', 'WebPay Crédito', '004321', '2026-10-23', 'Oct26!C27:F27', 'No se volverá a incorporar'])
        assert.ok(detalle.textContent.includes(texto), texto);
    assert.match(v.out.querySelector('.haku-comparacion-sites-aviso-pagos').textContent, /Ya registrados: 1/);
    assert.equal(Boolean(detalle.open), false);
    assert.equal(detalle.querySelectorAll('input').length, 0);
    const boton = detalle.querySelector('button'); assert.equal(boton.textContent, 'Ver reserva');
    let abierta; h.w.HAIKU_INSPECTOR_V1 = { abrirReserva:async id => { abierta = id; return true; } };
    await boton.listeners.click(); assert.equal(abierta, reservaId);
    assert.equal(JSON.stringify(r), antes); assert.deepEqual(h.cliente.mutaciones, []);
});

test('la respuesta textual también explica que el pago ya está registrado', async () => {
    const h = caso(), r = await h.consultar(F.consulta), texto = h.Q.respuesta(r);
    assert.match(texto, /PAGOS YA REGISTRADOS/); assert.match(texto, /004321/);
    assert.match(texto, /No se volverá a incorporar/);
});

test('la vista de sólo pagos conserva su sección existente y no duplica filas', async () => {
    const h = caso(), r = await h.consultar('Libro: compara pagos de octubre 2026 con Proyecto H');
    const v = vista(h.w); v.render(r);
    assert.equal(v.out.querySelectorAll('.haku-pago-fila').length, 1);
    assert.match(v.out.textContent, /Ya existe en Proyecto H/);
    assert.match(v.out.textContent, /004321/);
    assert.equal(v.existentes(), undefined);
    assert.deepEqual(h.cliente.mutaciones, []);
});

test('sin identificador del registro o con actualización pendiente no se afirma conciliación', async () => {
    const h = caso(), r = await h.consultar(F.consulta), item = r.comparacion.pagosDetalle[0];
    const original = item.sistema.id; item.sistema.id = null;
    assert.equal(h.Q.modeloPresentacionComparacion(r).pagosExistentes.length, 0);
    item.sistema.id = original; item.actualizacionExistente = { cambios:['monto'], motivos:[] };
    const modelo = h.Q.modeloPresentacionComparacion(r);
    assert.equal(modelo.pagosExistentes.length, 0); assert.equal(modelo.pagosActualizar.length, 1);
    assert.deepEqual(h.cliente.mutaciones, []);
});

test('preparar conserva el pago existente como omitido, sin registrarlo otra vez', async () => {
    const h = caso(), r = await h.consultar(F.consulta);
    const plan = await h.Q.prepararIncorporacion(r, new Map(), new Set(), h.cliente);
    const item = plan.items.find(i => i.pagoLibro?.codigo_autorizacion === '004321');
    assert.ok(item); assert.equal(item.categoria, 'omitidos'); assert.equal(item.seleccionado, false);
    assert.deepEqual(h.cliente.mutaciones, []);
});

test('el pago sin registrar sigue siendo nuevo seguro y la nota administrativa no crea otro pago', async () => {
    const h = caso(); h.cliente.db.pagos.length = 0;
    const r = await h.consultar(F.consulta), modelo = h.Q.modeloPresentacionComparacion(r);
    assert.equal(r.comparacion.pagosDetalle.length, 1);
    assert.equal(modelo.pagosFaltan.length, 1); assert.equal(modelo.pagosExistentes?.length, 0);
    const v = vista(h.w); v.render(r); assert.equal(v.existentes(), undefined);
    assert.deepEqual(h.cliente.mutaciones, []);
});

for (const id of ['pago_diferente', 'pago_ambiguo', 'pago_conflictivo', 'pago_sin_asociacion']) {
    test(id+' no aparece como pago ya conciliado', async () => {
        const f = F.casos().find(x => x.id === id), w = F.web(f.data), cliente = F.cliente(f.db);
        const r = await w.HAIKU_LIBRO_CONSULTAS.consultar(F.consulta, w.HAIKU_LIBRO_RESERVA_V1, cliente);
        assert.equal(w.HAIKU_LIBRO_CONSULTAS.modeloPresentacionComparacion(r).pagosExistentes?.length, 0);
        assert.ok(r.comparacion.pagosDetalle.every(x => ['revisar','diferente'].includes(x.estado)));
        assert.deepEqual(cliente.mutaciones, []);
    });
}
