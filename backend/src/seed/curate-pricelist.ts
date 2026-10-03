import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CuratedProduct } from "./curatedProducts.js";
import { CURATED_PRODUCTS } from "./curatedProducts.js";

/**
 * Price-list catalog extractor (catalog-video-products T1).
 *
 * Parses the Nutrition section (pages 3–6) of docs/PriceList_April-2026_ES.pdf
 * via `pdftotext -layout` and re-generates backend/src/seed/priceListProducts.ts
 * — a CuratedProduct[] of every ref row, all `complete: false`.
 *
 * Column calibration (verified against existing curation):
 *   ref | descripción | cantidad | VP | VN | 3er nº | [N,NN / 100 g] | Precio |
 *   Canarias | +IGIC
 *   → `price` = the FIRST number AFTER the optional unit-price token
 *     ("Precio al cliente con IVA Península").
 *   Anchors asserted on every run: 100305 → 24.04, 100930 → 33.18.
 *
 * Rows that do not yield a price are collected into `parse_warnings` — never
 * guessed. Refs already present in CURATED_PRODUCTS are skipped (the curated
 * entry wins on collision). Benefits/dosage/ingredients/disclaimer are NEVER
 * fabricated: every emitted row stays `complete: false` until a detail source
 * (ficha PDF / amway.es) is transcribed with provenance.
 */

export interface PriceListRow {
  reference: string;
  name: string;
  size: string | null;
  price: number;
  category: string | null;
}

export interface PriceListParseWarning {
  /** The offending line (continuation text joined when wrapped). */
  line: string;
  reason: string;
}

export interface PriceListParseResult {
  rows: PriceListRow[];
  warnings: PriceListParseWarning[];
}

/** A product row: line start, 4–6 digit ref, then description. */
const ROW_RE = /^\s*(\d{4,6})\s+(.*)$/;
/**
 * Trailing price columns:
 *   VP VN 3erNº [unit-price token] Península Canarias+IVA Canarias+IGIC
 * Spanish decimals (`N,NN`). Group 4 = optional unit-price token
 * (`N,NN / 100 g|ml`); group 5 = "Precio al cliente con IVA Península".
 */
const PRICE_TAIL_RE =
  /(\d{1,3},\d{2})\s+(\d{1,3},\d{2})\s+(\d{1,3},\d{2})(?:\s+(\d{1,3},\d{2})\s*\/\s*100\s*(?:g|ml))?\s+(\d{1,3},\d{2})\s+(\d{1,3},\d{2})\s+(\d{1,3},\d{2})\s*$/;
/** Trailing size column, used only when description/size share one chunk. */
const SIZE_RE =
  /\s(\d[\d.,]*(?:\s*x\s*[\d.,]+\s*)?(?:g|ml|comp\.|cáps\.|sobres|barritas|gominolas|conjunto))\s*$/;
/** Page header/footer garbage (incl. 180°-rotated headers from pdftotext). */
const PAGE_NOISE_RE =
  /Ref\.|Precio|unidad|cliente|Canarias|IGIC|Península|medida|con IVA|\bVP\b|\bVN\b|\bAVI\b|atueC|alusníneP|sotseupmi|allileM|oicerP/;

const SECTION_HEADERS = new Set(["Nutrición"]);
const SUBSECTION_HEADERS = new Set([
  "Destination Wellbeing",
  "Complementos alimenticios fundamentales",
  "Complementos alimenticios específicos",
  "Sistema inmunitario",
  "Energía",
  "Protección celular",
  "Corazón",
  "Vista",
  "Huesos",
  "Hierbas",
  "Apoyo para mujeres",
  "Apoyo para hombres",
  "Niños",
  "Complementos alimenticios adicionales",
  "Belleza interior",
  "Control del peso",
  "Nutrición deportiva",
  "Estilo de vida activo",
  "Alimentos y bebidas",
]);

function parseEsDecimal(token: string): number {
  return Number.parseFloat(token.replace(",", "."));
}

/**
 * Parse `pdftotext -layout` output of the Nutrition pages (3–6).
 * Tracks section/subsection headers to assign `category`. Rows without a
 * parsed price land in `warnings` — the parser never guesses.
 */
