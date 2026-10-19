import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { createDatabase, type Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { products } from "../src/db/schema.js";
import {
  assessmentSymptoms,
  assessmentNutrients,
  assessmentSymptomNutrients,
} from "../src/db/assessmentSchema.js";
import { generateAssessmentPdf } from "../src/services/pdfService.js";
import { createAssessmentRouter } from "../src/routes/assessment.js";

/**
 * Route-level passthrough test (advisory R3-PdfRoute-Uncovered-Passthrough).
 *
 * The PDF builder lost its private catalog (reco-consistency S2): the routes
 * must hand it `data.productRecommendations`, resolved by assessmentService
 * from the `products` table. Nothing at the route level pinned that hand-off,
 * so a future edit could silently drop the field and the PDF would render with
 * zero product cards. We spy on the builder and assert both report routes pass
 * exactly the service-computed products.
 */

vi.mock("../src/services/pdfService.js", () => ({
  generateAssessmentPdf: vi.fn(async () => Buffer.from("%PDF-fake")),
}));

const pdfSpy = vi.mocked(generateAssessmentPdf);
const CAL_MAG_DOSIS = "CM-PASSTHROUGH-DOSIS";

let db: Db;
let app: Hono;
let savedId: string;

beforeAll(async () => {
  db = createDatabase(":memory:");
  await migrate(db);

  db.insert(assessmentSymptoms).values({ id: 40, nameEs: "Falta de energía" }).run();
  db.insert(assessmentNutrients)
    .values({ id: "magnesio", name: "Magnesio", type: "mineral" })
    .run();
  db.insert(assessmentSymptomNutrients)
    .values({ symptomId: 40, nutrientId: "magnesio", weight: 1 })
    .run();

  db.insert(products)
    .values({
      reference: "110606",
      name: "Nutrilite™ Cal Mag D Plus",
      category: "Complementos alimenticios — Huesos",
      size: "180 comprimidos",
      price: 29.71,
      benefits: "Calcio y magnesio (fixture passthrough).",
      dosage: CAL_MAG_DOSIS,
      ingredients: "Calcio, magnesio y vitamina D.",
      disclaimer: "Complemento alimenticio.",
    })
    .run();

  app = new Hono();
  app.route("/assessment", createAssessmentRouter(db));

  const saveRes = await app.request("/assessment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientName: "Passthrough Test",
      patientSex: "F",
      patientAge: 40,
      responses: [{ symptomId: 40, answered: true }],
    }),
  });
  savedId = (await saveRes.json()).id;
});

afterAll(() => {
  db.$client.close();
});

describe("report routes pass the service-computed products to the PDF builder", () => {
  it("GET /assessment/:id/pdf forwards productRecommendations", async () => {
    pdfSpy.mockClear();

    const res = await app.request(`/assessment/${savedId}/pdf`);
    expect(res.status).toBe(200);

    expect(pdfSpy).toHaveBeenCalledTimes(1);
    const options = pdfSpy.mock.calls[0][0];

    // The builder must receive products (not compute its own): the dosage
    // marker only exists in the products table.
    expect(options.productRecommendations).toBeDefined();
    const calMag = options.productRecommendations.find(
      (p) => p.reference === "110606",
    );
    expect(calMag).toBeDefined();
    expect(calMag!.dosage).toBe(CAL_MAG_DOSIS);

    // ...and the same results the report summarizes.
    expect(options.results).toBeInstanceOf(Array);
    expect(options.results.length).toBeGreaterThan(0);
  });

  it("POST /assessment/:id/email forwards the same products to its PDF attachment", async () => {
    pdfSpy.mockClear();

    const res = await app.request(`/assessment/${savedId}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    expect(res.status).toBe(200);

    expect(pdfSpy).toHaveBeenCalledTimes(1);
    const options = pdfSpy.mock.calls[0][0];
    const calMag = options.productRecommendations?.find(
      (p) => p.reference === "110606",
    );
    expect(calMag?.dosage).toBe(CAL_MAG_DOSIS);
  });
});
