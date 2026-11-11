import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, within, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { toast } from "sonner";
import { CustomerDetailPage } from "../src/app/admin/CustomerDetailPage";
import type {
  Appointment,
  BodyMetric,
  Customer,
  CustomerImage,
} from "../src/app/admin/api";

// T3 (tamizaje-images) — the new CustomerDetail sections ("Tamizaje e
// imágenes" + upload + lightbox, "Métricas corporales", "Citas") on top of
// the real admin api client over a mocked fetch (VideosPage.test.tsx /
// CustomerDetail.test.tsx harness), so URL/method/body assertions cover the
// page → api → wire contract end to end. sonner is mocked so the toast
// feedback of the new flows can be asserted (AdminDeleteToast.test.tsx).
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const CUSTOMERS: Customer[] = [
  {
    id: 1,
    name: "María López",
    email: "maria@example.com",
    phone: "+34 600 111 222",
    referrerPhone: null,
    referrerId: null,
    consentVersion: 1,
    consentTimestamp: "2025-01-05T10:00:00Z",
    registeredAt: "2025-01-05T10:00:00Z",
    createdAt: "2025-01-05T10:00:00Z",
  },
  {
    id: 2,
    name: "Juan Pérez",
    email: "juan@example.com",
    phone: "+34 600 333 444",
    referrerPhone: null,
    referrerId: null,
    consentVersion: 1,
    consentTimestamp: "2025-02-01T10:00:00Z",
    registeredAt: "2025-02-01T10:00:00Z",
    createdAt: "2025-02-01T10:00:00Z",
  },
];

const IMAGES: CustomerImage[] = [
  {
    id: 51,
    customerId: 1,
    kind: "tamizaje",
    cloudinaryPublicId: "vidasaludable/tamizaje-51",
    cloudinarySecureUrl:
      "https://res.cloudinary.com/demo/image/upload/v1/tamizaje-51.jpg",
    takenAt: "2026-01-10",
    uploadedBy: "admin",
    notes: "Reporte RENPHO inicial",
    createdAt: "2026-01-10T09:00:00Z",
  },
  {
    id: 52,
    customerId: 1,
    kind: "evolucion",
    cloudinaryPublicId: "vidasaludable/evolucion-52",
    cloudinarySecureUrl:
      "https://res.cloudinary.com/demo/image/upload/v1/evolucion-52.jpg",
    takenAt: null,
    uploadedBy: "admin",
    notes: null,
    createdAt: "2026-01-12T10:00:00Z",
  },
];

/** Deliberately OLDEST-first on the wire: the page must re-sort newest-first. */
const METRICS: BodyMetric[] = [
  {
    id: 71,
    customerId: 1,
    measuredAt: "2025-12-01",
    weightKg: 80,
    bmi: 27.1,
    bodyFatPct: null,
    fatMassKg: null,
    subcutaneousFatPct: null,
    visceralFat: null,
    musclePct: null,
    muscleMassKg: null,
    skeletalMusclePct: null,
    skeletalMuscleMassKg: null,
    bonePct: null,
    boneMassKg: null,
    fatFreeMassKg: null,
    metabolicAge: null,
    bmrKcal: null,
    waterPct: null,
    proteinPct: null,
    source: "manual",
    notes: null,
    createdAt: "2025-12-01T10:00:00Z",
  },
  {
    id: 72,
    customerId: 1,
    measuredAt: "2026-01-10",
    weightKg: 77.85,
    bmi: 26.3,
    bodyFatPct: 26.9,
    fatMassKg: null,
    subcutaneousFatPct: null,
    visceralFat: 9,
    musclePct: null,
    muscleMassKg: 54.1,
    skeletalMusclePct: null,
    skeletalMuscleMassKg: null,
    bonePct: null,
    boneMassKg: null,
    fatFreeMassKg: null,
    metabolicAge: 39,
    bmrKcal: null,
    waterPct: null,
    proteinPct: null,
    source: "RENPHO",
    notes: "Escaneo Tanita",
    createdAt: "2026-01-10T09:00:00Z",
  },
];

const APPOINTMENTS: Appointment[] = [
  {
    id: 30,
    customerId: 1,
    name: null,
    phone: null,
    email: null,
    reason: "Consulta de tamizaje",
    status: "pendiente",
    notes: "Llamar por la tarde",
    createdAt: "2026-01-05T08:00:00Z",
    updatedAt: "2026-01-05T08:00:00Z",
  },
  {
    id: 31,
    customerId: 1,
    name: null,
    phone: null,
    email: null,
    reason: "Seguimiento post-compra",
    status: "agendada",
    notes: null,
    createdAt: "2026-01-06T09:00:00Z",
    updatedAt: "2026-01-06T09:00:00Z",
  },
  {
    id: 32,
    customerId: 2,
    name: null,
    phone: null,
    email: null,
    reason: "Cita de otro cliente",
    status: "pendiente",
    notes: null,
    createdAt: "2026-01-07T09:00:00Z",
    updatedAt: "2026-01-07T09:00:00Z",
  },
  {
    id: 33,
    customerId: null,
    name: "Público Landing",
    phone: "+34 600 999 888",
    email: null,
    reason: "Cita pública del landing",
    status: "pendiente",
    notes: null,
    createdAt: "2026-01-08T09:00:00Z",
    updatedAt: "2026-01-08T09:00:00Z",
  },
];

