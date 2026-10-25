// ========================================
// HAIKU · LIBRO ONLINE GOOGLE DRIVE · SOLO LECTURA V1
// Fuente fijada por ID. Nunca escribe ni modifica el archivo de Google.
// ========================================

(function (root) {
    "use strict";

    if (root.HAIKU_LIBRO_GOOGLE_V1) return;

    const FILE_ID = "1ZX4KqcdY6LORafrI6NkqwT3hGxrdK2rk";
    const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
    const POLL_MS = 15_000;
    const SESSION_KEY = "haikuLibroGoogleSesionV1";
    const MODIFIED_KEY = "haikuLibroGoogleModifiedTimeV1";
    const informeReadonly = document.getElementById("seccion-libro-reserva")?.dataset?.libroModo === "informe-readonly";
    let modifiedMemoria = "";
    const CLIENT_ID = "197003685258-9ui24grgj560t2itpknbmcva0rip8129.apps.googleusercontent.com";

    let accessToken = "";
    let tokenExpiraEn = 0;
    let tokenClient = null;
    let gisPromise = null;
    let timer = null;
    let sincronizando = false;
    let metadataActual = null;
    let fuenteControl = null;
    let revisionAutorizacion = 0;
    let timerAutorizacion = null;
    let usuarioAutorizado = null;
    let clienteAuth = null;
    let ultimaComprobacion = 0;
    let ultimaComprobacionCorrecta = 0;
    let comprobacionAbort = null;
    let conexionServidor = false;
    let servidorPendiente = null;
    let servidorPausado = false;
    const servidorDisponible = () => root.HAIKU_SUPABASE_CONFIG?.libroConexionServidor === true &&
        typeof root.haikuSupabase?.functions?.invoke === "function";

    const usuarioActual = () => root.haikuSesion?.usuario?.activo === true
        ? root.haikuSesion.auth?.id || null : null;

    // Sólo el permiso temporal, en esta pestaña y ligado al usuario de Haku.
    // Nunca prolonga su vencimiento ni persiste permisos en el informe readonly.
    function borrarSesionGuardada() {
        if (informeReadonly) return;
        try { root.sessionStorage?.removeItem(SESSION_KEY); } catch (_) {}
    }

    function guardarSesion() {
        if (informeReadonly || !usuarioAutorizado) return;
        try { root.sessionStorage?.setItem(SESSION_KEY, JSON.stringify({
            usuario: usuarioAutorizado, clientId: CLIENT_ID, fileId: FILE_ID,
            token: accessToken, expiraEn: tokenExpiraEn
        })); } catch (_) { /* Sin almacenamiento, la conexión actual sigue funcionando. */ }
    }

    function programarVencimiento() {
        if (timerAutorizacion) clearTimeout(timerAutorizacion);
        timerAutorizacion = setTimeout(avisarRenovacion, Math.max(0, tokenExpiraEn - Date.now()));
    }

    function avisarRenovacion() {
        perderAutorizacion();
        pintar("neutral", "Renovar conexión con Google", "El permiso temporal venció o fue revocado. Pulsa Conectar Google para reanudar los avisos del Libro.");
    }

    async function restaurarSesion() {
        const usuario = usuarioActual();
        if (usuario && !servidorPausado && !conexionServidor && servidorDisponible()) {
            try { if (await conectarServidor()) return; }
            catch (error) { pintar("error", "Libro online", error.message); return; }
            if (usuario !== usuarioActual() || servidorPausado) return;
        }
        if (informeReadonly || !usuario || accessToken) return;
        let guardada;
        try { guardada = JSON.parse(root.sessionStorage?.getItem(SESSION_KEY) || "null"); }
        catch (_) { borrarSesionGuardada(); return; }
        if (!guardada) return;
        if (guardada.usuario !== usuario || guardada.clientId !== CLIENT_ID || guardada.fileId !== FILE_ID ||
            typeof guardada.token !== "string" || !guardada.token || guardada.token.length > 16384 || /\s/.test(guardada.token) ||
            !Number.isFinite(guardada.expiraEn) || guardada.expiraEn <= Date.now() || guardada.expiraEn > Date.now() + 3600_000) {
            borrarSesionGuardada();
            if (guardada.usuario === usuario && Number.isFinite(guardada.expiraEn) && guardada.expiraEn <= Date.now()) avisarRenovacion();
            return;
        }
        accessToken = guardada.token; tokenExpiraEn = guardada.expiraEn;
        usuarioAutorizado = usuario; revisionAutorizacion++;
        programarVencimiento(); iniciarPolling();
        pintar("trabajando", "Recuperando conexión con Google", "Comprobando la última versión del Libro…");
        // Conservar la versión anterior y no competir con su restauración desde IndexedDB.
        await sincronizar(false);
    }

    function instalarSesion() {
        const auth = root.haikuSupabase?.auth;
        if (!auth?.onAuthStateChange || clienteAuth === auth) return;
        clienteAuth = auth;
        auth.onAuthStateChange((evento, sesion) => {
            if (evento === "SIGNED_OUT" || (usuarioAutorizado && sesion?.user?.id !== usuarioAutorizado)) {
                perderAutorizacion(); metadataActual = null;
                pintar("neutral", "Libro online", "Conexión cerrada con la sesión de Haku.");
            }
            if (evento === "SIGNED_OUT") servidorPausado = false;
        });
    }

    function fallo(code) {
        return new root.HAIKU_LIBRO_FUENTE_OFICIAL_V1.FuenteOficialError(code);
    }

    function autorizado() {
        if (conexionServidor) return Boolean(usuarioAutorizado) && usuarioActual() === usuarioAutorizado;
        return Boolean(accessToken) && tokenExpiraEn > Date.now();
    }

    function perderAutorizacion() {
        conexionServidor = false;
        accessToken = ""; tokenExpiraEn = 0; revisionAutorizacion++;
        usuarioAutorizado = null; borrarSesionGuardada();
        comprobacionAbort?.abort();
        if (timerAutorizacion) clearTimeout(timerAutorizacion);
        timerAutorizacion = null;
        fuenteControl?.invalidar("GOOGLE_NO_AUTORIZADO"); detenerPolling();
        const conectarBtn = $("haiku-libro-google-conectar"), syncBtn = $("haiku-libro-google-sincronizar");
        const desconectarBtn = $("haiku-libro-google-desconectar");
        if (conectarBtn) conectarBtn.hidden = false;
        if (syncBtn) syncBtn.disabled = true;
        if (desconectarBtn) desconectarBtn.hidden = true;
    }

    function controladorFuente() {
        if (!fuenteControl) {
            fuenteControl = root.HAIKU_LIBRO_FUENTE_OFICIAL_V1.crearControlador({
                fileId: FILE_ID, lector: () => root.HAIKU_LIBRO_RESERVA_V1, autorizado,
                obtenerMetadata: signal => obtenerMetadata({ verificada: true, signal }),
                descargar: (metadata, signal) => descargar(metadata, { verificada: true, signal }),
                entregar: entregarAlLibro, crypto: root.crypto,
                alInvalidar: code => root.dispatchEvent(new CustomEvent("haiku:libro-fuente-invalidada", { detail: { code } }))
            });
            root.addEventListener("haiku:libro-cambio", () => fuenteControl.cambioLibro());
            root.addEventListener("haiku:libro-vista-actualizada", e => fuenteControl.vistaLibro(e.detail));
            $("libro-reserva-archivo")?.addEventListener("change", () => fuenteControl.invalidar());
        }
        return fuenteControl;
    }

    const $ = id => document.getElementById(id);

    function horaChile(iso) {
        if (!iso) return "";
        try {
            return new Intl.DateTimeFormat("es-CL", {
                dateStyle: "short",
                timeStyle: "short"
            }).format(new Date(iso));
        } catch (_) {
            return iso;
        }
    }

    function asegurarEstilos() {
        if ($("haiku-libro-google-style")) return;
        const estilo = document.createElement("style");
        estilo.id = "haiku-libro-google-style";
        estilo.textContent = `
            .haiku-libro-google {
                display:flex; flex-wrap:wrap; align-items:center; gap:8px 10px;
                margin-top:10px; padding:10px 12px; border:1px solid #d8e2da;
                border-radius:12px; background:#f7faf8; color:#26342c;
                font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
            }
            .haiku-libro-google__estado { display:flex; align-items:center; gap:7px; min-width:220px; flex:1 1 260px; }
            .haiku-libro-google__punto { width:9px; height:9px; border-radius:50%; background:#a8aca9; flex:0 0 auto; }
            .haiku-libro-google[data-estado="ok"] .haiku-libro-google__punto { background:#3e9b5f; }
            .haiku-libro-google[data-estado="trabajando"] .haiku-libro-google__punto { background:#d79a2b; }
            .haiku-libro-google[data-estado="error"] .haiku-libro-google__punto { background:#c85c5c; }
            .haiku-libro-google__texto strong { display:block; font-size:13px; }
            .haiku-libro-google__texto span { display:block; color:#657169; font-size:12px; }
            .haiku-libro-google button {
                border:1px solid #c8d6cb; border-radius:9px; padding:7px 10px;
                background:#fff; color:#245438; cursor:pointer; font:inherit;
            }
            .haiku-libro-google button:disabled { opacity:.55; cursor:default; }
            @media (max-width:700px) {
                .haiku-libro-google { align-items:stretch; }
                .haiku-libro-google__estado { flex-basis:100%; }
                .haiku-libro-google button { flex:1 1 auto; }
            }
        `;
        document.head.appendChild(estilo);
    }

    function construirUI() {
        if ($("haiku-libro-google")) return $("haiku-libro-google");
        const acciones = document.querySelector("#seccion-libro-reserva .libro-reserva-acciones");
        if (!acciones) return null;

        asegurarEstilos();
        const caja = document.createElement("div");
        caja.id = "haiku-libro-google";
        caja.className = "haiku-libro-google";
        caja.dataset.estado = "neutral";
        caja.innerHTML = `
            <div class="haiku-libro-google__estado">
                <span class="haiku-libro-google__punto" aria-hidden="true"></span>
                <div class="haiku-libro-google__texto">
                    <strong id="haiku-libro-google-titulo">Libro online</strong>
                    <span id="haiku-libro-google-detalle">No conectado</span>
                </div>
            </div>
            <button type="button" id="haiku-libro-google-conectar">Conectar Google</button>
            <button type="button" id="haiku-libro-google-sincronizar" disabled>Sincronizar ahora</button>
            <button type="button" id="haiku-libro-google-desconectar" hidden>Desconectar</button>
        `;
        acciones.insertAdjacentElement("afterend", caja);

        $("haiku-libro-google-conectar")?.addEventListener("click", () => conectar());
        $("haiku-libro-google-sincronizar")?.addEventListener("click", () => sincronizar(true));
        $("haiku-libro-google-desconectar")?.addEventListener("click", () => desconectar());
        return caja;
    }

    function pintar(estado, titulo, detalle) {
        const caja = construirUI();
        if (!caja) return;
        caja.dataset.estado = estado || "neutral";
        const tituloEl = $("haiku-libro-google-titulo");
        const detalleEl = $("haiku-libro-google-detalle");
        if (tituloEl) tituloEl.textContent = titulo || "Libro online";
        if (detalleEl) detalleEl.textContent = detalle || "";

        const conectado = autorizado();
        const onlineTitulo = $("sites-libro-online-titulo");
        const onlineDetalle = $("sites-libro-online-detalle");
        const syncTitulo = $("sites-libro-sync-titulo");
        const syncDetalle = $("sites-libro-sync-detalle");
        if (onlineTitulo) onlineTitulo.textContent = conectado
            ? (estado === "error" ? "Conexión con incidencias" : "Conectado")
            : (estado === "trabajando" ? "Conectando…" : "Sin conexión");
        if (onlineDetalle) onlineDetalle.textContent = detalle || "Google Drive de solo lectura";
        if (syncTitulo) syncTitulo.textContent = !conectado
            ? "Sin sincronización activa"
            : (sincronizando ? "Comprobando Google…" : estado === "error" ? "Comprobación con incidencias" : "Comprobación automática activa");
        if (syncDetalle) syncDetalle.textContent = !conectado
            ? "Conecta Google para actualizar"
            : (estado === "error" ? detalle || "Revisa la conexión con Google"
                : `${ultimaComprobacionCorrecta ? `Revisado ${horaChile(ultimaComprobacionCorrecta)}. ` : ""}Cada 15 s y al volver al panel; descarga si Google cambia`);
        const conectarBtn = $("haiku-libro-google-conectar");
        const syncBtn = $("haiku-libro-google-sincronizar");
        const desconectarBtn = $("haiku-libro-google-desconectar");
        if (conectarBtn) conectarBtn.hidden = conectado;
        if (conectarBtn) conectarBtn.textContent = servidorDisponible() ? "Conectar Libro" : "Conectar Google";
        if (syncBtn) syncBtn.disabled = !conectado || sincronizando;
        if (desconectarBtn) desconectarBtn.hidden = !conectado;
        if (desconectarBtn) desconectarBtn.textContent = conexionServidor ? "Pausar" : "Desconectar";
    }

    async function consultarServidor(accion, version, signal) {
        const usuario = usuarioActual(), revision = revisionAutorizacion;
        if (!usuario) throw fallo("HAKU_NO_AUTORIZADO");
        const body = accion === "metadata" ? { accion } : { accion, version };
        const { data, error } = await root.haikuSupabase.functions.invoke("haku-libro-enlace-readonly", { body, signal });
        if (signal?.aborted || revision !== revisionAutorizacion || usuarioActual() !== usuario)
            throw fallo("SOLICITUD_OBSOLETA");
        if (error) {
            let detalle;
            try { detalle = await error.context?.json(); } catch (_) {}
            if (revision !== revisionAutorizacion || usuarioActual() !== usuario) throw fallo("SOLICITUD_OBSOLETA");
            if ([401, 403].includes(error.context?.status) || detalle?.code === "SESION_PERMISOS") {
                perderAutorizacion();
                pintar("error", "Libro online", "Tu sesión de Haku no permite consultar el Libro. Vuelve a iniciar sesión.");
                throw fallo("HAKU_NO_AUTORIZADO");
            }
            const codigos = {
                CONFIGURACION_PENDIENTE: "SERVIDOR_NO_CONFIGURADO", CONFIG_INVALIDA: "SERVIDOR_NO_CONFIGURADO",
                GOOGLE_ACCESS_DENIED: "LIBRO_ENLACE_NO_DISPONIBLE", GOOGLE_FILE_NOT_FOUND: "LIBRO_ENLACE_NO_DISPONIBLE",
                FUENTE_CAMBIADA: "FUENTE_CAMBIADA", FUENTE_INVALIDA: "FUENTE_INVALIDA",
                FUENTE_DEMASIADO_GRANDE: "FUENTE_DEMASIADO_GRANDE", FUENTE_NO_VERIFICABLE: "FUENTE_NO_VERIFICABLE",
                CHECKSUM_INVALIDO: "CHECKSUM_INVALIDO", GOOGLE_TIMEOUT: "GOOGLE_TIMEOUT"
            };
            throw fallo(error.context?.status === 404 ? "SERVIDOR_NO_CONFIGURADO" : codigos[detalle?.code] || "GOOGLE_ERROR");
        }
        return data;
    }

    async function conectarServidor() {
        if (!servidorDisponible() || !usuarioActual() || servidorPausado) return false;
        if (conexionServidor && autorizado()) return true;
        if (servidorPendiente) return servidorPendiente;
        const usuario = usuarioActual(), revision = revisionAutorizacion;
        const pendiente = (async () => {
            const abort = new root.AbortController();
            const timeout = setTimeout(() => abort.abort(), 30_000);
            try {
                const metadata = await consultarServidor("metadata", undefined, abort.signal);
                if (abort.signal.aborted || revision !== revisionAutorizacion || usuario !== usuarioActual() || servidorPausado) return false;
                if (metadata?.id !== FILE_ID || metadata?.mimeType !== MIME_XLSX) return false;
                perderAutorizacion(); // El token de Google deja de ser necesario, sin revocar su concesión.
                conexionServidor = true; usuarioAutorizado = usuario;
                iniciarPolling();
                pintar("trabajando", "Libro online", "Conectando con el Libro compartido…");
                await sincronizar(false);
                return true;
            } catch (error) {
                // Sólo la falta de instalación/configuración permite el acceso anterior.
                if (["SERVIDOR_NO_CONFIGURADO", "SOLICITUD_OBSOLETA"].includes(error.code)) return false;
                throw error;
            } finally { clearTimeout(timeout); }
        })();
        servidorPendiente = pendiente;
        try { return await pendiente; }
        finally { if (servidorPendiente === pendiente) servidorPendiente = null; }
    }

    function cargarGIS() {
        if (root.google?.accounts?.oauth2) return Promise.resolve();
        if (gisPromise) return gisPromise;
        gisPromise = new Promise((resolve, reject) => {
            const existente = document.querySelector('script[data-haiku-google-gis="1"]');
            if (existente) {
                const revisar = () => root.google?.accounts?.oauth2 ? resolve() : setTimeout(revisar, 50);
                revisar();
                return;
            }
            const script = document.createElement("script");
            script.src = "https://accounts.google.com/gsi/client";
            script.async = true;
            script.defer = true;
            script.dataset.haikuGoogleGis = "1";
            script.onload = () => root.google?.accounts?.oauth2 ? resolve() : reject(new Error("Google Identity Services no quedó disponible."));
            script.onerror = () => reject(new Error("No fue posible cargar Google Identity Services."));
            document.head.appendChild(script);
        });
        return gisPromise;
    }

    async function prepararCliente() {
        if (!CLIENT_ID) throw new Error("Falta configurar el OAuth Client ID de Google.");
        if (tokenClient) return tokenClient;
        await cargarGIS();
        tokenClient = root.google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: DRIVE_SCOPE,
            include_granted_scopes: false,
            callback: () => {}
        });
        return tokenClient;
    }

    function solicitarToken() {
        const solicitud = ++revisionAutorizacion;
        // También vincular una autorización pendiente: cambiar de usuario mientras
        // Google muestra su ventana debe invalidar esa respuesta tardía.
        usuarioAutorizado = usuarioActual();
        fuenteControl?.invalidar();
        return new Promise(async (resolve, reject) => {
            let cliente;
            try {
                cliente = await prepararCliente();
            } catch (error) {
                reject(error);
                return;
            }
            if (solicitud !== revisionAutorizacion) { reject(fallo("SOLICITUD_OBSOLETA")); return; }
            cliente.callback = respuesta => {
                if (solicitud !== revisionAutorizacion) { reject(fallo("SOLICITUD_OBSOLETA")); return; }
                if (respuesta?.error) {
                    perderAutorizacion(); reject(fallo("GOOGLE_NO_AUTORIZADO"));
                    return;
                }
                perderAutorizacion();
                accessToken = String(respuesta?.access_token || "");
                const segundos = Number(respuesta?.expires_in || 0);
                tokenExpiraEn = Date.now() + Math.max(0, segundos - 60) * 1000;
                if (!autorizado()) {
                    perderAutorizacion(); reject(fallo("GOOGLE_NO_AUTORIZADO"));
                    return;
                }
                usuarioAutorizado = usuarioActual();
                guardarSesion(); programarVencimiento();
                resolve(revisionAutorizacion);
            };
            cliente.requestAccessToken();
        });
    }

    async function driveFetch(url, signal, verificada = false) {
        if (!autorizado()) {
            avisarRenovacion(); throw fallo("GOOGLE_NO_AUTORIZADO");
        }
        const autorizacion = revisionAutorizacion;
        const respuesta = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store",
            redirect: verificada ? "error" : "follow",
            signal
        });
        if (!autorizado() || autorizacion !== revisionAutorizacion) throw fallo("GOOGLE_NO_AUTORIZADO");
        if (respuesta.status === 401) {
            avisarRenovacion(); throw fallo("GOOGLE_NO_AUTORIZADO");
        }
        if (respuesta.status === 403) throw fallo("GOOGLE_ACCESO_DENEGADO");
        if (!respuesta.ok) throw fallo("GOOGLE_ERROR");
        return respuesta;
    }

    async function obtenerMetadata({ verificada = false, signal } = {}) {
        const fields = encodeURIComponent("id,name,mimeType,modifiedTime,size,version,md5Checksum,sha256Checksum,capabilities(canDownload),trashed");
        const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(FILE_ID)}?fields=${fields}&supportsAllDrives=true`;
        let data;
        if (conexionServidor) data = await consultarServidor("metadata", undefined, signal);
        else {
            const respuesta = await driveFetch(url, signal, verificada);
            data = verificada ? await root.HAIKU_LIBRO_FUENTE_OFICIAL_V1.leerJSON(respuesta, signal) : await respuesta.json();
        }
        if (String(data?.id || "") !== FILE_ID || data?.mimeType !== MIME_XLSX) throw fallo("FUENTE_INVALIDA");
        if (data?.capabilities?.canDownload === false) throw fallo("GOOGLE_ACCESO_DENEGADO");
        return data;
    }

    async function descargar(metadata, { verificada = false, signal } = {}) {
        const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(FILE_ID)}?alt=media&supportsAllDrives=true`;
        let buffer;
        if (conexionServidor) {
            const archivo = await consultarServidor("descargar", metadata.version, signal);
            if (!(archivo instanceof Blob) || archivo.size > root.HAIKU_LIBRO_FUENTE_OFICIAL_V1.MAX_BYTES)
                throw fallo("FUENTE_INVALIDA");
            buffer = await archivo.arrayBuffer();
        } else {
            const respuesta = await driveFetch(url, signal, verificada);
            buffer = verificada ? await root.HAIKU_LIBRO_FUENTE_OFICIAL_V1.leerBytes(respuesta, undefined, signal) : await respuesta.arrayBuffer();
        }
        if (!buffer.byteLength) throw fallo("FUENTE_INVALIDA");
        const nombreBase = String(metadata?.name || "Libro de reservas actual 2025.xlsx");
        const nombre = /\.xlsx$/i.test(nombreBase) ? nombreBase : `${nombreBase}.xlsx`;
        return new File([buffer], nombre, { type: MIME_XLSX, lastModified: Date.parse(metadata?.modifiedTime || "") || Date.now() });
    }

    async function entregarAlLibro(archivo, lectorEsperado) {
        const lector = root.HAIKU_LIBRO_RESERVA_V1;
        if (lectorEsperado && lector !== lectorEsperado) throw fallo("FUENTE_CAMBIADA");
        if (lectorEsperado) {
            if (typeof lector?.cargarDesdeGoogleParaVerificacion !== "function") throw fallo("LECTOR_NO_CONFIRMADO");
            await lector.cargarDesdeGoogleParaVerificacion(archivo);
            if (!lector.estado?.().cargado) throw fallo("LECTOR_NO_CONFIRMADO");
            return;
        }
        if (typeof lector?.cargarDesdeGoogle === "function") {
            await lector.cargarDesdeGoogle(archivo);
            if (!lector.estado?.().cargado) throw fallo("LECTOR_NO_CONFIRMADO");
            return;
        }

        const entrada = $("libro-reserva-archivo");
        if (!entrada || typeof DataTransfer !== "function") throw fallo("LECTOR_NO_CONFIRMADO");
        const dt = new DataTransfer();
        dt.items.add(archivo);
        entrada.files = dt.files;
        entrada.dispatchEvent(new Event("change", { bubbles: true }));
        await lector?.listo?.();
        if (!lector?.estado?.().cargado) throw fallo("LECTOR_NO_CONFIRMADO");
    }

    function libroLocalCargado() {
        try {
            return root.HAIKU_LIBRO_RESERVA_V1?.estado?.().cargado === true;
        } catch (_) {
            return false;
        }
    }

    async function sincronizar(forzar = false) {
        if (sincronizando || (!conexionServidor && !accessToken)) return;
        if (!autorizado()) { avisarRenovacion(); return; }
        if (fuenteControl?.enCurso()) {
            if (!forzar) return;
            fuenteControl.invalidar();
        }
        sincronizando = true;
        ultimaComprobacion = Date.now();
        const autorizacionInforme = revisionAutorizacion;
        const comprobarInforme = () => {
            if (!autorizado() || autorizacionInforme !== revisionAutorizacion) throw fallo("SOLICITUD_OBSOLETA");
        };
        const abort = typeof root.AbortController === "function" ? new root.AbortController() : null;
        comprobacionAbort = abort;
        const timeout = abort ? setTimeout(() => abort.abort(), 30_000) : null;
        pintar("trabajando", "Libro online", "Comprobando Google Drive…");
        try {
            await root.HAIKU_LIBRO_RESERVA_V1?.listo?.();
            comprobarInforme();
            if (abort?.signal.aborted) throw fallo("GOOGLE_ERROR");
            const metadata = await obtenerMetadata({ signal: abort?.signal });
            comprobarInforme();
            const verificadaVigente = fuenteControl?.observarMetadata(metadata) === true;
            const previa = metadataActual;
            let anterior = modifiedMemoria;
            if (!informeReadonly && !anterior) {
                try { anterior = localStorage.getItem(MODIFIED_KEY) || ""; } catch (_) {}
            }
            const cambio = Boolean(metadata.modifiedTime) && metadata.modifiedTime !== anterior ||
                Boolean(previa && ["version", "md5Checksum", "sha256Checksum", "size"].some(k => metadata[k] !== previa[k]));
            const necesitaArchivo = !libroLocalCargado();
            const huellaLocal = root.HAIKU_LIBRO_RESERVA_V1?.estado?.().version;
            const mismaHuella = typeof metadata.sha256Checksum === "string" && /^[a-f0-9]{64}$/i.test(metadata.sha256Checksum) &&
                metadata.sha256Checksum.toLowerCase() === huellaLocal;
            // Después de F5 la fecha guardada sola no prueba que la copia sea la de Google.
            // Si Drive no ofrece SHA-256, descargar: el lector evita avisos por bytes idénticos.
            const comprobarCopiaRestaurada = !previa && !mismaHuella;
            const descargarCopia = forzar || (!verificadaVigente && (cambio || comprobarCopiaRestaurada)) || necesitaArchivo;

            if (descargarCopia) {
                fuenteControl?.invalidar();
                pintar("trabajando", "Libro online", cambio && anterior ? "Nueva versión detectada. Actualizando…" : "Descargando versión oficial…");
                const archivo = await descargar(metadata, { signal: abort?.signal });
                comprobarInforme(); // El body puede terminar después del logout, aunque los headers fueran válidos.
                if (abort?.signal.aborted) throw fallo("GOOGLE_ERROR");
                await entregarAlLibro(archivo);
                comprobarInforme();
                if (metadata.modifiedTime) {
                    modifiedMemoria = metadata.modifiedTime;
                    if (!informeReadonly) {
                        try { localStorage.setItem(MODIFIED_KEY, metadata.modifiedTime); } catch (_) {}
                    }
                }
            }

            metadataActual = metadata;
            ultimaComprobacionCorrecta = Date.now();
            pintar(
                "ok",
                "Libro online conectado",
                descargarCopia
                    ? `Copia local actualizada desde Google · ${horaChile(metadata.modifiedTime)}${metadata.name ? ` · ${metadata.name}` : ""}`
                    : `Google sin cambios · ${horaChile(metadata.modifiedTime)} · copia local no comparada`
            );
        } catch (error) {
            if (autorizacionInforme !== revisionAutorizacion) return;
            fuenteControl?.invalidar();
            pintar("error", "Libro online", error instanceof root.HAIKU_LIBRO_FUENTE_OFICIAL_V1.FuenteOficialError
                ? error.message : "No fue posible consultar Google Drive. Vuelve a intentarlo.");
        } finally {
            if (timeout) clearTimeout(timeout);
            if (comprobacionAbort === abort) comprobacionAbort = null;
            sincronizando = false;
            const caja = $("haiku-libro-google");
            if (caja) pintar(caja.dataset.estado, $("haiku-libro-google-titulo")?.textContent,
                $("haiku-libro-google-detalle")?.textContent);
            const btn = $("haiku-libro-google-sincronizar");
            if (btn) btn.disabled = !autorizado();
        }
    }

    function iniciarPolling() {
        detenerPolling();
        timer = setInterval(() => {
            if (document.visibilityState === "visible") void sincronizar(false);
        }, POLL_MS);
    }

    function detenerPolling() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    async function conectar() {
        servidorPausado = false;
        const usuario = usuarioActual(), revision = revisionAutorizacion;
        try { if (await conectarServidor()) return; }
        catch (error) { pintar("error", "Libro online", error.message); return; }
        if (revision !== revisionAutorizacion || usuario !== usuarioActual()) return;
        if (!CLIENT_ID) {
            pintar("error", "Libro online", "Falta configurar una vez el acceso Google de solo lectura.");
            return;
        }
        pintar("trabajando", "Libro online", "Esperando autorización de Google…");
        try {
            const autorizacion = await solicitarToken();
            if (!autorizado() || autorizacion !== revisionAutorizacion) return;
            pintar("ok", "Libro online conectado", "Acceso concedido en modo solo lectura.");
            iniciarPolling();
            await sincronizar(false);
        } catch (error) {
            if (error?.code === "SOLICITUD_OBSOLETA") return;
            perderAutorizacion();
            pintar("error", "Libro online", "No fue posible autorizar Google. Vuelve a conectar explícitamente.");
        }
    }

    function desconectar({ revocar = true } = {}) {
        servidorPausado = true;
        detenerPolling();
        const token = accessToken;
        perderAutorizacion();
        metadataActual = null;
        if (revocar && token && root.google?.accounts?.oauth2?.revoke) {
            try { root.google.accounts.oauth2.revoke(token, () => {}); } catch (_) {}
        }
        pintar("neutral", "Libro online", "Desconectado. La copia local del Libro se conserva.");
    }

    function instalar() {
        construirUI();
        if (!CLIENT_ID) {
            pintar("neutral", "Libro online", "Preparado · falta configurar el acceso Google de solo lectura.");
        } else {
            pintar("neutral", "Libro online", "Listo para conectar con Google.");
        }
        function alVolver() {
            if (document.visibilityState === "visible" && (conexionServidor || accessToken) && Date.now() - ultimaComprobacion >= 3000) void sincronizar(false);
            else if (document.visibilityState === "visible" && !autorizado() && servidorDisponible() && !servidorPausado) void restaurarSesion();
        }
        document.addEventListener("visibilitychange", alVolver);
        root.addEventListener("focus", alVolver);
        root.addEventListener("online", alVolver);
        root.addEventListener("pageshow", alVolver);
        root.addEventListener("haiku:auth-ready", () => {
            instalarSesion();
            if (usuarioAutorizado && usuarioAutorizado !== usuarioActual()) perderAutorizacion();
            void restaurarSesion();
        });
        document.addEventListener("haiku:supabase-ready", instalarSesion);
        instalarSesion();
        void restaurarSesion();
        root.addEventListener("haiku:libro-vista-actualizada", evento => {
            if ((!conexionServidor && !accessToken) || evento.detail?.origen === "google") return;
            pintar("neutral", "Libro online conectado", evento.detail?.cargado
                ? "Copia local cargada; no verificada frente a Google."
                : "Sin copia local; Google puede volver a descargarla.");
        });
    }

    root.HAIKU_LIBRO_GOOGLE_V1 = Object.freeze({
        version: "1.3.0",
        modo: "google-drive-readonly",
        fileId: FILE_ID,
        scope: DRIVE_SCOPE,
        conectar,
        desconectar,
        sincronizar: () => sincronizar(true),
        obtenerFuenteVerificada: async () => {
            if (sincronizando) throw fallo("FUENTE_OCUPADA");
            return controladorFuente().obtener();
        },
        fuenteVerificada: handle => controladorFuente().fuente(handle),
        verificarVigencia: handle => controladorFuente().verificarVigencia(handle),
        estado: () => ({
            conectado: autorizado(),
            conexion: conexionServidor ? "servidor-enlace" : "google-personal",
            sincronizando,
            metadata: metadataActual ? { ...metadataActual } : null,
            archivoLocalCargado: libroLocalCargado()
        })
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", instalar, { once: true });
    } else {
        instalar();
    }
})(window);
