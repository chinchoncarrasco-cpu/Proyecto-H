// ========================================
// HAKU · ASEO POR CONTEXTO DE HUÉSPED V1
// Permite consultas naturales como:
// "Haku, ¿quién revisó el aseo después del check-out de Pascual Abarca?"
// Resuelve huésped -> estadía -> cabaña -> fecha de salida -> revisión de aseo.
// Proyecto H es fuente primaria; Libro de Reserva sólo se consulta como respaldo.
// Sólo lectura.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_ASEO_CONTEXTO_V1) return;
    window.HAIKU_ASISTENTE_ASEO_CONTEXTO_V1 = true;

    const ZONA = "America/Santiago";
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
        const partes = Object.fromEntries(
            new Intl.DateTimeFormat("en-CA", {
                timeZone: ZONA,
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).formatToParts(new Date())
                .filter(x => x.type !== "literal")
                .map(x => [x.type, x.value])
        );
        return `${partes.year}-${partes.month}-${partes.day}`;
    }

    function fechaVisible(valor) {
        const m = String(valor || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : (String(valor || "") || "—");
    }

    function valorLibro(valor) {
        const s = String(valor || "").trim();
        return !s || /^(?:\?|\-\s*|sin dato)$/i.test(s) ? null : s;
    }

    function esConsulta(valor) {
        const t = norm(valor);
        if (!t) return false;
        if (/\b(?:marca|marcar|cambia|cambiar|pon|poner|crea|crear|agrega|agregar|registra|registrar|elimina|eliminar|borra|borrar|actualiza|actualizar)\b/.test(t)) return false;

        const preguntaRevisor = /\b(?:quien|quienes)\b/.test(t) && /\b(?:reviso|revision|revisor)\b/.test(t);
        const contextoAseo = /\b(?:aseo|limpieza|alojamiento|cabana)\b/.test(t);
        const despuesCheckout = /\b(?:despues|tras)\b.{0,28}\b(?:check\s*-?\s*out|checkout|checked\s*out)\b/.test(t) ||
            /\b(?:check\s*-?\s*out|checkout|checked\s*out)\b.{0,35}\b(?:despues|posterior)\b/.test(t);

        return preguntaRevisor && contextoAseo && despuesCheckout && Boolean(nombreCheckout(valor));
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
        let candidatas = exactas.length ? exactas : reservas.filter(r => {
            const n = normNombre(r?.titular_nombre);
            return n && (n.includes(buscado) || buscado.includes(n));
        });

        const nombresUnicos = [...new Set(candidatas.map(r => normNombre(r?.titular_nombre)).filter(Boolean))];
        if (!exactas.length && nombresUnicos.length > 1) {
            return { estadia: null, ambiguo: true, candidatos: candidatas.map(r => r.titular_nombre) };
        }
        if (!candidatas.length) return { estadia: null, ambiguo: false };

        const ids = candidatas.map(r => r.id).filter(Boolean);
        const { data: estadias, error: errorEstadias } = await db
            .from("reserva_estadias")
            .select("id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia,checkout_realizado_en,reservas(titular_nombre,estado_reserva)")
            .in("reserva_id", ids)
            .order("fecha_salida", { ascending: false })
            .limit(80);
        if (errorEstadias) throw errorEstadias;

        const hoy = hoyChile();
        const validas = (estadias || [])
            .filter(estadiaValida)
            .filter(e => e?.fecha_salida && e.fecha_salida <= hoy)
            .sort((a, b) => String(b.fecha_salida).localeCompare(String(a.fecha_salida)) || String(b.fecha_ingreso).localeCompare(String(a.fecha_ingreso)));

        return { estadia: validas[0] || null, ambiguo: false };
    }

    async function cabanaPorId(db, id) {
        if (!id) return null;
        const { data, error } = await db.from("cabanas").select("id,numero,nombre").eq("id", id).maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function aseoProyecto(db, fecha, cabanaId) {
        const { data, error } = await db
            .from("aseos")
            .select("id,fecha,cabana_id,tipo_aseo,estado,encargado_nombre,revisor_nombre,iniciado_en,completado_en,observaciones")
            .eq("fecha", fecha)
            .eq("cabana_id", cabanaId)
            .order("actualizado_en", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    function hojaFecha(api, fecha) {
        const m = String(fecha || "").match(/^(\d{4})-(\d{2})-/);
        if (!m) return null;
        const yy = m[1].slice(2);
        const prefs = PREFIJOS[Number(m[2]) - 1] || [];
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
        const span = document.createElement("span");
        span.textContent = etiqueta;
        const strong = document.createElement("strong");
        strong.textContent = valor || "Sin dato";
        d.append(span, strong);
        return d;
    }

    function renderResultado(mensajes, { nombre, numero, fecha, revisor, fuente, ingreso, salida }) {
        const card = document.createElement("div");
        card.className = `haku-aseo-card${fuente.startsWith("Libro") ? " haku-aseo-card--libro" : ""}`;
        card.dataset.hakuAseoContexto = "1";

        const head = document.createElement("div");
        head.className = "haku-aseo-head";
        const izq = document.createElement("div");
        const kicker = document.createElement("div");
        kicker.className = "haku-aseo-kicker";
        kicker.textContent = "CONSULTA · SÓLO LECTURA";
        const title = document.createElement("h3");
        title.className = "haku-aseo-title";
        title.textContent = "Revisión de aseo posterior al check-out";
        izq.append(kicker, title);
        const badge = document.createElement("span");
        badge.className = "haku-aseo-badge";
        badge.textContent = fuente;
        head.append(izq, badge);

        const chips = document.createElement("div");
        chips.className = "haku-aseo-resumen";
        const chipCab = document.createElement("span");
        chipCab.className = "haku-aseo-chip";
        chipCab.textContent = `CAB ${numero}`;
        const chipFecha = document.createElement("span");
        chipFecha.className = "haku-aseo-chip";
        chipFecha.textContent = fechaVisible(fecha);
        chips.append(chipCab, chipFecha);

        const grid = document.createElement("div");
        grid.className = "haku-aseo-grid";
        grid.append(
            dato("Huésped de salida", nombre),
            dato("Estadía", `${fechaVisible(ingreso)} → ${fechaVisible(salida)}`),
            dato("Revisó el aseo", revisor)
        );

        const pie = document.createElement("div");
        pie.className = "haku-aseo-pie";
        pie.textContent = fuente.startsWith("Proyecto H")
            ? `Haku identificó automáticamente la CAB ${numero} y el ${fechaVisible(fecha)} desde la estadía de ${nombre}. Proyecto H respondió la pregunta, por lo que no fue necesario consultar el Libro.`
            : `Haku identificó automáticamente la CAB ${numero} y el ${fechaVisible(fecha)} desde la estadía de ${nombre}. Proyecto H no tenía quién revisó el aseo y se usó el Libro de Reserva como respaldo.`;

        card.append(head, chips, grid, pie);
        mensajes.appendChild(card);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
    }

    async function consultar(textoUsuario) {
        const { db, campo, enviar, mensajes } = elementos();
        if (!db || !campo || !enviar || !mensajes || ocupado) return;

        const nombre = nombreCheckout(textoUsuario);
        if (!nombre) return;

        ocupado = true;
        enviar.disabled = true;
        campo.disabled = true;
        agregarMensaje(mensajes, "usuario", textoUsuario);
        campo.value = "";
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
            if (!cabana?.numero) {
                estado.classList.remove("haiku-asistente-mensaje--procesando");
                estado.textContent = `Encontré la estadía de ${nombre}, pero no pude resolver la cabaña asociada.`;
                return;
            }

            const fecha = estadia.fecha_salida;
            const aseo = await aseoProyecto(db, fecha, estadia.cabana_id);
            let revisor = String(aseo?.revisor_nombre || "").trim() || null;
            let fuente = "Proyecto H";

            if (!revisor) {
                const libro = await aseoLibro(fecha, cabana.numero);
                revisor = valorLibro(libro?.revisado_por);
                if (revisor) fuente = "Libro de Reserva · respaldo";
            }

            estado.remove();
            if (!revisor) {
                agregarMensaje(mensajes, "asistente", `Identifiqué a ${filaReserva(estadia)?.titular_nombre || nombre} en CAB ${cabana.numero}, con salida ${fechaVisible(fecha)}, pero no encontré quién revisó el aseo ese día ni en Proyecto H ni en el Libro disponible.`);
                return;
            }

            renderResultado(mensajes, {
                nombre: filaReserva(estadia)?.titular_nombre || nombre,
                numero: cabana.numero,
                fecha,
                revisor,
                fuente,
                ingreso: estadia.fecha_ingreso,
                salida: estadia.fecha_salida
            });
        } catch (error) {
            console.error("HAKU · Aseo por contexto de huésped:", error);
            estado.classList.remove("haiku-asistente-mensaje--procesando");
            estado.textContent = `No pude resolver la revisión de aseo desde el huésped: ${error?.message || "error inesperado"}.`;
        } finally {
            ocupado = false;
            campo.disabled = false;
            enviar.disabled = false;
            campo.dispatchEvent(new Event("input", { bubbles: true }));
            campo.focus();
            requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
        }
    }

    function interceptar(evento) {
        if (ocupado) return;
        const { campo, adjuntos } = elementos();
        if (!campo) return;
        if (adjuntos?.querySelector(".haiku-asistente-adjunto")) return;
        const texto = campo.value.trim();
        if (!esConsulta(texto)) return;

        evento.preventDefault();
        evento.stopImmediatePropagation();
        consultar(texto);
    }

    document.addEventListener("click", evento => {
        if (!evento.target?.closest?.("#haiku-asistente-enviar")) return;
        interceptar(evento);
    }, true);

    document.addEventListener("keydown", evento => {
        if (evento.target?.id !== "haiku-asistente-texto") return;
        const envio = evento.key === "Enter" && !evento.shiftKey;
        if (!envio) return;
        interceptar(evento);
    }, true);

    window.HAIKU_ASISTENTE_ASEO_CONTEXTO_V1 = Object.freeze({
        activo: true,
        esConsulta,
        nombreCheckout,
        consultar
    });

    console.info("HAKU · Aseo por contexto de huésped V1 preparado.");
})();
