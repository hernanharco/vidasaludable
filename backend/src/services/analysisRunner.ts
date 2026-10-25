import type { Db } from "../db/client.js";
import type { Video } from "../db/schema.js";
import { assessmentSymptoms } from "../db/assessmentSchema.js";
import { createVideoService } from "./videoService.js";
import { analyzeVideo } from "../tools/videoPipeline.js";
import { createYtdlpClient } from "../tools/media.js";
import { createGeminiClient } from "../agent/gemini.js";

/**
 * admin-video-analyze (odd/tasks/admin-video-analyze.md, S1/S2): runs the
 * video pipeline SERVER-SIDE so the CRM can trigger it without a terminal.
 *
 * - Single-flight: one analysis at a time for the whole instance; a second
 *   trigger claims nothing and the route answers 409.
 * - Fire-and-forget: `start()` never awaits the job (a 56-minute video takes
 *   minutes — the HTTP request must not block). State lands in
 *   `videos.analysis_state` / `analysis_error`; on success the flags clear
 *   (analyzeVideo has already updated status/segments), on failure only the
 *   message changes — status and existing segments are never touched (S3).
 *
 * The analyzer is injectable so tests exercise the real runner without
 * network or subprocesses (same injectable-deps pattern as videoPipeline).
 */

/** The heavy leaf: (default) build yt-dlp + Gemini clients and run the
 * pipeline for this video; reject → analysis failure with the error message. */
export type AnalysisAnalyzeFn = (video: Video) => Promise<void>;

export interface AnalysisRunner {
  /** True while a job is in flight (used by the route for the 409). */
  isRunning(): boolean;
  /** Atomically claim the single-flight slot AND mark the video running.
   * Returns false with no side effects when the slot is taken or the video
   * no longer exists. A failing state UPDATE propagates WITHOUT wedging the
   * slot (fix L1: running is released before rethrowing). */
  claim(videoId: number): boolean;
  /** Fire the job asynchronously; resolves the analysis lifecycle itself. */
  start(video: Video): void;
}

/** Fix M2: a hung yt-dlp/Gemini call must not leave analysis_state='running'
 * forever (button hidden, 409 on retry, polling forever). Generous — a
 * 56-minute video analyzes in minutes — and overridable for tests. */
export const DEFAULT_ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000;

/** Production analyzer: mirrors the `video:analyze` CLI wiring (env key,
 * yt-dlp, the 95-row symptom vocabulary from THIS database). */
export function createDefaultAnalysisAnalyze(db: Db): AnalysisAnalyzeFn {
  return async (video) => {
    const gemini = createGeminiClient();
    if (!gemini.isConfigured()) {
      throw new Error("Falta la variable de entorno GEMINI_API_KEY en el servidor.");
    }
    const ytdlp = createYtdlpClient();
    const vocabulary = db
      .select()
      .from(assessmentSymptoms)
      .all()
      .map((r) => ({ id: r.id, name_es: r.nameEs }));
    await analyzeVideo({ url: video.url, db, gemini, ytdlp, vocabulary });
  };
}

export function createAnalysisRunner(
  db: Db,
  analyze?: AnalysisAnalyzeFn,
  opts?: { timeoutMs?: number },
): AnalysisRunner {
  const svc = createVideoService(db);
  const runAnalyze = analyze ?? createDefaultAnalysisAnalyze(db);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_ANALYSIS_TIMEOUT_MS;
  let running = false;

  return {
    isRunning: () => running,

    claim(videoId: number): boolean {
      if (running) return false;
      running = true;
      try {
        if (!svc.markAnalysisRunning(videoId)) {
          // Video disappeared between lookup and claim: release the slot.
          running = false;
          return false;
        }
        return true;
      } catch (err) {
        // Fix L1: a failing UPDATE must surface as a 5xx, not be disguised as
        // a 409 — and above all must NOT leave the slot taken forever.
        running = false;
        throw err;
      }
    },

    start(video: Video): void {
      void (async () => {
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          const analysis = runAnalyze(video);
          const timeout = new Promise<never>((_, reject) => {
            deadline = setTimeout(() => {
              const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
              reject(
                new Error(
                  `El análisis superó el tiempo límite (${minutes} min) y fue cancelado.`,
                ),
              );
            }, timeoutMs);
          });
          await Promise.race([analysis, timeout]);
          // clearAnalysisState failing falls through to catch → failAnalysis,
          // so the row can never stay 'running' with the slot released.
          svc.clearAnalysisState(video.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          try {
            svc.failAnalysis(video.id, message);
          } catch (stateErr) {
            // Fix L2: a double state-update failure must never escape as an
            // unhandledRejection (Node 22 would crash the process).
            console.error("[analysis] failAnalysis could not record the failure:", stateErr);
          }
        } finally {
          if (deadline !== undefined) clearTimeout(deadline);
          running = false;
        }
      })().catch((err) => {
        // Last-resort net (anything the IIFE itself could still throw).
        console.error("[analysis] runner job failed outside its guards:", err);
        running = false;
      });
    },
  };
}
