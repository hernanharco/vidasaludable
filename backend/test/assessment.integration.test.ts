import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";
import { createDatabase, type Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { createAssessmentRouter } from "../src/routes/assessment.js";
import {
  assessmentSymptoms,
  assessmentNutrients,
  assessmentSymptomNutrients,
} from "../src/db/assessmentSchema.js";

/**
 * Assessment API tests.
 *
 * Uses an in-memory SQLite database with seeded reference data.
 * Tests the 4 core endpoints:
 *   GET  /assessment/questionnaire
 *   POST /assessment/calculate
 *   POST /assessment
 *   GET  /assessment/:id
 */

let db: Db;
let app: Hono;

// ─── Setup ───────────────────────────────────────────────────────────

beforeAll(async () => {
  db = createDatabase(":memory:");
  await migrate(db);

  // Seed minimal reference data for testing
  // 5 symptoms
  const symptoms = [
    { id: 1, nameEs: "Acné" },
    { id: 3, nameEs: "Ansiedad o tensión" },
    { id: 9, nameEs: "Cabello seco" },
    { id: 11, nameEs: "Calambres o temblores" },
    { id: 40, nameEs: "Falta de energía" },
  ];

  for (const s of symptoms) {
    db.insert(assessmentSymptoms).values(s).run();
  }

  // 3 nutrients
  const nutrients = [
    { id: "vitamina_a", name: "Vitamina A", type: "vitamin" },
    { id: "vitamina_b1", name: "Vitamina B1", type: "vitamin" },
    { id: "magnesio", name: "Magnesio", type: "mineral" },
  ];

  for (const n of nutrients) {
    db.insert(assessmentNutrients).values(n).run();
  }

  // Mappings (mimics the Excel's Base de Dados)
  const mappings = [
    // Acné (#1) → Vitamina A
    { symptomId: 1, nutrientId: "vitamina_a", weight: 1 },
    // Ansiedad (#3) → Vitamina B1, Magnesio
    { symptomId: 3, nutrientId: "vitamina_b1", weight: 1 },
    { symptomId: 3, nutrientId: "magnesio", weight: 1 },
    // Cabello seco (#9) → (no mapping in test data)
    // Calambres (#11) → Magnesio (weight=2)
    { symptomId: 11, nutrientId: "magnesio", weight: 2 },
    // Falta de energía (#40) → Vitamina B1, Magnesio
    { symptomId: 40, nutrientId: "vitamina_b1", weight: 1 },
    { symptomId: 40, nutrientId: "magnesio", weight: 1 },
  ];

  for (const m of mappings) {
    db.insert(assessmentSymptomNutrients).values(m).run();
  }

  // Create the router
  app = new Hono();
  app.route("/assessment", createAssessmentRouter(db));
});

afterAll(() => {
  db.$client.close();
});

// ─── Tests ───────────────────────────────────────────────────────────

describe("Assessment API", () => {
  describe("GET /assessment/questionnaire", () => {
    it("returns all symptoms", async () => {
      const res = await app.request("/assessment/questionnaire");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.symptoms).toBeDefined();
      expect(body.symptoms.length).toBe(5);
      expect(body.symptoms[0]).toEqual({ id: 1, nameEs: "Acné" });
    });

    it("returns nutrients grouped by type", async () => {
      const res = await app.request("/assessment/questionnaire");
      const body = await res.json();
      expect(body.nutrients).toBeDefined();
      expect(body.nutrients.length).toBe(3);
      expect(body.nutrients.find((n: any) => n.id === "vitamina_a")).toBeDefined();
    });
  });

  describe("POST /assessment/calculate", () => {
    it("returns OK for all nutrients when no symptoms are marked", async () => {
      const res = await app.request("/assessment/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: [] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toBeDefined();
      expect(body.results.length).toBe(3);
      body.results.forEach((r: any) => {
        expect(r.status).toBe("OK");
      });
    });

    it("scores a single symptom response correctly", async () => {
      const res = await app.request("/assessment/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responses: [{ symptomId: 1, answered: true }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();

      // Vitamina A: 1 symptom (w=1), matched=1, ratio=1/1=1.0 → urgent
      const vitA = body.results.find((r: any) => r.nutrientId === "vitamina_a");
      expect(vitA.status).toBe("urgent");
      expect(vitA.ratio).toBe(1);

      // Vitamina B1: unaffected
      const vitB1 = body.results.find((r: any) => r.nutrientId === "vitamina_b1");
      expect(vitB1.status).toBe("OK");
    });

    it("scores multi-nutrient symptom correctly", async () => {
      const res = await app.request("/assessment/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responses: [
            { symptomId: 3, answered: true },  // Ansiedad → B1 + Magnesio
            { symptomId: 11, answered: true },  // Calambres → Magnesio (w=2)
          ],
        }),
      });
      const body = await res.json();

      // Magnesio: 3(w=1) + 11(w=2) = 3 / maxWeight(4) = 0.75 → urgent
      const mag = body.results.find((r: any) => r.nutrientId === "magnesio");
      expect(mag.status).toBe("urgent");
      expect(mag.matchedWeight).toBe(3);
      expect(mag.ratio).toBe(0.75);

      // Vitamina B1: 3(w=1) = 1 / maxWeight(2) = 0.5 → urgent
      const b1 = body.results.find((r: any) => r.nutrientId === "vitamina_b1");
      expect(b1.status).toBe("urgent");
      expect(b1.ratio).toBe(0.5);
    });

    it("returns recommendations (deficient/urgent only)", async () => {
      const res = await app.request("/assessment/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responses: [{ symptomId: 1, answered: true }],
        }),
      });
      const body = await res.json();
      expect(body.recommendations).toBeDefined();
      expect(body.recommendations.length).toBe(1);
      expect(body.recommendations[0].nutrientId).toBe("vitamina_a");
    });
  });

  describe("POST /assessment (save)", () => {
    it("saves a completed assessment and returns the ID", async () => {
      const res = await app.request("/assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName: "María García",
          patientSex: "F",
          patientAge: 35,
          responses: [
            { symptomId: 1, answered: true },
            { symptomId: 3, answered: true },
          ],
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(typeof body.id).toBe("string");
      expect(body.status).toBe("completed");
    });
  });

  describe("GET /assessment/:id", () => {
    it("retrieves a saved assessment with results", async () => {
      // First save one
      const saveRes = await app.request("/assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName: "Carlos López",
          patientSex: "M",
          patientAge: 42,
          responses: [
            { symptomId: 1, answered: true },
            { symptomId: 40, answered: true },
          ],
        }),
      });
      const saved = await saveRes.json();

      // Then retrieve it
      const getRes = await app.request(`/assessment/${saved.id}`);
      expect(getRes.status).toBe(200);
      const body = await getRes.json();
      expect(body.patientName).toBe("Carlos López");
      expect(body.patientSex).toBe("M");
      expect(body.patientAge).toBe(42);
      expect(body.results).toBeDefined();
      expect(body.results.length).toBe(3);
      expect(body.responses).toBeDefined();
      expect(body.responses.length).toBe(2);
    });

    it("returns 404 for non-existent assessment", async () => {
      const res = await app.request("/assessment/non-existent-id");
      expect(res.status).toBe(404);
    });
  });
});
