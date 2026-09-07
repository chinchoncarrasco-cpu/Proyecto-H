// ========================================
// HAKU · PAGOS NOCTURNOS EN LOTE V1
// Flujo específico para: "Agrega estos pagos/abonos".
// Usa la imagen/listado de Reservas sólo para identificar destinos existentes
// y el texto/capturas para extraer los pagos. NO crea reservas.
// Una sola confirmación registra el lote de forma atómica en Supabase.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_PAGOS_NOCTURNOS_V1) return;

    const cliente = window.haikuSupabase;
    const root = document.querySelector(".haiku-asistente-root");
    const campo = document.getElementById("haiku-asistente-texto");
    const enviar = document.getElementById("haiku-asistente-enviar");
    const adjuntar = document.getElementById("haiku-asistente-adjuntar");
    const adjuntosWrap = document.getElementById("haiku-asistente-adjuntos");
    const mensajes = document.getElementById("haiku-asistente-mensajes");

    if (!cliente || !root || !campo || !enviar || !mensajes) {
        const principal = document.querySelector('script[data-haiku-asistente-v1]');
        const srcActual = document.currentScript?.src || "";
        if (principal && srcActual && principal.dataset.haikuPagosNocturnosV1Espera !== "1") {
            principal.dataset.haikuPagosNocturnosV1Espera = "1";
            principal.addEventListener("load", () => {
                if (window.HAIKU_ASISTENTE_PAGOS_NOCTURNOS_V1) return;
                const retry = document.createElement("script");
                retry.src = `${srcActual}${srcActual.includes("?") ? "&" : "?"}afterAssistant=${Date.now()}`;
                retry.async = false;
                document.head.appendChild(retry);
            }, { once: true });
        }
        return;
    }

    const MAX_IMAGENES = 6;
    let ocupado = false;

    function normalizar(valor) {
        return String(valor ?? "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function esComandoLotePagos(valor) {
        const t = normalizar(valor);
        if (!t) return false;

        const accion = /\b(agrega|agregar|registre|registra|registrar|asocia|asociar|carga|cargar|ingresa|ingresar)\b/;
        const plural = /\b(pagos|abonos)\b/;
        const nuevaReserva = /\b(crea|crear|agrega|ingresa)\b.{0,35}\b(nueva )?reservas?\b/;

        return accion.test(t) && plural.test(t) && !nuevaReserva.test(t);
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

    function fechaIsoValida(valor) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""));
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

    function agregarLista(contenedor, titulo, elementos, alerta = false) {
        if (!Array.isArray(elementos) || !elementos.length) return;
        const bloque = document.createElement("div");
        bloque.className = `haiku-asistente-preview-lista${alerta ? " haiku-asistente-preview-lista--alerta" : ""}`;
        const strong = document.createElement("strong");
        strong.textContent = titulo;
        const ul = document.createElement("ul");
        elementos.forEach(item => {
            const li = document.createElement("li");
            li.textContent = String(item || "");
            ul.appendChild(li);
        });
        bloque.append(strong, ul);
        contenedor.appendChild(bloque);
    }

    function blobADataUrl(blob) {
        return new Promise((resolve, reject) => {
            const lector = new FileReader();
            lector.onload = () => resolve(String(lector.result || ""));
            lector.onerror = () => reject(new Error("No pude leer una de las imágenes adjuntas."));
            lector.readAsDataURL(blob);
        });
    }

    async function imagenesAdjuntasActuales() {
        if (!adjuntosWrap) return [];
        const imgs = [...adjuntosWrap.querySelectorAll(".haiku-asistente-adjunto img")].slice(0, MAX_IMAGENES);
        const imagenes = [];

        for (const img of imgs) {
            const src = String(img.currentSrc || img.src || "");
            if (!src) continue;

            if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(src)) {
                imagenes.push(src);
                continue;
            }

            const respuesta = await fetch(src);
            if (!respuesta.ok) throw new Error("No pude leer una de las capturas adjuntas.");
            const blob = await respuesta.blob();
            if (!/^image\/(png|jpeg|webp)$/i.test(blob.type || "")) {
                throw new Error("Una de las capturas no tiene un formato admitido.");
            }
            imagenes.push(await blobADataUrl(blob));
        }

        return imagenes;
    }

    function limpiarAdjuntosViaInterfaz() {
        if (!adjuntosWrap) return;
        [...adjuntosWrap.querySelectorAll(".haiku-asistente-quitar")].forEach(boton => {
            try { boton.click(); } catch {}
        });
    }

    function webpayDesdePago(p) {
        const m = normalizar(p?.medio);
        if (!m.includes("webpay")) return null;
        const medio = m.includes("debito") ? "webpay_debito" : m.includes("credito") ? "webpay_credito" : null;
        if (!medio) return null;
        return {
            medio,
            monto: Number(p?.monto),
            fecha: fechaIsoValida(p?.fecha) ? String(p.fecha) : null,
            codaut: String(p?.codaut || "").trim()
        };
    }

    function transferenciaDesdePago(p) {
        const m = normalizar(p?.medio);
        if (!m.includes("transferencia")) return null;
        return {
            medio: "transferencia",
            monto: Number(p?.monto),
            fecha: fechaIsoValida(p?.fecha) ? String(p.fecha) : null,
            glosa: String(p?.glosa || "").trim()
        };
    }

    function tarjetaDesdePago(p) {
        const m = normalizar(p?.medio);
        if (m.includes("webpay") || !m.includes("tarjeta")) return null;
        const credito = m.includes("credito");
        const debito = m.includes("debito");
        if (credito === debito) return null;
        return {
            medio: credito ? "tarjeta_credito" : "tarjeta_debito",
            monto: Number(p?.monto),
            fecha: fechaIsoValida(p?.fecha) ? String(p.fecha) : null,
            folio: String(p?.folio || "").trim(),
            bovtar: String(p?.bovtar || "").trim()
        };
    }

    function efectivoDesdePago(p) {
        const m = normalizar(p?.medio);
        if (!m.includes("efectivo")) return null;
        return {
            medio: "efectivo",
            monto: Number(p?.monto),
            fecha: fechaIsoValida(p?.fecha) ? String(p.fecha) : null
        };
    }

    function pagoParaRpc(p) {
        const w = webpayDesdePago(p);
        if (w && Number.isFinite(w.monto) && w.monto > 0 && w.fecha && w.codaut) {
            return { medio: w.medio, monto: Math.round(w.monto), fecha_pago: new Date(`${w.fecha}T12:00:00`).toISOString(), codaut: w.codaut, glosa: null, folio: null, bovtar: null };
        }

        const t = transferenciaDesdePago(p);
        if (t && Number.isFinite(t.monto) && t.monto > 0 && t.fecha && t.glosa) {
            return { medio: t.medio, monto: Math.round(t.monto), fecha_pago: new Date(`${t.fecha}T12:00:00`).toISOString(), codaut: null, glosa: t.glosa, folio: null, bovtar: null };
        }

        const c = tarjetaDesdePago(p);
        if (c && Number.isFinite(c.monto) && c.monto > 0 && c.fecha && c.folio && c.bovtar) {
            return { medio: c.medio, monto: Math.round(c.monto), fecha_pago: new Date(`${c.fecha}T12:00:00`).toISOString(), codaut: null, glosa: null, folio: c.folio, bovtar: c.bovtar };
        }

        const e = efectivoDesdePago(p);
        if (e && Number.isFinite(e.monto) && e.monto > 0 && e.fecha) {
            return { medio: e.medio, monto: Math.round(e.monto), fecha_pago: new Date(`${e.fecha}T12:00:00`).toISOString(), codaut: null, glosa: null, folio: null, bovtar: null };
        }

        return null;
    }

    function pagosDeEntrada(entrada) {
        return Array.isArray(entrada?.pagos)
            ? entrada.pagos.filter(p => p && p.detectado !== false)
            : [];
    }

    function detallePagoVisible(p, indice, total) {
        const bloque = document.createElement("div");
        bloque.className = "haiku-asistente-preview-pago";
        const titulo = document.createElement("strong");
        titulo.textContent = total > 1 ? `Pago ${indice + 1} de ${total}` : "Pago detectado";
        const grid = document.createElement("div");
        grid.className = "haiku-asistente-preview-grid";
        agregarDato(grid, "Monto", moneda(p?.monto));
        agregarDato(grid, "Medio", p?.medio);
        agregarDato(grid, "Fecha", fechaVisible(p?.fecha));
        agregarDato(grid, "CodAut", p?.codaut);
        agregarDato(grid, "Folio", p?.folio);
        agregarDato(grid, "BOVTAR", p?.bovtar);
        agregarDato(grid, "Glosa", p?.glosa);
        bloque.append(titulo, grid);
        return bloque;
    }

    async function buscarCandidatos(reserva) {
        const cabana = Number(reserva?.cabana);
        const { data, error } = await cliente.rpc("haiku_buscar_reservas_pago_asistente", {
            p_cabana_numero: Number.isInteger(cabana) ? cabana : null,
            p_titular: reserva?.titular_nombre || null,
            p_cloudbeds_id: reserva?.cloudbeds_id || null
        });
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    function filtrarCandidatosPorFechas(candidatos, reserva) {
        if (!fechaIsoValida(reserva?.fecha_llegada) || !fechaIsoValida(reserva?.fecha_salida)) {
            return candidatos;
        }
        return candidatos.filter(c =>
            String(c?.fecha_ingreso || "") === String(reserva.fecha_llegada) &&
            String(c?.fecha_salida || "") === String(reserva.fecha_salida)
        );
    }

    function detectarDuplicados(candidato, pagos) {
        const existentes = Array.isArray(candidato?.pagos_recientes) ? candidato.pagos_recientes : [];
        const fuertes = [];
        const probables = [];

        pagos.forEach((p, indice) => {
            const nuevo = pagoParaRpc(p);
            if (!nuevo) return;

            existentes.forEach(ex => {
                if (String(ex?.medio || "") !== nuevo.medio) return;

                if (nuevo.medio.startsWith("webpay_") && nuevo.codaut && String(ex?.codaut || "") === nuevo.codaut) {
                    fuertes.push(`Pago ${indice + 1}: ya existe WebPay con COD.AUT ${nuevo.codaut}.`);
                    return;
                }

                if (nuevo.medio.startsWith("tarjeta_") && nuevo.folio && nuevo.bovtar && String(ex?.folio || "") === nuevo.folio && String(ex?.bovtar || "") === nuevo.bovtar) {
                    fuertes.push(`Pago ${indice + 1}: ya existe tarjeta con Folio ${nuevo.folio} y BOVTAR ${nuevo.bovtar}.`);
                    return;
                }

                const mismaFecha = String(ex?.fecha_pago_chile || "") === String(p?.fecha || "");
                const mismoMonto = Number(ex?.monto) === Math.round(Number(p?.monto));
                if (mismaFecha && mismoMonto) {
                    probables.push(`Pago ${indice + 1}: ya existe ${moneda(p?.monto)} en la misma fecha. Revisar posible duplicado.`);
                }
            });
        });

        return { fuertes: [...new Set(fuertes)], probables: [...new Set(probables)] };
    }

    async function resolverEntrada(entrada, indice) {
        const r = entrada?.reserva || {};
        const pagos = pagosDeEntrada(entrada);
        const problemas = [];

        if (!r.titular_nombre) problemas.push(`Reserva ${indice + 1}: falta titular.`);
        if (!Number.isInteger(Number(r.cabana)) && !String(r.cloudbeds_id || "").trim()) {
            problemas.push(`Reserva ${indice + 1}: falta CAB para localizarla.`);
        }
        if (!pagos.length) problemas.push(`Reserva ${indice + 1}: no se detectaron pagos.`);

        const pagosRpc = pagos.map(pagoParaRpc);
        if (pagosRpc.some(p => !p)) {
            problemas.push(`Reserva ${indice + 1}: un pago está incompleto (monto, fecha o referencia obligatoria).`);
        }

        if (problemas.length) return { entrada, r, pagos, pagosRpc, problemas, candidato: null };

        let candidatos = await buscarCandidatos(r);
        if (fechaIsoValida(r.fecha_llegada) && fechaIsoValida(r.fecha_salida)) {
            candidatos = filtrarCandidatosPorFechas(candidatos, r);
        }

        if (!candidatos.length) {
            problemas.push(`Reserva ${indice + 1}: no encontré una reserva existente que coincida con ${r.titular_nombre}${r.cabana ? ` · CAB ${r.cabana}` : ""}.`);
            return { entrada, r, pagos, pagosRpc, problemas, candidato: null };
        }

        if (candidatos.length > 1) {
            problemas.push(`Reserva ${indice + 1}: encontré más de una reserva posible para ${r.titular_nombre} · CAB ${r.cabana}. Usa la tabla de Reservas con Check-In/Check-Out visibles para precisar.`);
            return { entrada, r, pagos, pagosRpc, problemas, candidato: null, candidatos };
        }

        const candidato = candidatos[0];
        const duplicados = detectarDuplicados(candidato, pagos);
        if (duplicados.fuertes.length || duplicados.probables.length) {
            problemas.push(...duplicados.fuertes, ...duplicados.probables);
        }

        return { entrada, r, pagos, pagosRpc, problemas, candidato };
    }

    function agruparResoluciones(resoluciones) {
        const mapa = new Map();
        resoluciones.forEach(res => {
            if (!res.candidato) return;
            const id = String(res.candidato.reserva_id);
            if (!mapa.has(id)) {
                mapa.set(id, {
                    candidato: res.candidato,
                    pagos: [],
                    pagosRpc: [],
                    problemas: []
                });
            }
            const grupo = mapa.get(id);
            grupo.pagos.push(...res.pagos);
            grupo.pagosRpc.push(...res.pagosRpc);
            grupo.problemas.push(...res.problemas);
        });
        return [...mapa.values()];
    }

    async function registrarLote(grupos) {
        if (window.haikuTienePermiso?.("pagos.registrar") !== true) {
            throw new Error("Tu usuario no tiene permiso para registrar pagos.");
        }
        if (window.haikuTienePermiso?.("pagos.verificar") !== true) {
            throw new Error("Tu usuario no tiene permiso para verificar pagos.");
        }

        const operaciones = grupos.map(grupo => ({
            reserva_id: grupo.candidato.reserva_id,
            pagos: grupo.pagosRpc
        }));

        const { data, error } = await cliente.rpc("haiku_registrar_lote_abonos_reservas_existentes_asistente", {
            p_operaciones: operaciones
        });
        if (error) throw error;
        return data;
    }

    async function refrescar() {
        try { if (typeof window.cargarAbonosPagos === "function") await window.cargarAbonosPagos(); } catch {}
        try { if (typeof window.cargarSaldosCheckin === "function") await window.cargarSaldosCheckin(); } catch {}
        try { if (typeof window.haikuSincronizarReservasSupabase === "function") await window.haikuSincronizarReservasSupabase(); } catch {}
        try { await window.HAIKU_RESERVAS_V1?.refrescar?.(); } catch {}
    }

    async function renderizarLote(preview) {
        const entradas = Array.isArray(preview?.reservas) ? preview.reservas : [];
        const card = document.createElement("article");
        card.className = "haiku-asistente-preview";

        const cabecera = document.createElement("div");
        cabecera.className = "haiku-asistente-preview-cabecera";
        const titulo = document.createElement("div");
        const marca = document.createElement("span");
        marca.textContent = "PAGOS NOCTURNOS · LOTE · NADA GUARDADO";
        const nombre = document.createElement("strong");
        nombre.textContent = entradas.length ? `${entradas.length} reservas por revisar` : "Pagos por revisar";
        titulo.append(marca, nombre);
        const confianza = document.createElement("span");
        confianza.className = `haiku-asistente-confianza haiku-asistente-confianza--${preview?.confianza || "baja"}`;
        confianza.textContent = `Confianza ${preview?.confianza || "baja"}`;
        cabecera.append(titulo, confianza);
        card.appendChild(cabecera);

        const explicacion = document.createElement("p");
        explicacion.className = "haiku-asistente-preview-resumen";
        explicacion.textContent = "Este flujo busca reservas que YA existen. Plan tarifario, categoría, estado Cloudbeds e ID Cloudbeds no son requisitos para registrar estos pagos.";
        card.appendChild(explicacion);

        mensajes.appendChild(card);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });

        if (!entradas.length) {
            agregarLista(card, "No se puede continuar", ["No se detectaron destinos de reserva ni pagos."], true);
            return;
        }

        const resoluciones = [];
        for (let i = 0; i < entradas.length; i++) {
            try {
                resoluciones.push(await resolverEntrada(entradas[i], i));
            } catch (error) {
                resoluciones.push({
                    entrada: entradas[i],
                    r: entradas[i]?.reserva || {},
                    pagos: pagosDeEntrada(entradas[i]),
                    pagosRpc: [],
                    problemas: [`Reserva ${i + 1}: no pude buscar el destino (${error?.message || "error desconocido"}).`],
                    candidato: null
                });
            }
        }

        const problemasGlobales = [];
        resoluciones.forEach((res, indice) => {
            const bloque = document.createElement("section");
            bloque.className = "haiku-asistente-preview-observacion";
            const et = document.createElement("span");
            et.textContent = `RESERVA ${indice + 1}`;
            bloque.appendChild(et);

            const grid = document.createElement("div");
            grid.className = "haiku-asistente-preview-grid";
            agregarDato(grid, "Titular leído", res.r?.titular_nombre);
            agregarDato(grid, "CAB leída", res.r?.cabana ? `CAB ${res.r.cabana}` : null);
            if (res.candidato) {
                agregarDato(grid, "Reserva encontrada", `${res.candidato.titular_nombre} · CAB ${res.candidato.cabana_numero}`);
                agregarDato(grid, "Estadía", `${fechaVisible(res.candidato.fecha_ingreso)} → ${fechaVisible(res.candidato.fecha_salida)}`);
                agregarDato(grid, "Total", moneda(res.candidato.total_alojamiento));
                agregarDato(grid, "Pagado actual", moneda(res.candidato.pagado_alojamiento));
                agregarDato(grid, "Saldo actual", moneda(res.candidato.saldo_alojamiento));
                const suma = res.pagosRpc.reduce((s, p) => s + Number(p?.monto || 0), 0);
                agregarDato(grid, "Pagos nuevos", moneda(suma));
                agregarDato(grid, "Saldo proyectado", moneda(Math.max(0, Number(res.candidato.saldo_alojamiento || 0) - suma)));
            }
            bloque.appendChild(grid);

            res.pagos.forEach((p, j) => bloque.appendChild(detallePagoVisible(p, j, res.pagos.length)));
            if (res.problemas.length) {
                agregarLista(bloque, "Revisar", res.problemas, true);
                problemasGlobales.push(...res.problemas);
            }
            card.appendChild(bloque);
        });

        if (preview?.confianza === "baja") {
            problemasGlobales.push("La lectura general tiene confianza baja; no registraré el lote automáticamente.");
        }

        const grupos = agruparResoluciones(resoluciones);
        const totalPagos = grupos.reduce((s, g) => s + g.pagosRpc.length, 0);

        const pie = document.createElement("div");
        pie.className = "haiku-asistente-preview-pie";
        const estado = document.createElement("span");
        estado.textContent = "🔒 Nada guardado todavía.";
        const boton = document.createElement("button");
        boton.type = "button";
        boton.disabled = true;
        boton.textContent = "Confirmar lote · revisar datos";
        pie.append(estado, boton);
        card.appendChild(pie);

        if (problemasGlobales.length || grupos.length !== entradas.length || totalPagos < 1) {
            agregarLista(card, "Antes de registrar", [...new Set(problemasGlobales)], true);
            estado.textContent = "🔒 Nada guardado. Corrige sólo los datos de pago o identificación indicados.";
            return;
        }

        if (window.haikuTienePermiso?.("pagos.registrar") !== true || window.haikuTienePermiso?.("pagos.verificar") !== true) {
            estado.textContent = "🔒 Tu usuario no tiene permisos para registrar y verificar pagos.";
            return;
        }

        boton.disabled = false;
        boton.textContent = `Confirmar ${totalPagos} ${totalPagos === 1 ? "pago" : "pagos"} en ${grupos.length} ${grupos.length === 1 ? "reserva" : "reservas"}`;

        boton.addEventListener("click", async () => {
            if (ocupado || boton.disabled) return;
            const ok = window.confirm(`¿Confirmas registrar ${totalPagos} ${totalPagos === 1 ? "pago" : "pagos"} en ${grupos.length} ${grupos.length === 1 ? "reserva" : "reservas"}? El lote se guarda completo o no se guarda nada.`);
            if (!ok) return;

            ocupado = true;
            boton.disabled = true;
            boton.textContent = "Registrando lote…";
            estado.textContent = "Validando duplicados y registrando todo en una sola transacción…";

            try {
                const resultado = await registrarLote(grupos);
                await refrescar();
                marca.textContent = "PAGOS NOCTURNOS · LOTE REGISTRADO";
                estado.textContent = `✅ ${resultado?.cantidad_pagos || totalPagos} pagos registrados en ${resultado?.cantidad_reservas || grupos.length} reservas.`;
                boton.textContent = "Lote registrado";
                agregarMensaje("asistente", `Lote aplicado: ${resultado?.cantidad_pagos || totalPagos} pagos en ${resultado?.cantidad_reservas || grupos.length} reservas.`);
            } catch (error) {
                console.error("HAKU · Pagos nocturnos:", error);
                estado.textContent = `⚠️ No se registró ningún pago del lote: ${error?.message || "error desconocido"}`;
                boton.disabled = false;
                boton.textContent = `Confirmar ${totalPagos} pagos en ${grupos.length} reservas`;
            } finally {
                ocupado = false;
                requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
            }
        });
    }

    async function analizarYMostrar(texto) {
        ocupado = true;
        enviar.disabled = true;
        campo.disabled = true;
        if (adjuntar) adjuntar.disabled = true;

        const estado = agregarMensaje("asistente", "Leyendo el lote de pagos y buscando las reservas existentes…", "haiku-asistente-mensaje--procesando");

        try {
            const imagenes = await imagenesAdjuntasActuales();
            agregarMensaje("usuario", imagenes.length
                ? `${texto}\n${imagenes.length} ${imagenes.length === 1 ? "imagen adjunta" : "imágenes adjuntas"}`
                : texto);
            campo.value = "";

            const funcion = imagenes.length
                ? "haiku-asistente-pago-existente-imagen"
                : "haiku-asistente-pago-existente";
            const body = imagenes.length ? { mensaje: texto, imagenes } : { mensaje: texto };

            const { data, error } = await cliente.functions.invoke(funcion, { body });
            if (error) throw error;
            if (!data?.ok || !data?.preview) throw new Error(data?.error || "Haku no devolvió una vista previa de pagos.");
            if (data.preview.tipo_operacion !== "registrar_pago") {
                throw new Error("La instrucción no fue reconocida como pagos sobre reservas existentes.");
            }

            estado.classList.remove("haiku-asistente-mensaje--procesando");
            estado.textContent = data.preview?.resumen || "Pagos leídos. Buscando reservas existentes.";
            await renderizarLote(data.preview);
            if (imagenes.length) limpiarAdjuntosViaInterfaz();
        } catch (error) {
            console.error("HAKU · Pagos nocturnos IA:", error);
            estado.classList.remove("haiku-asistente-mensaje--procesando");
            estado.textContent = `No pude preparar el lote de pagos: ${error?.message || "error desconocido"}`;
        } finally {
            ocupado = false;
            campo.disabled = false;
            if (adjuntar) adjuntar.disabled = false;
            campo.dispatchEvent(new Event("input", { bubbles: true }));
            requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });
        }
    }

    function intentarInterceptar(evento) {
        if (ocupado) return;
        const texto = campo.value.trim();
        if (!esComandoLotePagos(texto)) return;

        evento.preventDefault();
        evento.stopImmediatePropagation();
        analizarYMostrar(texto);
    }

    enviar.addEventListener("click", intentarInterceptar, true);
    campo.addEventListener("keydown", evento => {
        if ((evento.ctrlKey || evento.metaKey) && evento.key === "Enter") intentarInterceptar(evento);
    }, true);

    window.HAIKU_ASISTENTE_PAGOS_NOCTURNOS_V1 = Object.freeze({
        activo: true,
        admiteImagenes: true,
        esComandoLotePagos
    });

    console.info("HAKU · Pagos nocturnos en lote V1 preparado.");
})();