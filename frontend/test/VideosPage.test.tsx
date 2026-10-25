import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, within, act } from "@testing-library/react";
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
    analysisState: null,
    analysisError: null,
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
    analysisState: null,
    analysisError: null,
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
/** admin-video-analyze: when set, the analyze POST answers 409 for that id. */
let analyzeConflictForId: number | null = null;
/** Fix L5: when set, the next videos GET fails once (initial-load failure). */
let failNextVideosList = false;

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
      if (failNextVideosList) {
        failNextVideosList = false;
        return bad(500, { error: "network down" });
      }
      // Fresh copies every poll — mirrors real JSON responses (new identity
      // per fetch) so React re-renders and the polling effect can re-evaluate.
      return ok(200, { videos: videosState.map((v) => ({ ...v })) });
    }
    const analyzeId = url.match(/^\/api\/admin\/videos\/(\d+)\/analyze$/);
    if (analyzeId && method === "POST") {
      const id = Number(analyzeId[1]);
      if (analyzeConflictForId === id) {
        return bad(409, { error: "analysis already running" });
      }
      const video = videosState.find((v) => v.id === id);
      if (!video) return bad(404, { error: "video not found" });
      video.analysisState = "running";
      video.analysisError = null;
      return ok(202, { video });
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
        analysisState: null,
        analysisError: null,
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
    if (url === "/api/admin/video-segments/bulk-delete" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const ids: number[] = Array.isArray(body.ids) ? body.ids : [];
      const before = segmentsState.length;
      segmentsState = segmentsState.filter((s) => !ids.includes(s.id));
      return ok(200, { deleted: before - segmentsState.length });
    }
    return bad(404, { error: `unmocked ${method} ${url}` });
  });
}

