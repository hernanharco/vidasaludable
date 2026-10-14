import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { createAdminRouter } from "../src/routes/admin.js";
import {
  customers,
  customerProfile,
  customerSummaries,
  conversations,
  messages,
  products,
  purchases,
  recommendations,
} from "../src/db/schema.js";
import type { Customer } from "../src/db/schema.js";
import type { GeminiClient, GeminiGenerateInput } from "../src/agent/gemini.js";
import { SUMMARY_SYSTEM_PROMPT } from "../src/agent/summaryPrompt.js";
import type { Hono } from "hono";

/**
 * Integration: advisor executive summary (advisor-summary T2) over in-memory
 * SQLite, through the real admin router with the REAL summary service — only
 * the Gemini client is faked via the router's deps injection (no network, no
 * key).
 *
 * Covered behaviors:
 *  1. POST /customers/:id/summary generates on demand (S3): the fake Gemini is
 *     called exactly once and the stored row comes back as `{ summary }`.
 *  2. The prompt aggregates the FULL history (S4): customer data, intake
 *     profile, ALL chat messages chronological with role, recommendations log
 *     and purchases — asserted on the captured prompt input.
 *  3. GET /customers/:id/summary returns the SAME stored row (content +
 *     generatedAt) without touching Gemini.
 *  4. Regeneration REPLACES the previous summary (still one row, 1:1).
 *  5. GET without a stored summary → { summary: null }.
 *  6. Unknown customer → 404 (existing admin error shape); invalid id → 400;
 *     Gemini failure → 502 GEMINI_UNAVAILABLE (assistant-route shape).
 */
