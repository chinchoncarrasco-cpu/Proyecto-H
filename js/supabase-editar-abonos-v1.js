// ========================================
// HAIKU · EDITAR ABONOS · V1
// Corrección contable segura: anula el movimiento anterior y crea su reemplazo.
// Funciona también con pagos distribuidos internamente en reservas conjuntas.
// ========================================
(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const MEDIOS_UI = Object.freeze({
        transferencia: "Transferencia",
        webpay_credito: "WebPay Crédito",
        webpay_debito: "WebPay Débito",
        tarjeta_credito: "Tarjeta Crédito",
        tarjeta_debito: "Tarjeta Débito",
        efectivo: "Efectivo",
        otro: "Otro"
    });

    let renderizando = false;
    let guardando = false;
    let timer = 0;
    let edicionActual = null;
    let cache = new Map();
    let observer = null;

    const dinero = valor => `$${Math.round(Number(valor || 0)).toLocaleString("es-CL")}`;

    function escapar(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function puedeEditar() {
        if (typeof window.haikuTienePermiso !== "function") return false;
        return window.haikuTienePermiso("pagos.registrar") &&
            window.haikuTienePermiso("pagos.anular");
    }

    function fechaCorta(valor) {
        if (!valor) return "Sin fecha";
        try {
            return new Intl.DateTimeFormat("es-CL", {
                timeZone: "America/Santiago",
                day: "2-digit",
                month: "2-digit",
                year: "numeric"
            }).format(new Date(valor));
        } catch {
            return String(valor).slice(0, 10);
        }
    }

    function fechaInput(valor) {
        return String(valor || "").slice(0, 10);
    }

    function fechaPagoISO(valor) {
        const fecha = String(valor || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return "";
        return `${fecha}T12:00:00.000Z`;
    }

    function montoTexto(id) {
        const texto = document.getElementById(id)?.textContent || "0";
        return Number(texto.replace(/[^0-9-]/g, "")) || 0;
    }

    function ponerEstado(texto = "", tipo = "") {
        const el = document.getElementById("haiku-pago-estado");
        if (!el) return;
        el.className = "haiku-pago-grupo-estado" + (tipo ? ` ${tipo}` : "");
        el.textContent = texto;
    }

    function limpiarObservacion(valor) {
        const texto = String(valor || "").trim();
        if (texto === "Pago conjunto") return "";
        return texto.replace(/\s*·\s*Pago conjunto\s*$/i, "").trim();
    }

    async function idsReservaSeleccionada() {
        const reservaId = document.getElementById("haiku-pago-reserva")?.value || "";
        if (!reservaId) return [];

        const { data: reserva, error } = await cliente
            .from("reservas")
            .select("id,grupo_reserva_id")
            .eq("id", reservaId)
            .maybeSingle();

        if (error) throw error;
        if (!reserva) return [];
        if (!reserva.grupo_reserva_id) return [String(reserva.id)];

        const { data: miembros, error: eMiembros } = await cliente
            .from("reservas")
            .select("id")
            .eq("grupo_reserva_id", reserva.grupo_reserva_id);

        if (eMiembros) throw eMiembros;
        return [...new Set((miembros || []).map(r => String(r.id)).filter(Boolean))];
    }

    function agruparPagos(filas) {
        const mapa = new Map();

        (filas || []).forEach(pago => {
            const grupoId = pago.pago_grupo_id ? String(pago.pago_grupo_id) : "";
            const clave = grupoId ? `grupo:${grupoId}` : `pago:${pago.id}`;

            if (!mapa.has(clave)) {
                mapa.set(clave, {
                    clave,
                    representanteId: String(pago.id),
                    pagoGrupoId: grupoId,
                    fecha_pago: pago.fecha_pago || "",
                    medio_pago: pago.medio_pago || "",
                    monto: 0,
                    referencia_externa: pago.referencia_externa || "",
                    folio: pago.folio || "",
                    codigo_autorizacion: pago.codigo_autorizacion || "",
                    bove: pago.bove || "",
                    observaciones: limpiarObservacion(pago.observaciones || "")
                });
            }

            const item = mapa.get(clave);
            item.monto += Number(pago.monto || 0);

            if (!item.referencia_externa && pago.referencia_externa) {
                item.referencia_externa = pago.referencia_externa;
            }
            if (!item.folio && pago.folio) item.folio = pago.folio;
            if (!item.codigo_autorizacion && pago.codigo_autorizacion) {
                item.codigo_autorizacion = pago.codigo_autorizacion;
            }
            if (!item.bove && pago.bove) item.bove = pago.bove;
            if (!item.observaciones && pago.observaciones) {
                item.observaciones = limpiarObservacion(pago.observaciones);
            }
        });

        return [...mapa.values()].sort((a,b) =>
            String(a.fecha_pago || "").localeCompare(String(b.fecha_pago || "")) ||
            a.representanteId.localeCompare(b.representanteId)
        );
    }

    function render(items) {
        const bloque = document.getElementById("haiku-pago-historial");
        const lista = document.getElementById("haiku-pago-historial-lista");
        const contador = document.getElementById("haiku-pago-historial-contador");
        if (!bloque || !lista || !contador) return;

        cache = new Map(items.map(item => [item.representanteId, item]));
        bloque.hidden = false;
        contador.textContent = items.length === 1 ? "1 pago" : `${items.length} pagos`;

        if (!items.length) {
            lista.innerHTML = `<div class="haiku-pago-grupo-historial-vacio">Aún no hay abonos registrados.</div>`;
            return;
        }

        lista.innerHTML = items.map(item => {
            const detalles = [];
            if (item.referencia_externa) detalles.push(`Glosa: ${escapar(item.referencia_externa)}`);
            if (item.folio) detalles.push(`Folio: ${escapar(item.folio)}`);
            if (item.codigo_autorizacion) detalles.push(`CodAut: ${escapar(item.codigo_autorizacion)}`);

            return `
                <div class="haiku-pago-grupo-historial-item haiku-abono-editable">
                    <div class="haiku-pago-grupo-historial-principal">
                        <span>${escapar(fechaCorta(item.fecha_pago))}</span>
                        <strong>${escapar(MEDIOS_UI[item.medio_pago] || item.medio_pago || "Sin medio")}</strong>
                    </div>
                    <div class="haiku-abono-item-acciones">
                        <strong class="haiku-pago-grupo-historial-monto">${dinero(item.monto)}</strong>
                        <button type="button" class="haiku-abono-editar-boton" data-haiku-editar-abono="${escapar(item.representanteId)}" aria-label="Editar abono">✎ Editar</button>
                    </div>
                    ${detalles.length ? `<small>${detalles.join(" · ")}</small>` : ""}
                </div>`;
        }).join("");
    }

    async function refrescarHistorial() {
        if (renderizando || !puedeEditar()) return;
        const select = document.getElementById("haiku-pago-reserva");
        const lista = document.getElementById("haiku-pago-historial-lista");
        if (!select?.value || !lista) return;

        renderizando = true;
        try {
            const ids = await idsReservaSeleccionada();
            if (!ids.length) return;

            const { data, error } = await cliente
                .from("pagos")
                .select("id,reserva_id,pago_grupo_id,monto,medio_pago,fecha_pago,folio,codigo_autorizacion,bove,referencia_externa,observaciones")
                .in("reserva_id", ids)
                .eq("tipo_movimiento", "pago")
                .eq("etapa_operativa", "abono")
                .eq("estado", "confirmado")
                .order("fecha_pago", { ascending: true });

            if (error) throw error;
            render(agruparPagos(data || []));
        } catch (error) {
            console.warn("HAIKU · historial editable de abonos:", error);
        } finally {
            renderizando = false;
        }
    }

    function programar(ms = 80) {
        clearTimeout(timer);
        timer = setTimeout(refrescarHistorial, ms);
    }

    function crearAvisoEdicion(item) {
        document.getElementById("haiku-abono-edicion-aviso")?.remove();
        const historial = document.getElementById("haiku-pago-historial");
        if (!historial) return;

        const aviso = document.createElement("div");
        aviso.id = "haiku-abono-edicion-aviso";
        aviso.className = "haiku-abono-edicion-aviso";
        aviso.innerHTML = `
            <div>
                <strong>Corrigiendo abono de ${dinero(item.monto)}</strong>
                <span>Al guardar, el registro anterior quedará anulado y se conservará como respaldo.</span>
            </div>
            <button type="button" data-haiku-cancelar-edicion>Cancelar edición</button>`;
        historial.insertAdjacentElement("afterend", aviso);
    }

    function iniciarEdicion(pagoId) {
        const item = cache.get(String(pagoId || ""));
        if (!item || !puedeEditar()) return;

        edicionActual = item;
        crearAvisoEdicion(item);

        const fecha = document.getElementById("haiku-pago-fecha");
        const monto = document.getElementById("haiku-pago-monto");
        const medio = document.getElementById("haiku-pago-medio");
        const glosa = document.getElementById("haiku-pago-glosa");
        const codaut = document.getElementById("haiku-pago-codaut");
        const folio = document.getElementById("haiku-pago-folio");
        const bove = document.getElementById("haiku-pago-bove");
        const observacion = document.getElementById("haiku-pago-observacion");
        const confirmar = document.getElementById("haiku-pago-confirmar");

        if (fecha) fecha.value = fechaInput(item.fecha_pago);
        if (monto) {
            monto.disabled = false;
            monto.value = String(Math.round(Number(item.monto || 0)));
            monto.max = String(Math.max(0, montoTexto("haiku-pago-saldo") + Number(item.monto || 0)));
        }
        if (medio) {
            medio.value = item.medio_pago || "";
            medio.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (glosa) glosa.value = item.referencia_externa || "";
        if (codaut) codaut.value = item.codigo_autorizacion || "";
        if (folio) folio.value = item.folio || "";
        if (bove) bove.value = item.bove || "";
        if (observacion) observacion.value = item.observaciones || "";
        if (confirmar) confirmar.textContent = "Guardar corrección";

        ponerEstado("Modo corrección activo. Puedes cambiar monto, fecha, medio de pago y sus datos.");
        validarEdicion();

        fecha?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }

    function cancelarEdicion({ limpiar = true } = {}) {
        if (!edicionActual && !document.getElementById("haiku-abono-edicion-aviso")) return;

        edicionActual = null;
        document.getElementById("haiku-abono-edicion-aviso")?.remove();

        const confirmar = document.getElementById("haiku-pago-confirmar");
        const monto = document.getElementById("haiku-pago-monto");
        const medio = document.getElementById("haiku-pago-medio");

        if (confirmar) confirmar.textContent = "Registrar pago";

        if (limpiar) {
            ["haiku-pago-monto","haiku-pago-glosa","haiku-pago-codaut","haiku-pago-folio","haiku-pago-bove","haiku-pago-observacion"]
                .forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = "";
                });
            if (medio) {
                medio.value = "";
                medio.dispatchEvent(new Event("change", { bubbles: true }));
            }
        }

        if (monto) {
            monto.max = String(Math.max(0, montoTexto("haiku-pago-saldo")));
            monto.disabled = montoTexto("haiku-pago-saldo") <= 0;
        }

        ponerEstado("");
    }

    function validarEdicion() {
        if (!edicionActual) return;
        const confirmar = document.getElementById("haiku-pago-confirmar");
        if (!confirmar) return;

        const montoInput = document.getElementById("haiku-pago-monto");
        const monto = Math.round(Number(montoInput?.value || 0));
        const medio = document.getElementById("haiku-pago-medio")?.value || "";
        const fecha = document.getElementById("haiku-pago-fecha")?.value || "";
        const maximo = montoTexto("haiku-pago-saldo") + Number(edicionActual.monto || 0);
        const especial = window.HAIKU_EDITAR_ABONO_SALDO_FAVOR_V1?.estadoValidacion?.();

        let habilitado;
        if (especial?.activa) {
            // El editor principal sigue siendo el único dueño de `disabled`.
            // En modo saldo a favor se retira solamente el tope contable antiguo.
            montoInput?.removeAttribute("max");
            if (montoInput) montoInput.disabled = false;
            habilitado = !guardando && especial.valida;
        } else {
            if (montoInput) montoInput.max = String(Math.max(0, maximo));
            habilitado = !guardando &&
                monto > 0 &&
                monto <= maximo &&
                Boolean(medio) &&
                Boolean(fechaPagoISO(fecha));
        }

        confirmar.disabled = !habilitado;
        confirmar.setAttribute("aria-disabled", habilitado ? "false" : "true");
        confirmar.title = especial?.activa
            ? (habilitado
                ? "Guardar corrección y dejar el excedente como saldo a favor"
                : "Completa los datos requeridos del pago")
            : "";
        confirmar.textContent = guardando ? "Guardando..." : "Guardar corrección";
    }

    function datosFormulario() {
        const valor = id => document.getElementById(id)?.value?.trim() || "";
        const medio = document.getElementById("haiku-pago-medio")?.value || "";
        const datos = {
            monto: Math.round(Number(document.getElementById("haiku-pago-monto")?.value || 0)),
            medio,
            fecha: fechaPagoISO(document.getElementById("haiku-pago-fecha")?.value || ""),
            glosa: valor("haiku-pago-glosa"),
            codaut: valor("haiku-pago-codaut"),
            folio: valor("haiku-pago-folio"),
            bove: valor("haiku-pago-bove"),
            observacion: valor("haiku-pago-observacion")
        };

        if (medio === "transferencia" && !datos.glosa) {
            throw new Error("Ingresa la glosa de la transferencia.");
        }
        if (["webpay_credito","webpay_debito"].includes(medio) && !datos.codaut) {
            throw new Error("Ingresa el CodAut de WebPay.");
        }
        if (["tarjeta_credito","tarjeta_debito"].includes(medio) && (!datos.folio || !datos.bove)) {
            throw new Error("Ingresa Folio y BOVTAR.");
        }

        return datos;
    }

    async function guardarCorreccion() {
        if (!edicionActual || guardando) return;
        if (!puedeEditar()) {
            alert("Tu usuario no tiene permiso para corregir pagos.");
            return;
        }

        let datos;
        try {
            datos = datosFormulario();
            const maximo = montoTexto("haiku-pago-saldo") + Number(edicionActual.monto || 0);
            if (datos.monto <= 0 || datos.monto > maximo || !datos.medio || !datos.fecha) {
                throw new Error("Revisa el monto, la fecha y el medio de pago.");
            }
        } catch (error) {
            ponerEstado(error?.message || "Revisa los datos de la corrección.", "error");
            return;
        }

        guardando = true;
        const anterior = Number(edicionActual.monto || 0);
        validarEdicion();
        ponerEstado("Guardando corrección...");

        try {
            const { data, error } = await cliente.rpc("haiku_corregir_abono", {
                p_pago_id: edicionActual.representanteId,
                p_monto: datos.monto,
                p_medio_pago: datos.medio,
                p_fecha_pago: datos.fecha,
                p_folio: ["tarjeta_credito","tarjeta_debito"].includes(datos.medio) ? (datos.folio || null) : null,
                p_codigo_autorizacion: ["webpay_credito","webpay_debito","tarjeta_credito","tarjeta_debito"].includes(datos.medio) ? (datos.codaut || null) : null,
                p_bove: ["tarjeta_credito","tarjeta_debito"].includes(datos.medio) ? (datos.bove || null) : null,
                p_referencia_externa: datos.medio === "transferencia" ? (datos.glosa || null) : null,
                p_observaciones: datos.observacion || null
            });

            if (error) throw error;

            edicionActual = null;
            window.HAIKU_PAGOS_REFRESH_V1?.escrituraConfirmada("editar abono");
            document.getElementById("haiku-abono-edicion-aviso")?.remove();
            const confirmar = document.getElementById("haiku-pago-confirmar");
            if (confirmar) confirmar.textContent = "Registrar pago";

            await Promise.allSettled([
                Promise.resolve().then(() => window.haikuCargarAbonosSupabase?.()),
                Promise.resolve().then(() => window.haikuCargarSaldosCheckinSupabase?.()),
                Promise.resolve().then(() => window.haikuSincronizarReservasSupabase?.())
            ]);

            const select = document.getElementById("haiku-pago-reserva");
            if (select?.value) {
                select.dispatchEvent(new Event("change", { bubbles: true }));
            }

            setTimeout(() => {
                ponerEstado(`Abono corregido: ${dinero(anterior)} → ${dinero(datos.monto)}.`, "exito");
                programar(30);
            }, 450);

            return data;
        } catch (error) {
            console.error("HAIKU · corregir abono:", error);
            ponerEstado(error?.message || "No fue posible corregir el abono.", "error");
        } finally {
            guardando = false;
            validarEdicion();
        }
    }

    function instalarObserver() {
        const lista = document.getElementById("haiku-pago-historial-lista");
        if (!lista || lista.dataset.haikuEditarObserver === "1") return false;
        lista.dataset.haikuEditarObserver = "1";

        observer = new MutationObserver(() => {
            if (renderizando || !puedeEditar()) return;
            if (lista.querySelector("[data-haiku-editar-abono]")) return;
            programar(60);
        });
        observer.observe(lista, { childList: true, subtree: true });
        return true;
    }

    function instalar() {
        instalarObserver();
        if (document.getElementById("haiku-pago-reserva")?.value) programar(120);
    }

    document.addEventListener("click", evento => {
        const editar = evento.target.closest?.("[data-haiku-editar-abono]");
        if (editar) {
            evento.preventDefault();
            evento.stopPropagation();
            iniciarEdicion(editar.dataset.haikuEditarAbono || "");
            return;
        }

        if (evento.target.closest?.("[data-haiku-cancelar-edicion]")) {
            evento.preventDefault();
            cancelarEdicion();
        }
    });

    document.addEventListener("click", evento => {
        if (!edicionActual) return;
        const confirmar = evento.target.closest?.("#haiku-pago-confirmar");
        if (!confirmar) return;

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();

        const especial = window.HAIKU_EDITAR_ABONO_SALDO_FAVOR_V1;
        if (especial?.estadoValidacion?.().activa) {
            especial.guardar?.();
            return;
        }

        guardarCorreccion();
    }, true);

    document.addEventListener("input", evento => {
        if (!edicionActual) return;
        if (evento.target.matches?.("#haiku-pago-monto,#haiku-pago-glosa,#haiku-pago-codaut,#haiku-pago-folio,#haiku-pago-bove,#haiku-pago-observacion")) {
            queueMicrotask(validarEdicion);
        }
    });

    document.addEventListener("change", evento => {
        if (evento.target.matches?.("#haiku-pago-reserva")) {
            cancelarEdicion({ limpiar: false });
            setTimeout(() => {
                instalarObserver();
                programar(80);
            }, 120);
            return;
        }

        if (edicionActual && evento.target.matches?.("#haiku-pago-medio,#haiku-pago-fecha")) {
            queueMicrotask(validarEdicion);
        }
    });

    const estilo = document.createElement("style");
    estilo.textContent = `
        .haiku-abono-item-acciones{display:flex;align-items:center;gap:8px;justify-content:flex-end}
        .haiku-abono-editar-boton{appearance:none;border:1px solid #d8e2dc;background:#fff;color:#37634d;border-radius:7px;padding:5px 8px;font:inherit;font-size:9px;font-weight:700;cursor:pointer;white-space:nowrap}
        .haiku-abono-editar-boton:hover{background:#f2f8f4;border-color:#b9d1c2}
        .haiku-abono-edicion-aviso{margin:-4px 0 14px;padding:10px 11px;border:1px solid #d7e5dc;border-radius:10px;background:#f6faf7;display:flex;align-items:center;justify-content:space-between;gap:12px}
        .haiku-abono-edicion-aviso>div{display:grid;gap:3px;min-width:0}.haiku-abono-edicion-aviso strong{font-size:10px;color:#285d43}.haiku-abono-edicion-aviso span{font-size:9px;color:#6f7a73;line-height:1.35}
        .haiku-abono-edicion-aviso button{appearance:none;border:1px solid #d5dfd9;background:#fff;color:#56635c;border-radius:7px;padding:6px 8px;font:inherit;font-size:9px;font-weight:700;cursor:pointer;white-space:nowrap}
        @media(max-width:700px){.haiku-abono-item-acciones{gap:5px}.haiku-abono-editar-boton{padding:5px 7px}.haiku-abono-edicion-aviso{align-items:flex-start;flex-direction:column}.haiku-abono-edicion-aviso button{width:100%}}
    `;
    document.head.appendChild(estilo);

    window.addEventListener("haiku:auth-ready", () => setTimeout(instalar, 260));
    window.addEventListener("load", () => setTimeout(instalar, 360));
    setTimeout(instalar, 500);

    window.HAIKU_EDITAR_ABONOS_V1 = Object.freeze({
        refrescar: refrescarHistorial,
        cancelar: cancelarEdicion,
        validar: validarEdicion
    });

    console.info("HAIKU · Edición segura de abonos V1 preparada.");
})();
