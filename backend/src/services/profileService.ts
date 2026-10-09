import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { customerProfile } from "../db/schema.js";
import type { CustomerProfile } from "../db/schema.js";

/**
 * Customer profile service: the 5-step chat intake (T1 of chat-intake),
 * backed by the `customer_profile` table (1:1 with `customers`).
 *
 * The intake is DETERMINISTIC (no LLM): the widget collects chips values in
 * 5 steps and submits them with a single POST. `upsert` keeps exactly one row
 * per customer — a re-submission updates the existing row. Fields the caller
 * omits (`undefined`) keep their previous value; no other hard validation is
 * done here (the frontend sends curated chips values; `customerId` is the one
 * invariant — a positive integer).
 */
export interface ProfileInput {
  sex?: string | null;
  age?: number | null;
  goal?: string | null;
  diet?: string | null;
  activity?: string | null;
  sleep?: string | null;
  stress?: string | null;
  openNote?: string | null;
}

export interface ProfileService {
  /** Insert or update the customer's single profile row. */
  upsert(customerId: number, input: ProfileInput): CustomerProfile | undefined;
  /** The customer's profile row, or undefined when absent/invalid id. */
  getByCustomer(customerId: number): CustomerProfile | undefined;
}

/** The only hard invariant: customer_id must be a positive integer. */
function isValidCustomerId(customerId: number): boolean {
  return Number.isInteger(customerId) && customerId > 0;
}

export function createProfileService(db: Db): ProfileService {
  return {
    upsert(customerId: number, input: ProfileInput): CustomerProfile | undefined {
      if (!isValidCustomerId(customerId)) return undefined;

      // Only fields actually sent are written — an omitted field keeps its
      // previous value on update, and falls back to the column default on
      // insert (sex '' for step 1, NULL for unanswered steps).
      const patch: Partial<CustomerProfile> = {};
      if (input.sex !== undefined) patch.sex = input.sex;
      if (input.age !== undefined) patch.age = input.age;
      if (input.goal !== undefined) patch.goal = input.goal;
      if (input.diet !== undefined) patch.diet = input.diet;
      if (input.activity !== undefined) patch.activity = input.activity;
      if (input.sleep !== undefined) patch.sleep = input.sleep;
      if (input.stress !== undefined) patch.stress = input.stress;
      if (input.openNote !== undefined) patch.openNote = input.openNote;

      const updatedAt = new Date().toISOString();
      return db
        .insert(customerProfile)
        .values({ customerId, sex: "", ...patch, updatedAt })
        .onConflictDoUpdate({
          target: customerProfile.customerId,
          set: { ...patch, updatedAt },
        })
        .returning()
        .get();
    },

    getByCustomer(customerId: number): CustomerProfile | undefined {
      if (!isValidCustomerId(customerId)) return undefined;
      return db
        .select()
        .from(customerProfile)
        .where(eq(customerProfile.customerId, customerId))
        .get();
    },
  };
}
