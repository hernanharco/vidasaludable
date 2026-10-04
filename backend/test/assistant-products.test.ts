import { describe, it, expect, beforeAll } from "vitest";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { seedProducts } from "../src/seed/seedProducts.js";
import { buildApp } from "../src/index.js";
import type { Hono } from "hono";

/**
 * T6 — public `GET /assistant/products` (same surface as /assistant/videos).
 *
 * Route level: mirrors assistant.integration.test.ts — `buildApp(db)` over
 * in-memory SQLite migrated with the production DDL and seeded with the real
 * curated catalog, then `app.request("/assistant/products")` against the real
 * Hono instance. No auth, no Gemini: the catalog map is public by
 * construction, same contract as `/assistant/consent` and `/assistant/videos`.
 *
 * The chat widget boot-fetches this list to resolve the `[REF]` citations the
 * agent writes (extract convention `\[\d{4,6}\]`, same as extractProductRefs)
 * into ProductCard info cards. The payload exposes only the public card
 * fields — size/dosage/ingredients stay server-side.
 */
describe("assistant products endpoint (T6)", () => {
  let db: Db;
  let app: Hono;

  type ProductCardPayload = {
    reference: string;
    name: string;
    price: number;
    category: string;
    benefits: string;
    disclaimer: string;
  };

  beforeAll(async () => {
    db = createDatabase(":memory:");
    await migrate(db);
    // Real curated catalog — 16 complete rows (incomplete/price-list rows are
    // flagged by the seed and never inserted; see catalog.test.ts).
    await seedProducts(db);
    app = buildApp(db);
  });

  it("returns 200 with the public card shape for every catalog row (count >= 16)", async () => {
    const res = await app.request("/assistant/products");
    expect(res.status).toBe(200);

    const data = (await res.json()) as { products: ProductCardPayload[] };
    expect(Array.isArray(data.products)).toBe(true);
    // T3 evidence: 16 curated products served by the CRM; the catalog only grows.
    expect(data.products.length).toBeGreaterThanOrEqual(16);

    // Exact public shape: six fields, nothing else leaks to the client.
    for (const p of data.products) {
      expect(p).toEqual({
        reference: expect.any(String),
        name: expect.any(String),
        price: expect.any(Number),
        category: expect.any(String),
        benefits: expect.any(String),
        disclaimer: expect.any(String),
      });
      expect(typeof p.price).toBe("number");
      expect(Number.isFinite(p.price)).toBe(true);
      // Refs follow the citation convention `\[\d{4,6}\]` (4–6 digits).
      expect(p.reference).toMatch(/^\d{4,6}$/);
    }
  });

  it("is public (no auth headers) — same surface as /assistant/videos", async () => {
    const res = await app.request("/assistant/products");
    expect(res.status).toBe(200);
  });

  it("serves the video-mentioned catalog refs the agent cites in replies", async () => {
    const res = await app.request("/assistant/products");
    const data = (await res.json()) as { products: ProductCardPayload[] };
    const byRef = new Map(data.products.map((p) => [p.reference, p]));

    // Pilot segments (T5) link these refs; the chat resolves `[ref]` cites
    // against this map, so they must all be present.
    for (const ref of ["110606", "121576", "110415"]) {
      expect(byRef.has(ref)).toBe(true);
    }

    // Spot-check the flagship citation from the task: Cal Mag D Plus.
    const calMag = byRef.get("110606");
    expect(calMag?.name).toMatch(/Cal Mag D Plus/i);
    expect(calMag?.price).toBeCloseTo(29.71, 2);
    expect(calMag?.category).toBeTruthy();
    expect(calMag?.benefits).toBeTruthy();
    expect(calMag?.disclaimer).toBeTruthy();
  });
});
