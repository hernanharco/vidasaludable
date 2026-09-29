import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import type { Db } from "../db/client.js";
import {
  assessmentSymptoms,
  assessmentNutrients,
  assessmentSymptomNutrients,
  assessments,
  assessmentResponses,
  assessmentResults,
} from "../db/assessmentSchema.js";
import { eq, and, sql } from "drizzle-orm";

/**
 * Admin assessment management routes.
 *
 * - Symptoms:    CRUD with referential check before delete.
 * - Nutrients:   CRUD with referential check before delete.
 * - Mappings:    CRUD on the composite key (symptomId + nutrientId).
 * - Results:     Read-only list of completed assessments with patient info.
 */
export function createAdminAssessmentRouter(db: Db): Hono {
  const app = new Hono();

  // Guard: same policy as main admin router
  app.use("*", async (c, next) => {
    const env = process.env.NODE_ENV ?? "development";
    if (env === "development") return next();
    const user = process.env.ADMIN_USER;
    const pass = process.env.ADMIN_PASS;
    if (!user || !pass) {
      return c.json({ error: "admin_no_configurado" }, 503);
    }
    return basicAuth({ username: user, password: pass })(c, next);
  });

  // ─── Symptoms ──────────────────────────────────────────────────────

  app.get("/symptoms", (c) => {
    const all = db.select().from(assessmentSymptoms).all();
    return c.json({ symptoms: all });
  });

  app.post("/symptoms", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const id = Number(body.id);
    const nameEs = String(body.nameEs ?? "").trim();
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: "id must be a positive integer" }, 400);
    }
    if (!nameEs) return c.json({ error: "missing field: nameEs" }, 400);

    const existing = db
      .select()
      .from(assessmentSymptoms)
      .where(eq(assessmentSymptoms.id, id))
      .get();
    if (existing) {
      return c.json({ error: "symptom id already exists" }, 409);
    }

    const symptom = db
      .insert(assessmentSymptoms)
      .values({ id, nameEs })
      .returning()
      .get();

    return c.json({ symptom }, 201);
  });

  app.put("/symptoms/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const nameEs = String(body.nameEs ?? "").trim();
    if (!nameEs) return c.json({ error: "nameEs cannot be empty" }, 400);

    const updated = db
      .update(assessmentSymptoms)
      .set({ nameEs })
      .where(eq(assessmentSymptoms.id, id))
      .returning()
      .get();

    if (!updated) return c.json({ error: "symptom not found" }, 404);
    return c.json({ symptom: updated });
  });

  app.delete("/symptoms/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);

    // Check if any assessment responses reference this symptom
    const refCount = db
      .select({ count: sql<number>`count(*)` })
      .from(assessmentResponses)
      .where(eq(assessmentResponses.symptomId, id))
      .get();
    if (refCount && refCount.count > 0) {
      return c.json(
        { error: `symptom is referenced by ${refCount.count} assessment responses` },
        409,
      );
    }

    // Check if any mappings reference this symptom
    const mapCount = db
      .select({ count: sql<number>`count(*)` })
      .from(assessmentSymptomNutrients)
      .where(eq(assessmentSymptomNutrients.symptomId, id))
      .get();
    if (mapCount && mapCount.count > 0) {
      return c.json(
        { error: `symptom is referenced by ${mapCount.count} nutrient mappings` },
        409,
      );
    }

    const deleted = db
      .delete(assessmentSymptoms)
      .where(eq(assessmentSymptoms.id, id))
      .returning()
      .get();

    if (!deleted) return c.json({ error: "symptom not found" }, 404);
    return c.body(null, 204);
  });

  // ─── Nutrients ─────────────────────────────────────────────────────

  app.get("/nutrients", (c) => {
    const all = db.select().from(assessmentNutrients).all();
    return c.json({ nutrients: all });
  });

  app.post("/nutrients", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const id = String(body.id ?? "").trim();
    const name = String(body.name ?? "").trim();
    const type = String(body.type ?? "").trim();
    if (!id) return c.json({ error: "missing field: id" }, 400);
    if (!name) return c.json({ error: "missing field: name" }, 400);
    if (!type) return c.json({ error: "missing field: type" }, 400);

    const validTypes = ["vitamin", "mineral", "fatty_acid", "supplement"];
    if (!validTypes.includes(type)) {
      return c.json(
        { error: `type must be one of: ${validTypes.join(", ")}` },
        400,
      );
    }

    const existing = db
      .select()
      .from(assessmentNutrients)
      .where(eq(assessmentNutrients.id, id))
      .get();
    if (existing) {
      return c.json({ error: "nutrient id already exists" }, 409);
    }

    const nutrient = db
      .insert(assessmentNutrients)
      .values({ id, name, type })
      .returning()
      .get();

    return c.json({ nutrient }, 201);
  });

  app.put("/nutrients/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const patch: Record<string, string> = {};
    if (body.name != null) {
      const name = String(body.name).trim();
      if (!name) return c.json({ error: "name cannot be empty" }, 400);
      patch.name = name;
    }
    if (body.type != null) {
      const type = String(body.type).trim();
      const validTypes = ["vitamin", "mineral", "fatty_acid", "supplement"];
      if (!validTypes.includes(type)) {
        return c.json(
          { error: `type must be one of: ${validTypes.join(", ")}` },
          400,
        );
      }
      patch.type = type;
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ error: "nothing to update" }, 400);
    }

    const updated = db
      .update(assessmentNutrients)
      .set(patch)
      .where(eq(assessmentNutrients.id, id))
      .returning()
      .get();

    if (!updated) return c.json({ error: "nutrient not found" }, 404);
    return c.json({ nutrient: updated });
  });

  app.delete("/nutrients/:id", (c) => {
    const id = c.req.param("id");

    // Check assessment results referencing this nutrient
    const resCount = db
      .select({ count: sql<number>`count(*)` })
      .from(assessmentResults)
      .where(eq(assessmentResults.nutrientId, id))
      .get();
    if (resCount && resCount.count > 0) {
      return c.json(
        { error: `nutrient is referenced by ${resCount.count} assessment results` },
        409,
      );
    }

    // Check mappings referencing this nutrient
    const mapCount = db
      .select({ count: sql<number>`count(*)` })
      .from(assessmentSymptomNutrients)
      .where(eq(assessmentSymptomNutrients.nutrientId, id))
      .get();
    if (mapCount && mapCount.count > 0) {
      return c.json(
        { error: `nutrient is referenced by ${mapCount.count} symptom mappings` },
        409,
      );
    }

    const deleted = db
      .delete(assessmentNutrients)
      .where(eq(assessmentNutrients.id, id))
      .returning()
      .get();

    if (!deleted) return c.json({ error: "nutrient not found" }, 404);
    return c.body(null, 204);
  });

  // ─── Mappings (symptom ↔ nutrient) ─────────────────────────────────

  app.get("/mappings", (c) => {
    const all = db
      .select({
        symptomId: assessmentSymptomNutrients.symptomId,
        nutrientId: assessmentSymptomNutrients.nutrientId,
        weight: assessmentSymptomNutrients.weight,
        symptomName: assessmentSymptoms.nameEs,
        nutrientName: assessmentNutrients.name,
      })
      .from(assessmentSymptomNutrients)
      .innerJoin(
        assessmentSymptoms,
        eq(assessmentSymptomNutrients.symptomId, assessmentSymptoms.id),
      )
      .innerJoin(
        assessmentNutrients,
        eq(assessmentSymptomNutrients.nutrientId, assessmentNutrients.id),
      )
      .all();

    return c.json({ mappings: all });
  });

  app.post("/mappings", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const symptomId = Number(body.symptomId);
    const nutrientId = String(body.nutrientId ?? "").trim();
    const weight = Number(body.weight ?? 1);

    if (!Number.isInteger(symptomId)) {
      return c.json({ error: "symptomId must be an integer" }, 400);
    }
    if (!nutrientId) {
      return c.json({ error: "missing field: nutrientId" }, 400);
    }
    if (!Number.isInteger(weight) || weight < 1 || weight > 2) {
      return c.json({ error: "weight must be 1 or 2" }, 400);
    }

    // Verify symptom exists
    const symptom = db
      .select()
      .from(assessmentSymptoms)
      .where(eq(assessmentSymptoms.id, symptomId))
      .get();
    if (!symptom) return c.json({ error: "symptom not found" }, 404);

    // Verify nutrient exists
    const nutrient = db
      .select()
      .from(assessmentNutrients)
      .where(eq(assessmentNutrients.id, nutrientId))
      .get();
    if (!nutrient) return c.json({ error: "nutrient not found" }, 404);

    // Check for duplicate composite key
    const existing = db
      .select()
      .from(assessmentSymptomNutrients)
      .where(
        and(
          eq(assessmentSymptomNutrients.symptomId, symptomId),
          eq(assessmentSymptomNutrients.nutrientId, nutrientId),
        ),
      )
      .get();
    if (existing) {
      return c.json({ error: "mapping already exists for this symptom+nutrient" }, 409);
    }

    const mapping = db
      .insert(assessmentSymptomNutrients)
      .values({ symptomId, nutrientId, weight })
      .returning()
      .get();

    return c.json({ mapping }, 201);
  });

  app.put("/mappings", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const symptomId = Number(body.symptomId);
    const nutrientId = String(body.nutrientId ?? "").trim();
    const weight = Number(body.weight);

    if (!Number.isInteger(symptomId)) {
      return c.json({ error: "symptomId must be an integer" }, 400);
    }
    if (!nutrientId) {
      return c.json({ error: "missing field: nutrientId" }, 400);
    }
    if (!Number.isInteger(weight) || weight < 1 || weight > 2) {
      return c.json({ error: "weight must be 1 or 2" }, 400);
    }

    const updated = db
      .update(assessmentSymptomNutrients)
      .set({ weight })
      .where(
        and(
          eq(assessmentSymptomNutrients.symptomId, symptomId),
          eq(assessmentSymptomNutrients.nutrientId, nutrientId),
        ),
      )
      .returning()
      .get();

    if (!updated) return c.json({ error: "mapping not found" }, 404);
    return c.json({ mapping: updated });
  });

  app.delete("/mappings", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    const symptomId = Number(body.symptomId);
    const nutrientId = String(body.nutrientId ?? "").trim();

    if (!Number.isInteger(symptomId)) {
      return c.json({ error: "symptomId must be an integer" }, 400);
    }
    if (!nutrientId) {
      return c.json({ error: "missing field: nutrientId" }, 400);
    }

    const deleted = db
      .delete(assessmentSymptomNutrients)
      .where(
        and(
          eq(assessmentSymptomNutrients.symptomId, symptomId),
          eq(assessmentSymptomNutrients.nutrientId, nutrientId),
        ),
      )
      .returning()
      .get();

    if (!deleted) return c.json({ error: "mapping not found" }, 404);
    return c.body(null, 204);
  });

  // ─── Results (read-only) ───────────────────────────────────────────

  app.get("/results", (c) => {
    const all = db
      .select({
        id: assessments.id,
        patientName: assessments.patientName,
        patientSex: assessments.patientSex,
        patientAge: assessments.patientAge,
        status: assessments.status,
        createdAt: assessments.createdAt,
        completedAt: assessments.completedAt,
      })
      .from(assessments)
      .where(eq(assessments.status, "completed"))
      .all();

    return c.json({ assessments: all });
  });

  return app;
}
