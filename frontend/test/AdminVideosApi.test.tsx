import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../src/app/admin/api";
import type { Video, VideoSegment } from "../src/app/admin/api";

// Mock fetch (same harness style as VideoCards.test.tsx)
const mockFetch = vi.fn();
global.fetch = mockFetch;

const VIDEO: Video = {
  id: 1,
  speaker: "Luis Collantes",
  youtubeId: "abc123",
  url: "https://www.youtube.com/watch?v=abc123",
  title: "Vitamina D y huesos",
  durationS: 600,
  status: "analyzed",
  licenseNote: "Permiso escrito de uso",
  createdAt: "2025-01-01 10:00:00",
  updatedAt: "2025-01-01 10:00:00",
};

const SEGMENT: VideoSegment = {
  id: 7,
  videoId: 1,
  condition: "Dolor óseo",
  symptomId: 12,
  startS: 90,
  endS: 180,
  title: "Introducción a la vitamina D",
  summary: "Resumen del segmento.",
  clipYoutubeId: null,
  enabled: 1,
  createdAt: "2025-01-01 10:00:00",
  updatedAt: "2025-01-01 10:00:00",
};

function ok(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  });
}

describe("admin videos api client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createVideo posts speaker/url/title to /api/admin/videos and returns the entity", async () => {
    mockFetch.mockResolvedValueOnce(ok(201, { video: VIDEO }));
    const input = { speaker: VIDEO.speaker, url: VIDEO.url, title: VIDEO.title };
    const out = await api.createVideo(input);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/videos",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
    );
    expect(out.video).toEqual(VIDEO);
  });

  it("createVideo surfaces the backend 400 (invalid url) as AdminError", async () => {
    mockFetch.mockResolvedValueOnce(ok(400, { error: "invalid url" }));
    await expect(
      api.createVideo({ speaker: "x", url: "nope", title: "t" }),
    ).rejects.toMatchObject({ name: "AdminError", status: 400, message: "invalid url" });
  });

  it("updateVideo patches title/status and returns the updated entity", async () => {
    const updated: Video = { ...VIDEO, title: "Título nuevo", status: "published" };
    mockFetch.mockResolvedValueOnce(ok(200, { video: updated }));
    const out = await api.updateVideo(1, { title: "Título nuevo", status: "published" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/videos/1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Título nuevo", status: "published" }),
      }),
    );
    expect(out.video).toEqual(updated);
  });

  it("deleteVideo surfaces the 409 (segments exist) per the api error convention", async () => {
    mockFetch.mockResolvedValueOnce(ok(409, { error: "video has segments", count: 2 }));
    await expect(api.deleteVideo(1)).rejects.toMatchObject({
      name: "AdminError",
      status: 409,
      message: "video has segments",
    });
  });

  it("listVideos parses the { videos } list", async () => {
    mockFetch.mockResolvedValueOnce(ok(200, { videos: [VIDEO] }));
    const out = await api.listVideos();
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/videos", expect.anything());
    expect(out.videos).toEqual([VIDEO]);
  });

  it("listVideoSegments scopes with ?video_id= and parses the { segments } list", async () => {
    mockFetch.mockResolvedValueOnce(ok(200, { segments: [SEGMENT] }));
    const out = await api.listVideoSegments(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/video-segments?video_id=1",
      expect.anything(),
    );
    expect(out.segments).toEqual([SEGMENT]);
  });

  it("createVideoSegment posts bounds/title/condition to /api/admin/video-segments", async () => {
    mockFetch.mockResolvedValueOnce(ok(201, { segment: SEGMENT }));
    const input = {
      videoId: 1,
      startS: 90,
      endS: 180,
      title: "Introducción a la vitamina D",
      summary: "Resumen del segmento.",
      condition: "dolor óseo",
    };
    const out = await api.createVideoSegment(input);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/video-segments",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
    );
    expect(out.segment).toEqual(SEGMENT);
  });

  it("updateVideoSegment patches bounds/title and returns the updated entity", async () => {
    const updated: VideoSegment = { ...SEGMENT, title: "Nuevo título", startS: 100 };
    mockFetch.mockResolvedValueOnce(ok(200, { segment: updated }));
    const out = await api.updateVideoSegment(7, { title: "Nuevo título", startS: 100 });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/video-segments/7",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Nuevo título", startS: 100 }),
      }),
    );
    expect(out.segment).toEqual(updated);
  });

  it("updateVideoSegment sends an explicit null to clear clipYoutubeId", async () => {
    const cleared: VideoSegment = { ...SEGMENT, clipYoutubeId: null };
    mockFetch.mockResolvedValueOnce(ok(200, { segment: cleared }));
    const out = await api.updateVideoSegment(7, { clipYoutubeId: null });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/video-segments/7",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ clipYoutubeId: null }),
      }),
    );
    expect(out.segment.clipYoutubeId).toBeNull();
  });
});
