// ========================================
// HAIKU · SUPABASE · GUARDAS V2
// Evita que datos comerciales se editen sólo en localStorage.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    function fechaActual() {
        try { return String(fechaSeleccionada || "").slice(0,10); }
        catch { return ""; }
    }

    function reservaLocal(numeroCabana) {
        try {
            const fecha = fechaActual();
            if (!fecha || typeof obtenerDatosDia !== "function") return null;
            return obtenerDatosDia(fecha)?.cabanas?.[String(numeroCabana)] || null;
        } catch {
            return null;
        }
    }

    function diferenciaDias(inicio, fin) {
        const a = new Date(`${String(inicio).slice(0,10)}T12:00:00`);
        const b = new Date(`${String(fin).slice(0,10)}T12:00:00`);
        return Math.max(0, Math.round((b - a) / 86400000));
    }

    async function abrirEditorReal(numeroCabana) {
        const fecha = fechaActual();
        if (!fecha || !numeroCabana) return;

        if (typeof window.haikuAbrirFichaSupabaseV2 === "function") {
            await window.haikuAbrirFichaSupabaseV2(String(numeroCabana), fecha);
            setTimeout(() => {
                document.getElementById("ficha-reserva-editar")?.click();
            }, 20);
        }
    }

    async function cambiarNochesRapido(numeroCabana, reservaId) {
        if (!window.haikuTienePermiso?.("reservas.editar")) {
            alert("Tu usuario no tiene permiso para editar reservas.");
            return;
        }

        try {
            const { data: ficha, error: errorFicha } = await cliente.rpc(
                "haiku_ficha_reserva_core",
                { p_reserva_id: reservaId }
            );
            if (errorFicha) throw errorFicha;

            const estadia = (ficha?.estadias || []).find(e =>
                e.tipo_estadia === "alojamiento" &&
                !["cancelada", "no_show"].includes(e.estado_estadia)
            ) || ficha?.estadias?.[0];

            if (!estadia || estadia.tipo_estadia !== "alojamiento") {
                throw new Error("Esta reserva no tiene una estadía de alojamiento editable.");
            }

            const actuales = diferenciaDias(estadia.fecha_ingreso, estadia.fecha_salida);
            const respuesta = prompt(
                `Noches CAB ${numeroCabana}:`,
                String(actuales)
            );

            if (respuesta === null) return;

            const nuevas = Number(String(respuesta).trim());
            if (!Number.isInteger(nuevas) || nuevas < 1 || nuevas > 365) {
                alert("Ingresa una cantidad de noches válida entre 1 y 365.");
                return;
            }

            if (nuevas === actuales) return;

            const { data, error } = await cliente.rpc(
                "haiku_actualizar_noches_rapido",
                {
                    p_reserva_id: reservaId,
                    p_noches: nuevas
                }
            );
            if (error) throw error;

            console.info("HAIKU · Noches actualizadas en Supabase:", data);

            if (typeof window.haikuSincronizarReservasSupabase === "function") {
                await window.haikuSincronizarReservasSupabase();
            }

            try {
                if (typeof cargarCabanasDia === "function") {
                    cargarCabanasDia(fechaActual(), {
                        evento: "noches actualizadas en Supabase", tipo: "externo"
                    });
                }
            } catch {}

            setTimeout(() => {
                window.haikuProtegerFilasSupabase?.();
            }, 30);
        } catch (error) {
            console.error("HAIKU · No fue posible cambiar noches:", error);
            alert(error?.message || "No fue posible cambiar la cantidad de noches.");
        }
    }

    document.addEventListener("click", evento => {
        const botonNoches = evento.target.closest("[data-editar-noches]");
        if (botonNoches && window.haikuSesion) {
            const numero = botonNoches.dataset.editarNoches || "";
            const reserva = reservaLocal(numero);
            if (reserva?.reservaId) {
                evento.preventDefault();
                evento.stopPropagation();
                evento.stopImmediatePropagation();
                cambiarNochesRapido(numero, reserva.reservaId);
                return;
            }
        }

        const botonTitular = evento.target.closest("[data-editar-titular]");
        if (!botonTitular || !window.haikuSesion) return;

        const numero = botonTitular.dataset.editarTitular || "";
        const reserva = reservaLocal(numero);
        if (!reserva?.reservaId) return;

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();
        abrirEditorReal(numero);
    }, true);

    function protegerFilas() {
        if (!window.haikuSesion) return;
        const fecha = fechaActual();
        if (!fecha) return;

        document.querySelectorAll("#seccion-resumen .sites-resumen-cabana[data-cabana]").forEach(fila => {
            const numero = fila.dataset.cabana;
            const reserva = reservaLocal(numero);
            const tieneReserva = Boolean(reserva?.reservaId);

            ["adultos","ninos","mascotas"].forEach(campo => {
                const input = fila.querySelector(`[data-campo="${campo}"]`);
                if (!input) return;
                input.readOnly = tieneReserva;
                input.title = tieneReserva
                    ? "Editar desde la ficha de reserva"
                    : "";
            });

            const estado = fila.querySelector('[data-campo="estado"]');
            if (estado && tieneReserva) {
                estado.disabled = true;
                estado.title = "Estado calculado desde Supabase";
            }
        });
    }

    window.haikuProtegerFilasSupabase = protegerFilas;

    window.addEventListener("haiku:auth-ready", () => {
        setTimeout(protegerFilas, 250);
    });

    document.addEventListener("click", () => setTimeout(protegerFilas, 250));
    document.addEventListener("change", () => setTimeout(protegerFilas, 250));

    setTimeout(protegerFilas, 350);

    console.info("HAIKU · Guardas Supabase V2 preparadas.");
})();
