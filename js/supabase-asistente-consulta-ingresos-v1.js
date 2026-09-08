// ========================================
// HAKU · CONSULTA DE INGRESOS POR FECHA V1
// Preguntas de sólo lectura como:
// "Haku cuantas reservas ingresan el jueves 17 de septiembre?"
// Consulta Proyecto H directamente y no crea/modifica registros.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_CONSULTA_INGRESOS_V1) return;

    const cliente = window.haikuSupabase;
    const campo = document.getElementById("haiku-asistente-texto");
    const enviar = document.getElementById("haiku-asistente-enviar");
    const mensajes = document.getElementById("haiku-asistente-mensajes");
    const adjuntosWrap = document.getElementById("haiku-asistente-adjuntos");

    if (!cliente || !campo || !enviar || !mensajes) return;

    let ocupado = false;

    const MESES = Object.freeze({
        enero: 1,
        febrero: 2,
        marzo: 3,
        abril: 4,
        mayo: 5,
        junio: 6,
        julio: 7,
        agosto: 8,
        septiembre: 9,
        setiembre: 9,
        octubre: 10,
        noviembre: 11,
        diciembre: 12
    });

    function quitarHaku(valor) {
        const fn = window.haikuQuitarVocativoAsistente;
        if (typeof fn === "function") return fn(valor);
        return String(valor || "").replace(/^\s*(?:asistente\s+)?haku\b\s*[,;:!¡¿?\-–—]*\s*/i, "");
    }

    function normalizar(valor) {
        return quitarHaku(valor)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function fechaChileHoy() {
        const partes = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Santiago",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(new Date());
        const p = Object.fromEntries(partes.map(x => [x.type, x.value]));
        return `${p.year}-${p.month}-${p.day}`;
    }

    function iso(y, m, d) {
        const yy = Number(y), mm = Number(m), dd = Number(d);
        if (!Number.isInteger(yy) || !Number.isInteger(mm) || !Number.isInteger(dd)) return null;
        const dt = new Date(Date.UTC(yy, mm - 1, dd));
        if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
        return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }

    function desplazar(isoFecha, dias) {
        const [y, m, d] = isoFecha.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        dt.setUTCDate(dt.getUTCDate() + dias);
        return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }

    function fechaDesdeTexto(valor) {
        const t = normalizar(valor);
        const hoy = fechaChileHoy();
        const anioActual = Number(hoy.slice(0, 4));

        if (/\bpasado\s+manana\b/.test(t)) return desplazar(hoy, 2);
        if (/\bmanana\b/.test(t)) return desplazar(hoy, 1);
        if (/\bhoy\b/.test(t)) return hoy;
        if (/\bayer\b/.test(t)) return desplazar(hoy, -1);

        const numerica = t.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
        if (numerica) {
            let year = numerica[3] ? Number(numerica[3]) : anioActual;
            if (year < 100) year += 2000;
            return iso(year, Number(numerica[2]), Number(numerica[1]));
        }

        const meses = Object.keys(MESES).join("|");
        const escrita = t.match(new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${meses})(?:\\s+(?:de\\s+)?(20\\d{2}))?\\b`));
        if (escrita) {
            const year = escrita[3] ? Number(escrita[3]) : anioActual;
            return iso(year, MESES[escrita[2]], Number(escrita[1]));
        }

        return null;
    }

    function esConsultaIngresos(valor) {
        const t = normalizar(valor);
        if (!t) return false;

        // No capturar instrucciones que sí pretenden modificar datos.
        if (/\b(?:marca|marcar|cambia|cambiar|pon|poner|pasa|pasar|crea|crear|agrega|agregar|registra|registrar|elimina|eliminar|borra|borrar)\b/.test(t)) return false;

        const pregunta = /\b(?:cuant[ao]s?|que|cuales|quienes|lista|listar|muestra|mostrar|dime|revisa|revisar|consulta|consultar)\b/.test(t);
        const reserva = /\b(?:reservas?|huespedes?|cabanas?)\b/.test(t);
        const ingreso = /\b(?:ingresan?|ingresara?n?|ingresos?|llegan?|llegadas?|check[ -]?ins?)\b/.test(t);

        return ingreso && (reserva || pregunta) && (pregunta || /\b(?:reservas?|huespedes?)\s+(?:que\s+)?ingres/.test(t));
    }

    function estadoNormal(fila) {
        return normalizar(`${fila?.estado_reserva || ""} ${fila?.estado_estadia || ""}`);
    }

    function esIngresoActivo(fila) {
        const estado = estadoNormal(fila);
        return !/\bcancelad[ao]?s?\b|\bno[ _-]?show\b|\bcancelled\b|\bcanceled\b/.test(estado);
    }

    function estadoVisible(fila) {
        const e = normalizar(fila?.estado_estadia || fila?.estado_reserva || "");
        if (/hospedad/.test(e)) return "Hospedado";
        if (/confirm/.test(e)) return "Confirmada";
        if (/pendiente/.test(e)) return "Pendiente";
        if (/checked.?out|checkout/.test(e)) return "Checked Out";
        if (/full.?day|fullday/.test(e)) return "Full Day";
        return String(fila?.estado_estadia || fila?.estado_reserva || "Reserva");
    }

    function fechaVisible(fecha) {
        const m = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : String(fecha || "—");
    }

    function mensaje(tipo, texto) {
        const div = document.createElement("div");
        div.className = `haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}`;
        div.textContent = texto;
        mensajes.appendChild(div);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
        return div;
    }

    function limpiarAdjuntos() {
        [...(adjuntosWrap?.querySelectorAll(".haiku-asistente-quitar") || [])].forEach(b => {
            try { b.click(); } catch {}
        });
    }

    async function buscar(fecha) {
        const { data, error } = await cliente.rpc("haiku_buscar_checkins_fecha_asistente", { p_fecha: fecha });
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    function renderizar(fecha, filas, descartadas) {
        const card = document.createElement("div");
        card.className = "haiku-asistente-preview";

        const cabecera = document.createElement("div");
        cabecera.className = "haiku-asistente-preview-cabecera";
        const izq = document.createElement("div");
        const etiqueta = document.createElement("span");
        etiqueta.textContent = "CONSULTA · SÓLO LECTURA";
        const titulo = document.createElement("strong");
        titulo.textContent = "Ingresos del día";
        izq.append(etiqueta, titulo);
        const fechaChip = document.createElement("span");
        fechaChip.className = "haiku-asistente-confianza haiku-asistente-confianza--alta";
        fechaChip.textContent = fechaVisible(fecha);
        cabecera.append(izq, fechaChip);
        card.append(cabecera);

        const resumen = document.createElement("p");
        resumen.className = "haiku-asistente-preview-resumen";
        resumen.textContent = `${filas.length} reserva${filas.length === 1 ? "" : "s"} ingresa${filas.length === 1 ? "" : "n"} el ${fechaVisible(fecha)}.`;
        card.append(resumen);

        if (filas.length) {
            const bloque = document.createElement("div");
            bloque.className = "haiku-asistente-preview-lista";
            const strong = document.createElement("strong");
            strong.textContent = filas.length === 1 ? "Reserva que ingresa" : "Reservas que ingresan";
            const ul = document.createElement("ul");
            filas
                .slice()
                .sort((a, b) => Number(a?.cabana_numero || 99) - Number(b?.cabana_numero || 99))
                .forEach(fila => {
                    const li = document.createElement("li");
                    const cab = fila?.cabana_numero ? `CAB ${fila.cabana_numero}` : "CAB —";
                    const titular = fila?.titular_nombre || "Sin titular";
                    const salida = fila?.fecha_salida ? ` · sale ${fechaVisible(fila.fecha_salida)}` : "";
                    li.textContent = `${cab} · ${titular}${salida} · ${estadoVisible(fila)}`;
                    ul.appendChild(li);
                });
            bloque.append(strong, ul);
            card.append(bloque);
        }

        if (descartadas > 0) {
            const nota = document.createElement("p");
            nota.className = "haiku-asistente-preview-resumen";
            nota.textContent = `${descartadas} registro${descartadas === 1 ? "" : "s"} cancelado${descartadas === 1 ? "" : "s"}/No Show se omitió${descartadas === 1 ? "" : "eron"} del conteo.`;
            card.append(nota);
        }

        const pie = document.createElement("div");
        pie.className = "haiku-asistente-preview-pie";
        const span = document.createElement("span");
        span.textContent = "Sólo lectura · esta consulta no modificó ninguna reserva.";
        pie.append(span);
        card.append(pie);

        mensajes.appendChild(card);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
    }

    async function procesar(textoOriginal) {
        if (ocupado) return;

        const fecha = fechaDesdeTexto(textoOriginal);
        campo.value = "";
        limpiarAdjuntos();
        mensaje("usuario", textoOriginal);

        if (!fecha) {
            mensaje("asistente", "Indícame una fecha, por ejemplo: 17 de septiembre, 17/09 o mañana.");
            return;
        }

        ocupado = true;
        const espera = mensaje("asistente", `Buscando ingresos del ${fechaVisible(fecha)}…`);
        try {
            const encontradas = await buscar(fecha);
            const activas = encontradas.filter(esIngresoActivo);
            espera.remove();
            renderizar(fecha, activas, encontradas.length - activas.length);
        } catch (error) {
            console.error("HAIKU · Consulta de ingresos por fecha:", error);
            espera.textContent = error?.message || "No pude consultar los ingresos de esa fecha.";
        } finally {
            ocupado = false;
            campo.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    function interceptarClick(evento) {
        const texto = String(campo.value || "").trim();
        if (!esConsultaIngresos(texto)) return;
        evento.preventDefault();
        evento.stopImmediatePropagation();
        procesar(texto);
    }

    function interceptarTeclado(evento) {
        if (evento.key !== "Enter" || evento.shiftKey) return;
        const texto = String(campo.value || "").trim();
        if (!esConsultaIngresos(texto)) return;
        evento.preventDefault();
        evento.stopImmediatePropagation();
        procesar(texto);
    }

    enviar.addEventListener("click", interceptarClick, true);
    campo.addEventListener("keydown", interceptarTeclado, true);

    window.HAIKU_ASISTENTE_CONSULTA_INGRESOS_V1 = Object.freeze({
        esConsultaIngresos,
        fechaDesdeTexto
    });

    console.info("HAIKU · Consulta de ingresos por fecha V1 preparada.");
})();