describe("VideosPage admin CRM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    videosState = VIDEOS.map((v) => ({ ...v }));
    segmentsState = SEGMENTS.map((s) => ({ ...s }));
    analyzeConflictForId = null;
    failNextVideosList = false;
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
    // ConfirmActionDialog opens instead of window.confirm
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

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

    // Delete the filtered video (confirmed via ConfirmActionDialog; mock DELETE succeeds)
    const row = screen.getAllByText("Vitamina D y huesos")[0]!.closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Eliminar" }));
    const filterDialog = await screen.findByRole("alertdialog");
    await user.click(within(filterDialog).getByRole("button", { name: "Eliminar" }));

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

  it("cancelling the confirm dialog deletes nothing and closes the dialog", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    const row = (await screen.findByText("Introducción a la vitamina D")).closest(
      "tr",
    ) as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Eliminar" }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(
      mockFetch.mock.calls.some(
        ([url, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      ),
    ).toBe(false);
    expect(screen.getAllByText("Introducción a la vitamina D").length).toBeGreaterThan(0);
  });

  it("segment delete: DELETE /admin/video-segments/:id and the list reloads without it", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    const row = (await screen.findByText("Introducción a la vitamina D")).closest(
      "tr",
    ) as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Eliminar" }));
    const segmentDialog = await screen.findByRole("alertdialog");
    await user.click(within(segmentDialog).getByRole("button", { name: "Eliminar" }));

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

  it("bulk delete: selecting several segments and confirming posts all ids at once", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    await user.click(
      screen.getByRole("checkbox", { name: "Seleccionar segmento: Introducción a la vitamina D" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Seleccionar segmento: Magnesio antes de dormir" }),
    );

    await user.click(screen.getByRole("button", { name: /Eliminar seleccionados \(2\)/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    const bulkCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/admin/video-segments/bulk-delete" &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(bulkCall).toBeTruthy();
    expect(JSON.parse(String((bulkCall?.[1] as RequestInit)?.body))).toEqual({ ids: [7, 8] });

    await waitFor(() => {
      expect(screen.queryByText("Introducción a la vitamina D")).not.toBeInTheDocument();
      expect(screen.queryByText("Magnesio antes de dormir")).not.toBeInTheDocument();
    });
  });

  it("header checkbox selects every visible segment at once", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar todos los segmentos" }));

    expect(screen.getByRole("button", { name: /Eliminar seleccionados \(2\)/ })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Seleccionar segmento: Introducción a la vitamina D" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Seleccionar segmento: Magnesio antes de dormir" }),
    ).toBeChecked();
  });

  it("cancelling the bulk confirm dialog deletes nothing", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    await user.click(
      screen.getByRole("checkbox", { name: "Seleccionar segmento: Introducción a la vitamina D" }),
    );
    await user.click(screen.getByRole("button", { name: /Eliminar seleccionados \(1\)/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(
      mockFetch.mock.calls.some(
        ([url]) => url === "/api/admin/video-segments/bulk-delete",
      ),
    ).toBe(false);
    expect(screen.getAllByText("Introducción a la vitamina D").length).toBeGreaterThan(0);
  });

  it("confirming bulk delete closes the dialog immediately and posts exactly once", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    await user.click(
      screen.getByRole("checkbox", { name: "Seleccionar segmento: Introducción a la vitamina D" }),
    );
    await user.click(screen.getByRole("button", { name: /Eliminar seleccionados \(1\)/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    // Regression (verify #2): the dialog must close on confirm, not stay open
    // until the fetch resolves — a lingering dialog invites a second click.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("Introducción a la vitamina D")).not.toBeInTheDocument();
    });
    const bulkPosts = mockFetch.mock.calls.filter(
      ([url, init]) =>
        url === "/api/admin/video-segments/bulk-delete" &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(bulkPosts).toHaveLength(1);
  });

  it("select-all only covers the rows the table actually shows (search-scoped)", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    // The segments DataTable is the second searchable table on the page.
    await user.type(screen.getAllByRole("searchbox")[1]!, "Magnesio");
    await screen.findByText("Magnesio antes de dormir");
    expect(screen.queryByText("Introducción a la vitamina D")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar todos los segmentos" }));

    // Regression (verify #1/#3): only the matching row may be selected.
    expect(screen.getByRole("button", { name: /Eliminar seleccionados \(1\)/ })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Seleccionar segmento: Magnesio antes de dormir" }),
    ).toBeChecked();
  });

  it("deleting a selected row singly prunes it from the bulk selection", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    await user.click(
      screen.getByRole("checkbox", { name: "Seleccionar segmento: Introducción a la vitamina D" }),
    );
    expect(screen.getByRole("button", { name: /Eliminar seleccionados \(1\)/ })).toBeInTheDocument();

    const row = screen.getByText("Introducción a la vitamina D").closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Eliminar" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    // Regression (verify #4): the stale id must not survive the reload — the
    // bulk bar disappears instead of claiming 1 selected (0 deletable).
    await waitFor(() => {
      expect(screen.queryByText("Introducción a la vitamina D")).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /Eliminar seleccionados/ }),
    ).not.toBeInTheDocument();
  });

  it("draft video: Analizar fires the analyze POST and the row shows Analizando…", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    const row = screen.getAllByText("Magnesio y sueño")[0]!.closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Analizar" }));

    // S1: POST fires and the refreshed row enters the running state (chip).
    await waitFor(() => {
      expect(screen.getAllByText("Analizando…").length).toBeGreaterThan(0);
    });
    expect(
      mockFetch.mock.calls.some(
        ([url, init]) =>
          url === "/api/admin/videos/2/analyze" &&
          (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(true);
  });

  it("analyzed video: Re-analizar warns that segments are replaced and posts only on confirm", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");
    const analyzePosts = () =>
      mockFetch.mock.calls.filter(
        ([url, init]) =>
          url === "/api/admin/videos/1/analyze" &&
          (init as RequestInit | undefined)?.method === "POST",
      ).length;

    const row = () =>
      screen.getAllByText("Vitamina D y huesos")[0]!.closest("tr") as HTMLElement;
    await user.click(within(row()).getByRole("button", { name: "Re-analizar" }));
    const dialog = await screen.findByRole("alertdialog");
    // S2: the warning must state that existing segments are replaced.
    expect(within(dialog).getByText(/reemplaz/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(analyzePosts()).toBe(0); // cancel → nothing fired

    await user.click(within(row()).getByRole("button", { name: "Re-analizar" }));
    const reopened = await screen.findByRole("alertdialog");
    await user.click(within(reopened).getByRole("button", { name: "Re-analizar" }));
    await waitFor(() => expect(analyzePosts()).toBe(1));
  });

  it("surfaces the single-flight 409 inline (S2: only one analysis at a time)", async () => {
    analyzeConflictForId = 2;
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    const row = screen.getAllByText("Magnesio y sueño")[0]!.closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Analizar" }));

    expect(await screen.findByText(/análisis en curso/i)).toBeInTheDocument();
    // No chip: the refused trigger must not leave a phantom running state.
    expect(screen.queryByText("Analizando…")).not.toBeInTheDocument();
  });

  it("renders the stored analysis error in the video row (S3: visible failure)", async () => {
    videosState[1]!.analysisError = "No se encontró transcripción utilizable en el video";
    render(<VideosPage />);
    expect(
      await screen.findByText("No se encontró transcripción utilizable en el video"),
    ).toBeInTheDocument();
    // The failed draft is still a draft — retry stays available.
    expect(screen.getAllByRole("button", { name: "Analizar" }).length).toBeGreaterThan(0);
  });

  it("polls GET /videos every 4s while analyzing and stops once finished (S1)", async () => {
    videosState[0]!.analysisState = "running";
    const getCalls = () =>
      mockFetch.mock.calls.filter(
        ([url, init]) =>
          url === "/api/admin/videos" &&
          ((init as RequestInit | undefined)?.method ?? "GET") === "GET",
      ).length;

    // Only the interval pair is faked (clearInterval MUST be faked too —
    // React's cleanup would otherwise call the real clearInterval against a
    // fake timer id, a no-op that leaves a zombie poller); waitFor and
    // userEvent keep their real timers.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      render(<VideosPage />);
      await screen.findByText("Introducción a la vitamina D");
      await waitFor(() => expect(getCalls()).toBe(1));

      act(() => {
        vi.advanceTimersByTime(4000);
      });
      await waitFor(() => expect(getCalls()).toBe(2)); // poll while running

      videosState[0]!.analysisState = null; // job finished
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      await waitFor(() => expect(getCalls()).toBe(3)); // final refresh sees null

      act(() => {
        vi.advanceTimersByTime(30000);
      });
      expect(getCalls()).toBe(3); // interval cleared — no zombie polling
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps polling after a failed initial load so a running job is still discovered (fix L5)", async () => {
    failNextVideosList = true;
    videosState[0]!.analysisState = "running"; // job started elsewhere

    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      render(<VideosPage />);
      // The first list fetch fails → error banner, no rows, no chip.
      expect(await screen.findByText("network down")).toBeInTheDocument();
      expect(screen.queryByText("Analizando…")).not.toBeInTheDocument();

      // The error state must keep polling: the recovery fetch discovers the
      // running job (before the fix nothing polled and it stayed invisible).
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      await waitFor(() =>
        expect(screen.getAllByText("Analizando…").length).toBeGreaterThan(0),
      );
      // Recovered: the banner clears once the list loads again.
      await waitFor(() => expect(screen.queryByText("network down")).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it("video delete success: DELETE /admin/videos/:id and the row disappears after reload", async () => {
    const user = userEvent.setup();
    render(<VideosPage />);
    await screen.findByText("Introducción a la vitamina D");

    const row = screen.getAllByText("Vitamina D y huesos")[0]!.closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Eliminar" }));
    const videoDialog = await screen.findByRole("alertdialog");
    await user.click(within(videoDialog).getByRole("button", { name: "Eliminar" }));

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
