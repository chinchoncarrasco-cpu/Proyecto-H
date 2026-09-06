// ========================================
// HAKU · RESERVAS CONFIRMADAS SIN ABONO V1
// Consulta determinística y de sólo lectura sobre Supabase.
// Se intercepta en fase de captura antes del lector genérico de reservas.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_CONFIRMADAS_SIN_ABONO_V1) return;

    let ocupado = false;

    function normalizar(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function esConsultaConfirmadasSinAbono(valor) {
        const t = normalizar(valor);
        if (!t) return false;

        // Si el usuario está ordenando REGISTRAR un pago, la solicitud pertenece
        // al módulo de pagos sobre reserva existente, no a esta consulta.
        const accionPago =
            /\b(agrega|agregar|registre|registra|registrar|asocia|asociar|aplica|aplicar)\b.{0,50}\b(pago|pagos|abono|abonos)\b/.test(t) ||
            /\b(pago|pagos|abono|abonos)\b.{0,50}\b(agrega|agregar|registre|registra|registrar|asocia|asociar|aplica|aplicar)\b/.test(t);
        if (accionPago) return false;

        const confirmada = /\bconfirmad(?:a|as|o|os)\b/.test(t);
        const sinPago =
            /\bsin\s+(?:su\s+)?(?:abono|abonos|pago|pagos)\b/.test(t) ||
            /\b(?:no\s+tiene|no\s+tienen|falta|faltan)\b.{0,55}\b(?:abono|abonos|pago|pagos)\b/.test(t) ||
            /\b(?:abono|abonos|pago|pagos)\b.{0,55}\b(?:faltante|faltantes|pendiente|pendientes|falta|faltan)\b/.test(t);

        return confirmada && sinPago;
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

    function obtenerElementos() {
        return {
            cliente: window.haikuSupabase,
            campo: document.getElementById("haiku-asistente-texto"),
            enviar: document.getElementById("haiku-asistente-enviar"),
            mensajes: document.getElementById("haiku-asistente-mensajes"),
            adjuntos: document.getElementById("haiku-asistente-adjuntos")
        };
    }

    function agregarMensaje(mensajes, tipo, texto, claseExtra = "") {
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

    function renderizarResultado(mensajes, filas, conPasadas) {
        const card = document.createElement("article");
        card.className = "haiku-asistente-preview";
        card.dataset.hakuConfirmadasSinAbono = "1";

        const cabecera = document.createElement("div");
        cabecera.className = "haiku-asistente-preview-cabecera";
        const titulo = document.createElement("div");
        const marca = document.createElement("span");
        marca.textContent = "CONFIRMADAS · SIN ABONO · DATOS DE PROYECTO H";
        const nombre = document.createElement("strong");
        nombre.textContent = filas.length
            ? `${filas.length} reserva${filas.length === 1 ? "" : "s"} por revisar`
            : "No hay reservas confirmadas sin abono";
        titulo.append(marca, nombre);
        cabecera.appendChild(titulo);
        card.appendChild(cabecera);

        const resumen = document.createElement("p");
        resumen.className = "haiku-asistente-preview-resumen";

        if (!filas.length) {
            resumen.textContent = conPasadas
                ? "No encontré reservas confirmadas con alojamiento cobrado, $0 abonado y saldo pendiente, incluyendo reservas pasadas."
                : "No encontré reservas confirmadas vigentes o futuras con alojamiento cobrado, $0 abonado y saldo pendiente.";
            card.appendChild(resumen);
            mensajes.appendChild(card);
            requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
            return;
        }

        const saldoTotal = filas.reduce((s, fila) => sumaSegura(s, fila?.saldo_alojamiento), 0);
        resumen.textContent = `${filas.length} reserva${filas.length === 1 ? "" : "s"} confirmada${filas.length === 1 ? "" : "s"} ya existen en Proyecto H pero todavía tienen $0 aplicado al alojamiento. Saldo conjunto pendiente: ${moneda(saldoTotal)}.`;
        card.appendChild(resumen);

        filas.forEach((fila, indice) => {
            const bloque = document.createElement("section");
            bloque.className = "haiku-asistente-preview-observacion";
            const etiqueta = document.createElement("span");
            etiqueta.textContent = `SIN ABONO ${indice + 1} DE ${filas.length}`;
            const titular = document.createElement("p");
            titular.textContent = `CAB ${fila.cabana_numero} · ${fila.titular_nombre || "Sin titular"}`;
            bloque.append(etiqueta, titular);

            const grid = document.createElement("div");
            grid.className = "haiku-asistente-preview-grid";
            agregarDato(grid, "Ingreso", fechaVisible(fila.fecha_ingreso));
            agregarDato(grid, "Salida", fechaVisible(fila.fecha_salida));
            agregarDato(grid, "Tipo", tipoVisible(fila.tipo_estadia));
            agregarDato(grid, "Total reserva", moneda(fila.total_alojamiento));
            agregarDato(grid, "Abono", moneda(fila.pagado_alojamiento));
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
        label.textContent = "SIGUIENTE PASO";
        const p = document.createElement("p");
        p.textContent = "Estas son las reservas cuyos comprobantes puedes buscar o enviar a Haku. Esta consulta es sólo lectura y no registra ni modifica pagos.";
        nota.append(label, p);
        card.appendChild(nota);

        mensajes.appendChild(card);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
    }

    function sumaSegura(acumulado, valor) {
        const n = Number(valor);
        return acumulado + (Number.isFinite(n) ? Math.max(0, n) : 0);
    }

    async function consultar(textoUsuario) {
        const { cliente, campo, enviar, mensajes } = obtenerElementos();
        if (!cliente || !campo || !enviar || !mensajes || ocupado) return;

        ocupado = true;
        enviar.disabled = true;
        campo.disabled = true;

        const conPasadas = incluirPasadas(textoUsuario);
        agregarMensaje(mensajes, "usuario", textoUsuario);
        campo.value = "";
        const estado = agregarMensaje(mensajes, "asistente", "Revisando directamente las reservas actuales de Proyecto H y sus abonos…", "haiku-asistente-mensaje--procesando");

        try {
            const { data, error } = await cliente.rpc("haiku_confirmadas_sin_abono_asistente", {
                p_incluir_pasadas: conPasadas
            });
            if (error) throw error;

            estado.remove();
            renderizarResultado(mensajes, Array.isArray(data) ? data : [], conPasadas);
        } catch (error) {
            console.error("HAKU · Confirmadas sin abono:", error);
            estado.classList.remove("haiku-asistente-mensaje--procesando");
            estado.textContent = `No pude revisar las reservas actuales: ${error?.message || "error desconocido"}`;
        } finally {
            ocupado = false;
            campo.disabled = false;
            campo.dispatchEvent(new Event("input", { bubbles: true }));
            requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
        }
    }

    function intentarInterceptar(evento) {
        if (ocupado) return;
        const { campo, adjuntos } = obtenerElementos();
        if (!campo) return;
        if (adjuntos?.querySelector(".haiku-asistente-adjunto")) return;

        const textoUsuario = campo.value.trim();
        if (!esConsultaConfirmadasSinAbono(textoUsuario)) return;

        // Importante: este listener vive en document + fase de captura, por lo
        // que se ejecuta ANTES del listener genérico colocado en el botón/campo.
        evento.preventDefault();
        evento.stopImmediatePropagation();
        consultar(textoUsuario);
    }

    // Delegación global muy acotada: sólo actúa sobre el botón/campo de Haku y
    // únicamente cuando la frase es una consulta de confirmadas sin abono.
    document.addEventListener("click", evento => {
        const boton = evento.target?.closest?.("#haiku-asistente-enviar");
        if (!boton) return;
        intentarInterceptar(evento);
    }, true);

    document.addEventListener("keydown", evento => {
        if (!(evento.ctrlKey || evento.metaKey) || evento.key !== "Enter") return;
        if (evento.target?.id !== "haiku-asistente-texto") return;
        intentarInterceptar(evento);
    }, true);

    window.HAIKU_ASISTENTE_CONFIRMADAS_SIN_ABONO_V1 = Object.freeze({
        activo: true,
        esConsultaConfirmadasSinAbono,
        consultar
    });

    console.info("HAKU · Consulta de reservas confirmadas sin abono V1 preparada con prioridad sobre el lector genérico.");
})();