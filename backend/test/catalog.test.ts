import { describe, it, expect, beforeAll } from "vitest";
import { createDatabase } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { seedProducts } from "../src/seed/seedProducts.js";
import { createCatalogService } from "../src/services/catalogService.js";
import type { Db } from "../src/db/client.js";

let db: Db;
let seedResult: Awaited<ReturnType<typeof seedProducts>>;

beforeAll(async () => {
  db = createDatabase(":memory:");
  await migrate(db);
  seedResult = await seedProducts(db);
});

describe("catalogService", () => {

  it("returns full product data for a valid reference (no invention — transcribed from PDFs)", () => {
    const catalog = createCatalogService(db);
    const result = catalog.lookup("100305");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.product.name).toBe("Nutrilite™ Biotina C Plus");
      expect(result.product.category).toBe("Complementos alimenticios — Cabello y piel");
      expect(result.product.size).toBe("90 comprimidos");
      expect(result.product.price).toBe(24.04);
      expect(result.product.dosage).toContain("2 comprimidos al día");
      expect(result.product.disclaimer.length).toBeGreaterThan(10);
    }
  });

  it("returns the masticable multivitamin with its structured fields", () => {
    const catalog = createCatalogService(db);
    const result = catalog.lookup("100930");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.product.name).toContain("Masticable");
      expect(result.product.ingredients).toContain("Vitamina D");
      expect(result.product.benefits.length).toBeGreaterThan(10);
    }
  });

  it("returns not-found for an absent reference and never invents details", () => {
    const catalog = createCatalogService(db);
    const result = catalog.lookup("999999");
    expect(result.found).toBe(false);
  });

  it("returns not-found for an empty or blank reference", () => {
    const catalog = createCatalogService(db);
    expect(catalog.lookup("").found).toBe(false);
    expect(catalog.lookup("   ").found).toBe(false);
  });

  it("does not expose flagged-incomplete products (price-list rows stay hidden until curated)", () => {
    const catalog = createCatalogService(db);
    // 121576 Double X is now complete and inserted; the flagged path is still
    // exercised by the price-list backlog rows (all complete:false).
    expect(catalog.lookup("121576").found).toBe(true);
    expect(catalog.lookup("125167").found).toBe(false); // Cotidiano — pricelist row, flagged
  });

  it("lists all curated catalog products without duplicates after re-seed", async () => {
    await seedProducts(db); // idempotent re-run
    const catalog = createCatalogService(db);
    const all = catalog.listAll();
    const refs = all.map((p) => p.reference);
    expect(new Set(refs).size).toBe(all.length); // no duplicates
    expect(refs).toContain("100305");
    expect(refs).toContain("100930");
  });
});

