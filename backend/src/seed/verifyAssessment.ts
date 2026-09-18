import Database from "better-sqlite3";

const db = new Database("./data/dev.sqlite");

console.log("=== ASSESSMENT DATA VERIFICATION ===\n");

const symCount = db.prepare("SELECT COUNT(*) as c FROM assessment_symptoms").get() as { c: number };
console.log(`Symptoms: ${symCount.c}`);

const nutrients = db.prepare("SELECT type, COUNT(*) as c FROM assessment_nutrients GROUP BY type").all() as Array<{ type: string; c: number }>;
console.log("Nutrients by type:");
nutrients.forEach((n) => console.log(`  ${n.type}: ${n.c}`));

const topNutrients = db
  .prepare(
    `SELECT n.name, n.type, COUNT(*) as symptom_count
     FROM assessment_symptom_nutrients sn
     JOIN assessment_nutrients n ON n.id = sn.nutrient_id
     GROUP BY n.id
     ORDER BY symptom_count DESC
     LIMIT 10`
  )
  .all() as Array<{ name: string; type: string; symptom_count: number }>;
console.log("\nTop 10 nutrients by symptom count:");
topNutrients.forEach((n) => console.log(`  ${n.name} (${n.type}): ${n.symptom_count} symptoms`));

const weights = db.prepare("SELECT weight, COUNT(*) as c FROM assessment_symptom_nutrients GROUP BY weight").all() as Array<{ weight: number; c: number }>;
console.log("\nWeight distribution:");
weights.forEach((w) => console.log(`  weight=${w.weight}: ${w.c} mappings`));

// Verify Vitamina B1 (should be 18 symptoms)
const b1 = db
  .prepare(
    `SELECT s.id, s.name_es
     FROM assessment_symptom_nutrients sn
     JOIN assessment_symptoms s ON s.id = sn.symptom_id
     WHERE sn.nutrient_id = 'vitamina_b1'
     ORDER BY s.id`
  )
  .all() as Array<{ id: number; name_es: string }>;
console.log(`\nVitamina B1 symptoms (${b1.length}):`);
b1.forEach((s) => console.log(`  #${s.id}: ${s.name_es}`));

// Verify a complex symptom: Ansiedad (#3) → 7 nutrients
const ansiedad = db
  .prepare(
    `SELECT n.name, n.type, sn.weight
     FROM assessment_symptom_nutrients sn
     JOIN assessment_nutrients n ON n.id = sn.nutrient_id
     WHERE sn.symptom_id = 3
     ORDER BY n.type, n.name`
  )
  .all() as Array<{ name: string; type: string; weight: number }>;
console.log(`\nAnsiedad (#3) maps to ${ansiedad.length} nutrients:`);
ansiedad.forEach((n) => console.log(`  ${n.name} (${n.type}, w=${n.weight})`));

db.close();
console.log("\n✓ Verification complete");
