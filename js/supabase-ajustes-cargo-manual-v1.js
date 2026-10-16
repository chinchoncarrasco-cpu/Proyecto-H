// ========================================
// HAIKU · AJUSTES DE CARGO · MONTO 10% MANUAL V1
// Permite reemplazar el 10% sugerido por el monto correcto de la reserva anterior.
// IVA extranjero conserva su cálculo automático.
// ========================================
(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const TIPOS_MANUALES = new Set(["cargo_cancelacion", "cargo_modificacion"]);
    let instalando = false;
    let guardando = false;
    let manualTocado = false;
    let observer = null;

    const dinero = valor => `$${Math.round(Number(valor || 0)).toLocaleString("es-CL")}`;

    function numeroDinero(texto) {
        const limpio = String(texto || "").replace(/[^0-9-]/g, "");
        return Math.max(0, Math.round(Number(limpio || 0)));
    }

    function tipoActivo() {
        return document.querySelector("#haiku-ajuste-cargo-overlay [data-haiku-ajuste-tipo].activa")?.dataset?.haikuAjusteTipo || "";
    }

    function esTipoManual() {
        return TIPOS_MANUALES.has(tipoActivo());
    }

    function elementos() {
        return {
            overlay: document.getElementById("haiku-ajuste-cargo-overlay"),
            wrap: document.getElementById("haiku-ajuste-cargo-resumen-wrap"),
            impacto: document.getElementById("haiku-ajuste-impacto"),
            nota: document.getElementById("haiku-ajuste-nota"),
            estado: document.getElementById("haiku-ajuste-estado"),
            confirmar: document.getElementById("haiku-ajuste-confirmar"),
            reserva: document.getElementById("haiku-ajuste-reserva"),
            observacion: document.getElementById("haiku-ajuste-observacion"),
            manual: document.getElementById("haiku-ajuste-monto-manual"),
            ayuda: document.getElementById("haiku-ajuste-monto-manual-ayuda")
        };
    }

    function crearCampo() {
        const wrap = document.getElementById("haiku-ajuste-cargo-resumen-wrap");
        const impacto = document.getElementById("haiku-ajuste-impacto");
        if (!wrap || !impacto || document.getElementById("haiku-ajuste-manual-wrap")) return;

        const bloque = document.createElement("div");
        bloque.id = "haiku-ajuste-manual-wrap";
        bloque.className = "haiku-ajuste-manual-wrap";
        bloque.hidden = true;
        bloque.innerHTML = `
            <label class="haiku-ajuste-cargo-label" for="haiku-ajuste-monto-manual">Monto del cargo 10% <span>(editable)</span></label>
            <div class="haiku-ajuste-manual-input-wrap">
                <span>$</span>
                <input id="haiku-ajuste-monto-manual" type="number" min="1" step="1000" inputmode="numeric" placeholder="0">
            </div>
            <small id="haiku-ajuste-monto-manual-ayuda"></small>`;

        wrap.insertBefore(bloque, impacto);

        bloque.querySelector("#haiku-ajuste-monto-manual")?.addEventListener("input", () => {
            manualTocado = true;
            actualizarVistaManual();
        });
    }

    function crearEstilos() {
        if (document.getElementById("haiku-ajuste-manual-estilos")) return;
        const estilo = document.createElement("style");
        estilo.id = "haiku-ajuste-manual-estilos";
        estilo.textContent = `
            .haiku-ajuste-manual-wrap{margin-top:10px;padding:11px 12px;border:1px solid #dfe6e1;border-radius:10px;background:#fff}
            .haiku-ajuste-manual-wrap[hidden]{display:none!important}
            .haiku-ajuste-manual-wrap .haiku-ajuste-cargo-label{margin-bottom:6px}
            .haiku-ajuste-manual-wrap .haiku-ajuste-cargo-label span{font-weight:600;text-transform:none;letter-spacing:0;color:#89928d}
            .haiku-ajuste-manual-input-wrap{display:flex;align-items:center;min-height:42px;border:1px solid #dce3df;border-radius:9px;background:#fff;overflow:hidden}
            .haiku-ajuste-manual-input-wrap:focus-within{border-color:#6ea58a;box-shadow:0 0 0 3px rgba(47,118,83,.08)}
            .haiku-ajuste-manual-input-wrap>span{padding-left:12px;color:#66736c;font-size:13px;font-weight:700}
            .haiku-ajuste-manual-input-wrap input{width:100%;height:40px;box-sizing:border-box;border:0;background:transparent;padding:0 11px 0 5px;color:#202723;font:inherit;font-size:13px;font-weight:700;outline:none}
            .haiku-ajuste-manual-wrap small{display:block;margin-top:6px;color:#758079;font-size:9px;line-height:1.4}
        `;
        document.head.appendChild(estilo);
    }

    function sugeridoAutomatico() {
        return Math.round(numeroDinero(document.getElementById("haiku-ajuste-total-original")?.textContent) * 0.10);
    }

    function totalActual() {
        return numeroDinero(document.getElementById("haiku-ajuste-total-actual")?.textContent);
    }

    function montoManual() {
        return Math.round(Number(document.getElementById("haiku-ajuste-monto-manual")?.value || 0));
    }

    function resetManual() {
        manualTocado = false;
        const { manual, ayuda } = elementos();
        if (manual) manual.value = "";
        if (ayuda) ayuda.textContent = "";
    }

    function actualizarVistaManual() {
        const { wrap, impacto, nota, estado, confirmar, reserva, manual, ayuda } = elementos();
        const bloque = document.getElementById("haiku-ajuste-manual-wrap");
        if (!bloque) return;

        const mostrar = esTipoManual() && Boolean(reserva?.value) && wrap && !wrap.hidden;
        bloque.hidden = !mostrar;
        if (!mostrar) return;

        const sugerido = sugeridoAutomatico();
        const montoLibro = numeroDinero(document.getElementById('haiku-ajuste-cargo-overlay')?.dataset?.haikuLibroMonto);
        if (!manualTocado && manual && (montoLibro > 0 || sugerido > 0)) {
            manual.value = String(montoLibro > 0 ? montoLibro : sugerido);
        }

        const monto = montoManual();
        const actual = totalActual();
        const nuevoTotal = actual + monto;

        if (ayuda) {
            ayuda.textContent = montoLibro > 0
                ? `Importe indicado en el Libro: ${dinero(montoLibro)}. Sugerencia del 10% del alojamiento actual: ${dinero(sugerido)}. Confirma motivo e importe antes de aplicar.`
                : monto > 0
                    ? `Sugerencia automática: ${dinero(sugerido)}. El monto ingresado equivale al 10% de una base anterior de ${dinero(monto * 10)}.`
                    : `Sugerencia automática: ${dinero(sugerido)}. Ingresa el 10% correcto de la reserva anterior.`;
        }

        if (impacto) {
            impacto.innerHTML = `Cargo a añadir: <strong>${dinero(monto)}</strong> · Nuevo total: <strong>${dinero(nuevoTotal)}</strong>`;
        }

        if (nota) {
            const vinculo = document.getElementById("haiku-ajuste-vinculo")?.textContent || "";
            nota.textContent = `El valor automático es sólo una referencia. Puedes reemplazarlo por el 10% de la reserva anterior.${vinculo ? " Haiku lo aplicará una sola vez al conjunto y lo distribuirá internamente entre las cabañas vinculadas." : ""}`;
        }

        if (confirmar) {
            const hayError = estado?.classList.contains("error") === true;
            confirmar.disabled = guardando || monto <= 0 || hayError;
        }
    }

    function programarActualizacion(ms = 0) {
        setTimeout(() => {
            crearCampo();
            actualizarVistaManual();
        }, ms);
    }

    async function aplicarManual(evento) {
        if (!esTipoManual()) return;

        const { overlay, confirmar, reserva, observacion, estado } = elementos();
        if (!overlay || overlay.hidden || !confirmar || !reserva?.value) return;

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();

        if (guardando) return;

        const monto = montoManual();
        const tipo = tipoActivo();
        if (monto <= 0) {
            if (estado) {
                estado.className = "haiku-ajuste-cargo-estado error";
                estado.textContent = "Ingresa un monto válido para el cargo 10%.";
            }
            return;
        }

        const actual = totalActual();
        const nuevo = actual + monto;
        const titulo = tipo === "cargo_cancelacion" ? "Cargo 10% · Cancelación" : "Cargo 10% · Modificación";
        const vinculo = document.getElementById("haiku-ajuste-vinculo")?.textContent?.replace(/^↳\s*/, "") || "";
        const destino = vinculo ? `\n${vinculo}` : "";

        if (!window.confirm(`¿Aplicar ${titulo}?${destino}\n\nSe añadirán ${dinero(monto)} y el nuevo total será ${dinero(nuevo)}.`)) return;

        guardando = true;
        overlay.dataset.haikuAjusteManualGuardando = "1";
        confirmar.disabled = true;
        confirmar.textContent = "Aplicando...";
        if (estado) {
            estado.className = "haiku-ajuste-cargo-estado";
            estado.textContent = "Guardando ajuste en Supabase...";
        }

        try {
            const { data, error } = await cliente.rpc("haiku_aplicar_ajuste_unidad_manual", {
                p_reserva_id: reserva.value,
                p_tipo_ajuste: tipo,
                p_monto_ajuste: monto,
                p_observaciones: observacion?.value || null
            });
            if (error) throw error;

            if (estado) {
                estado.className = "haiku-ajuste-cargo-estado exito";
                estado.textContent = `✓ Cargo aplicado. Se añadieron ${dinero(Number(data?.monto_ajuste || monto))}${vinculo ? " al total conjunto" : ""}.`;
            }

            // Sólo tras confirmar Supabase: revalidar la tarjeta del Libro.
            // Este evento no registra ni aprueba pagos.
            if (overlay.dataset.haikuLibroMonto &&
                typeof window.CustomEvent === 'function' && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new window.CustomEvent('haiku:libro-penalidad-registrada',{
                    detail:{reservaId:reserva.value,monto:Number(data?.monto_ajuste || monto)}
                }));
            }

            await Promise.allSettled([
                Promise.resolve().then(() => window.HAIKU_AJUSTES_CARGO_V2?.refrescar?.()),
                Promise.resolve().then(() => window.haikuCargarAbonosSupabase?.()),
                Promise.resolve().then(() => window.haikuCargarSaldosCheckinSupabase?.()),
                Promise.resolve().then(() => window.HAIKU_PAGO_GRUPO_V1?.refrescarFicha?.())
            ]);

            setTimeout(() => {
                overlay.hidden = true;
                document.body.style.overflow = "";
                delete overlay.dataset.haikuAjusteManualGuardando;
                guardando = false;
                confirmar.textContent = "Aplicar ajuste";
                resetManual();
            }, 650);
        } catch (error) {
            console.error("HAIKU · cargo 10% manual:", error);
            guardando = false;
            delete overlay.dataset.haikuAjusteManualGuardando;
            confirmar.textContent = "Aplicar ajuste";
            if (estado) {
                estado.className = "haiku-ajuste-cargo-estado error";
                estado.textContent = error?.message || "No fue posible aplicar el cargo manual.";
            }
            actualizarVistaManual();
        }
    }

    function instalarObserver() {
        const original = document.getElementById("haiku-ajuste-total-original");
        const wrap = document.getElementById("haiku-ajuste-cargo-resumen-wrap");
        if (!original || !wrap || observer) return;

        observer = new MutationObserver(() => programarActualizacion(0));
        observer.observe(original, { childList: true, characterData: true, subtree: true });
        observer.observe(wrap, { attributes: true, attributeFilter: ["hidden"] });
    }

    function instalar() {
        if (instalando) return;
        instalando = true;
        crearEstilos();
        crearCampo();
        instalarObserver();
        instalando = false;
    }

    document.addEventListener("click", evento => {
        if (evento.target.closest?.("#haiku-ajuste-confirmar") && esTipoManual()) {
            aplicarManual(evento);
            return;
        }

        if (evento.target.closest?.("[data-haiku-ajuste-cerrar]") && guardando) {
            evento.preventDefault();
            evento.stopPropagation();
            evento.stopImmediatePropagation();
        }
    }, true);

    document.addEventListener("click", evento => {
        const tipo = evento.target.closest?.("[data-haiku-ajuste-tipo]");
        if (tipo) {
            manualTocado = false;
            setTimeout(() => {
                const manual = document.getElementById("haiku-ajuste-monto-manual");
                if (manual) manual.value = "";
                actualizarVistaManual();
            }, 0);
        }

        if (evento.target.closest?.(".haiku-ajuste-cargo-boton")) {
            resetManual();
            programarActualizacion(80);
        }
    });

    document.addEventListener("change", evento => {
        if (evento.target.matches?.("#haiku-ajuste-reserva")) {
            resetManual();
            programarActualizacion(180);
        }
    });

    window.addEventListener("haiku:auth-ready", () => setTimeout(instalar, 180));
    window.addEventListener("load", () => setTimeout(instalar, 260));
    setTimeout(instalar, 340);

    window.HAIKU_AJUSTE_CARGO_MANUAL_V1 = Object.freeze({
        actualizar: actualizarVistaManual
    });

    console.info("HAIKU · Monto manual para cargos 10% V1 preparado.");
})();