export function parsePriceListText(text: string): PriceListParseResult {
  const rows: PriceListRow[] = [];
  const warnings: PriceListParseWarning[] = [];
  let section: string | null = null;
  let subsection: string | null = null;
  // What the previous non-blank line belonged to, so wrapped description
  // fragments can be joined to it instead of being lost or mis-attributed.
  let lastKind: "row" | "warning" | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const norm = rawLine
      .replace(/\u00a0/g, " ")
      .replace(/ﬁ/g, "fi")
      .replace(/ﬂ/g, "fl")
      .trim();
    if (!norm) continue;

    const rowMatch = norm.match(ROW_RE);
    if (rowMatch) {
      const ref = rowMatch[1] ?? "";
      const rest = rowMatch[2] ?? "";
      const tail = rest.match(PRICE_TAIL_RE);
      const clientPrice = tail?.[5];
      if (!tail || !clientPrice) {
        warnings.push({
          line: norm,
          reason:
            "reference row without price columns (variant/flavour listing?)",
        });
        lastKind = "warning";
        continue;
      }
      const before = rest.slice(0, tail.index ?? 0).trimEnd();
      const chunks = before.split(/\s{2,}/).filter(Boolean);
      let name: string;
      let size: string | null;
      if (chunks.length >= 2) {
        name = chunks.slice(0, -1).join(" ");
        size = chunks[chunks.length - 1] ?? null;
      } else if (chunks.length === 1) {
        const single = chunks[0] ?? "";
        const sizeMatch = single.match(SIZE_RE);
        if (sizeMatch?.[1] && sizeMatch.index !== undefined) {
          name = single.slice(0, sizeMatch.index).trim();
          size = sizeMatch[1];
        } else {
          name = single;
          size = null;
        }
      } else {
        warnings.push({ line: norm, reason: "could not separate name/size" });
        lastKind = "warning";
        continue;
      }
      rows.push({
        reference: ref,
        name,
        size,
        // Price rule (calibrated): first number AFTER the optional unit-price
        // token = "Precio al cliente con IVA Península".
        price: parseEsDecimal(clientPrice),
        category: subsection ?? section,
      });
      lastKind = "row";
      continue;
    }

    if (SECTION_HEADERS.has(norm)) {
      section = norm;
      subsection = null;
      lastKind = null;
      continue;
    }
    if (SUBSECTION_HEADERS.has(norm)) {
      subsection = norm;
      lastKind = null;
      continue;
    }
    if (PAGE_NOISE_RE.test(norm)) {
      lastKind = null;
      continue;
    }
    if (/^\d{1,2}$/.test(norm)) continue; // page number
    if (PRICE_TAIL_RE.test(norm)) {
      warnings.push({
        line: norm,
        reason: "data row without a reference (variants listed separately)",
      });
      lastKind = "warning";
      continue;
    }
    // Wrapped continuation of the previous row/warning (e.g. "– Sabor" +
    // "Chocolate Negro"). Joined verbatim — nothing is fabricated.
    if (lastKind === "row" && rows.length > 0) {
      const prev = rows[rows.length - 1];
      if (prev) prev.name = `${prev.name} ${norm}`;
      continue;
    }
    if (lastKind === "warning" && warnings.length > 0) {
      const prev = warnings[warnings.length - 1];
      if (prev) prev.line = `${prev.line} ${norm}`;
      continue;
    }
    warnings.push({ line: norm, reason: "unrecognized line" });
  }

  return { rows, warnings };
}

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OUT_FILE = join(SCRIPT_DIR, "priceListProducts.ts");

function resolvePdfPath(): string {
  const candidates = [
    process.env.PRICE_LIST_PDF,
    join(REPO_ROOT, "docs", "PriceList_April-2026_ES.pdf"),
    join(process.cwd(), "docs", "PriceList_April-2026_ES.pdf"),
    join(process.cwd(), "..", "docs", "PriceList_April-2026_ES.pdf"),
  ].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `curate-pricelist: PriceList PDF not found. Tried: ${candidates.join(", ")}`,
  );
}

