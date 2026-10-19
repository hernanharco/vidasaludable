import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { createDatabase, type Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { createAssessmentRouter } from "../src/routes/assessment.js";
import { products } from "../src/db/schema.js";
import {
  assessmentSymptoms,
  assessmentNutrients,
  assessmentSymptomNutrients,
} from "../src/db/assessmentSchema.js";

/**
 * Assessment ↔ products-table contract (feature reco-consistency, S2).
 *
 * The assessment flow (calculate → save → read → PDF/email) must source its
 * product data from the SAME `products` table the chat injects, instead of
 * the built-in 3-product PRODUCT_CATALOG. The dosage markers below are
 * deliberately different from the old built-in text ("Tomar 2 tabletas
 * amarillas…") so a stale source fails instead of passing silently.
 *
 * PDF/email readability itself stays covered by assessment-pdf-email.test.ts;
 * here we pin the API-level source of truth, which the PDF route consumes.
 */

let db: Db;
let app: Hono;

const DOUBLE_X_DOSIS = "DX-DB-DOSIS-DE-PRUEBA";
const CAL_MAG_DOSIS = "CM-DB-DOSIS-DE-PRUEBA";

beforeAll(async () => {
  db = createDatabase(":memory:");
  await migrate(db);

  // Symptom → nutrient mapping (mimics the Excel fixture used elsewhere):
  // #40 "Falta de energía" → magnesio (weight 1) → maxWeight 1 → urgent.
  db.insert(assessmentSymptoms).values({ id: 40, nameEs: "Falta de energía" }).run();
  db.insert(assessmentNutrients)
    .values({ id: "magnesio", name: "Magnesio", type: "mineral" })
    .run();
  db.insert(assessmentSymptomNutrients)
    .values({ symptomId: 40, nutrientId: "magnesio", weight: 1 })
    .run();

  // Catalog rows with marker dosages: both products the magnesio map points
  // at after S3 (121576 and 110606).
  db.insert(products)
    .values([
      {
        reference: "121576",
        name: "Nutrilite™ Double X™ Multivitaminas / Multiminerales / Fitonutrientes",
        category: "Complementos alimenticios — Multivitamínicos",
        size: "186 comprimidos",
        price: 86.87,
        benefits: "Beneficios Double X (fixture DB).",
        dosage: DOUBLE_X_DOSIS,
        ingredients: "Vitaminas, minerales y fitonutrientes.",
        disclaimer: "Complemento alimenticio.",
      },
      {
        reference: "110606",
        name: "Nutrilite™ Cal Mag D Plus",
        category: "Complementos alimenticios — Huesos",
        size: "180 comprimidos",
        price: 29.71,
        benefits: "Beneficios Cal Mag (fixture DB).",
        dosage: CAL_MAG_DOSIS,
        ingredients: "Calcio, magnesio y vitamina D.",
        disclaimer: "Complemento alimenticio.",
      },
    ])
    .run();

  app = new Hono();
  app.route("/assessment", createAssessmentRouter(db));
});

afterAll(() => {
  db.$client.close();
});

const urgentMagnesio = [{ symptomId: 40, answered: true }];

describe("POST /assessment/calculate — product data from the products table", () => {
  it("returns the dosage stored in the products table, not a built-in one", async () => {
    const res = await app.request("/assessment/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responses: urgentMagnesio }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    const byRef = new Map(
      body.productRecommendations.map((p: any) => [p.reference, p]),
    );
    expect(byRef.get("121576")?.dosage).toBe(DOUBLE_X_DOSIS);
    expect(byRef.get("110606")?.dosage).toBe(CAL_MAG_DOSIS);
    expect(byRef.get("110606")?.name).toBe("Nutrilite™ Cal Mag D Plus");
  });

  it("returns NO product recommendations when the products table is empty", async () => {
    // S2 guard: with a required catalog argument an empty table yields [].
    // The built-in fallback used to answer with 3 hard-coded products here.
    db.delete(products).run();
    try {
      const res = await app.request("/assessment/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: urgentMagnesio }),
      });
      const body = await res.json();
      expect(body.productRecommendations).toEqual([]);
    } finally {
      // Restore the fixture rows for the rest of the file.
      db.insert(products)
        .values([
          {
            reference: "121576",
            name: "Nutrilite™ Double X™ Multivitaminas / Multiminerales / Fitonutrientes",
            category: "Complementos alimenticios — Multivitamínicos",
            size: "186 comprimidos",
            price: 86.87,
            benefits: "Beneficios Double X (fixture DB).",
            dosage: DOUBLE_X_DOSIS,
            ingredients: "Vitaminas, minerales y fitonutrientes.",
            disclaimer: "Complemento alimenticio.",
          },
          {
            reference: "110606",
            name: "Nutrilite™ Cal Mag D Plus",
            category: "Complementos alimenticios — Huesos",
            size: "180 comprimidos",
            price: 29.71,
            benefits: "Beneficios Cal Mag (fixture DB).",
            dosage: CAL_MAG_DOSIS,
            ingredients: "Calcio, magnesio y vitamina D.",
            disclaimer: "Complemento alimenticio.",
          },
        ])
        .run();
    }
  });
});

describe("POST /assessment (save) → GET /assessment/:id", () => {
  it("exposes productRecommendations sourced from the products table", async () => {
    const saveRes = await app.request("/assessment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientName: "Eliana Test",
        patientSex: "F",
        patientAge: 37,
        responses: urgentMagnesio,
      }),
    });
    expect(saveRes.status).toBe(201);
    const saved = await saveRes.json();

    const getRes = await app.request(`/assessment/${saved.id}`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json();

    expect(body.productRecommendations).toBeDefined();
    const byRef = new Map(
      body.productRecommendations.map((p: any) => [p.reference, p]),
    );
    expect(byRef.get("121576")?.dosage).toBe(DOUBLE_X_DOSIS);
    expect(byRef.get("110606")?.dosage).toBe(CAL_MAG_DOSIS);

    // The PDF/email routes consume exactly this field, so it must carry the
    // addressesNutrients shape the PDF renders ("Tomar: <name>").
    const calMag = byRef.get("110606");
    expect(calMag.addressesNutrients.map((n: any) => n.nutrientId)).toContain(
      "magnesio",
    );
  });
});
