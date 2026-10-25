import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { createVideoService } from "../src/services/videoService.js";
import type { Db } from "../src/db/client.js";

/**
 * admin-video-analyze S1/S3 (odd/tasks/admin-video-analyze.md): the CRM
 * triggers the server-side pipeline, so `videos` needs an analysis lifecycle
 * OUTSIDE the published `status` enum:
 * - analysis_state: 'running' | NULL (single-flight flag + UI polling)
 * - analysis_error: last failure message (NULL while healthy)
 * Boot recovery must clear orphaned 'running' rows left by a restart, and the
 * failure path must never touch `status` or existing segments (S3).
 */

function columnsOf(db: Db, table: string): string[] {
  return db.$client.pragma(`table_info(${table})`) as unknown as Array<{
    name: string;
  }>;
}

describe("video analysis state (T1)", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await migrate(db);
  });

  it("creates analysis_state and analysis_error on a fresh migration", () => {
    const cols = columnsOf(db, "videos").map((c) => c.name);
    expect(cols).toContain("analysis_state");
    expect(cols).toContain("analysis_error");
  });

  it("adds the columns to a legacy DB that predates them (ALTER path) and is idempotent", async () => {
    // Simulate a pre-feature database: drop the columns, then re-run migrate.
    db.$client.exec("ALTER TABLE videos DROP COLUMN analysis_state");
    db.$client.exec("ALTER TABLE videos DROP COLUMN analysis_error");
    await migrate(db); // must restore them via the try/catch ALTER list
    await migrate(db); // second run: columns exist → ALTER fails → ignored
    const cols = columnsOf(db, "videos").map((c) => c.name);
    expect(cols).toContain("analysis_state");
    expect(cols).toContain("analysis_error");
  });

  it("markAnalysisRunning sets running, clears any previous error, false when absent", () => {
    const svc = createVideoService(db);
    const video = svc.createVideo({
      speaker: "Luis Collantes",
      youtubeId: "anaSt001",
      url: "u",
      title: "t",
    });

    expect(svc.markAnalysisRunning(video.id)).toBe(true);
    let row = svc.getVideo(video.id)!;
    expect(row.analysisState).toBe("running");
    expect(row.analysisError).toBeNull();

    // A retry after a failure clears the stale error message.
    db.$client
      .prepare("UPDATE videos SET analysis_error = 'fallo viejo' WHERE id = ?")
      .run(video.id);
    svc.markAnalysisRunning(video.id);
    row = svc.getVideo(video.id)!;
    expect(row.analysisState).toBe("running");
    expect(row.analysisError).toBeNull();

    expect(svc.markAnalysisRunning(999999)).toBe(false);
  });

  it("failAnalysis records the message and clears the running flag, without touching status", () => {
    const svc = createVideoService(db);
    const video = svc.createVideo({
      speaker: "Luis Collantes",
      youtubeId: "anaSt002",
      url: "u",
      title: "t",
    });
    svc.markAnalysisRunning(video.id);
    svc.failAnalysis(video.id, "No se encontró transcripción");

    const row = svc.getVideo(video.id)!;
    expect(row.analysisState).toBeNull();
    expect(row.analysisError).toBe("No se encontró transcripción");
    expect(row.status).toBe("draft"); // S3: failure never changes status
    expect(svc.failAnalysis(999999, "x")).toBe(false);
  });

  it("clearAnalysisState succeeds the lifecycle (healthy after analyzed)", () => {
    const svc = createVideoService(db);
    const video = svc.createVideo({
      speaker: "Luis Collantes",
      youtubeId: "anaSt003",
      url: "u",
      title: "t",
    });
    svc.markAnalysisRunning(video.id);
    db.$client
      .prepare("UPDATE videos SET analysis_error = 'x' WHERE id = ?")
      .run(video.id);
    svc.clearAnalysisState(video.id);

    const row = svc.getVideo(video.id)!;
    expect(row.analysisState).toBeNull();
    expect(row.analysisError).toBeNull();
    expect(svc.clearAnalysisState(999999)).toBe(false);
  });

  it("recoverInterruptedAnalyses only resets orphaned running rows (boot recovery)", () => {
    const svc = createVideoService(db);
    const running = svc.createVideo({
      speaker: "Luis Collantes",
      youtubeId: "anaSt004",
      url: "u",
      title: "en curso",
    });
    const analyzed = svc.createVideo({
      speaker: "Luis Collantes",
      youtubeId: "anaSt005",
      url: "u",
      title: "ya analizado",
    });
    svc.markAnalysisRunning(running.id);
    svc.markAnalysisRunning(analyzed.id);
    // Second one finished before the hypothetical restart:
    svc.clearAnalysisState(analyzed.id);

    const recovered = svc.recoverInterruptedAnalyses();
    expect(recovered).toBe(1);

    const stuck = svc.getVideo(running.id)!;
    expect(stuck.analysisState).toBeNull();
    expect(stuck.analysisError).toBe("Análisis interrumpido por reinicio");
    expect(stuck.status).toBe("draft");

    const healthy = svc.getVideo(analyzed.id)!;
    expect(healthy.analysisError).toBeNull(); // untouched
  });
});
