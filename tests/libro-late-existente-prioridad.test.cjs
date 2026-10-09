const test = require('node:test');
const assert = require('node:assert/strict');
const { entorno, consulta } = require('./fixtures/libro-servicio-manual.cjs');

const textoJaviera = 'X PAGAR LATE OUT CLP$10,000 1 HORA';
function caso(texto = textoJaviera, cambios = {}, sinExistente = false) {
    const e = entorno(), r = e.state.reservas[0], estadia = e.state.db.reserva_estadias[0];
    Object.assign(r, { fecha_checkin: '2026-10-03', fecha_checkout: '2026-10-04', texto_original: texto,
        servicios: e.c.HAIKU_LIBRO_SEMANTICA.servicios(texto, { origen_campo: 'notas_reserva' }) });
    e.state.reservas.splice(1);
    Object.assign(estadia, { fecha_ingreso: r.fecha_checkin, fecha_salida: r.fecha_checkout });
    const existente = { id: 'late-javiera', reserva_id: estadia.reserva_id, estadia_id: estadia.id,
        fecha_servicio: '2026-10-04', hora_inicio: '13:00:00', hora_fin: '14:00:00', cantidad: 1,
        total: 10000, tipo_cobro: 'normal', estado_servicio: 'programado', personas: 0,
        catalogo_servicios: { codigo: 'lateCheckout', nombre: 'Late Check-out' }, ...cambios };
    if (!sinExistente) e.state.db.servicios.push(existente);
    return { ...e, existente };
}
const late = resultado => resultado.items.find(i => i.mapa?.codigo === 'lateCheckout');
function esExistente(item) {
    assert.equal(item.estado, 'existente');
    assert.equal(item.identidad, 'YA_EXISTE');
    assert.equal(item.payload, null);
    assert.equal(item.razones.length, 0);
    assert.equal(item.resolucionManual, undefined);
    assert.equal(item.hora, '13:00');
    assert.equal(item.hora_fin, '14:00');
}
function esRevision(item, motivo) {
    assert.equal(item.estado, 'revisar');
    assert.equal(item.identidad, 'IDENTIDAD_AMBIGUA');
    assert.equal(item.payload, null);
    assert.match(item.razones.join(' '), motivo);
}

test('A / Javiera: sin hora, Late único compatible va a Ya existen sin aprobación ni escrituras', async () => {
    const e = caso(), antes = JSON.stringify({ db: e.state.db, libro: e.state.reservas });
    const resultado = await e.construir(), item = late(resultado);
    esExistente(item);
    assert.equal(item.proveniencia.hora_inicio, 'AUSENTE');
    const out = new e.Element('div');
    e.api.renderizar(resultado, out, consulta);
    const seccion = out.querySelectorAll('details').find(el => el.textContent.includes('Ya existen en Proyecto H'));
    assert.ok(seccion?.textContent.includes(textoJaviera));
    assert.ok(!out.textContent.includes('Aprobación manual'));
    assert.equal(out.querySelectorAll('input').filter(el => el.dataset.campoManual === 'hora').length, 0);
    assert.equal(out.querySelectorAll('input:not(:disabled)').length, 0);
    assert.equal(resultado.items.filter(i => i.estado === 'revisar').length, 0);
    assert.equal(resultado.items.filter(i => i.payload).length, 0);
    assert.equal(e.manuales.size, 0);
    assert.equal(e.state.escrituras.length, 0);
    assert.equal(JSON.stringify({ db: e.state.db, libro: e.state.reservas }), antes);
    esExistente(late(await e.construir()));
});

test('B: hora explícita 13:00 compatible sigue siendo existente', async () => {
    esExistente(late(await caso(`${textoJaviera} 13:00`).construir()));
});

test('C: hora explícita 12:00 contradice 13:00 y nunca permite crear otro Late', async () => {
    const e = caso(`${textoJaviera} 12:00`);
    esRevision(late(await e.construir()), /horario/);
    esRevision(late(await e.resolver(0, { hora: '12:00' })), /contradice/);
    assert.equal(e.state.escrituras.length, 0);
    assert.equal(e.state.db.servicios.length, 1);
});

