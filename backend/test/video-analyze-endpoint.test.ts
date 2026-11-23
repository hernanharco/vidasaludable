import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAnalysisPreflight } from "../src/services/analysisPreflight.js";
import type { CommandRunner } from "../src/tools/media.js";
import type { GeminiClient } from "../src/agent/gemini.js";
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

/** Real copy of YouTube's "Transcripción" panel (the contract sample): what
 * the operator literally pastes from the YouTube UI. */
const panelSample = [
  "Transcripción",
  "Buscar en transcripción",
  "0:11",
  "11 segundos",
  "[música]",
  "0:18",
  "18 segundos",
  "Hola, hola amigos de América Latina.",
  "1:00:08",
  "1 hora y 8 segundos",
  "y un corrector que sea lo más similar a mi tono de piel",
].join("\n");

describe("POST /admin/videos/:id/analyze (T2)", () => {
  let db: Db;
  let app: Hono;
  let prevNodeEnv: string | undefined;

  let calls: Video[] = [];
  let transcripts: unknown[] = [];
  let pending: Pending | null = null;

  /** yt-dlp fake for the preflight: present (no subprocess, no network). */
  const ytdlpOk: CommandRunner = async () => ({ code: 0, stdout: "2026.10.1", stderr: "" });

  /** Gemini fake: the preflight must never read the ambient env in tests — a
   * real key on the developer machine (or its absence in CI) must not decide
   * which branch is exercised. */
  const geminiWithKey = { isConfigured: () => true, generate: async () => "" } as unknown as GeminiClient;
  const geminiWithoutKey = { isConfigured: () => false, generate: async () => "" } as unknown as GeminiClient;

  /** Analyzer fake: captures the video + injected transcript, parks until settled. */
  const analysisAnalyze = (video: Video, transcript?: unknown): Promise<void> => {
    calls.push(video);
    transcripts.push(transcript);
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

  /** Safety net for the transcriptText tests: if an assertion fails while
   * the analyzer is parked, release the slot so the failure cannot cascade
   * into the single-flight state of the following tests. */
  const releaseParked = async (videoId: number) => {
    if (pending) {
      pending.resolve();
      pending = null;
      await vi.waitFor(() => expect(stateOf(videoId).state).toBeNull());
    }
  };

  beforeAll(async () => {
    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development"; // admin router open (dev mode)
    db = createDatabase(":memory:");
    await migrate(db);
    // REAL preflight composition with only the yt-dlp subprocess and the Gemini
    // client faked, so the cookie and Gemini checks under test are the
    // production ones and stay independent of ambient env.
    app = buildApp(db, {
      analysisAnalyze,
      analysisPreflight: createAnalysisPreflight({
        ytdlpRunner: ytdlpOk,
        geminiClient: geminiWithKey,
      }),
    });
  });

  afterAll(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  beforeEach(() => {
    calls = [];
    transcripts = [];
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

  it("acepta una transcripción json3 pre-adquirida y la entrega al analizador", async () => {
    const video = makeVideo("anEpJson3");
    const transcript = {
      events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "hola" }] }],
    };

    const res = await app.request(`/admin/videos/${video.id}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript }),
    });
    expect(res.status).toBe(202);

    await vi.waitFor(() => expect(transcripts).toHaveLength(1));
    expect(transcripts[0]).toEqual(transcript);

    pending!.resolve();
    await vi.waitFor(() => expect(stateOf(video.id).state).toBeNull());
    pending = null;
  });

  it("rechaza con 400 una transcripción que no es json3 y no arranca el análisis", async () => {
    const video = makeVideo("anEpBadTranscript");

    const res = await app.request(`/admin/videos/${video.id}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: "solo texto plano" }),
    });
    expect(res.status).toBe(400);
    // Sin claim: no se tomó el slot ni se marcó running.
    expect(calls).toHaveLength(0);
    expect(stateOf(video.id).state).toBeNull();
  });

  it("acepta transcriptText (panel de YouTube) → 202 y el analizador recibe json3 correcto", async () => {
    const video = makeVideo("anEpPanel");
    try {
      const res = await app.request(`/admin/videos/${video.id}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcriptText: panelSample }),
      });
      expect(res.status).toBe(202);

      // El analizador recibe un objeto json3 con los cues convertidos desde
      // el texto del panel (mismos tiempos y textos que el parser puro).
      await vi.waitFor(() => expect(transcripts).toHaveLength(1));
      expect(transcripts[0]).toEqual({
        events: [
          { tStartMs: 11000, dDurationMs: 11000, segs: [{ utf8: "[música]" }] },
          {
            tStartMs: 18000,
            dDurationMs: 18000,
            segs: [{ utf8: "Hola, hola amigos de América Latina." }],
          },
          {
            tStartMs: 3608000,
            dDurationMs: 3608000,
            segs: [{ utf8: "y un corrector que sea lo más similar a mi tono de piel" }],
          },
        ],
      });
    } finally {
      await releaseParked(video.id);
    }
  });

  it("rechaza con 400 un transcriptText inválido y nunca reclama el slot", async () => {
    const video = makeVideo("anEpBadPanel");
    try {
      // No-string: se rechaza antes de parsear.
      const notString = await app.request(`/admin/videos/${video.id}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcriptText: 42 }),
      });
      expect(notString.status).toBe(400);
      expect(((await notString.json()) as { error: string }).error).toMatch(/transcriptText/);

      // String sin ningún cue: el parser lanza y el route devuelve su mensaje.
      const noCues = await app.request(`/admin/videos/${video.id}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcriptText: "Transcripción\nBuscar en transcripción" }),
      });
      expect(noCues.status).toBe(400);
      expect(((await noCues.json()) as { error: string }).error).toMatch(/cue/);

      // Sin claim en ninguno de los dos intentos: slot libre, nada running.
      expect(calls).toHaveLength(0);
      expect(stateOf(video.id).state).toBeNull();
    } finally {
      await releaseParked(video.id);
    }
  });

  it("rechaza con 400 cuando llegan transcript y transcriptText a la vez", async () => {
    const video = makeVideo("anEpBothInputs");
    try {
      const res = await app.request(`/admin/videos/${video.id}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: { events: [] }, transcriptText: panelSample }),
      });
      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
      expect(stateOf(video.id).state).toBeNull();
    } finally {
      await releaseParked(video.id);
    }
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

  it("preflight: cookies de YouTube ilegibles → 503 con la causa, sin claim ni análisis", async () => {
    // Prod incident 2026-11-22: a broken cookie master used to answer 202 and
    // then store an identical analysis_error on every admin retry. A
    // configuration problem is answered BEFORE the single-flight slot, so the
    // operator fixes it instead of re-clicking. The injected-transcript
    // escape hatch never touches yt-dlp and must stay 202.
    const video = makeVideo("anEpCookies");
    const missing = "/nonexistent/dir/youtube-cookies.txt";
    vi.stubEnv("YT_COOKIES_PATH", missing);
    try {
      const res = await send("POST", `/admin/videos/${video.id}/analyze`);
      expect(res.status).toBe(503);
      const data = (await res.json()) as { error: string; code: string };
      expect(data.code).toBe("youtube_cookies_unavailable");
      expect(data.error).toContain(`YT_COOKIES_PATH=${missing}`);
      // No side effects: slot never claimed, nothing stored, analyzer untouched.
      expect(calls).toHaveLength(0);
      expect(stateOf(video.id)).toEqual({ state: null, error: null, status: "draft" });

      const withTranscript = await app.request(`/admin/videos/${video.id}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: { events: [] } }),
      });
      expect(withTranscript.status).toBe(202);
      await vi.waitFor(() => expect(calls.map((v) => v.id)).toEqual([video.id]));
      pending!.resolve();
      await vi.waitFor(() => expect(stateOf(video.id).state).toBeNull());
      pending = null;
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("preflight: un DIRECTORIO como maestro de cookies también da 503, no solo la ausencia", async () => {
    // accessSync(R_OK) accepts a readable directory but copyFileSync fails
    // (EISDIR): without the isFile() check the request WAS claimed and
    // reproduced the 202-then-identical-error pattern this preflight exists
    // to prevent.
    const video = makeVideo("anEpCookiesDir");
    const dir = await mkdtemp(join(tmpdir(), "vp-cookiedir-"));
    vi.stubEnv("YT_COOKIES_PATH", dir);
    try {
      const res = await send("POST", `/admin/videos/${video.id}/analyze`);
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: string }).error).toContain(dir);
      expect(calls).toHaveLength(0);
      expect(stateOf(video.id).state).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preflight: sin GEMINI_API_KEY → 503 gemini_not_configured, con o sin transcripción", async () => {
    // Gemini runs in BOTH acquisition modes, so a missing key is a config error
    // in both — and it used to surface as a 202 plus an identical
    // analysis_error on every retry.
    const noKeyApp = buildApp(db, {
      analysisAnalyze,
      analysisPreflight: createAnalysisPreflight({
        ytdlpRunner: ytdlpOk,
        geminiClient: geminiWithoutKey,
      }),
    });
    const video = makeVideo("anEpNoGemini");
    {
      const res = await noKeyApp.request(`/admin/videos/${video.id}/analyze`, { method: "POST" });
      expect(res.status).toBe(503);
      const data = (await res.json()) as { error: string; code: string };
      expect(data.code).toBe("gemini_not_configured");
      expect(data.error).toContain("GEMINI_API_KEY");
      expect(calls).toHaveLength(0);
      expect(stateOf(video.id).state).toBeNull();

      // The escape hatch needs Gemini too — no 202 without a key.
      const withTranscript = await noKeyApp.request(`/admin/videos/${video.id}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: { events: [] } }),
      });
      expect(withTranscript.status).toBe(503);
      expect(((await withTranscript.json()) as { code: string }).code).toBe(
        "gemini_not_configured",
      );
      expect(calls).toHaveLength(0);
    }
  });

  it("preflight: yt-dlp ausente → 503 ytdlp_unavailable solo cuando el servidor adquiere", async () => {
    // The binary is only needed by the server-side acquisition: an injected
    // transcript must still work on a server without yt-dlp.
    const ytdlpMissing: CommandRunner = async () => ({ code: 127, stdout: "", stderr: "not found" });
    const localApp = buildApp(db, {
      analysisAnalyze,
      analysisPreflight: createAnalysisPreflight({
        ytdlpRunner: ytdlpMissing,
        geminiClient: geminiWithKey,
      }),
    });
    const video = makeVideo("anEpNoYtdlp");

    const res = await localApp.request(`/admin/videos/${video.id}/analyze`, { method: "POST" });
    expect(res.status).toBe(503);
    const data = (await res.json()) as { error: string; code: string };
    expect(data.code).toBe("ytdlp_unavailable");
    expect(data.error).toContain("yt-dlp");
    expect(calls).toHaveLength(0);
    expect(stateOf(video.id).state).toBeNull();

    const withTranscript = await localApp.request(`/admin/videos/${video.id}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: { events: [] } }),
    });
    expect(withTranscript.status).toBe(202);
    await vi.waitFor(() => expect(calls.map((v) => v.id)).toEqual([video.id]));
    pending!.resolve();
    await vi.waitFor(() => expect(stateOf(video.id).state).toBeNull());
    pending = null;
  });
});
