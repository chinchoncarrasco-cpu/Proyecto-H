// ========================================
// HAIKU · EDITAR ABONO · DIFERENCIA A SALDO A FAVOR V1
// Complemento del editor: al aumentar un abono permite conservar
// la aplicación anterior y dejar el excedente como crédito.
// Debe cargarse ANTES de supabase-editar-abonos-v1.js.
// ========================================
(() => {
    "use strict";
    const sb = window.haikuSupabase;
    if (!sb) return;

    let contexto = null;
    let guardando = false;

    const money = v => `$${Math.round(Number(v || 0)).toLocaleString("es-CL")}`;
    function parseMoney(texto) {
        return Number(String(texto || "0").replace(/[^0-9-]/g, "")) || 0;
    }
    function fechaPagoISO(valor) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""))
            ? `${valor}T12:00:00.000Z`
            : "";
    }
    function valor(id) {
        return document.getElementById(id)?.value?.trim() || "";
    }
    function ponerEstado(texto, tipo = "") {
        const el = document.getElementById("haiku-pago-estado");
        if (!el) return;
        el.className = "haiku-pago-grupo-estado" + (tipo ? ` ${tipo}` : "");
        el.textContent = texto;
    }

    function solicitarValidacion() {
        queueMicrotask(() => window.HAIKU_EDITAR_ABONOS_V1?.validar?.());
    }

    function estadoValidacion() {
        const check = document.getElementById("haiku-edicion-saldo-favor-check");
        const activa = Boolean(contexto && check?.checked);
        if (!activa) return { activa: false, valida: false };

        const monto = Math.round(Number(valor("haiku-pago-monto") || 0));
        const medio = valor("haiku-pago-medio");
        const fecha = valor("haiku-pago-fecha");
        let valida = monto > Number(contexto.montoAnterior || 0) &&
            Boolean(medio) &&
            Boolean(fechaPagoISO(fecha));

        if (medio === "transferencia" && !valor("haiku-pago-glosa")) valida = false;
        if (["webpay_credito","webpay_debito"].includes(medio) &&
            !valor("haiku-pago-codaut")) valida = false;
        if (["tarjeta_credito","tarjeta_debito"].includes(medio) &&
            (!valor("haiku-pago-folio") || !valor("haiku-pago-bove"))) valida = false;
        if (!window.haikuTienePermiso?.("pagos.registrar") ||
            !window.haikuTienePermiso?.("pagos.anular")) valida = false;

        return { activa: true, valida };
    }

    function crearOpcion() {
        const aviso = document.getElementById("haiku-abono-edicion-aviso");
        if (!aviso || !contexto) return;
        if (document.getElementById("haiku-edicion-saldo-favor-wrap")) {
            actualizarOpcion();
            return;
        }

        const wrap = document.createElement("div");
        wrap.id = "haiku-edicion-saldo-favor-wrap";
        wrap.className = "haiku-edicion-saldo-favor-wrap";
        wrap.hidden = true;
        wrap.innerHTML = `
            <label>
                <input type="checkbox" id="haiku-edicion-saldo-favor-check">
                <span>
                    <strong>Dejar la diferencia como saldo a favor</strong>
                    <small>Conserva lo que ya estaba aplicado y deja el excedente disponible para tinajas, masajes, panes, huevos u otros servicios.</small>
                </span>
            </label>
            <div id="haiku-edicion-saldo-favor-preview"></div>`;

        aviso.insertAdjacentElement("afterend", wrap);
        wrap.querySelector("input")?.addEventListener("change", () => {
            actualizarPreview();
            solicitarValidacion();
        });
        actualizarOpcion();
    }

    function actualizarOpcion() {
        const wrap = document.getElementById("haiku-edicion-saldo-favor-wrap");
        if (!wrap || !contexto) return;
        const monto = Math.round(Number(valor("haiku-pago-monto") || 0));
        wrap.hidden = monto <= Number(contexto.montoAnterior || 0);
        if (wrap.hidden) {
            const check = document.getElementById("haiku-edicion-saldo-favor-check");
            if (check) check.checked = false;
        }
        actualizarPreview();
        solicitarValidacion();
    }

    function actualizarPreview() {
        const box = document.getElementById("haiku-edicion-saldo-favor-preview");
        const check = document.getElementById("haiku-edicion-saldo-favor-check");
        if (!box || !contexto || !check?.checked) {
            if (box) box.textContent = "";
            return;
        }
        const nuevo = Math.round(Number(valor("haiku-pago-monto") || 0));
        const diferencia = Math.max(0, nuevo - Number(contexto.montoAnterior || 0));
        box.innerHTML = `<strong>Referencia: +${money(diferencia)}</strong><span>La cifra definitiva de saldo a favor se calculará con las aplicaciones reales del pago anterior.</span>`;
    }

    function limpiar() {
        contexto = null;
        document.getElementById("haiku-edicion-saldo-favor-wrap")?.remove();
    }

    async function guardarConSaldoFavor() {
        if (guardando || !contexto) return;

        const monto = Math.round(Number(valor("haiku-pago-monto") || 0));
        const medio = valor("haiku-pago-medio");
        const fecha = fechaPagoISO(valor("haiku-pago-fecha"));
        const glosa = valor("haiku-pago-glosa");
        const codaut = valor("haiku-pago-codaut");
        const folio = valor("haiku-pago-folio");
        const bove = valor("haiku-pago-bove");
        const observacion = valor("haiku-pago-observacion");

        if (monto <= Number(contexto.montoAnterior || 0)) {
            return ponerEstado("Esta opción se usa sólo cuando aumentas el monto del abono.", "error");
        }
        if (!medio || !fecha) return ponerEstado("Completa medio de pago y fecha.", "error");
        if (medio === "transferencia" && !glosa) return ponerEstado("Transferencia requiere Glosa.", "error");
        if (["webpay_credito","webpay_debito"].includes(medio) && !codaut) return ponerEstado("WebPay requiere CodAut.", "error");
        if (["tarjeta_credito","tarjeta_debito"].includes(medio) && (!folio || !bove)) return ponerEstado("Pago con tarjeta requiere Folio y BOVTAR.", "error");
        if (!window.haikuTienePermiso?.("pagos.registrar") || !window.haikuTienePermiso?.("pagos.anular")) {
            return ponerEstado("Tu usuario no tiene permiso para corregir este abono.", "error");
        }

        guardando = true;
        const boton = document.getElementById("haiku-pago-confirmar");
        const texto = boton?.textContent || "Guardar corrección";
        if (boton) {
            boton.disabled = true;
            boton.textContent = "Guardando...";
        }
        ponerEstado("Corrigiendo abono y calculando saldo a favor...");

        try {
            const { data, error } = await sb.rpc("haiku_corregir_abono_saldo_favor", {
                p_pago_id: contexto.pagoId,
                p_monto: monto,
                p_medio_pago: medio,
                p_fecha_pago: fecha,
                p_folio: ["tarjeta_credito","tarjeta_debito"].includes(medio) ? (folio || null) : null,
                p_codigo_autorizacion: ["webpay_credito","webpay_debito"].includes(medio) ? (codaut || null) : null,
                p_bove: ["tarjeta_credito","tarjeta_debito"].includes(medio) ? (bove || null) : null,
                p_referencia_externa: medio === "transferencia" ? (glosa || null) : null,
                p_observaciones: observacion || null
            });
            if (error) throw error;

            const credito = Number(data?.saldo_a_favor_generado || 0);
            window.HAIKU_PAGOS_REFRESH_V1?.escrituraConfirmada("editar abono saldo a favor");
            window.HAIKU_EDITAR_ABONOS_V1?.cancelar?.({ limpiar: true });
            limpiar();

            await Promise.allSettled([
                window.HAIKU_EDITAR_ABONOS_V1?.refrescar?.(),
                window.haikuCargarAbonosSupabase?.(),
                window.haikuCargarSaldosCheckinSupabase?.(),
                window.haikuCargarCheckoutSupabase?.(),
                window.HAIKU_SALDO_FAVOR_V2?.refrescar?.()
            ]);

            document.getElementById("haiku-pago-reserva")?.dispatchEvent(
                new Event("change", { bubbles: true })
            );
            setTimeout(() => ponerEstado(
                `Corrección guardada · ${money(credito)} disponibles como saldo a favor.`,
                "exito"
            ), 300);
        } catch (error) {
            console.error("HAIKU · corrección con saldo a favor:", error);
            ponerEstado(error?.message || "No fue posible guardar la corrección.", "error");
        } finally {
            guardando = false;
            if (boton?.isConnected) {
                boton.textContent = texto;
            }
            solicitarValidacion();
        }
    }

    document.addEventListener("click", evento => {
        const editar = evento.target.closest?.("[data-haiku-editar-abono]");
        if (editar) {
            const item = editar.closest(".haiku-pago-grupo-historial-item");
            contexto = {
                pagoId: editar.dataset.haikuEditarAbono || "",
                montoAnterior: parseMoney(item?.querySelector(".haiku-pago-grupo-historial-monto")?.textContent)
            };
            setTimeout(crearOpcion, 30);
            setTimeout(crearOpcion, 120);
            return;
        }

        if (evento.target.closest?.("[data-haiku-cancelar-edicion]")) {
            setTimeout(limpiar, 0);
        }
    });

    document.addEventListener("input", evento => {
        if (evento.target.matches?.("#haiku-pago-monto") && contexto) {
            setTimeout(actualizarOpcion, 0);
        }
    });

    document.addEventListener("change", evento => {
        if (evento.target.matches?.("#haiku-pago-reserva") && contexto) {
            limpiar();
            solicitarValidacion();
        }
    });

    const style = document.createElement("style");
    style.id = "haiku-editar-abono-saldo-favor-v1-css";
    style.textContent = `
        .haiku-edicion-saldo-favor-wrap{margin:9px 0 12px;padding:10px 12px;border:1px solid #bfe0ca;border-radius:10px;background:#f3faf5;display:grid;gap:7px}
        .haiku-edicion-saldo-favor-wrap[hidden]{display:none!important}
        .haiku-edicion-saldo-favor-wrap label{display:flex;align-items:flex-start;gap:8px;cursor:pointer}
        .haiku-edicion-saldo-favor-wrap input{margin-top:2px}
        .haiku-edicion-saldo-favor-wrap label>span{display:grid;gap:2px}.haiku-edicion-saldo-favor-wrap strong{font-size:10px;color:#176b44}.haiku-edicion-saldo-favor-wrap small,.haiku-edicion-saldo-favor-wrap #haiku-edicion-saldo-favor-preview span{font-size:8.5px;color:#65756d;line-height:1.35}
        #haiku-edicion-saldo-favor-preview{display:grid;gap:2px;padding-left:22px}#haiku-edicion-saldo-favor-preview strong{font-size:9px}
    `;
    if (!document.getElementById(style.id)) document.head.appendChild(style);

    window.HAIKU_EDITAR_ABONO_SALDO_FAVOR_V1 = Object.freeze({
        estadoValidacion,
        guardar: guardarConSaldoFavor
    });

    console.info("HAIKU · Corrección de abono con saldo a favor preparada.");
})();
