// ========================================
// HAIKU · GUARD DE FICHA VISUAL SUPABASE V1
// Mantiene disponible el modal de ficha cuando se abre una reserva cancelada.
// ========================================

(() => {
    "use strict";

    let modalGuardado = null;

    function localizarModal() {
        let modal = document.getElementById("ficha-reserva-modal");

        if (!modal) {
            modal = document.querySelector(".ficha-reserva-modal");
        }

        if (!modal) {
            const ficha = document.querySelector(".ficha-reserva");
            if (ficha) {
                modal = ficha.closest(".ficha-reserva-modal") || ficha.parentElement;
            }
        }

        if (modal) {
            if (!modal.id) modal.id = "ficha-reserva-modal";
            if (!modal.classList.contains("ficha-reserva-modal")) {
                modal.classList.add("ficha-reserva-modal");
            }
            modalGuardado = modal;
        }

        return modal || null;
    }

    function asegurarModal() {
        const actual = localizarModal();
        if (actual) return actual;

        if (!modalGuardado) return null;

        const destino = document.querySelector("main.contenido") || document.body;
        destino.appendChild(modalGuardado);
        modalGuardado.id = "ficha-reserva-modal";
        modalGuardado.classList.add("ficha-reserva-modal");

        console.warn("HAIKU · Ficha visual restaurada al DOM.");
        return modalGuardado;
    }

    localizarModal();

    document.addEventListener("click", evento => {
        const resultado = evento.target?.closest?.(
            "[data-haiku-cancelada-supabase='1'][data-reserva-id]"
        );
        if (!resultado) return;

        const modal = asegurarModal();
        if (!modal) {
            console.error("HAIKU · No existe estructura visual de ficha para restaurar.");
            return;
        }

        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();

        const resultados = document.getElementById("resultados-busqueda-reservas");
        if (resultados) resultados.hidden = true;

        const reservaId = String(resultado.dataset.reservaId || "");
        if (!reservaId) return;

        let intentos = 0;
        const abrir = () => {
            const puente = window.HAIKU_REACTIVAR_CANCELADAS_V2;
            if (puente?.abrir) {
                asegurarModal();
                puente.abrir(reservaId);
                return;
            }

            intentos += 1;
            if (intentos < 20) {
                setTimeout(abrir, 25);
            } else {
                console.error("HAIKU · El módulo de reactivación no quedó disponible.");
                window.HAIKU_DIALOGOS.aviso("No fue posible preparar la ficha de la reserva. Recarga la página e intenta nuevamente.");
            }
        };

        abrir();
    }, true);

    window.HAIKU_FICHA_MODAL_GUARD_V1 = Object.freeze({
        localizar: localizarModal,
        asegurar: asegurarModal
    });

    console.info("HAIKU · Guard de ficha visual preparado.");
})();

// Estados manuales reversibles.
(() => {
    if (window.HAIKU_FICHA_ESTADOS_MANUALES_V3) return;
    if (document.querySelector('script[data-haiku-ficha-hospedado-v1]')) return;

    const script = document.createElement("script");
    script.src = "js/supabase-ficha-hospedado-v1.js?v=3";
    script.async = false;
    script.dataset.haikuFichaHospedadoV1 = "1";
    script.onerror = () => {
        console.error("HAIKU · No fue posible cargar estados manuales Supabase V3.");
    };
    document.head.appendChild(script);
})();

// Checkout y colores operativos del Resumen.
(() => {
    if (window.HAIKU_CHECKOUT_RESUMEN_V2) return;
    if (document.querySelector('script[data-haiku-checkout-resumen-v2]')) return;

    const script = document.createElement("script");
    script.src = "js/supabase-checkout-resumen-v1.js?v=2";
    script.async = false;
    script.dataset.haikuCheckoutResumenV2 = "1";
    script.onerror = () => {
        console.error("HAIKU · No fue posible cargar Checkout/Resumen V2.");
    };
    document.head.appendChild(script);
})();
