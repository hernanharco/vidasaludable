import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { ChatPage } from "../src/app/components/chat";
import { accessCodeFetch, passAccessCodeGate } from "./helpers/accessCode";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function installMemoryLocalStorage() {
  // jsdom 30 under vitest runs with an opaque origin (about:blank), where
  // jsdom refuses to expose localStorage. ChatSession reads it at render time,
  // so the page-level tests install a tiny in-memory stand-in.
  const store = new Map<string, string>();
  const impl = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: impl });
}

installMemoryLocalStorage();

const CUSTOMER_ID = 42;
const CONVERSATION_ID = 7;

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

interface FetchOptions {
  /** Profile returned by GET /api/assistant/profile (null → intake). */
  profile: typeof SERVER_PROFILE | null;
  /** Messages returned by GET /api/assistant/history. */
  history: Array<{ role: string; content: string }>;
}

function installFetch(options: FetchOptions) {
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
    // access-code-always: the gate validates + attributes before any phase
    const gate = accessCodeFetch(u);
    if (gate) return Promise.resolve(gate);
    if (u.includes("/api/assistant/profile")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ profile: options.profile }),
      });
    }
    if (u.includes("/api/assistant/history")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: options.history }),
      });
    }
    // videos / products / consent — best-effort endpoints, not needed here
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
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

describe("ChatPage (/chat fullscreen route)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders ChatSession's chrome: a fresh visitor hits the access-code gate", async () => {
    // No localStorage identity → ChatSession boots into the access code gate
    installFetch({ profile: null, history: [] });

    renderChatPage();

    expect(await screen.findByText("Código de acceso")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ej: 1906432239")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Escribe un mensaje...")).not.toBeInTheDocument();
  });

  it("boots a registered customer into the access-code gate (access-code-always), not into chat", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: SERVER_PROFILE, history: [] });

    renderChatPage();

    // The code is requested on EVERY visit — even with a stored identity.
    expect(await screen.findByText("Código de acceso")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Escribe un mensaje...")).not.toBeInTheDocument();
  });

  it("uses a 100dvh-family height and safe-area padding on the outer container", async () => {
    installFetch({ profile: null, history: [] });

    const { container } = renderChatPage();
    await screen.findByText("Código de acceso");

    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toBeNull();
    // Full dynamic-viewport height (dvh) so mobile URL chrome never causes
    // phantom scrolling, plus a 100vh fallback for browsers without dvh.
    expect(root.className).toContain("100dvh");
    expect(root.className).toContain("100vh");
    // iOS home indicator: the input must not sit under the safe area inset.
    expect(root.className).toContain("env(safe-area-inset-bottom)");
  });

  it("opens AssessmentWidget when the [ASSESSMENT] history card is clicked", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    window.localStorage.setItem("vr_conversation_id", String(CONVERSATION_ID));
    installFetch({
      profile: SERVER_PROFILE,
      history: [
        { role: "assistant", content: "Tu plan de prevención está listo.\n[ASSESSMENT]" },
      ],
    });

    const user = userEvent.setup();
    renderChatPage();
    await passAccessCodeGate(user);

    // The persisted history renders the AssessmentCard (marker is never leaked)
    const card = await screen.findByRole("button", { name: /Chequeo completo de síntomas/ });
    expect(screen.queryByText("[ASSESSMENT]")).not.toBeInTheDocument();

    // Modal closed before the click
    expect(screen.queryByText("Evaluación de Prevención")).not.toBeInTheDocument();

    await user.click(card);

    expect(await screen.findByText("Evaluación de Prevención")).toBeInTheDocument();
  });
});
