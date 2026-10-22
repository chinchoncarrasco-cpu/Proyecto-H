// ========================================
// HAIKU · BLOQUEO VISUAL DE PRIVACIDAD V1
// - Oscurece inmediatamente al perder foco.
// - Si vuelve antes de 1 minuto, restaura sin pedir PIN.
// - Después de 1 minuto exige PIN de 4 dígitos.
// - 3 errores activan rescate obligatorio de 6 dígitos.
// - Es independiente del inicio de sesión de Supabase.
// ========================================
(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const GRACIA_MS = 60000;
    const MAX_INTENTOS = 3;
    const MAX_HISTORIAL = 8;

    let usuarioId = null;
    let configurado = false;
    let armado = false;
    let inicializando = false;
    let fueraDesde = null;
    let timerBloqueo = null;
    let modoActual = "oculto";
    const elementosInertizados = new Set();

    const overlay = document.createElement("div");
    overlay.className = "haiku-privacidad-overlay";
    overlay.hidden = true;
    overlay.dataset.modo = "cortina";
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = `
        <section class="haiku-privacidad-card" role="dialog" aria-modal="true" aria-labelledby="haiku-privacidad-titulo">
            <span class="haiku-privacidad-marca">ACCESO RESTRINGIDO</span>
            <h2 id="haiku-privacidad-titulo">Protección visual</h2>
            <p id="haiku-privacidad-descripcion"></p>

            <div id="haiku-privacidad-alerta" class="haiku-privacidad-alerta" hidden></div>

            <form id="haiku-privacidad-form-setup" class="haiku-privacidad-form" hidden>
                <label class="haiku-privacidad-campo">
                    <span>PIN de desbloqueo · 4 números</span>
                    <input class="haiku-privacidad-input" data-solo-numeros="4" id="haiku-privacidad-pin-nuevo" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="••••" required>
                </label>
                <label class="haiku-privacidad-campo">
                    <span>Repite el PIN</span>
                    <input class="haiku-privacidad-input" data-solo-numeros="4" id="haiku-privacidad-pin-confirmar" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="••••" required>
                </label>
                <label class="haiku-privacidad-campo">
                    <span>Clave de rescate · 6 números</span>
                    <input class="haiku-privacidad-input" data-solo-numeros="6" id="haiku-privacidad-rescate-nuevo" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="••••••" required>
                </label>
                <label class="haiku-privacidad-campo">
                    <span>Repite la clave de rescate</span>
                    <input class="haiku-privacidad-input" data-solo-numeros="6" id="haiku-privacidad-rescate-confirmar" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="••••••" required>
                </label>
                <button class="haiku-privacidad-submit" type="submit">Activar protección</button>
            </form>

            <form id="haiku-privacidad-form-pin" class="haiku-privacidad-form" hidden>
                <label class="haiku-privacidad-campo">
                    <span>PIN de 4 números</span>
                    <input class="haiku-privacidad-input" data-solo-numeros="4" id="haiku-privacidad-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••" required>
                </label>
                <button class="haiku-privacidad-submit" type="submit">Desbloquear</button>
            </form>

            <form id="haiku-privacidad-form-rescate" class="haiku-privacidad-form" hidden>
                <label class="haiku-privacidad-campo">
                    <span>Clave de rescate · 6 números</span>
                    <input class="haiku-privacidad-input" data-solo-numeros="6" id="haiku-privacidad-rescate" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="••••••" required>
                </label>
                <button class="haiku-privacidad-submit" type="submit">Desbloquear con rescate</button>
            </form>

            <div id="haiku-privacidad-error" class="haiku-privacidad-error"></div>
            <div id="haiku-privacidad-info" class="haiku-privacidad-info"></div>

            <div id="haiku-privacidad-intentos" class="haiku-privacidad-intentos" hidden>
                <strong>INTENTOS EN ESTA PESTAÑA</strong>
                <ul id="haiku-privacidad-intentos-lista" class="haiku-privacidad-intentos-lista"></ul>
            </div>
        </section>
    `;
    document.body.appendChild(overlay);

    const titulo = overlay.querySelector("#haiku-privacidad-titulo");
    const descripcion = overlay.querySelector("#haiku-privacidad-descripcion");
    const alerta = overlay.querySelector("#haiku-privacidad-alerta");
    const error = overlay.querySelector("#haiku-privacidad-error");
    const info = overlay.querySelector("#haiku-privacidad-info");
    const formSetup = overlay.querySelector("#haiku-privacidad-form-setup");
    const formPin = overlay.querySelector("#haiku-privacidad-form-pin");
    const formRescate = overlay.querySelector("#haiku-privacidad-form-rescate");
    const pinNuevo = overlay.querySelector("#haiku-privacidad-pin-nuevo");
    const pinConfirmar = overlay.querySelector("#haiku-privacidad-pin-confirmar");
    const rescateNuevo = overlay.querySelector("#haiku-privacidad-rescate-nuevo");
    const rescateConfirmar = overlay.querySelector("#haiku-privacidad-rescate-confirmar");
    const pinInput = overlay.querySelector("#haiku-privacidad-pin");
    const rescateInput = overlay.querySelector("#haiku-privacidad-rescate");
    const intentosWrap = overlay.querySelector("#haiku-privacidad-intentos");
    const intentosLista = overlay.querySelector("#haiku-privacidad-intentos-lista");

    overlay.querySelectorAll("[data-solo-numeros]").forEach(input => {
        input.addEventListener("input", () => {
            const max = Number(input.dataset.soloNumeros || input.maxLength || 6);
            input.value = String(input.value || "").replace(/\D/g, "").slice(0, max);
        });
    });

    // El PIN normal se valida apenas se completan sus 4 dígitos.
    // requestSubmit reutiliza exactamente el mismo flujo/seguridad del formulario.
    pinInput.addEventListener("input", () => {
        const boton = formPin.querySelector('button[type="submit"]');
        if (formPin.hidden || pinInput.value.length !== 4 || boton?.disabled) return;

        queueMicrotask(() => {
            if (
                !formPin.hidden &&
                pinInput.value.length === 4 &&
                !boton?.disabled
            ) {
                formPin.requestSubmit();
            }
        });
    });

    function clave(sufijo) {
        return usuarioId ? `haikuPrivacidad:${usuarioId}:${sufijo}` : "";
    }

    function leerNumeroLocal(sufijo) {
        try { return Number(localStorage.getItem(clave(sufijo)) || 0); }
        catch { return 0; }
    }

    function escribirNumeroLocal(sufijo, valor) {
        try { localStorage.setItem(clave(sufijo), String(valor)); } catch {}
    }

    function hayBloqueoReforzado() {
        try { return localStorage.getItem(clave("reforzado")) === "1"; }
        catch { return false; }
    }

    function activarBloqueoReforzadoLocal() {
        try { localStorage.setItem(clave("reforzado"), "1"); } catch {}
    }

    function limpiarBloqueoReforzadoLocal() {
        try { localStorage.removeItem(clave("reforzado")); } catch {}
    }

    function leerSesion(sufijo) {
        try { return sessionStorage.getItem(clave(sufijo)); }
        catch { return null; }
    }

    function escribirSesion(sufijo, valor) {
        try { sessionStorage.setItem(clave(sufijo), String(valor)); } catch {}
    }

    function borrarSesion(sufijo) {
        try { sessionStorage.removeItem(clave(sufijo)); } catch {}
    }

    function historial() {
        try {
            const valor = JSON.parse(sessionStorage.getItem(clave("historial")) || "[]");
            return Array.isArray(valor) ? valor : [];
        } catch {
            return [];
        }
    }

    function guardarHistorial(lista) {
        try {
            sessionStorage.setItem(
                clave("historial"),
                JSON.stringify(lista.slice(-MAX_HISTORIAL))
            );
        } catch {}
    }

    function registrarIntento(texto) {
        const lista = historial();
        lista.push({
            texto,
            fecha: new Date().toISOString()
        });
        guardarHistorial(lista);
        renderizarHistorial();
    }

    function horaLocal(fecha) {
        try {
            return new Intl.DateTimeFormat("es-CL", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hourCycle: "h23",
                timeZone: "America/Santiago"
            }).format(new Date(fecha));
        } catch {
            return "—";
        }
    }

    function renderizarHistorial() {
        const lista = historial();
        intentosLista.innerHTML = "";
        intentosWrap.hidden = lista.length === 0;

        lista.slice().reverse().forEach(item => {
            const li = document.createElement("li");
            const span = document.createElement("span");
            const time = document.createElement("time");
            span.textContent = item.texto || "Intento incorrecto";
            time.textContent = horaLocal(item.fecha);
            li.append(span, time);
            intentosLista.appendChild(li);
        });
    }

    function inertizarFondo() {
        document.documentElement.classList.add("haiku-privacidad-bloqueada");

        [...document.body.children].forEach(elemento => {
            if (elemento === overlay) return;
            if (elemento.classList?.contains("haiku-auth-overlay")) return;
            if (elemento.hasAttribute("inert")) return;

            elemento.setAttribute("inert", "");
            elemento.dataset.haikuPrivacidadInert = "1";
            elementosInertizados.add(elemento);
        });
    }

    function liberarFondo() {
        document.documentElement.classList.remove("haiku-privacidad-bloqueada");
        elementosInertizados.forEach(elemento => {
            if (elemento.dataset?.haikuPrivacidadInert === "1") {
                elemento.removeAttribute("inert");
                delete elemento.dataset.haikuPrivacidadInert;
            }
        });
        elementosInertizados.clear();
    }

    function limpiarMensajes() {
        error.textContent = "";
        info.textContent = "";
        alerta.hidden = true;
        alerta.textContent = "";
    }

    function ocultarFormularios() {
        formSetup.hidden = true;
        formPin.hidden = true;
        formRescate.hidden = true;
    }

    function mostrarOverlay(modo) {
        modoActual = modo;
        overlay.dataset.modo = modo;
        overlay.hidden = false;
        inertizarFondo();
        limpiarMensajes();
        ocultarFormularios();
        renderizarHistorial();

        if (modo === "cortina") {
            return;
        }

        if (modo === "verificando") {
            titulo.textContent = "Preparando protección";
            descripcion.textContent = "Comprobando la configuración de privacidad de esta sesión…";
            info.textContent = "El contenido permanecerá oculto hasta completar la comprobación.";
            return;
        }

        if (modo === "setup") {
            titulo.textContent = "Configurar privacidad";
            descripcion.textContent = "Crea un PIN de 4 números para desbloqueos normales y una clave de rescate de 6 números para bloqueos reforzados.";
            formSetup.hidden = false;
            info.textContent = "Los códigos se guardan protegidos en Supabase y no quedan escritos en el JavaScript.";
            requestAnimationFrame(() => pinNuevo.focus());
            return;
        }

        if (modo === "pin") {
            const fallos = Math.min(leerNumeroLocal("fallos"), MAX_INTENTOS);
            const restantes = Math.max(0, MAX_INTENTOS - fallos);
            titulo.textContent = "Acceso bloqueado";
            descripcion.textContent = "La página estuvo fuera de foco 1 minuto. Ingresa tu PIN para volver a operar.";
            formPin.hidden = false;
            info.textContent = restantes === MAX_INTENTOS
                ? "Tienes 3 intentos antes del bloqueo reforzado."
                : `Quedan ${restantes} ${restantes === 1 ? "intento" : "intentos"} antes del bloqueo reforzado.`;
            pinInput.value = "";
            requestAnimationFrame(() => pinInput.focus());
            return;
        }

        if (modo === "rescate") {
            titulo.textContent = "Bloqueo reforzado";
            descripcion.textContent = "Se alcanzaron 3 intentos incorrectos. El PIN normal quedó deshabilitado para este equipo hasta validar la clave de rescate.";
            alerta.hidden = false;
            alerta.textContent = "Se requiere la clave de 6 números. Refrescar la página o abrir otra pestaña no elimina este bloqueo.";
            formRescate.hidden = false;
            rescateInput.value = "";
            requestAnimationFrame(() => rescateInput.focus());
        }
    }

    function ocultarOverlay() {
        if (!overlay.hidden) overlay.hidden = true;
        overlay.dataset.modo = "oculto";
        modoActual = "oculto";
        liberarFondo();
    }

    function marcarBloqueado() {
        escribirSesion("bloqueado", "1");
        borrarSesion("fueraDesde");
        fueraDesde = null;

        if (hayBloqueoReforzado() || leerNumeroLocal("fallos") >= MAX_INTENTOS) {
            activarBloqueoReforzadoLocal();
            mostrarOverlay("rescate");
        } else {
            mostrarOverlay("pin");
        }
    }

    function limpiarBloqueoNormal() {
        borrarSesion("bloqueado");
        borrarSesion("fueraDesde");
        escribirNumeroLocal("fallos", 0);
        fueraDesde = null;
        clearTimeout(timerBloqueo);
        timerBloqueo = null;
    }

    function salidaDeHaiku() {
        if (!armado || !configurado) return;
        if (["setup", "verificando", "pin", "rescate"].includes(modoActual)) return;

        if (!fueraDesde) {
            fueraDesde = Date.now();
            escribirSesion("fueraDesde", fueraDesde);
        }

        mostrarOverlay("cortina");

        const marca = fueraDesde;
        clearTimeout(timerBloqueo);
        timerBloqueo = setTimeout(() => {
            if (!armado || !configurado) return;
            if (fueraDesde !== marca) return;
            marcarBloqueado();
        }, GRACIA_MS + 30);
    }

    function regresoAHaiku() {
        if (!armado || !configurado) return;

        clearTimeout(timerBloqueo);
        timerBloqueo = null;

        if (hayBloqueoReforzado() || leerNumeroLocal("fallos") >= MAX_INTENTOS) {
            activarBloqueoReforzadoLocal();
            escribirSesion("bloqueado", "1");
            mostrarOverlay("rescate");
            return;
        }

        if (leerSesion("bloqueado") === "1") {
            mostrarOverlay("pin");
            return;
        }

        const persistido = Number(leerSesion("fueraDesde") || 0);
        const inicio = fueraDesde || persistido;

        if (inicio && Date.now() - inicio >= GRACIA_MS) {
            marcarBloqueado();
            return;
        }

        borrarSesion("fueraDesde");
        fueraDesde = null;
        ocultarOverlay();
    }

    async function verificarCodigo(tipo, codigo) {
        const { data, error: rpcError } = await cliente.rpc(
            "haiku_bloqueo_visual_verificar",
            {
                p_tipo: tipo,
                p_codigo: codigo
            }
        );

        if (rpcError) throw rpcError;
        return data?.ok === true;
    }

    function bloquearBoton(formulario, estado) {
        const boton = formulario.querySelector('button[type="submit"]');
        if (boton) boton.disabled = estado;
    }

    formSetup.addEventListener("submit", async evento => {
        evento.preventDefault();
        limpiarMensajes();

        const pin = pinNuevo.value;
        const pin2 = pinConfirmar.value;
        const rescate = rescateNuevo.value;
        const rescate2 = rescateConfirmar.value;

        if (!/^\d{4}$/.test(pin)) {
            error.textContent = "El PIN debe contener exactamente 4 números.";
            pinNuevo.focus();
            return;
        }
        if (pin !== pin2) {
            error.textContent = "Los dos PIN de 4 números no coinciden.";
            pinConfirmar.focus();
            return;
        }
        if (!/^\d{6}$/.test(rescate)) {
            error.textContent = "La clave de rescate debe contener exactamente 6 números.";
            rescateNuevo.focus();
            return;
        }
        if (rescate !== rescate2) {
            error.textContent = "Las dos claves de rescate no coinciden.";
            rescateConfirmar.focus();
            return;
        }

        bloquearBoton(formSetup, true);
        info.textContent = "Guardando protección…";

        try {
            const { data, error: rpcError } = await cliente.rpc(
                "haiku_bloqueo_visual_configurar",
                {
                    p_pin4: pin,
                    p_rescate6: rescate
                }
            );

            if (rpcError) throw rpcError;
            if (data?.ok !== true) throw new Error("No fue posible confirmar la configuración.");

            configurado = true;
            armado = true;
            limpiarBloqueoReforzadoLocal();
            limpiarBloqueoNormal();
            pinNuevo.value = "";
            pinConfirmar.value = "";
            rescateNuevo.value = "";
            rescateConfirmar.value = "";
            ocultarOverlay();

            console.info("HAIKU · Protección visual configurada.");
        } catch (e) {
            console.error("HAIKU · Error configurando protección visual:", e);
            error.textContent = e?.message || "No fue posible guardar la configuración de privacidad.";
            info.textContent = "";
        } finally {
            bloquearBoton(formSetup, false);
        }
    });

    formPin.addEventListener("submit", async evento => {
        evento.preventDefault();
        limpiarMensajes();

        const codigo = pinInput.value;
        if (!/^\d{4}$/.test(codigo)) {
            error.textContent = "Ingresa los 4 números del PIN.";
            pinInput.focus();
            return;
        }

        bloquearBoton(formPin, true);
        info.textContent = "Verificando…";

        try {
            const ok = await verificarCodigo("pin", codigo);
            if (ok) {
                registrarIntento("Desbloqueo correcto");
                limpiarBloqueoNormal();
                ocultarOverlay();
                return;
            }

            const fallos = leerNumeroLocal("fallos") + 1;
            escribirNumeroLocal("fallos", fallos);
            pinInput.value = "";

            if (fallos >= MAX_INTENTOS) {
                registrarIntento("PIN incorrecto · bloqueo reforzado");
                activarBloqueoReforzadoLocal();
                escribirSesion("bloqueado", "1");
                mostrarOverlay("rescate");
                return;
            }

            const restantes = MAX_INTENTOS - fallos;
            registrarIntento(`PIN incorrecto · ${restantes} ${restantes === 1 ? "intento restante" : "intentos restantes"}`);
            error.textContent = `PIN incorrecto. ${restantes === 1 ? "Queda 1 intento." : `Quedan ${restantes} intentos.`}`;
            info.textContent = "";
            pinInput.focus();
        } catch (e) {
            console.error("HAIKU · Error verificando PIN visual:", e);
            error.textContent = "No fue posible verificar el PIN. Revisa la conexión e inténtalo nuevamente.";
            info.textContent = "";
        } finally {
            bloquearBoton(formPin, false);
        }
    });

    formRescate.addEventListener("submit", async evento => {
        evento.preventDefault();
        limpiarMensajes();

        const codigo = rescateInput.value;
        if (!/^\d{6}$/.test(codigo)) {
            error.textContent = "Ingresa los 6 números de la clave de rescate.";
            rescateInput.focus();
            return;
        }

        bloquearBoton(formRescate, true);
        info.textContent = "Verificando clave de rescate…";

        try {
            const ok = await verificarCodigo("rescate", codigo);
            if (ok) {
                registrarIntento("Rescate correcto · bloqueo restablecido");
                limpiarBloqueoReforzadoLocal();
                limpiarBloqueoNormal();
                ocultarOverlay();
                return;
            }

            rescateInput.value = "";
            registrarIntento("Clave de rescate incorrecta");
            error.textContent = "Clave de rescate incorrecta. El bloqueo reforzado continúa activo.";
            info.textContent = "";
            rescateInput.focus();
        } catch (e) {
            console.error("HAIKU · Error verificando rescate visual:", e);
            error.textContent = "No fue posible verificar la clave de rescate. Revisa la conexión.";
            info.textContent = "";
        } finally {
            bloquearBoton(formRescate, false);
        }
    });

    async function prepararSesion(sesion) {
        const id = sesion?.auth?.id || sesion?.auth?.user?.id || sesion?.usuario?.id || "";
        if (!id || inicializando) return;
        if (usuarioId === id && armado && configurado) return;

        inicializando = true;
        usuarioId = String(id);
        armado = false;
        configurado = false;
        mostrarOverlay("verificando");

        try {
            const { data, error: rpcError } = await cliente.rpc("haiku_bloqueo_visual_estado");
            if (rpcError) throw rpcError;

            configurado = data?.configurado === true;

            if (!configurado) {
                mostrarOverlay("setup");
                return;
            }

            armado = true;

            if (leerNumeroLocal("fallos") >= MAX_INTENTOS) {
                activarBloqueoReforzadoLocal();
            }

            if (hayBloqueoReforzado()) {
                escribirSesion("bloqueado", "1");
                mostrarOverlay("rescate");
                return;
            }

            if (leerSesion("bloqueado") === "1") {
                mostrarOverlay("pin");
                return;
            }

            const salidaAnterior = Number(leerSesion("fueraDesde") || 0);
            if (salidaAnterior && Date.now() - salidaAnterior >= GRACIA_MS) {
                marcarBloqueado();
                return;
            }

            borrarSesion("fueraDesde");
            fueraDesde = null;
            ocultarOverlay();
        } catch (e) {
            console.error("HAIKU · No fue posible preparar protección visual:", e);
            titulo.textContent = "Protección no disponible";
            descripcion.textContent = "No fue posible comprobar la configuración de privacidad. El contenido se mantiene oculto por seguridad.";
            error.textContent = "Revisa la conexión y recarga la página.";
        } finally {
            inicializando = false;
        }
    }

    window.addEventListener("haiku:auth-ready", evento => {
        prepararSesion(evento.detail || window.haikuSesion);
    });

    cliente.auth.onAuthStateChange(evento => {
        if (evento === "SIGNED_OUT") {
            armado = false;
            configurado = false;
            inicializando = false;
            usuarioId = null;
            fueraDesde = null;
            clearTimeout(timerBloqueo);
            timerBloqueo = null;
            ocultarOverlay();
        }
    });

    window.addEventListener("blur", salidaDeHaiku);
    window.addEventListener("focus", regresoAHaiku);

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            salidaDeHaiku();
        } else {
            regresoAHaiku();
        }
    });

    window.addEventListener("pageshow", () => {
        if (window.haikuSesion) prepararSesion(window.haikuSesion);
    });

    // El evento auth-ready puede haberse disparado antes de cargar este módulo.
    if (window.haikuSesion) {
        setTimeout(() => prepararSesion(window.haikuSesion), 0);
    }

    window.HAIKU_PRIVACIDAD = {
        bloquearAhora() {
            if (!armado || !configurado) return false;
            marcarBloqueado();
            return true;
        },
        estado() {
            return {
                configurado,
                armado,
                modo: modoActual,
                bloqueoReforzado: hayBloqueoReforzado(),
                fallos: usuarioId ? leerNumeroLocal("fallos") : 0
            };
        }
    };

    console.info("HAIKU · Bloqueo visual de privacidad V1 preparado.");
})();
