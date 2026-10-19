import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssessmentResults } from "../src/app/components/assessment/AssessmentResults";
import type {
  ProductRecommendation,
  ScoringResult,
} from "../src/app/components/assessment/types";

/**
 * S1 (feature reco-consistency) — "hay url que estan rotos".
 *
 * The "Consultar precio" button used to link to `amway.es/search?q=<name>`,
 * a search that renders no results (verified: /search?q=110606 shows only the
 * cookie banner while /p/110606 serves the full product page). It must link
 * to the direct product page `amway.es/p/<reference>` instead — reference
 * based, so it cannot break when the catalog name drifts from Amway's.
 */

const PRODUCT: ProductRecommendation = {
  reference: "110606",
  name: "Nutrilite™ Cal Mag D Plus",
  category: "Complementos alimenticios — Huesos",
  size: "180 comprimidos",
  price: 29.71,
  benefits: "Calcio, magnesio y vitamina D de fuentes naturales.",
  dosage: "Tomar 3 comprimidos por día.",
  addressesNutrients: [
    { nutrientId: "calcio", nutrientName: "Calcio", status: "deficient" },
  ],
};

const RESULTS: ScoringResult[] = [
  {
    nutrientId: "calcio",
    nutrientName: "Calcio",
    nutrientType: "mineral",
    matchedWeight: 1,
    maxWeight: 9,
    ratio: 0.11,
    status: "deficient",
  },
];

function renderResults(products: ProductRecommendation[]) {
  return render(
    <AssessmentResults
      results={RESULTS}
      recommendations={RESULTS}
      productRecommendations={products}
      expandedNutrient={null}
      onToggleNutrient={() => {}}
    />,
  );
}

describe("AssessmentResults — 'Consultar precio' link", () => {
  it("links to the direct Amway product page by reference", () => {
    renderResults([PRODUCT]);
    const link = screen.getByRole("link", { name: /Consultar precio/i });
    expect(link).toHaveAttribute("href", "https://www.amway.es/p/110606");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("keeps every product on its own reference page", () => {
    renderResults([
      PRODUCT,
      {
        ...PRODUCT,
        reference: "121576",
        name: "Nutrilite™ Double X™ Multivitaminas / Multiminerales / Fitonutrientes",
      },
    ]);
    const hrefs = screen
      .getAllByRole("link", { name: /Consultar precio/i })
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "https://www.amway.es/p/110606",
      "https://www.amway.es/p/121576",
    ]);
  });

  it("renders no purchase link at all when the reference is empty (advisory R3-EmptyReference-Link)", () => {
    // An empty reference used to render `href="https://www.amway.es/p/"` — a
    // dead link to a non-product page. With no reference there is nothing to
    // link to, so the card keeps its data and drops the button entirely.
    renderResults([{ ...PRODUCT, reference: "" }]);
    expect(screen.queryByRole("link", { name: /Consultar precio/i })).toBeNull();
    // The product information itself must still be visible.
    expect(screen.getByText("Nutrilite™ Cal Mag D Plus")).toBeInTheDocument();
    expect(screen.getByText(/Tomar 3 comprimidos por día/)).toBeInTheDocument();
  });
});