describe("T2 — PDP section extractor (pdpParser.ts)", () => {
  // Inline fixture mirroring the amway.es PDP raw-HTML RSC payload: JSON
  // fragments with \uXXXX-escaped, HTML-tagged section content — in BOTH
  // orders the live payload uses (content→sectionType, content→sectionTypeCode),
  // plus one duplicated fragment (RSC stream + hydration copy).
  const FIXTURE = [
    '<div>{"code":"details_110606W","content":"\\u003cp\\u003e\\u003cstrong\\u003eUso sugerido\\u003c/strong\\u003e\\u003c/p\\u003e\\u003cdiv\\u003eDosis recomendada\\u003c/div\\u003e\\u003cli\\u003eTomar 3 comprimidos por día.\\u003c/li\\u003e","sectionType":"Detalles","visibleForCurrentUser":true}</div>',
    '<div>{"code":"overview_110606W","content":"\\u003cp\\u003eTres nutrientes naturales: calcio, magnesio y vitamina D.\\u003c/p\\u003e","sectionType":"Vista general","visibleForCurrentUser":true}</div>',
    '<div>{"code":"details_110606W","content":"\\u003cp\\u003e\\u003cstrong\\u003eUso sugerido\\u003c/strong\\u003e\\u003c/p\\u003e\\u003cdiv\\u003eDosis recomendada\\u003c/div\\u003e\\u003cli\\u003eTomar 3 comprimidos por día.\\u003c/li\\u003e","sectionType":"Detalles","visibleForCurrentUser":true}</div>',
    '<div>{"code":"suggested_100108W","content":"\\u003cp\\u003eTomar 2 c\\u00e1psulas al d\\u00eda.\\u003c/p\\u003e","sectionTypeCode":"suggested"}</div>',
  ].join("\n");

  it("extractPdpSections: decodes unicode-escaped JSON content, strips HTML, dedupes repeated sections", async () => {
    const { extractPdpSections } = await import("../src/seed/pdpParser.js");
    const sections = extractPdpSections(FIXTURE);
    const types = sections.map((s) => s.sectionType);
    // Duplicated RSC+hydration copy collapses to one entry.
    expect(types.filter((t) => t === "Detalles")).toHaveLength(1);
    const detalles = sections.find((s) => s.sectionType === "Detalles");
    expect(detalles?.text).toContain("Tomar 3 comprimidos por día.");
    expect(detalles?.text).not.toContain("<"); // HTML tags stripped
    const overview = sections.find((s) => s.sectionType === "Vista general");
    expect(overview?.text).toContain("calcio, magnesio y vitamina D");
    // sectionTypeCode-only fragment falls back to its code as the type label.
    const sugerido = sections.find((s) => s.sectionType === "suggested");
    expect(sugerido?.text).toContain("Tomar 2 cápsulas al día.");
    expect(sections).toHaveLength(3);
  });

  it("extractPdpSections: a page without section payloads yields an empty list — never invented", async () => {
    const { extractPdpSections } = await import("../src/seed/pdpParser.js");
    expect(extractPdpSections("<html><body>Sin secciones</body></html>")).toEqual([]);
  });
});

