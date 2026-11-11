import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client.js";
import { appointmentRequests } from "../db/schema.js";
import { EMAIL_PATTERN } from "../services/customerService.js";

/**
 * Public landing Booking endpoint (tamizaje-images T2, S3 "Landing + CRM +
 * chat"). Mounted at the APP ROOT — deliberately NOT under /assistant or
 * /admin: an anonymous visitor books without auth and without a customer
 * account, so the row is created with `customer_id` NULL (the CRM sees it
 * through GET /admin/appointments).
 *
 * - POST /appointments {name, phone, reason, email?} → 201 {appointment}
 *   (status 'pendiente') · 400 malformed JSON / missing / empty / oversized
 *   field / invalid email · 429 per-IP rate-limit excess.
 * - Sane-length limits (design: "sin campos libres gigantes"): name ≤ 120,
 *   phone ≤ 40, reason ≤ 500, email format (+ RFC-sized cap) when present.
 *
 * Spam surface: this is the ONLY unauthenticated write in the API, so it
 * carries a minimal, dependency-free per-IP rate limit (design note:
 * "documentar riesgo de spam (rate-limit futuro)" — implemented here as the
 * smallest honest version): max 5 POSTs per IP per 10-minute sliding window,
 * 429 on excess. State lives in this router's closure (one Map, pruned
 * opportunistically) — no new npm dependency, nothing persisted.
 */

/** Attempts allowed per IP inside the window (5 posts / 10 min). */
const RATE_LIMIT_MAX_POSTS = 5;
/** Sliding window in milliseconds. */
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
/** Above this many tracked IPs, drop the ones whose window fully expired. */
const RATE_LIMIT_SWEEP_AT = 128;

/** Field length caps for the public form. */
const MAX_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 40;
const MAX_REASON_LENGTH = 500;
/** RFC-ish cap so a "valid-format" email cannot be a giant free-text blob. */
const MAX_EMAIL_LENGTH = 254;

export function createAppointmentsRouter(db: Db): Hono {
  const app = new Hono();

  /** ip → attempt timestamps inside the current window (sliding). */
  const attempts = new Map<string, number[]>();

  /** Client IP: first X-Forwarded-For hop (set by the proxy) → X-Real-IP → opaque fallback. */
  const clientIp = (c: Context): string => {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
    return c.req.header("x-real-ip") ?? "unknown";
  };

  /** Records an attempt; false when the IP is over the limit (→ 429). */
  const allow = (ip: string, now = Date.now()): boolean => {
    const recent = (attempts.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX_POSTS) {
      attempts.set(ip, recent);
      return false;
    }
    recent.push(now);
    attempts.set(ip, recent);
    // Opportunistic sweep: bound memory without a background timer.
    if (attempts.size > RATE_LIMIT_SWEEP_AT) {
      for (const [key, stamps] of attempts) {
        if (stamps.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) attempts.delete(key);
      }
    }
    return true;
  };

  app.post("/appointments", async (c) => {
    if (!allow(clientIp(c))) {
      return c.json({ error: "too many requests" }, 429);
    }

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "missing field: name" }, 400);
    if (name.length > MAX_NAME_LENGTH) {
      return c.json({ error: `name must be at most ${MAX_NAME_LENGTH} characters` }, 400);
    }

    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!phone) return c.json({ error: "missing field: phone" }, 400);
    if (phone.length > MAX_PHONE_LENGTH) {
      return c.json({ error: `phone must be at most ${MAX_PHONE_LENGTH} characters` }, 400);
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return c.json({ error: "missing field: reason" }, 400);
    if (reason.length > MAX_REASON_LENGTH) {
      return c.json({ error: `reason must be at most ${MAX_REASON_LENGTH} characters` }, 400);
    }

    // Optional email: absent/blank stores NULL; a supplied value must be a
    // sane address (same pattern the registration flow validates).
    let email: string | null = null;
    if (body.email != null && String(body.email).trim() !== "") {
      email = String(body.email).trim();
      if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
        return c.json({ error: "invalid email" }, 400);
      }
    }

    const appointment = db
      .insert(appointmentRequests)
      .values({ customerId: null, name, phone, email, reason }) // status → 'pendiente'
      .returning()
      .get();
    return c.json({ appointment }, 201);
  });

  return app;
}
