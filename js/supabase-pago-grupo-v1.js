// ========================================
// HAIKU · PAGO POR TITULAR / RESERVA CONJUNTA · V2
// Permite registrar múltiples abonos sin cerrar el modal.
// Cada pago conserva su fecha real y aparece en un historial compacto.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let guardando = false;
    let resumenActual = null;
    let reservaSeleccionada = "";
    let secuenciaFicha = 0;

    const MEDIOS_UI = Object.freeze({
        transferencia: "Transferencia",
        webpay_credito: "WebPay Crédito",
        webpay_debito: "WebPay Débito",
        tarjeta_credito: "Tarjeta Crédito",
        tarjeta_debito: "Tarjeta Débito",
        efectivo: "Efectivo",
        otro: "Otro"
    });
    const MEDIOS_DESDE_UI = Object.freeze(Object.fromEntries(
        Object.entries(MEDIOS_UI).map(([codigo, etiqueta]) => [etiqueta, codigo])
    ));

    const dinero = valor => `$${Math.round(Number(valor || 0)).toLocaleString("es-CL")}`;

    function fechaActual() {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    }

    function hoyChile() {
        try {
            const partes = new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Santiago",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).formatToParts(new Date());
            const mapa = Object.fromEntries(partes.map(p => [p.type, p.value]));
            return `${mapa.year}-${mapa.month}-${mapa.day}`;
        } catch {
            return new Date().toISOString().slice(0, 10);
        }
    }

    function fechaPagoISO(valor) {
        const fecha = String(valor || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return "";
        return `${fecha}T12:00:00.000Z`;
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

    function escapar(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function crearBoton() {
        const cabecera = document.querySelector("#seccion-pagos .cabecera");
        if (!cabecera || cabecera.querySelector(".haiku-anadir-pago-boton")) return;

        const boton = document.createElement("button");
        boton.type = "button";
        boton.className = "haiku-anadir-pago-boton";
        boton.textContent = "Añadir pago";
        boton.addEventListener("click", abrirModal);

        const ajustar = cabecera.querySelector(".haiku-ajuste-cargo-boton");
        ajustar ? cabecera.insertBefore(boton, ajustar) : cabecera.appendChild(boton);
    }

    function crearModal() {
        if (document.getElementById("haiku-pago-grupo-overlay")) return;

        const overlay = document.createElement("div");
        overlay.id = "haiku-pago-grupo-overlay";
        overlay.className = "haiku-pago-grupo-overlay";
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="haiku-pago-grupo-modal" role="dialog" aria-modal="true" aria-labelledby="haiku-pago-grupo-titulo">
                <div class="haiku-pago-grupo-cabecera">
                    <div>
                        <small>Control financiero</small>
                        <h3 id="haiku-pago-grupo-titulo">Añadir pago</h3>
                    </div>
                    <button type="button" class="haiku-pago-grupo-cerrar" data-haiku-pago-cerrar aria-label="Cerrar">×</button>
                </div>

                <div class="haiku-pago-grupo-cuerpo">
                    <div class="haiku-pago-grupo-campo">
                        <label for="haiku-pago-reserva">Titular / reserva</label>
                        <select id="haiku-pago-reserva" class="haiku-pago-grupo-select">
                            <option value="">Seleccionar...</option>
                        </select>
                    </div>

                    <div id="haiku-pago-vinculo" class="haiku-pago-grupo-vinculo" hidden></div>

                    <div id="haiku-pago-resumen" class="haiku-pago-grupo-resumen" hidden>
                        <div><span>Total alojamiento</span><strong id="haiku-pago-total">$0</strong></div>
                        <div><span>Abonado</span><strong id="haiku-pago-abonado">$0</strong></div>
                        <div class="saldo"><span>Saldo</span><strong id="haiku-pago-saldo">$0</strong></div>
                    </div>

                    <div id="haiku-pago-historial" class="haiku-pago-grupo-historial" hidden>
                        <div class="haiku-pago-grupo-historial-cabecera">
                            <span>Abonos registrados</span>
                            <strong id="haiku-pago-historial-contador">0 pagos</strong>
                        </div>
                        <div id="haiku-pago-historial-lista" class="haiku-pago-grupo-historial-lista"></div>
                    </div>

                    <div class="haiku-pago-grupo-grid">
                        <div class="haiku-pago-grupo-campo">
                            <label for="haiku-pago-fecha">Fecha del pago</label>
                            <input id="haiku-pago-fecha" class="haiku-pago-grupo-input" type="date">
                        </div>

                        <div class="haiku-pago-grupo-campo">
                            <label for="haiku-pago-monto">Monto de este pago</label>
                            <input id="haiku-pago-monto" class="haiku-pago-grupo-input" type="number" min="1" step="1" inputmode="numeric" placeholder="0">
                        </div>
                    </div>

                    <div class="haiku-pago-grupo-campo">
                        <label for="haiku-pago-medio">Medio de pago</label>
                        <select id="haiku-pago-medio" class="haiku-pago-grupo-select">
                            <option value="">Seleccionar...</option>
                            <option value="transferencia">Transferencia</option>
                            <option value="webpay_credito">WebPay Crédito</option>
                            <option value="webpay_debito">WebPay Débito</option>
                            <option value="tarjeta_credito">Tarjeta Crédito</option>
                            <option value="tarjeta_debito">Tarjeta Débito</option>
                            <option value="efectivo">Efectivo</option>
                            <option value="otro">Otro</option>
                        </select>
                    </div>

                    <div class="haiku-pago-grupo-grid">
                        <div class="haiku-pago-grupo-campo haiku-pago-grupo-extra" data-extra="glosa" hidden>
                            <label for="haiku-pago-glosa">Glosa</label>
                            <input id="haiku-pago-glosa" class="haiku-pago-grupo-input" type="text" placeholder="Pegar glosa bancaria">
                        </div>
                        <div class="haiku-pago-grupo-campo haiku-pago-grupo-extra" data-extra="codaut" hidden>
                            <label for="haiku-pago-codaut">CodAut</label>
                            <input id="haiku-pago-codaut" class="haiku-pago-grupo-input" type="text" placeholder="Código autorización">
                        </div>
                        <div class="haiku-pago-grupo-campo haiku-pago-grupo-extra" data-extra="folio" hidden>
                            <label for="haiku-pago-folio">Folio</label>
                            <input id="haiku-pago-folio" class="haiku-pago-grupo-input" type="text" placeholder="Folio de transacción">
                        </div>
                        <div class="haiku-pago-grupo-campo haiku-pago-grupo-extra" data-extra="bove" hidden>
                            <label for="haiku-pago-bove">BOVTAR</label>
                            <input id="haiku-pago-bove" class="haiku-pago-grupo-input" type="text" placeholder="Código BOVTAR">
                        </div>
                    </div>

                    <div class="haiku-pago-grupo-campo">
                        <label for="haiku-pago-observacion">Nota opcional</label>
                        <textarea id="haiku-pago-observacion" class="haiku-pago-grupo-textarea" placeholder="Ej: Abono recibido por titular..."></textarea>
                    </div>

                    <div id="haiku-pago-estado" class="haiku-pago-grupo-estado" aria-live="polite"></div>

                    <div class="haiku-pago-grupo-acciones">
                        <button type="button" class="haiku-pago-grupo-cancelar" data-haiku-pago-cerrar>Cerrar</button>
                        <button type="button" id="haiku-pago-confirmar" class="haiku-pago-grupo-confirmar" disabled>Registrar pago</button>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        overlay.addEventListener("click", evento => {
            if (evento.target === overlay) cerrarModal();
        });

        overlay.querySelectorAll("[data-haiku-pago-cerrar]")
            .forEach(b => b.addEventListener("click", cerrarModal));

        overlay.querySelector("#haiku-pago-reserva")?.addEventListener("change", async evento => {
            reservaSeleccionada = evento.target.value || "";
            await cargarResumenSeleccionado(false);
        });

        overlay.querySelector("#haiku-pago-medio")?.addEventListener("change", actualizarExtras);
        overlay.querySelector("#haiku-pago-monto")?.addEventListener("input", validarFormulario);
        overlay.querySelector("#haiku-pago-fecha")?.addEventListener("change", validarFormulario);
        overlay.querySelector("#haiku-pago-confirmar")?.addEventListener("click", registrarPago);
    }

    function estado(texto = "", tipo = "") {
        const el = document.getElementById("haiku-pago-estado");
        if (!el) return;
        el.className = "haiku-pago-grupo-estado" + (tipo ? ` ${tipo}` : "");
        el.textContent = texto;
    }

    function limpiarCamposPago({ conservarFecha = true, conservarMedio = true } = {}) {
        ["haiku-pago-monto","haiku-pago-glosa","haiku-pago-codaut","haiku-pago-folio","haiku-pago-bove","haiku-pago-observacion"]
            .forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = "";
            });

        if (!conservarFecha) {
            const fecha = document.getElementById("haiku-pago-fecha");
            if (fecha) fecha.value = hoyChile();
        }

        if (!conservarMedio) {
            const medio = document.getElementById("haiku-pago-medio");
            if (medio) medio.value = "";
            actualizarExtras();
        }
    }

    function resetModal() {
        reservaSeleccionada = "";
        resumenActual = null;
        guardando = false;

        limpiarCamposPago({ conservarFecha: false, conservarMedio: false });

        const reserva = document.getElementById("haiku-pago-reserva");
        if (reserva) reserva.value = "";

        const resumen = document.getElementById("haiku-pago-resumen");
        if (resumen) resumen.hidden = true;

        const vinculo = document.getElementById("haiku-pago-vinculo");
        if (vinculo) {
            vinculo.hidden = true;
            vinculo.textContent = "";
        }

        const historial = document.getElementById("haiku-pago-historial");
        if (historial) historial.hidden = true;

        const lista = document.getElementById("haiku-pago-historial-lista");
        if (lista) lista.innerHTML = "";

        document.querySelectorAll(".haiku-pago-grupo-extra").forEach(el => el.hidden = true);

        const confirmar = document.getElementById("haiku-pago-confirmar");
        if (confirmar) {
            confirmar.disabled = true;
            confirmar.textContent = "Registrar pago";
        }

        const monto = document.getElementById("haiku-pago-monto");
        if (monto) {
            monto.disabled = false;
            monto.removeAttribute("max");
        }

        estado("");
    }

    async function obtenerReservasDia() {
        const fecha = fechaActual();
        if (!fecha) return [];

        const { data, error } = await cliente.rpc("haiku_operacion_dia", { p_fecha: fecha });
        if (error) throw error;

        const base = new Map();

        const agregar = (numero, reservaId, titular, contexto) => {
            if (!reservaId || base.has(String(reservaId))) return;
            base.set(String(reservaId), {
                reservaId: String(reservaId),
                numero: Number(numero || 0),
                titular: titular || "Sin titular",
                contexto: contexto || ""
            });
        };

        (data || []).forEach(fila => {
            agregar(fila.numero, fila.ingreso_reserva_id, fila.ingreso_titular, "Ingresa");
            agregar(fila.numero, fila.continua_reserva_id, fila.continua_titular, "Continúa");
            agregar(fila.numero, fila.salida_reserva_id, fila.salida_titular, "Sale");
            agregar(fila.numero, fila.fullday_reserva_id, fila.fullday_titular, "Full Day");
        });

        const items = [...base.values()];
        if (!items.length) return [];

        const { data: reservas, error: eReservas } = await cliente
            .from("reservas")
            .select("id,grupo_reserva_id,titular_nombre")
            .in("id", items.map(i => i.reservaId));

        if (eReservas) throw eReservas;

        const meta = new Map((reservas || []).map(r => [String(r.id), r]));
        const grupos = new Map();

        items.forEach(item => {
            const r = meta.get(item.reservaId) || {};
            const key = r.grupo_reserva_id ? `g:${r.grupo_reserva_id}` : `r:${item.reservaId}`;

            if (!grupos.has(key)) {
                grupos.set(key, {
                    reservaId: item.reservaId,
                    grupoId: r.grupo_reserva_id || "",
                    titular: r.titular_nombre || item.titular,
                    cabs: [],
                    contextos: []
                });
            }

            const g = grupos.get(key);
            if (item.numero && !g.cabs.includes(item.numero)) g.cabs.push(item.numero);
            if (item.contexto && !g.contextos.includes(item.contexto)) g.contextos.push(item.contexto);
        });

        return [...grupos.values()].map(g => {
            g.cabs.sort((a,b) => a-b);
            return g;
        }).sort((a,b) => (a.cabs[0] || 999) - (b.cabs[0] || 999));
    }

    async function cargarReservas() {
        const select = document.getElementById("haiku-pago-reserva");
        if (!select) return;

        select.disabled = true;
        select.innerHTML = `<option value="">Cargando...</option>`;

        try {
            const items = await obtenerReservasDia();
            select.innerHTML = `<option value="">Seleccionar titular / reserva...</option>`;

            items.forEach(item => {
                const op = document.createElement("option");
                op.value = item.reservaId;
                op.textContent = item.grupoId
                    ? `↳ ${item.titular} · ${item.cabs.map(n => `CAB ${n}`).join(" + ")}`
                    : `CAB ${item.cabs[0] || "—"} · ${item.titular}`;
                select.appendChild(op);
            });

            if (!items.length) {
                select.innerHTML = `<option value="">No hay reservas para esta fecha</option>`;
            }
        } catch (error) {
            console.error("HAIKU · cargar titulares para pago:", error);
            select.innerHTML = `<option value="">No fue posible cargar reservas</option>`;
            estado(error?.message || "No fue posible cargar las reservas.", "error");
        } finally {
            select.disabled = false;
        }
    }

    async function finanzasReserva(reservaId) {
        const { data: grupo, error: eGrupo } = await cliente.rpc("haiku_finanzas_grupo", {
            p_reserva_id: reservaId
        });

        if (eGrupo) throw eGrupo;
        if (grupo?.es_grupo) return grupo;

        const { data: cargos, error } = await cliente
            .from("vista_estado_cargos")
            .select("tipo_cargo,estado,monto_ajustado,aplicado_neto,saldo_cargo")
            .eq("reserva_id", reservaId);

        if (error) throw error;

        const activos = (cargos || []).filter(c => c.estado === "activo");
        const alojamiento = activos.filter(c => c.tipo_cargo === "alojamiento");
        const servicios = activos.filter(c => c.tipo_cargo === "servicio");

        return {
            es_grupo: false,
            reserva_id: reservaId,
            total_alojamiento: alojamiento.reduce((s,c) => s + Number(c.monto_ajustado || 0), 0),
            abonado_alojamiento: alojamiento.reduce((s,c) => s + Number(c.aplicado_neto || 0), 0),
            saldo_alojamiento: alojamiento.reduce((s,c) => s + Number(c.saldo_cargo || 0), 0),
            servicios_pendientes: servicios.reduce((s,c) => s + Number(c.saldo_cargo || 0), 0),
            miembros: []
        };
    }

    async function contextoPagoResumen(reservaId, fechaEsperada) {
        const id = String(reservaId || "");
        if (!id || fechaEsperada !== fechaActual()) return null;
        const { data, error } = await cliente.rpc("haiku_operacion_dia", {
            p_fecha: fechaEsperada
        });
        if (error) throw error;
        const fila = (data || []).find(item =>
            item.estado_operativo === "continua" && String(item.continua_reserva_id || "") === id);
        if (!fila || fechaEsperada !== fechaActual()) return null;
        const finanzas = await finanzasReserva(id);
        if (fechaEsperada !== fechaActual()) return null;
        const miembros = finanzas.es_grupo
            ? (finanzas.miembros || []).map(item => String(item.reserva_id || "")).filter(Boolean).sort()
            : [id];
        if (!miembros.includes(id)) return null;
        const cabanas = finanzas.es_grupo
            ? (finanzas.miembros || []).map(item => Number(item.cabana)).filter(Boolean).sort((a,b) => a-b)
            : [Number(fila.numero)];
        if (!cabanas.includes(Number(fila.numero))) return null;
        return {
            reservaId: id,
            titular: finanzas.titular || fila.continua_titular || "Sin titular",
            cabanas,
            miembros,
            total: Number(finanzas.total_alojamiento || 0),
            saldo: Number(finanzas.saldo_alojamiento || 0)
        };
    }

    async function contextoPagoModal(reservaId, fechaEsperada) {
        const id = String(reservaId || "");
        if (!id || fechaEsperada !== fechaActual()) return null;
        const elegible = (await obtenerReservasDia()).some(item => item.reservaId === id);
        if (!elegible || fechaEsperada !== fechaActual()) return null;
        const finanzas = await finanzasReserva(id);
        if (fechaEsperada !== fechaActual()) return null;
        return {
            reservaId: id,
            total: Number(finanzas.total_alojamiento || 0),
            saldo: Number(finanzas.saldo_alojamiento || 0)
        };
    }

    function requisitosPagoResumen(medioUI) {
        const medio = MEDIOS_DESDE_UI[medioUI] || "";
        return {
            glosa: medio === "transferencia",
            codAut: ["webpay_credito", "webpay_debito"].includes(medio),
            folio: ["tarjeta_credito", "tarjeta_debito"].includes(medio),
            bovtar: ["tarjeta_credito", "tarjeta_debito"].includes(medio)
        };
    }

    async function registrarPagoControlado(reservaId, datos, fechaEsperada, origen = "resumen") {
        if (guardando) throw new Error("Ya se está registrando un pago.");
        guardando = true;
        try {
            if (!window.haikuSesion) throw new Error("Debes iniciar sesión para registrar pagos.");
            if (!window.haikuTienePermiso?.("pagos.registrar")) {
                throw new Error("Tu usuario no tiene permiso para registrar pagos.");
            }
            const contexto = origen === "modal"
                ? await contextoPagoModal(reservaId, fechaEsperada)
                : await contextoPagoResumen(reservaId, fechaEsperada);
            if (!contexto || contexto.saldo <= 0) {
                throw new Error("La reserva ya no tiene saldo de alojamiento cobrable en esta fecha.");
            }
            const monto = Math.round(Number(datos.monto || 0));
            const medio = MEDIOS_DESDE_UI[datos.medio] ||
                (MEDIOS_UI[datos.medio] ? datos.medio : "");
            const fechaPago = fechaPagoISO(datos.fechaPago);
            const requisitos = requisitosPagoResumen(MEDIOS_UI[medio] || "");
            if (!Number.isFinite(monto) || monto <= 0 || monto > contexto.saldo) {
                throw new Error(`El monto debe estar entre $1 y ${dinero(contexto.saldo)}.`);
            }
            if (!medio) throw new Error("Selecciona el medio de pago.");
            if (!fechaPago) throw new Error("Selecciona una fecha de pago válida.");
            if (requisitos.glosa && !datos.glosa) throw new Error("Ingresa la glosa de la transferencia.");
            if (requisitos.codAut && !datos.codAut) throw new Error("Ingresa el CodAut de WebPay.");
            if (requisitos.folio && (!datos.folio || !datos.bovtar)) {
                throw new Error("Ingresa Folio y BOVTAR.");
            }
            if (fechaEsperada !== fechaActual()) {
                throw new Error("La fecha seleccionada cambió. Vuelve a abrir el pago.");
            }
            const { data, error } = await cliente.rpc("haiku_registrar_pago_grupo", {
                p_reserva_id: contexto.reservaId,
                p_monto: monto,
                p_medio_pago: medio,
                p_etapa_operativa: "abono",
                p_fecha_pago: fechaPago,
                p_folio: datos.folio || null,
                p_codigo_autorizacion: datos.codAut || null,
                p_bove: datos.bovtar || null,
                p_referencia_externa: datos.glosa || null,
                p_observaciones: datos.observacion || null
            });
            if (error) throw error;
            await Promise.allSettled([
                Promise.resolve().then(() => window.haikuCargarAbonosSupabase?.()),
                Promise.resolve().then(() => window.haikuCargarSaldosCheckinSupabase?.()),
                Promise.resolve().then(() => window.haikuSincronizarReservasSupabase?.())
            ]);
            return data;
        } finally {
            guardando = false;
        }
    }

    function idsReservaActuales() {
        if (!reservaSeleccionada || !resumenActual) return [];

        if (resumenActual.es_grupo) {
            return [...new Set(
                (resumenActual.miembros || [])
                    .map(m => String(m.reserva_id || ""))
                    .filter(Boolean)
            )];
        }

        return [String(reservaSeleccionada)];
    }

    function agruparMovimientosPagos(filas) {
        const mapa = new Map();

        (filas || []).forEach(pago => {
            const grupo = pago.pago_grupo_id ? String(pago.pago_grupo_id) : "";
            const clave = grupo ? `grupo:${grupo}` : `pago:${pago.id}`;

            if (!mapa.has(clave)) {
                mapa.set(clave, {
                    clave,
                    fecha_pago: pago.fecha_pago || "",
                    medio_pago: pago.medio_pago || "",
                    monto: 0,
                    referencia_externa: pago.referencia_externa || "",
                    folio: pago.folio || "",
                    codigo_autorizacion: pago.codigo_autorizacion || "",
                    observaciones: pago.observaciones || ""
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
            if (!item.observaciones && pago.observaciones) {
                item.observaciones = pago.observaciones;
            }
        });

        return [...mapa.values()].sort((a,b) =>
            String(a.fecha_pago || "").localeCompare(String(b.fecha_pago || ""))
        );
    }

    function renderHistorialPagos(items) {
        const bloque = document.getElementById("haiku-pago-historial");
        const lista = document.getElementById("haiku-pago-historial-lista");
        const contador = document.getElementById("haiku-pago-historial-contador");

        if (!bloque || !lista || !contador) return;

        bloque.hidden = false;
        contador.textContent = items.length === 1 ? "1 pago" : `${items.length} pagos`;

        if (!items.length) {
            lista.innerHTML = `
                <div class="haiku-pago-grupo-historial-vacio">
                    Aún no hay abonos registrados.
                </div>`;
            return;
        }

        lista.innerHTML = items.map(item => {
            const detalles = [];
            if (item.referencia_externa) detalles.push(`Glosa: ${escapar(item.referencia_externa)}`);
            if (item.folio) detalles.push(`Folio: ${escapar(item.folio)}`);
            if (item.codigo_autorizacion) detalles.push(`CodAut: ${escapar(item.codigo_autorizacion)}`);

            return `
                <div class="haiku-pago-grupo-historial-item">
                    <div class="haiku-pago-grupo-historial-principal">
                        <span>${escapar(fechaCorta(item.fecha_pago))}</span>
                        <strong>${escapar(MEDIOS_UI[item.medio_pago] || item.medio_pago || "Sin medio")}</strong>
                    </div>
                    <strong class="haiku-pago-grupo-historial-monto">${dinero(item.monto)}</strong>
                    ${detalles.length ? `<small>${detalles.join(" · ")}</small>` : ""}
                </div>`;
        }).join("");
    }

    async function cargarHistorialPagos() {
        const ids = idsReservaActuales();
        if (!ids.length) {
            renderHistorialPagos([]);
            return;
        }

        const { data, error } = await cliente
            .from("pagos")
            .select("id,reserva_id,pago_grupo_id,monto,medio_pago,fecha_pago,folio,codigo_autorizacion,referencia_externa,observaciones")
            .in("reserva_id", ids)
            .eq("tipo_movimiento", "pago")
            .eq("etapa_operativa", "abono")
            .eq("estado", "confirmado")
            .order("fecha_pago", { ascending: true });

        if (error) throw error;

        renderHistorialPagos(agruparMovimientosPagos(data || []));
    }

    async function cargarResumenSeleccionado(preservarFormulario = false) {
        resumenActual = null;

        if (!reservaSeleccionada) {
            const resumen = document.getElementById("haiku-pago-resumen");
            if (resumen) resumen.hidden = true;

            const historial = document.getElementById("haiku-pago-historial");
            if (historial) historial.hidden = true;

            validarFormulario();
            return;
        }

        estado("Cargando saldo...");

        try {
            resumenActual = await finanzasReserva(reservaSeleccionada);

            document.getElementById("haiku-pago-total").textContent =
                dinero(resumenActual.total_alojamiento);
            document.getElementById("haiku-pago-abonado").textContent =
                dinero(resumenActual.abonado_alojamiento);
            document.getElementById("haiku-pago-saldo").textContent =
                dinero(resumenActual.saldo_alojamiento);

            const resumen = document.getElementById("haiku-pago-resumen");
            if (resumen) resumen.hidden = false;

            const vinculo = document.getElementById("haiku-pago-vinculo");
            if (vinculo) {
                if (resumenActual.es_grupo) {
                    const cabs = (resumenActual.miembros || [])
                        .map(m => `CAB ${m.cabana}`)
                        .join(" · ");
                    vinculo.textContent = `↳ Reserva conjunta · ${cabs}`;
                    vinculo.hidden = false;
                } else {
                    vinculo.textContent = "";
                    vinculo.hidden = true;
                }
            }

            const saldo = Number(resumenActual.saldo_alojamiento || 0);
            const monto = document.getElementById("haiku-pago-monto");

            if (monto) {
                monto.max = String(Math.max(saldo, 0));
                monto.disabled = saldo <= 0;

                if (!preservarFormulario) {
                    monto.value = "";
                } else if (Number(monto.value || 0) > saldo) {
                    monto.value = "";
                }
            }

            await cargarHistorialPagos();

            if (saldo <= 0) {
                estado("Alojamiento completamente abonado.", "exito");
            } else {
                estado("");
            }

            validarFormulario();
        } catch (error) {
            console.error("HAIKU · resumen de pago:", error);
            estado(error?.message || "No fue posible cargar el saldo.", "error");
        }
    }

    function actualizarExtras() {
        const medio = document.getElementById("haiku-pago-medio")?.value || "";
        const visibles = new Set();

        if (medio === "transferencia") visibles.add("glosa");
        if (["webpay_credito","webpay_debito"].includes(medio)) visibles.add("codaut");
        if (["tarjeta_credito","tarjeta_debito"].includes(medio)) {
            visibles.add("folio");
            visibles.add("bove");
        }

        document.querySelectorAll(".haiku-pago-grupo-extra").forEach(el => {
            el.hidden = !visibles.has(el.dataset.extra || "");
        });

        validarFormulario();
    }

    function validarFormulario() {
        const confirmar = document.getElementById("haiku-pago-confirmar");
        if (!confirmar) return;

        const monto = Number(document.getElementById("haiku-pago-monto")?.value || 0);
        const medio = document.getElementById("haiku-pago-medio")?.value || "";
        const fecha = document.getElementById("haiku-pago-fecha")?.value || "";
        const saldo = Number(resumenActual?.saldo_alojamiento || 0);

        confirmar.disabled =
            guardando ||
            !reservaSeleccionada ||
            !resumenActual ||
            saldo <= 0 ||
            monto <= 0 ||
            monto > saldo ||
            !medio ||
            !fechaPagoISO(fecha);
    }

    function validarDetalles(medio) {
        const valor = id => document.getElementById(id)?.value?.trim() || "";

        const datos = {
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

    async function registrarPago() {
        if (guardando || !reservaSeleccionada || !resumenActual) return;

        if (
            typeof window.haikuTienePermiso === "function" &&
            !window.haikuTienePermiso("pagos.registrar")
        ) {
            alert("Tu usuario no tiene permiso para registrar pagos.");
            return;
        }

        const monto = Math.round(
            Number(document.getElementById("haiku-pago-monto")?.value || 0)
        );
        const medio = document.getElementById("haiku-pago-medio")?.value || "";
        const fechaElegida = document.getElementById("haiku-pago-fecha")?.value || "";
        const fechaPago = fechaPagoISO(fechaElegida);
        const saldo = Number(resumenActual.saldo_alojamiento || 0);

        if (monto <= 0 || monto > saldo || !medio || !fechaPago) return;

        let datos;
        try {
            datos = validarDetalles(medio);
        } catch (error) {
            estado(error.message, "error");
            return;
        }

        const confirmar = document.getElementById("haiku-pago-confirmar");
        if (confirmar) {
            confirmar.disabled = true;
            confirmar.textContent = "Registrando...";
        }

        estado("Registrando pago...");

        try {
            const data = await registrarPagoControlado(reservaSeleccionada, {
                monto, medio, fechaPago: fechaElegida,
                glosa: datos.glosa, folio: datos.folio,
                codAut: datos.codaut, bovtar: datos.bove,
                observacion: datos.observacion
            }, fechaActual(), "modal");

            await refrescarFichaFinanzas();

            limpiarCamposPago({
                conservarFecha: true,
                conservarMedio: true
            });

            await cargarResumenSeleccionado(true);

            const saldoNuevo = Number(resumenActual?.saldo_alojamiento || 0);
            estado(
                saldoNuevo > 0
                    ? `Pago de ${dinero(monto)} registrado. Puedes añadir otro abono.`
                    : `Pago de ${dinero(monto)} registrado. Alojamiento completamente abonado.`,
                "exito"
            );

            return data;
        } catch (error) {
            console.error("HAIKU · registrar pago por titular:", error);
            estado(error?.message || "No fue posible registrar el pago.", "error");
        } finally {
            if (confirmar) confirmar.textContent = "Registrar pago";
            validarFormulario();
        }
    }

    async function abrirModal() {
        if (!window.haikuSesion) {
            alert("Debes iniciar sesión para registrar pagos.");
            return;
        }

        if (
            typeof window.haikuTienePermiso === "function" &&
            !window.haikuTienePermiso("pagos.registrar")
        ) {
            alert("Tu usuario no tiene permiso para registrar pagos.");
            return;
        }

        const overlay = document.getElementById("haiku-pago-grupo-overlay");
        if (!overlay) return;

        resetModal();
        overlay.hidden = false;
        document.body.style.overflow = "hidden";

        await cargarReservas();
    }

    function cerrarModal(forzar = false) {
        const overlay = document.getElementById("haiku-pago-grupo-overlay");
        if (!overlay || (guardando && !forzar)) return;

        overlay.hidden = true;
        document.body.style.overflow = "";
    }

    function etiquetaFicha(indice, texto) {
        const label = document.querySelector(
            `#ficha-reserva-modal .ficha-pagos > div:nth-child(${indice}) > span`
        );
        if (label) label.textContent = texto;
    }

    function limpiarNotaFicha() {
        document.querySelector(
            "#ficha-reserva-modal .haiku-ficha-finanzas-grupo-nota"
        )?.remove();
    }

    async function refrescarFichaFinanzas() {
        const modal = document.getElementById("ficha-reserva-modal");
        if (!modal || modal.hidden) return;

        const reservaId = modal.dataset.reservaId || "";
        if (!reservaId) return;

        const turno = ++secuenciaFicha;

        try {
            const datos = await finanzasReserva(reservaId);
            if (turno !== secuenciaFicha) return;

            limpiarNotaFicha();

            if (!datos?.es_grupo) {
                etiquetaFicha(1, "Total reserva");
                etiquetaFicha(2, "Abono");
                etiquetaFicha(3, "Saldo");
                etiquetaFicha(4, "Servicios pendientes");
                return;
            }

            const valores = {
                "ficha-pago-total": datos.total_alojamiento,
                "ficha-pago-abono": datos.abonado_alojamiento,
                "ficha-pago-saldo": datos.saldo_alojamiento,
                "ficha-pago-servicios": datos.servicios_pendientes
            };

            Object.entries(valores).forEach(([id, valor]) => {
                const el = document.getElementById(id);
                if (el) el.textContent = dinero(valor);
            });

            etiquetaFicha(1, "Total grupo");
            etiquetaFicha(2, "Abono grupo");
            etiquetaFicha(3, "Saldo grupo");
            etiquetaFicha(4, "Servicios grupo");

            const pagos = document.querySelector("#ficha-reserva-modal .ficha-pagos");
            if (pagos) {
                const nota = document.createElement("div");
                nota.className = "haiku-ficha-finanzas-grupo-nota";
                nota.textContent = `↳ Valores conjuntos · ${(datos.miembros || [])
                    .map(m => `CAB ${m.cabana}`)
                    .join(" · ")}`;
                pagos.insertAdjacentElement("afterend", nota);
            }
        } catch (error) {
            console.warn("HAIKU · finanzas conjuntas en ficha:", error);
        }
    }

    function observarFicha() {
        const modal = document.getElementById("ficha-reserva-modal");
        if (!modal || modal.dataset.haikuPagoGrupoObservado === "1") return;

        modal.dataset.haikuPagoGrupoObservado = "1";

        new MutationObserver(() => {
            if (!modal.hidden && modal.dataset.reservaId) {
                queueMicrotask(() => refrescarFichaFinanzas());
            }
        }).observe(modal, {
            attributes: true,
            attributeFilter: ["hidden","data-reserva-id"]
        });
    }

    function instalar() {
        crearModal();
        crearBoton();
        observarFicha();
    }

    window.addEventListener("haiku:auth-ready", () => setTimeout(instalar, 100));
    window.addEventListener("load", () => setTimeout(instalar, 180));

    document.addEventListener("click", evento => {
        if (evento.target.closest?.('[data-seccion="pagos"]')) {
            setTimeout(crearBoton, 80);
        }
    });

    setTimeout(instalar, 220);

    window.HAIKU_PAGO_GRUPO_V1 = Object.freeze({
        abrir: abrirModal,
        refrescarFicha: refrescarFichaFinanzas,
        contextoResumen: contextoPagoResumen,
        registrarResumen: registrarPagoControlado,
        requisitosResumen: requisitosPagoResumen,
        fechaPagoPredeterminada: hoyChile
    });

    console.info("HAIKU · Pago por titular / múltiples abonos V2 preparado.");
})();
