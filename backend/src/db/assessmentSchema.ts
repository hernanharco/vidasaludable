import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Assessment schema — prevention questionnaire and scoring.
 *
 * Reference tables (symptoms, nutrients, mappings) are seeded from the
 * Excel workbook. Assessment tables track user sessions and results.
 *
 * Naming: snake_case columns, consistent with the existing schema.
 */

// ─── Reference tables (seeded from Excel) ────────────────────────────

/** All 95 symptoms from the prevention questionnaire. */
export const assessmentSymptoms = sqliteTable(
  "assessment_symptoms",
  {
    id: integer("id").primaryKey(), // 1-95, matches Excel numbering
    nameEs: text("name_es").notNull(), // Spanish name for display
  },
  (t) => [index("assessment_symptoms_name_idx").on(t.nameEs)],
);

/** All 31 nutrients (vitamins, minerals, fatty acids, supplements). */
export const assessmentNutrients = sqliteTable(
  "assessment_nutrients",
  {
    id: text("id").primaryKey(), // e.g. "vitamina_a", "calcio"
    name: text("name").notNull(), // Display name (Spanish)
    type: text("type").notNull(), // "vitamin" | "mineral" | "fatty_acid" | "supplement"
  },
  (t) => [index("assessment_nutrients_type_idx").on(t.type)],
);

/**
 * Master mapping: which symptoms indicate which nutrient deficiencies,
 * with clinical weight (1 = moderate, 2 = strong indicator).
 *
 * Source: "Base de Dados" + Profile sheets from the Excel workbook.
 */
export const assessmentSymptomNutrients = sqliteTable(
  "assessment_symptom_nutrients",
  {
    symptomId: integer("symptom_id")
      .notNull()
      .references(() => assessmentSymptoms.id),
    nutrientId: text("nutrient_id")
      .notNull()
      .references(() => assessmentNutrients.id),
    weight: integer("weight").notNull().default(1), // 1 or 2
  },
  (t) => [
    index("assessment_sn_symptom_idx").on(t.symptomId),
    index("assessment_sn_nutrient_idx").on(t.nutrientId),
  ],
);

// ─── Assessment tables (user data) ───────────────────────────────────

/** A completed or in-progress assessment session. */
export const assessments = sqliteTable(
  "assessments",
  {
    id: text("id").primaryKey(), // UUID
    patientName: text("patient_name").notNull(),
    patientSex: text("patient_sex").notNull(), // "M" | "F"
    patientAge: integer("patient_age").notNull(),
    status: text("status").notNull().default("in_progress"), // "in_progress" | "completed"
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (t) => [
    index("assessments_status_idx").on(t.status),
    index("assessments_created_at_idx").on(t.createdAt),
  ],
);

/** Individual symptom responses for an assessment. */
export const assessmentResponses = sqliteTable(
  "assessment_responses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assessmentId: text("assessment_id")
      .notNull()
      .references(() => assessments.id),
    symptomId: integer("symptom_id")
      .notNull()
      .references(() => assessmentSymptoms.id),
    answered: integer("answered", { mode: "boolean" }).notNull(), // true = SI
  },
  (t) => [
    index("assessment_responses_assessment_idx").on(t.assessmentId),
    index("assessment_responses_symptom_idx").on(t.symptomId),
  ],
);

/** Calculated nutrient scores for a completed assessment. */
export const assessmentResults = sqliteTable(
  "assessment_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assessmentId: text("assessment_id")
      .notNull()
      .references(() => assessments.id),
    nutrientId: text("nutrient_id")
      .notNull()
      .references(() => assessmentNutrients.id),
    matchedWeight: integer("matched_weight").notNull(),
    maxWeight: integer("max_weight").notNull(),
    ratio: real("ratio").notNull(),
    status: text("status").notNull(), // "OK" | "deficient" | "urgent"
  },
  (t) => [
    index("assessment_results_assessment_idx").on(t.assessmentId),
    index("assessment_results_nutrient_idx").on(t.nutrientId),
    index("assessment_results_status_idx").on(t.status),
  ],
);

// ─── Types ───────────────────────────────────────────────────────────

export type AssessmentSymptom = typeof assessmentSymptoms.$inferSelect;
export type AssessmentNutrient = typeof assessmentNutrients.$inferSelect;
export type AssessmentSymptomNutrient = typeof assessmentSymptomNutrients.$inferSelect;
export type Assessment = typeof assessments.$inferSelect;
export type NewAssessment = typeof assessments.$inferInsert;
export type AssessmentResponse = typeof assessmentResponses.$inferSelect;
export type AssessmentResult = typeof assessmentResults.$inferSelect;
