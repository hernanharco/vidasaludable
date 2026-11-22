/**
 * Preflight for the admin analyze route: the server-side acquisition depends on
 * three environment preconditions, and every one of them used to fail AFTER the
 * 202 — the CRM then stored the same `analysis_error` on each retry, with no way
 * to tell a transient failure from a broken deployment (prod incident
 * 2026-11-22: expired YouTube cookies reported as "check the URL").
 *
 * Checking them BEFORE the single-flight slot turns each into an actionable
 * 503 with its own `code`. Everything here is a pure configuration check: no
 * subprocess beyond the memoized `yt-dlp --version`, no cookie copy, no writes.
 */
import { createGeminiClient } from "../agent/gemini.js";
import type { GeminiClient } from "../agent/gemini.js";
import { assertCookieMasterReadable, createYtdlpPreflight } from "../tools/media.js";
import type { CommandRunner } from "../tools/media.js";

/** Machine-readable reason for a refused analysis (the CRM renders `error`). */
export type AnalysisPreflightCode =
  | "youtube_cookies_unavailable"
  | "gemini_not_configured"
  | "ytdlp_unavailable";

/** Only this type maps to 503; anything else stays an unexpected 500. */
export class AnalysisPreflightError extends Error {
  constructor(
    readonly code: AnalysisPreflightCode,
    message: string,
  ) {
    super(message);
    this.name = "AnalysisPreflightError";
  }
}

export interface AnalysisPreflightOptions {
  /**
   * True when the server itself must acquire the artifact (no transcript in
   * the body): only then are the cookie master and the yt-dlp binary needed.
   * Gemini is required in both modes.
   */
  acquire: boolean;
}

export type AnalysisPreflight = (options: AnalysisPreflightOptions) => Promise<void>;

export interface AnalysisPreflightDeps {
  /** Fake in tests: the binary check must not depend on the host. */
  ytdlpRunner?: CommandRunner;
  /** Fake in tests: `isConfigured()` without touching the ambient env. */
  geminiClient?: GeminiClient;
}

/** Wraps a plain helper error into the coded one the route maps to 503. */
function asPreflight(code: AnalysisPreflightCode, err: unknown): AnalysisPreflightError {
  return new AnalysisPreflightError(code, err instanceof Error ? err.message : String(err));
}

export function createAnalysisPreflight(deps: AnalysisPreflightDeps = {}): AnalysisPreflight {
  const gemini = deps.geminiClient ?? createGeminiClient();
  const ytdlp = createYtdlpPreflight(deps.ytdlpRunner);
  return async ({ acquire }) => {
    // Gemini runs in both acquisition modes. An injected client is consulted
    // as-is; without one the env is read per call, so a key added or removed at
    // runtime is honoured without restarting the process.
    const configured = deps.geminiClient ? gemini.isConfigured() : createGeminiClient().isConfigured();
    if (!configured) {
      throw new AnalysisPreflightError(
        "gemini_not_configured",
        "Falta GEMINI_API_KEY en el servidor: sin él el análisis no puede ejecutarse.",
      );
    }
    if (!acquire) return;
    try {
      assertCookieMasterReadable();
    } catch (err) {
      throw asPreflight("youtube_cookies_unavailable", err);
    }
    try {
      await ytdlp();
    } catch (err) {
      throw asPreflight("ytdlp_unavailable", err);
    }
  };
}
