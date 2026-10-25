import { createHandler } from "./handler.ts";

// Secrets configured once in Supabase; no Google credential reaches the browser.
Deno.serve(createHandler({
  supabaseKey: Deno.env.get("SUPABASE_ANON_KEY") || "",
  driveApiKey: Deno.env.get("HAKU_LIBRO_DRIVE_API_KEY") || undefined,
  resourceKey: Deno.env.get("HAKU_LIBRO_DRIVE_RESOURCE_KEY") || undefined,
}));
