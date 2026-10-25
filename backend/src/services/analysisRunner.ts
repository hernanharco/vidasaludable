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
   * no longer exists. */
  claim(videoId: number): boolean;
  /** Fire the job asynchronously; resolves the analysis lifecycle itself. */
  start(video: Video): void;
}

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

export function createAnalysisRunner(db: Db, analyze?: AnalysisAnalyzeFn): AnalysisRunner {
  const svc = createVideoService(db);
  const runAnalyze = analyze ?? createDefaultAnalysisAnalyze(db);
  let running = false;

  return {
    isRunning: () => running,

    claim(videoId: number): boolean {
      if (running) return false;
      running = true;
      if (!svc.markAnalysisRunning(videoId)) {
        // Video disappeared between lookup and claim: release the slot.
        running = false;
        return false;
      }
      return true;
    },

    start(video: Video): void {
      void (async () => {
        try {
          await runAnalyze(video);
          svc.clearAnalysisState(video.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          svc.failAnalysis(video.id, message);
        } finally {
          running = false;
        }
      })();
    },
  };
}
