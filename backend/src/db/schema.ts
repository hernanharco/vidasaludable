import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { assessmentSymptoms } from "./assessmentSchema.js";

/**
 * Portable Drizzle schema (SQLite dialect). The relational model maps 1:1 to
 * Postgres (drizzle-orm/pg-core) if the backend migrates off SQLite; column
 * names and keys are kept dialect-neutral so only the table builders change.
 *
 * Append-only: `recommendations` is an audit log. No UPDATE/DELETE is exposed
 * by the service or API layers (see recommendationService + admin routes).
 */

/** Versioned informed-consent metadata lives on the customer row. */
export const customers = sqliteTable(
  "customers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    referrerPhone: text("referrer_phone"),
    referrerId: integer("referrer_id").references(() => referrers.id),
    consentVersion: integer("consent_version").notNull(),
    consentTimestamp: text("consent_timestamp").notNull(),
    registeredAt: text("registered_at").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("customers_email_unique").on(t.email),
    uniqueIndex("customers_phone_unique").on(t.phone),
    index("customers_referrer_phone_idx").on(t.referrerPhone),
  ],
);

/** Structured Nutrilite catalog — single source of truth for product data. */
export const products = sqliteTable(
  "products",
  {
    reference: text("reference").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    size: text("size").notNull(),
    price: real("price").notNull(),
    benefits: text("benefits").notNull(),
    dosage: text("dosage").notNull(),
    ingredients: text("ingredients").notNull(),
    disclaimer: text("disclaimer").notNull(),
  },
  (t) => [index("products_category_idx").on(t.category)],
);

/** Purchase history, injected server-side into the agent context. */
export const purchases = sqliteTable(
  "purchases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    productReference: text("product_reference")
      .notNull()
      .references(() => products.reference),
    qty: integer("qty").notNull().default(1),
    purchasedAt: text("purchased_at").notNull(),
  },
  (t) => [index("purchases_customer_id_idx").on(t.customerId)],
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("conversations_customer_id_idx").on(t.customerId)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id),
    role: text("role").notNull(), // 'user' | 'assistant'
    content: text("content").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("messages_conversation_id_idx").on(t.conversationId)],
);

/**
 * Append-only recommendation audit log. Each entry records timestamp,
 * referenced products, the rationale that produced it, the consent version at
 * the time, and whether the deterministic guard blocked/rewrote the reply.
 */
export const recommendations = sqliteTable(
  "recommendations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    symptom: text("symptom").notNull(),
    productReferences: text("product_references").notNull(), // JSON array of valid refs
    rationale: text("rationale").notNull(),
    consentVersion: integer("consent_version").notNull(),
    guardBlocked: integer("guard_blocked", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("recommendations_customer_id_idx").on(t.customerId),
    index("recommendations_created_at_idx").on(t.createdAt),
  ],
);

/**
 * Doctor-authored knowledge/guidance, injected server-side into the agent
 * context (alongside catalog + purchase history) to enrich preventive
 * recommendations. Editable knowledge — unlike `recommendations` (append-only
 * audit log), UPDATE/DELETE are exposed by the service and admin routes.
 */
export const guidance = sqliteTable(
  "guidance",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    productReferences: text("product_references").notNull(), // JSON array of catalog refs
    enabled: integer("enabled").notNull().default(1), // 0 | 1
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("guidance_enabled_idx").on(t.enabled)],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Recommendation = typeof recommendations.$inferSelect;
export type NewRecommendation = typeof recommendations.$inferInsert;
export type Guidance = typeof guidance.$inferSelect;
export type NewGuidance = typeof guidance.$inferInsert;

/** Referrer codes for tracking who invited each customer. */
export const referrers = sqliteTable(
  "referrers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("referrers_code_unique").on(t.code),
    index("referrers_active_idx").on(t.active),
  ],
);

export type Referrer = typeof referrers.$inferSelect;
export type NewReferrer = typeof referrers.$inferInsert;

/**
 * Educational videos analyzed by the pipeline (speaker, YouTube original URL).
 *
 * `status` is a small state machine over the pipeline lifecycle: a freshly
 * ingested row is `draft`; analysis promotes it to `analyzed`; the ffmpeg cut
 * step to `cut`; the owner's channel upload to `published`.
 */
export const videos = sqliteTable(
  "videos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    speaker: text("speaker").notNull(), // e.g. "Luis Collantes"
    youtubeId: text("youtube_id").notNull(), // ORIGINAL video id
    url: text("url").notNull(),
    title: text("title").notNull(),
    durationS: integer("duration_s"), // null while unknown
    status: text("status").notNull().default("draft"), // 'draft' | 'analyzed' | 'cut' | 'published'
    licenseNote: text("license_note"), // written owner permission, gate for clip re-upload
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("videos_youtube_id_unique").on(t.youtubeId)],
);

/**
 * Timestamped educational segments extracted from a video, one row per
 * condition excerpt. `condition` is the normalized assessment-symptom text;
 * `symptomId` is the resolved `assessment_symptoms` row (nullable until the
 * admin assigns it). `enabled` gates injection into the chat assistant.
 *
 * URL resolution (see assistant.ts): `clipYoutubeId` present → the owner's
 * channel clip; otherwise a deep link into the ORIGINAL video
 * (`watch?v=<youtube_id>&t=<start_s>`), which works with no clip uploaded.
 */
export const videoSegments = sqliteTable(
  "video_segments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    videoId: integer("video_id")
      .notNull()
      .references(() => videos.id),
    condition: text("condition"), // normalized assessment-symptom text (nullable until matched)
    symptomId: integer("symptom_id").references(() => assessmentSymptoms.id),
    startS: integer("start_s").notNull(), // seconds into the original video
    endS: integer("end_s").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    clipYoutubeId: text("clip_youtube_id"), // owner-channel clip, null until uploaded
    // T5: products the educator MENTIONS inside the segment. Both columns
    // store JSON string arrays, same convention as guidance.product_references:
    // `mentionedProducts` keeps the RAW mentions (catalog-anchored later),
    // `productReferences` holds only VALID catalog refs. Nullable: pre-T5 rows
    // and segments without product mentions stay NULL.
    mentionedProducts: text("mentioned_products"), // JSON array of raw mentions
    productReferences: text("product_references"), // JSON array of valid catalog refs
    enabled: integer("enabled").notNull().default(0), // 0 | 1 — approved for chat injection
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("video_segments_enabled_idx").on(t.enabled),
    index("video_segments_condition_idx").on(t.condition),
  ],
);

export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
export type VideoSegment = typeof videoSegments.$inferSelect;
export type NewVideoSegment = typeof videoSegments.$inferInsert;