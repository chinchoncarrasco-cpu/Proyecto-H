
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
    async function photo(profile, target, image) {
        let path = null;
        if (image) {
            const {data, error} = await client.auth.getUser();
            if (error || !data.user) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
            path = data.user.id + "/" + crypto.randomUUID() + ".jpg";
            const uploaded = await bucket.upload(path, image, {contentType:"image/jpeg", upsert:false});
            if (uploaded.error) throw new Error("No se pudo subir la foto. Se conservó la anterior.");
        }
        const result = await rpc("guardar", {
            p_id:profile.persona.id, p_reserva:profile.visita?.reserva_id ?? null,
            p_accion:"foto", p_datos:{clase:target.kind, id:target.id, ruta:path, esperada:target.path ?? null}
        });
        if (result.anterior && result.anterior !== path) await bucket.remove([result.anterior]).catch(() => {});
        return result;
    }
    window.HAIKU_HUESPEDES_API = Object.freeze({rpc, signed, photo});
})();
