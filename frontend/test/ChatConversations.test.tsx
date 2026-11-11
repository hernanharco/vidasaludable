import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { ChatPage } from "../src/app/components/chat";
import { accessCodeFetch } from "./helpers/accessCode";

/**
 * multi-conversation T2 (specs S1/S3, odd/tasks/multi-conversation.md):
 * the conversation sidebar behind the ChatHeader menu button on /chat.
 *
 * Covered:
 *  1. LIST — the panel renders GET /api/assistant/conversations preserving
 *     the API's (updated_at) order, with the label fallbacks: API `title` →
 *     (current thread) first user message excerpt → `snippet` →
 *     "Nueva conversación".
 *  2. NUEVA — POST /api/assistant/conversations, only `vr_conversation_id`
 *     + messages are reset; `vr_customer_id`, `vr_consent_version` and
 *     `vr_referrer_*` stay untouched (ODD S3: identity is never reset).
 *  3. SWITCH — picking a conversation persists its id (existing identity
 *     path), loads GET /history with THAT id and replaces the messages.
 *  4. DRAWER — toggle aria-expanded/aria-controls, Escape close, backdrop
 *     tap close, focus restore and body scroll lock (AdminLayout drawer
 *     parity); the menu button only exists in the chat phase.
 *
 * Style: MemoryRouter + mocked fetch + in-memory localStorage helpers (see
 * ChatPage.test.tsx — jsdom's opaque origin exposes no localStorage).
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

/** Persisted threads keyed by conversation id (GET /assistant/history). */
const HISTORY: Record<number, Array<{ role: string; content: string }>> = {
  7: [
    { role: "user", content: "Tengo dolor de espalda desde hace semanas" },
    { role: "assistant", content: "Vamos a revisarlo con calma." },
  ],
  9: [
    { role: "user", content: "¿Qué le recomiendas a mi madre para la tensión?" },
    { role: "assistant", content: "Para tu madre, revisa su presión con su médico." },
  ],
  5: [{ role: "user", content: "Me duelen los pies al caminar" }],
  4: [],
};

/** GET /api/assistant/conversations — newest activity first (API order). */
const CONVERSATIONS = [
  {
    id: 9,
    customer_id: CUSTOMER_ID,
    title: "Dolor de espalda",
    updated_at: "2026-11-11T10:00:00.000Z",
    created_at: "2026-11-10T09:00:00.000Z",
    snippet: "¿Qué hago para aliviarlo?",
  },
  {
    // Current thread with a still-null title → client-side excerpt fallback.
    id: CONVERSATION_ID,
    customer_id: CUSTOMER_ID,
    title: null,
    updated_at: "2026-11-09T08:00:00.000Z",
    created_at: "2026-11-09T07:00:00.000Z",
    snippet: "Vamos a revisarlo con calma.",
  },
  {
    // Not current, untitled → the API snippet carries the label.
    id: 5,
    customer_id: CUSTOMER_ID,
    title: null,
    updated_at: "2026-11-08T08:00:00.000Z",
    created_at: "2026-11-08T07:00:00.000Z",
    snippet: "Me duelen los pies al caminar…",
  },
  {
    // Untitled AND empty → the "Nueva conversación" fallback label.
    id: 4,
    customer_id: CUSTOMER_ID,
    title: null,
    updated_at: "2026-11-07T08:00:00.000Z",
    created_at: "2026-11-07T07:00:00.000Z",
    snippet: null,
  },
];

/** Bodies of POST /api/assistant/conversations, reset per test. */
let conversationPostCalls: Array<Record<string, unknown>> = [];
/** When true, POST /api/assistant/conversations answers 500 (triangulation). */
let createPostFails = false;

function installFetch() {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    // access-code-always: the gate validates + attributes before chat
    const gate = accessCodeFetch(u);
    if (gate) return Promise.resolve(gate);
    if (u.includes("/api/assistant/profile")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ profile: SERVER_PROFILE }),
      });
    }
    if (u.includes("/api/assistant/history")) {
      const conversationId = Number(
        new URL(u, "http://localhost").searchParams.get("conversation_id"),
      );
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: HISTORY[conversationId] ?? [] }),
      });
    }
    if (u.includes("/api/assistant/conversations")) {
      if (init?.method === "POST") {
        conversationPostCalls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        if (createPostFails) {
          return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ conversation_id: 99 }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ conversations: CONVERSATIONS }),
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

