/**
 * Scoring engine — calculates nutrient deficiency from symptom responses.
 *
 * Implements the exact logic from the Excel "Cálculo patologias_v6":
 *   ratio = matchedWeight / maxWeight
 *   ratio == 0        → "OK"
 *   0 < ratio < 0.3   → "deficient"
 *   ratio >= 0.3      → "urgent"
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface SymptomMapping {
  symptomId: number;
  nameEs: string;
  weight: number; // 1 or 2
}

export interface NutrientMapping {
  nutrientId: string;
  nutrientName: string;
  nutrientType: "vitamin" | "mineral" | "fatty_acid" | "supplement";
  symptoms: SymptomMapping[];
}

export interface ScoringResult {
  nutrientId: string;
  nutrientName: string;
  nutrientType: string;
  matchedWeight: number;
  maxWeight: number;
  ratio: number;
  status: "OK" | "deficient" | "urgent";
}

export interface Recommendation extends ScoringResult {
  matchedSymptoms: Array<{
    symptomId: number;
    nameEs: string;
    weight: number;
  }>;
}

// ─── Scoring ─────────────────────────────────────────────────────────

/**
 * Calculate the deficiency status for a single nutrient based on
 * the user's symptom responses.
 *
 * @param mapping - The nutrient's symptom mapping (from the Excel)
 * @param responses - Map of symptomId → answered (true = SI)
 * @returns Scoring result with ratio and status classification
 */
export function calculateNutrientStatus(
  mapping: NutrientMapping,
  responses: Map<number, boolean>,
): ScoringResult {
  const maxWeight = mapping.symptoms.reduce((sum, s) => sum + s.weight, 0);

  const matchedWeight = mapping.symptoms
    .filter((s) => responses.get(s.symptomId) === true)
    .reduce((sum, s) => sum + s.weight, 0);

  const ratio = maxWeight > 0 ? matchedWeight / maxWeight : 0;

  let status: ScoringResult["status"];
  if (ratio === 0) {
    status = "OK";
  } else if (ratio < 0.3) {
    status = "deficient";
  } else {
    status = "urgent";
  }

  return {
    nutrientId: mapping.nutrientId,
    nutrientName: mapping.nutrientName,
    nutrientType: mapping.nutrientType,
    matchedWeight,
    maxWeight,
    ratio,
    status,
  };
}

/**
 * Calculate deficiency status for all nutrients based on the user's
 * complete symptom responses.
 *
 * @param responses - Map of symptomId → answered (true = SI)
 * @param mappings - Array of all nutrient mappings
 * @returns Array of scoring results, one per nutrient
 */
export function calculateAllNutrients(
  responses: Map<number, boolean>,
  mappings: NutrientMapping[],
): ScoringResult[] {
  return mappings.map((mapping) => calculateNutrientStatus(mapping, responses));
}

/**
 * Filter and sort scoring results to produce actionable recommendations.
 * Returns only deficient/urgent nutrients, sorted by urgency.
 *
 * @param results - Results from calculateAllNutrients
 * @returns Filtered and sorted recommendations
 */
export function getRecommendations(results: ScoringResult[]): ScoringResult[] {
  return results
    .filter((r) => r.status !== "OK")
    .sort((a, b) => {
      // Urgent first, then deficient
      if (a.status === "urgent" && b.status !== "urgent") return -1;
      if (a.status !== "urgent" && b.status === "urgent") return 1;
      // Within same status, sort by ratio descending
      return b.ratio - a.ratio;
    });
}

// ─── Product Recommendations ────────────────────────────────────────

export interface AddressedNutrient {
  nutrientId: string;
  nutrientName: string;
  status: "deficient" | "urgent";
}

export interface ProductRecommendation {
  reference: string;
  name: string;
  category: string;
  size: string;
  price: number;
  benefits: string;
  dosage: string;
  addressesNutrients: AddressedNutrient[];
}

