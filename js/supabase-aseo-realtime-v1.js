// ========================================
// HAIKU · ASEO REALTIME MULTIDISPOSITIVO V1
// Refresca Aseo + revisión cuando Supabase cambia desde otro dispositivo.
// Incluye recuperación especial para navegadores móviles que suspenden WebSocket.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let canal = null;
    let estadoCanal = "DESCONECTADO";
    let timer = null;
    let timerReconexion = null;
    let refrescando = false;
    let refrescoPendiente = false;
    let reconectando = false;
    let recuperando = false;
    let ultimoIntentoRecuperacion = 0;
    let ultimoEvento = 0;
    let ultimoRefresco = 0;

    const esMovil = () =>
        window.matchMedia?.("(pointer: coarse)")?.matches ||
        window.innerWidth <= 768;

    function fechaActual() {
        try {
            return typeof fechaSeleccionada !== "undefined"
                ? String(fechaSeleccionada || "").slice(0, 10)
                : "";
        } catch (_) {
            return "";
        }
    }

    function aseoVisible() {
        const seccion = document.getElementById("seccion-cabanas");
        return Boolean(
            !document.hidden &&
            seccion?.classList.contains("activa")
        );
    }

    function usuarioEditandoAseo() {
        const activo = document.activeElement;
        const seccion = document.getElementById("seccion-cabanas");

        return Boolean(
            activo &&
            seccion?.contains(activo) &&
            activo.matches?.(
                "input, select, textarea, [contenteditable='true']"
            )
        );
    }

    async function refrescarDesdeSupabase() {
        if (!window.haikuSesion) return;

        // No reemplazamos el DOM mientras el usuario escribe o mantiene un
        // selector abierto. El cambio remoto queda pendiente hasta que salga
        // del campo, evitando que el teclado/selector móvil se cierre.
        if (usuarioEditandoAseo()) {
            refrescoPendiente = true;
            return;
        }

        if (refrescando) {
            refrescoPendiente = true;
            return;
        }

        refrescando = true;

        try {
            const fecha = fechaActual();
            if (!fecha) return;

            const apiAseo = window.HAIKU_ASEO_OPERACION_V1;
            const apiRevision = window.HAIKU_REVISION_RESUMEN_SYNC_V2;

            if (apiAseo?.hidratar) {
                await apiAseo.hidratar(fecha, { pintar: true });
            }

            if (apiRevision?.resincronizar) {
                await apiRevision.resincronizar();
            }

            ultimoRefresco = Date.now();
            console.info("HAIKU · Aseo Realtime actualizado:", fecha);
        } catch (error) {
            console.error("HAIKU · No fue posible refrescar Aseo Realtime:", error);
        } finally {
            refrescando = false;

            if (refrescoPendiente) {
                refrescoPendiente = false;
                programarRefresco(80);
            }
        }
    }

    function programarRefresco(delay = 90) {
        clearTimeout(timer);
        timer = setTimeout(refrescarDesdeSupabase, delay);
    }

    function eventoRealtime(payload) {
        ultimoEvento = Date.now();
        const tabla = payload?.table || payload?.schema || "operacion";
        console.info("HAIKU · Cambio Realtime recibido:", tabla);
        if (tabla === "revision_items" || tabla === "revisiones_cabana") {
            window.HAIKU_REVISION_SUPABASE_V1?.refrescarChecklistAbierto?.(payload)
                ?.catch(error => console.error("HAIKU · No fue posible actualizar el checklist Realtime:", error));
        }
        programarRefresco(70);
    }

    async function desconectar() {
        clearTimeout(timerReconexion);

        const actual = canal;
        canal = null;
        estadoCanal = "DESCONECTADO";

        if (!actual) return;

        try {
            await cliente.removeChannel(actual);
        } catch (_) {}
    }

    function programarReconexion(delay = 350) {
        clearTimeout(timerReconexion);
        if (!window.haikuSesion) return;

        timerReconexion = setTimeout(async () => {
            if (!window.haikuSesion || reconectando) return;

            reconectando = true;
            try {
                await desconectar();
                await conectar();
            } finally {
                reconectando = false;
            }
        }, delay);
    }

    async function conectar() {
        if (!window.haikuSesion) return;
        if (canal && estadoCanal === "SUBSCRIBED") return;

        if (canal) {
            await desconectar();
        }

        estadoCanal = "CONECTANDO";

        const nuevoCanal = cliente
            .channel(`haiku-aseo-operacion-${Date.now()}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "aseos" },
                eventoRealtime
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "solicitudes" },
                eventoRealtime
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "revisiones_cabana" },
                eventoRealtime
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "revision_items" },
                eventoRealtime
            )
            .subscribe((status, error) => {
                // removeChannel() también emite CLOSED. Si este canal ya no
                // es el activo, fue cerrado por nosotros y no es una caída.
                if (canal !== nuevoCanal) return;

                estadoCanal = status;

                if (status === "SUBSCRIBED") {
                    console.info("HAIKU · Aseo Realtime conectado.");
                    window.HAIKU_REVISION_SUPABASE_V1?.refrescarChecklistAbierto?.()
                        ?.catch(error => console.error("HAIKU · No fue posible recuperar el checklist Realtime:", error));
                    programarRefresco(0);
                    return;
                }

                if (
                    status === "CHANNEL_ERROR" ||
                    status === "TIMED_OUT" ||
                    status === "CLOSED"
                ) {
                    console.warn(
                        "HAIKU · Aseo Realtime perdió conexión:",
                        status,
                        error || ""
                    );
                    programarReconexion(800);
                }
            });

        canal = nuevoCanal;
    }

    async function recuperarConexion(forzar = false) {
        if (!window.haikuSesion || recuperando) return;

        const ahora = Date.now();
        if (
            forzar &&
            estadoCanal === "SUBSCRIBED" &&
            ahora - ultimoIntentoRecuperacion < 1500
        ) {
            programarRefresco(80);
            return;
        }

        recuperando = true;
        ultimoIntentoRecuperacion = ahora;

        try {
            // Al volver desde segundo plano reconstruimos una sola vez el
            // canal móvil. Los demás eventos de foco sólo reparan si cayó.
            if (forzar || estadoCanal !== "SUBSCRIBED") {
                await desconectar();
                await conectar();
            }

            programarRefresco(80);
        } finally {
            recuperando = false;
        }
    }

    window.addEventListener("haiku:auth-ready", () => {
        conectar();
        programarRefresco(100);
    });

    window.addEventListener("focus", () => {
        if (window.haikuSesion && estadoCanal !== "SUBSCRIBED") {
            recuperarConexion();
        }
    });

    window.addEventListener("pageshow", evento => {
        if (window.haikuSesion) recuperarConexion(Boolean(evento.persisted));
    });

    window.addEventListener("online", () => {
        if (window.haikuSesion) recuperarConexion(true);
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && window.haikuSesion) {
            recuperarConexion(esMovil());
        }
    });

    // Si llegó un cambio mientras se editaba, lo aplicamos al abandonar el
    // campo. Dejamos margen para que termine primero su escritura local.
    document.addEventListener("focusout", evento => {
        if (!evento.target?.closest?.("#seccion-cabanas")) return;
        if (!refrescoPendiente) return;

        setTimeout(() => {
            if (!usuarioEditandoAseo()) {
                refrescoPendiente = false;
                programarRefresco(450);
            }
        }, 0);
    }, true);

    cliente.auth.onAuthStateChange(evento => {
        if (evento === "SIGNED_OUT") {
            desconectar();
        }
    });

    // Respaldo móvil: si el sistema durmió el WebSocket, comprobamos Supabase
    // sin interrumpir una edición activa. Realtime sigue siendo la vía normal.
    setInterval(() => {
        if (!window.haikuSesion || !esMovil() || !aseoVisible()) return;

        if (usuarioEditandoAseo()) return;

        const ahora = Date.now();
        if (ahora - ultimoRefresco > 8000 && ahora - ultimoEvento > 1500) {
            programarRefresco(0);
        }

        if (estadoCanal !== "SUBSCRIBED") {
            programarReconexion(0);
        }
    }, 4000);

    window.HAIKU_ASEO_REALTIME_V1 = Object.freeze({
        refrescar: refrescarDesdeSupabase,
        reconectar: recuperarConexion,
        estado() {
            return estadoCanal;
        }
    });

    if (window.haikuSesion) {
        conectar();
        programarRefresco(100);
    }

    console.info("HAIKU · Aseo Realtime V1 preparado.");
})();
