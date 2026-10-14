import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { CustomerDetailPage } from "../src/app/admin/CustomerDetailPage";
import type {
  Conversation,
  Customer,
  CustomerSummary,
  Product,
  Purchase,
  Recommendation,
} from "../src/app/admin/api";

// Same harness style as VideosPage.test.tsx: the real admin api client runs
// on top of a mocked fetch, so URL/method assertions cover the page → api →
// wire contract end to end (including api.getCustomerSummary /
// api.generateCustomerSummary).
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

const STORED_SUMMARY: CustomerSummary = {
  customerId: 1,
  content:
    "## Qué consulta\nDolor de rodilla al caminar.\n\n## Siguiente paso sugerido\nAgendar valoración.",
  model: "gemini-test",
  generatedAt: "2025-02-01T12:00:00Z",
};

const NEW_SUMMARY: CustomerSummary = {
  customerId: 1,
  content: "## Qué consulta\nResumen regenerado del cliente.",
  model: "gemini-test",
  generatedAt: "2025-02-02T09:30:00Z",
};

const RECOMMENDATIONS: Recommendation[] = [
  {
    id: 11,
    conversationId: 5,
    customerId: 1,
    symptom: "Dolor articular",
    productReferences: '["VIT-D","MAG"]',
    rationale: "Apoyo nutricional",
    consentVersion: 1,
    guardBlocked: false,
    createdAt: "2025-01-10T09:00:00Z",
  },
  {
    id: 12,
    conversationId: 6,
    customerId: 2,
    symptom: "Fatiga de otro cliente",
    productReferences: '["OMEGA"]',
    rationale: "Otro cliente",
    consentVersion: 1,
    guardBlocked: false,
    createdAt: "2025-02-02T09:00:00Z",
  },
];

const PURCHASES: Purchase[] = [
  {
    id: 21,
    customerId: 1,
    productReference: "VIT-D",
    qty: 2,
    purchasedAt: "2025-01-15T09:00:00Z",
  },
  {
    id: 22,
    customerId: 2,
    productReference: "OTRO",
    qty: 9,
    purchasedAt: "2025-02-03T09:00:00Z",
  },
];

const CONVERSATIONS: Conversation[] = [
  { id: 5, customerId: 1, createdAt: "2025-01-12T09:00:00Z" },
  { id: 6, customerId: 2, createdAt: "2025-02-03T09:00:00Z" },
];

const PRODUCTS: Product[] = [
  {
    reference: "VIT-D",
    name: "Vitamina D3 2000 UI",
    category: "Nutrición",
    size: "120 cápsulas",
    price: 25.5,
    benefits: "Salud ósea",
    dosage: "1 cápsula/día",
    ingredients: "Vitamina D3",
    disclaimer: "Complemento alimenticio",
  },
  {
    reference: "MAG",
    name: "Magnesio Plus",
    category: "Nutrición",
    size: "90 comprimidos",
    price: 19.9,
    benefits: "Descanso",
    dosage: "1 comprimido/día",
    ingredients: "Magnesio",
    disclaimer: "Complemento alimenticio",
  },
];

