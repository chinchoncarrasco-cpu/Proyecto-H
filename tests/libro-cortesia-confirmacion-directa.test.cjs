const test = require('node:test'), assert = require('node:assert/strict');
const { entorno, consulta } = require('./fixtures/libro-servicio-manual.cjs');

function caso(texto = 'TÓNEL SÁB 31 A LAS 22.15 CORTESIA') {
    const e = entorno(), r = e.state.reservas[0], estadia = e.state.db.reserva_estadias[0];
    r.fecha_checkin = estadia.fecha_ingreso = '2026-10-31';
    r.fecha_checkout = estadia.fecha_salida = '2026-11-01';
    r.texto_original = texto;
    r.servicios = e.c.HAIKU_LIBRO_SEMANTICA.servicios(texto, { origen_campo: 'notas_reserva' });
    e.c.HAIKU_LIBRO_RESERVA_V1.listarHojas = () => ['Oct26', 'Nov26'];
    const consultar = e.c.HAIKU_LIBRO_RESERVA_V1.consultarHoja;
    e.c.HAIKU_LIBRO_RESERVA_V1.consultarHoja = hoja => hoja === 'Nov26' ? { reservas: [] } : consultar(hoja);
    const s = { id: 'tinaja-existente', reserva_id: estadia.reserva_id, estadia_id: estadia.id,
        fecha_servicio: '2026-10-31', hora_inicio: '22:15:00', hora_fin: '23:15:00',
        cantidad: 1, personas: 2, tipo_cobro: 'normal', total: 30000, estado_servicio: 'programado',
        catalogo_servicios: { codigo: 'tinajaTonel', nombre: 'Tinaja Tonel' } };
    e.state.db.servicios = [s];
    const llamadas = [], verificaciones = [];
    e.c.HAIKU_ASISTENTE_SERVICIOS_CORTESIA_V1 = {
        preparar: async () => ({ estado: 'propuesta', candidato: { ...s, catalogo: s.catalogo_servicios } }),
        confirmar: async (propuesta, motivo) => {
            llamadas.push({ propuesta, motivo }); s.tipo_cobro = 'cortesia'; s.total = 0;
            return { estado: 'realizado' };
        },
        verificarEstado: async () => { verificaciones.push(true); return { estado: 'incierto', mensaje: 'Comprobar resultado.' }; },
        renderizar: p => p.mensaje || ''
    };
    return { ...e, r, s, llamadas, verificaciones };
}
const primero = p => p.items.find(x => x.kind === 'servicio');
const boton = (el, nombre) => el.querySelectorAll('button').find(x => x.textContent === nombre);
async function abrir(e, directa) {
    const out = new e.Element('div'); e.document.card = out;
    if (directa) {
        e.c.haikuSesion = { usuario: { activo: true }, roles: [{ codigo: 'administrador' }] };
        e.c.haikuTienePermiso = () => true;
        await e.api.abrirRevisionHistorial(out, { reservas: [e.r], generacion: 1, aprobacionManual: true });
    } else {
        await e.api.renderizar(await e.construir(), out, consulta);
        await boton(out, 'Aprobación manual').listeners.click();
    }
    return { out, panel: out.querySelector('.haku-servicio-compacto') };
}

test('Libro sin término conserva el fin registrado y propone cambiar sólo el cobro', async () => {
    const e = caso(), i = primero(await e.construir());
    assert.equal(i.hora_fin, null, 'no inventa evidencia del Libro');
    assert.equal(i.cambioCortesiaExistente.fin, '23:15');
    assert.equal(i.cambioCortesiaExistente.servicioId, e.s.id);
    assert.equal(i.payload, null, 'nunca es un alta nueva');
    assert.equal(e.state.escrituras.length, 0);
    await assert.rejects(e.resolver(0, {}), /ya existe/);
    assert.equal(e.manuales.size, 0, 'no añade una resolución de alta con monto cero');
});

for (const directa of [false, true]) test(`desde ${directa ? 'el informe' : 'la consulta'} llega a confirmar sin revisar otra vez`, async () => {
    const e = caso(), { out, panel } = await abrir(e, directa);
    assert.ok(panel); assert.match(panel.textContent, /Cobro \$30\.000 → Cortesía \$0/);
    assert.match(panel.textContent, /22:15–23:15/);
    assert.equal(boton(panel, 'Revisar datos'), undefined);
    const confirmar = boton(panel, 'Confirmar cambio');
    assert.equal(confirmar.disabled, false); assert.equal(e.llamadas.length, 0);
    await Promise.all([confirmar.listeners.click(), confirmar.listeners.click()]);
    assert.equal(e.llamadas.length, 1, 'un solo cambio aun con doble clic');
    assert.match(e.llamadas[0].motivo, /Libro indica cortesía/);
    assert.equal(e.state.escrituras.length, 0, 'no llama al importador de servicios');
    assert.equal(e.s.hora_fin, '23:15:00'); assert.equal(e.state.db.servicios.length, 1);
    assert.match(out.textContent, /Cambio a cortesía guardado/);
});

