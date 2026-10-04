import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideosPage } from "../src/app/admin/VideosPage";
import type { Video, VideoSegment } from "../src/app/admin/api";

// Mock fetch (same harness style as VideoCards.test.tsx). The admin api client
// runs for real on top of it, so URL/method/body assertions cover the page →
// api → wire contract end to end.
const mockFetch = vi.fn();
global.fetch = mockFetch;

const VIDEOS: Video[] = [
  {
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
  },
  {
    id: 2,
    speaker: "Luis Collantes",
    youtubeId: "def456",
    url: "https://www.youtube.com/watch?v=def456",
    title: "Magnesio y sueño",
    durationS: null,
    status: "draft",
    licenseNote: null,
    createdAt: "2025-01-02 10:00:00",
    updatedAt: "2025-01-02 10:00:00",
  },
];

const SEGMENTS: VideoSegment[] = [
  {
    id: 7,
    videoId: 1,
    condition: "Dolor óseo",
    symptomId: 12,
    startS: 90,
    endS: 180,
    title: "Introducción a la vitamina D",
    summary: "Resumen del segmento A.",
    clipYoutubeId: "clipA1",
    enabled: 1,
    createdAt: "2025-01-01 11:00:00",
    updatedAt: "2025-01-01 11:00:00",
  },
  {
    id: 8,
    videoId: 2,
    condition: null,
    symptomId: null,
    startS: 0,
    endS: 45,
    title: "Magnesio antes de dormir",
    summary: "Resumen del segmento B.",
    clipYoutubeId: null,
    enabled: 0,
    createdAt: "2025-01-02 11:00:00",
    updatedAt: "2025-01-02 11:00:00",
  },
];

// Stateful fixtures: mutations made through the mocked endpoints are visible
// to the subsequent GET reloads the page performs after every action.
let videosState: Video[];
let segmentsState: VideoSegment[];

function ok(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

function bad(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) });
}

function installFetchMock() {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/admin/videos" && method === "GET") {
      return ok(200, { videos: videosState });
    }
    if (url === "/api/admin/videos" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const video: Video = {
        id: 99,
        speaker: body.speaker,
        youtubeId: "new99",
        url: body.url,
        title: body.title,
        durationS: null,
        status: "draft",
        licenseNote: null,
        createdAt: "2025-02-01 10:00:00",
        updatedAt: "2025-02-01 10:00:00",
      };
      videosState = [...videosState, video];
      return ok(201, { video });
    }
    if (url === "/api/admin/videos/2" && method === "DELETE") {
      return bad(409, { error: "video has segments", count: 1 });
    }
    if (url === "/api/admin/video-segments" && method === "GET") {
      return ok(200, { segments: segmentsState });
    }
    if (url === "/api/admin/video-segments" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const segment: VideoSegment = {
        id: 99,
        videoId: body.videoId,
        condition: body.condition ?? null,
        symptomId: body.symptomId ?? null,
        startS: body.startS,
        endS: body.endS,
        title: body.title,
        summary: body.summary ?? "",
        clipYoutubeId: null,
        enabled: 0,
        createdAt: "2025-02-01 10:00:00",
        updatedAt: "2025-02-01 10:00:00",
      };
      segmentsState = [...segmentsState, segment];
      return ok(201, { segment });
    }
    const segPatch = url.match(/^\/api\/admin\/video-segments\/(\d+)$/);
    if (segPatch && method === "PATCH") {
      const id = Number(segPatch[1]);
      const body = JSON.parse(String(init?.body ?? "{}"));
      segmentsState = segmentsState.map((s) => (s.id === id ? { ...s, ...body } : s));
      const segment = segmentsState.find((s) => s.id === id);
      return ok(200, { segment });
    }
    return bad(404, { error: `unmocked ${method} ${url}` });
  });
}

