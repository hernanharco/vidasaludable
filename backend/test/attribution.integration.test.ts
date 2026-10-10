import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/index.js";
import { customers, referrers } from "../src/db/schema.js";
import type { Hono } from "hono";

/**
 * Integration: POST /assistant/attribution (T1 of access-code-always).
 *
 * The access code is now requested on EVERY visit (user decision 2026-10-09),
 * so a returning visitor must be able to attribute to a NEW referrer without
 * re-registering: the frontend only persists `vr_customer_id`, not
 * name/email/phone, hence this dedicated endpoint instead of register().
 *
 * Covered behaviors, over in-memory SQLite (`createDatabase` + `migrate` +
 * `buildApp`):
 *
 *  1. LAST-TOUCH — registered customer + current consent + a new referrer →
 *     200 {ok:true} and the row's `referrer_id` actually changed (asserted by
 *     reading the DB, not the response).
 *  2. IMMUTABILITY — the same kind of call does NOT alter `name`, `email`,
 *     `phone`, `registeredAt`, `consentVersion` or `consentTimestamp`.
 *  3. UNKNOWN CUSTOMER — 404 `{error:"customer no encontrado"}` (same wording
 *     as /profile and /ask).
 *  4. INVALID CUSTOMER_ID — 0, negative, non-integer → 400 (same shape as
 *     /profile and /ask). Invalid `referrer_id` values → 400 too.
 *  5. STALE CONSENT — 401 with a `consent` object (same CONSENT_REQUIRED
 *     shape as /ask) and `referrer_id` is NOT changed (no silent consent
 *     bump, no attribution while consent is stale).
 *  6. UNKNOWN REFERRER — 400 (DECISION: an unknown `referrer_id` is an
 *     invalid input value, mirroring the 400-on-invalid-id style, NOT a 404;
 *     the referrer is a body field, its absence says nothing about the
 *     customer identity). The DB FK to `referrers(id)` is enforced
 *     (`foreign_keys = ON`), so the service rejects it before the write.
 *
 * No API key and no network: none of these routes touch the Gemini client.
 */
describe("assistant attribution (integration: last-touch access code)", () => {
  let db: Db;
  let app: Hono;
  let referrerA: { id: number };
  let referrerB: { id: number };

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const getCustomer = (customerId: number) =>
    db.select().from(customers).where(eq(customers.id, customerId)).get();

  const register = async (email: string, phone: string, referrerId?: number) => {
    const res = await post("/assistant/register", {
      name: "Cliente Test",
      email,
      phone,
      consent_version: 1,
      ...(referrerId != null ? { referrer_id: referrerId } : {}),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { customer_id: number }).customer_id;
  };

  beforeAll(async () => {
    db = createDatabase(":memory:");
    await migrate(db);
    app = buildApp(db);
    referrerA = db
      .insert(referrers)
      .values({ code: "REF-A", name: "Referente A" })
      .returning()
      .get();
    referrerB = db
      .insert(referrers)
      .values({ code: "REF-B", name: "Referente B" })
      .returning()
      .get();
  });

  it("attributes last-touch: a NEW referrer overwrites the previous one (200 + row changed in DB)", async () => {
    const customerId = await register("attr1@x.com", "5001", referrerA.id);
    expect(getCustomer(customerId)?.referrerId).toBe(referrerA.id);

    const res = await post("/assistant/attribution", {
      customer_id: customerId,
      referrer_id: referrerB.id,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Asserted by reading the DB row, not the response body.
    const after = getCustomer(customerId);
    expect(after?.referrerId).toBe(referrerB.id);
    expect(after?.referrerId).not.toBe(referrerA.id);
  });

  it("does not alter name, email, phone, registeredAt, consentVersion or consentTimestamp", async () => {
    const customerId = await register("attr2@x.com", "5002", referrerA.id);
    const before = getCustomer(customerId);
    expect(before).toBeDefined();

    const res = await post("/assistant/attribution", {
      customer_id: customerId,
      referrer_id: referrerB.id,
    });
    expect(res.status).toBe(200);

    const after = getCustomer(customerId);
    expect(after).toBeDefined();
    // Only referrer_id may change — identity, registration and consent
    // columns are immutable for this call (no re-consent ceremony).
    expect(after?.name).toBe(before?.name);
    expect(after?.email).toBe(before?.email);
    expect(after?.phone).toBe(before?.phone);
    expect(after?.referrerPhone).toBe(before?.referrerPhone);
    expect(after?.registeredAt).toBe(before?.registeredAt);
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.consentVersion).toBe(before?.consentVersion);
    expect(after?.consentTimestamp).toBe(before?.consentTimestamp);
  });

  it("returns 404 for an unknown customer_id", async () => {
    const res = await post("/assistant/attribution", {
      customer_id: 999999,
      referrer_id: referrerB.id,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "customer no encontrado" });
  });

  it("returns 400 for invalid customer_id and referrer_id values", async () => {
    const customerId = await register("attr4@x.com", "5004");

    for (const invalid of [0, -1, "abc", 1.5]) {
      const res = await post("/assistant/attribution", {
        customer_id: invalid,
        referrer_id: referrerB.id,
      });
      expect(res.status).toBe(400);
    }

    // Malformed referrer_id never reaches the FK-protected write.
    for (const invalid of [0, -1, "abc", 1.5]) {
      const res = await post("/assistant/attribution", {
        customer_id: customerId,
        referrer_id: invalid,
      });
      expect(res.status).toBe(400);
    }
  });

  it("returns 401 CONSENT_REQUIRED with a consent object for stale consent, without changing referrer_id", async () => {
    const customerId = await register("attr5@x.com", "5005", referrerA.id);

    // Simulate a consent-text bump: downgrade the stored version below current.
    db.update(customers).set({ consentVersion: 0 }).where(eq(customers.id, customerId)).run();
    expect(getCustomer(customerId)?.consentVersion).toBe(0);

    const res = await post("/assistant/attribution", {
      customer_id: customerId,
      referrer_id: referrerB.id,
    });
    expect(res.status).toBe(401);
    const data = (await res.json()) as { error: string; consent: { version: number; text: string } };
    expect(data.error).toBe("CONSENT_REQUIRED");
    expect(data.consent).toMatchObject({ version: expect.any(Number), text: expect.any(String) });

    // No attribution and no silent consent bump while consent is stale.
    const after = getCustomer(customerId);
    expect(after?.referrerId).toBe(referrerA.id);
    expect(after?.consentVersion).toBe(0);
  });

  it("returns 400 for an unknown referrer_id (invalid input, not a customer 404) and does not write", async () => {
    const customerId = await register("attr6@x.com", "5006", referrerA.id);

    const res = await post("/assistant/attribution", {
      customer_id: customerId,
      referrer_id: 999999,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "referrer_id inválido" });

    // The FK-protected row is untouched.
    expect(getCustomer(customerId)?.referrerId).toBe(referrerA.id);
  });
});
