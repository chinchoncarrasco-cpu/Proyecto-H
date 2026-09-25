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

    function estadoFinalDerivado(numero, valorRevision) {
        const fecha = fechaActual();
        const dato = fecha && typeof obtenerDatosDia === "function"
            ? obtenerDatosDia(fecha)?.cabanas?.[numero] || {}
            : {};
        const derivar = window.HAIKU_CABANAS_SITES_V1?.estadoFinal;
        return typeof derivar === "function"
            ? derivar({ ...dato, estadoRevision: valorRevision })
            : "pendiente";
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

        if (valor === "EN_REVISION" || valor === "EN REVISIÓN" || valor === "EN REVISION") {
            return "en_revision";
        }

        if (valor === "" || valor === "PENDIENTE") return "pendiente";
        return null;
    }

    function aplicarLocal(numero, valorRevision) {
        const fecha = fechaActual();
        if (!fecha || typeof obtenerDatosDia !== "function") return;

        const datos = obtenerDatosDia(fecha);
        datos.cabanas[numero] ||= {};
        datos.cabanas[numero].estadoRevision = valorRevision;
        if (datos.cabanas[numero].revisionCompletaCiclo?.fecha === fecha) {
            datos.cabanas[numero].revisionCompletaCiclo.verificado = false;
        }
        datos.cabanas[numero].estadoFinal = estadoFinalDerivado(numero, valorRevision);

        if (typeof guardarDatos === "function") {
            guardarDatos();
        }
    }

    function aplicarResumen(numero, valorRevision) {
        const fila = document.querySelector(
            `#seccion-resumen .sites-resumen-cabana[data-cabana="${String(numero)}"]`
        );
        const selector = fila?.querySelector(
            '[data-campo="estadoFinal"], [data-campo="estadoRevision"]'
        );

        if (selector) {
            selector.value = estadoFinalDerivado(numero, valorRevision);
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

    function refrescarDesdeLocal(origen = { evento: "proyección local", tipo: "interno_derivado" }) {
        if (window.HAIKU_RESUMEN_REFRESH_V1?.activo() &&
            !window.HAIKU_RESUMEN_REFRESH_V1.publicando()) {
            window.HAIKU_RESUMEN_REFRESH_V1.solicitar(fechaActual(), {
                categoria: "revisión", ...origen
            });
            return;
        }
        const fecha = fechaActual();
        if (!fecha || typeof obtenerDatosDia !== "function") return;

        const datos = obtenerDatosDia(fecha);

        Object.entries(datos.cabanas || {}).forEach(([numero, cabana]) => {
            const valor = cabana?.estadoRevision || "pendiente";
            aplicarResumen(numero, valor);
        });

        refrescarVistasLocales();
        document.dispatchEvent(new CustomEvent("haiku:resumen-datos-actualizados", {
            detail: { fecha }
        }));
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

    async function guardarEstadoResumenEnSupabase(numero, valorRevision, fecha) {
        const supabase = cliente();

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

        let estado = valorRevision === "pendiente" ? "pendiente" : "en_proceso";
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

        if (typeof obtenerDatosDia === "function") {
            const cabana = obtenerDatosDia(fecha)?.cabanas?.[numero];
            if (cabana) {
                cabana.estadoRevision = valorRevision;
                cabana.revisionCompletaCiclo = {
                    fecha,
                    verificado: true,
                    id: revision.id,
                    estado,
                    resultado
                };
                const derivar = window.HAIKU_CABANAS_SITES_V1?.estadoFinal;
                if (typeof derivar === "function") cabana.estadoFinal = derivar(cabana);
                if (typeof guardarDatos === "function") guardarDatos();
            }
        }
        if (fecha === fechaActual()) refrescarDesdeLocal({
            evento: "escritura revisión confirmada", tipo: "externo"
        });

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
            .then(() => guardarEstadoResumenEnSupabase(numero, valorRevision, fecha));

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

    async function resincronizar(origen = {
        evento: "sincronización derivada", tipo: "interno_derivado"
    }) {
        if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) {
            return window.HAIKU_RESUMEN_REFRESH_V1.solicitar(fechaActual(), {
                categoria: "revisión", ...origen
            });
        }
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
            refrescarDesdeLocal(origen);
        } finally {
            sincronizando = false;

            if (sincronizacionPendiente) {
                sincronizacionPendiente = false;
                clearTimeout(timer);
                timer = setTimeout(() => resincronizar(origen), 0);
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
            timer = setTimeout(() => resincronizar({
                evento: "selector revisión guardado", tipo: "externo"
            }), 750);
        });
    }

    function instalarAutoRefresh() {
        ["seccion-resumen", "seccion-cabanas"].forEach(id => {
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
        instalarAutoRefresh();
        document.addEventListener("haiku:revision-estado-guardado", evento => {
            if (evento.detail?.fecha === fechaActual()) resincronizar({
                evento: "revisión estado guardado", tipo: "externo"
            });
        });
        document.addEventListener("haiku:revision-item-guardado", evento => {
            if (evento.detail?.fecha === fechaActual()) resincronizar({
                evento: "revisión item guardado", tipo: "externo"
            });
        });
        resincronizar();

        window.HAIKU_REVISION_RESUMEN_SYNC_V2 = Object.freeze({
            resincronizar,
            refrescarDesdeLocal,
            guardarDesdeResumen(numero, estado) {
                const valorRevision = revisionDesdeEstadoFinal(estado);
                if (!valorRevision) {
                    return Promise.reject(new Error("Estado de revisión no reconocido."));
                }
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
