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

  it("does not expose flagged-incomplete products (Double X still requires human curation)", () => {
    const catalog = createCatalogService(db);
    expect(catalog.lookup("121576").found).toBe(false);
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

    const byRef = new Map(PRICE_LIST_PRODUCTS.map((r) => [r.reference, r]));
    expect(byRef.get("5847")?.price).toBe(16.91);
    expect(byRef.get("110415")?.price).toBe(45.83);
    // Already-curated refs must NOT be duplicated in the generated module.
    expect(byRef.has("100305")).toBe(false);
    expect(byRef.has("100930")).toBe(false);
    expect(byRef.has("121576")).toBe(false);
  });

  it("seed: pricelist rows are FLAGGED — never inserted — exactly like the incomplete path", async () => {
    const { PRICE_LIST_PRODUCTS } = await import("../src/seed/priceListProducts.js");
    const catalog = createCatalogService(db);

    expect(PRICE_LIST_PRODUCTS.length).toBeGreaterThan(0);
    for (const row of PRICE_LIST_PRODUCTS) {
      expect(catalog.lookup(row.reference).found).toBe(false);
      expect(seedResult.flagged.some((f) => f.reference === row.reference)).toBe(true);
    }
    // Only the two complete curated products are in the DB.
    expect(catalog.listAll()).toHaveLength(2);
    // Flagged list never double-flags a reference (curated wins on collision).
    const flaggedRefs = seedResult.flagged.map((f) => f.reference);
    expect(new Set(flaggedRefs).size).toBe(flaggedRefs.length);
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