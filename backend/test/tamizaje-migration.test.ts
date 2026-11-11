import { describe, it, expect } from "vitest";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";

/**
 * tamizaje-images T1 — the three new tables from the ODD Diseño section:
 *
 *   body_metrics        (S1: optional, never-blocking Tanita/RENPHO record)
 *   customer_images     (S2: Cloudinary image history — public_id/secure_url
 *                        only, never binaries in SQLite)
 *   appointment_requests (S3: decided scope — CRM + landing + chat)
 *
 * Covered:
 *  1. FRESH DATABASE — migrate creates the three tables with the documented
 *     columns, the (customer_id, measured_at) unique key that powers the
 *     body-metrics upsert, and the customer_id indexes.
 *  2. DEFAULTS — status defaults to 'pendiente', source to 'manual', the
 *     *_at columns fill via DEFAULT CURRENT_TIMESTAMP, and nullable REAL
 *     body-metric fields accept a partial record (design: "Campos REAL
 *     nullable — registro parcial es válido").
 *  3. LEGACY DATABASE — a pre-T1 database (three tables absent, legacy
 *     tables already carrying rows) migrates cleanly and idempotently. The
 *     non-empty legacy rows pin the known SQLite pitfall: ADD COLUMN with a
 *     non-constant default (CURRENT_TIMESTAMP) fails on tables with rows,
 *     so migrate.ts must never need an ALTER for these brand-new tables.
 */
