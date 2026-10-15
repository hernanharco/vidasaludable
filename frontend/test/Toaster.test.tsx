import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import App from "../src/app/App";

/**
 * S7a (odd/tasks/ui-s6.md) — the repo's own `<Toaster />` (ui/sonner.tsx) is
 * mounted in App, so any `toast.success/error` call has a live host. The
 * assertion targets sonner's always-rendered labelled region, which exists
 * even with zero toasts queued.
 */

// The landing's Hero uses framer-motion `whileInView`, which requires
// IntersectionObserver — not shipped by jsdom. Same no-op stub as
// ChatLauncher.test.tsx so App can mount.
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
Object.defineProperty(window, "IntersectionObserver", {
  configurable: true,
  value: NoopIntersectionObserver,
});
Object.defineProperty(globalThis, "IntersectionObserver", {
  configurable: true,
  value: NoopIntersectionObserver,
});

// sonner's theme effect calls window.matchMedia unguarded; this vitest/jsdom
// setup does not ship matchMedia (probed: typeof window.matchMedia ===
// "undefined"), so a minimal stub keeps the Toaster mountable.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// The landing doesn't call fetch; mocked so an accidental request fails loudly.
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("App mounts the sonner Toaster", () => {
  it("renders the Toaster notifications region on the landing route", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    // sonner's Toaster renders <section aria-label="Notifications …">
    // regardless of the toast queue, so this fails while the host is missing.
    expect(await screen.findByLabelText(/^notifications/i)).toBeInTheDocument();
  });
});
