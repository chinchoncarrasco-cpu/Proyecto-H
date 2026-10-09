const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const R = require('../js/haiku-libro-comparacion-readonly-v1.js');
const F = require('./fixtures/libro-comparacion-readonly.cjs');
const nucleo = R.crearNucleo();
const periodo = { desde: '2026-10-01', hasta: '2026-10-31' };
const fuente = data => ({ nombre: 'fixture-ficticio.xlsx', version: 'fixture-v1', hojas: { Oct26: data } });
const plain = x => JSON.parse(JSON.stringify(x));
const visibleProyecto = x => x ? Object.fromEntries(['titular', 'cabana', 'fecha_checkin', 'fecha_checkout', 'tipo_estadia',
    'adultos', 'ninos', 'mascotas', 'estado_reserva'].map(k => [k, x[k] ?? null])) : null;
const signatureWeb = c => c.map(x => ({ estado: x.estado, categoria: x.categoria, confianza: x.confianza,
    cabana: x.libro.cabana, titular: x.libro.titular, checkin: x.libro.fecha_checkin, checkout: x.libro.fecha_checkout,
    sistema: visibleProyecto(x.sistema), candidatos: (x.candidatosDetalle || []).map(visibleProyecto), diferencias: Array.from(x.diferencias),
    pagos: x.pagosComparacion.map(p => p.estado), servicios: x.serviciosComparacion.map(s => s.estado) }));
const signatureDto = d => d.comparacion.items.map(x => ({ estado: x.estado, categoria: x.categoria, confianza: x.confianza,
    cabana: x.libro.cabana, titular: x.libro.titular, checkin: x.libro.fecha_checkin, checkout: x.libro.fecha_checkout,
    sistema: visibleProyecto(x.proyecto), candidatos: x.candidatos.map(visibleProyecto), diferencias: x.diferencias,
    pagos: x.pagoIds.map(id => d.pagosDetalle.find(p => p.id === id).estado),
    servicios: x.servicioIds.map(id => d.serviciosDetalle.find(s => s.id === id).estado) }));
function validarReferencias(d) {
    const ids = new Set(d.comparacion.items.map(i => i.id));
    assert.equal(ids.size, d.comparacion.items.length);
    for (const g of d.comparacion.grupos) { assert.ok(g.itemIds.every(id => ids.has(id))); assert.ok(ids.has(g.principalItemId)); }
    for (const xs of [d.pagosDetalle, d.serviciosDetalle]) for (const x of xs) {
        assert.ok(x.itemIds.length); assert.ok(x.itemIds.every(id => ids.has(id)));
        assert.ok(x.grupoIds.every(id => d.comparacion.grupos.some(g => g.id === id)));
    }
}
function validarIdsPublicos(dto) {
    const permitidos = new Map();
    for (const [nombre, prefijo] of [['items', 'caso'], ['grupos', 'grupo']])
        for (const x of dto.comparacion?.[nombre] || []) permitidos.set(x, prefijo);
    for (const [nombre, prefijo] of [['pagosDetalle', 'pago'], ['serviciosDetalle', 'servicio']])
        for (const x of dto[nombre] || []) permitidos.set(x, prefijo);
    const prohibidos = new Set(['reserva_id', 'estadia_id', 'grupo_reserva_id', 'servicio_id', 'cargo_id']);
    function recorrer(x, ruta = '$') {
        if (!x || typeof x !== 'object') return;
        for (const [key, value] of Object.entries(x)) {
            assert.equal(prohibidos.has(key), false, ruta + '.' + key);
            if (key === 'id') {
                assert.ok(permitidos.has(x), 'id fuera de colecciones de transporte: ' + ruta);
                assert.match(value, new RegExp('^' + permitidos.get(x) + ':[1-9]\\d*$'));
            }
            if (key === 'proyecto' && value) assert.equal(Object.hasOwn(value, 'id'), false, ruta + '.proyecto.id');
            recorrer(value, ruta + '.' + key);
        }
    }
    recorrer(dto);
}

test('R1: todo DTO público usa exclusivamente IDs de transporte, incluidos candidatos, cargos y contexto', async () => {
    for (const f of F.casos()) {
        const dto = plain(await nucleo.compararMes({ fuente: fuente(f.data), cliente: F.cliente(f.db), ahora: F.ahora }));
        assert.ok(['ok', 'incompleto'].includes(dto.status)); validarIdsPublicos(dto); validarReferencias(dto);
    }
});

