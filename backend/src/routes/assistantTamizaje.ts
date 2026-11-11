import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { appointmentRequests } from "../db/schema.js";
import { desc, eq } from "drizzle-orm";
import { createCustomerService } from "../services/customerService.js";
import { createImageService } from "../services/imageService.js";
import { createBodyMetricService } from "../services/bodyMetricService.js";
import { createCloudinaryClient } from "../services/cloudinaryService.js";
import type { CloudinaryClient } from "../services/cloudinaryService.js";
import { getCurrentConsent } from "../config/consent.js";

/**
 * Customer-facing tamizaje routes (tamizaje-images T2, S1-S3), mounted at
 * `/assistant` alongside the main assistant router (same mount precedent as
 * createRegisterRouter).
 *
 * - POST /assistant/images {customer_id, data, kind, taken_at?, notes?} →
 *   consent-gated like /ask (health PII): 400 invalid customer_id · 404
 *   unknown customer (checked BEFORE consent) · 401 CONSENT_REQUIRED +
 *   consent object on a stale version · then the SHARED image ingest
 *   (400 kind/data · 413 >8MB · 500 not configured · 502 upload failed) ·
 *   201 {image} recorded with uploaded_by='customer'.
 * - GET  /assistant/images?customer_id=N → {images} newest first. Reads are
 *   NOT consent-gated (same precedent as /history): 400/404 only.
 * - POST /assistant/body-metrics {customer_id, measured_at, 17 optional
 *   snake_case numerics, source?, notes?} → same consent gate as /ask, then
 *   the SHARED upsert (identical shape to the admin POST): 201 create /
 *   200 upsert · 400 validation · 404 unknown customer.
 * - GET  /assistant/body-metrics?customer_id=N → {bodyMetrics} newest first
 *   (no consent gate, 400/404).
 * - POST /assistant/appointments {customer_id, reason, notes?} → NO consent
 *   gate (a contact request, same precedent as POST /conversations):
 *   400 invalid customer/reason · 404 unknown · 201 {appointment} with
 *   status 'pendiente'.
 * - GET  /assistant/appointments?customer_id=N → {appointments} the
 *   customer's OWN rows only (landing NULL rows never leak through here;
 *   no consent gate, 400/404).
 */

/** Optional router dependencies (DI, same pattern as the admin router). */
export interface AssistantTamizajeDeps {
  /** Tests inject a fake — no network, no credentials. Production resolves CLOUDINARY_*. */
  cloudinaryClient?: CloudinaryClient;
}

/** Positive-integer customer_id from body/query → null when invalid (400). */
function readCustomerId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function createAssistantTamizajeRouter(db: Db, deps: AssistantTamizajeDeps = {}): Hono {
  const app = new Hono();
  const customers = createCustomerService(db);
  // Default reads CLOUDINARY_* env lazily at call time — constructing it here
  // never throws, so an unconfigured server boots and only the upload call
  // fails (clear 500, same boot-safety as the admin surface).
  const cloudinary = deps.cloudinaryClient ?? createCloudinaryClient();
  const images = createImageService(db, { cloudinary });
  const bodyMetrics = createBodyMetricService(db);

  // --- Images (S2: customer uploads into the Cloudinary history) ---

  app.post("/images", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "cuerpo inválido" }, 400);
    }

    // Customer checks FIRST (400/404), then the consent gate — same order
    // and shapes as /ask.
    const customerId = readCustomerId(body.customer_id);
    if (customerId === null) return c.json({ error: "customer_id inválido" }, 400);
    if (!customers.getById(customerId)) return c.json({ error: "customer no encontrado" }, 404);
    if (!customers.hasCurrentConsent(customerId)) {
      return c.json({ error: "CONSENT_REQUIRED", consent: getCurrentConsent() }, 401);
    }

    // Shared ingest: kind/data/8MB validation + Cloudinary upload + record.
    const result = await images.ingest({ customerId, uploadedBy: "customer", body });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ image: result.image }, 201);
  });

  app.get("/images", (c) => {
    const customerId = readCustomerId(c.req.query("customer_id"));
    if (customerId === null) return c.json({ error: "customer_id inválido" }, 400);
    if (!customers.getById(customerId)) return c.json({ error: "customer no encontrado" }, 404);
    return c.json({ images: images.listByCustomer(customerId) });
  });

  // --- Body metrics (S1: optional, never-blocking record) ---

  app.post("/body-metrics", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "cuerpo inválido" }, 400);
    }

    const customerId = readCustomerId(body.customer_id);
    if (customerId === null) return c.json({ error: "customer_id inválido" }, 400);
    if (!customers.getById(customerId)) return c.json({ error: "customer no encontrado" }, 404);
    // Health data → same consent gate as /ask (version-gated).
    if (!customers.hasCurrentConsent(customerId)) {
      return c.json({ error: "CONSENT_REQUIRED", consent: getCurrentConsent() }, 401);
    }

    // Shared upsert: identical wire shape and semantics to the admin POST.
    const result = bodyMetrics.upsertFromWire(customerId, body);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ bodyMetric: result.bodyMetric }, result.status);
  });

  app.get("/body-metrics", (c) => {
    const customerId = readCustomerId(c.req.query("customer_id"));
    if (customerId === null) return c.json({ error: "customer_id inválido" }, 400);
    if (!customers.getById(customerId)) return c.json({ error: "customer no encontrado" }, 404);
    return c.json({ bodyMetrics: bodyMetrics.listByCustomer(customerId) });
  });

  // --- Appointment requests from the chat ([CITA] card → dialog → here) ---

  app.post("/appointments", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "cuerpo inválido" }, 400);
    }

    // NO consent gate on purpose: it is a contact request (same precedent as
    // POST /assistant/conversations) — only the 400/404 customer checks.
    const customerId = readCustomerId(body.customer_id);
    if (customerId === null) return c.json({ error: "customer_id inválido" }, 400);
    if (!customers.getById(customerId)) return c.json({ error: "customer no encontrado" }, 404);

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return c.json({ error: "missing field: reason" }, 400);
    if (reason.length > 500) {
      return c.json({ error: "reason must be at most 500 characters" }, 400);
    }
    const notes = body.notes != null ? String(body.notes) : null;

    const appointment = db
      .insert(appointmentRequests)
      .values({ customerId, reason, notes }) // status defaults to 'pendiente'
      .returning()
      .get();
    return c.json({ appointment }, 201);
  });

  app.get("/appointments", (c) => {
    const customerId = readCustomerId(c.req.query("customer_id"));
    if (customerId === null) return c.json({ error: "customer_id inválido" }, 400);
    if (!customers.getById(customerId)) return c.json({ error: "customer no encontrado" }, 404);
    // Own rows only: the eq() filter excludes other customers AND the
    // anonymous landing rows (customer_id NULL).
    return c.json({
      appointments: db
        .select()
        .from(appointmentRequests)
        .where(eq(appointmentRequests.customerId, customerId))
        .orderBy(desc(appointmentRequests.id))
        .all(),
    });
  });

  return app;
}
