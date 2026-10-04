import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import type { Db } from "../db/client.js";
import { createCatalogService } from "../services/catalogService.js";
import type { CatalogService } from "../services/catalogService.js";
import { createGuidanceService } from "../services/guidanceService.js";
import { createVideoService, parseSegmentProductList } from "../services/videoService.js";
import type { SegmentCreateInput, SegmentPatchInput } from "../services/videoService.js";
import { matchSymptom } from "../services/symptomMatcher.js";
import type { SymptomCandidate } from "../services/symptomMatcher.js";
import { parseVideoId } from "../tools/parsers.js";
import { createRecommendationService } from "../services/recommendationService.js";
import { createConversationService } from "../services/conversationService.js";
import { customers, conversations, messages, products, purchases, videos, videoSegments } from "../db/schema.js";
import { assessmentSymptoms } from "../db/assessmentSchema.js";
import type { NewGuidance, NewVideo } from "../db/schema.js";
import { eq, count } from "drizzle-orm";

/** Allowed `videos.status` values — the pipeline lifecycle state machine. */
const VIDEO_STATUSES = ["draft", "analyzed", "cut", "published"] as const;
type VideoStatus = (typeof VIDEO_STATUSES)[number];

function isVideoStatus(value: string): value is VideoStatus {
  return (VIDEO_STATUSES as readonly string[]).includes(value);
}

/**
 * CRM routes under /admin.
 *
 * - Development (NODE_ENV=development): open access (local prototype).
 * - Any other environment (production): HTTP **basic auth** via
 *   ADMIN_USER / ADMIN_PASS. If those are not configured, admin fails closed
 *   with 503 — PII (names, emails, phones) and health/purchase data must never
 *   be exposed on a public host (LOPD/GDPR deploy blocker, see design Risks).
 * - `recommendations` is GET-only: the audit log is append-only, so no
 *   POST/PUT/DELETE is exposed here or anywhere (see design ADR + audit spec).
 * - Catalog edits never DELETE: products referenced by purchases or past
 *   recommendations must not be destructively removed (referential integrity).
 * - Videos delete is FK-guarded (409 when segments exist) — see the DELETE
 *   /videos/:id doc comment for the deliberate decision; it never cascades.
 */
