// Escenario exclusivamente sintético: cuatro identidades, dos pagos y dos altas.
const crear = require('./libro-identidad-documento.cjs');
function cliente(f, { conflicto = 1, legado = false } = {}) {
    const calls = [], pagos = [], operaciones = new Map();
    const db = {
        calls, pagos, operaciones, conflicto, red: false, usuario: 'usuario-ficticio', lecturaFallida: false,
        auth: { getSession: async () => ({ data: { session: { user: { id: db.usuario } } } }) },
        from(table) {
            const data = table === 'reserva_estadias' ? f.estadias : table === 'pagos' ? pagos : [];
            const b = { select() { return b; }, lte() { return b; }, gte() { return b; }, in() { return b; },
                order() { return b; }, range(a, z) { if (db.lecturaFallida) throw Error('Lectura interrumpida ficticia'); return Promise.resolve({ data: data.slice(a, z + 1) }); } };
            return b;
        },
        async rpc(name, args) {
            calls.push({ name, args: structuredClone(args) });
            if (db.red) { db.red = false; return { error: { code: 'NETWORK', message: 'Conexión interrumpida ficticia' } }; }
            if (operaciones.has(args.p_operacion_id)) return { data: { ...operaciones.get(args.p_operacion_id), reintento: true } };
            const items = args.p_items || [];
            const fallida = items.find(i => i.tipo === 'reserva_actualizar' && i.reserva_id === 'reserva-ficticia-' + (db.conflicto + 1));
            if (fallida) return { error: legado ? {
                code: '23505', message: 'duplicate key value violates unique constraint "huespedes_documento_uidx"',
                details: 'Documento FICTICIO-PRIVADO'
            } : { code: 'HLI01', message: 'El documento pertenece a otro huésped; requiere revisión manual. No se guardó el lote',
                details: JSON.stringify({ item_id: fallida.item_id, motivo: 'documento_otro_huesped' }) } };
            const data = { ok: true, actualizaciones: 0, pagos_creados: 0, reservas_creadas: 0, omitidos: 0, resultados: [] };
            for (const item of items) {
                if (item.tipo === 'reserva_actualizar') {
                    const stay = f.estadias.find(s => s.id === item.estadia_id);
                    Object.assign(stay.reservas, item.reserva.despues);
                    Object.assign(stay, item.estadia.despues);
                    data.actualizaciones++;
                } else if (item.tipo === 'pago') {
                    const a = item.argumentos;
                    if (pagos.some(p => p.codigo_autorizacion === a.p_codigo_autorizacion)) { data.omitidos++; continue; }
                    pagos.push({ id: 'pago-ficticio-' + (pagos.length + 1), reserva_id: item.reserva_id,
                        monto: a.p_monto, moneda: 'CLP', medio_pago: a.p_medio_pago, fecha_pago: a.p_fecha_pago,
                        codigo_autorizacion: a.p_codigo_autorizacion, estado: 'confirmado', datos_origen: item.datos_origen });
                    data.pagos_creados++;
                } else if (item.tipo === 'reserva_nueva') data.reservas_creadas++;
                data.resultados.push({ tipo: item.tipo, item_id: item.item_id, reserva_id: item.reserva_id });
            }
            operaciones.set(args.p_operacion_id, structuredClone(data));
            return { data };
        }
    };
    return db;
}
module.exports = { crear, cliente };
