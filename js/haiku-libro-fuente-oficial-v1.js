// Fuente Web oficial: capacidades internas, integridad y vigencia. Sin OAuth ni UI.
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.HAIKU_LIBRO_FUENTE_OFICIAL_V1 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const MAX_BYTES = 8 * 1024 * 1024;
    const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const mensajes = Object.freeze({
        GOOGLE_NO_AUTORIZADO: "Conecta Google explícitamente para verificar el Libro oficial.",
        GOOGLE_ACCESO_DENEGADO: "Esta cuenta no tiene permiso de lectura sobre el Libro oficial.",
        GOOGLE_ERROR: "No fue posible leer Google Drive. Vuelve a intentarlo.",
        GOOGLE_TIMEOUT: "La verificación del Libro excedió su tiempo máximo. Vuelve a intentarlo.",
        FUENTE_OCUPADA: "Espera a que termine la sincronización del Libro y vuelve a intentarlo.",
        FUENTE_INVALIDA: "Google no devolvió un Libro oficial válido y descargable.",
        FUENTE_DEMASIADO_GRANDE: "El Libro supera el límite de lectura de 8 MiB.",
        FUENTE_NO_VERIFICABLE: "Google no entregó un checksum verificable del Libro.",
        CHECKSUM_INVALIDO: "Los bytes del Libro no coinciden con sus checksums de Google.",
        LECTOR_NO_CONFIRMADO: "El lector no confirmó el hash y la generación de esta descarga.",
        FUENTE_CAMBIADA: "La fuente oficial cambió o perdió su procedencia. Verifica el Libro nuevamente.",
        SOLICITUD_OBSOLETA: "Una operación posterior sustituyó esta verificación del Libro."
    });
    class FuenteOficialError extends Error {
        constructor(code) {
            const conocido = Object.hasOwn(mensajes, code) ? code : "FUENTE_INVALIDA";
            super(mensajes[conocido]); this.name = "FuenteOficialError"; this.code = conocido;
        }
    }
    const error = code => new FuenteOficialError(code);
    const seguro = e => e instanceof FuenteOficialError ? e : error("GOOGLE_ERROR");
    function esperar(promesa, signal) {
        if (!signal) return Promise.resolve(promesa);
        return new Promise((resolve, reject) => {
            const abortar = () => reject(seguro(signal.reason));
            if (signal.aborted) { Promise.resolve(promesa).catch(() => {}); abortar(); return; }
            signal.addEventListener("abort", abortar, { once: true });
            Promise.resolve(promesa).then(resolve, reject).finally(() => signal.removeEventListener("abort", abortar));
        });
    }
    async function leerBytes(response, maxBytes = MAX_BYTES, signal) {
        const length = response.headers.get("Content-Length");
        const encoding = response.headers.get("Content-Encoding");
        let reader;
        try {
            if (length !== null && !/^\d+$/.test(length)) throw error("FUENTE_INVALIDA");
            if (length !== null && (!encoding || encoding === "identity") && Number(length) > maxBytes)
                throw error("FUENTE_DEMASIADO_GRANDE");
            if (!response.body?.getReader) throw error("FUENTE_INVALIDA");
            reader = response.body.getReader();
            const chunks = []; let size = 0;
            while (true) {
                const { done, value } = await esperar(reader.read(), signal);
                if (done) break;
                if (!(value instanceof Uint8Array)) throw error("FUENTE_INVALIDA");
                size += value.byteLength;
                if (size > maxBytes) throw error("FUENTE_DEMASIADO_GRANDE");
                chunks.push(value);
            }
            if (!size || length !== null && (!encoding || encoding === "identity") && Number(length) !== size)
                throw error("FUENTE_INVALIDA");
            const bytes = new Uint8Array(size); let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            return bytes;
        } catch (e) {
            if (reader) { try { void reader.cancel().catch(() => {}); } catch (_) {} }
            else { try { void response.body?.cancel().catch(() => {}); } catch (_) {} }
            throw seguro(e);
        } finally { try { reader?.releaseLock(); } catch (_) {} }
    }
    async function leerJSON(response, signal) {
        try {
            return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await leerBytes(response, 32 * 1024, signal)));
        } catch (e) { throw e instanceof FuenteOficialError ? e : error("FUENTE_INVALIDA"); }
    }
    async function sha256(bytes, crypto) {
        try {
            const digest = await crypto.subtle.digest("SHA-256", bytes);
            return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
        } catch (_) { throw error("FUENTE_NO_VERIFICABLE"); }
    }
    // RFC 1321, mismo algoritmo verificado de libroDriveChecksums.ts, sin activar el backend.
    // MD5 sólo verifica el checksum legado de Drive; SHA-256 identifica siempre los bytes.
    function md5Hex(bytes) {
        const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
        const constants = Int32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000));
        const padded = new Uint8Array(Math.ceil((bytes.byteLength + 9) / 64) * 64);
        padded.set(bytes); padded[bytes.byteLength] = 0x80;
        const view = new DataView(padded.buffer);
        view.setUint32(padded.length - 8, bytes.byteLength * 8 >>> 0, true);
        view.setUint32(padded.length - 4, Math.floor(bytes.byteLength / 0x20000000), true);
        const state = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
        for (let offset = 0; offset < padded.length; offset += 64) {
            let [a, b, c, d] = state;
            for (let i = 0; i < 64; i++) {
                const round = i >>> 4;
                const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
                const word = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : 7 * i % 16;
                const sum = a + f + constants[i] + view.getUint32(offset + word * 4, true) | 0;
                const shift = shifts[round * 4 + i % 4];
                const next = b + ((sum << shift) | (sum >>> (32 - shift))) | 0;
                a = d; d = c; c = b; b = next;
            }
            state[0] = state[0] + a | 0; state[1] = state[1] + b | 0;
            state[2] = state[2] + c | 0; state[3] = state[3] + d | 0;
        }
        const digest = new DataView(new ArrayBuffer(16));
        state.forEach((value, i) => digest.setInt32(i * 4, value, true));
        return Array.from(new Uint8Array(digest.buffer), b => b.toString(16).padStart(2, "0")).join("");
    }
    // La configuración es interna al conector Web; no procede de una request ni de Mobile.
    function crearControlador({ fileId, lector, autorizado, obtenerMetadata, descargar, entregar,
        crypto = globalThis.crypto, ahora = Date.now, timeoutMs = 60_000, alInvalidar = () => {} }) {
        const handles = new WeakMap(), operaciones = new Set();
        let revision = 0, actual = null, inicioEntrega = null, entregaEnCurso = null;
        function invalidar(code = "SOLICITUD_OBSOLETA") {
            revision++; actual = null;
            for (const op of operaciones) op.abort(error(code));
            // Señal sin metadata/PII; el observador no puede impedir la invalidación.
            try { alInvalidar(code); } catch (_) {}
        }
        function metadata(data) {
            if (!data || typeof data !== "object" || data.id !== fileId || data.mimeType !== MIME ||
                data.trashed !== false || data.capabilities?.canDownload !== true ||
                typeof data.name !== "string" || !data.name || data.name.length > 512 ||
                typeof data.version !== "string" || !/^[1-9]\d{0,18}$/.test(data.version) || BigInt(data.version) > 9223372036854775807n ||
                typeof data.size !== "string" || !/^[1-9]\d*$/.test(data.size) || !Number.isSafeInteger(Number(data.size)) ||
                typeof data.modifiedTime !== "string" || !Number.isFinite(Date.parse(data.modifiedTime))) throw error("FUENTE_INVALIDA");
            const size = Number(data.size);
            if (size > MAX_BYTES) throw error("FUENTE_DEMASIADO_GRANDE");
            const checksum = (value, digits) => {
                if (value === undefined || value === null) return null;
                if (typeof value !== "string" || !new RegExp("^[a-fA-F0-9]{" + digits + "}$").test(value)) throw error("FUENTE_INVALIDA");
                return value.toLowerCase();
            };
            const md5 = checksum(data.md5Checksum, 32), sha = checksum(data.sha256Checksum, 64);
            if (!md5 && !sha) throw error("FUENTE_NO_VERIFICABLE");
            return Object.freeze({ id: fileId, name: data.name, mimeType: MIME, modifiedTime: data.modifiedTime,
                size, version: data.version, md5Checksum: md5, sha256Checksum: sha, canDownload: true, trashed: false });
        }
        const iguales = (a, b) => Object.keys(a).every(key => a[key] === b[key]);
        function comprobarSolicitud(id, libro) {
            if (!autorizado()) throw error("GOOGLE_NO_AUTORIZADO");
            if (id !== revision) throw error("SOLICITUD_OBSOLETA");
            if (lector() !== libro) throw error("FUENTE_CAMBIADA");
        }
        function comprobarHandle(handle) {
            const sello = handle && typeof handle === "object" ? handles.get(handle) : null;
            if (!sello || sello !== actual) throw error("FUENTE_CAMBIADA");
            try {
                comprobarSolicitud(sello.revision, sello.libro);
                const estado = sello.libro.estado();
                if (estado.cargado !== true || estado.version !== sello.hash || estado.generacion !== sello.generacion)
                    throw error("FUENTE_CAMBIADA");
            } catch (e) { invalidar(); throw seguro(e); }
            return sello;
        }
        async function operacion(tarea) {
            const op = new AbortController(); operaciones.add(op);
            const timer = setTimeout(() => op.abort(error("GOOGLE_TIMEOUT")), timeoutMs);
            try { return await esperar(tarea(op.signal), op.signal); }
            finally { clearTimeout(timer); operaciones.delete(op); }
        }
        async function obtener() {
            invalidar(); const id = revision, libro = lector();
            try {
                return await operacion(async signal => {
                    comprobarSolicitud(id, libro);
                    if (typeof libro?.cargarDesdeGoogleParaVerificacion !== "function" || typeof libro.estado !== "function" || typeof libro.listo !== "function")
                        throw error("LECTOR_NO_CONFIRMADO");
                    const m0 = metadata(await obtenerMetadata(signal)); comprobarSolicitud(id, libro);
                    const archivo = await descargar(m0, signal); comprobarSolicitud(id, libro);
                    const bytes = new Uint8Array(await esperar(archivo.arrayBuffer(), signal));
                    if (!bytes.byteLength || bytes.byteLength !== m0.size || bytes.byteLength > MAX_BYTES) throw error("FUENTE_INVALIDA");
                    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4)
                        throw error("FUENTE_INVALIDA"); // No certificar CSV/otros formatos que SheetJS también puede abrir.
                    const hash = await esperar(sha256(bytes, crypto), signal); comprobarSolicitud(id, libro);
                    if (m0.sha256Checksum && m0.sha256Checksum !== hash || m0.md5Checksum && m0.md5Checksum !== md5Hex(bytes)) throw error("CHECKSUM_INVALIDO");
                    const m1 = metadata(await obtenerMetadata(signal)); comprobarSolicitud(id, libro);
                    if (!iguales(m0, m1)) throw error("FUENTE_CAMBIADA");
                    const anterior = libro.estado().generacion;
                    if (!Number.isSafeInteger(anterior) || anterior < 0) throw error("LECTOR_NO_CONFIRMADO");
                    let carga;
                    inicioEntrega = { id, cambios: 0 };
                    try { carga = entregar(archivo, libro); }
                    finally { inicioEntrega = null; }
                    Promise.resolve(carga).catch(() => {});
                    const generacion = libro.estado().generacion;
                    if (generacion !== anterior + 1) throw error("LECTOR_NO_CONFIRMADO");
                    entregaEnCurso = { id, libro, generacion };
                    try { await esperar(carga, signal); await esperar(libro.listo(), signal); }
                    finally { if (entregaEnCurso?.id === id) entregaEnCurso = null; }
                    comprobarSolicitud(id, libro);
                    const estado = libro.estado();
                    if (estado.cargado !== true || estado.version !== hash || estado.generacion !== generacion) throw error("LECTOR_NO_CONFIRMADO");
                    const sello = { revision: id, libro, generacion, hash, metadata: m1 };
                    const fachada = {};
                    for (const metodo of ["estado", "listo", "listarHojas", "consultarHoja", "consultarHojaMensual"])
                        if (typeof libro[metodo] === "function") fachada[metodo] = (...args) => {
                            comprobarHandle(sello.handle);
                            const confirmar = valor => { comprobarHandle(sello.handle); return valor; };
                            const fallar = e => {
                                if (e instanceof FuenteOficialError) throw e;
                                if (actual === sello) invalidar(); throw error("LECTOR_NO_CONFIRMADO");
                            };
                            try {
                                const salida = libro[metodo](...args);
                                return salida?.then ? Promise.resolve(salida).then(confirmar, fallar) : confirmar(salida);
                            } catch (e) { return fallar(e); }
                        };
                    sello.fuente = Object.freeze({ libro: Object.freeze(fachada), tipo: "google-drive-oficial-verificado", nombre: m0.name,
                        version: hash, generacion, modifiedTime: m0.modifiedTime, verifiedAt: new Date(ahora()).toISOString() });
                    sello.handle = Object.freeze(Object.create(null)); handles.set(sello.handle, sello); actual = sello;
                    comprobarHandle(sello.handle); return sello.handle;
                });
            } catch (e) { if (revision === id) invalidar(); throw seguro(e); }
        }
        async function verificarVigencia(handle) {
            const sello = comprobarHandle(handle);
            try {
                return await operacion(async signal => {
                    const m2 = metadata(await obtenerMetadata(signal));
                    comprobarHandle(handle);
                    if (!iguales(sello.metadata, m2)) throw error("FUENTE_CAMBIADA");
                    return sello.fuente;
                });
            } catch (e) { if (actual === sello) invalidar(); throw seguro(e); }
        }
        return Object.freeze({ obtener, verificarVigencia, fuente: handle => comprobarHandle(handle).fuente, invalidar,
            enCurso: () => operaciones.size > 0,
            cambioLibro: () => {
                if (inicioEntrega && inicioEntrega.id === revision && ++inicioEntrega.cambios === 1) { actual = null; return; }
                invalidar();
            },
            vistaLibro: evento => {
                if (entregaEnCurso?.id === revision && evento?.origen === "google" && evento.cargado === true &&
                    lector() === entregaEnCurso.libro && lector().estado().generacion === entregaEnCurso.generacion) return;
                invalidar();
            },
            observarMetadata: data => {
                if (!actual) return false;
                try { if (iguales(actual.metadata, metadata(data))) { comprobarHandle(actual.handle); return true; } }
                catch (_) { /* No se conserva un sello ante una lectura incompatible. */ }
                invalidar(); return false;
            }
        });
    }
    return Object.freeze({ crearControlador, FuenteOficialError, MAX_BYTES, leerBytes, leerJSON, esperar, sha256, md5Hex });
});