function tableNames(db: Db): string[] {
  return (
    db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function columnNames(db: Db, table: string): string[] {
  return (db.$client.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name,
  );
}

function indexNames(db: Db, table: string): string[] {
  return (
    db.$client
      .prepare(`PRAGMA index_list(${table})`)
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function insertCustomer(db: Db, email: string): number {
  const inserted = db.$client
    .prepare(
      "INSERT INTO customers (name, email, phone, consent_version, consent_timestamp, registered_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run("Cliente Tamizaje", email, `+346000000${email.length}`, 2, "2026-11-11T00:00:00.000Z", "2026-11-11T00:00:00.000Z");
  return Number(inserted.lastInsertRowid);
}

describe("migrate DDL — tamizaje-images T1 (body_metrics, customer_images, appointment_requests)", () => {
  it("creates the three tables with the documented columns on a fresh database", async () => {
    const db = createDatabase(":memory:");
    await migrate(db);

    const tables = tableNames(db);
    expect(tables).toContain("body_metrics");
    expect(tables).toContain("customer_images");
    expect(tables).toContain("appointment_requests");

    // body_metrics — id, FK, date, every RENPHO metric (REAL, nullable),
    // source (RENPHO|manual), notes, created_at.
    expect(columnNames(db, "body_metrics")).toEqual([
      "id",
      "customer_id",
      "measured_at",
      "weight_kg",
      "bmi",
      "body_fat_pct",
      "fat_mass_kg",
      "subcutaneous_fat_pct",
      "visceral_fat",
      "muscle_pct",
      "muscle_mass_kg",
      "skeletal_muscle_pct",
      "skeletal_muscle_mass_kg",
      "bone_pct",
      "bone_mass_kg",
      "fat_free_mass_kg",
      "metabolic_age",
      "bmr_kcal",
      "water_pct",
      "protein_pct",
      "source",
      "notes",
      "created_at",
    ]);
    // The upsert-by-date key that POST /admin/customers/:id/body-metrics uses.
    expect(indexNames(db, "body_metrics")).toContain("body_metrics_customer_measured_unique");
    expect(indexNames(db, "body_metrics")).toContain("body_metrics_customer_id_idx");

    // customer_images — Cloudinary refs only (no binaries in SQLite).
    expect(columnNames(db, "customer_images")).toEqual([
      "id",
      "customer_id",
      "kind",
      "cloudinary_public_id",
      "cloudinary_secure_url",
      "taken_at",
      "uploaded_by",
      "notes",
      "created_at",
    ]);
    expect(indexNames(db, "customer_images")).toContain("customer_images_customer_id_idx");

    // appointment_requests — customer_id NULL for the public landing form.
    expect(columnNames(db, "appointment_requests")).toEqual([
      "id",
      "customer_id",
      "name",
      "phone",
      "email",
      "reason",
      "status",
      "notes",
      "created_at",
      "updated_at",
    ]);
    expect(indexNames(db, "appointment_requests")).toContain("appointment_requests_customer_id_idx");

    // Idempotency: a second migrate over the same database must not throw.
    await migrate(db);
  });

  it("accepts inserts with defaults (status pendiente, source manual, CURRENT_TIMESTAMP)", async () => {
    const db = createDatabase(":memory:");
    await migrate(db);
    const customerId = insertCustomer(db, "mig-fresh@example.com");

    // Partial body-metric record: only the date + one metric (REAL columns
    // are nullable by design).
    db.$client
      .prepare("INSERT INTO body_metrics (customer_id, measured_at, weight_kg) VALUES (?, ?, ?)")
      .run(customerId, "2026-11-11", 77.85);
    const metric = db.$client
      .prepare("SELECT source, weight_kg, bmi, created_at FROM body_metrics WHERE customer_id = ?")
      .get(customerId) as { source: string; weight_kg: number; bmi: number | null; created_at: string };
    expect(metric.source).toBe("manual"); // DDL default
    expect(metric.weight_kg).toBeCloseTo(77.85);
    expect(metric.bmi).toBeNull(); // partial record is valid
    expect(metric.created_at).toBeTruthy(); // DEFAULT CURRENT_TIMESTAMP

    db.$client
      .prepare(
        "INSERT INTO customer_images (customer_id, kind, cloudinary_public_id, cloudinary_secure_url, uploaded_by) VALUES (?, ?, ?, ?, ?)",
      )
      .run(customerId, "tamizaje", "demo/abc123", "https://res.cloudinary.com/demo/image/upload/abc123.png", "admin");
    const image = db.$client
      .prepare("SELECT taken_at, created_at FROM customer_images WHERE customer_id = ?")
      .get(customerId) as { taken_at: string | null; created_at: string };
    expect(image.taken_at).toBeNull(); // optional (fecha del reporte)
    expect(image.created_at).toBeTruthy();

    // Landing request: customer_id NULL is allowed (public Booking form).
    db.$client
      .prepare(
        "INSERT INTO appointment_requests (customer_id, name, phone, reason) VALUES (NULL, ?, ?, ?)",
      )
      .run("Visitante Landing", "+34611111111", "Quiero un tamizaje");
    const request = db.$client
      .prepare("SELECT customer_id, status, created_at, updated_at FROM appointment_requests")
      .get() as { customer_id: number | null; status: string; created_at: string; updated_at: string };
    expect(request.customer_id).toBeNull();
    expect(request.status).toBe("pendiente"); // DDL default
    expect(request.created_at).toBeTruthy();
    expect(request.updated_at).toBeTruthy();

    // Same customer + measured_at twice → the unique key rejects it (the
    // upsert path resolves the conflict instead).
    expect(() =>
      db.$client
        .prepare("INSERT INTO body_metrics (customer_id, measured_at, weight_kg) VALUES (?, ?, ?)")
        .run(customerId, "2026-11-11", 78),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("migrates a legacy pre-T1 database (three tables absent, legacy tables non-empty)", async () => {
    const db = createDatabase(":memory:");
    await migrate(db);
    // Simulate a production file created before tamizaje-images T1: the three
    // tables do not exist yet.
    db.$client.exec(
      "DROP TABLE appointment_requests; DROP TABLE customer_images; DROP TABLE body_metrics;",
    );
    expect(tableNames(db)).not.toContain("body_metrics");

    // Non-empty legacy tables: this is the shape where SQLite rejects
    // "ADD COLUMN with non-constant default" — migrate must succeed anyway
    // (the new tables are CREATE TABLE IF NOT EXISTS, no ALTER needed).
    const customerId = insertCustomer(db, "mig-legacy@example.com");
    db.$client
      .prepare("INSERT INTO conversations (customer_id, title) VALUES (?, 'conversación vieja')")
      .run(customerId);

    await migrate(db);
    await migrate(db); // idempotent on the migrated file

    const tables = tableNames(db);
    expect(tables).toContain("body_metrics");
    expect(tables).toContain("customer_images");
    expect(tables).toContain("appointment_requests");

    // The legacy rows survived untouched.
    const conversation = db.$client
      .prepare("SELECT title FROM conversations WHERE customer_id = ?")
      .get(customerId) as { title: string };
    expect(conversation.title).toBe("conversación vieja");

    // And the recreated tables accept inserts (FK to the legacy customer).
    db.$client
      .prepare(
        "INSERT INTO appointment_requests (customer_id, name, phone, reason) VALUES (?, ?, ?, ?)",
      )
      .run(customerId, "Legacy", "+34622222222", "Cita post-migración");
    const request = db.$client
      .prepare("SELECT status FROM appointment_requests WHERE customer_id = ?")
      .get(customerId) as { status: string };
    expect(request.status).toBe("pendiente");
  });
});