let imagesState: CustomerImage[];
let metricsState: BodyMetric[];
let appointmentsState: Appointment[];
let screeningFail: boolean;
let deferUpload: boolean;
let resolveUpload: (() => void) | null;

function ok(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  });
}

function bad(status: number, body: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

function installFetchMock() {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";

    if (url === "/api/admin/customers" && method === "GET") {
      return ok(200, { customers: CUSTOMERS });
    }

    // --- Tamizaje: imágenes (per-customer list + upload proxy) ---
    const imgRoute = url.match(/^\/api\/admin\/customers\/(\d+)\/images$/);
    if (imgRoute && method === "GET") {
      if (screeningFail) return bad(500, { error: "boom" });
      return ok(200, { images: imagesState });
    }
    if (imgRoute && method === "POST") {
      const body = JSON.parse(String(init?.body)) as {
        kind: CustomerImage["kind"];
        data: string;
        taken_at?: string;
        notes?: string;
      };
      const image: CustomerImage = {
        id: 90,
        customerId: Number(imgRoute[1]),
        kind: body.kind,
        cloudinaryPublicId: "vidasaludable/upload-90",
        cloudinarySecureUrl:
          "https://res.cloudinary.com/demo/image/upload/v1/upload-90.jpg",
        takenAt: body.taken_at ?? null,
        uploadedBy: "admin",
        notes: body.notes ?? null,
        createdAt: "2026-01-14T12:00:00Z",
      };
      const respond = () => {
        imagesState = [image, ...imagesState];
        return ok(201, { image });
      };
      if (deferUpload) {
        return new Promise((resolve) => {
          resolveUpload = () => resolve(respond());
        });
      }
      return respond();
    }

    // --- Métricas corporales (per-customer list + upsert) ---
    const bmRoute = url.match(/^\/api\/admin\/customers\/(\d+)\/body-metrics$/);
    if (bmRoute && method === "GET") {
      return ok(200, { bodyMetrics: metricsState });
    }
    if (bmRoute && method === "POST") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const created: BodyMetric = {
        id: 73,
        customerId: Number(bmRoute[1]),
        measuredAt: String(body.measured_at),
        weightKg: (body.weight_kg as number | undefined) ?? null,
        bmi: (body.bmi as number | undefined) ?? null,
        bodyFatPct: null,
        fatMassKg: null,
        subcutaneousFatPct: null,
        visceralFat: null,
        musclePct: null,
        muscleMassKg: null,
        skeletalMusclePct: null,
        skeletalMuscleMassKg: null,
        bonePct: null,
        boneMassKg: null,
        fatFreeMassKg: null,
        metabolicAge: null,
        bmrKcal: null,
        waterPct: null,
        proteinPct: null,
        source: "manual",
        notes: null,
        createdAt: "2026-02-01T12:00:00Z",
      };
      metricsState = [created, ...metricsState];
      return ok(201, { bodyMetric: created });
    }

    // --- Citas (global list filtered client-side + status machine) ---
    if (url === "/api/admin/appointments" && method === "GET") {
      return ok(200, { appointments: appointmentsState });
    }
    const apptRoute = url.match(/^\/api\/admin\/appointments\/(\d+)$/);
    if (apptRoute && method === "PATCH") {
      const body = JSON.parse(String(init?.body)) as { status?: string };
      const existing = appointmentsState.find(
        (a) => a.id === Number(apptRoute[1]),
      );
      if (!existing) return bad(404, { error: "appointment not found" });
      const updated: Appointment = {
        ...existing,
        status: (body.status ?? existing.status) as Appointment["status"],
        updatedAt: "2026-01-15T10:00:00Z",
      };
      appointmentsState = appointmentsState.map((a) =>
        a.id === updated.id ? updated : a,
      );
      return ok(200, { appointment: updated });
    }

    // --- The pre-existing ficha sections (empty is enough here) ---
    if (url === "/api/admin/recommendations" && method === "GET") {
      return ok(200, { recommendations: [] });
    }
    if (url === "/api/admin/purchases" && method === "GET") {
      return ok(200, { purchases: [] });
    }
    if (url === "/api/admin/conversations" && method === "GET") {
      return ok(200, { conversations: [] });
    }
    if (url === "/api/admin/catalog" && method === "GET") {
      return ok(200, { products: [] });
    }
    if (url === "/api/admin/customers/1/summary" && method === "GET") {
      return ok(200, { summary: null });
    }
    return bad(404, { error: `unmocked ${method} ${url}` });
  });
}

