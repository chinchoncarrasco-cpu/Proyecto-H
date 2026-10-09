const test = require('node:test'), assert = require('node:assert/strict');
const I = require('../js/haiku-servicios-identidad-v1.js');
const { F, esperados, entornoReal, copy } = require('./fixtures/libro-reconciliacion-real.cjs');
const consulta = 'Libro: compara servicios de octubre 2026 con Proyecto H';
// El alias puede cambiar el orden visual por titular; comparar los mismos 21 IDs.
const servicios = r => r.items.filter(i => i.kind === 'servicio').sort((a, b) =>
    F.antes.findIndex(x => x.item_id === a.item_id) - F.antes.findIndex(x => x.item_id === b.item_id));
const joseph = r => servicios(r).find(i => i.item_id === F.antes[12].item_id);

for (const [n, antes] of F.antes.entries()) test(`Octubre real ${n + 1}: ${antes.titular} / ${antes.celda} → ${esperados[n]}`, async () => {
    const e = entornoReal(), r = await e.construir(), item = servicios(r).find(i => i.item_id === antes.item_id);
    assert.ok(item, antes.item_id); assert.equal(servicios(r).length, 21);
    assert.equal(item.servicio.texto_original, antes.texto);
    assert.equal(item.reconciliacion_estado, esperados[n], item.razones.join(' '));
    if (item.reconciliacion_estado !== 'SIN_EXISTENTE') assert.equal(item.payload, null);
    assert.equal(Boolean(item.payload), [10, 20].includes(n + 1));
    assert.equal(e.state.escrituras.length, 0); assert.equal(e.state.rpcs.length, 0);
});
test('Joseph: vínculo explícito, sólo SELECT; H y sus cargos permanecen intactos', async () => {
    const e = entornoReal(), item = joseph(await e.construir()), db = JSON.stringify(e.state.db);
    assert.equal(item.fecha, null); assert.equal(item.hora, null);
    assert.equal(item.candidatos_existentes[0].fecha_servicio, '2026-10-04');
    assert.equal(item.candidatos_existentes[0].hora_inicio, '13:30:00');
    const vinculado = joseph(await e.vincular(item));
    assert.equal(vinculado.reconciliacion_estado, 'EXISTENTE_SEGURO'); assert.equal(vinculado.payload, null);
    assert.equal(vinculado.fecha, '2026-10-04'); assert.equal(vinculado.hora, '13:30');
    assert.equal(JSON.stringify(e.state.db), db); assert.equal(e.state.rpcs.length, 0);
    assert.equal(joseph(await e.construir()).payload, null);
    e.vinculos.clear(); assert.equal(joseph(await e.construir()).reconciliacion_estado, 'CANDIDATO_EXISTENTE');
});
test('vínculo obsoleto: todos los campos y dependencias declarados invalidan permanentemente', async () => {
    const cambios = [
        e => { e.state.db.servicios.find(s => s.id === F.db.servicios.find(s => s.catalogo_servicios.codigo === 'masajeTerapeutico30').id).total++; },
        e => { e.state.db.catalogo_servicios.find(c => c.codigo === 'masajeTerapeutico30').precio_base++; },
        e => { e.state.db.servicios.find(s => s.id === josephId).estado_servicio = 'cancelado'; },
        e => { e.state.db.servicios.find(s => s.id === josephId).hora_inicio = '14:30:00'; },
        e => { e.state.db.servicios.find(s => s.id === josephId).cantidad = 2; },
        e => { e.state.db.reservas.find(s => s.id === josephReserva).estado_reserva = 'cancelada'; },
        e => { e.state.db.reserva_estadias.find(s => s.reserva_id === josephReserva).fecha_salida = '2026-10-05'; },
        e => { e.state.usuario = 'otro-usuario'; },
        e => { e.state.generacion++; }
    ];
    for (const cambiar of cambios) {
        const e = entornoReal(); await e.vincular(joseph(await e.construir())); cambiar(e);
        const nuevo = joseph(await e.construir()); assert.equal(nuevo.reconciliacion_estado, 'CONFLICTO'); assert.equal(nuevo.payload, null);
        assert.equal([...e.vinculos.values()][0].invalidada, true); assert.equal(e.state.rpcs.length, 0);
        Object.assign(e.state.db, copy(F.db)); e.state.usuario = '00000000-0000-4000-8000-000000000099'; e.state.generacion = 1;
        assert.equal(joseph(await e.construir()).reconciliacion_estado, 'CONFLICTO');
    }
});
const josephId = '00000000-0000-4000-9000-000000000149', josephReserva = '00000000-0000-4000-9000-000000000123';
test('cambio entre presentar candidato y confirmar rechaza la firma, incluso sin contradicción textual', async () => {
    const e = entornoReal(), item = joseph(await e.construir());
    e.state.db.servicios.find(s => s.id === josephId).hora_inicio = '14:30:00';
    await assert.rejects(e.vincular(item), /cambiaron/); assert.equal(e.vinculos.size, 0); assert.equal(e.state.rpcs.length, 0);
});
test('error SELECT jamás significa SIN_EXISTENTE', async () => {
    const e = entornoReal(); e.state.errorTabla = 'servicios'; await assert.rejects(e.construir(), /SELECT falló/);
    assert.equal(e.state.rpcs.length, 0); assert.equal(e.state.escrituras.length, 0);
});

