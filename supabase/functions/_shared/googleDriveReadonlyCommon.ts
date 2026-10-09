// Backend-only transport. No environment reads, logging, persistence or data writes.
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const GOOGLE_DRIVE_FILES = "https://www.googleapis.com/drive/v3/files/";

const messages = Object.freeze({
  CONFIG_INVALIDA: "La configuración backend del Libro no es válida.",
  GOOGLE_AUTH_ERROR: "No se pudo autenticar el acceso backend al Libro.",
  GOOGLE_ACCESS_DENIED: "El backend no tiene acceso lector al Libro.",
  GOOGLE_FILE_NOT_FOUND: "El Libro configurado no está disponible.",
  GOOGLE_RATE_LIMIT: "La fuente del Libro alcanzó su límite de solicitudes.",
  GOOGLE_TEMPORARY_ERROR: "La fuente del Libro no está disponible temporalmente.",
  GOOGLE_TIMEOUT: "Se agotó el tiempo disponible para consultar el Libro.",
  FUENTE_INVALIDA: "La fuente del Libro no cumple el contrato XLSX.",
  FUENTE_DEMASIADO_GRANDE: "El Libro supera el límite de bytes permitido.",
  FUENTE_NO_VERIFICABLE: "Drive no entregó un checksum verificable del Libro.",
  CHECKSUM_INVALIDO: "Los bytes del Libro no coinciden con su checksum.",
  FUENTE_CAMBIADA: "El Libro cambió durante la consulta; vuelve a consultar.",
});
export type LibroDriveErrorCode = keyof typeof messages;

export class LibroDriveError extends Error {
  readonly code: LibroDriveErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  constructor(code: LibroDriveErrorCode, retryAfterMs: number | null = null, retryable?: boolean) {
    super(messages[code]);
    this.name = "LibroDriveError";
    this.code = code;
    this.retryable = retryable ?? ["GOOGLE_RATE_LIMIT", "GOOGLE_TEMPORARY_ERROR", "GOOGLE_TIMEOUT", "FUENTE_CAMBIADA"].includes(code);
    this.retryAfterMs = retryAfterMs;
  }
}
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type NetworkOptions = {
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  setTimer?: (callback: () => void, milliseconds: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  budgetMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
};
export type Operation = { deadlineMs: number; authRenewed: boolean };

export function positiveInteger(value: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new LibroDriveError("CONFIG_INVALIDA");
  return value;
}

export function createGoogleTransport(options: NetworkOptions = {}) {
  // Snapshot only network fields; returned functions never read the input object.
  const { fetch: configuredFetch, now: configuredNow, sleep: configuredSleep, random: configuredRandom,
    setTimer: configuredSetTimer, clearTimer: configuredClearTimer, budgetMs: configuredBudgetMs,
    maxRetries: configuredMaxRetries, retryDelayMs: configuredRetryDelayMs } = options;
  const fetcher = configuredFetch ?? globalThis.fetch;
  const now = configuredNow ?? Date.now;
  const random = configuredRandom ?? Math.random;
  const setTimer = configuredSetTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = configuredClearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const budgetMs = positiveInteger(configuredBudgetMs ?? 60_000, 600_000);
  const maxRetries = configuredMaxRetries ?? 1;
  const retryDelayMs = positiveInteger(configuredRetryDelayMs ?? 250, 60_000);
  if (typeof fetcher !== "function" || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 2 ||
      [now, random, setTimer, clearTimer].some(fn => typeof fn !== "function") ||
      configuredSleep !== undefined && typeof configuredSleep !== "function") throw new LibroDriveError("CONFIG_INVALIDA");
  const sleep = configuredSleep ?? ((ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    const finish = () => { signal.removeEventListener("abort", abort); resolve(); };
    const handle = setTimer(finish, ms);
    const abort = () => { clearTimer(handle); reject(new LibroDriveError("GOOGLE_TIMEOUT")); };
    signal.addEventListener("abort", abort, { once: true });
  }));

  function time(): number {
    const value = now();
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) throw new LibroDriveError("CONFIG_INVALIDA");
    return value;
  }
  const operation = (deadlineMs?: number): Operation => {
    const start = time();
    if (deadlineMs !== undefined && (!Number.isSafeInteger(deadlineMs) || deadlineMs < 0)) throw new LibroDriveError("CONFIG_INVALIDA");
    return { deadlineMs: Math.min(start + budgetMs, deadlineMs ?? Infinity), authRenewed: false };
  };
  function remaining(op: Operation): number {
    const left = op.deadlineMs - time();
    if (left <= 0) throw new LibroDriveError("GOOGLE_TIMEOUT");
    return left;
  }
  async function timed<T>(op: Operation, timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let handle: unknown;
    const timeout = new Promise<never>((_, reject) => {
      handle = setTimer(() => {
        reject(new LibroDriveError("GOOGLE_TIMEOUT"));
        controller.abort();
      }, Math.min(positiveInteger(timeoutMs), remaining(op)));
    });
    try {
      const result = await Promise.race([timeout, Promise.resolve().then(() => run(controller.signal))]);
      remaining(op);
      return result;
    } catch (error) {
      if (error instanceof LibroDriveError) throw error;
      throw new LibroDriveError("GOOGLE_TEMPORARY_ERROR");
    } finally { clearTimer(handle); }
  }
  async function request<T>(url: string, init: RequestInit, timeoutMs: number, op: Operation,
      consume: (response: Response, signal: AbortSignal) => Promise<T>): Promise<T> {
    // This allowlist is independent of credential JSON and caller-provided URLs.
    const drive = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/[A-Za-z0-9_-]+\?/.test(url);
    if (!(url === GOOGLE_TOKEN_ENDPOINT && init.method === "POST" || drive && init.method === "GET"))
      throw new LibroDriveError("CONFIG_INVALIDA");
    return timed(op, timeoutMs, async signal => {
      const response = await fetcher(url, { ...init, redirect: "manual", cache: "no-store", signal });
      if (response.status >= 300 && response.status < 400) {
        await discard(response);
        throw new LibroDriveError("GOOGLE_TEMPORARY_ERROR", null, false);
      }
      return consume(response, signal);
    });
  }
  async function retry(op: Operation, attempt: number, error: LibroDriveError): Promise<boolean> {
    if (!error.retryable || attempt >= maxRetries || !["GOOGLE_RATE_LIMIT", "GOOGLE_TEMPORARY_ERROR"].includes(error.code)) return false;
    const jitter = random();
    if (!Number.isFinite(jitter) || jitter < 0 || jitter >= 1) throw new LibroDriveError("CONFIG_INVALIDA");
    const delay = error.retryAfterMs ?? Math.floor(retryDelayMs * 2 ** attempt * (1 + jitter));
    if (delay >= remaining(op)) throw new LibroDriveError("GOOGLE_TIMEOUT");
    await timed(op, remaining(op), signal => sleep(delay, signal));
    return true;
  }
  const wait = <T>(op: Operation, promise: Promise<T>) => timed(op, remaining(op), () => promise);
  return Object.freeze({ time, operation, remaining, request, retry, wait });
}

