// HAIKU · Revisión <-> Resumen Sync V2
(() => {
    "use strict";

    let timer = null;
    let sincronizando = false;
    let sincronizacionPendiente = false;
    const escriturasPendientes = new Map();

    function cliente() {
        return window.haikuSupabase || null;
    }

    function fechaActual() {
        try {
            return typeof fechaSeleccionada !== "undefined"
                ? String(fechaSeleccionada || "")
                : "";
        } catch (_) {
            return "";
        }
    }

    function numeroAbierto() {
        return localStorage.getItem("haikuRevisionCabana") || "";
    }

    function estadoFinal(valorRevision) {
        if (valorRevision === "lista") return "LISTA";
        if (valorRevision === "con-detalles") return "CON DETALLES";
        return "";
    }

    function revisionDesdeEstadoFinal(valorEstadoFinal) {
        const valor = String(valorEstadoFinal || "")
            .trim()
            .toUpperCase();

        if (valor === "LISTA") {
            return "lista";
        }

        if (
            valor === "CON DETALLES" ||
            valor === "CON-DETALLES" ||
            valor === "DET." ||
            valor === "DET"
        ) {
            return "con-detalles";
        }

        return "pendiente";
    }

    function aplicarLocal(numero, valorRevision) {
        const fecha = fechaActual();
        if (!fecha || typeof obtenerDatosDia !== "function") return;

        const datos = obtenerDatosDia(fecha);
        datos.cabanas[numero] ||= {};
        datos.cabanas[numero].estadoRevision = valorRevision;
        datos.cabanas[numero].estadoFinal = estadoFinal(valorRevision);

        if (typeof guardarDatos === "function") {
            guardarDatos();
        }
    }

    function aplicarResumen(numero, valorRevision) {
        const fila = document.querySelector(
            `#seccion-resumen [data-cabana="${String(numero)}"]`
        );
        const selector = fila?.querySelector(
            '[data-campo="estadoFinal"], [data-campo="estadoRevision"]'
        );

        if (selector) {
            selector.value = selector.dataset.campo === "estadoRevision"
                ? valorRevision
                : estadoFinal(valorRevision);
        }
    }

    function refrescarVistasLocales() {
        const fecha = fechaActual();
        if (!fecha) return;

        if (typeof actualizarTarjetasRevision === "function") {
            actualizarTarjetasRevision(fecha);
        }

        if (typeof actualizarResumenAseo === "function") {
            actualizarResumenAseo(fecha);
        }
    }

    function refrescarAseoExpressAbierto() {
        const panel = document.getElementById("aseo-express-individual");
        const selector = document.getElementById("aseo-express-estado");
        const numero = localStorage.getItem("haikuAseoExpressCabana") || "";
        const fecha = fechaActual();

        if (
            !panel?.classList.contains("activa") ||
            !selector ||
            !numero ||
            !fecha ||
            typeof obtenerDatosDia !== "function"
        ) {
            return;
        }

        const datos = obtenerDatosDia(fecha);
        selector.value =
            datos.cabanas?.[numero]?.estadoRevision || "pendiente";
    }

    function refrescarDesdeLocal() {
        const fecha = fechaActual();
        if (!fecha || typeof obtenerDatosDia !== "function") return;

        const datos = obtenerDatosDia(fecha);

        Object.entries(datos.cabanas || {}).forEach(([numero, cabana]) => {
            const valor = cabana?.estadoRevision || "pendiente";
            aplicarResumen(numero, valor);
        });

        refrescarVistasLocales();
        refrescarAseoExpressAbierto();
    }

    async function obtenerUsuarioId() {
        const supabase = cliente();
        if (!supabase) return null;

        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;

        return data?.user?.id || null;
    }

    async function obtenerCabanaId(numero) {
        const supabase = cliente();
        if (!supabase) return null;

        const { data, error } = await supabase
            .from("cabanas")
            .select("id")
            .eq("numero", Number(numero))
            .single();

        if (error) throw error;
        return data?.id || null;
    }

    async function buscarRevision(fecha, cabanaId) {
        const supabase = cliente();
        if (!supabase) return null;

        const { data, error } = await supabase
            .from("revisiones_cabana")
            .select("id, estado, resultado, observaciones, creado_en")
            .eq("fecha", fecha)
            .eq("cabana_id", cabanaId)
            .eq("tipo_revision", "completa")
            .neq("estado", "cancelada")
            .order("creado_en", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data || null;
    }

    async function asegurarRevision(fecha, numero, cabanaId) {
        let revision = await buscarRevision(fecha, cabanaId);
        if (revision) return revision;

        const supabase = cliente();
        const usuarioId = await obtenerUsuarioId();
        const ahora = new Date().toISOString();

        const { data, error } = await supabase
            .from("revisiones_cabana")
            .insert({
                fecha,
                cabana_id: cabanaId,
                tipo_revision: "completa",
                estado: "en_proceso",
                resultado: null,
                revisado_por: usuarioId,
                iniciado_en: ahora,
                finalizado_en: null,
                observaciones: null
            })
            .select("id, estado, resultado, observaciones, creado_en")
            .single();

        if (!error) {
            return data;
        }

        // Otra pestaña pudo haber creado la revisión al mismo tiempo.
        revision = await buscarRevision(fecha, cabanaId);
        if (revision) return revision;

        throw error;
    }

    async function guardarEstadoResumenEnSupabase(numero, valorRevision) {
        const supabase = cliente();
        const fecha = fechaActual();

        if (!supabase || !fecha || !numero) {
            return;
        }

        const cabanaId = await obtenerCabanaId(numero);
        if (!cabanaId) {
            throw new Error(`No se encontró CAB ${numero} en Supabase.`);
        }

        const revision = await asegurarRevision(
            fecha,
            numero,
            cabanaId
        );

        const usuarioId = await obtenerUsuarioId();
        const ahora = new Date().toISOString();

        let estado = "en_proceso";
        let resultado = null;
        let finalizadoEn = null;

        if (valorRevision === "lista") {
            estado = "completada";
            resultado = "lista";
            finalizadoEn = ahora;
        } else if (valorRevision === "con-detalles") {
            estado = "completada";
            resultado = "con_detalles";
            finalizadoEn = ahora;
        }

        const { error } = await supabase
            .from("revisiones_cabana")
            .update({
                estado,
                resultado,
                finalizado_en: finalizadoEn,
                revisado_por: usuarioId
            })
            .eq("id", revision.id);

        if (error) throw error;

        window.HAIKU_REVISION_SUPABASE_V1?.limpiarCache?.();

        console.log(
            "HAIKU · Estado final guardado en revisión Supabase:",
            {
                fecha,
                cabana: String(numero),
                estadoRevision: valorRevision,
                revisionId: revision.id
            }
        );
    }

    function encolarEscritura(numero, valorRevision) {
        const fecha = fechaActual();
        const clave = `${fecha}::${String(numero)}`;
        const anterior = escriturasPendientes.get(clave) || Promise.resolve();

        const tarea = anterior
            .catch(() => {})
            .then(() => guardarEstadoResumenEnSupabase(numero, valorRevision));

        escriturasPendientes.set(clave, tarea);

        tarea.then(
            () => {
                if (escriturasPendientes.get(clave) === tarea) {
                    escriturasPendientes.delete(clave);
                }
            },
            () => {
                if (escriturasPendientes.get(clave) === tarea) {
                    escriturasPendientes.delete(clave);
                }
            }
        );

        return tarea;
    }

    async function esperarEscriturasPendientes() {
        while (escriturasPendientes.size > 0) {
            const tareas = Array.from(escriturasPendientes.values());
            await Promise.allSettled(tareas);
        }
    }

    async function resincronizar() {
        if (sincronizando) {
            sincronizacionPendiente = true;
            return;
        }

        const puente = window.HAIKU_REVISION_SUPABASE_V1;
        if (!puente) return;

        sincronizando = true;

        try {
            // Nunca leer Supabase mientras todavía hay un cambio de Resumen
            // pendiente de escritura. Así evitamos que el valor viejo gane.
            await esperarEscriturasPendientes();

            puente.limpiarCache?.();
            await puente.sincronizarResumenFecha?.();
            refrescarDesdeLocal();
        } finally {
            sincronizando = false;

            if (sincronizacionPendiente) {
                sincronizacionPendiente = false;
                clearTimeout(timer);
                timer = setTimeout(resincronizar, 0);
            }
        }
    }

    function instalarSelectorRevision() {
        const selector = document.getElementById("revision-estado");
        if (!selector || selector.dataset.haikuResumenSyncV2 === "1") return;

        selector.dataset.haikuResumenSyncV2 = "1";

        selector.addEventListener("change", () => {
            const numero = numeroAbierto();
            if (!numero) return;

            const valor = selector.value || "pendiente";
            aplicarLocal(numero, valor);
            aplicarResumen(numero, valor);
            refrescarVistasLocales();

            // La capa V1 guarda esta misma selección en Supabase.
            // Damos un pequeño margen y luego verificamos desde la fuente real.
            clearTimeout(timer);
            timer = setTimeout(resincronizar, 750);
        });
    }

    function instalarSelectorResumen() {
        const seccion = document.getElementById("seccion-resumen");
        if (!seccion || seccion.dataset.haikuRevisionResumenV2 === "1") return;

        seccion.dataset.haikuRevisionResumenV2 = "1";

        // Delegación en captura: detectamos el cambio aunque la lógica legacy
        // redibuje otras vistas inmediatamente después.
        seccion.addEventListener(
            "change",
            evento => {
                const selector = evento.target?.closest?.(
                    '[data-campo="estadoFinal"], [data-campo="estadoRevision"]'
                );

                if (!selector) return;

                const fila = selector.closest("[data-cabana]");
                const numero = String(fila?.dataset?.cabana || "");
                if (!numero) return;

                const valorRevision = revisionDesdeEstadoFinal(
                    selector.value
                );

                // Feedback inmediato para Cabañas y Aseo.
                aplicarLocal(numero, valorRevision);
                refrescarVistasLocales();

                encolarEscritura(numero, valorRevision)
                    .then(() => {
                        clearTimeout(timer);
                        timer = setTimeout(resincronizar, 0);
                    })
                    .catch(error => {
                        console.error(
                            "HAIKU · No fue posible sincronizar Estado final con la revisión Supabase:",
                            error
                        );

                        // Si falló la escritura, volvemos a la verdad de Supabase.
                        clearTimeout(timer);
                        timer = setTimeout(resincronizar, 0);
                    });
            },
            true
        );
    }

    function instalarAutoRefresh() {
        ["seccion-resumen", "seccion-cabanas", "seccion-aseo"].forEach(id => {
            const seccion = document.getElementById(id);
            if (!seccion) return;

            let activaAntes = seccion.classList.contains("activa");

            const observer = new MutationObserver(() => {
                const activa = seccion.classList.contains("activa");

                if (activa && !activaAntes) {
                    resincronizar();
                }

                activaAntes = activa;
            });

            observer.observe(seccion, {
                attributes: true,
                attributeFilter: ["class"]
            });
        });
    }

    function iniciar() {
        instalarSelectorRevision();
        instalarSelectorResumen();
        instalarAutoRefresh();
        resincronizar();

        window.HAIKU_REVISION_RESUMEN_SYNC_V2 = Object.freeze({
            resincronizar,
            refrescarDesdeLocal,
            guardarDesdeResumen(numero, estado) {
                const valorRevision = revisionDesdeEstadoFinal(estado);
                aplicarLocal(String(numero), valorRevision);
                refrescarVistasLocales();
                return encolarEscritura(String(numero), valorRevision);
            }
        });

        console.log("HAIKU · Revisión <-> Resumen Sync V2 activo.");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    } else {
        iniciar();
    }
})();
