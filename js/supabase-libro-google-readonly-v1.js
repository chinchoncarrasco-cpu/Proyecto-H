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
    const POLL_MS = 60_000;
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

    function fallo(code) {
        return new root.HAIKU_LIBRO_FUENTE_OFICIAL_V1.FuenteOficialError(code);
    }

    function autorizado() {
        return Boolean(accessToken) && tokenExpiraEn > Date.now();
    }

    function perderAutorizacion() {
        accessToken = ""; tokenExpiraEn = 0; revisionAutorizacion++;
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

        const conectado = Boolean(accessToken);
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
            : (estado === "error" ? detalle || "Revisa la conexión con Google" : "Cada 60 s; descarga si Google cambia");
        const conectarBtn = $("haiku-libro-google-conectar");
        const syncBtn = $("haiku-libro-google-sincronizar");
        const desconectarBtn = $("haiku-libro-google-desconectar");
        if (conectarBtn) conectarBtn.hidden = conectado;
        if (syncBtn) syncBtn.disabled = !conectado || sincronizando;
        if (desconectarBtn) desconectarBtn.hidden = !conectado;
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
                timerAutorizacion = setTimeout(() => {
                    perderAutorizacion(); pintar("neutral", "Libro online", "La sesión de Google expiró. Vuelve a conectar.");
                }, tokenExpiraEn - Date.now());
                resolve(revisionAutorizacion);
            };
            cliente.requestAccessToken();
        });
    }

    async function driveFetch(url, signal, verificada = false) {
        if (!autorizado()) {
            perderAutorizacion(); throw fallo("GOOGLE_NO_AUTORIZADO");
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
            perderAutorizacion(); throw fallo("GOOGLE_NO_AUTORIZADO");
        }
        if (respuesta.status === 403) throw fallo("GOOGLE_ACCESO_DENEGADO");
        if (!respuesta.ok) throw fallo("GOOGLE_ERROR");
        return respuesta;
    }

    async function obtenerMetadata({ verificada = false, signal } = {}) {
        const fields = encodeURIComponent("id,name,mimeType,modifiedTime,size,version,md5Checksum,sha256Checksum,capabilities(canDownload),trashed");
        const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(FILE_ID)}?fields=${fields}&supportsAllDrives=true`;
        const respuesta = await driveFetch(url, signal, verificada);
        const data = verificada ? await root.HAIKU_LIBRO_FUENTE_OFICIAL_V1.leerJSON(respuesta, signal) : await respuesta.json();
        if (String(data?.id || "") !== FILE_ID || data?.mimeType !== MIME_XLSX) throw fallo("FUENTE_INVALIDA");
        if (data?.capabilities?.canDownload === false) throw fallo("GOOGLE_ACCESO_DENEGADO");
        return data;
    }

    async function descargar(metadata, { verificada = false, signal } = {}) {
        const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(FILE_ID)}?alt=media&supportsAllDrives=true`;
        const respuesta = await driveFetch(url, signal, verificada);
        const buffer = verificada ? await root.HAIKU_LIBRO_FUENTE_OFICIAL_V1.leerBytes(respuesta, undefined, signal) : await respuesta.arrayBuffer();
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
        if (sincronizando || !accessToken) return;
        if (fuenteControl?.enCurso()) {
            if (!forzar) return;
            fuenteControl.invalidar();
        }
        sincronizando = true;
        const autorizacionInforme = revisionAutorizacion;
        const comprobarInforme = () => {
            if (informeReadonly && (!autorizado() || autorizacionInforme !== revisionAutorizacion)) throw fallo("SOLICITUD_OBSOLETA");
        };
        pintar("trabajando", "Libro online", "Comprobando Google Drive…");
        try {
            const metadata = await obtenerMetadata();
            comprobarInforme();
            const verificadaVigente = fuenteControl?.observarMetadata(metadata) === true;
            metadataActual = metadata;
            const anterior = informeReadonly ? modifiedMemoria : localStorage.getItem(MODIFIED_KEY) || "";
            const cambio = Boolean(metadata.modifiedTime) && metadata.modifiedTime !== anterior;
            const necesitaArchivo = !libroLocalCargado();
            const descargarCopia = forzar || (!verificadaVigente && cambio) || necesitaArchivo;

            if (descargarCopia) {
                fuenteControl?.invalidar();
                pintar("trabajando", "Libro online", cambio && anterior ? "Nueva versión detectada. Actualizando…" : "Descargando versión oficial…");
                const archivo = await descargar(metadata);
                comprobarInforme(); // El body puede terminar después del logout, aunque los headers fueran válidos.
                await entregarAlLibro(archivo);
                comprobarInforme();
                if (metadata.modifiedTime) {
                    if (informeReadonly) modifiedMemoria = metadata.modifiedTime;
                    else localStorage.setItem(MODIFIED_KEY, metadata.modifiedTime);
                }
            }

            pintar(
                "ok",
                "Libro online conectado",
                descargarCopia
                    ? `Copia local actualizada desde Google · ${horaChile(metadata.modifiedTime)}${metadata.name ? ` · ${metadata.name}` : ""}`
                    : `Google sin cambios · ${horaChile(metadata.modifiedTime)} · copia local no comparada`
            );
        } catch (error) {
            if (informeReadonly && autorizacionInforme !== revisionAutorizacion) return;
            fuenteControl?.invalidar();
            pintar("error", "Libro online", error instanceof root.HAIKU_LIBRO_FUENTE_OFICIAL_V1.FuenteOficialError
                ? error.message : "No fue posible consultar Google Drive. Vuelve a intentarlo.");
        } finally {
            sincronizando = false;
            const caja = $("haiku-libro-google");
            if (caja) pintar(caja.dataset.estado, $("haiku-libro-google-titulo")?.textContent,
                $("haiku-libro-google-detalle")?.textContent);
            const btn = $("haiku-libro-google-sincronizar");
            if (btn) btn.disabled = !accessToken;
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

    function desconectar() {
        detenerPolling();
        const token = accessToken;
        perderAutorizacion();
        metadataActual = null;
        if (token && root.google?.accounts?.oauth2?.revoke) {
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
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && accessToken) void sincronizar(false);
        });
        root.addEventListener("haiku:libro-vista-actualizada", evento => {
            if (!accessToken || evento.detail?.origen === "google") return;
            pintar("neutral", "Libro online conectado", evento.detail?.cargado
                ? "Copia local cargada; no verificada frente a Google."
                : "Sin copia local; Google puede volver a descargarla.");
        });
    }

    root.HAIKU_LIBRO_GOOGLE_V1 = Object.freeze({
        version: "1.1.0",
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
            conectado: Boolean(accessToken),
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
