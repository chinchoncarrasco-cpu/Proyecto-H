// ========================================
// HAIKU · SUPABASE · PAGOS + EDICIÓN V2
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let guardandoAbono = false;
    let guardandoSaldo = false;
    let guardandoEdicion = false;

    const MAPA_MEDIOS = Object.freeze({
        "Transferencia": "transferencia",
        "WebPay Crédito": "webpay_credito",
        "WebPay Débito": "webpay_debito",
        "Tarjeta Crédito": "tarjeta_credito",
        "Tarjeta Débito": "tarjeta_debito",
        "Efectivo": "efectivo"
    });

    const MAPA_INVERSO = Object.freeze({
        transferencia: "Transferencia",
        webpay_credito: "WebPay Crédito",
        webpay_debito: "WebPay Débito",
        tarjeta_credito: "Tarjeta Crédito",
        tarjeta_debito: "Tarjeta Débito",
        efectivo: "Efectivo"
    });

    function escapar(valor) {
        return String(valor ?? "")
            .replaceAll("&","&amp;")
            .replaceAll("<","&lt;")
            .replaceAll(">","&gt;")
            .replaceAll('"',"&quot;")
            .replaceAll("'","&#039;");
    }

    function fechaActual() {
        try { return String(fechaSeleccionada || "").slice(0,10); }
        catch { return ""; }
    }

    function modoReserva() {
        try { return String(modoFormularioReserva || "crear"); }
        catch { return "crear"; }
    }

    function reservaEditando() {
        try { return String(reservaEditandoId || ""); }
        catch { return ""; }
    }

    function opcionesMedio(valor = "") {
        const opciones = [
            "Transferencia","WebPay Crédito","WebPay Débito",
            "Tarjeta Crédito","Tarjeta Débito","Efectivo"
        ];
        return [
            `<option value="" ${!valor ? "selected" : ""}>Seleccionar...</option>`,
            ...opciones.map(o => `<option value="${o}" ${valor===o?"selected":""}>${o}</option>`)
        ].join("");
    }

    async function ingresosDia(fecha) {
        const { data, error } = await cliente.rpc("haiku_operacion_dia", { p_fecha: fecha });
        if (error) throw error;
        return (data || [])
            .filter(f => ["libre-ingresa","sale-ingresa","fullday"].includes(f.estado_operativo))
            .map(f => ({
                numero: Number(f.numero),
                titular: f.estado_operativo === "fullday" ? f.fullday_titular : f.ingreso_titular,
                reservaId: f.estado_operativo === "fullday" ? f.fullday_reserva_id : f.ingreso_reserva_id
            }))
            .filter(x => x.reservaId);
    }

    async function pagosAbono(ids) {
        if (ids.length === 0) return [];
        const { data, error } = await cliente
            .from("pagos")
            .select("id,reserva_id,monto,medio_pago,estado,fecha_pago")
            .in("reserva_id", ids)
            .eq("tipo_movimiento","pago")
            .eq("etapa_operativa","abono")
            .eq("estado","confirmado")
            .order("fecha_pago", { ascending: true });
        if (error) throw error;
        return data || [];
    }

    async function saldosReservas(ids) {
        if (ids.length === 0) return new Map();
        const { data, error } = await cliente
            .from("vista_saldos_reserva")
            .select("reserva_id,total_cargos,total_pagado_neto,saldo")
            .in("reserva_id", ids);
        if (error) throw error;
        return new Map((data || []).map(x => [x.reserva_id,x]));
    }

    function agruparAbonos(pagos) {
        const mapa = new Map();
        pagos.forEach(p => {
            const actual = mapa.get(p.reserva_id) || { total:0, medios:new Set(), ultimo:null };
            actual.total += Number(p.monto || 0);
            if (p.medio_pago) actual.medios.add(p.medio_pago);
            actual.ultimo = p;
            mapa.set(p.reserva_id, actual);
        });
        return mapa;
    }

    async function cargarAbonosSupabase() {
        if (window.HAIKU_PAGOS_REFRESH_V1?.interceptar("abonos-v2")) return;
        const fecha = fechaActual();
        const lista = document.getElementById("pagos-lista-abonos");
        const contador = document.getElementById("pagos-contador-abonos");
        if (!fecha || !lista || !contador || !window.haikuSesion) return;

        try {
            const ingresos = await ingresosDia(fecha);
            const ids = [...new Set(ingresos.map(i => i.reservaId))];
            const porReserva = agruparAbonos(await pagosAbono(ids));
            if (window.HAIKU_PAGOS_REFRESH_V1?.interceptar("abonos-v2-en-vuelo")) return;
            lista.innerHTML = "";
            let pendientes = 0;

            ingresos.forEach(item => {
                const info = porReserva.get(item.reservaId);
                const confirmado = Number(info?.total || 0) > 0;
                if (!confirmado) pendientes++;
                const medioDB = info?.medios?.size === 1 ? [...info.medios][0] : "";
                const medioUI = MAPA_INVERSO[medioDB] || "";

                const tarjeta = document.createElement("div");
                tarjeta.className = "pago-abono-item" + (confirmado ? " abono-verificado" : "");
                tarjeta.dataset.reservaId = item.reservaId;
                tarjeta.innerHTML = `
                    <div class="pago-abono-nuevo">
                        <div class="pago-abono-cabecera">
                            <div class="pago-abono-identidad">
                                <strong>CAB ${item.numero}</strong>
                                <span>· ${escapar(item.titular || "Sin titular")}</span>
                            </div>
                            <span class="pago-abono-estado">${confirmado ? "✓ Verificado" : "Pendiente"}</span>
                        </div>
                        <div class="pago-abono-grid">
                            <label class="pago-abono-grupo">
                                <span class="pago-abono-label">Abono</span>
                                <div class="pago-abono-monto-wrap">
                                    <span>$</span>
                                    <input type="number" class="pago-abono-monto"
                                        data-pago-cabana="${item.numero}"
                                        value="${confirmado ? Number(info.total) : ""}"
                                        min="0" step="1000" placeholder="0"
                                        ${confirmado ? "readonly" : ""}>
                                </div>
                            </label>
                            <label class="pago-abono-grupo">
                                <span class="pago-abono-label">Medio</span>
                                <select class="pago-abono-medio" data-pago-cabana="${item.numero}" ${confirmado ? "disabled" : ""}>
                                    ${opcionesMedio(medioUI)}
                                </select>
                            </label>
                        </div>
                        <label class="pago-abono-verificacion">
                            <input type="checkbox"
                                data-pago-abono="${item.numero}"
                                data-reserva-id="${item.reservaId}"
                                ${confirmado ? "checked disabled" : ""}>
                            <span>Confirmar abono</span>
                        </label>
                    </div>`;
                lista.appendChild(tarjeta);
            });

            contador.textContent = String(pendientes);
            if (ingresos.length === 0) {
                lista.innerHTML = `<p class="pagos-checkout-vacio">No hay ingresos para esta fecha.</p>`;
            }
            console.info("HAIKU · Abonos V2 desde Supabase:", fecha, ingresos.length);
        } catch (error) {
            console.error("HAIKU · Error cargando abonos V2:", error);
        }
    }

    async function cargarSaldosCheckinSupabase() {
        if (window.HAIKU_PAGOS_REFRESH_V1?.interceptar("checkin-v2")) return;
        const fecha = fechaActual();
        const lista = document.getElementById("pagos-lista-checkin");
        const contador = document.getElementById("pagos-contador-checkin");
        if (!fecha || !lista || !contador || !window.haikuSesion) return;

        try {
            const ingresos = await ingresosDia(fecha);
            const ids = [...new Set(ingresos.map(i => i.reservaId))];
            const saldos = await saldosReservas(ids);
            if (window.HAIKU_PAGOS_REFRESH_V1?.interceptar("checkin-v2-en-vuelo")) return;
            lista.innerHTML = "";
            let pendientes = 0;

            ingresos.forEach(item => {
                const estado = saldos.get(item.reservaId) || { total_cargos:0, total_pagado_neto:0, saldo:0 };
                const saldo = Number(estado.saldo || 0);
                const total = Number(estado.total_cargos || 0);
                const pagado = saldo <= 0;
                if (!pagado) pendientes++;

                const tarjeta = document.createElement("div");
                tarjeta.className = "pago-checkin-item" + (pagado ? " pago-checkin-completo" : "");
                tarjeta.dataset.reservaId = item.reservaId;
                tarjeta.innerHTML = `
                    <div class="pago-checkin-nuevo">
                        <div class="pago-checkin-cabecera">
                            <div class="pago-checkin-identidad">
                                <strong>CAB ${item.numero}</strong><span>· ${escapar(item.titular || "Sin titular")}</span>
                            </div>
                            <span class="pago-checkin-estado">${pagado ? "✓ Pagado" : "Pendiente"}</span>
                        </div>
                        <div class="pago-checkin-resumen-nuevo">
                            <label class="pago-checkin-grupo">
                                <span class="pago-checkin-label">Total reserva</span>
                                <div class="pago-checkin-input-monto">
                                    <span>$</span>
                                    <input type="number" class="pago-checkin-total" value="${total}" readonly>
                                </div>
                            </label>
                            <div class="pago-checkin-saldo-nuevo">
                                <span>Saldo pendiente</span>
                                <strong class="pago-checkin-saldo">$${saldo.toLocaleString("es-CL")}</strong>
                            </div>
                        </div>
                        ${pagado ? "" : `
                        <div class="pago-checkin-bloque">
                            <span class="pago-checkin-label">Medio de pago</span>
                            <div class="pago-checkin-medio-fila">
                                <select data-pago-checkin-medio="${item.numero}">${opcionesMedio("")}</select>
                                <label class="pago-checkin-cobrado">
                                    <input type="checkbox" data-pago-checkin-cobrado="${item.numero}"><span>Cobrado</span>
                                </label>
                            </div>
                        </div>
                        <div class="pago-checkin-datos">
                            <label class="pago-checkin-grupo"><span class="pago-checkin-label">Folio</span><input type="text" data-pago-checkin-folio="${item.numero}" placeholder="Rellenar"></label>
                            <label class="pago-checkin-grupo"><span class="pago-checkin-label">CodAut</span><input type="text" data-pago-checkin-codaut="${item.numero}" placeholder="Rellenar"></label>
                            <label class="pago-checkin-grupo"><span class="pago-checkin-label">Bove</span><input type="text" data-pago-checkin-bove="${item.numero}" placeholder="Rellenar"></label>
                            <label class="pago-checkin-manager-nuevo"><span class="pago-checkin-label">Manager</span><div><input type="checkbox" data-pago-checkin-manager="${item.numero}"><span>Revisado</span></div></label>
                        </div>`}
                    </div>`;
                lista.appendChild(tarjeta);
            });

            contador.textContent = String(pendientes);
            console.info("HAIKU · Saldos Check-in V2 desde Supabase:", fecha, ingresos.length);
        } catch (error) {
            console.error("HAIKU · Error cargando saldos V2:", error);
        }
    }

    async function registrarPago(reservaId, monto, medioDB, etapa, extras = {}) {
        const { data, error } = await cliente.rpc("haiku_registrar_pago", {
            p_reserva_id: reservaId,
            p_monto: monto,
            p_medio_pago: medioDB,
            p_etapa_operativa: etapa,
            p_fecha_pago: new Date().toISOString(),
            p_folio: extras.folio || null,
            p_codigo_autorizacion: extras.codAut || null,
            p_bove: extras.bove || null,
            p_referencia_externa: null,
            p_observaciones: extras.observaciones || null,
            p_aplicaciones: [],
            p_modo_aplicacion: "alojamiento"
        });
        if (error) throw error;
        await window.HAIKU_PAGOS_REFRESH_V1?.escrituraConfirmada("registrar pago legado");
        return data;
    }

    document.addEventListener("change", async evento => {
        const check = evento.target.closest("[data-pago-abono]");
        if (!check || !check.dataset.reservaId) return;

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();

        if (!check.checked || guardandoAbono) return;
        const tarjeta = check.closest(".pago-abono-item");
        const reservaId = check.dataset.reservaId;
        const monto = Number(tarjeta?.querySelector(".pago-abono-monto")?.value || 0);
        const medioUI = tarjeta?.querySelector(".pago-abono-medio")?.value || "";
        const medioDB = MAPA_MEDIOS[medioUI] || "";

        if (monto <= 0 || !medioDB) {
            check.checked = false;
            alert("Ingresa un monto de abono y selecciona el medio de pago.");
            return;
        }
        if (!window.haikuTienePermiso?.("pagos.registrar")) {
            check.checked = false;
            alert("Tu usuario no tiene permiso para registrar pagos.");
            return;
        }

        guardandoAbono = true;
        check.disabled = true;
        try {
            const saldos = await saldosReservas([reservaId]);
            const saldo = Number(saldos.get(reservaId)?.saldo || 0);
            if (monto > saldo) throw new Error(`El abono supera el saldo actual ($${saldo.toLocaleString("es-CL")}).`);

            await registrarPago(reservaId, monto, medioDB, "abono", {
                observaciones: `Abono registrado desde HAIKU · CAB ${check.dataset.pagoAbono || ""}`
            });
            await Promise.all([cargarAbonosSupabase(), cargarSaldosCheckinSupabase()]);
            await window.haikuSincronizarReservasSupabase?.();
        } catch (error) {
            console.error("HAIKU · No fue posible registrar abono V2:", error);
            check.checked = false;
            alert(error?.message || "No fue posible registrar el abono.");
        } finally {
            guardandoAbono = false;
            check.disabled = false;
        }
    }, true);

    // Cobro de saldo de check-in: se registra sólo cuando el formulario está completo.
    document.addEventListener("change", async evento => {
        const cobrado = evento.target.closest("[data-pago-checkin-cobrado]");
        if (!cobrado || !cobrado.checked || guardandoSaldo) return;
        const tarjeta = cobrado.closest(".pago-checkin-item");
        const reservaId = tarjeta?.dataset.reservaId || "";
        if (!reservaId) return;

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();

        const numero = cobrado.dataset.pagoCheckinCobrado;
        const medioUI = tarjeta.querySelector(`[data-pago-checkin-medio="${numero}"]`)?.value || "";
        const folio = tarjeta.querySelector(`[data-pago-checkin-folio="${numero}"]`)?.value.trim() || "";
        const codAut = tarjeta.querySelector(`[data-pago-checkin-codaut="${numero}"]`)?.value.trim() || "";
        const bove = tarjeta.querySelector(`[data-pago-checkin-bove="${numero}"]`)?.value.trim() || "";
        const manager = tarjeta.querySelector(`[data-pago-checkin-manager="${numero}"]`)?.checked === true;
        const medioDB = MAPA_MEDIOS[medioUI] || "";

        if (!medioDB || !folio || !codAut || !bove || !manager) {
            cobrado.checked = false;
            alert("Para cerrar el saldo completa Medio de pago, Folio, CodAut, Bove y Manager revisado.");
            return;
        }
        if (!window.haikuTienePermiso?.("pagos.registrar")) {
            cobrado.checked = false;
            alert("Tu usuario no tiene permiso para registrar pagos.");
            return;
        }

        guardandoSaldo = true;
        cobrado.disabled = true;
        try {
            const saldos = await saldosReservas([reservaId]);
            const saldo = Number(saldos.get(reservaId)?.saldo || 0);
            if (saldo <= 0) throw new Error("La reserva ya no tiene saldo pendiente.");

            await registrarPago(reservaId, saldo, medioDB, "saldo", {
                folio, codAut, bove,
                observaciones: `Saldo de check-in registrado desde HAIKU · CAB ${numero}`
            });
            await Promise.all([cargarAbonosSupabase(), cargarSaldosCheckinSupabase()]);
            await window.haikuSincronizarReservasSupabase?.();
        } catch (error) {
            console.error("HAIKU · No fue posible registrar saldo V2:", error);
            cobrado.checked = false;
            alert(error?.message || "No fue posible registrar el saldo.");
        } finally {
            guardandoSaldo = false;
            cobrado.disabled = false;
        }
    }, true);

    function datosFormularioEdicion() {
        const get = id => document.getElementById(id)?.value.trim() || "";
        const acompanantes = Array.from(document.querySelectorAll(".reserva-nuevo-acompanante"))
            .map(c => c.value.trim()).filter(Boolean);
        let llegada="", salida="", cabana="", tarifas={}, adultos=1, ninos=0, mascotas=0;
        try { llegada = fechaLlegadaReserva || ""; } catch {}
        try { salida = fechaSalidaReserva || ""; } catch {}
        try { cabana = cabanaSeleccionadaReserva || ""; } catch {}
        try { tarifas = { ...(tarifasNochesReserva || {}) }; } catch {}
        try { adultos = Number(adultosReserva ?? 1); } catch {}
        try { ninos = Number(ninosReserva ?? 0); } catch {}
        try { mascotas = Number(mascotasReserva ?? 0); } catch {}
        return {
            titular:get("reserva-nuevo-titular"), telefono:get("reserva-nuevo-telefono"),
            rut:get("reserva-nuevo-rut"), correo:get("reserva-nuevo-correo"),
            observaciones:get("reserva-nueva-observacion"), acompanantes,
            llegada, salida, cabana:Number(cabana), tarifas, adultos, ninos, mascotas
        };
    }

    async function actualizarReservaSupabase(id, d) {
        const { data, error } = await cliente.rpc("haiku_actualizar_reserva", {
            p_reserva_id:id,
            p_titular_nombre:d.titular,
            p_cabana_numero:d.cabana,
            p_fecha_ingreso:d.llegada,
            p_fecha_salida:d.salida,
            p_adultos:Math.max(0,d.adultos),
            p_ninos:Math.max(0,d.ninos),
            p_mascotas:Math.max(0,d.mascotas),
            p_correo_contacto:d.correo || null,
            p_telefono_contacto:d.telefono || null,
            p_rut:d.rut || null,
            p_observaciones:d.observaciones || null,
            p_tarifas:d.tarifas,
            p_acompanantes:d.acompanantes
        });
        if (error) throw error;
        return data;
    }

    document.addEventListener("click", async evento => {
        const boton = evento.target.closest("#crear-nueva-reserva");
        if (!boton || modoReserva() !== "editar") return;

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();
        if (guardandoEdicion) return;

        const id = reservaEditando();
        const d = datosFormularioEdicion();
        if (!id || !d.titular || !d.cabana || !d.llegada || !d.salida) {
            alert("Faltan datos obligatorios para guardar la edición.");
            return;
        }

        guardandoEdicion = true;
        const texto = boton.textContent;
        boton.disabled = true;
        boton.textContent = "Guardando en Supabase…";
        try {
            const resultado = await actualizarReservaSupabase(id,d);
            console.info("HAIKU · Reserva V2 actualizada en Supabase:", resultado);

            // Actualizamos la interfaz legacy sólo después de confirmar PostgreSQL.
            if (typeof guardarCambiosReservaEditada === "function") {
                guardarCambiosReservaEditada();
            }
            await window.haikuSincronizarReservasSupabase?.();
        } catch (error) {
            console.error("HAIKU · No fue posible editar reserva V2:", error);
            alert(error?.message || "No fue posible guardar la edición.");
        } finally {
            guardandoEdicion = false;
            boton.disabled = false;
            boton.textContent = texto;
        }
    }, true);

    function activarV2() {
        // Reemplazamos los renderizadores legacy para que no puedan volver a pintar datos locales.
        try { window.cargarAbonosPagos = cargarAbonosSupabase; } catch {}
        try { window.cargarSaldosCheckin = cargarSaldosCheckinSupabase; } catch {}

        const seccion = document.getElementById("seccion-pagos");
        if (seccion?.classList.contains("activa")) {
            cargarAbonosSupabase();
            cargarSaldosCheckinSupabase();
        }
    }

    document.addEventListener("click", evento => {
        if (!evento.target.closest('[data-seccion="pagos"]')) return;
        setTimeout(() => {
            cargarAbonosSupabase();
            cargarSaldosCheckinSupabase();
        }, 20);
    });

    window.addEventListener("haiku:auth-ready", () => setTimeout(activarV2, 30));
    setTimeout(activarV2, 80);

    window.haikuCargarAbonosSupabase = cargarAbonosSupabase;
    window.haikuCargarSaldosCheckinSupabase = cargarSaldosCheckinSupabase;

    console.info("HAIKU · Pagos + Edición Supabase V2 preparados.");
})();
