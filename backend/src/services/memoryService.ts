import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { customerMemories } from "../db/schema.js";
import type { CustomerMemory } from "../db/schema.js";

/**
 * Customer memory service: the long-term per-customer chat summary
 * (agent-persona-memory T2, S1), backed by `customer_memories` (1:1 with
 * `customers` — exactly one row per customer, UPSERT-replaced).
 *
 * `upsert` always REPLACES the summary with the new one (content +
 * sourceConversationId + upToCount cursor) — continuity across conversations
 * comes from the summarizer input carrying the previous summary, not from
 * accumulating rows. Only the assistant route calls it (after a successful
 * summarization); the service never talks to Gemini.
 */
export interface MemoryUpsertInput {
  content: string;
  sourceConversationId: number;
  upToCount: number;
}

export interface MemoryService {
  /** Insert or replace the customer's single memory row. */
  upsert(customerId: number, input: MemoryUpsertInput): CustomerMemory | undefined;
  /** The customer's memory row, or undefined when absent/invalid id. */
  getByCustomer(customerId: number): CustomerMemory | undefined;
}

/** The only hard invariant: customer_id must be a positive integer. */
function isValidCustomerId(customerId: number): boolean {
  return Number.isInteger(customerId) && customerId > 0;
}

export function createMemoryService(db: Db): MemoryService {
  return {
    upsert(customerId: number, input: MemoryUpsertInput): CustomerMemory | undefined {
      if (!isValidCustomerId(customerId)) return undefined;
      const updatedAt = new Date().toISOString();
      return db
        .insert(customerMemories)
        .values({
          customerId,
          content: input.content,
          sourceConversationId: input.sourceConversationId,
          upToCount: input.upToCount,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: customerMemories.customerId,
          set: {
            content: input.content,
            sourceConversationId: input.sourceConversationId,
            upToCount: input.upToCount,
            updatedAt,
          },
        })
        .returning()
        .get();
    },

    getByCustomer(customerId: number): CustomerMemory | undefined {
      if (!isValidCustomerId(customerId)) return undefined;
      return db
        .select()
        .from(customerMemories)
        .where(eq(customerMemories.customerId, customerId))
        .get();
    },
  };
}
