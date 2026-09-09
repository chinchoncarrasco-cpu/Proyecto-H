(function (root) {
    "use strict";
    const S = root.HAIKU_LIBRO_SEMANTICA;
    if (!S) return;

    const money = v => v === null || v === undefined ? "monto no determinado" : `$${Number(v).toLocaleString("es-CL")} CLP`;
    const source = x => `${x?.hoja || ""}!${x?.celda || ""}`;
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

        return {
            texto, desde, hasta, hojas: seleccion, nombre,
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

    function asociarConservador(reserva, candidatas) {
        const scores = candidatas.filter(candidatoElegible).map(s => {
            const fechas = reserva.fecha_checkin === s.fecha_checkin && reserva.fecha_checkout === s.fecha_checkout;
            const cab = Number(reserva.cabana) === Number(s.cabana);
            const persona = identidad(reserva, s);
            const identidadCompatible = persona.compatible;
            return {
                s,
                segura: !reserva.advertencias?.length && cab && fechas && identidadCompatible,
                posible: (cab && fechas) || identidadCompatible
            };
        });
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

    // Presentation only: these decisions never change matching or payment safety.
    function preguntaPresentacion(g) {
        const pendientes = g.items.filter(i => i.estado !== "asociada");
        const candidatos = [...new Map(g.items.flatMap(i => [i.sistema, ...(i.candidatosDetalle || [])])
            .filter(Boolean).map(c => [c.id, c])).values()];
        const avisos = [...new Set(pendientes.flatMap(i => i.libro.advertencias || []))];
        const comparaciones = [];
        const opciones = [{ valor: "", categoria: "pendientes", texto: "Dejar pendiente", efecto: "no se incorpora" }];
        for (const c of candidatos) {
            const relevantes = pendientes.filter(i => i.candidatosDetalle?.some(x => x.id === c.id) ||
                (g.categoria === "estadia_faltante" && identidad(i.libro, c).compatible));
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
                servicios: g.items.flatMap(x => x.serviciosComparacion || [])
            };
        });
    }

    async function paginas(build) {
        const rows = [];
        for (let start = 0; start < 5000; start += 500) {
            const { data, error } = await build().order("id").range(start, start + 499);
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

    function pagoDebilYaExiste(p, existente, reservaId) {
        if (!reservaId || existente?.reserva_id !== reservaId || medioLibro(p) !== 'transferencia') return false;
        if (String(existente.medio_pago || '').toLowerCase() !== 'transferencia') return false;
        if (Number(existente.monto) !== Number(p.monto) || String(existente.fecha_pago || '').slice(0,10) !== String(p.fecha_comprobante || '').slice(0,10)) return false;
        const origenLibro = existente.datos_origen?.origen_libro || existente.datos_origen?.origen;
        if (origenLibro && p.origen && source(origenLibro) === source(p.origen)) return true;
        const libro = S.normalizar(p.texto_original), sistema = S.normalizar(existente.referencia_externa || existente.observaciones);
        return Boolean(libro && sistema && libro.length >= 12 && libro === sistema);
    }

    function transferenciasDebilesExistentes(resultados, pagos) {
        const grupos = new Map();
        const asignadas = new Map();
        for (const result of resultados) {
            if (result.estado !== 'asociada') continue;
            for (const p of result.libro.pagos || []) {
                if (pagoTieneIdentificadorFuerte(p) || medioLibro(p) !== 'transferencia' ||
                    !Number.isSafeInteger(Number(p.monto)) || !p.fecha_comprobante) continue;
                const key = [result.sistema.reserva_id, Number(p.monto), String(p.fecha_comprobante).slice(0, 10), 'transferencia'].join('|');
                if (!grupos.has(key)) grupos.set(key, []);
                grupos.get(key).push({ p, reservaId: result.sistema.reserva_id });
            }
        }
        for (const [key, libro] of grupos) {
            const [reservaId, monto, fecha] = key.split('|');
            const sistema = pagos.filter(p => p.reserva_id === reservaId && Number(p.monto) === Number(monto) &&
                medioSistema(p) === 'transferencia' && String(p.fecha_pago || '').slice(0, 10) === fecha);
            const usados = new Set();
            for (const item of libro) {
                const exactos = sistema.filter(p => !usados.has(p.id) && pagoDebilYaExiste(item.p, p, item.reservaId));
                if (exactos.length === 1) {
                    usados.add(exactos[0].id);
                    asignadas.set(item.p, exactos[0]);
                }
            }
            const restantesLibro = libro.filter(item => !asignadas.has(item.p));
            const restantesSistema = sistema.filter(p => !usados.has(p.id) &&
                !S.normalizar(p.referencia_externa || p.observaciones) &&
                !(p.datos_origen?.origen_libro || p.datos_origen?.origen));
            // Compatibilidad histórica: algunos pagos antiguos no conservaron
            // glosa/origen. Sólo se aceptan si reserva+monto+medio+fecha permiten
            // cubrir uno a uno todos los movimientos restantes del Libro.
            if (restantesLibro.length && restantesSistema.length === restantesLibro.length) {
                restantesLibro.forEach((item, indice) => asignadas.set(item.p, restantesSistema[indice]));
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

        const resultados = validas.map(r => ({
            libro: r,
            ...asociarConservador(r, system),
            diferencias: [],
            pagosComparacion: [],
            serviciosComparacion: []
        }));

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
            .select("id,reserva_id,monto,moneda,estado,folio,codigo_autorizacion,bove,datos_origen,medio_pago,fecha_pago,referencia_externa,observaciones,tipo_movimiento,etapa_operativa"));
        const transferenciasExistentes = transferenciasDebilesExistentes(resultados, pagos);
        const servicios = [];
        for (let i = 0; i < ids.length; i += 50) {
            const grupo = ids.slice(i, i + 50);
            servicios.push(...await paginas(() => cliente.from("servicios")
                .select("id,reserva_id,fecha_servicio,total,estado_servicio,catalogo_servicios(nombre)")
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
                const candidatos = pagos.filter(x => pagoCoincide(p, x));
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
                    if (p.fecha_comprobante && x.fecha_pago && String(x.fecha_pago).slice(0, 10) !== String(p.fecha_comprobante).slice(0, 10)) {
                        diferenciasPago.push("fecha de pago diferente");
                        result.diferencias.push("Fecha diferente en un pago del Libro.");
                    }
                    result.pagosComparacion.push({ estado: diferenciasPago.length ? "diferente" : "en_sistema", pago: p, sistema: x, reserva: r, diferencias: diferenciasPago });
                } else if (transferenciasExistentes.has(p)) {
                    result.pagosComparacion.push({ estado: "en_sistema", pago: p, sistema: transferenciasExistentes.get(p), reserva: r, coincidencia_debil: true, diferencias: [] });
                } else if (pagoTieneIdentificadorFuerte(p) && candidatos.length === 0 && Number(p.monto) > 0 && p.tipo_movimiento !== "penalidad") {
                    result.pagosComparacion.push({ estado: "nuevo_seguro", pago: p, reserva: r });
                } else {
                    result.pagosComparacion.push({ estado: "revisar", pago: p, reserva: r });
                }
            }

            for (const p of r.pagos_sin_asociacion) {
                const candidatos = pagos.filter(x => pagoCoincide(p, x));
                const existente = p.advertencias?.length && S.mismaPersona(p.titular, r.titular) &&
                    candidatos.length === 1 && candidatos[0].reserva_id === s.reserva_id &&
                    candidatos[0].moneda === p.moneda &&
                    Number(candidatos[0].monto) === p.monto && medioSistema(candidatos[0]) === medioLibro(p) &&
                    String(candidatos[0].fecha_pago || '').slice(0, 10) === p.fecha_comprobante ? candidatos[0] : null;
                result.pagosComparacion.push({ estado: existente ? 'en_sistema' : 'revisar', pago: p, reserva: r,
                    ...(existente ? { sistema: existente } : {}), diferencias: p.advertencias || [] });
            }

            for (const service of r.servicios) {
                const existe = servicios.some(x => x.reserva_id === s.reserva_id && S.normalizar(x.catalogo_servicios?.nombre).includes(service.concepto.replace(/_/g, " ")));
                result.serviciosComparacion.push({ estado: existe ? "en_sistema" : "revisar", servicio: service, reserva: r });
                if (!existe) result.diferencias.push(`Servicio mencionado sin coincidencia por concepto: ${service.concepto}. La fecha y el monto requieren revisión.`);
            }
        }

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
        const serviciosUnicos = new Map();
        for (const x of resultados.flatMap(r => r.serviciosComparacion)) {
            const key = `${x.reserva?.id}|${x.servicio?.concepto}|${x.servicio?.texto_original}`;
            if (!serviciosUnicos.has(key)) serviciosUnicos.set(key, x);
        }

        resultados.snapshot = { estadias: system, pagos };
        resultados.grupos = grupos;
        resultados.pagosDetalle = [...pagosUnicos.values()];
        resultados.serviciosDetalle = [...serviciosUnicos.values()];
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
            servicios_revisar: [...serviciosUnicos.values()].filter(x => x.estado !== "en_sistema").length
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
        const docCambio = r.rut_documento && documentoCanon(r.rut_documento) !== documentoCanon(s.rut_documento);
        const estado = estadoLibro(r);
        const reserva = parcheLibro({ titular_nombre:s.titular, titular_numero_documento:s.rut_documento, titular_tipo_documento:s.tipo_documento,
            correo_contacto:s.correo, telefono_contacto:s.telefono, observaciones:s.observaciones, estado_reserva:s.estado_reserva },
            { titular_nombre:r.titular, titular_numero_documento:r.rut_documento,
                titular_tipo_documento:docCambio ? (/^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/.test(r.rut_documento) ? 'rut' : /[a-z]/i.test(r.rut_documento) ? 'pasaporte' : 'documento') : undefined,
                correo_contacto:r.correo, telefono_contacto:r.telefono,
                observaciones:notas ? S.normalizar(s.observaciones) === S.normalizar(notas) ? s.observaciones :
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
        if (p.fecha_comprobante && String(s.fecha_pago || '').slice(0,10) !== p.fecha_comprobante) propuesta.fecha_pago = p.fecha_comprobante + 'T12:00:00Z';
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
    function crearPlanIncorporacion(reservas, comp, decisiones = new Map(), aprobados = new Set(), anterior = null) {
        const plan = { escrituraHabilitada: ESCRITURA_LIBRO, items: [], permisos: [], alcance: 'Registros visibles con la sesión actual' };
        const snapshot = comp.snapshot || { estadias: [], pagos: [] };
        const add = (categoria, id, texto, payload = null, motivos = [], dependeDe = [], permisos = []) => {
            const item = { categoria, id, texto, payload, motivos, dependeDe, permisos, seleccionado: !motivos.length && CATEGORIAS_GUARDABLES.includes(categoria) };
            plan.items.push(item); return item;
        };
        const destinos = new Map();
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
                let cambios = 0;
                for (const i of g.items) {
                    const s = i.sistema || destino;
                    if (!s) continue;
                    const hermanas = g.items.filter(j => (j.sistema || destino)?.reserva_id === s.reserva_id).map(j => j.libro);
                    const compartido = { ...i.libro, texto_original:[...new Set(hermanas.map(r => r.texto_original).filter(Boolean))].join('\n'),
                        notas_importantes:[...new Set(hermanas.flatMap(r => r.notas_importantes || []))],
                        pagos_pendientes:[...new Set(hermanas.flatMap(r => r.pagos_pendientes || []))], servicios:hermanas.flatMap(r => r.servicios || []) };
                    const payload = actualizacionReservaLibro(compartido,s), updateId = 'actualizar:' + (i.libro.id || claveReserva(i.libro)) + ':' + s.id;
                    const motivos = g.items.length > 1 && destino && !i.sistema ? ['Elige por separado la estadía destino de cada cabaña.'] : [];
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
                    destinos.set(claveReserva(i.libro), { reserva_id:s.reserva_id, dependeDe, bloqueado:!!motivos.length });
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
        for (const r of reservas.map(normalizarReservaComparacion).filter(r => !esReservaValida(r))) add('pendientes', 'invalida:' + claveReserva(r), (r.titular || 'Sin titular') + ' · CAB ' + (r.cabana || 'sin dato'), null, ['Faltan titular, cabaña o fechas válidas.']);
        const vistos = [];
        for (const x of comp.pagosDetalle || []) {
            const p = x.pago, r = x.reserva, destino = destinos.get(claveReserva(r));
            const id = 'pago:' + claveReserva(r) + ':' + source(p.origen) + ':' + JSON.stringify(p);
            if (plan.items.some(i => i.id === id)) continue;
            const texto = r.titular + ' · CAB ' + r.cabana + ' · ' + money(p.monto) + ' · ' + (p.concepto || p.tipo_movimiento) + ' · Check-In ' + r.fecha_checkin;
            const fuerte = pagoTieneIdentificadorFuerte(p);
            if (x.estado === 'en_sistema' && x.sistema) {
                add('omitidos', id, texto + (medioLibro(p) === 'transferencia' ?
                    ' · La transferencia ya existe en Proyecto H y no se incorporará nuevamente.' :
                    ' · El pago ya existe en Proyecto H y no se incorporará nuevamente.'));
                continue;
            }
            const coincidencias = fuerte ? snapshot.pagos.filter(v => pagoCoincide(p,v)) : [];
            const duplicado = coincidencias[0];
            if (duplicado) {
                const patch = actualizacionPagoLibro(p,duplicado);
                if (coincidencias.length !== 1 || duplicado.reserva_id !== destino?.reserva_id) {
                    add('dudosos',id,texto,null,['El identificador pertenece a otra reserva o a varios pagos; confirma el destino correcto.']); continue;
                }
                if (!patch.cambios.length) { add('omitidos',id,texto+' · El pago ya coincide con el Libro.'); continue; }
                const motivos = [];
                if (destino?.bloqueado || !r.pagos.includes(p)) motivos.push('Primero confirma la asociación del movimiento con la reserva.');
                if (!Number.isSafeInteger(p.monto) || p.monto <= 0 || p.moneda !== 'CLP') motivos.push('El monto o la moneda requiere revisión.');
                if (p.tipo_movimiento !== 'alojamiento' || p.pago_recibido !== true || p.estado_pago !== 'registrado_en_libro') motivos.push('El Libro no confirma este pago recibido de alojamiento.');
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
                if ('monto' in patch.despues) item.aviso='Se corregirá el importe del mismo pago. Si disminuye, se ajustará su distribución entre cargos para no aplicar más que el monto del Libro; quedará registrado el cambio.';
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
            if (p.tipo_movimiento !== 'alojamiento') motivos.push('El concepto requiere una aplicación manual.');
            if (p.pago_recibido !== true || p.estado_pago !== 'registrado_en_libro') motivos.push('El Libro no confirma un pago recibido.');
            const medio = medioLibro(p);
            if (!medio) motivos.push('Falta precisar el medio de pago (Webpay crédito o débito, si corresponde).');
            const asociadoLibro = r.pagos.includes(p);
            const seguro = asociadoLibro && pagoTieneIdentificadorFuerte(p) && (x.estado === 'nuevo_seguro' || destino?.reserva_ref);
            const manual = aprobados.has(id);
            const mismoMontoSinIdentificador = !fuerte && (
                snapshot.pagos.some(v => destino?.reserva_id && v.reserva_id === destino.reserva_id && Number(v.monto) === Number(p.monto) && (!v.moneda || v.moneda === p.moneda)) ||
                vistos.some(v => v.destino === destinoActual && Number(v.pago.monto) === Number(p.monto) && v.pago.moneda === p.moneda)
            );
            if (mismoMontoSinIdentificador && !manual) motivos.push('Hay otro pago con la misma reserva y monto, pero sin identificador fuerte; revisa ambos antes de aprobar.');
            if (conflictoIdentificador) motivos.push('Identificador repetido con monto o reserva diferente.');
            if (!seguro && !manual) motivos.push('Requiere aprobación manual de la asociación y el pago.');
            const payload = { contrato: 'haiku_incorporar_libro_v1', reserva_ref: destino?.reserva_ref || null,
                argumentos: { p_reserva_id: destino?.reserva_id || null, p_monto: p.monto, p_medio_pago: medio || null, p_etapa_operativa: 'abono', p_referencia_externa: p.texto_original || null,
                    p_fecha_pago: p.fecha_comprobante || null, p_folio: p.folio || null, p_codigo_autorizacion: p.codigo_autorizacion || null,
                    p_bove: p.bove || null, p_observaciones: p.texto_original || null, p_aplicaciones: [], p_modo_aplicacion: 'alojamiento' },
                datos_origen: { bovtar: p.bovtar || null, fecha_bloque: p.fecha_bloque, origen: p.origen }, aprobado_manualmente: manual };
            if (!p.fecha_comprobante) motivos.push('Falta la fecha del comprobante; no se usa la fecha del bloque como fecha de pago.');
            const item = add(motivos.length ? 'dudosos' : 'pagos', id, texto + (destino?.reserva_ref ? ' · Asociar después de crear la reserva' : destino?.reserva_id ? ' · Reserva ' + destino.reserva_id : ''), payload, motivos, destino?.dependeDe || [], ['pagos.registrar']);
            const motivosAprobables = new Set(['Requiere aprobación manual de la asociación y el pago.', 'Hay otro pago con la misma reserva y monto, pero sin identificador fuerte; revisa ambos antes de aprobar.']);
            item.aprobable = motivos.length > 0 && motivos.every(motivo => motivosAprobables.has(motivo));
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
        plan.permisos = [...new Set(plan.items.flatMap(i => i.permisos))];
        return plan;
    }

    async function prepararIncorporacion(result, decisiones = new Map(), aprobados = new Set(), cliente = root.haikuSupabase) {
        const generacion = root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion;
        if (result.generacion !== undefined && result.generacion !== generacion) throw new Error('El Libro cambió; vuelve a comparar.');
        const comparacion = await compararSistema(result.reservas, cliente, result.q);
        if (root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion !== generacion) throw new Error('El Libro cambió; vuelve a comparar.');
        return crearPlanIncorporacion(result.reservas, comparacion, decisiones, aprobados, result.comparacion);
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
        return plan.items.filter(item => elegidos.has(item.id) && item.dependeDe.every(id => elegidos.has(id))).map(item => {
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
                tipo: 'pago', item_id: item.id,
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
            const items = serializarIncorporacion(actualizado);
            if (!items.length) throw new Error('Los elementos seleccionados cambiaron o ya existen. Vuelve a preparar la incorporación.');
            solicitud = { operacionId: crearIdOperacion(), items, omitidosAlRevalidar };
            // Se conserva la misma solicitud para que un reintento de red sea idempotente.
            plan.solicitudPendiente = solicitud;
        } else omitidosAlRevalidar = solicitud.omitidosAlRevalidar || 0;

        const { data, error } = await cliente.rpc('haiku_incorporar_libro_v1', {
            p_operacion_id: solicitud.operacionId,
            p_items: solicitud.items
        });
        if (error) {
            const mensaje = String(error.message || error.details || error);
            if (/Proyecto H cambi[oó]|vuelve a preparar|ya no (?:est[aá]|es|tiene)|no editable|no es inequ[ií]voco|se superpone/i.test(mensaje)) {
                // Un conflicto de datos no es un retry de red: el payload y su
                // snapshot ya no son vigentes. El siguiente paso vuelve a la
                // comparación y conserva decisiones humanas compatibles.
                plan.solicitudPendiente = null;
                const conflicto = new Error(mensaje);
                conflicto.haikuConflictoDatos = true;
                throw conflicto;
            }
            throw error;
        }
        if (!data?.ok) throw new Error('Proyecto H no confirmó la incorporación.');
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
            archivo: estado.nombre,
            reservas: [],
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
        for (const h of q.hojas) {
            const data = await libro.consultarHoja(h);
            resultado.advertencias.push(...(data.advertencias || []));
            const reservasHoja = Array.isArray(data.reservas) ? data.reservas : [];
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
        if (libro.estado().generacion !== estado.generacion) throw new Error("El Libro cambió durante la consulta. Vuelve a preguntar.");
        return resultado;
    }

    function descripcionGrupo(g) {
        const r = g.principal;
        const cab = g.cabanas.length > 1 ? `CAB ${g.cabanas.join(" + ")}` : `CAB ${g.cabanas[0]}`;
        const estadia = r.tipo_estadia === "full_day" ? "Full Day" : `${r.noches} noche${r.noches === 1 ? "" : "s"}`;
        return `${cab} · ${r.titular} · ${r.fecha_checkin} → ${r.fecha_checkout} · ${estadia}`;
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

    root.HAIKU_LIBRO_CONSULTAS = Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion });
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

    function agregarLista(contenedor, titulo, items, { alerta = false, vacio = "Sin elementos." } = {}) {
        const bloque = elemento("div", `haiku-asistente-preview-lista${alerta ? " haiku-asistente-preview-lista--alerta" : ""}`);
        bloque.append(elemento("strong", "", titulo));
        const ul = document.createElement("ul");
        if (!items.length) ul.append(elemento("li", "", vacio));
        else items.forEach(item => ul.append(elemento("li", "", item)));
        bloque.append(ul);
        contenedor.append(bloque);
        return bloque;
    }

    function agregarDetalles(contenedor, titulo, items) {
        if (!items.length) return;
        const details = document.createElement("details");
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
        items.forEach(item => ul.append(elemento("li", "", item)));
        details.append(ul);
        contenedor.append(details);
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

        out.className = "haiku-asistente-preview";
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
            const estado = elemento("p", "haiku-asistente-preview-resumen", `Revalidación completada · ${ui.revalidado}. ${meta.asociadas ?? 0} reservas asociadas; ${meta.pagos_faltantes ?? 0} pagos nuevos seguros; ${meta.ambiguas ?? 0} por decidir. Las decisiones anteriores se descartaron. Sólo vista previa.`);
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

        if (!meta.libro && meta.libro_detectadas) {
            agregarLista(out, "Revisar lectura del Libro", [`El lector encontró ${meta.libro_detectadas} filas de reserva, pero ninguna pasó la validación estructural. No se interpreta como Libro vacío.`], { alerta: true });
        }

        agregarLista(
            out,
            `Reservas que faltan (${faltantes.length})`,
            faltantes.map(g => `${descripcionGrupo(g)} · confianza ${g.confianza}`),
            { alerta: true, vacio: "No encontré reservas claramente faltantes." }
        );

        if (pagosFaltan.length) {
            agregarLista(
                out,
                `Pagos nuevos seguros en esta consulta (${pagosFaltan.length})`,
                pagosFaltan.map(descripcionPagoNuevoSeguro),
                { alerta: true }
            );
        }

        agregarDetalles(
            out,
            "Reservas con diferencias",
            diferencias.map(g => `${descripcionGrupo(g)} — ${g.diferencias.join("; ")}`)
        );
        agregarDetalles(
            out,
            "Posibles faltantes / modificaciones",
            ambiguas.map(g => `${descripcionGrupo(g)} — ${g.categoria.replaceAll("_", " ")} · confianza ${g.confianza}. ${g.pregunta}`)
        );
        agregarDetalles(
            out,
            "Pagos que requieren revisión",
            pagosRevisar.map(x => `${x.reserva.titular} · ${x.pago.tipo_movimiento} · ${money(x.pago.monto)}`)
        );
        agregarDetalles(
            out,
            "Servicios que requieren revisión",
            serviciosRevisar.map(x => `${x.reserva.titular} · ${x.servicio.concepto} · ${x.servicio.texto_original}`)
        );

        agregarDetalles(out, "Grupos / multicabaña", grupos.filter(g => g.cabanas.length > 1).map(g =>
            descripcionGrupo(g) + " · " + g.categoria.replaceAll("_", " ") + " · confianza " + g.confianza));
        agregarDetalles(out, "Detalles técnicos XLSX", grupos.flatMap(g => g.items.flatMap(x => [
            x.libro.titular + " · " + source(x.libro.coordenadas_origen),
            ...[...x.libro.pagos, ...x.libro.pagos_sin_asociacion].map(p => x.libro.titular + " · " + source(p.origen))
        ])));
        const decisiones = ui.decisiones || new Map();
        const aprobados = ui.aprobados || new Set();
        if (ambiguas.length) {
            const preguntas = elemento("div", "haiku-asistente-preview-lista" + (ui.preguntasAbiertas ? " haiku-reconciliacion-abierto" : ""));
            preguntas.append(elemento("strong", "", "Preguntas necesarias · sólo para esta vista previa"));
            ambiguas.forEach(g => {
                const modelo = preguntaPresentacion(g);
                const label = elemento("label", "", descripcionGrupo(g) + ". ¿Cómo quieres tratar esta reserva?");
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
        }
        const preparar = elemento("button", "libro-reserva-boton secundario", "Preparar incorporación");
        preparar.type = "button";
        const vista = elemento("div");
        preparar.addEventListener("click", async () => {
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
                const aprobar = async ids => {
                    const lista = Array.isArray(ids) ? ids : [ids];
                    lista.forEach(id => aprobados.add(id));
                    out.replaceChildren(elemento('p', '', lista.length > 1 ? 'Revalidando los pagos aprobados…' : 'Revalidando el pago aprobado…'));
                    try {
                        const nuevo = await prepararIncorporacion(result, decisiones, aprobados);
                        renderizarIncorporacion(out, nuevo, volver, aprobar, incorporar);
                    } catch (e) {
                        lista.forEach(id => aprobados.delete(id)); volver();
                        out.append(elemento('p', '', 'No se pudo revalidar: ' + e.message));
                    }
                };
                incorporar = planActual => confirmarIncorporacion(result, decisiones, aprobados, planActual);
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
            const abiertos = Array.from(out.querySelectorAll("details[open]")).map(d => d.querySelector("summary")?.textContent.replace(/ \(\d+\)$/, ""));
            const preguntasAbiertas = Boolean(out.querySelector(".haiku-reconciliacion-abierto"));
            refrescar.disabled = true; preparar.disabled = true;
            vista.replaceChildren(elemento("p", "", "Revalidando; las decisiones anteriores se descartan."));
            try {
                const nuevo = await consultar(result.q.texto);
                renderizarComparacion(out, nuevo, { preguntasAbiertas, revalidado: new Date().toLocaleTimeString("es-CL") });
                out.querySelectorAll("details").forEach(d => {
                    d.open = abiertos.includes(d.querySelector("summary")?.textContent.replace(/ \(\d+\)$/, ""));
                });
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
        for (const c of item.cambios) {
            const fila = elemento('li');
            if (c.campo === 'Notas y detalles del Libro') {
                const notas = elemento('details');
                notas.append(elemento('summary','',c.campo),elemento('p','',`Proyecto H: ${c.anterior ?? 'sin dato'}`),elemento('p','',`Libro: ${c.libro}`));
                fila.append(notas);
            } else fila.textContent = `${c.campo}: ${c.anterior ?? 'sin dato'} → ${c.libro}`;
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
        return { titular, cabana, monto, concepto, periodo, tipo, estado: etiquetasEstado[item.categoria] || "Revisar", detalle, estadias, reserva };
    }

    function renderizarItemIncorporacion(item, controles, actualizar, aprobar) {
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
        if (item.motivos.length) {
            const avisos = elemento("ul", "haiku-incorporacion-avisos");
            item.motivos.forEach(motivo => avisos.append(elemento("li", "", motivo)));
            fila.append(avisos);
        }
        if (vista.reserva?.observaciones) {
            const notas = elemento("details", "haiku-incorporacion-notas");
            notas.append(elemento("summary", "", "Ver notas y solicitudes"), elemento("p", "", vista.reserva.observaciones));
            fila.append(notas);
        }
        if (item.aprobable && aprobar) {
            const boton = elemento("button", "haiku-incorporacion-aprobar", "Aprobar este pago");
            boton.type = "button";
            boton.addEventListener("click", async () => { boton.disabled = true; await aprobar(item.id); });
            fila.append(boton);
        }
        return fila;
    }

    function renderizarResultadoIncorporacion(out, ejecucion, volver) {
        const r = ejecucion.resultado;
        out.className = "haiku-asistente-preview haiku-incorporacion";
        const cabecera = elemento("div", "haiku-incorporacion-cabecera");
        const titulo = elemento("div");
        titulo.append(elemento("span", "", "LIBRO ↔ PROYECTO H"), elemento("strong", "", "Incorporación completada"));
        cabecera.append(titulo, elemento("span", "haiku-incorporacion-modo", "Guardado"));
        const mensaje = elemento("p", "haiku-incorporacion-aviso", "Proyecto H confirmó la operación completa. El Libro original no fue modificado.");
        const resumen = elemento("div", "haiku-incorporacion-resumen");
        for (const [cantidad, etiqueta] of [
            [r.reservas_creadas || 0, "Reservas"],
            [r.estadias_agregadas || 0, "Estadías"],
            [r.pagos_creados || 0, "Pagos"],
            [r.actualizaciones || 0, "Actualizaciones del Libro"],
            [(r.omitidos || 0) + (ejecucion.omitidosAlRevalidar || 0), "Omitidos"]
        ]) {
            const tarjeta = elemento("div", "haiku-incorporacion-indicador");
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
        out.className = "haiku-asistente-preview haiku-incorporacion";
        const cabecera = elemento("div", "haiku-incorporacion-cabecera");
        const titulo = elemento("div");
        titulo.append(elemento("span", "", "LIBRO ↔ PROYECTO H"), elemento("strong", "", "Confirmar incorporación"));
        cabecera.append(titulo, elemento("span", "haiku-incorporacion-modo", "Escritura habilitada"));
        const aviso = elemento("p", "haiku-incorporacion-aviso", "El Libro de Reservas tiene prioridad. Revisa qué datos de Proyecto H serán reemplazados. Al confirmar se guardará la selección completa en una sola operación segura; los datos ausentes en el Libro se conservarán.");
        const resumen = elemento("div", "haiku-incorporacion-resumen");
        out.replaceChildren(cabecera, aviso, resumen);

        const indicadores = {};
        for (const [clave, etiqueta] of [["nuevas", "Reservas"], ["estadias", "Estadías"], ["actualizaciones", "Actualizaciones"], ["pagos", "Pagos"], ["dudosos", "Dudosos"], ["pendientes", "Pendientes"]]) {
            const tarjeta = elemento("div", "haiku-incorporacion-indicador");
            indicadores[clave] = elemento("strong", "", "0");
            tarjeta.append(indicadores[clave], elemento("span", "", etiqueta));
            resumen.append(tarjeta);
        }

        const controles = new Map();
        let confirmar = null, guardando = false, volverAComparar = false;
        const esElegible = item => !item.motivos.length && CATEGORIAS_GUARDABLES.includes(item.categoria) &&
            item.dependeDe.every(id => plan.items.find(x => x.id === id)?.seleccionado);
        const seleccionados = () => plan.items.filter(item => item.seleccionado && esElegible(item));
        const actualizar = () => {
            for (const item of plan.items) {
                const control = controles.get(item.id);
                if (!control) continue;
                const dependencia = item.dependeDe.some(id => !plan.items.find(x => x.id === id)?.seleccionado);
                const noElegible = !!item.motivos.length || dependencia || !CATEGORIAS_GUARDABLES.includes(item.categoria);
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
                confirmar.disabled = guardando || (!volverAComparar && cantidad === 0);
                if (!guardando) confirmar.textContent = volverAComparar ? "Volver a comparar con datos actuales" :
                    cantidad ? `Continuar con ${cantidad} elemento${cantidad === 1 ? "" : "s"} listo${cantidad === 1 ? "" : "s"}` : "Selecciona al menos un elemento listo";
            }
        };

        for (const [categoria, tituloSeccion] of [["nuevas", "Reservas nuevas"], ["actualizaciones", "Actualizar Proyecto H con el Libro"], ["estadias", "Estadías a añadir"], ["asociadas", "Reservas ya asociadas"], ["pagos", "Pagos preparados"], ["dudosos", "Pagos para revisar"], ["pendientes", "Casos pendientes"], ["omitidos", "Ya existe / omitido"]]) {
            const items = plan.items.filter(i => i.categoria === categoria);
            const seccion = elemento("details", `haiku-incorporacion-seccion haiku-incorporacion-seccion--${categoria}`);
            const summary = elemento("summary");
            summary.append(elemento("span", "", tituloSeccion), elemento("strong", "", String(items.length)));
            seccion.append(summary);
            const contenido = elemento("div", "haiku-incorporacion-lista");
            if (!items.length) contenido.append(elemento("p", "haiku-incorporacion-vacio", "Sin elementos en esta categoría."));
            else items.forEach(item => contenido.append(renderizarItemIncorporacion(item, controles, actualizar, aprobar)));
            seccion.append(contenido);
            out.append(seccion);
        }
        actualizar();

        const ayuda = elemento("details", "haiku-incorporacion-ayuda");
        const permisos = plan.permisos.map(p => p + " · " + (root.haikuTienePermiso?.(p) === true ? "disponible" : "por verificar"));
        ayuda.append(elemento("summary", "", "Información de la incorporación"));
        const listaAyuda = elemento("ul");
        listaAyuda.append(elemento("li", "", "Los pagos se revisan bajo el bloque del día de Check-In."));
        listaAyuda.append(elemento("li", "", "Los datos desconocidos permanecen como “sin dato”."));
        permisos.forEach(p => listaAyuda.append(elemento("li", "", `Permiso ${p}`)));
        ayuda.append(listaAyuda);
        out.append(ayuda);

        const elegiblesAhora = plan.items.filter(item => !item.motivos.length && CATEGORIAS_GUARDABLES.includes(item.categoria));
        const aprobables = plan.items.filter(item => item.categoria === "dudosos" && item.aprobable);
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
            const texto = `Se incorporarán ${nuevas} reserva(s), ${estadias} estadía(s) y ${pagos} pago(s), además de ${seleccion.filter(i => i.categoria === "actualizaciones").length} actualización(es) con los datos del Libro. Proyecto H volverá a comprobar duplicados antes de guardar. ¿Confirmas?`;
            if (typeof root.confirm === "function" && !root.confirm(texto)) return;
            guardando = true; atras.disabled = true; actualizar();
            confirmar.textContent = "Revalidando y guardando…";
            aviso.textContent = "Comprobando cambios recientes y ejecutando la incorporación completa…";
            try {
                const ejecucion = await incorporar(plan);
                await Promise.allSettled([
                    Promise.resolve().then(() => root.haikuSincronizarReservasSupabase?.()),
                    Promise.resolve().then(() => root.haikuCargarAbonosSupabase?.()),
                    Promise.resolve().then(() => root.haikuCargarSaldosCheckinSupabase?.())
                ]);
                renderizarResultadoIncorporacion(out, ejecucion, volver);
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
            else out.textContent = respuesta(result);
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
