import { describe, it, expect, beforeAll } from "vitest";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { eq } from "drizzle-orm";
import { assessmentSymptoms } from "../src/db/assessmentSchema.js";
import { videoSegments } from "../src/db/schema.js";
import { createVideoService, parseSegmentProductList } from "../src/services/videoService.js";
import { matchSymptom, normalizeSymptomText } from "../src/services/symptomMatcher.js";
import seedData from "../src/seed/assessment_seed_data.json";

/** Real 95-symptom vocabulary — accented Spanish, source of truth for `condition`. */
const seedSymptoms = seedData.symptoms as { id: number; name_es: string }[];

const JOINT_PAIN = 30; // "Dolor en las articulaciones, ..."
const BACK_PAIN = 29; // "Dolor de espalda"
const ANXIETY = 3; // "Ansiedad o tensión"
const ACNE = 1; // "Acné"

/**
 * Symptom ids actually referenced by the fixtures below. Inserting exactly
 * these keeps the FK meaningful without loading all 95 rows.
 */
const referencedSymptomIds = [ACNE, ANXIETY, 4, BACK_PAIN, JOINT_PAIN];
const seededSymptoms = seedSymptoms.filter((s) => referencedSymptomIds.includes(s.id));

/**
 * symptomMatcher + videoService.
 *
 * `matchSymptom` is pure and is fed the real seed vocabulary, so every
 * expectation is checked against accented Spanish (ñ/é/ó/í) rather than a
 * hand-rolled fixture. `videoService` runs against in-memory SQLite migrated
 * with the production DDL, mirroring test/guidance.test.ts.
 */
describe("matchSymptom", () => {
  it("matches the real vocabulary case-insensitively", () => {
    expect(matchSymptom("Dolor de espalda", seedSymptoms)?.id).toBe(BACK_PAIN);
    expect(matchSymptom("DOLOR DE ESPALDA", seedSymptoms)?.id).toBe(BACK_PAIN);
  });

  it("is accent-insensitive: unaccented input matches an accented name", () => {
    // Seed name carries an acute accent: "Ansiedad o tensión".
    expect(seedSymptoms.find((s) => s.id === ANXIETY)?.name_es).toBe("Ansiedad o tensión");
    expect(matchSymptom("ansiedad o tension", seedSymptoms)?.id).toBe(ANXIETY);
  });

  it("is case- AND accent-insensitive together", () => {
    expect(matchSymptom("AnSIEDAD o Tensión", seedSymptoms)?.id).toBe(ANXIETY);
  });

  it("matches an accented input against the accented name (Acné)", () => {
    expect(seedSymptoms.find((s) => s.id === ACNE)?.name_es).toBe("Acné");
    expect(matchSymptom("acné", seedSymptoms)?.id).toBe(ACNE);
    expect(matchSymptom("ACNÉ", seedSymptoms)?.id).toBe(ACNE);
    expect(matchSymptom("acne", seedSymptoms)?.id).toBe(ACNE);
  });

  it("matches by mutual substring when the input is a fragment", () => {
    const hit = matchSymptom("en las articulaciones", seedSymptoms);
    expect(hit?.id).toBe(JOINT_PAIN);
    expect(hit?.name_es).toContain("articulaciones");
  });

  it("matches when the input contains a whole symptom name", () => {
    expect(matchSymptom("dolor de espalda y rigidez matutina", seedSymptoms)?.id).toBe(BACK_PAIN);
  });

  it("collapses punctuation and extra whitespace before comparing", () => {
    expect(normalizeSymptomText("  ¡Dolores   de cabeza!  ")).toBe("dolores de cabeza");
    expect(normalizeSymptomText("Migrañas ñandú (y. más)")).toBe("migranas nandu y mas");
  });

  it("returns null for empty, whitespace-only or punctuation-only input", () => {
    expect(matchSymptom("", seedSymptoms)).toBeNull();
    expect(matchSymptom("   ", seedSymptoms)).toBeNull();
    expect(matchSymptom("!!!", seedSymptoms)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchSymptom("zzzz no existe", seedSymptoms)).toBeNull();
    expect(matchSymptom("vitamina d", seedSymptoms)).toBeNull();
  });

  it("returns null when the symptom list is empty", () => {
    expect(matchSymptom("acné", [])).toBeNull();
  });

  it("returns the original (un-normalized) symptom entry on a hit", () => {
    const hit = matchSymptom("acne", seedSymptoms);
    expect(hit).toEqual({ id: ACNE, name_es: "Acné" });
  });
});

