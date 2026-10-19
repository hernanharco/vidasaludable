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

/**
 * One catalog row as the caller supplies it — the `products` table shape
 * (see db/schema.ts). There is deliberately NO built-in catalog here anymore:
 * the assessment flow and the chat must share the same single source of
 * truth, otherwise the same client sees two different product names/doses
 * (feature reco-consistency, S2).
 */
export type CatalogProduct = Omit<ProductRecommendation, "addressesNutrients">;

/**
 * Maps each nutrient ID to the product references that supplement it.
 * Ownership note (reco-consistency S3): rows marked [S3] are the obvious
 * direct matches added so urgent nutrients stop rendering empty; everything
 * else is untouched.
 */
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
  // [S3] Cal Mag D Plus also covers these two; Double X keeps its row first
  // (the coverage sort still leads with whichever product addresses more).
  calcio: ["121576", "110606"],
  magnesio: ["121576", "110606"],
  zinc: ["121576"],
  selenio: ["121576"],
  cromo: ["121576"],
  manganesio: ["121576"],
  ferro: ["121576"],

  // [S3] direct catalog matches that previously rendered empty.
  glucosamina_boswellia: ["100108"],
  proteina_vegetal: ["110415"],
};

/**
 * Build product recommendations based on deficient/urgent nutrients.
 *
 * Filters results for non-OK statuses, maps each to products via
 * NUTRIENT_PRODUCT_MAP, deduplicates products, and returns them
 * sorted by how many deficiencies they address (most first).
 *
 * `catalog` is REQUIRED and is the caller's copy of the `products` table
 * (reco-consistency S2): a mapped reference absent from it is skipped, so an
 * empty table yields `[]` instead of falling back to stale hard-coded data.
 */
export function getProductRecommendations(
  results: ScoringResult[],
  catalog: CatalogProduct[],
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

  // Build recommendations, skipping mapped refs the caller's catalog lacks.
  // Index the supplied rows once: lookup stays O(1) per ref and the
  // caller-owned `products` copy is the ONLY source (no built-in fallback).
  const byReference = new Map(catalog.map((p) => [p.reference, p]));
  const recommendations: ProductRecommendation[] = [];

  for (const [ref, nutrients] of productNutrients) {
    const product = byReference.get(ref);
    if (!product) continue;

    // Pick the declared wire fields explicitly (advisory R3-Wire-Extra-Fields):
    // the `products` row also carries `ingredients`/`disclaimer`, which the
    // assessment wire does NOT declare. Spreading the row smuggled them into
    // the calculate/save/PDF payloads; a fresh object keeps the payload
    // exactly the shape the frontend types describe.
    recommendations.push({
      reference: product.reference,
      name: product.name,
      category: product.category,
      size: product.size,
      price: product.price,
      benefits: product.benefits,
      dosage: product.dosage,
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
