import type { NewProduct } from "../db/schema.js";

/**
 * Curated Nutrilite catalog seed.
 *
 * Source of truth: the Amway detail PDFs and PriceList_April-2026_ES in
 * ~/Documentos/amway/. Every field below was transcribed from those documents
 * (prices/refs cross-checked against the April 2026 price list).
 *
 * Entries that are still missing required fields are kept as `incomplete` and
 * are FLAGGED but NOT inserted by seedProducts.ts (product-catalog spec:
 * "records without required fields are rejected or flagged"). Full curation of
 * the remaining PDFs is documented as a pending human step (curate-pdfs.ts).
 */
export interface CuratedProduct extends Partial<NewProduct> {
  reference: string;
  complete: boolean;
  /** Nutrient IDs this product helps supplement (maps to assessment_nutrients.id). */
  nutrientIds: string[];
}

export const CURATED_PRODUCTS: CuratedProduct[] = [
  {
    reference: "100305",
    complete: true,
    nutrientIds: ["biotina", "vitamina_c"],
    name: "Nutrilite™ Biotina C Plus",
    category: "Complementos alimenticios — Cabello y piel",
    size: "90 comprimidos",
    price: 24.04,
    benefits:
      "Complemento alimenticio con biotina y vitamina C que ayudan a mantener un cabello y piel normal. Refuerza la condición de cabello y piel y aporta protección antioxidante contra el daño de los radicales libres.",
    dosage: "2 comprimidos al día, preferiblemente con las comidas.",
    ingredients:
      "Por 2 comprimidos: Vitamina C 60 mg (76% VRN), Biotina 450 μg (900% VRN), L-Cisteína 9 mg, Colágeno 500 mg, Glicina 30 mg. INGREDIENTES: colágeno hidrolizado, estabilizantes (celulosa microcristalina, fosfato dicálcico, carboximetilcelulosa sódica reticulada, hidroxipropilmetilcelulosa), ácido L-ascórbico (vitamina C), maltodextrina, concentrado de cereza acerola, antiaglomerantes, glicina, extracto de pepitas de uva, L-cisteína, humectante (glicerina), D-biotina, agente de recubrimiento (cera de carnauba).",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. El complemento alimenticio no es un sustitutivo de una dieta variada y equilibrada. No exceder la dosis diaria recomendada. Mantener el envase perfectamente cerrado. Guardar en un lugar fresco y seco. Este producto no está destinado a diagnosticar, tratar, curar o prevenir ninguna enfermedad.",
  },
  {
    reference: "100930",
    complete: true,
    nutrientIds: [
      "vitamina_a", "vitamina_b1", "vitamina_b2", "vitamina_b3",
      "vitamina_b6", "vitamina_b12", "vitamina_d", "vitamina_e",
      "acido_folico",
    ],
    name: "Nutrilite™ Multivitaminas / Minerales Masticable",
    category: "Complementos alimenticios — Multivitamínicos",
    size: "120 comprimidos",
    price: 33.18,
    benefits:
      "Complemento masticable con sabor a naranja que proporciona vitaminas, minerales y betacaroteno. Indicado para cubrir vacíos nutricionales de la dieta, para niños a partir de 4 años y adultos.",
    dosage:
      "Para niños mayores de 4 años y adultos: masticar 2 comprimidos al día con las comidas.",
    ingredients:
      "Por día (2 comprimidos): Beta Caroteno 1 mg, Vitamina D 5 μg (100% VRN), Vitamina E 7,5 mg a-TE (63%), Vitamina B1 0,9 mg (82%), Vitamina B2 1,05 mg (75%), Niacina 12 mg NE (75%), Ácido pantoténico 4 mg (67%), Vitamina B6 1 mg (71%), Ácido fólico 100 μg (50%), Vitamina B12 0,75 μg (30%). Contiene vitaminas, minerales y betacaroteno.",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. Este producto no es un sustituto de una dieta equilibrada. No exceder la dosis diaria recomendada. Guardar en lugar fresco y seco. Este producto no está destinado a diagnosticar, tratar, curar o prevenir ninguna enfermedad.",
  },
  {
    // Reference/name/size/price verified against the April 2026 price list.
    // Benefits/dosage/ingredients/disclaimer still need a detail PDF or human
    // review — so this entry is FLAGGED incomplete and NOT inserted.
    reference: "121576",
    complete: false,
    nutrientIds: [
      "vitamina_a", "vitamina_b1", "vitamina_b2", "vitamina_b3",
      "vitamina_b6", "vitamina_b12", "vitamina_c", "vitamina_d",
      "vitamina_e", "acido_folico", "biotina",
      "calcio", "magnesio", "zinc", "selenio", "cromo", "manganesio", "ferro",
    ],
    name: "Nutrilite™ Double X™ Multivitaminas / Multiminerales / Fitonutrientes",
    category: "Complementos alimenticios — Multivitamínicos",
    size: "186 comprimidos",
    price: 72.39,
  },
];

/** Products that are fully curated and ready to upsert. */
export function readyProducts(): NewProduct[] {
  return CURATED_PRODUCTS.filter((p) => p.complete).map((p) => ({
    reference: p.reference,
    name: p.name as string,
    category: p.category as string,
    size: p.size as string,
    price: p.price as number,
    benefits: p.benefits as string,
    dosage: p.dosage as string,
    ingredients: p.ingredients as string,
    disclaimer: p.disclaimer as string,
  }));
}

/** Entries flagged incomplete (present but not inserted). */
export function flaggedIncomplete(): CuratedProduct[] {
  return CURATED_PRODUCTS.filter((p) => !p.complete);
}