describe("VideosPage admin CRM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    videosState = VIDEOS.map((v) => ({ ...v }));
    segmentsState = SEGMENTS.map((s) => ({ ...s }));
    window.confirm = vi.fn(() => true);
    installFetchMock();
  });

  it("renders videos and segments from the api, marking unmatched conditions", async () => {
    render(<VideosPage />);

    expect(await screen.findByText("Introducción a la vitamina D")).toBeInTheDocument();
    // Videos list: speaker, title, status chip, licenseNote
    expect(screen.getAllByText("Luis Collantes").length).toBeGreaterThan(0);
    expect(screen.getByText("Analizado")).toBeInTheDocument();
    expect(screen.getByText("Permiso escrito de uso")).toBeInTheDocument();
    expect(screen.getAllByText("Magnesio y sueño").length).toBeGreaterThan(0);
    // Segment row: condition null → flagged for assignment; bounds + clip shown
    const row = screen.getByText("Magnesio antes de dormir").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("sin condición")).toBeInTheDocument();
    // T4 Phase A: bounds render as YouTube-style mm:ss (no trailing " s").
    expect(within(row as HTMLElement).getByText("0:00 – 0:45")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("—")).toBeInTheDocument();
    // Enabled chip + clip id on the approved segment
    const approvedRow = screen
      .getByText("Introducción a la vitamina D")
      .closest("tr") as HTMLElement;
    expect(within(approvedRow).getByText("1:30 – 3:00")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    expect(screen.getByText("clipA1")).toBeInTheDocument();
  });

  it("enabled toggle triggers a PATCH with { enabled: 0|1 }", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);

    const row = (await screen.findByText("Introducción a la vitamina D")).closest(
      "tr",
    ) as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Activo" }));

    const patch = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/admin/video-segments/7" && (init as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patch).toBeDefined();
    expect(patch![1]).toEqual(
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: 0 }) }),
    );
    // Reloaded row now shows the flipped state, no error banner
    await waitFor(() => {
      const freshRow = screen
        .getByText("Introducción a la vitamina D")
        .closest("tr") as HTMLElement;
      expect(within(freshRow).getByText("Inactivo")).toBeInTheDocument();
    });
    expect(screen.queryByText(/unmocked|Error/)).not.toBeInTheDocument();
  });

  it("segment create form validates inline and sends the POST", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    await user.click(screen.getByRole("button", { name: "Nuevo segmento" }));

    // Empty submit → inline validation, no POST fired
    await user.click(screen.getByRole("button", { name: "Crear segmento" }));
    expect(
      await screen.findByText(/título del segmento es obligatorio/i),
    ).toBeInTheDocument();
    let segmentPosts = mockFetch.mock.calls.filter(
      ([url, init]) =>
        url === "/api/admin/video-segments" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(segmentPosts).toHaveLength(0);

    // Bounds validation: end must be > start
    await user.type(screen.getByLabelText("Título del segmento"), "Segmento nuevo");
    await user.type(screen.getByLabelText(/^Inicio \(s\)$/), "10");
    await user.type(screen.getByLabelText(/^Fin \(s\)$/), "5");
    await user.click(screen.getByRole("button", { name: "Crear segmento" }));
    expect(await screen.findByText(/0 ≤ inicio < fin/i)).toBeInTheDocument();
    segmentPosts = mockFetch.mock.calls.filter(
      ([url, init]) =>
        url === "/api/admin/video-segments" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(segmentPosts).toHaveLength(0);

    // Valid payload → POST with the parsed fields
    await user.clear(screen.getByLabelText(/^Fin \(s\)$/));
    await user.type(screen.getByLabelText(/^Fin \(s\)$/), "25");
    await user.selectOptions(screen.getByLabelText("Vídeo"), "1");
    await user.click(screen.getByRole("button", { name: "Crear segmento" }));

    await waitFor(() => {
      segmentPosts = mockFetch.mock.calls.filter(
        ([url, init]) =>
          url === "/api/admin/video-segments" &&
          (init as RequestInit | undefined)?.method === "POST",
      );
      expect(segmentPosts).toHaveLength(1);
    });
    expect(JSON.parse(String(segmentPosts[0][1].body))).toMatchObject({
      videoId: 1,
      startS: 10,
      endS: 25,
      title: "Segmento nuevo",
    });
    expect(await screen.findByText("Segmento nuevo")).toBeInTheDocument();
  });

  it("video create form validates inline and sends speaker/url/title", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    await user.click(screen.getByRole("button", { name: "Nuevo vídeo" }));
    await user.click(screen.getByRole("button", { name: "Crear vídeo" }));
    expect(
      await screen.findByText(/ponente, url y título son obligatorios/i),
    ).toBeInTheDocument();
    let videoPosts = mockFetch.mock.calls.filter(
      ([url, init]) =>
        url === "/api/admin/videos" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(videoPosts).toHaveLength(0);

    await user.type(screen.getByLabelText("Ponente"), "Luis Collantes");
    await user.type(
      screen.getByLabelText("URL de YouTube"),
      "https://www.youtube.com/watch?v=new99",
    );
    await user.type(screen.getByLabelText("Título"), "Nuevo vídeo demo");
    await user.click(screen.getByRole("button", { name: "Crear vídeo" }));

    await waitFor(() => {
      videoPosts = mockFetch.mock.calls.filter(
        ([url, init]) =>
          url === "/api/admin/videos" && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(videoPosts).toHaveLength(1);
    });
    expect(
      JSON.parse(String(videoPosts[0][1].body)),
    ).toMatchObject({
      speaker: "Luis Collantes",
      url: "https://www.youtube.com/watch?v=new99",
      title: "Nuevo vídeo demo",
    });
    // Appears in the videos table (and in the filter <option>)
    expect(
      await screen.findByRole("cell", { name: /Nuevo vídeo demo/ }),
    ).toBeInTheDocument();
  });

  it("surfaces the 409 delete error inline when the video still has segments", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    const row = screen.getAllByText("Magnesio y sueño")[0].closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByText("video has segments")).toBeInTheDocument();
    // Video still listed — deletion was refused, not silently ignored
    expect(screen.getAllByText("Magnesio y sueño").length).toBeGreaterThan(0);
  });
});