test('otras duraciones explícitas, candidatos múltiples o término inválido no se aceptan', async () => {
    for (const texto of ['2 HORAS TINAJA TONEL 22:15 CORTESIA', 'TINAJA TONEL 22:15 POR 90 MINUTOS CORTESIA',
        'TINAJA TONEL 22:15 A 23:45 CORTESIA', 'MEDIA HORA TINAJA TONEL 22:15 CORTESIA']) {
        const e = caso(texto);
        assert.equal(primero(await e.construir()).cambioCortesiaExistente, null, texto);
    }
    for (const variante of ['multiples', 'sin_fin', 'fin_invalido', 'duracion', 'personas']) {
        const e = caso();
        if (variante === 'multiples') e.state.db.servicios.push({ ...e.s, id: 'otra' });
        if (variante === 'sin_fin') e.s.hora_fin = null;
        if (variante === 'fin_invalido') e.s.hora_fin = '25:15:00';
        if (variante === 'duracion') e.s.hora_fin = '23:45:00';
        if (variante === 'personas') e.s.personas = 3;
        assert.equal(primero(await e.construir()).cambioCortesiaExistente, null, variante);
    }
});

test('si el servicio o el Libro cambian antes de confirmar no se envía la escritura', async () => {
    for (const cambio of ['total', 'fin', 'libro']) {
        const e = caso(), { panel } = await abrir(e, false);
        if (cambio === 'total') e.s.total = 40000;
        if (cambio === 'fin') e.s.hora_fin = '23:30:00';
        if (cambio === 'libro') e.r.servicios[0].texto_original += ' MODIFICADO';
        await boton(panel, 'Confirmar cambio').listeners.click();
        assert.equal(e.llamadas.length, 0, cambio);
        assert.equal(e.verificaciones.length, 0, 'no consulta una escritura que no se envió');
        assert.match(panel.textContent, /evidencia o el servicio cambió/);
    }
});

test('bloqueo financiero tiene respuesta visible y no ofrece confirmar', async () => {
    const e = caso();
    e.c.HAIKU_ASISTENTE_SERVICIOS_CORTESIA_V1.preparar = async () => ({
        estado: 'bloqueada', mensaje: 'Este servicio tiene pagos aplicados. Revisa el pago antes de cambiar el cobro.'
    });
    const { panel } = await abrir(e, true);
    assert.match(panel.textContent, /tiene pagos aplicados/);
    assert.equal(boton(panel, 'Confirmar cambio'), undefined);
    assert.equal(e.llamadas.length, 0);
});

test('respuesta perdida comprueba estado y no habilita un segundo envío', async () => {
    const e = caso(); let envios = 0;
    e.c.HAIKU_ASISTENTE_SERVICIOS_CORTESIA_V1.confirmar = async () => { envios++; throw Error('Respuesta perdida'); };
    const { panel } = await abrir(e, true), confirmar = boton(panel, 'Confirmar cambio');
    await confirmar.listeners.click(); await confirmar.listeners.click();
    assert.equal(envios, 1); assert.equal(e.verificaciones.length, 1);
    assert.match(panel.textContent, /Comprobar resultado/);
});

test('revisión que sigue incompleta explica por qué no avanza y conserva el formulario', async () => {
    const e = entorno(), out = new e.Element('div'); e.document.card = out;
    await e.api.renderizar(await e.construir(), out, consulta);
    await boton(out, 'Aprobación manual').listeners.click();
    const panel = out.querySelector('.haku-servicio-compacto');
    // Simula la pulsación obsoleta de una ficha cuyo dato sigue faltando.
    const revisar = boton(panel, 'Revisar datos'); revisar.disabled = false;
    await revisar.listeners.click();
    assert.match(panel.textContent, /No se guardó el cambio\.|equivalencia activa compatible/);
    assert.equal(out.querySelector('.haku-servicio-compacto'), panel);
    assert.equal(e.state.escrituras.length, 0);
});
