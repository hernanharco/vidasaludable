import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { ChatPage } from "../src/app/components/chat";

/**
 * T2 of access-code-always → access-code-once (reversed 2026-11-11).
 *
 * Original decision (2026-10-09): even a returning visitor (persisted
 * `vr_customer_id`) must pass the access-code gate on every visit.
 * User reversal (2026-11-11): the code is a ONE-TIME action per browser —
 * enter it, register, and from then on the visitor talks to the agent
 * without the gate. The validated referrer is persisted (vr_referrer_id /
 * vr_referrer_name) and the boot effect replays the same post-code path
 * (attribution → profile check → intake|chat) directly, so consent 401 and
 * corrupt-identity 400/404 handling is unchanged.
 *
 * Covered behaviors (public interface: render /chat, type the code, confirm):
 *
 *  1. BOOT — a returning customer with a STORED REFERRER boots straight
 *     into chat (no gate); attribution still runs last-touch with the
 *     stored referrer. A returning customer WITHOUT the stored referrer
 *     (legacy browsers) still sees the gate once, then it is persisted.
 *  2. 200 — the code validates → persisted → POST /assistant/attribution
 *     with the stored customer_id and the referrer_id → profile exists → chat.
 *  3. 200 (no profile) — → intake questionnaire instead of chat.
 *  4. 401 — stale consent → the re-consent gate ("Actualiza tu
 *     consentimiento") and the identity is KEPT (no localStorage clear).
 *  5. 404 / 400 — corrupt identity → localStorage cleared (vr_customer_id +
 *     vr_conversation_id) and the FULL registration gate; the validated
 *     referrer survives (the code was real, only the identity is corrupt).
 *  6. FRESH VISITOR — no customer_id → full gate, attribution never called.
 */

const mockFetch = vi.fn();
global.fetch = mockFetch;

function installMemoryLocalStorage() {
  // jsdom under vitest runs with an opaque origin; see ChatPage.test.tsx.
  const store = new Map<string, string>();
  const impl = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: impl });
}

installMemoryLocalStorage();

const CUSTOMER_ID = 42;
const CONVERSATION_ID = 7;
const REFERRER_ID = 5;

const SERVER_PROFILE = {
  customer_id: CUSTOMER_ID,
  sex: "F",
  age: 34,
  goal: "Sueño",
  diet: "Vegetariana",
  activity: "Leve",
  sleep: "7-8 h",
  stress: "Medio",
  open_note: "Me canso por la noche.",
  updated_at: "2026-01-01T00:00:00.000Z",
};

interface FetchConfig {
  /** Status of POST /api/assistant/attribution. */
  attributionStatus: number;
  /** Body of POST /api/assistant/attribution per status. */
  attributionBody?: unknown;
  /** Profile returned by GET /api/assistant/profile (null → intake). */
  profile?: typeof SERVER_PROFILE | null;
}

function installFetch(config: FetchConfig) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);

    if (u.includes("/api/referrer/validate")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ valid: true, referrerId: REFERRER_ID, referrerName: "Referente Nuevo" }),
      });
    }
    if (u.includes("/api/assistant/attribution")) {
      const status = config.attributionStatus;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () =>
          Promise.resolve(
            config.attributionBody ?? (status === 200 ? { ok: true } : { error: "error" }),
          ),
      });
    }
    if (u.includes("/api/assistant/profile")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            profile: config.profile === undefined ? SERVER_PROFILE : config.profile,
          }),
      });
    }
    if (u.includes("/api/assistant/history")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: [] }),
      });
    }
    if (u.includes("/api/assistant/consent")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ version: 1, text: "Consentimiento informado." }),
      });
    }
    // videos / products — best-effort
    void init;
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
}

