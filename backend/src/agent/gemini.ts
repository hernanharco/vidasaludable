import type { ChatMessage } from "./prompt.js";

/**
 * Gemini REST client (v1beta) with retry/backoff, model rotation and graceful
 * no-key fallback.
 *
 * - Reads `GEMINI_API_KEY`, `GEMINI_MODELS` (comma-separated rotation chain),
 *   `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL` from the environment. The key is
 *   NEVER hard-coded or committed (see .env.example). Ownership: the active
 *   `GEMINI_API_KEY` belongs to Eliana Rincon Ossa's account (set in the server
 *   env / local .env, never in git).
 * - Retries HTTP 429 / 503 per model with backoff 2s / 5s / 10s (three retries
 *   after the first attempt).
 * - When a model is exhausted on a rate limit (429), rotates to the NEXT model
 *   of the chain — every model has its own free-tier quota bucket ("si un
 *   modelo se llena, rota"). Non-retryable statuses never rotate. A full-chain
 *   exhaustion is the pathological case and can take one backoff cycle per
 *   model (~17s each); it only happens when every bucket of the account is
 *   spent.
 * - Chain resolution: `deps.models` → exact chain; else `GEMINI_MODELS` env →
 *   exact chain; else `[primary, fallback, ...DEFAULT_MODEL_CHAIN]` deduped
 *   (primary/fallback from deps/env, defaulting to the first two entries).
 * - When no API key is configured, returns a graceful fallback instead of
 *   erroring (spec: "Missing API key" scenario).
 * - `fetch` and `sleep` are injectable for tests.
 */

/**
 * Free-tier rotation order (Google AI Studio quotas, as of 2026-10):
 * 1-2  Gemini 3.5/3.1 Flash Lite — 15 RPM / 250K TPM / 500 RPD (primary buckets)
 * 3-7  Gemini 3.8/3.7/3.6/3/2.5 Flash — 5 RPM / 250K TPM / 20 RPD (quality step)
 * 8    Gemini 2.5 Flash Lite — 10 RPM / 250K TPM / 20 RPD (short-burst overflow)
 * 9-10 Gemma 4 31B/26B — 30 RPM but only 16K TPM (last resort, short outputs)
 */
export const DEFAULT_MODEL_CHAIN: readonly string[] = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemma-4-31b",
  "gemma-4-26b",
];

export const DEFAULT_GEMINI_MODEL = DEFAULT_MODEL_CHAIN[0]!;
export const DEFAULT_FALLBACK_MODEL = DEFAULT_MODEL_CHAIN[1]!;

/**
 * Generation temperature. Raised from the original 0.3 to 0.6
 * (agent-persona-memory T1, S5): 0.3 made every reply read robotic. The legal
 * risk stays covered by the layers that do NOT depend on temperature — the
 * deterministic guardReply (legal wording) and the catalog/segment filters
 * (invented `[REF]` / `[VIDEO:id]` markers are dropped server-side).
 */
export const TEMPERATURE = 0.6;

/** Retry/backoff schedule in milliseconds for transient errors (429/503). */
export const RETRY_BACKOFF_MS = [2000, 5000, 10000];

export interface GeminiGenerateInput {
  systemPrompt: string;
  messages: ChatMessage[];
}

export interface GeminiClient {
  /** Returns the generated text reply. Throws only after retries are exhausted. */
  generate(input: GeminiGenerateInput): Promise<string>;
  /** True when an API key is configured. */
  isConfigured(): boolean;
}

export type FetchLike = (url: string, init: unknown) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type SleepLike = (ms: number) => Promise<void>;

export interface GeminiDeps {
  apiKey?: string;
  model?: string;
  fallbackModel?: string;
  /** Exact rotation chain; wins over `GEMINI_MODEL`/`GEMINI_FALLBACK_MODEL`. */
  models?: string[];
  fetch?: FetchLike;
  sleep?: SleepLike;
}

/** Parses a comma-separated chain ("a, b,, c" → [a, b, c]); empty → undefined. */
function parseChain(raw: string | undefined): string[] | undefined {
  const items = raw?.split(",").map((s) => s.trim()).filter(Boolean);
  return items?.length ? items : undefined;
}

/** Preserves order, drops blanks and duplicates (first occurrence wins). */
function dedupeChain(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

const sleepDefault: SleepLike = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FALLBACK_REPLY =
  "El asistente está temporalmente sin conexión con el motor de recomendación. " +
  "Por favor, inténtelo de nuevo más tarde. Recuerde que este asistente ofrece " +
  "orientación general de prevención y no sustituye la consulta médica.";

export function createGeminiClient(deps: GeminiDeps = {}): GeminiClient {
  const apiKey = deps.apiKey ?? process.env.GEMINI_API_KEY;
  const model = deps.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const fallbackModel =
    deps.fallbackModel ?? process.env.GEMINI_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODEL;
  // Rotation chain: exact chain from deps/env, else primary + fallback + the
  // free-tier defaults (deduped) so a configured primary still rotates on 429.
  const chain: string[] = deps.models?.length
    ? dedupeChain(deps.models)
    : (parseChain(process.env.GEMINI_MODELS) ?? dedupeChain([model, fallbackModel, ...DEFAULT_MODEL_CHAIN]));
  const fetchFn: FetchLike =
    deps.fetch ?? ((url, init) => globalThis.fetch(url as string, init as RequestInit) as ReturnType<FetchLike>);
  const sleepFn: SleepLike = deps.sleep ?? sleepDefault;

  async function requestWithRetry(body: unknown, targetModel: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["x-goog-api-key"] = apiKey;
    }

    let lastError: Error & { status?: number } | null = null;
    // Attempt 1 immediate; subsequent attempts back off 2s / 5s / 10s.
    for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
      if (attempt > 0) {
        await sleepFn(RETRY_BACKOFF_MS[attempt - 1]!);
      }
      const res = await fetchFn(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return text;
        }
        lastError = new Error("gemini: empty response payload");
        continue;
      }
      if (res.status === 429 || res.status === 503) {
        lastError = Object.assign(new Error(`gemini: transient HTTP ${res.status}`), {
          status: res.status,
        });
        continue; // back off and retry
      }
      throw new Error(`gemini: non-retryable HTTP ${res.status}`);
    }
    throw lastError ?? new Error("gemini: request failed");
  }

  return {
    isConfigured(): boolean {
      return Boolean(apiKey);
    },
    async generate(input: GeminiGenerateInput): Promise<string> {
      if (!apiKey) {
        return FALLBACK_REPLY;
      }
      const contents = input.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      const body = {
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        contents,
        generationConfig: { temperature: TEMPERATURE },
      };
      let lastRateLimit: unknown = null;
      for (const targetModel of chain) {
        try {
          return await requestWithRetry(body, targetModel);
        } catch (err) {
          // Rate-limit exhaustion on this model → rotate to the next one; each
          // model has its own quota bucket ("si un modelo se llena, rota").
          // Non-retryable errors (400, …) keep the legacy behavior: throw.
          const status = (err as { status?: number }).status;
          if (status === 429) {
            lastRateLimit = err;
            continue;
          }
          throw err;
        }
      }
      throw (lastRateLimit as Error) ?? new Error("gemini: request failed");
    },
  };
}