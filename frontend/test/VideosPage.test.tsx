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
    const videoDelete = url.match(/^\/api\/admin\/videos\/(\d+)$/);
    if (videoDelete && method === "DELETE") {
      const id = Number(videoDelete[1]);
      // Video 2 still has segments in the fixture → backend refuses with 409
      if (id === 2) {
        return bad(409, { error: "video has segments", count: 1 });
      }
      videosState = videosState.filter((v) => v.id !== id);
      segmentsState = segmentsState.filter((s) => s.videoId !== id);
      return ok(204, null);
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
    const segRoute = url.match(/^\/api\/admin\/video-segments\/(\d+)$/);
    if (segRoute && method === "PATCH") {
      const id = Number(segRoute[1]);
      const body = JSON.parse(String(init?.body ?? "{}"));
      segmentsState = segmentsState.map((s) => (s.id === id ? { ...s, ...body } : s));
      const segment = segmentsState.find((s) => s.id === id);
      return ok(200, { segment });
    }
    if (segRoute && method === "DELETE") {
      const id = Number(segRoute[1]);
      segmentsState = segmentsState.filter((s) => s.id !== id);
      return ok(204, null);
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
    expect(JSON.parse(String(segmentPosts[0]![1].body))).toMatchObject({
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
      JSON.parse(String(videoPosts[0]![1].body)),
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

    const row = screen.getAllByText("Magnesio y sueño")[0]!.closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByText("video has segments")).toBeInTheDocument();
    // Video still listed — deletion was refused, not silently ignored
    expect(screen.getAllByText("Magnesio y sueño").length).toBeGreaterThan(0);
  });

  it("resets the segment filter to 'Todos los vídeos' after deleting the selected video", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    // Filter by video 1: only its segment is listed, select shows that video
    const filterSelect = screen.getByLabelText("Filtrar por vídeo") as HTMLSelectElement;
    await user.selectOptions(filterSelect, "1");
    expect(filterSelect).toHaveValue("1");
    expect(screen.getByText("Introducción a la vitamina D")).toBeInTheDocument();
    expect(screen.queryByText("Magnesio antes de dormir")).not.toBeInTheDocument();

    // Delete the filtered video (confirm mocked true; mock DELETE succeeds)
    const row = screen.getAllByText("Vitamina D y huesos")[0]!.closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Eliminar" }));

    // The filter must not stay pointed at the deleted video: the select shows
    // "Todos los vídeos" again and the unfiltered segment list is rendered.
    await waitFor(() => {
      expect(screen.getByText("Magnesio antes de dormir")).toBeInTheDocument();
    });
    const freshSelect = screen.getByLabelText("Filtrar por vídeo") as HTMLSelectElement;
    expect(freshSelect).toHaveValue("");
    expect(freshSelect.selectedOptions[0]?.text).toBe("Todos los vídeos");
    expect(screen.queryByText(/No hay segmentos para este vídeo/)).not.toBeInTheDocument();
  });

  // ─── T2: edit/delete coverage ───────────────────────────────────────

  it("segment edit flow: PATCH /admin/video-segments/:id carries the new title", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    const row = (await screen.findByText("Introducción a la vitamina D")).closest(
      "tr",
    ) as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Editar" }));

    expect(await screen.findByText(/Editar segmento #7/)).toBeInTheDocument();
    const titleInput = screen.getByLabelText("Título del segmento");
    await user.clear(titleInput);
    await user.type(titleInput, "Título editado");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => {
      const patch = mockFetch.mock.calls.find(
        ([url, init]) =>
          url === "/api/admin/video-segments/7" &&
          (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch![1].body))).toMatchObject({ title: "Título editado" });
    });
    // Reloaded list shows the new title
    expect(await screen.findByText("Título editado")).toBeInTheDocument();
  });

  it("segment delete: DELETE /admin/video-segments/:id and the list reloads without it", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    const row = (await screen.findByText("Introducción a la vitamina D")).closest(
      "tr",
    ) as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Eliminar" }));

    expect(
      mockFetch.mock.calls.some(
        ([url, init]) =>
          url === "/api/admin/video-segments/7" &&
          (init as RequestInit | undefined)?.method === "DELETE",
      ),
    ).toBe(true);
    // Reloaded segment list no longer contains the deleted segment
    await waitFor(() => {
      expect(screen.queryByText("Introducción a la vitamina D")).not.toBeInTheDocument();
    });
  });

  it("video delete success: DELETE /admin/videos/:id and the row disappears after reload", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    const row = screen.getAllByText("Vitamina D y huesos")[0]!.closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Eliminar" }));

    expect(
      mockFetch.mock.calls.some(
        ([url, init]) =>
          url === "/api/admin/videos/1" && (init as RequestInit | undefined)?.method === "DELETE",
      ),
    ).toBe(true);
    // Reloaded videos list (and filter options) no longer contain the video
    await waitFor(() => {
      expect(screen.queryByText("Vitamina D y huesos")).not.toBeInTheDocument();
    });
  });

  // ─── T3: segment edit PATCH semantics ───────────────────────────────

  it("segment edit PATCH: filled symptom field sends symptomId (no condition key) and empty clip sends clipYoutubeId: null", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    const row = (await screen.findByText("Introducción a la vitamina D")).closest(
      "tr",
    ) as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Editar" }));
    await screen.findByText(/Editar segmento #7/);

    // Segment 7 arrives with condition "Dolor óseo", symptomId 12 and clip
    // "clipA1". Fill a new symptom id and clear the clip: the patch must carry
    // symptomId (numeric) with NO condition key, and clipYoutubeId: null
    // explicitly (the condition text left in the form is ignored).
    // Labels with hint <span>s match on their full label content; query by
    // prefix regex like the existing /^Inicio \(s\)$/ lookups.
    const symptomInput = screen.getByLabelText(/^ID síntoma/);
    await user.clear(symptomInput);
    await user.type(symptomInput, "15");
    const clipInput = screen.getByLabelText(/^ID clip en YouTube/);
    await user.clear(clipInput);
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    const patch = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/admin/video-segments/7" &&
        (init as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patch).toBeDefined();
    const body = JSON.parse(String(patch![1].body));
    expect(body).toMatchObject({ symptomId: 15, clipYoutubeId: null });
    expect("condition" in body).toBe(false);
  });

  it("segment edit PATCH: empty symptom field sends condition: \"\" (explicit clear) and no symptomId key", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    const row = (await screen.findByText("Introducción a la vitamina D")).closest(
      "tr",
    ) as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Editar" }));
    await screen.findByText(/Editar segmento #7/);

    // Clear both the symptom id and the free-text condition: the patch must
    // send the explicit clear condition: "" (backend nulls the condition) and
    // no symptomId key at all.
    await user.clear(screen.getByLabelText(/^ID síntoma/));
    await user.clear(screen.getByLabelText(/^Condición \(texto libre\)/));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    const patch = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/admin/video-segments/7" &&
        (init as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patch).toBeDefined();
    const body = JSON.parse(String(patch![1].body));
    expect(body).toMatchObject({ condition: "", clipYoutubeId: "clipA1" });
    expect("symptomId" in body).toBe(false);
  });
});
