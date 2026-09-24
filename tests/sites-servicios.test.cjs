const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fuente = fs.readFileSync(path.join(__dirname, '../js/sites-servicios-v1.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const fecha = '2026-09-24';
const servicio = (id, hora, cambios = {}) => ({
    id, fechaServicio: fecha, hora, nombre: 'Tinaja Tonel de Madera', categoria: 'tinaja',
    numeroCabana: '6', titular: 'Dayana Luna', tipoCobro: 'normal', total: 30000,
    estadoServicioDb: 'programado', saldoPendienteVerificado: 30000, ...cambios
});

function entorno(lista = []) {
    const nodos = new Map();
    const nodo = id => {
        const objeto = { id, innerHTML: '', textContent: '', hidden: false, value: fecha,
            listeners: {}, replaceChildren() { this.innerHTML = ''; },
            addEventListener(tipo, fn) { (this.listeners[tipo] ||= []).push(fn); } };
        nodos.set(id, objeto);
        return objeto;
    };
    ['sites-servicios-root', 'sites-servicios-contenido', 'sites-servicios-fecha-label',
        'sites-servicios-selector', 'sites-servicios-cabanas', 'sites-servicios-selector-estado',
        'sites-servicios-copia-estado', 'sites-servicios-fecha', 'seccion-servicios',
        'sites-servicios-realizado', 'sites-servicios-realizado-contenido',
        'sites-servicios-realizado-confirmar', 'sites-servicios-cancelar',
        'sites-servicios-cancelar-contenido', 'sites-servicios-cancelar-confirmar'].forEach(nodo);
    const escuchas = {};
    const documento = { getElementById: id => nodos.get(id) || null,
        addEventListener(tipo, fn) { (escuchas[tipo] ||= []).push(fn); } };
    const tiempos = [];
    const llamadas = [];
    const ventana = {
        haikuSesion: { id: 'u' }, haikuTienePermiso: () => true,
        HAIKU_SERVICIOS_HIDRATACION_V2: { async sincronizar() { llamadas.push('hidratar'); return contexto.serviciosRegistrados; } },
        haikuSupabase: { async rpc(nombre, args) {
            llamadas.push([nombre, args]);
            return { data: [{ numero: 6, estado_operativo: 'continua' }], error: null };
        }, from(tabla) {
            assert.equal(tabla, 'servicios');
            return { select() { return this; }, eq(columna, id) {
                llamadas.push(['buscar-servicio', columna, id]); this.id = id; return this;
            }, then(resolve, reject) {
                return Promise.resolve({ data: [{ id: this.id, reserva_id: 'r', estadia_id: 'e',
                    catalogo_servicio_id: 'c', actualizado_en: 't' }], error: null }).then(resolve, reject);
            } };
        } },
        HAIKU_RESUMEN_SERVICIO_SITES_V1: {
            identidadOperacion: fila => ({ numeroCabana: String(fila.numero) }),
            abrirDesdeServicios: (n, f) => llamadas.push(['abrir', n, f])
        },
        HAIKU_ASISTENTE_SERVICIOS_REALIZADO_V1: {
            async prepararManual(id) {
                llamadas.push(['preparar-manual', id]);
                return { estado: 'propuesta', lectura: {
                    servicio: { estado_servicio: 'programado', fecha_servicio: fecha,
                        hora_inicio: '19:15', hora_fin: '20:15' },
                    catalogo: { nombre: 'Tinaja Tonel de Madera' },
                    reserva: { titular_nombre: 'Dayana Luna' }
                }, mensaje: 'Propuesta segura' };
            },
            finanzasVisuales: () => ({ titulo: 'Cobro normal', detalle: 'Saldo intacto', explicacion: 'Sin cambios financieros.' }),
            async confirmar() { llamadas.push('confirmar-realizado'); return { estado: 'realizado', mensaje: 'Realizado' }; }
        },
        async haikuCancelarServicio(id, opciones) {
            llamadas.push(['cancelar', id, opciones.confirmadoDesdeSites]);
            const item = contexto.serviciosRegistrados.find(s => s.id === id);
            if (item) item.estadoServicioDb = 'cancelado';
        },
        HAIKU_SERVICIOS_TINAJAS_HORARIOS_V1: {
            horarios: [{ inicio: '19:15', fin: '20:15' }],
            serviciosTinajaDelDia: dia => contexto.serviciosRegistrados.filter(s =>
                s.fechaServicio === dia && s.categoria === 'tinaja'),
            estadoHorario(tipo, horario, items) {
                const activos = items.filter(s => s.hora === horario.inicio &&
                    !['cancelado', 'no_show'].includes(s.estadoServicioDb) &&
                    (tipo === 'tonel' ? /tonel/i : /jacuzzi/i).test(s.nombre));
                return { estado: activos.length ? 'tomada' : 'libre', activos };
            },
            textoWhatsApp: () => 'Ambos'
        },
        HAIKU_SERVICIOS_TINAJAS_COPIAR_V2: { textoTipo: tipo => tipo },
        haikuEstadoTemporalServicio: () => ({ clave: 'pendiente' }),
        addEventListener(tipo, fn) { (escuchas[`window:${tipo}`] ||= []).push(fn); }
    };
    const contexto = { window: ventana, document: documento, serviciosRegistrados: lista,
        setTimeout: fn => { tiempos.push(fn); return tiempos.length; },
        navigator: { clipboard: { async writeText(texto) { llamadas.push(['copiar', texto]); } } },
        Intl, Date, console };
    vm.runInNewContext(fuente, contexto, { filename: 'sites-servicios-v1.js' });
    return {
        api: ventana.HAIKU_SITES_SERVICIOS_V1, nodos, escuchas, llamadas, tiempos, contexto,
        html: () => nodos.get('sites-servicios-contenido').innerHTML,
        emitir(tipo) { for (const fn of escuchas[tipo] || []) fn({}); },
        cambiarFecha(valor) {
            nodos.get('sites-servicios-fecha').value = valor;
            for (const fn of nodos.get('sites-servicios-root').listeners.change || []) {
                fn({ target: nodos.get('sites-servicios-fecha') });
            }
        },
        click(selector, dataset = {}) {
            const objetivo = { dataset };
            const evento = { target: { closest: buscado => buscado === selector ? objetivo : null } };
            for (const fn of nodos.get('sites-servicios-root').listeners.click || []) fn(evento);
        }
    };
}

test('sin servicios usa datos reales vacíos, no ejemplos Sites', () => {
    const e = entorno(); e.emitir('haiku:servicios-hidratados');
    assert.equal(e.api.proyectar([], fecha, { fecha, hora: '12:00' }).vigentes.length, 0);
    assert.match(e.html(), /Sin próximos servicios/);
    assert.match(e.html(), /No hay servicios registrados/);
    assert.doesNotMatch(e.html(), /Valentina Araya|H-2841/);
});

test('próximo, orden, realizados y cancelados no inflan la operación', () => {
    const lista = [servicio('tarde', '22:15'), servicio('hecho', '16:15', { estadoServicioDb: 'realizado' }),
        servicio('cancelado', '17:45', { estadoServicioDb: 'cancelado', saldoPendienteVerificado: 0 }),
        servicio('proximo', '19:15')];
    const e = entorno(lista); e.emitir('haiku:servicios-hidratados');
    const p = e.api.proyectar(lista, fecha, { fecha, hora: '18:00' });
    assert.equal(p.proximo.id, 'proximo');
    assert.equal(p.vigentes.length, 3);
    assert.equal(p.pendientes.length, 2);
    assert.deepEqual(Array.from(p.dia, s => s.id), ['hecho', 'cancelado', 'proximo', 'tarde']);
    assert.match(e.html(), /Marcar realizado/);
    assert.match(e.html(), /data-sites-servicios-cancelar/);
    assert.match(e.html(), /data-haiku-reactivar-servicio/);
    assert.match(e.html(), /data-haiku-deshacer-realizado/);
});

test('cortesía, pagado, pendiente parcial y finanzas no verificadas', () => {
    const lista = [servicio('cortesia', '17:45', { tipoCobro: 'cortesia', total: 0, saldoPendienteVerificado: 0 }),
        servicio('pagado', '19:15', { saldoPendienteVerificado: 0 }),
        servicio('parcial', '20:45', { saldoPendienteVerificado: 12000 })];
    const e = entorno(lista); e.emitir('haiku:servicios-hidratados');
    const p = e.api.proyectar(lista, fecha, { fecha, hora: '12:00' });
    assert.equal(p.pagos.cantidad, 1);
    assert.equal(p.pagos.monto, 12000);
    assert.match(e.html(), /Cortesía/);
    assert.match(e.html(), /Pagado/);
    assert.match(e.html(), /\$12\.000/);
    lista[2].saldoPendienteVerificado = null;
    e.api.renderizar();
    assert.equal(e.api.proyectar(lista, fecha).pagos, null);
    assert.match(e.html(), /Finanzas por verificar/);
});

test('disponibilidad usa API existente; cancelado libera turno', () => {
    const lista = [servicio('tonel', '19:15'),
        servicio('jacuzzi', '19:15', { nombre: 'Tinaja Jacuzzi', estadoServicioDb: 'cancelado', saldoPendienteVerificado: 0 })];
    const e = entorno(lista); e.emitir('haiku:servicios-hidratados');
    assert.match(e.html(), /Ocupado <small>· CAB 6/);
    assert.match(e.html(), /Tinaja Jacuzzi <small>1\/1 libres/);
    lista[1].estadoServicioDb = 'programado'; e.api.renderizar();
    assert.match(e.html(), /Tinaja Jacuzzi <small>0\/1 libres/);
});

test('marcar realizado prepara la acción manual por ID y sólo confirma mediante el RPC protegido', async () => {
    const e = entorno([servicio('s1', '19:15')]);
    e.emitir('haiku:servicios-hidratados');
    assert.match(e.html(), /data-sites-servicios-realizar="s1"/);
    assert.doesNotMatch(e.html(), /data-haiku-realizar-servicio="s1"/);
    e.click('[data-sites-servicios-realizar]', { sitesServiciosRealizar: 's1' });
    await new Promise(setImmediate);
    assert.deepEqual(e.llamadas.find(x => Array.isArray(x) && x[0] === 'preparar-manual'),
        ['preparar-manual', 's1']);
    assert.equal(e.llamadas.includes('confirmar-realizado'), false);
    assert.equal(e.nodos.get('sites-servicios-realizado-confirmar').hidden, false);
    assert.match(e.nodos.get('sites-servicios-realizado-contenido').innerHTML,
        /Dayana Luna.*2026-09-24 19:15–20:15/);
    assert.equal(e.nodos.get('sites-servicios-realizado-confirmar').textContent,
        'Marcar servicio como realizado');
    e.click('#sites-servicios-realizado-confirmar');
    await new Promise(setImmediate);
    assert.equal(e.llamadas.includes('confirmar-realizado'), true);
});

test('bloqueo manual muestra razones reales sin lenguaje conversacional ni escritura', async () => {
    const e = entorno([servicio('s1', '19:15')]);
    e.contexto.window.HAIKU_ASISTENTE_SERVICIOS_REALIZADO_V1.prepararManual = async id => {
        assert.equal(id, 's1');
        return { estado: 'bloqueada', mensaje: 'No se puede marcar este servicio como realizado.',
            evaluacion: { razones: ['La fecha del servicio es futura.', 'El cargo o su saldo requiere revisión.'] } };
    };
    e.emitir('haiku:servicios-hidratados');
    e.click('[data-sites-servicios-realizar]', { sitesServiciosRealizar: 's1' });
    await new Promise(setImmediate);
    const cuerpo = e.nodos.get('sites-servicios-realizado-contenido').innerHTML;
    assert.match(cuerpo, /La fecha del servicio es futura/);
    assert.match(cuerpo, /El cargo o su saldo requiere revisión/);
    assert.doesNotMatch(cuerpo, /automáticamente|No puedo marcar/i);
    assert.equal(e.nodos.get('sites-servicios-realizado-confirmar').hidden, true);
    e.click('#sites-servicios-realizado-confirmar');
    assert.equal(e.llamadas.includes('confirmar-realizado'), false);
});

test('cerrar el drawer manual no confirma ni escribe', async () => {
    const e = entorno([servicio('s1', '19:15')]);
    e.emitir('haiku:servicios-hidratados');
    e.click('[data-sites-servicios-realizar]', { sitesServiciosRealizar: 's1' });
    await new Promise(setImmediate);
    e.click('[data-sites-servicios-realizado-cerrar]');
    assert.equal(e.nodos.get('sites-servicios-realizado').hidden, true);
    assert.equal(e.llamadas.includes('confirmar-realizado'), false);
});

test('cancelar muestra confirmación Sites y reutiliza el RPC legacy sólo al confirmar', async () => {
    const e = entorno([servicio('s1', '19:15')]);
    e.emitir('haiku:servicios-hidratados');
    assert.doesNotMatch(e.html(), /data-haiku-cancelar-servicio="s1"/);
    e.click('[data-sites-servicios-cancelar]', { sitesServiciosCancelar: 's1' });
    assert.equal(e.llamadas.some(x => Array.isArray(x) && x[0] === 'cancelar'), false);
    assert.equal(e.nodos.get('sites-servicios-cancelar').hidden, false);
    e.click('#sites-servicios-cancelar-confirmar');
    await new Promise(setImmediate);
    assert.deepEqual(e.llamadas.find(x => Array.isArray(x) && x[0] === 'cancelar'),
        ['cancelar', 's1', true]);
    assert.match(e.html(), /Cancelado/);
});

test('alta reutiliza el drawer real, una sola escucha y respeta fecha', async () => {
    const e = entorno(); e.emitir('haiku:servicios-hidratados');
    assert.equal(e.nodos.get('sites-servicios-root').listeners.click.length, 1);
    e.cambiarFecha('2026-09-25');
    e.click('[data-sites-servicios-registrar]');
    await new Promise(setImmediate);
    assert.equal(e.llamadas.find(x => Array.isArray(x) && x[0] === 'haiku_operacion_dia')[1].p_fecha,
        '2026-09-25');
    e.click('[data-sites-servicios-cabana]', { sitesServiciosCabana: '6' });
    assert.deepEqual(e.llamadas.at(-1), ['abrir', '6', '2026-09-25']);
    e.contexto.serviciosRegistrados = [servicio('nuevo', '22:15', { fechaServicio: '2026-09-25' })];
    await e.api.refrescar();
    assert.match(e.html(), /Tinaja Tonel de Madera/);
    assert.equal(e.escuchas['haiku:servicios-hidratados'].length, 1);
});

test('panel carga estructura Sites y conserva nodos de los handlers reales', () => {
    assert.match(html, /id="sites-servicios-root"/);
    assert.match(html, /id="servicios-agenda"/);
    assert.match(html, /js\/sites-servicios-v1\.js/);
    assert.match(html, /css\/sites-servicios-v1\.css/);
});