describe("T2 — video-mentioned batch curation (amway.es PDP transcription)", () => {
  // The batch selected by the parent's keyword scan over priceListProducts.ts
  // (individual supplements only; sets/conjuntos excluded).
  const BATCH = [
    "110606", "5847", "126132", "122447", "110178", "109741", "109743",
    "110415", "120571", "119797", "100295", "100108", "102736", "121576",
  ];

  it("every batch ref is a complete curated entry with all four required fields sourced", async () => {
    const { CURATED_PRODUCTS } = await import("../src/seed/curatedProducts.js");
    const byRef = new Map(CURATED_PRODUCTS.map((p) => [p.reference, p]));
    for (const ref of BATCH) {
      const entry = byRef.get(ref);
      expect(entry, `missing curated entry for ${ref}`).toBeDefined();
      expect(entry!.complete, `${ref} must be complete (all fields sourced)`).toBe(true);
      expect(entry!.source, `${ref} must record its source`).toBeTruthy();
      expect(entry!.benefits!.length, `${ref} benefits`).toBeGreaterThan(20);
      expect(entry!.dosage!.length, `${ref} dosage`).toBeGreaterThan(5);
      expect(entry!.ingredients!.length, `${ref} ingredients`).toBeGreaterThan(20);
      expect(entry!.disclaimer!.length, `${ref} disclaimer`).toBeGreaterThan(20);
    }
  });

  it("batch entries are seeded and lookups return transcribed fields (spot-check vs source)", () => {
    const catalog = createCatalogService(db);
    // 110606 Cal Mag D Plus — PDP "Dosis recomendada: Tomar 3 comprimidos por día…"
    const calMag = catalog.lookup("110606");
    expect(calMag.found).toBe(true);
    if (calMag.found) {
      expect(calMag.product.price).toBe(29.71);
      expect(calMag.product.dosage).toContain("3 comprimidos por día");
      expect(calMag.product.benefits).toContain("calcio, magnesio y vitamina D");
      expect(calMag.product.ingredients).toContain("Carbonato de calcio");
    }
    // 110415 Proteína Vegetal — PDP "INGREDIENTES: proteína de soja (81%)…"
    const proteina = catalog.lookup("110415");
    expect(proteina.found).toBe(true);
    if (proteina.found) {
      expect(proteina.product.ingredients).toContain("proteína de soja (81%)");
      expect(proteina.product.dosage).toContain("cucharada");
    }
    // 120571 Probiotics — PDP "DOSIS RECOMENDADA: 1 sobre al día"
    const probiotics = catalog.lookup("120571");
    expect(probiotics.found).toBe(true);
    if (probiotics.found) {
      expect(probiotics.product.dosage).toContain("1 sobre al día");
      expect(probiotics.product.ingredients).toContain("HN019");
    }
    // 100108 Glucosamina — PDP "Tomar 2 cápsulas al día (1 cápsula 2 veces al día)"
    const glucosamina = catalog.lookup("100108");
    expect(glucosamina.found).toBe(true);
    if (glucosamina.found) {
      expect(glucosamina.product.dosage).toContain("2 cápsulas al día");
      expect(glucosamina.product.ingredients).toContain("boswellia");
    }
  });

  it("Double X 121576: complete from its PDP, price kept at the calibrated 86.87, seeded", () => {
    const catalog = createCatalogService(db);
    const dx = catalog.lookup("121576");
    expect(dx.found).toBe(true);
    if (dx.found) {
      expect(dx.product.price).toBe(86.87); // PDP shows € 86,87 — calibrated column
      expect(dx.product.size).toBe("186 comprimidos");
      // PDP "Modo de empleo": "DOSIS RECOMENDADA: Adultos: tomar un comprimido
      // de vitaminas, uno de minerales y uno de fitonutrientes dos veces al día…"
      expect(dx.product.dosage).toContain("dos veces al día con las comidas");
      expect(dx.product.benefits).toContain("PhytoBlend");
      // PDP "Ingredientes": third tablet list is the phytonutrient one.
      expect(dx.product.ingredients).toContain("COMPRIMIDO DE FITONUTRIENTES");
      expect(dx.product.ingredients).toContain("extracto de romero");
      expect(dx.product.disclaimer).toContain("mujeres embarazadas");
    }
  });

  it("T2 complete entries carry a source; no complete entry has empty required fields", async () => {
    const { CURATED_PRODUCTS } = await import("../src/seed/curatedProducts.js");
    const byRef = new Map(CURATED_PRODUCTS.map((p) => [p.reference, p]));
    for (const ref of BATCH) {
      expect(byRef.get(ref)!.source, `${ref} must record its source`).toBeTruthy();
    }
    // The two pre-T2 entries predate the `source` field and are untouchable;
    // every complete entry must still carry non-empty required fields.
    for (const p of CURATED_PRODUCTS.filter((e) => e.complete)) {
      for (const f of ["benefits", "dosage", "ingredients", "disclaimer"] as const) {
        expect((p[f] ?? "").length, `${p.reference}.${f}`).toBeGreaterThan(10);
      }
    }
  });
});

