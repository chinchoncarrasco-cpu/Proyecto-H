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
// - Lectura de notas operativas del Resumen para la fecha consultada.
//
// No crea, edita ni elimina reservas, pagos, servicios o notas.
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

        const panel = mensajes.closest(".haiku-asistente-panel");
        const tituloPanel = panel?.querySelector("#haiku-asistente-titulo");
        const subtituloPanel = panel?.querySelector(".haiku-asistente-titulo span");
        const cerrarPanel = panel?.querySelector("#haiku-asistente-cerrar");
        const accionesPanel = panel?.querySelector(".haiku-asistente-cabecera-acciones");
        const tituloOriginal = tituloPanel?.textContent || "Haku";
        const subtituloOriginal = subtituloPanel?.textContent || "Asistente operativo";
        const chipLectura = document.createElement("span");
        chipLectura.className = "haku-dia-sites__cabecera-chip";
        chipLectura.textContent = "Solo lectura";
        chipLectura.hidden = true;
        accionesPanel?.insertBefore(chipLectura, cerrarPanel || null);

        function actualizarCabecera() {
            const activa = mensajes.lastElementChild?.classList.contains("haku-dia-sites") === true;
            panel?.classList.toggle("haiku-asistente-panel--resumen-dia", activa);
            if (tituloPanel) tituloPanel.textContent = activa ? "Tareas de hoy" : tituloOriginal;
            if (subtituloPanel) subtituloPanel.textContent = activa ? "HAKU · ASISTENTE OPERATIVO" : subtituloOriginal;
            chipLectura.hidden = !activa;
        }
        new MutationObserver(actualizarCabecera).observe(mensajes, { childList: true });
        actualizarCabecera();

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

        async function consultarNotas(fecha) {
            try {
                const api = window.HAIKU_NOTAS_RESUMEN_SUPABASE_V1;
                if (typeof api?.consultar !== "function") throw new Error("Lectura de notas no disponible.");
                const items = await api.consultar(fecha);
                if (!Array.isArray(items)) throw new Error("Respuesta de notas no disponible.");
                return { items, error: "" };
            } catch (error) {
                console.warn("HAKU · Resumen del día: notas no disponibles:", error);
                return { items: [], error: "No pude consultar las notas de esta fecha. Vuelve a pedir el resumen para reintentar." };
            }
        }

        function crearNodo(etiqueta, clase, texto) {
            const nodo = document.createElement(etiqueta);
            nodo.className = clase;
            if (texto !== undefined) nodo.textContent = texto;
            return nodo;
        }

        // Mismo trazo que los iconos del Resumen y del menú Sites, sin dependencias.
        function crearIcono(tipo, clase = "") {
            const trazos = {
                ingresan: "M12 3v13m0 0-5-5m5 5 5-5M4 20h16",
                salen: "M12 20V7m0 0-5 5m5-5 5 5M4 4h16",
                continuan: "m3 10 9-7 9 7v10H3zM9 20v-7h6v7",
                servicios: "M4 17h16M6 17a6 6 0 0 1 12 0M12 11V8M3 21h18",
                pagos: "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM2 10h20M6 15h4",
                notas: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM9 8h6M9 12h6M9 16h4",
                chevron: "m8 10 4 4 4-4",
                candado: "M7 10V7a5 5 0 0 1 10 0v3M6 10h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM12 14v3"
            };
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("class", `haku-dia-sites__icono ${clase}`.trim());
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("aria-hidden", "true");
            svg.setAttribute("focusable", "false");
            const trazo = document.createElementNS("http://www.w3.org/2000/svg", "path");
            trazo.setAttribute("d", trazos[tipo]);
            svg.appendChild(trazo);
            return svg;
        }

        function fechaEtiqueta(fecha) {
            const partes = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!partes) return fechaVisible(fecha);
            const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
            return `${partes[3]} ${meses[Number(partes[2]) - 1]} ${partes[1]}`;
        }

        function crearEstadistica(valor, etiqueta, clase = "") {
            const metrica = crearNodo("div", `haku-dia-sites__metrica ${clase}`.trim());
            metrica.append(
                crearNodo("strong", "haku-dia-sites__valor", String(valor)),
                crearNodo("span", "haku-dia-sites__etiqueta", etiqueta)
            );
            return metrica;
        }

        function crearItem(cabana, titular, detalle, meta = "", valor = "") {
            const item = crearNodo("div", "haku-dia-sites__fila");
            if (cabana) item.appendChild(crearNodo("span", "haku-dia-sites__cab", `CAB ${cabana}`));
            else item.classList.add("haku-dia-sites__fila--sin-cabana");
            const principal = crearNodo("div", "haku-dia-sites__principal");
            principal.append(
                crearNodo("strong", "", titular || "Sin titular"),
                crearNodo("span", "", detalle || "")
            );
            const final = crearNodo("span", "haku-dia-sites__meta");
            if (valor) final.appendChild(crearNodo("strong", "", valor));
            final.appendChild(crearNodo("span", "", meta || ""));
            item.append(principal, final);
            return item;
        }

        function agregarSeccion(card, { titulo, icono, items, crearFila, vacio, error }) {
            const seccion = crearNodo("details", "haku-dia-sites__seccion");
            const cabecera = crearNodo("summary", "haku-dia-sites__seccion-titulo");
            cabecera.append(
                crearIcono(icono),
                crearNodo("span", "haku-dia-sites__seccion-nombre", titulo),
                crearNodo("span", "haku-dia-sites__seccion-contador", error ? "—" : String(items.length)),
                crearIcono("chevron", "haku-dia-sites__chevron")
            );
            const lista = crearNodo("div", "haku-dia-sites__lista");
            items.forEach(item => lista.appendChild(crearFila(item)));
            if (error || !items.length) lista.appendChild(crearNodo("p", "haku-dia-sites__vacio", error || vacio));
            seccion.append(cabecera, lista);
            card.appendChild(seccion);
        }

        function renderizar(fecha, operacion, servicios, pagos, notas, mensajeUsuario) {
            const filaOperacion = item => crearItem(item.numeroCabana, item.titular, item.meta, item.estado);
            const categorias = [
                { titulo: "Ingresan", icono: "ingresan", items: operacion.ingresan, crearFila: filaOperacion, vacio: "No hay ingresos para esta fecha." },
                { titulo: "Salen", icono: "salen", items: operacion.salen, crearFila: filaOperacion, vacio: "No hay salidas para esta fecha." },
                { titulo: "Continúan", icono: "continuan", items: operacion.continuan, crearFila: filaOperacion, vacio: "No hay estadías que continúen para esta fecha." },
                { titulo: "Servicios", icono: "servicios", items: servicios, vacio: "No hay servicios para esta fecha.", crearFila: servicio => {
                    const detalle = servicio?.nombre || "Servicio";
                    const estado = servicio?.estadoServicio === "realizado" ? "Realizado" : "Pendiente";
                    return crearItem(servicio?.numeroCabana, servicio?.titular, detalle, servicio?.cortesia ? `${estado} · Cortesía` : estado, servicio?.hora || "Sin hora");
                } },
                { titulo: "Pagos", icono: "pagos", items: pagos, vacio: "No hay pagos pendientes para esta fecha.",
                    crearFila: pago => crearItem(pago?.numeroCabana, pago?.titular, pago?.titulo || "Pago pendiente", moneda(pago?.monto)) },
                { titulo: "Notas de hoy", icono: "notas", items: notas.items, error: notas.error, vacio: "No hay notas operativas para esta fecha.", crearFila: nota => {
                    const fila = crearItem(nota.cabana, "Nota operativa", nota.texto, "Operativa");
                    fila.classList.add("haku-dia-sites__fila--nota");
                    return fila;
                } }
            ];
            const vista = crearNodo("article", "haiku-asistente-preview haku-dia-sites");
            if (mensajeUsuario) {
                mensajeUsuario.classList.add("haku-dia-sites__mensaje-usuario");
                vista.appendChild(mensajeUsuario);
            }

            const card = crearNodo("section", "haku-dia-card haku-dia-sites__tarjeta");
            const head = crearNodo("header", "haku-dia-sites__tarjeta-head");
            const titulo = crearNodo("div", "haku-dia-sites__tarjeta-titulos");
            titulo.append(
                crearNodo("span", "", "RESUMEN OPERATIVO"),
                crearNodo("h3", "", "Tareas de hoy")
            );
            head.append(
                titulo, crearNodo("span", "haku-dia-sites__fecha", fechaEtiqueta(fecha)),
                crearNodo("p", "haku-dia-sites__descripcion", "Tu operación del día, ordenada por categoría.")
            );
            card.appendChild(head);

            const metricas = crearNodo("div", "haku-dia-sites__metricas");
            categorias.forEach(categoria => metricas.appendChild(crearEstadistica(
                categoria.error ? "—" : categoria.items.length, categoria.titulo,
                categoria.titulo === "Pagos" && pagos.length ? "haku-dia-sites__metrica--pagos" : ""
            )));
            card.appendChild(metricas);
            card.appendChild(crearNodo("p", "haku-dia-sites__ayuda", "Despliega una categoría para ver el detalle."));

            const todoVacio = categorias.every(categoria => !categoria.error && !categoria.items.length);
            if (todoVacio) card.appendChild(crearNodo("p", "haku-dia-sites__vacio", "No encontré movimientos operativos para esta fecha."));
            categorias.forEach(categoria => agregarSeccion(card, categoria));

            if (pagos.length) {
                const totalPendiente = pagos.reduce((suma, pago) => suma + Number(pago?.monto || 0), 0);
                const alerta = crearNodo("div", "haku-dia-sites__alerta");
                alerta.append(
                    crearIcono("pagos", "haku-dia-sites__alerta-icono"),
                    crearNodo("span", "", `${pagos.length} ${pagos.length === 1 ? "pago pendiente" : "pagos pendientes"} · ${moneda(totalPendiente)} CLP`)
                );
                card.appendChild(alerta);
            }

            const pie = crearNodo("p", "haku-dia-sites__pie");
            pie.append(crearIcono("candado"), crearNodo("span", "", "Consulta de solo lectura. No modifica reservas, pagos, servicios ni notas."));
            card.appendChild(pie);
            vista.appendChild(card);
            mensajes.appendChild(vista);
            actualizarCabecera();
            requestAnimationFrame(() => {
                mensajes.scrollTop += vista.getBoundingClientRect().top - mensajes.getBoundingClientRect().top;
            });
        }

        async function procesar(textoOriginal) {
            if (ocupado || !esConsultaResumen(textoOriginal)) return;
            const fecha = fechaDesdeTexto(textoOriginal);
            campo.value = ""; limpiarAdjuntos(); const mensajeUsuario = agregarMensaje("usuario", textoOriginal);
            ocupado = true;
            const espera = agregarMensaje("asistente", `Preparando el resumen operativo del ${fechaVisible(fecha)}…`);
            try {
                const [filas, servicios, pagos, notas] = await Promise.all([consultarOperacion(fecha), consultarServicios(fecha), consultarPagos(fecha), consultarNotas(fecha)]);
                espera.remove(); renderizar(fecha, separarOperacion(filas), servicios, pagos, notas, mensajeUsuario);
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