export async function discard(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* No raw response errors escape. */ }
}
async function drive403RateLimited(response: Response, signal: AbortSignal): Promise<boolean> {
  try {
    // Only Google's structured reason path can enable a retry, never message text.
    const data = await readJson(response, signal, "GOOGLE_ACCESS_DENIED");
    const error = data.error;
    if (!error || typeof error !== "object" || Array.isArray(error)) return false;
    const reasons = (error as Record<string, unknown>).errors;
    return Array.isArray(reasons) && reasons.some(entry => entry && typeof entry === "object" && !Array.isArray(entry) &&
      (entry.reason === "rateLimitExceeded" || entry.reason === "userRateLimitExceeded"));
  } catch (error) {
    if (error instanceof LibroDriveError && error.code === "GOOGLE_TIMEOUT") throw error;
    return false; // Malformed, oversized or failed bodies remain ordinary access denial.
  }
}
export async function httpError(response: Response, tokenRequest: boolean, now: number, signal: AbortSignal): Promise<LibroDriveError> {
  let retryAfterMs: number | null = null;
  const header = response.headers.get("Retry-After");
  if (header && header.length <= 64) {
    const delay = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now;
    if (Number.isFinite(delay) && delay >= 0) retryAfterMs = Math.min(delay, 3_600_000);
  }
  if (!tokenRequest && response.status === 403) {
    const limited = await drive403RateLimited(response, signal);
    return limited ? new LibroDriveError("GOOGLE_RATE_LIMIT", retryAfterMs) : new LibroDriveError("GOOGLE_ACCESS_DENIED");
  }
  await discard(response);
  if (response.status === 429) return new LibroDriveError("GOOGLE_RATE_LIMIT", retryAfterMs);
  if (response.status >= 500 && response.status <= 599) return new LibroDriveError("GOOGLE_TEMPORARY_ERROR", retryAfterMs);
  if (tokenRequest || response.status === 401) return new LibroDriveError("GOOGLE_AUTH_ERROR");
  if (response.status === 404) return new LibroDriveError("GOOGLE_FILE_NOT_FOUND");
  return new LibroDriveError("FUENTE_INVALIDA");
}

export async function readBounded(response: Response, maxBytes: number, signal: AbortSignal,
    overflowCode: LibroDriveErrorCode): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (signal.aborted) throw new LibroDriveError("GOOGLE_TIMEOUT");
    while (true) {
      const part = await reader.read();
      if (signal.aborted) throw new LibroDriveError("GOOGLE_TIMEOUT");
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) throw new LibroDriveError(overflowCode);
      chunks.push(part.value.slice());
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal.removeEventListener("abort", abort);
    try { await reader.cancel(); } catch { /* Bound/cancel also failed streams. */ }
    reader.releaseLock();
  }
}
export async function readJson(response: Response, signal: AbortSignal, code: LibroDriveErrorCode): Promise<Record<string, unknown>> {
  try {
    const bytes = await readBounded(response, 32_768, signal, code);
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new LibroDriveError(code);
    return value;
  } catch (error) {
    if (error instanceof LibroDriveError) throw error;
    throw new LibroDriveError(code);
  }
}
