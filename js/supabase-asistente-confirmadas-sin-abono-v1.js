// ========================================
// HAKU · RESERVAS CONFIRMADAS SIN ABONO V1
// Consulta determinística y de sólo lectura sobre Supabase.
// Identifica reservas CONFIRMADAS cuyo alojamiento tiene total > 0,
// pagado = 0 y saldo > 0. No registra ni modifica pagos.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_CONFIRMADAS_SIN_ABONO_V1) return;

    const cliente = window.haikuSupabase;
    const campo = document.getElementById("haiku-asistente-texto");
    const enviar = document.getElementById("haiku-asistente-enviar");
    const adjuntosWrap = document.getElementById("haiku-asistente-adjuntos");
    const mensajes = document.getElementById("haiku-asistente-mensajes");

    if (!cliente || !campo || !enviar || !mensajes || !window.HAIKU_ASISTENTE) {
        const principal = document.querySelector('script[data-haiku-asistente-v1]');
        const srcActual = document.currentScript?.src || "";
        if (principal && srcActual && principal.dataset.haikuConfirmadasSinAbonoEspera !== "1") {
            principal.dataset.haikuConfirmadasSinAbonoEspera = "1";
            principal.addEventListener("load", () => {
                if (window.HAIKU_ASISTENTE_CONFIRMADAS_SIN_ABONO_V1) return;
                const retry = document.createElement("script");
                retry.src = `${srcActual}${srcActual.includes("?") ? "&" : "?"}afterAssistant=${Date.now()}`;
                retry.async = false;
                document.head.appendChild(retry);
            }, { once: true });
        }
        return;
    }

    let ocupado = false;

    function normalizar(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function tieneAdjuntos() {
        return !!adjuntosWrap?.querySelector(".haiku-asistente-adjunto");
    }

    function esConsultaConfirmadasSinAbono(valor) {
        const t = normalizar(valor);
        if (!t) return false;

        // Este módulo es de consulta. Las instrucciones de registrar/agregar pagos
        // siguen perteneciendo al módulo dedicado de Pago en reserva existente.
        const accionPago =
            /\b(agrega|agregar|registre|registra|registrar|asocia|asociar|aplica|aplicar)\b.{0,50}\b(pago|pagos|abono|abonos)\b/.test(t) ||
            /\b(pago|pagos|abono|abonos)\b.{0,50}\b(agrega|agregar|registre|registra|registrar|asocia|asociar|aplica|aplicar)\b/.test(t);
        if (accionPago) return false;

        const hablaConfirmadas = /\bconfirmad(?:a|as|o|os)\b/.test(t);
        if (!hablaConfirmadas) return false;

        const sinAbono =
            /\bsin\s+(?:su\s+)?(?:abono|abonos|pago|pagos)\b/.test(t) ||
            /\b(?:no\s+tiene|no\s+tienen|falta|faltan)\b.{0,55}\b(?:abono|abonos|pago|pagos)\b/.test(t) ||
            /\b(?:abono|abonos|pago|pagos)\b.{0,55}\b(?:faltante|faltantes|pendiente|pendientes|falta|faltan)\b/.test(t);

        return sinAbono;
    }

    function incluirPasadas(valor) {
        const t = normalizar(valor);
        return /\b(historicas|historicos|pasadas|pasados|anteriores)\b/.test(t) ||
            /\binclu(?:ye|ir|yendo)\b.{0,30}\b(pasadas|historicas|anteriores)\b/.test(t);
    }

    function moneda(valor) {
        const n = Number(valor);
        return Number.isFinite(n) ? `$${Math.round(n).toLocaleString("es-CL")}` : "—";
    }

    function fechaVisible(valor) {
        const s = String(valor || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "—";
        const [y, m, d] = s.split("-");
        return `${d}-${m}-${y}`;
    }

    function tipoVisible(valor) {
        return normalizar(valor) === "fullday" ? "Full Day" : "Alojamiento";
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
        if (valor === null || valor === undefined || valor === "") return;
        const fila = document.createElement("div");
        fila.className = "haiku-asistente-preview-dato";
        const span = document.createElement("span");
        span.textContent = etiqueta;
        const strong = document.createElement("strong");
        strong.textContent = String(valor);
        fila.append(span, strong);
        contenedor.appendChild(fila);
    }

    function renderizarResultado(filas, conPasadas) {
        const card = document.createElement("article");
        card.className = "haiku-asistente-preview";
        card.dataset.hakuConfirmadasSinAbono = "1";

        const cabecera = document.createElement("div");
        cabecera.className = "haiku-asistente-preview-cabecera";
        const titulo = document.createElement("div");
        const marca = document.createElement("span");
        marca.textContent = "CONFIRMADAS · SIN ABONO · SOLO LECTURA";
        const nombre = document.createElement("strong");
        nombre.textContent = filas.length
            ? `${filas.length} reserva${filas.length === 1 ? "" : "s"} sin abono`
            : "No hay reservas confirmadas sin abono";
        titulo.append(marca, nombre);
        cabecera.appendChild(titulo);
        card.appendChild(cabecera);

        const resumen = document.createElement("p");
        resumen.className = "haiku-asistente-preview-resumen";
        if (!filas.length) {
            resumen.textContent = conPasadas
                ? "No encontré reservas confirmadas con alojamiento cobrado y $0 abonado, incluyendo reservas pasadas."
                : "No encontré reservas confirmadas vigentes o futuras con alojamiento cobrado y $0 abonado.";
            card.appendChild(resumen);
            mensajes.appendChild(card);
            requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
            return;
        }

        const saldoTotal = filas.reduce((suma, fila) => suma + Math.max(0, Number(fila?.saldo_alojamiento || 0)), 0);
        resumen.textContent = `${filas.length} reserva${filas.length === 1 ? "" : "s"} confirmada${filas.length === 1 ? "" : "s"} tienen $0 aplicado al alojamiento. Saldo conjunto pendiente: ${moneda(saldoTotal)}.`;
        card.appendChild(resumen);

        filas.forEach((fila, indice) => {
            const bloque = document.createElement("section");
            bloque.className = "haiku-asistente-preview-observacion";
            const etiqueta = document.createElement("span");
            etiqueta.textContent = filas.length > 1 ? `PENDIENTE DE ABONO ${indice + 1} DE ${filas.length}` : "PENDIENTE DE ABONO";
            const titular = document.createElement("p");
            titular.textContent = `CAB ${fila.cabana_numero} · ${fila.titular_nombre || "Sin titular"}`;
            bloque.append(etiqueta, titular);

            const grid = document.createElement("div");
            grid.className = "haiku-asistente-preview-grid";
            agregarDato(grid, "Ingreso", fechaVisible(fila.fecha_ingreso));
            agregarDato(grid, "Salida", fechaVisible(fila.fecha_salida));
            agregarDato(grid, "Tipo", tipoVisible(fila.tipo_estadia));
            agregarDato(grid, "Total reserva", moneda(fila.total_alojamiento));
            agregarDato(grid, "Abono actual", moneda(fila.pagado_alojamiento));
            agregarDato(grid, "Saldo", moneda(fila.saldo_alojamiento));
            agregarDato(grid, "Teléfono/Móvil", fila.telefono_contacto);
            agregarDato(grid, "Reserva Haiku", fila.codigo_haiku);
            agregarDato(grid, "ID Cloudbeds", fila.cloudbeds_id);
            bloque.appendChild(grid);
            card.appendChild(bloque);
        });

        const nota = document.createElement("div");
        nota.className = "haiku-asistente-preview-observacion";
        const label = document.createElement("span");
        label.textContent = "QUÉ SIGNIFICA";
        const p = document.createElement("p");
        p.textContent = "La reserva está Confirmada, tiene un cargo de alojamiento mayor a $0 y todavía no tiene ningún pago confirmado aplicado al alojamiento. Puedes enviarme el comprobante correspondiente y Haku lo buscará y asociará con el flujo de pagos existente.";
        nota.append(label, p);
        card.appendChild(nota);

        mensajes.appendChild(card);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
    }

    async function consultar(textoUsuario) {
        ocupado = true;
        enviar.disabled = true;
        campo.disabled = true;

        const conPasadas = incluirPasadas(textoUsuario);
        agregarMensaje("usuario", textoUsuario);
        campo.value = "";
        const estado = agregarMensaje("asistente", "Revisando reservas confirmadas y sus abonos…", "haiku-asistente-mensaje--procesando");

        try {
            const { data, error } = await cliente.rpc("haiku_confirmadas_sin_abono_asistente", {
                p_incluir_pasadas: conPasadas
            });
            if (error) throw error;

            estado.remove();
            renderizarResultado(Array.isArray(data) ? data : [], conPasadas);
        } catch (error) {
            console.error("HAKU · Confirmadas sin abono:", error);
            estado.classList.remove("haiku-asistente-mensaje--procesando");
            estado.textContent = `No pude revisar las reservas sin abono: ${error?.message || "error desconocido"}`;
        } finally {
            ocupado = false;
            campo.disabled = false;
            campo.dispatchEvent(new Event("input", { bubbles: true }));
            requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
        }
    }

    function intentarInterceptar(evento) {
        if (ocupado || tieneAdjuntos()) return;
        const textoUsuario = campo.value.trim();
        if (!esConsultaConfirmadasSinAbono(textoUsuario)) return;

        evento.preventDefault();
        evento.stopImmediatePropagation();
        consultar(textoUsuario);
    }

    enviar.addEventListener("click", intentarInterceptar, true);
    campo.addEventListener("keydown", evento => {
        if ((evento.ctrlKey || evento.metaKey) && evento.key === "Enter") {
            intentarInterceptar(evento);
        }
    }, true);

    window.HAIKU_ASISTENTE_CONFIRMADAS_SIN_ABONO_V1 = Object.freeze({
        activo: true,
        esConsultaConfirmadasSinAbono
    });

    console.info("HAKU · Consulta de reservas confirmadas sin abono V1 preparada.");
})();