let summaryState: CustomerSummary | null;
let customersFail: boolean;
let deferGenerate: boolean;
let resolveGenerate: (() => void) | null;

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
      return customersFail ? bad(500, { error: "boom" }) : ok(200, { customers: CUSTOMERS });
    }
    const summaryRoute = url.match(/^\/api\/admin\/customers\/(\d+)\/summary$/);
    if (summaryRoute && method === "GET") {
      const cid = Number(summaryRoute[1]);
      return ok(200, { summary: cid === 1 ? summaryState : null });
    }
    if (summaryRoute && method === "POST") {
      const cid = Number(summaryRoute[1]);
      if (cid !== 1) return bad(404, { error: "cliente_no_encontrado" });
      if (deferGenerate) {
        return new Promise((resolve) => {
          resolveGenerate = () => resolve(ok(200, { summary: NEW_SUMMARY }));
        });
      }
      summaryState = NEW_SUMMARY;
      return ok(200, { summary: NEW_SUMMARY });
    }
    if (url === "/api/admin/recommendations" && method === "GET") {
      return ok(200, { recommendations: RECOMMENDATIONS });
    }
    if (url === "/api/admin/purchases" && method === "GET") {
      return ok(200, { purchases: PURCHASES });
    }
    if (url === "/api/admin/conversations" && method === "GET") {
      return ok(200, { conversations: CONVERSATIONS });
    }
    if (url === "/api/admin/catalog" && method === "GET") {
      return ok(200, { products: PRODUCTS });
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

describe("CustomerDetailPage (ficha + resumen de asesoría)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    summaryState = null;
    customersFail = false;
    deferGenerate = false;
    resolveGenerate = null;
    installFetchMock();
  });

  it("renders customer data and the empty summary state with the Generar resumen button", async () => {
    renderPage();

    // Header: name, email, phone, registration date
    expect(await screen.findByText("María López")).toBeInTheDocument();
    expect(screen.getByText("maria@example.com")).toBeInTheDocument();
    expect(screen.getByText("+34 600 111 222")).toBeInTheDocument();
    expect(screen.getByText(/Registrado el/)).toHaveTextContent(
      `Registrado el ${new Date(CUSTOMERS[0]!.registeredAt).toLocaleString()}`,
    );

    // Empty summary state: short explanation + demand-driven button
    expect(screen.getByText(/Se genera bajo demanda/)).toBeInTheDocument();
    const generateBtn = screen.getByRole("button", { name: "Generar resumen" });
    expect(generateBtn).toBeEnabled();
    expect(screen.queryByText("Resumen de asesoría")).not.toBeInTheDocument();

    // The customer list is the only lookup (no single-customer endpoint)
    expect(
      mockFetch.mock.calls.some(([url]) => url === "/api/admin/customers"),
    ).toBe(true);
    expect(
      mockFetch.mock.calls.some(
        ([url, init]) =>
          url === "/api/admin/customers/1/summary" &&
          (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);
  });

  it("renders a stored summary with content and date, and Regenerar POSTs and renders the new content", async () => {
    const user = userEvent.setup();
    summaryState = STORED_SUMMARY;
    renderPage();

    expect(await screen.findByText("Resumen de asesoría")).toBeInTheDocument();
    // "Generado el <fecha local>" (+ model chip)
    expect(screen.getByText(/Generado el/)).toHaveTextContent(
      `Generado el ${new Date(STORED_SUMMARY.generatedAt).toLocaleString()}`,
    );
    // Content rendered as text; "## " marker stripped into a styled heading
    expect(screen.getByText("Qué consulta")).toBeInTheDocument();
    expect(screen.queryByText(/## Qué consulta/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Dolor de rodilla al caminar."),
    ).toBeInTheDocument();
    expect(screen.getByText("Agendar valoración.")).toBeInTheDocument();

    // Regenerate with a pending POST: button disabled + generating label
    deferGenerate = true;
    await user.click(screen.getByRole("button", { name: "Regenerar" }));

    const pendingBtn = await screen.findByRole("button", {
      name: "Generando… (puede tardar unos segundos)",
    });
    expect(pendingBtn).toBeDisabled();
    const post = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/admin/customers/1/summary" &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(post).toBeDefined();

    // Resolve the POST → new summary replaces the old one
    await act(async () => {
      resolveGenerate?.();
    });
    expect(
      await screen.findByText("Resumen regenerado del cliente."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Dolor de rodilla al caminar."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Regenerar" }),
    ).toBeEnabled();
  });

  it("renders the extras sections filtered by customerId", async () => {
    renderPage();

    // Recommendations: symptom + product NAMES linked to amway + date, only customer 1
    expect(await screen.findByText("Dolor articular")).toBeInTheDocument();
    const vitLink = screen.getByRole("link", { name: "Vitamina D3 2000 UI (VIT-D)" });
    expect(vitLink).toHaveAttribute(
      "href",
      "https://www.amway.es/Productos/c/100000?q=VIT-D",
    );
    const magLink = screen.getByRole("link", { name: "Magnesio Plus (MAG)" });
    expect(magLink).toHaveAttribute(
      "href",
      "https://www.amway.es/Productos/c/100000?q=MAG",
    );
    expect(
      screen.getByText(new Date(RECOMMENDATIONS[0]!.createdAt).toLocaleString()),
    ).toBeInTheDocument();
    expect(screen.queryByText("Fatiga de otro cliente")).not.toBeInTheDocument();

    // Purchases: product + qty + date, only customer 1
    const purchaseRow = screen.getByText(/Cantidad: 2/).closest("li");
    expect(purchaseRow).not.toBeNull();
    expect(purchaseRow as HTMLElement).toHaveTextContent("VIT-D");
    expect(
      within(purchaseRow as HTMLElement).getByText(
        new Date(PURCHASES[0]!.purchasedAt).toLocaleString(),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Cantidad: 9/)).not.toBeInTheDocument();

    // Conversations: linked to the conversation detail route, only customer 1
    const convLink = screen.getByRole("link", { name: "Conversación #5" });
    expect(convLink).toHaveAttribute("href", "/admin/conversations/5");
    expect(
      screen.queryByRole("link", { name: "Conversación #6" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(new Date(CONVERSATIONS[0]!.createdAt).toLocaleString()),
    ).toBeInTheDocument();
  });

  it("shows the ErrorBanner when the customer load fails", async () => {
    customersFail = true;
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("No pudimos cargar los datos")).toBeInTheDocument();
    expect(screen.queryByText("María López")).not.toBeInTheDocument();
  });

  it("shows a not-found empty state for an unknown customer id", async () => {
    renderPage(999);

    expect(await screen.findByText("Cliente no encontrado")).toBeInTheDocument();
    expect(screen.getByText(/No hay ningún cliente con id 999/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Generar resumen" }),
    ).not.toBeInTheDocument();
    // Back link still available
    expect(
      screen.getByRole("link", { name: /Volver a clientes/ }),
    ).toHaveAttribute("href", "/admin/customers");
  });
});
