import { createHash } from "node:crypto";

/**
 * Cloudinary server-side upload proxy (tamizaje-images T1, S2).
 *
 * The browser/admin never talks to Cloudinary directly: the client sends
 * base64 in JSON to our endpoint (which owns the gate), and THIS service
 * signs and forwards the upload, returning only `{public_id, secure_url}` —
 * the DB stores those references, never the binary (design constraint).
 *
 * DI pattern mirrors `agent/gemini.ts` (createGeminiClient): config, the
 * transport (`fetch`) and the clock are injectable, so tests run against a
 * fake — no network, no credentials, and the suite passes with no
 * CLOUDINARY_* env set. Production resolves config from
 * `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`
 * (optional `CLOUDINARY_FOLDER`).
 *
 * Boot safety: the factory NEVER throws — an unconfigured client is a
 * runtime failure, not a crash. Calling `upload`/`destroy` without config
 * rejects with `CloudinaryNotConfiguredError` (clear, call-time).
 *
 * ## Signature (exactly as Cloudinary documents it)
 *
 *   1. take the parameters to sign (here: `timestamp`, plus `folder` when a
 *      folder is configured; `public_id` for destroy);
 *   2. sort the keys alphabetically and join as `key=value` with `&`
 *      (→ `folder=tamizaje&timestamp=1700000000`);
 *   3. append the API secret (no separator);
 *   4. SHA-1 the string, hex digest.
 *
 * `resource_type` is expressed in the URL path (`/v1_1/<cloud>/image/upload`
 * and `/image/destroy`) — it is not a signed body parameter.
 *
 * Transport: `application/x-www-form-urlencoded` POST via the global `fetch`
 * (node 18+, no new dependency). The `file` parameter carries a data URI —
 * a client-supplied `data:...;base64,...` passes through verbatim, raw
 * base64 gets a sniffed `data:image/<fmt>;base64,` prefix from its magic
 * bytes (png/jpeg/webp/gif, png as the safe default).
 */

/** Upload result persisted in `customer_images` (references only). */
export interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
}

/** Explicit folder override; falls back to config/`CLOUDINARY_FOLDER`. */
export interface CloudinaryUploadOptions {
  folder?: string;
}

export interface CloudinaryClient {
  /** True when cloud name + api key + api secret are all present. */
  isConfigured(): boolean;
  /** Signs and proxies the upload; throws on failure (see error classes). */
  upload(fileBase64: string, options?: CloudinaryUploadOptions): Promise<CloudinaryUploadResult>;
  /**
   * Best-effort deletion: `true` when Cloudinary confirmed the deletion (or
   * the asset was already gone), `false` on any other outcome (HTTP failure
   * or transport error). Throws only `CloudinaryNotConfiguredError`.
   */
  destroy(publicId: string): Promise<boolean>;
}

/** Clear, call-time failure for a client constructed without credentials. */
export class CloudinaryNotConfiguredError extends Error {
  readonly code = "CLOUDINARY_NOT_CONFIGURED";
  constructor() {
    super(
      "cloudinary: not configured — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET",
    );
    this.name = "CloudinaryNotConfiguredError";
  }
}

/** A request reached Cloudinary (or the network) and failed. */
export class CloudinaryRequestError extends Error {
  readonly code = "CLOUDINARY_REQUEST_FAILED";
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "CloudinaryRequestError";
    this.status = status;
  }
}

export interface CloudinaryConfig {
  cloudName?: string;
  apiKey?: string;
  apiSecret?: string;
  folder?: string;
}

/** Minimal response shape this service consumes (injectable transport). */
export type CloudinaryFetchLike = (
  url: string,
  init: unknown,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface CloudinaryDeps extends CloudinaryConfig {
  fetch?: CloudinaryFetchLike;
  /** Clock in milliseconds — injectable so signatures are deterministic in tests. */
  now?: () => number;
}

/**
 * Cloudinary's documented signature: parameters sorted alphabetically as
 * `key=value` joined by `&`, concatenated with the API secret, SHA-1 hex.
 * Exported for tests — precomputed vectors pin the algorithm independently.
 */
export function cloudinarySignature(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const toSign =
    Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&") + apiSecret;
  return createHash("sha1").update(toSign, "utf8").digest("hex");
}

/** Magic-byte image sniff for raw base64 payloads (first decoded bytes). */
function sniffImageMime(head: Buffer): string {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image/jpeg";
  }
  if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return "image/png";
  }
  if (head.length >= 4 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (head.length >= 3 && head.toString("ascii", 0, 3) === "GIF") {
    return "image/gif";
  }
  return "image/png";
}

