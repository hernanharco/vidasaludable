import { eq } from "drizzle-orm";
import { createDatabase } from "../db/client.js";
import { customers, purchases, products } from "../db/schema.js";
import { migrate } from "../db/migrate.js";

/**
 * Demo purchase seeds. Associates sample purchases with seed customers so the
 * agent's purchase-context injection has data to work with in dev.
 *
 * Only inserts purchases whose product references exist in the catalog and
 * whose customer email matches a known seed customer — it never invents product
 * refs and never creates purchase rows pointing at absent products.
 */
export async function seedPurchases(db: ReturnType<typeof createDatabase>): Promise<{ inserted: number; skipped: string[] }> {
  await migrate(db);

  const demo = [
    {
      email: "demo@vidasaludable.test",
      productReference: "100305", // Nutrilite Biotina C Plus
      qty: 2,
      purchasedAt: "2026-07-10T10:00:00Z",
    },
    {
      email: "demo@vidasaludable.test",
      productReference: "100930", // Multivitaminas Masticable
      qty: 1,
      purchasedAt: "2026-07-20T10:00:00Z",
    },
    {
      email: "maria@example.test",
      productReference: "100305",
      qty: 1,
      purchasedAt: "2026-08-01T09:30:00Z",
    },
  ] as const;

  let inserted = 0;
  const skipped: string[] = [];

  for (const row of demo) {
    const customer = db.select().from(customers).where(eq(customers.email, row.email)).get();
    const product = db.select().from(products).where(eq(products.reference, row.productReference)).get();
    if (!customer) {
      skipped.push(`customer ${row.email} not found`);
      continue;
    }
    if (!product) {
      skipped.push(`product ${row.productReference} not in catalog`);
      continue;
    }
    await db.insert(purchases).values({
      customerId: customer.id,
      productReference: row.productReference,
      qty: row.qty,
      purchasedAt: row.purchasedAt,
    });
    inserted += 1;
  }

  return { inserted, skipped };
}

// Allow `tsx src/seed/seedPurchases.ts` to run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = createDatabase(process.env.SQLITE_PATH ?? "./data/dev.sqlite");
  seedPurchases(db)
    .then((res) => {
      console.log(`seed:purchases — inserted=${res.inserted}`);
      for (const s of res.skipped) console.log(`  skipped: ${s}`);
      db.$client.close();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}