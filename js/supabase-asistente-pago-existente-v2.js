// ========================================
// HAIKU · ASISTENTE · PAGO EN RESERVA EXISTENTE V2
// Texto o capturas -> IA dedicada -> busca reserva -> valida duplicados -> confirma -> registra abono.
// Sin observers, intervalos, parches de clientes ni prototipos globales.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_PAGO_EXISTENTE_V2) return;

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
        if (principal && srcActual && principal.dataset.haikuPagoExistenteV2Espera !== "1") {
            principal.dataset.haikuPagoExistenteV2Espera = "1";
            principal.addEventListener("load", () => {
                if (window.HAIKU_ASISTENTE_PAGO_EXISTENTE_V2) return;
                const retry = document.createElement("script");
                retry.src = `${srcActual}${srcActual.includes("?") ? "&" : "?"}afterAssistant=${Date.now()}`;
                retry.async = false;
                document.head.appendChild(retry);
            }, { once: true });
            console.info("HAIKU · Pago existente V2 esperará la carga del asistente principal.");
        } else {
            console.info("HAIKU · Pago existente V2 no se instaló porque el asistente aún no está disponible.");
        }
        return;
    }

    const MAX_IMAGENES = 6;
    let ocupado = false;

    function normalizar(texto) {
        return String(texto || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function esComandoPagoIndependiente(texto) {
        const t = normalizar(texto);
        if (!t) return false;

        const pidePago =
            /\b(agrega|agregar|registre|registra|registrar|asocia|asociar)\b.{0,60}\b(pago|abono)\b/.test(t) ||
            /\b(pago|abono)\b.{0,60}\b(agrega|agregar|registre|registra|registrar|asocia|asociar)\b/.test(t);

        const pideNuevaReserva =
            /\b(crea|crear|ingresa|ingresar)\b.{0,40}\b(nueva )?reserva\b/.test(t) ||
            /\bagrega (esta|una|nueva) reserva\b/.test(t);

        return pidePago && !pideNuevaReserva;
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
        const small = document.createElement("span");
        small.textContent = etiqueta;
        const strong = document.createElement("strong");
        strong.textContent = String(valor);
        fila.append(small, strong);
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
        const botones = [...adjuntosWrap.querySelectorAll(".haiku-asistente-quitar")];
        botones.forEach(boton => {
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
            fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(p?.fecha || "")) ? String(p.fecha) : null,
            codaut: String(p?.codaut || "").trim()
        };
    }

    function transferenciaDesdePago(p) {
        const m = normalizar(p?.medio);
        if (!m.includes("transferencia")) return null;
        return {
            medio: "transferencia",
            monto: Number(p?.monto),
            fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(p?.fecha || "")) ? String(p.fecha) : null,
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
            fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(p?.fecha || "")) ? String(p.fecha) : null,
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
            fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(p?.fecha || "")) ? String(p.fecha) : null
        };
    }

    function pagoParaRpc(p) {
        const medioAirbnb = normalizar(p?.medio);
        if ((medioAirbnb === "airbnb_prepaid_card" || /^airbnb\s+prepaid\s+card$/.test(medioAirbnb)) && p?.detectado !== false) {
            const monto = Number(p?.monto), fecha = String(p?.fecha || "");
            if (!Number.isFinite(monto) || monto <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
            const interpretada = new Date(`${fecha}T12:00:00Z`);
            if (Number.isNaN(interpretada.getTime()) || interpretada.toISOString().slice(0,10) !== fecha) return null;
            const referencia = String(p?.referencia_externa || p?.glosa || "").trim() || null;
            return { medio: "airbnb_prepaid_card", monto: Math.round(monto), fecha_pago: new Date(`${fecha}T12:00:00`).toISOString(),
                glosa: referencia, referencia_externa: referencia, codaut: null, folio: null, bovtar: null };
        }
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
        titulo.textContent = total > 1 ? `Abono ${indice + 1} de ${total}` : "Abono detectado";
        const grid = document.createElement("div");
        grid.className = "haiku-asistente-preview-grid";
        agregarDato(grid, "Monto", moneda(p?.monto));
        agregarDato(grid, "Medio", p?.medio === "airbnb_prepaid_card" ? "Airbnb Prepaid Card" : p?.medio);
        agregarDato(grid, "Fecha", fechaVisible(p?.fecha));
        agregarDato(grid, "Glosa", p?.glosa);
        agregarDato(grid, "CodAut", p?.codaut);
        agregarDato(grid, "Folio", p?.folio);
        agregarDato(grid, "BOVTAR", p?.bovtar);
        bloque.append(titulo, grid);
        return bloque;
    }

    function detectarDuplicados(candidato, pagos) {
        const existentes = Array.isArray(candidato?.pagos_recientes) ? candidato.pagos_recientes : [];
        const fuertes = [];
        const probables = [];

        pagos.forEach((p, indice) => {
            const nuevo = pagoParaRpc(p);
            if (!nuevo) return;

            existentes.forEach(ex => {
                const mismoMedio = String(ex?.medio || "") === nuevo.medio;
                if (!mismoMedio) return;

                if (nuevo.medio.startsWith("webpay_") && nuevo.codaut && String(ex?.codaut || "") === nuevo.codaut) {
                    fuertes.push(`Abono ${indice + 1}: ya existe un WebPay con COD.AUT ${nuevo.codaut}.`);
                    return;
                }

                if (nuevo.medio.startsWith("tarjeta_") && nuevo.folio && nuevo.bovtar && String(ex?.folio || "") === nuevo.folio && String(ex?.bovtar || "") === nuevo.bovtar) {
                    fuertes.push(`Abono ${indice + 1}: ya existe una tarjeta con Folio ${nuevo.folio} y BOVTAR ${nuevo.bovtar}.`);
                    return;
                }

                const mismaFecha = String(ex?.fecha_pago_chile || "") === String(p?.fecha || "");
                const mismoMonto = Number(ex?.monto) === Math.round(Number(p?.monto));
                if (mismaFecha && mismoMonto) {
                    probables.push(`Abono ${indice + 1}: ya existe un ${p?.medio || "pago"} por ${moneda(p?.monto)} en la misma fecha. Revisar posible duplicado.`);
                }
            });
        });

        return {
            fuertes: [...new Set(fuertes)],
            probables: [...new Set(probables)]
        };
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

    async function registrarAbonos(reservaId, pagos) {
        if (window.haikuTienePermiso?.("pagos.registrar") !== true) {
            throw new Error("Tu usuario no tiene permiso para registrar pagos.");
        }
        if (window.haikuTienePermiso?.("pagos.verificar") !== true) {
            throw new Error("Tu usuario no tiene permiso para verificar pagos.");
        }

        const payload = pagos.map(pagoParaRpc);
        if (payload.some(p => !p)) throw new Error("Uno de los abonos está incompleto o tiene un medio no admitido.");

        const { data, error } = await cliente.rpc("haiku_registrar_abonos_reserva_existente_asistente", {
            p_reserva_id: reservaId,
            p_pagos: payload
        });
        if (error) throw error;
        return data;
    }

    async function refrescar() {
        try { if (typeof window.cargarAbonosPagos === "function") await window.cargarAbonosPagos(); } catch {}
        try { if (typeof window.cargarSaldosCheckin === "function") await window.cargarSaldosCheckin(); } catch {}
        try { await window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(); } catch {}
        try { if (typeof window.haikuSincronizarReservasSupabase === "function") await window.haikuSincronizarReservasSupabase(); } catch {}
    }

    function renderCandidatosAmbiguos(card, candidatos) {
        const textos = candidatos.map(c => `${c.titular_nombre} · CAB ${c.cabana_numero} · ${fechaVisible(c.fecha_ingreso)} → ${fechaVisible(c.fecha_salida)} · saldo ${moneda(c.saldo_alojamiento)}`);
        agregarLista(card, "Encontré varias reservas posibles", textos, true);
    }

    async function renderizarPagoExistente(preview) {
        const entradas = Array.isArray(preview?.reservas) ? preview.reservas : [];
        const card = document.createElement("article");
        card.className = "haiku-asistente-preview";

        const cabecera = document.createElement("div");
        cabecera.className = "haiku-asistente-preview-cabecera";
        const titulo = document.createElement("div");
        const marca = document.createElement("span");
        marca.textContent = "PAGO EN RESERVA EXISTENTE · NADA GUARDADO";
        const nombre = document.createElement("strong");
        nombre.textContent = entradas[0]?.reserva?.titular_nombre || "Pago por revisar";
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

        if (entradas.length !== 1) {
            agregarLista(card, "Revisar", ["Por ahora el registro independiente admite un solo destino de reserva por solicitud."], true);
            mensajes.appendChild(card);
            return;
        }

        const entrada = entradas[0];
        const r = entrada?.reserva || {};
        const pagos = pagosDeEntrada(entrada);
        const datosObjetivo = document.createElement("div");
        datosObjetivo.className = "haiku-asistente-preview-grid";
        agregarDato(datosObjetivo, "Titular indicado", r.titular_nombre);
        agregarDato(datosObjetivo, "Cabaña indicada", r.cabana ? `CAB ${r.cabana}` : null);
        agregarDato(datosObjetivo, "ID Cloudbeds", r.cloudbeds_id);
        card.appendChild(datosObjetivo);

        pagos.forEach((p, i) => card.appendChild(detallePagoVisible(p, i, pagos.length)));
        agregarLista(card, "Datos faltantes", entrada?.faltantes || [], false);
        agregarLista(card, "Advertencias IA", entrada?.advertencias || [], true);

        const pie = document.createElement("div");
        pie.className = "haiku-asistente-preview-pie";
        const estado = document.createElement("span");
        estado.textContent = "Buscando la reserva existente…";
        const boton = document.createElement("button");
        boton.type = "button";
        boton.disabled = true;
        boton.textContent = "Confirmar abono · buscando reserva";
        pie.append(estado, boton);
        card.appendChild(pie);
        mensajes.appendChild(card);
        requestAnimationFrame(() => { mensajes.scrollTop = mensajes.scrollHeight; });

        const problemas = [];
        if (!r.titular_nombre) problemas.push("Falta el nombre del titular para buscar la reserva.");
        if (!Number.isInteger(Number(r.cabana)) && !String(r.cloudbeds_id || "").trim()) problemas.push("Falta CAB o ID Cloudbeds para localizar la reserva.");
        if (!pagos.length) problemas.push("No se detectó ningún abono.");
        const pagosRpc = pagos.map(pagoParaRpc);
        if (pagosRpc.some(p => !p)) problemas.push("Uno de los abonos está incompleto: revisa monto, fecha y referencia correspondiente al medio.");
        if (preview?.confianza === "baja") problemas.push("La confianza de lectura es baja.");

        if (problemas.length) {
            agregarLista(card, "No se puede registrar todavía", problemas, true);
            estado.textContent = "🔒 Nada guardado. Revisa los datos indicados.";
            boton.textContent = "Registrar abono · revisar datos";
            return;
        }

        let candidatos;
        try {
            candidatos = await buscarCandidatos(r);
        } catch (error) {
            estado.textContent = `⚠️ No pude buscar la reserva: ${error?.message || "error desconocido"}`;
            boton.textContent = "Registrar abono · búsqueda fallida";
            return;
        }

        if (!candidatos.length) {
            estado.textContent = "🔒 No encontré una reserva coincidente. No se guardó nada.";
            boton.textContent = "Registrar abono · reserva no encontrada";
            return;
        }

        if (candidatos.length > 1) {
            renderCandidatosAmbiguos(card, candidatos);
            estado.textContent = "🔒 Hay más de una reserva posible. Agrega el ID Cloudbeds para precisar.";
            boton.textContent = "Registrar abono · destino ambiguo";
            return;
        }

        const destino = candidatos[0];
        const encontrada = document.createElement("div");
        encontrada.className = "haiku-asistente-preview-observacion";
        const et = document.createElement("span");
        et.textContent = "RESERVA ENCONTRADA";
        const eg = document.createElement("div");
        eg.className = "haiku-asistente-preview-grid";
        agregarDato(eg, "Titular", destino.titular_nombre);
        agregarDato(eg, "Cabaña", `CAB ${destino.cabana_numero}`);
        agregarDato(eg, "Ingreso", fechaVisible(destino.fecha_ingreso));
        agregarDato(eg, "Salida", fechaVisible(destino.fecha_salida));
        agregarDato(eg, "Total alojamiento", moneda(destino.total_alojamiento));
        agregarDato(eg, "Pagado", moneda(destino.pagado_alojamiento));
        agregarDato(eg, "Saldo actual", moneda(destino.saldo_alojamiento));
        agregarDato(eg, "Saldo a favor actual", moneda(destino.saldo_a_favor));
        encontrada.append(et, eg);
        card.insertBefore(encontrada, pie);

        const totalNuevo = pagosRpc.reduce((s, p) => s + Number(p.monto || 0), 0);
        const saldoActual = Math.max(0, Number(destino.saldo_alojamiento || 0));
        const favorActual = Math.max(0, Number(destino.saldo_a_favor || 0));
        const saldoDespues = Math.max(0, saldoActual - totalNuevo);
        const favorGenerado = Math.max(0, totalNuevo - saldoActual);
        const proyeccion = document.createElement("div");
        proyeccion.className = "haiku-asistente-preview-pago";
        const pt = document.createElement("strong");
        pt.textContent = "Resultado esperado";
        const pg = document.createElement("div");
        pg.className = "haiku-asistente-preview-grid";
        agregarDato(pg, "Nuevo abono", moneda(totalNuevo));
        agregarDato(pg, "Saldo después", moneda(saldoDespues));
        agregarDato(pg, "Saldo a favor después", moneda(favorActual + favorGenerado));
        proyeccion.append(pt, pg);
        card.insertBefore(proyeccion, pie);

        const duplicados = detectarDuplicados(destino, pagos);
        if (duplicados.fuertes.length || duplicados.probables.length) {
            agregarLista(card, "Posible pago duplicado", [...duplicados.fuertes, ...duplicados.probables], true);
            estado.textContent = "🔒 No registraré automáticamente un pago que parece ya existente.";
            boton.textContent = "Registrar abono · revisar duplicado";
            return;
        }

        const permiso = window.haikuTienePermiso?.("pagos.registrar") === true && window.haikuTienePermiso?.("pagos.verificar") === true;
        if (!permiso) {
            estado.textContent = "🔒 Tu usuario no tiene permisos para registrar y verificar pagos.";
            boton.textContent = "Registrar abono · sin permiso";
            return;
        }

        estado.textContent = favorGenerado > 0
            ? `🔒 Nada guardado. ${moneda(favorGenerado)} quedaría como saldo a favor.`
            : "🔒 Nada guardado todavía.";
        boton.disabled = false;
        boton.textContent = `Confirmar ${pagos.length} ${pagos.length === 1 ? "abono" : "abonos"}`;

        boton.addEventListener("click", async () => {
            if (ocupado || boton.disabled) return;
            const ok = window.confirm(`¿Confirmas registrar ${pagos.length} ${pagos.length === 1 ? "abono" : "abonos"} en CAB ${destino.cabana_numero} · ${destino.titular_nombre}?`);
            if (!ok) return;

            ocupado = true;
            boton.disabled = true;
            boton.textContent = "Registrando abono…";
            estado.textContent = "Registrando el pago en la reserva existente…";
            try {
                const resultado = await registrarAbonos(destino.reserva_id, pagos);
                await refrescar();
                marca.textContent = pagos.length === 1 ? "ABONO REGISTRADO" : `${pagos.length} ABONOS REGISTRADOS`;
                estado.textContent = `✅ ${pagos.length} ${pagos.length === 1 ? "abono registrado" : "abonos registrados"} · saldo restante ${moneda(resultado?.saldo_restante)} · saldo a favor ${moneda(resultado?.saldo_a_favor)}.`;
                boton.textContent = pagos.length === 1 ? "Abono registrado" : "Abonos registrados";
                agregarMensaje("asistente", `Pago aplicado a CAB ${destino.cabana_numero} · ${destino.titular_nombre}. Saldo restante ${moneda(resultado?.saldo_restante)}.`);
            } catch (error) {
                console.error("HAIKU · Pago existente:", error);
                estado.textContent = `⚠️ No se registró el pago: ${error?.message || "error desconocido"}`;
                boton.disabled = false;
                boton.textContent = `Confirmar ${pagos.length} ${pagos.length === 1 ? "abono" : "abonos"}`;
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

        const estado = agregarMensaje("asistente", "Leyendo el pago y buscando su reserva…", "haiku-asistente-mensaje--procesando");

        try {
            const imagenes = await imagenesAdjuntasActuales();
            agregarMensaje("usuario", imagenes.length
                ? `${texto}\n${imagenes.length} ${imagenes.length === 1 ? "imagen adjunta" : "imágenes adjuntas"}`
                : texto);
            campo.value = "";

            const funcion = imagenes.length
                ? "haiku-asistente-pago-existente-imagen"
                : "haiku-asistente-pago-existente";
            const body = imagenes.length
                ? { mensaje: texto, imagenes }
                : { mensaje: texto };

            const { data, error } = await cliente.functions.invoke(funcion, { body });
            if (error) throw error;
            if (!data?.ok || !data?.preview) throw new Error(data?.error || "El asistente no devolvió una vista previa.");
            if (data.preview.tipo_operacion !== "registrar_pago") {
                throw new Error("La instrucción no fue reconocida como un pago sobre una reserva existente.");
            }

            estado.classList.remove("haiku-asistente-mensaje--procesando");
            estado.textContent = data.preview?.resumen || "Pago leído. Revisa el destino antes de confirmar.";
            await renderizarPagoExistente(data.preview);
            if (imagenes.length) limpiarAdjuntosViaInterfaz();
        } catch (error) {
            console.error("HAIKU · Pago existente IA:", error);
            estado.classList.remove("haiku-asistente-mensaje--procesando");
            estado.textContent = `No pude preparar el pago: ${error?.message || "error desconocido"}`;
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
        if (!esComandoPagoIndependiente(texto)) return;

        evento.preventDefault();
        evento.stopImmediatePropagation();
        analizarYMostrar(texto);
    }

    enviar.addEventListener("click", intentarInterceptar, true);
    campo.addEventListener("keydown", evento => {
        if ((evento.ctrlKey || evento.metaKey) && evento.key === "Enter") {
            intentarInterceptar(evento);
        }
    }, true);

    window.HAIKU_ASISTENTE_PAGO_EXISTENTE_V2 = Object.freeze({
        activo: true,
        admiteImagenes: true,
        esComandoPagoIndependiente
    });

    console.info("HAIKU · Asistente pago existente V2 preparado (texto + imágenes).");
})();
