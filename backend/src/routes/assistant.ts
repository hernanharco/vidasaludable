import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { createCustomerService } from "../services/customerService.js";
import { createConversationService } from "../services/conversationService.js";
import { createRecommendationService } from "../services/recommendationService.js";
import { createCatalogService } from "../services/catalogService.js";
import { createGuidanceService } from "../services/guidanceService.js";
import { createVideoService, parseSegmentProductList } from "../services/videoService.js";
import { createGeminiClient } from "../agent/gemini.js";
import { buildSystemPrompt, buildHistoryMessages, extractProductRefs, extractVideoRefs, pairSegmentProducts } from "../agent/prompt.js";
import { guardReply } from "../agent/guard.js";
import { getCurrentConsent } from "../config/consent.js";
import type { Product } from "../db/schema.js";

/**
 * Assistant routes: consent, ask (chat), history, public videos.
 *
 * - GET  /assistant/consent → {version, text} (rendered by the chat UI).
 * - POST /assistant/ask     → consent version-gated; server-side purchase
 *   injection; Gemini → deterministic guard → append-only audit log.
 * - GET  /assistant/history → prior messages for memory.
 * - GET  /assistant/videos  → enabled segment cards with resolved URLs
 *   (public, no auth — the widget fetches them at boot to render the
 *   `[VIDEO:id]` markers the agent cites; same surface as /assistant/consent).
 * - GET  /assistant/products → public catalog map (all products-table rows,
 *   public card fields only — the widget boot-fetches it to resolve the
 *   `[REF]` citations the agent writes, extract convention \[\d{4,6}\],
 *   same as extractProductRefs; T6).
 *
 * Product not-found is internal, never a 404 to the client: only valid catalog
 * refs are injected, so the agent never invents details.
 */
