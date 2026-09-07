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
                if (!mark || (headers[i + 1] && headers[i + 1].c - h.c !== 4)) continue;
                for (let r = cab.r; r <= end; r++) {
                    const detail = at(r, h.c + 1), concept = at(r, h.c + 2), amount = at(r, h.c + 3);
                    if (!detail?.valor.trim() && !concept?.valor.trim() && !amount?.valor.trim()) continue;
                    const text = [detail?.valor, concept?.valor].filter(Boolean).join(" // ");
                    const t = normalizar(text), c = normalizar(concept?.valor);
                    const ref = re => text.match(re)?.[1]?.trim() || null;
                    const kind = /penalidad/.test(t) ? "penalidad" : /^(cab\s*\d|alojamiento|arriendo)/.test(c) ? "alojamiento" : servicios(concept?.valor).length || /masaj|lena|carbon|desayuno/.test(c) ? "servicio" : "otro";
                    const pending = /web\s*pay.{0,25}(?:por|x)\s*confirmar/.test(t) ? "por_confirmar" : /(?:por|x) pagar|saldo pendiente/.test(t) ? "pendiente" : "registrado_en_libro";
                    const money = monto(amount?.valorNumero ?? amount?.valor);
                    const p = { fecha_bloque: h.fechaISO, fecha_comprobante: at(r, h.c)?.fechaISO || null, cabana, titular: titular(detail?.valor),
                        monto: money, moneda: "CLP", medio_pago: /web\s*pay/.test(t) ? "webpay" : /transf/.test(t) ? "transferencia" : /debito/.test(t) ? "debito" : /credito/.test(t) ? "credito" : /efectivo/.test(t) ? "efectivo" : null,
                        codigo_autorizacion: ref(/(?:cod\.?\s*aut\.?|aut)\s*:?\s*([\w]+)/i), folio: ref(/folio\s*:?\s*(\d+)/i), bovtar: ref(/bovtar\s*:?\s*(\d+)/i),
                        bove: ref(/bove\s*:\s*([\d.,]+)/i)?.replace(/[.,]/g, "") || null,
                        bove_pendiente: /pend[^/]{0,35}bove/.test(t), manager_pendiente: /pend[^/]{0,45}manager/.test(t),
                        penalidad_porcentaje: /penalidad/.test(t) ? Number(t.match(/(\d+)\s*%/)?.[1]) || null : null,
                        monto_penalidad: /penalidad/.test(t) ? monto(t.match(/([\d.,]+)\s+de penalidad/)?.[1]) : null,
                        saldo_por_pagar: monto(t.match(/por pagar\s*\$\s*([\d.,]+)/)?.[1]),
                        concepto: concept?.valor || null, tipo_movimiento: kind, estado_pago: pending,
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
                if (others.length === 1 && mismaPersona(r.titular, p.titular) && !r.advertencias.length) r.pagos.push(p);
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
    function compararVersiones(anterior, actual) {
        if (!anterior.cobertura.geometria || !actual.cobertura.geometria) return [{ tipo: "no_comparable", detalle: "No se reconoció la geometría en ambas versiones." }];
        const cambios = [], usados = new Set();
        for (const r of actual.reservas) {
            let candidates = anterior.reservas.filter(a => mismaPersona(a.titular, r.titular) && (a.fecha_checkin === r.fecha_checkin || a.cabana === r.cabana));
            if (candidates.length !== 1) { cambios.push({ tipo: candidates.length ? "asociacion_ambigua" : "reserva_agregada_o_modificada", actual: r }); continue; }
            const a = candidates[0];
            if (usados.has(a.id)) { cambios.push({ tipo: "asociacion_ambigua", actual: r }); continue; }
            usados.add(a.id);
            const campos = ["cabana", "fecha_checkin", "fecha_checkout", "estado_confirmacion", "estado_operativo", "texto_original", "pagos", "pagos_sin_asociacion"].filter(k => JSON.stringify(a[k]) !== JSON.stringify(r[k]));
            if (campos.length) cambios.push({ tipo: "modificada", campos, anterior: a, actual: r });
        }
        for (const a of anterior.reservas) if (!usados.has(a.id)) cambios.push({ tipo: "ya_no_aparece_o_modificada", anterior: a });
        return cambios;
    }
    root.HAIKU_LIBRO_SEMANTICA = Object.freeze({ normalizarHoja, normalizar, iso, sumarDias, fechaTexto, meses, asociar, compararVersiones, mismaPersona, fuente, monto });
    if (typeof module !== "undefined") module.exports = root.HAIKU_LIBRO_SEMANTICA;
})(typeof self !== "undefined" ? self : globalThis);