test('error SELECT de notas aborta la comparación; recuperar la lectura conserva los resultados reales', async () => {
    const e = entornoReal(), db = JSON.stringify(e.state.db); e.state.errorTabla = 'notas';
    await assert.rejects(e.construir(), error => {
        assert.match(error.message, /No pude consultar las notas de Proyecto H.*Reintenta/);
        assert.equal(error.cause.message, 'SELECT falló'); return true;
    });
    assert.ok(e.state.lecturas.some(l => l.tabla === 'notas'));
    assert.equal(e.state.rpcs.length, 0); assert.equal(e.state.escrituras.length, 0);
    e.state.errorTabla = null;
    const actual = await e.construir(), notas = actual.items.filter(i => i.kind === 'nota');
    assert.equal(notas.filter(i => i.estado === 'listo').length, 1);
    assert.equal(notas.filter(i => i.estado === 'existente').length, 16);
    assert.deepEqual(copy(servicios(actual).map(i => i.reconciliacion_estado)), esperados);
    assert.deepEqual(copy(servicios(actual).filter(i => i.payload).map(i => i.item_id)), [F.antes[9].item_id, F.antes[19].item_id]);
    assert.equal(JSON.stringify(e.state.db), db);
});

test('SELECT de notas exitoso sin registros es una lista vacía válida', async () => {
    const e = entornoReal(); e.state.db.notas = [];
    const actual = await e.construir(), notas = actual.items.filter(i => i.kind === 'nota');
    assert.ok(e.state.lecturas.some(l => l.tabla === 'notas'));
    assert.equal(notas.filter(i => i.estado === 'listo').length, 17);
    assert.equal(notas.filter(i => i.estado === 'existente').length, 0);
    assert.deepEqual(copy(servicios(actual).map(i => i.reconciliacion_estado)), esperados);
    assert.equal(e.state.db.notas.length, 0); assert.equal(e.state.rpcs.length, 0); assert.equal(e.state.escrituras.length, 0);
});

