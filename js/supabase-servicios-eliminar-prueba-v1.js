// ========================================
// HAIKU · SERVICIOS · ELIMINAR PRUEBA V1
// Borrado definitivo de servicios sin movimientos de pago asociados.
// ========================================
(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const MAPA_KEY = "haikuSupabaseServicioMapV1";
    let procesando = false;
    let timerDecoracion = null;

    function esUuid(valor) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(String(valor || ""));
    }

    function listaServicios() {
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

    async function resolverIdSupabase(servicio) {
        if (esUuid(servicio?.supabaseId)) return String(servicio.supabaseId);
        if (esUuid(servicio?.id)) return String(servicio.id);

        if (typeof window.haikuMigrarServicioLegacySupabase === "function") {
            return window.haikuMigrarServicioLegacySupabase(servicio);
        }

        return null;
    }

    function limpiarMapa(idLocal, idSupabase) {
        try {
            const mapa = JSON.parse(localStorage.getItem(MAPA_KEY) || "{}");
            Object.keys(mapa).forEach(clave => {
                if (
                    String(clave) === String(idLocal || "") ||
                    String(clave) === String(idSupabase || "") ||
                    String(mapa[clave] || "") === String(idSupabase || "")
                ) {
                    delete mapa[clave];
                }
            });
            localStorage.setItem(MAPA_KEY, JSON.stringify(mapa));
        } catch {}
    }

    function limpiarCacheLocal(servicio, idSupabase) {
        const coincide = item => {
            const id = String(item?.id || "");
            const supabaseId = String(item?.supabaseId || "");
            return (
                id === String(servicio?.id || "") ||
                id === String(idSupabase || "") ||
                supabaseId === String(idSupabase || "")
            );
        };

        try {
            if (typeof serviciosRegistrados !== "undefined" && Array.isArray(serviciosRegistrados)) {
                serviciosRegistrados = serviciosRegistrados.filter(item => !coincide(item));
            }
        } catch {}

        try {
            const cache = JSON.parse(localStorage.getItem("haikuServicios") || "[]");
            if (Array.isArray(cache)) {
                localStorage.setItem(
                    "haikuServicios",
                    JSON.stringify(cache.filter(item => !coincide(item)))
                );
            }
        } catch {}

        limpiarMapa(servicio?.id, idSupabase);
    }

    async function refrescarTodo(servicioId) {
        try {
            document.dispatchEvent(
                new CustomEvent("haiku:servicio-supabase-cambiado", {
                    detail: { servicioId, eliminado: true }
                })
            );
        } catch {}

        try { await window.haikuSincronizarServiciosDesdeSupabase?.(); } catch {}
        try { await window.haikuSincronizarFinanzasServicios?.(); } catch {}
        try { window.cargarCobrosCheckout?.(); } catch {}
        try { window.actualizarNotificaciones?.(); } catch {}
        try { window.renderizarAgendaServicios?.(); } catch {}

        try {
            if (typeof fechaSeleccionada !== "undefined") {
                window.actualizarResumenDia?.(fechaSeleccionada);
                window.generarResumenOperativo?.(fechaSeleccionada);
            }
        } catch {}

        programarDecoracion(30);
    }

    async function eliminarServicioDefinitivo(id) {
        if (procesando) return;

        const servicio = listaServicios().find(
            item => String(item?.id || "") === String(id || "")
        );

        if (!servicio) {
            window.HAIKU_DIALOGOS.aviso("No se encontró el servicio que quieres eliminar.");
            return;
        }

        const confirmar = (await window.HAIKU_DIALOGOS.confirmar(`¿ELIMINAR DEFINITIVAMENTE este servicio?\n\n` +
            `${servicio.hora || ""}${servicio.hora ? " · " : ""}${servicio.nombre || "Servicio"}\n` +
            `CAB ${servicio.numeroCabana || "—"}${servicio.titular ? ` · ${servicio.titular}` : ""}\n\n` +
            `Se borrará de Servicios, notificaciones y cobros. No quedará como Cancelado.\n\n` +
            `Si ya tiene un pago aplicado, HAIKU bloqueará el borrado para proteger las finanzas.`, {
            titulo: 'Eliminar definitivamente', accion: 'Eliminar servicio', contexto: 'Servicios', peligro: true,
            cuerpo: 'Se borrará de Servicios, notificaciones y cobros. No quedará como Cancelado.',
            detalles: [['Servicio', servicio.nombre || 'Servicio'], ['Reserva', `CAB ${servicio.numeroCabana || '—'}${servicio.titular ? ' · ' + servicio.titular : ''}`], ...(servicio.hora ? [['Hora', servicio.hora]] : [])],
            aviso: 'Si tiene un pago aplicado, HAIKU bloqueará el borrado para proteger las finanzas.', advertencia: true
        }));

        if (!confirmar) return;

        procesando = true;

        try {
            const servicioId = await resolverIdSupabase(servicio);
            if (!servicioId) {
                throw new Error("No fue posible identificar el servicio en Supabase.");
            }

            const { data, error } = await cliente.rpc(
                "haiku_eliminar_servicio_prueba",
                { p_servicio_id: servicioId }
            );

            if (error) throw error;
            if (data?.ok === false) {
                throw new Error(data?.mensaje || "No fue posible eliminar el servicio.");
            }

            limpiarCacheLocal(servicio, servicioId);
            await refrescarTodo(servicioId);

            console.info("HAIKU · Servicio eliminado definitivamente:", data);
        } catch (error) {
            console.error("HAIKU · No fue posible eliminar definitivamente el servicio:", error);
            window.HAIKU_DIALOGOS.aviso(error?.message || "No fue posible eliminar el servicio.");
        } finally {
            procesando = false;
        }
    }

    function decorarAgenda() {
        const agenda = document.getElementById("servicios-agenda");
        if (!agenda) return;

        agenda.querySelectorAll("[data-haiku-servicio-id]").forEach(item => {
            const id = String(item.dataset.haikuServicioId || "");
            if (!id) return;

            let acciones = item.querySelector(".servicio-agenda-acciones");
            if (!acciones) {
                acciones = document.createElement("div");
                acciones.className = "servicio-agenda-acciones";
                item.appendChild(acciones);
            }

            if (acciones.querySelector("[data-haiku-eliminar-servicio]")) return;

            const boton = document.createElement("button");
            boton.type = "button";
            boton.className = "servicio-btn servicio-btn-eliminar";
            boton.dataset.haikuEliminarServicio = id;
            boton.textContent = "Eliminar";
            boton.title = "Eliminar definitivamente este servicio de prueba";
            acciones.appendChild(boton);
        });
    }

    function programarDecoracion(delay = 20) {
        clearTimeout(timerDecoracion);
        timerDecoracion = setTimeout(decorarAgenda, delay);
    }

    // Sustituye la eliminación legacy (que sólo cancelaba en Supabase)
    // por el borrado real y protegido.
    window.eliminarServicio = eliminarServicioDefinitivo;
    window.haikuEliminarServicioPrueba = eliminarServicioDefinitivo;

    const agenda = document.getElementById("servicios-agenda");
    if (agenda) {
        new MutationObserver(() => programarDecoracion(0))
            .observe(agenda, { childList: true, subtree: true });
    }

    document.addEventListener("haiku:servicios-hidratados", () => programarDecoracion(20));
    document.addEventListener("haiku:servicio-supabase-cambiado", () => programarDecoracion(60));
    document.addEventListener("click", evento => {
        if (
            evento.target.closest?.('[data-seccion="servicios"]') ||
            evento.target.closest?.('[data-ir-seccion="servicios"]')
        ) {
            programarDecoracion(30);
        }
    });

    setInterval(decorarAgenda, 30000);
    setTimeout(decorarAgenda, 850);

    console.info("HAIKU · Eliminar Servicio de prueba V1 preparado.");
})();