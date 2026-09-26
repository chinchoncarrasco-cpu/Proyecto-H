// ========================================
// HAIKU · ASEO / REVISIÓN SUPABASE V1
// ========================================
// Mantiene la UI legacy, pero Supabase pasa a ser la fuente
// persistente de la revisión completa de cada cabaña.

(() => {
    "use strict";

    const TIPO_REVISION = "completa";
    const CAMPOS_DETALLE_SECCION = Object.freeze([
        "detalle_cocina",
        "detalle_bano",
        "detalle_living_cama",
        "detalle_terraza"
    ]);
    const COLUMNAS_REVISION = [
        "id",
        "fecha",
        "cabana_id",
        "tipo_revision",
        "estado",
        "resultado",
        "observaciones",
        ...CAMPOS_DETALLE_SECCION,
        "revisado_por",
        "iniciado_en",
        "finalizado_en",
        "creado_en"
    ].join(", ");

    const cacheCabanas = new Map();
    const cacheConfig = new Map();
    const cacheRevisiones = new Map();
    const temporizadoresDetallesSeccion = new Map();
    const detallesSeccionEditandoHasta = new Map();

    let usuarioIdCache = null;
    let resumenSincronizando = false;
    let temporizadorDetalles = null;
    let detallesEditandoHasta = 0;
    let lecturaChecklistRemoto = 0;
    let listenerDetallesSeccionInstalado = false;

    function cliente() {
        return window.haikuSupabase || null;
    }

    function fechaOperativa() {
        try {
            return (
                typeof fechaSeleccionada !== "undefined" &&
                fechaSeleccionada
            )
                ? String(fechaSeleccionada)
                : "";
        } catch (_) {
            return "";
        }
    }

    function numeroRevisionAbierta() {
        return localStorage.getItem("haikuRevisionCabana") || "";
    }

    function claveRevision(fecha, numeroCabana) {
        return `${fecha}::${numeroCabana}`;
    }

    function esCampoDetalleSeccion(campo) {
        return CAMPOS_DETALLE_SECCION.includes(String(campo || ""));
    }

    function claveDetalleSeccion(fecha, numeroCabana, campo) {
        return `${fecha}::${numeroCabana}::${campo}`;
    }

    function detallesSeccionDesdeRevision(revision) {
        return CAMPOS_DETALLE_SECCION.reduce((detalles, campo) => {
            detalles[campo] = revision?.[campo] || "";
            return detalles;
        }, {});
    }

    function actualizarCacheDetallesSeccion(
        datosCabana,
        revision,
        fecha = "",
        numeroCabana = ""
    ) {
        const remotos = detallesSeccionDesdeRevision(revision);
        const actuales = datosCabana.detallesRevisionSeccion || {};

        datosCabana.detallesRevisionSeccion =
            CAMPOS_DETALLE_SECCION.reduce((detalles, campo) => {
                detalles[campo] =
                    fecha && numeroCabana &&
                    detalleSeccionEnEdicion(fecha, numeroCabana, campo)
                        ? (actuales[campo] || "")
                        : remotos[campo];
                return detalles;
            }, {});
    }

    function detalleSeccionEnEdicion(fecha, numeroCabana, campo) {
        const clave = claveDetalleSeccion(fecha, numeroCabana, campo);
        const limite = detallesSeccionEditandoHasta.get(clave) || 0;

        if (Date.now() < limite) {
            return true;
        }

        detallesSeccionEditandoHasta.delete(clave);
        return false;
    }

    async function obtenerUsuarioId() {
        if (usuarioIdCache) {
            return usuarioIdCache;
        }

        const supabase = cliente();
        if (!supabase) {
            return null;
        }

        const { data, error } = await supabase.auth.getUser();

        if (error) {
            throw error;
        }

        usuarioIdCache = data?.user?.id || null;
        return usuarioIdCache;
    }

    async function obtenerCabana(numeroCabana) {
        const numero = String(numeroCabana);

        if (cacheCabanas.has(numero)) {
            return cacheCabanas.get(numero);
        }

        const supabase = cliente();
        if (!supabase) {
            return null;
        }

        const { data, error } = await supabase
            .from("cabanas")
            .select("id, numero, nombre, tipo")
            .eq("numero", Number(numeroCabana))
            .single();

        if (error) {
            throw error;
        }

        cacheCabanas.set(numero, data);
        return data;
    }

    async function obtenerConfiguracion(numeroCabana, cabanaId) {
        const numero = String(numeroCabana);

        if (cacheConfig.has(numero)) {
            return cacheConfig.get(numero);
        }

        const supabase = cliente();
        if (!supabase) {
            return new Map();
        }

        const { data, error } = await supabase
            .from("cabana_checklist_config")
            .select(
                "checklist_item_id, legacy_checklist_id, cantidad_esperada, obligatorio, activo, orden_visual"
            )
            .eq("cabana_id", cabanaId)
            .eq("activo", true)
            .not("legacy_checklist_id", "is", null)
            .order("orden_visual", { ascending: true });

        if (error) {
            throw error;
        }

        const mapa = new Map();

        (data || []).forEach(item => {
            if (item.legacy_checklist_id) {
                mapa.set(String(item.legacy_checklist_id), item);
            }
        });

        cacheConfig.set(numero, mapa);
        return mapa;
    }

    async function buscarRevision(fecha, numeroCabana, cabanaId) {
        const key = claveRevision(fecha, numeroCabana);

        if (cacheRevisiones.has(key)) {
            return cacheRevisiones.get(key);
        }

        const supabase = cliente();
        if (!supabase) {
            return null;
        }

        const { data, error } = await supabase
            .from("revisiones_cabana")
            .select(COLUMNAS_REVISION)
            .eq("fecha", fecha)
            .eq("cabana_id", cabanaId)
            .eq("tipo_revision", TIPO_REVISION)
            .neq("estado", "cancelada")
            .order("creado_en", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            throw error;
        }

        cacheRevisiones.set(key, data || null);
        return data || null;
    }

    async function asegurarRevision(numeroCabana, fecha = fechaOperativa()) {
        if (!fecha) {
            throw new Error("No hay fecha operativa seleccionada.");
        }

        const cabana = await obtenerCabana(numeroCabana);
        if (!cabana?.id) {
            throw new Error(`No se encontró CAB ${numeroCabana} en Supabase.`);
        }

        let revision = await buscarRevision(
            fecha,
            numeroCabana,
            cabana.id
        );

        if (revision) {
            return revision;
        }

        const supabase = cliente();
        const usuarioId = await obtenerUsuarioId();
        const ahora = new Date().toISOString();

        const { data, error } = await supabase
            .from("revisiones_cabana")
            .insert({
                fecha,
                cabana_id: cabana.id,
                tipo_revision: TIPO_REVISION,
                estado: "en_proceso",
                resultado: null,
                revisado_por: usuarioId,
                iniciado_en: ahora,
                observaciones: null
            })
            .select(COLUMNAS_REVISION)
            .single();

        if (error) {
            // Si otra pestaña alcanzó a crear la revisión antes,
            // volvemos a leer antes de mostrar error.
            cacheRevisiones.delete(
                claveRevision(fecha, numeroCabana)
            );

            const recuperada = await buscarRevision(
                fecha,
                numeroCabana,
                cabana.id
            );

            if (recuperada) {
                return recuperada;
            }

            throw error;
        }

        cacheRevisiones.set(
            claveRevision(fecha, numeroCabana),
            data
        );

        return data;
    }

    async function obtenerItemsRevision(revisionId) {
        if (!revisionId) {
            return new Map();
        }

        const supabase = cliente();
        if (!supabase) {
            return new Map();
        }

        const { data, error } = await supabase
            .from("revision_items")
            .select(
                "checklist_item_id, estado, cantidad_esperada, cantidad_encontrada, observacion, revisado_en"
            )
            .eq("revision_id", revisionId);

        if (error) {
            throw error;
        }

        const mapa = new Map();

        (data || []).forEach(item => {
            mapa.set(String(item.checklist_item_id), item);
        });

        return mapa;
    }

    function estadoLegacyDesdeRevision(revision) {
        if (!revision) {
            return "pendiente";
        }

        if (revision.estado === "pendiente") {
            return "pendiente";
        }

        if (revision.estado === "en_proceso") {
            return "en_revision";
        }

        if (revision.resultado === "lista") {
            return "lista";
        }

        if (
            revision.resultado === "con_detalles" ||
            revision.resultado === "no_lista"
        ) {
            return "con-detalles";
        }

        return "pendiente";
    }

    function cicloRevision(fecha, revision, verificado = true) {
        return {
            fecha,
            verificado,
            id: revision?.id || null,
            estado: revision?.estado || null,
            resultado: revision?.resultado || null
        };
    }

    function invalidarCiclos(fecha, numeros = null) {
        if (!fecha || typeof obtenerDatosDia !== "function") return;
        const datos = obtenerDatosDia(fecha);
        const cabanas = datos?.cabanas || {};
        const lista = numeros || Object.keys(cabanas);
        let cambio = false;
        lista.forEach(numero => {
            const cabana = cabanas[numero];
            if (!cabana) return;
            cabana.revisionCompletaCiclo = cicloRevision(fecha, null, false);
            cambio = true;
        });
        if (cambio && typeof guardarDatos === "function") guardarDatos();
        if (cambio && fecha === fechaOperativa()) refrescarVistasLegacy();
    }

    function invalidarCiclosPersistidos() {
        if (typeof datosPorFecha === "undefined") return;
        let cambio = false;
        Object.values(datosPorFecha || {}).forEach(dia => {
            Object.values(dia?.cabanas || {}).forEach(cabana => {
                if (cabana?.revisionCompletaCiclo?.verificado !== true) return;
                cabana.revisionCompletaCiclo.verificado = false;
                cambio = true;
            });
        });
        if (cambio && typeof guardarDatos === "function") guardarDatos();
        if (cambio) refrescarVistasLegacy();
    }

    function actualizarEstadoFinalDerivado(datosCabana) {
        const derivar = window.HAIKU_CABANAS_SITES_V1?.estadoFinal;
        if (typeof derivar === "function") {
            datosCabana.estadoFinal = derivar(datosCabana);
        }
    }

    function actualizarCacheLocal(
        fecha,
        numeroCabana,
        config,
        revision,
        items
    ) {
        if (
            !fecha || fecha !== fechaOperativa() ||
            typeof obtenerDatosDia !== "function"
        ) {
            return;
        }

        const datos = obtenerDatosDia(fecha);

        if (!datos.cabanas[numeroCabana]) {
            datos.cabanas[numeroCabana] = {};
        }

        const datosCabana = datos.cabanas[numeroCabana];
        const checklist = {};

        config.forEach((cfg, legacyId) => {
            const item = items.get(
                String(cfg.checklist_item_id)
            );

            checklist[legacyId] = item?.estado === "ok";
        });

        datosCabana.checklist = window.HAIKU_CHECKLIST_OPTIMISTA_V1
            ?.aplicarCache("completa", fecha, numeroCabana, checklist) || checklist;
        datosCabana.estadoRevision =
            estadoLegacyDesdeRevision(revision);
        datosCabana.revisionCompletaCiclo =
            cicloRevision(fecha, revision);
        datosCabana.detallesRevision =
            revision?.observaciones || "";
        actualizarCacheDetallesSeccion(
            datosCabana,
            revision,
            fecha,
            numeroCabana
        );
        actualizarEstadoFinalDerivado(datosCabana);

        if (typeof guardarDatos === "function") {
            guardarDatos();
        }
    }

    function aplicarRevisionEnPantalla(
        numeroCabana,
        config,
        revision,
        items
    ) {
        // Si mientras esperábamos el usuario abrió otra CAB,
        // no tocamos su pantalla.
        if (
            String(numeroRevisionAbierta()) !==
            String(numeroCabana)
        ) {
            return;
        }

        const contenedor =
            document.getElementById("revision-checklist");

        if (!contenedor) {
            return;
        }

        contenedor
            .querySelectorAll(
                'input[type="checkbox"][data-checklist-id]'
            )
            .forEach(checkbox => {
                const cfg = config.get(
                    String(checkbox.dataset.checklistId || "")
                );

                if (!cfg) {
                    return;
                }

                const item = items.get(
                    String(cfg.checklist_item_id)
                );

                checkbox.checked = window.HAIKU_CHECKLIST_OPTIMISTA_V1
                    ?.valor("completa", fechaOperativa(), numeroCabana, cfg.legacy_checklist_id || checkbox.dataset.checklistId,
                        item?.estado === "ok") ?? (item?.estado === "ok");
            });

        const selectorEstado =
            document.getElementById("revision-estado");

        if (selectorEstado) {
            selectorEstado.value =
                estadoLegacyDesdeRevision(revision);
        }

        const detalles =
            document.getElementById("revision-detalles");

        if (
            detalles &&
            Date.now() >= detallesEditandoHasta
        ) {
            detalles.value = revision?.observaciones || "";
        }

        contenedor
            .querySelectorAll(
                "textarea[data-revision-detalle-seccion]"
            )
            .forEach(textarea => {
                const campo = String(
                    textarea.dataset.revisionDetalleSeccion || ""
                );

                if (
                    !esCampoDetalleSeccion(campo) ||
                    detalleSeccionEnEdicion(
                        fechaOperativa(),
                        numeroCabana,
                        campo
                    )
                ) {
                    return;
                }

                textarea.value = revision?.[campo] || "";
            });
    }

    async function refrescarChecklistAbierto(payload = null, intento = 0) {
        const fecha = fechaOperativa();
        const numero = String(numeroRevisionAbierta());
        const panel = document.getElementById("revision-individual");
        const revisionIdEvento = payload?.table === "revisiones_cabana"
            ? (payload?.new?.id || payload?.old?.id)
            : (payload?.new?.revision_id || payload?.old?.revision_id);
        if (!cliente() || !fecha || !numero || !panel?.classList.contains("activa")) {
            return false;
        }

        const lectura = ++lecturaChecklistRemoto;
        const cabana = await obtenerCabana(numero);
        if (!cabana?.id) return false;

        // El evento sólo contiene revision_id: la fecha y la cabaña se
        // verifican contra la revisión completa vigente antes de tocar la UI.
        const { data: revision, error } = await cliente()
            .from("revisiones_cabana")
            .select(COLUMNAS_REVISION)
            .eq("fecha", fecha)
            .eq("cabana_id", cabana.id)
            .eq("tipo_revision", TIPO_REVISION)
            .neq("estado", "cancelada")
            .order("creado_en", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        if (revisionIdEvento && String(revision?.id) !== String(revisionIdEvento)) {
            return false;
        }

        const config = await obtenerConfiguracion(numero, cabana.id);
        const optimista = window.HAIKU_CHECKLIST_OPTIMISTA_V1;
        const version = optimista?.version();
        const items = await obtenerItemsRevision(revision?.id);

        if (lectura !== lecturaChecklistRemoto || fecha !== fechaOperativa() ||
            numero !== String(numeroRevisionAbierta()) ||
            !panel.classList.contains("activa")) {
            return false;
        }
        // Si una escritura local terminó durante la lectura, releemos el
        // snapshot; una respuesta anterior al commit no debe pisar el clic.
        if (version !== optimista?.version()) {
            return intento < 2 ? refrescarChecklistAbierto(payload, intento + 1) : false;
        }

        cacheRevisiones.set(claveRevision(fecha, numero), revision || null);
        actualizarCacheLocal(fecha, numero, config, revision, items);
        aplicarRevisionEnPantalla(numero, config, revision, items);
        const sites = window.HAIKU_CABANAS_SITES_V1;
        sites?.actualizarConteos?.();
        sites?.pintarRevision?.(fecha);
        sites?.pintarDetalle?.(fecha);
        return true;
    }

    function refrescarVistasLegacy() {
        const fecha = fechaOperativa();

        if (!fecha) {
            return;
        }

        if (typeof actualizarTarjetasRevision === "function") {
            actualizarTarjetasRevision(fecha);
        }

        if (typeof actualizarResumenAseo === "function") {
            actualizarResumenAseo(fecha);
        }

        if (typeof cargarCabanasDia === "function") {
            // No la llamamos siempre para evitar renderes innecesarios.
            // El estado final se actualiza en las vistas específicas.
        }
        document.dispatchEvent(new CustomEvent("haiku:resumen-datos-actualizados", {
            detail: { fecha }
        }));
    }

    async function guardarItem(
        numeroCabana,
        legacyId,
        checked,
        checkbox,
        fechaSeleccion = fechaOperativa()
    ) {
        const supabase = cliente();
        if (!supabase) {
            throw new Error("No hay conexión con Supabase para guardar el ítem.");
        }

        const cabana = await obtenerCabana(numeroCabana);
        const config = await obtenerConfiguracion(
            numeroCabana,
            cabana.id
        );
        const cfg = config.get(String(legacyId));

        if (!cfg) {
            throw new Error(
                `No existe mapeo Supabase para ${legacyId} en CAB ${numeroCabana}.`
            );
        }

        const revision = await asegurarRevision(numeroCabana, fechaSeleccion);
        const ahora = new Date().toISOString();

        const payload = {
            revision_id: revision.id,
            checklist_item_id: cfg.checklist_item_id,
            estado: checked ? "ok" : "pendiente",
            cantidad_esperada:
                cfg.cantidad_esperada ?? null,
            cantidad_encontrada:
                checked
                    ? (cfg.cantidad_esperada ?? null)
                    : null,
            observacion: null,
            revisado_en: ahora
        };

        const { error } = await supabase
            .from("revision_items")
            .upsert(payload, {
                onConflict: "revision_id,checklist_item_id"
            });

        if (error) {
            throw error;
        }

        try {
        // Desde aquí el ítem ya está persistido. Si falla una actualización
        // secundaria, el check no debe revertirse como si el upsert hubiera fallado.
        // Un cambio del checklist inicia o reabre la revisión real.
        if (["pendiente", "completada"].includes(revision.estado)) {
            const usuarioId = await obtenerUsuarioId();

            const { error: errorRevision } = await supabase
                .from("revisiones_cabana")
                .update({
                    estado: "en_proceso",
                    resultado: null,
                    finalizado_en: null,
                    revisado_por: usuarioId
                })
                .eq("id", revision.id);

            if (errorRevision) {
                const parcial = new Error("El check se guardó, pero no se pudo actualizar el estado de revisión.");
                parcial.itemPersistido = true;
                parcial.cause = errorRevision;
                throw parcial;
            }

            revision.estado = "en_proceso";
            revision.resultado = null;
            revision.finalizado_en = null;

        }

        if (String(numeroRevisionAbierta()) === String(numeroCabana)) {
            const selectorEstado = document.getElementById("revision-estado");
            if (selectorEstado) selectorEstado.value = "en_revision";
        }

        const fecha = revision.fecha;
        const datos = fecha === fechaOperativa() &&
            typeof obtenerDatosDia === "function" ? obtenerDatosDia(fecha) : null;
        if (datos?.cabanas?.[numeroCabana]) {
            const cabana = datos.cabanas[numeroCabana];
            cabana.estadoRevision = "en_revision";
            cabana.revisionCompletaCiclo = cicloRevision(fecha, revision);
            actualizarEstadoFinalDerivado(cabana);
            if (typeof guardarDatos === "function") guardarDatos();
        }

        if (checkbox) {
            checkbox.dataset.supabaseGuardado = "1";
            setTimeout(() => {
                delete checkbox.dataset.supabaseGuardado;
            }, 800);
        }

        refrescarVistasLegacy();

        document.dispatchEvent(
            new CustomEvent("haiku:revision-item-guardado", {
                detail: {
                    fecha: revision.fecha,
                    numeroCabana: String(numeroCabana),
                    legacyId: String(legacyId),
                    checked: Boolean(checked),
                    revisionId: revision.id
                }
            })
        );
        } catch (errorPosterior) {
            if (errorPosterior.itemPersistido === true) throw errorPosterior;
            const parcial = new Error("El check se guardó, pero falló una actualización posterior.");
            parcial.itemPersistido = true;
            parcial.cause = errorPosterior;
            throw parcial;
        }
    }

    async function guardarEstadoRevision(numeroCabana) {
        const supabase = cliente();
        if (!supabase) {
            return;
        }

        const revision = await asegurarRevision(numeroCabana);
        const selector =
            document.getElementById("revision-estado");
        const detalles =
            document.getElementById("revision-detalles");

        if (!selector) {
            return;
        }

        const valor = selector.value || "pendiente";
        const usuarioId = await obtenerUsuarioId();
        const ahora = new Date().toISOString();

        if (!["pendiente", "en_revision", "con-detalles", "lista"].includes(valor)) {
            throw new Error(`Estado de revisión no reconocido: ${valor}`);
        }

        let estado = valor === "pendiente" ? "pendiente" : "en_proceso";
        let resultado = null;
        let finalizadoEn = null;

        if (valor === "lista") {
            estado = "completada";
            resultado = "lista";
            finalizadoEn = ahora;
        } else if (valor === "con-detalles") {
            estado = "completada";
            resultado = "con_detalles";
            finalizadoEn = ahora;
        }

        const payload = {
            estado,
            resultado,
            finalizado_en: finalizadoEn,
            revisado_por: usuarioId,
            observaciones:
                detalles?.value?.trim() || null
        };

        const { error } = await supabase
            .from("revisiones_cabana")
            .update(payload)
            .eq("id", revision.id);

        if (error) {
            throw error;
        }

        Object.assign(revision, payload);
        if (revision.fecha === fechaOperativa() && typeof obtenerDatosDia === "function") {
            const cabana = obtenerDatosDia(revision.fecha)?.cabanas?.[numeroCabana];
            if (cabana) {
                cabana.estadoRevision = valor;
                cabana.revisionCompletaCiclo = cicloRevision(revision.fecha, revision);
                actualizarEstadoFinalDerivado(cabana);
                if (typeof guardarDatos === "function") guardarDatos();
            }
        }
        refrescarVistasLegacy();
        document.dispatchEvent(new CustomEvent("haiku:revision-estado-guardado", {
            detail: { fecha: revision.fecha, numeroCabana: String(numeroCabana), revisionId: revision.id }
        }));
    }

    async function guardarDetallesRevision(numeroCabana) {
        const supabase = cliente();
        if (!supabase) {
            return;
        }

        const detalles =
            document.getElementById("revision-detalles");

        if (!detalles) {
            return;
        }

        const revision = await asegurarRevision(numeroCabana);
        const usuarioId = await obtenerUsuarioId();

        const iniciaRevision = revision.estado === "pendiente";
        const payload = {
            observaciones: detalles.value.trim() || null,
            revisado_por: usuarioId
        };
        if (iniciaRevision) {
            payload.estado = "en_proceso";
            payload.resultado = null;
            payload.finalizado_en = null;
        }

        const { error } = await supabase
            .from("revisiones_cabana")
            .update(payload)
            .eq("id", revision.id);

        if (error) {
            throw error;
        }

        Object.assign(revision, payload);
        if (iniciaRevision && revision.fecha === fechaOperativa()) {
            const selectorEstado = document.getElementById("revision-estado");
            if (selectorEstado && String(numeroRevisionAbierta()) === String(numeroCabana)) {
                selectorEstado.value = "en_revision";
            }
            const cabana = typeof obtenerDatosDia === "function"
                ? obtenerDatosDia(revision.fecha)?.cabanas?.[numeroCabana] : null;
            if (cabana) {
                cabana.estadoRevision = "en_revision";
                cabana.revisionCompletaCiclo = cicloRevision(revision.fecha, revision);
                actualizarEstadoFinalDerivado(cabana);
                if (typeof guardarDatos === "function") guardarDatos();
            }
            refrescarVistasLegacy();
            document.dispatchEvent(new CustomEvent("haiku:revision-estado-guardado", {
                detail: { fecha: revision.fecha, numeroCabana: String(numeroCabana), revisionId: revision.id }
            }));
        }
    }

    async function guardarDetalleSeccionRevision(
        numeroCabana,
        campo,
        valor,
        fecha = fechaOperativa()
    ) {
        const supabase = cliente();

        if (!supabase) {
            return;
        }

        if (!esCampoDetalleSeccion(campo)) {
            throw new Error(`Campo de detalle no reconocido: ${campo}`);
        }

        const revision = await asegurarRevision(numeroCabana, fecha);
        const payload = {
            [campo]: String(valor || "").trim() || null
        };

        const { error } = await supabase
            .from("revisiones_cabana")
            .update(payload)
            .eq("id", revision.id);

        if (error) {
            throw error;
        }

        Object.assign(revision, payload);

        if (
            revision.fecha === fechaOperativa() &&
            typeof obtenerDatosDia === "function"
        ) {
            const datos = obtenerDatosDia(revision.fecha);

            if (!datos.cabanas[numeroCabana]) {
                datos.cabanas[numeroCabana] = {};
            }

            const datosCabana = datos.cabanas[numeroCabana];

            if (!datosCabana.detallesRevisionSeccion) {
                datosCabana.detallesRevisionSeccion = {};
            }

            datosCabana.detallesRevisionSeccion[campo] =
                payload[campo] || "";

            if (typeof guardarDatos === "function") {
                guardarDatos();
            }
        }

        document.dispatchEvent(
            new CustomEvent("haiku:revision-detalle-seccion-guardado", {
                detail: {
                    fecha: revision.fecha,
                    numeroCabana: String(numeroCabana),
                    revisionId: revision.id,
                    campo
                }
            })
        );
    }

    function instalarListenerDetallesSeccion() {
        if (listenerDetallesSeccionInstalado) {
            return;
        }

        listenerDetallesSeccionInstalado = true;

        document.addEventListener("input", evento => {
            const textarea = evento.target?.closest?.(
                "textarea[data-revision-detalle-seccion]"
            );
            const contenedor =
                document.getElementById("revision-checklist");

            if (!textarea || !contenedor?.contains(textarea)) {
                return;
            }

            const campo = String(
                textarea.dataset.revisionDetalleSeccion || ""
            );
            const numeroCabana = numeroRevisionAbierta();
            const fecha = fechaOperativa();

            if (
                !esCampoDetalleSeccion(campo) ||
                !numeroCabana ||
                !fecha
            ) {
                return;
            }

            const clave = claveDetalleSeccion(
                fecha,
                numeroCabana,
                campo
            );
            const valor = textarea.value;

            detallesSeccionEditandoHasta.set(
                clave,
                Date.now() + 1600
            );

            if (typeof obtenerDatosDia === "function") {
                const datos = obtenerDatosDia(fecha);

                if (!datos.cabanas[numeroCabana]) {
                    datos.cabanas[numeroCabana] = {};
                }

                const datosCabana = datos.cabanas[numeroCabana];

                if (!datosCabana.detallesRevisionSeccion) {
                    datosCabana.detallesRevisionSeccion = {};
                }

                datosCabana.detallesRevisionSeccion[campo] = valor;

                if (typeof guardarDatos === "function") {
                    guardarDatos();
                }
            }

            clearTimeout(temporizadoresDetallesSeccion.get(clave));

            const temporizador = setTimeout(async () => {
                try {
                    await guardarDetalleSeccionRevision(
                        numeroCabana,
                        campo,
                        valor,
                        fecha
                    );
                } catch (error) {
                    console.error(
                        "HAIKU · No fue posible guardar detalle de sección en Supabase:",
                        error
                    );
                } finally {
                    if (
                        temporizadoresDetallesSeccion.get(clave) ===
                        temporizador
                    ) {
                        temporizadoresDetallesSeccion.delete(clave);
                    }
                }
            }, 450);

            temporizadoresDetallesSeccion.set(clave, temporizador);
        }, true);
    }

    function instalarListenerItemsRevision() {
        document.addEventListener("change", async evento => {
            const checkbox = evento.target?.closest?.('input[type="checkbox"][data-checklist-id]');
            if (!checkbox || !document.getElementById("revision-checklist")?.contains(checkbox)) return;
            const numeroCabana = numeroRevisionAbierta();
            const fecha = fechaOperativa();
            if (!numeroCabana || !fecha) return;
            const legacyId = String(checkbox.dataset.checklistId || "");
            const valorEsperado = checkbox.checked;
            const optimista = window.HAIKU_CHECKLIST_OPTIMISTA_V1;
            const pendiente = optimista?.iniciar("completa", fecha, numeroCabana, legacyId, checkbox);
            if (optimista && !pendiente) {
                evento.stopImmediatePropagation?.();
                return;
            }
            try {
                await guardarItem(numeroCabana, legacyId, valorEsperado, checkbox, fecha);
                optimista?.terminar(pendiente, true);
            } catch (error) {
                console.error("HAIKU · No fue posible guardar ítem de revisión en Supabase:", error);
                if (optimista) optimista.terminar(pendiente, error.itemPersistido === true);
                else if (!error.itemPersistido) checkbox.checked = !valorEsperado;
                alert(error.itemPersistido
                    ? "El check se guardó, pero no fue posible actualizar el estado de revisión. Recarga para verificar."
                    : "No fue posible guardar este check en Supabase. Intenta nuevamente.");
            }
        }, true);
    }

    function instalarListenersRevision() {

        const selector =
            document.getElementById("revision-estado");

        if (
            selector &&
            selector.dataset.supabaseRevisionListener !== "1"
        ) {
            selector.dataset.supabaseRevisionListener = "1";

            selector.addEventListener("change", async () => {
                const numero = numeroRevisionAbierta();
                if (!numero) {
                    return;
                }

                try {
                    await guardarEstadoRevision(numero);
                } catch (error) {
                    console.error(
                        "HAIKU · No fue posible guardar estado de revisión en Supabase:",
                        error
                    );
                    alert(
                        "No fue posible guardar el estado de la revisión en Supabase."
                    );
                }
            });
        }

        const detalles =
            document.getElementById("revision-detalles");

        if (
            detalles &&
            detalles.dataset.supabaseRevisionListener !== "1"
        ) {
            detalles.dataset.supabaseRevisionListener = "1";

            detalles.addEventListener("input", () => {
                detallesEditandoHasta = Date.now() + 1200;
                clearTimeout(temporizadorDetalles);

                temporizadorDetalles = setTimeout(async () => {
                    const numero = numeroRevisionAbierta();
                    if (!numero) {
                        return;
                    }

                    try {
                        await guardarDetallesRevision(numero);
                    } catch (error) {
                        console.error(
                            "HAIKU · No fue posible guardar detalle de revisión en Supabase:",
                            error
                        );
                    }
                }, 450);
            });
        }
    }

    async function prepararRevision(numeroCabana) {
        const supabase = cliente();
        const fecha = fechaOperativa();
        const version = window.HAIKU_CHECKLIST_OPTIMISTA_V1?.version();

        if (!supabase || !fecha || !numeroCabana) {
            return;
        }

        invalidarCiclos(fecha, [String(numeroCabana)]);

        try {
            const cabana = await obtenerCabana(numeroCabana);
            const config = await obtenerConfiguracion(
                numeroCabana,
                cabana.id
            );
            const revision = await buscarRevision(
                fecha,
                numeroCabana,
                cabana.id
            );
            const items = revision?.id
                ? await obtenerItemsRevision(revision.id)
                : new Map();

            if (fecha !== fechaOperativa() ||
                (version !== undefined && version !== window.HAIKU_CHECKLIST_OPTIMISTA_V1?.version())) return;

            actualizarCacheLocal(
                fecha,
                String(numeroCabana),
                config,
                revision,
                items
            );

            aplicarRevisionEnPantalla(
                String(numeroCabana),
                config,
                revision,
                items
            );

            instalarListenersRevision();

            refrescarVistasLegacy();

            console.log(
                "HAIKU · Revisión Supabase cargada:",
                {
                    fecha,
                    cabana: String(numeroCabana),
                    revision: revision?.id || null,
                    items: items.size,
                    configurados: config.size
                }
            );
        } catch (error) {
            console.error(
                "HAIKU · No fue posible cargar revisión desde Supabase:",
                error
            );
        }
    }

    async function sincronizarResumenFecha() {
        if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) {
            return window.HAIKU_RESUMEN_REFRESH_V1.solicitar(fechaOperativa(), {
                categoria: "revisión", evento: "sincronización resumen derivada",
                tipo: "interno_derivado"
            });
        }
        if (resumenSincronizando) {
            return;
        }

        const supabase = cliente();
        const fecha = fechaOperativa();

        if (!supabase || !fecha) {
            return;
        }

        resumenSincronizando = true;

        try {
            invalidarCiclos(fecha);
            const { data: cabanas, error: errorCabanas } =
                await supabase
                    .from("cabanas")
                    .select("id, numero, nombre, tipo")
                    .eq("activa", true)
                    .order("numero", { ascending: true });

            if (errorCabanas) {
                throw errorCabanas;
            }

            const idANumero = new Map();
            const ids = [];

            (cabanas || []).forEach(cabana => {
                const numero = String(cabana.numero);
                cacheCabanas.set(numero, cabana);
                idANumero.set(String(cabana.id), numero);
                ids.push(cabana.id);
            });

            if (ids.length === 0) {
                return;
            }

            const { data: revisiones, error: errorRevisiones } =
                await supabase
                    .from("revisiones_cabana")
                    .select(COLUMNAS_REVISION)
                    .eq("fecha", fecha)
                    .eq("tipo_revision", TIPO_REVISION)
                    .neq("estado", "cancelada")
                    .in("cabana_id", ids)
                    .order("creado_en", { ascending: false });

            if (errorRevisiones) {
                throw errorRevisiones;
            }

            if (window.HAIKU_RESUMEN_REFRESH_V1?.activo()) {
                return window.HAIKU_RESUMEN_REFRESH_V1.solicitar(fecha, {
                    categoria: "revisión", evento: "sincronización resumen derivada",
                    tipo: "interno_derivado"
                });
            }

            if (fecha !== fechaOperativa()) return;

            const ultimaPorCabana = new Map();

            (revisiones || []).forEach(revision => {
                const cabanaId = String(revision.cabana_id);
                if (!ultimaPorCabana.has(cabanaId)) {
                    ultimaPorCabana.set(cabanaId, revision);
                }
            });

            if (typeof obtenerDatosDia === "function") {
                const datos = obtenerDatosDia(fecha);

                (cabanas || []).forEach(cabana => {
                    const numero = String(cabana.numero);
                    const revision = ultimaPorCabana.get(
                        String(cabana.id)
                    );

                    if (!datos.cabanas[numero]) {
                        datos.cabanas[numero] = {};
                    }

                    datos.cabanas[numero].estadoRevision =
                        estadoLegacyDesdeRevision(revision);
                    datos.cabanas[numero].revisionCompletaCiclo =
                        cicloRevision(fecha, revision);
                    datos.cabanas[numero].detallesRevision =
                        revision?.observaciones || "";
                    actualizarCacheDetallesSeccion(
                        datos.cabanas[numero],
                        revision,
                        fecha,
                        numero
                    );
                    actualizarEstadoFinalDerivado(datos.cabanas[numero]);

                    const key = claveRevision(fecha, numero);
                    cacheRevisiones.set(key, revision || null);
                });

                if (typeof guardarDatos === "function") {
                    guardarDatos();
                }
            }

            refrescarVistasLegacy();

            const abierta = numeroRevisionAbierta();
            if (abierta) {
                await prepararRevision(abierta);
            }

            console.log(
                "HAIKU · Resumen de revisiones sincronizado desde Supabase:",
                {
                    fecha,
                    revisiones: ultimaPorCabana.size
                }
            );
        } catch (error) {
            if (fecha === fechaOperativa()) invalidarCiclos(fecha);
            console.error(
                "HAIKU · No fue posible sincronizar revisiones desde Supabase:",
                error
            );
        } finally {
            resumenSincronizando = false;
        }
    }

    function instalarPuenteMostrarChecklist() {
        if (
            typeof window.mostrarChecklistCabana !== "function" ||
            window.mostrarChecklistCabana.__haikuSupabaseRevisionV1
        ) {
            return;
        }

        const original = window.mostrarChecklistCabana;

        function puente(numeroCabana) {
            const resultado = original.apply(this, arguments);

            Promise.resolve().then(() => {
                prepararRevision(numeroCabana);
            });

            return resultado;
        }

        puente.__haikuSupabaseRevisionV1 = true;
        window.mostrarChecklistCabana = puente;
    }

    function iniciar() {
        window.HAIKU_RESUMEN_REFRESH_V1?.registrar("revision", {
            orden: 70, obligatoria: false,
            preparar: async ({ fecha }) => {
                const supabase = cliente();
                const cabanasR = await supabase.from("cabanas")
                    .select("id, numero, nombre, tipo")
                    .eq("activa", true).order("numero", { ascending: true });
                if (cabanasR.error) throw cabanasR.error;
                const cabanas = cabanasR.data || [];
                if (!cabanas.length) return { cabanas, revisiones: [] };
                const revisionesR = await supabase.from("revisiones_cabana")
                    .select(COLUMNAS_REVISION)
                    .eq("fecha", fecha).eq("tipo_revision", TIPO_REVISION)
                    .neq("estado", "cancelada")
                    .in("cabana_id", cabanas.map(cabana => cabana.id))
                    .order("creado_en", { ascending: false });
                if (revisionesR.error) throw revisionesR.error;
                return { cabanas, revisiones: revisionesR.data || [] };
            },
            publicar: snapshot => {
                const preparado = snapshot.datos.revision;
                if (!preparado) return;
                const { cabanas, revisiones } = preparado;
                invalidarCiclos(snapshot.fecha);
                const ultima = new Map();
                revisiones.forEach(revision => {
                    const id = String(revision.cabana_id);
                    if (!ultima.has(id)) ultima.set(id, revision);
                });
                const datos = obtenerDatosDia(snapshot.fecha);
                cabanas.forEach(cabana => {
                    const numero = String(cabana.numero);
                    cacheCabanas.set(numero, cabana);
                    const revision = ultima.get(String(cabana.id));
                    if (!datos.cabanas[numero]) datos.cabanas[numero] = {};
                    datos.cabanas[numero].estadoRevision = estadoLegacyDesdeRevision(revision);
                    datos.cabanas[numero].revisionCompletaCiclo =
                        cicloRevision(snapshot.fecha, revision);
                    datos.cabanas[numero].detallesRevision = revision?.observaciones || "";
                    actualizarCacheDetallesSeccion(
                        datos.cabanas[numero],
                        revision,
                        snapshot.fecha,
                        numero
                    );
                    actualizarEstadoFinalDerivado(datos.cabanas[numero]);
                    cacheRevisiones.set(claveRevision(snapshot.fecha, numero), revision || null);
                });
                if (typeof guardarDatos === "function") guardarDatos();
                refrescarVistasLegacy();
            }
        });
        invalidarCiclosPersistidos();
        instalarPuenteMostrarChecklist();
        instalarListenerItemsRevision();
        instalarListenerDetallesSeccion();

        // El puente V2 observa Resumen y Cabañas, e invoca
        // sincronizarResumenFecha al entrar. Evitamos otro observer y otra
        // lectura simultánea para la misma sección.

        window.HAIKU_REVISION_SUPABASE_V1 = Object.freeze({
            prepararRevision,
            refrescarChecklistAbierto,
            sincronizarResumenFecha,
            limpiarCache() {
                cacheRevisiones.clear();
                cacheConfig.clear();
            }
        });

        console.log(
            "HAIKU · Puente Supabase activo: Aseo / Revisión V1."
        );
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar, {
            once: true
        });
    } else {
        iniciar();
    }
})();
