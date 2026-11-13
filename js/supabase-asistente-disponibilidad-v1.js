// ========================================
// HAKU · DISPONIBILIDAD V2
// Consultas de solo lectura para:
// - cabañas por vender / disponibilidad de alojamiento
// - horarios disponibles de Tinaja Jacuzzi / Tinaja Tónel
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_DISPONIBILIDAD_BOOT_V1) return;
    window.HAIKU_ASISTENTE_DISPONIBILIDAD_BOOT_V1 = true;

    const MESES = Object.freeze({
        enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
        julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
        noviembre: 11, diciembre: 12
    });

    function instalar() {
        if (window.HAIKU_ASISTENTE_DISPONIBILIDAD_V1) return true;

        const cliente = window.haikuSupabase;
        const campo = document.getElementById("haiku-asistente-texto");
        const enviar = document.getElementById("haiku-asistente-enviar");
        const mensajes = document.getElementById("haiku-asistente-mensajes");
        const adjuntosWrap = document.getElementById("haiku-asistente-adjuntos");
        if (!cliente || !campo || !enviar || !mensajes) return false;

        let ocupado = false;

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
                timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit"
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

        function esEscritura(t) {
            return /\b(?:crea|crear|agrega|agregar|registra|registrar|bloquea|bloquear|elimina|eliminar|borra|borrar|mueve|mover|cambia|cambiar|reserva|reservar|agenda|agendar)\b/.test(t);
        }

        function tipoServicioConsulta(valor) {
            const t = normalizar(valor);
            if (/\bjacuzzi\b/.test(t)) return "jacuzzi";
            if (/\btonel\b/.test(t)) return "tonel";
            if (/\b(?:tinaja|tinajas)\b/.test(t)) return "ambas";
            return null;
        }

        function esConsultaDisponibilidadServicio(valor) {
            const t = normalizar(valor);
            if (!t || esEscritura(t)) return false;
            if (!tipoServicioConsulta(t)) return false;
            const disponibilidad = /\b(?:disponible|disponibles|disponibilidad|libre|libres|horario|horarios|hora|horas)\b/.test(t);
            const pregunta = /\b(?:dime|muestra|mostrar|revisa|revisar|consulta|consultar|hay|que|cuales|cuantos|cuantas)\b/.test(t);
            return disponibilidad || pregunta;
        }

        function esConsultaDisponibilidadCabana(valor) {
            const t = normalizar(valor);
            if (!t || esEscritura(t)) return false;

            // Si se menciona un servicio, jamás debe caer en disponibilidad de cabañas.
            if (/\b(?:jacuzzi|tonel|tinaja|tinajas|masaje|masajes|servicio|servicios)\b/.test(t)) return false;

            const pregunta = /\b(?:cuant[ao]s?|que|cuales|lista|listar|muestra|mostrar|dime|revisa|revisar|consulta|consultar|hay)\b/.test(t);
            const disponibilidad = /\b(?:disponible|disponibles|disponibilidad|libre|libres)\b/.test(t);
            const venta = /\b(?:faltan?|quedan?)\s+(?:por\s+)?vender\b/.test(t)
                || /\bpor\s+vender\b/.test(t)
                || /\bventa\s+disponible\b/.test(t);
            const cabanas = /\b(?:cabana|cabanas|habitacion|habitaciones)\b/.test(t);
            return venta || (disponibilidad && (pregunta || cabanas));
        }

        function esConsultaDisponibilidad(valor) {
            return esConsultaDisponibilidadServicio(valor) || esConsultaDisponibilidadCabana(valor);
        }

        function fechaVisible(fecha) {
            const m = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
            return m ? `${m[3]}-${m[2]}-${m[1]}` : String(fecha || "—");
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
            [...(adjuntosWrap?.querySelectorAll(".haiku-asistente-quitar") || [])].forEach(b => {
                try { b.click(); } catch {}
            });
        }

        async function buscarDisponibles(fecha) {
            const salida = desplazar(fecha, 1);
            if (!salida) throw new Error("No pude calcular la noche consultada.");
            const { data, error } = await cliente.rpc("haiku_cabanas_disponibles", {
                p_fecha_ingreso: fecha,
                p_fecha_salida: salida,
                p_tipo_estadia: "alojamiento"
            });
            if (error) throw error;
            return (Array.isArray(data) ? data : [])
                .slice()
                .sort((a, b) => Number(a?.numero || 999) - Number(b?.numero || 999));
        }

        async function buscarHorariosServicio(tipo, fecha) {
            try { await window.haikuSincronizarServiciosDesdeSupabase?.(); } catch {}
            const api = window.HAIKU_SERVICIOS_TINAJAS_HORARIOS_V1;
            if (typeof api?.horariosDisponibles !== "function") {
                throw new Error("No pude comprobar los horarios de tinaja. Vuelve a intentarlo.");
            }
            return api.horariosDisponibles(tipo, fecha);
        }

        function nodo(tag, clase, texto = "") {
            const el = document.createElement(tag);
            el.className = clase;
            el.textContent = texto;
            return el;
        }

        function cabeceraCard(titulo, fecha, contexto) {
            const card = nodo("article", "haku-respuesta-compacta haku-disponibilidad-card");
            const head = nodo("header", "haku-respuesta__cabecera");
            head.append(nodo("h3", "haku-disponibilidad-title", titulo),
                nodo("span", "haku-respuesta__contexto", [fechaVisible(fecha), contexto].filter(Boolean).join(" · ")));
            card.appendChild(head);
            return card;
        }

        function montar(card, fuente) {
            card.appendChild(nodo("p", "haku-respuesta__nota", fuente));
            mensajes.appendChild(card);
            requestAnimationFrame(() => card.scrollIntoView?.({ block: "start" }));
        }

        function etiquetas(valores) {
            const lista = nodo("ul", "haku-respuesta__etiquetas");
            for (const valor of valores) lista.appendChild(nodo("li", "", valor));
            return lista;
        }

        function renderizarCabanas(fecha, disponibles) {
            const cantidad = `${disponibles.length} ${disponibles.length === 1 ? "disponible" : "disponibles"}`;
            const card = cabeceraCard("Cabañas por vender", fecha, cantidad);
            if (disponibles.length) {
                card.appendChild(etiquetas(disponibles.map(fila => fila?.numero ? `CAB ${fila.numero}` : (fila?.nombre || "Cabaña"))));
            } else {
                card.appendChild(nodo("p", "haku-respuesta__vacio", "Sin cabañas disponibles para alojamiento esa noche."));
            }
            montar(card, "Disponibilidad de la noche según reservas vigentes y bloqueos activos.");
        }

        function bloqueServicio(titulo, horarios) {
            const bloque = nodo("section", "haku-disponibilidad-servicio");
            const head = nodo("header", "haku-disponibilidad-servicio-head");
            head.append(nodo("strong", "", titulo),
                nodo("span", "haku-respuesta__contexto", `${horarios.length} ${horarios.length === 1 ? "libre" : "libres"}`));
            bloque.appendChild(head);
            bloque.appendChild(horarios.length ? etiquetas(horarios.map(h => `${h.inicio}–${h.fin}`))
                : nodo("p", "haku-respuesta__vacio", "Sin horarios disponibles."));
            return bloque;
        }

        async function renderizarServicio(fecha, tipo) {
            const ambas = tipo === "ambas";
            const titulo = ambas ? "Horarios libres de tinajas" : tipo === "jacuzzi" ? "Horarios libres · Jacuzzi" : "Horarios libres · Tónel";
            const card = cabeceraCard(titulo, fecha);
            card.classList.add("haku-disponibilidad-card--servicio");
            const servicios = nodo("div", "haku-disponibilidad-servicios");
            if (ambas || tipo === "tonel") servicios.appendChild(bloqueServicio("Tónel", await buscarHorariosServicio("tonel", fecha)));
            if (ambas || tipo === "jacuzzi") servicios.appendChild(bloqueServicio("Jacuzzi", await buscarHorariosServicio("jacuzzi", fecha)));
            card.appendChild(servicios);
            montar(card, "Los servicios cancelados liberan su horario.");
        }

        async function procesar(textoOriginal) {
            if (ocupado || !esConsultaDisponibilidad(textoOriginal)) return;
            const fecha = fechaDesdeTexto(textoOriginal);
            const esServicio = esConsultaDisponibilidadServicio(textoOriginal);
            const tipoServicio = esServicio ? tipoServicioConsulta(textoOriginal) : null;

            campo.value = "";
            limpiarAdjuntos();
            agregarMensaje("usuario", textoOriginal);

            if (!fecha) {
                agregarMensaje("asistente", "Indícame una fecha, por ejemplo: 17 de septiembre, 17/09 o mañana.");
                campo.dispatchEvent(new Event("input", { bubbles: true }));
                return;
            }

            ocupado = true;
            const espera = agregarMensaje("asistente", esServicio
                ? `Revisando horarios disponibles para el ${fechaVisible(fecha)}…`
                : `Revisando qué queda por vender para el ${fechaVisible(fecha)}…`);

            try {
                if (esServicio) {
                    await renderizarServicio(fecha, tipoServicio);
                    espera.remove();
                } else {
                    const disponibles = await buscarDisponibles(fecha);
                    espera.remove();
                    renderizarCabanas(fecha, disponibles);
                }
            } catch (error) {
                console.error("HAKU · Consulta de disponibilidad:", error);
                espera.textContent = error?.message || "No pude consultar la disponibilidad de esa fecha.";
            } finally {
                ocupado = false;
                campo.dispatchEvent(new Event("input", { bubbles: true }));
            }
        }

        function interceptarClick(evento) {
            const texto = String(campo.value || "").trim();
            if (!esConsultaDisponibilidad(texto)) return;
            evento.preventDefault();
            evento.stopImmediatePropagation();
            procesar(texto);
        }

        function interceptarTeclado(evento) {
            if (evento.key !== "Enter" || evento.shiftKey) return;
            const texto = String(campo.value || "").trim();
            if (!esConsultaDisponibilidad(texto)) return;
            evento.preventDefault();
            evento.stopImmediatePropagation();
            procesar(texto);
        }

        enviar.addEventListener("click", interceptarClick, true);
        campo.addEventListener("keydown", interceptarTeclado, true);

        window.HAIKU_ASISTENTE_DISPONIBILIDAD_V1 = Object.freeze({
            esConsultaDisponibilidad,
            esConsultaDisponibilidadCabana,
            esConsultaDisponibilidadServicio,
            tipoServicioConsulta,
            fechaDesdeTexto,
            procesar,
            buscarDisponibles,
            buscarHorariosServicio
        });

        console.info("HAKU · Disponibilidad V2 preparada: cabañas + tinajas.");
        return true;
    }

    if (instalar()) return;

    let intentos = 0;
    const maxIntentos = 40;
    const timer = window.setInterval(() => {
        intentos++;
        if (instalar() || intentos >= maxIntentos) window.clearInterval(timer);
    }, 150);
})();