test('R1: crearSemantica reutiliza la adaptación explícita, sin envolver una semántica adaptada', () => {
    const base = require('../js/haiku-libro-semantica-v1.js'), lenguaje = require('../js/haiku-libro-lenguaje-natural-v1.js');
    const canon = require('../js/haiku-libro-pagos-canon-v1.js');
    const una = lenguaje.crearSemantica(base, canon), dos = lenguaje.crearSemantica(una.semantica, canon);
    assert.equal(dos.semantica, una.semantica); assert.equal(dos.semantica.normalizar, una.semantica.normalizar);
    assert.equal(lenguaje.crearSemantica(base, canon).semantica, una.semantica);
    const marca = Object.getOwnPropertyDescriptor(una.semantica, Symbol.for('haiku.libro.lenguaje-natural.v1'));
    assert.equal(marca.writable, false); assert.equal(marca.configurable, false); assert.equal(marca.enumerable, false);
    assert.ok(Object.isFrozen(marca.value)); assert.equal(marca.value.base, base);
    assert.equal(marca.value.base[Symbol.for('haiku.libro.lenguaje-natural.v1')], undefined);
    assert.equal(una.semantica.normalizarHoja, base.normalizarHoja); assert.equal(una.semantica.servicios, base.servicios);
});

function casosIdempotencia() {
    return [F.casos().find(x => x.id === 'asociacion_segura'), F.caso('normalizacion_titular', r => {
        r.titular = 'Huésped frecuente'; r.texto_original = 'Huésped frecuente / Ficticiouno Apellidouno / 2 ADL';
    }), ...['full_day', 'aplicacion_existente', 'bloqueos_lectura_segura', 'cancelacion_informativa'].map(id => F.casos().find(x => x.id === id))];
}
const consultaLenguaje = 'Libro: comparar reservas en el mes de octubre de 2026 con Proyecto H';

test('R1 CommonJS: tres núcleos comparten una capa semántica y conservan normalización y dependencias', async () => {
    const original = globalThis.HAIKU_LIBRO_CONSULTAS, capturas = [];
    globalThis.HAIKU_LIBRO_CONSULTAS = { ...original, crearMotorLectura: deps => {
        capturas.push(deps.semantica); return original.crearMotorLectura(deps);
    } };
    try {
        const a = R.crearNucleo(), b = R.crearNucleo(), c = R.crearNucleo();
        assert.equal(capturas.length, 3); assert.equal(capturas[0], capturas[1]); assert.equal(capturas[1], capturas[2]);
        assert.equal(capturas[0].normalizar, capturas[2].normalizar);
        assert.match(capturas[0].normalizar(consultaLenguaje), /01-10-2026 31-10-2026/);
        for (const f of casosIdempotencia()) {
            const web = F.web(f.data), result = await web.HAIKU_LIBRO_CONSULTAS.consultar(consultaLenguaje, web.HAIKU_LIBRO_RESERVA_V1, F.cliente(f.db));
            for (const n of [a, b, c]) {
                const cliente = F.cliente(f.db), dto = plain(await n.compararMes({ fuente: fuente(f.data), cliente, ahora: F.ahora }));
                assert.ok(['ok', 'incompleto'].includes(dto.status)); assert.deepEqual(signatureDto(dto), plain(signatureWeb(result.comparacion)), f.id);
                assert.deepEqual(dto.presentacion, plain(web.HAIKU_LIBRO_CONSULTAS.modeloPresentacionComparacion(result).contadores));
                validarIdsPublicos(dto); validarReferencias(dto); assert.deepEqual(cliente.mutaciones, []);
                if (f.id === 'normalizacion_titular') assert.equal(dto.comparacion.items[0].libro.titular, 'Ficticiouno Apellidouno');
                if (f.id === 'full_day') assert.equal(dto.comparacion.items[0].libro.tipo_estadia, 'full_day');
                if (f.id === 'aplicacion_existente') assert.equal(dto.pagosDetalle[0].destinoFinanciero.estado, 'ya_aplicada');
            }
        }
    } finally { globalThis.HAIKU_LIBRO_CONSULTAS = original; }
});

test('R1 Web ya inicializado: tres núcleos reutilizan la semántica Web sin reemplazar normalizar', async () => {
    for (const f of casosIdempotencia()) {
        const web = F.web(f.data), semantica = web.HAIKU_LIBRO_SEMANTICA, original = web.HAIKU_LIBRO_CONSULTAS, capturas = [];
        web.HAIKU_LIBRO_CONSULTAS = { ...original, crearMotorLectura: deps => {
            capturas.push(deps.semantica); return original.crearMotorLectura(deps);
        } };
        vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-comparacion-readonly-v1.js'), 'utf8'), web);
        const api = web.HAIKU_LIBRO_COMPARACION_READONLY_V1, a = api.crearNucleo(), b = api.crearNucleo(), c = api.crearNucleo();
        assert.equal(capturas.length, 3); assert.ok(capturas.every(s => s === semantica && s.normalizar === semantica.normalizar));
        const originalResultado = await original.consultar(consultaLenguaje, web.HAIKU_LIBRO_RESERVA_V1, F.cliente(f.db));
        for (const n of [a, b, c]) {
            const cliente = F.cliente(f.db), dto = plain(await n.compararMes({ fuente: { libro: web.HAIKU_LIBRO_RESERVA_V1 }, cliente, ahora: F.ahora }));
            assert.ok(['ok', 'incompleto'].includes(dto.status)); assert.deepEqual(signatureDto(dto), plain(signatureWeb(originalResultado.comparacion)), f.id);
            assert.equal(web.HAIKU_LIBRO_SEMANTICA, semantica); validarIdsPublicos(dto); assert.deepEqual(cliente.mutaciones, []);
        }
    }
});

