import { createLibroDriveSource } from "../_shared/libroDriveSource.ts";
import { LibroDriveError, readBounded, readJson } from "../_shared/googleDriveReadonlyCommon.ts";
import type { FetchLike } from "../_shared/googleDriveReadonlyCommon.ts";

export const LIBRO_FILE_ID = "1ZX4KqcdY6LORafrI6NkqwT3hGxrdK2rk";
const PROJECT_URL = "https://zqfegylkylxsuoejomow.supabase.co";
const ORIGIN = "https://chinchoncarrasco-cpu.github.io";
const PERMISSIONS = ["reservas.ver", "pagos.ver", "servicios.ver"];

type Config = { supabaseKey: string; driveApiKey?: string; resourceKey?: string; fetch?: FetchLike };

// No service_role, business writes, arbitrary URL, file selector, token persistence or logs.
export function createHandler(config: Config) {
  const fetcher = config.fetch ?? globalThis.fetch;
  const supabaseKey = config.supabaseKey;
  const driveApiKey = config.driveApiKey;
  const resourceKey = config.resourceKey;
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const headers: Record<string, string> = {
      "Cache-Control": "no-store", "Vary": "Origin", "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (origin === ORIGIN) headers["Access-Control-Allow-Origin"] = origin;
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), {
      status, headers: { ...headers, "Content-Type": "application/json" },
    });
    if (origin && origin !== ORIGIN) return json(403, { code: "ORIGEN_NO_PERMITIDO" });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST" || new URL(request.url).search) return json(405, { code: "SOLICITUD_INVALIDA" });
    const authorization = request.headers.get("Authorization") || "";
    if (!/^Bearer [A-Za-z0-9._-]{20,16384}$/.test(authorization)) return json(401, { code: "SESION_REQUERIDA" });
    if (!supabaseKey) return json(503, { code: "CONFIGURACION_PENDIENTE" });

    const abort = new AbortController();
    const cancel = () => abort.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    if (request.signal.aborted) abort.abort();
    const timer = setTimeout(cancel, 55_000);
    try {
      if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json")
        return json(400, { code: "SOLICITUD_INVALIDA" });
      const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
        await readBounded(new Response(request.body), 1024, abort.signal, "FUENTE_INVALIDA")));
      if (!input || typeof input !== "object" || Array.isArray(input) ||
          !["metadata", "descargar"].includes(input.accion) ||
          Object.keys(input).some(key => !["accion", "version"].includes(key)) ||
          (input.accion === "metadata" && input.version !== undefined) ||
          (input.accion === "descargar" && (typeof input.version !== "string" || !/^\d{1,19}$/.test(input.version))))
        return json(400, { code: "SOLICITUD_INVALIDA" });

      // Auth validates the caller; the RPC resolves current server-owned permissions.
      const authHeaders = { apikey: supabaseKey, Authorization: authorization, "Content-Type": "application/json" };
      const auth = await fetcher(`${PROJECT_URL}/auth/v1/user`, {
        method: "GET", headers: authHeaders, redirect: "error", cache: "no-store", signal: abort.signal,
      });
      if (auth.status === 401 || auth.status === 403) { await auth.body?.cancel(); return json(401, { code: "SESION_REQUERIDA" }); }
      if (!auth.ok) { await auth.body?.cancel(); return json(503, { code: "SESION_NO_VERIFICABLE" }); }
      const user = await readJson(auth, abort.signal, "FUENTE_INVALIDA");
      if (typeof user.id !== "string" || !user.id) return json(401, { code: "SESION_REQUERIDA" });
      const response = await fetcher(`${PROJECT_URL}/rest/v1/rpc/haiku_sesion_actual`, {
        method: "POST", headers: authHeaders, body: "{}", redirect: "error", cache: "no-store", signal: abort.signal,
      });
      if (response.status === 401) { await response.body?.cancel(); return json(401, { code: "SESION_REQUERIDA" }); }
      if (!response.ok) { await response.body?.cancel(); return json(response.status === 403 ? 403 : 503, { code: "SESION_NO_VERIFICABLE" }); }
      const session = await readJson(response, abort.signal, "FUENTE_INVALIDA");
      if ((session.usuario as { activo?: boolean })?.activo !== true || !Array.isArray(session.permisos) ||
          !PERMISSIONS.every(permission => (session.permisos as unknown[]).includes(permission)))
        return json(403, { code: "SESION_PERMISOS" });
      if (!driveApiKey) return json(503, { code: "CONFIGURACION_PENDIENTE" });

      const source = createLibroDriveSource({ fileId: LIBRO_FILE_ID, apiKey: driveApiKey, resourceKey,
        budgetMs: 35_000, fetch: (url, init) => fetcher(url, {
          ...init, signal: AbortSignal.any([abort.signal, init.signal!]),
        }) });
      if (input.accion === "metadata") return json(200, await source.readMetadata());
      const file = await source.obtain(); // M0, XLSX bytes/checksums, M1; never trust a client stamp.
      if (file.metadata.driveVersion !== input.version) return json(409, { code: "FUENTE_CAMBIADA" });
      if (abort.signal.aborted) return json(504, { code: "GOOGLE_TIMEOUT" });
      return new Response(file.bytes as BodyInit, { headers: {
        ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(file.bytes.byteLength),
      } });
    } catch (error) {
      if (abort.signal.aborted) return json(504, { code: "GOOGLE_TIMEOUT" });
      if (error instanceof SyntaxError) return json(400, { code: "SOLICITUD_INVALIDA" });
      if (error instanceof LibroDriveError) {
        const status = error.code === "FUENTE_CAMBIADA" ? 409 : error.code === "GOOGLE_RATE_LIMIT" ? 429 :
          error.code === "CONFIG_INVALIDA" ? 503 : 502;
        return json(status, { code: error.code });
      }
      return json(503, { code: "GOOGLE_TEMPORARY_ERROR" });
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", cancel);
    }
  };
}
