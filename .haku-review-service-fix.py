from pathlib import Path
import hashlib

path = Path('js/haiku-libro-servicios-scope-v2.js')
raw = path.read_bytes()
blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
assert blob == '6efc7ae0d3634f5dcc73edc0b303978c6cac5728', ('La base cambió; no aplicar', blob)
src = raw.decode('utf-8')

def replace_once(old, new):
    global src
    assert src.count(old) == 1, ('Ancla no única', old[:100], src.count(old))
    src = src.replace(old, new, 1)

replace_once('''        if (codigos.size && hora) {
            const mismoHechoBase = activos.filter(x => codigos.has(codigoExistente(x)) &&
                (!item.fecha || x.fecha_servicio === item.fecha) && horaCorta(x.hora_inicio) === hora);''', '''        // Ausencia de hora en el Libro no contradice una hora ya registrada.
        // Sin hora, exigir estadía exacta y un único candidato ANTES de comparar importes.
        if (codigos.size && (hora || estadiaId && !item.resolucionManual)) {
            const mismoHechoBase = activos.filter(x => codigos.has(codigoExistente(x)) &&
                (!item.fecha || x.fecha_servicio === item.fecha) &&
                (hora ? horaCorta(x.hora_inicio) === hora : x.estadia_id === estadiaId));
            if (!hora && mismoHechoBase.length > 1)
                return { estado:'revisar', candidatos:mismoHechoBase,
                    motivo:'Hay varios servicios del mismo tipo en la estadía; falta un horario que los distinga.' };''')

replace_once('''            const evaluados = mismoHechoBase.map(candidato => ({ candidato,
                contradicciones: [...new Set([...contradiccionesExplicitas(candidato, horaFin), ...contradiccionesFinancieras(candidato), ...contradiccionesManual(candidato)])] }));''', r'''            const contradiccionesSinHora = candidato => {
                if (hora) return [];
                const campos = [], monto = importeLibro(item.servicio);
                const importes = importesTexto(item.servicio);
                if (importes.some(x => x == null) || new Set(importes).size > 1 ||
                    monto != null && Number(candidato.total) !== monto) campos.push('monto');
                // Sólo cantidades escritas: no comparar contra el 1 predeterminado del lector.
                const cantidad = normalizar(item.servicio?.texto_original).match(
                    /\b(\d+)\s*(?:horas?|servicios?|tinajas?|jacuzzis?|toneles?|masajes?)\b/);
                if (cantidad && Number(candidato.cantidad) !== Number(cantidad[1])) campos.push('cantidad');
                return campos;
            };
            const evaluados = mismoHechoBase.map(candidato => ({ candidato,
                contradicciones: [...new Set([...contradiccionesExplicitas(candidato, horaFin), ...contradiccionesFinancieras(candidato), ...contradiccionesManual(candidato), ...contradiccionesSinHora(candidato)])] }));''')

replace_once('''                motivo: item.fecha ? "Servicio equivalente único en Proyecto H." : "Servicio equivalente único por reserva, hora e intención financiera; la fecha ausente no se inventa." };''', '''                motivo: !hora ? "Servicio único por reserva, estadía y tipo; horario recuperado de Proyecto H." :
                    item.fecha ? "Servicio equivalente único en Proyecto H." : "Servicio equivalente único por reserva, hora e intención financiera; la fecha ausente no se inventa." };''')