test('R1: IDs persistentes internos en todos los contextos no salen en JSON ni modifican el resultado de cálculo', async () => {
    const f = F.casos().find(x => x.id === 'aplicacion_existente'); f.data.reservas[0].servicios = [F.servicio()];
    const web = F.web(f.data), result = await web.HAIKU_LIBRO_CONSULTAS.consultar(F.consulta, web.HAIKU_LIBRO_RESERVA_V1, F.cliente(f.db));
    const ids = Object.fromEntries(['id', 'reserva_id', 'estadia_id', 'grupo_reserva_id', 'servicio_id', 'cargo_id']
        .map(k => [k, 'PERSISTENTE_R1_' + k]));
    const comp = result.comparacion; Object.assign(comp[0].sistema, ids);
    comp[0].candidatosDetalle = [{ ...comp[0].sistema }];
    for (const x of [...comp.pagosDetalle, ...comp.serviciosDetalle]) Object.assign(x.sistema, ids);
    const aplicacion = comp.pagosDetalle[0].destinoFinanciero.aplicaciones[0]; Object.assign(aplicacion, ids); Object.assign(aplicacion.cargo, ids);
    const bloqueo = { ...ids, cabana: 1, fecha_inicio: '2026-10-10', fecha_fin: '2026-10-12', nota: 'Mantención ficticia', origen: F.origen('G3') };
    result.bloqueos_comparacion = [{ bloqueo, estado: 'ya_coincide' }];
    result.bloqueos_comparacion.solo_proyecto_h = [bloqueo]; result.bloqueos_comparacion.revision_inversa = [bloqueo];
    const cancelacion = { ...ids, tipo: 'confirmada', actual: { ...comp[0].sistema }, evidencia: { ...comp[0].libro, ...ids } };
    result.cancelaciones_confirmadas = [cancelacion]; result.cancelaciones_ya_coinciden = [cancelacion]; result.cancelaciones_revision = [cancelacion];
    const before = JSON.stringify({ result, detalles: comp.pagosDetalle, servicios: comp.serviciosDetalle });
    const dto = plain(R.exportar(result, { periodo: { ...periodo, etiqueta: 'octubre 2026', timezone: 'America/Santiago' }, generatedAt: F.ahora }));
    validarIdsPublicos(dto); validarReferencias(dto); assert.doesNotMatch(JSON.stringify(dto), /PERSISTENTE_R1_/);
    assert.equal(dto.contexto.bloqueos.soloProyectoH[0].cabana, 1); assert.equal(dto.contexto.cancelaciones.confirmadas[0].actual.titular, 'Ficticiouno Apellidouno');
    assert.equal(JSON.stringify({ result, detalles: comp.pagosDetalle, servicios: comp.serviciosDetalle }), before);
});
for (const f of F.casos()) test(`paridad consultar Web → readonly/JSON: ${f.id}`, async () => {
    const web = F.web(f.data), cw = F.cliente(f.db), cr = F.cliente(f.db), before = JSON.stringify(f);
    const w = await web.HAIKU_LIBRO_CONSULTAS.consultar(F.consulta, web.HAIKU_LIBRO_RESERVA_V1, cw);
    const d = plain(await nucleo.compararMes({ fuente: fuente(f.data), cliente: cr, ahora: F.ahora }));
    assert.ok(['ok', 'incompleto'].includes(d.status), JSON.stringify(d.error));
    assert.deepEqual(signatureDto(d), plain(signatureWeb(w.comparacion)));
    assert.deepEqual(d.comparacion.meta, { ...plain(w.comparacion.meta), estadias_libro: w.comparacion.meta.estadias_libro ?? null });
    assert.deepEqual(d.presentacion, plain(web.HAIKU_LIBRO_CONSULTAS.modeloPresentacionComparacion(w).contadores));
    assert.deepEqual(d.advertencias, plain(w.advertencias));
    assert.deepEqual(d.cobertura.hojas, [{ hoja: 'Oct26', geometria: f.data.cobertura?.geometria ?? null, pagos: f.data.cobertura?.pagos ?? null }]);
    assert.equal(d.cobertura.bloqueosLecturaSegura, w.bloqueos_lectura_segura);
    assert.deepEqual(d.cobertura.cabanasRevision, plain(w.bloqueos_cabanas_revision || []));
    assert.deepEqual(d.contexto.advertenciasInformativas, plain(web.HAIKU_LIBRO_CONSULTAS.modeloPresentacionComparacion(w).advertenciasInformativas));
    assert.deepEqual(d.comparacion.items.map(i => ({ advertencias: i.libro.advertencias, informativas: i.libro.advertenciasInformativas,
        cobertura: i.libro.cobertura_pagos, origen: i.libro.origen?.celda })),
        plain(w.comparacion.map(i => ({ advertencias: i.libro.advertencias || [], informativas: i.libro.advertencias_informativas || [],
            cobertura: i.libro.cobertura_pagos ?? null, origen: i.libro.coordenadas_origen?.celda }))));
    assert.deepEqual(d.pagosDetalle.map(p => ({ estado: p.estado, resolucion: p.resolucionSemantica?.estado || null, monto: p.libro.monto,
        medio: p.libro.medio_pago, origen: p.libro.origen?.celda || null })),
        plain(w.comparacion.pagosDetalle.map(p => ({ estado: p.estado, resolucion: p.resolucionPago?.estado || null,
            monto: p.pago.monto ?? null, medio: p.pago.medio_pago ?? null, origen: p.pago.origen?.celda || null }))));
    assert.deepEqual(d.serviciosDetalle.map(s => s.estado), plain(w.comparacion.serviciosDetalle.map(s => s.estado)));
    assert.deepEqual(d.comparacion.grupos.map(g => ({ estado: g.estado, categoria: g.categoria, diferencias: g.diferencias,
        cabanas: g.cabanas, indices: g.itemIds.map(id => d.comparacion.items.findIndex(i => i.id === id)) })),
        plain(w.comparacion.grupos.map(g => ({ estado: g.estado, categoria: g.categoria, diferencias: g.diferencias,
            cabanas: g.cabanas, indices: g.items.map(i => w.comparacion.indexOf(i)) }))));
    validarReferencias(d); validarIdsPublicos(d); assert.equal(JSON.stringify(f), before);
    assert.deepEqual(cr.mutaciones, []); assert.deepEqual(cw.mutaciones, []);
    assert.equal(d.mode, 'read-only'); assert.equal(d.schemaVersion, 1);
});

