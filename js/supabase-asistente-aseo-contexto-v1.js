// ========================================
// HAKU · ASEO POR CONTEXTO DE HUÉSPED V2
// Consultas naturales encadenadas, sólo lectura.
// - "¿Quién revisó el aseo después del check-out de Pascual Abarca?"
// - "¿Qué detalles quedaron anotados en esa revisión?"
// Proyecto H primero; Libro de Reserva sólo como respaldo.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_ASEO_CONTEXTO_V2) return;
    window.HAIKU_ASISTENTE_ASEO_CONTEXTO_V2 = true;

    const ZONA = "America/Santiago";
    const CONTEXTO_KEY = "haku_aseo_contexto_v2";
    const PREFIJOS = [
        ["jan", "ene"], ["feb"], ["mar"], ["apr", "abr"], ["may"], ["jun"],
        ["jul"], ["aug", "ago"], ["sep"], ["oct"], ["nov"], ["dec", "dic"]
    ];

    let ocupado = false;

    function elementos() {
        return {
            db: window.haikuSupabase,
            campo: document.getElementById("haiku-asistente-texto"),
            enviar: document.getElementById("haiku-asistente-enviar"),
            mensajes: document.getElementById("haiku-asistente-mensajes"),
            adjuntos: document.getElementById("haiku-asistente-adjuntos")
        };
    }

    function quitarVocativo(valor) {
        const fn = window.haikuQuitarVocativoAsistente;
        if (typeof fn === "function") return fn(valor);
        return String(valor || "").replace(/^\s*(?:asistente\s+)?haku\b\s*[,;:!¡¿?\-–—]*\s*/i, "");
    }

    function norm(valor) {
        return quitarVocativo(valor)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function normNombre(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function hoyChile() {
        const p = Object.fromEntries(
            new Intl.DateTimeFormat("en-CA", {
                timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit"
            }).formatToParts(new Date())
                .filter(x => x.type !== "literal")
                .map(x => [x.type, x.value])
        );
        return `${p.year}-${p.month}-${p.day}`;
    }

    function fechaVisible(valor) {
        const m = String(valor || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : (String(valor || "") || "—");
    }

    function fechaIsoDesdeVisible(valor) {
        const s = String(valor || "").trim();
        let m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? s : null;
    }

    function valorLibro(valor) {
        const s = String(valor || "").trim();
        return !s || /^(?:\?|\-\s*|sin dato)$/i.test(s) ? null : s;
    }

    function nombreCheckout(valor) {
        const original = quitarVocativo(String(valor || ""));
        const patrones = [
            /despu[eé]s\s+(?:del|de)\s+(?:check\s*-?\s*out|checkout|checked\s*out)\s+de\s+(.+?)(?=[?.!,;]|$)/i,
            /tras\s+(?:el\s+)?(?:check\s*-?\s*out|checkout|checked\s*out)\s+de\s+(.+?)(?=[?.!,;]|$)/i,
            /despu[eé]s\s+de\s+que\s+(.+?)\s+(?:hizo|realiz[oó]|complet[oó])\s+(?:el\s+)?(?:check\s*-?\s*out|checkout|checked\s*out)(?=[?.!,;]|$)/i
        ];
        for (const patron of patrones) {
            const m = original.match(patron);
            if (m?.[1]) return m[1].replace(/[*_]/g, "").trim();
        }
        return null;
    }

    function tipoConsulta(valor) {
        const t = norm(valor);
        if (!t) return null;
        if (/\b(?:marca|marcar|cambia|cambiar|pon|poner|crea|crear|agrega|agregar|registra|registrar|elimina|eliminar|borra|borrar|actualiza|actualizar)\b/.test(t)) return null;

        const seguimiento =
            /\b(?:detalles?|observaciones?|notas?|anotad[oa]s?|quedo|quedaron)\b/.test(t) &&
            /\b(?:esa|ese|esta|este)\s+(?:revision|aseo|limpieza|cabana|dia)\b/.test(t);
        if (seguimiento) return "seguimiento_detalles";

        const preguntaRevisor = /\b(?:quien|quienes)\b/.test(t) && /\b(?:reviso|revision|revisor)\b/.test(t);
        const contextoAseo = /\b(?:aseo|limpieza|alojamiento|cabana)\b/.test(t);
        const despuesCheckout =
            /\b(?:despues|tras)\b.{0,28}\b(?:check\s*-?\s*out|checkout|checked\s*out)\b/.test(t) ||
            /\b(?:check\s*-?\s*out|checkout|checked\s*out)\b.{0,35}\b(?:despues|posterior)\b/.test(t);

        return preguntaRevisor && contextoAseo && despuesCheckout && nombreCheckout(valor)
            ? "revision_post_checkout"
            : null;
    }

    function filaReserva(estadia) {
        return Array.isArray(estadia?.reservas) ? estadia.reservas[0] : estadia?.reservas;
    }

    function estadiaValida(estadia) {
        const s = norm(`${estadia?.estado_estadia || ""} ${filaReserva(estadia)?.estado_reserva || ""}`);
        return !/\b(?:cancelad|anulad|no show|noshow)\b/.test(s);
    }

    async function buscarEstadiaPorTitular(db, nombre) {
        const buscado = normNombre(nombre);
        if (!buscado) return { estadia: null, ambiguo: false };

        const termino = String(nombre || "").trim().replace(/[%_]/g, "");
        let { data: reservas, error } = await db
            .from("reservas")
            .select("id,titular_nombre,estado_reserva")
            .ilike("titular_nombre", `%${termino}%`)
            .limit(30);
        if (error) throw error;
        reservas = Array.isArray(reservas) ? reservas : [];
        if (!reservas.length) return { estadia: null, ambiguo: false };

        const exactas = reservas.filter(r => normNombre(r?.titular_nombre) === buscado);
        const candidatas = exactas.length ? exactas : reservas.filter(r => {
            const n = normNombre(r?.titular_nombre);
            return n && (n.includes(buscado) || buscado.includes(n));
        });
        const nombres = [...new Set(candidatas.map(r => normNombre(r?.titular_nombre)).filter(Boolean))];
        if (!exactas.length && nombres.length > 1) return { estadia: null, ambiguo: true };
        if (!candidatas.length) return { estadia: null, ambiguo: false };

        const { data: estadias, error: e2 } = await db
            .from("reserva_estadias")
            .select("id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia,checkout_realizado_en,reservas(titular_nombre,estado_reserva)")
            .in("reserva_id", candidatas.map(r => r.id).filter(Boolean))
            .order("fecha_salida", { ascending: false })
            .limit(80);
        if (e2) throw e2;

        const hoy = hoyChile();
        const validas = (estadias || [])
            .filter(estadiaValida)
            .filter(e => e?.fecha_salida && e.fecha_salida <= hoy)
            .sort((a, b) => String(b.fecha_salida).localeCompare(String(a.fecha_salida)) || String(b.fecha_ingreso).localeCompare(String(a.fecha_ingreso)));
        return { estadia: validas[0] || null, ambiguo: false };
    }

    async function cabanaPorId(db, id) {
        const { data, error } = await db.from("cabanas").select("id,numero,nombre").eq("id", id).maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function cabanaPorNumero(db, numero) {
        const { data, error } = await db.from("cabanas").select("id,numero,nombre").eq("numero", numero).maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function aseoProyecto(db, fecha, cabanaId) {
        const { data, error } = await db.from("aseos")
            .select("id,fecha,cabana_id,tipo_aseo,estado,encargado_nombre,revisor_nombre,iniciado_en,completado_en,observaciones")
            .eq("fecha", fecha).eq("cabana_id", cabanaId)
            .order("actualizado_en", { ascending: false }).limit(1).maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function revisionProyecto(db, fecha, cabanaId, tipo) {
        let q = db.from("revisiones_cabana")
            .select("id,fecha,cabana_id,tipo_revision,estado,resultado,observaciones,revisado_por,iniciado_en,finalizado_en")
            .eq("fecha", fecha).eq("cabana_id", cabanaId).neq("estado", "cancelada");
        if (tipo) q = q.eq("tipo_revision", tipo);
        const { data, error } = await q.order("creado_en", { ascending: false }).limit(1).maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function itemsRevision(db, revisionId) {
        if (!revisionId) return [];
        const { data, error } = await db.from("revision_items")
            .select("estado,observacion,cantidad_esperada,cantidad_encontrada,checklist_items(nombre,categoria,criticidad)")
            .eq("revision_id", revisionId).order("creado_en", { ascending: true });
        if (error) throw error;
        return data || [];
    }

    async function solicitudesProyecto(db, fecha, cabanaId) {
        const { data, error } = await db.from("solicitudes")
            .select("categoria,descripcion,prioridad,estado,observacion_cierre")
            .eq("fecha_operativa", fecha).eq("cabana_id", cabanaId).neq("estado", "cancelada")
            .order("creado_en", { ascending: true });
        if (error) throw error;
        return data || [];
    }

    function hojaFecha(api, fecha) {
        const m = String(fecha || "").match(/^(\d{4})-(\d{2})-/);
        if (!m) return null;
        const yy = m[1].slice(2), prefs = PREFIJOS[Number(m[2]) - 1] || [];
        return (api.listarHojas?.() || []).find(nombre => {
            const s = normNombre(nombre).replace(/\s/g, "");
            return prefs.some(p => s === `${p}${yy}` || s.startsWith(`${p}${yy}`));
        }) || null;
    }

    async function aseoLibro(fecha, numero) {
        const api = window.HAIKU_LIBRO_RESERVA_V1;
        if (!api?.consultarHoja || !api?.listarHojas) return null;
        const hoja = hojaFecha(api, fecha);
        if (!hoja) return null;
        try {
            const datos = await api.consultarHoja(hoja);
            const fila = (datos?.aseos || []).find(a => String(a.fecha) === fecha && Number(a.cabana) === Number(numero));
            return fila ? { ...fila, hoja } : null;
        } catch (_) {
            return null;
        }
    }

    function agregarMensaje(mensajes, tipo, texto, extra = "") {
        const div = document.createElement("div");
        div.className = `haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}${extra ? ` ${extra}` : ""}`;
        div.textContent = texto;
        mensajes.appendChild(div);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
        return div;
    }

    function dato(etiqueta, valor) {
        const d = document.createElement("div");
        d.className = "haku-aseo-dato";
        const span = document.createElement("span"); span.textContent = etiqueta;
        const strong = document.createElement("strong"); strong.textContent = valor || "Sin dato";
        d.append(span, strong); return d;
    }

    function guardarContexto(ctx) {
        try { sessionStorage.setItem(CONTEXTO_KEY, JSON.stringify({ ...ctx, guardadoEn: Date.now() })); } catch (_) {}
    }

    function contextoDesdeDom(mensajes) {
        const cards = [...mensajes.querySelectorAll('[data-haku-aseo-contexto="1"]')];
        const card = cards.at(-1);
        if (!card) return null;
        const chips = [...card.querySelectorAll(".haku-aseo-chip")].map(x => x.textContent.trim());
        const cab = Number(chips.find(x => /^CAB\s+\d+/i.test(x))?.match(/\d+/)?.[0] || 0);
        const fecha = fechaIsoDesdeVisible(chips.find(x => /^\d{2}-\d{2}-\d{4}$/.test(x)) || "");
        const huesped = card.querySelector(".haku-aseo-dato strong")?.textContent?.trim() || null;
        return cab && fecha ? { numero: cab, fecha, nombre: huesped } : null;
    }

    function leerContexto(mensajes) {
        try {
            const x = JSON.parse(sessionStorage.getItem(CONTEXTO_KEY) || "null");
            if (x?.numero && x?.fecha) return x;
        } catch (_) {}
        return contextoDesdeDom(mensajes);
    }

    function renderResultado(mensajes, info) {
        const { nombre, numero, fecha, revisor, fuente, ingreso, salida } = info;
        const card = document.createElement("div");
        card.className = `haku-aseo-card${fuente.startsWith("Libro") ? " haku-aseo-card--libro" : ""}`;
        card.dataset.hakuAseoContexto = "1";
        card.dataset.cabana = String(numero);
        card.dataset.fecha = fecha;

        const head = document.createElement("div"); head.className = "haku-aseo-head";
        const izq = document.createElement("div");
        const kicker = document.createElement("div"); kicker.className = "haku-aseo-kicker"; kicker.textContent = "CONSULTA · SÓLO LECTURA";
        const title = document.createElement("h3"); title.className = "haku-aseo-title"; title.textContent = "Revisión de aseo posterior al check-out";
        izq.append(kicker, title);
        const badge = document.createElement("span"); badge.className = "haku-aseo-badge"; badge.textContent = fuente;
        head.append(izq, badge);

        const chips = document.createElement("div"); chips.className = "haku-aseo-resumen";
        for (const txt of [`CAB ${numero}`, fechaVisible(fecha)]) {
            const c = document.createElement("span"); c.className = "haku-aseo-chip"; c.textContent = txt; chips.appendChild(c);
        }

        const grid = document.createElement("div"); grid.className = "haku-aseo-grid";
        grid.append(dato("Huésped de salida", nombre), dato("Estadía", `${fechaVisible(ingreso)} → ${fechaVisible(salida)}`), dato("Revisó el aseo", revisor));

        const pie = document.createElement("div"); pie.className = "haku-aseo-pie";
        pie.textContent = fuente.startsWith("Proyecto H")
            ? `Haku identificó automáticamente la CAB ${numero} y el ${fechaVisible(fecha)} desde la estadía de ${nombre}. Proyecto H respondió la pregunta, por lo que no fue necesario consultar el Libro.`
            : `Haku identificó automáticamente la CAB ${numero} y el ${fechaVisible(fecha)} desde la estadía de ${nombre}. Proyecto H no tenía quién revisó el aseo y se usó el Libro de Reserva como respaldo.`;
        card.append(head, chips, grid, pie);
        mensajes.appendChild(card);
        guardarContexto({ nombre, numero, fecha, ingreso, salida, revisor, fuente });
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
    }

    function textoItemRevision(item) {
        const ci = Array.isArray(item?.checklist_items) ? item.checklist_items[0] : item?.checklist_items;
        const nombre = ci?.nombre || "Ítem de checklist";
        const partes = [nombre];
        if (item?.estado) partes.push(item.estado);
        if (item?.observacion) partes.push(item.observacion);
        if (item?.cantidad_esperada != null && item?.cantidad_encontrada != null && Number(item.cantidad_esperada) !== Number(item.cantidad_encontrada)) {
            partes.push(`esperado ${item.cantidad_esperada}, encontrado ${item.cantidad_encontrada}`);
        }
        return partes.join(" · ");
    }

    function renderDetalles(mensajes, ctx, detalles, fuente) {
        const libro = fuente.startsWith("Libro");
        const card = document.createElement("div");
        card.className = `haku-aseo-card${libro ? " haku-aseo-card--libro" : ""}`;
        card.dataset.hakuAseoContexto = "1";
        card.dataset.cabana = String(ctx.numero);
        card.dataset.fecha = ctx.fecha;

        const head = document.createElement("div"); head.className = "haku-aseo-head";
        const izq = document.createElement("div");
        const kicker = document.createElement("div"); kicker.className = "haku-aseo-kicker"; kicker.textContent = "SEGUIMIENTO · SÓLO LECTURA";
        const title = document.createElement("h3"); title.className = "haku-aseo-title"; title.textContent = "Detalles de esa revisión";
        izq.append(kicker, title);
        const badge = document.createElement("span"); badge.className = "haku-aseo-badge"; badge.textContent = fuente;
        head.append(izq, badge);

        const chips = document.createElement("div"); chips.className = "haku-aseo-resumen";
        for (const txt of [`CAB ${ctx.numero}`, fechaVisible(ctx.fecha), ctx.nombre || "Contexto anterior"]) {
            const c = document.createElement("span"); c.className = "haku-aseo-chip"; c.textContent = txt; chips.appendChild(c);
        }
        card.append(head, chips);

        if (detalles.length) {
            const sec = document.createElement("div"); sec.className = "haku-aseo-seccion";
            const h4 = document.createElement("h4"); h4.textContent = "Información registrada";
            const ul = document.createElement("ul"); ul.className = "haku-aseo-lista";
            detalles.forEach(x => { const li = document.createElement("li"); li.textContent = x; ul.appendChild(li); });
            sec.append(h4, ul); card.appendChild(sec);
        } else {
            const nota = document.createElement("div"); nota.className = "haku-aseo-nota"; nota.textContent = "No encontré detalles adicionales anotados para esa revisión."; card.appendChild(nota);
        }

        const pie = document.createElement("div"); pie.className = "haku-aseo-pie";
        pie.textContent = libro
            ? "Proyecto H no tenía detalles suficientes; Haku usó el Libro de Reserva como respaldo manteniendo la CAB y fecha de la conversación anterior."
            : "Haku reutilizó automáticamente la CAB y la fecha de la consulta anterior. Proyecto H fue la fuente primaria.";
        card.appendChild(pie);
        mensajes.appendChild(card);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
    }

    async function consultarRevisionPostCheckout(textoUsuario) {
        const { db, campo, enviar, mensajes } = elementos();
        const nombre = nombreCheckout(textoUsuario);
        if (!db || !campo || !enviar || !mensajes || !nombre || ocupado) return;

        ocupado = true; enviar.disabled = true; campo.disabled = true;
        agregarMensaje(mensajes, "usuario", textoUsuario); campo.value = "";
        const estado = agregarMensaje(mensajes, "asistente", `Buscando la estadía de ${nombre} y la revisión de aseo posterior a su check-out…`, "haiku-asistente-mensaje--procesando");
        try {
            const hallazgo = await buscarEstadiaPorTitular(db, nombre);
            if (hallazgo.ambiguo) {
                estado.classList.remove("haiku-asistente-mensaje--procesando");
                estado.textContent = `Encontré más de un huésped parecido a “${nombre}”. Indícame el nombre completo para no asociar el aseo a la persona equivocada.`;
                return;
            }
            const estadia = hallazgo.estadia;
            if (!estadia) {
                estado.classList.remove("haiku-asistente-mensaje--procesando");
                estado.textContent = `No encontré una estadía finalizada de “${nombre}” en Proyecto H.`;
                return;
            }
            const cabana = await cabanaPorId(db, estadia.cabana_id);
            if (!cabana?.numero) throw new Error("No pude identificar la cabaña de esa estadía");
            const fecha = estadia.fecha_salida;
            const aseo = await aseoProyecto(db, fecha, cabana.id);
            let revisor = String(aseo?.revisor_nombre || "").trim() || null;
            let fuente = "Proyecto H";
            if (!revisor) {
                const libro = await aseoLibro(fecha, cabana.numero);
                revisor = valorLibro(libro?.revisado_por);
                if (revisor) fuente = "Libro de Reserva · respaldo";
            }
            estado.remove();
            if (!revisor) {
                agregarMensaje(mensajes, "asistente", `Identifiqué CAB ${cabana.numero} y el ${fechaVisible(fecha)} desde la estadía de ${filaReserva(estadia)?.titular_nombre || nombre}, pero no encontré quién revisó ese aseo ni en Proyecto H ni en el Libro disponible.`);
                guardarContexto({ nombre: filaReserva(estadia)?.titular_nombre || nombre, numero: cabana.numero, fecha, ingreso: estadia.fecha_ingreso, salida: estadia.fecha_salida });
                return;
            }
            renderResultado(mensajes, {
                nombre: filaReserva(estadia)?.titular_nombre || nombre,
                numero: cabana.numero, fecha, revisor, fuente,
                ingreso: estadia.fecha_ingreso, salida: estadia.fecha_salida
            });
        } finally {
            ocupado = false; enviar.disabled = false; campo.disabled = false;
            campo.dispatchEvent(new Event("input", { bubbles: true })); campo.focus();
        }
    }

    async function consultarSeguimiento(textoUsuario) {
        const { db, campo, enviar, mensajes } = elementos();
        if (!db || !campo || !enviar || !mensajes || ocupado) return;
        const ctx = leerContexto(mensajes);

        ocupado = true; enviar.disabled = true; campo.disabled = true;
        agregarMensaje(mensajes, "usuario", textoUsuario); campo.value = "";
        if (!ctx?.numero || !ctx?.fecha) {
            agregarMensaje(mensajes, "asistente", "No tengo una revisión de aseo anterior suficientemente clara para saber a qué te refieres con “esa revisión”. Pregúntame primero por una CAB/fecha o por el check-out de un huésped.");
            ocupado = false; enviar.disabled = false; campo.disabled = false; campo.focus(); return;
        }

        const estado = agregarMensaje(mensajes, "asistente", `Revisando los detalles registrados para CAB ${ctx.numero} el ${fechaVisible(ctx.fecha)}…`, "haiku-asistente-mensaje--procesando");
        try {
            const cabana = await cabanaPorNumero(db, ctx.numero);
            if (!cabana?.id) throw new Error(`No encontré la CAB ${ctx.numero}`);
            const [rev, exp, aseo, solicitudes] = await Promise.all([
                revisionProyecto(db, ctx.fecha, cabana.id, "completa"),
                revisionProyecto(db, ctx.fecha, cabana.id, "aseo_express"),
                aseoProyecto(db, ctx.fecha, cabana.id),
                solicitudesProyecto(db, ctx.fecha, cabana.id)
            ]);
            const [itemsRev, itemsExp] = await Promise.all([itemsRevision(db, rev?.id), itemsRevision(db, exp?.id)]);
            const detalles = [];
            if (rev?.observaciones) detalles.push(`Revisión completa: ${rev.observaciones}`);
            itemsRev.filter(x => norm(x?.estado) !== "ok" || String(x?.observacion || "").trim()).forEach(x => detalles.push(`Checklist: ${textoItemRevision(x)}`));
            if (exp?.observaciones) detalles.push(`Aseo Express: ${exp.observaciones}`);
            itemsExp.filter(x => norm(x?.estado) !== "ok" || String(x?.observacion || "").trim()).forEach(x => detalles.push(`Aseo Express: ${textoItemRevision(x)}`));
            if (aseo?.observaciones) detalles.push(`Aseo: ${aseo.observaciones}`);
            for (const s of solicitudes || []) {
                if (s?.descripcion) detalles.push(`${s.categoria || "Solicitud"}: ${s.descripcion}${s.estado ? ` · ${s.estado}` : ""}${s.observacion_cierre ? ` · ${s.observacion_cierre}` : ""}`);
            }
            estado.remove();
            if (detalles.length) {
                renderDetalles(mensajes, ctx, detalles, "Proyecto H");
                return;
            }
            const libro = await aseoLibro(ctx.fecha, ctx.numero);
            const textoLibro = valorLibro(libro?.texto_original);
            renderDetalles(mensajes, ctx, textoLibro ? [textoLibro] : [], textoLibro ? "Libro de Reserva · respaldo" : "Proyecto H");
        } finally {
            ocupado = false; enviar.disabled = false; campo.disabled = false;
            campo.dispatchEvent(new Event("input", { bubbles: true })); campo.focus();
        }
    }

    async function procesar(texto) {
        const tipo = tipoConsulta(texto);
        if (tipo === "revision_post_checkout") return consultarRevisionPostCheckout(texto);
        if (tipo === "seguimiento_detalles") return consultarSeguimiento(texto);
    }

    function intentarInterceptar(evento) {
        if (ocupado) return;
        const { campo, adjuntos } = elementos();
        if (!campo || adjuntos?.querySelector(".haiku-asistente-adjunto")) return;
        const texto = String(campo.value || "").trim();
        if (!tipoConsulta(texto)) return;
        evento.preventDefault(); evento.stopImmediatePropagation(); procesar(texto);
    }

    document.addEventListener("click", evento => {
        if (!evento.target?.closest?.("#haiku-asistente-enviar")) return;
        intentarInterceptar(evento);
    }, true);

    document.addEventListener("keydown", evento => {
        if (!(evento.ctrlKey || evento.metaKey) || evento.key !== "Enter") return;
        if (evento.target?.id !== "haiku-asistente-texto") return;
        intentarInterceptar(evento);
    }, true);

    window.HAIKU_ASISTENTE_ASEO_CONTEXTO_V1 = Object.freeze({
        activo: true,
        version: 2,
        tipoConsulta,
        procesar,
        leerContexto
    });

    console.info("HAKU · Aseo por contexto V2 preparado: admite preguntas de seguimiento como “esa revisión”.");
})();