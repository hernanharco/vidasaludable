import { describe, it, expect, vi } from "vitest";
import {
  createGeminiClient,
  RETRY_BACKOFF_MS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_MODEL_CHAIN,
} from "../src/agent/gemini.js";

const base = {
  systemPrompt: "system",
  messages: [{ role: "user" as const, content: "hola" }],
};

/** Builds a fake fetch that returns a scripted sequence of statuses. */
function scriptedFetch(statuses: Array<{ status: number; body?: unknown }>): {
  fetch: (url: string, init: unknown) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>;
  calls: Array<{ url: string; init: unknown }>;
} {
  const calls: Array<{ url: string; init: unknown }> = [];
  let i = 0;
  const fetch = async (url: string, init: unknown) => {
    calls.push({ url, init });
    const step = statuses[Math.min(i, statuses.length - 1)]!;
    i += 1;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => step.body ?? {},
    };
  };
  return { fetch, calls };
}

describe("gemini retry/backoff + model fallback + graceful no-key fallback", () => {
  it("retries with backoff 2s/5s/10s on 429 and succeeds on the third attempt", async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetch, calls } = scriptedFetch([
      { status: 429 },
      { status: 503 },
      { status: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } },
    ]);
    const gemini = createGeminiClient({ apiKey: "test-key", model: "gemini-test", fetch, sleep });

    const reply = await gemini.generate(base);

    expect(reply).toBe("ok");
    expect(calls.length).toBe(3);
    // Backoff schedule: sleep called before retries 2 and 3 with 2s and 5s.
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 5000]);
    expect(RETRY_BACKOFF_MS).toEqual([2000, 5000, 10000]);
    // Uses REST v1beta endpoint + primary model.
    expect(calls[0]!.url).toContain("/v1beta/models/gemini-test:generateContent");
    // Key goes in header, never in the URL.
    expect(calls[0]!.url).not.toContain("test-key");
  });

  it("falls back to the alternate model when the primary is rate-limited", async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetch, calls } = scriptedFetch([
      { status: 429 },
      { status: 503 },
      { status: 429 },
      { status: 429 },
      { status: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } },
    ]);
    const gemini = createGeminiClient({
      apiKey: "test-key",
      model: "gemini-primary-test",
      fallbackModel: "gemini-fallback-test",
      fetch,
      sleep,
    });

    const reply = await gemini.generate(base);

    expect(reply).toBe("ok");
    // 4 attempts on the primary (exhausted on 429) + 1 attempt on the fallback.
    expect(calls.length).toBe(5);
    expect(calls[0]!.url).toContain("/models/gemini-primary-test:");
    expect(calls[4]!.url).toContain("/models/gemini-fallback-test:");
    // Backoff only on the primary; the fallback attempt is immediate.
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 5000, 10000]);
  });

  it("throws after every model of an exact chain is exhausted", async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetch, calls } = scriptedFetch([
      { status: 503 },
      { status: 429 },
      { status: 503 },
      { status: 429 },
      { status: 503 },
      { status: 429 },
      { status: 503 },
      { status: 429 },
    ]);
    const gemini = createGeminiClient({
      apiKey: "test-key",
      models: ["gemini-primary-test", "gemini-fallback-test"],
      fetch,
      sleep,
    });

    await expect(gemini.generate(base)).rejects.toThrow(/gemini/);
    // 3 retry sleeps on the primary + 3 on the fallback.
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 5000, 10000, 2000, 5000, 10000]);
    // Both models of the exact chain were tried, in order.
    expect(calls[0]!.url).toContain("/models/gemini-primary-test:");
    expect(calls[4]!.url).toContain("/models/gemini-fallback-test:");
  });

  it("throws immediately on a non-retryable status (no fallback)", async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetch } = scriptedFetch([{ status: 400 }]);
    const gemini = createGeminiClient({
      apiKey: "test-key",
      model: "gemini-test",
      fallbackModel: "gemini-fallback-test",
      fetch,
      sleep,
    });

    await expect(gemini.generate(base)).rejects.toThrow(/non-retryable HTTP 400/);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("falls back gracefully when no API key is configured (no fetch)", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("should not be called");
    });
    const gemini = createGeminiClient({ fetch, sleep: async () => undefined });

    expect(gemini.isConfigured()).toBe(false);
    const reply = await gemini.generate(base);
    expect(reply).toContain("temporalmente sin conexión");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("defaults to free-tier-friendly models (3.5 Flash Lite → 3.1 Flash Lite)", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
    expect(DEFAULT_FALLBACK_MODEL).toBe("gemini-3.1-flash-lite");
  });
});

