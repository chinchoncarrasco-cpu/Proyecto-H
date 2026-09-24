// ========================================
// HAIKU · SERVICIOS · HIDRATACIÓN SUPABASE V1
// Supabase -> cache legacy para mantener UI actual sincronizada
// entre PC, celular y otros navegadores.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const CACHE_KEY = "haikuServicios";
    const MAPA_KEY = "haikuSupabaseServicioMapV1";

    let sincronizando = null;
    let timer = null;

    function horaCorta(valor) {
        const texto = String(valor || "");
        return texto ? texto.slice(0, 5) : "";
    }

    function observacionesLimpias(valor) {
        return String(valor || "")
            .split(" · ")
            .filter(parte => !parte.startsWith("HAIKU-LEGACY-ID:"))
            .join(" · ")
            .trim();
    }

    function leerMapa() {
        try {
            return JSON.parse(localStorage.getItem(MAPA_KEY) || "{}");
        } catch {
            return {};
        }
    }

    function guardarMapaDesdeServicios(lista) {
        const mapa = leerMapa();

        lista.forEach(servicio => {
            const id = String(servicio?.id || "");
            if (id) mapa[id] = id;
        });

        try {
            localStorage.setItem(MAPA_KEY, JSON.stringify(mapa));
        } catch {}
    }

    function normalizar(fila) {
        const estancia = fila?.reserva_estadias || null;
        const cabana = estancia?.cabanas || null;
        const reserva = fila?.reservas || null;
        const catalogo = fila?.catalogo_servicios || null;

        const total = Number(fila?.total || 0);
        const tipoCobro = String(fila?.tipo_cobro || "normal");
        const estadoDb = String(fila?.estado_servicio || "programado");

        return {
            id: String(fila?.id || ""),
            fecha: String(fila?.fecha_servicio || ""),
            numeroCabana: cabana?.numero == null ? "" : String(cabana.numero),
            reservaId: String(fila?.reserva_id || ""),
            titular: String(reserva?.titular_nombre || ""),

            tipoServicio: String(catalogo?.codigo || ""),
            categoria: String(catalogo?.categoria || ""),
            nombre: String(catalogo?.nombre || "Servicio"),

            cantidad: Number(fila?.cantidad || 1),
            personas: Number(fila?.personas || 0),

            fechaServicio: String(fila?.fecha_servicio || ""),
            hora: horaCorta(fila?.hora_inicio),
            precioManual: null,
            precioUnitario: Number(fila?.precio_unitario_aplicado || 0),
            total,

            tipoCobro,
            cortesia: tipoCobro === "cortesia" || total === 0,
            estadoServicio: estadoDb === "realizado" ? "realizado" : "pendiente",
            estadoPago: tipoCobro === "cortesia" || total === 0
                ? "no-corresponde"
                : "pendiente",

            observaciones: observacionesLimpias(fila?.observaciones),
            creadoEn: String(fila?.creado_en || ""),
            supabaseId: String(fila?.id || "")
        };
    }

    function reemplazarCache(lista) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(lista));
        } catch (error) {
            console.warn("HAIKU · No se pudo actualizar cache de Servicios:", error);
        }

        // serviciosRegistrados es un let global del módulo legacy Servicios.
        try {
            if (typeof serviciosRegistrados !== "undefined") {
                serviciosRegistrados = lista;
            }
        } catch {}

        guardarMapaDesdeServicios(lista);
    }

    function refrescarResumenServicios(lista) {
        const fecha = (() => {
            try {
                return typeof fechaSeleccionada !== "undefined"
                    ? String(fechaSeleccionada || "")
                    : "";
            } catch {
                return "";
            }
        })();

        if (fecha) {
            document.querySelectorAll("#seccion-resumen .sites-resumen-cabana[data-cabana]").forEach(fila => {
                const numero = String(fila?.dataset?.cabana || "");
                const campo = fila.querySelector('[data-campo="servicio"]');
                if (!numero || !campo) return;

                const delDia = lista.filter(servicio =>
                    servicio.fechaServicio === fecha &&
                    String(servicio.numeroCabana) === numero
                );

                campo.value = delDia.map(servicio => {
                    const hora = servicio.hora ? `${servicio.hora} ` : "";
                    const cortesia = servicio.cortesia ? " 🎁" : "";
                    return `${hora}${servicio.nombre}${cortesia}`;
                }).join(" · ");
            });

            try {
                if (typeof actualizarResumenDia === "function") {
                    actualizarResumenDia(fecha);
                }
            } catch {}

            try {
                if (typeof generarResumenOperativo === "function") {
                    generarResumenOperativo(fecha);
                }
            } catch {}
        }

        try {
            if (typeof renderizarAgendaServicios === "function") {
                renderizarAgendaServicios();
            }
        } catch {}

        document.dispatchEvent(
            new CustomEvent("haiku:servicios-hidratados", {
                detail: { cantidad: lista.length, fecha }
            })
        );
        if (fecha) {
            document.dispatchEvent(new CustomEvent("haiku:resumen-datos-actualizados", {
                detail: { fecha }
            }));
        }
    }

    async function traerServiciosSupabase() {
        // Protege cualquier servicio creado localmente que todavía no haya
        // alcanzado Supabase antes de sustituir el cache de este navegador.
        try {
            if (typeof window.haikuMigrarServiciosLegacySupabase === "function") {
                await window.haikuMigrarServiciosLegacySupabase();
            }
        } catch (error) {
            console.warn(
                "HAIKU · Hidratación Servicios: migración previa incompleta",
                error
            );
        }

        const { data, error } = await cliente
            .from("servicios")
            .select(`
                id,
                reserva_id,
                estadia_id,
                fecha_servicio,
                hora_inicio,
                hora_fin,
                cantidad,
                personas,
                precio_unitario_aplicado,
                total,
                tipo_cobro,
                estado_servicio,
                observaciones,
                creado_en,
                reservas (
                    titular_nombre,
                    codigo_haiku
                ),
                catalogo_servicios (
                    codigo,
                    categoria,
                    nombre
                ),
                reserva_estadias (
                    cabana_id,
                    cabanas (
                        numero
                    )
                )
            `)
            .neq("estado_servicio", "cancelado")
            .order("fecha_servicio", { ascending: true })
            .order("hora_inicio", { ascending: true });

        if (error) throw error;

        return (data || [])
            .map(normalizar)
            .filter(servicio => servicio.id && servicio.fechaServicio);
    }

    async function sincronizar() {
        if (sincronizando) return sincronizando;

        sincronizando = (async () => {
            try {
                const lista = await traerServiciosSupabase();
                reemplazarCache(lista);
                refrescarResumenServicios(lista);

                // La capa financiera toma esta lista recién hidratada y calcula
                // Pendiente/Pagado desde cargos y pagos reales.
                try {
                    await window.haikuSincronizarFinanzasServicios?.();
                } catch {}

                console.info(
                    "HAIKU · Servicios hidratados desde Supabase:",
                    lista.length
                );

                return lista;
            } catch (error) {
                console.error(
                    "HAIKU · No fue posible hidratar Servicios desde Supabase:",
                    error
                );
                return null;
            } finally {
                sincronizando = null;
            }
        })();

        return sincronizando;
    }

    function programar(delay = 80) {
        clearTimeout(timer);
        timer = setTimeout(sincronizar, delay);
    }

    // Al iniciar sesión en cualquier dispositivo, traer la verdad común.
    window.addEventListener("haiku:auth-ready", () => programar(20));

    // Al volver a Resumen/Servicios, refrescar antes de depender del cache local.
    document.addEventListener("click", evento => {
        if (
            evento.target.closest('[data-seccion="resumen"]') ||
            evento.target.closest('[data-seccion="servicios"]') ||
            evento.target.closest('[data-ir-seccion="servicios"]')
        ) {
            programar(0);
        }
    });

    // Si otro flujo cambió un servicio, volver a descargar la lista real.
    document.addEventListener(
        "haiku:servicio-supabase-cambiado",
        () => programar(60)
    );

    // Útil en celular al volver a HAIKU después de estar en otra app.
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) programar(40);
    });

    window.addEventListener("focus", () => programar(60));

    window.haikuSincronizarServiciosDesdeSupabase = sincronizar;

    setTimeout(() => {
        if (window.haikuSesion) programar(0);
    }, 650);

    console.info("HAIKU · Hidratación Servicios Supabase V1 preparada.");
})();