function attributionCalls(): Array<{ customer_id: unknown; referrer_id: unknown }> {
  return mockFetch.mock.calls
    .filter(([url]) => String(url).includes("/api/assistant/attribution"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as {
      customer_id: unknown;
      referrer_id: unknown;
    });
}

function renderChatPage() {
  return render(
    <MemoryRouter initialEntries={["/chat"]}>
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Types the code, validates and confirms — lands on handleAccessCodeValidated. */
async function enterAccessCode(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Código de acceso");
  await user.type(screen.getByPlaceholderText("Ej: 7023369988"), "7023369988");
  await user.click(screen.getByRole("button", { name: "Validar código" }));
  await screen.findByText("Código válido");
  await user.click(screen.getByRole("button", { name: "Continuar" }));
}

describe("access-code-always (returning customer is asked the code on every visit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("boots a RETURNING customer into the access-code gate, not into chat", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    window.localStorage.setItem("vr_conversation_id", String(CONVERSATION_ID));
    installFetch({ attributionStatus: 200 });

    renderChatPage();

    // The gate shows BEFORE any attribution request is made.
    expect(await screen.findByText("Código de acceso")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Escribe un mensaje...")).not.toBeInTheDocument();
    expect(attributionCalls()).toHaveLength(0);
  });

  it("200: attributes last-touch (POST with stored customer + new referrer) and opens chat", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    window.localStorage.setItem("vr_conversation_id", String(CONVERSATION_ID));
    installFetch({ attributionStatus: 200, profile: SERVER_PROFILE });

    const user = userEvent.setup();
    renderChatPage();
    await enterAccessCode(user);

    const calls = attributionCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ customer_id: CUSTOMER_ID, referrer_id: REFERRER_ID });

    expect(await screen.findByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
    expect(screen.queryByText("Código de acceso")).not.toBeInTheDocument();
  });

  it("200 without profile: runs the intake questionnaire instead of chat", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ attributionStatus: 200, profile: null });

    const user = userEvent.setup();
    renderChatPage();
    await enterAccessCode(user);

    expect(await screen.findByText("Cuéntanos sobre ti")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Escribe un mensaje...")).not.toBeInTheDocument();
  });

  it("401: stale consent → re-consent gate, identity KEPT", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    window.localStorage.setItem("vr_conversation_id", String(CONVERSATION_ID));
    installFetch({
      attributionStatus: 401,
      attributionBody: { error: "CONSENT_REQUIRED", consent: { version: 1, text: "Nuevo texto." } },
    });

    const user = userEvent.setup();
    renderChatPage();
    await enterAccessCode(user);

    expect(await screen.findByText("Actualiza tu consentimiento")).toBeInTheDocument();
    // Stale consent is not a corrupt identity: nothing is cleared.
    expect(window.localStorage.getItem("vr_customer_id")).toBe(String(CUSTOMER_ID));
    expect(window.localStorage.getItem("vr_conversation_id")).toBe(String(CONVERSATION_ID));
  });

  it("404: unknown customer → identity cleared and FULL registration gate", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    window.localStorage.setItem("vr_conversation_id", String(CONVERSATION_ID));
    installFetch({ attributionStatus: 404, attributionBody: { error: "customer no encontrado" } });

    const user = userEvent.setup();
    renderChatPage();
    await enterAccessCode(user);

    expect(await screen.findByText("Antes de empezar")).toBeInTheDocument();
    expect(window.localStorage.getItem("vr_customer_id")).toBeNull();
    expect(window.localStorage.getItem("vr_conversation_id")).toBeNull();
  });

  it("400: invalid customer_id (corrupt identity) → identity cleared and FULL registration gate", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    window.localStorage.setItem("vr_conversation_id", String(CONVERSATION_ID));
    installFetch({ attributionStatus: 400, attributionBody: { error: "customer_id inválido" } });

    const user = userEvent.setup();
    renderChatPage();
    await enterAccessCode(user);

    expect(await screen.findByText("Antes de empezar")).toBeInTheDocument();
    expect(window.localStorage.getItem("vr_customer_id")).toBeNull();
    expect(window.localStorage.getItem("vr_conversation_id")).toBeNull();
  });

  it("fresh visitor: no customer_id → full gate and attribution is never called", async () => {
    installFetch({ attributionStatus: 200 });

    const user = userEvent.setup();
    renderChatPage();
    await enterAccessCode(user);

    expect(await screen.findByText("Antes de empezar")).toBeInTheDocument();
    expect(attributionCalls()).toHaveLength(0);
  });
});

