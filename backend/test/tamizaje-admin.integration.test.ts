import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/index.js";
import {
  customers,
  customerImages,
  bodyMetrics,
  appointmentRequests,
} from "../src/db/schema.js";
import type { CloudinaryClient } from "../src/services/cloudinaryService.js";
import type { Hono } from "hono";

/**
 * tamizaje-images T1 — admin endpoints (S2 image history, S3 appointment
 * scope), over the standard stack: `:memory:` db + migrate + buildApp, with
 * the central /admin/* JWT guard open in development (auth lives in
 * test/admin-auth.test.ts).
 *
 * The Cloudinary client is INJECTED (geminiClient DI pattern), so the whole
 * suite runs with no CLOUDINARY_* env set and no network.
 *
 * Covered contracts:
 *  - GET  /admin/customers/:id/images        200 {images} | 404 | 400
 *  - POST /admin/customers/:id/images        201 {image}  | 404 | 400 (kind,
 *    data, base64) | 413 (>8MB decoded) | 502 (upload failed) | 500
 *    (unconfigured — boot stays healthy)
 *  - GET  /admin/customers/:id/body-metrics  200 {bodyMetrics} | 404 | 400
 *  - POST /admin/customers/:id/body-metrics  201 create / 200 upsert by
 *    measured_at (partial merge) | 400 | 404
 *  - GET  /admin/appointments                200 {appointments} (CRM + landing)
 *  - PATCH /admin/appointments/:id           200 {appointment} | 404 |
 *    400 (invalid id/body/status/nothing to update)
 *  - DELETE /admin/customers/:id             204 removing body_metrics,
 *    customer_images and appointment_requests, with Cloudinary destroy as a
 *    BEST-EFFORT side effect (failures never block the delete).
 */

interface FakeCloudinary extends CloudinaryClient {
  uploadCalls: Array<{ data: string; options: { folder?: string } | undefined }>;
  destroyCalls: string[];
  failUploadWith: Error | null;
  destroyMode: "ok" | "reject" | "throw";
}

function createFakeCloudinary(): FakeCloudinary {
  const uploadCalls: FakeCloudinary["uploadCalls"] = [];
  const destroyCalls: string[] = [];
  return {
    uploadCalls,
    destroyCalls,
    failUploadWith: null,
    destroyMode: "ok",
    isConfigured: () => true,
    async upload(data, options) {
      if (this.failUploadWith) throw this.failUploadWith;
      uploadCalls.push({ data, options });
      const n = uploadCalls.length;
      return {
        public_id: `demo/tamizaje_${n}`,
        secure_url: `https://res.cloudinary.com/demo/image/upload/tamizaje_${n}.png`,
      };
    },
    destroy(publicId) {
      destroyCalls.push(publicId);
      if (this.destroyMode === "throw") throw new Error("sync boom — best-effort must survive");
      if (this.destroyMode === "reject") return Promise.reject(new Error("cloudinary down"));
      return Promise.resolve(true);
    },
  };
}

/** Small valid base64 payload (raw, no data-URI prefix). */
const TINY_B64 = Buffer.from("tiny-image-bytes").toString("base64");

