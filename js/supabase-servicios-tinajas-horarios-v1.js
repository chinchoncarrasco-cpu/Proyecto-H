// ========================================
// HAIKU · SERVICIOS · HORARIOS TINAJAS V1
// Vista derivada de Servicios. No crea ni modifica servicios.
// Sin observers, intervalos ni parches globales.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_SERVICIOS_TINAJAS_HORARIOS_V1) return;

    const BLOQUE_ID = "haiku-tinajas-horarios-v1";
    const STYLE_MARK = "haiku-tinajas-horarios-v1-css-link";

    function cargarEstilos() {
        if (document.querySelector(`link[data-${STYLE_MARK}]`)) return;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `css/supabase-servicios-tinajas-horarios-v1.css?v=${Date.now()}`;
        link.dataset[STYLE_MARK.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = "1";
        document.head.appendChild(link);
    }

    const FECHA_ID = "haiku-tinajas-fecha-v1";
    const COPIAR_ID = "haiku-tinajas-copiar-v1";
    const ESTADO_COPIA_ID = "haiku-tinajas-copia-estado-v1";

    const HORARIOS = Object.freeze([
        { inicio: "14:45", fin: "15:45" },
        { inicio: "16:15", fin: "17:15" },
        { inicio: "17:45", fin: "18:45" },
        { inicio: "19:15", fin: "20:15" },
        { inicio: "20:45", fin: "21:45" },
        { inicio: "22:15", fin: "23:15" }
    ]);

    const TIPOS = Object.freeze([
        { clave: "tonel", titulo: "TINAJA TÓNEL" },
        { clave: "jacuzzi", titulo: "TINAJA JACUZZI" }
    ]);

    function listaServicios() {
        try {
            if (typeof serviciosRegistrados !== "undefined" && Array.isArray(serviciosRegistrados)) {
                return serviciosRegistrados;
            }
        } catch {}

        try {
            const lista = JSON.parse(localStorage.getItem("haikuServicios") || "[]");
            return Array.isArray(lista) ? lista : [];
        } catch {
            return [];
        }
    }

    function normalizar(texto) {
        return String(texto || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function tipoTinaja(servicio) {
        const codigo = normalizar(servicio?.tipoServicio);
        const nombre = normalizar(servicio?.nombre);
        const combinado = `${codigo} ${nombre}`;

        if (combinado.includes("jacuzzi")) return "jacuzzi";
        if (combinado.includes("tonel")) return "tonel";
        return null;
    }

    function fechaChileActual() {
        const partes = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Santiago",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }).formatToParts(new Date());
        const p = Object.fromEntries(partes.map(x => [x.type, x.value]));
        return {
            fecha: `${p.year}-${p.month}-${p.day}`,
            minutos: Number(p.hour || 0) * 60 + Number(p.minute || 0)
        };
    }

    function fechaVisible(fecha) {
        const s = String(fecha || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "—";
        const [y, m, d] = s.split("-");
        return `${d}/${m}/${y}`;
    }

    function minutos(hora) {
        const partes = String(hora || "").slice(0, 5).split(":").map(Number);
        if (partes.length !== 2 || !Number.isFinite(partes[0]) || !Number.isFinite(partes[1])) return null;
        return partes[0] * 60 + partes[1];
    }

    function rangoServicio(servicio) {
        const inicio = minutos(servicio?.hora);
        if (inicio === null) return null;

        let fin = minutos(servicio?.horaFin);
        if (fin === null || fin <= inicio) {
            const duracion = Math.max(1, Number(servicio?.duracionMinutos || 60));
            fin = inicio + duracion;
        }
        return { inicio, fin };
    }

    function seSuperponen(aInicio, aFin, bInicio, bFin) {
        return aInicio < bFin && bInicio < aFin;
    }

    function estadoOperativo(servicio) {
        return normalizar(servicio?.estadoServicioDb || servicio?.estadoServicio);
    }

    function estaCancelado(servicio) {
        return ["cancelado", "cancelada", "no show", "no_show"].includes(estadoOperativo(servicio));
    }

    function estaCompletado(servicio) {
        return ["realizado", "realizada", "completado", "completada"].includes(estadoOperativo(servicio));
    }

    function textoPago(servicio) {
        if (servicio?.cortesia === true || String(servicio?.tipoCobro || "") === "cortesia") return "Cortesía";
        const estado = normalizar(servicio?.estadoPago);
        if (estado === "pagado") return "Pagado";
        if (estado === "pendiente") return "Pendiente de pago";
        if (estado === "no corresponde" || estado === "no-corresponde") return "No corresponde";
        return servicio?.estadoPago ? String(servicio.estadoPago) : "—";
    }

    function servicioDetalle(servicio) {
        const partes = [];
        if (servicio?.titular) partes.push(String(servicio.titular));
        if (servicio?.numeroCabana) partes.push(`CAB ${servicio.numeroCabana}`);
        if (Number(servicio?.personas || 0) > 0) partes.push(`${Number(servicio.personas)} pers.`);
        partes.push(textoPago(servicio));
        if (servicio?.observaciones) partes.push(String(servicio.observaciones));
        return partes.filter(Boolean).join(" · ");
    }

    function serviciosTinajaDelDia(fecha) {
        return listaServicios().filter(servicio =>
            String(servicio?.fechaServicio || servicio?.fecha || "").slice(0, 10) === fecha &&
            Boolean(tipoTinaja(servicio))
        );
    }

    function estadoHorario(tipo, horario, serviciosDia) {
        const slotInicio = minutos(horario.inicio);
        const slotFin = minutos(horario.fin);
        const relacionados = serviciosDia.filter(servicio => {
            if (tipoTinaja(servicio) !== tipo) return false;
            const rango = rangoServicio(servicio);
            return rango && seSuperponen(slotInicio, slotFin, rango.inicio, rango.fin);
        });

        const activos = relacionados.filter(servicio => !estaCancelado(servicio));
        const cancelados = relacionados.filter(estaCancelado);

        if (activos.length > 1) {
            return { estado: "conflicto", activos, cancelados };
        }
        if (activos.length === 1) {
            return { estado: "tomada", activos, cancelados };
        }
        return { estado: "libre", activos: [], cancelados };
    }

    function crearBloqueSiFalta() {
        let bloque = document.getElementById(BLOQUE_ID);
        if (bloque) return bloque;

        const seccion = document.getElementById("seccion-servicios");
        if (!seccion) return null;

        const agenda = seccion.querySelector(".servicios-panel");
        if (!agenda) return null;

        bloque = document.createElement("section");
        bloque.id = BLOQUE_ID;
        bloque.className = "haiku-tinajas-horarios panel";
        bloque.innerHTML = `
            <div class="haiku-tinajas-cabecera">
                <div>
                    <p class="haiku-tinajas-eyebrow">DISPONIBILIDAD OPERATIVA</p>
                    <h2>Horarios disponibles · Tinaja caliente</h2>
                    <p>Vista automática desde los servicios registrados.</p>
                </div>
                <div class="haiku-tinajas-controles">
                    <label>
                        <span>Fecha</span>
                        <input type="date" id="${FECHA_ID}">
                    </label>
                    <button type="button" id="${COPIAR_ID}">Copiar disponibilidad</button>
                    <span id="${ESTADO_COPIA_ID}" class="haiku-tinajas-copia-estado" aria-live="polite"></span>
                </div>
            </div>
            <div class="haiku-tinajas-grid" id="haiku-tinajas-grid-v1"></div>
            <div class="haiku-tinajas-alertas" id="haiku-tinajas-alertas-v1" hidden></div>
        `;

        seccion.insertBefore(bloque, agenda);

        const fecha = bloque.querySelector(`#${FECHA_ID}`);
        fecha.value = fechaChileActual().fecha;
        fecha.addEventListener("change", renderizar);

        bloque.querySelector(`#${COPIAR_ID}`)?.addEventListener("click", copiarDisponibilidad);
        return bloque;
    }

    function etiquetaEstado(estado) {
        if (estado === "conflicto") return "CONFLICTO";
        if (estado === "tomada") return "TOMADA";
        return "LIBRE";
    }

    function htmlDetalleServicio(servicio) {
        const completado = estaCompletado(servicio);
        return `
            <div class="haiku-tinajas-detalle-servicio">
                <div class="haiku-tinajas-detalle-principal">
                    ${servicio?.titular ? `<strong>${escapar(servicio.titular)}</strong>` : ""}
                    ${servicio?.numeroCabana ? `<span>CAB ${escapar(servicio.numeroCabana)}</span>` : ""}
                    ${Number(servicio?.personas || 0) > 0 ? `<span>${Number(servicio.personas)} pers.</span>` : ""}
                </div>
                <div class="haiku-tinajas-detalle-secundario">
                    <span>${escapar(textoPago(servicio))}</span>
                    ${completado ? `<span>Completada</span>` : ""}
                    ${servicio?.observaciones ? `<span>${escapar(servicio.observaciones)}</span>` : ""}
                </div>
            </div>
        `;
    }

    function escapar(valor) {
        return String(valor ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function htmlHorario(tipo, horario, serviciosDia) {
        const info = estadoHorario(tipo, horario, serviciosDia);
        const canceladas = info.cancelados.length;
        const clase = `haiku-tinajas-fila haiku-tinajas-fila--${info.estado}`;

        let contenido = "";
        if (info.estado === "conflicto") {
            contenido = info.activos.map(htmlDetalleServicio).join("");
        } else if (info.estado === "tomada") {
            contenido = htmlDetalleServicio(info.activos[0]);
        } else if (canceladas) {
            contenido = `<div class="haiku-tinajas-cancelada-nota">Horario liberado · ${canceladas === 1 ? "1 servicio cancelado" : `${canceladas} servicios cancelados`}</div>`;
        }

        return `
            <div class="${clase}">
                <div class="haiku-tinajas-fila-top">
                    <strong class="haiku-tinajas-hora">${horario.inicio}–${horario.fin}</strong>
                    <span class="haiku-tinajas-estado">${etiquetaEstado(info.estado)}</span>
                </div>
                ${contenido}
            </div>
        `;
    }

    function renderizar() {
        const bloque = crearBloqueSiFalta();
        if (!bloque) return;

        const fecha = bloque.querySelector(`#${FECHA_ID}`)?.value || fechaChileActual().fecha;
        const serviciosDia = serviciosTinajaDelDia(fecha);
        const grid = bloque.querySelector("#haiku-tinajas-grid-v1");
        const alertas = bloque.querySelector("#haiku-tinajas-alertas-v1");
        if (!grid || !alertas) return;

        grid.innerHTML = TIPOS.map(tipo => {
            const libres = HORARIOS.filter(h => estadoHorario(tipo.clave, h, serviciosDia).estado === "libre").length;
            return `
                <article class="haiku-tinajas-tipo">
                    <header>
                        <strong>${tipo.titulo}</strong>
                        <span>${libres} de ${HORARIOS.length} libres</span>
                    </header>
                    <div class="haiku-tinajas-lista">
                        ${HORARIOS.map(h => htmlHorario(tipo.clave, h, serviciosDia)).join("")}
                    </div>
                </article>
            `;
        }).join("");

        const sinHoraValida = serviciosDia.filter(servicio => rangoServicio(servicio) === null);
        const conflictos = TIPOS.reduce((total, tipo) =>
            total + HORARIOS.filter(h => estadoHorario(tipo.clave, h, serviciosDia).estado === "conflicto").length,
        0);

        const mensajes = [];
        if (conflictos) mensajes.push(`⚠ ${conflictos} ${conflictos === 1 ? "conflicto de horario detectado" : "conflictos de horario detectados"}.`);
        if (sinHoraValida.length) mensajes.push(`⚠ ${sinHoraValida.length} ${sinHoraValida.length === 1 ? "tinaja no tiene una hora válida" : "tinajas no tienen una hora válida"}.`);

        alertas.hidden = mensajes.length === 0;
        alertas.textContent = mensajes.join(" ");
    }

    function horariosDisponibles(tipo, fecha) {
        const serviciosDia = serviciosTinajaDelDia(fecha);
        const reloj = fechaChileActual();
        return HORARIOS.filter(horario => {
            if (estadoHorario(tipo, horario, serviciosDia).estado !== "libre") return false;
            if (fecha === reloj.fecha) {
                const inicio = minutos(horario.inicio);
                if (inicio === null || inicio < reloj.minutos) return false;
            }
            return true;
        });
    }

    function textoWhatsApp(fecha) {
        const tonel = horariosDisponibles("tonel", fecha);
        const jacuzzi = horariosDisponibles("jacuzzi", fecha);
        const fechaTexto = fechaVisible(fecha);

        if (!tonel.length && !jacuzzi.length) {
            return `Hola 😊\n\nPor el momento no tenemos horarios disponibles de tinaja caliente para el ${fechaTexto}.`;
        }

        function bloque(titulo, horarios) {
            if (!horarios.length) return `${titulo}\nSin horarios disponibles.`;
            return `${titulo}\n${horarios.map(h => `• ${h.inicio} a ${h.fin}`).join("\n")}`;
        }

        return [
            "Hola 😊",
            "",
            `Estos son los horarios disponibles de tinaja caliente para el ${fechaTexto}:`,
            "",
            bloque("TINAJA TÓNEL", tonel),
            "",
            bloque("TINAJA JACUZZI", jacuzzi),
            "",
            "Si desea reservar uno de estos horarios, indíquenos cuál le acomoda 😊"
        ].join("\n");
    }

    async function copiarDisponibilidad() {
        const bloque = crearBloqueSiFalta();
        const fecha = bloque?.querySelector(`#${FECHA_ID}`)?.value || fechaChileActual().fecha;
        const estado = bloque?.querySelector(`#${ESTADO_COPIA_ID}`);
        const boton = bloque?.querySelector(`#${COPIAR_ID}`);
        if (!bloque || !estado || !boton) return;

        boton.disabled = true;
        estado.textContent = "Copiando…";
        try {
            if (!navigator.clipboard?.writeText) {
                throw new Error("Clipboard API no disponible");
            }
            await navigator.clipboard.writeText(textoWhatsApp(fecha));
            estado.textContent = "✓ Disponibilidad copiada";
            setTimeout(() => {
                if (estado.textContent === "✓ Disponibilidad copiada") estado.textContent = "";
            }, 2500);
        } catch (error) {
            console.error("HAIKU · No fue posible copiar disponibilidad de tinajas:", error);
            estado.textContent = "No se pudo copiar";
        } finally {
            boton.disabled = false;
        }
    }

    async function refrescarDesdeServicios() {
        try { await window.haikuSincronizarFinanzasServicios?.(); } catch {}
        renderizar();
    }

    document.addEventListener("haiku:servicios-hidratados", refrescarDesdeServicios);
    document.addEventListener("haiku:servicio-supabase-cambiado", () => setTimeout(refrescarDesdeServicios, 80));
    document.addEventListener("click", evento => {
        if (evento.target.closest?.('[data-seccion="servicios"], [data-ir-seccion="servicios"]')) {
            setTimeout(refrescarDesdeServicios, 50);
        }
    });

    window.addEventListener("focus", () => {
        const seccion = document.getElementById("seccion-servicios");
        if (seccion && !seccion.hidden && seccion.style.display !== "none") {
            refrescarDesdeServicios();
        }
    });

    window.HAIKU_SERVICIOS_TINAJAS_HORARIOS_V1 = Object.freeze({
        renderizar,
        textoWhatsApp,
        horariosDisponibles,
        horarios: HORARIOS,
        serviciosTinajaDelDia,
        estadoHorario
    });

    cargarEstilos();
    crearBloqueSiFalta();
    setTimeout(refrescarDesdeServicios, 700);
    console.info("HAIKU · Horarios de Tinajas V1 preparados.");
})();
