import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { toast } from "sonner";
import { AppointmentsPage } from "../src/app/admin/AppointmentsPage";
import type { Appointment } from "../src/app/admin/api";

// T7 (tamizaje-images scope gap) — the GLOBAL "Citas" CRM page: every
// appointment request, including the landing rows with customerId null that
// the per-customer ficha section filters out. Runs on the real admin api
// client over a mocked fetch (CustomerDetailScreening.test.tsx harness), so
// the URL/method/body assertions cover page → api → wire end to end. sonner
// is mocked so the status/notes toast feedback can be asserted.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const APPOINTMENTS: Appointment[] = [
  {
    id: 40,
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
    // Chat-created row for customer 2 — no contact fields on the wire.
    id: 42,
    customerId: 2,
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
    // PUBLIC landing row: customer_id NULL + contact fields filled.
    id: 41,
    customerId: null,
    name: "Público Landing",
    phone: "+34 600 999 888",
    email: "landing@example.com",
    reason: "Tamizaje corporal (Tanita)",
    status: "pendiente",
    notes: null,
    createdAt: "2026-01-08T09:00:00Z",
    updatedAt: "2026-01-08T09:00:00Z",
  },
];

let appointmentsState: Appointment[];
let patchFail: boolean;

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

    // Global list — the ONLY source of this page (no per-customer filter).
    if (url === "/api/admin/appointments" && method === "GET") {
      return ok(200, { appointments: appointmentsState });
    }

    const apptRoute = url.match(/^\/api\/admin\/appointments\/(\d+)$/);
    if (apptRoute && method === "PATCH") {
      if (patchFail) return bad(500, { error: "boom" });
      const body = JSON.parse(String(init?.body)) as {
        status?: string;
        notes?: string;
      };
      const existing = appointmentsState.find(
        (a) => a.id === Number(apptRoute[1]),
      );
      if (!existing) return bad(404, { error: "appointment not found" });
      const updated: Appointment = {
        ...existing,
        ...(body.status != null
          ? { status: body.status as Appointment["status"] }
          : {}),
        ...(body.notes != null ? { notes: body.notes } : {}),
        updatedAt: "2026-01-15T10:00:00Z",
      };
      appointmentsState = appointmentsState.map((a) =>
        a.id === updated.id ? updated : a,
      );
      return ok(200, { appointment: updated });
    }

    return bad(404, { error: `unmocked ${method} ${url}` });
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/citas"]}>
      <Routes>
        <Route path="/admin/citas" element={<AppointmentsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppointmentsPage — citas globales del CRM (T7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appointmentsState = [...APPOINTMENTS];
    patchFail = false;
    installFetchMock();
  });

  it("lists every request from the global endpoint, including the landing row with customerId null", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Citas" }),
    ).toBeInTheDocument();

    // The page reads the GLOBAL endpoint — no customerId filter involved.
    // (api.request omits `method` for reads → the fetch default is GET.)
    expect(
      mockFetch.mock.calls.some(
        ([u, i]) =>
          u === "/api/admin/appointments" &&
          ((i as RequestInit | undefined)?.method ?? "GET") === "GET",
      ),
    ).toBe(true);

    // Spec columns
    for (const header of [
      "Fecha",
      "Nombre",
      "Teléfono",
      "Email",
      "Motivo",
      "Estado",
      "Notas",
      "Cliente vinculado",
      "Acciones",
    ]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }

    // Landing row (customerId null) is visible with its contact fields
    expect(screen.getByText("Público Landing")).toBeInTheDocument();
    expect(screen.getByText("+34 600 999 888")).toBeInTheDocument();
    expect(screen.getByText("landing@example.com")).toBeInTheDocument();
    expect(screen.getByText("Tamizaje corporal (Tanita)")).toBeInTheDocument();
    const landingRow = screen
      .getByText("Público Landing")
      .closest("tr") as HTMLElement;
    // No linked customer → no link cell (the "—" placeholder instead)
    expect(within(landingRow).queryByRole("link")).not.toBeInTheDocument();
    // Landing badge = pendiente → amber (same mapping as CustomerScreening)
    expect(
      within(landingRow).getByText("Pendiente", { selector: "span" }),
    ).toHaveClass("bg-amber-100", "text-amber-700");

    // Chat-created rows render too, with the linked customer id (the admin
    // payload has no customer name — the link is the degrade)
    expect(screen.getByText("Consulta de tamizaje")).toBeInTheDocument();
    expect(screen.getByText("Seguimiento post-compra")).toBeInTheDocument();
    const linkedRow = screen
      .getByText("Consulta de tamizaje")
      .closest("tr") as HTMLElement;
    expect(
      within(linkedRow).getByRole("link", { name: "Cliente #1" }),
    ).toHaveAttribute("href", "/admin/customers/1");
    const agendadaRow = screen
      .getByText("Seguimiento post-compra")
      .closest("tr") as HTMLElement;
    expect(
      within(agendadaRow).getByText("Agendada", { selector: "span" }),
    ).toHaveClass("bg-green-100", "text-green-700");
    // Notes render when present
    expect(
      within(linkedRow).getByText("Llamar por la tarde"),
    ).toBeInTheDocument();
  });

  it("PATCHes the status from the row select with an optimistic badge update and a success toast", async () => {
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText("Consulta de tamizaje")).closest(
      "tr",
    ) as HTMLElement;
    await user.selectOptions(within(row).getByRole("combobox"), "agendada");

    // Optimistic: the badge recolors immediately, before the PATCH resolves
    expect(
      within(row).getByText("Agendada", { selector: "span" }),
    ).toHaveClass("bg-green-100", "text-green-700");

    await waitFor(() => {
      const patch = mockFetch.mock.calls.find(
        ([u, i]) =>
          u === "/api/admin/appointments/40" &&
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
    expect(within(row).getByRole("combobox")).toHaveValue("agendada");
  });

  it("reverts the optimistic status and toasts an error when the PATCH fails", async () => {
    const user = userEvent.setup();
    patchFail = true;
    renderPage();

    const row = (await screen.findByText("Consulta de tamizaje")).closest(
      "tr",
    ) as HTMLElement;
    await user.selectOptions(within(row).getByRole("combobox"), "cancelada");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("boom"),
      ),
    );
    // Reverted to the server truth
    expect(
      within(row).getByText("Pendiente", { selector: "span" }),
    ).toBeInTheDocument();
    expect(within(row).getByRole("combobox")).toHaveValue("pendiente");
  });

  it("filters the list by status and restores everything with «Todos»", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Consulta de tamizaje");

    const filter = screen.getByLabelText("Filtrar por estado");
    await user.selectOptions(filter, "agendada");

    expect(screen.getByText("Seguimiento post-compra")).toBeInTheDocument();
    expect(screen.queryByText("Consulta de tamizaje")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Tamizaje corporal (Tanita)"),
    ).not.toBeInTheDocument();

    await user.selectOptions(filter, "pendiente");
    expect(screen.getByText("Consulta de tamizaje")).toBeInTheDocument();
    expect(screen.getByText("Público Landing")).toBeInTheDocument();
    expect(screen.queryByText("Seguimiento post-compra")).not.toBeInTheDocument();

    await user.selectOptions(filter, "todos");
    expect(screen.getByText("Seguimiento post-compra")).toBeInTheDocument();

    // Filter with zero matches → the specific no-match message, not the table
    await user.selectOptions(filter, "contactada");
    expect(
      screen.getByText(/No hay citas con estado «Contactada»/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Motivo" }),
    ).not.toBeInTheDocument();
  });

  it("edits the notes through the same PATCH endpoint", async () => {
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText("Llamar por la tarde")).closest(
      "tr",
    ) as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Editar notas" }));
    const input = within(row).getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Llamar el jueves");
    await user.click(within(row).getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      const patch = mockFetch.mock.calls.find(
        ([u, i]) =>
          u === "/api/admin/appointments/40" &&
          (i as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch as any)[1].body))).toEqual({
        notes: "Llamar el jueves",
      });
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Notas actualizadas"),
    );
    expect(await within(row).findByText("Llamar el jueves")).toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: "Guardar" }),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state that mentions the landing-form submissions when there is nothing", async () => {
    appointmentsState = [];
    renderPage();

    expect(
      await screen.findByText(/No hay citas solicitadas todavía/),
    ).toBeInTheDocument();
    // Empty-state copy names the landing (Booking) submissions explicitly
    expect(
      screen.getByText(/formulario del landing \(Booking\)/),
    ).toBeInTheDocument();
    // No table rows at all
    expect(screen.queryByText("Consulta de tamizaje")).not.toBeInTheDocument();
  });
});
