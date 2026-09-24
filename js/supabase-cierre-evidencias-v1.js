// ========================================
// HAIKU · CIERRE · EVIDENCIAS SUPABASE V1
// Mantiene la UI legacy, pero persiste archivos en Storage.
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    const BUCKET = "haiku-evidencias";
    const TIPO_TURNO = "cierre_diario";

    const guardarLegacy = window.guardarEvidencia;
    const obtenerLegacy = window.obtenerEvidencia;

    function fechaOperativa(fecha) {
        return String(fecha || "").slice(0, 10);
    }

    function nombreSeguro(nombre) {
        return String(nombre || "evidencia")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "") || "evidencia";
    }

    function extensionMime(mime) {
        const mapa = {
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "image/heic": "heic",
            "image/heif": "heif"
        };
        return mapa[mime] || "jpg";
    }

    async function usuarioActual() {
        const { data, error } = await cliente.auth.getUser();
        if (error) throw error;
        if (!data?.user?.id) throw new Error("No hay usuario autenticado.");
        return data.user;
    }

    async function asegurarCierre(fecha) {
        const fechaOk = fechaOperativa(fecha);
        if (!fechaOk) throw new Error("Fecha operativa inválida.");

        const { data, error } = await cliente.rpc(
            "haiku_asegurar_cierre_dia",
            {
                p_fecha: fechaOk,
                p_tipo_turno: TIPO_TURNO
            }
        );

        if (error) throw error;
        if (!data?.cierre_id) throw new Error("Supabase no devolvió cierre_id.");
        return data;
    }

    async function dataUrlABlob(dataUrl) {
        if (dataUrl instanceof Blob) return dataUrl;
        if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
            throw new Error("Formato de evidencia no compatible.");
        }

        const respuesta = await fetch(dataUrl);
        return respuesta.blob();
    }

    async function guardarEvidenciaSupabase(fecha, nombre, imagen) {
        const fechaOk = fechaOperativa(fecha);
        const nombreOk = nombreSeguro(nombre);

        try {
            const [usuario, cierre] = await Promise.all([
                usuarioActual(),
                asegurarCierre(fechaOk)
            ]);

            const blob = await dataUrlABlob(imagen);
            const mime = blob.type || "image/jpeg";
            const extension = extensionMime(mime);
            const marcaTiempo = Date.now();

            const path = [
                usuario.id,
                "cierres",
                fechaOk,
                cierre.cierre_id,
                `${nombreOk}-${marcaTiempo}.${extension}`
            ].join("/");

            const { error: errorStorage } = await cliente
                .storage
                .from(BUCKET)
                .upload(path, blob, {
                    contentType: mime,
                    upsert: false,
                    cacheControl: "3600"
                });

            if (errorStorage) throw errorStorage;

            const { error: errorMeta } = await cliente
                .from("evidencias")
                .insert({
                    cierre_id: cierre.cierre_id,
                    storage_bucket: BUCKET,
                    storage_path: path,
                    mime_type: mime,
                    tamano_bytes: blob.size,
                    descripcion: `cierre:${nombreOk}`,
                    subido_por: usuario.id
                });

            if (errorMeta) {
                // No dejamos archivo huérfano si falla la metadata.
                try {
                    await cliente.storage.from(BUCKET).remove([path]);
                } catch {}
                throw errorMeta;
            }

            console.info(
                "HAIKU · Evidencia de cierre guardada en Supabase:",
                fechaOk,
                nombreOk,
                path
            );

            return path;
        } catch (error) {
            console.error(
                "HAIKU · No fue posible guardar evidencia en Supabase:",
                error
            );

            // Respaldo temporal legacy para no perder la imagen del usuario.
            if (typeof guardarLegacy === "function") {
                try {
                    await guardarLegacy(fecha, nombre, imagen);
                } catch {}
            }

            alert(
                "La evidencia no pudo subir a Supabase. " +
                "Se intentó conservar temporalmente en este dispositivo."
            );

            throw error;
        }
    }

    async function obtenerEvidenciaSupabase(fecha, nombre) {
        const fechaOk = fechaOperativa(fecha);
        const nombreOk = nombreSeguro(nombre);

        try {
            const cierre = await asegurarCierre(fechaOk);

            const { data, error } = await cliente
                .from("evidencias")
                .select("storage_path,creado_en")
                .eq("cierre_id", cierre.cierre_id)
                .eq("descripcion", `cierre:${nombreOk}`)
                .order("creado_en", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) throw error;

            if (data?.storage_path) {
                const { data: firma, error: errorFirma } = await cliente
                    .storage
                    .from(BUCKET)
                    .createSignedUrl(data.storage_path, 3600);

                if (errorFirma) throw errorFirma;
                if (firma?.signedUrl) return firma.signedUrl;
            }
        } catch (error) {
            console.error(
                "HAIKU · No fue posible recuperar evidencia desde Supabase:",
                error
            );
        }

        // Compatibilidad con evidencia histórica que sólo vive en IndexedDB.
        if (typeof obtenerLegacy === "function") {
            try {
                return await obtenerLegacy(fecha, nombre);
            } catch {}
        }

        return null;
    }

    // Proyección de sólo lectura para la franja Sites: cada subida conserva
    // su fila, aunque el preview legacy muestre únicamente la más reciente.
    async function listarEvidenciasSupabase(fecha, nombre) {
        const cierre = await asegurarCierre(fechaOperativa(fecha));
        const { data, error } = await cliente
            .from("evidencias")
            .select("storage_path,creado_en")
            .eq("cierre_id", cierre.cierre_id)
            .eq("descripcion", `cierre:${nombreSeguro(nombre)}`)
            .order("creado_en", { ascending: false });
        if (error) throw error;
        const archivos = (data || []).filter(item => item.storage_path);
        return Promise.all(archivos.map(async item => {
            const { data: firma, error: errorFirma } = await cliente
                .storage.from(BUCKET).createSignedUrl(item.storage_path, 3600);
            if (errorFirma) throw errorFirma;
            return { url: firma?.signedUrl || "", creado_en: item.creado_en };
        }));
    }

    // Sobrescribimos las funciones globales que ya usa cierre.js.
    window.guardarEvidencia = guardarEvidenciaSupabase;
    window.obtenerEvidencia = obtenerEvidenciaSupabase;
    window.HAIKU_CIERRE_EVIDENCIAS_V1 = Object.freeze({ listar: listarEvidenciasSupabase });

    console.info("HAIKU · Evidencias de Cierre Supabase V1 preparadas.");
})();
