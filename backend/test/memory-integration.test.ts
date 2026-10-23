import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { seedProducts } from "../src/seed/seedProducts.js";
import { buildApp } from "../src/index.js";
import { customerMemories, conversations, messages } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { MEMORY_SUMMARIZE_EVERY, SUMMARY_SYSTEM_PROMPT_MARKER } from "../src/agent/memory.js";

/**
 * agent-persona-memory T2 (S1) — integration over in-memory SQLite for the
 * long-term per-customer memory.
 *
 * The Gemini HTTP boundary is stubbed (no key, no network, no quota). The
 * stub returns the canned chat reply for chat calls and a canned summary for
 * summarize calls (identified by the summary system-prompt marker), so the
 * two call types are distinguishable and countable.
 *
 * Proven behaviors:
 *  1. The migration creates `customer_memories` (idempotent DDL).
 *  2. No memory row before the threshold; after MEMORY_SUMMARIZE_EVERY
 *     messages (4 user turns) exactly ONE summarize call ran and the row
 *     stores the summary + the per-conversation message count cursor.
 *  3. Subsequent asks inject the stored summary into the system prompt
 *     ("LO QUE RECUERDAS…") — the bot remembers across conversations.
 *  4. A new conversation of the same customer starts the counter from zero
 *     and, once the threshold is reached again, REPLACES the summary with an
 *     updated one (cross-conversation continuity).
 *  5. A failing summarize call (HTTP 500, non-retryable) never breaks the
 *     chat: the ask still returns 200 with the reply and no memory row.
 */

const CHAT_REPLY = "Para tu bienestar preventivo, considera [100305].";
const SUMMARY_REPLY =
  "Cliente preocupa por la energía; ya probó Biotina C Plus y duerme poco.";

// After the opening "hola" (2 messages), the conversation needs this many
// asks (2 messages each) to reach the MEMORY_SUMMARIZE_EVERY threshold: 3.
const ASKS_TO_THRESHOLD = (MEMORY_SUMMARIZE_EVERY - 2) / 2;

