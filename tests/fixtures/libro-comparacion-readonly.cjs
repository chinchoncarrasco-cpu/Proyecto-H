// Casos contractuales ficticios. Sin snapshot productivo ni identificadores personales.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const copy = x => structuredClone(x);
const ahora = '2026-10-09T12:00:00Z', consulta = 'Libro: compara reservas de octubre 2026 con Proyecto H';
const origen = (celda = 'C3') => ({ hoja: 'Oct26', celda, fila: 3, columna: 3,
    merge: { s: { r: 2, c: 2 }, e: { r: 2, c: 8 } } });
const reserva = extra => ({ id: 'libro-ficticio-1', titular: 'Ficticiouno Apellidouno', cabana: 1,
    fecha_checkin: '2026-10-03', fecha_checkout: '2026-10-05', tipo_estadia: 'alojamiento', noches: 2,
    fechas_ocupadas: ['2026-10-03', '2026-10-04'], adultos: 2, ninos: 0, mascotas: 0,
    pagos: [], pagos_sin_asociacion: [], servicios: [], advertencias: [], advertencias_informativas: [],
    notas_importantes: [], pagos_pendientes: [], cobertura_pagos: true, coordenadas_origen: origen(), ...extra });
const estadia = (r, extra) => ({ id: 'estadia-ficticia-1', reserva_id: 'reserva-ficticia-1', cabana_id: 'cab-ficticia-1',
    fecha_ingreso: r.fecha_checkin, fecha_salida: r.fecha_checkout, tipo_estadia: r.tipo_estadia,
    estado_estadia: 'confirmada', adultos: r.adultos, ninos: r.ninos, mascotas: r.mascotas,
    cabanas: { numero: r.cabana }, reservas: { id: 'reserva-ficticia-1', titular_nombre: r.titular, estado_reserva: 'confirmada' }, ...extra });
const pago = extra => ({ monto: 10000, moneda: 'CLP', medio_pago: 'webpay_credito', tipo_movimiento: 'alojamiento',
    estado_pago: 'registrado_en_libro', pago_recibido: true, codigo_autorizacion: '740001', folio: '740002', bovtar: '740003',
    fecha_comprobante: '2026-10-03', fecha_bloque: '2026-10-03', cabana: 1, titular: 'Ficticiouno Apellidouno',
    texto_original: 'Webpay crédito CodAut 740001 CLP $10,000', origen: origen('C28'),
    evidencia_financiera: { sector: 'pagos', columnas_ocupadas: { detalle: true, concepto: true, monto: true } }, ...extra });
const pagoH = extra => ({ id: 'pago-ficticio-1', reserva_id: 'reserva-ficticia-1', monto: 10000, moneda: 'CLP',
    medio_pago: 'webpay_credito', codigo_autorizacion: '740001', folio: '740002', bove: null,
    datos_origen: { bovtar: '740003' }, fecha_pago: '2026-10-03', estado: 'confirmado', ...extra });
const servicio = extra => ({ concepto: 'masaje', hora: '13:00', monto: 10000,
    texto_original: 'X PAGAR MASAJE 30 MIN 13:00 CLP $10,000', coordenadas_origen: origen(), ...extra });
const servicioH = extra => ({ id: 'servicio-ficticio-1', reserva_id: 'reserva-ficticia-1', estadia_id: 'estadia-ficticia-1',
    fecha_servicio: '2026-10-03', hora_inicio: '13:00', total: 10000, estado_servicio: 'programado',
    catalogo_servicios: { codigo: 'masajeTerapeutico30', nombre: 'Masaje Terapéutico 30 min', categoria: 'masaje' }, ...extra });
