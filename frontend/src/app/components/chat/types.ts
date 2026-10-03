export interface ConsentInfo {
  version: number;
  text: string;
}

export interface ChatMessage {
  sender: "user" | "agent";
  text: string;
}

export type Phase = "boot" | "access_code" | "gate" | "chat";

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
}