describe("chat long-term memory (integration)", () => {
  let db: Db;
  let app: Hono;
  let chatCalls: number;
  let summaryCalls: number;
  let capturedRequestBodies: string[];

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

  const ask = (customerId: number, message: string, conversationId?: number) =>
    post("/assistant/ask", {
      customer_id: customerId,
      message,
      ...(conversationId != null ? { conversation_id: conversationId } : {}),
    });

  /** Stubs fetch: chat calls answer CHAT_REPLY, summarize calls SUMMARY_REPLY. */
  function stubFetch({ failSummaries = false }: { failSummaries?: boolean } = {}) {
    chatCalls = 0;
    summaryCalls = 0;
    capturedRequestBodies = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as {
        systemInstruction?: { parts?: Array<{ text?: string }> };
      };
      const systemText = body.systemInstruction?.parts?.[0]?.text ?? "";
      // The raw body is captured so tests can inspect the user message too
      // (the previous summary travels in the summarize request's content).
      capturedRequestBodies.push(init?.body ?? "");
      if (systemText.includes(SUMMARY_SYSTEM_PROMPT_MARKER)) {
        summaryCalls += 1;
        if (failSummaries) {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: SUMMARY_REPLY }] } }],
          }),
        };
      }
      chatCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: CHAT_REPLY }] } }],
        }),
      };
    });
  }

  beforeEach(async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-test";
    stubFetch();
    db = createDatabase(":memory:");
    await migrate(db);
    await seedProducts(db);
    app = buildApp(db);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  it("creates customer_memories via migrate (idempotent DDL)", () => {
    const row = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customer_memories'")
      .get() as { name?: string } | undefined;
    expect(row?.name).toBe("customer_memories");
  });

  it("summarizes exactly once at the threshold and stores the cursor", async () => {
    const customerId = await register("mem1@x.com", "4001");
    const conversationId = ((await (await ask(customerId, "hola")).json()) as {
      conversation_id: number;
    }).conversation_id;

    // One ask BELOW the threshold (messages 4 and 6): no summary, no row.
    for (let turn = 1; turn < ASKS_TO_THRESHOLD; turn += 1) {
      const res = await ask(customerId, `turno ${turn}`, conversationId);
      expect(res.status).toBe(200);
    }
    expect(summaryCalls).toBe(0);
    expect(db.select().from(customerMemories).where(eq(customerMemories.customerId, customerId)).all()).toHaveLength(0);

    // Next ask → message #8: exactly one summarize call, row stored.
    // The summarizer runs OFF the request path (fire-and-forget), so the
    // assertions wait for the background task instead of racing it.
    const res = await ask(customerId, "necesito más energía", conversationId);
    expect(res.status).toBe(200);
    expect(chatCalls).toBe(4);
    await vi.waitFor(() => expect(summaryCalls).toBe(1));

    const rows = db
      .select()
      .from(customerMemories)
      .where(eq(customerMemories.customerId, customerId))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe(SUMMARY_REPLY);
    expect(rows[0]!.upToCount).toBe(MEMORY_SUMMARIZE_EVERY);
    expect(rows[0]!.sourceConversationId).toBe(conversationId);
  });

  it("injects the stored summary into later prompts and updates it in a new conversation", async () => {
    const customerId = await register("mem2@x.com", "4002");
    const conversationId = ((await (await ask(customerId, "hola")).json()) as {
      conversation_id: number;
    }).conversation_id;
    for (let turn = 0; turn < ASKS_TO_THRESHOLD; turn += 1) {
      await ask(customerId, `turno ${turn}`, conversationId);
    }
    await vi.waitFor(() => expect(summaryCalls).toBe(1));

    // Next ask (turn 5): the chat prompt carries the memory block.
    const promptCountBefore = capturedRequestBodies.length;
    await ask(customerId, "quiero seguir donde quedamos", conversationId);
    const lastChatPrompt = capturedRequestBodies
      .slice(promptCountBefore)
      .find((text) => !text.includes(SUMMARY_SYSTEM_PROMPT_MARKER));
    expect(lastChatPrompt).toContain("CONVERSACIONES ANTERIORES");
    expect(lastChatPrompt).toContain(SUMMARY_REPLY);

    // NEW conversation (no conversation_id): counter restarts at zero, so no
    // summarize until the threshold is reached again; then the summary is
    // replaced (cross-conversation continuity), never duplicated.
    const newConvRes = await ask(customerId, "hola de nuevo", undefined);
    const newConversationId = ((await newConvRes.json()) as { conversation_id: number })
      .conversation_id;
    expect(newConversationId).not.toBe(conversationId);
    for (let turn = 0; turn < ASKS_TO_THRESHOLD; turn += 1) {
      await ask(customerId, `tema nuevo ${turn}`, newConversationId);
    }
    await vi.waitFor(() => expect(summaryCalls).toBe(2));

    const rows = db
      .select()
      .from(customerMemories)
      .where(eq(customerMemories.customerId, customerId))
      .all();
    expect(rows).toHaveLength(1); // UPSERT: one row per customer
    expect(rows[0]!.sourceConversationId).toBe(newConversationId);

    // The new summary prompt carried the previous summary (continuity).
    const summaryPrompts = capturedRequestBodies.filter((text) =>
      text.includes(SUMMARY_SYSTEM_PROMPT_MARKER),
    );
    expect(summaryPrompts.at(-1)).toContain(SUMMARY_REPLY);
  });

  it("never breaks the chat when summarization fails (HTTP 500)", async () => {
    stubFetch({ failSummaries: true });
    const customerId = await register("mem3@x.com", "4003");
    const conversationId = ((await (await ask(customerId, "hola")).json()) as {
      conversation_id: number;
    }).conversation_id;
    for (let turn = 0; turn < ASKS_TO_THRESHOLD; turn += 1) {
      const res = await ask(customerId, `turno ${turn}`, conversationId);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reply: string };
      // The deterministic legal guard appends its disclaimer to every reply.
      expect(body.reply).toContain(CHAT_REPLY);
    }
    await vi.waitFor(() => expect(summaryCalls).toBe(1));
    expect(
      db.select().from(customerMemories).where(eq(customerMemories.customerId, customerId)).all(),
    ).toHaveLength(0);

    // The conversation and its messages are intact.
    const msgRows = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .all();
    expect(msgRows).toHaveLength(MEMORY_SUMMARIZE_EVERY);
    const convRow = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
    expect(convRow).toBeTruthy();
  });
});
