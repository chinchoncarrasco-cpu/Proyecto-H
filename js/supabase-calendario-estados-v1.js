// ========================================
// HAIKU · CALENDARIO POR ESTADO CANÓNICO V1
// Supabase manda los colores del Calendario.
// Sin observers, sin intervalos y sin tocar clientes globales.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) {
        console.warn("HAIKU · Calendario estados V1: cliente Supabase no disponible.");
        return;
    }

    const CLAVE_CACHE = "haikuEstadosCalendarioV1";
    const CLASES_COLOR = [
        "cal-reserva-checkout",
        "cal-reserva-checkin",
        "cal-reserva-confirmada",
        "cal-reserva-confirmacion-pendiente"
    ];

    const PRIORIDAD = {
        pendiente: 1,
        confirmada: 2,
        hospedada: 3,
        checked_out: 4
    };

    let estados = new Map();
    let refrescando = false;
    let refrescoProgramado = false;
    let wrapperInstalado = false;
    let canalRealtime = null;

    function normalizarEstado(valor) {
        return String(valor || "")
            .trim()
            .toLowerCase()
            .replaceAll("-", "_")
            .replaceAll(" ", "_");
    }

    function resolverEstado(estadoReserva, estadoEstadia) {
        const candidatos = [
            normalizarEstado(estadoReserva),
            normalizarEstado(estadoEstadia)
        ].filter(estado => Object.prototype.hasOwnProperty.call(PRIORIDAD, estado));

        if (candidatos.length === 0) return "";

        return candidatos.sort((a, b) => PRIORIDAD[b] - PRIORIDAD[a])[0];
    }

    function claseParaEstado(estado) {
        switch (normalizarEstado(estado)) {
            case "checked_out":
                return "cal-reserva-checkout";
            case "hospedada":
                return "cal-reserva-checkin";
            case "confirmada":
                return "cal-reserva-confirmada";
            case "pendiente":
                return "cal-reserva-confirmacion-pendiente";
            default:
                return "";
        }
    }

    function cargarCacheLocal() {
        try {
            const guardado = JSON.parse(localStorage.getItem(CLAVE_CACHE) || "{}");
            estados = new Map(Object.entries(guardado));
        } catch {
            estados = new Map();
        }
    }

    function guardarCacheLocal() {
        try {
            localStorage.setItem(
                CLAVE_CACHE,
                JSON.stringify(Object.fromEntries(estados.entries()))
            );
        } catch (_) {}
    }

    function esBloqueo(elemento) {
        return (
            elemento.classList.contains("calendario-bloqueo-barra") ||
            elemento.classList.contains("cal-reserva-bloqueada")
        );
    }

    function esFullDay(elemento) {
        return (
            elemento.classList.contains("cal-reserva-fullday") ||
            elemento.dataset.haikuFullday === "1"
        );
    }

    function aplicarEstadosDOM() {
        document
            .querySelectorAll(
                ".calendario-reserva-barra[data-reserva-id], " +
                ".calendario-panel-reserva[data-reserva-id]"
            )
            .forEach(elemento => {
                // Los bloqueos conservan siempre su apariencia propia.
                if (esBloqueo(elemento)) return;

                const reservaId = String(elemento.dataset.reservaId || "");
                const estado = estados.get(reservaId) || "";
                const estadoNormalizado = normalizarEstado(estado);
                const clase = claseParaEstado(estadoNormalizado);

                if (!clase) return;

                const fullDay = esFullDay(elemento);

                // Un Full Day futuro/confirmado conserva el color especial FULLDAY.
                // Cuando ya está hospedado o checked out, manda el estado operativo
                // igual que en cualquier otra estadía.
                if (
                    fullDay &&
                    !["hospedada", "checked_out"].includes(estadoNormalizado)
                ) {
                    CLASES_COLOR.forEach(nombre => elemento.classList.remove(nombre));
                    elemento.classList.add("cal-reserva-fullday");
                    elemento.dataset.haikuEstadoCanonico = estadoNormalizado;
                    return;
                }

                CLASES_COLOR.forEach(nombre => elemento.classList.remove(nombre));
                if (fullDay) elemento.classList.remove("cal-reserva-fullday");
                elemento.classList.add(clase);
                elemento.dataset.haikuEstadoCanonico = estadoNormalizado;
            });
    }

    async function cargarEstadosSupabase() {
        const { data, error } = await cliente
            .from("reserva_estadias")
            .select(`
                reserva_id,
                estado_estadia,
                checkin_realizado_en,
                checkout_realizado_en,
                reservas(id,estado_reserva)
            `);

        if (error) throw error;

        const nuevoMapa = new Map();

        (data || []).forEach(estadia => {
            const reservaId = String(estadia.reserva_id || estadia.reservas?.id || "");
            if (!reservaId) return;

            let estado = resolverEstado(
                estadia.reservas?.estado_reserva,
                estadia.estado_estadia
            );

            // Las marcas temporales son una comprobación adicional, nunca una
            // sustitución del estado canónico. Si existe checkout real, manda.
            if (estadia.checkout_realizado_en) {
                estado = "checked_out";
            } else if (estadia.checkin_realizado_en && estado !== "checked_out") {
                estado = "hospedada";
            }

            const anterior = nuevoMapa.get(reservaId) || "";
            if (!anterior || (PRIORIDAD[estado] || 0) > (PRIORIDAD[anterior] || 0)) {
                nuevoMapa.set(reservaId, estado);
            }
        });

        estados = nuevoMapa;
        guardarCacheLocal();
        return estados;
    }

    function redibujarCalendario() {
        try {
            if (typeof generarCalendario === "function") {
                generarCalendario();
                return;
            }
        } catch (error) {
            console.warn("HAIKU · Calendario estados V1: no fue posible regenerar:", error);
        }

        aplicarEstadosDOM();
    }

    async function refrescar({ sincronizarCache = true, redibujar = true } = {}) {
        if (refrescando) return;
        refrescando = true;

        try {
            if (
                sincronizarCache &&
                typeof window.haikuSincronizarReservasSupabase === "function"
            ) {
                await window.haikuSincronizarReservasSupabase();
            }

            await cargarEstadosSupabase();

            // El mismo evento Realtime que actualiza los estados del Calendario
            // refresca también la hora/estado de checkout del Resumen. Reutiliza
            // la autoridad existente y NO abre un segundo canal Realtime.
            try {
                await window.HAIKU_CHECKOUT_AUTORIDAD_V1?.sincronizar?.({
                    regenerarCalendario: false
                });
            } catch (errorCheckout) {
                console.warn(
                    "HAIKU · Calendario estados V1: no fue posible refrescar checkout del Resumen:",
                    errorCheckout
                );
            }

            if (redibujar) {
                redibujarCalendario();
            } else {
                aplicarEstadosDOM();
            }
        } catch (error) {
            console.error("HAIKU · No fue posible sincronizar colores del Calendario:", error);
            aplicarEstadosDOM();
        } finally {
            refrescando = false;
        }
    }

    function programarRefresco() {
        if (refrescoProgramado) return;
        refrescoProgramado = true;

        // Coalesce los dos cambios de una misma operación (reserva + estadía)
        // en una sola lectura. Es un disparo único, no polling.
        setTimeout(async () => {
            refrescoProgramado = false;
            await refrescar({ sincronizarCache: true, redibujar: true });
        }, 80);
    }

    function instalarWrapperCalendario() {
        if (wrapperInstalado || typeof generarCalendario !== "function") return;

        const original = generarCalendario;
        const conEstadoCanonico = function (...args) {
            const resultado = original.apply(this, args);
            aplicarEstadosDOM();
            return resultado;
        };

        try {
            generarCalendario = conEstadoCanonico;
        } catch (_) {
            window.generarCalendario = conEstadoCanonico;
        }

        window.generarCalendario = conEstadoCanonico;
        wrapperInstalado = true;
    }

    function iniciarRealtime() {
        if (canalRealtime) return;

        canalRealtime = cliente
            .channel("haiku-calendario-estados-v1")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "reservas" },
                programarRefresco
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "reserva_estadias" },
                programarRefresco
            )
            .subscribe(estadoCanal => {
                if (estadoCanal === "SUBSCRIBED") {
                    console.info("HAIKU · Calendario estados V1 conectado a Realtime.");
                }
            });
    }

    cargarCacheLocal();
    instalarWrapperCalendario();
    aplicarEstadosDOM();
    iniciarRealtime();

    window.addEventListener("haiku:auth-ready", () => {
        refrescar({ sincronizarCache: true, redibujar: true });
    }, { once: true });

    document.addEventListener("click", evento => {
        if (
            evento.target?.closest?.('[data-seccion="calendario"]') ||
            evento.target?.closest?.("#mes-anterior") ||
            evento.target?.closest?.("#mes-siguiente")
        ) {
            setTimeout(() => {
                instalarWrapperCalendario();
                aplicarEstadosDOM();
            }, 0);
        }
    });

    // El botón +N detiene la propagación de su clic. Escuchamos en captura
    // sólo ese botón y, cuando su handler termine de crear el panel, aplicamos
    // el mismo estado canónico que ya usa el Calendario grande.
    document.addEventListener("click", evento => {
        if (!evento.target?.closest?.(".calendario-mas-reservas")) return;

        requestAnimationFrame(() => {
            aplicarEstadosDOM();
        });
    }, true);

    // El loader puede ejecutar este módulo después de que la sesión ya esté lista.
    if (window.haikuSesion) {
        refrescar({ sincronizarCache: false, redibujar: true });
    }

    window.HAIKU_CALENDARIO_ESTADOS_V1 = Object.freeze({
        refrescar,
        aplicar: aplicarEstadosDOM,
        estado: reservaId => estados.get(String(reservaId || "")) || ""
    });

    console.info("HAIKU · Calendario por estado canónico V1 preparado.");
})();