/**
 * Gateless boot (access-code-once): stored referrer + identity → straight
 * into chat with the persisted thread's history already rendered.
 */
async function bootIntoChat() {
  window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
  window.localStorage.setItem("vr_conversation_id", String(CONVERSATION_ID));
  window.localStorage.setItem("vr_referrer_id", String(REFERRER_ID));
  window.localStorage.setItem("vr_referrer_name", "Referente Test");
  window.localStorage.setItem("vr_consent_version", "2");
  installFetch();
  const user = userEvent.setup();
  renderChatPage();
  await screen.findByPlaceholderText("Escribe un mensaje...");
  await screen.findByText("Vamos a revisarlo con calma.");
  return user;
}

function panel(): HTMLElement {
  return screen.getByRole("complementary", { name: "Conversaciones" });
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  const toggle = screen.getByRole("button", { name: "Conversaciones" });
  await user.click(toggle);
  await screen.findByRole("complementary", { name: "Conversaciones" });
  return toggle;
}

/** The create button shares its label with an untitled+empty conversation. */
function createButton(): HTMLElement {
  const list = within(panel()).getByRole("list");
  const button = within(panel())
    .getAllByRole("button", { name: "Nueva conversación" })
    .find((b) => !list.contains(b));
  expect(button).toBeDefined();
  return button as HTMLElement;
}

