import { describe, it, expect, beforeAll } from "vitest";
import {
  calculateNutrientStatus,
  calculateAllNutrients,
  getRecommendations,
  type NutrientMapping,
  type ScoringResult,
} from "../src/services/scoring.js";

/**
 * Scoring engine tests — validates against the Excel "Cálculo patologias_v6".
 *
 * Key facts from the Excel:
 * - 95 symptoms, 31 nutrients
 * - Each nutrient has 1-18 mapped symptoms with weights (1 or 2)
 * - ratio = matchedWeight / maxWeight
 * - ratio == 0 → "OK", 0 < ratio < 0.3 → "deficient", ratio >= 0.3 → "urgent"
 *
 * Test data extracted from the Excel's "Base de Dados" sheet.
 */

// ─── Test fixtures ───────────────────────────────────────────────────

/** Vitamina A mapping: 9 symptoms, some with weight=2 */
const vitaminaA: NutrientMapping = {
  nutrientId: "vitamina_a",
  nutrientName: "Vitamina A",
  nutrientType: "vitamin",
  symptoms: [
    { symptomId: 1, nameEs: "Acné", weight: 1 },
    { symptomId: 2, nameEs: "Aftas o cistitis", weight: 1 },
    { symptomId: 14, nameEs: "Caspa", weight: 1 },
    { symptomId: 21, nameEs: "Dermatitis", weight: 1 },
    { symptomId: 48, nameEs: "Infecciones frecuentes", weight: 1 },
    { symptomId: 75, nameEs: "Ojos secos", weight: 1 },
    { symptomId: 76, nameEs: "Ojos hinchados, con ardor o con sensación de arena", weight: 2 },
    { symptomId: 95, nameEs: "Mala visión nocturna", weight: 1 },
  ],
};

/** Vitamina B1 mapping: 18 symptoms (most of any nutrient) */
const vitaminaB1: NutrientMapping = {
  nutrientId: "vitamina_b1",
  nutrientName: "Vitamina B1",
  nutrientType: "vitamin",
  symptoms: [
    { symptomId: 3, nameEs: "Ansiedad o tensión", weight: 1 },
    { symptomId: 4, nameEs: "Apatía", weight: 1 },
    { symptomId: 5, nameEs: "Ardor en los pies o tobillos sensibles", weight: 1 },
    { symptomId: 6, nameEs: "Latidos del corazón rápidos o irregulares", weight: 1 },
    { symptomId: 11, nameEs: "Calambres o temblores", weight: 1 },
    { symptomId: 12, nameEs: "Cansancio después de un ejercicio ligero", weight: 1 },
    { symptomId: 24, nameEs: "Dificultad para concentrarse", weight: 1 },
    { symptomId: 28, nameEs: "Dolores de estómago", weight: 1 },
    { symptomId: 31, nameEs: "Dolores en los ojos", weight: 1 },
    { symptomId: 40, nameEs: "Falta de energía", weight: 1 },
    { symptomId: 41, nameEs: "Deterioro de la memoria", weight: 1 },
    { symptomId: 42, nameEs: "Hormigueo en manos", weight: 1 },
    { symptomId: 43, nameEs: "Hormigueo en las piernas", weight: 1 },
    { symptomId: 51, nameEs: "Irritabilidad", weight: 1 },
    { symptomId: 61, nameEs: "Músculos doloridos o sensibles", weight: 1 },
    { symptomId: 62, nameEs: "Náuseas o vómitos", weight: 1 },
    { symptomId: 67, nameEs: "Estreñimiento", weight: 1 },
    { symptomId: 81, nameEs: "Rechinar los dientes", weight: 1 },
  ],
};