/** Normalizes a payload to the data-URI form Cloudinary accepts for `file`. */
function toDataUri(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("data:")) return trimmed; // client sent a data URI
  const compact = trimmed.replace(/\s+/g, "");
  const head = Buffer.from(compact.slice(0, 64), "base64");
  return `data:${sniffImageMime(head)};base64,${compact}`;
}

function parseError(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
  }
  return null;
}

/**
 * Factory: reads env for anything not injected. Never throws — an
 * unconfigured client only fails when used (see CloudinaryNotConfiguredError).
 */
export function createCloudinaryClient(deps: CloudinaryDeps = {}): CloudinaryClient {
  const cloudName = deps.cloudName ?? process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = deps.apiKey ?? process.env.CLOUDINARY_API_KEY;
  const apiSecret = deps.apiSecret ?? process.env.CLOUDINARY_API_SECRET;
  const folder = deps.folder ?? process.env.CLOUDINARY_FOLDER;
  const fetchFn: CloudinaryFetchLike =
    deps.fetch ??
    ((url, init) =>
      globalThis.fetch(url as string, init as RequestInit) as ReturnType<CloudinaryFetchLike>);
  const nowFn: () => number = deps.now ?? Date.now;

  const configured = (): boolean => Boolean(cloudName && apiKey && apiSecret);
  const requireConfig = (): void => {
    if (!configured()) throw new CloudinaryNotConfiguredError();
  };
  const baseUrl = (): string => `https://api.cloudinary.com/v1_1/${cloudName}`;
  const timestampSec = (): string => String(Math.floor(nowFn() / 1000));

  return {
    isConfigured: configured,

    async upload(fileBase64: string, options: CloudinaryUploadOptions = {}): Promise<CloudinaryUploadResult> {
      requireConfig();
      const timestamp = timestampSec();
      const activeFolder = options.folder ?? folder;
      const signParams: Record<string, string | number> = { timestamp };
      if (activeFolder) signParams.folder = activeFolder;
      const signature = cloudinarySignature(signParams, apiSecret!);

      const form = new URLSearchParams();
      form.set("file", toDataUri(fileBase64));
      form.set("api_key", apiKey!);
      form.set("timestamp", timestamp);
      form.set("signature", signature);
      if (activeFolder) form.set("folder", activeFolder);

      const res = await fetchFn(`${baseUrl()}/image/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = parseError(payload) ?? `HTTP ${res.status}`;
        throw new CloudinaryRequestError(`cloudinary: upload failed — ${detail}`, res.status);
      }
      const publicId = (payload as { public_id?: unknown } | null)?.public_id;
      const secureUrl = (payload as { secure_url?: unknown } | null)?.secure_url;
      if (typeof publicId !== "string" || typeof secureUrl !== "string") {
        throw new CloudinaryRequestError("cloudinary: unexpected upload response", res.status);
      }
      return { public_id: publicId, secure_url: secureUrl };
    },

    async destroy(publicId: string): Promise<boolean> {
      requireConfig();
      const timestamp = timestampSec();
      const signature = cloudinarySignature({ public_id: publicId, timestamp }, apiSecret!);

      const form = new URLSearchParams();
      form.set("public_id", publicId);
      form.set("api_key", apiKey!);
      form.set("timestamp", timestamp);
      form.set("signature", signature);

      try {
        const res = await fetchFn(`${baseUrl()}/image/destroy`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        });
        if (!res.ok) return false;
        const payload = (await res.json().catch(() => null)) as { result?: unknown } | null;
        return payload?.result === "ok" || payload?.result === "not found";
      } catch {
        // Transport failure — destroy is a best-effort cleanup operation
        // (customer delete must never be blocked by it).
        return false;
      }
    },
  };
}
