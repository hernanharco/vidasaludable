import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { AssessmentWidget } from "../src/app/components/assessment/AssessmentWidget";

// T6c (tamizaje-images discovery, L7 channel 3: Assessment results) —
// contextual results-phase CTA for the in-person body-composition screening:
//
// 1. the card copy ("¿Querés medir tu composición corporal en persona?")
//    shows ONLY in the results phase, next to the PDF/email actions;
// 2. with a stored `vr_customer_id` the CTA opens the SAME appointment
//    dialog the chat uses (CitaAppointmentButton extracted from ChatMessages)
//    and POSTs /api/assistant/appointments {customer_id, reason};
// 3. WITHOUT an identity the CTA is a link to the landing booking form
//    (/#booking, where T6a added the tamizaje motive) and never POSTs;
// 4. the assessment dialog STAYS open behind the nested cita dialog
//    (chosen behavior: cancelling returns to the results with no state loss).
//
// sonner is mocked — the toast CALL is the contract (ChatTamizaje style).
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockQuestionnaire = {
  symptoms: Array.from({ length: 13 }, (_, i) => ({
    id: i + 1,
    nameEs: `Síntoma ${i + 1}`,
  })),
  nutrients: [{ id: "vitamina_a", name: "Vitamina A", type: "vitamin" }],
};

const mockCalculateResponse = {
  results: [
    {
      nutrientId: "vitamina_a",
      nutrientName: "Vitamina A",
      nutrientType: "vitamin",
      matchedWeight: 1,
      maxWeight: 9,
      ratio: 0.11,
      status: "deficient",
    },
  ],
  recommendations: [
    {
      nutrientId: "vitamina_a",
      nutrientName: "Vitamina A",
      nutrientType: "vitamin",
      matchedWeight: 1,
      maxWeight: 9,
      ratio: 0.11,
      status: "deficient",
    },
  ],
  productRecommendations: [],
};

// jsdom under vitest runs with an opaque origin — in-memory localStorage
// stand-in (AssessmentWidget.test.tsx / ChatTamizaje.test.tsx style).
function installMemoryLocalStorage() {
  const store = new Map<string, string>();
  const impl = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: impl });
}

installMemoryLocalStorage();

const CUSTOMER_ID = 42;

/** Bodies of the T6c appointments POST, reset per test. */
let appointmentPosts: Array<Record<string, unknown>> = [];

function installFetch() {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    const ok = (body: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (u.includes("/questionnaire")) return ok(mockQuestionnaire);
    if (u.includes("/calculate")) return ok(mockCalculateResponse);
    if (u === "/api/assessment" && init?.method === "POST") {
      return ok({ id: "test-uuid-123", status: "completed" });
    }
    if (u.includes("/api/assistant/appointments") && init?.method === "POST") {
      appointmentPosts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return ok({ appointment: { id: 1, status: "pendiente" } });
    }
    return ok({});
  });
}

/**
 * Access-code-once boot: a stored validated referrer skips the gate, so the
 * wizard lands on the welcome step. Walks welcome → symptoms → results.
 */
async function reachResults(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Evaluación de Deficiencias");
  await user.type(screen.getByLabelText("Nombre"), "María");
  await user.click(screen.getByText("Femenino"));
  await user.type(screen.getByLabelText("Edad"), "35");
  await user.click(screen.getByText("Comenzar Evaluación"));
  await screen.findByText("Paso 1 de 2");
  await user.click(screen.getByText("Siguiente"));
  await user.click(screen.getByText("Ver Resultados"));
  await screen.findByText("PDF");
}

function renderWidget() {
  const onClose = vi.fn();
  const result = render(<AssessmentWidget open={true} onClose={onClose} />);
  return { ...result, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  appointmentPosts = [];
  // Validated referrer already stored → the access-code gate is skipped.
  window.localStorage.setItem("vr_referrer_id", "1");
  window.localStorage.setItem("vr_referrer_name", "Referente Test");
  installFetch();
});

