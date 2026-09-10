// ========================================
// HAKU · RESUMEN OPERATIVO DEL DÍA V1
// Consulta de sólo lectura que responde preguntas como:
// - "Haku, ¿cuál es el resumen del día?"
// - "Haku, dame el resumen de mañana"
// - "Haku, resumen del 17 de septiembre"
// - "Haku, resumen del viernes 11 próximo"
//
// Fuente de verdad:
// - haiku_operacion_dia para ingresos/salidas/continuaciones.
// - Hidratación Supabase de Servicios para la agenda.
// - API oficial de pagos pendientes para cobros operativos.
//
// No crea, edita ni elimina reservas, pagos o servicios.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_RESUMEN_DIA_BOOT_V1) return;
    window.HAIKU_ASISTENTE_RESUMEN_DIA_BOOT_V1 = true;

    const ZONA = "America/Santiago";
    const MESES = Object.freeze({
        enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
        julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
        noviembre: 11, diciembre: 12
    });
    const DIAS_SEMANA = Object.freeze({
        domingo: 0,
        lunes: 1,
        martes: 2,
        miercoles: 3,
        jueves: 4,
        viernes: 5,
        sabado: 6
    });

    function instalar() {
        if (window.HAIKU_ASISTENTE_RESUMEN_DIA_V1) return true;

        const cliente = window.haikuSupabase;
        const campo = document.getElementById("haiku-asistente-texto");
        const enviar = document.getElementById("haiku-asistente-enviar");
        const mensajes = document.getElementById("haiku-asistente-mensajes");
        const adjuntosWrap = document.getElementById("haiku-asistente-adjuntos");

        if (!cliente || !campo || !enviar || !mensajes) return false;

        let ocupado = false;

        function instalarEstilos() {
            if (document.getElementById("haku-resumen-dia-v1-css")) return;

            const style = document.createElement("style");
            style.id = "haku-resumen-dia-v1-css";
            style.textContent = `
                .haku-dia-card{--haku-dia-verde:#1f7650;--haku-dia-borde:#cadfd1;border:1px solid var(--haku-dia-borde);border-radius:16px;background:linear-gradient(180deg,#fbfdfb 0%,#f7faf8 100%);padding:14px;display:flex;flex-direction:column;gap:11px;box-shadow:0 5px 16px rgba(28,69,47,.055)}
                .haku-dia-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-bottom:9px;border-bottom:1px solid #deebe2}.haku-dia-kicker{margin:0 0 2px;font-size:10px;line-height:1.2;font-weight:850;letter-spacing:.09em;text-transform:uppercase;color:var(--haku-dia-verde)}.haku-dia-title{margin:0;font-size:19px;line-height:1.15;font-weight:850;color:#17251c}.haku-dia-fecha{flex:0 0 auto;display:inline-flex;align-items:center;min-height:26px;padding:4px 9px;border:1px solid var(--haku-dia-borde);border-radius:999px;background:#edf7f0;color:var(--haku-dia-verde);font-size:10px;font-weight:850;white-space:nowrap}
                .haku-dia-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}.haku-dia-stat{min-width:0;padding:8px 7px;border:1px solid #dfe9e2;border-radius:11px;background:#fff;text-align:center}.haku-dia-stat strong{display:block;font-size:17px;line-height:1.05;color:#203128}.haku-dia-stat span{display:block;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:8px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;color:#76827a}.haku-dia-stat--pagos{border-color:#ead8bc;background:#fffaf1}.haku-dia-stat--pagos strong{color:#9a611d}
                .haku-dia-seccion{display:flex;flex-direction:column;gap:6px}.haku-dia-seccion-titulo{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 1px;color:#3d5547;font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.04em}.haku-dia-seccion-titulo em{font-style:normal;color:#879089;font-size:9px;font-weight:750;text-transform:none;letter-spacing:0}.haku-dia-lista{display:flex;flex-direction:column;gap:5px;max-height:225px;overflow-y:auto;padding-right:2px;scrollbar-width:thin}.haku-dia-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;min-height:41px;padding:6px 8px;border:1px solid #e1e9e4;border-radius:10px;background:#fff}.haku-dia-cab{display:inline-flex;align-items:center;justify-content:center;min-width:46px;min-height:24px;padding:3px 6px;border-radius:8px;background:#edf7f0;color:var(--haku-dia-verde);font-size:9px;font-weight:900;white-space:nowrap}.haku-dia-main{min-width:0}.haku-dia-main strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#26342c;font-size:11px}.haku-dia-main span{display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7a857e;font-size:9px}.haku-dia-meta{max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#617068;font-size:9px;font-weight:800;text-align:right}.haku-dia-vacio{padding:10px;border:1px dashed #cfddd4;border-radius:10px;background:#f4f8f5;color:#68766e;font-size:10px}.haku-dia-alerta{display:flex;align-items:flex-start;gap:8px;padding:9px 10px;border:1px solid #ead8bc;border-radius:11px;background:#fffaf1;color:#76501f;font-size:10px;line-height:1.4}.haku-dia-pie{padding-top:7px;border-top:1px solid #e0e9e3;color:#758078;font-size:9px;line-height:1.35}
                @media(max-width:620px){.haku-dia-card{padding:11px;gap:9px}.haku-dia-title{font-size:17px}.haku-dia-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.haku-dia-item{grid-template-columns:auto minmax(0,1fr)}.haku-dia-meta{grid-column:2;max-width:none;text-align:left}}
            `;
            document.head.appendChild(style);
        }

        instalarEstilos();

        function quitarHaku(valor) {
            const fn = window.haikuQuitarVocativoAsistente;
            if (typeof fn === "function") return fn(valor);
            return String(valor || "").replace(/^\s*(?:asistente\s+)?haku\b\s*[,;:!¡¿?\-–—]*\s*/i, "");
        }

        function normalizar(valor) {
            return quitarHaku(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
        }

        function fechaChileHoy() {
            const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
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

        function desplazar(fecha, dias) {
            const [y, m, d] = String(fecha).split("-").map(Number);
            const dt = new Date(Date.UTC(y, m - 1, d));
            dt.setUTCDate(dt.getUTCDate() + dias);
            return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
        }

        function diaSemanaIso(fecha) {
            const [y, m, d] = String(fecha).split("-").map(Number);
            return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        }

        function proximoDiaSemana(hoy, diaObjetivo) {
            const actual = diaSemanaIso(hoy);
            let diferencia = (diaObjetivo - actual + 7) % 7;
            if (diferencia === 0) diferencia = 7;
            return desplazar(hoy, diferencia);
        }

        function fechaPorDiaSemanaYNumero(hoy, diaObjetivo, numeroDia) {
            const dia = Number(numeroDia);
            if (!Number.isInteger(dia) || dia < 1 || dia > 31) return null;

            const [y, m] = hoy.split("-").map(Number);
            for (let saltoMes = 0; saltoMes <= 12; saltoMes++) {
                const base = new Date(Date.UTC(y, m - 1 + saltoMes, 1));
                const candidata = iso(
                    base.getUTCFullYear(),
                    base.getUTCMonth() + 1,
                    dia
                );
                if (!candidata || candidata < hoy) continue;
                if (diaSemanaIso(candidata) === diaObjetivo) return candidata;
            }
            return null;
        }

        function fechaNaturalDiaSemana(t, hoy) {
            const dias = Object.keys(DIAS_SEMANA).join("|");

            const conNumero = t.match(
                new RegExp(`\\b(?:el\\s+)?(?:proximo\\s+|este\\s+)?(${dias})\\s+(?:dia\\s+)?(\\d{1,2})(?:\\s+(?:proximo|siguiente))?\\b`)
            ) || t.match(
                new RegExp(`\\b(?:el\\s+)?(\\d{1,2})\\s+(?:proximo\\s+)?(${dias})\\b`)
            );

            if (conNumero) {
                const primerEsDia = Object.prototype.hasOwnProperty.call(DIAS_SEMANA, conNumero[1]);
                const nombreDia = primerEsDia ? conNumero[1] : conNumero[2];
                const numeroDia = primerEsDia ? conNumero[2] : conNumero[1];
                return fechaPorDiaSemanaYNumero(
                    hoy,
                    DIAS_SEMANA[nombreDia],
                    Number(numeroDia)
                );
            }

            const soloDia = t.match(
                new RegExp(`\\b(?:el\\s+)?(?:proximo\\s+|este\\s+)?(${dias})(?:\\s+proximo)?\\b`)
            );
            if (!soloDia) return null;

            return proximoDiaSemana(hoy, DIAS_SEMANA[soloDia[1]]);
        }

        function fechaDesdeTexto(valor) {
            const t = normalizar(valor);
            const hoy = fechaChileHoy();
            const anioActual = Number(hoy.slice(0, 4));
            if (/\bpasado\s+manana\b/.test(t)) return desplazar(hoy, 2);
            if (/\bmanana\b/.test(t)) return desplazar(hoy, 1);
            if (/\bayer\b/.test(t)) return desplazar(hoy, -1);
            if (/\bhoy\b|\bdia\s+de\s+hoy\b/.test(t)) return hoy;
            const numerica = t.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
            if (numerica) {
                let year = numerica[3] ? Number(numerica[3]) : anioActual;
                if (year < 100) year += 2000;
                return iso(year, Number(numerica[2]), Number(numerica[1]));
            }
            const meses = Object.keys(MESES).join("|");
            const escrita = t.match(new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${meses})(?:\\s+(?:de\\s+)?(20\\d{2}))?\\b`));
            if (escrita) return iso(escrita[3] ? Number(escrita[3]) : anioActual, MESES[escrita[2]], Number(escrita[1]));

            const natural = fechaNaturalDiaSemana(t, hoy);
            if (natural) return natural;

            return hoy;
        }

        function tieneAdjuntos() {
            return Boolean(adjuntosWrap?.querySelector(".haiku-asistente-adjunto"));
        }

        function esConsultaResumen(valor) {
            if (tieneAdjuntos()) return false;
            const t = normalizar(valor);
            if (!t) return false;
            if (/\b(?:marca|marcar|cambia|cambiar|pon|poner|pasa|pasar|crea|crear|agrega|agregar|registra|registrar|elimina|eliminar|borra|borrar)\b/.test(t)) return false;
            if (/\bresumen\b/.test(t) && /\b(?:dia|hoy|manana|ayer|operativo|operacion|turno)\b/.test(t)) return true;
            if (/^(?:cual\s+es\s+el\s+)?resumen\s*$/.test(t)) return true;
            if (/\bcomo\s+esta\s+(?:el\s+)?dia\b/.test(t)) return true;
            if (/\bque\s+(?:tenemos|hay)\s+(?:para\s+)?hoy\b/.test(t)) return true;
            return false;
        }

        function fechaVisible(fecha) {
            const m = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
            return m ? `${m[3]}-${m[2]}-${m[1]}` : String(fecha || "—");
        }

        function moneda(valor) {
            const n = Number(valor);
            return Number.isFinite(n) ? `$${Math.round(n).toLocaleString("es-CL")}` : "—";
        }

        function agregarMensaje(tipo, texto) {
            const div = document.createElement("div");
            div.className = `haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}`;
            div.textContent = texto;
            mensajes.appendChild(div);
            requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
            return div;
        }

        function limpiarAdjuntos() {
            [...(adjuntosWrap?.querySelectorAll(".haiku-asistente-quitar") || [])].forEach(boton => { try { boton.click(); } catch {} });
        }

        async function consultarOperacion(fecha) {
            const { data, error } = await cliente.rpc("haiku_operacion_dia", { p_fecha: fecha });
            if (error) throw error;
            return Array.isArray(data) ? data : [];
        }

        function itemOperacion(fila, tipo) {
            const fullDay = Boolean(fila?.fullday_estadia_id) || String(fila?.estado_operativo || "") === "fullday";
            const numeroCabana = String(fila?.numero || "");
            if (tipo === "ingresan") return { numeroCabana, titular: fullDay ? fila?.fullday_titular : fila?.ingreso_titular, meta: fullDay ? "Full Day" : "Ingreso", estado: fullDay ? "Full Day" : (fila?.ingreso_checkin_en ? "Hospedado" : "Por ingresar") };
            if (tipo === "salen") return { numeroCabana, titular: fullDay ? fila?.fullday_titular : fila?.salida_titular, meta: fullDay ? "Full Day" : "Salida", estado: fullDay ? "Full Day" : (fila?.salida_checkout_en ? "Checked Out" : "Por salir") };
            return { numeroCabana, titular: fila?.continua_titular, meta: "Continúa", estado: "En estadía" };
        }

        function separarOperacion(filas) {
            const ingresan = [], salen = [], continuan = [];
            (filas || []).forEach(fila => {
                const esFullDay = Boolean(fila?.fullday_estadia_id) || String(fila?.estado_operativo || "") === "fullday";
                if (fila?.ingreso_estadia_id || esFullDay) ingresan.push(itemOperacion(fila, "ingresan"));
                if (fila?.salida_estadia_id || esFullDay) salen.push(itemOperacion(fila, "salen"));
                if (fila?.continua_estadia_id || String(fila?.estado_operativo || "") === "continua") continuan.push(itemOperacion(fila, "continuan"));
            });
            const ordenar = lista => lista.sort((a, b) => Number(a.numeroCabana || 999) - Number(b.numeroCabana || 999));
            return { ingresan: ordenar(ingresan), salen: ordenar(salen), continuan: ordenar(continuan) };
        }

        function leerServiciosCache(fecha) {
            try {
                const lista = JSON.parse(localStorage.getItem("haikuServicios") || "[]");
                if (!Array.isArray(lista)) return [];
                return lista.filter(servicio => String(servicio?.fechaServicio || servicio?.fecha || "").slice(0, 10) === fecha && !["cancelado", "no_show"].includes(String(servicio?.estadoServicio || servicio?.estadoServicioDb || ""))).sort((a, b) => String(a?.hora || "").localeCompare(String(b?.hora || "")) || Number(a?.numeroCabana || 999) - Number(b?.numeroCabana || 999));
            } catch { return []; }
        }

        async function consultarServicios(fecha) {
            try { await window.HAIKU_SERVICIOS_HIDRATACION_V2?.sincronizar?.(); } catch {}
            return leerServiciosCache(fecha);
        }

        async function consultarPagos(fecha) {
            const api = window.HAIKU_PAGOS_PENDIENTES_SUPABASE_V1;
            if (!api) return [];
            try { await api.refrescar?.(fecha); } catch (error) { console.warn("HAKU · Resumen del día: pagos pendientes no disponibles:", error); }
            try { const lista = api.obtener?.(fecha); return Array.isArray(lista) ? lista : []; } catch { return []; }
        }

        function crearEstadistica(valor, etiqueta, clase = "") {
            const div = document.createElement("div");
            div.className = `haku-dia-stat${clase ? ` ${clase}` : ""}`;
            const strong = document.createElement("strong"); strong.textContent = String(valor);
            const span = document.createElement("span"); span.textContent = etiqueta;
            div.append(strong, span); return div;
        }

        function crearItem(cabana, titular, detalle, meta = "") {
            const item = document.createElement("div"); item.className = "haku-dia-item";
            const cab = document.createElement("span"); cab.className = "haku-dia-cab"; cab.textContent = cabana ? `CAB ${cabana}` : "CAB —";
            const main = document.createElement("div"); main.className = "haku-dia-main";
            const strong = document.createElement("strong"); strong.textContent = titular || "Sin titular";
            const span = document.createElement("span"); span.textContent = detalle || ""; main.append(strong, span);
            const final = document.createElement("span"); final.className = "haku-dia-meta"; final.textContent = meta || "";
            item.append(cab, main, final); return item;
        }

        function agregarSeccion(card, titulo, items, crearFila) {
            if (!items.length) return;
            const seccion = document.createElement("section"); seccion.className = "haku-dia-seccion";
            const cabecera = document.createElement("div"); cabecera.className = "haku-dia-seccion-titulo";
            const nombre = document.createElement("span"); nombre.textContent = titulo;
            const cantidad = document.createElement("em"); cantidad.textContent = `${items.length}`; cabecera.append(nombre, cantidad);
            const lista = document.createElement("div"); lista.className = "haku-dia-lista"; items.forEach(item => lista.appendChild(crearFila(item)));
            seccion.append(cabecera, lista); card.appendChild(seccion);
        }

        function renderizar(fecha, operacion, servicios, pagos) {
            const card = document.createElement("div"); card.className = "haiku-asistente-preview haku-dia-card";
            const head = document.createElement("div"); head.className = "haku-dia-head";
            const izq = document.createElement("div"); const kicker = document.createElement("p"); kicker.className = "haku-dia-kicker"; kicker.textContent = "Resumen operativo · sólo lectura";
            const titulo = document.createElement("h3"); titulo.className = "haku-dia-title"; titulo.textContent = "Resumen del día"; izq.append(kicker, titulo);
            const fechaChip = document.createElement("span"); fechaChip.className = "haku-dia-fecha"; fechaChip.textContent = fechaVisible(fecha); head.append(izq, fechaChip); card.appendChild(head);
            const stats = document.createElement("div"); stats.className = "haku-dia-stats";
            stats.append(crearEstadistica(operacion.ingresan.length, "Ingresan"), crearEstadistica(operacion.salen.length, "Salen"), crearEstadistica(operacion.continuan.length, "Continúan"), crearEstadistica(servicios.length, "Servicios"), crearEstadistica(pagos.length, "Pagos", "haku-dia-stat--pagos"));
            card.appendChild(stats);
            const todoVacio = !operacion.ingresan.length && !operacion.salen.length && !operacion.continuan.length && !servicios.length && !pagos.length;
            if (todoVacio) { const vacio = document.createElement("div"); vacio.className = "haku-dia-vacio"; vacio.textContent = "No encontré movimientos operativos para esta fecha."; card.appendChild(vacio); }
            agregarSeccion(card, "Ingresan", operacion.ingresan, item => crearItem(item.numeroCabana, item.titular, item.meta, item.estado));
            agregarSeccion(card, "Salen", operacion.salen, item => crearItem(item.numeroCabana, item.titular, item.meta, item.estado));
            agregarSeccion(card, "Continúan", operacion.continuan, item => crearItem(item.numeroCabana, item.titular, item.meta, item.estado));
            agregarSeccion(card, "Servicios programados", servicios, servicio => { const detalle = [servicio?.hora || "Sin hora", servicio?.nombre || "Servicio"].join(" · "); const estado = servicio?.estadoServicio === "realizado" ? "Realizado" : "Pendiente"; return crearItem(servicio?.numeroCabana, servicio?.titular, detalle, servicio?.cortesia ? `${estado} · Cortesía` : estado); });
            agregarSeccion(card, "Pagos pendientes", pagos, pago => crearItem(pago?.numeroCabana, pago?.titular, pago?.titulo || "Pago pendiente", moneda(pago?.monto)));
            if (pagos.length) { const totalPendiente = pagos.reduce((suma, pago) => suma + Number(pago?.monto || 0), 0); const alerta = document.createElement("div"); alerta.className = "haku-dia-alerta"; alerta.textContent = `💳 Hay ${pagos.length} ${pagos.length === 1 ? "pago pendiente" : "pagos pendientes"} por un total operativo de ${moneda(totalPendiente)}.`; card.appendChild(alerta); }
            const pie = document.createElement("div"); pie.className = "haku-dia-pie"; pie.textContent = "Datos leídos desde Proyecto H / Supabase · esta consulta no modificó ninguna reserva, pago ni servicio."; card.appendChild(pie);
            mensajes.appendChild(card); requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
        }

        async function procesar(textoOriginal) {
            if (ocupado || !esConsultaResumen(textoOriginal)) return;
            const fecha = fechaDesdeTexto(textoOriginal);
            campo.value = ""; limpiarAdjuntos(); agregarMensaje("usuario", textoOriginal);
            ocupado = true;
            const espera = agregarMensaje("asistente", `Preparando el resumen operativo del ${fechaVisible(fecha)}…`);
            try {
                const [filas, servicios, pagos] = await Promise.all([consultarOperacion(fecha), consultarServicios(fecha), consultarPagos(fecha)]);
                espera.remove(); renderizar(fecha, separarOperacion(filas), servicios, pagos);
            } catch (error) {
                console.error("HAKU · Resumen operativo del día:", error);
                espera.textContent = error?.message || "No pude preparar el resumen operativo de esa fecha.";
            } finally {
                ocupado = false; campo.dispatchEvent(new Event("input", { bubbles: true }));
            }
        }

        function interceptarClick(evento) {
            const texto = String(campo.value || "").trim();
            if (!esConsultaResumen(texto)) return;
            evento.preventDefault(); evento.stopImmediatePropagation(); procesar(texto);
        }

        function interceptarTeclado(evento) {
            if (evento.key !== "Enter" || evento.shiftKey) return;
            const texto = String(campo.value || "").trim();
            if (!esConsultaResumen(texto)) return;
            evento.preventDefault(); evento.stopImmediatePropagation(); procesar(texto);
        }

        enviar.addEventListener("click", interceptarClick, true);
        campo.addEventListener("keydown", interceptarTeclado, true);

        window.HAIKU_ASISTENTE_RESUMEN_DIA_V1 = Object.freeze({ esConsulta: esConsultaResumen, fechaDesdeTexto, procesar });
        console.info("HAKU · Resumen operativo del día V1 preparado.");
        return true;
    }

    if (instalar()) return;
    const observador = new MutationObserver(() => { if (!instalar()) return; observador.disconnect(); });
    observador.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("load", () => { if (instalar()) observador.disconnect(); }, { once: true });
})();