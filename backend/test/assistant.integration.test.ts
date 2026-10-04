import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { seedProducts } from "../src/seed/seedProducts.js";
import { seedGuidance } from "../src/seed/seedGuidance.js";
import { buildApp } from "../src/index.js";
import {
  purchases,
  recommendations,
  conversations,
  messages,
} from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { createRecommendationService } from "../src/services/recommendationService.js";
import { createConversationService } from "../src/services/conversationService.js";
import { createGuidanceService } from "../src/services/guidanceService.js";
import type { Hono } from "hono";

/**
 * Integration: register + ask end-to-end over in-memory SQLite.
 *
 * Completes task 6.4 by proving the three behaviors the consent/versioning test
 * does not cover:
 *
 *  1. PURCHASE INJECTION — a customer with prior rows in `purchases` has those
 *     refs injected into the agent's system prompt server-side (no tool-calling).
 *     Proven by stubbing the Gemini fetch and inspecting the actual request body
 *     (the `systemInstruction` carries the purchase block).
 *  2. HISTORY CONTINUITY — prior `messages` are loaded across turns so the
 *     conversation continues coherently (the Gemini `contents` accumulate the
 *     previous user/assistant turns, and GET /assistant/history returns them).
 *  3. APPEND-ONLY — DELETE over the recommendations log is rejected (no route,
 *   admin GET-only) and never removes rows; the service exposes no delete/update.
 *
 * Also covered: GUIDANCE INJECTION — the doctor-authored "Guías de la doctora"
 * block is present in the system prompt when enabled guidance exists, and is
 * omitted entirely when there is none.
 *
 * No real API key and no network: the Gemini client is stubbed at the fetch
 * boundary and returns a canned preventive reply.
 */