test('D: dos Late activos bloquean, aunque sólo uno coincida o tenga la marca de origen', async () => {
    for (const hora of ['', ' 13:00']) {
        const e = caso(textoJaviera + hora);
        const itemId = late(await e.construir()).item_id;
        e.existente.observaciones = `[HAKU-LIBRO-SERVICIO:${itemId}]`;
        e.state.db.servicios.push({ ...e.existente, id: 'otro-late', hora_inicio: '15:00', hora_fin: '16:00', total: 20000, observaciones: '' });
        esRevision(late(await e.construir()), /varios|más de un/);
    }
});

test('E: total, cobro, fecha, cantidad o duración contradictorios requieren revisión', async () => {
    for (const [cambio, motivo] of [
        [{ total: 12000 }, /monto/], [{ tipo_cobro: 'cortesia', total: 0 }, /tipo de cobro/],
        [{ fecha_servicio: '2026-10-03' }, /fecha/], [{ cantidad: 2 }, /cantidad/],
        [{ hora_fin: '15:00' }, /duración/]
    ]) esRevision(late(await caso(textoJaviera, cambio).construir()), motivo);
});

test('F: sin existente se exige hora antes de poder crear', async () => {
    const e = caso(textoJaviera, {}, true), item = late(await e.construir());
    assert.equal(item.estado, 'revisar');
    assert.equal(item.identidad, 'NO_EXISTE');
    assert.equal(item.payload, null);
    assert.match(item.razones.join(' '), /Falta un horario/);
    const out = new e.Element('div'); e.api.renderizar(await e.construir(), out, consulta);
    assert.ok(out.textContent.includes('Aprobación manual'));
    const confirmado = late(await e.resolver(0, { hora: '13:00' }));
    assert.equal(confirmado.estado, 'listo');
    assert.equal(confirmado.payload.hora, '13:00');
    assert.equal(confirmado.payload.servicio_manual_v1.resuelto.hora_fin, '14:00');
    assert.equal(e.state.escrituras.length, 0);
});

test('G: un repetible sin hora muestra un candidato y nunca crea automáticamente', async () => {
    for (const [texto, codigo] of [['X PAGAR TINAJA TONEL 1 HORA', 'tinajaTonel'], ['X PAGAR MASAJE TERAPEUTICO 60 MINUTOS', 'masajeTerapeutico60']]) {
        const e = caso(texto, { catalogo_servicios: { codigo, nombre: codigo } });
        const item = (await e.construir()).items.find(i => i.kind === 'servicio');
        assert.equal(item.estado, 'revisar');
        assert.equal(item.payload, null);
        assert.equal(item.reconciliacion_estado, 'CANDIDATO_EXISTENTE');
        assert.equal(item.candidatos_existentes.length, 1);
        assert.match(item.razones.join(' '), /falta evidencia/);
    }
});

test('horas y monto del texto se comparan aunque el parser traiga cantidad por defecto y monto null', async () => {
    const e = caso('X PAGAR LATE OUT CLP$20,000 2 HORAS', { cantidad: 2, total: 20000, hora_inicio: '12:00' });
    const item = late(await e.construir());
    assert.equal(item.estado, 'existente');
    assert.equal(item.servicio.cantidad, 1);
    assert.equal(item.servicio.monto, null);
    esRevision(late(await caso('X PAGAR LATE OUT CLP$20,000 2 HORAS').construir()), /cantidad|monto/);
});

test('datos no declarados no contradicen valores existentes ni precios actuales del catálogo', async () => {
    const e = caso('X PAGAR LATE OUT', { cantidad: 2, hora_inicio: '13:00', hora_fin: '15:00', total: 19000 });
    e.state.db.catalogo_servicios.find(c => c.codigo === 'lateCheckout').precio_base = 11000;
    const item = late(await e.construir());
    assert.equal(item.estado, 'existente');
    assert.equal(item.payload, null);
    assert.equal(item.servicio_existente.total, 19000);
});

