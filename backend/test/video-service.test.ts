import { describe, it, expect, beforeAll } from "vitest";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { assessmentSymptoms } from "../src/db/assessmentSchema.js";
import { createVideoService } from "../src/services/videoService.js";
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
    expect(seg.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(seg.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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
