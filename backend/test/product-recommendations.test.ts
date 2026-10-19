import { describe, it, expect } from "vitest";
import {
  getProductRecommendations,
  type CatalogProduct,
  type ScoringResult,
} from "../src/services/scoring.js";

/**
 * Product-recommendation tests (feature reco-consistency, S2 + S3).
 *
 * `getProductRecommendations` used to read a BUILT-IN 3-product catalog
 * (PRODUCT_CATALOG) whose name/dosage/price drifted from the `products` table
 * the chat uses — the same client saw two different Double X doses. The
 * catalog is now a required argument (single source of truth), and the
 * nutrient→product map gains the obvious missing rows (S3):
 * glucosamina→100108, proteina_vegetal→110415, calcio/magnesio→110606 too.
 */

// ─── Fixtures ────────────────────────────────────────────────────────

/**
 * Catalog rows shaped like the `products` table. The dosage/price markers
 * deliberately differ from the old built-in catalog so a stale source fails
 * these assertions instead of passing silently.
 */
const CATALOG: CatalogProduct[] = [
  {
    reference: "100305",
    name: "Nutrilite™ Biotina C Plus",
    category: "Complementos alimenticios — Cabello y piel",
    size: "90 comprimidos",
    price: 24.04,
    benefits: "Beneficios de biotina (catálogo de prueba).",
    dosage: "BIOTINA-DOSIS-DE-PRUEBA",
  },
  {
    reference: "100930",
    name: "Nutrilite™ Multivitaminas / Minerales Masticable",
    category: "Complementos alimenticios — Multivitamínicos",
    size: "120 comprimidos",
    price: 33.18,
    benefits: "Beneficios multivitamínico (catálogo de prueba).",
    dosage: "MULTI-DOSIS-DE-PRUEBA",
  },
  {
    reference: "121576",
    name: "Nutrilite™ Double X™ Multivitaminas / Multiminerales / Fitonutrientes",
    category: "Complementos alimenticios — Multivitamínicos",
    size: "186 comprimidos",
    price: 123.45,
    benefits: "Beneficios Double X (catálogo de prueba).",
    dosage: "DOUBLE-X-DOSIS-DE-PRUEBA",
  },
  {
    reference: "110606",
    name: "Nutrilite™ Cal Mag D Plus",
    category: "Complementos alimenticios — Huesos",
    size: "180 comprimidos",
    price: 29.71,
    benefits: "Beneficios Cal Mag (catálogo de prueba).",
    dosage: "CALMAG-DOSIS-DE-PRUEBA",
  },
  {
    reference: "100108",
    name: "Nutrilite™ Glucosamina con Boswellia",
    category: "Complementos alimenticios adicionales",
    size: "60 comprimidos",
    price: 29.4,
    benefits: "Beneficios glucosamina (catálogo de prueba).",
    dosage: "GLUCOSAMINA-DOSIS-DE-PRUEBA",
  },
  {
    reference: "110415",
    name: "Nutrilite™ Proteína Vegetal",
    category: "Complementos alimenticios fundamentales",
    size: "18 sobres",
    price: 45.83,
    benefits: "Beneficios proteína (catálogo de prueba).",
    dosage: "PROTEINA-DOSIS-DE-PRUEBA",
  },
];

function res(
  nutrientId: string,
  nutrientName: string,
  status: "deficient" | "urgent",
): ScoringResult {
  return {
    nutrientId,
    nutrientName,
    nutrientType: "mineral",
    matchedWeight: 1,
    maxWeight: 2,
    ratio: 0.5,
    status,
  };
}

const refsOf = (recs: ReturnType<typeof getProductRecommendations>) =>
  recs.map((r) => r.reference);

// ─── Tests ───────────────────────────────────────────────────────────

describe("getProductRecommendations — catalog as single source (S2)", () => {
  it("takes product data from the PASSED catalog, never from a built-in one", () => {
    const recs = getProductRecommendations(
      [res("magnesio", "Magnesio", "deficient")],
      CATALOG,
    );
    const dx = recs.find((r) => r.reference === "121576");
    expect(dx).toBeDefined();
    expect(dx!.dosage).toBe("DOUBLE-X-DOSIS-DE-PRUEBA");
    expect(dx!.name).toBe(
      "Nutrilite™ Double X™ Multivitaminas / Multiminerales / Fitonutrientes",
    );
    expect(dx!.price).toBe(123.45);
  });

  it("returns NOTHING when the catalog is empty — no built-in fallback remains", () => {
    const recs = getProductRecommendations(
      [res("magnesio", "Magnesio", "urgent")],
      [],
    );
    expect(recs).toEqual([]);
  });

  it("skips a mapped reference that is absent from the catalog", () => {
    const withoutCalMag = CATALOG.filter((p) => p.reference !== "110606");
    const recs = getProductRecommendations(
      [res("calcio", "Calcio", "deficient")],
      withoutCalMag,
    );
    expect(refsOf(recs)).toEqual(["121576"]);
  });
});

