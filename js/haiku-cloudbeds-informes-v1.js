/* Cloudbeds · Lectura local de informes y conciliación de evidencias. */
(function (root) {
    "use strict";

    const pdf = root.HAIKU_CLOUDBEDS_PDF_V1 || (typeof module !== "undefined" && require("./haiku-cloudbeds-pdf-v1.js"));
    const semantica = () => root.HAIKU_LIBRO_SEMANTICA;
    const texto = valor => String(valor ?? "").replace(/\s+/g, " ").trim();
    const normalizar = valor => texto(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const clave = valor => normalizar(valor).replace(/[^a-z0-9]+/g, "");
    const lista = valor => Array.isArray(valor) ? valor : [];
    const unico = valores => [...new Set(valores.filter(Boolean))];
    const estados = new Map([
        ["confirmada", "confirmada"], ["confirmado", "confirmada"], ["confirmed", "confirmada"], ["confirmadaporcolor", "confirmada"],
        ["confirmacionpendiente", "pendiente"], ["pendiente", "pendiente"], ["pendingconfirmation", "pendiente"], ["pendienteporcolor", "pendiente"],
        ["checkedin", "hospedada"], ["hospedada", "hospedada"], ["hospedado", "hospedada"], ["inhouse", "hospedada"],
        ["checkedout", "checked_out"], ["checkout", "checked_out"], ["noshow", "no_show"],
        ["cancelada", "cancelada"], ["cancelado", "cancelada"], ["cancelled", "cancelada"], ["canceled", "cancelada"]
    ]);
    const estado = valor => estados.get(clave(valor)) || null;
    const titulos = Object.freeze({
        reserva: "Reserva", cancelacion: "Cancelación", nota: "Nota", pago: "Pago", reembolso: "Reembolso",
        anulacion: "Anulación de pago", cargo: "Cargo", impuesto: "Impuesto", ajuste: "Ajuste", movimiento: "Movimiento"
    });
    const resultado = (estado, detalle, dato = "", origen = null) => ({ estado, detalle, dato, origen });
    const revision = (detalle, dato, origen) => resultado("por_verificar", detalle, dato, origen);

    function fecha(valor) {
        if (valor instanceof Date && Number.isFinite(valor.getTime())) {
            const dos = n => String(n).padStart(2, "0");
            return `${valor.getFullYear()}-${dos(valor.getMonth() + 1)}-${dos(valor.getDate())}`;
        }
        const s = texto(valor);
        const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T]\d{2}:\d{2})/);
        if (iso) return pdf.fecha(`${iso[3]}/${iso[2]}/${iso[1]}`);
        const local = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:$|\s+\d{1,2}:\d{2})/);
        if (!local) return null;
        return pdf.fecha(`${local[1].padStart(2, "0")}/${local[2].padStart(2, "0")}/${local[3].length === 2 ? "20" : ""}${local[3]}`);
    }

    function hora(valor) {
        if (valor instanceof Date && Number.isFinite(valor.getTime())) return valor.toTimeString().slice(0, 5);
        const m = texto(valor).match(/(?:^|[ T])(\d{1,2}):(\d{2})(?!\d)/);
        return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? m[1].padStart(2, "0") + ":" + m[2] : null;
    }

    function idCloudbeds(valor) {
        if (typeof valor === "number" && !Number.isSafeInteger(valor)) return null;
        const s = texto(valor);
        return /^(?=[a-z0-9-]*\d)[a-z0-9][a-z0-9-]{4,39}$/i.test(s) && !fecha(s) ? s : null;
    }

    function cabanaDe(codigo, categoria) {
        const code = texto(codigo).toUpperCase().match(/^([A-Z]+\d+)(?:\(\d+\))?$/)?.[1];
        if (pdf.MAPA[code]) return pdf.MAPA[code];
        const t = normalizar(categoria);
        const codigos = unico((t.match(/\b(?:lc[1-6]|cd[5-9]|c10|c11)\b/g) || []).map(c => pdf.MAPA[c.toUpperCase()]));
        if (codigos.length) return codigos.length === 1 ? codigos[0] : null;
        if (!/\b(?:cabana|cabin|loft)\b/.test(t)) return null;
        const numero = t.match(/(?:\(\s*(\d{1,2})\s*\)|\s(\d{1,2}))$/);
        const cabana = Number(numero?.[1] || numero?.[2]);
        return cabana >= 1 && cabana <= 11 ? cabana : null;
    }

    const dinero = valor => valor == null || valor === "" ? null : pdf.dinero(valor);
    const pesos = valor => valor === null || valor === undefined ? "" : `CLP $${valor.toLocaleString("es-CL")}`;
    const dia = valor => valor ? valor.split("-").reverse().join("-") : "";
    const cab = n => n ? `CAB ${n}` : "";
    const sumarDias = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);

    function medio(valor) {
        const t = clave(valor);
        if (t.includes("webpay")) return t.includes("debito") ? "webpay débito" : t.includes("credito") ? "webpay crédito" : "webpay";
        if (t.includes("airbnbprepaid")) return "airbnb prepaid card";
        if (t.includes("transfer")) return "transferencia";
        if (t.includes("debito")) return "débito";
        if (t.includes("credito")) return "crédito";
        if (t.includes("efectivo") || t === "cash") return "efectivo";
        return null;
    }

    function datosComprobante(nota) {
        const t = normalizar(nota);
        const extraer = patron => t.match(patron)?.[1] || null;
        return {
            folio: extraer(/\bfolio\s*[:#]?\s*(\d{3,})(?!\d)/),
            autorizacion: extraer(/\b(?:bo?v[\s-]*tar|bovt|cod\.?\s*aut\.?|codigo (?:de )?autorizacion|autorizacion)\s*[:#]?\s*(\d{3,}[a-z0-9]*)\b/)?.toUpperCase() || null,
            bove: extraer(/\bbove\s*[:#]?\s*(\d{3,})(?!\d)/),
            fecha: fecha(extraer(/^(\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2}))(?!\d)/))
        };
    }

    const encabezados = {
        id: ["numdereserva", "numerodelareserva", "numerodereserva", "reserva", "reservationnumber", "reservationid"],
        titular: ["nombrecompleto", "titular", "guestname"], nombre: ["nombre", "firstname"], apellido: ["apellido", "lastname"],
        entrada: ["checkin", "fechadellegada", "arrivaldate"], salida: ["checkout", "fechadesalida", "departuredate"],
        habitacion: ["habitacion", "numhabitacion", "room"], categoria: ["categoriadehabitacion", "roomtype"],
        canceladaEn: ["fechadecancelacion", "cancellationdate"], noches: ["nochesdeestadia", "noches", "nights"],
        registradoEn: ["fechayhora", "fechadelatransaccion", "transactiondate", "datetime"],
        servicioEn: ["fechadelservicio", "servicedate"], codigo: ["codigodelatransaccion", "transactioncode"],
        referencia: ["codigo", "code"], descripcion: ["descripcion", "description"], nota: ["nota", "note"],
        estado: ["estado", "status"], debito: ["debito", "debit"], credito: ["credito", "credit"]
    };
    const campos = new Map(Object.entries(encabezados).flatMap(([k, values]) => values.map(v => [v, k])));

    function cabeceraXLSX(filas) {
        for (const [i, fila] of filas.slice(0, 15).entries()) {
            const keys = fila.map(v => campos.get(clave(v)));
            const tiene = (...columnas) => columnas.every(c => keys.includes(c));
            if (tiene("id", "registradoEn", "servicioEn", "descripcion", "debito", "credito")) return { i, keys, tipo: "transacciones" };
            if (tiene("id", "canceladaEn", "entrada", "salida") && (tiene("titular") || tiene("nombre", "apellido"))) {
                return { i, keys, tipo: "cancelaciones" };
            }
        }
        return null;
    }

    function movimiento(raw) {
        const debito = dinero(raw.debito), credito = dinero(raw.credito);
        const descripcion = texto(raw.descripcion), codigo = texto(raw.codigo).toUpperCase();
        const concepto = normalizar(descripcion);
        const nota = texto(raw.nota);
        const medioInforme = medio(descripcion);
        const mediosNota = unico(nota.split(/\/{2,}/).filter(s =>
            /^(?:(?:medio(?: de pago)?|forma de pago)\s*:\s*)?(?:tarjeta\s+(?:de\s+)?)?(?:debito|credito|efectivo|web\s*pay(?:\s+(?:debito|credito))?|transf\.?|transferencia(?:\s+bancaria)?)$/.test(normalizar(s)))
            .map(s => medio(s) || (clave(s) === "transf" ? "transferencia" : null)));
        const comparables = unico(mediosNota.map(m => medioNotaComparable({medio:medioInforme, medioNota:m})));
        const variantesNota = comparables.filter(m => m !== "webpay" || !comparables.some(x => x.startsWith("webpay ")));
        const d = debito ?? 0, c = credito ?? 0;
        let tipo = "movimiento";
        if (d && c || texto(raw.debito) && debito === null || texto(raw.credito) && credito === null) tipo = "movimiento";
        else if (c < 0 && (/anul|void/.test(concepto) || codigo.endsWith("V"))) tipo = "anulacion";
        else if (c < 0 && /reembols|devoluc|refund/.test(concepto)) tipo = "reembolso";
        else if (c > 0 && /pago\s+registrad|payment\b/.test(concepto) && !/anul|refund|reembols|ajuste/.test(concepto)) tipo = "pago";
        else if (d < 0 || /ajuste|adjust/.test(concepto) || c < 0) tipo = "ajuste";
        else if (d > 0 && (codigo === "8000" || /^(?:iva|impuesto|tax)\b/.test(concepto))) tipo = "impuesto";
        else if (d > 0) tipo = "cargo";
        return {
            tipo, debito, credito, descripcion, codigo, referencia: texto(raw.referencia) || null,
            registradoEn: fecha(raw.registradoEn), horaRegistro: hora(raw.registradoEn), servicioEn: fecha(raw.servicioEn),
            nota: nota || null, medio: medioInforme, medioNota: mediosNota.length === 1 ? mediosNota[0] : variantesNota[0],
            mediosNotaDistintos: variantesNota.length > 1, comprobante: datosComprobante(nota)
        };
    }

    function parsearXLSX(tablas, archivo) {
        const filas = [], tipos = new Set(), filtros = [];
        for (const tabla of tablas) {
            const encabezado = cabeceraXLSX(tabla.filas);
            if (!encabezado) continue;
            tipos.add(encabezado.tipo);
            for (let i = encabezado.i + 1; i < tabla.filas.length; i++) {
                const valores = tabla.filas[i];
                const raw = Object.fromEntries(encabezado.keys.flatMap((k, n) => k ? [[k, valores[n]]] : []));
                const id = idCloudbeds(raw.id);
                const cancelacion = encabezado.tipo === "cancelaciones";
                if (cancelacion ? !id && !fecha(raw.canceladaEn) : !texto(raw.descripcion) || !id && !fecha(raw.registradoEn)) {
                    const rango = texto(valores[1]).match(/^(\d{2}\/\d{2}\/\d{4})\s+-\s+(\d{2}\/\d{2}\/\d{4})$/);
                    if (rango && /^fecha/i.test(texto(valores[0]))) filtros.push(`${texto(valores[0])} · ${rango[1]} → ${rango[2]}`);
                    continue;
                }
                const base = {
                    id, titular: texto(raw.titular) || [raw.nombre, raw.apellido].map(texto).filter(v => v && v !== "-").join(" ") || null,
                    cabana: cabanaDe(raw.habitacion, raw.categoria), entrada: fecha(raw.entrada), salida: fecha(raw.salida),
                    estado: cancelacion ? "cancelada" : estado(raw.estado),
                    origenes: [{ archivo, hoja: tabla.hoja, fila: tabla.primeraFila + i }]
                };
                const noches = /^\d+$/.test(texto(raw.noches)) ? Number(raw.noches) : null;
                filas.push(cancelacion ? { ...base, tipo: "cancelacion", canceladaEn: fecha(raw.canceladaEn), noches } : { ...base, ...movimiento(raw) });
            }
        }
        if (!tipos.size) throw new Error("No encontré los encabezados de Transacciones o Cancelaciones de Cloudbeds.");
        return { archivo, tipos: [...tipos], filas, filtros: unico(filtros) };
    }

    const camposNota = new Map([
        ["usuario", "autor"], ["user", "autor"], ["fechadellegada", "entrada"], ["arrivaldate", "entrada"],
        ["fechadesalida", "salida"], ["departuredate", "salida"], ["notacreada", "creadaEn"], ["notecreated", "creadaEn"],
        ["estadodelareserva", "estado"], ["reservationstatus", "estado"], ["identificadordelareserva", "id"], ["reservationid", "id"],
        ["categoriadehabitacion", "categoria"], ["roomtype", "categoria"], ["tipodenota", "tipoNota"], ["notetype", "tipoNota"],
        ["estado", "estadoNota"], ["status", "estadoNota"], ["nota", "nota"], ["note", "nota"]
    ]);

    function cabeceraNotas(pagina) {
        const items = pagina.items;
        for (const ancla of items.filter(x => /^(usuario|user)$/.test(normalizar(x.str)))) {
            const banda = items.filter(x => x.y >= ancla.y - 1 && x.y <= ancla.y + ancla.h * 1.55);
            const columnas = banda.filter(x => Math.abs(x.y - ancla.y) <= 1).sort((a, b) => a.x - b.x).map(x => {
                const valores = banda.filter(y => Math.abs(y.x - x.x) <= 1).sort((a, b) => a.y - b.y);
                return { x: x.x, campo: camposNota.get(clave(valores.map(y => y.str).join(" "))) };
            });
            if (["id", "nota", "tipoNota", "creadaEn"].every(k => columnas.some(c => c.campo === k))) {
                return { columnas, fin: Math.max(...banda.map(x => x.y)), ancho: pagina.width };
            }
        }
        return null;
    }

    function parsearNotas(paginas, archivo) {
        const filas = [];
        let cabecera;
        for (const [i, pagina] of paginas.entries()) {
            const propia = cabeceraNotas(pagina);
            if (propia) cabecera = propia;
            if (!cabecera || Math.abs(cabecera.ancho - pagina.width) > 1) throw new Error("No encontré los encabezados del informe de Notas.");
            const inicio = propia ? propia.fin : 35;
            const colId = cabecera.columnas.find(c => c.campo === "id");
            const limite = pagina.items.find(x => /^(report generated|informe generado|filtros\b)/.test(normalizar(x.str)))?.y ?? pagina.height - 22;
            const cuerpo = pagina.items.filter(x => x.y > inicio && x.y < limite);
            const anclas = cuerpo.filter(x => Math.abs(x.x - colId.x) < 4 && idCloudbeds(x.str)).sort((a, b) => a.y - b.y);
            for (const [n, ancla] of anclas.entries()) {
                const raw = {};
                const debajo = cuerpo.filter(x => x.y >= ancla.y - 1 && x.y < (anclas[n + 1]?.y ?? limite) - 1)
                    .sort((a, b) => a.y - b.y || a.x - b.x);
                for (const item of debajo) {
                    const columna = cabecera.columnas.findLast(c => item.x >= c.x - 2);
                    if (columna?.campo) raw[columna.campo] = texto([raw[columna.campo], item.str].filter(Boolean).join(" "));
                }
                filas.push({
                    tipo: "nota", id: idCloudbeds(raw.id), titular: null, autor: raw.autor || null, cabana: cabanaDe(null, raw.categoria),
                    entrada: fecha(raw.entrada), salida: fecha(raw.salida), estado: estado(raw.estado),
                    creadaEn: fecha(raw.creadaEn), horaNota: hora(raw.creadaEn), tipoNota: raw.tipoNota, estadoNota: raw.estadoNota, nota: raw.nota,
                    origenes: [{ archivo, pagina: i + 1, fila: n + 1 }]
                });
            }
        }
        return { archivo, tipos: ["notas"], filas, filtros: [] };
    }

    function parsearPDF(paginas, archivo) {
        if (paginas.some(p => cabeceraNotas(p))) return parsearNotas(paginas, archivo);
        const entradas = pdf.parsearPaginas(paginas);
        if (!entradas.some(r => r.identificador_cloudbeds && r.check_in && r.check_out && r.nombre_huesped)) {
            throw new Error("El PDF no contiene una tabla de Reservas de Cloudbeds con identificador, titular y fechas.");
        }
        const filas = entradas.map(r => ({
            tipo: estado(r.estado) === "cancelada" ? "cancelacion" : "reserva", id: idCloudbeds(r.reserva_cloudbeds || r.identificador_cloudbeds),
            idAlterno: idCloudbeds(r.id_cloudbeds), titular: r.nombre_huesped, entrada: r.check_in, salida: r.check_out,
            cabana: r.multihabitacion ? null : r.habitaciones[0]?.cabana || cabanaDe(null, r.categoria_habitacion),
            multiple: r.multihabitacion, cabanas: unico(r.habitaciones.map(h => h.cabana)), estado: estado(r.estado),
            noches: r.noches, total: r.precio_total, desdeListado: true,
            origenes: [{ archivo, pagina: r.origen.pagina, fila: r.origen.fila }]
        }));
        return { archivo, tipos: ["reservas"], filas, filtros: [] };
    }

    function esSolicitud(valor) {
        const t = normalizar(valor);
        return /\bcloud\s*beds?\b/.test(t) && !/\btarifas?\b/.test(t) &&
            (/\b(?:informes?|transacciones|cancelaciones|notas|concilia\w*|contrast\w*)\b/.test(t) ||
                /\bcompar\w*\b/.test(t) && /\breservas?\b/.test(t));
    }

    const ids = fila => unico([fila.id, fila.idAlterno]);
    const equivalente = (a, b) => semantica()?.mismaPersona(a, b) ?? Boolean(a && b && normalizar(a) === normalizar(b));
    const variante = (a, b) => equivalente(a, b) || semantica()?.varianteTitular(a, b) || pdf.clasificarNombres(a, b);
    const cancelada = fila => fila.estado === "cancelada";
    const contextoCompleto = fila => Boolean(fila.titular && fila.cabana && fila.entrada && fila.salida && fila.salida >= fila.entrada);
    const mismaCabana = (a, b) => Boolean(a.cabana && a.cabana === b.cabana);
    const mismasFechas = (a, b) => Boolean(a.entrada && a.salida && a.entrada === b.entrada &&
        (a.salida === b.salida || b.fullDay && a.salida === sumarDias(a.entrada, 1) && b.salida === b.entrada));
    const solapan = (a, b) => a.entrada && a.salida && b.entrada && b.salida &&
        (a.entrada === b.entrada || a.entrada < b.salida && b.entrada < a.salida);

    function firma(fila) {
        const { tipo, id, titular, cabana, entrada, salida, estado, creadaEn, horaNota, estadoNota, tipoNota, nota,
            total, codigo, referencia, descripcion, registradoEn, horaRegistro, servicioEn, debito, credito } = fila;
        if (tipo === "cancelacion" && id) return JSON.stringify([tipo, id, entrada, salida]);
        if (tipo === "reserva") return JSON.stringify([tipo, id, titular, cabana, entrada, salida, estado, total, fila.cabanas]);
        if (tipo === "nota") return JSON.stringify([tipo, id, creadaEn, horaNota, estadoNota, tipoNota, normalizar(nota)]);
        return JSON.stringify([tipo, id, titular, cabana, entrada, salida, registradoEn, horaRegistro, servicioEn,
            codigo, referencia, descripcion, debito, credito, normalizar(nota)]);
    }

    function unirDocumentos(documentos) {
        const registros = new Map();
        for (const documento of documentos) {
            const ocurrencias = new Map();
            const filas = documento.filas || [];
            for (const fila of filas) {
                const f = firma(fila);
                const n = (ocurrencias.get(f) || 0) + 1;
                ocurrencias.set(f, n);
                const k = f + "#" + n, previa = registros.get(k);
                if (!previa) registros.set(k, { ...fila, origenes: [...fila.origenes] });
                else {
                    previa.origenes.push(...fila.origenes);
                    previa.cabana ||= fila.cabana;
                    previa.canceladaEn ||= fila.canceladaEn;
                    previa.noches ??= fila.noches;
                    previa.idAlterno ||= fila.idAlterno;
                    previa.titular ||= fila.titular;
                    previa.conflicto ||= Boolean(previa.cabana && fila.cabana && previa.cabana !== fila.cabana ||
                        previa.titular && fila.titular && !variante(previa.titular, fila.titular) ||
                        fila.canceladaEn && previa.canceladaEn !== fila.canceladaEn ||
                        fila.noches != null && previa.noches !== fila.noches);
                }
                if (n > 1) {
                    registros.get(f + "#1").repetida = true;
                    registros.get(k).repetida = true;
                }
            }
        }
        return [...registros.values()];
    }

    function contextoDocumental(filas) {
        const porId = new Map();
        for (const fila of filas.filter(f => f.tipo !== "nota")) {
            for (const id of ids(fila)) {
                if (!porId.has(id)) porId.set(id, []);
                porId.get(id).push(fila);
            }
        }
        return filas.map(fila => {
            const referencias = unico(ids(fila).flatMap(id => porId.get(id) || [])).filter(f => f !== fila);
            const listados = referencias.filter(f => f.desdeListado);
            const comparables = referencias.filter(f => f.titular && f.entrada === fila.entrada && f.salida === fila.salida &&
                (!f.cabana || !fila.cabana || f.cabana === fila.cabana));
            const compatibles = comparables.filter(f => !fila.titular || variante(fila.titular, f.titular));
            const titular = compatibles[0]?.titular;
            const contextoSeguro = compatibles.length && compatibles.every(f => equivalente(f.titular, titular));
            const mismaCancelacion = fila.tipo === "cancelacion" || cancelada(fila);
            return {
                ...fila,
                titular: fila.titular || (contextoSeguro ? titular : null),
                cabana: fila.cabana || (contextoSeguro && unico(compatibles.map(f => f.cabana)).length === 1 ? compatibles.find(f => f.cabana).cabana : null),
                conflicto: fila.conflicto || comparables.some(f => fila.titular && !variante(fila.titular, f.titular)) ||
                    listados.some(f => fila.tipo === "reserva" || fila.tipo === "cancelacion"
                        ? cancelada(f) !== mismaCancelacion
                        : !compatibles.includes(f) && f.titular && fila.titular && !variante(f.titular, fila.titular)),
                contextoCloudbeds: contextoSeguro ? compatibles[0].origenes[0] : null,
                idAlterno: fila.idAlterno || listados.find(f => f.id === fila.id)?.idAlterno
            };
        });
    }

    function elegirEstadia(fila, reservas, usarId) {
        const contexto = (r, fechas) => mismaCabana(fila, r) && fechas && variante(fila.titular, r.titular);
        const identificadas = usarId ? reservas.filter(r => r.cloudbedsId && ids(fila).includes(r.cloudbedsId)) : [];
        if (identificadas.length) {
            const enCabana = identificadas.filter(r => mismaCabana(fila, r));
            const candidatas = enCabana.length ? enCabana : identificadas;
            if (candidatas.length === 1 && candidatas[0].entrada) return { fila: candidatas[0], evidencia: "id" };
            return { duda: "El identificador coincide con varias estadías o la reserva no tiene una estadía verificable." };
        }
        if (fila.identidadCompartida) return { duda: "Hay dos números de Cloudbeds para el mismo titular, cabaña y fechas." };
        if (!contextoCompleto(fila) || fila.multiple) return { duda: "Falta un titular, una cabaña o fechas suficientes para identificar la estadía." };
        const exactas = reservas.filter(r => contexto(r, mismasFechas(fila, r)));
        const cercanas = reservas.filter(r => mismaCabana(fila, r) && solapan(fila, r));
        const candidatas = exactas.length ? exactas : cercanas.filter(r =>
            equivalente(fila.titular, r.titular) && (fila.entrada === r.entrada || fila.salida === r.salida));
        if (candidatas.some(r => r.cloudbedsId && ids(fila).length && !ids(fila).includes(r.cloudbedsId))) {
            return { duda: "La estadía parecida tiene otro identificador de Cloudbeds." };
        }
        const activas = candidatas.filter(r => !cancelada(r));
        const delMismoEstado = cancelada(fila) ? candidatas.filter(cancelada) : activas;
        if (delMismoEstado.length === 1 && (cancelada(fila) || exactas.length <= 1)) {
            return { fila: delMismoEstado[0], evidencia: exactas.length ? "contexto" : "fechas" };
        }
        if (candidatas.length > 1) return { duda: "Hay varias estadías compatibles. Revisa sus identificadores y fechas." };
        if (candidatas.length && cancelada(fila)) return { duda: "Encontré una estadía activa parecida. Comprueba el número de la reserva cancelada." };
        if (candidatas.length) return { duda: "La única estadía parecida está cancelada. Comprueba su identificador." };
        if (reservas.some(r => !mismaCabana(fila, r) && equivalente(fila.titular, r.titular) && mismasFechas(fila, r))) {
            return { duda: "Hay una estadía del mismo titular y fechas en otra cabaña." };
        }
        if (cercanas.some(r => !cancelada(r))) return { duda: "Esa cabaña tiene otra reserva en fechas cercanas." };
        return {};
    }

    function filaLibro(r) {
        return {
            titular: r.titular, cabana: r.cabana, entrada: r.fecha_checkin, salida: r.fecha_checkout,
            fullDay: ["full_day", "fullday"].includes(r.tipo_estadia), estado: estado(r.estado_operativo) || estado(r.estado_confirmacion),
            confirmacion: estado(r.estado_confirmacion), noches: r.noches,
            nochesTexto: r.noches_texto_efectivas ?? r.noches_texto, geometriaSegura: r.geometria_inequivoca === true,
            origen: r.coordenadas_origen, notas: [...lista(r.notas_importantes), r.texto_original],
            pagos: lista(r.pagos), servicios: lista(r.servicios), reservaLibro: r
        };
    }

    const datoEstadia = r => [r.titular, cab(r.cabana), r.entrada && [dia(r.entrada), dia(r.salida)].filter(Boolean).join(" → "),
        r.estado && r.estado.replace("checked_out", "check-out").replace("no_show", "no se presentó")].filter(Boolean).join(" · ");

    function compararEstadia(fila, seleccion) {
        const r = seleccion.fila;
        if (!r) return null;
        if (r.geometriaSegura === false) return revision("La geometría de esta estadía en el Libro requiere revisión.", datoEstadia(r), r.origen);
        if (r.nochesTexto != null && r.noches != null && Number(r.nochesTexto) !== Number(r.noches)) {
            return revision(`El texto del Libro indica ${r.nochesTexto} noches y las celdas abarcan ${r.noches}.`, datoEstadia(r), r.origen);
        }
        const distintos = [];
        if (fila.titular && r.titular && !equivalente(fila.titular, r.titular) &&
            (seleccion.evidencia === "id" || !variante(fila.titular, r.titular))) distintos.push("titular");
        if (fila.cabana && r.cabana && !mismaCabana(fila, r)) distintos.push("cabaña");
        if (fila.entrada && fila.salida && !mismasFechas(fila, r)) distintos.push("fechas");
        const estadoComparable = ["confirmada", "pendiente"].includes(fila.estado) ? r.confirmacion || r.estado : r.estado;
        if (fila.estado && estadoComparable && fila.estado !== estadoComparable) distintos.push("estado");
        if (distintos.length) return resultado("dato_distinto", `Difiere ${distintos.join(", ")}.`, datoEstadia(r), r.origen);
        if (!fila.entrada || !fila.salida || !fila.titular || !fila.cabana || !fila.estado || !estadoComparable) {
            return revision("Identifiqué la estadía. Quedan campos sin evidencia suficiente.", datoEstadia(r), r.origen);
        }
        const evidencia = seleccion.evidencia === "id" ? "Identificador de Cloudbeds" :
            equivalente(fila.titular, r.titular) ? "Titular, cabaña y fechas" : "Variante del titular corroborada por cabaña y fechas";
        return resultado("coincide", evidencia + (r.fullDay ? " · Full Day." : "."), datoEstadia(r), r.origen);
    }

    function cobertura(hojas, fecha, tipo) {
        return hojas.some(h => h.cobertura?.[tipo] === true && lista(h.fechas).includes(fecha));
    }

    function cancelacionLibro(fila, hojas, reservas, competidora) {
        if (!fila.titular || !fila.entrada) return revision("Falta titular o fecha para buscar la cancelación en el Libro.");
        const noches = fila.entrada && fila.salida ? (Date.parse(fila.salida) - Date.parse(fila.entrada)) / 86400000 : null;
        const halladas = hojas.flatMap(h => lista(h.cancelaciones)).filter(c => c.fecha_checkin === fila.entrada && variante(c.titular, fila.titular));
        if (halladas.length === 1 && !competidora && (noches === null || halladas[0].noches == null || noches === Number(halladas[0].noches))) {
            return resultado("coincide", "Figura en el bloque Cancelaciones del Libro.", [halladas[0].titular, dia(halladas[0].fecha_checkin)].join(" · "), halladas[0].origen);
        }
        if (halladas.length) return revision("Hay una cancelación parecida. Verifica el titular, las noches y el número.", "", halladas[0].origen);
        if (competidora || reservas.some(r => equivalente(r.titular, fila.titular) && solapan(fila, r))) {
            return revision("Hay una estadía activa parecida. Comprueba cuál corresponde al número cancelado.");
        }
        return revision("No encontré una entrada en el bloque Cancelaciones para ese titular y fecha.");
    }

    const textoNota = valor => normalizar(valor).replace(/[^a-z0-9]+/g, " ").trim();
    function compararNota(fila, notas, referencia, fuente) {
        if (!fila.nota || !/^(?:reserva|reservation)$/.test(normalizar(fila.tipoNota)) || /inactiv|archiv/.test(normalizar(fila.estadoNota))) {
            return revision("Nota sin texto, inactiva o de un tipo que requiere revisión.");
        }
        const buscada = textoNota(fila.nota);
        const textos = notas.filter(n => typeof n === "string" && n.trim());
        const igual = textos.some(n => {
            const t = textoNota(n);
            return t === buscada || buscada.length >= 12 && ` ${t} `.includes(` ${buscada} `);
        });
        if (igual) return resultado("coincide", `El texto de la nota aparece en ${fuente}.`, fila.nota, referencia);
        const palabras = unico(buscada.split(" ").filter(w => w.length > 3));
        const parecida = palabras.length >= 2 && textos.some(n => {
            const tokens = new Set(textoNota(n).split(" "));
            return palabras.filter(p => tokens.has(p)).length >= Math.max(2, Math.ceil(palabras.length * 0.65));
        });
        if (parecida) return revision("Encontré texto parecido. Comprueba si corresponde a la misma indicación.", "", referencia);
        return resultado("falta", "La nota no aparece en la estadía identificada.", "", referencia);
    }

    const refCanon = v => clave(v).replace(/^0+/, "");
    function mismaReferencia(a, b) {
        const auth = refCanon(a.autorizacion);
        if (!auth || auth !== refCanon(b.autorizacion)) return false;
        const f = refCanon(a.folio), g = refCanon(b.folio);
        return f && g ? f === g : a.medio?.startsWith("webpay") && b.medio?.startsWith("webpay");
    }

    const diaChile = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" });
    function fechaPagoProyecto(p) {
        const valor = p.fecha_pago;
        if (p.datos_origen?.origen_libro && /^\d{4}-\d{2}-\d{2}[ T]00:00:00(?:\.0+)?(?:Z|\+00(?::?00)?)$/.test(valor || "")) return fecha(valor);
        if (!valor || !/[T ]\d{2}:\d{2}/.test(valor)) return fecha(valor);
        const t = new Date(valor);
        return Number.isFinite(t.getTime()) ? diaChile.format(t) : null;
    }

    function pagoProyecto(p) {
        const tipo = /devoluc|reembols/.test(normalizar(p.tipo_movimiento)) ? "reembolso" : normalizar(p.tipo_movimiento);
        const medioPago = medio(p.medio_pago);
        const autorizacion = medioPago?.startsWith("webpay")
            ? p.codigo_autorizacion || p.datos_origen?.bovtar : p.datos_origen?.bovtar || p.codigo_autorizacion;
        return { tipo, vigente: p.estado === "confirmado", importe: dinero(p.monto), moneda: p.moneda,
            fecha: fechaPagoProyecto(p), medio: medioPago, folio: p.folio, autorizacion,
            estado: p.estado, origenLibro: p.datos_origen?.origen_libro };
    }

    function pagoLibro(p, medioCotejado) {
        const medioLibro = medioCotejado || root.HAIKU_LIBRO_PAGOS_CANON_V1?.medioDesdeTexto(p) || p.medio_pago;
        return { tipo: "pago", vigente: p.pago_recibido === true && p.estado_pago === "registrado_en_libro" &&
            !p.fecha_comprobante_variable && !lista(p.advertencias).length, importe: dinero(p.monto), moneda: p.moneda || "CLP",
            fecha: p.fecha_comprobante_variable ? null : p.fecha_comprobante, medio: medio(medioLibro),
            folio: p.folio, autorizacion: p.bovtar || p.codigo_autorizacion, origen: p.origen };
    }

    const mismoMedio = (a, b) => a && b && (a === b || a === "webpay" && b.startsWith("webpay ") || b === "webpay" && a.startsWith("webpay "));
    const datoPago = p => [pesos(p.importe), dia(p.fecha), p.medio, p.estado].filter(Boolean).join(" · ");
    const mismaCelda = (a, b) => a?.hoja && a?.celda && a.hoja === b?.hoja && a.celda === b?.celda;
    const medioNotaComparable = fila => fila.medio?.startsWith("webpay") && ["crédito", "débito"].includes(fila.medioNota)
        ? "webpay " + fila.medioNota : fila.medioNota;
    const medioComprobante = fila => fila.medio === "webpay" && medioNotaComparable(fila)?.startsWith("webpay ")
        ? medioNotaComparable(fila) : fila.medio;
    const medioContradictorio = fila => fila.medioNota && !mismoMedio(fila.medio, medioNotaComparable(fila));

    function cotejarPagoAlojamiento(fila, reserva) {
        if (!reserva || fila.tipo !== "pago" || !equivalente(fila.titular, reserva.titular) ||
            fila.cabana !== Number(reserva.cabana) || fila.entrada !== reserva.fecha_checkin ||
            !mismasFechas(fila, {entrada:reserva.fecha_checkin, salida:reserva.fecha_checkout,
                fullDay:["full_day", "fullday"].includes(reserva.tipo_estadia)}) ||
            lista(reserva.advertencias).length || fila.conflicto || fila.repetida ||
            fila.posibleReversa || fila.comprobanteCompartido || fila.mediosNotaDistintos || medioContradictorio(fila)) return null;
        const c = fila.comprobante;
        if (!c.fecha || !/^\d+$/.test(refCanon(c.autorizacion)) ||
            !Number.isSafeInteger(fila.credito) || fila.credito <= 0) return null;
        const asociados = lista(reserva.pagos), sinAsociar = lista(reserva.pagos_sin_asociacion);
        const candidatos = [...asociados, ...sinAsociar].filter(p => p.tipo_movimiento === "alojamiento" &&
            [p.codigo_autorizacion, p.bovtar].some(v => refCanon(v) === refCanon(c.autorizacion)));
        if (candidatos.length !== 1) return null;
        const [p] = candidatos;
        if (!p.origen?.celda || p.origen.hoja !== reserva.coordenadas_origen?.hoja ||
            Number(p.cabana) !== fila.cabana || p.fecha_bloque !== fila.entrada || p.fecha_comprobante !== c.fecha ||
            p.monto !== fila.credito || p.moneda !== "CLP" || p.pago_recibido !== true || p.estado_pago !== "registrado_en_libro" ||
            p.fecha_comprobante_variable || p.webpay_por_confirmar || p.transaccion_distribuida || p.conflicto_distribucion ||
            ["dudoso", "nota_financiera"].includes(p.clasificacion_financiera) ||
            p.bove && c.bove && refCanon(p.bove) !== refCanon(c.bove)) return null;
        const advertencias = lista(p.advertencias);
        if (sinAsociar.includes(p)) {
            const evidencia = p.evidencia_financiera;
            // Un comprobante completo en el bloque sin encabezado se puede
            // asociar si ambos documentos identifican el mismo pago y titular.
            if (!reserva.geometria_inequivoca || !equivalente(p.titular, reserva.titular) ||
                evidencia?.sector !== "pagos" || evidencia.estructura_fila !== "fecha_detalle_concepto_monto" ||
                !["fecha", "detalle", "concepto", "monto"].every(k => evidencia.columnas_ocupadas?.[k] === true) ||
                advertencias.some(a => !a.startsWith("El bloque del Check-In conserva su estructura, pero falta el encabezado de pagos;"))) return null;
        } else if (advertencias.length) return null;
        const cabanaConcepto = normalizar(p.concepto).match(/^cab\s*(\d+)\b/)?.[1];
        if (cabanaConcepto && Number(cabanaConcepto) !== fila.cabana) return null;

        const medioInforme = medioComprobante(fila), medioLibro = pagoLibro(p).medio;
        const textoLibro = normalizar(p.texto_original);
        if (/\bdebito\b/.test(textoLibro) && /\bcredito\b/.test(textoLibro)) return null;
        let medioPago;
        if (medioInforme?.startsWith("webpay")) {
            if (p.folio || p.bovtar || c.folio || refCanon(p.codigo_autorizacion) !== refCanon(c.autorizacion)) return null;
            const tarjeta = ["webpay crédito", "webpay débito"].find(m =>
                mismoMedio(m, medioInforme) && (mismoMedio(m, medioLibro) ||
                    m === medioInforme && m.endsWith(" " + medioLibro) &&
                    !/\b(?:pos|transbank|bovtar)\b/.test(textoLibro)));
            if (!tarjeta || (medioInforme === "webpay" && medioLibro === "webpay")) return null;
            medioPago = tarjeta === "webpay crédito" ? "webpay_credito" : "webpay_debito";
        } else {
            if (!["crédito", "débito"].includes(medioInforme) || medioLibro !== medioInforme ||
                !/^\d+$/.test(refCanon(c.folio)) || refCanon(p.folio) !== refCanon(c.folio) ||
                refCanon(p.bovtar) !== refCanon(c.autorizacion)) return null;
            medioPago = medioInforme === "crédito" ? "tarjeta_credito" : "tarjeta_debito";
        }
        return { ...p, medio_pago: medioPago, advertencias: [] };
    }

    function pagoIncorporable(fila, proyecto, libro, destino, ph, li, alojamiento) {
        if (fila.tipo !== "pago" || ph.estado !== "falta" || li.estado !== "coincide" ||
            !destino?.reservaId || !destino.estadiaId || !proyecto || !libro ||
            !mismaCabana(fila, proyecto) || !mismaCabana(fila, libro) ||
            !mismasFechas(fila, proyecto) || !mismasFechas(fila, libro) ||
            !variante(fila.titular, proyecto.titular) ||
            [fila, proyecto, libro].some(r => cancelada(r) || r.estado === "no_show")) return null;
        if (mismaCelda(alojamiento?.origen, li.origen)) return { reservaLibro: libro.reservaLibro, origen: li.origen,
            destino, comprobanteCloudbeds: fila };
        const asociados = libro.pagos.filter(p => mismaCelda(p.origen, li.origen));
        const pago = asociados[0];
        if (asociados.length !== 1 || !["servicio", "distribuido"].includes(pago.tipo_movimiento) ||
            !fila.comprobante.fecha || pago.fecha_comprobante !== fila.comprobante.fecha ||
            pago.bove && fila.comprobante.bove && refCanon(pago.bove) !== refCanon(fila.comprobante.bove)) return null;
        return { reservaLibro: libro.reservaLibro, origen: li.origen, destino };
    }
    function compararPago(fila, pagos, segura, origenConfirmado) {
        if (!fila.medio) return revision("Cloudbeds no identifica un medio de pago comparable en esta fila.");
        if (fila.mediosNotaDistintos) return revision("La nota de Cloudbeds indica más de un medio de pago.");
        if (medioContradictorio(fila)) {
            return revision(`La transacción registra ${fila.medio} y la nota del comprobante dice ${fila.medioNota}.`);
        }
        const medioFila = medioComprobante(fila);
        const monto = Math.abs(fila.credito);
        const comprobante = { ...fila.comprobante, medio: medioFila };
        const porReferencia = pagos.filter(p => mismaReferencia(comprobante, p) || mismaCelda(origenConfirmado, p.origenLibro));
        if (fila.posibleReversa) return revision("Hay una anulación o reembolso compatible en los archivos. Comprueba el pago original.");
        if (porReferencia.length > 1) return revision("El comprobante aparece en varios movimientos. Revisa si está distribuido o duplicado.");
        if (porReferencia.length === 1) {
            const p = porReferencia[0];
            const anulado = fila.tipo === "anulacion" && p.tipo === "pago" && p.estado === "anulado";
            if (!anulado && (p.tipo !== fila.tipo || !p.vigente)) return revision("El comprobante aparece con otro tipo o estado de movimiento.", datoPago(p), p.origen);
            if (!p.moneda || !p.medio || !p.fecha || p.importe === null) return revision("Coincide el comprobante. Faltan datos para verificar el movimiento.", datoPago(p), p.origen);
            const distintos = [
                (fila.tipo === "reembolso" ? Math.abs(p.importe) : p.importe) !== monto && "monto", p.moneda !== "CLP" && "moneda",
                !mismoMedio(p.medio, medioFila) && "medio",
                !anulado && comprobante.fecha && comprobante.fecha !== p.fecha && "fecha del comprobante",
                p.folio && comprobante.folio && refCanon(p.folio) !== refCanon(comprobante.folio) && "folio",
                p.autorizacion && comprobante.autorizacion && refCanon(p.autorizacion) !== refCanon(comprobante.autorizacion) && "autorización"
            ].filter(Boolean);
            if (distintos.length) return resultado("dato_distinto", `Mismo comprobante con distinto ${distintos.join(", ")}.`, datoPago(p), p.origen);
            const evidencia = anulado ? "El mismo comprobante figura anulado en Proyecto H." :
                mismaReferencia(comprobante, p) ? "Comprobante, importe y medio compatibles." :
                    "Coincide con el comprobante del Libro asociado al pago en Proyecto H.";
            return resultado("coincide", evidencia, datoPago(p), p.origen || origenConfirmado);
        }
        const posibles = pagos.filter(p => {
            const auth = refCanon(comprobante.autorizacion), otra = refCanon(p.autorizacion);
            const folio = refCanon(comprobante.folio), otroFolio = refCanon(p.folio);
            if (fila.tipo === "pago" && auth && otra && auth !== otra &&
                (medioFila?.startsWith("webpay") && p.medio?.startsWith("webpay") ||
                    folio && otroFolio && folio !== otroFolio)) return false;
            return p.importe === monto ||
                mismoMedio(p.medio, medioFila) && p.fecha && [comprobante.fecha, fila.registradoEn].includes(p.fecha) ||
                folio && folio === otroFolio || auth && auth === otra;
        });
        if (posibles.length) return revision("Encontré movimientos compatibles. Comprueba la referencia antes de dar el pago por conciliado.",
            posibles.length === 1 ? datoPago(posibles[0]) : "", posibles.length === 1 ? posibles[0].origen : null);
        if (fila.tipo !== "pago") return revision("Comprueba este movimiento con el pago original y la evidencia del reverso.");
        return segura ? resultado("falta", "No encontré este pago entre los movimientos de la reserva.") :
            revision("Falta comprobar el comprobante o la cobertura de los pagos para concluir que falta.");
    }

    function conceptoServicio(valor) {
        const t = textoNota(valor);
        if (/^late\s*check\s*out(?: promo)?$/.test(t)) return "late checkout";
        const masaje = t.match(/^(?:masaje )?(terapeutico|descontracturante|relajante)\s+(\d+)\s*(h|hrs?|min|m)$/);
        if (masaje) return masaje[1] + " " + Number(masaje[2]) * (/^h/.test(masaje[3]) ? 60 : 1);
        return t;
    }

    function compararCargo(fila, servicios) {
        const esServicio = fila.tipo === "cargo" && /^2\d{3}$/.test(fila.codigo);
        if (!esServicio) return fila.tipo === "movimiento"
            ? revision("Revisa el tipo y el importe de esta fila en el folio de Cloudbeds.")
            : resultado("informativo", "Movimiento contable del folio de Cloudbeds.");
        const concepto = conceptoServicio(fila.descripcion);
        const candidatos = servicios.filter(s => conceptoServicio(s.concepto) === concepto && s.fecha === fila.servicioEn);
        if (candidatos.length === 1 && candidatos[0].monto === fila.debito) {
            return resultado("coincide", "Cargo y servicio compatibles por concepto, fecha e importe.", fila.descripcion, candidatos[0].origen);
        }
        if (candidatos.length === 1 && candidatos[0].monto != null) {
            return resultado("dato_distinto", "Mismo concepto y fecha con otro importe.", pesos(candidatos[0].monto), candidatos[0].origen);
        }
        const posibles = servicios.filter(s => s.fecha === fila.servicioEn && s.monto === fila.debito &&
            concepto.startsWith("tinaja") && conceptoServicio(s.concepto).startsWith("tinaja"));
        return posibles.length === 1
            ? revision("Coinciden fecha e importe. Comprueba el tipo de tinaja.", posibles[0].concepto, posibles[0].origen)
            : revision("Comprueba si este cargo corresponde a un servicio de la estadía.");
    }

    const gruposMovimiento = new Set(["pago", "reembolso", "anulacion", "cargo", "impuesto", "ajuste", "movimiento"]);
    const identidadReversa = fila => fila.id && fila.medio && fila.credito
        ? JSON.stringify([fila.id, fila.medio.replace(/^(webpay) .+/, "$1")]) : null;
    const momentoRegistro = fila => (fila.registradoEn || "") + "T" + (fila.horaRegistro || "");

    function preparar(documentos) {
        const filas = contextoDocumental(unirDocumentos(documentos));
        const reversas = new Map();
        const recibos = new Map();
        for (const f of filas.filter(f => f.tipo === "pago" && f.id && f.medio)) {
            const auth = refCanon(f.comprobante.autorizacion), folio = refCanon(f.comprobante.folio);
            if (!auth || !folio && !f.medio.startsWith("webpay")) continue;
            const k = JSON.stringify([auth, f.medio.startsWith("webpay") ? "webpay" : folio]);
            if (!recibos.has(k)) recibos.set(k, []);
            recibos.get(k).push(f);
        }
        for (const grupo of recibos.values()) if (grupo.length > 1) {
            grupo.forEach(f => { f.comprobanteCompartido = true; });
        }
        for (const f of filas.filter(f => ["anulacion", "reembolso"].includes(f.tipo))) {
            const k = identidadReversa(f);
            if (k) reversas.set(k, [...(reversas.get(k) || []), f]);
        }
        const reservas = new Map();
        for (const f of filas.filter(f => f.desdeListado && f.tipo === "reserva" && contextoCompleto(f))) {
            const k = f.entrada + "/" + f.salida;
            if (!reservas.has(k)) reservas.set(k, []);
            reservas.get(k).push(f);
        }
        for (const f of filas) {
            f.posibleReversa = f.tipo === "pago" && (reversas.get(identidadReversa(f)) || []).some(r => {
                const a = { ...r.comprobante, medio: r.medio }, b = { ...f.comprobante, medio: f.medio };
                if (r.registradoEn && f.registradoEn && momentoRegistro(r) < momentoRegistro(f)) return false;
                if (a.autorizacion && b.autorizacion && refCanon(a.autorizacion) !== refCanon(b.autorizacion)) return false;
                return r.credito === -f.credito || mismaReferencia(a, b);
            });
            const compatibles = (reservas.get(f.entrada + "/" + f.salida) || []).filter(r =>
                (!f.cabana || mismaCabana(f, r)) && variante(f.titular, r.titular));
            f.otraActiva = cancelada(f) && compatibles.some(r => r.id !== f.id);
            f.identidadCompartida = !cancelada(f) && compatibles.some(r => r.id === f.id) && compatibles.some(r => r.id !== f.id);
        }
        return filas;
    }

    function destinosProyecto(filas, reservas) {
        const destinos = { notas: new Set(), pagos: new Set(), servicios: new Set() };
        for (const fila of filas) {
            if (fila.conflicto || fila.repetida) continue;
            const tipo = fila.tipo === "nota" ? "notas" : ["pago", "reembolso", "anulacion"].includes(fila.tipo) ? "pagos" :
                fila.tipo === "cargo" && /^2\d{3}$/.test(fila.codigo) ? "servicios" : null;
            if (!tipo) continue;
            const id = elegirEstadia(fila, reservas, true).fila?.reservaId;
            if (id) destinos[tipo].add(id);
        }
        return destinos;
    }

    function agruparPagos(filas) {
        const grupos = new Map();
        for (const f of filas) {
            if (!["pago", "anulacion", "reembolso"].includes(f.tipo) || f.conflicto) continue;
            if (!contextoCompleto(f)) continue;
            const contexto = [f.cabana, f.entrada, f.salida];
            const clave = f.destino?.estadiaId ? JSON.stringify(["estadia", f.destino.reservaId, f.destino.estadiaId, ...contexto]) :
                f.id ? JSON.stringify(["cloudbeds", f.id, ...contexto]) : null;
            if (!clave) continue;
            if (!grupos.has(clave)) grupos.set(clave, []);
            grupos.get(clave).push(f);
        }
        const porFila = new Map();
        for (const movimientos of grupos.values()) {
            if (movimientos.length === 1) continue;
            movimientos.sort((a, b) =>
                (a.comprobante.fecha || a.registradoEn || "").localeCompare(b.comprobante.fecha || b.registradoEn || "") ||
                momentoRegistro(a).localeCompare(momentoRegistro(b)));
            for (const fila of movimientos) porFila.set(fila, movimientos);
        }
        return porFila;
    }

    function comparar(filas, { proyecto, libro }) {
        const hojas = libro?.hojas || [];
        const reservasLibro = hojas.flatMap(h => lista(h.reservas)).map(filaLibro);
        const reservasProyecto = proyecto?.reservas || [];
        const compararFila = fila => {
            const p = elegirEstadia(fila, reservasProyecto, true);
            const l = elegirEstadia(fila, reservasLibro, false);
            const noProyecto = revision("Proyecto H no está disponible para esta consulta.");
            const noLibro = revision("No pude verificar la cobertura del Libro para la fecha de ingreso.");
            const noches = fila.entrada && fila.salida ? (Date.parse(fila.salida) - Date.parse(fila.entrada)) / 86400000 : null;
            const general = fila.conflicto || fila.repetida ? revision(fila.conflicto
                ? "Los documentos de Cloudbeds presentan datos incompatibles para el mismo identificador."
                : "La misma fila aparece más de una vez en un informe. Comprueba si son movimientos distintos.")
                : fila.noches != null && noches !== null && fila.noches !== noches
                    ? revision("Las noches declaradas en Cloudbeds difieren de las fechas de la estadía.") : null;
            let ph = general || noProyecto, li = general || noLibro, alojamiento;
            if (!general && ["reserva", "cancelacion"].includes(fila.tipo)) {
                if (proyecto?.disponible) ph = compararEstadia(fila, p) || (p.duda ? revision(p.duda) :
                    fila.tipo === "reserva" ? resultado("falta", "No encontré esta estadía en Proyecto H.") :
                        revision("No encontré una reserva cancelada con estos datos en Proyecto H."));
                if (cobertura(hojas, fila.entrada, "geometria")) {
                    if (fila.tipo === "cancelacion") li = cancelacionLibro(fila, hojas, reservasLibro, fila.otraActiva);
                    else li = compararEstadia(fila, l) || (l.duda ? revision(l.duda) :
                        hojas.some(h => lista(h.anotaciones).some(a => a.tipo === "reserva_por_identificar" && a.cabana === fila.cabana &&
                            (a.fecha === fila.entrada || lista(a.fechas_ocupadas).includes(fila.entrada))))
                            ? revision("El Libro tiene un bloque sin titular confirmado para esta cabaña y fecha.")
                            : resultado("falta", "No encontré esta estadía en las hojas del Libro revisadas."));
                }
            } else if (!general && fila.tipo === "nota") {
                if (proyecto?.disponible) ph = p.fila && proyecto.notasDisponibles
                    ? compararNota(fila, [...lista(proyecto.notas?.get(p.fila.reservaId)), p.fila.observaciones], null, "Proyecto H")
                    : revision(p.duda || "Falta identificar la reserva o consultar sus notas en Proyecto H.");
                if (l.fila && cobertura(hojas, fila.entrada, "geometria")) li = compararNota(fila, l.fila.notas, l.fila.origen, "el Libro");
                else if (l.duda && hojas.length) li = revision(l.duda);
            } else if (!general && gruposMovimiento.has(fila.tipo)) {
                if (["pago", "reembolso", "anulacion"].includes(fila.tipo)) {
                    const refsFuertes = Boolean(refCanon(fila.comprobante.autorizacion) &&
                        (refCanon(fila.comprobante.folio) || fila.medio?.startsWith("webpay")));
                    const mismoTitular = x => variante(x.titular, fila.titular);
                    const deReserva = l.fila?.pagos || [];
                    const dePeriodo = hojas.flatMap(h => lista(h.pagos)).filter(x => x.cabana === fila.cabana && mismoTitular(x) &&
                        (x.fecha_bloque === fila.entrada || x.fecha_comprobante && x.fecha_comprobante === (fila.comprobante.fecha || fila.registradoEn) ||
                         mismaReferencia({ ...fila.comprobante, medio: fila.medio }, pagoLibro(x))));
                    const porCelda = new Map([...dePeriodo, ...deReserva].map(x => [
                        x.origen?.hoja && x.origen?.celda ? x.origen.hoja + "!" + x.origen.celda : x, x
                    ]));
                    alojamiento = libro?.finanzas ? cotejarPagoAlojamiento(fila, l.fila?.reservaLibro) : null;
                    if (alojamiento) porCelda.set(alojamiento.origen.hoja + "!" + alojamiento.origen.celda, alojamiento);
                    const dudaComprobante = fila.comprobanteCompartido
                        ? revision(fila.posibleReversa
                            ? "Hay una anulación o reembolso compatible y más de un pago usa este comprobante."
                            : "Más de un pago de Cloudbeds usa este comprobante. Revisa si se repitió o se repartió.") : null;
                    li = dudaComprobante || (libro?.finanzas && (l.fila || porCelda.size)
                        ? compararPago(fila, [...porCelda.values()].map(p => pagoLibro(p, p === alojamiento ? p.medio_pago : null)),
                            Boolean(l.fila && refsFuertes && fila.comprobante.fecha &&
                                cobertura(hojas, fila.entrada, "pagos") && cobertura(hojas, fila.comprobante.fecha, "pagos")))
                        : revision(l.duda || "Falta identificar la estadía o comprobar los pagos del Libro."));
                    const datosProyecto = proyecto?.pagos?.get(p.fila?.reservaId) || [];
                    if (li.estado === "coincide" && mismaCelda(li.origen, alojamiento?.origen)) {
                        li.detalle = "Coinciden el importe, la fecha y la autorización del pago de alojamiento.";
                    }
                    ph = dudaComprobante || (proyecto?.pagosDisponibles && p.fila
                        ? compararPago(fila, datosProyecto.map(pagoProyecto), refsFuertes, li.estado === "coincide" ? li.origen : null)
                        : revision(p.duda || "Falta identificar la reserva o consultar sus pagos en Proyecto H."));
                } else {
                    ph = compararCargo(fila, lista(proyecto?.servicios?.get(p.fila?.reservaId)).filter(s => !s.estadiaId || s.estadiaId === p.fila?.estadiaId));
                    li = compararCargo(fila, lista(l.fila?.servicios).map(s => ({
                        concepto: s.concepto === "masaje" && s.tipo && s.duracion_minutos
                            ? `Masaje ${s.tipo} ${s.duracion_minutos} min` : s.nombre_catalogo || s.tipo || s.concepto,
                        fecha: s.fecha || s.fecha_servicio, monto: dinero(s.monto), origen: s.coordenadas_origen || l.fila.origen
                    })));
                }
            }
            const destino = general ? null : p.fila && { reservaId: p.fila.reservaId,
                estadiaId: p.fila.estadiaId, cabana: p.fila.cabana, fecha: p.fila.entrada };
            return { ...fila, titular: fila.titular || (p.evidencia === "id" ? p.fila.titular : null),
                proyecto: ph, libro: li, destino, pagoIncorporable: pagoIncorporable(fila, p.fila, l.fila, destino, ph, li, alojamiento) };
        };
        return filas.map(compararFila);
    }

    const api = Object.freeze({ parsearXLSX, parsearPDF, esPDFNotas: paginas => paginas.some(p => cabeceraNotas(p)), esSolicitud,
        preparar, comparar, destinosProyecto, agruparPagos, cotejarPagoAlojamiento, medioComprobante, gruposMovimiento,
        titulos, dia, cab, pesos, datoEstadia, estado, normalizar, idCloudbeds });
    root.HAIKU_CLOUDBEDS_INFORMES_V1 = api;
    if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
