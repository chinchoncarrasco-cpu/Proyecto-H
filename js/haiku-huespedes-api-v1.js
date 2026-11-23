
(() => {
    "use strict";
    const client = window.haikuSupabase;
    if (!client) return;
    const bucket = client.storage.from("haiku-huespedes");
    async function rpc(name, params) {
        const {data, error} = await client.rpc("haiku_huesped_" + name + "_v1", params);
        if (error) throw error;
        return data;
    }
    async function signed(path) {
        if (!path) return null;
        const {data, error} = await bucket.createSignedUrl(path, 900);
        if (error) throw error;
        return data.signedUrl;
    }
    async function uploadPhoto(image) {
        const {data, error} = await client.auth.getUser();
        if (error || !data.user) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
        const path = data.user.id + "/" + crypto.randomUUID() + ".jpg";
        const uploaded = await bucket.upload(path, image, {contentType:"image/jpeg", upsert:false});
        if (uploaded.error) throw new Error("No se pudo subir la foto. Se conservó la anterior.");
        return path;
    }
    async function removePhotos(paths) {
        if (paths.length) await bucket.remove(paths).catch(() => {});
    }
    async function photo(profile, target, image) {
        const path = image ? await uploadPhoto(image) : null;
        const result = await rpc("guardar", {
            p_id:profile.persona.id, p_reserva:profile.visita?.reserva_id ?? null,
            p_accion:"foto", p_datos:{clase:target.kind, id:target.id, ruta:path, esperada:target.path ?? null}
        });
        if (result.anterior && result.anterior !== path) await removePhotos([result.anterior]);
        return result;
    }

    async function vehiclePhotos(save, {primary, positionY, additional, expected}) {
        const staged = [];
        async function stage(photo) {
            if (!photo || typeof photo === "string") return photo;
            const path = await uploadPhoto(photo);
            staged.push(path);
            return path;
        }
        let principal, adicionales;
        try {
            principal = await stage(primary);
            adicionales = [];
            for (const photo of additional) adicionales.push(await stage(photo));
        } catch (error) {
            await removePhotos(staged);
            throw error;
        }
        let result;
        try {
            result = await save({principal, posicion_y:positionY, adicionales, esperadas:expected});
        } catch (error) {
            // Un fallo de conexión puede ocurrir después de que el servidor guardó.
            if (/^[0-9A-Z]{5}$/.test(error?.code || "")) await removePhotos(staged);
            throw error;
        }
        if (!result?.fotos_guardadas) {
            await removePhotos(staged);
            throw new Error("La galería requiere actualizar el servidor.");
        }
        await removePhotos(result.fotos_retiradas || []);
        return result;
    }
    window.HAIKU_HUESPEDES_API = Object.freeze({rpc, signed, photo, vehiclePhotos});
})();