test('unidades: 3 estadías asociadas / 3 válidas; sólo 1 grupo y reserva H', async () => {
    const f = F.casos().find(x => x.id === 'multicabana');
    const d = await nucleo.compararMes({ fuente: fuente(f.data), cliente: F.cliente(f.db), ahora: F.ahora });
    assert.equal(d.status, 'ok'); assert.equal(d.presentacion.estadiasAsociadas, 3); assert.equal(d.presentacion.estadiasValidas, 3);
    assert.equal(d.presentacion.gruposAsociados, 1); assert.equal(d.presentacion.gruposLibro, 1); assert.equal(d.presentacion.reservasProyecto, 1);
    assert.equal(d.comparacion.meta.asociadas, 1); assert.equal(d.comparacion.grupos[0].itemIds.length, 3);
});
test('unidades: 2 casos con diferencias se muestran en 1 acordeón de grupo', async () => {
    const f = F.casos().find(x => x.id === 'dos_casos_un_grupo_con_diferencias');
    const d = await nucleo.compararMes({ fuente: fuente(f.data), cliente: F.cliente(f.db), ahora: F.ahora });
    assert.equal(d.presentacion.casosConDiferencias, 2); assert.equal(d.presentacion.gruposConDiferencias, 1);
});
test('pagos: conserva las cuatro resoluciones semánticas y estados mensuales', async () => {
    const esperado = { pago_existente: ['en_sistema', 'EXISTENTE_SEGURO'], pago_nuevo: ['nuevo_seguro', 'NUEVO_SEGURO'],
        pago_diferente: ['diferente', 'CONFLICTO'], pago_ambiguo: ['revisar', 'AMBIGUO'], pago_conflictivo: ['revisar', 'CONFLICTO'] };
    for (const [id, states] of Object.entries(esperado)) {
        const f = F.casos().find(x => x.id === id), d = await nucleo.compararMes({ fuente: fuente(f.data), cliente: F.cliente(f.db), ahora: F.ahora });
        assert.deepEqual([d.pagosDetalle[0].estado, d.pagosDetalle[0].resolucionSemantica.estado], states, id);
    }
});
test('servicios: mantiene exclusivamente los cinco estados del flujo mensual', async () => {
    for (const [id, estado] of Object.entries({ servicio_en_sistema: 'en_sistema', servicio_faltante: 'faltante',
        servicio_diferente: 'diferente', servicio_revision: 'revisar', servicio_reserva_faltante: 'con_reserva_faltante' })) {
        const f = F.casos().find(x => x.id === id), d = await nucleo.compararMes({ fuente: fuente(f.data), cliente: F.cliente(f.db), ahora: F.ahora });
        assert.equal(d.serviciosDetalle[0].estado, estado); assert.equal(d.serviciosDetalle[0].reconciliacion_estado, undefined);
    }
});
test('cobertura desconocida/incompleta es explícita; no se anuncia comparación completa', async () => {
    const f = F.caso('desconocida', (r, db, data) => delete data.cobertura);
    const d = await nucleo.compararMes({ fuente: fuente(f.data), cliente: F.cliente(f.db), ahora: F.ahora });
    assert.equal(d.status, 'incompleto'); assert.equal(d.error.code, 'COBERTURA_INSUFICIENTE');
    assert.equal(d.cobertura.hojas[0].geometria, null); assert.equal(d.cobertura.hojas[0].pagos, null);
    assert.equal(d.cobertura.bloqueosLecturaSegura, false);
});
test('DTO explícito: roundtrip conserva grupos/meta/detalles y excluye capacidades, snapshots y claves de escritura', async () => {
    const f = F.casos().find(x => x.id === 'pago_distribuido'), c = F.cliente(f.db), web = F.web(f.data);
    const w = await web.HAIKU_LIBRO_CONSULTAS.consultar(F.consulta, web.HAIKU_LIBRO_RESERVA_V1, c);
    w.comparacion.payload = { token: 'PROHIBIDO' }; w.plan = { rpc: 'PROHIBIDO' };
    w.comparacion[0].payload = { operacion_id: 'PROHIBIDO' }; w.comparacion[0].html = '<b>PROHIBIDO</b>';
    w.comparacion[0].libro.callback = () => {}; w.comparacion[0].libro.token = 'PROHIBIDO';
    w.comparacion.snapshot.token = 'PROHIBIDO'; w.comparacion.pagosDetalle[0].destinoFinanciero.aplicaciones_payload = [{ token: 'PROHIBIDO' }];
    w.cobertura = [{ hoja: 'Oct26', geometria: true, pagos: true }];
    const d = R.exportar(w, { periodo: { ...periodo, etiqueta: 'octubre 2026', timezone: 'America/Santiago', token: 'PROHIBIDO' },
        fuente: { nombre: 'fixture-ficticio.xlsx', token: 'PROHIBIDO' }, generatedAt: F.ahora,
        modelo: web.HAIKU_LIBRO_CONSULTAS.modeloPresentacionComparacion(w) });
    const json = JSON.stringify(d);
    assert.doesNotMatch(json, /PROHIBIDO|NO_EXPORTAR|"(?:snapshot|payload|aplicaciones_payload|callback|html|token|session|cliente|plan|clave|operacion_id)"/);
    const roundtrip = plain(d); validarReferencias(roundtrip);
    assert.equal(roundtrip.comparacion.grupos.length, 1); assert.equal(roundtrip.pagosDetalle.length, 1);
    assert.ok(roundtrip.pagosDetalle[0].destinoFinanciero.aplicaciones.length);
    assert.ok(roundtrip.comparacion.items[0].libro.origen.merge);
    assert.equal(JSON.parse(JSON.stringify(w.comparacion)).meta, undefined, 'demuestra el problema previo del Array');
});
test('frontera pública sólo ofrece compararMes; fábrica de cálculo excluye writers y renderers', () => {
    assert.deepEqual(Object.keys(nucleo), ['compararMes']);
    const q = require('../js/haiku-libro-consultas-v1.js').crearMotorLectura({ semantica: require('../js/haiku-libro-semantica-v1.js') });
    assert.deepEqual(Object.keys(q).sort(), ['consultar', 'interpretar', 'modeloPresentacionComparacion']);
});

