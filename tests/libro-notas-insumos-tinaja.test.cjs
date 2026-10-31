const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/haiku-libro-semantica-v1.js');
const { entorno } = require('./fixtures/libro-servicio-manual.cjs');

const TINAJA = 'TONEL 31-10-26 20:45 X PAGAR';
const NOTAS = 'se le hace entrrega de carbon// utensilios de asado';
const textoReserva = (notas = NOTAS, servicio = TINAJA) =>
    'Persona Ejemplo // contacto@example.test // 2 adl + 1 niña de 3 años // ' +
    'NO colocar cama adicional // JD // 31-10-2026// ' + servicio + '// ' + notas;

function hoja(texto) {
    return {
        celdas: [
            { r: 1, c: 118, valor: '30 oct', fechaISO: '2026-10-30' },
            { r: 1, c: 122, valor: '31 oct', fechaISO: '2026-10-31' },
            { r: 4, c: 0, valor: 'cabaña 3' },
            { r: 4, c: 122, valor: texto },
            { r: 24, c: 122, valor: 'Pagos de arriendos de hoy' }
        ],
        combinaciones: [{ s: { r: 4, c: 122 }, e: { r: 4, c: 124 } }]
    };
}
const leer = texto => S.normalizarHoja(hoja(texto), 'Oct26');

test('CAB 3: carbón y utensilios conservan la reserva y el Tonel de las 20:45 por pagar', () => {
    const texto = textoReserva(), original = hoja(texto), copia = structuredClone(original);
    const resultado = S.normalizarHoja(original, 'Oct26');
    assert.equal(resultado.reservas.length, 1);
    const r = resultado.reservas[0];
    assert.equal(r.id, 'Oct26!DS5');
    assert.equal(r.titular, 'Persona Ejemplo');
    assert.equal(r.cabana, 3);
    assert.equal(r.fecha_checkin, '2026-10-31');
    assert.equal(r.fecha_checkout, '2026-11-01');
    assert.equal(r.adultos, 2);
    assert.equal(r.noches, 1);
    assert.equal(r.texto_original, texto);
    assert.deepEqual(r.advertencias, []);
    assert.equal(r.servicios.length, 1);
    const s = r.servicios[0];
    assert.equal(s.concepto, 'tonel');
    assert.equal(s.texto_original, TINAJA);
    assert.equal(s.hora, '20:45');
    assert.equal(s.cantidad, 1);
    assert.equal(s.intencion_cobro, 'cobrable');
    assert.equal(s.cortesia, false);
    assert.equal(r.pagos.length, 0);
    assert.deepEqual(original, copia);
});

for (const nota of [
    'se le hace entrrega de carbon', 'se le hace entrega de carbón',
    'se les hace entrega de carbón', 'se hace entrega de leña',
    'entrega de carbón', 'UTENSILIOS DE ASADO', 'utensilios para asado'
]) test('la nota de insumos no compite con un huésped: ' + nota, () => {
    for (const texto of [
        'Persona Ejemplo // ' + nota + ' // 2 ADL',
        nota + ' // Persona Ejemplo // 2 ADL'
    ]) {
        const r = leer(texto).reservas;
        assert.equal(r.length, 1, texto);
        assert.equal(r[0].titular, 'Persona Ejemplo');
        assert.equal(r[0].texto_original, texto);
    }
    assert.equal(leer(nota).reservas.length, 0);
});

test('las notas no resuelven dos nombres humanos ni excluyen apellidos parecidos a objetos', () => {
    for (const texto of [
        textoReserva() + ' // Juan Soto',
        'Juan Soto // ' + textoReserva()
    ]) {
        const r = leer(texto);
        assert.equal(r.reservas.length, 0);
        assert.match(r.advertencias.join(' '), /varios posibles titulares/);
    }
    for (const nombre of ['Juan Carbón', 'Ana Entrega', 'Juan Utensilios']) {
        assert.equal(leer(nombre + ' // ' + NOTAS).reservas[0]?.titular, nombre);
    }
});

test('la comparación prepara una sola tinaja para la estadía existente sin escribir finanzas', async () => {
    const r = leer(textoReserva()).reservas[0];
    assert.ok(r, 'la fila debe llegar al comparador de servicios');
    const e = entorno(), db = e.state.db;
    e.state.reservas = [r];
    db.reservas = [{ ...db.reservas[0], titular_nombre: r.titular }];
    db.reserva_estadias = [{
        ...db.reserva_estadias[0], fecha_ingreso: r.fecha_checkin,
        fecha_salida: r.fecha_checkout, tipo_estadia: r.tipo_estadia
    }];
    db.cabanas = [{ ...db.cabanas[0], numero: 3 }];
    const antes = JSON.stringify(db), libroAntes = JSON.stringify(r);
    const plan = await e.construir();
    const servicios = plan.items.filter(i => i.kind === 'servicio');
    assert.equal(servicios.length, 1);
    const i = servicios[0];
    assert.equal(i.estado, 'listo');
    assert.deepEqual(Array.from(i.razones), []);
    assert.equal(i.payload.reserva_id, db.reservas[0].id);
    assert.equal(i.payload.estadia_id, db.reserva_estadias[0].id);
    assert.equal(i.payload.codigo_servicio, 'tinajaTonel');
    assert.equal(i.payload.fecha_servicio, '2026-10-31');
    assert.equal(i.payload.hora, '20:45');
    assert.equal(i.payload.cantidad, 1);
    assert.equal(i.payload.tipo_cobro, 'normal');
    assert.equal(i.payload.precio_manual, null);
    assert.equal(JSON.stringify(db), antes);
    assert.equal(JSON.stringify(r), libroAntes);
    assert.equal(e.state.escrituras.length, 0);
});
