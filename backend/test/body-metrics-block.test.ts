import { describe, it, expect } from "vitest";
import { buildSystemPrompt, bodyMetricsBlock } from "../src/agent/prompt.js";

/**
 * tamizaje-images T2 (S1, S3 "Inyectar en el agente") — unit tests for the
 * optional body-composition prompt injection and the `[CITA]` marker.
 *
 * Pure assertions over `bodyMetricsBlock` and the 8th positional parameter of
 * `buildSystemPrompt` (same level as memory-block.test.ts):
 *
 * - null / absent row renders "" (no stale header, same convention as
 *   memoryBlock / profileBlock / guidanceBlock / videoSegmentsBlock);
 * - a stored record renders a Spanish block with the lifestyle-only /
 *   never-diagnosis instruction (RENPHO's own note: it does not replace
 *   medical equipment);
 * - the block lands AFTER the memory block and before the purchases block;
 * - the call stays backwards-compatible without the 8th argument;
 * - the prompt documents the literal `[CITA]` marker (appointment card,
 *   same mechanism as `[ASSESSMENT]`) wherever `[ASSESSMENT]` is documented.
 */

const noContext = {
  catalog: { products: [] as never[] },
  guidance: { items: [] },
  video: { items: [] },
};

/** The ODD reference record (RENPHO report). */
const renpho = {
  measuredAt: "2026-11-11",
  source: "RENPHO",
  weightKg: 77.85,
  bmi: 26.3,
  bodyFatPct: 26.9,
  visceralFat: 9,
  muscleMassKg: 54.1,
  metabolicAge: 39,
  bmrKcal: 1599,
  waterPct: 52.8,
  proteinPct: 13,
  notes: "reporte RENPHO",
};

describe("bodyMetricsBlock (S1)", () => {
  it("returns \"\" for null / undefined data (no stale header)", () => {
    expect(bodyMetricsBlock(null)).toBe("");
    expect(bodyMetricsBlock(undefined)).toBe("");
  });

  it("renders a Spanish block with the record and the lifestyle-only instruction", () => {
    const block = bodyMetricsBlock(renpho);
    expect(block).toContain("COMPOSICIÓN CORPORAL");
    expect(block).toContain("2026-11-11"); // measured date
    expect(block).toContain("RENPHO"); // source
    expect(block).toContain("77,85"); // Spanish decimal comma
    expect(block).toContain("26,9"); // body fat %
    expect(block).toContain("reporte RENPHO"); // notes
    // Instruction (a): lifestyle input ONLY, never diagnosis/treatment.
    expect(block).toMatch(/estilo de vida/i);
    expect(block).toMatch(/NUNCA/);
    expect(block).toMatch(/diagn[óo]stico/i);
    // Never leaks raw values into labels.
    expect(block).not.toContain("undefined");
    expect(block).not.toContain("null");
  });

  it("renders only lines for the fields that exist (partial record)", () => {
    const block = bodyMetricsBlock({ measuredAt: "2026-11-11", weightKg: 70 });
    expect(block).toContain("70");
    expect(block).toContain("2026-11-11");
    expect(block).not.toContain("IMC");
    expect(block).not.toContain("Grasa corporal");
    expect(block).not.toContain("undefined");
    expect(block).not.toContain("null");
  });
});

