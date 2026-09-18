(function (root) {
    "use strict";
    const S = root.HAIKU_LIBRO_SEMANTICA;
    const D = root.HAIKU_LIBRO_PAGOS_DESTINOS_V1;
    if (!S) return;

    const money = v => v === null || v === undefined ? "monto no determinado" : `$${Number(v).toLocaleString("es-CL")} CLP`;
    const source = x => `${x?.hoja || ""}!${x?.celda || ""}`;
    const formatoFechaChile = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit"
    });
    function fechaCalendarioChile(valor) {
        const texto = String(valor || "").trim();
        if (!texto) return "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
        const fecha = new Date(texto);
        if (!Number.isFinite(fecha.getTime())) return texto.slice(0, 10);
        const partes = Object.fromEntries(formatoFechaChile.formatToParts(fecha).map(x => [x.type, x.value]));
        return `${partes.year}-${partes.month}-${partes.day}`;
    }
    function mismaFechaCalendario(a, b) {
        const literalA = String(a || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "";
        const literalB = String(b || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "";
        // Hay fechas históricas guardadas como medianoche UTC para representar
        // un día, y timestamps reales que deben leerse en la zona de Chile.
        return Boolean(literalA && literalB) && (literalA === literalB ||
            fechaCalendarioChile(a) === fechaCalendarioChile(b));
    }
    const contextoVisualPlanes = new WeakMap();
    const nombresMes = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    const etiquetas = {
        sin_checkin: "Sin Check-In según texto negro",
        hospedada: "Hospedada según texto blanco",
        checked_out: "Checked Out según texto azul",
        no_determinado: "No determinado",
        confirmada_por_color: "Confirmada según fondo lila",
        pendiente_por_color: "Pendiente de confirmación según fondo rosado"
    };

    function interpretar(texto, hojas) {
        const t = S.normalizar(texto), warnings = [];
        const fechas = [...t.matchAll(/\b\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2})\b/g)].map(m => S.fechaTexto(m[0]));
        const isoDates = [...t.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(m => m[0]);
        if (isoDates.length) fechas.push(...isoDates);
        let desde = fechas[0], hasta = fechas[1] || fechas[0];
        const monthMatch = t.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
        const month = monthMatch ? nombresMes.indexOf(monthMatch[1] === "setiembre" ? "septiembre" : monthMatch[1]) : -1;
        const literal = hojas.find(h => /^[a-z]{3}\s*\d{2}$/.test(S.normalizar(h)) && t.replace(/\s/g, "").includes(S.normalizar(h).replace(/\s/g, "")));

        if (!desde && month >= 0) {
            const year = t.match(/\b20\d{2}\b/)?.[0] || new Date().getFullYear();
            if (!t.match(/\b20\d{2}\b/)) warnings.push(`Interpreto el mes en ${year}; indica otro año si corresponde.`);
            const days = t.match(/\b(?:del?|el)\s+(\d{1,2})(?:\s+al\s+(\d{1,2}))?\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)/);
            desde = S.iso(year, month + 1, days?.[1] || 1);
            hasta = days ? S.iso(year, month + 1, days[2] || days[1]) : new Date(Date.UTC(Number(year), month + 1, 0)).toISOString().slice(0, 10);
        }

        if (!desde && literal && /^([a-z]{3})\s*(\d{2})$/i.test(literal)) {
            const m = literal.match(/^([a-z]{3})\s*(\d{2})$/i), mo = S.meses.indexOf(m[1].toLowerCase());
            if (mo >= 0) {
                desde = S.iso(2000 + Number(m[2]), mo + 1, 1);
                hasta = new Date(Date.UTC(2000 + Number(m[2]), mo + 1, 0)).toISOString().slice(0, 10);
            }
        }

        if (fechas.some(x => !x) || (desde && (!S.iso(...desde.split("-")) || !S.iso(...hasta.split("-")) || hasta < desde))) {
            throw new Error("Revisa las fechas: el intervalo no es válido.");
        }

        if (hasta && /inclu\w*\s+(?:el\s+)?lunes/.test(t)) {
            const dia = new Date(hasta + "T12:00:00Z").getUTCDay();
            if (dia === 0) hasta = S.sumarDias(hasta, 1);
            else if (dia !== 1) throw new Error("Indica la fecha del lunes que quieres incluir.");
        }

        if (desde && (Date.parse(hasta) - Date.parse(desde)) / 86400000 > 62) {
            throw new Error("Consulta como máximo 62 días a la vez.");
        }

        let seleccion = [];
        if (desde) {
            for (let d = desde; d <= hasta; d = S.sumarDias(d, 1)) {
                const key = S.meses[Number(d.slice(5, 7)) - 1] + d.slice(2, 4);
                const h = hojas.find(h => S.normalizar(h).replace(/\s/g, "") === key);
                if (!h) throw new Error(`No encuentro la hoja ${key} en el Libro cargado.`);
                if (!seleccion.includes(h)) seleccion.push(h);
            }
        }

        const guest = t.match(/\b(?:reserva|huesped|titular)\s+(?:de\s+)?(.+?)(?=\s+(?:del?\s+cab|en\s+cab|cab\s*\d|el\s+\d|del?\s+\d|y\s+(?:dime|compara|revisa))|[?.]|$)/)?.[1]?.trim();
        const nombre = guest && !/^(libro|reservas|que|del|actual|anterior|faltan|nuevas|cancelad)/.test(guest) ? guest : null;

        if (!seleccion.length && nombre) {
            seleccion = hojas.filter(h => /^([a-z]{3})\s*\d{2}$/i.test(S.normalizar(h)) && S.meses.includes(S.normalizar(h).slice(0, 3)));
            warnings.push("Búsqueda por nombre en las hojas mensuales; se omiten hojas con geometría desconocida.");
        }

        const listar = /(?:lista|cuales|que)\b.*\bhojas\b/.test(t);
        if (!seleccion.length && !listar) {
            throw new Error("Indica una fecha completa, un mes con año o un titular. Ejemplo: «Libro: CAB 6 el 05-09-26».");
        }

        const soloPagos = /\b(?:proyecto h|sistema|supabase)\b/.test(t) &&
            /^(?:(?:haku[, :]*)?\s*libro\s*:\s*)?(?:(?:compara|revisa)\s+(?:(?:solo|solamente|exclusivamente|los)\s+)*pagos?\b|pagos?\b.*\b(?:vs|contra|con)\b)/.test(t);
        return {
            texto, desde, hasta, hojas: seleccion, nombre,
            solo_pagos: soloPagos,
            cabana: Number(t.match(/\b(?:cab|cabana)\s*(\d{1,2})\b/)?.[1]) || null,
            listar,
            versiones: /cambio|cambios|version|anterior/.test(t),
            comparar: /compara|sistema|supabase|proyecto h|calendario|incorpor|agreg|registr/.test(t),
            escribir: /\b(agrega|agregar|crea|crear|registra|registrar|incorpora|incorporar|modifica|modificar|borra|borrar|elimina|eliminar)\b/.test(t),
            aseo: /aseo|reviso|revision|camarero/.test(t),
            libres: /vender|libres|disponib/.test(t),
            checkedout: /checked\s*out/.test(t),
            pendientes: /pendiente|bove|manager/.test(t),
            alertas: /alerta|solicitud|nota/.test(t),
            warnings
        };
    }

    function coincidenciasAnotaciones(items, nombre) {
        const filas = new Set(items.filter(a => S.normalizar(a.texto_original).includes(nombre)).map(a => a.origen.fila));
        return items.filter(a => filas.has(a.origen.fila));
    }

    function rangoReserva(r) {
        const ocupadas = Array.isArray(r?.fechas_ocupadas) ? r.fechas_ocupadas.filter(Boolean) : [];
        const checkin = r?.fecha_checkin || ocupadas[0] || null;
        let checkout = r?.fecha_checkout || null;
        if (!checkout && checkin) {
            if (r?.tipo_estadia === "full_day") checkout = checkin;
            else if (ocupadas.length) checkout = S.sumarDias(ocupadas.at(-1), 1);
        }
        return { checkin, checkout, ocupadas };
    }

    function filtrar(r, q) {
        if (q.cabana && !(r?.cabanas || [r?.cabana]).some(c => Number(c) === Number(q.cabana))) return false;
        if (q.nombre && !S.normalizar(r?.titular).includes(q.nombre)) return false;
        if (!q.desde) return true;
        const rango = rangoReserva(r);
        if (rango.ocupadas.some(d => d >= q.desde && d <= q.hasta)) return true;
        return Boolean(rango.checkin && rango.checkout && rango.checkin <= q.hasta && rango.checkout >= q.desde);
    }

    function tituloRealReserva(r) {
        const actual = S.normalizar(r?.titular);
        const etiquetasNoTitular = /^(cliente frecuente|x hacer|por hacer|pendiente|sin titular)$/;
        if (!etiquetasNoTitular.test(actual)) return r;

        const partes = String(r?.texto_original || "").split(/\s*\/\/\s*|\n/).map(x => x.trim()).filter(Boolean);
        const candidato = partes.find(x => {
            const n = S.normalizar(x);
            return !etiquetasNoTitular.test(n) &&
                !/^(full\s*day|promo\b|voucher\b|lista arcoiris|booking\b)/.test(n) &&
                /^[\p{L}][\p{L}\s.'’()-]+$/u.test(x) &&
                x.split(/\s+/).length >= 2;
        });
        return candidato ? { ...r, titular: candidato } : r;
    }

    function cabanaNumero(v) {
        if (Number.isFinite(Number(v)) && Number(v) > 0) return Number(v);
        const m = String(v || "").match(/\b(\d{1,2})\b/);
        return m ? Number(m[1]) : null;
    }

    function normalizarReservaComparacion(r) {
        const base = tituloRealReserva(r || {});
        const rango = rangoReserva(base);
        const ocupadas = rango.ocupadas.length
            ? rango.ocupadas
            : (rango.checkin ? [rango.checkin] : []);
        return {
            ...base,
            cabana: cabanaNumero(base.cabana),
            fecha_checkin: rango.checkin,
            fecha_checkout: rango.checkout,
            fechas_ocupadas: ocupadas,
            pagos: Array.isArray(base.pagos) ? base.pagos : [],
            pagos_sin_asociacion: Array.isArray(base.pagos_sin_asociacion) ? base.pagos_sin_asociacion : [],
            servicios: Array.isArray(base.servicios) ? base.servicios : [],
            advertencias: Array.isArray(base.advertencias) ? base.advertencias : []
        };
    }

    function esReservaValida(r) {
        if (!r?.titular || !r?.fecha_checkin || !r?.fecha_checkout || !cabanaNumero(r?.cabana)) return false;
        if (![r.fecha_checkin, r.fecha_checkout].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && S.iso(...d.split("-")) === d) || r.fecha_checkout < r.fecha_checkin) return false;
        const n = S.normalizar(r.titular);
        return !/^(x hacer|por hacer|cliente frecuente|sin titular|libre|full day|cancelad)/.test(n);
    }

    function digitos(v) {
        return String(v || "").replace(/\D/g, "");
    }

    function telefonoCanon(v) {
        let d = digitos(v);
        if (d.startsWith("5656") && d.length > 10) d = "56" + d.slice(4);
        return d;
    }

    function telefonoCompatible(a, b) {
        if (!a || !b) return true;
        const da = telefonoCanon(a), db = telefonoCanon(b);
        if (!da || !db) return true;
        if (da === db) return true;
        const masked = /\*/.test(String(a)) || /\*/.test(String(b)) || Math.min(da.length, db.length) <= 4;
        return masked && da.length >= 4 && db.length >= 4 && da.slice(-4) === db.slice(-4);
    }

    function estadoEstadiaCompatible(libro, sistema) {
        const l = S.normalizar(libro), s = S.normalizar(sistema);
        if (!l || l === "no_determinado" || !s) return true;
        if (l === "sin_checkin") return /confirm|pendiente|reservad/.test(s);
        if (l === "hospedada") return /hospedad|check.?in/.test(s);
        if (l === "checked_out") return /checked.?out|checkout/.test(s);
        return true;
    }

    function normalizarId(v) {
        return String(v || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    }

    function medioLibro(p) {
        return ({
            transferencia: 'transferencia', debito: 'tarjeta_debito', credito: 'tarjeta_credito',
            webpay_debito: 'webpay_debito', webpay_credito: 'webpay_credito', tarjeta_debito: 'tarjeta_debito',
            tarjeta_credito: 'tarjeta_credito', efectivo: 'efectivo'
        })[p?.medio_pago];
    }

    function medioSistema(p) {
        const medio = String(p?.medio_pago || '').toLowerCase().replace(/[\s-]+/g, '_');
        return ({
            transferencia: 'transferencia', debito: 'tarjeta_debito', credito: 'tarjeta_credito',
            webpay_debito: 'webpay_debito', webpay_credito: 'webpay_credito', tarjeta_debito: 'tarjeta_debito',
            tarjeta_credito: 'tarjeta_credito', efectivo: 'efectivo'
        })[medio] || medio || null;
    }

    function documentoCanon(v) {
        return normalizarId(v).replace(/^0+/, "");
    }

    function identidad(a, b) {
        const docA = documentoCanon(a.rut_documento), docB = documentoCanon(b.rut_documento);
        const correoA = S.normalizar(a.correo), correoB = S.normalizar(b.correo);
        const telA = telefonoCanon(a.telefono), telB = telefonoCanon(b.telefono);
        const conflicto = Boolean(docA && docB && docA !== docB);
        const fuerte = Boolean((docA && docA === docB) || (correoA && correoA === correoB) ||
            (telA.length >= 9 && telB.length >= 9 && telA === telB));
        const nombre = S.mismaPersona(a.titular, b.titular);
        return { compatible: !conflicto && (fuerte || nombre), fuerte: fuerte && !conflicto, conflicto };
    }

    const mismasFechas = (a, b) => a.fecha_checkin === b.fecha_checkin && a.fecha_checkout === b.fecha_checkout &&
        (a.fecha_checkin === a.fecha_checkout) === (b.fecha_checkin === b.fecha_checkout);

    function puntuarCandidato(reserva, sistema) {
        const fechas = reserva.fecha_checkin === sistema.fecha_checkin && reserva.fecha_checkout === sistema.fecha_checkout;
        const cab = Number(reserva.cabana) === Number(sistema.cabana);
        const persona = identidad(reserva, sistema);
        return {
            s: sistema,
            segura: !reserva.advertencias?.length && cab && fechas && persona.compatible,
            posible: (cab && fechas) || persona.compatible
        };
    }

    function asociarConservador(reserva, candidatas) {
        const scores = candidatas.filter(candidatoElegible).map(s => puntuarCandidato(reserva, s));
        const seguros = scores.filter(x => x.segura);
        if (seguros.length === 1) return { estado: "asociada", sistema: seguros[0].s, categoria: "coincide", confianza: "alta" };
        const posibles = scores.filter(x => x.posible).map(x => x.s);
        let categoria = "reserva_faltante", confianza = "alta", pregunta = null;
        if (posibles.length || reserva.advertencias?.length) {
            categoria = "ambiguo"; confianza = "baja";
            if (posibles.length === 1 && !reserva.advertencias?.length) {
                const s = posibles[0];
                categoria = !identidad(reserva, s).compatible ? "modificacion_titular" :
                    mismasFechas(reserva, s) ? "posible_cambio_cabana" : "modificacion_fechas_o_independiente";
                confianza = "media";
            }
            pregunta = categoria === "posible_cambio_cabana" ? "¿Es una estadía adicional o una reserva independiente? Hay identidad compatible y distinta CAB." :
                categoria === "modificacion_titular" ? "¿Es la misma reserva? Coinciden CAB y fechas, pero hay datos de identidad en conflicto; revisa la comparación por campos." :
                categoria === "modificacion_fechas_o_independiente" ? "¿Es una estadía adicional o una reserva independiente? Hay identidad compatible y fechas diferentes." :
                "¿Cuál de los candidatos corresponde, o es una reserva independiente?";
        }
        return {
            estado: categoria === "reserva_faltante" ? "sin_coincidencia" : "ambigua",
            categoria, confianza, pregunta, candidatosDetalle: posibles,
            candidatos: posibles.map(x => x.id)
        };
    }

    function candidatoElegible(s) {
        const estado = S.normalizar(`${s.estado_reserva || ""} ${s.estado_operativo || ""}`);
        const titular = S.normalizar(s.titular).replace(/_/g, " ");
        return !/cancelad|cancelled|canceled|no[\s_-]*show/.test(estado) &&
            !/\b(pruebas?|demo|test|testing)\b/.test(titular);
    }

    // La decisión no altera la comparación original. En la preparación puede
    // aportar una reserva_id explícita para revalidar cambios y pagos con las
    // mismas reglas estrictas, antes de mostrar cualquier escritura.
    function preguntaPresentacion(g) {
        const pendientes = g.items.filter(i => i.estado !== "asociada");
        const sistemasAsociados = g.items.map(i => i.sistema).filter(Boolean);
        const candidatosBase = pendientes.flatMap(i => i.candidatosDetalle?.length ? i.candidatosDetalle : sistemasAsociados);
        const candidatos = [...new Map(candidatosBase
            .filter(Boolean).map(c => [c.id, c])).values()];
        const avisos = [...new Set(pendientes.flatMap(i => i.libro.advertencias || []))];
        const comparaciones = [];
        const opciones = [{ valor: "", categoria: "pendientes", texto: "Dejar pendiente", efecto: "no se incorpora" }];
        for (const c of candidatos) {
            const relevantes = pendientes.filter(i => i.candidatosDetalle?.some(x => x.id === c.id) ||
                (!i.candidatosDetalle?.length && g.categoria === "estadia_faltante" && identidad(i.libro, c).compatible));
            for (const i of relevantes) {
                const r = i.libro;
                const campos = [
                    ["Nombre", r.titular, c.titular, S.mismaPersona],
                    ["CAB", r.cabana, c.cabana, (a, b) => Number(a) === Number(b)],
                    ["Check-In", r.fecha_checkin, c.fecha_checkin],
                    ["Check-Out", r.fecha_checkout, c.fecha_checkout],
                    ["RUT/documento", r.rut_documento, c.rut_documento, (a, b) => documentoCanon(a) === documentoCanon(b)],
                    ["Correo", r.correo, c.correo, (a, b) => S.normalizar(a) === S.normalizar(b)],
                    ["Teléfono", r.telefono, c.telefono, (a, b) => telefonoCanon(a) === telefonoCanon(b)]
                ].map(([campo, libro, proyecto, igual = (a, b) => a === b]) => ({ campo, libro, proyecto,
                    estado: !String(libro ?? "").trim() || !String(proyecto ?? "").trim() ? "— sin dato" :
                        igual(libro, proyecto) ? "✅ coincide" : "⚠️ difiere" }));
                const exacta = mismasFechas(r, c) && Number(r.cabana) === Number(c.cabana);
                const conflicto = identidad(r, c).conflicto;
                const razon = exacta ? conflicto ? "Coinciden CAB y fechas, pero el RUT/documento difiere. Esto impide la asociación automática." :
                    !identidad(r, c).compatible ? "Coinciden CAB y fechas, pero no hay identidad compatible suficiente para asociar automáticamente." :
                    r.advertencias?.length ? "Coinciden identidad, CAB y fechas, pero las advertencias del Libro indicadas arriba impiden asociar automáticamente." :
                    candidatos.length > 1 ? "Coinciden identidad, CAB y fechas, pero hay varios candidatos posibles. Elige la referencia correcta." :
                    g.pregunta || "La asociación no es única dentro del grupo; requiere revisión." :
                    "Hay identidad compatible, pero CAB o fechas diferentes: podría ser una extensión o segunda estadía. Se conservaría la estadía existente.";
                comparaciones.push({ candidato: c, campos, razon });
                const categoria = exacta ? "asociadas" : "estadias";
                const valor = `${exacta ? "asociar" : "estadia"}:${c.id}`;
                const yaRepresentada = g.items.some(j => j.sistema && j.sistema.reserva_id === c.reserva_id &&
                    mismasFechas(r, j.sistema) && Number(r.cabana) === Number(j.sistema.cabana));
                if ((exacta || (identidad(r, c).compatible && !yaRepresentada)) && !opciones.some(o => o.valor === valor)) opciones.push({ valor, categoria,
                    texto: exacta ? "Es la misma reserva" : "Añadir esta estadía a la reserva existente",
                    efecto: exacta ? "actualizará esta reserva con los datos del Libro después de revisar y confirmar los cambios; no crea otra reserva" :
                        "conservaría la reserva actual y propondría sumar CAB/fechas, sin reemplazar la estadía existente",
                    destino: `${c.titular} · CAB ${c.cabana} · ${c.fecha_checkin} → ${c.fecha_checkout} · referencia ${c.id}` });
                if (!exacta && identidad(r, c).compatible && !opciones.some(o => o.valor === `actualizar:${c.id}`)) opciones.push({
                    valor: `actualizar:${c.id}`, categoria: 'asociadas', texto: 'Es la misma estadía: corregir CAB/fechas y datos con el Libro',
                    efecto: 'reemplazará los datos de esta estadía tras tu confirmación, conservando su historial y comprobando disponibilidad',
                    destino: `${c.titular} · CAB ${c.cabana} · ${c.fecha_checkin} → ${c.fecha_checkout} · referencia ${c.id}` });
            }
        }
        opciones.push(candidatos.length ? { valor: "independiente", categoria: "independientes",
            texto: opciones.some(o => o.categoria === "estadias") ? "Son reservas independientes" : "Son reservas distintas",
            efecto: "no asocia con la existente; propondría una reserva separada para la estadía del Libro" } :
            { valor: "nueva", categoria: "nuevas", texto: "Tratar como reserva nueva", efecto: "propondría crear una nueva reserva" });
        return { comparaciones, opciones, razon: candidatos.length ?
            "Revisa Libro vs Proyecto H y elige cómo tratar esta reserva en la vista previa." :
            "No hay candidato real en Proyecto H. No se marcó automáticamente como faltante porque el Libro tiene advertencias.", avisos };
    }

    function claveReserva(r) {
        const doc = normalizarId(r.rut_documento);
        const correo = S.normalizar(r.correo);
        const tel = telefonoCanon(r.telefono).slice(-8);
        const identidad = doc || correo || `${S.normalizar(r.titular)}|${tel}`;
        return `${identidad}|${r.fecha_checkin}|${r.fecha_checkout}|${r.tipo_estadia || ""}|cab${r.cabana}`;
    }

    function claveEvidenciaServicio(item) {
        const servicio=item.servicio || {},reserva=item.reserva || {};
        const origen=servicio.origen || reserva.coordenadas_origen;
        const procedencia=origen?.hoja && origen?.celda ? source(origen) : `reserva:${reserva.id || claveReserva(reserva)}`;
        return [procedencia,S.normalizar(servicio.concepto),S.normalizar(servicio.texto_original),servicio.hora || '',
            servicio.monto ?? '',Boolean(servicio.pendiente),Boolean(servicio.cortesia),item.estado || ''].join('|');
    }

    function serviciosComparacionUnicos(items) {
        const unicos=new Map();
        for (const item of items) {
            const key=claveEvidenciaServicio(item);
            if (!unicos.has(key)) unicos.set(key,item);
        }
        return [...unicos.values()];
    }

    function serviciosReservaUnicos(reservas) {
        return serviciosComparacionUnicos(reservas.flatMap(reserva =>
            (reserva.servicios || []).map(servicio => ({servicio,reserva})))).map(item=>item.servicio);
    }

    function agruparComparacion(resultados) {
        const mapa = [];
        for (const c of resultados) {
            // Complete-link grouping prevents a shared contact from bridging conflicting identities.
            const compatibles = mapa.filter(g => g.items.every(x => mismasFechas(x.libro, c.libro) &&
                identidad(x.libro, c.libro).compatible && Number(x.libro.cabana) !== Number(c.libro.cabana)));
            if (compatibles.length === 1) compatibles[0].items.push(c);
            else mapa.push({ clave: claveReserva(c.libro), items: [c] });
        }
        return mapa.map(g => {
            const principal = g.items[0].libro;
            const estados = g.items.map(x => x.estado);
            const ids = new Set(g.items.filter(x => x.sistema).map(x =>
                x.sistema.grupo_reserva_id ? `grupo:${x.sistema.grupo_reserva_id}` : `reserva:${x.sistema.reserva_id}`));
            const estado = estados.every(x => x === "asociada") && ids.size === 1 ? "asociada" :
                estados.every(x => x === "sin_coincidencia") ? "sin_coincidencia" : "ambigua";
            const parcial = ids.size === 1 && estados.includes("asociada") && estados.some(x => x !== "asociada");
            return {
                ...g,
                estado,
                principal,
                categoria: parcial ? "estadia_faltante" : g.items.length > 1 && estado === "ambigua" ? "ambiguo" : g.items[0].categoria,
                confianza: g.items.length === 1 ? g.items[0].confianza : estado === "ambigua" ? (parcial ? "media" : "baja") : "alta",
                pregunta: parcial ? "La reserva ya existe: ¿añadir la cabaña indicada o corregir una asignación?" : g.items.find(x => x.pregunta)?.pregunta || (estado === "ambigua" ? "¿Son reservas independientes o un solo grupo?" : null),
                cabanas: [...new Set(g.items.map(x => Number(x.libro.cabana)).filter(Boolean))].sort((a, b) => a - b),
                diferencias: [...new Set(g.items.flatMap(x => x.diferencias || []))],
                pagos: g.items.flatMap(x => x.pagosComparacion || []),
                servicios: serviciosComparacionUnicos(g.items.flatMap(x => x.serviciosComparacion || []))
            };
        });
    }

    async function paginas(build, campoOrden = "id") {
        const rows = [];
        for (let start = 0; start < 5000; start += 500) {
            const { data, error } = await build().order(campoOrden).range(start, start + 499);
            if (error) throw new Error("No se pudo consultar Proyecto H con tu sesión. No se concluye que falten registros.");
            if (!Array.isArray(data)) throw new Error("Respuesta incompleta de Proyecto H.");
            rows.push(...data);
            if (data.length < 500) return rows;
        }
        throw new Error("La consulta supera el límite seguro de registros; reduce las fechas.");
    }

    function pagoTieneIdentificadorFuerte(p) {
        return Boolean(normalizarId(p?.codigo_autorizacion) || (normalizarId(p?.folio) && normalizarId(p?.bovtar)));
    }

    function bovtarSistemaCoincide(p, x) {
        const esperado = normalizarId(p?.bovtar);
        if (!esperado) return false;
        // Los pagos históricos guardaron la autorización/BOVTAR en `pagos.bove`.
        // Sólo se usa ese campo junto con un Folio del Libro; un BOVE aislado
        // continúa siendo administrativo y nunca identifica un pago.
        return [x?.datos_origen?.bovtar, x?.datos_origen?.autorizacion, x?.bovtar, x?.bove]
            .some(valor => normalizarId(valor) === esperado);
    }

    function pagoCoincide(p, x) {
        if (normalizarId(p?.codigo_autorizacion) && normalizarId(x?.codigo_autorizacion) === normalizarId(p.codigo_autorizacion)) return true;
        if (normalizarId(p?.folio) && normalizarId(p?.bovtar) && normalizarId(x?.folio) === normalizarId(p.folio) && bovtarSistemaCoincide(p, x)) return true;
        return false;
    }

    function candidatoServicioAplicado(pagoLibro, reservaId, pagos) {
        if (pagoLibro?.tipo_movimiento !== "servicio" || !pagoTieneIdentificadorFuerte(pagoLibro) ||
            pagoLibro.pago_recibido !== true || pagoLibro.estado_pago !== "registrado_en_libro" ||
            !Number.isSafeInteger(Number(pagoLibro.monto)) || Number(pagoLibro.monto) <= 0 || !reservaId) {
            return { sospechoso: false, candidato: null };
        }
        const codigo = normalizarId(pagoLibro.codigo_autorizacion);
        const folio = normalizarId(pagoLibro.folio);
        const bovtar = normalizarId(pagoLibro.bovtar);
        const autorizaciones = pago => [...new Set([pago?.codigo_autorizacion, pago?.datos_origen?.autorizacion,
            pago?.datos_origen?.bovtar, pago?.bovtar, pago?.bove].map(normalizarId).filter(Boolean))];
        const relacionado = pago => Boolean(codigo && normalizarId(pago?.codigo_autorizacion) === codigo ||
            folio && normalizarId(pago?.folio) === folio || bovtar && autorizaciones(pago).includes(bovtar));
        const identidadCompleta = pago => {
            if (codigo) return normalizarId(pago?.codigo_autorizacion) === codigo &&
                (!folio || normalizarId(pago?.folio) === folio);
            if (!folio || !bovtar || normalizarId(pago?.folio) !== folio) return false;
            const valores = autorizaciones(pago);
            return valores.includes(bovtar) && valores.every(valor => valor === bovtar);
        };
        const relacionados = pagos.filter(pago => pago?.id && relacionado(pago));
        if (new Set(relacionados.map(pago => pago.id)).size !== 1) {
            return { sospechoso: relacionados.length > 0, candidato: null };
        }
        const candidato = relacionados[0];
        const moneda = pago => String(pago?.moneda || "").trim().toUpperCase();
        const monedaLibro = moneda(pagoLibro), monedaSistema = moneda(candidato);
        const medioPagoLibro = medioLibro(pagoLibro), medioPagoSistema = medioSistema(candidato);
        const compatible = identidadCompleta(candidato) && S.normalizar(candidato.estado) === "confirmado" &&
            S.normalizar(candidato.tipo_movimiento) === "pago" && candidato.reserva_id === reservaId &&
            Number.isSafeInteger(Number(candidato.monto)) && Number(candidato.monto) === Number(pagoLibro.monto) &&
            Boolean(monedaLibro && monedaSistema && monedaLibro === monedaSistema) &&
            Boolean(medioPagoLibro && medioPagoSistema && medioPagoLibro === medioPagoSistema);
        return { sospechoso: true, candidato: compatible ? candidato : null };
    }

    function pagoSistemaVigente(pago) {
        const estado = S.normalizar(pago?.estado);
        // Los registros históricos y los dobles de prueba pueden no traer estado.
        // Si existe un estado explícito, sólo "confirmado" representa dinero vigente.
        return !estado || estado === "confirmado";
    }

    function pagoEfectivoLibroAplicable(pago, reserva, sistema) {
        return !pagoTieneIdentificadorFuerte(pago) && pago?.clasificacion_financiera !== "dudoso" &&
            medioLibro(pago) === "efectivo" && ["alojamiento", "servicio"].includes(pago.tipo_movimiento) &&
            pago.pago_recibido === true && pago.estado_pago === "registrado_en_libro" &&
            Number.isSafeInteger(Number(pago.monto)) && Number(pago.monto) > 0 &&
            String(pago.moneda || "CLP").toUpperCase() === "CLP" &&
            Number(pago.cabana) === Number(reserva.cabana) && Number(reserva.cabana) === Number(sistema.cabana) &&
            pago.fecha_bloque === reserva.fecha_checkin && reserva.fecha_checkin === sistema.fecha_checkin &&
            reserva.fecha_checkout === sistema.fecha_checkout;
    }

    function cargoAlojamientoCompatible(cargo, reserva, sistema) {
        if (cargo?.reserva_id !== sistema.reserva_id || cargo?.estadia_id !== sistema.id ||
            cargo?.tipo_cargo !== "alojamiento" || S.normalizar(cargo.estado) !== "activo" ||
            !(Number(cargo.monto_ajustado ?? cargo.monto) > 0)) return false;
        const concepto = S.normalizar(cargo.concepto);
        const fecha = S.fechaTexto(cargo.concepto);
        const fullDay = reserva.tipo_estadia === "full_day" || reserva.fecha_checkin === reserva.fecha_checkout;
        if (fullDay) return /\bfull\s*day\b/.test(concepto) && fecha === reserva.fecha_checkin;
        return !/\bfull\s*day\b/.test(concepto) && Boolean(fecha) &&
            fecha >= reserva.fecha_checkin && fecha < reserva.fecha_checkout;
    }

    function cargoServicioCompatible(cargo, servicio, pago, reserva, sistema) {
        if (!D?.conceptoCanon || cargo?.reserva_id !== sistema.reserva_id || cargo?.estadia_id !== sistema.id ||
            cargo?.servicio_id !== servicio?.id || cargo?.tipo_cargo !== "servicio" ||
            S.normalizar(cargo.estado) !== "activo" || servicio?.reserva_id !== sistema.reserva_id ||
            servicio?.estadia_id !== sistema.id || /cancelad|no.?show/.test(S.normalizar(servicio?.estado_servicio)) ||
            !(Number(cargo.monto_ajustado ?? cargo.monto) > 0) || !(Number(servicio?.total) > 0)) return false;
        const conceptoLibro = D.conceptoCanon(pago.concepto);
        const catalogo = servicio.catalogo_servicios || {};
        const conceptoSistema = D.conceptoCanon([cargo.concepto, catalogo.codigo, catalogo.nombre, catalogo.categoria]
            .filter(Boolean).join(" "));
        if (!conceptoLibro || conceptoLibro !== conceptoSistema) return false;
        const fechaLibro = pago.fecha_comprobante || pago.fecha_bloque || null;
        return !(fechaLibro && servicio.fecha_servicio && fechaLibro !== servicio.fecha_servicio) &&
            Number(reserva.cabana) === Number(sistema.cabana);
    }

    async function reconciliarEfectivosAplicados(resultados, pagos, servicios, cliente) {
        const movimientos = resultados.flatMap(resultado => resultado.pagosComparacion
            .filter(item => item.estado === "revisar" && resultado.estado === "asociada" &&
                pagoEfectivoLibroAplicable(item.pago, resultado.libro, resultado.sistema))
            .map(item => ({ item, resultado })));
        const moneda = pago => String(pago?.moneda || "CLP").trim().toUpperCase();
        const medioWebpay = pago => ["webpay_credito", "webpay_debito"].includes(
            typeof pago === "string" ? pago : medioSistema(pago));
        const identificadorFuerteSistema = pago => Boolean(normalizarId(pago?.codigo_autorizacion) ||
            normalizarId(pago?.folio) && [pago?.datos_origen?.bovtar, pago?.datos_origen?.autorizacion,
                pago?.bovtar, pago?.bove].some(normalizarId));
        const pagoHistoricoLibroAplicable = (pago, resultado) => resultado.estado === "asociada" &&
            pagoTieneIdentificadorFuerte(pago) && pago?.tipo_movimiento === "alojamiento" &&
            pago?.pago_recibido === true && pago?.estado_pago === "registrado_en_libro" &&
            Number.isSafeInteger(Number(pago?.monto)) && Number(pago.monto) > 0 && Boolean(moneda(pago)) &&
            medioWebpay(medioLibro(pago));
        const mismoImporteReserva = (pago, movimiento) => pago?.id &&
            pago.reserva_id === movimiento.resultado.sistema.reserva_id &&
            Number(pago.monto) === Number(movimiento.item.pago.monto) &&
            moneda(pago) === moneda(movimiento.item.pago);
        const movimientosHistoricos = resultados.flatMap(resultado => resultado.pagosComparacion
            .filter(item => !["en_sistema", "diferente"].includes(item.estado) &&
                pagoHistoricoLibroAplicable(item.pago, resultado))
            .map(item => ({ item, resultado })))
            .filter(movimiento => pagos.some(pago => mismoImporteReserva(pago, movimiento)));
        // Si existe dinero del mismo importe en la reserva, una coincidencia histórica
        // que no pueda demostrarse nunca debe conservar la clasificación de pago nuevo.
        for (const movimiento of movimientosHistoricos) movimiento.item.estado = "revisar";

        const candidatosSistema = movimiento => pagos.filter(pago => pago?.id &&
            S.normalizar(pago.estado) === "confirmado" && pago.reserva_id === movimiento.resultado.sistema.reserva_id &&
            S.normalizar(pago.tipo_movimiento) === "pago" &&
            medioSistema(pago) === "efectivo" && Number(pago.monto) === Number(movimiento.item.pago.monto) &&
            moneda(pago) === moneda(movimiento.item.pago));
        const candidatosUnicos = movimientos.map(movimiento => ({
            ...movimiento,
            pagos: candidatosSistema(movimiento)
        })).filter(movimiento => movimiento.pagos.length === 1);
        const candidatosHistoricos = movimientosHistoricos.map(movimiento => ({
            ...movimiento,
            pagos: pagos.filter(pago => mismoImporteReserva(pago, movimiento) &&
                S.normalizar(pago.estado) === "confirmado" && S.normalizar(pago.tipo_movimiento) === "pago" &&
                pago.datos_origen?.verificacion_migrada === true && medioWebpay(pago) &&
                !identificadorFuerteSistema(pago))
        })).filter(movimiento => movimiento.pagos.length === 1);
        if (!candidatosUnicos.length && !candidatosHistoricos.length) return null;

        const candidatosLectura = [...candidatosUnicos, ...candidatosHistoricos];
        const reservaIds = [...new Set(candidatosLectura.map(x => x.resultado.sistema.reserva_id))];
        const pagoIds = [...new Set([
            ...candidatosLectura.map(x => x.pagos[0].id),
            ...pagos.filter(pago => reservaIds.includes(pago.reserva_id) && S.normalizar(pago.estado) === "confirmado")
                .map(pago => pago.id)
        ])];
        let cargos, aplicacionesPago, aplicacionesCargo;
        try {
            cargos = await paginas(() => cliente.from("vista_estado_cargos")
                .select("cargo_id,reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,monto_ajustado,aplicado_neto,saldo_cargo,estado,estado_pago")
                .in("reserva_id", reservaIds), "cargo_id");
            const cargoIdsLectura = cargos.filter(cargo => ["alojamiento", "servicio"].includes(cargo.tipo_cargo) && reservaIds.includes(cargo.reserva_id))
                .map(cargo => cargo.cargo_id).filter(Boolean);
            [aplicacionesPago, aplicacionesCargo] = await Promise.all([
                paginas(() => cliente.from("pago_aplicaciones")
                    .select("id,pago_id,cargo_id,monto_aplicado").in("pago_id", pagoIds)),
                cargoIdsLectura.length ? paginas(() => cliente.from("pago_aplicaciones")
                    .select("id,pago_id,cargo_id,monto_aplicado").in("cargo_id", cargoIdsLectura)) : []
            ]);
        } catch (err) {
            return { disponible: false, cargos: [], aplicaciones: [], error: `No fue posible leer las aplicaciones de efectivo: ${err?.message || err}` };
        }

        const cargosFinancieros = cargos.filter(cargo => ["alojamiento", "servicio"].includes(cargo.tipo_cargo) && reservaIds.includes(cargo.reserva_id));
        const serviciosPorId = new Map(servicios.map(servicio => [servicio.id, servicio]));
        const cargoIds = new Set(cargosFinancieros.map(cargo => cargo.cargo_id).filter(Boolean));
        const aplicaciones = [...new Map([...aplicacionesPago, ...aplicacionesCargo]
            .map(aplicacion => [aplicacion.id || `${aplicacion.pago_id}|${aplicacion.cargo_id}`, aplicacion])).values()];
        const propuestas = [];
        for (const movimiento of candidatosUnicos) {
            const pagoLibro = movimiento.item.pago;
            const pagoSistema = movimiento.pagos[0];
            const libroCompatibles = movimientos.filter(otro =>
                otro.resultado.sistema.reserva_id === movimiento.resultado.sistema.reserva_id &&
                Number(otro.item.pago.monto) === Number(pagoLibro.monto) &&
                moneda(otro.item.pago) === moneda(pagoLibro) && medioLibro(otro.item.pago) === "efectivo" &&
                otro.item.pago.tipo_movimiento === pagoLibro.tipo_movimiento &&
                (pagoLibro.tipo_movimiento !== "servicio" ||
                    D?.conceptoCanon(otro.item.pago.concepto) === D?.conceptoCanon(pagoLibro.concepto)) &&
                Number(otro.item.pago.cabana) === Number(pagoLibro.cabana) &&
                otro.item.pago.fecha_bloque === pagoLibro.fecha_bloque);
            if (libroCompatibles.length !== 1) continue;

            const aplicacionesDelPago = aplicaciones.filter(aplicacion => aplicacion.pago_id === pagoSistema.id);
            let cargo, exactas;
            if (pagoLibro.tipo_movimiento === "alojamiento") {
                const cargosCompatibles = cargosFinancieros.filter(candidato =>
                    cargoAlojamientoCompatible(candidato, movimiento.resultado.libro, movimiento.resultado.sistema));
                if (cargosCompatibles.length !== 1) continue;
                cargo = cargosCompatibles[0];
                exactas = aplicacionesDelPago.filter(aplicacion => aplicacion.cargo_id === cargo.cargo_id &&
                    Number(aplicacion.monto_aplicado) === Number(pagoLibro.monto));
            } else {
                exactas = aplicacionesDelPago.filter(aplicacion => {
                    const candidato = cargosFinancieros.find(cargoSistema => cargoSistema.cargo_id === aplicacion.cargo_id);
                    return Number(aplicacion.monto_aplicado) === Number(pagoLibro.monto) && candidato &&
                        cargoServicioCompatible(candidato, serviciosPorId.get(candidato.servicio_id), pagoLibro,
                            movimiento.resultado.libro, movimiento.resultado.sistema);
                });
                if (exactas.length === 1) cargo = cargosFinancieros.find(candidato => candidato.cargo_id === exactas[0].cargo_id);
            }
            if (exactas.length !== 1 || aplicacionesDelPago.length !== 1 || !cargoIds.has(exactas[0].cargo_id)) continue;
            propuestas.push({ ...movimiento, pagoSistema, cargo, aplicacion: exactas[0],
                tipoCoincidencia: pagoLibro.tipo_movimiento === "servicio" ? "servicio" : "alojamiento" });
        }

        const pagosRepetidos = new Set(propuestas.filter((x, i, a) => a.some((y, j) => j !== i && y.pagoSistema.id === x.pagoSistema.id))
            .map(x => x.pagoSistema.id));
        const aplicacionesRepetidas = new Set(propuestas.filter((x, i, a) => a.some((y, j) => j !== i && y.aplicacion.id === x.aplicacion.id))
            .map(x => x.aplicacion.id));
        for (const propuesta of propuestas) {
            if (pagosRepetidos.has(propuesta.pagoSistema.id) || aplicacionesRepetidas.has(propuesta.aplicacion.id)) continue;
            Object.assign(propuesta.item, {
                estado: "en_sistema",
                sistema: propuesta.pagoSistema,
                [propuesta.tipoCoincidencia === "servicio" ? "coincidencia_aplicacion_servicio" : "coincidencia_aplicacion_alojamiento"]: true,
                cargo_sistema: propuesta.cargo,
                aplicacion_sistema: propuesta.aplicacion,
                diferencias: []
            });
        }

        const cargoPorId = new Map(cargosFinancieros.map(cargo => [cargo.cargo_id, cargo]));
        const pagosConfirmadosReserva = reservaId => pagos.filter(pago => pago?.id && pago.reserva_id === reservaId &&
            S.normalizar(pago.estado) === "confirmado");
        for (const movimiento of candidatosHistoricos) {
            const pagoLibro = movimiento.item.pago;
            const pagoSistema = movimiento.pagos[0];
            const reservaId = movimiento.resultado.sistema.reserva_id;
            // El identificador del Libro no puede pertenecer a ningún otro pago global.
            if (pagos.some(pago => pago?.id !== pagoSistema.id && pagoSistemaVigente(pago) && pagoCoincide(pagoLibro, pago))) continue;

            const movimientosReserva = movimiento.resultado.pagosComparacion.filter(item =>
                item.pago?.tipo_movimiento === "alojamiento" && item.pago?.pago_recibido === true &&
                item.pago?.estado_pago === "registrado_en_libro" && Number.isSafeInteger(Number(item.pago?.monto)) &&
                Number(item.pago.monto) > 0 && Boolean(moneda(item.pago)));
            const fuertes = movimientosReserva.filter(item => item.sistema?.id && pagoTieneIdentificadorFuerte(item.pago) &&
                item.sistema.reserva_id === reservaId && pagoCoincide(item.pago, item.sistema));
            const idsFuertes = new Set(fuertes.map(item => item.sistema.id));
            const remanentesLibro = movimientosReserva.filter(item => !fuertes.includes(item));
            const confirmados = pagosConfirmadosReserva(reservaId);
            // Devoluciones, ajustes u otros movimientos impiden demostrar el saldo residual.
            if (confirmados.some(pago => S.normalizar(pago.tipo_movimiento) !== "pago")) continue;
            const remanentesSistema = confirmados.filter(pago => !idsFuertes.has(pago.id));
            if (remanentesLibro.length !== 1 || remanentesLibro[0] !== movimiento.item ||
                remanentesSistema.length !== 1 || remanentesSistema[0].id !== pagoSistema.id) continue;

            const aplicacionesDelPago = aplicaciones.filter(aplicacion => aplicacion.pago_id === pagoSistema.id);
            if (!aplicacionesDelPago.length || aplicacionesDelPago.some(aplicacion => {
                const cargo = cargoPorId.get(aplicacion.cargo_id);
                return !(Number(aplicacion.monto_aplicado) > 0) || !cargo || cargo.reserva_id !== reservaId ||
                    cargo.tipo_cargo !== "alojamiento" || S.normalizar(cargo.estado) !== "activo";
            }) || aplicacionesDelPago.reduce((suma, aplicacion) => suma + Number(aplicacion.monto_aplicado), 0) !==
                Number(pagoSistema.monto)) continue;

            const alojamiento = cargosFinancieros.filter(cargo => cargo.reserva_id === reservaId &&
                cargo.tipo_cargo === "alojamiento" && S.normalizar(cargo.estado) === "activo");
            const totalAlojamiento = alojamiento.reduce((suma, cargo) => suma + Number(cargo.monto_ajustado ?? cargo.monto), 0);
            const aplicadoAlojamiento = alojamiento.reduce((suma, cargo) => suma + Number(cargo.aplicado_neto), 0);
            const saldoAlojamiento = alojamiento.reduce((suma, cargo) => suma + Number(cargo.saldo_cargo), 0);
            const idsAlojamiento = new Set(alojamiento.map(cargo => cargo.cargo_id));
            const idsConfirmados = new Set(confirmados.map(pago => pago.id));
            const aplicacionesConfirmadas = aplicaciones.filter(aplicacion => idsConfirmados.has(aplicacion.pago_id));
            const aplicacionesContables = aplicaciones.filter(aplicacion => idsConfirmados.has(aplicacion.pago_id) &&
                idsAlojamiento.has(aplicacion.cargo_id));
            if (!(totalAlojamiento > 0) || aplicadoAlojamiento !== totalAlojamiento || saldoAlojamiento !== 0 ||
                confirmados.reduce((suma, pago) => suma + Number(pago.monto), 0) !== totalAlojamiento ||
                aplicacionesConfirmadas.some(aplicacion => {
                    const cargo = cargoPorId.get(aplicacion.cargo_id);
                    return !cargo || cargo.reserva_id !== reservaId || cargo.tipo_cargo !== "alojamiento" ||
                        S.normalizar(cargo.estado) !== "activo";
                }) || confirmados.some(pago => aplicacionesConfirmadas
                    .filter(aplicacion => aplicacion.pago_id === pago.id)
                    .reduce((suma, aplicacion) => suma + Number(aplicacion.monto_aplicado), 0) !== Number(pago.monto)) ||
                aplicacionesContables.reduce((suma, aplicacion) => suma + Number(aplicacion.monto_aplicado), 0) !==
                    totalAlojamiento) continue;

            const diferencias = ["Coincidencia histórica migrada."];
            if (medioLibro(pagoLibro) !== medioSistema(pagoSistema)) diferencias.push("medio de pago diferente");
            if (!mismaFechaCalendario(pagoLibro.fecha_comprobante, pagoSistema.fecha_pago))
                diferencias.push("fecha de pago diferente");
            diferencias.push("identificador fuerte del Libro no conservado en Proyecto H");
            Object.assign(movimiento.item, {
                estado: "en_sistema",
                sistema: pagoSistema,
                coincidencia_historica_migrada: true,
                diferencias
            });
        }
        return { disponible: true, cargos: cargosFinancieros, aplicaciones };
    }

    function pagoDebilYaExiste(p, existente, reservaId) {
        if (!reservaId || existente?.reserva_id !== reservaId || medioLibro(p) !== 'transferencia') return false;
        if (String(existente.medio_pago || '').toLowerCase() !== 'transferencia') return false;
        if (Number(existente.monto) !== Number(p.monto) || !mismaFechaCalendario(existente.fecha_pago, p.fecha_comprobante)) return false;
        const origenLibro = existente.datos_origen?.origen_libro || existente.datos_origen?.origen;
        if (origenLibro && p.origen && source(origenLibro) === source(p.origen)) return true;
        const libro = S.normalizar(p.texto_original), sistema = S.normalizar(existente.referencia_externa || existente.observaciones);
        return Boolean(libro && sistema && libro.length >= 12 && libro === sistema);
    }

    function pagosDebilesExistentes(resultados, pagos) {
        const grupos = new Map();
        const asignadas = new Map();
        const consumidos = new Set();
        const moneda = p => String(p.moneda || 'CLP').trim().toUpperCase();
        const texto = v => S.normalizar(v).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const origenExacto = (item, existente) => {
            const origen=existente.datos_origen?.origen_libro || existente.datos_origen?.origen;
            return Boolean(origen?.hoja && origen?.celda && item.p.origen?.hoja && item.p.origen?.celda && source(origen)===source(item.p.origen));
        };
        const referenciaExacta = (item, existente) => {
            const textoCompleto=texto(item.p.texto_original), segmentos=String(item.p.texto_original || '').split(/\s*\/{2,}\s*|\r?\n/).map(texto).filter(Boolean);
            const titular=texto(item.titular), monto=String(Number(item.p.monto));
            const referenciaEspecifica = valor => {
                if (!valor || valor.length<12 || valor===titular) return false;
                // Conserva la igualdad completa aceptada antes de segmentar glosas.
                if (valor===textoCompleto) return true;
                const tokens=valor.split(' ');
                const codigo=tokens.some(t=>/^\d{6,}$/.test(t) && String(Number(t))!==monto);
                const medio=/\b(?:transferencia|transf|debito|credito|webpay|efectivo)\b/.test(valor);
                return segmentos.includes(valor) && codigo && medio;
            };
            return [existente.referencia_externa,existente.observaciones].map(texto)
                .some(referenciaEspecifica);
        };
        const evidenciaDescriptiva = (item, existente) => {
            const p=item.p;
            if (origenExacto(item,existente) || referenciaExacta(item,existente)) return true;
            const libro=texto(p.texto_original), nombre=new Set(texto(item.titular).split(' '));
            return [existente.referencia_externa, existente.observaciones].some(v => {
                const glosa=texto(v);
                if (glosa.length<12 || !libro || !(` ${libro} `.includes(` ${glosa} `) || ` ${glosa} `.includes(` ${libro} `))) return false;
                const comun=glosa.length<libro.length?glosa:libro;
                // Un código bancario específico o texto descriptivo; nombre y monto no bastan.
                const monto=String(Number(p.monto));
                const codigo=comun.split(' ').some(t=>/^\d{6,}$/.test(t) && String(Number(t))!==monto);
                const palabras=new Set(comun.split(' ').filter(t=>t.length>=4 && !/\d/.test(t) && !nombre.has(t) &&
                    !/^(transferencia|transf|pago|abono|reserva|pesos|monto|pendiente|manager|bove|noche|noches)$/.test(t)));
                return codigo || palabras.size>=3;
            });
        };
        const identificadorFuerteSistema = p => Boolean(normalizarId(p?.codigo_autorizacion) ||
            normalizarId(p?.folio) && bovtarSistemaCoincide({bovtar:p?.datos_origen?.bovtar || p?.bove},p));
        const pagoVerificadoSistema = p => Boolean(p?.verificado_en || p?.datos_origen?.verificacion_migrada === true ||
            p?.datos_origen?.verificacion_abono === true);
        const tokensTitular = valor => [...new Set(texto(valor).split(' ').filter(t=>/^\p{L}+$/u.test(t) && t.length>=2))];
        const titularVarianteCompatible = (a,b) => {
            const ta=tokensTitular(a),tb=tokensTitular(b);
            if (ta.length<2 || tb.length<2) return false;
            const [corto,largo]=ta.length<=tb.length?[ta,new Set(tb)]:[tb,new Set(ta)];
            return corto.every(t=>largo.has(t));
        };
        const fuertesUsados = new Set(resultados.flatMap(r => (r.libro.pagos || []).filter(pagoTieneIdentificadorFuerte)
            .flatMap(p => pagos.filter(x=>pagoCoincide(p,x)).map(x=>x.id))));
        const items=[];
        const itemsFuertes=[];
        const movimientosLibroVistos=new Set();
        const agregarItem=(p,result)=>{
            if (movimientosLibroVistos.has(p) || !Number.isSafeInteger(Number(p.monto)) || Number(p.monto)<=0) return;
            movimientosLibroVistos.add(p);
            const item={p,reservaId:result.sistema.reserva_id,titular:result.libro.titular};
            (pagoTieneIdentificadorFuerte(p) ? itemsFuertes : items).push(item);
        };
        for (const result of resultados) {
            if (result.estado !== 'asociada') continue;
            for (const p of result.libro.pagos || []) agregarItem(p,result);

            // El parser puede dejar el movimiento fuera de `pagos` cuando el
            // titular financiero es una variante abreviada. Para un abono ya
            // verificado se recupera sólo si CAB, bloque, titular y reserva son
            // inequívocos; el emparejamiento financiero 1 ↔ 1 se valida abajo.
            const bloqueUnico=resultados.filter(otro=>otro.estado==='asociada' &&
                Number(otro.libro.cabana)===Number(result.libro.cabana) &&
                otro.libro.fecha_checkin===result.libro.fecha_checkin).length===1;
            if (!bloqueUnico || result.libro.advertencias?.length) continue;
            for (const p of result.libro.pagos_sin_asociacion || []) {
                const advertenciaCab=(p.advertencias || []).some(a=>/indica\s+CAB|mientras.+CAB/i.test(String(a)));
                if (!pagoTieneIdentificadorFuerte(p) || advertenciaCab ||
                    p.tipo_movimiento!=='alojamiento' || p.pago_recibido!==true ||
                    p.estado_pago!=='registrado_en_libro' || !p.fecha_comprobante || !medioLibro(p) ||
                    p.fecha_bloque!==result.libro.fecha_checkin || Number(p.cabana)!==Number(result.libro.cabana) ||
                    !titularVarianteCompatible(result.libro.titular,p.titular)) continue;
                agregarItem(p,result);
            }
        }
        const firmaFinancieraIgual = (a,b) => a.reservaId===b.reservaId && moneda(a.p)===moneda(b.p) &&
            Number(a.p.monto)===Number(b.p.monto) && medioLibro(a.p)===medioLibro(b.p) &&
            mismaFechaCalendario(a.p.fecha_comprobante,b.p.fecha_comprobante);
        const compatibles = item => pagos.filter(p => p.id && !fuertesUsados.has(p.id) && !consumidos.has(p.id) &&
            p.reserva_id===item.reservaId && moneda(p)===moneda(item.p) && Number(p.monto)===Number(item.p.monto) &&
            medioSistema(p)===medioLibro(item.p));
        // Un abono ya verificado en Proyecto H puede ser anterior a la captura
        // de CodAut/Folio. Se reconoce únicamente con una correspondencia 1 ↔ 1
        // exacta de reserva, monto, moneda, medio y fecha. Si el identificador
        // aparece en otro pago o existe cualquier ambigüedad, conserva revisión.
        for (const item of itemsFuertes.filter(x => x.p.tipo_movimiento==='alojamiento' &&
            x.p.pago_recibido===true && x.p.estado_pago==='registrado_en_libro' && x.p.fecha_comprobante && medioLibro(x.p))) {
            if (pagos.some(p=>pagoCoincide(item.p,p))) continue;
            const candidatos=compatibles(item).filter(p=>
                !identificadorFuerteSistema(p) && pagoVerificadoSistema(p) &&
                S.normalizar(p.estado)==='confirmado' && S.normalizar(p.tipo_movimiento)==='pago' &&
                (!S.normalizar(p.etapa_operativa) || S.normalizar(p.etapa_operativa)==='abono') &&
                mismaFechaCalendario(p.fecha_pago,item.p.fecha_comprobante));
            if (candidatos.length!==1) continue;
            const libroCompatibles=[...items,...itemsFuertes].filter(otro=>firmaFinancieraIgual(otro,item));
            if (libroCompatibles.length!==1) continue;
            asignadas.set(item.p,candidatos[0]);
            consumidos.add(candidatos[0].id);
        }

        // Evidencia exacta conservada por Haku: misma reserva, monto y medio,
        // más origen XLSX o glosa completa. La fecha puede haber sido corregida.
        for (const item of items) {
            const exactos=compatibles(item).filter(p=>origenExacto(item,p) || referenciaExacta(item,p));
            if (exactos.length!==1) continue;
            const existente=exactos[0];
            const libroCompatible=items.filter(otro=>!asignadas.has(otro.p) && otro.reservaId===item.reservaId &&
                moneda(otro.p)===moneda(item.p) && Number(otro.p.monto)===Number(item.p.monto) &&
                medioLibro(otro.p)===medioLibro(item.p) && (origenExacto(otro,existente) || referenciaExacta(otro,existente)));
            if (libroCompatible.length!==1) continue;
            asignadas.set(item.p,existente);
            consumidos.add(existente.id);
        }

        // Una transferencia migrada puede haber conservado la fecha de registro
        // en vez de la fecha del comprobante. Sólo se admite sin comparar fechas
        // cuando queda una correspondencia financiera única en ambos sentidos.
        for (const item of items.filter(x=>!asignadas.has(x.p) && medioLibro(x.p)==='transferencia' &&
            x.p.tipo_movimiento==='alojamiento' && x.p.pago_recibido===true &&
            x.p.estado_pago==='registrado_en_libro' && x.p.fecha_comprobante)) {
            const candidatos=compatibles(item);
            if (candidatos.length!==1) continue;
            const existente=candidatos[0];
            if (S.normalizar(existente.estado)!=='confirmado' || existente.datos_origen?.verificacion_migrada!==true ||
                identificadorFuerteSistema(existente) || !existente.fecha_pago) continue;
            const libroCompatible=items.filter(otro=>!asignadas.has(otro.p) && otro.reservaId===item.reservaId &&
                medioLibro(otro.p)==='transferencia' && otro.p.tipo_movimiento==='alojamiento' &&
                moneda(otro.p)===moneda(item.p) && Number(otro.p.monto)===Number(item.p.monto));
            if (libroCompatible.length!==1) continue;
            asignadas.set(item.p,existente);
            consumidos.add(existente.id);
        }

        // Transferencias históricas sin identidad persistida: sólo una
        // correspondencia 1 ↔ 1 con reserva+monto+medio+fecha completos.
        for (const item of items.filter(x=>!asignadas.has(x.p) && medioLibro(x.p)==='transferencia' && x.p.fecha_comprobante)) {
            const key=[item.reservaId,Number(item.p.monto),String(item.p.fecha_comprobante).slice(0,10),moneda(item.p)].join('|');
            if (!grupos.has(key)) grupos.set(key,[]);
            grupos.get(key).push(item);
        }
        for (const [key, libro] of grupos) {
            const [reservaId, monto, fecha, divisa] = key.split('|');
            const sistema = pagos.filter(p => p.id && !fuertesUsados.has(p.id) && !consumidos.has(p.id) && p.reserva_id === reservaId && moneda(p)===divisa && Number(p.monto) === Number(monto) &&
                medioSistema(p) === 'transferencia' && mismaFechaCalendario(p.fecha_pago,fecha));
            const usados = new Set();
            for (const item of libro) {
                const exactos = sistema.filter(p => evidenciaDescriptiva(item,p));
                if (exactos.length === 1 && libro.filter(x=>evidenciaDescriptiva(x,exactos[0])).length===1) {
                    usados.add(exactos[0].id);
                    consumidos.add(exactos[0].id);
                    asignadas.set(item.p, exactos[0]);
                }
            }
            const restantesLibro = libro.filter(item => !asignadas.has(item.p));
            const restantesSistema = sistema.filter(p => !usados.has(p.id));
            // Compatibilidad histórica: algunos pagos antiguos no conservaron
            // identidad textual. Sólo un remanente 1 ↔ 1, nunca emparejar por orden.
            if (restantesLibro.length === 1 && restantesSistema.length === 1) {
                asignadas.set(restantesLibro[0].p, restantesSistema[0]);
                consumidos.add(restantesSistema[0].id);
            }
        }

        // Un titular financiero abreviado no modifica la asociación semántica.
        // Sólo rescata la transferencia histórica si bloque, nombres y firma
        // financiera dejan una única correspondencia posible en ambos lados.
        for (const result of resultados.filter(x=>x.estado==='asociada' && !x.libro.advertencias?.length)) {
            const r=result.libro;
            const reservasBloque=resultados.filter(x=>Number(x.libro.cabana)===Number(r.cabana) &&
                x.libro.fecha_checkin===r.fecha_checkin);
            if (reservasBloque.length!==1) continue;
            for (const p of r.pagos_sin_asociacion || []) {
                if (pagoTieneIdentificadorFuerte(p) || p.advertencias?.length || medioLibro(p)!=='transferencia' ||
                    p.tipo_movimiento!=='alojamiento' || p.pago_recibido!==true || p.estado_pago!=='registrado_en_libro' ||
                    !p.fecha_comprobante || p.fecha_bloque!==r.fecha_checkin || Number(p.cabana)!==Number(r.cabana) ||
                    !titularVarianteCompatible(r.titular,p.titular)) continue;
                const movimientosCompatibles=(r.pagos_sin_asociacion || []).filter(otro=>
                    !pagoTieneIdentificadorFuerte(otro) && medioLibro(otro)==='transferencia' &&
                    otro.tipo_movimiento==='alojamiento' && otro.pago_recibido===true &&
                    otro.estado_pago==='registrado_en_libro' && otro.fecha_bloque===r.fecha_checkin &&
                    Number(otro.cabana)===Number(r.cabana) && moneda(otro)===moneda(p) &&
                    Number(otro.monto)===Number(p.monto));
                if (movimientosCompatibles.length!==1) continue;
                const candidatos=pagos.filter(x=>x.id && !fuertesUsados.has(x.id) && !consumidos.has(x.id) &&
                    x.reserva_id===result.sistema.reserva_id && moneda(x)===moneda(p) &&
                    Number(x.monto)===Number(p.monto) && medioSistema(x)==='transferencia');
                if (candidatos.length!==1) continue;
                const existente=candidatos[0];
                if (S.normalizar(existente.estado)!=='confirmado' || existente.datos_origen?.verificacion_migrada!==true ||
                    identificadorFuerteSistema(existente) || !existente.fecha_pago) continue;
                asignadas.set(p,existente);
                consumidos.add(existente.id);
            }
        }

        // En grupos multicabaña, un movimiento puede conservar como titular a
        // quien hizo la transferencia y quedar fuera de la asociación semántica.
        // Sólo se recupera si el grupo y cada reserva hija ya están asociados,
        // y CAB + fechas + firma financiera dejan una correspondencia 1 ↔ 1.
        const gruposMulticabana=new Map();
        for (const result of resultados.filter(x=>x.estado==='asociada' && x.sistema?.grupo_reserva_id)) {
            const id=result.sistema.grupo_reserva_id;
            if (!gruposMulticabana.has(id)) gruposMulticabana.set(id,[]);
            gruposMulticabana.get(id).push(result);
        }
        const movimientoGrupoElegible = (p,r) => !pagoTieneIdentificadorFuerte(p) &&
            !p.advertencias?.length && medioLibro(p)==='transferencia' &&
            p.tipo_movimiento==='alojamiento' && p.pago_recibido===true &&
            p.estado_pago==='registrado_en_libro' && Boolean(p.fecha_comprobante) &&
            p.fecha_bloque===r.fecha_checkin && Number(p.cabana)===Number(r.cabana) &&
            Number.isSafeInteger(Number(p.monto)) && Number(p.monto)>0;
        for (const miembros of gruposMulticabana.values()) {
            if (miembros.length<2) continue;
            const reservasHijas=new Set(miembros.map(x=>x.sistema.reserva_id));
            const cabanas=new Set(miembros.map(x=>Number(x.libro.cabana)));
            const periodos=new Set(miembros.map(x=>`${x.libro.fecha_checkin}|${x.libro.fecha_checkout}`));
            const grupoSeguro=reservasHijas.size===miembros.length && cabanas.size===miembros.length &&
                periodos.size===1 && miembros.every(x=>x.sistema.reserva_id &&
                    x.sistema.grupo_reserva_id===miembros[0].sistema.grupo_reserva_id &&
                    Number(x.sistema.cabana)===Number(x.libro.cabana) &&
                    x.sistema.fecha_checkin===x.libro.fecha_checkin &&
                    x.sistema.fecha_checkout===x.libro.fecha_checkout);
            if (!grupoSeguro) continue;
            for (const result of miembros) {
                const r=result.libro;
                const movimientos=[...(r.pagos || []),...(r.pagos_sin_asociacion || [])]
                    .filter(p=>movimientoGrupoElegible(p,r));
                const firmas=new Map();
                for (const p of movimientos) {
                    const firma=[Number(p.monto),moneda(p),medioLibro(p),String(p.fecha_comprobante).slice(0,10)].join('|');
                    if (!firmas.has(firma)) firmas.set(firma,[]);
                    firmas.get(firma).push(p);
                }
                for (const [firma,movimientosLibro] of firmas) {
                    // Dos movimientos equivalentes para la misma hija son
                    // ambiguos incluso si una pasada anterior había asociado uno.
                    if (movimientosLibro.length!==1) {
                        for (const p of movimientosLibro) {
                            const previa=asignadas.get(p);
                            if (previa?.id) consumidos.delete(previa.id);
                            asignadas.delete(p);
                        }
                        continue;
                    }
                    const p=movimientosLibro[0], previa=asignadas.get(p);
                    const [monto,divisa,medio,fecha]=firma.split('|');
                    const candidatosFinancieros=pagos.filter(x=>x.id && x.reserva_id===result.sistema.reserva_id &&
                        S.normalizar(x.estado)==='confirmado' &&
                        moneda(x)===divisa && Number(x.monto)===Number(monto) && medioSistema(x)===medio &&
                        mismaFechaCalendario(x.fecha_pago,fecha));
                    const candidatos=candidatosFinancieros.filter(x=>!identificadorFuerteSistema(x) && !fuertesUsados.has(x.id));
                    if (candidatosFinancieros.length!==1 || candidatos.length!==1 ||
                        consumidos.has(candidatos[0].id) && previa?.id!==candidatos[0].id) {
                        if (previa?.id) consumidos.delete(previa.id);
                        asignadas.delete(p);
                        continue;
                    }
                    if (previa?.id && previa.id!==candidatos[0].id) consumidos.delete(previa.id);
                    asignadas.set(p,candidatos[0]);
                    consumidos.add(candidatos[0].id);
                }
            }
        }
        return asignadas;
    }

    async function compararSistema(reservas, cliente, q = {}) {
        if (!cliente?.auth?.getSession) throw new Error("Inicia sesión en Proyecto H para comparar.");
        const { data: sesion, error } = await cliente.auth.getSession();
        if (error || !sesion?.session) throw new Error("Inicia sesión en Proyecto H para comparar.");

        const detectadasLibro = Array.isArray(reservas) ? reservas.length : 0;
        const validas = (reservas || []).map(normalizarReservaComparacion).filter(esReservaValida);
        const desde = q.desde || validas.map(r => r.fecha_checkin).filter(Boolean).sort()[0];
        const hasta = q.hasta || validas.map(r => r.fecha_checkout).filter(Boolean).sort().at(-1);
        if (!desde || !hasta) throw new Error("No pude determinar el intervalo para comparar con Proyecto H.");

        const raw = await paginas(() => cliente.from("reserva_estadias")
            .select("id,reserva_id,fecha_ingreso,fecha_salida,estado_estadia,tipo_estadia,adultos,ninos,mascotas,cabanas(numero),reservas(id,grupo_reserva_id,titular_nombre,titular_tipo_documento,titular_numero_documento,correo_contacto,telefono_contacto,estado_reserva,observaciones)"));

        const system = raw.map(e => ({
            id: e.id,
            reserva_id: e.reserva_id,
            grupo_reserva_id: e.reservas?.grupo_reserva_id,
            cabana: e.cabanas?.numero,
            titular: e.reservas?.titular_nombre,
            rut_documento: e.reservas?.titular_numero_documento,
            correo: e.reservas?.correo_contacto,
            telefono: e.reservas?.telefono_contacto,
            fecha_checkin: e.fecha_ingreso,
            fecha_checkout: e.fecha_salida,
            estado_operativo: e.estado_estadia,
            estado_reserva: e.reservas?.estado_reserva,
            tipo_estadia: e.tipo_estadia,
            adultos: e.adultos, ninos: e.ninos, mascotas: e.mascotas, observaciones: e.reservas?.observaciones,
            tipo_documento: e.reservas?.titular_tipo_documento
        })).filter(candidatoElegible);

        const visiblesRango = system.filter(s =>
            s.fecha_checkin <= hasta && s.fecha_checkout >= desde &&
            !/cancelad|no.?show/.test(S.normalizar(s.estado_operativo)) &&
            !/cancelad|no.?show/.test(S.normalizar(s.estado_reserva))
        );
        const reservasSistema = new Set(visiblesRango.map(s => s.reserva_id).filter(Boolean));

        if (!validas.length) {
            const vacio = [];
            vacio.meta = {
                libro: 0,
                libro_detectadas: detectadasLibro,
                proyecto: reservasSistema.size,
                asociadas: 0,
                faltantes: 0,
                ambiguas: 0,
                con_diferencias: 0,
                pagos_faltantes: 0,
                pagos_revisar: 0,
                servicios_revisar: 0
            };
            vacio.grupos = [];
            vacio.pagosDetalle = [];
            vacio.serviciosDetalle = [];
            return vacio;
        }

        // Reserve only exact, unequivocal 1↔1 stays before offering looser candidates.
        // This prevents an exact stay from also appearing as a possible match for another Libro row.
        const propuestasExactas = validas.map((libro, indice) => {
            const candidatas = system.filter(s => puntuarCandidato(libro, s).segura);
            return candidatas.length === 1 && candidatas[0].id ? { indice, sistema: candidatas[0] } : null;
        }).filter(Boolean);
        const usosExactos = new Map();
        propuestasExactas.forEach(x => usosExactos.set(x.sistema.id, (usosExactos.get(x.sistema.id) || 0) + 1));
        const exactas = new Map(propuestasExactas.filter(x => usosExactos.get(x.sistema.id) === 1)
            .map(x => [x.indice, x.sistema]));
        const estadiasConsumidas = new Set([...exactas.values()].map(s => s.id));

        const resultados = validas.map((r, indice) => {
            const exacta = exactas.get(indice);
            const disponibles = system.filter(s => !estadiasConsumidas.has(s.id));
            let asociacion = exacta
                ? { estado: "asociada", sistema: exacta, categoria: "coincide", confianza: "alta" }
                : asociarConservador(r, disponibles);
            if (!exacta && asociacion.estado === "sin_coincidencia") {
                const previa = asociarConservador(r, system);
                if (previa.estado !== "sin_coincidencia") {
                    asociacion = {...previa, estado: "ambigua", candidatosDetalle: [], candidatos: []};
                    delete asociacion.sistema;
                }
            }
            return {
                libro: r,
                ...asociacion,
                diferencias: [],
                pagosComparacion: [],
                serviciosComparacion: []
            };
        });

        // One system stay cannot satisfy two different source rows silently.
        const usos = new Map();
        for (const r of resultados.filter(x => x.sistema)) usos.set(r.sistema.id, (usos.get(r.sistema.id) || 0) + 1);
        for (const r of resultados.filter(x => x.sistema && usos.get(x.sistema.id) > 1)) {
            r.estado = "ambigua"; r.categoria = "ambiguo"; r.confianza = "baja";
            r.pregunta = "Dos filas del Libro apuntan a la misma estadía: ¿son un duplicado o reservas independientes?";
            r.candidatosDetalle = [r.sistema]; delete r.sistema;
        }

        const ids = [...new Set(resultados.filter(r => r.estado === "asociada").map(r => r.sistema.reserva_id))];
        // Global identifier check: a payment on another reservation is a conflict, never new.
        const pagos = await paginas(() => cliente.from("pagos")
            .select("id,reserva_id,monto,moneda,estado,folio,codigo_autorizacion,bove,datos_origen,medio_pago,fecha_pago,verificado_por,verificado_en,referencia_externa,observaciones,tipo_movimiento,etapa_operativa"));
        const pagosVigentes = pagos.filter(pagoSistemaVigente);
        const pagosNoVigentes = pagos.filter(p=>!pagoSistemaVigente(p));
        const pagosExistentes = pagosDebilesExistentes(resultados, pagosVigentes);
        const servicios = [];
        for (let i = 0; i < ids.length; i += 50) {
            const grupo = ids.slice(i, i + 50);
            servicios.push(...await paginas(() => cliente.from("servicios")
                .select("id,reserva_id,estadia_id,fecha_servicio,total,estado_servicio,catalogo_servicios(codigo,nombre,categoria)")
                .in("reserva_id", grupo)));
        }

        for (const result of resultados) {
            const r = result.libro;

            if (result.estado !== "asociada") {
                const estadoPago = "revisar";
                result.pagosComparacion.push(...r.pagos.map(p => ({ estado: estadoPago, pago: p, reserva: r })));
                result.pagosComparacion.push(...r.pagos_sin_asociacion.map(p => ({ estado: "revisar", pago: p, reserva: r })));
                result.serviciosComparacion.push(...r.servicios.map(s => ({ estado: result.estado === "sin_coincidencia" ? "con_reserva_faltante" : "revisar", servicio: s, reserva: r })));
                continue;
            }

            const s = result.sistema;
            for (const key of ["cabana", "fecha_checkin", "fecha_checkout", "correo"]) {
                const a = key === "cabana" ? Number(r[key]) : S.normalizar(r[key]);
                const b = key === "cabana" ? Number(s[key]) : S.normalizar(s[key]);
                if (r[key] && s[key] && a !== b) result.diferencias.push(`${key}: Libro «${r[key]}» / Proyecto H «${s[key]}»`);
            }
            if (r.rut_documento && s.rut_documento && documentoCanon(r.rut_documento) !== documentoCanon(s.rut_documento)) {
                result.diferencias.push(`RUT/documento: Libro «${r.rut_documento}» / Proyecto H «${s.rut_documento}»`);
            }
            if (r.telefono && s.telefono && !telefonoCompatible(r.telefono, s.telefono)) {
                result.diferencias.push(`telefono: Libro «${r.telefono}» / Proyecto H «${s.telefono}»`);
            }
            if (!estadoEstadiaCompatible(r.estado_operativo, s.estado_operativo)) {
                result.diferencias.push(`estado de estadía: Libro «${r.estado_operativo}» / Proyecto H «${s.estado_operativo}»`);
            }
            if (/cancelad|reembols/.test(S.normalizar(s.estado_reserva))) {
                result.diferencias.push(`Proyecto H figura ${s.estado_reserva}; revisar con la reserva visible en el Libro.`);
            }

            for (const p of r.pagos) {
                if (p.clasificacion_financiera === "dudoso") {
                    result.pagosComparacion.push({ estado: "revisar", pago: p, reserva: r });
                    continue;
                }
                const candidatos = pagosVigentes.filter(x => pagoCoincide(p, x));
                const candidatosNoVigentes = pagosNoVigentes.filter(x => pagoCoincide(p, x));
                if (candidatos.length === 1 && candidatos[0].reserva_id === s.reserva_id) {
                    const x = candidatos[0];
                    const diferenciasPago = [];
                    if (p.monto !== null && (Number(x.monto) !== p.monto || (p.moneda && x.moneda && x.moneda !== p.moneda))) {
                        diferenciasPago.push("monto/moneda diferente");
                        result.diferencias.push("Monto/moneda diferente en un pago del Libro.");
                    }
                    if (medioLibro(p) && medioSistema(x) && medioLibro(p) !== medioSistema(x)) {
                        diferenciasPago.push("medio de pago diferente");
                        result.diferencias.push("Medio diferente en un pago del Libro.");
                    }
                    if (p.fecha_comprobante && x.fecha_pago && !mismaFechaCalendario(x.fecha_pago,p.fecha_comprobante)) {
                        diferenciasPago.push("fecha de pago diferente");
                        result.diferencias.push("Fecha diferente en un pago del Libro.");
                    }
                    result.pagosComparacion.push({ estado: diferenciasPago.length ? "diferente" : "en_sistema", pago: p, sistema: x, reserva: r, diferencias: diferenciasPago });
                } else if (pagosExistentes.has(p)) {
                    result.pagosComparacion.push({ estado: "en_sistema", pago: p, sistema: pagosExistentes.get(p), reserva: r, coincidencia_debil: true, diferencias: [] });
                } else if (pagoTieneIdentificadorFuerte(p) && candidatos.length === 0 && candidatosNoVigentes.length === 0 &&
                    Number(p.monto) > 0 && p.tipo_movimiento !== "penalidad" &&
                    (!p.transaccion_distribuida || p.pago_recibido === true && p.estado_pago === "registrado_en_libro")) {
                    result.pagosComparacion.push({ estado: "nuevo_seguro", pago: p, reserva: r });
                } else {
                    result.pagosComparacion.push({ estado: "revisar", pago: p, reserva: r });
                }
            }

            for (const p of r.pagos_sin_asociacion) {
                if (p.clasificacion_financiera === "dudoso") {
                    result.pagosComparacion.push({ estado: "revisar", pago: p, reserva: r });
                    continue;
                }
                if (pagosExistentes.has(p)) {
                    result.pagosComparacion.push({ estado: 'en_sistema', pago: p, sistema: pagosExistentes.get(p),
                        reserva: r, coincidencia_debil: true, diferencias: [] });
                    continue;
                }
                const candidatos = pagosVigentes.filter(x => pagoCoincide(p, x));
                const existente = p.advertencias?.length && S.mismaPersona(p.titular, r.titular) &&
                    candidatos.length === 1 && candidatos[0].reserva_id === s.reserva_id &&
                    candidatos[0].moneda === p.moneda &&
                    Number(candidatos[0].monto) === p.monto && medioSistema(candidatos[0]) === medioLibro(p) &&
                    mismaFechaCalendario(candidatos[0].fecha_pago,p.fecha_comprobante) ? candidatos[0] : null;
                result.pagosComparacion.push({ estado: existente ? 'en_sistema' : 'revisar', pago: p, reserva: r,
                    ...(existente ? { sistema: existente } : {}), diferencias: p.advertencias || [] });
            }

            for (const service of r.servicios) {
                const existe = servicios.some(x => x.reserva_id === s.reserva_id && S.normalizar(x.catalogo_servicios?.nombre).includes(service.concepto.replace(/_/g, " ")));
                result.serviciosComparacion.push({ estado: existe ? "en_sistema" : "revisar", servicio: service, reserva: r });
                if (!existe) result.diferencias.push(`Servicio mencionado sin coincidencia por concepto: ${service.concepto}. La fecha y el monto requieren revisión.`);
            }
        }

        const snapshotEfectivoAplicado = await reconciliarEfectivosAplicados(resultados, pagos, servicios, cliente);

        const grupos = agruparComparacion(resultados);
        const movimientos = resultados.flatMap(r => r.pagosComparacion);
        for (const x of movimientos) {
            const conflicto = movimientos.some(y => y !== x &&
                pagoCoincide(x.pago, { ...y.pago, datos_origen: { bovtar: y.pago.bovtar } }) &&
                (Number(x.pago.monto) !== Number(y.pago.monto) || x.pago.moneda !== y.pago.moneda || claveReserva(x.reserva) !== claveReserva(y.reserva)));
            if (x.estado === "nuevo_seguro" && conflicto) x.estado = "revisar";
        }
        const pagosUnicos = new Map();
        for (const x of resultados.flatMap(r => r.pagosComparacion)) {
            const key = `${x.reserva.id || claveReserva(x.reserva)}|${source(x.pago?.origen)}|${JSON.stringify(x.pago)}|${x.estado}`;
            if (!pagosUnicos.has(key)) pagosUnicos.set(key, x);
        }
        const serviciosUnicos = serviciosComparacionUnicos(resultados.flatMap(r => r.serviciosComparacion));

        let snapshotFinanciero = null;
        if (D) {
            const reservaSistemaPorLibro = new Map(resultados
                .filter(resultado => resultado.estado === "asociada" && resultado.sistema?.reserva_id)
                .map(resultado => [claveReserva(resultado.libro), resultado.sistema.reserva_id]));
            const estadiaSistemaPorLibro = new Map(resultados
                .filter(resultado => resultado.estado === "asociada" && resultado.sistema?.id)
                .map(resultado => [claveReserva(resultado.libro), resultado.sistema.id]));
            const candidatosDestino = [...pagosUnicos.values()].filter(item =>
                item.estado !== "en_sistema" && D.aplicacionesLibro(item.pago).length > 0);
            const idsDestino = [...new Set(candidatosDestino
                .map(item => reservaSistemaPorLibro.get(claveReserva(item.reserva))).filter(Boolean))];
            try {
                snapshotFinanciero = await D.leerSnapshot(cliente, idsDestino);
            } catch (err) {
                snapshotFinanciero = { disponible: false, cargos: [], servicios: [], aplicaciones: [], pagos: [],
                    error: `No fue posible leer el destino financiero: ${err?.message || err}` };
            }
            const serviciosAplicados = [];
            for (const item of candidatosDestino) {
                item.reserva_sistema_id = reservaSistemaPorLibro.get(claveReserva(item.reserva)) || null;
                const coincidencia = candidatoServicioAplicado(item.pago, item.reserva_sistema_id, pagos);
                if (coincidencia.sospechoso) item.estado = "revisar";
                item.destinoFinanciero = D.resolverTransaccion(item.pago, item.reserva_sistema_id,
                    snapshotFinanciero, item.sistema || coincidencia.candidato || null);
                if (!coincidencia.candidato || item.destinoFinanciero?.estado !== "ya_aplicada") continue;
                const aplicacionesLibro = D.aplicacionesLibro(item.pago);
                const aplicacionesPago = (snapshotFinanciero?.aplicaciones || [])
                    .filter(aplicacion => aplicacion.pago_id === coincidencia.candidato.id);
                const aplicacionResuelta = item.destinoFinanciero.aplicaciones?.[0];
                const aplicacionSistema = aplicacionesPago[0];
                const cargo = (snapshotFinanciero?.cargos || []).find(x => x.cargo_id === aplicacionSistema?.cargo_id);
                if (aplicacionesLibro.length !== 1 || aplicacionesPago.length !== 1 ||
                    Number(aplicacionSistema?.monto_aplicado) !== Number(item.pago.monto) ||
                    aplicacionResuelta?.estado !== "ya_aplicada" || aplicacionResuelta.cargo_id !== aplicacionSistema?.cargo_id ||
                    cargo?.reserva_id !== item.reserva_sistema_id || cargo?.estadia_id !== estadiaSistemaPorLibro.get(claveReserva(item.reserva)) ||
                    cargo?.tipo_cargo !== "servicio") continue;
                serviciosAplicados.push({ item, pago: coincidencia.candidato });
            }
            const pagosReutilizados = new Set(serviciosAplicados.filter((propuesta, indice, todas) =>
                todas.some((otra, otroIndice) => otroIndice !== indice && otra.pago.id === propuesta.pago.id))
                .map(propuesta => propuesta.pago.id));
            for (const propuesta of serviciosAplicados) {
                if (pagosReutilizados.has(propuesta.pago.id)) continue;
                Object.assign(propuesta.item, {
                    estado: "en_sistema",
                    sistema: propuesta.pago,
                    coincidencia_aplicacion_servicio: true,
                    diferencias: [...new Set([...(propuesta.item.diferencias || []),
                        "Pago de servicio existente verificado por identificador y aplicación."])]
                });
            }
        }

        resultados.snapshot = { estadias: system, pagos: pagosVigentes, finanzas: snapshotFinanciero,
            efectivo_aplicado: snapshotEfectivoAplicado };
        resultados.grupos = grupos;
        resultados.pagosDetalle = [...pagosUnicos.values()];
        resultados.serviciosDetalle = serviciosUnicos;
        resultados.meta = {
            libro: grupos.length,
            estadias_libro: validas.length,
            libro_detectadas: detectadasLibro,
            proyecto: reservasSistema.size,
            asociadas: grupos.filter(g => g.estado === "asociada").length,
            faltantes: grupos.filter(g => g.estado === "sin_coincidencia").length,
            ambiguas: grupos.filter(g => g.estado === "ambigua").length,
            con_diferencias: resultados.filter(g => g.estado === "asociada" && g.diferencias.length).length,
            pagos_faltantes: [...pagosUnicos.values()].filter(x => x.estado === "nuevo_seguro").length,
            pagos_revisar: [...pagosUnicos.values()].filter(x => x.estado === "revisar" || x.estado === "diferente").length,
            servicios_revisar: serviciosUnicos.filter(x => x.estado !== "en_sistema").length
        };
        return resultados;
    }

    // La preparacion sigue siendo pura. La escritura ocurre solo por la RPC atomica
    // y despues de una segunda revalidacion iniciada por el boton de confirmacion.
    const ESCRITURA_LIBRO = true;
    const CATEGORIAS_GUARDABLES = ['nuevas', 'estadias', 'pagos', 'actualizaciones'];
    const estadoLibro = r => ['hospedada','checked_out'].includes(r.estado_operativo) ? r.estado_operativo :
        r.estado_confirmacion === 'confirmada_por_color' ? 'confirmada' : r.estado_confirmacion === 'pendiente_por_color' ? 'pendiente' :
        r.estado_operativo === 'sin_checkin' ? 'confirmada' : undefined;
    const prioridadEstadoEstadia = Object.freeze({ pendiente:0, confirmada:1, hospedada:2, checked_out:3 });
    function estadoLibroActualizable(r, estadoActual) {
        const propuesto = estadoLibro(r);
        if (!propuesto) return undefined;
        const actual = S.normalizar(estadoActual);
        if (actual in prioridadEstadoEstadia && propuesto in prioridadEstadoEstadia &&
            prioridadEstadoEstadia[propuesto] < prioridadEstadoEstadia[actual]) return undefined;
        return propuesto;
    }
    const etiquetasActualizacion = { titular_nombre:'Nombre', titular_numero_documento:'RUT/pasaporte', titular_tipo_documento:'Tipo de documento',
        correo_contacto:'Correo', telefono_contacto:'Teléfono', observaciones:'Notas y detalles del Libro', estado_reserva:'Estado de reserva',
        cabana_numero:'Cabaña', fecha_ingreso:'Check-In', fecha_salida:'Check-Out', tipo_estadia:'Tipo de estadía', adultos:'Adultos', ninos:'Niños', mascotas:'Mascotas',
        estado_estadia:'Estado de estadía', monto:'Monto', moneda:'Moneda', medio_pago:'Medio de pago', fecha_pago:'Fecha de pago',
        folio:'Folio', codigo_autorizacion:'CodAut', bovtar:'BOVTAR', bove:'BOVE', referencia_externa:'Glosa', concepto_libro:'Concepto del Libro' };
    function parcheLibro(actual, propuesto) {
        const antes = {}, despues = {}, cambios = [];
        for (const [k,v] of Object.entries(propuesto)) {
            if (v === undefined || v === null || v === '' || v === 'no_determinado') continue;
            if (S.normalizar(actual[k]) === S.normalizar(v)) continue;
            antes[k] = actual[k] ?? null; despues[k] = v;
            cambios.push({ campo: etiquetasActualizacion[k] || k, anterior: actual[k] ?? null, libro: v });
        }
        return { antes, despues, cambios };
    }
    function actualizacionReservaLibro(r, s) {
        const original = [r.texto_original, ...(r.notas_importantes || []), ...(r.pagos_pendientes || []),
            ...(r.servicios || []).map(x => x.texto_original)].filter(Boolean);
        const notas = [...new Set(original)].join('\n').replace(/\[\/?DATOS DEL LIBRO\]/g, '');
        const existentes = String(s.observaciones || '').replace(/\[DATOS DEL LIBRO\][\s\S]*?\[\/DATOS DEL LIBRO\]/g, '').trim();
        const clavesExistentes = new Set(fragmentosObservaciones(s.observaciones).map(claveFragmentoObservacion));
        const agregaNotas = fragmentosObservaciones(notas).some(fragmento => !clavesExistentes.has(claveFragmentoObservacion(fragmento)));
        const docCambio = r.rut_documento && documentoCanon(r.rut_documento) !== documentoCanon(s.rut_documento);
        // El color del Libro puede confirmar un estado posterior, pero nunca debe
        // deshacer automáticamente un check-in o checkout ya registrado.
        const estado = estadoLibroActualizable(r, s.estado_operativo);
        const reserva = parcheLibro({ titular_nombre:s.titular, titular_numero_documento:s.rut_documento, titular_tipo_documento:s.tipo_documento,
            correo_contacto:s.correo, telefono_contacto:s.telefono, observaciones:s.observaciones, estado_reserva:s.estado_reserva },
            { titular_nombre:r.titular, titular_numero_documento:r.rut_documento,
                titular_tipo_documento:docCambio ? (/^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/.test(r.rut_documento) ? 'rut' : /[a-z]/i.test(r.rut_documento) ? 'pasaporte' : 'documento') : undefined,
                correo_contacto:r.correo, telefono_contacto:r.telefono,
                observaciones:notas && agregaNotas ?
                    [existentes, `[DATOS DEL LIBRO]\n${notas}\n[/DATOS DEL LIBRO]`].filter(Boolean).join('\n\n') : undefined });
        const estadia = parcheLibro({ cabana_numero:s.cabana, fecha_ingreso:s.fecha_checkin, fecha_salida:s.fecha_checkout,
            tipo_estadia:s.tipo_estadia === 'full_day' ? 'fullday' : s.tipo_estadia, adultos:s.adultos, ninos:s.ninos, mascotas:s.mascotas, estado_estadia:s.estado_operativo },
            { cabana_numero:r.cabana, fecha_ingreso:r.fecha_checkin, fecha_salida:r.fecha_checkout,
                tipo_estadia:r.tipo_estadia === 'full_day' ? 'fullday' : r.tipo_estadia, adultos:r.adultos, ninos:r.ninos, mascotas:r.mascotas, estado_estadia:estado });
        return { tipo:'reserva_actualizar', reserva_id:s.reserva_id, estadia_id:s.id,
            reserva, estadia, cambios:[...reserva.cambios,...estadia.cambios] };
    }
    function actualizacionPagoLibro(p, s) {
        const propuesta = { monto:p.monto, moneda:p.moneda, medio_pago:medioLibro(p), folio:p.folio, bovtar:p.bovtar,
            bove:p.bove, codigo_autorizacion:p.codigo_autorizacion, concepto_libro:p.concepto };
        if (p.fecha_comprobante && !mismaFechaCalendario(s.fecha_pago,p.fecha_comprobante)) propuesta.fecha_pago = p.fecha_comprobante + 'T12:00:00Z';
        if (p.medio_pago === 'transferencia') propuesta.referencia_externa = p.texto_original;
        return parcheLibro({ ...s, bovtar:s.datos_origen?.bovtar, concepto_libro:s.datos_origen?.concepto_libro }, propuesta);
    }

    function separarObservacionesLibro(valor) {
        const bloques = [];
        const base = String(valor || '').replace(/\[DATOS DEL LIBRO\]([\s\S]*?)\[\/DATOS DEL LIBRO\]/g, (_, contenido) => {
            bloques.push(contenido.trim());
            return '';
        }).trim();
        return { base, bloques };
    }

    function claveFragmentoObservacion(valor) {
        return S.normalizar(valor).replace(/[.,;:]+$/g, '');
    }

    function fragmentosObservaciones(valor) {
        const texto = String(valor ?? '').replace(/\[\/?DATOS DEL LIBRO\]/gi, '\n');
        const unicos = new Map();
        for (const fragmento of texto.split(/\r?\n|\s*\/\/\s*/).map(x => x.trim()).filter(Boolean)) {
            const clave = claveFragmentoObservacion(fragmento);
            if (clave && !unicos.has(clave)) unicos.set(clave, fragmento);
        }
        return [...unicos.values()];
    }

    function unirObservacionesLibro(antes, propuestas) {
        const base = separarObservacionesLibro(antes).base;
        const lineas = [];
        const vistas = new Set();
        for (const propuesta of propuestas) {
            const partes = separarObservacionesLibro(propuesta);
            const contenidos = partes.bloques.length ? partes.bloques : [partes.base].filter(Boolean);
            for (const linea of contenidos.flatMap(texto => texto.split(/\r?\n/)).map(x => x.trim()).filter(Boolean)) {
                const clave = S.normalizar(linea);
                if (!clave || vistas.has(clave)) continue;
                vistas.add(clave);
                lineas.push(linea);
            }
        }
        const bloque = lineas.length ? `[DATOS DEL LIBRO]\n${lineas.join('\n')}\n[/DATOS DEL LIBRO]` : '';
        return [base, bloque].filter(Boolean).join('\n\n');
    }

    // Una reserva puede aparecer en grupos distintos (varias cabañas o estadías)
    // y cada grupo construía su propio parche contra el mismo snapshot. El primer
    // parche cambiaba observaciones y el segundo parecía entonces un cambio
    // externo, aunque ambos pertenecían a la misma operación. Consolidamos los
    // campos compartidos una sola vez y dejamos cada parche de estadía separado.
    function consolidarActualizacionesReserva(plan) {
        const grupos = new Map();
        for (const item of plan.items) {
            if (item.categoria !== 'actualizaciones' || item.payload?.tipo !== 'reserva_actualizar' || !item.payload.reserva_id) continue;
            const key = String(item.payload.reserva_id);
            if (!grupos.has(key)) grupos.set(key, []);
            grupos.get(key).push(item);
        }
        const reemplazos = new Map();
        const retirar = new Set();
        for (const items of grupos.values()) {
            if (items.length < 2) continue;
            const principal = items[0];
            const campos = new Set(items.flatMap(item => Object.keys(item.payload.reserva?.despues || {})));
            const antes = {}, despues = {}, cambios = [];
            let incompatible = false;
            for (const campo of campos) {
                const anteriores = items.map(item => item.payload.reserva?.antes?.[campo]).filter(v => v !== undefined);
                const propuestas = items.map(item => item.payload.reserva?.despues?.[campo]).filter(v => v !== undefined);
                const valoresAntes = [...new Map(anteriores.map(v => [JSON.stringify(v), v])).values()];
                if (valoresAntes.length !== 1) {
                    incompatible = true;
                    items.forEach(item => item.motivos.push(`Proyecto H entregó valores iniciales incompatibles para ${etiquetasActualizacion[campo] || campo}. Vuelve a comparar.`));
                    continue;
                }
                const valorAntes = valoresAntes[0];
                let valorLibro;
                if (campo === 'observaciones') valorLibro = unirObservacionesLibro(valorAntes, propuestas);
                else {
                    const unicos = [...new Map(propuestas.map(v => [JSON.stringify(v), v])).values()];
                    if (unicos.length !== 1) {
                        incompatible = true;
                        items.forEach(item => item.motivos.push(`El Libro contiene valores incompatibles de ${etiquetasActualizacion[campo] || campo} para la misma reserva.`));
                        continue;
                    }
                    valorLibro = unicos[0];
                }
                antes[campo] = valorAntes;
                despues[campo] = valorLibro;
                cambios.push({ campo: etiquetasActualizacion[campo] || campo, anterior: valorAntes ?? null, libro: valorLibro });
            }
            principal.payload.reserva = { antes, despues, cambios };
            principal.payload.cambios = [...cambios, ...(principal.payload.estadia?.cambios || [])];
            principal.cambios = principal.payload.cambios;
            for (const item of items.slice(1)) {
                item.payload.reserva = { antes:{}, despues:{}, cambios:[] };
                item.payload.cambios = [...(item.payload.estadia?.cambios || [])];
                item.cambios = item.payload.cambios;
                if (!item.payload.cambios.length && !incompatible) {
                    reemplazos.set(item.id, principal.id);
                    retirar.add(item);
                }
            }
        }
        if (retirar.size) {
            plan.items = plan.items.filter(item => !retirar.has(item));
            for (const item of plan.items) {
                item.dependeDe = [...new Set((item.dependeDe || []).map(id => reemplazos.get(id) || id))];
            }
        }
        return plan;
    }
    function idMovimientoIncorporacion(x) {
        return 'pago:' + claveReserva(x.reserva) + ':' + source(x.pago.origen) + ':' + JSON.stringify(x.pago);
    }

    // Sólo preparación: no altera la lectura ni las asociaciones del Libro.
    // Un alojamiento y un Early Check-In pueden ser partes del mismo comprobante.
    // El operador debe aprobar cada parte; ningún conflicto genérico se flexibiliza.
    function distribucionesManuales(comp, destinos) {
        const salida = new Map(), movimientos = comp.pagosDetalle || [];
        const parteConfirmada = y => y?.pago?.pago_recibido === true &&
            y.pago.estado_pago === 'registrado_en_libro' &&
            (y.pago.tipo_movimiento === 'alojamiento' || /^early\s*(check\s*)?in$/i.test(y.pago.concepto?.trim()));
        const partePenalidad = y => {
            const p = y?.pago, monto = Number(p?.monto), montoPenalidad = Number(p?.monto_penalidad ?? p?.monto);
            return p?.tipo_movimiento === 'penalidad' && /penalidad/i.test(`${p.concepto || ''} ${p.texto_original || ''}`) &&
                Number(p.penalidad_porcentaje) === 10 && Number.isSafeInteger(monto) && monto > 0 && monto === montoPenalidad;
        };
        const parteComprobante = y => parteConfirmada(y) || partePenalidad(y);
        for (const x of movimientos) {
            if (salida.has(x) || !pagoTieneIdentificadorFuerte(x.pago) || !parteConfirmada(x)) continue;
            // El parser también muestra movimientos informativos o servicios no
            // cobrados que pueden repetir el folio del bloque. Primero se conservan
            // las partes confirmadas y la penalidad explícita. Si el comprobante
            // sólo tiene una tercera parte sin clasificar, se ofrece como penalidad
            // manual: el servidor todavía exige que coincida con el único ajuste
            // activo del 10% y que el total salde exactamente el grupo.
            const relacionados = movimientos.filter(y => pagoCoincide(x.pago,
                { ...y.pago, datos_origen: { bovtar: y.pago.bovtar } }));
            let grupo = relacionados.filter(parteComprobante);
            let penalidadInferida = null;
            const alojamientos = relacionados.filter(y => parteConfirmada(y) && y.pago.tipo_movimiento === 'alojamiento');
            const penalidadesExplicitas = relacionados.filter(partePenalidad);
            const extras = relacionados.filter(y => !parteConfirmada(y) && !partePenalidad(y) &&
                Number.isSafeInteger(Number(y.pago?.monto)) && Number(y.pago.monto) > 0 && y.pago?.moneda === 'CLP' &&
                Boolean(y.pago?.fecha_comprobante) && Boolean(medioLibro(y.pago)) && y.pago?.origen?.hoja && y.pago?.origen?.celda);
            if (alojamientos.length === 2 && penalidadesExplicitas.length === 0 && extras.length === 1) {
                penalidadInferida = extras[0];
                grupo = [...alojamientos, penalidadInferida];
            }
            if (![2,3].includes(grupo.length)) continue;
            const esPenalidad = y => partePenalidad(y) || y === penalidadInferida;
            const tipoEfectivo = y => esPenalidad(y) ? 'penalidad' : y.pago.tipo_movimiento;
            const tipos = grupo.map(tipoEfectivo).sort().join('|');
            if (!['alojamiento|servicio','alojamiento|alojamiento','alojamiento|alojamiento|penalidad'].includes(tipos)) continue;
            const asignaciones = grupo.map(y => ({ movimiento:y, destino:destinos.get(claveReserva(y.reserva)) }));
            if (asignaciones.some(({destino}) => !destino?.reserva_id || !destino.estadia_id || destino.bloqueado)) continue;
            const r = x.reserva;
            if (!grupo.every(y => y.pago.fecha_bloque === y.reserva.fecha_checkin &&
                y.pago.fecha_comprobante === x.pago.fecha_comprobante && !!y.pago.fecha_comprobante &&
                ['folio','bovtar','codigo_autorizacion'].every(k => normalizarId(y.pago[k]) === normalizarId(x.pago[k])) &&
                Number(y.pago.cabana) === Number(y.reserva.cabana) && y.pago.moneda === 'CLP' &&
                medioLibro(y.pago) && medioLibro(y.pago) === medioLibro(x.pago) &&
                Number.isSafeInteger(y.pago.monto) && y.pago.monto > 0 &&
                (parteConfirmada(y) || esPenalidad(y)) &&
                y.pago.origen?.hoja && y.pago.origen?.celda)) continue;
            if (new Set(grupo.map(y => y.pago.origen.hoja)).size !== 1 ||
                new Set(grupo.map(y => source(y.pago.origen))).size !== grupo.length) continue;
            const total = grupo.reduce((n,y) => n + y.pago.monto, 0);
            if (!Number.isSafeInteger(total)) continue;
            const declarados = grupo.map(y => String(y.pago.texto_original || '').match(/\bmonto\b\s*:?[ \t]*\$?[ \t]*([\d.]+)/i)?.[1])
                .filter(Boolean).map(v => Number(v.replace(/\./g,'')));
            if (declarados.some(v => v !== total)) continue;
            const ids = grupo.map(idMovimientoIncorporacion).sort();
            let distribucion;
            if (tipos === 'alojamiento|servicio') {
                if (!grupo.every(y => claveReserva(y.reserva) === claveReserva(r))) continue;
                if (!grupo.every(y => S.mismaPersona(y.pago.titular,r.titular))) continue;
                const destino = asignaciones[0].destino;
                if (!asignaciones.every(item => item.destino.reserva_id === destino.reserva_id && item.destino.estadia_id === destino.estadia_id)) continue;
                const compatibles = (comp.snapshot?.estadias || []).filter(s => candidatoElegible(s) &&
                    S.mismaPersona(s.titular, r.titular) && s.fecha_checkin === r.fecha_checkin);
                if (compatibles.length !== 1 || compatibles[0].reserva_id !== destino.reserva_id ||
                    String(compatibles[0].id) !== String(destino.estadia_id)) continue;
                distribucion = { tipo:'estadia_partes', id:'distribucion:' + ids.join('|'), ids, total,
                    reserva_id_ancla:destino.reserva_id, estadia_id:compatibles[0].id, titular:r.titular, cabana:r.cabana,
                    dependeDe:[...new Set(asignaciones.flatMap(item => item.destino.dependeDe || []))],
                    componentes:grupo.map(y => ({ ...y.pago, item_id:idMovimientoIncorporacion(y) })) };
            } else {
                const estadias = asignaciones.map(({destino}) => (comp.snapshot?.estadias || []).find(s =>
                    String(s.id) === String(destino.estadia_id) && s.reserva_id === destino.reserva_id));
                const grupoId = estadias[0]?.grupo_reserva_id;
                const titularesPago = new Set(grupo.map(y => S.normalizar(y.pago.titular)).filter(Boolean));
                const reservasLibro = grupo.filter(y => y.pago.tipo_movimiento === 'alojamiento').map(y => y.reserva);
                const seguro = grupoId && estadias.every(Boolean) && estadias.every(s => s.grupo_reserva_id === grupoId) &&
                    new Set(estadias.map(s => String(s.id))).size === 2 &&
                    new Set(estadias.map(s => String(s.reserva_id))).size === 2 &&
                    titularesPago.size === 1 &&
                    grupo.every((y,indice) => mismasFechas(y.reserva,estadias[indice]) &&
                        Number(y.reserva.cabana) === Number(estadias[indice].cabana)) &&
                    reservasLibro.length === 2 && identidad(reservasLibro[0],reservasLibro[1]).compatible;
                if (!seguro) continue;
                const componentes = asignaciones.map(({movimiento:y,destino},indice) => ({
                    ...y.pago,
                    ...(esPenalidad(y) ? {
                        tipo_movimiento_original:y.pago.tipo_movimiento,
                        tipo_movimiento:'penalidad', rol_comprobante:'penalidad_10',
                        penalidad_porcentaje:10, monto_penalidad:y.pago.monto,
                        clasificacion_manual_penalidad:y === penalidadInferida
                    } : {}),
                    item_id:idMovimientoIncorporacion(y), reserva_id:destino.reserva_id,
                    estadia_id:destino.estadia_id, grupo_reserva_id:grupoId, titular_reserva:estadias[indice].titular
                })).sort((a,b) => Number(a.tipo_movimiento === 'penalidad')-Number(b.tipo_movimiento === 'penalidad') || Number(a.cabana)-Number(b.cabana));
                const conPenalidad = tipos === 'alojamiento|alojamiento|penalidad';
                distribucion = { tipo:conPenalidad ? 'grupo_alojamiento_penalidad' : 'grupo_alojamiento',
                    id:'distribucion:' + ids.join('|'), ids, total,
                    reserva_id_ancla:componentes[0].reserva_id, grupo_reserva_id:grupoId, titular:estadias[0].titular,
                    titular_pago:grupo[0].pago.titular,
                    ...(conPenalidad ? { penalidad_monto:componentes.find(c => c.tipo_movimiento === 'penalidad').monto,
                        penalidad_porcentaje:10, penalidad_inferida:Boolean(penalidadInferida) } : {}),
                    dependeDe:[...new Set(asignaciones.flatMap(item => item.destino.dependeDe || []))], componentes };
            }
            grupo.forEach(y => salida.set(y, distribucion));
        }
        return salida;
    }

    const CAPACIDAD_PAGOS_SERVICIO_4C = Object.freeze({
        version: 1,
        contrato: 'aplicaciones_servicio_v1',
        rpc: 'haiku_incorporar_pago_servicios_libro_v1'
    });

    function capacidadPagosServicioValida(data) {
        return data?.version === CAPACIDAD_PAGOS_SERVICIO_4C.version &&
            data?.contrato === CAPACIDAD_PAGOS_SERVICIO_4C.contrato &&
            data?.rpc === CAPACIDAD_PAGOS_SERVICIO_4C.rpc &&
            data?.efectivo_sin_identificador === false;
    }

    async function consultarCapacidadPagosServicio(cliente) {
        if (!cliente?.rpc) return { disponible: false, motivo: 'La escritura protegida de pagos de servicios todavía no está disponible.' };
        try {
            const { data, error } = await cliente.rpc('haiku_libro_aplicaciones_servicio_capacidad_v1', {});
            if (error || !capacidadPagosServicioValida(data)) {
                return { disponible: false, motivo: 'La escritura protegida de pagos de servicios todavía no está disponible.' };
            }
            return { disponible: true, ...CAPACIDAD_PAGOS_SERVICIO_4C, efectivo_sin_identificador: false };
        } catch (_) {
            return { disponible: false, motivo: 'La escritura protegida de pagos de servicios todavía no está disponible.' };
        }
    }

    function motivosDestinoFinanciero(resolucion, capacidad) {
        if (!resolucion) return ['No fue posible comprobar el destino financiero del pago de servicio.'];
        if (resolucion.estado === 'destino_unico') {
            return capacidad?.disponible ? [] : [capacidad?.motivo || 'El pago tiene un destino financiero seguro, pero la escritura protegida de servicios todavía no está disponible.'];
        }
        const detalles = [...new Set((resolucion.aplicaciones || []).map(aplicacion => aplicacion.motivo).filter(Boolean))];
        return detalles.length ? detalles : [resolucion.motivo || 'El destino financiero requiere revisión.'];
    }

    function payloadPagoServicio4C(pago, destino, resolucion, snapshotFinanciero, aprobadoManualmente) {
        if (!destino?.reserva_id || resolucion?.estado !== 'destino_unico') return null;
        const pagos = new Map((snapshotFinanciero?.pagos || []).map(item => [item.id, item]));
        const aplicaciones = (resolucion.aplicaciones || []).map(aplicacion => {
            const cargo = aplicacion.cargo || {};
            const servicio = cargo.servicio || {};
            const cantidad = (snapshotFinanciero?.aplicaciones || []).filter(item => item.cargo_id === aplicacion.cargo_id && pagos.get(item.pago_id)?.estado === 'confirmado').length;
            return {
                cargo_id: aplicacion.cargo_id,
                servicio_id: cargo.servicio_id || servicio.id || null,
                concepto_canon: aplicacion.concepto_canon || null,
                monto: Number(aplicacion.monto),
                saldo_esperado: Number(cargo.saldo_cargo),
                aplicado_esperado: Number(cargo.aplicado_neto || 0),
                cantidad_aplicaciones_esperada: cantidad,
                fecha_contexto: aplicacion.fecha || null,
                fecha_servicio_esperada: servicio.fecha_servicio || null
            };
        });
        const total = aplicaciones.reduce((suma, aplicacion) => suma + aplicacion.monto, 0);
        const validas = aplicaciones.length > 0 && aplicaciones.every(aplicacion =>
            aplicacion.cargo_id && aplicacion.servicio_id && aplicacion.concepto_canon &&
            Number.isSafeInteger(aplicacion.monto) && aplicacion.monto > 0 &&
            Number.isSafeInteger(aplicacion.saldo_esperado) && aplicacion.saldo_esperado > 0 &&
            Number.isSafeInteger(aplicacion.aplicado_esperado) && aplicacion.aplicado_esperado >= 0 &&
            Number.isSafeInteger(aplicacion.cantidad_aplicaciones_esperada) && aplicacion.cantidad_aplicaciones_esperada >= 0 &&
            aplicacion.fecha_servicio_esperada);
        const bovtar = pago.bovtar || null;
        const idFuerte = normalizarId(pago.codigo_autorizacion) || (normalizarId(pago.folio) && normalizarId(bovtar));
        if (!validas || total !== Number(pago.monto) || pago.moneda !== 'CLP' || !idFuerte || !medioLibro(pago) || !pago.fecha_comprobante) return null;
        return {
            contrato: CAPACIDAD_PAGOS_SERVICIO_4C.contrato,
            reserva_ref: null,
            argumentos: {
                p_reserva_id: destino.reserva_id,
                p_monto: Number(pago.monto),
                p_medio_pago: medioLibro(pago),
                p_etapa_operativa: 'abono',
                p_fecha_pago: pago.fecha_comprobante,
                p_folio: pago.folio || null,
                p_codigo_autorizacion: pago.codigo_autorizacion || null,
                p_bove: bovtar,
                p_referencia_externa: pago.texto_original || null,
                p_observaciones: pago.texto_original || null,
                p_aplicaciones: [],
                p_modo_aplicacion: 'ninguno'
            },
            datos_origen: {
                bovtar,
                fecha_bloque: pago.fecha_bloque,
                origen: pago.origen,
                aplicaciones_servicio_v1: {
                    version: CAPACIDAD_PAGOS_SERVICIO_4C.version,
                    reserva_id: destino.reserva_id,
                    monto_total: Number(pago.monto),
                    moneda: pago.moneda,
                    aplicaciones
                }
            },
            aprobado_manualmente: aprobadoManualmente === true
        };
    }

    function crearPlanIncorporacion(reservas, comp, decisiones = new Map(), aprobados = new Set(), anterior = null, capacidadServicios = null) {
        const plan = { escrituraHabilitada: ESCRITURA_LIBRO, items: [], permisos: [], alcance: 'Registros visibles con la sesión actual' };
        const snapshot = comp.snapshot || { estadias: [], pagos: [] };
        const add = (categoria, id, texto, payload = null, motivos = [], dependeDe = [], permisos = []) => {
            const item = { categoria, id, texto, payload, motivos, dependeDe, permisos, seleccionado: !motivos.length && CATEGORIAS_GUARDABLES.includes(categoria) };
            plan.items.push(item); return item;
        };
        const destinos = new Map();
        // El destino financiero puede quedar demostrado por grupo, CAB y fechas
        // aunque la actualización de datos personales todavía tenga advertencias.
        // Se conserva aparte para no convertir un cambio de titular/RUT en un
        // falso bloqueo de pagos existentes o de un comprobante conjunto.
        const destinosFinancierosSeguros = new Map();
        const usados = new Set();
        for (const g of comp.grupos || []) {
            const d = decisiones.get(g.clave);
            if (d && !d.valor) { add('pendientes', 'reserva:' + g.clave, descripcionGrupo(g), null, ['Dejar pendiente: no se incorpora.']); continue; }
            const previa = anterior?.grupos?.find(x => x.clave === g.clave);
            let categoria = g.estado === 'asociada' ? 'asociadas' : g.estado === 'sin_coincidencia' ? 'nuevas' : 'pendientes';
            let destino = null;
            if (g.estado !== 'asociada' && d) {
                const opcion = preguntaPresentacion(g).opciones.find(o => o.valor === d.valor);
                if (opcion) {
                    categoria = opcion.categoria === 'independientes' ? 'nuevas' : opcion.categoria;
                    if (/^(asociar|estadia|actualizar):/.test(opcion.valor)) destino = snapshot.estadias.find(s => String(s.id) === opcion.valor.slice(opcion.valor.indexOf(':') + 1));
                } else categoria = 'pendientes';
            }
            const id = 'reserva:' + g.clave;
            const titulo = descripcionGrupo(g);
            if (categoria === 'pendientes') { add(categoria, id, titulo, null, ['Elige cómo tratar esta reserva en la comparación.']); continue; }
            const existentes = g.items.filter(i => i.sistema).map(i => i.sistema.reserva_id);
            const reservaId = destino?.reserva_id || (new Set(existentes).size === 1 ? existentes[0] : null);
            if (categoria === 'asociadas') {
                if (!reservaId && g.estado !== 'asociada') { add('pendientes', id, titulo, null, ['No hay una reserva destino única.']); continue; }
                const destinosExactosGrupo = new Map();
                if (destino && g.items.length > 1) {
                    const mismaUnidad = estadia => destino.grupo_reserva_id ?
                        estadia.grupo_reserva_id === destino.grupo_reserva_id : estadia.reserva_id === destino.reserva_id;
                    const asignaciones = g.items.map(i => snapshot.estadias.filter(estadia => mismaUnidad(estadia) &&
                        candidatoElegible(estadia) && mismasFechas(i.libro,estadia) && Number(i.libro.cabana) === Number(estadia.cabana)));
                    const unicas = asignaciones.every(lista => lista.length === 1) &&
                        new Set(asignaciones.map(lista => String(lista[0].id))).size === g.items.length &&
                        asignaciones.some(lista => String(lista[0].id) === String(destino.id));
                    if (unicas) g.items.forEach((i,indice) => destinosExactosGrupo.set(i,asignaciones[indice][0]));
                }
                let cambios = 0;
                for (const i of g.items) {
                    const s = i.sistema || destinosExactosGrupo.get(i) || destino;
                    if (!s) continue;
                    const mismaUnidadFinanciera = estadia => destino?.grupo_reserva_id ?
                        estadia.grupo_reserva_id === destino.grupo_reserva_id : destino ?
                            estadia.reserva_id === destino.reserva_id : estadia.reserva_id === s.reserva_id;
                    const candidatosFinancieros = snapshot.estadias.filter(estadia => mismaUnidadFinanciera(estadia) &&
                        candidatoElegible(estadia) && mismasFechas(i.libro,estadia) && Number(i.libro.cabana) === Number(estadia.cabana));
                    const financiero = i.sistema && candidatoElegible(i.sistema) && mismasFechas(i.libro,i.sistema) &&
                        Number(i.libro.cabana) === Number(i.sistema.cabana) ? i.sistema :
                        candidatosFinancieros.length === 1 ? candidatosFinancieros[0] : null;
                    if (financiero) destinosFinancierosSeguros.set(claveReserva(i.libro), {
                        reserva_id:financiero.reserva_id, estadia_id:financiero.id,
                        grupo_reserva_id:financiero.grupo_reserva_id || null, titular:financiero.titular,
                        dependeDe:[], bloqueado:false
                    });
                    const hermanas = g.items.filter(j => (j.sistema || destino)?.reserva_id === s.reserva_id).map(j => j.libro);
                    const compartido = { ...i.libro, texto_original:[...new Set(hermanas.map(r => r.texto_original).filter(Boolean))].join('\n'),
                        notas_importantes:[...new Set(hermanas.flatMap(r => r.notas_importantes || []))],
                        pagos_pendientes:[...new Set(hermanas.flatMap(r => r.pagos_pendientes || []))], servicios:serviciosReservaUnicos(hermanas) };
                    const payload = actualizacionReservaLibro(compartido,s), updateId = 'actualizar:' + (i.libro.id || claveReserva(i.libro)) + ':' + s.id;
                    const motivos = g.items.length > 1 && destino && !i.sistema && !destinosExactosGrupo.has(i) ?
                        ['Elige por separado la estadía destino de cada cabaña.'] : [];
                    for (const k of ['adultos','ninos','mascotas']) if (i.libro[k] != null && (!Number.isInteger(i.libro[k]) || i.libro[k] < (k === 'adultos' ? 1 : 0))) motivos.push('El Libro contiene una cantidad inválida de '+k+'.');
                    for (const k of ['rut_documento','correo','telefono']) if (new Set(hermanas.map(r => S.normalizar(r[k])).filter(Boolean)).size>1) motivos.push('El Libro contiene valores incompatibles de '+k+' para la misma reserva.');
                    const dependeDe = [];
                    if (payload.cambios.length) {
                        const item = add('actualizaciones', updateId, descripcionGrupo({...g, principal:i.libro, cabanas:[i.libro.cabana]}) + ' · Usar los datos del Libro', payload, motivos, [], ['reservas.editar']);
                        item.cambios = payload.cambios; cambios++; dependeDe.push(updateId);
                        if (['fecha_ingreso','fecha_salida','tipo_estadia'].some(k => k in payload.estadia.despues)) {
                            item.aviso = 'Se corregirán las noches y cargos de alojamiento. Las noches nuevas usarán la tarifa del catálogo; los pagos de noches retiradas quedarán como saldo disponible. Los importes de los pagos se conservan.';
                            item.permisos.push('pagos.verificar');
                        }
                    }
                    const destinoFinanciero = destinosFinancierosSeguros.get(claveReserva(i.libro));
                    if (destinoFinanciero) {
                        const camposIdentidad = new Set(['titular_nombre','titular_numero_documento','titular_tipo_documento']);
                        const cambiaIdentidad = Object.keys(payload.reserva?.despues || {}).some(campo => camposIdentidad.has(campo));
                        // Adultos, estado y otros datos del Libro siguen siendo cambios
                        // opcionales. Sólo titular/RUT deben preceder al pago porque el
                        // destino financiero ya quedó probado por reserva, estadía, CAB,
                        // fechas y grupo exactos.
                        destinoFinanciero.dependeDe = cambiaIdentidad ? [...dependeDe] : [];
                    }
                    destinos.set(claveReserva(i.libro), { reserva_id:s.reserva_id, estadia_id:s.id, dependeDe, bloqueado:!!motivos.length });
                }
                if (!cambios) {
                    const categoriaCoincidente = g.estado === 'asociada' && previa && previa.estado !== 'asociada' ? 'omitidos' : 'asociadas';
                    const item = add(categoriaCoincidente, id, titulo + ' · Ya coincide con el Libro.', { reserva_id: reservaId, reserva_ids: [...new Set(existentes)] });
                    if (categoriaCoincidente === 'asociadas') {
                        const clavesGrupo = new Set(g.items.map(i => claveReserva(i.libro)));
                        item.movimientosLibro = (comp.pagosDetalle || []).filter(x => clavesGrupo.has(claveReserva(x.reserva)));
                    }
                }
                continue;
            }
            const motivos = [];
            const estadias = [];
            for (const i of g.items) {
                const r = i.libro;
                if (categoria === 'estadias' && snapshot.estadias.some(s => s.reserva_id === reservaId && mismasFechas(r,s) && Number(r.cabana) === Number(s.cabana))) continue;
                const key = claveReserva(r);
                if (usados.has(key)) motivos.push('La misma estadía ya está preparada en otro elemento.');
                usados.add(key);
                if (!esReservaValida(r)) motivos.push('Faltan titular, CAB o fechas válidas.');
                if (!['alojamiento','full_day'].includes(r.tipo_estadia) || (r.tipo_estadia === 'full_day') !== (r.fecha_checkin === r.fecha_checkout)) motivos.push('Revisa el tipo de estadía y las fechas.');
                if (!Number.isInteger(r.adultos) || r.adultos < 1) motivos.push('Falta una cantidad válida de adultos.');
                for (const k of ['ninos','mascotas']) if (r[k] != null && (!Number.isInteger(r[k]) || r[k] < 0)) motivos.push('Cantidad inválida: ' + k);
                estadias.push({ cabana_numero: r.cabana, datos: { fecha_ingreso: r.fecha_checkin, fecha_salida: r.fecha_checkout,
                    tipo_estadia: r.tipo_estadia === 'full_day' ? 'fullday' : 'alojamiento', adultos: r.adultos ?? null,
                    ninos: r.ninos ?? null, mascotas: r.mascotas ?? null, estado_estadia: estadoLibro(r) || 'pendiente' }, noches: r.tipo_estadia === 'full_day' ? 0 : (Date.parse(r.fecha_checkout)-Date.parse(r.fecha_checkin))/86400000,
                    estado_libro: r.estado_operativo || null, notas: r.notas_importantes || [], solicitudes: r.servicios || [] });
            }
            if (categoria === 'estadias' && !reservaId) motivos.push('Falta la reserva destino.');
            if (!estadias.length) { add('omitidos', id, titulo + ' · Las estadías ya existen.'); continue; }
            const r = g.principal;
            for (const k of ['rut_documento','correo','telefono']) {
                const valores = new Set(g.items.map(i => i.libro[k]).filter(Boolean));
                if (valores.size > 1) motivos.push('El grupo contiene datos diferentes en ' + k + '.');
            }
            const conocido = k => g.items.map(i => i.libro[k]).find(v => v != null && v !== '') ?? null;
            const payload = { contrato: 'haiku_incorporar_libro_v1', reserva_id: categoria === 'estadias' ? reservaId : null,
                reserva_ref: categoria === 'nuevas' ? id : null,
                reserva: categoria === 'nuevas' ? { titular_nombre: r.titular, titular_numero_documento: conocido('rut_documento'), titular_tipo_documento: null,
                    correo_contacto: conocido('correo'), telefono_contacto: conocido('telefono'), estado_reserva: 'pendiente',
                    observaciones: [...new Set(g.items.flatMap(i => [i.libro.texto_original, ...(i.libro.notas_importantes || [])]).filter(Boolean))].join('\n') || null } : null,
                estadias, estado_confirmacion_libro: r.estado_confirmacion || null };
            const item = add(categoria, id, titulo + (reservaId ? ' · Añadir a reserva ' + reservaId : ' · Crear una reserva con ' + estadias.length + ' estadía(s)') + ' · Estado propuesto: ' + [...new Set(estadias.map(e => e.datos.estado_estadia))].join(', '), payload, [...new Set(motivos)], [], [categoria === 'nuevas' ? 'reservas.crear' : 'reservas.editar']);
            g.items.forEach(i => destinos.set(claveReserva(i.libro), { reserva_id: categoria === 'estadias' ? reservaId : null, reserva_ref: categoria === 'nuevas' ? id : null, dependeDe: [id], bloqueado: !!item.motivos.length }));
        }
        // La comparación de pagos se calcula antes de que el operador resuelva una
        // asociación ambigua. Al elegir explícitamente "Es la misma reserva", esa
        // decisión ya entrega la reserva_id que faltaba: repetimos únicamente la
        // reconciliación financiera segura contra esa reserva, sin usar el nombre
        // anterior del titular como llave ni alterar la comparación original.
        const clavesResueltasPorDecision = new Set();
        const resultadosConDecision = Array.from(comp || []).map(resultado => {
            if (resultado.estado === 'asociada') return resultado;
            const destino = destinosFinancierosSeguros.get(claveReserva(resultado.libro)) || destinos.get(claveReserva(resultado.libro));
            if (!destino?.reserva_id || !destino.estadia_id || destino.bloqueado) return resultado;
            const sistema = snapshot.estadias.find(estadia => String(estadia.id) === String(destino.estadia_id) &&
                estadia.reserva_id === destino.reserva_id);
            if (!sistema) return resultado;
            clavesResueltasPorDecision.add(claveReserva(resultado.libro));
            return { ...resultado, estado:'asociada', sistema };
        });
        const pagosExistentesPorDecision = clavesResueltasPorDecision.size ?
            pagosDebilesExistentes(resultadosConDecision, snapshot.pagos.filter(pagoSistemaVigente)) : new Map();
        for (const r of reservas.map(normalizarReservaComparacion).filter(r => !esReservaValida(r))) add('pendientes', 'invalida:' + claveReserva(r), (r.titular || 'Sin titular') + ' · CAB ' + (r.cabana || 'sin dato'), null, ['Faltan titular, cabaña o fechas válidas.']);
        const destinosFinancieros = new Map(destinos);
        destinosFinancierosSeguros.forEach((valor,clave) => destinosFinancieros.set(clave,valor));
        const distribuciones = distribucionesManuales(comp, destinosFinancieros);
        const vistos = [];
        for (const x of comp.pagosDetalle || []) {
            const p = x.pago, r = x.reserva, destino = destinosFinancieros.get(claveReserva(r));
            const id = idMovimientoIncorporacion(x);
            if (plan.items.some(i => i.id === id)) continue;
            const texto = r.titular + ' · CAB ' + r.cabana + ' · ' + money(p.monto) + ' · ' + (p.concepto || p.tipo_movimiento) + ' · Check-In ' + r.fecha_checkin;
            const fuerte = pagoTieneIdentificadorFuerte(p);
            const existentePorDecision = clavesResueltasPorDecision.has(claveReserva(r)) ? pagosExistentesPorDecision.get(p) : null;
            if (existentePorDecision?.id) {
                add('omitidos', id, texto + (medioLibro(p) === 'transferencia' ?
                    ' · La transferencia ya existe en la reserva elegida de Proyecto H y no se incorporará nuevamente.' :
                    ' · El pago ya existe en la reserva elegida de Proyecto H y no se incorporará nuevamente.'));
                continue;
            }
            if (x.estado === 'en_sistema' && x.sistema?.id) {
                add('omitidos', id, texto + (medioLibro(p) === 'transferencia' ?
                    ' · La transferencia ya existe en Proyecto H y no se incorporará nuevamente.' :
                    ' · El pago ya existe en Proyecto H y no se incorporará nuevamente.'));
                continue;
            }
            const coincidencias = fuerte ? snapshot.pagos.filter(v => pagoCoincide(p,v)) : [];
            const duplicado = coincidencias[0];
            const distribucion = distribuciones.get(x);
            if (distribucion) {
                if (duplicado) {
                    const yaDistribuido = coincidencias.length === 1 && duplicado.reserva_id === distribucion.reserva_id_ancla &&
                        Number(duplicado.monto) === distribucion.total &&
                        duplicado.datos_origen?.distribucion_manual?.id === distribucion.id;
                    add(yaDistribuido ? 'omitidos' : 'dudosos', id, texto + (yaDistribuido ? ' · Ya existe en Proyecto H.' : ''), null,
                        yaDistribuido ? [] : ['El comprobante ya existe en Proyecto H; revisa su distribución sin registrarlo nuevamente.']);
                    continue;
                }
                const manual = aprobados.has(id);
                const item = add(manual ? 'pagos' : 'dudosos', id, texto,
                    { contrato: 'haiku_incorporar_libro_v1', reserva_ref: null,
                        argumentos: { p_reserva_id: distribucion.reserva_id_ancla, p_monto: p.monto, p_medio_pago: medioLibro(p),
                            p_etapa_operativa: 'abono', p_fecha_pago: p.fecha_comprobante, p_folio: p.folio,
                            p_codigo_autorizacion: p.codigo_autorizacion, p_bove: p.bove || null,
                            p_referencia_externa: p.texto_original, p_observaciones: p.texto_original,
                            p_aplicaciones: [], p_modo_aplicacion: 'ninguno' },
                        datos_origen: { bovtar: p.bovtar, fecha_bloque: p.fecha_bloque, origen: p.origen }, aprobado_manualmente: manual },
                    manual ? [] : ['Requiere aprobación manual de esta parte del comprobante y su asociación.'], distribucion.dependeDe || [], ['pagos.registrar']);
                item.aprobable = !manual;
                item.distribucionManual = distribucion;
                const componente = distribucion.componentes.find(parte => parte.item_id === id);
                if (componente?.clasificacion_manual_penalidad) {
                    item.etiquetaAprobacion = 'Asociar como penalidad 10%';
                }
                item.aviso = distribucion.tipo === 'grupo_alojamiento_penalidad' ?
                    `Comprobante compartido entre cabañas: ${money(distribucion.total)} en total, incluida la penalidad 10% de ${money(distribucion.penalidad_monto)} que ya existe en Proyecto H. Aprueba el comprobante completo para confirmar una sola transacción y saldar sus cargos sin crear otra penalidad.${distribucion.penalidad_inferida ? ' La parte de penalidad será aceptada sólo si el servidor confirma el ajuste activo del 10% y el saldo exacto del grupo.' : ''}` :
                    distribucion.tipo === 'grupo_alojamiento' ?
                    `Comprobante compartido entre cabañas: ${money(distribucion.total)} en total. Aprueba ambas partes para confirmar una sola transacción y conservar cuánto corresponde a cada cabaña.` :
                    `Comprobante compartido: ${money(distribucion.total)} en total. Aprueba y selecciona ambas partes para confirmar una sola transacción. Early Check-In conserva su concepto; si no hay un cargo de ese servicio, su importe queda sin aplicar hasta regularizarlo.`;
                continue;
            }
            if (duplicado) {
                const patch = actualizacionPagoLibro(p,duplicado);
                if (coincidencias.length !== 1 || duplicado.reserva_id !== destino?.reserva_id) {
                    add('dudosos',id,texto,null,['El identificador pertenece a otra reserva o a varios pagos; confirma el destino correcto.']); continue;
                }
                if (!patch.cambios.length) { add('omitidos',id,texto+' · El pago ya coincide con el Libro.'); continue; }
                const motivos = [];
                if (destino?.bloqueado || !r.pagos.includes(p)) motivos.push('Primero confirma la asociación del movimiento con la reserva.');
                if (!Number.isSafeInteger(p.monto) || p.monto <= 0 || p.moneda !== 'CLP') motivos.push('El monto o la moneda requiere revisión.');
                const aplicacionesDistribuidas = p.transaccion_distribuida && Array.isArray(p.aplicaciones_libro) &&
                    p.aplicaciones_libro.length > 1 && p.aplicaciones_libro.every(aplicacion =>
                        Number.isSafeInteger(Number(aplicacion?.monto)) && Number(aplicacion.monto) > 0) &&
                    p.aplicaciones_libro.reduce((total, aplicacion) => total + Number(aplicacion.monto), 0) === Number(p.monto);
                if (!aplicacionesDistribuidas && (p.tipo_movimiento !== 'alojamiento' || p.pago_recibido !== true || p.estado_pago !== 'registrado_en_libro')) motivos.push('El Libro no confirma este pago recibido de alojamiento.');
                if (p.fecha_bloque !== r.fecha_checkin) motivos.push('El pago no pertenece al bloque del Check-In.');
                if (!medioLibro(p)) motivos.push('Falta precisar el medio de pago.');
                const otros = (comp.pagosDetalle || []).filter(y => y !== x && pagoCoincide(p,{...y.pago,datos_origen:{bovtar:y.pago.bovtar}}));
                if (otros.some(y => claveReserva(y.reserva) !== claveReserva(r) || JSON.stringify(actualizacionPagoLibro(y.pago,duplicado).despues) !== JSON.stringify(patch.despues))) motivos.push('El Libro repite el identificador con datos incompatibles.');
                if (plan.items.some(i => i.payload?.pago_id === duplicado.id)) { add('omitidos',id,texto+' · Actualización del mismo pago ya preparada.'); continue; }
                const item = add('actualizaciones',id,texto+' · Actualizar pago con el Libro',
                    {tipo:'pago_actualizar',pago_id:duplicado.id,reserva_id:duplicado.reserva_id,pago:patch,identificadores:{codigo_autorizacion:p.codigo_autorizacion,folio:p.folio,bovtar:p.bovtar,bove:p.bove}},
                    motivos,destino?.dependeDe || [],['pagos.registrar','pagos.verificar']);
                item.cambios=patch.cambios;
                item.pagoLibro = p;
                item.pagoSistema = duplicado;
                if (aplicacionesDistribuidas) {
                    const detalle = p.aplicaciones_libro.map(aplicacion =>
                        `${aplicacion.concepto || aplicacion.tipo_movimiento || 'Aplicación'}: ${money(Number(aplicacion.monto))}`).join(' + ');
                    item.aviso = `Haku reconoce un solo comprobante de ${money(Number(p.monto))}. Distribución del Libro: ${detalle}. Se conserva como un solo pago; no se crean cobros nuevos.`;
                } else if ('monto' in patch.despues) item.aviso='Se corregirá el importe del mismo pago. Si disminuye, se ajustará su distribución entre cargos para no aplicar más que el monto del Libro; quedará registrado el cambio.';
                continue;
            }
            const importado = snapshot.pagos.find(v => v.datos_origen?.item_id === id);
            if (importado) { add('omitidos', id, texto + ' · Este mismo movimiento del Libro ya fue incorporado por Haku.'); continue; }
            const destinoActual = destino?.reserva_id || destino?.reserva_ref;
            if (!fuerte && destino?.reserva_id) {
                const existentesDebiles = snapshot.pagos.filter(v => pagoDebilYaExiste(p, v, destino.reserva_id));
                if (existentesDebiles.length === 1) {
                    add('omitidos', id, texto + ' · La transferencia ya existe en Proyecto H por reserva, monto, medio, fecha y glosa/origen coincidentes.');
                    continue;
                }
            }
            const repetidosIdentificador = fuerte ? vistos.filter(v => pagoCoincide(p, { ...v.pago, datos_origen: { bovtar: v.pago.bovtar } })) : [];
            const conflictoIdentificador = repetidosIdentificador.some(v => Number(v.pago.monto) !== Number(p.monto) || v.pago.moneda !== p.moneda || v.destino !== destinoActual);
            if (conflictoIdentificador) {
                for (const previo of repetidosIdentificador) {
                    if (Number(previo.pago.monto) !== Number(p.monto) || previo.pago.moneda !== p.moneda || previo.destino !== destinoActual) {
                        previo.item.categoria = 'dudosos'; previo.item.seleccionado = false; previo.item.motivos.push('Identificador repetido con monto o reserva diferente.'); previo.item.aprobable = false;
                    }
                }
            }
            if (repetidosIdentificador.length && !conflictoIdentificador) { add('omitidos', id, texto + ' · Omitido porque repite el mismo identificador fuerte.'); continue; }
            const motivos = [];
            if (!destino || destino.bloqueado) motivos.push('Primero resuelve los datos y la asociación de la reserva.');
            if (!(Number.isSafeInteger(p.monto) && p.monto > 0)) motivos.push('Falta un monto válido.');
            if (p.moneda !== 'CLP') motivos.push('Moneda no compatible con el contrato actual.');
            if (p.fecha_bloque !== r.fecha_checkin) motivos.push('El pago no pertenece al bloque del Check-In.');
            const servicio4C = x.destinoFinanciero?.estado === 'destino_unico';
            if (p.tipo_movimiento !== 'alojamiento') motivos.push(...motivosDestinoFinanciero(x.destinoFinanciero, capacidadServicios));
            if (p.pago_recibido !== true || p.estado_pago !== 'registrado_en_libro') motivos.push('El Libro no confirma un pago recibido.');
            const medio = medioLibro(p);
            if (!medio) motivos.push('Falta precisar el medio de pago (Webpay crédito o débito, si corresponde).');
            const asociadoLibro = r.pagos.includes(p);
            const seguro = asociadoLibro && pagoTieneIdentificadorFuerte(p) && (x.estado === 'nuevo_seguro' || destino?.reserva_ref);
            const manual = aprobados.has(id);
            if (servicio4C && !manual) motivos.push('Requiere aprobación manual de la asociación y el pago.');
            const mismoMontoSinIdentificador = !fuerte && (
                snapshot.pagos.some(v => destino?.reserva_id && v.reserva_id === destino.reserva_id && Number(v.monto) === Number(p.monto) && (!v.moneda || v.moneda === p.moneda)) ||
                vistos.some(v => v.destino === destinoActual && Number(v.pago.monto) === Number(p.monto) && v.pago.moneda === p.moneda)
            );
            if (mismoMontoSinIdentificador && !manual) motivos.push('Hay otro pago con la misma reserva y monto, pero sin identificador fuerte; revisa ambos antes de aprobar.');
            if (conflictoIdentificador) motivos.push('Identificador repetido con monto o reserva diferente.');
            if (!seguro && !manual) motivos.push('Requiere aprobación manual de la asociación y el pago.');
            const payloadServicio = servicio4C ?
                payloadPagoServicio4C(p, destino, x.destinoFinanciero, comp.snapshot?.finanzas, manual) : null;
            if (servicio4C && !payloadServicio) motivos.push('La propuesta financiera no cumple el contrato seguro de pagos de servicios.');
            const payload = servicio4C ? payloadServicio : { contrato: 'haiku_incorporar_libro_v1', reserva_ref: destino?.reserva_ref || null,
                argumentos: { p_reserva_id: destino?.reserva_id || null, p_monto: p.monto, p_medio_pago: medio || null, p_etapa_operativa: 'abono', p_referencia_externa: p.texto_original || null,
                    p_fecha_pago: p.fecha_comprobante || null, p_folio: p.folio || null, p_codigo_autorizacion: p.codigo_autorizacion || null,
                    p_bove: p.bove || null, p_observaciones: p.texto_original || null, p_aplicaciones: [], p_modo_aplicacion: 'alojamiento' },
                datos_origen: { bovtar: p.bovtar || null, fecha_bloque: p.fecha_bloque, origen: p.origen }, aprobado_manualmente: manual };
            if (!p.fecha_comprobante) motivos.push('Falta la fecha del comprobante; no se usa la fecha del bloque como fecha de pago.');
            const item = add(motivos.length ? 'dudosos' : 'pagos', id, texto + (destino?.reserva_ref ? ' · Asociar después de crear la reserva' : destino?.reserva_id ? ' · Reserva ' + destino.reserva_id : ''), payload, motivos, destino?.dependeDe || [], ['pagos.registrar']);
            const motivosAprobables = new Set(['Requiere aprobación manual de la asociación y el pago.', 'Hay otro pago con la misma reserva y monto, pero sin identificador fuerte; revisa ambos antes de aprobar.']);
            item.aprobable = motivos.length > 0 && motivos.every(motivo => motivosAprobables.has(motivo));
            item.destinoFinanciero = x.destinoFinanciero || null;
            item.aprobableFinancieramente = x.destinoFinanciero?.estado === 'destino_unico';
            item.backendServiciosDisponible = capacidadServicios?.disponible === true;
            vistos.push({ pago:p, item, destino: destinoActual, manual });
        }
        // Conserva en cada tarjeta el movimiento exacto del Libro que originó el ítem.
        // No se debe reconstruir por titular, cabaña y monto: dos pagos distintos pueden
        // compartir esos tres datos (por ejemplo, un WebPay previo y una transferencia adicional).
        for (const x of comp.pagosDetalle || []) {
            const id = 'pago:' + claveReserva(x.reserva) + ':' + source(x.pago.origen) + ':' + JSON.stringify(x.pago);
            const item = plan.items.find(i => i.id === id);
            if (!item) continue;
            item.pagoLibro = x.pago;
            item.pagoSistema = x.sistema || null;
        }
        consolidarActualizacionesReserva(plan);
        const actualizacionesIdentidad = new Set(plan.items.filter(item => item.payload?.tipo === 'reserva_actualizar' &&
            ['titular_nombre','titular_numero_documento','titular_tipo_documento']
                .some(campo => Object.prototype.hasOwnProperty.call(item.payload.reserva?.despues || {}, campo)))
            .map(item => item.id));
        const dependidasPorPagos = new Set(plan.items.filter(item => item.pagoLibro)
            .flatMap(item => item.dependeDe || []));
        const identidadPrimero = new Set([...actualizacionesIdentidad].filter(id => dependidasPorPagos.has(id)));
        if (identidadPrimero.size) {
            plan.etapa = 'actualizar_identidad';
            plan.actualizacionesIdentidad = [...identidadPrimero];
            const camposIdentidad = new Set(['titular_nombre','titular_numero_documento','titular_tipo_documento']);
            const etiquetasIdentidad = new Set([...camposIdentidad].map(campo => etiquetasActualizacion[campo]));
            for (const item of plan.items) {
                if (identidadPrimero.has(item.id)) {
                    const reserva = item.payload.reserva || { antes:{}, despues:{}, cambios:[] };
                    item.payload.reserva = {
                        antes:Object.fromEntries(Object.entries(reserva.antes || {}).filter(([campo]) => camposIdentidad.has(campo))),
                        despues:Object.fromEntries(Object.entries(reserva.despues || {}).filter(([campo]) => camposIdentidad.has(campo))),
                        cambios:(reserva.cambios || []).filter(cambio => etiquetasIdentidad.has(cambio.campo))
                    };
                    item.payload.estadia = { antes:{}, despues:{}, cambios:[] };
                    item.payload.cambios = [...item.payload.reserva.cambios];
                    item.cambios = [...item.payload.reserva.cambios];
                }
                if (!identidadPrimero.has(item.id)) item.seleccionado = false;
                if (!item.pagoLibro || !(item.dependeDe || []).some(id => identidadPrimero.has(id)) || item.categoria === 'omitidos' ||
                    (!item.aprobable && item.categoria !== 'pagos')) continue;
                item.etapaSiguiente = true;
                item.categoriaAnterior = item.categoria;
                item.categoria = 'dudosos';
                item.seleccionado = false;
                item.aprobable = false;
                item.motivos = ['Paso 2: este pago se habilitará después de confirmar el titular y RUT del Libro.'];
            }
        }
        const gruposComprobante = new Map();
        for (const item of plan.items.filter(item => item.distribucionManual)) {
            const id = item.distribucionManual.id;
            if (!gruposComprobante.has(id)) gruposComprobante.set(id, []);
            gruposComprobante.get(id).push(item);
        }
        for (const items of gruposComprobante.values()) {
            const distribucion = items[0].distribucionManual;
            const completa = distribucion.ids.every(id => plan.items.find(item => item.id === id)?.payload?.aprobado_manualmente === true);
            if (!completa) items.forEach(item => { item.seleccionado = false; });
        }
        if (!identidadPrimero.size && gruposComprobante.size) {
            plan.focoPagos = true;
            // Tras resolver la identidad, los cambios de adultos, estado u otros
            // campos quedan visibles pero opcionales y no se mezclan por defecto
            // con la operación financiera solicitada.
            plan.items.filter(item => item.categoria === 'actualizaciones').forEach(item => { item.seleccionado = false; });
        }
        plan.permisos = [...new Set(plan.items.flatMap(i => i.permisos))];
        contextoVisualPlanes.set(plan, comp);
        return plan;
    }

    async function prepararIncorporacion(result, decisiones = new Map(), aprobados = new Set(), cliente = root.haikuSupabase) {
        const generacion = root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion;
        if (result.generacion !== undefined && result.generacion !== generacion) throw new Error('El Libro cambió; vuelve a comparar.');
        const comparacion = await compararSistema(result.reservas, cliente, result.q);
        if (root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion !== generacion) throw new Error('El Libro cambió; vuelve a comparar.');
        const requiereBackendServicios = (comparacion.pagosDetalle || []).some(item => item.destinoFinanciero?.estado === 'destino_unico');
        const capacidadServicios = requiereBackendServicios ? await consultarCapacidadPagosServicio(cliente) : null;
        if (root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion !== generacion) throw new Error('El Libro cambió; vuelve a comparar.');
        const plan = crearPlanIncorporacion(result.reservas, comparacion, decisiones, aprobados, result.comparacion, capacidadServicios);
        // Las cancelaciones conservan su preview y cancelador propios, fuera del lote genérico.
        if (result.cancelaciones_confirmadas?.length) {
            plan.cancelaciones_confirmadas = result.cancelaciones_confirmadas;
            plan.generacion = result.generacion;
        }
        return plan;
    }

    function crearIdOperacion() {
        if (root.crypto?.randomUUID) return root.crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 3 | 8)).toString(16);
        });
    }

    function serializarIncorporacion(plan) {
        const elegidos = new Set(plan.items.filter(i => i.seleccionado && !i.motivos.length).map(i => i.id));
        const distribuidos = new Set();
        return plan.items.filter(item => elegidos.has(item.id) && item.dependeDe.every(id => elegidos.has(id))).map(item => {
            if (item.distribucionManual) {
                const d = item.distribucionManual;
                if (!d.ids.every(id => elegidos.has(id) && plan.items.find(i => i.id === id)?.payload?.aprobado_manualmente)) {
                    throw new Error('Aprueba y selecciona ambas partes del comprobante compartido antes de confirmar.');
                }
                if (distribuidos.has(d.id)) return null;
                distribuidos.add(d.id);
                return { tipo: 'pago', item_id: d.id, reserva_id: item.payload.argumentos.p_reserva_id,
                    argumentos: { ...item.payload.argumentos, p_monto: d.total,
                        p_referencia_externa: d.componentes.map(c => c.texto_original).join('\n'),
                        p_observaciones: d.componentes.map(c => c.texto_original).join('\n') },
                    datos_origen: { ...item.payload.datos_origen, distribucion_manual: {
                        ...d, componentes: d.componentes.map(c => ({ ...c, aprobado_manualmente: true })) } },
                    aprobado_manualmente: true };
            }
            if (item.categoria === 'actualizaciones') return { ...item.payload, item_id:item.id };
            if (item.categoria === 'nuevas') return {
                tipo: 'reserva_nueva', item_id: item.id,
                reserva: item.payload.reserva, estadias: item.payload.estadias
            };
            if (item.categoria === 'estadias') return {
                tipo: 'estadia', item_id: item.id,
                reserva_id: item.payload.reserva_id, estadias: item.payload.estadias
            };
            if (item.categoria === 'pagos') return {
                tipo: item.payload.contrato === CAPACIDAD_PAGOS_SERVICIO_4C.contrato ? 'pago_servicios_4c' : 'pago', item_id: item.id,
                reserva_id: item.payload.argumentos.p_reserva_id,
                reserva_ref: item.payload.reserva_ref,
                argumentos: item.payload.argumentos,
                datos_origen: item.payload.datos_origen,
                aprobado_manualmente: item.payload.aprobado_manualmente === true
            };
            return null;
        }).filter(Boolean);
    }

    async function confirmarIncorporacion(result, decisiones, aprobados, plan, cliente = root.haikuSupabase) {
        if (!cliente?.rpc) throw new Error('No está disponible la conexión segura con Proyecto H.');
        const usaServicios4C = plan.items.some(i => i.seleccionado && i.payload?.contrato === CAPACIDAD_PAGOS_SERVICIO_4C.contrato) ||
            (plan.solicitudPendiente?.servicios || []).length > 0;
        if (usaServicios4C) {
            const capacidadServicios = await consultarCapacidadPagosServicio(cliente);
            if (!capacidadServicios.disponible) {
                throw new Error('El pago tiene un destino financiero seguro, pero la escritura protegida de servicios todavía no está disponible.');
            }
        }
        if (plan.items.some(i => i.seleccionado && i.distribucionManual) ||
            plan.solicitudPendiente?.items.some(i => i.datos_origen?.distribucion_manual)) {
            const capacidad = await cliente.rpc('haiku_libro_distribucion_capacidad_v1', {});
            const distribuciones = [
                ...plan.items.filter(i => i.seleccionado && i.distribucionManual).map(i => i.distribucionManual),
                ...(plan.solicitudPendiente?.items || []).map(i => i.datos_origen?.distribucion_manual).filter(Boolean)
            ];
            const requiereGrupo = distribuciones.some(d => ['grupo_alojamiento','grupo_alojamiento_penalidad'].includes(d.tipo));
            const requierePenalidad = distribuciones.some(d => d.tipo === 'grupo_alojamiento_penalidad');
            const requierePenalidadManual = distribuciones.some(d => d.penalidad_inferida === true);
            const soportaBase = Number(capacidad.data?.version) >= 1;
            const soportaGrupo = Number(capacidad.data?.version) >= 2 &&
                Array.isArray(capacidad.data?.modos) && capacidad.data.modos.includes('grupo_alojamiento');
            const soportaPenalidad = Number(capacidad.data?.version) >= 3 &&
                Array.isArray(capacidad.data?.modos) && capacidad.data.modos.includes('grupo_alojamiento_penalidad');
            const soportaPenalidadManual = Number(capacidad.data?.version) >= 4 &&
                Array.isArray(capacidad.data?.modos) && capacidad.data.modos.includes('grupo_alojamiento_penalidad_manual');
            if (capacidad.error || !soportaBase || requiereGrupo && !soportaGrupo || requierePenalidad && !soportaPenalidad ||
                requierePenalidadManual && !soportaPenalidadManual) {
                throw new Error('Falta instalar el soporte de comprobantes distribuidos en Proyecto H. Las aprobaciones se conservan; no se registró este comprobante.');
            }
        }
        let solicitud = plan.solicitudPendiente;
        let omitidosAlRevalidar = 0;
        if (!solicitud) {
            const seleccionados = new Set(plan.items.filter(i => i.seleccionado).map(i => i.id));
            if (!seleccionados.size) throw new Error('Selecciona al menos una reserva, estadía o pago.');
            const actualizado = await prepararIncorporacion(result, decisiones, aprobados, cliente);
            for (const item of actualizado.items) {
                const previo = plan.items.find(i => i.id === item.id);
                if (seleccionados.has(item.id) && item.categoria === 'actualizaciones' && JSON.stringify(item.payload) !== JSON.stringify(previo?.payload)) {
                    throw new Error('Proyecto H cambió desde la vista previa. Vuelve a preparar para revisar los valores nuevos antes de confirmar.');
                }
                item.seleccionado = seleccionados.has(item.id) && !item.motivos.length && CATEGORIAS_GUARDABLES.includes(item.categoria);
            }
            const vigentes = new Set(actualizado.items.filter(i => i.seleccionado).map(i => i.id));
            omitidosAlRevalidar = [...seleccionados].filter(id => !vigentes.has(id)).length;
            const serializados = serializarIncorporacion(actualizado);
            if (!serializados.length) throw new Error('Los elementos seleccionados cambiaron o ya existen. Vuelve a preparar la incorporación.');
            const servicios = serializados.filter(item => item.tipo === 'pago_servicios_4c')
                .map(item => ({ operacionId: crearIdOperacion(), item, resultado: null }));
            const items = serializados.filter(item => item.tipo !== 'pago_servicios_4c');
            solicitud = { operacionId: crearIdOperacion(), items, servicios, omitidosAlRevalidar };
            // Cada pago protegido conserva su propia operación idempotente. El lote
            // guarda los resultados parciales para que un reintento continúe desde
            // el primer pago pendiente sin repetir los ya confirmados.
            plan.solicitudPendiente = solicitud;
        } else omitidosAlRevalidar = solicitud.omitidosAlRevalidar || 0;

        const conflictoDatos = error => {
            const mensaje = String(error.message || error.details || error);
            if (/Proyecto H cambi[oó]|vuelve a preparar|ya no (?:est[aá]|es|tiene)|no editable|no es inequ[ií]voco|se superpone|otra operación financiera en curso|saldo o las aplicaciones.+cambiaron|cargo o servicio cambió|destino dejó de ser único|identificador fuerte|múltiples pagos confirmados/i.test(mensaje)) {
                // Un conflicto de datos no es un retry de red: el payload y su
                // snapshot ya no son vigentes. El siguiente paso vuelve a la
                // comparación y conserva decisiones humanas compatibles.
                plan.solicitudPendiente = null;
                const conflicto = new Error(mensaje);
                conflicto.haikuConflictoDatos = true;
                throw conflicto;
            }
            throw error;
        };
        for (const servicio of solicitud.servicios || []) {
            if (servicio.resultado) continue;
            const { data, error } = await cliente.rpc(CAPACIDAD_PAGOS_SERVICIO_4C.rpc, {
                p_operacion_id: servicio.operacionId,
                p_item: servicio.item
            });
            if (error) conflictoDatos(error);
            if (!data?.ok) throw new Error('Proyecto H no confirmó el pago de servicios.');
            servicio.resultado = data;
        }

        let data = { ok: true, reservas_creadas: 0, estadias_agregadas: 0, pagos_creados: 0, actualizaciones: 0, omitidos: 0 };
        if (solicitud.items.length) {
            const respuesta = await cliente.rpc('haiku_incorporar_libro_v1', {
                p_operacion_id: solicitud.operacionId,
                p_items: solicitud.items
            });
            if (respuesta.error) conflictoDatos(respuesta.error);
            data = respuesta.data;
        }
        if (!data?.ok) throw new Error('Proyecto H no confirmó la incorporación.');
        for (const servicio of solicitud.servicios || []) {
            data.pagos_creados = Number(data.pagos_creados || 0) + Number(servicio.resultado?.pagos_creados || 0);
            data.omitidos = Number(data.omitidos || 0) + Number(servicio.resultado?.omitidos || 0);
        }
        return { resultado: data, omitidosAlRevalidar };
    }


    async function consultar(texto, libro = root.HAIKU_LIBRO_RESERVA_V1, cliente = root.haikuSupabase) {
        if (!libro) throw new Error("Abre Libro de Reserva y carga un XLSX primero.");
        await libro.listo();
        const estado = libro.estado(), hojas = libro.listarHojas();
        if (!estado.cargado) throw new Error("Carga primero un XLSX en Libro de Reserva.");
        const q = interpretar(texto, hojas);
        // Between-book queries never enter the system reconciliation/write flow.
        if (q.versiones) q.comparar = false;
        if (q.listar) return { q, archivo: estado.nombre, hojas, reservas: [], aseos: [], espacios: [], anotaciones: [], cambios: [], comparacion: [] };

        const resultado = {
            q,
            generacion: estado.generacion,
            archivo: estado.nombre,
            reservas: [],
            bloqueos: [],
            bloqueos_lectura_segura: true,
            bloqueos_cabanas_revision: [],
            aseos: [],
            espacios: [],
            anotaciones: [],
            cambios: [],
            comparacion: [],
            advertencias: [...q.warnings]
        };

        if (q.nombre && !q.desde && libro.buscarHojas && !q.versiones) {
            const matches = await libro.buscarHojas(q.nombre);
            q.hojas = q.hojas.filter(h => matches.hojas.includes(h));
        }

        const versionesAnterior = [], versionesActual = [];
        resultado.bloqueos_lectura_segura = q.hojas.length > 0;
        for (const h of q.hojas) {
            const data = await libro.consultarHoja(h);
            resultado.bloqueos_lectura_segura &&= data.cobertura?.geometria===true;
            // Una advertencia localizada no invalida la lectura inversa de otras cabañas.
            // Sin contexto seguro, conservar el bloqueo global de las afirmaciones de ausencia.
            for (const aviso of (data.advertencias||[]).filter(a=>/rojo de disponibilidad|marcador FULL DAY de disponibilidad/.test(a))) {
                const contextos=(data.anotaciones||[]).filter(a=>a.origen?.hoja===h && a.origen?.celda && aviso.startsWith(`${h} · ${a.origen.celda}:`));
                if (!contextos.length || contextos.some(a=>!Number.isInteger(a.cabana)||a.cabana<=0)) resultado.bloqueos_lectura_segura=false;
                else for (const a of contextos) if (!resultado.bloqueos_cabanas_revision.includes(a.cabana)) resultado.bloqueos_cabanas_revision.push(a.cabana);
            }
            resultado.advertencias.push(...(data.advertencias || []));
            const reservasHoja = Array.isArray(data.reservas) ? data.reservas : [];
            resultado.bloqueos.push(...(data.bloqueos || []).filter(b =>
                (!q.cabana || b.cabana === Number(q.cabana)) &&
                (!q.nombre || S.normalizar(b.nota).includes(q.nombre)) &&
                (!q.desde || b.fecha_inicio <= q.hasta && b.fecha_fin > q.desde)));
            let seleccionadas = reservasHoja.filter(r => filtrar(r, q));
            if (q.comparar && !seleccionadas.length && reservasHoja.length) {
                seleccionadas = reservasHoja.filter(r => {
                    const rr = normalizarReservaComparacion(r);
                    if (q.cabana && Number(rr.cabana) !== Number(q.cabana)) return false;
                    if (q.nombre && !S.normalizar(rr.titular).includes(q.nombre)) return false;
                    return !q.desde || (rr.fecha_checkin && rr.fecha_checkout && rr.fecha_checkin <= q.hasta && rr.fecha_checkout >= q.desde);
                });
                if (seleccionadas.length) resultado.advertencias.push("Se usó el rango Check-In/Check-Out como respaldo porque la lista de fechas ocupadas no estaba disponible en todas las filas.");
            }
            resultado.reservas.push(...seleccionadas);
            if (q.comparar && data.cancelaciones?.length) {
                try {
                    if (!root.HAIKU_LIBRO_CANCELACIONES_V1?.detectarActual) throw new Error('Motor de cancelaciones no disponible');
                    const cancelaciones = await root.HAIKU_LIBRO_CANCELACIONES_V1.detectarActual(data, cliente);
                    for (const key of ['cancelaciones_confirmadas', 'cancelaciones_ya_coinciden']) {
                        const casos = cancelaciones[key].filter(c => (!q.nombre || S.normalizar(c.actual.titular).includes(q.nombre)) &&
                            (!q.cabana || Number(c.actual.cabana) === Number(q.cabana)) &&
                            (!q.desde || c.actual.fecha_checkin >= q.desde && c.actual.fecha_checkin <= q.hasta));
                        if (casos.length) (resultado[key] ||= []).push(...casos);
                    }
                    if (cancelaciones.cancelaciones_revision.length) (resultado.cancelaciones_revision ||= []).push(...cancelaciones.cancelaciones_revision);
                } catch (error) {
                    const aviso = `${h}: no se pudieron verificar las cancelaciones; requieren revisión manual. ${error.message}`;
                    resultado.advertencias.push(aviso);
                    (resultado.cancelaciones_revision ||= []).push(aviso);
                }
            }
            resultado.aseos.push(...(data.aseos || []).filter(a => (!q.cabana || a.cabana === q.cabana) && (!q.desde || a.fecha >= q.desde && a.fecha <= q.hasta)));
            resultado.espacios.push(...(data.espacios || []).filter(a => (!q.cabana || a.cabana === q.cabana) && (!q.desde || a.fecha >= q.desde && a.fecha <= q.hasta)));
            if (q.nombre) resultado.anotaciones.push(...coincidenciasAnotaciones(data.anotaciones || [], q.nombre));
            if (q.versiones) {
                const old = await libro.consultarHoja(h, "anterior");
                versionesAnterior.push(old); versionesActual.push(data);
            }
        }

        if (q.versiones) {
            const unir = versiones => ({ cobertura: { geometria: versiones.length > 0 && versiones.every(v => v?.cobertura?.geometria) }, reservas: versiones.flatMap(v => v?.reservas || []) });
            resultado.cambios = S.compararVersiones(unir(versionesAnterior), unir(versionesActual)).filter(c =>
                (!c.actual && !c.anterior) || (c.actual && filtrar(c.actual, q)) || (c.anterior && filtrar(c.anterior, q)) || c.candidatos?.some(r => filtrar(r, q)));
        }

        if (q.nombre && !q.versiones) {
            for (const h of hojas.filter(h => /reagendar|reembolso/i.test(h))) {
                const data = await libro.consultarHoja(h);
                resultado.anotaciones.push(...coincidenciasAnotaciones(data.anotaciones || [], q.nombre));
            }
        }

        if (q.comparar) resultado.comparacion = await compararSistema(resultado.reservas, cliente, q);
        if (q.comparar && (resultado.bloqueos.length || resultado.bloqueos_lectura_segura)) {
            if (!root.HAIKU_LIBRO_BLOQUEOS_V1) {
                if (resultado.bloqueos.length) throw new Error('No está disponible el visor de bloqueos del Libro. Recarga la página.');
                resultado.advertencias.push('Comparación inversa de bloqueos no disponible. Recarga la página.');
            } else {
                resultado.bloqueos_comparacion = await root.HAIKU_LIBRO_BLOQUEOS_V1.comparar(resultado.bloqueos, cliente, resultado.bloqueos_lectura_segura?{...q,cabanas_revision:resultado.bloqueos_cabanas_revision}:undefined);
            }
        }
        if (q.comparar && q.desde && !resultado.bloqueos_lectura_segura) resultado.advertencias.push('Comparación inversa de bloqueos no realizada: la lectura del Libro tiene cobertura incompleta o advertencias sin cabaña identificable.');
        if (libro.estado().generacion !== estado.generacion) throw new Error("El Libro cambió durante la consulta. Vuelve a preguntar.");
        return resultado;
    }

    function descripcionGrupo(g) {
        const r = g.principal;
        const cab = g.cabanas.length > 1 ? `CAB ${g.cabanas.join(" + ")}` : `CAB ${g.cabanas[0]}`;
        const estadia = r.tipo_estadia === "full_day" ? "Full Day" : `${r.noches} noche${r.noches === 1 ? "" : "s"}`;
        return `${cab} · ${r.titular} · ${r.fecha_checkin} → ${r.fecha_checkout} · ${estadia}`;
    }

    function descripcionGrupoPregunta(g) {
        const r = g.principal;
        const cabanasProyecto = [...new Set(g.items.flatMap(i => [i.sistema, ...(i.candidatosDetalle || [])])
            .filter(Boolean).map(x => Number(x.cabana)).filter(Boolean))].sort((a, b) => a - b);
        const cabanasTexto = xs => `CAB ${xs.join(" + ")}`;
        const cambios = g.items.filter(i => i.estado !== "asociada" && i.candidatosDetalle?.length === 1)
            .map(i => [Number(i.libro.cabana), Number(i.candidatosDetalle[0].cabana)])
            .filter(([libro, proyecto]) => libro && proyecto && libro !== proyecto);
        const cambiosUnicos = [...new Map(cambios.map(x => [x.join("→"), x])).values()];
        const estadia = r.tipo_estadia === "full_day" ? "Full Day" : `${r.noches} noche${r.noches === 1 ? "" : "s"}`;
        return [
            r.titular,
            `Libro: ${cabanasTexto(g.cabanas)}${cabanasProyecto.length ? ` → Proyecto H: ${cabanasTexto(cabanasProyecto)}` : " → Proyecto H: sin candidata asociable"}`,
            ...(cambiosUnicos.length === 1 ? [`Cambio por resolver: CAB ${cambiosUnicos[0][0]} → CAB ${cambiosUnicos[0][1]}`] : []),
            `${r.fecha_checkin} → ${r.fecha_checkout}`,
            estadia
        ].join(" · ");
    }

    function descripcionPagoNuevoSeguro(item) {
        const p = item.pago || {};
        const medio = ({
            transferencia: 'Transferencia', debito: 'Tarjeta Débito', credito: 'Tarjeta Crédito',
            tarjeta_debito: 'Tarjeta Débito', tarjeta_credito: 'Tarjeta Crédito',
            webpay_debito: 'WebPay Débito', webpay_credito: 'WebPay Crédito', efectivo: 'Efectivo'
        })[p.medio_pago] || String(p.medio_pago || 'Medio sin precisar').replaceAll('_', ' ');
        const identificador = normalizarId(p.codigo_autorizacion) ? `CodAut ${p.codigo_autorizacion}` :
            normalizarId(p.folio) && normalizarId(p.bovtar) ? `Folio ${p.folio} · Autorización ${p.bovtar}` : 'Sin identificador fuerte';
        return `${item.reserva.titular} · ${medio} · ${p.tipo_movimiento} · ${money(p.monto)} · ${identificador}`;
    }

    function respuestaComparacion(result) {
        if (result.q.solo_pagos) {
            const pagos = gruposVistaPagos(result.comparacion);
            return ['LIBRO · PAGOS', 'Pagos del Libro ↔ Proyecto H', `${result.q.desde} al ${result.q.hasta}`,
                ...pagos.contadores.map(([nombre, n]) => `${nombre}: ${n}`),
                ...pagos.secciones.flatMap(([titulo, items]) => items.length ? [titulo, ...items.map(x =>
                    `${x.reserva?.titular || 'Titular no determinado'} · ${money(x.pago?.monto)} · ${x.estado}${x.diferencias?.length ? ' · ' + x.diferencias.join('; ') : ''}`)] : []),
                'Sólo lectura. Los pagos ya existentes no se volverán a incorporar.'].join('\n');
        }
        const comp = result.comparacion;
        const meta = comp.meta || {};
        const grupos = comp.grupos || agruparComparacion(comp);
        const faltantes = grupos.filter(g => g.estado === "sin_coincidencia");
        const ambiguas = grupos.filter(g => g.estado === "ambigua");
        const diferencias = grupos.filter(g => g.estado === "asociada" && g.diferencias.length);
        const pagosFaltan = (comp.pagosDetalle || []).filter(x => x.estado === "nuevo_seguro");
        const pagosRevisar = (comp.pagosDetalle || []).filter(x => x.estado === "revisar" || x.estado === "diferente");
        const lines = [
            `COMPARACIÓN LIBRO ↔ PROYECTO H · ${result.q.desde} al ${result.q.hasta}`,
            `Libro: ${meta.libro ?? 0} reservas · Proyecto H: ${meta.proyecto ?? 0} reservas visibles en el intervalo.`,
            `Faltan claramente: ${meta.faltantes ?? 0} · Coinciden: ${meta.asociadas ?? 0} · Requieren asociación manual: ${meta.ambiguas ?? 0}.`,
            `Pagos a incorporar/revisar: ${meta.pagos_faltantes ?? 0} probables faltantes · ${meta.pagos_revisar ?? 0} requieren revisión.`
        ];
        if (!meta.libro && meta.libro_detectadas) lines.push(`El lector detectó ${meta.libro_detectadas} filas de reserva, pero ninguna pasó la validación estructural; revisar formato antes de concluir que el Libro está vacío.`);
        if (faltantes.length) {
            lines.push("\nRESERVAS QUE FALTAN");
            faltantes.forEach(g => lines.push(`• ${descripcionGrupo(g)} · confianza ${g.confianza}`));
        } else lines.push("\nNo encontré reservas claramente faltantes con el matching actual.");
        if (pagosFaltan.length) {
            lines.push("\nPAGOS NUEVOS SEGUROS EN ESTA CONSULTA");
            pagosFaltan.forEach(x => lines.push(`• ${descripcionPagoNuevoSeguro(x)}`));
        }
        if (diferencias.length) {
            lines.push("\nRESERVAS CON DIFERENCIAS");
            diferencias.forEach(g => lines.push(`• ${descripcionGrupo(g)}: ${g.diferencias.join("; ")}`));
        }
        if (ambiguas.length) {
            lines.push("\nASOCIACIONES AMBIGUAS");
            ambiguas.forEach(g => lines.push(`• ${descripcionGrupo(g)} · ${g.categoria.replaceAll("_", " ")} · confianza ${g.confianza}. ${g.pregunta}`));
        }
        if (pagosRevisar.length) lines.push(`\n${pagosRevisar.length} movimientos de pago requieren revisión; no los declaro faltantes automáticamente.`);
        lines.push("\nSólo lectura: esta comparación no modificó el Libro ni Proyecto H.");
        return lines.join("\n");
    }

    function respuesta(result) {
        const q = result.q;
        if (q.listar) return `Libro ${result.archivo}: ${result.hojas.join(", ")}.`;
        if (q.versiones) return respuestaVersiones(result);
        if (q.comparar) return respuestaComparacion(result);

        const lines = [
            `LIBRO · SÓLO LECTURA · ${result.archivo}`,
            q.desde ? `Consulta: ${q.desde} al ${q.hasta}${q.cabana ? ` · CAB ${q.cabana}` : ""}` : "Búsqueda por titular."
        ];
        if (q.escribir) lines.push("Esta etapa sólo lee y compara. No crearé reservas, pagos ni servicios desde el Libro; primero debemos validar su interpretación.");

        if (q.libres) {
            const libres = result.espacios.filter(x => x.estado === "libre_explicito");
            lines.push(`${libres.length} marcas explícitas de LIBRE:`);
            for (const x of libres) lines.push(`${x.fecha} · CAB ${x.cabana} · ${source(x.origen)}`);
            lines.push("Una celda vacía o marcada FULL DAY no se considera disponibilidad confirmada. Contrasta bloqueos y ocupación de Proyecto H antes de vender.");
        } else {
            const rs = result.reservas.filter(r =>
                (!q.checkedout || r.estado_operativo === "checked_out") &&
                (!q.pendientes || q.cabana || r.pagos_pendientes.length || [...r.pagos, ...r.pagos_sin_asociacion].some(p => p.bove_pendiente || p.manager_pendiente || p.estado_pago !== "registrado_en_libro")) &&
                (!q.alertas || q.cabana || r.notas_importantes.length)
            );
            lines.push(`${rs.length} reservas identificadas. Los datos describen la copia cargada, no una actualización en vivo.`);
            for (const r of rs) {
                lines.push(
                    `\nCAB ${r.cabana} · ${r.titular} · ${source(r.coordenadas_origen)}`,
                    `${r.fecha_checkin} → ${r.fecha_checkout} · ${r.tipo_estadia === "full_day" ? "Full Day" : `${r.noches} noches`}`,
                    `${etiquetas[r.estado_confirmacion] || r.estado_confirmacion}. ${etiquetas[r.estado_operativo]}.`,
                    `Adultos: ${r.adultos ?? "sin dato"}; niños: ${r.ninos ?? "sin dato"}; mascotas: ${r.mascotas ?? "sin dato"}.`
                );
                if (r.rut_documento || r.correo || r.telefono) lines.push([r.rut_documento, r.correo, r.telefono].filter(Boolean).join(" · "));
                if (r.operador || r.fecha_ingreso_libro) lines.push(`Ingreso al Libro: ${r.fecha_ingreso_libro || "sin fecha"} · operador ${r.operador || "sin dato"}.`);
                for (const note of r.notas_interpretacion || []) lines.push(`Nota de interpretación: ${note}`);
                for (const note of r.notas_importantes) lines.push(`Nota roja: ${note}`);
                for (const pending of r.pagos_pendientes) lines.push(`Pendiente mencionado: ${pending}`);
                for (const service of r.servicios) lines.push(`Servicio: ${service.concepto} · ${service.texto_original}`);
                lines.push(`Pagos: se revisó el bloque del Check-In ${r.fecha_checkin}.`);
                for (const [items, seguro] of [[r.pagos, true], [r.pagos_sin_asociacion, false]]) {
                    for (const p of items) {
                        lines.push(`${seguro ? "Pago asociado" : "Movimiento del bloque SIN asociación segura al titular"}: ${p.tipo_movimiento} · ${money(p.monto)} · ${p.estado_pago} · ${source(p.origen)}`, p.texto_original);
                        if (p.bove_pendiente || p.manager_pendiente) lines.push(`Trámite administrativo pendiente: ${p.bove_pendiente ? "BOVE " : ""}${p.manager_pendiente ? "Manager" : ""}. No equivale a deuda del cliente.${r.estado_operativo === "checked_out" ? " La reserva figura Checked Out: revisar posible atraso." : ""}`);
                        if (p.tipo_movimiento === "penalidad") lines.push(`Penalidad ${p.penalidad_porcentaje ?? "?"}% · ${money(p.monto_penalidad)}; saldo indicado: ${money(p.saldo_por_pagar)}. No se suma como pago.`);
                    }
                }
                if (!r.pagos.length && !r.pagos_sin_asociacion.length) {
                    lines.push(r.cobertura_pagos ? "El bloque revisado no registra movimientos; no es una certificación de deuda." : "No pude verificar el bloque financiero; no puedo concluir que no tenga abonos.");
                }
                for (const warning of r.advertencias) lines.push(`Revisar: ${warning}`);
            }

            if (q.aseo || q.cabana) {
                lines.push("\nASEO DEL INTERVALO CONSULTADO");
                for (const a of result.aseos) lines.push(`${a.fecha} · CAB ${a.cabana} · ${source(a.origen)}: salida ${a.checkout_por || "no registrada"}; aseo ${a.camarero || "no registrado"}; ${a.hora_inicio || "?"}–${a.hora_fin || "?"}; IN ${a.ingreso || "no registrado"}; revisó ${a.revisado_por || "no registrado"}.`);
                if (!result.aseos.length) lines.push("No encontré un registro de aseo para esas fechas; no inferí quién lo hizo.");
            }
        }

        for (const a of result.anotaciones) lines.push(`Coincidencia textual sin asociación automática · ${source(a.origen)}: ${a.texto_original}`);
        lines.push(...[...new Set(result.advertencias || [])]);
        return lines.join("\n");
    }

    const categoriasVersion = { nueva: 'Nuevas', modificada: 'Modificadas', ya_no_aparece: 'Ya no aparecen', sin_cambios: 'Sin cambios', requiere_revision: 'Requieren revisión' };
    const estadoVersion = { nueva: 'Reserva nueva', modificada: 'Cambio detectado', ya_no_aparece: 'Ya no aparece', sin_cambios: 'Sin cambios', requiere_revision: 'Requiere revisión' };
    function tituloVersiones(q) {
        const inicio = q.desde, fin = q.hasta;
        const mes = d => `${nombresMes[Number(d.slice(5, 7)) - 1].replace(/^./, x => x.toUpperCase())} ${d.slice(0, 4)}`;
        return 'CAMBIOS ENTRE LIBROS' + (inicio ? ` · ${mes(inicio)}${fin && fin.slice(0, 7) !== inicio.slice(0, 7) ? ' – ' + mes(fin) : ''}` : ' · Por titular');
    }
    function descripcionVersion(r) {
        return `${(r.cabanas || [r.cabana]).map(c => 'CAB ' + c).join(' + ')} · ${fechaBreve(r.fecha_checkin)} → ${fechaBreve(r.fecha_checkout)}`;
    }
    function detalleVersion(d) {
        if (d.tipo === 'cabana_agregada') return `Se agregó CAB ${d.cabana}`;
        if (d.tipo === 'cabana_eliminada') return `Se quitó CAB ${d.cabana}`;
        if (d.tipo === 'pago_agregado') return `Se agregó pago ${money(d.pago.monto)}`;
        if (d.tipo === 'pago_eliminado') return `Se eliminó pago ${money(d.pago.monto)}`;
        if (d.tipo === 'pago_modificado') {
            const campos = { monto: 'monto', moneda: 'moneda', concepto: 'concepto', tipo_movimiento: 'tipo de movimiento', medio_pago: 'medio de pago',
                codigo_autorizacion: 'CodAut', folio: 'Folio', bovtar: 'Bovtar', bove: 'BOVE', texto_original: 'glosa', estado_pago: 'estado',
                fecha_comprobante: 'fecha del comprobante', bove_pendiente: 'BOVE pendiente', manager_pendiente: 'Manager pendiente',
                saldo_por_pagar: 'saldo pendiente', monto_penalidad: 'penalidad', penalidad_porcentaje: 'porcentaje de penalidad' };
            const cambios = Object.entries(campos).filter(([k]) => d.campos_cambiados ? d.campos_cambiados.includes(k) : S.normalizar(d.anterior[k]) !== S.normalizar(d.actual[k])).map(([k, label]) =>
                k === 'monto' ? `${label}: ${money(d.anterior[k])} → ${money(d.actual[k])}` : `${label}: ${String(d.anterior[k] ?? 'sin dato').replaceAll('_', ' ')} → ${String(d.actual[k] ?? 'sin dato').replaceAll('_', ' ')}`);
            return `${d.confianza === 'alta' ? 'Pago identificado, pero cambió' : 'Pago modificado ·'} ${cambios.join('; ') || 'un dato del pago'}`;
        }
        if (d.detalle) return d.detalle;
        const campos = { fecha_checkin: 'Check-In', fecha_checkout: 'Check-Out', tipo_estadia: 'tipo de estadía', rut_documento: 'documento', correo: 'correo', telefono: 'teléfono', adultos: 'adultos', ninos: 'niños', mascotas: 'mascotas', estado_confirmacion: 'confirmación', estado_operativo: 'estado de la estadía', notas_importantes: 'notas importantes', pagos_pendientes: 'pagos pendientes', servicios: 'servicios', operador: 'operador', fecha_ingreso_libro: 'fecha de ingreso al Libro', notas: 'notas' };
        const valor = v => v === null || v === undefined || v === '' ? 'sin dato' : Array.isArray(v) ? v.map(valor).join('; ') || 'sin dato' :
            typeof v === 'object' ? v.texto_original || v.concepto || 'servicio' : etiquetas[v] || (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fechaBreve(v) : String(v).replaceAll('_', ' '));
        return `Cambió ${campos[d.campo] || d.campo}: ${valor(d.anterior)} → ${valor(d.actual)}`;
    }
    function respuestaVersiones(result) {
        const lines = [tituloVersiones(result.q), Object.entries(categoriasVersion).map(([tipo, label]) => `${label}: ${result.cambios.filter(c => c.tipo === tipo).length}`).join(' · ')];
        for (const c of result.cambios) {
            const r = c.actual || c.anterior;
            lines.push(r ? `${r.titular} · ${descripcionVersion(r)} · ${estadoVersion[c.tipo]}` : c.detalle);
            if (c.detalle && r) lines.push(c.detalle);
            if (c.resumen_pagos) lines.push(c.resumen_pagos);
            for (const d of c.diferencias || []) lines.push(detalleVersion(d), ...[d.verificacion].filter(Boolean));
            for (const p of c.pagos_sin_cambios || []) lines.push(...[p.detalle, p.verificacion, p.nota].filter(Boolean));
        }
        lines.push(...new Set(result.advertencias || []), 'Sólo lectura. “Ya no aparece” no confirma una cancelación.');
        return lines.join('\n');
    }
    function renderizarVersiones(out, result) {
        out.className = 'haiku-asistente-preview haiku-versiones';
        out.replaceChildren(elemento('h3', 'haiku-versiones-titulo', tituloVersiones(result.q)), elemento('p', 'haiku-versiones-aviso', 'Sólo lectura · Libro anterior ↔ Libro actual'));
        const resumen = elemento('div', 'haiku-versiones-totales');
        for (const [tipo, label] of Object.entries(categoriasVersion)) {
            const indicador = elemento('div');
            indicador.append(elemento('strong', '', result.cambios.filter(c => c.tipo === tipo).length), elemento('span', '', label));
            resumen.append(indicador);
        }
        out.append(resumen);
        for (const tipo of ['requiere_revision', 'modificada', 'nueva', 'ya_no_aparece', 'sin_cambios']) {
            const items = result.cambios.filter(c => c.tipo === tipo);
            if (!items.length) continue;
            const seccion = elemento('details', 'haiku-versiones-seccion');
            seccion.open = tipo !== 'sin_cambios' || result.cambios.length <= 8;
            seccion.append(elemento('summary', '', `${categoriasVersion[tipo]} · ${items.length}`));
            for (const c of items) {
                const r = c.actual || c.anterior, tarjeta = elemento('article', `haiku-versiones-tarjeta haiku-versiones--${tipo}`);
                tarjeta.append(elemento('strong', 'haiku-versiones-titular', r.titular), elemento('span', 'haiku-versiones-estado', estadoVersion[tipo]), elemento('p', 'haiku-versiones-meta', descripcionVersion(r)));
                if (c.detalle) tarjeta.append(elemento('p', '', c.detalle));
                if (c.resumen_pagos) tarjeta.append(elemento('p', 'haiku-versiones-resumen-pagos', c.resumen_pagos));
                for (const p of c.pagos_sin_cambios || []) {
                    tarjeta.append(elemento('p', 'haiku-versiones-pago-sin-cambios', p.detalle));
                    if (p.verificacion) tarjeta.append(elemento('p', 'haiku-versiones-nota', p.verificacion));
                    if (p.nota) tarjeta.append(elemento('small', 'haiku-versiones-nota', p.nota));
                }
                const lista = elemento('ul');
                (c.diferencias || []).forEach(d => {
                    const li = elemento('li', '', detalleVersion(d));
                    if (d.verificacion) li.append(elemento('small', 'haiku-versiones-nota', ' · ' + d.verificacion));
                    if (d.campo === 'notas') {
                        const notas = elemento('details');
                        notas.append(elemento('summary', '', 'Ver cambios en las notas'), elemento('p', '', `Anterior: ${d.anterior || 'sin dato'}`), elemento('p', '', `Actual: ${d.actual || 'sin dato'}`));
                        li.append(notas);
                    }
                    lista.append(li);
                });
                if (lista.children.length) tarjeta.append(lista);
                if (c.candidatos?.length) {
                    const candidatos = elemento('details');
                    candidatos.append(elemento('summary', '', 'Ver reservas candidatas'));
                    c.candidatos.forEach(x => candidatos.append(elemento('p', '', `${x.titular} · ${descripcionVersion(x)}`)));
                    tarjeta.append(candidatos);
                }
                const tecnico = elemento('details', 'haiku-versiones-tecnico');
                tecnico.append(elemento('summary', '', 'Detalles técnicos'));
                for (const [label, g] of [['Anterior', c.anterior], ['Actual', c.actual], ...(c.candidatos || []).map(g => ['Candidata', g])]) if (g) {
                    tecnico.append(elemento('p', '', `${label}: ${(g.origenes || []).map(source).join(' · ')}`));
                    for (const fila of g.filas || []) tecnico.append(elemento('p', '', fila.texto_original || ''));
                    for (const p of [...(g.pagos || []), ...(g.pagos_sin_asociacion || [])]) {
                        tecnico.append(elemento('p', '', `${source(p.origen)} · CodAut: ${p.codigo_autorizacion || '—'} · Folio: ${p.folio || '—'} · Bovtar: ${p.bovtar || '—'} · BOVE: ${p.bove || '—'}`));
                        if (p.texto_original) tecnico.append(elemento('p', '', p.texto_original));
                    }
                }
                tarjeta.append(tecnico); seccion.append(tarjeta);
            }
            out.append(seccion);
        }
        for (const c of result.cambios.filter(c => c.tipo === 'no_comparable')) out.append(elemento('p', 'haiku-versiones-aviso', c.detalle));
        if (result.advertencias?.length) {
            const tecnico = elemento('details', 'haiku-versiones-tecnico');
            tecnico.append(elemento('summary', '', 'Detalles técnicos de la lectura'));
            [...new Set(result.advertencias)].forEach(a => tecnico.append(elemento('p', '', a))); out.append(tecnico);
        }
        out.append(elemento('p', 'haiku-versiones-aviso', '“Ya no aparece” no confirma una cancelación. No se modificaron el Libro ni Proyecto H.'));
    }

    const ENTRADA_ESTRUCTURADA = Symbol('entrada-estructurada-libro');
    async function revalidarEntradaEstructurada(result) {
        const vigente = () => {
            if (result.generacion === undefined || result.generacion !== root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion) {
                throw new Error('El Libro cambió desde este informe. Genera el informe nuevamente antes de preparar cambios en Proyecto H.');
            }
        };
        vigente();
        const comparacion = await compararSistema(result.reservas, root.haikuSupabase, result.q);
        vigente();
        return {...result, comparacion};
    }
    async function abrirComparacionEstructurada(out, {reservas, generacion}) {
        if (!Array.isArray(reservas) || !reservas.length) throw new Error('No hay registros actuales para preparar.');
        const registros = structuredClone(reservas);
        const normalizadas = registros.map(normalizarReservaComparacion);
        const result = await revalidarEntradaEstructurada({
            [ENTRADA_ESTRUCTURADA]:true, reservas:registros, generacion,
            q:{desde:normalizadas.map(r=>r.fecha_checkin).filter(Boolean).sort()[0],
                hasta:normalizadas.map(r=>r.fecha_checkout).filter(Boolean).sort().at(-1)}
        });
        renderizarComparacion(out, result);
        return result;
    }
    const apiConsultas = Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion });
    root.HAIKU_LIBRO_CONSULTAS = Object.freeze({...apiConsultas, abrirComparacionEstructurada});
    if (typeof module !== "undefined") module.exports = root.HAIKU_LIBRO_CONSULTAS;
    if (!root.document) return;

    let ocupado = false;
    const esLibro = texto => /\blibro\b/i.test(texto);

    function mensaje(tipo, texto) {
        const el = document.createElement("div");
        el.className = `haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}`;
        el.dataset.haikuLibroRespuesta = "1";
        el.textContent = texto;
        document.getElementById("haiku-asistente-mensajes")?.append(el);
        return el;
    }

    function elemento(tag, clase, texto) {
        const el = document.createElement(tag);
        if (clase) el.className = clase;
        if (texto !== undefined && texto !== null) el.textContent = String(texto);
        return el;
    }

    function agregarDato(grid, label, valor) {
        const box = elemento("div", "haiku-asistente-preview-dato");
        box.append(elemento("span", "", label), elemento("strong", "", valor));
        grid.append(box);
    }

    function renderizarConsultaLibro(out, result) {
        const q = result.q;
        if (q.listar || q.libres) { out.textContent = respuesta(result); return; }
        const rs = result.reservas.filter(r =>
            (!q.checkedout || r.estado_operativo === 'checked_out') &&
            (!q.pendientes || q.cabana || r.pagos_pendientes.length || [...r.pagos, ...r.pagos_sin_asociacion].some(p => p.bove_pendiente || p.manager_pendiente || p.estado_pago !== 'registrado_en_libro')) &&
            (!q.alertas || q.cabana || r.notas_importantes.length));
        out.replaceChildren();
        out.className = 'haiku-asistente-mensaje haiku-asistente-mensaje--asistente haku-libro-consulta';
        const linea = (parent, text, clase = '') => parent.append(elemento('p', clase, text));
        out.append(elemento('span', 'haku-libro-consulta-sello', 'LIBRO · SÓLO LECTURA'));
        linea(out, result.archivo, 'haku-libro-consulta-fuente');
        linea(out, q.desde ? `Consulta: ${q.desde} al ${q.hasta}${q.cabana ? ` · CAB ${q.cabana}` : ''}` : 'Búsqueda por titular.');
        linea(out, `${rs.length} reserva${rs.length === 1 ? '' : 's'} identificada${rs.length === 1 ? '' : 's'}. Los datos describen la copia cargada, no una actualización en vivo.`);
        if (q.escribir) linea(out, 'Esta etapa sólo lee y compara. No crearé reservas, pagos ni servicios desde el Libro; primero debemos validar su interpretación.');
        for (const r of rs) {
            const card = elemento('article', 'haku-libro-consulta-tarjeta');
            const head = elemento('header', 'haku-libro-consulta-cabecera');
            head.append(elemento('strong', '', r.titular), elemento('span', 'haku-libro-consulta-sello', `CAB ${r.cabana}`));
            card.append(head);
            const chips = elemento('div', 'haku-libro-consulta-chips');
            for (const value of [`${r.fecha_checkin} → ${r.fecha_checkout}`, r.tipo_estadia === 'full_day' ? 'Full Day' : `${r.noches} noche${r.noches === 1 ? '' : 's'}`,
                etiquetas[r.estado_confirmacion] || r.estado_confirmacion, etiquetas[r.estado_operativo] || r.estado_operativo]) chips.append(elemento('span', '', value));
            card.append(chips);
            const details = elemento('details', 'haku-libro-consulta-detalles');
            details.open = rs.length === 1;
            details.append(elemento('summary', '', 'Ver detalles'));
            const section = title => { const node = elemento('section', 'haku-libro-consulta-seccion'); node.append(elemento('h4', '', title)); details.append(node); return node; };
            const guest = section('Datos del huésped'), grid = elemento('div', 'haku-libro-consulta-grid');
            for (const [label, value] of [['RUT / documento', r.rut_documento], ['Correo', r.correo], ['Teléfono', r.telefono],
                ['Adultos', r.adultos], ['Niños', r.ninos], ['Mascotas', r.mascotas]]) agregarDato(grid, label, value ?? 'Sin dato');
            guest.append(grid);
            const reserva = section('Reserva');
            linea(reserva, `Ingreso al Libro: ${r.fecha_ingreso_libro || 'sin fecha'} · operador ${r.operador || 'sin dato'}.`);
            (r.notas_interpretacion || []).forEach(n => linea(reserva, `Nota de interpretación: ${n}`));
            r.notas_importantes.forEach(n => linea(reserva, `Nota roja: ${n}`));
            r.pagos_pendientes.forEach(n => linea(reserva, `Pendiente mencionado: ${n}`));
            const pagos = section('Pagos');
            linea(pagos, `Se revisó el bloque del Check-In ${r.fecha_checkin}.`);
            for (const [items, seguro] of [[r.pagos, true], [r.pagos_sin_asociacion, false]]) for (const p of items) {
                const movimiento = elemento('div', 'haku-libro-consulta-movimiento');
                linea(movimiento, `${seguro ? 'Pago asociado' : 'Movimiento del bloque SIN asociación segura al titular'}: ${p.tipo_movimiento} · ${money(p.monto)} · ${p.estado_pago} · ${source(p.origen)}`);
                linea(movimiento, p.texto_original);
                if (p.bove_pendiente || p.manager_pendiente) linea(movimiento, `Trámite administrativo pendiente: ${p.bove_pendiente ? 'BOVE ' : ''}${p.manager_pendiente ? 'Manager' : ''}. No equivale a deuda del cliente.${r.estado_operativo === 'checked_out' ? ' La reserva figura Checked Out: revisar posible atraso.' : ''}`);
                if (p.tipo_movimiento === 'penalidad') linea(movimiento, `Penalidad ${p.penalidad_porcentaje ?? '?'}% · ${money(p.monto_penalidad)}; saldo indicado: ${money(p.saldo_por_pagar)}. No se suma como pago.`);
                pagos.append(movimiento);
            }
            if (!r.pagos.length && !r.pagos_sin_asociacion.length) linea(pagos, r.cobertura_pagos ? 'El bloque revisado no registra movimientos; no es una certificación de deuda.' : 'No pude verificar el bloque financiero; no puedo concluir que no tenga abonos.');
            if (r.servicios.length) { const servicios = section('Servicios'); r.servicios.forEach(s => linea(servicios, `Servicio: ${s.concepto} · ${s.texto_original}`)); }
            if (r.advertencias.length) { const avisos = section('Advertencias'); r.advertencias.forEach(w => linea(avisos, `Revisar: ${w}`)); }
            card.append(details);
            linea(card, `Fuente: ${source(r.coordenadas_origen)}`, 'haku-libro-consulta-fuente');
            out.append(card);
        }
        if (q.aseo || q.cabana) {
            const aseos = elemento('details', 'haku-libro-consulta-detalles');
            aseos.append(elemento('summary', '', 'Aseo del intervalo consultado'));
            for (const a of result.aseos) linea(aseos, `${a.fecha} · CAB ${a.cabana} · ${source(a.origen)}: salida ${a.checkout_por || 'no registrada'}; aseo ${a.camarero || 'no registrado'}; ${a.hora_inicio || '?'}–${a.hora_fin || '?'}; IN ${a.ingreso || 'no registrado'}; revisó ${a.revisado_por || 'no registrado'}.`);
            if (!result.aseos.length) linea(aseos, 'No encontré un registro de aseo para esas fechas; no inferí quién lo hizo.');
            out.append(aseos);
        }
        for (const a of result.anotaciones) linea(out, `Coincidencia textual sin asociación automática · ${source(a.origen)}: ${a.texto_original}`);
        [...new Set(result.advertencias || [])].forEach(w => linea(out, w));
    }

    // Sólo divide las descripciones ya calculadas para darles jerarquía visual.
    function filaComparacion(texto, formato) {
        if (!formato) return elemento("li", "", texto);
        const fila = elemento("li", "haku-comparacion-fila");
        const partes = String(texto).split(" · ");
        const titulo = partes.splice(0, formato === "reserva" ? 2 : 1).join(" · ");
        let datos, detalle;
        if (formato === "reserva") {
            const resto = partes.join(" · ").split(" — ");
            datos = resto.shift(); detalle = resto.join(" — ");
        } else if (formato === "servicio") {
            datos = partes.shift(); detalle = partes.join(" · ");
        } else {
            datos = partes.splice(0, 3).join(" · "); detalle = partes.join(" · ");
        }
        fila.append(elemento("strong", "haku-fila-titulo", titulo));
        if (datos) fila.append(elemento("span", "haku-fila-datos", datos));
        if (detalle) fila.append(elemento("span", "haku-fila-detalle", detalle));
        return fila;
    }

    function claseIconoSeccion(titulo) {
        const iconos = {
            "Reservas que faltan": "alerta", "Posibles faltantes / modificaciones": "archivo",
            "Reservas con diferencias": "intercambio", "Pagos nuevos seguros en esta consulta": "pago",
            "Pagos que requieren revisión": "pago", "Servicios que requieren revisión": "servicio",
            "Grupos / multicabaña": "grupo", "Detalles técnicos XLSX": "archivo"
        };
        return ` haku-icono--${iconos[titulo.replace(/ \(\d+\)$/, "")] || "archivo"}`;
    }

    function agregarLista(contenedor, titulo, items, { alerta = false, vacio = "Sin elementos.", tono = "", formato = "" } = {}) {
        const bloque = tono
            ? elemento("details", `haiku-comparacion-acordeon haku-franja--${tono}`)
            : elemento("div", `haiku-asistente-preview-lista${alerta ? " haiku-asistente-preview-lista--alerta" : ""}`);
        bloque.append(elemento(tono ? "summary" : "strong", "", titulo));
        if (tono) bloque.className += claseIconoSeccion(titulo);
        const ul = document.createElement("ul");
        if (!items.length) ul.append(elemento("li", "", vacio));
        else items.forEach(item => ul.append(filaComparacion(item, formato)));
        bloque.append(ul);
        contenedor.append(bloque);
        return bloque;
    }

    function agregarDetalles(contenedor, titulo, items, tono = "", formato = "") {
        if (!items.length) return;
        const details = document.createElement("details");
        if (tono) details.className = `haiku-comparacion-acordeon haku-franja--${tono}`;
        if (tono) details.className += claseIconoSeccion(titulo);
        details.style.marginTop = "9px";
        details.style.paddingTop = "8px";
        details.style.borderTop = "1px solid #e5ebe7";
        const summary = elemento("summary", "", `${titulo} (${items.length})`);
        summary.style.cursor = "pointer";
        summary.style.fontWeight = "800";
        summary.style.fontSize = ".68rem";
        summary.style.color = "#425048";
        details.append(summary);
        const ul = document.createElement("ul");
        ul.style.margin = "8px 0 0";
        ul.style.paddingLeft = "18px";
        ul.style.fontSize = ".67rem";
        ul.style.lineHeight = "1.45";
        items.forEach(item => ul.append(filaComparacion(item, formato)));
        details.append(ul);
        contenedor.append(details);
    }

    function franjaDiferenciaPago(x, comp) {
        if (!x || !['revisar','diferente'].includes(x.estado) || medioLibro(x.pago)!=='transferencia') return null;
        const p=x.pago, fila=comp?.find(r=>r.libro===x.reserva && r.estado==='asociada');
        if (!fila?.sistema?.reserva_id) return null;
        const candidatos=x.sistema ? [x.sistema] : (comp.snapshot?.pagos || []).filter(s=>
            s.reserva_id===fila.sistema.reserva_id && Number(s.monto)===Number(p.monto) &&
            String(s.moneda || 'CLP').toUpperCase()===String(p.moneda || 'CLP').toUpperCase() && medioSistema(s)==='transferencia');
        if (candidatos.length!==1 || candidatos[0].reserva_id!==fila.sistema.reserva_id) return null;
        const s=candidatos[0], diferencias=[];
        if (p.fecha_comprobante && s.fecha_pago && !mismaFechaCalendario(p.fecha_comprobante,s.fecha_pago)) diferencias.push(`Fecha distinta · Libro ${fechaBreve(p.fecha_comprobante)} · Proyecto H ${fechaBreve(fechaCalendarioChile(s.fecha_pago))}`);
        if (p.monto!=null && s.monto!=null && Number(p.monto)!==Number(s.monto)) diferencias.push(`Monto distinto · Libro ${money(p.monto)} · Proyecto H ${money(s.monto)}`);
        if (p.moneda && s.moneda && p.moneda!==s.moneda) diferencias.push(`Moneda distinta · Libro ${p.moneda} · Proyecto H ${s.moneda}`);
        if (medioSistema(s) && medioSistema(s)!==medioLibro(p)) diferencias.push(`Medio distinto · Libro transferencia · Proyecto H ${medioSistema(s).replaceAll('_',' ')}`);
        if (!diferencias.length) return null;
        const franja=elemento('div','haiku-pago-diferencia-compacta');
        franja.append(elemento('span','',`⚠ ${diferencias.join(' · ')}`));
        franja.append(elemento('small','',diferencias.length===1 && diferencias[0].startsWith('Fecha') ?
            'Misma reserva, monto y medio. Revisar.' : 'Revisar diferencias antes de aprobar.'));
        return franja;
    }

    function gruposVistaPagos(comp) {
        const items = comp.pagosDetalle || [];
        const existentes = items.filter(x => x.estado === 'en_sistema' && x.sistema?.id);
        const nuevos = items.filter(x => x.estado === 'nuevo_seguro');
        const diferentes = items.filter(x => x.estado === 'diferente');
        const sin = items.filter(x => x.estado === 'revisar' &&
            (x.reserva?.pagos_sin_asociacion?.includes(x.pago) || comp.some(r => r.libro === x.reserva && r.estado !== 'asociada')));
        const revisar = items.filter(x => !existentes.includes(x) && !nuevos.includes(x) && !diferentes.includes(x) && !sin.includes(x));
        return {
            contadores: [['Movimientos del Libro', items.length], ['Ya existen', existentes.length], ['Nuevos seguros', nuevos.length],
                ['Requieren revisión', items.filter(x => x.estado === 'revisar').length], ['Con diferencias', diferentes.length], ['Sin asociación segura', sin.length]],
            secciones: [['Pagos nuevos seguros', nuevos], ['Pagos que requieren revisión', revisar], ['Con diferencias', diferentes],
                ['Sin asociación segura', sin], ['Ya existe en Proyecto H', existentes]]
        };
    }

    function renderizarSoloPagos(out, result) {
        const modelo = gruposVistaPagos(result.comparacion);
        out.className = 'haiku-asistente-preview haku-comparacion-compacta haku-pagos-compactos';
        out.replaceChildren();
        const header = elemento('div', 'haiku-asistente-preview-cabecera');
        const titulo = elemento('div');
        titulo.append(elemento('span', '', 'LIBRO · PAGOS'), elemento('strong', '', 'Pagos del Libro ↔ Proyecto H'));
        header.append(titulo, elemento('span', 'haiku-asistente-confianza haiku-asistente-confianza--alta', 'Sólo lectura')); out.append(header);
        const fecha = result.q.desde;
        out.append(elemento('p', 'haiku-asistente-preview-resumen haku-pagos-periodo', fecha ? `${nombresMes[Number(fecha.slice(5,7))-1]} ${fecha.slice(0,4)} · ${fecha} al ${result.q.hasta}` : 'Periodo de la consulta'));
        const grid = elemento('div', 'haiku-asistente-preview-grid haku-pagos-metricas');
        modelo.contadores.forEach(([nombre, n]) => agregarDato(grid, nombre, String(n)));
        out.append(grid, elemento('p', 'haku-pagos-nota', 'Sin asociación segura es un subconjunto de los movimientos que requieren revisión.'));
        const aspectoSeccion = {
            'Pagos nuevos seguros': ['normal', 'pago'],
            'Pagos que requieren revisión': ['revision', 'pago'],
            'Con diferencias': ['faltante', 'intercambio'],
            'Sin asociación segura': ['revision', 'alerta'],
            'Ya existe en Proyecto H': ['normal', 'pago']
        };
        for (const [titulo, items] of modelo.secciones) {
            if (!items.length) continue;
            const [tono, icono] = aspectoSeccion[titulo] || ['neutro', 'archivo'];
            const section = elemento('details', `haiku-comparacion-acordeon haku-pagos-seccion haku-franja--${tono} haku-icono--${icono}`);
            section.append(elemento('summary', '', `${titulo} (${items.length})`));
            for (const x of items) {
                const p=x.pago || {}, r=x.reserva || {};
                const fila=elemento('details', `haku-pago-fila haku-pago-fila--${x.estado || 'revision'}`);
                const resumen=elemento('summary', 'haku-pago-fila-resumen');
                const principal=elemento('span', 'haku-pago-fila-principal');
                principal.append(
                    elemento('strong', 'haku-pago-fila-titular', r.titular || 'Titular no determinado'),
                    elemento('span', 'haku-pago-fila-datos', `CAB ${r.cabana ?? 'sin dato'} · ${money(p.monto)} · ${p.medio_pago?.replaceAll('_',' ') || 'Medio sin dato'}`)
                );
                const estado=x.estado==='en_sistema' && x.sistema?.id ? 'Ya existe / omitido' :
                    x.estado==='nuevo_seguro' ? 'Nuevo seguro' : x.estado==='diferente' ? 'Con diferencias' : 'Requiere revisión';
                resumen.append(principal, elemento('span','haiku-versiones-estado haku-pago-fila-estado', estado));
                fila.append(resumen);
                const detalle=elemento('div', 'haku-pago-fila-detalle');
                const datos=elemento('div', 'haiku-asistente-preview-grid haku-pago-detalle-grid');
                for (const [etiqueta, valor] of [['Monto',money(p.monto)], ['Medio',p.medio_pago?.replaceAll('_',' ')], ['Check-in',r.fecha_checkin],
                    ['Fecha comprobante',p.fecha_comprobante], ['Fecha del bloque',p.fecha_bloque], ['Concepto / tipo',p.concepto || p.tipo_movimiento],
                    ['Folio',p.folio], ['Autorización',p.bovtar], ['CodAut',p.codigo_autorizacion], ['Origen XLSX',p.origen ? source(p.origen) : null]]) {
                    if (valor !== null && valor !== undefined && valor !== '') agregarDato(datos, etiqueta, String(valor));
                }
                detalle.append(datos);
                const franja=franjaDiferenciaPago(x,result.comparacion);
                if (franja) detalle.append(franja);
                for (const d of x.diferencias || []) if (!franja || !/^(monto\/moneda|medio de pago|fecha de pago) diferente$/.test(d)) detalle.append(elemento('p','haiku-versiones-meta',d));
                if (!franja && x.estado==='diferente' && x.sistema) detalle.append(elemento('p','haiku-versiones-meta',
                    `Proyecto H: ${money(x.sistema.monto)} · ${x.sistema.medio_pago || 'Medio sin dato'} · ${x.sistema.fecha_pago || 'Fecha sin dato'}`));
                if (x.estado==='en_sistema' && x.sistema?.id) detalle.append(elemento('p','haiku-versiones-aviso','No se volverá a incorporar. No requiere aprobación.'));
                if (titulo==='Sin asociación segura') detalle.append(elemento('p','haiku-versiones-aviso','Requiere resolver su asociación antes de incorporar.'));
                fila.append(detalle);
                section.append(fila);
            }
            out.append(section);
        }
        out.append(elemento('p', 'haku-pagos-nota haku-pagos-nota--final', 'Preparar incorporación abre el flujo seguro existente. Allí se muestran también las dependencias de reservas necesarias para los pagos.'));
    }

    function renderizarComparacion(out, result, ui = {}) {
        const comp = result.comparacion;
        const meta = comp.meta || {};
        const grupos = comp.grupos || [];
        const faltantes = grupos.filter(g => g.estado === "sin_coincidencia");
        const ambiguas = grupos.filter(g => g.estado === "ambigua");
        const diferencias = grupos.filter(g => g.estado === "asociada" && g.diferencias.length);
        const pagosFaltan = (comp.pagosDetalle || []).filter(x => x.estado === "nuevo_seguro");
        const pagosRevisar = (comp.pagosDetalle || []).filter(x => x.estado === "revisar" || x.estado === "diferente");
        const serviciosRevisar = (comp.serviciosDetalle || []).filter(x => x.estado !== "en_sistema");

        if (result.q.solo_pagos) renderizarSoloPagos(out, result);
        else {
        out.className = "haiku-asistente-preview haku-comparacion-compacta";
        out.replaceChildren();

        const cabecera = elemento("div", "haiku-asistente-preview-cabecera");
        const textoCab = document.createElement("div");
        textoCab.append(
            elemento("span", "", "LIBRO · COMPARACIÓN SEGURA"),
            elemento("strong", "", "Libro de Reserva ↔ Proyecto H")
        );
        cabecera.append(textoCab, elemento("span", "haiku-asistente-confianza haiku-asistente-confianza--alta", "Sólo lectura"));
        out.append(cabecera);

        const resumen = elemento("p", "haiku-asistente-preview-resumen");
        resumen.textContent = `Periodo ${result.q.desde} al ${result.q.hasta}. Encontré ${meta.libro ?? 0} reservas lógicas (${meta.estadias_libro ?? 0} estadías) en el Libro y ${meta.proyecto ?? 0} reservas visibles en Proyecto H. ${meta.faltantes ?? 0} faltan claramente; ${meta.ambiguas ?? 0} requieren una decisión. La comparación considera los registros accesibles con tu sesión.`;
        out.append(resumen);
        if (ui.revalidado) {
            const estado = elemento("p", "haiku-asistente-preview-resumen", `Revalidación completada · ${ui.revalidado}. ${meta.asociadas ?? 0} reservas asociadas; ${meta.pagos_faltantes ?? 0} pagos nuevos seguros; ${meta.ambiguas ?? 0} por decidir. Las decisiones recordadas que sigan siendo compatibles se vuelven a validar. Sólo vista previa.`);
            estado.setAttribute("role", "status");
            out.append(estado);
        }

        const grid = elemento("div", "haiku-asistente-preview-grid");
        agregarDato(grid, "Libro", `${meta.libro ?? 0} reservas`);
        agregarDato(grid, "Proyecto H", `${meta.proyecto ?? 0} reservas`);
        agregarDato(grid, "Faltan", `${meta.faltantes ?? 0}`);
        agregarDato(grid, "Coinciden", `${meta.asociadas ?? 0}`);
        agregarDato(grid, "Por decidir", `${meta.ambiguas ?? 0}`);
        agregarDato(grid, "Pagos a revisar", `${(meta.pagos_faltantes ?? 0) + (meta.pagos_revisar ?? 0)}`);
        out.append(grid);

        root.HAIKU_LIBRO_CANCELACIONES_V1?.adjuntar(out, result, result.generacion);

        if (!meta.libro && meta.libro_detectadas) {
            agregarLista(out, "Revisar lectura del Libro", [`El lector encontró ${meta.libro_detectadas} filas de reserva, pero ninguna pasó la validación estructural. No se interpreta como Libro vacío.`], { alerta: true });
        }

        agregarLista(
            out,
            `Reservas que faltan (${faltantes.length})`,
            faltantes.map(g => `${descripcionGrupo(g)} · confianza ${g.confianza}`),
            { alerta: true, vacio: "No encontré reservas claramente faltantes.", tono: "faltante", formato: "reserva" }
        );

        agregarDetalles(
            out,
            "Posibles faltantes / modificaciones",
            ambiguas.map(g => `${descripcionGrupo(g)} — ${g.categoria.replaceAll("_", " ")} · confianza ${g.confianza}. ${g.pregunta}`),
            "revision", "reserva"
        );
        root.HAIKU_LIBRO_CANCELACIONES_V1?.adjuntarRevision(out, result);
        root.HAIKU_LIBRO_BLOQUEOS_V1?.renderizar(out, result.bloqueos_comparacion, result.generacion);
        agregarDetalles(
            out,
            "Reservas con diferencias",
            diferencias.map(g => `${descripcionGrupo(g)} — ${g.diferencias.join("; ")}`),
            "normal", "reserva"
        );

        if (pagosFaltan.length) {
            agregarLista(
                out,
                `Pagos nuevos seguros en esta consulta (${pagosFaltan.length})`,
                pagosFaltan.map(descripcionPagoNuevoSeguro),
                { alerta: true, tono: "normal", formato: "pago" }
            );
        }

        agregarDetalles(
            out,
            "Pagos que requieren revisión",
            pagosRevisar.map(x => `${x.reserva.titular} · ${x.pago.tipo_movimiento} · ${money(x.pago.monto)}`),
            "revision", "pago"
        );
        agregarDetalles(
            out,
            "Servicios que requieren revisión",
            serviciosRevisar.map(x => `${x.reserva.titular} · ${x.servicio.concepto} · ${x.servicio.texto_original}`),
            "revision", "servicio"
        );

        agregarDetalles(out, "Grupos / multicabaña", grupos.filter(g => g.cabanas.length > 1).map(g =>
            descripcionGrupo(g) + " · " + g.categoria.replaceAll("_", " ") + " · confianza " + g.confianza), "revision", "reserva");
        root.HAIKU_LIBRO_CANCELACIONES_V1?.adjuntarResueltas(out, result);
        agregarDetalles(out, "Detalles técnicos XLSX", grupos.flatMap(g => g.items.flatMap(x => [
            x.libro.titular + " · " + source(x.libro.coordenadas_origen),
            ...[...x.libro.pagos, ...x.libro.pagos_sin_asociacion].map(p => x.libro.titular + " · " + source(p.origen))
        ])), "neutro");
        }
        const decisiones = ui.decisiones || new Map();
        const aprobados = ui.aprobados || new Set();
        const vista = elemento("div");
        let preguntas = null;
        if (ambiguas.length && !result.q.solo_pagos) {
            preguntas = elemento("div", "haiku-asistente-preview-lista" + (ui.preguntasAbiertas ? " haiku-reconciliacion-abierto" : ""));
            preguntas.append(elemento("strong", "", "Preguntas necesarias · sólo para esta vista previa"));
            ambiguas.forEach(g => {
                const modelo = preguntaPresentacion(g);
                const label = elemento("label", "", descripcionGrupoPregunta(g) + ". ¿Cómo quieres tratar esta reserva?");
                label.style.display = "block";
                label.append(elemento("p", "", modelo.razon));
                modelo.avisos.forEach(a => label.append(elemento("p", "", "⚠️ Advertencia del Libro: " + a)));
                modelo.comparaciones.forEach(c => {
                    label.append(elemento("p", "", c.razon));
                    const tabla = elemento("table");
                    tabla.setAttribute("aria-label", "Comparación Libro vs Proyecto H");
                    const cabecera = elemento("tr");
                    ["Campo", "Libro", "Proyecto H", "Resultado"].forEach(t => cabecera.append(elemento("th", "", t)));
                    tabla.append(cabecera);
                    c.campos.forEach(f => {
                        const fila = elemento("tr");
                        [f.campo, f.libro || "—", f.proyecto || "—", f.estado].forEach(t => fila.append(elemento("td", "", String(t))));
                        tabla.append(fila);
                    });
                    const scroll = elemento("div");
                    scroll.style.overflowX = "auto";
                    scroll.append(tabla); label.append(scroll);
                });
                const select = elemento("select");
                modelo.opciones.forEach(o => {
                    const texto = o.texto + (o.destino ? " · " + o.destino : "") + " — " + o.efecto;
                    select.append(new Option(texto, o.valor));
                    label.append(elemento("p", "", texto));
                });
                select.selectedIndex = Math.max(0, modelo.opciones.findIndex(o => o.valor === decisiones.get(g.clave)?.valor));
                select.addEventListener("change", () => {
                    decisiones.set(g.clave, modelo.opciones[select.selectedIndex]);
                    vista.replaceChildren(elemento("p", "", "Decisión actualizada. Pulsa Preparar incorporación para actualizar el resumen."));
                });
                label.append(select); preguntas.append(label);
            });
            out.append(preguntas);
            root.HAIKU_LIBRO_RECONCILIACION_UX_V1?.aplicar?.(preguntas);
        }
        const preparar = elemento("button", "libro-reserva-boton secundario", "Preparar incorporación");
        preparar.type = "button";
        preparar.addEventListener("click", async () => {
            const sinDecision = ambiguas.filter(g => (g.pagos || []).length && !decisiones.get(g.clave)?.valor);
            if (sinDecision.length) {
                root.HAIKU_LIBRO_RECONCILIACION_UX_V1?.aplicar?.(preguntas);
                preguntas?.classList?.add?.("haiku-reconciliacion-abierto");
                const primera = preguntas?.querySelector?.("select");
                primera?.focus?.();
                primera?.scrollIntoView?.({ block:"nearest" });
                vista.replaceChildren(elemento("p", "", `Paso 1: elige la reserva existente para ${sinDecision.length === 1 ? "este caso" : "estos casos"}. Haku actualizará primero el titular y RUT; recién después habilitará sus pagos.`));
                return;
            }
            preparar.disabled = true; refrescar.disabled = true;
            out.querySelectorAll("select").forEach(s => s.disabled = true);
            vista.replaceChildren(elemento("p", "", "Revalidando reservas y pagos contra Proyecto H…"));
            try {
                const plan = await prepararIncorporacion(result, decisiones, aprobados);
                if (!out.isConnected && out.isConnected !== undefined) return;
                const volver = async () => {
                    try {
                        const comparacion = await compararSistema(result.reservas,root.haikuSupabase,result.q);
                        renderizarComparacion(out,{...result,comparacion},{decisiones,aprobados});
                    } catch (e) { out.replaceChildren(elemento('p','','No se pudo actualizar la comparación: '+e.message)); }
                };
                let incorporar;
                let identidadActualizada = false;
                const aprobar = async ids => {
                    const lista = Array.isArray(ids) ? ids : [ids];
                    lista.forEach(id => aprobados.add(id));
                    out.replaceChildren(elemento('p', '', lista.length > 1 ? 'Revalidando los pagos aprobados…' : 'Revalidando el pago aprobado…'));
                    try {
                        const nuevo = await prepararIncorporacion(result, decisiones, aprobados);
                        if (identidadActualizada) nuevo.etapaAnteriorCompletada = true;
                        const distribucion = nuevo.items.find(item => lista.includes(item.id))?.distribucionManual;
                        if (distribucion && distribucion.ids.every(id => nuevo.items.find(item => item.id === id)?.payload?.aprobado_manualmente === true)) {
                            nuevo.focoPagos = true;
                            nuevo.focoComprobanteId = distribucion.id;
                            nuevo.items.forEach(item => {
                                item.seleccionado = item.distribucionManual?.id === distribucion.id &&
                                    item.payload?.aprobado_manualmente === true && !item.motivos.length;
                            });
                        }
                        renderizarIncorporacion(out, nuevo, volver, aprobar, incorporar);
                    } catch (e) {
                        lista.forEach(id => aprobados.delete(id)); volver();
                        out.append(elemento('p', '', 'No se pudo revalidar: ' + e.message));
                    }
                };
                incorporar = async planActual => {
                    const ejecucion = await confirmarIncorporacion(result, decisiones, aprobados, planActual);
                    if (planActual.etapa !== 'actualizar_identidad') return ejecucion;
                    aprobados.clear();
                    identidadActualizada = true;
                    const siguientePlan = await prepararIncorporacion(result, decisiones, aprobados);
                    siguientePlan.etapaAnteriorCompletada = true;
                    return { ...ejecucion, siguientePlan };
                };
                renderizarIncorporacion(out, plan, volver, aprobar, incorporar);
            } catch (error) {
                vista.replaceChildren(elemento("p", "", "No se pudo preparar: " + error.message + ". Reintenta; no hay una propuesta actualizada."));
                preparar.disabled = false; refrescar.disabled = false;
                out.querySelectorAll("select").forEach(s => s.disabled = false);
            }
        });
        out.append(preparar, vista);
        const refrescar = elemento("button", "libro-reserva-boton secundario", "Revalidar contra Proyecto H");
        refrescar.type = "button";
        refrescar.addEventListener("click", async () => {
            const claveDetalle = d => {
                const clases = ` ${d.className || ""} `;
                const tipo = clases.includes(" haiku-comparacion-acordeon ") ? "seccion" :
                    clases.includes(" haku-pregunta-caso ") ? "caso" : null;
                const titulo = d.querySelector("summary")?.textContent.replace(/ \(\d+\)$/, "");
                return tipo && titulo ? `${tipo}:${titulo}` : null;
            };
            const abiertos = new Set(Array.from(out.querySelectorAll("details[open]")).map(claveDetalle).filter(Boolean));
            const preguntasAbiertas = Boolean(out.querySelector(".haiku-reconciliacion-abierto"));
            refrescar.disabled = true; preparar.disabled = true;
            vista.replaceChildren(elemento("p", "", "Revalidando reservas, pagos y decisiones recordadas compatibles."));
            try {
                let actualizado;
                if (result[ENTRADA_ESTRUCTURADA]) actualizado = await revalidarEntradaEstructurada(result);
                else {
                    const nuevo = await consultar(result.q.texto);
                    actualizado = nuevo;
                }
                renderizarComparacion(out, actualizado, { preguntasAbiertas, revalidado: new Date().toLocaleTimeString("es-CL") });
                if (preguntasAbiertas) {
                    const preguntas = out.querySelector(".haiku-asistente-preview-lista.haiku-reconciliacion-abierto:has(> label)");
                    const cabeceraPreguntas = preguntas?.querySelector(":scope > strong");
                    if (preguntas && cabeceraPreguntas?.click) {
                        preguntas.classList.remove("haiku-reconciliacion-abierto");
                        cabeceraPreguntas.click();
                        if (!preguntas.classList.contains("haiku-reconciliacion-abierto")) {
                            preguntas.classList.add("haiku-reconciliacion-abierto");
                        }
                    }
                }
                out.querySelectorAll("details").forEach(d => {
                    const clave = claveDetalle(d);
                    if (clave) d.open = abiertos.has(clave);
                });
                out.querySelectorAll(".haku-pregunta-campos").forEach(d => { d.open = false; });
            }
            catch (error) {
                vista.replaceChildren(elemento("p", "", "No se pudo revalidar: " + error.message + ". El resultado anterior no está actualizado. Reintenta la revalidación."));
                refrescar.disabled = false;
            }
        });
        out.append(refrescar);

        const pie = elemento("div", "haiku-asistente-preview-pie");
        pie.append(elemento("span", "", "No se modificó el Libro ni Supabase. Las asociaciones ambiguas y pagos sin identificador inequívoco quedan para revisión antes de cualquier incorporación."));
        out.append(pie);
    }

    function fechaBreve(fecha) {
        const m = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : (fecha || "sin dato");
    }

    function datoIncorporacion(etiqueta, valor) {
        const dato = elemento("div", "haiku-incorporacion-dato");
        dato.append(elemento("span", "", etiqueta), elemento("strong", "", valor ?? "sin dato"));
        return dato;
    }

    function datosPagoIncorporacion(pago) {
        const medio = medioLibro(pago) || String(pago?.medio_pago || '').toLowerCase();
        const nombres = { transferencia:'Transferencia', webpay_credito:'WebPay Crédito', webpay_debito:'WebPay Débito',
            tarjeta_credito:'Tarjeta Crédito', tarjeta_debito:'Tarjeta Débito', efectivo:'Efectivo', airbnb:'Tarjeta AirBnb' };
        let segundo = ['Detalle', pago?.texto_original || pago?.concepto || 'Sin dato'];
        if (medio === 'transferencia') segundo = ['Glosa', pago?.texto_original || 'Sin dato'];
        else if (medio.startsWith('webpay_')) segundo = ['CodAut', pago?.codigo_autorizacion || 'Sin dato'];
        else if (medio.startsWith('tarjeta_')) segundo = ['Folio / Autorización', [pago?.folio && `Folio ${pago.folio}`, pago?.bovtar && `Autorización ${pago.bovtar}`].filter(Boolean).join(' · ') || 'Sin dato'];
        else if (medio === 'efectivo') segundo = ['Concepto', pago?.concepto || 'Sin dato'];
        else if (medio === 'airbnb') segundo = ['Detalle', pago?.texto_original || pago?.concepto || 'Sin dato'];
        return { medio:nombres[medio] || medio.replaceAll('_',' ') || 'Sin dato', segundo,
            fecha:fechaBreve(String(pago?.fecha_comprobante || pago?.fecha_pago || '').slice(0,10)) };
    }

    function movimientosLibroIncorporacion(movimientos) {
        const estados = {
            en_sistema: 'Ya existe en Proyecto H',
            nuevo_seguro: 'Pago nuevo seguro',
            revisar: 'Requiere revisión',
            diferente: 'Con diferencias'
        };
        const seccion = elemento('section', 'haiku-incorporacion-movimientos-libro');
        seccion.append(elemento('strong', 'haiku-incorporacion-movimientos-titulo', 'MOVIMIENTOS DEL LIBRO RELACIONADOS'));
        const lista = elemento('div', 'haiku-incorporacion-movimientos-lista');
        for (const movimiento of movimientos || []) {
            const pago = movimiento.pago || {};
            const datos = datosPagoIncorporacion(pago);
            const tarjeta = elemento('div', `haiku-incorporacion-movimiento haiku-incorporacion-movimiento--${movimiento.estado || 'revisar'}`);
            const cabecera = elemento('div', 'haiku-incorporacion-movimiento-cabecera');
            cabecera.append(
                elemento('strong', 'haiku-incorporacion-movimiento-monto', money(pago.monto)),
                elemento('span', 'haiku-incorporacion-movimiento-estado', estados[movimiento.estado] || 'Requiere revisión')
            );
            const meta = elemento('div', 'haiku-incorporacion-meta-item haiku-incorporacion-meta-item--movimiento-libro');
            meta.append(
                datoIncorporacion('Medio', datos.medio),
                datoIncorporacion(datos.segundo[0], datos.segundo[1]),
                datoIncorporacion('Fecha pago', datos.fecha)
            );
            tarjeta.append(cabecera, meta);
            if (pago.concepto && datos.segundo[0] !== 'Concepto') {
                tarjeta.append(elemento('p', 'haiku-incorporacion-movimiento-concepto', 'Concepto: ' + pago.concepto));
            }
            if (movimiento.diferencias?.length) {
                tarjeta.append(elemento('p', 'haiku-incorporacion-movimiento-diferencias', movimiento.diferencias.join(' · ')));
            }
            lista.append(tarjeta);
        }
        if (!lista.children.length) {
            lista.append(elemento('p', 'haiku-incorporacion-movimientos-vacio', 'Sin movimientos financieros relacionados en esta consulta.'));
        }
        seccion.append(lista);
        return seccion;
    }

    function listaCambiosIncorporacion(item, titulo = null) {
        if (!item.cambios?.length) return null;
        const contenedor = elemento('div', titulo ? 'haiku-incorporacion-cambios-propuestos' : '');
        if (titulo) contenedor.append(elemento('strong', 'haiku-incorporacion-cambios-titulo', titulo));
        const cambios = elemento('ul','haiku-incorporacion-cambios');
        const bloqueNotas = (tituloBloque, fragmentos, clase) => {
            const bloque = elemento('section', `haiku-incorporacion-notas-fuente ${clase}`);
            bloque.append(elemento('h4', '', tituloBloque));
            if (!fragmentos.length) bloque.append(elemento('p', 'haiku-incorporacion-notas-vacio', 'Sin información.'));
            else {
                const lista = elemento('ul');
                fragmentos.forEach(fragmento => lista.append(elemento('li', '', fragmento)));
                bloque.append(lista);
            }
            return bloque;
        };
        for (const c of item.cambios) {
            const fila = elemento('li');
            if (c.campo === 'Notas y detalles del Libro') {
                const actuales = fragmentosObservaciones(c.anterior);
                const clavesActuales = new Set(actuales.map(claveFragmentoObservacion));
                const nuevas = fragmentosObservaciones(c.libro).filter(x => !clavesActuales.has(claveFragmentoObservacion(x)));
                const notas = elemento('details', 'haiku-incorporacion-notas-comparacion');
                const contenido = elemento('div', 'haiku-incorporacion-notas-contenido');
                contenido.append(
                    bloqueNotas('Proyecto H actual', actuales, 'haiku-incorporacion-notas-fuente--actual'),
                    bloqueNotas('Notas nuevas del Libro', nuevas, 'haiku-incorporacion-notas-fuente--libro')
                );
                notas.append(elemento('summary','',c.campo),contenido);
                fila.append(notas);
            } else {
                fila.append(elemento('strong','haku-cambio-campo',c.campo + ':'),
                    elemento('span','haku-cambio-actual',String(c.anterior ?? 'sin dato')),
                    elemento('span','haku-cambio-flecha','→'),
                    elemento('span','haku-cambio-libro',String(c.libro)));
            }
            cambios.append(fila);
        }
        contenedor.append(cambios);
        return contenedor;
    }

    function presentacionIncorporacion(item) {
        const partes = String(item.texto || "").split(" · ");
        const esReserva = /^CAB\s/i.test(partes[0] || "");
        const estadias = item.payload?.estadias || [];
        const reserva = item.payload?.reserva;
        const titular = reserva?.titular_nombre || (esReserva ? partes[1] : partes[0]) || "Sin titular";
        const cabana = esReserva ? partes[0] : partes.find(p => /^CAB\s/i.test(p));
        const monto = !esReserva ? partes.find(p => /^\$|monto no determinado/i.test(p)) : null;
        const concepto = !esReserva ? partes[3] : null;
        const periodo = esReserva && partes[2] ? partes[2].replace(/\d{4}-\d{2}-\d{2}/g, fechaBreve) : null;
        const tipo = esReserva ? partes[3] : null;
        const etiquetasEstado = {
            nuevas: "Crear reserva", estadias: "Añadir estadía", asociadas: "Ya asociada", actualizaciones: "Actualizar con Libro",
            pagos: "Pago preparado", dudosos: "Revisar pago", pendientes: "Pendiente", omitidos: "Omitido"
        };
        let detalle = "";
        if (item.categoria === 'actualizaciones') detalle = 'El Libro tiene prioridad: se guardarán estos cambios sólo al confirmar.';
        if (item.categoria === "nuevas") detalle = `Se propone una sola reserva con ${estadias.length} estadía${estadias.length === 1 ? "" : "s"}. Estado: ${[...new Set(estadias.map(e => e.datos.estado_estadia || 'pendiente'))].join(', ')}.`;
        if (item.categoria === "estadias") detalle = `Se propone añadir ${estadias.length} estadía${estadias.length === 1 ? "" : "s"} a la reserva existente.`;
        if (item.categoria === "asociadas") detalle = "La reserva ya está asociada. No se creará otra.";
        if (item.categoria === "pagos") detalle = item.payload?.reserva_ref ? "Se asociará cuando se cree la reserva seleccionada." : "Pago listo para incorporar.";
        if (item.categoria === "dudosos") detalle = "Este movimiento necesita revisión antes de poder prepararse.";
        if (item.categoria === "pendientes") detalle = "No se incorporará mientras siga pendiente.";
        if (item.categoria === "omitidos") detalle = /Ya existe un pago/i.test(item.texto) ? "Ya existe un pago con este identificador." :
            /estadías ya existen/i.test(item.texto) ? "La estadía ya existe en Proyecto H." : "Se omitió para evitar un posible duplicado.";
        const estado = item.etapaSiguiente ? 'Paso 2 · después del titular' : etiquetasEstado[item.categoria] || "Revisar";
        if (item.etapaSiguiente) detalle = 'Primero se guardarán el titular y RUT del Libro. Haku revalidará Proyecto H y habilitará este pago en el paso siguiente.';
        return { titular, cabana, monto, concepto, periodo, tipo, estado, detalle, estadias, reserva };
    }

    function renderizarItemIncorporacion(item, controles, actualizar, aprobar, comparacion) {
        const vista = presentacionIncorporacion(item);
        const esPagoActualizacion = item.payload?.tipo === 'pago_actualizar' && item.pagoLibro;
        const esPagoLibro = Boolean(item.pagoLibro);
        const fila = elemento("article", `haiku-incorporacion-item haiku-incorporacion-item--${item.categoria}`);
        if (esPagoLibro) {
            fila.dataset.haikuPagoOrigenHoja = item.pagoLibro?.origen?.hoja || "";
            fila.dataset.haikuPagoOrigenCelda = item.pagoLibro?.origen?.celda || "";
            fila.dataset.haikuPagoLibroTexto = item.pagoLibro?.texto_original || "";
            fila.dataset.haikuPagoUiV1 = "1";
        }
        const cabecera = elemento("div", "haiku-incorporacion-item-cabecera");
        const label = elemento("label", "haiku-incorporacion-seleccion");
        const check = elemento("input");
        check.type = "checkbox";
        check.checked = item.seleccionado;
        check.setAttribute("aria-label", `Seleccionar ${vista.titular}`);
        controles.set(item.id, check);
        check.addEventListener("change", () => { item.seleccionado = check.checked; actualizar(); });
        const identidad = elemento("span", "haiku-incorporacion-identidad");
        identidad.append(elemento("strong", "", vista.titular), elemento("small", "", [vista.cabana, vista.monto,
            esPagoLibro && item.pagoLibro?.fecha_bloque ? `Check-in ${fechaBreve(item.pagoLibro.fecha_bloque)}` : null].filter(Boolean).join(" · ")));
        label.append(check, identidad);
        cabecera.append(label, elemento("span", `haiku-incorporacion-estado haiku-incorporacion-estado--${item.categoria}`, vista.estado));
        fila.append(cabecera);
        if (item.aviso) fila.append(elemento('p','haiku-incorporacion-propuesta',item.aviso));
        if (item.cambios?.length && !esPagoActualizacion) fila.append(listaCambiosIncorporacion(item));

        if (esPagoLibro) {
            const datos = datosPagoIncorporacion(item.pagoLibro);
            const meta = elemento("div", "haiku-incorporacion-meta-item haiku-incorporacion-meta-item--pago-detalle");
            meta.append(datoIncorporacion('Medio', datos.medio), datoIncorporacion(datos.segundo[0], datos.segundo[1]), datoIncorporacion('Fecha pago', datos.fecha));
            fila.append(meta);
            if (esPagoActualizacion) fila.append(listaCambiosIncorporacion(item, 'Cambios propuestos por el Libro'));
        } else if (vista.estadias.length) {
            const lista = elemento("div", "haiku-incorporacion-estadias");
            for (const estadia of vista.estadias) {
                const periodo = `${fechaBreve(estadia.datos.fecha_ingreso)} → ${fechaBreve(estadia.datos.fecha_salida)}`;
                const tipo = estadia.datos.tipo_estadia === "fullday" ? "Full Day" : `${estadia.noches} noche${estadia.noches === 1 ? "" : "s"}`;
                const tarjeta = elemento("div", "haiku-incorporacion-estadia");
                tarjeta.append(
                    datoIncorporacion("Cabaña", `CAB ${estadia.cabana_numero}`),
                    datoIncorporacion("Fechas", periodo),
                    datoIncorporacion("Tipo", tipo),
                    datoIncorporacion("Huéspedes", `${estadia.datos.adultos ?? "?"} ad. · ${estadia.datos.ninos ?? "?"} niñ. · ${estadia.datos.mascotas ?? "?"} masc.`)
                );
                lista.append(tarjeta);
            }
            fila.append(lista);
        } else if (vista.monto || vista.cabana) {
            const meta = elemento("div", "haiku-incorporacion-meta-item");
            if (vista.monto) meta.append(datoIncorporacion("Monto", vista.monto));
            if (vista.concepto) meta.append(datoIncorporacion("Concepto", vista.concepto));
            if (!vista.monto && vista.cabana) meta.append(datoIncorporacion("Cabaña", vista.cabana));
            if (vista.periodo) meta.append(datoIncorporacion("Fechas", vista.periodo));
            if (vista.tipo) meta.append(datoIncorporacion("Tipo", vista.tipo));
            const bloque = item.payload?.datos_origen?.fecha_bloque;
            if (bloque) meta.append(datoIncorporacion("Bloque Check-In", fechaBreve(bloque)));
            fila.append(meta);
        }

        if (vista.reserva) {
            const contacto = elemento("div", "haiku-incorporacion-contacto");
            contacto.append(
                datoIncorporacion("Documento", vista.reserva.titular_numero_documento || "sin dato"),
                datoIncorporacion("Correo", vista.reserva.correo_contacto || "sin dato"),
                datoIncorporacion("Teléfono", vista.reserva.telefono_contacto || "sin dato")
            );
            fila.append(contacto);
        }

        if (item.categoria === 'asociadas' && Array.isArray(item.movimientosLibro)) {
            fila.append(movimientosLibroIncorporacion(item.movimientosLibro));
        }

        fila.append(elemento("p", "haiku-incorporacion-propuesta", vista.detalle));
        const movimiento=comparacion?.pagosDetalle?.find(x=>x.pago===item.pagoLibro);
        const franja=franjaDiferenciaPago(movimiento,comparacion);
        if (franja) fila.append(franja);
        if (item.motivos.length) {
            const avisos = elemento("ul", "haiku-incorporacion-avisos");
            item.motivos.forEach(motivo => {
                if (franja && motivo==='Hay otro pago con la misma reserva y monto, pero sin identificador fuerte; revisa ambos antes de aprobar.') return;
                avisos.append(elemento("li", "", motivo));
            });
            fila.append(avisos);
        }
        if (vista.reserva?.observaciones) {
            const notas = elemento("details", "haiku-incorporacion-notas");
            notas.append(elemento("summary", "", "Ver notas y solicitudes"), elemento("p", "", vista.reserva.observaciones));
            fila.append(notas);
        }
        if (item.aprobable && aprobar) {
            const boton = elemento("button", "haiku-incorporacion-aprobar", item.etiquetaAprobacion || "Aprobar este pago");
            boton.type = "button";
            boton.addEventListener("click", async () => { boton.disabled = true; await aprobar(item.id); });
            fila.append(boton);
        }
        return fila;
    }

    function renderizarResultadoIncorporacion(out, ejecucion, volver) {
        const r = ejecucion.resultado;
        out.className = "haiku-asistente-preview haiku-incorporacion haku-incorporacion-resultado";
        const cabecera = elemento("div", "haiku-incorporacion-cabecera haku-incorporacion-resultado-cabecera");
        const titulo = elemento("div");
        titulo.append(elemento("span", "", "LIBRO ↔ PROYECTO H"), elemento("strong", "", "Incorporación completada"));
        cabecera.append(titulo, elemento("span", "haiku-incorporacion-modo", "Guardado"));
        const mensaje = elemento("p", "haiku-incorporacion-aviso haku-incorporacion-resultado-mensaje", "Proyecto H confirmó la operación completa. El Libro original no fue modificado.");
        const resumen = elemento("div", "haiku-incorporacion-resumen haku-incorporacion-resultado-resumen");
        for (const [cantidad, etiqueta] of [
            [r.reservas_creadas || 0, "Reservas"],
            [r.estadias_agregadas || 0, "Estadías"],
            [r.pagos_creados || 0, "Pagos"],
            [r.actualizaciones || 0, "Actualizaciones del Libro"],
            [(r.omitidos || 0) + (ejecucion.omitidosAlRevalidar || 0), "Omitidos"]
        ]) {
            const tarjeta = elemento("div", "haiku-incorporacion-indicador haku-incorporacion-resultado-indicador");
            tarjeta.append(elemento("strong", "", String(cantidad)), elemento("span", "", etiqueta));
            resumen.append(tarjeta);
        }
        out.replaceChildren(cabecera, mensaje, resumen);
        if (r.reintento) out.append(elemento("p", "haiku-incorporacion-propuesta", "La confirmación ya se había completado; se recuperó el mismo resultado sin duplicar datos."));
        if ((r.omitidos || 0) + (ejecucion.omitidosAlRevalidar || 0) > 0) out.append(elemento("p", "haiku-incorporacion-propuesta", "Los elementos que aparecieron entretanto o coincidían con datos existentes fueron omitidos."));
        const acciones = elemento("div", "haiku-incorporacion-acciones");
        const boton = elemento("button", "libro-reserva-boton secundario", "Volver a la comparación");
        boton.type = "button";
        boton.addEventListener("click", volver);
        acciones.append(boton); out.append(acciones);
    }

    function renderizarIncorporacion(out, plan, volver, aprobar, incorporar) {
        out.className = "haiku-asistente-preview haiku-incorporacion haku-comparacion-compacta haku-incorporacion-compacta";
        const cabecera = elemento("div", "haiku-incorporacion-cabecera haiku-asistente-preview-cabecera");
        const titulo = elemento("div");
        const etapaIdentidad = plan.etapa === 'actualizar_identidad';
        const etapaPagos = plan.etapaAnteriorCompletada || plan.focoPagos;
        titulo.append(elemento("span", "", "LIBRO ↔ PROYECTO H"), elemento("strong", "", etapaIdentidad ? "Paso 1 de 2 · Actualizar titular y RUT" : plan.etapaAnteriorCompletada ? "Paso 2 de 2 · Aprobar pagos" : plan.focoPagos ? "Aprobar comprobante de pago" : "Confirmar incorporación"));
        cabecera.append(titulo, elemento("span", "haiku-incorporacion-modo", etapaIdentidad ? "Primero los datos" : etapaPagos ? "Pagos primero" : "Escritura habilitada"));
        const aviso = elemento("p", "haiku-incorporacion-aviso haiku-asistente-preview-resumen", etapaIdentidad ?
            "El Libro tiene prioridad. Confirma primero el cambio de titular y RUT en las reservas exactas. Los pagos relacionados permanecen bloqueados hasta que Proyecto H guarde estos datos y Haku vuelva a comprobarlos." :
            plan.etapaAnteriorCompletada ? "Titular y RUT actualizados. Haku volvió a leer Proyecto H: los abonos que ya existen quedan omitidos y ahora puedes revisar únicamente los pagos pendientes." :
            plan.focoPagos ? "El titular y RUT ya coinciden. Si Karina continúa en cambios del Libro es sólo por adultos, estado u otros datos opcionales; esos cambios no bloquean el comprobante ni se seleccionan automáticamente." :
            "El Libro de Reservas tiene prioridad. Revisa qué datos de Proyecto H serán reemplazados. Al confirmar se guardará la selección completa en una sola operación segura; los datos ausentes en el Libro se conservarán.");
        const resumen = elemento("div", "haiku-incorporacion-resumen haiku-asistente-preview-grid");
        out.replaceChildren(cabecera, aviso, resumen);

        root.HAIKU_LIBRO_CANCELACIONES_V1?.adjuntar(out, plan, plan.generacion);

        const indicadores = {};
        for (const [clave, etiqueta] of [["nuevas", "Reservas"], ["estadias", "Estadías"], ["actualizaciones", "Actualizaciones"], ["pagos", "Pagos"], ["dudosos", "Dudosos"], ["pendientes", "Pendientes"]]) {
            const tarjeta = elemento("div", "haiku-incorporacion-indicador haiku-asistente-preview-dato");
            indicadores[clave] = elemento("strong", "", "0");
            tarjeta.append(indicadores[clave], elemento("span", "", etiqueta));
            resumen.append(tarjeta);
        }

        const controles = new Map();
        let confirmar = null, guardando = false, volverAComparar = false;
        const idsEtapa = new Set(plan.actualizacionesIdentidad || []);
        const correspondeEtapa = item => !etapaIdentidad || idsEtapa.has(item.id);
        const esElegible = item => !item.motivos.length && CATEGORIAS_GUARDABLES.includes(item.categoria) &&
            correspondeEtapa(item) && item.dependeDe.every(id => plan.items.find(x => x.id === id)?.seleccionado);
        const seleccionados = () => plan.items.filter(item => item.seleccionado && esElegible(item));
        const actualizar = () => {
            for (const item of plan.items) {
                const control = controles.get(item.id);
                if (!control) continue;
                const dependencia = item.dependeDe.some(id => !plan.items.find(x => x.id === id)?.seleccionado);
                const noElegible = !!item.motivos.length || dependencia || !correspondeEtapa(item) || !CATEGORIAS_GUARDABLES.includes(item.categoria);
                control.disabled = guardando || noElegible;
                if (noElegible) { control.checked = false; item.seleccionado = false; }
            }
            indicadores.nuevas.textContent = plan.items.filter(i => i.categoria === "nuevas" && i.seleccionado).length;
            indicadores.estadias.textContent = plan.items.filter(i => i.categoria === "estadias" && i.seleccionado).reduce((n, i) => n + (i.payload?.estadias?.length || 0), 0);
            indicadores.actualizaciones.textContent = plan.items.filter(i => i.categoria === "actualizaciones" && i.seleccionado).length;
            indicadores.pagos.textContent = plan.items.filter(i => i.categoria === "pagos" && i.seleccionado).length;
            indicadores.dudosos.textContent = plan.items.filter(i => i.categoria === "dudosos").length;
            indicadores.pendientes.textContent = plan.items.filter(i => i.categoria === "pendientes" || i.motivos.length && i.categoria !== "dudosos").length;
            if (confirmar) {
                const cantidad = seleccionados().length;
                const comprobanteFoco = plan.focoComprobanteId ? plan.items.find(item => item.distribucionManual?.id === plan.focoComprobanteId)?.distribucionManual : null;
                confirmar.disabled = guardando || (!volverAComparar && cantidad === 0);
                if (!guardando) confirmar.textContent = volverAComparar ? "Volver a comparar con datos actuales" : etapaIdentidad && cantidad ? "Actualizar titular y RUT" :
                    comprobanteFoco && cantidad ? `Registrar comprobante de ${money(comprobanteFoco.total)}` :
                    cantidad ? `Continuar con ${cantidad} elemento${cantidad === 1 ? "" : "s"} listo${cantidad === 1 ? "" : "s"}` :
                    plan.focoPagos ? "Aprueba el comprobante completo" : "Selecciona al menos un elemento listo";
            }
        };

        const secciones = plan.focoPagos ?
            [["pagos", "Pagos preparados"], ["dudosos", "Pagos para revisar"], ["actualizaciones", "Otros cambios del Libro (opcionales)"], ["nuevas", "Reservas nuevas"], ["estadias", "Estadías a añadir"], ["asociadas", "Reservas ya asociadas"], ["pendientes", "Casos pendientes"], ["omitidos", "Ya existe / omitido"]] :
            [["nuevas", "Reservas nuevas"], ["actualizaciones", "Actualizar Proyecto H con el Libro"], ["estadias", "Estadías a añadir"], ["asociadas", "Reservas ya asociadas"], ["pagos", "Pagos preparados"], ["dudosos", "Pagos para revisar"], ["pendientes", "Casos pendientes"], ["omitidos", "Ya existe / omitido"]];
        for (const [categoria, tituloSeccion] of secciones) {
            const items = plan.items.filter(i => i.categoria === categoria);
            const estilo = {nuevas:"normal haku-icono--nuevo",actualizaciones:"normal haku-icono--intercambio",estadias:"normal haku-icono--calendario",asociadas:"normal haku-icono--calendario",pagos:"normal haku-icono--pago",dudosos:"faltante haku-icono--pago",pendientes:"revision haku-icono--alerta",omitidos:"neutro haku-icono--archivo"}[categoria];
            const seccion = elemento("details", `haiku-incorporacion-seccion haiku-incorporacion-seccion--${categoria} haiku-comparacion-acordeon haku-franja--${estilo}`);
            const summary = elemento("summary");
            summary.append(elemento("span", "", tituloSeccion), elemento("strong", "", String(items.length)));
            seccion.append(summary);
            const contenido = elemento("div", "haiku-incorporacion-lista");
            if (!items.length) contenido.append(elemento("p", "haiku-incorporacion-vacio", "Sin elementos en esta categoría."));
            else items.forEach(item => contenido.append(renderizarItemIncorporacion(item, controles, actualizar, aprobar, contextoVisualPlanes.get(plan))));
            seccion.append(contenido);
            out.append(seccion);
        }
        actualizar();

        const ayuda = elemento("details", "haiku-incorporacion-ayuda haiku-comparacion-acordeon haku-franja--neutro haku-icono--archivo");
        const permisos = plan.permisos.map(p => p + " · " + (root.haikuTienePermiso?.(p) === true ? "disponible" : "por verificar"));
        ayuda.append(elemento("summary", "", "Información de la incorporación"));
        const listaAyuda = elemento("ul");
        listaAyuda.append(elemento("li", "", "Los pagos se revisan bajo el bloque del día de Check-In."));
        listaAyuda.append(elemento("li", "", "Los datos desconocidos permanecen como “sin dato”."));
        permisos.forEach(p => listaAyuda.append(elemento("li", "", `Permiso ${p}`)));
        ayuda.append(listaAyuda);
        out.append(ayuda);

        const elegiblesAhora = plan.items.filter(item => !item.motivos.length && correspondeEtapa(item) && CATEGORIAS_GUARDABLES.includes(item.categoria) &&
            (!plan.focoPagos || item.categoria === 'pagos') &&
            (!plan.focoComprobanteId || item.distribucionManual?.id === plan.focoComprobanteId));
        const aprobables = plan.items.filter(item => item.categoria === "dudosos" && item.aprobable && !item.distribucionManual);
        const distribuciones = [...new Map(plan.items.filter(item => item.distribucionManual)
            .map(item => [item.distribucionManual.id, item.distribucionManual])).values()];
        const comprobantesAprobables = distribuciones.map(distribucion => ({
            distribucion,
            items:distribucion.ids.map(id => plan.items.find(item => item.id === id)).filter(Boolean)
        })).filter(grupo => grupo.items.length === grupo.distribucion.ids.length &&
            grupo.items.every(item => item.payload?.aprobado_manualmente === true || item.aprobable) &&
            grupo.items.some(item => item.aprobable));
        const pendientes = plan.items.filter(item => item.categoria === "pendientes" || item.motivos.length && item.categoria !== "dudosos");
        const atajos = elemento("div", "haiku-incorporacion-atajos");
        if (elegiblesAhora.length) {
            const seleccionar = elemento("button", "haiku-incorporacion-atajo", "Seleccionar todo lo listo");
            seleccionar.type = "button";
            seleccionar.addEventListener("click", () => {
                elegiblesAhora.forEach(item => { item.seleccionado = true; });
                actualizar();
            });
            atajos.append(seleccionar);
        }
        if (aprobar) for (const grupo of comprobantesAprobables) {
            const aprobarComprobante = elemento("button", "haiku-incorporacion-atajo haiku-incorporacion-atajo--aprobar",
                `Aprobar comprobante completo · ${money(grupo.distribucion.total)}`);
            aprobarComprobante.type = "button";
            aprobarComprobante.title = grupo.distribucion.tipo === 'grupo_alojamiento_penalidad' ?
                "Aprueba juntas las dos partes de alojamiento y la penalidad; el servidor volverá a validar el saldo exacto." :
                "Aprueba juntas todas las partes del mismo comprobante.";
            aprobarComprobante.addEventListener("click", async () => {
                aprobarComprobante.disabled = true;
                await aprobar(grupo.items.filter(item => item.aprobable).map(item => item.id));
            });
            atajos.append(aprobarComprobante);
        }
        if (aprobables.length && aprobar) {
            const aprobarTodos = elemento("button", "haiku-incorporacion-atajo haiku-incorporacion-atajo--aprobar", `Aprobar ${aprobables.length} pago${aprobables.length === 1 ? "" : "s"} revisable${aprobables.length === 1 ? "" : "s"}`);
            aprobarTodos.type = "button";
            aprobarTodos.title = "Incluye sólo pagos cuyo único requisito pendiente es tu aprobación manual.";
            aprobarTodos.addEventListener("click", async () => {
                aprobarTodos.disabled = true;
                await aprobar(aprobables.map(item => item.id));
            });
            atajos.append(aprobarTodos);
        }
        if (atajos.children.length) out.append(atajos);
        if (pendientes.length) out.append(elemento("p", "haiku-incorporacion-continuar", `${pendientes.length} caso${pendientes.length === 1 ? "" : "s"} pendiente${pendientes.length === 1 ? "" : "s"} quedará${pendientes.length === 1 ? "" : "n"} fuera. Puedes continuar con los elementos listos.`));

        const acciones = elemento("div", "haiku-incorporacion-acciones");
        const atras = elemento("button", "libro-reserva-boton secundario", "Volver");
        atras.type = "button";
        atras.addEventListener("click", volver);
        confirmar = elemento("button", "libro-reserva-boton", "Continuar con los elementos listos");
        confirmar.type = "button";
        confirmar.addEventListener("click", async () => {
            if (volverAComparar) {
                confirmar.disabled = true;
                confirmar.textContent = 'Actualizando comparación…';
                await volver();
                return;
            }
            const seleccion = seleccionados();
            const nuevas = seleccion.filter(i => i.categoria === "nuevas").length;
            const estadias = seleccion.filter(i => i.categoria === "estadias").reduce((n, i) => n + (i.payload?.estadias?.length || 0), 0);
            const pagos = seleccion.filter(i => i.categoria === "pagos").length;
            if (!seleccion.length) return;
            const comprobanteFoco = plan.focoComprobanteId ? seleccion.find(item => item.distribucionManual?.id === plan.focoComprobanteId)?.distribucionManual : null;
            const texto = etapaIdentidad ?
                `Se actualizarán el titular y RUT en ${seleccion.length} reserva(s) exacta(s). Después Haku volverá a consultar Proyecto H antes de habilitar los pagos. ¿Confirmas?` :
                comprobanteFoco ? `Se registrará un único comprobante de ${money(comprobanteFoco.total)}. Proyecto H volverá a validar el grupo, el ajuste del 10% y que el saldo quede exactamente en cero. ¿Confirmas?` :
                `Se incorporarán ${nuevas} reserva(s), ${estadias} estadía(s) y ${pagos} pago(s), además de ${seleccion.filter(i => i.categoria === "actualizaciones").length} actualización(es) con los datos del Libro. Proyecto H volverá a comprobar duplicados antes de guardar. ¿Confirmas?`;
            if (typeof root.confirm === "function" && !root.confirm(texto)) return;
            guardando = true; atras.disabled = true; actualizar();
            confirmar.textContent = "Revalidando y guardando…";
            aviso.textContent = etapaIdentidad ? "Guardando titular y RUT antes de volver a comprobar los pagos…" : "Comprobando cambios recientes y ejecutando la incorporación completa…";
            try {
                const ejecucion = await incorporar(plan);
                await Promise.allSettled([
                    Promise.resolve().then(() => root.haikuSincronizarReservasSupabase?.()),
                    Promise.resolve().then(() => root.haikuCargarAbonosSupabase?.()),
                    Promise.resolve().then(() => root.haikuCargarSaldosCheckinSupabase?.())
                ]);
                if (ejecucion.siguientePlan) renderizarIncorporacion(out, ejecucion.siguientePlan, volver, aprobar, incorporar);
                else renderizarResultadoIncorporacion(out, ejecucion, volver);
            } catch (error) {
                guardando = false; atras.disabled = false;
                volverAComparar = error.haikuConflictoDatos === true;
                confirmar.textContent = volverAComparar ? "Volver a comparar con datos actuales" : "Reintentar confirmación";
                aviso.textContent = volverAComparar
                    ? "No se guardó nada: " + (error.message || "Proyecto H cambió") + ". Vuelve a comparar; Haku conservará las decisiones que sigan siendo compatibles y pedirá una confirmación nueva."
                    : "No se pudo confirmar: " + (error.message || "error desconocido") + ". No cierres esta vista; el reintento de red usa la misma operación para evitar duplicados.";
                actualizar();
            }
        });
        actualizar();
        acciones.append(atras, confirmar);
        out.append(acciones);
    }

    async function enviar(texto) {
        ocupado = true;
        const campo = document.getElementById("haiku-asistente-texto"), boton = document.getElementById("haiku-asistente-enviar");
        campo.disabled = true;
        boton.disabled = true;
        campo.value = "";
        mensaje("usuario", texto);
        const out = mensaje("asistente", "Leyendo la estructura del Libro local…");
        try {
            const result = await consultar(texto);
            if (result.q.versiones) renderizarVersiones(out, result);
            else if (result.q.comparar) renderizarComparacion(out, result);
            else renderizarConsultaLibro(out, result);
        } catch (error) {
            out.className = "haiku-asistente-mensaje haiku-asistente-mensaje--asistente";
            out.textContent = error.message || "No pude completar la lectura del Libro.";
        } finally {
            ocupado = false;
            campo.disabled = false;
            campo.dispatchEvent(new Event("input", { bubbles: true }));
            out.scrollIntoView({ block: "nearest" });
        }
    }

    function interceptar(event) {
        const target = event.type === "click"
            ? event.target?.closest?.("#haiku-asistente-enviar")
            : event.target?.id === "haiku-asistente-texto" && (event.ctrlKey || event.metaKey) && event.key === "Enter";
        if (!target) return;
        const texto = document.getElementById("haiku-asistente-texto")?.value.trim();
        if (!esLibro(texto)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (ocupado || root.HAIKU_ASISTENTE?.procesando?.()) return;
        if (document.querySelector("#haiku-asistente-adjuntos .haiku-asistente-adjunto")) {
            mensaje("asistente", "Para consultar el Libro, retira las capturas adjuntas. Usaré el XLSX cargado en Libro de Reserva.");
            return;
        }
        enviar(texto);
    }

    root.addEventListener("click", interceptar, true);
    root.addEventListener("keydown", interceptar, true);
    root.addEventListener("haiku:libro-cambio", () => {
        document.querySelectorAll('[data-haiku-libro-respuesta="1"]').forEach(el => {
            el.className = "haiku-asistente-mensaje haiku-asistente-mensaje--asistente";
            el.textContent = "Consulta del Libro anterior invalidada: el archivo cambió o se quitó. Vuelve a preguntar.";
        });
    });

    const acciones = document.querySelector("#seccion-libro-reserva .libro-reserva-acciones");
    const nota = document.querySelector("#seccion-libro-reserva .libro-reserva-nota span:last-child");
    if (nota) nota.textContent = "Haku puede consultar esta copia local sin modificar el original ni guardarla en Google o Supabase. En PC se conservan como máximo el Libro actual y el anterior; Quitar libro de memoria borra ambos.";

    if (acciones && root.matchMedia("(min-width: 901px)").matches) {
        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "libro-reserva-boton secundario";
        boton.textContent = "Consultar Libro con Haku";
        boton.addEventListener("click", () => {
            root.HAIKU_ASISTENTE?.abrir?.();
            const campo = document.getElementById("haiku-asistente-texto");
            if (campo) {
                campo.value = "Libro: ";
                campo.dispatchEvent(new Event("input", { bubbles: true }));
                campo.focus();
            }
        });
        acciones.append(boton);
    }
})(typeof window !== "undefined" ? window : globalThis);
