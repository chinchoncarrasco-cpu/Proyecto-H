// ========================================
// HAKU · LISTADO DE RESERVAS CLOUDBEDS V2
// Lee listados configurables de Cloudbeds. El ID Cloudbeds es opcional.
// Check-in/Check-Out, habitación, ocupación y Precio Total son prioritarios.
// Precio Total ya incluye IVA. Depósito/Saldo son informativos: 0 pagos.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_LISTADO_CLOUDBEDS_V2) return;

    const cliente = window.haikuSupabase;
    const campo = document.getElementById("haiku-asistente-texto");
    const enviar = document.getElementById("haiku-asistente-enviar");
    const inputArchivos = document.getElementById("haiku-asistente-archivos");
    const adjuntosWrap = document.getElementById("haiku-asistente-adjuntos");
    const mensajes = document.getElementById("haiku-asistente-mensajes");

    if (!cliente || !campo || !enviar || !mensajes || !window.HAIKU_ASISTENTE) {
        const principal = document.querySelector('script[data-haiku-asistente-v1]');
        const srcActual = document.currentScript?.src || "";
        if (principal && srcActual && principal.dataset.haikuListadoCloudbedsV2Espera !== "1") {
            principal.dataset.haikuListadoCloudbedsV2Espera = "1";
            principal.addEventListener("load", () => {
                if (window.HAIKU_ASISTENTE_LISTADO_CLOUDBEDS_V2) return;
                const retry = document.createElement("script");
                retry.src = `${srcActual}${srcActual.includes("?") ? "&" : "?"}afterAssistant=${Date.now()}`;
                retry.async = false;
                document.head.appendChild(retry);
            }, { once: true });
        }
        return;
    }

    const MAX_IMAGENES = 6;
    let archivosEspejo = [];
    let observadorActual = null;
    let tokenEnvio = 0;
    let guardando = false;

    function texto(valor) { return String(valor ?? "").trim(); }
    function moneda(valor) {
        const n = Number(valor);
        return Number.isFinite(n) ? `$${Math.round(n).toLocaleString("es-CL")}` : "—";
    }
    function fechaValida(valor) { return /^\d{4}-\d{2}-\d{2}$/.test(texto(valor)); }
    function fechaVisible(valor) {
        const s = texto(valor);
        if (!fechaValida(s)) return s || "—";
        const [y, m, d] = s.split("-");
        return `${d}-${m}-${y}`;
    }
    function enteroNoNegativo(valor) {
        const n = Number(valor);
        return Number.isInteger(n) && n >= 0 ? n : null;
    }
    function enteroPositivo(valor) {
        const n = Number(valor);
        return Number.isInteger(n) && n > 0 ? n : null;
    }
    function sumarDiasIso(iso, dias) {
        if (!fechaValida(iso) || !Number.isInteger(dias)) return null;
        const [y, m, d] = iso.split("-").map(Number);
        const f = new Date(Date.UTC(y, m - 1, d));
        f.setUTCDate(f.getUTCDate() + dias);
        return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}-${String(f.getUTCDate()).padStart(2, "0")}`;
    }
    function diasEntre(desde, hasta) {
        if (!fechaValida(desde) || !fechaValida(hasta)) return null;
        const dias = Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);
        return Number.isInteger(dias) && dias > 0 ? dias : null;
    }
    function cabanaDesdeCodigo(codigo) {
        const raw = texto(codigo).replace(/\s+/g, "");
        if (!raw) return null;
        let m = raw.match(/(\d{1,2})\(\d+\)$/);
        if (!m) m = raw.match(/(\d{1,2})$/);
        const n = m ? Number(m[1]) : NaN;
        return Number.isInteger(n) && n >= 1 && n <= 11 ? n : null;
    }
    function tipoDesdeCategoria(categoria) {
        return /\bfull\s*day\b/i.test(texto(categoria)) ? "fullday" : "alojamiento";
    }
    function estadoDesdeCloudbeds(estado) {
        const k = texto(estado).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (k.includes("confirmacion pendiente") || k === "pendiente") return "pendiente";
        if (k === "confirmada" || k === "confirmado" || k === "confirmed") return "confirmada";
        return null;
    }
    function contactoSeguro(valor) {
        const s = texto(valor);
        if (!s || /[*•●xX]{2,}/.test(s)) return null;
        return s;
    }
    function tarifasDesdeTotal(total, fechaIngreso, noches) {
        const monto = enteroPositivo(total);
        const cantidad = enteroPositivo(noches);
        if (!monto || !cantidad || !fechaValida(fechaIngreso)) return {};
        const base = Math.floor(monto / cantidad);
        const resto = monto - base * cantidad;
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

    inputArchivos?.addEventListener("change", () => guardarArchivos(inputArchivos.files || []), true);
    campo.addEventListener("paste", evento => {
        const files = [...(evento.clipboardData?.items || [])]
            .filter(item => item.kind === "file" && /^image\/(png|jpeg|webp)$/i.test(item.type || ""))
            .map(item => item.getAsFile()).filter(Boolean);
        if (files.length) guardarArchivos(files);
    }, true);
    adjuntosWrap?.addEventListener("click", evento => {
        const boton = evento.target?.closest?.(".haiku-asistente-quitar");
        if (!boton) return;
        const items = [...adjuntosWrap.querySelectorAll(".haiku-asistente-adjunto")];
        const indice = items.indexOf(boton.closest(".haiku-asistente-adjunto"));
        if (indice >= 0 && indice < archivosEspejo.length) archivosEspejo.splice(indice, 1);
    }, true);

    function entradasPreview(preview) {
        if (Array.isArray(preview?.reservas) && preview.reservas.length) return preview.reservas;
        if (preview?.reserva) return [{ reserva: preview.reserva }];
        return [];
    }
    function esCandidato(preview, mensaje) {
        const entradas = entradasPreview(preview);
        if (entradas.length >= 2) return true;
        return /\b(cloudbeds|reservas|listado|precio total|habitaci[oó]n|adultos|niños|check.?in|check.?out)\b/i.test(texto(mensaje));
    }

    async function analizarListado(mensaje, imagenes) {
        const { data, error } = await cliente.functions.invoke("haiku-asistente-listado-reservas-cloudbeds-v2", {
            body: { mensaje, imagenes }
        });
        if (error) throw error;
        if (!data?.ok || !data?.lectura) throw new Error(data?.error || "No se pudo analizar el listado Cloudbeds.");
        return data.lectura;
    }

    function normalizarLectura(lectura) {
        return (Array.isArray(lectura?.reservas) ? lectura.reservas : []).slice(0, 11).map(fila => {
            const categoria = texto(fila?.categoria_habitacion) || null;
            const tipo = tipoDesdeCategoria(categoria);
            const tipoAsumido = !categoria && tipo === "alojamiento";
            const checkIn = fechaValida(fila?.check_in) ? texto(fila.check_in) : null;
            const checkOut = fechaValida(fila?.check_out) ? texto(fila.check_out) : null;
            const nochesVisibles = enteroPositivo(fila?.noches);
            const noches = nochesVisibles || (checkIn && checkOut ? diasEntre(checkIn, checkOut) : null);
            const total = enteroPositivo(fila?.precio_total);
            const adultos = enteroNoNegativo(fila?.adultos);
            const ninos = enteroNoNegativo(fila?.ninos);
            const cabana = cabanaDesdeCodigo(fila?.habitacion_codigo);
            const estado = estadoDesdeCloudbeds(fila?.estado);
            const titular = [texto(fila?.nombre), texto(fila?.apellido)].filter(Boolean).join(" ").trim() || null;
            const salidaSistema = tipo === "fullday" ? checkIn : checkOut;
            const tarifas = tipo === "fullday"
                ? (checkIn && total ? { [checkIn]: total } : {})
                : tarifasDesdeTotal(total, checkIn, noches);
            const correo = contactoSeguro(fila?.correo);
            const movil = contactoSeguro(fila?.movil);
            const telefono = contactoSeguro(fila?.telefono);

            return {
                cloudbeds_id: texto(fila?.cloudbeds_id) || null,
                titular_nombre: titular,
                fecha_reserva: fechaValida(fila?.fecha_reserva) ? texto(fila.fecha_reserva) : null,
                habitacion_codigo: texto(fila?.habitacion_codigo) || null,
                cabana,
                categoria_habitacion: categoria,
                tipo_estadia: tipo,
                tipo_asumido: tipoAsumido,
                check_in: checkIn,
                check_out_cloudbeds: checkOut,
                fecha_salida_sistema: salidaSistema,
                noches,
                precio_total: total,
                estado_cloudbeds: texto(fila?.estado) || null,
                estado_reserva: estado,
                fuente: texto(fila?.fuente) || null,
                adultos,
                ninos,
                correo_contacto: correo,
                telefono_contacto: movil || telefono || null,
                pais: texto(fila?.pais) || null,
                deposito: enteroNoNegativo(fila?.deposito),
                saldo_pendiente: enteroNoNegativo(fila?.saldo_pendiente),
                tarifas,
                faltantes: Array.isArray(fila?.faltantes) ? fila.faltantes.map(texto).filter(Boolean).filter(x => !/id cloudbeds/i.test(x)) : [],
                advertencias: Array.isArray(fila?.advertencias) ? fila.advertencias.map(texto).filter(Boolean) : []
            };
        });
    }

    function problemasFilas(filas, confianza) {
        const problemas = [];
        if (!filas.length || filas.length > 11) return ["Debe haber entre 1 y 11 reservas."];
        if (confianza === "baja") problemas.push("La lectura del listado tiene confianza baja.");
        const ids = new Set();

        filas.forEach((f, i) => {
            const p = filas.length > 1 ? `Reserva ${i + 1}: ` : "";
            if (f.cloudbeds_id && ids.has(f.cloudbeds_id)) problemas.push(`${p}ID Cloudbeds repetido.`);
            if (f.cloudbeds_id) ids.add(f.cloudbeds_id);
            if (!f.titular_nombre) problemas.push(`${p}falta titular.`);
            if (!f.cabana) problemas.push(`${p}no pude obtener la cabaña desde Número de Habitación.`);
            if (!f.check_in) problemas.push(`${p}falta Check-in.`);
            if (!f.precio_total) problemas.push(`${p}falta Precio Total.`);
            if (!f.estado_reserva) problemas.push(`${p}estado Cloudbeds no admitido automáticamente.`);

            if (f.tipo_estadia === "alojamiento") {
                if (!f.check_out_cloudbeds) problemas.push(`${p}falta Check-Out.`);
                if (!f.noches) problemas.push(`${p}no pude determinar Noches desde la columna o desde Check-in/Check-Out.`);
                if (f.check_in && f.check_out_cloudbeds && f.noches && diasEntre(f.check_in, f.check_out_cloudbeds) !== f.noches) {
                    problemas.push(`${p}Check-in, Check-Out y Noches no coinciden.`);
                }
                if (f.noches && Object.keys(f.tarifas || {}).length !== f.noches) problemas.push(`${p}no se pudo distribuir el total entre las noches.`);
            } else if (!f.tarifas?.[f.check_in]) {
                problemas.push(`${p}no se pudo preparar la tarifa Full Day.`);
            }
        });
        return [...new Set(problemas)];
    }

    function agregarDato(contenedor, etiqueta, valor) {
        if (valor === null || valor === undefined || valor === "") return;
        const fila = document.createElement("div");
        fila.className = "haiku-asistente-preview-dato";
        const span = document.createElement("span"); span.textContent = etiqueta;
        const strong = document.createElement("strong"); strong.textContent = String(valor);
        fila.append(span, strong); contenedor.appendChild(fila);
    }
    function agregarLista(contenedor, titulo, items, alerta = false) {
        if (!Array.isArray(items) || !items.length) return;
        const bloque = document.createElement("div");
        bloque.className = `haiku-asistente-preview-lista${alerta ? " haiku-asistente-preview-lista--alerta" : ""}`;
        const strong = document.createElement("strong"); strong.textContent = titulo;
        const ul = document.createElement("ul");
        items.forEach(item => { const li = document.createElement("li"); li.textContent = texto(item); ul.appendChild(li); });
        bloque.append(strong, ul); contenedor.appendChild(bloque);
    }

    function payloadRpc(f) {
        return {
            titular_nombre: f.titular_nombre,
            cabana_numero: f.cabana,
            fecha_ingreso: f.check_in,
            fecha_salida: f.fecha_salida_sistema,
            tipo_estadia: f.tipo_estadia,
            tarifas: f.tarifas,
            cloudbeds_id: f.cloudbeds_id,
            estado_reserva: f.estado_reserva,
            adultos: f.adultos ?? 1,
            ninos: f.ninos ?? 0,
            correo_contacto: f.correo_contacto,
            telefono_contacto: f.telefono_contacto
        };
    }

    async function crearListado(filas) {
        if (window.haikuTienePermiso?.("reservas.crear") !== true) throw new Error("Tu usuario no tiene permiso para crear reservas.");
        if (filas.some(f => f.estado_reserva === "confirmada") && window.haikuTienePermiso?.("reservas.editar") !== true) {
            throw new Error("Tu usuario necesita permiso para importar reservas confirmadas.");
        }
        const { data, error } = await cliente.rpc("haiku_crear_lote_listado_cloudbeds_asistente_v2", {
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
        const necesitaEditar = filas.some(f => f.estado_reserva === "confirmada");
        const tieneCrear = window.haikuTienePermiso?.("reservas.crear") === true;
        const tieneEditar = !necesitaEditar || window.haikuTienePermiso?.("reservas.editar") === true;
        const puedeCrear = problemas.length === 0 && tieneCrear && tieneEditar;
        const tiposAsumidos = filas.filter(f => f.tipo_asumido);

        const card = document.createElement("article");
        card.className = "haiku-asistente-preview";
        card.dataset.hakuListadoCloudbedsV2 = "1";

        const cabecera = document.createElement("div"); cabecera.className = "haiku-asistente-preview-cabecera";
        const titulo = document.createElement("div");
        const marca = document.createElement("span"); marca.textContent = filas.length > 1 ? "LISTADO CLOUDBEDS · LOTE · NADA GUARDADO" : "LISTADO CLOUDBEDS · NADA GUARDADO";
        const nombre = document.createElement("strong"); nombre.textContent = filas.length > 1 ? `${filas.length} reservas detectadas` : (filas[0]?.titular_nombre || "Reserva por revisar");
        titulo.append(marca, nombre);
        const confianza = document.createElement("span"); confianza.className = `haiku-asistente-confianza haiku-asistente-confianza--${lectura?.confianza || "baja"}`; confianza.textContent = `Confianza ${lectura?.confianza || "baja"}`;
        cabecera.append(titulo, confianza); card.appendChild(cabecera);

        const resumen = document.createElement("p"); resumen.className = "haiku-asistente-preview-resumen"; resumen.textContent = lectura?.resumen || "Listado Cloudbeds leído. Precio Total incluye IVA; 0 pagos."; card.appendChild(resumen);

        filas.forEach((f, indice) => {
            const bloque = document.createElement("section"); bloque.className = "haiku-asistente-preview-observacion";
            const etiqueta = document.createElement("span"); etiqueta.textContent = filas.length > 1 ? `RESERVA ${indice + 1} DE ${filas.length}` : "RESERVA";
            const titular = document.createElement("p"); titular.textContent = `${f.titular_nombre || "Titular por revisar"}${f.cabana ? ` · CAB ${f.cabana}` : ""}`;
            bloque.append(etiqueta, titular);
            const grid = document.createElement("div"); grid.className = "haiku-asistente-preview-grid";
            agregarDato(grid, "ID Cloudbeds", f.cloudbeds_id || "No visible · opcional");
            agregarDato(grid, "Habitación", f.habitacion_codigo);
            agregarDato(grid, "Check-in", fechaVisible(f.check_in));
            agregarDato(grid, "Check-Out", fechaVisible(f.check_out_cloudbeds));
            agregarDato(grid, "Noches", f.noches);
            agregarDato(grid, "Precio Total · IVA incluido", moneda(f.precio_total));
            agregarDato(grid, "Adultos", f.adultos ?? "1 · predeterminado");
            agregarDato(grid, "Niños", f.ninos ?? "0 · predeterminado");
            agregarDato(grid, "Mascotas", "0 · no visible en este listado");
            agregarDato(grid, "Estado", f.estado_cloudbeds);
            agregarDato(grid, "Tipo", f.tipo_estadia === "fullday" ? "Full Day" : (f.tipo_asumido ? "Alojamiento · categoría no visible" : "Alojamiento"));
            agregarDato(grid, "Fuente", f.fuente);
            agregarDato(grid, "Correo visible", f.correo_contacto);
            agregarDato(grid, "Teléfono visible", f.telefono_contacto);
            agregarDato(grid, "País", f.pais);
            agregarDato(grid, "Depósito · informativo", f.deposito !== null ? moneda(f.deposito) : null);
            agregarDato(grid, "Saldo pendiente · informativo", f.saldo_pendiente !== null ? moneda(f.saldo_pendiente) : null);
            bloque.appendChild(grid);
            agregarLista(bloque, "Lectura incompleta", f.faltantes, false);
            agregarLista(bloque, "Revisar", f.advertencias, true);
            card.appendChild(bloque);
        });

        const regla = document.createElement("div"); regla.className = "haiku-asistente-preview-observacion";
        const rl = document.createElement("span"); rl.textContent = "REGLAS DE IMPORTACIÓN";
        const rp = document.createElement("p"); rp.textContent = "El ID Cloudbeds es opcional. Precio Total ya incluye IVA. Depósito y Saldo Pendiente son sólo informativos y no crean pagos. Los contactos enmascarados no se guardan.";
        regla.append(rl, rp); card.appendChild(regla);

        if (tiposAsumidos.length) {
            const aviso = document.createElement("div"); aviso.className = "haiku-asistente-preview-lista haiku-asistente-preview-lista--alerta";
            const strong = document.createElement("strong"); strong.textContent = "Categoría no visible";
            const p = document.createElement("p"); p.textContent = "Estas filas se prepararon como Alojamiento porque esta vista no muestra la categoría. Si alguna es Full Day, indícalo en el mensaje a Haku (por ejemplo: “Javiera Full Day”) o adjunta una vista que muestre Categoría de Habitación.";
            aviso.append(strong, p); card.appendChild(aviso);
        }
        if (problemas.length) agregarLista(card, "Antes de crear", problemas, true);

        const pie = document.createElement("div"); pie.className = "haiku-asistente-preview-pie";
        const estado = document.createElement("span"); estado.textContent = "🔒 Nada guardado todavía.";
        const boton = document.createElement("button"); boton.type = "button"; boton.disabled = !puedeCrear;
        if (!tieneCrear) boton.textContent = "Sin permiso para crear";
        else if (!tieneEditar) boton.textContent = "Falta permiso para confirmar";
        else if (problemas.length) boton.textContent = filas.length > 1 ? "Crear lote · revisar datos" : "Crear reserva · revisar datos";
        else boton.textContent = filas.length > 1 ? `Confirmar ${filas.length} reservas` : "Confirmar y crear";

        boton.addEventListener("click", async () => {
            if (guardando || boton.disabled) return;
            const ocupacion = filas.map(f => `${f.titular_nombre}: ${f.adultos ?? 1} ADL · ${f.ninos ?? 0} NIÑ${f.tipo_estadia === "fullday" ? " · FULL DAY" : ""}`).join("\n");
            const notaTipo = tiposAsumidos.length ? `\n\n⚠️ ${tiposAsumidos.length} reserva(s) quedaron como Alojamiento porque la categoría no está visible.` : "";
            if (!window.confirm(`¿Confirmas importar ${filas.length} reserva${filas.length === 1 ? "" : "s"} con 0 pagos?\n\n${ocupacion}${notaTipo}`)) return;
            guardando = true; boton.disabled = true; boton.textContent = "Creando reservas…"; estado.textContent = "Validando disponibilidad y guardando el lote…";
            try {
                const resultado = await crearListado(filas);
                await refrescar();
                marca.textContent = filas.length > 1 ? "LOTE CLOUDBEDS CREADO" : "RESERVA CLOUDBEDS CREADA";
                estado.textContent = `✅ ${filas.length} reserva${filas.length === 1 ? "" : "s"} creada${filas.length === 1 ? "" : "s"} · 0 pagos.`;
                boton.textContent = "Importación completada"; boton.disabled = true;
                console.info("HAKU · Listado Cloudbeds V2 creado:", resultado);
            } catch (error) {
                console.error("HAKU · Listado Cloudbeds V2 no pudo crearse:", error);
                estado.textContent = `⚠️ No se guardó el lote: ${error?.message || "error desconocido"}`;
                boton.textContent = filas.length > 1 ? `Confirmar ${filas.length} reservas` : "Confirmar y crear"; boton.disabled = false;
            } finally { guardando = false; requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; }); }
        });

        pie.append(estado, boton); card.appendChild(pie); cardOriginal.replaceWith(card);
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
        if (guardando || !archivosEspejo.length) return;
        const mensaje = texto(campo.value);
        const archivos = archivosEspejo.slice(0, MAX_IMAGENES);
        archivosEspejo = [];
        const miToken = ++tokenEnvio;
        const imagenesPromesa = Promise.all(archivos.map(archivoADataUrl));

        observadorActual?.disconnect();
        observadorActual = new MutationObserver(async mutations => {
            const card = encontrarPreviewAgregada(mutations);
            if (!card) return;
            observadorActual?.disconnect(); observadorActual = null;
            if (miToken !== tokenEnvio) return;
            const preview = window.HAIKU_ASISTENTE?.ultimaPreview?.();
            if (!esCandidato(preview, mensaje)) return;
            try {
                const imagenes = await imagenesPromesa;
                const lectura = await analizarListado(mensaje, imagenes);
                if (miToken !== tokenEnvio || lectura?.aplica !== true) return;
                renderizarListado(card, lectura);
                console.info("HAKU · Listado Cloudbeds V2 aplicado.");
            } catch (error) {
                console.warn("HAKU · Listado Cloudbeds V2 no confirmó el formato; se conserva la vista normal:", error);
            }
        });
        observadorActual.observe(mensajes, { childList: true });
        window.setTimeout(() => {
            if (!observadorActual || miToken !== tokenEnvio) return;
            observadorActual.disconnect(); observadorActual = null;
        }, 30000);
    }

    enviar.addEventListener("click", prepararEnvioListado, true);
    campo.addEventListener("keydown", evento => {
        if ((evento.ctrlKey || evento.metaKey) && evento.key === "Enter") prepararEnvioListado();
    }, true);

    window.HAIKU_ASISTENTE_LISTADO_CLOUDBEDS_V2 = Object.freeze({
        cabanaDesdeCodigo, tipoDesdeCategoria, estadoDesdeCloudbeds, tarifasDesdeTotal, problemasFilas
    });
    console.info("HAKU · Listado Cloudbeds V2 preparado · ID opcional.");
})();