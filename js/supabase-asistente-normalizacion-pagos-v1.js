// ========================================
// HAKU · NORMALIZACION DETERMINISTICA DE PAGOS V1
// Corrige la clasificacion del medio segun su referencia real despues de
// la lectura IA y antes de que el operador confirme.
//
// Reglas cerradas Proyecto H:
// - COD.AUT           => WebPay Credito/Debito
// - Folio + BOVTAR    => Tarjeta Credito/Debito
// - Glosa             => Transferencia bancaria
// - Efectivo          => sin referencia
//
// Seguridad:
// - No parchea Supabase, fetch ni prototipos.
// - Usa un MutationObserver LOCAL, de una sola vista previa, y se desconecta
//   ANTES de modificar el DOM para evitar ciclos.
// - No guarda nada: solo normaliza la misma preview que luego valida Haku.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_ASISTENTE_NORMALIZACION_PAGOS_V1) return;

    const campo = document.getElementById("haiku-asistente-texto");
    const enviar = document.getElementById("haiku-asistente-enviar");
    const mensajes = document.getElementById("haiku-asistente-mensajes");

    if (!campo || !enviar || !mensajes || !window.HAIKU_ASISTENTE) {
        console.info("HAKU · Normalizacion pagos V1 no se instalo: asistente no disponible.");
        return;
    }

    function clave(texto) {
        return String(texto || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }

    function texto(valor) {
        return String(valor ?? "").trim();
    }

    function subtipoDesdeMedio(medio) {
        const m = clave(medio);
        if (/\bdebito\b/.test(m)) return "debito";
        if (/\bcredito\b/.test(m)) return "credito";
        return null;
    }

    function advertenciaPositiva(item) {
        const t = clave(item);
        if (!t) return false;
        if (/\bconsistente con (?:cabana|cabaña)\b/.test(t)) return true;
        if (/\bproductos adicionales\s*(?:=|:|es)?\s*0\b/.test(t)) return true;
        return false;
    }

    function agregarUnico(lista, mensaje) {
        if (!mensaje) return;
        if (!lista.some(item => clave(item) === clave(mensaje))) lista.push(mensaje);
    }

    function normalizarPago(pago, advertencias) {
        if (!pago || pago.detectado === false) return;

        const codaut = texto(pago.codaut);
        const folio = texto(pago.folio);
        const bovtar = texto(pago.bovtar);
        const glosa = texto(pago.glosa);
        const medioOriginal = texto(pago.medio);
        const medioClave = clave(medioOriginal);
        const subtipo = subtipoDesdeMedio(medioOriginal);
        if (medioClave === "airbnb_prepaid_card" || /^airbnb\s+prepaid\s+card$/.test(medioClave)) {
            if (codaut || folio || bovtar) {
                pago.medio = "Referencia incompatible · revisar";
                agregarUnico(advertencias, "Airbnb Prepaid Card contiene identificadores Transbank; revisar la evidencia antes de guardar.");
                return;
            }
            pago.medio = "Airbnb Prepaid Card";
            pago.glosa = texto(pago.referencia_externa || pago.glosa) || null;
            pago.codaut = null; pago.folio = null; pago.bovtar = null;
            return;
        }

        const tieneCodaut = Boolean(codaut);
        const tieneTarjeta = Boolean(folio || bovtar);
        const tieneGlosa = Boolean(glosa);
        const tiposReferencia = [tieneCodaut, tieneTarjeta, tieneGlosa].filter(Boolean).length;

        if (tiposReferencia > 1) {
            pago.medio = "Referencia incompatible · revisar";
            agregarUnico(
                advertencias,
                "El pago mezcla referencias de medios distintos (COD.AUT, Folio/BOVTAR o Glosa). Revisar antes de guardar."
            );
            return;
        }

        if (tieneCodaut) {
            pago.glosa = null;
            pago.folio = null;
            pago.bovtar = null;

            if (subtipo === "credito") {
                pago.medio = "WebPay Crédito";
            } else if (subtipo === "debito") {
                pago.medio = "WebPay Débito";
            } else {
                pago.medio = "WebPay · subtipo por revisar";
                agregarUnico(
                    advertencias,
                    "COD.AUT identifica WebPay, pero no se pudo determinar si corresponde a Crédito o Débito."
                );
            }
            return;
        }

        if (tieneTarjeta) {
            pago.codaut = null;
            pago.glosa = null;

            if (subtipo === "credito") {
                pago.medio = "Tarjeta Crédito";
            } else if (subtipo === "debito") {
                pago.medio = "Tarjeta Débito";
            } else {
                pago.medio = "Tarjeta · subtipo por revisar";
                agregarUnico(
                    advertencias,
                    "Folio/BOVTAR identifica Tarjeta, pero no se pudo determinar si corresponde a Crédito o Débito."
                );
            }

            if (!folio || !bovtar) {
                agregarUnico(
                    advertencias,
                    "El pago con Tarjeta requiere ambos datos: Folio y BOVTAR."
                );
            }
            return;
        }

        if (tieneGlosa) {
            pago.medio = "Transferencia bancaria";
            pago.codaut = null;
            pago.folio = null;
            pago.bovtar = null;
            return;
        }

        if (/\befectivo\b/.test(medioClave)) {
            pago.medio = "Efectivo";
            pago.glosa = null;
            pago.codaut = null;
            pago.folio = null;
            pago.bovtar = null;
        }
    }

    function normalizarEntrada(entrada) {
        if (!entrada || typeof entrada !== "object") return;

        const advertencias = Array.isArray(entrada.advertencias)
            ? entrada.advertencias.filter(item => !advertenciaPositiva(item))
            : [];

        const pagos = Array.isArray(entrada.pagos)
            ? entrada.pagos.filter(item => item && item.detectado !== false)
            : [];

        pagos.forEach(pago => normalizarPago(pago, advertencias));
        entrada.pagos = pagos;
        entrada.advertencias = advertencias;
    }

    function normalizarPreview(preview) {
        if (!preview || typeof preview !== "object") return preview;

        const reservas = Array.isArray(preview.reservas)
            ? preview.reservas.filter(item => item?.reserva && typeof item.reserva === "object")
            : [];

        if (reservas.length) {
            reservas.forEach(normalizarEntrada);

            if (reservas.length === 1) {
                const unica = reservas[0];
                preview.reserva = unica.reserva || preview.reserva || {};
                preview.pagos = unica.pagos;
                preview.acompanantes = Array.isArray(unica.acompanantes) ? unica.acompanantes : [];
                preview.faltantes = Array.isArray(unica.faltantes) ? unica.faltantes : [];
                preview.advertencias = unica.advertencias;
                preview.confianza = unica.confianza || preview.confianza;
                preview.pago = unica.pagos.length === 1 ? unica.pagos[0] : preview.pago;
            }
        } else {
            const entradaLegacy = {
                reserva: preview.reserva || {},
                pagos: Array.isArray(preview.pagos)
                    ? preview.pagos
                    : (preview.pago?.detectado === true ? [preview.pago] : []),
                advertencias: Array.isArray(preview.advertencias) ? preview.advertencias : []
            };
            normalizarEntrada(entradaLegacy);
            preview.pagos = entradaLegacy.pagos;
            preview.advertencias = entradaLegacy.advertencias;
            if (entradaLegacy.pagos.length === 1) preview.pago = entradaLegacy.pagos[0];
        }

        return preview;
    }

    function enteroOpcional(valor) {
        if (valor === null || valor === undefined || valor === "") return null;
        const numero = Number(valor);
        return Number.isInteger(numero) ? numero : NaN;
    }

    function pagosDeEntrada(entrada) {
        return Array.isArray(entrada?.pagos)
            ? entrada.pagos.filter(item => item && item.detectado !== false)
            : [];
    }

    function pagoValido(p) {
        if (!p || p.detectado === false) return false;
        const medio = clave(p.medio);
        const monto = Number(p.monto);
        const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(texto(p.fecha));
        if (!Number.isFinite(monto) || monto <= 0 || !fechaValida) return false;

        if (medio.includes("webpay") && medio.includes("credito")) return Boolean(texto(p.codaut));
        if (medio.includes("webpay") && medio.includes("debito")) return Boolean(texto(p.codaut));
        if (medio.includes("transferencia")) return Boolean(texto(p.glosa));
        if (medio.includes("tarjeta") && (medio.includes("credito") || medio.includes("debito"))) {
            return Boolean(texto(p.folio) && texto(p.bovtar));
        }
        if (medio === "airbnb_prepaid_card" || /^airbnb\s+prepaid\s+card$/.test(medio)) return true;
        if (medio === "efectivo") return true;
        return false;
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
        if (Number.isInteger(adicionales) && adicionales > 0) problemas.push("Cloudbeds incluye productos adicionales; revisar antes de usar el Monto Total como alojamiento.");
        if (Number.isInteger(total) && Number.isInteger(pagado) && Number.isInteger(saldo) && total - pagado !== saldo) {
            problemas.push("Monto Total, Monto pagado y Saldo pendiente de Cloudbeds no cuadran entre sí.");
        }

        const sumaPagos = pagos.reduce((suma, p) => {
            const monto = Number(p?.monto);
            return suma + (Number.isFinite(monto) && monto > 0 ? Math.round(monto) : 0);
        }, 0);

        if (Number.isInteger(pagado) && sumaPagos !== pagado) problemas.push("Los abonos detectados no coinciden con Monto pagado de Cloudbeds.");
        if (Number.isInteger(total) && sumaPagos > total) problemas.push("Los abonos detectados superan el Monto Total de Cloudbeds.");
        return problemas;
    }

    function problemasEntrada(entrada) {
        const r = entrada?.reserva || {};
        const pagos = pagosDeEntrada(entrada);
        const problemas = [];

        if (r.tipo_estadia !== "alojamiento") problemas.push("Tipo de estadía no habilitado para creación automática.");
        if (!r.titular_nombre) problemas.push("Falta titular.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(r.fecha_llegada))) problemas.push("Falta fecha de llegada válida.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(r.fecha_salida))) problemas.push("Falta fecha de salida válida.");
        if (!Number.isInteger(Number(r.cabana)) || Number(r.cabana) < 1) problemas.push("Falta cabaña válida.");
        if (!texto(r.cloudbeds_id)) problemas.push("Falta ID Cloudbeds.");
        if (entrada?.confianza === "baja") problemas.push("Confianza de lectura baja.");
        if (pagos.length > 10) problemas.push("Demasiados abonos.");

        problemas.push(...problemasFinancieros(r, pagos));
        pagos.forEach((p, i) => {
            if (!pagoValido(p)) problemas.push(`${pagos.length > 1 ? `Abono ${i + 1}: ` : ""}pago por revisar.`);
        });

        return problemas;
    }

    function reservasDesdePreview(preview) {
        if (Array.isArray(preview?.reservas) && preview.reservas.length) return preview.reservas;
        return [{
            reserva: preview?.reserva || {},
            pagos: Array.isArray(preview?.pagos) ? preview.pagos : [],
            confianza: preview?.confianza || "baja"
        }];
    }

    function problemasPreview(preview) {
        const reservas = reservasDesdePreview(preview);
        const problemas = [];

        reservas.forEach((entrada, indice) => {
            problemasEntrada(entrada).forEach(p => {
                problemas.push(reservas.length > 1 ? `Reserva ${indice + 1}: ${p}` : p);
            });
        });

        if (reservas.length > 1) {
            const ids = new Set();
            reservas.forEach(entrada => {
                const id = texto(entrada?.reserva?.cloudbeds_id);
                if (!id) return;
                if (ids.has(id)) problemas.push(`ID Cloudbeds repetido: ${id}.`);
                ids.add(id);
            });

            for (let i = 0; i < reservas.length; i++) {
                const a = reservas[i]?.reserva || {};
                for (let j = i + 1; j < reservas.length; j++) {
                    const b = reservas[j]?.reserva || {};
                    if (Number(a.cabana) !== Number(b.cabana)) continue;
                    if (texto(a.fecha_llegada) < texto(b.fecha_salida) && texto(b.fecha_llegada) < texto(a.fecha_salida)) {
                        problemas.push(`CAB ${a.cabana} aparece superpuesta dentro del lote.`);
                    }
                }
            }
        }

        return [...new Set(problemas)];
    }

    function actualizarDato(fila, valor) {
        const strong = fila?.querySelector("strong");
        if (!strong) return;
        strong.textContent = valor === null || valor === undefined || valor === "" ? "—" : String(valor);
    }

    function actualizarDomPagos(card, preview) {
        const pagos = reservasDesdePreview(preview).flatMap(entrada => pagosDeEntrada(entrada));
        const bloques = [...card.querySelectorAll(".haiku-asistente-preview-pago")]
            .filter(bloque => /pago/i.test(texto(bloque.querySelector(":scope > strong")?.textContent)));

        bloques.forEach((bloque, indice) => {
            const p = pagos[indice];
            if (!p) return;

            [...bloque.querySelectorAll(".haiku-asistente-preview-dato")].forEach(fila => {
                const etiqueta = clave(fila.querySelector("span")?.textContent);
                const mapa = {
                    "medio": p.medio,
                    "glosa": p.glosa,
                    "codaut": p.codaut,
                    "folio": p.folio,
                    "bovtar": p.bovtar
                };
                if (!(etiqueta in mapa)) return;
                const valor = mapa[etiqueta];
                if (valor === null || valor === undefined || valor === "") {
                    fila.remove();
                } else {
                    actualizarDato(fila, valor);
                }
            });
        });
    }

    function limpiarAdvertenciasPositivasDom(card) {
        [...card.querySelectorAll(".haiku-asistente-preview-lista--alerta")].forEach(bloque => {
            const items = [...bloque.querySelectorAll("li")];
            items.forEach(li => {
                if (advertenciaPositiva(li.textContent)) li.remove();
            });
            if (!bloque.querySelector("li")) bloque.remove();
        });
    }

    function agregarAdvertenciasNuevasDom(card, preview) {
        const advertencias = reservasDesdePreview(preview)
            .flatMap(entrada => Array.isArray(entrada?.advertencias) ? entrada.advertencias : [])
            .filter(item => !advertenciaPositiva(item));

        const existentes = new Set(
            [...card.querySelectorAll(".haiku-asistente-preview-lista--alerta li")]
                .map(li => clave(li.textContent))
        );
        const nuevas = advertencias.filter(item => !existentes.has(clave(item)));
        if (!nuevas.length) return;

        let bloque = card.querySelector(".haiku-asistente-preview-lista--alerta");
        if (!bloque) {
            bloque = document.createElement("div");
            bloque.className = "haiku-asistente-preview-lista haiku-asistente-preview-lista--alerta";
            const titulo = document.createElement("strong");
            titulo.textContent = "Revisar antes de continuar";
            const ul = document.createElement("ul");
            bloque.append(titulo, ul);
            const pie = card.querySelector(".haiku-asistente-preview-pie");
            pie ? card.insertBefore(bloque, pie) : card.appendChild(bloque);
        }

        const ul = bloque.querySelector("ul");
        nuevas.forEach(item => {
            const li = document.createElement("li");
            li.textContent = item;
            ul.appendChild(li);
        });
    }

    function actualizarBoton(card, preview) {
        const boton = card.querySelector(".haiku-asistente-preview-pie button");
        if (!boton) return;

        const reservas = reservasDesdePreview(preview);
        const cantidadPagos = reservas.reduce((n, entrada) => n + pagosDeEntrada(entrada).length, 0);
        const problemas = problemasPreview(preview);
        const tieneReserva = window.haikuTienePermiso?.("reservas.crear") === true;
        const tienePagos = cantidadPagos === 0 || (
            window.haikuTienePermiso?.("pagos.registrar") === true &&
            window.haikuTienePermiso?.("pagos.verificar") === true
        );
        const puede = problemas.length === 0 && tieneReserva && tienePagos;

        boton.disabled = !puede;
        if (problemas.length) boton.title = problemas.join(" ");
        else if (!tieneReserva) boton.title = "Tu usuario no tiene permiso para crear reservas.";
        else if (!tienePagos) boton.title = "Tu usuario no tiene permisos para registrar y verificar pagos.";
        else boton.removeAttribute("title");

        if (!puede) return;
        if (reservas.length > 1) {
            boton.textContent = `Confirmar ${reservas.length} reservas${cantidadPagos ? ` + ${cantidadPagos} ${cantidadPagos === 1 ? "abono" : "abonos"}` : ""}`;
        } else {
            boton.textContent = cantidadPagos
                ? `Confirmar reserva + ${cantidadPagos} ${cantidadPagos === 1 ? "abono" : "abonos"}`
                : "Confirmar y crear";
        }
    }

    function aplicar(card) {
        const preview = window.HAIKU_ASISTENTE?.ultimaPreview?.();
        if (!preview) return;

        normalizarPreview(preview);
        actualizarDomPagos(card, preview);
        limpiarAdvertenciasPositivasDom(card);
        agregarAdvertenciasNuevasDom(card, preview);
        actualizarBoton(card, preview);

        console.info("HAKU · Preview normalizada con reglas deterministicas de medios de pago.");
    }

    function prepararUnaVista() {
        const textoActual = texto(campo.value);
        if (window.HAIKU_ASISTENTE_ESTADOS_V1?.esComandoHospedar?.(textoActual)) return;

        let observador = null;
        observador = new MutationObserver(mutations => {
            let card = null;
            for (const mutation of mutations) {
                for (const nodo of mutation.addedNodes || []) {
                    if (!(nodo instanceof Element)) continue;
                    if (nodo.matches?.(".haiku-asistente-preview")) {
                        card = nodo;
                        break;
                    }
                    card = nodo.querySelector?.(".haiku-asistente-preview") || null;
                    if (card) break;
                }
                if (card) break;
            }

            if (!card) return;
            observador.disconnect();
            observador = null;
            aplicar(card);
        });

        observador.observe(mensajes, { childList: true });

        window.setTimeout(() => {
            if (!observador) return;
            observador.disconnect();
            observador = null;
        }, 30000);
    }

    enviar.addEventListener("click", prepararUnaVista);
    campo.addEventListener("keydown", evento => {
        if (!(evento.ctrlKey || evento.metaKey) || evento.key !== "Enter") return;
        prepararUnaVista();
    });

    window.HAIKU_ASISTENTE_NORMALIZACION_PAGOS_V1 = Object.freeze({
        normalizarPreview,
        problemasPreview
    });

    // El override del operador se carga DESPUÉS del normalizador para que
    // pueda apoyarse en sus reglas duras sin tocar el motor principal.
    if (!window.HAIKU_ASISTENTE_OVERRIDES_OPERADOR_V1 &&
        !document.querySelector('script[data-haku-overrides-operador-v1]')) {
        const scriptOverride = document.createElement("script");
        scriptOverride.dataset.hakuOverridesOperadorV1 = "1";
        const version = new URL(document.currentScript?.src || location.href).searchParams.get("v") || Date.now();
        scriptOverride.src = `js/supabase-asistente-overrides-operador-v1.js?v=${encodeURIComponent(version)}`;
        scriptOverride.async = false;
        document.head.appendChild(scriptOverride);
    }

    console.info("HAKU · Normalizacion deterministica de pagos V1 preparada.");
})();