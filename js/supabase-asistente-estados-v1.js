// ========================================
// HAIKU · ASISTENTE · ESTADOS DE RESERVA V1
// Texto -> vista previa -> confirmación -> check-in por lote.
// V1 limitada a cambiar alojamientos a HOSPEDADO por fecha de ingreso,
// con filtro opcional por lista explícita de cabañas.
// Sin observers, intervalos, parches de clientes ni prototipos globales.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_ESTADOS_V1) return;

    const cliente = window.haikuSupabase;
    const root = document.querySelector(".haiku-asistente-root");
    const campo = document.getElementById("haiku-asistente-texto");
    const enviar = document.getElementById("haiku-asistente-enviar");
    const adjuntosWrap = document.getElementById("haiku-asistente-adjuntos");
    const mensajes = document.getElementById("haiku-asistente-mensajes");

    if (!cliente || !root || !campo || !enviar || !mensajes) {
        const principal = document.querySelector('script[data-haiku-asistente-v1]');
        const srcActual = document.currentScript?.src || "";
        if (principal && srcActual && principal.dataset.haikuEstadosV1Espera !== "1") {
            principal.dataset.haikuEstadosV1Espera = "1";
            principal.addEventListener("load", () => {
                if (window.HAIKU_ASISTENTE_ESTADOS_V1) return;
                const retry = document.createElement("script");
                retry.src = `${srcActual}${srcActual.includes("?") ? "&" : "?"}afterAssistant=${Date.now()}`;
                retry.async = false;
                document.head.appendChild(retry);
            }, { once: true });
            console.info("HAIKU · Estados V1 esperará la carga del asistente principal.");
        } else {
            console.info("HAIKU · Estados V1 no se instaló porque el asistente aún no está disponible.");
        }
        return;
    }

    function quitarVocativoHaku(texto) {
        const original = String(texto || "");
        const conPuntuacion = /^\s*(?:asistente\s+)?haku\s*[,;:!¡¿?\-–—]+\s*/i;
        const conComando = /^\s*(?:asistente\s+)?haku\s+(?=(?:marca|marcar|agrega|agregar|crea|crear|revisa|revisar|cambia|cambiar|pon|poner|pasa|pasar|deja|dejar|registra|registrar|asocia|asociar|busca|buscar|muestra|mostrar|lee|leer)\b)/i;
        return original.replace(conPuntuacion, "").replace(conComando, "").trimStart();
    }

    function aplicarIdentidadHaku() {
        const titulo = root.querySelector(".haiku-asistente-titulo strong");
        const subtitulo = root.querySelector(".haiku-asistente-titulo span");
        const panel = document.getElementById("haiku-asistente-panel");
        const abrir = document.getElementById("haiku-asistente-boton");
        const cerrar = document.getElementById("haiku-asistente-cerrar");
        if (titulo) titulo.textContent = "Haku";
        if (subtitulo) subtitulo.textContent = "Asistente operativo";
        panel?.setAttribute("aria-label", "Haku · Asistente operativo");
        abrir?.setAttribute("aria-label", "Abrir Haku");
        cerrar?.setAttribute("aria-label", "Cerrar Haku");
        campo.placeholder = "Escribe una consulta o instrucción…";

        window.HAIKU_ASISTENTE_IDENTIDAD = Object.freeze({
            nombre: "Haku",
            quitarVocativo: quitarVocativoHaku
        });
        window.haikuQuitarVocativoAsistente = quitarVocativoHaku;
    }

    aplicarIdentidadHaku();

    let ocupado = false;

    function normalizar(texto) {
        return quitarVocativoHaku(texto)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function esComandoHospedar(texto) {
        const t = normalizar(texto);
        if (!t) return false;

        const accion = /\b(cambia|cambiar|cambie|pon|poner|pasa|pasar|marca|marcar|deja|dejar)\b/.test(t);
        const hospedado = /\bhospedad[oa]s?\b|\bhospedar\b/.test(t);
        const objetivo = /\breservas?\b|\bcabanas?\b|\bcabs?\b|\bingres(?:a|an|aban|aron|o|os)\b|\bcheck[ -]?in\b/.test(t);

        return accion && hospedado && objetivo;
    }

    function fechaChileHoy() {
        const partes = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Santiago",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(new Date());
        const m = Object.fromEntries(partes.map(p => [p.type, p.value]));
        return `${m.year}-${m.month}-${m.day}`;
    }

    function isoDesdePartes(y, m, d) {
        const yy = Number(y);
        const mm = Number(m);
        const dd = Number(d);
        if (!Number.isInteger(yy) || !Number.isInteger(mm) || !Number.isInteger(dd)) return null;
        if (yy < 2000 || yy > 2100 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
        const dt = new Date(Date.UTC(yy, mm - 1, dd));
        if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
        return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }

    function desplazarDias(iso, dias) {
        const [y, m, d] = iso.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        dt.setUTCDate(dt.getUTCDate() + dias);
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    }

    function fechaDesdeTexto(texto) {
        const t = normalizar(texto);
        const hoy = fechaChileHoy();
        const anioHoy = Number(hoy.slice(0, 4));

        const match = t.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
        if (match) {
            let anio = match[3] ? Number(match[3]) : anioHoy;
            if (anio < 100) anio += 2000;
            return isoDesdePartes(anio, Number(match[2]), Number(match[1]));
        }

        if (/\bayer\b/.test(t)) return desplazarDias(hoy, -1);
        if (/\bhoy\b/.test(t)) return hoy;
        return null;
    }

    function mencionaFiltroCabanas(texto) {
        return /\b(?:cabanas?|cabs?)\b/.test(normalizar(texto));
    }

    function cabanasDesdeTexto(texto) {
        const t = normalizar(texto);
        const match = t.match(
            /\b(?:cabanas?|cabs?)\b\s*[:,#-]?\s*(.+?)(?=\s+\b(?:de|del|para|como|a)\b|$)/
        );
        if (!match) return [];

        const numeros = (match[1].match(/\b(?:1[01]|[1-9])\b/g) || [])
            .map(Number)
            .filter(numero => numero >= 1 && numero <= 11);

        return [...new Set(numeros)].sort((a, b) => a - b);
    }

    function fechaVisible(valor) {
        const s = String(valor || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "—";
        const [y, m, d] = s.split("-");
        return `${d}-${m}-${y}`;
    }

    function estadoVisible(valor) {
        const v = normalizar(valor);
        if (v === "confirmada") return "Confirmada";
        if (v === "hospedada") return "Hospedado";
        if (v === "cancelada") return "Cancelada";
        if (v === "no_show") return "No Show";
        return valor || "—";
    }

    function agregarMensaje(tipo, texto, claseExtra = "") {
        const div = document.createElement("div");
        div.className = `haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}${claseExtra ? ` ${claseExtra}` : ""}`;
        div.textContent = texto;
        mensajes.appendChild(div);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
        return div;
    }

    function agregarDato(contenedor, etiqueta, valor) {
        const fila = document.createElement("div");
        fila.className = "haiku-asistente-preview-dato";
        const small = document.createElement("span");
        small.textContent = etiqueta;
        const strong = document.createElement("strong");
        strong.textContent = String(valor ?? "—");
        fila.append(small, strong);
        contenedor.appendChild(fila);
    }

    function limpiarAdjuntosViaInterfaz() {
        if (!adjuntosWrap) return;
        [...adjuntosWrap.querySelectorAll(".haiku-asistente-quitar")].forEach(boton => {
            try { boton.click(); } catch {}
        });
    }

    async function buscar(fecha) {
        const { data, error } = await cliente.rpc("haiku_buscar_checkins_fecha_asistente", {
            p_fecha: fecha
        });
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    async function hospedar(fecha, ids) {
        const { data, error } = await cliente.rpc("haiku_hospedar_lote_asistente", {
            p_fecha: fecha,
            p_estadias: ids
        });
        if (error) throw error;
        return data;
    }

    async function refrescar() {
        try { await window.haikuSincronizarReservasSupabase?.(); } catch {}
        try { await window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(); } catch {}
        try { if (typeof generarCalendario === "function") generarCalendario(); } catch {}
        try { if (typeof cargarCabanasDia === "function") cargarCabanasDia(fechaSeleccionada); } catch {}
        try { if (typeof actualizarResumenDia === "function") actualizarResumenDia(fechaSeleccionada); } catch {}
        try { if (typeof generarResumenOperativo === "function") generarResumenOperativo(fechaSeleccionada); } catch {}
    }

    function renderizarVista(fecha, filas, cabanasSolicitadas = []) {
        const aptas = filas.filter(f => f?.apta === true);
        const omitidas = filas.filter(f => f?.apta !== true);
        const filtroCabanas = Array.isArray(cabanasSolicitadas) && cabanasSolicitadas.length > 0;

        const card = document.createElement("div");
        card.className = "haiku-asistente-preview";

        const cabecera = document.createElement("div");
        cabecera.className = "haiku-asistente-preview-cabecera";
        const izq = document.createElement("div");
        const small = document.createElement("small");
        small.textContent = "CAMBIO DE ESTADO · NADA GUARDADO";
        const h3 = document.createElement("h3");
        h3.textContent = "Cambiar a Hospedado";
        izq.append(small, h3);
        const confianza = document.createElement("span");
        confianza.className = "haiku-asistente-confianza";
        confianza.textContent = aptas.length ? "Listo para revisar" : "Sin cambios";
        cabecera.append(izq, confianza);
        card.appendChild(cabecera);

        const resumen = document.createElement("p");
        resumen.className = "haiku-asistente-preview-resumen";
        if (filtroCabanas) {
            resumen.textContent = `Fecha de ingreso ${fechaVisible(fecha)} · Cabañas solicitadas: ${cabanasSolicitadas.map(n => `CAB ${n}`).join(", ")}. ${aptas.length} puede${aptas.length === 1 ? "" : "n"} pasar a Hospedado.`;
        } else {
            resumen.textContent = `${filas.length} reserva${filas.length === 1 ? "" : "s"} encontrada${filas.length === 1 ? "" : "s"} con ingreso ${fechaVisible(fecha)}. ${aptas.length} puede${aptas.length === 1 ? "" : "n"} pasar a Hospedado.`;
        }
        card.appendChild(resumen);

        aptas.forEach((fila, i) => {
            const bloque = document.createElement("div");
            bloque.className = "haiku-asistente-preview-pago";
            const titulo = document.createElement("strong");
            titulo.textContent = aptas.length > 1 ? `Reserva ${i + 1} de ${aptas.length}` : "Reserva encontrada";
            const grid = document.createElement("div");
            grid.className = "haiku-asistente-preview-grid";
            agregarDato(grid, "Titular", fila.titular_nombre || "—");
            agregarDato(grid, "Cabaña", `CAB ${fila.cabana_numero ?? "—"}`);
            agregarDato(grid, "Ingreso", fechaVisible(fila.fecha_ingreso));
            agregarDato(grid, "Salida", fechaVisible(fila.fecha_salida));
            agregarDato(grid, "Estado actual", estadoVisible(fila.estado_estadia || fila.estado_reserva));
            agregarDato(grid, "Nuevo estado", "Hospedado");
            bloque.append(titulo, grid);
            card.appendChild(bloque);
        });

        if (omitidas.length) {
            const aviso = document.createElement("div");
            aviso.className = "haiku-asistente-preview-lista haiku-asistente-preview-lista--alerta";
            const strong = document.createElement("strong");
            strong.textContent = "No se modificarán";
            const ul = document.createElement("ul");
            omitidas.forEach(fila => {
                const li = document.createElement("li");
                li.textContent = `CAB ${fila.cabana_numero ?? "—"} · ${fila.titular_nombre || "Sin titular"}: ${fila.motivo || "No apta"}.`;
                ul.appendChild(li);
            });
            aviso.append(strong, ul);
            card.appendChild(aviso);
        }

        const seguridad = document.createElement("div");
        seguridad.className = "haiku-asistente-preview-nota";
        seguridad.textContent = "🔒 Nada se cambiará hasta confirmar. Full Day, canceladas, No Show y reservas con check-in previo quedan fuera.";
        card.appendChild(seguridad);

        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "haiku-asistente-preview-crear";
        boton.disabled = aptas.length === 0;
        boton.textContent = aptas.length
            ? `Confirmar ${aptas.length} check-in${aptas.length === 1 ? "" : "s"}`
            : "Sin reservas aptas";
        card.appendChild(boton);

        mensajes.appendChild(card);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });

        boton.addEventListener("click", async () => {
            if (ocupado || boton.disabled || !aptas.length) return;

            const detalle = aptas.map(f => `CAB ${f.cabana_numero} · ${f.titular_nombre}`).join("\n");
            if (!window.confirm(
                `¿Confirmas cambiar ${aptas.length} reserva${aptas.length === 1 ? "" : "s"} a HOSPEDADO?\n\n${detalle}`
            )) return;

            ocupado = true;
            const textoOriginal = boton.textContent;
            boton.disabled = true;
            boton.textContent = "Actualizando…";

            try {
                const ids = aptas.map(f => f.estadia_id);
                const resultado = await hospedar(fecha, ids);
                await refrescar();
                boton.textContent = `${resultado?.cantidad || ids.length} check-in${ids.length === 1 ? "" : "s"} registrado${ids.length === 1 ? "" : "s"}`;
                seguridad.textContent = `✅ ${resultado?.cantidad || ids.length} reserva${ids.length === 1 ? "" : "s"} cambiada${ids.length === 1 ? "" : "s"} a Hospedado correctamente.`;
                agregarMensaje("asistente", `${resultado?.cantidad || ids.length} reserva${ids.length === 1 ? "" : "s"} cambiada${ids.length === 1 ? "" : "s"} a Hospedado.`);
            } catch (error) {
                console.error("HAIKU · No fue posible cambiar reservas a Hospedado:", error);
                boton.disabled = false;
                boton.textContent = textoOriginal;
                seguridad.textContent = "⚠ No se realizó ningún cambio. Revisa la vista previa e inténtalo nuevamente.";
                agregarMensaje("asistente", error?.message || "No fue posible cambiar las reservas a Hospedado.");
            } finally {
                ocupado = false;
            }
        });
    }

    async function procesar(texto) {
        if (ocupado) return;
        const fecha = fechaDesdeTexto(texto);
        const filtroCabanas = mencionaFiltroCabanas(texto);
        const cabanasSolicitadas = filtroCabanas ? cabanasDesdeTexto(texto) : [];

        campo.value = "";
        limpiarAdjuntosViaInterfaz();
        agregarMensaje("usuario", texto);

        if (!fecha) {
            agregarMensaje("asistente", "Indícame la fecha de ingreso. Puedes escribir, por ejemplo: 03/09, ayer o hoy.");
            return;
        }

        if (filtroCabanas && !cabanasSolicitadas.length) {
            agregarMensaje("asistente", "Mencionaste cabañas, pero no pude identificar sus números. Indícalas entre CAB 1 y CAB 11.");
            return;
        }

        ocupado = true;
        const espera = agregarMensaje(
            "asistente",
            filtroCabanas
                ? `Buscando ${cabanasSolicitadas.map(n => `CAB ${n}`).join(", ")} con ingreso ${fechaVisible(fecha)}…`
                : `Buscando reservas con ingreso ${fechaVisible(fecha)}…`
        );

        try {
            const encontradas = await buscar(fecha);
            let filas = encontradas;

            if (filtroCabanas) {
                const solicitadas = new Set(cabanasSolicitadas.map(Number));
                const filtradas = encontradas.filter(fila => solicitadas.has(Number(fila?.cabana_numero)));
                const presentes = new Set(filtradas.map(fila => Number(fila?.cabana_numero)));
                const faltantes = cabanasSolicitadas
                    .filter(numero => !presentes.has(Number(numero)))
                    .map(numero => ({
                        cabana_numero: Number(numero),
                        titular_nombre: "Sin reserva encontrada",
                        apta: false,
                        motivo: `No encontré una reserva con ingreso ${fechaVisible(fecha)} en esta cabaña`
                    }));

                filas = [...filtradas, ...faltantes]
                    .sort((a, b) => Number(a?.cabana_numero || 99) - Number(b?.cabana_numero || 99));
            }

            espera.remove();

            if (!filas.length) {
                agregarMensaje("asistente", `No encontré reservas con ingreso ${fechaVisible(fecha)}.`);
                return;
            }

            renderizarVista(fecha, filas, cabanasSolicitadas);
        } catch (error) {
            console.error("HAIKU · Error preparando cambio a Hospedado:", error);
            espera.textContent = error?.message || "No fue posible revisar las reservas.";
        } finally {
            ocupado = false;
        }
    }

    function interceptar(evento) {
        const texto = String(campo.value || "").trim();
        if (!esComandoHospedar(texto)) return;
        evento.preventDefault();
        evento.stopImmediatePropagation();
        procesar(texto);
    }

    enviar.addEventListener("click", interceptar, true);
    campo.addEventListener("keydown", evento => {
        if (evento.key !== "Enter" || evento.shiftKey) return;
        const texto = String(campo.value || "").trim();
        if (!esComandoHospedar(texto)) return;
        evento.preventDefault();
        evento.stopImmediatePropagation();
        procesar(texto);
    }, true);

    window.HAIKU_ASISTENTE_ESTADOS_V1 = Object.freeze({
        esComandoHospedar,
        fechaDesdeTexto,
        cabanasDesdeTexto,
        quitarVocativoHaku
    });

    // Carga puntual y posterior al asistente principal. Mantiene la
    // normalizacion de pagos aislada del motor de estados y de panel.html.
    if (!window.HAIKU_ASISTENTE_NORMALIZACION_PAGOS_V1 &&
        !document.querySelector('script[data-haku-normalizacion-pagos-v1]')) {
        const normalizador = document.createElement("script");
        normalizador.dataset.hakuNormalizacionPagosV1 = "1";
        const version = new URL(document.currentScript?.src || location.href).searchParams.get("v") || Date.now();
        normalizador.src = `js/supabase-asistente-normalizacion-pagos-v1.js?v=${encodeURIComponent(version)}`;
        normalizador.async = false;
        document.head.appendChild(normalizador);
    }

    console.info("HAIKU · Asistente Estados V1 preparado · nombre visible: Haku.");
})();
