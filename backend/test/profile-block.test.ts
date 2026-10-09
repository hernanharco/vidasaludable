import { describe, it, expect } from "vitest";
import { buildSystemPrompt, profileBlock } from "../src/agent/prompt.js";

/**
 * T2 chat-intake — unit tests for the intake profile prompt injection.
 *
 * Pure tests over `profileBlock` and `buildSystemPrompt` (no HTTP, no DB —
 * same level as the videoSegmentsBlock tests in video-agent.test.ts):
 *
 * - a profile with values renders a Spanish block with all provided data;
 * - null / all-empty profiles render "" (no stale "PERFIL DEL USUARIO"
 *   header, mirroring guidanceBlock / videoSegmentsBlock);
 * - the full prompt carries the guided-flow instruction (open follow-up
 *   questions + the exact [ASSESSMENT] marker) when a profile is injected;
 * - existing blocks (catalog) are unchanged with or without a profile.
 */

const fullProfile = {
  sex: "F",
  age: 42,
  goal: "inmunidad",
  diet: "omnívora",
  activity: "leve",
  sleep: "5-6 h",
  stress: "alto",
  openNote: "me canso mucho por la tarde",
};

describe("profileBlock", () => {
  it("renders a Spanish block with every provided field", () => {
    const block = profileBlock(fullProfile);
    expect(block).toContain("PERFIL DEL USUARIO");
    expect(block).toContain("42"); // age
    expect(block).toContain("F"); // sex
    expect(block).toContain("inmunidad"); // goal
    expect(block).toContain("omnívora"); // diet
    expect(block).toContain("leve"); // activity
    expect(block).toContain("5-6 h"); // sleep
    expect(block).toContain("alto"); // stress
    expect(block).toContain("me canso mucho por la tarde"); // openNote
    // Never leaks raw values into labels.
    expect(block).not.toContain("undefined");
    expect(block).not.toContain("null");
  });

  it("renders only lines for fields that exist (partial profile)", () => {
    const block = profileBlock({ goal: "energía", openNote: "trabajo por turnos" });
    expect(block).toContain("energía");
    expect(block).toContain("trabajo por turnos");
    expect(block).not.toContain("undefined");
    expect(block).not.toContain("null");
    // No label for absent fields.
    expect(block).not.toContain("Sexo");
    expect(block).not.toContain("Sueño");
  });

  it("returns \"\" for null (no stale header, same convention as guidanceBlock)", () => {
    expect(profileBlock(null)).toBe("");
  });

  it("returns \"\" for an all-empty profile (empty strings / nulls / undefined)", () => {
    expect(profileBlock({})).toBe("");
    expect(
      profileBlock({
        sex: "",
        age: null,
        goal: undefined,
        diet: null,
        activity: "",
        sleep: null,
        stress: undefined,
        openNote: "",
      }),
    ).toBe("");
  });
});

describe("buildSystemPrompt (profile context parameter)", () => {
  const catalog = { products: [] as never[] };
  const guidance = { items: [] };
  const video = { items: [] };

  it("injects the profile block right after the conversation header, before purchases", () => {
    const prompt = buildSystemPrompt(catalog, { refs: ["100305"] }, guidance, video, fullProfile);
    const headerIdx = prompt.indexOf("CONTEXTO DE ESTA CONVERSACIÓN:");
    const profileIdx = prompt.indexOf("PERFIL DEL USUARIO");
    const purchasesIdx = prompt.indexOf("HISTORIAL DE COMPRAS DEL USUARIO");
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(profileIdx).toBeGreaterThan(headerIdx);
    expect(purchasesIdx).toBeGreaterThan(profileIdx);
  });

  it("carries the guided-flow instruction: open follow-ups + exact [ASSESSMENT] marker", () => {
    const prompt = buildSystemPrompt(catalog, null, guidance, video, fullProfile);
    expect(prompt).toContain("[ASSESSMENT]");
    // Open follow-up questions based on the profile, without re-asking it.
    expect(prompt).toMatch(/preguntas/i);
    expect(prompt).toMatch(/abiertas/i);
    // The legal HARD_LIMIT rules stay intact alongside the new instruction.
    expect(prompt).toContain("LÍMITE DURO E INVIOLABLE");
  });

  it("omits the profile block entirely for null / all-empty profiles", () => {
    const nullPrompt = buildSystemPrompt(catalog, null, guidance, video, null);
    expect(nullPrompt).not.toContain("PERFIL DEL USUARIO");

    const emptyPrompt = buildSystemPrompt(catalog, null, guidance, video, {
      sex: "",
      age: null,
      goal: null,
      diet: null,
      activity: null,
      sleep: null,
      stress: null,
      openNote: null,
    });
    expect(emptyPrompt).not.toContain("PERFIL DEL USUARIO");
  });

  it("keeps the existing blocks unchanged without a profile (backwards-compatible call)", () => {
    // video-agent.test.ts still calls with the original 4 positional args.
    const prompt = buildSystemPrompt(catalog, null, guidance, video);
    expect(prompt).toContain("CATÁLOGO DISPONIBLE");
    expect(prompt).not.toContain("PERFIL DEL USUARIO");
  });

  it("keeps the catalog block present when a profile is injected", () => {
    const prompt = buildSystemPrompt(catalog, null, guidance, video, fullProfile);
    expect(prompt).toContain("CATÁLOGO DISPONIBLE");
  });
});