describe("admin customer summary (integration)", () => {
  let db: Db;

  const SUMMARY_A =
    "## Qué consulta\nDuerme mal y quiere bajar de peso.\n\n## Siguiente paso sugerido\nLlamarla el lunes.";
  const SUMMARY_B =
    "## Qué consulta\nSeguimiento de peso.\n\n## Siguiente paso sugerido\nEnviar plan semanal.";

  /** Fake Gemini: scripted replies + captured inputs, deps-injected. */
  function createFakeGemini(replies: string[]) {
    const calls: GeminiGenerateInput[] = [];
    const client: GeminiClient = {
      isConfigured: () => true,
      generate: async (input: GeminiGenerateInput) => {
        calls.push(input);
        const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
        if (reply == null) throw new Error("fake gemini: no scripted reply");
        return reply;
      },
    };
    return { client, calls };
  }

  function buildAdminApp(geminiClient: GeminiClient): Hono {
    return createAdminRouter(db, { geminiClient });
  }

  let customerSeq = 0;
  function seedCustomer(name?: string): Customer {
    customerSeq += 1;
    return db
      .insert(customers)
      .values({
        name: name ?? `Cliente Summary ${customerSeq}`,
        email: `summary${customerSeq}@x.com`,
        phone: `39${String(customerSeq).padStart(8, "0")}`,
        consentVersion: 1,
        consentTimestamp: "2026-01-01T00:00:00.000Z",
        registeredAt: "2026-01-01T00:00:00.000Z",
      })
      .returning()
      .get();
  }

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await migrate(db);
  });

  it("POST generates the summary once and GET returns the same stored row", async () => {
    const fake = createFakeGemini([SUMMARY_A]);
    const app = buildAdminApp(fake.client);

    // Seed the FULL customer history the prompt must aggregate (S4).
    const customer = seedCustomer("Ana Prueba");
    db.insert(customerProfile)
      .values({
        customerId: customer.id,
        sex: "F",
        age: 42,
        goal: "bajar de peso",
        diet: "omnivora",
        activity: "sedentaria",
        sleep: "insomnio leve",
        stress: "alto",
        openNote: "le duele la rodilla al caminar",
      })
      .run();
    const conv = db
      .insert(conversations)
      .values({ customerId: customer.id })
      .returning()
      .get();
    db.insert(messages)
      .values({ conversationId: conv.id, role: "user", content: "Tengo sueño intermitente" })
      .run();
    db.insert(messages)
      .values({
        conversationId: conv.id,
        role: "assistant",
        content: "Te recomiendo magnesio por la noche.",
      })
      .run();
    db.insert(products)
      .values({
        reference: "990001",
        name: "Biotina C Plus (test)",
        category: "vitaminas",
        size: "60 tabletas",
        price: 12.5,
        benefits: "piel y cabello",
        dosage: "1 al día",
        ingredients: "biotina",
        disclaimer: "no es medicamento",
      })
      .run();
    db.insert(purchases)
      .values({
        customerId: customer.id,
        productReference: "990001",
        qty: 2,
        purchasedAt: "2026-02-01T10:00:00.000Z",
      })
      .run();
    db.insert(recommendations)
      .values({
        conversationId: conv.id,
        customerId: customer.id,
        symptom: "sueño intermitente",
        productReferences: JSON.stringify(["990001"]),
        rationale: "El magnesio ayuda a relajar.",
        consentVersion: 1,
      })
      .run();

    const postRes = await app.request(`/customers/${customer.id}/summary`, { method: "POST" });
    expect(postRes.status).toBe(200);
    const posted = (await postRes.json()) as {
      summary: { customerId: number; content: string; model: string; generatedAt: string };
    };
    expect(fake.calls.length).toBe(1);
    expect(posted.summary.customerId).toBe(customer.id);
    expect(posted.summary.content).toBe(SUMMARY_A);
    expect(typeof posted.summary.model).toBe("string");
    expect(posted.summary.model.length).toBeGreaterThan(0);
    expect(typeof posted.summary.generatedAt).toBe("string");

    // S4 — the prompt aggregates the FULL history (captured Gemini input).
    const sent = fake.calls[0]!;
    const prompt = `${sent.systemPrompt}\n${sent.messages.map((m) => m.content).join("\n")}`;
    expect(prompt).toContain("Ana Prueba");
    expect(prompt).toContain(customer.phone);
    expect(prompt).toContain("bajar de peso");
    expect(prompt).toContain("insomnio leve");
    expect(prompt).toContain("le duele la rodilla al caminar");
    expect(prompt).toContain("Tengo sueño intermitente");
    expect(prompt).toContain("Te recomiendo magnesio por la noche.");
    expect(prompt).toContain("user");
    expect(prompt).toContain("assistant");
    expect(prompt).toContain("sueño intermitente");
    expect(prompt).toContain("990001");
    expect(prompt).toContain("Biotina C Plus (test)");
    // S1 — the five executive-summary sections in the system prompt.
    for (const section of [
      "## Qué consulta",
      "## Dolores y objeciones",
      "## Qué se le recomendó",
      "## Señales de venta y productos de interés",
      "## Siguiente paso sugerido",
    ]) {
      expect(SUMMARY_SYSTEM_PROMPT).toContain(section);
    }

    // GET returns the SAME stored row without calling Gemini again.
    const getRes = await app.request(`/customers/${customer.id}/summary`);
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { summary: typeof posted.summary };
    expect(got.summary).toEqual(posted.summary);
    expect(fake.calls.length).toBe(1);
  });

  it("POST again regenerates: replaces content, calls Gemini again, keeps one row", async () => {
    const fake = createFakeGemini([SUMMARY_A, SUMMARY_B]);
    const app = buildAdminApp(fake.client);
    const customer = seedCustomer();

    const first = (await (
      await app.request(`/customers/${customer.id}/summary`, { method: "POST" })
    ).json()) as { summary: { content: string } };
    expect(first.summary.content).toBe(SUMMARY_A);

    const secondRes = await app.request(`/customers/${customer.id}/summary`, { method: "POST" });
    expect(secondRes.status).toBe(200);
    const second = (await secondRes.json()) as { summary: { content: string } };
    expect(second.summary.content).toBe(SUMMARY_B);
    expect(fake.calls.length).toBe(2);

    // 1:1 table — regeneration REPLACES, never accumulates rows.
    const rows = db
      .select()
      .from(customerSummaries)
      .where(eq(customerSummaries.customerId, customer.id))
      .all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.content).toBe(SUMMARY_B);
  });

  it("GET without a stored summary returns { summary: null }", async () => {
    const fake = createFakeGemini([]);
    const app = buildAdminApp(fake.client);
    const customer = seedCustomer();

    const res = await app.request(`/customers/${customer.id}/summary`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: null });
    expect(fake.calls.length).toBe(0);
  });

  it("POST for an unknown customer returns 404 in the existing error shape", async () => {
    const fake = createFakeGemini([SUMMARY_A]);
    const app = buildAdminApp(fake.client);

    const res = await app.request("/customers/999999/summary", { method: "POST" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "customer not found" });
    expect(fake.calls.length).toBe(0); // never asks Gemini for a ghost customer
  });

  it("an invalid id is 400 on both GET and POST", async () => {
    const fake = createFakeGemini([]);
    const app = buildAdminApp(fake.client);

    const getRes = await app.request("/customers/abc/summary");
    expect(getRes.status).toBe(400);
    expect(await getRes.json()).toEqual({ error: "invalid id" });

    const postRes = await app.request("/customers/abc/summary", { method: "POST" });
    expect(postRes.status).toBe(400);
    expect(await postRes.json()).toEqual({ error: "invalid id" });
  });

  it("a Gemini failure surfaces as 502 GEMINI_UNAVAILABLE and stores nothing", async () => {
    const fake: GeminiClient = {
      isConfigured: () => true,
      generate: async () => {
        throw new Error("gemini: non-retryable HTTP 500");
      },
    };
    const app = buildAdminApp(fake);
    const customer = seedCustomer();

    const res = await app.request(`/customers/${customer.id}/summary`, { method: "POST" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "GEMINI_UNAVAILABLE",
      message: "Motor de recomendación no disponible",
    });
    expect(
      db.select().from(customerSummaries).where(eq(customerSummaries.customerId, customer.id)).all(),
    ).toEqual([]);
  });

  it("generates even when the customer has no profile, chats, recommendations or purchases", async () => {
    const fake = createFakeGemini([SUMMARY_A]);
    const app = buildAdminApp(fake.client);
    const customer = seedCustomer();

    const res = await app.request(`/customers/${customer.id}/summary`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: { content: string } };
    expect(body.summary.content).toBe(SUMMARY_A);
    expect(fake.calls.length).toBe(1);
    // The prompt still carries the customer data block, with empty history.
    const prompt = fake.calls[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain(customer.name);
  });
});
