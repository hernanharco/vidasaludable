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