test('sólo la estadía inequívoca participa; un Late sin estadía requiere revisión', async () => {
    esRevision(late(await caso(textoJaviera, { estadia_id: null }).construir()), /estadía/);
    for (const campo of ['estadia_id', 'reserva_id']) {
        const item = late(await caso(textoJaviera, { [campo]: 'otra-identidad' }).construir());
        assert.equal(item.identidad, 'NO_EXISTE');
        assert.equal(item.payload, null);
    }
});

test('Late cancelados, anulados o no_show no compiten con el único activo', async () => {
    const e = caso();
    for (const estado of ['cancelado', 'anulado', 'no_show']) e.state.db.servicios.push({ ...e.existente, id: estado, estado_servicio: estado });
    esExistente(late(await e.construir()));
});

test('una marca de origen no permite ignorar una contradicción de monto', async () => {
    const e = caso(textoJaviera, { total: 20000 });
    e.existente.observaciones = `[HAKU-LIBRO-SERVICIO:${late(await e.construir()).item_id}]`;
    esRevision(late(await e.construir()), /monto/);
});

test('rangos explícitos y hasta se comparan como inicio/término, sin confundir duración con reloj', async () => {
    for (const horario of [' DE 13:00 A 14:00', ' HASTA LAS 14:00']) esExistente(late(await caso(textoJaviera + horario).construir()));
    for (const horario of [' DE 13:00 A 15:00', ' HASTA LAS 15:00']) esRevision(late(await caso(textoJaviera + horario).construir()), /horario/);
    esRevision(late(await caso(`${textoJaviera} 13:00`, { hora_inicio: '13:00:01' }).construir()), /horario|duración/);
});

test('fecha explícita compatible no pide hora; una fecha contradictoria no se descarta', async () => {
    for (const fecha of ['04/10', '04.10', '04/10/2026']) esExistente(late(await caso(`${textoJaviera} ${fecha}`).construir()));
    esRevision(late(await caso(`${textoJaviera} 03/10/2026`).construir()), /fecha/);
});

test('un importe declarado ambiguo o inválido nunca se trata como ausente', async () => {
    for (const texto of ['X PAGAR LATE OUT CLP$10,00 1 HORA', `${textoJaviera} CLP$20,000`, 'X PAGAR LATE OUT USD$10 1 HORA'])
        esRevision(late(await caso(texto).construir()), /importe|monto/);
    const e = caso('X PAGAR LATE OUT CLP$20,000 1 HORA');
    e.state.reservas[0].servicios[0].monto = 10000;
    esRevision(late(await e.construir()), /importe/);
});

test('una decisión manual de precio explícita conserva su contrato al comparar el existente', async () => {
    const e = caso('X PAGAR LATE OUT CLP$12,000 1 HORA');
    esRevision(late(await e.construir()), /monto/);
    const confirmado = late(await e.resolver(0, { hora: '13:00', precio_decision: 'catalogo' }));
    assert.equal(confirmado.estado, 'existente');
    assert.equal(confirmado.precio.total, 10000);
    assert.equal(confirmado.payload, null);
    assert.equal(e.state.escrituras.length, 0);
});

test('revalidar reconoce existentes nuevos y rechaza la aprobación manual que quedó abierta', async () => {
    const e = caso(textoJaviera, {}, true), base = late(await e.construir());
    e.state.db.servicios.push(e.existente);
    await assert.rejects(e.api.confirmarServicioManual(consulta, base.item_id, { hora: '12:00' }, e.manuales, base.firmaManual), /vuelve a abrir/);
    assert.equal(e.manuales.size, 0);
    esExistente(late(await e.construir()));
    e.state.db.servicios.length = 0;
    const sinExistente = late(await e.construir());
    assert.equal(sinExistente.identidad, 'NO_EXISTE');
    assert.equal(sinExistente.estado, 'revisar');
    assert.equal(sinExistente.hora, null);
    assert.equal(e.state.escrituras.length, 0);
});
