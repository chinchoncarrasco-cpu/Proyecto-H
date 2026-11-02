/* Presentación del chat canónico dentro de Haku Mobile. Sin credenciales ni datos en el puente. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else api.instalar(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    const PERMISOS = ['reservas.ver', 'pagos.ver', 'servicios.ver'];
    const OWNER_KEY = 'haku-mobile-assistant-owner-v1';
    const ACCIONES = Object.freeze({ 'book-current': 'libro', 'book-next': 'libro-siguiente',
        'services-current': 'servicios', 'services-next': 'servicios-siguiente' });
    const textos = {
        login: 'Inicia sesión en Haku con la misma cuenta que usas en la app.',
        mismatch: 'Hay otra cuenta de Haku abierta. Cierra esa sesión e ingresa con la cuenta de la app.',
        error: 'No pudimos verificar el acceso al chat. Comprueba tu conexión y vuelve a intentarlo.',
        closed: 'Chat cerrado.', waiting: 'Comprobando tu acceso a Haku…'
    };
    function crearControlador({ contexto, cliente, chat, vista, publicar, recargar, prepararHistorial }) {
        let binding = null, revision = 0, verificado = false, cerrado = false, validar = true;
        let pendiente = null, ultimaPublicacion = '', cuentaObservada = null;
        const identidad = () => contexto()?.auth?.id || null;
        const candidatoValido = () => {
            const s = contexto();
            return !!binding && s?.auth?.id === binding.owner && s?.usuario?.id === binding.owner &&
                s.usuario.activo === true && PERMISOS.every(p => s.permisos?.includes(p));
        };
        function estado(state, mensaje = textos[state]) {
            if (state !== 'ready') verificado = false;
            vista(state, mensaje || '');
            if (!binding) return;
            const payload = { type: 'haku-assistant-session', nonce: binding.nonce, userId: identidad(), state };
            const key = JSON.stringify(payload);
            if (key !== ultimaPublicacion) { ultimaPublicacion = key; publicar(payload); }
        }
        function invalidar() { revision++; verificado = false; validar = true; vista('waiting', textos.waiting); }
        function cambioSesion(evento, sesion) {
            if (evento === 'INITIAL_SESSION') { cuentaObservada = sesion?.user?.id || cuentaObservada; return; }
            const id = sesion?.user?.id || null;
            const cambioReal = evento === 'SIGNED_OUT' || (cuentaObservada && id !== cuentaObservada);
            cuentaObservada = id;
            invalidar();
            if (cambioReal) { chat()?.cerrar?.(); recargar(); }
        }
        async function revisar() {
            if (!binding || cerrado) return;
            const actual = identidad();
            if (!actual) { estado('login'); return; }
            if (!candidatoValido()) { estado('mismatch'); return; }
            if (!chat()?.abrir || !cliente()) { vista('waiting', textos.waiting); return; }
            if (!validar || pendiente) return;
            validar = false;
            const rev = revision, expected = binding.owner;
            const vigente = () => rev === revision && !cerrado && binding?.owner === expected && candidatoValido();
            const trabajo = (async () => {
                try {
                    const c = cliente(), inicial = await c.auth.getSession();
                    if (!vigente()) return;
                    const token = inicial?.data?.session?.access_token;
                    if (inicial?.error || !token || inicial.data.session.user?.id !== expected) throw Error();
                    const user = await c.auth.getUser();
                    if (!vigente()) return;
                    if (user?.error || user?.data?.user?.id !== expected) throw Error();
                    const perfil = await c.rpc('haiku_sesion_actual');
                    if (!vigente()) return;
                    if (perfil?.error || perfil?.data?.usuario?.id !== expected || perfil.data.usuario.activo !== true ||
                        !PERMISOS.every(p => perfil.data.permisos?.includes(p))) throw Error();
                    const final = await c.auth.getSession();
                    if (!vigente()) return;
                    if (final?.error || final?.data?.session?.user?.id !== expected || final.data.session.access_token !== token) throw Error();
                    cuentaObservada = expected;
                    verificado = true; estado('ready'); chat().abrir();
                } catch (_) { if (vigente()) estado('error'); }
            })();
            pendiente = trabajo;
            try { await trabajo; } finally { if (pendiente === trabajo) pendiente = null; }
        }
        function bind(value) {
            if (!UUID.test(value?.owner || '') || !UUID.test(value?.nonce || '')) return false;
            invalidar(); cerrado = false; ultimaPublicacion = '';
            binding = { owner: value.owner, nonce: value.nonce };
            if (prepararHistorial(binding.owner)) return true;
            void revisar(); return true;
        }
        function permitido() { return verificado && !cerrado && candidatoValido(); }
        function cerrar() { if (!binding) return; cerrado = true; revision++; chat()?.cerrar?.(); estado('closed'); }
        return Object.freeze({ bind, revisar, permitido, cerrar, cambioSesion,
            revalidar: () => { invalidar(); void revisar(); },
            propietario: () => binding?.owner || null,
            coincide: value => !!binding && value?.owner === binding.owner && value?.nonce === binding.nonce });
    }
    function instalar(root) {
        if (root.HAKU_MOBILE_ASSISTANT_V1) return root.HAKU_MOBILE_ASSISTANT_V1;
        let url;
        try { url = new URL(root.location.href); } catch (_) { return null; }
        if (url.searchParams.get('haku-mobile-assistant') !== '1' || !url.pathname.endsWith('/panel.html')) return null;
        const d = root.document, html = d.documentElement;
        html.dataset.hakuMobileAssistant = '1';
        let gate, status, logout, retry, bookStatus, nativeAuth = null, reloadPendiente = false;
        let mesPendiente = null, peticionMes = 0;
        function limpiarHistorial() {
            try { root.sessionStorage.removeItem(`haiku_asistente_historial_v1::${root.location.pathname}`); } catch (_) {}
        }
        function recargar() {
            if (reloadPendiente) return;
            reloadPendiente = true; mesPendiente = null; limpiarHistorial();
            // No guardar de nuevo el DOM de la cuenta anterior al dispararse pagehide.
            d.getElementById('haiku-asistente-mensajes')?.replaceChildren();
            root.location.reload();
        }
        function impedirHistorialTardio() {
            if (!reloadPendiente) return;
            d.getElementById('haiku-asistente-mensajes')?.replaceChildren();
            limpiarHistorial();
        }
        root.addEventListener('beforeunload', impedirHistorialTardio, true);
        root.addEventListener('pagehide', impedirHistorialTardio, true);
        function construirGate() {
            if (!d.body || gate) return;
            gate = d.createElement('section'); gate.id = 'haku-mobile-assistant-gate';
            // Es una superficie de autenticación, igual que el login canónico;
            // el bloqueo de privacidad permite cambiar de cuenta sin revelar datos.
            gate.className = 'haiku-auth-overlay';
            gate.setAttribute('aria-label', 'Acceso al chat de Haku');
            const title = d.createElement('strong'); title.textContent = 'Haku';
            status = d.createElement('p'); status.setAttribute('role', 'status'); status.textContent = textos.waiting;
            logout = d.createElement('button'); logout.type = 'button'; logout.textContent = 'Cerrar la otra sesión'; logout.hidden = true;
            retry = d.createElement('button'); retry.type = 'button'; retry.textContent = 'Comprobar acceso'; retry.hidden = true;
            logout.addEventListener('click', async () => {
                logout.disabled = true;
                try { const r = await root.haikuSupabase.auth.signOut(); if (r?.error) throw Error(); recargar(); }
                catch (_) { status.textContent = textos.error; logout.disabled = false; }
            });
            retry.addEventListener('click', () => control.revalidar());
            gate.append(title, status, logout, retry); d.body.append(gate);
        }
        function vista(state, mensaje) {
            construirGate();
            html.classList.toggle('haku-mobile-assistant-ready', state === 'ready');
            html.dataset.hakuMobileAssistantState = state;
            const panel = d.getElementById('haiku-asistente-panel');
            if (panel) panel.inert = state !== 'ready';
            if (gate) { gate.hidden = state === 'ready'; status.textContent = mensaje;
                logout.hidden = state !== 'mismatch'; retry.hidden = state !== 'error'; }
            if (state !== 'ready') mesPendiente = null;
            // El gate y el login ya ocultan el panel; no esperar al PIN del panel
            // para poder cambiar una sesión equivocada. El bloqueo canónico sigue vivo.
            if (gate && state !== 'ready') html.classList.remove('haiku-privacidad-arranque');
        }
        const control = crearControlador({ contexto: () => root.haikuSesion, cliente: () => root.haikuSupabase,
            // READY acredita identidad, no desbloquea el PIN. La superficie de
            // privacidad ya instalada permanece por encima e inertiza el chat.
            chat: () => typeof root.HAIKU_PRIVACIDAD?.estado === 'function' ? root.HAIKU_ASISTENTE : null, vista, recargar,
            prepararHistorial: owner => {
                try {
                    const anterior = root.sessionStorage.getItem(OWNER_KEY);
                    if (anterior === owner) return false;
                    root.sessionStorage.setItem(OWNER_KEY, owner); recargar(); return true;
                } catch (_) {
                    // Sin almacenamiento no se restaura historial entre cuentas.
                    limpiarHistorial(); d.getElementById('haiku-asistente-mensajes')?.replaceChildren(); return false;
                }
            }, publicar: payload => {
                try { root.ReactNativeWebView?.postMessage(JSON.stringify(payload)); } catch (_) {}
            } });
        function informarLibro(texto) {
            const conversacion = d.querySelector('.haiku-asistente-conversacion');
            if (!conversacion) return;
            if (!bookStatus) { bookStatus = d.createElement('p'); bookStatus.id = 'haku-mobile-assistant-book-status';
                bookStatus.setAttribute('role', 'status'); conversacion.prepend(bookStatus); }
            bookStatus.textContent = texto; bookStatus.hidden = !texto;
        }
        function focusMonth(action, context) {
            if (!Object.hasOwn(ACCIONES, action) || !control.coincide(context) || !control.permitido() || reloadPendiente) return false;
            mesPendiente = { id: ++peticionMes, inicio: Date.now(), conectando: false, accion: ACCIONES[action] };
            informarLibro('Preparando la comparación del Libro con Proyecto H…'); revisarMes(); return true;
        }
        function revisarMes() {
            const peticion = mesPendiente;
            if (!peticion || !control.permitido()) return;
            if (Date.now() - peticion.inicio > 90_000) { mesPendiente = null;
                informarLibro('No pudimos preparar el Libro. Comprueba tu conexión y vuelve a pulsar Comparar Libro.'); return; }
            const google = root.HAIKU_LIBRO_GOOGLE_V1, libro = root.HAIKU_LIBRO_RESERVA_V1;
            if (!google?.estado || !libro?.estado) return;
            if (!google.estado().conectado) {
                if (!peticion.conectando) {
                    peticion.conectando = true;
                    Promise.resolve(google.conectar()).then(() => {
                        if (mesPendiente !== peticion) return;
                        if (!google.estado().conectado) { mesPendiente = null;
                            informarLibro('No pudimos conectar con el Libro compartido. Comprueba tu conexión e inténtalo nuevamente.'); }
                        else revisarMes();
                    }, () => { if (mesPendiente === peticion) { mesPendiente = null;
                        informarLibro('No pudimos conectar con el Libro compartido. Vuelve a intentarlo.'); } });
                }
                return;
            }
            if (google.estado().sincronizando || !libro.estado().cargado || root.HAIKU_ASISTENTE.procesando?.()) return;
            const privacidad = root.HAIKU_PRIVACIDAD?.estado?.();
            if (!privacidad || !privacidad.armado || privacidad.modo !== 'oculto') return;
            if (!root.HAIKU_LIBRO_CONSULTAS || peticion.accion.startsWith('servicios') && !root.HAIKU_LIBRO_SERVICIOS_SCOPE_V2) return;
            const boton = d.querySelector(`[data-haiku-accion-rapida="${peticion.accion}"]`);
            if (!boton) return;
            mesPendiente = null; informarLibro(''); boton.click();
        }
        function registrarSesion() {
            const auth = root.haikuSupabase?.auth;
            if (!auth?.onAuthStateChange || nativeAuth === auth) return;
            nativeAuth = auth;
            auth.onAuthStateChange((event, session) => {
                control.cambioSesion(event, session);
                root.setTimeout(() => { if (!reloadPendiente) void control.revisar(); }, 0);
            });
        }
        // Instalado antes que los módulos canónicos. Impide nuevas acciones si
        // se pierde identidad, incluso antes del siguiente frame o callback Auth.
        function proteger(event) {
            if (control.permitido()) {
                if (event.type === 'click' && event.target?.closest?.('#haiku-asistente-cerrar')) control.cerrar();
                return;
            }
            if (event.target?.closest?.('.haiku-auth-overlay, .haiku-privacidad-overlay, #haku-mobile-assistant-gate')) return;
            event.preventDefault(); event.stopImmediatePropagation();
        }
        root.addEventListener('click', proteger, true); root.addEventListener('keydown', proteger, true);
        root.addEventListener('haiku:auth-ready', () => { registrarSesion(); control.revalidar(); });
        d.addEventListener('haiku:supabase-ready', registrarSesion);
        d.addEventListener('DOMContentLoaded', () => { construirGate(); registrarSesion(); void control.revisar(); });
        const timer = root.setInterval(() => {
            if (reloadPendiente) return;
            construirGate(); registrarSesion(); void control.revisar(); revisarMes();
        }, 250);
        root.addEventListener('pagehide', () => { root.clearInterval(timer); mesPendiente = null; }, { once: true });
        const api = Object.freeze({ version: 1, serverOnly: true, bind: control.bind, focusMonth });
        root.HAKU_MOBILE_ASSISTANT_V1 = api;
        return api;
    }
    return Object.freeze({ crearControlador, instalar });
});
