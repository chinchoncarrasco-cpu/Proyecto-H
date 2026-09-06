// ========================================
// HAKU · LISTADO DE RESERVAS CLOUDBEDS V1
// Reconoce la tabla Reserva / Nombre / Apellido / Habitación / Check-in /
// Check-Out / Noches / Precio Total / Estado / Fuente.
//
// Reglas cerradas:
// - Precio Total YA incluye IVA y se usa como cargo total de alojamiento.
// - Precio Total NUNCA se convierte en pago o abono.
// - El ID de la columna Reserva se conserva como cloudbeds_id.
// - La cabaña se obtiene de forma determinística desde Núm. Habitación
//   (ej. CD5(1)->5, LC6(1)->6, C10(1)->10).
// - "Full Day" se toma sólo desde la categoría explícita.
// - Confirmada -> confirmada; Confirmación pendiente -> pendiente.
// - Vista previa + confirmación humana; escritura atómica por RPC dedicado.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_LISTADO_CLOUDBEDS_V1) return;

    const cliente = window.haikuSupabase;
    const campo = document.getElementById("haiku-asistente-texto");
    const enviar = document.getElementById("haiku-asistente-enviar");
    const inputArchivos = document.getElementById("haiku-asistente-archivos");
    const adjuntosWrap = document.getElementById("haiku-asistente-adjuntos");
    const mensajes = document.getElementById("haiku-asistente-mensajes");

    if (!cliente || !campo || !enviar || !mensajes || !window.HAIKU_ASISTENTE) {
        const principal = document.querySelector('script[data-haiku-asistente-v1]');
        const srcActual = document.currentScript?.src || "";
        if (principal && srcActual && principal.dataset.haikuListadoCloudbedsV1Espera !== "1") {
            principal.dataset.haikuListadoCloudbedsV1Espera = "1";
            principal.addEventListener("load", () => {
                if (window.HAIKU_ASISTENTE_LISTADO_CLOUDBEDS_V1) return;
                const retry = document.createElement("script");
                retry.src = `${srcActual}${srcActual.includes("?") ? "&" : "?"}afterAssistant=${Date.now()}`;
                retry.async = false;
                document.head.appendChild(retry);
            }, { once: true });
            console.info("HAKU · Listado Cloudbeds V1 esperará la carga del asistente principal.");
        } else {
            console.info("HAKU · Listado Cloudbeds V1 no se instaló porque Haku aún no está disponible.");
        }
        return;
    }

    const MAX_IMAGENES = 6;
    let archivosEspejo = [];
    let observadorActual = null;
    let tokenEnvio = 0;
    let guardando = false;

    function texto(valor) {
        return String(valor ?? "").trim();
    }

    function clave(valor) {
        return texto(valor)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function moneda(valor) {
        const n = Number(valor);
        return Number.isFinite(n) ? `$${Math.round(n).toLocaleString("es-CL")}` : "—";
    }

    function fechaVisible(valor) {
        const s = texto(valor);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "—";
        const [y, m, d] = s.split("-");
        return `${d}-${m}-${y}`;
    }

    function fechaValida(valor) {
        return /^\d{4}-\d{2}-\d{2}$/.test(texto(valor));
    }

    function enteroPositivo(valor) {
        const n = Number(valor);
        return Number.isInteger(n) && n > 0 ? n : null;
    }

    function diasEntre(desde, hasta) {
        if (!fechaValida(desde) || !fechaValida(hasta)) return null;
        const inicio = Date.parse(`${desde}T00:00:00Z`);
        const fin = Date.parse(`${hasta}T00:00:00Z`);
        const dias = Math.round((fin - inicio) / 86400000);
        return Number.isInteger(dias) ? dias : null;
    }

    function sumarDiasIso(iso, dias) {
        if (!fechaValida(iso) || !Number.isInteger(dias)) return null;
        const [y, m, d] = iso.split("-").map(Number);
        const fecha = new Date(Date.UTC(y, m - 1, d));
        fecha.setUTCDate(fecha.getUTCDate() + dias);
        return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}-${String(fecha.getUTCDate()).padStart(2, "0")}`;
    }

    function cabanaDesdeCodigo(codigo) {
        const raw = texto(codigo).replace(/\s+/g, "");
        if (!raw) return null;

        let match = raw.match(/(\d{1,2})\(\d+\)$/);
        if (!match) match = raw.match(/(\d{1,2})$/);
        if (!match) return null;

        const numero = Number(match[1]);
        return Number.isInteger(numero) && numero >= 1 && numero <= 11 ? numero : null;
    }

    function tipoDesdeCategoria(categoria) {
        return /\bfull\s*day\b/i.test(texto(categoria)) ? "fullday" : "alojamiento";
    }

    function estadoDesdeCloudbeds(estado) {
        const k = clave(estado);
        if (!k) return null;
        if (k.includes("confirmacion pendiente") || k === "pendiente") return "pendiente";
        if (k === "confirmada" || k === "confirmado" || k === "confirmed") return "confirmada";
        return null;
    }

    function tarifasDesdeTotal(total, fechaIngreso, noches) {
        const monto = enteroPositivo(total);
        const cantidad = enteroPositivo(noches);
        if (!monto || !cantidad || !fechaValida(fechaIngreso)) return {};

        const base = Math.floor(monto / cantidad);
        const resto = monto - (base * cantidad);
        const tarifas = {};

        for (let i = 0; i < cantidad; i++) {
            const fecha = sumarDiasIso(fechaIngreso, i);
            if (!fecha) return {};
            tarifas[fecha] = base + (i < resto ? 1 : 0);
        }
        return tarifas;
    }

    function archivoADataUrl(file) {
        return new Promise((resolve, reject) => {
            const lector = new FileReader();
            lector.onload = () => resolve(String(lector.result || ""));
            lector.onerror = () => reject(new Error("No pude leer una de las capturas."));
            lector.readAsDataURL(file);
        });
    }

    function guardarArchivos(files) {
        archivosEspejo = [...(files || [])]
            .filter(file => /^image\/(png|jpeg|webp)$/i.test(file?.type || ""))
            .slice(0, MAX_IMAGENES);
    }

    inputArchivos?.addEventListener("change", () => {
        guardarArchivos(inputArchivos.files || []);
    }, true);

    campo.addEventListener("paste", evento => {
        const archivos = [...(evento.clipboardData?.items || [])]
            .filter(item => item.kind === "file" && /^image\/(png|jpeg|webp)$/i.test(item.type || ""))
            .map(item => item.getAsFile())
            .filter(Boolean);
        if (archivos.length) guardarArchivos(archivos);
    }, true);

    adjuntosWrap?.addEventListener("click", evento => {
        const boton = evento.target?.closest?.(".haiku-asistente-quitar");
        if (!boton) return;
        const items = [...adjuntosWrap.querySelectorAll(".haiku-asistente-adjunto")];
        const item = boton.closest(".haiku-asistente-adjunto");
        const indice = items.indexOf(item);
        if (indice >= 0 && indice < archivosEspejo.length) archivosEspejo.splice(indice, 1);
    }, true);

    function entradasPreview(preview) {
        if (Array.isArray(preview?.reservas) && preview.reservas.length) return preview.reservas;
        if (preview?.reserva) return [{ reserva: preview.reserva }];
        return [];
    }

    function esCandidato(preview, mensaje) {
        const entradas = entradasPreview(preview);
        const textoMensaje = clave(mensaje);
        if (/\b(cloudbeds|listado|lista de reservas|precio total|num habitacion|numero habitacion)\b/.test(textoMensaje)) {
            return true;
        }
        if (!entradas.length) return false;
        return entradas.some(entrada => texto(entrada?.reserva?.cloudbeds_id));
    }

    async function analizarListado(mensaje, imagenes) {
        const { data, error } = await cliente.functions.invoke("haiku-asistente-listado-reservas-cloudbeds", {
            body: { mensaje, imagenes }
        });
        if (error) throw error;
        if (!data?.ok || !data?.lectura) throw new Error(data?.error || "No se pudo analizar el listado de Cloudbeds.");
        return data.lectura;
    }

    function normalizarLectura(lectura) {
        const filas = Array.isArray(lectura?.reservas) ? lectura.reservas : [];

        return filas.slice(0, 11).map(fila => {
            const tipo = tipoDesdeCategoria(fila?.categoria_habitacion);
            const checkIn = fechaValida(fila?.check_in) ? texto(fila.check_in) : null;
            const checkOutCloudbeds = fechaValida(fila?.check_out) ? texto(fila.check_out) : null;
            const noches = enteroPositivo(fila?.noches);
            const total = enteroPositivo(fila?.precio_total);
            const cabana = cabanaDesdeCodigo(fila?.habitacion_codigo);
            const estadoSistema = estadoDesdeCloudbeds(fila?.estado);
            const titular = [texto(fila?.nombre), texto(fila?.apellido)].filter(Boolean).join(" ").trim() || null;
            const fechaSalidaSistema = tipo === "fullday" ? checkIn : checkOutCloudbeds;
            const tarifas = tipo === "fullday"
                ? (checkIn && total ? { [checkIn]: total } : {})
                : tarifasDesdeTotal(total, checkIn, noches);

            return {
                cloudbeds_id: texto(fila?.cloudbeds_id) || null,
                titular_nombre: titular,
                fecha_reserva: fechaValida(fila?.fecha_reserva) ? texto(fila.fecha_reserva) : null,
                habitacion_codigo: texto(fila?.habitacion_codigo) || null,
                cabana,
                categoria_habitacion: texto(fila?.categoria_habitacion) || null,
                tipo_estadia: tipo,
                check_in: checkIn,
                check_out_cloudbeds: checkOutCloudbeds,
                fecha_salida_sistema: fechaSalidaSistema,
                noches,
                precio_total: total,
                estado_cloudbeds: texto(fila?.estado) || null,
                estado_reserva: estadoSistema,
                fuente: texto(fila?.fuente) || null,
                tarifas,
                faltantes: Array.isArray(fila?.faltantes) ? fila.faltantes.map(texto).filter(Boolean) : [],
                advertencias: Array.isArray(fila?.advertencias) ? fila.advertencias.map(texto).filter(Boolean) : []
            };
        });
    }

    function problemasFilas(filas, confianza) {
        const problemas = [];

        if (!Array.isArray(filas) || filas.length < 1 || filas.length > 11) {
            problemas.push("Debe haber entre 1 y 11 reservas.");
            return problemas;
        }
        if (confianza === "baja") problemas.push("La lectura del listado tiene confianza baja.");

        const ids = new Set();

        filas.forEach((fila, indice) => {
            const prefijo = filas.length > 1 ? `Reserva ${indice + 1}: ` : "";

            if (!fila.cloudbeds_id) problemas.push(`${prefijo}falta ID Cloudbeds.`);
            if (fila.cloudbeds_id && ids.has(fila.cloudbeds_id)) problemas.push(`${prefijo}ID Cloudbeds repetido en la captura.`);
            if (fila.cloudbeds_id) ids.add(fila.cloudbeds_id);

            if (!fila.titular_nombre) problemas.push(`${prefijo}falta titular.`);
            if (!fila.habitacion_codigo) problemas.push(`${prefijo}falta Núm. Habitación.`);
            if (!fila.cabana) problemas.push(`${prefijo}no pude convertir Núm. Habitación en una CAB 1–11.`);
            if (!fila.check_in) problemas.push(`${prefijo}falta Check-in válido.`);
            if (!fila.precio_total) problemas.push(`${prefijo}falta Precio Total válido.`);
            if (!fila.estado_reserva) problemas.push(`${prefijo}estado Cloudbeds no admitido automáticamente.`);

            if (fila.tipo_estadia === "alojamiento") {
                if (!fila.check_out_cloudbeds) problemas.push(`${prefijo}falta Check-Out válido.`);
                if (!fila.noches) problemas.push(`${prefijo}falta cantidad de noches válida.`);
                if (fila.check_in && fila.check_out_cloudbeds && fila.noches) {
                    const dias = diasEntre(fila.check_in, fila.check_out_cloudbeds);
                    if (dias !== fila.noches) {
                        problemas.push(`${prefijo}Check-in, Check-Out y Noches no coinciden.`);
                    }
                }
                if (fila.noches && Object.keys(fila.tarifas || {}).length !== fila.noches) {
                    problemas.push(`${prefijo}no se pudo distribuir el Precio Total entre las noches.`);
                }
            } else if (fila.tipo_estadia === "fullday") {
                if (!fila.check_in || !fila.tarifas?.[fila.check_in]) {
                    problemas.push(`${prefijo}no se pudo preparar la tarifa Full Day.`);
                }
            }
        });

        for (let i = 0; i < filas.length; i++) {
            for (let j = i + 1; j < filas.length; j++) {
                const a = filas[i];
                const b = filas[j];
                if (!a.cabana || a.cabana !== b.cabana) continue;

                const aInicio = a.check_in;
                const aFinExclusivo = a.tipo_estadia === "fullday"
                    ? sumarDiasIso(a.check_in, 1)
                    : a.check_out_cloudbeds;
                const bInicio = b.check_in;
                const bFinExclusivo = b.tipo_estadia === "fullday"
                    ? sumarDiasIso(b.check_in, 1)
                    : b.check_out_cloudbeds;

                if (!aInicio || !aFinExclusivo || !bInicio || !bFinExclusivo) continue;
                if (aInicio < bFinExclusivo && bInicio < aFinExclusivo) {
                    problemas.push(`CAB ${a.cabana} aparece superpuesta dentro del mismo listado.`);
                }
            }
        }

        return [...new Set(problemas)];
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

    function agregarLista(contenedor, titulo, items, alerta = false) {
        if (!Array.isArray(items) || !items.length) return;
        const bloque = document.createElement("div");
        bloque.className = `haiku-asistente-preview-lista${alerta ? " haiku-asistente-preview-lista--alerta" : ""}`;
        const strong = document.createElement("strong");
        strong.textContent = titulo;
        const ul = document.createElement("ul");
        items.forEach(item => {
            const li = document.createElement("li");
            li.textContent = texto(item);
            ul.appendChild(li);
        });
        bloque.append(strong, ul);
        contenedor.appendChild(bloque);
    }

    function payloadRpc(fila) {
        return {
            titular_nombre: fila.titular_nombre,
            cabana_numero: fila.cabana,
            fecha_ingreso: fila.check_in,
            fecha_salida: fila.fecha_salida_sistema,
            tipo_estadia: fila.tipo_estadia,
            tarifas: fila.tarifas,
            cloudbeds_id: fila.cloudbeds_id,
            estado_reserva: fila.estado_reserva
        };
    }

    async function crearListado(filas) {
        if (window.haikuTienePermiso?.("reservas.crear") !== true) {
            throw new Error("Tu usuario no tiene permiso para crear reservas.");
        }

        if (filas.some(fila => fila.estado_reserva === "confirmada") &&
            window.haikuTienePermiso?.("reservas.editar") !== true) {
            throw new Error("Tu usuario necesita permiso para importar reservas confirmadas.");
        }

        const { data, error } = await cliente.rpc("haiku_crear_lote_listado_cloudbeds_asistente", {
            p_reservas: filas.map(payloadRpc)
        });
        if (error) throw error;
        return data;
    }

    async function refrescar() {
        try { await window.haikuSincronizarReservasSupabase?.(); } catch {}
        try { await window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(); } catch {}
        try { if (typeof window.cargarAbonosPagos === "function") await window.cargarAbonosPagos(); } catch {}
        try { if (typeof window.cargarSaldosCheckin === "function") await window.cargarSaldosCheckin(); } catch {}
        try { if (typeof generarCalendario === "function") generarCalendario(); } catch {}
    }

    function renderizarListado(cardOriginal, lectura) {
        const filas = normalizarLectura(lectura);
        const problemas = problemasFilas(filas, lectura?.confianza);
        const necesitaEditar = filas.some(fila => fila.estado_reserva === "confirmada");
        const tieneCrear = window.haikuTienePermiso?.("reservas.crear") === true;
        const tieneEditar = !necesitaEditar || window.haikuTienePermiso?.("reservas.editar") === true;
        const puedeCrear = problemas.length === 0 && tieneCrear && tieneEditar;

        const card = document.createElement("article");
        card.className = "haiku-asistente-preview";
        card.dataset.hakuListadoCloudbeds = "1";

        const cabecera = document.createElement("div");
        cabecera.className = "haiku-asistente-preview-cabecera";
        const titulo = document.createElement("div");
        const marca = document.createElement("span");
        marca.textContent = filas.length > 1
            ? "LISTADO CLOUDBEDS · LOTE · NADA GUARDADO"
            : "LISTADO CLOUDBEDS · NADA GUARDADO";
        const nombre = document.createElement("strong");
        nombre.textContent = filas.length > 1
            ? `${filas.length} reservas detectadas`
            : (filas[0]?.titular_nombre || "Reserva por revisar");
        titulo.append(marca, nombre);

        const confianza = document.createElement("span");
        confianza.className = `haiku-asistente-confianza haiku-asistente-confianza--${lectura?.confianza || "baja"}`;
        confianza.textContent = `Confianza ${lectura?.confianza || "baja"}`;
        cabecera.append(titulo, confianza);
        card.appendChild(cabecera);

        const resumen = document.createElement("p");
        resumen.className = "haiku-asistente-preview-resumen";
        resumen.textContent = lectura?.resumen || "Listado de reservas Cloudbeds leído. Precio Total ya incluye IVA y no se registrará como pago.";
        card.appendChild(resumen);

        filas.forEach((fila, indice) => {
            const bloque = document.createElement("section");
            bloque.className = "haiku-asistente-preview-observacion";

            const etiqueta = document.createElement("span");
            etiqueta.textContent = filas.length > 1 ? `RESERVA ${indice + 1} DE ${filas.length}` : "RESERVA";
            const titular = document.createElement("p");
            titular.textContent = `${fila.titular_nombre || "Titular por revisar"}${fila.cabana ? ` · CAB ${fila.cabana}` : ""}`;
            bloque.append(etiqueta, titular);

            const grid = document.createElement("div");
            grid.className = "haiku-asistente-preview-grid";
            agregarDato(grid, "ID Cloudbeds", fila.cloudbeds_id);
            agregarDato(grid, "Núm. Habitación", fila.habitacion_codigo);
            agregarDato(grid, "Categoría", fila.categoria_habitacion);
            agregarDato(grid, "Tipo", fila.tipo_estadia === "fullday" ? "Full Day" : "Alojamiento");
            agregarDato(grid, "Check-in", fechaVisible(fila.check_in));
            agregarDato(grid, "Check-Out Cloudbeds", fechaVisible(fila.check_out_cloudbeds));
            agregarDato(grid, "Noches", fila.noches);
            agregarDato(grid, "Precio Total · IVA incluido", moneda(fila.precio_total));
            agregarDato(grid, "Estado Cloudbeds", fila.estado_cloudbeds);
            agregarDato(grid, "Estado en Proyecto H", fila.estado_reserva === "confirmada" ? "Confirmada" : fila.estado_reserva === "pendiente" ? "Pendiente" : "—");
            agregarDato(grid, "Fuente", fila.fuente);
            agregarDato(grid, "Fecha de reserva", fechaVisible(fila.fecha_reserva));
            bloque.appendChild(grid);

            agregarLista(bloque, "Datos faltantes", fila.faltantes, false);
            agregarLista(bloque, "Revisar", fila.advertencias, true);
            card.appendChild(bloque);
        });

        const nota = document.createElement("div");
        nota.className = "haiku-asistente-preview-observacion";
        const notaLabel = document.createElement("span");
        notaLabel.textContent = "REGLA FINANCIERA";
        const notaTexto = document.createElement("p");
        notaTexto.textContent = "Precio Total se copia como valor final con IVA incluido. No se crea ningún pago ni abono. En alojamientos de varias noches, el total se reparte entre las noches conservando exactamente el total mostrado por Cloudbeds.";
        nota.append(notaLabel, notaTexto);
        card.appendChild(nota);

        if (problemas.length) agregarLista(card, "Antes de crear", problemas, true);

        const pie = document.createElement("div");
        pie.className = "haiku-asistente-preview-pie";
        const estado = document.createElement("span");
        estado.textContent = "🔒 Nada guardado todavía.";
        const boton = document.createElement("button");
        boton.type = "button";
        boton.disabled = !puedeCrear;

        if (!tieneCrear) {
            boton.textContent = "Sin permiso para crear";
            boton.title = "Tu usuario no tiene permiso para crear reservas.";
        } else if (!tieneEditar) {
            boton.textContent = "Falta permiso para confirmar";
            boton.title = "El listado contiene reservas Confirmadas y tu usuario no tiene permiso para cambiar estados.";
        } else if (problemas.length) {
            boton.textContent = filas.length > 1 ? "Crear lote · revisar datos" : "Crear reserva · revisar datos";
            boton.title = problemas.join(" ");
        } else {
            boton.textContent = filas.length > 1 ? `Confirmar ${filas.length} reservas` : "Confirmar y crear";
        }

        boton.addEventListener("click", async () => {
            if (guardando || boton.disabled) return;

            const confirmadas = filas.filter(f => f.estado_reserva === "confirmada").length;
            const pendientes = filas.filter(f => f.estado_reserva === "pendiente").length;
            const fullDays = filas.filter(f => f.tipo_estadia === "fullday").length;
            const detalle = [
                `${filas.length} ${filas.length === 1 ? "reserva" : "reservas"}`,
                `${confirmadas} confirmada${confirmadas === 1 ? "" : "s"}`,
                `${pendientes} pendiente${pendientes === 1 ? "" : "s"}`,
                fullDays ? `${fullDays} Full Day` : null,
                "0 pagos"
            ].filter(Boolean).join(" · ");

            if (!window.confirm(`¿Confirmas importar ${detalle}?`)) return;

            guardando = true;
            boton.disabled = true;
            boton.textContent = filas.length > 1 ? `Creando ${filas.length} reservas…` : "Creando reserva…";
            estado.textContent = "Validando IDs, disponibilidad y guardando el lote…";

            try {
                const resultado = await crearListado(filas);
                await refrescar();
                marca.textContent = filas.length > 1 ? "LOTE CLOUDBEDS CREADO" : "RESERVA CLOUDBEDS CREADA";
                estado.textContent = filas.length > 1
                    ? `✅ ${filas.length} reservas creadas · 0 pagos registrados.`
                    : "✅ Reserva creada · 0 pagos registrados.";
                boton.textContent = filas.length > 1 ? `${filas.length} reservas creadas` : "Reserva creada";
                boton.disabled = true;
                card.dataset.haikuLoteCreado = filas.length > 1 ? "1" : "0";
                card.dataset.haikuReservaCreada = filas.length === 1 ? "1" : "0";
                console.info("HAKU · Listado Cloudbeds creado:", resultado);
            } catch (error) {
                console.error("HAKU · Listado Cloudbeds no pudo crearse:", error);
                estado.textContent = `⚠️ No se guardó el lote: ${error?.message || "error desconocido"}`;
                boton.textContent = filas.length > 1 ? `Confirmar ${filas.length} reservas` : "Confirmar y crear";
                boton.disabled = false;
            } finally {
                guardando = false;
                requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
            }
        });

        pie.append(estado, boton);
        card.appendChild(pie);
        cardOriginal.replaceWith(card);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
    }

    function encontrarPreviewAgregada(mutations) {
        for (const mutation of mutations) {
            for (const nodo of mutation.addedNodes || []) {
                if (!(nodo instanceof Element)) continue;
                if (nodo.matches?.(".haiku-asistente-preview")) return nodo;
                const card = nodo.querySelector?.(".haiku-asistente-preview");
                if (card) return card;
            }
        }
        return null;
    }

    function prepararEnvioListado() {
        if (guardando || archivosEspejo.length === 0) return;

        const mensaje = texto(campo.value);
        const archivos = archivosEspejo.slice(0, MAX_IMAGENES);
        archivosEspejo = [];
        const miToken = ++tokenEnvio;
        const imagenesPromesa = Promise.all(archivos.map(archivoADataUrl));

        if (observadorActual) {
            observadorActual.disconnect();
            observadorActual = null;
        }

        observadorActual = new MutationObserver(async mutations => {
            const card = encontrarPreviewAgregada(mutations);
            if (!card) return;

            observadorActual?.disconnect();
            observadorActual = null;
            if (miToken !== tokenEnvio) return;

            const preview = window.HAIKU_ASISTENTE?.ultimaPreview?.();
            if (!esCandidato(preview, mensaje)) return;

            try {
                const imagenes = await imagenesPromesa;
                const lectura = await analizarListado(mensaje, imagenes);
                if (miToken !== tokenEnvio || lectura?.aplica !== true) return;
                renderizarListado(card, lectura);
                console.info("HAKU · Listado de reservas Cloudbeds V1 aplicado.");
            } catch (error) {
                console.warn("HAKU · Listado Cloudbeds V1 no pudo confirmar el formato; se conserva la vista normal:", error);
            }
        });

        observadorActual.observe(mensajes, { childList: true });
        window.setTimeout(() => {
            if (!observadorActual || miToken !== tokenEnvio) return;
            observadorActual.disconnect();
            observadorActual = null;
        }, 30000);
    }

    enviar.addEventListener("click", prepararEnvioListado, true);
    campo.addEventListener("keydown", evento => {
        if ((evento.ctrlKey || evento.metaKey) && evento.key === "Enter") prepararEnvioListado();
    }, true);

    window.HAIKU_ASISTENTE_LISTADO_CLOUDBEDS_V1 = Object.freeze({
        cabanaDesdeCodigo,
        tipoDesdeCategoria,
        estadoDesdeCloudbeds,
        tarifasDesdeTotal,
        problemasFilas
    });

    console.info("HAKU · Listado de reservas Cloudbeds V1 preparado.");
})();