import {
  createGoogleTransport, discard, GOOGLE_DRIVE_FILES, httpError, LibroDriveError,
  positiveInteger, readBounded, readJson,
} from "./googleDriveReadonlyCommon.ts";
import type { NetworkOptions, Operation } from "./googleDriveReadonlyCommon.ts";
import type { GoogleTokenProvider } from "./googleServiceAccountToken.ts";
import { md5Hex } from "./libroDriveChecksums.ts";

export const LIBRO_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const LIBRO_MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
const fields = "id,name,mimeType,modifiedTime,size,version,md5Checksum,sha256Checksum,trashed,capabilities(canDownload)";
export type LibroDriveStamp = Readonly<{
  id: string; mimeType: string; driveVersion: string; modifiedTime: string | null;
  size: number | null; md5Checksum: string | null; sha256Checksum: string | null;
  canDownload: boolean; trashed: boolean | null;
}>;
export type LibroDriveSource = Readonly<{
  bytes: Uint8Array;
  metadata: Readonly<{
    name: string; mimeType: string; modifiedTime: string | null; size: number | null;
    driveVersion: string; md5Checksum: string | null; sha256Checksum: string | null;
  }>;
  sha256: string;
  verifiedAt: string;
  stamp: LibroDriveStamp;
}>;
export type LibroDriveSourceOptions = NetworkOptions & {
  fileId: string;
  tokenProvider: GoogleTokenProvider;
  crypto?: Crypto;
  maxBytes?: number;
  metadataTimeoutMs?: number;
  downloadTimeoutMs?: number;
};
const stampKeys = ["id", "mimeType", "driveVersion", "modifiedTime", "size", "md5Checksum", "sha256Checksum", "canDownload", "trashed"] as const;

