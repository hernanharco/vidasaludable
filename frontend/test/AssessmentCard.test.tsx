import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatMessages } from "../src/app/components/chat/ChatMessages";
import { ChatSession } from "../src/app/components/chat";
import { AssessmentWidget } from "../src/app/components/assessment/AssessmentWidget";
import { accessCodeFetch, passAccessCodeGate } from "./helpers/accessCode";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function installMemoryLocalStorage() {
  // jsdom 30 under vitest runs with an opaque origin (about:blank), where
  // jsdom refuses to expose localStorage. ChatSession reads it at render time,
  // so the widget-level tests install a tiny in-memory stand-in.
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

/** Accessible name of the `[ASSESSMENT]` button-card (label + subtitle). */
const CARD_NAME = /Chequeo completo de síntomas/;

function renderMessages(
  text: string,
  sender: "user" | "agent" = "agent",
  onOpenAssessment?: () => void,
) {
  return render(
    <ChatMessages
      messages={[{ sender, text }]}
      sending={false}
      chatError={null}
      scrollRef={{ current: null } as React.RefObject<HTMLDivElement>}
      videos={new Map()}
      onOpenAssessment={onOpenAssessment}
    />,
  );
}

describe("ChatMessages assessment card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders ONE card with the Spanish label for a trailing [ASSESSMENT] marker; token never visible", () => {
    const { container } = renderMessages(
      "Te preparé tu recomendación personalizada.\n[ASSESSMENT]",
      "agent",
      vi.fn(),
    );

    const cards = screen.getAllByRole("button", { name: CARD_NAME });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("Chequeo completo de síntomas");
    expect(cards[0]).toHaveTextContent("95 preguntas · resultados personalizados");
    // Surrounding text intact…
    expect(screen.getByText(/Te preparé tu recomendación personalizada/)).toBeInTheDocument();
    // …marker stripped from the rendered output (persisted text is untouched)
    expect(container.textContent).not.toContain("[ASSESSMENT");
    expect(container.textContent).not.toContain("ASSESSMENT");
    expect(screen.queryByText(/\[ASSESSMENT\]/)).not.toBeInTheDocument();
  });

  it("renders ONE card when the message contains two markers (dedupe per message)", () => {
    const { container } = renderMessages(
      "Si lo prefieres [ASSESSMENT] o si no, también [ASSESSMENT] ¡quedo atento!",
      "agent",
      vi.fn(),
    );

    expect(screen.getAllByRole("button", { name: CARD_NAME })).toHaveLength(1);
    expect(screen.getByText(/Si lo prefieres/)).toBeInTheDocument();
    expect(screen.getByText(/quedo atento/)).toBeInTheDocument();
    expect(container.textContent).not.toContain("[ASSESSMENT");
  });

  it("calls the onOpenAssessment handler when the card is clicked", async () => {
    const user = userEvent.setup();
    const onOpenAssessment = vi.fn();
    renderMessages("Tu plan está listo.\n\n¿Hacemos el chequeo?\n[ASSESSMENT]", "agent", onOpenAssessment);

    await user.click(screen.getByRole("button", { name: CARD_NAME }));

    expect(onOpenAssessment).toHaveBeenCalledTimes(1);
  });

  it("keeps the card visible but disabled when no handler is provided", () => {
    renderMessages("Tu plan está listo.\n[ASSESSMENT]", "agent");

    const card = screen.getByRole("button", { name: CARD_NAME });
    expect(card).toBeInTheDocument();
    expect(card).toBeDisabled();
    expect(card).toHaveTextContent("95 preguntas · resultados personalizados");
  });

  it("never parses user messages (plain text, no card)", () => {
    renderMessages("¿Qué es el [ASSESSMENT]?", "user", vi.fn());

    expect(screen.queryByRole("button", { name: CARD_NAME })).not.toBeInTheDocument();
    expect(screen.getByText("¿Qué es el [ASSESSMENT]?")).toBeInTheDocument();
  });
});

// Surface-level wiring: the /chat page owns `assessmentOpen` and hands
// `onOpenAssessment` to ChatSession while controlling AssessmentWidget.
// T3 removed the popup ChatWidget, so this harness mounts ChatSession and
// AssessmentWidget directly — the same panel ↔ modal interplay (open/close
// + stacking), without the popup shell.
function AssessmentHarness() {
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  return (
    <>
      <ChatSession onOpenAssessment={() => setAssessmentOpen(true)} />
      <AssessmentWidget open={assessmentOpen} onClose={() => setAssessmentOpen(false)} />
    </>
  );
}

function installChatFetch() {
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
    // access-code-always: the gate validates + attributes before chat
    const gate = accessCodeFetch(u);
    if (gate) return Promise.resolve(gate);
    if (u.includes("/api/assistant/profile")) {
      // Returning customer WITH a saved intake profile → straight to chat
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ profile: { customer_id: 42, sex: "F", age: 34 } }),
      });
    }
    if (u.includes("/api/assistant/history")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            messages: [
              { role: "user", content: "Hola, ¿me ayudas?" },
              {
                role: "assistant",
                content:
                  "Aquí va tu recomendación personalizada.\n\n¿Te animas al chequeo completo?\n[ASSESSMENT]",
              },
            ],
          }),
      });
    }
    if (u.includes("/api/assistant/videos")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ videos: [] }) });
    }
    if (u.includes("/api/assistant/products")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ products: [] }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
}

describe("Assessment card → wizard wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("opens the wizard from a restored history message; closing it reveals the chat, still open", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", "42");
    window.localStorage.setItem("vr_conversation_id", "7");
    installChatFetch();

    render(<AssessmentHarness />);
    await passAccessCodeGate(user);

    // The chat is mounted directly (no popup launcher) and there is no
    // standalone "Prevenición" floating entry — the landing only has the
    // launcher, and this harness is the /chat surface.
    expect(screen.queryByText("Prevenición")).not.toBeInTheDocument();

    // History restored → the [ASSESSMENT] message renders the card
    const card = await screen.findByRole("button", { name: CARD_NAME });
    expect(card).toBeEnabled();

    // Clicking the card opens the prevention wizard
    await user.click(card);
    expect(await screen.findByText("Evaluación de Prevención")).toBeInTheDocument();

    // Z-stack: chat surface and assessment modal are both z-50, but
    // AssessmentWidget renders AFTER ChatSession in ChatPage, so the modal
    // paints above the open chat. jsdom has no layout, so we assert the observable
    // contract instead: both stay mounted, and closing the modal (X) leaves
    // the chat open underneath.
    await user.click(screen.getByRole("button", { name: "Cerrar evaluación" }));
    expect(screen.queryByText("Evaluación de Prevención")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
    expect(screen.getByText(/Aquí va tu recomendación personalizada/)).toBeInTheDocument();
  });
});
