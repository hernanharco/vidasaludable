import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/index.js";
import { createCustomerService } from "../src/services/customerService.js";
import {
  customers,
  referrers,
  customerProfile,
  conversations,
  messages,
  recommendations,
  purchases,
  products,
} from "../src/db/schema.js";
import type { Hono } from "hono";

/**
 * Customer lifecycle: access-code attribution on register + safe deletion.
 *
 * Discovered while investigating why a real customer (registered 2026-10-10
 * 19:25, before the access-code-always deploy) had a NULL `referrer_id` even
 * though they entered an active access code:
 *
 *   register() matched the customer by email/phone and took the UPSERT branch,
 *   which only re-consents. The `referrer_id` the frontend sent was silently
 *   discarded, so an existing customer could NEVER be attributed through
 *   register() — by contrast attribution() DOES write it.
 *
 * And the delete button could not be used as a workaround: `customers.delete()`
 * ran a bare `db.delete(customers)` while four tables reference `customers`
 * with NO `ON DELETE CASCADE` and `foreign_keys = ON`, so deleting a customer
 * who had any history threw FOREIGN KEY constraint failed.
 *
 * Covered behaviors, over in-memory SQLite (`createDatabase` + `migrate` +
 * `buildApp`):
 *
 *  1. LAST-TOUCH ON REGISTER — an existing customer re-registering with a new
 *     access code is re-attributed to that code, keeping the SAME row (no
 *     duplicate) and the same name/email/phone. History is preserved: this is
 *     the non-destructive path that replaces "delete and register again".
 *  2. NO ATTRIBUTION SUPPLIED — re-registering WITHOUT a code keeps the
 *     previous `referrer_id`; it must not be nulled out.
 *  3. DELETE CASCADES IN APPLICATION CODE — deleting a customer who has a
 *     profile, conversation, messages, recommendations and a purchase removes
 *     every dependent row and returns true (no FK error).
 *  4. THE REAL ENDPOINT — `DELETE /admin/customers/:id` (the admin "Eliminar"
 *     button) is routed through that service. This matters: the route used to
 *     run `db.delete(customers)` itself, so fixing the service alone would not
 *     have reached the UI. Auth is not this file's concern — the JWT guard has
 *     its own suite (test/admin-auth.test.ts) — so the route is exercised in
 *     `development`, where the guard passes through.
 *  5. UNKNOWN CODE IS REJECTED BEFORE ANYTHING IS WRITTEN — re-registering an
 *     existing customer with a referrer id that does not exist returns 400 and
 *     leaves the row (previous attribution included) untouched. The referrer
 *     is validated BEFORE the consent renewal so no partial side effect is
 *     left behind a 400 that reports no customer_id.
 *  6. CONVERSATION DELETE — `messages` AND `recommendations` reference
 *     `conversations.id` with no cascade, but the endpoint only deleted
 *     messages. A conversation that had produced a recommendation therefore
 *     threw FOREIGN KEY constraint failed and the admin Conversaciones page
 *     showed a bare HTTP 500. The endpoint now removes both dependents in one
 *     transaction and leaves the customer intact.
 *
 * The cascade assertions also pin what must SURVIVE it: the shared catalog
 * product is still there and an unrelated customer is untouched.
 *
 * No API key and no network: none of these routes touch the Gemini client.
 */
