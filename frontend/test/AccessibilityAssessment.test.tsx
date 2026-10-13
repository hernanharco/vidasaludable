import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssessmentWidget } from "../src/app/components/assessment/AssessmentWidget";

/**
 * S3a — accessible-dialog contract for the prevention wizard.
 *
 * RED-first tests (feature ui-optimization, spec S3): the hand-rolled
 * motion.div modal gains role="dialog", aria-modal, focus trap, Escape to
 * close and focus restoration to the triggering control; the header close
 * button reaches a ~44px tap area; the report email input gets a real
 * accessible name.
 */

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockQuestionnaire = {
  symptoms: Array.from({ length: 13 }, (_, i) => ({
    id: i + 1,
    nameEs: `Síntoma ${i + 1}`,
  })),
  nutrients: [
    { id: "vitamina_a", name: "Vitamina A", type: "vitamin" },
    { id: "vitamina_b1", name: "Vitamina B1", type: "vitamin" },
    { id: "magnesio", name: "Magnesio", type: "mineral" },
  ],
};

const mockCalculateResponse = {
  results: [
    { nutrientId: "vitamina_a", nutrientName: "Vitamina A", nutrientType: "vitamin", matchedWeight: 1, maxWeight: 9, ratio: 0.11, status: "deficient" },
    { nutrientId: "vitamina_b1", nutrientName: "Vitamina B1", nutrientType: "vitamin", matchedWeight: 0, maxWeight: 18, ratio: 0, status: "OK" },
    { nutrientId: "magnesio", nutrientName: "Magnesio", nutrientType: "mineral", matchedWeight: 0, maxWeight: 15, ratio: 0, status: "OK" },
  ],
  recommendations: [
    { nutrientId: "vitamina_a", nutrientName: "Vitamina A", nutrientType: "vitamin", matchedWeight: 1, maxWeight: 9, ratio: 0.11, status: "deficient" },
  ],
  productRecommendations: [],
};

function setupDefaultMocks() {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/referrer/validate")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ valid: true, referrerId: 1, referrerName: "Ana Referidora" }) });
    }
    if (url.includes("/questionnaire")) {
      return Promise.resolve({ json: () => Promise.resolve(mockQuestionnaire) });
    }
    if (url.includes("/calculate")) {
      return Promise.resolve({ json: () => Promise.resolve(mockCalculateResponse) });
    }
    if (url === "/api/assessment" || url === "/assessment") {
      return Promise.resolve({ json: () => Promise.resolve({ id: "test-uuid-123", status: "completed" }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({}) });
  });
}

/**
 * Controlled harness: the trigger lives OUTSIDE the widget (the parent page
 * owns the open state), so focus restoration can be asserted against a
 * control that stays mounted across open/close cycles.
 */
function OpenHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir evaluación</button>
      <AssessmentWidget open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Traverse gate → welcome → symptoms → results (mocked endpoints). */
async function enterWizardToResults(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("Ej: 1906432239"), "12345");
  await user.click(screen.getByRole("button", { name: "Validar código" }));
  await waitFor(() => {
    expect(screen.getByText("Código válido")).toBeInTheDocument();
  });
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await waitFor(() => {
    expect(screen.getByText("Evaluación de Deficiencias")).toBeInTheDocument();
  });
  await user.type(screen.getByLabelText("Nombre"), "María");
  await user.click(screen.getByText("Femenino"));
  await user.type(screen.getByLabelText("Edad"), "35");
  await user.click(screen.getByText("Comenzar Evaluación"));
  await waitFor(() => {
    expect(screen.getByText("Paso 1 de 2")).toBeInTheDocument();
  });
  await user.click(screen.getByText("Siguiente"));
  await user.click(screen.getByText("Ver Resultados"));
  await waitFor(() => {
    expect(screen.getByText("PDF")).toBeInTheDocument();
  });
}

describe("Assessment dialog accessibility (S3a)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("exposes the wizard as a modal dialog named by its title", async () => {
    const user = userEvent.setup();
    render(<OpenHarness />);
    await user.click(screen.getByRole("button", { name: "Abrir evaluación" }));

    const dialog = screen.getByRole("dialog", { name: "Evaluación de Prevención" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("closes on Escape and restores focus to the control that opened it", async () => {
    const user = userEvent.setup();
    render(<OpenHarness />);
    const trigger = screen.getByRole("button", { name: "Abrir evaluación" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the header close button at a ~44px tap area (p-3 around a 20px icon)", () => {
    render(<AssessmentWidget open={true} onClose={vi.fn()} />);
    const close = screen.getByRole("button", { name: "Cerrar evaluación" });
    // jsdom has no layout: the proportionate structural check is the class
    // that sizes the tap area (20px icon + 2×12px padding = 44×44px).
    expect(close.className).toMatch(/\bp-3\b/);
  });

  it("names the report email input accessibly", async () => {
    const user = userEvent.setup();
    render(<AssessmentWidget open={true} onClose={vi.fn()} />);
    await enterWizardToResults(user);

    expect(
      screen.getByRole("textbox", { name: /email para recibir el reporte/i }),
    ).toBeInTheDocument();
  });
});
