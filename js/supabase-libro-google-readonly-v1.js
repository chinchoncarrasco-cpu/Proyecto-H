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
    const CLIENT_ID = "197003685258-9ui24grgj560t2itpknbmcva0rip8129.apps.googleusercontent.com";

    let accessToken = "";
    let tokenExpiraEn = 0;
    let tokenClient = null;
    let gisPromise = null;
    let timer = null;
    let sincronizando = false;
    let metadataActual = null;

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
        return new Promise(async (resolve, reject) => {
            let cliente;
            try {
                cliente = await prepararCliente();
            } catch (error) {
                reject(error);
                return;
            }
            cliente.callback = respuesta => {
                if (respuesta?.error) {
                    reject(new Error(respuesta.error_description || respuesta.error));
                    return;
                }
                accessToken = String(respuesta?.access_token || "");
                const segundos = Number(respuesta?.expires_in || 0);
                tokenExpiraEn = Date.now() + Math.max(0, segundos - 60) * 1000;
                if (!accessToken) {
                    reject(new Error("Google no devolvió un token de lectura."));
                    return;
                }
                resolve(accessToken);
            };
            cliente.requestAccessToken();
        });
    }

    async function driveFetch(url) {
        if (!accessToken || (tokenExpiraEn && Date.now() >= tokenExpiraEn)) {
            accessToken = "";
            tokenExpiraEn = 0;
            detenerPolling();
            throw new Error("La sesión de Google expiró. Vuelve a conectar.");
        }
        const respuesta = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store"
        });
        if (respuesta.status === 401) {
            accessToken = "";
            tokenExpiraEn = 0;
            detenerPolling();
            throw new Error("La sesión de Google expiró. Vuelve a conectar.");
        }
        if (respuesta.status === 403) throw new Error("Esta cuenta no tiene permiso de lectura sobre el Libro oficial.");
        if (!respuesta.ok) throw new Error(`Google Drive respondió ${respuesta.status}.`);
        return respuesta;
    }

    async function obtenerMetadata() {
        const fields = encodeURIComponent("id,name,mimeType,modifiedTime,size,md5Checksum,capabilities(canDownload)");
        const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(FILE_ID)}?fields=${fields}&supportsAllDrives=true`;
        const respuesta = await driveFetch(url);
        const data = await respuesta.json();
        if (String(data?.id || "") !== FILE_ID) throw new Error("Google devolvió un archivo distinto al Libro configurado.");
        if (data?.mimeType !== MIME_XLSX) throw new Error("El archivo configurado ya no es un XLSX compatible.");
        if (data?.capabilities?.canDownload === false) throw new Error("Google no permite descargar este archivo con la cuenta conectada.");
        return data;
    }

    async function descargar(metadata) {
        const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(FILE_ID)}?alt=media&supportsAllDrives=true`;
        const respuesta = await driveFetch(url);
        const buffer = await respuesta.arrayBuffer();
        if (!buffer.byteLength) throw new Error("Google devolvió un archivo vacío.");
        const nombreBase = String(metadata?.name || "Libro de reservas actual 2025.xlsx");
        const nombre = /\.xlsx$/i.test(nombreBase) ? nombreBase : `${nombreBase}.xlsx`;
        return new File([buffer], nombre, { type: MIME_XLSX, lastModified: Date.parse(metadata?.modifiedTime || "") || Date.now() });
    }

    async function entregarAlLibro(archivo) {
        const entrada = $("libro-reserva-archivo");
        if (!entrada) throw new Error("No encontré el cargador del Libro de Reserva.");
        if (typeof DataTransfer !== "function") throw new Error("Este navegador no permite entregar el XLSX al lector local.");
        const dt = new DataTransfer();
        dt.items.add(archivo);
        entrada.files = dt.files;
        entrada.dispatchEvent(new Event("change", { bubbles: true }));
        await root.HAIKU_LIBRO_RESERVA_V1?.listo?.();
        if (!root.HAIKU_LIBRO_RESERVA_V1?.estado?.().cargado) throw new Error("El lector local no confirmó la carga del Libro.");
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
        sincronizando = true;
        pintar("trabajando", "Libro online", "Comprobando Google Drive…");
        try {
            const metadata = await obtenerMetadata();
            metadataActual = metadata;
            const anterior = localStorage.getItem(MODIFIED_KEY) || "";
            const cambio = Boolean(metadata.modifiedTime) && metadata.modifiedTime !== anterior;
            const necesitaArchivo = !libroLocalCargado();

            if (forzar || cambio || necesitaArchivo) {
                pintar("trabajando", "Libro online", cambio && anterior ? "Nueva versión detectada. Actualizando…" : "Descargando versión oficial…");
                const archivo = await descargar(metadata);
                await entregarAlLibro(archivo);
                if (metadata.modifiedTime) localStorage.setItem(MODIFIED_KEY, metadata.modifiedTime);
            }

            pintar(
                "ok",
                "Libro online conectado",
                `Actualizado · ${horaChile(metadata.modifiedTime)}${metadata.name ? ` · ${metadata.name}` : ""}`
            );
        } catch (error) {
            console.error("HAIKU · Libro Google solo lectura:", error);
            pintar("error", "Libro online", error?.message || "No fue posible consultar Google Drive.");
        } finally {
            sincronizando = false;
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
            await solicitarToken();
            pintar("ok", "Libro online conectado", "Acceso concedido en modo solo lectura.");
            iniciarPolling();
            await sincronizar(false);
        } catch (error) {
            console.error("HAIKU · Conexión Google:", error);
            accessToken = "";
            tokenExpiraEn = 0;
            detenerPolling();
            pintar("error", "Libro online", error?.message || "No fue posible conectar Google.");
        }
    }

    function desconectar() {
        detenerPolling();
        const token = accessToken;
        accessToken = "";
        tokenExpiraEn = 0;
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
    }

    root.HAIKU_LIBRO_GOOGLE_V1 = Object.freeze({
        version: "1.0.1",
        modo: "google-drive-readonly",
        fileId: FILE_ID,
        scope: DRIVE_SCOPE,
        conectar,
        desconectar,
        sincronizar: () => sincronizar(true),
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
