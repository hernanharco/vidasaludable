import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Booking } from "../src/app/components/Booking";

// T3 (tamizaje-images) — the landing Booking form must really POST
// /api/appointments (it used to fake the submit with setTimeout). Plain
// mocked fetch, CustomerDetail/VideosPage harness style: the assertions
// cover the payload → response → UI states end to end.
const mockFetch = vi.fn();
global.fetch = mockFetch;

// The Booking section uses motion `whileInView`, which requires
// IntersectionObserver — not shipped by jsdom. Same no-op stub as
// ChatLauncher.test.tsx / Toaster.test.tsx.
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
Object.defineProperty(window, "IntersectionObserver", {
  configurable: true,
  value: NoopIntersectionObserver,
});
Object.defineProperty(globalThis, "IntersectionObserver", {
  configurable: true,
  value: NoopIntersectionObserver,
});

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

beforeEach(() => {
  vi.clearAllMocks();
});

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  reasonCode = "integral",
) {
  await user.type(screen.getByLabelText(/Nombre Completo/), "Ana López");
  await user.type(screen.getByLabelText(/Correo Electrónico/), "ana@example.com");
  await user.type(screen.getByLabelText(/Teléfono/), "+34 611 222 333");
  fireEvent.change(screen.getByLabelText(/Fecha Preferida/), {
    target: { value: "2026-03-01" },
  });
  await user.selectOptions(
    screen.getByLabelText(/Motivo de Consulta/),
    reasonCode,
  );
}

function lastCall() {
  const call = mockFetch.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call as [string, RequestInit];
}

describe("Booking (landing, S3 Landing + CRM)", () => {
  it("POSTs the request to /api/appointments and shows the success state on 201", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(() =>
      ok(201, { appointment: { id: 41, status: "pendiente" } }),
    );
    render(<Booking />);

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Solicitar Cita" }));

    expect(await screen.findByText("Solicitud Recibida")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Nombre Completo/)).not.toBeInTheDocument();

    const [url, init] = lastCall();
    expect(url).toBe("/api/appointments");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Ana López",
      phone: "+34 611 222 333",
      email: "ana@example.com",
      reason: "Evaluación Integral — Fecha preferida: 2026-03-01",
    });
  });

  it("disables the submit button with a pending label while the request is in flight", async () => {
    const user = userEvent.setup();
    let resolveRequest: (() => void) | null = null;
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = () =>
            resolve({
              ok: true,
              status: 201,
              json: () => Promise.resolve({ appointment: { id: 42 } }),
            });
        }),
    );
    render(<Booking />);

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Solicitar Cita" }));

    const pendingBtn = await screen.findByRole("button", {
      name: "Enviando…",
    });
    expect(pendingBtn).toBeDisabled();

    await act(async () => {
      resolveRequest?.();
    });
    expect(await screen.findByText("Solicitud Recibida")).toBeInTheDocument();
  });

  it("shows the server error message on a 400 and keeps the form usable", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(() =>
      bad(400, { error: "invalid email" }),
    );
    render(<Booking />);

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Solicitar Cita" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("invalid email");
    // The form stays: the visitor can correct and retry
    expect(screen.getByLabelText(/Nombre Completo/)).toHaveValue("Ana López");
    expect(
      screen.getByRole("button", { name: "Solicitar Cita" }),
    ).toBeEnabled();
    expect(screen.queryByText("Solicitud Recibida")).not.toBeInTheDocument();
  });

  it("surfaces the 429 rate-limit as a friendly message", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(() =>
      bad(429, { error: "too many requests" }),
    );
    render(<Booking />);

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Solicitar Cita" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Espera unos minutos/);
    expect(alert).not.toHaveTextContent("too many requests");
  });

  it("shows a generic error when the network request fails", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<Booking />);

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Solicitar Cita" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/No pudimos enviar tu solicitud/);
    expect(screen.getByRole("button", { name: "Solicitar Cita" })).toBeEnabled();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });
});

// T6a (tamizaje-images discovery, L7 channel 1: Landing) — the landing must
// let visitors DISCOVER the in-person screening: a `tamizaje` motive first
// among the concrete options of the Motivo select, and section copy that
// presents what the Tanita screening is (in-person, optional, no commitment).
describe("Booking tamizaje discovery (T6a)", () => {
  it("offers the tamizaje motive first among the concrete options", () => {
    render(<Booking />);

    const select = screen.getByLabelText(/Motivo de Consulta/);
    const options = within(select).getAllByRole("option");
    // Placeholder first, then tamizaje BEFORE the concrete service motives.
    expect(options.map((o) => o.getAttribute("value"))).toEqual([
      "",
      "tamizaje",
      "vitaminas",
      "habitos",
      "integral",
      "otro",
    ]);
    expect(options[1]).toHaveTextContent("Tamizaje corporal (Tanita)");
  });

  it("presents the in-person Tanita body-composition screening in the section copy", () => {
    const { container } = render(<Booking />);
    const copy = container.textContent ?? "";
    expect(copy).toMatch(/tamizaje/i);
    expect(copy).toMatch(/composición corporal/i);
    expect(copy).toMatch(/presencial/i);
    expect(copy).toMatch(/Tanita/i);
    expect(copy).toMatch(/opcional/i);
    expect(copy).toMatch(/sin compromiso/i);
    // The original section headline stays (extend the copy, don't redesign).
    expect(copy).toContain("Tu plan preventivo comienza aquí.");
  });

  it("sends the tamizaje label to the public endpoint when selected", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(() =>
      ok(201, { appointment: { id: 44, status: "pendiente" } }),
    );
    render(<Booking />);

    await fillForm(user, "tamizaje");
    await user.click(screen.getByRole("button", { name: "Solicitar Cita" }));

    expect(await screen.findByText("Solicitud Recibida")).toBeInTheDocument();
    const [url, init] = lastCall();
    expect(url).toBe("/api/appointments");
    expect(JSON.parse(String(init.body)).reason).toBe(
      "Tamizaje corporal (Tanita) — Fecha preferida: 2026-03-01",
    );
  });
});
