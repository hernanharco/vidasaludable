import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { referrers } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

/**
 * Public referrer validation endpoint.
 *
 * POST /referrer/validate — { code: string } → { valid: true, referrerName: string, referrerId: number }
 * Returns 404 if code is invalid or inactive.
 */
export function createReferrerRouter(db: Db): Hono {
  const app = new Hono();

  app.post("/validate", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.code) {
      return c.json({ error: "missing code" }, 400);
    }

    const code = String(body.code).trim();
    if (!code) {
      return c.json({ error: "missing code" }, 400);
    }

    const referrer = db
      .select()
      .from(referrers)
      .where(eq(referrers.code, code))
      .get();

    if (!referrer || !referrer.active) {
      return c.json({ error: "código inválido" }, 404);
    }

    return c.json({
      valid: true,
      referrerId: referrer.id,
      referrerName: referrer.name,
    });
  });

  return app;
}
