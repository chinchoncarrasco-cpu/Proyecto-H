// ========================================
// HAKU · OPERACIÓN POR FECHA V2
// Consultas de solo lectura para ingresos, salidas y continuaciones.
// Ejemplos:
// - "Haku cuántas reservas ingresan el 17 de septiembre?"
// - "Haku cuántas reservas salen el 17 de septiembre?"
// - "Haku cuántas reservas continúan el 17 de septiembre?"
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

    const CONFIG = Object.freeze({
        ingresan: {
            titulo: "Ingresos del día",
            etiquetaUno: "Reserva que ingresa",
            etiquetaVarios: "Reservas que ingresan",
            resumenUno: "reserva ingresa",
            resumenVarios: "reservas ingresan"
        },
        salen: {
            titulo: "Salidas del día",
            etiquetaUno: "Reserva que sale",
            etiquetaVarios: "Reservas que salen",
            resumenUno: "reserva sale",
            resumenVarios: "reservas salen"
        },
        continuan: {
            titulo: "Continúan en estadía",
            etiquetaUno: "Reserva que continúa",
            etiquetaVarios: "Reservas que continúan",
            resumenUno: "reserva continúa",
            resumenVarios: "reservas continúan"
        }
    });

    function instalar() {
        if (window.HAIKU_ASISTENTE_CONSULTA_OPERACION_FECHA_V1) return true;

        const cliente = window.haikuSupabase;
        const campo = document.getElementById("haiku-asistente-texto");
        const enviar = document.getElementById("haiku-asistente-enviar");
        const mensajes = document.getElementById("haiku-asistente-mensajes");
        const adjuntosWrap = document.getElementById("haiku-asistente-adjuntos");

        if (!cliente || !campo || !enviar || !mensajes) return false;

        let ocupado = false;

        function instalarEstilos() {
            if (document.getElementById("haku-operacion-fecha-estilos-v2")) return;

            const style = document.createElement("style");
            style.id = "haku-operacion-fecha-estilos-v2";
            style.textContent = `
                .haku-operacion-card {
                    --haku-op-accent: #1f7650;
                    --haku-op-soft: #edf7f0;
                    --haku-op-border: #c9ddd0;
                    border: 1px solid var(--haku-op-border);
                    border-radius: 16px;
                    background: linear-gradient(180deg, #fbfdfb 0%, #f7faf8 100%);
                    padding: 14px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    box-shadow: 0 5px 16px rgba(28, 69, 47, .055);
                }

                .haku-operacion-card--salen {
                    --haku-op-accent: #a24f46;
                    --haku-op-soft: #fbefed;
                    --haku-op-border: #e4c9c5;
                }

                .haku-operacion-card--continuan {
                    --haku-op-accent: #397082;
                    --haku-op-soft: #edf5f7;
                    --haku-op-border: #c9dde2;
                }

                .haku-operacion-head {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 12px;
                    padding-bottom: 9px;
                    border-bottom: 1px solid #deebe2;
                }

                .haku-operacion-kicker {
                    margin: 0 0 2px;
                    font-size: 10px;
                    line-height: 1.2;
                    font-weight: 800;
                    letter-spacing: .09em;
                    text-transform: uppercase;
                    color: var(--haku-op-accent);
                }

                .haku-operacion-title {
                    margin: 0;
                    font-size: 19px;
                    line-height: 1.15;
                    font-weight: 800;
                    color: #17251c;
                }

                .haku-operacion-fecha {
                    flex: 0 0 auto;
                    display: inline-flex;
                    align-items: center;
                    min-height: 26px;
                    padding: 4px 9px;
                    border: 1px solid var(--haku-op-border);
                    border-radius: 999px;
                    background: var(--haku-op-soft);
                    color: var(--haku-op-accent);
                    font-size: 11px;
                    line-height: 1;
                    font-weight: 800;
                    white-space: nowrap;
                }

                .haku-operacion-resumen {
                    display: flex;
                    align-items: center;
                    gap: 9px;
                    min-height: 42px;
                    padding: 8px 11px;
                    border: 1px solid #dbe8df;
                    border-radius: 12px;
                    background: rgba(255,255,255,.84);
                    color: #344039;
                    font-size: 12px;
                }

                .haku-operacion-cantidad {
                    flex: 0 0 auto;
                    display: grid;
                    place-items: center;
                    width: 28px;
                    height: 28px;
                    border-radius: 9px;
                    background: var(--haku-op-accent);
                    color: #fff;
                    font-size: 13px;
                    font-weight: 900;
                    box-shadow: 0 3px 8px rgba(31, 80, 55, .14);
                }

                .haku-operacion-listado-wrap {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    min-height: 0;
                }

                .haku-operacion-listado-titulo {
                    margin: 0 1px;
                    font-size: 11px;
                    font-weight: 800;
                    color: #3f5848;
                }

                .haku-operacion-lista {
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                    max-height: 235px;
                    overflow-y: auto;
                    padding-right: 2px;
                    scrollbar-width: thin;
                }

                .haku-operacion-item {
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

                .haku-operacion-cab {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 48px;
                    min-height: 25px;
                    padding: 3px 7px;
                    border-radius: 8px;
                    background: var(--haku-op-soft);
                    color: var(--haku-op-accent);
                    font-size: 10px;
                    font-weight: 900;
                    white-space: nowrap;
                }

                .haku-operacion-main {
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 1px;
                }

                .haku-operacion-titular {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 12px;
                    line-height: 1.25;
                    font-weight: 800;
                    color: #222f27;
                }

                .haku-operacion-meta {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 10px;
                    line-height: 1.25;
                    color: #78847b;
                }

                .haku-operacion-estado {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 23px;
                    padding: 3px 8px;
                    border: 1px solid #d7e7dc;
                    border-radius: 999px;
                    background: #f3f7f4;
                    color: #476254;
                    font-size: 9px;
                    font-weight: 800;
                    white-space: nowrap;
                }

                .haku-operacion-vacio {
                    padding: 8px 10px;
                    border: 1px dashed var(--haku-op-border);
                    border-radius: 10px;
                    background: var(--haku-op-soft);
                    color: #627068;
                    font-size: 11px;
                }

                .haku-operacion-pie {
                    padding-top: 7px;
                    border-top: 1px solid #e0e9e3;
                    color: #758078;
                    font-size: 10px;
                    line-height: 1.25;
                }

                @media (max-width: 620px) {
                    .haku-operacion-card { padding: 11px; gap: 8px; }
                    .haku-operacion-title { font-size: 17px; }
                    .haku-operacion-item {
                        grid-template-columns: auto minmax(0, 1fr);
                        gap: 7px;
                    }
                    .haku-operacion-estado {
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

        function tipoConsulta(valor) {
            const t = normalizar(valor);
            if (!t) return null;

            // No interceptar instrucciones que pretenden escribir o cambiar datos.
            if (/\b(?:marca|marcar|cambia|cambiar|pon|poner|pasa|pasar|crea|crear|agrega|agregar|registra|registrar|elimina|eliminar|borra|borrar)\b/.test(t)) return null;

            const pregunta = /\b(?:cuant[ao]s?|que|cuales|quienes|lista|listar|muestra|mostrar|dime|revisa|revisar|consulta|consultar)\b/.test(t);
            const reserva = /\b(?:reservas?|huespedes?|cabanas?)\b/.test(t);

            let tipo = null;
            if (/\b(?:continua|continuan|continuara|continuaran|siguen|seguiran|se\s+quedan|permanecen)\b/.test(t)) {
                tipo = "continuan";
            } else if (/\b(?:sale|salen|salida|salidas|egresa|egresan|checkout|check[ -]?out|checkouts|check[ -]?outs)\b/.test(t)) {
                tipo = "salen";
            } else if (/\b(?:ingresa|ingresan|ingresara|ingresaran|ingreso|ingresos|llega|llegan|llegada|llegadas|check[ -]?in|check[ -]?ins)\b/.test(t)) {
                tipo = "ingresan";
            }

            return tipo && (reserva || pregunta) ? tipo : null;
        }

        function estadoVisible(fila) {
            const e = normalizar(fila?.estado_estadia || fila?.estado_reserva || "");
            if (/checked.?out|checkout/.test(e) || fila?.checkout_realizado_en) return "Checked Out";
            if (/hospedad/.test(e) || fila?.checkin_realizado_en) return "Hospedado";
            if (/confirm/.test(e)) return "Confirmada";
            if (/pendiente/.test(e)) return "Pendiente";
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

        async function buscar(fecha, tipo) {
            const { data, error } = await cliente.rpc("haiku_buscar_operacion_fecha_asistente", {
                p_fecha: fecha,
                p_tipo: tipo
            });
            if (error) throw error;
            return Array.isArray(data) ? data : [];
        }

        function metaFila(tipo, fila) {
            if (tipo === "salen") {
                return fila?.fecha_ingreso
                    ? `Ingreso ${fechaVisible(fila.fecha_ingreso)}`
                    : "Sin fecha de ingreso";
            }
            if (tipo === "continuan") {
                const ingreso = fila?.fecha_ingreso ? `Ingreso ${fechaVisible(fila.fecha_ingreso)}` : "Ingreso —";
                const salida = fila?.fecha_salida ? `salida ${fechaVisible(fila.fecha_salida)}` : "salida —";
                return `${ingreso} · ${salida}`;
            }
            return fila?.fecha_salida
                ? `Salida ${fechaVisible(fila.fecha_salida)}`
                : "Sin fecha de salida";
        }

        function renderizar(fecha, tipo, filas) {
            const config = CONFIG[tipo] || CONFIG.ingresan;
            const card = document.createElement("div");
            card.className = `haiku-asistente-preview haku-operacion-card haku-operacion-card--${tipo}`;

            const cabecera = document.createElement("div");
            cabecera.className = "haku-operacion-head";

            const izq = document.createElement("div");
            const etiqueta = document.createElement("div");
            etiqueta.className = "haku-operacion-kicker";
            etiqueta.textContent = "Consulta · sólo lectura";
            const titulo = document.createElement("h3");
            titulo.className = "haku-operacion-title";
            titulo.textContent = config.titulo;
            izq.append(etiqueta, titulo);

            const fechaChip = document.createElement("span");
            fechaChip.className = "haku-operacion-fecha";
            fechaChip.textContent = fechaVisible(fecha);
            cabecera.append(izq, fechaChip);
            card.appendChild(cabecera);

            const resumen = document.createElement("div");
            resumen.className = "haku-operacion-resumen";
            const cantidad = document.createElement("span");
            cantidad.className = "haku-operacion-cantidad";
            cantidad.textContent = String(filas.length);
            const resumenTexto = document.createElement("span");
            resumenTexto.textContent = `${filas.length === 1 ? config.resumenUno : config.resumenVarios} el ${fechaVisible(fecha)}.`;
            resumen.append(cantidad, resumenTexto);
            card.appendChild(resumen);

            if (filas.length) {
                const bloque = document.createElement("div");
                bloque.className = "haku-operacion-listado-wrap";

                const tituloBloque = document.createElement("div");
                tituloBloque.className = "haku-operacion-listado-titulo";
                tituloBloque.textContent = filas.length === 1 ? config.etiquetaUno : config.etiquetaVarios;
                bloque.appendChild(tituloBloque);

                const lista = document.createElement("div");
                lista.className = "haku-operacion-lista";

                filas
                    .slice()
                    .sort((a, b) => Number(a?.cabana_numero || 99) - Number(b?.cabana_numero || 99))
                    .forEach(fila => {
                        const item = document.createElement("div");
                        item.className = "haku-operacion-item";

                        const cab = document.createElement("span");
                        cab.className = "haku-operacion-cab";
                        cab.textContent = fila?.cabana_numero ? `CAB ${fila.cabana_numero}` : "CAB —";

                        const main = document.createElement("div");
                        main.className = "haku-operacion-main";
                        const titular = document.createElement("div");
                        titular.className = "haku-operacion-titular";
                        titular.textContent = fila?.titular_nombre || "Sin titular";
                        const meta = document.createElement("div");
                        meta.className = "haku-operacion-meta";
                        meta.textContent = metaFila(tipo, fila);
                        main.append(titular, meta);

                        const estado = document.createElement("span");
                        estado.className = "haku-operacion-estado";
                        estado.textContent = estadoVisible(fila);

                        item.append(cab, main, estado);
                        lista.appendChild(item);
                    });

                bloque.appendChild(lista);
                card.appendChild(bloque);
            } else {
                const vacio = document.createElement("div");
                vacio.className = "haku-operacion-vacio";
                vacio.textContent = `No encontré reservas que ${tipo === "salen" ? "salgan" : tipo === "continuan" ? "continúen" : "ingresen"} en esa fecha.`;
                card.appendChild(vacio);
            }

            const pie = document.createElement("div");
            pie.className = "haku-operacion-pie";
            pie.textContent = "Sólo lectura · esta consulta no modificó ninguna reserva.";
            card.appendChild(pie);

            mensajes.appendChild(card);
            requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
        }

        async function procesar(textoOriginal) {
            if (ocupado) return;

            const tipo = tipoConsulta(textoOriginal);
            if (!tipo) return;

            const fecha = fechaDesdeTexto(textoOriginal);
            campo.value = "";
            limpiarAdjuntos();
            agregarMensaje("usuario", textoOriginal);

            if (!fecha) {
                agregarMensaje("asistente", "Indícame una fecha, por ejemplo: 17 de septiembre, 17/09 o mañana.");
                return;
            }

            ocupado = true;
            const config = CONFIG[tipo] || CONFIG.ingresan;
            const espera = agregarMensaje("asistente", `Revisando ${config.titulo.toLowerCase()} del ${fechaVisible(fecha)}…`);

            try {
                const filas = await buscar(fecha, tipo);
                espera.remove();
                renderizar(fecha, tipo, filas);
            } catch (error) {
                console.error("HAIKU · Consulta operativa por fecha:", error);
                espera.textContent = error?.message || "No pude consultar las reservas de esa fecha.";
            } finally {
                ocupado = false;
                campo.dispatchEvent(new Event("input", { bubbles: true }));
            }
        }

        function interceptarClick(evento) {
            const texto = String(campo.value || "").trim();
            if (!tipoConsulta(texto)) return;
            evento.preventDefault();
            evento.stopImmediatePropagation();
            procesar(texto);
        }

        function interceptarTeclado(evento) {
            if (evento.key !== "Enter" || evento.shiftKey) return;
            const texto = String(campo.value || "").trim();
            if (!tipoConsulta(texto)) return;
            evento.preventDefault();
            evento.stopImmediatePropagation();
            procesar(texto);
        }

        enviar.addEventListener("click", interceptarClick, true);
        campo.addEventListener("keydown", interceptarTeclado, true);

        const api = Object.freeze({
            tipoConsulta,
            fechaDesdeTexto,
            procesar,
            esConsultaIngresos: valor => tipoConsulta(valor) === "ingresan",
            esConsultaSalidas: valor => tipoConsulta(valor) === "salen",
            esConsultaContinuaciones: valor => tipoConsulta(valor) === "continuan"
        });

        window.HAIKU_ASISTENTE_CONSULTA_OPERACION_FECHA_V1 = api;
        window.HAIKU_ASISTENTE_CONSULTA_INGRESOS_V1 = api;

        console.info("HAIKU · Consulta operativa por fecha V2 preparada.");
        return true;
    }

    if (instalar()) return;

    const observador = new MutationObserver(() => {
        if (!instalar()) return;
        observador.disconnect();
    });
    observador.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener("load", () => {
        if (instalar()) observador.disconnect();
    }, { once: true });
})();
