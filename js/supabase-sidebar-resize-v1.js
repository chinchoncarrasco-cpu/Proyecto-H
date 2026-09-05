// ========================================
// HAIKU · SIDEBAR REDIMENSIONABLE V1
// Escritorio solamente. No altera la navegación móvil.
// ========================================

(() => {
    "use strict";

    if (window.HAIKU_SIDEBAR_RESIZE_V1) return;

    const STORAGE_KEY = "haikuSidebarAnchoV1";
    const DEFAULT_WIDTH = 240;
    const MIN_WIDTH = 170;
    const DESKTOP_MIN = 769;
    const STYLE_ID = "haiku-sidebar-resize-v1-style";
    const HANDLE_ID = "haiku-sidebar-resize-v1-handle";

    let anchoPreferido = DEFAULT_WIDTH;
    let arrastrando = false;
    let framePendiente = 0;
    let ultimoX = null;

    function esEscritorio() {
        return window.innerWidth >= DESKTOP_MIN;
    }

    function maximoActual() {
        // Dejamos siempre un área útil razonable para el panel principal.
        return Math.max(
            MIN_WIDTH,
            Math.min(380, window.innerWidth - 560)
        );
    }

    function limitar(valor) {
        const numero = Number(valor);
        const seguro = Number.isFinite(numero) ? numero : DEFAULT_WIDTH;
        return Math.round(
            Math.min(maximoActual(), Math.max(MIN_WIDTH, seguro))
        );
    }

    function guardarPreferencia(valor) {
        try {
            localStorage.setItem(STORAGE_KEY, String(Math.round(valor)));
        } catch (_) {}
    }

    function leerPreferencia() {
        try {
            const valor = Number(localStorage.getItem(STORAGE_KEY));
            return Number.isFinite(valor) && valor > 0
                ? valor
                : DEFAULT_WIDTH;
        } catch (_) {
            return DEFAULT_WIDTH;
        }
    }

    function aplicarAncho(valor, { guardar = false } = {}) {
        const ancho = limitar(valor);
        document.documentElement.style.setProperty(
            "--haiku-sidebar-ancho",
            `${ancho}px`
        );

        if (guardar) {
            anchoPreferido = ancho;
            guardarPreferencia(ancho);
        }

        const handle = document.getElementById(HANDLE_ID);
        if (handle) {
            handle.setAttribute("aria-valuenow", String(ancho));
            handle.setAttribute("aria-valuemax", String(maximoActual()));
        }

        return ancho;
    }

    function instalarEstilos() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            @media (min-width: ${DESKTOP_MIN}px) {
                .sidebar {
                    width: var(--haiku-sidebar-ancho, ${DEFAULT_WIDTH}px) !important;
                }

                .contenido {
                    margin-left: var(--haiku-sidebar-ancho, ${DEFAULT_WIDTH}px) !important;
                }

                .haiku-sidebar-resize-v1-handle {
                    position: absolute;
                    top: 0;
                    right: -6px;
                    z-index: 130;
                    width: 12px;
                    height: 100%;
                    border: 0;
                    padding: 0;
                    background: transparent;
                    cursor: col-resize;
                    touch-action: none;
                }

                .haiku-sidebar-resize-v1-handle::after {
                    content: "";
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    left: 5px;
                    width: 2px;
                    background: rgba(177, 207, 190, .72);
                    opacity: 0;
                    transition: opacity .14s ease;
                }

                .sidebar:hover .haiku-sidebar-resize-v1-handle::after,
                .haiku-sidebar-resize-v1-handle:hover::after,
                .haiku-sidebar-resize-v1-handle:focus-visible::after,
                body.haiku-sidebar-redimensionando .haiku-sidebar-resize-v1-handle::after {
                    opacity: .8;
                }

                .haiku-sidebar-resize-v1-handle:focus-visible {
                    outline: none;
                }

                body.haiku-sidebar-redimensionando,
                body.haiku-sidebar-redimensionando * {
                    cursor: col-resize !important;
                    user-select: none !important;
                    -webkit-user-select: none !important;
                }
            }

            @media (max-width: ${DESKTOP_MIN - 1}px) {
                .haiku-sidebar-resize-v1-handle {
                    display: none !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function procesarMovimiento() {
        framePendiente = 0;
        if (!arrastrando || ultimoX === null) return;
        aplicarAncho(ultimoX, { guardar: false });
    }

    function mover(evento) {
        if (!arrastrando) return;
        ultimoX = evento.clientX;
        if (!framePendiente) {
            framePendiente = requestAnimationFrame(procesarMovimiento);
        }
    }

    function terminar(evento) {
        if (!arrastrando) return;
        arrastrando = false;

        if (framePendiente) {
            cancelAnimationFrame(framePendiente);
            framePendiente = 0;
        }

        if (ultimoX !== null) {
            aplicarAncho(ultimoX, { guardar: true });
        }
        ultimoX = null;

        document.body?.classList.remove("haiku-sidebar-redimensionando");

        const handle = document.getElementById(HANDLE_ID);
        if (handle && evento?.pointerId !== undefined) {
            try { handle.releasePointerCapture(evento.pointerId); } catch (_) {}
        }
    }

    function iniciarArrastre(evento) {
        if (!esEscritorio()) return;
        if (evento.pointerType === "mouse" && evento.button !== 0) return;

        arrastrando = true;
        ultimoX = evento.clientX;
        document.body?.classList.add("haiku-sidebar-redimensionando");

        try { evento.currentTarget.setPointerCapture(evento.pointerId); } catch (_) {}
        evento.preventDefault();
    }

    function restablecer() {
        anchoPreferido = DEFAULT_WIDTH;
        guardarPreferencia(DEFAULT_WIDTH);
        aplicarAncho(DEFAULT_WIDTH, { guardar: false });
    }

    function instalarHandle() {
        const sidebar = document.querySelector(".sidebar");
        if (!sidebar) return false;

        if (document.getElementById(HANDLE_ID)) return true;

        const handle = document.createElement("button");
        handle.type = "button";
        handle.id = HANDLE_ID;
        handle.className = "haiku-sidebar-resize-v1-handle";
        handle.setAttribute("role", "separator");
        handle.setAttribute("aria-orientation", "vertical");
        handle.setAttribute("aria-label", "Cambiar ancho del menú lateral");
        handle.setAttribute("aria-valuemin", String(MIN_WIDTH));
        handle.setAttribute("aria-valuemax", String(maximoActual()));
        handle.title = "Arrastra para cambiar el ancho · doble clic para restablecer";

        handle.addEventListener("pointerdown", iniciarArrastre);
        handle.addEventListener("pointermove", mover);
        handle.addEventListener("pointerup", terminar);
        handle.addEventListener("pointercancel", terminar);
        handle.addEventListener("dblclick", evento => {
            evento.preventDefault();
            restablecer();
        });

        handle.addEventListener("keydown", evento => {
            if (!esEscritorio()) return;

            const actual = parseInt(
                getComputedStyle(document.documentElement)
                    .getPropertyValue("--haiku-sidebar-ancho"),
                10
            ) || anchoPreferido;

            let siguiente = null;
            if (evento.key === "ArrowLeft") siguiente = actual - 10;
            if (evento.key === "ArrowRight") siguiente = actual + 10;
            if (evento.key === "Home") siguiente = MIN_WIDTH;
            if (evento.key === "End") siguiente = maximoActual();

            if (siguiente === null) return;
            evento.preventDefault();
            aplicarAncho(siguiente, { guardar: true });
        });

        sidebar.appendChild(handle);
        return true;
    }

    function ajustarAlViewport() {
        if (!esEscritorio()) return;
        aplicarAncho(anchoPreferido, { guardar: false });
    }

    function iniciar() {
        instalarEstilos();
        anchoPreferido = leerPreferencia();
        aplicarAncho(anchoPreferido, { guardar: false });

        if (!instalarHandle()) {
            document.addEventListener("DOMContentLoaded", () => {
                instalarHandle();
                ajustarAlViewport();
            }, { once: true });
        }

        window.addEventListener("resize", ajustarAlViewport);

        window.HAIKU_SIDEBAR_RESIZE_V1 = Object.freeze({
            aplicar: valor => aplicarAncho(valor, { guardar: true }),
            restablecer,
            ancho: () => limitar(anchoPreferido)
        });

        console.info("HAIKU · Sidebar redimensionable V1 preparado.");
    }

    iniciar();
})();
