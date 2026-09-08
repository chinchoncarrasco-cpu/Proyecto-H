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
                    efecto: exacta ? "no crea otra; sólo asocia en la vista previa para comparar pagos/servicios, sin aprobar pagos automáticamente" :
                        "conservaría la reserva actual y propondría sumar CAB/fechas, sin reemplazar la estadía existente",
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

    // Pure plan data, never an executor. References are resolved only by the future transaction.
    const ESCRITURA_LIBRO = false;
    function crearPlanIncorporacion(reservas, comp, decisiones = new Map(), aprobados = new Set(), anterior = null) {
        const plan = { escrituraHabilitada: ESCRITURA_LIBRO, items: [], permisos: [], alcance: 'Registros visibles con la sesión actual' };
        const snapshot = comp.snapshot || { estadias: [], pagos: [] };
        const add = (categoria, id, texto, payload = null, motivos = [], dependeDe = [], permisos = []) => {
            const item = { categoria, id, texto, payload, motivos, dependeDe, permisos, seleccionado: !motivos.length && ['nuevas','estadias','pagos'].includes(categoria) };
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
                    if (/^(asociar|estadia):/.test(opcion.valor)) destino = snapshot.estadias.find(s => String(s.id) === opcion.valor.slice(opcion.valor.indexOf(':') + 1));
                } else categoria = 'pendientes';
            }
            const id = 'reserva:' + g.clave;
            const titulo = descripcionGrupo(g);
            if (categoria === 'pendientes') { add(categoria, id, titulo, null, ['Elige cómo tratar esta reserva en la comparación.']); continue; }
            const existentes = g.items.filter(i => i.sistema).map(i => i.sistema.reserva_id);
            const reservaId = destino?.reserva_id || (new Set(existentes).size === 1 ? existentes[0] : null);
            if (categoria === 'asociadas') {
                if (!reservaId && g.estado !== 'asociada') { add('pendientes', id, titulo, null, ['No hay una reserva destino única.']); continue; }
                add(g.estado === 'asociada' && previa && previa.estado !== 'asociada' ? 'omitidos' : 'asociadas', id, titulo + ' · Ya existe; se conserva la reserva.', { reserva_id: reservaId, reserva_ids: [...new Set(existentes)] });
                g.items.forEach(i => destinos.set(claveReserva(i.libro), { reserva_id: destino?.reserva_id || i.sistema?.reserva_id || reservaId, dependeDe: [] }));
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
                    ninos: r.ninos ?? null, mascotas: r.mascotas ?? null, estado_estadia: 'pendiente' }, noches: r.tipo_estadia === 'full_day' ? 0 : (Date.parse(r.fecha_checkout)-Date.parse(r.fecha_checkin))/86400000,
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
            const payload = { contrato: 'reservas + reserva_estadias; requiere futura RPC transaccional', reserva_id: categoria === 'estadias' ? reservaId : null,
                reserva_ref: categoria === 'nuevas' ? id : null,
                reserva: categoria === 'nuevas' ? { titular_nombre: r.titular, titular_numero_documento: conocido('rut_documento'), titular_tipo_documento: null,
                    correo_contacto: conocido('correo'), telefono_contacto: conocido('telefono'), estado_reserva: 'pendiente',
                    observaciones: [...new Set(g.items.flatMap(i => [i.libro.texto_original, ...(i.libro.notas_importantes || [])]).filter(Boolean))].join('\n') || null } : null,
                estadias, estado_confirmacion_libro: r.estado_confirmacion || null };
            const item = add(categoria, id, titulo + (reservaId ? ' · Añadir a reserva ' + reservaId : ' · Crear una reserva con ' + estadias.length + ' estadía(s)') + ' · Estado inicial propuesto: pendiente', payload, [...new Set(motivos)], [], [categoria === 'nuevas' ? 'reservas.crear' : 'reservas.editar']);
            g.items.forEach(i => destinos.set(claveReserva(i.libro), { reserva_id: categoria === 'estadias' ? reservaId : null, reserva_ref: categoria === 'nuevas' ? id : null, dependeDe: [id], bloqueado: !!item.motivos.length }));
        }
        for (const r of reservas.map(normalizarReservaComparacion).filter(r => !esReservaValida(r))) add('pendientes', 'invalida:' + claveReserva(r), (r.titular || 'Sin titular') + ' · CAB ' + (r.cabana || 'sin dato'), null, ['Faltan titular, cabaña o fechas válidas.']);
        const vistos = [];
        for (const x of comp.pagosDetalle || []) {
            const p = x.pago, r = x.reserva, destino = destinos.get(claveReserva(r));
            const id = 'pago:' + claveReserva(r) + ':' + source(p.origen) + ':' + JSON.stringify(p);
            if (plan.items.some(i => i.id === id)) continue;
            const texto = r.titular + ' · CAB ' + r.cabana + ' · ' + money(p.monto) + ' · ' + (p.concepto || p.tipo_movimiento) + ' · Check-In ' + r.fecha_checkin;
            const duplicado = snapshot.pagos.find(v => pagoCoincide(p,v));
            if (duplicado) { add('omitidos', id, texto + ' · Ya existe un pago con este identificador (reserva ' + duplicado.reserva_id + ').'); continue; }
            const mismoMonto = snapshot.pagos.some(v => destino?.reserva_id && v.reserva_id === destino.reserva_id && Number(v.monto) === Number(p.monto) && (!v.moneda || v.moneda === p.moneda));
            const repetido = vistos.some(v => pagoCoincide(p, { ...v.pago, datos_origen: { bovtar: v.pago.bovtar } }) || (v.destino === (destino?.reserva_id || destino?.reserva_ref) && Number(v.pago.monto) === Number(p.monto) && v.pago.moneda === p.moneda));
            if (repetido) {
                for (const previo of vistos.filter(v => pagoCoincide(p, { ...v.pago, datos_origen: { bovtar: v.pago.bovtar } }))) {
                    if (previo.pago.monto !== p.monto || previo.destino !== (destino?.reserva_id || destino?.reserva_ref)) {
                        previo.item.categoria = 'dudosos'; previo.item.seleccionado = false; previo.item.motivos.push('Identificador repetido con monto o reserva diferente.'); previo.item.aprobable = false;
                    }
                }
            }
            if (mismoMonto || repetido) { add('omitidos', id, texto + ' · Omitido por posible duplicado de asociación/monto o identificador; revisar manualmente.'); continue; }
            const motivos = [];
            if (!destino || destino.bloqueado) motivos.push('Primero resuelve los datos y la asociación de la reserva.');
            if (!(Number.isSafeInteger(p.monto) && p.monto > 0)) motivos.push('Falta un monto válido.');
            if (p.moneda !== 'CLP') motivos.push('Moneda no compatible con el contrato actual.');
            if (p.fecha_bloque !== r.fecha_checkin) motivos.push('El pago no pertenece al bloque del Check-In.');
            if (p.tipo_movimiento !== 'alojamiento') motivos.push('El concepto requiere una aplicación manual.');
            if (p.pago_recibido !== true || p.estado_pago !== 'registrado_en_libro') motivos.push('El Libro no confirma un pago recibido.');
            const medio = { transferencia:'transferencia',debito:'tarjeta_debito',credito:'tarjeta_credito',efectivo:'efectivo' }[p.medio_pago];
            if (!medio) motivos.push('Falta precisar el medio de pago (Webpay crédito o débito, si corresponde).');
            const asociadoLibro = r.pagos.includes(p);
            const seguro = asociadoLibro && pagoTieneIdentificadorFuerte(p) && (x.estado === 'nuevo_seguro' || destino?.reserva_ref);
            const manual = aprobados.has(id);
            if (!seguro && !manual) motivos.push('Requiere aprobación manual de la asociación y el pago.');
            const payload = { contrato: 'haiku_registrar_pago', pendiente_contrato: ['Resolver etapa operativa sin inferir abono/saldo; conservar datos_origen en la futura transacción'], reserva_ref: destino?.reserva_ref || null,
                argumentos: { p_reserva_id: destino?.reserva_id || null, p_monto: p.monto, p_medio_pago: medio || null, p_etapa_operativa: null, p_referencia_externa: p.texto_original || null,
                    p_fecha_pago: p.fecha_comprobante || null, p_folio: p.folio || null, p_codigo_autorizacion: p.codigo_autorizacion || null,
                    p_bove: p.bove || null, p_observaciones: p.texto_original || null, p_aplicaciones: [], p_modo_aplicacion: 'alojamiento' },
                datos_origen: { bovtar: p.bovtar || null, fecha_bloque: p.fecha_bloque, origen: p.origen }, aprobado_manualmente: manual };
            if (!p.fecha_comprobante) motivos.push('Falta la fecha del comprobante; no se usa la fecha del bloque como fecha de pago.');
            const item = add(motivos.length ? 'dudosos' : 'pagos', id, texto + (destino?.reserva_ref ? ' · Asociar después de crear la reserva' : destino?.reserva_id ? ' · Reserva ' + destino.reserva_id : ''), payload, motivos, destino?.dependeDe || [], ['pagos.registrar']);
            item.aprobable = motivos.length === 1 && motivos[0] === 'Requiere aprobación manual de la asociación y el pago.';
            vistos.push({ pago:p, item, destino: destino?.reserva_id || destino?.reserva_ref });
        }
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

    root.HAIKU_LIBRO_CONSULTAS = Object.freeze({ interpretar, consultar, compararSistema, respuesta, crearPlanIncorporacion, prepararIncorporacion });
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
                const volver = () => renderizarComparacion(out, result, { decisiones, aprobados });
                const aprobar = async id => {
                    aprobados.add(id);
                    out.replaceChildren(elemento('p', '', 'Revalidando el pago aprobado…'));
                    try {
                        const nuevo = await prepararIncorporacion(result, decisiones, aprobados);
                        renderizarIncorporacion(out, nuevo, volver, aprobar);
                    } catch (e) {
                        aprobados.delete(id); volver();
                        out.append(elemento('p', '', 'No se pudo revalidar: ' + e.message));
                    }
                };
                renderizarIncorporacion(out, plan, volver, aprobar);
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

    function renderizarIncorporacion(out, plan, volver, aprobar) {
        out.replaceChildren(elemento("strong", "", "Preparar incorporación · simulación"));
        out.append(elemento("p", "", "Escritura real deshabilitada en modo de prueba"));
        const resumen = elemento("p", "haiku-asistente-preview-resumen");
        out.append(resumen);
        const controles = new Map();
        const actualizar = () => {
            for (const i of plan.items) {
                const c = controles.get(i.id); if (!c) continue;
                const dependencia = i.dependeDe.some(id => !plan.items.find(x => x.id === id)?.seleccionado);
                c.disabled = !!i.motivos.length || dependencia || !['nuevas','estadias','pagos'].includes(i.categoria);
                if (c.disabled) { c.checked = false; i.seleccionado = false; }
            }
            const n = k => plan.items.filter(i => i.categoria === k && i.seleccionado).length;
            resumen.textContent = n('nuevas') + ' reservas nuevas · ' + n('estadias') + ' elementos de estadías a añadir · ' + n('pagos') + ' pagos seguros/aprobados · ' + plan.items.filter(i=>i.categoria==='dudosos').length + ' pagos dudosos · ' + plan.items.filter(i=>i.categoria==='pendientes'||i.motivos.length && i.categoria!=='dudosos').length + ' pendientes';
        };
        for (const [k,titulo] of [['nuevas','Reservas nuevas claras'],['estadias','Estadías/cabañas a añadir'],['asociadas','Mismas reservas ya asociadas'],['pagos','Pagos nuevos seguros o aprobados'],['dudosos','Pagos dudosos/manuales'],['pendientes','Casos pendientes'],['omitidos','Ya existe / omitido']]) {
            const items = plan.items.filter(i => i.categoria === k);
            const seccion = elemento('details'); seccion.open = ['nuevas','estadias','pagos'].includes(k);
            seccion.append(elemento('summary','',titulo + ' (' + items.length + ')'));
            for (const i of items) {
                const fila = elemento('div'), label = elemento('label'), check = elemento('input');
                check.type = 'checkbox'; check.checked = i.seleccionado;
                controles.set(i.id,check);
                check.addEventListener('change',()=> { i.seleccionado=check.checked; actualizar(); });
                label.append(check,elemento('span','',i.texto)); fila.append(label);
                if (i.motivos.length) fila.append(elemento('p','',i.motivos.join(' ')));
                if (i.payload?.estadias) {
                    const r=i.payload.reserva;
                    if(r) fila.append(elemento('p','',[r.titular_nombre,'Documento: '+(r.titular_numero_documento || 'sin dato'),'Correo: '+(r.correo_contacto || 'sin dato'),'Teléfono: '+(r.telefono_contacto || 'sin dato')].join(' · ')));
                    i.payload.estadias.forEach(e=>fila.append(elemento('p','','CAB '+e.cabana_numero+' · '+e.datos.fecha_ingreso+' → '+e.datos.fecha_salida+' · '+(e.datos.tipo_estadia==='fullday'?'Full Day':e.noches+' noches')+' · Adultos: '+(e.datos.adultos??'sin dato')+' · Niños: '+(e.datos.ninos??'sin dato')+' · Mascotas: '+(e.datos.mascotas??'sin dato'))));
                    if(r?.observaciones) agregarDetalles(fila,'Notas y solicitudes',[r.observaciones]);
                }
                if (i.aprobable && aprobar) { const b=elemento('button','libro-reserva-boton secundario','Aprobar este pago para la simulación'); b.type='button'; b.addEventListener('click',()=>{ b.disabled=true; aprobar(i.id); }); fila.append(b); }
                seccion.append(fila);
            }
            out.append(seccion);
        }
        actualizar();
        agregarDetalles(out,'Permisos necesarios (sin cambios)',plan.permisos.map(p=>p+' · '+(root.haikuTienePermiso?.(p)===true?'disponible en la sesión':'por verificar/no disponible')));
        out.append(elemento('p','',plan.alcance + '. Los pagos se revisan en el bloque del día de Check-In. Los datos desconocidos permanecen sin dato.'));
        const confirmar=elemento('button','libro-reserva-boton','Confirmar incorporación'); confirmar.type='button'; confirmar.disabled=true;
        confirmar.title='Escritura real deshabilitada en modo de prueba';
        const atras=elemento('button','libro-reserva-boton secundario','Volver a la comparación'); atras.type='button'; atras.addEventListener('click',volver);
        out.append(atras,confirmar);
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
