import { sqliteTable, text, integer, real, index, primaryKey } from "drizzle-orm/sqlite-core";
import { referrers } from "./schema.js";
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
    referrerId: integer("referrer_id").references(() => referrers.id),
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

/**
 * Individual symptom responses for an assessment.
 *
 * DDL (src/db/migrate.ts) is the source of truth: no `id` column; the
 * primary key is the composite (assessment_id, symptom_id).
 */
export const assessmentResponses = sqliteTable("assessment_responses", {
  assessmentId: text("assessment_id")
    .notNull()
    .references(() => assessments.id),
  symptomId: integer("symptom_id")
    .notNull()
    .references(() => assessmentSymptoms.id),
  answered: integer("answered", { mode: "boolean" }).notNull(), // true = SI
}, (t) => [primaryKey({ columns: [t.assessmentId, t.symptomId] })]);

/**
 * Calculated nutrient scores for a completed assessment.
 *
 * DDL (src/db/migrate.ts) is the source of truth: no `id` column; `score`
 * is the persisted ratio snapshot (matchedWeight / maxWeight); the primary
 * key is the composite (assessment_id, nutrient_id).
 */
export const assessmentResults = sqliteTable("assessment_results", {
  assessmentId: text("assessment_id")
    .notNull()
    .references(() => assessments.id),
  nutrientId: text("nutrient_id")
    .notNull()
    .references(() => assessmentNutrients.id),
  score: real("score").notNull(), // ratio snapshot (matchedWeight / maxWeight)
  status: text("status").notNull(), // "OK" | "deficient" | "urgent"
}, (t) => [primaryKey({ columns: [t.assessmentId, t.nutrientId] })]);

// ─── Types ───────────────────────────────────────────────────────────

export type AssessmentSymptom = typeof assessmentSymptoms.$inferSelect;
export type AssessmentNutrient = typeof assessmentNutrients.$inferSelect;
export type AssessmentSymptomNutrient = typeof assessmentSymptomNutrients.$inferSelect;
export type Assessment = typeof assessments.$inferSelect;
export type NewAssessment = typeof assessments.$inferInsert;
export type AssessmentResponse = typeof assessmentResponses.$inferSelect;
export type AssessmentResult = typeof assessmentResults.$inferSelect;
