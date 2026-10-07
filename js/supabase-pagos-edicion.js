// ========================================
// HAIKU · SUPABASE · PAGOS + EDICIÓN
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;

    if (!cliente) {
        console.error("HAIKU · Pagos/Edición Supabase: cliente no disponible.");
        return;
    }

    let guardandoEdicion = false;
    let guardandoAbono = false;

    const MAPA_MEDIOS = Object.freeze({
        "Transferencia": "transferencia",
        "WebPay Crédito": "webpay_credito",
        "WebPay Débito": "webpay_debito",
        "Tarjeta Crédito": "tarjeta_credito",
        "Tarjeta Débito": "tarjeta_debito",
        "Airbnb Prepaid Card": "airbnb_prepaid_card", "Efectivo": "efectivo"
    });

    const MAPA_MEDIOS_INVERSO = Object.freeze({
        transferencia: "Transferencia",
        webpay_credito: "WebPay Crédito",
        webpay_debito: "WebPay Débito",
        tarjeta_credito: "Tarjeta Crédito",
        tarjeta_debito: "Tarjeta Débito",
        airbnb_prepaid_card: "Airbnb Prepaid Card", efectivo: "Efectivo",
        otro: "Otro"
    });

    function escaparHTML(valor) {
        return String(valor ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function fechaActualSeleccionada() {
        try {
            return String(fechaSeleccionada || "").slice(0, 10);
        } catch {
            return "";
        }
    }

    function leerModoReserva() {
        try {
            return modoFormularioReserva;
        } catch {
            return "crear";
        }
    }

    function leerIdReservaEditando() {
        try {
            return String(reservaEditandoId || "");
        } catch {
            return "";
        }
    }

    function leerDatosFormularioReserva() {
        const titular =
            document.getElementById("reserva-nuevo-titular")?.value.trim() || "";
        const telefono =
            document.getElementById("reserva-nuevo-telefono")?.value.trim() || "";
        const rut =
            document.getElementById("reserva-nuevo-rut")?.value.trim() || "";
        const correo =
            document.getElementById("reserva-nuevo-correo")?.value.trim() || "";
        const observaciones =
            document.getElementById("reserva-nueva-observacion")?.value.trim() || "";

        const acompanantes = Array.from(
            document.querySelectorAll(".reserva-nuevo-acompanante")
        ).map(campo => campo.value.trim()).filter(Boolean);

        let llegada = "";
        let salida = "";
        let cabana = "";
        let tarifas = {};
        let adultos = 1;
        let ninos = 0;
        let mascotas = 0;

        try { llegada = fechaLlegadaReserva || ""; } catch {}
        try { salida = fechaSalidaReserva || ""; } catch {}
        try { cabana = cabanaSeleccionadaReserva || ""; } catch {}
        try { tarifas = { ...(tarifasNochesReserva || {}) }; } catch {}
        try { adultos = Number(adultosReserva ?? 1); } catch {}
        try { ninos = Number(ninosReserva ?? 0); } catch {}
        try { mascotas = Number(mascotasReserva ?? 0); } catch {}

        return {
            titular,
            telefono,
            rut,
            correo,
            observaciones,
            acompanantes,
            llegada,
            salida,
            cabana: Number(cabana),
            tarifas,
            adultos,
            ninos,
            mascotas
        };
    }

    async function actualizarReservaSupabase(reservaId, datos) {
        if (!window.haikuTienePermiso?.("reservas.editar")) {
            throw new Error("Tu usuario no tiene permiso para editar reservas.");
        }

        const { data, error } = await cliente.rpc(
            "haiku_actualizar_reserva",
            {
                p_reserva_id: reservaId,
                p_titular_nombre: datos.titular,
                p_cabana_numero: datos.cabana,
                p_fecha_ingreso: datos.llegada,
                p_fecha_salida: datos.salida,
                p_adultos: Math.max(0, datos.adultos),
                p_ninos: Math.max(0, datos.ninos),
                p_mascotas: Math.max(0, datos.mascotas),
                p_correo_contacto: datos.correo || null,
                p_telefono_contacto: datos.telefono || null,
                p_rut: datos.rut || null,
                p_observaciones: datos.observaciones || null,
                p_tarifas: datos.tarifas,
                p_acompanantes: datos.acompanantes
            }
        );

        if (error) throw error;
        return data;
    }

    // Captura antes de los listeners legacy y del puente de creación.
    document.addEventListener(
        "click",
        async evento => {
            const boton = evento.target.closest("#crear-nueva-reserva");
            if (!boton || leerModoReserva() !== "editar") return;

            evento.preventDefault();
            evento.stopPropagation();
            evento.stopImmediatePropagation();

            if (guardandoEdicion) return;

            const reservaId = leerIdReservaEditando();
            const datos = leerDatosFormularioReserva();

            if (!reservaId || !datos.titular || !datos.cabana || !datos.llegada || !datos.salida) {
                alert("Faltan datos obligatorios para guardar la edición.");
                return;
            }

            const textoAnterior = boton.textContent;
            guardandoEdicion = true;
            boton.disabled = true;
            boton.textContent = "Guardando en Supabase…";

            try {
                const resultado = await actualizarReservaSupabase(
                    reservaId,
                    datos
                );

                console.info(
                    "HAIKU · Reserva actualizada en Supabase:",
                    resultado
                );

                // La interfaz actual conserva su flujo/confirmación.
                // Ya no es la fuente de verdad: PostgreSQL se guardó primero.
                if (typeof guardarCambiosReservaEditada === "function") {
                    guardarCambiosReservaEditada();
                } else {
                    alert("Reserva actualizada correctamente.");
                }
            } catch (error) {
                console.error("HAIKU · No fue posible editar reserva:", error);
                alert(
                    error?.message ||
                    "No fue posible guardar los cambios de la reserva."
                );
            } finally {
                guardandoEdicion = false;
                boton.disabled = false;
                boton.textContent = textoAnterior;
            }
        },
        true
    );

    async function obtenerIngresosDia(fecha) {
        const { data, error } = await cliente.rpc(
            "haiku_operacion_dia",
            { p_fecha: fecha }
        );

        if (error) throw error;

        return (data || [])
            .filter(fila =>
                ["libre-ingresa", "sale-ingresa", "fullday"]
                    .includes(fila.estado_operativo)
            )
            .map(fila => ({
                numero: Number(fila.numero),
                titular:
                    fila.estado_operativo === "fullday"
                        ? fila.fullday_titular
                        : fila.ingreso_titular,
                reservaId:
                    fila.estado_operativo === "fullday"
                        ? fila.fullday_reserva_id
                        : fila.ingreso_reserva_id
            }))
            .filter(item => item.reservaId);
    }

    async function obtenerPagosAbono(reservaIds) {
        if (reservaIds.length === 0) return [];

        const { data, error } = await cliente
            .from("pagos")
            .select(
                "id,reserva_id,monto,medio_pago,estado,fecha_pago,creado_en"
            )
            .in("reserva_id", reservaIds)
            .eq("tipo_movimiento", "pago")
            .eq("etapa_operativa", "abono")
            .eq("estado", "confirmado")
            .order("fecha_pago", { ascending: true });

        if (error) throw error;
        return data || [];
    }

    function agruparAbonos(pagos) {
        const mapa = new Map();

        pagos.forEach(pago => {
            const actual = mapa.get(pago.reserva_id) || {
                total: 0,
                medios: new Set(),
                ultimo: null
            };

            actual.total += Number(pago.monto || 0);
            if (pago.medio_pago) actual.medios.add(pago.medio_pago);
            actual.ultimo = pago;
            mapa.set(pago.reserva_id, actual);
        });

        return mapa;
    }

    function opcionesMedio(valor = "") {
        const opciones = [
            "Transferencia",
            "WebPay Crédito",
            "WebPay Débito",
            "Tarjeta Crédito",
            "Tarjeta Débito",
            "Airbnb Prepaid Card", "Efectivo"
        ];

        return [
            `<option value="" ${valor === "" ? "selected" : ""}>Seleccionar...</option>`,
            ...opciones.map(opcion =>
                `<option value="${escaparHTML(valorMedio(opcion))}" ${(valor === opcion || valor === valorMedio(opcion)) ? "selected" : ""}>${escaparHTML(opcion)}</option>`
            )
        ].join("");
    }

    async function cargarAbonosSupabase() {
        const fecha = fechaActualSeleccionada();
        const lista = document.getElementById("pagos-lista-abonos");
        const contador = document.getElementById("pagos-contador-abonos");

        if (!fecha || !lista || !contador || !window.haikuSesion) return;

        try {
            const ingresos = await obtenerIngresosDia(fecha);
            const ids = [...new Set(ingresos.map(item => item.reservaId))];
            const pagos = await obtenerPagosAbono(ids);
            const porReserva = agruparAbonos(pagos);

            lista.innerHTML = "";

            let pendientes = 0;

            ingresos.forEach(item => {
                const abono = porReserva.get(item.reservaId);
                const confirmado = Number(abono?.total || 0) > 0;
                const medioDB =
                    abono?.medios?.size === 1
                        ? [...abono.medios][0]
                        : "";
                const medioUI = MAPA_MEDIOS_INVERSO[medioDB] || "";

                if (!confirmado) pendientes++;

                const tarjeta = document.createElement("div");
                tarjeta.className = "pago-abono-item";
                if (confirmado) tarjeta.classList.add("abono-verificado");
                tarjeta.dataset.reservaId = item.reservaId;

                tarjeta.innerHTML = `
                    <div class="pago-abono-nuevo">
                        <div class="pago-abono-cabecera">
                            <div class="pago-abono-identidad">
                                <strong>CAB ${item.numero}</strong>
                                <span>· ${escaparHTML(item.titular || "Sin titular")}</span>
                            </div>
                            <span class="pago-abono-estado">
                                ${confirmado ? "✓ Verificado" : "Pendiente"}
                            </span>
                        </div>

                        <div class="pago-abono-grid">
                            <label class="pago-abono-grupo">
                                <span class="pago-abono-label">Abono</span>
                                <div class="pago-abono-monto-wrap">
                                    <span>$</span>
                                    <input
                                        type="number"
                                        class="pago-abono-monto"
                                        data-pago-cabana="${item.numero}"
                                        value="${confirmado ? Number(abono.total) : ""}"
                                        min="0"
                                        step="1000"
                                        placeholder="0"
                                        ${confirmado ? "readonly" : ""}
                                    >
                                </div>
                            </label>

                            <label class="pago-abono-grupo">
                                <span class="pago-abono-label">Medio</span>
                                <select
                                    class="pago-abono-medio"
                                    data-pago-cabana="${item.numero}"
                                    ${confirmado ? "disabled" : ""}
                                >
                                    ${opcionesMedio(medioUI)}
                                </select>
                            </label>
                        </div>

                        <label class="pago-abono-verificacion">
                            <input
                                type="checkbox"
                                data-pago-abono="${item.numero}"
                                data-reserva-id="${item.reservaId}"
                                ${confirmado ? "checked" : ""}
                            >
                            <span>Confirmar abono</span>
                        </label>
                    </div>
                `;

                lista.appendChild(tarjeta);
            });

            contador.textContent = String(pendientes);

            if (ingresos.length === 0) {
                lista.innerHTML = `
                    <p class="pagos-checkout-vacio">
                        No hay ingresos para esta fecha.
                    </p>
                `;
            }

            console.info(
                "HAIKU · Abonos cargados desde Supabase:",
                fecha,
                ingresos.length
            );
        } catch (error) {
            console.error("HAIKU · No fue posible cargar abonos:", error);
        }
    }

    async function saldoReserva(reservaId) {
        const { data, error } = await cliente
            .from("vista_saldos_reserva")
            .select("saldo,total_cargos,total_pagado_neto")
            .eq("reserva_id", reservaId)
            .maybeSingle();

        if (error) throw error;
        return data || { saldo: 0, total_cargos: 0, total_pagado_neto: 0 };
    }

    document.addEventListener(
        "change",
        async evento => {
            const check = evento.target.closest("[data-pago-abono]");
            if (!check || !window.HAIKU_SUPABASE_CONFIG?.conectado) return;

            evento.preventDefault();
            evento.stopPropagation();
            evento.stopImmediatePropagation();

            const reservaId = check.dataset.reservaId || "";
            const numeroCabana = check.dataset.pagoAbono || "";
            const tarjeta = check.closest(".pago-abono-item");

            if (!reservaId || !tarjeta) return;

            // Un pago real no se "desmarca". Su anulación tendrá flujo propio.
            if (!check.checked) {
                check.checked = true;
                alert("Un abono confirmado no se elimina desmarcando el check. Usa la anulación de pago cuando esté habilitada.");
                return;
            }

            if (guardandoAbono) return;

            const monto = Number(
                tarjeta.querySelector(".pago-abono-monto")?.value || 0
            );
            const medioUI =
                tarjeta.querySelector(".pago-abono-medio")?.value || "";
            const medioDB = codigoMedio(medioUI);

            if (monto <= 0 || !medioDB) {
                check.checked = false;
                alert("Ingresa el monto del abono y selecciona el medio de pago.");
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
                const saldo = await saldoReserva(reservaId);
                if (monto > Number(saldo.saldo || 0)) {
                    throw new Error(
                        `El abono ($${monto.toLocaleString("es-CL")}) supera el saldo actual ($${Number(saldo.saldo || 0).toLocaleString("es-CL")}).`
                    );
                }

                const { data, error } = await cliente.rpc(
                    "haiku_registrar_pago",
                    {
                        p_reserva_id: reservaId,
                        p_monto: monto,
                        p_medio_pago: medioDB,
                        p_etapa_operativa: "abono",
                        p_fecha_pago: new Date().toISOString(),
                        p_folio: null,
                        p_codigo_autorizacion: null,
                        p_bove: null,
                        p_referencia_externa: null,
                        p_observaciones: `Abono registrado desde Pagos · CAB ${numeroCabana}`,
                        p_aplicaciones: [],
                        p_modo_aplicacion: "alojamiento"
                    }
                );

                if (error) throw error;

                console.info("HAIKU · Abono registrado en Supabase:", data);
                await cargarAbonosSupabase();
            } catch (error) {
                console.error("HAIKU · No fue posible registrar abono:", error);
                check.checked = false;
                alert(error?.message || "No fue posible registrar el abono.");
            } finally {
                guardandoAbono = false;
                check.disabled = false;
            }
        },
        true
    );

    document.addEventListener("click", evento => {
        const boton = evento.target.closest('[data-seccion="pagos"]');
        if (!boton) return;

        setTimeout(cargarAbonosSupabase, 60);
    });

    window.addEventListener("haiku:auth-ready", () => {
        setTimeout(() => {
            const seccion = document.getElementById("seccion-pagos");
            if (seccion?.classList.contains("activa")) {
                cargarAbonosSupabase();
            }
        }, 80);
    });

    window.haikuCargarAbonosSupabase = cargarAbonosSupabase;

    console.info("HAIKU · Pagos + edición Supabase activos.");

    function codigoMedio(valor) { return valor === "airbnb_prepaid_card" ? valor : MAPA_MEDIOS[valor] || ""; }
    function valorMedio(nombre) { return nombre === "Airbnb Prepaid Card" ? "airbnb_prepaid_card" : nombre; }
})();
