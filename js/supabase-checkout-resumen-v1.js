// ========================================
// HAIKU · CHECKED OUT · RESUMEN V2
// Une checkout real Supabase + hora operativa del Resumen.
// SALE/LIBRE amarillo; checkout azul; nuevo check-in verde.
// Sin observers, intervalos, polling ni parches globales.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_CHECKOUT_RESUMEN_V2) return;

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let refrescando = false;
    let guardandoHora = false;

    function instalarCss() {
        if (document.querySelector('link[data-haiku-checkout-resumen-v2]')) return;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "css/supabase-checkout-resumen-v2.css?v=1";
        link.dataset.haikuCheckoutResumenV2 = "1";
        document.head.appendChild(link);
    }

    function fechaActualResumen() {
        try {
            return String(fechaSeleccionada || "").slice(0, 10);
        } catch (_) {
            return "";
        }
    }

    function horaChile(iso) {
        if (!iso) return "";
        try {
            const partes = new Intl.DateTimeFormat("en-GB", {
                timeZone: "America/Santiago",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            }).formatToParts(new Date(iso));
            const mapa = Object.fromEntries(partes.map(p => [p.type, p.value]));
            return `${mapa.hour}:${mapa.minute}`;
        } catch (_) {
            return "";
        }
    }

    function datosCabanaDia(numero, fecha = fechaActualResumen()) {
        try {
            if (!fecha || typeof obtenerDatosDia !== "function") return null;
            return obtenerDatosDia(fecha)?.cabanas?.[String(numero)] || null;
        } catch (_) {
            return null;
        }
    }

    function aplicarColorFila(numero, fecha = fechaActualResumen()) {
        const cabana = datosCabanaDia(numero, fecha);
        const fila = document.querySelector(`tr[data-cabana="${CSS.escape(String(numero))}"]`);
        if (!cabana || !fila) return false;

        const estado = String(cabana.estado || "").toLowerCase();
        const tieneCheckout = Boolean(
            cabana.checkoutRealizado === true ||
            String(cabana.checkout || "").trim()
        );

        const nuevoHuespedYaIngreso =
            estado === "sale-ingresa" &&
            cabana.checkinRealizado === true;

        fila.classList.remove(
            "cabana-checkout",
            "cabana-checkin",
            "cabana-libre",
            "cabana-ingresa",
            "cabana-sale-libre"
        );

        // No interferimos con el rojo de una CAB bloqueada.
        if (estado === "bloqueada") return true;

        // SALE / INGRESA tiene dos huéspedes en el mismo día. Cuando el nuevo
        // huésped ya hizo check-in, su verde domina sobre la salida anterior.
        if (nuevoHuespedYaIngreso) {
            fila.classList.add("cabana-checkin");
            return true;
        }

        // Una hora de salida pertenece al huésped que abandona la CAB ese día.
        // Debe dominar sobre el check-in histórico de la noche anterior.
        if (tieneCheckout) {
            fila.classList.add("cabana-checkout");
            return true;
        }

        // Antes de realizar checkout, SALE / LIBRE vuelve a su amarillo original.
        if (estado === "sale-libre") {
            fila.classList.add("cabana-sale-libre");
            return true;
        }

        if (cabana.checkinRealizado === true) {
            fila.classList.add("cabana-checkin");
            return true;
        }

        if (estado === "libre-ingresa" || estado === "sale-ingresa") {
            fila.classList.add("cabana-ingresa");
            return true;
        }

        // CONTINÚA sin Check-In conserva el mismo naranjo del ingreso original.
        // El legacy ya aplicaba esta regla; este módulo no debe degradarla a blanco.
        if (estado === "continua") {
            let estadoIngreso = String(cabana.estadoIngresoReserva || "").toLowerCase();

            if (!estadoIngreso && typeof window.obtenerEstadoIngresoReserva === "function") {
                try {
                    estadoIngreso = String(
                        window.obtenerEstadoIngresoReserva(cabana.reservaId) || ""
                    ).toLowerCase();
                } catch (_) {}
            }

            if (estadoIngreso === "libre-ingresa" || estadoIngreso === "sale-ingresa") {
                fila.classList.add("cabana-ingresa");
                return true;
            }

            fila.classList.add("cabana-libre");
            return true;
        }

        if (
            estado === "libre-libre" ||
            estado === "fullday"
        ) {
            fila.classList.add("cabana-libre");
        }

        return true;
    }

    function aplicarColoresResumen(fecha = fechaActualResumen()) {
        document.querySelectorAll('tr[data-cabana]').forEach(fila => {
            aplicarColorFila(fila.dataset.cabana, fecha);
        });
    }

    async function obtenerCheckouts(fecha) {
        const { data, error } = await cliente
            .from("reserva_estadias")
            .select("id,reserva_id,fecha_ingreso,fecha_salida,tipo_estadia,checkout_realizado_en,cabanas(numero)")
            .eq("fecha_salida", fecha)
            .not("checkout_realizado_en", "is", null);

        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    function proyectarCheckout(estadia, fecha) {
        const numero = String(estadia?.cabanas?.numero || "");
        const reservaIdSalida = String(estadia?.reserva_id || "");
        if (!numero || !reservaIdSalida) return false;

        const cabana = datosCabanaDia(numero, fecha);
        if (!cabana) return false;

        const reservaIdVisible = String(cabana.reservaId || "");
        const mismaReserva = reservaIdVisible === reservaIdSalida;
        const saleIngresa = String(cabana.estado || "") === "sale-ingresa";

        // En SALE / INGRESA la fila ya puede representar al huésped entrante,
        // pero la hora de checkout sigue perteneciendo a la reserva saliente.
        if (!mismaReserva && !saleIngresa) return false;

        const hora = horaChile(estadia.checkout_realizado_en);
        cabana.checkoutRealizado = true;
        if (!String(cabana.checkout || "").trim() && hora) cabana.checkout = hora;

        const fila = document.querySelector(`tr[data-cabana="${CSS.escape(numero)}"]`);
        const inputCheckout = fila?.querySelector('[data-campo="checkout"]');
        if (inputCheckout && !inputCheckout.value && hora) {
            inputCheckout.value = hora;
        }

        aplicarColorFila(numero, fecha);
        return true;
    }

    async function resolverCabanaId(numero) {
        const { data, error } = await cliente
            .from("cabanas")
            .select("id,numero")
            .eq("numero", Number(numero))
            .maybeSingle();
        if (error) throw error;
        return data?.id || null;
    }

    async function estadiaQueSale(numero, fecha) {
        const cabanaId = await resolverCabanaId(numero);
        if (!cabanaId) return null;

        const comunes = "id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia,checkin_realizado_en,checkout_realizado_en";

        const { data: alojamientos, error: errorAlojamientos } = await cliente
            .from("reserva_estadias")
            .select(comunes)
            .eq("cabana_id", cabanaId)
            .eq("tipo_estadia", "alojamiento")
            .eq("fecha_salida", fecha)
            .not("estado_estadia", "in", "(cancelada,no_show)");
        if (errorAlojamientos) throw errorAlojamientos;

        const { data: fullDays, error: errorFullDays } = await cliente
            .from("reserva_estadias")
            .select(comunes)
            .eq("cabana_id", cabanaId)
            .eq("tipo_estadia", "fullday")
            .eq("fecha_ingreso", fecha)
            .not("estado_estadia", "in", "(cancelada,no_show)");
        if (errorFullDays) throw errorFullDays;

        const candidatas = [...(alojamientos || []), ...(fullDays || [])];
        const unicas = [...new Map(candidatas.map(item => [item.id, item])).values()];

        if (unicas.length === 1) return unicas[0];
        if (unicas.length === 0) return null;

        throw new Error(
            `Hay ${unicas.length} estadías candidatas para la salida de CAB ${numero} el ${fecha}. No se modificó ninguna automáticamente.`
        );
    }

    function isoHoraLocal(fecha, hora) {
        const valor = new Date(`${fecha}T${hora}:00`);
        return Number.isNaN(valor.getTime()) ? null : valor.toISOString();
    }

    async function registrarCheckoutDesdeHora(input) {
        if (guardandoHora || !input?.value) return;

        const fila = input.closest('tr[data-cabana]');
        const numero = String(fila?.dataset?.cabana || "");
        const fecha = fechaActualResumen();
        const hora = String(input.value || "");
        if (!numero || !fecha || !/^\d{2}:\d{2}$/.test(hora)) return;

        // El legacy ya conserva el dato operativo. Pintamos de inmediato y la
        // persistencia comercial se resuelve después contra la estadía saliente.
        const cabana = datosCabanaDia(numero, fecha);
        if (cabana) {
            cabana.checkout = hora;
            cabana.checkoutRealizado = true;
        }
        aplicarColorFila(numero, fecha);

        guardandoHora = true;
        try {
            const estadia = await estadiaQueSale(numero, fecha);
            if (!estadia) {
                console.warn(
                    "HAIKU · Hora de checkout guardada sólo como dato operativo; no se encontró una estadía Supabase saliente inequívoca.",
                    numero,
                    fecha
                );
                return;
            }

            const horaIso = isoHoraLocal(fecha, hora);
            if (!horaIso) throw new Error("La hora de Check-out no es válida.");

            const { error } = await cliente.rpc("haiku_cambiar_estado_estadia", {
                p_estadia_id: estadia.id,
                p_estado: "checked_out",
                p_hora: horaIso
            });
            if (error) throw error;

            console.info(
                "HAIKU · Checkout registrado desde hora del Resumen:",
                numero,
                fecha,
                estadia.id
            );

            await refrescar({ sincronizar: true });
        } catch (error) {
            console.error("HAIKU · No fue posible registrar checkout desde la hora:", error);
            alert(error?.message || "No fue posible registrar el Check-out.");

            // Si Supabase rechazó el checkout (por ejemplo por ser demasiado
            // temprano), no dejamos un azul que sugiera un estado que no existe.
            try {
                const cabanaActual = datosCabanaDia(numero, fecha);
                if (cabanaActual) {
                    cabanaActual.checkout = "";
                    cabanaActual.checkoutRealizado = false;
                }
                input.value = "";
                if (typeof guardarDatos === "function") guardarDatos();
                aplicarColorFila(numero, fecha);
            } catch (_) {}
        } finally {
            guardandoHora = false;
        }
    }

    async function refrescar({ sincronizar = false } = {}) {
        if (refrescando) return;

        const fecha = fechaActualResumen();
        if (!fecha || !window.haikuSesion) return;

        refrescando = true;
        try {
            if (sincronizar) {
                try { await window.haikuSincronizarReservasSupabase?.(); } catch (_) {}
                try {
                    if (typeof cargarCabanasDia === "function") {
                        cargarCabanasDia(fecha);
                    }
                } catch (_) {}
            }

            const estadias = await obtenerCheckouts(fecha);
            let aplicadas = 0;
            estadias.forEach(estadia => {
                if (proyectarCheckout(estadia, fecha)) aplicadas += 1;
            });

            aplicarColoresResumen(fecha);

            if (aplicadas > 0) {
                try { if (typeof guardarDatos === "function") guardarDatos(); } catch (_) {}
            }

            console.info(
                "HAIKU · Estados de salida reflejados en Resumen:",
                aplicadas,
                "· fecha",
                fecha
            );
        } catch (error) {
            console.error("HAIKU · No fue posible reflejar estados de salida en Resumen:", error);
        } finally {
            refrescando = false;
        }
    }

    instalarCss();

    window.addEventListener("haiku:auth-ready", () => {
        refrescar({ sincronizar: true });
    });

    document.addEventListener("click", evento => {
        const resumen = evento.target?.closest?.('.menu-item[data-seccion="resumen"]');
        if (!resumen) return;
        requestAnimationFrame(() => refrescar({ sincronizar: true }));
    });

    document.addEventListener("change", evento => {
        const campoCabana = evento.target?.closest?.('tr[data-cabana] .campo-cabana');
        if (!campoCabana) return;

        const fila = campoCabana.closest('tr[data-cabana]');
        requestAnimationFrame(() => aplicarColorFila(fila?.dataset?.cabana));

        if (campoCabana.matches('[data-campo="checkout"]') && campoCabana.value) {
            registrarCheckoutDesdeHora(campoCabana);
        }
    });

    const api = Object.freeze({
        refrescar,
        aplicarColores: aplicarColoresResumen,
        aplicarColorFila,
        registrarCheckoutDesdeHora
    });

    window.HAIKU_CHECKOUT_RESUMEN_V2 = api;
    window.HAIKU_CHECKOUT_RESUMEN_V1 = api;

    if (window.haikuSesion) {
        refrescar({ sincronizar: true });
    }

    console.info("HAIKU · Checkout/colores del Resumen V2 preparado.");
})();