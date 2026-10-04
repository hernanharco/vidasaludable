import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { assessmentSymptoms } from "../src/db/assessmentSchema.js";
import { products } from "../src/db/schema.js";
import { buildApp } from "../src/index.js";
import { createVideoService } from "../src/services/videoService.js";
import type { Hono } from "hono";

/**
 * T7 — public `GET /assistant/videos` + admin video/segment CRUD routes.
 *
 * Route level: follows assistant.integration.test.ts / video-agent.test.ts —
 * `buildApp(db)` over in-memory SQLite migrated with the production DDL, and
 * `app.request(...)` against the real Hono instances (no fetch stubbing needed:
 * neither endpoint touches Gemini).
 *
 * Admin guard: NODE_ENV=development (the documented open-access dev mode of
 * createAdminRouter) so no basic-auth headers are required. The assistant
 * router has no auth middleware at all — `/assistant/videos` is public by
 * construction, same surface as `/assistant/consent`.
 *
 * Condition normalization is checked against REAL seed vocabulary rows
 * (accented Spanish), mirroring video-service.test.ts.
 */

/** Real seed vocabulary rows inserted so matchSymptom has candidates + FK targets. */
const ANXIETY = 3; // "Ansiedad o tensión"
const APATIA = 4; // "Apatía"
const BACK_PAIN = 29; // "Dolor de espalda"
const JOINT_PAIN = 30; // "Dolor en las articulaciones, ..."
const seededSymptoms = [
  { id: ANXIETY, nameEs: "Ansiedad o tensión" },
  { id: APATIA, nameEs: "Apatía" },
  { id: BACK_PAIN, nameEs: "Dolor de espalda" },
  { id: JOINT_PAIN, nameEs: "Dolor en las articulaciones, enfermedades inflamatorias (por ejemplo artritis) o rigidez" },
];

