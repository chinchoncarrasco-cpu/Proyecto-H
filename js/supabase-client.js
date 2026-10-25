// ========================================
// HAIKU · CLIENTE SUPABASE
// ========================================

(() => {
    "use strict";

    const SUPABASE_URL =
        "https://zqfegylkylxsuoejomow.supabase.co";

    // Publishable key: está diseñada para usarse en navegador.
    // La seguridad real la aplican Auth + RLS en PostgreSQL.
    const SUPABASE_PUBLISHABLE_KEY =
        "sb_publishable_H3q5YA1dXrMQIQEOQNW8Uw_nVNC6sTG";

    if (
        !window.supabase ||
        typeof window.supabase.createClient !== "function"
    ) {
        console.error(
            "HAIKU · No fue posible cargar supabase-js."
        );
        return;
    }

    const cliente = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY,
        {
            db: {
                schema: "public"
            },
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storageKey: "haiku-supabase-auth"
            }
        }
    );

    window.haikuSupabase = cliente;

    window.HAIKU_SUPABASE_CONFIG = Object.freeze({
        url: SUPABASE_URL,
        conectado: true,
        // Activar sólo después de comprobar la clave y el Libro real en el servidor.
        libroConexionServidor: false
    });

    document.dispatchEvent(
        new CustomEvent("haiku:supabase-ready")
    );
})();