function renderPage(id: number | string = 1) {
  return render(
    <MemoryRouter initialEntries={[`/admin/customers/${id}`]}>
      <Routes>
        <Route path="/admin/customers/:id" element={<CustomerDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Mirrors the page's date-only rendering (local date, no time). */
function localDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString();
}

describe("CustomerDetailPage — tamizaje, métricas y citas (T3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imagesState = [...IMAGES];
    metricsState = [...METRICS];
    appointmentsState = [...APPOINTMENTS];
    screeningFail = false;
    deferUpload = false;
    resolveUpload = null;
    installFetchMock();
  });

  it("renders the three sections from the mocked endpoints (images, metrics, appointments)", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Tamizaje e imágenes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Métricas corporales" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Citas" })).toBeInTheDocument();

    // Per-customer lists + the GLOBAL appointments list (filtered here)
    expect(
      mockFetch.mock.calls.some(([u]) => u === "/api/admin/customers/1/images"),
    ).toBe(true);
    expect(
      mockFetch.mock.calls.some(
        ([u]) => u === "/api/admin/customers/1/body-metrics",
      ),
    ).toBe(true);
    expect(
      mockFetch.mock.calls.some(([u]) => u === "/api/admin/appointments"),
    ).toBe(true);

    // Images: thumbnails carry the secure_url, kind badge, date and notes
    const tamizajeImg = await screen.findByAltText("Imagen de Tamizaje");
    expect(tamizajeImg).toHaveAttribute(
      "src",
      IMAGES[0]!.cloudinarySecureUrl,
    );
    const tamLi = tamizajeImg.closest("li") as HTMLElement;
    expect(
      within(tamLi).getByText("Tamizaje", { selector: "span" }),
    ).toBeInTheDocument();
    expect(
      within(tamLi).getByText(localDate("2026-01-10")),
    ).toBeInTheDocument();
    expect(
      within(tamLi).getByText("Reporte RENPHO inicial"),
    ).toBeInTheDocument();
    expect(screen.getByAltText("Imagen de Evolución")).toBeInTheDocument();
    // taken_at falls back to createdAt for the second image
    expect(
      screen.getAllByText(new Date("2026-01-12T10:00:00Z").toLocaleString())
        .length,
    ).toBeGreaterThan(0);

    // Metrics: newest first (wire sent oldest-first), Spanish badges, nulls skipped
    const weightRows = screen.getAllByText(/^Peso \(kg\):/);
    expect(weightRows[0]).toHaveTextContent("77.85");
    expect(weightRows[1]).toHaveTextContent("80");
    expect(screen.getByText("IMC: 26.3")).toBeInTheDocument();
    expect(screen.getByText("Grasa visceral: 9")).toBeInTheDocument();
    expect(screen.getByText("Edad metabólica: 39")).toBeInTheDocument();
    expect(screen.getByText("Fuente: RENPHO")).toBeInTheDocument();
    expect(screen.getByText("Última")).toBeInTheDocument();
    // Fields without a value are skipped entirely (null → no badge)
    expect(screen.queryByText(/^Grasa visceral: 80/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Masa ósea:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Agua \(%\):/)).not.toBeInTheDocument();

    // Appointments: only this customer's rows (landing + other customer skipped)
    expect(screen.getByText("Consulta de tamizaje")).toBeInTheDocument();
    expect(screen.getByText("Seguimiento post-compra")).toBeInTheDocument();
    expect(screen.queryByText("Cita de otro cliente")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Cita pública del landing"),
    ).not.toBeInTheDocument();
    const apptLi = screen
      .getByText("Consulta de tamizaje")
      .closest("li") as HTMLElement;
    expect(
      within(apptLi).getByText("Pendiente", { selector: "span" }),
    ).toHaveClass("bg-amber-100", "text-amber-700");
    expect(within(apptLi).getByText("Llamar por la tarde")).toBeInTheDocument();
    expect(
      within(apptLi).getByText(
        `Solicitada el ${new Date("2026-01-05T08:00:00Z").toLocaleString()}`,
      ),
    ).toBeInTheDocument();
  });

  it("opens a lightbox dialog on thumbnail click with the full image and closes on Escape", async () => {
    const user = userEvent.setup();
    renderPage();

    const thumb = await screen.findByAltText("Imagen de Tamizaje");
    await user.click(thumb);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByAltText("Imagen de Tamizaje")).toHaveAttribute(
      "src",
      IMAGES[0]!.cloudinarySecureUrl,
    );
    expect(within(dialog).getByText("Reporte RENPHO inicial")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("uploads the selected file as base64 with loading and success states", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByAltText("Imagen de Tamizaje");

    deferUpload = true;
    const file = new File(["hola mundo"], "reporte.png", { type: "image/png" });
    await user.upload(
      screen.getByLabelText(/Imagen \(JPG\/PNG/),
      file,
    );
    await user.selectOptions(screen.getByLabelText("Tipo"), "evolucion");
    fireEvent.change(screen.getByLabelText(/Fecha del reporte/), {
      target: { value: "2026-01-14" },
    });
    await user.type(screen.getByLabelText(/Notas/), "Control de evolución");
    await user.click(screen.getByRole("button", { name: "Subir imagen" }));

    // Loading state while the proxy upload is in flight
    const pendingBtn = await screen.findByRole("button", {
      name: "Subiendo…",
    });
    expect(pendingBtn).toBeDisabled();

    // Wire contract: POST .../images with kind + base64 data URI + metadata
    const post = mockFetch.mock.calls.find(
      ([u, i]) =>
        u === "/api/admin/customers/1/images" &&
        (i as RequestInit | undefined)?.method === "POST",
    );
    expect(post).toBeDefined();
    const body = JSON.parse(String((post as any)[1].body));
    expect(body.kind).toBe("evolucion");
    expect(body.data).toMatch(/^data:image\/png;base64,/);
    expect(body.taken_at).toBe("2026-01-14");
    expect(body.notes).toBe("Control de evolución");

    await act(async () => {
      resolveUpload?.();
    });

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Imagen subida"),
    );
    // The reloaded list shows the new thumbnail (notes text), form reset
    expect(await screen.findByText("Control de evolución")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Subir imagen" }),
    ).toBeDisabled();
  });

  it("POSTs a new body-metric record and lists it first afterwards", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Peso (kg): 77.85");

    fireEvent.change(screen.getByLabelText(/Fecha de medición/), {
      target: { value: "2026-02-01" },
    });
    fireEvent.change(screen.getByLabelText("Peso (kg)"), {
      target: { value: "76.5" },
    });
    fireEvent.change(screen.getByLabelText("IMC"), {
      target: { value: "25.9" },
    });
    await user.click(screen.getByRole("button", { name: "Guardar medición" }));

    await waitFor(() => {
      const post = mockFetch.mock.calls.find(
        ([u, i]) =>
          u === "/api/admin/customers/1/body-metrics" &&
          (i as RequestInit | undefined)?.method === "POST",
      );
      expect(post).toBeDefined();
      // Only the filled fields are sent (partial records are valid)
      expect(JSON.parse(String((post as any)[1].body))).toEqual({
        measured_at: "2026-02-01",
        weight_kg: 76.5,
        bmi: 25.9,
      });
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Medición guardada"),
    );

    // Newest-first after the reload
    const weightRows = await screen.findAllByText(/^Peso \(kg\):/);
    expect(weightRows[0]).toHaveTextContent("76.5");
    expect(weightRows[0]!.closest("li")).toHaveTextContent(
      localDate("2026-02-01"),
    );
  });

  it("PATCHes the appointment status from the select and updates the badge", async () => {
    const user = userEvent.setup();
    renderPage();

    const apptLi = (await screen.findByText("Consulta de tamizaje")).closest(
      "li",
    ) as HTMLElement;
    await user.selectOptions(
      within(apptLi).getByRole("combobox"),
      "agendada",
    );

    await waitFor(() => {
      const patch = mockFetch.mock.calls.find(
        ([u, i]) =>
          u === "/api/admin/appointments/30" &&
          (i as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch as any)[1].body))).toEqual({
        status: "agendada",
      });
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Estado de la cita actualizado",
      ),
    );
    // Badge recolors in place: agendada = green
    const badge = within(apptLi).getByText("Agendada", { selector: "span" });
    expect(badge).toHaveClass("bg-green-100", "text-green-700");
    expect(
      within(apptLi).getByRole("combobox"),
    ).toHaveValue("agendada");
  });

  it("shows the screening ErrorBanner on failure and recovers on Reintentar", async () => {
    const user = userEvent.setup();
    screeningFail = true;
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos cargar los datos");
    expect(alert).toHaveTextContent("boom");
    expect(
      screen.queryByRole("heading", { name: "Tamizaje e imágenes" }),
    ).not.toBeInTheDocument();

    screeningFail = false;
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(
      await screen.findByRole("heading", { name: "Tamizaje e imágenes" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