describe("getProductRecommendations — obvious missing mappings (S3)", () => {
  it("maps Glucosamina con Boswellia (urgent) to 100108", () => {
    const recs = getProductRecommendations(
      [res("glucosamina_boswellia", "Glucosamina con Boswellia", "urgent")],
      CATALOG,
    );
    expect(refsOf(recs)).toContain("100108");
    const g = recs.find((r) => r.reference === "100108")!;
    expect(g.addressesNutrients.map((n) => n.nutrientId)).toContain(
      "glucosamina_boswellia",
    );
    expect(g.addressesNutrients[0].status).toBe("urgent");
  });

  it("maps Proteína 100% Vegetal (urgent) to 110415", () => {
    const recs = getProductRecommendations(
      [res("proteina_vegetal", "Proteína 100% Vegetal", "urgent")],
      CATALOG,
    );
    expect(refsOf(recs)).toContain("110415");
    const p = recs.find((r) => r.reference === "110415")!;
    expect(p.addressesNutrients.map((n) => n.nutrientId)).toContain(
      "proteina_vegetal",
    );
  });

  it("recommends Cal Mag D Plus ALONGSIDE Double X for calcium and magnesium", () => {
    const recs = getProductRecommendations(
      [
        res("calcio", "Calcio", "deficient"),
        res("magnesio", "Magnesio", "deficient"),
      ],
      CATALOG,
    );
    expect(refsOf(recs)).toContain("121576");
    expect(refsOf(recs)).toContain("110606");

    const calMag = recs.find((r) => r.reference === "110606")!;
    expect(
      calMag.addressesNutrients.map((n) => n.nutrientId).sort(),
    ).toEqual(["calcio", "magnesio"]);

    const doubleX = recs.find((r) => r.reference === "121576")!;
    expect(
      doubleX.addressesNutrients.map((n) => n.nutrientId).sort(),
    ).toEqual(["calcio", "magnesio"]);
  });

  it("keeps the existing coverage sort: Double X (3) leads, Cal Mag (2) follows", () => {
    const recs = getProductRecommendations(
      [
        res("calcio", "Calcio", "deficient"),
        res("magnesio", "Magnesio", "deficient"),
        res("vitamina_d", "Vitamina D", "deficient"),
      ],
      CATALOG,
    );
    expect(refsOf(recs)[0]).toBe("121576");
    expect(refsOf(recs)[1]).toBe("110606");
  });

  it("recommends nothing for urgent nutrients with no mapped product (Q10/Ajo/Ginseng stay empty)", () => {
    const recs = getProductRecommendations(
      [
        res("coenzima_q10", "Coenzima Q10", "urgent"),
        res("ajo", "Ajo", "deficient"),
        res("ginseng_siberiano", "Ginseng Siberiano Plus", "deficient"),
      ],
      CATALOG,
    );
    expect(recs).toEqual([]);
  });
});

describe("getProductRecommendations — wire payload stays minimal (advisory R3-Wire-Extra-Fields)", () => {
  it("never leaks row-only columns (ingredients, disclaimer) into the wire", () => {
    // The `products` table carries `ingredients` and `disclaimer`; the chat
    // card renders `disclaimer`, but the assessment wire declares neither.
    // Spreading the row used to smuggle both into calculate/save/PDF payloads.
    const rowsFromTable = [
      {
        ...CATALOG.find((p) => p.reference === "121576")!,
        ingredients: "Vitaminas, minerales y fitonutrientes.",
        disclaimer: "Complemento alimenticio. No exceder la dosis.",
      },
    ];

    const recs = getProductRecommendations(
      [res("magnesio", "Magnesio", "deficient")],
      rowsFromTable,
    );

    expect(recs).toHaveLength(1);
    expect(recs[0]).not.toHaveProperty("ingredients");
    expect(recs[0]).not.toHaveProperty("disclaimer");
    // Exactly the declared wire shape, nothing else.
    expect(Object.keys(recs[0]).sort()).toEqual(
      [
        "addressesNutrients",
        "benefits",
        "category",
        "dosage",
        "name",
        "price",
        "reference",
        "size",
      ].sort(),
    );
  });
});