describe("T1 — price-list extraction (curate-pricelist.ts)", () => {
  // Inline fixture captured verbatim from docs/PriceList_April-2026_ES.pdf
  // pages 3–5 (`pdftotext -layout`), including one conjunto row WITHOUT the
  // unit-price token, one 4-digit ref with a 2-space indent, and one
  // flavour-variant listing that carries a ref but no price columns.
  const FIXTURE = [
    " Ref.                                Descripción                                Cantidad       VP      VN                                                          cliente    Canarias",
    "                                                                                                                medida para EA",
    "                                                                                                                              con IVA      + IGIC",
    "                                                                                                                              Península + IVA",
    "",
    " Nutrición",
    "",
    " Destination Wellbeing",
    "127059 Conjunto Nutrilite™ Body Cleansing Program                                  1 conjunto 64,74    143,04     157,34                                            188,81      157,34      157,34",
    "",
    " Apoyo para mujeres",
    "100295 Hierro Fólico Plus Nutrilite™                                        120 comp.     5,67    12,53               13,78                 19,14 / 100 g       16,54       14,19                  13,78",
    "100305 Biotina C Plus Nutrilite™                                             90 comp.     8,24    18,21               20,03                 46,58 / 100 g       24,04       20,63                  20,03",
    " Apoyo para hombres",
    "  8004 Saw Palmetto y Raíz de Ortiga Nutrilite™                             100 cáps.    23,02    50,86               55,95                  77,71 / 100 g      67,14       57,63                  55,95",
    " Niños",
    "100930 Multivitaminas Masticable Nutrilite™                                 120 comp.    11,38    25,14               27,65                  18,68 / 100 g       33,18       28,48                  27,65",
    "  5847 Calcio y Magnesio Masticable Nutrilite™                                80 comp.     5,80    12,81               14,09                  8,70 / 100 g       16,91       14,51                  14,09",
    "",
    " Estilo de vida activo",
    "        118766    Wild Berry Flavour - Sabor 122109   Orange Kumquat Flavour -",
    "                  Baya Silvestre                      Sabor Naranja",
  ].join("\n");

  it("parsePriceListText: price = first number after the optional unit-price token (anchors 100305→24.04, 100930→33.18)", async () => {
    const { parsePriceListText } = await import("../src/seed/curate-pricelist.js");
    const { rows } = parsePriceListText(FIXTURE);
    const byRef = new Map(rows.map((r) => [r.reference, r]));

    expect(byRef.get("100305")?.price).toBe(24.04);
    expect(byRef.get("100930")?.price).toBe(33.18);
    // 4-digit ref, 2-space indent, unit-price token present.
    expect(byRef.get("5847")?.price).toBe(16.91);
    // Row WITHOUT a unit-price token: price is still the first number after
    // the VP/VN/3rd-number triplet ("Precio al cliente con IVA Península").
    expect(byRef.get("127059")?.price).toBe(188.81);
  });

  it("parsePriceListText: extracts name/size/category from tracked section headers", async () => {
    const { parsePriceListText } = await import("../src/seed/curate-pricelist.js");
    const { rows } = parsePriceListText(FIXTURE);
    const byRef = new Map(rows.map((r) => [r.reference, r]));

    expect(rows).toHaveLength(6);
    expect(byRef.get("100305")?.name).toBe("Biotina C Plus Nutrilite™");
    expect(byRef.get("100305")?.size).toBe("90 comp.");
    expect(byRef.get("100305")?.category).toBe("Apoyo para mujeres");
    expect(byRef.get("100930")?.category).toBe("Niños");
    expect(byRef.get("5847")?.name).toContain("Calcio y Magnesio Masticable");
    expect(byRef.get("5847")?.category).toBe("Niños");
    expect(byRef.get("8004")?.category).toBe("Apoyo para hombres");
    expect(byRef.get("127059")?.category).toBe("Destination Wellbeing");
    expect(byRef.get("127059")?.size).toBe("1 conjunto");
  });

  it("parsePriceListText: rows without a price go to parse_warnings — never guessed", async () => {
    const { parsePriceListText } = await import("../src/seed/curate-pricelist.js");
    const { rows, warnings } = parsePriceListText(FIXTURE);

    // The flavour-variant listing carries ref 118766 but no price columns.
    expect(rows.some((r) => r.reference === "118766")).toBe(false);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const variantWarning = warnings.find((w) => w.line.includes("118766"));
    expect(variantWarning).toBeDefined();
    // Wrapped continuation text is joined, not lost.
    expect(variantWarning?.line).toContain("Baya Silvestre");
  });

  it("generated PRICE_LIST_PRODUCTS module: rows complete:false, count within 60–90, no curated-ref collisions", async () => {
    const { PRICE_LIST_PRODUCTS } = await import("../src/seed/priceListProducts.js");
    const { CURATED_PRODUCTS } = await import("../src/seed/curatedProducts.js");

    expect(PRICE_LIST_PRODUCTS.length).toBeGreaterThanOrEqual(60);
    expect(PRICE_LIST_PRODUCTS.length).toBeLessThanOrEqual(90);

    const curatedRefs = new Set(CURATED_PRODUCTS.map((p) => p.reference));
    for (const row of PRICE_LIST_PRODUCTS) {
      expect(row.complete).toBe(false); // never fabricated
      expect(row.nutrientIds).toEqual([]);
      expect(row.source).toBe("pricelist-2026-04");
      expect(row.reference).toMatch(/^\d{4,6}$/);
      expect(row.name).toBeTruthy();
      expect(typeof row.price).toBe("number");
      expect(row.price).toBeGreaterThan(0);
      expect(curatedRefs.has(row.reference)).toBe(false); // curated wins — skipped
    }

    // Refs now curated in CURATED_PRODUCTS (T2 batch) must NOT be duplicated
    // in the generated module — their prices live on the curated entries.
    const curatedByRef = new Map(CURATED_PRODUCTS.map((p) => [p.reference, p]));
    expect(curatedByRef.get("5847")?.price).toBe(16.91);
    expect(curatedByRef.get("110415")?.price).toBe(45.83);
    const moduleRefs = new Set(PRICE_LIST_PRODUCTS.map((r) => r.reference));
    expect(moduleRefs.has("5847")).toBe(false);
    expect(moduleRefs.has("110415")).toBe(false);
    expect(moduleRefs.has("100305")).toBe(false);
    expect(moduleRefs.has("100930")).toBe(false);
    expect(moduleRefs.has("121576")).toBe(false);
  });

  it("seed: pricelist rows are FLAGGED — never inserted — exactly like the incomplete path", async () => {
    const { PRICE_LIST_PRODUCTS } = await import("../src/seed/priceListProducts.js");
    const { CURATED_PRODUCTS } = await import("../src/seed/curatedProducts.js");
    const catalog = createCatalogService(db);

    expect(PRICE_LIST_PRODUCTS.length).toBeGreaterThan(0);
    for (const row of PRICE_LIST_PRODUCTS) {
      expect(catalog.lookup(row.reference).found).toBe(false);
      expect(seedResult.flagged.some((f) => f.reference === row.reference)).toBe(true);
    }
    // Exactly the complete curated entries are in the DB (T2 batch incl.
    // Double X). No incomplete curated entries remain; the flagged backlog is
    // the price-list rows only.
    const completeCount = CURATED_PRODUCTS.filter((p) => p.complete).length;
    expect(completeCount).toBe(16); // 2 originals + 14 batch entries (13 + 121576)
    expect(catalog.listAll()).toHaveLength(completeCount);
    // Flagged list never double-flags a reference (curated wins on collision).
    const flaggedRefs = seedResult.flagged.map((f) => f.reference);
    expect(new Set(flaggedRefs).size).toBe(flaggedRefs.length);
    // 121576 is complete → inserted, NOT flagged.
    expect(seedResult.flagged.some((f) => f.reference === "121576")).toBe(false);
  });

  it("seed: ref collision prefers CURATED over PRICE_LIST (pure merge rule)", async () => {
    const { preferCuratedByReference } = await import("../src/seed/seedProducts.js");
    const curated = [
      { reference: "100305", complete: true },
      { reference: "121576", complete: false },
    ];
    const pricelist = [
      { reference: "100305", complete: false, source: "pricelist-2026-04" },
      { reference: "121576", complete: false, source: "pricelist-2026-04" },
      { reference: "999002", complete: false, source: "pricelist-2026-04" },
    ];
    const { kept, dropped } = preferCuratedByReference(curated, pricelist);
    expect(kept.map((r) => r.reference)).toEqual(["999002"]);
    expect(dropped.sort()).toEqual(["100305", "121576"]);
  });
});