describe("video endpoints (T7)", () => {
  let db: Db;
  let app: Hono;
  let prevNodeEnv: string | undefined;

  const get = (path: string) => app.request(path);
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  /** Catalog row so segment product refs can be validated against it (T5).
   * Idempotent: the shared test db seeds several tests with the same refs. */
  const insertCatalogProduct = (reference: string, name: string) => {
    const existing = db.select().from(products).where(eq(products.reference, reference)).get();
    if (existing) return;
    db.insert(products)
      .values({
        reference,
        name,
        category: "Nutrición",
        size: "90 uds",
        price: 29.71,
        benefits: "b",
        dosage: "d",
        ingredients: "i",
        disclaimer: "dis",
      })
      .run();
  };

  beforeAll(async () => {
    // Admin router is open in development (documented dev mode) — no auth.
    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    db = createDatabase(":memory:");
    await migrate(db);
    for (const s of seededSymptoms) {
      db.insert(assessmentSymptoms).values(s).run();
    }
    app = buildApp(db);
  });

  afterAll(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  // ─── GET /assistant/videos (public) ─────────────────────────────────

  describe("GET /assistant/videos", () => {
    it("returns only enabled segments with the exact card shape and fallback URL", async () => {
      const svc = createVideoService(db);
      const video = svc.createVideo({
        speaker: "Luis Collantes",
        youtubeId: "yt-public-1",
        url: "https://www.youtube.com/watch?v=yt-public-1",
        title: "Salud natural",
      });
      const disabled = svc.createSegment({
        videoId: video.id,
        condition: "Apatía",
        symptomId: APATIA,
        startS: 5,
        endS: 40,
        title: "Sin aprobar",
        summary: "No debe salir al público.",
        enabled: 0,
      });
      const enabled = svc.createSegment({
        videoId: video.id,
        condition: "Dolor de espalda",
        symptomId: BACK_PAIN,
        startS: 123,
        endS: 180,
        title: "Ejercicios para la espalda",
        summary: "Movilidad suave.",
        enabled: 1,
      });

      const res = await get("/assistant/videos");
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        videos: Array<{
          id: number;
          title: string;
          condition: string | null;
          summary: string;
          url: string;
          speaker: string;
          startS: number;
          endS: number;
          productReferences: string[];
        }>;
      };

      // Disabled segment excluded; enabled one present with the EXACT shape.
      expect(data.videos).toHaveLength(1);
      expect(data.videos[0]).toEqual({
        id: enabled.id,
        title: "Ejercicios para la espalda",
        condition: "Dolor de espalda",
        summary: "Movilidad suave.",
        // Fallback URL rule: original id + integer seconds, no `s` suffix.
        url: "https://www.youtube.com/watch?v=yt-public-1&t=123",
        speaker: "Luis Collantes",
        // T4 Phase A: RAW integer seconds (frontend formats to mm:ss;
        // the &t= deep-link contract keeps seconds on the wire).
        startS: 123,
        endS: 180,
        // T5: valid catalog refs linked to the segment, parsed ([] when none).
        productReferences: [],
      });
      expect(data.videos.map((v) => v.id)).not.toContain(disabled.id);
    });

    it("includes productReferences (parsed array) per card for the frontend product cards", async () => {
      const svc = createVideoService(db);
      const video = svc.createVideo({
        speaker: "Luis Collantes",
        youtubeId: "yt-public-products",
        url: "https://www.youtube.com/watch?v=yt-public-products",
        title: "Con productos",
      });
      svc.createSegment({
        videoId: video.id,
        startS: 0,
        endS: 60,
        title: "Espalda con productos",
        summary: "El educador menciona productos.",
        enabled: 1,
        mentionedProducts: ["Cal Mag D Plus", "Double X"],
        productReferences: ["110606", "121576"],
      });

      const res = await get("/assistant/videos");
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        videos: Array<{ id: number; title: string; productReferences: string[] }>;
      };
      const card = data.videos.find((v) => v.title === "Espalda con productos");
      expect(card).toBeDefined();
      expect(card!.productReferences).toEqual(["110606", "121576"]);
    });

    it("uses the clip URL (no t param) when clipYoutubeId is present", async () => {
      const svc = createVideoService(db);
      const video = svc.createVideo({
        speaker: "Luis Collantes",
        youtubeId: "yt-public-2",
        url: "https://www.youtube.com/watch?v=yt-public-2",
        title: "Clip aprobado",
      });
      const seg = svc.createSegment({
        videoId: video.id,
        startS: 60,
        endS: 120,
        title: "Con clip",
        summary: "Clip en el canal del titular.",
        clipYoutubeId: "CLIP-99",
        enabled: 1,
      });

      const res = await get("/assistant/videos");
      expect(res.status).toBe(200);
      const data = (await res.json()) as { videos: Array<{ id: number; url: string }> };
      const card = data.videos.find((v) => v.id === seg.id);
      expect(card).toBeDefined();
      expect(card?.url).toBe("https://www.youtube.com/watch?v=CLIP-99");
      expect(card?.url).not.toContain("&t=");
    });

    it("renders startS=0 as &t=0 in the fallback URL", async () => {
      const svc = createVideoService(db);
      const video = svc.createVideo({
        speaker: "Luis Collantes",
        youtubeId: "yt-public-3",
        url: "https://www.youtube.com/watch?v=yt-public-3",
        title: "Desde el inicio",
      });
      const seg = svc.createSegment({
        videoId: video.id,
        startS: 0,
        endS: 30,
        title: "Intro",
        summary: "Empieza al segundo cero.",
        enabled: 1,
      });

      const res = await get("/assistant/videos");
      const data = (await res.json()) as { videos: Array<{ id: number; url: string }> };
      const card = data.videos.find((v) => v.id === seg.id);
      expect(card?.url).toBe("https://www.youtube.com/watch?v=yt-public-3&t=0");
    });
  });

  // ─── Admin videos CRUD ──────────────────────────────────────────────

  describe("admin videos CRUD", () => {
    it("creates a video deriving youtubeId from the url (201, draft default)", async () => {
      const res = await send("POST", "/admin/videos", {
        speaker: "Luis Collantes",
        url: "https://www.youtube.com/watch?v=vidCRUD01",
        title: "Vitaminas y energía",
        durationS: 600,
      });
      expect(res.status).toBe(201);
      const data = (await res.json()) as { video: Record<string, unknown> };
      expect(data.video.youtubeId).toBe("vidCRUD01"); // derived via parseVideoId
      expect(data.video.speaker).toBe("Luis Collantes");
      expect(data.video.title).toBe("Vitaminas y energía");
      expect(data.video.status).toBe("draft");
      expect(data.video.durationS).toBe(600);
    });

    it("rejects an invalid url with 400", async () => {
      const res = await send("POST", "/admin/videos", {
        speaker: "Luis Collantes",
        url: "https://example.com/not-a-video",
        title: "Raro",
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("invalid url");
    });

    it("rejects a duplicate youtubeId with 409", async () => {
      const first = await send("POST", "/admin/videos", {
        speaker: "Luis Collantes",
        url: "https://www.youtube.com/watch?v=vidDUP01",
        title: "Primero",
      });
      expect(first.status).toBe(201);
      const res = await send("POST", "/admin/videos", {
        speaker: "Luis Collantes",
        url: "https://youtu.be/vidDUP01", // same id, different URL form
        title: "Segundo",
      });
      expect(res.status).toBe(409);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("youtubeId already exists");
    });

    it("rejects missing fields, bad status and bad durationS with 400", async () => {
      const noTitle = await send("POST", "/admin/videos", {
        speaker: "Luis Collantes",
        url: "https://www.youtube.com/watch?v=vidVAL01",
      });
      expect(noTitle.status).toBe(400);
      expect(((await noTitle.json()) as { error: string }).error).toBe("missing field: title");

      const badStatus = await send("POST", "/admin/videos", {
        speaker: "Luis Collantes",
        url: "https://www.youtube.com/watch?v=vidVAL02",
        title: "t",
        status: "live",
      });
      expect(badStatus.status).toBe(400);

      const badDuration = await send("POST", "/admin/videos", {
        speaker: "Luis Collantes",
        url: "https://www.youtube.com/watch?v=vidVAL03",
        title: "t",
        durationS: -5,
      });
      expect(badDuration.status).toBe(400);
    });

    it("lists all videos (GET /admin/videos)", async () => {
      const created = await send("POST", "/admin/videos", {
        speaker: "Otro Speaker",
        url: "https://www.youtube.com/watch?v=vidLIST01",
        title: "Listable",
      });
      const { video } = (await created.json()) as { video: { id: number } };

      const res = await get("/admin/videos");
      expect(res.status).toBe(200);
      const data = (await res.json()) as { videos: Array<{ id: number }> };
      expect(data.videos.map((v) => v.id)).toContain(video.id);
    });

    it("patches title/speaker/status/durationS/licenseNote (partial update)", async () => {
      const created = await send("POST", "/admin/videos", {
        speaker: "Luis Collantes",
        url: "https://www.youtube.com/watch?v=vidPATCH01",
        title: "Original",
      });
      const { video } = (await created.json()) as { video: { id: number; youtubeId: string } };

      const res = await send("PATCH", `/admin/videos/${video.id}`, {
        title: "Analizado",
        status: "analyzed",
        durationS: 300,
        licenseNote: "Permiso escrito del titular",
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { video: Record<string, unknown> };
      expect(data.video.title).toBe("Analizado");
      expect(data.video.status).toBe("analyzed");
      expect(data.video.durationS).toBe(300);
      expect(data.video.licenseNote).toBe("Permiso escrito del titular");
      expect(data.video.youtubeId).toBe(video.youtubeId); // untouched field survives
    });

    it("returns 400 for nothing-to-update and 404 for an absent id", async () => {
      const nothing = await send("PATCH", "/admin/videos/99999", {});
      // Empty body object parses fine but carries no patchable field.
      expect(nothing.status).toBe(400);
      expect(((await nothing.json()) as { error: string }).error).toBe("nothing to update");

      const absent = await send("PATCH", "/admin/videos/99999", { title: "x" });
      expect(absent.status).toBe(404);
      expect(((await absent.json()) as { error: string }).error).toBe("video not found");
    });
  });

  // ─── Admin video-segments CRUD ──────────────────────────────────────

  describe("admin video-segments CRUD", () => {
    const makeVideo = async (youtubeId: string, title = "Video base") => {
      const res = await send("POST", "/admin/videos", {
        speaker: "Luis Collantes",
        url: `https://www.youtube.com/watch?v=${youtubeId}`,
        title,
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { video: { id: number } }).video.id;
    };

    it("creates a segment with symptomId → condition text derived from name_es", async () => {
      const videoId = await makeVideo("segSym01");
      const res = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 10,
        endS: 70,
        title: "Espalda",
        summary: "Rutina.",
        symptomId: BACK_PAIN,
      });
      expect(res.status).toBe(201);
      const data = (await res.json()) as {
        segment: { condition: string | null; symptomId: number | null; enabled: number };
      };
      expect(data.segment.condition).toBe("Dolor de espalda"); // the symptom's name_es
      expect(data.segment.symptomId).toBe(BACK_PAIN);
      expect(data.segment.enabled).toBe(0); // not approved by default
    });

    it("creates a segment with an unmatched condition → condition and symptomId stay null", async () => {
      const videoId = await makeVideo("segUnm01");
      const res = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 0,
        endS: 50,
        title: "Sin coincidencia",
        summary: "s",
        condition: "zzz no existe en el vocabulario",
      });
      expect(res.status).toBe(201);
      const data = (await res.json()) as {
        segment: { condition: string | null; symptomId: number | null };
      };
      expect(data.segment.condition).toBeNull();
      expect(data.segment.symptomId).toBeNull();
    });

    it("creates a segment with a matched condition string → normalized symptomId + name_es", async () => {
      const videoId = await makeVideo("segMat01");
      const res = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 0,
        endS: 50,
        title: "Match por texto",
        summary: "s",
        condition: "dolor de espalda", // unaccented lowercase → exact normalized match
      });
      expect(res.status).toBe(201);
      const data = (await res.json()) as {
        segment: { condition: string | null; symptomId: number | null };
      };
      expect(data.segment.symptomId).toBe(BACK_PAIN);
      expect(data.segment.condition).toBe("Dolor de espalda");
    });

    it("rejects invalid bounds (startS >= endS or negative) with 400", async () => {
      const videoId = await makeVideo("segBnd01");
      const swapped = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 70,
        endS: 70,
        title: "t",
      });
      expect(swapped.status).toBe(400);
      expect(((await swapped.json()) as { error: string }).error).toBe(
        "bounds must satisfy 0 <= startS < endS",
      );

      const negative = await send("POST", "/admin/video-segments", {
        videoId,
        startS: -1,
        endS: 10,
        title: "t",
      });
      expect(negative.status).toBe(400);
    });

    it("rejects unknown videoId (404), unknown symptomId (400) and missing title (400)", async () => {
      const noVideo = await send("POST", "/admin/video-segments", {
        videoId: 99999,
        startS: 0,
        endS: 10,
        title: "t",
      });
      expect(noVideo.status).toBe(404);
      expect(((await noVideo.json()) as { error: string }).error).toBe("video not found");

      const videoId = await makeVideo("segErr01");
      const noSymptom = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 0,
        endS: 10,
        title: "t",
        symptomId: 99999,
      });
      expect(noSymptom.status).toBe(400);
      expect(((await noSymptom.json()) as { error: string }).error).toBe("symptom not found");

      const noTitle = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 0,
        endS: 10,
      });
      expect(noTitle.status).toBe(400);
    });

    it("lists all segments including disabled, and filters by ?video_id=", async () => {
      const svc = createVideoService(db);
      const videoA = svc.createVideo({
        speaker: "Luis Collantes",
        youtubeId: "segListA",
        url: "u",
        title: "A",
      });
      const videoB = svc.createVideo({
        speaker: "Luis Collantes",
        youtubeId: "segListB",
        url: "u",
        title: "B",
      });
      const segA = svc.createSegment({
        videoId: videoA.id,
        startS: 0,
        endS: 10,
        title: "A off",
        enabled: 0,
      });
      const segB = svc.createSegment({
        videoId: videoB.id,
        startS: 0,
        endS: 10,
        title: "B on",
        enabled: 1,
      });

      const all = await get("/admin/video-segments");
      expect(all.status).toBe(200);
      const allData = (await all.json()) as { segments: Array<{ id: number; enabled: number }> };
      expect(allData.segments.map((s) => s.id)).toEqual(
        expect.arrayContaining([segA.id, segB.id]),
      );
      expect(allData.segments.find((s) => s.id === segA.id)?.enabled).toBe(0); // disabled included

      const filtered = await get(`/admin/video-segments?video_id=${videoA.id}`);
      const filteredData = (await filtered.json()) as { segments: Array<{ id: number }> };
      expect(filteredData.segments.map((s) => s.id)).toEqual([segA.id]);

      const unknownFilter = await get("/admin/video-segments?video_id=99999");
      expect(unknownFilter.status).toBe(200);
      expect(((await unknownFilter.json()) as { segments: unknown[] }).segments).toEqual([]);

      const badFilter = await get("/admin/video-segments?video_id=abc");
      expect(badFilter.status).toBe(400);
    });

    it("PATCH enabled 0→1 approves the segment (appears in GET /assistant/videos)", async () => {
      const videoId = await makeVideo("segAppr01");
      const created = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 5,
        endS: 45,
        title: "Por aprobar",
        summary: "s",
        symptomId: ANXIETY,
      });
      const { segment } = (await created.json()) as { segment: { id: number; enabled: number } };
      expect(segment.enabled).toBe(0);

      const res = await send("PATCH", `/admin/video-segments/${segment.id}`, { enabled: 1 });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { segment: { enabled: number } };
      expect(data.segment.enabled).toBe(1);

      // Approval flips public visibility.
      const publicRes = await get("/assistant/videos");
      const publicData = (await publicRes.json()) as { videos: Array<{ id: number }> };
      expect(publicData.videos.map((v) => v.id)).toContain(segment.id);

      // And back off.
      const off = await send("PATCH", `/admin/video-segments/${segment.id}`, { enabled: 0 });
      expect(((await off.json()) as { segment: { enabled: number } }).segment.enabled).toBe(0);

      const badEnabled = await send("PATCH", `/admin/video-segments/${segment.id}`, { enabled: 2 });
      expect(badEnabled.status).toBe(400);
    });

    it("PATCH bounds/title/summary with effective-bounds validation", async () => {
      const videoId = await makeVideo("segBnd02");
      const created = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 10,
        endS: 70,
        title: "Original",
        summary: "s",
      });
      const { segment } = (await created.json()) as { segment: { id: number } };

      // startS beyond the EXISTING endS must fail even though endS is untouched.
      const bad = await send("PATCH", `/admin/video-segments/${segment.id}`, { startS: 90 });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { error: string }).error).toBe(
        "bounds must satisfy 0 <= startS < endS",
      );

      const ok = await send("PATCH", `/admin/video-segments/${segment.id}`, {
        startS: 20,
        endS: 90,
        title: "Nuevo título",
        summary: "nueva",
      });
      expect(ok.status).toBe(200);
      const data = (await ok.json()) as { segment: Record<string, unknown> };
      expect(data.segment.startS).toBe(20);
      expect(data.segment.endS).toBe(90);
      expect(data.segment.title).toBe("Nuevo título");
      expect(data.segment.summary).toBe("nueva");
    });

    it("PATCH condition applies the same normalization rules (match → name_es, unmatched → nulls)", async () => {
      const videoId = await makeVideo("segCon01");
      const created = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 0,
        endS: 30,
        title: "Condición",
      });
      const { segment } = (await created.json()) as { segment: { id: number } };

      // Matched (accent-insensitive): symptomId + accented name_es.
      const matched = await send("PATCH", `/admin/video-segments/${segment.id}`, {
        condition: "ansiedad o tension",
      });
      expect(matched.status).toBe(200);
      const matchedData = (await matched.json()) as {
        segment: { condition: string | null; symptomId: number | null };
      };
      expect(matchedData.segment.symptomId).toBe(ANXIETY);
      expect(matchedData.segment.condition).toBe("Ansiedad o tensión");

      // symptomId given → condition overwritten from that symptom's name_es.
      const byId = await send("PATCH", `/admin/video-segments/${segment.id}`, {
        symptomId: JOINT_PAIN,
      });
      const byIdData = (await byId.json()) as {
        segment: { condition: string | null; symptomId: number | null };
      };
      expect(byIdData.segment.symptomId).toBe(JOINT_PAIN);
      expect(byIdData.segment.condition).toBe(
        "Dolor en las articulaciones, enfermedades inflamatorias (por ejemplo artritis) o rigidez",
      );

      // Unmatched → both fields cleared to null.
      const unmatched = await send("PATCH", `/admin/video-segments/${segment.id}`, {
        condition: "zzz no existe",
      });
      const unmatchedData = (await unmatched.json()) as {
        segment: { condition: string | null; symptomId: number | null };
      };
      expect(unmatchedData.segment.condition).toBeNull();
      expect(unmatchedData.segment.symptomId).toBeNull();
    });

    it("PATCH clipYoutubeId sets and clears the clip id", async () => {
      const videoId = await makeVideo("segClip01");
      const created = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 0,
        endS: 20,
        title: "Con clip",
      });
      const { segment } = (await created.json()) as { segment: { id: number } };

      const set = await send("PATCH", `/admin/video-segments/${segment.id}`, {
        clipYoutubeId: "CLIP-77",
      });
      expect(((await set.json()) as { segment: { clipYoutubeId: string } }).segment.clipYoutubeId).toBe(
        "CLIP-77",
      );

      const cleared = await send("PATCH", `/admin/video-segments/${segment.id}`, {
        clipYoutubeId: null,
      });
      expect(
        ((await cleared.json()) as { segment: { clipYoutubeId: string | null } }).segment
          .clipYoutubeId,
      ).toBeNull();
    });

    it("returns 404 for PATCH/DELETE on an absent segment id", async () => {
      const patch = await send("PATCH", "/admin/video-segments/99999", { title: "x" });
      expect(patch.status).toBe(404);
      expect(((await patch.json()) as { error: string }).error).toBe("segment not found");

      const del = await send("DELETE", "/admin/video-segments/99999");
      expect(del.status).toBe(404);
      expect(((await del.json()) as { error: string }).error).toBe("segment not found");
    });
  });

  // ─── Segment product fields (T5) ──────────────────────────────────────

  describe("segment product fields (T5)", () => {
    const makeVideo = async (youtubeId: string) => {
      const res = await send("POST", "/admin/videos", {
        speaker: "Luis Collantes",
        url: `https://www.youtube.com/watch?v=${youtubeId}`,
        title: "Video productos",
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { video: { id: number } }).video.id;
    };

    it("POST accepta arrays, descarta refs fuera del catálogo y responde con arrays parseados", async () => {
      insertCatalogProduct("110606", "Cal Mag D Plus");
      insertCatalogProduct("121576", "Double X");
      const videoId = await makeVideo("segProd01");
      const res = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 0,
        endS: 60,
        title: "Espalda",
        mentioned_products: ["Cal Mag D Plus", "Double X", "Desconocido"],
        product_references: ["110606", "999999", "121576"], // 999999 no existe → se cae
      });
      expect(res.status).toBe(201);
      const { segment } = (await res.json()) as {
        segment: { mentionedProducts: string[]; productReferences: string[] };
      };
      expect(segment.mentionedProducts).toEqual(["Cal Mag D Plus", "Double X", "Desconocido"]);
      expect(segment.productReferences).toEqual(["110606", "121576"]);
    });

    it("POST acepta JSON strings y devuelve 400 con shape inválido", async () => {
      insertCatalogProduct("110606", "Cal Mag D Plus");
      const videoId = await makeVideo("segProd02");
      const ok = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 0,
        endS: 30,
        title: "T",
        mentioned_products: '["Cal Mag D Plus"]',
        product_references: '["110606","999999"]',
      });
      expect(ok.status).toBe(201);
      const data = (await ok.json()) as {
        segment: { mentionedProducts: string[]; productReferences: string[] };
      };
      expect(data.segment.mentionedProducts).toEqual(["Cal Mag D Plus"]);
      expect(data.segment.productReferences).toEqual(["110606"]);

      const bad = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 0,
        endS: 30,
        title: "T2",
        product_references: 42,
      });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { error: string }).error).toBe(
        "product_references must be an array of strings",
      );

      const badMentions = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 0,
        endS: 30,
        title: "T3",
        mentioned_products: '{"a":1}',
      });
      expect(badMentions.status).toBe(400);
    });

    it("PATCH reemplaza los campos de producto, descarta refs inválidas y limpia con []", async () => {
      insertCatalogProduct("110606", "Cal Mag D Plus");
      const videoId = await makeVideo("segProd03");
      const created = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 0,
        endS: 30,
        title: "T",
        mentioned_products: ["Cal Mag D Plus"],
        product_references: ["110606"],
      });
      const { segment } = (await created.json()) as { segment: { id: number } };

      const patched = await send("PATCH", `/admin/video-segments/${segment.id}`, {
        mentioned_products: ["Double X"],
        product_references: ["121576", "999999"], // 999999 fuera de catálogo → se cae
      });
      expect(patched.status).toBe(200);
      const pdata = (await patched.json()) as {
        segment: { mentionedProducts: string[]; productReferences: string[] };
      };
      expect(pdata.segment.mentionedProducts).toEqual(["Double X"]);
      expect(pdata.segment.productReferences).toEqual(["121576"]);

      const cleared = await send("PATCH", `/admin/video-segments/${segment.id}`, {
        product_references: [],
      });
      expect(
        ((await cleared.json()) as { segment: { productReferences: string[] } }).segment
          .productReferences,
      ).toEqual([]);

      const bad = await send("PATCH", `/admin/video-segments/${segment.id}`, {
        mentioned_products: "no-array",
      });
      expect(bad.status).toBe(400);
    });

    it("GET /admin/video-segments devuelve los arrays parseados (con y sin filtro)", async () => {
      insertCatalogProduct("110606", "Cal Mag D Plus");
      const videoId = await makeVideo("segProd04");
      const created = await send("POST", "/admin/video-segments", {
        videoId,
        startS: 0,
        endS: 30,
        title: "T",
        mentioned_products: ["Cal Mag D Plus"],
        product_references: ["110606"],
      });
      const { segment } = (await created.json()) as { segment: { id: number } };

      const res = await get("/admin/video-segments");
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        segments: Array<{
          id: number;
          mentionedProducts: string[];
          productReferences: string[];
        }>;
      };
      const row = data.segments.find((s) => s.id === segment.id);
      expect(row?.mentionedProducts).toEqual(["Cal Mag D Plus"]);
      expect(row?.productReferences).toEqual(["110606"]);

      const filtered = await get(`/admin/video-segments?video_id=${videoId}`);
      const fdata = (await filtered.json()) as {
        segments: Array<{ mentionedProducts: string[]; productReferences: string[] }>;
      };
      expect(fdata.segments[0]?.mentionedProducts).toEqual(["Cal Mag D Plus"]);
      expect(fdata.segments[0]?.productReferences).toEqual(["110606"]);
    });
  });

  // ─── Delete rules + FK decision ─────────────────────────────────────

  describe("delete rules (video-with-segments decision: 409)", () => {
    it("returns 409 when deleting a video that still has segments (no cascade)", async () => {
      const svc = createVideoService(db);
      const video = svc.createVideo({
        speaker: "Luis Collantes",
        youtubeId: "delVid01",
        url: "u",
        title: "Con segmentos",
      });
      svc.createSegment({ videoId: video.id, startS: 0, endS: 10, title: "s1" });
      svc.createSegment({ videoId: video.id, startS: 10, endS: 20, title: "s2" });

      const res = await send("DELETE", `/admin/videos/${video.id}`);
      expect(res.status).toBe(409);
      const data = (await res.json()) as { error: string; count: number };
      expect(data.error).toBe("video has segments");
      expect(data.count).toBe(2);

      // Nothing was removed: the video and both segments survive.
      expect(svc.listVideos().some((v) => v.id === video.id)).toBe(true);
      expect(svc.listSegments().filter((s) => s.videoId === video.id)).toHaveLength(2);
    });

    it("deletes segments first, then the video succeeds (explicit ordering)", async () => {
      const svc = createVideoService(db);
      const video = svc.createVideo({
        speaker: "Luis Collantes",
        youtubeId: "delVid02",
        url: "u",
        title: "Borrable",
      });
      const seg = svc.createSegment({ videoId: video.id, startS: 0, endS: 10, title: "s" });

      const stillBlocked = await send("DELETE", `/admin/videos/${video.id}`);
      expect(stillBlocked.status).toBe(409);

      const delSeg = await send("DELETE", `/admin/video-segments/${seg.id}`);
      expect(delSeg.status).toBe(204);

      const delVideo = await send("DELETE", `/admin/videos/${video.id}`);
      expect(delVideo.status).toBe(204);
      expect(svc.listVideos().some((v) => v.id === video.id)).toBe(false);

      // Absent id → the admin not-found shape.
      const absent = await send("DELETE", `/admin/videos/${video.id}`);
      expect(absent.status).toBe(404);
      expect(((await absent.json()) as { error: string }).error).toBe("video not found");
    });
  });
});
