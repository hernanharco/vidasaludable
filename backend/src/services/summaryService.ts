import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  customers,
  customerProfile,
  customerSummaries,
  conversations,
  messages,
  products,
  purchases,
  recommendations,
} from "../db/schema.js";
import type { CustomerSummary } from "../db/schema.js";
import { createGeminiClient, DEFAULT_GEMINI_MODEL } from "../agent/gemini.js";
import type { GeminiClient } from "../agent/gemini.js";
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from "../agent/summaryPrompt.js";

/**
 * Advisor executive summary service (advisor-summary T2).
 *
 * One summary per customer (1:1, `customer_summaries`): `getSummary` reads the
 * stored row (null when the advisor never generated one — S3: the advisor
 * controls when Gemini quota is spent, no cron, no auto-generation) and
 * `generateSummary` gathers the customer's FULL history (S4: intake profile +
 * ALL chat messages chronological + recommendations log + purchases), asks
 * Gemini for the executive summary (S1) and UPSERTs it — a regeneration
 * REPLACES the previous content, model and timestamp.
 *
 * Typed failure signals (mapped to HTTP by routes/admin.ts):
 * - `CustomerNotFoundError` — the customer does not exist (route → 404).
 * - `SummaryGenerationError` — Gemini failed after the client's own retries
 *   (route → 502 GEMINI_UNAVAILABLE, same shape as the assistant route).
 */

export class CustomerNotFoundError extends Error {
  readonly code = "CUSTOMER_NOT_FOUND";
  constructor(customerId: number) {
    super(`customer ${customerId} not found`);
    this.name = "CustomerNotFoundError";
  }
}

export class SummaryGenerationError extends Error {
  readonly code = "SUMMARY_GENERATION_FAILED";
  readonly cause: unknown;
  constructor(cause: unknown) {
    super("summary generation failed");
    this.name = "SummaryGenerationError";
    this.cause = cause;
  }
}

export interface SummaryService {
  /** The customer's stored summary, or null when absent. */
  getSummary(customerId: number): CustomerSummary | null;
  /** Generates (or regenerates) the summary, stores it and returns the row. */
  generateSummary(customerId: number): Promise<CustomerSummary>;
}

/** Defensive parse of the audit log's JSON-array column. */
function parseRefs(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Model recorded on the stored row: the client exposes it when it carries a
 * `model` property (injected clients in tests); otherwise the same resolution
 * order the real client uses (GEMINI_MODEL env, then the default).
 */
function resolveModel(gemini: GeminiClient): string {
  const exposed = (gemini as { model?: unknown }).model;
  if (typeof exposed === "string" && exposed !== "") return exposed;
  return process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
}

export function createSummaryService(db: Db, gemini?: GeminiClient): SummaryService {
  const client = gemini ?? createGeminiClient();

  return {
    getSummary(customerId: number): CustomerSummary | null {
      const row = db
        .select()
        .from(customerSummaries)
        .where(eq(customerSummaries.customerId, customerId))
        .get();
      return row ?? null;
    },

    async generateSummary(customerId: number): Promise<CustomerSummary> {
      const customer = db
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .get();
      if (!customer) throw new CustomerNotFoundError(customerId);

      // S4 context — the customer's full history, gathered server-side.
      const profile =
        db
          .select()
          .from(customerProfile)
          .where(eq(customerProfile.customerId, customerId))
          .get() ?? null;

      // ALL messages of ALL conversations, chronological (created_at then id —
      // created_at has second resolution, so the id breaks same-second ties).
      const chatMessages = db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(eq(conversations.customerId, customerId))
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .all();

      const recommendationRows = db
        .select()
        .from(recommendations)
        .where(eq(recommendations.customerId, customerId))
        .orderBy(asc(recommendations.createdAt), asc(recommendations.id))
        .all();

      const purchaseRows = db
        .select({
          productName: products.name,
          qty: purchases.qty,
          purchasedAt: purchases.purchasedAt,
        })
        .from(purchases)
        .innerJoin(products, eq(purchases.productReference, products.reference))
        .where(eq(purchases.customerId, customerId))
        .orderBy(asc(purchases.purchasedAt), asc(purchases.id))
        .all();

      const prompt = buildSummaryPrompt({
        customer: { name: customer.name, phone: customer.phone },
        profile,
        chatMessages,
        recommendations: recommendationRows.map((r) => ({
          symptom: r.symptom,
          productReferences: parseRefs(r.productReferences),
          rationale: r.rationale,
        })),
        purchases: purchaseRows,
      });

      let content: string;
      try {
        content = await client.generate({
          systemPrompt: SUMMARY_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });
      } catch (err) {
        throw new SummaryGenerationError(err);
      }

      const model = resolveModel(client);

      // UPSERT: regeneration REPLACES the previous summary (1:1 table).
      return db
        .insert(customerSummaries)
        .values({ customerId, content, model })
        .onConflictDoUpdate({
          target: customerSummaries.customerId,
          set: { content, model, generatedAt: sql`CURRENT_TIMESTAMP` },
        })
        .returning()
        .get();
    },
  };
}
