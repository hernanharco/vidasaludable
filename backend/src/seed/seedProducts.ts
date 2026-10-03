import { eq } from "drizzle-orm";
import { createDatabase } from "../db/client.js";
import { products } from "../db/schema.js";
import { migrate } from "../db/migrate.js";
import {
  CURATED_PRODUCTS,
  readyProducts,
  flaggedIncomplete,
} from "./curatedProducts.js";
import { PRICE_LIST_PRODUCTS } from "./priceListProducts.js";

export interface SeedProductsResult {
  upserted: number;
  inserted: number;
  updated: number;
  flagged: Array<{ reference: string; reason: string }>;
}

/**
 * Price-list rows are secondary to the curated catalog: on a reference
 * collision the CURATED entry always wins and the price-list row is dropped —
 * never merged, never double-flagged.
 */
export function preferCuratedByReference<T extends { reference: string }>(
  curated: readonly T[],
  pricelist: readonly T[],
): { kept: T[]; dropped: string[] } {
  const curatedRefs = new Set(curated.map((e) => e.reference));
  const kept: T[] = [];
  const dropped: string[] = [];
  for (const row of pricelist) {
    if (curatedRefs.has(row.reference)) dropped.push(row.reference);
    else kept.push(row);
  }
  return { kept, dropped };
}

/**
 * Idempotently upserts the curated catalog into the products table.
 *
 * Keyed on `reference` (pk): existing rows are updated, new rows inserted —
 * re-running never duplicates (product-catalog spec, "Re-seed idempotency").
 * Incomplete curated rows (missing required fields) are FLAGGED and NOT
 * inserted (spec: "records without required fields are rejected or flagged").
 * Price-list rows (curate-pricelist.ts, all `complete: false`) follow the
 * same incomplete path: FLAGGED, not inserted; curated entries win on ref
 * collision via preferCuratedByReference.
 */
export async function seedProducts(db: ReturnType<typeof createDatabase>): Promise<SeedProductsResult> {
  await migrate(db);

  let inserted = 0;
  let updated = 0;
  const { kept: pricelistRows } = preferCuratedByReference(
    CURATED_PRODUCTS,
    PRICE_LIST_PRODUCTS,
  );
  const flagged = [
    ...flaggedIncomplete().map((p) => ({
      reference: p.reference,
      reason: "incomplete curated fields (benefits/dosage/ingredients/disclaimer)",
    })),
    ...pricelistRows.map((p) => ({
      reference: p.reference,
      reason: `price-list row (${p.source ?? "pricelist"}) — incomplete fields (benefits/dosage/ingredients/disclaimer); flagged, not inserted`,
    })),
  ];

  for (const product of readyProducts()) {
    const existing = db
      .select()
      .from(products)
      .where(eq(products.reference, product.reference))
      .get();
    if (existing) {
      await db
        .update(products)
        .set(product)
        .where(eq(products.reference, product.reference));
      updated += 1;
    } else {
      await db.insert(products).values(product);
      inserted += 1;
    }
  }

  return { upserted: inserted + updated, inserted, updated, flagged };
}

// Allow `tsx src/seed/seedProducts.ts` to run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = createDatabase(process.env.SQLITE_PATH ?? "./data/dev.sqlite");
  seedProducts(db)
    .then((res) => {
      console.log(`seed:products — inserted=${res.inserted} updated=${res.updated} flagged=${res.flagged.length}`);
      for (const f of res.flagged) console.log(`  flagged (not inserted): ${f.reference} — ${f.reason}`);
      db.$client.close();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}