export function createAdminRouter(db: Db): Hono {
  const app = new Hono();

  // Guard: open in dev; basic auth + fail-closed in any non-dev environment.
  app.use("*", async (c, next) => {
    const env = process.env.NODE_ENV ?? "development";
    if (env === "development") {
      return next();
    }
    const user = process.env.ADMIN_USER;
    const pass = process.env.ADMIN_PASS;
    if (!user || !pass) {
      return c.json({ error: "admin_no_configurado" }, 503);
    }
    return basicAuth({ username: user, password: pass })(c, next);
  });

  const catalog = createCatalogService(db);
  const recommendations = createRecommendationService(db);
  const conversationsService = createConversationService(db);
  const guidanceService = createGuidanceService(db);
  const videoService = createVideoService(db);

  // --- Catalog (products): list, create, edit. No destructive delete. ---
  app.get("/catalog", (c) => c.json({ products: catalog.listAll() }));

  app.post("/catalog", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);
    const required = [
      "reference",
      "name",
      "category",
      "size",
      "benefits",
      "dosage",
      "ingredients",
      "disclaimer",
    ];
    for (const field of required) {
      if (body[field] == null || String(body[field]).trim() === "") {
        return c.json({ error: `missing field: ${field}` }, 400);
      }
    }
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      return c.json({ error: "price must be a non-negative number" }, 400);
    }
    const reference = String(body.reference).trim();
    if (catalog.lookup(reference).found) {
      return c.json({ error: "reference already exists" }, 409);
    }
    const product = catalog.create({
      reference,
      name: String(body.name),
      category: String(body.category),
      size: String(body.size),
      price,
      benefits: String(body.benefits),
      dosage: String(body.dosage),
      ingredients: String(body.ingredients),
      disclaimer: String(body.disclaimer),
    });
    return c.json({ product }, 201);
  });

  app.put("/catalog/:reference", async (c) => {
    const reference = c.req.param("reference");
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const patch: Record<string, string | number> = {};
    const stringFields = [
      "name",
      "category",
      "size",
      "benefits",
      "dosage",
      "ingredients",
      "disclaimer",
    ] as const;
    for (const field of stringFields) {
      if (body[field] != null) patch[field] = String(body[field]);
    }
    if (body.price != null) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0) {
        return c.json({ error: "price must be a non-negative number" }, 400);
      }
      patch.price = price;
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ error: "nothing to update" }, 400);
    }

    const product = catalog.update(reference, patch);
    if (!product) return c.json({ error: "reference not found" }, 404);
    return c.json({ product });
  });

  app.delete("/catalog/:reference", (c) => {
    const reference = c.req.param("reference");
    const [row] = db
      .select({ cnt: count() })
      .from(purchases)
      .where(eq(purchases.productReference, reference))
      .all();
    if (row && row.cnt > 0) {
      return c.json({ error: "reference in use", count: row.cnt }, 409);
    }
    const deleted = db.delete(products).where(eq(products.reference, reference)).returning().get();
    if (!deleted) return c.json({ error: "reference not found" }, 404);
    return c.body(null, 204);
  });

  // --- Customers: list + delete. ---
  app.get("/customers", (c) =>
    c.json({ customers: db.select().from(customers).all() }),
  );
  app.delete("/customers/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    const deleted = db.delete(customers).where(eq(customers.id, id)).returning().get();
    if (!deleted) return c.json({ error: "customer not found" }, 404);
    return c.body(null, 204);
  });

  // --- Conversations: list + view messages + delete. ---
  app.get("/conversations", (c) =>
    c.json({ conversations: db.select().from(conversations).all() }),
  );
  app.delete("/conversations/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    const existing = db.select().from(conversations).where(eq(conversations.id, id)).get();
    if (!existing) return c.json({ error: "conversation not found" }, 404);
    db.delete(messages).where(eq(messages.conversationId, id)).all();
    db.delete(conversations).where(eq(conversations.id, id)).all();
    return c.body(null, 204);
  });
  app.get("/conversations/:id/messages", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    return c.json({ messages: conversationsService.loadMessages(id) });
  });

  // --- Purchases: list + create a demo purchase. ---
  app.get("/purchases", (c) =>
    c.json({ purchases: db.select().from(purchases).all() }),
  );
  app.post("/purchases", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);
    const customerId = Number(body.customerId);
    const productReference = String(body.productReference ?? "").trim();
    const qty = Number(body.qty ?? 1);
    if (!Number.isInteger(customerId)) return c.json({ error: "invalid customerId" }, 400);
    if (!productReference) return c.json({ error: "missing productReference" }, 400);
    if (!Number.isInteger(qty) || qty < 1) return c.json({ error: "qty must be a positive integer" }, 400);

    const customer = db.select().from(customers).where(eq(customers.id, customerId)).get();
    if (!customer) return c.json({ error: "customer not found" }, 404);
    if (!catalog.lookup(productReference).found) {
      return c.json({ error: "product not found" }, 404);
    }
    const purchasedAt = body.purchasedAt
      ? String(body.purchasedAt)
      : new Date().toISOString();
    const purchase = db
      .insert(purchases)
      .values({ customerId, productReference, qty, purchasedAt })
      .returning()
      .get();
    return c.json({ purchase }, 201);
  });

  // --- Recommendations: GET-only (append-only audit log). No POST/PUT/DELETE. ---
  app.get("/recommendations", (c) =>
    c.json({ recommendations: recommendations.listAll() }),
  );

  // --- Guidance: doctor-authored knowledge. Editable CRUD (unlike the audit
  // log, guidance is meant to be curated over time). ---
  app.get("/guidance", (c) => c.json({ guidance: guidanceService.list() }));

  app.post("/guidance", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);
    const title = String(body.title ?? "").trim();
    const content = String(body.content ?? "").trim();
    if (!title) return c.json({ error: "missing field: title" }, 400);
    if (!content) return c.json({ error: "missing field: content" }, 400);
    const refs = parseProductRefs(body.product_references);
    if (refs === null) {
      return c.json(
        { error: "product_references must be an array of catalog references" },
        400,
      );
    }
    const row = guidanceService.create({
      title,
      content,
      productReferences: JSON.stringify(refs),
    });
    return c.json({ guidance: row }, 201);
  });

  app.put("/guidance/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const patch: Partial<NewGuidance> = {};
    if (body.title != null) {
      const title = String(body.title).trim();
      if (!title) return c.json({ error: "title cannot be empty" }, 400);
      patch.title = title;
    }
    if (body.content != null) {
      const content = String(body.content).trim();
      if (!content) return c.json({ error: "content cannot be empty" }, 400);
      patch.content = content;
    }
    if (body.product_references != null) {
      const refs = parseProductRefs(body.product_references);
      if (refs === null) {
        return c.json(
          { error: "product_references must be an array of catalog references" },
          400,
        );
      }
      patch.productReferences = JSON.stringify(refs);
    }
    if (body.enabled != null) {
      const enabled = Number(body.enabled);
      if (enabled !== 0 && enabled !== 1) {
        return c.json({ error: "enabled must be 0 or 1" }, 400);
      }
      patch.enabled = enabled;
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ error: "nothing to update" }, 400);
    }

    const row = guidanceService.update(id, patch);
    if (!row) return c.json({ error: "guidance not found" }, 404);
    return c.json({ guidance: row });
  });

  app.delete("/guidance/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    const removed = guidanceService.remove(id);
    if (!removed) return c.json({ error: "guidance not found" }, 404);
    return c.body(null, 204);
  });

  // --- Videos (educational video library): list, create, edit. Delete is
  // FK-guarded — see DELETE /videos/:id below. ---
  app.get("/videos", (c) => c.json({ videos: videoService.listVideos() }));

  app.post("/videos", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);
    const speaker = String(body.speaker ?? "").trim();
    const title = String(body.title ?? "").trim();
    const url = String(body.url ?? "").trim();
    if (!speaker) return c.json({ error: "missing field: speaker" }, 400);
    if (!title) return c.json({ error: "missing field: title" }, 400);
    if (!url) return c.json({ error: "missing field: url" }, 400);
    // `url` is the admin input; the youtubeId is DERIVED via parseVideoId.
    const youtubeId = parseVideoId(url);
    if (!youtubeId) return c.json({ error: "invalid url" }, 400);
    if (videoService.getVideoByYoutubeId(youtubeId)) {
      return c.json({ error: "youtubeId already exists" }, 409);
    }
    const input: NewVideo = { speaker, title, url, youtubeId };
    if (body.durationS != null) {
      const durationS = Number(body.durationS);
      if (!Number.isInteger(durationS) || durationS < 0) {
        return c.json({ error: "durationS must be a non-negative integer" }, 400);
      }
      input.durationS = durationS;
    }
    if (body.status != null) {
      const status = String(body.status);
      if (!isVideoStatus(status)) {
        return c.json({ error: "status must be draft, analyzed, cut or published" }, 400);
      }
      input.status = status;
    }
    // Carrera TOCTOU: el pre-check de arriba es el camino rápido y amable,
    // pero entre el check y el insert puede insertarse otro video con el mismo
    // youtubeId (p. ej. dos requests concurrentes). SQLite lo resuelve con la
    // UNIQUE (solo una fila sobrevive); aquí solo se mapea el error del driver
    // al mismo 409 del pre-check en vez de dejar un 500. Cualquier otro error
    // se propaga igual que antes.
    try {
      return c.json({ video: videoService.createVideo(input) }, 201);
    } catch (err) {
      const e = err as { message?: string; code?: string };
      const uniqueViolation =
        (typeof e?.message === "string" && e.message.includes("UNIQUE constraint failed")) ||
        (typeof e?.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT"));
      if (uniqueViolation) {
        return c.json({ error: "youtubeId already exists" }, 409);
      }
      throw err;
    }
  });

  app.patch("/videos/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const patch: Partial<NewVideo> = {};
    if (body.title != null) {
      const title = String(body.title).trim();
      if (!title) return c.json({ error: "title cannot be empty" }, 400);
      patch.title = title;
    }
    if (body.speaker != null) {
      const speaker = String(body.speaker).trim();
      if (!speaker) return c.json({ error: "speaker cannot be empty" }, 400);
      patch.speaker = speaker;
    }
    if (body.status != null) {
      const status = String(body.status);
      if (!isVideoStatus(status)) {
        return c.json({ error: "status must be draft, analyzed, cut or published" }, 400);
      }
      patch.status = status;
    }
    if (body.licenseNote != null) patch.licenseNote = String(body.licenseNote);
    if (body.durationS != null) {
      const durationS = Number(body.durationS);
      if (!Number.isInteger(durationS) || durationS < 0) {
        return c.json({ error: "durationS must be a non-negative integer" }, 400);
      }
      patch.durationS = durationS;
    }
    if (Object.keys(patch).length === 0) return c.json({ error: "nothing to update" }, 400);

    const video = videoService.updateVideo(id, patch);
    if (!video) return c.json({ error: "video not found" }, 404);
    return c.json({ video });
  });

  /**
   * DELETE /admin/videos/:id — FK decision (T7, documented rule): **409 when
   * the video still has segments** (`{ error: "video has segments", count }`),
   * mirroring catalog's "reference in use" 409. The route NEVER cascades:
   * enabled segments are live chat knowledge (injected into the assistant and
   * rendered by the widget), so removal is explicit — the admin deletes (or
   * first disables) the segments, then the video. With no segments left →
   * 204 like every other admin delete; absent id → 404.
   */
  app.delete("/videos/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    const [row] = db
      .select({ cnt: count() })
      .from(videoSegments)
      .where(eq(videoSegments.videoId, id))
      .all();
    if (row && row.cnt > 0) {
      return c.json({ error: "video has segments", count: row.cnt }, 409);
    }
    let removed: boolean;
    try {
      removed = videoService.removeVideo(id);
    } catch (err) {
      // Carrera FK: un segmento insertado entre el conteo y el delete haría
      // fallar el DELETE (foreign_keys está ON) con un 500. Se devuelve el
      // mismo 409 del pre-check, re-contando para `count` (consulta puntual
      // sobre el índice por video_id). Cualquier otro error se propaga.
      const e = err as { message?: string };
      if (typeof e?.message === "string" && e.message.includes("FOREIGN KEY constraint failed")) {
        const [again] = db
          .select({ cnt: count() })
          .from(videoSegments)
          .where(eq(videoSegments.videoId, id))
          .all();
        return c.json({ error: "video has segments", count: again?.cnt ?? 0 }, 409);
      }
      throw err;
    }
    if (!removed) return c.json({ error: "video not found" }, 404);
    return c.body(null, 204);
  });

  // --- Video segments: timestamped excerpts per condition. All rows (enabled
  // and not) are listed; approval is PATCH enabled=1. Product fields (T5) are
  // delivered as PARSED arrays — see toSegmentWire. ---
  app.get("/video-segments", (c) => {
    const videoIdRaw = c.req.query("video_id");
    if (videoIdRaw != null && videoIdRaw !== "") {
      const videoId = Number(videoIdRaw);
      if (!Number.isInteger(videoId)) return c.json({ error: "invalid video_id" }, 400);
      return c.json({
        segments: db
          .select()
          .from(videoSegments)
          .where(eq(videoSegments.videoId, videoId))
          .all()
          .map(toSegmentWire),
      });
    }
    return c.json({ segments: videoService.listSegments().map(toSegmentWire) });
  });

  app.post("/video-segments", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const videoId = Number(body.videoId);
    if (!Number.isInteger(videoId)) return c.json({ error: "videoId must be an integer" }, 400);
    const video = db.select().from(videos).where(eq(videos.id, videoId)).get();
    if (!video) return c.json({ error: "video not found" }, 404);

    const startS = Number(body.startS);
    const endS = Number(body.endS);
    if (!Number.isInteger(startS) || !Number.isInteger(endS)) {
      return c.json({ error: "startS and endS must be integers" }, 400);
    }
    if (startS < 0 || endS <= startS) {
      return c.json({ error: "bounds must satisfy 0 <= startS < endS" }, 400);
    }
    const title = String(body.title ?? "").trim();
    if (!title) return c.json({ error: "missing field: title" }, 400);

    // Condition normalization (T7 contract): symptomId wins; else free-text
    // is matched against the assessment vocabulary; unmatched → nulls.
    const resolved = resolveConditionPatch(db, body);
    if (resolved.action === "error") return c.json({ error: resolved.error }, 400);

    // T5: product mentions + catalog refs (arrays or JSON strings; refs
    // validated against the catalog, invalid ones dropped — never invented).
    const productFields = resolveSegmentProductPatch(catalog, body);
    if (productFields.action === "error") {
      return c.json({ error: productFields.error }, 400);
    }

    const input: SegmentCreateInput = {
      videoId,
      startS,
      endS,
      title,
      summary: body.summary != null ? String(body.summary) : "",
      ...(resolved.action === "set"
        ? { symptomId: resolved.symptomId, condition: resolved.condition }
        : {}),
      ...(productFields.action === "set" ? productFields.patch : {}),
    };
    return c.json({ segment: toSegmentWire(videoService.createSegment(input)) }, 201);
  });

  app.patch("/video-segments/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const existing = db.select().from(videoSegments).where(eq(videoSegments.id, id)).get();
    if (!existing) return c.json({ error: "segment not found" }, 404);

    const patch: SegmentPatchInput = {};
    // Bounds are validated on the EFFECTIVE values (existing merged with the
    // patch) so a lone startS cannot cross the stored endS.
    const startS = body.startS != null ? Number(body.startS) : existing.startS;
    const endS = body.endS != null ? Number(body.endS) : existing.endS;
    if (!Number.isInteger(startS) || !Number.isInteger(endS) || startS < 0 || endS <= startS) {
      return c.json({ error: "bounds must satisfy 0 <= startS < endS" }, 400);
    }
    if (body.startS != null) patch.startS = startS;
    if (body.endS != null) patch.endS = endS;

    if (body.title != null) {
      const title = String(body.title).trim();
      if (!title) return c.json({ error: "title cannot be empty" }, 400);
      patch.title = title;
    }
    if (body.summary != null) patch.summary = String(body.summary);

    const resolved = resolveConditionPatch(db, body);
    if (resolved.action === "error") return c.json({ error: resolved.error }, 400);
    if (resolved.action === "set") {
      patch.symptomId = resolved.symptomId;
      patch.condition = resolved.condition;
    }

    if (body.enabled != null) {
      const enabled = Number(body.enabled);
      if (enabled !== 0 && enabled !== 1) {
        return c.json({ error: "enabled must be 0 or 1" }, 400);
      }
      patch.enabled = enabled;
    }
    // clipYoutubeId: any value (including explicit null) is honored — a null
    // clears the clip link (e.g. permission revoked, back to the deep link).
    if (body.clipYoutubeId !== undefined) {
      patch.clipYoutubeId = body.clipYoutubeId == null ? null : String(body.clipYoutubeId);
    }

    // T5: product mentions + catalog refs (arrays or JSON strings; refs
    // validated against the catalog — unknown ones are dropped).
    const productFields = resolveSegmentProductPatch(catalog, body);
    if (productFields.action === "error") {
      return c.json({ error: productFields.error }, 400);
    }
    if (productFields.action === "set") Object.assign(patch, productFields.patch);

    if (Object.keys(patch).length === 0) return c.json({ error: "nothing to update" }, 400);
    const segment = videoService.updateSegment(id, patch);
    if (!segment) return c.json({ error: "segment not found" }, 404);
    return c.json({ segment: toSegmentWire(segment) });
  });

  app.delete("/video-segments/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    const removed = videoService.removeSegment(id);
    if (!removed) return c.json({ error: "segment not found" }, 404);
    return c.body(null, 204);
  });

  return app;
}