test('referencias de transporte distinguen detalles iguales y rechazan relaciones ambiguas o externas', async () => {
    const f = F.casos().find(x => x.id === 'servicio_en_sistema'), web = F.web(f.data);
    const w = await web.HAIKU_LIBRO_CONSULTAS.consultar(F.consulta, web.HAIKU_LIBRO_RESERVA_V1, F.cliente(f.db));
    const primero = w.comparacion.serviciosDetalle[0], segundo = { ...primero };
    w.comparacion.serviciosDetalle.push(segundo); w.comparacion[0].serviciosComparacion.push(segundo);
    w.comparacion.grupos[0].servicios.push(segundo);
    const opciones = { periodo: { ...periodo, etiqueta: 'octubre 2026', timezone: 'America/Santiago' }, generatedAt: F.ahora };
    const dto = plain(R.exportar(w, opciones));
    assert.deepEqual(dto.comparacion.items[0].servicioIds, ['servicio:1', 'servicio:2']);
    assert.deepEqual(dto.comparacion.grupos[0].servicioIds, ['servicio:1', 'servicio:2']); validarReferencias(dto);
    w.comparacion[0].serviciosComparacion[0] = { ...primero };
    assert.throws(() => R.exportar(w, opciones), { code: 'RESULTADO_INVALIDO' });
    assert.throws(() => R.exportar(w, { ...opciones, generatedAt: { token: 'NO_EXPORTAR' } }), { code: 'RESULTADO_INVALIDO' });
});
for (const op of ['rpc', 'insert', 'update', 'upsert', 'delete']) test(`cero mutaciones: ${op} bloqueada antes del cliente, aunque el motor la capture`, async () => {
    const f = F.caso('mutacion'), web = F.web(f.data), cliente = F.cliente(f.db), original = web.HAIKU_LIBRO_CONSULTAS;
    web.HAIKU_LIBRO_CONSULTAS = { ...original, crearMotorLectura: deps => {
        const motor = original.crearMotorLectura(deps);
        return { ...motor, consultar: async (t, l, c) => {
            try { op === 'rpc' ? await c.rpc('haiku_incorporar_libro_v1') : await c.from('reservas')[op]({}); } catch (_) {}
            return motor.consultar(t, l, c);
        } };
    } };
    vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-comparacion-readonly-v1.js'), 'utf8'), web);
    const d = await web.HAIKU_LIBRO_COMPARACION_READONLY_V1.crearNucleo().compararMes({ fuente: { libro: web.HAIKU_LIBRO_RESERVA_V1 }, cliente, ahora: F.ahora });
    assert.equal(d.status, 'error'); assert.equal(d.error.code, 'OPERACION_NO_READONLY'); assert.equal(d.comparacion, null);
    assert.deepEqual(cliente.mutaciones, []);
});
for (const tabla of ['reserva_estadias', 'pagos', 'servicios', 'cabanas']) test(`SELECT ${tabla} fallido no produce contadores de éxito`, async () => {
    const f = F.caso('lectura'), c = F.cliente(f.db, { errorTabla: tabla });
    const d = await nucleo.compararMes({ fuente: fuente(f.data), cliente: c, ahora: F.ahora });
    assert.equal(d.status, 'error'); assert.equal(d.error.code, 'ERROR_SUPABASE');
    assert.equal(d.comparacion, null); assert.equal(d.presentacion, null); assert.deepEqual(c.mutaciones, []);
    assert.doesNotMatch(JSON.stringify(d), /NO_EXPORTAR/);
});
test('error financiero capturado por Web también invalida el DTO readonly', async () => {
    const f = F.casos().find(x => x.id === 'pago_distribuido'), c = F.cliente(f.db, { errorTabla: 'vista_estado_cargos' });
    const d = await nucleo.compararMes({ fuente: fuente(f.data), cliente: c, ahora: F.ahora });
    assert.ok(c.lecturas.some(x => x.tabla === 'vista_estado_cargos'));
    assert.equal(d.status, 'error'); assert.equal(d.error.code, 'ERROR_SUPABASE'); assert.equal(d.presentacion, null);
});

