import { describe, it, expect } from "vitest";
import { createDatabase } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";

/**
 * advisor-summary T1 — `customer_summaries`: one AI executive summary per
 * customer (1:1, like `customer_profile`; `customer_id` is the PRIMARY KEY).
 * The production DDL must create the table with a working
 * `generated_at DEFAULT CURRENT_TIMESTAMP`, and migrate must stay idempotent
 * (`IF NOT EXISTS` DDL — same contract as migrate-indexes.test.ts).
 */
describe("migrate DDL — customer_summaries (advisor-summary T1)", () => {
  it("creates customer_summaries and accepts an insert + re-select", async () => {
    const db = createDatabase(":memory:");
    await migrate(db);

    const table = db.$client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customer_summaries'",
      )
      .get() as { name: string } | undefined;
    expect(table?.name).toBe("customer_summaries");

    // A customer row first — `customer_summaries.customer_id` REFERENCES
    // customers(id) and foreign_keys is ON in createDatabase.
    const inserted = db.$client
      .prepare(
        "INSERT INTO customers (name, email, phone, consent_version, consent_timestamp, registered_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "Cliente Migración",
        "migracion@x.com",
        "3111",
        1,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );
    const customerId = Number(inserted.lastInsertRowid);

    db.$client
      .prepare("INSERT INTO customer_summaries (customer_id, content, model) VALUES (?, ?, ?)")
      .run(customerId, "## Qué consulta\nSin registro.", "gemini-test");

    const row = db.$client
      .prepare(
        "SELECT customer_id, content, model, generated_at FROM customer_summaries WHERE customer_id = ?",
      )
      .get(customerId) as
      | { customer_id: number; content: string; model: string; generated_at: string }
      | undefined;
    expect(row?.customer_id).toBe(customerId);
    expect(row?.content).toContain("## Qué consulta");
    expect(row?.model).toBe("gemini-test");
    // DEFAULT CURRENT_TIMESTAMP fills generated_at on a plain insert.
    expect(row?.generated_at).toBeTruthy();

    // Idempotency: a second migrate over the same database must not throw.
    await migrate(db);
  });
});
