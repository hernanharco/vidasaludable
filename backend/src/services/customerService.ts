import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { customers } from "../db/schema.js";
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

export interface CustomerService {
  register(input: RegisterInput): RegisterResult;
  getById(id: number): Customer | undefined;
  getByEmail(email: string): Customer | undefined;
  /** True when the customer's consent is current for new recommendations. */
  hasCurrentConsent(customerId: number): boolean;
  /** Re-consents a customer to the current version, preserving records. */
  reConsent(customerId: number): Customer | undefined;
  /** Soft-delete: removes the customer record. */
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
        const reconsented = this.reConsent(existing.id);
        if (!reconsented) {
          return { status: "invalid", reason: "no se pudo renovar el consentimiento" };
        }
        return { status: "ok", customer: reconsented, reconsented: true };
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
      const deleted = db.delete(customers).where(eq(customers.id, customerId)).returning().get();
      return !!deleted;
    },
  };
}