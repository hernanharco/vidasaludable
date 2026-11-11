import { eq, asc, desc } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { conversations, messages, purchases } from "../db/schema.js";
import type { Conversation, Message } from "../db/schema.js";

/**
 * Conversation service: persistence of conversations + messages and server-side
 * purchase-context loading for agent injection.
 */

/**
 * multi-conversation T1 (S1): cap for auto-derived sidebar titles — the
 * ~40-60 char band the design calls for (a longer first message is cut).
 */
export const TITLE_MAX_CHARS = 50;

/** Last-message snippet cap for the sidebar list (truncated with an ellipsis). */
const SNIPPET_MAX_CHARS = 80;

/**
 * Derives a sidebar title from the first user message (multi-conversation T1):
 * trimmed, internal whitespace collapsed to single spaces, capped at
 * TITLE_MAX_CHARS. Blank input yields null (the conversation stays untitled).
 */
export function titleFromMessage(message: string): string | null {
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.length > TITLE_MAX_CHARS ? trimmed.slice(0, TITLE_MAX_CHARS) : trimmed;
}

/** Conversation row enriched with the sidebar snippet (last message). */
export interface ConversationListItem extends Conversation {
  /** Last message content (truncated), or null for an empty conversation. */
  snippet: string | null;
}

export interface ConversationService {
  /** Creates a conversation for a customer (used when none is supplied). */
  createConversation(customerId: number): Conversation;
  /**
   * The customer's conversations, newest activity first (`updated_at` desc,
   * `id` desc as tiebreak) — the sidebar list of multi-conversation T1 (S1).
   * Each item carries the last-message snippet.
   */
  listByCustomer(customerId: number): ConversationListItem[];
  /**
   * multi-conversation T1: refresh `updated_at` (turn activity) and, while the
   * conversation is still untitled, derive `title` from this first user
   * message. A previously derived title is never rewritten.
   */
  touchConversation(conversationId: number, message: string): void;
  /** Loads messages for a conversation, oldest first (multi-turn continuity). */
  loadMessages(conversationId: number): Message[];
  /** Loads message pairs (role/content) for prompt injection. */
  loadHistory(conversationId: number): Array<{ role: "user" | "assistant"; content: string }>;
  /** Appends a message and returns it. */
  saveMessage(conversationId: number, role: "user" | "assistant", content: string): Message;
  /** Loads the customer's purchase product references (server-side injection). */
  loadPurchases(customerId: number): string[];
  /** Verifies a conversation belongs to a customer. */
  belongsToCustomer(conversationId: number, customerId: number): boolean;
}

export function createConversationService(db: Db): ConversationService {
  return {
    createConversation(customerId: number): Conversation {
      // `updated_at` is written explicitly (ISO-8601, the service convention):
      // on pre-T1-migrated databases the column was added with a '' sentinel
      // default that the backfill only replaced for pre-existing rows, so
      // omitting it here would store '' instead of a timestamp.
      return db
        .insert(conversations)
        .values({ customerId, updatedAt: new Date().toISOString() })
        .returning()
        .get();
    },

    listByCustomer(customerId: number): ConversationListItem[] {
      const rows = db
        .select()
        .from(conversations)
        .where(eq(conversations.customerId, customerId))
        .orderBy(desc(conversations.updatedAt), desc(conversations.id))
        .all();
      return rows.map((row) => ({ ...row, snippet: lastMessageSnippet(db, row.id) }));
    },

    touchConversation(conversationId: number, message: string): void {
      const row = db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .get();
      if (!row) return; // routes validate existence/ownership first; defensive
      db.update(conversations)
        .set({
          updatedAt: new Date().toISOString(),
          // First message wins: only derive a title while none is stored.
          title: row.title ?? titleFromMessage(message),
        })
        .where(eq(conversations.id, conversationId))
        .run();
    },

    loadMessages(conversationId: number): Message[] {
      return db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.id))
        .all();
    },

    loadHistory(conversationId: number): Array<{ role: "user" | "assistant"; content: string }> {
      return this.loadMessages(conversationId).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    },

    saveMessage(conversationId: number, role: "user" | "assistant", content: string): Message {
      return db.insert(messages).values({ conversationId, role, content }).returning().get();
    },

    loadPurchases(customerId: number): string[] {
      const rows = db
        .select()
        .from(purchases)
        .where(eq(purchases.customerId, customerId))
        .orderBy(asc(purchases.id))
        .all();
      return rows.map((r) => r.productReference);
    },

    belongsToCustomer(conversationId: number, customerId: number): boolean {
      const row = db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .get();
      return row ? row.customerId === customerId : false;
    },
  };
}

/**
 * Sidebar snippet (multi-conversation T1): the LAST message of the
 * conversation (newest activity first list — the reply is what the user just
 * saw), truncated to SNIPPET_MAX_CHARS. null for an empty conversation.
 */
function lastMessageSnippet(db: Db, conversationId: number): string | null {
  const last = db
    .select({ content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.id))
    .limit(1)
    .get();
  if (!last) return null;
  const text = last.content.trim();
  if (!text) return null;
  return text.length > SNIPPET_MAX_CHARS ? `${text.slice(0, SNIPPET_MAX_CHARS)}…` : text;
}