import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDatabase } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { createAnalysisRunner } from "../src/services/analysisRunner.js";
import { createVideoService } from "../src/services/videoService.js";
import type { Db } from "../src/db/client.js";
import type { Video } from "../src/db/schema.js";

/**
 * admin-video-analyze fix round 1 (verify findings):
 * - M2: a hung yt-dlp/Gemini call used to leave analysis_state='running'
 *   forever (button hidden, 409 on retry, polling forever). The runner now
 *   races the analyzer against a deadline, records the timeout as a normal
 *   failure (S3: status untouched) and frees the single-flight slot.
 * - L1: if the state UPDATE itself throws, claim() must propagate the error
 *   WITHOUT wedging the slot (running was set before the update).
 */
describe("analysis runner hardening (fix round 1)", () => {
  let db: Db;
  let video: Video;
  let svc: ReturnType<typeof createVideoService>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await migrate(db);
    svc = createVideoService(db);
    video = svc.createVideo({ speaker: "Luis", youtubeId: "run-fix1", url: "u", title: "t" });
  });

  it("M2: fails a hung analyzer at the deadline and frees the single-flight slot", async () => {
    const runner = createAnalysisRunner(db, () => new Promise<never>(() => {}), {
      timeoutMs: 60,
    });
    expect(runner.claim(video.id)).toBe(true);
    runner.start(video);

    await vi.waitFor(() => expect(svc.getVideo(video.id)!.analysisState).toBeNull());
    const row = svc.getVideo(video.id)!;
    expect(row.analysisError).toMatch(/tiempo/i); // Spanish deadline message
    expect(row.status).toBe("draft"); // S3: a timeout never changes status
    expect(runner.claim(video.id)).toBe(true); // slot released → retry allowed
  });

  it("L1: a failing state UPDATE propagates but does not wedge the slot", () => {
    const runner = createAnalysisRunner(db, async () => {});
    db.$client.exec("ALTER TABLE videos RENAME TO videos_bak");
    expect(() => runner.claim(video.id)).toThrow(); // not swallowed as a 409
    db.$client.exec("ALTER TABLE videos_bak RENAME TO videos");
    expect(runner.claim(video.id)).toBe(true); // slot released, not stuck
  });
});
