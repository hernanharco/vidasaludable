import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createDatabase } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/index.js";
import { createVideoService } from "../src/services/videoService.js";
import type { Db } from "../src/db/client.js";
import type { Video } from "../src/db/schema.js";
import type { Hono } from "hono";

/**
 * admin-video-analyze S1/S2/S3 (odd/tasks/admin-video-analyze.md):
 * POST /admin/videos/:id/analyze fires the pipeline in the background — the
 * request returns 202 immediately (never waits minutes), a single-flight guard
 * answers 409 while another analysis runs, failures land in analysis_error
 * without touching status or segments, and Re-analizar (analyzed videos) goes
 * through the same endpoint.
 *
 * The analyzer itself is injected (network/subprocess-free), so these tests
 * exercise the REAL route + runner: claim, state transitions, error mapping.
 */

type Pending = { resolve: () => void; reject: (e: Error) => void };

describe("POST /admin/videos/:id/analyze (T2)", () => {
  let db: Db;
  let app: Hono;
  let prevNodeEnv: string | undefined;

  let calls: Video[] = [];
  let pending: Pending | null = null;

  /** Analyzer fake: captures the video and parks until the test settles it. */
  const analysisAnalyze = (video: Video): Promise<void> => {
    calls.push(video);
    return new Promise<void>((resolve, reject) => {
      pending = { resolve, reject };
    });
  };

  const send = (method: string, path: string) => app.request(path, { method });

  const svc = () => createVideoService(db);

  const makeVideo = (youtubeId: string, status: "draft" | "analyzed" = "draft"): Video =>
    svc().createVideo({
      speaker: "Luis Collantes",
      youtubeId,
      url: `https://www.youtube.com/watch?v=${youtubeId}`,
      title: "t",
      status,
    });

  const stateOf = (id: number) => {
    const row = svc().getVideo(id);
    return { state: row?.analysisState, error: row?.analysisError, status: row?.status };
  };

  beforeAll(async () => {
    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development"; // admin router open (dev mode)
    db = createDatabase(":memory:");
    await migrate(db);
    app = buildApp(db, { analysisAnalyze });
  });

  afterAll(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  beforeEach(() => {
    calls = [];
    pending = null;
  });

  it("returns 202, marks running, runs the analyzer and clears the state on success", async () => {
    const video = makeVideo("anEp001");

    const res = await send("POST", `/admin/videos/${video.id}/analyze`);
    expect(res.status).toBe(202);
    const data = (await res.json()) as { video: { analysisState: string | null } };
    expect(data.video.analysisState).toBe("running"); // S1: CRM starts polling

    // The analyzer received the video (S1: fired in background, not awaited
    // by the request — the 202 already returned above).
    await vi.waitFor(() => expect(calls.map((v) => v.id)).toEqual([video.id]));

    pending!.resolve();
    await vi.waitFor(() => expect(stateOf(video.id).state).toBeNull());
    expect(stateOf(video.id).error).toBeNull();
    expect(stateOf(video.id).status).toBe("draft"); // fake analyzer: no status change
    pending = null;
  });

  it("records a failure in analysis_error without touching status or existing segments", async () => {
    const video = makeVideo("anEp002");
    const seg = svc().createSegment({ videoId: video.id, startS: 0, endS: 10, title: "pre" });

    const res = await send("POST", `/admin/videos/${video.id}/analyze`);
    expect(res.status).toBe(202);

    pending!.reject(new Error("Gemini falló al analizar la transcripción: cuota excedida"));
    await vi.waitFor(() =>
      expect(stateOf(video.id).error).toContain("cuota excedida"),
    );

    const after = stateOf(video.id);
    expect(after.state).toBeNull(); // S3: failure clears running, keeps message
    expect(after.status).toBe("draft"); // S3: status never changes on failure
    // S3: existing segments survive a failed analysis untouched.
    expect(svc().listSegments().filter((s) => s.videoId === video.id)).toHaveLength(1);
    expect(svc().listSegments()[0].id).toBe(seg.id);
    pending = null;
  });

  it("single-flight: 409 while another analysis runs, 202 again once it finishes", async () => {
    const first = makeVideo("anEp003");
    const second = makeVideo("anEp004");

    expect((await send("POST", `/admin/videos/${first.id}/analyze`)).status).toBe(202);

    const clash = await send("POST", `/admin/videos/${second.id}/analyze`);
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: string }).error).toBe("analysis already running");
    // The rejected video must NOT have been marked running (no side effects).
    expect(stateOf(second.id).state).toBeNull();

    pending!.resolve();
    await vi.waitFor(() => expect(stateOf(first.id).state).toBeNull());
    pending = null;

    // Slot released → the second video can start now (S1: retry allowed).
    expect((await send("POST", `/admin/videos/${second.id}/analyze`)).status).toBe(202);
    await vi.waitFor(() => expect(calls.map((v) => v.id)).toContain(second.id));
    pending!.resolve();
    await vi.waitFor(() => expect(stateOf(second.id).state).toBeNull());
    pending = null;
  });

  it("allows re-analysis of an analyzed video (S2: Re-analizar shares the endpoint)", async () => {
    const video = makeVideo("anEp005", "analyzed");
    const res = await send("POST", `/admin/videos/${video.id}/analyze`);
    expect(res.status).toBe(202);
    expect(stateOf(video.id).state).toBe("running");
    expect(stateOf(video.id).status).toBe("analyzed"); // status untouched while running
    pending!.resolve();
    await vi.waitFor(() => expect(stateOf(video.id).state).toBeNull());
    pending = null;
  });

  it("answers 404 for an absent video and 400 for a non-integer id", async () => {
    expect((await send("POST", "/admin/videos/999999/analyze")).status).toBe(404);
    expect((await send("POST", "/admin/videos/abc/analyze")).status).toBe(400);
    expect(calls).toHaveLength(0); // neither reached the analyzer
  });
});
