// ========================================
// HAIKU · FICHA · ESTADOS MANUALES SUPABASE V3
// Confirmada / Hospedado / Checked Out son reversibles.
// La protección temporal de Checked Out vive en Supabase.
// Sin observers, intervalos ni parches globales.
// ========================================

(() => {
    "use strict";

    if (window.HAIKU_FICHA_ESTADOS_MANUALES_V3) return;

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let guardando = false;

    function cerrarMenuEstado() {
        try {
            if (typeof cerrarMenuEstadoFicha === "function") {
                cerrarMenuEstadoFicha();
                return;
            }
        } catch (_) {}

        const menu = document.getElementById("ficha-reserva-estado-menu");
        if (menu) menu.hidden = true;
    }

    function pintarEstado(estado) {
        const campo = document.getElementById("ficha-reserva-estado");
        if (!campo) return;

        campo.classList.remove(
            "ficha-estado-hospedado",
            "ficha-estado-checkout",
            "ficha-estado-pendiente",
            "ficha-estado-confirmada",
            "ficha-estado-confirmacion-pendiente",
            "ficha-estado-cancelada",
            "ficha-estado-no-show"
        );

        if (estado === "hospedado") {
            campo.textContent = "● Hospedado";
            campo.classList.add("ficha-estado-hospedado");
            return;
        }

        if (estado === "checked-out") {
            campo.textContent = "● Checked Out";
            campo.classList.add("ficha-estado-checkout");
            return;
        }

        if (estado === "confirmada") {
            campo.textContent = "● Confirmada";
            campo.classList.add("ficha-estado-confirmada");
        }
    }

    function fechaDentroDeEstadia(estadia, fecha) {
        const f = String(fecha || "").slice(0, 10);
        const ingreso = String(estadia?.fecha_ingreso || "").slice(0, 10);
        const salida = String(estadia?.fecha_salida || "").slice(0, 10);
        if (!f || !ingreso || !salida) return false;

        if (String(estadia?.tipo_estadia || "") === "fullday") {
            return f === ingreso;
        }

        return f >= ingreso && f <= salida;
    }

    async function resolverEstadia(reservaId, numeroCabana) {
        const { data, error } = await cliente.rpc("haiku_ficha_reserva_core", {
            p_reserva_id: reservaId
        });

        if (error) throw error;

        const estadias = Array.isArray(data?.estadias) ? data.estadias : [];
        if (!estadias.length) {
            throw new Error("La reserva no tiene una estadía activa disponible.");
        }

        const cabana = String(numeroCabana || "");
        const fecha = (() => {
            try { return String(fechaSeleccionada || "").slice(0, 10); }
            catch (_) { return ""; }
        })();

        const mismaCabanaYFecha = estadias.find(estadia =>
            String(estadia?.cabana_numero || "") === cabana &&
            fechaDentroDeEstadia(estadia, fecha)
        );
        if (mismaCabanaYFecha) return mismaCabanaYFecha;

        const mismaCabana = estadias.find(estadia =>
            String(estadia?.cabana_numero || "") === cabana
        );
        if (mismaCabana) return mismaCabana;

        const mismaFecha = estadias.find(estadia =>
            fechaDentroDeEstadia(estadia, fecha)
        );
        if (mismaFecha) return mismaFecha;

        if (estadias.length === 1) return estadias[0];

        throw new Error("No fue posible determinar con seguridad qué estadía debe modificarse.");
    }

    function limpiarCheckoutOperativo(estadia) {
        const reservaId = String(estadia?.reserva_id || "");
        const cabana = String(estadia?.cabana_numero || "");
        const salida = String(estadia?.fecha_salida || "").slice(0, 10);

        try {
            Object.values(datosPorFecha || {}).forEach(dia => {
                if (!dia?.cabanas) return;
                Object.values(dia.cabanas).forEach(registro => {
                    if (String(registro?.reservaId || "") !== reservaId) return;
                    registro.checkout = "";
                    registro.checkoutRealizado = false;
                });
            });
        } catch (_) {}

        try {
            if (cabana && salida && typeof obtenerDatosDia === "function") {
                const diaSalida = obtenerDatosDia(salida);
                const registro = diaSalida?.cabanas?.[cabana];
                if (registro) {
                    registro.checkout = "";
                    registro.checkoutRealizado = false;
                }
            }
        } catch (_) {}

        try { if (typeof guardarDatos === "function") guardarDatos(); } catch (_) {}
    }

    async function refrescarInterfaz() {
        try { await window.haikuSincronizarReservasSupabase?.(); } catch (_) {}
        try { await window.HAIKU_OPERACION_RESUMEN_FIX_V1?.refrescar?.(); } catch (_) {}

        // Primero reconstruimos la fila con los datos frescos.
        try {
            if (typeof cargarCabanasDia === "function") {
                cargarCabanasDia(fechaSeleccionada, {
                    evento: "estado de hospedaje confirmado", tipo: "externo"
                });
            }
        } catch (_) {}

        // Después aplicamos la jerarquía final de colores y checkout.
        try { await window.HAIKU_CHECKOUT_RESUMEN_V2?.refrescar?.(); } catch (_) {}

        try {
            if (typeof generarCalendario === "function") {
                generarCalendario();
            }
        } catch (_) {}
        try {
            if (typeof actualizarResumenDia === "function") {
                actualizarResumenDia(fechaSeleccionada);
            }
        } catch (_) {}
        try {
            if (typeof generarResumenOperativo === "function") {
                generarResumenOperativo(fechaSeleccionada);
            }
        } catch (_) {}

        // Los resúmenes auxiliares pueden tocar la fila; reafirmamos sólo los
        // colores operativos al final, sin volver a consultar ni reconstruir.
        try { window.HAIKU_CHECKOUT_RESUMEN_V2?.aplicarColores?.(); } catch (_) {}
    }

    function pedirConfirmacionReversion(estadoElegido, estadia) {
        const estadoDB = String(estadia?.estado_estadia || "").toLowerCase();
        const tieneCheckin = Boolean(estadia?.checkin_realizado_en);
        const tieneCheckout = Boolean(estadia?.checkout_realizado_en) || estadoDB === "checked_out";

        if (estadoElegido === "confirmada" && (tieneCheckin || tieneCheckout)) {
            return window.confirm(
                "¿Volver esta estadía a Confirmada?\n\n" +
                "Se limpiarán el Check-in y el Check-out registrados para esta estadía."
            );
        }

        if (estadoElegido === "hospedado" && tieneCheckout) {
            return window.confirm(
                "¿Volver esta estadía a Hospedado?\n\n" +
                "Se eliminará el Check-out registrado y la estadía volverá a quedar activa."
            );
        }

        return true;
    }

    async function ejecutarCambio(opcion, estadoElegido) {
        if (guardando) return;

        const modal = document.getElementById("ficha-reserva-modal");
        const reservaId = String(modal?.dataset?.reservaId || "");
        const numeroCabana = String(modal?.dataset?.numeroCabana || "");

        if (!reservaId) {
            alert("No fue posible identificar la reserva abierta.");
            return;
        }

        guardando = true;
        const textoOriginal = opcion.textContent;
        opcion.disabled = true;
        opcion.textContent = "Guardando…";
        cerrarMenuEstado();

        try {
            const estadia = await resolverEstadia(reservaId, numeroCabana);

            if (!pedirConfirmacionReversion(estadoElegido, estadia)) return;

            const mapaEstado = {
                hospedado: "hospedada",
                confirmada: "confirmada",
                "checked-out": "checked_out"
            };
            const estadoDB = mapaEstado[estadoElegido];
            if (!estadoDB) return;

            const actual = String(estadia?.estado_estadia || "").toLowerCase();
            const yaEs = actual === estadoDB && (
                estadoDB !== "checked_out" || Boolean(estadia?.checkout_realizado_en)
            );

            if (!yaEs) {
                const { error } = await cliente.rpc("haiku_cambiar_estado_estadia", {
                    p_estadia_id: estadia.id,
                    p_estado: estadoDB
                });
                if (error) throw error;
            }

            if (estadoDB !== "checked_out") {
                limpiarCheckoutOperativo(estadia);
            }

            await refrescarInterfaz();
            pintarEstado(estadoElegido);

            console.info(
                "HAIKU · Estado manual guardado:",
                estadoDB,
                reservaId,
                estadia.id
            );
        } catch (error) {
            console.error("HAIKU · No fue posible cambiar el estado manual:", error);
            alert(error?.message || "No fue posible cambiar el estado. La reserva no fue modificada.");

            try { await refrescarInterfaz(); } catch (_) {}
        } finally {
            guardando = false;
            opcion.disabled = false;
            opcion.textContent = textoOriginal;
        }
    }

    document.addEventListener("click", evento => {
        const opcion = evento.target?.closest?.("[data-ficha-estado-opcion]");
        if (!opcion) return;

        const estadoElegido = String(opcion.dataset.fichaEstadoOpcion || "");
        if (!["hospedado", "confirmada", "checked-out"].includes(estadoElegido)) {
            return;
        }

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();

        ejecutarCambio(opcion, estadoElegido);
    }, true);

    const api = Object.freeze({
        cambiar: ejecutarCambio
    });

    window.HAIKU_FICHA_ESTADOS_MANUALES_V3 = api;
    window.HAIKU_FICHA_ESTADOS_MANUALES_V2 = api;
    window.HAIKU_FICHA_HOSPEDADO_V1 = api;

    console.info("HAIKU · Estados manuales reversibles conectados a Supabase V3.");
})();
