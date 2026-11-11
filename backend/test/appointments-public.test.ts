import { describe, it, expect, beforeAll } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/index.js";
import { appointmentRequests } from "../src/db/schema.js";
import type { Hono } from "hono";

/**
 * tamizaje-images T2 — PUBLIC landing Booking endpoint (S3: "Landing +
 * CRM + chat").
 *
 * Covered contracts:
 *  - POST /appointments (NO auth, NOT under /assistant or /admin)
 *    {name, phone, reason, email?} → 201 {appointment} with customer_id NULL
 *    and status pendiente · 400 malformed/missing/oversized/bad email
 *  - per-IP in-memory rate limit: max 5 posts / 10 min → 429 on excess
 *    (unauthenticated surface, dependency-free)
 */
describe("public POST /appointments (landing Booking form)", () => {
  let db: Db;
  let app: Hono;
  let ipSeq = 0;

  /** Fresh IP per request so the per-IP rate limit never bleeds across asserts. */
  const nextIp = () => `198.51.100.${++ipSeq}`;

  const post = (path: string, body: unknown, ip: string) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify(body),
    });

  const postRaw = (path: string, raw: string, ip: string) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: raw,
    });

  const validBody = {
    name: "María García",
    phone: "+34611222333",
    email: "maria@example.com",
    reason: "Quiero una cita para el tamizaje presencial",
  };

  beforeAll(async () => {
    db = createDatabase(":memory:");
    await migrate(db);
    app = buildApp(db);
  });

  it("creates a landing request with customer_id NULL and status pendiente (201)", async () => {
    const res = await post("/appointments", validBody, nextIp());
    expect(res.status).toBe(201);
    const body = (await res.json()) as { appointment: Record<string, unknown> };
    expect(body.appointment).toMatchObject({
      customerId: null, // anonymous landing visitor
      name: "María García",
      phone: "+34611222333",
      email: "maria@example.com",
      reason: "Quiero una cita para el tamizaje presencial",
      status: "pendiente",
    });

    const stored = db.select().from(appointmentRequests).where(isNull(appointmentRequests.customerId)).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe(body.appointment.id);
  });

  it("accepts the form without the optional email (201, email NULL)", async () => {
    const { email: _email, ...withoutEmail } = validBody;
    const res = await post("/appointments", withoutEmail, nextIp());
    expect(res.status).toBe(201);
    const body = (await res.json()) as { appointment: Record<string, unknown> };
    expect(body.appointment.email).toBeNull();
    expect(body.appointment.customerId).toBeNull();
  });

  it("rejects malformed JSON and missing/empty required fields with 400", async () => {
    const badJson = await postRaw("/appointments", "nope", nextIp());
    expect(badJson.status).toBe(400);
    expect((await badJson.json()) as object).toEqual({ error: "invalid body" });

    for (const field of ["name", "phone", "reason"] as const) {
      const { [field]: _omitted, ...rest } = validBody;
      const missing = await post("/appointments", rest, nextIp());
      expect(missing.status).toBe(400);
      expect(((await missing.json()) as { error: string }).error).toContain(field);

      const empty = await post("/appointments", { ...rest, [field]: "   " }, nextIp());
      expect(empty.status).toBe(400);
    }
  });

  it("rejects oversized fields and a malformed email with 400", async () => {
    const longName = await post("/appointments", { ...validBody, name: "x".repeat(121) }, nextIp());
    expect(longName.status).toBe(400);
    expect(((await longName.json()) as { error: string }).error).toContain("name");

    const longPhone = await post("/appointments", { ...validBody, phone: "1".repeat(41) }, nextIp());
    expect(longPhone.status).toBe(400);

    const longReason = await post("/appointments", { ...validBody, reason: "x".repeat(501) }, nextIp());
    expect(longReason.status).toBe(400);
    expect(((await longReason.json()) as { error: string }).error).toContain("reason");

    const badEmail = await post("/appointments", { ...validBody, email: "not-an-email" }, nextIp());
    expect(badEmail.status).toBe(400);
    expect(((await badEmail.json()) as { error: string }).error).toContain("email");

    // Rejected payloads persisted nothing.
    const stored = db.select().from(appointmentRequests).all();
    expect(stored).toHaveLength(2); // only the two successful posts above
  });

  it("rate-limits per IP: max 5 posts / 10 min → 429 on excess, other IPs unaffected", async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      const res = await post("/appointments", validBody, ip);
      expect(res.status).toBe(201);
    }

    const excess = await post("/appointments", validBody, ip);
    expect(excess.status).toBe(429);
    expect(((await excess.json()) as { error: string }).error).toContain("requests");

    // A different IP still gets through (the limit is per IP).
    const otherIp = await post("/appointments", validBody, nextIp());
    expect(otherIp.status).toBe(201);

    // The 429 attempt created no extra row.
    const stored = db.select().from(appointmentRequests).all();
    expect(stored).toHaveLength(8); // 2 + 5 + 1 (the 429 wrote nothing)
  });
});
