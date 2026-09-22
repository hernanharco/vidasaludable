import PDFDocument from "pdfkit";
import type { ScoringResult, ProductRecommendation } from "./scoring.js";
import { getProductRecommendations } from "./scoring.js";

/**
 * PDF generation for assessment results.
 *
 * Creates a professional PDF report with:
 * - Patient info
 * - Summary (OK/Deficient/Urgent counts)
 * - Recommendations with Nutrilite products
 * - Product details
 */

interface PdfOptions {
  patientName: string;
  patientSex: string;
  patientAge: number;
  results: ScoringResult[];
  productRecommendations?: ProductRecommendation[];
  createdAt: string;
}

const STATUS_COLORS = {
  OK: "#059669",
  deficient: "#D97706",
  urgent: "#DC2626",
} as const;

const STATUS_BG = {
  OK: "#ecfdf5",
  deficient: "#fffbeb",
  urgent: "#fef2f2",
} as const;

export function generateAssessmentPdf(options: PdfOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 40, bottom: 40, left: 50, right: 50 },
      info: {
        Title: `Evaluación de Prevención - ${options.patientName}`,
        Author: "Dr. Andrea - Medicina Funcional",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - 100; // margins

    // ─── Header with green bar ──────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill("#065f46");

    doc
      .fontSize(22)
      .fillColor("#ffffff")
      .text("Evaluación de Prevención", 50, 25, { width: pageWidth, align: "center" });

    doc
      .fontSize(11)
      .fillColor("#d1fae5")
      .text("Medicina Funcional & Hábitos", 50, 52, { width: pageWidth, align: "center" });

    doc.y = 100;

    // ─── Patient Info box ───────────────────────────────────
    const sexLabel = options.patientSex === "M" ? "Masculino" : "Femenino";
    const fecha = new Date(options.createdAt).toLocaleDateString("es-AR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    doc.roundedRect(50, doc.y, pageWidth, 60, 4).fill("#f9fafb");
    doc
      .fontSize(10)
      .fillColor("#6b7280")
      .text(`Paciente: ${options.patientName}`, 60, doc.y + 10);
    doc
      .fontSize(10)
      .fillColor("#6b7280")
      .text(`Sexo: ${sexLabel}    |    Edad: ${options.patientAge} años    |    Fecha: ${fecha}`, 60, doc.y + 5);

    doc.y += 70;

    // ─── Summary boxes ──────────────────────────────────────
    const okCount = options.results.filter((r) => r.status === "OK").length;
    const deficientCount = options.results.filter((r) => r.status === "deficient").length;
    const urgentCount = options.results.filter((r) => r.status === "urgent").length;

    doc
      .fontSize(12)
      .fillColor("#1f2937")
      .text("Resumen", 50, doc.y);

    doc.y += 5;

    const boxWidth = (pageWidth - 20) / 3;
    const boxY = doc.y;

    // OK box
    doc.roundedRect(50, boxY, boxWidth, 45, 4).fill("#ecfdf5");
    doc.fontSize(18).fillColor("#059669").text(`${okCount}`, 50, boxY + 8, { width: boxWidth, align: "center" });
    doc.fontSize(9).fillColor("#047857").text("OK", 50, boxY + 30, { width: boxWidth, align: "center" });

    // Deficient box
    doc.roundedRect(50 + boxWidth + 10, boxY, boxWidth, 45, 4).fill("#fffbeb");
    doc.fontSize(18).fillColor("#d97706").text(`${deficientCount}`, 50 + boxWidth + 10, boxY + 8, { width: boxWidth, align: "center" });
    doc.fontSize(9).fillColor("#b45309").text("En Falta", 50 + boxWidth + 10, boxY + 30, { width: boxWidth, align: "center" });

    // Urgent box
    doc.roundedRect(50 + (boxWidth + 10) * 2, boxY, boxWidth, 45, 4).fill("#fef2f2");
    doc.fontSize(18).fillColor("#dc2626").text(`${urgentCount}`, 50 + (boxWidth + 10) * 2, boxY + 8, { width: boxWidth, align: "center" });
    doc.fontSize(9).fillColor("#b91c1c").text("Urgente", 50 + (boxWidth + 10) * 2, boxY + 30, { width: boxWidth, align: "center" });

    doc.y = boxY + 60;

    // ─── Recommendations: Nutrient → Product ────────────────
    const recommendations = options.results
      .filter((r) => r.status !== "OK")
      .sort((a, b) => (a.status === "urgent" && b.status !== "urgent" ? -1 : 1));

    const productRecs = options.productRecommendations ?? getProductRecommendations(options.results);

    // Build nutrient-to-product map
    const nutrientProductMap = new Map<string, ProductRecommendation>();
    for (const prod of productRecs) {
      for (const n of prod.addressesNutrients) {
        if (!nutrientProductMap.has(n.nutrientId)) {
          nutrientProductMap.set(n.nutrientId, prod);
        }
      }
    }

    if (recommendations.length > 0) {
      doc.y += 5;
      doc
        .fontSize(13)
        .fillColor("#1f2937")
        .text("Qué tomar según tus deficiencias", 50, doc.y);

      doc.y += 5;

      for (const rec of recommendations) {
        // Check if we need a new page
        if (doc.y > 680) {
          doc.addPage();
        }

        const color = STATUS_COLORS[rec.status];
        const bg = STATUS_BG[rec.status];
        const label = rec.status === "urgent" ? "Urgente" : "En Falta";
        const product = nutrientProductMap.get(rec.nutrientId);

        const cardY = doc.y;

        // Draw card background
        doc.roundedRect(50, cardY, pageWidth, product ? 50 : 30, 4).fill(bg);

        // Status indicator bar
        doc.rect(50, cardY, 4, product ? 50 : 30).fill(color);

        // Nutrient name and status
        doc.fontSize(11).fillColor(color);
        doc.text(rec.nutrientName, 62, cardY + 6, { continued: true });
        doc.fontSize(9).fillColor("#6b7280").text(`  — ${label}`);

        // Product recommendation
        if (product) {
          doc.fontSize(10).fillColor("#1f2937");
          doc.text(`Tomar: ${product.name}`, 62, cardY + 24, { width: pageWidth - 30 });
        }

        doc.y = cardY + (product ? 58 : 38);
      }
    }

    // ─── Product Details ─────────────────────────────────────
    if (productRecs.length > 0) {
      if (doc.y > 600) {
        doc.addPage();
      }

      doc.y += 10;
      doc
        .fontSize(13)
        .fillColor("#1f2937")
        .text("Detalle de Productos Recomendados", 50, doc.y);

      doc.y += 10;

      for (const product of productRecs) {
        if (doc.y > 620) {
          doc.addPage();
        }

        const cardY = doc.y;

        // Product card
        doc.roundedRect(50, cardY, pageWidth, 85, 4).fill("#f0fdf4");
        doc.rect(50, cardY, 4, 85).fill("#059669");

        // Product name
        doc.fontSize(11).fillColor("#065f46");
        doc.text(product.name, 62, cardY + 8, { width: pageWidth - 80 });

        // Category and price
        doc.fontSize(9).fillColor("#6b7280");
        doc.text(`${product.category}  ·  ${product.size}  ·  €${product.price.toFixed(2)}`, 62, cardY + 24);

        // Benefits
        doc.fontSize(9).fillColor("#374151");
        doc.text(`Beneficios: ${product.benefits}`, 62, cardY + 40, { width: pageWidth - 30 });

        // Dosage
        doc.fontSize(9).fillColor("#374151");
        doc.text(`Dosificación: ${product.dosage}`, 62, cardY + 62, { width: pageWidth - 30 });

        doc.y = cardY + 95;
      }
    }

    // ─── Footer ─────────────────────────────────────────────
    const footerY = doc.page.height - 60;
    doc
      .fontSize(8)
      .fillColor("#9ca3af")
      .text(
        "Este informe es orientativo y no sustituye una consulta médica profesional.",
        50,
        footerY,
        { width: pageWidth, align: "center" },
      );

    doc.end();
  });
}
