import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
 * Assessment PDF and Email endpoint tests.
 *
 * Tests:
 * - GET  /assessment/:id/pdf  → returns PDF binary
 * - POST /assessment/:id/email → sends email with PDF attachment
 */

let db: Db;
let app: Hono;
let savedAssessmentId: string;

beforeAll(async () => {
  db = createDatabase(":memory:");
  await migrate(db);

  // Seed minimal data
  const symptoms = [
    { id: 1, nameEs: "Acné" },
    { id: 3, nameEs: "Ansiedad o tensión" },
    { id: 40, nameEs: "Falta de energía" },
  ];
  for (const s of symptoms) {
    db.insert(assessmentSymptoms).values(s).run();
  }

  const nutrients = [
    { id: "vitamina_a", name: "Vitamina A", type: "vitamin" },
    { id: "vitamina_b1", name: "Vitamina B1", type: "vitamin" },
    { id: "magnesio", name: "Magnesio", type: "mineral" },
  ];
  for (const n of nutrients) {
    db.insert(assessmentNutrients).values(n).run();
  }

  const mappings = [
    { symptomId: 1, nutrientId: "vitamina_a", weight: 1 },
    { symptomId: 3, nutrientId: "vitamina_b1", weight: 1 },
    { symptomId: 3, nutrientId: "magnesio", weight: 1 },
    { symptomId: 40, nutrientId: "vitamina_b1", weight: 1 },
    { symptomId: 40, nutrientId: "magnesio", weight: 1 },
  ];
  for (const m of mappings) {
    db.insert(assessmentSymptomNutrients).values(m).run();
  }

  app = new Hono();
  app.route("/assessment", createAssessmentRouter(db));

  // Create a saved assessment for PDF/email tests
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
  const body = await res.json();
  savedAssessmentId = body.id;
});

afterAll(() => {
  db.$client.close();
});

describe("Assessment PDF", () => {
  it("returns a PDF for a saved assessment", async () => {
    const res = await app.request(`/assessment/${savedAssessmentId}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("attachment");

    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);

    // Verify it's a valid PDF (starts with %PDF)
    const header = new TextDecoder().decode(buffer.slice(0, 5));
    expect(header).toBe("%PDF-");
  });

  it("returns 404 for non-existent assessment", async () => {
    const res = await app.request("/assessment/non-existent/pdf");
    expect(res.status).toBe(404);
  });
});

describe("Assessment Email", () => {
  it("sends an email with PDF attachment", async () => {
    const res = await app.request(`/assessment/${savedAssessmentId}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBeDefined();
  });

  it("validates email format", async () => {
    const res = await app.request(`/assessment/${savedAssessmentId}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent assessment", async () => {
    const res = await app.request("/assessment/non-existent/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    expect(res.status).toBe(404);
  });
});
