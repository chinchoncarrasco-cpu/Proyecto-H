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
            comparar: /compara|sistema|supabase|proyecto h|calendario/.test(t),
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
        if (q.cabana && Number(r?.cabana) !== Number(q.cabana)) return false;
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
            pregunta = categoria === "posible_cambio_cabana" ? "¿Se cambió de cabaña o es una estadía adicional?" :
                categoria === "modificacion_titular" ? "¿Cambió el titular o son reservas independientes?" :
                categoria === "modificacion_fechas_o_independiente" ? "¿Se modificaron las fechas o es una reserva independiente?" :
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
        return Boolean(normalizarId(p?.codigo_autorizacion) || (normalizarId(p?.folio) && normalizarId(p?.bovtar)) || normalizarId(p?.bove));
    }

    function pagoCoincide(p, x) {
        if (p.codigo_autorizacion && normalizarId(x.codigo_autorizacion) === normalizarId(p.codigo_autorizacion)) return true;
        if (p.folio && p.bovtar && normalizarId(x.folio) === normalizarId(p.folio) && normalizarId(x.datos_origen?.bovtar) === normalizarId(p.bovtar)) return true;
        if (p.bove && normalizarId(x.bove) === normalizarId(p.bove)) return true;
        return false;
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
            .select("id,reserva_id,fecha_ingreso,fecha_salida,estado_estadia,tipo_estadia,cabanas(numero),reservas(id,grupo_reserva_id,titular_nombre,titular_numero_documento,correo_contacto,telefono_contacto,estado_reserva)"));

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
            tipo_estadia: e.tipo_estadia
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
            .select("id,reserva_id,monto,moneda,estado,folio,codigo_autorizacion,bove,datos_origen"));
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
                    if (p.bove && String(x.bove || "") !== p.bove) {
                        diferenciasPago.push("BOVE diferente");
                        result.diferencias.push("BOVE diferente en un pago del Libro.");
                    }
                    result.pagosComparacion.push({ estado: diferenciasPago.length ? "diferente" : "en_sistema", pago: p, sistema: x, reserva: r, diferencias: diferenciasPago });
                } else if (pagoTieneIdentificadorFuerte(p) && candidatos.length === 0 && Number(p.monto) > 0 && p.tipo_movimiento !== "penalidad") {
                    result.pagosComparacion.push({ estado: "nuevo_seguro", pago: p, reserva: r });
                } else {
                    result.pagosComparacion.push({ estado: "revisar", pago: p, reserva: r });
                }
            }

            for (const p of r.pagos_sin_asociacion) {
                result.pagosComparacion.push({ estado: "revisar", pago: p, reserva: r });
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
            if (x.estado === "nuevo_seguro" && movimientos.some(y => y !== x && pagoCoincide(x.pago, { ...y.pago, datos_origen: { bovtar: y.pago.bovtar } }))) x.estado = "revisar";
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

    async function consultar(texto, libro = root.HAIKU_LIBRO_RESERVA_V1, cliente = root.haikuSupabase) {
        if (!libro) throw new Error("Abre Libro de Reserva y carga un XLSX primero.");
        await libro.listo();
        const estado = libro.estado(), hojas = libro.listarHojas();
        if (!estado.cargado) throw new Error("Carga primero un XLSX en Libro de Reserva.");
        const q = interpretar(texto, hojas);
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

        if (q.nombre && !q.desde && libro.buscarHojas) {
            const matches = await libro.buscarHojas(q.nombre);
            q.hojas = q.hojas.filter(h => matches.hojas.includes(h));
        }

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
                resultado.cambios.push(...S.compararVersiones(old, data).filter(c =>
                    (!c.actual && !c.anterior) ||
                    (c.actual && filtrar(c.actual, q)) ||
                    (c.anterior && filtrar(c.anterior, q))
                ));
            }
        }

        if (q.nombre) {
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
            pagosFaltan.forEach(x => lines.push(`• ${x.reserva.titular} · ${x.pago.tipo_movimiento} · ${money(x.pago.monto)}`));
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
        if (q.comparar) return respuestaComparacion(result);

        const lines = [
            `LIBRO · SÓLO LECTURA · ${result.archivo}`,
            q.desde ? `Consulta: ${q.desde} al ${q.hasta}${q.cabana ? ` · CAB ${q.cabana}` : ""}` : "Búsqueda por titular."
        ];
        if (q.escribir) lines.push("Esta etapa sólo lee y compara. No crearé reservas, pagos ni servicios desde el Libro; primero debemos validar su interpretación.");

        if (q.versiones) {
            lines.push(`${result.cambios.length} diferencias detectadas en el intervalo.`);
            for (const c of result.cambios) {
                lines.push(`${c.tipo}: ${c.actual?.titular || c.anterior?.titular || c.detalle} · ${(c.campos || []).join(", ")} · ${source(c.actual?.coordenadas_origen || c.anterior?.coordenadas_origen)}`);
            }
            lines.push("Que una reserva ya no aparezca no prueba una cancelación: puede haberse movido o cambiado de titular.");
        } else if (q.libres) {
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

    root.HAIKU_LIBRO_CONSULTAS = Object.freeze({ interpretar, consultar, compararSistema, respuesta });
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
                pagosFaltan.map(x => `${x.reserva.titular} · ${x.pago.tipo_movimiento} · ${money(x.pago.monto)}`),
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
        const decisiones = new Map();
        if (ambiguas.length) {
            const preguntas = elemento("div", "haiku-asistente-preview-lista" + (ui.preguntasAbiertas ? " haiku-reconciliacion-abierto" : ""));
            preguntas.append(elemento("strong", "", "Preguntas necesarias · sólo para esta vista previa"));
            ambiguas.forEach(g => {
                const label = elemento("label", "", descripcionGrupo(g) + ". " + g.pregunta);
                label.style.display = "block";
                const select = elemento("select");
                select.append(new Option("Pendiente: no incorporar", ""), new Option("Es una reserva independiente", "independiente"));
                const candidatos = new Map(g.items.flatMap(x => [x.sistema, ...(x.candidatosDetalle || [])]).filter(Boolean).map(x => [x.id, x]));
                candidatos.forEach(x => {
                    const detalle = x.titular + " · CAB " + x.cabana + " · " + x.fecha_checkin + " → " + x.fecha_checkout;
                    const pendientes = g.items.filter(i => i.estado !== "asociada" && i.candidatosDetalle?.some(c => c.id === x.id));
                    if (pendientes.some(i => mismasFechas(i.libro, x) && Number(i.libro.cabana) === Number(x.cabana) && identidad(i.libro, x).compatible)) {
                        select.append(new Option("Revisar asociación existente: " + detalle, "asociar:" + x.id));
                        return;
                    }
                    if (pendientes.length) select.append(new Option("Modificar: " + detalle, "modificar:" + x.id));
                    const faltanEstadias = pendientes.filter(i => identidad(i.libro, x).compatible &&
                        !g.items.some(j => j.sistema && j.sistema.reserva_id === x.reserva_id && mismasFechas(i.libro, j.sistema) && Number(i.libro.cabana) === Number(j.sistema.cabana)));
                    if (faltanEstadias.length) select.append(new Option("Añadir estadía a: " + detalle, "estadia:" + x.id));
                });
                select.addEventListener("change", () => decisiones.set(g.clave, select.options[select.selectedIndex].text));
                label.append(select); preguntas.append(label);
            });
            out.append(preguntas);
        }
        const preparar = elemento("button", "libro-reserva-boton secundario", "Preparar vista previa");
        preparar.type = "button";
        const vista = elemento("div");
        preparar.addEventListener("click", () => {
            vista.replaceChildren();
            agregarLista(vista, "Propuestas para revisión · escritura deshabilitada", [
                ...faltantes.map(g => "Nueva reserva propuesta: " + descripcionGrupo(g)),
                ...ambiguas.map(g => descripcionGrupo(g) + " · " + (decisiones.get(g.clave) || "Pendiente: no incorporar")),
                ...pagosFaltan.map(x => "Pago propuesto: " + x.reserva.titular + " · " + money(x.pago.monto))
            ]);
            vista.append(elemento("p", "", "Estas decisiones no autorizan escrituras. Antes de una futura incorporación será obligatorio consultar de nuevo Proyecto H, resolver conflictos y revalidar identificadores de pagos."));
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
            if (result.q.comparar) renderizarComparacion(out, result);
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
