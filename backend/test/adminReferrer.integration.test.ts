import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { createAdminReferrerRouter } from "../src/routes/adminReferrer.js";
import { customers, referrers } from "../src/db/schema.js";

/**
 * Regression: GET /admin/referrers miscounted `customerCount` in production.
 *
 * The COUNT subquery interpolated Drizzle columns WITHOUT table qualifiers, so
 * SQLite resolved `referrer_id = id` INSIDE the subquery (customers comparing
 * itself) and always returned 0 whenever the customer's id differed from the
 * referrer's id. The expanded customer list uses `eq()` (properly qualified),
 * so the panel showed the customer row while the badge said 0.
 *
 * This test mirrors the production data shape: referrer id=1, a customer whose
 * id differs (id=2) and whose `referrer_id` points at the referrer.
 */
describe("GET /admin/referrers customerCount (integration)", () => {
  let db: Db;
  let app: Hono;

  beforeAll(async () => {
    db = createDatabase(":memory:");
    await migrate(db);
    app = createAdminReferrerRouter(db);

    const referrer = db
      .insert(referrers)
      .values({ code: "1906432239", name: "Hernan Arango Cortes" })
      .returning()
      .get();

    // First customer: unrelated (no referrer). It exists so the attributed
    // customer below gets id=2 while the referrer keeps id=1 — the exact
    // production shape where the unqualified subquery failed.
    db.insert(customers)
      .values({
        name: "Sin Referente",
        email: "otro@example.com",
        phone: "+34000000000",
        consentVersion: 1,
        consentTimestamp: "2026-01-01T00:00:00Z",
        registeredAt: "2026-01-01T00:00:00Z",
      })
      .run();

    db.insert(customers)
      .values({
        name: "Hernan Arango Cortes",
        email: "hernan.harco@gmail.com",
        phone: "+34634405549",
        consentVersion: 1,
        consentTimestamp: "2026-10-10T17:25:16.153Z",
        registeredAt: "2026-10-10T17:25:16.153Z",
        referrerId: referrer.id,
      })
      .run();
  });

  it("counts attributed customers even when customer id ≠ referrer id", async () => {
    const res = await app.request("/");
    const body = (await res.json()) as {
      referrers: {
        code: string;
        customerCount: number;
        customers: { id: number; email: string }[];
      }[];
    };

    const r = body.referrers.find((x) => x.code === "1906432239");
    expect(r).toBeDefined();
    expect(r!.customers.length).toBe(1);
    expect(r!.customerCount).toBe(1);
    expect(r!.customerCount).toBe(r!.customers.length);
  });
});
