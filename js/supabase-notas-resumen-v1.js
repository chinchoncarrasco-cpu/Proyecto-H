// ========================================
// HAIKU · NOTAS OPERATIVAS DEL RESUMEN V1
// Supabase = persistencia; Realtime = puente PC / celular.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const TIPO_NOTA = "operativa_resumen";
    const CLAVE_MIGRACION = "haikuNotasResumenMigradasV1";
    const cabanasPorNumero = new Map();
    const numerosPorCabana = new Map();

    let canal = null;
    let fechaCargada = "";
    let cargando = false;
    let cargaPendiente = false;
    let temporizadorCarga = null;

    function fechaActual() {
        try {
            return String(fechaSeleccionada || "").slice(0, 10);
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

    function esUuid(valor) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(String(valor || ""));
    }

    function usuarioId() {
        return (
            window.haikuSesion?.usuario?.id ||
            window.haikuSesion?.auth?.id ||
            null
        );
    }

    function repintar(fecha) {
        try {
            if (typeof guardarDatos === "function") guardarDatos();
        } catch (_) {}

        try {
            if (typeof mostrarNotasOperativas === "function") {
                mostrarNotasOperativas(fecha);
            }
        } catch (_) {}

        try {
            if (typeof actualizarTarjetasRevision === "function") {
                actualizarTarjetasRevision(fecha);
            }
        } catch (_) {}

        try {
            if (typeof actualizarResumenAseo === "function") {
                actualizarResumenAseo(fecha);
            }
        } catch (_) {}

        try {
            if (typeof generarResumenOperativo === "function") {
                generarResumenOperativo(fecha);
            }
        } catch (_) {}
    }

    async function cargarCabanas() {
        if (cabanasPorNumero.size > 0) return;

        const { data, error } = await cliente
            .from("cabanas")
            .select("id,numero")
            .eq("activa", true);

        if (error) throw error;

        (data || []).forEach(cabana => {
            const numero = String(cabana.numero);
            const id = String(cabana.id);
            cabanasPorNumero.set(numero, id);
            numerosPorCabana.set(id, numero);
        });
    }

    async function consultarNotas(fecha) {
        const { data, error } = await cliente
            .from("notas")
            .select(
                "id,reserva_id,cabana_id,fecha_operacion,texto,creado_en"
            )
            .eq("tipo", TIPO_NOTA)
            .eq("fecha_operacion", fecha)
            .order("creado_en", { ascending: true });

        if (error) throw error;
        return data || [];
    }

    function notaLocalDesdeFila(fila) {
        return {
            id: fila.id,
            cabana: numerosPorCabana.get(String(fila.cabana_id)) || "",
            texto: fila.texto || "",
            reservaId: fila.reserva_id || "",
            haikuFuente: "supabase"
        };
    }

    async function migrarNotasLocales(fecha, existentes) {
        const dia = datosDia(fecha);
        const locales = Array.isArray(dia?.notasOperativas)
            ? dia.notasOperativas
            : [];

        const clavesExistentes = new Set(
            existentes.map(fila =>
                `${String(fila.cabana_id)}::${String(fila.texto).trim()}`
            )
        );

        for (const nota of locales) {
            const numero = String(nota?.cabana || "");
            const texto = String(nota?.texto || nota?.nota || "").trim();
            const cabanaId = cabanasPorNumero.get(numero);
            const clave = `${cabanaId || ""}::${texto}`;

            if (!cabanaId || !texto || clavesExistentes.has(clave)) {
                continue;
            }

            const cabanaLocal = dia?.cabanas?.[numero] || {};
            const reservaId = nota?.reservaId || cabanaLocal.reservaId;
            const registro = {
                fecha_operacion: fecha,
                tipo: TIPO_NOTA,
                texto,
                cabana_id: cabanaId,
                creado_por: usuarioId()
            };

            if (esUuid(reservaId)) {
                registro.reserva_id = reservaId;
            }

            const { error } = await cliente
                .from("notas")
                .insert(registro);

            if (error && error.code !== "23505") {
                throw error;
            }

            clavesExistentes.add(clave);
        }
    }

    function migracionPendiente(fecha) {
        return localStorage.getItem(
            `${CLAVE_MIGRACION}::${fecha}`
        ) !== "1";
    }

    function marcarMigracion(fecha) {
        localStorage.setItem(
            `${CLAVE_MIGRACION}::${fecha}`,
            "1"
        );
    }

    async function cargarFecha(fecha = fechaActual(), migrar = true) {
        if (!fecha || !window.haikuSesion) return;

        if (cargando) {
            cargaPendiente = true;
            return;
        }

        cargando = true;

        try {
            await cargarCabanas();
            let filas = await consultarNotas(fecha);

            if (migrar && migracionPendiente(fecha)) {
                await migrarNotasLocales(fecha, filas);
                marcarMigracion(fecha);
                filas = await consultarNotas(fecha);
            }

            const dia = datosDia(fecha);
            if (!dia) return;

            dia.notasOperativas = filas
                .map(notaLocalDesdeFila)
                .filter(nota => nota.cabana && nota.texto);

            fechaCargada = fecha;
            repintar(fecha);

            console.info(
                "HAIKU · Notas de Resumen sincronizadas desde Supabase:",
                { fecha, notas: dia.notasOperativas.length }
            );
        } catch (error) {
            console.error(
                "HAIKU · No fue posible sincronizar Notas de Resumen:",
                error
            );
            throw error;
        } finally {
            cargando = false;

            if (cargaPendiente) {
                cargaPendiente = false;
                programarCarga(0);
            }
        }
    }

    function programarCarga(retraso = 100) {
        clearTimeout(temporizadorCarga);
        temporizadorCarga = setTimeout(() => {
            cargarFecha(fechaActual(), false).catch(() => {});
        }, retraso);
    }

    async function guardarNota({ fecha, numeroCabana, texto, reservaId }) {
        const fechaISO = String(fecha || fechaActual()).slice(0, 10);
        const numero = String(numeroCabana || "");
        const contenido = String(texto || "").trim();

        await cargarCabanas();

        const cabanaId = cabanasPorNumero.get(numero);
        if (!fechaISO || !cabanaId || !contenido) {
            throw new Error("Faltan datos para guardar la nota operativa.");
        }

        const registro = {
            fecha_operacion: fechaISO,
            tipo: TIPO_NOTA,
            texto: contenido,
            cabana_id: cabanaId,
            creado_por: usuarioId()
        };

        if (esUuid(reservaId)) {
            registro.reserva_id = reservaId;
        }

        let { data, error } = await cliente
            .from("notas")
            .insert(registro)
            .select(
                "id,reserva_id,cabana_id,fecha_operacion,texto,creado_en"
            )
            .single();

        if (error?.code === "23505") {
            const repetida = await cliente
                .from("notas")
                .select(
                    "id,reserva_id,cabana_id,fecha_operacion,texto,creado_en"
                )
                .eq("tipo", TIPO_NOTA)
                .eq("fecha_operacion", fechaISO)
                .eq("cabana_id", cabanaId)
                .eq("texto", contenido)
                .single();

            data = repetida.data;
            error = repetida.error;
        }

        if (error) throw error;
        return notaLocalDesdeFila(data);
    }

    async function eliminarNota({ id }) {
        if (!id) return;

        const { error } = await cliente
            .from("notas")
            .delete()
            .eq("id", id)
            .eq("tipo", TIPO_NOTA);

        if (error) throw error;
    }

    function instalarRealtime() {
        if (canal || !window.haikuSesion) return;

        canal = cliente
            .channel("haiku-notas-resumen-v1")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "notas"
                },
                () => programarCarga(80)
            )
            .subscribe(estado => {
                if (estado === "SUBSCRIBED") {
                    console.info(
                        "HAIKU · Notas de Resumen Realtime conectado."
                    );
                }
            });
    }

    function iniciar() {
        if (!window.haikuSesion) return;

        instalarRealtime();
        cargarFecha(fechaActual(), true).catch(() => {});
    }

    window.HAIKU_NOTAS_RESUMEN_SUPABASE_V1 = Object.freeze({
        guardar: guardarNota,
        eliminar: eliminarNota,
        refrescar: cargarFecha
    });

    window.addEventListener("haiku:auth-ready", iniciar);
    window.addEventListener("online", () => programarCarga(0));
    window.addEventListener("focus", () => {
        const fecha = fechaActual();
        if (fecha && fecha !== fechaCargada) {
            cargarFecha(fecha, true).catch(() => {});
        } else {
            programarCarga(0);
        }
    });

    document.addEventListener("click", () => {
        setTimeout(() => {
            const fecha = fechaActual();
            if (fecha && fecha !== fechaCargada) {
                cargarFecha(fecha, true).catch(() => {});
            }
        }, 0);
    }, true);

    if (window.haikuSesion) iniciar();
})();

// Carga desacoplada de la consulta natural "tinajas por coordinar".
// Se mantiene fuera del panel para no tocar el orden de los módulos existentes.
(() => {
    "use strict";
    if (window.HAIKU_TINAJAS_PENDIENTES_LOADER_V1) return;
    window.HAIKU_TINAJAS_PENDIENTES_LOADER_V1 = true;
    const script = document.createElement("script");
    script.src = `js/supabase-asistente-tinajas-pendientes-v1.js?v=${Date.now()}`;
    script.async = false;
    script.onerror = () => console.warn("HAKU · No fue posible cargar la consulta de tinajas pendientes.");
    document.head.appendChild(script);
})();