describe("register + ask (integration: purchase injection, history, append-only)", () => {
  let db: Db;
  let app: Hono;
  let capturedBodies: Array<{ systemInstruction?: unknown; contents?: unknown[] }>;

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const register = async (email: string, phone: string) => {
    const res = await post("/assistant/register", {
      name: "Cliente Test",
      email,
      phone,
      consent_version: 1,
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { customer_id: number }).customer_id;
  };

  beforeAll(async () => {
    // Stub the Gemini HTTP boundary so the assistant router's client can run
    // without a real key or network. We capture every request body it sends.
    process.env.GEMINI_API_KEY = "test-key"; // triggers the real generate() path
    process.env.GEMINI_MODEL = "gemini-test";
    capturedBodies = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body?: string }) => {
      capturedBodies.push(JSON.parse(init?.body ?? "{}"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Para tu bienestar preventivo, considera [100305]." }],
              },
            },
          ],
        }),
      };
    });

    db = createDatabase(":memory:");
    await migrate(db);
    await seedProducts(db);
    await seedGuidance(db);
    app = buildApp(db);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  it("injects a customer's purchases into the agent context without tool-calling", async () => {
    const customerId = await register("compras@x.com", "3001");

    // A customer with prior purchase history.
    const conv = createConversationService(db);
    const conversationId = conv.createConversation(customerId).id;
    db.insert(purchases)
      .values({
        customerId,
        productReference: "100305", // Biotina C Plus (curated, valid)
        qty: 1,
        purchasedAt: new Date().toISOString(),
      })
      .run();

    // The conversation service surfaces those refs (server-side injection source).
    const refs = conv.loadPurchases(customerId);
    expect(refs).toContain("100305");

    const res = await post("/assistant/ask", {
      customer_id: customerId,
      conversation_id: conversationId,
      message: "¿qué me recomiendas?",
    });
    expect(res.status).toBe(200);

    // The system prompt sent to Gemini carries the purchase block — proving the
    // agent received the purchase context, injected server-side (never tool-calling).
    const sent = capturedBodies[capturedBodies.length - 1];
    const sysPrompt = (sent.systemInstruction as { parts: { text: string }[] }).parts[0].text;
    expect(sysPrompt).toContain("HISTORIAL DE COMPRAS DEL USUARIO");
    expect(sysPrompt).toContain("100305");
    // Doctor-authored guidance is injected too, with its title and product refs.
    expect(sysPrompt).toContain("GUÍAS DE LA DOCTORA");
    expect(sysPrompt).toContain("Paquete Vitalidad");
    expect(sysPrompt).toContain("100930");
  });

  it("does not inject purchase context when the customer has no purchases", async () => {
    const customerId = await register("nocompras@x.com", "3002");
    const conv = createConversationService(db);
    const conversationId = conv.createConversation(customerId).id;

    const res = await post("/assistant/ask", {
      customer_id: customerId,
      conversation_id: conversationId,
      message: "hola",
    });
    expect(res.status).toBe(200);

    const sent = capturedBodies[capturedBodies.length - 1];
    const sysPrompt = (sent.systemInstruction as { parts: { text: string }[] }).parts[0].text;
    // No purchases → the purchase block says so explicitly (no refs leaked).
    expect(sysPrompt).toContain("HISTORIAL DE COMPRAS DEL USUARIO: (sin compras registradas)");
    // The FULL catalog is always injected (verify WARNING fix): new users with
    // no purchases still get valid product recommendations, never an empty list.
    expect(sysPrompt).toContain("CATÁLOGO DISPONIBLE");
    expect(sysPrompt).toContain("100305");
  });

  it("omits the guidance block when no guidance is enabled", async () => {
    // Temporarily remove all guidance rows so the DB state has none enabled.
    const svc = createGuidanceService(db);
    for (const g of svc.list()) svc.remove(g.id);
    try {
      const customerId = await register("singuia@x.com", "3006");
      const conv = createConversationService(db);
      const conversationId = conv.createConversation(customerId).id;

      const res = await post("/assistant/ask", {
        customer_id: customerId,
        conversation_id: conversationId,
        message: "hola",
      });
      expect(res.status).toBe(200);

      const sent = capturedBodies[capturedBodies.length - 1];
      const sysPrompt = (sent.systemInstruction as { parts: { text: string }[] }).parts[0].text;
      // No guidance rows → the block must be absent (never an empty header).
      expect(sysPrompt).not.toContain("GUÍAS DE LA DOCTORA");
      // The rest of the context still arrives intact.
      expect(sysPrompt).toContain("CATÁLOGO DISPONIBLE");
      expect(sysPrompt).toContain("HISTORIAL DE COMPRAS DEL USUARIO");
    } finally {
      // Restore the seeded guidance for the tests that follow.
      await seedGuidance(db);
    }
  });

  it("loads prior messages so the conversation continues coherently across turns", async () => {
    const customerId = await register("historia@x.com", "3003");
    const conv = createConversationService(db);
    const conversationId = conv.createConversation(customerId).id;

    // Turn 1.
    const first = await post("/assistant/ask", {
      customer_id: customerId,
      conversation_id: conversationId,
      message: "me siento cansado",
    });
    expect(first.status).toBe(200);

    // Turn 2 — same conversation.
    const second = await post("/assistant/ask", {
      customer_id: customerId,
      conversation_id: conversationId,
      message: "¿y para el sueño?",
    });
    expect(second.status).toBe(200);

    // The Gemini request for turn 2 must include both prior turns + the new one.
    const sent = capturedBodies[capturedBodies.length - 1];
    const contents = (sent.contents ?? []) as Array<{ role: string; parts: { text: string }[] }>;
    const texts = contents.map((m) => m.parts[0].text);
    expect(texts).toContain("me siento cansado");
    // The previous assistant reply (canned reply + appended disclaimer) is
    // carried forward as history, including the recommended reference.
    expect(texts.some((t) => t.includes("[100305]"))).toBe(true);
    expect(texts[texts.length - 1]).toBe("¿y para el sueño?");

    // History endpoint returns the accumulated messages in order.
    const history = await app.request(
      `/assistant/history?conversation_id=${conversationId}&customer_id=${customerId}`,
    );
    expect(history.status).toBe(200);
    const histData = (await history.json()) as { messages: { role: string; content: string }[] };
    expect(histData.messages).toHaveLength(4); // user, assistant, user, assistant
    expect(histData.messages[0].role).toBe("user");
    expect(histData.messages[0].content).toBe("me siento cansado");
  });

  it("rejects DELETE over the recommendations audit log (append-only)", async () => {
    // Seed an audit row through the service (the only legal write path).
    const customerId = await register("audit@x.com", "3004");
    const service = createRecommendationService(db);
    const conv = createConversationService(db);
    const conversationId = conv.createConversation(customerId).id;
    service.append({
      conversationId,
      customerId,
      symptom: "cansancio",
      productReferences: ["100305"],
      rationale: "preventive guidance",
      consentVersion: 1,
      guardBlocked: false,
    });

    const before = db.select().from(recommendations).all().length;

    // Attempt a DELETE via the API — no route exists and admin is GET-only
    // (and gated: outside dev the central /admin/* guard requires an authCore
    // JWT — 401 without one), so it must be non-2xx and must not remove rows.
    const del = await app.request("/admin/recommendations", { method: "DELETE" });
    expect(del.status).toBeGreaterThanOrEqual(400);

    const after = db.select().from(recommendations).all().length;
    expect(after).toBe(before); // nothing deleted
    expect(after).toBeGreaterThan(0); // the audit entry is still there

    // The service contract exposes append + read only — no mutation primitives.
    expect(service).not.toHaveProperty("delete");
    expect(service).not.toHaveProperty("update");

    // Row-level check: the seeded entry is intact and untouched.
    const rows = db.select().from(recommendations).all();
    expect(rows.some((r) => r.symptom === "cansancio" && r.productReferences === '["100305"]')).toBe(true);
  });

  it("keeps conversations and messages readable after the audit entry (no cross-corruption)", async () => {
    const customerId = await register("lectura@x.com", "3005");
    const conv = createConversationService(db);
    const conversationId = conv.createConversation(customerId).id;

    const res = await post("/assistant/ask", {
      customer_id: customerId,
      conversation_id: conversationId,
      message: "prueba de continuidad final",
    });
    expect(res.status).toBe(200);

    const msgs = db.select().from(messages).where(eq(messages.conversationId, conversationId)).all();
    expect(msgs.length).toBeGreaterThanOrEqual(2);

    const convRow = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
    expect(convRow?.customerId).toBe(customerId);
  });
});