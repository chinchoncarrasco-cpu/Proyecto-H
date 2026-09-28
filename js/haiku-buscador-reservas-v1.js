// ========================================
// HAIKU · BUSCADOR DE RESERVAS -> INSPECTOR V1
// Abre exclusivamente por identidades fuertes ya presentes en el resultado.
// ========================================

(() => {
    "use strict";

    if (window.HAIKU_BUSCADOR_RESERVAS_V1) return;

    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const MENSAJE_IDENTIDAD = "La reserva encontrada no tiene una identidad verificable. Actualiza los datos e intenta nuevamente.";

    function texto(valor) {
        return String(valor || "").trim();
    }

    function estadiasUnicas(reserva) {
        const candidatas = Array.isArray(reserva?.estadias) && reserva.estadias.length
            ? reserva.estadias
            : (reserva?.estadiaId || reserva?.numeroCabana)
                ? [{ estadiaId: reserva.estadiaId, numeroCabana: reserva.numeroCabana }]
                : [];
        const unicas = new Map();
        candidatas.forEach(item => {
            const estadiaId = texto(item?.estadiaId);
            const numeroCabana = texto(item?.numeroCabana);
            unicas.set(`${estadiaId}|${numeroCabana}`, { estadiaId, numeroCabana });
        });
        return [...unicas.values()];
    }

    function identidadReserva(reserva) {
        const reservaId = texto(reserva?.reservaId);
        const estadias = estadiasUnicas(reserva);
        const exacta = estadias.length === 1 ? estadias[0] : null;
        const seleccion = exacta && UUID.test(exacta.estadiaId) && /^\d{1,2}$/.test(exacta.numeroCabana)
            ? exacta : null;
        return {
            reservaId,
            valida: UUID.test(reservaId),
            seleccion,
            multiple: estadias.length > 1
        };
    }

    function prepararResultado(boton, reserva) {
        if (!boton?.dataset) return null;
        const identidad = identidadReserva(reserva);
        boton.dataset.haikuOrigen = "buscador";
        boton.dataset.reservaId = identidad.reservaId;
        boton.dataset.codigoHaiku = texto(reserva?.codigoHaiku);
        boton.dataset.cloudbedsId = texto(reserva?.cloudbedsId);
        delete boton.dataset.estadiaId;
        if (identidad.seleccion) {
            boton.dataset.estadiaId = identidad.seleccion.estadiaId;
            boton.dataset.cabana = identidad.seleccion.numeroCabana;
        } else {
            boton.dataset.cabana = texto(reserva?.numeroCabana);
        }
        boton.dataset.reservaMultiple = identidad.multiple ? "true" : "false";
        return identidad;
    }

    function identidadDesdeResultado(resultado) {
        const reservaId = texto(resultado?.dataset?.reservaId);
        const estadiaId = texto(resultado?.dataset?.estadiaId);
        const numeroCabana = texto(resultado?.dataset?.cabana);
        if (!UUID.test(reservaId)) return { error: MENSAJE_IDENTIDAD };
        if (estadiaId && (!UUID.test(estadiaId) || !/^\d{1,2}$/.test(numeroCabana))) {
            return { error: MENSAJE_IDENTIDAD };
        }
        return {
            reservaId,
            seleccion: estadiaId ? { estadiaId, numeroCabana } : null
        };
    }

    function contenedorResultado(resultado) {
        return resultado?.closest?.("#resultados-busqueda-reservas") || resultado?.parentElement || null;
    }

    function limpiarError(resultado) {
        resultado?.removeAttribute?.("aria-invalid");
        if (resultado?.dataset) delete resultado.dataset.haikuBuscadorError;
        contenedorResultado(resultado)?.querySelector?.("[data-buscador-reserva-error]")?.remove?.();
    }

    function mostrarError(resultado, mensaje) {
        const textoError = texto(mensaje) || MENSAJE_IDENTIDAD;
        resultado?.setAttribute?.("aria-invalid", "true");
        if (resultado?.dataset) resultado.dataset.haikuBuscadorError = textoError;
        const contenedor = contenedorResultado(resultado);
        if (contenedor && typeof document?.createElement === "function") {
            let estado = contenedor.querySelector?.("[data-buscador-reserva-error]");
            if (!estado) {
                estado = document.createElement("p");
                estado.dataset.buscadorReservaError = "";
                estado.className = "busqueda-reserva-vacia";
                estado.setAttribute("role", "status");
                contenedor.appendChild(estado);
            }
            estado.textContent = textoError;
        }
        return false;
    }

    async function abrirResultado(resultado) {
        const identidad = identidadDesdeResultado(resultado);
        if (identidad.error) return mostrarError(resultado, identidad.error);

        const inspector = window.HAIKU_INSPECTOR_V1;
        const paneles = window.HAIKU_PANELES_V1;
        let apertura;
        try {
            if (typeof inspector?.abrirInspector === "function") {
                apertura = await inspector.abrirInspector({
                    tipo: "reserva",
                    entidadId: identidad.reservaId,
                    reservaId: identidad.reservaId,
                    seleccion: identidad.seleccion,
                    origen: "buscador"
                }, { origen: resultado });
            } else if (typeof paneles?.abrirReserva === "function") {
                apertura = await paneles.abrirReserva(
                    identidad.reservaId, resultado, identidad.seleccion
                );
            } else {
                return mostrarError(resultado, "El Inspector de reservas todavía no está disponible.");
            }
        } catch (error) {
            console.warn("HAIKU · No fue posible abrir la reserva desde el buscador:", error);
            return mostrarError(resultado, error?.message || "No fue posible abrir la reserva encontrada.");
        }
        if (apertura === false) {
            return mostrarError(resultado, "No fue posible verificar la reserva encontrada.");
        }
        limpiarError(resultado);
        return true;
    }

    window.HAIKU_BUSCADOR_RESERVAS_V1 = Object.freeze({
        abrirResultado,
        identidadReserva,
        identidadDesdeResultado,
        prepararResultado
    });
})();