function extractNutritionPages(pdfPath: string): string {
  return execFileSync(
    "pdftotext",
    ["-layout", "-f", "3", "-l", "6", pdfPath, "-"],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
}

function emitModule(rows: PriceListRow[]): string {
  const entries = rows
    .map((row) => {
      const fields = [
        `    reference: ${JSON.stringify(row.reference)},`,
        "    complete: false,",
        "    nutrientIds: [],",
        `    source: ${JSON.stringify("pricelist-2026-04")},`,
        `    name: ${JSON.stringify(row.name)},`,
      ];
      if (row.category !== null) {
        fields.push(`    category: ${JSON.stringify(row.category)},`);
      }
      if (row.size !== null) {
        fields.push(`    size: ${JSON.stringify(row.size)},`);
      }
      fields.push(`    price: ${row.price},`);
      return `  {\n${fields.join("\n")}\n  },`;
    })
    .join("\n");

  return `// GENERATED by curate-pricelist.ts — do not hand-edit.
//
// Source: docs/PriceList_April-2026_ES.pdf — Amway business price list,
// Nutrition section (pages 3–6), extracted with \`pdftotext -layout\`.
// \`price\` = "Precio al cliente con IVA Península" (first number after the
// optional unit-price token; calibration anchors 100305 → 24.04,
// 100930 → 33.18, asserted by the generator on every run).
// \`category\` = the price-list section/subsection header each row falls under.
//
// Every row is \`complete: false\` with empty \`nutrientIds\`: benefits,
// dosage, ingredients and disclaimer are NEVER fabricated — they require a
// detail source (curatedProducts.ts honesty rule). seedProducts.ts FLAGs
// these rows (not inserted) exactly like the curated incomplete path.
// Refs already present in CURATED_PRODUCTS are skipped: curated wins.
import type { CuratedProduct } from "./curatedProducts.js";

export const PRICE_LIST_PRODUCTS: CuratedProduct[] = [
${entries}
];
`;
}

// Allow `tsx src/seed/curate-pricelist.ts` to run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const pdfPath = resolvePdfPath();
  const text = extractNutritionPages(pdfPath);
  const { rows, warnings } = parsePriceListText(text);

  console.log(
    `curate-pricelist: parsed ${rows.length} ref rows from pages 3–6 of ${pdfPath}`,
  );

  // Calibration: anchors must be present with the curated prices.
  const anchors: Array<[string, number]> = [
    ["100305", 24.04],
    ["100930", 33.18],
  ];
  let anchorsOk = true;
  for (const [ref, expected] of anchors) {
    const row = rows.find((r) => r.reference === ref);
    const ok = row?.price === expected;
    anchorsOk = anchorsOk && ok;
    console.log(
      `  price anchor: ${ref} → ${row?.price ?? "MISSING"} (expected ${expected}) ${ok ? "OK" : "FAIL"}`,
    );
  }

  const byCategory = new Map<string, number>();
  for (const row of rows) {
    const key = row.category ?? "(no section header)";
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  }
  console.log("  per-category counts (all parsed rows):");
  for (const [category, count] of [...byCategory.entries()].sort()) {
    console.log(`    ${category}: ${count}`);
  }

  const curatedRefs = new Set(CURATED_PRODUCTS.map((p) => p.reference));
  const skipped = rows.filter((r) => curatedRefs.has(r.reference));
  const kept = rows.filter((r) => !curatedRefs.has(r.reference));
  console.log(
    `  skipped (already in CURATED_PRODUCTS — curated wins): ${skipped.map((r) => r.reference).join(", ") || "none"}`,
  );

  if (warnings.length > 0) {
    console.log(`  parse warnings (${warnings.length}) — not guessed, not emitted:`);
    for (const w of warnings) {
      console.log(`    - [${w.reason}] ${w.line}`);
    }
  } else {
    console.log("  parse warnings: none");
  }

  if (rows.length < 60 || rows.length > 90) {
    console.error(
      `curate-pricelist: FATAL — ${rows.length} ref rows outside the expected 60–90 window; verify the PDF/pages before trusting this output.`,
    );
    process.exit(1);
  }
  if (!anchorsOk) {
    console.error(
      "curate-pricelist: FATAL — price calibration anchors failed; the column rule no longer matches the curated prices.",
    );
    process.exit(1);
  }

  writeFileSync(OUT_FILE, emitModule(kept), "utf8");
  console.log(
    `curate-pricelist: wrote PRICE_LIST_PRODUCTS (${kept.length} rows) → ${OUT_FILE}`,
  );
}
