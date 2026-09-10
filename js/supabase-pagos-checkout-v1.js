// ========================================
// HAIKU · SUPABASE · COBROS CHECK-OUT V1
// Servicios reales + pagos parciales/mixtos + BOVE final de servicios
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const borradores = new Map();
    let renderizando = false;
    let guardandoPago = false;
    let guardandoBove = false;
    let timerRender = null;

    const MEDIOS = Object.freeze({
        "Transferencia": "transferencia",
        "WebPay Crédito": "webpay_credito",
        "WebPay Débito": "webpay_debito",
        "Tarjeta Crédito": "tarjeta_credito",
        "Tarjeta Débito": "tarjeta_debito",
        "Efectivo": "efectivo"
    });

    const MEDIOS_UI = Object.freeze({
        transferencia: "Transferencia",
        webpay_credito: "WebPay Crédito",
        webpay_debito: "WebPay Débito",
        tarjeta_credito: "Tarjeta Crédito",
        tarjeta_debito: "Tarjeta Débito",
        efectivo: "Efectivo"
    });

    function escapar(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function fechaActual() {
        try { return String(fechaSeleccionada || "").slice(0, 10); }
        catch { return ""; }
    }

    function dinero(valor) {
        return "$" + Number(valor || 0).toLocaleString("es-CL");
    }

    function horaCorta(valor) {
        if (!valor) return "--:--";
        return String(valor).slice(0, 5);
    }

    function fechaHora(valor) {
        if (!valor) return "";
        try {
            return new Intl.DateTimeFormat("es-CL", {
                timeZone: "America/Santiago",
                dateStyle: "short",
                timeStyle: "short"
            }).format(new Date(valor));
        } catch {
            return String(valor);
        }
    }

    function opcionesMedio(valor = "") {
        return `
            <option value="" ${!valor ? "selected" : ""}>Seleccionar...</option>
            ${Object.keys(MEDIOS).map(nombre =>
                `<option value="${nombre}" ${valor === nombre ? "selected" : ""}>${nombre}</option>`
            ).join("")}
        `;
    }

    function requisitosMedio(medioDB) {
        if (medioDB === "transferencia") {
            return { glosa: true, folio: false, codAut: false };
        }
        if (["webpay_credito", "webpay_debito"].includes(medioDB)) {
            return { glosa: false, folio: false, codAut: true };
        }
        if (["tarjeta_credito", "tarjeta_debito"].includes(medioDB)) {
            return { glosa: false, folio: true, codAut: true };
        }
        return { glosa: false, folio: false, codAut: false };
    }

    async function reservasCheckoutDia(fecha) {
        const { data, error } = await cliente.rpc(
            "haiku_operacion_dia",
            { p_fecha: fecha }
        );
        if (error) throw error;

        const mapa = new Map();

        (data || []).forEach(fila => {
            let reservaId = "";
            let titular = "";
            let estadiaId = "";

            if (["sale-libre", "sale-ingresa"].includes(fila.estado_operativo)) {
                reservaId = fila.salida_reserva_id || "";
                titular = fila.salida_titular || "";
                estadiaId = fila.salida_estadia_id || "";
            } else if (fila.estado_operativo === "fullday") {
                reservaId = fila.fullday_reserva_id || "";
                titular = fila.fullday_titular || "";
                estadiaId = fila.fullday_estadia_id || "";
            }

            if (!reservaId) return;

            const actual = mapa.get(reservaId) || {
                reservaId,
                titular,
                cabanas: new Set(),
                estadias: new Set()
            };

            actual.titular = actual.titular || titular;
            if (fila.numero != null) actual.cabanas.add(Number(fila.numero));
            if (estadiaId) actual.estadias.add(estadiaId);
            mapa.set(reservaId, actual);
        });

        return [...mapa.values()].map(item => ({
            ...item,
            cabanas: [...item.cabanas].sort((a, b) => a - b),
            estadias: [...item.estadias]
        }));
    }

    async function cargosServicios(ids) {
        if (!ids.length) return [];

        const { data, error } = await cliente
            .from("vista_estado_cargos")
            .select(
                "cargo_id,reserva_id,estadia_id,servicio_id,tipo_cargo,concepto,monto,estado,aplicado_neto,saldo_cargo,estado_pago"
            )
            .in("reserva_id", ids)
            .eq("tipo_cargo", "servicio")
            .eq("estado", "activo");

        if (error) throw error;
        return data || [];
    }

    async function serviciosPorId(ids) {
        const unicos = [...new Set(ids.filter(Boolean))];
        if (!unicos.length) return new Map();

        const { data, error } = await cliente
            .from("servicios")
            .select(
                "id,reserva_id,estadia_id,fecha_servicio,hora_inicio,total,tipo_cobro,estado_servicio,catalogo_servicios(codigo,nombre,categoria)"
            )
            .in("id", unicos);

        if (error) throw error;
        return new Map((data || []).map(item => [item.id, item]));
    }

    async function pagosCheckout(ids) {
        if (!ids.length) return [];

        const { data, error } = await cliente
            .from("pagos")
            .select(
                "id,reserva_id,monto,medio_pago,folio,codigo_autorizacion,referencia_externa,fecha_pago,verificado_por,verificado_en,estado,datos_origen"
            )
            .in("reserva_id", ids)
            .eq("tipo_movimiento", "pago")
            .eq("etapa_operativa", "otro")
            .eq("estado", "confirmado")
            .order("fecha_pago", { ascending: true });

        if (error) throw error;

        return (data || []).filter(pago =>
            pago?.datos_origen?.contexto === "checkout"
        );
    }

    async function cierresBove(ids) {
        if (!ids.length) return new Map();

        const { data, error } = await cliente
            .from("reservas")
            .select(
                "id,bove_checkout,bove_checkout_registrado_por,bove_checkout_registrado_en"
            )
            .in("id", ids);

        if (error) throw error;
        return new Map((data || []).map(item => [item.id, item]));
    }

    async function usuariosPorId(ids) {
        const unicos = [...new Set(ids.filter(Boolean))];
        if (!unicos.length) return new Map();

        const { data, error } = await cliente
            .from("usuarios")
            .select("id,nombre,apellido")
            .in("id", unicos);

        if (error) throw error;

        return new Map((data || []).map(usuario => [
            usuario.id,
            [usuario.nombre, usuario.apellido].filter(Boolean).join(" ") || "Usuario HAIKU"
        ]));
    }

    function agruparPorReserva(lista) {
        const mapa = new Map();
        lista.forEach(item => {
            if (!mapa.has(item.reserva_id)) mapa.set(item.reserva_id, []);
            mapa.get(item.reserva_id).push(item);
        });
        return mapa;
    }

    function htmlPagoConfirmado(pago, usuarios) {
        const medio = MEDIOS_UI[pago.medio_pago] || pago.medio_pago || "Sin medio";
        const revisor = pago.verificado_por
            ? (usuarios.get(pago.verificado_por) || "Usuario HAIKU")
            : "Sin revisión registrada";

        const extras = [];
        if (pago.referencia_externa) {
            extras.push(`Glosa: ${escapar(pago.referencia_externa)}`);
        }
        if (pago.folio) extras.push(`Folio: ${escapar(pago.folio)}`);
        if (pago.codigo_autorizacion) {
            extras.push(`CodAut: ${escapar(pago.codigo_autorizacion)}`);
        }

        return `
            <div class="haiku-saldo-pago-confirmado">
                <div class="haiku-saldo-pago-principal">
                    <strong>${dinero(pago.monto)}</strong>
                    <span>${escapar(medio)}</span>
                    <span class="haiku-pago-ok">✓</span>
                </div>
                <div class="haiku-saldo-pago-meta">
                    ${extras.length ? `<span>${extras.join(" · ")}</span>` : ""}
                    <span>Manager: ${escapar(revisor)}</span>
                    ${pago.verificado_en || pago.fecha_pago
                        ? `<span>${escapar(fechaHora(pago.verificado_en || pago.fecha_pago))}</span>`
                        : ""}
                </div>
            </div>`;
    }

    function htmlServicios(cargos, servicios) {
        const ordenados = [...cargos].sort((a, b) => {
            const sa = servicios.get(a.servicio_id) || {};
            const sb = servicios.get(b.servicio_id) || {};
            const ka = `${sa.fecha_servicio || ""} ${sa.hora_inicio || ""}`;
            const kb = `${sb.fecha_servicio || ""} ${sb.hora_inicio || ""}`;
            return ka.localeCompare(kb);
        });

        return `
            <div class="haiku-checkout-servicios">
                ${ordenados.map(cargo => {
                    const servicio = servicios.get(cargo.servicio_id) || {};
                    const catalogo = servicio.catalogo_servicios || {};
                    const nombre = catalogo.nombre || cargo.concepto || "Servicio";
                    const saldo = Number(cargo.saldo_cargo || 0);
                    const monto = Number(cargo.monto || 0);
                    const pagado = saldo <= 0;
                    const parcial = saldo > 0 && saldo < monto;

                    return `
                        <div class="haiku-checkout-servicio">
                            <div class="haiku-checkout-servicio-nombre">
                                <span>${escapar(horaCorta(servicio.hora_inicio))}</span>
                                <span>·</span>
                                <strong>${escapar(nombre)}</strong>
                            </div>
                            <div class="haiku-checkout-servicio-monto">
                                <strong>${dinero(monto)}</strong>
                                ${pagado
                                    ? `<small class="haiku-checkout-ok">✓ Pagado</small>`
                                    : parcial
                                        ? `<small>Pend. ${dinero(saldo)}</small>`
                                        : ""}
                            </div>
                        </div>`;
                }).join("")}
            </div>`;
    }

    function borradorInicial(saldo) {
        return {
            monto: Number(saldo || 0),
            medio: "",
            glosa: "",
            folio: "",
            codAut: "",
            manager: false
        };
    }

    function leerFormulario(tarjeta) {
        return {
            monto: Number(
                tarjeta.querySelector("[data-haiku-checkout-monto]")?.value || 0
            ),
            medio: tarjeta.querySelector("[data-haiku-checkout-medio]")?.value || "",
            glosa: tarjeta.querySelector("[data-haiku-checkout-glosa]")?.value.trim() || "",
            folio: tarjeta.querySelector("[data-haiku-checkout-folio]")?.value.trim() || "",
            codAut: tarjeta.querySelector("[data-haiku-checkout-codaut]")?.value.trim() || "",
            manager: tarjeta.querySelector("[data-haiku-checkout-manager]")?.checked === true
        };
    }

    function guardarBorrador(tarjeta) {
        const reservaId = tarjeta?.dataset?.reservaId;
        if (reservaId) borradores.set(reservaId, leerFormulario(tarjeta));
    }

    function actualizarCamposPorMedio(tarjeta) {
        const medioUI = tarjeta.querySelector("[data-haiku-checkout-medio]")?.value || "";
        const req = requisitosMedio(MEDIOS[medioUI] || "");

        [
            ["glosa", req.glosa],
            ["folio", req.folio],
            ["codaut", req.codAut]
        ].forEach(([campo, visible]) => {
            const fila = tarjeta.querySelector(`[data-haiku-checkout-campo-${campo}]`);
            const input = tarjeta.querySelector(`[data-haiku-checkout-${campo}]`);
            if (fila) fila.hidden = !visible;
            input?.toggleAttribute("required", visible);
        });
    }

    function htmlFormulario(saldo, borrador) {
        return `
            <div class="haiku-saldo-formulario" data-haiku-checkout-formulario>
                <div class="haiku-saldo-form-grid">
                    <label>
                        <span>Monto de este pago</span>
                        <div class="pago-checkin-input-monto">
                            <span>$</span>
                            <input
                                type="number"
                                data-haiku-checkout-monto
                                data-haiku-saldo-monto
                                min="1"
                                step="1000"
                                max="${saldo}"
                                value="${Number(borrador.monto || saldo)}"
                            >
                        </div>
                    </label>
                    <label>
                        <span>Medio de pago</span>
                        <select data-haiku-checkout-medio>${opcionesMedio(borrador.medio)}</select>
                    </label>
                </div>

                <div class="haiku-saldo-datos-dinamicos">
                    <label data-haiku-checkout-campo-glosa hidden>
                        <span>Glosa</span>
                        <input type="text" data-haiku-checkout-glosa value="${escapar(borrador.glosa)}" placeholder="Pegar glosa bancaria">
                    </label>
                    <label data-haiku-checkout-campo-folio hidden>
                        <span>Folio</span>
                        <input type="text" data-haiku-checkout-folio value="${escapar(borrador.folio)}" placeholder="Rellenar">
                    </label>
                    <label data-haiku-checkout-campo-codaut hidden>
                        <span>CodAut</span>
                        <input type="text" data-haiku-checkout-codaut value="${escapar(borrador.codAut)}" placeholder="Rellenar">
                    </label>
                    <label class="haiku-saldo-manager">
                        <span>Manager</span>
                        <span class="haiku-saldo-check-wrap">
                            <input type="checkbox" data-haiku-checkout-manager ${borrador.manager ? "checked" : ""}>
                            Revisado
                        </span>
                    </label>
                </div>

                <button
                    type="button"
                    class="haiku-saldo-registrar"
                    data-haiku-checkout-registrar
                >Registrar pago</button>
            </div>`;
    }

    function htmlBove(cierre, usuarios) {
        if (cierre?.bove_checkout) {
            const usuario = cierre.bove_checkout_registrado_por
                ? (usuarios.get(cierre.bove_checkout_registrado_por) || "Usuario HAIKU")
                : "Usuario HAIKU";

            return `
                <div class="haiku-bove-cierre haiku-bove-ok">
                    <strong>✓ BOVE Check-out registrado</strong>
                    <span>${escapar(cierre.bove_checkout)}</span>
                    <small>${escapar(usuario)}${cierre.bove_checkout_registrado_en
                        ? ` · ${escapar(fechaHora(cierre.bove_checkout_registrado_en))}`
                        : ""}</small>
                </div>`;
        }

        return `
            <div class="haiku-bove-cierre haiku-bove-pendiente">
                <strong>Pagos de servicios completos · falta BOVE final</strong>
                <span>Registra el BOVE emitido por el total de servicios cobrados al Check-out.</span>
                <div class="haiku-bove-fila">
                    <input type="text" data-haiku-checkout-bove placeholder="BOVE servicios">
                    <button type="button" data-haiku-checkout-bove-registrar>Registrar BOVE</button>
                </div>
            </div>`;
    }

    async function cargarCheckoutSupabase() {
        if (renderizando || !window.haikuSesion) return;

        const fecha = fechaActual();
        const lista = document.getElementById("pagos-lista-checkout");
        const contador = document.getElementById("pagos-contador-checkout");
        if (!fecha || !lista || !contador) return;

        renderizando = true;

        try {
            try {
                await window.haikuMigrarServiciosLegacySupabase?.();
            } catch (errorMigracion) {
                console.warn("HAIKU · Checkout continúa pese a migración parcial:", errorMigracion);
            }

            const salidas = await reservasCheckoutDia(fecha);
            const ids = [...new Set(salidas.map(item => item.reservaId))];

            const [cargos, pagos, cierres] = await Promise.all([
                cargosServicios(ids),
                pagosCheckout(ids),
                cierresBove(ids)
            ]);

            const servicios = await serviciosPorId(
                cargos.map(cargo => cargo.servicio_id)
            );

            const idsUsuarios = pagos.map(pago => pago.verificado_por);
            cierres.forEach(cierre =>
                idsUsuarios.push(cierre.bove_checkout_registrado_por)
            );
            const usuarios = await usuariosPorId(idsUsuarios);

            const cargosPorReserva = agruparPorReserva(cargos);
            const pagosPorReserva = agruparPorReserva(pagos);

            lista.innerHTML = "";
            let pendientes = 0;
            let tarjetas = 0;

            salidas.forEach(item => {
                const cargosReserva = cargosPorReserva.get(item.reservaId) || [];
                if (!cargosReserva.length) return;

                tarjetas++;

                const total = cargosReserva.reduce(
                    (suma, cargo) => suma + Number(cargo.monto || 0),
                    0
                );
                const saldo = cargosReserva.reduce(
                    (suma, cargo) => suma + Number(cargo.saldo_cargo || 0),
                    0
                );

                const pagosCompletos = saldo <= 0;
                const cierre = cierres.get(item.reservaId) || null;
                const cierreCompleto = pagosCompletos && Boolean(cierre?.bove_checkout);
                const pagosReserva = pagosPorReserva.get(item.reservaId) || [];

                if (!cierreCompleto) pendientes++;

                const cabanas = item.cabanas.length > 1
                    ? `CABS ${item.cabanas.join(" · ")}`
                    : `CAB ${item.cabanas[0] || "—"}`;

                const tarjeta = document.createElement("div");
                tarjeta.className =
                    "pago-checkout-item haiku-saldo-v4 haiku-checkout-v1" +
                    (cierreCompleto
                        ? " pago-checkin-completo"
                        : pagosCompletos
                            ? " haiku-bove-falta"
                            : "");

                tarjeta.dataset.reservaId = item.reservaId;
                tarjeta.dataset.haikuCheckoutV1 = "1";
                tarjeta.dataset.saldoServicios = String(saldo);

                const pagosHtml = pagosReserva
                    .map(pago => htmlPagoConfirmado(pago, usuarios))
                    .join("");

                const borrador = borradores.get(item.reservaId) || borradorInicial(saldo);
                if (!borradores.has(item.reservaId) && !pagosCompletos) {
                    borradores.set(item.reservaId, borrador);
                }

                tarjeta.innerHTML = `
                    <div class="pago-checkin-nuevo">
                        <div class="pago-checkin-cabecera">
                            <div class="pago-checkin-identidad">
                                <strong>${escapar(cabanas)}</strong>
                                <span>· ${escapar(item.titular || "Sin titular")}</span>
                            </div>
                            <span class="pago-checkin-estado">
                                ${cierreCompleto
                                    ? "✓ Completo"
                                    : pagosCompletos
                                        ? "BOVE pendiente"
                                        : "Pendiente"}
                            </span>
                        </div>

                        ${htmlServicios(cargosReserva, servicios)}

                        <div class="pago-checkin-resumen-nuevo haiku-checkout-resumen">
                            <div class="haiku-saldo-resumen-celda">
                                <span>Total servicios</span>
                                <strong>${dinero(total)}</strong>
                            </div>
                            <div class="haiku-saldo-resumen-celda">
                                <span>Saldo pendiente</span>
                                <strong>${dinero(saldo)}</strong>
                            </div>
                        </div>

                        ${pagosReserva.length
                            ? `
                                <details class="haiku-saldo-detalle">
                                    <summary>Ver detalle de pagos (${pagosReserva.length})</summary>
                                    <div class="haiku-saldo-pagos-lista">${pagosHtml}</div>
                                </details>`
                            : ""}

                        ${!pagosCompletos ? htmlFormulario(saldo, borrador) : ""}
                        ${pagosCompletos ? htmlBove(cierre, usuarios) : ""}
                    </div>`;

                lista.appendChild(tarjeta);
                actualizarCamposPorMedio(tarjeta);
            });

            contador.textContent = String(pendientes);

            if (!tarjetas) {
                lista.innerHTML = `
                    <p class="pagos-checkout-vacio">
                        No hay cobros pendientes de servicios.
                    </p>`;
            }

            console.info(
                "HAIKU · Cobros Check-out Supabase V1:",
                fecha,
                tarjetas,
                "reservas"
            );
        } catch (error) {
            console.error("HAIKU · Error cargando Cobros Check-out V1:", error);
            lista.innerHTML = `
                <p class="pagos-checkout-vacio">
                    No fue posible cargar los cobros de Check-out.
                </p>`;
        } finally {
            renderizando = false;
        }
    }

    function programarRender(ms = 80) {
        clearTimeout(timerRender);
        timerRender = setTimeout(cargarCheckoutSupabase, ms);
    }

    document.addEventListener("input", evento => {
        const tarjeta = evento.target.closest?.(".haiku-checkout-v1");
        if (!tarjeta) return;

        if (
            evento.target.matches(
                "[data-haiku-checkout-monto], [data-haiku-checkout-glosa], [data-haiku-checkout-folio], [data-haiku-checkout-codaut]"
            )
        ) {
            guardarBorrador(tarjeta);
        }
    }, true);

    document.addEventListener("change", evento => {
        const tarjeta = evento.target.closest?.(".haiku-checkout-v1");
        if (!tarjeta) return;

        if (evento.target.matches("[data-haiku-checkout-medio]")) {
            guardarBorrador(tarjeta);
            actualizarCamposPorMedio(tarjeta);
        } else if (evento.target.matches("[data-haiku-checkout-manager]")) {
            guardarBorrador(tarjeta);
        }
    }, true);

    document.addEventListener("click", async evento => {
        const boton = evento.target.closest?.("[data-haiku-checkout-registrar]");
        if (!boton || guardandoPago) return;

        const tarjeta = boton.closest(".haiku-checkout-v1");
        const reservaId = tarjeta?.dataset?.reservaId || "";
        if (!tarjeta || !reservaId) return;

        const datos = leerFormulario(tarjeta);
        const medioDB = MEDIOS[datos.medio] || "";
        const req = requisitosMedio(medioDB);
        const saldoActual = Number(tarjeta.dataset.saldoServicios || 0);

        if (datos.monto <= 0) return alert("Ingresa el monto de este pago.");
        if (saldoActual > 0 && datos.monto > saldoActual) {
            return alert(`El pago supera el saldo de servicios (${dinero(saldoActual)}).`);
        }
        if (!medioDB) return alert("Selecciona el medio de pago.");
        if (req.glosa && !datos.glosa) return alert("Transferencia requiere Glosa.");
        if (req.folio && !datos.folio) return alert("Este medio requiere Folio.");
        if (req.codAut && !datos.codAut) return alert("Este medio requiere CodAut.");
        if (!datos.manager) return alert("Manager debe revisar el pago antes de registrarlo.");
        if (!window.haikuTienePermiso?.("pagos.registrar")) {
            return alert("Tu usuario no tiene permiso para registrar pagos.");
        }
        if (!window.haikuTienePermiso?.("pagos.verificar")) {
            return alert("Tu usuario no tiene permiso para validar pagos como Manager.");
        }

        guardandoPago = true;
        const texto = boton.textContent;
        boton.disabled = true;
        boton.textContent = "Registrando…";

        try {
            const { error } = await cliente.rpc(
                "haiku_registrar_pago_checkout",
                {
                    p_reserva_id: reservaId,
                    p_monto: datos.monto,
                    p_medio_pago: medioDB,
                    p_glosa: datos.glosa || null,
                    p_folio: datos.folio || null,
                    p_codigo_autorizacion: datos.codAut || null,
                    p_manager_revisado: true
                }
            );

            if (error) throw error;

            borradores.delete(reservaId);
            await cargarCheckoutSupabase();
        } catch (error) {
            console.error("HAIKU · No fue posible registrar pago Check-out:", error);
            alert(error?.message || "No fue posible registrar el pago de Check-out.");
        } finally {
            guardandoPago = false;
            boton.disabled = false;
            boton.textContent = texto;
        }
    }, true);

    document.addEventListener("click", async evento => {
        const boton = evento.target.closest?.("[data-haiku-checkout-bove-registrar]");
        if (!boton || guardandoBove) return;

        const tarjeta = boton.closest(".haiku-checkout-v1");
        const reservaId = tarjeta?.dataset?.reservaId || "";
        const campo = tarjeta?.querySelector("[data-haiku-checkout-bove]");
        const bove = campo?.value.trim() || "";

        if (!reservaId) return;
        if (!bove) return alert("Ingresa el BOVE final de servicios.");
        if (!window.haikuTienePermiso?.("pagos.verificar")) {
            return alert("Tu usuario no tiene permiso para registrar el BOVE.");
        }

        guardandoBove = true;
        const texto = boton.textContent;
        boton.disabled = true;
        boton.textContent = "Guardando…";

        try {
            const { error } = await cliente.rpc(
                "haiku_registrar_bove_checkout",
                {
                    p_reserva_id: reservaId,
                    p_bove: bove
                }
            );

            if (error) throw error;
            window.dispatchEvent(new CustomEvent('haiku:bove-actualizado', {detail:{reservaId,tipo:'checkout'}}));
            await cargarCheckoutSupabase();
        } catch (error) {
            console.error("HAIKU · No fue posible registrar BOVE Check-out:", error);
            alert(error?.message || "No fue posible registrar el BOVE de Check-out.");
        } finally {
            guardandoBove = false;
            boton.disabled = false;
            boton.textContent = texto;
        }
    }, true);

    document.addEventListener("haiku:servicio-supabase-cambiado", () => {
        programarRender(120);
    });

    document.addEventListener("click", evento => {
        if (evento.target.closest?.('.menu-item[data-seccion="pagos"]')) {
            programarRender(100);
        }
    });

    window.addEventListener("haiku:auth-ready", () => {
        programarRender(320);
    });

    // Reemplaza la función legacy. Desde este punto, cualquier refresco del
    // apartado Check-out consulta cargos/pagos reales de PostgreSQL.
    window.cargarCobrosCheckout = cargarCheckoutSupabase;
    window.haikuCargarCheckoutSupabase = cargarCheckoutSupabase;

    const estilo = document.createElement("style");
    estilo.textContent = `
        #seccion-pagos .pago-checkout-item.haiku-checkout-v1 {
            padding: 0;
            overflow: hidden;
        }
        #seccion-pagos .haiku-checkout-servicios {
            display: grid;
            margin: 2px 0 12px;
            border-top: 1px solid #e5ebe7;
            border-bottom: 1px solid #e5ebe7;
        }
        #seccion-pagos .haiku-checkout-servicio {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            min-height: 42px;
            padding: 7px 2px;
        }
        #seccion-pagos .haiku-checkout-servicio + .haiku-checkout-servicio {
            border-top: 1px solid #edf1ee;
        }
        #seccion-pagos .haiku-checkout-servicio-nombre {
            display: flex;
            align-items: baseline;
            gap: 5px;
            min-width: 0;
            color: #334039;
            font-size: 11px;
        }
        #seccion-pagos .haiku-checkout-servicio-nombre > span:first-child {
            color: #68746d;
            font-variant-numeric: tabular-nums;
        }
        #seccion-pagos .haiku-checkout-servicio-nombre strong {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-weight: 650;
        }
        #seccion-pagos .haiku-checkout-servicio-monto {
            flex: 0 0 auto;
            display: grid;
            justify-items: end;
            gap: 2px;
            color: #263229;
            font-size: 11px;
        }
        #seccion-pagos .haiku-checkout-servicio-monto small {
            color: #8a6a2e;
            font-size: 9px;
        }
        #seccion-pagos .haiku-checkout-servicio-monto .haiku-checkout-ok {
            color: #2c7a4a;
        }
        #seccion-pagos .haiku-checkout-resumen {
            margin-top: 12px;
        }
        @media (max-width: 650px) {
            #seccion-pagos .haiku-checkout-servicio {
                align-items: flex-start;
            }
            #seccion-pagos .haiku-checkout-servicio-nombre {
                flex-wrap: wrap;
            }
        }
    `;
    document.head.appendChild(estilo);

    setTimeout(() => {
        if (window.haikuSesion) programarRender(0);
    }, 420);

    console.info("HAIKU · Cobros Check-out Supabase V1 preparado.");
})();