test('aplicación existente se conserva segura con BOVTAR físico, cargo y origen; sin snapshot exportado', async () => {
    const f = F.casos().find(x => x.id === 'aplicacion_existente'), c = F.cliente(f.db);
    const d = plain(await nucleo.compararMes({ fuente: fuente(f.data), cliente: c, ahora: F.ahora }));
    assert.equal(d.pagosDetalle[0].estado, 'en_sistema'); assert.equal(d.pagosDetalle[0].resolucionSemantica.estado, 'EXISTENTE_SEGURO');
    const a = d.pagosDetalle[0].destinoFinanciero.aplicaciones[0];
    assert.equal(a.estado, 'ya_aplicada'); assert.equal(a.cargo.concepto, 'Masaje Terapéutico 30 min');
    assert.equal(a.cargo.tipo_cargo, 'servicio'); assert.equal(a.cargo.saldo_cargo, 0); assert.equal(a.origen.celda, 'C28');
    assert.equal(Object.hasOwn(a, 'cargo_id'), false);
    assert.equal(d.pagosDetalle[0].libro.bovtar, '740003'); assert.equal(d.pagosDetalle[0].libro.codigo_autorizacion, null);
    assert.ok(c.lecturas.some(x => x.tabla === 'pago_aplicaciones')); assert.deepEqual(c.mutaciones, []);
});

test('bloqueos y cancelaciones conservan contexto informativo canónico sin ejecutar resoluciones', async () => {
    for (const id of ['bloqueos_lectura_segura', 'cancelacion_informativa']) {
        const f = F.casos().find(x => x.id === id), c = F.cliente(f.db), w = F.web(f.data);
        const original = await w.HAIKU_LIBRO_CONSULTAS.consultar(F.consulta, w.HAIKU_LIBRO_RESERVA_V1, F.cliente(f.db));
        const d = await nucleo.compararMes({ fuente: fuente(f.data), cliente: c, ahora: F.ahora });
        assert.equal(d.status, 'ok'); assert.deepEqual(c.mutaciones, []);
        if (id.startsWith('bloqueos')) {
            assert.equal(d.contexto.bloqueos.items[0].estado, 'ya_coincide');
            assert.equal(d.contexto.bloqueos.items[0].estado, original.bloqueos_comparacion[0].estado);
            assert.equal(d.contexto.bloqueos.items[0].origen.rango, 'G3:K3');
        } else {
            assert.equal(d.contexto.cancelaciones.confirmadas.length, original.cancelaciones_confirmadas.length);
            assert.equal(d.contexto.cancelaciones.confirmadas[0].actual.titular, 'Ficticiouno Apellidouno');
            assert.equal(d.contexto.cancelaciones.confirmadas[0].evidencia.origen.celda, 'D16');
        }
    }
});

