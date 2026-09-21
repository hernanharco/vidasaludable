import PDFDocument from "pdfkit";
import type { ScoringResult, ProductRecommendation } from "./scoring.js";
import { getProductRecommendations } from "./scoring.js";

/**
 * PDF generation for assessment results.
 *
 * Creates a professional PDF report with:
 * - Patient info
 * - Summary (OK/Deficient/Urgent counts)
 * - Detailed nutrient results
 * - Recommendations
 */

interface PdfOptions {
  patientName: string;
  patientSex: string;
  patientAge: number;
  results: ScoringResult[];
  productRecommendations?: ProductRecommendation[];
  createdAt: string;
}

const STATUS_LABELS = {
  OK: "OK",
  deficient: "En Falta",
  urgent: "Urgente",
} as const;

const STATUS_COLORS = {
  OK: "#059669", // emerald-600
  deficient: "#D97706", // amber-600
  urgent: "#DC2626", // red-600
} as const;

export function generateAssessmentPdf(options: PdfOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: `Evaluación de Prevención - ${options.patientName}`,
        Author: "Dr. Andrea - Medicina Funcional",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ─── Header ─────────────────────────────────────────────
    doc
      .fontSize(24)
      .fillColor("#065f46")
      .text("Evaluación de Prevención", { align: "center" });

    doc
      .fontSize(12)
      .fillColor("#6b7280")
      .text("Medicina Funcional & Hábitos", { align: "center" });

    doc.moveDown(2);

    // ─── Patient Info ───────────────────────────────────────
    doc
      .fontSize(14)
      .fillColor("#1f2937")
      .text("Datos del Paciente");

    doc.moveDown(0.5);

    const sexLabel = options.patientSex === "M" ? "Masculino" : "Femenino";
    doc.fontSize(11).fillColor("#374151");
    doc.text(`Nombre: ${options.patientName}`);
    doc.text(`Sexo: ${sexLabel}`);
    doc.text(`Edad: ${options.patientAge} años`);
    doc.text(`Fecha: ${new Date(options.createdAt).toLocaleDateString("es-AR")}`);

    doc.moveDown(1.5);

    // ─── Summary ────────────────────────────────────────────
    doc
      .fontSize(14)
      .fillColor("#1f2937")
      .text("Resumen");

    doc.moveDown(0.5);

    const okCount = options.results.filter((r) => r.status === "OK").length;
    const deficientCount = options.results.filter((r) => r.status === "deficient").length;
    const urgentCount = options.results.filter((r) => r.status === "urgent").length;

    doc.fontSize(11).fillColor("#374151");
    doc.text(`✅ OK: ${okCount} nutrientes`);
    doc.text(`⚠️  En Falta: ${deficientCount} nutrientes`);
    doc.text(`🔴 Urgente: ${urgentCount} nutrientes`);

    doc.moveDown(1.5);

    // ─── Recommendations ────────────────────────────────────
    const recommendations = options.results.filter((r) => r.status !== "OK");

    if (recommendations.length > 0) {
      doc
        .fontSize(14)
        .fillColor("#1f2937")
        .text("Recomendaciones");

      doc.moveDown(0.5);

      for (const rec of recommendations) {
        const color = STATUS_COLORS[rec.status];
        const label = STATUS_LABELS[rec.status];

        doc.fontSize(11).fillColor(color);
        doc.text(`● ${rec.nutrientName}`, { continued: true });
        doc.fillColor("#6b7280").text(` — ${label} (${Math.round(rec.ratio * 100)}%)`);
      }

      doc.moveDown(1.5);
    }

    // ─── Product Recommendations ───────────────────────────
    const productRecs = options.productRecommendations ?? getProductRecommendations(options.results);

    if (productRecs.length > 0) {
      doc
        .fontSize(14)
        .fillColor("#1f2937")
        .text("Productos Recomendados");

      doc.moveDown(0.5);

      for (const product of productRecs) {
        if (doc.y > 680) {
          doc.addPage();
        }

        // Product name and price
        doc
          .fontSize(11)
          .fillColor("#065f46")
          .text(product.name, { continued: true });
        doc
          .fillColor("#059669")
          .text(`  €${product.price.toFixed(2)}`);

        // Category and size
        doc
          .fontSize(9)
          .fillColor("#6b7280")
          .text(`${product.category} · ${product.size}`);

        doc.moveDown(0.3);

        // Benefits
        doc
          .fontSize(10)
          .fillColor("#374151")
          .text(`Por qué tomarlo: ${product.benefits}`);

        // Dosage
        doc
          .fontSize(10)
          .fillColor("#374151")
          .text(`Cómo tomarlo: ${product.dosage}`);

        // Addressed nutrients
        const nutrientLabels = product.addressesNutrients
          .map((n) => `${n.nutrientName} (${n.status === "urgent" ? "Urgente" : "En Falta"})`)
          .join(", ");
        doc
          .fontSize(9)
          .fillColor("#9ca3af")
          .text(`Cubre: ${nutrientLabels}`);

        doc.moveDown(0.8);
      }

      doc.moveDown(0.5);
    }

    // ─── All Nutrients ──────────────────────────────────────
    doc
      .fontSize(14)
      .fillColor("#1f2937")
      .text("Detalle de Nutrientes");

    doc.moveDown(0.5);

    // Table header
    doc.fontSize(10).fillColor("#6b7280");
    const headerY = doc.y;
    doc.text("Nutriente", 50, headerY, { width: 200 });
    doc.text("Estado", 280, headerY, { width: 100 });
    doc.text("Score", 400, headerY, { width: 100 });
    doc.y = headerY + 15;

    doc
      .moveTo(50, doc.y)
      .lineTo(520, doc.y)
      .strokeColor("#e5e7eb")
      .stroke();

    doc.moveDown(0.5);

    // Table rows
    const sorted = [...options.results].sort((a, b) => {
      const order = { urgent: 0, deficient: 1, OK: 2 };
      return order[a.status] - order[b.status];
    });

    for (const r of sorted) {
      if (doc.y > 720) {
        doc.addPage();
      }

      const color = STATUS_COLORS[r.status];
      const label = STATUS_LABELS[r.status];
      const rowY = doc.y;

      doc.fontSize(10).fillColor("#374151");
      doc.text(r.nutrientName, 50, rowY, { width: 200 });
      doc.fillColor(color).text(label, 280, rowY, { width: 100 });
      doc.fillColor("#6b7280").text(`${r.matchedWeight}/${r.maxWeight} (${Math.round(r.ratio * 100)}%)`, 400, rowY, { width: 100 });

      doc.y = rowY + 15;
      doc.moveDown(0.3);
    }

    // ─── Footer ─────────────────────────────────────────────
    doc.moveDown(2);
    doc
      .fontSize(9)
      .fillColor("#9ca3af")
      .text(
        "Este informe es orientativo y no sustituye una consulta médica profesional.",
        { align: "center" },
      );

    doc.end();
  });
}