export function createLibroDriveSource(options: LibroDriveSourceOptions) {
  if (!options || typeof options.fileId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(options.fileId) ||
      typeof options.tokenProvider?.getAccessToken !== "function" || typeof options.tokenProvider?.invalidate !== "function")
    throw new LibroDriveError("CONFIG_INVALIDA");
  const fileId = options.fileId;
  const tokenProvider = options.tokenProvider;
  const crypto = options.crypto ?? globalThis.crypto;
  if (!crypto?.subtle?.digest) throw new LibroDriveError("CONFIG_INVALIDA");
  const transport = createGoogleTransport(options);
  const maxBytes = positiveInteger(options.maxBytes ?? LIBRO_MAX_COMPRESSED_BYTES, 64 * 1024 * 1024);
  const metadataTimeout = positiveInteger(options.metadataTimeoutMs ?? 10_000);
  const downloadTimeout = positiveInteger(options.downloadTimeoutMs ?? 20_000);
  const url = `${GOOGLE_DRIVE_FILES}${fileId}`;
  const metadataUrl = `${url}?${new URLSearchParams({ fields, supportsAllDrives: "true" })}`;
  const mediaUrl = `${url}?alt=media&supportsAllDrives=true`;
  const issued = new WeakSet<object>();

  async function drive<T>(target: string, timeout: number, op: Operation,
      consume: (response: Response, signal: AbortSignal) => Promise<T>): Promise<T> {
    let retries = 0;
    while (true) {
      transport.remaining(op);
      let token: string;
      try { token = await transport.wait(op, tokenProvider.getAccessToken({ deadlineMs: op.deadlineMs })); }
      catch (error) { throw error instanceof LibroDriveError ? error : new LibroDriveError("GOOGLE_AUTH_ERROR"); }
      if (typeof token !== "string" || !token || /[\s\x00-\x1f\x7f]/.test(token)) throw new LibroDriveError("GOOGLE_AUTH_ERROR");
      try {
        return await transport.request(target, { method: "GET", headers: { Authorization: `Bearer ${token}` } }, timeout, op,
          async (response, signal) => {
            if (response.status !== 200) throw await httpError(response, false, transport.time(), signal);
            return consume(response, signal);
          });
      } catch (error) {
        const safe = error instanceof LibroDriveError ? error : new LibroDriveError("GOOGLE_TEMPORARY_ERROR");
        if (safe.code === "GOOGLE_AUTH_ERROR" && !op.authRenewed) {
          op.authRenewed = true;
          try { tokenProvider.invalidate(token); }
          catch { throw new LibroDriveError("GOOGLE_AUTH_ERROR"); }
          continue;
        }
        if (!await transport.retry(op, retries++, safe)) throw safe;
      }
    }
  }
  function parseMetadata(data: Record<string, unknown>) {
    const invalid = () => { throw new LibroDriveError("FUENTE_INVALIDA"); };
    if (typeof data.id !== "string" || typeof data.name !== "string" || !data.name || data.name.length > 1024 ||
        typeof data.mimeType !== "string" || typeof data.version !== "string" ||
        !/^(0|[1-9]\d{0,18})$/.test(data.version) || BigInt(data.version) > 9223372036854775807n) invalid();
    const modifiedTime = data.modifiedTime ?? null;
    if (modifiedTime !== null && (typeof modifiedTime !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(modifiedTime) || !Number.isFinite(Date.parse(modifiedTime)))) invalid();
    let size: number | null = null;
    if (data.size !== undefined && data.size !== null) {
      if (typeof data.size !== "string" || !/^(0|[1-9]\d{0,18})$/.test(data.size)) invalid();
      const n = BigInt(data.size as string);
      if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new LibroDriveError("FUENTE_DEMASIADO_GRANDE");
      size = Number(n);
    }
    const checksum = (value: unknown, length: number): string | null => {
      if (value === undefined || value === null) return null;
      if (typeof value !== "string" || !new RegExp(`^[a-fA-F0-9]{${length}}$`).test(value)) return invalid();
      return value.toLowerCase();
    };
    const capabilities = data.capabilities as Record<string, unknown> | undefined;
    if (typeof capabilities?.canDownload !== "boolean" || data.trashed !== undefined && typeof data.trashed !== "boolean") invalid();
    const stamp: LibroDriveStamp = Object.freeze({ id: data.id as string, mimeType: data.mimeType as string,
      driveVersion: data.version as string, modifiedTime: modifiedTime as string | null, size,
      md5Checksum: checksum(data.md5Checksum, 32), sha256Checksum: checksum(data.sha256Checksum, 64),
      canDownload: capabilities!.canDownload as boolean, trashed: data.trashed as boolean | undefined ?? null });
    return { name: data.name as string, stamp };
  }
  async function metadata(op: Operation) {
    return drive(metadataUrl, metadataTimeout, op, async (response, signal) => parseMetadata(await readJson(response, signal, "FUENTE_INVALIDA")));
  }
  function validateInitial(stamp: LibroDriveStamp) {
    if (stamp.id !== fileId || stamp.mimeType !== LIBRO_XLSX_MIME || stamp.trashed === true ||
        !stamp.canDownload || stamp.size === null || stamp.size <= 0) throw new LibroDriveError("FUENTE_INVALIDA");
    if (stamp.size > maxBytes) throw new LibroDriveError("FUENTE_DEMASIADO_GRANDE");
    if (!stamp.md5Checksum && !stamp.sha256Checksum) throw new LibroDriveError("FUENTE_NO_VERIFICABLE");
  }
  async function unchanged(stamp: LibroDriveStamp, op: Operation): Promise<void> {
    let current;
    try { current = (await metadata(op)).stamp; }
    catch (error) {
      if (error instanceof LibroDriveError && ["FUENTE_INVALIDA", "FUENTE_DEMASIADO_GRANDE"].includes(error.code))
        throw new LibroDriveError("FUENTE_CAMBIADA");
      throw error;
    }
    if (stampKeys.some(key => current[key] !== stamp[key])) throw new LibroDriveError("FUENTE_CAMBIADA");
  }
  async function obtain(): Promise<LibroDriveSource> {
    const op = transport.operation();
    const initial = await metadata(op);
    validateInitial(initial.stamp);
    const bytes = await drive(mediaUrl, downloadTimeout, op, async (response, signal) => {
      const length = response.headers.get("Content-Length");
      const encoding = response.headers.get("Content-Encoding");
      // Fetch may decompress transport encoding; Content-Length then measures another representation.
      const comparable = !encoding || encoding.toLowerCase() === "identity";
      if (length !== null) {
        if (!/^\d{1,19}$/.test(length)) { await discard(response); throw new LibroDriveError("FUENTE_INVALIDA"); }
        if (comparable && BigInt(length) > BigInt(maxBytes)) { await discard(response); throw new LibroDriveError("FUENTE_DEMASIADO_GRANDE"); }
        if (comparable && BigInt(length) !== BigInt(initial.stamp.size!)) { await discard(response); throw new LibroDriveError("FUENTE_INVALIDA"); }
      }
      const data = await readBounded(response, maxBytes, signal, "FUENTE_DEMASIADO_GRANDE");
      if (!data.byteLength || data.byteLength !== initial.stamp.size) throw new LibroDriveError("FUENTE_INVALIDA");
      return data;
    });
    let sha256: string;
    try {
      const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
      sha256 = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
    } catch { throw new LibroDriveError("CHECKSUM_INVALIDO"); }
    transport.remaining(op);
    if (initial.stamp.sha256Checksum && initial.stamp.sha256Checksum !== sha256 ||
        initial.stamp.md5Checksum && initial.stamp.md5Checksum !== md5Hex(bytes)) throw new LibroDriveError("CHECKSUM_INVALIDO");
    await unchanged(initial.stamp, op); // M1. No bytes are exposed until this succeeds.
    issued.add(initial.stamp);
    return Object.freeze({ bytes, metadata: Object.freeze({ name: initial.name, mimeType: initial.stamp.mimeType,
      modifiedTime: initial.stamp.modifiedTime, size: initial.stamp.size, driveVersion: initial.stamp.driveVersion,
      md5Checksum: initial.stamp.md5Checksum, sha256Checksum: initial.stamp.sha256Checksum }),
      sha256, verifiedAt: new Date(transport.time()).toISOString(), stamp: initial.stamp });
  }
  async function verifyStillCurrent(stamp: LibroDriveStamp): Promise<void> {
    if (!stamp || !issued.has(stamp)) throw new LibroDriveError("CONFIG_INVALIDA");
    await unchanged(stamp, transport.operation()); // M2 only; no download and no comparison.
  }
  return Object.freeze({ obtain, verifyStillCurrent });
}