test('error de notas al revalidar impide incorporar la selección previa; reintentar vuelve a consultar', async () => {
    const e = entornoReal(), actual = await e.construir(), out = new e.Element('div'), db = JSON.stringify(e.state.db);
    e.document.card = out; e.api.renderizar(actual, out, consulta);
    const boton = out.querySelectorAll('button').find(b => b.dataset.hakuAccion === 'incorporar');
    const seleccionados = () => out.querySelectorAll('input[type=checkbox]:checked:not(:disabled)').map(i => i.dataset.hakuItemId);
    const previos = seleccionados(); assert.equal(previos.length, 3);
    let confirmaciones = 0; e.c.confirm = () => { confirmaciones++; return false; };
    e.state.errorTabla = 'notas';
    for (let intento = 0; intento < 2; intento++) {
        await assert.rejects(e.api.revalidarVista(out, consulta), /No pude consultar las notas de Proyecto H/);
        await boton.listeners.click();
        assert.match(out.textContent, /No pude consultar las notas de Proyecto H.*Reintenta/);
        assert.equal(confirmaciones, 0); assert.equal(e.state.rpcs.length, 0); assert.equal(e.state.escrituras.length, 0);
        assert.equal(boton.disabled, false); assert.deepEqual(seleccionados(), previos);
    }
    const lecturas = e.state.lecturas.filter(l => l.tabla === 'notas').length;
    e.state.errorTabla = null; await boton.listeners.click(); // Revalidación correcta; cancelar la confirmación, sin escribir.
    assert.equal(e.state.lecturas.filter(l => l.tabla === 'notas').length, lecturas + 1);
    assert.equal(confirmaciones, 1); assert.equal(e.state.rpcs.length, 0); assert.equal(e.state.escrituras.length, 0);
    assert.equal(JSON.stringify(e.state.db), db); assert.deepEqual(seleccionados(), previos);
});
test('dos glosas independientes de Joseph no pueden vincular el mismo masaje', async () => {
    const e = entornoReal(), r = e.state.normalizada.reservas.find(r => r.coordenadas_origen.celda === 'K9');
    r.servicios.push(...e.c.HAIKU_LIBRO_SEMANTICA.servicios('X PAGAR 1 MASAJE RELAJANTE 30MIN CON MONICA', { origen_campo: 'notas_reserva' }));
    const resultado = await e.construir(), items = servicios(resultado).filter(i => i.reserva === r || i.reserva.coordenadas_origen.celda === 'K9').filter(i => i.servicio.concepto === 'masaje');
    assert.equal(items.length, 2); assert.ok(items.every(i => i.reconciliacion_estado === 'CONFLICTO' && i.payload === null));
    assert.ok(items.every(i => /Dos prestaciones independientes/.test(i.razones.join(' '))));
});
test('Tinaja/Late: dos fechas explícitas nunca se ocultan por un origen estable; reloj bare no es fecha', async () => {
    const { entorno } = require('./fixtures/libro-servicio-manual.cjs');
    for (const texto of ['X PAGAR TINAJA TONEL EL 10/10 Y EL 11/10 A LAS 19:15', 'X PAGAR LATE OUT EL 10.10.26 Y EL 11.10.26']) {
        const e = entorno(), r = e.state.reservas[0]; r.servicios = e.c.HAIKU_LIBRO_SEMANTICA.servicios(texto, { origen_campo: 'notas_reserva' });
        assert.equal((await e.construir()).items.find(i => i.kind === 'servicio').reconciliacion_estado, 'CONFLICTO');
    }
    const e = entorno(), r = e.state.reservas[0]; r.servicios = e.c.HAIKU_LIBRO_SEMANTICA.servicios('X PAGAR TINAJA TONEL 19.15', { origen_campo: 'notas_reserva' });
    assert.equal((await e.construir()).items.find(i => i.kind === 'servicio').estado, 'listo');
});
test('notas y cortesía se preservan; amarillo no modifica el existente ni el catálogo', async () => {
    const e = entornoReal(), antes = JSON.stringify(e.state.db), r = await e.construir();
    assert.equal(r.items.filter(i => i.kind === 'nota').length, 21);
    assert.equal(r.items.filter(i => i.kind === 'nota' && i.estado === 'listo').length, 1);
    assert.equal(r.items.filter(i => i.kind === 'nota' && i.estado === 'existente').length, 16);
    const cortesia = servicios(r).find(i => i.item_id === F.antes[6].item_id);
    assert.equal(cortesia.cortesia, true); assert.equal(cortesia.servicio_existente.total, 0);
    assert.equal(servicios(r).find(i => i.item_id === F.antes[9].item_id).payload.tipo_cobro, 'normal');
    assert.equal(JSON.stringify(e.state.db), antes);
});

