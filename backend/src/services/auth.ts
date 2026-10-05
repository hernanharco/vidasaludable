/**
 * Auth service — authCore JWT verification (ecosystem spoke pattern).
 *
 * authCore (the Google-OAuth auth hub) issues RS256-signed JWTs; this service
 * verifies them against the hub's JWKS (JSON Web Key Set), mirroring the
 * CafeMiTierra spoke (`backend/src/services/auth.ts`) with two deliberate
 * divergences:
 *
 *   1. `exp` IS validated (CafeMiTierra skips it) — an expired token must
 *      never unlock the admin CRM.
 *   2. Dev-mode shortcuts live OUTSIDE this service (the guard in index.ts
 *      decides); the service itself always performs full verification.
 *
 * Fail-closed: if the JWKS cannot be fetched (hub unreachable), getJwk()
 * returns null and verifyJwt() rejects every token — no silent bypass.
 */

import type { webcrypto } from "node:crypto";

/** Cache of the authCore public key in JWK format (+ fetch time, for TTL). */
let jwkKey: webcrypto.JsonWebKey | null = null;
let jwkFetchedAt = 0;

/** Refresh the cache at least this often so hub key rotation is picked up. */
const JWKS_TTL_MS = 10 * 60 * 1000;

/** The `kid` of a JWK, when present. */
function kidOf(key: webcrypto.JsonWebKey): string | undefined {
  const kid = (key as { kid?: unknown }).kid;
  return typeof kid === "string" ? kid : undefined;
}

/** JWKS endpoint — env-overridable, defaults to the authCore hub. */
export function getPublicKeyUrl(): string {
  return (
    process.env.AUTHCORE_PUBLIC_KEY_URL ||
    "https://api-authcore.rincom.es/.well-known/jwks.json"
  );
}

/**
 * Fetches the public key from authCore in JWK format.
 * Rotation-safe: the cache expires after JWKS_TTL_MS, a token `kid` that
 * does not match the cached key forces a refetch, and a verification
 * failure invalidates the cache (see verifyJwt). Returns null when the
 * hub is unreachable AND no usable cached key exists (fail-closed).
 */
export async function getJwk(kid?: string): Promise<webcrypto.JsonWebKey | null> {
  const staleUsable = jwkKey !== null && (kid === undefined || kidOf(jwkKey) === kid);
  if (staleUsable && Date.now() - jwkFetchedAt < JWKS_TTL_MS) return jwkKey;

  try {
    const response = await fetch(getPublicKeyUrl());
    if (!response.ok) {
      console.warn(`[auth] authCore responded ${response.status} — JWKS unavailable`);
      return staleUsable ? jwkKey : null; // serve stale (same kid only) during a hub blip
    }
    const data = (await response.json()) as
      | { keys?: webcrypto.JsonWebKey[] }
      | webcrypto.JsonWebKey;

    // Supports both a JWKS object ({ keys: [...] }) and a single key.
    const keys =
      (data as { keys?: webcrypto.JsonWebKey[] }).keys ??
      [data as webcrypto.JsonWebKey];
    const key = (kid !== undefined ? keys.find((k) => kidOf(k) === kid) : keys[0]) ?? null;
    if (!key) {
      console.warn(`[auth] JWKS has no key for kid ${String(kid)} — rejecting (fail-closed)`);
      return null;
    }
    jwkKey = key;
    jwkFetchedAt = Date.now();
    console.log(`[auth] public key cached from authCore (kid: ${String(kidOf(key))})`);
    return key;
  } catch (err) {
    console.warn(
      "[auth] could not fetch JWKS from authCore:",
      (err as Error).message,
    );
    return staleUsable ? jwkKey : null; // serve stale (same kid only); else fail-closed
  }
}

/**
 * Test hook: inject (or clear, with null) a JWKS key without a network fetch.
 * The production path always uses the fetch in getJwk().
 */
export function __setJwkForTest(jwk: webcrypto.JsonWebKey | null): void {
  jwkKey = jwk;
  jwkFetchedAt = jwk ? Date.now() : 0;
}

/** Claims extracted from a verified authCore JWT. */
export interface JwtPayload {
  sub: string;
  email: string;
  role?: string;
  exp: number;
  [key: string]: unknown;
}

/** Decode a base64url segment into a Buffer (WebCrypto wants raw bytes). */
function base64UrlToBuffer(base64Url: string): Buffer {
  return Buffer.from(base64Url, "base64url");
}

/**
 * Verifies an authCore JWT end to end:
 *   1. JWKS lookup — null ⇒ reject (fail-closed, e.g. hub unreachable).
 *   2. RS256 signature over `<header>.<payload>` via WebCrypto importKey("jwk").
 *   3. Payload checks — REJECT (return null) when:
 *        - `exp` is missing, not a finite number, or in the past
 *          (REQUIRED here — deliberate divergence from CafeMiTierra, whose
 *          spoke skips exp validation entirely; see header comment), or
 *        - `sub` or `email` is missing/blank.
 * Returns the payload `{ sub, email, role, exp, ... }` on success.
 */
export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payloadB64, signature] = parts;
  if (!header || !payloadB64 || !signature) return null;

  let kid: string | undefined;
  try {
    const h = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { kid?: unknown };
    kid = typeof h.kid === "string" ? h.kid : undefined;
  } catch {
    return null;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const jwk = await getJwk(kid); // rotation-safe: TTL / kid mismatch refetch
    if (!jwk) return null; // fail-closed: no key ⇒ reject everything

    try {
      const keyData = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const data = new TextEncoder().encode(`${header}.${payloadB64}`);
      const sig = base64UrlToBuffer(signature);
      const signatureValid = await crypto.subtle.verify(
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        keyData,
        sig,
        data,
      );
      if (!signatureValid) {
        // The hub may have rotated since the cached fetch — mark the cache
        // stale (NOT null: a transient refetch failure must not wipe a still
        // usable key) and retry once against a fresh JWKS.
        if (attempt === 0) {
          jwkFetchedAt = 0;
          continue;
        }
        return null;
      }

      const decoded: unknown = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf8"),
      );
    if (typeof decoded !== "object" || decoded === null) return null;
    const payload = decoded as Record<string, unknown>;

    // exp MUST be present and in the future (see verifyJwt doc comment).
    const exp = payload.exp;
    if (
      typeof exp !== "number" ||
      !Number.isFinite(exp) ||
      exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    if (typeof payload.email !== "string" || !payload.email) return null;

    const role = typeof payload.role === "string" ? payload.role : undefined;
    return { ...payload, sub: payload.sub, email: payload.email, role, exp };
    } catch {
      return null;
    }
  }
  return null;
}

// Typed `c.set("user", ...)` / `c.get("user")` for the central admin guard.
declare module "hono" {
  interface ContextVariableMap {
    /** Verified authCore user — set by the central admin guard in index.ts. */
    user: JwtPayload;
  }
}
