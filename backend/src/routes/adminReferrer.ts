import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { referrers, customers } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

/**
 * Admin referrer management routes.
 *
 * - GET    /admin/referrers       → list all with customer counts
 * - POST   /admin/referrers       → create new referrer
 * - PUT    /admin/referrers/:id   → update referrer
 * - DELETE /admin/referrers/:id   → soft-delete (set active=0)
 */
export function createAdminReferrerRouter(db: Db): Hono {
  const app = new Hono();

  // List all referrers with customer count
  app.get("/", (c) => {
    const all = db
      .select({
        id: referrers.id,
        code: referrers.code,
        name: referrers.name,
        phone: referrers.phone,
        email: referrers.email,
        active: referrers.active,
        createdAt: referrers.createdAt,
        customerCount: sql<number>`(SELECT COUNT(*) FROM ${customers} WHERE ${customers.referrerId} = ${referrers.id})`,
      })
      .from(referrers)
      .all();
    return c.json({ referrers: all });
  });

  // Create new referrer
  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const code = String(body.code ?? "").trim();
    const name = String(body.name ?? "").trim();
    if (!code) return c.json({ error: "missing field: code" }, 400);
    if (!name) return c.json({ error: "missing field: name" }, 400);

    // Check for duplicate code
    const existing = db
      .select()
      .from(referrers)
      .where(eq(referrers.code, code))
      .get();
    if (existing) {
      return c.json({ error: "code already exists" }, 409);
    }

    const referrer = db
      .insert(referrers)
      .values({
        code,
        name,
        phone: body.phone ? String(body.phone) : null,
        email: body.email ? String(body.email) : null,
      })
      .returning()
      .get();

    return c.json({ referrer }, 201);
  });

  // Update referrer
  app.put("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const patch: Record<string, string | number | null> = {};
    if (body.code != null) {
      const code = String(body.code).trim();
      if (!code) return c.json({ error: "code cannot be empty" }, 400);
      // Check duplicate
      const existing = db
        .select()
        .from(referrers)
        .where(eq(referrers.code, code))
        .get();
      if (existing && existing.id !== id) {
        return c.json({ error: "code already exists" }, 409);
      }
      patch.code = code;
    }
    if (body.name != null) {
      const name = String(body.name).trim();
      if (!name) return c.json({ error: "name cannot be empty" }, 400);
      patch.name = name;
    }
    if (body.phone !== undefined) patch.phone = body.phone ? String(body.phone) : null;
    if (body.email !== undefined) patch.email = body.email ? String(body.email) : null;
    if (body.active !== undefined) {
      patch.active = body.active ? 1 : 0;
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ error: "nothing to update" }, 400);
    }

    const updated = db
      .update(referrers)
      .set(patch)
      .where(eq(referrers.id, id))
      .returning()
      .get();

    if (!updated) return c.json({ error: "referrer not found" }, 404);
    return c.json({ referrer: updated });
  });

  // Soft-delete referrer
  app.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);

    const updated = db
      .update(referrers)
      .set({ active: 0 })
      .where(eq(referrers.id, id))
      .returning()
      .get();

    if (!updated) return c.json({ error: "referrer not found" }, 404);
    return c.body(null, 204);
  });

  return app;
}