describe("access-code-once (the gate is asked once per browser)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("persists the validated referrer when the code is confirmed", async () => {
    installFetch({ attributionStatus: 200 });

    const user = userEvent.setup();
    renderChatPage();
    await enterAccessCode(user);

    expect(await screen.findByText("Antes de empezar")).toBeInTheDocument();
    expect(window.localStorage.getItem("vr_referrer_id")).toBe(String(REFERRER_ID));
    expect(window.localStorage.getItem("vr_referrer_name")).toBe("Referente Nuevo");
  });

  it("returning customer with stored identity + referrer boots into chat WITHOUT the gate", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    window.localStorage.setItem("vr_conversation_id", String(CONVERSATION_ID));
    window.localStorage.setItem("vr_referrer_id", String(REFERRER_ID));
    window.localStorage.setItem("vr_referrer_name", "Referente Nuevo");
    installFetch({ attributionStatus: 200, profile: SERVER_PROFILE });

    renderChatPage();

    expect(await screen.findByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
    expect(screen.queryByText("Código de acceso")).not.toBeInTheDocument();

    // The gateless boot still runs last-touch attribution with the stored referrer.
    const calls = attributionCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ customer_id: CUSTOMER_ID, referrer_id: REFERRER_ID });
  });

  it("stored referrer without identity → registration gate directly, code never asked", async () => {
    window.localStorage.setItem("vr_referrer_id", String(REFERRER_ID));
    window.localStorage.setItem("vr_referrer_name", "Referente Nuevo");
    installFetch({ attributionStatus: 200 });

    renderChatPage();

    expect(await screen.findByText("Antes de empezar")).toBeInTheDocument();
    expect(screen.queryByText("Código de acceso")).not.toBeInTheDocument();
    expect(attributionCalls()).toHaveLength(0);
  });

  it("gateless boot still enforces consent: 401 → re-consent gate, identity KEPT", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    window.localStorage.setItem("vr_conversation_id", String(CONVERSATION_ID));
    window.localStorage.setItem("vr_referrer_id", String(REFERRER_ID));
    window.localStorage.setItem("vr_referrer_name", "Referente Nuevo");
    installFetch({
      attributionStatus: 401,
      attributionBody: { error: "CONSENT_REQUIRED", consent: { version: 2, text: "Nuevo texto." } },
    });

    renderChatPage();

    expect(await screen.findByText("Actualiza tu consentimiento")).toBeInTheDocument();
    expect(screen.queryByText("Código de acceso")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("vr_customer_id")).toBe(String(CUSTOMER_ID));
    expect(window.localStorage.getItem("vr_conversation_id")).toBe(String(CONVERSATION_ID));
  });

  it("gateless boot repairs corrupt identity: 404 → cleared + full registration, referrer kept", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    window.localStorage.setItem("vr_conversation_id", String(CONVERSATION_ID));
    window.localStorage.setItem("vr_referrer_id", String(REFERRER_ID));
    window.localStorage.setItem("vr_referrer_name", "Referente Nuevo");
    installFetch({ attributionStatus: 404, attributionBody: { error: "customer no encontrado" } });

    renderChatPage();

    expect(await screen.findByText("Antes de empezar")).toBeInTheDocument();
    expect(screen.queryByText("Código de acceso")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("vr_customer_id")).toBeNull();
    expect(window.localStorage.getItem("vr_conversation_id")).toBeNull();
    // The code itself was valid — only the identity is corrupt, so the
    // referrer survives and the registration form is prefilled with it.
    expect(window.localStorage.getItem("vr_referrer_id")).toBe(String(REFERRER_ID));
  });
});