describe("assessment results tamizaje CTA (T6c)", () => {
  it("shows the contextual in-person screening copy ONLY in the results phase", async () => {
    const user = userEvent.setup();
    renderWidget();

    // Welcome phase: no offer yet (the CTA is results-only).
    await screen.findByText("Evaluación de Deficiencias");
    expect(
      screen.queryByText(/¿Querés medir tu composición corporal en persona\?/),
    ).not.toBeInTheDocument();

    await reachResults(user);
    expect(
      screen.getByText("¿Querés medir tu composición corporal en persona?"),
    ).toBeInTheDocument();
    // It sits next to the existing PDF/email actions (same footer).
    expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /email para recibir el reporte/i }),
    ).toBeInTheDocument();
  });

  it("with a stored identity opens the shared appointment dialog, prefilled, and POSTs {customer_id, reason}", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    const user = userEvent.setup();
    const { onClose } = renderWidget();
    await reachResults(user);

    // Identity branch: the chat's shared button (a BUTTON, not a link).
    const cta = screen.getByRole("button", { name: /Solicitar cita para tamizaje/ });
    expect(cta).toBeEnabled();
    expect(
      screen.queryByRole("link", { name: /Solicitar cita para tamizaje/ }),
    ).not.toBeInTheDocument();

    await user.click(cta);

    // Nested cita dialog (assessment stays open underneath).
    const dialogs = await screen.findAllByRole("dialog");
    const citaDialog = dialogs.find((d) =>
      within(d).queryByRole("button", { name: "Confirmar" }),
    );
    expect(citaDialog).toBeDefined();
    const reason = within(citaDialog as HTMLElement).getByRole("textbox", {
      name: "Motivo",
    });
    expect(reason).toHaveValue("Quiero agendar un tamizaje");

    await user.clear(reason);
    await user.type(reason, "Quiero medir mi grasa corporal");
    await user.click(
      within(citaDialog as HTMLElement).getByRole("button", { name: "Confirmar" }),
    );

    await waitFor(() =>
      expect(appointmentPosts).toEqual([
        { customer_id: CUSTOMER_ID, reason: "Quiero medir mi grasa corporal" },
      ]),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Solicitud de cita enviada"),
    );
    expect(toast.error).not.toHaveBeenCalled();

    // Confirmed state replaces the CTA button; the assessment dialog stays
    // open (chosen behavior — cancelling/finishing returns to the results).
    expect(await screen.findByText("Solicitud enviada")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Solicitar cita para tamizaje/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Evaluación de Prevención" }),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("without an identity the CTA links to the landing /#booking form and never POSTs", async () => {
    const user = userEvent.setup();
    const { onClose } = renderWidget();
    await reachResults(user);

    const link = screen.getByRole("link", { name: /Solicitar cita para tamizaje/ });
    expect(link).toHaveAttribute("href", "/#booking");
    expect(
      screen.queryByRole("button", { name: /Solicitar cita para tamizaje/ }),
    ).not.toBeInTheDocument();

    // No dialog, no appointment request from the link branch.
    expect(screen.queryByRole("textbox", { name: "Motivo" })).not.toBeInTheDocument();
    expect(appointmentPosts).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("triangulate: a corrupt stored identity degrades to the #booking link, never a dead dialog", async () => {
    // Same read contract as ChatSession's readStoredNumber: a non-integer
    // key is NO identity — a dialog that could only 400/404 would be worse
    // than the landing form.
    window.localStorage.setItem("vr_customer_id", "not-a-number");
    const user = userEvent.setup();
    renderWidget();
    await reachResults(user);

    expect(
      screen.getByRole("link", { name: /Solicitar cita para tamizaje/ }),
    ).toHaveAttribute("href", "/#booking");
    expect(
      screen.queryByRole("button", { name: /Solicitar cita para tamizaje/ }),
    ).not.toBeInTheDocument();
    expect(appointmentPosts).toHaveLength(0);
  });
});