describe("model rotation chain (S: si un modelo se llena, rota al siguiente)", () => {
  it("rotates past two exhausted models to the third one in the chain", async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetch, calls } = scriptedFetch([
      { status: 429 },
      { status: 429 },
      { status: 429 },
      { status: 429 }, // model 1 exhausted (4 attempts)
      { status: 429 },
      { status: 429 },
      { status: 429 },
      { status: 429 }, // model 2 exhausted
      { status: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } },
    ]);
    const gemini = createGeminiClient({
      apiKey: "test-key",
      models: ["gemini-one", "gemini-two", "gemini-three"],
      fetch,
      sleep,
    });

    const reply = await gemini.generate(base);

    expect(reply).toBe("ok");
    // 4 attempts per exhausted model, then the third model succeeds.
    expect(calls.length).toBe(9);
    expect(calls[0]!.url).toContain("/models/gemini-one:");
    expect(calls[4]!.url).toContain("/models/gemini-two:");
    expect(calls[8]!.url).toContain("/models/gemini-three:");
    // Backoff only inside each model's own retries; rotation itself is immediate.
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([
      2000, 5000, 10000, 2000, 5000, 10000,
    ]);
  });

  it("does not rotate on a non-retryable status", async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetch, calls } = scriptedFetch([{ status: 400 }]);
    const gemini = createGeminiClient({
      apiKey: "test-key",
      models: ["gemini-one", "gemini-two"],
      fetch,
      sleep,
    });

    await expect(gemini.generate(base)).rejects.toThrow(/non-retryable HTTP 400/);
    expect(calls.length).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("builds the chain from GEMINI_MODELS, trimming and dropping blanks", async () => {
    process.env.GEMINI_MODELS = " gemini-env-a ,, gemini-env-b ";
    try {
      const sleep = vi.fn(async () => undefined);
      const { fetch, calls } = scriptedFetch([
        { status: 429 },
        { status: 429 },
        { status: 429 },
        { status: 429 }, // first env model exhausted
        { status: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } },
      ]);
      const gemini = createGeminiClient({ apiKey: "test-key", fetch, sleep });

      const reply = await gemini.generate(base);

      expect(reply).toBe("ok");
      expect(calls[0]!.url).toContain("/models/gemini-env-a:");
      expect(calls[4]!.url).toContain("/models/gemini-env-b:");
      // Only two models in the env chain: no third default model is tried.
      expect(calls.length).toBe(5);
    } finally {
      delete process.env.GEMINI_MODELS;
    }
  });

  it("defaults to the full free-tier rotation chain, primary first and Gemma last", () => {
    expect(DEFAULT_MODEL_CHAIN[0]).toBe(DEFAULT_GEMINI_MODEL);
    expect(DEFAULT_MODEL_CHAIN[1]).toBe(DEFAULT_FALLBACK_MODEL);
    // Lite models with 500 RPD first, quality Flash models in the middle,
    // the 16K-TPM Gemma models as the last resort.
    expect(DEFAULT_MODEL_CHAIN.length).toBeGreaterThanOrEqual(8);
    expect(DEFAULT_MODEL_CHAIN.slice(2, 8)).toEqual([
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3-flash",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ]);
    expect(DEFAULT_MODEL_CHAIN.slice(-2)).toEqual(["gemma-4-31b", "gemma-4-26b"]);
    // No duplicates anywhere in the default chain.
    expect(new Set(DEFAULT_MODEL_CHAIN).size).toBe(DEFAULT_MODEL_CHAIN.length);
  });
});