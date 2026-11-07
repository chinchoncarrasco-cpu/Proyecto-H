const test = require('node:test'), assert = require('node:assert/strict');
const { entorno, consulta } = require('./fixtures/libro-servicio-manual.cjs');

async function fechaPendiente(directa = false) {
    const e = entorno(), r = e.state.reservas[0]; e.guard();
    r.fecha_checkout = '2026-10-12'; r.noches = 2;
    e.state.db.reserva_estadias[0].fecha_salida = r.fecha_checkout;
    r.texto_original = '1 HORA TINAJA TONEL A LAS 17:15 X PAGAR';
    r.servicios = e.c.HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original, { origen_campo: 'notas_reserva' });
    const out = new e.Element('div'); e.document.card = out;
    if (directa) {
        e.c.haikuSesion = { usuario: { activo: true }, roles: [{ codigo: 'administrador' }] };
        e.c.haikuTienePermiso = () => true;
        await e.api.abrirRevisionHistorial(out, { reservas: [r], generacion: 1, aprobacionManual: true });
    } else {
        e.api.renderizar(await e.construir(), out, consulta);
        await out.querySelectorAll('button').find(b => b.textContent === 'Aprobación manual').listeners.click();
    }
    return { ...e, r, out, panel: () => out.querySelector('.haku-servicio-compacto') };
}
const boton = (panel, nombre) => panel.querySelectorAll('button').find(b => b.textContent === nombre);
const fecha = panel => panel.querySelectorAll('input').find(i => i.dataset.campoManual === 'fecha');

for (const directa of [false, true]) test(`misma ficha compacta desde ${directa ? 'el informe' : 'la consulta'}, sin perder datos ni escribir`, async () => {
    const e = await fechaPendiente(directa), panel = e.panel();
    assert.equal(panel.querySelector('h3').textContent, 'Tinaja Tonel');
    assert.equal(panel.querySelector('.haku-servicio-compacto__horario').textContent, '17:15–18:15');
    assert.equal(panel.querySelector('.haku-servicio-compacto__importe').textContent, '$30.000');
    assert.match(panel.querySelector('.haku-servicio-compacto__resumen').textContent, /1 hora · 2 personas/);
    assert.equal(panel.querySelectorAll('.haiku-manual-resumen').length, 0, 'sin caja de identidad anidada');
    assert.equal(panel.querySelector('details').open, undefined, 'evidencia plegada');
    assert.match(panel.querySelector('details').textContent, /1 HORA TINAJA TONEL A LAS 17:15 X PAGAR/);
    assert.match(fecha(panel).parentElement.textContent, /¿Qué día será\?/);
    assert.equal(fecha(panel).min, '2026-10-10'); assert.equal(fecha(panel).max, '2026-10-12');
    assert.equal(boton(panel, 'Confirmar servicio').disabled, true);
    await boton(panel, 'Cancelar').listeners.click();
    assert.equal(e.panel(), null); assert.equal(e.state.escrituras.length, 0);
});

test('la fecha elegida se confirma en la misma ficha y muestra el recibo', async () => {
    const e = await fechaPendiente(true);
    const campo = fecha(e.panel()); campo.value = '2026-10-11'; campo.listeners.change();
    e.c.confirm = () => { throw Error('No debe pedir otra confirmación'); };
    assert.equal(e.state.escrituras.length, 0);
    await boton(e.panel(), 'Confirmar servicio').listeners.click();
    assert.equal(e.state.escrituras.length, 1);
    assert.equal(e.state.escrituras[0].p_servicios[0].fecha_servicio, '2026-10-11');
    assert.equal(e.state.escrituras[0].p_notas.length, 0);
    assert.match(e.out.textContent, /Incorporación completada/);
    assert.equal(e.panel(), null);
});

test('un precio por elegir no se presenta como un cobro ya confirmado', async () => {
    const e = entorno(), r = e.state.reservas[0];
    r.servicios = r.servicios.filter(s => s.concepto === 'lateout');
    r.servicios[0].texto_original = 'X PAGAR LATE OUT CLP$10,000 2 HORAS';
    const out = new e.Element('div'); e.document.card = out;
    e.api.renderizar(await e.construir(), out, consulta);
    await out.querySelectorAll('button').find(b => b.textContent === 'Aprobación manual').listeners.click();
    const panel = out.querySelector('.haku-servicio-compacto');
    assert.equal(panel.querySelector('.haku-servicio-compacto__importe').textContent, 'Precio por definir');
    assert.ok(panel.querySelectorAll('select').some(i => i.dataset.campoManual === 'precio_decision'));
    assert.equal(e.state.escrituras.length, 0);
});

test('una fecha fuera de la estadía nunca habilita la incorporación final', async () => {
    const e = await fechaPendiente(true);
    const campo = fecha(e.panel()); campo.value = '2026-10-15'; campo.listeners.change();
    await boton(e.panel(), 'Confirmar servicio').listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(boton(e.out, 'Agregar servicio'), undefined);
    assert.match(e.out.textContent, /fuera de la estadía/);
    assert.equal(e.state.escrituras.length, 0);
});
