import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssessmentWidget } from "../src/app/components/assessment/AssessmentWidget";

// Mock fetch
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
  // Required by CalculateResponse (types.ts) and read by AssessmentResults
  // (productRecommendations.length > 0) — must be an array, not undefined.
  productRecommendations: [],
};

// Access-code gate: POST /api/referrer/validate → { valid, referrerId, referrerName }
const mockReferrerValidateResponse = {
  valid: true,
  referrerId: 1,
  referrerName: "Ana Referidora",
};

function setupDefaultMocks() {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/referrer/validate")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockReferrerValidateResponse) });
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

async function waitForLoadingToFinish() {
  await waitFor(() => {
    expect(screen.queryByText(/Cargando/i)).not.toBeInTheDocument();
  }, { timeout: 3000 });
}

/**
 * Traverse the access-code gate (AssessmentWidget starts in phase "access_code").
 * Types a code, submits POST /api/referrer/validate (mocked in setupDefaultMocks),
 * confirms via "Continuar", and waits for the questionnaire to load (phase
 * "welcome" → AssessmentWelcome heading).
 */
async function enterAccessCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("Ej: 1906432239"), "12345");
  await user.click(screen.getByText("Validar código"));
  await waitFor(() => {
    expect(screen.getByText("Código válido")).toBeInTheDocument();
  });
  await user.click(screen.getByText("Continuar"));
  await waitFor(() => {
    expect(screen.getByText("Evaluación de Deficiencias")).toBeInTheDocument();
  });
}

describe("AssessmentWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("renders the floating button", async () => {
    render(<AssessmentWidget />);
    expect(screen.getByText("Prevenición")).toBeInTheDocument();
  });

  it("opens the modal when clicked", async () => {
    const user = userEvent.setup();
    render(<AssessmentWidget />);
    await user.click(screen.getByText("Prevenición"));
    expect(screen.getByText("Evaluación de Prevención")).toBeInTheDocument();
  });

  it("shows patient form after loading", async () => {
    const user = userEvent.setup();
    render(<AssessmentWidget />);
    await user.click(screen.getByText("Prevenición"));
    await enterAccessCode(user);
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
  });

  it("disables start button when form is incomplete", async () => {
    const user = userEvent.setup();
    render(<AssessmentWidget />);
    await user.click(screen.getByText("Prevenición"));
    await enterAccessCode(user);
    expect(screen.getByText("Comenzar Evaluación")).toBeDisabled();
  });

  it("enables start button when form is complete", async () => {
    const user = userEvent.setup();
    render(<AssessmentWidget />);
    await user.click(screen.getByText("Prevenición"));
    await enterAccessCode(user);
    await user.type(screen.getByLabelText("Nombre"), "María");
    await user.click(screen.getByText("Femenino"));
    await user.type(screen.getByLabelText("Edad"), "35");
    expect(screen.getByText("Comenzar Evaluación")).not.toBeDisabled();
  });

  it("shows symptoms after clicking start", async () => {
    const user = userEvent.setup();
    render(<AssessmentWidget />);
    await user.click(screen.getByText("Prevenición"));
    await enterAccessCode(user);
    await user.type(screen.getByLabelText("Nombre"), "María");
    await user.click(screen.getByText("Femenino"));
    await user.type(screen.getByLabelText("Edad"), "35");
    await user.click(screen.getByText("Comenzar Evaluación"));
    await waitFor(() => {
      expect(screen.getByText("Paso 1 de 2")).toBeInTheDocument();
    });
    expect(screen.getByText("Síntoma 1")).toBeInTheDocument();
  });

  it("navigates between steps", async () => {
    const user = userEvent.setup();
    render(<AssessmentWidget />);
    await user.click(screen.getByText("Prevenición"));
    await enterAccessCode(user);
    await user.type(screen.getByLabelText("Nombre"), "María");
    await user.click(screen.getByText("Femenino"));
    await user.type(screen.getByLabelText("Edad"), "35");
    await user.click(screen.getByText("Comenzar Evaluación"));
    await waitFor(() => {
      expect(screen.getByText("Paso 1 de 2")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Siguiente"));
    expect(screen.getByText("Paso 2 de 2")).toBeInTheDocument();
    await user.click(screen.getByText("Anterior"));
    expect(screen.getByText("Paso 1 de 2")).toBeInTheDocument();
  });

  it("shows results after calculation", async () => {
    const user = userEvent.setup();
    render(<AssessmentWidget />);
    await user.click(screen.getByText("Prevenición"));
    await enterAccessCode(user);
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
      expect(screen.getByText("Recomendaciones")).toBeInTheDocument();
    });
  });

  it("shows summary cards", async () => {
    const user = userEvent.setup();
    render(<AssessmentWidget />);
    await user.click(screen.getByText("Prevenición"));
    await enterAccessCode(user);
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
  });
});