describe("admin tamizaje endpoints (T1: images, body metrics, appointments)", () => {
  let db: Db;
  let app: Hono;
  let fake: FakeCloudinary;
  let previousNodeEnv: string | undefined;

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const patch = (path: string, body: unknown) =>
    app.request(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  function createCustomer(name: string, email: string): number {
    const now = new Date().toISOString();
    return db
      .insert(customers)
      .values({ name, email, phone: `+346${Math.floor(Math.random() * 1e8)}`, consentVersion: 2, consentTimestamp: now, registeredAt: now })
      .returning()
      .get().id;
  }

  const rows = <T>(table: { where: unknown }, customerId: number): T[] =>
    db.select().from(table as never).where(eq((table as never).customerId, customerId)).all() as T[];

  beforeAll(async () => {
    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    db = createDatabase(":memory:");
    await migrate(db);
    fake = createFakeCloudinary();
    app = buildApp(db, { cloudinaryClient: fake });
  });

  afterAll(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  // --- Images (S2: Cloudinary history, no binaries in SQLite) ---

  it("GET /admin/customers/:id/images returns the image history", async () => {
    const customerId = createCustomer("Cliente Imágenes", "imagenes@example.com");
    // Seed a previous upload directly (what POST will persist).
    db.insert(customerImages)
      .values({
        customerId,
        kind: "evolucion",
        cloudinaryPublicId: "demo/anterior",
        cloudinarySecureUrl: "https://res.cloudinary.com/demo/image/upload/anterior.png",
        takenAt: "2026-10-01",
        uploadedBy: "admin",
        notes: "foto anterior",
      })
      .run();

    const res = await app.request(`/admin/customers/${customerId}/images`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { images: Array<Record<string, unknown>> };
    expect(body.images).toHaveLength(1);
    expect(body.images[0]).toMatchObject({
      customerId,
      kind: "evolucion",
      cloudinaryPublicId: "demo/anterior",
      cloudinarySecureUrl: "https://res.cloudinary.com/demo/image/upload/anterior.png",
      takenAt: "2026-10-01",
      uploadedBy: "admin",
    });

    // A customer with no history gets an empty list, not an error.
    const emptyId = createCustomer("Sin Imágenes", "sin-imagenes@example.com");
    const empty = await app.request(`/admin/customers/${emptyId}/images`);
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { images: unknown[] }).images).toEqual([]);
  });

  it("GET images 404s an unknown customer and 400s a malformed id", async () => {
    const missing = await app.request("/admin/customers/999999/images");
    expect(missing.status).toBe(404);
    expect((await missing.json()) as object).toEqual({ error: "customer not found" });

    const badId = await app.request("/admin/customers/abc/images");
    expect(badId.status).toBe(400);
    expect((await badId.json()) as object).toEqual({ error: "invalid id" });
  });

  it("POST /admin/customers/:id/images uploads via Cloudinary and records uploaded_by=admin", async () => {
    const customerId = createCustomer("Subida Admin", "subida@example.com");
    const before = fake.uploadCalls.length;

    const res = await post(`/admin/customers/${customerId}/images`, {
      data: TINY_B64,
      kind: "tamizaje",
      taken_at: "2026-11-11",
      notes: "reporte RENPHO",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { image: Record<string, unknown> };
    // The proxy passed the raw payload to the (fake) client…
    expect(fake.uploadCalls.length).toBe(before + 1);
    expect(fake.uploadCalls[before]!.data).toBe(TINY_B64);
    // …and registered only the Cloudinary refs, never the binary.
    expect(body.image).toMatchObject({
      customerId,
      kind: "tamizaje",
      cloudinaryPublicId: "demo/tamizaje_1",
      cloudinarySecureUrl: "https://res.cloudinary.com/demo/image/upload/tamizaje_1.png",
      takenAt: "2026-11-11",
      uploadedBy: "admin",
      notes: "reporte RENPHO",
    });

    const stored = rows<{ cloudinary_public_id: string }>(customerImages, customerId);
    expect(stored).toHaveLength(1);
  });

  it("POST images rejects an invalid kind with 400 before touching Cloudinary", async () => {
    const customerId = createCustomer("Kind Malo", "kind-malo@example.com");
    const before = fake.uploadCalls.length;

    const res = await post(`/admin/customers/${customerId}/images`, {
      data: TINY_B64,
      kind: "avance",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("kind");
    expect(fake.uploadCalls.length).toBe(before); // never uploaded

    const missingKind = await post(`/admin/customers/${customerId}/images`, { data: TINY_B64 });
    expect(missingKind.status).toBe(400);

    const missingData = await post(`/admin/customers/${customerId}/images`, { kind: "otro" });
    expect(missingData.status).toBe(400);

    const badBase64 = await post(`/admin/customers/${customerId}/images`, {
      data: "not valid base64!!",
      kind: "otro",
    });
    expect(badBase64.status).toBe(400);

    const badJson = await app.request(`/admin/customers/${customerId}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "nope",
    });
    expect(badJson.status).toBe(400);
    expect((await badJson.json()) as object).toEqual({ error: "invalid body" });
  });

  it("POST images rejects payloads over the 8MB decoded cap with 413", async () => {
    const customerId = createCustomer("Gigante", "gigante@example.com");
    const before = fake.uploadCalls.length;
    // ~8MB + 4 bytes once decoded.
    const oversized = "A".repeat(Math.ceil((8 * 1024 * 1024) / 3) * 4 + 4);

    const res = await post(`/admin/customers/${customerId}/images`, {
      data: oversized,
      kind: "tamizaje",
    });
    expect(res.status).toBe(413);
    expect(fake.uploadCalls.length).toBe(before); // rejected before upload
    expect(rows(customerImages, customerId)).toHaveLength(0);
  });

  it("POST images 404s an unknown customer before uploading", async () => {
    const before = fake.uploadCalls.length;
    const res = await post("/admin/customers/999999/images", { data: TINY_B64, kind: "tamizaje" });
    expect(res.status).toBe(404);
    expect((await res.json()) as object).toEqual({ error: "customer not found" });
    expect(fake.uploadCalls.length).toBe(before);
  });

  it("POST images maps a Cloudinary upload failure to 502 without recording anything", async () => {
    const customerId = createCustomer("Falla Subida", "falla-subida@example.com");
    fake.failUploadWith = new Error("cloudinary: upload failed — Invalid signature");
    try {
      const res = await post(`/admin/customers/${customerId}/images`, {
        data: TINY_B64,
        kind: "tamizaje",
      });
      expect(res.status).toBe(502);
      expect((await res.json()) as object).toEqual({ error: "cloudinary upload failed" });
      expect(rows(customerImages, customerId)).toHaveLength(0);
    } finally {
      fake.failUploadWith = null;
    }
  });

  it("POST images fails with a clear 500 when Cloudinary is unconfigured — boot stays healthy", async () => {
    const envKeys = [
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
      "CLOUDINARY_FOLDER",
    ] as const;
    const previous = envKeys.map((key) => [key, process.env[key]] as const);
    for (const key of envKeys) delete process.env[key];
    try {
      // No injected client + no env: building the app must NOT crash (the
      // factory reads config lazily and fails only at call time).
      const bare = buildApp(db);
      const customerId = createCustomer("Sin Credenciales", "sin-credenciales@example.com");

      const res = await bare.request(`/admin/customers/${customerId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: TINY_B64, kind: "tamizaje" }),
      });
      expect(res.status).toBe(500);
      expect((await res.json()) as object).toEqual({ error: "cloudinary not configured" });
      expect(rows(customerImages, customerId)).toHaveLength(0);
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  // --- Body metrics (S1: optional, never-blocking record) ---

  it("GET /admin/customers/:id/body-metrics returns the record list", async () => {
    const customerId = createCustomer("Métricas", "metricas@example.com");
    const empty = await app.request(`/admin/customers/${customerId}/body-metrics`);
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { bodyMetrics: unknown[] }).bodyMetrics).toEqual([]);

    db.insert(bodyMetrics)
      .values({ customerId, measuredAt: "2026-11-10", weightKg: 78, source: "RENPHO" })
      .run();

    const res = await app.request(`/admin/customers/${customerId}/body-metrics`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bodyMetrics: Array<Record<string, unknown>> };
    expect(body.bodyMetrics).toHaveLength(1);
    expect(body.bodyMetrics[0]).toMatchObject({ customerId, measuredAt: "2026-11-10", weightKg: 78, source: "RENPHO" });
  });

  it("POST body-metrics creates (201) and upserts by measured_at (200) merging partial records", async () => {
    const customerId = createCustomer("Tanita", "tanita@example.com");
    const base = `/admin/customers/${customerId}/body-metrics`;

    const created = await post(base, {
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
    const updated = await post(base, { measured_at: "2026-11-11", weight_kg: 77.5 });
    expect(updated.status).toBe(200);
    const second = ((await updated.json()) as { bodyMetric: Record<string, unknown> }).bodyMetric;
    expect(second.id).toBe(first.id);
    expect(second.weightKg).toBe(77.5);
    expect(second.bmi).toBe(26.3); // untouched
    expect(second.source).toBe("RENPHO"); // untouched
    expect(second.notes).toBe("reporte RENPHO"); // untouched

    // A different date is a different record (partial records are valid).
    const otherDay = await post(base, { measured_at: "2026-11-12", weight_kg: 77.2 });
    expect(otherDay.status).toBe(201);

    const list = await app.request(base);
    const body = (await list.json()) as { bodyMetrics: Array<{ measuredAt: string }> };
    expect(body.bodyMetrics).toHaveLength(2);
    expect(body.bodyMetrics.map((row) => row.measuredAt).sort()).toEqual(["2026-11-11", "2026-11-12"]);
  });

  it("POST body-metrics validates measured_at, numeric fields and source", async () => {
    const customerId = createCustomer("Validación Métricas", "validacion-metricas@example.com");
    const base = `/admin/customers/${customerId}/body-metrics`;

    const noDate = await post(base, { weight_kg: 70 });
    expect(noDate.status).toBe(400);
    expect(((await noDate.json()) as { error: string }).error).toContain("measured_at");

    const notNumeric = await post(base, { measured_at: "2026-11-11", weight_kg: "pesado" });
    expect(notNumeric.status).toBe(400);
    expect(((await notNumeric.json()) as { error: string }).error).toContain("weight_kg");

    const badSource = await post(base, { measured_at: "2026-11-11", source: "otra-cosa" });
    expect(badSource.status).toBe(400);

    const badBody = await app.request(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "nope",
    });
    expect(badBody.status).toBe(400);

    // Nothing was persisted by the rejected payloads.
    expect(rows(bodyMetrics, customerId)).toHaveLength(0);
  });

  it("body-metrics endpoints 404 an unknown customer", async () => {
    const get = await app.request("/admin/customers/999999/body-metrics");
    expect(get.status).toBe(404);
    expect((await get.json()) as object).toEqual({ error: "customer not found" });

    const postRes = await post("/admin/customers/999999/body-metrics", {
      measured_at: "2026-11-11",
      weight_kg: 70,
    });
    expect(postRes.status).toBe(404);

    const badId = await app.request("/admin/customers/abc/body-metrics");
    expect(badId.status).toBe(400);
  });

  // --- Appointment requests (S3: landing + CRM + chat) ---

  it("GET /admin/appointments lists CRM requests and public landing requests", async () => {
    const customerId = createCustomer("Pide Cita", "pide-cita@example.com");
    db.insert(appointmentRequests)
      .values({ customerId, reason: "Quiero tamizaje desde el chat" })
      .run();
    // Landing Booking form: customer_id NULL (anonymous visitor).
    db.insert(appointmentRequests)
      .values({ customerId: null, name: "Visitante", phone: "+34611111111", email: "landing@example.com", reason: "Formulario landing" })
      .run();

    const res = await app.request("/admin/appointments");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { appointments: Array<Record<string, unknown>> };
    const ours = body.appointments.filter((row) =>
      [customerId, null].includes(row.customerId as number | null),
    );
    expect(ours).toHaveLength(2);
    expect(ours.every((row) => row.status === "pendiente")).toBe(true);
    const landing = ours.find((row) => row.customerId === null)!;
    expect(landing).toMatchObject({ name: "Visitante", phone: "+34611111111", reason: "Formulario landing" });
  });

  it("PATCH /admin/appointments/:id changes status and bumps updated_at", async () => {
    const appointment = db
      .insert(appointmentRequests)
      .values({ customerId: null, name: "Cita Vieja", phone: "+34622222222", reason: "Llamar", updatedAt: "2020-01-01T00:00:00.000Z" })
      .returning()
      .get();

    const res = await patch(`/admin/appointments/${appointment.id}`, { status: "contactada" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { appointment: Record<string, unknown> };
    expect(body.appointment.status).toBe("contactada");
    expect(body.appointment.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");

    // notes-only patch (status untouched).
    const notes = await patch(`/admin/appointments/${appointment.id}`, {
      notes: "llamar por la tarde",
    });
    expect(notes.status).toBe(200);
    const withNotes = (await notes.json()) as { appointment: Record<string, unknown> };
    expect(withNotes.appointment.status).toBe("contactada");
    expect(withNotes.appointment.notes).toBe("llamar por la tarde");
  });

  it("PATCH /admin/appointments/:id validates id, body and the status enum", async () => {
    const appointment = db
      .insert(appointmentRequests)
      .values({ customerId: null, name: "Validar", phone: "+34633333333", reason: "Cita" })
      .returning()
      .get();

    const badStatus = await patch(`/admin/appointments/${appointment.id}`, { status: "ok" });
    expect(badStatus.status).toBe(400);
    expect(((await badStatus.json()) as { error: string }).error).toContain("status");

    const nothing = await patch(`/admin/appointments/${appointment.id}`, {});
    expect(nothing.status).toBe(400);
    expect((await nothing.json()) as object).toEqual({ error: "nothing to update" });

    const badJson = await app.request(`/admin/appointments/${appointment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "nope",
    });
    expect(badJson.status).toBe(400);

    const missing = await patch("/admin/appointments/999999", { status: "agendada" });
    expect(missing.status).toBe(404);
    expect((await missing.json()) as object).toEqual({ error: "appointment not found" });

    const badId = await patch("/admin/appointments/abc", { status: "agendada" });
    expect(badId.status).toBe(400);

    // Rejected patches changed nothing.
    const stored = db
      .select()
      .from(appointmentRequests)
      .where(eq(appointmentRequests.id, appointment.id))
      .get();
    expect(stored?.status).toBe("pendiente");
  });

  // --- DELETE /admin/customers/:id — full dependent cascade ---

  it("DELETE /admin/customers/:id removes body_metrics, customer_images and appointment_requests", async () => {
    const customerId = createCustomer("Borrar Todo", "borrar-todo@example.com");
    const bystanderId = createCustomer("Superviviente", "superviviente@example.com");

    db.insert(bodyMetrics)
      .values([
        { customerId, measuredAt: "2026-11-11", weightKg: 77.85 },
        { customerId, measuredAt: "2026-11-12", weightKg: 77.5 },
      ])
      .run();
    db.insert(customerImages)
      .values([
        { customerId, kind: "tamizaje", cloudinaryPublicId: "demo/borrar_1", cloudinarySecureUrl: "https://res.cloudinary.com/demo/image/upload/borrar_1.png", uploadedBy: "admin" },
        { customerId, kind: "evolucion", cloudinaryPublicId: "demo/borrar_2", cloudinarySecureUrl: "https://res.cloudinary.com/demo/image/upload/borrar_2.png", uploadedBy: "admin" },
      ])
      .run();
    db.insert(appointmentRequests)
      .values({ customerId, name: "Borrar Todo", phone: "+34644444444", reason: "Cita del cliente" })
      .run();
    // Bystanders that must survive untouched.
    db.insert(bodyMetrics)
      .values({ customerId: bystanderId, measuredAt: "2026-11-11", weightKg: 60 })
      .run();
    db.insert(customerImages)
      .values({ customerId: bystanderId, kind: "otro", cloudinaryPublicId: "demo/supervive", cloudinarySecureUrl: "https://res.cloudinary.com/demo/image/upload/supervive.png", uploadedBy: "admin" })
      .run();
    db.insert(appointmentRequests)
      .values({ customerId: bystanderId, reason: "Cita del superviviente" })
      .run();

    fake.destroyCalls.length = 0;
    const res = await app.request(`/admin/customers/${customerId}`, { method: "DELETE" });
    expect(res.status).toBe(204);

    expect(rows(bodyMetrics, customerId)).toHaveLength(0);
    expect(rows(customerImages, customerId)).toHaveLength(0);
    expect(rows(appointmentRequests, customerId)).toHaveLength(0);
    expect(
      db.select().from(customers).where(eq(customers.id, customerId)).get(),
    ).toBeUndefined();

    // Best-effort Cloudinary cleanup: one destroy per stored public_id.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.destroyCalls.sort()).toEqual(["demo/borrar_1", "demo/borrar_2"]);

    // Cascade must not over-reach.
    expect(rows(bodyMetrics, bystanderId)).toHaveLength(1);
    expect(rows(customerImages, bystanderId)).toHaveLength(1);
    expect(rows(appointmentRequests, bystanderId)).toHaveLength(1);
  });

  it("DELETE succeeds even when Cloudinary destroy fails (best-effort, never blocks)", async () => {
    // destroy() rejects asynchronously (network down).
    fake.destroyMode = "reject";
    const rejectId = createCustomer("Destroy Rechaza", "destroy-rechaza@example.com");
    db.insert(customerImages)
      .values({ customerId: rejectId, kind: "tamizaje", cloudinaryPublicId: "demo/rechaza", cloudinarySecureUrl: "https://res.cloudinary.com/demo/image/upload/rechaza.png", uploadedBy: "admin" })
      .run();
    db.insert(bodyMetrics)
      .values({ customerId: rejectId, measuredAt: "2026-11-11", weightKg: 70 })
      .run();

    const res = await app.request(`/admin/customers/${rejectId}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(rows(customerImages, rejectId)).toHaveLength(0);
    expect(rows(bodyMetrics, rejectId)).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the rejection settle (swallowed)

    // destroy() throws synchronously before returning a promise.
    fake.destroyMode = "throw";
    const throwId = createCustomer("Destroy Lanza", "destroy-lanza@example.com");
    db.insert(appointmentRequests)
      .values({ customerId: throwId, reason: "Cita con destroy roto" })
      .run();

    const res2 = await app.request(`/admin/customers/${throwId}`, { method: "DELETE" });
    expect(res2.status).toBe(204);
    expect(rows(appointmentRequests, throwId)).toHaveLength(0);
    expect(
      db.select().from(customers).where(eq(customers.id, throwId)).get(),
    ).toBeUndefined();

    fake.destroyMode = "ok";
  });
});
