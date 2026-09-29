import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { createCustomerService } from "../services/customerService.js";

/**
 * Registration + informed consent gate (first use).
 * POST /assistant/register {name,email,phone,referrer_phone?,consent_version}
 * → 200 {customer_id, consent_version, reconsented}; 400 bad body / stale version.
 *
 * Registration is data capture + consent, NOT login. The bridge passes the
 * returned customer_id server-to-server. The current consent text/version is
 * served by routes/assistant.ts (`GET /assistant/consent`).
 *
 * Registration is an UPSERT (design): an existing email/phone is re-consented
 * in place (id + history + audit preserved) rather than rejected with 409, so
 * returning customers stay usable when CURRENT_CONSENT_VERSION changes.
 */
export function createRegisterRouter(db: Db): Hono {
  const app = new Hono();
  const customers = createCustomerService(db);

  app.post("/register", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "cuerpo inválido" }, 400);
    }

    const consentVersion =
      typeof body.consent_version === "number" ? body.consent_version : Number(body.consent_version);
    const result = customers.register({
      name: String(body.name ?? ""),
      email: String(body.email ?? ""),
      phone: String(body.phone ?? ""),
      referrerPhone: body.referrer_phone ? String(body.referrer_phone) : null,
      referrerId: body.referrer_id ? Number(body.referrer_id) : null,
      consentVersion: Number.isFinite(consentVersion) ? consentVersion : -1,
    });

    switch (result.status) {
      case "invalid":
        return c.json({ error: result.reason }, 400);
      case "ok":
        return c.json({
          customer_id: result.customer.id,
          consent_version: result.customer.consentVersion,
          reconsented: result.reconsented,
        });
    }
  });

  return app;
}