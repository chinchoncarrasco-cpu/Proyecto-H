// ========================================
// HAIKU · ASEO OPERACIÓN SUPABASE V1
// ========================================
// Supabase es la fuente real para Aseo, Solicita y Aseo Express.
// La estructura legacy se conserva sólo como caché para no alterar la UI.

(() => {
    "use strict";

    const ZONA_HORARIA = "America/Santiago";
    const CATEGORIA_SOLICITUD = "aseo_express";
    const CATEGORIA_CHECKLIST = "🧹 ASEO EXPRESS";
    const TIPO_REVISION_EXPRESS = "aseo_express";

    const NOMBRES_ITEMS = Object.freeze({
        losa: "Losa",
        llaveGas: "Llave de gas",
        te: "Té",
        cafe: "Café",
        teHierbas: "Té Hierbas",
        cama: "Cama",
        salamandra: "Salamandra",
        lena: "Leña",
        diario: "Diario",
        amenities: "Amenities",
        papelH: "Papel H.",
        toallas: "Toallas",
        wc: "WC",
        carbon: "Carbón",
        fogon: "Fogón",
        ventanas: "Ventanas"
    });

    const clavesPorNombre = new Map(
        Object.entries(NOMBRES_ITEMS).map(([clave, nombre]) => [nombre, clave])
    );

    const cabanasPorNumero = new Map();
    const itemsPorClave = new Map();
    const revisionesExpress = new Map();
    const colasEscritura = new Map();

    let inicializado = false;
    let hidratacionActual = null;
    let fechaHidratada = "";
    let temporizadorDetalles = null;
    let temporizadorRevisor = null;
    let temporizadorRefresco = null;
    let ultimaActualizacion = 0;

    function cliente() {
        return window.haikuSupabase || null;
    }

    function fechaOperativa() {
        try {
            return typeof fechaSeleccionada !== "undefined" && fechaSeleccionada
                ? String(fechaSeleccionada).slice(0, 10)
                : "";
        } catch (_) {
            return "";
        }
    }

    function datosDia(fecha) {
        try {
            return typeof obtenerDatosDia === "function"
                ? obtenerDatosDia(fecha)
                : null;
        } catch (_) {
            return null;
        }
    }

    function guardarCache() {
        try {
            if (typeof guardarDatos === "function") guardarDatos();
        } catch (_) {}
    }

    function avisarResumenActualizado(fecha) {
        if (fecha !== fechaOperativa() || typeof CustomEvent !== "function") return;
        document.dispatchEvent?.(new CustomEvent("haiku:resumen-datos-actualizados", {
            detail: { fecha }
        }));
    }

    function invalidarExpressEnCache(fecha = "") {
        let dias = [];
        try {
            if (typeof datosPorFecha !== "undefined" && datosPorFecha) {
                dias = fecha ? [datosPorFecha[fecha]] : Object.values(datosPorFecha);
            } else if (fecha || fechaOperativa()) {
                dias = [datosDia(fecha || fechaOperativa())];
            }
        } catch (_) {}
        let modificado = false;
        dias.forEach(dia => Object.values(dia?.cabanas || {}).forEach(cabana => {
            if (Object.hasOwn(cabana, "aseoExpressCiclo")) {
                delete cabana.aseoExpressCiclo;
                modificado = true;
            }
            if (Object.hasOwn(cabana, "estadoRevisionExpress")) {
                delete cabana.estadoRevisionExpress;
                modificado = true;
            }
        }));
        if (modificado) guardarCache();
    }

    function cabanaCache(fecha, numero, crear = true) {
        const dia = datosDia(fecha);
        if (!dia) return null;
        if (!dia.cabanas) dia.cabanas = {};
        if (!dia.cabanas[numero] && crear) dia.cabanas[numero] = {};
        return dia.cabanas[numero] || null;
    }

    function usuarioId() {
        return (
            window.haikuSesion?.usuario?.id ||
            window.haikuSesion?.auth?.id ||
            null
        );
    }

    function errorSiExiste(error) {
        if (error) throw error;
    }

    function encolar(clave, trabajo) {
        const anterior = colasEscritura.get(clave) || Promise.resolve();
        const siguiente = anterior
            .catch(() => {})
            .then(trabajo)
            .catch(error => {
                console.error("HAIKU · Error guardando Aseo en Supabase:", error);
                throw error;
            });

        colasEscritura.set(clave, siguiente);
        siguiente.finally(() => {
            if (colasEscritura.get(clave) === siguiente) {
                colasEscritura.delete(clave);
            }
        }).catch(() => {});
        return siguiente;
    }

    async function esperarEscrituras() {
        const pendientes = [...colasEscritura.values()];
        if (pendientes.length) await Promise.allSettled(pendientes);
    }

    function partesZona(fecha) {
        const partes = new Intl.DateTimeFormat("en-CA", {
            timeZone: ZONA_HORARIA,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
        }).formatToParts(fecha);

        return Object.fromEntries(
            partes.filter(parte => parte.type !== "literal")
                .map(parte => [parte.type, Number(parte.value)])
        );
    }

    function fechaHoraSantiagoAISO(fecha, hora) {
        if (!fecha || !/^\d{2}:\d{2}$/.test(String(hora || ""))) return null;

        const [ano, mes, dia] = fecha.split("-").map(Number);
        const [horas, minutos] = hora.split(":").map(Number);
        const objetivoUTC = Date.UTC(ano, mes - 1, dia, horas, minutos, 0);
        let estimada = new Date(objetivoUTC);

        for (let intento = 0; intento < 3; intento++) {
            const partes = partesZona(estimada);
            const representadaUTC = Date.UTC(
                partes.year,
                partes.month - 1,
                partes.day,
                partes.hour,
                partes.minute,
                partes.second
            );
            estimada = new Date(estimada.getTime() + (objetivoUTC - representadaUTC));
        }

        return estimada.toISOString();
    }

    function horaSantiago(timestamp) {
        if (!timestamp) return "";
        try {
            return new Intl.DateTimeFormat("en-GB", {
                timeZone: ZONA_HORARIA,
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23"
            }).format(new Date(timestamp));
        } catch (_) {
            return "";
        }
    }

    function estadoAseo(cabana) {
        // "no_requiere" es un estado canónico futuro. "cancelado" conserva
        // su significado histórico y nunca se reinterpreta como sin aseo.
        if (["pendiente", "asignado", "en_proceso", "completado", "cancelado", "no_requiere"].includes(cabana?.aseoEstado)) {
            return cabana.aseoEstado;
        }
        if (cabana?.aseoOut) return "completado";
        if (cabana?.aseoIn) return "en_proceso";
        if (String(cabana?.aseo || "").trim()) return "asignado";
        return "pendiente";
    }

    function tieneAseoLegacy(cabana) {
        return Boolean(
            String(cabana?.aseo || "").trim() ||
            String(cabana?.revisionAseo || "").trim() ||
            cabana?.aseoIn ||
            cabana?.aseoOut
        );
    }

    async function cargarReferencias() {
        const supabase = cliente();
        if (!supabase) throw new Error("Cliente Supabase no disponible.");

        if (!cabanasPorNumero.size) {
            const { data, error } = await supabase
                .from("cabanas")
                .select("id,numero")
                .eq("activa", true)
                .order("numero", { ascending: true });
            errorSiExiste(error);
            (data || []).forEach(cabana => {
                cabanasPorNumero.set(String(cabana.numero), cabana);
            });
        }

        if (!itemsPorClave.size) {
            const { data, error } = await supabase
                .from("checklist_items")
                .select("id,nombre")
                .eq("categoria", CATEGORIA_CHECKLIST)
                .eq("activo", true);
            errorSiExiste(error);
            (data || []).forEach(item => {
                const clave = clavesPorNombre.get(item.nombre);
                if (clave) itemsPorClave.set(clave, item);
            });
        }
    }

    function payloadAseo(fecha, numero) {
        const cabana = cabanaCache(fecha, numero);
        const ref = cabanasPorNumero.get(String(numero));
        if (!cabana || !ref) return null;

        return {
            fecha,
            cabana_id: ref.id,
            tipo_aseo: "salida",
            estado: estadoAseo(cabana),
            encargado_nombre: String(cabana.aseo || "").trim() || null,
            revisor_nombre: String(cabana.revisionAseo || "").trim() || null,
            iniciado_en: fechaHoraSantiagoAISO(fecha, cabana.aseoIn),
            completado_en: fechaHoraSantiagoAISO(fecha, cabana.aseoOut),
            creado_por: usuarioId()
        };
    }

    async function guardarAseoCompleto(fecha, numero) {
        await cargarReferencias();
        const payload = payloadAseo(fecha, numero);
        if (!payload) return null;

        const { data, error } = await cliente()
            .from("aseos")
            .upsert(payload, { onConflict: "fecha,cabana_id" })
            .select("id,fecha,cabana_id,estado,encargado_nombre,revisor_nombre,iniciado_en,completado_en")
            .single();
        errorSiExiste(error);
        return data;
    }

    function actualizarCampoLocal(fecha, numero, campo, valor) {
        const cabana = cabanaCache(fecha, numero);
        if (!cabana) return;
        cabana[campo] = valor;
        guardarCache();
    }

    function guardarCampoAseo(numero, campo, valor) {
        const fecha = fechaOperativa();
        if (!fecha || !numero) return Promise.resolve();

        actualizarCampoLocal(fecha, String(numero), campo, valor);
        const cabana = cabanaCache(fecha, String(numero));
        if (cabana && (["aseoIn", "aseoOut"].includes(campo) || (campo === "aseo" && String(valor).trim()))) {
            delete cabana.aseoEstado;
            guardarCache();
        }
        return encolar(`aseo:${fecha}:${numero}`, () =>
            guardarAseoCompleto(fecha, String(numero))
        );
    }

    function guardarEstadoAseo(numero, estado) {
        const fecha = fechaOperativa();
        const valor = String(estado || "");
        if (!fecha || !numero || !["pendiente", "en_proceso", "completado", "cancelado", "no_requiere"].includes(valor)) {
            return Promise.reject(new Error("Estado de aseo no reconocido."));
        }
        const cabana = cabanaCache(fecha, String(numero));
        const anterior = cabana.aseoEstado;
        cabana.aseoEstado = valor;
        guardarCache();
        return encolar(`aseo:${fecha}:${numero}`, () => guardarAseoCompleto(fecha, String(numero)))
            .then(resultado => {
                avisarResumenActualizado(fecha);
                return resultado;
            })
            .catch(error => {
                if (anterior === undefined) delete cabana.aseoEstado;
                else cabana.aseoEstado = anterior;
                guardarCache();
                throw error;
            });
    }

    async function guardarSolicitud(fecha, numero, descripcion) {
        await cargarReferencias();
        const ref = cabanasPorNumero.get(String(numero));
        const cabana = cabanaCache(fecha, String(numero));
        if (!ref || !descripcion.trim()) return null;

        const reservaId = /^[0-9a-f-]{36}$/i.test(String(cabana?.reservaId || ""))
            ? cabana.reservaId
            : null;

        const payload = {
            fecha_operativa: fecha,
            cabana_id: ref.id,
            reserva_id: reservaId,
            categoria: CATEGORIA_SOLICITUD,
            descripcion: descripcion.trim(),
            prioridad: "normal",
            estado: "pendiente",
            creado_por: usuarioId(),
            completado_por: null,
            completado_en: null,
            observacion_cierre: null
        };

        const { data, error } = await cliente()
            .from("solicitudes")
            .upsert(payload, { onConflict: "fecha_operativa,cabana_id,categoria" })
            .select("id,fecha_operativa,cabana_id,descripcion,estado")
            .single();
        errorSiExiste(error);
        return data;
    }

    async function cancelarSolicitud(fecha, numero) {
        await cargarReferencias();
        const ref = cabanasPorNumero.get(String(numero));
        if (!ref) return;

        const { error } = await cliente()
            .from("solicitudes")
            .update({ estado: "cancelada" })
            .eq("fecha_operativa", fecha)
            .eq("cabana_id", ref.id)
            .eq("categoria", CATEGORIA_SOLICITUD);
        errorSiExiste(error);
    }

    function claveRevision(fecha, numero) {
        return `${fecha}::${numero}`;
    }

    function cicloExpressVerificado(fecha, numero) {
        const ciclo = cabanaCache(fecha, numero, false)?.aseoExpressCiclo;
        return fecha === fechaOperativa() && fechaHidratada === fecha &&
            ciclo?.verificado === true && ciclo.fecha === fecha && ciclo.existe === true;
    }

    function estadoVisualRevisionExpress(revision) {
        if (revision?.estado === "completada" && revision.resultado === "lista") return "lista";
        if (revision?.estado === "completada" && revision.resultado === "con_detalles") return "con-detalles";
        if (revision?.estado === "en_proceso") return "en_revision";
        return "pendiente";
    }

    async function obtenerRevisionExpress(fecha, numero, forzar = false) {
        const clave = claveRevision(fecha, numero);
        if (!forzar && revisionesExpress.has(clave)) {
            return revisionesExpress.get(clave);
        }

        await cargarReferencias();
        const ref = cabanasPorNumero.get(String(numero));
        if (!ref) return null;

        const { data, error } = await cliente()
            .from("revisiones_cabana")
            .select("id,fecha,cabana_id,estado,resultado,observaciones,iniciado_en")
            .eq("fecha", fecha)
            .eq("cabana_id", ref.id)
            .eq("tipo_revision", TIPO_REVISION_EXPRESS)
            .neq("estado", "cancelada")
            .order("creado_en", { ascending: false })
            .limit(1)
            .maybeSingle();
        errorSiExiste(error);
        revisionesExpress.set(clave, data || null);
        return data || null;
    }

    async function asegurarRevisionExpress(fecha, numero) {
        await cargarReferencias();
        const ref = cabanasPorNumero.get(String(numero));
        if (!ref) throw new Error("Cabaña Aseo Express no reconocida.");
        const { data: solicitud, error: errorSolicitud } = await cliente()
            .from("solicitudes")
            .select("id,fecha_operativa,cabana_id,estado")
            .eq("fecha_operativa", fecha)
            .eq("cabana_id", ref.id)
            .eq("categoria", CATEGORIA_SOLICITUD)
            .neq("estado", "cancelada")
            .maybeSingle();
        errorSiExiste(errorSolicitud);
        if (!solicitud) {
            throw new Error("No existe solicitud vigente de Aseo Express para esta fecha y cabaña.");
        }

        // Verificar contra Supabase incluso si el caché local contiene una
        // revisión antigua: abrir la UI nunca crea una revisión nueva.
        let revision = await obtenerRevisionExpress(fecha, numero, true);
        if (revision) return revision;

        const payload = {
            fecha,
            cabana_id: ref.id,
            tipo_revision: TIPO_REVISION_EXPRESS,
            estado: "en_proceso",
            resultado: null,
            revisado_por: usuarioId(),
            iniciado_en: new Date().toISOString()
        };

        const { data, error } = await cliente()
            .from("revisiones_cabana")
            .insert(payload)
            .select("id,fecha,cabana_id,estado,resultado,observaciones,iniciado_en")
            .single();

        if (error) {
            revisionesExpress.delete(claveRevision(fecha, numero));
            revision = await obtenerRevisionExpress(fecha, numero, true);
            if (revision) return revision;
            throw error;
        }

        revisionesExpress.set(claveRevision(fecha, numero), data);
        return data;
    }

    async function guardarItemExpress(fecha, numero, claveItem, marcado) {
        await cargarReferencias();
        const item = itemsPorClave.get(claveItem);
        if (!item) throw new Error(`Ítem Aseo Express no configurado: ${claveItem}`);
        const revision = await asegurarRevisionExpress(fecha, numero);

        const { error } = await cliente()
            .from("revision_items")
            .upsert({
                revision_id: revision.id,
                checklist_item_id: item.id,
                estado: marcado ? "ok" : "pendiente",
                cantidad_esperada: 1,
                cantidad_encontrada: marcado ? 1 : 0,
                revisado_en: new Date().toISOString()
            }, { onConflict: "revision_id,checklist_item_id" });
        errorSiExiste(error);
    }

    async function guardarDetallesExpress(fecha, numero, detalles) {
        const revision = await asegurarRevisionExpress(fecha, numero);
        const { data, error } = await cliente()
            .from("revisiones_cabana")
            .update({ observaciones: detalles.trim() || null })
            .eq("id", revision.id)
            .select("id,fecha,cabana_id,estado,resultado,observaciones,iniciado_en")
            .single();
        errorSiExiste(error);
        revisionesExpress.set(claveRevision(fecha, numero), data);
    }

    async function guardarEstadoRevisionExpress(numero, valorSolicitado) {
        const fecha = fechaOperativa();
        const numeroCabana = String(numero || "");
        const valor = String(valorSolicitado || "");
        if (!fecha || !numeroCabana || !["pendiente", "en_revision", "con-detalles", "lista"].includes(valor)) {
            throw new Error("Estado de revisión Express no reconocido.");
        }

        // Antes de escribir, releer la solicitud/revisión de esa fecha y
        // cabaña. Un texto o checklist del caché local no autoriza un ciclo.
        await hidratar(fecha, { pintar: false });
        const cabana = cabanaCache(fecha, numeroCabana, false);
        if (!cicloExpressVerificado(fecha, numeroCabana)) {
            throw new Error("No existe un ciclo real de Aseo Express verificado para esta cabaña y fecha.");
        }

        const resultado = await encolar(`express:${fecha}:${numeroCabana}`, async () => {
            const revision = await asegurarRevisionExpress(fecha, numeroCabana);
            const ahora = new Date().toISOString();
            const completada = valor === "con-detalles" || valor === "lista";
            const detalles = document.getElementById("aseo-express-detalles");
            const payload = {
                estado: completada ? "completada" : valor === "en_revision" ? "en_proceso" : "pendiente",
                resultado: valor === "con-detalles" ? "con_detalles" : valor === "lista" ? "lista" : null,
                finalizado_en: completada ? ahora : null,
                revisado_por: usuarioId(),
                observaciones: String(detalles?.value ?? cabana?.detallesAseoExpress ?? "").trim() || null
            };
            const { data, error } = await cliente()
                .from("revisiones_cabana")
                .update(payload)
                .eq("id", revision.id)
                .eq("tipo_revision", TIPO_REVISION_EXPRESS)
                .select("id,fecha,cabana_id,estado,resultado,observaciones,iniciado_en,finalizado_en,revisado_por")
                .single();
            errorSiExiste(error);
            if (!data) throw new Error("No se pudo verificar la revisión Express guardada.");
            revisionesExpress.set(claveRevision(fecha, numeroCabana), data);
            return data;
        });

        await hidratar(fecha, { pintar: true });
        if (fecha === fechaOperativa() && fechaHidratada !== fecha) {
            throw new Error("El estado Express se guardó, pero no se pudo verificar la lectura posterior.");
        }
        return resultado;
    }

    async function migrarLegacySiCorresponde(fecha, filasAseo) {
        const aseosPorCabana = new Map((filasAseo || []).map(fila => [String(fila.cabana_id), fila]));

        for (const [numero, ref] of cabanasPorNumero) {
            const local = cabanaCache(fecha, numero, false);
            if (!local) continue;

            if (!aseosPorCabana.has(String(ref.id)) && tieneAseoLegacy(local)) {
                const creada = await guardarAseoCompleto(fecha, numero);
                if (creada) aseosPorCabana.set(String(ref.id), creada);
            }

        }
    }

    async function leerFecha(fecha) {
        await cargarReferencias();
        const supabase = cliente();

        const [aseosResp, solicitudesResp, revisionesResp] = await Promise.all([
            supabase
                .from("aseos")
                .select("id,fecha,cabana_id,estado,encargado_nombre,revisor_nombre,iniciado_en,completado_en")
                .eq("fecha", fecha),
            supabase
                .from("solicitudes")
                .select("id,fecha_operativa,cabana_id,descripcion,estado")
                .eq("fecha_operativa", fecha)
                .eq("categoria", CATEGORIA_SOLICITUD),
            supabase
                .from("revisiones_cabana")
                .select("id,fecha,cabana_id,estado,resultado,observaciones,iniciado_en,creado_en")
                .eq("fecha", fecha)
                .eq("tipo_revision", TIPO_REVISION_EXPRESS)
                .neq("estado", "cancelada")
                .order("creado_en", { ascending: false })
        ]);

        errorSiExiste(aseosResp.error);
        errorSiExiste(solicitudesResp.error);
        errorSiExiste(revisionesResp.error);

        await migrarLegacySiCorresponde(
            fecha,
            aseosResp.data || []
        );

        // Releer sólo cuando la protección legacy creó filas nuevas.
        const [aseosFinal, solicitudesFinal, revisionesFinal] = await Promise.all([
            supabase
                .from("aseos")
                .select("id,fecha,cabana_id,estado,encargado_nombre,revisor_nombre,iniciado_en,completado_en")
                .eq("fecha", fecha),
            supabase
                .from("solicitudes")
                .select("id,fecha_operativa,cabana_id,descripcion,estado")
                .eq("fecha_operativa", fecha)
                .eq("categoria", CATEGORIA_SOLICITUD),
            supabase
                .from("revisiones_cabana")
                .select("id,fecha,cabana_id,estado,resultado,observaciones,iniciado_en,creado_en")
                .eq("fecha", fecha)
                .eq("tipo_revision", TIPO_REVISION_EXPRESS)
                .neq("estado", "cancelada")
                .order("creado_en", { ascending: false })
        ]);

        errorSiExiste(aseosFinal.error);
        errorSiExiste(solicitudesFinal.error);
        errorSiExiste(revisionesFinal.error);

        const revisiones = [];
        const vista = new Set();
        (revisionesFinal.data || []).forEach(revision => {
            if (vista.has(String(revision.cabana_id))) return;
            vista.add(String(revision.cabana_id));
            revisiones.push(revision);
        });

        const idsRevision = revisiones.map(revision => revision.id);
        let items = [];
        if (idsRevision.length) {
            const { data, error } = await supabase
                .from("revision_items")
                .select("revision_id,checklist_item_id,estado")
                .in("revision_id", idsRevision);
            errorSiExiste(error);
            items = data || [];
        }

        return {
            aseos: aseosFinal.data || [],
            solicitudes: solicitudesFinal.data || [],
            revisiones,
            items
        };
    }

    function aplicarEnCache(fecha, remoto) {
        const cabanaIdANumero = new Map(
            [...cabanasPorNumero.entries()].map(([numero, ref]) => [String(ref.id), numero])
        );
        const aseos = new Map(remoto.aseos.map(fila => [String(fila.cabana_id), fila]));
        const solicitudes = new Map();
        remoto.solicitudes.forEach(fila => {
            if (fila.estado !== "cancelada" && !solicitudes.has(String(fila.cabana_id))) {
                solicitudes.set(String(fila.cabana_id), fila);
            }
        });
        const revisiones = new Map(remoto.revisiones.map(fila => [String(fila.cabana_id), fila]));
        const itemsPorRevision = new Map();

        remoto.items.forEach(item => {
            if (!itemsPorRevision.has(String(item.revision_id))) {
                itemsPorRevision.set(String(item.revision_id), []);
            }
            itemsPorRevision.get(String(item.revision_id)).push(item);
        });

        for (const [cabanaId, numero] of cabanaIdANumero) {
            const local = cabanaCache(fecha, numero);
            if (!local) continue;

            const aseo = aseos.get(cabanaId);
            local.aseoEstado = aseo?.estado || "";
            local.aseo = aseo?.encargado_nombre || "";
            local.revisionAseo = aseo?.revisor_nombre || "";
            local.aseoIn = horaSantiago(aseo?.iniciado_en);
            local.aseoOut = horaSantiago(aseo?.completado_en);

            const solicitudVigente = solicitudes.get(cabanaId) || null;
            if (solicitudVigente) {
                local.solicitudAseoExpress = solicitudVigente.descripcion || "";
            }

            // Una revisión aislada puede pertenecer a un ciclo histórico; sin
            // solicitud vigente no habilita ni se atribuye al bloque actual.
            const revision = solicitudVigente ? revisiones.get(cabanaId) : null;
            local.aseoExpressCiclo = {
                fecha,
                verificado: true,
                existe: Boolean(solicitudVigente),
                solicitudId: solicitudVigente?.id || null,
                estadoSolicitud: solicitudVigente?.estado || null,
                revisionId: revision?.id || null,
                estadoRevision: revision?.estado || null,
                resultadoRevision: revision?.resultado || null
            };
            local.estadoRevisionExpress = local.aseoExpressCiclo.existe
                ? estadoVisualRevisionExpress(revision)
                : null;
            revisionesExpress.set(claveRevision(fecha, numero), revision || null);
            if (revision) {
                local.detallesAseoExpress = revision.observaciones || "";
                local.checklistAseoExpress = {};

                (itemsPorRevision.get(String(revision.id)) || []).forEach(item => {
                    for (const [claveItem, refItem] of itemsPorClave) {
                        if (String(refItem.id) === String(item.checklist_item_id)) {
                            local.checklistAseoExpress[claveItem] = item.estado === "ok";
                            break;
                        }
                    }
                });
            } else if (solicitudVigente) {
                // Una solicitud nueva sin revisión empieza vacía. Los datos
                // locales previos se conservan, pero no se atribuyen al ciclo.
                if ((local.detallesAseoExpress || Object.values(local.checklistAseoExpress || {}).some(Boolean)) &&
                    !local.aseoExpressLegacy) {
                    local.aseoExpressLegacy = {
                        detalles: local.detallesAseoExpress || "",
                        checklist: { ...local.checklistAseoExpress }
                    };
                }
                local.detallesAseoExpress = "";
                local.checklistAseoExpress = {};
            }
            if (solicitudVigente) {
                local.checklistAseoExpress = window.HAIKU_CHECKLIST_OPTIMISTA_V1
                    ?.aplicarCache("express", fecha, numero, local.checklistAseoExpress || {})
                    || local.checklistAseoExpress || {};
            }
        }

        guardarCache();
    }

    function pintarAseo() {
        const fecha = fechaOperativa();
        if (!fecha) return;
        try {
            if (typeof actualizarResumenAseo === "function") {
                actualizarResumenAseo(fecha);
            }
        } catch (error) {
            console.warn("HAIKU · No fue posible refrescar la vista Aseo:", error);
        }
    }

    function pintarExpress(numero) {
        const fecha = fechaOperativa();
        const local = cabanaCache(fecha, String(numero), false) || {};

        document.querySelectorAll("[data-aseo-express-item]").forEach(check => {
            check.checked = window.HAIKU_CHECKLIST_OPTIMISTA_V1?.valor(
                "express", fecha, numero, check.dataset.aseoExpressItem,
                local.checklistAseoExpress?.[check.dataset.aseoExpressItem] === true
            ) ?? (local.checklistAseoExpress?.[check.dataset.aseoExpressItem] === true);
        });

        const detalles = document.getElementById("aseo-express-detalles");
        if (detalles) detalles.value = local.detallesAseoExpress || "";

        const solicitud = document.getElementById("aseo-express-solicitud");
        if (solicitud) {
            const texto = local.solicitudAseoExpress || "";
            solicitud.textContent = texto ? `📌 ${texto}` : "";
            solicitud.style.display = texto ? "" : "none";
        }
    }

    async function hidratar(fechaSolicitada = fechaOperativa(), opciones = {}) {
        const fecha = String(fechaSolicitada || "").slice(0, 10);
        if (!fecha || !cliente() || !window.haikuSesion) return;

        if (hidratacionActual) return hidratacionActual;
        const version = window.HAIKU_CHECKLIST_OPTIMISTA_V1?.version();

        hidratacionActual = (async () => {
            await esperarEscrituras();
            const remoto = await leerFecha(fecha);

            // Si el usuario cambió de fecha durante la consulta, no pintamos
            // datos antiguos sobre la nueva fecha.
            if (fecha !== fechaOperativa()) return;
            if (version !== undefined &&
                version !== window.HAIKU_CHECKLIST_OPTIMISTA_V1?.version()) return;

            aplicarEnCache(fecha, remoto);
            fechaHidratada = fecha;
            ultimaActualizacion = Date.now();

            if (opciones.pintar !== false) pintarAseo();
            avisarResumenActualizado(fecha);

            const abierta = localStorage.getItem("haikuAseoExpressCabana") || "";
            const panel = document.getElementById("aseo-express-individual");
            if (abierta && panel?.classList.contains("activa")) pintarExpress(abierta);

            console.info("HAIKU · Aseo sincronizado desde Supabase:", { fecha });
        })().catch(error => {
            if (fecha === fechaOperativa()) {
                invalidarExpressEnCache(fecha);
                fechaHidratada = "";
                // Cerrar un Express visible cuya autoridad dejó de ser
                // verificable; los controles no quedan habilitados por caché.
                pintarAseo();
            }
            console.error("HAIKU · No fue posible cargar Aseo desde Supabase:", error);
        }).finally(() => {
            hidratacionActual = null;
        });

        return hidratacionActual;
    }

    function programarRefresco(demora = 120) {
        clearTimeout(temporizadorRefresco);
        temporizadorRefresco = setTimeout(() => {
            hidratar(fechaOperativa());
        }, demora);
    }

    function instalarEventosAseo() {
        document.addEventListener("change", evento => {
            const objetivo = evento.target;

            const encargado = objetivo?.closest?.(".aseo-encargado-input");
            if (encargado) {
                guardarCampoAseo(
                    encargado.dataset.aseoEncargado,
                    "aseo",
                    encargado.value.trim()
                );
                return;
            }

            const hora = objetivo?.closest?.(".aseo-hora-input");
            if (hora) {
                guardarCampoAseo(
                    hora.dataset.cabana,
                    hora.dataset.aseoHora,
                    hora.value
                );
                return;
            }

            if (objetivo?.id === "aseo-express-estado") {
                const fecha = fechaOperativa();
                const numero = localStorage.getItem("haikuAseoExpressCabana") || "";
                const previo = cabanaCache(fecha, numero, false)?.estadoRevisionExpress || "pendiente";
                if (!numero || !cicloExpressVerificado(fecha, numero)) {
                    evento.stopImmediatePropagation?.();
                    objetivo.value = previo;
                    return;
                }
                objetivo.disabled = true;
                guardarEstadoRevisionExpress(numero, objetivo.value).catch(error => {
                    console.error("HAIKU · No fue posible guardar el estado de revisión Express:", error);
                    objetivo.value = previo;
                    window.alert?.("No fue posible verificar o guardar la revisión de Aseo Express.");
                }).finally(() => {
                    objetivo.disabled = false;
                });
                return;
            }

            const check = objetivo?.closest?.("[data-aseo-express-item]");
            if (check) {
                const fecha = fechaOperativa();
                const numero = localStorage.getItem("haikuAseoExpressCabana") || "";
                if (!fecha || !numero) {
                    evento.stopImmediatePropagation?.();
                    return;
                }

                const local = cabanaCache(fecha, numero);
                if (!cicloExpressVerificado(fecha, numero)) {
                    evento.stopImmediatePropagation?.();
                    check.checked = local?.checklistAseoExpress?.[check.dataset.aseoExpressItem] === true;
                    return;
                }
                const claveItem = check.dataset.aseoExpressItem;
                const marcado = check.checked;
                const optimista = window.HAIKU_CHECKLIST_OPTIMISTA_V1;
                const pendiente = optimista?.iniciar("express", fecha, numero, claveItem, check);
                if (optimista && !pendiente) {
                    evento.stopImmediatePropagation?.();
                    return;
                }
                if (!local.checklistAseoExpress) local.checklistAseoExpress = {};
                local.checklistAseoExpress[claveItem] = marcado;
                guardarCache();

                encolar(`express:${fecha}:${numero}`, () =>
                    guardarItemExpress(
                        fecha,
                        numero,
                        claveItem,
                        marcado
                    )
                ).then(() => {
                    optimista?.terminar(pendiente, true);
                }).catch(error => {
                    optimista?.terminar(pendiente, false);
                    if (!optimista) check.checked = !marcado;
                    window.alert?.("No fue posible guardar este check de Aseo Express. Intenta nuevamente.");
                });
            }
        }, true);

        document.addEventListener("input", evento => {
            const revisor = evento.target?.closest?.(".aseo-revision-input");
            if (revisor) {
                const numero = revisor.dataset.revisionCabana;
                const valor = revisor.value;
                const fecha = fechaOperativa();
                actualizarCampoLocal(fecha, numero, "revisionAseo", valor);
                clearTimeout(temporizadorRevisor);
                temporizadorRevisor = setTimeout(() => {
                    encolar(`aseo:${fecha}:${numero}`, () =>
                        guardarAseoCompleto(fecha, numero)
                    );
                }, 350);
                return;
            }

            if (evento.target?.id === "aseo-express-detalles") {
                const fecha = fechaOperativa();
                const numero = localStorage.getItem("haikuAseoExpressCabana") || "";
                if (!fecha || !numero) {
                    evento.stopImmediatePropagation?.();
                    return;
                }

                const valor = evento.target.value;
                const local = cabanaCache(fecha, numero);
                if (!cicloExpressVerificado(fecha, numero)) {
                    evento.stopImmediatePropagation?.();
                    evento.target.value = local?.detallesAseoExpress || "";
                    return;
                }
                local.detallesAseoExpress = valor;
                guardarCache();

                clearTimeout(temporizadorDetalles);
                temporizadorDetalles = setTimeout(() => {
                    encolar(`express:${fecha}:${numero}`, () =>
                        guardarDetallesExpress(fecha, numero, valor)
                    );
                }, 400);
            }
        }, true);

        document.addEventListener("click", evento => {
            const guardar = evento.target?.closest?.("#guardar-solicita");
            if (guardar) {
                const fecha = fechaOperativa();
                const numero = document.getElementById("solicita-cabana")?.value || "";
                const descripcion = document.getElementById("solicita-texto")?.value.trim() || "";
                if (!fecha || !numero || !descripcion) return;

                actualizarCampoLocal(fecha, numero, "solicitudAseoExpress", descripcion);
                encolar(`solicitud:${fecha}:${numero}`, () =>
                    guardarSolicitud(fecha, numero, descripcion)
                );
                return;
            }

            const eliminar = evento.target?.closest?.("[data-eliminar-solicita]");
            if (eliminar) {
                const fecha = fechaOperativa();
                const numero = eliminar.dataset.eliminarSolicita;
                if (!fecha || !numero) return;

                const cabana = cabanaCache(fecha, numero, false);
                const solicitudEliminada = String(cabana?.solicitudAseoExpress || "").trim();
                actualizarCampoLocal(fecha, numero, "solicitudAseoExpress", "");
                const escritura = encolar(`solicitud:${fecha}:${numero}`, () =>
                    cancelarSolicitud(fecha, numero)
                );
                if (solicitudEliminada) escritura.then(() => {
                    if (typeof registrarActividadHaiku !== "function") return;
                    registrarActividadHaiku({
                        tipo: "solicitud",
                        accion: "Solicitud eliminada",
                        reservaId: cabana?.reservaId || "",
                        numeroCabana: numero,
                        titular: cabana?.titular || "",
                        fechaOperacion: fecha,
                        detalle: solicitudEliminada
                    });
                }, () => {});
            }
        }, true);
    }

    function instalarPuenteExpress() {
        if (
            typeof window.abrirRevisionAseoExpress !== "function" ||
            window.abrirRevisionAseoExpress.__haikuAseoOperacionV1
        ) return;

        const original = window.abrirRevisionAseoExpress;
        function puente(numeroCabana) {
            const fecha = fechaOperativa();
            const contexto = this;
            const argumentos = arguments;
            return Promise.resolve()
                .then(() => hidratar(fecha, { pintar: false }))
                .then(() => {
                    if (!cicloExpressVerificado(fecha, numeroCabana)) return;
                    const resultado = original.apply(contexto, argumentos);
                    pintarExpress(numeroCabana);
                    return resultado;
                });
        }
        puente.__haikuAseoOperacionV1 = true;
        window.abrirRevisionAseoExpress = puente;
    }

    function instalarRefrescos() {
        const botonCabanas = document.querySelector('.menu-item[data-seccion="cabanas"]');
        botonCabanas?.addEventListener("click", () => programarRefresco(0));

        window.addEventListener("focus", () => {
            if (Date.now() - ultimaActualizacion > 1500) programarRefresco(80);
        });

        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) programarRefresco(80);
        });

        // Cambio de día y re-render de secciones se detectan sin intervenir
        // las funciones legacy de navegación.
        setInterval(() => {
            const fecha = fechaOperativa();
            if (window.haikuSesion && fecha && fecha !== fechaHidratada) {
                programarRefresco(0);
            }
        }, 1000);
    }

    function iniciar() {
        if (inicializado || !cliente()) return;
        inicializado = true;

        // El caché local puede venir de otra sesión. Una proyección Express
        // sólo vuelve a estar verificada tras la lectura remota de este arranque.
        invalidarExpressEnCache();

        instalarEventosAseo();
        instalarPuenteExpress();
        instalarRefrescos();

        window.HAIKU_ASEO_OPERACION_V1 = Object.freeze({
            hidratar,
            guardarCampoAseo,
            guardarEstadoAseo,
            guardarEstadoRevisionExpress,
            fechaHoraSantiagoAISO,
            horaSantiago,
            esperarEscrituras,
            limpiarCache() {
                cabanasPorNumero.clear();
                itemsPorClave.clear();
                revisionesExpress.clear();
                fechaHidratada = "";
            }
        });

        if (window.haikuSesion) hidratar(fechaOperativa());
        window.addEventListener("haiku:auth-ready", () => hidratar(fechaOperativa()));

        console.info("HAIKU · Aseo Operación Supabase V1 activo.");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    } else {
        iniciar();
    }
})();