/** Maps each nutrient ID to the product references that supplement it. */
const NUTRIENT_PRODUCT_MAP: Record<string, string[]> = {
  // Biotina C Plus
  biotina: ["100305"],
  vitamina_c: ["100305", "121576"],

  // Multivitaminas Masticable
  vitamina_a: ["100930", "121576"],
  vitamina_b1: ["100930", "121576"],
  vitamina_b2: ["100930", "121576"],
  vitamina_b3: ["100930", "121576"],
  vitamina_b6: ["100930", "121576"],
  vitamina_b12: ["100930", "121576"],
  vitamina_d: ["100930", "121576"],
  vitamina_e: ["100930", "121576"],
  acido_folico: ["100930", "121576"],

  // Double X — minerals
  calcio: ["121576"],
  magnesio: ["121576"],
  zinc: ["121576"],
  selenio: ["121576"],
  cromo: ["121576"],
  manganesio: ["121576"],
  ferro: ["121576"],
};

/** Static product catalog (only complete products from curatedProducts.ts). */
const PRODUCT_CATALOG: Record<
  string,
  Omit<ProductRecommendation, "addressesNutrients">
> = {
  "100305": {
    reference: "100305",
    name: "Nutrilite™ Biotina C Plus",
    category: "Cabello y piel",
    size: "90 comprimidos",
    price: 24.04,
    benefits:
      "Mantiene cabello y piel sanos. Aporta protección antioxidante contra el daño de los radicales libres.",
    dosage: "2 comprimidos al día, preferiblemente con las comidas.",
  },
  "100930": {
    reference: "100930",
    name: "Nutrilite™ Multivitaminas Masticable",
    category: "Multivitamínicos",
    size: "120 comprimidos",
    price: 33.18,
    benefits:
      "Cubre vacíos nutricionales con vitaminas, minerales y betacaroteno. Sabor a naranja, ideal para toda la familia.",
    dosage:
      "Masticar 2 comprimidos al día con las comidas.",
  },
  "121576": {
    reference: "121576",
    name: "Nutrilite™ Double X",
    category: "Multivitamínicos / Multiminerales / Fitonutrientes",
    size: "186 comprimidos",
    price: 72.39,
    benefits:
      "Cobertura completa de vitaminas, minerales y fitonutrientes con extractos botánicos concentrados.",
    dosage:
      "Tomar 2 tabletas amarillas, 1 tableta naranja y 1 tableta verde dos veces al día con las comidas.",
  },
};

/**
 * Build product recommendations based on deficient/urgent nutrients.
 *
 * Filters results for non-OK statuses, maps each to products via
 * NUTRIENT_PRODUCT_MAP, deduplicates products, and returns them
 * sorted by how many deficiencies they address (most first).
 */
export function getProductRecommendations(
  results: ScoringResult[],
): ProductRecommendation[] {
  const deficient = results.filter((r) => r.status !== "OK");
  if (deficient.length === 0) return [];

  // Accumulate addressed nutrients per product reference
  const productNutrients = new Map<string, AddressedNutrient[]>();

  for (const r of deficient) {
    const refs = NUTRIENT_PRODUCT_MAP[r.nutrientId];
    if (!refs) continue;

    for (const ref of refs) {
      if (!productNutrients.has(ref)) {
        productNutrients.set(ref, []);
      }
      productNutrients.get(ref)!.push({
        nutrientId: r.nutrientId,
        nutrientName: r.nutrientName,
        status: r.status as "deficient" | "urgent",
      });
    }
  }

  // Build recommendations, skip products with no catalog entry
  const recommendations: ProductRecommendation[] = [];

  for (const [ref, nutrients] of productNutrients) {
    const catalog = PRODUCT_CATALOG[ref];
    if (!catalog) continue;

    recommendations.push({
      ...catalog,
      addressesNutrients: nutrients,
    });
  }

  // Sort by coverage: most deficiencies addressed first,
  // then by number of urgent nutrients (more urgent = higher)
  recommendations.sort((a, b) => {
    const coverageDiff =
      b.addressesNutrients.length - a.addressesNutrients.length;
    if (coverageDiff !== 0) return coverageDiff;

    const urgentA = a.addressesNutrients.filter(
      (n) => n.status === "urgent",
    ).length;
    const urgentB = b.addressesNutrients.filter(
      (n) => n.status === "urgent",
    ).length;
    return urgentB - urgentA;
  });

  return recommendations;
}
