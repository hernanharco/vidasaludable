import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { createAssessmentService } from "../services/assessmentService.js";
import { generateAssessmentPdf } from "../services/pdfService.js";
import {
  sendEmail,
  buildAssessmentEmailHtml,
} from "../services/emailService.js";

/**
 * Assessment routes: questionnaire, calculate, save, retrieve, PDF, email.
 *
 * - GET  /assessment/questionnaire → symptoms + nutrients for the wizard
 * - POST /assessment/calculate     → pure scoring (no persistence)
 * - POST /assessment               → save completed assessment
 * - GET  /assessment/:id           → retrieve saved assessment
 * - GET  /assessment/:id/pdf       → download PDF report
 * - POST /assessment/:id/email     → send results via email
 */
export function createAssessmentRouter(db: Db): Hono {
  const app = new Hono();
  const assessmentService = createAssessmentService(db);

  /**
   * GET /assessment/questionnaire
   * Returns all symptoms and nutrients for the frontend wizard.
   */
  app.get("/questionnaire", (c) => {
    const data = assessmentService.getQuestionnaire();
    return c.json(data);
  });

  /**
   * POST /assessment/calculate
   * Accepts symptom responses and returns scored results.
   * Does NOT persist — pure calculation endpoint.
   */
  app.post("/calculate", async (c) => {
    const body = await c.req.json();
    const { responses } = body;

    if (!Array.isArray(responses)) {
      return c.json({ error: "responses must be an array" }, 400);
    }

    const result = assessmentService.calculate(responses);
    return c.json(result);
  });

  /**
   * POST /assessment
   * Saves a completed assessment with patient data, responses, and results.
   */
  app.post("/", async (c) => {
    const body = await c.req.json();
    const { patientName, patientSex, patientAge, responses } = body;

    if (!patientName || typeof patientName !== "string") {
      return c.json({ error: "patientName is required" }, 400);
    }
    if (!patientSex || !["M", "F"].includes(patientSex)) {
      return c.json({ error: "patientSex must be 'M' or 'F'" }, 400);
    }
    if (!patientAge || typeof patientAge !== "number" || patientAge < 0) {
      return c.json({ error: "patientAge must be a positive number" }, 400);
    }
    if (!Array.isArray(responses)) {
      return c.json({ error: "responses must be an array" }, 400);
    }

    const saved = assessmentService.save({
      patientName,
      patientSex,
      patientAge,
      responses,
    });

    return c.json(saved, 201);
  });

  /**
   * GET /assessment/:id
   * Retrieves a saved assessment with its results and responses.
   */
  app.get("/:id", (c) => {
    const id = c.req.param("id");
    const result = assessmentService.getById(id);

    if (!result) {
      return c.json({ error: "Assessment not found" }, 404);
    }

    return c.json(result);
  });

  /**
   * GET /assessment/:id/pdf
   * Generates and returns a PDF report for the assessment.
   */
  app.get("/:id/pdf", async (c) => {
    const id = c.req.param("id");
    const data = assessmentService.getById(id);

    if (!data) {
      return c.json({ error: "Assessment not found" }, 404);
    }

    const pdfBuffer = await generateAssessmentPdf({
      patientName: data.patientName,
      patientSex: data.patientSex,
      patientAge: data.patientAge,
      results: data.results,
      createdAt: data.createdAt,
    });

    const filename = `evaluacion-${data.patientName.replace(/\s+/g, "-").toLowerCase()}.pdf`;

    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });

  /**
   * POST /assessment/:id/email
   * Sends the assessment results via email with PDF attachment.
   *
   * Body: { email: string }
   */
  app.post("/:id/email", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const { email } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return c.json({ error: "Valid email is required" }, 400);
    }

    const data = assessmentService.getById(id);

    if (!data) {
      return c.json({ error: "Assessment not found" }, 404);
    }

    // Generate PDF
    const pdfBuffer = await generateAssessmentPdf({
      patientName: data.patientName,
      patientSex: data.patientSex,
      patientAge: data.patientAge,
      results: data.results,
      createdAt: data.createdAt,
    });

    // Build recommendations for email
    const recommendations = data.results
      .filter((r) => r.status !== "OK")
      .sort((a, b) => {
        const order = { urgent: 0, deficient: 1, OK: 2 };
        return order[a.status] - order[b.status];
      })
      .map((r) => ({
        name: r.nutrientName,
        status: r.status,
        ratio: r.ratio,
      }));

    const okCount = data.results.filter((r) => r.status === "OK").length;
    const deficientCount = data.results.filter(
      (r) => r.status === "deficient",
    ).length;
    const urgentCount = data.results.filter((r) => r.status === "urgent").length;

    // Send email
    const result = await sendEmail({
      to: email,
      subject: `Evaluación de Prevención - ${data.patientName}`,
      html: buildAssessmentEmailHtml({
        patientName: data.patientName,
        urgentCount,
        deficientCount,
        okCount,
        recommendations,
      }),
      attachments: [
        {
          filename: `evaluacion-${data.patientName.replace(/\s+/g, "-").toLowerCase()}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    return c.json(result);
  });

  return app;
}
