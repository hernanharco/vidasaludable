import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { customers, referrers, customerProfile, conversations, messages, recommendations, purchases } from "../db/schema.js";
import type { Customer } from "../db/schema.js";
import { CURRENT_CONSENT_VERSION } from "../config/consent.js";

/**
 * Customer service: registration (upsert) + consent versioning.
 *
 * Registration is data capture + consent, NOT login (no password/session).
 * Consent is VERSION-GATED, not presence-gated: a customer whose
 * `consent_version < CURRENT_CONSENT_VERSION` must re-consent before any new
 * recommendation, while prior records are preserved.
 *
 * Registration is an UPSERT (design: Registration + Consent Flow → upsert):
 * when the email/phone already exists, the existing customer is RE-CONSENTED
 * (consent_version + consent_timestamp refreshed, id + history + audit records
 * preserved) instead of returning a conflict. This keeps the chat usable for
 * the whole base when CURRENT_CONSENT_VERSION is bumped.
 */

export interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  referrerPhone?: string | null;
  referrerId?: number | null;
  consentVersion: number;
}

export type RegisterResult =
  | { status: "ok"; customer: Customer; reconsented: boolean }
  | { status: "invalid"; reason: string };

/**
 * Result of a last-touch attribution (`attribution()`):
 * - `ok` — `referrer_id` updated; the returned customer is the fresh row.
 * - `invalid` — a supplied id is malformed or the referrer does not exist.
 * - `not_found` — no customer with that id.
 * - `consent_required` — the customer's consent is stale; re-consent first.
 */
export type AttributionResult =
  | { status: "ok"; customer: Customer }
  | { status: "invalid"; reason: string }
  | { status: "not_found" }
  | { status: "consent_required" };

