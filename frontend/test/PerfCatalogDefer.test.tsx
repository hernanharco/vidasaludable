import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSession } from "../src/app/components/chat";
import { accessCodeFetch, passAccessCodeGate } from "./helpers/accessCode";

/**
 * T1 / S2d — Performance bundle: the video + product catalog fetches are
 * deferred until the access-code gate is cleared (`phase === "chat"`).
 *
 * Before this task the two catalogs were fetched at mount, so a visit that
 * never leaves the access-code gate still paid for `GET /api/assistant/videos`
 * and `GET /api/assistant/products`. Now:
 *
 *  1. boot / access-code gate → ZERO catalog requests;
 *  2. gate cleared → both catalogs load (same best-effort contract as before).
 */
const mockFetch = vi.fn();
global.fetch = mockFetch;

const CATALOG_ENDPOINTS = ["/api/assistant/videos", "/api/assistant/products"];

function installMemoryLocalStorage() {
  // jsdom 30 under vitest runs with an opaque origin (about:blank), where
  // jsdom refuses to expose localStorage. ChatSession reads it at render time,
  // so the session-level tests install a tiny in-memory stand-in.
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

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

function installFetch() {
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
    // access-code-always: validate + attribute before any phase
    const gate = accessCodeFetch(u);
    if (gate) return Promise.resolve(gate);
    if (u.includes("/api/assistant/profile")) {
      // Returning customer WITH a saved intake profile → straight to chat
      return ok({ profile: SERVER_PROFILE });
    }
    if (u.includes("/api/assistant/history")) return ok({ messages: [] });
    if (u.includes("/api/assistant/videos")) return ok({ videos: [] });
    if (u.includes("/api/assistant/products")) return ok({ products: [] });
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
}

function catalogCalls(): string[] {
  return mockFetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => CATALOG_ENDPOINTS.some((endpoint) => url.includes(endpoint)));
}

/** Lets any boot-phase effect settle before asserting "no call happened". */
async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe("S2d — catalogs are fetched only after the access-code gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("never requests the videos/products catalogs while the visit stays on the access-code gate", async () => {
    // Returning customer: the gate shows on every visit (access-code-always),
    // and this visit never enters it.
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch();

    render(<ChatSession />);
    expect(await screen.findByText("Código de acceso")).toBeInTheDocument();

    await flushAsyncWork();

    expect(catalogCalls()).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalledWith("/api/assistant/videos");
    expect(mockFetch).not.toHaveBeenCalledWith("/api/assistant/products");
  });

  it("requests both catalogs once the gate is cleared and the chat opens", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch();

    const user = userEvent.setup();
    render(<ChatSession />);
    await passAccessCodeGate(user);

    // phase === "chat" → both best-effort catalog loads fire.
    await waitFor(() => expect(catalogCalls()).toContain("/api/assistant/videos"));
    await waitFor(() => expect(catalogCalls()).toContain("/api/assistant/products"));
    // Exactly once each — no effect loop.
    expect(catalogCalls().filter((u) => u.includes("/api/assistant/videos"))).toHaveLength(1);
    expect(catalogCalls().filter((u) => u.includes("/api/assistant/products"))).toHaveLength(1);

    // The chat itself is open (the catalogs are not what unblocks it).
    expect(await screen.findByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
  });
});
