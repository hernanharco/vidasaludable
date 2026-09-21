import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  assessmentSymptoms,
  assessmentNutrients,
  assessmentSymptomNutrients,
  assessments,
  assessmentResponses,
  assessmentResults,
} from "../db/assessmentSchema.js";
import {
  calculateNutrientStatus,
  calculateAllNutrients,
  getRecommendations,
  getProductRecommendations,
  type NutrientMapping,
  type ScoringResult,
  type ProductRecommendation,
} from "./scoring.js";
import { randomUUID } from "node:crypto";

/**
 * Assessment service — bridges the scoring engine with the database.
 *
 * Responsibilities:
 * - Load reference data (symptoms, nutrients, mappings) from DB
 * - Calculate scores using the scoring engine
 * - Persist assessment sessions and results
 * - Retrieve saved assessments
 */

export interface QuestionnaireData {
  symptoms: Array<{ id: number; nameEs: string }>;
  nutrients: Array<{ id: string; name: string; type: string }>;
}

export interface CalculateRequest {
  symptomId: number;
  answered: boolean;
}

export interface CalculateResponse {
  results: ScoringResult[];
  recommendations: ScoringResult[];
  productRecommendations: ProductRecommendation[];
}

export interface SaveRequest {
  patientName: string;
  patientSex: string;
  patientAge: number;
  responses: CalculateRequest[];
}

export interface SavedAssessment {
  id: string;
  patientName: string;
  patientSex: string;
  patientAge: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface AssessmentDetail extends SavedAssessment {
  results: ScoringResult[];
  responses: Array<{ symptomId: number; answered: boolean }>;
}

export function createAssessmentService(db: Db) {
  /**
   * Load all reference data for the questionnaire.
   */
  function getQuestionnaire(): QuestionnaireData {
    const symptoms = db
      .select()
      .from(assessmentSymptoms)
      .all()
      .map((s) => ({ id: s.id, nameEs: s.nameEs }));

    const nutrients = db
      .select()
      .from(assessmentNutrients)
      .all()
      .map((n) => ({ id: n.id, name: n.name, type: n.type }));

    return { symptoms, nutrients };
  }

  /**
   * Load nutrient mappings from DB and convert to NutrientMapping format.
   */
  function loadNutrientMappings(): NutrientMapping[] {
    const allNutrients = db.select().from(assessmentNutrients).all();
    const allMappings = db.select().from(assessmentSymptomNutrients).all();
    const allSymptoms = db.select().from(assessmentSymptoms).all();

    const symptomMap = new Map(allSymptoms.map((s) => [s.id, s.nameEs]));

    return allNutrients.map((nutrient) => {
      const symptomMappings = allMappings
        .filter((m) => m.nutrientId === nutrient.id)
        .map((m) => ({
          symptomId: m.symptomId,
          nameEs: symptomMap.get(m.symptomId) ?? `Síntoma #${m.symptomId}`,
          weight: m.weight,
        }));

      return {
        nutrientId: nutrient.id,
        nutrientName: nutrient.name,
        nutrientType: nutrient.type as NutrientMapping["nutrientType"],
        symptoms: symptomMappings,
      };
    });
  }

  /**
   * Calculate scores for given responses (pure calculation, no persistence).
   */
  function calculate(responses: CalculateRequest[]): CalculateResponse {
    const responseMap = new Map(
      responses.map((r) => [r.symptomId, r.answered]),
    );
    const mappings = loadNutrientMappings();
    const results = calculateAllNutrients(responseMap, mappings);
    const recommendations = getRecommendations(results);
    const productRecommendations = getProductRecommendations(results);
    return { results, recommendations, productRecommendations };
  }

  /**
   * Save a completed assessment with responses and calculated results.
   */
  function save(req: SaveRequest): SavedAssessment {
    const id = randomUUID();
    const responseMap = new Map(
      req.responses.map((r) => [r.symptomId, r.answered]),
    );
    const mappings = loadNutrientMappings();
    const results = calculateAllNutrients(responseMap, mappings);

    // Insert assessment
    db.insert(assessments)
      .values({
        id,
        patientName: req.patientName,
        patientSex: req.patientSex,
        patientAge: req.patientAge,
        status: "completed",
        completedAt: new Date().toISOString(),
      })
      .run();

    // Insert responses
    for (const r of req.responses) {
      db.insert(assessmentResponses)
        .values({
          assessmentId: id,
          symptomId: r.symptomId,
          answered: r.answered,
        })
        .run();
    }

    // Insert results
    for (const r of results) {
      db.insert(assessmentResults)
        .values({
          assessmentId: id,
          nutrientId: r.nutrientId,
          matchedWeight: r.matchedWeight,
          maxWeight: r.maxWeight,
          ratio: r.ratio,
          status: r.status,
        })
        .run();
    }

    return {
      id,
      patientName: req.patientName,
      patientSex: req.patientSex,
      patientAge: req.patientAge,
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Retrieve a saved assessment with its results and responses.
   */
  function getById(id: string): AssessmentDetail | null {
    const assessment = db
      .select()
      .from(assessments)
      .where(eq(assessments.id, id))
      .get();

    if (!assessment) return null;

    const results = db
      .select()
      .from(assessmentResults)
      .where(eq(assessmentResults.assessmentId, id))
      .all()
      .map((r) => ({
        nutrientId: r.nutrientId,
        nutrientName: "", // Will be filled from mappings
        nutrientType: "",
        matchedWeight: r.matchedWeight,
        maxWeight: r.maxWeight,
        ratio: r.ratio,
        status: r.status as ScoringResult["status"],
      }));

    // Enrich with nutrient names
    const nutrientMap = new Map(
      db
        .select()
        .from(assessmentNutrients)
        .all()
        .map((n) => [n.id, { name: n.name, type: n.type }]),
    );
    for (const r of results) {
      const info = nutrientMap.get(r.nutrientId);
      if (info) {
        r.nutrientName = info.name;
        r.nutrientType = info.type;
      }
    }

    const responses = db
      .select()
      .from(assessmentResponses)
      .where(eq(assessmentResponses.assessmentId, id))
      .all()
      .map((r) => ({ symptomId: r.symptomId, answered: r.answered }));

    return {
      id: assessment.id,
      patientName: assessment.patientName,
      patientSex: assessment.patientSex,
      patientAge: assessment.patientAge,
      status: assessment.status,
      createdAt: assessment.createdAt,
      completedAt: assessment.completedAt,
      results,
      responses,
    };
  }

  return {
    getQuestionnaire,
    calculate,
    save,
    getById,
  };
}