/** Magnesio: 14 symptoms with some weight=2 */
const magnesio: NutrientMapping = {
  nutrientId: "magnesio",
  nutrientName: "Magnesio",
  nutrientType: "mineral",
  symptoms: [
    { symptomId: 3, nameEs: "Ansiedad o tensión", weight: 1 },
    { symptomId: 6, nameEs: "Latidos del corazón rápidos o irregulares", weight: 1 },
    { symptomId: 11, nameEs: "Calambres o temblores", weight: 2 },
    { symptomId: 18, nameEs: "Contracciones musculares", weight: 2 },
    { symptomId: 36, nameEs: "Espasmos musculares", weight: 2 },
    { symptomId: 40, nameEs: "Falta de energía", weight: 1 },
    { symptomId: 42, nameEs: "Hormigueo en manos", weight: 1 },
    { symptomId: 43, nameEs: "Hormigueo en las piernas", weight: 1 },
    { symptomId: 51, nameEs: "Irritabilidad", weight: 1 },
    { symptomId: 61, nameEs: "Músculos doloridos o sensibles", weight: 1 },
    { symptomId: 67, nameEs: "Estreñimiento", weight: 1 },
    { symptomId: 89, nameEs: "Osteoporosis", weight: 1 },
    { symptomId: 92, nameEs: "Temblores", weight: 1 },
  ],
};

/** Omega 3 y 6: 13 symptoms */
const omega36: NutrientMapping = {
  nutrientId: "omega_3_6",
  nutrientName: "Omega 3 y 6",
  nutrientType: "fatty_acid",
  symptoms: [
    { symptomId: 9, nameEs: "Cabello seco", weight: 1 },
    { symptomId: 24, nameEs: "Dificultad para concentrarse", weight: 1 },
    { symptomId: 30, nameEs: "Dolores en las articulaciones o artritis", weight: 1 },
    { symptomId: 32, nameEs: "Dolor de pecho", weight: 1 },
    { symptomId: 37, nameEs: "Fatiga o debilidad", weight: 1 },
    { symptomId: 40, nameEs: "Falta de energía", weight: 1 },
    { symptomId: 46, nameEs: " sequedad ocular", weight: 2 },
    { symptomId: 49, nameEs: "Insomnio o nerviosismo", weight: 1 },
    { symptomId: 56, nameEs: "Manos frías", weight: 1 },
    { symptomId: 66, nameEs: "Piel seca y escamosa", weight: 2 },
    { symptomId: 71, nameEs: "Poca elasticidad de la piel", weight: 1 },
    { symptomId: 82, nameEs: "Retención de líquidos", weight: 1 },
    { symptomId: 90, nameEs: "Seborrea", weight: 1 },
  ],
};

/** Selénio: only 4 symptoms (smallest mapping) */
const selenio: NutrientMapping = {
  nutrientId: "selenio",
  nutrientName: "Selenio",
  nutrientType: "mineral",
  symptoms: [
    { symptomId: 15, nameEs: "Cataratas", weight: 1 },
    { symptomId: 47, nameEs: "Historia familiar de cáncer", weight: 1 },
    { symptomId: 86, nameEs: "Señales de envejecimiento prematuro", weight: 1 },
    { symptomId: 94, nameEs: "Tensión arterial alta", weight: 1 },
  ],
};

// ─── Tests ───────────────────────────────────────────────────────────

