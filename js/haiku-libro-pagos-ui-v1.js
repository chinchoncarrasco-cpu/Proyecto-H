// ========================================
// HAKU · LIBRO · UI DE PAGOS V1
// Enriquece solamente la presentación de pagos preparados / por revisar.
// No cambia selección, matching, validación ni escritura en Proyecto H.
// ========================================
(function (root) {
    "use strict";
    if (!root.document) return;

    const CACHE = new Map();
    let programado = false;
    let procesando = false;
    let restauracionScrollPendiente = null;

    function asegurarCss() {
        if (document.getElementById("haiku-libro-pagos-ui-v1-css")) return;
        const link = document.createElement("link");
        link.id = "haiku-libro-pagos-ui-v1-css";
        link.rel = "stylesheet";
        link.href = "css/haiku-libro-pagos-ui-v1.css?v=2";
        document.head.appendChild(link);
    }

    function normalizar(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function dineroNumero(valor) {
        const digitos = String(valor || "").replace(/[^0-9]/g, "");
        return digitos ? Number(digitos) : null;
    }

    function fechaIsoDesdeBreve(valor) {
        const texto = String(valor || "").trim();
        let m = texto.match(/^(\d{2})[\/-](\d{2})[\/-](\d{2})$/);
        if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
        m = texto.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;
        m = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    }

    function fechaVisual(valor) {
        const iso = String(valor || "").slice(0, 10);
        const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}-${m[2]}-${m[1].slice(2)}` : (valor ? String(valor) : "Sin dato");
    }

    function textoDato(card, etiqueta) {
        const objetivo = normalizar(etiqueta);
        const datos = Array.from(card.querySelectorAll(".haiku-incorporacion-meta-item > .haiku-incorporacion-dato"));
        const dato = datos.find(el => normalizar(el.querySelector("span")?.textContent) === objetivo);
        return dato?.querySelector("strong")?.textContent?.trim() || "";
    }

    function identidadCard(card) {
        const titular = card.querySelector(".haiku-incorporacion-identidad > strong")?.textContent?.trim() || "";
        const resumen = card.querySelector(".haiku-incorporacion-identidad > small")?.textContent || "";
        const cab = Number(resumen.match(/\bCAB\s*(\d{1,2})\b/i)?.[1]) || null;
        const monto = dineroNumero(resumen.match(/\$[\d.]+(?:\s*CLP)?/i)?.[0] || textoDato(card, "Monto"));
        const bloqueVisual = textoDato(card, "Bloque Check-In");
        const checkin = fechaIsoDesdeBreve(bloqueVisual);
        const concepto = textoDato(card, "Concepto");
        return { card, titular, cab, monto, bloqueVisual, checkin, concepto };
    }

    function capturarScroll(origen) {
        const estados = [];
        for (let nodo = origen?.parentElement; nodo; nodo = nodo.parentElement) {
            if (nodo.scrollHeight > nodo.clientHeight + 1 || nodo.scrollWidth > nodo.clientWidth + 1) {
                estados.push({ nodo, top: nodo.scrollTop, left: nodo.scrollLeft });
            }
        }
        const ventana = { x: root.scrollX || 0, y: root.scrollY || 0 };
        return () => {
            for (const estado of estados) {
                if (!estado.nodo?.isConnected) continue;
                estado.nodo.scrollTop = estado.top;
                estado.nodo.scrollLeft = estado.left;
            }
            root.scrollTo?.(ventana.x, ventana.y);
        };
    }

    function prepararFeedbackAprobacion(boton) {
        restauracionScrollPendiente = capturarScroll(boton);
        boton.setAttribute("aria-busy", "true");
        boton.textContent = boton.classList.contains("haiku-incorporacion-atajo--aprobar")
            ? "Aprobando pagos… ⏳"
            : "Aprobando… ⏳";
    }

    function restaurarScrollSiCorresponde() {
        if (!restauracionScrollPendiente) return;
        const vistaCompleta = document.querySelector(
            ".haiku-asistente-preview.haiku-incorporacion .haiku-incorporacion-seccion"
        );
        if (!vistaCompleta) return;
        const restaurar = restauracionScrollPendiente;
        restauracionScrollPendiente = null;
        requestAnimationFrame(() => requestAnimationFrame(restaurar));
    }

    const prefijosMes = [
        ["jan", "ene"], ["feb"], ["mar"], ["apr", "abr"], ["may"], ["jun"],
        ["jul"], ["aug", "ago"], ["sep"], ["oct"], ["nov"], ["dec", "dic"]
    ];

    function hojaParaFecha(api, iso) {
        const m = String(iso || "").match(/^(\d{4})-(\d{2})-/);
        if (!m) return null;
        const yy = m[1].slice(2);
        const indice = Number(m[2]) - 1;
        const prefijos = prefijosMes[indice] || [];
        return (api.listarHojas?.() || []).find(nombre => {
            const n = normalizar(nombre).replace(/\s/g, "");
            return prefijos.some(p => n === `${p}${yy}` || n.startsWith(`${p}${yy}`));
        }) || null;
    }

    async function leerHoja(api, hoja) {
        const generacion = api.estado?.().generacion ?? "?";
        const key = `${generacion}:${hoja}`;
        if (CACHE.has(key)) return CACHE.get(key);
        const promesa = api.consultarHoja(hoja).catch(error => {
            CACHE.delete(key);
            throw error;
        });
        CACHE.set(key, promesa);
        return promesa;
    }

    function pagosDeData(data) {
        const salida = [];
        for (const reserva of data?.reservas || []) {
            for (const pago of [...(reserva?.pagos || []), ...(reserva?.pagos_sin_asociacion || [])]) {
                salida.push({ reserva, pago, usado: false });
            }
        }
        return salida;
    }

    function coincideTitular(a, b) {
        const x = normalizar(a), y = normalizar(b);
        return Boolean(x && y && (x === y || x.includes(y) || y.includes(x)));
    }

    function elegirPago(info, candidatos) {
        const base = candidatos.filter(x => !x.usado &&
            coincideTitular(info.titular, x.reserva?.titular) &&
            (!info.cab || Number(x.reserva?.cabana) === Number(info.cab)) &&
            (!info.checkin || x.reserva?.fecha_checkin === info.checkin) &&
            (info.monto == null || Number(x.pago?.monto) === Number(info.monto))
        );
        if (!base.length) return null;

        const concepto = normalizar(info.concepto);
        base.sort((a, b) => {
            const ca = normalizar(a.pago?.concepto), cb = normalizar(b.pago?.concepto);
            const sa = concepto && ca === concepto ? 3 : concepto && (ca.includes(concepto) || concepto.includes(ca)) ? 2 : 0;
            const sb = concepto && cb === concepto ? 3 : concepto && (cb.includes(concepto) || concepto.includes(cb)) ? 2 : 0;
            return sb - sa;
        });
        base[0].usado = true;
        return base[0].pago;
    }

    function medioVisual(pago) {
        const medio = normalizar(pago?.medio_pago);
        const texto = normalizar(`${pago?.texto_original || ""} ${pago?.concepto || ""}`);
        if (/airbnb/.test(medio + " " + texto)) return { tipo: "airbnb", nombre: "Tarjeta AirBnb" };
        if (/transfer/.test(medio + " " + texto)) return { tipo: "transferencia", nombre: "Transferencia" };
        if (/efectivo/.test(medio + " " + texto)) return { tipo: "efectivo", nombre: "Efectivo" };

        const credito = /credito/.test(medio + " " + texto);
        const debito = /debito/.test(medio + " " + texto);
        const sufijo = credito ? "Crédito" : debito ? "Débito" : "Tarjeta";
        const voucher = Boolean(pago?.folio || pago?.bovtar);
        const webpay = !voucher && Boolean(pago?.codigo_autorizacion || /webpay|web pay/.test(texto));
        if (voucher) return { tipo: "tarjeta", nombre: `Tarjeta ${sufijo}`.replace("Tarjeta Tarjeta", "Tarjeta") };
        if (webpay || /webpay/.test(medio)) return { tipo: "webpay", nombre: `WebPay ${sufijo}`.replace("WebPay Tarjeta", "WebPay") };
        if (credito || debito) return { tipo: "tarjeta", nombre: `Tarjeta ${sufijo}` };
        return { tipo: "otro", nombre: pago?.medio_pago ? String(pago.medio_pago).replaceAll("_", " ") : "Sin dato" };
    }

    function segundoDato(pago, medio, conceptoFallback) {
        if (medio.tipo === "transferencia") {
            return { etiqueta: "Glosa", valor: pago?.referencia_externa || pago?.texto_original || "Sin dato", largo: true };
        }
        if (medio.tipo === "webpay") {
            return { etiqueta: "CodAut", valor: pago?.codigo_autorizacion || "Sin dato" };
        }
        if (medio.tipo === "tarjeta") {
            const partes = [];
            if (pago?.folio) partes.push(`Folio ${pago.folio}`);
            if (pago?.bovtar) partes.push(`Autorización ${pago.bovtar}`);
            if (!partes.length && pago?.codigo_autorizacion) partes.push(`Autorización ${pago.codigo_autorizacion}`);
            return { etiqueta: "Folio / Autorización", valor: partes.join(" · ") || "Sin dato" };
        }
        if (medio.tipo === "efectivo") {
            return { etiqueta: "Concepto", valor: pago?.concepto || conceptoFallback || "Sin dato" };
        }
        if (medio.tipo === "airbnb") {
            return { etiqueta: "Detalle", valor: pago?.texto_original || pago?.concepto || "Datos del pago AirBnb", largo: true };
        }
        const identificador = pago?.codigo_autorizacion || pago?.bovtar || pago?.folio || pago?.concepto || pago?.texto_original;
        return { etiqueta: "Detalle", valor: identificador || "Sin dato", largo: true };
    }

    function crearDato(etiqueta, valor, largo = false) {
        const dato = document.createElement("div");
        dato.className = `haiku-incorporacion-dato${largo ? " haiku-pago-dato-largo" : ""}`;
        const span = document.createElement("span");
        const strong = document.createElement("strong");
        span.textContent = etiqueta;
        strong.textContent = valor || "Sin dato";
        if (largo) strong.title = valor || "";
        dato.append(span, strong);
        return dato;
    }

    function aplicarPago(info, pago) {
        const card = info.card;
        if (!card || card.dataset.haikuPagoUiV1 === "1") return;
        const meta = card.querySelector(".haiku-incorporacion-meta-item");
        if (!meta || !pago) return;

        const medio = medioVisual(pago);
        const detalle = segundoDato(pago, medio, info.concepto);
        const fecha = pago?.fecha_comprobante || pago?.fecha_pago || null;
        meta.classList.add("haiku-incorporacion-meta-item--pago-detalle");
        meta.replaceChildren(
            crearDato("Medio", medio.nombre),
            crearDato(detalle.etiqueta, detalle.valor, detalle.largo),
            crearDato("Fecha pago", fechaVisual(fecha))
        );

        const small = card.querySelector(".haiku-incorporacion-identidad > small");
        if (small && info.bloqueVisual && !/check-?in/i.test(small.textContent || "")) {
            small.append(document.createTextNode(` · Check-in ${info.bloqueVisual}`));
            small.classList.add("haiku-pago-checkin-cabecera");
        }

        // La capa de deduplicación usa este origen sólo para comparar, nunca para escribir.
        // Hoja + celda permanecen estables aunque cambie la representación semántica del pago.
        card.dataset.haikuPagoOrigenHoja = pago?.origen?.hoja || "";
        card.dataset.haikuPagoOrigenCelda = pago?.origen?.celda || "";
        card.dataset.haikuPagoLibroTexto = pago?.texto_original || "";
        card.dataset.haikuPagoUiV1 = "1";
    }

    async function mejorarPagos() {
        if (procesando) return;
        procesando = true;
        try {
            const api = root.HAIKU_LIBRO_RESERVA_V1;
            if (!api?.consultarHoja || !api?.listarHojas) return;
            const cards = Array.from(document.querySelectorAll(
                ".haiku-asistente-preview.haiku-incorporacion .haiku-incorporacion-item--pagos:not([data-haiku-pago-ui-v1])," +
                ".haiku-asistente-preview.haiku-incorporacion .haiku-incorporacion-item--dudosos:not([data-haiku-pago-ui-v1])"
            ));
            if (!cards.length) return;

            const infos = cards.map(identidadCard).filter(x => x.checkin && x.titular && x.monto != null);
            const porHoja = new Map();
            for (const info of infos) {
                const hoja = hojaParaFecha(api, info.checkin);
                if (!hoja) continue;
                if (!porHoja.has(hoja)) porHoja.set(hoja, []);
                porHoja.get(hoja).push(info);
            }

            for (const [hoja, items] of porHoja) {
                let data;
                try { data = await leerHoja(api, hoja); }
                catch (_) { continue; }
                const candidatos = pagosDeData(data);
                for (const info of items) {
                    const pago = elegirPago(info, candidatos);
                    if (pago) aplicarPago(info, pago);
                }
            }
        } finally {
            procesando = false;
        }
    }

    function programar() {
        if (programado) return;
        programado = true;
        requestAnimationFrame(() => {
            programado = false;
            mejorarPagos().catch(() => {});
        });
    }

    asegurarCss();
    document.addEventListener("click", event => {
        const botonAprobar = event.target?.closest?.(
            ".haiku-incorporacion-aprobar, .haiku-incorporacion-atajo--aprobar"
        );
        if (botonAprobar) prepararFeedbackAprobacion(botonAprobar);
        if (event.target?.closest?.("button.libro-reserva-boton, .haiku-asistente-preview details > summary")) {
            setTimeout(programar, 0);
        }
    }, true);
    window.addEventListener("haiku:libro-cambio", () => {
        CACHE.clear();
        restauracionScrollPendiente = null;
    });

    const observer = new MutationObserver(mutations => {
        if (mutations.some(m => m.addedNodes?.length)) {
            programar();
            restaurarScrollSiCorresponde();
        }
    });
    const iniciar = () => {
        observer.observe(document.body, { childList: true, subtree: true });
        programar();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    else iniciar();
})(typeof window !== "undefined" ? window : globalThis);