/**
 * Condition normalization for segment create/patch (T7 contract, ODD
 * Decisions):
 * - `symptomId` present → `condition` is set from that assessment symptom's
 *   `name_es` (the normalized display text). Unknown id → error (route 400).
 * - else `condition` present → `matchSymptom` resolves the free text against
 *   the assessment vocabulary: a match stores (symptomId, name_es); an
 *   unmatched input stores (null, null) — unmatched segments keep condition
 *   NULL and need an admin assignment before approval.
 * - neither present → `none` (caller leaves the fields untouched).
 *
 * Pure decision logic over the already-parsed body; DB lookups happen here
 * because the assessment vocabulary is the normalization source of truth.
 */
type ConditionResolution =
  | { action: "none" }
  | { action: "set"; symptomId: number | null; condition: string | null }
  | { action: "error"; error: string };

function resolveConditionPatch(
  db: Db,
  body: Record<string, unknown>,
): ConditionResolution {
  if (body.symptomId != null) {
    const symptomId = Number(body.symptomId);
    if (!Number.isInteger(symptomId)) return { action: "error", error: "symptomId must be an integer" };
    const symptom = db
      .select()
      .from(assessmentSymptoms)
      .where(eq(assessmentSymptoms.id, symptomId))
      .get();
    if (!symptom) return { action: "error", error: "symptom not found" };
    return { action: "set", symptomId: symptom.id, condition: symptom.nameEs };
  }
  if (body.condition != null) {
    const candidates: SymptomCandidate[] = db
      .select()
      .from(assessmentSymptoms)
      .all()
      .map((s) => ({ id: s.id, name_es: s.nameEs }));
    const hit = matchSymptom(String(body.condition), candidates);
    if (hit) return { action: "set", symptomId: hit.id, condition: hit.name_es };
    return { action: "set", symptomId: null, condition: null };
  }
  return { action: "none" };
}

