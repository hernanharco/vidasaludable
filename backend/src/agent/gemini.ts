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
 * - Rotates to the NEXT model of the chain on BOTH transient statuses: 429
 *   (quota spent) and 503 (Google-side overload). Every model has its own
 *   free-tier quota bucket, and a 503 is usually model-scoped, so dying on the
 *   first model while nine others are idle is a self-inflicted outage
 *   (incident 2026-11-23: "transient HTTP 503" killed analyses). Non-retryable
 *   statuses never rotate. A full-chain exhaustion can take one backoff cycle
 *   per model (~17s each) and only happens when every model is unavailable.
 * - A full-chain exhaustion throws an error naming the chain size and keeping
 *   the last transient error as `cause`, so the server log shows what Google
 *   actually answered.
 * - Chain resolution: `deps.models` → exact chain; else `GEMINI_MODELS` env →
 *   exact chain; else `[primary, fallback, ...DEFAULT_MODEL_CHAIN]` deduped
 *   (primary/fallback from deps/env, defaulting to the first two entries).
 * - When no API key is configured, returns a graceful fallback instead of
 *   erroring (spec: "Missing API key" scenario).
 * - `fetch` and `sleep` are injectable for tests.
 */

/**
 * Free-tier rotation order (verified against the AI Studio console on
 * 2026-11-23 — the previous list carried `gemini-3.7-flash`, which does NOT
 * exist in the account and hard-aborted the chain on its 404):
 * 1-2  Gemini 3.5/3.1 Flash Lite — 15 RPM / 250K TPM / 500 RPD (primary buckets)
 * 3-6  Gemini 3.8/3.6/3/2.5 Flash — 5 RPM / 250K TPM / 20 RPD (quality step)
 * 7    Gemini 2.5 Flash Lite — 10 RPM / 250K TPM / 20 RPD (short-burst overflow)
 * 8-9  Gemma 4 31B/26B — 30 RPM / 16K TPM but 14.4K RPD: volume, not long
 *      transcripts (a 56-min transcript does not fit in 16K TPM)
 *
 * Available but deliberately absent: `gemini-4-hydrogen` (5 RPM / 250K TPM /
 * 20 RPD) awaits its exact API id; 3.1 Pro, 2.5 Pro and 4 Argon/Carbon/Neon
 * are listed with 0/0/0 — no free tier, so no useful bucket to rotate into.
 */
export const DEFAULT_MODEL_CHAIN: readonly string[] = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
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

/**
 * Statuses that mean "this model is unavailable right now": 429 = quota spent,
 * 503 = Google-side overload. Both are retried in-model with backoff AND then
 * rotate to the next model of the chain (2026-11-23: a 503 on the primary
 * aborted the analysis while the other models were healthy).
 */
const RETRYABLE_STATUSES: readonly number[] = [429, 503];

/**
 * Statuses that rotate WITHOUT an in-model retry: 404 means the model does not
 * exist in this account (renamed, deprecated, or a typo in GEMINI_MODELS).
 * Retrying cannot help, but aborting the chain leaves every healthy model
 * unused — that is how a phantom chain entry became a hard wall on the day the
 * two primary buckets ran out (2026-11-23).
 */
const ROTATE_ONLY_STATUSES: readonly number[] = [404];

function isRetryable(status: number | undefined): boolean {
  return status !== undefined && RETRYABLE_STATUSES.includes(status);
}

function shouldRotate(status: number | undefined): boolean {
  return isRetryable(status) || (status !== undefined && ROTATE_ONLY_STATUSES.includes(status));
}

/** Transient failure annotated with the HTTP status and the attempts spent. */
type TransientFailure = Error & { status?: number; attempts?: number };

