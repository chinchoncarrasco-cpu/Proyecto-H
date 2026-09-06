// ========================================
// HAKU · CLOUDBEDS "ACTIVIDAD DE HOY" V1
// Lee el resumen Ventas (Huésped / Ingresos / Check-in / Noches) y prepara
// reservas SIN registrar pagos. En esta vista "Ingresos" viene sin IVA;
// el total de alojamiento se calcula de forma determinística con IVA 19%.
//
// Seguridad / alcance:
// - Sólo se activa cuando una Edge Function dedicada confirma este formato.
// - Nunca interpreta "Ingresos" como abono.
// - Nunca inventa cabaña ni ID Cloudbeds.
// - Requiere confirmación humana antes de escribir.
// - Los lotes de 2 a 11 reservas usan el RPC atómico oficial.
// - Sin polling, intervalos, parches de fetch ni prototipos globales.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_ACTIVIDAD_HOY_V1) return;

    const cliente = window.haikuSupabase;
    const campo = document.getElementById("haiku-asistente-texto");
    const enviar = document.getElementById("haiku-asistente-enviar");
    const inputArchivos = document.getElementById("haiku-asistente-archivos");
    const adjuntosWrap = document.getElementById("haiku-asistente-adjuntos");
    const mensajes = document.getElementById("haiku-asistente-mensajes");

    if (!cliente || !campo || !enviar || !mensajes || !window.HAIKU_ASISTENTE) {
        const principal = document.querySelector('script[data-haiku-asistente-v1]');
        const srcActual = document.currentScript?.src || "";
        if (principal && srcActual && principal.dataset.haikuActividadHoyV1Espera !== "1") {
            principal.dataset.haikuActividadHoyV1Espera = "1";
            principal.addEventListener("load", () => {
                if (window.HAIKU_ASISTENTE_ACTIVIDAD_HOY_V1) return;
                const retry = document.createElement("script");
                retry.src = `${srcActual}${srcActual.includes("?") ? "&" : "?"}afterAssistant=${Date.now()}`;
                retry.async = false;
                document.head.appendChild(retry);
            }, { once: true });
            console.info("HAKU · Actividad de hoy V1 esperará la carga del asistente principal.");
        } else {
            console.info("HAKU · Actividad de hoy V1 no se instaló porque Haku aún no está disponible.");
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

    function sumarDiasIso(iso, dias) {
        if (!fechaValida(iso) || !Number.isInteger(dias)) return null;
        const [y, m, d] = iso.split("-").map(Number);
        const fecha = new Date(Date.UTC(y, m - 1, d));
        fecha.setUTCDate(fecha.getUTCDate() + dias);
        return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}-${String(fecha.getUTCDate()).padStart(2, "0")}`;
    }

    function numeroEnteroPositivo(valor) {
        const n = Number(valor);
        return Number.isInteger(n) && n > 0 ? n : null;
    }

    function ivaDesdeNeto(neto, noches = 1) {
        const n = numeroEnteroPositivo(neto);
        const cantidad = numeroEnteroPositivo(noches);
        if (!n || !cantidad) return null;

        // Cloudbeds redondea el impuesto a nivel de noche/línea. Como este
        // resumen sólo entrega el neto acumulado y la cantidad de noches,
        // reconstruimos esas líneas de forma determinística repartiendo el
        // neto en enteros y sumando el IVA redondeado de cada una.
        const base = Math.floor(n / cantidad);
        const resto = n - (base * cantidad);
        let iva = 0;
        for (let i = 0; i < cantidad; i++) {
            const netoNoche = base + (i < resto ? 1 : 0);
            iva += Math.round(netoNoche * 0.19);
        }
        return iva;
    }

    function totalConIva(neto, noches = 1) {
        const n = numeroEnteroPositivo(neto);
        const iva = ivaDesdeNeto(neto, noches);
        return n && Number.isInteger(iva) ? n + iva : null;
    }

    function tarifasDesdeTotal(total, fechaIngreso, noches) {
        const monto = numeroEnteroPositivo(total);
        const cantidad = numeroEnteroPositivo(noches);
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

    function pagosEntrada(entrada) {
        return Array.isArray(entrada?.pagos)
            ? entrada.pagos.filter(p => p && p.detectado !== false)
            : [];
    }

    function entradasPreview(preview) {
        if (Array.isArray(preview?.reservas) && preview.reservas.length) {
            return preview.reservas.filter(x => x?.reserva && typeof x.reserva === "object");
        }
        if (preview?.reserva && typeof preview.reserva === "object") {
            return [{ reserva: preview.reserva, pagos: Array.isArray(preview.pagos) ? preview.pagos : [] }];
        }
        return [];
    }

    function esCandidato(preview, mensaje) {
        const entradas = entradasPreview(preview);
        if (!entradas.length) return false;

        const sinIds = entradas.every(e => !texto(e?.reserva?.cloudbeds_id));
        if (!sinIds) return false;

        const pistaTexto = /\b(actividad de hoy|ventas|ingresos|sin iva|iva)\b/i.test(texto(mensaje));
        return entradas.length >= 2 || pistaTexto;
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

    async function analizarActividad(mensaje, imagenes) {
        const { data, error } = await cliente.functions.invoke("haiku-asistente-actividad-hoy", {
            body: { mensaje, imagenes }
        });
        if (error) throw error;
        if (!data?.ok || !data?.lectura) throw new Error(data?.error || "No se pudo analizar Actividad de hoy.");
        return data.lectura;
    }

    function normalizarLectura(lectura) {
        const filas = Array.isArray(lectura?.reservas) ? lectura.reservas : [];
        return filas.slice(0, 11).map(fila => {
            const neto = numeroEnteroPositivo(fila?.ingreso_sin_iva);
            const noches = numeroEnteroPositivo(fila?.noches);
            const fechaIngreso = fechaValida(fila?.fecha_llegada) ? texto(fila.fecha_llegada) : null;
            const cabana = numeroEnteroPositivo(fila?.cabana);
            const total = neto && noches ? totalConIva(neto, noches) : null;
            return {
                titular_nombre: texto(fila?.titular_nombre) || null,
                ingreso_sin_iva: neto,
                iva: neto && noches ? ivaDesdeNeto(neto, noches) : null,
                monto_total: total,
                fecha_llegada: fechaIngreso,
                noches,
                fecha_salida: fechaIngreso && noches ? sumarDiasIso(fechaIngreso, noches) : null,
                cabana,
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
        if (confianza === "baja") problemas.push("La lectura del resumen tiene confianza baja.");

        filas.forEach((fila, indice) => {
            const prefijo = filas.length > 1 ? `Reserva ${indice + 1}: ` : "";
            if (!fila.titular_nombre) problemas.push(`${prefijo}falta titular.`);
            if (!fila.ingreso_sin_iva) problemas.push(`${prefijo}falta ingreso sin IVA válido.`);
            if (!fila.monto_total) problemas.push(`${prefijo}no se pudo calcular el total con IVA.`);
            if (!fila.fecha_llegada) problemas.push(`${prefijo}falta check-in válido.`);
            if (!fila.noches) problemas.push(`${prefijo}falta cantidad de noches válida.`);
            if (!fila.fecha_salida) problemas.push(`${prefijo}no se pudo calcular la salida.`);
            if (!fila.cabana || fila.cabana < 1 || fila.cabana > 99) problemas.push(`${prefijo}falta cabaña válida.`);
        });

        for (let i = 0; i < filas.length; i++) {
            for (let j = i + 1; j < filas.length; j++) {
                const a = filas[i];
                const b = filas[j];
                if (!a.cabana || a.cabana !== b.cabana) continue;
                if (!a.fecha_llegada || !a.fecha_salida || !b.fecha_llegada || !b.fecha_salida) continue;
                if (a.fecha_llegada < b.fecha_salida && b.fecha_llegada < a.fecha_salida) {
                    problemas.push(`CAB ${a.cabana} aparece superpuesta dentro del mismo lote.`);
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

    async function refrescar() {
        try { await window.haikuSincronizarReservasSupabase?.(); } catch {}
        try { await window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(); } catch {}
        try { if (typeof window.cargarAbonosPagos === "function") await window.cargarAbonosPagos(); } catch {}
        try { if (typeof window.cargarSaldosCheckin === "function") await window.cargarSaldosCheckin(); } catch {}
        try { if (typeof generarCalendario === "function") generarCalendario(); } catch {}
    }

    function payloadLote(fila) {
        return {
            titular_nombre: fila.titular_nombre,
            cabana_numero: fila.cabana,
            fecha_ingreso: fila.fecha_llegada,
            fecha_salida: fila.fecha_salida,
            adultos: 1,
            ninos: 0,
            mascotas: 0,
            correo_contacto: null,
            telefono_contacto: null,
            observaciones: null,
            tarifas: tarifasDesdeTotal(fila.monto_total, fila.fecha_llegada, fila.noches),
            acompanantes: [],
            cloudbeds_id: null,
            pagos: []
        };
    }

    async function crearUna(fila) {
        const { data: disponibles, error: errorDisponibilidad } = await cliente.rpc("haiku_cabanas_disponibles", {
            p_fecha_ingreso: fila.fecha_llegada,
            p_fecha_salida: fila.fecha_salida,
            p_tipo_estadia: "alojamiento"
        });
        if (errorDisponibilidad) throw errorDisponibilidad;
        if (!(disponibles || []).some(item => Number(item.numero) === Number(fila.cabana))) {
            throw new Error(`CAB ${fila.cabana} ya no está disponible para ese rango.`);
        }

        const { data, error } = await cliente.rpc("haiku_crear_reserva", {
            p_titular_nombre: fila.titular_nombre,
            p_cabana_numero: fila.cabana,
            p_fecha_ingreso: fila.fecha_llegada,
            p_fecha_salida: fila.fecha_salida,
            p_adultos: 1,
            p_ninos: 0,
            p_mascotas: 0,
            p_correo_contacto: null,
            p_telefono_contacto: null,
            p_rut: null,
            p_observaciones: null,
            p_tarifas: tarifasDesdeTotal(fila.monto_total, fila.fecha_llegada, fila.noches),
            p_acompanantes: [],
            p_tipo_estadia: "alojamiento",
            p_cloudbeds_id: null
        });
        if (error) throw error;
        return data;
    }

    async function crearFilas(filas) {
        if (window.haikuTienePermiso?.("reservas.crear") !== true) {
            throw new Error("Tu usuario no tiene permiso para crear reservas.");
        }

        if (filas.length === 1) return crearUna(filas[0]);

        const payload = filas.map(payloadLote);
        const { data, error } = await cliente.rpc("haiku_crear_lote_reservas_asistente", {
            p_reservas: payload
        });
        if (error) throw error;
        return data;
    }

    function renderizarActividad(cardOriginal, lectura) {
        const filas = normalizarLectura(lectura);
        const problemas = problemasFilas(filas, lectura?.confianza);
        const faltanCabanas = filas.filter(f => !f.cabana).map(f => f.titular_nombre || "Reserva sin titular");
        const tienePermiso = window.haikuTienePermiso?.("reservas.crear") === true;
        const puedeCrear = problemas.length === 0 && tienePermiso;

        const card = document.createElement("article");
        card.className = "haiku-asistente-preview";
        card.dataset.hakuActividadHoy = "1";

        const cabecera = document.createElement("div");
        cabecera.className = "haiku-asistente-preview-cabecera";
        const titulo = document.createElement("div");
        const marca = document.createElement("span");
        marca.textContent = filas.length > 1 ? "ACTIVIDAD DE HOY · LOTE · NADA GUARDADO" : "ACTIVIDAD DE HOY · NADA GUARDADO";
        const nombre = document.createElement("strong");
        nombre.textContent = filas.length > 1 ? `${filas.length} reservas detectadas` : (filas[0]?.titular_nombre || "Reserva por revisar");
        titulo.append(marca, nombre);
        const confianza = document.createElement("span");
        confianza.className = `haiku-asistente-confianza haiku-asistente-confianza--${lectura?.confianza || "baja"}`;
        confianza.textContent = `Confianza ${lectura?.confianza || "baja"}`;
        cabecera.append(titulo, confianza);
        card.appendChild(cabecera);

        const resumen = document.createElement("p");
        resumen.className = "haiku-asistente-preview-resumen";
        resumen.textContent = lectura?.resumen || "Resumen de Actividad de hoy leído. Ingresos se tratará como valor neto sin IVA.";
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
            agregarDato(grid, "Ingreso sin IVA", moneda(fila.ingreso_sin_iva));
            agregarDato(grid, "IVA 19%", moneda(fila.iva));
            agregarDato(grid, "Total reserva", moneda(fila.monto_total));
            agregarDato(grid, "Check-in", fechaVisible(fila.fecha_llegada));
            agregarDato(grid, "Noches", fila.noches);
            agregarDato(grid, "Salida", fechaVisible(fila.fecha_salida));
            agregarDato(grid, "Cabaña", fila.cabana ? `CAB ${fila.cabana}` : "—");
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
        notaTexto.textContent = "La columna Ingresos se considera neta sin IVA. Se suma IVA 19% para crear el cargo de alojamiento. No se registrará ningún pago ni abono desde esta pantalla.";
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

        if (faltanCabanas.length) {
            boton.textContent = filas.length > 1 ? "Crear lote · falta cabaña" : "Crear reserva · falta cabaña";
            boton.title = `Indica la cabaña antes de crear: ${faltanCabanas.join(", ")}. Ejemplo: “Guillermo CAB 1”.`;
        } else if (!tienePermiso) {
            boton.textContent = "Sin permiso para crear";
            boton.title = "Tu usuario no tiene permiso para crear reservas.";
        } else if (problemas.length) {
            boton.textContent = filas.length > 1 ? "Crear lote · revisar datos" : "Crear reserva · revisar datos";
            boton.title = problemas.join(" ");
        } else {
            boton.textContent = filas.length > 1 ? `Confirmar ${filas.length} reservas` : "Confirmar y crear";
        }

        boton.addEventListener("click", async () => {
            if (guardando || boton.disabled) return;
            const mensajeConfirmacion = filas.length > 1
                ? `¿Confirmas crear ${filas.length} reservas sin registrar pagos?`
                : `¿Confirmas crear la reserva de ${filas[0].titular_nombre} sin registrar pagos?`;
            if (!window.confirm(mensajeConfirmacion)) return;

            guardando = true;
            boton.disabled = true;
            boton.textContent = filas.length > 1 ? `Creando ${filas.length} reservas…` : "Creando reserva…";
            estado.textContent = "Validando disponibilidad y guardando…";

            try {
                const resultado = await crearFilas(filas);
                await refrescar();
                marca.textContent = filas.length > 1 ? "LOTE CREADO" : "RESERVA CREADA";
                estado.textContent = filas.length > 1
                    ? `✅ ${filas.length} reservas creadas sin pagos.`
                    : `✅ Reserva creada${resultado?.codigo_haiku ? ` · ${resultado.codigo_haiku}` : ""} sin pagos.`;
                boton.textContent = filas.length > 1 ? `${filas.length} reservas creadas` : "Reserva creada";
                card.dataset.haikuLoteCreado = filas.length > 1 ? "1" : "0";
                card.dataset.haikuReservaCreada = filas.length === 1 ? "1" : "0";
            } catch (error) {
                console.error("HAKU · Actividad de hoy no pudo crear:", error);
                estado.textContent = `⚠️ No se guardó la operación: ${error?.message || "error desconocido"}`;
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

    function prepararEnvioActividad() {
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
                const lectura = await analizarActividad(mensaje, imagenes);
                if (miToken !== tokenEnvio || lectura?.aplica !== true) return;
                renderizarActividad(card, lectura);
                console.info("HAKU · Actividad de hoy V1 aplicada al resumen de Ventas.");
            } catch (error) {
                console.warn("HAKU · Actividad de hoy V1 no pudo confirmar el formato; se conserva la vista normal:", error);
            }
        });

        observadorActual.observe(mensajes, { childList: true });
        window.setTimeout(() => {
            if (!observadorActual || miToken !== tokenEnvio) return;
            observadorActual.disconnect();
            observadorActual = null;
        }, 30000);
    }

    enviar.addEventListener("click", prepararEnvioActividad, true);
    campo.addEventListener("keydown", evento => {
        if ((evento.ctrlKey || evento.metaKey) && evento.key === "Enter") prepararEnvioActividad();
    }, true);

    window.HAIKU_ASISTENTE_ACTIVIDAD_HOY_V1 = Object.freeze({
        totalConIva,
        ivaDesdeNeto,
        sumarDiasIso,
        tarifasDesdeTotal,
        problemasFilas
    });

    console.info("HAKU · Actividad de hoy V1 preparada.");
})();