export interface ConsentInfo {
  version: number;
  text: string;
}

export interface ChatMessage {
  sender: "user" | "agent";
  text: string;
}

export type Phase = "boot" | "access_code" | "gate" | "intake" | "chat";

/**
 * Client-side shape of the 5-step intake answers (camelCase). The wire
 * contract of `POST /api/assistant/profile` is snake_case — ChatSession does
 * the translation in one place.
 */
export interface IntakeProfile {
  sex: "M" | "F" | "";
  age: string;
  goal: string;
  diet: string;
  activity: string;
  sleep: string;
  stress: string;
  openNote: string;
}

/**
 * Resolved card data for an ENABLED video segment, as served by
 * `GET /api/assistant/videos`. The chat widget fetches this list at boot and
 * resolves persisted `[VIDEO:<id>]` markers against it.
 */
export interface VideoCardInfo {
  id: number;
  title: string;
  condition: string | null;
  summary: string;
  url: string;
  speaker: string;
  /**
   * T4 Phase A: raw integer seconds (YouTube `&t=` contract). Optional —
   * cards served before the API carried them render without a time chip.
   * The card formats them to `M:SS` for display only.
   */
  startS?: number;
  endS?: number;
}

/**
 * T6 — Resolved card data for a catalog product, as served by
 * `GET /api/assistant/products`. The chat widget fetches the list at boot and
 * resolves the `[REF]` citations (extract convention `\[\d{4,6}\]`, same as
 * the backend's extractProductRefs) against it. `price` stays a number on the
 * wire; ProductCard formats it to es-ES currency for display.
 */
export interface ProductCardInfo {
  reference: string;
  name: string;
  price: number;
  category: string;
  benefits: string;
  disclaimer: string;
}
