import type { ChatMessage } from "./prompt.js";
import type { GeminiClient } from "./gemini.js";

/**
 * agent-persona-memory T2 (S1) — long-term per-customer chat memory.
 *
 * Every MEMORY_SUMMARIZE_EVERY messages of a conversation the assistant runs
 * ONE cheap summarization call and UPSERTs the result into
 * `customer_memories` (one row per customer, cursor = message count of the
 * source conversation). The next prompt injects it via `memoryBlock`, so the
 * bot remembers what was talked about across conversations.
 *
 * Design rules:
 *  - Memory is BEST-EFFORT: the route swallows every failure here, so a
 *    summarization problem never breaks nor delays the customer's reply.
 *  - The counter is per conversation (cursor `upToCount` + the conversation
 *    that produced it): a brand-new conversation restarts at zero and, once
 *    the threshold is reached, REPLACES the summary — the previous summary is
 *    part of the summarizer input, so continuity is preserved, never
 *    duplicated.
 *  - The transcript is bounded (last MEMORY_TRANSCRIPT_MAX messages) and the
 *    stored summary is hard-capped at MEMORY_CONTENT_MAX_CHARS so the prompt
 *    can never balloon.
 */

/** Messages of one conversation between two summarizations (4 user turns). */
export const MEMORY_SUMMARIZE_EVERY = 8;

/** Transcript window handed to the summarizer (last N messages). */
export const MEMORY_TRANSCRIPT_MAX = 60;

/** Hard cap for the stored/injected summary (characters). */
export const MEMORY_CONTENT_MAX_CHARS = 1500;

/**
 * Marker the summarizer's system prompt always carries. The integration
 * tests (and any future observability) use it to tell summarize calls apart
 * from chat calls at the HTTP boundary.
 */
export const SUMMARY_SYSTEM_PROMPT_MARKER = "RESUMEN PERSISTENTE POR CLIENTE";

const SUMMARY_SYSTEM_PROMPT = `${SUMMARY_SYSTEM_PROMPT_MARKER}

Eres el archivista del asistente de bienestar. Te dan el resumen previo de un
cliente (puede estar vacío) y el transcurso reciente de su conversación.
Devuelve UN resumen actualizado en español, máximo 60 palabras, que responda:
quién es el cliente, qué le preocupa, qué productos o videos ya se mencionaron
y qué quedó acordado. Conserva solo lo que sirva para retomar la conversación
en una futura sesión. Responde SOLO con el resumen: sin saludo, sin encabezado,
sin comillas.`;

/**
 * Builds the single-user-message summarization request: the previous summary
 * (for continuity) plus the bounded transcript as `Usuario:` / `Asistente:`
 * lines. Pure — no client, no I/O (unit-testable).
 */
export function buildSummaryRequest(
  previousSummary: string | null,
  history: ChatMessage[],
): { systemPrompt: string; messages: ChatMessage[] } {
  const transcript = history
    .slice(-MEMORY_TRANSCRIPT_MAX)
    .map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content}`)
    .join("\n");
  const content = [
    `RESUMEN PREVIO: ${previousSummary?.trim() ? previousSummary.trim() : "(ninguno)"}`,
    "",
    "CONVERSACIÓN:",
    transcript,
  ].join("\n");
  return {
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  };
}

/**
 * Runs the summarization and returns the capped summary, or null when the
 * model returned nothing usable. Throws only when the client throws — the
 * CALLER (assistant route) is responsible for swallowing: memory is
 * best-effort and must never affect the chat reply.
 */
export async function summarizeConversation(
  client: GeminiClient,
  previousSummary: string | null,
  history: ChatMessage[],
): Promise<string | null> {
  if (history.length === 0) return null;
  const request = buildSummaryRequest(previousSummary, history);
  const raw = await client.generate(request);
  const summary = raw.trim();
  if (!summary) return null;
  return summary.slice(0, MEMORY_CONTENT_MAX_CHARS);
}
