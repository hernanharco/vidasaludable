import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/index.js";
import { customers, customerImages, bodyMetrics, appointmentRequests } from "../src/db/schema.js";
import { CURRENT_CONSENT_VERSION } from "../src/config/consent.js";
import type { CloudinaryClient } from "../src/services/cloudinaryService.js";
import type { GeminiClient, GeminiGenerateInput } from "../src/agent/gemini.js";
import type { Hono } from "hono";

/**
 * tamizaje-images T2 — customer-facing endpoints (S1 optional record, S2
 * image history, S3 appointment scope), over the standard stack:
 * `:memory:` db + migrate + buildApp with INJECTED fake Cloudinary and fake
 * Gemini (no network, no credentials, no CLOUDINARY_* env).
 *
 * Covered contracts:
 *  - POST /assistant/images        401 CONSENT_REQUIRED (stale version, same
 *    shape as /ask) | 400 customer_id | 404 unknown customer (checked BEFORE
 *    the consent gate) | 400 kind/data | 413 >8MB | 201 {image} with
 *    uploaded_by='customer'
 *  - GET  /assistant/images?customer_id=N → {images} newest first, no consent
 *    gate on read (mirrors /history), 400/404
 *  - POST /assistant/body-metrics → consent 401; measured_at required + 17
 *    numeric fields + source/notes (same shape as the admin POST) → 201
 *    create / 200 upsert; 400/404
 *  - GET  /assistant/body-metrics?customer_id=N → {bodyMetrics}, no consent
 *    gate on read, 400/404
 *  - POST /assistant/appointments → NO consent gate (contact request, same
 *    precedent as /conversations) → 201 {appointment} status pendiente;
 *    400 (reason) / 404
 *  - GET  /assistant/appointments?customer_id=N → {appointments} the
 *    customer's OWN rows only (isolation), 400/404
 *  - POST /assistant/ask injects the latest body_metrics row into the system
 *    prompt (bodyMetricsBlock present with data, absent without)
 */

/** Fake Cloudinary: records uploads, returns deterministic refs (no network). */
interface FakeCloudinary extends CloudinaryClient {
  uploadCalls: string[];
  failUploadWith: Error | null;
}

function createFakeCloudinary(): FakeCloudinary {
  const uploadCalls: string[] = [];
  return {
    uploadCalls,
    failUploadWith: null,
    isConfigured: () => true,
    async upload(data) {
      if (this.failUploadWith) throw this.failUploadWith;
      uploadCalls.push(data);
      const n = uploadCalls.length;
      return {
        public_id: `demo/cliente_${n}`,
        secure_url: `https://res.cloudinary.com/demo/image/upload/cliente_${n}.png`,
      };
    },
    destroy() {
      return Promise.resolve(true);
    },
  };
}

/** Small valid base64 payload (raw, no data-URI prefix). */
const TINY_B64 = Buffer.from("tiny-image-bytes").toString("base64");