describe("multi-conversation sidebar (S1/S3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    conversationPostCalls = [];
    createPostFails = false;
  });

  it("lists the customer's conversations from GET in API order with the label fallbacks", async () => {
    const user = await bootIntoChat();
    const toggle = await openPanel(user);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/assistant/conversations?customer_id=42"),
    );
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const list = within(panel()).getByRole("list");
    // The API's updated_at order is preserved as-is (no client re-sorting).
    expect(
      within(list).getAllByRole("listitem").map((li) => li.textContent),
    ).toEqual([
      // API title wins
      "Dolor de espalda",
      // current thread, title still null → first user message excerpt (T2.4)
      "Tengo dolor de espalda desde hace semanas",
      // not current, untitled → API snippet
      "Me duelen los pies al caminar…",
      // untitled + empty → fallback label
      "Nueva conversación",
    ]);
    // The active thread is marked as current in the list.
    expect(within(list).getByRole("button", { current: true })).toHaveTextContent(
      "Tengo dolor de espalda desde hace semanas",
    );
  });

  it("Nueva conversación: POSTs a fresh thread and resets only vr_conversation_id + messages", async () => {
    const user = await bootIntoChat();
    await openPanel(user);

    await user.click(createButton());

    await waitFor(() => {
      expect(conversationPostCalls).toEqual([{ customer_id: CUSTOMER_ID }]);
      // The conversation key is reset — a fresh thread starts...
      expect(window.localStorage.getItem("vr_conversation_id")).toBeNull();
      // ...the previous thread's bubbles are gone, nothing re-seeded...
      expect(screen.queryByText("Vamos a revisarlo con calma.")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Tengo dolor de espalda desde hace semanas"),
      ).not.toBeInTheDocument();
      // ...and the panel closes after creating.
      expect(
        screen.queryByRole("complementary", { name: "Conversaciones" }),
      ).not.toBeInTheDocument();
    });

    // ODD S3: identity / consent / attribution keys are never touched.
    expect(window.localStorage.getItem("vr_customer_id")).toBe(String(CUSTOMER_ID));
    expect(window.localStorage.getItem("vr_consent_version")).toBe("2");
    expect(window.localStorage.getItem("vr_referrer_id")).toBe(String(REFERRER_ID));
    expect(window.localStorage.getItem("vr_referrer_name")).toBe("Referente Test");
  });

  it("switching conversations persists the id, loads THAT history and replaces the messages", async () => {
    const user = await bootIntoChat();
    await openPanel(user);

    const list = within(panel()).getByRole("list");
    await user.click(within(list).getByRole("button", { name: "Dolor de espalda" }));

    // History requested for the CHOSEN conversation...
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/assistant/history?conversation_id=9&customer_id=42",
    );
    expect(
      await screen.findByText("¿Qué le recomiendas a mi madre para la tensión?"),
    ).toBeInTheDocument();
    // ...and the previous thread's messages are replaced, not appended.
    expect(screen.queryByText("Vamos a revisarlo con calma.")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Tengo dolor de espalda desde hace semanas"),
    ).not.toBeInTheDocument();

    // Persisted through the existing identity path; identity itself intact.
    expect(window.localStorage.getItem("vr_conversation_id")).toBe("9");
    expect(window.localStorage.getItem("vr_customer_id")).toBe(String(CUSTOMER_ID));
    // The panel closes on selection.
    expect(
      screen.queryByRole("complementary", { name: "Conversaciones" }),
    ).not.toBeInTheDocument();
  });

  it("menu toggle drives the drawer: aria state, Escape, backdrop tap, focus restore, scroll lock", async () => {
    const user = await bootIntoChat();

    const toggle = screen.getByRole("button", { name: "Conversaciones" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "chat-conversations");
    expect(document.body.style.overflow).toBe("hidden");

    // Escape closes it and focus returns to the toggle (AdminLayout parity).
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-expanded", "false"),
    );
    expect(
      screen.queryByRole("complementary", { name: "Conversaciones" }),
    ).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
    expect(document.body.style.overflow).not.toBe("hidden");

    // Backdrop tap (the mobile drawer affordance) closes it too.
    await user.click(toggle);
    const backdrop = panel().previousElementSibling as HTMLElement;
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(backdrop);
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-expanded", "false"),
    );
    expect(
      screen.queryByRole("complementary", { name: "Conversaciones" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the conversations menu out of the gates — only the chat phase lists", async () => {
    installFetch();
    const user = userEvent.setup();
    renderChatPage();

    // Fresh visitor: the access-code gate has nothing to list.
    await screen.findByText("Código de acceso");
    expect(
      screen.queryByRole("button", { name: "Conversaciones" }),
    ).not.toBeInTheDocument();
    void user;
  });

  it("triangulate: a failed create reports inline and resets NOTHING", async () => {
    createPostFails = true;
    const user = await bootIntoChat();
    await openPanel(user);

    await user.click(createButton());

    // The POST was attempted with the right body but failed → no reset.
    await waitFor(() =>
      expect(conversationPostCalls).toEqual([{ customer_id: CUSTOMER_ID }]),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo crear la conversación",
    );
    expect(window.localStorage.getItem("vr_conversation_id")).toBe(
      String(CONVERSATION_ID),
    );
    expect(window.localStorage.getItem("vr_customer_id")).toBe(String(CUSTOMER_ID));
    expect(window.localStorage.getItem("vr_consent_version")).toBe("2");
    // The current thread's messages stay and the panel remains open to retry.
    expect(screen.getByText("Vamos a revisarlo con calma.")).toBeInTheDocument();
    expect(panel()).toBeInTheDocument();
  });

  it("triangulate: re-selecting the current thread closes the panel without reloading history", async () => {
    const user = await bootIntoChat();
    const historyCallsBefore = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes("/api/assistant/history"),
    ).length;

    await openPanel(user);
    const list = within(panel()).getByRole("list");
    await user.click(within(list).getByRole("button", { current: true }));

    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Conversaciones" }),
      ).not.toBeInTheDocument(),
    );
    // Same thread: no extra /history round-trip, messages untouched.
    expect(
      mockFetch.mock.calls.filter(([url]) => String(url).includes("/api/assistant/history")),
    ).toHaveLength(historyCallsBefore);
    expect(screen.getByText("Vamos a revisarlo con calma.")).toBeInTheDocument();
    expect(window.localStorage.getItem("vr_conversation_id")).toBe(
      String(CONVERSATION_ID),
    );
  });
});
