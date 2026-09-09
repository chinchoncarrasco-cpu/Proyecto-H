// ========================================
// HAKU · DISPONIBILIDAD / POR VENDER V1
// Consultas de solo lectura para saber cuántas cabañas quedan disponibles
// para alojamiento en una fecha y cuáles son.
// Ejemplos:
// - "Haku cuántas faltan por vender el 17 de septiembre?"
// - "Haku cuántas quedan por vender mañana?"
// - "Haku qué cabañas están disponibles el 17/09?"
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_DISPONIBILIDAD_BOOT_V1) return;
    window.HAIKU_ASISTENTE_DISPONIBILIDAD_BOOT_V1 = true;

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

    function instalar() {
        if (window.HAIKU_ASISTENTE_DISPONIBILIDAD_V1) return true;

        const cliente = window.haikuSupabase;
        const campo = document.getElementById("haiku-asistente-texto");
        const enviar = document.getElementById("haiku-asistente-enviar");
        const mensajes = document.getElementById("haiku-asistente-mensajes");
        const adjuntosWrap = document.getElementById("haiku-asistente-adjuntos");

        if (!cliente || !campo || !enviar || !mensajes) return false;

        let ocupado = false;

        function instalarEstilos() {
            if (document.getElementById("haku-disponibilidad-estilos-v1")) return;

            const style = document.createElement("style");
            style.id = "haku-disponibilidad-estilos-v1";
            style.textContent = `
                .haku-disponibilidad-card {
                    --haku-disp-accent: #26704c;
                    --haku-disp-soft: #edf7f0;
                    --haku-disp-border: #c8ded0;
                    border: 1px solid var(--haku-disp-border);
                    border-radius: 16px;
                    background: linear-gradient(180deg, #fbfdfb 0%, #f7faf8 100%);
                    padding: 14px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    box-shadow: 0 5px 16px rgba(28, 69, 47, .055);
                }
                .haku-disponibilidad-head {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 12px;
                    padding-bottom: 9px;
                    border-bottom: 1px solid #deebe2;
                }
                .haku-disponibilidad-kicker {
                    margin: 0 0 2px;
                    font-size: 10px;
                    line-height: 1.2;
                    font-weight: 800;
                    letter-spacing: .09em;
                    text-transform: uppercase;
                    color: var(--haku-disp-accent);
                }
                .haku-disponibilidad-title {
                    margin: 0;
                    font-size: 19px;
                    line-height: 1.15;
                    font-weight: 800;
                    color: #17251c;
                }
                .haku-disponibilidad-fecha {
                    flex: 0 0 auto;
                    display: inline-flex;
                    align-items: center;
                    min-height: 26px;
                    padding: 4px 9px;
                    border: 1px solid var(--haku-disp-border);
                    border-radius: 999px;
                    background: var(--haku-disp-soft);
                    color: var(--haku-disp-accent);
                    font-size: 11px;
                    line-height: 1;
                    font-weight: 800;
                    white-space: nowrap;
                }
                .haku-disponibilidad-resumen {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    min-height: 46px;
                    padding: 9px 11px;
                    border: 1px solid #dbe8df;
                    border-radius: 12px;
                    background: rgba(255,255,255,.86);
                    color: #344039;
                    font-size: 12px;
                }
                .haku-disponibilidad-cantidad {
                    flex: 0 0 auto;
                    display: grid;
                    place-items: center;
                    min-width: 34px;
                    height: 34px;
                    padding: 0 5px;
                    border-radius: 10px;
                    background: var(--haku-disp-accent);
                    color: #fff;
                    font-size: 16px;
                    font-weight: 900;
                    box-sizing: border-box;
                }
                .haku-disponibilidad-listado {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px;
                }
                .haku-disponibilidad-cab {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 27px;
                    padding: 4px 9px;
                    border: 1px solid #d6e5db;
                    border-radius: 9px;
                    background: #fff;
                    color: #315b43;
                    font-size: 10px;
                    font-weight: 850;
                }
                .haku-disponibilidad-vacio {
                    padding: 9px 10px;
                    border: 1px dashed var(--haku-disp-border);
                    border-radius: 10px;
                    background: var(--haku-disp-soft);
                    color: #53645a;
                    font-size: 11px;
                }
                .haku-disponibilidad-nota {
                    color: #6b776f;
                    font-size: 10px;
                    line-height: 1.35;
                }
                .haku-disponibilidad-pie {
                    padding-top: 7px;
                    border-top: 1px solid #e0e9e3;
                    color: #758078;
                    font-size: 10px;
                    line-height: 1.25;
                }
                @media (max-width: 620px) {
                    .haku-disponibilidad-card { padding: 11px; gap: 8px; }
                    .haku-disponibilidad-title { font-size: 17px; }
                }
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

        function esConsultaDisponibilidad(valor) {
            const t = normalizar(valor);
            if (!t) return false;

            // Nunca interceptar una instrucción de escritura.
            if (/\b(?:crea|crear|agrega|agregar|registra|registrar|bloquea|bloquear|elimina|eliminar|borra|borrar|mueve|mover|cambia|cambiar)\b/.test(t)) {
                return false;
            }

            const pregunta = /\b(?:cuant[ao]s?|que|cuales|lista|listar|muestra|mostrar|dime|revisa|revisar|consulta|consultar|hay)\b/.test(t);
            const disponibilidad = /\b(?:disponible|disponibles|disponibilidad|libre|libres)\b/.test(t);
            const venta = /\b(?:faltan?|quedan?)\s+(?:por\s+)?vender\b/.test(t)
                || /\bpor\s+vender\b/.test(t)
                || /\bventa\s+disponible\b/.test(t);
            const cabanas = /\b(?:cabana|cabanas|habitacion|habitaciones)\b/.test(t);

            return venta || (disponibilidad && (pregunta || cabanas));
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

        function renderizar(fecha, disponibles) {
            const card = document.createElement("div");
            card.className = "haiku-asistente-preview haku-disponibilidad-card";

            const cabecera = document.createElement("div");
            cabecera.className = "haku-disponibilidad-head";

            const izq = document.createElement("div");
            const kicker = document.createElement("div");
            kicker.className = "haku-disponibilidad-kicker";
            kicker.textContent = "Consulta · sólo lectura";
            const titulo = document.createElement("h3");
            titulo.className = "haku-disponibilidad-title";
            titulo.textContent = "Cabañas por vender";
            izq.append(kicker, titulo);

            const fechaChip = document.createElement("span");
            fechaChip.className = "haku-disponibilidad-fecha";
            fechaChip.textContent = fechaVisible(fecha);
            cabecera.append(izq, fechaChip);
            card.appendChild(cabecera);

            const resumen = document.createElement("div");
            resumen.className = "haku-disponibilidad-resumen";
            const cantidad = document.createElement("span");
            cantidad.className = "haku-disponibilidad-cantidad";
            cantidad.textContent = String(disponibles.length);
            const textoResumen = document.createElement("span");
            textoResumen.textContent = disponibles.length === 1
                ? `Queda 1 cabaña por vender para la noche del ${fechaVisible(fecha)}.`
                : `Quedan ${disponibles.length} cabañas por vender para la noche del ${fechaVisible(fecha)}.`;
            resumen.append(cantidad, textoResumen);
            card.appendChild(resumen);

            if (disponibles.length) {
                const listado = document.createElement("div");
                listado.className = "haku-disponibilidad-listado";
                disponibles.forEach(fila => {
                    const item = document.createElement("span");
                    item.className = "haku-disponibilidad-cab";
                    item.textContent = fila?.numero ? `CAB ${fila.numero}` : (fila?.nombre || "Cabaña");
                    listado.appendChild(item);
                });
                card.appendChild(listado);
            } else {
                const vacio = document.createElement("div");
                vacio.className = "haku-disponibilidad-vacio";
                vacio.textContent = "No quedan cabañas disponibles para vender como alojamiento esa noche.";
                card.appendChild(vacio);
            }

            const nota = document.createElement("div");
            nota.className = "haku-disponibilidad-nota";
            nota.textContent = "Calculado con la disponibilidad real de HAKU: reservas vigentes y bloqueos activos.";
            card.appendChild(nota);

            const pie = document.createElement("div");
            pie.className = "haku-disponibilidad-pie";
            pie.textContent = "Sólo lectura · esta consulta no modificó ninguna reserva.";
            card.appendChild(pie);

            mensajes.appendChild(card);
            requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
        }

        async function procesar(textoOriginal) {
            if (ocupado || !esConsultaDisponibilidad(textoOriginal)) return;

            const fecha = fechaDesdeTexto(textoOriginal);
            campo.value = "";
            limpiarAdjuntos();
            agregarMensaje("usuario", textoOriginal);

            if (!fecha) {
                agregarMensaje("asistente", "Indícame una fecha, por ejemplo: 17 de septiembre, 17/09 o mañana.");
                campo.dispatchEvent(new Event("input", { bubbles: true }));
                return;
            }

            ocupado = true;
            const espera = agregarMensaje("asistente", `Revisando qué queda por vender para el ${fechaVisible(fecha)}…`);

            try {
                const disponibles = await buscarDisponibles(fecha);
                espera.remove();
                renderizar(fecha, disponibles);
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
            fechaDesdeTexto,
            procesar,
            buscarDisponibles
        });

        console.info("HAKU · Disponibilidad / por vender V1 preparada.");
        return true;
    }

    if (instalar()) return;

    // Haku puede cargarse después de este complemento; reintentamos sólo durante
    // el arranque y luego nos detenemos, sin polling permanente.
    let intentos = 0;
    const maxIntentos = 40;
    const timer = window.setInterval(() => {
        intentos++;
        if (instalar() || intentos >= maxIntentos) window.clearInterval(timer);
    }, 150);
})();
