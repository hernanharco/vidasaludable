import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { RecommendationsPage } from "../src/app/admin/RecommendationsPage";
import type { Product, Recommendation } from "../src/app/admin/api";

// Real api client on top of a mocked fetch (CustomerDetail.test.tsx harness
// style): covers page → api → wire for the catalog join behind product names.
const mockFetch = vi.fn();
global.fetch = mockFetch;

const RECOMMENDATIONS: Recommendation[] = [
  {
    id: 1,
    conversationId: 5,
    customerId: 1,
    symptom: "Estrés y mal descanso",
    productReferences: '["VIT-D","SIN-FICHA"]',
    rationale: "Apoyo nutricional",
    consentVersion: 1,
    guardBlocked: false,
    createdAt: "2025-01-10T09:00:00Z",
  },
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
];

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

describe("RecommendationsPage (nombres y links de productos)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/admin/recommendations") return ok({ recommendations: RECOMMENDATIONS });
      if (url === "/api/admin/catalog") return ok({ products: PRODUCTS });
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: `unmocked ${url}` }),
      });
    });
  });

  it("shows the catalog product name linked to amway and falls back to the bare code", async () => {
    render(<RecommendationsPage />);

    // Catalog name + code as one link, pointing at the amway.es search by ref
    const known = await screen.findByRole("link", {
      name: "Vitamina D3 2000 UI (VIT-D)",
    });
    expect(known).toHaveAttribute(
      "href",
      "https://www.amway.es/Productos/c/100000?q=VIT-D",
    );

    // Unknown reference: bare code, still linked to amway
    const unknown = screen.getByRole("link", { name: "SIN-FICHA" });
    expect(unknown).toHaveAttribute(
      "href",
      "https://www.amway.es/Productos/c/100000?q=SIN-FICHA",
    );
  });
});
