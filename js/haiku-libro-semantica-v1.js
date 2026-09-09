/* Libro: pure, read-only interpretation. Every inference retains its source. */
(function (root) {
    "use strict";
    const normalizar = v => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const digitos = v => String(v || "").replace(/\D/g, "");
    function iso(y, m, d) {
        const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
        return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d) ? date.toISOString().slice(0, 10) : null;
    }
    const sumarDias = (fecha, dias) => new Date(Date.parse(fecha + "T12:00:00Z") + dias * 86400000).toISOString().slice(0, 10);
    function fechaTexto(v) {
        const m = String(v || "").match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/);
        return m ? iso(m[3].length === 2 ? 2000 + Number(m[3]) : m[3], m[2], m[1]) : null;
    }
    function direccion(r, c) {
        let col = "";
        for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) col = String.fromCharCode(65 + (n - 1) % 26) + col;
        return col + (r + 1);
    }
    function color(c) {
        if (!c || c.auto) return null;
        const indexed = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF"];
        const base = c.rgb?.slice(-6).toUpperCase() || (Number.isInteger(c.indexed) && c.indexed < 16 ? indexed[c.indexed % 8] : null);
        // Theme colors require the workbook theme. Unknown is safer than guessing.
        return c.tint ? null : base;
    }
    function fuente(cell, estilos) {
        const estilo = estilos[cell?.estiloId] || {};
        const runs = cell?.runs?.length ? cell.runs : [{ texto: cell?.valor || "", font: estilo.font }];
        const fragmentos = runs.map(run => ({ texto: run.texto, color: color(run.font?.color || estilo.font?.color) }));
        const principales = new Set(fragmentos.filter(x => /\S/.test(x.texto) && ["000000", "FFFFFF", "0000FF"].includes(x.color)).map(x => x.color));
        const estado = principales.size === 1 ? ({ "000000": "sin_checkin", "FFFFFF": "hospedada", "0000FF": "checked_out" })[[...principales][0]] : "no_determinado";
        return { estado, fondo: color(estilo.fill?.fgColor), fragmentos,
            notas: fragmentos.filter(x => x.color === "FF0000" && x.texto.trim()).map(x => x.texto.trim()),
            pendientes: fragmentos.filter(x => x.color === "FFFF00" && x.texto.trim()).map(x => x.texto.trim()) };
    }
    function titular(texto) {
        const partes = String(texto || "").split(/\s*\/\/\s*|\n/).map(x => x.trim()).filter(Boolean);
        const candidato = partes.find(x => !/^(full\s*day|promo\b|voucher\b|lista arcoiris|booking\b)/.test(normalizar(x)));
        return candidato && /^[\p{L}][\p{L}\s.'’()-]+$/u.test(candidato) && candidato.split(/\s+/).length >= 2 ? candidato : null;
    }
    function mismaPersona(a, b) {
        const na = normalizar(a).replace(/[^a-z0-9 ]/g, ""), nb = normalizar(b).replace(/[^a-z0-9 ]/g, "");
        return !!na && !!nb && na === nb;
    }
    function monto(v) {
        if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? v : null;
        let t = String(v || "").replace(/CLP|\$|\s/gi, "");
        if (/^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, "");
        return /^\d+$/.test(t) ? Number(t) : null;
    }
    function servicios(texto) {
        const salida = [];
        for (const parte of String(texto || "").split(/\/\/|\n|;/)) {
            const t = normalizar(parte);
            for (const [tipo, re] of [["jacuzzi", /jacuzzi/], ["tonel", /tonel/], ["tinaja", /tinaja/], ["lateout", /late\s*(check\s*)?out/], ["cama_adicional", /cama.*adicional/], ["cuna", /\bcuna\b/], ["masaje", /masaj/]]) {
                if (!re.test(t)) continue;
                const hora = t.match(/\b([0-2]?\d)[:.,]([0-5]\d)\b/);
                salida.push({ concepto: tipo, texto_original: parte.trim(), pendiente: /\bx pagar\b|por pagar|pendiente/.test(t),
                    cortesia: /cortesia|regalo/.test(t), hora: hora ? `${hora[1].padStart(2, "0")}:${hora[2]}` : null, monto: null });
            }
        }
        return salida;
    }
    function aseo(cell, fecha, cabana, origen) {
        const partes = cell.valor.split(/\/\/|\n/).map(x => x.trim()).filter(Boolean);
        const dato = regex => { const m = cell.valor.match(regex); return m && !/\?|camarero|tiempos/i.test(m[1]) ? m[1].trim() : null; };
        const horas = cell.valor.match(/\b(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})\b/);
        return { fecha, cabana, checkout_por: dato(/check\s*out\s+([^/\n]+)/i), camarero: partes[1] && !/camarero|\?/.test(normalizar(partes[1])) ? partes[1] : null,
            hora_inicio: horas ? `${horas[1].padStart(2, "0")}:${horas[2]}` : null, hora_fin: horas ? `${horas[3].padStart(2, "0")}:${horas[4]}` : null,
            ingreso: dato(/\bIN\s+([^/\n]+)/i), revisado_por: dato(/\bCheck\s+(?!out\b)([^/\n]+)/i), texto_original: cell.valor, origen };
    }
    function normalizarHoja(data, hoja) {
        const cells = data.celdas || [], estilos = data.estilos || [], merges = data.combinaciones || [];
        const map = new Map(cells.map(c => [`${c.r}:${c.c}`, c]));
        const at = (r, c) => map.get(`${r}:${c}`);
        const origen = c => ({ hoja, celda: direccion(c.r, c.c), fila: c.r + 1, columna: c.c + 1,
            merge: merges.find(m => m.s.r === c.r && m.s.c === c.c) || null });
        const res = { hoja, reservas: [], pagos: [], aseos: [], espacios: [], anotaciones: [], advertencias: [], cobertura: { geometria: false, pagos: false }, fechas: [] };
        const cabCells = cells.filter(c => /^caba(?:n|ñ)a\s*\d+$/i.test(normalizar(c.valor)));
        const marker = cells.filter(c => /pagos de arriendos de hoy/.test(normalizar(c.valor)));
        const financialRow = marker.length ? Math.min(...marker.map(c => c.r)) : Infinity;
        const cabRows = cabCells.filter(c => c.r < financialRow && c.c === Math.min(...cabCells.map(x => x.c)));
        const firstCab = Math.min(...cabRows.map(c => c.r));
        // Only typed date cells above the reservation grid are date headers.
        const headerDates = cells.filter(c => c.fechaISO && c.r < firstCab);
        const rows = [...new Set(headerDates.map(c => c.r))];
        const bestRow = rows.sort((a, b) => headerDates.filter(c => c.r === b).length - headerDates.filter(c => c.r === a).length)[0];
        const headers = headerDates.filter(c => c.r === bestRow).sort((a, b) => a.c - b.c);
        if (!headers.length || !cabRows.length || !Number.isFinite(financialRow)) {
            res.advertencias.push("Estructura mensual no reconocida: sólo se ofrecen coincidencias textuales con coordenadas, sin asignar reservas ni pagos.");
            res.anotaciones = cells.filter(c => c.valor?.trim()).map(c => ({ texto_original: c.valor, origen: origen(c) }));
            return res;
        }
        if (new Set(headers.map(c => c.fechaISO)).size !== headers.length || headers.some((h, i) => i && h.fechaISO <= headers[i - 1].fechaISO)) {
            res.advertencias.push("Fechas duplicadas o desordenadas: no se interpreta automáticamente esta hoja."); return res;
        }
        res.fechas = headers.map(c => c.fechaISO);
        res.cobertura.geometria = true;
        const paymentCabs = cabCells.filter(c => c.r > financialRow).sort((a, b) => a.r - b.r);
        res.cobertura.pagos = paymentCabs.length === cabRows.length;
        for (const cab of cabRows) {
            const cabana = Number(cab.valor.match(/\d+/)[0]);
            for (let i = 0; i < headers.length; i++) {
                const h = headers[i], cell = at(cab.r, h.c), cleaning = at(cab.r, h.c - 1);
                if (cleaning?.valor && /check\s*out/i.test(cleaning.valor)) res.aseos.push(aseo(cleaning, h.fechaISO, cabana, origen(cleaning)));
                if (!cell?.valor.trim()) {
                    const ocupado = merges.some(m => m.s.r === cab.r && m.s.c < h.c && m.e.c >= h.c && at(m.s.r, m.s.c)?.valor.trim());
                    if (!ocupado) res.espacios.push({ fecha: h.fechaISO, cabana, estado: "sin_dato", origen: { hoja, celda: direccion(cab.r, h.c) } });
                    continue;
                }
                const t = normalizar(cell.valor);
                if (/^(libre|full\s*day)$/.test(t) || /mantencion|mantenimiento|bloquead/.test(t)) {
                    res.espacios.push({ fecha: h.fechaISO, cabana, estado: t === "libre" ? "libre_explicito" : "bloque_o_marca", texto_original: cell.valor, origen: origen(cell) }); continue;
                }
                const nombre = titular(cell.valor);
                if (!nombre) { res.anotaciones.push({ texto_original: cell.valor, origen: origen(cell), fecha: h.fechaISO, cabana }); continue; }
                const src = origen(cell), merge = src.merge;
                const dias = headers.filter(d => d.c >= h.c && d.c <= (merge?.e.c ?? h.c)).map(d => d.fechaISO);
                const fd = /full\s*day/.test(t);
                const nochesTexto = t.match(/\b(\d+)\s*noches?\b/);
                const noches = fd ? 0 : dias.length;
                const dudas = [];
                if (nochesTexto && Number(nochesTexto[1]) !== noches) dudas.push("Las noches escritas no coinciden con las fechas combinadas; confirmar ingreso/salida.");
                const colors = fuente(cell, estilos);
                const correo = cell.valor.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] || null;
                const telefono = cell.valor.match(/\+\d[\d ()-]{7,}\d/)?.[0]?.trim() || null;
                const documento = cell.valor.match(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b|\b[A-Z]{2,3}\d{5,}\b/)?.[0] || null;
                const cantidad = re => { const m = t.match(re); return m ? Number(m[1]) : null; };
                const partes = cell.valor.split(/\/\/|\n/).map(x => x.trim());
                const fechaRegistro = partes.map(fechaTexto).filter(Boolean).at(-1) || null;
                const pendientesTexto = partes.filter(x => /\bx pagar\b|por pagar/i.test(x));
                res.reservas.push({ id: `${hoja}!${src.celda}`, hoja, cabana, titular: nombre, fecha_checkin: h.fechaISO,
                    fecha_checkout: fd ? h.fechaISO : sumarDias(dias.at(-1), 1), fechas_ocupadas: dias, noches, noches_texto: nochesTexto ? Number(nochesTexto[1]) : null,
                    tipo_estadia: fd ? "full_day" : "alojamiento", rut_documento: documento, correo, telefono,
                    adultos: cantidad(/\b(\d+)\s*a(?:dl|dlt|dult|ldt)/), ninos: cantidad(/\b(\d+)\s*(?:chld|nin)/), mascotas: cantidad(/\b(\d+)\s*mascota/),
                    operador: partes.find(x => /^[A-Z]{2,4}$/.test(x)) || null, fecha_ingreso_libro: fechaRegistro,
                    estado_confirmacion: ["B4A7D6", "D9D2E9"].includes(colors.fondo) ? "confirmada_por_color" : ["D5A6BD", "F4CCCC", "EAD1DC"].includes(colors.fondo) ? "pendiente_por_color" : "no_determinado",
                    estado_operativo: colors.estado, notas_importantes: colors.notas, pagos_pendientes: [...new Set([...colors.pendientes, ...pendientesTexto])],
                    servicios: servicios(cell.valor), texto_original: cell.valor, coordenadas_origen: src, formato: colors, advertencias: dudas, pagos: [], pagos_sin_asociacion: [], cobertura_pagos: false });
            }
        }
        for (let k = 0; k < paymentCabs.length; k++) {
            const cab = paymentCabs[k], cabana = Number(cab.valor.match(/\d+/)[0]);
            const mergeCab = merges.find(m => m.s.r === cab.r && m.s.c === cab.c);
            const end = mergeCab?.e.r ?? (paymentCabs[k + 1]?.r - 1);
            if (!Number.isInteger(end)) continue;
            for (let i = 0; i < headers.length; i++) {
                const h = headers[i];
                // Financial blocks are explicitly labelled and consist of date, detail, concept, amount.
                const mark = marker.find(m => m.c === h.c);
                // Algunos días conservan la banda combinada, pero borraron su título.
                // Recuperar sólo dentro de la geometría financiera conocida; nunca
                // tratar una región cualquiera o un título distinto como pagos.
                const bandaSinTitulo = res.cobertura.pagos && !at(financialRow, h.c)?.valor?.trim() &&
                    merges.some(m => m.s.r === financialRow && m.e.r === financialRow && m.s.c === h.c && m.e.c === h.c + 3);
                if ((!mark && !bandaSinTitulo) || (headers[i + 1] && headers[i + 1].c - h.c !== 4)) continue;
                for (let r = cab.r; r <= end; r++) {
                    const detail = at(r, h.c + 1), concept = at(r, h.c + 2), amount = at(r, h.c + 3);
                    if (!detail?.valor.trim() && !concept?.valor.trim() && !amount?.valor.trim()) continue;
                    const text = [detail?.valor, concept?.valor].filter(Boolean).join(" // ");
                    const t = normalizar(text), c = normalizar(concept?.valor);
                    const ref = re => text.match(re)?.[1]?.trim() || null;
                    const kind = /penalidad/.test(t) ? "penalidad" : /^(cab\s*\d|alojamiento|arriendo)/.test(c) ? "alojamiento" : servicios(concept?.valor).length || /masaj|lena|carbon|desayuno/.test(c) ? "servicio" : "otro";
                    const pending = /web\s*pay.{0,25}(?:por|x)\s*confirmar/.test(t) ? "por_confirmar" : /(?:por|x) pagar|saldo pendiente/.test(t) ? "pendiente" : "registrado_en_libro";
                    const money = monto(amount?.valorNumero ?? amount?.valor);
                    if (!mark && (!at(r, h.c)?.fechaISO || !titular(detail?.valor) || !(money > 0) || !c)) continue;
                    const cabanaConcepto = Number(c.match(/^cab\s*(\d+)\b/)?.[1]) || null;
                    const advertencias = [];
                    if (!mark) advertencias.push('El bloque del Check-In conserva su estructura, pero falta el encabezado de pagos; requiere revisión.');
                    if (!mark && cabanaConcepto && cabanaConcepto !== cabana) advertencias.push(`El concepto del Libro indica CAB ${cabanaConcepto}, mientras la estadía y el bloque corresponden a CAB ${cabana}.`);
                    const p = { fecha_bloque: h.fechaISO, fecha_comprobante: at(r, h.c)?.fechaISO || null, cabana, titular: titular(detail?.valor),
                        monto: money, moneda: "CLP", medio_pago: /web\s*pay/.test(t) ? "webpay" : /transf/.test(t) ? "transferencia" : /debito/.test(t) ? "debito" : /credito/.test(t) ? "credito" : /efectivo/.test(t) ? "efectivo" : null,
                        codigo_autorizacion: ref(/(?:cod\.?\s*aut\.?|aut)\s*:?\s*([\w]+)/i), folio: ref(/folio\s*:?\s*(\d+)/i), bovtar: ref(/bovtar\s*:?\s*(\d+)/i),
                        bove: ref(/bove\s*:\s*([\d.,]+)/i)?.replace(/[.,]/g, "") || null,
                        bove_pendiente: /pend[^/]{0,35}bove/.test(t), manager_pendiente: /pend[^/]{0,45}manager/.test(t),
                        penalidad_porcentaje: /penalidad/.test(t) ? Number(t.match(/(\d+)\s*%/)?.[1]) || null : null,
                        monto_penalidad: /penalidad/.test(t) ? monto(t.match(/([\d.,]+)\s+de penalidad/)?.[1]) : null,
                        saldo_por_pagar: monto(t.match(/por pagar\s*\$\s*([\d.,]+)/)?.[1]),
                        concepto: concept?.valor || null, tipo_movimiento: /early\s*(check\s*)?in/.test(c) ? 'servicio' : kind, estado_pago: pending,
                        ...(advertencias.length ? { advertencias } : {}),
                        pago_recibido: money !== null && pending === "registrado_en_libro" && kind !== "penalidad" ? true : null,
                        texto_original: [at(r, h.c)?.valor, text, amount?.valor].filter(Boolean).join(" // "), origen: { hoja, celda: `${direccion(r, h.c)}:${direccion(r, h.c + 3)}` } };
                    res.pagos.push(p);
                }
            }
        }
        for (const r of res.reservas) {
            const candidates = res.pagos.filter(p => p.fecha_bloque === r.fecha_checkin && p.cabana === r.cabana);
            const others = res.reservas.filter(x => x.cabana === r.cabana && x.fecha_checkin === r.fecha_checkin);
            r.cobertura_pagos = res.cobertura.pagos && marker.some(m => headers.find(h => h.fechaISO === r.fecha_checkin)?.c === m.c);
            for (const p of candidates) {
                if (others.length === 1 && mismaPersona(r.titular, p.titular) && !r.advertencias.length && !p.advertencias?.length) r.pagos.push(p);
                else r.pagos_sin_asociacion.push(p);
            }
        }
        const lastCab = Math.max(...cabRows.map(c => c.r));
        res.anotaciones.push(...cells.filter(c => c.r > lastCab && c.r < financialRow && c.valor?.trim()).map(c => ({ texto_original: c.valor, origen: origen(c) })));
        return res;
    }
    function asociar(reserva, candidatas) {
        const scores = candidatas.map(s => {
            const nombre = mismaPersona(reserva.titular, s.titular);
            const doc = reserva.rut_documento && s.rut_documento && normalizar(reserva.rut_documento).replace(/[.-]/g, "") === normalizar(s.rut_documento).replace(/[.-]/g, "");
            const correo = reserva.correo && s.correo && normalizar(reserva.correo) === normalizar(s.correo);
            const telefono = reserva.telefono && s.telefono && digitos(reserva.telefono) === digitos(s.telefono);
            const fechas = reserva.fecha_checkin === s.fecha_checkin && reserva.fecha_checkout === s.fecha_checkout;
            const cab = reserva.cabana === Number(s.cabana);
            const fuerte = !!doc || (!!correo && !!telefono);
            const conflictoDocumento = reserva.rut_documento && s.rut_documento && !doc;
            return { s, segura: !conflictoDocumento && !reserva.advertencias?.length && ((nombre && fechas && cab) || (fuerte && (fechas || cab))), posible: nombre || fuerte || (fechas && cab) };
        });
        const seguros = scores.filter(x => x.segura);
        return seguros.length === 1 ? { estado: "asociada", sistema: seguros[0].s } : { estado: scores.some(x => x.posible) ? "ambigua" : "sin_coincidencia", candidatos: scores.filter(x => x.posible).map(x => x.s.id) };
    }
    // Version comparison is pure. Coordinates are provenance, never identity.
    const canonIdVersion = v => normalizar(v).replace(/[^a-z0-9]/g, "");
    const senalesVersion = r => [canonIdVersion(r.rut_documento), normalizar(r.correo), digitos(r.telefono)];
    const fechasVersion = (a, b) => a.fecha_checkin === b.fecha_checkin && a.fecha_checkout === b.fecha_checkout && a.tipo_estadia === b.tipo_estadia;
    function identidadVersion(a, b) {
        const x = senalesVersion(a), y = senalesVersion(b);
        return { nombre: mismaPersona(a.titular, b.titular),
            documentoConflictivo: !!(x[0] && y[0] && x[0] !== y[0]),
            conflicto: x.some((v, i) => v && y[i] && v !== y[i]),
            fuerte: x.some((v, i) => v && v === y[i] && (i !== 2 || v.length >= 9)) };
    }
    function componentesVersion(items, relacionados) {
        const pendientes = new Set(items), grupos = [];
        while (pendientes.size) {
            const cola = [pendientes.values().next().value]; pendientes.delete(cola[0]);
            for (let i = 0; i < cola.length; i++) for (const r of pendientes) {
                if (relacionados(cola[i], r)) { pendientes.delete(r); cola.push(r); }
            }
            grupos.push(cola);
        }
        return grupos;
    }
    function agruparVersion(reservas) {
        const compatibles = (a, b) => {
            const i = identidadVersion(a, b), docA = senalesVersion(a)[0], docB = senalesVersion(b)[0];
            return i.nombre && fechasVersion(a, b) && !i.documentoConflictivo && (!i.conflicto || (docA && docA === docB));
        };
        return componentesVersion(reservas || [], compatibles).map(filas => {
            const cabanas = [...new Set(filas.map(r => Number(r.cabana)))].sort((a, b) => a - b);
            const revision = cabanas.length !== filas.length || filas.some(r => !r.titular || !r.fecha_checkin || !r.fecha_checkout || !Number(r.cabana) || r.advertencias?.length) ||
                filas.some(a => filas.some(b => !compatibles(a, b)));
            return { ...filas[0], filas, cabanas, revision,
                pagos: filas.flatMap(r => r.pagos || []), pagos_sin_asociacion: filas.flatMap(r => r.pagos_sin_asociacion || []),
                cobertura_pagos: filas.every(r => r.cobertura_pagos === true),
                origenes: filas.map(r => r.coordenadas_origen).filter(Boolean) };
        });
    }
    function idsPagoVersion(p) {
        const ids = [];
        if (canonIdVersion(p.codigo_autorizacion)) ids.push('aut:' + canonIdVersion(p.codigo_autorizacion));
        if (canonIdVersion(p.folio) && canonIdVersion(p.bovtar)) ids.push('folio:' + canonIdVersion(p.folio) + ':' + canonIdVersion(p.bovtar));
        return ids;
    }
    const pagoVersion = p => JSON.stringify([p.monto ?? null, p.moneda || 'CLP', normalizar(p.concepto), p.tipo_movimiento || null,
        p.estado_pago || null, p.medio_pago || null, p.fecha_comprobante || null, !!p.bove_pendiente, !!p.manager_pendiente,
        p.saldo_por_pagar ?? null, p.monto_penalidad ?? null, p.penalidad_porcentaje ?? null, idsPagoVersion(p),
        normalizar(p.texto_original), canonIdVersion(p.folio), canonIdVersion(p.bovtar)]);
    function compararPagosVersion(a, b, idsConflictivos) {
        // Candidate movements remain read-only: strong identity can verify them
        // across books, but never changes their association for incorporation.
        const pool = g => [...new Set([...g.pagos, ...g.pagos_sin_asociacion])];
        const diferencias = [], resueltos = new Set(), todos = [...pool(a).map(p => ({ p, lado: 0 })), ...pool(b).map(p => ({ p, lado: 1 }))].filter(x => idsPagoVersion(x.p).length);
        const componentes = componentesVersion(todos, (x, y) => idsPagoVersion(x.p).some(id => idsPagoVersion(y.p).includes(id)));
        for (const grupo of componentes) {
            const movimientos = new Set(grupo.map(x => x.lado + ':' + pagoVersion(x.p))).size;
            const prev = grupo.filter(x => x.lado === 0), next = grupo.filter(x => x.lado === 1);
            const p = (next[0] || prev[0]).p;
            const ids = idsPagoVersion(p);
            const conflicto = grupo.some(x => idsPagoVersion(x.p).some(id => idsConflictivos.has(id))) ||
                [prev, next].some(xs => new Set(xs.map(x => pagoVersion(x.p))).size > 1);
            if (!ids.length || conflicto) {
                diferencias.push({ campo: 'pagos', tipo: 'pago_revision', movimientos, detalle: 'No se puede asociar de forma inequívoca entre versiones: identificador compartido o conflictivo.', pago: p });
            } else if (prev.length && next.length) {
                const anterior = prev[0].p, actual = next[0].p;
                const id = idsPagoVersion(anterior).find(id => idsPagoVersion(actual).includes(id));
                if (!id) {
                    diferencias.push({ campo: 'pagos', tipo: 'pago_revision', movimientos, detalle: 'Los identificadores no permiten una coincidencia directa única.', pago: p });
                    continue;
                }
                grupo.forEach(x => resueltos.add(x.p));
                const verificacion = 'Verificado por ' + ({ aut: 'CodAut', folio: 'Folio+BOVTAR' })[id.split(':')[0]];
                const campos = ['monto', 'moneda', 'concepto', 'tipo_movimiento', 'medio_pago', 'estado_pago', 'fecha_comprobante',
                    'bove_pendiente', 'manager_pendiente', 'saldo_por_pagar', 'monto_penalidad', 'penalidad_porcentaje',
                    'codigo_autorizacion', 'folio', 'bovtar', 'bove'];
                const valor = (p, k) => ['codigo_autorizacion', 'folio', 'bovtar', 'bove'].includes(k) ? canonIdVersion(p[k]) :
                    k === 'moneda' ? normalizar(p[k] || 'CLP') : k.endsWith('_pendiente') ? !!p[k] : normalizar(p[k]);
                const campos_cambiados = campos.filter(k => valor(anterior, k) !== valor(actual, k));
                const completo = [anterior, actual].every(p => Number.isFinite(p.monto) && normalizar(p.concepto));
                const referencias = id.startsWith('folio:') ? `Folio ${actual.folio} · BOVTAR ${actual.bovtar}` : `CodAut ${actual.codigo_autorizacion}`;
                diferencias.push({ campo: 'pagos', tipo: campos_cambiados.length ? 'pago_modificado' : completo ? 'pago_sin_cambios' : 'pago_revision',
                    detalle: campos_cambiados.length ? 'Pago identificado, pero cambió ' + campos_cambiados.join(', ') : completo ?
                        `Pago verificado sin cambios · ${actual.moneda && actual.moneda !== 'CLP' ? actual.moneda + ' ' : '$'}${actual.monto.toLocaleString('es-CL')} · ${referencias}` :
                        'Pago identificado; falta monto o concepto para verificar si cambió.',
                    verificacion, confianza: 'alta', campos_cambiados, anterior, actual, pago: actual });
            } else if (!a.cobertura_pagos || !b.cobertura_pagos || a.pagos_sin_asociacion.length || b.pagos_sin_asociacion.length) {
                diferencias.push({ campo: 'pagos', tipo: 'pago_revision', detalle: 'La cobertura o asociación de pagos es incompleta; requiere revisión.', pago: p });
            } else diferencias.push({ campo: 'pagos', tipo: next.length ? 'pago_agregado' : 'pago_eliminado', pago: p });
        }
        // Weak payments never compete with strong identifiers. Match only inside the
        // same holder, stay and check-in block; coordinates are not matching evidence.
        const debilesA = a.pagos.filter(p => !idsPagoVersion(p).length), debilesB = b.pagos.filter(p => !idsPagoVersion(p).length);
        const contexto = (p, q) => fechasVersion(a, b) && mismaPersona(a.titular, b.titular) &&
            mismaPersona(p.titular, a.titular) && mismaPersona(q.titular, b.titular) &&
            !!p.fecha_bloque && p.fecha_bloque === q.fecha_bloque && p.fecha_bloque === a.fecha_checkin &&
            !!Number(p.cabana) && Number(p.cabana) === Number(q.cabana);
        const mejor = (p, pool) => {
            const candidatos = pool.filter(q => contexto(p, q));
            const exactos = candidatos.filter(q => pagoVersion(p) === pagoVersion(q));
            const mejores = exactos.length ? exactos : candidatos;
            return mejores.length === 1 ? mejores[0] : null;
        };
        const usados = new Set();
        for (const p of debilesA) {
            const q = mejor(p, debilesB);
            if (!q || mejor(q, debilesA) !== p) {
                diferencias.push({ campo: 'pagos', tipo: 'pago_revision', detalle: 'No se puede asociar de forma inequívoca entre versiones', verificacion: 'Coincidencia débil', lado: 0, pago: p });
                continue;
            }
            usados.add(q);
            const completo = [p, q].every(x => Number.isFinite(x.monto) && x.moneda && x.concepto && x.tipo_movimiento && normalizar(x.texto_original));
            const igual = pagoVersion(p) === pagoVersion(q);
            diferencias.push({ campo: 'pagos', tipo: igual && completo ? 'sin_cambios_aparentes' : igual ? 'pago_revision' : 'pago_modificado',
                detalle: igual && completo ? 'Sin cambios aparentes en el pago' : igual ? 'No se puede asociar de forma inequívoca entre versiones' : 'Pago modificado.',
                nota: igual && completo ? 'Identificación débil: no posee CodAut/Folio+Bovtar/BOVE para validación inequívoca.' : undefined,
                verificacion: 'Coincidencia débil', anterior: p, actual: q, pago: q });
        }
        for (const p of debilesB.filter(p => !usados.has(p))) diferencias.push({ campo: 'pagos', tipo: 'pago_revision',
            detalle: 'No se puede asociar de forma inequívoca entre versiones', verificacion: 'Coincidencia débil', lado: 1, pago: p });
        for (const [lado, g] of [[0, a], [1, b]]) for (const p of g.pagos_sin_asociacion.filter(p => !resueltos.has(p) && !idsPagoVersion(p).length)) {
            diferencias.push({ campo: 'pagos', tipo: 'pago_revision', detalle: 'Movimiento sin asociación inequívoca con la reserva.', verificacion: 'Coincidencia débil', lado, pago: p });
        }
        if (!a.cobertura_pagos || !b.cobertura_pagos) {
            diferencias.push({ campo: 'pagos', tipo: 'pago_revision', cobertura: true, detalle: 'La lectura de pagos está incompleta en una de las versiones; revisar la cobertura.' });
        }
        return diferencias;
    }
    function resumenPagosVersion(resultados) {
        const pagos = resultados.filter(d => d.campo === 'pagos');
        const verificados = pagos.filter(d => d.tipo === 'pago_sin_cambios').length;
        const modificados = pagos.filter(d => d.tipo === 'pago_modificado' && d.confianza === 'alta').length;
        const debiles = pagos.filter(d => d.verificacion === 'Coincidencia débil' && d.anterior && d.actual && d.tipo !== 'pago_revision').length;
        const revision = pagos.filter(d => d.tipo === 'pago_revision' && !d.cobertura);
        // Unmatched observations on each side are counted separately: no implied pairing.
        const pendientes = revision.length;
        const partes = [];
        if (verificados) partes.push(`${verificados} ${verificados === 1 ? 'pago verificado' : 'pagos verificados'} sin cambios`);
        if (modificados) partes.push(`${modificados} ${modificados === 1 ? 'pago identificado' : 'pagos identificados'} con cambios`);
        if (debiles) partes.push(`${debiles} ${debiles === 1 ? 'coincidencia débil' : 'coincidencias débiles'}`);
        if (pendientes) partes.push(`${pendientes} ${pendientes === 1 ? 'requiere' : 'requieren'} revisión`);
        if (pagos.some(d => d.cobertura)) partes.push('cobertura de lectura incompleta');
        const asociados = pagos.some(d => d.anterior && d.actual);
        if (!asociados && pagos.some(d => d.pago)) {
            const movimientos = pagos.filter(d => d.pago).reduce((n, d) => n + (d.movimientos || 1), 0);
            return `Haku encontró ${movimientos} movimientos de pago, pero no pudo emparejarlos de forma inequívoca entre ambas versiones.`;
        }
        return partes.join(' · ');
    }
    function diferenciasVersion(a, b, idsConflictivos) {
        const dif = [];
        for (const cab of b.cabanas.filter(c => !a.cabanas.includes(c))) dif.push({ campo: 'cabanas', tipo: 'cabana_agregada', cabana: cab });
        for (const cab of a.cabanas.filter(c => !b.cabanas.includes(c))) dif.push({ campo: 'cabanas', tipo: 'cabana_eliminada', cabana: cab });
        const canon = (k, v) => k === 'rut_documento' ? canonIdVersion(v) : k === 'telefono' ? digitos(v) :
            Array.isArray(v) ? [...new Set(v.map(x => typeof x === 'object' ? JSON.stringify(x) : normalizar(x)))].sort() : typeof v === 'string' ? normalizar(v) : v ?? null;
        for (const campo of ['fecha_checkin', 'fecha_checkout', 'tipo_estadia', 'rut_documento', 'correo', 'telefono', 'adultos', 'ninos', 'mascotas',
            'estado_confirmacion', 'estado_operativo', 'notas_importantes', 'pagos_pendientes', 'servicios', 'operador', 'fecha_ingreso_libro']) {
            const pares = a.cabanas.filter(c => b.cabanas.includes(c)).map(c => [a.filas.find(r => Number(r.cabana) === c), b.filas.find(r => Number(r.cabana) === c)]);
            // If all cabins changed, compare the distinct values without inventing a row pairing.
            if (!pares.length) {
                const valores = g => [...new Set(g.filas.map(r => JSON.stringify(canon(campo, r[campo]))))].sort();
                if (JSON.stringify(valores(a)) !== JSON.stringify(valores(b))) dif.push({ campo, anterior: a.filas.map(r => r[campo]), actual: b.filas.map(r => r[campo]) });
            } else for (const [x, y] of pares) if (JSON.stringify(canon(campo, x[campo])) !== JSON.stringify(canon(campo, y[campo]))) {
                const existente = dif.find(d => d.campo === campo && JSON.stringify(d.anterior) === JSON.stringify(x[campo]) && JSON.stringify(d.actual) === JSON.stringify(y[campo]));
                if (!existente) dif.push({ campo, anterior: x[campo], actual: y[campo], cabana: x.cabana });
            }
        }
        // Text may contain an unparsed note even when another structured field also changes.
        {
            const comunes = a.cabanas.filter(c => b.cabanas.includes(c));
            for (const cab of comunes) {
                const x = a.filas.find(r => Number(r.cabana) === cab), y = b.filas.find(r => Number(r.cabana) === cab);
                if (normalizar(x.texto_original) !== normalizar(y.texto_original)) dif.push({ campo: 'notas', anterior: x.texto_original, actual: y.texto_original, cabana: cab,
                    detalle: 'Cambió el texto de la reserva; revisa las notas anteriores y actuales.' });
            }
        }
        return dif.concat(compararPagosVersion(a, b, idsConflictivos));
    }
    function compararVersiones(anterior, actual) {
        if (!anterior?.cobertura?.geometria || !actual?.cobertura?.geometria) return [{ tipo: 'no_comparable', detalle: 'No se reconoció la geometría en ambas versiones.' }];
        const prev = agruparVersion(anterior.reservas), next = agruparVersion(actual.reservas), cambios = [];
        const idsConflictivos = new Set();
        for (const grupos of [prev, next]) {
            const dueños = new Map();
            for (const g of grupos) for (const p of [...g.pagos, ...g.pagos_sin_asociacion]) for (const id of idsPagoVersion(p)) {
                if (dueños.has(id) && dueños.get(id) !== g) idsConflictivos.add(id);
                dueños.set(id, g);
            }
        }
        const pendientesA = new Set(prev), pendientesB = new Set(next);
        const relacion = (a, b) => a.filas.some(x => b.filas.some(y => { const i = identidadVersion(x, y); return i.nombre || i.fuerte; }));
        const puntaje = (a, b) => {
            if (a.revision || b.revision) return 0;
            const pares = a.filas.flatMap(x => b.filas.map(y => identidadVersion(x, y)));
            if (pares.some(i => i.documentoConflictivo)) return 0;
            const fuerte = pares.some(i => i.fuerte), nombre = pares.every(i => i.nombre);
            const fechas = fechasVersion(a, b), cab = a.cabanas.some(c => b.cabanas.includes(c));
            if (!nombre && !fuerte) return 0;
            if (!fuerte && pares.some(i => i.conflicto) && !(fechas && cab && pares.every(i => !i.documentoConflictivo) &&
                // A single contact change is a modification; two conflicting contacts are identity uncertainty.
                a.filas.every(x => b.filas.every(y => senalesVersion(x).filter((v, i) => v && senalesVersion(y)[i] && v !== senalesVersion(y)[i]).length <= 1)))) return 0;
            return fuerte ? 10 + Number(fechas) * 2 + Number(cab) : nombre && (fechas || cab) ? 1 + Number(fechas) * 2 + Number(cab) : 0;
        };
        // Mutual unique best matches, resolved in rounds: no greedy row consumption.
        const mejor = (r, pool, reverse) => {
            const scores = [...pool].map(x => ({ x, n: reverse ? puntaje(x, r) : puntaje(r, x) }));
            const max = Math.max(0, ...scores.map(x => x.n)), best = scores.filter(x => x.n === max && max > 0);
            return best.length === 1 ? best[0].x : null;
        };
        let progreso;
        do {
            progreso = false;
            const pares = [...pendientesA].map(a => [a, mejor(a, pendientesB, false)]).filter(([a, b]) => b && mejor(b, pendientesA, true) === a);
            for (const [a, b] of pares) {
                pendientesA.delete(a); pendientesB.delete(b); progreso = true;
                const resultados = diferenciasVersion(a, b, idsConflictivos);
                const sinCambios = d => ['sin_cambios_aparentes', 'pago_sin_cambios'].includes(d.tipo);
                const pagos_sin_cambios = resultados.filter(sinCambios);
                const diferencias = resultados.filter(d => !sinCambios(d));
                const revision = diferencias.some(d => d.tipo === 'pago_revision');
                cambios.push({ tipo: revision ? 'requiere_revision' : diferencias.length ? 'modificada' : 'sin_cambios', anterior: a, actual: b, diferencias, pagos_sin_cambios, resumen_pagos: resumenPagosVersion(resultados), campos: [...new Set(diferencias.map(d => d.campo))] });
            }
        } while (progreso);
        const pendientes = [...pendientesA].map(r => ({ r, lado: 'anterior' })).concat([...pendientesB].map(r => ({ r, lado: 'actual' })));
        // One review case retains both sides without pretending they were matched.
        for (const componente of componentesVersion(pendientes, (x, y) => x.lado !== y.lado && relacion(x.r, y.r))) {
            const a = componente.find(x => x.lado === 'anterior')?.r, b = componente.find(x => x.lado === 'actual')?.r;
            const candidatos = [...new Set(componente.flatMap(x => (x.lado === 'anterior' ? next : prev).filter(y => relacion(x.r, y))))];
            const revision = componente.some(x => x.r.revision) || candidatos.length > 0;
            cambios.push({ tipo: revision ? 'requiere_revision' : a ? 'ya_no_aparece' : 'nueva', anterior: a, actual: b,
                candidatos, detalle: revision ? 'La identidad no permite una asociación única y segura. Revisa las reservas candidatas.' : undefined, diferencias: [] });
        }
        return cambios;
    }
    root.HAIKU_LIBRO_SEMANTICA = Object.freeze({ normalizarHoja, normalizar, iso, sumarDias, fechaTexto, meses, asociar, compararVersiones, mismaPersona, fuente, monto });
    if (typeof module !== "undefined") module.exports = root.HAIKU_LIBRO_SEMANTICA;
})(typeof self !== "undefined" ? self : globalThis);
