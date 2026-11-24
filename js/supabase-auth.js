// ========================================
// HAIKU · AUTENTICACIÓN SUPABASE
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;

    if (!cliente) {
        console.error(
            "HAIKU · Cliente Supabase no disponible."
        );
        return;
    }

    const estilo = document.createElement("style");
    estilo.textContent = `
        .haiku-usuario-chip {
            position: fixed;
            z-index: 99990;
            top: 10px;
            right: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
            max-width: min(420px, calc(100vw - 28px));
            padding: 7px 9px 7px 11px;
            border: 1px solid rgba(255,255,255,.12);
            border-radius: 999px;
            background: rgba(30, 30, 30, .92);
            backdrop-filter: blur(8px);
            color: #f2f2f2;
            box-shadow: 0 8px 24px rgba(0,0,0,.22);
            font-size: .78rem;
        }

        .haiku-usuario-chip[hidden] {
            display: none !important;
        }

        .haiku-usuario-chip strong {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .haiku-usuario-chip span {
            color: #9fb5a3;
            white-space: nowrap;
        }

        .haiku-usuario-chip button {
            border: 0;
            border-radius: 999px;
            padding: 5px 9px;
            background: #4a4a4a;
            color: #fff;
            cursor: pointer;
            font: inherit;
        }

        @media (max-width: 700px) {
            .haiku-usuario-chip {
                top: 6px;
                right: 8px;
                max-width: calc(100vw - 16px);
                font-size: .72rem;
            }
        }
    `;
    document.head.appendChild(estilo);

    const overlay = document.createElement("dialog");
    overlay.className = "haiku-auth-overlay haiku-acceso-lienzo";
    overlay.setAttribute("aria-labelledby", "haiku-auth-titulo");
    overlay.addEventListener("cancel", evento => evento.preventDefault());
    overlay.innerHTML = `
        <form class="haiku-acceso-card" id="haiku-auth-form">
            <span class="haiku-acceso-icono" aria-hidden="true"></span>
            <h1 class="haiku-acceso-titulo" id="haiku-auth-titulo">Iniciar sesión</h1>
            <p class="haiku-acceso-descripcion">
                Ingresa con tu usuario autorizado.
            </p>

            <label class="haiku-acceso-campo">
                Correo
                <input
                    class="haiku-acceso-input"
                    id="haiku-auth-email"
                    type="email"
                    autocomplete="username"
                    required
                >
            </label>

            <label class="haiku-acceso-campo">
                Contraseña
                <input
                    class="haiku-acceso-input"
                    id="haiku-auth-password"
                    type="password"
                    autocomplete="current-password"
                    required
                >
            </label>

            <button
                id="haiku-auth-submit"
                class="haiku-acceso-submit"
                type="submit"
            >
                Entrar
            </button>

            <div
                id="haiku-auth-error"
                class="haiku-acceso-error"
                aria-live="polite"
            ></div>

            <div
                id="haiku-auth-estado"
                class="haiku-acceso-info"
                aria-live="polite"
            >
                Comprobando sesión…
            </div>
        </form>
    `;
    document.body.appendChild(overlay);
    overlay.showModal?.();

    const chip = document.createElement("div");
    chip.className = "haiku-usuario-chip";
    chip.hidden = true;
    chip.innerHTML = `
        <strong id="haiku-usuario-chip-email"></strong>
        <span id="haiku-usuario-chip-rol"></span>
        <button type="button" id="haiku-cerrar-sesion">
            Salir
        </button>
    `;
    document.body.appendChild(chip);

    const formulario =
        document.getElementById("haiku-auth-form");
    const campoEmail =
        document.getElementById("haiku-auth-email");
    const campoPassword =
        document.getElementById("haiku-auth-password");
    const botonEntrar =
        document.getElementById("haiku-auth-submit");
    const errorElemento =
        document.getElementById("haiku-auth-error");
    const estadoElemento =
        document.getElementById("haiku-auth-estado");
    const chipEmail =
        document.getElementById("haiku-usuario-chip-email");
    const chipRol =
        document.getElementById("haiku-usuario-chip-rol");
    const botonSalir =
        document.getElementById("haiku-cerrar-sesion");
    let turnoSesion = 0;
    let validacionSesion = null;

    function mensajeError(texto = "") {
        errorElemento.textContent = texto;
    }

    function mensajeEstado(texto = "") {
        estadoElemento.textContent = texto;
    }

    function bloquearFormulario(bloqueado) {
        botonEntrar.disabled = bloqueado;
        campoEmail.disabled = bloqueado;
        campoPassword.disabled = bloqueado;
    }

    function mostrarLogin(mensaje = "") {
        overlay.hidden = false;
        if (!overlay.open) overlay.showModal?.();
        chip.hidden = true;
        mensajeEstado(mensaje);

        requestAnimationFrame(() => {
            if (campoEmail.value) {
                campoPassword.focus();
            } else {
                campoEmail.focus();
            }
        });
    }

    function nombreRol(roles = []) {
        if (!Array.isArray(roles) || roles.length === 0) {
            return "Sin rol";
        }

        return roles
            .map(rol => rol?.nombre || rol?.codigo || "")
            .filter(Boolean)
            .join(" · ");
    }

    function retirarAcceso() {
        window.haikuSesion = null;
        window.haikuTienePermiso = () => false;
    }

    function cerrarSesionLocal(estado) {
        turnoSesion++;
        validacionSesion = null;
        retirarAcceso();
        campoEmail.value = "";
        campoPassword.value = "";
        mostrarLogin(estado);
    }

    function validarSesion(session) {
        if (!session?.user) {
            cerrarSesionLocal("Sin sesión activa.");
            return Promise.resolve(false);
        }
        const { access_token: token, user: { id: usuario } } = session;
        if (validacionSesion?.token === token && validacionSesion?.usuario === usuario) {
            return validacionSesion.promesa;
        }
        if (window.haikuSesion && window.haikuSesion.auth.id !== usuario) {
            retirarAcceso();
            mostrarLogin("Validando acceso…");
        }
        const turno = ++turnoSesion;
        // Supabase aún mantiene el bloqueo de Auth dentro de onAuthStateChange.
        const promesa = new Promise(resolve => setTimeout(resolve, 0))
            .then(() => turno === turnoSesion && comprobarSesion(session, turno))
            .finally(() => {
                if (turno === turnoSesion) validacionSesion = null;
            });
        validacionSesion = { token, usuario, promesa };
        return promesa;
    }

    async function comprobarSesion(session, turno) {
        let data;
        try {
            let solicitud = cliente.rpc("haiku_sesion_actual");
            if (typeof solicitud.abortSignal === "function" && globalThis.AbortSignal?.timeout) {
                solicitud = solicitud.abortSignal(globalThis.AbortSignal.timeout(20_000));
            }
            const respuesta = await solicitud;
            if (respuesta.error) throw respuesta.error;
            data = respuesta.data;
        } catch (error) {
            if (turno !== turnoSesion) return false;
            retirarAcceso();
            console.warn("HAIKU · No se pudo comprobar el acceso:", error?.code || error?.name);
            mensajeError(
                "No pudimos comprobar tu acceso en este momento. Recarga el panel para volver a intentarlo."
            );
            mostrarLogin("Acceso por comprobar.");
            return false;
        }

        if (turno !== turnoSesion) return false;
        if (!data?.usuario?.activo) {
            retirarAcceso();
            mensajeError("Tu cuenta no está habilitada para este acceso.");
            mostrarLogin("Acceso restringido.");
            try {
                await cliente.auth.signOut();
            } catch (error) {
                console.warn("HAIKU · No se pudo cerrar la sesión local:", error?.code || error?.name);
            }
            return false;
        }

        const permisos =
            Array.isArray(data.permisos)
                ? data.permisos
                : [];

        window.haikuSesion = {
            auth: session.user,
            usuario: data.usuario,
            roles: data.roles || [],
            permisos
        };

        window.haikuTienePermiso = codigo =>
            permisos.includes(codigo);

        chipEmail.textContent =
            session.user.email || data.usuario.nombre || "Usuario";

        chipRol.textContent =
            nombreRol(data.roles);

        chip.hidden = false;
        overlay.hidden = true;
        if (overlay.open) overlay.close();
        mensajeError("");
        mensajeEstado("");

        window.dispatchEvent(
            new CustomEvent(
                "haiku:auth-ready",
                {
                    detail: window.haikuSesion
                }
            )
        );

        console.info(
            "HAIKU · Sesión Supabase activa:",
            {
                usuario: data.usuario,
                roles: data.roles,
                permisos: permisos.length
            }
        );

        return true;
    }

    formulario.addEventListener(
        "submit",
        async evento => {
            evento.preventDefault();

            const email =
                campoEmail.value.trim();
            const password =
                campoPassword.value;

            if (!email || !password) {
                mensajeError(
                    "Ingresa correo y contraseña."
                );
                return;
            }

            mensajeError("");
            mensajeEstado("Validando acceso…");
            bloquearFormulario(true);

            try {
                const { data, error } =
                    await cliente.auth.signInWithPassword({
                        email,
                        password
                    });

                if (error) {
                    throw error;
                }

                campoPassword.value = "";

                const valido =
                    await validarSesion(data.session);

                if (!valido) {
                    return;
                }
            } catch (error) {
                console.error(
                    "HAIKU · Error de login:",
                    error
                );

                let mensaje = "No fue posible iniciar sesión. Inténtalo otra vez en unos segundos.";
                if (error?.message === "Invalid login credentials") mensaje = "Correo o contraseña incorrectos.";
                if (error?.status >= 500) mensaje = "El servicio de acceso no respondió. Inténtalo otra vez en unos segundos.";
                mensajeError(mensaje);

                mensajeEstado("");
            } finally {
                bloquearFormulario(false);
            }
        }
    );

    botonSalir.addEventListener(
        "click",
        async () => {
            botonSalir.disabled = true;

            try {
                await cliente.auth.signOut();
            } finally {
                botonSalir.disabled = false;
                cerrarSesionLocal("Sesión cerrada.");
            }
        }
    );

    cliente.auth.onAuthStateChange(
        (evento, session) => {
            if (evento === "SIGNED_OUT") {
                cerrarSesionLocal("Sesión cerrada.");
                return;
            }

            if (
                evento === "TOKEN_REFRESHED" ||
                evento === "SIGNED_IN"
            ) {
                void validarSesion(session);
            }
        }
    );

    (async () => {
        bloquearFormulario(true);
        mensajeError("");
        mensajeEstado("Comprobando sesión…");

        try {
            const { data, error } =
                await cliente.auth.getSession();

            if (error) {
                throw error;
            }

            if (data.session) {
                await validarSesion(data.session);
            } else {
                mostrarLogin("Sin sesión activa.");
            }
        } catch (error) {
            console.error(
                "HAIKU · Error comprobando sesión:",
                error
            );

            mostrarLogin(
                "No fue posible comprobar la sesión."
            );
        } finally {
            bloquearFormulario(false);
        }
    })();
})();
