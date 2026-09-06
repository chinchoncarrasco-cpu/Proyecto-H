// ========================================
// HAIKU · SERVICIOS · HIDRATACIÓN SUPABASE V2
// Incluye cancelados para conservar historial/reactivación,
// pero los excluye de la operación activa del Resumen.
// ========================================
(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const CACHE_KEY = "haikuServicios";
    const MAPA_KEY = "haikuSupabaseServicioMapV1";

    let sincronizando = null;
    let timer = null;
    let primeraHidratacionLista = false;

    function marcarCargaInicial() {
        if (primeraHidratacionLista) return;

        const contador = document.getElementById("servicios-contador-hoy");
        if (!contador) return;

        contador.textContent = "…";
        contador.dataset.haikuServiciosCargando = "1";
        contador.setAttribute("aria-label", "Cargando servicios desde Supabase");
    }

    function limpiarMarcaCargaInicial() {
        const contador = document.getElementById("servicios-contador-hoy");
        if (!contador) return;

        delete contador.dataset.haikuServiciosCargando;
        contador.removeAttribute("aria-label");
    }

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
        try { localStorage.setItem(MAPA_KEY, JSON.stringify(mapa)); } catch {}
    }

    function estadoLegacy(estadoDb) {
        if (estadoDb === "realizado") return "realizado";
        if (estadoDb === "cancelado") return "cancelado";
        if (estadoDb === "no_show") return "no_show";
        return "pendiente";
    }

    function normalizar(fila) {
        const estancia = fila?.reserva_estadias || null;
        const cabana = estancia?.cabanas || null;
        const reserva = fila?.reservas || null;
        const catalogo = fila?.catalogo_servicios || null;

        const total = Number(fila?.total || 0);
        const tipoCobro = String(fila?.tipo_cobro || "normal");
        const estadoDb = String(fila?.estado_servicio || "programado");
        const estaCancelado = ["cancelado", "no_show"].includes(estadoDb);

        return {
            id: String(fila?.id || ""),
            fecha: String(fila?.fecha_servicio || ""),
            numeroCabana: cabana?.numero == null ? "" : String(cabana.numero),
            reservaId: String(fila?.reserva_id || ""),
            titular: String(reserva?.titular_nombre || ""),

            tipoServicio: String(catalogo?.codigo || ""),
            categoria: String(catalogo?.categoria || ""),
            nombre: String(catalogo?.nombre || "Servicio"),
            duracionMinutos: Number(catalogo?.duracion_minutos || 0),

            cantidad: Number(fila?.cantidad || 1),
            personas: Number(fila?.personas || 0),

            fechaServicio: String(fila?.fecha_servicio || ""),
            hora: horaCorta(fila?.hora_inicio),
            horaFin: horaCorta(fila?.hora_fin),
            precioManual: null,
            precioUnitario: Number(fila?.precio_unitario_aplicado || 0),
            total,

            tipoCobro,
            cortesia: tipoCobro === "cortesia" || total === 0,
            estadoServicio: estadoLegacy(estadoDb),
            estadoServicioDb: estadoDb,
            estadoPago:
                estaCancelado || tipoCobro === "cortesia" || total === 0
                    ? "no-corresponde"
                    : "pendiente",

            observaciones: observacionesLimpias(fila?.observaciones),
            canceladoEn: String(fila?.cancelado_en || ""),
            motivoCancelacion: String(fila?.motivo_cancelacion || ""),
            creadoEn: String(fila?.creado_en || ""),
            supabaseId: String(fila?.id || "")
        };
    }

    function reemplazarCache(lista) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(lista)); } catch (error) {
            console.warn("HAIKU · No se pudo actualizar cache de Servicios:", error);
        }

        try {
            if (typeof serviciosRegistrados !== "undefined") {
                serviciosRegistrados = lista;
            }
        } catch {}

        guardarMapaDesdeServicios(lista);
    }

    function estaActivo(servicio) {
        return !["cancelado", "no_show"].includes(
            String(servicio?.estadoServicio || "")
        );
    }

    function refrescarResumenServicios(lista) {
        const fecha = (() => {
            try {
                return typeof fechaSeleccionada !== "undefined"
                    ? String(fechaSeleccionada || "")
                    : "";
            } catch { return ""; }
        })();

        if (fecha) {
            document.querySelectorAll("#seccion-resumen [data-cabana]").forEach(fila => {
                const numero = String(fila?.dataset?.cabana || "");
                const campo = fila.querySelector('[data-campo="servicio"]');
                if (!numero || !campo) return;

                const delDia = lista.filter(servicio =>
                    estaActivo(servicio) &&
                    servicio.fechaServicio === fecha &&
                    String(servicio.numeroCabana) === numero
                );

                campo.value = delDia.map(servicio => {
                    const hora = servicio.hora ? `${servicio.hora} ` : "";
                    const cortesia = servicio.cortesia ? " 🎁" : "";
                    return `${hora}${servicio.nombre}${cortesia}`;
                }).join(" · ");
            });

            try { actualizarResumenDia?.(fecha); } catch {}
            try { generarResumenOperativo?.(fecha); } catch {}
        }

        try { renderizarAgendaServicios?.(); } catch {}

        document.dispatchEvent(
            new CustomEvent("haiku:servicios-hidratados", {
                detail: {
                    cantidad: lista.filter(estaActivo).length,
                    cantidadTotal: lista.length,
                    fecha
                }
            })
        );
    }

    async function traerServiciosSupabase() {
        try {
            if (typeof window.haikuMigrarServiciosLegacySupabase === "function") {
                await window.haikuMigrarServiciosLegacySupabase();
            }
        } catch (error) {
            console.warn("HAIKU · Hidratación Servicios V2: migración previa incompleta", error);
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
                cancelado_en,
                motivo_cancelacion,
                creado_en,
                reservas (
                    titular_nombre,
                    codigo_haiku
                ),
                catalogo_servicios (
                    codigo,
                    categoria,
                    nombre,
                    duracion_minutos
                ),
                reserva_estadias (
                    cabana_id,
                    cabanas ( numero )
                )
            `)
            .order("fecha_servicio", { ascending: true })
            .order("hora_inicio", { ascending: true });

        if (error) throw error;

        return (data || [])
            .map(normalizar)
            .filter(servicio => servicio.id && servicio.fechaServicio);
    }

    async function sincronizar() {
        if (sincronizando) return sincronizando;

        if (!primeraHidratacionLista) {
            marcarCargaInicial();
        }

        sincronizando = (async () => {
            try {
                const lista = await traerServiciosSupabase();
                reemplazarCache(lista);
                refrescarResumenServicios(lista);

                primeraHidratacionLista = true;
                limpiarMarcaCargaInicial();

                try { await window.haikuSincronizarFinanzasServicios?.(); } catch {}

                console.info(
                    "HAIKU · Servicios V2 hidratados desde Supabase:",
                    lista.length
                );
                return lista;
            } catch (error) {
                console.error("HAIKU · No fue posible hidratar Servicios V2:", error);

                // Si la primera lectura real falla, no dejamos el contador en
                // estado de carga permanente: recuperamos el valor local que ya
                // existía y permitimos que un próximo intento vuelva a consultar.
                if (!primeraHidratacionLista) {
                    try { renderizarAgendaServicios?.(); } catch {}
                    limpiarMarcaCargaInicial();
                }

                return null;
            } finally {
                sincronizando = null;
            }
        })();

        return sincronizando;
    }

    function programar(delay = 80) {
        clearTimeout(timer);

        if (!primeraHidratacionLista) {
            marcarCargaInicial();
        }

        timer = setTimeout(sincronizar, delay);
    }

    // El valor del localStorage puede pertenecer a una sesión/dispositivo
    // anterior. Hasta completar la primera lectura real no lo presentamos
    // como un total definitivo.
    marcarCargaInicial();

    window.addEventListener("haiku:auth-ready", () => programar(20));

    document.addEventListener("click", evento => {
        if (
            evento.target.closest('[data-seccion="resumen"]') ||
            evento.target.closest('[data-seccion="servicios"]') ||
            evento.target.closest('[data-ir-seccion="servicios"]')
        ) programar(0);
    });

    document.addEventListener("haiku:servicio-supabase-cambiado", () => programar(50));
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) programar(40);
    });
    window.addEventListener("focus", () => programar(60));

    window.haikuSincronizarServiciosDesdeSupabase = sincronizar;
    window.HAIKU_SERVICIOS_HIDRATACION_V2 = Object.freeze({ sincronizar });

    setTimeout(() => {
        if (window.haikuSesion) programar(0);
    }, 650);

    console.info("HAIKU · Hidratación Servicios Supabase V2 preparada.");
})();