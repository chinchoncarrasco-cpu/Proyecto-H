import {
  createGoogleTransport, GOOGLE_DRIVE_SCOPE, GOOGLE_TOKEN_ENDPOINT, httpError,
  LibroDriveError, positiveInteger, readJson,
} from "./googleDriveReadonlyCommon.ts";
import type { NetworkOptions } from "./googleDriveReadonlyCommon.ts";

export type GoogleTokenProvider = Readonly<{
  getAccessToken: (options?: { deadlineMs?: number }) => Promise<string>;
  invalidate: (accessToken: string) => void;
}>;
export type ServiceAccountTokenOptions = NetworkOptions & {
  serviceAccountJson: string;
  crypto?: Crypto;
  tokenTimeoutMs?: number;
  assertionLifetimeSeconds?: number;
};

function credential(json: string) {
  try {
    if (typeof json !== "string" || json.length > 32_768) throw new LibroDriveError("CONFIG_INVALIDA");
    const value = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value) || value.type !== "service_account" ||
        typeof value.client_email !== "string" || value.client_email.length > 254 ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.gserviceaccount\.com$/.test(value.client_email) ||
        typeof value.private_key !== "string" || value.private_key.length > 16_384 ||
        value.private_key_id !== undefined && (typeof value.private_key_id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value.private_key_id)))
      throw new LibroDriveError("CONFIG_INVALIDA");
    const pem = /^-----BEGIN PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END PRIVATE KEY-----\s*$/.exec(value.private_key);
    if (!pem) throw new LibroDriveError("CONFIG_INVALIDA");
    const base64 = pem[1].replace(/\s/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64) || !base64)
      throw new LibroDriveError("CONFIG_INVALIDA");
    const privateBytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    // token_uri, auth_uri, project URLs, scopes and delegation fields are ignored.
    return { email: value.client_email as string, kid: value.private_key_id as string | undefined, privateBytes };
  } catch { throw new LibroDriveError("CONFIG_INVALIDA"); }
}
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Inputs come from backend configuration; no environment or request is read here.
export function createGoogleServiceAccountTokenProvider(options: ServiceAccountTokenOptions): GoogleTokenProvider {
  const { email, kid, privateBytes } = credential(options?.serviceAccountJson);
  const crypto = options.crypto ?? globalThis.crypto;
  if (!crypto?.subtle?.importKey || !crypto.subtle.sign) throw new LibroDriveError("CONFIG_INVALIDA");
  // Do not pass the credential object into the network layer, even transiently.
  const transport = createGoogleTransport({ fetch: options.fetch, now: options.now, sleep: options.sleep,
    random: options.random, setTimer: options.setTimer, clearTimer: options.clearTimer,
    budgetMs: options.budgetMs, maxRetries: options.maxRetries, retryDelayMs: options.retryDelayMs });
  const timeoutMs = positiveInteger(options.tokenTimeoutMs ?? 10_000);
  const lifetime = positiveInteger(options.assertionLifetimeSeconds ?? 300, 3600);
  let keyPromise: Promise<CryptoKey> | null = null;
  let cached: { accessToken: string; refreshAt: number } | null = null;
  let pending: Promise<string> | null = null;

  function key(): Promise<CryptoKey> {
    if (!keyPromise) keyPromise = (async () => {
      try {
        const key = await crypto.subtle.importKey("pkcs8", privateBytes as BufferSource,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
        if ((key.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048) throw new LibroDriveError("CONFIG_INVALIDA");
        privateBytes.fill(0);
        return key;
      } catch { privateBytes.fill(0); throw new LibroDriveError("CONFIG_INVALIDA"); }
    })();
    return keyPromise;
  }
  async function assertion(): Promise<{ jwt: string; issuedAt: number }> {
    const signingKey = await key();
    const iat = Math.floor(transport.time() / 1000);
    const header = { alg: "RS256", typ: "JWT", ...(kid ? { kid } : {}) };
    const claims = { iss: email, scope: GOOGLE_DRIVE_SCOPE, aud: GOOGLE_TOKEN_ENDPOINT, iat, exp: iat + lifetime };
    const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
    const unsigned = `${encode(header)}.${encode(claims)}`;
    try {
      const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKey, new TextEncoder().encode(unsigned));
      return { jwt: `${unsigned}.${base64url(new Uint8Array(signature))}`, issuedAt: iat * 1000 };
    } catch { throw new LibroDriveError("GOOGLE_AUTH_ERROR"); }
  }
  async function renew(deadlineMs?: number): Promise<string> {
    const op = transport.operation(deadlineMs);
    for (let attempt = 0; ; attempt++) {
      const { jwt, issuedAt } = await assertion();
      transport.remaining(op);
      try {
        return await transport.request(GOOGLE_TOKEN_ENDPOINT, { method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString(),
        }, timeoutMs, op, async (response, signal) => {
          if (response.status !== 200) throw await httpError(response, true, transport.time(), signal);
          const data = await readJson(response, signal, "GOOGLE_AUTH_ERROR");
          if (typeof data.access_token !== "string" || !data.access_token || data.access_token.length > 16_384 ||
              /[\s\x00-\x1f\x7f]/.test(data.access_token) || typeof data.expires_in !== "number" ||
              !Number.isInteger(data.expires_in) || data.expires_in <= 0 || data.expires_in > 86_400 ||
              data.token_type !== undefined && data.token_type !== "Bearer" ||
              data.scope !== undefined && data.scope !== GOOGLE_DRIVE_SCOPE) throw new LibroDriveError("GOOGLE_AUTH_ERROR");
          const duration = data.expires_in * 1000;
          // Account for request latency, not just the moment the response is read.
          const refreshAt = issuedAt + duration - Math.min(60_000, duration / 10);
          if (refreshAt <= transport.time()) throw new LibroDriveError("GOOGLE_AUTH_ERROR");
          cached = { accessToken: data.access_token, refreshAt };
          return data.access_token;
        });
      } catch (error) {
        const safe = error instanceof LibroDriveError ? error : new LibroDriveError("GOOGLE_AUTH_ERROR");
        if (!await transport.retry(op, attempt, safe)) throw safe;
      }
    }
  }
  return Object.freeze({
    getAccessToken: async ({ deadlineMs }: { deadlineMs?: number } = {}) => {
      const op = transport.operation(deadlineMs);
      transport.remaining(op);
      if (cached && transport.time() < cached.refreshAt) return cached.accessToken;
      if (!pending) {
        pending = renew(op.deadlineMs);
        pending.then(() => { pending = null; }, () => { pending = null; });
      }
      const result = await transport.wait(op, pending);
      transport.remaining(op);
      return result;
    },
    invalidate: (accessToken: string) => {
      // A delayed 401 for an old token must not invalidate a newer cached token.
      if (cached?.accessToken === accessToken) cached = null;
    },
  });
}
