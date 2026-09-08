// ========================================
// HAKU · CONSULTA DE INGRESOS POR FECHA V1
// Preguntas de solo lectura como:
// "Haku cuantas reservas ingresan el jueves 17 de septiembre?"
// Consulta Proyecto H directamente y no crea/modifica registros.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_CONSULTA_INGRESOS_BOOT_V1) return;
    window.HAIKU_ASISTENTE_CONSULTA_INGRESOS_BOOT_V1 = true;

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
        if (window.HAIKU_ASISTENTE_CONSULTA_INGRESOS_V1) return true;

        const cliente = window.haikuSupabase;
        const campo = document.getElementById("haiku-asistente-texto");
        const enviar = document.getElementById("haiku-asistente-enviar");
        const mensajes = document.getElementById("haiku-asistente-mensajes");
        const adjuntosWrap = document.getElementById("haiku-asistente-adjuntos");

        // El panel arma Haku de forma dinámica. Si aún no existe, el bootstrap
        // permanece esperando sólo hasta que aparezca el asistente.
        if (!cliente || !campo || !enviar || !mensajes) return false;

        let ocupado = false;

        function instalarEstilos() {
            if (document.getElementById("haku-ingresos-fecha-estilos-v1")) return;

            const style = document.createElement("style");
            style.id = "haku-ingresos-fecha-estilos-v1";
            style.textContent = `
                .haku-ingresos-card {
                    border: 1px solid #c9ddd0;
                    border-radius: 16px;
                    background: linear-gradient(180deg, #fbfdfb 0%, #f7faf8 100%);
                    padding: 14px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    box-shadow: 0 5px 16px rgba(28, 69, 47, .055);
                }

                .haku-ingresos-head {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 12px;
                    padding-bottom: 9px;
                    border-bottom: 1px solid #deebe2;
                }

                .haku-ingresos-kicker {
                    margin: 0 0 2px;
                    font-size: 10px;
                    line-height: 1.2;
                    font-weight: 800;
                    letter-spacing: .09em;
                    text-transform: uppercase;
                    color: #397352;
                }

                .haku-ingresos-title {
                    margin: 0;
                    font-size: 19px;
                    line-height: 1.15;
                    font-weight: 800;
                    color: #17251c;
                }

                .haku-ingresos-fecha {
                    flex: 0 0 auto;
                    display: inline-flex;
                    align-items: center;
                    min-height: 26px;
                    padding: 4px 9px;
                    border: 1px solid #d3e5d9;
                    border-radius: 999px;
                    background: #edf7f0;
                    color: #2e6346;
                    font-size: 11px;
                    line-height: 1;
                    font-weight: 800;
                    white-space: nowrap;
                }

                .haku-ingresos-resumen {
                    display: flex;
                    align-items: center;
                    gap: 9px;
                    min-height: 42px;
                    padding: 8px 11px;
                    border: 1px solid #dbe8df;
                    border-radius: 12px;
                    background: rgba(255,255,255,.82);
                    color: #344039;
                    font-size: 12px;
                }

                .haku-ingresos-cantidad {
                    flex: 0 0 auto;
                    display: grid;
                    place-items: center;
                    width: 28px;
                    height: 28px;
                    border-radius: 9px;
                    background: #1f7650;
                    color: #fff;
                    font-size: 13px;
                    font-weight: 900;
                    box-shadow: 0 3px 8px rgba(31, 118, 80, .16);
                }

                .haku-ingresos-listado-wrap {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    min-height: 0;
                }

                .haku-ingresos-listado-titulo {
                    margin: 0 1px;
                    font-size: 11px;
                    font-weight: 800;
                    color: #3f5848;
                }

                .haku-ingresos-lista {
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                    max-height: 235px;
                    overflow-y: auto;
                    padding-right: 2px;
                    scrollbar-width: thin;
                }

                .haku-ingresos-item {
                    display: grid;
                    grid-template-columns: auto minmax(0, 1fr) auto;
                    align-items: center;
                    gap: 9px;
                    min-height: 43px;
                    padding: 6px 8px;
                    border: 1px solid #e0e9e3;
                    border-radius: 11px;
                    background: #fff;
                }

                .haku-ingresos-cab {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 48px;
                    min-height: 25px;
                    padding: 3px 7px;
                    border-radius: 8px;
                    background: #edf7f0;
                    color: #2d6847;
                    font-size: 10px;
                    font-weight: 900;
                    white-space: nowrap;
                }

                .haku-ingresos-main {
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 1px;
                }

                .haku-ingresos-titular {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 12px;
                    line-height: 1.25;
                    font-weight: 800;
                    color: #222f27;
                }

                .haku-ingresos-meta {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 10px;
                    line-height: 1.25;
                    color: #78847b;
                }

                .haku-ingresos-estado {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 23px;
                    padding: 3px 8px;
                    border: 1px solid #d7e7dc;
                    border-radius: 999px;
                    background: #f0f8f2;
                    color: #397052;
                    font-size: 9px;
                    font-weight: 800;
                    white-space: nowrap;
                }

                .haku-ingresos-aviso {
                    padding: 7px 9px;
                    border: 1px solid #ecdcb8;
                    border-radius: 10px;
                    background: #fff8e9;
                    color: #765f2c;
                    font-size: 10px;
                    line-height: 1.35;
                }

                .haku-ingresos-pie {
                    padding-top: 7px;
                    border-top: 1px solid #e0e9e3;
                    color: #758078;
                    font-size: 10px;
                    line-height: 1.25;
                }

                @media (max-width: 620px) {
                    .haku-ingresos-card { padding: 11px; gap: 8px; }
                    .haku-ingresos-title { font-size: 17px; }
                    .haku-ingresos-item {
                        grid-template-columns: auto minmax(0, 1fr);
                        gap: 7px;
                    }
                    .haku-ingresos-estado {
                        grid-column: 2;
                        justify-self: start;
                    }
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

        function esConsultaIngresos(valor) {
            const t = normalizar(valor);
            if (!t) return false;

            // Las órdenes de escritura siguen siendo responsabilidad de los
            // módulos de cambio de estado / reservas.
            if (/\b(?:marca|marcar|cambia|cambiar|pon|poner|pasa|pasar|crea|crear|agrega|agregar|registra|registrar|elimina|eliminar|borra|borrar)\b/.test(t)) return false;

            const pregunta = /\b(?:cuant[ao]s?|que|cuales|quienes|lista|listar|muestra|mostrar|dime|revisa|revisar|consulta|consultar)\b/.test(t);
            const reserva = /\b(?:reservas?|huespedes?|cabanas?)\b/.test(t);
            const ingreso = /\b(?:ingresa|ingresan|ingresara|ingresaran|ingreso|ingresos|llega|llegan|llegada|llegadas|check[ -]?in|check[ -]?ins)\b/.test(t);

            return ingreso && (reserva || pregunta);
        }

        function estadoNormal(fila) {
            return normalizar(`${fila?.estado_reserva || ""} ${fila?.estado_estadia || ""}`);
        }

        function esIngresoActivo(fila) {
            const estado = estadoNormal(fila);
            return !/\bcancelad[ao]s?\b|\bno[ _-]?show\b|\bcancelled\b|\bcanceled\b/.test(estado);
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

        async function buscar(fecha) {
            const { data, error } = await cliente.rpc("haiku_buscar_checkins_fecha_asistente", { p_fecha: fecha });
            if (error) throw error;
            return Array.isArray(data) ? data : [];
        }

        function renderizar(fecha, filas, descartadas) {
            const card = document.createElement("div");
            card.className = "haiku-asistente-preview haku-ingresos-card";

            const cabecera = document.createElement("div");
            cabecera.className = "haku-ingresos-head";

            const izq = document.createElement("div");
            const etiqueta = document.createElement("div");
            etiqueta.className = "haku-ingresos-kicker";
            etiqueta.textContent = "Consulta · sólo lectura";
            const titulo = document.createElement("h3");
            titulo.className = "haku-ingresos-title";
            titulo.textContent = "Ingresos del día";
            izq.append(etiqueta, titulo);

            const fechaChip = document.createElement("span");
            fechaChip.className = "haku-ingresos-fecha";
            fechaChip.textContent = fechaVisible(fecha);
            cabecera.append(izq, fechaChip);
            card.append(cabecera);

            const resumen = document.createElement("div");
            resumen.className = "haku-ingresos-resumen";
            const cantidad = document.createElement("span");
            cantidad.className = "haku-ingresos-cantidad";
            cantidad.textContent = String(filas.length);
            const resumenTexto = document.createElement("span");
            resumenTexto.textContent = `${filas.length === 1 ? "reserva ingresa" : "reservas ingresan"} el ${fechaVisible(fecha)}.`;
            resumen.append(cantidad, resumenTexto);
            card.append(resumen);

            if (filas.length) {
                const bloque = document.createElement("div");
                bloque.className = "haku-ingresos-listado-wrap";

                const tituloBloque = document.createElement("div");
                tituloBloque.className = "haku-ingresos-listado-titulo";
                tituloBloque.textContent = filas.length === 1 ? "Reserva que ingresa" : "Reservas que ingresan";
                bloque.appendChild(tituloBloque);

                const lista = document.createElement("div");
                lista.className = "haku-ingresos-lista";

                filas
                    .slice()
                    .sort((a, b) => Number(a?.cabana_numero || 99) - Number(b?.cabana_numero || 99))
                    .forEach(fila => {
                        const item = document.createElement("div");
                        item.className = "haku-ingresos-item";

                        const cab = document.createElement("span");
                        cab.className = "haku-ingresos-cab";
                        cab.textContent = fila?.cabana_numero ? `CAB ${fila.cabana_numero}` : "CAB —";

                        const main = document.createElement("div");
                        main.className = "haku-ingresos-main";
                        const titular = document.createElement("div");
                        titular.className = "haku-ingresos-titular";
                        titular.textContent = fila?.titular_nombre || "Sin titular";
                        const meta = document.createElement("div");
                        meta.className = "haku-ingresos-meta";
                        meta.textContent = fila?.fecha_salida
                            ? `Salida ${fechaVisible(fila.fecha_salida)}`
                            : "Sin fecha de salida";
                        main.append(titular, meta);

                        const estado = document.createElement("span");
                        estado.className = "haku-ingresos-estado";
                        estado.textContent = estadoVisible(fila);

                        item.append(cab, main, estado);
                        lista.appendChild(item);
                    });

                bloque.appendChild(lista);
                card.appendChild(bloque);
            }

            if (descartadas > 0) {
                const nota = document.createElement("div");
                nota.className = "haku-ingresos-aviso";
                nota.textContent = `${descartadas} registro${descartadas === 1 ? "" : "s"} cancelado${descartadas === 1 ? "" : "s"}/No Show se omitió${descartadas === 1 ? "" : "eron"} del conteo.`;
                card.appendChild(nota);
            }

            const pie = document.createElement("div");
            pie.className = "haku-ingresos-pie";
            pie.textContent = "Sólo lectura · esta consulta no modificó ninguna reserva.";
            card.append(pie);

            mensajes.appendChild(card);
            requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
        }

        async function procesar(textoOriginal) {
            if (ocupado) return;

            const fecha = fechaDesdeTexto(textoOriginal);
            campo.value = "";
            limpiarAdjuntos();
            agregarMensaje("usuario", textoOriginal);

            if (!fecha) {
                agregarMensaje("asistente", "Indícame una fecha, por ejemplo: 17 de septiembre, 17/09 o mañana.");
                return;
            }

            ocupado = true;
            const espera = agregarMensaje("asistente", `Buscando ingresos del ${fechaVisible(fecha)}…`);
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
            fechaDesdeTexto,
            procesar
        });

        console.info("HAIKU · Consulta de ingresos por fecha V1 preparada.");
        return true;
    }

    if (instalar()) return;

    // Haku puede crearse después de este archivo. Esperamos su aparición sin
    // polling y desconectamos el observer inmediatamente al instalar.
    const observador = new MutationObserver(() => {
        if (!instalar()) return;
        observador.disconnect();
    });
    observador.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener("load", () => {
        if (instalar()) observador.disconnect();
    }, { once: true });
})();