export interface GeminiGenerateInput {
  systemPrompt: string;
  messages: ChatMessage[];
  /**
   * Cancellation for the request in flight.
   *
   * The analysis runner races every job against a deadline; without a signal
   * that race only ABANDONED the promise while the HTTP request kept running
   * and kept spending quota (debt recorded in L13). The signal is forwarded to
   * `fetch`, so an abort kills the request instead of orphaning it. An already
   * aborted signal makes the next attempt reject immediately — the retry loop
   * treats it as a non-rotatable failure and propagates it.
   */
  signal?: AbortSignal;
  /**
   * Output cap in tokens, applied only when the target model accepts the field
   * (the `gemini` family does; the `gemma` entries do not and keep the default).
   *
   * Opt-in on purpose: the chat path must keep generating exactly as before.
   * The analyzer sets it because a long tutorial yields dozens of segments and
   * an implicit provider default truncated the JSON mid-object — a failure the
   * parser could only see as "unusable segments".
   */
  maxOutputTokens?: number;
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

export function createGeminiClient(deps: GeminiDeps = {}): GeminiClient {  const apiKey = deps.apiKey ?? process.env.GEMINI_API_KEY;
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

  async function requestWithRetry(
    body: unknown,
    targetModel: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["x-goog-api-key"] = apiKey;
    }

    let lastError: TransientFailure | null = null;
    // Attempt 1 immediate; subsequent attempts back off 2s / 5s / 10s.
    for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
      if (attempt > 0) {
        await sleepFn(RETRY_BACKOFF_MS[attempt - 1]!);
      }
      const res = await fetchFn(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
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
      if (isRetryable(res.status)) {
        lastError = Object.assign(new Error(`gemini: transient HTTP ${res.status}`), {
          status: res.status,
          attempts: attempt + 1,
        });
        continue; // back off and retry
      }
      // Non-retryable statuses carry the status too: the rotation loop has to
      // tell "unknown model" (404 → next model) from "bad request" (400 → die).
      throw Object.assign(new Error(`gemini: non-retryable HTTP ${res.status}`), {
        status: res.status,
        attempts: attempt + 1,
      });
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
      // The body is per model: the output cap depends on the model family and
      // can be dropped when a provider rejects it. Every drop leaves a warning:
      // a cap that never reaches the wire makes the reply look truncated, and
      // the analyzer's "respuesta truncada" would then send the operator to
      // raise a budget that was never applied.
      const familyAcceptsCap = (targetModel: string): boolean =>
        targetModel.startsWith("gemini");
      const buildBody = (targetModel: string, withCap: boolean) => ({
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        contents,
        generationConfig: {
          temperature: TEMPERATURE,
          ...(withCap && familyAcceptsCap(targetModel)
            ? { maxOutputTokens: input.maxOutputTokens }
            : {}),
        },
      });
      let lastTransient: TransientFailure | null = null;
      for (const targetModel of chain) {
        // A 400 is normally a genuinely bad request (key, model name), but a
        // provider that rejects the optional output cap would then kill the
        // whole analysis over a tuning field. The cap is therefore retried
        // once WITHOUT it on the same model before the error is allowed out.
        const capUsable =
          input.maxOutputTokens !== undefined && familyAcceptsCap(targetModel);
        if (input.maxOutputTokens !== undefined && !capUsable) {
          console.warn(
            `gemini: maxOutputTokens omitido para ${targetModel}: la familia del modelo no acepta el campo`,
          );
        }
        const attemptPlans = capUsable ? [true, false] : [false];
        let failure: unknown;
        for (const withCap of attemptPlans) {
          try {
            return await requestWithRetry(
              buildBody(targetModel, withCap),
              targetModel,
              input.signal,
            );
          } catch (err) {
            failure = err;
            if (withCap && (err as { status?: number }).status === 400) {
              console.warn(
                `gemini: ${targetModel} rechazó maxOutputTokens con HTTP 400; se reintenta sin tope`,
              );
              continue;
            }
            break;
          }
        }
        // Quota (429) and overload (503) rotate after in-model retries; an
        // unknown model (404) rotates immediately. Both cases mean "this
        // bucket is useless", not "the request is wrong". Non-retryable
        // errors (400, 401, …) keep the legacy behavior: throw.
        const status = (failure as { status?: number }).status;
        if (shouldRotate(status)) {
          lastTransient = failure as TransientFailure;
          continue;
        }
        throw failure;
      }
      if (lastTransient) {
        // Name the chain size and keep the last failure as `cause`: the row
        // message is composed downstream, so this is the only place the
        // server-side log can learn what Google actually answered.
        const detail = lastTransient.message.replace(/^gemini:\s*/, "");
        throw Object.assign(
          new Error(`gemini: chain exhausted after ${chain.length} models (last: ${detail})`, {
            cause: lastTransient,
          }),
          { status: lastTransient.status },
        );
      }
      throw new Error("gemini: request failed");
    },
  };
}