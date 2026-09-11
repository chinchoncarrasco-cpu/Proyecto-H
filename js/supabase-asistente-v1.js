// ========================================
// HAIKU · ASISTENTE FLOTANTE V11
// Texto + capturas -> Edge Function -> vista previa estructurada.
// Reserva y abonos requieren confirmación humana y reutilizan RPC oficiales.
// Los lotes de 2 a 11 reservas se crean de forma atómica.
// ========================================
(() => {
    "use strict";

    if (document.querySelector(".haiku-asistente-root")) return;

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const MAX_IMAGENES = 6;
    const MAX_ARCHIVO_BYTES = 5 * 1024 * 1024;
    const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

    const adjuntos = [];
    let procesando = false;
    let guardandoReserva = false;
    let ultimaPreview = null;

    const root = document.createElement("div");
    root.className = "haiku-asistente-root";
    root.hidden = true;
    root.innerHTML = `
        <section class="haiku-asistente-panel" id="haiku-asistente-panel" hidden aria-label="Asistente operativo">
            <header class="haiku-asistente-cabecera">
                <div class="haiku-asistente-titulo">
                    <strong>Asistente operativo</strong>
                    <span>Capturas, reservas y tareas</span>
                </div>
                <button type="button" class="haiku-asistente-cerrar" id="haiku-asistente-cerrar" aria-label="Cerrar asistente">×</button>
            </header>

            <div class="haiku-asistente-mensajes" id="haiku-asistente-mensajes" aria-live="polite">
                <div class="haiku-asistente-mensaje haiku-asistente-mensaje--asistente">
                    Envíame capturas y dime qué necesitas hacer. Leeré los datos y te mostraré una vista previa antes de cualquier cambio.
                </div>
            </div>

            <div class="haiku-asistente-adjuntos" id="haiku-asistente-adjuntos"></div>

            <div class="haiku-asistente-compositor">
                <textarea
                    class="haiku-asistente-texto"
                    id="haiku-asistente-texto"
                    placeholder="Ej: Agrega esta reserva a la fecha correspondiente. Ojo que es Full Day."
                    aria-label="Mensaje para el asistente"
                ></textarea>

                <div class="haiku-asistente-acciones">
                    <button type="button" class="haiku-asistente-adjuntar" id="haiku-asistente-adjuntar">📎 Adjuntar</button>
                    <button type="button" class="haiku-asistente-enviar" id="haiku-asistente-enviar">Enviar</button>
                </div>

                <div class="haiku-asistente-aviso">
                    Adjunta imágenes o pega capturas con Ctrl+V. PDF Cloudbeds: informe de sólo lectura. Una reserva sólo se crea después de pulsar “Confirmar” y aceptar la confirmación final.
                </div>

                <input id="haiku-asistente-archivos" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple hidden>
            </div>
        </section>

        <button type="button" class="haiku-asistente-boton" id="haiku-asistente-boton" aria-label="Abrir asistente" aria-expanded="false">
            <img class="haiku-asistente-avatar" src="assets/img/avatar-haku.png" alt="" aria-hidden="true">
        </button>
    `;
    document.body.appendChild(root);

    const panel = root.querySelector("#haiku-asistente-panel");
    const boton = root.querySelector("#haiku-asistente-boton");
    const cerrar = root.querySelector("#haiku-asistente-cerrar");
    const mensajes = root.querySelector("#haiku-asistente-mensajes");
    const campo = root.querySelector("#haiku-asistente-texto");
    const adjuntar = root.querySelector("#haiku-asistente-adjuntar");
    const archivosInput = root.querySelector("#haiku-asistente-archivos");
    const adjuntosWrap = root.querySelector("#haiku-asistente-adjuntos");
    const enviar = root.querySelector("#haiku-asistente-enviar");

    function estaAutenticado() {
        return Boolean(window.haikuSesion?.auth || window.haikuSesion?.usuario);
    }

    function mostrarSiCorresponde() {
        root.hidden = !estaAutenticado();
        if (root.hidden) cerrarPanel();
    }

    function abrirPanel() {
        if (root.hidden) return;
        panel.hidden = false;
        boton.setAttribute("aria-expanded", "true");
        boton.setAttribute("aria-label", "Cerrar asistente");
        requestAnimationFrame(() => campo.focus());
    }

    function cerrarPanel() {
        panel.hidden = true;
        boton.setAttribute("aria-expanded", "false");
        boton.setAttribute("aria-label", "Abrir asistente");
    }

    function alternarPanel() {
        panel.hidden ? abrirPanel() : cerrarPanel();
    }

    function scrollFinal() {
        requestAnimationFrame(() => {
            mensajes.scrollTop = mensajes.scrollHeight;
        });
    }

    function agregarMensaje(tipo, texto, claseExtra = "") {
        const div = document.createElement("div");
        div.className = `haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}${claseExtra ? ` ${claseExtra}` : ""}`;
        div.textContent = texto;
        mensajes.appendChild(div);
        scrollFinal();
        return div;
    }

    function liberarAdjunto(adjunto) {
        try { URL.revokeObjectURL(adjunto.url); } catch {}
    }

    function renderizarAdjuntos() {
        adjuntosWrap.innerHTML = "";

        adjuntos.forEach((adjunto, indice) => {
            const item = document.createElement("div");
            item.className = "haiku-asistente-adjunto";

            const esPDF = adjunto.file.type === "application/pdf";
            const img = document.createElement(esPDF ? "span" : "img");
            if (esPDF) img.textContent = `PDF · ${adjunto.file.name} · sólo lectura`;
            else img.src = adjunto.url;
            img.alt = adjunto.file.name || `Imagen ${indice + 1}`;

            const quitar = document.createElement("button");
            quitar.type = "button";
            quitar.className = "haiku-asistente-quitar";
            quitar.textContent = "×";
            quitar.setAttribute("aria-label", `Quitar ${img.alt}`);
            quitar.addEventListener("click", () => {
                if (procesando || guardandoReserva) return;
                const [eliminado] = adjuntos.splice(indice, 1);
                if (eliminado) liberarAdjunto(eliminado);
                renderizarAdjuntos();
                actualizarEnviar();
            });

            item.append(img, quitar);
            adjuntosWrap.appendChild(item);
        });
    }

    function limpiarAdjuntos() {
        adjuntos.forEach(liberarAdjunto);
        adjuntos.length = 0;
        archivosInput.value = "";
        renderizarAdjuntos();
    }

    function actualizarEnviar() {
        const vacio = !campo.value.trim() && adjuntos.length === 0;
        enviar.disabled = procesando || guardandoReserva || vacio;
        adjuntar.disabled = procesando || guardandoReserva;
        campo.disabled = procesando || guardandoReserva;
        enviar.textContent = procesando ? "Analizando…" : "Enviar";
    }

    function bytesAdjuntos() {
        return adjuntos.reduce((total, item) => total + Number(item.file?.size || 0), 0);
    }

    function incorporarArchivos(files) {
        if (procesando || guardandoReserva) return;
        let omitidos = 0;

        [...files].forEach(file => {
            if (adjuntos.length >= MAX_IMAGENES) {
                omitidos++;
                return;
            }

            if (!/^(?:image\/(png|jpeg|webp)|application\/pdf)$/i.test(file.type || "")) {
                omitidos++;
                return;
            }

            if (file.size > (file.type === "application/pdf" ? MAX_TOTAL_BYTES : MAX_ARCHIVO_BYTES) || bytesAdjuntos() + file.size > MAX_TOTAL_BYTES) {
                omitidos++;
                return;
            }

            adjuntos.push({
                file,
                url: URL.createObjectURL(file)
            });
        });

        archivosInput.value = "";
        renderizarAdjuntos();
        actualizarEnviar();

        if (omitidos) {
            agregarMensaje(
                "asistente",
                `No adjunté ${omitidos} archivos. Se admiten PNG/JPG/WEBP (5 MB por imagen) y un PDF Cloudbeds de sólo lectura (12 MB). Máximo 12 MB en total.`
            );
        }
    }

    function imagenesDesdePortapapeles(evento) {
        const portapapeles = evento.clipboardData;
        if (!portapapeles) return [];

        const desdeItems = [...(portapapeles.items || [])]
            .filter(item =>
                item.kind === "file" &&
                /^image\/(png|jpeg|webp)$/i.test(item.type || "")
            )
            .map(item => item.getAsFile())
            .filter(Boolean);

        if (desdeItems.length) return desdeItems;

        return [...(portapapeles.files || [])]
            .filter(file => /^image\/(png|jpeg|webp)$/i.test(file.type || ""));
    }

    function archivoADataUrl(file) {
        return new Promise((resolve, reject) => {
            const lector = new FileReader();
            lector.onload = () => resolve(String(lector.result || ""));
            lector.onerror = () => reject(new Error(`No pude leer ${file.name || "una imagen"}.`));
            lector.readAsDataURL(file);
        });
    }

    function textoValor(valor) {
        if (valor === null || valor === undefined || valor === "") return "—";
        return String(valor);
    }

    function fechaVisible(valor) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""))) return textoValor(valor);
        const [y, m, d] = String(valor).split("-");
        return `${d}-${m}-${y}`;
    }

    function moneda(valor, monedaCodigo = "CLP") {
        if (valor === null || valor === undefined || valor === "" || !Number.isFinite(Number(valor))) return "—";
        if (monedaCodigo === "CLP") {
            return `$${Math.round(Number(valor)).toLocaleString("es-CL")}`;
        }
        return `${Number(valor).toLocaleString("es-CL")} ${monedaCodigo || ""}`.trim();
    }

    function enteroOpcional(valor) {
        if (valor === null || valor === undefined || valor === "") return null;
        const numero = Number(valor);
        return Number.isInteger(numero) ? numero : NaN;
    }

    function tarifasDesdeReserva(r) {
        const total = enteroOpcional(r?.monto_total);
        const productos = enteroOpcional(r?.productos_adicionales);
        const ingreso = String(r?.fecha_llegada || "");
        const salida = String(r?.fecha_salida || "");

        if (!Number.isInteger(total) || total <= 0) return {};
        if (Number.isInteger(productos) && productos > 0) return {};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ingreso) || !/^\d{4}-\d{2}-\d{2}$/.test(salida)) return {};

        const inicioMs = Date.parse(`${ingreso}T00:00:00Z`);
        const salidaMs = Date.parse(`${salida}T00:00:00Z`);
        const noches = Math.round((salidaMs - inicioMs) / 86400000);
        if (!Number.isInteger(noches) || noches <= 0) return {};

        const base = Math.floor(total / noches);
        const resto = total - (base * noches);
        if (base <= 0) return {};

        const tarifas = {};
        for (let i = 0; i < noches; i++) {
            const fecha = new Date(inicioMs + (i * 86400000)).toISOString().slice(0, 10);
            tarifas[fecha] = base + (i < resto ? 1 : 0);
        }
        return tarifas;
    }

    function etiquetaTipo(tipo) {
        if (tipo === "full_day") return "Full Day";
        if (tipo === "alojamiento") return "Alojamiento";
        return "Por confirmar";
    }

    function normalizarClave(texto) {
        return String(texto || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function pagosDesdePreview(preview) {
        const lista = Array.isArray(preview?.pagos)
            ? preview.pagos.filter(item => item && item.detectado !== false)
            : [];
        if (lista.length) return lista;

        const legado = preview?.pago;
        return legado?.detectado === true ? [legado] : [];
    }

    function reservasMultiplesDesdePreview(preview) {
        if (!Array.isArray(preview?.reservas)) return [];
        return preview.reservas.filter(item => item?.reserva && typeof item.reserva === "object");
    }

    function webpayDesdePago(p) {
        if (!p || p.detectado === false) return null;

        const medioTexto = normalizarClave(p.medio);
        let medioRpc = null;
        let medioEtiqueta = null;

        if (medioTexto.includes("webpay") && medioTexto.includes("debito")) {
            medioRpc = "webpay_debito";
            medioEtiqueta = "WebPay Débito";
        } else if (medioTexto.includes("webpay") && medioTexto.includes("credito")) {
            medioRpc = "webpay_credito";
            medioEtiqueta = "WebPay Crédito";
        }

        if (!medioRpc) return null;

        const monto = Number(p.monto);
        const codaut = String(p.codaut || "").trim();
        const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(p.fecha || ""))
            ? String(p.fecha)
            : null;

        return {
            medioRpc,
            medioEtiqueta,
            monto,
            codaut,
            fecha,
            valido: Boolean(
                Number.isFinite(monto) &&
                monto > 0 &&
                codaut &&
                fecha
            )
        };
    }

    function transferenciaDesdePago(p) {
        if (!p || p.detectado === false) return null;

        const medioTexto = normalizarClave(p.medio);
        if (!medioTexto.includes("transferencia")) return null;

        const monto = Number(p.monto);
        const glosa = String(p.glosa || "").trim();
        const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(p.fecha || ""))
            ? String(p.fecha)
            : null;

        return {
            medioRpc: "transferencia",
            medioEtiqueta: "Transferencia bancaria",
            monto,
            glosa,
            fecha,
            valido: Boolean(
                Number.isFinite(monto) &&
                monto > 0 &&
                glosa &&
                fecha
            )
        };
    }

    function tarjetaDesdePago(p) {
        if (!p || p.detectado === false) return null;

        const medioTexto = normalizarClave(p.medio);
        if (medioTexto.includes("webpay") || !medioTexto.includes("tarjeta")) return null;

        const tieneDebito = medioTexto.includes("debito");
        const tieneCredito = medioTexto.includes("credito");
        if (tieneDebito && tieneCredito) return null;

        let medioRpc = null;
        let medioEtiqueta = null;
        if (tieneDebito) {
            medioRpc = "tarjeta_debito";
            medioEtiqueta = "Tarjeta Débito";
        } else if (tieneCredito) {
            medioRpc = "tarjeta_credito";
            medioEtiqueta = "Tarjeta Crédito";
        }

        if (!medioRpc) return null;

        const monto = Number(p.monto);
        const folio = String(p.folio || "").trim();
        const bovtar = String(p.bovtar || "").trim();
        const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(p.fecha || ""))
            ? String(p.fecha)
            : null;

        return {
            medioRpc,
            medioEtiqueta,
            monto,
            folio,
            bovtar,
            fecha,
            valido: Boolean(
                Number.isFinite(monto) &&
                monto > 0 &&
                folio &&
                bovtar &&
                fecha
            )
        };
    }

    function efectivoDesdePago(p) {
        if (!p || p.detectado === false) return null;

        const medioTexto = normalizarClave(p.medio);
        if (!medioTexto.includes("efectivo")) return null;

        const monto = Number(p.monto);
        const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(p.fecha || ""))
            ? String(p.fecha)
            : null;

        return {
            medioRpc: "efectivo",
            medioEtiqueta: "Efectivo",
            monto,
            fecha,
            valido: Boolean(
                Number.isFinite(monto) &&
                monto > 0 &&
                fecha
            )
        };
    }

    function agregarDato(contenedor, etiqueta, valor) {
        if (valor === null || valor === undefined || valor === "") return;
        const fila = document.createElement("div");
        fila.className = "haiku-asistente-preview-dato";
        const small = document.createElement("span");
        small.textContent = etiqueta;
        const strong = document.createElement("strong");
        strong.textContent = textoValor(valor);
        fila.append(small, strong);
        contenedor.appendChild(fila);
    }

    function agregarLista(contenedor, titulo, elementos, clase = "") {
        if (!Array.isArray(elementos) || elementos.length === 0) return;
        const bloque = document.createElement("div");
        bloque.className = `haiku-asistente-preview-lista${clase ? ` ${clase}` : ""}`;
        const encabezado = document.createElement("strong");
        encabezado.textContent = titulo;
        const ul = document.createElement("ul");
        elementos.forEach(texto => {
            const li = document.createElement("li");
            li.textContent = String(texto || "");
            ul.appendChild(li);
        });
        bloque.append(encabezado, ul);
        contenedor.appendChild(bloque);
    }

    function problemasFinancieros(r, pagos) {
        const problemas = [];
        const total = enteroOpcional(r?.monto_total);
        const pagado = enteroOpcional(r?.monto_pagado);
        const saldo = enteroOpcional(r?.saldo_pendiente);
        const adicionales = enteroOpcional(r?.productos_adicionales);

        if (Number.isNaN(total)) problemas.push("Monto Total de Cloudbeds inválido.");
        if (Number.isNaN(pagado)) problemas.push("Monto pagado de Cloudbeds inválido.");
        if (Number.isNaN(saldo)) problemas.push("Saldo pendiente de Cloudbeds inválido.");
        if (Number.isNaN(adicionales)) problemas.push("Productos adicionales de Cloudbeds inválidos.");

        if (Number.isInteger(total) && total <= 0) problemas.push("Monto Total de Cloudbeds debe ser mayor que cero.");
        if (Number.isInteger(adicionales) && adicionales > 0) {
            problemas.push("Cloudbeds incluye productos adicionales; revisar antes de usar el Monto Total como alojamiento.");
        }

        if (Number.isInteger(total) && Number.isInteger(pagado) && Number.isInteger(saldo) && total - pagado !== saldo) {
            problemas.push("Monto Total, Monto pagado y Saldo pendiente de Cloudbeds no cuadran entre sí.");
        }

        const sumaPagos = pagos.reduce((suma, pago) => {
            const monto = Number(pago?.monto);
            return suma + (Number.isFinite(monto) && monto > 0 ? Math.round(monto) : 0);
        }, 0);

        if (Number.isInteger(pagado) && sumaPagos !== pagado) {
            problemas.push(`Los abonos detectados suman ${moneda(sumaPagos, "CLP")}, pero Cloudbeds muestra Monto pagado ${moneda(pagado, "CLP")}.`);
        }

        if (Number.isInteger(total) && sumaPagos > total) {
            problemas.push("Los abonos detectados superan el Monto Total de Cloudbeds.");
        }

        return problemas;
    }

    function problemasParaCrear(preview) {
        const r = preview?.reserva || {};
        const pagos = pagosDesdePreview(preview);
        const problemas = [];

        if (r.tipo_estadia !== "alojamiento") {
            problemas.push("Por ahora el botón sólo crea reservas de alojamiento.");
        }
        if (!r.titular_nombre) problemas.push("Falta titular.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.fecha_llegada || ""))) problemas.push("Falta fecha de llegada válida.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.fecha_salida || ""))) problemas.push("Falta fecha de salida válida.");
        if (!Number.isInteger(Number(r.cabana)) || Number(r.cabana) < 1) problemas.push("Falta cabaña válida.");
        if (!String(r.cloudbeds_id || "").trim()) problemas.push("Falta ID de reserva Cloudbeds.");
        if (preview?.confianza === "baja") problemas.push("La confianza de lectura es baja.");
        if (pagos.length > 10) problemas.push("Se admiten como máximo 10 abonos por reserva.");

        problemas.push(...problemasFinancieros(r, pagos));

        pagos.forEach((p, indice) => {
            const prefijo = pagos.length > 1 ? `Abono ${indice + 1}: ` : "";
            const webpay = webpayDesdePago(p);
            const transferencia = transferenciaDesdePago(p);
            const tarjeta = tarjetaDesdePago(p);
            const efectivo = efectivoDesdePago(p);

            if (!webpay && !transferencia && !tarjeta && !efectivo) {
                problemas.push(`${prefijo}medio de pago no admitido automáticamente.`);
            } else if (webpay) {
                if (!Number.isFinite(Number(p.monto)) || Number(p.monto) <= 0) problemas.push(`${prefijo}falta monto WebPay válido.`);
                if (!String(p.codaut || "").trim()) problemas.push(`${prefijo}falta COD.AUT del WebPay.`);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.fecha || ""))) problemas.push(`${prefijo}falta fecha válida del WebPay.`);
            } else if (transferencia) {
                if (!Number.isFinite(Number(p.monto)) || Number(p.monto) <= 0) problemas.push(`${prefijo}falta monto de transferencia válido.`);
                if (!String(p.glosa || "").trim()) problemas.push(`${prefijo}falta Glosa de la transferencia.`);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.fecha || ""))) problemas.push(`${prefijo}falta fecha válida de la transferencia.`);
            } else if (tarjeta) {
                if (!Number.isFinite(Number(p.monto)) || Number(p.monto) <= 0) problemas.push(`${prefijo}falta monto de tarjeta válido.`);
                if (!String(p.folio || "").trim()) problemas.push(`${prefijo}falta Folio de la tarjeta.`);
                if (!String(p.bovtar || "").trim()) problemas.push(`${prefijo}falta BOVTAR de la tarjeta.`);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.fecha || ""))) problemas.push(`${prefijo}falta fecha válida del pago con tarjeta.`);
            } else if (efectivo) {
                if (!Number.isFinite(Number(p.monto)) || Number(p.monto) <= 0) problemas.push(`${prefijo}falta monto en efectivo válido.`);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.fecha || ""))) problemas.push(`${prefijo}falta fecha válida del pago en efectivo.`);
            }
        });

        return problemas;
    }

    function nombresAcompanantes(preview) {
        if (!Array.isArray(preview?.acompanantes)) return [];
        return preview.acompanantes
            .map(item => String(item?.nombre || "").trim())
            .filter(Boolean);
    }

    function pagoParaRpc(p) {
        const webpay = webpayDesdePago(p);
        if (webpay?.valido) {
            return {
                medio: webpay.medioRpc,
                monto: Math.round(webpay.monto),
                fecha_pago: new Date(`${webpay.fecha}T12:00:00`).toISOString(),
                codaut: webpay.codaut,
                glosa: null,
                folio: null,
                bovtar: null
            };
        }

        const transferencia = transferenciaDesdePago(p);
        if (transferencia?.valido) {
            return {
                medio: "transferencia",
                monto: Math.round(transferencia.monto),
                fecha_pago: new Date(`${transferencia.fecha}T12:00:00`).toISOString(),
                codaut: null,
                glosa: transferencia.glosa,
                folio: null,
                bovtar: null
            };
        }

        const tarjeta = tarjetaDesdePago(p);
        if (tarjeta?.valido) {
            return {
                medio: tarjeta.medioRpc,
                monto: Math.round(tarjeta.monto),
                fecha_pago: new Date(`${tarjeta.fecha}T12:00:00`).toISOString(),
                codaut: null,
                glosa: null,
                folio: tarjeta.folio,
                bovtar: tarjeta.bovtar
            };
        }

        const efectivo = efectivoDesdePago(p);
        if (efectivo?.valido) {
            return {
                medio: "efectivo",
                monto: Math.round(efectivo.monto),
                fecha_pago: new Date(`${efectivo.fecha}T12:00:00`).toISOString(),
                codaut: null,
                glosa: null,
                folio: null,
                bovtar: null
            };
        }

        return null;
    }

    function previewIndividualDesdeEntrada(entrada) {
        return {
            tipo_operacion: "crear_reserva",
            confianza: entrada?.confianza || "baja",
            reserva: entrada?.reserva || {},
            pagos: Array.isArray(entrada?.pagos) ? entrada.pagos : [],
            acompanantes: Array.isArray(entrada?.acompanantes) ? entrada.acompanantes : [],
            faltantes: Array.isArray(entrada?.faltantes) ? entrada.faltantes : [],
            advertencias: Array.isArray(entrada?.advertencias) ? entrada.advertencias : []
        };
    }

    function problemasParaCrearLote(preview) {
        const reservas = reservasMultiplesDesdePreview(preview);
        const problemas = [];

        if (reservas.length < 2 || reservas.length > 11) {
            problemas.push("El lote debe contener entre 2 y 11 reservas.");
            return problemas;
        }

        const ids = new Map();
        reservas.forEach((entrada, indice) => {
            const individual = previewIndividualDesdeEntrada(entrada);
            const nombre = individual?.reserva?.titular_nombre || `Reserva ${indice + 1}`;
            problemasParaCrear(individual).forEach(problema => {
                problemas.push(`Reserva ${indice + 1} (${nombre}): ${problema}`);
            });

            const id = String(individual?.reserva?.cloudbeds_id || "").trim();
            if (id) {
                if (ids.has(id)) {
                    problemas.push(`ID Cloudbeds repetido dentro del lote: ${id}.`);
                } else {
                    ids.set(id, indice);
                }
            }
        });

        for (let i = 0; i < reservas.length; i++) {
            const a = reservas[i]?.reserva || {};
            for (let j = i + 1; j < reservas.length; j++) {
                const b = reservas[j]?.reserva || {};
                if (Number(a.cabana) !== Number(b.cabana)) continue;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.fecha_llegada || "")) ||
                    !/^\d{4}-\d{2}-\d{2}$/.test(String(a.fecha_salida || "")) ||
                    !/^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha_llegada || "")) ||
                    !/^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha_salida || ""))) continue;

                if (a.fecha_llegada < b.fecha_salida && b.fecha_llegada < a.fecha_salida) {
                    problemas.push(`CAB ${a.cabana} aparece ocupada por dos reservas del mismo lote en fechas superpuestas.`);
                }
            }
        }

        return [...new Set(problemas)];
    }

    function payloadReservaLote(entrada) {
        const individual = previewIndividualDesdeEntrada(entrada);
        const r = individual.reserva;
        const pagos = pagosDesdePreview(individual);
        const pagosRpc = pagos.map(pagoParaRpc);
        if (pagosRpc.some(item => !item)) {
            throw new Error(`La reserva de ${r.titular_nombre || "titular por revisar"} contiene un pago no válido.`);
        }

        return {
            titular_nombre: r.titular_nombre,
            cabana_numero: Number(r.cabana),
            fecha_ingreso: r.fecha_llegada,
            fecha_salida: r.fecha_salida,
            adultos: Math.max(0, Number(r.adultos ?? 1)),
            ninos: Math.max(0, Number(r.ninos ?? 0)),
            mascotas: Math.max(0, Number(r.mascotas ?? 0)),
            correo_contacto: r.correo || null,
            telefono_contacto: r.telefono || null,
            observaciones: r.observaciones || null,
            tarifas: tarifasDesdeReserva(r),
            acompanantes: nombresAcompanantes(individual),
            cloudbeds_id: String(r.cloudbeds_id || "").trim(),
            pagos: pagosRpc
        };
    }

    async function crearLoteDesdePreview(preview) {
        if (!window.haikuTienePermiso?.("reservas.crear")) {
            throw new Error("Tu usuario no tiene permiso para crear reservas.");
        }

        const reservas = reservasMultiplesDesdePreview(preview);
        const problemas = problemasParaCrearLote(preview);
        if (problemas.length) {
            throw new Error(problemas.join(" "));
        }

        const totalPagos = reservas.reduce(
            (total, entrada) => total + (Array.isArray(entrada?.pagos) ? entrada.pagos.filter(p => p && p.detectado !== false).length : 0),
            0
        );

        if (totalPagos > 0) {
            if (!window.haikuTienePermiso?.("pagos.registrar")) {
                throw new Error("Tu usuario no tiene permiso para registrar pagos.");
            }
            if (!window.haikuTienePermiso?.("pagos.verificar")) {
                throw new Error("Tu usuario no tiene permiso para verificar pagos.");
            }
        }

        const payload = reservas.map(payloadReservaLote);
        const { data, error } = await cliente.rpc(
            "haiku_crear_lote_reservas_asistente",
            { p_reservas: payload }
        );

        if (error) {
            if (error?.code === "23505" || /cloudbeds_id|reservas_cloudbeds_id_uidx/i.test(error?.message || "")) {
                throw new Error("Al menos una de las reservas de Cloudbeds ya existe en Proyecto H. No se guardó ninguna reserva del lote.");
            }
            throw error;
        }

        return data;
    }

    async function crearReservaDesdePreview(preview) {
        if (!window.haikuTienePermiso?.("reservas.crear")) {
            throw new Error("Tu usuario no tiene permiso para crear reservas.");
        }

        const problemas = problemasParaCrear(preview);
        if (problemas.length) {
            throw new Error(problemas.join(" "));
        }

        const r = preview.reserva;
        const cabana = Number(r.cabana);
        const pagos = pagosDesdePreview(preview);
        const tarifas = tarifasDesdeReserva(r);

        const { data: disponibles, error: errorDisponibilidad } = await cliente.rpc(
            "haiku_cabanas_disponibles",
            {
                p_fecha_ingreso: r.fecha_llegada,
                p_fecha_salida: r.fecha_salida,
                p_tipo_estadia: "alojamiento"
            }
        );

        if (errorDisponibilidad) throw errorDisponibilidad;

        const disponible = (disponibles || []).some(
            item => Number(item.numero) === cabana
        );

        if (!disponible) {
            throw new Error(`CAB ${cabana} ya no está disponible para ese rango.`);
        }

        const pagoUnico = pagos[0] || null;
        const webpay = webpayDesdePago(pagoUnico);
        const transferencia = transferenciaDesdePago(pagoUnico);
        const tarjeta = tarjetaDesdePago(pagoUnico);
        const efectivo = efectivoDesdePago(pagoUnico);
        const usarRpcAbonos = pagos.length > 1 || tarjeta?.valido || efectivo?.valido;

        if (usarRpcAbonos) {
            if (!window.haikuTienePermiso?.("pagos.registrar")) {
                throw new Error("Tu usuario no tiene permiso para registrar pagos.");
            }
            if (!window.haikuTienePermiso?.("pagos.verificar")) {
                throw new Error("Tu usuario no tiene permiso para verificar pagos.");
            }

            const pagosRpc = pagos.map(pagoParaRpc);
            if (pagosRpc.some(item => !item)) {
                throw new Error("Uno de los abonos no tiene un formato automático válido.");
            }

            const { data, error } = await cliente.rpc(
                "haiku_crear_reserva_con_abonos",
                {
                    p_titular_nombre: r.titular_nombre,
                    p_cabana_numero: cabana,
                    p_fecha_ingreso: r.fecha_llegada,
                    p_fecha_salida: r.fecha_salida,
                    p_adultos: Math.max(0, Number(r.adultos ?? 1)),
                    p_ninos: Math.max(0, Number(r.ninos ?? 0)),
                    p_mascotas: Math.max(0, Number(r.mascotas ?? 0)),
                    p_correo_contacto: r.correo || null,
                    p_telefono_contacto: r.telefono || null,
                    p_observaciones: r.observaciones || null,
                    p_tarifas: tarifas,
                    p_acompanantes: nombresAcompanantes(preview),
                    p_cloudbeds_id: String(r.cloudbeds_id).trim(),
                    p_pagos: pagosRpc
                }
            );

            if (error) {
                if (error?.code === "23505" || /cloudbeds_id|reservas_cloudbeds_id_uidx/i.test(error?.message || "")) {
                    throw new Error("Esta reserva de Cloudbeds ya existe en Proyecto H.");
                }
                throw error;
            }

            return {
                ...data,
                pago_confirmado: true,
                cantidad_pagos: pagos.length,
                monto_pago: pagos.reduce((total, p) => total + Number(p?.monto || 0), 0)
            };
        }

        if (webpay?.valido) {
            if (!window.haikuTienePermiso?.("pagos.registrar")) {
                throw new Error("Tu usuario no tiene permiso para registrar pagos.");
            }
            if (!window.haikuTienePermiso?.("pagos.verificar")) {
                throw new Error("Tu usuario no tiene permiso para verificar pagos.");
            }

            const fechaPagoIso = new Date(`${webpay.fecha}T12:00:00`).toISOString();
            const { data, error } = await cliente.rpc(
                "haiku_crear_reserva_con_webpay",
                {
                    p_titular_nombre: r.titular_nombre,
                    p_cabana_numero: cabana,
                    p_fecha_ingreso: r.fecha_llegada,
                    p_fecha_salida: r.fecha_salida,
                    p_adultos: Math.max(0, Number(r.adultos ?? 1)),
                    p_ninos: Math.max(0, Number(r.ninos ?? 0)),
                    p_mascotas: Math.max(0, Number(r.mascotas ?? 0)),
                    p_correo_contacto: r.correo || null,
                    p_telefono_contacto: r.telefono || null,
                    p_observaciones: r.observaciones || null,
                    p_tarifas: tarifas,
                    p_acompanantes: nombresAcompanantes(preview),
                    p_cloudbeds_id: String(r.cloudbeds_id).trim(),
                    p_webpay_monto: Math.round(webpay.monto),
                    p_webpay_medio: webpay.medioRpc,
                    p_webpay_codaut: webpay.codaut,
                    p_webpay_fecha_pago: fechaPagoIso
                }
            );

            if (error) {
                if (error?.code === "23505" || /cloudbeds_id|reservas_cloudbeds_id_uidx/i.test(error?.message || "")) {
                    throw new Error("Esta reserva de Cloudbeds ya existe en Proyecto H.");
                }
                throw error;
            }

            return {
                ...data,
                pago_confirmado: true,
                cantidad_pagos: 1,
                medio_pago: webpay.medioEtiqueta,
                monto_pago: webpay.monto,
                codaut: webpay.codaut
            };
        }

        if (transferencia?.valido) {
            if (!window.haikuTienePermiso?.("pagos.registrar")) {
                throw new Error("Tu usuario no tiene permiso para registrar pagos.");
            }
            if (!window.haikuTienePermiso?.("pagos.verificar")) {
                throw new Error("Tu usuario no tiene permiso para verificar pagos.");
            }

            const fechaPagoIso = new Date(`${transferencia.fecha}T12:00:00`).toISOString();
            const { data, error } = await cliente.rpc(
                "haiku_crear_reserva_con_transferencia",
                {
                    p_titular_nombre: r.titular_nombre,
                    p_cabana_numero: cabana,
                    p_fecha_ingreso: r.fecha_llegada,
                    p_fecha_salida: r.fecha_salida,
                    p_adultos: Math.max(0, Number(r.adultos ?? 1)),
                    p_ninos: Math.max(0, Number(r.ninos ?? 0)),
                    p_mascotas: Math.max(0, Number(r.mascotas ?? 0)),
                    p_correo_contacto: r.correo || null,
                    p_telefono_contacto: r.telefono || null,
                    p_observaciones: r.observaciones || null,
                    p_tarifas: tarifas,
                    p_acompanantes: nombresAcompanantes(preview),
                    p_cloudbeds_id: String(r.cloudbeds_id).trim(),
                    p_transferencia_monto: Math.round(transferencia.monto),
                    p_transferencia_glosa: transferencia.glosa,
                    p_transferencia_fecha_pago: fechaPagoIso
                }
            );

            if (error) {
                if (error?.code === "23505" || /cloudbeds_id|reservas_cloudbeds_id_uidx/i.test(error?.message || "")) {
                    throw new Error("Esta reserva de Cloudbeds ya existe en Proyecto H.");
                }
                throw error;
            }

            return {
                ...data,
                pago_confirmado: true,
                cantidad_pagos: 1,
                medio_pago: transferencia.medioEtiqueta,
                monto_pago: transferencia.monto,
                glosa: transferencia.glosa
            };
        }

        const { data, error } = await cliente.rpc(
            "haiku_crear_reserva",
            {
                p_titular_nombre: r.titular_nombre,
                p_cabana_numero: cabana,
                p_fecha_ingreso: r.fecha_llegada,
                p_fecha_salida: r.fecha_salida,
                p_adultos: Math.max(0, Number(r.adultos ?? 1)),
                p_ninos: Math.max(0, Number(r.ninos ?? 0)),
                p_mascotas: Math.max(0, Number(r.mascotas ?? 0)),
                p_correo_contacto: r.correo || null,
                p_telefono_contacto: r.telefono || null,
                p_rut: null,
                p_observaciones: r.observaciones || null,
                p_tarifas: tarifas,
                p_acompanantes: nombresAcompanantes(preview),
                p_tipo_estadia: "alojamiento",
                p_cloudbeds_id: String(r.cloudbeds_id).trim()
            }
        );

        if (error) {
            if (error?.code === "23505" || /cloudbeds_id|reservas_cloudbeds_id_uidx/i.test(error?.message || "")) {
                throw new Error("Esta reserva de Cloudbeds ya existe en Proyecto H.");
            }
            throw error;
        }

        return data;
    }

    async function refrescarDespuesDeCrear() {
        try {
            if (typeof window.haikuSincronizarReservasSupabase === "function") {
                await window.haikuSincronizarReservasSupabase();
            }
        } catch (error) {
            console.warn("HAIKU · Asistente: reserva creada, pero falló sincronización visual:", error);
        }

        try { await window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(); } catch {}
        try { if (typeof window.cargarAbonosPagos === "function") await window.cargarAbonosPagos(); } catch {}
        try { if (typeof window.cargarSaldosCheckin === "function") await window.cargarSaldosCheckin(); } catch {}
        try { if (typeof generarCalendario === "function") generarCalendario(); } catch {}
    }

    function renderizarPreviewMultiple(preview) {
        ultimaPreview = preview;
        const reservas = reservasMultiplesDesdePreview(preview);

        const lote = document.createElement("article");
        lote.className = "haiku-asistente-preview";

        const cabecera = document.createElement("div");
        cabecera.className = "haiku-asistente-preview-cabecera";
        const titulo = document.createElement("div");
        const marca = document.createElement("span");
        marca.textContent = "VISTA PREVIA DE LOTE · NADA GUARDADO";
        const nombre = document.createElement("strong");
        nombre.textContent = `${reservas.length} reservas detectadas`;
        titulo.append(marca, nombre);

        const confianza = document.createElement("span");
        confianza.className = `haiku-asistente-confianza haiku-asistente-confianza--${preview?.confianza || "baja"}`;
        confianza.textContent = `Confianza ${preview?.confianza || "baja"}`;
        cabecera.append(titulo, confianza);
        lote.appendChild(cabecera);

        if (preview?.resumen) {
            const resumen = document.createElement("p");
            resumen.className = "haiku-asistente-preview-resumen";
            resumen.textContent = preview.resumen;
            lote.appendChild(resumen);
        }

        reservas.forEach((entrada, indice) => {
            const r = entrada?.reserva || {};
            const bloque = document.createElement("section");
            bloque.className = "haiku-asistente-preview-observacion";

            const encabezado = document.createElement("span");
            encabezado.textContent = `RESERVA ${indice + 1} DE ${reservas.length}`;
            const nombreReserva = document.createElement("p");
            nombreReserva.textContent = `${r.titular_nombre || "Titular por revisar"}${r.cabana ? ` · CAB ${r.cabana}` : ""}`;
            bloque.append(encabezado, nombreReserva);

            if (entrada?.resumen) {
                const resumenReserva = document.createElement("p");
                resumenReserva.textContent = entrada.resumen;
                bloque.appendChild(resumenReserva);
            }

            const datos = document.createElement("div");
            datos.className = "haiku-asistente-preview-grid";
            agregarDato(datos, "Tipo", etiquetaTipo(r.tipo_estadia));
            agregarDato(datos, "Llegada", fechaVisible(r.fecha_llegada));
            agregarDato(datos, "Salida", fechaVisible(r.fecha_salida));
            agregarDato(datos, "Cabaña", r.cabana ? `CAB ${r.cabana}` : null);
            agregarDato(datos, "Adultos", r.adultos);
            agregarDato(datos, "Noches", r.noches);
            agregarDato(datos, "ID Cloudbeds", r.cloudbeds_id);
            agregarDato(datos, "Correo", r.correo);
            agregarDato(datos, "Teléfono", r.telefono);
            agregarDato(datos, "Fuente", r.fuente);
            agregarDato(datos, "Total Cloudbeds", r.monto_total === null || r.monto_total === undefined ? null : moneda(r.monto_total, "CLP"));
            agregarDato(datos, "Pagado Cloudbeds", r.monto_pagado === null || r.monto_pagado === undefined ? null : moneda(r.monto_pagado, "CLP"));
            agregarDato(datos, "Saldo Cloudbeds", r.saldo_pendiente === null || r.saldo_pendiente === undefined ? null : moneda(r.saldo_pendiente, "CLP"));
            bloque.appendChild(datos);

            const pagos = Array.isArray(entrada?.pagos)
                ? entrada.pagos.filter(item => item && item.detectado !== false)
                : [];
            pagos.forEach((p, pagoIndice) => {
                const pago = document.createElement("div");
                pago.className = "haiku-asistente-preview-pago";
                const tituloPago = document.createElement("strong");
                tituloPago.textContent = pagos.length > 1
                    ? `Pago ${pagoIndice + 1} de ${pagos.length}`
                    : "Pago detectado";
                const grid = document.createElement("div");
                grid.className = "haiku-asistente-preview-grid";
                agregarDato(grid, "Monto", moneda(p.monto, p.moneda));
                agregarDato(grid, "Medio", p.medio);
                agregarDato(grid, "Fecha", fechaVisible(p.fecha));
                agregarDato(grid, "Glosa", p.glosa);
                agregarDato(grid, "CodAut", p.codaut);
                agregarDato(grid, "Folio", p.folio);
                agregarDato(grid, "BOVTAR", p.bovtar);
                pago.append(tituloPago, grid);
                bloque.appendChild(pago);
            });

            if (Array.isArray(entrada?.acompanantes) && entrada.acompanantes.length) {
                const nombres = entrada.acompanantes.map(item => {
                    const n = item?.nombre || "Acompañante sin nombre";
                    return item?.documento ? `${n} · ${item.documento}` : n;
                });
                agregarLista(bloque, "Acompañantes", nombres);
            }

            agregarLista(bloque, "Datos faltantes", entrada?.faltantes, "haiku-asistente-preview-lista--faltantes");
            agregarLista(bloque, "Revisar", entrada?.advertencias, "haiku-asistente-preview-lista--alerta");
            lote.appendChild(bloque);
        });

        const totalPagos = reservas.reduce(
            (total, entrada) => total + (Array.isArray(entrada?.pagos) ? entrada.pagos.filter(p => p && p.detectado !== false).length : 0),
            0
        );
        const problemas = problemasParaCrearLote(preview);
        const tienePermisoReserva = window.haikuTienePermiso?.("reservas.crear") === true;
        const tienePermisoPago = totalPagos === 0 || (
            window.haikuTienePermiso?.("pagos.registrar") === true &&
            window.haikuTienePermiso?.("pagos.verificar") === true
        );
        const puedeCrear = problemas.length === 0 && tienePermisoReserva && tienePermisoPago;

        const pie = document.createElement("div");
        pie.className = "haiku-asistente-preview-pie";
        const estado = document.createElement("span");
        estado.textContent = "🔒 Nada guardado todavía. El lote se guardará completo o no se guardará nada.";
        const botonCrear = document.createElement("button");
        botonCrear.type = "button";
        botonCrear.disabled = !puedeCrear;
        botonCrear.textContent = puedeCrear
            ? `Confirmar ${reservas.length} reservas${totalPagos ? ` + ${totalPagos} ${totalPagos === 1 ? "abono" : "abonos"}` : ""}`
            : "Crear lote · revisar datos";

        if (problemas.length) botonCrear.title = problemas.join(" ");
        if (!tienePermisoReserva) botonCrear.title = "Tu usuario no tiene permiso para crear reservas.";
        if (totalPagos > 0 && !tienePermisoPago) botonCrear.title = "Tu usuario no tiene permisos para registrar y verificar los pagos del lote.";

        botonCrear.addEventListener("click", async () => {
            if (guardandoReserva || botonCrear.disabled) return;

            const confirmacion = `¿Confirmas crear ${reservas.length} reservas${totalPagos ? ` y registrar ${totalPagos} ${totalPagos === 1 ? "abono" : "abonos"}` : ""}?`;
            if (!window.confirm(confirmacion)) return;

            const textoOriginal = botonCrear.textContent;
            guardandoReserva = true;
            actualizarEnviar();
            botonCrear.disabled = true;
            botonCrear.textContent = `Creando ${reservas.length} reservas…`;
            estado.textContent = "Validando y guardando el lote completo…";

            try {
                const resultado = await crearLoteDesdePreview(preview);
                await refrescarDespuesDeCrear();

                const cantidadReservas = Number(resultado?.cantidad_reservas || reservas.length);
                const cantidadPagos = Number(resultado?.cantidad_pagos || totalPagos);
                marca.textContent = "LOTE CREADO";
                estado.textContent = `✅ ${cantidadReservas} reservas${cantidadPagos ? ` y ${cantidadPagos} ${cantidadPagos === 1 ? "abono" : "abonos"}` : ""} guardados correctamente.`;
                botonCrear.textContent = `${cantidadReservas} reservas creadas`;
                botonCrear.disabled = true;
                lote.dataset.haikuLoteCreado = "1";

                agregarMensaje(
                    "asistente",
                    `Lote creado correctamente: ${cantidadReservas} reservas${cantidadPagos ? ` y ${cantidadPagos} ${cantidadPagos === 1 ? "abono" : "abonos"}` : ""}.`
                );
            } catch (error) {
                console.error("HAIKU · Asistente no pudo crear lote:", error);
                estado.textContent = `⚠️ No se guardó ninguna reserva del lote: ${error?.message || "error desconocido"}`;
                botonCrear.textContent = textoOriginal;
                botonCrear.disabled = !puedeCrear;
            } finally {
                guardandoReserva = false;
                actualizarEnviar();
                scrollFinal();
            }
        });

        pie.append(estado, botonCrear);
        lote.appendChild(pie);

        mensajes.appendChild(lote);
        scrollFinal();
        return lote;
    }

    function renderizarPreview(preview) {
        const reservasMultiples = reservasMultiplesDesdePreview(preview);
        if (reservasMultiples.length > 1) {
            return renderizarPreviewMultiple(preview);
        }

        ultimaPreview = preview;

        const card = document.createElement("article");
        card.className = "haiku-asistente-preview";

        const cabecera = document.createElement("div");
        cabecera.className = "haiku-asistente-preview-cabecera";
        const titulo = document.createElement("div");
        const marca = document.createElement("span");
        marca.textContent = "VISTA PREVIA · NADA GUARDADO";
        const nombre = document.createElement("strong");
        nombre.textContent = preview?.reserva?.titular_nombre || "Reserva por revisar";
        titulo.append(marca, nombre);

        const confianza = document.createElement("span");
        confianza.className = `haiku-asistente-confianza haiku-asistente-confianza--${preview?.confianza || "baja"}`;
        confianza.textContent = `Confianza ${preview?.confianza || "baja"}`;
        cabecera.append(titulo, confianza);
        card.appendChild(cabecera);

        if (preview?.resumen) {
            const resumen = document.createElement("p");
            resumen.className = "haiku-asistente-preview-resumen";
            resumen.textContent = preview.resumen;
            card.appendChild(resumen);
        }

        const datos = document.createElement("div");
        datos.className = "haiku-asistente-preview-grid";
        const r = preview?.reserva || {};
        agregarDato(datos, "Tipo", etiquetaTipo(r.tipo_estadia));
        agregarDato(datos, "Llegada / fecha", fechaVisible(r.fecha_llegada));
        agregarDato(datos, "Salida", fechaVisible(r.fecha_salida));
        agregarDato(datos, "Cabaña", r.cabana ? `CAB ${r.cabana}` : null);
        agregarDato(datos, "Adultos", r.adultos);
        agregarDato(datos, "Niños", r.ninos);
        agregarDato(datos, "Mascotas", r.mascotas);
        agregarDato(datos, "Noches", r.noches);
        agregarDato(datos, "Documento", r.documento);
        agregarDato(datos, "ID Cloudbeds", r.cloudbeds_id);
        agregarDato(datos, "Nacionalidad", r.nacionalidad);
        agregarDato(datos, "Correo", r.correo);
        agregarDato(datos, "Teléfono", r.telefono);
        agregarDato(datos, "Fuente", r.fuente);
        agregarDato(datos, "Tarifa", r.plan_tarifa);
        agregarDato(datos, "Total Cloudbeds", r.monto_total === null || r.monto_total === undefined ? null : moneda(r.monto_total, "CLP"));
        agregarDato(datos, "Pagado Cloudbeds", r.monto_pagado === null || r.monto_pagado === undefined ? null : moneda(r.monto_pagado, "CLP"));
        agregarDato(datos, "Saldo Cloudbeds", r.saldo_pendiente === null || r.saldo_pendiente === undefined ? null : moneda(r.saldo_pendiente, "CLP"));
        card.appendChild(datos);

        if (r.observaciones) {
            const obs = document.createElement("div");
            obs.className = "haiku-asistente-preview-observacion";
            const label = document.createElement("span");
            label.textContent = "Observaciones detectadas";
            const texto = document.createElement("p");
            texto.textContent = r.observaciones;
            obs.append(label, texto);
            card.appendChild(obs);
        }

        const pagos = pagosDesdePreview(preview);
        pagos.forEach((p, indice) => {
            const pago = document.createElement("div");
            pago.className = "haiku-asistente-preview-pago";
            const encabezado = document.createElement("strong");
            encabezado.textContent = pagos.length > 1
                ? `Pago ${indice + 1} de ${pagos.length}`
                : "Pago detectado";
            const grid = document.createElement("div");
            grid.className = "haiku-asistente-preview-grid";
            agregarDato(grid, "Monto", moneda(p.monto, p.moneda));
            agregarDato(grid, "Medio", p.medio);
            agregarDato(grid, "Fecha", fechaVisible(p.fecha));
            agregarDato(grid, "Glosa", p.glosa);
            agregarDato(grid, "CodAut", p.codaut);
            agregarDato(grid, "Folio", p.folio);
            agregarDato(grid, "BOVTAR", p.bovtar);
            pago.append(encabezado, grid);
            card.appendChild(pago);
        });

        if (Array.isArray(preview?.acompanantes) && preview.acompanantes.length) {
            const nombres = preview.acompanantes.map(item => {
                const n = item?.nombre || "Acompañante sin nombre";
                return item?.documento ? `${n} · ${item.documento}` : n;
            });
            agregarLista(card, "Acompañantes detectados", nombres);
        }

        agregarLista(card, "Datos faltantes", preview?.faltantes, "haiku-asistente-preview-lista--faltantes");
        agregarLista(card, "Revisar antes de continuar", preview?.advertencias, "haiku-asistente-preview-lista--alerta");

        const pie = document.createElement("div");
        pie.className = "haiku-asistente-preview-pie";
        const estado = document.createElement("span");
        estado.textContent = "🔒 Nada guardado todavía.";
        const botonCrear = document.createElement("button");
        botonCrear.type = "button";

        const problemas = problemasParaCrear(preview);
        const cantidadPagos = pagos.length;
        const pagosValidos = pagos.every(p =>
            webpayDesdePago(p)?.valido ||
            transferenciaDesdePago(p)?.valido ||
            tarjetaDesdePago(p)?.valido ||
            efectivoDesdePago(p)?.valido
        );
        const pagoValido = cantidadPagos > 0 && pagosValidos;
        const requierePago = cantidadPagos > 0;
        const tienePermisoReserva = window.haikuTienePermiso?.("reservas.crear") === true;
        const tienePermisoPago = !requierePago || (
            window.haikuTienePermiso?.("pagos.registrar") === true &&
            window.haikuTienePermiso?.("pagos.verificar") === true
        );
        const puedeCrear = problemas.length === 0 && tienePermisoReserva && tienePermisoPago;

        botonCrear.disabled = !puedeCrear;
        botonCrear.textContent = puedeCrear
            ? pagoValido
                ? `Confirmar reserva + ${cantidadPagos} ${cantidadPagos === 1 ? "abono" : "abonos"}`
                : "Confirmar y crear"
            : r.tipo_estadia === "full_day"
                ? "Full Day · próxima etapa"
                : "Crear reserva · revisar datos";

        if (problemas.length) botonCrear.title = problemas.join(" ");
        if (!tienePermisoReserva) botonCrear.title = "Tu usuario no tiene permiso para crear reservas.";
        if (requierePago && !tienePermisoPago) botonCrear.title = "Tu usuario no tiene permisos para registrar y verificar este pago.";

        botonCrear.addEventListener("click", async () => {
            if (guardandoReserva || botonCrear.disabled) return;

            const confirmacion = pagoValido
                ? `¿Confirmas crear 1 reserva y registrar ${cantidadPagos} ${cantidadPagos === 1 ? "abono" : "abonos"}?`
                : "¿Confirmas crear 1 reserva?";

            if (!window.confirm(confirmacion)) return;

            const textoOriginal = botonCrear.textContent;
            guardandoReserva = true;
            actualizarEnviar();
            botonCrear.disabled = true;
            botonCrear.textContent = pagoValido
                ? `Creando reserva + ${cantidadPagos} ${cantidadPagos === 1 ? "abono" : "abonos"}…`
                : "Creando reserva…";
            estado.textContent = "Validando disponibilidad antes de guardar…";

            try {
                const creada = await crearReservaDesdePreview(preview);
                await refrescarDespuesDeCrear();

                if (creada?.pago_confirmado) {
                    const cantidadGuardada = Math.max(1, Number(creada?.cantidad_pagos || cantidadPagos || 1));
                    const palabraAbono = cantidadGuardada === 1 ? "abono" : "abonos";
                    marca.textContent = cantidadGuardada === 1
                        ? "RESERVA + ABONO CREADOS"
                        : `RESERVA + ${cantidadGuardada} ABONOS CREADOS`;
                    const saldoTexto = Number.isFinite(Number(creada?.saldo_restante))
                        ? ` · saldo restante ${moneda(creada.saldo_restante, "CLP")}`
                        : "";
                    estado.textContent = `✅ Reserva y ${cantidadGuardada} ${palabraAbono} guardados correctamente${creada?.codigo_haiku ? ` · ${creada.codigo_haiku}` : ""}${saldoTexto}.`;
                    botonCrear.textContent = `Reserva + ${cantidadGuardada} ${palabraAbono} creados`;
                    agregarMensaje(
                        "asistente",
                        `Reserva de ${r.titular_nombre} creada en CAB ${r.cabana} y ${cantidadGuardada} ${palabraAbono} por ${moneda(creada.monto_pago, "CLP")} confirmados.`
                    );
                } else {
                    marca.textContent = "RESERVA CREADA";
                    estado.textContent = `✅ Reserva creada en Proyecto H${creada?.codigo_haiku ? ` · ${creada.codigo_haiku}` : ""}.`;
                    botonCrear.textContent = "Reserva creada";
                    agregarMensaje(
                        "asistente",
                        `Reserva de ${r.titular_nombre} creada correctamente en CAB ${r.cabana}.`
                    );
                }

                botonCrear.disabled = true;
                card.dataset.haikuReservaCreada = "1";
            } catch (error) {
                console.error("HAIKU · Asistente no pudo crear reserva:", error);
                estado.textContent = `⚠️ No se guardó la operación: ${error?.message || "error desconocido"}`;
                botonCrear.textContent = textoOriginal;
                botonCrear.disabled = false;
            } finally {
                guardandoReserva = false;
                actualizarEnviar();
                scrollFinal();
            }
        });

        pie.append(estado, botonCrear);
        card.appendChild(pie);

        mensajes.appendChild(card);
        scrollFinal();
        return card;
    }

    async function detalleErrorFuncion(error) {
        try {
            const respuesta = error?.context;
            if (respuesta && typeof respuesta.clone === "function") {
                return await respuesta.clone().json();
            }
        } catch {}
        return null;
    }

    async function analizarReserva(mensaje, imagenes) {
        const { data, error } = await cliente.functions.invoke("haiku-asistente-reserva", {
            body: {
                mensaje,
                imagenes,
            },
        });

        if (error) {
            const detalle = await detalleErrorFuncion(error);
            const e = new Error(detalle?.error || error?.message || "No fue posible analizar las capturas.");
            e.code = detalle?.code || "FUNCTION_ERROR";
            throw e;
        }

        if (!data?.ok || !data?.preview) {
            const e = new Error(data?.error || "El asistente no devolvió una vista previa.");
            e.code = data?.code || "INVALID_PREVIEW";
            throw e;
        }

        return data;
    }

    async function enviarMensaje() {
        if (procesando || guardandoReserva) return;

        const texto = campo.value.trim();
        if (!texto && adjuntos.length === 0) return;

        const cantidad = adjuntos.length;
        const archivosActuales = adjuntos.map(item => item.file);
        if (archivosActuales.some(file => file.type === "application/pdf")) {
            if (archivosActuales.length !== 1) {
                agregarMensaje("asistente", "Para revisar Cloudbeds, deja sólo un PDF adjunto, sin imágenes.");
                return;
            }
            const lector = window.HAIKU_CLOUDBEDS_PDF_V1;
            if (!lector) { agregarMensaje("asistente", "No se cargó el lector local de PDF. Recarga el panel."); return; }
            procesando = true; actualizarEnviar();
            agregarMensaje("usuario", texto || "Revisar PDF Cloudbeds");
            const estadoPDF = agregarMensaje("asistente", "Leyendo PDF Cloudbeds localmente…");
            campo.value = ""; limpiarAdjuntos();
            let limite;
            try {
                const entradas = await Promise.race([(async () => lector.leerPDF(await archivosActuales[0].arrayBuffer()))(), new Promise((_, reject) => { limite = setTimeout(() => reject(new Error("La lectura del PDF tardó demasiado.")), 45000); })]);
                clearTimeout(limite);
                estadoPDF.textContent = "Comparando con Proyecto H · sólo lectura…";
                const informe = await Promise.race([lector.consultar(entradas, cliente), new Promise((_, reject) => { limite = setTimeout(() => reject(new Error("La consulta tardó demasiado. Vuelve a intentarlo.")), 30000); })]);
                estadoPDF.innerHTML = lector.renderizar(informe);
            } catch (error) { estadoPDF.textContent = `No pude completar el informe: ${error?.message || "PDF no soportado"}`; }
            finally { clearTimeout(limite); procesando = false; actualizarEnviar(); scrollFinal(); }
            return;
        }
        const instruccion = texto || "Analiza estas capturas y prepara una vista previa de la reserva.";

        procesando = true;
        actualizarEnviar();

        let imagenes;
        try {
            imagenes = await Promise.all(archivosActuales.map(archivoADataUrl));
        } catch (error) {
            procesando = false;
            actualizarEnviar();
            agregarMensaje("asistente", error?.message || "No pude preparar una de las imágenes.");
            return;
        }

        const partes = [];
        if (texto) partes.push(texto);
        if (cantidad) partes.push(`${cantidad} ${cantidad === 1 ? "imagen adjunta" : "imágenes adjuntas"}`);
        agregarMensaje("usuario", partes.join("\n\n") || "Analizar capturas");

        campo.value = "";
        limpiarAdjuntos();
        actualizarEnviar();

        const estado = agregarMensaje(
            "asistente",
            cantidad
                ? `Analizando ${cantidad} ${cantidad === 1 ? "captura" : "capturas"}…`
                : "Analizando la instrucción…",
            "haiku-asistente-mensaje--procesando"
        );

        try {
            const resultado = await analizarReserva(instruccion, imagenes);
            estado.classList.remove("haiku-asistente-mensaje--procesando");
            estado.textContent = resultado.preview?.resumen || "Análisis completado. Revisa los datos antes de continuar.";
            renderizarPreview(resultado.preview);
        } catch (error) {
            console.error("HAIKU · Asistente IA:", error);
            estado.classList.remove("haiku-asistente-mensaje--procesando");

            if (error?.code === "OPENAI_API_KEY_NOT_CONFIGURED") {
                estado.textContent = "El asistente ya está conectado, pero falta configurar su clave privada de OpenAI en Supabase. No se envió ni guardó ninguna reserva.";
            } else {
                estado.textContent = `No pude completar el análisis: ${error?.message || "error desconocido"}`;
            }
        } finally {
            procesando = false;
            actualizarEnviar();
            scrollFinal();
        }
    }

    boton.addEventListener("click", alternarPanel);
    cerrar.addEventListener("click", cerrarPanel);
    adjuntar.addEventListener("click", () => {
        if (!procesando && !guardandoReserva) archivosInput.click();
    });
    archivosInput.addEventListener("change", () => incorporarArchivos(archivosInput.files || []));
    campo.addEventListener("input", actualizarEnviar);
    campo.addEventListener("paste", evento => {
        if (procesando || guardandoReserva) return;

        const imagenes = imagenesDesdePortapapeles(evento);
        if (!imagenes.length) return;

        evento.preventDefault();
        incorporarArchivos(imagenes);
    });
    campo.addEventListener("keydown", evento => {
        if ((evento.ctrlKey || evento.metaKey) && evento.key === "Enter") {
            evento.preventDefault();
            enviarMensaje();
        }
    });
    enviar.addEventListener("click", enviarMensaje);
    // Reclamar PDF antes de los interceptores de imágenes y de cualquier writer.
    function interceptarPDF(evento) {
        const accion = evento.type === "click" ? evento.target?.closest?.("#haiku-asistente-enviar") : evento.target === campo && (evento.ctrlKey || evento.metaKey) && evento.key === "Enter";
        if (!accion || !adjuntos.some(a => a.file.type === "application/pdf")) return;
        evento.preventDefault(); evento.stopImmediatePropagation();
        void enviarMensaje();
    }
    window.addEventListener("click", interceptarPDF, true);
    window.addEventListener("keydown", interceptarPDF, true);

    window.addEventListener("haiku:auth-ready", () => {
        mostrarSiCorresponde();
    });

    if (cliente?.auth?.onAuthStateChange) {
        cliente.auth.onAuthStateChange(evento => {
            if (evento === "SIGNED_OUT") {
                root.hidden = true;
                cerrarPanel();
            } else if (evento === "SIGNED_IN") {
                window.setTimeout(mostrarSiCorresponde, 0);
            }
        });
    }

    window.addEventListener("beforeunload", limpiarAdjuntos);

    window.HAIKU_ASISTENTE = {
        abrir: abrirPanel,
        cerrar: cerrarPanel,
        visible: () => !root.hidden,
        procesando: () => procesando || guardandoReserva,
        ultimaPreview: () => ultimaPreview,
        adjuntos: () => adjuntos.map(item => ({
            nombre: item.file.name,
            tipo: item.file.type,
            bytes: item.file.size
        }))
    };

    actualizarEnviar();
    mostrarSiCorresponde();

    console.info("HAIKU · Asistente flotante V11 preparado.");
})();
