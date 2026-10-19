import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/index.js";
import { customers } from "../src/db/schema.js";
import type { Hono } from "hono";
import type { GeminiClient, GeminiGenerateInput } from "../src/agent/gemini.js";

/**
 * Integration: registration upsert + consent versioning (re-consent).
 *
 * Proves the "Consent versioning" scenario of the recommendation-audit-log
 * spec: an existing customer whose consent is stale is re-consented in place
 * (id preserved, prior records kept) instead of hitting a 409 dead-end, and can
 * keep using /ask afterwards. This is what keeps the whole base usable when
 * CURRENT_CONSENT_VERSION is bumped (the WU3 corrective fix).
 *
 * The last test exercises /assistant/ask, which would otherwise call the REAL
 * Gemini API — a real network round-trip that made this file time out at the
 * default 5s test timeout and burn free-tier quota. We inject a fake client
 * through buildApp's deps seam so the file is deterministic and offline.
 */

describe("register + consent versioning (integration)", () => {
  let db: Db;
  let app: Hono;

  /** Fake Gemini: captures inputs, returns a fixed reply. No network, no key. */
  const fakeGeminiCalls: GeminiGenerateInput[] = [];
  const fakeGemini: GeminiClient = {
    isConfigured: () => true,
    generate: async (input: GeminiGenerateInput) => {
      fakeGeminiCalls.push(input);
      return "[fake] Consulta tu médico. Te sugiero un complejo multivitamínico.";
    },
  };

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    db = createDatabase(":memory:");
    await migrate(db);
    app = buildApp(db, { geminiClient: fakeGemini });
  });

  it("registers a new customer and returns their id", async () => {
    const res = await post("/assistant/register", {
      name: "Ana",
      email: "ana@x.com",
      phone: "111",
      consent_version: 1,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { customer_id: number; reconsented: boolean };
    expect(data.customer_id).toBe(1);
    expect(data.reconsented).toBe(false);
  });

  it("re-consents an existing email/phone instead of 409, preserving the id", async () => {
    const res = await post("/assistant/register", {
      name: "Ana",
      email: "ana@x.com",
      phone: "111",
      consent_version: 1,
    });
    expect(res.status).toBe(200); // upsert, not conflict
    const data = (await res.json()) as { customer_id: number; reconsented: boolean };
    expect(data.customer_id).toBe(1); // id conserved
    expect(data.reconsented).toBe(true);
  });

  it("rejects a stale consent_version sent by the client", async () => {
    const res = await post("/assistant/register", {
      name: "Nuevo",
      email: "nuevo@x.com",
      phone: "222",
      consent_version: 0,
    });
    expect(res.status).toBe(400);
  });

  it("re-consents a customer whose stored consent is older than the current version (Consent versioning)", async () => {
    // Simulate a consent-text bump: downgrade the stored version below current.
    db.update(customers).set({ consentVersion: 0 }).where(eq(customers.id, 1)).run();
    const row = db.select().from(customers).where(eq(customers.id, 1)).get();
    expect(row?.consentVersion).toBe(0);

    // Chat is blocked until re-consent (401 CONSENT_REQUIRED).
    const blocked = await post("/assistant/ask", { customer_id: 1, message: "hola" });
    expect(blocked.status).toBe(401);

    // Returning customer re-registers with the current version → re-consented in place.
    const res = await post("/assistant/register", {
      name: "Ana",
      email: "ana@x.com",
      phone: "111",
      consent_version: 1,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { customer_id: number; reconsented: boolean };
    expect(data.customer_id).toBe(1);
    expect(data.reconsented).toBe(true);

    const refreshed = db.select().from(customers).where(eq(customers.id, 1)).get();
    expect(refreshed?.consentVersion).toBe(1);

    // After re-consent the customer can keep using /ask (no 401 dead-end).
    const ok = await post("/assistant/ask", { customer_id: 1, message: "¿qué vitamina?" });
    expect(ok.status).toBe(200);
  });
});