function caso(id, configurar = () => {}) {
    const r = reserva(), db = { reserva_estadias: [estadia(r)], pagos: [], servicios: [], vista_estado_cargos: [], pago_aplicaciones: [],
        cabanas: [], bloqueos_cabana: [], reservas: [] };
    const data = { hoja: 'Oct26', reservas: [r], pagos: [], cancelaciones: [], bloqueos: [], aseos: [], espacios: [], anotaciones: [],
        advertencias: [], cobertura: { geometria: true, pagos: true } };
    configurar(r, db, data); return { id, data, db };
}
function casos() {
    return [
        caso('asociacion_segura'), caso('reserva_faltante', (r, db) => db.reserva_estadias = []),
        caso('ambiguas', (r, db) => db.reserva_estadias.push(estadia(r, { id: 'estadia-ficticia-2', reserva_id: 'reserva-ficticia-2' }))),
        caso('modificacion_titular', (r, db) => db.reserva_estadias[0].reservas.titular_nombre = 'Ficticiodos Apellidodos'),
        caso('modificacion_fechas', (r, db) => db.reserva_estadias[0].fecha_salida = '2026-10-06'),
        caso('cambio_cabana', (r, db) => db.reserva_estadias[0].cabanas.numero = 2),
        caso('multicabana', (r, db, data) => {
            r.correo = 'grupo@example.invalid';
            for (const n of [2, 3]) { const otro = reserva({ id: `libro-ficticio-${n}`, cabana: n, correo: r.correo,
                coordenadas_origen: origen(`C${n + 2}`) }); data.reservas.push(otro);
                db.reserva_estadias.push(estadia(otro, { id: `estadia-ficticia-${n}` })); }
            for (const e of db.reserva_estadias) e.reservas.correo_contacto = r.correo;
        }),
        caso('asociacion_parcial', (r, db, data) => data.reservas.push(reserva({ id: 'libro-ficticio-2', cabana: 2, coordenadas_origen: origen('C4') }))),
        caso('full_day', (r, db) => { Object.assign(r, { tipo_estadia: 'full_day', noches: 0, fecha_checkout: r.fecha_checkin }); db.reserva_estadias = [estadia(r)]; }),
        caso('geometria_incompleta', (r, db, data) => { data.cobertura.geometria = false; r.fecha_checkout = null; r.noches = null; r.fechas_ocupadas = []; r.advertencias = ['Geometría incompleta']; }),
        caso('pago_existente', (r, db) => { r.pagos = [pago()]; db.pagos = [pagoH()]; }),
        caso('pago_nuevo', r => r.pagos = [pago()]),
        caso('pago_diferente', (r, db) => { r.pagos = [pago()]; db.pagos = [pagoH({ monto: 20000 })]; }),
        caso('pago_ambiguo', (r, db) => { r.pagos = [pago()]; db.pagos = [pagoH(), pagoH({ id: 'pago-ficticio-2' })]; }),
        caso('pago_conflictivo', (r, db) => { r.pagos = [pago()]; db.pagos = [pagoH({ reserva_id: 'otra-reserva-ficticia' })]; }),
        caso('pago_sin_asociacion', r => r.pagos_sin_asociacion = [pago({ codigo_autorizacion: null, bovtar: null, folio: null, medio_pago: null })]),
        caso('BOVE', r => r.pagos = [pago({ texto_original: 'BOVE 740099 pendiente', monto: null, codigo_autorizacion: null, bovtar: null, folio: null, bove_pendiente: true })]),
        caso('BOVTAR', r => r.pagos = [pago({ texto_original: 'Webpay crédito Folio 740002 BOVTAR 740003 CLP $10,000', codigo_autorizacion: null })]),
        caso('CodAut', r => r.pagos = [pago({ folio: null, bovtar: null })]),
        caso('pago_distribuido', (r, db, data) => {
            r.pagos = [pago({ monto: 20000, concepto: 'arriendo', texto_original: 'Webpay crédito CodAut 740001 ARRIENDO $20,000 TOTAL $30,000' }),
                pago({ tipo_movimiento: 'servicio', concepto: 'masaje', origen: origen('G28'),
                    texto_original: 'Webpay crédito CodAut 740001 MASAJE $10,000 TOTAL $30,000' })];
            db.vista_estado_cargos = [{ cargo_id: 'cargo-ficticio-1', reserva_id: 'reserva-ficticia-1', estadia_id: 'estadia-ficticia-1', servicio_id: 'servicio-ficticio-1',
                tipo_cargo: 'servicio', concepto: 'Masaje Terapéutico 30 min', monto: 10000, saldo_cargo: 10000 }];
            db.servicios = [servicioH()]; data.pagos = copy(r.pagos);
        }),
        caso('aplicacion_existente', (r, db) => {
            r.pagos = [pago({ tipo_movimiento: 'servicio', concepto: 'masaje', codigo_autorizacion: null, medio_pago: 'debito',
                texto_original: 'Débito Folio 740002 BOVTAR 740003 MASAJE CLP $10,000' })];
            db.pagos = [pagoH({ tipo_movimiento: 'pago', codigo_autorizacion: '740003', medio_pago: 'tarjeta_debito', datos_origen: {} })]; db.servicios = [servicioH({ tipo_cobro: 'normal' })];
            db.vista_estado_cargos = [{ cargo_id: 'cargo-ficticio-1', reserva_id: 'reserva-ficticia-1', estadia_id: 'estadia-ficticia-1', servicio_id: 'servicio-ficticio-1',
                tipo_cargo: 'servicio', concepto: 'Masaje Terapéutico 30 min', monto: 10000, monto_ajustado: 10000,
                aplicado_neto: 10000, saldo_cargo: 0, estado: 'activo', estado_pago: 'pagado' }];
            db.pago_aplicaciones = [{ id: 'aplicacion-ficticia-1', pago_id: 'pago-ficticio-1', cargo_id: 'cargo-ficticio-1', monto_aplicado: 10000 }];
        }),
        caso('servicio_en_sistema', (r, db) => { r.servicios = [servicio()]; db.servicios = [servicioH()]; }),
        caso('servicio_faltante', r => r.servicios = [servicio()]),
        caso('servicio_diferente', (r, db) => { r.servicios = [servicio()]; db.servicios = [servicioH({ total: 15000 })]; }),
        caso('servicio_revision', (r, db) => { r.servicios = [servicio({ hora: '15:00' })]; db.servicios = [servicioH(), servicioH({ id: 'servicio-ficticio-2', hora_inicio: '14:00' })]; }),
        caso('servicio_reserva_faltante', (r, db) => { r.servicios = [servicio()]; db.reserva_estadias = []; }),
        caso('cobertura_pagos_incompleta', (r, db, data) => { data.cobertura.pagos = false; r.cobertura_pagos = false; }),
        caso('advertencias', (r, db, data) => { data.advertencias = ['Advertencia geométrica localizada']; r.advertencias_informativas = ['Documento sin dato']; }),
        caso('bloqueos_lectura_segura', (r, db, data) => {
            db.cabanas = [{ id: 'cab-ficticia-1', numero: 1, activa: true }];
            data.bloqueos = [{ id: 'bloqueo-libro-ficticio', cabana: 1, fecha_inicio: '2026-10-10', fecha_fin: '2026-10-12',
                nota: 'Mantención ficticia', origen: { ...origen('G3'), rango: 'G3:K3' },
                evidencia: { geometria: 'disponibilidad_completa' } }];
            db.bloqueos_cabana = [{ id: 'bloqueo-ficticio-1', cabana_id: 'cab-ficticia-1', estado: 'activo',
                desde: '2026-10-10T03:00:00Z', hasta: '2026-10-12T03:00:00Z', motivo: 'Mantención ficticia' }];
        }),
        caso('cancelacion_informativa', (r, db, data) => {
            data.reservas = []; data.cancelaciones = [{ bloque: 'CANCELACIONES', titular: r.titular, fecha_checkin: r.fecha_checkin,
                noches: 2, cabana: 1, origen: origen('D16') }];
            db.reservas = [{ id: 'reserva-ficticia-1', titular_nombre: r.titular, estado_reserva: 'confirmada', estadias: [db.reserva_estadias[0]] }];
        }),
        caso('dos_casos_un_grupo_con_diferencias', (r, db, data) => {
            r.correo = 'grupo@example.invalid'; r.telefono = '+56 9 00000001';
            const otro = reserva({ id: 'libro-ficticio-2', cabana: 2, correo: r.correo, telefono: r.telefono, coordenadas_origen: origen('C4') });
            data.reservas.push(otro); db.reserva_estadias.push(estadia(otro, { id: 'estadia-ficticia-2' }));
            for (const e of db.reserva_estadias) { e.reservas.correo_contacto = r.correo; e.reservas.telefono_contacto = '+56 9 00000002'; }
        })
    ];
}
function cliente(dbOriginal, { errorTabla, onRead, sinSesion } = {}) {
    const db = copy(dbOriginal), lecturas = [], mutaciones = [];
    const write = nombre => { mutaciones.push(nombre); throw Error('MUTACIÓN REAL PROHIBIDA'); };
    return { db, lecturas, mutaciones, auth: { getSession: async () => ({ data: { session: sinSesion ? null : {
        user: { id: 'usuario-ficticio' }, access_token: 'NO_EXPORTAR_TOKEN_SUPABASE' } }, error: null }) },
        rpc: name => write(name), from(tabla) {
            const filtros = []; let rango = null;
            const q = { select: columns => (lecturas.push({ tabla, columns }), q),
                eq: (k, v) => (filtros.push(x => x[k] === v), q), in: (k, vs) => (filtros.push(x => vs.includes(x[k])), q),
                lte: (k, v) => (filtros.push(x => x[k] <= v), q), gte: (k, v) => (filtros.push(x => x[k] >= v), q), order: () => q,
                range: (a, b) => (rango = [a, b], q), insert: () => write('insert'), update: () => write('update'),
                upsert: () => write('upsert'), delete: () => write('delete'), then(ok, no) {
                    onRead?.(tabla); let rows = copy((db[tabla] || []).filter(x => filtros.every(f => f(x))));
                    if (rango) rows = rows.slice(rango[0], rango[1] + 1);
                    return Promise.resolve(tabla === errorTabla ? { data: null, error: { code: 'XX000', message: 'NO_EXPORTAR_SECRETO' } } : { data: rows, error: null }).then(ok, no);
                } }; return q;
        } };
}
function libroBase(data) {
    return { listo: async () => {}, estado: () => ({ cargado: true, nombre: 'fixture-ficticio.xlsx', version: 'fixture-v1', generacion: 1 }),
        listarHojas: () => ['Oct26'], consultarHoja: async () => copy(data) };
}
function web(data) {
    const document = { readyState: 'complete', getElementById: () => ({}), querySelector: () => null, querySelectorAll: () => [] };
    const c = vm.createContext({ document, addEventListener() {}, structuredClone, console: { info() {} },
        HAIKU_LIBRO_RESERVA_V1: libroBase(data) }); c.window = c;
    // Mismo orden relativo que panel.html; la fuente ya entrega semántica del worker.
    for (const file of ['haiku-libro-semantica-v1', 'haiku-fullday-tarifa-v1', 'haiku-libro-pagos-canon-v1', 'haiku-libro-lenguaje-natural-v1',
        'haiku-libro-pagos-destinos-v1', 'haiku-libro-consultas-v1', 'haiku-libro-cancelaciones-v1', 'haiku-libro-bloqueos-v1'])
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js', file + '.js'), 'utf8'), c);
    return c;
}
module.exports = { ahora, consulta, copy, origen, reserva, estadia, pago, pagoH, servicio, servicioH, casos, caso, cliente, libroBase, web };
