// ========================================
// HAIKU · ASEO RESUMEN SYNC V1
// Une los campos de Aseo del Resumen con la fuente real de Supabase.
// Sin observers, sin intervalos y sin parches globales.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const CAMPOS_ASEO = new Set(["aseo", "aseoIn", "aseoOut"]);
    let canal = null;
    let refrescoProgramado = null;
    let origenProgramado = null;
    let refrescando = false;

    function fechaOperativa() {
        try {
            return typeof fechaSeleccionada !== "undefined" && fechaSeleccionada
                ? String(fechaSeleccionada).slice(0, 10)
                : "";
        } catch (_) {
            return "";
        }
    }

    function datosDiaLocal(fecha) {
        try {
            if (typeof obtenerDatosDia === "function") {
                return obtenerDatosDia(fecha);
            }
        } catch (_) {}

        try {
            const datos = JSON.parse(localStorage.getItem("haikuDatos") || "{}");
            return datos?.[fecha] || null;
        } catch (_) {
            return null;
        }
    }

    function campoResumen(objetivo) {
        if (!objetivo?.matches?.("#seccion-resumen .sites-resumen-cabana[data-cabana] [data-campo]")) {
            return null;
        }

        const campo = String(objetivo.dataset.campo || "");
        if (!CAMPOS_ASEO.has(campo)) return null;

        const fila = objetivo.closest(".sites-resumen-cabana[data-cabana]");
        const numero = String(fila?.dataset.cabana || "");
        if (!numero) return null;

        return { campo, numero, elemento: objetivo };
    }

    function valorCampo(elemento, campo) {
        const valor = String(elemento?.value || "");
        return campo === "aseo" ? valor.trim() : valor;
    }

    function pintarResumen(fecha = fechaOperativa()) {
        if (!fecha) return;

        const dia = datosDiaLocal(fecha);
        const cabanas = dia?.cabanas || {};

        document
            .querySelectorAll("#seccion-resumen .sites-resumen-cabana[data-cabana]")
            .forEach(fila => {
                const numero = String(fila.dataset.cabana || "");
                const cabana = cabanas?.[numero] || {};

                [
                    ["aseo", cabana.aseo || ""],
                    ["aseoIn", cabana.aseoIn || ""],
                    ["aseoOut", cabana.aseoOut || ""]
                ].forEach(([campo, valor]) => {
                    const input = fila.querySelector(`[data-campo="${campo}"]`);
                    if (!input || document.activeElement === input) return;
                    if (input.value !== String(valor || "")) {
                        input.value = String(valor || "");
                    }
                });
            });

        document.dispatchEvent(new CustomEvent("haiku:resumen-datos-actualizados", {
            detail: { fecha }
        }));
    }

    async function hidratarYPintar(origen = {
        evento: "sincronización derivada", tipo: "interno_derivado"
    }) {
        if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) {
            return window.HAIKU_RESUMEN_REFRESH_V1.solicitar(fechaOperativa(), {
                categoria: "aseo", ...origen
            });
        }
        if (!window.haikuSesion || refrescando) return;

        const fecha = fechaOperativa();
        const api = window.HAIKU_ASEO_OPERACION_V1;
        if (!fecha || !api?.hidratar) return;

        refrescando = true;
        try {
            await api.hidratar(fecha, { pintar: false });
            if (fecha !== fechaOperativa()) return;
            pintarResumen(fecha);
            console.info("HAIKU · Aseo del Resumen sincronizado:", fecha);
        } catch (error) {
            console.error("HAIKU · No fue posible sincronizar Aseo del Resumen:", error);
        } finally {
            refrescando = false;
        }
    }

    function programarRefresco(demora = 70, origen = {
        evento: "sincronización derivada", tipo: "interno_derivado"
    }) {
        if (refrescoProgramado && origenProgramado === "externo" &&
            origen.tipo === "interno_derivado") return;
        clearTimeout(refrescoProgramado);
        origenProgramado = origen.tipo;
        refrescoProgramado = setTimeout(() => {
            refrescoProgramado = null;
            origenProgramado = null;
            hidratarYPintar(origen);
        }, demora);
    }

    async function guardarDesdeResumen(info) {
        const api = window.HAIKU_ASEO_OPERACION_V1;
        if (!api?.guardarCampoAseo) return;

        const valor = valorCampo(info.elemento, info.campo);

        try {
            await api.guardarCampoAseo(info.numero, info.campo, valor);
            // La escritura ya quedó confirmada en Supabase. Repintamos sólo
            // estos campos desde la misma fuente para mantener PC y móvil iguales.
            await hidratarYPintar({
                evento: "escritura aseo confirmada", tipo: "externo"
            });
        } catch (error) {
            console.error("HAIKU · No fue posible guardar Aseo desde Resumen:", error);
            alert("No fue posible guardar el cambio de Aseo. Revisa la conexión e inténtalo nuevamente.");
            programarRefresco(0);
        }
    }

    document.addEventListener("change", evento => {
        const info = campoResumen(evento.target);
        if (!info) return;
        guardarDesdeResumen(info);
    }, true);

    function conectarRealtime() {
        if (canal || !window.haikuSesion) return;

        canal = cliente
            .channel("haiku-aseo-resumen-sync-v1")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "aseos" },
                () => programarRefresco(60, {
                    evento: "realtime aseos", tipo: "externo"
                })
            )
            .subscribe(status => {
                if (status === "SUBSCRIBED") {
                    console.info("HAIKU · Aseo Resumen conectado a Realtime.");
                    programarRefresco(0);
                }
            });
    }

    window.addEventListener("haiku:auth-ready", () => {
        conectarRealtime();
        programarRefresco(0);
    });

    window.addEventListener("focus", () => {
        if (window.haikuSesion) programarRefresco(50);
    });

    window.addEventListener("pageshow", () => {
        if (window.haikuSesion) programarRefresco(50);
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && window.haikuSesion) {
            programarRefresco(50);
        }
    });

    document.addEventListener("click", evento => {
        if (evento.target?.closest?.('.menu-item[data-seccion="resumen"]')) {
            programarRefresco(0);
        }
    });

    window.HAIKU_ASEO_RESUMEN_SYNC_V1 = Object.freeze({
        refrescar: () => hidratarYPintar({
            evento: "refresh explícito aseo", tipo: "externo"
        }),
        pintar: pintarResumen
    });

    if (window.haikuSesion) {
        conectarRealtime();
        programarRefresco(0);
    }

    console.info("HAIKU · Aseo Resumen Sync V1 preparado.");
})();
