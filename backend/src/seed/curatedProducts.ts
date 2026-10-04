import type { NewProduct } from "../db/schema.js";

/**
 * Curated Nutrilite catalog seed.
 *
 * Source of truth: the Amway detail PDFs and PriceList_April-2026_ES in
 * ~/Documentos/amway/, plus the official amway.es product pages (PDPs)
 * transcribed in T2 — benefits/dosage/ingredients/disclaimer verbatim from
 * each PDP's "Vista general"/"Detalles" payload (refs verified against the
 * page's own "Referencia <ref>" line; prices cross-checked vs the April 2026
 * price list). Every field below traces to the `source` recorded on its entry.
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
  /**
   * Provenance marker for machine-generated rows (additive, optional).
   * e.g. "pricelist-2026-04" on rows extracted by curate-pricelist.ts.
   */
  source?: string;
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
    // Reference/name/size verified against the April 2026 price list.
    // PRICE (T2): the calibrated "Precio al cliente con IVA Península"
    // column (anchors 100305→24.04 / 100930→33.18) gives 86.87 — confirmed on
    // the amway.es PDP (€ 86,87); the previous 72.39 was the pre-calibration
    // VN column. Fields transcribed verbatim from the PDP "Detalles" tab.
    reference: "121576",
    complete: true,
    nutrientIds: [
      "vitamina_a", "vitamina_b1", "vitamina_b2", "vitamina_b3",
      "vitamina_b6", "vitamina_b12", "vitamina_c", "vitamina_d",
      "vitamina_e", "acido_folico", "biotina",
      "calcio", "magnesio", "zinc", "selenio", "cromo", "manganesio", "ferro",
    ],
    name: "Nutrilite™ Double X™ Multivitaminas / Multiminerales / Fitonutrientes",
    category: "Complementos alimenticios — Multivitamínicos",
    size: "186 comprimidos",
    price: 86.87,
    benefits:
      "DOUBLE X NUTRILITE es un potente complemento multivitamínico y multimineral con fitonutrientes enriquecido con PhytoBlend™, una mezcla especial de 22 plantas y fitonutrientes procedentes de los 5 grupos de colores que aporta a tu cuerpo un apoyo demostrado científicamente. DOUBLE X NUTRILITE es un complemento alimenticio que te aporta una combinación equilibrada de 12 vitaminas esenciales y 10 minerales esenciales. Está enriquecido con PhytoBlend™, una mezcla especial de 22 plantas procedentes de frutas, hortalizas y hierbas que no son siempre fáciles de incluir en la dieta diaria. Aporta un apoyo prémium a tu cuerpo de diferentes formas: Funcionamiento del cerebro: El yodo ayuda al funcionamiento normal de las funciones cognitivas. La vitamina B12 contribuye al funcionamiento psicológico normal. Sistema inmunológico: La vitamina C contribuye al funcionamiento normal del sistema inmunológico. Estrés oxidativo: La vitamina E ayuda a proteger a las células del estrés oxidativo. Funcionamiento de los huesos: La vitamina D es necesaria para el mantenimiento normal de los huesos. Funcionamiento de los músculos: El magnesio contribuye al funcionamiento normal de los músculos. Double X es el complejo multivitamínico y multimineral número 1 en ventas del mundo y cuenta con fitonutrientes de cinco grupos de colores (Fuente: GlobalData | http://gdretail.net/amway-claims/).",
    dosage:
      "DOSIS RECOMENDADA: Adultos: tomar un comprimido de vitaminas, uno de minerales y uno de fitonutrientes dos veces al día con las comidas.",
    ingredients:
      "Por día (2 Comprimidos de Vitaminas, 2 de Minerales, 2 de Fitonutrientes) % VRN: Vitamina A + Beta-caroteno 1200 µg RE (150%), Vitamina D3 7,5 µg (150%), Vitamina E 12 mg α-TE (100%), Vitamina C 160 mg (200%), Vitamina B1 2,2 mg (200%), Vitamina B2 2,8 mg (200%), Niacina 16 mg NE (100%), Vitamina B6 2,8 mg (200%), Ácido fólico 200 µg (100%), Vitamina B12 2,5 µg (100%), Biotina 100 µg (200%), Ácido pantoténico 12 mg (200%), Calcio 680 mg (85%), Magnesio 245 mg (65%), Hierro 7 mg (50%), Cinc 10 mg (100%), Cobre 0,95 mg (95%), Manganeso 1 mg (50%), Selenio 50 µg (91%), Cromo 36 µg (90%), Molibdeno 45 µg (90%), Yodo (de algas en polvo y yoduro de potasio) 130 µg (87%), Curcuminoides 31 mg, Luteína 1 mg, Licopeno 1 mg, Quercetina 100 mg, Ácido rosmarínico 10 mg, Total de antocianinas 3 mg. INGREDIENTES: COMPRIMIDO DE VITAMINAS: carbonato cálcico, estabilizantes (celulosa microcristalina, carboximetilcelulosa sódica entrelazada, goma arábiga, hidroxipropilmetilcelulosa, agar-agar, sales cálcicas de ácidos grasos), óxido de magnesio, ácido L-ascórbico, antiaglomerantes (dióxido de silicio, sales magnésicas de ácidos grasos), maltodextrina, nicotinamida, succinato ácido de D-alfa-tocoferilo, D-pantotenato cálcico, sacarosa, emulgente (alginato sódico), almidón de guisante, almidón modificado de maíz, almidon de maíz, óxido de cinc, manteca de palma, clorhidrato de piridoxina, riboflavina, mononitrato de tiamina, beta-caroteno, ésteres de luteína, antioxidantes (palmitato de ascorbilo, ascorbato sódico, alfa-tocoferol, extracto rico en tocoferoles), aislado de proteína de soja, humectante (glicerina), licopeno 0,1% (procedente de tomate, Lycopersicon esculantum), acetato de retinilo, jarabe de glucosa, acido pteroilmonoglutámico, agente de recubrimiento (cera de carnauba), D-biotina, selenito de sodio, cianocobalamina. COMPRIMIDO DE MINERALES: carbonato de calcio, estabilizantes (celulosa microcristalina, carboximetilcelulosa sódica reticulada, goma arábiga, hidroxipropilmetilcelulosa, pectina), óxido de magnesio, fumarato ferroso, maltodextrina, antiaglomerantes (dióxido de silicio, sales magnésicas de ácidos grasos), concentrado de menta piperita 0,9% (Mentha x piperita), óxido de cinc, concentrado de perejil 0,6% (Petroselinum crispum), concentrado de espinaca 0,6% (Spinacia oleracea), gluconato de cobre, concentrado de berro de agua 0,3% (Nasturtium officinale), sulfato de manganeso, almidón de maíz, concentrado de alfalfa 0,2% (Medicago sativa), humectante (glicerina), cloruro de cromo (III), molibdato de sodio, agente de recubrimiento (cera de carnauba), selenito de sodio. COMPRIMIDO DE FITONUTRIENTES: estabilizantes (celulosa microcristalina, carboximetilcelulosa sódica reticulada, hidroxipropilmetilcelulosa, goma arábiga, sulfato cálcico, sales cálcicas de ácidos grasos), carbonato de calcio, extracto de romero 12% (Rosmarinus officinalis), quercetina, óxido de magnesio, concentrado de acerola 6% (Malpighia glabra), maltodextrina, acido L-ascórbico, extracto de cúrcuma 3% (Curcuma longa), algas en polvo 2% (Ascophyllum nodosum y Laminaria digitata), antiaglomerantes (dióxido de silicio, sales magnésicas de ácidos grasos), extracto de uva 1% (Vitis vinifera), concentrado de naranja 1% (Citrus sinensis), concentrado de amla 0,6% (Phyllanthus emblica), extracto de grosella negra 0,4% (Ribes nigrum), concentrado de pomelo 0,3% (Citrus paradisi), extracto de cebolla 0,3% (Allium cepa), concentrado de arándano 0,2% (Vaccinium corymbosum), extracto de baya del sauco 0,2% (Sambucus nigra), sacarosa, humectante (glicerina), concentrado de limón 0,1% (Citrus limon), concentrado de mandarina 0,1% (Citrus reticulata), almidón de guisante, almidón de maíz, triglicéridos de cadena media, agente de recubrimiento (cera de carnauba), yoduro de potasio, colecalciferol, antioxidante (alfa-tocoferol).",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. Los complementos alimenticios no son sustitutivos de una dieta equilibrada y variada y un estilo de vida saludable. No exceder la dosis diaria recomendada. No debe ser consumido por mujeres embarazadas o en período de lactancia, ni por niños. No aceptar este paquete si los precintos están rotos o los envases están abiertos. Para conservar la frescura, guardar los comprimidos en los envases de aluminio. Guardar en lugar fresco y seco.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes+aviso); pricelist-2026-04 (precio/tamaño)",
  },
  // ---------------------------------------------------------------------
  // T2 — video-mentioned batch (catalog-video-products). Every field is
  // transcribed verbatim from the official amway.es PDP for that ref
  // (name/size/price cross-checked vs pricelist-2026-04; each PDP verified
  // via its "Referencia <ref>" line). Dosage comes from the PDP's hidden
  // "Detalles" tab (Uso sugerido → Dosis recomendada / Modo de empleo).
  // Disclaimer: the product's own official "Aviso" where the PDP provides
  // one; the standard EU-supplement template (in-repo source of truth) only
  // for complementos-alimenticios whose PDP carries no Aviso.
  // ---------------------------------------------------------------------
  {
    reference: "110606",
    complete: true,
    nutrientIds: ["calcio", "magnesio", "vitamina_d"],
    name: "Nutrilite™ Cal Mag D Plus",
    category: "Complementos alimenticios — Huesos",
    size: "180 comprimidos",
    price: 29.71,
    benefits:
      "Complemento alimenticio que contiene 3 nutrientes extraídos de fuentes naturales: calcio, magnesio y vitamina D.",
    dosage:
      "Tomar 3 comprimidos por día. 1 comprimido por la mañana, otro al mediodía y otro por la tarde/noche.",
    ingredients:
      "Por día (3 comprimidos) % VRN*: Calcio 600 mg (75), Magnesio 250 mg (67), Vitamina D3 10 μg (200). INGREDIENTES: Carbonato de calcio, estabilizantes (celulosa microcristalina, carboximetilcelulosa sódica entrelazada, hidroxipropilmetilcelulosa), óxido magnésico, algas calcificadas 6,6%, maltodextrina, antiaglomerantes (sales magnésicas de ácidos grasos, dióxido de silicio), humectante (glicerina), agente de recubrimiento (cera de carnauba), colecalciferol.",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. Este producto no es un sustitutivo de una dieta variada y equilibrada. Por favor no exceder la dosis diaria recomendada. Mantener el envase perfectamente cerrado. Guardar en un lugar fresco y seco.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes+aviso); pricelist-2026-04 (precio/tamaño)",
  },
  {
    reference: "5847",
    complete: true,
    nutrientIds: ["calcio", "magnesio"],
    name: "Nutrilite™ Calcio y Magnesio Masticable",
    category: "Complementos alimenticios — Niños",
    size: "80 comprimidos",
    price: 16.91,
    benefits:
      "Complemento alimenticio con sabor afrutado que contiene calcio y magnesio, para niños y adultos.",
    dosage: "Tomar 2 comprimidos al día.",
    ingredients:
      "Por día (2 comprimidos) %VRN*: Calcio 540 mg (68), Magnesio 100 mg (27). INGREDIENTES: carbonato cálcico (de conchas de ostras), dextrosa, fructosa, carbonato magnésico, almidón de maíz, maltodextrina, estabilizante (goma arábiga), agente antiaglomerante (sales de magnesio de ácidos grasos), sabor natural.",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. Este producto no es un sustitutivo de una dieta equilibrada. No exceder la dosis diaria recomendada. Mantener el envase perfectamente cerrado. Guardar en un lugar fresco y seco.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes+aviso); pricelist-2026-04 (precio/tamaño)",
  },
  {
    reference: "126132",
    complete: true,
    nutrientIds: ["omega_3_6"],
    name: "Nutrilite™ Omega-3 Triple Strength",
    category: "Complementos alimenticios — Corazón",
    size: "30 cápsulas blandas",
    price: 27.98,
    benefits:
      "Favorece la función normal de la visión¹, el corazón² y cerebro³ con Nutrilite™ Omega-3 Triple Strength, formulado con tecnología AquaCelle®⁴ para lograr una mejor absorción. ¹El ácido docosahexaenoico contribuye al mantenimiento de una visión normal. Este efecto beneficioso se obtiene con la ingesta diaria de 250 mg de ácido docosahexaenoico. ²El ácido eicosapentaenoico y el ácido docosahexaenoico contribuyen al funcionamiento normal del corazón. Este efecto beneficioso se obtiene con la ingesta diaria de 250 mg de ácido eicosapentaenoico y ácido docosahexaenoico. ³El ácido docosahexaenoico contribuye a mantener el funcionamiento normal del cerebro. Este efecto beneficioso se obtiene con la ingesta diaria de 250 mg de ácido docosahexaenoico. AquaCelle® es una marca registrada de Pharmako Biotechnologies Pty Ltd.",
    dosage:
      "Toma una cápsula de gel por día, preferiblemente durante una comida.",
    ingredients:
      "Por 1 cápsula de gel: Ácidos grasos omega-3 715 mg, Ácido eicosapentaenoico 286 mg, Ácido docosahexaenoico 214 mg, Aceite de chía (Salvia hispanica) 20 mg, Vitamina E 10 mg a-TE (83% CDR). INGREDIENTES: Ácidos grasos omega-3 (procedentes del pescado) (57,8%), gelatina, humectante (glicerina), emulgentes (ésteres de poliglicerina de los ácidos grasos, lecitina), agua, aceite de lima, aceite de coco, aceite de chía (Salvia hispanica) (1,56%), D-alfa tocoferol, aceite de semillas de girasol, antioxidantes (alfa tocoferol, extracto rico en tocoferoles), aceite de oliva.",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. El complemento alimenticio no es un sustitutivo de una dieta variada y equilibrada. No exceder la dosis diaria recomendada. Mantener el envase perfectamente cerrado. Guardar en un lugar fresco y seco. Este producto no está destinado a diagnosticar, tratar, curar o prevenir ninguna enfermedad.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes); plantilla estándar del catálogo (disclaimer); pricelist-2026-04 (precio/tamaño)",
  },
  {
    reference: "122447",
    complete: true,
    nutrientIds: ["omega_3_6", "vitamina_d"],
    name: "Nutrilite™ Kids Omega-3",
    category: "Complementos alimenticios — Niños",
    size: "30 comprimidos masticables (45 g)",
    price: 28.33,
    benefits:
      "Complemento alimenticio en comprimidos masticables Kids Omega-3 de NUTRILITE™. Aceite de pescado de alta calidad en un formato delicioso y divertido. La vitamina D es necesaria para el desarrollo y el crecimiento normales de los huesos en niños. También contribuye al funcionamiento normal del sistema inmunológico.",
    dosage:
      "1 comprimido masticable, 1 vez al día. Para niños a partir de 4 años.",
    ingredients:
      "Por día (1 comprimido masticable) % VRN**: Vitamina D 4 µg (80), Ácidos grasos omega-3 288 mg (EPA 45 mg, DHA 215 mg). INGREDIENTES: aceite de pescado 27%, agua, sacarosa, trehalosa, gelatina (bovino), humectante (glicerina), corrector de acidez (citrato trisódico), aroma natural, acidulante (ácido cítrico), antioxidantes (extracto rico en tocoferoles, alfa-tocoferol, palmitato de L-ascorbilo), colorante (extracto de pimentón), aceite de girasol, triglicéridos de cadena media, vitamina D (colecalciferol), aceite de colza, antiespumante (monoglicéridos y diglicéridos de ácidos grasos). La trehalosa es una fuente de glucosa.",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. Los complementos alimenticios no son sustitutivos de una dieta variada y equilibrada y un estilo de vida saludable. No superar la dosis diaria recomendada. Guardar en lugar fresco y seco, y evitar la luz directa del sol.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes+aviso); pricelist-2026-04 (precio/tamaño)",
  },
  {
    reference: "110178",
    complete: true,
    nutrientIds: [
      "vitamina_b1", "vitamina_b2", "vitamina_b3",
      "vitamina_b6", "vitamina_b12", "acido_folico", "biotina",
    ],
    name: "Nutrilite™ Vitamina B Plus",
    category: "Complementos alimenticios — Energía",
    size: "60 comprimidos",
    price: 22.06,
    benefits:
      "El complemento alimenticio Vitamina B Plus NUTRILITE™ es un comprimido de acción dual, que combina una liberación instantánea con 8 horas de liberación prolongada, y contiene espirulina y 8 vitaminas esenciales del grupo B. Las vitaminas del grupo B apoyan el metabolismo adecuado y ayudan a reducir el cansancio y la fatiga. Además, se ha descubierto que las vitaminas B12 y B6 contribuyen al funcionamiento normal del sistema inmunitario.",
    dosage: "1 comprimido al día.",
    ingredients:
      "Por día (1 comprimido) % VRN*: Tiamina (B1) 1,1 mg (100%), Riboflavina (B2) 1,4 mg (100%), Niacina (B3) 16 mg (100%), Ácido pantoténico (B5) 6 mg (100%), Vitamina B6 1,4 mg (100%), D-biotina (B7) 50 µg (100%), Ácido fólico (B9) 200 µg (100%), Vitamina B12 2,5 µg (100%), Polvo de Espirulina (Spirulina platensis, planta entera) 80 mg. INGREDIENTES: agente de carga (fosfato dicálcico), levadura 16%, polvo de espirulina 15% (Spirulina platensis), lactosa, estabilizantes (hidroxipropil metilcelulosa, celulosa microcristalina, carboximetilcelulosa sódica reticulada), nicotinamida, D-pantotenato cálcico, antiaglomerantes (dióxido de silicona, sales de magnesio de ácidos grasos), hidrocloruro de piridoxina, riboflavina, mononitrato de tiamina, humectante (glicerol), ácido teroilmonoglutámico, agente de recubrimiento (cera de carnauba), D-biotina, cianocobalamina.",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. No apto para niños menores de 3 años. Este producto no es sustitutivo de una dieta equilibrada. No exceder la dosis diaria recomendada. Mantener el envase bien cerrado. Conservar en lugar fresco y seco.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes+aviso); pricelist-2026-04 (precio/tamaño)",
  },
  {
    reference: "109741",
    complete: true,
    nutrientIds: ["vitamina_c"],
    name: "Nutrilite™ Vitamina C Plus",
    category: "Complementos alimenticios — Sistema inmunitario",
    size: "60 comprimidos",
    price: 23.98,
    benefits:
      "Complemento de vitamina C sumamente eficaz, diseñado para liberar vitamina C de forma lenta y continua. Vitamina C Plus Nutrilite™ es un complemento alimenticio altamente eficaz que aporta un suministro lento y constante de vitamina C durante todo el día para apoyar la función inmunitaria normal. La vitamina C te ayuda a mantener la producción normal de colágeno y ayuda a proteger las células del estrés oxidativo (gracias a sus propiedades antioxidantes).",
    dosage: "1 comprimido diario.",
    ingredients:
      "Por 1 comprimido %VRN*: Vitamina C 240 mg (300%). INGREDIENTES: ácido L-ascórbico (vitamina C), estabilizantes (celulosa microcristalina, hidroxipropilmetilcelulosa, metilcelulosa), extracto de cereza acerola 15% (Malpighia punicifolia), pomelo concentrado (Citrus paradisi), mandarina concentrada (Citrus reticulata x C. sinensis), antiaglomerantes (sales magnésicas de ácidos grasos, dióxido de silicio), maltodextrina, limón concentrado (Citrus limon), humectante (glicerina), agente de recubrimiento (cera de carnauba).",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. El complemento alimenticio no es un sustitutivo de una dieta variada y equilibrada. No exceder la dosis diaria recomendada. Mantener el envase perfectamente cerrado. Guardar en lugar fresco y seco.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes+aviso); pricelist-2026-04 (precio/tamaño)",
  },
  {
    reference: "109743",
    complete: true,
    nutrientIds: ["vitamina_c"],
    name: "Nutrilite™ Vitamina C Plus Tamaño Familiar",
    category: "Complementos alimenticios — Sistema inmunitario",
    size: "180 comprimidos",
    price: 59.04,
    benefits:
      "Complemento de vitamina C sumamente eficaz, diseñado para liberar vitamina C de forma lenta y continua. Vitamina C Plus Nutrilite™ es un complemento alimenticio altamente eficaz que aporta un suministro lento y constante de vitamina C durante todo el día para apoyar la función inmunitaria normal. La vitamina C te ayuda a mantener la producción normal de colágeno y ayuda a proteger las células del estrés oxidativo (gracias a sus propiedades antioxidantes).",
    dosage: "1 comprimido diario.",
    ingredients:
      "Por 1 comprimido %VRN*: Vitamina C 240 mg (300%). INGREDIENTES: ácido L-ascórbico (vitamina C), estabilizantes (celulosa microcristalina, hidroxipropilmetilcelulosa, metilcelulosa), extracto de cereza acerola 15% (Malpighia punicifolia), pomelo concentrado (Citrus paradisi), mandarina concentrada (Citrus reticulata x C. sinensis), antiaglomerantes (sales magnésicas de ácidos grasos, dióxido de silicio), maltodextrina, limón concentrado (Citrus limon), humectante (glicerina), agente de recubrimiento (cera de carnauba).",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. El complemento alimenticio no es un sustitutivo de una dieta variada y equilibrada. No exceder la dosis diaria recomendada. Mantener el envase perfectamente cerrado. Guardar en lugar fresco y seco.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes+aviso); pricelist-2026-04 (precio/tamaño)",
  },
  {
    reference: "110415",
    complete: true,
    nutrientIds: ["proteina_vegetal"],
    name: "Nutrilite™ Proteína Vegetal",
    category: "Complementos alimenticios fundamentales",
    size: "450 g",
    price: 45.83,
    benefits:
      "Preparado alimenticio que proporciona proteína 100 % natural. Proteína Vegetal Nutrilite™ es una alternativa equilibrada y saludable a las formas más tradicionales de proteína y contiene los nueve aminoácidos esenciales que contribuyen a una buena salud. Una cucharada aporta una ración de 8 g de proteína.",
    dosage:
      "Según la necesidad, agregar una cucharada (aproximadamente 10 g) de polvo a la leche u otra bebida una o varias veces por día. Remueve rápidamente o agítalo en un recipiente con cierre hermético durante 1 minuto. Alternativamente, espolvorea sobre cereales, sopas, ensaladas u otros alimentos.",
    ingredients:
      "Por ración (10 g) / por 100 g: Energía 170/40 kJ/Kcal – 1700/400 kJ/Kcal, Grasas 0,48 g – 4,8 g (ácidos grasos saturados 0,06 g – 0,6 g), Hidratos de carbono 0,32 g – 3,2 g (azúcares 0 g – 0 g), Proteínas 8 g – 80 g, Sal 0,23 g – 2,3 g. Aminoácidos esenciales por ración: Isoleucina 390 mg, Leucina 660 mg, Lisina 510 mg, Metionina y Cistina 220 mg, Fenilalanina y Tirosina 750 mg, Treonina 310 mg, Triptófano 120 mg, Valina 400 mg, Histidina 210 mg. INGREDIENTES: proteína de soja (81%), proteína de trigo (10%), proteína de guisante (7,5%), emulsionante (lecitina de soja), agente antiaglomerante (dióxido de silicio).",
    disclaimer:
      "No recomendado para niños menores a 3 años sin el consejo médico previo a su uso. Mantener el envase perfectamente cerrado. Conservar en un lugar fresco y seco.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes+aviso); pricelist-2026-04 (precio/tamaño)",
  },
  {
    reference: "120571",
    complete: true,
    nutrientIds: ["vitamina_b6", "acido_folico"],
    name: "Nutrilite™ Probiotics Balance Within",
    category: "Complementos alimenticios fundamentales",
    size: "30 sobres",
    price: 49.72,
    benefits:
      "Un complemento alimenticio fácil de usar que puede proporcionarle una ayuda invisible a tu sistema inmunitario gracias a dos tipos de vitamina B. La vitamina B6 y el ácido fólico (vitamina B9) contribuyen al funcionamiento normal del sistema inmunológico. Nutrilite Balance Within Probiotics es un complemento alimenticio que contiene 6000 millones de unidades de dos cepas de bacterias probióticas científicamente documentadas.",
    dosage:
      "1 sobre al día. No tienes más que abrir un sobre, verter suavemente el polvo sobre la lengua y dejar que se disuelva. También lo puedes mezclar con una bebida fría o a temperatura ambiente (por ejemplo, zumo o agua). No necesita refrigerarse.",
    ingredients:
      "Por día (1 sobre) %VRN*: Vitamina B6 1,4 mg (100), Ácido fólico (vitamina B9) 200 μg (100), Bacterias productoras de ácido láctico: Bifidobacterium animalis subespecie lactis HN019™ 5 × 10^9 ufc, Lactobacillus acidophilus NCFM™ 1 × 10^9 ufc. INGREDIENTES: Agente de carga (isomaltosa), Bifidobacterium animalis subespecie lactis HN019™, Lactobacillus acidophilus NCFM™, antiaglomerante (dióxido de silicio), clorhidrato de piridoxina, ácido pteroilmonoglutámico, sabor vainilla (contiene leche).",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. El complemento alimenticio no es un sustitutivo de una dieta variada y equilibrada. No exceder la dosis diaria recomendada. Mantener el envase perfectamente cerrado. Guardar en un lugar fresco y seco. Este producto no está destinado a diagnosticar, tratar, curar o prevenir ninguna enfermedad.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes); plantilla estándar del catálogo (disclaimer); pricelist-2026-04 (precio/tamaño)",
  },
  {
    reference: "119797",
    complete: true,
    nutrientIds: ["vitamina_d"],
    name: "Nutrilite™ Vitamina D",
    category: "Complementos alimenticios — Huesos",
    size: "90 comprimidos",
    price: 22.97,
    benefits:
      "Este complemento alimenticio con vitamina D procedente de fuentes naturales, contribuye al mantenimiento normal de huesos y dientes, a la función de los músculos y a las funciones normales del sistema inmunológico. Con una dosis diaria de 15 µg (600 IU) de vitamina D de origen natural, este complemento contribuye a unos huesos y dientes sanos, así como al bien funcionamiento del sistema inmunitario y la función de los músculos.",
    dosage: "Tomar un comprimido al día, con o sin comida.",
    ingredients:
      "Por día (1 comprimido) % NRV: Vitamina D 15 μg (300). INGREDIENTES: maltodextrina, estabilizantes (celulosa microcristalina, carboximetilcelulosa sódica reticulada, hidroxipropilmetilcelulosa), levadura con vitamina D 3%, almidón modificado, antiaglomerantes (dióxido de silicio, ácidos grasos), sacarosa, antioxidantes (ascorbato sódico, alfa-tocoferol), humectante (glicerina), triglicéridos de cadena media, colecalciferol, agente de recubrimiento (cera de carnauba).",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. Los complementos alimenticios no son sustitutivos de una dieta equilibrada y variada y un estilo de vida saludable. No exceder la dosis diaria recomendada. Mantener el frasco bien cerrado. Conservar en lugar fresco y seco. Además, una dieta variada y equilibrada y un estilo de vida saludable son de gran importancia.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes+aviso); pricelist-2026-04 (precio/tamaño)",
  },
  {
    reference: "100295",
    complete: true,
    nutrientIds: ["ferro", "acido_folico"],
    name: "Nutrilite™ Hierro Fólico Plus",
    category: "Complementos alimenticios — Apoyo para mujeres",
    size: "120 comprimidos",
    price: 16.54,
    benefits:
      "Complemento alimenticio que contiene hierro de dos fuentes distintas junto con ácido fólico. Contiene dos fuentes de hierro: fumarato ferroso y gluconato ferroso, y el exclusivo Concentrado de Espinaca NUTRILITE. El folato (ácido fólico) participa en el crecimiento del tejido materno durante el embarazo y la formación sanguínea adecuada; el hierro y el folato forman parte del proceso de división celular.",
    dosage:
      "Para una complementación alimenticia de hierro y ácido fólico, tomar 1 comprimido por día. Para mujeres embarazadas y en período de lactancia, tomar 1 ó 2 comprimidos por día. No exceder la dosis diaria recomendada.",
    ingredients:
      "Por día (1 comprimido) %VRN*: Ácido Fólico 150 μg (75), Hierro 10 mg (71). INGREDIENTES: carbonato cálcico (de conchas de ostras), concentrado de espinaca (Spinacia oleracea), gluconato ferroso, maltrodextrina, estabilizantes (celulosa microcristalina, carboximetilcelulosa sódica reticulada, goma arábiga, metilcelulosa), fumarato ferroso, antiaglomerantes (dióxido de silicio, sales magnésicas de ácidos grasos), humectante (glicerina), ácido pteroilmonoglutámico, agente de recubrimiento (cera de carnauba).",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. El complemento alimenticio no es un sustitutivo de una dieta variada y equilibrada. Por favor, no exceder la dosis diaria recomendada. Guardar en lugar fresco y seco.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes+aviso); pricelist-2026-04 (precio/tamaño)",
  },
  {
    reference: "100108",
    complete: true,
    nutrientIds: ["glucosamina_boswellia", "vitamina_c"],
    name: "Nutrilite™ Glucosamina con Boswellia",
    category: "Complementos alimenticios adicionales",
    size: "150 cápsulas",
    price: 29.4,
    benefits:
      "Complemento alimenticio con glucosamina y boswellia (una hierba tradicional de la India). La glucosamina se encuentra de forma natural en el cuerpo, ya que es un componente del cartílago. Este complemento alimenticio contiene también extracto de Boswellia serrata para apoyar la salud y la flexibilidad de las articulaciones. También contiene vitamina C, en forma de concentrado de acerola y concentrados de pomelo, mandarina real y limón NUTRILITE™, para apoyar la función normal del sistema inmunitario.",
    dosage: "Tomar 2 cápsulas al día (1 cápsula 2 veces al día) con agua.",
    ingredients:
      "Por cápsula: Clorhidrato de glucosamina 250 mg, Extracto del Boswellia 18,8 mg, Concentrado de cítricos 5,9 mg, Concentrado de cereza Acerola 3,5 mg. INGREDIENTES: clorhidrato de glucosamina (de crustáceos, moluscos), estabilizador (celulosa microcristalina), gelatina, extracto de boswellia (Boswellia serrata), antiaglomerantes (ácidos grasos, dióxido de silicio), concentrado de cereza acerola (Malpighia punicifolia), concentrado de cítricos (pomelo/Citrus paradisi; mandarina/Citrus reticulata, limón/Citrus limon).",
    disclaimer:
      "Mantener fuera del alcance de los niños más pequeños. Los complementos alimenticios no deben utilizarse como sustituto de una dieta equilibrada. Por favor, no exceda la dosis diaria recomendada. Mantener el frasco correctamente cerrado. Conservar en lugar fresco y seco.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes+aviso); pricelist-2026-04 (precio/tamaño)",
  },
  {
    reference: "102736",
    complete: true,
    nutrientIds: ["fibra_polvo"],
    name: "Nutrilite™ Fibra en Polvo",
    category: "Complementos alimenticios — Control del peso",
    size: "30 sobres de 6 g",
    price: 43.74,
    benefits:
      "Complemento alimenticio en forma de polvo, que contiene una mezcla de tres fibras solubles extraídas de fuentes vegetales naturales. Esta fibra en polvo es fácil de mezclar, no tiene sabor y se puede espolvorear sobre comidas o mezclar con bebidas; está formulada para ser suave con el estómago.",
    dosage:
      "Disuelve el contenido de un sobre en 250–375 ml de agua o zumo, o espolvoréalo sobre la comida y bebe un vaso entero (250 ml) de agua con cada sobre. Los adultos y niños mayores de 12 años pueden consumir de uno a dos sobres al día, aumentando gradualmente la toma de fibra. Se recomienda consumir con la comida.",
    ingredients:
      "Por dosis (6 g) / en 100 g: Energía 50 kJ (12 kcal) – 833 kJ (200 kcal), Grasa 0 g – 0 g (saturada 0 g – 0 g), Carbohidratos 0,6 g – 10 g (azúcares 0,5 g – 8 g), Fibra 5 g – 83 g, Proteína 0 g – 0 g, Sodio 0 g – 0,08 g. INGREDIENTES: Maltodextrina Resistente, inulina (Cichorium intybus), Goma Guar Parcialmente Hidrolizada.",
    disclaimer:
      "Además, una dieta variada y equilibrada y un estilo de vida saludable son de gran importancia. Manténgase fuera del alcance de los niños más pequeños.",
    source: "amway.es PDP (beneficios+dosisis+ingredientes+aviso); pricelist-2026-04 (precio/tamaño)",
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