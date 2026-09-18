import "dotenv/config";
import { Hono } from "hono";
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

const PORT = Number(process.env.PORT ?? 3001);
const DB_PATH = process.env.SQLITE_PATH ?? "./data/dev.sqlite";
const API_KEY = process.env.API_KEY;

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
      allowMethods: ["GET", "POST"],
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

  app.route("/assistant", createRegisterRouter(db));
  app.route("/assistant", createAssistantRouter(db));
  app.route("/admin", createAdminRouter(db));
  app.route("/assessment", createAssessmentRouter(db));

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