describe("parseSegmentProductList", () => {
  it("parses the persisted JSON string array", () => {
    expect(parseSegmentProductList('["Cal Mag D Plus","Double X"]')).toEqual([
      "Cal Mag D Plus",
      "Double X",
    ]);
    expect(parseSegmentProductList("[]")).toEqual([]);
  });

  it("degrades null/corrupt/non-array payloads to [] (never throws)", () => {
    expect(parseSegmentProductList(null)).toEqual([]);
    expect(parseSegmentProductList(undefined)).toEqual([]);
    expect(parseSegmentProductList("no es json")).toEqual([]);
    expect(parseSegmentProductList('{"a":1}')).toEqual([]);
    expect(parseSegmentProductList('["a", 2]')).toEqual(["a", "2"]);
  });
});

describe("videoService", () => {
  let db: Db;

  beforeAll(async () => {
    db = createDatabase(":memory:");
    await migrate(db);
    // Real symptom rows so the video_segments → assessment_symptoms FK can be
    // exercised (client.ts turns foreign_keys ON).
    for (const s of seededSymptoms) {
      db.insert(assessmentSymptoms).values({ id: s.id, nameEs: s.name_es }).run();
    }
  });

  it("creates a video with status 'draft' by default and ISO-8601 timestamps", () => {
    const svc = createVideoService(db);
    const row = svc.createVideo({
      speaker: "Luis Collantes",
      youtubeId: "vid-1",
      url: "https://www.youtube.com/watch?v=vid-1",
      title: "Vitaminas y energía",
      durationS: 300,
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.speaker).toBe("Luis Collantes");
    expect(row.status).toBe("draft");
    expect(row.durationS).toBe(300);
    expect(row.licenseNote).toBeNull();
    expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("getVideoByYoutubeId returns the row, or null when absent", () => {
    const svc = createVideoService(db);
    svc.createVideo({ speaker: "Luis Collantes", youtubeId: "vid-2", url: "u2", title: "t2" });
    expect(svc.getVideoByYoutubeId("vid-2")?.title).toBe("t2");
    expect(svc.getVideoByYoutubeId("does-not-exist")).toBeNull();
  });

  it("enforces a unique youtubeId", () => {
    const svc = createVideoService(db);
    svc.createVideo({ speaker: "s", youtubeId: "dup", url: "u", title: "first" });
    expect(() =>
      svc.createVideo({ speaker: "s", youtubeId: "dup", url: "u", title: "second" }),
    ).toThrow();
  });

  it("T2: duplicate createVideo throws the raw UNIQUE constraint error from the driver", () => {
    // Contract for POST /videos (admin.ts): when the TOCTOU pre-check misses a
    // duplicate (a row inserted between getVideoByYoutubeId and createVideo),
    // this driver error is the signal the route must map to 409 with the same
    // body as the pre-check ("youtubeId already exists").
    //
    // The true mid-request race cannot be simulated deterministically from the
    // route level without mocking: better-sqlite3 is synchronous on one
    // connection and the handler section between the pre-check and the insert
    // contains no await, so nothing can interleave (Node is single-threaded).
    // Therefore we pin the raw error shape here — message + `code` — that the
    // route's catch keys on, instead of mocking the service.
    const svc = createVideoService(db);
    svc.createVideo({ speaker: "s", youtubeId: "t2-race-dup", url: "u", title: "first" });
    let thrown: unknown;
    try {
      svc.createVideo({ speaker: "s", youtubeId: "t2-race-dup", url: "u", title: "second" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const e = thrown as Error & { code?: string };
    expect(e.message).toContain("UNIQUE constraint failed");
    expect(String(e.code)).toMatch(/^SQLITE_CONSTRAINT/);
  });

  it("listVideos returns every video", () => {
    const svc = createVideoService(db);
    const before = svc.listVideos().length;
    const a = svc.createVideo({ speaker: "A", youtubeId: "list-a", url: "ua", title: "ta" });
    const b = svc.createVideo({ speaker: "B", youtubeId: "list-b", url: "ub", title: "tb" });
    const all = svc.listVideos();
    expect(all.length).toBe(before + 2);
    expect(all.map((v) => v.id)).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it("updateVideo patches fields and refreshes updatedAt", async () => {
    const svc = createVideoService(db);
    const row = svc.createVideo({
      speaker: "Luis Collantes",
      youtubeId: "upd-1",
      url: "u",
      title: "Original",
      status: "draft",
    });
    // Ensure the timestamp advances (ISO has ms precision; updates in the same
    // millisecond would otherwise produce an identical updatedAt).
    await new Promise((r) => setTimeout(r, 5));
    const patched = svc.updateVideo(row.id, {
      title: "Analizado",
      status: "analyzed",
      durationS: 120,
      licenseNote: "Permiso escrito del titular",
    });
    expect(patched?.title).toBe("Analizado");
    expect(patched?.status).toBe("analyzed");
    expect(patched?.durationS).toBe(120);
    expect(patched?.licenseNote).toBe("Permiso escrito del titular");
    expect(patched?.speaker).toBe("Luis Collantes"); // untouched field survives
    expect(patched?.youtubeId).toBe("upd-1");
    expect(patched?.updatedAt).not.toBe(row.updatedAt);
  });

  it("returns null when updating an absent video id", () => {
    expect(createVideoService(db).updateVideo(99999, { title: "x" })).toBeNull();
  });

  it("removeVideo deletes the row and reports absence for unknown ids", () => {
    const svc = createVideoService(db);
    const row = svc.createVideo({
      speaker: "s",
      youtubeId: "rm-video-1",
      url: "u",
      title: "t",
    });
    expect(svc.removeVideo(row.id)).toBe(true);
    expect(svc.getVideoByYoutubeId("rm-video-1")).toBeNull();
    expect(svc.removeVideo(99999)).toBe(false);
  });

  it("T3: removeVideo on a video with segments throws the raw FK constraint error", () => {
    // Contract for DELETE /videos/:id (admin.ts): the pre-count is the friendly
    // fast path, but a segment inserted between the count and removeVideo would
    // make removeVideo throw (foreign_keys is ON — see client.ts). The route's
    // catch keys on this exact message to re-emit the 409 "video has segments"
    // with a fresh count. As with T2, the mid-request race itself cannot be
    // simulated deterministically without mocking (synchronous,
    // single-connection service; the handler section has no await), so we pin
    // the raw error shape here instead of mocking the service.
    const svc = createVideoService(db);
    const video = svc.createVideo({
      speaker: "s",
      youtubeId: "t3-fk-video",
      url: "u",
      title: "t",
    });
    svc.createSegment({ videoId: video.id, startS: 0, endS: 10, title: "seg" });
    let thrown: unknown;
    try {
      svc.removeVideo(video.id);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("FOREIGN KEY constraint failed");
    // The failed DELETE rolled back — the video survives.
    expect(svc.getVideoByYoutubeId("t3-fk-video")).not.toBeNull();
  });

  it("createSegment defaults enabled=0 and summary='' with ISO-8601 timestamps", () => {
    const svc = createVideoService(db);
    const video = svc.createVideo({ speaker: "Luis", youtubeId: "seg-1", url: "u", title: "t" });
    const seg = svc.createSegment({
      videoId: video.id,
      condition: "dolor de espalda",
      symptomId: BACK_PAIN,
      startS: 12,
      endS: 75,
      title: "Dolor de espalda",
    });
    expect(seg.id).toBeGreaterThan(0);
    expect(seg.videoId).toBe(video.id);
    expect(seg.condition).toBe("dolor de espalda");
    expect(seg.symptomId).toBe(BACK_PAIN);
    expect(seg.startS).toBe(12);
    expect(seg.endS).toBe(75);
    expect(seg.enabled).toBe(0);
    expect(seg.summary).toBe("");
    expect(seg.clipYoutubeId).toBeNull();
    expect(seg.mentionedProducts).toBeNull();
    expect(seg.productReferences).toBeNull();
    expect(seg.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(seg.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("createSegment persists product fields as JSON strings (arrays stringified)", () => {
    const svc = createVideoService(db);
    const video = svc.createVideo({ speaker: "Luis", youtubeId: "seg-prod-1", url: "u", title: "t" });
    const plain = svc.createSegment({ videoId: video.id, startS: 0, endS: 10, title: "T" });
    expect(plain.mentionedProducts).toBeNull();
    expect(plain.productReferences).toBeNull();

    const seg = svc.createSegment({
      videoId: video.id,
      startS: 0,
      endS: 30,
      title: "Con productos",
      mentionedProducts: ["Cal Mag D Plus", "Double X"],
      productReferences: ["110606", "121576"],
    });
    expect(seg.mentionedProducts).toBe(JSON.stringify(["Cal Mag D Plus", "Double X"]));
    expect(seg.productReferences).toBe(JSON.stringify(["110606", "121576"]));
    expect(parseSegmentProductList(seg.mentionedProducts)).toEqual(["Cal Mag D Plus", "Double X"]);
    expect(parseSegmentProductList(seg.productReferences)).toEqual(["110606", "121576"]);
  });

  it("updateSegment patches product fields from arrays or JSON strings", () => {
    const svc = createVideoService(db);
    const video = svc.createVideo({ speaker: "Luis", youtubeId: "seg-prod-2", url: "u", title: "t" });
    const seg = svc.createSegment({
      videoId: video.id,
      startS: 0,
      endS: 30,
      title: "T",
      mentionedProducts: ["Omega-3"],
      productReferences: ["126132"],
    });
    // Arrays are stringified on write; untouched fields survive.
    const byArray = svc.updateSegment(seg.id, { productReferences: [] });
    expect(parseSegmentProductList(byArray?.productReferences)).toEqual([]);
    expect(parseSegmentProductList(byArray?.mentionedProducts)).toEqual(["Omega-3"]);
    // JSON strings pass through as-is.
    const byString = svc.updateSegment(seg.id, {
      mentionedProducts: '["Doble X"]',
      productReferences: '["121576"]',
    });
    expect(parseSegmentProductList(byString?.mentionedProducts)).toEqual(["Doble X"]);
    expect(parseSegmentProductList(byString?.productReferences)).toEqual(["121576"]);
  });

  it("listEnabledSegmentCards parses product lists (empty when null or corrupt)", () => {
    const svc = createVideoService(db);
    const video = svc.createVideo({ speaker: "Luis", youtubeId: "seg-prod-3", url: "u", title: "t" });
    const withProducts = svc.createSegment({
      videoId: video.id,
      startS: 0,
      endS: 10,
      title: "Con productos",
      enabled: 1,
      mentionedProducts: ["Cal Mag D Plus"],
      productReferences: ["110606"],
    });
    const withoutProducts = svc.createSegment({
      videoId: video.id,
      startS: 10,
      endS: 20,
      title: "Sin productos",
      enabled: 1,
    });
    // A corrupt row degrades to an empty list instead of crashing the chat.
    const corrupt = svc.createSegment({
      videoId: video.id,
      startS: 20,
      endS: 30,
      title: "Corrupto",
      enabled: 1,
    });
    db.update(videoSegments)
      .set({ productReferences: "no es json" })
      .where(eq(videoSegments.id, corrupt.id))
      .run();

    const cards = svc.listEnabledSegmentCards().filter((c) => c.videoId === video.id);
    const byId = new Map(cards.map((c) => [c.id, c]));
    expect(byId.get(withProducts.id)?.mentionedProducts).toEqual(["Cal Mag D Plus"]);
    expect(byId.get(withProducts.id)?.productReferences).toEqual(["110606"]);
    expect(byId.get(withoutProducts.id)?.mentionedProducts).toEqual([]);
    expect(byId.get(withoutProducts.id)?.productReferences).toEqual([]);
    expect(byId.get(corrupt.id)?.mentionedProducts).toEqual([]);
    expect(byId.get(corrupt.id)?.productReferences).toEqual([]);
  });

  it("listSegments returns every segment; listEnabledSegments only enabled ones", () => {
    const svc = createVideoService(db);
    const video = svc.createVideo({ speaker: "Luis", youtubeId: "seg-2", url: "u", title: "t" });
    const off = svc.createSegment({
      videoId: video.id,
      condition: "cansancio",
      symptomId: 4,
      startS: 0,
      endS: 10,
      title: "Cansancio",
      summary: "todavía no aprobado",
    });
    const on = svc.createSegment({
      videoId: video.id,
      condition: "ansiedad",
      symptomId: ANXIETY,
      startS: 0,
      endS: 20,
      title: "Ansiedad",
      summary: "aprobado",
      enabled: 1,
    });
    expect(svc.listSegments().map((s) => s.id)).toEqual(
      expect.arrayContaining([off.id, on.id]),
    );
    const enabledRows = svc.listEnabledSegments();
    expect(enabledRows.map((s) => s.id)).toContain(on.id);
    expect(enabledRows.map((s) => s.id)).not.toContain(off.id);
  });

  it("updateSegment patches fields and refreshes updatedAt", async () => {
    const svc = createVideoService(db);
    const video = svc.createVideo({ speaker: "Luis", youtubeId: "seg-3", url: "u", title: "t" });
    const seg = svc.createSegment({
      videoId: video.id,
      startS: 0,
      endS: 30,
      title: "Sin condición",
    });
    await new Promise((r) => setTimeout(r, 5));
    const patched = svc.updateSegment(seg.id, {
      condition: "Dolor en las articulaciones",
      symptomId: JOINT_PAIN,
      startS: 5,
      endS: 40,
      title: "Dolor en las articulaciones",
      summary: "artritis y rigidez",
      clipYoutubeId: "clip-abc",
      enabled: 1,
    });
    expect(patched?.condition).toBe("Dolor en las articulaciones");
    expect(patched?.symptomId).toBe(JOINT_PAIN);
    expect(patched?.startS).toBe(5);
    expect(patched?.endS).toBe(40);
    expect(patched?.summary).toBe("artritis y rigidez");
    expect(patched?.clipYoutubeId).toBe("clip-abc");
    expect(patched?.enabled).toBe(1);
    expect(patched?.videoId).toBe(video.id); // untouched field survives
    expect(patched?.updatedAt).not.toBe(seg.updatedAt);
  });

  it("returns null when updating an absent segment id", () => {
    expect(createVideoService(db).updateSegment(99999, { title: "x" })).toBeNull();
  });

  it("removeSegment deletes the row and reports absence for unknown ids", () => {
    const svc = createVideoService(db);
    const video = svc.createVideo({ speaker: "Luis", youtubeId: "seg-4", url: "u", title: "t" });
    const seg = svc.createSegment({ videoId: video.id, startS: 0, endS: 10, title: "t" });
    expect(svc.removeSegment(seg.id)).toBe(true);
    expect(svc.listSegments().some((s) => s.id === seg.id)).toBe(false);
    expect(svc.removeSegment(99999)).toBe(false);
  });
});
