const test = require('node:test'), assert = require('node:assert/strict');
const { entorno, consulta } = require('./fixtures/libro-servicio-manual.cjs');
const boton = (out, texto) => out.querySelectorAll('button').find(b => b.textContent === texto);
async function caso(directa = true, texto = '1 HORA TINAJA CORTESIA A LAS 22:00 // DEJAR BATAS') {
    const e = entorno(); e.guard();
    const r = e.state.reservas[0]; r.texto_original = texto;
    r.servicios = e.c.HAIKU_LIBRO_SEMANTICA.servicios(texto, { origen_campo: 'notas_reserva' });
    const out = new e.Element('div'); e.document.card = out;
    e.c.haikuSesion = { usuario: { activo: true }, roles: [{ codigo: 'administrador' }] };
    e.c.haikuTienePermiso = () => true;
    if (directa) await e.api.abrirRevisionHistorial(out, { reservas: [r], generacion: 1, aprobacionManual: true });
    else {
        await e.api.renderizar(await e.construir(), out, consulta);
        await boton(out, 'Aprobación manual').listeners.click();
    }
    const panel = out.querySelector('.haku-servicio-compacto');
    const elegir = (clave, valor) => {
        const campo = panel.querySelectorAll('input,select').find(x => x.dataset.campoManual === clave);
        campo.value = valor; campo.listeners.change();
    };
    e.c.confirm = () => { throw Error('No debe pedir otro clic de confirmación'); };
    return { ...e, r, out, panel, elegir, confirmar: () => boton(panel, 'Confirmar servicio').listeners.click() };
}

for (const directa of [false, true]) for (const codigo of ['tinajaTonel', 'tinajaJacuzzi'])
test(`${directa ? 'informe' : 'consulta'}: elegir ${codigo} y confirmar registra sólo esa tinaja`, async () => {
    const e = await caso(directa);
    assert.equal(boton(e.panel, 'Confirmar servicio').disabled, true, 'no elige el tipo por el usuario');
    e.elegir('codigo_servicio', codigo);
    assert.equal(e.state.escrituras.length, 0, 'elegir no guarda');
    assert.match(e.panel.textContent, /22:00–23:00/);
    assert.match(e.panel.textContent, /sin cobro/);
    assert.equal(boton(e.panel, 'Revisar datos'), undefined);
    await Promise.all([e.confirmar(), e.confirmar()]);
    assert.equal(e.state.escrituras.length, 1);
    const p = e.state.escrituras[0]; assert.equal(p.p_servicios.length, 1); assert.equal(p.p_notas.length, 0);
    assert.equal(p.p_servicios[0].codigo_servicio, codigo);
    assert.equal(p.p_servicios[0].servicio_manual_v1.resuelto.total, 0);
    assert.match(e.out.textContent, /Incorporación completada/);
});

test('el importe cobrable mostrado es el que se confirma, sin cambios silenciosos de catálogo', async () => {
    const e = await caso(true, '1 HORA TINAJA A LAS 22:00 X PAGAR');
    e.elegir('codigo_servicio', 'tinajaTonel');
    assert.match(e.panel.textContent, /Se agregará un cargo de \$30\.000/);
    e.state.db.catalogo_servicios.find(x => x.codigo === 'tinajaTonel').precio_base = 40000;
    await e.confirmar(); assert.equal(e.state.escrituras.length, 0);
    assert.match(e.panel.textContent, /importe cambiaron/);
});

test('cancelar después de elegir nunca registra ni abre otro paso', async () => {
    const e = await caso(); e.elegir('codigo_servicio', 'tinajaTonel');
    await boton(e.panel, 'Cancelar').listeners.click();
    assert.equal(e.state.escrituras.length, 0); assert.equal(e.out.querySelector('.haku-servicio-compacto'), null);
});

test('un duplicado surgido durante la comprobación final impide el alta', async () => {
    const e = await caso(); e.elegir('codigo_servicio', 'tinajaTonel');
    const api = e.c.HAIKU_LIBRO_SERVICIOS_SCOPE_V2, s = e.state.db.reserva_estadias[0];
    e.c.HAIKU_LIBRO_SERVICIOS_SCOPE_V2 = { ...api, revalidarVista: async (...args) => {
        e.state.db.servicios.push({ id: 'ya-creado', reserva_id: s.reserva_id, estadia_id: s.id,
            fecha_servicio: e.r.fecha_checkin, hora_inicio: '22:00', hora_fin: '23:00', cantidad: 1, personas: 2,
            tipo_cobro: 'cortesia', total: 0, estado_servicio: 'programado', catalogo_servicios: { codigo: 'tinajaTonel' } });
        return api.revalidarVista(...args);
    } };
    await e.confirmar(); assert.equal(e.state.escrituras.length, 0);
    assert.match(e.panel.textContent, /ya está registrado/);
});

test('una respuesta sin éxito conserva datos y nunca muestra incorporación completada', async () => {
    const e = await caso(); e.elegir('codigo_servicio', 'tinajaTonel');
    const rpc = e.c.haikuSupabase.rpc;
    e.c.haikuSupabase.rpc = async (nombre, args) => nombre === 'haiku_importar_libro_operaciones_v2'
        ? { data: { ok: false } } : rpc(nombre, args);
    await e.confirmar();
    assert.match(e.panel.textContent, /no confirmó la incorporación/);
    assert.doesNotMatch(e.out.textContent, /Incorporación completada/);
    assert.equal(e.panel.querySelector('select').value, 'tinajaTonel');
});

test('la confirmación requiere resolver una estadía única, incluso al guardar directamente', async () => {
    const e = await caso(); e.elegir('codigo_servicio', 'tinajaTonel');
    const api = e.c.HAIKU_LIBRO_SERVICIOS_SCOPE_V2;
    e.c.HAIKU_LIBRO_SERVICIOS_SCOPE_V2 = { ...api, revalidarVista: async (...args) => {
        const plan = await api.revalidarVista(...args);
        e.state.db.reserva_estadias.push({ ...e.state.db.reserva_estadias[0], id: 'otra-estadia' });
        return plan;
    } };
    await e.confirmar(); assert.equal(e.state.escrituras.length, 0);
    assert.match(e.panel.textContent, /estadía única/);
});