const evidencia = extra => ({ itemId: 'fuente1', reservaId: 'r1', estadiaId: 'e1', ingreso: '2026-10-03', salida: '2026-10-05',
    codigos: ['masajeTerapeutico30'], familia: 'masaje', fecha: '2026-10-04', fechaExplicita: true, inicio: '13:30',
    cantidad: 1, duracion: 30, tipoCobro: 'normal', monto: 35000, catalogoDemostrado: true, bloqueos: [], ...extra });
const existente = extra => ({ id: 'h1', reserva_id: 'r1', estadia_id: 'e1', fecha_servicio: '2026-10-04', hora_inicio: '13:30:00',
    hora_fin: '14:00:00', cantidad: 1, total: 35000, tipo_cobro: 'normal', estado_servicio: 'programado', catalogo_servicios: { codigo: 'masajeTerapeutico30' }, ...extra });
for (const [campo, cambio] of Object.entries({ cantidad: { cantidad: 2 }, monto: { total: 36000 }, tipo_cobro: { tipo_cobro: 'cortesia', total: 0 },
    duracion: { hora_fin: '14:30:00' }, estadia: { estadia_id: null }, hora_inicio: { hora_inicio: '13:30:30' }, catalogo: { catalogo_servicios: { codigo: 'masajeDescontracturante30' } } }))
    test(`guardas: contradicción explícita ${campo} bloquea aun con marca estable`, () => {
        const d = I.reconciliarServicio(evidencia(), [existente({ observaciones: '[HAKU-LIBRO-SERVICIO:fuente1]', ...cambio })]);
        assert.equal(d.categoria, 'CONFLICTO'); assert.ok(d.contradicciones.includes(campo));
    });
test('dos masajes mismo horario: ninguno se consume automáticamente, incluso con origen único', () => {
    for (const marca of ['', '[HAKU-LIBRO-SERVICIO:fuente1]']) {
        const d = I.reconciliarServicio(evidencia(), [existente({ observaciones: marca }), existente({ id: 'h2' })]);
        assert.equal(d.categoria, 'CONFLICTO'); assert.equal(d.candidatos.length, 2);
    }
});
test('masajes distintos en horario/tipo permanecen prestaciones independientes', () => {
    const otros = [existente(), existente({ id: 'h2', hora_inicio: '15:00', hora_fin: '15:30' }),
        existente({ id: 'h3', catalogo_servicios: { codigo: 'masajeDescontracturante30' } })];
    const d = I.reconciliarServicio(evidencia(), otros); assert.equal(d.categoria, 'EXISTENTE_SEGURO'); assert.equal(d.candidato.id, 'h1');
    assert.equal(I.reconciliarServicio(evidencia({ inicio: '16:00' }), otros).categoria, 'SIN_EXISTENTE');
});
test('dos items independientes reclamando H bloquean ambos; misma evidencia duplicada no crea otra', () => {
    const d = I.reconciliarServicio(evidencia({ inicio: null, fecha: null, fechaExplicita: false }), [existente()]);
    const items = [{ item_id: 'a', firmaManual: 'a', reconciliacion: copy(d) }, { item_id: 'b', firmaManual: 'b', reconciliacion: copy(d) }];
    I.reconciliarAsignaciones(items); assert.ok(items.every(i => i.reconciliacion.categoria === 'CONFLICTO'));
    const mismas = [{ item_id: 'a', firmaManual: 'a', reconciliacion: copy(d) }, { item_id: 'a', firmaManual: 'a', reconciliacion: copy(d) }];
    I.reconciliarAsignaciones(mismas); assert.ok(mismas.every(i => i.reconciliacion.categoria === 'CANDIDATO_EXISTENTE'));
});
test('cancelado/no_show con origen no se reutiliza; fecha fuera de estadía no se oculta', () => {
    for (const cambio of [{ estado_servicio: 'cancelado' }, { estado_servicio: 'no_show' }, { fecha_servicio: '2026-06-11' }]) {
        const d = I.reconciliarServicio(evidencia(), [existente({ observaciones: '[HAKU-LIBRO-SERVICIO:fuente1]', ...cambio })]);
        assert.equal(d.categoria, 'CONFLICTO');
    }
});