export function createAssistantRouter(db: Db): Hono {
  const app = new Hono();
  const customers = createCustomerService(db);
  const conversations = createConversationService(db);
  const recommendations = createRecommendationService(db);
  const catalog = createCatalogService(db);
  const guidance = createGuidanceService(db);
  const videos = createVideoService(db);
  const gemini = createGeminiClient();

  app.get("/consent", (c) => {
    return c.json(getCurrentConsent());
  });

  // Public segment map for the chat widget: ENABLED segments only, each with
  // its resolved YouTube URL (clip wins, original deep-link fallback).
  app.get("/videos", (c) => {
    const cards = videos.listEnabledSegmentCards();
    return c.json({
      videos: cards.map((card) => ({
        id: card.id, // SEGMENT id — the `[VIDEO:id]` marker the agent cites
        title: card.title,
        condition: card.condition,
        summary: card.summary,
        url: resolveSegmentUrl(card),
        speaker: card.speaker,
        // T4 Phase A: raw integer seconds — the frontend formats to mm:ss.
        startS: card.startS,
        endS: card.endS,
        // T5: valid catalog refs linked to the segment (parsed by the service),
        // for the frontend product cards that pair with `[VIDEO:id]` cites.
        productReferences: card.productReferences,
      })),
    });
  });

  // T6 — public product catalog for the chat widget's `[REF]` citations.
  // Same public surface as /assistant/videos (no auth): all products-table
  // rows, mapped to the exact ProductCard fields the frontend renders. The
  // payload deliberately exposes only the public card shape — size, dosage
  // and ingredients stay server-side.
  app.get("/products", (c) => {
    const rows = catalog.listAll();
    return c.json({
      products: rows.map((p) => ({
        reference: p.reference, // the `[ref]` citation token the agent writes
        name: p.name,
        price: p.price, // number on the wire; the card formats to es-ES currency
        category: p.category,
        benefits: p.benefits,
        disclaimer: p.disclaimer,
      })),
    });
  });

  app.get("/history", (c) => {
    const conversationId = Number(c.req.query("conversation_id"));
    const customerId = Number(c.req.query("customer_id"));
    if (!Number.isInteger(conversationId) || !Number.isInteger(customerId)) {
      return c.json({ error: "conversation_id y customer_id son requeridos" }, 400);
    }
    if (!customers.getById(customerId)) {
      return c.json({ error: "customer no encontrado" }, 404);
    }
    if (!conversations.belongsToCustomer(conversationId, customerId)) {
      return c.json({ error: "conversación no pertenece al customer" }, 403);
    }
    return c.json({ messages: conversations.loadHistory(conversationId) });
  });

  app.post("/ask", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "cuerpo inválido" }, 400);
    }

    const customerId = Number(body.customer_id);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const suppliedConversationId = body.conversation_id != null ? Number(body.conversation_id) : null;

    if (!Number.isInteger(customerId) || !message) {
      return c.json({ error: "customer_id y message son requeridos" }, 400);
    }
    const customer = customers.getById(customerId);
    if (!customer) {
      return c.json({ error: "customer no encontrado" }, 404);
    }

    // Consent is VERSION-GATED: stale consent → re-consent required, no recommendation.
    if (!customers.hasCurrentConsent(customerId)) {
      return c.json(
        { error: "CONSENT_REQUIRED", consent: getCurrentConsent() },
        401,
      );
    }

    // Resolve conversation (create if absent, or validate ownership).
    let conversationId: number;
    if (suppliedConversationId != null) {
      if (!conversations.belongsToCustomer(suppliedConversationId, customerId)) {
        return c.json({ error: "conversación no pertenece al customer" }, 403);
      }
      conversationId = suppliedConversationId;
    } else {
      conversationId = conversations.createConversation(customerId).id;
    }

    // Server-side purchase-context injection (not tool-calling).
    const purchaseRefs = conversations.loadPurchases(customerId);
    // Inject the FULL catalog so the agent can recommend to any user (fixes
    // verify WARNING: new users with no purchases got an empty catalog and no
    // suggestions). Purchases stay as personalization context. Only real refs.
    const catalogProducts = catalog.listAll();

    // Persist user message, build history, run the agent.
    conversations.saveMessage(conversationId, "user", message);
    const history = conversations.loadHistory(conversationId);
    const guidanceItems = guidance.listEnabled();
    // Enabled (admin-approved) video segments: injected as context AND used
    // to validate the `[VIDEO:id]` markers the agent cites (defensive filter,
    // same pattern as product refs + catalog.lookup).
    const enabledSegments = videos.listEnabledSegments();
    const systemPrompt = buildSystemPrompt(
      { products: catalogProducts },
      { refs: purchaseRefs },
      {
        items: guidanceItems.map((g) => ({
          title: g.title,
          content: g.content,
          productReferences: parseGuidanceRefs(g.productReferences),
        })),
      },
      {
        items: enabledSegments.map((s) => ({
          id: s.id,
          title: s.title,
          condition: s.condition,
          summary: s.summary,
          // Raw integer seconds — videoSegmentsBlock formats the mm:ss range.
          startS: s.startS,
          endS: s.endS,
          // T5: the segment's product mentions paired with catalog refs
          // (catalog-anchored: a mention gains `[ref]` only when it matches a
          // linked product — see pairSegmentProducts).
          products: pairSegmentProducts(
            parseSegmentProductList(s.mentionedProducts),
            parseSegmentProductList(s.productReferences),
            catalogProducts,
          ),
        })),
      },
    );

    let rawReply: string;
    try {
      rawReply = await gemini.generate({
        systemPrompt,
        messages: buildHistoryMessages(history, message),
      });
    } catch (err) {
      return c.json({ error: "GEMINI_UNAVAILABLE", message: "Motor de recomendación no disponible" }, 503);
    }

    // Deterministic legal guard.
    const guarded = guardReply(rawReply);

    // Video refs: only ids of ENABLED segments survive; unknown/invented ids
    // are dropped from `video_refs` (the reply text keeps its markers).
    const enabledSegmentIds = new Set(enabledSegments.map((s) => s.id));
    const videoRefs = extractVideoRefs(guarded.reply).filter((id) => enabledSegmentIds.has(id));

    // Append-only audit log entry.
    const refs = extractProductRefs(guarded.reply).filter((r) => catalog.lookup(r).found);
    recommendations.append({
      conversationId,
      customerId,
      symptom: message,
      productReferences: refs,
      rationale: guarded.reply,
      consentVersion: customer.consentVersion,
      guardBlocked: guarded.guardBlocked,
    });

    conversations.saveMessage(conversationId, "assistant", guarded.reply);

    return c.json({
      conversation_id: conversationId,
      reply: guarded.reply,
      guard_blocked: guarded.guardBlocked,
      recommended_product_refs: refs,
      video_refs: videoRefs,
    });
  });

  return app;
}

/**
 * URL resolution (ODD contract, exact rule): a physical clip on the owner's
 * channel wins — `watch?v=<clip>`; otherwise a deep link into the ORIGINAL
 * video at the segment start: `watch?v=<original>&t=<startS>` with INTEGER
 * seconds and no `s` suffix. The fallback is the pre-permission deep link
 * (docs/video-permissions.md) — the chat never depends on a clip existing.
 */
function resolveSegmentUrl(card: {
  clipYoutubeId: string | null;
  youtubeId: string;
  startS: number;
}): string {
  if (card.clipYoutubeId) {
    return `https://www.youtube.com/watch?v=${card.clipYoutubeId}`;
  }
  return `https://www.youtube.com/watch?v=${card.youtubeId}&t=${card.startS}`;
}

/**
 * Parses the persisted JSON-array of product refs. Defensive: a corrupted row
 * degrades to an empty list instead of crashing the chat.
 */
function parseGuidanceRefs(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}