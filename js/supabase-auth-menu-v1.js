// ========================================
// HAIKU · CUENTA DENTRO DEL MENÚ · V1
// Oculta el chip flotante de sesión y reutiliza
// el mismo logout real de supabase-auth.js.
// ========================================

(() => {
    "use strict";

    const STYLE_ID = "haiku-auth-menu-v1-style";

    function instalarEstilos() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            /* El chip original sigue vivo para que supabase-auth.js
               pueda actualizarlo, pero deja de ocupar la cabecera. */
            .haiku-usuario-chip {
                display: none !important;
            }

            .haiku-cuenta-menu-boton {
                position: relative;
            }

            .haiku-cuenta-menu-boton[aria-expanded="true"] {
                background: #31483b;
                color: #fff;
            }

            .haiku-cuenta-menu-panel {
                position: fixed;
                z-index: 99992;
                width: min(310px, calc(100vw - 24px));
                padding: 14px;
                border: 1px solid rgba(255,255,255,.10);
                border-radius: 16px;
                background: rgba(24, 34, 29, .98);
                color: #f4f6f4;
                box-shadow: 0 18px 45px rgba(0,0,0,.30);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
            }

            .haiku-cuenta-menu-panel[hidden] {
                display: none !important;
            }

            .haiku-cuenta-menu-cabecera {
                display: flex;
                align-items: center;
                gap: 10px;
                padding-bottom: 12px;
                margin-bottom: 11px;
                border-bottom: 1px solid rgba(255,255,255,.09);
            }

            .haiku-cuenta-menu-icono {
                display: grid;
                place-items: center;
                flex: 0 0 36px;
                width: 36px;
                height: 36px;
                border-radius: 11px;
                background: #31483b;
                font-size: 17px;
            }

            .haiku-cuenta-menu-identidad {
                min-width: 0;
                flex: 1;
            }

            .haiku-cuenta-menu-email {
                display: block;
                overflow: hidden;
                color: #fff;
                font-size: 12px;
                font-weight: 750;
                line-height: 1.35;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .haiku-cuenta-menu-rol {
                display: block;
                margin-top: 2px;
                color: #a9bcb0;
                font-size: 11px;
                line-height: 1.3;
            }

            .haiku-cuenta-menu-salir {
                width: 100%;
                min-height: 38px;
                border: 1px solid rgba(255,255,255,.12);
                border-radius: 11px;
                background: rgba(255,255,255,.06);
                color: #f3f5f3;
                font: inherit;
                font-size: 12px;
                font-weight: 700;
                cursor: pointer;
                transition: background .15s ease, border-color .15s ease;
            }

            .haiku-cuenta-menu-salir:hover {
                border-color: rgba(255,255,255,.22);
                background: rgba(255,255,255,.11);
            }

            .haiku-cuenta-menu-salir:disabled {
                opacity: .55;
                cursor: wait;
            }

            /* En escritorio, la cabecera del sidebar queda fija y sólo
               el listado de secciones se desplaza. Así el menú puede crecer
               con Reservas y futuras secciones sin ocultar Cuenta. */
            @media (min-width: 769px) {
                .sidebar {
                    overflow: hidden;
                }

                .sidebar-superior {
                    flex: 0 0 auto;
                }

                nav.menu {
                    flex: 1 1 auto;
                    min-height: 0;
                    overflow-y: auto;
                    overflow-x: hidden;
                    padding-right: 5px;
                    padding-bottom: 12px;
                    overscroll-behavior: contain;
                    scrollbar-width: thin;
                    scrollbar-color: rgba(255,255,255,.24) transparent;
                }

                nav.menu .menu-item {
                    flex: 0 0 auto;
                }

                nav.menu::-webkit-scrollbar {
                    width: 6px;
                }

                nav.menu::-webkit-scrollbar-track {
                    background: transparent;
                }

                nav.menu::-webkit-scrollbar-thumb {
                    background: rgba(255,255,255,.22);
                    border-radius: 999px;
                }

                nav.menu::-webkit-scrollbar-thumb:hover {
                    background: rgba(255,255,255,.34);
                }
            }

            @media (max-width: 768px) {
                .haiku-cuenta-menu-panel {
                    width: min(300px, calc(100vw - 20px));
                    padding: 13px;
                    border-radius: 15px;
                }

                .haiku-cuenta-menu-boton {
                    flex: 0 0 auto;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function nombreRolDesdeSesion() {
        const roles = window.haikuSesion?.roles;
        if (Array.isArray(roles) && roles.length) {
            const texto = roles
                .map(rol => rol?.nombre || rol?.codigo || "")
                .filter(Boolean)
                .join(" · ");
            if (texto) return texto;
        }

        return document.getElementById("haiku-usuario-chip-rol")?.textContent?.trim() || "Usuario";
    }

    function emailDesdeSesion() {
        return (
            window.haikuSesion?.auth?.email ||
            document.getElementById("haiku-usuario-chip-email")?.textContent?.trim() ||
            "Cuenta HAIKU"
        );
    }

    function instalarCuentaMenu() {
        instalarEstilos();

        const menu = document.querySelector("nav.menu");
        if (!menu) return false;

        let boton = document.getElementById("haiku-cuenta-menu-boton");
        if (!boton) {
            boton = document.createElement("button");
            boton.type = "button";
            boton.id = "haiku-cuenta-menu-boton";
            boton.className = "menu-item haiku-cuenta-menu-boton";
            boton.setAttribute("aria-haspopup", "dialog");
            boton.setAttribute("aria-expanded", "false");
            boton.innerHTML = "👤 Cuenta";
            menu.appendChild(boton);
        }

        let panel = document.getElementById("haiku-cuenta-menu-panel");
        if (!panel) {
            panel = document.createElement("div");
            panel.id = "haiku-cuenta-menu-panel";
            panel.className = "haiku-cuenta-menu-panel";
            panel.hidden = true;
            panel.setAttribute("role", "dialog");
            panel.setAttribute("aria-label", "Cuenta HAIKU");
            panel.innerHTML = `
                <div class="haiku-cuenta-menu-cabecera">
                    <div class="haiku-cuenta-menu-icono" aria-hidden="true">👤</div>
                    <div class="haiku-cuenta-menu-identidad">
                        <strong id="haiku-cuenta-menu-email" class="haiku-cuenta-menu-email"></strong>
                        <span id="haiku-cuenta-menu-rol" class="haiku-cuenta-menu-rol"></span>
                    </div>
                </div>
                <button type="button" id="haiku-cuenta-menu-salir" class="haiku-cuenta-menu-salir">
                    Cerrar sesión
                </button>
            `;
            document.body.appendChild(panel);
        }

        if (boton.dataset.haikuCuentaMenuV1 === "1") {
            actualizarIdentidad();
            return true;
        }

        boton.dataset.haikuCuentaMenuV1 = "1";

        function actualizarIdentidad() {
            const email = document.getElementById("haiku-cuenta-menu-email");
            const rol = document.getElementById("haiku-cuenta-menu-rol");
            if (email) email.textContent = emailDesdeSesion();
            if (rol) rol.textContent = nombreRolDesdeSesion();
        }

        function posicionarPanel() {
            if (panel.hidden) return;

            const rect = boton.getBoundingClientRect();
            const ancho = panel.offsetWidth;
            const alto = panel.offsetHeight;
            const margen = 10;

            let left;
            let top;

            if (window.innerWidth > 768) {
                // En escritorio aparece junto al menú lateral.
                left = Math.min(
                    window.innerWidth - ancho - margen,
                    rect.right + 8
                );
                top = Math.max(
                    margen,
                    Math.min(rect.top, window.innerHeight - alto - margen)
                );
            } else {
                // En celular aparece arriba o abajo del propio botón,
                // según el espacio disponible.
                left = Math.max(
                    margen,
                    Math.min(rect.left, window.innerWidth - ancho - margen)
                );

                const cabeDebajo =
                    window.innerHeight - rect.bottom >= alto + margen;

                top = cabeDebajo
                    ? rect.bottom + 7
                    : Math.max(margen, rect.top - alto - 7);
            }

            panel.style.left = `${Math.round(left)}px`;
            panel.style.top = `${Math.round(top)}px`;
        }

        function abrir() {
            actualizarIdentidad();
            panel.hidden = false;
            boton.setAttribute("aria-expanded", "true");
            requestAnimationFrame(posicionarPanel);
        }

        function cerrar() {
            panel.hidden = true;
            boton.setAttribute("aria-expanded", "false");
        }

        function alternar() {
            if (panel.hidden) abrir();
            else cerrar();
        }

        boton.addEventListener("click", evento => {
            evento.preventDefault();
            evento.stopPropagation();
            alternar();
        });

        panel.addEventListener("click", evento => {
            evento.stopPropagation();
        });

        document.addEventListener("click", cerrar);
        document.addEventListener("keydown", evento => {
            if (evento.key === "Escape") cerrar();
        });

        window.addEventListener("resize", () => {
            if (!panel.hidden) posicionarPanel();
        });

        window.addEventListener("scroll", () => {
            if (!panel.hidden) posicionarPanel();
        }, true);

        const salir = document.getElementById("haiku-cuenta-menu-salir");
        salir?.addEventListener("click", () => {
            const logoutReal = document.getElementById("haiku-cerrar-sesion");

            if (!logoutReal) {
                console.error("HAIKU · No se encontró el logout real de Supabase.");
                return;
            }

            salir.disabled = true;
            cerrar();
            logoutReal.click();

            setTimeout(() => {
                salir.disabled = false;
            }, 900);
        });

        window.addEventListener("haiku:auth-ready", () => {
            actualizarIdentidad();
        });

        actualizarIdentidad();

        window.HAIKU_AUTH_MENU_V1 = Object.freeze({
            abrir,
            cerrar,
            actualizar: actualizarIdentidad
        });

        console.info("HAIKU · Cuenta movida al menú V1.");
        return true;
    }

    function iniciar() {
        if (instalarCuentaMenu()) return;

        // Respaldo por si la interfaz base todavía se está escribiendo.
        let intentos = 0;
        const timer = setInterval(() => {
            intentos++;
            if (instalarCuentaMenu() || intentos >= 30) {
                clearInterval(timer);
            }
        }, 100);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar, { once: true });
    } else {
        iniciar();
    }
})();

// Carga modular del Asistente flotante sin modificar el cargador principal.
(() => {
    "use strict";

    if (!document.querySelector('link[data-haiku-asistente-v1]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `css/supabase-asistente-v1.css?v=${Date.now()}`;
        link.dataset.haikuAsistenteV1 = "1";
        document.head.appendChild(link);
    }

    if (!document.querySelector('script[data-haiku-asistente-v1]')) {
        const script = document.createElement("script");
        script.src = `js/supabase-asistente-v1.js?v=${Date.now()}`;
        script.async = true;
        script.dataset.haikuAsistenteV1 = "1";
        document.head.appendChild(script);
    }
})();
