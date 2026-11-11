import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { bodyMetrics } from "../db/schema.js";
import type { BodyMetric, NewBodyMetric } from "../db/schema.js";

/**
 * Body-metrics service (tamizaje-images, S1) — the SHARED record used by
 * BOTH metrics surfaces: `POST /admin/customers/:id/body-metrics` (T1) and
 * the customer-facing `POST /assistant/body-metrics` (T2), plus the prompt
 * read (`getLatestByCustomer` → `bodyMetricsBlock` in agent/prompt.ts).
 *
 * The wire validation (measured_at key, the 17 snake_case numeric fields,
 * source enum) and the per-`measured_at` upsert live HERE exactly once, so
 * the two routes cannot drift: the customer route only adds its own
 * customer/consent checks around the same call T1's admin route makes.
 * Absent fields KEEP their stored value on update — partial records are
 * valid by design (a one-field correction cannot wipe a full RENPHO import).
 */

/** The body-metric columns accepted by POST .../body-metrics (snake_case wire). */
export const BODY_METRIC_FIELDS = [
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
] as const;

/** Wire name (snake_case, per the ODD Diseño) → Drizzle column (camelCase). */
export const BODY_METRIC_COLUMNS = {
  weight_kg: "weightKg",
  bmi: "bmi",
  body_fat_pct: "bodyFatPct",
  fat_mass_kg: "fatMassKg",
  subcutaneous_fat_pct: "subcutaneousFatPct",
  visceral_fat: "visceralFat",
  muscle_pct: "musclePct",
  muscle_mass_kg: "muscleMassKg",
  skeletal_muscle_pct: "skeletalMusclePct",
  skeletal_muscle_mass_kg: "skeletalMuscleMassKg",
  bone_pct: "bonePct",
  bone_mass_kg: "boneMassKg",
  fat_free_mass_kg: "fatFreeMassKg",
  metabolic_age: "metabolicAge",
  bmr_kcal: "bmrKcal",
  water_pct: "waterPct",
  protein_pct: "proteinPct",
} as const satisfies Record<(typeof BODY_METRIC_FIELDS)[number], keyof NewBodyMetric>;

/**
 * Result of one upsert: 201 on create, 200 on update (or on "nothing to
 * change"), or the 400 the route replies with (messages moved verbatim from
 * T1's admin endpoint, so its contract is unchanged).
 */
export type BodyMetricUpsertResult =
  | { ok: true; status: 200 | 201; bodyMetric: BodyMetric }
  | { ok: false; status: 400; error: string };

export interface BodyMetricService {
  /**
   * Creates or UPSERTs the record for `measured_at` (one row per customer +
   * date, enforced by body_metrics_customer_measured_unique).
   * 201 on create, 200 on upsert.
   */
  upsertFromWire(customerId: number, body: Record<string, unknown>): BodyMetricUpsertResult;
  /** The customer's records, newest measured_at first (customer GET). */
  listByCustomer(customerId: number): BodyMetric[];
  /** The latest record (by measured_at) for the agent prompt — undefined when absent. */
  getLatestByCustomer(customerId: number): BodyMetric | undefined;
}

export function createBodyMetricService(db: Db): BodyMetricService {
  return {
    upsertFromWire(customerId: number, body: Record<string, unknown>): BodyMetricUpsertResult {
      const measuredAt = body.measured_at != null ? String(body.measured_at).trim() : "";
      if (!measuredAt) return { ok: false, status: 400, error: "missing field: measured_at" };

      const metrics: Partial<NewBodyMetric> = {};
      for (const field of BODY_METRIC_FIELDS) {
        const raw = body[field];
        if (raw == null || raw === "") continue; // absent → keep stored value
        const num = Number(raw);
        if (!Number.isFinite(num)) {
          return { ok: false, status: 400, error: `${field} must be a number` };
        }
        metrics[BODY_METRIC_COLUMNS[field]] = num;
      }

      const patch: Partial<NewBodyMetric> = { ...metrics };
      if (body.source != null && body.source !== "") {
        const source = String(body.source);
        if (source !== "RENPHO" && source !== "manual") {
          return { ok: false, status: 400, error: "source must be RENPHO or manual" };
        }
        patch.source = source;
      }
      if (body.notes != null) patch.notes = String(body.notes);

      const existing = db
        .select()
        .from(bodyMetrics)
        .where(and(eq(bodyMetrics.customerId, customerId), eq(bodyMetrics.measuredAt, measuredAt)))
        .get();

      if (existing) {
        if (Object.keys(patch).length === 0) {
          return { ok: true, status: 200, bodyMetric: existing }; // nothing to change
        }
        const updated = db
          .update(bodyMetrics)
          .set(patch)
          .where(and(eq(bodyMetrics.customerId, customerId), eq(bodyMetrics.measuredAt, measuredAt)))
          .returning()
          .get();
        return { ok: true, status: 200, bodyMetric: updated };
      }

      const inserted = db
        .insert(bodyMetrics)
        .values({ ...patch, customerId, measuredAt })
        .returning()
        .get();
      return { ok: true, status: 201, bodyMetric: inserted };
    },

    listByCustomer(customerId: number): BodyMetric[] {
      return db
        .select()
        .from(bodyMetrics)
        .where(eq(bodyMetrics.customerId, customerId))
        .orderBy(desc(bodyMetrics.measuredAt), desc(bodyMetrics.id))
        .all();
    },

    getLatestByCustomer(customerId: number): BodyMetric | undefined {
      return db
        .select()
        .from(bodyMetrics)
        .where(eq(bodyMetrics.customerId, customerId))
        .orderBy(desc(bodyMetrics.measuredAt), desc(bodyMetrics.id))
        .limit(1)
        .get();
    },
  };
}