describe("buildSystemPrompt (bodyMetrics parameter)", () => {
  it("injects the block after the memory block and before the purchases block", () => {
    const prompt = buildSystemPrompt(
      noContext.catalog,
      { refs: ["100305"] },
      noContext.guidance,
      noContext.video,
      { goal: "energía" },
      "resumen de memoria previo",
      renpho,
    );
    const headerIdx = prompt.indexOf("CONTEXTO DE ESTA CONVERSACIÓN:");
    const memoryIdx = prompt.indexOf("CONVERSACIONES ANTERIORES");
    const metricsIdx = prompt.indexOf("COMPOSICIÓN CORPORAL");
    const purchasesIdx = prompt.indexOf("HISTORIAL DE COMPRAS DEL USUARIO");
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(memoryIdx).toBeGreaterThan(headerIdx);
    expect(metricsIdx).toBeGreaterThan(memoryIdx); // right after memoryBlock
    expect(purchasesIdx).toBeGreaterThan(metricsIdx);
  });

  it("omits the block entirely when there is no data", () => {
    const prompt = buildSystemPrompt(
      noContext.catalog,
      null,
      noContext.guidance,
      noContext.video,
      null,
      null,
    );
    expect(prompt).not.toContain("COMPOSICIÓN CORPORAL");
  });

  it("stays backwards-compatible without the 8th argument", () => {
    const prompt = buildSystemPrompt(noContext.catalog, null, noContext.guidance, noContext.video);
    expect(prompt).not.toContain("COMPOSICIÓN CORPORAL");
    expect(prompt).toContain("CATÁLOGO DISPONIBLE");
    // Existing contracts are untouched.
    expect(prompt).toContain("TU PERSONALIDAD");
    expect(prompt).toContain("LÍMITE DURO E INVIOLABLE");
    expect(prompt).toContain("[ASSESSMENT]");
  });
});

describe("[CITA] marker instruction (S3)", () => {
  it("documents the literal [CITA] marker like [ASSESSMENT], tied to the tamizaje/cita request", () => {
    const prompt = buildSystemPrompt(noContext.catalog, null, noContext.guidance, noContext.video);
    // The marker itself, written literally in the prompt.
    expect(prompt).toContain("[CITA]");
    // Same mechanism as [ASSESSMENT] — both marker contracts survive.
    expect(prompt).toContain("[ASSESSMENT]");
    // The instruction ties it to the in-person screening / appointment ask.
    expect(prompt).toMatch(/tamizaje/i);
    expect(prompt).toMatch(/cita/i);
    // Unconditional: present with or without an injected profile block.
    const withProfile = buildSystemPrompt(
      noContext.catalog,
      null,
      noContext.guidance,
      noContext.video,
      { goal: "energía" },
      null,
      null,
    );
    expect(withProfile).toContain("[CITA]");
  });
});

describe("proactive [CITA] offer instruction (T6b)", () => {
  it("extends the [CITA] rule with the proactive, once-per-topic offer", () => {
    const prompt = buildSystemPrompt(noContext.catalog, null, noContext.guidance, noContext.video);

    // Rule 9's on-demand contract stays intact (extend, don't rewrite).
    expect(prompt).toContain("solo cuando lo pida el usuario");
    expect(prompt).toContain("[CITA]");

    // The proactive instruction sits right after the [CITA] rule (rule 9).
    const citaRuleIdx = prompt.indexOf("CITA PARA EL TAMIZAJE PRESENCIAL");
    const proactiveIdx = prompt.indexOf("OFRECIMIENTO PROACTIVO DEL TAMIZAJE");
    expect(citaRuleIdx).toBeGreaterThan(0);
    expect(proactiveIdx).toBeGreaterThan(citaRuleIdx);

    // Topic triggers of the T6b scope (weight loss, body fat, weighing
    // themselves, muscle mass, body composition, body goals).
    for (const topic of [
      "bajar de peso",
      "grasa corporal",
      "pesarse",
      "masa muscular",
      "composición corporal",
      "objetivos corporales",
    ]) {
      expect(prompt).toContain(topic);
    }

    // Once per topic, no repeat after accept/decline, natural — never pushy.
    expect(prompt).toMatch(/UNA VEZ POR TEMA/);
    expect(prompt).toContain("aceptó");
    expect(prompt).toContain("rechazó");
    expect(prompt).toMatch(/venta forzada/);
  });

  it("is unconditional: present with and without an injected profile block", () => {
    const withoutProfile = buildSystemPrompt(
      noContext.catalog,
      null,
      noContext.guidance,
      noContext.video,
    );
    const withProfile = buildSystemPrompt(
      noContext.catalog,
      null,
      noContext.guidance,
      noContext.video,
      { goal: "energía" },
      null,
      null,
    );
    expect(withoutProfile).toContain("OFRECIMIENTO PROACTIVO DEL TAMIZAJE");
    expect(withProfile).toContain("OFRECIMIENTO PROACTIVO DEL TAMIZAJE");
  });
});
