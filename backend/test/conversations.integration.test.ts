import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { seedProducts } from "../src/seed/seedProducts.js";
import { buildApp } from "../src/index.js";
import { conversations as conversationsTable } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { MEMORY_SUMMARIZE_EVERY, SUMMARY_SYSTEM_PROMPT_MARKER } from "../src/agent/memory.js";

/**
 * multi-conversation T1 — backend slice over in-memory SQLite (specs S1 and S2).
 *
 * S1: a customer can create and list several independent conversations
 * (sidebar-style), each with an auto-derived title and an activity stamp.
 * S2: the long-term memory stays GLOBAL — the summary learned in one
 * conversation is injected into the others (the existing
 * memory-integration.test.ts covers the summarization mechanics; the S2 test
 * below proves the multi-conversation flow does not isolate it).
 *
 * Covered:
 *  1. MIGRATION — `conversations.title` (nullable) + `updated_at` (NOT NULL)
 *     exist on fresh DDL, and the migrate path ALTERs a pre-T1 table
 *     (non-empty, the production case) backfilling `updated_at` from
 *     `created_at`; migrate stays idempotent.
 *  2. GET /assistant/conversations — the customer's conversations only,
 *     newest activity first, with title/updated_at/created_at/snippet;
 *     400 invalid customer_id, 404 unknown customer (route conventions).
 *  3. POST /assistant/conversations — creates an EMPTY conversation for the
 *     customer ({conversation_id}); same 400/404 checks.
 *  4. POST /assistant/ask — refreshes `updated_at` of the conversation used
 *     and derives `title` from the FIRST user message (trimmed, ~40-60
 *     chars) while the conversation is still untitled.
 *  5. Ownership — a conversation of another customer is still rejected
 *     (403) on /ask and /history.
 *  6. S2 — a summary stored from conversation A is injected into
 *     conversation B of the same customer (one global memory row).
 *
 * No real API key and no network: the Gemini HTTP boundary is stubbed at
 * `fetch` (chat calls get the canned reply, summarize calls the canned
 * summary, distinguished by the summary system-prompt marker).
 */

const CHAT_REPLY = "Para tu bienestar preventivo, considera [100305].";
const SUMMARY_REPLY = "Cliente con dolor de espalda; duerme mal y se levanta cansado.";

// Each ask persists 2 messages (user + assistant), so this many asks reach
// the MEMORY_SUMMARIZE_EVERY threshold from a fresh conversation.
const ASKS_TO_THRESHOLD = MEMORY_SUMMARIZE_EVERY / 2;

