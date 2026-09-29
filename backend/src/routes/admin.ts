import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import type { Db } from "../db/client.js";
import { createCatalogService } from "../services/catalogService.js";
import { createGuidanceService } from "../services/guidanceService.js";
import { createRecommendationService } from "../services/recommendationService.js";
import { createConversationService } from "../services/conversationService.js";
import { customers, conversations, messages, products, purchases } from "../db/schema.js";
import type { NewGuidance } from "../db/schema.js";
import { eq, count } from "drizzle-orm";

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

  return app;
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