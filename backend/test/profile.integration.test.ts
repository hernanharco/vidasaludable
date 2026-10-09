import { describe, it, expect, beforeAll } from "vitest";
import { count, eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/index.js";
import { customerProfile } from "../src/db/schema.js";
import type { Hono } from "hono";

/**
 * Integration: per-customer intake profile (T1 of chat-intake).
 *
 * The 5-step chat questionnaire (age/sex, goal, habits, sleep/stress, open
 * note) is persisted deterministically — no LLM involved — so the widget can
 * decide its boot phase (GET before the intake, skip it when a profile exists)
 * and the assistant can later personalize recommendations from the stored row.
 *
 * Covered behaviors, over in-memory SQLite (`createDatabase` + `migrate` +
 * `buildApp`):
 *
 *  1. ROUND TRIP — POST /assistant/profile for a registered customer returns
 *     200 {ok:true} and GET /assistant/profile returns the same values.
 *  2. UPSERT — a second POST updates the SAME row (GET returns the new values
 *     and a drizzle `count()` shows a single row for the customer).
 *  3. VALIDATION — GET with an unknown customer_id → 404; POST with an invalid
 *     customer_id → 400 (same customer checks as /ask and /history).
 *  4. EMPTY STATE — a registered customer with no profile → {profile: null}.
 *
 * No API key and no network: none of these routes touch the Gemini client.
 */
describe("assistant profile (integration: 5-step intake persistence)", () => {
  let db: Db;
  let app: Hono;

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const getProfile = (customerId: number) =>
    app.request(`/assistant/profile?customer_id=${customerId}`);

  const register = async (email: string, phone: string) => {
    const res = await post("/assistant/register", {
      name: "Cliente Test",
      email,
      phone,
      consent_version: 1,
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { customer_id: number }).customer_id;
  };

  beforeAll(async () => {
    db = createDatabase(":memory:");
    await migrate(db);
    app = buildApp(db);
  });

  it("POSTs the intake profile and GET returns the same values", async () => {
    const customerId = await register("perfil1@x.com", "4001");

    const res = await post("/assistant/profile", {
      customer_id: customerId,
      sex: "F",
      age: 34,
      goal: "energía",
      diet: "omnívora",
      activity: "moderada",
      sleep: "7",
      stress: "medio",
      open_note: "me canso por las tardes",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const get = await getProfile(customerId);
    expect(get.status).toBe(200);
    const data = (await get.json()) as { profile: Record<string, unknown> | null };
    expect(data.profile).toMatchObject({
      customer_id: customerId,
      sex: "F",
      age: 34,
      goal: "energía",
      diet: "omnívora",
      activity: "moderada",
      sleep: "7",
      stress: "medio",
      open_note: "me canso por las tardes",
    });
  });

  it("upserts: a second POST updates the row and keeps a single row", async () => {
    const customerId = await register("perfil2@x.com", "4002");

    const first = await post("/assistant/profile", {
      customer_id: customerId,
      sex: "M",
      age: 41,
      goal: "sueño",
      diet: "vegana",
      activity: "leve",
      sleep: "5",
      stress: "alto",
      open_note: "primera versión",
    });
    expect(first.status).toBe(200);

    const second = await post("/assistant/profile", {
      customer_id: customerId,
      sex: "M",
      age: 42,
      goal: "inmunidad",
      diet: "vegetariana",
      activity: "intensa",
      sleep: "8",
      stress: "bajo",
      open_note: "segunda versión",
    });
    expect(second.status).toBe(200);

    const get = await getProfile(customerId);
    expect(get.status).toBe(200);
    const data = (await get.json()) as { profile: Record<string, unknown> | null };
    expect(data.profile).toMatchObject({
      age: 42,
      goal: "inmunidad",
      diet: "vegetariana",
      activity: "intensa",
      sleep: "8",
      stress: "bajo",
      open_note: "segunda versión",
    });

    // Single row per customer — asserted via drizzle select count.
    const rows = db
      .select({ cnt: count() })
      .from(customerProfile)
      .where(eq(customerProfile.customerId, customerId))
      .all();
    expect(rows[0]?.cnt).toBe(1);
  });

  it("returns 404 for GET with an unknown customer and 400 for POST with an invalid customer_id", async () => {
    // Unknown (but well-formed) customer — same 404 semantics as /ask.
    const unknown = await getProfile(999999);
    expect(unknown.status).toBe(404);
    const unknownPost = await post("/assistant/profile", { customer_id: 999999, sex: "F" });
    expect(unknownPost.status).toBe(404);

    // Invalid customer_id values — never reach the customer lookup.
    for (const invalid of [0, -1, "abc"]) {
      const res = await post("/assistant/profile", { customer_id: invalid, sex: "F" });
      expect(res.status).toBe(400);
    }
    // GET mirrors POST: a malformed query param is 400, not a crash.
    const badGet = await app.request("/assistant/profile?customer_id=abc");
    expect(badGet.status).toBe(400);
  });

  it("returns { profile: null } for a registered customer with no profile", async () => {
    const customerId = await register("sinficha@x.com", "4003");

    const get = await getProfile(customerId);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ profile: null });
  });
});