for (const [id, tabla] of [['aplicacion_existente', 'pago_aplicaciones'], ['bloqueos_lectura_segura', 'bloqueos_cabana'],
    ['cancelacion_informativa', 'reservas']]) test(`error contextual ${tabla} aborta aun capturado por el motor`, async () => {
    const f = F.casos().find(x => x.id === id), c = F.cliente(f.db, { errorTabla: tabla });
    const d = await nucleo.compararMes({ fuente: fuente(f.data), cliente: c, ahora: F.ahora });
    assert.ok(c.lecturas.some(x => x.tabla === tabla)); assert.equal(d.status, 'error');
    assert.equal(d.error.code, 'ERROR_SUPABASE'); assert.equal(d.presentacion, null); assert.deepEqual(c.mutaciones, []);
});

test('permiso SELECT denegado y errores de fuente con códigos externos no filtran mensajes ni ceros', async () => {
    const f = F.caso('errores'), c = F.cliente(f.db);
    const from = c.from; c.from = tabla => { const q = from(tabla); q.then = ok => Promise.resolve({ data: null, error: { code: '42501', message: 'NO_EXPORTAR' } }).then(ok); return q; };
    let d = await nucleo.compararMes({ fuente: fuente(f.data), cliente: c, ahora: F.ahora });
    assert.equal(d.error.code, 'SESION_PERMISOS'); assert.equal(d.comparacion, null);
    const libro = { ...F.libroBase(f.data), listo: async () => { throw Object.assign(Error('NO_EXPORTAR'), { code: 'ERROR_LECTURA' }); } };
    d = await nucleo.compararMes({ fuente: { libro }, cliente: c, ahora: F.ahora });
    assert.equal(d.error.code, 'ERROR_LECTURA'); assert.doesNotMatch(JSON.stringify(d), /NO_EXPORTAR/);
});

test('sello de fuente detecta modificación in-place de estado y modifiedTime', async () => {
    const f = F.caso('sello'), estado = { cargado: true, version: 'v1', generacion: 1, modifiedTime: '2026-10-01T00:00:00Z' };
    const libro = { ...F.libroBase(f.data), estado: () => estado };
    const d = await nucleo.compararMes({ fuente: { libro }, cliente: F.cliente(f.db, { onRead: () => estado.modifiedTime = '2026-10-02T00:00:00Z' }), ahora: F.ahora });
    assert.equal(d.error.code, 'FUENTE_CAMBIADA'); assert.equal(d.presentacion, null);
});
test('consulta exitosa vacía es válida; libro ausente/inválido, hoja ausente y sesión son errores distintos', async () => {
    const empty = F.caso('vacio', (r, db, d) => { d.reservas = []; db.reserva_estadias = []; });
    const success = await nucleo.compararMes({ fuente: fuente(empty.data), cliente: F.cliente(empty.db), ahora: F.ahora });
    assert.equal(success.status, 'ok'); assert.equal(success.presentacion.estadiasAsociadas, 0);
    for (const [src, options, code] of [[undefined, {}, 'LIBRO_AUSENTE'], [{}, {}, 'LIBRO_INVALIDO'],
        [{ hojas: { Sep26: empty.data } }, {}, 'HOJA_AUSENTE'], [fuente(empty.data), { sinSesion: true }, 'SESION_PERMISOS']]) {
        const d = await nucleo.compararMes({ fuente: src, cliente: F.cliente(empty.db, options), ahora: F.ahora });
        assert.equal(d.status, 'error'); assert.equal(d.error.code, code); assert.equal(d.presentacion, null);
    }
});
test('error de lectura y cambio de fuente/generación durante el procesamiento son explícitos', async () => {
    const f = F.caso('cambio'); let version = 'v1', generacion = 1;
    const l = { ...F.libroBase(f.data), estado: () => ({ cargado: true, nombre: 'fixture.xlsx', version, generacion }) };
    let d = await nucleo.compararMes({ fuente: { libro: { ...l, consultarHoja: async () => { throw Error('NO_EXPORTAR_TOKEN'); } } }, cliente: F.cliente(f.db), ahora: F.ahora });
    assert.equal(d.error.code, 'ERROR_LECTURA'); assert.doesNotMatch(JSON.stringify(d), /NO_EXPORTAR/);
    d = await nucleo.compararMes({ fuente: { libro: l }, cliente: F.cliente(f.db, { onRead: () => version = 'v2' }), ahora: F.ahora });
    assert.equal(d.error.code, 'FUENTE_CAMBIADA');
    d = await nucleo.compararMes({ fuente: { libro: l }, cliente: F.cliente(f.db, { onRead: () => generacion++ }), ahora: F.ahora });
    assert.equal(d.error.code, 'FUENTE_CAMBIADA'); assert.equal(d.presentacion, null);
});
test('mes actual usa America/Santiago; rechaza un rango que no sea un mes completo', async () => {
    const f = F.caso('periodo');
    let d = await nucleo.compararMes({ fuente: fuente(f.data), cliente: F.cliente(f.db), ahora: '2026-11-01T01:00:00Z' });
    assert.equal(d.periodo.desde, '2026-10-01'); assert.equal(d.periodo.timezone, 'America/Santiago');
    d = await nucleo.compararMes({ fuente: fuente(f.data), cliente: F.cliente(f.db), ahora: F.ahora, periodo: { desde: '2026-10-02', hasta: '2026-10-31' } });
    assert.equal(d.error.code, 'PERIODO_INCONSISTENTE'); assert.equal(d.comparacion, null);
    d = await nucleo.compararMes({ fuente: fuente(f.data), cliente: F.cliente(f.db), ahora: F.ahora, periodo: { desde: 20261001, hasta: null } });
    assert.equal(d.error.code, 'PERIODO_INCONSISTENTE'); assert.equal(d.cobertura, null); assert.equal(d.advertencias, null);
});
test('entrada Web suministrada no consulta DOM, mutadores de fuente ni scope focalizado viejo', async () => {
    const f = F.caso('web'), web = F.web(f.data), c = F.cliente(f.db);
    vm.runInContext(fs.readFileSync(require.resolve('../js/haiku-libro-comparacion-readonly-v1.js'), 'utf8'), web);
    const n = web.HAIKU_LIBRO_COMPARACION_READONLY_V1.crearNucleo();
    const l = { ...web.HAIKU_LIBRO_RESERVA_V1, consultarHoja: async () => { throw Error('Scope focalizado viejo'); },
        consultarHojaMensual: web.HAIKU_LIBRO_RESERVA_V1.consultarHoja,
        cargarDesdeGoogle: () => { throw Error('NO FUENTE REMOTA'); }, guardarCambiosDetectados: () => { throw Error('NO CACHE WRITE'); } };
    web.document = new Proxy({}, { get() { throw Error('DOM PROHIBIDO'); } });
    const d = await n.compararMes({ fuente: { libro: l }, cliente: c, ahora: F.ahora });
    assert.equal(d.status, 'ok'); assert.equal(d.presentacion.estadiasAsociadas, 1); assert.deepEqual(c.mutaciones, []);
});