describe("Scoring Engine", () => {
  describe("calculateNutrientStatus", () => {
    it("returns OK when no symptoms are marked", () => {
      const result = calculateNutrientStatus(vitaminaA, new Map());
      expect(result.status).toBe("OK");
      expect(result.ratio).toBe(0);
      expect(result.matchedWeight).toBe(0);
      expect(result.maxWeight).toBeGreaterThan(0);
    });

    it("returns OK when all symptoms are answered NO", () => {
      const responses = new Map([
        [1, false],
        [2, false],
        [14, false],
        [21, false],
        [48, false],
        [75, false],
        [76, false],
        [95, false],
      ]);
      const result = calculateNutrientStatus(vitaminaA, responses);
      expect(result.status).toBe("OK");
      expect(result.ratio).toBe(0);
    });

    it("returns deficient when ratio is between 0 and 0.3", () => {
      // Vitamina A: 8 symptoms, total weight = 1+1+1+1+1+1+2+1 = 9
      // Mark 1 symptom with weight=1 → ratio = 1/9 ≈ 0.111 → deficient
      const responses = new Map([[1, true]]); // Acné (w=1)
      const result = calculateNutrientStatus(vitaminaA, responses);
      expect(result.status).toBe("deficient");
      expect(result.matchedWeight).toBe(1);
      expect(result.ratio).toBeCloseTo(1 / 9, 4);
    });

    it("returns urgent when ratio >= 0.3", () => {
      // Mark 3 symptoms with weight=1 → ratio = 3/9 ≈ 0.333 → urgent
      const responses = new Map([
        [1, true],  // Acné (w=1)
        [2, true],  // Aftas (w=1)
        [14, true], // Caspa (w=1)
      ]);
      const result = calculateNutrientStatus(vitaminaA, responses);
      expect(result.status).toBe("urgent");
      expect(result.matchedWeight).toBe(3);
      expect(result.ratio).toBeCloseTo(3 / 9, 4);
    });

    it("correctly handles weight=2 symptoms", () => {
      // Mark Ojos hinchados (w=2) → ratio = 2/9 ≈ 0.222 → deficient
      const responses = new Map([[76, true]]);
      const result = calculateNutrientStatus(vitaminaA, responses);
      expect(result.status).toBe("deficient");
      expect(result.matchedWeight).toBe(2);
      expect(result.ratio).toBeCloseTo(2 / 9, 4);
    });

    it("marks urgent exactly at threshold 0.3", () => {
      // Selénio: 4 symptoms, all weight=1, maxWeight=4
      // Mark 2 → ratio = 2/4 = 0.5 → urgent
      // Mark 1 → ratio = 1/4 = 0.25 → deficient
      const responses2 = new Map([
        [15, true],
        [47, true],
      ]);
      const result2 = calculateNutrientStatus(selenio, responses2);
      expect(result2.status).toBe("urgent");
      expect(result2.ratio).toBe(0.5);

      const responses1 = new Map([[15, true]]);
      const result1 = calculateNutrientStatus(selenio, responses1);
      expect(result1.status).toBe("deficient");
      expect(result1.ratio).toBe(0.25);
    });

    it("handles a nutrient with only one symptom", () => {
      const single: NutrientMapping = {
        nutrientId: "black_cohosh",
        nutrientName: "Black Cohosh",
        nutrientType: "supplement",
        symptoms: [{ symptomId: 60, nameEs: "Menopausia", weight: 2 }],
      };

      // Not marked → OK
      const result0 = calculateNutrientStatus(single, new Map());
      expect(result0.status).toBe("OK");
      expect(result0.ratio).toBe(0);

      // Marked → ratio = 2/2 = 1.0 → urgent
      const result1 = calculateNutrientStatus(single, new Map([[60, true]]));
      expect(result1.status).toBe("urgent");
      expect(result1.ratio).toBe(1);
    });

    it("ignores responses for symptoms not in this nutrient's mapping", () => {
      // Symptom #99 is not mapped to Vitamina A
      const responses = new Map([
        [1, true],
        [99, true], // Not in Vitamina A mapping
      ]);
      const result = calculateNutrientStatus(vitaminaA, responses);
      expect(result.matchedWeight).toBe(1); // Only Acné counts
    });
  });

  describe("calculateAllNutrients", () => {
    const allMappings = [vitaminaA, vitaminaB1, magnesio, omega36, selenio];

    it("returns OK for all nutrients when no symptoms are marked", () => {
      const results = calculateAllNutrients(new Map(), allMappings);
      expect(results).toHaveLength(5);
      results.forEach((r) => {
        expect(r.status).toBe("OK");
        expect(r.ratio).toBe(0);
      });
    });

    it("scores multiple nutrients from a single symptom", () => {
      // Ansiedad (#3) maps to Vitamina B1 AND Magnesio
      const responses = new Map([[3, true]]);
      const results = calculateAllNutrients(responses, allMappings);

      const b1 = results.find((r) => r.nutrientId === "vitamina_b1");
      const mag = results.find((r) => r.nutrientId === "magnesio");
      const sel = results.find((r) => r.nutrientId === "selenio");

      expect(b1?.status).toBe("deficient"); // 1/18 ≈ 0.056
      expect(b1?.ratio).toBeCloseTo(1 / 18, 4);

      expect(mag?.status).toBe("deficient"); // 1/16 = 0.0625
      expect(mag?.ratio).toBeCloseTo(1 / 16, 4);

      // Selenio unaffected
      expect(sel?.status).toBe("OK");
    });

    it("handles complex multi-symptom scenario", () => {
      // Simulate a patient with several symptoms
      const responses = new Map([
        [1, true],   // Acné → Vitamina A, B3, Zinc, Ajo
        [3, true],   // Ansiedad → B1, B12, B3, D, Ácido Fólico, Calcio, Magnesio
        [9, true],   // Cabello seco → Omega 3/6
        [11, true],  // Calambres → B1, Magnesio
        [15, true],  // Cataratas → Selenio, Mirtilo
        [40, true],  // Falta de energía → B1, B3, B6, B12, Magnesio, Omega
      ]);

      const results = calculateAllNutrients(responses, allMappings);

      // Vitamina B1: symptoms 3,11,40 = 3/18 ≈ 0.167 → deficient
      const b1 = results.find((r) => r.nutrientId === "vitamina_b1");
      expect(b1?.status).toBe("deficient");
      expect(b1?.matchedWeight).toBe(3);
      expect(b1?.ratio).toBeCloseTo(3 / 18, 4);

      // Magnesio: symptoms 3(w=1),11(w=2),40(w=1) = 4/16 = 0.25 → deficient
      const mag = results.find((r) => r.nutrientId === "magnesio");
      expect(mag?.status).toBe("deficient");
      expect(mag?.matchedWeight).toBe(4);

      // Selenio: symptom 15 = 1/4 = 0.25 → deficient
      const sel = results.find((r) => r.nutrientId === "selenio");
      expect(sel?.status).toBe("deficient");
      expect(sel?.ratio).toBe(0.25);

      // Omega: symptoms 9,40 = 2/14 ≈ 0.143 → deficient
      const omega = results.find((r) => r.nutrientId === "omega_3_6");
      expect(omega?.status).toBe("deficient");
      expect(omega?.matchedWeight).toBe(2);
    });
  });

  describe("getRecommendations", () => {
    it("returns only deficient and urgent nutrients", () => {
      const results: ScoringResult[] = [
        { nutrientId: "vitamina_a", nutrientName: "Vitamina A", nutrientType: "vitamin", matchedWeight: 0, maxWeight: 9, ratio: 0, status: "OK" },
        { nutrientId: "vitamina_b1", nutrientName: "Vitamina B1", nutrientType: "vitamin", matchedWeight: 3, maxWeight: 18, ratio: 0.167, status: "deficient" },
        { nutrientId: "magnesio", nutrientName: "Magnesio", nutrientType: "mineral", matchedWeight: 6, maxWeight: 15, ratio: 0.4, status: "urgent" },
      ];

      const recs = getRecommendations(results);
      expect(recs).toHaveLength(2);
      expect(recs.map((r) => r.nutrientId)).toContain("vitamina_b1");
      expect(recs.map((r) => r.nutrientId)).toContain("magnesio");
      expect(recs.map((r) => r.nutrientId)).not.toContain("vitamina_a");
    });

    it("sorts by urgency: urgent first, then deficient", () => {
      const results: ScoringResult[] = [
        { nutrientId: "a", nutrientName: "A", nutrientType: "vitamin", matchedWeight: 1, maxWeight: 10, ratio: 0.1, status: "deficient" },
        { nutrientId: "b", nutrientName: "B", nutrientType: "mineral", matchedWeight: 5, maxWeight: 10, ratio: 0.5, status: "urgent" },
        { nutrientId: "c", nutrientName: "C", nutrientType: "vitamin", matchedWeight: 3, maxWeight: 10, ratio: 0.3, status: "urgent" },
      ];

      const recs = getRecommendations(results);
      expect(recs[0].status).toBe("urgent");
      expect(recs[1].status).toBe("urgent");
      expect(recs[2].status).toBe("deficient");
    });

    it("returns empty array when all nutrients are OK", () => {
      const results: ScoringResult[] = [
        { nutrientId: "a", nutrientName: "A", nutrientType: "vitamin", matchedWeight: 0, maxWeight: 10, ratio: 0, status: "OK" },
      ];
      expect(getRecommendations(results)).toHaveLength(0);
    });
  });
});
