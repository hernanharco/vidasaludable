import { describe, it, expect } from "vitest";
import { buildSystemPrompt, memoryBlock } from "../src/agent/prompt.js";

/**
 * agent-persona-memory T2 (S1) — unit tests for the long-term memory prompt
 * injection.
 *
 * Pure assertions over `memoryBlock` and the 6th positional parameter of
 * `buildSystemPrompt` (same level as profile-block.test.ts):
 *
 * - null / blank memory renders "" (no stale header, same convention as
 *   guidanceBlock / profileBlock / videoSegmentsBlock);
 * - a stored summary renders a Spanish block that tells the agent to resume
 *   the topic naturally and never to say "según mis registros";
 * - the block lands after the intake profile and before the purchases block;
 * - the call stays backwards-compatible without the 6th argument.
 */

const noContext = {
  catalog: { products: [] as never[] },
  guidance: { items: [] },
  video: { items: [] },
};

const summary = "Cliente preocupa por la energía; ya probó Biotina C Plus.";

describe("memoryBlock (S1)", () => {
  it("returns \"\" for null / blank content (no stale header)", () => {
    expect(memoryBlock(null)).toBe("");
    expect(memoryBlock(undefined)).toBe("");
    expect(memoryBlock("")).toBe("");
    expect(memoryBlock("   ")).toBe("");
  });

  it("renders a Spanish block with the natural-resume instruction", () => {
    const block = memoryBlock(summary);
    expect(block).toContain("CONVERSACIONES ANTERIORES");
    expect(block).toContain(summary);
    // Natural recall, never a database-flavored phrasing.
    expect(block).toMatch(/sin decir «?según mis registros/i);
  });
});

describe("buildSystemPrompt (memory parameter)", () => {
  it("injects the memory block after the profile and before the purchases block", () => {
    const prompt = buildSystemPrompt(
      noContext.catalog,
      { refs: ["100305"] },
      noContext.guidance,
      noContext.video,
      { goal: "energía" },
      summary,
    );
    const headerIdx = prompt.indexOf("CONTEXTO DE ESTA CONVERSACIÓN:");
    const profileIdx = prompt.indexOf("PERFIL DEL USUARIO");
    const memoryIdx = prompt.indexOf("CONVERSACIONES ANTERIORES");
    const purchasesIdx = prompt.indexOf("HISTORIAL DE COMPRAS DEL USUARIO");
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(profileIdx).toBeGreaterThan(headerIdx);
    expect(memoryIdx).toBeGreaterThan(profileIdx);
    expect(purchasesIdx).toBeGreaterThan(memoryIdx);
  });

  it("omits the memory block entirely for null / blank summaries", () => {
    const prompt = buildSystemPrompt(
      noContext.catalog,
      null,
      noContext.guidance,
      noContext.video,
      null,
      "",
    );
    expect(prompt).not.toContain("CONVERSACIONES ANTERIORES");
  });

  it("stays backwards-compatible without the 6th argument", () => {
    const prompt = buildSystemPrompt(noContext.catalog, null, noContext.guidance, noContext.video);
    expect(prompt).not.toContain("CONVERSACIONES ANTERIORES");
    expect(prompt).toContain("CATÁLOGO DISPONIBLE");
    // The T1 persona and the legal HARD_LIMIT are still there.
    expect(prompt).toContain("TU PERSONALIDAD");
    expect(prompt).toContain("LÍMITE DURO E INVIOLABLE");
  });
});
