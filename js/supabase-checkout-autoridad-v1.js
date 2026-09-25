// ========================================
// HAIKU · CHECKOUT · AUTORIDAD SUPABASE V1
// Corrige dos problemas operativos:
// 1) borrar la hora de checkout revierte el checkout real de la estadía saliente;
// 2) Supabase vuelve a ser la autoridad para hora/estado visual en Resumen y Calendario.
//
// Reglas:
// - En SALE / INGRESA la hora pertenece SIEMPRE a la estadía que sale.
// - La estadía que ingresa nunca se marca Checked Out por esa hora.
// - Si se elimina una hora y la estadía saliente tenía check-in, vuelve a Hospedada.
//   Si no tenía check-in, vuelve a Confirmada.
// - Sin observers, intervalos, polling ni parches globales.
// ========================================
(() => {
    "use strict";

    if (window.HAIKU_CHECKOUT_AUTORIDAD_V1) return;

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let sincronizando = false;
    let revirtiendo = false;

    function fechaActualResumen() {
        try {
            return String(fechaSeleccionada || "").slice(0, 10);
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

        const campos = "id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia,checkin_realizado_en,checkout_realizado_en";

        const { data: alojamientos, error: errorAlojamientos } = await cliente
            .from("reserva_estadias")
            .select(campos)
            .eq("cabana_id", cabanaId)
            .eq("tipo_estadia", "alojamiento")
            .eq("fecha_salida", fecha)
            .not("estado_estadia", "in", "(cancelada,no_show)");
        if (errorAlojamientos) throw errorAlojamientos;

        const { data: fullDays, error: errorFullDays } = await cliente
            .from("reserva_estadias")
            .select(campos)
            .eq("cabana_id", cabanaId)
            .eq("tipo_estadia", "fullday")
            .eq("fecha_ingreso", fecha)
            .not("estado_estadia", "in", "(cancelada,no_show)");
        if (errorFullDays) throw errorFullDays;

        const candidatas = [...(alojamientos || []), ...(fullDays || [])];
        const unicas = [...new Map(candidatas.map(item => [item.id, item])).values()];

        if (unicas.length === 1) return unicas[0];
        if (unicas.length === 0) return null;
        throw new Error(`Hay ${unicas.length} estadías candidatas para la salida de CAB ${numero} el ${fecha}. No se modificó ninguna.`);
    }

    async function estadiasQueSalen(fecha) {
        const campos = "id,reserva_id,fecha_ingreso,fecha_salida,tipo_estadia,estado_estadia,checkin_realizado_en,checkout_realizado_en,cabanas(numero)";

        const { data: alojamientos, error: errorAlojamientos } = await cliente
            .from("reserva_estadias")
            .select(campos)
            .eq("tipo_estadia", "alojamiento")
            .eq("fecha_salida", fecha)
            .not("estado_estadia", "in", "(cancelada,no_show)");
        if (errorAlojamientos) throw errorAlojamientos;

        const { data: fullDays, error: errorFullDays } = await cliente
            .from("reserva_estadias")
            .select(campos)
            .eq("tipo_estadia", "fullday")
            .eq("fecha_ingreso", fecha)
            .not("estado_estadia", "in", "(cancelada,no_show)");
        if (errorFullDays) throw errorFullDays;

        return [...new Map(
            [...(alojamientos || []), ...(fullDays || [])]
                .map(item => [item.id, item])
        ).values()];
    }

    function cargarFichasLocales() {
        try {
            const valor = JSON.parse(localStorage.getItem("haikuFichaReservas") || "{}");
            return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
        } catch (_) {
            return {};
        }
    }

    function guardarFichasLocales(fichas) {
        try {
            localStorage.setItem("haikuFichaReservas", JSON.stringify(fichas));
        } catch (_) {}
    }

    function proyectarEstadoReal(estadia, fecha, fichas) {
        const numero = String(estadia?.cabanas?.numero || "");
        const reservaId = String(estadia?.reserva_id || "");
        if (!numero || !reservaId) return false;

        const checkoutReal = Boolean(estadia.checkout_realizado_en);
        const horaReal = checkoutReal ? horaChile(estadia.checkout_realizado_en) : "";

        // Marca de ficha usada también por Calendario. Sólo corresponde a la
        // reserva SALIENTE; nunca se copia a la reserva que entra en SALE/INGRESA.
        const ficha = fichas[reservaId] && typeof fichas[reservaId] === "object"
            ? fichas[reservaId]
            : {};
        ficha.checkoutRealizado = checkoutReal;
        ficha.checkinRealizado = Boolean(estadia.checkin_realizado_en);
        fichas[reservaId] = ficha;

        // El campo de checkout del Resumen representa la SALIDA de la CAB ese día,
        // aunque la fila visual esté mostrando al huésped entrante.
        const cabana = datosCabanaDia(numero, fecha);
        if (cabana) {
            cabana.checkoutRealizado = checkoutReal;
            cabana.checkout = horaReal;
        }

        const fila = document.querySelector(`#seccion-resumen .sites-resumen-cabana[data-cabana="${CSS.escape(numero)}"]`);
        const input = fila?.querySelector('[data-campo="checkout"]');
        if (input && input.value !== horaReal) input.value = horaReal;

        return true;
    }

    async function sincronizarDesdeSupabase({ regenerarCalendario = true,
        origen = { evento: "refresh explícito checkout autoridad", tipo: "externo" } } = {}) {
        if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) {
            return window.HAIKU_RESUMEN_REFRESH_V1.solicitar(undefined, {
                categoria: "checkout autoridad", ...origen
            });
        }
        if (sincronizando) return false;
        const fecha = fechaActualResumen();
        if (!fecha || !window.haikuSesion) return false;

        sincronizando = true;
        try {
            const estadias = await estadiasQueSalen(fecha);
            if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) {
                return window.HAIKU_RESUMEN_REFRESH_V1.solicitar(fecha, {
                    categoria: "checkout autoridad", ...origen
                });
            }
            const fichas = cargarFichasLocales();

            estadias.forEach(estadia => proyectarEstadoReal(estadia, fecha, fichas));
            guardarFichasLocales(fichas);

            try { if (typeof guardarDatos === "function") guardarDatos(); } catch (_) {}
            try { window.HAIKU_CHECKOUT_RESUMEN_V2?.aplicarColores?.(fecha); } catch (_) {}
            try { window.HAIKU_CHECKOUT_RESUMEN_V1?.aplicarColores?.(fecha); } catch (_) {}

            if (regenerarCalendario) {
                try { if (typeof generarCalendario === "function") generarCalendario(); } catch (_) {}
                try { window.HAIKU_VINCULOS_ESTABLES_V1?.refrescarCalendario?.(); } catch (_) {}
            }

            document.dispatchEvent(new CustomEvent("haiku:resumen-datos-actualizados", {
                detail: { fecha }
            }));

            console.info("HAIKU · Checkout sincronizado desde autoridad Supabase:", estadias.length, "· fecha", fecha);
            return true;
        } catch (error) {
            console.error("HAIKU · No fue posible sincronizar checkout desde Supabase:", error);
            return false;
        } finally {
            sincronizando = false;
        }
    }

    async function revertirCheckoutAlBorrar(input) {
        if (revirtiendo || !input) return;
        if (String(input.value || "").trim()) return;

        const fila = input.closest('.sites-resumen-cabana[data-cabana]');
        const numero = String(fila?.dataset?.cabana || "");
        const fecha = fechaActualResumen();
        if (!numero || !fecha) return;

        revirtiendo = true;
        input.disabled = true;
        try {
            const estadia = await estadiaQueSale(numero, fecha);
            if (!estadia) {
                // No hay estadía saliente real: limpiamos sólo el dato operativo.
                const cabana = datosCabanaDia(numero, fecha);
                if (cabana) {
                    cabana.checkout = "";
                    cabana.checkoutRealizado = false;
                }
                try { if (typeof guardarDatos === "function") guardarDatos(); } catch (_) {}
                return;
            }

            if (estadia.checkout_realizado_en) {
                const estadoDestino = estadia.checkin_realizado_en ? "hospedada" : "confirmada";
                const { error } = await cliente.rpc("haiku_cambiar_estado_estadia", {
                    p_estadia_id: estadia.id,
                    p_estado: estadoDestino,
                    p_hora: new Date().toISOString()
                });
                if (error) throw error;
            }

            // La respuesta de Supabase es la única autoridad. Al refrescar se
            // limpian hora, azul y ficha del checkout en PC/celular.
            try { await window.haikuSincronizarReservasSupabase?.(); } catch (_) {}
            try {
                if (typeof cargarCabanasDia === "function") cargarCabanasDia(fecha, {
                    evento: "checkout revertido", tipo: "externo"
                });
            } catch (_) {}
            await sincronizarDesdeSupabase({ regenerarCalendario: true });

            console.info("HAIKU · Checkout revertido al borrar hora:", numero, fecha, estadia.id);
        } catch (error) {
            console.error("HAIKU · No fue posible revertir checkout al borrar hora:", error);
            alert(error?.message || "No fue posible revertir el Check-out.");
            // Recuperamos inmediatamente el valor real de Supabase.
            await sincronizarDesdeSupabase({ regenerarCalendario: true });
        } finally {
            input.disabled = false;
            revirtiendo = false;
        }
    }

    // Capturamos el change sólo para el caso VACÍO. El módulo existente sigue
    // siendo responsable de registrar/modificar una hora no vacía.
    document.addEventListener("change", evento => {
        const input = evento.target?.closest?.('#seccion-resumen .sites-resumen-cabana[data-cabana] [data-campo="checkout"]');
        if (!input || String(input.value || "").trim()) return;
        revertirCheckoutAlBorrar(input);
    });

    window.addEventListener("haiku:auth-ready", () => {
        sincronizarDesdeSupabase({ regenerarCalendario: true, origen: {
            evento: "auth checkout autoridad", tipo: "interno_derivado"
        } });
    });

    window.addEventListener("pageshow", () => {
        sincronizarDesdeSupabase({ regenerarCalendario: true, origen: {
            evento: "pageshow checkout autoridad", tipo: "interno_derivado"
        } });
    });

    window.addEventListener("focus", () => {
        sincronizarDesdeSupabase({ regenerarCalendario: true, origen: {
            evento: "focus checkout autoridad", tipo: "interno_derivado"
        } });
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            sincronizarDesdeSupabase({ regenerarCalendario: true, origen: {
                evento: "visibility checkout autoridad", tipo: "interno_derivado"
            } });
        }
    });

    document.addEventListener("click", evento => {
        if (!evento.target?.closest?.('.menu-item[data-seccion="resumen"]')) return;
        requestAnimationFrame(() => sincronizarDesdeSupabase({ regenerarCalendario: true,
            origen: { evento: "abrir Resumen", tipo: "interno_derivado" }
        }));
    });

    window.HAIKU_CHECKOUT_AUTORIDAD_V1 = Object.freeze({
        sincronizar: sincronizarDesdeSupabase,
        revertirCheckoutAlBorrar,
        estadiaQueSale
    });

    window.HAIKU_RESUMEN_REFRESH_V1?.registrar("checkoutAutoridad", {
        orden: 45,
        preparar: ({ fecha }) => estadiasQueSalen(fecha),
        publicar: snapshot => {
            const fichas = cargarFichasLocales();
            snapshot.datos.checkoutAutoridad.forEach(estadia =>
                proyectarEstadoReal(estadia, snapshot.fecha, fichas));
            guardarFichasLocales(fichas);
            if (typeof guardarDatos === "function") guardarDatos();
            window.HAIKU_CHECKOUT_RESUMEN_V2?.aplicarColores?.(snapshot.fecha);
        }
    });

    if (window.haikuSesion) {
        sincronizarDesdeSupabase({ regenerarCalendario: true, origen: {
            evento: "inicio checkout autoridad", tipo: "interno_derivado"
        } });
    }

    console.info("HAIKU · Checkout Autoridad Supabase V1 preparado.");
})();
