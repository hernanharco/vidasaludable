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
    // Verificado contra la consola de AI Studio (2026-11-23): los flash de 20
    // RPD en orden de novedad. `gemini-3.7-flash` NO existe en la cuenta y se
    // sacó de la cadena (ver el describe de 404 más abajo).
    expect(DEFAULT_MODEL_CHAIN.slice(2, 7)).toEqual([
      "gemini-3.8-flash",
      "gemini-3.6-flash",
      "gemini-3-flash",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ]);
    expect(DEFAULT_MODEL_CHAIN).not.toContain("gemini-3.7-flash");
    expect(DEFAULT_MODEL_CHAIN.slice(-2)).toEqual(["gemma-4-31b", "gemma-4-26b"]);
    // No duplicates anywhere in the default chain.
    expect(new Set(DEFAULT_MODEL_CHAIN).size).toBe(DEFAULT_MODEL_CHAIN.length);
  });
});
/**
 * Incidente 2026-11-23: la fila del video mostraba
 * "Gemini falló al analizar la transcripción: gemini: transient HTTP 503".
 * Causa: dentro del modelo se reintentaba el 503, pero la rotación de la
 * cadena solo se disparaba con 429 — o sea, una sobrecarga de Google en el
 * primer modelo mataba el análisis dejando 9 modelos sin usar.
 */
describe("sobrecarga de Google (503): rota al siguiente modelo, no se rinde", () => {
  it("rota cuando el primer modelo está sobrecargado (503 x4)", async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetch, calls } = scriptedFetch([
      { status: 503 },
      { status: 503 },
      { status: 503 },
      { status: 503 }, // modelo 1 sobrecargado: 4 intentos
      { status: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } },
    ]);
    const gemini = createGeminiClient({
      apiKey: "test-key",
      models: ["gemini-one", "gemini-two"],
      fetch,
      sleep,
    });

    const reply = await gemini.generate(base);

    expect(reply).toBe("ok");
    expect(calls.length).toBe(5);
    expect(calls[0]!.url).toContain("/models/gemini-one:");
    expect(calls[4]!.url).toContain("/models/gemini-two:");
    // El backoff es dentro de cada modelo; la rotación es inmediata.
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 5000, 10000]);
  });

  it("informa la cadena agotada y conserva la causa cuando todos son 503", async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetch, calls } = scriptedFetch([{ status: 503 }]);
    const gemini = createGeminiClient({
      apiKey: "test-key",
      models: ["gemini-one", "gemini-two"],
      fetch,
      sleep,
    });

    const error = (await gemini.generate(base).then(
      () => null,
      (err: unknown) => err as Error & { status?: number; cause?: unknown },
    ))!;

    expect(calls.length).toBe(8); // 4 intentos x 2 modelos
    expect(error.status).toBe(503);
    expect(error.message).toMatch(/^gemini: /);
    // Nombra cuántos modelos se intentaron: la evidencia que faltaba.
    expect(error.message).toContain("2 models");
    // La causa original sobrevive para el log del servidor.
    expect((error.cause as { status?: number }).status).toBe(503);
    expect((error.cause as Error).message).toBe("gemini: transient HTTP 503");
  });
});

/**
 * Un modelo inexistente o deprecado responde 404. Antes eso era "non-retryable"
 * y abortaba la cadena entera: `gemini-3.7-flash` (que no existe en la cuenta,
 * verificado contra AI Studio el 2026-11-23) era un muro en la posición 4.
 * Reintentar un 404 no sirve (el modelo no va a aparecer), pero abortar deja
 * modelos sanos sin usar: rota sin reintento.
 */
describe("modelo inexistente/deprecado (404): rota sin reintentar", () => {
  it("pasa al siguiente modelo en vez de abortar la cadena", async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetch, calls } = scriptedFetch([
      { status: 404 }, // p. ej. un modelo renombrado o dado de baja
      { status: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } },
    ]);
    const gemini = createGeminiClient({
      apiKey: "test-key",
      models: ["gemini-phantom", "gemini-real"],
      fetch,
      sleep,
    });

    const reply = await gemini.generate(base);

    expect(reply).toBe("ok");
    // Un solo intento por modelo fantasma: el 404 no se reintenta in-model.
    expect(calls.length).toBe(2);
    expect(calls[0]!.url).toContain("/models/gemini-phantom:");
    expect(calls[1]!.url).toContain("/models/gemini-real:");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("informa 404 cuando ningún modelo de la cadena existe", async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetch, calls } = scriptedFetch([{ status: 404 }]);
    const gemini = createGeminiClient({
      apiKey: "test-key",
      models: ["gemini-ghost-a", "gemini-ghost-b"],
      fetch,
      sleep,
    });

    const error = (await gemini.generate(base).then(
      () => null,
      (err: unknown) => err as Error & { status?: number },
    ))!;

    expect(calls.length).toBe(2); // sin reintentos: 1 intento por modelo
    expect(error.status).toBe(404);
    expect(error.message).toContain("2 models");
    expect(error.message).toContain("404");
  });
});

/**
 * Deuda L13: el timeout del runner era un Promise.race sin AbortController, así
 * que el fetch real seguía vivo consumiendo cuota después de declarar el fallo.
 * El cliente ahora acepta la señal y aborta la petición en vuelo.
 */
describe("cancelación: el fetch en vuelo muere con la señal", () => {
  it("pasa la señal al fetch y rechaza con AbortError al abortar", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    let started: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetch = async (_url: string, init: unknown) => {
      seenSignal = (init as { signal?: AbortSignal }).signal;
      started();
      return new Promise<never>((_resolve, reject) => {
        seenSignal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" })),
        );
      });
    };
    const gemini = createGeminiClient({
      apiKey: "test-key",
      models: ["gemini-one"],
      fetch,
      sleep: async () => undefined,
    });

    const pending = gemini.generate({ ...base, signal: controller.signal });
    await ready;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(seenSignal).toBe(controller.signal);
  });

  it("no aborta nada cuando no se pasa señal (comportamiento previo intacto)", async () => {
    const { fetch, calls } = scriptedFetch([
      { status: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } },
    ]);
    const gemini = createGeminiClient({ apiKey: "test-key", models: ["gemini-one"], fetch, sleep: async () => undefined });

    expect(await gemini.generate(base)).toBe("ok");
    expect(calls.length).toBe(1);
    expect((calls[0]!.init as { signal?: AbortSignal }).signal).toBeUndefined();
  });
});
