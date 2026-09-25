// ========================================
// HAIKU · WEBPAY SUPABASE V1
// Pendiente → asociación → pago real
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;

    if (!cliente) {
        console.error("HAIKU · WebPay V1: Supabase no disponible.");
        return;
    }

    let reservasCache = [];

    function moneda(valor) {
        return `$${Number(valor || 0).toLocaleString("es-CL")}`;
    }

    function fechaCorta(fecha) {
        if (!fecha) return "—";
        const soloFecha = String(fecha).slice(0, 10);
        const [a, m, d] = soloFecha.split("-");
        return a && m && d ? `${d}-${m}-${a}` : soloFecha;
    }

    function fechaHora(fecha) {
        if (!fecha) return "—";
        try {
            return new Intl.DateTimeFormat("es-CL", {
                dateStyle: "short",
                timeStyle: "short"
            }).format(new Date(fecha));
        } catch {
            return String(fecha);
        }
    }

    function textoMedio(medio) {
        if (medio === "webpay_credito") return "WebPay Crédito";
        if (medio === "webpay_debito") return "WebPay Débito";
        return medio || "WebPay";
    }

    function normalizar(texto) {
        return String(texto || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function configurarFormulario() {
        const tipo = document.getElementById("pagos-webpay-tipo");
        const fechaPago = document.getElementById("pagos-webpay-fecha-pago");
        const fechaReserva = document.getElementById("pagos-webpay-fecha-reserva");
        const tarjeta = document.getElementById("pagos-webpay-tarjeta");
        const cabana = document.getElementById("pagos-webpay-cabana");
        const boton = document.getElementById("pagos-webpay-agregar");
        const contenedor = document.querySelector(".pagos-webpay-nuevo");

        if (tipo) {
            tipo.innerHTML = `
                <option value="">Seleccionar...</option>
                <option value="webpay_credito">WebPay Crédito</option>
                <option value="webpay_debito">WebPay Débito</option>
            `;
            const label = tipo.closest(".pagos-webpay-campo")?.querySelector("label");
            if (label) label.textContent = "Medio WebPay";
        }

        if (fechaPago && !fechaPago.value) {
            const hoy = new Date();
            const a = hoy.getFullYear();
            const m = String(hoy.getMonth() + 1).padStart(2, "0");
            const d = String(hoy.getDate()).padStart(2, "0");
            fechaPago.value = `${a}-${m}-${d}`;
        }

        if (fechaReserva) {
            const label = fechaReserva.closest(".pagos-webpay-campo")?.querySelector("label");
            if (label) label.textContent = "Fecha reserva (referencia)";
        }

        if (cabana) {
            const label = cabana.closest(".pagos-webpay-campo")?.querySelector("label");
            if (label) label.textContent = "Cabaña (referencia)";
        }

        if (tarjeta) {
            const label = tarjeta.closest(".pagos-webpay-campo")?.querySelector("label");
            if (label) label.textContent = "Tarjeta (enmascarada, opcional)";
            tarjeta.placeholder = "Ej: 548742XXXXXX7786 Mastercard";
        }

        if (boton) {
            boton.textContent = "+ Registrar WebPay pendiente";
        }

        if (contenedor && !contenedor.querySelector(".haiku-webpay-ayuda")) {
            const ayuda = document.createElement("div");
            ayuda.className = "haiku-webpay-ayuda";
            ayuda.innerHTML = `
                <strong>Ingreso administrativo</strong>
                <span>Se guarda primero como pendiente. Luego se asocia a la reserva correcta sin duplicar el pago.</span>
            `;
            contenedor.prepend(ayuda);
        }
    }

    async function cargarReservas() {
        const [rReservas, rEstadias, rCabanas] = await Promise.all([
            cliente
                .from("reservas")
                .select("id,titular_nombre,codigo_haiku,estado_reserva")
                .neq("estado_reserva", "cancelada"),
            cliente
                .from("reserva_estadias")
                .select("reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia"),
            cliente
                .from("cabanas")
                .select("id,numero")
        ]);

        if (rReservas.error) throw rReservas.error;
        if (rEstadias.error) throw rEstadias.error;
        if (rCabanas.error) throw rCabanas.error;

        const numeroPorCabana = new Map(
            (rCabanas.data || []).map(c => [c.id, c.numero])
        );

        const estadiasPorReserva = new Map();
        (rEstadias.data || []).forEach(e => {
            if (!estadiasPorReserva.has(e.reserva_id)) {
                estadiasPorReserva.set(e.reserva_id, []);
            }
            estadiasPorReserva.get(e.reserva_id).push({
                ...e,
                numeroCabana: numeroPorCabana.get(e.cabana_id) || "?"
            });
        });

        reservasCache = (rReservas.data || []).map(r => {
            const estadias = estadiasPorReserva.get(r.id) || [];
            const fechas = estadias
                .map(e => e.fecha_ingreso)
                .filter(Boolean)
                .sort();
            const salidas = estadias
                .map(e => e.fecha_salida)
                .filter(Boolean)
                .sort();
            const cabanas = [...new Set(estadias.map(e => e.numeroCabana))];

            return {
                ...r,
                estadias,
                fechaIngreso: fechas[0] || "",
                fechaSalida: salidas[salidas.length - 1] || "",
                cabanas
            };
        });
        return reservasCache;
    }

    function puntuarReserva(reserva, pago) {
        const origen = pago.datos_origen || {};
        const cabanaRef = Number(origen.cabana_referencia || 0);
        const fechaRef = String(origen.fecha_reserva_referencia || "").slice(0, 10);
        const nombrePago = normalizar(pago.pagador_nombre);
        const nombreReserva = normalizar(reserva.titular_nombre);
        let puntos = 0;

        if (cabanaRef && reserva.cabanas.includes(cabanaRef)) puntos += 4;

        if (
            nombrePago &&
            nombreReserva &&
            (nombrePago.includes(nombreReserva) || nombreReserva.includes(nombrePago))
        ) {
            puntos += 3;
        }

        if (fechaRef) {
            const coincideRango = reserva.estadias.some(e =>
                fechaRef >= e.fecha_ingreso && fechaRef <= e.fecha_salida
            );
            if (coincideRango) puntos += 3;
        }

        return puntos;
    }

    function opcionesReservas(pago, reservas = reservasCache) {
        return [...reservas]
            .map(r => ({ ...r, puntos: puntuarReserva(r, pago) }))
            .sort((a, b) => {
                if (b.puntos !== a.puntos) return b.puntos - a.puntos;
                return String(b.fechaIngreso).localeCompare(String(a.fechaIngreso));
            })
            .map(r => {
                const cabanas = r.cabanas.length
                    ? `CAB ${r.cabanas.join("/")}`
                    : "Sin CAB";
                const rango = r.fechaIngreso
                    ? `${fechaCorta(r.fechaIngreso)} → ${fechaCorta(r.fechaSalida)}`
                    : "Sin fechas";
                const marca = r.puntos >= 4 ? "★ " : "";
                const codigo = r.codigo_haiku ? ` · ${r.codigo_haiku}` : "";
                return `<option value="${r.id}">${marca}${cabanas} · ${r.titular_nombre}${codigo} · ${rango}</option>`;
            })
            .join("");
    }

    async function cargarPendientes(opciones = {}) {
        if (!opciones.preparacion && window.HAIKU_PAGOS_REFRESH_V1?.interceptar("webpay")) return;
        const lista = opciones.lista || document.getElementById("pagos-lista-webpay");
        const contador = opciones.contador || document.getElementById("pagos-contador-webpay");

        if (!lista || !contador) return;

        if (!opciones.preparacion) lista.innerHTML = `<p class="pagos-checkout-vacio">Cargando WebPay desde Supabase…</p>`;

        try {
            let reservas = [];
            let candidatosDisponibles = true;
            try { reservas = await cargarReservas(); }
            catch (errorCandidatos) {
                candidatosDisponibles = false;
                console.warn("HAIKU · Candidatos WebPay no disponibles:", errorCandidatos);
            }

            const { data, error } = await cliente
                .from("pagos")
                .select("id,monto,medio_pago,estado,fecha_pago,codigo_autorizacion,pagador_nombre,pagador_documento,datos_origen,creado_en")
                .eq("tipo_movimiento", "pago")
                .eq("estado", "pendiente_asociacion")
                .in("medio_pago", ["webpay_credito", "webpay_debito"])
                .order("fecha_pago", { ascending: false });

            if (error) throw error;

            const pendientes = data || [];
            if (opciones.preparacion && pendientes.some(pago =>
                pago.monto == null || !Number.isFinite(Number(pago.monto)))) {
                throw new Error("No está disponible el monto de un WebPay pendiente.");
            }
            if (!opciones.preparacion && window.HAIKU_PAGOS_REFRESH_V1?.interceptar("webpay-en-vuelo")) return;
            contador.textContent = pendientes.length;
            lista.innerHTML = "";

            if (!pendientes.length) {
                lista.innerHTML = `
                    <p class="pagos-checkout-vacio sites-pagos-vacio-canonico">
                        No hay WebPay pendientes de asociar.
                    </p>
                `;
                return opciones.preparacion ? { lista, contador, pendientes, reservas, candidatosDisponibles, webpayScope: "global" } : undefined;
            }

            pendientes.forEach(pago => {
                const origen = pago.datos_origen || {};
                const tarjeta = origen.tarjeta_referencia || "";
                const cabana = origen.cabana_referencia || "";
                const fechaReserva = origen.fecha_reserva_referencia || "";

                const tarjetaEl = document.createElement("div");
                tarjetaEl.className = "pago-webpay-item haiku-webpay-pendiente";
                tarjetaEl.dataset.webpayPagoId = pago.id;

                tarjetaEl.innerHTML = `
                    <div class="haiku-webpay-header">
                        <div>
                            <strong>${textoMedio(pago.medio_pago)}</strong>
                            <span>${pago.pagador_nombre || "Sin nombre"}</span>
                        </div>
                        <span class="haiku-webpay-badge">Pendiente de asociar</span>
                    </div>

                    <div class="haiku-webpay-monto">${moneda(pago.monto)}</div>

                    <div class="haiku-webpay-datos">
                        <div><span>RUT</span><strong>${pago.pagador_documento || "—"}</strong></div>
                        <div><span>CodAut</span><strong>${pago.codigo_autorizacion || "—"}</strong></div>
                        <div><span>Fecha pago</span><strong>${fechaHora(pago.fecha_pago)}</strong></div>
                        <div><span>CAB ref.</span><strong>${cabana ? `CAB ${cabana}` : "—"}</strong></div>
                        <div><span>Fecha reserva ref.</span><strong>${fechaReserva ? fechaCorta(fechaReserva) : "—"}</strong></div>
                        <div><span>Tarjeta</span><strong>${tarjeta || "—"}</strong></div>
                    </div>

                    <div class="haiku-webpay-asociacion">
                        <label>
                            <span>Asociar a reserva</span>
                            <select data-webpay-reserva>
                                <option value="">${candidatosDisponibles ? "Seleccionar reserva…" : "Candidatos no disponibles"}</option>
                                ${opcionesReservas(pago, reservas)}
                            </select>
                        </label>

                        <label>
                            <span>¿Qué cubre este WebPay?</span>
                            <select data-webpay-destino>
                                <option value="">Seleccionar…</option>
                                <option value="abono">Abono / confirmación</option>
                                <option value="saldo">Saldo alojamiento</option>
                                <option value="servicios">Servicios Check-out</option>
                            </select>
                        </label>

                        <label class="haiku-webpay-manager">
                            <input type="checkbox" data-webpay-manager>
                            <span>Manager · Revisado</span>
                        </label>

                        <div class="haiku-webpay-acciones">
                            <button type="button" class="haiku-webpay-confirmar" data-webpay-confirmar ${candidatosDisponibles ? "" : "disabled"}>
                                Asociar y confirmar
                            </button>
                            <button type="button" class="haiku-webpay-anular" data-webpay-anular>
                                Anular
                            </button>
                        </div>
                    </div>
                `;

                lista.appendChild(tarjetaEl);
            });
            if (opciones.preparacion) return { lista, contador, pendientes, reservas, candidatosDisponibles, webpayScope: "global" };
        } catch (error) {
            if (opciones.preparacion) throw error;
            if (window.HAIKU_PAGOS_REFRESH_V1?.interceptar("webpay-error-en-vuelo")) return;
            console.error("HAIKU · WebPay: error al cargar pendientes", error);
            lista.innerHTML = `
                <p class="pagos-checkout-vacio sites-pagos-vacio-canonico">
                    No fue posible cargar WebPay desde Supabase.
                </p>
            `;
        }
    }

    async function registrarPendiente() {
        const nombre = document.getElementById("pagos-webpay-nombre");
        const rut = document.getElementById("pagos-webpay-rut");
        const cabana = document.getElementById("pagos-webpay-cabana");
        const monto = document.getElementById("pagos-webpay-monto");
        const codAut = document.getElementById("pagos-webpay-codaut");
        const tipo = document.getElementById("pagos-webpay-tipo");
        const fechaPago = document.getElementById("pagos-webpay-fecha-pago");
        const fechaReserva = document.getElementById("pagos-webpay-fecha-reserva");
        const tarjeta = document.getElementById("pagos-webpay-tarjeta");
        const boton = document.getElementById("pagos-webpay-agregar");

        const montoNumero = Number(monto?.value || 0);
        const medio = tipo?.value || "";
        const codigo = codAut?.value.trim() || "";

        if (!montoNumero || montoNumero <= 0 || !medio || !codigo) {
            alert("Completa Monto, Medio WebPay y CodAut.");
            return;
        }

        if (!['webpay_credito', 'webpay_debito'].includes(medio)) {
            alert("Selecciona WebPay Crédito o WebPay Débito.");
            return;
        }

        try {
            if (boton) {
                boton.disabled = true;
                boton.textContent = "Guardando en Supabase…";
            }

            const { data: repetidos, error: errorRepetidos } = await cliente
                .from("pagos")
                .select("id,estado")
                .eq("tipo_movimiento", "pago")
                .eq("medio_pago", medio)
                .eq("codigo_autorizacion", codigo)
                .eq("monto", montoNumero)
                .neq("estado", "anulado")
                .limit(1);

            if (errorRepetidos) throw errorRepetidos;

            if ((repetidos || []).length) {
                const continuar = confirm(
                    "Ya existe un WebPay no anulado con el mismo CodAut, medio y monto.\n\n¿Quieres registrarlo de todas formas?"
                );
                if (!continuar) return;
            }

            const fechaPagoIso = fechaPago?.value
                ? new Date(`${fechaPago.value}T12:00:00`).toISOString()
                : new Date().toISOString();

            const { data, error } = await cliente.rpc(
                "haiku_registrar_webpay_pendiente",
                {
                    p_monto: montoNumero,
                    p_medio_pago: medio,
                    p_codigo_autorizacion: codigo,
                    p_pagador_nombre: nombre?.value.trim() || null,
                    p_pagador_documento: rut?.value.trim() || null,
                    p_fecha_pago: fechaPagoIso,
                    p_cabana_referencia: cabana?.value ? Number(cabana.value) : null,
                    p_fecha_reserva_referencia: fechaReserva?.value || null,
                    p_tarjeta_referencia: tarjeta?.value.trim() || null,
                    p_tipo_webpay: "manual"
                }
            );

            if (error) throw error;

            console.log("HAIKU · WebPay pendiente creado en Supabase:", data);

            if (nombre) nombre.value = "";
            if (rut) rut.value = "";
            if (cabana) cabana.value = "";
            if (monto) monto.value = "";
            if (codAut) codAut.value = "";
            if (tipo) tipo.value = "";
            if (fechaReserva) fechaReserva.value = "";
            if (tarjeta) tarjeta.value = "";

            await window.HAIKU_PAGOS_REFRESH_V1?.escrituraConfirmada("registrar WebPay pendiente");
            await cargarPendientes();
        } catch (error) {
            console.error("HAIKU · WebPay: no fue posible registrar pendiente", error);
            alert(error?.message || "No fue posible registrar el WebPay.");
        } finally {
            if (boton) {
                boton.disabled = false;
                boton.textContent = "+ Registrar WebPay pendiente";
            }
        }
    }

    async function asociarTarjeta(tarjetaEl) {
        const pagoId = tarjetaEl?.dataset.webpayPagoId;
        const reservaId = tarjetaEl?.querySelector("[data-webpay-reserva]")?.value || "";
        const destino = tarjetaEl?.querySelector("[data-webpay-destino]")?.value || "";
        const manager = tarjetaEl?.querySelector("[data-webpay-manager]")?.checked === true;
        const boton = tarjetaEl?.querySelector("[data-webpay-confirmar]");

        if (!pagoId || !reservaId || !destino) {
            alert("Selecciona la reserva y qué cubre este WebPay.");
            return;
        }

        if (!manager) {
            alert("Marca Manager · Revisado antes de confirmar.");
            return;
        }

        try {
            if (boton) {
                boton.disabled = true;
                boton.textContent = "Confirmando…";
            }

            const { data, error } = await cliente.rpc("haiku_asociar_webpay", {
                p_pago_id: pagoId,
                p_reserva_id: reservaId,
                p_destino: destino,
                p_manager_revisado: true
            });

            if (error) throw error;

            console.log("HAIKU · WebPay asociado y confirmado:", data);

            await window.HAIKU_PAGOS_REFRESH_V1?.escrituraConfirmada("asociar WebPay");
            await cargarPendientes();

            if (typeof window.cargarAbonosPagos === "function") {
                await window.cargarAbonosPagos();
            }
            if (typeof window.cargarSaldosCheckin === "function") {
                await window.cargarSaldosCheckin();
            }
            if (typeof window.cargarCobrosCheckout === "function") {
                await window.cargarCobrosCheckout();
            }
        } catch (error) {
            console.error("HAIKU · WebPay: no fue posible asociar", error);
            alert(error?.message || "No fue posible asociar el WebPay.");
        } finally {
            if (boton && boton.isConnected) {
                boton.disabled = false;
                boton.textContent = "Asociar y confirmar";
            }
        }
    }

    async function anularTarjeta(tarjetaEl) {
        const pagoId = tarjetaEl?.dataset.webpayPagoId;
        if (!pagoId) return;

        const confirmar = confirm(
            "¿Anular este WebPay pendiente?\n\nNo se borrará: quedará registrado en el historial."
        );
        if (!confirmar) return;

        try {
            const { error } = await cliente.rpc("haiku_anular_webpay_pendiente", {
                p_pago_id: pagoId
            });
            if (error) throw error;
            await window.HAIKU_PAGOS_REFRESH_V1?.escrituraConfirmada("anular WebPay pendiente");
            await cargarPendientes();
        } catch (error) {
            console.error("HAIKU · WebPay: no fue posible anular", error);
            alert(error?.message || "No fue posible anular el WebPay.");
        }
    }

    document.addEventListener("click", evento => {
        const agregar = evento.target.closest("#pagos-webpay-agregar");
        if (agregar) {
            evento.preventDefault();
            evento.stopImmediatePropagation();
            registrarPendiente();
            return;
        }

        const confirmar = evento.target.closest("[data-webpay-confirmar]");
        if (confirmar) {
            evento.preventDefault();
            evento.stopImmediatePropagation();
            asociarTarjeta(confirmar.closest("[data-webpay-pago-id]"));
            return;
        }

        const anular = evento.target.closest("[data-webpay-anular]");
        if (anular) {
            evento.preventDefault();
            evento.stopImmediatePropagation();
            anularTarjeta(anular.closest("[data-webpay-pago-id]"));
        }
    }, true);

    // Sobrescribir la lectura legacy. A partir de aquí WebPay se lee desde Supabase.
    window.cargarWebpayPendientes = cargarPendientes;
    window.HAIKU_WEBPAY_PAGOS_V1 = Object.freeze({
        preparar: () => cargarPendientes({ lista: document.createElement("div"), contador: document.createElement("strong"), preparacion: true })
    });

    configurarFormulario();
    cargarPendientes();

    document.addEventListener("haiku:supabase-ready", () => {
        configurarFormulario();
        cargarPendientes();
    });

    console.log("HAIKU · WebPay Supabase V1 activo.");
})();
