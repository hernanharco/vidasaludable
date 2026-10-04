/**
 * T1 — Backend JWT auth (authCore spoke pattern).
 *
 * Verifies the ONE central guard in src/index.ts (`app.use("/admin/*")`) and
 * the RS256 verification service in src/services/auth.ts.
 *
 * Key material is a real RSA keypair generated locally with node:crypto; test
 * JWTs are signed with `crypto.sign("RSA-SHA256", ...)` (PKCS#1 v1.5 + SHA-256,
 * i.e. RS256) using base64url header/payload segments. The JWKS URL is pointed
 * at a closed local port during these tests so the fail-closed path is
 * deterministic and offline.
 *
 * Guard tests run with NODE_ENV=production semantics (restored in afterAll),
 * following the same save/set/restore pattern as video-endpoints.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type { Hono } from "hono";
import { createDatabase } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/index.js";
import { verifyJwt, __setJwkForTest } from "../src/services/auth.js";
import type { Db } from "../src/db/client.js";

// ── Local RSA keypair standing in for the authCore signing key ──────────────

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: roguePrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key-1" };

const b64url = (value: string | Buffer): string => Buffer.from(value).toString("base64url");

/** Build a compact JWT signed with `signingKey` (base64url header.payload.sig). */
function signJwt(payload: Record<string, unknown>, signingKey: KeyObject): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key-1" }));
  const body = b64url(JSON.stringify(payload));
  const signed = `${header}.${body}`;
  const signature = nodeSign("RSA-SHA256", Buffer.from(signed), signingKey);
  return `${signed}.${signature.toString("base64url")}`;
}

const now = () => Math.floor(Date.now() / 1000);

/** Valid ADMIN token: sub + email + role + future exp. */
const adminToken = (signingKey: KeyObject = privateKey): string =>
  signJwt({ sub: "user-1", email: "admin@example.com", role: "ADMIN", exp: now() + 3600 }, signingKey);

/** Token whose exp is already in the past. */
const expiredToken = (): string =>
  signJwt({ sub: "user-1", email: "admin@example.com", role: "ADMIN", exp: now() - 60 }, privateKey);

/** Token with role USER (not ADMIN/SUPERADMIN). */
const userToken = (): string =>
  signJwt({ sub: "user-2", email: "user@example.com", role: "USER", exp: now() + 3600 }, privateKey);

/** Token with no exp claim at all. */
const noExpToken = (): string =>
  signJwt({ sub: "user-1", email: "admin@example.com", role: "ADMIN" }, privateKey);

/** Token missing sub and email. */
const noIdentityToken = (): string =>
  signJwt({ role: "ADMIN", exp: now() + 3600 }, privateKey);

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

// ── App under test: real buildApp over in-memory migrated SQLite ────────────

let db: Db;
let app: Hono;
let prevNodeEnv: string | undefined;
let prevJwksUrl: string | undefined;

beforeAll(async () => {
  prevNodeEnv = process.env.NODE_ENV;
  prevJwksUrl = process.env.AUTHCORE_PUBLIC_KEY_URL;
  // Guard tests exercise production semantics; restore in afterAll.
  process.env.NODE_ENV = "production";
  // Closed local port: any unexpected JWKS fetch fails fast and offline, so
  // fail-closed assertions do not depend on the network.
  process.env.AUTHCORE_PUBLIC_KEY_URL = "http://127.0.0.1:9/.well-known/jwks.json";
  // Inject the test JWK via the service hook — production path keeps the fetch.
  __setJwkForTest(jwk as JsonWebKey);
  db = createDatabase(":memory:");
  await migrate(db);
  app = buildApp(db);
});

afterAll(() => {
  __setJwkForTest(null);
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
  if (prevJwksUrl === undefined) delete process.env.AUTHCORE_PUBLIC_KEY_URL;
  else process.env.AUTHCORE_PUBLIC_KEY_URL = prevJwksUrl;
});

// ── verifyJwt service (src/services/auth.ts) ────────────────────────────────

describe("verifyJwt (services/auth.ts)", () => {
  it("returns the payload for a valid signed JWT (sub, email, role, exp)", async () => {
    const payload = await verifyJwt(adminToken());
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("user-1");
    expect(payload?.email).toBe("admin@example.com");
    expect(payload?.role).toBe("ADMIN");
    expect(typeof payload?.exp).toBe("number");
  });

  it("rejects an expired token (exp validation REQUIRED — diverges from CafeMiTierra)", async () => {
    expect(await verifyJwt(expiredToken())).toBeNull();
  });

  it("rejects a token with no exp claim", async () => {
    expect(await verifyJwt(noExpToken())).toBeNull();
  });

  it("rejects a token missing sub or email", async () => {
    expect(await verifyJwt(noIdentityToken())).toBeNull();
  });

  it("rejects a token signed with a different key", async () => {
    expect(await verifyJwt(adminToken(roguePrivateKey))).toBeNull();
  });

  it("fails closed when the JWK is unavailable (JWKS unreachable)", async () => {
    __setJwkForTest(null);
    try {
      expect(await verifyJwt(adminToken())).toBeNull();
    } finally {
      __setJwkForTest(jwk as JsonWebKey);
    }
  });
});

// ── Central guard (src/index.ts) ─────────────────────────────────────────────

describe("adminGuard (central, src/index.ts)", () => {
  it("allows a valid signed ADMIN token via Authorization: Bearer (GET /admin/catalog → 200)", async () => {
    const res = await app.request("/admin/catalog", bearer(adminToken()));
    expect(res.status).toBe(200);
  });

  it("allows SUPERADMIN role (triangulation of the role allowlist)", async () => {
    const token = signJwt({ sub: "root", email: "root@example.com", role: "SUPERADMIN", exp: now() + 3600 }, privateKey);
    const res = await app.request("/admin/catalog", bearer(token));
    expect(res.status).toBe(200);
  });

  it("rejects a missing token with 401 token_requerido", async () => {
    const res = await app.request("/admin/catalog");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "token_requerido" });
  });

  it("rejects a token signed with a different key with 401 token_invalido", async () => {
    const res = await app.request("/admin/catalog", bearer(adminToken(roguePrivateKey)));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "token_invalido" });
  });

  it("rejects an expired token (exp in the past) with 401 token_invalido", async () => {
    const res = await app.request("/admin/catalog", bearer(expiredToken()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "token_invalido" });
  });

  it("rejects a token with role USER with 403 acceso_restringido", async () => {
    const res = await app.request("/admin/catalog", bearer(userToken()));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "acceso_restringido" });
  });

  it("closes the pre-existing gap: GET /admin/referrers without token → 401", async () => {
    const res = await app.request("/admin/referrers");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "token_requerido" });
  });

  it("allows a valid ADMIN token on /admin/referrers (200)", async () => {
    const res = await app.request("/admin/referrers", bearer(adminToken()));
    expect(res.status).toBe(200);
  });

  it("accepts the token via Cookie: token=... (Vercel same-origin rewrite path)", async () => {
    const res = await app.request("/admin/catalog", { headers: { Cookie: `token=${adminToken()}` } });
    expect(res.status).toBe(200);
  });

  it("stays open without a token when NODE_ENV=development (current dev behavior)", async () => {
    process.env.NODE_ENV = "development";
    try {
      const res = await app.request("/admin/catalog");
      expect(res.status).toBe(200);
    } finally {
      process.env.NODE_ENV = "production";
    }
  });
});