test('bytes XLSX anonimizados → lector canónico → wrappers → consultar; paridad con entrada Web y rich text', async () => {
    const assets = process.env.HAIKU_LIBRO_WORKER_ASSETS || path.join(os.tmpdir(), 'haiku-jonathan-real-xlsx');
    const lector = require('../js/supabase-libro-reserva-worker-v1.js').crearLector({
        XLSX: require(path.join(assets, 'xlsx.full.min.js')), JSZip: require(path.join(assets, 'jszip.min.js')) });
    const real = require('./fixtures/libro-reconciliacion-oct26-real.json');
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/libro-reconciliacion-oct26-real.xlsx'));
    const hoja = await lector.leerHoja(bytes, 'Oct26');
    const data = require('../js/haiku-libro-semantica-v1.js').normalizarHoja(hoja, 'Oct26');
    const w = F.web(data), cw = F.cliente(real.db), cr = F.cliente(real.db);
    const antes = await w.HAIKU_LIBRO_CONSULTAS.consultar(F.consulta, w.HAIKU_LIBRO_RESERVA_V1, cw);
    const d = await nucleo.compararMes({ fuente: { bytes, nombre: 'libro-anonimizado.xlsx', version: real.origen.sha256_fixture },
        cliente: cr, lector, ahora: F.ahora });
    assert.ok(['ok', 'incompleto'].includes(d.status), JSON.stringify(d.error));
    assert.deepEqual(signatureDto(d), plain(signatureWeb(antes.comparacion))); validarReferencias(plain(d));
    assert.deepEqual(d.presentacion, plain(w.HAIKU_LIBRO_CONSULTAS.modeloPresentacionComparacion(antes).contadores));
    assert.deepEqual(d.comparacion.meta, plain(antes.comparacion.meta));
    assert.ok(hoja.celdas.some(c => c.runs?.some(r => r.font?.color)), 'recorrido real conserva rich text');
    assert.ok(d.comparacion.items.some(i => i.libro.origen?.celda)); assert.deepEqual(cr.mutaciones, []);
    const invalid = await nucleo.compararMes({ fuente: { bytes: Buffer.from('inválido') }, lector, cliente: cr, ahora: F.ahora });
    assert.equal(invalid.error.code, 'LIBRO_INVALIDO'); assert.equal(invalid.presentacion, null);
});
