import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { ChatLauncher } from "../src/app/components/chat";
import { ChatHeader } from "../src/app/components/chat/ChatHeader";
import App from "../src/app/App";

// Records the props passed to every motion.* element so animation intent can
// be asserted without depending on framer-motion's runtime frame scheduling.
const motionPropsRecords: Array<Record<string, unknown>> = [];
const MOTION_ONLY_PROPS = new Set([
  "animate",
  "exit",
  "initial",
  "transition",
  "whileHover",
  "whileTap",
  "whileInView",
  "viewport",
]);

vi.mock("motion/react", () => {
  const makeComponent = (tag: string) =>
    function MotionStub(props: Record<string, unknown>) {
      motionPropsRecords.push(props);
      const rest: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (!MOTION_ONLY_PROPS.has(key)) rest[key] = value;
      }
      return React.createElement(tag, rest);
    };
  const motion = new Proxy({}, { get: (_target, tag: string) => makeComponent(tag) });
  const AnimatePresence = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const useReducedMotion = () => false;
  // App wraps its tree in <MotionConfig reducedMotion="user"> (ui-s6 S5b), so
  // the stub module must export it too or React throws "Element type is invalid".
  const MotionConfig = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return { motion, AnimatePresence, useReducedMotion, MotionConfig };
});

// App mounts sonner's <Toaster /> (ui-s6 S7a) and its theme effect calls
// window.matchMedia unguarded; this vitest/jsdom setup ships no matchMedia, so a
// minimal stub keeps the landing renderable (same stub as Toaster.test.tsx).
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

// Mock fetch (the landing components don't call it, but the pattern is kept
// identical to ChatPage.test.tsx so an accidental fetch fails loudly).
const mockFetch = vi.fn();
global.fetch = mockFetch;

function installMemoryLocalStorage() {
  // jsdom 30 under vitest runs with an opaque origin (about:blank), where
  // jsdom refuses to expose localStorage. Installed as a tiny in-memory
  // stand-in per the ChatPage.test.tsx setup pattern.
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

// The landing's Hero uses framer-motion `whileInView`, which requires
// IntersectionObserver — not shipped by jsdom. Minimal no-op stub so the
// landing smoke test can mount App.
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

/** lucide-react stamps every icon svg with `lucide lucide-<kebab-name>`. */
function icon(container: HTMLElement, name: string) {
  return container.querySelector(`svg.lucide-${name}`);
}

/** Renders the current pathname so navigation assertions have a probe. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

describe("ChatLauncher (floating AI entry point)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Sparkles icon and 'Haz tu Análisis' label; never MessageCircle or the human-advisor copy", () => {
    const { container } = render(
      <MemoryRouter>
        <ChatLauncher />
      </MemoryRouter>,
    );

    expect(icon(container, "sparkles")).toBeInTheDocument();
    expect(screen.getByText("Haz tu Análisis")).toBeInTheDocument();
    // Accessible name for screen readers (matches the visible label)
    expect(screen.getByRole("button", { name: "Haz tu Análisis" })).toBeInTheDocument();
    // The "human advisor" signals are gone
    expect(icon(container, "message-circle")).not.toBeInTheDocument();
    expect(screen.queryByText("Recomendador Preventivo")).not.toBeInTheDocument();
    expect(screen.queryByText("En línea")).not.toBeInTheDocument();
  });

  it("bounces continuously so the button draws attention", () => {
    motionPropsRecords.length = 0;
    render(
      <MemoryRouter>
        <ChatLauncher />
      </MemoryRouter>,
    );

    const launcher = motionPropsRecords.find(
      (props) => props["aria-label"] === "Haz tu Análisis",
    );
    expect(launcher).toBeDefined();
    // A looping vertical bob: up, then back to rest.
    expect(launcher!.animate).toMatchObject({ y: [0, -8, 0] });
    expect(launcher!.transition).toMatchObject({ repeat: Infinity });
  });

  it("navigates to /chat when clicked", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ChatLauncher />
        <LocationProbe />
        <Routes>
          <Route path="/chat" element={<div data-testid="chat-route" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("location-probe")).toHaveTextContent("/");

    await user.click(screen.getByRole("button", { name: "Haz tu Análisis" }));

    expect(screen.getByTestId("location-probe")).toHaveTextContent("/chat");
    expect(screen.getByTestId("chat-route")).toBeInTheDocument();
  });
});

describe("ChatHeader (AI identity)", () => {
  it("renders Sparkles + 'Análisis IA' + 'Listo para analizar'; no User icon, no 'En línea'", () => {
    const { container } = render(<ChatHeader onClose={vi.fn()} />);

    expect(icon(container, "sparkles")).toBeInTheDocument();
    expect(screen.getByText("Análisis IA")).toBeInTheDocument();
    expect(screen.getByText("Listo para analizar")).toBeInTheDocument();
    // The "human advisor" signals are gone
    expect(icon(container, "user")).not.toBeInTheDocument();
    expect(screen.queryByText("Recomendador Preventivo")).not.toBeInTheDocument();
    expect(screen.queryByText("En línea")).not.toBeInTheDocument();
    // The close button (X) is preserved
    expect(icon(container, "x")).toBeInTheDocument();
  });
});

describe("Landing smoke (single entry point)", () => {
  it("renders the ChatLauncher and no standalone assessment floating button", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Haz tu Análisis" })).toBeInTheDocument();
    // The standalone "Prevenición" entry (AssessmentWidget's own button) is gone
    expect(screen.queryByText("Prevenición")).not.toBeInTheDocument();
    expect(screen.queryByText("Evaluación de Prevención")).not.toBeInTheDocument();
  });
});
