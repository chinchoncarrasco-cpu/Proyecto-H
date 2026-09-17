// ========================================
// HAIKU · SUPABASE · PUENTE SERVICIOS V1
// Mantiene la UI legacy mientras Supabase pasa a ser la verdad financiera.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const MAPA_KEY = "haikuSupabaseServicioMapV1";
    const migraciones = new Map();
    let migracionGeneral = null;

    const originalRegistrarServicio = window.registrarServicio;
    const originalMarcarRealizado = window.marcarServicioRealizado;
    const originalDeshacerRealizado = window.deshacerServicioRealizado;
    const originalEliminarServicio = window.eliminarServicio;

    function esUuid(valor) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(valor || ""));
    }

    function leerMapa() {
        try {
            return JSON.parse(localStorage.getItem(MAPA_KEY) || "{}");
        } catch {
            return {};
        }
    }

    function guardarMapa(mapa) {
        localStorage.setItem(MAPA_KEY, JSON.stringify(mapa || {}));
    }

    function listaLegacy() {
        try {
            if (typeof serviciosRegistrados !== "undefined" && Array.isArray(serviciosRegistrados)) {
                return serviciosRegistrados;
            }
        } catch {}

        try {
            const lista = JSON.parse(localStorage.getItem("haikuServicios") || "[]");
            return Array.isArray(lista) ? lista : [];
        } catch {
            return [];
        }
    }

    function marcador(idLegacy) {
        return `HAIKU-LEGACY-ID:${String(idLegacy || "")}`;
    }

    async function resolverEstadiaId(reservaId, numeroCabana) {
        if (!reservaId) return null;

        const { data, error } = await cliente
            .from("reserva_estadias")
            .select("id,fecha_ingreso,fecha_salida,cabanas(numero)")
            .eq("reserva_id", reservaId)
            .order("fecha_ingreso", { ascending: true });

        if (error) throw error;

        const lista = data || [];
        const exactas = lista.filter(item =>
            Number(item?.cabanas?.numero) === Number(numeroCabana)
        );
        if (exactas.length === 1) return exactas[0].id;
        if (!numeroCabana && lista.length === 1) return lista[0].id;
        return null;
    }

    async function buscarMigrado(reservaId, idLegacy) {
        const mapa = leerMapa();
        const conocido = mapa[idLegacy];
        if (conocido && esUuid(conocido)) return conocido;

        const marca = marcador(idLegacy);
        const { data, error } = await cliente
            .from("servicios")
            .select("id")
            .eq("reserva_id", reservaId)
            .ilike("observaciones", `%${marca}%`)
            .limit(1);

        if (error) throw error;

        const id = data?.[0]?.id || null;
        if (id) {
            mapa[idLegacy] = id;
            guardarMapa(mapa);
        }
        return id;
    }

    function guardarRelacion(idLegacy, servicioId) {
        const mapa = leerMapa();
        mapa[idLegacy] = servicioId;
        guardarMapa(mapa);
    }

    function notificarRelacion(clave, servicioId, reservaId, reutilizado = false) {
        document.dispatchEvent(
            new CustomEvent("haiku:servicio-supabase-cambiado", {
                detail: { legacyId: clave, servicioId, reservaId, reutilizado }
            })
        );
    }

    async function resolverServicioOperativo(servicio, reservaId, estadiaId) {
        const identidad = window.HAIKU_SERVICIOS_IDENTIDAD_V1;
        if (!identidad?.resolverServicio) {
            throw new Error("No está disponible la comprobación segura de identidad de servicios.");
        }
        if (!estadiaId) {
            throw new Error("No se pudo identificar una estadía única para el servicio.");
        }

        const { data, error } = await cliente
            .from("servicios")
            .select("id,reserva_id,estadia_id,fecha_servicio,hora_inicio,hora_fin,total,cantidad,personas,tipo_cobro,estado_servicio,observaciones,catalogo_servicios(codigo,nombre)")
            .eq("reserva_id", reservaId);
        if (error) throw error;

        return identidad.resolverServicio({
            reserva_id: reservaId,
            estadia_id: estadiaId,
            codigo_servicio: String(servicio.tipoServicio || ""),
            fecha_servicio: String(servicio.fechaServicio || servicio.fecha || "").slice(0, 10),
            hora: servicio.hora || null,
            total: servicio.total,
            observaciones: servicio.observaciones || "",
            legacy_id: String(servicio.id || "")
        }, data || []);
    }

    async function migrarServicio(servicio) {
        if (!servicio || !servicio.id) return null;
        if (esUuid(servicio.id)) return servicio.id;

        const clave = String(servicio.id);
        if (migraciones.has(clave)) return migraciones.get(clave);

        const promesa = (async () => {
            const reservaId = String(servicio.reservaId || "");
            const codigo = String(servicio.tipoServicio || "");
            const fecha = String(servicio.fechaServicio || servicio.fecha || "").slice(0, 10);

            if (!reservaId || !codigo || !fecha) return null;

            const existente = await buscarMigrado(reservaId, clave);
            if (existente) return existente;

            const estadiaId = await resolverEstadiaId(
                reservaId,
                servicio.numeroCabana
            );

            const decision = await resolverServicioOperativo(servicio, reservaId, estadiaId);
            if (decision.estado === "existente") {
                const servicioId = decision.candidato?.id || null;
                if (!servicioId) throw new Error("El servicio compatible no tiene un identificador válido.");
                guardarRelacion(clave, servicioId);
                notificarRelacion(clave, servicioId, reservaId, true);
                return servicioId;
            }
            if (decision.estado === "revisar") {
                throw new Error(decision.motivo || "El servicio coincide con más de un registro y requiere revisión.");
            }

            const marca = marcador(clave);
            const observacionesBase = String(servicio.observaciones || "").trim();
            const observaciones = [observacionesBase, marca]
                .filter(Boolean)
                .join(" · ");

            const esCortesia =
                servicio.cortesia === true ||
                servicio.tipoCobro === "cortesia";

            const precioManual =
                servicio.precioManual === null ||
                servicio.precioManual === undefined ||
                servicio.precioManual === ""
                    ? null
                    : Number(servicio.precioManual);

            const { data, error } = await cliente.rpc(
                "haiku_registrar_servicio",
                {
                    p_reserva_id: reservaId,
                    p_codigo_servicio: codigo,
                    p_fecha_servicio: fecha,
                    p_hora: servicio.hora || null,
                    p_cantidad: Math.max(1, Number(servicio.cantidad || 1)),
                    p_personas: Math.max(0, Number(servicio.personas || 1)),
                    p_tipo_cobro: esCortesia ? "cortesia" : "normal",
                    p_precio_manual: Number.isFinite(precioManual) ? precioManual : null,
                    p_motivo_cortesia: esCortesia
                        ? (observacionesBase || "Cortesía registrada desde HAIKU")
                        : null,
                    p_observaciones: observaciones || null,
                    p_estadia_id: estadiaId
                }
            );

            if (error) throw error;

            const servicioId = data?.servicio_id || null;
            if (!servicioId) throw new Error("Supabase no devolvió el ID del servicio.");

            guardarRelacion(clave, servicioId);

            if (servicio.estadoServicio === "realizado") {
                const { error: errorEstado } = await cliente
                    .from("servicios")
                    .update({ estado_servicio: "realizado" })
                    .eq("id", servicioId);
                if (errorEstado) throw errorEstado;
            }

            notificarRelacion(clave, servicioId, reservaId, false);

            console.info(
                "HAIKU · Servicio migrado a Supabase:",
                clave,
                servicioId
            );

            return servicioId;
        })();

        migraciones.set(clave, promesa);

        try {
            return await promesa;
        } finally {
            migraciones.delete(clave);
        }
    }

    async function migrarServiciosLegacy() {
        if (migracionGeneral) return migracionGeneral;

        migracionGeneral = (async () => {
            const lista = [...listaLegacy()];
            let migrados = 0;
            let errores = 0;

            for (const servicio of lista) {
                if (!servicio?.id || esUuid(servicio.id)) continue;
                if (!servicio?.reservaId) continue;

                try {
                    const id = await migrarServicio(servicio);
                    if (id) migrados++;
                } catch (error) {
                    errores++;
                    console.error(
                        "HAIKU · No fue posible migrar servicio legacy:",
                        servicio?.id,
                        error
                    );
                }
            }

            if (migrados || errores) {
                console.info(
                    "HAIKU · Puente Servicios:",
                    { migrados, errores }
                );
            }

            return { migrados, errores };
        })();

        try {
            return await migracionGeneral;
        } finally {
            migracionGeneral = null;
        }
    }

    async function idSupabaseDesdeLegacy(idLegacy, servicioLegacy = null) {
        const mapa = leerMapa();
        if (mapa[idLegacy] && esUuid(mapa[idLegacy])) return mapa[idLegacy];

        const servicio = servicioLegacy || listaLegacy().find(
            item => String(item?.id || "") === String(idLegacy || "")
        );

        if (!servicio) return null;
        return migrarServicio(servicio);
    }

    async function sincronizarEstado(idLegacy, estado, servicioLegacy = null) {
        const id = await idSupabaseDesdeLegacy(idLegacy, servicioLegacy);
        if (!id) return;

        const { error } = await cliente
            .from("servicios")
            .update({ estado_servicio: estado })
            .eq("id", id);

        if (error) throw error;

        document.dispatchEvent(
            new CustomEvent("haiku:servicio-supabase-cambiado", {
                detail: { legacyId: idLegacy, servicioId: id }
            })
        );
    }

    if (typeof originalRegistrarServicio === "function") {
        window.registrarServicio = function registrarServicioSupabase(datos) {
            const nuevo = originalRegistrarServicio.apply(this, arguments);

            if (nuevo?.id && nuevo?.reservaId) {
                migrarServicio(nuevo).catch(error => {
                    console.error("HAIKU · Servicio no guardado en Supabase:", error);

                    try {
                        if (typeof serviciosRegistrados !== "undefined") {
                            serviciosRegistrados = serviciosRegistrados.filter(
                                item => String(item?.id || "") !== String(nuevo.id)
                            );
                        }
                        if (typeof guardarServicios === "function") guardarServicios();
                        if (typeof renderizarAgendaServicios === "function") renderizarAgendaServicios();
                    } catch {}

                    alert(
                        "El servicio no pudo guardarse en Supabase y fue retirado para evitar inconsistencias."
                    );
                });
            }

            return nuevo;
        };
    }

    if (typeof originalMarcarRealizado === "function") {
        window.marcarServicioRealizado = function marcarServicioRealizadoSupabase(id) {
            const servicio = listaLegacy().find(item => String(item?.id || "") === String(id || ""));
            const resultado = originalMarcarRealizado.apply(this, arguments);
            sincronizarEstado(id, "realizado", servicio).catch(error => {
                console.error("HAIKU · No se sincronizó estado realizado:", error);
                alert("No fue posible guardar el estado Realizado en Supabase.");
            });
            return resultado;
        };
    }

    if (typeof originalDeshacerRealizado === "function") {
        window.deshacerServicioRealizado = function deshacerServicioRealizadoSupabase(id) {
            const servicio = listaLegacy().find(item => String(item?.id || "") === String(id || ""));
            const resultado = originalDeshacerRealizado.apply(this, arguments);
            sincronizarEstado(id, "programado", servicio).catch(error => {
                console.error("HAIKU · No se sincronizó estado programado:", error);
                alert("No fue posible guardar el cambio de estado en Supabase.");
            });
            return resultado;
        };
    }

    if (typeof originalEliminarServicio === "function") {
        window.eliminarServicio = function eliminarServicioSupabase(id) {
            const servicioAntes = listaLegacy().find(
                item => String(item?.id || "") === String(id || "")
            );

            const resultado = originalEliminarServicio.apply(this, arguments);

            setTimeout(() => {
                const sigueExistiendo = listaLegacy().some(
                    item => String(item?.id || "") === String(id || "")
                );

                if (!sigueExistiendo && servicioAntes) {
                    sincronizarEstado(id, "cancelado", servicioAntes).catch(error => {
                        console.error("HAIKU · No se canceló servicio en Supabase:", error);
                        alert("El servicio se quitó de la pantalla, pero no pudo cancelarse en Supabase.");
                    });
                }
            }, 0);

            return resultado;
        };
    }

    // El antiguo cambio manual de estado de pago deja de ser válido.
    // Un servicio se paga mediante un movimiento financiero real en Pagos.
    window.marcarServicioPagado = function () {
        alert("Registra este cobro desde Pagos → Cobros Check-out.");
    };

    window.deshacerServicioPagado = function () {
        alert("Los pagos reales se corrigen desde el módulo Pagos; ya no se modifica el estado manualmente.");
    };

    window.haikuMigrarServiciosLegacySupabase = migrarServiciosLegacy;
    window.haikuMigrarServicioLegacySupabase = migrarServicio;

    window.addEventListener("haiku:auth-ready", () => {
        setTimeout(migrarServiciosLegacy, 120);
    });

    setTimeout(() => {
        if (window.haikuSesion) migrarServiciosLegacy();
    }, 260);

    console.info("HAIKU · Puente Servicios Supabase V1 preparado.");
})();