describe("multi-conversation T1 (S1 list/create, S2 global memory)", () => {
  let db: Db;
  let app: Hono;
  let chatPrompts: string[];
  let summaryCalls: number;

  const request = (path: string, init?: RequestInit) => app.request(path, init);

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
      consent_version: 2,
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { customer_id: number }).customer_id;
  };

  /** Creates an empty conversation through the T1 endpoint. */
  const createConversation = async (customerId: number) => {
    const res = await post("/assistant/conversations", { customer_id: customerId });
    expect(res.status).toBe(200);
    return ((await res.json()) as { conversation_id: number }).conversation_id;
  };

  const ask = (customerId: number, message: string, conversationId: number) =>
    post("/assistant/ask", {
      customer_id: customerId,
      message,
      conversation_id: conversationId,
    });

  const conversationRow = (conversationId: number) =>
    db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId)).get();

  /** Stubs fetch: chat calls answer CHAT_REPLY, summarize calls SUMMARY_REPLY. */
  function stubFetch() {
    chatPrompts = [];
    summaryCalls = 0;
    vi.stubGlobal("fetch", async (_url: string, init: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as {
        systemInstruction?: { parts?: Array<{ text?: string }> };
      };
      const systemText = body.systemInstruction?.parts?.[0]?.text ?? "";
      if (systemText.includes(SUMMARY_SYSTEM_PROMPT_MARKER)) {
        summaryCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: SUMMARY_REPLY }] } }],
          }),
        };
      }
      chatPrompts.push(init?.body ?? "");
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

  // ------------------------------------------------------------------
  // 1. Migration
  // ------------------------------------------------------------------

  it("migrate adds conversations.title (nullable) + updated_at (NOT NULL) and stays idempotent", async () => {
    const cols = db.$client.prepare("PRAGMA table_info(conversations)").all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const title = cols.find((c) => c.name === "title");
    const updatedAt = cols.find((c) => c.name === "updated_at");
    expect(title, "conversations.title missing").toBeTruthy();
    expect(title!.notnull).toBe(0); // title is NULLABLE (untitled conversations)
    expect(updatedAt, "conversations.updated_at missing").toBeTruthy();
    expect(updatedAt!.notnull).toBe(1);
    expect(updatedAt!.dflt_value).toBe("CURRENT_TIMESTAMP"); // fresh-DB default

    // Idempotency: a second migrate over the same database must not throw.
    await migrate(db);
  });

  it("migrate ALTERs a pre-T1 conversations table (non-empty) and backfills updated_at", async () => {
    // Simulate a production database that predates T1: the OLD conversations
    // shape (no title/updated_at) with an existing row — the case where
    // SQLite rejects `DEFAULT CURRENT_TIMESTAMP` in ADD COLUMN.
    const legacy = createDatabase(":memory:");
    // Same shape migrate.ts creates (referrer_phone/… are needed because
    // migrate creates its indexes against this table when the DDL skips it).
    legacy.$client.exec(`CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      referrer_phone TEXT,
      referrer_id INTEGER,
      consent_version INTEGER NOT NULL,
      consent_timestamp TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
    legacy.$client.exec(`CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
    legacy.$client.exec(
      `INSERT INTO customers (name, email, phone, consent_version, consent_timestamp, registered_at)
       VALUES ('Legacy', 'legacy-t1@x.com', '3999', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );
    legacy.$client.exec(
      `INSERT INTO conversations (customer_id, created_at) VALUES (1, '2026-05-04 10:20:30')`,
    );

    await migrate(legacy);

    const cols = legacy.$client.prepare("PRAGMA table_info(conversations)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    expect(cols.find((c) => c.name === "title")?.notnull).toBe(0);
    expect(cols.find((c) => c.name === "updated_at")?.notnull).toBe(1);

    const row = legacy.$client
      .prepare("SELECT title, updated_at, created_at FROM conversations WHERE id = 1")
      .get() as { title: string | null; updated_at: string; created_at: string };
    expect(row.title).toBeNull(); // pre-T1 rows start untitled
    // Backfilled from created_at — NOT the '' sentinel of the ADD COLUMN default.
    expect(row.updated_at).toBe("2026-05-04 10:20:30");

    // Idempotency over the legacy shape too.
    await migrate(legacy);
  });

  // ------------------------------------------------------------------
  // 2. GET /assistant/conversations
  // ------------------------------------------------------------------

  it("GET /assistant/conversations lists only the customer's conversations, newest activity first", async () => {
    const customerA = await register("convs-a@x.com", "5001");
    const customerB = await register("convs-b@x.com", "5002");
    const convA1 = await createConversation(customerA);
    const convA2 = await createConversation(customerA);
    const convB = await createConversation(customerB);

    // Activity: A1 asked first, A2 asked second (titles come from /ask).
    expect((await ask(customerA, "me duele la espalda al levantarme por la mañana", convA1)).status).toBe(200);
    expect((await ask(customerA, "¿qué puedo hacer para el sueño de mi mamá?", convA2)).status).toBe(200);

    const res = await request(`/assistant/conversations?customer_id=${customerA}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      conversations: Array<{
        id: number;
        customer_id: number;
        title: string | null;
        updated_at: string;
        created_at: string;
        snippet: string | null;
      }>;
    };

    // S1: only customer A's conversations, newest activity (updated_at) first.
    expect(data.conversations.map((c) => c.id)).toEqual([convA2, convA1]);

    const first = data.conversations[0]!;
    expect(first.customer_id).toBe(customerA);
    expect(first.title).toBe("¿qué puedo hacer para el sueño de mi mamá?");
    expect(typeof first.updated_at).toBe("string");
    expect(typeof first.created_at).toBe("string");
    // Snippet = last message of the conversation (the assistant reply here),
    // truncated at SNIPPET_MAX_CHARS (80) + ellipsis.
    expect(first.snippet).toContain("bienestar");
    expect(first.snippet!.length).toBeLessThanOrEqual(81);
    expect(first.snippet!.endsWith("…")).toBe(true);

    // Customer B's list is independent (no cross-customer leakage).
    const resB = await request(`/assistant/conversations?customer_id=${customerB}`);
    const dataB = (await resB.json()) as { conversations: Array<{ id: number }> };
    expect(dataB.conversations.map((c) => c.id)).toEqual([convB]);

    // A conversation created but never asked is EMPTY: no title, no snippet.
    const emptyRes = await request(`/assistant/conversations?customer_id=${customerB}`);
    const emptyData = (await emptyRes.json()) as {
      conversations: Array<{ title: string | null; snippet: string | null; updated_at: string }>;
    };
    expect(emptyData.conversations[0]!.title).toBeNull();
    expect(emptyData.conversations[0]!.snippet).toBeNull();
    expect(emptyData.conversations[0]!.updated_at).toBeTruthy();
  });

  it("GET /assistant/conversations validates customer_id (400 invalid / 404 unknown)", async () => {
    const missing = await request("/assistant/conversations");
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "customer_id inválido" });

    const invalid = await request("/assistant/conversations?customer_id=abc");
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "customer_id inválido" });

    const zero = await request("/assistant/conversations?customer_id=0");
    expect(zero.status).toBe(400);

    const unknown = await request("/assistant/conversations?customer_id=999999");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "customer no encontrado" });

    // A registered customer with no conversations yet → empty list, 200.
    const customerId = await register("convs-empty@x.com", "5003");
    const empty = await request(`/assistant/conversations?customer_id=${customerId}`);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ conversations: [] });
  });

  // ------------------------------------------------------------------
  // 3. POST /assistant/conversations
  // ------------------------------------------------------------------

  it("POST /assistant/conversations creates an empty conversation (400/404 validated)", async () => {
    const customerId = await register("convs-new@x.com", "5004");
    const res = await post("/assistant/conversations", { customer_id: customerId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversation_id: number };
    expect(typeof body.conversation_id).toBe("number");

    const row = conversationRow(body.conversation_id);
    expect(row).toBeTruthy();
    expect(row!.customerId).toBe(customerId);
    expect(row!.title).toBeNull(); // empty conversation: untitled
    expect(row!.updatedAt).toBeTruthy();

    // Invalid customer_id → 400 (same convention as /profile and /history).
    const invalid = await post("/assistant/conversations", { customer_id: "abc" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "customer_id inválido" });

    const missingField = await post("/assistant/conversations", {});
    expect(missingField.status).toBe(400);

    // Unknown customer → 404.
    const unknown = await post("/assistant/conversations", { customer_id: 999999 });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "customer no encontrado" });

    // Malformed body → 400.
    const malformed = await request("/assistant/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "cuerpo inválido" });
  });

  // ------------------------------------------------------------------
  // 4. POST /assistant/ask — updated_at refresh + title derivation
  // ------------------------------------------------------------------

  it("POST /assistant/ask refreshes updated_at and derives the title from the first user message", async () => {
    const customerId = await register("convs-title@x.com", "5005");
    const conversationId = await createConversation(customerId);

    // Backdate so the refresh is observable regardless of clock resolution.
    db.update(conversationsTable)
      .set({ updatedAt: "2020-01-01T00:00:00.000Z" })
      .where(eq(conversationsTable.id, conversationId))
      .run();

    const longMessage =
      "tengo dolor de espalda desde hace tres semanas y también me cuesta dormir";
    const first = await ask(customerId, longMessage, conversationId);
    expect(first.status).toBe(200);

    let row = conversationRow(conversationId)!;
    // (a) updated_at refreshed by the turn.
    expect(row.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    // (b) title derived from the FIRST user message: a prefix of the trimmed
    // message, in the ~40-60 char band.
    expect(row.title).toBeTruthy();
    expect(longMessage.startsWith(row.title!)).toBe(true);
    expect(row.title!.length).toBeGreaterThanOrEqual(40);
    expect(row.title!.length).toBeLessThanOrEqual(60);
    const derivedTitle = row.title!;

    // Second turn: updated_at refreshes again, the title does NOT change.
    db.update(conversationsTable)
      .set({ updatedAt: "2020-01-01T00:00:00.000Z" })
      .where(eq(conversationsTable.id, conversationId))
      .run();
    const second = await ask(customerId, "¿y qué suplemento me recomiendas?", conversationId);
    expect(second.status).toBe(200);
    row = conversationRow(conversationId)!;
    expect(row.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(row.title).toBe(derivedTitle); // first message wins

    // A short first message becomes the title verbatim.
    const shortConv = await createConversation(customerId);
    expect((await ask(customerId, "hola", shortConv)).status).toBe(200);
    expect(conversationRow(shortConv)!.title).toBe("hola");

    // Auto-create path (/ask WITHOUT conversation_id) derives the title too,
    // and trims + collapses internal whitespace into a single-line title.
    const autoRes = await post("/assistant/ask", {
      customer_id: customerId,
      message: "  hola   ¿cómo\n  estás?  ",
    });
    expect(autoRes.status).toBe(200);
    const autoId = ((await autoRes.json()) as { conversation_id: number }).conversation_id;
    expect(conversationRow(autoId)!.title).toBe("hola ¿cómo estás?");
  });

  // ------------------------------------------------------------------
  // 5. Ownership validation still holds
  // ------------------------------------------------------------------

  it("keeps conversation ownership validation (403) on /ask and /history", async () => {
    const owner = await register("convs-owner@x.com", "5006");
    const other = await register("convs-other@x.com", "5007");
    const owned = await createConversation(owner);

    const askRes = await ask(other, "hola", owned);
    expect(askRes.status).toBe(403);
    expect(await askRes.json()).toEqual({ error: "conversación no pertenece al customer" });

    const historyRes = await request(
      `/assistant/history?conversation_id=${owned}&customer_id=${other}`,
    );
    expect(historyRes.status).toBe(403);

    // An unknown conversation id is not owned by anyone → 403 on /ask.
    const unknownConv = await ask(other, "hola", 999999);
    expect(unknownConv.status).toBe(403);

    // The owner still gets a normal reply (200).
    expect((await ask(owner, "hola", owned)).status).toBe(200);
  });

  // ------------------------------------------------------------------
  // 6. S2 — memory stays GLOBAL across conversations
  // ------------------------------------------------------------------

  it("S2: a memory summarized in one conversation is injected into another of the same customer", async () => {
    const customerId = await register("convs-global@x.com", "5008");
    const convA = await createConversation(customerId);

    // Reach the summarization threshold inside conversation A.
    for (let turn = 0; turn < ASKS_TO_THRESHOLD; turn += 1) {
      const res = await ask(customerId, `turno ${turn}`, convA);
      expect(res.status).toBe(200);
    }
    await vi.waitFor(() => expect(summaryCalls).toBe(1));

    // Exactly ONE global memory row for the customer (S2: not per-topic).
    const memoryRows = db.$client
      .prepare("SELECT COUNT(*) AS n FROM customer_memories WHERE customer_id = ?")
      .get(customerId) as { n: number };
    expect(memoryRows.n).toBe(1);

    // Conversation B: the prompt still carries the summary learned in A.
    const convB = await createConversation(customerId);
    expect((await ask(customerId, "otra pregunta sobre otro tema", convB)).status).toBe(200);
    const lastChatPrompt = chatPrompts.at(-1)!;
    expect(lastChatPrompt).toContain(SUMMARY_REPLY);
    // ...and no second summarize call was triggered by the new conversation.
    expect(summaryCalls).toBe(1);
  });
});
