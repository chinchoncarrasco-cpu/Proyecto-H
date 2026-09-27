// Adaptador de transporte para pruebas de UI. El SQL se verifica aparte con PGlite.
function crearSupabaseInsumos() {
    const control = { escrituras: [], lecturas: [], canales: [], auth: [], fallar: false, fallarLectura: false, pausa: null, pausaLectura: null };
    const filas = {
        cabanas: Array.from({ length: 11 }, (_, i) => ({ id: 'cab-' + (i + 1), numero: i + 1, activa: true })),
        movimientos_insumos: [], movimientos_insumos_unidades: [], movimientos_insumos_unidades_historial: [], aseos: [], solicitudes: [], checklist_items: [], revisiones_cabana: [], revision_items: []
    };
    const copiar = valor => JSON.parse(JSON.stringify(valor));
    const destinosValidos = ['aseo_full', 'aseo_express', 'venta_huesped'];
    const destinos = fila => {
        const conteo = { aseo_full:0, aseo_express:0, venta_huesped:0, sin_especificar:0 };
        if (fila?.insumo === 'lena') {
            for (const saco of filas.movimientos_insumos_unidades.filter(s => s.movimiento_id === fila.id && !s.anulado_en)) {
                conteo[saco.destino || 'sin_especificar']++;
            }
        } else {
            for (const destino of destinosValidos) conteo[destino] = Number(fila?.['carbon_' + destino] || 0);
            conteo.sin_especificar = Number(fila?.cantidad || 0) - destinosValidos.reduce((n,d) => n + conteo[d],0);
        }
        return conteo;
    };
    const resumen = fila => {
        const sacos = filas.movimientos_insumos_unidades.filter(s => s.movimiento_id === fila.id && !s.anulado_en);
        return { ...fila, cantidad_actual: fila.insumo === 'lena' ? sacos.length : fila.cantidad,
            peso_total_kg: fila.insumo === 'lena' ? Number(sacos.reduce((n,s) => n + Number(s.peso_kg), 0).toPrecision(12)) : null,
            sacos: copiar(sacos), destinos: destinos(fila) };
    };
    const emitir = (tabla, payload = {}) => control.canales.filter(c => !c.removido).forEach(c =>
        c.eventos.filter(e => e.filtro.table === tabla).forEach(e => e.fn({ table: tabla, ...copiar(payload) })));
    const cliente = {
        auth: { onAuthStateChange(fn) { control.auth.push(fn); } },
        from(tabla) {
            const filtros = [];
            let cambio;
            const consulta = {
                select() { return consulta; }, order() { return consulta; }, limit() { return consulta; },
                eq(c, v) { filtros.push(f => f[c] === v); return consulta; },
                neq(c, v) { filtros.push(f => f[c] !== v); return consulta; },
                in(c, v) { filtros.push(f => v.includes(f[c])); return consulta; },
                is(c, v) { filtros.push(f => (f[c] ?? null) === v); return consulta; },
                upsert(valor) { cambio = valor; control.escrituras.push({ tabla, valor: copiar(valor) }); return consulta; },
                insert(valor) { return consulta.upsert(valor); }, update(valor) { return consulta.upsert(valor); },
                async single() {
                    let fila = filas[tabla].find(f => cambio.cabana_id ? f.cabana_id === cambio.cabana_id && f.fecha === cambio.fecha : filtros.every(fn => fn(f)));
                    if (!fila) { fila = { id: 'nuevo-' + filas[tabla].length }; filas[tabla].push(fila); }
                    Object.assign(fila, cambio);
                    return { data: copiar(fila), error: null };
                },
                async maybeSingle() { const respuesta = await consulta; return { ...respuesta, data: respuesta.data[0] || null }; },
                then(resolve, reject) {
                    return (async () => {
                        control.lecturas.push(tabla);
                        const data = copiar((tabla === 'movimientos_insumos_resumen' ? filas.movimientos_insumos.map(resumen) : filas[tabla]).filter(f => filtros.every(fn => fn(f))));
                        if (tabla === 'movimientos_insumos_resumen' && control.pausaLectura) await control.pausaLectura;
                        if (tabla === 'movimientos_insumos_unidades' && control.pausaVerificacion) await control.pausaVerificacion;
                        return { data, error: (tabla === 'movimientos_insumos_resumen' && control.fallarLectura) ||
                            (tabla === 'movimientos_insumos_unidades' && control.fallarVerificacion) ? new Error('Lectura rechazada') : null };
                    })().then(resolve, reject);
                }
            };
            return consulta;
        },
        async rpc(nombre, p) {
            if (!['haiku_reponer_insumo_aseo_v2','haiku_agregar_saco_lena_v2','haiku_anular_saco_lena_v1','haiku_editar_peso_saco_lena_v1'].includes(nombre)) throw Error('RPC inesperada');
            control.escrituras.push({ nombre, p: copiar(p) });
            if (control.pausa) await control.pausa;
            if (control.fallar) return { data: null, error: new Error('Escritura rechazada') };
            if (control.respuestaPerdidaSinCommit) return { data: null, error: new Error('Red interrumpida antes del commit') };
            const carbon = nombre === 'haiku_reponer_insumo_aseo_v2';
            const anular = nombre === 'haiku_anular_saco_lena_v1';
            const editar = nombre === 'haiku_editar_peso_saco_lena_v1';
            const saco = filas.movimientos_insumos_unidades.find(s => s.id === p.p_unidad_id);
            const insumo = carbon ? p.p_insumo : 'lena';
            let fila = anular || editar ? filas.movimientos_insumos.find(f => f.id === saco?.movimiento_id)
                : filas.movimientos_insumos.find(f => f.fecha_operativa === p.p_fecha && f.cabana_id === p.p_cabana_id && f.insumo === insumo);
            if (!anular && !editar && !destinosValidos.includes(p.p_destino) && !(carbon && p.p_destino === 'sin_especificar' && p.p_delta === -1)) return {data:null,error:new Error('Destino inválido')};
            if (carbon && (insumo !== 'carbon' || Number(fila?.cantidad || 0) !== p.p_cantidad_esperada || destinos(fila)[p.p_destino] !== p.p_cantidad_destino_esperada)) return { data: null, error: Object.assign(new Error('Conflicto remoto'),{code:'40001'}) };
            if (carbon && (![-1,1].includes(p.p_delta) || destinos(fila)[p.p_destino] + p.p_delta < 0)) return {data:null,error:new Error('Cantidad incompatible')};
            if (editar && (!saco || saco.anulado_en || fila?.insumo !== 'lena' || !(Number(p.p_peso_kg) > 0))) return { data:null,error:new Error('Saco o peso incompatible') };
            if (editar && saco.version !== p.p_version_esperada) return { data:null,error:Object.assign(new Error('El saco cambió en otro dispositivo'),{code:'40001'}) };
            if (!fila) {
                fila = { id: 'mov-' + (filas.movimientos_insumos.length + 1), fecha_operativa: p.p_fecha, cabana_id: p.p_cabana_id,
                    aseo_id: 'aseo-' + p.p_fecha + '-' + p.p_cabana_id, insumo, unidad: 'unidad', origen: 'aseo', cantidad: carbon ? 0 : null };
                filas.movimientos_insumos.push(fila);
            }
            if (carbon) {
                fila.cantidad += p.p_delta;
                if (p.p_destino !== 'sin_especificar') fila['carbon_' + p.p_destino] = Number(fila['carbon_' + p.p_destino] || 0) + p.p_delta;
            }
            else if (editar) {
                if (Number(saco.peso_kg) !== Number(p.p_peso_kg)) {
                    filas.movimientos_insumos_unidades_historial.push({ saco_id:saco.id,peso_anterior:saco.peso_kg,peso_nuevo:Number(p.p_peso_kg),
                        version_anterior:saco.version,version_nueva:saco.version+1,corregido_por:'operador',corregido_en:new Date().toISOString() });
                    saco.peso_kg=Number(p.p_peso_kg); saco.version++;
                    saco.actualizado_por='operador'; saco.actualizado_en=new Date().toISOString();
                }
            }
            else if (anular) { if (!saco.anulado_en) { saco.anulado_en=new Date().toISOString(); saco.version++; } }
            else if (!saco) filas.movimientos_insumos_unidades.push({ id:p.p_unidad_id, movimiento_id:fila.id,
                peso_kg:Number(p.p_peso_kg), destino:p.p_destino, version:1, creado_en:new Date().toISOString(), anulado_en:null });
            else if (saco.destino !== p.p_destino || saco.movimiento_id !== fila.id || Number(filas.movimientos_insumos_unidades_historial.find(h=>h.saco_id===saco.id && h.version_anterior===1)?.peso_anterior ?? saco.peso_kg) !== Number(p.p_peso_kg)) return { data:null, error:new Error('Identidad de saco incompatible') };
            fila.actualizado_en = new Date().toISOString();
            emitir(carbon ? 'movimientos_insumos' : 'movimientos_insumos_unidades', { new: carbon ? fila : { movimiento_id:fila.id } });
            return { data: copiar(resumen(fila)), error: control.respuestaPerdida ? new Error('Respuesta perdida después del commit') : null };
        },
        channel() {
            const canal = { eventos: [], removido: false,
                on(tipo, filtro, fn) { canal.eventos.push({ filtro, fn }); return canal; },
                subscribe(fn) { canal.estado = fn; queueMicrotask(() => fn('SUBSCRIBED')); return canal; }
            };
            control.canales.push(canal); return canal;
        },
        async removeChannel(canal) { canal.removido = true; canal.estado('CLOSED'); }
    };
    return { cliente, control, filas, emitir };
}
module.exports = { crearSupabaseInsumos };
