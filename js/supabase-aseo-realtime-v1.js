// ========================================
// HAIKU · ASEO REALTIME MULTIDISPOSITIVO V1
// Refresca Aseo + revisión cuando Supabase cambia desde otro dispositivo.
// Incluye recuperación especial para navegadores móviles que suspenden WebSocket.
// ========================================

(() => {
    "use strict";

    if (window.HAIKU_ASEO_REALTIME_V1) return;
    let cliente = window.haikuSupabase;
    let authInstalado = false;

    let canal = null;
    let conexionActual = null;
    let estadoCanal = "DESCONECTADO";
    let postgresChangesReady = false;
    let estadoPostgresChanges = "DESCONECTADO";
    let timerPostgresChanges = null;
    const ESPERA_POSTGRES_CHANGES_MS = 10000;
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

            const hidratacionInsumos = window.HAIKU_INSUMOS_ASEO_V1?.hidratar(fecha);

            if (apiAseo?.hidratar) {
                await apiAseo.hidratar(fecha, { pintar: true });
            }

            if (apiRevision?.resincronizar) {
                await apiRevision.resincronizar();
            }

            await hidratacionInsumos;

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

    function reiniciarPostgresChanges(estado) {
        clearTimeout(timerPostgresChanges);
        timerPostgresChanges = null;
        postgresChangesReady = false;
        estadoPostgresChanges = estado;
    }

    function reconciliarInsumos() {
        const fecha = fechaActual();
        if (!window.haikuSesion || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
        const api = window.HAIKU_INSUMOS_ASEO_V1;
        // Invalidar también una lectura en vuelo: no debe publicar una foto
        // anterior al hueco de suscripción. La hidratación sólo hace lecturas.
        api?.invalidar(fecha);
        Promise.resolve(api?.hidratar(fecha, { forzar: true }))
            .catch(error => console.error("HAIKU · No fue posible reconciliar Insumos Realtime:", error));
    }

    function degradarPostgresChanges(actual, motivo) {
        if (canal !== actual || estadoPostgresChanges === "DEGRADADO") return;
        reiniciarPostgresChanges("DEGRADADO");
        console.warn("HAIKU · Postgres Changes no está listo; Insumos se verifica por lectura:", motivo);
        reconciliarInsumos();
    }

    function eventoSistema(actual, payload) {
        if (canal !== actual || estadoCanal !== "SUBSCRIBED" ||
            payload?.extension !== "postgres_changes") return;
        if (payload.status === "ok") {
            if (postgresChangesReady) return;
            clearTimeout(timerPostgresChanges);
            timerPostgresChanges = null;
            postgresChangesReady = true;
            estadoPostgresChanges = "LISTO";
            // SUBSCRIBED sólo confirma el canal. Esta lectura recupera los
            // cambios cuyo evento pudo perderse antes de activar la escucha PG.
            reconciliarInsumos();
        } else if (payload.status === "error" || payload.status === "timeout") {
            degradarPostgresChanges(actual, payload.message || payload.status);
        }
    }

    function eventoRealtime(payload) {
        ultimoEvento = Date.now();
        const tabla = payload?.table || payload?.schema || "operacion";
        console.info("HAIKU · Cambio Realtime recibido:", tabla);
        if (tabla === "movimientos_insumos" || tabla === "movimientos_insumos_unidades") {
            // Su propia lectura no escribe ni rehidrata los checklists/estados.
            const api = window.HAIKU_INSUMOS_ASEO_V1;
            const fechas = new Set([payload?.new?.fecha_operativa, payload?.old?.fecha_operativa,
                api?.fechaMovimiento(payload?.new?.movimiento_id || payload?.old?.movimiento_id)]
                .filter(fecha => /^\d{4}-\d{2}-\d{2}$/.test(fecha || "")));
            if (fechas.size) {
                for (const fecha of fechas) api?.invalidar(fecha);
            } else {
                api?.invalidar(); // Payload sin fecha: no conservar días potencialmente obsoletos.
            }
            if (!fechas.size || fechas.has(fechaActual())) api?.hidratar(fechaActual());
            return;
        }
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
        reiniciarPostgresChanges("DESCONECTADO");

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

    function conectar() {
        if (!window.haikuSupabase || !window.haikuSesion) return Promise.resolve();
        if (conexionActual) return conexionActual;
        conexionActual = conectarUnaVez().finally(() => { conexionActual = null; });
        return conexionActual;
    }

    async function conectarUnaVez() {
        cliente = window.haikuSupabase;
        if (!cliente || !window.haikuSesion) return;
        if (canal && ["SUBSCRIBED", "CONECTANDO"].includes(estadoCanal)) return;

        if (canal) {
            await desconectar();
        }
        if (!window.haikuSesion) return;

        estadoCanal = "CONECTANDO";
        reiniciarPostgresChanges("ESPERANDO");

        const nuevoCanal = cliente.channel(`haiku-aseo-operacion-${Date.now()}`);
        const cambioActual = payload => {
            if (canal === nuevoCanal) eventoRealtime(payload);
        };
        canal = nuevoCanal;
        nuevoCanal
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "aseos" },
                cambioActual
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "solicitudes" },
                cambioActual
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "revisiones_cabana" },
                cambioActual
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "revision_items" },
                cambioActual
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "movimientos_insumos" },
                cambioActual
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "movimientos_insumos_unidades" },
                cambioActual
            )
            .on("system", {}, payload => eventoSistema(nuevoCanal, payload))
            .subscribe((status, error) => {
                // removeChannel() también emite CLOSED. Si este canal ya no
                // es el activo, fue cerrado por nosotros y no es una caída.
                if (canal !== nuevoCanal) return;

                estadoCanal = status;

                if (status === "SUBSCRIBED") {
                    // También se ejecuta al reingresar al mismo canal tras una
                    // caída: cada suscripción necesita su propio system/ok.
                    reiniciarPostgresChanges("ESPERANDO");
                    timerPostgresChanges = setTimeout(() => {
                        degradarPostgresChanges(nuevoCanal, "No llegó system/postgres_changes/ok");
                    }, ESPERA_POSTGRES_CHANGES_MS);
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
                    reiniciarPostgresChanges("DEGRADADO");
                    console.warn(
                        "HAIKU · Aseo Realtime perdió conexión:",
                        status,
                        error || ""
                    );
                    programarReconexion(800);
                }
            });

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
        prepararAuth();
        conectar();
        programarRefresco(100);
    });

    window.addEventListener("focus", () => {
        if (window.haikuSesion && (estadoCanal !== "SUBSCRIBED" || !postgresChangesReady)) {
            recuperarConexion();
        }
    });

    window.addEventListener("offline", () => {
        // El navegador puede notificar la caída antes que el SDK.
        estadoCanal = "DESCONECTADO";
        reiniciarPostgresChanges("DEGRADADO");
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

    function prepararAuth() {
        cliente = window.haikuSupabase;
        if (authInstalado || !cliente?.auth?.onAuthStateChange) return;
        authInstalado = true;
        cliente.auth.onAuthStateChange(evento => {
            if (evento === "SIGNED_OUT") desconectar();
        });
    }
    document.addEventListener("haiku:supabase-ready", () => {
        prepararAuth();
        conectar();
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
        },
        get postgres_changes_ready() {
            return postgresChangesReady;
        },
        estadoPostgresChanges() {
            return estadoPostgresChanges;
        }
    });

    prepararAuth();
    if (window.haikuSesion) {
        conectar();
        programarRefresco(100);
    }

    console.info("HAIKU · Aseo Realtime V1 preparado.");
})();
