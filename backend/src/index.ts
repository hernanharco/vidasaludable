import "dotenv/config";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import type { Db } from "./db/client.js";
import { createDatabase } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { createAssistantRouter } from "./routes/assistant.js";
import { createRegisterRouter } from "./routes/register.js";
import { createAdminRouter } from "./routes/admin.js";
import { createAssessmentRouter } from "./routes/assessment.js";
import { createReferrerRouter } from "./routes/referrer.js";
import { createAdminReferrerRouter } from "./routes/adminReferrer.js";
import { createAdminAssessmentRouter } from "./routes/adminAssessment.js";
import { verifyJwt } from "./services/auth.js";
import type { JwtPayload } from "./services/auth.js";

const PORT = Number(process.env.PORT ?? 3001);
const DB_PATH = process.env.SQLITE_PATH ?? "./data/dev.sqlite";
const API_KEY = process.env.API_KEY;

/**
 * Central admin guard — ONE guard for every /admin/* route (single source of
 * truth; replaces the per-router basicAuth copies and closes the previously
 * unguarded /admin/referrers surface).
 *
 * - Development (NODE_ENV=development): open access (current dev-only
 *   philosophy — no dev-token ceremony).
 * - Any other environment: authCore JWT required —
 *     Authorization: Bearer <t> first, then Cookie: token=<t> (the Vercel
 *     same-origin rewrite path the SPA uses).
 *   401 {error:"token_requerido"} — no token present
 *   401 {error:"token_invalido"}   — verifyJwt null (bad signature, expired
 *     `exp`, missing sub/email, or JWKS unreachable — fail-closed)
 *   403 {error:"acceso_restringido"} — role not ADMIN/SUPERADMIN
 *   On success: c.set("user", payload) and next().
 */
async function adminGuard(c: Context, next: Next) {
  const env = process.env.NODE_ENV ?? "development";
  if (env === "development") {
    return next();
  }

  // Token: Authorization Bearer first, then Cookie (CafeMiTierra pattern).
  let token: string | undefined;
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else {
    const cookieToken = c.req
      .header("Cookie")
      ?.split("; ")
      .find((r) => r.startsWith("token="))
      ?.split("=")[1];
    if (cookieToken) {
      token = cookieToken;
    }
  }
  if (!token) {
    return c.json({ error: "token_requerido" }, 401);
  }

  const payload: JwtPayload | null = await verifyJwt(token);
  if (!payload) {
    return c.json({ error: "token_invalido" }, 401);
  }

  if (payload.role !== "ADMIN" && payload.role !== "SUPERADMIN") {
    return c.json({ error: "acceso_restringido" }, 403);
  }

  c.set("user", payload);
  return next();
}

export function buildApp(db: Db): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return "*";
        try {
          const host = new URL(origin).hostname;
          return host === "localhost" || host === "127.0.0.1" ? origin : null;
        } catch {
          return null;
        }
      },
      allowHeaders: ["Content-Type", "x-api-key"],
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
    }),
  );

  app.use("*", async (c, next) => {
    if (API_KEY) {
      const key = c.req.header("x-api-key");
      if (key !== API_KEY) {
        return c.json({ error: "unauthorized" }, 401);
      }
    }
    return next();
  });

  app.get("/health", (c) => c.json({ ok: true, env: process.env.NODE_ENV ?? "development" }));

  // Central JWT guard for every /admin/* route — registered before the route
  // mounts (Hono matches middleware by path; keeping it first makes the
  // protection boundary obvious).
  app.use("/admin/*", adminGuard);

  app.route("/assistant", createRegisterRouter(db));
  app.route("/assistant", createAssistantRouter(db));
  app.route("/admin", createAdminRouter(db));
  app.route("/assessment", createAssessmentRouter(db));
  app.route("/referrer", createReferrerRouter(db));
  app.route("/admin/referrers", createAdminReferrerRouter(db));
  app.route("/admin/assessment", createAdminAssessmentRouter(db));

  return app;
}

export async function startServer(): Promise<{ server: ServerType; db: Db }> {
  const db = createDatabase(DB_PATH);
  await migrate(db);
  const app = buildApp(db);
  const server = serve({ fetch: app.fetch, port: PORT });
  return { server, db };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer()
    .then(() => {
      console.log(`[vitamin-recommender] listening on :${PORT} (${process.env.NODE_ENV ?? "development"})`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