helper = r'''    // Leer el estado del cargo de CADA servicio existente, no el saldo total
    // de la reserva ni un antiguo texto del Libro que diga "por pagar".
    async function anexarFinanzasServiciosRegistrados(items, cliente) {
        const registrados = items.filter(i => i.estado === 'existente' && i.servicio_existente?.id);
        const desconocido = () => ({ estado:'por_verificar', etiqueta:'Pago por verificar' });
        for (const item of registrados) item.finanzas_existente = desconocido();
        if (!registrados.length || root.haikuTienePermiso?.('pagos.ver') !== true) return;
        const ids = [...new Set(registrados.map(i => i.servicio_existente.id))];
        let cargos = [];
        try {
            for (let pagina = 0; pagina < 20; pagina++) {
                let q = cliente.from('vista_estado_cargos').select(
                    'cargo_id,reserva_id,estadia_id,servicio_id,monto,monto_ajustado,aplicado_neto,saldo_cargo,estado,estado_pago'
                ).in('servicio_id', ids);
                if (typeof q.order === 'function') q = q.order('cargo_id');
                const paginado = typeof q.range === 'function';
                const r = await (paginado ? q.range(pagina * 500, pagina * 500 + 499) : q);
                if (r?.error || !Array.isArray(r?.data)) throw Error('No se pudo leer el saldo del servicio');
                cargos.push(...r.data);
                if (!paginado || r.data.length < 500) break;
                if (pagina === 19) throw Error('Lectura financiera incompleta');
            }
            if (cargos.some(c => !c.cargo_id) || new Set(cargos.map(c => c.cargo_id)).size !== cargos.length)
                throw Error('Lectura financiera duplicada o incompleta');
        } catch (_) { return; } // Sin lectura nunca anunciar pagado ni pendiente cero.
        const entero = v => v != null && String(v).trim() !== '' &&
            Number.isSafeInteger(Number(v)) && Number(v) >= 0;
        const dinero = n => '$' + n.toLocaleString('es-CL');
        for (const item of registrados) {
            const s = item.servicio_existente;
            const filas = cargos.filter(c => c.servicio_id === s.id);
            if (filas.some(c => c.reserva_id !== s.reserva_id ||
                s.estadia_id && c.estadia_id !== s.estadia_id ||
                !['activo','anulado'].includes(c.estado))) continue;
            const activos = filas.filter(c => c.estado === 'activo');
            if (!activos.length) {
                item.finanzas_existente = s.tipo_cobro === 'cortesia' && Number(s.total) === 0
                    ? { estado:'cortesia', etiqueta:'Cortesía · sin cobro', saldo:0 }
                    : { estado:'sin_cargo_activo', etiqueta:'Sin cargo activo · revisar finanzas' };
                continue;
            }
            if (activos.length !== 1) continue; // No ocultar cargos duplicados o incoherentes.
            const c = activos[0];
            if (![c.monto,c.monto_ajustado,c.aplicado_neto,c.saldo_cargo].every(entero) ||
                Number(c.monto) !== Number(s.total)) continue;
            const total = Number(c.monto_ajustado), aplicado = Number(c.aplicado_neto), saldo = Number(c.saldo_cargo);
            if (aplicado > total || saldo !== total - aplicado) continue;
            const base = { cargo_id:c.cargo_id, total, aplicado, saldo };
            if (s.tipo_cobro === 'cortesia' && Number(s.total) === 0 && saldo === 0)
                item.finanzas_existente = { ...base, estado:'cortesia', etiqueta:'Cortesía · sin cobro' };
            else if (total === 0)
                item.finanzas_existente = { ...base, estado:'sin_saldo_ajustado', etiqueta:'Sin saldo · cargo ajustado' };
            else if (saldo === 0)
                item.finanzas_existente = { ...base, estado:'pagado', etiqueta:'Pagado ' + dinero(aplicado) + ' · saldo $0' };
            else if (aplicado > 0)
                item.finanzas_existente = { ...base, estado:'parcial', etiqueta:'Pago parcial · pendiente ' + dinero(saldo) };
            else
                item.finanzas_existente = { ...base, estado:'pendiente', etiqueta:'Pendiente ' + dinero(saldo) };
        }
    }

'''
replace_once('    function servicioYaExiste(item, existentes) {', helper + '    function servicioYaExiste(item, existentes) {')
replace_once('        return { ...libro, items, quiereIncorporar: quiereIncorporar(texto) };',
             '        await anexarFinanzasServiciosRegistrados(items, cliente);\n        return { ...libro, items, quiereIncorporar: quiereIncorporar(texto) };')
replace_once('· ${item.cortesia ? "cortesía" : "cobrable"} · omitido`;',
             '· ${item.finanzas_existente?.etiqueta || (item.cortesia ? "cortesía" : "Pago por verificar")} · omitido`;')
path.write_text(src, encoding='utf-8', newline='')
print('Sólo modificado:', path)