/**
 * Validates a `product_references` payload: must be an array of non-empty
 * strings. Returns null when invalid (route replies 400). The array is the
 * wire format; the service persists it as a JSON string.
 */
function parseProductRefs(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const refs: string[] = [];
  for (const item of value) {
    const ref = String(item ?? "").trim();
    if (!ref) return null;
    refs.push(ref);
  }
  return refs;
}

/**
 * T5 — product payload parser for segment routes: accepts an array of strings
 * or a JSON string encoding one (guidance-style wire format). Returns null on
 * invalid SHAPE (route replies 400); blank entries are dropped.
 */
function parseStringArrayPayload(value: unknown): string[] | null {
  let arr: unknown = value;
  if (typeof value === "string") {
    try {
      arr = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  return arr
    .map((item) => String(item ?? "").trim())
    .filter((s) => s !== "");
}

/**
 * T5 — product fields for segment create/patch. Invalid SHAPE → error (route
 * replies 400). `product_references` are validated against the CATALOG:
 * entries that are not real refs are DROPPED (never invented links — the
 * same defensive rule as the analyzer's ref validation). `mentioned_products`
 * stay raw: the mention is the educator's words until an admin links a ref.
 */
function resolveSegmentProductPatch(
  catalog: CatalogService,
  body: Record<string, unknown>,
):
  | { action: "none" }
  | {
      action: "set";
      patch: { mentionedProducts?: string[]; productReferences?: string[] };
    }
  | { action: "error"; error: string } {
  const patch: { mentionedProducts?: string[]; productReferences?: string[] } = {};
  if (body.mentioned_products != null) {
    const arr = parseStringArrayPayload(body.mentioned_products);
    if (arr === null) {
      return { action: "error", error: "mentioned_products must be an array of strings" };
    }
    patch.mentionedProducts = arr;
  }
  if (body.product_references != null) {
    const arr = parseStringArrayPayload(body.product_references);
    if (arr === null) {
      return { action: "error", error: "product_references must be an array of strings" };
    }
    patch.productReferences = arr.filter((ref) => catalog.lookup(ref).found);
  }
  return Object.keys(patch).length > 0 ? { action: "set", patch } : { action: "none" };
}

/**
 * Wire shape for segment responses (GET/POST/PATCH): the JSON product columns
 * are delivered as PARSED arrays (T5) so consumers never touch the storage
 * format; every other field passes through raw.
 */
function toSegmentWire<
  T extends { mentionedProducts?: string | null; productReferences?: string | null },
>(
  row: T,
): Omit<T, "mentionedProducts" | "productReferences"> & {
  mentionedProducts: string[];
  productReferences: string[];
} {
  return {
    ...row,
    mentionedProducts: parseSegmentProductList(row.mentionedProducts),
    productReferences: parseSegmentProductList(row.productReferences),
  };
}