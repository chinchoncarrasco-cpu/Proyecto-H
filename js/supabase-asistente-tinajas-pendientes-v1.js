// ========================================
// HAKU · TINAJAS POR COORDINAR V2
// Consulta de sólo lectura sobre notas operativas de Proyecto H.
// Inferencia temporal:
// - "hoy" / "día de hoy" => sólo HOY (Chile).
// - "mañana" => sólo mañana.
// - fecha explícita => sólo esa fecha.
// - "mes actual" / "este mes" / sin fecha => desde HOY hasta fin de mes.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_TINAJAS_PENDIENTES_V2) return;
    window.HAIKU_ASISTENTE_TINAJAS_PENDIENTES_V2 = true;

    const ZONA = "America/Santiago";
    const TIPO_NOTA = "operativa_resumen";
    const MESES = Object.freeze({
        enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
        julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
        noviembre: 11, diciembre: 12
    });
    let ocupado = false;

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

    function iso(y, m, d) {
        const yy = Number(y), mm = Number(m), dd = Number(d);
        if (!Number.isInteger(yy) || !Number.isInteger(mm) || !Number.isInteger(dd)) return null;
        const dt = new Date(Date.UTC(yy, mm - 1, dd));
        if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
        return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
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

    function desplazar(fecha, dias) {
        const [y, m, d] = String(fecha).split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        dt.setUTCDate(dt.getUTCDate() + Number(dias || 0));
        return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }

    function finMes(fecha) {
        const [y, m] = String(fecha).split("-").map(Number);
        const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
        return iso(y, m, d);
    }

    function fechaVisible(fecha, conAnio = false) {
        const m = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return String(fecha || "—");
        return conAnio ? `${m[3]}-${m[2]}-${m[1]}` : `${m[3]}-${m[2]}`;
    }

    function nombreMes(fecha) {
        const [y, m] = String(fecha).split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, 1, 12));
        const nombre = new Intl.DateTimeFormat("es-CL", {
            timeZone: "UTC", month: "long", year: "numeric"
        }).format(dt);
        return nombre.charAt(0).toUpperCase() + nombre.slice(1);
    }

    function rangoDesdeTexto(valor) {
        const t = norm(valor);
        const hoy = hoyChile();
        const anio = Number(hoy.slice(0, 4));

        if (/\b(?:hoy|dia\s+de\s+hoy|para\s+hoy)\b/.test(t)) {
            return { desde: hoy, hasta: hoy, modo: "hoy" };
        }
        if (/\bmanana\b/.test(t)) {
            const fecha = desplazar(hoy, 1);
            return { desde: fecha, hasta: fecha, modo: "manana" };
        }

        const numerica = t.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
        if (numerica) {
            let year = numerica[3] ? Number(numerica[3]) : anio;
            if (year < 100) year += 2000;
            const fecha = iso(year, Number(numerica[2]), Number(numerica[1]));
            if (fecha) return { desde: fecha, hasta: fecha, modo: "fecha" };
        }

        const meses = Object.keys(MESES).join("|");
        const escrita = t.match(new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${meses})(?:\\s+(?:de\\s+)?(20\\d{2}))?\\b`));
        if (escrita) {
            const fecha = iso(escrita[3] ? Number(escrita[3]) : anio, MESES[escrita[2]], Number(escrita[1]));
            if (fecha) return { desde: fecha, hasta: fecha, modo: "fecha" };
        }

        return { desde: hoy, hasta: finMes(hoy), modo: "mes" };
    }

    function esEscritura(t) {
        return /\b(?:agrega|agregar|crea|crear|registra|registrar|coordina\s+ahora|coordinar\s+ahora|confirma\s+ahora|confirmar\s+ahora|elimina|eliminar|borra|borrar|cambia|cambiar)\b/.test(t);
    }

    function esConsulta(valor) {
        const t = norm(valor);
        if (!t || esEscritura(t) || !/\btinajas?\b/.test(t)) return false;
        if (/\b(?:disponibilidad|disponible|horarios?|horas?\s+libres?)\b/.test(t)) return false;

        const pendiente = /\b(?:por\s+coordinar|coordinar|por\s+confirmar|a\s+confirmar|x\s*confirmar|x\s*coordinar|cortesia|pendiente|pendientes)\b/.test(t);
        const pregunta = /\b(?:que|cuales|cuantas|dime|muestra|lista|revisa|hay|tienen|tiene)\b/.test(t);
        return pendiente && pregunta;
    }

    function notaResuelta(texto) {
        const t = norm(texto);
        return /\b(?:ya\s+)?(?:coordinada|coordinado|confirmada|confirmado|realizada|realizado|resuelta|resuelto)\b/.test(t);
    }

    function clasificarNota(texto) {
        const t = norm(texto);
        if (!/\btinajas?\b/.test(t) || notaResuelta(t)) return null;

        const coordinar = /\b(?:por\s+coordinar|coordinar|x\s*coordinar|por\s+confirmar|a\s+confirmar|x\s*confirmar|confirmar)\b/.test(t);
        const cortesia = /\bcortesia\b/.test(t);
        const tipoEspecificado = /\b(?:jacuzzi|tonel(?:\s+de\s+madera)?|tonel\s+madera)\b/.test(t);
        const indicioServicio =
            /\b(?:\d+\s*(?:hora|horas|hr|hrs)|a\s+las\s+\d{1,2}|dejar\s+batas|batas|pagad[ao]|por\s+pagar|x\s*pagar|tinaja\s+caliente|servicio\s+de\s+tinaja)\b/.test(t) ||
            /\b\d{1,2}[:.]\d{2}\b/.test(t);
        const notaGenericaBreve = !tipoEspecificado && (indicioServicio || t.length <= 55);

        if (coordinar) return "Por coordinar";
        if (cortesia) return "Cortesía";
        if (notaGenericaBreve) return "Tipo por definir";
        return null;
    }

    async function cargarDatos(cliente, desde, hasta) {
        const { data: notas, error } = await cliente
            .from("notas")
            .select("id,reserva_id,cabana_id,fecha_operacion,texto,creado_en")
            .eq("tipo", TIPO_NOTA)
            .gte("fecha_operacion", desde)
            .lte("fecha_operacion", hasta)
            .order("fecha_operacion", { ascending: true })
            .order("creado_en", { ascending: true });
        if (error) throw error;

        const candidatas = (notas || [])
            .map(n => ({ ...n, motivo: clasificarNota(n.texto) }))
            .filter(n => n.motivo);
        if (!candidatas.length) return [];

        const cabIds = [...new Set(candidatas.map(n => n.cabana_id).filter(Boolean))];
        const reservaIds = [...new Set(candidatas.map(n => n.reserva_id).filter(Boolean))];
        const [cabsResp, reservasResp] = await Promise.all([
            cabIds.length ? cliente.from("cabanas").select("id,numero,nombre").in("id", cabIds) : Promise.resolve({ data: [], error: null }),
            reservaIds.length ? cliente.from("reservas").select("id,titular_nombre").in("id", reservaIds) : Promise.resolve({ data: [], error: null })
        ]);
        if (cabsResp.error) throw cabsResp.error;
        if (reservasResp.error) throw reservasResp.error;

        const cabPorId = new Map((cabsResp.data || []).map(c => [String(c.id), c]));
        const reservaPorId = new Map((reservasResp.data || []).map(r => [String(r.id), r]));
        return candidatas.map(n => ({
            ...n,
            cabana: cabPorId.get(String(n.cabana_id)) || null,
            reserva: reservaPorId.get(String(n.reserva_id)) || null
        })).sort((a, b) =>
            String(a.fecha_operacion).localeCompare(String(b.fecha_operacion)) ||
            Number(a.cabana?.numero || 999) - Number(b.cabana?.numero || 999)
        );
    }

    function instalarEstilos() {
        if (document.getElementById("haku-tinajas-pendientes-v1-css")) return;
        const style = document.createElement("style");
        style.id = "haku-tinajas-pendientes-v1-css";
        style.textContent = `
            .haku-tinajas-card{--ac:#6d6230;--soft:#fff9e9;--bd:#e7dcae;border:1px solid var(--bd);border-radius:16px;background:linear-gradient(180deg,#fffef9,#fbfaf4);padding:14px;display:flex;flex-direction:column;gap:10px;box-shadow:0 5px 16px rgba(71,61,26,.055)}
            .haku-tinajas-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:9px;border-bottom:1px solid #ece6cf}
            .haku-tinajas-kicker{font-size:10px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;color:var(--ac)}
            .haku-tinajas-title{margin:2px 0 0;font-size:18px;line-height:1.15;color:#25261d}
            .haku-tinajas-badge{flex:0 0 auto;padding:5px 9px;border:1px solid var(--bd);border-radius:999px;background:var(--soft);color:var(--ac);font-size:9px;font-weight:900}
            .haku-tinajas-rango{display:flex;gap:6px;flex-wrap:wrap}.haku-tinajas-chip{display:inline-flex;align-items:center;padding:5px 8px;border-radius:8px;background:var(--soft);color:var(--ac);font-size:10px;font-weight:850}
            .haku-tinajas-resumen{display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid #ebe5d0;border-radius:12px;background:#fff;color:#444333;font-size:11px}.haku-tinajas-cantidad{display:grid;place-items:center;min-width:32px;height:32px;border-radius:9px;background:var(--ac);color:#fff;font-size:14px;font-weight:900}
            .haku-tinajas-lista{display:flex;flex-direction:column;gap:7px;max-height:330px;overflow:auto;padding-right:2px}.haku-tinajas-item{padding:9px 10px;border:1px solid #e7e3d5;border-radius:11px;background:#fff;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:start}
            .haku-tinajas-cab{padding:4px 7px;border-radius:8px;background:var(--soft);color:var(--ac);font-size:10px;font-weight:900;white-space:nowrap}.haku-tinajas-main{min-width:0}.haku-tinajas-main strong{display:block;color:#343329;font-size:11px;margin-bottom:3px}.haku-tinajas-main p{margin:0;color:#5f5e51;font-size:10px;line-height:1.4;overflow-wrap:anywhere}
            .haku-tinajas-meta{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}.haku-tinajas-meta span{font-size:8px;font-weight:850;padding:3px 6px;border-radius:999px;background:#f6f4eb;color:#706c57}.haku-tinajas-fecha{font-size:9px;font-weight:850;color:#766e49;white-space:nowrap;padding-top:3px}
            .haku-tinajas-vacio{padding:10px;border:1px dashed var(--bd);border-radius:10px;background:var(--soft);color:#68634d;font-size:11px}.haku-tinajas-pie{padding-top:7px;border-top:1px solid #ece6cf;color:#7b7869;font-size:9px;line-height:1.4}
            @media(max-width:620px){.haku-tinajas-card{padding:11px}.haku-tinajas-item{grid-template-columns:auto minmax(0,1fr)}.haku-tinajas-fecha{grid-column:2}.haku-tinajas-title{font-size:16px}}
        `;
        document.head.appendChild(style);
    }

    function mensaje(mensajes, tipo, texto, extra = "") {
        const div = document.createElement("div");
        div.className = `haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}${extra ? ` ${extra}` : ""}`;
        div.textContent = texto;
        mensajes.appendChild(div);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
        return div;
    }

    function textoPeriodo(modo, desde, hasta) {
        if (modo === "hoy") return `hoy ${fechaVisible(desde, true)}`;
        if (modo === "manana") return `mañana ${fechaVisible(desde, true)}`;
        if (modo === "fecha") return `el ${fechaVisible(desde, true)}`;
        return `desde hoy hasta fin de ${nombreMes(desde)}`;
    }

    function renderizar(mensajes, filas, rangoInfo) {
        instalarEstilos();
        const { desde, hasta, modo } = rangoInfo;
        const card = document.createElement("article");
        card.className = "haku-tinajas-card";
        card.dataset.hakuTinajasPendientes = "1";

        const head = document.createElement("div");
        head.className = "haku-tinajas-head";
        const izq = document.createElement("div");
        const kicker = document.createElement("div");
        kicker.className = "haku-tinajas-kicker";
        kicker.textContent = "CONSULTA · SÓLO LECTURA";
        const h3 = document.createElement("h3");
        h3.className = "haku-tinajas-title";
        h3.textContent = "Tinajas por coordinar";
        izq.append(kicker, h3);
        const badge = document.createElement("span");
        badge.className = "haku-tinajas-badge";
        badge.textContent = "Proyecto H";
        head.append(izq, badge);

        const rango = document.createElement("div");
        rango.className = "haku-tinajas-rango";
        const chips = modo === "mes"
            ? [nombreMes(desde), `Desde hoy · ${fechaVisible(desde, true)}`, `Hasta · ${fechaVisible(hasta, true)}`]
            : [modo === "hoy" ? `Hoy · ${fechaVisible(desde, true)}` : modo === "manana" ? `Mañana · ${fechaVisible(desde, true)}` : `Fecha · ${fechaVisible(desde, true)}`];
        chips.forEach(texto => {
            const chip = document.createElement("span");
            chip.className = "haku-tinajas-chip";
            chip.textContent = texto;
            rango.appendChild(chip);
        });

        const cabanasUnicas = new Set(filas.map(f => String(f.cabana?.numero || "")).filter(Boolean));
        const resumen = document.createElement("div");
        resumen.className = "haku-tinajas-resumen";
        const cantidad = document.createElement("span");
        cantidad.className = "haku-tinajas-cantidad";
        cantidad.textContent = String(cabanasUnicas.size);
        const textoResumen = document.createElement("span");
        textoResumen.textContent = filas.length
            ? `${cabanasUnicas.size} cabaña${cabanasUnicas.size === 1 ? "" : "s"} tienen ${filas.length} nota${filas.length === 1 ? "" : "s"} de tinaja que requieren coordinación o definición ${textoPeriodo(modo, desde, hasta)}.`
            : `No encontré tinajas por coordinar ${textoPeriodo(modo, desde, hasta)}.`;
        resumen.append(cantidad, textoResumen);
        card.append(head, rango, resumen);

        if (!filas.length) {
            const vacio = document.createElement("div");
            vacio.className = "haku-tinajas-vacio";
            vacio.textContent = "No hay notas operativas de tinaja pendientes para ese período.";
            card.appendChild(vacio);
        } else {
            const lista = document.createElement("div");
            lista.className = "haku-tinajas-lista";
            filas.forEach(fila => {
                const item = document.createElement("div");
                item.className = "haku-tinajas-item";
                const cab = document.createElement("span");
                cab.className = "haku-tinajas-cab";
                cab.textContent = fila.cabana?.numero ? `CAB ${fila.cabana.numero}` : "CAB —";
                const main = document.createElement("div");
                main.className = "haku-tinajas-main";
                const strong = document.createElement("strong");
                strong.textContent = fila.reserva?.titular_nombre || "Sin titular asociado";
                const p = document.createElement("p");
                p.textContent = fila.texto || "Tinaja por coordinar";
                const meta = document.createElement("div");
                meta.className = "haku-tinajas-meta";
                const motivo = document.createElement("span");
                motivo.textContent = fila.motivo;
                meta.appendChild(motivo);
                main.append(strong, p, meta);
                const fecha = document.createElement("span");
                fecha.className = "haku-tinajas-fecha";
                fecha.textContent = fechaVisible(fila.fecha_operacion, true);
                item.append(cab, main, fecha);
                lista.appendChild(item);
            });
            card.appendChild(lista);
        }

        const pie = document.createElement("div");
        pie.className = "haku-tinajas-pie";
        pie.textContent = modo === "hoy"
            ? `Haku interpretó “hoy” como ${fechaVisible(desde, true)} en Chile y consultó únicamente ese día; no incluyó fechas futuras.`
            : modo === "manana"
                ? `Haku interpretó “mañana” como ${fechaVisible(desde, true)} en Chile y consultó únicamente ese día.`
                : modo === "fecha"
                    ? `Haku consultó únicamente la fecha ${fechaVisible(desde, true)}.`
                    : "Haku interpretó “mes actual” como el mes vigente en Chile y descartó automáticamente los días anteriores a hoy.";
        card.appendChild(pie);
        mensajes.appendChild(card);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
    }

    async function consultar(textoUsuario) {
        const cliente = window.haikuSupabase;
        const campo = document.getElementById("haiku-asistente-texto");
        const enviar = document.getElementById("haiku-asistente-enviar");
        const mensajes = document.getElementById("haiku-asistente-mensajes");
        if (!cliente || !campo || !enviar || !mensajes || ocupado) return;

        const rangoInfo = rangoDesdeTexto(textoUsuario);
        ocupado = true;
        campo.disabled = true;
        enviar.disabled = true;
        mensaje(mensajes, "usuario", textoUsuario);
        campo.value = "";
        const estado = mensaje(mensajes, "asistente", `Revisando tinajas por coordinar ${textoPeriodo(rangoInfo.modo, rangoInfo.desde, rangoInfo.hasta)}…`, "haiku-asistente-mensaje--procesando");

        try {
            const filas = await cargarDatos(cliente, rangoInfo.desde, rangoInfo.hasta);
            estado.remove();
            renderizar(mensajes, filas, rangoInfo);
        } catch (error) {
            console.error("HAKU · Tinajas por coordinar:", error);
            estado.classList.remove("haiku-asistente-mensaje--procesando");
            estado.textContent = `No pude revisar las tinajas por coordinar: ${error?.message || "error inesperado"}.`;
        } finally {
            ocupado = false;
            campo.disabled = false;
            enviar.disabled = false;
            campo.dispatchEvent(new Event("input", { bubbles: true }));
            campo.focus();
        }
    }

    function instalar() {
        if (window.HAIKU_ASISTENTE_TINAJAS_PENDIENTES_INSTALADO_V2) return true;
        const campo = document.getElementById("haiku-asistente-texto");
        const enviar = document.getElementById("haiku-asistente-enviar");
        if (!campo || !enviar || !window.haikuSupabase) return false;
        window.HAIKU_ASISTENTE_TINAJAS_PENDIENTES_INSTALADO_V2 = true;

        document.addEventListener("click", evento => {
            const boton = evento.target?.closest?.("#haiku-asistente-enviar");
            if (!boton || ocupado) return;
            const texto = String(campo.value || "").trim();
            if (!esConsulta(texto)) return;
            evento.preventDefault();
            evento.stopImmediatePropagation();
            consultar(texto);
        }, true);

        document.addEventListener("keydown", evento => {
            if (evento.target?.id !== "haiku-asistente-texto" || ocupado || evento.key !== "Enter" || evento.shiftKey) return;
            const texto = String(campo.value || "").trim();
            if (!esConsulta(texto)) return;
            evento.preventDefault();
            evento.stopImmediatePropagation();
            consultar(texto);
        }, true);

        console.info("HAKU · Consulta de tinajas por coordinar V2 preparada.");
        return true;
    }

    if (!instalar()) {
        let intentos = 0;
        const timer = setInterval(() => {
            intentos += 1;
            if (instalar() || intentos > 100) clearInterval(timer);
        }, 50);
        document.addEventListener("DOMContentLoaded", instalar, { once: true });
    }
})();