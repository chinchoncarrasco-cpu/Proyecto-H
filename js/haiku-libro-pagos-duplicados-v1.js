// ========================================
// HAKU · LIBRO · DEDUPLICACIÓN CONSERVADORA DE PAGOS V1
//
// Evita que un pago ya existente en Proyecto H pueda aprobarse/incorporarse
// sólo porque el movimiento del Libro no trae un identificador fuerte.
//
// Coincidencias automáticas permitidas:
// 1) CodAut exacto.
// 2) Folio + Autorización/BOVTAR exactos.
// 3) Glosa/referencia externa exacta dentro de la misma reserva y monto.
// 4) Transferencia sin identificador: misma reserva + monto + medio + fecha,
//    únicamente cuando la cardinalidad permite una correspondencia 1 a 1.
//
// Esta capa NO escribe en Supabase. Sólo deselecciona y bloquea en la vista
// previa movimientos que ya están representados por un pago existente.
// ========================================
(function (root) {
    "use strict";
    if (!root.document) return;

    let cache = null;
    let cargando = null;
    let programado = false;
    let procesando = false;

    function normalizar(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function canonId(valor) {
        return String(valor || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    }

    function dinero(valor) {
        const digitos = String(valor || "").replace(/[^0-9]/g, "");
        return digitos ? Number(digitos) : null;
    }

    function fechaIso(valor) {
        const texto = String(valor || "").trim();
        let m = texto.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{2})$/);
        if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
        m = texto.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/);
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;
        m = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    }

    function canonMedio(valor) {
        const n = normalizar(valor);
        if (/transfer/.test(n)) return "transferencia";
        if (/efectivo/.test(n)) return "efectivo";
        if (/debito/.test(n)) return "debito";
        if (/credito/.test(n)) return "credito";
        if (/airbnb/.test(n)) return "airbnb";
        return n || "otro";
    }

    function textoDato(card, etiqueta) {
        const objetivo = normalizar(etiqueta);
        const datos = Array.from(card.querySelectorAll(".haiku-incorporacion-meta-item .haiku-incorporacion-dato"));
        const dato = datos.find(el => normalizar(el.querySelector("span")?.textContent) === objetivo);
        return dato?.querySelector("strong")?.textContent?.trim() || "";
    }

    function infoCard(card) {
        const titular = card.querySelector(".haiku-incorporacion-identidad > strong")?.textContent?.trim() || "";
        const resumen = card.querySelector(".haiku-incorporacion-identidad > small")?.textContent || "";
        const cabana = Number(resumen.match(/\bCAB\s*(\d{1,2})\b/i)?.[1]) || null;
        const monto = dinero(resumen.match(/\$[\d.]+(?:\s*CLP)?/i)?.[0] || textoDato(card, "Monto"));
        const checkin = fechaIso(resumen.match(/Check-?in\s+([^·]+)/i)?.[1] || textoDato(card, "Bloque Check-In"));
        const medioTexto = textoDato(card, "Medio");
        const fechaPago = fechaIso(textoDato(card, "Fecha pago"));
        const glosa = textoDato(card, "Glosa") || textoDato(card, "Detalle");
        const codAut = textoDato(card, "CodAut");
        const folioAut = textoDato(card, "Folio / Autorización");
        const folio = folioAut.match(/Folio\s*[:#-]?\s*([a-z0-9]+)/i)?.[1] || "";
        const autorizacion = folioAut.match(/(?:Autorizaci[oó]n|BOVTAR)\s*[:#-]?\s*([a-z0-9]+)/i)?.[1] || "";
        return {
            card, titular, cabana, monto, checkin,
            medio: canonMedio(medioTexto), medioTexto,
            fechaPago, glosa, codAut, folio, autorizacion,
            reservaId: null
        };
    }

    function asegurarCss() {
        if (document.getElementById("haiku-pagos-duplicados-v1-css")) return;
        const style = document.createElement("style");
        style.id = "haiku-pagos-duplicados-v1-css";
        style.textContent = `
            .haiku-incorporacion-item.haiku-pago-ya-existe {
                border-color: #b9d9c7 !important;
                background: #f4faf6 !important;
            }
            .haiku-pago-ya-existe .haiku-incorporacion-estado {
                background: #e3f3e8 !important;
                color: #205c38 !important;
                border-color: #c5e3d0 !important;
                opacity: 1 !important;
            }
            .haiku-pago-ya-existe .haiku-incorporacion-seleccion input[type="checkbox"] {
                opacity: .55 !important;
                cursor: not-allowed;
            }
            .haiku-pago-duplicado-aviso {
                margin: 8px 0 0;
                padding: 8px 10px;
                border: 1px solid #cfe5d7;
                border-radius: 9px;
                background: #edf8f1;
                color: #28553a;
                font-size: .68rem;
                line-height: 1.4;
            }
        `;
        document.head.appendChild(style);
    }

    async function cargarSnapshot() {
        if (cache) return cache;
        if (cargando) return cargando;
        cargando = (async () => {
            const cliente = root.haikuSupabase;
            if (!cliente?.from) throw new Error("Sin conexión con Proyecto H");
            const [estRes, pagRes] = await Promise.all([
                cliente.from("reserva_estadias")
                    .select("reserva_id,fecha_ingreso,cabanas(numero),reservas(titular_nombre)")
                    .range(0, 1999),
                cliente.from("pagos")
                    .select("id,reserva_id,monto,medio_pago,fecha_pago,folio,codigo_autorizacion,bove,referencia_externa,datos_origen")
                    .range(0, 2999)
            ]);
            if (estRes.error || pagRes.error) throw estRes.error || pagRes.error;
            cache = {
                estadias: Array.isArray(estRes.data) ? estRes.data : [],
                pagos: Array.isArray(pagRes.data) ? pagRes.data : []
            };
            return cache;
        })().finally(() => { cargando = null; });
        return cargando;
    }

    function resolverReserva(info, estadias) {
        if (!info.titular || !info.cabana || !info.checkin) return null;
        const nombre = normalizar(info.titular);
        const candidatas = estadias.filter(e => {
            const titular = normalizar(e.reservas?.titular_nombre);
            return titular === nombre &&
                Number(e.cabanas?.numero) === Number(info.cabana) &&
                String(e.fecha_ingreso || "").slice(0, 10) === info.checkin;
        });
        const ids = [...new Set(candidatas.map(e => e.reserva_id).filter(Boolean))];
        return ids.length === 1 ? ids[0] : null;
    }

    function medioExistente(pago) {
        return canonMedio(pago?.medio_pago);
    }

    function referenciaExacta(info, pago) {
        const a = normalizar(info.glosa);
        const b = normalizar(pago?.referencia_externa);
        return Boolean(a && b && a === b && a.length >= 12);
    }

    function identificadorExacto(info, pago) {
        const cod = canonId(info.codAut);
        if (cod && canonId(pago?.codigo_autorizacion) === cod) return true;
        const folio = canonId(info.folio), autorizacion = canonId(info.autorizacion);
        if (folio && autorizacion) {
            const existenteAut = canonId(pago?.datos_origen?.bovtar || pago?.bove);
            return canonId(pago?.folio) === folio && existenteAut === autorizacion;
        }
        return false;
    }

    function origenLibroExacto(info, pago) {
        // La UI visual no expone hoja/celda directamente, pero los pagos que Haku
        // ya incorporó conservan una referencia completa. Si la glosa es idéntica,
        // esa referencia es suficiente y se resuelve en referenciaExacta().
        // Este helper queda preparado para futuras tarjetas que expongan origen.
        const hoja = info.card.dataset.haikuPagoOrigenHoja || "";
        const celda = info.card.dataset.haikuPagoOrigenCelda || "";
        if (!hoja || !celda) return false;
        const origen = pago?.datos_origen?.origen_libro || pago?.datos_origen?.origen || {};
        if (normalizar(origen.hoja) === normalizar(hoja) && normalizar(origen.celda) === normalizar(celda)) return true;
        const itemId = String(pago?.datos_origen?.item_id || "");
        return itemId.includes(`${hoja}!${celda}`);
    }

    function marcarYaExiste(info, pago, razon) {
        const card = info.card;
        if (!card || card.classList.contains("haiku-pago-ya-existe")) return;
        const check = card.querySelector('.haiku-incorporacion-seleccion input[type="checkbox"]');
        if (check) {
            if (check.checked) {
                check.checked = false;
                check.dispatchEvent(new Event("change", { bubbles: true }));
            }
            check.disabled = true;
        }
        card.classList.remove("haiku-pago-omitido-sesion");
        card.classList.add("haiku-pago-ya-existe");
        card.dataset.haikuPagoDuplicadoId = pago?.id || "";

        const estado = card.querySelector(".haiku-incorporacion-estado");
        if (estado) {
            estado.dataset.haikuEstadoOriginal = "Ya existe";
            estado.textContent = "Ya existe";
            estado.setAttribute("title", "Este pago ya está registrado en Proyecto H");
        }

        const aprobar = card.querySelector(".haiku-incorporacion-aprobar");
        if (aprobar) {
            aprobar.disabled = true;
            aprobar.textContent = "Ya existe en Proyecto H";
        }

        const propuesta = card.querySelector(".haiku-incorporacion-propuesta");
        if (propuesta) propuesta.textContent = "Este pago ya está registrado en Proyecto H y no se incorporará nuevamente.";

        if (!card.querySelector(".haiku-pago-duplicado-aviso")) {
            const aviso = document.createElement("p");
            aviso.className = "haiku-pago-duplicado-aviso";
            aviso.textContent = `✓ Coincidencia segura: ${razon}. Haku lo dejó fuera para evitar un duplicado.`;
            const ancla = card.querySelector(".haiku-incorporacion-avisos") || propuesta;
            if (ancla) ancla.insertAdjacentElement("afterend", aviso);
            else card.append(aviso);
        }
    }

    function bloquearAprobacionesMientrasRevisa(cards) {
        for (const card of cards) {
            const boton = card.querySelector(".haiku-incorporacion-aprobar");
            if (!boton || boton.dataset.haikuDedupeChecking === "1") continue;
            boton.dataset.haikuDedupeChecking = "1";
            boton.dataset.haikuDedupePrevDisabled = boton.disabled ? "1" : "0";
            boton.disabled = true;
        }
    }

    function restaurarAprobaciones(cards) {
        for (const card of cards) {
            const boton = card.querySelector(".haiku-incorporacion-aprobar[data-haiku-dedupe-checking='1']");
            if (!boton) continue;
            if (!card.classList.contains("haiku-pago-ya-existe") && boton.dataset.haikuDedupePrevDisabled !== "1") boton.disabled = false;
            delete boton.dataset.haikuDedupeChecking;
            delete boton.dataset.haikuDedupePrevDisabled;
        }
    }

    async function revisar() {
        if (procesando) return;
        const cards = Array.from(document.querySelectorAll(
            ".haiku-asistente-preview.haiku-incorporacion .haiku-incorporacion-item--pagos," +
            ".haiku-asistente-preview.haiku-incorporacion .haiku-incorporacion-item--dudosos"
        )).filter(card => !card.classList.contains("haiku-pago-ya-existe"));
        if (!cards.length) return;

        // Esperar a que la capa visual haya reemplazado Monto/Concepto por
        // Medio/identificador/Fecha pago. Así el matching usa datos visibles.
        const infos = cards.map(infoCard).filter(i => i.medioTexto && i.fechaPago && i.monto != null);
        if (!infos.length) return;

        procesando = true;
        bloquearAprobacionesMientrasRevisa(cards);
        try {
            const snapshot = await cargarSnapshot();
            for (const info of infos) info.reservaId = resolverReserva(info, snapshot.estadias);

            const consumidos = new Set();
            const pendientesTransferencia = [];

            // Primera pasada: identificador, origen o glosa exacta.
            for (const info of infos) {
                if (!info.reservaId) continue;
                const candidatos = snapshot.pagos.filter(p =>
                    !consumidos.has(p.id) && p.reserva_id === info.reservaId && Number(p.monto) === Number(info.monto)
                );
                const duros = candidatos.filter(p =>
                    identificadorExacto(info, p) || origenLibroExacto(info, p) || referenciaExacta(info, p)
                );
                if (duros.length === 1) {
                    const pago = duros[0];
                    consumidos.add(pago.id);
                    const razon = identificadorExacto(info, pago) ? "coinciden los identificadores del comprobante" :
                        origenLibroExacto(info, pago) ? "coinciden la hoja y celda de origen del Libro" :
                        "coinciden la misma reserva, monto y glosa del movimiento";
                    marcarYaExiste(info, pago, razon);
                } else if (info.medio === "transferencia") {
                    pendientesTransferencia.push(info);
                }
            }

            // Segunda pasada: transferencias históricas sin identificador/glosa
            // persistida. Sólo se resuelven cuando reserva+monto+medio+fecha tiene
            // cardinalidad suficiente para una asignación 1 a 1.
            const grupos = new Map();
            for (const info of pendientesTransferencia.filter(i => !i.card.classList.contains("haiku-pago-ya-existe") && i.reservaId)) {
                const key = `${info.reservaId}|${info.monto}|${info.fechaPago}|transferencia`;
                if (!grupos.has(key)) grupos.set(key, []);
                grupos.get(key).push(info);
            }
            for (const [key, grupo] of grupos) {
                const [reservaId, montoTexto, fecha] = key.split("|");
                const monto = Number(montoTexto);
                const candidatos = snapshot.pagos.filter(p =>
                    !consumidos.has(p.id) && p.reserva_id === reservaId && Number(p.monto) === monto &&
                    medioExistente(p) === "transferencia" && String(p.fecha_pago || "").slice(0, 10) === fecha
                );
                if (!candidatos.length || candidatos.length < grupo.length) continue;
                grupo.forEach((info, indice) => {
                    const pago = candidatos[indice];
                    if (!pago) return;
                    consumidos.add(pago.id);
                    marcarYaExiste(info, pago, "coinciden reserva, monto, transferencia y fecha de pago");
                });
            }
        } catch (error) {
            console.warn("HAKU · No se pudo completar la deduplicación conservadora de pagos:", error?.message || error);
        } finally {
            restaurarAprobaciones(cards);
            procesando = false;
        }
    }

    function programar() {
        if (programado) return;
        programado = true;
        requestAnimationFrame(() => {
            programado = false;
            revisar().catch(() => {});
        });
    }

    asegurarCss();

    const observer = new MutationObserver(mutations => {
        if (mutations.some(m => m.addedNodes?.length)) {
            cache = null; // una revalidación puede haber cambiado Proyecto H
            programar();
            setTimeout(programar, 120);
        }
    });

    function iniciar() {
        observer.observe(document.body, { childList: true, subtree: true });
        programar();
        setTimeout(programar, 150);
        setTimeout(programar, 500);
    }

    root.addEventListener("haiku:libro-cambio", () => {
        cache = null;
        programar();
    });
    document.addEventListener("click", event => {
        if (event.target?.closest?.(".haiku-asistente-preview details > summary, button.libro-reserva-boton, .haiku-incorporacion-aprobar")) {
            setTimeout(programar, 80);
        }
    }, true);

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    else iniciar();
})(typeof window !== "undefined" ? window : globalThis);