describe("assistant tamizaje endpoints (T2: images, body metrics, appointments)", () => {
  let db: Db;
  let app: Hono;
  let fake: FakeCloudinary;
  let seq = 0;
  /** Captured system prompts from the fake Gemini (one per /ask call). */
  const prompts: string[] = [];

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const postRaw = (path: string, raw: string) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
    });

  /** Unique email + phone per customer (both columns are UNIQUE). */
  function createCustomer(name: string, consentVersion = CURRENT_CONSENT_VERSION): number {
    const n = ++seq;
    const now = new Date().toISOString();
    return db
      .insert(customers)
      .values({
        name,
        email: `${name.toLowerCase().replace(/\s+/g, "-")}-${n}@example.com`,
        phone: `+34600${String(n).padStart(7, "0")}`,
        consentVersion,
        consentTimestamp: now,
        registeredAt: now,
      })
      .returning()
      .get().id;
  }

  beforeAll(async () => {
    db = createDatabase(":memory:");
    await migrate(db);
    fake = createFakeCloudinary();
    const fakeGemini: GeminiClient = {
      isConfigured: () => true,
      generate: async (input: GeminiGenerateInput) => {
        prompts.push(input.systemPrompt);
        return "Respuesta falsa segura del agente.";
      },
    };
    app = buildApp(db, { cloudinaryClient: fake, geminiClient: fakeGemini });
  });

  // --- POST /assistant/images ---

  it("POST /assistant/images rejects stale consent with 401 CONSENT_REQUIRED (no upload)", async () => {
    const staleId = createCustomer("Consent Viejo", 1);
    const before = fake.uploadCalls.length;

    const res = await post("/assistant/images", {
      customer_id: staleId,
      data: TINY_B64,
      kind: "tamizaje",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      error: string;
      consent: { version: number; text: string };
    };
    expect(body.error).toBe("CONSENT_REQUIRED");
    expect(body.consent.version).toBe(CURRENT_CONSENT_VERSION);
    expect(typeof body.consent.text).toBe("string");
    expect(body.consent.text.length).toBeGreaterThan(0);
    expect(fake.uploadCalls.length).toBe(before); // never uploaded
    expect(
      db.select().from(customerImages).where(eq(customerImages.customerId, staleId)).all(),
    ).toHaveLength(0);
  });

  it("POST /assistant/images validates the customer (400/404) BEFORE the consent gate", async () => {
    const before = fake.uploadCalls.length;

    const badId = await post("/assistant/images", { customer_id: "abc", data: TINY_B64, kind: "otro" });
    expect(badId.status).toBe(400);
    expect((await badId.json()) as object).toEqual({ error: "customer_id inválido" });

    const missing = await post("/assistant/images", { data: TINY_B64, kind: "otro" });
    expect(missing.status).toBe(400);

    // Unknown customer → 404 even before any consent evaluation.
    const unknown = await post("/assistant/images", {
      customer_id: 999999,
      data: TINY_B64,
      kind: "otro",
    });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()) as object).toEqual({ error: "customer no encontrado" });

    const badJson = await postRaw("/assistant/images", "nope");
    expect(badJson.status).toBe(400);
    expect((await badJson.json()) as object).toEqual({ error: "cuerpo inválido" });

    expect(fake.uploadCalls.length).toBe(before);
  });

  it("POST /assistant/images uploads via Cloudinary and records uploaded_by=customer (201)", async () => {
    const customerId = createCustomer("Subida Cliente");
    const before = fake.uploadCalls.length;

    const res = await post("/assistant/images", {
      customer_id: customerId,
      data: TINY_B64,
      kind: "tamizaje",
      taken_at: "2026-11-11",
      notes: "reporte RENPHO",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { image: Record<string, unknown> };
    expect(fake.uploadCalls.length).toBe(before + 1);
    expect(fake.uploadCalls[before]).toBe(TINY_B64);
    expect(body.image).toMatchObject({
      customerId,
      kind: "tamizaje",
      cloudinaryPublicId: "demo/cliente_1",
      cloudinarySecureUrl: "https://res.cloudinary.com/demo/image/upload/cliente_1.png",
      takenAt: "2026-11-11",
      uploadedBy: "customer", // the customer surface records who uploaded
      notes: "reporte RENPHO",
    });

    const stored = db
      .select()
      .from(customerImages)
      .where(eq(customerImages.customerId, customerId))
      .all();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.uploadedBy).toBe("customer");
  });

  it("POST /assistant/images rejects kind/data/size with 400/413 before uploading", async () => {
    const customerId = createCustomer("Validación Imagen");
    const before = fake.uploadCalls.length;

    const badKind = await post("/assistant/images", {
      customer_id: customerId,
      data: TINY_B64,
      kind: "avance",
    });
    expect(badKind.status).toBe(400);
    expect(((await badKind.json()) as { error: string }).error).toContain("kind");

    const missingData = await post("/assistant/images", { customer_id: customerId, kind: "otro" });
    expect(missingData.status).toBe(400);

    const badBase64 = await post("/assistant/images", {
      customer_id: customerId,
      data: "not valid base64!!",
      kind: "otro",
    });
    expect(badBase64.status).toBe(400);

    // ~8MB + 4 bytes once decoded → 413 (same cap as the admin endpoint).
    const oversized = "A".repeat(Math.ceil((8 * 1024 * 1024) / 3) * 4 + 4);
    const tooBig = await post("/assistant/images", {
      customer_id: customerId,
      data: oversized,
      kind: "tamizaje",
    });
    expect(tooBig.status).toBe(413);
    expect(((await tooBig.json()) as { error: string }).error).toContain("8MB");

    expect(fake.uploadCalls.length).toBe(before); // nothing was uploaded
    expect(
      db.select().from(customerImages).where(eq(customerImages.customerId, customerId)).all(),
    ).toHaveLength(0);
  });

  it("POST /assistant/images accepts a full data URI payload (201) and maps upload failures to 502", async () => {
    const customerId = createCustomer("Data URI Cliente");

    // `data` as a full data URI (the spec's base64|dataURI contract).
    const dataUri = `data:image/png;base64,${TINY_B64}`;
    const res = await post("/assistant/images", {
      customer_id: customerId,
      data: dataUri,
      kind: "otro",
    });
    expect(res.status).toBe(201);
    expect(fake.uploadCalls.at(-1)).toBe(dataUri); // payload passed verbatim

    // Cloudinary failure surfaces as 502 and records NOTHING (same mapping
    // as the admin route — shared ingest, proven here on the customer path).
    fake.failUploadWith = new Error("cloudinary: upload failed — Invalid signature");
    try {
      const failed = await post("/assistant/images", {
        customer_id: customerId,
        data: TINY_B64,
        kind: "tamizaje",
      });
      expect(failed.status).toBe(502);
      expect((await failed.json()) as object).toEqual({ error: "cloudinary upload failed" });
      const stored = db
        .select()
        .from(customerImages)
        .where(eq(customerImages.customerId, customerId))
        .all();
      expect(stored).toHaveLength(1); // only the successful data-URI upload
    } finally {
      fake.failUploadWith = null;
    }
  });

  // --- GET /assistant/images ---

  it("GET /assistant/images returns the customer's images newest first, without a consent gate", async () => {
    const customerId = createCustomer("Lista Imágenes");
    const otherId = createCustomer("Otra Lista Imágenes");
    const staleId = createCustomer("Lectura Sin Consent", 1);

    // Two uploads → ids ascending; newest first means the later id first.
    for (const takenAt of ["2026-11-10", "2026-11-11"]) {
      const res = await post("/assistant/images", {
        customer_id: customerId,
        data: TINY_B64,
        kind: "evolucion",
        taken_at: takenAt,
      });
      expect(res.status).toBe(201);
    }

    const res = await app.request(`/assistant/images?customer_id=${customerId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { images: Array<Record<string, unknown>> };
    expect(body.images).toHaveLength(2);
    expect(body.images[0]!.takenAt).toBe("2026-11-11"); // newest first
    expect(body.images[0]!.id).toBeGreaterThan(body.images[1]!.id as number);
    expect(body.images.every((row) => row.customerId === customerId)).toBe(true);

    // Another customer sees nothing of ours (isolation by query).
    const other = await app.request(`/assistant/images?customer_id=${otherId}`);
    expect(other.status).toBe(200);
    expect(((await other.json()) as { images: unknown[] }).images).toEqual([]);

    // Reads are NOT consent-gated (mirror /history): stale consent still reads.
    const stale = await app.request(`/assistant/images?customer_id=${staleId}`);
    expect(stale.status).toBe(200);

    const badId = await app.request("/assistant/images?customer_id=abc");
    expect(badId.status).toBe(400);
    const unknown = await app.request("/assistant/images?customer_id=999999");
    expect(unknown.status).toBe(404);
    const missing = await app.request("/assistant/images");
    expect(missing.status).toBe(400);
  });

  // --- POST /assistant/body-metrics ---

  it("POST /assistant/body-metrics rejects stale consent with 401 CONSENT_REQUIRED", async () => {
    const staleId = createCustomer("Métricas Consent Viejo", 1);

    const res = await post("/assistant/body-metrics", {
      customer_id: staleId,
      measured_at: "2026-11-11",
      weight_kg: 77.85,
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; consent: { version: number } };
    expect(body.error).toBe("CONSENT_REQUIRED");
    expect(body.consent.version).toBe(CURRENT_CONSENT_VERSION);
    expect(
      db.select().from(bodyMetrics).where(eq(bodyMetrics.customerId, staleId)).all(),
    ).toHaveLength(0);
  });

  it("POST /assistant/body-metrics creates (201) and upserts by measured_at (200) like the admin POST", async () => {
    const customerId = createCustomer("Tanita Cliente");
    const base = `/assistant/body-metrics`;

    const created = await post(base, {
      customer_id: customerId,
      measured_at: "2026-11-11",
      weight_kg: 77.85,
      bmi: 26.3,
      body_fat_pct: 26.9,
      source: "RENPHO",
      notes: "reporte RENPHO",
    });
    expect(created.status).toBe(201);
    const first = ((await created.json()) as { bodyMetric: Record<string, unknown> }).bodyMetric;
    expect(first).toMatchObject({
      customerId,
      measuredAt: "2026-11-11",
      weightKg: 77.85,
      bmi: 26.3,
      bodyFatPct: 26.9,
      source: "RENPHO",
      notes: "reporte RENPHO",
    });

    // Same date → upsert (200): provided fields replace, absent fields merge.
    const updated = await post(base, { customer_id: customerId, measured_at: "2026-11-11", weight_kg: 77.5 });
    expect(updated.status).toBe(200);
    const second = ((await updated.json()) as { bodyMetric: Record<string, unknown> }).bodyMetric;
    expect(second.id).toBe(first.id);
    expect(second.weightKg).toBe(77.5);
    expect(second.bmi).toBe(26.3); // untouched by the partial update
  });

  it("POST /assistant/body-metrics validates measured_at, numeric fields and the customer (400/404)", async () => {
    const customerId = createCustomer("Validación Cliente");
    const base = `/assistant/body-metrics`;

    const noDate = await post(base, { customer_id: customerId, weight_kg: 70 });
    expect(noDate.status).toBe(400);
    expect(((await noDate.json()) as { error: string }).error).toContain("measured_at");

    const notNumeric = await post(base, {
      customer_id: customerId,
      measured_at: "2026-11-11",
      weight_kg: "pesado",
    });
    expect(notNumeric.status).toBe(400);
    expect(((await notNumeric.json()) as { error: string }).error).toContain("weight_kg");

    const badSource = await post(base, {
      customer_id: customerId,
      measured_at: "2026-11-11",
      source: "otra-cosa",
    });
    expect(badSource.status).toBe(400);

    const badId = await post(base, { customer_id: "abc", measured_at: "2026-11-11" });
    expect(badId.status).toBe(400);

    const unknown = await post(base, { customer_id: 999999, measured_at: "2026-11-11" });
    expect(unknown.status).toBe(404);

    // Unknown customer wins over stale consent (400/404 checked FIRST, like /ask).
    const staleUnknown = await post("/assistant/body-metrics", {
      customer_id: 999999,
      measured_at: "2026-11-11",
    });
    expect(staleUnknown.status).toBe(404);

    // Nothing was persisted by the rejected payloads.
    expect(
      db.select().from(bodyMetrics).where(eq(bodyMetrics.customerId, customerId)).all(),
    ).toHaveLength(0);
  });

  // --- GET /assistant/body-metrics ---

  it("GET /assistant/body-metrics returns the record list without a consent gate (400/404)", async () => {
    const customerId = createCustomer("Lista Métricas");
    const staleId = createCustomer("Lista Métricas Sin Consent", 1);

    const empty = await app.request(`/assistant/body-metrics?customer_id=${customerId}`);
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { bodyMetrics: unknown[] }).bodyMetrics).toEqual([]);

    db.insert(bodyMetrics)
      .values({ customerId, measuredAt: "2026-11-10", weightKg: 78, source: "RENPHO" })
      .run();

    const res = await app.request(`/assistant/body-metrics?customer_id=${customerId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bodyMetrics: Array<Record<string, unknown>> };
    expect(body.bodyMetrics).toHaveLength(1);
    expect(body.bodyMetrics[0]).toMatchObject({ customerId, measuredAt: "2026-11-10", weightKg: 78 });

    // Read works with stale consent (mirror /history), 400/404 conventions.
    const stale = await app.request(`/assistant/body-metrics?customer_id=${staleId}`);
    expect(stale.status).toBe(200);

    const badId = await app.request("/assistant/body-metrics?customer_id=abc");
    expect(badId.status).toBe(400);
    const unknown = await app.request("/assistant/body-metrics?customer_id=999999");
    expect(unknown.status).toBe(404);
  });

  // --- POST /assistant/appointments (no consent gate) ---

  it("POST /assistant/appointments creates a pendiente request WITHOUT a consent gate", async () => {
    // Stale consent still succeeds: it is a contact request (same precedent
    // as POST /assistant/conversations).
    const staleId = createCustomer("Pide Cita Sin Consent", 1);

    const res = await post("/assistant/appointments", {
      customer_id: staleId,
      reason: "Quiero el tamizaje presencial",
      notes: "prefiero por la tarde",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { appointment: Record<string, unknown> };
    expect(body.appointment).toMatchObject({
      customerId: staleId,
      reason: "Quiero el tamizaje presencial",
      notes: "prefiero por la tarde",
      status: "pendiente",
    });

    const stored = db
      .select()
      .from(appointmentRequests)
      .where(eq(appointmentRequests.customerId, staleId))
      .all();
    expect(stored).toHaveLength(1);
  });

  it("POST /assistant/appointments validates reason and the customer (400/404)", async () => {
    const customerId = createCustomer("Cita Validación");
    const before = db.select().from(appointmentRequests).all().length;

    const noReason = await post("/assistant/appointments", { customer_id: customerId });
    expect(noReason.status).toBe(400);
    expect(((await noReason.json()) as { error: string }).error).toContain("reason");

    const emptyReason = await post("/assistant/appointments", {
      customer_id: customerId,
      reason: "   ",
    });
    expect(emptyReason.status).toBe(400);

    const hugeReason = await post("/assistant/appointments", {
      customer_id: customerId,
      reason: "x".repeat(501),
    });
    expect(hugeReason.status).toBe(400);

    const badId = await post("/assistant/appointments", { customer_id: "abc", reason: "Cita" });
    expect(badId.status).toBe(400);

    const unknown = await post("/assistant/appointments", {
      customer_id: 999999,
      reason: "Cita",
    });
    expect(unknown.status).toBe(404);

    const badJson = await postRaw("/assistant/appointments", "nope");
    expect(badJson.status).toBe(400);

    const after = db.select().from(appointmentRequests).all().length;
    expect(after).toBe(before);
  });

  // --- GET /assistant/appointments (own rows only) ---

  it("GET /assistant/appointments returns only the customer's own rows (isolation)", async () => {
    const customerA = createCustomer("Cita A");
    const customerB = createCustomer("Cita B");
    const staleId = createCustomer("Cita Lectura", 1);

    await post("/assistant/appointments", { customer_id: customerA, reason: "Cita de A" });
    await post("/assistant/appointments", { customer_id: customerB, reason: "Cita de B" });
    // Landing (public form) row: customer_id NULL — never returned to anyone
    // through the customer read.
    db.insert(appointmentRequests)
      .values({ customerId: null, name: "Visitante", phone: "+34611111111", reason: "Landing" })
      .run();

    const resA = await app.request(`/assistant/appointments?customer_id=${customerA}`);
    expect(resA.status).toBe(200);
    const bodyA = (await resA.json()) as { appointments: Array<Record<string, unknown>> };
    expect(bodyA.appointments).toHaveLength(1);
    expect(bodyA.appointments[0]).toMatchObject({ customerId: customerA, reason: "Cita de A" });

    const resB = await app.request(`/assistant/appointments?customer_id=${customerB}`);
    const bodyB = (await resB.json()) as { appointments: Array<Record<string, unknown>> };
    expect(bodyB.appointments).toHaveLength(1);
    expect(bodyB.appointments[0]).toMatchObject({ customerId: customerB, reason: "Cita de B" });

    // Reads are not consent-gated (mirror /history).
    const stale = await app.request(`/assistant/appointments?customer_id=${staleId}`);
    expect(stale.status).toBe(200);
    expect(((await stale.json()) as { appointments: unknown[] }).appointments).toEqual([]);

    const badId = await app.request("/assistant/appointments?customer_id=abc");
    expect(badId.status).toBe(400);
    const unknown = await app.request("/assistant/appointments?customer_id=999999");
    expect(unknown.status).toBe(404);
  });

  // --- Prompt wiring: bodyMetricsBlock reaches /ask's system prompt ---

  it("POST /assistant/ask injects the latest body-metrics block only when data exists", async () => {
    const withData = createCustomer("Ask Con Métricas");
    const withoutData = createCustomer("Ask Sin Métricas");
    db.insert(bodyMetrics)
      .values({ customerId: withData, measuredAt: "2026-11-11", weightKg: 77.85, bodyFatPct: 26.9, source: "RENPHO" })
      .run();

    const before = prompts.length;
    const first = await post("/assistant/ask", { customer_id: withData, message: "hola" });
    expect(first.status).toBe(200);
    expect(prompts.length).toBe(before + 1);
    expect(prompts[before]).toContain("COMPOSICIÓN CORPORAL");

    const second = await post("/assistant/ask", { customer_id: withoutData, message: "hola" });
    expect(second.status).toBe(200);
    expect(prompts.length).toBe(before + 2);
    expect(prompts[before + 1]).not.toContain("COMPOSICIÓN CORPORAL");
  });
});