describe("customer lifecycle (register attribution + safe delete)", () => {
  let db: Db;
  let app: Hono;
  let customersService: ReturnType<typeof createCustomerService>;
  let previousNodeEnv: string | undefined;
  let referrerA: { id: number };
  let referrerB: { id: number };

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const getCustomer = (customerId: number) =>
    db.select().from(customers).where(eq(customers.id, customerId)).get();

  const countRows = <T extends { customerId: unknown }>(
    table: { where: unknown },
    customerId: number,
  ) =>
    (db.select().from(table as never).where(eq((table as never).customerId, customerId)).all() as T[])
      .length;

  beforeAll(async () => {
    // The central /admin/* JWT guard short-circuits in development; auth
    // coverage lives in test/admin-auth.test.ts.
    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    db = createDatabase(":memory:");
    await migrate(db);
    app = buildApp(db);
    customersService = createCustomerService(db);    referrerA = db.insert(referrers).values({ code: "REF-A", name: "Referente A" }).returning().get();
    referrerB = db.insert(referrers).values({ code: "REF-B", name: "Referente B" }).returning().get();
  });

  afterAll(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  it("re-attributes an existing customer to a new access code without duplicating or losing their row", async () => {
    const email = "hernan@example.com";
    const phone = "+34634405549";

    const first = await post("/assistant/register", {
      name: "Hernan",
      email,
      phone,
      consent_version: 1,
      referrer_id: referrerA.id,
    });
    expect(first.status).toBe(200);
    const customerId = ((await first.json()) as { customer_id: number }).customer_id;
    expect(getCustomer(customerId)?.referrerId).toBe(referrerA.id);

    // Same person comes back later and types a DIFFERENT access code.
    const second = await post("/assistant/register", {
      name: "Hernan",
      email,
      phone,
      consent_version: 1,
      referrer_id: referrerB.id,
    });
    expect(second.status).toBe(200);
    const secondId = ((await second.json()) as { customer_id: number }).customer_id;

    // Same row (upsert), not a duplicate.
    expect(secondId).toBe(customerId);
    const row = getCustomer(customerId);
    expect(row).toBeDefined();
    // Last-touch: the NEW code wins.
    expect(row?.referrerId).toBe(referrerB.id);
    // Identity preserved — nothing else was rewritten.
    expect(row?.name).toBe("Hernan");
    expect(row?.email).toBe(email);
    expect(row?.phone).toBe(phone);
  });

  it("keeps the previous attribution when a later registration supplies no access code", async () => {
    const email = "sin-codigo@example.com";

    const first = await post("/assistant/register", {
      name: "Sin Código",
      email,
      phone: "+34600000001",
      consent_version: 1,
      referrer_id: referrerA.id,
    });
    expect(first.status).toBe(200);
    const customerId = ((await first.json()) as { customer_id: number }).customer_id;

    const second = await post("/assistant/register", {
      name: "Sin Código",
      email,
      phone: "+34600000001",
      consent_version: 1,
    });
    expect(second.status).toBe(200);

    // A re-consent without a code must NOT wipe the existing attribution.
    expect(getCustomer(customerId)?.referrerId).toBe(referrerA.id);
  });

  it("deletes a customer together with their profile, conversation, messages, recommendations and purchase", async () => {
    const res = await post("/assistant/register", {
      name: "Con Historial",
      email: "historial@example.com",
      phone: "+34600000002",
      consent_version: 1,
      referrer_id: referrerA.id,
    });
    expect(res.status).toBe(200);
    const customerId = ((await res.json()) as { customer_id: number }).customer_id;

    // An unrelated customer that must survive the cascade untouched.
    const bystander = await post("/assistant/register", {
      name: "Otro Cliente",
      email: "otro@example.com",
      phone: "+34600000009",
      consent_version: 1,
    });
    expect(bystander.status).toBe(200);
    const bystanderId = ((await bystander.json()) as { customer_id: number }).customer_id;

    db.insert(customerProfile).values({ customerId, sex: "M", age: 40 }).run();
    const conversation = db
      .insert(conversations)
      .values({ customerId })
      .returning()
      .get();
    db.insert(messages).values({ conversationId: conversation.id, role: "user", content: "hola" }).run();
    db.insert(messages).values({ conversationId: conversation.id, role: "assistant", content: "hola!" }).run();
    db.insert(recommendations).values({
      conversationId: conversation.id,
      customerId,
      symptom: "fatiga",
      productReferences: JSON.stringify(["P-1"]),
      rationale: "test",
      consentVersion: 1,
    }).run();
    db.insert(products).values({
      reference: "P-1",
      name: "Producto",
      category: "suplemento",
      size: "60",
      price: 10,
      benefits: "b",
      dosage: "d",
      ingredients: "i",
      disclaimer: "dis",
    }).run();
    db.insert(purchases).values({
      customerId,
      productReference: "P-1",
      purchasedAt: new Date().toISOString(),
    }).run();

    // Before the fix this threw FOREIGN KEY constraint failed.
    expect(customersService.delete(customerId)).toBe(true);

    expect(getCustomer(customerId)).toBeUndefined();
    expect(countRows(customerProfile, customerId)).toBe(0);
    expect(countRows(conversations, customerId)).toBe(0);
    expect(countRows(recommendations, customerId)).toBe(0);
    expect(countRows(purchases, customerId)).toBe(0);
    // Messages hang off the conversation, so count them by conversation id.
    const remainingMessages = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .all();
    expect(remainingMessages).toHaveLength(0);

    // Cascade must not over-reach: the catalog product is shared data and the
    // unrelated customer is untouched.
    const productLeft = db
      .select()
      .from(products)
      .where(eq(products.reference, "P-1"))
      .all();
    expect(productLeft).toHaveLength(1);
    expect(getCustomer(bystanderId)).toBeDefined();
  });

  it("rejects an unknown access code on re-registration without changing the customer", async () => {
    const email = "codigo-malo@example.com";
    const first = await post("/assistant/register", {
      name: "Código Malo",
      email,
      phone: "+34600000004",
      consent_version: 1,
      referrer_id: referrerA.id,
    });
    expect(first.status).toBe(200);
    const customerId = ((await first.json()) as { customer_id: number }).customer_id;

    // An id that is not a real referrer must be rejected BEFORE anything is
    // written: the previous attribution stays and the row is unchanged.
    const bad = await post("/assistant/register", {
      name: "Código Malo",
      email,
      phone: "+34600000004",
      consent_version: 1,
      referrer_id: 999999,
    });
    expect(bad.status).toBe(400);
    expect(getCustomer(customerId)?.referrerId).toBe(referrerA.id);
    expect(getCustomer(customerId)?.name).toBe("Código Malo");
  });

  it("DELETE /admin/customers/:id removes a customer with history instead of failing on a foreign key", async () => {
    const res = await post("/assistant/register", {
      name: "Borrar Vía API",
      email: "borrar-api@example.com",
      phone: "+34600000003",
      consent_version: 1,
      referrer_id: referrerA.id,
    });
    expect(res.status).toBe(200);
    const customerId = ((await res.json()) as { customer_id: number }).customer_id;

    const conversation = db.insert(conversations).values({ customerId }).returning().get();
    db.insert(messages).values({ conversationId: conversation.id, role: "user", content: "hola" }).run();

    // Before the route was wired to the service this returned 500 and the
    // "Eliminar" button appeared to do nothing.
    const del = await app.request(`/admin/customers/${customerId}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect(getCustomer(customerId)).toBeUndefined();

    const remainingMessages = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .all();
    expect(remainingMessages).toHaveLength(0);

    // Unknown id stays a clean 404.
    const missing = await app.request(`/admin/customers/${customerId}`, { method: "DELETE" });
    expect(missing.status).toBe(404);
  });

  it("DELETE /admin/conversations/:id removes a conversation that has recommendations", async () => {
    const res = await post("/assistant/register", {
      name: "Con Recomendación",
      email: "con-reco@example.com",
      phone: "+34600000005",
      consent_version: 1,
      referrer_id: referrerA.id,
    });
    expect(res.status).toBe(200);
    const customerId = ((await res.json()) as { customer_id: number }).customer_id;

    const conversation = db.insert(conversations).values({ customerId }).returning().get();
    db.insert(messages).values({ conversationId: conversation.id, role: "user", content: "hola" }).run();
    db.insert(recommendations).values({
      conversationId: conversation.id,
      customerId,
      symptom: "fatiga",
      productReferences: JSON.stringify([]),
      rationale: "test",
      consentVersion: 1,
    }).run();

    // Before the fix: recommendations referenced the conversation, so this
    // returned 500 and the admin page rendered "Acceso restringido".
    const del = await app.request(`/admin/conversations/${conversation.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    const conversationsLeft = db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id))
      .all();
    expect(conversationsLeft).toHaveLength(0);

    const messagesLeft = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .all();
    expect(messagesLeft).toHaveLength(0);

    const recommendationsLeft = db
      .select()
      .from(recommendations)
      .where(eq(recommendations.conversationId, conversation.id))
      .all();
    expect(recommendationsLeft).toHaveLength(0);

    // The customer survives a conversation delete.
    expect(getCustomer(customerId)).toBeDefined();
  });
});
