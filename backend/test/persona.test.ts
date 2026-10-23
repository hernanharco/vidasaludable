import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../src/agent/prompt.js";
import { TEMPERATURE } from "../src/agent/gemini.js";

/**
 * agent-persona-memory T1 (S3-S5) — unit tests for the conversational
 * personality and fluidity rules of the chat agent.
 *
 * Pure prompt assertions (same level as profile-block.test.ts):
 *
 * - the persona block is ALWAYS injected, whatever context is present (S3);
 * - the persona pins the conversational style: tuteo, short answers, no
 *   mechanical openings, one follow-up question max (S3/S5);
 * - the agent must NOT push products regardless of what the user writes:
 *   greetings/small talk get a conversational reply with no product list
 *   (S4);
 * - the guided flow keeps its legal HARD_LIMIT and the intake follow-ups,
 *   but no longer forces unconditional recommendations (S5);
 * - the generation temperature is the conversational 0.6 (S5).
 */

const noContext = {
  catalog: { products: [] as never[] },
  guidance: { items: [] },
  video: { items: [] },
};

describe("agent persona (S3)", () => {
  it("always injects the persona block, even with no optional context", () => {
    const prompt = buildSystemPrompt(noContext.catalog, null, noContext.guidance, noContext.video);
    expect(prompt).toContain("TU PERSONALIDAD");
  });

  it("pins the conversational style: tuteo, short answers, no mechanical openings", () => {
    const prompt = buildSystemPrompt(noContext.catalog, null, noContext.guidance, noContext.video);
    expect(prompt).toMatch(/tuteo/i);
    expect(prompt).toMatch(/frases cortas|respuestas cortas/i);
    // No robotic self-introductions as a formula.
    expect(prompt).toMatch(/abertura mecánica|Como asistente/i);
  });

  it("asks at most one follow-up question per reply and empathizes first", () => {
    const prompt = buildSystemPrompt(noContext.catalog, null, noContext.guidance, noContext.video);
    expect(prompt).toMatch(/1 pregunta|una pregunta/i);
    expect(prompt).toMatch(/reconoc/i); // acknowledge how the user feels
  });

  it("keeps the legal HARD_LIMIT intact next to the persona", () => {
    const prompt = buildSystemPrompt(noContext.catalog, null, noContext.guidance, noContext.video);
    expect(prompt).toContain("LÍMITE DURO E INVIOLABLE");
    expect(prompt).toContain("ERES UN ASISTENTE PREVENTIVO DE NUTRILITE™");
  });
});

describe("no product pushing (S4)", () => {
  it("forbids recommending products regardless of the user's message", () => {
    const prompt = buildSystemPrompt(noContext.catalog, null, noContext.guidance, noContext.video);
    expect(prompt).toMatch(/NO recomiendes productos por recomendar|sin forzar recomendaciones/i);
    // Greetings / general chat: reply as a person, never a product list.
    expect(prompt).toMatch(/saludo/i);
  });
});

describe("guided flow and fluidity (S5)", () => {
  it("no longer forces unconditional recommendations in the guided flow", () => {
    const prompt = buildSystemPrompt(noContext.catalog, null, noContext.guidance, noContext.video);
    // The old fixed ritual ("DESPUÉS da tus recomendaciones" unconditionally)
    // is replaced by a conditional instruction.
    expect(prompt).not.toContain("DESPUÉS da tus recomendaciones");
    expect(prompt).toMatch(/solo si|si el tema|solo cuando/i);
  });

  it("keeps the intake follow-up opening and the [ASSESSMENT] marker contract", () => {
    const prompt = buildSystemPrompt(noContext.catalog, null, noContext.guidance, noContext.video);
    expect(prompt).toMatch(/preguntas/i);
    expect(prompt).toMatch(/abiertas/i);
    expect(prompt).toContain("[ASSESSMENT]");
  });

  it("uses the conversational temperature (0.6)", () => {
    expect(TEMPERATURE).toBe(0.6);
  });
});
