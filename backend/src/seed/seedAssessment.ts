import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../db/client.js";
import { assessmentSymptoms, assessmentNutrients, assessmentSymptomNutrients } from "../db/assessmentSchema.js";

/**
 * Seed the assessment reference tables from the extracted Excel data.
 *
 * Usage: `tsx src/seed/seedAssessment.ts [dbPath]`
 * Default DB path: ./data/dev.sqlite
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SeedData {
  symptoms: Array<{ id: number; name_es: string }>;
  nutrients: Array<{ id: string; name: string; type: string }>;
  symptom_nutrient_map: Record<string, Array<{ nutrient_id: string; weight: number }>>;
}

function loadSeedData(): SeedData {
  const dataPath = join(__dirname, "assessment_seed_data.json");
  const raw = readFileSync(dataPath, "utf-8");
  return JSON.parse(raw);
}

function seedAssessment(dbPath: string): void {
  const db = createDatabase(dbPath);
  const data = loadSeedData();

  console.log(`[seed-assessment] Seeding ${dbPath}`);

  // 1. Insert symptoms (idempotent)
  console.log(`  Inserting ${data.symptoms.length} symptoms...`);
  for (const symptom of data.symptoms) {
    db.insert(assessmentSymptoms)
      .values({ id: symptom.id, nameEs: symptom.name_es })
      .onConflictDoUpdate({
        target: assessmentSymptoms.id,
        set: { nameEs: symptom.name_es },
      })
      .run();
  }
  console.log(`  ✓ ${data.symptoms.length} symptoms inserted`);

  // 2. Insert nutrients (idempotent)
  console.log(`  Inserting ${data.nutrients.length} nutrients...`);
  for (const nutrient of data.nutrients) {
    db.insert(assessmentNutrients)
      .values({ id: nutrient.id, name: nutrient.name, type: nutrient.type })
      .onConflictDoUpdate({
        target: assessmentNutrients.id,
        set: { name: nutrient.name, type: nutrient.type },
      })
      .run();
  }
  console.log(`  ✓ ${data.nutrients.length} nutrients inserted`);

  // 3. Insert symptom→nutrient mappings (clear and re-insert)
  console.log(`  Inserting ${Object.values(data.symptom_nutrient_map).flat().length} mappings...`);
  db.$client.prepare("DELETE FROM assessment_symptom_nutrients").run();
  let mappingCount = 0;
  for (const [symptomId, mappings] of Object.entries(data.symptom_nutrient_map)) {
    for (const mapping of mappings) {
      db.insert(assessmentSymptomNutrients)
        .values({
          symptomId: Number(symptomId),
          nutrientId: mapping.nutrient_id,
          weight: mapping.weight,
        })
        .run();
      mappingCount++;
    }
  }
  console.log(`  ✓ ${mappingCount} symptom→nutrient mappings inserted`);

  // 4. Verify
  const symptomCount = db.$client.prepare("SELECT COUNT(*) as c FROM assessment_symptoms").get() as { c: number };
  const nutrientCount = db.$client.prepare("SELECT COUNT(*) as c FROM assessment_nutrients").get() as { c: number };
  const mappingTotal = db.$client.prepare("SELECT COUNT(*) as c FROM assessment_symptom_nutrients").get() as { c: number };

  console.log(`\n[seed-assessment] Verification:`);
  console.log(`  Symptoms: ${symptomCount.c}`);
  console.log(`  Nutrients: ${nutrientCount.c}`);
  console.log(`  Mappings: ${mappingTotal.c}`);

  // 5. Sample verification: Acné (#1) → should map to 4 nutrients
  const acneMappings = db.$client
    .prepare(`
      SELECT n.name, n.type, sn.weight 
      FROM assessment_symptom_nutrients sn
      JOIN assessment_nutrients n ON n.id = sn.nutrient_id
      WHERE sn.symptom_id = 1
    `)
    .all() as Array<{ name: string; type: string; weight: number }>;

  console.log(`\n  Verification: Acné (#1) maps to ${acneMappings.length} nutrients:`);
  for (const m of acneMappings) {
    console.log(`    - ${m.name} (${m.type}, w=${m.weight})`);
  }

  console.log(`\n[seed-assessment] Done ✓`);
}

// Run directly
const dbPath = process.argv[2] ?? "./data/dev.sqlite";
seedAssessment(dbPath);