export interface CustomerService {
  register(input: RegisterInput): RegisterResult;
  attribution(input: { customerId: number; referrerId: number }): AttributionResult;
  getById(id: number): Customer | undefined;
  getByEmail(email: string): Customer | undefined;
  /** True when the customer's consent is current for new recommendations. */
  hasCurrentConsent(customerId: number): boolean;
  /** Re-consents a customer to the current version, preserving records. */
  reConsent(customerId: number): Customer | undefined;
  /**
   * Hard delete of the customer record together with every row that references
   * it. `customers` has NO `ON DELETE CASCADE` on its incoming foreign keys
   * while the client enables `foreign_keys = ON`, so the implementation must
   * remove the dependents itself — see the implementation for the order.
   */
  delete(customerId: number): boolean;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function createCustomerService(db: Db): CustomerService {
  return {
    register(input: RegisterInput): RegisterResult {
      const name = input.name?.trim();
      const email = normalize(input.email ?? "");
      const phone = input.phone?.trim();
      if (!name || !email || !phone) {
        return { status: "invalid", reason: "name, email y phone son obligatorios" };
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { status: "invalid", reason: "email no válido" };
      }
      if (input.consentVersion !== CURRENT_CONSENT_VERSION) {
        return { status: "invalid", reason: `consent_version debe ser ${CURRENT_CONSENT_VERSION}` };
      }

      // Upsert: an existing email/phone re-consents instead of conflicting,
      // preserving id, conversation history and audit records (version-gated).
      const byEmail = db.select().from(customers).where(eq(customers.email, email)).get();
      const byPhone = db.select().from(customers).where(eq(customers.phone, phone)).get();
      const existing = byEmail ?? byPhone;
      if (existing) {
        // Validate the supplied referrer BEFORE renewing consent. attribution()
        // validates too, but calling it after reConsent() would leave the
        // consent already renewed behind a 400 that reports no customer_id —
        // a partial side effect. Failing first keeps the upsert all-or-nothing:
        // either nothing changed, or everything did.
        const suppliedReferrerId = input.referrerId ?? null;
        if (suppliedReferrerId != null) {
          const referrer = db
            .select()
            .from(referrers)
            .where(eq(referrers.id, suppliedReferrerId))
            .get();
          if (!referrer) {
            return { status: "invalid", reason: "referrer_id inválido" };
          }
        }

        const reconsented = this.reConsent(existing.id);
        if (!reconsented) {
          return { status: "invalid", reason: "no se pudo renovar el consentimiento" };
        }

        // Last-touch, same rule as attribution(): when the client supplies an
        // access code, the EXISTING row is re-attributed to it. Before this,
        // the upsert branch returned right after re-consenting and silently
        // discarded `referrer_id`, so a customer who already existed (matched
        // by email or phone) could NEVER be attributed through register() —
        // which is exactly how a real customer ended up with a NULL
        // referrer_id despite having typed a valid code.
        //
        // Omitting the code keeps the previous attribution: a re-consent must
        // never null out an existing referrer.
        const referrerId = suppliedReferrerId;
        if (referrerId == null) {
          return { status: "ok", customer: reconsented, reconsented: true };
        }

        // reConsent() already bumped consentVersion to CURRENT, so
        // attribution() passes its consent check and its referrer validation
        // is reused instead of duplicated here.
        const attributed = this.attribution({ customerId: existing.id, referrerId });
        if (attributed.status !== "ok") {
          return {
            status: "invalid",
            reason:
              attributed.status === "invalid" ? attributed.reason : "no se pudo atribuir el referente",
          };
        }
        return { status: "ok", customer: attributed.customer, reconsented: true };
      }

      const now = new Date().toISOString();
      const inserted = db
        .insert(customers)
        .values({
          name,
          email,
          phone,
          referrerPhone: input.referrerPhone?.trim() || null,
          referrerId: input.referrerId ?? null,
          consentVersion: input.consentVersion,
          consentTimestamp: now,
          registeredAt: now,
        })
        .returning()
        .get();
      return { status: "ok", customer: inserted, reconsented: false };
    },

    /**
     * Last-touch attribution for the ALWAYS-requested access code
     * (feature access-code-always): updates `referrer_id` ONLY.
     *
     * Critical constraints (contract of this method):
     * - MUST NOT touch `name`, `email`, `phone`, `referrerPhone`,
     *   `registeredAt` or `createdAt` — identity and registration data are
     *   immutable here; the frontend persists only `vr_customer_id`.
     * - MUST NOT bump `consentVersion`/`consentTimestamp` when consent is
     *   already current: no re-consent ceremony is involved, attribution is
     *   not a registration and `CURRENT_CONSENT_VERSION` stays 1 (no bump).
     * - Last-touch is deliberate: the code is requested on EVERY visit, so
     *   the most recent referrer overwrites the previous one (first-touch
     *   would make asking every time pointless).
     * - Stale consent → `consent_required`: the client must re-consent via
     *   the gate BEFORE any new attribution is written.
     * - The referrer must exist (`referrer_id` FK → `referrers(id)`,
     *   `foreign_keys = ON`): an unknown id returns `invalid` instead of
     *   letting the SQLite FK constraint throw.
     */
    attribution(input: { customerId: number; referrerId: number }): AttributionResult {
      const { customerId, referrerId } = input;
      if (!Number.isInteger(customerId) || customerId <= 0) {
        return { status: "invalid", reason: "customerId debe ser un entero positivo" };
      }
      if (!Number.isInteger(referrerId) || referrerId <= 0) {
        return { status: "invalid", reason: "referrerId debe ser un entero positivo" };
      }

      const existing = db.select().from(customers).where(eq(customers.id, customerId)).get();
      if (!existing) {
        return { status: "not_found" };
      }
      if (existing.consentVersion < CURRENT_CONSENT_VERSION) {
        return { status: "consent_required" };
      }

      const referrer = db.select().from(referrers).where(eq(referrers.id, referrerId)).get();
      if (!referrer) {
        return { status: "invalid", reason: "referrer_id inválido" };
      }

      // Last-touch: ONLY referrer_id is set — drizzle writes the provided
      // columns, so every other field (identity + registration + consent)
      // is preserved verbatim.
      const updated = db
        .update(customers)
        .set({ referrerId })
        .where(eq(customers.id, customerId))
        .returning()
        .get();
      if (!updated) {
        return { status: "not_found" };
      }
      return { status: "ok", customer: updated };
    },

    getById(id: number): Customer | undefined {
      return db.select().from(customers).where(eq(customers.id, id)).get();
    },

    getByEmail(email: string): Customer | undefined {
      return db.select().from(customers).where(eq(customers.email, normalize(email))).get();
    },

    hasCurrentConsent(customerId: number): boolean {
      const row = db.select().from(customers).where(eq(customers.id, customerId)).get();
      if (!row) return false;
      return row.consentVersion >= CURRENT_CONSENT_VERSION;
    },

    reConsent(customerId: number): Customer | undefined {
      const now = new Date().toISOString();
      return db
        .update(customers)
        .set({ consentVersion: CURRENT_CONSENT_VERSION, consentTimestamp: now })
        .where(eq(customers.id, customerId))
        .returning()
        .get();
    },

    delete(customerId: number): boolean {
      // `customer_profile`, `conversations`, `purchases` and `recommendations`
      // reference `customers` directly, and `messages`/`recommendations` do so
      // through `conversations`. None of those foreign keys cascade, so a bare
      // `DELETE FROM customers` threw `FOREIGN KEY constraint failed` for any
      // customer with history — which made the admin "Eliminar" button fail
      // silently. Remove the dependents first, in FK-safe order, inside ONE
      // transaction: a failure partway through must not leave the customer
      // stripped of history while the row itself survives.
      return db.transaction((tx) => {
        const conversationIds = tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.customerId, customerId))
          .all()
          .map((row) => row.id);

        for (const conversationId of conversationIds) {
          tx.delete(messages).where(eq(messages.conversationId, conversationId)).run();
          tx.delete(recommendations)
            .where(eq(recommendations.conversationId, conversationId))
            .run();
        }
        tx.delete(recommendations).where(eq(recommendations.customerId, customerId)).run();
        tx.delete(conversations).where(eq(conversations.customerId, customerId)).run();
        tx.delete(purchases).where(eq(purchases.customerId, customerId)).run();
        tx.delete(customerProfile).where(eq(customerProfile.customerId, customerId)).run();

        const deleted = tx
          .delete(customers)
          .where(eq(customers.id, customerId))
          .returning()
          .get();
        return !!deleted;
      });
    },
  };
}