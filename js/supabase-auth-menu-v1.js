// ========================================
// HAIKU · CUENTA DENTRO DEL MENÚ · V2
// Presenta la sesión real en un drawer y reutiliza
// el mismo logout de supabase-auth.js.
// ========================================

(() => {
    "use strict";

    const BOTON_ID = "haiku-cuenta-menu-boton";
    const PANEL_ID = "haiku-cuenta-menu-panel";
    const FONDO_ID = "haiku-cuenta-fondo";

    function texto(valor) {
        return typeof valor === "string" ? valor.trim() : "";
    }

    function sesionActual() {
        return window.haikuSesion || {};
    }

    function emailDesdeSesion() {
        const sesion = sesionActual();
        return texto(sesion.auth?.email)
            || texto(document.getElementById("haiku-usuario-chip-email")?.textContent)
            || "Correo no disponible";
    }

    function nombreDesdeSesion() {
        const sesion = sesionActual();
        const usuario = sesion.usuario || {};
        const metadata = sesion.auth?.user_metadata || {};
        return texto(usuario.nombre_completo)
            || [texto(usuario.nombre), texto(usuario.apellido)].filter(Boolean).join(" ")
            || texto(metadata.full_name)
            || texto(metadata.name)
            || "Cuenta Haku";
    }

    function rolesDesdeSesion() {
        const roles = Array.isArray(sesionActual().roles) ? sesionActual().roles : [];
        return [...new Set(roles
            .map(rol => texto(typeof rol === "string" ? rol : rol?.nombre || rol?.codigo))
            .filter(Boolean))];
    }

    function nombreRolDesdeSesion() {
        return rolesDesdeSesion().join(" · ") || "Sin rol informado";
    }

    function estadoDesdeSesion() {
        const activo = sesionActual().usuario?.activo;
        if (activo === true) return "Activo";
        if (activo === false) return "Inactivo";
        return "Estado no disponible";
    }

    function permisosDesdeSesion() {
        const permisos = Array.isArray(sesionActual().permisos) ? sesionActual().permisos : [];
        return [...new Set(permisos
            .map(permiso => texto(typeof permiso === "string" ? permiso : permiso?.codigo || permiso?.nombre))
            .filter(Boolean))];
    }

    function etiquetaPermiso(codigo) {
        const partes = codigo.replaceAll("_", " ").split(".").filter(Boolean);
        return partes.map(parte => parte.charAt(0).toUpperCase() + parte.slice(1)).join(" · ");
    }

    function iniciales(nombre, email) {
        const palabras = nombre === "Cuenta Haku"
            ? []
            : nombre.split(/\s+/).filter(Boolean);
        const letras = palabras.slice(0, 2).map(parte => parte.charAt(0));
        if (letras.length) return letras.join("").toLocaleUpperCase("es");
        const primera = texto(email).charAt(0);
        return primera ? primera.toLocaleUpperCase("es") : "H";
    }

    function crearBoton(menu) {
        let boton = document.getElementById(BOTON_ID);
        if (boton) return boton;

        boton = document.createElement("button");
        boton.type = "button";
        boton.id = BOTON_ID;
        boton.className = "menu-item haiku-cuenta-menu-boton";
        boton.setAttribute("aria-haspopup", "dialog");
        boton.setAttribute("aria-expanded", "false");
        boton.setAttribute("aria-controls", PANEL_ID);
        boton.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="8" r="4"></circle>
                <path d="M4 21c0-5 3-7 8-7s8 2 8 7"></path>
            </svg>
            <span>Cuenta</span>
        `;
        menu.appendChild(boton);
        return boton;
    }

    function crearSuperficies() {
        let fondo = document.getElementById(FONDO_ID);
        if (!fondo) {
            fondo = document.createElement("div");
            fondo.id = FONDO_ID;
            fondo.className = "haiku-cuenta-fondo";
            fondo.hidden = true;
            document.body.appendChild(fondo);
        }

        let panel = document.getElementById(PANEL_ID);
        if (!panel) {
            panel = document.createElement("aside");
            panel.id = PANEL_ID;
            panel.className = "haiku-cuenta-menu-panel";
            panel.hidden = true;
            panel.tabIndex = -1;
            panel.setAttribute("role", "dialog");
            panel.setAttribute("aria-modal", "true");
            panel.setAttribute("aria-labelledby", "haiku-cuenta-titulo");
            panel.innerHTML = `
                <header class="haiku-cuenta-cabecera">
                    <button type="button" id="haiku-cuenta-volver" class="haiku-cuenta-volver" aria-label="Volver y cerrar Cuenta">
                        <span aria-hidden="true">←</span><span>Volver</span>
                    </button>
                    <div class="haiku-cuenta-titulos">
                        <h2 id="haiku-cuenta-titulo">Cuenta</h2>
                        <small>Haku</small>
                    </div>
                    <span class="haiku-cuenta-cabecera-espacio" aria-hidden="true"></span>
                </header>
                <div class="haiku-cuenta-scroll" id="haiku-cuenta-scroll">
                    <section class="haiku-cuenta-perfil" aria-label="Perfil de la cuenta">
                        <div class="haiku-cuenta-avatar" id="haiku-cuenta-avatar" aria-hidden="true"></div>
                        <h3 id="haiku-cuenta-nombre"></h3>
                        <p id="haiku-cuenta-email"></p>
                        <div class="haiku-cuenta-badges">
                            <span id="haiku-cuenta-badge-rol"></span>
                            <span id="haiku-cuenta-badge-estado"></span>
                        </div>
                    </section>

                    <section class="haiku-cuenta-tarjeta" aria-labelledby="haiku-cuenta-personal-titulo">
                        <div class="haiku-cuenta-tarjeta-titulo"><h3 id="haiku-cuenta-personal-titulo">Información personal</h3></div>
                        <dl>
                            <div><dt>Nombre completo</dt><dd id="haiku-cuenta-personal-nombre"></dd></div>
                            <div><dt>Correo</dt><dd id="haiku-cuenta-personal-email"></dd></div>
                        </dl>
                    </section>

                    <section class="haiku-cuenta-tarjeta" aria-labelledby="haiku-cuenta-acceso-titulo">
                        <div class="haiku-cuenta-tarjeta-titulo"><h3 id="haiku-cuenta-acceso-titulo">Rol y acceso</h3></div>
                        <div class="haiku-cuenta-rol">
                            <div><small>Rol actual</small><strong id="haiku-cuenta-rol"></strong></div>
                            <span id="haiku-cuenta-estado"></span>
                        </div>
                        <div class="haiku-cuenta-permisos">
                            <small>Permisos habilitados</small>
                            <div id="haiku-cuenta-permisos-lista"></div>
                        </div>
                    </section>

                    <section class="haiku-cuenta-tarjeta" aria-labelledby="haiku-cuenta-seguridad-titulo">
                        <div class="haiku-cuenta-tarjeta-titulo"><h3 id="haiku-cuenta-seguridad-titulo">Seguridad</h3></div>
                        <dl>
                            <div><dt>Sesión</dt><dd id="haiku-cuenta-sesion-estado"></dd></div>
                            <div><dt>Identidad de acceso</dt><dd id="haiku-cuenta-sesion-email"></dd></div>
                        </dl>
                    </section>

                    <section class="haiku-cuenta-tarjeta haiku-cuenta-salida" aria-labelledby="haiku-cuenta-salida-titulo">
                        <h3 id="haiku-cuenta-salida-titulo">Cuenta</h3>
                        <p>Tu sesión identifica las acciones realizadas dentro de Haku.</p>
                        <button type="button" id="haiku-cuenta-menu-salir">Cerrar sesión</button>
                        <p class="haiku-cuenta-salida-estado" id="haiku-cuenta-salida-estado" role="status" aria-live="polite"></p>
                    </section>
                </div>
            `;
            document.body.appendChild(panel);
        }

        return { fondo, panel };
    }

    function instalarCuentaMenu() {
        const menu = document.querySelector("nav.menu");
        if (!menu) return false;

        const boton = crearBoton(menu);
        const { fondo, panel } = crearSuperficies();

        function actualizarIdentidad() {
            const nombre = nombreDesdeSesion();
            const email = emailDesdeSesion();
            const rol = nombreRolDesdeSesion();
            const estado = estadoDesdeSesion();
            const sesion = sesionActual();

            document.getElementById("haiku-cuenta-avatar").textContent = iniciales(nombre, email);
            document.getElementById("haiku-cuenta-nombre").textContent = nombre;
            document.getElementById("haiku-cuenta-email").textContent = email;
            document.getElementById("haiku-cuenta-badge-rol").textContent = rol;
            document.getElementById("haiku-cuenta-badge-estado").textContent = estado;
            document.getElementById("haiku-cuenta-personal-nombre").textContent = nombre;
            document.getElementById("haiku-cuenta-personal-email").textContent = email;
            document.getElementById("haiku-cuenta-rol").textContent = rol;
            document.getElementById("haiku-cuenta-estado").textContent = estado;
            document.getElementById("haiku-cuenta-sesion-estado").textContent = sesion.auth ? "Sesión autenticada" : "Información no disponible";
            document.getElementById("haiku-cuenta-sesion-email").textContent = email;

            const lista = document.getElementById("haiku-cuenta-permisos-lista");
            lista.replaceChildren();
            const permisos = permisosDesdeSesion();
            for (const permiso of permisos) {
                const etiqueta = document.createElement("span");
                etiqueta.textContent = etiquetaPermiso(permiso);
                etiqueta.title = permiso;
                lista.appendChild(etiqueta);
            }
            if (!permisos.length) {
                const vacio = document.createElement("span");
                vacio.className = "haiku-cuenta-permisos-vacio";
                vacio.textContent = "Sin permisos informados";
                lista.appendChild(vacio);
            }
        }

        if (boton.dataset.haikuCuentaMenuV2 === "1") {
            actualizarIdentidad();
            return true;
        }

        boton.dataset.haikuCuentaMenuV2 = "1";
        let focoAnterior = null;

        function abrir() {
            actualizarIdentidad();
            focoAnterior = document.activeElement;
            fondo.hidden = false;
            panel.hidden = false;
            document.getElementById("haiku-cuenta-scroll").scrollTop = 0;
            document.body.classList.add("haiku-cuenta-abierta");
            boton.setAttribute("aria-expanded", "true");
            requestAnimationFrame(() => document.getElementById("haiku-cuenta-volver")?.focus());
        }

        function cerrar({ restaurarFoco = false } = {}) {
            if (panel.hidden) return;
            panel.hidden = true;
            fondo.hidden = true;
            document.body.classList.remove("haiku-cuenta-abierta");
            boton.setAttribute("aria-expanded", "false");
            if (restaurarFoco) {
                const destino = focoAnterior instanceof HTMLElement ? focoAnterior : boton;
                destino.focus();
            }
        }

        function alternar() {
            if (panel.hidden) abrir();
            else cerrar({ restaurarFoco: true });
        }

        boton.addEventListener("click", evento => {
            evento.preventDefault();
            evento.stopPropagation();
            alternar();
        });

        document.getElementById("haiku-cuenta-volver")?.addEventListener("click", () => {
            cerrar({ restaurarFoco: true });
        });

        fondo.addEventListener("click", () => cerrar({ restaurarFoco: true }));

        document.addEventListener("pointerdown", evento => {
            if (panel.hidden || panel.contains(evento.target) || boton.contains(evento.target)) return;
            cerrar();
        });

        document.addEventListener("keydown", evento => {
            if (evento.key !== "Escape" || panel.hidden) return;
            evento.preventDefault();
            evento.stopImmediatePropagation();
            cerrar({ restaurarFoco: true });
        }, true);

        const salir = document.getElementById("haiku-cuenta-menu-salir");
        salir?.addEventListener("click", () => {
            const logoutReal = document.getElementById("haiku-cerrar-sesion");
            const estado = document.getElementById("haiku-cuenta-salida-estado");

            if (!logoutReal) {
                estado.textContent = "No fue posible encontrar la acción de cierre de sesión.";
                return;
            }

            salir.disabled = true;
            estado.textContent = "Cerrando sesión…";
            cerrar();
            logoutReal.click();

            setTimeout(() => {
                salir.disabled = false;
                estado.textContent = "";
            }, 900);
        });

        window.addEventListener("haiku:auth-ready", actualizarIdentidad);

        actualizarIdentidad();

        window.HAIKU_AUTH_MENU_V1 = Object.freeze({
            abrir,
            cerrar: () => cerrar({ restaurarFoco: true }),
            actualizar: actualizarIdentidad
        });

        console.info("HAIKU · Cuenta integrada en el menú.");
        return true;
    }

    function iniciar() {
        if (instalarCuentaMenu()) return;

        let intentos = 0;
        const timer = setInterval(() => {
            intentos++;
            if (instalarCuentaMenu() || intentos >= 30) clearInterval(timer);
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
